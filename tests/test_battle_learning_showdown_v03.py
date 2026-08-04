from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from kalos_agent.battle.belief import OpponentBeliefModel
from kalos_agent.battle.learning import BattleLearningStore, InContextBattleLearner
from kalos_agent.battle.models import (
    BattlePokemon,
    BattleState,
    HPState,
    PokemonType,
    StatBlock,
)
from kalos_agent.battle.planner import BattlePlanner
from kalos_agent.battle.showdown import PokeEnvTrainingInterface, ShowdownBattleAdapter
from tests.battle_fixtures import build_knowledge_database


class FakePSClient:
    def __init__(self) -> None:
        self.stopped = False

    async def stop_listening(self) -> None:
        self.stopped = True


class FakeShowdownPlayer:
    def __init__(self) -> None:
        self.n_finished_battles = 0
        self.n_won_battles = 0
        self.ps_client = FakePSClient()

    async def battle_against(self, other: object, *, n_battles: int) -> None:
        self.n_finished_battles = n_battles
        self.n_won_battles = n_battles - 1
        other.n_won_battles = 1


class FakeTrainingInterface(PokeEnvTrainingInterface):
    def __init__(self, *args: object, players: list[FakeShowdownPlayer], **kwargs: object) -> None:
        super().__init__(*args, **kwargs)
        self.players = players

    def create_player(self, **player_kwargs: object) -> FakeShowdownPlayer:
        return self.players.pop(0)


def pokemon(
    name: str,
    types: list[PokemonType],
    stats: StatBlock,
    hp_ratio: float = 1.0,
) -> BattlePokemon:
    return BattlePokemon(
        canonical_name=name,
        level=50,
        types=types,
        base_stats=stats,
        estimated_stats=stats,
        hp=HPState(current=round(stats.hp * hp_ratio), maximum=stats.hp, confidence=1),
    )


def test_turn_learning_updates_belief_strategy_and_exports_offline_datasets(
    tmp_path: Path,
) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    learning = BattleLearningStore(tmp_path / "battle-learning.sqlite3")
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
        move_record = database.move("flamethrower")
        tackle_record = database.move("tackle")
        assert move_record and tackle_record
        from kalos_agent.battle.models import MoveState

        flamethrower = MoveState(
            canonical_name="flamethrower",
            type=move_record.type,
            damage_class=move_record.damage_class,
            power=move_record.power,
            accuracy=move_record.accuracy,
            pp=15,
            max_pp=15,
        )
        before = BattleState(
            battle_id="learning-1",
            turn_number=1,
            player_active=[charizard],
            player_party=[charizard],
            opponent_active=[venusaur],
            opponent_known_party=[venusaur],
            available_moves=[flamethrower],
        )
        after_venusaur = venusaur.model_copy(deep=True)
        after_venusaur.hp = HPState(current=0, maximum=155, confidence=1)
        after_venusaur.fainted = True
        after = before.model_copy(
            update={
                "turn_number": 2,
                "opponent_active": [after_venusaur],
            },
            deep=True,
        )
        belief_model = OpponentBeliefModel(database)
        belief = belief_model.initialize(venusaur)
        planner = BattlePlanner(database)
        decision = planner.plan(before, belief)
        learner = InContextBattleLearner(belief_model, learning)
        record = learner.apply_turn(
            before=before,
            belief=belief,
            decision=decision,
            after=after,
            opponent_action="tackle",
            actual_damage=15,
            status_changes=[],
            progress_score=1.0,
            opponent_move=BattlePlanner._move_state(tackle_record),
        )
        assert record.opponent_action == "tackle"
        assert "tackle" in belief.revealed_moves
        assert learning.strategy_prior(before, decision.action) > 0
        learning.finish_battle(before.battle_id, won=True)
        paths = learning.export_datasets(tmp_path / "datasets")
        assert set(paths) == {"opponent_action", "value", "ranking", "lora", "rl"}
        assert all(path.exists() and path.read_text(encoding="utf-8") for path in paths.values())
        rl_row = json.loads(paths["rl"].read_text(encoding="utf-8").splitlines()[0])
        assert rl_row["action"]["move"] == "flamethrower"
        metrics = learning.benchmark()
        assert metrics["turns"] == 1
        assert metrics["battle_win_rate"] == 1
    finally:
        learning.close()
        database.close()


def test_showdown_adapter_uses_same_canonical_battle_state(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        adapter = ShowdownBattleAdapter(database)
        player = SimpleNamespace(
            species="Glurak",
            level=50,
            current_hp_fraction=0.75,
            status=None,
            fainted=False,
            ability="blaze",
            moves={"flamethrower": object()},
        )
        opponent = SimpleNamespace(
            species="Bisaflor",
            level=50,
            current_hp_fraction=1.0,
            status=None,
            fainted=False,
            ability="overgrow",
            moves={"tackle": object()},
        )
        move = SimpleNamespace(
            id="Flammenwurf",
            current_pp=12,
            max_pp=15,
        )
        fake_battle = SimpleNamespace(
            battle_tag="showdown-gen6-1",
            turn=3,
            active_pokemon=player,
            opponent_active_pokemon=opponent,
            team={"p1": player},
            opponent_team={"p2": opponent},
            available_moves=[move],
            available_switches=[],
            battle_format="gen6randombattle",
        )
        state = adapter.to_battle_state(fake_battle)
        assert isinstance(state, BattleState)
        assert state.generation == 6 and state.version_group == "x-y"
        assert state.battle_id == "showdown-gen6-1"
        assert state.active_player.canonical_name == "charizard"
        assert state.active_opponent.canonical_name == "venusaur"
        assert state.available_moves[0].canonical_name == "flamethrower"
        assert state.available_moves[0].pp == 12
    finally:
        database.close()


def test_showdown_self_play_runner_is_reproducible_and_closes_clients(
    tmp_path: Path,
) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        belief = OpponentBeliefModel(database)
        players = [FakeShowdownPlayer(), FakeShowdownPlayer()]
        references = list(players)
        interface = FakeTrainingInterface(
            database,
            BattlePlanner(database),
            belief,
            players=players,
        )
        result = asyncio.run(interface.run_self_play(5))
        assert result == {
            "battles": 5,
            "first_player_wins": 4,
            "second_player_wins": 1,
            "first_player_win_rate": 0.8,
        }
        assert all(player.ps_client.stopped for player in references)
    finally:
        database.close()
