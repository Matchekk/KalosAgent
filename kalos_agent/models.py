from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

import numpy as np
from pydantic import BaseModel, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(UTC)


class ScreenLayoutMode(StrEnum):
    VERTICAL = "vertical"
    HORIZONTAL = "horizontal"
    CUSTOM = "custom"


class ScreenName(StrEnum):
    FULL = "full"
    TOP = "top"
    BOTTOM = "bottom"


class RegionName(StrEnum):
    TOP_SCREEN = "top_screen"
    BOTTOM_SCREEN = "bottom_screen"
    DIALOGUE = "dialogue"
    LOCATION_NAME = "location_name"
    BATTLE_TEXT = "battle_text"
    BATTLE_MENU = "battle_menu"
    BOTTOM_MENU = "bottom_menu"


class CropRect(BaseModel):
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    normalized: bool = True

    def pixels(self, image_width: int, image_height: int) -> tuple[int, int, int, int]:
        if self.normalized:
            values = (
                round(self.x * image_width),
                round(self.y * image_height),
                round(self.width * image_width),
                round(self.height * image_height),
            )
        else:
            values = (round(self.x), round(self.y), round(self.width), round(self.height))
        x, y, width, height = values
        x = min(max(x, 0), max(image_width - 1, 0))
        y = min(max(y, 0), max(image_height - 1, 0))
        width = min(max(width, 1), max(image_width - x, 1))
        height = min(max(height, 1), max(image_height - y, 1))
        return x, y, width, height


class RegionDefinition(BaseModel):
    screen: ScreenName
    rect: CropRect
    text_region: bool = False


@dataclass(slots=True)
class ScreenFrame:
    full_frame: np.ndarray
    top_screen: np.ndarray
    bottom_screen: np.ndarray
    timestamp: datetime
    frame_id: str
    regions: dict[str, np.ndarray] = field(default_factory=dict)


class EvidenceSource(StrEnum):
    TELEMETRY = "telemetry"
    DETERMINISTIC = "deterministic_ui"
    OCR = "ocr"
    VISION = "vision_llm"
    MEMORY = "memory"


EVIDENCE_PRIORITY: dict[EvidenceSource, int] = {
    EvidenceSource.TELEMETRY: 5,
    EvidenceSource.DETERMINISTIC: 4,
    EvidenceSource.OCR: 3,
    EvidenceSource.VISION: 2,
    EvidenceSource.MEMORY: 1,
}


class Evidence(BaseModel):
    source: EvidenceSource
    value: str
    confidence: float = Field(ge=0.0, le=1.0)
    region: str | None = None


class Scene(StrEnum):
    TITLE = "TITLE"
    LOADING = "LOADING"
    DIALOGUE = "DIALOGUE"
    CHOICE_DIALOGUE = "CHOICE_DIALOGUE"
    MAIN_MENU = "MAIN_MENU"
    PARTY_MENU = "PARTY_MENU"
    BAG_MENU = "BAG_MENU"
    BATTLE = "BATTLE"
    BATTLE_MOVE_MENU = "BATTLE_MOVE_MENU"
    BATTLE_PARTY_MENU = "BATTLE_PARTY_MENU"
    OVERWORLD = "OVERWORLD"
    CUTSCENE = "CUTSCENE"
    NAMING_SCREEN = "NAMING_SCREEN"
    TOUCH_MENU = "TOUCH_MENU"
    UNKNOWN = "UNKNOWN"


class OCRLine(BaseModel):
    text: str
    score: float = Field(ge=0.0, le=1.0)
    box: list[int] | None = None
    region: str | None = None


class DialogueState(BaseModel):
    active: bool = False
    text: str = ""
    has_choices: bool = False


class MenuState(BaseModel):
    active: bool = False
    kind: str | None = None
    options: list[str] = Field(default_factory=list)
    selected_index: int | None = None


class BattleState(BaseModel):
    active: bool = False
    menu: str | None = None
    player_hp_text: str | None = None
    opponent_name: str | None = None


class OverworldState(BaseModel):
    active: bool = False
    location_name: str | None = None
    movement_detected: bool = False


class TitleState(BaseModel):
    active: bool = False
    game: str | None = None


class TelemetrySnapshot(BaseModel):
    available: bool = False
    values: dict[str, Any] = Field(default_factory=dict)
    captured_at: datetime = Field(default_factory=utc_now)


class VisionObservation(BaseModel):
    scene: Scene = Scene.UNKNOWN
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    description: str = ""
    evidence: list[Evidence] = Field(default_factory=list)
    raw_response: str | None = None
    latency_ms: float = 0.0


class GameState(BaseModel):
    captured_at: datetime = Field(default_factory=utc_now)
    frame_id: str
    scene: Scene = Scene.UNKNOWN
    scene_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    screen_stable: bool = False
    transition_active: bool = False
    dialogue: DialogueState = Field(default_factory=DialogueState)
    menu: MenuState = Field(default_factory=MenuState)
    battle: BattleState = Field(default_factory=BattleState)
    overworld: OverworldState = Field(default_factory=OverworldState)
    title: TitleState = Field(default_factory=TitleState)
    detected_text: list[OCRLine] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    uncertainty: float = Field(default=1.0, ge=0.0, le=1.0)
    fast_hash: str = ""
    perceptual_hash: str = ""
    active_regions: list[str] = Field(default_factory=list)
    changed_regions: list[str] = Field(default_factory=list)
    telemetry: TelemetrySnapshot = Field(default_factory=TelemetrySnapshot)
    canonical_battle: dict[str, Any] | None = None
    navigation_context: dict[str, Any] | None = None

    def normalized_text(self) -> str:
        text = " ".join(line.text for line in self.detected_text).lower()
        return " ".join(re.sub(r"[^\wäöüß]+", " ", text).split())

    def fingerprint(self, *, objective: str = "", recent_actions: list[str] | None = None) -> str:
        payload = {
            "scene": self.scene.value,
            "text": self.normalized_text(),
            "phash": self.perceptual_hash,
            "regions": sorted(self.active_regions),
            "actions": (recent_actions or [])[-4:],
            "objective": objective.strip().lower(),
            "telemetry": self.telemetry.values if self.telemetry.available else None,
        }
        encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
        return hashlib.sha256(encoded).hexdigest()[:24]


class RegionChange(BaseModel):
    region: str
    changed: bool
    mean_delta: float = Field(ge=0.0, le=1.0)
    hash_changed: bool
    perceptual_distance: int = Field(ge=0)


class PerceptionEvent(BaseModel):
    frame_id: str
    stable: bool
    transition_active: bool
    new_state_candidate: bool
    changes: dict[str, RegionChange] = Field(default_factory=dict)
    changed_text_regions: list[str] = Field(default_factory=list)


class Button(StrEnum):
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


class Direction(StrEnum):
    UP = "UP"
    DOWN = "DOWN"
    LEFT = "LEFT"
    RIGHT = "RIGHT"


class AtomicActionKind(StrEnum):
    PRESS_BUTTON = "press_button"
    MOVE = "move"
    WAIT = "wait"
    WAIT_FOR_STABLE = "wait_for_stable_frame"
    WAIT_FOR_STATE_CHANGE = "wait_for_state_change"


class AtomicAction(BaseModel):
    kind: AtomicActionKind
    button: Button | None = None
    direction: Direction | None = None
    duration_ms: int = Field(default=160, ge=20, le=3000)
    reason: str = Field(default="", max_length=300)

    @model_validator(mode="after")
    def validate_payload(self) -> AtomicAction:
        if self.kind == AtomicActionKind.PRESS_BUTTON and self.button is None:
            raise ValueError("press_button requires a button")
        if self.kind == AtomicActionKind.MOVE and self.direction is None:
            raise ValueError("move requires a direction")
        return self


class MacroName(StrEnum):
    PRESS_BUTTON = "press_button"
    PRESS_SEQUENCE = "press_sequence"
    MOVE_BURST = "move_burst"
    INTERACT = "interact"
    CANCEL = "cancel"
    ADVANCE_DIALOGUE = "advance_dialogue"
    WAIT_FOR_STABLE_FRAME = "wait_for_stable_frame"
    WAIT_FOR_STATE_CHANGE = "wait_for_state_change"
    CLOSE_MENU_SAFELY = "close_menu_safely"
    WAIT = "wait"


class AbortCondition(StrEnum):
    DIALOGUE_APPEARED = "dialogue_appeared"
    BATTLE_STARTED = "battle_started"
    MENU_OPENED = "menu_opened"
    TRANSITION_STARTED = "transition_started"
    WINDOW_FOCUS_LOST = "window_focus_lost"
    STOP_REQUESTED = "stop_requested"
    NO_EFFECT_LIMIT = "no_effect_limit"


DEFAULT_ABORT_CONDITIONS = [
    AbortCondition.DIALOGUE_APPEARED,
    AbortCondition.BATTLE_STARTED,
    AbortCondition.MENU_OPENED,
    AbortCondition.TRANSITION_STARTED,
    AbortCondition.WINDOW_FOCUS_LOST,
    AbortCondition.STOP_REQUESTED,
    AbortCondition.NO_EFFECT_LIMIT,
]


class ActionMacro(BaseModel):
    name: MacroName
    actions: list[AtomicAction] = Field(default_factory=list, max_length=12)
    allowed_scenes: set[Scene] = Field(default_factory=set)
    expected_scenes: set[Scene] = Field(default_factory=set)
    timeout_seconds: float = Field(default=5.0, gt=0.0, le=60.0)
    abort_conditions: list[AbortCondition] = Field(
        default_factory=lambda: list(DEFAULT_ABORT_CONDITIONS)
    )
    max_inputs: int = Field(default=4, ge=0, le=12)
    reason: str = Field(default="", max_length=500)
    stop_after_visible_change: bool = False


class ActionPlan(BaseModel):
    state_summary: str = Field(max_length=500)
    immediate_goal: str = Field(max_length=300)
    confidence: float = Field(ge=0.0, le=1.0)
    macro: MacroName = MacroName.WAIT
    actions: list[AtomicAction] = Field(default_factory=list, max_length=8)
    assumptions: list[str] = Field(default_factory=list, max_length=8)
    expected_state_changes: list[Scene] = Field(default_factory=list, max_length=8)
    abort_conditions: list[AbortCondition] = Field(
        default_factory=lambda: list(DEFAULT_ABORT_CONDITIONS)
    )
    progress_signals: list[str] = Field(default_factory=list, max_length=8)
    fallback: MacroName = MacroName.WAIT
    memory_updates: list[str] = Field(default_factory=list, max_length=8)
    needs_human: bool = False

    @classmethod
    def safe_wait(cls, reason: str, *, needs_human: bool = False) -> ActionPlan:
        return cls(
            state_summary="Safe planner fallback",
            immediate_goal="Wait for a safe, stable observation.",
            confidence=0.0,
            macro=MacroName.WAIT,
            actions=[
                AtomicAction(
                    kind=AtomicActionKind.WAIT,
                    duration_ms=400,
                    reason=reason[:300],
                )
            ],
            assumptions=[],
            expected_state_changes=[],
            progress_signals=[],
            fallback=MacroName.WAIT,
            needs_human=needs_human,
        )


class ExecutedAtomicAction(BaseModel):
    action: AtomicAction
    started_at: datetime
    finished_at: datetime
    status: str


class ActionExecutionResult(BaseModel):
    macro: MacroName
    before_state: GameState
    after_state: GameState
    executed_actions: list[ExecutedAtomicAction] = Field(default_factory=list)
    success: bool
    interrupted: bool = False
    interrupt_reason: str | None = None
    visible_effect: bool = False
    timed_out: bool = False
    latency_ms: float = 0.0


class PlannerRequest(BaseModel):
    state: GameState
    objective: str
    working_memory: dict[str, Any] = Field(default_factory=dict)
    episodic_memory: list[dict[str, Any]] = Field(default_factory=list)
    durable_memory: list[dict[str, Any]] = Field(default_factory=list)
    failed_strategies: list[dict[str, Any]] = Field(default_factory=list)
    previous_plan: ActionPlan | None = None
    recovery_level: int = Field(default=0, ge=0, le=7)
    image_b64: str | None = None


class PlannerResult(BaseModel):
    plan: ActionPlan
    raw_response: str = ""
    valid_json: bool = True
    repaired: bool = False
    latency_ms: float = 0.0
    error: str | None = None


class ObjectiveStatus(StrEnum):
    PENDING = "pending"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"


class Objective(BaseModel):
    id: int | None = None
    description: str
    reason: str
    expected_result: str
    status: ObjectiveStatus = ObjectiveStatus.PENDING
    priority: int = Field(default=50, ge=0, le=100)
    parent_id: int | None = None
    progress_criterion: str


class ProgressAssessment(BaseModel):
    score: float = Field(ge=-1.0, le=1.0)
    progressed: bool
    state_changed: bool
    text_changed: bool
    location_changed: bool
    action_effective: bool
    loop_detected: bool = False
    loop_kind: str | None = None
    recovery_level: int = Field(default=0, ge=0, le=7)
    signals: list[str] = Field(default_factory=list)


class CycleRecord(BaseModel):
    cycle_id: str
    episode_id: str
    before_state: GameState
    planner_request: PlannerRequest | None = None
    planner_result: PlannerResult | None = None
    validated_plan: ActionPlan
    execution: ActionExecutionResult | None = None
    after_state: GameState | None = None
    progress: ProgressAssessment | None = None
    latencies_ms: dict[str, float] = Field(default_factory=dict)
    counters: dict[str, int] = Field(default_factory=dict)
    errors: list[str] = Field(default_factory=list)
    normalized_ui_regions: dict[str, dict[str, Any]] = Field(default_factory=dict)
    recognized_entities: list[dict[str, Any]] = Field(default_factory=list)
    battle_state: dict[str, Any] | None = None
    opponent_belief: dict[str, Any] | None = None
    damage_distributions: list[dict[str, Any]] = Field(default_factory=list)
    battle_search_tree: dict[str, Any] | None = None
    selected_battle_action: dict[str, Any] | None = None
    actual_battle_result: dict[str, Any] | None = None
    navigation_node: dict[str, Any] | None = None
    navigation_edge: dict[str, Any] | None = None
    evaluation_labels: dict[str, float | int | bool | str] = Field(default_factory=dict)
