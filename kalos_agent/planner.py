from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .config import PlannerSettings
from .inference import OLLAMA_INFERENCE_LOCK
from .models import (
    ActionPlan,
    GameState,
    MacroName,
    PlannerRequest,
    PlannerResult,
    Scene,
)

DEFAULT_SYSTEM_PROMPT = """You are the strategic planner for a local Pokémon X/Y agent.
You receive structured state and memory only; you cannot capture screens or control the game.
Return exactly one short JSON ActionPlan. Prefer one bounded macro. Never invent telemetry.
Respect the current scene, abort conditions, and failed strategies. WAIT when uncertain.
Do not use cancel/close_menu during a battle and do not emit long button sequences.
"""


def deterministic_plan(state: GameState) -> ActionPlan | None:
    """Handle routine UI without spending a vision/planner model call."""
    if state.transition_active or not state.screen_stable:
        return ActionPlan(
            state_summary="The screen is changing or not stable yet.",
            immediate_goal="Wait for a stable frame.",
            confidence=1.0,
            macro=MacroName.WAIT_FOR_STABLE_FRAME,
            progress_signals=["stable frame"],
        )
    if state.scene == Scene.DIALOGUE:
        return ActionPlan(
            state_summary="A non-choice dialogue is visible.",
            immediate_goal="Advance exactly one changed dialogue page.",
            confidence=0.95,
            macro=MacroName.ADVANCE_DIALOGUE,
            expected_state_changes=[Scene.DIALOGUE, Scene.OVERWORLD, Scene.CUTSCENE],
            progress_signals=["dialogue text changes", "dialogue closes"],
        )
    if state.scene == Scene.TITLE:
        return ActionPlan(
            state_summary="The title screen is visible.",
            immediate_goal="Press A once to continue.",
            confidence=0.90,
            macro=MacroName.INTERACT,
            expected_state_changes=[Scene.LOADING, Scene.OVERWORLD, Scene.DIALOGUE],
            progress_signals=["title screen closes"],
        )
    return None


class _PlannerParser:
    @staticmethod
    def parse(raw: str) -> ActionPlan:
        return ActionPlan.model_validate_json(raw)

    @staticmethod
    def payload(request: PlannerRequest) -> dict[str, Any]:
        return {
            "state": request.state.model_dump(mode="json"),
            "objective": request.objective,
            "working_memory": request.working_memory,
            "episodic_memory": request.episodic_memory,
            "durable_memory": request.durable_memory,
            "failed_strategies": request.failed_strategies,
            "previous_plan": (
                request.previous_plan.model_dump(mode="json") if request.previous_plan else None
            ),
            "recovery_level": request.recovery_level,
            "schema": ActionPlan.model_json_schema(),
        }


class OllamaPlannerBackend:
    def __init__(
        self,
        settings: PlannerSettings,
        system_prompt_path: str | Path = "prompts/system.txt",
    ) -> None:
        try:
            from ollama import Client
        except ImportError as exc:
            raise RuntimeError("The ollama Python package is not installed.") from exc
        self.settings = settings
        self._client = Client(host=settings.host)
        prompt_path = Path(system_prompt_path)
        self.system_prompt = (
            prompt_path.read_text(encoding="utf-8")
            if prompt_path.exists()
            else DEFAULT_SYSTEM_PROMPT
        )

    def plan(self, request: PlannerRequest) -> PlannerResult:
        started = time.perf_counter()
        user: dict[str, Any] = {
            "role": "user",
            "content": json.dumps(_PlannerParser.payload(request), ensure_ascii=False),
        }
        if self.settings.use_vision and request.image_b64:
            user["images"] = [request.image_b64]
        try:
            raw = self._chat(
                [
                    {"role": "system", "content": self.system_prompt},
                    user,
                ],
                thinking=self.settings.thinking,
            )
            try:
                plan = _PlannerParser.parse(raw)
                return self._result(plan, raw, started)
            except (ValidationError, ValueError) as initial_error:
                if not self.settings.repair_invalid_json:
                    raise initial_error
                repaired_raw = self._chat(
                    [
                        {
                            "role": "system",
                            "content": "Repair the provided value into only valid ActionPlan JSON.",
                        },
                        {
                            "role": "user",
                            "content": json.dumps(
                                {
                                    "invalid": raw,
                                    "validation_error": str(initial_error),
                                    "schema": ActionPlan.model_json_schema(),
                                },
                                ensure_ascii=False,
                            ),
                        },
                    ],
                    thinking=False,
                )
                plan = _PlannerParser.parse(repaired_raw)
                result = self._result(plan, repaired_raw, started)
                result.repaired = True
                return result
        except Exception as exc:  # Ollama exception types vary by release
            return PlannerResult(
                plan=ActionPlan.safe_wait(f"Planner failure: {exc}"),
                raw_response=locals().get("raw", ""),
                valid_json=False,
                latency_ms=(time.perf_counter() - started) * 1000,
                error=f"{type(exc).__name__}: {exc}",
            )

    def _chat(self, messages: list[dict[str, Any]], *, thinking: bool) -> str:
        with OLLAMA_INFERENCE_LOCK:
            response = self._client.chat(
                model=self.settings.model,
                messages=messages,
                format=ActionPlan.model_json_schema(),
                options={
                    "temperature": self.settings.temperature,
                    "num_ctx": self.settings.context_size,
                    "num_predict": self.settings.max_output_tokens,
                },
                keep_alive=self.settings.keep_alive,
                think=thinking,
                stream=False,
            )
        return str(response.message.content)

    @staticmethod
    def _result(plan: ActionPlan, raw: str, started: float) -> PlannerResult:
        return PlannerResult(
            plan=plan,
            raw_response=raw,
            valid_json=True,
            latency_ms=(time.perf_counter() - started) * 1000,
        )

    def close(self) -> None:
        return


class OpenAICompatiblePlannerBackend:
    """Future-proof client for llama-server and other /v1/chat/completions APIs."""

    def __init__(self, settings: PlannerSettings) -> None:
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("The openai-compatible backend needs httpx.") from exc
        self.settings = settings
        self._http = httpx.Client(
            base_url=settings.host.rstrip("/"),
            headers={"Authorization": f"Bearer {settings.api_key}"} if settings.api_key else {},
            timeout=120,
        )

    def plan(self, request: PlannerRequest) -> PlannerResult:
        started = time.perf_counter()
        content: Any = json.dumps(_PlannerParser.payload(request), ensure_ascii=False)
        if self.settings.use_vision and request.image_b64:
            content = [
                {"type": "text", "text": content},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{request.image_b64}"},
                },
            ]
        body = {
            "model": self.settings.model,
            "messages": [
                {"role": "system", "content": DEFAULT_SYSTEM_PROMPT},
                {"role": "user", "content": content},
            ],
            "temperature": self.settings.temperature,
            "max_tokens": self.settings.max_output_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "action_plan",
                    "strict": True,
                    "schema": ActionPlan.model_json_schema(),
                },
            },
        }
        try:
            raw = self._post(body)
            try:
                plan = _PlannerParser.parse(raw)
                repaired = False
            except (ValidationError, ValueError) as initial_error:
                if not self.settings.repair_invalid_json:
                    raise
                repair_body = {
                    **body,
                    "messages": [
                        {
                            "role": "system",
                            "content": "Repair the value into only valid ActionPlan JSON.",
                        },
                        {
                            "role": "user",
                            "content": json.dumps(
                                {
                                    "invalid": raw,
                                    "validation_error": str(initial_error),
                                    "schema": ActionPlan.model_json_schema(),
                                },
                                ensure_ascii=False,
                            ),
                        },
                    ],
                }
                raw = self._post(repair_body)
                plan = _PlannerParser.parse(raw)
                repaired = True
            return PlannerResult(
                plan=plan,
                raw_response=raw,
                valid_json=True,
                repaired=repaired,
                latency_ms=(time.perf_counter() - started) * 1000,
            )
        except Exception as exc:
            return PlannerResult(
                plan=ActionPlan.safe_wait(f"OpenAI-compatible planner failure: {exc}"),
                valid_json=False,
                latency_ms=(time.perf_counter() - started) * 1000,
                error=f"{type(exc).__name__}: {exc}",
            )

    def _post(self, body: dict[str, Any]) -> str:
        response = self._http.post("/v1/chat/completions", json=body)
        response.raise_for_status()
        return str(response.json()["choices"][0]["message"]["content"])

    def close(self) -> None:
        self._http.close()
