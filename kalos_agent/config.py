from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, Field


class WindowSettings(BaseModel):
    title_contains: str = "Azahar"


class CaptureSettings(BaseModel):
    vlm_max_width: int = Field(default=1024, ge=320, le=4096)
    jpeg_quality: int = Field(default=82, ge=30, le=100)
    debug_dir: Path = Path("debug")


class OCRSettings(BaseModel):
    enabled: bool = True
    backend: Literal["auto", "vllm", "llamacpp"] = "auto"
    inference_url: str | None = None
    parallel: int = Field(default=1, ge=1, le=32)
    min_score: float = Field(default=0.45, ge=0.0, le=1.0)
    upscale: float = Field(default=2.0, ge=1.0, le=4.0)


class PlannerSettings(BaseModel):
    model: str = "qwen3.5:9b"
    host: str = "http://localhost:11434"
    use_vision: bool = True
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    recent_memory_items: int = Field(default=8, ge=0, le=50)


class AgentSettings(BaseModel):
    decision_interval_seconds: float = Field(default=1.0, ge=0.1, le=60.0)
    unchanged_wait_seconds: float = Field(default=0.7, ge=0.0, le=10.0)
    max_steps_per_plan: int = Field(default=6, ge=1, le=12)
    max_action_duration_ms: int = Field(default=1000, ge=50, le=3000)
    repeated_frame_limit: int = Field(default=8, ge=2, le=100)
    dry_run: bool = True


class MemorySettings(BaseModel):
    database_path: Path = Path("data/kalos_agent.sqlite3")


class AppConfig(BaseModel):
    window: WindowSettings = WindowSettings()
    capture: CaptureSettings = CaptureSettings()
    ocr: OCRSettings = OCRSettings()
    planner: PlannerSettings = PlannerSettings()
    agent: AgentSettings = AgentSettings()
    memory: MemorySettings = MemorySettings()


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
