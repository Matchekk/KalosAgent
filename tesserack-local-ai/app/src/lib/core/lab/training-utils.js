/** Normalize reward events from production bundles and synthetic test envs. */
export function getPositiveRewardEventIds(events = []) {
    return events
        .filter(event => {
            if (typeof event === 'string') return !event.toLowerCase().includes('penalty');
            return event && event.tier !== 'penalty' && Number(event.reward ?? 0) > 0;
        })
        .map(event => typeof event === 'string' ? event : event.id)
        .filter(Boolean);
}

/** Label positive reward events by environment so hidden workers are explicit. */
export function formatPositiveRewardEvents(events = []) {
    return events
        .filter(event => {
            if (typeof event === 'string') return !event.toLowerCase().includes('penalty');
            return event && event.tier !== 'penalty' && Number(event.reward ?? 0) > 0;
        })
        .map(event => {
            if (typeof event === 'string') return event;
            const prefix = Number.isSafeInteger(event.workerId) ? `E${event.workerId + 1}: ` : '';
            return event.id ? `${prefix}${event.id}` : '';
        })
        .filter(Boolean);
}

/** Extract cumulative reward-bundle telemetry from an agent metrics snapshot. */
export function getRewardTelemetry(metrics = {}) {
    const stats = metrics.rewardStats || {};
    return {
        currentLocation: stats.currentLocation ?? null,
        bundleInfo: stats.bundleInfo ?? null,
        totalRewards: stats.totalRewards ?? null,
        completedObjectives: stats.completedObjectives ?? null,
        teamQuality: stats.teamQuality ?? null,
    };
}

export const GAME_INPUT_BUTTONS = Object.freeze([
    'up', 'down', 'left', 'right', 'a', 'b', 'start', 'select',
]);

function releaseGameInputs(emulator) {
    for (const button of GAME_INPUT_BUTTONS) emulator.setButton(button, false);
}

/**
 * Execute every repeat inside one policy transition so the final reward sees
 * all state changes. Training input is measured only in emulator frames:
 * wall-clock timers are throttled in hidden tabs and can otherwise leave old
 * buttons pressed while a later PPO action is sampled.
 */
export async function executeRepeatedAction(emulator, action, {
    actionHoldFrames,
    frameSkip,
    actionRepeat,
    releaseFrames = 4,
}) {
    if (!GAME_INPUT_BUTTONS.includes(action)) {
        throw new Error(`Unsupported training action: ${action}`);
    }
    if (typeof emulator?.setButton !== 'function' || typeof emulator?.runFrame !== 'function') {
        throw new Error('Training emulator requires synchronous setButton and runFrame');
    }
    const repeats = Math.max(1, Math.trunc(actionRepeat || 1));
    const framesPerRepeat = Math.max(1, Math.trunc(frameSkip || actionHoldFrames || 1));
    const requestedReleaseFrames = Math.max(1, Math.trunc(releaseFrames || 1));
    const requestedHoldFrames = Math.max(1, Math.trunc(
        actionHoldFrames || (framesPerRepeat - requestedReleaseFrames) || 1,
    ));
    const totalHoldFrames = framesPerRepeat === 1
        ? 1
        : Math.min(requestedHoldFrames, framesPerRepeat - 1);
    const totalReleaseFrames = framesPerRepeat - totalHoldFrames;

    releaseGameInputs(emulator);
    try {
        for (let repeat = 0; repeat < repeats; repeat++) {
            emulator.setButton(action, true);
            try {
                // The sampled action is the only active input during the hold
                // portion, independent of render visibility or CPU speed.
                for (let frame = 0; frame < totalHoldFrames; frame++) emulator.runFrame();
            } finally {
                emulator.setButton(action, false);
            }
            // A Game Boy input is an edge, not just a held level. Run a short
            // neutral gap inside the same transition so consecutive identical
            // samples (notably A through dialog) become distinct presses.
            for (let frame = 0; frame < totalReleaseFrames; frame++) emulator.runFrame();
        }
    } finally {
        releaseGameInputs(emulator);
    }
}

/** Copy compatible policy weights and learning counters into a resized core. */
export function copyReinforceState(sourceCore, targetCore) {
    for (const key of ['w1', 'b1', 'w2', 'b2', 'wv', 'bv']) {
        const source = sourceCore.policy[key];
        const target = targetCore.policy[key];
        if (!source && !target && ['wv', 'bv'].includes(key)) continue;
        if (!source || !target || source.length !== target.length) {
            throw new Error(`Incompatible policy tensor: ${key}`);
        }
        target.set(source);
    }
    targetCore.trainSteps = sourceCore.trainSteps;
    targetCore.lastAvgRawReturn = sourceCore.lastAvgRawReturn;
    targetCore.lastEntropy = sourceCore.lastEntropy;
    targetCore.lastEntropyCoefficient = sourceCore.lastEntropyCoefficient;
    targetCore.lastValueLoss = sourceCore.lastValueLoss;
    targetCore.lastClipFraction = sourceCore.lastClipFraction;
    if (sourceCore.policy._adamM && targetCore.policy._adamM) {
        for (const key of ['w1', 'b1', 'w2', 'b2', 'wv', 'bv']) {
            targetCore.policy._adamM[key].set(sourceCore.policy._adamM[key]);
            targetCore.policy._adamV[key].set(sourceCore.policy._adamV[key]);
        }
        targetCore.policy._adamStep = sourceCore.policy._adamStep;
    }
}

const ACTOR_TENSORS = ['w1', 'b1', 'w2', 'b2'];
const PPO_TENSORS = [...ACTOR_TENSORS, 'wv', 'bv'];

/** Serialize the policy/value network into a JSON-safe, versioned snapshot. */
export function createReinforceSnapshot(core) {
    const isPPO = core.policy.wv && core.policy.bv;
    const tensors = isPPO ? PPO_TENSORS : ACTOR_TENSORS;
    const demonstrationLength = Math.max(0, Math.trunc(core.demonstrationLength || 0));
    return {
        version: isPPO ? 2 : 1,
        algorithm: isPPO ? 'ppo-gae' : 'reinforce',
        objectiveVersion: core.trainingObjectiveVersion || null,
        architecture: {
            stateSize: core.stateSize,
            hiddenSize: core.policy.hiddenSize,
            numActions: core.numActions,
        },
        trainSteps: core.trainSteps,
        lastAvgRawReturn: core.lastAvgRawReturn,
        lastEntropy: core.lastEntropy,
        demonstrations: demonstrationLength > 0 ? {
            version: 1,
            length: demonstrationLength,
            trainSteps: core.demonstrationTrainSteps || 0,
            loss: core.lastDemonstrationLoss || 0,
            accuracy: core.lastDemonstrationAccuracy || 0,
            states: Array.from(core.demonstrationStates.subarray(
                0,
                demonstrationLength * core.stateSize,
            )),
            actions: Array.from(core.demonstrationActions.subarray(0, demonstrationLength)),
            rewards: Array.from(core.demonstrationRewards.subarray(0, demonstrationLength)),
        } : null,
        weights: Object.fromEntries(
            tensors.map(key => [key, Array.from(core.policy[key])])
        ),
    };
}

/** Validate and restore a policy snapshot without partially mutating the core. */
export function restoreReinforceSnapshot(core, snapshot) {
    if (!snapshot || ![1, 2].includes(snapshot.version)) {
        throw new Error('Unsupported policy snapshot');
    }

    const sourceStateSize = snapshot.architecture?.stateSize;
    if (!Number.isSafeInteger(sourceStateSize) || sourceStateSize <= 0 || sourceStateSize > core.stateSize) {
        throw new Error('Incompatible policy architecture: stateSize');
    }
    if (snapshot.architecture?.hiddenSize !== core.policy.hiddenSize) {
        throw new Error('Incompatible policy architecture: hiddenSize');
    }
    if (snapshot.architecture?.numActions !== core.numActions) {
        throw new Error('Incompatible policy architecture: numActions');
    }

    const validated = {};
    const expectedLengths = {
        w1: sourceStateSize * core.policy.hiddenSize,
        b1: core.policy.hiddenSize,
        w2: core.policy.hiddenSize * core.numActions,
        b2: core.numActions,
        wv: core.policy.hiddenSize,
        bv: 1,
    };
    const tensors = snapshot.version === 2 ? PPO_TENSORS : ACTOR_TENSORS;
    for (const key of tensors) {
        const values = snapshot.weights?.[key];
        if (!Array.isArray(values) || values.length !== expectedLengths[key]) {
            throw new Error(`Incompatible policy tensor: ${key}`);
        }
        if (!values.every(Number.isFinite)) {
            throw new Error(`Invalid policy tensor: ${key}`);
        }
        validated[key] = values;
    }

    // State features are only appended. Copy the old input rows verbatim and
    // initialize new rows to zero, preserving old behavior until they learn.
    core.policy.w1.fill(0);
    core.policy.w1.set(validated.w1);
    for (const key of ['b1', 'w2', 'b2']) core.policy[key].set(validated[key]);
    if (core.policy.wv) {
        core.policy.wv.fill(0);
        core.policy.bv.fill(0);
        if (snapshot.version === 2) {
            core.policy.wv.set(validated.wv);
            core.policy.bv.set(validated.bv);
        }
    }
    core.trainSteps = Number.isSafeInteger(snapshot.trainSteps) && snapshot.trainSteps >= 0
        ? snapshot.trainSteps : 0;
    core.lastAvgRawReturn = Number.isFinite(snapshot.lastAvgRawReturn)
        ? snapshot.lastAvgRawReturn : 0;
    core.lastEntropy = Number.isFinite(snapshot.lastEntropy)
        ? snapshot.lastEntropy : 0;
    const demonstrations = snapshot.demonstrations;
    if (demonstrations?.version === 1 && Number.isSafeInteger(demonstrations.length)) {
        const length = Math.min(core.demonstrationCapacity || 0, Math.max(0, demonstrations.length));
        const expectedStates = length * core.stateSize;
        if (length > 0
            && Array.isArray(demonstrations.states)
            && demonstrations.states.length >= expectedStates
            && Array.isArray(demonstrations.actions)
            && demonstrations.actions.length >= length
            && demonstrations.actions.slice(0, length).every(action =>
                Number.isSafeInteger(action) && action >= 0 && action < core.numActions)) {
            core.demonstrationStates.set(demonstrations.states.slice(0, expectedStates));
            core.demonstrationActions.set(demonstrations.actions.slice(0, length));
            if (Array.isArray(demonstrations.rewards)) {
                core.demonstrationRewards.set(demonstrations.rewards.slice(0, length));
            }
            core.demonstrationLength = length;
            core.demonstrationPosition = length % core.demonstrationCapacity;
            core.demonstrationTrainSteps = Math.max(0, Math.trunc(demonstrations.trainSteps || 0));
            core.lastDemonstrationLoss = Number(demonstrations.loss) || 0;
            core.lastDemonstrationAccuracy = Number(demonstrations.accuracy) || 0;
        }
    }
    return true;
}
