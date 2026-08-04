from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np

from .backends import OCRBackend
from .capture import fast_frame_hash, frame_change, hash_distance, perceptual_hash
from .config import ChangeSettings, OCRSettings
from .models import OCRLine, PerceptionEvent, RegionChange, ScreenFrame


class FrameChangeDetector:
    def __init__(self, settings: ChangeSettings) -> None:
        self.settings = settings
        self._previous: dict[str, np.ndarray] = {}
        self._fast_hashes: dict[str, str] = {}
        self._perceptual_hashes: dict[str, str] = {}
        self._stable_streak = 0
        self._animation_streak = 0

    def analyze(self, frame: ScreenFrame) -> PerceptionEvent:
        images = {
            "top_screen": frame.top_screen,
            "bottom_screen": frame.bottom_screen,
            **frame.regions,
        }
        changes: dict[str, RegionChange] = {}
        for name, image in images.items():
            quick = fast_frame_hash(image)
            perceptual = perceptual_hash(image)
            previous = self._previous.get(name)
            delta = frame_change(previous, image)
            distance = hash_distance(self._perceptual_hashes.get(name, ""), perceptual)
            hash_changed = quick != self._fast_hashes.get(name)
            changed = previous is None or (
                delta >= self.settings.mean_delta_threshold
                and (hash_changed or distance >= self.settings.perceptual_distance_threshold)
            )
            changes[name] = RegionChange(
                region=name,
                changed=changed,
                mean_delta=delta,
                hash_changed=hash_changed,
                perceptual_distance=distance,
            )
            self._previous[name] = image.copy()
            self._fast_hashes[name] = quick
            self._perceptual_hashes[name] = perceptual

        screen_delta = max(
            changes["top_screen"].mean_delta,
            changes["bottom_screen"].mean_delta,
        )
        if screen_delta <= self.settings.stable_delta_threshold:
            self._stable_streak += 1
            self._animation_streak = 0
        else:
            self._stable_streak = 0
            self._animation_streak += 1
        stable = self._stable_streak >= self.settings.stable_frames_required
        transition = screen_delta >= self.settings.transition_delta_threshold or (
            self._animation_streak >= self.settings.animation_debounce_frames and not stable
        )
        text_regions = [
            name
            for name, change in changes.items()
            if name not in {"top_screen", "bottom_screen"} and change.changed
        ]
        return PerceptionEvent(
            frame_id=frame.frame_id,
            stable=stable,
            transition_active=transition,
            new_state_candidate=stable and any(change.changed for change in changes.values()),
            changes=changes,
            changed_text_regions=text_regions,
        )


@dataclass(slots=True)
class OCRBatchResult:
    lines: list[OCRLine]
    calls: int
    latency_ms: float


class EventDrivenOCR:
    def __init__(self, backend: OCRBackend, settings: OCRSettings) -> None:
        self.backend = backend
        self.settings = settings
        self._cache: dict[str, list[OCRLine]] = {}
        self._executor = ThreadPoolExecutor(
            max_workers=settings.worker_threads,
            thread_name_prefix="kalos-ocr",
        )

    def process(
        self,
        frame: ScreenFrame,
        event: PerceptionEvent,
        *,
        force: bool = False,
    ) -> OCRBatchResult:
        started = time.perf_counter()
        calls = 0
        if event.transition_active and not force:
            cached = [line for lines in self._cache.values() for line in lines]
            return OCRBatchResult(cached, 0, (time.perf_counter() - started) * 1000)

        candidates = []
        for name in self.settings.text_regions:
            if name not in frame.regions:
                continue
            if force or name not in self._cache or name in event.changed_text_regions:
                candidates.append(name)
        futures = {
            name: self._executor.submit(self.backend.recognize, frame.regions[name], region=name)
            for name in candidates
        }
        for name, future in futures.items():
            self._cache[name] = future.result()
            calls += 1
        lines = [line for name in self.settings.text_regions for line in self._cache.get(name, [])]
        return OCRBatchResult(lines, calls, (time.perf_counter() - started) * 1000)

    def close(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=True)
        self.backend.close()
