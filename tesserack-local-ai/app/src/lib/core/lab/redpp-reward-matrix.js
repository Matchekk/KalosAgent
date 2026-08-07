/**
 * Red++ reward matrix, version 3.
 *
 * All values are dimensionless reward units. The hierarchy is intentional:
 * dense feedback << battle result < durable milestone < Champion.
 * HP rewards use fractions rather than raw hit points, making the signal
 * invariant to level and species. Context gates prevent mutually unrelated
 * penalties (for example movement cost during mandatory dialog).
 */
export const REDPP_REWARD_MATRIX_VERSION = 'redpp-v3.0.0';

export const REDPP_REWARD_MATRIX = deepFreeze({
    gamma: 0.99,
    denseRewardCap: 5,

    dialog: {
        advanced: 0.08,
        closed: 0.12,
        inaction: -0.03,
    },

    overworld: {
        decisionCost: -0.002,
        novelTile: 0.04,
        revisitBase: -0.015,
        revisitCap: -0.08,
        twoCycle: -0.04,
        blockedMovement: -0.025,
        stuckStart: 12,
        stuckSlope: -0.01,
        stuckCap: -0.25,
        newLocation: 1,
    },

    battle: {
        enemyHpFraction: 2,
        ownHpFraction: -1.5,
        superEffective: 0.15,
        stab: 0.05,
        resisted: -0.03,
        immune: -0.08,
        wildWin: 2,
        trainerWin: 5,
        loss: -3,
        escapeOrDraw: -0.25,
    },

    milestone: {
        badge: 15,
        levelUnit: 0.25,
        levelCap: 1,
        oakRival: 5,
        champion: 100,
        whiteout: -10,
    },

    // Across a complete run, six first-time roster slots (9) plus the full
    // team bonus (4) remain below one badge (15). Quality is bounded and only
    // paid when the run exceeds its previous best team score.
    team: {
        member: 1.5,
        fullTeam: 4,
        qualityScale: 8,
        qualityTransitionCap: 2.5,
        qualityEpsilon: 0.002,
    },

    menu: {
        freeStartActions: 2,
        spamBase: -0.15,
        spamCap: -2.4,
        saveCooldown: 750,
        repeatSaveBase: -1,
        repeatSaveCap: -8,
    },
});

export const REWARD_CONTEXT = Object.freeze({
    DIALOG: 'dialog',
    BATTLE: 'battle',
    OVERWORLD: 'overworld',
});

export function classifyRewardContext(prevState, currState) {
    if (prevState?.inBattle || currState?.inBattle) return REWARD_CONTEXT.BATTLE;
    if (dialogText(prevState) || dialogText(currState)) return REWARD_CONTEXT.DIALOG;
    return REWARD_CONTEXT.OVERWORLD;
}

export function dialogProgress(prevState, currState) {
    const before = dialogText(prevState);
    const after = dialogText(currState);
    return {
        active: Boolean(before || after),
        changed: Boolean(after && after !== before),
        closed: Boolean(before && !after),
    };
}

export function hpRatio(entity) {
    const current = Number(entity?.currentHP);
    const maximum = Number(entity?.maxHP);
    if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return 0;
    return clamp(current / maximum, 0, 1);
}

export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function dialogText(state) {
    return String(state?.dialog || '').replace(/\s+/g, ' ').trim();
}

function deepFreeze(value) {
    for (const item of Object.values(value)) {
        if (item && typeof item === 'object') deepFreeze(item);
    }
    return Object.freeze(value);
}
