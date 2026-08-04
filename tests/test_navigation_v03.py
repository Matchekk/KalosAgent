from __future__ import annotations

from pathlib import Path

import numpy as np

from kalos_agent.models import GameState, MacroName, OverworldState, Scene
from kalos_agent.navigation import (
    FacingEstimate,
    HierarchicalNavigator,
    LandmarkKind,
    NavigationMemory,
    NavigationTransitionEvaluator,
    StrategicNavigationGoal,
)


def image(bgr: tuple[int, int, int]) -> np.ndarray:
    frame = np.zeros((160, 240, 3), dtype=np.uint8)
    frame[:] = bgr
    frame[30:80, 60:180] = tuple(min(255, value + 30) for value in bgr)
    return frame


def game_state(
    suffix: str,
    *,
    signature: str,
    location: str | None,
    scene: Scene = Scene.OVERWORLD,
    transition: bool = False,
) -> GameState:
    return GameState(
        frame_id=suffix,
        scene=scene,
        screen_stable=not transition,
        transition_active=transition,
        perceptual_hash=signature,
        overworld=OverworldState(
            active=scene == Scene.OVERWORLD,
            location_name=location,
        ),
    )


def test_navigation_nodes_embeddings_and_landmark_stability(tmp_path: Path) -> None:
    memory = NavigationMemory(tmp_path / "navigation.sqlite3")
    try:
        first = memory.observe_node(
            image((20, 40, 80)),
            location_name="Escissia",
            facing_estimate=FacingEstimate.NORTH,
        )
        second = memory.observe_node(
            image((20, 40, 80)),
            location_name="Escissia",
            facing_estimate=FacingEstimate.NORTH,
        )
        third = memory.observe_node(
            image((20, 40, 80)),
            location_name="Escissia",
            facing_estimate=FacingEstimate.NORTH,
        )
        assert first.id == second.id == third.id
        assert third.recognition_count == 3
        assert third.stable

        landmark1 = memory.observe_landmark(
            node_id=third.id,
            kind=LandmarkKind.LOCATION_SIGN,
            description="Town sign at the entrance",
            image=image((80, 30, 20)),
            confidence=0.8,
            save_keyframe=True,
        )
        landmark2 = memory.observe_landmark(
            node_id=third.id,
            kind=LandmarkKind.LOCATION_SIGN,
            description="Town sign",
            image=image((80, 30, 20)),
            confidence=0.85,
            save_keyframe=False,
        )
        landmark3 = memory.observe_landmark(
            node_id=third.id,
            kind=LandmarkKind.LOCATION_SIGN,
            description="Town sign",
            image=image((80, 30, 20)),
            confidence=0.9,
            save_keyframe=False,
        )
        assert landmark1.id == landmark2.id == landmark3.id
        assert not landmark2.stable
        assert landmark3.stable
        assert landmark1.keyframe_path and Path(landmark1.keyframe_path).exists()

        confirmed = memory.observe_landmark(
            node_id=third.id,
            kind=LandmarkKind.MAP_TRANSITION,
            description="Route exit",
            image=image((10, 100, 40)),
            confidence=0.75,
            transition_confirmed=True,
            save_keyframe=False,
        )
        assert confirmed.stable and confirmed.transition_confirmed
    finally:
        memory.close()


def test_transition_learning_updates_reliability_collision_and_duration(tmp_path: Path) -> None:
    memory = NavigationMemory(tmp_path / "navigation.sqlite3")
    try:
        source = memory.observe_node(image((20, 20, 100)), location_name="Escissia")
        target = memory.observe_node(image((100, 20, 20)), location_name="Route 1")
        edge = memory.record_transition(
            source_node=source.id,
            action_macro="move:up",
            target_node=target.id,
            success=True,
            duration_seconds=1.0,
        )
        edge = memory.record_transition(
            source_node=source.id,
            action_macro="move:up",
            target_node=target.id,
            success=False,
            duration_seconds=3.0,
            collision=True,
        )
        assert edge.success_count == 1
        assert edge.failure_count == 1
        assert edge.collision_count == 1
        assert edge.average_duration == 2
        assert edge.reliability == 0.5
        metrics = memory.benchmark()
        assert metrics["transition_success_rate"] == 0.5
        assert metrics["collision_count"] == 1
    finally:
        memory.close()


def test_a_star_and_hierarchical_navigation_choose_reliable_route(tmp_path: Path) -> None:
    memory = NavigationMemory(tmp_path / "navigation.sqlite3")
    try:
        a = memory.observe_node(image((20, 20, 120)), location_name="Escissia")
        b = memory.observe_node(image((20, 120, 20)), location_name="Route 1")
        c = memory.observe_node(image((120, 20, 20)), location_name="Aquarellia")
        memory.record_transition(
            source_node=a.id,
            action_macro="move:up",
            target_node=b.id,
            success=True,
            duration_seconds=1,
        )
        memory.record_transition(
            source_node=b.id,
            action_macro="interact",
            target_node=c.id,
            success=True,
            duration_seconds=1,
            required_interaction=True,
        )
        memory.record_transition(
            source_node=a.id,
            action_macro="move:right",
            target_node=c.id,
            success=False,
            duration_seconds=5,
            collision=True,
        )
        route = memory.a_star(a.id, c.id)
        assert route is not None
        assert route.node_ids == [a.id, b.id, c.id]
        navigator = HierarchicalNavigator(memory)
        plan = navigator.plan(
            a.id,
            StrategicNavigationGoal(
                destination="Aquarellia",
                reason="Continue toward Nouvaria City.",
            ),
        )
        assert plan is not None
        assert plan.action_macros == ["move:up", "interact"]
        assert navigator.exploration_macro(c.id).startswith("move")
    finally:
        memory.close()


def test_transition_evaluator_detects_motion_collision_and_map_change() -> None:
    evaluator = NavigationTransitionEvaluator()
    before = game_state("before", signature="0011", location="Escissia")
    moved = game_state("moved", signature="0022", location="Escissia")
    collision = game_state("collision", signature="0011", location="Escissia")
    changed_map = game_state("map", signature="0033", location="Route 1")

    moved_result = evaluator.assess(before, moved, action_macro=MacroName.MOVE_BURST)
    collision_result = evaluator.assess(before, collision, action_macro="move:up")
    map_result = evaluator.assess(before, changed_map, action_macro="move:up")
    assert moved_result.position_changed and not moved_result.collision
    assert collision_result.collision and collision_result.ineffective
    assert map_result.map_transition and "location_changed" in map_result.signals
