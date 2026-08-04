from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import unicodedata
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Protocol

from pydantic import BaseModel, Field

from .models import DamageClass, PokemonType, StatBlock

GENERATION = "generation-vi"
VERSION_GROUP = "x-y"
LANGUAGES = {"de", "en"}

VERSION_GROUP_ORDER = {
    "red-blue": 1,
    "yellow": 2,
    "gold-silver": 3,
    "crystal": 4,
    "ruby-sapphire": 5,
    "emerald": 6,
    "firered-leafgreen": 7,
    "diamond-pearl": 8,
    "platinum": 9,
    "heartgold-soulsilver": 10,
    "black-white": 11,
    "black-2-white-2": 12,
    "x-y": 15,
    "omega-ruby-alpha-sapphire": 16,
    "sun-moon": 17,
    "ultra-sun-ultra-moon": 18,
    "lets-go-pikachu-lets-go-eevee": 19,
    "sword-shield": 20,
    "brilliant-diamond-and-shining-pearl": 23,
    "legends-arceus": 24,
    "scarlet-violet": 25,
}


def normalize_alias(value: str) -> str:
    text = unicodedata.normalize("NFKD", value.casefold())
    text = "".join(character for character in text if not unicodedata.combining(character))
    return re.sub(r"[^a-z0-9]+", "", text)


def _language_names(payload: Mapping[str, Any]) -> dict[str, str]:
    output: dict[str, str] = {}
    for item in payload.get("names", []) or []:
        language = item.get("language", {}).get("name")
        if language in LANGUAGES and item.get("name"):
            output[str(language)] = str(item["name"])
    return output


def _generation_number(name: str) -> int:
    mapping = {
        "generation-i": 1,
        "generation-ii": 2,
        "generation-iii": 3,
        "generation-iv": 4,
        "generation-v": 5,
        "generation-vi": 6,
        "generation-vii": 7,
        "generation-viii": 8,
        "generation-ix": 9,
    }
    return mapping.get(name, 99)


class PokeAPITransport(Protocol):
    def get(self, resource: str) -> dict[str, Any]: ...


class CachedPokeAPIClient:
    """HTTP client with immutable local JSON cache; only the importer owns it."""

    def __init__(
        self,
        cache_dir: str | Path,
        *,
        base_url: str = "https://pokeapi.co/api/v2",
        timeout_seconds: float = 30.0,
    ) -> None:
        import httpx

        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.base_url = base_url.rstrip("/")
        self._http = httpx.Client(timeout=timeout_seconds, follow_redirects=True)

    def get(self, resource: str) -> dict[str, Any]:
        url = resource if resource.startswith("http") else f"{self.base_url}/{resource.lstrip('/')}"
        key = hashlib.sha256(url.encode()).hexdigest()
        path = self.cache_dir / f"{key}.json"
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        response = self._http.get(url)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError(f"PokéAPI returned a non-object for {url}")
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        return payload

    def close(self) -> None:
        self._http.close()


class PokemonRecord(BaseModel):
    id: int
    canonical_name: str
    species_name: str
    form_name: str | None = None
    name_de: str | None = None
    name_en: str | None = None
    types: list[PokemonType]
    base_stats: StatBlock
    abilities: list[str]


class MoveRecord(BaseModel):
    id: int
    canonical_name: str
    name_de: str | None = None
    name_en: str | None = None
    type: PokemonType
    damage_class: DamageClass
    power: int | None = None
    accuracy: int | None = None
    priority: int = 0
    pp: int = 0
    min_hits: int | None = None
    max_hits: int | None = None
    drain_percent: int = 0
    healing_percent: int = 0
    crit_rate: int = 0
    effect_chance: int | None = None
    ailment: str | None = None
    effect: dict[str, Any] = Field(default_factory=dict)


class LearnsetEntry(BaseModel):
    pokemon_name: str
    move_name: str
    method: str
    level: int = 0
    machine: str | None = None


class EntityMatch(BaseModel):
    entity_type: str
    canonical_name: str
    matched_alias: str
    confidence: float = Field(ge=0.0, le=1.0)
    exact: bool = False


KNOWLEDGE_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS knowledge_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pokemon (
    id INTEGER PRIMARY KEY,
    canonical_name TEXT NOT NULL UNIQUE,
    species_name TEXT NOT NULL,
    form_name TEXT,
    name_de TEXT,
    name_en TEXT,
    generation INTEGER NOT NULL,
    is_default INTEGER NOT NULL,
    types_json TEXT NOT NULL,
    base_stats_json TEXT NOT NULL,
    abilities_json TEXT NOT NULL,
    historical_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS abilities (
    id INTEGER PRIMARY KEY,
    canonical_name TEXT NOT NULL UNIQUE,
    name_de TEXT,
    name_en TEXT,
    effect_json TEXT NOT NULL,
    historical_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS moves (
    id INTEGER PRIMARY KEY,
    canonical_name TEXT NOT NULL UNIQUE,
    name_de TEXT,
    name_en TEXT,
    generation INTEGER NOT NULL,
    type TEXT NOT NULL,
    damage_class TEXT NOT NULL,
    power INTEGER,
    accuracy INTEGER,
    priority INTEGER NOT NULL,
    pp INTEGER NOT NULL,
    min_hits INTEGER,
    max_hits INTEGER,
    drain_percent INTEGER NOT NULL,
    healing_percent INTEGER NOT NULL,
    crit_rate INTEGER NOT NULL,
    effect_chance INTEGER,
    ailment TEXT,
    effect_json TEXT NOT NULL,
    historical_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS learnsets (
    pokemon_id INTEGER NOT NULL REFERENCES pokemon(id),
    move_id INTEGER NOT NULL REFERENCES moves(id),
    version_group TEXT NOT NULL CHECK(version_group = 'x-y'),
    method TEXT NOT NULL,
    level INTEGER NOT NULL,
    machine TEXT,
    PRIMARY KEY (pokemon_id, move_id, method, level)
);
CREATE TABLE IF NOT EXISTS machines (
    machine_id INTEGER PRIMARY KEY,
    item_name TEXT NOT NULL,
    move_id INTEGER NOT NULL REFERENCES moves(id),
    version_group TEXT NOT NULL CHECK(version_group = 'x-y')
);
CREATE TABLE IF NOT EXISTS type_efficacy (
    attacking_type TEXT NOT NULL,
    defending_type TEXT NOT NULL,
    multiplier REAL NOT NULL,
    generation INTEGER NOT NULL CHECK(generation = 6),
    PRIMARY KEY (attacking_type, defending_type)
);
CREATE TABLE IF NOT EXISTS aliases (
    entity_type TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    display_alias TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    language TEXT NOT NULL,
    PRIMARY KEY (entity_type, normalized_alias, canonical_name)
);
CREATE INDEX IF NOT EXISTS idx_alias_lookup ON aliases(entity_type, normalized_alias);
CREATE INDEX IF NOT EXISTS idx_learnset_pokemon ON learnsets(pokemon_id, method, level);
"""


class KnowledgeDatabase:
    def __init__(self, path: str | Path, *, read_only: bool = False) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        uri = f"file:{self.path.as_posix()}?mode=ro" if read_only else str(self.path)
        self.connection = sqlite3.connect(uri, uri=read_only, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        if not read_only:
            with self.connection:
                self.connection.execute("PRAGMA journal_mode = WAL")
                self.connection.executescript(KNOWLEDGE_SCHEMA)
                self.connection.executemany(
                    "INSERT OR REPLACE INTO knowledge_meta (key, value) VALUES (?, ?)",
                    (("generation", GENERATION), ("version_group", VERSION_GROUP)),
                )

    def pokemon(self, name: str) -> PokemonRecord | None:
        row = self.connection.execute(
            "SELECT * FROM pokemon WHERE canonical_name = ?", (name,)
        ).fetchone()
        if row is None:
            match = self.resolve_alias(name, "pokemon")
            if match is None:
                return None
            row = self.connection.execute(
                "SELECT * FROM pokemon WHERE canonical_name = ?", (match.canonical_name,)
            ).fetchone()
        assert row is not None
        stats = json.loads(row["base_stats_json"])
        return PokemonRecord(
            id=row["id"],
            canonical_name=row["canonical_name"],
            species_name=row["species_name"],
            form_name=row["form_name"],
            name_de=row["name_de"],
            name_en=row["name_en"],
            types=json.loads(row["types_json"]),
            base_stats=StatBlock(**stats),
            abilities=json.loads(row["abilities_json"]),
        )

    def move(self, name: str) -> MoveRecord | None:
        row = self.connection.execute(
            "SELECT * FROM moves WHERE canonical_name = ?", (name,)
        ).fetchone()
        if row is None:
            match = self.resolve_alias(name, "move")
            if match is None:
                return None
            row = self.connection.execute(
                "SELECT * FROM moves WHERE canonical_name = ?", (match.canonical_name,)
            ).fetchone()
        if row is None:
            return None
        return MoveRecord(
            id=row["id"],
            canonical_name=row["canonical_name"],
            name_de=row["name_de"],
            name_en=row["name_en"],
            type=row["type"],
            damage_class=row["damage_class"],
            power=row["power"],
            accuracy=row["accuracy"],
            priority=row["priority"],
            pp=row["pp"],
            min_hits=row["min_hits"],
            max_hits=row["max_hits"],
            drain_percent=row["drain_percent"],
            healing_percent=row["healing_percent"],
            crit_rate=row["crit_rate"],
            effect_chance=row["effect_chance"],
            ailment=row["ailment"],
            effect=json.loads(row["effect_json"]),
        )

    def learnset(self, pokemon_name: str, *, level: int | None = None) -> list[LearnsetEntry]:
        pokemon = self.pokemon(pokemon_name)
        if pokemon is None:
            return []
        query = """SELECT p.canonical_name pokemon_name, m.canonical_name move_name,
                          l.method, l.level, l.machine
                   FROM learnsets l
                   JOIN pokemon p ON p.id = l.pokemon_id
                   JOIN moves m ON m.id = l.move_id
                   WHERE l.pokemon_id = ?"""
        parameters: list[Any] = [pokemon.id]
        if level is not None:
            query += " AND (l.method != 'level-up' OR l.level <= ?)"
            parameters.append(level)
        query += " ORDER BY l.method, l.level, m.canonical_name"
        return [LearnsetEntry(**dict(row)) for row in self.connection.execute(query, parameters)]

    def resolve_alias(
        self,
        text: str,
        entity_type: str,
        *,
        threshold: float = 0.80,
        uniqueness_margin: float = 0.06,
    ) -> EntityMatch | None:
        normalized = normalize_alias(text)
        if not normalized:
            return None
        exact_rows = self.connection.execute(
            """SELECT display_alias, canonical_name FROM aliases
               WHERE entity_type = ? AND normalized_alias = ?""",
            (entity_type, normalized),
        ).fetchall()
        canonical = {row["canonical_name"] for row in exact_rows}
        if len(canonical) == 1:
            row = exact_rows[0]
            return EntityMatch(
                entity_type=entity_type,
                canonical_name=row["canonical_name"],
                matched_alias=row["display_alias"],
                confidence=1.0,
                exact=True,
            )
        rows = self.connection.execute(
            """SELECT normalized_alias, display_alias, canonical_name FROM aliases
               WHERE entity_type = ?""",
            (entity_type,),
        ).fetchall()
        best_by_entity: dict[str, tuple[float, str]] = {}
        for row in rows:
            score = SequenceMatcher(None, normalized, row["normalized_alias"]).ratio()
            previous = best_by_entity.get(row["canonical_name"])
            if previous is None or score > previous[0]:
                best_by_entity[row["canonical_name"]] = (score, row["display_alias"])
        ranked = sorted(
            (
                (score, canonical_name, alias)
                for canonical_name, (score, alias) in best_by_entity.items()
            ),
            reverse=True,
        )
        if not ranked or ranked[0][0] < threshold:
            return None
        runner_up = ranked[1][0] if len(ranked) > 1 else 0.0
        if ranked[0][0] - runner_up < uniqueness_margin:
            return None
        score, canonical_name, alias = ranked[0]
        return EntityMatch(
            entity_type=entity_type,
            canonical_name=canonical_name,
            matched_alias=alias,
            confidence=score,
        )

    def type_multiplier(self, attacking: str, defending: Iterable[str]) -> float:
        multiplier = 1.0
        for defense in defending:
            row = self.connection.execute(
                """SELECT multiplier FROM type_efficacy
                   WHERE attacking_type = ? AND defending_type = ? AND generation = 6""",
                (attacking, defense),
            ).fetchone()
            multiplier *= float(row[0]) if row else 1.0
        return multiplier

    def close(self) -> None:
        self.connection.close()


@dataclass(slots=True)
class ImportSummary:
    pokemon: int = 0
    moves: int = 0
    abilities: int = 0
    learnsets: int = 0
    machines: int = 0
    type_relations: int = 0


class PokeAPIImporter:
    def __init__(self, database: KnowledgeDatabase, client: PokeAPITransport) -> None:
        self.database = database
        self.client = client

    def import_all(self) -> ImportSummary:
        species_listing = self.client.get("pokemon-species?limit=10000")
        species_payloads: list[dict[str, Any]] = []
        pokemon_payloads: list[dict[str, Any]] = []
        for resource in species_listing.get("results", []):
            species = self.client.get(resource["url"])
            if _generation_number(species.get("generation", {}).get("name", "")) > 6:
                continue
            species_payloads.append(species)
            for variety in species.get("varieties", []):
                pokemon = self.client.get(variety["pokemon"]["url"])
                if self._form_available_in_xy(pokemon):
                    pokemon_payloads.append(pokemon)

        move_urls = {
            move["move"]["url"]
            for pokemon in pokemon_payloads
            for move in pokemon.get("moves", [])
            if any(
                detail.get("version_group", {}).get("name") == VERSION_GROUP
                for detail in move.get("version_group_details", [])
            )
        }
        moves = [self.client.get(url) for url in sorted(move_urls)]
        ability_urls = {
            ability["ability"]["url"]
            for pokemon in pokemon_payloads
            for ability in pokemon.get("abilities", [])
            if ability.get("ability")
        }
        abilities = [self.client.get(url) for url in sorted(ability_urls)]
        type_listing = self.client.get("type?limit=100")
        types = []
        for resource in type_listing.get("results", []):
            payload = self.client.get(resource["url"])
            if payload.get("id", 99) <= 18:
                types.append(payload)
        machines = []
        for move in moves:
            for machine in move.get("machines", []):
                if machine.get("version_group", {}).get("name") == VERSION_GROUP:
                    machines.append(self.client.get(machine["machine"]["url"]))
        return self.import_bundle(
            {
                "species": species_payloads,
                "pokemon": pokemon_payloads,
                "moves": moves,
                "abilities": abilities,
                "types": types,
                "machines": machines,
            }
        )

    def _form_available_in_xy(self, pokemon: Mapping[str, Any]) -> bool:
        forms = pokemon.get("forms", []) or []
        if not forms:
            return bool(pokemon.get("is_default", True))
        try:
            form = self.client.get(forms[0]["url"])
        except (KeyError, ValueError):
            return bool(pokemon.get("is_default", True))
        version_group = form.get("version_group")
        if not version_group:
            return bool(pokemon.get("is_default", True))
        return VERSION_GROUP_ORDER.get(version_group.get("name", ""), 99) <= 15

    def import_bundle(self, bundle: Mapping[str, list[dict[str, Any]]]) -> ImportSummary:
        summary = ImportSummary()
        species_by_name = {item["name"]: item for item in bundle.get("species", [])}
        machine_by_move = {
            item.get("move", {}).get("name"): item for item in bundle.get("machines", [])
        }
        with self.database._lock, self.database.connection:
            for ability in bundle.get("abilities", []):
                self._import_ability(ability)
                summary.abilities += 1
            for move in bundle.get("moves", []):
                if _generation_number(move.get("generation", {}).get("name", "")) <= 6:
                    self._import_move(move)
                    summary.moves += 1
            for pokemon in bundle.get("pokemon", []):
                species_name = pokemon.get("species", {}).get("name", pokemon["name"])
                species = species_by_name.get(species_name, {})
                if (
                    species
                    and _generation_number(species.get("generation", {}).get("name", "")) > 6
                ):
                    continue
                self._import_pokemon(pokemon, species)
                summary.pokemon += 1
                summary.learnsets += self._import_learnset(pokemon, machine_by_move)
            for machine in bundle.get("machines", []):
                if machine.get("version_group", {}).get("name") == VERSION_GROUP:
                    self._import_machine(machine)
                    summary.machines += 1
            for type_payload in bundle.get("types", []):
                summary.type_relations += self._import_type(type_payload)
        return summary

    def _add_aliases(
        self,
        entity_type: str,
        canonical: str,
        names: Mapping[str, str],
    ) -> None:
        values = {"canonical": canonical, **names}
        self.database.connection.executemany(
            """INSERT OR REPLACE INTO aliases
               (entity_type, normalized_alias, display_alias, canonical_name, language)
               VALUES (?, ?, ?, ?, ?)""",
            [
                (entity_type, normalize_alias(alias), alias, canonical, language)
                for language, alias in values.items()
                if alias
            ],
        )

    def _import_ability(self, payload: Mapping[str, Any]) -> None:
        names = _language_names(payload)
        effects = [
            item
            for item in payload.get("effect_entries", []) or []
            if item.get("language", {}).get("name") in LANGUAGES
        ]
        self.database.connection.execute(
            """INSERT OR REPLACE INTO abilities
               (id, canonical_name, name_de, name_en, effect_json, historical_json)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                payload["id"],
                payload["name"],
                names.get("de"),
                names.get("en"),
                json.dumps(effects, ensure_ascii=False),
                json.dumps(payload.get("effect_changes", []), ensure_ascii=False),
            ),
        )
        self._add_aliases("ability", str(payload["name"]), names)

    @staticmethod
    def _gen6_move_values(payload: Mapping[str, Any]) -> dict[str, Any]:
        values = {
            "power": payload.get("power"),
            "accuracy": payload.get("accuracy"),
            "pp": payload.get("pp", 0),
            "type": payload.get("type", {}).get("name"),
        }
        candidates = []
        for past in payload.get("past_values", []) or []:
            name = past.get("version_group", {}).get("name", "")
            order = VERSION_GROUP_ORDER.get(name, 99)
            if order >= VERSION_GROUP_ORDER[VERSION_GROUP]:
                candidates.append((order, past))
        if candidates:
            _, historical = min(candidates, key=lambda item: item[0])
            for key in values:
                if historical.get(key) is not None:
                    raw = historical[key]
                    values[key] = raw.get("name") if isinstance(raw, dict) else raw
        return values

    def _import_move(self, payload: Mapping[str, Any]) -> None:
        names = _language_names(payload)
        values = self._gen6_move_values(payload)
        meta = payload.get("meta") or {}
        effect = {
            "effect_entries": [
                item
                for item in payload.get("effect_entries", []) or []
                if item.get("language", {}).get("name") in LANGUAGES
            ],
            "stat_changes": payload.get("stat_changes", []),
            "target": payload.get("target", {}).get("name"),
            "category": meta.get("category", {}).get("name"),
            "ailment_chance": meta.get("ailment_chance", 0),
            "flinch_chance": meta.get("flinch_chance", 0),
            "stat_chance": meta.get("stat_chance", 0),
        }
        self.database.connection.execute(
            """INSERT OR REPLACE INTO moves
               (id, canonical_name, name_de, name_en, generation, type,
                damage_class, power, accuracy, priority, pp, min_hits, max_hits,
                drain_percent, healing_percent, crit_rate, effect_chance, ailment,
                effect_json, historical_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload["id"],
                payload["name"],
                names.get("de"),
                names.get("en"),
                _generation_number(payload.get("generation", {}).get("name", "")),
                values["type"],
                payload.get("damage_class", {}).get("name", "status"),
                values["power"],
                values["accuracy"],
                payload.get("priority", 0),
                values["pp"],
                meta.get("min_hits"),
                meta.get("max_hits"),
                meta.get("drain", 0),
                meta.get("healing", 0),
                meta.get("crit_rate", 0),
                payload.get("effect_chance"),
                meta.get("ailment", {}).get("name"),
                json.dumps(effect, ensure_ascii=False),
                json.dumps(payload.get("past_values", []), ensure_ascii=False),
            ),
        )
        self._add_aliases("move", str(payload["name"]), names)

    @staticmethod
    def _gen6_pokemon_field(payload: Mapping[str, Any], current_key: str, past_key: str) -> Any:
        current = payload.get(current_key, [])
        candidates = []
        for past in payload.get(past_key, []) or []:
            generation = _generation_number(past.get("generation", {}).get("name", ""))
            if generation > 6:
                candidates.append((generation, past.get(current_key, current)))
        return min(candidates, key=lambda item: item[0])[1] if candidates else current

    def _import_pokemon(self, payload: Mapping[str, Any], species: Mapping[str, Any]) -> None:
        species_names = _language_names(species)
        types_raw = self._gen6_pokemon_field(payload, "types", "past_types")
        stats_raw = self._gen6_pokemon_field(payload, "stats", "past_stats")
        abilities_raw = self._gen6_pokemon_field(payload, "abilities", "past_abilities")
        stats_by_name = {item["stat"]["name"]: item["base_stat"] for item in stats_raw}
        stats = {
            "hp": stats_by_name["hp"],
            "attack": stats_by_name["attack"],
            "defense": stats_by_name["defense"],
            "special_attack": stats_by_name["special-attack"],
            "special_defense": stats_by_name["special-defense"],
            "speed": stats_by_name["speed"],
        }
        types = [item["type"]["name"] for item in sorted(types_raw, key=lambda item: item["slot"])]
        abilities = [item["ability"]["name"] for item in abilities_raw if item.get("ability")]
        species_name = payload.get("species", {}).get("name", payload["name"])
        form_name = None if payload.get("is_default", True) else payload["name"]
        self.database.connection.execute(
            """INSERT OR REPLACE INTO pokemon
               (id, canonical_name, species_name, form_name, name_de, name_en,
                generation, is_default, types_json, base_stats_json, abilities_json,
                historical_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                payload["id"],
                payload["name"],
                species_name,
                form_name,
                species_names.get("de"),
                species_names.get("en"),
                _generation_number(species.get("generation", {}).get("name", GENERATION)),
                int(bool(payload.get("is_default", True))),
                json.dumps(types),
                json.dumps(stats),
                json.dumps(abilities),
                json.dumps(
                    {
                        "past_types": payload.get("past_types", []),
                        "past_stats": payload.get("past_stats", []),
                        "past_abilities": payload.get("past_abilities", []),
                    }
                ),
            ),
        )
        names = {"form": form_name} if form_name else dict(species_names)
        self._add_aliases("pokemon", str(payload["name"]), names)

    def _import_learnset(
        self,
        pokemon: Mapping[str, Any],
        machine_by_move: Mapping[str, Mapping[str, Any]],
    ) -> int:
        count = 0
        for item in pokemon.get("moves", []) or []:
            move_name = item.get("move", {}).get("name")
            move_row = self.database.connection.execute(
                "SELECT id FROM moves WHERE canonical_name = ?", (move_name,)
            ).fetchone()
            if move_row is None:
                continue
            for detail in item.get("version_group_details", []) or []:
                if detail.get("version_group", {}).get("name") != VERSION_GROUP:
                    continue
                method = detail.get("move_learn_method", {}).get("name", "unknown")
                machine = machine_by_move.get(move_name, {}).get("item", {}).get("name")
                self.database.connection.execute(
                    """INSERT OR REPLACE INTO learnsets
                       (pokemon_id, move_id, version_group, method, level, machine)
                       VALUES (?, ?, 'x-y', ?, ?, ?)""",
                    (
                        pokemon["id"],
                        move_row["id"],
                        method,
                        detail.get("level_learned_at", 0),
                        machine if method == "machine" else None,
                    ),
                )
                count += 1
        return count

    def _import_machine(self, payload: Mapping[str, Any]) -> None:
        move_row = self.database.connection.execute(
            "SELECT id FROM moves WHERE canonical_name = ?",
            (payload.get("move", {}).get("name"),),
        ).fetchone()
        if move_row is None:
            return
        self.database.connection.execute(
            """INSERT OR REPLACE INTO machines
               (machine_id, item_name, move_id, version_group)
               VALUES (?, ?, ?, 'x-y')""",
            (payload["id"], payload["item"]["name"], move_row["id"]),
        )

    def _import_type(self, payload: Mapping[str, Any]) -> int:
        attacking = payload["name"]
        relations = payload.get("damage_relations", {})
        values: dict[str, float] = {}
        for key, multiplier in (
            ("double_damage_to", 2.0),
            ("half_damage_to", 0.5),
            ("no_damage_to", 0.0),
        ):
            for item in relations.get(key, []) or []:
                values[item["name"]] = multiplier
        rows = [
            (attacking, defending.value, values.get(defending.value, 1.0), 6)
            for defending in PokemonType
        ]
        self.database.connection.executemany(
            """INSERT OR REPLACE INTO type_efficacy
               (attacking_type, defending_type, multiplier, generation)
               VALUES (?, ?, ?, ?)""",
            rows,
        )
        return len(rows)
