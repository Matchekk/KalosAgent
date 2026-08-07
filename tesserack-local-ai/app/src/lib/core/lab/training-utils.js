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

/** Execute every repeat inside one policy transition so the final reward sees all state changes. */
export async function executeRepeatedAction(emulator, action, {
    actionHoldFrames,
    frameSkip,
    actionRepeat,
}) {
    const repeats = Math.max(1, Math.trunc(actionRepeat || 1));
    for (let repeat = 0; repeat < repeats; repeat++) {
        emulator.pressButton(action, actionHoldFrames);
        for (let frame = 0; frame < frameSkip; frame++) {
            emulator.runFrame();
        }
    }
}

/** Copy compatible policy weights and learning counters into a resized core. */
export function copyReinforceState(sourceCore, targetCore) {
    for (const key of ['w1', 'b1', 'w2', 'b2']) {
        const source = sourceCore.policy[key];
        const target = targetCore.policy[key];
        if (!source || !target || source.length !== target.length) {
            throw new Error(`Incompatible policy tensor: ${key}`);
        }
        target.set(source);
    }
    targetCore.trainSteps = sourceCore.trainSteps;
    targetCore.lastAvgRawReturn = sourceCore.lastAvgRawReturn;
    targetCore.lastEntropy = sourceCore.lastEntropy;
}

const POLICY_TENSORS = ['w1', 'b1', 'w2', 'b2'];

/** Serialize a REINFORCE policy into a JSON-safe, versioned snapshot. */
export function createReinforceSnapshot(core) {
    return {
        version: 1,
        architecture: {
            stateSize: core.stateSize,
            hiddenSize: core.policy.hiddenSize,
            numActions: core.numActions,
        },
        trainSteps: core.trainSteps,
        lastAvgRawReturn: core.lastAvgRawReturn,
        lastEntropy: core.lastEntropy,
        weights: Object.fromEntries(
            POLICY_TENSORS.map(key => [key, Array.from(core.policy[key])])
        ),
    };
}

/** Validate and restore a policy snapshot without partially mutating the core. */
export function restoreReinforceSnapshot(core, snapshot) {
    if (!snapshot || snapshot.version !== 1) {
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
    };
    for (const key of POLICY_TENSORS) {
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
    core.trainSteps = Number.isSafeInteger(snapshot.trainSteps) && snapshot.trainSteps >= 0
        ? snapshot.trainSteps : 0;
    core.lastAvgRawReturn = Number.isFinite(snapshot.lastAvgRawReturn)
        ? snapshot.lastAvgRawReturn : 0;
    core.lastEntropy = Number.isFinite(snapshot.lastEntropy)
        ? snapshot.lastEntropy : 0;
    return true;
}
