"""Policy network for tactical action selection."""

from dataclasses import dataclass
from typing import Optional
import random
import numpy as np

from .state import GameState
from .tasks import Task, TaskType


# Actions available in Pokemon Red
ACTIONS = ["a", "b", "start", "select", "up", "down", "left", "right", "none"]
ACTION_TO_IDX = {a: i for i, a in enumerate(ACTIONS)}
IDX_TO_ACTION = {i: a for i, a in enumerate(ACTIONS)}


@dataclass
class Experience:
    """Single experience tuple for training."""
    state_encoding: np.ndarray
    task_encoding: np.ndarray
    action: int
    reward: float
    next_state_encoding: np.ndarray
    done: bool


class PolicyNetwork:
    """Simple MLP policy network.

    For MVP, this is a basic implementation. Can be swapped for
    more sophisticated architectures later.
    """

    def __init__(
        self,
        state_dim: int = 64,
        task_dim: int = 32,
        hidden_dim: int = 128,
        learning_rate: float = 1e-3,
    ):
        self.state_dim = state_dim
        self.task_dim = task_dim
        self.hidden_dim = hidden_dim
        self.learning_rate = learning_rate
        self.num_actions = len(ACTIONS)

        # Experience buffer
        self.experiences: list[Experience] = []
        self.max_buffer_size = 10000

        # Initialize weights (simple numpy implementation for MVP)
        self._init_weights()

    def _init_weights(self):
        """Initialize network weights."""
        input_dim = self.state_dim + self.task_dim

        # Simple 2-layer MLP
        self.w1 = np.random.randn(input_dim, self.hidden_dim) * 0.1
        self.b1 = np.zeros(self.hidden_dim)
        self.w2 = np.random.randn(self.hidden_dim, self.num_actions) * 0.1
        self.b2 = np.zeros(self.num_actions)

    def encode_state(self, state: GameState) -> np.ndarray:
        """Encode game state into fixed-size vector."""
        encoding = np.zeros(self.state_dim)

        # Location (normalized)
        encoding[0] = state.map_id / 255.0
        encoding[1] = state.player_x / 255.0
        encoding[2] = state.player_y / 255.0

        # Party info (up to 6 Pokemon)
        for i, pokemon in enumerate(state.party[:6]):
            base = 3 + i * 4
            encoding[base] = pokemon.species_id / 255.0
            encoding[base + 1] = pokemon.level / 100.0
            encoding[base + 2] = pokemon.hp_fraction
            encoding[base + 3] = 1.0  # Has Pokemon in slot

        # Progress
        encoding[27] = state.badge_count / 8.0
        encoding[28] = min(state.money / 100000.0, 1.0)
        encoding[29] = 1.0 if state.in_battle else 0.0

        return encoding

    def encode_task(self, task: Optional[Task]) -> np.ndarray:
        """Encode task into fixed-size vector."""
        encoding = np.zeros(self.task_dim)

        if task is None:
            return encoding

        # Task type one-hot
        task_types = ["navigate", "catch", "train", "battle", "buy", "use_item"]
        if task.type.value in task_types:
            encoding[task_types.index(task.type.value)] = 1.0

        # Simple hash of target for now
        target_hash = hash(task.target.lower()) % 1000
        encoding[10] = target_hash / 1000.0

        return encoding

    def select_action(
        self,
        state: GameState,
        task: Optional[Task],
        epsilon: float = 0.1,
    ) -> str:
        """Select action using epsilon-greedy policy."""
        if random.random() < epsilon:
            # Bias exploration toward movement (70% movement, 30% other)
            if random.random() < 0.7:
                return random.choice(["up", "down", "left", "right"])
            else:
                return random.choice(["a", "b", "start", "select", "none"])

        state_enc = self.encode_state(state)
        task_enc = self.encode_task(task)
        x = np.concatenate([state_enc, task_enc])

        # Forward pass
        h = np.maximum(0, x @ self.w1 + self.b1)  # ReLU
        logits = h @ self.w2 + self.b2

        # Softmax
        exp_logits = np.exp(logits - np.max(logits))
        probs = exp_logits / exp_logits.sum()

        # Sample from distribution
        action_idx = np.random.choice(len(ACTIONS), p=probs)
        return IDX_TO_ACTION[action_idx]

    def get_action_probs(self, state: GameState, task: Optional[Task]) -> np.ndarray:
        """Get action probabilities for given state and task."""
        state_enc = self.encode_state(state)
        task_enc = self.encode_task(task)
        x = np.concatenate([state_enc, task_enc])

        h = np.maximum(0, x @ self.w1 + self.b1)
        logits = h @ self.w2 + self.b2

        exp_logits = np.exp(logits - np.max(logits))
        return exp_logits / exp_logits.sum()

    def store_experience(self, exp: Experience):
        """Store experience in buffer."""
        self.experiences.append(exp)
        if len(self.experiences) > self.max_buffer_size:
            self.experiences = self.experiences[-self.max_buffer_size:]

    def train_step(self, batch_size: int = 32) -> float:
        """Perform one training step. Returns loss."""
        if len(self.experiences) < batch_size:
            return 0.0

        # Sample batch
        batch = random.sample(self.experiences, batch_size)

        total_loss = 0.0
        for exp in batch:
            x = np.concatenate([exp.state_encoding, exp.task_encoding])

            # Forward
            h = np.maximum(0, x @ self.w1 + self.b1)
            logits = h @ self.w2 + self.b2
            exp_logits = np.exp(logits - np.max(logits))
            probs = exp_logits / exp_logits.sum()

            # Simple policy gradient update
            advantage = exp.reward
            grad_logits = probs.copy()
            grad_logits[exp.action] -= 1
            grad_logits *= -advantage

            # Backward (simplified)
            grad_w2 = np.outer(h, grad_logits)
            grad_b2 = grad_logits

            grad_h = grad_logits @ self.w2.T
            grad_h[h <= 0] = 0  # ReLU backward

            grad_w1 = np.outer(x, grad_h)
            grad_b1 = grad_h

            # Update weights
            self.w1 -= self.learning_rate * grad_w1
            self.b1 -= self.learning_rate * grad_b1
            self.w2 -= self.learning_rate * grad_w2
            self.b2 -= self.learning_rate * grad_b2

            total_loss += -np.log(probs[exp.action] + 1e-8) * advantage

        return total_loss / batch_size

    def save(self, path: str):
        """Save network weights."""
        np.savez(
            path,
            w1=self.w1,
            b1=self.b1,
            w2=self.w2,
            b2=self.b2,
        )

    def load(self, path: str):
        """Load network weights."""
        data = np.load(path)
        self.w1 = data["w1"]
        self.b1 = data["b1"]
        self.w2 = data["w2"]
        self.b2 = data["b2"]
