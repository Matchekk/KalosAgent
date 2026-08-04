from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from kalos_agent.battle.belief import OpponentBeliefModel
from kalos_agent.battle.models import (
    BattlePokemon,
    BattleState,
    BattleType,
    HPState,
    MoveState,
    PokemonType,
    StatBlock,
)
from kalos_agent.battle.planner import (
    BattleActionKind,
    BattlePlanner,
    OllamaBattleStrategyEvaluator,
    StrategyEvaluation,
)
from kalos_agent.config import PlannerSettings
from tests.battle_fixtures import build_knowledge_database


def pokemon(
    name: str,
    types: list[PokemonType],
    stats: StatBlock,
    *,
    level: int = 50,
) -> BattlePokemon:
    return BattlePokemon(
        canonical_name=name,
        level=level,
        types=types,
        base_stats=stats,
        estimated_stats=stats,
        hp=HPState(current=stats.hp, maximum=stats.hp, confidence=1),
    )


def move(database: object, name: str, *, pp: int | None = None) -> MoveState:
    record = database.move(name)  # type: ignore[attr-defined]
    assert record is not None
    return MoveState(
        canonical_name=record.canonical_name,
        type=record.type,
        damage_class=record.damage_class,
        power=record.power,
        accuracy=record.accuracy,
        priority=record.priority,
        pp=record.pp if pp is None else pp,
        max_pp=record.pp,
        min_hits=record.min_hits,
        max_hits=record.max_hits,
        drain_percent=record.drain_percent,
        crit_rate=record.crit_rate,
    )


class RecklessEvaluator:
    def evaluate(
        self,
        state_summary: dict[str, object],
        candidates: list[dict[str, object]],
    ) -> StrategyEvaluation:
        return StrategyEvaluation(
            adjustments={"move:thunderbolt": 999},
            rationale={"move:thunderbolt": "Take an impossible risk."},
        )


class FakeOllamaClient:
    def chat(self, **kwargs: object) -> object:
        return SimpleNamespace(
            message=SimpleNamespace(
                content='{"adjustments":{"move:tackle":9},"rationale":{}}'
            )
        )


def test_ollama_strategy_evaluator_clamps_and_cannot_create_mechanics() -> None:
    evaluator = OllamaBattleStrategyEvaluator(
        PlannerSettings(),
        client=FakeOllamaClient(),
    )
    result = evaluator.evaluate(
        {"generation": 6},
        [{"action_key": "move:tackle", "type_multiplier": 1.0}],
    )
    assert result.adjustments == {"move:tackle": 0.5}


def test_expectimax_prefers_super_effective_move_and_builds_tree(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        charizard = pokemon(
            "charizard",
            [PokemonType.FIRE, PokemonType.FLYING],
            StatBlock(
                hp=153, attack=104, defense=98, special_attack=129, special_defense=105, speed=120
            ),
        )
        venusaur = pokemon(
            "venusaur",
            [PokemonType.GRASS, PokemonType.POISON],
            StatBlock(
                hp=155, attack=102, defense=103, special_attack=120, special_defense=120, speed=100
            ),
        )
        state = BattleState(
            battle_id="battle-plan-1",
            battle_type=BattleType.TRAINER_SINGLE,
            player_active=[charizard],
            player_party=[charizard],
            opponent_active=[venusaur],
            opponent_known_party=[venusaur],
            available_moves=[move(database, "flamethrower"), move(database, "tackle")],
            uncertainty=0.1,
        )
        belief = OpponentBeliefModel(database).initialize(venusaur)
        decision = BattlePlanner(database, horizon=2).plan(state, belief)
        assert decision.action.kind == BattleActionKind.MOVE
        assert decision.action.move == "flamethrower"
        assert decision.candidates[0].type_multiplier == 2
        assert decision.search_tree.children
        assert decision.search_tree.children[0].children
        assert decision.search_tree.children[0].children[0].opponent_move == "tackle"
    finally:
        database.close()


def test_mechanical_immunity_cannot_be_overridden_by_llm_adjustment(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        pikachu = pokemon(
            "pikachu",
            [PokemonType.ELECTRIC],
            StatBlock(
                hp=110, attack=75, defense=60, special_attack=70, special_defense=70, speed=110
            ),
        )
        garchomp = pokemon(
            "garchomp",
            [PokemonType.DRAGON, PokemonType.GROUND],
            StatBlock(
                hp=183, attack=150, defense=115, special_attack=100, special_defense=105, speed=122
            ),
        )
        state = BattleState(
            battle_id="battle-plan-2",
            player_active=[pikachu],
            player_party=[pikachu],
            opponent_active=[garchomp],
            opponent_known_party=[garchomp],
            available_moves=[move(database, "thunderbolt"), move(database, "tackle")],
        )
        belief = OpponentBeliefModel(database).initialize(garchomp)
        decision = BattlePlanner(
            database,
            strategy_evaluator=RecklessEvaluator(),
        ).plan(state, belief)
        assert decision.action.move == "tackle"
        thunderbolt = next(
            candidate for candidate in decision.candidates if candidate.action.move == "thunderbolt"
        )
        assert thunderbolt.type_multiplier == 0
        assert thunderbolt.maximum_damage == 0
        assert decision.strategic_adjustment <= 0.5
    finally:
        database.close()


def test_invalid_zero_pp_move_is_removed_before_search(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        charizard = pokemon(
            "charizard",
            [PokemonType.FIRE, PokemonType.FLYING],
            StatBlock(
                hp=153, attack=104, defense=98, special_attack=129, special_defense=105, speed=120
            ),
        )
        venusaur = pokemon(
            "venusaur",
            [PokemonType.GRASS, PokemonType.POISON],
            StatBlock(
                hp=155, attack=102, defense=103, special_attack=120, special_defense=120, speed=100
            ),
        )
        state = BattleState(
            battle_id="battle-plan-3",
            player_active=[charizard],
            opponent_active=[venusaur],
            available_moves=[
                move(database, "flamethrower", pp=0),
                move(database, "tackle"),
            ],
        )
        belief = OpponentBeliefModel(database).initialize(venusaur)
        decision = BattlePlanner(database).plan(state, belief)
        assert decision.action.move == "tackle"
        assert all(candidate.action.move != "flamethrower" for candidate in decision.candidates)
    finally:
        database.close()
