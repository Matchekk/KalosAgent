from __future__ import annotations

import hashlib
import heapq
import json
import math
import sqlite3
import threading
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np
from pydantic import BaseModel, Field

from .capture import perceptual_hash, save_frame
from .models import GameState, MacroName, Scene


def _now() -> str:
    return datetime.now(UTC).isoformat()


class FacingEstimate(StrEnum):
    NORTH = "north"
    SOUTH = "south"
    EAST = "east"
    WEST = "west"
    UNKNOWN = "unknown"


class LandmarkKind(StrEnum):
    LOCATION_SIGN = "location_sign"
    BUILDING = "building"
    DOOR = "door"
    STAIRS = "stairs"
    CROSSROAD = "crossroad"
    POKEMON_CENTER = "pokemon_center"
    GYM = "gym"
    NPC = "npc"
    SPECIAL_OBJECT = "special_object"
    MAP_TRANSITION = "map_transition"


class NavigationNode(BaseModel):
    id: int | None = None
    location_name: str | None = None
    visual_embedding: list[float]
    scene_type: Scene = Scene.OVERWORLD
    screen_signature: str
    facing_estimate: FacingEstimate = FacingEstimate.UNKNOWN
    nearby_landmarks: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    recognition_count: int = Field(default=1, ge=1)
    stable: bool = False


class NavigationEdge(BaseModel):
    id: int | None = None
    source_node: int
    action_macro: str
    target_node: int | None = None
    success_count: int = Field(default=0, ge=0)
    failure_count: int = Field(default=0, ge=0)
    average_duration: float = Field(default=0.0, ge=0.0)
    collision_count: int = Field(default=0, ge=0)
    required_interaction: bool = False
    last_seen: str = Field(default_factory=_now)

    @property
    def reliability(self) -> float:
        return (self.success_count + 1) / (self.success_count + self.failure_count + 2)


class LandmarkObservation(BaseModel):
    id: int | None = None
    node_id: int
    kind: LandmarkKind
    description: str
    visual_embedding: list[float]
    keyframe_path: str | None = None
    recognition_count: int = Field(default=1, ge=1)
    transition_confirmed: bool = False
    stable: bool = False
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class NavigationTransitionAssessment(BaseModel):
    position_changed: bool
    new_landmark_state: bool
    collision: bool
    map_transition: bool
    ineffective: bool
    confidence: float = Field(ge=0.0, le=1.0)
    signals: list[str] = Field(default_factory=list)


class GraphRoute(BaseModel):
    node_ids: list[int]
    edges: list[NavigationEdge]
    total_cost: float = Field(ge=0.0)


class StrategicNavigationGoal(BaseModel):
    destination: str
    reason: str


class LocalNavigationPlan(BaseModel):
    strategic_goal: StrategicNavigationGoal
    graph_route: GraphRoute
    action_macros: list[str]


class VisualEmbeddingBackend(Protocol):
    def embed(self, image: np.ndarray) -> list[float]: ...


class HistogramEmbeddingBackend:
    """Small deterministic CPU embedding suitable for offline landmark matching."""

    def embed(self, image: np.ndarray) -> list[float]:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        histogram = cv2.calcHist([hsv], [0, 1, 2], None, [8, 4, 4], [0, 180, 0, 256, 0, 256])
        vector = histogram.flatten().astype(np.float64)
        norm = float(np.linalg.norm(vector))
        if norm:
            vector /= norm
        return vector.tolist()


def cosine_similarity(left: list[float], right: list[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    left_array = np.asarray(left, dtype=np.float64)
    right_array = np.asarray(right, dtype=np.float64)
    denominator = float(np.linalg.norm(left_array) * np.linalg.norm(right_array))
    return float(np.dot(left_array, right_array) / denominator) if denominator else 0.0


NAVIGATION_SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS navigation_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_name TEXT,
    embedding_json TEXT NOT NULL,
    scene_type TEXT NOT NULL,
    screen_signature TEXT NOT NULL,
    facing_estimate TEXT NOT NULL,
    nearby_landmarks_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    recognition_count INTEGER NOT NULL,
    stable INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS navigation_edges (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_node INTEGER NOT NULL REFERENCES navigation_nodes(id),
    action_macro TEXT NOT NULL,
    target_node INTEGER REFERENCES navigation_nodes(id),
    success_count INTEGER NOT NULL,
    failure_count INTEGER NOT NULL,
    average_duration REAL NOT NULL,
    collision_count INTEGER NOT NULL,
    required_interaction INTEGER NOT NULL,
    last_seen TEXT NOT NULL,
    UNIQUE(source_node, action_macro, target_node)
);
CREATE TABLE IF NOT EXISTS landmark_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL REFERENCES navigation_nodes(id),
    kind TEXT NOT NULL,
    description TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    keyframe_path TEXT,
    recognition_count INTEGER NOT NULL,
    transition_confirmed INTEGER NOT NULL,
    stable INTEGER NOT NULL,
    confidence REAL NOT NULL,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nav_edges_source ON navigation_edges(source_node);
CREATE INDEX IF NOT EXISTS idx_nav_nodes_location ON navigation_nodes(location_name);
"""


class NavigationMemory:
    def __init__(
        self,
        path: str | Path,
        *,
        embedding_backend: VisualEmbeddingBackend | None = None,
        keyframe_dir: str | Path | None = None,
        node_match_threshold: float = 0.92,
        landmark_match_threshold: float = 0.94,
        stable_recognitions: int = 3,
    ) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self.embedding_backend = embedding_backend or HistogramEmbeddingBackend()
        self.keyframe_dir = Path(keyframe_dir or self.path.parent / "navigation-keyframes")
        self.node_match_threshold = node_match_threshold
        self.landmark_match_threshold = landmark_match_threshold
        self.stable_recognitions = stable_recognitions
        with self.connection:
            self.connection.execute("PRAGMA journal_mode = WAL")
            self.connection.executescript(NAVIGATION_SCHEMA)

    def observe_node(
        self,
        image: np.ndarray,
        *,
        location_name: str | None,
        scene_type: Scene = Scene.OVERWORLD,
        facing_estimate: FacingEstimate = FacingEstimate.UNKNOWN,
        nearby_landmarks: list[str] | None = None,
        confidence: float = 0.6,
    ) -> NavigationNode:
        embedding = self.embedding_backend.embed(image)
        signature = perceptual_hash(image)
        match = self.find_node(
            embedding,
            location_name=location_name,
            scene_type=scene_type,
        )
        with self._lock, self.connection:
            if match:
                count = match.recognition_count + 1
                weight = 1 / count
                averaged = [
                    old * (1 - weight) + new * weight
                    for old, new in zip(match.visual_embedding, embedding, strict=True)
                ]
                stable = match.stable or count >= self.stable_recognitions
                self.connection.execute(
                    """UPDATE navigation_nodes SET embedding_json = ?, screen_signature = ?,
                       facing_estimate = ?, nearby_landmarks_json = ?, confidence = ?,
                       recognition_count = ?, stable = ?, last_seen = ? WHERE id = ?""",
                    (
                        json.dumps(averaged),
                        signature,
                        facing_estimate.value,
                        json.dumps(nearby_landmarks or match.nearby_landmarks),
                        max(match.confidence, confidence),
                        count,
                        int(stable),
                        _now(),
                        match.id,
                    ),
                )
                assert match.id is not None
                return self.node(match.id)
            cursor = self.connection.execute(
                """INSERT INTO navigation_nodes
                   (location_name, embedding_json, scene_type, screen_signature,
                    facing_estimate, nearby_landmarks_json, confidence,
                    recognition_count, stable, created_at, last_seen)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)""",
                (
                    location_name,
                    json.dumps(embedding),
                    scene_type.value,
                    signature,
                    facing_estimate.value,
                    json.dumps(nearby_landmarks or []),
                    confidence,
                    _now(),
                    _now(),
                ),
            )
            if cursor.lastrowid is None:
                raise RuntimeError("SQLite did not return a navigation node id.")
            return self.node(int(cursor.lastrowid))

    def node(self, node_id: int) -> NavigationNode:
        row = self.connection.execute(
            "SELECT * FROM navigation_nodes WHERE id = ?", (node_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"Unknown navigation node {node_id}")
        return NavigationNode(
            id=row["id"],
            location_name=row["location_name"],
            visual_embedding=json.loads(row["embedding_json"]),
            scene_type=row["scene_type"],
            screen_signature=row["screen_signature"],
            facing_estimate=row["facing_estimate"],
            nearby_landmarks=json.loads(row["nearby_landmarks_json"]),
            confidence=row["confidence"],
            recognition_count=row["recognition_count"],
            stable=bool(row["stable"]),
        )

    def nodes(self) -> list[NavigationNode]:
        return [
            self.node(row["id"])
            for row in self.connection.execute("SELECT id FROM navigation_nodes")
        ]

    def find_node(
        self,
        embedding: list[float],
        *,
        location_name: str | None,
        scene_type: Scene,
    ) -> NavigationNode | None:
        candidates = [node for node in self.nodes() if node.scene_type == scene_type]
        if location_name:
            named = [
                node
                for node in candidates
                if node.location_name and node.location_name.casefold() == location_name.casefold()
            ]
            if named:
                candidates = named
        ranked = sorted(
            ((cosine_similarity(embedding, node.visual_embedding), node) for node in candidates),
            key=lambda item: item[0],
            reverse=True,
        )
        return ranked[0][1] if ranked and ranked[0][0] >= self.node_match_threshold else None

    def record_transition(
        self,
        *,
        source_node: int,
        action_macro: str | MacroName,
        target_node: int | None,
        success: bool,
        duration_seconds: float,
        collision: bool = False,
        required_interaction: bool = False,
    ) -> NavigationEdge:
        action = action_macro.value if isinstance(action_macro, MacroName) else action_macro
        row = self.connection.execute(
            """SELECT * FROM navigation_edges
               WHERE source_node = ? AND action_macro = ? AND target_node IS ?""",
            (source_node, action, target_node),
        ).fetchone()
        with self._lock, self.connection:
            if row:
                successes = row["success_count"] + int(success)
                failures = row["failure_count"] + int(not success)
                attempts = successes + failures
                old_attempts = row["success_count"] + row["failure_count"]
                average = (
                    (row["average_duration"] * old_attempts + duration_seconds) / attempts
                    if attempts
                    else 0.0
                )
                self.connection.execute(
                    """UPDATE navigation_edges SET success_count = ?, failure_count = ?,
                       average_duration = ?, collision_count = ?,
                       required_interaction = ?, last_seen = ? WHERE id = ?""",
                    (
                        successes,
                        failures,
                        average,
                        row["collision_count"] + int(collision),
                        int(bool(row["required_interaction"] or required_interaction)),
                        _now(),
                        row["id"],
                    ),
                )
                return self.edge(row["id"])
            cursor = self.connection.execute(
                """INSERT INTO navigation_edges
                   (source_node, action_macro, target_node, success_count,
                    failure_count, average_duration, collision_count,
                    required_interaction, last_seen)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    source_node,
                    action,
                    target_node,
                    int(success),
                    int(not success),
                    duration_seconds,
                    int(collision),
                    int(required_interaction),
                    _now(),
                ),
            )
            if cursor.lastrowid is None:
                raise RuntimeError("SQLite did not return a navigation edge id.")
            return self.edge(int(cursor.lastrowid))

    def edge(self, edge_id: int) -> NavigationEdge:
        row = self.connection.execute(
            "SELECT * FROM navigation_edges WHERE id = ?", (edge_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"Unknown navigation edge {edge_id}")
        return NavigationEdge(
            id=row["id"],
            source_node=row["source_node"],
            action_macro=row["action_macro"],
            target_node=row["target_node"],
            success_count=row["success_count"],
            failure_count=row["failure_count"],
            average_duration=row["average_duration"],
            collision_count=row["collision_count"],
            required_interaction=bool(row["required_interaction"]),
            last_seen=row["last_seen"],
        )

    def edges_from(self, node_id: int) -> list[NavigationEdge]:
        return [
            self.edge(row["id"])
            for row in self.connection.execute(
                "SELECT id FROM navigation_edges WHERE source_node = ?", (node_id,)
            )
        ]

    def observe_landmark(
        self,
        *,
        node_id: int,
        kind: LandmarkKind,
        description: str,
        image: np.ndarray,
        confidence: float,
        transition_confirmed: bool = False,
        save_keyframe: bool = True,
    ) -> LandmarkObservation:
        embedding = self.embedding_backend.embed(image)
        matches = []
        for row in self.connection.execute(
            "SELECT * FROM landmark_observations WHERE node_id = ? AND kind = ?",
            (node_id, kind.value),
        ):
            similarity = cosine_similarity(embedding, json.loads(row["embedding_json"]))
            if similarity >= self.landmark_match_threshold:
                matches.append((similarity, row))
        row = max(matches, key=lambda item: item[0])[1] if matches else None
        keyframe_path = None
        if save_keyframe:
            digest = hashlib.sha256(image.tobytes()).hexdigest()[:16]
            keyframe_path = str(
                save_frame(self.keyframe_dir / f"{node_id}-{kind.value}-{digest}.png", image)
            )
        with self._lock, self.connection:
            if row:
                count = row["recognition_count"] + 1
                confirmed = bool(row["transition_confirmed"] or transition_confirmed)
                stable = confirmed or count >= self.stable_recognitions
                self.connection.execute(
                    """UPDATE landmark_observations SET description = ?, keyframe_path = ?,
                       recognition_count = ?, transition_confirmed = ?, stable = ?,
                       confidence = ?, last_seen = ? WHERE id = ?""",
                    (
                        description or row["description"],
                        keyframe_path or row["keyframe_path"],
                        count,
                        int(confirmed),
                        int(stable),
                        max(confidence, row["confidence"]),
                        _now(),
                        row["id"],
                    ),
                )
                return self.landmark(row["id"])
            cursor = self.connection.execute(
                """INSERT INTO landmark_observations
                   (node_id, kind, description, embedding_json, keyframe_path,
                    recognition_count, transition_confirmed, stable, confidence,
                    first_seen, last_seen)
                   VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)""",
                (
                    node_id,
                    kind.value,
                    description,
                    json.dumps(embedding),
                    keyframe_path,
                    int(transition_confirmed),
                    int(transition_confirmed),
                    confidence,
                    _now(),
                    _now(),
                ),
            )
            if cursor.lastrowid is None:
                raise RuntimeError("SQLite did not return a landmark id.")
            return self.landmark(int(cursor.lastrowid))

    def landmark(self, landmark_id: int) -> LandmarkObservation:
        row = self.connection.execute(
            "SELECT * FROM landmark_observations WHERE id = ?", (landmark_id,)
        ).fetchone()
        if row is None:
            raise KeyError(f"Unknown landmark {landmark_id}")
        return LandmarkObservation(
            id=row["id"],
            node_id=row["node_id"],
            kind=row["kind"],
            description=row["description"],
            visual_embedding=json.loads(row["embedding_json"]),
            keyframe_path=row["keyframe_path"],
            recognition_count=row["recognition_count"],
            transition_confirmed=bool(row["transition_confirmed"]),
            stable=bool(row["stable"]),
            confidence=row["confidence"],
        )

    def a_star(
        self,
        source_node: int,
        target_node: int,
        *,
        minimum_reliability: float = 0.25,
    ) -> GraphRoute | None:
        target = self.node(target_node)
        queue: list[tuple[float, int]] = [(0.0, source_node)]
        costs = {source_node: 0.0}
        parents: dict[int, tuple[int, NavigationEdge]] = {}
        while queue:
            _, current = heapq.heappop(queue)
            if current == target_node:
                break
            for edge in self.edges_from(current):
                if edge.target_node is None or edge.reliability < minimum_reliability:
                    continue
                duration = edge.average_duration or 1.0
                edge_cost = (
                    duration / max(edge.reliability, 0.05)
                    + edge.failure_count * 0.5
                    + edge.collision_count * 0.75
                )
                new_cost = costs[current] + edge_cost
                if new_cost >= costs.get(edge.target_node, math.inf):
                    continue
                costs[edge.target_node] = new_cost
                parents[edge.target_node] = (current, edge)
                heuristic = 1 - cosine_similarity(
                    self.node(edge.target_node).visual_embedding,
                    target.visual_embedding,
                )
                heapq.heappush(queue, (new_cost + heuristic, edge.target_node))
        if target_node not in costs:
            return None
        node_ids = [target_node]
        edges: list[NavigationEdge] = []
        current = target_node
        while current != source_node:
            parent, edge = parents[current]
            edges.append(edge)
            node_ids.append(parent)
            current = parent
        node_ids.reverse()
        edges.reverse()
        return GraphRoute(node_ids=node_ids, edges=edges, total_cost=costs[target_node])

    def node_for_location(self, location_name: str) -> NavigationNode | None:
        rows = self.connection.execute(
            """SELECT id FROM navigation_nodes
               WHERE lower(location_name) = lower(?) ORDER BY stable DESC,
               recognition_count DESC LIMIT 1""",
            (location_name,),
        ).fetchall()
        return self.node(rows[0]["id"]) if rows else None

    def benchmark(self) -> dict[str, float | int]:
        edges = [
            self.edge(row["id"])
            for row in self.connection.execute("SELECT id FROM navigation_edges")
        ]
        landmarks = list(self.connection.execute("SELECT stable FROM landmark_observations"))
        successes = sum(edge.success_count for edge in edges)
        failures = sum(edge.failure_count for edge in edges)
        return {
            "nodes": self.connection.execute("SELECT COUNT(*) FROM navigation_nodes").fetchone()[0],
            "edges": len(edges),
            "transition_success_rate": successes / (successes + failures)
            if successes + failures
            else 0.0,
            "collision_count": sum(edge.collision_count for edge in edges),
            "stable_landmark_rate": sum(row["stable"] for row in landmarks) / len(landmarks)
            if landmarks
            else 0.0,
            "loop_rate": failures / (successes + failures) if successes + failures else 0.0,
        }

    def close(self) -> None:
        self.connection.close()


class NavigationTransitionEvaluator:
    def assess(
        self,
        before: GameState,
        after: GameState,
        *,
        action_macro: str | MacroName,
        matched_new_landmark: bool = False,
    ) -> NavigationTransitionAssessment:
        action = action_macro.value if isinstance(action_macro, MacroName) else action_macro
        location_changed = (
            before.overworld.location_name != after.overworld.location_name
            and after.overworld.location_name is not None
        )
        signature_changed = before.perceptual_hash != after.perceptual_hash
        map_transition = location_changed or (
            (before.scene == Scene.OVERWORLD and after.scene == Scene.LOADING)
            or (before.scene == Scene.LOADING and after.scene == Scene.OVERWORLD)
            or (before.scene == Scene.OVERWORLD and after.transition_active)
        )
        position_changed = signature_changed or location_changed
        movement = action == MacroName.MOVE_BURST.value or action.startswith("move")
        collision = movement and not position_changed and not after.transition_active
        ineffective = not position_changed and not matched_new_landmark
        signals = []
        if signature_changed:
            signals.append("screen_signature_changed")
        if location_changed:
            signals.append("location_changed")
        if map_transition:
            signals.append("map_transition")
        if collision:
            signals.append("collision")
        return NavigationTransitionAssessment(
            position_changed=position_changed,
            new_landmark_state=matched_new_landmark,
            collision=collision,
            map_transition=map_transition,
            ineffective=ineffective,
            confidence=0.9 if location_changed or collision else 0.65,
            signals=signals,
        )


class HierarchicalNavigator:
    def __init__(self, memory: NavigationMemory) -> None:
        self.memory = memory

    def plan(
        self,
        current_node: int,
        goal: StrategicNavigationGoal,
    ) -> LocalNavigationPlan | None:
        target = self.memory.node_for_location(goal.destination)
        if target is None or target.id is None:
            return None
        route = self.memory.a_star(current_node, target.id)
        if route is None:
            return None
        return LocalNavigationPlan(
            strategic_goal=goal,
            graph_route=route,
            action_macros=[edge.action_macro for edge in route.edges],
        )

    def exploration_macro(self, current_node: int) -> str:
        attempted = self.memory.edges_from(current_node)
        counts = {edge.action_macro: edge.success_count + edge.failure_count for edge in attempted}
        options = ["move:up", "move:right", "move:down", "move:left", "interact"]
        return min(
            enumerate(options),
            key=lambda item: (counts.get(item[1], 0), item[0]),
        )[1]
