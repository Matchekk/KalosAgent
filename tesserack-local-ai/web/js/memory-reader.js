// memory-reader.js - Pokemon Red memory reading
// Ported from Python agent/memory_reader.py

// Memory addresses for Pokemon Red
export const ADDRESSES = {
    // Player info
    PLAYER_NAME: 0xD158,
    PLAYER_NAME_END: 0xD163,
    RIVAL_NAME: 0xD34A,
    RIVAL_NAME_END: 0xD351,

    // Money (BCD encoded, 3 bytes)
    MONEY: 0xD347,
    MONEY_MID: 0xD348,
    MONEY_HIGH: 0xD349,

    // Badges
    BADGES: 0xD356,

    // Party
    PARTY_COUNT: 0xD163,

    // Location
    MAP_ID: 0xD35E,
    PLAYER_X: 0xD362,
    PLAYER_Y: 0xD361,

    // Items
    ITEM_COUNT: 0xD31D,
    ITEM_START: 0xD31E,

    // Dialog/text buffer
    TEXT_BUFFER_START: 0xC3A0,
    TEXT_BUFFER_END: 0xC507,

    // Battle
    BATTLE_TYPE: 0xD057,
    TEXT_BOX_ID: 0xD125,
    CURRENT_BOX_NUM: 0xD5A0,
};

// Pokemon party data - each Pokemon has specific base addresses
export const PARTY_ADDRESSES = {
    BASE: [0xD16B, 0xD197, 0xD1C3, 0xD1EF, 0xD21B, 0xD247],
    NICKNAMES: [0xD2B5, 0xD2C0, 0xD2CB, 0xD2D6, 0xD2E1, 0xD2EC],
};

// Map location names
export const MAP_NAMES = {
    0x00: 'PALLET TOWN',
    0x01: 'VIRIDIAN CITY',
    0x02: 'PEWTER CITY',
    0x03: 'CERULEAN CITY',
    0x04: 'LAVENDER TOWN',
    0x05: 'VERMILION CITY',
    0x06: 'CELADON CITY',
    0x07: 'FUCHSIA CITY',
    0x08: 'CINNABAR ISLAND',
    0x09: 'INDIGO PLATEAU',
    0x0A: 'SAFFRON CITY',
    0x0C: 'ROUTE 1',
    0x0D: 'ROUTE 2',
    0x0E: 'ROUTE 3',
    0x0F: 'ROUTE 4',
    0x10: 'ROUTE 5',
    0x11: 'ROUTE 6',
    0x12: 'ROUTE 7',
    0x13: 'ROUTE 8',
    0x14: 'ROUTE 9',
    0x15: 'ROUTE 10',
    0x16: 'ROUTE 11',
    0x17: 'ROUTE 12',
    0x18: 'ROUTE 13',
    0x19: 'ROUTE 14',
    0x1A: 'ROUTE 15',
    0x1B: 'ROUTE 16',
    0x1C: 'ROUTE 17',
    0x1D: 'ROUTE 18',
    0x1E: 'ROUTE 19',
    0x1F: 'ROUTE 20',
    0x20: 'ROUTE 21',
    0x21: 'ROUTE 22',
    0x22: 'ROUTE 23',
    0x23: 'ROUTE 24',
    0x24: 'ROUTE 25',
    0x25: 'PLAYERS HOUSE 1F',
    0x26: 'PLAYERS HOUSE 2F',
    0x27: 'RIVALS HOUSE',
    0x28: 'OAKS LAB',
    0x29: 'VIRIDIAN POKECENTER',
    0x2A: 'VIRIDIAN MART',
    0x2D: 'VIRIDIAN GYM',
    0x33: 'VIRIDIAN FOREST',
    0x36: 'PEWTER GYM',
    0x3A: 'PEWTER POKECENTER',
    0x3B: 'MT MOON 1F',
    0x3C: 'MT MOON B1F',
    0x3D: 'MT MOON B2F',
    0x40: 'CERULEAN POKECENTER',
    0x41: 'CERULEAN GYM',
    0x52: 'ROCK TUNNEL 1F',
    0x53: 'POWER PLANT',
    0x59: 'VERMILION POKECENTER',
    0x5C: 'VERMILION GYM',
    0x5F: 'SS ANNE 1F',
    0x6C: 'VICTORY ROAD 1F',
    0x71: 'LANCE',
    0x76: 'HALL OF FAME',
    0x78: 'CHAMPIONS ROOM',
    0x85: 'CELADON POKECENTER',
    0x86: 'CELADON GYM',
    0x87: 'GAME CORNER',
    0x8E: 'POKEMON TOWER 1F',
    0x9A: 'FUCHSIA POKECENTER',
    0x9C: 'SAFARI ZONE ENTRANCE',
    0x9D: 'FUCHSIA GYM',
    0xA6: 'CINNABAR GYM',
    0xAB: 'CINNABAR POKECENTER',
    0xAE: 'INDIGO PLATEAU LOBBY',
    0xB2: 'SAFFRON GYM',
    0xB5: 'SILPH CO 1F',
    0xF5: 'LORELEI',
    0xF6: 'BRUNO',
    0xF7: 'AGATHA',
};

// Pokemon species IDs (internal game IDs, not Pokedex numbers)
export const POKEMON_NAMES = {
    0x01: 'RHYDON',
    0x02: 'KANGASKHAN',
    0x03: 'NIDORAN M',
    0x04: 'CLEFAIRY',
    0x05: 'SPEAROW',
    0x06: 'VOLTORB',
    0x07: 'NIDOKING',
    0x08: 'SLOWBRO',
    0x09: 'IVYSAUR',
    0x0A: 'EXEGGUTOR',
    0x0B: 'LICKITUNG',
    0x0C: 'EXEGGCUTE',
    0x0D: 'GRIMER',
    0x0E: 'GENGAR',
    0x0F: 'NIDORAN F',
    0x10: 'NIDOQUEEN',
    0x11: 'CUBONE',
    0x12: 'RHYHORN',
    0x13: 'LAPRAS',
    0x14: 'ARCANINE',
    0x15: 'MEW',
    0x16: 'GYARADOS',
    0x17: 'SHELLDER',
    0x18: 'TENTACOOL',
    0x19: 'GASTLY',
    0x1A: 'SCYTHER',
    0x1B: 'STARYU',
    0x1C: 'BLASTOISE',
    0x1D: 'PINSIR',
    0x1E: 'TANGELA',
    0x21: 'GROWLITHE',
    0x22: 'ONIX',
    0x23: 'FEAROW',
    0x24: 'PIDGEY',
    0x25: 'SLOWPOKE',
    0x26: 'KADABRA',
    0x27: 'GRAVELER',
    0x28: 'CHANSEY',
    0x29: 'MACHOKE',
    0x2A: 'MR MIME',
    0x2B: 'HITMONLEE',
    0x2C: 'HITMONCHAN',
    0x2D: 'ARBOK',
    0x2E: 'PARASECT',
    0x2F: 'PSYDUCK',
    0x30: 'DROWZEE',
    0x31: 'GOLEM',
    0x33: 'MAGMAR',
    0x35: 'ELECTABUZZ',
    0x36: 'MAGNETON',
    0x37: 'KOFFING',
    0x39: 'MANKEY',
    0x3A: 'SEEL',
    0x3B: 'DIGLETT',
    0x3C: 'TAUROS',
    0x40: 'FARFETCHD',
    0x41: 'VENONAT',
    0x42: 'DRAGONITE',
    0x46: 'DODUO',
    0x47: 'POLIWAG',
    0x48: 'JYNX',
    0x49: 'MOLTRES',
    0x4A: 'ARTICUNO',
    0x4B: 'ZAPDOS',
    0x4C: 'DITTO',
    0x4D: 'MEOWTH',
    0x4E: 'KRABBY',
    0x52: 'VULPIX',
    0x53: 'NINETALES',
    0x54: 'PIKACHU',
    0x55: 'RAICHU',
    0x58: 'DRATINI',
    0x59: 'DRAGONAIR',
    0x5A: 'KABUTO',
    0x5B: 'KABUTOPS',
    0x5C: 'HORSEA',
    0x5D: 'SEADRA',
    0x60: 'SANDSHREW',
    0x61: 'SANDSLASH',
    0x62: 'OMANYTE',
    0x63: 'OMASTAR',
    0x64: 'JIGGLYPUFF',
    0x65: 'WIGGLYTUFF',
    0x66: 'EEVEE',
    0x67: 'FLAREON',
    0x68: 'JOLTEON',
    0x69: 'VAPOREON',
    0x6A: 'MACHOP',
    0x6B: 'ZUBAT',
    0x6C: 'EKANS',
    0x6D: 'PARAS',
    0x6E: 'POLIWHIRL',
    0x6F: 'POLIWRATH',
    0x70: 'WEEDLE',
    0x71: 'KAKUNA',
    0x72: 'BEEDRILL',
    0x74: 'DODRIO',
    0x75: 'PRIMEAPE',
    0x76: 'DUGTRIO',
    0x77: 'VENOMOTH',
    0x78: 'DEWGONG',
    0x7B: 'CATERPIE',
    0x7C: 'METAPOD',
    0x7D: 'BUTTERFREE',
    0x7E: 'MACHAMP',
    0x80: 'GOLDUCK',
    0x81: 'HYPNO',
    0x82: 'GOLBAT',
    0x83: 'MEWTWO',
    0x84: 'SNORLAX',
    0x85: 'MAGIKARP',
    0x88: 'MUK',
    0x8A: 'KINGLER',
    0x8B: 'CLOYSTER',
    0x8D: 'ELECTRODE',
    0x8E: 'CLEFABLE',
    0x8F: 'WEEZING',
    0x90: 'PERSIAN',
    0x91: 'MAROWAK',
    0x93: 'HAUNTER',
    0x94: 'ABRA',
    0x95: 'ALAKAZAM',
    0x96: 'PIDGEOTTO',
    0x97: 'PIDGEOT',
    0x98: 'STARMIE',
    0x99: 'BULBASAUR',
    0x9A: 'VENUSAUR',
    0x9B: 'TENTACRUEL',
    0x9D: 'GOLDEEN',
    0x9E: 'SEAKING',
    0xA3: 'PONYTA',
    0xA4: 'RAPIDASH',
    0xA5: 'RATTATA',
    0xA6: 'RATICATE',
    0xA7: 'NIDORINO',
    0xA8: 'NIDORINA',
    0xA9: 'GEODUDE',
    0xAA: 'PORYGON',
    0xAB: 'AERODACTYL',
    0xAD: 'MAGNEMITE',
    0xB0: 'CHARMANDER',
    0xB1: 'SQUIRTLE',
    0xB2: 'CHARMELEON',
    0xB3: 'WARTORTLE',
    0xB4: 'CHARIZARD',
    0xB9: 'ODDISH',
    0xBA: 'GLOOM',
    0xBB: 'VILEPLUME',
    0xBC: 'BELLSPROUT',
    0xBD: 'WEEPINBELL',
    0xBE: 'VICTREEBEL',
};

// Move names
export const MOVE_NAMES = {
    0x01: 'POUND',
    0x02: 'KARATE CHOP',
    0x03: 'DOUBLESLAP',
    0x04: 'COMET PUNCH',
    0x05: 'MEGA PUNCH',
    0x06: 'PAY DAY',
    0x07: 'FIRE PUNCH',
    0x08: 'ICE PUNCH',
    0x09: 'THUNDERPUNCH',
    0x0A: 'SCRATCH',
    0x0B: 'VICEGRIP',
    0x0C: 'GUILLOTINE',
    0x0D: 'RAZOR WIND',
    0x0E: 'SWORDS DANCE',
    0x0F: 'CUT',
    0x10: 'GUST',
    0x11: 'WING ATTACK',
    0x12: 'WHIRLWIND',
    0x13: 'FLY',
    0x14: 'BIND',
    0x15: 'SLAM',
    0x16: 'VINE WHIP',
    0x17: 'STOMP',
    0x18: 'DOUBLE KICK',
    0x19: 'MEGA KICK',
    0x1A: 'JUMP KICK',
    0x1B: 'ROLLING KICK',
    0x1C: 'SAND ATTACK',
    0x1D: 'HEADBUTT',
    0x1E: 'HORN ATTACK',
    0x1F: 'FURY ATTACK',
    0x20: 'HORN DRILL',
    0x21: 'TACKLE',
    0x22: 'BODY SLAM',
    0x23: 'WRAP',
    0x24: 'TAKE DOWN',
    0x25: 'THRASH',
    0x26: 'DOUBLE EDGE',
    0x27: 'TAIL WHIP',
    0x28: 'POISON STING',
    0x29: 'TWINEEDLE',
    0x2A: 'PIN MISSILE',
    0x2B: 'LEER',
    0x2C: 'BITE',
    0x2D: 'GROWL',
    0x2E: 'ROAR',
    0x2F: 'SING',
    0x30: 'SUPERSONIC',
    0x31: 'SONICBOOM',
    0x32: 'DISABLE',
    0x33: 'ACID',
    0x34: 'EMBER',
    0x35: 'FLAMETHROWER',
    0x36: 'MIST',
    0x37: 'WATER GUN',
    0x38: 'HYDRO PUMP',
    0x39: 'SURF',
    0x3A: 'ICE BEAM',
    0x3B: 'BLIZZARD',
    0x3C: 'PSYBEAM',
    0x3D: 'BUBBLEBEAM',
    0x3E: 'AURORA BEAM',
    0x3F: 'HYPER BEAM',
    0x40: 'PECK',
    0x41: 'DRILL PECK',
    0x42: 'SUBMISSION',
    0x43: 'LOW KICK',
    0x44: 'COUNTER',
    0x45: 'SEISMIC TOSS',
    0x46: 'STRENGTH',
    0x47: 'ABSORB',
    0x48: 'MEGA DRAIN',
    0x49: 'LEECH SEED',
    0x4A: 'GROWTH',
    0x4B: 'RAZOR LEAF',
    0x4C: 'SOLARBEAM',
    0x4D: 'POISONPOWDER',
    0x4E: 'STUN SPORE',
    0x4F: 'SLEEP POWDER',
    0x50: 'PETAL DANCE',
    0x51: 'STRING SHOT',
    0x52: 'DRAGON RAGE',
    0x53: 'FIRE SPIN',
    0x54: 'THUNDERSHOCK',
    0x55: 'THUNDERBOLT',
    0x56: 'THUNDER WAVE',
    0x57: 'THUNDER',
    0x58: 'ROCK THROW',
    0x59: 'EARTHQUAKE',
    0x5A: 'FISSURE',
    0x5B: 'DIG',
    0x5C: 'TOXIC',
    0x5D: 'CONFUSION',
    0x5E: 'PSYCHIC',
    0x5F: 'HYPNOSIS',
    0x60: 'MEDITATE',
    0x61: 'AGILITY',
    0x62: 'QUICK ATTACK',
    0x63: 'RAGE',
    0x64: 'TELEPORT',
    0x65: 'NIGHT SHADE',
    0x66: 'MIMIC',
    0x67: 'SCREECH',
    0x68: 'DOUBLE TEAM',
    0x69: 'RECOVER',
    0x6A: 'HARDEN',
    0x6B: 'MINIMIZE',
    0x6C: 'SMOKESCREEN',
    0x6D: 'CONFUSE RAY',
    0x6E: 'WITHDRAW',
    0x6F: 'DEFENSE CURL',
    0x70: 'BARRIER',
    0x71: 'LIGHT SCREEN',
    0x72: 'HAZE',
    0x73: 'REFLECT',
    0x74: 'FOCUS ENERGY',
    0x75: 'BIDE',
    0x76: 'METRONOME',
    0x77: 'MIRROR MOVE',
    0x78: 'SELFDESTRUCT',
    0x79: 'EGG BOMB',
    0x7A: 'LICK',
    0x7B: 'SMOG',
    0x7C: 'SLUDGE',
    0x7D: 'BONE CLUB',
    0x7E: 'FIRE BLAST',
    0x7F: 'WATERFALL',
    0x80: 'CLAMP',
    0x81: 'SWIFT',
    0x82: 'SKULL BASH',
    0x83: 'SPIKE CANNON',
    0x84: 'CONSTRICT',
    0x85: 'AMNESIA',
    0x86: 'KINESIS',
    0x87: 'SOFTBOILED',
    0x88: 'HI JUMP KICK',
    0x89: 'GLARE',
    0x8A: 'DREAM EATER',
    0x8B: 'POISON GAS',
    0x8C: 'BARRAGE',
    0x8D: 'LEECH LIFE',
    0x8E: 'LOVELY KISS',
    0x8F: 'SKY ATTACK',
    0x90: 'TRANSFORM',
    0x91: 'BUBBLE',
    0x92: 'DIZZY PUNCH',
    0x93: 'SPORE',
    0x94: 'FLASH',
    0x95: 'PSYWAVE',
    0x96: 'SPLASH',
    0x97: 'ACID ARMOR',
    0x98: 'CRABHAMMER',
    0x99: 'EXPLOSION',
    0x9A: 'FURY SWIPES',
    0x9B: 'BONEMERANG',
    0x9C: 'REST',
    0x9D: 'ROCK SLIDE',
    0x9E: 'HYPER FANG',
    0x9F: 'SHARPEN',
    0xA0: 'CONVERSION',
    0xA1: 'TRI ATTACK',
    0xA2: 'SUPER FANG',
    0xA3: 'SLASH',
    0xA4: 'SUBSTITUTE',
    0xA5: 'STRUGGLE',
};

// Item names
export const ITEM_NAMES = {
    0x01: 'MASTER BALL',
    0x02: 'ULTRA BALL',
    0x03: 'GREAT BALL',
    0x04: 'POKE BALL',
    0x05: 'TOWN MAP',
    0x06: 'BICYCLE',
    0x08: 'SAFARI BALL',
    0x09: 'POKEDEX',
    0x0A: 'MOON STONE',
    0x0B: 'ANTIDOTE',
    0x0C: 'BURN HEAL',
    0x0D: 'ICE HEAL',
    0x0E: 'AWAKENING',
    0x0F: 'PARLYZ HEAL',
    0x10: 'FULL RESTORE',
    0x11: 'MAX POTION',
    0x12: 'HYPER POTION',
    0x13: 'SUPER POTION',
    0x14: 'POTION',
    0x1D: 'ESCAPE ROPE',
    0x1E: 'REPEL',
    0x1F: 'OLD AMBER',
    0x20: 'FIRE STONE',
    0x21: 'THUNDERSTONE',
    0x22: 'WATER STONE',
    0x23: 'HP UP',
    0x24: 'PROTEIN',
    0x25: 'IRON',
    0x26: 'CARBOS',
    0x27: 'CALCIUM',
    0x28: 'RARE CANDY',
    0x29: 'DOME FOSSIL',
    0x2A: 'HELIX FOSSIL',
    0x2B: 'SECRET KEY',
    0x2D: 'BIKE VOUCHER',
    0x2E: 'X ACCURACY',
    0x2F: 'LEAF STONE',
    0x30: 'CARD KEY',
    0x31: 'NUGGET',
    0x32: 'PP UP',
    0x33: 'POKE DOLL',
    0x34: 'FULL HEAL',
    0x35: 'REVIVE',
    0x36: 'MAX REVIVE',
    0x37: 'GUARD SPEC',
    0x38: 'SUPER REPEL',
    0x39: 'MAX REPEL',
    0x3A: 'DIRE HIT',
    0x3C: 'FRESH WATER',
    0x3D: 'SODA POP',
    0x3E: 'LEMONADE',
    0x3F: 'SS TICKET',
    0x40: 'GOLD TEETH',
    0x41: 'X ATTACK',
    0x42: 'X DEFEND',
    0x43: 'X SPEED',
    0x44: 'X SPECIAL',
    0x45: 'COIN CASE',
    0x46: 'OAKS PARCEL',
    0x47: 'ITEMFINDER',
    0x48: 'SILPH SCOPE',
    0x49: 'POKE FLUTE',
    0x4A: 'LIFT KEY',
    0x4B: 'EXP ALL',
    0x4C: 'OLD ROD',
    0x4D: 'GOOD ROD',
    0x4E: 'SUPER ROD',
    0x50: 'ETHER',
    0x51: 'MAX ETHER',
    0x52: 'ELIXER',
    0x53: 'MAX ELIXER',
};

// Pokemon types
export const TYPE_NAMES = {
    0x00: 'NORMAL',
    0x01: 'FIGHTING',
    0x02: 'FLYING',
    0x03: 'POISON',
    0x04: 'GROUND',
    0x05: 'ROCK',
    0x07: 'BUG',
    0x08: 'GHOST',
    0x14: 'FIRE',
    0x15: 'WATER',
    0x16: 'GRASS',
    0x17: 'ELECTRIC',
    0x18: 'PSYCHIC',
    0x19: 'ICE',
    0x1A: 'DRAGON',
};

// Badge names
export const BADGE_NAMES = ['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth'];

// Status condition masks
export const STATUS = {
    SLEEP_MASK: 0b111,
    POISON: 0b1000,
    BURN: 0b10000,
    FREEZE: 0b100000,
    PARALYSIS: 0b1000000,
};

/**
 * Get status condition name from status byte
 * @param {number} statusByte
 * @returns {string}
 */
export function getStatusName(statusByte) {
    if (statusByte & STATUS.SLEEP_MASK) return 'SLEEP';
    if (statusByte & STATUS.PARALYSIS) return 'PARALYSIS';
    if (statusByte & STATUS.FREEZE) return 'FREEZE';
    if (statusByte & STATUS.BURN) return 'BURN';
    if (statusByte & STATUS.POISON) return 'POISON';
    return 'OK';
}

/**
 * Memory reader for Pokemon Red game state
 */
export class MemoryReader {
    /**
     * @param {Object} emulator - Emulator instance with readMemory/readMemoryRange methods
     */
    constructor(emulator) {
        this.emu = emulator;
    }

    /**
     * Read a single byte from memory
     * @param {number} address - Memory address
     * @returns {number}
     */
    readByte(address) {
        return this.emu.readMemory(address);
    }

    /**
     * Read multiple bytes from memory
     * @param {number} address - Start address
     * @param {number} length - Number of bytes
     * @returns {Uint8Array}
     */
    readBytes(address, length) {
        return this.emu.readMemoryRange(address, length);
    }

    /**
     * Convert Pokemon text encoding to ASCII string
     * @param {Uint8Array|number[]} data - Raw bytes
     * @returns {string}
     */
    convertText(data) {
        const result = [];
        for (const b of data) {
            if (b === 0x50) break;  // End marker
            if (b === 0x7F) {
                result.push(' ');
            } else if (b >= 0x80 && b <= 0x99) {
                // A-Z
                result.push(String.fromCharCode('A'.charCodeAt(0) + (b - 0x80)));
            } else if (b >= 0xA0 && b <= 0xB9) {
                // a-z
                result.push(String.fromCharCode('a'.charCodeAt(0) + (b - 0xA0)));
            } else if (b >= 0xF6 && b <= 0xFF) {
                // 0-9
                result.push(String(b - 0xF6));
            } else if (b === 0xE8) {
                result.push('.');
            } else if (b === 0xE3) {
                result.push('-');
            } else if (b === 0xE7) {
                result.push('!');
            } else if (b === 0xE6) {
                result.push('?');
            } else if (b === 0xF4) {
                result.push(',');
            } else if (b === 0xBA) {
                result.push('e');  // é
            }
        }
        return result.join('').trim();
    }

    /**
     * Read string from memory address with Pokemon text encoding
     * @param {number} address - Memory address to read from
     * @param {number} maxLength - Maximum number of bytes to read
     * @returns {string}
     */
    readString(address, maxLength = 10) {
        const bytes = this.readBytes(address, maxLength);
        return this.convertText(bytes);
    }

    /**
     * Read player name
     * @returns {string}
     */
    getPlayerName() {
        const bytes = this.readBytes(ADDRESSES.PLAYER_NAME, 11);
        return this.convertText(bytes);
    }

    /**
     * Read rival name
     * @returns {string}
     */
    getRivalName() {
        const bytes = this.readBytes(ADDRESSES.RIVAL_NAME, 11);
        return this.convertText(bytes);
    }

    /**
     * Read current map location
     * @returns {string}
     */
    getLocation() {
        const mapId = this.readByte(ADDRESSES.MAP_ID);
        return MAP_NAMES[mapId] || `UNKNOWN (${mapId})`;
    }

    /**
     * Read player coordinates
     * @returns {{x: number, y: number}}
     */
    getCoordinates() {
        return {
            x: this.readByte(ADDRESSES.PLAYER_X),
            y: this.readByte(ADDRESSES.PLAYER_Y)
        };
    }

    /**
     * Read money (BCD encoded)
     * @returns {number}
     */
    getMoney() {
        const b1 = this.readByte(ADDRESSES.MONEY_HIGH);  // 0xD349
        const b2 = this.readByte(ADDRESSES.MONEY_MID);   // 0xD348
        const b3 = this.readByte(ADDRESSES.MONEY);       // 0xD347
        return (
            ((b3 >> 4) * 100000) + ((b3 & 0xF) * 10000) +
            ((b2 >> 4) * 1000) + ((b2 & 0xF) * 100) +
            ((b1 >> 4) * 10) + (b1 & 0xF)
        );
    }

    /**
     * Read earned badges
     * @returns {string[]}
     */
    getBadges() {
        const badgeByte = this.readByte(ADDRESSES.BADGES);
        const badges = [];
        for (let i = 0; i < 8; i++) {
            if (badgeByte & (1 << i)) {
                badges.push(BADGE_NAMES[i]);
            }
        }
        return badges;
    }

    /**
     * Get party Pokemon count
     * @returns {number}
     */
    getPartyCount() {
        return this.readByte(ADDRESSES.PARTY_COUNT);
    }

    /**
     * Read party Pokemon data
     * @returns {Object[]}
     */
    getParty() {
        const count = this.getPartyCount();
        const party = [];

        for (let i = 0; i < Math.min(count, 6); i++) {
            const addr = PARTY_ADDRESSES.BASE[i];
            const speciesId = this.readByte(addr);

            if (speciesId === 0) continue;

            // Read nickname
            const nickBytes = this.readBytes(PARTY_ADDRESSES.NICKNAMES[i], 11);
            const nickname = this.convertText(nickBytes);

            // Read moves (at offset +8, 4 moves)
            const moves = [];
            const movePP = [];
            for (let j = 0; j < 4; j++) {
                const moveId = this.readByte(addr + 8 + j);
                if (moveId !== 0) {
                    moves.push(MOVE_NAMES[moveId] || `MOVE ${moveId}`);
                    movePP.push(this.readByte(addr + 0x1D + j));
                }
            }

            // Read types
            const type1 = this.readByte(addr + 5);
            const type2 = this.readByte(addr + 6);

            // Read status
            const status = this.readByte(addr + 4);

            // Read HP (big-endian at offset +1 and +2)
            const currentHP = (this.readByte(addr + 1) << 8) | this.readByte(addr + 2);
            const maxHP = (this.readByte(addr + 0x22) << 8) | this.readByte(addr + 0x23);

            // Read level (at offset +0x21)
            const level = this.readByte(addr + 0x21);

            party.push({
                speciesId,
                species: POKEMON_NAMES[speciesId] || `Pokemon #${speciesId}`,
                nickname,
                level,
                currentHP,
                maxHP,
                status: getStatusName(status),
                type1: TYPE_NAMES[type1] || 'UNKNOWN',
                type2: type1 !== type2 ? (TYPE_NAMES[type2] || null) : null,
                moves,
                movePP
            });
        }

        return party;
    }

    /**
     * Read inventory items
     * @returns {{name: string, quantity: number}[]}
     */
    getItems() {
        const items = [];
        const count = this.readByte(ADDRESSES.ITEM_COUNT);

        for (let i = 0; i < count; i++) {
            const itemId = this.readByte(ADDRESSES.ITEM_START + (i * 2));
            const quantity = this.readByte(ADDRESSES.ITEM_START + 1 + (i * 2));

            let name;
            if (itemId >= 0xC9 && itemId <= 0xFE) {
                name = `TM${(itemId - 0xC8).toString().padStart(2, '0')}`;
            } else if (itemId >= 0xC4 && itemId <= 0xC8) {
                name = `HM${(itemId - 0xC3).toString().padStart(2, '0')}`;
            } else {
                name = ITEM_NAMES[itemId] || `ITEM ${itemId}`;
            }

            items.push({ name, quantity });
        }

        return items;
    }

    /**
     * Read dialog text from screen buffer
     * @returns {string}
     */
    getDialog() {
        const length = ADDRESSES.TEXT_BUFFER_END - ADDRESSES.TEXT_BUFFER_START;
        const buffer = this.readBytes(ADDRESSES.TEXT_BUFFER_START, length);

        const textChars = [];
        for (const b of buffer) {
            if ((b >= 0x80 && b <= 0x99) || (b >= 0xA0 && b <= 0xB9) || (b >= 0xF6 && b <= 0xFF)) {
                textChars.push(b);
            } else if (b === 0x7F) {
                textChars.push(b);
            } else if ([0xE6, 0xE7, 0xE8, 0xF4].includes(b)) {
                textChars.push(b);
            }
        }

        return this.convertText(textChars);
    }

    /**
     * Check if in battle
     * @returns {boolean}
     */
    isInBattle() {
        return this.readByte(ADDRESSES.BATTLE_TYPE) !== 0;
    }

    /**
     * Get complete game state summary
     * @returns {Object}
     */
    getGameState() {
        return {
            playerName: this.getPlayerName(),
            rivalName: this.getRivalName(),
            location: this.getLocation(),
            coordinates: this.getCoordinates(),
            money: this.getMoney(),
            badges: this.getBadges(),
            badgeCount: this.getBadges().length,
            party: this.getParty(),
            partyCount: this.getPartyCount(),
            items: this.getItems(),
            inBattle: this.isInBattle(),
            dialog: this.getDialog()
        };
    }

    /**
     * Get a formatted string summary of game state (for LLM context)
     * @returns {string}
     */
    getGameStateSummary() {
        const state = this.getGameState();
        const lines = [];

        lines.push(`Player: ${state.playerName || 'Unknown'}`);
        lines.push(`Location: ${state.location} (${state.coordinates.x}, ${state.coordinates.y})`);
        lines.push(`Money: $${state.money}`);
        lines.push(`Badges: ${state.badges.length > 0 ? state.badges.join(', ') : 'None'} (${state.badgeCount}/8)`);

        if (state.party.length > 0) {
            lines.push('\nParty:');
            for (const pokemon of state.party) {
                const types = pokemon.type2 ? `${pokemon.type1}/${pokemon.type2}` : pokemon.type1;
                lines.push(`  - ${pokemon.nickname || pokemon.species} (${pokemon.species}) Lv.${pokemon.level} [${types}]`);
                lines.push(`    HP: ${pokemon.currentHP}/${pokemon.maxHP} | Status: ${pokemon.status}`);
                if (pokemon.moves.length > 0) {
                    lines.push(`    Moves: ${pokemon.moves.join(', ')}`);
                }
            }
        }

        if (state.items.length > 0) {
            lines.push('\nItems:');
            for (const item of state.items.slice(0, 10)) {  // Limit to first 10 items
                lines.push(`  - ${item.name} x${item.quantity}`);
            }
            if (state.items.length > 10) {
                lines.push(`  ... and ${state.items.length - 10} more items`);
            }
        }

        if (state.inBattle) {
            lines.push('\n[IN BATTLE]');
        }

        if (state.dialog) {
            lines.push(`\nDialog: "${state.dialog}"`);
        }

        return lines.join('\n');
    }
}
