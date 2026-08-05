"""Main harness orchestrating the LLM + Policy Network loop."""

from pathlib import Path
from typing import Optional
import time
import random
import numpy as np

from .emulator import Emulator
from .state import StateReader, GameState
from .tasks import Task, TaskType, TaskStatus, TaskChecker, parse_task
from .llm import Planner, OllamaBackend, OpenAIBackend, LlamaCppBackend, LLMConfig
from .policy import PolicyNetwork, Experience, ACTION_TO_IDX
from .metrics import MetricsLogger
from .config import ExperimentConfig, CHECKPOINTS
from .server import LabServerSync
from .unit_tests import UnitTestRewarder


class Harness:
    """Main experiment harness."""

    def __init__(self, config: ExperimentConfig, enable_server: bool = False):
        self.config = config
        self.total_steps = 0
        self.current_checkpoint = 0
        self.enable_server = enable_server

        # Initialize seeds for reproducibility
        self._init_seeds()

        # Initialize components
        self._init_emulator()

        # In pure_rl mode, LLM is not part of the runtime loop
        if self.config.agent_mode == "hierarchical_llm":
            self._init_llm()
        else:
            self.planner = None

        self._init_policy()
        self._init_metrics()
        self._init_rewarder()

        if enable_server:
            self._init_server()
        else:
            self.server = None

        # Task management
        self.task_checker = TaskChecker()
        self.current_task: Optional[Task] = None
        self.replan_count = 0

    def _init_seeds(self):
        """Initialize random seeds for reproducibility."""
        random.seed(self.config.seed)
        np.random.seed(self.config.seed)

    def _init_rewarder(self):
        """Initialize unit test rewarder."""
        self.unit_rewarder = UnitTestRewarder(self.config.unit_tests)

    def _dummy_task(self) -> Optional[Task]:
        """Get dummy task for pure RL mode."""
        if self.config.policy.ignore_task:
            return None
        # Constant task vector for compatibility
        return Task(type=TaskType.NAVIGATE, target="(pure_rl)", status=TaskStatus.ACTIVE)

    def _init_emulator(self):
        """Initialize emulator and state reader."""
        self.emulator = Emulator(
            rom_path=self.config.emulator.rom_path,
            headless=self.config.emulator.headless,
            speed=self.config.emulator.speed,
        )
        self.state_reader = StateReader(self.emulator)

        # Load save state if specified, otherwise boot through intro
        if self.config.emulator.save_state_path:
            self.emulator.load_state(self.config.emulator.save_state_path)
            # Warm up a few frames for stable RAM reads
            self.emulator.step(60)
        else:
            # Boot through title screen and intro
            self.emulator.boot_to_game(state_reader=self.state_reader)

    def _init_llm(self):
        """Initialize LLM backend and planner."""
        llm_config = LLMConfig(
            model=self.config.llm.model,
            temperature=self.config.llm.temperature,
            max_tokens=self.config.llm.max_tokens,
            base_url=self.config.llm.base_url,
        )

        if self.config.llm.backend == "ollama":
            backend = OllamaBackend(llm_config)
        elif self.config.llm.backend == "openai":
            backend = OpenAIBackend(llm_config, self.config.llm.api_key)
        elif self.config.llm.backend == "llamacpp":
            backend = LlamaCppBackend(llm_config, self.config.llm.model_path)
            # Optionally start server if not running
            if self.config.llm.model_path:
                backend.start_server()
        else:
            raise ValueError(f"Unknown LLM backend: {self.config.llm.backend}")

        self.planner = Planner(backend)

    def _init_policy(self):
        """Initialize policy network."""
        self.policy = PolicyNetwork(
            state_dim=self.config.policy.state_dim,
            task_dim=self.config.policy.task_dim,
            hidden_dim=self.config.policy.hidden_dim,
            learning_rate=self.config.policy.learning_rate,
        )

        if self.config.policy.load_weights:
            self.policy.load(self.config.policy.load_weights)

        self.epsilon = self.config.policy.epsilon_start

    def _init_metrics(self):
        """Initialize metrics logger."""
        runs_dir = Path(self.config.runs_dir)
        self.metrics = MetricsLogger(runs_dir, self.config.to_dict())

    def _init_server(self):
        """Initialize WebSocket server for browser UI."""
        self.server = LabServerSync()
        self.server.start()
        self.server.update_status(
            experiment_name=self.config.name,
            is_running=True,
        )
        print(f"WebSocket server started on ws://localhost:8765")

    def run(self) -> bool:
        """Run the main loop until target or max steps reached."""
        print(f"Starting experiment: {self.config.name}")
        print(f"Mode: {self.config.agent_mode}, Reward: {self.config.reward_mode}")
        print(f"Target: Checkpoint {self.config.target_checkpoint or 'max'}")
        print(f"Max steps: {self.config.max_steps}")
        print()

        try:
            while self.total_steps < self.config.max_steps:
                # Check pause/speed from server
                if self.server:
                    while self.server.should_pause():
                        time.sleep(0.1)

                # Check if we've reached target
                if self._check_target_reached():
                    self._finalize(success=True)
                    return True

                # Get current state
                state = self.state_reader.read()

                # Send frame and state to connected clients (throttled to ~10fps)
                if self.server and self.total_steps % 6 == 0:
                    frame_data = self.emulator.get_screen_png()
                    if frame_data:
                        self.server.send_frame(frame_data)
                    self.server.send_state(state.to_dict())

                # Check for death/whiteout (simplified: check if in Pallet with no badges expected)
                if self._check_death(state):
                    self.metrics.log_death()
                    print("  [DEATH] Whited out!")

                # Execute based on mode
                if self.config.agent_mode == "pure_rl":
                    # Pure RL: policy selects actions every step
                    self._execute_pure_rl_step(state)
                else:
                    # Hierarchical mode (existing behavior)
                    if self.current_task is None or self.current_task.status != TaskStatus.ACTIVE:
                        self._get_next_task(state)

                    if self.current_task:
                        self._execute_task_step(state)

                # Periodic training
                if self.total_steps % self.config.policy.train_every == 0:
                    loss = self.policy.train_step(self.config.policy.batch_size)
                    if loss > 0:
                        print(f"  [TRAIN] Loss: {loss:.4f}")

                # Periodic metrics broadcast
                if self.server and self.total_steps % 10 == 0:
                    self.server.send_metrics({
                        "total_steps": self.total_steps,
                        "epsilon": self.epsilon,
                        "checkpoint": self.current_checkpoint,
                    })

                # Decay epsilon
                self.epsilon = max(
                    self.config.policy.epsilon_end,
                    self.epsilon * self.config.policy.epsilon_decay,
                )

            # Max steps reached
            self._finalize(success=False)
            return False

        except KeyboardInterrupt:
            print("\nInterrupted by user")
            self._finalize(success=False)
            return False

        finally:
            self.emulator.close()

    def _get_next_task(self, state: GameState):
        """Query LLM for next task."""
        objective = self._get_current_objective()
        failure_context = None

        if self.current_task and self.current_task.status == TaskStatus.FAILED:
            failure_context = f"Previous task '{self.current_task.to_prompt()}' failed after {self.current_task.steps_taken} steps"

        print(f"\n[LLM] Requesting task for: {objective}")

        # Notify clients of LLM request
        if self.server:
            prompt_preview = f"State: {state.location}, Party: {len(state.party)} Pokemon"
            self.server.send_llm_request(prompt_preview, objective)

        response = self.planner.get_next_task(state, objective, failure_context)
        print(f"[LLM] Response: {response[:100]}...")

        task = parse_task(response)
        if task:
            task.status = TaskStatus.ACTIVE
            task.budget = self.config.task.default_budget
            self.current_task = task
            self.replan_count = 0
            print(f"[TASK] {task.to_prompt()} (budget: {task.budget})")

            # Notify clients of LLM response and new task
            if self.server:
                self.server.send_llm_response(response, {
                    "type": task.type.value,
                    "target": task.target,
                })
                self.server.send_task_update(
                    task_type=task.type.value,
                    target=task.target,
                    status="active",
                    steps=0,
                    budget=task.budget,
                )
        else:
            print("[WARN] Failed to parse task from LLM response")
            if self.server:
                self.server.send_llm_response(response, None)

    def _execute_task_step(self, state: GameState):
        """Execute one step of the current task."""
        task = self.current_task
        if not task:
            return

        # Check completion
        if self.task_checker.is_completed(task, state):
            task.status = TaskStatus.COMPLETED
            print(f"[OK] Task completed: {task.to_prompt()} ({task.steps_taken} steps)")

            self.planner.record_task_result(task, success=True, steps=task.steps_taken)
            self.metrics.log_task(
                task_type=task.type.value,
                target=task.target,
                success=True,
                steps=task.steps_taken,
            )

            # Notify clients
            if self.server:
                self.server.send_task_update(
                    task_type=task.type.value,
                    target=task.target,
                    status="completed",
                    steps=task.steps_taken,
                    budget=task.budget,
                )

            # Check for checkpoint advancement
            self._check_checkpoint(state)
            return

        # Check budget
        if task.steps_taken >= task.budget:
            task.status = TaskStatus.FAILED
            print(f"[FAIL] Task budget exceeded: {task.to_prompt()}")

            self.planner.record_task_result(
                task,
                success=False,
                steps=task.steps_taken,
                failure_reason="Budget exceeded",
            )
            self.metrics.log_task(
                task_type=task.type.value,
                target=task.target,
                success=False,
                steps=task.steps_taken,
                failure_reason="Budget exceeded",
            )

            # Notify clients
            if self.server:
                self.server.send_task_update(
                    task_type=task.type.value,
                    target=task.target,
                    status="failed",
                    steps=task.steps_taken,
                    budget=task.budget,
                )
            return

        # Get action from policy network
        action = self.policy.select_action(state, task, self.epsilon)

        # Store experience (before action)
        state_enc = self.policy.encode_state(state)
        task_enc = self.policy.encode_task(task)

        # Execute action
        if action != "none":
            self.emulator.press(action)
        else:
            self.emulator.step(12)  # Just advance frames

        # Get new state and compute reward
        new_state = self.state_reader.read()
        reward = self._compute_reward(state, new_state, task)

        # Store experience
        new_state_enc = self.policy.encode_state(new_state)
        exp = Experience(
            state_encoding=state_enc,
            task_encoding=task_enc,
            action=ACTION_TO_IDX[action],
            reward=reward,
            next_state_encoding=new_state_enc,
            done=False,
        )
        self.policy.store_experience(exp)

        task.steps_taken += 1
        self.total_steps += 1

        # Progress indicator
        if self.total_steps % 100 == 0:
            print(f"  Step {self.total_steps}, Task: {task.steps_taken}/{task.budget}")

    def _execute_pure_rl_step(self, state: GameState):
        """
        Pure RL step:
          a ~ pi_theta(.|s)
          env step
          r = unit_tests(prev,curr) (+ optional shaping)
          store exp
        """
        task = self._dummy_task()
        prev_state = state

        # Select action from policy
        action = self.policy.select_action(prev_state, task, self.epsilon)

        # Encode state/task
        state_enc = self.policy.encode_state(prev_state)
        task_enc = self.policy.encode_task(task)

        # Execute action in emulator
        if action != "none":
            self.emulator.press(
                action,
                hold_frames=self.config.emulator.action_hold_frames,
                release_frames=self.config.emulator.action_release_frames,
                frame_skip=self.config.emulator.frame_skip,
            )
        else:
            self.emulator.step(self.config.emulator.frame_skip or 4)

        # Read new state
        new_state = self.state_reader.read()

        # Compute reward based on mode
        reward = 0.0
        breakdown = None
        fired = []

        if self.config.reward_mode in ("unit_tests", "mixed"):
            r_ut, breakdown, fired = self.unit_rewarder.reward(prev_state, new_state)
            reward += r_ut

        if self.config.reward_mode in ("shaping", "mixed"):
            # Reuse existing shaping reward with dummy task
            dummy = task or Task(type=TaskType.NAVIGATE, target="(pure_rl)")
            reward += self._compute_reward(prev_state, new_state, dummy)

        # Store experience
        new_state_enc = self.policy.encode_state(new_state)
        exp = Experience(
            state_encoding=state_enc,
            task_encoding=task_enc,
            action=ACTION_TO_IDX[action],
            reward=reward,
            next_state_encoding=new_state_enc,
            done=False,
        )
        self.policy.store_experience(exp)

        self.total_steps += 1

        # Broadcast to WebSocket clients (throttled to reduce overhead)
        if self.server and self.total_steps % 5 == 0:
            # Send frame every 5 steps
            frame_data = self.emulator.get_screen_png()
            if frame_data:
                self.server.send_frame(frame_data)
            # Send game state
            self.server.send_state(new_state.to_dict())
            # Send RL-specific step data
            rl_data = {
                "step": self.total_steps,
                "action": action,
                "reward": reward,
                "epsilon": self.epsilon,
                "tier1": breakdown.tier1 if breakdown else 0.0,
                "tier2": breakdown.tier2 if breakdown else 0.0,
                "tier3": breakdown.tier3 if breakdown else 0.0,
                "penalties": breakdown.penalties if breakdown else 0.0,
                "fired_tests": fired,
            }
            self.server.send_rl_step(rl_data)

        # Progress indicator with reward breakdown
        if self.total_steps % 250 == 0:
            if breakdown is not None:
                print(
                    f"  [RL] step={self.total_steps} r={reward:.3f} "
                    f"tier1={breakdown.tier1:.2f} tier2={breakdown.tier2:.2f} "
                    f"tier3={breakdown.tier3:.2f} pen={breakdown.penalties:.2f}"
                )
            else:
                print(f"  [RL] step={self.total_steps} r={reward:.3f}")

    def _compute_reward(
        self,
        prev_state: GameState,
        new_state: GameState,
        task: Task,
    ) -> float:
        """Compute reward for transition."""
        reward = 0.0

        # Small negative reward for each step (encourages efficiency)
        reward -= 0.01

        # Reward for task-relevant progress
        if task.type == TaskType.NAVIGATE:
            # Could add distance-based reward here
            pass
        elif task.type == TaskType.TRAIN:
            # Reward for level ups
            prev_max_level = max((p.level for p in prev_state.party), default=0)
            new_max_level = max((p.level for p in new_state.party), default=0)
            if new_max_level > prev_max_level:
                reward += 1.0
        elif task.type == TaskType.BATTLE:
            # Reward for winning battles
            if prev_state.in_battle and not new_state.in_battle:
                reward += 0.5
            # Reward for dealing damage
            if prev_state.enemy_hp and new_state.enemy_hp:
                damage = prev_state.enemy_hp - new_state.enemy_hp
                if damage > 0:
                    reward += 0.1

        # Big reward for badges
        if new_state.badge_count > prev_state.badge_count:
            reward += 10.0

        return reward

    def _check_checkpoint(self, state: GameState):
        """Check if we've reached a new checkpoint."""
        for cp in CHECKPOINTS:
            if cp["id"] > self.current_checkpoint:
                if state.badge_count >= cp["badge_required"]:
                    # Simplified check - real implementation would check more conditions
                    if cp["badge_required"] > 0 and state.badge_count >= cp["badge_required"]:
                        self.current_checkpoint = cp["id"]
                        print(f"\n[CHECKPOINT] Reached: {cp['name']}")

                        self.metrics.log_checkpoint(
                            checkpoint_id=cp["id"],
                            name=cp["name"],
                            tasks_attempted=len(self.metrics.task_log),
                            tasks_succeeded=sum(1 for t in self.metrics.task_log if t.success),
                            total_steps=self.total_steps,
                            total_llm_calls=self.metrics.run_metrics.total_llm_calls,
                            deaths=self.metrics.run_metrics.total_deaths,
                        )

                        # Notify clients
                        if self.server:
                            self.server.send_checkpoint(cp["id"], cp["name"])

                        # Save checkpoint state
                        if self.config.save_checkpoints:
                            self._save_checkpoint_state(cp["id"])
                        break

    def _check_target_reached(self) -> bool:
        """Check if target checkpoint reached."""
        if self.config.target_checkpoint == 0:
            return False  # No target, run until max steps
        return self.current_checkpoint >= self.config.target_checkpoint

    def _check_death(self, state: GameState) -> bool:
        """Check if player whited out (simplified)."""
        # Could check for Pokemon Center respawn, all Pokemon fainted, etc.
        return False

    def _get_current_objective(self) -> str:
        """Get objective string for current checkpoint."""
        for cp in CHECKPOINTS:
            if cp["id"] > self.current_checkpoint:
                return cp["name"]
        return "Complete the game"

    def _save_checkpoint_state(self, checkpoint_id: int):
        """Save emulator state at checkpoint."""
        path = Path(self.config.runs_dir) / f"{self.metrics.run_id}_cp{checkpoint_id}.state"
        self.emulator.save_state(path)
        print(f"  Saved state: {path}")

    def _finalize(self, success: bool):
        """Finalize the run."""
        state = self.state_reader.read()

        # Update total steps in metrics (especially important for pure RL mode)
        self.metrics.run_metrics.total_steps = self.total_steps

        self.metrics.finalize(
            success=success,
            final_badges=state.badge_count,
            final_party=[
                {"species": p.species_id, "level": p.level}
                for p in state.party
            ],
        )

        # Notify clients and stop server
        if self.server:
            self.server.update_status(is_running=False)
            self.server.stop()

        # Save final policy weights
        weights_path = Path(self.config.runs_dir) / f"{self.metrics.run_id}_policy.npz"
        self.policy.save(str(weights_path))
        print(f"Saved policy weights: {weights_path}")
