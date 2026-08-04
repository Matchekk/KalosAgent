from __future__ import annotations

import time
from pathlib import Path

from rich.console import Console
from rich.panel import Panel

from .capture import AzaharCapture, encode_jpeg
from .config import AppConfig
from .controller import SafetyLimits, VirtualController
from .memory import EpisodicMemory
from .models import ActionName, ActionPlan, ActionStep
from .ocr_engine import SuryaOCREngine
from .perception import Perception
from .planner import LocalPlanner


class KalosAgent:
    def __init__(self, config: AppConfig, *, live: bool = False) -> None:
        self.config = config
        self.console = Console()
        self.capture = AzaharCapture(config.window.title_contains)
        self.perception = Perception()
        self.ocr = (
            SuryaOCREngine(
                backend=config.ocr.backend,
                inference_url=config.ocr.inference_url,
                parallel=config.ocr.parallel,
                min_score=config.ocr.min_score,
                upscale=config.ocr.upscale,
            )
            if config.ocr.enabled
            else None
        )
        self.planner = LocalPlanner(
            model=config.planner.model,
            host=config.planner.host,
            use_vision=config.planner.use_vision,
            temperature=config.planner.temperature,
        )
        self.controller = VirtualController(
            dry_run=not live,
            limits=SafetyLimits(
                max_steps_per_plan=config.agent.max_steps_per_plan,
                max_action_duration_ms=config.agent.max_action_duration_ms,
            ),
        )
        self.memory = EpisodicMemory(config.memory.database_path)
        self.previous_plan: ActionPlan | None = None

    def _stop_requested(self) -> bool:
        return Path("STOP").exists()

    def run(self) -> None:
        mode = "LIVE" if not self.controller.dry_run else "DRY RUN"
        self.console.print(
            Panel.fit(
                f"KalosAgent started in [bold]{mode}[/bold] mode.\n"
                "Press Ctrl+C or create a STOP file to stop."
            )
        )

        try:
            while not self._stop_requested():
                started = time.monotonic()
                frame = self.capture.grab()
                ocr_lines = self.ocr.read(frame) if self.ocr else []
                observation = self.perception.observe(frame, ocr_lines)

                image_bytes = None
                if self.config.planner.use_vision:
                    image_bytes = encode_jpeg(
                        frame,
                        self.config.capture.vlm_max_width,
                        self.config.capture.jpeg_quality,
                    )

                recent_memory = self.memory.recent(
                    self.config.planner.recent_memory_items
                )
                plan = self.planner.plan(
                    observation=observation,
                    recent_memory=recent_memory,
                    image_bytes=image_bytes,
                    previous_plan=self.previous_plan,
                )

                if (
                    observation.repeated_frame_count
                    >= self.config.agent.repeated_frame_limit
                    and all(step.action == ActionName.WAIT for step in plan.steps)
                ):
                    plan = ActionPlan(
                        state_summary=plan.state_summary,
                        immediate_goal="Try one cautious recovery action.",
                        confidence=min(plan.confidence, 0.25),
                        steps=[
                            ActionStep(
                                action=ActionName.B,
                                duration_ms=140,
                                reason="Repeated unchanged frame; cautiously close a possible menu.",
                            )
                        ],
                        memory_updates=[],
                        needs_human=False,
                    )

                self.console.print(
                    Panel(
                        "\n".join(
                            [
                                f"State: {observation.state_hint}",
                                f"OCR: {' | '.join(line.text for line in ocr_lines) or '(none)'}",
                                f"Goal: {plan.immediate_goal}",
                                f"Confidence: {plan.confidence:.2f}",
                            ]
                        ),
                        title="Observation & plan",
                    )
                )

                execution = self.controller.execute(plan)
                self.memory.append(observation, plan, execution)
                self.previous_plan = plan

                elapsed = time.monotonic() - started
                remaining = self.config.agent.decision_interval_seconds - elapsed
                if remaining > 0:
                    time.sleep(remaining)
        except KeyboardInterrupt:
            self.console.print("\nStopping KalosAgent.")
        finally:
            self.controller.reset()
            if self.ocr:
                self.ocr.close()
            self.capture.close()
            self.memory.close()
