from __future__ import annotations

from datetime import UTC, datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class ActionName(str, Enum):
    WAIT = "WAIT"
    A = "A"
    B = "B"
    X = "X"
    Y = "Y"
    START = "START"
    SELECT = "SELECT"
    L = "L"
    R = "R"
    DPAD_UP = "DPAD_UP"
    DPAD_DOWN = "DPAD_DOWN"
    DPAD_LEFT = "DPAD_LEFT"
    DPAD_RIGHT = "DPAD_RIGHT"
    MOVE_UP = "MOVE_UP"
    MOVE_DOWN = "MOVE_DOWN"
    MOVE_LEFT = "MOVE_LEFT"
    MOVE_RIGHT = "MOVE_RIGHT"


class ActionStep(BaseModel):
    action: ActionName
    duration_ms: int = Field(default=160, ge=50, le=3000)
    reason: str = Field(default="", max_length=200)


class ActionPlan(BaseModel):
    state_summary: str = Field(max_length=500)
    immediate_goal: str = Field(max_length=300)
    confidence: float = Field(ge=0.0, le=1.0)
    steps: list[ActionStep] = Field(default_factory=list, max_length=12)
    memory_updates: list[str] = Field(default_factory=list, max_length=8)
    needs_human: bool = False

    @model_validator(mode="after")
    def ensure_a_step(self) -> ActionPlan:
        if not self.steps:
            self.steps = [
                ActionStep(
                    action=ActionName.WAIT,
                    duration_ms=300,
                    reason="No action was supplied; wait safely.",
                )
            ]
        return self


class OCRLine(BaseModel):
    text: str
    score: float = Field(ge=0.0, le=1.0)
    box: list[int] | None = None


class Observation(BaseModel):
    timestamp: str
    frame_hash: str
    frame_change: float = Field(ge=0.0, le=1.0)
    state_hint: Literal[
        "title", "dialogue", "battle", "menu", "overworld", "transition", "unknown"
    ] = "unknown"
    ocr_lines: list[OCRLine] = Field(default_factory=list)
    repeated_frame_count: int = 0

    @classmethod
    def now(
        cls,
        *,
        frame_hash: str,
        frame_change: float,
        state_hint: str,
        ocr_lines: list[OCRLine],
        repeated_frame_count: int,
    ) -> Observation:
        return cls(
            timestamp=datetime.now(UTC).isoformat(),
            frame_hash=frame_hash,
            frame_change=frame_change,
            state_hint=state_hint,
            ocr_lines=ocr_lines,
            repeated_frame_count=repeated_frame_count,
        )
