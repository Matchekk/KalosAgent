"""LLM interface for strategic planning."""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional
import json

from .state import GameState
from .tasks import Task


@dataclass
class LLMConfig:
    model: str = "llama3.2:3b"
    temperature: float = 0.7
    max_tokens: int = 256
    base_url: str = "http://localhost:11434"  # Ollama default


@dataclass
class TaskHistory:
    task: Task
    success: bool
    steps: int
    failure_reason: str = ""


class LLMBackend(ABC):
    """Abstract base class for LLM backends."""

    @abstractmethod
    def generate(self, prompt: str) -> str:
        """Generate response from prompt."""
        pass


class OllamaBackend(LLMBackend):
    """Ollama backend for local LLMs."""

    def __init__(self, config: LLMConfig):
        self.config = config
        try:
            import httpx
            self.client = httpx.Client(timeout=60.0)
        except ImportError:
            raise ImportError("httpx not installed. Run: pip install httpx")

    def generate(self, prompt: str) -> str:
        response = self.client.post(
            f"{self.config.base_url}/api/generate",
            json={
                "model": self.config.model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": self.config.temperature,
                    "num_predict": self.config.max_tokens,
                },
            },
        )
        response.raise_for_status()
        return response.json()["response"]


class OpenAIBackend(LLMBackend):
    """OpenAI-compatible API backend (works with OpenAI, Groq, Together, etc.)."""

    def __init__(self, config: LLMConfig, api_key: str = ""):
        self.config = config
        self.api_key = api_key
        try:
            import httpx
            self.client = httpx.Client(timeout=60.0)
        except ImportError:
            raise ImportError("httpx not installed. Run: pip install httpx")

    def generate(self, prompt: str) -> str:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        response = self.client.post(
            f"{self.config.base_url}/chat/completions",
            headers=headers,
            json={
                "model": self.config.model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]


class LlamaCppBackend(LLMBackend):
    """llama.cpp server backend (e.g., from Threadfork).

    The llama-server provides an OpenAI-compatible API.
    Default endpoint: http://localhost:8080

    To use with Threadfork's bundled server:
        /Applications/threadfork.app/Contents/MacOS/llama-server \
            -m "/path/to/model.gguf" \
            --port 8080
    """

    THREADFORK_SERVER = "/Applications/threadfork.app/Contents/MacOS/llama-server"
    THREADFORK_MODELS = "/Users/sid/Library/Application Support/ai.threadfork.app/models"

    def __init__(self, config: LLMConfig, model_path: str = ""):
        self.config = config
        self.model_path = model_path
        self.server_process = None
        try:
            import httpx
            self.client = httpx.Client(timeout=120.0)
        except ImportError:
            raise ImportError("httpx not installed. Run: pip install httpx")

    def generate(self, prompt: str) -> str:
        response = self.client.post(
            f"{self.config.base_url}/v1/chat/completions",
            headers={"Content-Type": "application/json"},
            json={
                "messages": [{"role": "user", "content": prompt}],
                "temperature": self.config.temperature,
                "max_tokens": self.config.max_tokens,
            },
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    def start_server(self, model_path: str = None, port: int = 8080):
        """Start the llama-server with specified model."""
        import subprocess
        import os

        model = model_path or self.model_path
        if not model:
            # Default to Threadfork's Qwen model
            model = os.path.join(self.THREADFORK_MODELS, "Qwen3-4B-Q4_K_M.gguf")

        if not os.path.exists(model):
            raise FileNotFoundError(f"Model not found: {model}")

        if not os.path.exists(self.THREADFORK_SERVER):
            raise FileNotFoundError(f"llama-server not found: {self.THREADFORK_SERVER}")

        self.server_process = subprocess.Popen(
            [self.THREADFORK_SERVER, "-m", model, "--port", str(port), "-c", "4096"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        # Update config URL
        self.config.base_url = f"http://localhost:{port}"
        print(f"Started llama-server on port {port} with model: {os.path.basename(model)}")

        # Wait a moment for server to start
        import time
        time.sleep(3)

    def stop_server(self):
        """Stop the llama-server if we started it."""
        if self.server_process:
            self.server_process.terminate()
            self.server_process = None


SYSTEM_PROMPT = """You are playing Pokemon Red. Your goal is to complete the game efficiently.

You will receive the current game state and must issue ONE task at a time.

Available task types:
- navigate: Go to a location (e.g., "navigate | Oak's Lab")
- catch: Catch a Pokemon (e.g., "catch | Pikachu")
- train: Train party to a level (e.g., "train | level 14")
- battle: Fight a trainer/gym (e.g., "battle | Brock")
- buy: Purchase items (e.g., "buy | 5 Potions")
- use_item: Use an item (e.g., "use_item | Potion on Pikachu")
- talk: Talk to an NPC (e.g., "talk | Professor Oak")

IMPORTANT EARLY GAME SEQUENCE:
1. If you have NO Pokemon, you MUST go to Oak's Lab in Pallet Town and talk to Professor Oak to get your starter
2. After getting starter, deliver Oak's Parcel from Viridian City Mart
3. Then you can proceed to train and battle gyms

Respond with ONLY the task in this format:
TASK: type | target | brief reason

Example:
TASK: navigate | Oak's Lab | Need to get starter Pokemon from Professor Oak"""


# Map ID to location name mapping for Pokemon Red
MAP_NAMES = {
    0: "Pallet Town",
    1: "Viridian City",
    2: "Pewter City",
    3: "Cerulean City",
    12: "Route 1",
    13: "Route 2",
    14: "Route 3",
    33: "Route 22",
    37: "Red's House 1F",
    38: "Red's House 2F",
    39: "Blue's House",
    40: "Oak's Lab",
    41: "Viridian Pokemon Center",
    42: "Viridian Mart",
    43: "Viridian School",
    44: "Viridian House",
    51: "Viridian Forest",
    52: "Pewter Museum 1F",
    54: "Pewter Gym",
    55: "Pewter House 1",
    56: "Pewter Mart",
    57: "Pewter House 2",
    58: "Pewter Pokemon Center",
    59: "Mt. Moon 1F",
    60: "Mt. Moon B1F",
    61: "Mt. Moon B2F",
    65: "Cerulean House 1",
    66: "Cerulean Pokemon Center",
    67: "Cerulean Gym",
    68: "Cerulean Bike Shop",
    69: "Cerulean Mart",
}


class Planner:
    """LLM-based strategic planner."""

    def __init__(
        self,
        backend: LLMBackend,
        strategy_guide: Optional[dict] = None,
    ):
        self.backend = backend
        self.strategy_guide = strategy_guide or {}
        self.task_history: list[TaskHistory] = []

    def get_next_task(
        self,
        state: GameState,
        objective: str,
        failure_context: Optional[str] = None,
    ) -> str:
        """Query LLM for next task."""
        prompt = self._build_prompt(state, objective, failure_context)
        return self.backend.generate(prompt)

    def record_task_result(
        self,
        task: Task,
        success: bool,
        steps: int,
        failure_reason: str = "",
    ):
        """Record task outcome for history."""
        self.task_history.append(
            TaskHistory(
                task=task,
                success=success,
                steps=steps,
                failure_reason=failure_reason,
            )
        )
        # Keep last 10 tasks
        if len(self.task_history) > 10:
            self.task_history = self.task_history[-10:]

    def _build_prompt(
        self,
        state: GameState,
        objective: str,
        failure_context: Optional[str] = None,
    ) -> str:
        """Build prompt with game state and context."""
        parts = [SYSTEM_PROMPT, ""]

        # Current objective
        parts.append(f"CURRENT OBJECTIVE: {objective}")
        parts.append("")

        # Game state
        location_name = MAP_NAMES.get(state.map_id, f"Unknown Area (Map {state.map_id})")
        parts.append("GAME STATE:")
        parts.append(f"- Location: {location_name} ({state.player_x}, {state.player_y})")
        parts.append(f"- Party: {state.party_summary()}")
        parts.append(f"- Badges: {state.badge_count}/8")
        parts.append(f"- Money: ${state.money}")
        if state.in_battle:
            parts.append(f"- IN BATTLE (Enemy HP: {state.enemy_hp})")
        parts.append("")

        # Recent task history
        if self.task_history:
            parts.append("RECENT TASKS:")
            for h in self.task_history[-5:]:
                status = "OK" if h.success else "FAILED"
                parts.append(f"- {h.task.to_prompt()} [{status}, {h.steps} steps]")
                if h.failure_reason:
                    parts.append(f"  Reason: {h.failure_reason}")
            parts.append("")

        # Failure context (if re-planning)
        if failure_context:
            parts.append(f"FAILURE CONTEXT: {failure_context}")
            parts.append("")

        # Strategy hint (if available)
        hint = self._get_strategy_hint(state, objective)
        if hint:
            parts.append(f"STRATEGY HINT: {hint}")
            parts.append("")

        parts.append("What is the next task?")

        return "\n".join(parts)

    def _get_strategy_hint(self, state: GameState, objective: str) -> str:
        """Get relevant hint from strategy guide."""
        # Early game hints
        if len(state.party) == 0:
            if state.map_id in [37, 38]:  # Red's House
                return "You're in your house. Go downstairs and head south to Oak's Lab to get your starter Pokemon."
            elif state.map_id == 0:  # Pallet Town
                return "You're in Pallet Town. Oak's Lab is the large building at the south of town. Go there to get your starter."
            elif state.map_id == 40:  # Oak's Lab
                return "You're in Oak's Lab! Talk to Professor Oak and choose a starter Pokemon from the Pokeballs on the table."
            else:
                return "You have no Pokemon! You must return to Pallet Town and visit Oak's Lab to get your starter."

        # After getting starter
        if state.badge_count == 0 and len(state.party) > 0:
            if state.map_id == 40:  # Oak's Lab
                return "Now head north through Route 1 to Viridian City to get Oak's Parcel from the Mart."
            elif state.map_id in [0, 12]:  # Pallet/Route 1
                return "Head north to Viridian City. The Mart there has Oak's Parcel."
            elif state.map_id in [1, 41, 42]:  # Viridian area
                return "Get Oak's Parcel from the Mart, then return it to Oak. After that, head to Pewter City for the first gym."

        return ""
