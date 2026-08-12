import test from 'node:test';
import assert from 'node:assert/strict';

import {
    copyReinforceState,
    createReinforceSnapshot,
    executeRepeatedAction,
    formatPositiveRewardEvents,
    GAME_INPUT_BUTTONS,
    getPositiveRewardEventIds,
    getRewardTelemetry,
    restoreReinforceSnapshot,
} from '../src/lib/core/lab/training-utils.js';
import { ReinforceCore } from '../src/lib/core/lab/reinforce-core.js';

test('reward feed accepts production objects and synthetic string events', () => {
    assert.deepEqual(getPositiveRewardEventIds([
        { id: 'moved', reward: 0.1, tier: 1 },
        { id: 'stuck', reward: -0.5, tier: 'penalty' },
        'bandit_reward',
        'synthetic_penalty',
    ]), ['moved', 'bandit_reward']);
});

test('parallel reward feed identifies the environment that earned a reward', () => {
    assert.deepEqual(formatPositiveRewardEvents([
        { id: 'dialog_advanced', reward: 0.04, tier: 1, workerId: 2 },
        { id: 'menu_idle', reward: -0.03, tier: 'penalty', workerId: 0 },
    ]), ['E3: dialog_advanced']);
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
    const active = new Set(['left']);
    const frames = [];
    const emulator = {
        setButton(action, pressed) {
            if (pressed) active.add(action);
            else active.delete(action);
        },
        runFrame: () => frames.push([...active]),
    };

    await executeRepeatedAction(emulator, 'up', {
        actionHoldFrames: 12,
        frameSkip: 16,
        actionRepeat: 3,
        releaseFrames: 4,
    });

    assert.equal(frames.length, 48);
    assert.equal(frames.filter(buttons => buttons.length === 1 && buttons[0] === 'up').length, 36);
    assert.equal(frames.filter(buttons => buttons.length === 0).length, 12);
    assert.deepEqual([...active], []);
});

test('consecutive identical actions contain a neutral release edge', async () => {
    const active = new Set();
    const frames = [];
    const emulator = {
        setButton(action, pressed) {
            if (pressed) active.add(action);
            else active.delete(action);
        },
        runFrame: () => frames.push([...active]),
    };

    const config = { frameSkip: 2, actionRepeat: 1, releaseFrames: 2 };
    await executeRepeatedAction(emulator, 'a', config);
    await executeRepeatedAction(emulator, 'a', config);

    assert.deepEqual(frames, [['a'], [], ['a'], []]);
});

test('training releases every button even when the emulator frame throws', async () => {
    const active = new Set();
    let frames = 0;
    const emulator = {
        setButton(action, pressed) {
            if (pressed) active.add(action);
            else active.delete(action);
        },
        runFrame() {
            frames++;
            if (frames === 3) throw new Error('frame failed');
        },
    };

    await assert.rejects(executeRepeatedAction(emulator, 'a', {
        actionHoldFrames: 12,
        frameSkip: 16,
        actionRepeat: 1,
    }), /frame failed/);
    assert.deepEqual([...active], []);
});

test('training rejects unknown actions before changing emulator input', async () => {
    const calls = [];
    await assert.rejects(executeRepeatedAction({
        setButton: (...args) => calls.push(args),
        runFrame() {},
    }, 'turbo', {
        actionHoldFrames: 12,
        frameSkip: 16,
        actionRepeat: 1,
    }), /Unsupported training action/);
    assert.deepEqual(calls, []);
    assert.equal(GAME_INPUT_BUTTONS.length, 8);
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

test('policy snapshots preserve expert demonstration replay for PPO grounding', () => {
    const source = new ReinforceCore({ stateSize: 2, numActions: 2, demonstrationCapacity: 8 });
    source.observeDemonstration(new Float32Array([0.2, 0.8]), 1, 3.5, { phase: 4, correction: true });
    source.trainDemonstrations({ epochs: 1 });
    const target = new ReinforceCore({ stateSize: 2, numActions: 2, demonstrationCapacity: 8 });

    assert.equal(restoreReinforceSnapshot(target, createReinforceSnapshot(source)), true);
    assert.equal(target.demonstrationLength, 1);
    assert.deepEqual([...target.demonstrationStates.subarray(0, 2)], [0.20000000298023224, 0.800000011920929]);
    assert.equal(target.demonstrationActions[0], 1);
    assert.equal(target.demonstrationRewards[0], 3.5);
    assert.equal(target.demonstrationPhases[0], 4);
    assert.equal(target.demonstrationKinds[0], 1);
    assert.equal(target.getDemonstrationStatus().correctionSamples, 1);
    assert.equal(target.demonstrationTrainSteps, 1);
});

test('policy snapshot migration preserves old input rows and zeros appended features', () => {
    const source = {
        stateSize: 2,
        numActions: 2,
        policy: {
            hiddenSize: 1,
            w1: new Float32Array([1, 2]), b1: new Float32Array([3]),
            w2: new Float32Array([4, 5]), b2: new Float32Array([6, 7]),
        },
        trainSteps: 11,
        lastAvgRawReturn: 2,
        lastEntropy: 0.4,
    };
    const target = {
        stateSize: 4,
        numActions: 2,
        policy: {
            hiddenSize: 1,
            w1: new Float32Array([9, 9, 9, 9]), b1: new Float32Array(1),
            w2: new Float32Array(2), b2: new Float32Array(2),
        },
    };

    assert.equal(restoreReinforceSnapshot(target, createReinforceSnapshot(source)), true);
    assert.deepEqual([...target.policy.w1], [1, 2, 0, 0]);
    assert.equal(target.trainSteps, 11);
});
