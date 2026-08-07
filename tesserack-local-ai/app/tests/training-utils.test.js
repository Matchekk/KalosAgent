import test from 'node:test';
import assert from 'node:assert/strict';

import {
    copyReinforceState,
    createReinforceSnapshot,
    executeRepeatedAction,
    getPositiveRewardEventIds,
    getRewardTelemetry,
    restoreReinforceSnapshot,
} from '../src/lib/core/lab/training-utils.js';

test('reward feed accepts production objects and synthetic string events', () => {
    assert.deepEqual(getPositiveRewardEventIds([
        { id: 'moved', reward: 0.1, tier: 1 },
        { id: 'stuck', reward: -0.5, tier: 'penalty' },
        'bandit_reward',
        'synthetic_penalty',
    ]), ['moved', 'bandit_reward']);
});

test('rollout resize preserves lowercase policy tensors and learning metrics', () => {
    const source = {
        policy: { w1: new Float32Array([1, 2]), b1: new Float32Array([3]), w2: new Float32Array([4, 5]), b2: new Float32Array([6]) },
        trainSteps: 7,
        lastAvgRawReturn: 1.25,
        lastEntropy: 0.75,
    };
    const target = {
        policy: { w1: new Float32Array(2), b1: new Float32Array(1), w2: new Float32Array(2), b2: new Float32Array(1) },
        trainSteps: 0,
        lastAvgRawReturn: 0,
        lastEntropy: 0,
    };

    copyReinforceState(source, target);

    assert.deepEqual([...target.policy.w1], [1, 2]);
    assert.deepEqual([...target.policy.w2], [4, 5]);
    assert.equal(target.trainSteps, 7);
    assert.equal(target.lastAvgRawReturn, 1.25);
    assert.equal(target.lastEntropy, 0.75);
});

test('action repetition stays inside one observable environment transition', async () => {
    const pressed = [];
    let frames = 0;
    const emulator = {
        pressButton: (action, holdFrames) => pressed.push([action, holdFrames]),
        runFrame: () => frames++,
    };

    await executeRepeatedAction(emulator, 'up', {
        actionHoldFrames: 12,
        frameSkip: 16,
        actionRepeat: 3,
    });

    assert.deepEqual(pressed, [['up', 12], ['up', 12], ['up', 12]]);
    assert.equal(frames, 48);
});

test('reward telemetry forwards cumulative bundle statistics', () => {
    const totalRewards = { tier1: 1, tier2: 2, tier3: 3, penalties: -1, total: 5 };
    assert.deepEqual(getRewardTelemetry({ rewardStats: {
        currentLocation: 'PALLET TOWN',
        bundleInfo: { testCount: 15, penaltyCount: 2 },
        totalRewards,
        teamQuality: { score: 0.75 },
        completedObjectives: ['got_starter_pokemon'],
    } }), {
        currentLocation: 'PALLET TOWN',
        bundleInfo: { testCount: 15, penaltyCount: 2 },
        totalRewards,
        teamQuality: { score: 0.75 },
        completedObjectives: ['got_starter_pokemon'],
    });
});

test('policy snapshots round-trip after strict validation', () => {
    const makeCore = () => ({
        stateSize: 2,
        numActions: 2,
        policy: {
            hiddenSize: 1,
            w1: new Float32Array([1, 2]), b1: new Float32Array([3]),
            w2: new Float32Array([4, 5]), b2: new Float32Array([6, 7]),
        },
        trainSteps: 9,
        lastAvgRawReturn: 1.5,
        lastEntropy: 0.25,
    });
    const source = makeCore();
    const snapshot = createReinforceSnapshot(source);
    const target = makeCore();
    for (const tensor of Object.values(target.policy).filter(ArrayBuffer.isView)) tensor.fill(0);

    assert.equal(restoreReinforceSnapshot(target, snapshot), true);
    assert.deepEqual([...target.policy.w2], [4, 5]);
    assert.equal(target.trainSteps, 9);

    const invalid = structuredClone(snapshot);
    invalid.weights.w1[0] = Number.NaN;
    assert.throws(() => restoreReinforceSnapshot(target, invalid), /Invalid policy tensor/);
    assert.deepEqual([...target.policy.w1], [1, 2]);
});
