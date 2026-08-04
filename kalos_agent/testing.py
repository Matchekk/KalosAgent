from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime

import numpy as np

from .models import (
    ActionPlan,
    AtomicAction,
    OCRLine,
    PlannerRequest,
    PlannerResult,
    Scene,
    ScreenFrame,
    TelemetrySnapshot,
    VisionObservation,
)


def synthetic_frame(
    value: int = 0,
    *,
    frame_id: str | None = None,
    width: int = 400,
    height: int = 480,
) -> ScreenFrame:
    full = np.full((height, width, 3), value, dtype=np.uint8)
    split = height // 2
    top = full[:split].copy()
    bottom = full[split:].copy()
    return ScreenFrame(
        full_frame=full,
        top_screen=top,
        bottom_screen=bottom,
        timestamp=datetime.now(UTC),
        frame_id=frame_id or f"fake-{value}",
        regions={
            "top_screen": top,
            "bottom_screen": bottom,
            "dialogue": top[int(split * 0.65) :].copy(),
            "location_name": top[: int(split * 0.2)].copy(),
            "battle_text": top[int(split * 0.65) :].copy(),
            "battle_menu": bottom.copy(),
            "bottom_menu": bottom.copy(),
        },
    )


class FakeCaptureBackend:
    def __init__(self, frames: list[ScreenFrame] | None = None) -> None:
        self.frames = frames or [synthetic_frame()]
        self.index = 0
        self.alive = True
        self.focused = True
        self.valid = True
        self.closed = False

    def capture(self) -> ScreenFrame:
        frame = self.frames[min(self.index, len(self.frames) - 1)]
        self.index += 1
        return frame

    def is_alive(self) -> bool:
        return self.alive

    def is_focused(self) -> bool:
        return self.focused

    def validate_window(self) -> bool:
        return self.valid

    def close(self) -> None:
        self.closed = True


class FakeOCRBackend:
    def __init__(
        self,
        results: dict[str, list[OCRLine]] | None = None,
        callback: Callable[[np.ndarray, str], list[OCRLine]] | None = None,
    ) -> None:
        self.results = results or {}
        self.callback = callback
        self.calls: list[str] = []

    def recognize(self, image: np.ndarray, *, region: str) -> list[OCRLine]:
        self.calls.append(region)
        if self.callback:
            return self.callback(image, region)
        return [line.model_copy(update={"region": region}) for line in self.results.get(region, [])]

    def close(self) -> None:
        return


class FakeVisionBackend:
    def __init__(self, observation: VisionObservation | None = None) -> None:
        self.observation = observation or VisionObservation(
            scene=Scene.OVERWORLD,
            confidence=0.8,
            description="Synthetic overworld.",
        )
        self.calls = 0

    def observe(self, state: object, image_bytes: bytes) -> VisionObservation:
        self.calls += 1
        return self.observation

    def close(self) -> None:
        return


class FakePlannerBackend:
    def __init__(self, plan: ActionPlan | None = None, raw: str = "{}") -> None:
        self.plan_value = plan or ActionPlan.safe_wait("Fake planner")
        self.raw = raw
        self.requests: list[PlannerRequest] = []

    def plan(self, request: PlannerRequest) -> PlannerResult:
        self.requests.append(request)
        return PlannerResult(plan=self.plan_value, raw_response=self.raw)

    def close(self) -> None:
        return


class FakeActionBackend:
    def __init__(self, *, dry_run: bool = True) -> None:
        self.dry_run = dry_run
        self.actions: list[AtomicAction] = []
        self.reset_calls = 0
        self.ready = True
        self.closed = False

    def perform(self, action: AtomicAction) -> None:
        self.actions.append(action)

    def reset(self) -> None:
        self.reset_calls += 1

    def is_ready(self) -> bool:
        return self.ready

    def close(self) -> None:
        self.closed = True


class FakeTelemetryProvider:
    def __init__(self, snapshot: TelemetrySnapshot | None = None) -> None:
        self.snapshot = snapshot or TelemetrySnapshot()

    def read(self) -> TelemetrySnapshot:
        return self.snapshot

    def close(self) -> None:
        return
