"""Experiment configuration."""

from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional, Literal
import json


@dataclass
class EmulatorConfig:
    rom_path: str = "pokemon_red.gb"
    headless: bool = True
    speed: int = 0  # 0 = uncapped
    save_state_path: Optional[str] = None  # Start from save state
    frame_skip: int = 4  # Frames per action (pure RL loop)
    action_hold_frames: int = 8
    action_release_frames: int = 4


@dataclass
class LLMConfig:
    backend: str = "ollama"  # "ollama" | "openai" | "llamacpp"
    model: str = "llama3.2:3b"
    base_url: str = "http://localhost:11434"
    api_key: str = ""  # For OpenAI-compatible APIs
    model_path: str = ""  # For llama.cpp: path to .gguf file
    temperature: float = 0.7
    max_tokens: int = 256
    enabled: bool = True  # Ignored in pure_rl mode


@dataclass
class PolicyConfig:
    state_dim: int = 64
    task_dim: int = 32
    hidden_dim: int = 128
    learning_rate: float = 1e-3
    epsilon_start: float = 0.3
    epsilon_end: float = 0.05
    epsilon_decay: float = 0.995
    train_every: int = 100  # Train every N steps
    batch_size: int = 32
    load_weights: Optional[str] = None  # Path to pre-trained weights
    ignore_task: bool = False  # Pure-RL mode: ignore task conditioning


@dataclass
class TaskConfig:
    default_budget: int = 1000  # Max steps per task
    replan_on_failure: bool = True
    max_replans: int = 3
    enabled: bool = True  # Ignored in pure_rl mode


@dataclass
class UnitTestRewardsConfig:
    """Configuration for deterministic unit-test-style rewards."""
    enabled: bool = True
    bundles_path: str = "data/test-bundles.json"
    enable_tier1: bool = True
    enable_tier2: bool = True
    enable_tier3: bool = True
    enable_penalties: bool = True
    tier1_weight: float = 1.0
    tier2_weight: float = 1.0
    tier3_weight: float = 1.0
    penalty_weight: float = 1.0
    use_once_constraints: bool = True
    reward_decay: float = 0.0


@dataclass
class ExperimentConfig:
    name: str = "default"
    description: str = ""

    # Execution mode
    agent_mode: Literal["hierarchical_llm", "pure_rl"] = "hierarchical_llm"
    reward_mode: Literal["shaping", "unit_tests", "mixed"] = "shaping"
    seed: int = 42

    # Target checkpoint (0 = as far as possible)
    target_checkpoint: int = 0
    max_steps: int = 100000

    # Component configs
    emulator: EmulatorConfig = field(default_factory=EmulatorConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    policy: PolicyConfig = field(default_factory=PolicyConfig)
    task: TaskConfig = field(default_factory=TaskConfig)
    unit_tests: UnitTestRewardsConfig = field(default_factory=UnitTestRewardsConfig)

    # Output
    runs_dir: str = "runs"
    save_checkpoints: bool = True
    checkpoint_interval: int = 1  # Save state every N checkpoints

    def to_dict(self) -> dict:
        """Convert to dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "ExperimentConfig":
        """Create from dictionary."""
        return cls(
            name=data.get("name", "default"),
            description=data.get("description", ""),
            agent_mode=data.get("agent_mode", "hierarchical_llm"),
            reward_mode=data.get("reward_mode", "shaping"),
            seed=data.get("seed", 42),
            target_checkpoint=data.get("target_checkpoint", 0),
            max_steps=data.get("max_steps", 100000),
            emulator=EmulatorConfig(**data.get("emulator", {})),
            llm=LLMConfig(**data.get("llm", {})),
            policy=PolicyConfig(**data.get("policy", {})),
            task=TaskConfig(**data.get("task", {})),
            unit_tests=UnitTestRewardsConfig(**data.get("unit_tests", {})),
            runs_dir=data.get("runs_dir", "runs"),
            save_checkpoints=data.get("save_checkpoints", True),
            checkpoint_interval=data.get("checkpoint_interval", 1),
        )

    @classmethod
    def from_file(cls, path: str | Path) -> "ExperimentConfig":
        """Load config from JSON file."""
        with open(path) as f:
            data = json.load(f)
        return cls.from_dict(data)

    def save(self, path: str | Path):
        """Save config to JSON file."""
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, indent=2)


# Default checkpoints from strategy guide (through Misty for MVP)
CHECKPOINTS = [
    {"id": 1, "name": "Get starter Pokemon", "badge_required": 0},
    {"id": 2, "name": "Reach Viridian City", "badge_required": 0},
    {"id": 3, "name": "Deliver Oak's Parcel", "badge_required": 0},
    {"id": 4, "name": "Get Pokedex", "badge_required": 0},
    {"id": 5, "name": "Reach Viridian Forest", "badge_required": 0},
    {"id": 6, "name": "Reach Pewter City", "badge_required": 0},
    {"id": 7, "name": "Defeat Brock (Boulder Badge)", "badge_required": 1},
    {"id": 8, "name": "Reach Mt. Moon", "badge_required": 1},
    {"id": 9, "name": "Complete Mt. Moon", "badge_required": 1},
    {"id": 10, "name": "Reach Cerulean City", "badge_required": 1},
    {"id": 11, "name": "Defeat Rival on Nugget Bridge", "badge_required": 1},
    {"id": 12, "name": "Get HM01 Cut", "badge_required": 1},
    {"id": 13, "name": "Defeat Misty (Cascade Badge)", "badge_required": 2},
    # ... more checkpoints for full game
]
