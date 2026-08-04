from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field

from .models import (
    CropRect,
    RegionDefinition,
    RegionName,
    ScreenLayoutMode,
    ScreenName,
)


def default_regions() -> dict[str, RegionDefinition]:
    return {
        RegionName.DIALOGUE.value: RegionDefinition(
            screen=ScreenName.TOP,
            rect=CropRect(x=0.03, y=0.66, width=0.94, height=0.31),
            text_region=True,
        ),
        RegionName.LOCATION_NAME.value: RegionDefinition(
            screen=ScreenName.TOP,
            rect=CropRect(x=0.12, y=0.02, width=0.76, height=0.18),
            text_region=True,
        ),
        RegionName.BATTLE_TEXT.value: RegionDefinition(
            screen=ScreenName.TOP,
            rect=CropRect(x=0.02, y=0.68, width=0.96, height=0.30),
            text_region=True,
        ),
        RegionName.BATTLE_MENU.value: RegionDefinition(
            screen=ScreenName.BOTTOM,
            rect=CropRect(x=0.0, y=0.0, width=1.0, height=1.0),
            text_region=True,
        ),
        RegionName.BOTTOM_MENU.value: RegionDefinition(
            screen=ScreenName.BOTTOM,
            rect=CropRect(x=0.0, y=0.0, width=1.0, height=1.0),
            text_region=True,
        ),
    }


class WindowSettings(BaseModel):
    title_contains: str = "Azahar"
    min_width: int = Field(default=320, ge=100)
    min_height: int = Field(default=400, ge=100)


class ScreenLayoutSettings(BaseModel):
    mode: ScreenLayoutMode = ScreenLayoutMode.VERTICAL
    top_crop: CropRect | None = None
    bottom_crop: CropRect | None = None
    split_ratio: float = Field(default=0.5, gt=0.1, lt=0.9)
    regions: dict[str, RegionDefinition] = Field(default_factory=default_regions)


class CaptureSettings(BaseModel):
    capture_hz: float = Field(default=10.0, ge=1.0, le=60.0)
    vlm_max_width: int = Field(default=1280, ge=320, le=4096)
    jpeg_quality: int = Field(default=84, ge=30, le=100)
    debug_dir: Path = Path("debug")
    save_region_debug: bool = False
    layout: ScreenLayoutSettings = Field(default_factory=ScreenLayoutSettings)


class ChangeSettings(BaseModel):
    mean_delta_threshold: float = Field(default=0.018, ge=0.0, le=1.0)
    stable_delta_threshold: float = Field(default=0.004, ge=0.0, le=1.0)
    transition_delta_threshold: float = Field(default=0.12, ge=0.0, le=1.0)
    perceptual_distance_threshold: int = Field(default=5, ge=0, le=64)
    stable_frames_required: int = Field(default=3, ge=1, le=30)
    animation_debounce_frames: int = Field(default=3, ge=1, le=30)


class OCRSettings(BaseModel):
    enabled: bool = True
    provider: Literal["paddle", "fake"] = "paddle"
    device: str = "cpu"
    detection_model: str = "PP-OCRv6_small_det"
    recognition_model: str = "PP-OCRv6_small_rec"
    min_score: float = Field(default=0.50, ge=0.0, le=1.0)
    upscale: float = Field(default=2.0, ge=1.0, le=4.0)
    worker_threads: int = Field(default=1, ge=1, le=4)
    text_regions: list[str] = Field(
        default_factory=lambda: [
            RegionName.DIALOGUE.value,
            RegionName.LOCATION_NAME.value,
            RegionName.BATTLE_TEXT.value,
            RegionName.BATTLE_MENU.value,
            RegionName.BOTTOM_MENU.value,
        ]
    )


class VisionSettings(BaseModel):
    enabled: bool = True
    model: str = "gemma4:12b"
    host: str = "http://localhost:11434"
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    keep_alive: str = "30m"
    context_size: int = Field(default=8192, ge=2048, le=262144)
    uncertainty_threshold: float = Field(default=0.38, ge=0.0, le=1.0)
    no_progress_trigger: int = Field(default=3, ge=1, le=100)


class PlannerSettings(BaseModel):
    backend: Literal["ollama", "openai", "fake"] = "ollama"
    model: str = "gemma4:12b"
    host: str = "http://localhost:11434"
    api_key: str = ""
    use_vision: bool = True
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    context_size: int = Field(default=8192, ge=2048, le=262144)
    keep_alive: str = "30m"
    max_output_tokens: int = Field(default=1200, ge=128, le=8192)
    recent_memory_items: int = Field(default=8, ge=0, le=50)
    repair_invalid_json: bool = True
    thinking: bool = True


class ActionSettings(BaseModel):
    max_steps_per_plan: int = Field(default=6, ge=1, le=12)
    max_action_duration_ms: int = Field(default=1000, ge=20, le=3000)
    max_ineffective_inputs: int = Field(default=3, ge=1, le=20)
    macro_timeout_seconds: float = Field(default=8.0, ge=0.5, le=60.0)
    post_input_observation_delay_ms: int = Field(default=180, ge=0, le=3000)


class AgentSettings(BaseModel):
    dry_run: bool = True
    stop_file: Path = Path("STOP")
    arm_countdown_seconds: int = Field(default=3, ge=0, le=30)
    state_hysteresis_frames: int = Field(default=2, ge=1, le=20)
    high_confidence_scene_switch: float = Field(default=0.90, ge=0.0, le=1.0)
    initial_objective: str = "Reach the starter-selection sequence safely."
    action: ActionSettings = Field(default_factory=ActionSettings)


class MemorySettings(BaseModel):
    database_path: Path = Path("data/kalos_agent.sqlite3")
    working_memory_size: int = Field(default=12, ge=1, le=100)


class ReplaySettings(BaseModel):
    root_dir: Path = Path("data/replays")
    save_screenshots: bool = True
    save_regions: bool = True


class KnowledgeSettings(BaseModel):
    database_path: Path = Path("data/knowledge/gen6-xy.sqlite3")
    cache_dir: Path = Path("data/knowledge/pokeapi-cache")
    base_url: str = "https://pokeapi.co/api/v2"


class BattleIntelligenceSettings(BaseModel):
    enabled: bool = True
    use_llm_strategy: bool = False
    learning_database_path: Path = Path("data/battle-learning.sqlite3")
    beam_width: int = Field(default=4, ge=1, le=12)
    opponent_width: int = Field(default=4, ge=1, le=12)
    search_horizon: int = Field(default=1, ge=1, le=3)


class NavigationSettings(BaseModel):
    enabled: bool = True
    database_path: Path = Path("data/navigation.sqlite3")
    keyframe_dir: Path = Path("data/navigation-keyframes")
    node_match_threshold: float = Field(default=0.92, ge=0.0, le=1.0)
    landmark_match_threshold: float = Field(default=0.94, ge=0.0, le=1.0)
    stable_recognitions: int = Field(default=3, ge=2, le=20)


class ShowdownSettings(BaseModel):
    enabled: bool = False
    battle_format: str = "gen6randombattle"
    server_url: str = "ws://localhost:8000/showdown/websocket"
    authentication_url: str = "http://localhost:8000/action.php?"


class AppConfig(BaseModel):
    window: WindowSettings = Field(default_factory=WindowSettings)
    capture: CaptureSettings = Field(default_factory=CaptureSettings)
    change: ChangeSettings = Field(default_factory=ChangeSettings)
    ocr: OCRSettings = Field(default_factory=OCRSettings)
    vision: VisionSettings = Field(default_factory=VisionSettings)
    planner: PlannerSettings = Field(default_factory=PlannerSettings)
    agent: AgentSettings = Field(default_factory=AgentSettings)
    memory: MemorySettings = Field(default_factory=MemorySettings)
    replay: ReplaySettings = Field(default_factory=ReplaySettings)
    knowledge: KnowledgeSettings = Field(default_factory=KnowledgeSettings)
    battle_intelligence: BattleIntelligenceSettings = Field(
        default_factory=BattleIntelligenceSettings
    )
    navigation: NavigationSettings = Field(default_factory=NavigationSettings)
    showdown: ShowdownSettings = Field(default_factory=ShowdownSettings)


def load_config(path: str | Path) -> AppConfig:
    config_path = Path(path)
    if not config_path.exists():
        raise FileNotFoundError(
            f"Configuration file not found: {config_path}. "
            "Copy config.example.yaml to config.yaml first."
        )
    with config_path.open("r", encoding="utf-8") as handle:
        raw: dict[str, Any] = yaml.safe_load(handle) or {}
    return AppConfig.model_validate(raw)
