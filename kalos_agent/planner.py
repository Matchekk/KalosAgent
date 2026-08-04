from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ollama import Client
from pydantic import ValidationError

from .models import ActionName, ActionPlan, ActionStep, Observation


class LocalPlanner:
    def __init__(
        self,
        *,
        model: str,
        host: str,
        use_vision: bool,
        temperature: float,
        system_prompt_path: str | Path = "prompts/system.txt",
    ) -> None:
        self.model = model
        self.use_vision = use_vision
        self.temperature = temperature
        self.client = Client(host=host)
        self.system_prompt = Path(system_prompt_path).read_text(encoding="utf-8")

    @staticmethod
    def _fallback(reason: str) -> ActionPlan:
        return ActionPlan(
            state_summary="Planner fallback",
            immediate_goal="Wait safely and obtain another observation.",
            confidence=0.0,
            steps=[
                ActionStep(
                    action=ActionName.WAIT,
                    duration_ms=500,
                    reason=reason[:200],
                )
            ],
            memory_updates=[],
            needs_human=False,
        )

    def plan(
        self,
        *,
        observation: Observation,
        recent_memory: list[dict[str, Any]],
        image_bytes: bytes | None,
        previous_plan: ActionPlan | None,
    ) -> ActionPlan:
        compact_observation = observation.model_dump()
        prompt = {
            "observation": compact_observation,
            "recent_memory": recent_memory,
            "previous_plan": previous_plan.model_dump() if previous_plan else None,
            "required_output_schema": ActionPlan.model_json_schema(),
        }

        user_message: dict[str, Any] = {
            "role": "user",
            "content": json.dumps(prompt, ensure_ascii=False),
        }
        if self.use_vision and image_bytes:
            user_message["images"] = [image_bytes]

        try:
            response = self.client.chat(
                model=self.model,
                messages=[
                    {"role": "system", "content": self.system_prompt},
                    user_message,
                ],
                format=ActionPlan.model_json_schema(),
                options={"temperature": self.temperature},
                think=False,
                stream=False,
            )
            return ActionPlan.model_validate_json(response.message.content)
        except (ValidationError, ValueError, TypeError, RuntimeError) as exc:
            return self._fallback(f"Planner error: {exc}")
        except Exception as exc:  # noqa: BLE001  # Ollama errors vary by version.
            return self._fallback(f"Ollama unavailable: {exc}")
