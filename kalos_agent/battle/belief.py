from __future__ import annotations

import math
from typing import Protocol

from pydantic import BaseModel, Field

from .damage import DamageField, DamageRequest, Gen6DamageCalculator
from .knowledge import KnowledgeDatabase
from .models import BattlePokemon, MoveState


class TrainerPokemonKnowledge(BaseModel):
    pokemon: str
    level: int
    moves: list[str] = Field(default_factory=list, max_length=4)
    ability: str | None = None
    item: str | None = None


class TrainerKnowledgeProvider(Protocol):
    def exact_pokemon(
        self,
        trainer_id: str,
        pokemon: str,
        level: int,
    ) -> TrainerPokemonKnowledge | None: ...


class NullTrainerKnowledgeProvider:
    def exact_pokemon(
        self,
        trainer_id: str,
        pokemon: str,
        level: int,
    ) -> TrainerPokemonKnowledge | None:
        return None


class MoveBelief(BaseModel):
    move: str
    probability: float = Field(ge=0.0, le=1.0)
    source: str
    observed_count: int = Field(default=0, ge=0)
    impossible: bool = False


class AbilityBelief(BaseModel):
    ability: str
    probability: float = Field(ge=0.0, le=1.0)
    source: str = "species"
    impossible: bool = False


class OpponentBeliefState(BaseModel):
    pokemon: str
    form: str | None = None
    level: int
    types: list[str]
    base_stats: dict[str, int]
    moves: dict[str, MoveBelief] = Field(default_factory=dict)
    abilities: dict[str, AbilityBelief] = Field(default_factory=dict)
    revealed_moves: list[str] = Field(default_factory=list)
    speed_min: int | None = None
    speed_max: int | None = None
    trainer_exact: bool = False
    observations: int = Field(default=0, ge=0)
    uncertainty: float = Field(default=1.0, ge=0.0, le=1.0)


class OpponentBeliefModel:
    def __init__(
        self,
        knowledge: KnowledgeDatabase,
        *,
        trainer_provider: TrainerKnowledgeProvider | None = None,
        damage_calculator: Gen6DamageCalculator | None = None,
    ) -> None:
        self.knowledge = knowledge
        self.trainer_provider = trainer_provider or NullTrainerKnowledgeProvider()
        self.damage_calculator = damage_calculator or Gen6DamageCalculator(knowledge)

    def initialize(
        self,
        opponent: BattlePokemon,
        *,
        trainer_id: str | None = None,
    ) -> OpponentBeliefState:
        record = self.knowledge.pokemon(opponent.canonical_name)
        if record is None:
            raise ValueError(f"Unknown Generation-VI Pokémon: {opponent.canonical_name}")
        exact = (
            self.trainer_provider.exact_pokemon(trainer_id, opponent.canonical_name, opponent.level)
            if trainer_id
            else None
        )
        move_weights: dict[str, tuple[float, str]] = {}
        if exact and exact.moves:
            move_weights = {move: (10.0, "exact_trainer") for move in exact.moves}
        else:
            for entry in self.knowledge.learnset(opponent.canonical_name, level=opponent.level):
                move = self.knowledge.move(entry.move_name)
                if move is None:
                    continue
                if entry.method == "level-up":
                    weight, source = 4.0, "xy_level_up"
                elif entry.method == "machine":
                    weight, source = 1.4, "xy_tm_hm"
                elif entry.method in {"egg", "tutor"}:
                    weight, source = 0.7, f"xy_{entry.method}"
                else:
                    weight, source = 0.35, "xy_other"
                if move.power:
                    weight *= 1 + min(move.power, 120) / 300
                if move.type in record.types:
                    weight *= 1.25
                previous = move_weights.get(entry.move_name)
                if previous is None or weight > previous[0]:
                    move_weights[entry.move_name] = (weight, source)
        for revealed in opponent.revealed_moves:
            move_weights[revealed] = (20.0, "observed")
        moves = self._normalized_moves(move_weights)
        ability_names = [exact.ability] if exact and exact.ability else record.abilities
        ability_probability = 1 / max(1, len(ability_names))
        abilities = {
            ability: AbilityBelief(
                ability=ability,
                probability=ability_probability,
                source="exact_trainer" if exact and exact.ability else "species",
            )
            for ability in ability_names
            if ability
        }
        state = OpponentBeliefState(
            pokemon=record.canonical_name,
            form=record.form_name,
            level=opponent.level,
            types=[type_.value for type_ in record.types],
            base_stats=record.base_stats.model_dump(),
            moves=moves,
            abilities=abilities,
            revealed_moves=list(opponent.revealed_moves),
            trainer_exact=bool(exact),
        )
        self._update_uncertainty(state)
        return state

    @staticmethod
    def _normalized_moves(weights: dict[str, tuple[float, str]]) -> dict[str, MoveBelief]:
        total = sum(weight for weight, _ in weights.values()) or 1.0
        return {
            move: MoveBelief(move=move, probability=weight / total, source=source)
            for move, (weight, source) in weights.items()
        }

    @staticmethod
    def _renormalize_moves(state: OpponentBeliefState) -> None:
        possible = [belief for belief in state.moves.values() if not belief.impossible]
        total = sum(belief.probability for belief in possible)
        if not possible:
            return
        if total <= 0:
            for belief in possible:
                belief.probability = 1 / len(possible)
        else:
            for belief in possible:
                belief.probability /= total
        for belief in state.moves.values():
            if belief.impossible:
                belief.probability = 0

    @staticmethod
    def _renormalize_abilities(state: OpponentBeliefState) -> None:
        possible = [belief for belief in state.abilities.values() if not belief.impossible]
        total = sum(belief.probability for belief in possible)
        if not possible:
            return
        for belief in possible:
            belief.probability = belief.probability / total if total else 1 / len(possible)
        for belief in state.abilities.values():
            if belief.impossible:
                belief.probability = 0

    def observe_move(self, state: OpponentBeliefState, move_name: str) -> None:
        match = self.knowledge.resolve_alias(move_name, "move")
        canonical = match.canonical_name if match else move_name
        if canonical not in state.moves:
            state.moves[canonical] = MoveBelief(
                move=canonical,
                probability=0.25,
                source="observed_outside_prior",
            )
        for name, belief in state.moves.items():
            belief.probability *= 4.0 if name == canonical else 0.75
        observed = state.moves[canonical]
        observed.observed_count += 1
        observed.impossible = False
        if canonical not in state.revealed_moves:
            state.revealed_moves.append(canonical)
        state.observations += 1
        self._renormalize_moves(state)
        self._update_uncertainty(state)

    def eliminate_move(self, state: OpponentBeliefState, move_name: str, reason: str = "") -> None:
        if move_name in state.moves and move_name not in state.revealed_moves:
            state.moves[move_name].impossible = True
            state.moves[move_name].source = f"impossible:{reason}" if reason else "impossible"
            self._renormalize_moves(state)
            self._update_uncertainty(state)

    def observe_ability(self, state: OpponentBeliefState, ability_name: str) -> None:
        match = self.knowledge.resolve_alias(ability_name, "ability")
        canonical = match.canonical_name if match else ability_name
        if canonical not in state.abilities:
            state.abilities[canonical] = AbilityBelief(
                ability=canonical,
                probability=0.5,
                source="observed",
            )
        for name, belief in state.abilities.items():
            belief.probability = 1.0 if name == canonical else 0.0
            belief.impossible = name != canonical
        self._update_uncertainty(state)

    def observe_speed_order(
        self,
        state: OpponentBeliefState,
        *,
        player_speed: int,
        opponent_moved_first: bool,
        equal_priority: bool = True,
    ) -> None:
        if not equal_priority:
            return
        if opponent_moved_first:
            state.speed_min = max(state.speed_min or 1, player_speed + 1)
        else:
            state.speed_max = min(state.speed_max or 999, player_speed)
        state.observations += 1
        self._update_uncertainty(state)

    def observe_damage(
        self,
        state: OpponentBeliefState,
        *,
        opponent: BattlePokemon,
        other: BattlePokemon,
        move: MoveState,
        actual_damage: int,
        opponent_attacking: bool,
        field: DamageField | None = None,
    ) -> None:
        for ability_name, belief in state.abilities.items():
            if belief.impossible:
                continue
            modeled = opponent.model_copy(deep=True)
            modeled.ability = ability_name
            request = DamageRequest(
                attacker=modeled if opponent_attacking else other,
                defender=other if opponent_attacking else modeled,
                move=move,
                field=field or DamageField(),
            )
            distribution = self.damage_calculator.calculate(request)
            tolerance = max(2, round(distribution.maximum * 0.08))
            plausible = (
                distribution.minimum - tolerance
                <= actual_damage
                <= distribution.maximum + tolerance
            )
            belief.probability *= 1.0 if plausible else 0.08
        self._renormalize_abilities(state)
        state.observations += 1
        self._update_uncertainty(state)

    @staticmethod
    def likely_actions(state: OpponentBeliefState, limit: int = 4) -> list[MoveBelief]:
        return sorted(
            (belief for belief in state.moves.values() if not belief.impossible),
            key=lambda belief: belief.probability,
            reverse=True,
        )[:limit]

    @staticmethod
    def _update_uncertainty(state: OpponentBeliefState) -> None:
        move_probabilities = [
            belief.probability for belief in state.moves.values() if not belief.impossible
        ]
        ability_probabilities = [
            belief.probability for belief in state.abilities.values() if not belief.impossible
        ]

        def normalized_entropy(values: list[float]) -> float:
            if len(values) <= 1:
                return 0.0
            entropy = -sum(value * math.log(max(value, 1e-12)) for value in values)
            return entropy / math.log(len(values))

        state.uncertainty = min(
            1.0,
            0.75 * normalized_entropy(move_probabilities)
            + 0.25 * normalized_entropy(ability_probabilities),
        )
