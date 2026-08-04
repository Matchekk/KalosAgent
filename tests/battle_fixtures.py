from __future__ import annotations

from pathlib import Path
from typing import Any

from kalos_agent.battle.knowledge import KnowledgeDatabase, PokeAPIImporter


class FakePokeAPIClient:
    def __init__(self, resources: dict[str, dict[str, Any]] | None = None) -> None:
        self.resources = resources or {}
        self.calls: list[str] = []

    def get(self, resource: str) -> dict[str, Any]:
        self.calls.append(resource)
        return self.resources[resource]


def _names(de: str, en: str) -> list[dict[str, Any]]:
    return [
        {"name": de, "language": {"name": "de"}},
        {"name": en, "language": {"name": "en"}},
    ]


def _stats(
    hp: int, attack: int, defense: int, spa: int, spd: int, speed: int
) -> list[dict[str, Any]]:
    values = {
        "hp": hp,
        "attack": attack,
        "defense": defense,
        "special-attack": spa,
        "special-defense": spd,
        "speed": speed,
    }
    return [{"base_stat": value, "stat": {"name": name}} for name, value in values.items()]


def _move(
    id_: int,
    canonical: str,
    de: str,
    en: str,
    type_: str,
    damage_class: str,
    power: int | None,
    *,
    accuracy: int = 100,
    pp: int = 15,
    priority: int = 0,
    min_hits: int | None = None,
    max_hits: int | None = None,
    drain: int = 0,
    past_values: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "id": id_,
        "name": canonical,
        "names": _names(de, en),
        "generation": {"name": "generation-i"},
        "type": {"name": type_},
        "damage_class": {"name": damage_class},
        "power": power,
        "accuracy": accuracy,
        "pp": pp,
        "priority": priority,
        "effect_chance": None,
        "effect_entries": [],
        "stat_changes": [],
        "past_values": past_values or [],
        "meta": {
            "min_hits": min_hits,
            "max_hits": max_hits,
            "drain": drain,
            "healing": 0,
            "crit_rate": 0,
            "ailment": {"name": "none"},
            "category": {"name": "damage"},
        },
    }


def fixture_bundle() -> dict[str, list[dict[str, Any]]]:
    species = [
        {
            "id": 6,
            "name": "charizard",
            "names": _names("Glurak", "Charizard"),
            "generation": {"name": "generation-i"},
        },
        {
            "id": 3,
            "name": "venusaur",
            "names": _names("Bisaflor", "Venusaur"),
            "generation": {"name": "generation-i"},
        },
        {
            "id": 25,
            "name": "pikachu",
            "names": _names("Pikachu", "Pikachu"),
            "generation": {"name": "generation-i"},
        },
        {
            "id": 445,
            "name": "garchomp",
            "names": _names("Knakrack", "Garchomp"),
            "generation": {"name": "generation-iv"},
        },
    ]
    moves = [
        _move(53, "flamethrower", "Flammenwurf", "Flamethrower", "fire", "special", 90),
        _move(85, "thunderbolt", "Donnerblitz", "Thunderbolt", "electric", "special", 90),
        _move(33, "tackle", "Tackle", "Tackle", "normal", "physical", 50, pp=35),
        _move(
            31,
            "furyswipes",
            "Kratzfurie",
            "Fury Swipes",
            "normal",
            "physical",
            18,
            min_hits=2,
            max_hits=5,
            pp=15,
        ),
        _move(
            389,
            "sucker-punch",
            "Tiefschlag",
            "Sucker Punch",
            "dark",
            "physical",
            70,
            past_values=[{"power": 80, "version_group": {"name": "sun-moon"}}],
        ),
    ]
    abilities = [
        {
            "id": 66,
            "name": "blaze",
            "names": _names("Großbrand", "Blaze"),
            "effect_entries": [],
            "effect_changes": [],
        },
        {
            "id": 65,
            "name": "overgrow",
            "names": _names("Notdünger", "Overgrow"),
            "effect_entries": [],
            "effect_changes": [],
        },
        {
            "id": 9,
            "name": "static",
            "names": _names("Statik", "Static"),
            "effect_entries": [],
            "effect_changes": [],
        },
        {
            "id": 8,
            "name": "sand-veil",
            "names": _names("Sandschleier", "Sand Veil"),
            "effect_entries": [],
            "effect_changes": [],
        },
    ]

    def pokemon(
        id_: int,
        name: str,
        types: list[str],
        stats: list[dict[str, Any]],
        ability: str,
        learnset: list[tuple[str, str, int]],
    ) -> dict[str, Any]:
        return {
            "id": id_,
            "name": name,
            "species": {"name": name},
            "is_default": True,
            "types": [
                {"slot": index, "type": {"name": type_}} for index, type_ in enumerate(types, 1)
            ],
            "stats": stats,
            "abilities": [{"slot": 1, "ability": {"name": ability}}],
            "past_types": [],
            "past_stats": [],
            "past_abilities": [],
            "moves": [
                {
                    "move": {"name": move_name},
                    "version_group_details": [
                        {
                            "version_group": {"name": "x-y"},
                            "move_learn_method": {"name": method},
                            "level_learned_at": level,
                        },
                        {
                            "version_group": {"name": "omega-ruby-alpha-sapphire"},
                            "move_learn_method": {"name": "level-up"},
                            "level_learned_at": 1,
                        },
                    ],
                }
                for move_name, method, level in learnset
            ],
        }

    pokemon_payloads = [
        pokemon(
            6,
            "charizard",
            ["fire", "flying"],
            _stats(78, 84, 78, 109, 85, 100),
            "blaze",
            [("flamethrower", "level-up", 47), ("tackle", "egg", 1)],
        ),
        pokemon(
            3,
            "venusaur",
            ["grass", "poison"],
            _stats(80, 82, 83, 100, 100, 80),
            "overgrow",
            [("tackle", "level-up", 1)],
        ),
        pokemon(
            25,
            "pikachu",
            ["electric"],
            _stats(35, 55, 40, 50, 50, 90),
            "static",
            [("thunderbolt", "machine", 0)],
        ),
        pokemon(
            445,
            "garchomp",
            ["dragon", "ground"],
            _stats(108, 130, 95, 80, 85, 102),
            "sand-veil",
            [("tackle", "level-up", 1), ("sucker-punch", "egg", 1)],
        ),
    ]
    type_payloads = [
        {
            "id": 10,
            "name": "fire",
            "damage_relations": {
                "double_damage_to": [
                    {"name": "grass"},
                    {"name": "ice"},
                    {"name": "bug"},
                    {"name": "steel"},
                ],
                "half_damage_to": [
                    {"name": "fire"},
                    {"name": "water"},
                    {"name": "rock"},
                    {"name": "dragon"},
                ],
                "no_damage_to": [],
            },
        },
        {
            "id": 13,
            "name": "electric",
            "damage_relations": {
                "double_damage_to": [{"name": "water"}, {"name": "flying"}],
                "half_damage_to": [{"name": "electric"}, {"name": "grass"}, {"name": "dragon"}],
                "no_damage_to": [{"name": "ground"}],
            },
        },
    ]
    return {
        "species": species,
        "pokemon": pokemon_payloads,
        "moves": moves,
        "abilities": abilities,
        "types": type_payloads,
        "machines": [],
    }


def build_knowledge_database(path: Path) -> KnowledgeDatabase:
    database = KnowledgeDatabase(path)
    PokeAPIImporter(database, FakePokeAPIClient()).import_bundle(fixture_bundle())
    return database
