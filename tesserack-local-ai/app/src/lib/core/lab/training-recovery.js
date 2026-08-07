export const DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES = 160_000;

export function isFatalEmulatorError(error) {
    const message = String(error?.message ?? error ?? '');
    return /(?:Aborted\(OOM\)|out of memory|memory access out of bounds)/i.test(message);
}

export function shouldRecycleEnvironments(totalSamples, lifecycleStartSamples, limit = DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES) {
    const samples = Number(totalSamples);
    const start = Number(lifecycleStartSamples);
    const threshold = Number(limit);
    return Number.isFinite(samples)
        && Number.isFinite(start)
        && Number.isFinite(threshold)
        && threshold > 0
        && samples - start >= threshold;
}

/** Capture per-environment reward memory before replacing WASM instances. */
export function captureRewardLearningStates(agents = []) {
    return agents.map(agent => agent?.rewards?.exportLearningState?.() ?? null);
}

/** Restore reward memory before the replacement trainer starts stepping. */
export function restoreRewardLearningStates(agents = [], snapshots = []) {
    let restored = 0;
    for (let index = 0; index < agents.length; index++) {
        const snapshot = snapshots[index];
        if (!snapshot || typeof agents[index]?.rewards?.restoreLearningState !== 'function') continue;
        agents[index].rewards.restoreLearningState(snapshot);
        restored++;
    }
    return restored;
}
