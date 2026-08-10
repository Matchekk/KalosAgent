import assert from 'node:assert/strict';
import test from 'node:test';

import {
    captureRewardLearningStates,
    captureTrainingProgress,
    DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES,
    isFatalEmulatorError,
    restoreRewardLearningStates,
    restoreTrainingProgress,
    shouldRecycleEnvironments,
} from '../src/lib/core/lab/training-recovery.js';

test('recognizes fatal WASM memory failures', () => {
    assert.equal(isFatalEmulatorError(new Error('Aborted(OOM). Build with -sASSERTIONS')), true);
    assert.equal(isFatalEmulatorError(new WebAssembly.RuntimeError('memory access out of bounds')), true);
    assert.equal(isFatalEmulatorError(new Error('State size mismatch')), false);
});

test('recycles only after the per-lifecycle sample budget', () => {
    assert.equal(DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES, 5_000,
        'rotation must precede the observed ~6,400-sample WASM failure window');
    assert.equal(shouldRecycleEnvironments(DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES - 1, 0), false);
    assert.equal(shouldRecycleEnvironments(DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES, 0), true);
    assert.equal(shouldRecycleEnvironments(410_000, 250_000), true);
    assert.equal(shouldRecycleEnvironments(10, 20), false);
});

test('WASM rotation transfers each environment reward memory before training resumes', () => {
    const sourceAgents = [0, 1, 2, 3].map(workerId => ({
        rewards: { exportLearningState: () => ({ version: 1, workerId }) },
    }));
    const restored = [];
    const targetAgents = [0, 1, 2, 3].map(workerId => ({
        rewards: { restoreLearningState: snapshot => restored.push({ workerId, snapshot }) },
    }));

    const snapshots = captureRewardLearningStates(sourceAgents);
    assert.equal(restoreRewardLearningStates(targetAgents, snapshots), 4);
    assert.deepEqual(restored, [0, 1, 2, 3].map(workerId => ({
        workerId,
        snapshot: { version: 1, workerId },
    })));
});

test('WASM rotation preserves monotonic checkpoints and confirmed wins', () => {
    const before = {
        checkpointCount: 5,
        visibleWorker: 0,
        agents: [
            { checkpointCount: 5, confirmedWins: 2 },
            { checkpointCount: 1, confirmedWins: 3 },
            { checkpointCount: 1, confirmedWins: 0 },
            { checkpointCount: 1, confirmedWins: 1 },
        ],
        exportAutonomousProgress: () => ({ version: 1, freshBestLevel: 5 }),
    };
    const snapshot = captureTrainingProgress(before);
    assert.deepEqual(snapshot, {
        version: 2,
        checkpointCount: 5,
        confirmedWins: 6,
        autonomousProgress: { version: 1, freshBestLevel: 5 },
    });

    const after = {
        checkpointCount: 1,
        visibleWorker: 0,
        agents: [
            { checkpointCount: 1, confirmedWins: 0 },
            { checkpointCount: 1, confirmedWins: 0 },
            { checkpointCount: 1, confirmedWins: 0 },
            { checkpointCount: 1, confirmedWins: 0 },
        ],
        restoreAutonomousProgress(value) { this.restoredAutonomy = value; },
    };
    assert.equal(restoreTrainingProgress(after, snapshot), true);
    assert.equal(after.checkpointCount, 5);
    assert.equal(after.agents[0].checkpointCount, 5);
    assert.equal(after.agents.reduce((sum, agent) => sum + agent.confirmedWins, 0), 6);
    assert.deepEqual(after.restoredAutonomy, { version: 1, freshBestLevel: 5 });

    restoreTrainingProgress(after, snapshot);
    assert.equal(after.agents.reduce((sum, agent) => sum + agent.confirmedWins, 0), 6,
        'retrying recovery must not duplicate wins');
});
