from __future__ import annotations

import json
import math
from enum import StrEnum
from typing import Any, Protocol

from pydantic import BaseModel, Field

from ..config import PlannerSettings
from ..inference import OLLAMA_INFERENCE_LOCK
from .belief import OpponentBeliefModel, OpponentBeliefState
from .damage import DamageDistribution, DamageField, DamageRequest, Gen6DamageCalculator
from .knowledge import KnowledgeDatabase, MoveRecord
from .models import BattlePokemon, BattleState, MoveState, SwitchOption


class BattleActionKind(StrEnum):
    MOVE = "move"
    SWITCH = "switch"
    ITEM = "item"
    WAIT = "wait"


class BattleAction(BaseModel):
    kind: BattleActionKind
    move: str | None = None
    move_slot: int | None = Field(default=None, ge=0, le=3)
    switch_index: int | None = Field(default=None, ge=0, le=5)
    target: int = Field(default=0, ge=0, le=3)
    reason: str = ""


class MechanicalCandidate(BaseModel):
    action: BattleAction
    score: float
    robust_score: float
    expected_damage: float = 0.0
    minimum_damage: int = 0
    maximum_damage: int = 0
    ko_probability: float = 0.0
    expected_incoming_damage: float = 0.0
    worst_incoming_damage: int = 0
    accuracy_probability: float = 1.0
    type_multiplier: float = 1.0
    damage_distribution: DamageDistribution | None = None
    notes: list[str] = Field(default_factory=list)


class SearchTreeNode(BaseModel):
    node_type: str
    action: BattleAction | None = None
    opponent_move: str | None = None
    probability: float = Field(default=1.0, ge=0.0, le=1.0)
    value: float = 0.0
    player_hp_ratio: float = Field(default=1.0, ge=0.0, le=1.0)
    opponent_hp_ratio: float = Field(default=1.0, ge=0.0, le=1.0)
    children: list[SearchTreeNode] = Field(default_factory=list)


class StrategyEvaluation(BaseModel):
    adjustments: dict[str, float] = Field(default_factory=dict)
    rationale: dict[str, str] = Field(default_factory=dict)


class BattleStrategyEvaluator(Protocol):
    def evaluate(
        self,
        state_summary: dict[str, object],
        candidates: list[dict[str, object]],
    ) -> StrategyEvaluation: ...


class NullBattleStrategyEvaluator:
    def evaluate(
        self,
        state_summary: dict[str, object],
        candidates: list[dict[str, object]],
    ) -> StrategyEvaluation:
        return StrategyEvaluation()


class OllamaBattleStrategyEvaluator:
    """Optional bounded strategist; every mechanical value is supplied read-only."""

    def __init__(self, settings: PlannerSettings, *, client: object | None = None) -> None:
        if client is None:
            try:
                from ollama import Client
            except ImportError as exc:
                raise RuntimeError("The ollama Python package is not installed.") from exc
            client = Client(host=settings.host)
        self.settings = settings
        self.client: Any = client
        self.last_error: str | None = None

    def evaluate(
        self,
        state_summary: dict[str, object],
        candidates: list[dict[str, object]],
    ) -> StrategyEvaluation:
        payload = {
            "state": state_summary,
            "mechanically_valid_candidates": candidates,
            "task": (
                "Assess short-term risk, switching, setup, resources, safe versus risky "
                "lines, and team position. Do not recalculate or contradict mechanics. "
                "Return adjustments keyed by candidate action key in [-0.5, 0.5]."
            ),
        }
        try:
            with OLLAMA_INFERENCE_LOCK:
                response = self.client.chat(
                    model=self.settings.model,
                    messages=[
                        {
                            "role": "system",
                            "content": (
                                "You are a bounded Generation-VI battle strategist. "
                                "Mechanical packets are authoritative. Return only JSON."
                            ),
                        },
                        {
                            "role": "user",
                            "content": json.dumps(payload, ensure_ascii=False),
                        },
                    ],
                    format=StrategyEvaluation.model_json_schema(),
                    options={
                        "temperature": self.settings.temperature,
                        "num_ctx": self.settings.context_size,
                        "num_predict": min(512, self.settings.max_output_tokens),
                    },
                    keep_alive=self.settings.keep_alive,
                    think=self.settings.thinking,
                    stream=False,
                )
            evaluation = StrategyEvaluation.model_validate_json(
                str(response.message.content)
            )
            evaluation.adjustments = {
                key: max(-0.5, min(0.5, value))
                for key, value in evaluation.adjustments.items()
            }
            self.last_error = None
            return evaluation
        except Exception as exc:
            self.last_error = f"{type(exc).__name__}: {exc}"
            return StrategyEvaluation()


class BattleDecision(BaseModel):
    generation: int = 6
    action: BattleAction
    candidates: list[MechanicalCandidate]
    search_tree: SearchTreeNode
    mechanical_score: float
    strategic_adjustment: float = 0.0
    rationale: list[str] = Field(default_factory=list)


class BattlePlanner:
    """Beam-pruned one-turn expectimax with optional bounded strategic LLM input."""

    def __init__(
        self,
        knowledge: KnowledgeDatabase,
        *,
        calculator: Gen6DamageCalculator | None = None,
        strategy_evaluator: BattleStrategyEvaluator | None = None,
        beam_width: int = 4,
        opponent_width: int = 4,
        horizon: int = 1,
    ) -> None:
        self.knowledge = knowledge
        self.calculator = calculator or Gen6DamageCalculator(knowledge)
        self.strategy_evaluator = strategy_evaluator or NullBattleStrategyEvaluator()
        self.beam_width = max(1, beam_width)
        self.opponent_width = max(1, opponent_width)
        self.horizon = max(1, min(horizon, 3))

    def plan(
        self,
        state: BattleState,
        belief: OpponentBeliefState,
    ) -> BattleDecision:
        player = state.active_player
        opponent = state.active_opponent
        if player is None or opponent is None:
            return self._wait_decision("Battle state has no active player or opponent.")
        legal_moves = [move for move in state.available_moves if move.legal and move.pp > 0]
        legal_switches = [
            option
            for option in state.available_switches
            if option.legal and not option.pokemon.fainted and option.pokemon.hp.ratio > 0
        ]
        if not legal_moves and not legal_switches:
            return self._wait_decision("No legal move or switch is available.")

        opponent_actions = self._opponent_actions(belief)
        field = DamageField(
            weather=state.weather,
            terrain=state.terrain,
            is_double_battle="double" in state.battle_type.value,
        )
        candidates = [
            self._evaluate_move(index, move, player, opponent, opponent_actions, field)
            for index, move in enumerate(state.available_moves)
            if move in legal_moves
        ]
        candidates.extend(
            self._evaluate_switch(option, player, opponent, opponent_actions, field)
            for option in legal_switches
        )
        candidates.sort(key=lambda candidate: candidate.robust_score, reverse=True)
        candidates = candidates[: self.beam_width]
        tree = SearchTreeNode(node_type="root")
        for candidate in candidates:
            tree.children.append(
                self._candidate_tree(candidate, player, opponent, opponent_actions, field)
            )

        strategic = self.strategy_evaluator.evaluate(
            self._state_summary(state, belief),
            [self._candidate_packet(candidate) for candidate in candidates],
        )
        adjusted: list[tuple[float, MechanicalCandidate, float]] = []
        for candidate in candidates:
            key = self._action_key(candidate.action)
            adjustment = max(-0.5, min(0.5, strategic.adjustments.get(key, 0.0)))
            adjusted.append((candidate.robust_score + adjustment, candidate, adjustment))
        _, selected, adjustment = max(adjusted, key=lambda item: item[0])
        selected_key = self._action_key(selected.action)
        rationale = [
            f"mechanical robust score={selected.robust_score:.3f}",
            *selected.notes,
        ]
        if selected_key in strategic.rationale:
            rationale.append(strategic.rationale[selected_key])
        return BattleDecision(
            action=selected.action,
            candidates=candidates,
            search_tree=tree,
            mechanical_score=selected.robust_score,
            strategic_adjustment=adjustment,
            rationale=rationale,
        )

    def _evaluate_move(
        self,
        slot: int,
        move: MoveState,
        player: BattlePokemon,
        opponent: BattlePokemon,
        opponent_actions: list[tuple[MoveState, float]],
        field: DamageField,
    ) -> MechanicalCandidate:
        distribution = self.calculator.calculate(
            DamageRequest(attacker=player, defender=opponent, move=move, field=field)
        )
        incoming_expected, incoming_worst = self._incoming(
            player, opponent, opponent_actions, field
        )
        opponent_hp = self._estimated_hp(opponent)
        player_hp = self._estimated_hp(player)
        damage_ratio = distribution.expected / opponent_hp
        incoming_ratio = incoming_expected / player_hp
        survival_factor = 1 - distribution.ko_probability
        score = (
            damage_ratio * 2.2
            + distribution.ko_probability * 3.5
            + distribution.accuracy_probability * 0.15
            + max(-1, min(1, move.priority)) * 0.08
            - incoming_ratio * survival_factor * 1.8
            - distribution.recoil_expected / player_hp
        )
        robust_score = (
            score
            + distribution.minimum / opponent_hp * 0.5
            - incoming_worst / player_hp * survival_factor * 0.35
        )
        notes = []
        if distribution.type_multiplier == 0:
            notes.append("deterministic immunity makes this move ineffective")
            robust_score -= 4
        elif distribution.type_multiplier > 1:
            notes.append("mechanically super effective")
        elif distribution.type_multiplier < 1:
            notes.append("mechanically resisted")
        if distribution.ko_probability >= 0.9:
            notes.append("high-confidence KO line")
        return MechanicalCandidate(
            action=BattleAction(
                kind=BattleActionKind.MOVE,
                move=move.canonical_name,
                move_slot=slot,
                reason="Highest robust mechanical line after expectimax.",
            ),
            score=score,
            robust_score=robust_score,
            expected_damage=distribution.expected,
            minimum_damage=distribution.minimum,
            maximum_damage=distribution.maximum,
            ko_probability=distribution.ko_probability,
            expected_incoming_damage=incoming_expected * survival_factor,
            worst_incoming_damage=round(incoming_worst * survival_factor),
            accuracy_probability=distribution.accuracy_probability,
            type_multiplier=distribution.type_multiplier,
            damage_distribution=distribution,
            notes=notes,
        )

    def _evaluate_switch(
        self,
        option: SwitchOption,
        current: BattlePokemon,
        opponent: BattlePokemon,
        opponent_actions: list[tuple[MoveState, float]],
        field: DamageField,
    ) -> MechanicalCandidate:
        incoming_expected, incoming_worst = self._incoming(
            option.pokemon, opponent, opponent_actions, field
        )
        hp = self._estimated_hp(option.pokemon)
        current_hp = self._estimated_hp(current)
        current_incoming, _ = self._incoming(current, opponent, opponent_actions, field)
        improvement = current_incoming / current_hp - incoming_expected / hp
        score = improvement * 2.0 - incoming_expected / hp
        robust_score = score - incoming_worst / hp * 0.35
        return MechanicalCandidate(
            action=BattleAction(
                kind=BattleActionKind.SWITCH,
                switch_index=option.party_index,
                reason=f"Switch to {option.pokemon.canonical_name} for a safer matchup.",
            ),
            score=score,
            robust_score=robust_score,
            expected_incoming_damage=incoming_expected,
            worst_incoming_damage=incoming_worst,
            notes=[f"incoming damage improvement={improvement:.3f}"],
        )

    def _incoming(
        self,
        defender: BattlePokemon,
        opponent: BattlePokemon,
        opponent_actions: list[tuple[MoveState, float]],
        field: DamageField,
    ) -> tuple[float, int]:
        expected = 0.0
        worst = 0
        for move, probability in opponent_actions:
            distribution = self.calculator.calculate(
                DamageRequest(attacker=opponent, defender=defender, move=move, field=field)
            )
            expected += probability * distribution.expected
            worst = max(worst, distribution.maximum)
        return expected, worst

    def _opponent_actions(self, belief: OpponentBeliefState) -> list[tuple[MoveState, float]]:
        actions: list[tuple[MoveState, float]] = []
        for move_belief in OpponentBeliefModel.likely_actions(belief, limit=self.opponent_width):
            record = self.knowledge.move(move_belief.move)
            if record:
                actions.append((self._move_state(record), move_belief.probability))
        total = sum(probability for _, probability in actions)
        return (
            [
                (move, probability / total if total else 1 / len(actions))
                for move, probability in actions
            ]
            if actions
            else []
        )

    @staticmethod
    def _move_state(record: MoveRecord) -> MoveState:
        return MoveState(
            canonical_name=record.canonical_name,
            type=record.type,
            damage_class=record.damage_class,
            power=record.power,
            accuracy=record.accuracy,
            priority=record.priority,
            pp=record.pp,
            max_pp=record.pp,
            min_hits=record.min_hits,
            max_hits=record.max_hits,
            drain_percent=record.drain_percent,
            healing_percent=record.healing_percent,
            crit_rate=record.crit_rate,
            effect_chance=record.effect_chance,
            ailment=record.ailment,
        )

    def _candidate_tree(
        self,
        candidate: MechanicalCandidate,
        player: BattlePokemon,
        opponent: BattlePokemon,
        opponent_actions: list[tuple[MoveState, float]],
        field: DamageField,
    ) -> SearchTreeNode:
        player_hp = self._estimated_hp(player)
        opponent_hp = self._estimated_hp(opponent)
        node = SearchTreeNode(
            node_type="player_action",
            action=candidate.action,
            value=candidate.robust_score,
            player_hp_ratio=player.hp.ratio,
            opponent_hp_ratio=opponent.hp.ratio,
        )
        if not opponent_actions:
            return node
        for move, probability in opponent_actions:
            incoming = self.calculator.calculate(
                DamageRequest(attacker=opponent, defender=player, move=move, field=field)
            )
            child_player_ratio = max(0.0, player.hp.ratio - incoming.expected / player_hp)
            child_opponent_ratio = max(
                0.0, opponent.hp.ratio - candidate.expected_damage / opponent_hp
            )
            value = child_player_ratio - child_opponent_ratio + candidate.ko_probability * 2
            node.children.append(
                SearchTreeNode(
                    node_type="opponent_chance",
                    action=candidate.action,
                    opponent_move=move.canonical_name,
                    probability=probability,
                    value=value,
                    player_hp_ratio=child_player_ratio,
                    opponent_hp_ratio=child_opponent_ratio,
                )
            )
        if self.horizon > 1:
            continuation = max((child.value for child in node.children), default=0.0)
            node.value += 0.35 * continuation
        return node

    @staticmethod
    def _estimated_hp(pokemon: BattlePokemon) -> int:
        if pokemon.hp.maximum:
            return pokemon.hp.maximum
        if pokemon.estimated_stats:
            return pokemon.estimated_stats.hp
        if pokemon.base_stats:
            base = pokemon.base_stats.hp
            return math.floor((2 * base + 31) * pokemon.level / 100) + pokemon.level + 10
        return max(1, pokemon.level * 3)

    @staticmethod
    def _action_key(action: BattleAction) -> str:
        if action.kind == BattleActionKind.MOVE:
            return f"move:{action.move}"
        if action.kind == BattleActionKind.SWITCH:
            return f"switch:{action.switch_index}"
        return action.kind.value

    @staticmethod
    def _candidate_packet(candidate: MechanicalCandidate) -> dict[str, object]:
        return {
            "action": BattlePlanner._action_key(candidate.action),
            "mechanical_score": candidate.score,
            "robust_score": candidate.robust_score,
            "expected_damage": candidate.expected_damage,
            "damage_range": [candidate.minimum_damage, candidate.maximum_damage],
            "ko_probability": candidate.ko_probability,
            "expected_incoming_damage": candidate.expected_incoming_damage,
            "type_multiplier": candidate.type_multiplier,
            "notes": candidate.notes,
        }

    @staticmethod
    def _state_summary(state: BattleState, belief: OpponentBeliefState) -> dict[str, object]:
        return {
            "turn": state.turn_number,
            "battle_type": state.battle_type.value,
            "weather": state.weather.value,
            "terrain": state.terrain.value,
            "player": state.active_player.canonical_name if state.active_player else None,
            "opponent": state.active_opponent.canonical_name if state.active_opponent else None,
            "opponent_uncertainty": belief.uncertainty,
            "revealed_moves": belief.revealed_moves,
        }

    @staticmethod
    def _wait_decision(reason: str) -> BattleDecision:
        action = BattleAction(kind=BattleActionKind.WAIT, reason=reason)
        return BattleDecision(
            action=action,
            candidates=[],
            search_tree=SearchTreeNode(node_type="root"),
            mechanical_score=-10,
            rationale=[reason],
        )
