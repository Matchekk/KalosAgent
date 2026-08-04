from __future__ import annotations

from pathlib import Path

from kalos_agent.battle.belief import (
    OpponentBeliefModel,
    TrainerPokemonKnowledge,
)
from kalos_agent.battle.models import (
    BattlePokemon,
    BattleType,
    HPState,
    PokemonType,
    StatBlock,
)
from kalos_agent.battle.parser import BattleParseInput, BattleStateParser
from kalos_agent.layout import UIRegionSemantic
from kalos_agent.models import OCRLine
from tests.battle_fixtures import build_knowledge_database


class FakeTrainerKnowledge:
    def exact_pokemon(
        self,
        trainer_id: str,
        pokemon: str,
        level: int,
    ) -> TrainerPokemonKnowledge | None:
        if trainer_id == "ace-1" and pokemon == "charizard":
            return TrainerPokemonKnowledge(
                pokemon="charizard",
                level=level,
                moves=["flamethrower", "tackle"],
                ability="blaze",
            )
        return None


def line(text: str, semantic: UIRegionSemantic, score: float = 0.95) -> OCRLine:
    return OCRLine(text=text, score=score, region=semantic.value)


def test_battle_parser_maps_semantic_german_ocr_to_canonical_state(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        parser = BattleStateParser(database)
        parsed = parser.parse(
            BattleParseInput(
                battle_id="battle-1",
                frame_id="frame-1",
                battle_type=BattleType.TRAINER_SINGLE,
                hp_ratios={UIRegionSemantic.OPPONENT_HP_BAR.value: 0.64},
                lines=[
                    line("Glurax", UIRegionSemantic.OPPONENT_NAME),
                    line("Lv. 47", UIRegionSemantic.OPPONENT_LEVEL),
                    line("Pikachu", UIRegionSemantic.PLAYER_NAME),
                    line("Lv. 50", UIRegionSemantic.PLAYER_LEVEL),
                    line("88 / 110", UIRegionSemantic.PLAYER_HP_TEXT),
                    line("Flammenwurf", UIRegionSemantic.MOVE_SLOT_1),
                    line("AP 12/15", UIRegionSemantic.MOVE_PP_1),
                    line("Donnerblitz", UIRegionSemantic.MOVE_SLOT_2),
                    line("Glurak setzte Flammenwurf ein!", UIRegionSemantic.BATTLE_TEXT),
                ],
            )
        )
        assert parsed.generation == 6 and parsed.version_group == "x-y"
        assert parsed.active_opponent is not None
        assert parsed.active_opponent.canonical_name == "charizard"
        assert parsed.active_opponent.level == 47
        assert parsed.active_opponent.hp.ratio == 0.64
        assert parsed.active_player is not None
        assert parsed.active_player.canonical_name == "pikachu"
        assert parsed.active_player.hp.current == 88
        assert [move.canonical_name for move in parsed.available_moves] == [
            "flamethrower",
            "thunderbolt",
        ]
        assert parsed.available_moves[0].pp == 12
        assert parsed.battle_log[-1].move == "flamethrower"
        assert parsed.uncertainty < 0.2
    finally:
        database.close()


def test_battle_parser_refuses_ambiguous_or_unknown_name(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        parser = BattleStateParser(database)
        parsed = parser.parse(
            BattleParseInput(
                battle_id="battle-2",
                frame_id="frame-2",
                battle_type=BattleType.WILD_SINGLE,
                lines=[line("????", UIRegionSemantic.OPPONENT_NAME)],
            )
        )
        assert parsed.active_opponent is None
        assert parsed.uncertainty == 1
    finally:
        database.close()


def test_double_battle_parser_keeps_two_active_pokemon_per_side(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        parsed = BattleStateParser(database).parse(
            BattleParseInput(
                battle_id="double-1",
                frame_id="frame-double",
                battle_type=BattleType.TRAINER_DOUBLE,
                lines=[
                    line("Glurak", UIRegionSemantic.OPPONENT_NAME),
                    line("Lv. 50", UIRegionSemantic.OPPONENT_LEVEL),
                    line("Bisaflor", UIRegionSemantic.OPPONENT_2_NAME),
                    line("Lv. 49", UIRegionSemantic.OPPONENT_2_LEVEL),
                    line("Pikachu", UIRegionSemantic.PLAYER_NAME),
                    line("Lv. 50", UIRegionSemantic.PLAYER_LEVEL),
                    line("Knakrack", UIRegionSemantic.PLAYER_2_NAME),
                    line("Lv. 51", UIRegionSemantic.PLAYER_2_LEVEL),
                ],
            )
        )
        assert [item.canonical_name for item in parsed.opponent_active] == [
            "charizard",
            "venusaur",
        ]
        assert [item.canonical_name for item in parsed.player_active] == [
            "pikachu",
            "garchomp",
        ]
    finally:
        database.close()


def test_opponent_belief_initializes_and_observed_move_updates_posterior(
    tmp_path: Path,
) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        opponent = BattlePokemon(
            canonical_name="charizard",
            level=50,
            types=[PokemonType.FIRE, PokemonType.FLYING],
            base_stats=StatBlock(
                hp=78,
                attack=84,
                defense=78,
                special_attack=109,
                special_defense=85,
                speed=100,
            ),
            hp=HPState(ratio=1, confidence=1),
        )
        model = OpponentBeliefModel(database)
        belief = model.initialize(opponent)
        assert belief.pokemon == "charizard"
        assert belief.moves["flamethrower"].source == "xy_level_up"
        prior = belief.moves["tackle"].probability
        model.observe_move(belief, "Tackle")
        assert "tackle" in belief.revealed_moves
        assert belief.moves["tackle"].probability > prior
        assert belief.moves["tackle"].observed_count == 1
        model.eliminate_move(belief, "flamethrower", "sealed move slot")
        assert belief.moves["flamethrower"].probability == 0
        assert belief.moves["tackle"].probability == 1
        model.observe_speed_order(
            belief,
            player_speed=110,
            opponent_moved_first=True,
        )
        assert belief.speed_min == 111
    finally:
        database.close()


def test_exact_trainer_knowledge_has_highest_priority(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        opponent = BattlePokemon(
            canonical_name="charizard",
            level=50,
            types=[PokemonType.FIRE, PokemonType.FLYING],
        )
        model = OpponentBeliefModel(database, trainer_provider=FakeTrainerKnowledge())
        belief = model.initialize(opponent, trainer_id="ace-1")
        assert belief.trainer_exact
        assert set(belief.moves) == {"flamethrower", "tackle"}
        assert all(move.source == "exact_trainer" for move in belief.moves.values())
        assert belief.abilities["blaze"].probability == 1
    finally:
        database.close()
