from __future__ import annotations

import math
from collections import defaultdict
from collections.abc import Iterable
from itertools import product
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from .models import (
    BattlePokemon,
    DamageClass,
    MoveState,
    PokemonStatus,
    PokemonType,
    Terrain,
    Weather,
)


class TypeChart(Protocol):
    def type_multiplier(self, attacking: str, defending: Iterable[str]) -> float: ...


# Non-neutral Generation VI matchups. Everything not listed is exactly 1.0.
GEN6_TYPE_CHART: dict[str, dict[str, float]] = {
    "normal": {"rock": 0.5, "ghost": 0.0, "steel": 0.5},
    "fire": {
        "fire": 0.5,
        "water": 0.5,
        "grass": 2,
        "ice": 2,
        "bug": 2,
        "rock": 0.5,
        "dragon": 0.5,
        "steel": 2,
    },
    "water": {"fire": 2, "water": 0.5, "grass": 0.5, "ground": 2, "rock": 2, "dragon": 0.5},
    "electric": {
        "water": 2,
        "electric": 0.5,
        "grass": 0.5,
        "ground": 0,
        "flying": 2,
        "dragon": 0.5,
    },
    "grass": {
        "fire": 0.5,
        "water": 2,
        "grass": 0.5,
        "poison": 0.5,
        "ground": 2,
        "flying": 0.5,
        "bug": 0.5,
        "rock": 2,
        "dragon": 0.5,
        "steel": 0.5,
    },
    "ice": {
        "fire": 0.5,
        "water": 0.5,
        "grass": 2,
        "ice": 0.5,
        "ground": 2,
        "flying": 2,
        "dragon": 2,
        "steel": 0.5,
    },
    "fighting": {
        "normal": 2,
        "ice": 2,
        "poison": 0.5,
        "flying": 0.5,
        "psychic": 0.5,
        "bug": 0.5,
        "rock": 2,
        "ghost": 0,
        "dark": 2,
        "steel": 2,
        "fairy": 0.5,
    },
    "poison": {
        "grass": 2,
        "poison": 0.5,
        "ground": 0.5,
        "rock": 0.5,
        "ghost": 0.5,
        "steel": 0,
        "fairy": 2,
    },
    "ground": {
        "fire": 2,
        "electric": 2,
        "grass": 0.5,
        "poison": 2,
        "flying": 0,
        "bug": 0.5,
        "rock": 2,
        "steel": 2,
    },
    "flying": {"electric": 0.5, "grass": 2, "fighting": 2, "bug": 2, "rock": 0.5, "steel": 0.5},
    "psychic": {"fighting": 2, "poison": 2, "psychic": 0.5, "dark": 0, "steel": 0.5},
    "bug": {
        "fire": 0.5,
        "grass": 2,
        "fighting": 0.5,
        "poison": 0.5,
        "flying": 0.5,
        "psychic": 2,
        "ghost": 0.5,
        "dark": 2,
        "steel": 0.5,
        "fairy": 0.5,
    },
    "rock": {
        "fire": 2,
        "ice": 2,
        "fighting": 0.5,
        "ground": 0.5,
        "flying": 2,
        "bug": 2,
        "steel": 0.5,
    },
    "ghost": {"normal": 0, "psychic": 2, "ghost": 2, "dark": 0.5},
    "dragon": {"dragon": 2, "steel": 0.5, "fairy": 0},
    "dark": {"fighting": 0.5, "psychic": 2, "ghost": 2, "dark": 0.5, "fairy": 0.5},
    "steel": {
        "fire": 0.5,
        "water": 0.5,
        "electric": 0.5,
        "ice": 2,
        "rock": 2,
        "steel": 0.5,
        "fairy": 2,
    },
    "fairy": {"fire": 0.5, "fighting": 2, "poison": 0.5, "dragon": 2, "dark": 2, "steel": 0.5},
}


class StaticGen6TypeChart:
    def type_multiplier(self, attacking: str, defending: Iterable[str]) -> float:
        return math.prod(
            GEN6_TYPE_CHART.get(attacking, {}).get(defending_type, 1.0)
            for defending_type in defending
        )


class DamageField(BaseModel):
    weather: Weather = Weather.NONE
    terrain: Terrain = Terrain.NONE
    is_double_battle: bool = False
    targets_multiple: bool = False
    reflect: bool = False
    light_screen: bool = False


class DamageRequest(BaseModel):
    generation: Literal[6] = 6
    attacker: BattlePokemon
    defender: BattlePokemon
    move: MoveState
    field: DamageField = Field(default_factory=DamageField)


class DamageOutcome(BaseModel):
    damage: int = Field(ge=0)
    probability: float = Field(ge=0.0, le=1.0)


class DamageDistribution(BaseModel):
    generation: Literal[6] = 6
    move: str
    type_multiplier: float = Field(ge=0.0)
    stab: float = Field(ge=1.0)
    accuracy_probability: float = Field(ge=0.0, le=1.0)
    critical_probability: float = Field(ge=0.0, le=1.0)
    minimum: int = Field(ge=0)
    maximum: int = Field(ge=0)
    expected: float = Field(ge=0.0)
    ko_probability: float = Field(ge=0.0, le=1.0)
    recoil_expected: float = Field(ge=0.0)
    healing_expected: float = Field(ge=0.0)
    outcomes: list[DamageOutcome] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)


def _stage_multiplier(stage: int) -> float:
    return (2 + stage) / 2 if stage >= 0 else 2 / (2 - stage)


def _accuracy_multiplier(stage: int) -> float:
    return (3 + stage) / 3 if stage >= 0 else 3 / (3 - stage)


def _calculated_stat(base: int, level: int, iv: int, ev: int, nature: float) -> int:
    raw = math.floor((2 * base + iv + math.floor(ev / 4)) * level / 100) + 5
    return max(1, math.floor(raw * nature))


def _calculated_hp(base: int, level: int, iv: int, ev: int) -> int:
    return math.floor((2 * base + iv + math.floor(ev / 4)) * level / 100) + level + 10


def _stat_samples(pokemon: BattlePokemon, stat_name: str) -> list[int]:
    if pokemon.estimated_stats is not None:
        return [int(getattr(pokemon.estimated_stats, stat_name))]
    if pokemon.base_stats is None:
        return [max(1, pokemon.level * 2)]
    base = int(getattr(pokemon.base_stats, stat_name))
    samples = {
        _calculated_stat(base, pokemon.level, iv, ev, nature)
        for iv, ev, nature in ((0, 0, 0.9), (15, 84, 1.0), (31, 252, 1.1))
    }
    return sorted(samples)


def _max_hp_samples(pokemon: BattlePokemon) -> list[int]:
    if pokemon.hp.maximum is not None:
        return [pokemon.hp.maximum]
    if pokemon.estimated_stats is not None:
        return [pokemon.estimated_stats.hp]
    if pokemon.base_stats is None:
        return [max(1, pokemon.level * 3)]
    return sorted(
        {
            _calculated_hp(pokemon.base_stats.hp, pokemon.level, iv, ev)
            for iv, ev in ((0, 0), (15, 84), (31, 252))
        }
    )


def _ability_candidates(pokemon: BattlePokemon) -> list[str | None]:
    if pokemon.ability:
        return [pokemon.ability]
    return list(pokemon.possible_abilities) or [None]


def _critical_probability(stage: int) -> float:
    # Generation VI critical-hit table.
    return (1 / 16, 1 / 8, 1 / 2, 1.0)[min(max(stage, 0), 3)]


def _hit_count_distribution(
    move: MoveState, attacker_ability: str | None
) -> list[tuple[int, float]]:
    if not move.min_hits or not move.max_hits or move.min_hits == move.max_hits:
        return [(move.min_hits or 1, 1.0)]
    if attacker_ability == "skill-link":
        return [(move.max_hits, 1.0)]
    if move.min_hits == 2 and move.max_hits == 5:
        return [(2, 3 / 8), (3, 3 / 8), (4, 1 / 8), (5, 1 / 8)]
    count = move.max_hits - move.min_hits + 1
    return [(hits, 1 / count) for hits in range(move.min_hits, move.max_hits + 1)]


class Gen6DamageCalculator:
    def __init__(self, type_chart: TypeChart | None = None) -> None:
        self.type_chart = type_chart or StaticGen6TypeChart()

    def calculate(self, request: DamageRequest) -> DamageDistribution:
        move = request.move
        if move.damage_class == DamageClass.STATUS or not move.power:
            return DamageDistribution(
                move=move.canonical_name,
                type_multiplier=1.0,
                stab=1.0,
                accuracy_probability=self._accuracy(request),
                critical_probability=0.0,
                minimum=0,
                maximum=0,
                expected=0,
                ko_probability=0,
                recoil_expected=0,
                healing_expected=move.healing_percent / 100,
                outcomes=[DamageOutcome(damage=0, probability=1.0)],
                notes=["Status move: no direct base damage."],
            )

        attacker = request.attacker
        defender = request.defender
        attack_stat_name = (
            "attack" if move.damage_class == DamageClass.PHYSICAL else "special_attack"
        )
        defense_stat_name = (
            "defense" if move.damage_class == DamageClass.PHYSICAL else "special_defense"
        )
        attack_samples = _stat_samples(attacker, attack_stat_name)
        defense_samples = _stat_samples(defender, defense_stat_name)
        max_hp_samples = _max_hp_samples(defender)
        attacker_abilities = _ability_candidates(attacker)
        defender_abilities = _ability_candidates(defender)
        base_type_multiplier = self.type_chart.type_multiplier(
            move.type.value, [type_.value for type_ in defender.types]
        )
        hit_probability = self._accuracy(request)
        critical_probability = _critical_probability(move.crit_rate)
        outcomes: defaultdict[int, float] = defaultdict(float)
        notes: set[str] = set()
        combinations = list(
            product(
                attack_samples,
                defense_samples,
                max_hp_samples,
                attacker_abilities,
                defender_abilities,
            )
        )
        combination_probability = 1 / len(combinations)
        outcomes[0] += 1 - hit_probability

        observed_stab = 1.0
        observed_multiplier = base_type_multiplier
        for attack, defense, _, attacker_ability, defender_ability in combinations:
            type_multiplier, ability_notes = self._ability_type_modifier(
                move.type, base_type_multiplier, attacker_ability, defender_ability
            )
            notes.update(ability_notes)
            stab = self._stab(attacker, move.type, attacker_ability)
            observed_stab = max(observed_stab, stab)
            observed_multiplier = max(observed_multiplier, type_multiplier)
            hit_counts = _hit_count_distribution(move, attacker_ability)
            for critical, critical_weight in (
                (False, 1 - critical_probability),
                (True, critical_probability),
            ):
                if critical_weight == 0:
                    continue
                staged_attack, staged_defense = self._apply_stages(
                    request, attack, defense, critical
                )
                base_damage = (
                    math.floor(
                        math.floor(
                            math.floor((2 * attacker.level / 5) + 2)
                            * move.power
                            * staged_attack
                            / max(staged_defense, 1)
                        )
                        / 50
                    )
                    + 2
                )
                fixed_modifier = self._fixed_modifier(
                    request,
                    stab,
                    type_multiplier,
                    attacker_ability,
                    defender_ability,
                    critical,
                    notes,
                )
                for hits, hits_weight in hit_counts:
                    for random_roll in range(85, 101):
                        damage = max(
                            1 if type_multiplier > 0 else 0,
                            math.floor(base_damage * fixed_modifier * random_roll / 100) * hits,
                        )
                        probability = (
                            hit_probability
                            * combination_probability
                            * critical_weight
                            * hits_weight
                            / 16
                        )
                        outcomes[damage] += probability

        total = sum(outcomes.values())
        if total <= 0:
            outcomes = defaultdict(float, {0: 1.0})
            total = 1.0
        normalized = sorted(
            (damage, probability / total) for damage, probability in outcomes.items()
        )
        positive = [damage for damage, _ in normalized if damage > 0]
        expected = sum(damage * probability for damage, probability in normalized)
        defender_hp_values = [
            defender.hp.current
            if defender.hp.current is not None
            else max(1, round(maximum * defender.hp.ratio))
            for maximum in max_hp_samples
        ]
        ko_probability = sum(
            probability * sum(damage >= hp for hp in defender_hp_values) / len(defender_hp_values)
            for damage, probability in normalized
        )
        recoil = expected * max(0, -move.drain_percent) / 100
        healing = expected * max(0, move.drain_percent) / 100
        return DamageDistribution(
            move=move.canonical_name,
            type_multiplier=observed_multiplier,
            stab=observed_stab,
            accuracy_probability=hit_probability,
            critical_probability=critical_probability,
            minimum=min(positive, default=0),
            maximum=max(positive, default=0),
            expected=expected,
            ko_probability=min(1.0, max(0.0, ko_probability)),
            recoil_expected=recoil,
            healing_expected=healing,
            outcomes=[
                DamageOutcome(damage=damage, probability=probability)
                for damage, probability in normalized
            ],
            notes=sorted(notes),
        )

    @staticmethod
    def _accuracy(request: DamageRequest) -> float:
        if request.move.accuracy is None:
            return 1.0
        stage = request.attacker.stat_stages.accuracy - request.defender.stat_stages.evasion
        return min(1.0, max(0.0, request.move.accuracy / 100 * _accuracy_multiplier(stage)))

    @staticmethod
    def _apply_stages(
        request: DamageRequest,
        attack: int,
        defense: int,
        critical: bool,
    ) -> tuple[int, int]:
        physical = request.move.damage_class == DamageClass.PHYSICAL
        attack_stage = (
            request.attacker.stat_stages.attack
            if physical
            else request.attacker.stat_stages.special_attack
        )
        defense_stage = (
            request.defender.stat_stages.defense
            if physical
            else request.defender.stat_stages.special_defense
        )
        if critical:
            attack_stage = max(0, attack_stage)
            defense_stage = min(0, defense_stage)
        return (
            max(1, math.floor(attack * _stage_multiplier(attack_stage))),
            max(1, math.floor(defense * _stage_multiplier(defense_stage))),
        )

    @staticmethod
    def _stab(
        attacker: BattlePokemon,
        move_type: PokemonType,
        ability: str | None,
    ) -> float:
        if move_type not in attacker.types:
            return 1.0
        return 2.0 if ability == "adaptability" else 1.5

    @staticmethod
    def _ability_type_modifier(
        move_type: PokemonType,
        multiplier: float,
        attacker_ability: str | None,
        defender_ability: str | None,
    ) -> tuple[float, list[str]]:
        notes: list[str] = []
        immunities = {
            "levitate": PokemonType.GROUND,
            "flash-fire": PokemonType.FIRE,
            "water-absorb": PokemonType.WATER,
            "storm-drain": PokemonType.WATER,
            "volt-absorb": PokemonType.ELECTRIC,
            "lightning-rod": PokemonType.ELECTRIC,
            "motor-drive": PokemonType.ELECTRIC,
        }
        if defender_ability in immunities and immunities[defender_ability] == move_type:
            notes.append(f"{defender_ability} grants immunity")
            return 0.0, notes
        if defender_ability == "thick-fat" and move_type in {PokemonType.FIRE, PokemonType.ICE}:
            multiplier *= 0.5
            notes.append("thick-fat modifier")
        if defender_ability in {"filter", "solid-rock"} and multiplier > 1:
            multiplier *= 0.75
            notes.append(f"{defender_ability} super-effective reduction")
        if attacker_ability == "tinted-lens" and 0 < multiplier < 1:
            multiplier *= 2
            notes.append("tinted-lens resisted-hit modifier")
        return multiplier, notes

    @staticmethod
    def _fixed_modifier(
        request: DamageRequest,
        stab: float,
        type_multiplier: float,
        attacker_ability: str | None,
        defender_ability: str | None,
        critical: bool,
        notes: set[str],
    ) -> float:
        move = request.move
        modifier = stab * type_multiplier
        if critical:
            modifier *= 1.5
            if attacker_ability == "sniper":
                modifier *= 1.5
        if (
            move.damage_class == DamageClass.PHYSICAL
            and request.attacker.status == PokemonStatus.BURN
            and attacker_ability != "guts"
        ):
            modifier *= 0.5
            notes.add("burn halves physical damage in Generation VI")
        if request.field.weather in {Weather.SUN, Weather.HARSH_SUN}:
            if move.type == PokemonType.FIRE:
                modifier *= 1.5
            elif move.type == PokemonType.WATER:
                modifier *= 0.5
        elif request.field.weather in {Weather.RAIN, Weather.HEAVY_RAIN}:
            if move.type == PokemonType.WATER:
                modifier *= 1.5
            elif move.type == PokemonType.FIRE:
                modifier *= 0.5
        if request.field.is_double_battle and request.field.targets_multiple:
            modifier *= 0.75
            notes.add("Generation VI spread-move modifier")
        if request.field.reflect and move.damage_class == DamageClass.PHYSICAL and not critical:
            modifier *= 0.5
        if request.field.light_screen and move.damage_class == DamageClass.SPECIAL and not critical:
            modifier *= 0.5
        defender_grounded = (
            PokemonType.FLYING not in request.defender.types and defender_ability != "levitate"
        )
        attacker_grounded = (
            PokemonType.FLYING not in request.attacker.types and attacker_ability != "levitate"
        )
        if attacker_grounded:
            if request.field.terrain == Terrain.ELECTRIC and move.type == PokemonType.ELECTRIC:
                modifier *= 1.5
            if request.field.terrain == Terrain.GRASSY and move.type == PokemonType.GRASS:
                modifier *= 1.5
        if (
            defender_grounded
            and request.field.terrain == Terrain.MISTY
            and move.type == PokemonType.DRAGON
        ):
            modifier *= 0.5
        return modifier
