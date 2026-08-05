"""Main game agent that orchestrates LLM and emulator."""

import asyncio
import time
from pathlib import Path
from typing import Callable

from agent.emulator import Emulator
from agent.context_manager import ContextManager
from agent.action_parser import parse_response
from llm.base import LLMBackend


SYSTEM_PROMPT = """You are an AI playing Pokemon Red. Goal: become Pokemon Champion.

Given the game state, output your next 10 button presses.

RULES:
- Valid buttons: up, down, left, right, a, b, start, select
- Press 'a' to talk, confirm, or advance dialog
- Press 'b' to cancel or go back
- Use directions to move on the map
- In battle: select moves with up/down, confirm with 'a'

OUTPUT FORMAT (follow exactly):
PLAN: <brief 1-line goal>
ACTIONS: button1, button2, button3, button4, button5, button6, button7, button8, button9, button10

Example:
PLAN: Walk right to exit room and talk to NPC
ACTIONS: right, right, right, up, up, a, a, a, a, a

Now analyze and respond:"""


class GameAgent:
    """Orchestrates the LLM playing Pokemon Red."""

    def __init__(
        self,
        llm: LLMBackend,
        emulator: Emulator,
        max_history: int = 5,
        autosave_path: str | None = None,
        autosave_interval: int = 30,
    ):
        self.llm = llm
        self.emulator = emulator
        self.context = ContextManager(max_turns=max_history)
        self.running = False
        self.callbacks: list[Callable] = []
        self.autosave_path = autosave_path
        self.autosave_interval = autosave_interval
        self.step_count = 0

    def add_callback(self, callback: Callable):
        """Add a callback for state updates."""
        self.callbacks.append(callback)

    def autosave(self):
        """Save game state if autosave is configured."""
        if not self.autosave_path:
            return

        # Ensure directory exists
        save_path = Path(self.autosave_path)
        save_path.parent.mkdir(parents=True, exist_ok=True)

        self.emulator.save_state(str(save_path))
        print(f"Autosaved to {save_path}")

    def load_autosave(self) -> bool:
        """Load autosave if it exists. Returns True if loaded."""
        if not self.autosave_path:
            return False

        save_path = Path(self.autosave_path)
        if save_path.exists():
            self.emulator.load_state(str(save_path))
            print(f"Loaded autosave from {save_path}")
            return True
        return False

    def _build_prompt(self, state: dict, collision_map: str | None) -> str:
        """Build the full prompt for the LLM."""
        parts = [SYSTEM_PROMPT, ""]

        # Add context from previous turns
        context = self.context.build_context()
        if context:
            parts.append(context)
            parts.append("")

        # Current state
        parts.append("CURRENT GAME STATE:")
        parts.append(f"Location: {state['location']}")
        parts.append(f"Coordinates: {state['coordinates']}")
        parts.append(f"Money: ${state['money']}")
        parts.append(f"Badges: {', '.join(state['badges']) if state['badges'] else 'None'}")

        # Party
        parts.append("\nPOKEMON PARTY:")
        for pokemon in state['party']:
            parts.append(f"  {pokemon}")

        # Items (abbreviated)
        if state['items']:
            items_str = ", ".join(f"{name} x{qty}" for name, qty in state['items'][:10])
            parts.append(f"\nITEMS: {items_str}")

        # Valid moves
        valid_moves = self.emulator.get_valid_moves()
        parts.append(f"\nVALID MOVES: {', '.join(valid_moves)}")

        # Collision map
        if collision_map:
            parts.append(f"\nMAP (# = wall, . = walkable, ^v<> = you):\n{collision_map}")

        # Dialog
        if state['dialog'].strip():
            parts.append(f"\nDIALOG: {state['dialog']}")

        parts.append("\nPLAN:")

        return "\n".join(parts)

    async def step(self) -> dict:
        """Execute one agent step: observe -> think -> act."""
        t0 = time.time()

        # 1. Get current state
        state = self.emulator.get_state()
        collision_map = self.emulator.get_collision_map()
        screenshot = self.emulator.get_screenshot_base64()
        t1 = time.time()

        # 2. Build prompt
        prompt = self._build_prompt(state, collision_map)
        t2 = time.time()

        # 3. Get LLM response
        response = self.llm.generate(prompt, max_tokens=256)
        t3 = time.time()

        print(f"[Timing] State: {t1-t0:.2f}s, Prompt: {t2-t1:.2f}s, LLM: {t3-t2:.2f}s")

        # 4. Parse response
        reasoning, actions = parse_response(response)

        # 5. Execute actions
        self.emulator.press_buttons(actions)

        # 6. Update context
        self.context.add_turn(
            location=state['location'],
            reasoning=reasoning,
            action=actions,
        )

        # 7. Build update for callbacks
        update = {
            "screenshot": screenshot,
            "state": state,
            "reasoning": reasoning,
            "action": actions,
            "raw_response": response,
        }

        # 8. Notify callbacks
        for callback in self.callbacks:
            if asyncio.iscoroutinefunction(callback):
                await callback(update)
            else:
                callback(update)

        # 9. Autosave periodically
        self.step_count += 1
        if self.autosave_path and self.step_count % self.autosave_interval == 0:
            self.autosave()

        return update

    async def run(self, steps: int | None = None, delay: float = 0.5):
        """Run the agent loop.

        Args:
            steps: Number of steps to run (None = infinite)
            delay: Delay between steps in seconds
        """
        self.running = True
        count = 0

        while self.running:
            if steps is not None and count >= steps:
                break

            await self.step()
            count += 1

            if delay > 0:
                await asyncio.sleep(delay)

    def stop(self):
        """Stop the agent loop."""
        self.running = False
