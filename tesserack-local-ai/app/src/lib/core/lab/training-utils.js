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

    const expectedArchitecture = {
        stateSize: core.stateSize,
        hiddenSize: core.policy.hiddenSize,
        numActions: core.numActions,
    };
    for (const [key, expected] of Object.entries(expectedArchitecture)) {
        if (snapshot.architecture?.[key] !== expected) {
            throw new Error(`Incompatible policy architecture: ${key}`);
        }
    }

    const validated = {};
    for (const key of POLICY_TENSORS) {
        const values = snapshot.weights?.[key];
        if (!Array.isArray(values) || values.length !== core.policy[key].length) {
            throw new Error(`Incompatible policy tensor: ${key}`);
        }
        if (!values.every(Number.isFinite)) {
            throw new Error(`Invalid policy tensor: ${key}`);
        }
        validated[key] = values;
    }

    for (const key of POLICY_TENSORS) core.policy[key].set(validated[key]);
    core.trainSteps = Number.isSafeInteger(snapshot.trainSteps) && snapshot.trainSteps >= 0
        ? snapshot.trainSteps : 0;
    core.lastAvgRawReturn = Number.isFinite(snapshot.lastAvgRawReturn)
        ? snapshot.lastAvgRawReturn : 0;
    core.lastEntropy = Number.isFinite(snapshot.lastEntropy)
        ? snapshot.lastEntropy : 0;
    return true;
}
