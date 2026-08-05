"""Manage conversation history for bounded context windows."""

from dataclasses import dataclass, field


@dataclass
class Turn:
    """A single turn in the game history."""
    location: str
    reasoning: str
    action: list[str]


@dataclass
class ContextManager:
    """Manages rolling context for local LLMs with limited context windows."""

    max_turns: int = 5
    history: list[Turn] = field(default_factory=list)
    summary: str = ""

    def add_turn(self, location: str, reasoning: str, action: list[str]):
        """Add a new turn to history."""
        self.history.append(Turn(location=location, reasoning=reasoning, action=action))

        # Compress old turns when history gets too long
        if len(self.history) > self.max_turns * 2:
            self._compress()

    def _compress(self):
        """Compress old turns into summary."""
        old_turns = self.history[:-self.max_turns]

        # Build summary from old turns
        locations = list(set(t.location for t in old_turns))
        actions_count = len(old_turns)

        self.summary = f"Previous {actions_count} turns: Visited {', '.join(locations[:5])}"
        if len(locations) > 5:
            self.summary += f" and {len(locations) - 5} other locations"

        # Keep only recent turns
        self.history = self.history[-self.max_turns:]

    def build_context(self) -> str:
        """Build context string for prompt."""
        parts = []

        if self.summary:
            parts.append(f"PREVIOUS PROGRESS:\n{self.summary}\n")

        if self.history:
            parts.append("RECENT ACTIONS:")
            for turn in self.history[-3:]:
                action_str = ", ".join(turn.action)
                parts.append(f"- At {turn.location}: {action_str}")

        return "\n".join(parts)

    def clear(self):
        """Clear all history."""
        self.history = []
        self.summary = ""
