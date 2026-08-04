from __future__ import annotations

import ctypes
import hashlib
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from .config import CaptureSettings, ScreenLayoutSettings, WindowSettings
from .models import RegionDefinition, ScreenFrame, ScreenLayoutMode, ScreenName


class WindowNotFoundError(RuntimeError):
    pass


def enable_dpi_awareness() -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except (AttributeError, OSError):
            return


def fast_frame_hash(frame: np.ndarray) -> str:
    small = cv2.resize(frame, (32, 32), interpolation=cv2.INTER_AREA)
    return hashlib.blake2b(small.tobytes(), digest_size=8).hexdigest()


def perceptual_hash(frame: np.ndarray) -> str:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if frame.ndim == 3 else frame
    resized = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32)
    coefficients = cv2.dct(resized)[:8, :8]
    median = float(np.median(coefficients[1:]))
    bits = coefficients > median
    value = 0
    for bit in bits.flat:
        value = (value << 1) | int(bit)
    return f"{value:016x}"


def hash_distance(left: str, right: str) -> int:
    if not left or not right:
        return 64
    return (int(left, 16) ^ int(right, 16)).bit_count()


def frame_change(previous: np.ndarray | None, current: np.ndarray) -> float:
    if previous is None:
        return 1.0
    prev = cv2.resize(previous, (64, 64), interpolation=cv2.INTER_AREA)
    curr = cv2.resize(current, (64, 64), interpolation=cv2.INTER_AREA)
    delta = np.mean(np.abs(curr.astype(np.float32) - prev.astype(np.float32))) / 255.0
    return float(np.clip(delta, 0.0, 1.0))


def encode_jpeg(frame: np.ndarray, max_width: int, quality: int) -> bytes:
    image = frame
    if image.shape[1] > max_width:
        scale = max_width / image.shape[1]
        image = cv2.resize(
            image,
            (max_width, max(1, round(image.shape[0] * scale))),
            interpolation=cv2.INTER_AREA,
        )
    ok, encoded = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise RuntimeError("Could not encode screenshot as JPEG.")
    return encoded.tobytes()


class ScreenSegmenter:
    def __init__(self, layout: ScreenLayoutSettings) -> None:
        self.layout = layout

    @staticmethod
    def _crop(image: np.ndarray, definition: RegionDefinition) -> np.ndarray:
        x, y, width, height = definition.rect.pixels(image.shape[1], image.shape[0])
        return image[y : y + height, x : x + width].copy()

    def split(self, full_frame: np.ndarray) -> ScreenFrame:
        if full_frame.ndim != 3 or full_frame.shape[2] < 3:
            raise ValueError("Expected a BGR image with three channels.")
        height, width = full_frame.shape[:2]
        mode = self.layout.mode
        if mode == ScreenLayoutMode.VERTICAL:
            split = min(max(round(height * self.layout.split_ratio), 1), height - 1)
            top = full_frame[:split].copy()
            bottom = full_frame[split:].copy()
        elif mode == ScreenLayoutMode.HORIZONTAL:
            split = min(max(round(width * self.layout.split_ratio), 1), width - 1)
            top = full_frame[:, :split].copy()
            bottom = full_frame[:, split:].copy()
        else:
            if self.layout.top_crop is None or self.layout.bottom_crop is None:
                raise ValueError("Custom screen layout requires top_crop and bottom_crop.")
            top = self._crop(
                full_frame,
                RegionDefinition(screen=ScreenName.FULL, rect=self.layout.top_crop),
            )
            bottom = self._crop(
                full_frame,
                RegionDefinition(screen=ScreenName.FULL, rect=self.layout.bottom_crop),
            )

        sources = {
            ScreenName.FULL: full_frame,
            ScreenName.TOP: top,
            ScreenName.BOTTOM: bottom,
        }
        regions: dict[str, np.ndarray] = {
            "top_screen": top,
            "bottom_screen": bottom,
        }
        for name, definition in self.layout.regions.items():
            regions[name] = self._crop(sources[definition.screen], definition)

        return ScreenFrame(
            full_frame=full_frame.copy(),
            top_screen=top,
            bottom_screen=bottom,
            timestamp=datetime.now(UTC),
            frame_id=f"{fast_frame_hash(full_frame)}-{uuid.uuid4().hex[:8]}",
            regions=regions,
        )

    def debug_overlay(self, frame: ScreenFrame) -> np.ndarray:
        canvas = frame.full_frame.copy()
        full_height, full_width = canvas.shape[:2]
        if self.layout.mode == ScreenLayoutMode.VERTICAL:
            split = round(full_height * self.layout.split_ratio)
            screen_geometry = {
                ScreenName.FULL: (0, 0, full_width, full_height),
                ScreenName.TOP: (0, 0, full_width, split),
                ScreenName.BOTTOM: (0, split, full_width, full_height - split),
            }
        elif self.layout.mode == ScreenLayoutMode.HORIZONTAL:
            split = round(full_width * self.layout.split_ratio)
            screen_geometry = {
                ScreenName.FULL: (0, 0, full_width, full_height),
                ScreenName.TOP: (0, 0, split, full_height),
                ScreenName.BOTTOM: (split, 0, full_width - split, full_height),
            }
        else:
            screen_geometry = {ScreenName.FULL: (0, 0, full_width, full_height)}
            for screen, crop in (
                (ScreenName.TOP, self.layout.top_crop),
                (ScreenName.BOTTOM, self.layout.bottom_crop),
            ):
                assert crop is not None
                screen_geometry[screen] = crop.pixels(full_width, full_height)

        colors = [(50, 220, 50), (255, 180, 0), (220, 80, 220), (30, 180, 255)]
        for index, (name, definition) in enumerate(self.layout.regions.items()):
            base_x, base_y, screen_width, screen_height = screen_geometry[definition.screen]
            x, y, width, height = definition.rect.pixels(screen_width, screen_height)
            color = colors[index % len(colors)]
            cv2.rectangle(
                canvas,
                (base_x + x, base_y + y),
                (base_x + x + width, base_y + y + height),
                color,
                2,
            )
            cv2.putText(
                canvas,
                name,
                (base_x + x + 3, base_y + y + 16),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.45,
                color,
                1,
                cv2.LINE_AA,
            )
        return canvas


class AzaharCaptureBackend:
    def __init__(self, window: WindowSettings, capture: CaptureSettings) -> None:
        enable_dpi_awareness()
        try:
            import mss
            import win32gui
        except ImportError as exc:
            raise RuntimeError("Azahar capture requires mss and pywin32 on Windows.") from exc
        self._mss_module = mss
        self._win32gui: Any = win32gui
        self.window_settings = window
        self.capture_settings = capture
        self.title_contains = window.title_contains.lower()
        self.segmenter = ScreenSegmenter(capture.layout)
        self._sct = mss.mss()
        self.hwnd = self._find_window()

    def _find_window(self) -> int:
        matches: list[tuple[int, str]] = []

        def callback(hwnd: int, _: object) -> None:
            if not self._win32gui.IsWindowVisible(hwnd):
                return
            title = self._win32gui.GetWindowText(hwnd)
            if self.title_contains in title.lower():
                matches.append((hwnd, title))

        self._win32gui.EnumWindows(callback, None)
        if not matches:
            raise WindowNotFoundError(
                f'No visible window contains "{self.title_contains}" in its title.'
            )

        def area(item: tuple[int, str]) -> int:
            left, top, right, bottom = self._win32gui.GetClientRect(item[0])
            return max(0, right - left) * max(0, bottom - top)

        return max(matches, key=area)[0]

    def _client_screen_rect(self) -> tuple[int, int, int, int]:
        if not self.is_alive():
            raise WindowNotFoundError("The Azahar window no longer exists.")
        left, top, right, bottom = self._win32gui.GetClientRect(self.hwnd)
        screen_left, screen_top = self._win32gui.ClientToScreen(self.hwnd, (left, top))
        screen_right, screen_bottom = self._win32gui.ClientToScreen(self.hwnd, (right, bottom))
        return (
            screen_left,
            screen_top,
            screen_right - screen_left,
            screen_bottom - screen_top,
        )

    def capture(self) -> ScreenFrame:
        left, top, width, height = self._client_screen_rect()
        if width <= 0 or height <= 0:
            raise RuntimeError("Azahar client area has no usable size.")
        shot = self._sct.grab({"left": left, "top": top, "width": width, "height": height})
        full = np.asarray(shot, dtype=np.uint8)[:, :, :3].copy()
        frame = self.segmenter.split(full)
        if self.capture_settings.save_region_debug:
            output = self.capture_settings.debug_dir / "regions" / f"{frame.frame_id}.png"
            output.parent.mkdir(parents=True, exist_ok=True)
            cv2.imwrite(str(output), self.segmenter.debug_overlay(frame))
        return frame

    def is_alive(self) -> bool:
        return bool(self._win32gui.IsWindow(self.hwnd))

    def is_focused(self) -> bool:
        return self.is_alive() and self._win32gui.GetForegroundWindow() == self.hwnd

    def validate_window(self) -> bool:
        if not self.is_alive():
            return False
        _, _, width, height = self._client_screen_rect()
        return width >= self.window_settings.min_width and height >= self.window_settings.min_height

    def close(self) -> None:
        self._sct.close()


def save_frame(path: str | Path, frame: np.ndarray) -> Path:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(destination), frame):
        raise RuntimeError(f"Could not save image to {destination}")
    return destination
