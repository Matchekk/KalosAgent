"""Metrics logging and experiment tracking."""

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class TaskMetrics:
    task_type: str
    target: str
    success: bool
    steps: int
    llm_calls: int
    failure_reason: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class CheckpointMetrics:
    checkpoint_id: int
    name: str
    tasks_attempted: int
    tasks_succeeded: int
    total_steps: int
    total_llm_calls: int
    deaths: int
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())


@dataclass
class RunMetrics:
    run_id: str
    config_hash: str
    started_at: str
    ended_at: Optional[str] = None
    checkpoints_reached: int = 0
    total_steps: int = 0
    total_llm_calls: int = 0
    total_deaths: int = 0
    final_badges: int = 0
    final_party: list = field(default_factory=list)
    success: bool = False


class MetricsLogger:
    """Logs metrics for experiment tracking."""

    def __init__(self, run_dir: Path, config: dict):
        self.run_dir = Path(run_dir)
        self.run_dir.mkdir(parents=True, exist_ok=True)

        self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.config = config
        self.config_hash = self._hash_config(config)

        # Initialize run metrics
        self.run_metrics = RunMetrics(
            run_id=self.run_id,
            config_hash=self.config_hash,
            started_at=datetime.now().isoformat(),
        )

        # Task and checkpoint logs
        self.task_log: list[TaskMetrics] = []
        self.checkpoint_log: list[CheckpointMetrics] = []

        # Save config
        self._save_config()

    def _hash_config(self, config: dict) -> str:
        """Create hash of config for comparison."""
        import hashlib
        config_str = json.dumps(config, sort_keys=True)
        return hashlib.md5(config_str.encode()).hexdigest()[:8]

    def _save_config(self):
        """Save config to run directory."""
        config_path = self.run_dir / f"{self.run_id}_config.json"
        with open(config_path, "w") as f:
            json.dump(self.config, f, indent=2)

    def log_task(
        self,
        task_type: str,
        target: str,
        success: bool,
        steps: int,
        llm_calls: int = 1,
        failure_reason: str = "",
    ):
        """Log a task attempt."""
        metrics = TaskMetrics(
            task_type=task_type,
            target=target,
            success=success,
            steps=steps,
            llm_calls=llm_calls,
            failure_reason=failure_reason,
        )
        self.task_log.append(metrics)

        # Update run totals
        self.run_metrics.total_steps += steps
        self.run_metrics.total_llm_calls += llm_calls

        # Append to task log file
        self._append_to_log("tasks", asdict(metrics))

    def log_checkpoint(
        self,
        checkpoint_id: int,
        name: str,
        tasks_attempted: int,
        tasks_succeeded: int,
        total_steps: int,
        total_llm_calls: int,
        deaths: int,
    ):
        """Log checkpoint completion."""
        metrics = CheckpointMetrics(
            checkpoint_id=checkpoint_id,
            name=name,
            tasks_attempted=tasks_attempted,
            tasks_succeeded=tasks_succeeded,
            total_steps=total_steps,
            total_llm_calls=total_llm_calls,
            deaths=deaths,
        )
        self.checkpoint_log.append(metrics)
        self.run_metrics.checkpoints_reached = checkpoint_id
        self.run_metrics.total_deaths += deaths

        self._append_to_log("checkpoints", asdict(metrics))

    def log_death(self):
        """Log a death/whiteout."""
        self.run_metrics.total_deaths += 1

    def finalize(
        self,
        success: bool,
        final_badges: int,
        final_party: list,
    ):
        """Finalize run and save summary."""
        self.run_metrics.ended_at = datetime.now().isoformat()
        self.run_metrics.success = success
        self.run_metrics.final_badges = final_badges
        self.run_metrics.final_party = final_party

        # Save run summary
        summary_path = self.run_dir / f"{self.run_id}_summary.json"
        with open(summary_path, "w") as f:
            json.dump(asdict(self.run_metrics), f, indent=2)

        print(f"\nRun complete: {self.run_id}")
        print(f"  Checkpoints: {self.run_metrics.checkpoints_reached}")
        print(f"  Steps: {self.run_metrics.total_steps}")
        print(f"  LLM calls: {self.run_metrics.total_llm_calls}")
        print(f"  Deaths: {self.run_metrics.total_deaths}")
        print(f"  Success: {success}")

    def _append_to_log(self, log_name: str, data: dict):
        """Append entry to JSONL log file."""
        log_path = self.run_dir / f"{self.run_id}_{log_name}.jsonl"
        with open(log_path, "a") as f:
            f.write(json.dumps(data) + "\n")

    def get_task_stats(self) -> dict:
        """Get summary statistics for tasks."""
        if not self.task_log:
            return {}

        total = len(self.task_log)
        successes = sum(1 for t in self.task_log if t.success)

        by_type = {}
        for t in self.task_log:
            if t.task_type not in by_type:
                by_type[t.task_type] = {"total": 0, "success": 0, "steps": 0}
            by_type[t.task_type]["total"] += 1
            by_type[t.task_type]["success"] += 1 if t.success else 0
            by_type[t.task_type]["steps"] += t.steps

        return {
            "total_tasks": total,
            "success_rate": successes / total if total > 0 else 0,
            "by_type": by_type,
        }
