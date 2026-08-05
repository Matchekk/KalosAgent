"""
Deterministic unit-test-style reward evaluator.

Tests are pure functions of (prev_state, curr_state), making rewards
fully deterministic and reproducible.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple
import json

from .state import GameState
from .config import UnitTestRewardsConfig


@dataclass
class RewardBreakdown:
    """Breakdown of reward by tier for logging and analysis."""
    total: float = 0.0
    tier1: float = 0.0
    tier2: float = 0.0
    tier3: float = 0.0
    penalties: float = 0.0


class UnitTestRewarder:
    """Evaluates deterministic unit-test-style rewards."""

    def __init__(self, cfg: UnitTestRewardsConfig):
        self.cfg = cfg
        self.bundles = self._load_bundles(cfg.bundles_path) if cfg.enabled else {}
        # Track "once" tests per episode/run
        self.fired_once: set[str] = set()
        # For optional decay
        self.last_fired_step: dict[str, int] = {}
        self.step_idx: int = 0

    def reset_episode(self):
        """Reset episode-level state (once constraints, decay tracking)."""
        self.fired_once.clear()
        self.last_fired_step.clear()
        self.step_idx = 0

    def _load_bundles(self, path: str) -> dict:
        """Load test bundles from JSON file."""
        p = Path(path)
        # If relative, try resolving from lab directory
        if not p.is_absolute() and not p.exists():
            lab_dir = Path(__file__).parent.parent
            p = lab_dir / path
        if not p.exists():
            # If bundles do not exist yet, return empty default
            return {"default": {"tests": [], "penalties": []}}
        with open(p) as f:
            return json.load(f)

    def _get_bundle(self, prev: GameState, curr: GameState) -> dict:
        """Get appropriate test bundle for current state."""
        # Support per-map bundles or fallback to "default"
        key = str(curr.map_id)
        if key in self.bundles:
            return self.bundles[key]
        return self.bundles.get("default", {"tests": [], "penalties": []})

    def reward(
        self, prev: GameState, curr: GameState
    ) -> Tuple[float, RewardBreakdown, List[str]]:
        """
        Compute reward for state transition.

        Returns:
            total_reward: The total reward value
            breakdown: RewardBreakdown with tier-level details
            fired: List of test IDs that fired
        """
        self.step_idx += 1
        bundle = self._get_bundle(prev, curr)

        breakdown = RewardBreakdown()
        fired: List[str] = []

        # Evaluate positive tests
        for t in bundle.get("tests", []):
            if not self._enabled_for_tier(t.get("tier", 1)):
                continue
            if self._should_skip_once(t):
                continue
            if self._eval_test(t, prev, curr):
                r = self._apply_weights(t)
                r = self._apply_decay(t, r)
                breakdown.total += r
                self._accumulate_tier(breakdown, t.get("tier", 1), r)
                fired.append(t.get("id", "unknown"))
                self._mark_fired(t)

        # Evaluate penalties
        if self.cfg.enable_penalties:
            for t in bundle.get("penalties", []):
                if self._should_skip_once(t):
                    continue
                if self._eval_test(t, prev, curr):
                    r = float(t.get("reward", 0.0)) * self.cfg.penalty_weight
                    r = self._apply_decay(t, r)
                    breakdown.total += r
                    breakdown.penalties += r
                    fired.append(t.get("id", "unknown"))
                    self._mark_fired(t)

        return breakdown.total, breakdown, fired

    def _enabled_for_tier(self, tier: int) -> bool:
        """Check if tier is enabled in config."""
        if tier == 1:
            return self.cfg.enable_tier1
        if tier == 2:
            return self.cfg.enable_tier2
        if tier == 3:
            return self.cfg.enable_tier3
        return True

    def _accumulate_tier(self, b: RewardBreakdown, tier: int, r: float):
        """Add reward to appropriate tier bucket."""
        if tier == 1:
            b.tier1 += r
        elif tier == 2:
            b.tier2 += r
        elif tier == 3:
            b.tier3 += r

    def _apply_weights(self, t: dict) -> float:
        """Apply tier weights to base reward."""
        base = float(t.get("reward", 0.0))
        tier = int(t.get("tier", 1))
        if tier == 1:
            return base * self.cfg.tier1_weight
        if tier == 2:
            return base * self.cfg.tier2_weight
        if tier == 3:
            return base * self.cfg.tier3_weight
        return base

    def _apply_decay(self, t: dict, r: float) -> float:
        """Apply optional decay for repeated rewards."""
        decay = float(self.cfg.reward_decay)
        if decay <= 0:
            return r
        tid = str(t.get("id", ""))
        last = self.last_fired_step.get(tid)
        if last is None:
            return r
        # Decay magnitude with time since last fired
        dt = max(self.step_idx - last, 1)
        return r * (decay ** (1 / dt))

    def _mark_fired(self, t: dict):
        """Mark test as fired for once constraints and decay tracking."""
        tid = str(t.get("id", ""))
        if tid:
            self.last_fired_step[tid] = self.step_idx
        if self.cfg.use_once_constraints and t.get("once", False) and tid:
            self.fired_once.add(tid)

    def _should_skip_once(self, t: dict) -> bool:
        """Check if test should be skipped due to once constraint."""
        if not self.cfg.use_once_constraints:
            return False
        if not t.get("once", False):
            return False
        tid = str(t.get("id", ""))
        return tid in self.fired_once

    def _eval_test(self, t: dict, prev: GameState, curr: GameState) -> bool:
        """Evaluate a single test condition."""
        ttype = t.get("type")

        if ttype == "coords_changed":
            return (prev.player_x != curr.player_x) or (prev.player_y != curr.player_y)

        if ttype == "coords_same":
            return (prev.player_x == curr.player_x) and (prev.player_y == curr.player_y)

        if ttype == "coord_delta":
            axis = t.get("axis")
            direction = t.get("direction")
            if axis == "x":
                dx = curr.player_x - prev.player_x
                return dx > 0 if direction == "positive" else dx < 0
            if axis == "y":
                dy = curr.player_y - prev.player_y
                return dy > 0 if direction == "positive" else dy < 0
            return False

        if ttype == "coord_in_region":
            x, y = curr.player_x, curr.player_y
            return (
                int(t.get("minX", -999)) <= x <= int(t.get("maxX", 999))
                and int(t.get("minY", -999)) <= y <= int(t.get("maxY", 999))
            )

        if ttype == "map_changed":
            return prev.map_id != curr.map_id

        if ttype == "map_is":
            return curr.map_id == int(t.get("target", -1))

        if ttype == "badge_count_increased":
            return curr.badge_count > prev.badge_count

        if ttype == "party_size_increased":
            return len(curr.party) > len(prev.party)

        if ttype == "battle_started":
            return (not prev.in_battle) and curr.in_battle

        if ttype == "battle_ended":
            return prev.in_battle and (not curr.in_battle)

        return False
