from __future__ import annotations

import time
from collections.abc import Callable
from datetime import UTC, datetime
from functools import partial

from .backends import ActionBackend, CaptureBackend
from .config import ActionSettings
from .models import (
    AbortCondition,
    ActionExecutionResult,
    ActionMacro,
    ActionPlan,
    AtomicAction,
    AtomicActionKind,
    Button,
    ExecutedAtomicAction,
    GameState,
    MacroName,
    Scene,
)

MENU_SCENES = {
    Scene.MAIN_MENU,
    Scene.PARTY_MENU,
    Scene.BAG_MENU,
    Scene.TOUCH_MENU,
}
BATTLE_SCENES = {Scene.BATTLE, Scene.BATTLE_MOVE_MENU, Scene.BATTLE_PARTY_MENU}
DIALOGUE_SCENES = {Scene.DIALOGUE, Scene.CHOICE_DIALOGUE}
ADVANCE_DIALOGUE_SCENES = {Scene.DIALOGUE}


def _fingerprint_changed(state: GameState, *, baseline: str) -> bool:
    return state.fingerprint() != baseline


class PlanValidationError(ValueError):
    pass


class PlanValidator:
    def __init__(self, settings: ActionSettings) -> None:
        self.settings = settings

    def validate(self, plan: ActionPlan, state: GameState) -> ActionPlan:
        if len(plan.actions) > self.settings.max_steps_per_plan:
            raise PlanValidationError("Plan contains too many atomic actions.")
        if any(
            action.duration_ms > self.settings.max_action_duration_ms for action in plan.actions
        ):
            raise PlanValidationError("Plan contains an action that exceeds the duration limit.")
        if (
            plan.macro in {MacroName.CANCEL, MacroName.CLOSE_MENU_SAFELY}
            and state.scene in BATTLE_SCENES
        ):
            raise PlanValidationError("B/cancel macros are unsafe during battle.")
        if plan.macro == MacroName.CLOSE_MENU_SAFELY and state.scene not in MENU_SCENES:
            raise PlanValidationError("close_menu_safely is only valid in non-battle menus.")
        if plan.macro == MacroName.ADVANCE_DIALOGUE and state.scene not in ADVANCE_DIALOGUE_SCENES:
            raise PlanValidationError("advance_dialogue requires a non-choice dialogue scene.")
        if plan.macro in {MacroName.PRESS_BUTTON, MacroName.PRESS_SEQUENCE} and (
            not plan.actions
            or any(action.kind != AtomicActionKind.PRESS_BUTTON for action in plan.actions)
        ):
            raise PlanValidationError("Button macros require only press_button actions.")
        if plan.macro == MacroName.MOVE_BURST and (
            not plan.actions or any(action.kind != AtomicActionKind.MOVE for action in plan.actions)
        ):
            raise PlanValidationError("move_burst requires only move actions.")
        return plan

    def validate_or_wait(self, plan: ActionPlan, state: GameState) -> ActionPlan:
        try:
            return self.validate(plan, state)
        except (PlanValidationError, ValueError) as exc:
            return ActionPlan.safe_wait(f"Rejected unsafe planner output: {exc}")


class MacroFactory:
    def __init__(self, settings: ActionSettings) -> None:
        self.settings = settings

    def build(self, plan: ActionPlan, state: GameState) -> ActionMacro:
        actions = list(plan.actions)
        allowed: set[Scene] = set(Scene)
        expected = set(plan.expected_state_changes)
        stop_after_change = False

        if plan.macro == MacroName.WAIT:
            actions = actions or [self._wait(400, "Wait for the next stable observation.")]
        elif plan.macro == MacroName.INTERACT:
            actions = [self._press_a("Interact with the object or character ahead.")]
            expected |= DIALOGUE_SCENES | BATTLE_SCENES
            stop_after_change = True
        elif plan.macro == MacroName.CANCEL:
            allowed -= BATTLE_SCENES
            actions = [self._press_b("Cancel the current non-battle prompt.")]
            stop_after_change = True
        elif plan.macro == MacroName.ADVANCE_DIALOGUE:
            allowed = ADVANCE_DIALOGUE_SCENES
            actions = [self._press_a("Advance one dialogue page.") for _ in range(4)]
            stop_after_change = True
        elif plan.macro == MacroName.WAIT_FOR_STABLE_FRAME:
            actions = [
                AtomicAction(
                    kind=AtomicActionKind.WAIT_FOR_STABLE,
                    duration_ms=100,
                    reason="Wait until capture reports a stable frame.",
                )
            ]
        elif plan.macro == MacroName.WAIT_FOR_STATE_CHANGE:
            actions = [
                AtomicAction(
                    kind=AtomicActionKind.WAIT_FOR_STATE_CHANGE,
                    duration_ms=100,
                    reason="Wait until the observed state changes.",
                )
            ]
        elif plan.macro == MacroName.CLOSE_MENU_SAFELY:
            allowed = MENU_SCENES
            actions = [self._press_b("Close the current non-battle menu safely.")]
            stop_after_change = True

        return ActionMacro(
            name=plan.macro,
            actions=actions,
            allowed_scenes=allowed,
            expected_scenes=expected,
            timeout_seconds=self.settings.macro_timeout_seconds,
            abort_conditions=plan.abort_conditions,
            max_inputs=min(self.settings.max_steps_per_plan, len(actions)),
            reason=plan.immediate_goal,
            stop_after_visible_change=stop_after_change,
        )

    @staticmethod
    def _press_a(reason: str) -> AtomicAction:
        return AtomicAction(
            kind=AtomicActionKind.PRESS_BUTTON,
            button=Button.A,
            duration_ms=120,
            reason=reason,
        )

    @staticmethod
    def _press_b(reason: str) -> AtomicAction:
        return AtomicAction(
            kind=AtomicActionKind.PRESS_BUTTON,
            button=Button.B,
            duration_ms=120,
            reason=reason,
        )

    @staticmethod
    def _wait(duration_ms: int, reason: str) -> AtomicAction:
        return AtomicAction(
            kind=AtomicActionKind.WAIT,
            duration_ms=duration_ms,
            reason=reason,
        )


class ActionExecutor:
    """Executes macros one atom at a time and re-observes after every input."""

    def __init__(
        self,
        backend: ActionBackend,
        capture: CaptureBackend,
        observe_state: Callable[[], GameState],
        stop_requested: Callable[[], bool],
        settings: ActionSettings,
    ) -> None:
        self.backend = backend
        self.capture = capture
        self.observe_state = observe_state
        self.stop_requested = stop_requested
        self.settings = settings

    def execute(self, macro: ActionMacro, before: GameState) -> ActionExecutionResult:
        started = time.perf_counter()
        executed: list[ExecutedAtomicAction] = []
        current = before
        ineffective = 0
        reason: str | None = None
        timed_out = False
        visible_effect = False

        if macro.allowed_scenes and before.scene not in macro.allowed_scenes:
            reason = f"Macro {macro.name.value} is not allowed in {before.scene.value}."
        else:
            for action in macro.actions[: macro.max_inputs]:
                reason = self._safety_interrupt(macro)
                if reason:
                    break
                if time.perf_counter() - started >= macro.timeout_seconds:
                    timed_out = True
                    reason = "macro_timeout"
                    break

                atom_started = datetime.now(UTC)
                try:
                    if action.kind == AtomicActionKind.WAIT_FOR_STABLE:
                        current, wait_reason = self._wait_for(
                            current,
                            lambda state: state.screen_stable,
                            macro.timeout_seconds - (time.perf_counter() - started),
                        )
                    elif action.kind == AtomicActionKind.WAIT_FOR_STATE_CHANGE:
                        original = current.fingerprint()
                        current, wait_reason = self._wait_for(
                            current,
                            partial(_fingerprint_changed, baseline=original),
                            macro.timeout_seconds - (time.perf_counter() - started),
                        )
                    else:
                        self.backend.reset()
                        self.backend.perform(action)
                        if self.settings.post_input_observation_delay_ms:
                            time.sleep(self.settings.post_input_observation_delay_ms / 1000)
                        previous = current
                        current = self.observe_state()
                        changed = current.fingerprint() != previous.fingerprint()
                        visible_effect = visible_effect or changed
                        ineffective = 0 if changed else ineffective + 1
                        wait_reason = None
                except Exception as exc:  # hardware boundary must fail closed
                    reason = f"action_error:{type(exc).__name__}:{exc}"
                    self.backend.reset()
                    break

                executed.append(
                    ExecutedAtomicAction(
                        action=action,
                        started_at=atom_started,
                        finished_at=datetime.now(UTC),
                        status="completed" if wait_reason is None else wait_reason,
                    )
                )
                if wait_reason:
                    reason = wait_reason
                    break
                reason = self._state_interrupt(macro, before, current, ineffective)
                if reason:
                    break
                if macro.stop_after_visible_change and visible_effect:
                    break

        self.backend.reset()
        latency = (time.perf_counter() - started) * 1000
        expected_interrupt = reason in {
            AbortCondition.DIALOGUE_APPEARED.value,
            AbortCondition.BATTLE_STARTED.value,
            AbortCondition.MENU_OPENED.value,
            AbortCondition.TRANSITION_STARTED.value,
        } and (not macro.expected_scenes or current.scene in macro.expected_scenes)
        input_actions = any(
            action.kind in {AtomicActionKind.PRESS_BUTTON, AtomicActionKind.MOVE}
            for action in macro.actions
        )
        if reason is None and input_actions and not visible_effect:
            reason = "no_visible_effect"
        if reason is None and macro.expected_scenes and current.scene not in macro.expected_scenes:
            reason = "unexpected_state"
        success = (reason is None or expected_interrupt) and not timed_out
        return ActionExecutionResult(
            macro=macro.name,
            before_state=before,
            after_state=current,
            executed_actions=executed,
            success=success,
            interrupted=reason is not None,
            interrupt_reason=reason,
            visible_effect=visible_effect,
            timed_out=timed_out,
            latency_ms=latency,
        )

    def _wait_for(
        self,
        state: GameState,
        predicate: Callable[[GameState], bool],
        timeout: float,
    ) -> tuple[GameState, str | None]:
        deadline = time.perf_counter() + max(timeout, 0.0)
        current = state
        while time.perf_counter() < deadline:
            safety_reason = self._basic_safety()
            if safety_reason:
                return current, safety_reason
            current = self.observe_state()
            if predicate(current):
                return current, None
            time.sleep(0.05)
        return current, "wait_timeout"

    def _basic_safety(self) -> str | None:
        if self.stop_requested():
            return AbortCondition.STOP_REQUESTED.value
        if not self.capture.is_alive():
            return "emulator_closed"
        if not self.capture.is_focused():
            return AbortCondition.WINDOW_FOCUS_LOST.value
        return None

    def _safety_interrupt(self, macro: ActionMacro) -> str | None:
        reason = self._basic_safety()
        if reason == AbortCondition.STOP_REQUESTED.value:
            return reason if AbortCondition.STOP_REQUESTED in macro.abort_conditions else None
        if reason == AbortCondition.WINDOW_FOCUS_LOST.value:
            return reason if AbortCondition.WINDOW_FOCUS_LOST in macro.abort_conditions else None
        return reason

    def _state_interrupt(
        self,
        macro: ActionMacro,
        before: GameState,
        current: GameState,
        ineffective: int,
    ) -> str | None:
        checks = [
            (
                AbortCondition.DIALOGUE_APPEARED,
                before.scene not in DIALOGUE_SCENES and current.scene in DIALOGUE_SCENES,
            ),
            (
                AbortCondition.BATTLE_STARTED,
                before.scene not in BATTLE_SCENES and current.scene in BATTLE_SCENES,
            ),
            (
                AbortCondition.MENU_OPENED,
                before.scene not in MENU_SCENES and current.scene in MENU_SCENES,
            ),
            (
                AbortCondition.TRANSITION_STARTED,
                not before.transition_active and current.transition_active,
            ),
            (
                AbortCondition.NO_EFFECT_LIMIT,
                ineffective >= self.settings.max_ineffective_inputs,
            ),
        ]
        for condition, triggered in checks:
            if triggered and condition in macro.abort_conditions:
                return condition.value
        return None
