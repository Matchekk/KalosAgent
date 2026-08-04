from __future__ import annotations

import json
import sqlite3
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from .belief import OpponentBeliefModel, OpponentBeliefState
from .models import BattleState, MoveState
from .planner import BattleAction, BattleDecision, MechanicalCandidate


class BattleTurnRecord(BaseModel):
    battle_id: str
    turn_number: int = Field(ge=0)
    before_state: BattleState
    opponent_belief: OpponentBeliefState
    candidates: list[MechanicalCandidate]
    chosen_action: BattleAction
    expected_results: dict[str, Any] = Field(default_factory=dict)
    opponent_action: str | None = None
    actual_damage: int | None = Field(default=None, ge=0)
    actual_status_changes: list[str] = Field(default_factory=list)
    after_state: BattleState
    progress_score: float = 0.0
    decision_error: str | None = None
    battle_won: bool | None = None


BATTLE_LEARNING_SCHEMA = """
CREATE TABLE IF NOT EXISTS battles (
    battle_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    won INTEGER,
    metadata_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS battle_turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id TEXT NOT NULL REFERENCES battles(battle_id),
    turn_number INTEGER NOT NULL,
    before_state_json TEXT NOT NULL,
    belief_json TEXT NOT NULL,
    candidates_json TEXT NOT NULL,
    chosen_action_json TEXT NOT NULL,
    expected_results_json TEXT NOT NULL,
    opponent_action TEXT,
    actual_damage INTEGER,
    status_changes_json TEXT NOT NULL,
    after_state_json TEXT NOT NULL,
    progress_score REAL NOT NULL,
    decision_error TEXT,
    battle_won INTEGER,
    created_at TEXT NOT NULL,
    UNIQUE(battle_id, turn_number)
);
CREATE TABLE IF NOT EXISTS strategy_stats (
    situation_key TEXT NOT NULL,
    action_key TEXT NOT NULL,
    successes INTEGER NOT NULL,
    failures INTEGER NOT NULL,
    average_reward REAL NOT NULL,
    last_used TEXT NOT NULL,
    PRIMARY KEY(situation_key, action_key)
);
CREATE INDEX IF NOT EXISTS idx_battle_turns_battle ON battle_turns(battle_id, turn_number);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _json(value: Any) -> str:
    if hasattr(value, "model_dump"):
        value = value.model_dump(mode="json")
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        default=lambda item: item.model_dump(mode="json"),
    )


class BattleLearningStore:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(self.path, check_same_thread=False)
        self.connection.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self.connection:
            self.connection.execute("PRAGMA journal_mode = WAL")
            self.connection.execute("PRAGMA foreign_keys = ON")
            self.connection.executescript(BATTLE_LEARNING_SCHEMA)

    def start_battle(
        self,
        battle_id: str,
        *,
        source: str,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT OR IGNORE INTO battles
                   (battle_id, source, started_at, metadata_json)
                   VALUES (?, ?, ?, ?)""",
                (battle_id, source, _now(), _json(metadata or {})),
            )

    def finish_battle(self, battle_id: str, won: bool) -> None:
        with self._lock, self.connection:
            self.connection.execute(
                "UPDATE battles SET ended_at = ?, won = ? WHERE battle_id = ?",
                (_now(), int(won), battle_id),
            )

    def record_turn(self, record: BattleTurnRecord) -> None:
        self.start_battle(record.battle_id, source="emulator")
        with self._lock, self.connection:
            self.connection.execute(
                """INSERT OR REPLACE INTO battle_turns
                   (battle_id, turn_number, before_state_json, belief_json,
                    candidates_json, chosen_action_json, expected_results_json,
                    opponent_action, actual_damage, status_changes_json,
                    after_state_json, progress_score, decision_error, battle_won,
                    created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    record.battle_id,
                    record.turn_number,
                    record.before_state.model_dump_json(),
                    record.opponent_belief.model_dump_json(),
                    _json(record.candidates),
                    record.chosen_action.model_dump_json(),
                    _json(record.expected_results),
                    record.opponent_action,
                    record.actual_damage,
                    _json(record.actual_status_changes),
                    record.after_state.model_dump_json(),
                    record.progress_score,
                    record.decision_error,
                    int(record.battle_won) if record.battle_won is not None else None,
                    _now(),
                ),
            )
            self._update_strategy(record)

    def _update_strategy(self, record: BattleTurnRecord) -> None:
        situation = self.situation_key(record.before_state)
        action = self.action_key(record.chosen_action)
        success = record.progress_score > 0 and not record.decision_error
        row = self.connection.execute(
            """SELECT successes, failures, average_reward FROM strategy_stats
               WHERE situation_key = ? AND action_key = ?""",
            (situation, action),
        ).fetchone()
        successes = (row["successes"] if row else 0) + int(success)
        failures = (row["failures"] if row else 0) + int(not success)
        count = successes + failures
        old_average = row["average_reward"] if row else 0.0
        average = old_average + (record.progress_score - old_average) / count
        self.connection.execute(
            """INSERT OR REPLACE INTO strategy_stats
               (situation_key, action_key, successes, failures, average_reward, last_used)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (situation, action, successes, failures, average, _now()),
        )

    @staticmethod
    def situation_key(state: BattleState) -> str:
        player = state.active_player
        opponent = state.active_opponent
        return ":".join(
            (
                state.battle_type.value,
                player.canonical_name if player else "none",
                opponent.canonical_name if opponent else "none",
                f"p{round((player.hp.ratio if player else 0) * 4)}",
                f"o{round((opponent.hp.ratio if opponent else 0) * 4)}",
            )
        )

    @staticmethod
    def action_key(action: BattleAction) -> str:
        if action.move:
            return f"move:{action.move}"
        if action.switch_index is not None:
            return f"switch:{action.switch_index}"
        return action.kind.value

    def strategy_prior(self, state: BattleState, action: BattleAction) -> float:
        row = self.connection.execute(
            """SELECT successes, failures, average_reward FROM strategy_stats
               WHERE situation_key = ? AND action_key = ?""",
            (self.situation_key(state), self.action_key(action)),
        ).fetchone()
        if row is None:
            return 0.0
        reliability = (row["successes"] + 1) / (row["successes"] + row["failures"] + 2)
        return (reliability - 0.5) + row["average_reward"] * 0.25

    def records(self, battle_id: str | None = None) -> list[BattleTurnRecord]:
        query = "SELECT * FROM battle_turns"
        parameters: tuple[str, ...] = ()
        if battle_id:
            query += " WHERE battle_id = ?"
            parameters = (battle_id,)
        query += " ORDER BY battle_id, turn_number"
        return [
            BattleTurnRecord(
                battle_id=row["battle_id"],
                turn_number=row["turn_number"],
                before_state=BattleState.model_validate_json(row["before_state_json"]),
                opponent_belief=OpponentBeliefState.model_validate_json(row["belief_json"]),
                candidates=[
                    MechanicalCandidate.model_validate(item)
                    for item in json.loads(row["candidates_json"])
                ],
                chosen_action=BattleAction.model_validate_json(row["chosen_action_json"]),
                expected_results=json.loads(row["expected_results_json"]),
                opponent_action=row["opponent_action"],
                actual_damage=row["actual_damage"],
                actual_status_changes=json.loads(row["status_changes_json"]),
                after_state=BattleState.model_validate_json(row["after_state_json"]),
                progress_score=row["progress_score"],
                decision_error=row["decision_error"],
                battle_won=bool(row["battle_won"]) if row["battle_won"] is not None else None,
            )
            for row in self.connection.execute(query, parameters)
        ]

    def export_datasets(self, output_dir: str | Path) -> dict[str, Path]:
        output = Path(output_dir)
        output.mkdir(parents=True, exist_ok=True)
        paths = {
            "opponent_action": output / "opponent-action-predictor.jsonl",
            "value": output / "battle-value-model.jsonl",
            "ranking": output / "action-ranking.jsonl",
            "lora": output / "battle-lora.jsonl",
            "rl": output / "rl-transitions.jsonl",
        }
        handles = {name: path.open("w", encoding="utf-8") for name, path in paths.items()}
        try:
            for record in self.records():
                state = record.before_state.model_dump(mode="json")
                action = record.chosen_action.model_dump(mode="json")
                reward = record.progress_score
                values = {
                    "opponent_action": {
                        "state": state,
                        "belief": record.opponent_belief.model_dump(mode="json"),
                        "label": record.opponent_action,
                    },
                    "value": {"state": state, "action": action, "value": reward},
                    "ranking": {
                        "state": state,
                        "candidates": [item.model_dump(mode="json") for item in record.candidates],
                        "chosen": action,
                        "reward": reward,
                    },
                    "lora": {
                        "messages": [
                            {
                                "role": "system",
                                "content": "Rank precomputed Generation-VI battle lines.",
                            },
                            {
                                "role": "user",
                                "content": _json(
                                    {"state": state, "candidates": record.expected_results}
                                ),
                            },
                            {"role": "assistant", "content": _json(action)},
                        ]
                    },
                    "rl": {
                        "state": state,
                        "action": action,
                        "reward": reward,
                        "next_state": record.after_state.model_dump(mode="json"),
                        "done": record.battle_won is not None,
                    },
                }
                for name, payload in values.items():
                    handles[name].write(json.dumps(payload, ensure_ascii=False) + "\n")
        finally:
            for handle in handles.values():
                handle.close()
        return paths

    def benchmark(self) -> dict[str, float | int]:
        records = self.records()
        predicted_opponent = 0
        correct_opponent = 0
        ko_predictions = 0
        correct_ko = 0
        for record in records:
            likely = OpponentBeliefModel.likely_actions(record.opponent_belief, limit=1)
            if likely and record.opponent_action:
                predicted_opponent += 1
                correct_opponent += int(likely[0].move == record.opponent_action)
            selected = next(
                (
                    item
                    for item in record.candidates
                    if self.action_key(item.action) == self.action_key(record.chosen_action)
                ),
                None,
            )
            if selected and selected.ko_probability >= 0.5:
                ko_predictions += 1
                opponent = record.after_state.active_opponent
                correct_ko += int(opponent is None or opponent.fainted or opponent.hp.ratio <= 0)
        battles = list(self.connection.execute("SELECT won FROM battles WHERE won IS NOT NULL"))
        return {
            "turns": len(records),
            "opponent_action_accuracy": correct_opponent / predicted_opponent
            if predicted_opponent
            else 0.0,
            "ko_prediction_accuracy": correct_ko / ko_predictions if ko_predictions else 0.0,
            "battle_win_rate": sum(row["won"] for row in battles) / len(battles)
            if battles
            else 0.0,
            "decision_errors": sum(record.decision_error is not None for record in records),
        }

    def close(self) -> None:
        self.connection.close()


class InContextBattleLearner:
    """Updates structured beliefs/statistics; it never updates model weights online."""

    def __init__(self, belief_model: OpponentBeliefModel, store: BattleLearningStore) -> None:
        self.belief_model = belief_model
        self.store = store

    def apply_turn(
        self,
        *,
        before: BattleState,
        belief: OpponentBeliefState,
        decision: BattleDecision,
        after: BattleState,
        opponent_action: str | None,
        actual_damage: int | None,
        status_changes: list[str],
        progress_score: float,
        decision_error: str | None = None,
        opponent_move: MoveState | None = None,
    ) -> BattleTurnRecord:
        if opponent_action:
            self.belief_model.observe_move(belief, opponent_action)
        if (
            actual_damage is not None
            and opponent_move is not None
            and before.active_opponent
            and before.active_player
        ):
            self.belief_model.observe_damage(
                belief,
                opponent=before.active_opponent,
                other=before.active_player,
                move=opponent_move,
                actual_damage=actual_damage,
                opponent_attacking=True,
            )
        selected = next(
            (
                item
                for item in decision.candidates
                if BattleLearningStore.action_key(item.action)
                == BattleLearningStore.action_key(decision.action)
            ),
            None,
        )
        record = BattleTurnRecord(
            battle_id=before.battle_id,
            turn_number=before.turn_number,
            before_state=before,
            opponent_belief=belief,
            candidates=decision.candidates,
            chosen_action=decision.action,
            expected_results=selected.model_dump(mode="json") if selected else {},
            opponent_action=opponent_action,
            actual_damage=actual_damage,
            actual_status_changes=status_changes,
            after_state=after,
            progress_score=progress_score,
            decision_error=decision_error,
        )
        self.store.record_turn(record)
        return record
