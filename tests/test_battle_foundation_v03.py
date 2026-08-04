from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from kalos_agent.battle.damage import (
    DamageField,
    DamageRequest,
    Gen6DamageCalculator,
    StaticGen6TypeChart,
)
from kalos_agent.battle.knowledge import PokeAPIImporter
from kalos_agent.battle.models import (
    BattlePokemon,
    BattleState,
    DamageClass,
    HPState,
    MoveState,
    PokemonStatus,
    PokemonType,
    StatBlock,
    Weather,
)
from kalos_agent.layout import UILayoutKind, UILayoutRegistry, UIRegionSemantic
from kalos_agent.models import GameState, Scene
from tests.battle_fixtures import FakePokeAPIClient, build_knowledge_database, fixture_bundle


def pokemon(
    name: str,
    types: list[PokemonType],
    stats: StatBlock,
    *,
    level: int = 50,
    status: PokemonStatus = PokemonStatus.NONE,
) -> BattlePokemon:
    return BattlePokemon(
        canonical_name=name,
        level=level,
        types=types,
        base_stats=stats,
        estimated_stats=stats,
        hp=HPState(current=stats.hp, maximum=stats.hp, confidence=1),
        status=status,
    )


def test_layout_registry_assigns_scene_specific_semantics() -> None:
    registry = UILayoutRegistry()
    state = GameState(frame_id="battle", scene=Scene.BATTLE_MOVE_MENU)
    kind = registry.resolve_kind(state, battle_type="trainer_double")
    assert kind == UILayoutKind.DOUBLE_MOVE_SELECT
    semantics = {region.semantic for region in registry.regions(kind)}
    assert UIRegionSemantic.OPPONENT_2_NAME in semantics
    assert {
        UIRegionSemantic.MOVE_SLOT_1,
        UIRegionSemantic.MOVE_SLOT_2,
        UIRegionSemantic.MOVE_SLOT_3,
        UIRegionSemantic.MOVE_SLOT_4,
    } <= semantics
    assert all(region.rect.normalized for region in registry.regions(kind))


def test_pokeapi_import_is_gen6_xy_local_and_maps_german_aliases(tmp_path: Path) -> None:
    database = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    try:
        glurak = database.resolve_alias("Glurak", "pokemon")
        fuzzy = database.resolve_alias("Glurax", "pokemon")
        move = database.resolve_alias("Flammenwurf", "move")
        assert glurak and glurak.canonical_name == "charizard" and glurak.exact
        assert fuzzy and fuzzy.canonical_name == "charizard" and not fuzzy.exact
        assert move and move.canonical_name == "flamethrower"
        assert database.move("sucker-punch").power == 80  # historical Gen-VI value
        learnset = database.learnset("charizard", level=50)
        assert {(entry.move_name, entry.method) for entry in learnset} == {
            ("flamethrower", "level-up"),
            ("tackle", "egg"),
        }
        assert database.type_multiplier("fire", ["grass", "poison"]) == 2
        meta = dict(database.connection.execute("SELECT key, value FROM knowledge_meta"))
        assert meta == {"generation": "generation-vi", "version_group": "x-y"}
    finally:
        database.close()


def test_importer_discards_post_gen6_species(tmp_path: Path) -> None:
    bundle = fixture_bundle()
    bundle["species"].append(
        {
            "id": 722,
            "name": "rowlet",
            "names": [],
            "generation": {"name": "generation-vii"},
        }
    )
    bundle["pokemon"].append(
        {
            "id": 722,
            "name": "rowlet",
            "species": {"name": "rowlet"},
            "is_default": True,
            "types": [{"slot": 1, "type": {"name": "grass"}}],
            "stats": [
                {"base_stat": value, "stat": {"name": name}}
                for name, value in {
                    "hp": 68,
                    "attack": 55,
                    "defense": 55,
                    "special-attack": 50,
                    "special-defense": 50,
                    "speed": 42,
                }.items()
            ],
            "abilities": [],
            "moves": [],
        }
    )
    database = build_knowledge_database(tmp_path / "first.sqlite3")
    database.close()
    from kalos_agent.battle.knowledge import KnowledgeDatabase

    database = KnowledgeDatabase(tmp_path / "filtered.sqlite3")
    try:
        PokeAPIImporter(database, FakePokeAPIClient()).import_bundle(bundle)
        assert database.pokemon("rowlet") is None
    finally:
        database.close()


def test_battle_state_cannot_leave_generation_six() -> None:
    BattleState(battle_id="valid")
    with pytest.raises(ValidationError):
        BattleState(battle_id="invalid", generation=7)  # type: ignore[arg-type]


def test_gen6_damage_uses_stab_effectiveness_accuracy_and_criticals() -> None:
    attacker = pokemon(
        "charizard",
        [PokemonType.FIRE, PokemonType.FLYING],
        StatBlock(
            hp=153, attack=104, defense=98, special_attack=129, special_defense=105, speed=120
        ),
    )
    defender = pokemon(
        "venusaur",
        [PokemonType.GRASS, PokemonType.POISON],
        StatBlock(
            hp=155, attack=102, defense=103, special_attack=120, special_defense=120, speed=100
        ),
    )
    move = MoveState(
        canonical_name="flamethrower",
        type=PokemonType.FIRE,
        damage_class=DamageClass.SPECIAL,
        power=90,
        accuracy=100,
        pp=15,
        max_pp=15,
    )
    result = Gen6DamageCalculator().calculate(
        DamageRequest(attacker=attacker, defender=defender, move=move)
    )
    assert result.type_multiplier == 2
    assert result.stab == 1.5
    assert result.accuracy_probability == 1
    assert result.critical_probability == pytest.approx(1 / 16)
    assert result.minimum > 0 and result.maximum > result.minimum
    assert result.expected > result.minimum


def test_gen6_damage_handles_immunity_burn_weather_and_unknown_stats() -> None:
    calculator = Gen6DamageCalculator(StaticGen6TypeChart())
    pikachu = pokemon(
        "pikachu",
        [PokemonType.ELECTRIC],
        StatBlock(hp=110, attack=75, defense=60, special_attack=70, special_defense=70, speed=110),
    )
    garchomp = pokemon(
        "garchomp",
        [PokemonType.DRAGON, PokemonType.GROUND],
        StatBlock(
            hp=183, attack=150, defense=115, special_attack=100, special_defense=105, speed=122
        ),
    )
    thunderbolt = MoveState(
        canonical_name="thunderbolt",
        type=PokemonType.ELECTRIC,
        damage_class=DamageClass.SPECIAL,
        power=90,
        accuracy=100,
    )
    immune = calculator.calculate(
        DamageRequest(attacker=pikachu, defender=garchomp, move=thunderbolt)
    )
    assert immune.type_multiplier == 0
    assert immune.maximum == 0

    burned = pokemon(
        "garchomp",
        [PokemonType.DRAGON, PokemonType.GROUND],
        StatBlock(
            hp=183, attack=150, defense=115, special_attack=100, special_defense=105, speed=122
        ),
        status=PokemonStatus.BURN,
    )
    tackle = MoveState(
        canonical_name="tackle",
        type=PokemonType.NORMAL,
        damage_class=DamageClass.PHYSICAL,
        power=50,
        accuracy=100,
    )
    normal = calculator.calculate(DamageRequest(attacker=garchomp, defender=pikachu, move=tackle))
    reduced = calculator.calculate(
        DamageRequest(
            attacker=burned,
            defender=pikachu,
            move=tackle,
            field=DamageField(weather=Weather.SAND),
        )
    )
    assert reduced.expected < normal.expected * 0.55

    uncertain = BattlePokemon(
        canonical_name="unknown-garchomp",
        level=50,
        types=[PokemonType.DRAGON, PokemonType.GROUND],
        base_stats=StatBlock(
            hp=108, attack=130, defense=95, special_attack=80, special_defense=85, speed=102
        ),
    )
    distribution = calculator.calculate(
        DamageRequest(attacker=uncertain, defender=pikachu, move=tackle)
    )
    assert distribution.maximum > distribution.minimum
    assert len(distribution.outcomes) > 16
