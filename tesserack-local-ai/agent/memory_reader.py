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