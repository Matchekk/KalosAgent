from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from kalos_agent.actions import ActionExecutor, MacroFactory, PlanValidator
from kalos_agent.agent import KalosRuntime
from kalos_agent.capture import ScreenSegmenter
from kalos_agent.config import (
    ActionSettings,
    AgentSettings,
    AppConfig,
    ChangeSettings,
    MemorySettings,
    ReplaySettings,
    ScreenLayoutSettings,
)
from kalos_agent.memory import MemoryStore
from kalos_agent.models import (
    ActionExecutionResult,
    ActionPlan,
    AtomicAction,
    AtomicActionKind,
    Button,
    CropRect,
    CycleRecord,
    GameState,
    MacroName,
    Objective,
    OCRLine,
    PerceptionEvent,
    PlannerResult,
    Scene,
    ScreenLayoutMode,
)
from kalos_agent.perception import EventDrivenOCR, FrameChangeDetector
from kalos_agent.progress import LoopDetector, ProgressTracker
from kalos_agent.replay import ReplayEngine, ReplayRecorder
from kalos_agent.state import StateClassifier
from kalos_agent.testing import (
    FakeActionBackend,
    FakeCaptureBackend,
    FakeOCRBackend,
    FakePlannerBackend,
    FakeTelemetryProvider,
    FakeVisionBackend,
    synthetic_frame,
)


def state(scene: Scene, suffix: str = "0", text: str = "") -> GameState:
    lines = [OCRLine(text=text, score=0.9, region="dialogue")] if text else []
    return GameState(
        frame_id=f"frame-{suffix}",
        scene=scene,
        scene_confidence=0.9,
        screen_stable=True,
        uncertainty=0.1,
        detected_text=lines,
        perceptual_hash=f"{int(suffix or '0'):016x}",
    )


def execution(before: GameState, after: GameState, effect: bool = True) -> ActionExecutionResult:
    return ActionExecutionResult(
        macro=MacroName.INTERACT,
        before_state=before,
        after_state=after,
        success=True,
        visible_effect=effect,
    )


def test_screen_splitting_vertical_horizontal_and_custom() -> None:
    image = np.zeros((600, 400, 3), dtype=np.uint8)
    vertical = ScreenSegmenter(
        ScreenLayoutSettings(mode=ScreenLayoutMode.VERTICAL, split_ratio=0.6)
    ).split(image)
    assert vertical.top_screen.shape[:2] == (360, 400)
    assert vertical.bottom_screen.shape[:2] == (240, 400)

    horizontal = ScreenSegmenter(
        ScreenLayoutSettings(mode=ScreenLayoutMode.HORIZONTAL, split_ratio=0.6)
    ).split(image)
    assert horizontal.top_screen.shape[:2] == (600, 240)
    assert horizontal.bottom_screen.shape[:2] == (600, 160)

    custom = ScreenSegmenter(
        ScreenLayoutSettings(
            mode=ScreenLayoutMode.CUSTOM,
            top_crop=CropRect(x=0, y=0, width=1, height=0.4),
            bottom_crop=CropRect(x=0.1, y=0.5, width=0.8, height=0.4),
        )
    ).split(image)
    assert custom.top_screen.shape[:2] == (240, 400)
    assert custom.bottom_screen.shape[:2] == (240, 320)
    assert "dialogue" in custom.regions


def test_event_driven_ocr_only_reruns_changed_region() -> None:
    settings = ChangeSettings(stable_frames_required=1, animation_debounce_frames=5)
    detector = FrameChangeDetector(settings)
    backend = FakeOCRBackend()
    config = AppConfig().ocr
    worker = EventDrivenOCR(backend, config)
    first = synthetic_frame(0, frame_id="first")
    second = synthetic_frame(0, frame_id="second")
    third = synthetic_frame(0, frame_id="third")
    third.regions["dialogue"][:] = 255
    try:
        assert worker.process(first, detector.analyze(first)).calls == 0
        initial = worker.process(second, detector.analyze(second))
        assert initial.calls == len(config.text_regions)
        changed = worker.process(third, detector.analyze(third))
        assert changed.calls == 1
        assert backend.calls[-1] == "dialogue"
    finally:
        worker.close()


def test_state_hysteresis_requires_repeated_medium_confidence() -> None:
    classifier = StateClassifier(AgentSettings(state_hysteresis_frames=2))
    frame = synthetic_frame()
    event = PerceptionEvent(
        frame_id=frame.frame_id,
        stable=True,
        transition_active=False,
        new_state_candidate=True,
    )
    lines = [OCRLine(text="Hallo Trainer", score=0.9, region="dialogue")]
    assert classifier.classify(frame, event, lines).scene == Scene.UNKNOWN
    assert classifier.classify(frame, event, lines).scene == Scene.DIALOGUE


def test_plan_validation_replaces_unsafe_battle_cancel_with_wait() -> None:
    current = state(Scene.BATTLE, "1")
    unsafe = ActionPlan(
        state_summary="Battle",
        immediate_goal="Cancel",
        confidence=0.8,
        macro=MacroName.CANCEL,
    )
    validated = PlanValidator(ActionSettings()).validate_or_wait(unsafe, current)
    assert validated.macro == MacroName.WAIT
    assert validated.confidence == 0


def test_macro_interrupts_as_soon_as_dialogue_appears() -> None:
    before = state(Scene.OVERWORLD, "1")
    after = state(Scene.DIALOGUE, "2", "Hello")
    backend = FakeActionBackend()
    capture = FakeCaptureBackend()
    plan = ActionPlan(
        state_summary="Overworld",
        immediate_goal="Probe carefully",
        confidence=0.8,
        macro=MacroName.PRESS_SEQUENCE,
        actions=[
            AtomicAction(kind=AtomicActionKind.PRESS_BUTTON, button=Button.A) for _ in range(3)
        ],
    )
    macro = MacroFactory(ActionSettings(post_input_observation_delay_ms=0)).build(plan, before)
    result = ActionExecutor(
        backend,
        capture,
        lambda: after,
        lambda: False,
        ActionSettings(post_input_observation_delay_ms=0),
    ).execute(macro, before)
    assert len(backend.actions) == 1
    assert result.interrupted
    assert result.interrupt_reason == "dialogue_appeared"
    assert result.success
    assert result.before_state == before and result.after_state == after


@pytest.mark.parametrize(
    ("focused", "stopped", "expected"),
    [(False, False, "window_focus_lost"), (True, True, "stop_requested")],
)
def test_action_safety_blocks_focus_loss_and_stop(
    focused: bool, stopped: bool, expected: str
) -> None:
    before = state(Scene.OVERWORLD)
    backend = FakeActionBackend(dry_run=False)
    capture = FakeCaptureBackend()
    capture.focused = focused
    plan = ActionPlan(
        state_summary="Test",
        immediate_goal="Interact",
        confidence=1,
        macro=MacroName.INTERACT,
    )
    macro = MacroFactory(ActionSettings()).build(plan, before)
    result = ActionExecutor(
        backend,
        capture,
        lambda: before,
        lambda: stopped,
        ActionSettings(post_input_observation_delay_ms=0),
    ).execute(macro, before)
    assert not backend.actions
    assert result.interrupt_reason == expected


def test_cycle_detection_finds_a_b_a_b() -> None:
    detector = LoopDetector()
    plan = ActionPlan(
        state_summary="cycle",
        immediate_goal="interact",
        confidence=0.5,
        macro=MacroName.INTERACT,
    )
    finding = None
    for index in range(6):
        current = state(Scene.OVERWORLD if index % 2 == 0 else Scene.MAIN_MENU, str(index))
        finding = detector.record(current, plan, execution(current, current, False))
    assert finding is not None and finding.detected
    assert finding.kind == "a_b_cycle"


def test_progress_scoring_distinguishes_effect_and_no_effect() -> None:
    tracker = ProgressTracker()
    before = state(Scene.OVERWORLD, "1")
    after = state(Scene.DIALOGUE, "2", "New text")
    good = tracker.assess(before, after, execution(before, after, True))
    bad = tracker.assess(after, after, execution(after, after, False))
    assert good.progressed and good.score > 0
    assert not bad.progressed and bad.score < 0


def test_sqlite_persists_all_memory_categories(tmp_path: Path) -> None:
    store = MemoryStore(tmp_path / "memory.sqlite3")
    episode_id = store.start_episode("Test objective")
    before = state(Scene.OVERWORLD, "1")
    after = state(Scene.DIALOGUE, "2", "Hello")
    plan = ActionPlan(
        state_summary="test",
        immediate_goal="interact",
        confidence=0.8,
        macro=MacroName.INTERACT,
        memory_updates=["Met a trainer"],
    )
    result = execution(before, after)
    progress = ProgressTracker().assess(before, after, result)
    store.record_observation(episode_id, "cycle", before)
    store.record_action(episode_id, "cycle", plan, result, progress)
    store.record_failure(
        episode_id,
        "cycle",
        situation=before,
        action=plan,
        outcome=progress,
        recovery={"level": 1},
    )
    store.upsert_fact("starter", {"name": "Froakie"}, confidence=1, source="test")
    store.add_objective(
        Objective(
            description="Choose starter",
            reason="Advance story",
            expected_result="Starter selected",
            progress_criterion="Party contains starter",
        )
    )
    store.add_summary(episode_id, "episode", "Reached dialogue")
    store.upsert_landmark("Aquacorde", "Town", "abc", {})
    store.record_model_call(
        episode_id,
        "cycle",
        kind="planner",
        model="fake",
        input_value={},
        result=PlannerResult(plan=plan),
        latency_ms=1,
        valid_json=True,
    )
    counts = store.table_counts()
    assert all(counts[name] >= 1 for name in counts)
    assert store.durable_context()
    assert store.failed_context()
    store.finish_episode(episode_id)
    store.close()


def test_replay_runs_offline_in_all_modes(tmp_path: Path) -> None:
    before = state(Scene.OVERWORLD, "1")
    plan = ActionPlan.safe_wait("replay")
    record = CycleRecord(
        cycle_id="cycle-1",
        episode_id="episode-1",
        before_state=before,
        validated_plan=plan,
        after_state=before,
        latencies_ms={"capture": 1, "ocr": 2, "decision": 3},
        counters={"ocr_calls": 1},
    )
    frame = synthetic_frame(0)
    recorder = ReplayRecorder(tmp_path, "episode-1", "Replay test")
    recorder.record_cycle(record, frame, frame, ReplaySettings())
    engine = ReplayEngine(
        change=ChangeSettings(stable_frames_required=1),
        agent=AgentSettings(state_hysteresis_frames=1),
    )
    episode = tmp_path / "episode-1"
    assert engine.run(episode, mode="saved")["cycles"] == 1
    assert engine.run(episode, mode="perception")["cycles"] == 1
    fake_planner = FakePlannerBackend(plan)
    assert engine.run(episode, mode="planner", planner=fake_planner)["cycles"] == 1
    assert ReplayEngine.benchmark(episode)["ocr_calls"] == 1
    assert ReplayEngine.inspect(episode)["cycles"] == 1


def test_runtime_gates_vision_and_live_preflight(tmp_path: Path) -> None:
    frame = synthetic_frame(0)
    capture = FakeCaptureBackend([frame, frame, frame])
    vision = FakeVisionBackend()
    config = AppConfig(
        change=ChangeSettings(stable_frames_required=1),
        agent=AgentSettings(stop_file=tmp_path / "STOP"),
        memory=MemorySettings(database_path=tmp_path / "runtime.sqlite3"),
        replay=ReplaySettings(root_dir=tmp_path / "replays"),
    )
    runtime = KalosRuntime(
        config,
        capture=capture,
        ocr=FakeOCRBackend(),
        vision=vision,
        planner=FakePlannerBackend(),
        actions=FakeActionBackend(),
        telemetry=FakeTelemetryProvider(),
        memory=MemoryStore(config.memory.database_path),
    )
    try:
        runtime.observe_once()
        runtime.observe_once()
        runtime.observe_once()
        assert vision.calls == 1
        config.agent.stop_file.touch()
        assert runtime.stop_requested()
        with pytest.raises(RuntimeError, match="dry-run"):
            runtime.preflight(live_requested=True)
    finally:
        runtime.close()
