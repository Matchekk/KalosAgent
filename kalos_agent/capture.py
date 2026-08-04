from __future__ import annotations

import ctypes
import hashlib
from pathlib import Path

import cv2
import mss
import numpy as np

try:
    import win32gui
except ImportError as exc:  # pragma: no cover - platform-specific
    raise RuntimeError("KalosAgent window capture currently requires Windows.") from exc


def _enable_dpi_awareness() -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            return


_enable_dpi_awareness()


class WindowNotFoundError(RuntimeError):
    pass


class AzaharCapture:
    def __init__(self, title_contains: str) -> None:
        self.title_contains = title_contains.lower()
        self._sct = mss.mss()
        self.hwnd = self._find_window()

    def _find_window(self) -> int:
        matches: list[tuple[int, str]] = []

        def callback(hwnd: int, _: object) -> None:
            if not win32gui.IsWindowVisible(hwnd):
                return
            title = win32gui.GetWindowText(hwnd)
            if self.title_contains in title.lower():
                matches.append((hwnd, title))

        win32gui.EnumWindows(callback, None)
        if not matches:
            raise WindowNotFoundError(
                f'No visible window contains "{self.title_contains}" in its title.'
            )

        # Prefer the largest matching client area.
        def area(item: tuple[int, str]) -> int:
            hwnd, _ = item
            left, top, right, bottom = win32gui.GetClientRect(hwnd)
            return max(0, right - left) * max(0, bottom - top)

        matches.sort(key=area, reverse=True)
        return matches[0][0]

    def refresh_window(self) -> None:
        if not win32gui.IsWindow(self.hwnd):
            self.hwnd = self._find_window()

    def client_screen_rect(self) -> tuple[int, int, int, int]:
        self.refresh_window()
        left, top, right, bottom = win32gui.GetClientRect(self.hwnd)
        screen_left, screen_top = win32gui.ClientToScreen(self.hwnd, (left, top))
        screen_right, screen_bottom = win32gui.ClientToScreen(
            self.hwnd, (right, bottom)
        )
        width = screen_right - screen_left
        height = screen_bottom - screen_top
        if width <= 0 or height <= 0:
            raise RuntimeError("Azahar client area has no usable size.")
        return screen_left, screen_top, width, height

    def grab(self) -> np.ndarray:
        left, top, width, height = self.client_screen_rect()
        shot = self._sct.grab(
            {"left": left, "top": top, "width": width, "height": height}
        )
        bgra = np.asarray(shot, dtype=np.uint8)
        return bgra[:, :, :3].copy()  # BGR

    def save(self, path: str | Path) -> Path:
        output = Path(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        frame = self.grab()
        if not cv2.imwrite(str(output), frame):
            raise RuntimeError(f"Could not save screenshot to {output}")
        return output

    def close(self) -> None:
        self._sct.close()


def frame_hash(frame: np.ndarray) -> str:
    small = cv2.resize(frame, (64, 64), interpolation=cv2.INTER_AREA)
    return hashlib.sha1(small.tobytes()).hexdigest()


def frame_change(previous: np.ndarray | None, current: np.ndarray) -> float:
    if previous is None:
        return 1.0
    prev = cv2.resize(previous, (64, 64), interpolation=cv2.INTER_AREA)
    curr = cv2.resize(current, (64, 64), interpolation=cv2.INTER_AREA)
    diff = np.mean(np.abs(curr.astype(np.float32) - prev.astype(np.float32))) / 255.0
    return float(np.clip(diff, 0.0, 1.0))


def encode_jpeg(frame: np.ndarray, max_width: int, quality: int) -> bytes:
    if frame.shape[1] > max_width:
        scale = max_width / frame.shape[1]
        frame = cv2.resize(
            frame,
            (max_width, max(1, int(frame.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("Could not encode screenshot as JPEG.")
    return encoded.tobytes()
