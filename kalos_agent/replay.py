from __future__ import annotations

import base64
import json
import statistics
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import cv2

from .backends import PlannerBackend
from .capture import ScreenSegmenter, encode_jpeg, save_frame
from .config import AgentSettings, ChangeSettings, ReplaySettings, ScreenLayoutSettings
from .models import (
    CycleRecord,
    GameState,
    OCRLine,
    PlannerRequest,
    PlannerResult,
    ScreenFrame,
)
from .perception import FrameChangeDetector
from .state import StateClassifier

ReplayMode = Literal["saved", "planner", "perception"]


@dataclass(slots=True)
class BenchmarkMetrics:
    cycles: int = 0
    capture_latency_ms: list[float] = field(default_factory=list)
    ocr_latency_ms: list[float] = field(default_factory=list)
    vision_latency_ms: list[float] = field(default_factory=list)
    decision_latency_ms: list[float] = field(default_factory=list)
    ocr_calls: int = 0
    vision_calls: int = 0
    valid_json_plans: int = 0
    planner_calls: int = 0
    loops_detected: int = 0
    successful_state_changes: int = 0
    actions_without_effect: int = 0
    pokemon_name_total: int = 0
    pokemon_name_correct: int = 0
    move_name_total: int = 0
    move_name_correct: int = 0
    battle_state_total: int = 0
    battle_state_correct: int = 0
    type_decision_total: int = 0
    type_decision_correct: int = 0
    ko_prediction_total: int = 0
    ko_prediction_correct: int = 0
    opponent_action_total: int = 0
    opponent_action_correct: int = 0
    landmark_total: int = 0
    landmark_correct: int = 0
    transition_total: int = 0
    transition_success: int = 0

    @staticmethod
    def _summary(values: list[float]) -> dict[str, float]:
        if not values:
            return {"mean": 0.0, "median": 0.0, "p95": 0.0}
        ordered = sorted(values)
        p95_index = min(len(ordered) - 1, round((len(ordered) - 1) * 0.95))
        return {
            "mean": round(statistics.fmean(values), 3),
            "median": round(statistics.median(values), 3),
            "p95": round(ordered[p95_index], 3),
        }

    def as_dict(self) -> dict[str, Any]:
        return {
            "cycles": self.cycles,
            "latency_ms": {
                "capture": self._summary(self.capture_latency_ms),
                "ocr": self._summary(self.ocr_latency_ms),
                "vision": self._summary(self.vision_latency_ms),
                "decision": self._summary(self.decision_latency_ms),
            },
            "ocr_calls": self.ocr_calls,
            "vision_calls": self.vision_calls,
            "valid_json_plan_ratio": (
                round(self.valid_json_plans / self.planner_calls, 4) if self.planner_calls else 1.0
            ),
            "loops_detected": self.loops_detected,
            "successful_state_changes": self.successful_state_changes,
            "actions_without_effect": self.actions_without_effect,
            "pokemon_name_accuracy": self._ratio(
                self.pokemon_name_correct, self.pokemon_name_total
            ),
            "move_name_accuracy": self._ratio(
                self.move_name_correct, self.move_name_total
            ),
            "battle_state_accuracy": self._ratio(
                self.battle_state_correct, self.battle_state_total
            ),
            "type_decision_accuracy": self._ratio(
                self.type_decision_correct, self.type_decision_total
            ),
            "ko_prediction_accuracy": self._ratio(
                self.ko_prediction_correct, self.ko_prediction_total
            ),
            "opponent_action_accuracy": self._ratio(
                self.opponent_action_correct, self.opponent_action_total
            ),
            "landmark_recognition_accuracy": self._ratio(
                self.landmark_correct, self.landmark_total
            ),
            "transition_success_rate": self._ratio(
                self.transition_success, self.transition_total
            ),
        }

    @staticmethod
    def _ratio(correct: int, total: int) -> float:
        return round(correct / total, 4) if total else 0.0


class ReplayRecorder:
    def __init__(self, root: str | Path, episode_id: str, objective: str) -> None:
        self.root = Path(root)
        self.episode_id = episode_id
        self.episode_dir = self.root / episode_id
        self.cycles_dir = self.episode_dir / "cycles"
        self.cycles_dir.mkdir(parents=True, exist_ok=True)
        (self.episode_dir / "episode.json").write_text(
            json.dumps(
                {
                    "format_version": "0.3",
                    "episode_id": episode_id,
                    "objective": objective,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def record_cycle(
        self,
        record: CycleRecord,
        before_frame: ScreenFrame,
        after_frame: ScreenFrame | None,
        settings: ReplaySettings,
    ) -> Path:
        cycle_dir = self.cycles_dir / record.cycle_id
        cycle_dir.mkdir(parents=True, exist_ok=True)
        if settings.save_screenshots:
            save_frame(cycle_dir / "before.png", before_frame.full_frame)
            if after_frame is not None:
                save_frame(cycle_dir / "after.png", after_frame.full_frame)
        if settings.save_regions:
            regions_dir = cycle_dir / "regions"
            for name, image in before_frame.regions.items():
                save_frame(regions_dir / f"before-{name}.png", image)
            if after_frame is not None:
                for name, image in after_frame.regions.items():
                    save_frame(regions_dir / f"after-{name}.png", image)

        payload = record.model_dump(mode="json")
        request = payload.get("planner_request")
        if request:
            request["image_b64"] = None
        (cycle_dir / "cycle.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return cycle_dir


class ReplayDataset:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        if not self.path.exists():
            raise FileNotFoundError(self.path)

    def cycle_files(self) -> list[Path]:
        if (self.path / "cycle.json").exists():
            return [self.path / "cycle.json"]
        direct = sorted((self.path / "cycles").glob("*/cycle.json"))
        if direct:
            return direct
        return sorted(self.path.glob("**/cycle.json"))

    def records(self) -> list[tuple[Path, CycleRecord]]:
        return [
            (
                path.parent,
                CycleRecord.model_validate_json(path.read_text(encoding="utf-8")),
            )
            for path in self.cycle_files()
        ]


class ReplayEngine:
    """Offline evaluator. It never owns an ActionBackend or sends controller input."""

    def __init__(
        self,
        *,
        layout: ScreenLayoutSettings | None = None,
        change: ChangeSettings | None = None,
        agent: AgentSettings | None = None,
    ) -> None:
        self.layout = layout or ScreenLayoutSettings()
        self.change = change or ChangeSettings(stable_frames_required=1)
        self.agent = agent or AgentSettings(state_hysteresis_frames=1)

    def run(
        self,
        path: str | Path,
        *,
        mode: ReplayMode = "saved",
        planner: PlannerBackend | None = None,
    ) -> dict[str, Any]:
        if mode == "planner" and planner is None:
            raise ValueError("planner mode requires a PlannerBackend")
        dataset = ReplayDataset(path)
        detector = FrameChangeDetector(self.change)
        classifier = StateClassifier(self.agent)
        segmenter = ScreenSegmenter(self.layout)
        outputs: list[dict[str, Any]] = []

        for cycle_dir, record in dataset.records():
            if mode == "saved":
                outputs.append(
                    {
                        "cycle_id": record.cycle_id,
                        "plan": record.validated_plan.model_dump(mode="json"),
                        "source": "saved",
                    }
                )
                continue
            before_path = cycle_dir / "before.png"
            image = cv2.imread(str(before_path))
            if image is None:
                raise FileNotFoundError(f"Replay screenshot missing: {before_path}")
            frame = segmenter.split(image)
            event = detector.analyze(frame)
            lines = record.before_state.detected_text
            replay_state = classifier.classify(frame, event, lines)

            if mode == "perception":
                outputs.append(
                    {
                        "cycle_id": record.cycle_id,
                        "expected_scene": record.before_state.scene.value,
                        "actual_scene": replay_state.scene.value,
                        "matches": record.before_state.scene == replay_state.scene,
                        "source": "current_perception",
                    }
                )
                continue

            original = record.planner_request
            request = PlannerRequest(
                state=replay_state,
                objective=original.objective if original else "Replay this observation.",
                working_memory=original.working_memory if original else {},
                episodic_memory=original.episodic_memory if original else [],
                durable_memory=original.durable_memory if original else [],
                failed_strategies=original.failed_strategies if original else [],
                previous_plan=original.previous_plan if original else None,
                recovery_level=original.recovery_level if original else 0,
                image_b64=base64.b64encode(encode_jpeg(image, max_width=1280, quality=84)).decode(
                    "ascii"
                ),
            )
            assert planner is not None
            result = planner.plan(request)
            outputs.append(
                {
                    "cycle_id": record.cycle_id,
                    "plan": result.plan.model_dump(mode="json"),
                    "valid_json": result.valid_json,
                    "source": "current_planner",
                }
            )
        return {"mode": mode, "cycles": len(outputs), "results": outputs}

    @staticmethod
    def benchmark(path: str | Path) -> dict[str, Any]:
        metrics = BenchmarkMetrics()
        for _, record in ReplayDataset(path).records():
            metrics.cycles += 1
            for key, destination in (
                ("capture", metrics.capture_latency_ms),
                ("ocr", metrics.ocr_latency_ms),
                ("vision", metrics.vision_latency_ms),
                ("decision", metrics.decision_latency_ms),
            ):
                if key in record.latencies_ms:
                    destination.append(record.latencies_ms[key])
            metrics.ocr_calls += record.counters.get("ocr_calls", 0)
            metrics.vision_calls += record.counters.get("vision_calls", 0)
            if record.planner_result:
                metrics.planner_calls += 1
                metrics.valid_json_plans += int(record.planner_result.valid_json)
            if record.progress:
                metrics.loops_detected += int(record.progress.loop_detected)
                metrics.successful_state_changes += int(record.progress.state_changed)
            if record.execution:
                metrics.actions_without_effect += int(not record.execution.visible_effect)
            labels = record.evaluation_labels
            for prefix, total_name, correct_name in (
                ("pokemon_name", "pokemon_name_total", "pokemon_name_correct"),
                ("move_name", "move_name_total", "move_name_correct"),
                ("battle_state", "battle_state_total", "battle_state_correct"),
                ("type_decision", "type_decision_total", "type_decision_correct"),
                ("ko_prediction", "ko_prediction_total", "ko_prediction_correct"),
                (
                    "opponent_action",
                    "opponent_action_total",
                    "opponent_action_correct",
                ),
                ("landmark", "landmark_total", "landmark_correct"),
                ("transition", "transition_total", "transition_success"),
            ):
                if prefix in labels:
                    setattr(metrics, total_name, getattr(metrics, total_name) + 1)
                    setattr(
                        metrics,
                        correct_name,
                        getattr(metrics, correct_name) + int(bool(labels[prefix])),
                    )
        return metrics.as_dict()

    @staticmethod
    def inspect(path: str | Path) -> dict[str, Any]:
        dataset = ReplayDataset(path)
        records = dataset.records()
        scenes: dict[str, int] = {}
        errors: list[str] = []
        for _, record in records:
            scene = record.before_state.scene.value
            scenes[scene] = scenes.get(scene, 0) + 1
            errors.extend(record.errors)
        return {
            "path": str(dataset.path.resolve()),
            "cycles": len(records),
            "scenes": scenes,
            "errors": errors,
            "benchmark": ReplayEngine.benchmark(path),
        }


def saved_ocr_lines(record: CycleRecord) -> list[OCRLine]:
    return list(record.before_state.detected_text)


def saved_state(record: CycleRecord) -> GameState:
    return record.before_state


def saved_planner_result(record: CycleRecord) -> PlannerResult | None:
    return record.planner_result
