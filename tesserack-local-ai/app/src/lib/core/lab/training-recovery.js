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
