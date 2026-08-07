/**
 * Deterministic Red++ v3.0.2 team-quality analysis.
 *
 * Species base-stat totals and move data are transcribed from the matching
 * Red++ source tree (data/baseStats/*.asm and data/moves.asm). The score is
 * bounded to [0, 1], uses only observable party state, and is suitable for
 * high-watermark reward shaping.
 */
import { clamp } from './redpp-reward-matrix.js';

export const REDPP_TYPES = Object.freeze([
    'NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST',
    'STEEL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON',
    'DARK', 'FAIRY',
]);

// Five-stat totals: HP + Attack + Defense + Speed + Special.
const BASE_STAT_TOTALS = Object.freeze(
    '253,325,425,249,325,425,250,325,425,175,180,315,175,180,315,216,299,409,218,343,231,381,234,369,270,405,280,405,235,310,420,233,310,420,258,393,249,424,225,385,215,390,255,320,400,240,345,250,375,230,375,250,375,255,405,260,385,280,455,260,335,420,255,330,405,270,345,420,270,345,420,285,435,270,345,430,345,420,275,390,270,395,315,275,410,280,405,275,400,280,480,275,350,425,340,285,410,300,425,275,410,280,455,270,345,345,345,310,295,420,315,440,415,395,410,270,395,285,385,285,435,340,420,340,395,395,430,450,185,480,450,240,280,430,430,430,310,300,425,300,430,440,430,485,490,495,250,350,500,590,500,590,280,420,363,453,460,430,465,430,465,415,445,455,465,410,390,400,445,465,420,460,445,455,445,480,485,435,205,325,430,395,465,425,350,390,450,274,384,210,350,400,490,490,420,175,170,173,190,240,305,310,240,205,350,210,370,570'
        .split(',').map(Number),
);

const MOVE_TYPES = Object.freeze(
    'NORMAL,FIGHTING,NORMAL,NORMAL,NORMAL,NORMAL,FIRE,ICE,ELECTRIC,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,FLYING,FLYING,NORMAL,FLYING,NORMAL,NORMAL,GRASS,NORMAL,FIGHTING,NORMAL,FIGHTING,FIGHTING,GROUND,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,POISON,BUG,BUG,NORMAL,DARK,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,POISON,FIRE,FIRE,ICE,WATER,WATER,WATER,ICE,ICE,PSYCHIC,WATER,ICE,NORMAL,FLYING,FLYING,FIGHTING,FIGHTING,FIGHTING,FIGHTING,NORMAL,GRASS,GRASS,GRASS,NORMAL,GRASS,GRASS,POISON,GRASS,GRASS,GRASS,BUG,DRAGON,FIRE,ELECTRIC,ELECTRIC,ELECTRIC,ELECTRIC,ROCK,GROUND,GROUND,GROUND,POISON,PSYCHIC,PSYCHIC,PSYCHIC,PSYCHIC,PSYCHIC,NORMAL,NORMAL,PSYCHIC,GHOST,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,GHOST,WATER,NORMAL,PSYCHIC,PSYCHIC,ICE,PSYCHIC,NORMAL,NORMAL,NORMAL,FLYING,NORMAL,NORMAL,GHOST,POISON,POISON,GROUND,FIRE,WATER,WATER,NORMAL,NORMAL,NORMAL,NORMAL,PSYCHIC,PSYCHIC,NORMAL,FIGHTING,NORMAL,PSYCHIC,POISON,NORMAL,BUG,NORMAL,FLYING,NORMAL,WATER,NORMAL,GRASS,NORMAL,PSYCHIC,NORMAL,POISON,WATER,NORMAL,NORMAL,GROUND,PSYCHIC,ROCK,NORMAL,DARK,NORMAL,NORMAL,NORMAL,NORMAL,NORMAL,UNKNOWN,STEEL,STEEL,STEEL,STEEL,STEEL,DARK,DARK,DARK,DARK,FAIRY,FAIRY,FAIRY,FAIRY,DRAGON,DRAGON,DRAGON,DRAGON,DRAGON,DRAGON,GHOST,STEEL,STEEL,FLYING,FIRE,FIRE,FIRE,ICE,ELECTRIC,WATER,WATER,WATER,GRASS,DARK,GHOST,FIRE,FAIRY,GHOST,GHOST,FLYING,FLYING,FLYING,ICE,ICE,ICE,ELECTRIC,ELECTRIC,ELECTRIC,ELECTRIC,WATER,WATER,GRASS,GRASS,GRASS,GRASS,POISON,POISON,POISON,POISON,BUG,BUG,BUG,BUG,BUG,GROUND,GROUND,GROUND,PSYCHIC,PSYCHIC,PSYCHIC,NORMAL,NORMAL,NORMAL,ROCK,ROCK,ROCK,ROCK,FIGHTING,FIGHTING,FIGHTING,FIGHTING,FLYING,FAIRY,GROUND,FLYING,ROCK,WATER,PSYCHIC,PSYCHIC'
        .split(','),
);

const MOVE_POWERS = Object.freeze(
    '40,50,15,18,80,40,75,75,75,40,55,1,80,0,50,40,60,0,90,15,80,45,65,30,120,100,60,0,70,65,15,1,40,85,15,90,120,120,0,15,25,25,0,60,0,0,0,0,1,0,40,40,90,0,40,110,90,90,110,65,65,65,150,35,80,80,50,1,1,80,20,40,0,0,55,200,0,0,0,120,0,1,35,40,90,0,110,50,100,1,80,0,50,90,0,0,0,40,20,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,200,100,30,30,65,65,110,80,35,60,130,20,10,0,0,0,130,0,100,0,15,80,0,200,0,40,70,0,0,1,0,0,100,250,18,50,0,75,80,0,0,80,1,70,0,50,50,40,80,100,90,80,80,60,70,95,50,40,80,130,60,80,85,40,120,70,70,0,75,65,120,150,65,65,60,90,150,150,70,80,60,0,65,60,60,110,60,55,40,1,80,20,80,120,90,35,75,90,90,120,80,120,50,95,60,90,120,80,75,90,20,65,80,80,70,90,80,150,80,25,0,60,100,60,100,65,110,0,25,100,60,80,70,100'
        .split(',').map(Number),
);

const SUPER_EFFECTIVE = Object.freeze({
    NORMAL: [],
    FIGHTING: ['NORMAL', 'ROCK', 'ICE', 'DARK', 'STEEL'],
    FLYING: ['FIGHTING', 'BUG', 'GRASS'],
    POISON: ['GRASS', 'FAIRY'],
    GROUND: ['FIRE', 'ELECTRIC', 'ROCK', 'POISON', 'STEEL'],
    ROCK: ['FIRE', 'FLYING', 'BUG', 'ICE'],
    BUG: ['GRASS', 'PSYCHIC', 'DARK'],
    GHOST: ['GHOST', 'PSYCHIC'],
    STEEL: ['ROCK', 'ICE', 'FAIRY'],
    FIRE: ['GRASS', 'ICE', 'BUG', 'STEEL'],
    WATER: ['FIRE', 'ROCK', 'GROUND'],
    GRASS: ['WATER', 'GROUND', 'ROCK'],
    ELECTRIC: ['WATER', 'FLYING'],
    PSYCHIC: ['FIGHTING', 'POISON'],
    ICE: ['GRASS', 'GROUND', 'FLYING', 'DRAGON'],
    DRAGON: ['DRAGON'],
    DARK: ['GHOST', 'PSYCHIC'],
    FAIRY: ['DARK', 'FIGHTING', 'DRAGON'],
});

const RESISTED = Object.freeze({
    NORMAL: ['ROCK', 'STEEL'],
    FIGHTING: ['POISON', 'FLYING', 'PSYCHIC', 'BUG', 'FAIRY'],
    FLYING: ['ELECTRIC', 'ROCK', 'STEEL'],
    POISON: ['POISON', 'GROUND', 'ROCK', 'GHOST'],
    GROUND: ['GRASS', 'BUG'],
    ROCK: ['FIGHTING', 'GROUND', 'STEEL'],
    BUG: ['FIRE', 'FIGHTING', 'FLYING', 'GHOST', 'POISON', 'STEEL', 'FAIRY'],
    GHOST: ['DARK'],
    STEEL: ['STEEL', 'FIRE', 'WATER', 'ELECTRIC'],
    FIRE: ['FIRE', 'WATER', 'ROCK', 'DRAGON'],
    WATER: ['WATER', 'GRASS', 'DRAGON', 'STEEL'],
    GRASS: ['FIRE', 'GRASS', 'POISON', 'FLYING', 'BUG', 'DRAGON', 'STEEL'],
    ELECTRIC: ['ELECTRIC', 'GRASS', 'DRAGON', 'STEEL'],
    PSYCHIC: ['PSYCHIC', 'STEEL'],
    ICE: ['FIRE', 'WATER', 'ICE', 'STEEL'],
    DRAGON: ['STEEL'],
    DARK: ['FIGHTING', 'DARK', 'FAIRY'],
    FAIRY: ['FIRE', 'POISON', 'STEEL'],
});

const IMMUNE = Object.freeze({
    NORMAL: ['GHOST'],
    FIGHTING: ['GHOST'],
    GROUND: ['FLYING'],
    GHOST: ['NORMAL'],
    ELECTRIC: ['GROUND'],
    PSYCHIC: ['DARK'],
    DRAGON: ['FAIRY'],
    POISON: ['STEEL'],
});

export const TEAM_QUALITY_WEIGHTS = Object.freeze({
    levelBalance: 0.35,
    offensiveCoverage: 0.20,
    typeDiversity: 0.20,
    baseStats: 0.15,
    defensiveResilience: 0.10,
});

export function getRedppBaseStatTotal(speciesId) {
    const index = Number(speciesId) - 1;
    return Number.isInteger(index) && index >= 0 && index < BASE_STAT_TOTALS.length
        ? BASE_STAT_TOTALS[index]
        : 0;
}

export function getRedppMoveData(moveId) {
    const index = Number(moveId) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= MOVE_TYPES.length) return null;
    return Object.freeze({ type: MOVE_TYPES[index], power: MOVE_POWERS[index] || 0 });
}

export function getRedppTypeMultiplier(attackingType, defendingTypes) {
    const attack = normalizeType(attackingType);
    if (!attack) return 1;
    const defenders = [...new Set((Array.isArray(defendingTypes) ? defendingTypes : [defendingTypes])
        .map(normalizeType).filter(Boolean))];
    return defenders.reduce((multiplier, defending) => {
        if (IMMUNE[attack]?.includes(defending)) return 0;
        if (SUPER_EFFECTIVE[attack]?.includes(defending)) return multiplier * 2;
        if (RESISTED[attack]?.includes(defending)) return multiplier * 0.5;
        return multiplier;
    }, 1);
}

export function analyzeRedppTeam(party = []) {
    const members = (Array.isArray(party) ? party : [])
        .filter(mon => Number.isInteger(Number(mon?.speciesId))
            && Number(mon.speciesId) >= 1 && Number(mon.speciesId) <= BASE_STAT_TOTALS.length)
        .slice(0, 6);
    const size = members.length;
    if (size === 0) return emptyAnalysis();

    const memberTypes = members.map(mon => [...new Set([normalizeType(mon.type1), normalizeType(mon.type2)]
        .filter(Boolean))]);
    const allTypeSlots = memberTypes.flat();
    const uniqueTeamTypes = [...new Set(allTypeSlots)];
    const typeDiversity = allTypeSlots.length > 0 ? uniqueTeamTypes.length / allTypeSlots.length : 0;

    const damagingMoveTypes = [...new Set(members.flatMap(mon => (mon.moveIds || mon.moves || [])
        .map(move => getRedppMoveData(move?.id ?? move))
        .filter(move => move?.power > 0 && move.type !== 'UNKNOWN')
        .map(move => move.type)))];
    const coveredDefendingTypes = REDPP_TYPES.filter(defending =>
        damagingMoveTypes.some(attacking => getRedppTypeMultiplier(attacking, [defending]) > 1));
    const offensiveCoverage = coveredDefendingTypes.length / REDPP_TYPES.length;

    const weaknessCounts = REDPP_TYPES.map(attacking => memberTypes
        .filter(types => types.length > 0 && getRedppTypeMultiplier(attacking, types) > 1).length);
    const stackedWeakness = size > 1
        ? weaknessCounts.reduce((sum, count) => sum + Math.max(0, count - 1) / (size - 1), 0) / REDPP_TYPES.length
        : 0;
    const resistanceBreadth = REDPP_TYPES.filter(attacking => memberTypes
        .some(types => types.length > 0 && getRedppTypeMultiplier(attacking, types) < 1)).length / REDPP_TYPES.length;
    const defensiveResilience = clamp(0.75 * (1 - stackedWeakness) + 0.25 * resistanceBreadth, 0, 1);

    const bstValues = members.map(mon => getRedppBaseStatTotal(mon.speciesId));
    const meanBaseStatTotal = mean(bstValues);
    const baseStats = clamp((meanBaseStatTotal - 170) / (590 - 170), 0, 1);

    const levels = members.map(mon => clamp(Number(mon.level) || 0, 0, 100));
    const meanLevel = mean(levels);
    const levelStdDev = Math.sqrt(mean(levels.map(level => (level - meanLevel) ** 2)));
    const coefficientOfVariation = meanLevel > 0 ? levelStdDev / meanLevel : 1;
    const minMaxRatio = Math.max(...levels) > 0 ? Math.min(...levels) / Math.max(...levels) : 0;
    const levelBalance = size < 2
        ? 1
        : clamp(0.5 * minMaxRatio + 0.5 * (1 - coefficientOfVariation / 0.5), 0, 1);

    const composition = TEAM_QUALITY_WEIGHTS.levelBalance * levelBalance
        + TEAM_QUALITY_WEIGHTS.offensiveCoverage * offensiveCoverage
        + TEAM_QUALITY_WEIGHTS.typeDiversity * typeDiversity
        + TEAM_QUALITY_WEIGHTS.baseStats * baseStats
        + TEAM_QUALITY_WEIGHTS.defensiveResilience * defensiveResilience;
    const rosterFactor = size / 6;
    const score = clamp(rosterFactor * composition, 0, 1);

    return Object.freeze({
        score,
        size,
        rosterFactor,
        meanBaseStatTotal,
        baseStats,
        levelBalance,
        typeDiversity,
        offensiveCoverage,
        defensiveResilience,
        uniqueTeamTypes: Object.freeze(uniqueTeamTypes),
        damagingMoveTypes: Object.freeze(damagingMoveTypes),
        coveredDefendingTypes: Object.freeze(coveredDefendingTypes),
        stackedWeakness,
    });
}

function emptyAnalysis() {
    return Object.freeze({
        score: 0,
        size: 0,
        rosterFactor: 0,
        meanBaseStatTotal: 0,
        baseStats: 0,
        levelBalance: 0,
        typeDiversity: 0,
        offensiveCoverage: 0,
        defensiveResilience: 0,
        uniqueTeamTypes: Object.freeze([]),
        damagingMoveTypes: Object.freeze([]),
        coveredDefendingTypes: Object.freeze([]),
        stackedWeakness: 0,
    });
}

function normalizeType(type) {
    const normalized = String(type || '').toUpperCase().replace('UNK_TYPE', 'UNKNOWN');
    return REDPP_TYPES.includes(normalized) ? normalized : null;
}

function mean(values) {
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
