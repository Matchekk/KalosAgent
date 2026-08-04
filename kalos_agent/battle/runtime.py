from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from ..layout import UILayoutRegistry
from ..models import (
    ActionPlan,
    AtomicAction,
    AtomicActionKind,
    Button,
    GameState,
    MacroName,
    Scene,
    ScreenFrame,
)
from .belief import OpponentBeliefModel, OpponentBeliefState
from .knowledge import KnowledgeDatabase
from .learning import BattleLearningStore, InContextBattleLearner
from .models import BattleState, BattleType
from .parser import BattleParseInput, BattleStateParser, SemanticBattleOCR
from .planner import BattleAction, BattleActionKind, BattleDecision, BattlePlanner


@dataclass(slots=True)
class BattleIntelligenceResult:
    battle_state: BattleState
    belief: OpponentBeliefState | None
    decision: BattleDecision | None
    action_plan: ActionPlan
    semantic_ocr_calls: int
    semantic_ocr_latency_ms: float
    normalized_regions: dict[str, dict[str, object]]
    recognized_entities: list[dict[str, object]]


class BattleActionTranslator:
    """Maps canonical actions to bounded controls using known 2x2/2x3 UI geometry."""

    @staticmethod
    def _press(button: Button, reason: str) -> AtomicAction:
        return AtomicAction(
            kind=AtomicActionKind.PRESS_BUTTON,
            button=button,
            duration_ms=110,
            reason=reason,
        )

    def translate(self, action: BattleAction, scene: Scene) -> ActionPlan:
        if action.kind == BattleActionKind.WAIT:
            return ActionPlan.safe_wait(action.reason or "Battle state is incomplete.")
        if action.kind == BattleActionKind.MOVE and scene == Scene.BATTLE:
            return ActionPlan(
                state_summary="Battle main menu with a mechanically selected move.",
                immediate_goal="Open the move selection; choose the move next cycle.",
                confidence=0.95,
                macro=MacroName.INTERACT,
                expected_state_changes=[Scene.BATTLE_MOVE_MENU],
                progress_signals=["move menu opens"],
            )
        if action.kind == BattleActionKind.MOVE and scene == Scene.BATTLE_MOVE_MENU:
            slot = action.move_slot or 0
            directions = {
                0: [],
                1: [Button.DPAD_RIGHT],
                2: [Button.DPAD_DOWN],
                3: [Button.DPAD_RIGHT, Button.DPAD_DOWN],
            }[slot]
            actions = [
                self._press(button, f"Select deterministic move slot {slot + 1}.")
                for button in directions
            ]
            actions.append(self._press(Button.A, f"Confirm {action.move}."))
            return ActionPlan(
                state_summary="Known 2x2 Generation-VI move menu geometry.",
                immediate_goal=f"Select move slot {slot + 1}: {action.move}.",
                confidence=0.98,
                macro=MacroName.PRESS_SEQUENCE,
                actions=actions,
                expected_state_changes=[Scene.BATTLE, Scene.LOADING, Scene.DIALOGUE],
                progress_signals=["battle text changes", "HP changes", "turn advances"],
            )
        if action.kind == BattleActionKind.SWITCH and scene == Scene.BATTLE:
            return ActionPlan(
                state_summary="Battle main menu with a mechanically selected switch.",
                immediate_goal="Open the party menu using its known lower-row entry.",
                confidence=0.8,
                macro=MacroName.PRESS_SEQUENCE,
                actions=[
                    self._press(Button.DPAD_DOWN, "Select the party command."),
                    self._press(Button.A, "Open the party menu."),
                ],
                expected_state_changes=[Scene.BATTLE_PARTY_MENU],
                progress_signals=["party menu opens"],
            )
        if action.kind == BattleActionKind.SWITCH and scene == Scene.BATTLE_PARTY_MENU:
            index = action.switch_index or 0
            row, column = divmod(index, 2)
            actions = [
                *[
                    self._press(Button.DPAD_DOWN, f"Move to party row {row + 1}.")
                    for _ in range(row)
                ],
                *(
                    [self._press(Button.DPAD_RIGHT, "Move to the right party column.")]
                    if column
                    else []
                ),
                self._press(Button.A, f"Confirm party slot {index + 1}."),
            ]
            return ActionPlan(
                state_summary="Known 2x3 party menu geometry.",
                immediate_goal=f"Switch to party slot {index + 1}.",
                confidence=0.9,
                macro=MacroName.PRESS_SEQUENCE,
                actions=actions,
                expected_state_changes=[Scene.BATTLE, Scene.LOADING],
                progress_signals=["active Pokémon changes"],
            )
        return ActionPlan.safe_wait(
            f"Battle action {action.kind.value} is not executable in {scene.value}."
        )


class BattleIntelligenceRuntime:
    def __init__(
        self,
        *,
        semantic_ocr: SemanticBattleOCR,
        registry: UILayoutRegistry,
        parser: BattleStateParser,
        belief_model: OpponentBeliefModel,
        planner: BattlePlanner,
        learning: BattleLearningStore,
        knowledge: KnowledgeDatabase | None = None,
    ) -> None:
        self.semantic_ocr = semantic_ocr
        self.registry = registry
        self.parser = parser
        self.belief_model = belief_model
        self.planner = planner
        self.learning = learning
        self.learner = InContextBattleLearner(belief_model, learning)
        self.knowledge = knowledge
        self.translator = BattleActionTranslator()
        self._states: dict[str, BattleState] = {}
        self._beliefs: dict[str, OpponentBeliefState] = {}
        self._active_battle_id: str | None = None

    @staticmethod
    def _battle_id(frame: ScreenFrame, previous: BattleState | None) -> str:
        if previous:
            return previous.battle_id
        digest = hashlib.sha256(frame.full_frame.tobytes()).hexdigest()[:12]
        return f"azahar-{digest}"

    def plan(
        self,
        frame: ScreenFrame,
        game_state: GameState,
        *,
        battle_type: BattleType = BattleType.WILD_SINGLE,
        hp_ratios: dict[str, float] | None = None,
        decide: bool = True,
    ) -> BattleIntelligenceResult:
        previous = (
            self._states.get(self._active_battle_id) if self._active_battle_id else None
        )
        battle_id = self._battle_id(frame, previous)
        self._active_battle_id = battle_id
        ocr = self.semantic_ocr.recognize(
            frame,
            game_state,
            battle_type=battle_type,
        )
        frame.regions.update(
            {
                f"battle-{name}": image
                for name, image in ocr.crops.items()
                if isinstance(image, np.ndarray)
            }
        )
        battle_state = self.parser.parse(
            BattleParseInput(
                battle_id=battle_id,
                frame_id=frame.frame_id,
                battle_type=battle_type,
                lines=ocr.lines,
                hp_ratios=hp_ratios,
                previous=previous,
            )
        )
        self._states[battle_id] = battle_state
        belief = self._beliefs.get(battle_id)
        opponent = battle_state.active_opponent
        if opponent and (belief is None or belief.pokemon != opponent.canonical_name):
            belief = self.belief_model.initialize(opponent)
            self._beliefs[battle_id] = belief
        if belief:
            previous_log_length = len(previous.battle_log) if previous else 0
            for event in battle_state.battle_log[previous_log_length:]:
                if event.kind == "move_revealed" and event.move:
                    self.belief_model.observe_move(belief, event.move)

        decision = None
        if not decide:
            plan = ActionPlan.safe_wait("Post-action battle observation only.")
        elif game_state.scene == Scene.BATTLE and not battle_state.available_moves:
            plan = ActionPlan(
                state_summary="Battle main menu; move details are intentionally not inferred.",
                immediate_goal="Open the move menu for deterministic candidate evaluation.",
                confidence=0.95,
                macro=MacroName.INTERACT,
                expected_state_changes=[Scene.BATTLE_MOVE_MENU],
                progress_signals=["move menu opens"],
            )
        elif belief and battle_state.active_player and opponent:
            decision = self.planner.plan(battle_state, belief)
            plan = self.translator.translate(decision.action, game_state.scene)
        else:
            plan = ActionPlan.safe_wait("Battle parser lacks a validated active combatant.")

        regions: dict[str, dict[str, object]] = {
            region.semantic.value: {
                "screen": region.screen.value,
                "rect": region.rect.model_dump(mode="json"),
                "text": region.text,
            }
            for region in self.registry.regions(ocr.layout)
        }
        entities: list[dict[str, object]] = []
        for pokemon in [*battle_state.player_active, *battle_state.opponent_active]:
            entities.append({
                "type": "pokemon",
                "canonical": pokemon.canonical_name,
                "display": pokemon.display_name,
                "confidence": pokemon.confidence,
            })
        for move in battle_state.available_moves:
            entities.append({
                "type": "move",
                "canonical": move.canonical_name,
                "display": move.display_name,
                "confidence": move.confidence,
            })
        return BattleIntelligenceResult(
            battle_state=battle_state,
            belief=belief,
            decision=decision,
            action_plan=plan,
            semantic_ocr_calls=ocr.calls,
            semantic_ocr_latency_ms=ocr.latency_ms,
            normalized_regions=regions,
            recognized_entities=entities,
        )

    def record_outcome(
        self,
        result: BattleIntelligenceResult,
        after_frame: ScreenFrame,
        after_game_state: GameState,
        *,
        progress_score: float,
        decision_error: str | None = None,
    ) -> dict[str, object] | None:
        """Parse the post-action frame and persist one canonical learning transition."""
        if result.decision is None or result.belief is None:
            return None
        observed = self.plan(after_frame, after_game_state, decide=False)
        after = observed.battle_state.model_copy(
            update={"turn_number": result.battle_state.turn_number + 1}
        )
        before_player = result.battle_state.active_player
        after_player = after.active_player
        actual_damage = None
        if before_player and after_player:
            before_hp = before_player.hp.current
            after_hp = after_player.hp.current
            if before_hp is not None and after_hp is not None:
                actual_damage = max(0, before_hp - after_hp)
        new_events = after.battle_log[len(result.battle_state.battle_log) :]
        opponent_action = next(
            (
                event.move
                for event in reversed(new_events)
                if event.move and event.move != result.decision.action.move
            ),
            None,
        )
        opponent_move = None
        if opponent_action and self.knowledge:
            move_record = self.knowledge.move(opponent_action)
            if move_record:
                opponent_move = self.planner._move_state(move_record)
        status_changes: list[str] = []
        if before_player and after_player and before_player.status != after_player.status:
            status_changes.append(
                f"player:{before_player.status.value}->{after_player.status.value}"
            )
        before_opponent = result.battle_state.active_opponent
        after_opponent = after.active_opponent
        if before_opponent and after_opponent and before_opponent.status != after_opponent.status:
            status_changes.append(
                f"opponent:{before_opponent.status.value}->{after_opponent.status.value}"
            )
        record = self.learner.apply_turn(
            before=result.battle_state,
            belief=result.belief,
            decision=result.decision,
            after=after,
            opponent_action=opponent_action,
            actual_damage=actual_damage,
            status_changes=status_changes,
            progress_score=progress_score,
            decision_error=decision_error,
            opponent_move=opponent_move,
        )
        return record.model_dump(mode="json")

    def leave_battle(self) -> None:
        self._active_battle_id = None

    def close(self) -> None:
        self.learning.close()
        if self.knowledge is not None:
            self.knowledge.close()
