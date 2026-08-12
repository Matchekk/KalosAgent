// A four-environment Red++ session consistently exhausted the browser WASM
// heap at roughly 6,400 lifecycle samples. Rotate with enough margin to finish
// the frozen evaluator's 1,200-step budget (5,000 / 3 = 1,666 learning rounds),
// while rebuilding before the observed failure window.
export const DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES = 5_000;

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

/** Preserve monotonic run telemetry while scheduled WASM instances rotate. */
export function captureTrainingProgress(coordinator) {
    const agents = Array.isArray(coordinator?.agents) ? coordinator.agents : [];
    return {
        version: 2,
        checkpointCount: Math.max(1, finiteCounter(coordinator?.checkpointCount)),
        confirmedWins: agents.reduce((sum, agent) => sum + finiteCounter(agent?.confirmedWins), 0),
        autonomousProgress: coordinator?.exportAutonomousProgress?.() ?? null,
    };
}

/**
 * Restore counters onto a freshly-created coordinator without duplicating
 * them when recovery is retried. The visible agent owns the retained aggregate
 * so the coordinator's existing sum-based telemetry remains unchanged.
 */
export function restoreTrainingProgress(coordinator, snapshot) {
    if (!coordinator || ![1, 2].includes(snapshot?.version)) return false;
    const agents = Array.isArray(coordinator.agents) ? coordinator.agents : [];
    const visibleWorker = Math.max(0, Math.min(agents.length - 1,
        finiteCounter(coordinator.visibleWorker)));
    const checkpointCount = Math.max(1, finiteCounter(snapshot.checkpointCount));
    const confirmedWins = finiteCounter(snapshot.confirmedWins);

    coordinator.checkpointCount = Math.max(
        finiteCounter(coordinator.checkpointCount),
        checkpointCount,
    );
    if (agents.length > 0) {
        const currentWins = agents.reduce((sum, agent) => sum + finiteCounter(agent?.confirmedWins), 0);
        agents[visibleWorker].confirmedWins = finiteCounter(agents[visibleWorker].confirmedWins)
            + Math.max(0, confirmedWins - currentWins);
        agents[visibleWorker].checkpointCount = Math.max(
            finiteCounter(agents[visibleWorker].checkpointCount),
            coordinator.checkpointCount,
        );
    }
    if (snapshot.version >= 2 && snapshot.autonomousProgress) {
        coordinator.restoreAutonomousProgress?.(snapshot.autonomousProgress);
    }
    return true;
}

function finiteCounter(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}
