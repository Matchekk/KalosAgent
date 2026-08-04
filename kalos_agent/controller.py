from __future__ import annotations

import time
from dataclasses import dataclass

from .models import ActionName, ActionPlan, ActionStep

try:
    import vgamepad as vg
except ImportError:
    vg = None


@dataclass(frozen=True)
class SafetyLimits:
    max_steps_per_plan: int
    max_action_duration_ms: int


class VirtualController:
    def __init__(self, *, dry_run: bool, limits: SafetyLimits) -> None:
        self.dry_run = dry_run
        self.limits = limits
        self.gamepad = None

        if not self.dry_run:
            if vg is None:
                raise RuntimeError(
                    "vgamepad is not installed or is unavailable on this platform."
                )
            self.gamepad = vg.VX360Gamepad()

    def _button(self, action: ActionName):
        assert vg is not None
        mapping = {
            ActionName.A: vg.XUSB_BUTTON.XUSB_GAMEPAD_A,
            ActionName.B: vg.XUSB_BUTTON.XUSB_GAMEPAD_B,
            ActionName.X: vg.XUSB_BUTTON.XUSB_GAMEPAD_X,
            ActionName.Y: vg.XUSB_BUTTON.XUSB_GAMEPAD_Y,
            ActionName.START: vg.XUSB_BUTTON.XUSB_GAMEPAD_START,
            ActionName.SELECT: vg.XUSB_BUTTON.XUSB_GAMEPAD_BACK,
            ActionName.L: vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER,
            ActionName.R: vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER,
            ActionName.DPAD_UP: vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP,
            ActionName.DPAD_DOWN: vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN,
            ActionName.DPAD_LEFT: vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT,
            ActionName.DPAD_RIGHT: vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT,
        }
        return mapping.get(action)

    def reset(self) -> None:
        if self.gamepad is not None:
            self.gamepad.reset()
            self.gamepad.update()

    def _execute_live(self, step: ActionStep) -> None:
        assert self.gamepad is not None
        duration = min(step.duration_ms, self.limits.max_action_duration_ms) / 1000.0

        if step.action == ActionName.WAIT:
            time.sleep(duration)
            return

        movement = {
            ActionName.MOVE_UP: (0.0, 1.0),
            ActionName.MOVE_DOWN: (0.0, -1.0),
            ActionName.MOVE_LEFT: (-1.0, 0.0),
            ActionName.MOVE_RIGHT: (1.0, 0.0),
        }
        if step.action in movement:
            x_value, y_value = movement[step.action]
            self.gamepad.left_joystick_float(
                x_value_float=x_value, y_value_float=y_value
            )
            self.gamepad.update()
            time.sleep(duration)
            self.reset()
            time.sleep(0.08)
            return

        button = self._button(step.action)
        if button is None:
            raise ValueError(f"Unsupported action: {step.action}")

        self.gamepad.press_button(button=button)
        self.gamepad.update()
        time.sleep(duration)
        self.gamepad.release_button(button=button)
        self.gamepad.update()
        time.sleep(0.08)

    def execute(self, plan: ActionPlan) -> list[dict[str, str | int]]:
        results: list[dict[str, str | int]] = []
        steps = plan.steps[: self.limits.max_steps_per_plan]

        try:
            for step in steps:
                safe_duration = min(
                    step.duration_ms, self.limits.max_action_duration_ms
                )
                if self.dry_run:
                    print(
                        f"[DRY RUN] {step.action.value:<12} "
                        f"{safe_duration:>4} ms — {step.reason}"
                    )
                else:
                    self._execute_live(
                        step.model_copy(update={"duration_ms": safe_duration})
                    )
                results.append(
                    {
                        "action": step.action.value,
                        "duration_ms": safe_duration,
                        "status": "planned" if self.dry_run else "executed",
                    }
                )
        finally:
            self.reset()

        return results
