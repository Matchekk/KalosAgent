from __future__ import annotations

from typing import Protocol, runtime_checkable

import numpy as np

from .models import (
    AtomicAction,
    GameState,
    OCRLine,
    PlannerRequest,
    PlannerResult,
    ScreenFrame,
    TelemetrySnapshot,
    VisionObservation,
)


@runtime_checkable
class CaptureBackend(Protocol):
    def capture(self) -> ScreenFrame: ...

    def is_alive(self) -> bool: ...

    def is_focused(self) -> bool: ...

    def validate_window(self) -> bool: ...

    def close(self) -> None: ...


@runtime_checkable
class OCRBackend(Protocol):
    def recognize(self, image: np.ndarray, *, region: str) -> list[OCRLine]: ...

    def close(self) -> None: ...


@runtime_checkable
class VisionBackend(Protocol):
    def observe(self, state: GameState, image_bytes: bytes) -> VisionObservation: ...

    def close(self) -> None: ...


@runtime_checkable
class PlannerBackend(Protocol):
    def plan(self, request: PlannerRequest) -> PlannerResult: ...

    def close(self) -> None: ...


@runtime_checkable
class ActionBackend(Protocol):
    dry_run: bool

    def perform(self, action: AtomicAction) -> None: ...

    def reset(self) -> None: ...

    def is_ready(self) -> bool: ...

    def close(self) -> None: ...


@runtime_checkable
class TelemetryProvider(Protocol):
    def read(self) -> TelemetrySnapshot: ...

    def close(self) -> None: ...
