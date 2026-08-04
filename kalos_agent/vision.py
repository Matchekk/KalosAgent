from __future__ import annotations

import json
import time

from pydantic import BaseModel, Field

from .inference import OLLAMA_INFERENCE_LOCK
from .models import Evidence, EvidenceSource, GameState, Scene, VisionObservation


class _VisionSchema(BaseModel):
    scene: Scene
    confidence: float = Field(ge=0.0, le=1.0)
    description: str = Field(max_length=500)
    visual_signals: list[str] = Field(default_factory=list, max_length=8)


class OllamaVisionBackend:
    """Serialized Ollama vision inference so concurrent calls cannot contend for VRAM."""

    def __init__(
        self,
        *,
        model: str,
        host: str,
        temperature: float,
        keep_alive: str,
        context_size: int,
    ) -> None:
        try:
            from ollama import Client
        except ImportError as exc:
            raise RuntimeError("The ollama Python package is not installed.") from exc
        self.model = model
        self.temperature = temperature
        self.keep_alive = keep_alive
        self.context_size = context_size
        self._client = Client(host=host)

    def observe(self, state: GameState, image_bytes: bytes) -> VisionObservation:
        started = time.perf_counter()
        prompt = {
            "task": "Classify the current Pokémon X/Y UI scene from the screenshot.",
            "known_state": state.model_dump(mode="json", exclude={"evidence"}),
            "allowed_scenes": [scene.value for scene in Scene],
            "rules": [
                "Use only visible evidence.",
                "Do not propose controller actions.",
                "Keep the description short.",
            ],
        }
        with OLLAMA_INFERENCE_LOCK:
            response = self._client.chat(
                model=self.model,
                messages=[
                    {
                        "role": "user",
                        "content": json.dumps(prompt, ensure_ascii=False),
                        "images": [image_bytes],
                    }
                ],
                format=_VisionSchema.model_json_schema(),
                options={
                    "temperature": self.temperature,
                    "num_ctx": self.context_size,
                },
                keep_alive=self.keep_alive,
                think=False,
                stream=False,
            )
        raw = response.message.content
        parsed = _VisionSchema.model_validate_json(raw)
        return VisionObservation(
            scene=parsed.scene,
            confidence=parsed.confidence,
            description=parsed.description,
            evidence=[
                Evidence(
                    source=EvidenceSource.VISION,
                    value=signal,
                    confidence=parsed.confidence,
                )
                for signal in parsed.visual_signals
            ],
            raw_response=raw,
            latency_ms=(time.perf_counter() - started) * 1000,
        )

    def close(self) -> None:
        return


class NullVisionBackend:
    def observe(self, state: GameState, image_bytes: bytes) -> VisionObservation:
        return VisionObservation()

    def close(self) -> None:
        return
