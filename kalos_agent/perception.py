from __future__ import annotations

import numpy as np

from .capture import frame_change, frame_hash
from .models import Observation, OCRLine

TITLE_TERMS = ("pokémon x", "pokémon y", "drücke start", "press start")
BATTLE_TERMS = (
    "kp",
    "was soll",
    "kampf",
    "beutel",
    "pokémon",
    "flucht",
    "ist besiegt",
    "setzt",
)
MENU_TERMS = (
    "beutel",
    "bericht",
    "speichern",
    "optionen",
    "pokédex",
    "pokémon",
)


class Perception:
    def __init__(self) -> None:
        self.previous_frame: np.ndarray | None = None
        self.previous_hash: str | None = None
        self.repeated_frame_count = 0

    @staticmethod
    def _state_hint(lines: list[OCRLine], change: float) -> str:
        text = " | ".join(line.text.lower() for line in lines)

        if any(term in text for term in TITLE_TERMS):
            return "title"
        if any(term in text for term in BATTLE_TERMS):
            return "battle"
        if any(term in text for term in MENU_TERMS) and len(lines) >= 2:
            return "menu"
        if len(lines) >= 2:
            return "dialogue"
        if change > 0.18 and not lines:
            return "transition"
        if not lines:
            return "overworld"
        return "unknown"

    def observe(self, frame: np.ndarray, ocr_lines: list[OCRLine]) -> Observation:
        digest = frame_hash(frame)
        change = frame_change(self.previous_frame, frame)

        if digest == self.previous_hash or change < 0.002:
            self.repeated_frame_count += 1
        else:
            self.repeated_frame_count = 0

        hint = self._state_hint(ocr_lines, change)
        observation = Observation.now(
            frame_hash=digest,
            frame_change=change,
            state_hint=hint,
            ocr_lines=ocr_lines,
            repeated_frame_count=self.repeated_frame_count,
        )

        self.previous_frame = frame.copy()
        self.previous_hash = digest
        return observation
