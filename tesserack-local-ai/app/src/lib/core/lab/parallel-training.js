import { getRedppLocationProgress } from './redpp-location-data.js';
import { analyzeRedppTeam } from './redpp-team-quality.js';

/**
 * Pure coordination rules for multi-environment Red++ training.
 *
 * The policy is shared, but emulator trajectories remain distinct. Progress is
 * ranked lexicographically from authoritative RAM state; transient reward is
 * deliberately absent from checkpoint comparison.
 */

export const PARALLEL_TRAINING_DEFAULTS = Object.freeze({
    workerCount: 4,
    visibleWorker: 0,
    startWorker: 3,
    minimumIntervalMs: 8,
    backgroundTimerClampMs: 1000,
    maximumRoundsPerTick: 80,
});

export function createParallelTrainingPlan({
    workerCount = PARALLEL_TRAINING_DEFAULTS.workerCount,
    rolloutSize = 128,
} = {}) {
    const count = clampInteger(workerCount, 1, 8);
    const localRollout = clampInteger(rolloutSize, 16, 2048);
    const startWorker = count - 1;
    return Object.freeze({
        workerCount: count,
        visibleWorker: 0,
        startWorker,
        perEnvironmentRolloutSize: localRollout,
        aggregateRolloutSize: count * localRollout,
        workers: Object.freeze(Array.from({ length: count }, (_, workerId) => Object.freeze({
            workerId,
            visible: workerId === 0,
            resetFromInitial: count > 1 && workerId === startWorker,
        }))),
    });
}

export function trainingIntervalMs(speed) {
    const multiplier = Number.isFinite(Number(speed)) && Number(speed) > 0 ? Number(speed) : 1;
    return Math.max(PARALLEL_TRAINING_DEFAULTS.minimumIntervalMs, 200 / multiplier);
}

/**
 * Background tabs clamp timers to roughly one callback per second. Batch the
 * rounds that would otherwise have received their own timer so unattended
 * training keeps the selected scheduler rate without changing policy credit.
 */
export function trainingRoundsPerTick(speed, { hidden = false } = {}) {
    if (!hidden) return 1;
    const rounds = Math.ceil(PARALLEL_TRAINING_DEFAULTS.backgroundTimerClampMs / trainingIntervalMs(speed));
    return Math.max(1, Math.min(PARALLEL_TRAINING_DEFAULTS.maximumRoundsPerTick, rounds));
}

export function progressRank(state = {}) {
    const party = Array.isArray(state.party) ? state.party : [];
    const totalLevels = party.reduce((sum, pokemon) => sum + finiteNonNegative(pokemon?.level), 0);
    const teamQuality = Math.round(analyzeRedppTeam(party).score * 1000);
    const location = String(state.location || '').toUpperCase();
    return Object.freeze([
        location === 'HALL OF FAME' || location === 'CHAMPIONS ROOM' ? 1 : 0,
        finiteNonNegative(state.badgeCount),
        state.progressFlags?.battledRivalInOaksLab ? 1 : 0,
        party.length,
        getRedppLocationProgress(state.location),
        teamQuality,
        totalLevels,
    ]);
}

export function compareProgressRanks(left, right) {
    const length = Math.max(left?.length || 0, right?.length || 0);
    for (let index = 0; index < length; index++) {
        const difference = finiteNonNegative(left?.[index]) - finiteNonNegative(right?.[index]);
        if (difference !== 0) return Math.sign(difference);
    }
    return 0;
}

export function compareProgressStates(left, right) {
    return compareProgressRanks(progressRank(left), progressRank(right));
}

/** A display/storage score that preserves the lexicographic rank ordering. */
export function progressScore(state) {
    const [champion, badges, rival, partySize, locationProgress, teamQuality, totalLevels] = progressRank(state);
    return champion * 1_000_000_000_000_000
        + badges * 1_000_000_000_000
        + rival * 100_000_000_000
        + partySize * 1_000_000_000
        + Math.min(locationProgress, 999) * 1_000_000
        + Math.min(teamQuality, 999) * 1_000
        + Math.min(totalLevels, 999);
}

/**
 * Select the strongest durable checkpoint. Reward is intentionally ignored.
 * Equal progress prefers the trajectory that reached it in fewer env steps.
 */
export function chooseCheckpointCandidate(current, candidates = []) {
    let best = current || null;
    for (const candidate of candidates) {
        if (!candidate?.state) continue;
        if (!best?.state) {
            best = candidate;
            continue;
        }
        const comparison = compareProgressStates(candidate.state, best.state);
        if (comparison > 0 || (comparison === 0 && candidateSteps(candidate) < candidateSteps(best))) {
            best = candidate;
        }
    }
    return best;
}

function candidateSteps(candidate) {
    const steps = Number(candidate?.steps);
    return Number.isFinite(steps) && steps >= 0 ? steps : Number.POSITIVE_INFINITY;
}

function finiteNonNegative(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function clampInteger(value, minimum, maximum) {
    const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : minimum;
    return Math.max(minimum, Math.min(maximum, number));
}
