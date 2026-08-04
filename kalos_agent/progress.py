from __future__ import annotations

from collections import Counter, deque
from dataclasses import dataclass

from .models import (
    ActionExecutionResult,
    ActionPlan,
    GameState,
    MacroName,
    ProgressAssessment,
    Scene,
)


@dataclass(slots=True)
class LoopFinding:
    detected: bool = False
    kind: str | None = None
    detail: str = ""


class LoopDetector:
    def __init__(self, history_size: int = 24) -> None:
        self.fingerprints: deque[str] = deque(maxlen=history_size)
        self.scenes: deque[Scene] = deque(maxlen=history_size)
        self.macros: deque[MacroName] = deque(maxlen=history_size)
        self.plan_signatures: deque[str] = deque(maxlen=history_size)
        self.effects: deque[bool] = deque(maxlen=history_size)

    def record(
        self,
        state: GameState,
        plan: ActionPlan,
        execution: ActionExecutionResult,
        *,
        objective: str = "",
    ) -> LoopFinding:
        self.fingerprints.append(
            state.fingerprint(
                objective=objective,
                recent_actions=[macro.value for macro in self.macros],
            )
        )
        self.scenes.append(state.scene)
        self.macros.append(plan.macro)
        self.plan_signatures.append(
            f"{plan.macro.value}:{','.join(action.kind.value for action in plan.actions)}"
        )
        self.effects.append(execution.visible_effect)
        return self.detect()

    def detect(self) -> LoopFinding:
        if len(self.fingerprints) >= 4 and len(set(list(self.fingerprints)[-4:])) == 1:
            return LoopFinding(True, "unchanged_state", "Same observation repeated four times.")
        if len(self.fingerprints) >= 6:
            fingerprint_tail = list(self.fingerprints)[-6:]
            scene_tail = list(self.scenes)[-6:]
            fingerprint_cycle = (
                fingerprint_tail[0] == fingerprint_tail[2] == fingerprint_tail[4]
                and fingerprint_tail[1] == fingerprint_tail[3] == fingerprint_tail[5]
            )
            scene_cycle = (
                scene_tail[0] == scene_tail[2] == scene_tail[4]
                and scene_tail[1] == scene_tail[3] == scene_tail[5]
                and scene_tail[0] != scene_tail[1]
            )
            if fingerprint_cycle or scene_cycle:
                return LoopFinding(True, "a_b_cycle", "Observation alternates between two states.")
        if len(self.macros) >= 6:
            macro_tail = list(self.macros)[-6:]
            if (
                macro_tail[0] == macro_tail[2] == macro_tail[4]
                and macro_tail[1] == macro_tail[3] == macro_tail[5]
            ):
                if (
                    macro_tail[0] == MacroName.CLOSE_MENU_SAFELY
                    or macro_tail[1] == MacroName.CLOSE_MENU_SAFELY
                ):
                    return LoopFinding(
                        True, "menu_toggle", "A menu is repeatedly opened and closed."
                    )
                return LoopFinding(True, "repeated_action_cycle", "Two action macros alternate.")
        if len(self.macros) >= 4:
            macros = list(self.macros)[-4:]
            effects = list(self.effects)[-4:]
            if all(macro == MacroName.MOVE_BURST for macro in macros) and not any(effects):
                return LoopFinding(
                    True, "movement_without_change", "Movement had no visible effect."
                )
            if all(macro == MacroName.INTERACT for macro in macros):
                return LoopFinding(True, "repeated_interaction", "Same interaction repeated.")
        if len(self.plan_signatures) >= 4:
            signatures = list(self.plan_signatures)[-4:]
            if len(set(signatures)) == 1 and not any(list(self.effects)[-4:]):
                return LoopFinding(True, "failed_plan", "Same ineffective plan repeated.")
        return LoopFinding()


class ProgressTracker:
    def __init__(self) -> None:
        self.no_progress_streak = 0
        self.loop_streak = 0

    def assess(
        self,
        before: GameState,
        after: GameState,
        execution: ActionExecutionResult,
        loop: LoopFinding | None = None,
    ) -> ProgressAssessment:
        state_changed = before.scene != after.scene
        text_changed = before.normalized_text() != after.normalized_text()
        location_changed = (
            before.overworld.location_name != after.overworld.location_name
            and after.overworld.location_name is not None
        )
        hash_changed = before.perceptual_hash != after.perceptual_hash
        action_effective = execution.visible_effect or state_changed or text_changed or hash_changed
        signals: list[str] = []
        score = 0.0
        for signal, value, weight in (
            ("scene_changed", state_changed, 0.35),
            ("text_changed", text_changed, 0.20),
            ("location_changed", location_changed, 0.35),
            ("visual_change", hash_changed, 0.10),
        ):
            if value:
                signals.append(signal)
                score += weight
        if not action_effective:
            score -= 0.25
            signals.append("no_visible_effect")
        finding = loop or LoopFinding()
        if finding.detected:
            score -= 0.50
            signals.append(f"loop:{finding.kind}")
            self.loop_streak += 1
        else:
            self.loop_streak = 0
        progressed = score > 0.15 and not finding.detected
        self.no_progress_streak = 0 if progressed else self.no_progress_streak + 1
        return ProgressAssessment(
            score=max(-1.0, min(1.0, score)),
            progressed=progressed,
            state_changed=state_changed,
            text_changed=text_changed,
            location_changed=location_changed,
            action_effective=action_effective,
            loop_detected=finding.detected,
            loop_kind=finding.kind,
            recovery_level=self.recovery_level,
            signals=signals,
        )

    @property
    def recovery_level(self) -> int:
        return min(7, max(self.no_progress_streak, self.loop_streak + 1) - 1)


class RecoveryPolicy:
    """Context-aware recovery ladder; it never sends a blanket B in battle."""

    @staticmethod
    def plan(level: int, state: GameState) -> ActionPlan | None:
        if level <= 2:
            return ActionPlan.safe_wait(
                [
                    "Short recovery wait.",
                    "Force a fresh state capture.",
                    "Discard the previous state assumption.",
                ][max(level, 0)]
            )
        if level == 3:
            if state.scene == Scene.DIALOGUE:
                return ActionPlan(
                    state_summary="Recovery from a dialogue state.",
                    immediate_goal="Advance one bounded dialogue page and reassess.",
                    confidence=0.7,
                    macro=MacroName.ADVANCE_DIALOGUE,
                    progress_signals=["dialogue text changes", "dialogue closes"],
                )
            if state.scene not in {Scene.OVERWORLD, Scene.TITLE, Scene.UNKNOWN}:
                return ActionPlan.safe_wait(
                    "No shorter recovery action is safe in the current scene."
                )
            return ActionPlan(
                state_summary="Recovery with a shorter alternative action.",
                immediate_goal="Try one bounded interaction and re-observe.",
                confidence=0.35,
                macro=MacroName.INTERACT,
                progress_signals=["new dialogue", "new scene"],
            )
        if level == 4:
            if state.scene in {
                Scene.MAIN_MENU,
                Scene.PARTY_MENU,
                Scene.BAG_MENU,
                Scene.TOUCH_MENU,
            }:
                return ActionPlan(
                    state_summary="A non-battle menu is blocking progress.",
                    immediate_goal="Close the menu and reassess.",
                    confidence=0.8,
                    macro=MacroName.CLOSE_MENU_SAFELY,
                    expected_state_changes=[Scene.OVERWORLD],
                )
            return ActionPlan.safe_wait("Menu recovery is unsafe in the current scene.")
        if level in {5, 6}:
            return None  # runtime asks the planner to re-plan with failure context
        return ActionPlan.safe_wait("Recovery exhausted; pause for human review.", needs_human=True)


def most_common_scene(states: list[GameState]) -> Scene:
    if not states:
        return Scene.UNKNOWN
    return Counter(state.scene for state in states).most_common(1)[0][0]
