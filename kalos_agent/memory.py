from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from .models import ActionPlan, Observation


class EpisodicMemory:
    def __init__(self, database_path: str | Path) -> None:
        self.path = Path(database_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS episodes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                observation_json TEXT NOT NULL,
                plan_json TEXT NOT NULL,
                execution_json TEXT NOT NULL
            )
            """
        )
        self.connection.execute(
            """
            CREATE TABLE IF NOT EXISTS durable_facts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                fact TEXT NOT NULL UNIQUE
            )
            """
        )
        self.connection.commit()

    def append(
        self,
        observation: Observation,
        plan: ActionPlan,
        execution: list[dict[str, Any]],
    ) -> None:
        self.connection.execute(
            """
            INSERT INTO episodes (observation_json, plan_json, execution_json)
            VALUES (?, ?, ?)
            """,
            (
                observation.model_dump_json(),
                plan.model_dump_json(),
                json.dumps(execution, ensure_ascii=False),
            ),
        )
        for fact in plan.memory_updates:
            cleaned = " ".join(fact.split())
            if cleaned:
                self.connection.execute(
                    "INSERT OR IGNORE INTO durable_facts (fact) VALUES (?)",
                    (cleaned,),
                )
        self.connection.commit()

    def recent(self, limit: int) -> list[dict[str, Any]]:
        if limit <= 0:
            return []
        facts = [
            dict(row)
            for row in self.connection.execute(
                "SELECT created_at, fact FROM durable_facts ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        ]
        episodes = [
            dict(row)
            for row in self.connection.execute(
                """
                SELECT created_at, observation_json, plan_json, execution_json
                FROM episodes ORDER BY id DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
        return [{"durable_facts": facts}, {"recent_episodes": episodes}]

    def close(self) -> None:
        self.connection.close()
