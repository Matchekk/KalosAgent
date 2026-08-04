from __future__ import annotations

import json
import sqlite3
import threading
import uuid
from collections import deque
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .models import (
    ActionExecutionResult,
    ActionPlan,
    GameState,
    Objective,
    PlannerResult,
    ProgressAssessment,
)


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _json(value: Any) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS episodes (
    id TEXT PRIMARY KEY,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    objective TEXT NOT NULL,
    status TEXT NOT NULL,
    replay_path TEXT
);
CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    cycle_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    frame_id TEXT NOT NULL,
    state_json TEXT NOT NULL,
    screenshot_path TEXT,
    regions_json TEXT,
    UNIQUE(episode_id, cycle_id, frame_id)
);
CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id TEXT NOT NULL REFERENCES episodes(id),
    cycle_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    execution_json TEXT,
    progress_json TEXT
);
CREATE TABLE IF NOT EXISTS durable_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fact_key TEXT NOT NULL UNIQUE,
    value_json TEXT NOT NULL,
    confidence REAL NOT NULL,
    source TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS objectives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    reason TEXT NOT NULL,
    expected_result TEXT NOT NULL,
    status TEXT NOT NULL,
    priority INTEGER NOT NULL,
    parent_id INTEGER REFERENCES objectives(id),
    progress_criterion TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id TEXT REFERENCES episodes(id),
    kind TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id TEXT REFERENCES episodes(id),
    cycle_id TEXT,
    situation_json TEXT NOT NULL,
    action_json TEXT NOT NULL,
    outcome_json TEXT NOT NULL,
    recovery_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS landmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    fingerprint TEXT,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    episode_id TEXT REFERENCES episodes(id),
    cycle_id TEXT,
    kind TEXT NOT NULL,
    model TEXT NOT NULL,
    input_json TEXT NOT NULL,
    output_json TEXT NOT NULL,
    latency_ms REAL NOT NULL,
    valid_json INTEGER NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_observations_episode ON observations(episode_id, id);
CREATE INDEX IF NOT EXISTS idx_actions_episode ON actions(episode_id, id);
CREATE INDEX IF NOT EXISTS idx_failures_episode ON failures(episode_id, id);
"""


class WorkingMemory:
    """Small volatile context; rapidly changing screen data never becomes a fact."""

    def __init__(self, size: int = 12) -> None:
        self.observations: deque[GameState] = deque(maxlen=size)
        self.current_plan: ActionPlan | None = None
        self.current_action: str | None = None
        self.uncertainties: deque[str] = deque(maxlen=size)

    def observe(self, state: GameState) -> None:
        self.observations.append(state)
        if state.uncertainty >= 0.5:
            self.uncertainties.append(
                f"{state.frame_id}:{state.scene.value}:{state.uncertainty:.2f}"
            )

    def as_dict(self) -> dict[str, Any]:
        return {
            "recent_states": [
                {
                    "scene": state.scene.value,
                    "text": state.normalized_text(),
                    "stable": state.screen_stable,
                }
                for state in self.observations
            ],
            "current_plan": (
                self.current_plan.model_dump(mode="json") if self.current_plan else None
            ),
            "current_action": self.current_action,
            "uncertainties": list(self.uncertainties),
        }


class MemoryStore:
    def __init__(self, database_path: str | Path) -> None:
        self.path = Path(database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self.connection:
            self.connection.execute("PRAGMA journal_mode = WAL")
            self.connection.executescript(SCHEMA)

    def start_episode(self, objective: str, replay_path: str | None = None) -> str:
        episode_id = uuid.uuid4().hex
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT INTO episodes
                   (id, started_at, objective, status, replay_path)
                   VALUES (?, ?, ?, 'running', ?)""",
                (episode_id, _now(), objective, replay_path),
            )
        return episode_id

    def finish_episode(self, episode_id: str, status: str = "completed") -> None:
        with self._lock, self.connection:
            self.connection.execute(
                "UPDATE episodes SET ended_at = ?, status = ? WHERE id = ?",
                (_now(), status, episode_id),
            )

    def record_observation(
        self,
        episode_id: str,
        cycle_id: str,
        state: GameState,
        *,
        screenshot_path: str | None = None,
        regions: dict[str, str] | None = None,
    ) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT OR IGNORE INTO observations
                   (episode_id, cycle_id, created_at, frame_id, state_json,
                    screenshot_path, regions_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    episode_id,
                    cycle_id,
                    _now(),
                    state.frame_id,
                    state.model_dump_json(),
                    screenshot_path,
                    _json(regions or {}),
                ),
            )

    def record_action(
        self,
        episode_id: str,
        cycle_id: str,
        plan: ActionPlan,
        execution: ActionExecutionResult | None,
        progress: ProgressAssessment | None,
    ) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT INTO actions
                   (episode_id, cycle_id, created_at, plan_json, execution_json,
                    progress_json) VALUES (?, ?, ?, ?, ?, ?)""",
                (
                    episode_id,
                    cycle_id,
                    _now(),
                    plan.model_dump_json(),
                    execution.model_dump_json() if execution else None,
                    progress.model_dump_json() if progress else None,
                ),
            )
        for index, fact in enumerate(plan.memory_updates):
            cleaned = " ".join(fact.split())
            if cleaned:
                self.upsert_fact(
                    f"planner:{cleaned.lower()[:80]}:{index}",
                    {"fact": cleaned},
                    confidence=plan.confidence,
                    source="planner_proposal",
                )

    def record_model_call(
        self,
        episode_id: str,
        cycle_id: str,
        *,
        kind: str,
        model: str,
        input_value: Any,
        result: PlannerResult | dict[str, Any],
        latency_ms: float,
        valid_json: bool,
        error: str | None = None,
    ) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT INTO model_calls
                   (episode_id, cycle_id, kind, model, input_json, output_json,
                    latency_ms, valid_json, error, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    episode_id,
                    cycle_id,
                    kind,
                    model,
                    _json(input_value),
                    _json(result),
                    latency_ms,
                    int(valid_json),
                    error,
                    _now(),
                ),
            )

    def record_failure(
        self,
        episode_id: str,
        cycle_id: str,
        *,
        situation: Any,
        action: Any,
        outcome: Any,
        recovery: Any,
    ) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT INTO failures
                   (episode_id, cycle_id, situation_json, action_json,
                    outcome_json, recovery_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    episode_id,
                    cycle_id,
                    _json(situation),
                    _json(action),
                    _json(outcome),
                    _json(recovery),
                    _now(),
                ),
            )

    def upsert_fact(
        self,
        key: str,
        value: Any,
        *,
        confidence: float,
        source: str,
    ) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT INTO durable_facts
                   (fact_key, value_json, confidence, source, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(fact_key) DO UPDATE SET
                     value_json=excluded.value_json,
                     confidence=excluded.confidence,
                     source=excluded.source,
                     updated_at=excluded.updated_at""",
                (key, _json(value), confidence, source, _now()),
            )

    def add_objective(self, objective: Objective) -> int:
        now = _now()
        with self._lock, self.connection:
            cursor = self.connection.execute(
                """INSERT INTO objectives
                   (description, reason, expected_result, status, priority,
                    parent_id, progress_criterion, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    objective.description,
                    objective.reason,
                    objective.expected_result,
                    objective.status.value,
                    objective.priority,
                    objective.parent_id,
                    objective.progress_criterion,
                    now,
                    now,
                ),
            )
        if cursor.lastrowid is None:
            raise RuntimeError("SQLite did not return an objective id.")
        return int(cursor.lastrowid)

    def add_summary(self, episode_id: str, kind: str, summary: str) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                "INSERT INTO summaries (episode_id, kind, summary, created_at) VALUES (?, ?, ?, ?)",
                (episode_id, kind, summary, _now()),
            )

    def update_objective_status(self, objective_id: int, status: str) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                "UPDATE objectives SET status = ?, updated_at = ? WHERE id = ?",
                (status, _now(), objective_id),
            )

    def upsert_landmark(
        self, name: str, description: str, fingerprint: str | None, data: Any
    ) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT INTO landmarks
                   (name, description, fingerprint, data_json, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(name) DO UPDATE SET
                     description=excluded.description,
                     fingerprint=excluded.fingerprint,
                     data_json=excluded.data_json,
                     updated_at=excluded.updated_at""",
                (name, description, fingerprint, _json(data), _now()),
            )

    def durable_context(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """SELECT fact_key, value_json, confidence, source
               FROM durable_facts ORDER BY updated_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [
            {
                "key": row["fact_key"],
                "value": json.loads(row["value_json"]),
                "confidence": row["confidence"],
                "source": row["source"],
            }
            for row in rows
        ]

    def episodic_context(self, limit: int = 8) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """SELECT plan_json, execution_json, progress_json FROM actions
               ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [
            {
                "plan": json.loads(row["plan_json"]),
                "execution": json.loads(row["execution_json"]) if row["execution_json"] else None,
                "progress": json.loads(row["progress_json"]) if row["progress_json"] else None,
            }
            for row in rows
        ]

    def failed_context(self, limit: int = 8) -> list[dict[str, Any]]:
        rows = self.connection.execute(
            """SELECT situation_json, action_json, outcome_json, recovery_json
               FROM failures ORDER BY id DESC LIMIT ?""",
            (limit,),
        ).fetchall()
        return [
            {key.removesuffix("_json"): json.loads(value) for key, value in dict(row).items()}
            for row in rows
        ]

    def table_counts(self) -> dict[str, int]:
        tables = (
            "observations",
            "actions",
            "episodes",
            "durable_facts",
            "objectives",
            "summaries",
            "failures",
            "landmarks",
            "model_calls",
        )
        return {
            table: int(self.connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in tables
        }

    def close(self) -> None:
        with self._lock:
            self.connection.close()
