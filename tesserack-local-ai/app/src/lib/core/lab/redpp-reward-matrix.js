/**
 * Red++ reward matrix, version 3.7.
 *
 * All values are dimensionless reward units. The hierarchy is intentional:
 * dense feedback << battle result < durable milestone < Champion.
 * HP rewards use fractions rather than raw hit points, making the signal
 * invariant to level and species. Context gates prevent mutually unrelated
 * penalties (for example movement cost during mandatory dialog).
 */
export const REDPP_REWARD_MATRIX_VERSION = 'redpp-v4.0.0';

export const REDPP_REWARD_MATRIX = deepFreeze({
    gamma: 0.997,
    denseRewardCap: 2,

    boot: {
        activeMap: 0.5,
    },

    curriculum: {
        // Potential-like progress over stable RAM milestones. The episode's
        // first active state is only a baseline, so checkpoint starts cannot
        // receive retroactive credit. Each later level can pay at most once.
        episodeProgressUnit: 0.5,
        transitionCap: 2,
    },

    dialog: {
        advanced: 0.04,
        closed: 0.06,
        inaction: -0.03,
        diminishingFactor: 0.8,
        positionCap: 0.2,
    },

    overworld: {
        // One RL decision advances many emulator frames. Charging per frame
        // would make 16x change the objective, so efficiency is priced once
        // per observable decision instead.
        decisionCost: -0.002,
        // A/B that neither moves nor changes any interaction state must not be
        // a safer local optimum than attempting useful navigation.
        inaction: -0.02,
        novelTile: 0.04,
        revisitBase: -0.015,
        revisitCap: -0.08,
        twoCycle: -0.04,
        recentWindow: 20,
        recentRepeatThreshold: 3,
        recentLoopBase: -0.06,
        recentLoopSlope: -0.02,
        recentLoopCap: -0.14,
        blockedMovement: -0.025,
        stuckStart: 12,
        stuckSlope: -0.01,
        stuckCap: -0.25,
        newLocation: 0.5,
    },

    battle: {
        enemyHpFraction: 1.5,
        ownHpFraction: -1.25,
        superEffective: 0.1,
        stab: 0.03,
        resisted: -0.04,
        immune: -0.1,
        wildWin: 2.5,
        trainerWin: 6,
        loss: -4,
        escapeOrDraw: -0.4,
    },

    milestone: {
        badge: 20,
        levelUnit: 0.75,
        levelCap: 1.5,
        oakRival: 4,
        events: {
            followedOakIntoLab: 1,
            gotStarter: 3,
            gotOaksParcel: 2,
            oakGotParcel: 2,
            gotPokedex: 4,
            beatPewterGymTrainer: 5,
            beatBrock: 10,
        },
        champion: 150,
        whiteout: -12,
    },

    // Across a complete run, six first-time roster slots (9), the full-team
    // bonus (4), and every possible quality improvement (6) remain below one
    // badge (20). Quality is paid only above the run's previous best score.
    team: {
        member: 1.5,
        fullTeam: 4,
        qualityScale: 6,
        qualityTransitionCap: 2,
        qualityEpsilon: 0.002,
    },

    menu: {
        decisionCost: -0.004,
        graceSteps: 6,
        idleBase: -0.03,
        idleSlope: -0.012,
        idleCap: -0.3,
        reopenWindow: 120,
        freeReopens: 1,
        reopenBase: -0.2,
        reopenCap: -1.6,
        saveCooldown: 750,
        repeatSaveBase: -1.5,
        repeatSaveCap: -10,
    },
});

export const REWARD_CONTEXT = Object.freeze({
    INACTIVE: 'inactive',
    DIALOG: 'dialog',
    BATTLE: 'battle',
    MENU: 'menu',
    OVERWORLD: 'overworld',
});

export function classifyRewardContext(prevState, currState) {
    if (prevState?.inBattle || currState?.inBattle) return REWARD_CONTEXT.BATTLE;
    if (dialogText(prevState) || dialogText(currState)) return REWARD_CONTEXT.DIALOG;
    if (prevState?.menu?.open || currState?.menu?.open) return REWARD_CONTEXT.MENU;
    // Warning/title/loading screens expose zero or stale WRAM. They are
    // required boot progress, not an overworld on which movement efficiency
    // or loop penalties are meaningful.
    if (!activeMap(prevState) || !activeMap(currState)) return REWARD_CONTEXT.INACTIVE;
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

function activeMap(state) {
    const location = String(state?.location || '').trim().toUpperCase();
    return Boolean(location)
        && location !== 'NO ACTIVE MAP'
        && !location.startsWith('UNKNOWN (')
        && Number.isFinite(Number(state?.coordinates?.x))
        && Number.isFinite(Number(state?.coordinates?.y));
}

function deepFreeze(value) {
    for (const item of Object.values(value)) {
        if (item && typeof item === 'object') deepFreeze(item);
    }
    return Object.freeze(value);
}
