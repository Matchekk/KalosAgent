import { ReinforceCore } from '../src/lib/core/lab/reinforce-core.js';

let agent = {};
try {
    agent = await import('../src/lib/core/lab/pure-rl-agent.js');
} catch {
    agent = {};
}

const {
    REDPP_STATE_SIZE = 0,
    REDPP_TRAINING_OBJECTIVE_VERSION = '',
    deriveRedppLearningPhase = null,
    encodeRedppStateInto = null,
    estimateSequenceSuccess = null,
} = agent;

const checks = [];
function check(name, condition) {
    let passed = false;
    try {
        passed = Boolean(typeof condition === 'function' ? condition() : condition);
    } catch {
        passed = false;
    }
    checks.push({ name, passed });
}

function baseState(overrides = {}) {
    return {
        mapId: 0x26,
        location: 'PLAYERS HOUSE 2F',
        coordinates: { x: 3, y: 6 },
        badgeCount: 0,
        badges: [],
        party: [],
        items: [],
        money: 3000,
        inBattle: false,
        battle: null,
        dialog: '',
        menu: { open: false, currentItem: 0, listScrollOffset: 0, screenHash: 0 },
        progressFlags: {
            followedOakIntoLab: false,
            oakAskedToChooseMon: false,
            gotStarter: false,
            battledRivalInOaksLab: false,
            gotPokeballsFromOak: false,
            gotPokedex: false,
            oakAppearedInPallet: false,
            oakGotParcel: false,
            gotOaksParcel: false,
            beatPewterGymTrainer: false,
            gotTm34: false,
            beatBrock: false,
        },
        eventBytes: new Uint8Array(16),
        ...overrides,
    };
}

function encoded(state, context = {}) {
    if (!encodeRedppStateInto || REDPP_STATE_SIZE <= 0) return null;
    const out = new Float32Array(REDPP_STATE_SIZE);
    encodeRedppStateInto(state, out, context);
    return out;
}

function differs(left, right) {
    if (!left || !right || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
        if (Math.abs(left[index] - right[index]) > 1e-7) return true;
    }
    return false;
}

const neutral = baseState();
check('state budget can represent long-horizon RAM, context and history', REDPP_STATE_SIZE >= 128);
check('objective version invalidates the one-bit v3.8 representation', /v4|v5|long-horizon/i.test(REDPP_TRAINING_OBJECTIVE_VERSION));
check('exact map id is observable independently of a display label', () => differs(
    encoded(neutral),
    encoded(baseState({ mapId: 0x25 })),
));
check('dialog identities are observable instead of one binary dialog bit', () => differs(
    encoded(baseState({ dialog: 'OAK: Choose a POKEMON.' })),
    encoded(baseState({ dialog: 'RIVAL: I will take this one!' })),
));
check('starter event is observable without inferring it from party shape', () => differs(
    encoded(neutral),
    encoded(baseState({ progressFlags: { ...neutral.progressFlags, gotStarter: true } })),
));
check('parcel event is observable without location heuristics', () => differs(
    encoded(neutral),
    encoded(baseState({ progressFlags: { ...neutral.progressFlags, gotOaksParcel: true } })),
));
check('Pokedex event is observable without location heuristics', () => differs(
    encoded(neutral),
    encoded(baseState({ progressFlags: { ...neutral.progressFlags, gotPokedex: true } })),
));
check('Brock event is observable independently of badge rendering', () => differs(
    encoded(neutral),
    encoded(baseState({ progressFlags: { ...neutral.progressFlags, beatBrock: true } })),
));
check('objective phase is derived from authoritative state', () => {
    if (typeof deriveRedppLearningPhase !== 'function') return false;
    const start = deriveRedppLearningPhase(neutral);
    const parcel = deriveRedppLearningPhase(baseState({
        mapId: 0x01,
        location: 'VIRIDIAN CITY',
        progressFlags: { ...neutral.progressFlags, gotStarter: true, gotOaksParcel: true },
    }));
    const gym = deriveRedppLearningPhase(baseState({ mapId: 0x36, location: 'PEWTER GYM' }));
    return new Set([start, parcel, gym]).size === 3;
});
check('recent action history disambiguates otherwise equal observations', () => differs(
    encoded(neutral, { recentActions: ['up', 'left', 'a', 'down'] }),
    encoded(neutral, { recentActions: ['right', 'right', 'b', 'up'] }),
));
check('map visitation context disambiguates a new tile from a loop', () => differs(
    encoded(neutral, { exploration: { currentVisits: 1, northVisits: 0, uniqueTiles: 20 } }),
    encoded(neutral, { exploration: { currentVisits: 8, northVisits: 6, uniqueTiles: 20 } }),
));
check('sequence success estimator exposes compounding imitation error', () => {
    if (typeof estimateSequenceSuccess !== 'function') return false;
    const result = estimateSequenceSuccess({ perDecisionAccuracy: 0.804, criticalDecisions: 50 });
    return result > 0 && result < 0.0001;
});

const core = new ReinforceCore({ stateSize: Math.max(2, REDPP_STATE_SIZE || 2), numActions: 7 });
const demonstrationStatus = core.getDemonstrationStatus();
check('demonstration audit reports representation collisions', 'collisionRate' in demonstrationStatus);
check('demonstration audit reports phase coverage', 'phaseCoverage' in demonstrationStatus);
check('demonstration audit has an explicit closed-loop readiness gate', 'closedLoopReady' in demonstrationStatus);
check('policy capacity is no longer the 64-unit prototype', core.hiddenSize >= 128);

const passed = checks.filter(item => item.passed).length;
const score = Number((100 * passed / checks.length).toFixed(3));
for (const item of checks) console.log(`${item.passed ? 'PASS' : 'FAIL'} ${item.name}`);
console.log(`METRIC long_horizon_autonomy_quality_pct=${score}`);
