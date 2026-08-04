from __future__ import annotations

import base64
import time
import uuid
from contextlib import suppress
from dataclasses import dataclass, field

from rich.console import Console
from rich.panel import Panel

from .actions import ActionExecutor, MacroFactory, PlanValidator
from .backends import (
    ActionBackend,
    CaptureBackend,
    OCRBackend,
    PlannerBackend,
    TelemetryProvider,
    VisionBackend,
)
from .battle.belief import OpponentBeliefModel
from .battle.knowledge import KnowledgeDatabase
from .battle.learning import BattleLearningStore
from .battle.parser import BattleStateParser, SemanticBattleOCR
from .battle.planner import BattlePlanner, OllamaBattleStrategyEvaluator
from .battle.runtime import BattleIntelligenceResult, BattleIntelligenceRuntime
from .capture import AzaharCaptureBackend, encode_jpeg
from .config import AppConfig
from .controller import VirtualGamepadActionBackend
from .layout import UILayoutRegistry
from .memory import MemoryStore, WorkingMemory
from .models import (
    ActionPlan,
    CycleRecord,
    GameState,
    MacroName,
    Objective,
    ObjectiveStatus,
    PlannerRequest,
    PlannerResult,
    Scene,
    ScreenFrame,
    VisionObservation,
)
from .navigation import NavigationMemory, NavigationTransitionEvaluator
from .ocr_engine import NullOCRBackend, PaddleOCRBackend
from .perception import EventDrivenOCR, FrameChangeDetector, OCRBatchResult
from .planner import (
    OllamaPlannerBackend,
    OpenAICompatiblePlannerBackend,
    deterministic_plan,
)
from .progress import LoopDetector, ProgressTracker, RecoveryPolicy
from .replay import ReplayRecorder
from .state import StateClassifier
from .telemetry import NullTelemetryProvider
from .vision import NullVisionBackend, OllamaVisionBackend


@dataclass(slots=True)
class ObservationBundle:
    frame: ScreenFrame
    state: GameState
    ocr: OCRBatchResult
    capture_latency_ms: float
    vision_latency_ms: float = 0.0
    vision_calls: int = 0
    vision: VisionObservation | None = None
    errors: list[str] = field(default_factory=list)


class KalosRuntime:
    def __init__(
        self,
        config: AppConfig,
        *,
        capture: CaptureBackend,
        ocr: OCRBackend,
        vision: VisionBackend,
        planner: PlannerBackend,
        actions: ActionBackend,
        telemetry: TelemetryProvider,
        memory: MemoryStore,
        record: bool = False,
        battle_intelligence: BattleIntelligenceRuntime | None = None,
        navigation: NavigationMemory | None = None,
    ) -> None:
        self.config = config
        self.capture = capture
        self.vision = vision
        self.planner = planner
        self.actions = actions
        self.telemetry = telemetry
        self.memory = memory
        self.battle_intelligence = battle_intelligence
        self.navigation = navigation
        self.navigation_evaluator = NavigationTransitionEvaluator()
        self.ocr = EventDrivenOCR(ocr, config.ocr)
        self.change_detector = FrameChangeDetector(config.change)
        self.classifier = StateClassifier(config.agent)
        self.validator = PlanValidator(config.agent.action)
        self.macro_factory = MacroFactory(config.agent.action)
        self.progress = ProgressTracker()
        self.loops = LoopDetector()
        self.working = WorkingMemory(config.memory.working_memory_size)
        self.objective = config.agent.initial_objective
        self.previous_plan: ActionPlan | None = None
        self.console = Console()
        self._last_bundle: ObservationBundle | None = None
        self._last_decision_fingerprint = ""
        self._last_vision_fingerprint = ""
        self._closed = False
        self._record_enabled = record
        self.episode_id = self.memory.start_episode(self.objective)
        self.objective_id = self.memory.add_objective(
            Objective(
                description=self.objective,
                reason="Advance the current playthrough safely.",
                expected_result="A new durable story milestone is observed.",
                status=ObjectiveStatus.ACTIVE,
                priority=80,
                progress_criterion="A validated state transition advances the story.",
            )
        )
        self.recorder = (
            ReplayRecorder(config.replay.root_dir, self.episode_id, self.objective)
            if record
            else None
        )
        self.executor = ActionExecutor(
            actions,
            capture,
            self._observe_for_action,
            self.stop_requested,
            config.agent.action,
        )

    def stop_requested(self) -> bool:
        return self.config.agent.stop_file.exists()

    def preflight(self, *, live_requested: bool) -> None:
        if not live_requested:
            return
        failures = []
        if self.actions.dry_run:
            failures.append("the action backend is still in dry-run mode")
        if not self.capture.is_alive():
            failures.append("Azahar was not found")
        if not self.capture.validate_window():
            failures.append("the Azahar client size is implausible")
        if not self.actions.is_ready():
            failures.append("the virtual controller is not ready")
        if self.stop_requested():
            failures.append(f"STOP file exists at {self.config.agent.stop_file}")
        if failures:
            raise RuntimeError("Live preflight failed: " + "; ".join(failures))
        for remaining in range(self.config.agent.arm_countdown_seconds, 0, -1):
            self.console.print(f"Live controller arms in {remaining} …")
            time.sleep(1)

    def observe_once(
        self,
        *,
        force_ocr: bool = False,
        allow_vision: bool = True,
    ) -> ObservationBundle:
        capture_started = time.perf_counter()
        frame = self.capture.capture()
        capture_latency = (time.perf_counter() - capture_started) * 1000
        event = self.change_detector.analyze(frame)
        ocr = self.ocr.process(frame, event, force=force_ocr)
        telemetry = self.telemetry.read()
        preliminary = self.classifier.classify(
            frame,
            event,
            ocr.lines,
            telemetry=telemetry,
            apply_hysteresis=False,
        )
        visual = None
        observation_errors: list[str] = []
        vision_calls = 0
        vision_latency = 0.0
        observation_fingerprint = preliminary.fingerprint()
        vision_needed = (
            allow_vision
            and self.config.vision.enabled
            and event.stable
            and (
                preliminary.uncertainty >= self.config.vision.uncertainty_threshold
                or self.progress.no_progress_streak >= self.config.vision.no_progress_trigger
            )
            and (
                event.new_state_candidate
                or observation_fingerprint != self._last_vision_fingerprint
            )
        )
        if vision_needed:
            image_bytes = encode_jpeg(
                frame.full_frame,
                self.config.capture.vlm_max_width,
                self.config.capture.jpeg_quality,
            )
            try:
                visual = self.vision.observe(preliminary, image_bytes)
                vision_calls = 1
                vision_latency = visual.latency_ms
                self._last_vision_fingerprint = observation_fingerprint
            except Exception as exc:
                visual = None
                observation_errors.append(f"vision:{type(exc).__name__}:{exc}")
        state = self.classifier.classify(
            frame,
            event,
            ocr.lines,
            vision=visual,
            telemetry=telemetry,
        )
        self.working.observe(state)
        bundle = ObservationBundle(
            frame=frame,
            state=state,
            ocr=ocr,
            capture_latency_ms=capture_latency,
            vision_latency_ms=vision_latency,
            vision_calls=vision_calls,
            vision=visual,
            errors=observation_errors,
        )
        self._last_bundle = bundle
        return bundle

    def _observe_for_action(self) -> GameState:
        return self.observe_once(allow_vision=False).state

    def should_decide(self, state: GameState) -> bool:
        if not state.screen_stable and not state.transition_active:
            return False
        fingerprint = state.fingerprint(objective=self.objective)
        return (
            fingerprint != self._last_decision_fingerprint or self.progress.no_progress_streak > 0
        )

    def _planner_request(self, bundle: ObservationBundle) -> PlannerRequest:
        image_b64 = None
        if self.config.planner.use_vision:
            image_b64 = base64.b64encode(
                encode_jpeg(
                    bundle.frame.full_frame,
                    self.config.capture.vlm_max_width,
                    self.config.capture.jpeg_quality,
                )
            ).decode("ascii")
        return PlannerRequest(
            state=bundle.state,
            objective=self.objective,
            working_memory=self.working.as_dict(),
            episodic_memory=self.memory.episodic_context(self.config.planner.recent_memory_items),
            durable_memory=self.memory.durable_context(self.config.planner.recent_memory_items),
            failed_strategies=self.memory.failed_context(self.config.planner.recent_memory_items),
            previous_plan=self.previous_plan,
            recovery_level=self.progress.recovery_level,
            image_b64=image_b64,
        )

    def decision_cycle(self, bundle: ObservationBundle | None = None) -> CycleRecord:
        cycle_started = time.perf_counter()
        before = bundle or self.observe_once()
        cycle_id = uuid.uuid4().hex
        recovery_level = self.progress.recovery_level
        if self.progress.no_progress_streak > 0 and recovery_level in {1, 2}:
            if recovery_level == 2:
                self.classifier.reset_hysteresis()
                self.previous_plan = None
            before = self.observe_once(force_ocr=True, allow_vision=True)
        recovery_plan = (
            RecoveryPolicy.plan(recovery_level, before.state)
            if self.progress.no_progress_streak > 0
            else None
        )
        rule_plan = deterministic_plan(before.state)
        planner_request: PlannerRequest | None = None
        planner_result: PlannerResult | None = None
        battle_result: BattleIntelligenceResult | None = None
        navigation_node = None
        if self.battle_intelligence and before.state.scene in {
            Scene.OVERWORLD,
            Scene.TITLE,
            Scene.MAIN_MENU,
        }:
            self.battle_intelligence.leave_battle()
        if self.navigation and before.state.scene == Scene.OVERWORLD:
            navigation_node = self.navigation.observe_node(
                before.frame.top_screen,
                location_name=before.state.overworld.location_name,
                scene_type=before.state.scene,
                confidence=before.state.scene_confidence,
            )
            before.state.navigation_context = navigation_node.model_dump(mode="json")

        if recovery_plan is not None:
            proposed = recovery_plan
        elif self.battle_intelligence and before.state.scene in {
            Scene.BATTLE,
            Scene.BATTLE_MOVE_MENU,
            Scene.BATTLE_PARTY_MENU,
        }:
            try:
                battle_result = self.battle_intelligence.plan(before.frame, before.state)
                before.state.canonical_battle = battle_result.battle_state.model_dump(mode="json")
                proposed = battle_result.action_plan
            except Exception as exc:
                before.errors.append(f"battle:{type(exc).__name__}:{exc}")
                proposed = ActionPlan.safe_wait("Battle intelligence could not validate the state.")
        elif rule_plan is not None and recovery_level < 5:
            proposed = rule_plan
        else:
            planner_request = self._planner_request(before)
            planner_result = self.planner.plan(planner_request)
            proposed = planner_result.plan

        validated = self.validator.validate_or_wait(proposed, before.state)
        macro = self.macro_factory.build(validated, before.state)
        self.working.current_plan = validated
        self.working.current_action = macro.name.value
        execution = self.executor.execute(macro, before.state)
        after_bundle = self._last_bundle or before
        after = execution.after_state
        finding = self.loops.record(
            after,
            validated,
            execution,
            objective=self.objective,
        )
        assessment = self.progress.assess(before.state, after, execution, finding)
        actual_battle_result: dict[str, object] | None = None
        if battle_result:
            actual_battle_result = {
                "visible_effect": execution.visible_effect,
                "after_scene": after.scene.value,
                "progress_score": assessment.score,
                "interrupt_reason": execution.interrupt_reason,
            }
            try:
                learned_turn = self.battle_intelligence.record_outcome(
                    battle_result,
                    after_bundle.frame,
                    after,
                    progress_score=assessment.score,
                    decision_error=execution.interrupt_reason if execution.interrupted else None,
                ) if self.battle_intelligence else None
                if learned_turn:
                    actual_battle_result["learned_turn"] = learned_turn
            except Exception as exc:
                before.errors.append(f"battle-outcome:{type(exc).__name__}:{exc}")
        navigation_edge = None
        if (
            self.navigation
            and navigation_node
            and navigation_node.id is not None
            and validated.macro in {MacroName.MOVE_BURST, MacroName.INTERACT}
        ):
            transition = self.navigation_evaluator.assess(
                before.state,
                after,
                action_macro=validated.macro,
            )
            target_node = None
            if after.scene == Scene.OVERWORLD:
                target_node = self.navigation.observe_node(
                    after_bundle.frame.top_screen,
                    location_name=after.overworld.location_name,
                    scene_type=after.scene,
                    confidence=after.scene_confidence,
                )
                after.navigation_context = target_node.model_dump(mode="json")
            navigation_edge = self.navigation.record_transition(
                source_node=navigation_node.id,
                action_macro=validated.macro,
                target_node=target_node.id if target_node else None,
                success=(
                    transition.position_changed
                    or transition.new_landmark_state
                    or transition.map_transition
                ),
                duration_seconds=execution.latency_ms / 1000,
                collision=transition.collision,
                required_interaction=validated.macro == MacroName.INTERACT,
            )
        self.previous_plan = validated
        self._last_decision_fingerprint = after.fingerprint(objective=self.objective)
        decision_latency = (time.perf_counter() - cycle_started) * 1000
        record = CycleRecord(
            cycle_id=cycle_id,
            episode_id=self.episode_id,
            before_state=before.state,
            planner_request=planner_request,
            planner_result=planner_result,
            validated_plan=validated,
            execution=execution,
            after_state=after,
            progress=assessment,
            latencies_ms={
                "capture": before.capture_latency_ms,
                "ocr": before.ocr.latency_ms
                + (battle_result.semantic_ocr_latency_ms if battle_result else 0.0),
                "vision": before.vision_latency_ms,
                "action": execution.latency_ms,
                "decision": decision_latency,
            },
            counters={
                "ocr_calls": before.ocr.calls
                + (battle_result.semantic_ocr_calls if battle_result else 0),
                "vision_calls": before.vision_calls,
                "planner_calls": int(planner_result is not None),
            },
            errors=before.errors
            + ([planner_result.error] if planner_result and planner_result.error else []),
            normalized_ui_regions=(battle_result.normalized_regions if battle_result else {}),
            recognized_entities=(battle_result.recognized_entities if battle_result else []),
            battle_state=(
                battle_result.battle_state.model_dump(mode="json") if battle_result else None
            ),
            opponent_belief=(
                battle_result.belief.model_dump(mode="json")
                if battle_result and battle_result.belief
                else None
            ),
            damage_distributions=(
                [
                    candidate.damage_distribution.model_dump(mode="json")
                    for candidate in battle_result.decision.candidates
                    if candidate.damage_distribution is not None
                ]
                if battle_result and battle_result.decision
                else []
            ),
            battle_search_tree=(
                battle_result.decision.search_tree.model_dump(mode="json")
                if battle_result and battle_result.decision
                else None
            ),
            selected_battle_action=(
                battle_result.decision.action.model_dump(mode="json")
                if battle_result and battle_result.decision
                else None
            ),
            actual_battle_result=actual_battle_result,
            navigation_node=(
                navigation_node.model_dump(mode="json") if navigation_node else None
            ),
            navigation_edge=(
                navigation_edge.model_dump(mode="json") if navigation_edge else None
            ),
        )

        replay_path = None
        if self.recorder:
            path = self.recorder.record_cycle(
                record,
                before.frame,
                after_bundle.frame,
                self.config.replay,
            )
            replay_path = str(path)
        self.memory.record_observation(
            self.episode_id,
            cycle_id,
            before.state,
            screenshot_path=(f"{replay_path}/before.png" if replay_path else None),
        )
        if after.frame_id != before.state.frame_id:
            self.memory.record_observation(
                self.episode_id,
                cycle_id,
                after,
                screenshot_path=(f"{replay_path}/after.png" if replay_path else None),
            )
        self.memory.record_action(
            self.episode_id,
            cycle_id,
            validated,
            execution,
            assessment,
        )
        if planner_request and planner_result:
            self.memory.record_model_call(
                self.episode_id,
                cycle_id,
                kind="planner",
                model=self.config.planner.model,
                input_value=planner_request.model_dump(mode="json", exclude={"image_b64"}),
                result=planner_result,
                latency_ms=planner_result.latency_ms,
                valid_json=planner_result.valid_json,
                error=planner_result.error,
            )
        if before.vision:
            self.memory.record_model_call(
                self.episode_id,
                cycle_id,
                kind="vision",
                model=self.config.vision.model,
                input_value={
                    "frame_id": before.state.frame_id,
                    "scene": before.state.scene.value,
                },
                result=before.vision.model_dump(mode="json"),
                latency_ms=before.vision.latency_ms,
                valid_json=True,
            )
        if not assessment.progressed:
            self.memory.record_failure(
                self.episode_id,
                cycle_id,
                situation=before.state,
                action=validated,
                outcome=assessment,
                recovery={"level": assessment.recovery_level},
            )
        return record

    def run(self, *, live_requested: bool = False, max_cycles: int | None = None) -> None:
        try:
            self.preflight(live_requested=live_requested)
            mode = "LIVE" if live_requested else "DRY RUN"
            self.console.print(
                Panel.fit(
                    f"KalosAgent v0.3 — {mode}\n"
                    "Ctrl+C or the configured STOP file stops the runtime."
                )
            )
            completed = 0
            interval = 1.0 / self.config.capture.capture_hz
            while not self.stop_requested():
                loop_started = time.perf_counter()
                bundle = self.observe_once()
                if self.should_decide(bundle.state):
                    record = self.decision_cycle(bundle)
                    completed += 1
                    self.console.print(
                        f"[{record.before_state.scene.value}] "
                        f"{record.validated_plan.macro.value} — "
                        f"progress={record.progress.score if record.progress else 0:.2f}"
                    )
                    if record.validated_plan.needs_human:
                        self.console.print("Recovery exhausted: needs_human=true; pausing.")
                        break
                    if max_cycles is not None and completed >= max_cycles:
                        break
                delay = interval - (time.perf_counter() - loop_started)
                if delay > 0:
                    time.sleep(delay)
        except KeyboardInterrupt:
            self.console.print("Stopping KalosAgent.")
        finally:
            self.close(status="stopped")

    def close(self, *, status: str = "completed") -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self.actions.reset()
        finally:
            final_scene = self._last_bundle.state.scene.value if self._last_bundle else "UNKNOWN"
            with suppress(Exception):
                self.memory.add_summary(
                    self.episode_id,
                    "runtime",
                    f"Episode ended with status={status}, scene={final_scene}, "
                    f"no_progress_streak={self.progress.no_progress_streak}.",
                )
                self.memory.update_objective_status(
                    self.objective_id,
                    ObjectiveStatus.PAUSED.value
                    if status == "stopped"
                    else ObjectiveStatus.COMPLETED.value,
                )
                self.memory.finish_episode(self.episode_id, status)
            for component in (
                self.battle_intelligence,
                self.navigation,
                self.ocr,
                self.vision,
                self.planner,
                self.telemetry,
                self.actions,
                self.capture,
                self.memory,
            ):
                if component is not None:
                    with suppress(Exception):
                        component.close()


def build_runtime(config: AppConfig, *, live: bool = False, record: bool = False) -> KalosRuntime:
    capture = AzaharCaptureBackend(config.window, config.capture)
    ocr: OCRBackend = (
        PaddleOCRBackend(
            detection_model=config.ocr.detection_model,
            recognition_model=config.ocr.recognition_model,
            device=config.ocr.device,
            min_score=config.ocr.min_score,
            upscale=config.ocr.upscale,
        )
        if config.ocr.enabled
        else NullOCRBackend()
    )
    vision: VisionBackend = (
        OllamaVisionBackend(
            model=config.vision.model,
            host=config.vision.host,
            temperature=config.vision.temperature,
            keep_alive=config.vision.keep_alive,
            context_size=config.vision.context_size,
        )
        if config.vision.enabled
        else NullVisionBackend()
    )
    if config.planner.backend == "openai":
        planner: PlannerBackend = OpenAICompatiblePlannerBackend(config.planner)
    else:
        planner = OllamaPlannerBackend(config.planner)
    actions = VirtualGamepadActionBackend(
        dry_run=not live,
        max_duration_ms=config.agent.action.max_action_duration_ms,
    )
    battle_intelligence = None
    if config.battle_intelligence.enabled and config.knowledge.database_path.exists():
        knowledge = KnowledgeDatabase(config.knowledge.database_path, read_only=True)
        registry = UILayoutRegistry()
        belief_model = OpponentBeliefModel(knowledge)
        battle_intelligence = BattleIntelligenceRuntime(
            semantic_ocr=SemanticBattleOCR(ocr, registry),
            registry=registry,
            parser=BattleStateParser(knowledge),
            belief_model=belief_model,
            planner=BattlePlanner(
                knowledge,
                strategy_evaluator=(
                    OllamaBattleStrategyEvaluator(config.planner)
                    if config.battle_intelligence.use_llm_strategy
                    else None
                ),
                beam_width=config.battle_intelligence.beam_width,
                opponent_width=config.battle_intelligence.opponent_width,
                horizon=config.battle_intelligence.search_horizon,
            ),
            learning=BattleLearningStore(
                config.battle_intelligence.learning_database_path
            ),
            knowledge=knowledge,
        )
    navigation = (
        NavigationMemory(
            config.navigation.database_path,
            keyframe_dir=config.navigation.keyframe_dir,
            node_match_threshold=config.navigation.node_match_threshold,
            landmark_match_threshold=config.navigation.landmark_match_threshold,
            stable_recognitions=config.navigation.stable_recognitions,
        )
        if config.navigation.enabled
        else None
    )
    return KalosRuntime(
        config,
        capture=capture,
        ocr=ocr,
        vision=vision,
        planner=planner,
        actions=actions,
        telemetry=NullTelemetryProvider(),
        memory=MemoryStore(config.memory.database_path),
        record=record,
        battle_intelligence=battle_intelligence,
        navigation=navigation,
    )


# Kept as the public name used by v0.1 callers.
KalosAgent = KalosRuntime
