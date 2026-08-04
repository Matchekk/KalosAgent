from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class BattleType(StrEnum):
    WILD_SINGLE = "wild_single"
    TRAINER_SINGLE = "trainer_single"
    WILD_DOUBLE = "wild_double"
    TRAINER_DOUBLE = "trainer_double"
    SHOWDOWN_SINGLE = "showdown_single"
    SHOWDOWN_DOUBLE = "showdown_double"


class PokemonType(StrEnum):
    NORMAL = "normal"
    FIRE = "fire"
    WATER = "water"
    ELECTRIC = "electric"
    GRASS = "grass"
    ICE = "ice"
    FIGHTING = "fighting"
    POISON = "poison"
    GROUND = "ground"
    FLYING = "flying"
    PSYCHIC = "psychic"
    BUG = "bug"
    ROCK = "rock"
    GHOST = "ghost"
    DRAGON = "dragon"
    DARK = "dark"
    STEEL = "steel"
    FAIRY = "fairy"


class DamageClass(StrEnum):
    PHYSICAL = "physical"
    SPECIAL = "special"
    STATUS = "status"


class PokemonStatus(StrEnum):
    NONE = "none"
    BURN = "burn"
    FREEZE = "freeze"
    PARALYSIS = "paralysis"
    POISON = "poison"
    BAD_POISON = "bad_poison"
    SLEEP = "sleep"
    FAINTED = "fainted"


class Weather(StrEnum):
    NONE = "none"
    SUN = "sun"
    RAIN = "rain"
    SAND = "sand"
    HAIL = "hail"
    HARSH_SUN = "harsh_sun"
    HEAVY_RAIN = "heavy_rain"
    STRONG_WINDS = "strong_winds"


class Terrain(StrEnum):
    NONE = "none"
    ELECTRIC = "electric"
    GRASSY = "grassy"
    MISTY = "misty"


class StatBlock(BaseModel):
    hp: int = Field(ge=1)
    attack: int = Field(ge=1)
    defense: int = Field(ge=1)
    special_attack: int = Field(ge=1)
    special_defense: int = Field(ge=1)
    speed: int = Field(ge=1)


class StatStages(BaseModel):
    attack: int = Field(default=0, ge=-6, le=6)
    defense: int = Field(default=0, ge=-6, le=6)
    special_attack: int = Field(default=0, ge=-6, le=6)
    special_defense: int = Field(default=0, ge=-6, le=6)
    speed: int = Field(default=0, ge=-6, le=6)
    accuracy: int = Field(default=0, ge=-6, le=6)
    evasion: int = Field(default=0, ge=-6, le=6)


class HPState(BaseModel):
    current: int | None = Field(default=None, ge=0)
    maximum: int | None = Field(default=None, ge=1)
    ratio: float = Field(default=1.0, ge=0.0, le=1.0)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def derive_ratio(self) -> HPState:
        if self.current is not None and self.maximum:
            self.ratio = min(1.0, self.current / self.maximum)
        return self


class MoveState(BaseModel):
    canonical_name: str
    display_name: str | None = None
    type: PokemonType
    damage_class: DamageClass
    power: int | None = Field(default=None, ge=0)
    accuracy: int | None = Field(default=None, ge=0, le=100)
    priority: int = Field(default=0, ge=-7, le=7)
    pp: int = Field(default=0, ge=0)
    max_pp: int = Field(default=0, ge=0)
    min_hits: int | None = Field(default=None, ge=1, le=10)
    max_hits: int | None = Field(default=None, ge=1, le=10)
    drain_percent: int = Field(default=0, ge=-100, le=100)
    healing_percent: int = Field(default=0, ge=0, le=100)
    crit_rate: int = Field(default=0, ge=0, le=4)
    effect_chance: int | None = Field(default=None, ge=0, le=100)
    ailment: str | None = None
    legal: bool = True
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class BattlePokemon(BaseModel):
    canonical_name: str
    display_name: str | None = None
    form: str | None = None
    level: int = Field(default=50, ge=1, le=100)
    types: list[PokemonType] = Field(default_factory=list, min_length=1, max_length=2)
    base_stats: StatBlock | None = None
    estimated_stats: StatBlock | None = None
    ability: str | None = None
    possible_abilities: list[str] = Field(default_factory=list)
    item: str | None = None
    hp: HPState = Field(default_factory=HPState)
    status: PokemonStatus = PokemonStatus.NONE
    stat_stages: StatStages = Field(default_factory=StatStages)
    revealed_moves: list[str] = Field(default_factory=list)
    possible_moves: dict[str, float] = Field(default_factory=dict)
    speed_estimate: tuple[int, int] | None = None
    fainted: bool = False
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class SwitchOption(BaseModel):
    party_index: int = Field(ge=0, le=5)
    pokemon: BattlePokemon
    legal: bool = True
    reason: str = ""


class BattleLogEvent(BaseModel):
    turn: int = Field(ge=0)
    kind: str
    actor: str | None = None
    target: str | None = None
    move: str | None = None
    value: float | str | None = None
    text: str = ""
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class BattleState(BaseModel):
    generation: Literal[6] = 6
    version_group: Literal["x-y"] = "x-y"
    battle_id: str
    battle_type: BattleType = BattleType.WILD_SINGLE
    turn_number: int = Field(default=0, ge=0)
    weather: Weather = Weather.NONE
    terrain: Terrain = Terrain.NONE
    player_active: list[BattlePokemon] = Field(default_factory=list, max_length=2)
    player_party: list[BattlePokemon] = Field(default_factory=list, max_length=6)
    opponent_active: list[BattlePokemon] = Field(default_factory=list, max_length=2)
    opponent_known_party: list[BattlePokemon] = Field(default_factory=list, max_length=6)
    available_moves: list[MoveState] = Field(default_factory=list, max_length=8)
    available_switches: list[SwitchOption] = Field(default_factory=list, max_length=6)
    battle_log: list[BattleLogEvent] = Field(default_factory=list)
    uncertainty: float = Field(default=1.0, ge=0.0, le=1.0)
    source_frame_id: str | None = None
    captured_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @property
    def active_player(self) -> BattlePokemon | None:
        return self.player_active[0] if self.player_active else None

    @property
    def active_opponent(self) -> BattlePokemon | None:
        return self.opponent_active[0] if self.opponent_active else None
