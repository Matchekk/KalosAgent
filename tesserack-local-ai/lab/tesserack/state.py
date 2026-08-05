"""Game state extraction from Pokemon Red memory."""

from dataclasses import dataclass, field
from typing import Optional
from .emulator import Emulator


# Memory addresses for Pokemon Red (US)
# Reference: https://datacrystal.romhacking.net/wiki/Pok%C3%A9mon_Red/Blue:RAM_map
class Addresses:
    # Player location
    MAP_ID = 0xD35E
    PLAYER_X = 0xD362
    PLAYER_Y = 0xD361

    # Party
    PARTY_COUNT = 0xD163
    PARTY_START = 0xD164  # 6 Pokemon, 44 bytes each

    # Individual Pokemon offsets (from start of Pokemon data)
    SPECIES = 0x00
    CURRENT_HP = 0x01  # 2 bytes, big endian
    LEVEL = 0x21
    MAX_HP = 0x22  # 2 bytes

    # Badges
    BADGES = 0xD356

    # Money (BCD encoded, 3 bytes)
    MONEY = 0xD347

    # Items
    ITEM_COUNT = 0xD31D
    ITEM_START = 0xD31E  # item_id, quantity pairs

    # Battle state
    IN_BATTLE = 0xD057
    ENEMY_HP = 0xCFE6  # 2 bytes


@dataclass
class Pokemon:
    species_id: int
    level: int
    current_hp: int
    max_hp: int

    @property
    def hp_fraction(self) -> float:
        return self.current_hp / self.max_hp if self.max_hp > 0 else 0


@dataclass
class GameState:
    # Location
    map_id: int
    player_x: int
    player_y: int

    # Party
    party: list[Pokemon] = field(default_factory=list)

    # Progress
    badges: int = 0  # Bitfield: 8 badges

    # Resources
    money: int = 0
    items: dict[int, int] = field(default_factory=dict)  # item_id -> count

    # Battle
    in_battle: bool = False
    enemy_hp: Optional[int] = None

    @property
    def badge_count(self) -> int:
        return bin(self.badges).count("1")

    @property
    def has_boulder_badge(self) -> bool:
        return bool(self.badges & 0x01)

    @property
    def has_cascade_badge(self) -> bool:
        return bool(self.badges & 0x02)

    def party_summary(self) -> str:
        if not self.party:
            return "No Pokemon"
        return ", ".join(
            f"#{p.species_id} Lv{p.level} ({p.current_hp}/{p.max_hp})"
            for p in self.party
        )

    @property
    def location(self) -> str:
        """Human-readable location string."""
        return f"Map {self.map_id} ({self.player_x}, {self.player_y})"

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "map_id": self.map_id,
            "player_x": self.player_x,
            "player_y": self.player_y,
            "location": self.location,
            "party": [
                {
                    "species_id": p.species_id,
                    "level": p.level,
                    "current_hp": p.current_hp,
                    "max_hp": p.max_hp,
                }
                for p in self.party
            ],
            "badges": self.badges,
            "badge_count": self.badge_count,
            "money": self.money,
            "in_battle": self.in_battle,
            "enemy_hp": self.enemy_hp,
        }


class StateReader:
    """Reads game state from emulator memory."""

    def __init__(self, emulator: Emulator):
        self.emu = emulator

    def read(self) -> GameState:
        """Read full game state from memory."""
        return GameState(
            map_id=self._read_map_id(),
            player_x=self._read_player_x(),
            player_y=self._read_player_y(),
            party=self._read_party(),
            badges=self._read_badges(),
            money=self._read_money(),
            items=self._read_items(),
            in_battle=self._read_in_battle(),
            enemy_hp=self._read_enemy_hp(),
        )

    def _read_map_id(self) -> int:
        return self.emu.read_memory(Addresses.MAP_ID)

    def _read_player_x(self) -> int:
        return self.emu.read_memory(Addresses.PLAYER_X)

    def _read_player_y(self) -> int:
        return self.emu.read_memory(Addresses.PLAYER_Y)

    def _read_badges(self) -> int:
        return self.emu.read_memory(Addresses.BADGES)

    def _read_money(self) -> int:
        # BCD encoded, 3 bytes
        raw = self.emu.read_memory_range(Addresses.MONEY, 3)
        return int(raw.hex())

    def _read_in_battle(self) -> bool:
        return self.emu.read_memory(Addresses.IN_BATTLE) != 0

    def _read_enemy_hp(self) -> Optional[int]:
        if not self._read_in_battle():
            return None
        hp_bytes = self.emu.read_memory_range(Addresses.ENEMY_HP, 2)
        return int.from_bytes(hp_bytes, "big")

    def _read_party(self) -> list[Pokemon]:
        count = self.emu.read_memory(Addresses.PARTY_COUNT)
        party = []
        for i in range(min(count, 6)):
            pokemon = self._read_pokemon(i)
            if pokemon:
                party.append(pokemon)
        return party

    def _read_pokemon(self, slot: int) -> Optional[Pokemon]:
        """Read Pokemon data from party slot (0-5)."""
        base = Addresses.PARTY_START + (slot * 44)

        species = self.emu.read_memory(base + Addresses.SPECIES)
        if species == 0:
            return None

        level = self.emu.read_memory(base + Addresses.LEVEL)
        current_hp = int.from_bytes(
            self.emu.read_memory_range(base + Addresses.CURRENT_HP, 2), "big"
        )
        max_hp = int.from_bytes(
            self.emu.read_memory_range(base + Addresses.MAX_HP, 2), "big"
        )

        return Pokemon(
            species_id=species,
            level=level,
            current_hp=current_hp,
            max_hp=max_hp,
        )

    def _read_items(self) -> dict[int, int]:
        count = self.emu.read_memory(Addresses.ITEM_COUNT)
        items = {}
        for i in range(min(count, 20)):
            addr = Addresses.ITEM_START + (i * 2)
            item_id = self.emu.read_memory(addr)
            quantity = self.emu.read_memory(addr + 1)
            if item_id != 0xFF:  # End of list marker
                items[item_id] = quantity
        return items
