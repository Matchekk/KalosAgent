"""Task definitions and completion triggers."""

from dataclasses import dataclass
from enum import Enum
from typing import Optional, Callable
from .state import GameState


class TaskType(Enum):
    NAVIGATE = "navigate"
    CATCH = "catch"
    TRAIN = "train"
    BATTLE = "battle"
    BUY = "buy"
    USE_ITEM = "use_item"


class TaskStatus(Enum):
    PENDING = "pending"
    ACTIVE = "active"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class Task:
    type: TaskType
    target: str  # e.g., "Pewter City", "Pikachu", "level 14"
    reason: str = ""
    budget: int = 1000  # Max steps before considered stuck
    steps_taken: int = 0
    status: TaskStatus = TaskStatus.PENDING

    def to_prompt(self) -> str:
        """Format task for policy network or logging."""
        return f"{self.type.value}: {self.target}"


# Map ID reference for Pokemon Red
# Partial list - add more as needed
class MapIDs:
    PALLET_TOWN = 0x00
    VIRIDIAN_CITY = 0x01
    PEWTER_CITY = 0x02
    CERULEAN_CITY = 0x03
    ROUTE_1 = 0x0C
    ROUTE_2 = 0x0D
    ROUTE_22 = 0x21
    VIRIDIAN_FOREST = 0x33
    PEWTER_GYM = 0x36
    CERULEAN_GYM = 0x41


# Pokemon species IDs (partial)
class SpeciesIDs:
    BULBASAUR = 0x99
    CHARMANDER = 0xB0
    SQUIRTLE = 0xB1
    PIKACHU = 0x54
    NIDORAN_M = 0x03
    NIDORAN_F = 0x0F
    PIDGEY = 0x24
    RATTATA = 0xA5


class TaskChecker:
    """Checks if tasks are completed based on game state."""

    def __init__(self):
        # Map location names to map IDs
        self.location_map = {
            "pallet town": MapIDs.PALLET_TOWN,
            "viridian city": MapIDs.VIRIDIAN_CITY,
            "pewter city": MapIDs.PEWTER_CITY,
            "cerulean city": MapIDs.CERULEAN_CITY,
            "route 1": MapIDs.ROUTE_1,
            "route 2": MapIDs.ROUTE_2,
            "route 22": MapIDs.ROUTE_22,
            "viridian forest": MapIDs.VIRIDIAN_FOREST,
            "pewter gym": MapIDs.PEWTER_GYM,
            "cerulean gym": MapIDs.CERULEAN_GYM,
        }

        # Map Pokemon names to species IDs
        self.species_map = {
            "bulbasaur": SpeciesIDs.BULBASAUR,
            "charmander": SpeciesIDs.CHARMANDER,
            "squirtle": SpeciesIDs.SQUIRTLE,
            "pikachu": SpeciesIDs.PIKACHU,
            "nidoran": SpeciesIDs.NIDORAN_M,  # Default to male
            "nidoran_m": SpeciesIDs.NIDORAN_M,
            "nidoran_f": SpeciesIDs.NIDORAN_F,
            "pidgey": SpeciesIDs.PIDGEY,
            "rattata": SpeciesIDs.RATTATA,
        }

    def is_completed(self, task: Task, state: GameState) -> bool:
        """Check if task is completed given current state."""
        checkers = {
            TaskType.NAVIGATE: self._check_navigate,
            TaskType.CATCH: self._check_catch,
            TaskType.TRAIN: self._check_train,
            TaskType.BATTLE: self._check_battle,
            TaskType.BUY: self._check_buy,
            TaskType.USE_ITEM: self._check_use_item,
        }
        checker = checkers.get(task.type)
        if checker:
            return checker(task, state)
        return False

    def _check_navigate(self, task: Task, state: GameState) -> bool:
        """Check if player reached target location."""
        target = task.target.lower()
        target_map_id = self.location_map.get(target)
        if target_map_id is None:
            return False
        return state.map_id == target_map_id

    def _check_catch(self, task: Task, state: GameState) -> bool:
        """Check if target Pokemon is in party."""
        target = task.target.lower()
        target_species = self.species_map.get(target)
        if target_species is None:
            return False
        return any(p.species_id == target_species for p in state.party)

    def _check_train(self, task: Task, state: GameState) -> bool:
        """Check if any Pokemon reached target level."""
        # Parse "level X" from target
        target = task.target.lower()
        try:
            if "level" in target:
                level = int(target.split("level")[-1].strip())
            else:
                level = int(target)
            return any(p.level >= level for p in state.party)
        except ValueError:
            return False

    def _check_battle(self, task: Task, state: GameState) -> bool:
        """Check if specific gym/trainer defeated (badge check)."""
        target = task.target.lower()
        if "brock" in target or "boulder" in target:
            return state.has_boulder_badge
        if "misty" in target or "cascade" in target:
            return state.has_cascade_badge
        # Generic: not in battle anymore after starting one
        return False

    def _check_buy(self, task: Task, state: GameState) -> bool:
        """Check if item purchased (simplified: any items increased)."""
        # Would need to track previous state for proper check
        # For MVP, just return False and rely on step budget
        return False

    def _check_use_item(self, task: Task, state: GameState) -> bool:
        """Check if item was used (simplified)."""
        return False


def parse_task(response: str) -> Optional[Task]:
    """Parse LLM response into Task object.

    Expected format: TASK: type | target | reason
    """
    try:
        if "TASK:" not in response.upper():
            return None

        # Find the task line
        for line in response.split("\n"):
            if "TASK:" in line.upper():
                parts = line.split(":", 1)[1].strip().split("|")
                if len(parts) >= 2:
                    task_type_str = parts[0].strip().lower()
                    target = parts[1].strip()
                    reason = parts[2].strip() if len(parts) > 2 else ""

                    task_type = TaskType(task_type_str)
                    return Task(type=task_type, target=target, reason=reason)
    except (ValueError, IndexError):
        pass
    return None
