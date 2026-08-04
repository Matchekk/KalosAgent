from __future__ import annotations

import time
from typing import Any

from .models import AtomicAction, AtomicActionKind, Button, Direction


class ControllerUnavailableError(RuntimeError):
    """Raised when live input was requested but vgamepad is unavailable."""


class VirtualGamepadActionBackend:
    """Safety-bounded vgamepad adapter. It never decides which action to run."""

    def __init__(self, *, dry_run: bool = True, max_duration_ms: int = 1000) -> None:
        self.dry_run = dry_run
        self.max_duration_ms = max_duration_ms
        self._gamepad: Any | None = None
        self._vg: Any | None = None
        if not dry_run:
            try:
                import vgamepad as vg
            except ImportError as exc:  # pragma: no cover - hardware dependency
                raise ControllerUnavailableError(
                    "Live mode needs vgamepad. Install the controller extra first."
                ) from exc
            self._vg = vg
            self._gamepad = vg.VX360Gamepad()
            self.reset()

    def is_ready(self) -> bool:
        return self.dry_run or self._gamepad is not None

    def reset(self) -> None:
        if self._gamepad is None:
            return
        self._gamepad.reset()
        self._gamepad.update()

    def perform(self, action: AtomicAction) -> None:
        duration_ms = min(action.duration_ms, self.max_duration_ms)
        if self.dry_run:
            return
        if self._gamepad is None or self._vg is None:
            raise ControllerUnavailableError("The virtual controller is not initialized.")

        self.reset()
        if action.kind == AtomicActionKind.WAIT:
            time.sleep(duration_ms / 1000)
            return
        if action.kind in {
            AtomicActionKind.WAIT_FOR_STABLE,
            AtomicActionKind.WAIT_FOR_STATE_CHANGE,
        }:
            return
        if action.kind == AtomicActionKind.PRESS_BUTTON:
            button = self._button(action.button)
            self._gamepad.press_button(button=button)
            self._gamepad.update()
            time.sleep(duration_ms / 1000)
            self.reset()
            return
        if action.kind == AtomicActionKind.MOVE:
            x, y = self._direction(action.direction)
            self._gamepad.left_joystick(x_value=x, y_value=y)
            self._gamepad.update()
            time.sleep(duration_ms / 1000)
            self.reset()

    def _button(self, button: Button | None) -> Any:
        assert self._vg is not None
        mapping = {
            Button.A: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_A,
            Button.B: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_B,
            Button.X: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_X,
            Button.Y: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_Y,
            Button.START: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_START,
            Button.SELECT: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_BACK,
            Button.L: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_LEFT_SHOULDER,
            Button.R: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_RIGHT_SHOULDER,
            Button.DPAD_UP: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_UP,
            Button.DPAD_DOWN: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_DOWN,
            Button.DPAD_LEFT: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_LEFT,
            Button.DPAD_RIGHT: self._vg.XUSB_BUTTON.XUSB_GAMEPAD_DPAD_RIGHT,
        }
        if button not in mapping:
            raise ValueError(f"Unsupported button: {button}")
        return mapping[button]

    @staticmethod
    def _direction(direction: Direction | None) -> tuple[int, int]:
        mapping = {
            Direction.UP: (0, 32767),
            Direction.DOWN: (0, -32768),
            Direction.LEFT: (-32768, 0),
            Direction.RIGHT: (32767, 0),
        }
        if direction not in mapping:
            raise ValueError(f"Unsupported direction: {direction}")
        return mapping[direction]

    def close(self) -> None:
        try:
            self.reset()
        finally:
            self._gamepad = None
