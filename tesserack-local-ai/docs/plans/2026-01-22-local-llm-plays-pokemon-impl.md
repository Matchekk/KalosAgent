# LocalLLMPlaysPokemon Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an autonomous Pokemon Red player using local LLMs with a web UI for live viewing.

**Architecture:** PyBoy emulator extracts game state from memory, formats it into a ReAct-style prompt for a local LLM (via llama-cpp-python), parses the LLM's action output, and executes button presses. A FastAPI web server streams updates via WebSocket.

**Tech Stack:** Python 3.11+, PyBoy, llama-cpp-python, FastAPI, uvicorn, Pillow

---

## Task 1: Project Setup

**Files:**
- Create: `requirements.txt`
- Create: `config.py`
- Create: `.gitignore`

**Step 1: Create requirements.txt**

```txt
pyboy==2.2.0
llama-cpp-python>=0.2.0
fastapi>=0.100.0
uvicorn>=0.23.0
websockets>=11.0
Pillow>=10.0.0
numpy>=1.24.0
```

**Step 2: Create config.py**

```python
from pathlib import Path

# Paths
MODEL_PATH = "/Users/sidmohan/Library/Application Support/ai.threadfork.app/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
ROM_PATH = "pokemon.gb"

# LLM settings
CONTEXT_SIZE = 4096
MAX_TOKENS = 512
N_GPU_LAYERS = -1  # -1 = use all layers on GPU (Metal)

# Agent settings
MAX_HISTORY_TURNS = 5

# Web server
WEB_HOST = "0.0.0.0"
WEB_PORT = 8000
```

**Step 3: Create .gitignore**

```
__pycache__/
*.pyc
*.pyo
.env
*.gb
*.gbc
*.sav
*.state
models/*.gguf
.DS_Store
```

**Step 4: Commit**

```bash
git add requirements.txt config.py .gitignore
git commit -m "chore: project setup with dependencies and config"
```

---

## Task 2: Memory Reader - Core Enums

**Files:**
- Create: `agent/__init__.py`
- Create: `agent/memory_reader.py`

**Step 1: Create agent package**

```python
# agent/__init__.py
```

**Step 2: Create memory_reader.py with enums**

```python
"""Pokemon Red memory reader for extracting game state."""

from dataclasses import dataclass
from enum import IntEnum, IntFlag


class StatusCondition(IntFlag):
    """Pokemon status conditions stored as bit flags."""
    NONE = 0
    SLEEP_MASK = 0b111
    POISON = 0b1000
    BURN = 0b10000
    FREEZE = 0b100000
    PARALYSIS = 0b1000000

    @property
    def is_asleep(self) -> bool:
        return bool(int(self) & 0b111)

    def get_name(self) -> str:
        if self.is_asleep:
            return "SLEEP"
        if self & StatusCondition.PARALYSIS:
            return "PARALYSIS"
        if self & StatusCondition.FREEZE:
            return "FREEZE"
        if self & StatusCondition.BURN:
            return "BURN"
        if self & StatusCondition.POISON:
            return "POISON"
        return "OK"


class PokemonType(IntEnum):
    """Pokemon types with their memory IDs."""
    NORMAL = 0x00
    FIGHTING = 0x01
    FLYING = 0x02
    POISON = 0x03
    GROUND = 0x04
    ROCK = 0x05
    BUG = 0x07
    GHOST = 0x08
    FIRE = 0x14
    WATER = 0x15
    GRASS = 0x16
    ELECTRIC = 0x17
    PSYCHIC = 0x18
    ICE = 0x19
    DRAGON = 0x1A


class Pokemon(IntEnum):
    """Pokemon species IDs."""
    BULBASAUR = 0x99
    IVYSAUR = 0x09
    VENUSAUR = 0x9A
    CHARMANDER = 0xB0
    CHARMELEON = 0xB2
    CHARIZARD = 0xB4
    SQUIRTLE = 0xB1
    WARTORTLE = 0xB3
    BLASTOISE = 0x1C
    CATERPIE = 0x7B
    METAPOD = 0x7C
    BUTTERFREE = 0x7D
    WEEDLE = 0x70
    KAKUNA = 0x71
    BEEDRILL = 0x72
    PIDGEY = 0x24
    PIDGEOTTO = 0x96
    PIDGEOT = 0x97
    RATTATA = 0xA5
    RATICATE = 0xA6
    SPEAROW = 0x05
    FEAROW = 0x23
    EKANS = 0x6C
    ARBOK = 0x2D
    PIKACHU = 0x54
    RAICHU = 0x55
    SANDSHREW = 0x60
    SANDSLASH = 0x61
    NIDORAN_F = 0x0F
    NIDORINA = 0xA8
    NIDOQUEEN = 0x10
    NIDORAN_M = 0x03
    NIDORINO = 0xA7
    NIDOKING = 0x07
    CLEFAIRY = 0x04
    CLEFABLE = 0x8E
    VULPIX = 0x52
    NINETALES = 0x53
    JIGGLYPUFF = 0x64
    WIGGLYTUFF = 0x65
    ZUBAT = 0x6B
    GOLBAT = 0x82
    ODDISH = 0xB9
    GLOOM = 0xBA
    VILEPLUME = 0xBB
    PARAS = 0x6D
    PARASECT = 0x2E
    VENONAT = 0x41
    VENOMOTH = 0x77
    DIGLETT = 0x3B
    DUGTRIO = 0x76
    MEOWTH = 0x4D
    PERSIAN = 0x90
    PSYDUCK = 0x2F
    GOLDUCK = 0x80
    MANKEY = 0x39
    PRIMEAPE = 0x75
    GROWLITHE = 0x21
    ARCANINE = 0x14
    POLIWAG = 0x47
    POLIWHIRL = 0x6E
    POLIWRATH = 0x6F
    ABRA = 0x94
    KADABRA = 0x26
    ALAKAZAM = 0x95
    MACHOP = 0x6A
    MACHOKE = 0x29
    MACHAMP = 0x7E
    BELLSPROUT = 0xBC
    WEEPINBELL = 0xBD
    VICTREEBEL = 0xBE
    TENTACOOL = 0x18
    TENTACRUEL = 0x9B
    GEODUDE = 0xA9
    GRAVELER = 0x27
    GOLEM = 0x31
    PONYTA = 0xA3
    RAPIDASH = 0xA4
    SLOWPOKE = 0x25
    SLOWBRO = 0x08
    MAGNEMITE = 0xAD
    MAGNETON = 0x36
    FARFETCHD = 0x40
    DODUO = 0x46
    DODRIO = 0x74
    SEEL = 0x3A
    DEWGONG = 0x78
    GRIMER = 0x0D
    MUK = 0x88
    SHELLDER = 0x17
    CLOYSTER = 0x8B
    GASTLY = 0x19
    HAUNTER = 0x93
    GENGAR = 0x0E
    ONIX = 0x22
    DROWZEE = 0x30
    HYPNO = 0x81
    KRABBY = 0x4E
    KINGLER = 0x8A
    VOLTORB = 0x06
    ELECTRODE = 0x8D
    EXEGGCUTE = 0x0C
    EXEGGUTOR = 0x0A
    CUBONE = 0x11
    MAROWAK = 0x91
    HITMONLEE = 0x2B
    HITMONCHAN = 0x2C
    LICKITUNG = 0x0B
    KOFFING = 0x37
    WEEZING = 0x8F
    RHYHORN = 0x12
    RHYDON = 0x01
    CHANSEY = 0x28
    TANGELA = 0x1E
    KANGASKHAN = 0x02
    HORSEA = 0x5C
    SEADRA = 0x5D
    GOLDEEN = 0x9D
    SEAKING = 0x9E
    STARYU = 0x1B
    STARMIE = 0x98
    MR_MIME = 0x2A
    SCYTHER = 0x1A
    JYNX = 0x48
    ELECTABUZZ = 0x35
    MAGMAR = 0x33
    PINSIR = 0x1D
    TAUROS = 0x3C
    MAGIKARP = 0x85
    GYARADOS = 0x16
    LAPRAS = 0x13
    DITTO = 0x4C
    EEVEE = 0x66
    VAPOREON = 0x69
    JOLTEON = 0x68
    FLAREON = 0x67
    PORYGON = 0xAA
    OMANYTE = 0x62
    OMASTAR = 0x63
    KABUTO = 0x5A
    KABUTOPS = 0x5B
    AERODACTYL = 0xAB
    SNORLAX = 0x84
    ARTICUNO = 0x4A
    ZAPDOS = 0x4B
    MOLTRES = 0x49
    DRATINI = 0x58
    DRAGONAIR = 0x59
    DRAGONITE = 0x42
    MEWTWO = 0x83
    MEW = 0x15


class Move(IntEnum):
    """Pokemon move IDs."""
    POUND = 0x01
    KARATE_CHOP = 0x02
    DOUBLESLAP = 0x03
    COMET_PUNCH = 0x04
    MEGA_PUNCH = 0x05
    PAY_DAY = 0x06
    FIRE_PUNCH = 0x07
    ICE_PUNCH = 0x08
    THUNDERPUNCH = 0x09
    SCRATCH = 0x0A
    VICEGRIP = 0x0B
    GUILLOTINE = 0x0C
    RAZOR_WIND = 0x0D
    SWORDS_DANCE = 0x0E
    CUT = 0x0F
    GUST = 0x10
    WING_ATTACK = 0x11
    WHIRLWIND = 0x12
    FLY = 0x13
    BIND = 0x14
    SLAM = 0x15
    VINE_WHIP = 0x16
    STOMP = 0x17
    DOUBLE_KICK = 0x18
    MEGA_KICK = 0x19
    JUMP_KICK = 0x1A
    ROLLING_KICK = 0x1B
    SAND_ATTACK = 0x1C
    HEADBUTT = 0x1D
    HORN_ATTACK = 0x1E
    FURY_ATTACK = 0x1F
    HORN_DRILL = 0x20
    TACKLE = 0x21
    BODY_SLAM = 0x22
    WRAP = 0x23
    TAKE_DOWN = 0x24
    THRASH = 0x25
    DOUBLE_EDGE = 0x26
    TAIL_WHIP = 0x27
    POISON_STING = 0x28
    TWINEEDLE = 0x29
    PIN_MISSILE = 0x2A
    LEER = 0x2B
    BITE = 0x2C
    GROWL = 0x2D
    ROAR = 0x2E
    SING = 0x2F
    SUPERSONIC = 0x30
    SONICBOOM = 0x31
    DISABLE = 0x32
    ACID = 0x33
    EMBER = 0x34
    FLAMETHROWER = 0x35
    MIST = 0x36
    WATER_GUN = 0x37
    HYDRO_PUMP = 0x38
    SURF = 0x39
    ICE_BEAM = 0x3A
    BLIZZARD = 0x3B
    PSYBEAM = 0x3C
    BUBBLEBEAM = 0x3D
    AURORA_BEAM = 0x3E
    HYPER_BEAM = 0x3F
    PECK = 0x40
    DRILL_PECK = 0x41
    SUBMISSION = 0x42
    LOW_KICK = 0x43
    COUNTER = 0x44
    SEISMIC_TOSS = 0x45
    STRENGTH = 0x46
    ABSORB = 0x47
    MEGA_DRAIN = 0x48
    LEECH_SEED = 0x49
    GROWTH = 0x4A
    RAZOR_LEAF = 0x4B
    SOLARBEAM = 0x4C
    POISONPOWDER = 0x4D
    STUN_SPORE = 0x4E
    SLEEP_POWDER = 0x4F
    PETAL_DANCE = 0x50
    STRING_SHOT = 0x51
    DRAGON_RAGE = 0x52
    FIRE_SPIN = 0x53
    THUNDERSHOCK = 0x54
    THUNDERBOLT = 0x55
    THUNDER_WAVE = 0x56
    THUNDER = 0x57
    ROCK_THROW = 0x58
    EARTHQUAKE = 0x59
    FISSURE = 0x5A
    DIG = 0x5B
    TOXIC = 0x5C
    CONFUSION = 0x5D
    PSYCHIC = 0x5E
    HYPNOSIS = 0x5F
    MEDITATE = 0x60
    AGILITY = 0x61
    QUICK_ATTACK = 0x62
    RAGE = 0x63
    TELEPORT = 0x64
    NIGHT_SHADE = 0x65
    MIMIC = 0x66
    SCREECH = 0x67
    DOUBLE_TEAM = 0x68
    RECOVER = 0x69
    HARDEN = 0x6A
    MINIMIZE = 0x6B
    SMOKESCREEN = 0x6C
    CONFUSE_RAY = 0x6D
    WITHDRAW = 0x6E
    DEFENSE_CURL = 0x6F
    BARRIER = 0x70
    LIGHT_SCREEN = 0x71
    HAZE = 0x72
    REFLECT = 0x73
    FOCUS_ENERGY = 0x74
    BIDE = 0x75
    METRONOME = 0x76
    MIRROR_MOVE = 0x77
    SELFDESTRUCT = 0x78
    EGG_BOMB = 0x79
    LICK = 0x7A
    SMOG = 0x7B
    SLUDGE = 0x7C
    BONE_CLUB = 0x7D
    FIRE_BLAST = 0x7E
    WATERFALL = 0x7F
    CLAMP = 0x80
    SWIFT = 0x81
    SKULL_BASH = 0x82
    SPIKE_CANNON = 0x83
    CONSTRICT = 0x84
    AMNESIA = 0x85
    KINESIS = 0x86
    SOFTBOILED = 0x87
    HI_JUMP_KICK = 0x88
    GLARE = 0x89
    DREAM_EATER = 0x8A
    POISON_GAS = 0x8B
    BARRAGE = 0x8C
    LEECH_LIFE = 0x8D
    LOVELY_KISS = 0x8E
    SKY_ATTACK = 0x8F
    TRANSFORM = 0x90
    BUBBLE = 0x91
    DIZZY_PUNCH = 0x92
    SPORE = 0x93
    FLASH = 0x94
    PSYWAVE = 0x95
    SPLASH = 0x96
    ACID_ARMOR = 0x97
    CRABHAMMER = 0x98
    EXPLOSION = 0x99
    FURY_SWIPES = 0x9A
    BONEMERANG = 0x9B
    REST = 0x9C
    ROCK_SLIDE = 0x9D
    HYPER_FANG = 0x9E
    SHARPEN = 0x9F
    CONVERSION = 0xA0
    TRI_ATTACK = 0xA1
    SUPER_FANG = 0xA2
    SLASH = 0xA3
    SUBSTITUTE = 0xA4
    STRUGGLE = 0xA5


class MapLocation(IntEnum):
    """Map location IDs."""
    PALLET_TOWN = 0x00
    VIRIDIAN_CITY = 0x01
    PEWTER_CITY = 0x02
    CERULEAN_CITY = 0x03
    LAVENDER_TOWN = 0x04
    VERMILION_CITY = 0x05
    CELADON_CITY = 0x06
    FUCHSIA_CITY = 0x07
    CINNABAR_ISLAND = 0x08
    INDIGO_PLATEAU = 0x09
    SAFFRON_CITY = 0x0A
    ROUTE_1 = 0x0C
    ROUTE_2 = 0x0D
    ROUTE_3 = 0x0E
    ROUTE_4 = 0x0F
    ROUTE_5 = 0x10
    ROUTE_6 = 0x11
    ROUTE_7 = 0x12
    ROUTE_8 = 0x13
    ROUTE_9 = 0x14
    ROUTE_10 = 0x15
    ROUTE_11 = 0x16
    ROUTE_12 = 0x17
    ROUTE_13 = 0x18
    ROUTE_14 = 0x19
    ROUTE_15 = 0x1A
    ROUTE_16 = 0x1B
    ROUTE_17 = 0x1C
    ROUTE_18 = 0x1D
    ROUTE_19 = 0x1E
    ROUTE_20 = 0x1F
    ROUTE_21 = 0x20
    ROUTE_22 = 0x21
    ROUTE_23 = 0x22
    ROUTE_24 = 0x23
    ROUTE_25 = 0x24
    PLAYERS_HOUSE_1F = 0x25
    PLAYERS_HOUSE_2F = 0x26
    RIVALS_HOUSE = 0x27
    OAKS_LAB = 0x28
    VIRIDIAN_POKECENTER = 0x29
    VIRIDIAN_MART = 0x2A
    VIRIDIAN_GYM = 0x2D
    VIRIDIAN_FOREST = 0x33
    PEWTER_GYM = 0x36
    PEWTER_POKECENTER = 0x3A
    MT_MOON_1F = 0x3B
    MT_MOON_B1F = 0x3C
    MT_MOON_B2F = 0x3D
    CERULEAN_POKECENTER = 0x40
    CERULEAN_GYM = 0x41
    VERMILION_POKECENTER = 0x59
    VERMILION_GYM = 0x5C
    SS_ANNE_1F = 0x5F
    ROCK_TUNNEL_1F = 0x52
    POWER_PLANT = 0x53
    POKEMON_TOWER_1F = 0x8E
    CELADON_POKECENTER = 0x85
    CELADON_GYM = 0x86
    GAME_CORNER = 0x87
    SAFFRON_GYM = 0xB2
    SILPH_CO_1F = 0xB5
    FUCHSIA_POKECENTER = 0x9A
    FUCHSIA_GYM = 0x9D
    SAFARI_ZONE_ENTRANCE = 0x9C
    CINNABAR_GYM = 0xA6
    CINNABAR_POKECENTER = 0xAB
    VICTORY_ROAD_1F = 0x6C
    INDIGO_PLATEAU_LOBBY = 0xAE
    LORELEI = 0xF5
    BRUNO = 0xF6
    AGATHA = 0xF7
    LANCE = 0x71
    CHAMPIONS_ROOM = 0x78
    HALL_OF_FAME = 0x76


class Badge(IntFlag):
    """Gym badge flags."""
    BOULDER = 1 << 0
    CASCADE = 1 << 1
    THUNDER = 1 << 2
    RAINBOW = 1 << 3
    SOUL = 1 << 4
    MARSH = 1 << 5
    VOLCANO = 1 << 6
    EARTH = 1 << 7


# Item name mapping
ITEM_NAMES = {
    0x01: "MASTER BALL", 0x02: "ULTRA BALL", 0x03: "GREAT BALL", 0x04: "POKé BALL",
    0x05: "TOWN MAP", 0x06: "BICYCLE", 0x08: "SAFARI BALL", 0x09: "POKéDEX",
    0x0A: "MOON STONE", 0x0B: "ANTIDOTE", 0x0C: "BURN HEAL", 0x0D: "ICE HEAL",
    0x0E: "AWAKENING", 0x0F: "PARLYZ HEAL", 0x10: "FULL RESTORE", 0x11: "MAX POTION",
    0x12: "HYPER POTION", 0x13: "SUPER POTION", 0x14: "POTION", 0x1D: "ESCAPE ROPE",
    0x1E: "REPEL", 0x1F: "OLD AMBER", 0x20: "FIRE STONE", 0x21: "THUNDERSTONE",
    0x22: "WATER STONE", 0x23: "HP UP", 0x24: "PROTEIN", 0x25: "IRON",
    0x26: "CARBOS", 0x27: "CALCIUM", 0x28: "RARE CANDY", 0x29: "DOME FOSSIL",
    0x2A: "HELIX FOSSIL", 0x2B: "SECRET KEY", 0x2D: "BIKE VOUCHER", 0x2E: "X ACCURACY",
    0x2F: "LEAF STONE", 0x30: "CARD KEY", 0x31: "NUGGET", 0x32: "PP UP",
    0x33: "POKé DOLL", 0x34: "FULL HEAL", 0x35: "REVIVE", 0x36: "MAX REVIVE",
    0x37: "GUARD SPEC", 0x38: "SUPER REPEL", 0x39: "MAX REPEL", 0x3A: "DIRE HIT",
    0x3C: "FRESH WATER", 0x3D: "SODA POP", 0x3E: "LEMONADE", 0x3F: "S.S. TICKET",
    0x40: "GOLD TEETH", 0x41: "X ATTACK", 0x42: "X DEFEND", 0x43: "X SPEED",
    0x44: "X SPECIAL", 0x45: "COIN CASE", 0x46: "OAK'S PARCEL", 0x47: "ITEMFINDER",
    0x48: "SILPH SCOPE", 0x49: "POKé FLUTE", 0x4A: "LIFT KEY", 0x4B: "EXP.ALL",
    0x4C: "OLD ROD", 0x4D: "GOOD ROD", 0x4E: "SUPER ROD", 0x50: "ETHER",
    0x51: "MAX ETHER", 0x52: "ELIXER", 0x53: "MAX ELIXER",
}


@dataclass
class PokemonData:
    """Pokemon data structure."""
    species_id: int
    species_name: str
    nickname: str
    level: int
    current_hp: int
    max_hp: int
    status: StatusCondition
    type1: PokemonType
    type2: PokemonType | None
    moves: list[str]
    move_pp: list[int]
```

**Step 3: Commit**

```bash
git add agent/
git commit -m "feat: add memory reader enums and data structures"
```

---

## Task 3: Memory Reader - PokemonRedReader Class

**Files:**
- Modify: `agent/memory_reader.py`

**Step 1: Add PokemonRedReader class**

Append to `agent/memory_reader.py`:

```python
class PokemonRedReader:
    """Reads game state from Pokemon Red memory."""

    def __init__(self, memory):
        self.memory = memory

    def _convert_text(self, data: bytes | list[int]) -> str:
        """Convert Pokemon text encoding to ASCII."""
        result = []
        for b in data:
            if b == 0x50:  # End marker
                break
            elif b == 0x7F:  # Space
                result.append(" ")
            elif 0x80 <= b <= 0x99:  # A-Z
                result.append(chr(b - 0x80 + ord("A")))
            elif 0xA0 <= b <= 0xB9:  # a-z
                result.append(chr(b - 0xA0 + ord("a")))
            elif 0xF6 <= b <= 0xFF:  # 0-9
                result.append(str(b - 0xF6))
            elif b == 0xE8:  # Period
                result.append(".")
            elif b == 0xE3:  # Dash
                result.append("-")
            elif b == 0xE7:  # !
                result.append("!")
            elif b == 0xE6:  # ?
                result.append("?")
            elif b == 0xF4:  # ,
                result.append(",")
            elif b == 0xBA:  # é
                result.append("e")
        return "".join(result).strip()

    def read_player_name(self) -> str:
        return self._convert_text(self.memory[0xD158:0xD163])

    def read_rival_name(self) -> str:
        return self._convert_text(self.memory[0xD34A:0xD351])

    def read_money(self) -> int:
        """Read money in BCD format."""
        b1 = self.memory[0xD349]
        b2 = self.memory[0xD348]
        b3 = self.memory[0xD347]
        return (
            ((b3 >> 4) * 100000) + ((b3 & 0xF) * 10000) +
            ((b2 >> 4) * 1000) + ((b2 & 0xF) * 100) +
            ((b1 >> 4) * 10) + (b1 & 0xF)
        )

    def read_badges(self) -> list[str]:
        badge_byte = self.memory[0xD356]
        badges = []
        for badge in Badge:
            if badge_byte & badge:
                badges.append(badge.name)
        return badges

    def read_location(self) -> str:
        map_id = self.memory[0xD35E]
        try:
            return MapLocation(map_id).name.replace("_", " ")
        except ValueError:
            return f"UNKNOWN ({map_id})"

    def read_coordinates(self) -> tuple[int, int]:
        return (self.memory[0xD362], self.memory[0xD361])

    def read_party_pokemon(self) -> list[PokemonData]:
        """Read all Pokemon in party."""
        party = []
        party_size = self.memory[0xD163]

        base_addrs = [0xD16B, 0xD197, 0xD1C3, 0xD1EF, 0xD21B, 0xD247]
        nick_addrs = [0xD2B5, 0xD2C0, 0xD2CB, 0xD2D6, 0xD2E1, 0xD2EC]

        for i in range(min(party_size, 6)):
            addr = base_addrs[i]
            species_id = self.memory[addr]

            try:
                species_name = Pokemon(species_id).name.replace("_", " ")
            except ValueError:
                continue

            # Read moves
            moves = []
            move_pp = []
            for j in range(4):
                move_id = self.memory[addr + 8 + j]
                if move_id != 0:
                    try:
                        moves.append(Move(move_id).name.replace("_", " "))
                        move_pp.append(self.memory[addr + 0x1D + j])
                    except ValueError:
                        pass

            type1 = PokemonType(self.memory[addr + 5])
            type2_raw = self.memory[addr + 6]
            type2 = PokemonType(type2_raw) if type2_raw != type1 else None

            pokemon = PokemonData(
                species_id=species_id,
                species_name=species_name,
                nickname=self._convert_text(self.memory[nick_addrs[i]:nick_addrs[i] + 11]),
                level=self.memory[addr + 0x21],
                current_hp=(self.memory[addr + 1] << 8) + self.memory[addr + 2],
                max_hp=(self.memory[addr + 0x22] << 8) + self.memory[addr + 0x23],
                status=StatusCondition(self.memory[addr + 4]),
                type1=type1,
                type2=type2,
                moves=moves,
                move_pp=move_pp,
            )
            party.append(pokemon)

        return party

    def read_items(self) -> list[tuple[str, int]]:
        """Read inventory items."""
        items = []
        count = self.memory[0xD31D]

        for i in range(count):
            item_id = self.memory[0xD31E + (i * 2)]
            quantity = self.memory[0xD31F + (i * 2)]

            if 0xC9 <= item_id <= 0xFE:
                name = f"TM{item_id - 0xC8:02d}"
            elif 0xC4 <= item_id <= 0xC8:
                name = f"HM{item_id - 0xC3:02d}"
            else:
                name = ITEM_NAMES.get(item_id, f"ITEM_{item_id:02X}")

            items.append((name, quantity))

        return items

    def read_dialog(self) -> str:
        """Read dialog text from screen buffer."""
        buffer = [self.memory[addr] for addr in range(0xC3A0, 0xC507)]

        text_chars = []
        for b in buffer:
            if 0x80 <= b <= 0x99 or 0xA0 <= b <= 0xB9 or 0xF6 <= b <= 0xFF:
                text_chars.append(b)
            elif b == 0x7F:
                text_chars.append(b)
            elif b in (0xE6, 0xE7, 0xE8, 0xF4):
                text_chars.append(b)

        return self._convert_text(text_chars)
```

**Step 2: Commit**

```bash
git add agent/memory_reader.py
git commit -m "feat: add PokemonRedReader class for memory extraction"
```

---

## Task 4: Emulator Wrapper

**Files:**
- Create: `agent/emulator.py`

**Step 1: Create emulator.py**

```python
"""PyBoy emulator wrapper for Pokemon Red."""

import base64
import io

from PIL import Image
from pyboy import PyBoy

from agent.memory_reader import PokemonRedReader


class Emulator:
    """Wrapper around PyBoy for Pokemon Red."""

    VALID_BUTTONS = {"a", "b", "start", "select", "up", "down", "left", "right"}

    def __init__(self, rom_path: str, headless: bool = True, sound: bool = False):
        window = "null" if headless else "SDL2"
        self.pyboy = PyBoy(rom_path, window=window, sound=sound, cgb=True)
        self.reader = None

    def initialize(self):
        """Run emulator for a bit to ensure it's ready."""
        self.pyboy.set_emulation_speed(0)
        for _ in range(60):
            for _ in range(60):
                self.pyboy.tick()
        self.pyboy.set_emulation_speed(1)
        self._update_reader()

    def _update_reader(self):
        """Update memory reader reference."""
        self.reader = PokemonRedReader(self.pyboy.memory)

    def tick(self, frames: int = 1):
        """Advance emulator by frames."""
        for _ in range(frames):
            self.pyboy.tick()

    def press_button(self, button: str, hold_frames: int = 10, wait_frames: int = 20):
        """Press a single button."""
        if button not in self.VALID_BUTTONS:
            return False
        self.pyboy.button_press(button)
        self.tick(hold_frames)
        self.pyboy.button_release(button)
        self.tick(wait_frames)
        return True

    def press_buttons(self, buttons: list[str]) -> list[str]:
        """Press a sequence of buttons."""
        results = []
        for button in buttons:
            if self.press_button(button):
                results.append(f"Pressed {button}")
            else:
                results.append(f"Invalid button: {button}")
        return results

    def get_screenshot(self) -> Image.Image:
        """Get current screen as PIL Image."""
        return Image.fromarray(self.pyboy.screen.ndarray)

    def get_screenshot_base64(self) -> str:
        """Get screenshot as base64 string."""
        img = self.get_screenshot()
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode()

    def get_state(self) -> dict:
        """Get complete game state from memory."""
        self._update_reader()

        party = self.reader.read_party_pokemon()
        party_summary = []
        for p in party:
            types = p.type1.name
            if p.type2:
                types += f"/{p.type2.name}"
            party_summary.append(
                f"{p.nickname} ({p.species_name}) Lv.{p.level} "
                f"HP:{p.current_hp}/{p.max_hp} [{types}]"
            )

        return {
            "player_name": self.reader.read_player_name(),
            "rival_name": self.reader.read_rival_name(),
            "money": self.reader.read_money(),
            "location": self.reader.read_location(),
            "coordinates": self.reader.read_coordinates(),
            "badges": self.reader.read_badges(),
            "party": party_summary,
            "party_pokemon": party,
            "items": self.reader.read_items(),
            "dialog": self.reader.read_dialog(),
        }

    def get_collision_map(self) -> str | None:
        """Get ASCII collision map showing player position."""
        try:
            collision = self.pyboy.game_wrapper.game_area_collision()

            # Downsample 18x20 to 9x10
            terrain = collision.reshape(9, 2, 10, 2).mean(axis=(1, 3))

            # Get player direction
            full_map = self.pyboy.game_wrapper.game_area()
            direction = self._get_direction(full_map)

            dir_chars = {"up": "^", "down": "v", "left": "<", "right": ">"}
            player_char = dir_chars.get(direction, "P")

            lines = ["+----------+"]
            for i in range(9):
                row = "|"
                for j in range(10):
                    if i == 4 and j == 4:
                        row += player_char
                    elif terrain[i][j] == 0:
                        row += "#"  # Wall
                    else:
                        row += "."  # Walkable
                row += "|"
                lines.append(row)
            lines.append("+----------+")

            return "\n".join(lines)
        except Exception:
            return None

    def _get_direction(self, array) -> str:
        """Determine player facing direction from sprite pattern."""
        rows, cols = array.shape
        for i in range(rows - 1):
            for j in range(cols - 1):
                grid = list(array[i:i+2, j:j+2].flatten())
                if grid == [0, 1, 2, 3]:
                    return "down"
                elif grid == [4, 5, 6, 7]:
                    return "up"
                elif grid == [9, 8, 11, 10]:
                    return "right"
                elif grid == [8, 9, 10, 11]:
                    return "left"
        return "down"

    def get_valid_moves(self) -> list[str]:
        """Get list of valid movement directions."""
        try:
            collision = self.pyboy.game_wrapper.game_area_collision()
            terrain = collision.reshape(9, 2, 10, 2).mean(axis=(1, 3))

            moves = []
            if terrain[3][4] != 0:
                moves.append("up")
            if terrain[5][4] != 0:
                moves.append("down")
            if terrain[4][3] != 0:
                moves.append("left")
            if terrain[4][5] != 0:
                moves.append("right")
            return moves
        except Exception:
            return ["up", "down", "left", "right"]

    def load_state(self, path: str):
        """Load emulator state from file."""
        with open(path, "rb") as f:
            self.pyboy.load_state(f)
        self._update_reader()

    def save_state(self, path: str):
        """Save emulator state to file."""
        with open(path, "wb") as f:
            self.pyboy.save_state(f)

    def stop(self):
        """Stop the emulator."""
        self.pyboy.stop()
```

**Step 2: Commit**

```bash
git add agent/emulator.py
git commit -m "feat: add PyBoy emulator wrapper"
```

---

## Task 5: LLM Backend Abstraction

**Files:**
- Create: `llm/__init__.py`
- Create: `llm/base.py`

**Step 1: Create llm package**

```python
# llm/__init__.py
from llm.base import LLMBackend
```

**Step 2: Create base.py**

```python
"""Abstract base class for LLM backends."""

from abc import ABC, abstractmethod


class LLMBackend(ABC):
    """Abstract interface for LLM backends."""

    @abstractmethod
    def generate(self, prompt: str, max_tokens: int = 512) -> str:
        """Generate a response from the LLM.

        Args:
            prompt: The input prompt
            max_tokens: Maximum tokens to generate

        Returns:
            The generated text response
        """
        pass

    @abstractmethod
    def get_model_info(self) -> dict:
        """Get information about the loaded model.

        Returns:
            Dict with model name, context size, etc.
        """
        pass
```

**Step 3: Commit**

```bash
git add llm/
git commit -m "feat: add LLM backend abstraction"
```

---

## Task 6: llama-cpp-python Backend

**Files:**
- Create: `llm/llama_cpp_backend.py`
- Modify: `llm/__init__.py`

**Step 1: Create llama_cpp_backend.py**

```python
"""llama-cpp-python backend implementation."""

from llama_cpp import Llama

from llm.base import LLMBackend


class LlamaCppBackend(LLMBackend):
    """LLM backend using llama-cpp-python."""

    def __init__(
        self,
        model_path: str,
        n_ctx: int = 4096,
        n_gpu_layers: int = -1,
        verbose: bool = False,
    ):
        """Initialize the llama.cpp backend.

        Args:
            model_path: Path to the .gguf model file
            n_ctx: Context window size
            n_gpu_layers: Number of layers to offload to GPU (-1 = all)
            verbose: Whether to print llama.cpp logs
        """
        self.model_path = model_path
        self.n_ctx = n_ctx

        self.llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,
            verbose=verbose,
        )

    def generate(self, prompt: str, max_tokens: int = 512) -> str:
        """Generate a response from the model."""
        output = self.llm(
            prompt,
            max_tokens=max_tokens,
            stop=["ACTION:", "\n\nREASONING:"],
            echo=False,
        )
        return output["choices"][0]["text"]

    def get_model_info(self) -> dict:
        """Get model information."""
        return {
            "backend": "llama-cpp-python",
            "model_path": self.model_path,
            "context_size": self.n_ctx,
        }
```

**Step 2: Update llm/__init__.py**

```python
# llm/__init__.py
from llm.base import LLMBackend
from llm.llama_cpp_backend import LlamaCppBackend
```

**Step 3: Commit**

```bash
git add llm/
git commit -m "feat: add llama-cpp-python backend implementation"
```

---

## Task 7: Action Parser

**Files:**
- Create: `agent/action_parser.py`

**Step 1: Create action_parser.py**

```python
"""Parse LLM responses into game actions."""

import re


VALID_BUTTONS = {"a", "b", "start", "select", "up", "down", "left", "right"}


def parse_response(response: str) -> tuple[str, list[str]]:
    """Parse LLM response into reasoning and actions.

    Args:
        response: Raw LLM output

    Returns:
        Tuple of (reasoning, list of button names)
    """
    # Extract reasoning (everything before ACTION:)
    reasoning = response.strip()
    actions = []

    # Look for ACTION: line
    match = re.search(r'ACTION:\s*(.+?)(?:\n|$)', response, re.IGNORECASE)
    if match:
        action_str = match.group(1)
        # Split reasoning from action
        action_start = response.lower().find("action:")
        if action_start > 0:
            reasoning = response[:action_start].strip()

        # Parse button sequence
        buttons = re.split(r'[,\s]+', action_str.lower())
        actions = [b.strip() for b in buttons if b.strip() in VALID_BUTTONS]

    # Default to pressing 'a' if no valid actions found
    if not actions:
        actions = ["a"]

    return reasoning, actions
```

**Step 2: Commit**

```bash
git add agent/action_parser.py
git commit -m "feat: add ReAct response parser"
```

---

## Task 8: Context Manager

**Files:**
- Create: `agent/context_manager.py`

**Step 1: Create context_manager.py**

```python
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
```

**Step 2: Commit**

```bash
git add agent/context_manager.py
git commit -m "feat: add context manager for bounded history"
```

---

## Task 9: Game Agent

**Files:**
- Create: `agent/game_agent.py`
- Update: `agent/__init__.py`

**Step 1: Create game_agent.py**

```python
"""Main game agent that orchestrates LLM and emulator."""

import asyncio
from typing import Callable

from agent.emulator import Emulator
from agent.context_manager import ContextManager
from agent.action_parser import parse_response
from llm.base import LLMBackend


SYSTEM_PROMPT = """You are playing Pokemon Red. Your goal is to become the Pokemon Champion by defeating the Elite Four.

Analyze the current game state and decide what to do next. Think step by step about:
1. Where you are and what's happening
2. What your immediate goal should be
3. What buttons to press to achieve that goal

Format your response EXACTLY as:
REASONING: <your step-by-step thinking>
ACTION: <button sequence>

Valid buttons: a, b, start, select, up, down, left, right
Separate multiple buttons with commas.
Example: ACTION: up, up, left, a

REASONING:"""


class GameAgent:
    """Orchestrates the LLM playing Pokemon Red."""

    def __init__(
        self,
        llm: LLMBackend,
        emulator: Emulator,
        max_history: int = 5,
    ):
        self.llm = llm
        self.emulator = emulator
        self.context = ContextManager(max_turns=max_history)
        self.running = False
        self.callbacks: list[Callable] = []

    def add_callback(self, callback: Callable):
        """Add a callback for state updates."""
        self.callbacks.append(callback)

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

        parts.append("\nREASONING:")

        return "\n".join(parts)

    async def step(self) -> dict:
        """Execute one agent step: observe -> think -> act."""
        # 1. Get current state
        state = self.emulator.get_state()
        collision_map = self.emulator.get_collision_map()
        screenshot = self.emulator.get_screenshot_base64()

        # 2. Build prompt
        prompt = self._build_prompt(state, collision_map)

        # 3. Get LLM response
        response = self.llm.generate(prompt, max_tokens=512)

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
```

**Step 2: Update agent/__init__.py**

```python
# agent/__init__.py
from agent.emulator import Emulator
from agent.game_agent import GameAgent
from agent.context_manager import ContextManager
from agent.action_parser import parse_response
```

**Step 3: Commit**

```bash
git add agent/
git commit -m "feat: add main game agent with ReAct loop"
```

---

## Task 10: Web Server

**Files:**
- Create: `web/__init__.py`
- Create: `web/server.py`

**Step 1: Create web package**

```python
# web/__init__.py
```

**Step 2: Create server.py**

```python
"""FastAPI web server with WebSocket for live updates."""

import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from agent import Emulator, GameAgent
from llm import LlamaCppBackend
import config


app = FastAPI(title="LocalLLMPlaysPokemon")

# Global state
agent: GameAgent | None = None
connected_clients: list[WebSocket] = []


async def broadcast(data: dict):
    """Send update to all connected WebSocket clients."""
    message = json.dumps(data, default=str)
    disconnected = []
    for client in connected_clients:
        try:
            await client.send_text(message)
        except Exception:
            disconnected.append(client)
    for client in disconnected:
        connected_clients.remove(client)


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main page."""
    html_path = Path(__file__).parent / "static" / "index.html"
    if html_path.exists():
        return html_path.read_text()
    return """
    <!DOCTYPE html>
    <html>
    <head><title>LocalLLMPlaysPokemon</title></head>
    <body>
        <h1>LocalLLMPlaysPokemon</h1>
        <p>Static files not found. Run from project root.</p>
    </body>
    </html>
    """


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for live updates."""
    await websocket.accept()
    connected_clients.append(websocket)

    try:
        while True:
            # Keep connection alive, handle any incoming messages
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "start":
                await start_agent(msg.get("rom_path", config.ROM_PATH))
            elif msg.get("type") == "stop":
                stop_agent()
            elif msg.get("type") == "step":
                if agent:
                    await agent.step()
    except WebSocketDisconnect:
        connected_clients.remove(websocket)


async def start_agent(rom_path: str):
    """Initialize and start the agent."""
    global agent

    if agent is not None:
        return

    # Initialize LLM
    llm = LlamaCppBackend(
        model_path=config.MODEL_PATH,
        n_ctx=config.CONTEXT_SIZE,
        n_gpu_layers=config.N_GPU_LAYERS,
    )

    # Initialize emulator
    emulator = Emulator(rom_path, headless=True)
    emulator.initialize()

    # Create agent
    agent = GameAgent(llm, emulator, max_history=config.MAX_HISTORY_TURNS)
    agent.add_callback(broadcast)

    # Start running in background
    asyncio.create_task(agent.run(delay=1.0))

    await broadcast({"type": "started", "message": "Agent started"})


def stop_agent():
    """Stop the running agent."""
    global agent
    if agent:
        agent.stop()
        agent.emulator.stop()
        agent = None


# Mount static files
static_path = Path(__file__).parent / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")
```

**Step 3: Commit**

```bash
git add web/
git commit -m "feat: add FastAPI web server with WebSocket"
```

---

## Task 11: Web UI Static Files

**Files:**
- Create: `web/static/index.html`
- Create: `web/static/style.css`
- Create: `web/static/app.js`

**Step 1: Create index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LocalLLMPlaysPokemon</title>
    <link rel="stylesheet" href="/static/style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>LocalLLMPlaysPokemon</h1>
            <div class="controls">
                <button id="startBtn">Start</button>
                <button id="stopBtn" disabled>Stop</button>
                <button id="stepBtn" disabled>Step</button>
            </div>
        </header>

        <main>
            <div class="game-panel">
                <h2>Game Screen</h2>
                <canvas id="gameCanvas" width="160" height="144"></canvas>
            </div>

            <div class="state-panel">
                <h2>Game State</h2>
                <div id="gameState">
                    <p>Waiting to start...</p>
                </div>
            </div>

            <div class="reasoning-panel">
                <h2>LLM Reasoning</h2>
                <div id="reasoning">
                    <p>Waiting for agent...</p>
                </div>
                <div class="action">
                    <strong>Action:</strong> <span id="action">-</span>
                </div>
            </div>
        </main>
    </div>

    <script src="/static/app.js"></script>
</body>
</html>
```

**Step 2: Create style.css**

```css
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: 'Courier New', monospace;
    background: #1a1a2e;
    color: #eee;
    min-height: 100vh;
}

.container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 20px;
}

header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
    padding-bottom: 20px;
    border-bottom: 2px solid #333;
}

h1 {
    color: #ff6b6b;
}

.controls button {
    padding: 10px 20px;
    margin-left: 10px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-family: inherit;
    font-size: 14px;
}

.controls button:not(:disabled) {
    background: #4ecdc4;
    color: #1a1a2e;
}

.controls button:disabled {
    background: #333;
    color: #666;
    cursor: not-allowed;
}

main {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto auto;
    gap: 20px;
}

.game-panel, .state-panel, .reasoning-panel {
    background: #16213e;
    border-radius: 10px;
    padding: 20px;
}

.game-panel {
    grid-row: span 2;
}

h2 {
    color: #4ecdc4;
    margin-bottom: 15px;
    font-size: 16px;
}

#gameCanvas {
    width: 100%;
    max-width: 320px;
    height: auto;
    image-rendering: pixelated;
    background: #000;
    border: 2px solid #333;
}

#gameState {
    font-size: 13px;
    line-height: 1.6;
}

#gameState p {
    margin-bottom: 5px;
}

.reasoning-panel {
    grid-column: span 1;
}

#reasoning {
    background: #0f0f1a;
    padding: 15px;
    border-radius: 5px;
    max-height: 200px;
    overflow-y: auto;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre-wrap;
}

.action {
    margin-top: 15px;
    padding: 10px;
    background: #ff6b6b;
    color: #1a1a2e;
    border-radius: 5px;
}
```

**Step 3: Create app.js**

```javascript
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const gameState = document.getElementById('gameState');
const reasoning = document.getElementById('reasoning');
const action = document.getElementById('action');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const stepBtn = document.getElementById('stepBtn');

let ws = null;
let running = false;

function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
        console.log('Connected to server');
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        handleMessage(data);
    };

    ws.onclose = () => {
        console.log('Disconnected from server');
        setTimeout(connect, 2000);
    };
}

function handleMessage(data) {
    if (data.type === 'started') {
        running = true;
        updateButtons();
        return;
    }

    // Update screenshot
    if (data.screenshot) {
        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = 'data:image/png;base64,' + data.screenshot;
    }

    // Update game state
    if (data.state) {
        const s = data.state;
        gameState.innerHTML = `
            <p><strong>Location:</strong> ${s.location}</p>
            <p><strong>Coordinates:</strong> (${s.coordinates[0]}, ${s.coordinates[1]})</p>
            <p><strong>Money:</strong> $${s.money}</p>
            <p><strong>Badges:</strong> ${s.badges.length > 0 ? s.badges.join(', ') : 'None'}</p>
            <p><strong>Party:</strong></p>
            ${s.party.map(p => `<p style="margin-left:10px">${p}</p>`).join('')}
        `;
    }

    // Update reasoning
    if (data.reasoning) {
        reasoning.textContent = data.reasoning;
    }

    // Update action
    if (data.action) {
        action.textContent = data.action.join(', ');
    }
}

function updateButtons() {
    startBtn.disabled = running;
    stopBtn.disabled = !running;
    stepBtn.disabled = !running;
}

startBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'start' }));
    }
};

stopBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'stop' }));
        running = false;
        updateButtons();
    }
};

stepBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'step' }));
    }
};

// Connect on page load
connect();
```

**Step 4: Commit**

```bash
git add web/static/
git commit -m "feat: add web UI with live game display"
```

---

## Task 12: Main Entry Point

**Files:**
- Create: `main.py`

**Step 1: Create main.py**

```python
"""Main entry point for LocalLLMPlaysPokemon."""

import argparse
import asyncio

import uvicorn

import config
from agent import Emulator, GameAgent
from llm import LlamaCppBackend


def run_headless(args):
    """Run agent in headless mode."""
    print(f"Loading model from {args.model}...")
    llm = LlamaCppBackend(
        model_path=args.model,
        n_ctx=config.CONTEXT_SIZE,
        n_gpu_layers=config.N_GPU_LAYERS,
        verbose=args.verbose,
    )

    print(f"Loading ROM from {args.rom}...")
    emulator = Emulator(args.rom, headless=not args.display)
    emulator.initialize()

    if args.load_state:
        print(f"Loading state from {args.load_state}...")
        emulator.load_state(args.load_state)

    print("Creating agent...")
    agent = GameAgent(llm, emulator, max_history=args.max_history)

    def print_update(update):
        print(f"\n{'='*50}")
        print(f"Location: {update['state']['location']}")
        print(f"Reasoning: {update['reasoning'][:200]}...")
        print(f"Action: {update['action']}")

    agent.add_callback(print_update)

    print(f"\nStarting agent for {args.steps} steps...")
    try:
        asyncio.run(agent.run(steps=args.steps, delay=args.delay))
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        if args.save_state:
            print(f"Saving state to {args.save_state}...")
            emulator.save_state(args.save_state)
        emulator.stop()

    print("Done!")


def run_web(args):
    """Run with web UI."""
    # Update config with args
    config.ROM_PATH = args.rom
    config.MODEL_PATH = args.model

    print(f"Starting web server on http://{config.WEB_HOST}:{args.port}")
    uvicorn.run(
        "web.server:app",
        host=config.WEB_HOST,
        port=args.port,
        reload=False,
    )


def main():
    parser = argparse.ArgumentParser(description="LocalLLMPlaysPokemon")
    parser.add_argument("--rom", default=config.ROM_PATH, help="Path to Pokemon ROM")
    parser.add_argument("--model", default=config.MODEL_PATH, help="Path to .gguf model")
    parser.add_argument("--web", action="store_true", help="Run with web UI")
    parser.add_argument("--port", type=int, default=config.WEB_PORT, help="Web server port")
    parser.add_argument("--steps", type=int, default=10, help="Number of steps (headless mode)")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between steps")
    parser.add_argument("--display", action="store_true", help="Show emulator window")
    parser.add_argument("--max-history", type=int, default=config.MAX_HISTORY_TURNS, help="Max history turns")
    parser.add_argument("--load-state", help="Load emulator state from file")
    parser.add_argument("--save-state", help="Save emulator state to file on exit")
    parser.add_argument("--verbose", action="store_true", help="Verbose LLM output")

    args = parser.parse_args()

    if args.web:
        run_web(args)
    else:
        run_headless(args)


if __name__ == "__main__":
    main()
```

**Step 2: Commit**

```bash
git add main.py
git commit -m "feat: add main entry point with CLI"
```

---

## Task 13: Final Testing & Documentation

**Files:**
- Update: `README.md` (if needed)

**Step 1: Test headless mode**

```bash
python main.py --rom pokemon.gb --steps 5 --verbose
```

Expected: Agent runs 5 steps, prints reasoning and actions.

**Step 2: Test web mode**

```bash
python main.py --rom pokemon.gb --web
```

Expected: Server starts, open http://localhost:8000, click Start.

**Step 3: Final commit**

```bash
git add -A
git commit -m "chore: project complete and tested"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Project setup | requirements.txt, config.py, .gitignore |
| 2 | Memory reader enums | agent/memory_reader.py |
| 3 | Memory reader class | agent/memory_reader.py |
| 4 | Emulator wrapper | agent/emulator.py |
| 5 | LLM backend abstraction | llm/base.py |
| 6 | llama-cpp backend | llm/llama_cpp_backend.py |
| 7 | Action parser | agent/action_parser.py |
| 8 | Context manager | agent/context_manager.py |
| 9 | Game agent | agent/game_agent.py |
| 10 | Web server | web/server.py |
| 11 | Web UI | web/static/* |
| 12 | Main entry point | main.py |
| 13 | Testing | - |

Total: 13 tasks with ~15 files to create.
