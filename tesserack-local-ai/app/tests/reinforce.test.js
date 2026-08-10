import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.requestAnimationFrame = callback => callback();

const { runGradientCheck, runSixActionBanditTest } = await import('../src/lib/core/lab/bandit-test.js');
const {
    ReinforceCore,
    adaptiveEntropyCoefficient,
    adaptiveCoverageCoefficient,
    normalizeAdvantagesByStream,
} = await import('../src/lib/core/lab/reinforce-core.js');
const { SimplePolicy } = await import('../src/lib/core/lab/simple-policy.js');

test('adaptive entropy pressure is bounded and activates only below target', () => {
    const config = {
        numActions: 7,
        baseCoefficient: 0.01,
        maxCoefficient: 0.15,
        targetRatio: 0.75,
    };
    const maximumEntropy = Math.log(config.numActions);
    assert.equal(adaptiveEntropyCoefficient({ ...config, entropy: maximumEntropy }), 0.01);
    assert.equal(adaptiveEntropyCoefficient({ ...config, entropy: 0 }), 0.15);

    const collapsed = adaptiveEntropyCoefficient({ ...config, entropy: 0.511 });
    assert.ok(collapsed > 0.09 && collapsed < 0.11, `coefficient was ${collapsed}`);
    assert.equal(adaptiveEntropyCoefficient({
        ...config,
        entropy: 0,
        targetRatio: 0,
    }), 0.01, 'generic REINFORCE consumers remain fixed-coefficient by default');
});

test('Red++ entropy controller responds early to a directional-policy collapse', () => {
    const config = {
        numActions: 7,
        baseCoefficient: 0.01,
        maxCoefficient: 0.15,
        targetRatio: 0.75,
        responseGain: 4,
    };
    const targetEntropy = config.targetRatio * Math.log(config.numActions);
    const atTarget = adaptiveEntropyCoefficient({ ...config, entropy: targetEntropy });
    const observedHardstuck = adaptiveEntropyCoefficient({ ...config, entropy: 1.322 });
    const fullyCollapsed = adaptiveEntropyCoefficient({ ...config, entropy: 0 });

    assert.ok(Math.abs(atTarget - config.baseCoefficient) < 1e-12);
    assert.ok(observedHardstuck > 0.05 && observedHardstuck < 0.07,
        `hardstuck coefficient was ${observedHardstuck}`);
    assert.ok(Math.abs(fullyCollapsed - config.maxCoefficient) < 1e-12);
});

test('Red++ action coverage reacts to a starved action without affecting healthy policies', () => {
    const config = { coefficient: 0.05, minimumProbability: 0.05 };
    assert.equal(adaptiveCoverageCoefficient({
        ...config,
        probabilities: [0.14, 0.15, 0.13, 0.16, 0.14, 0.13, 0.15],
    }), 0);

    const observed = adaptiveCoverageCoefficient({
        ...config,
        probabilities: [0.32, 0.25, 0.18, 0.12, 0.08, 0.04, 0.01],
    });
    assert.ok(Math.abs(observed - 0.04) < 1e-12, `coverage coefficient was ${observed}`);
    assert.equal(adaptiveCoverageCoefficient({
        ...config,
        probabilities: [0.4, 0.3, 0.2, 0.09, 0.01, 0, 0],
    }), 0.05);
});

test('reverse-KL coverage gives an almost-dead action a non-vanishing logit gradient', () => {
    const policy = new SimplePolicy(1, 1, 3, () => 0.5);
    const accumulator = policy.createAccumulator();
    const state = new Float32Array([0]);
    const cache = {
        hiddenPreRelu: new Float32Array([0]),
        hidden: new Float32Array([0]),
        probs: new Float32Array([0.8, 0.199999, 0.000001]),
    };
    policy.computeGradientsInto(accumulator, state, 0, 0, cache, 0, 0.05);

    assert.ok(accumulator.gb2[2] > 0.016, `starved-action gradient was ${accumulator.gb2[2]}`);
    assert.ok(accumulator.gb2[0] < 0, 'dominant action must give probability back');
    const gradientSum = accumulator.gb2[0] + accumulator.gb2[1] + accumulator.gb2[2];
    assert.ok(Math.abs(gradientSum) < 1e-7, `coverage gradient sum was ${gradientSum}`);
});

test('policy gradient matches Float32 finite differences', () => {
    const result = runGradientCheck();
    assert.equal(result.success, true, `relative=${result.maxRelError}, absolute=${result.maxAbsError}`);
    assert.ok(result.maxAbsError < 1e-5);
});

test('seeded policy learns the rewarding action reproducibly', async () => {
    const options = {
        seed: 42,
        totalEnvSteps: 10000,
        chunkSize: 1000,
        rolloutSize: 128,
        learningRate: 0.1,
        normalizeReturns: false,
        logEveryUpdates: 1000,
    };
    const first = await runSixActionBanditTest(options);
    const second = await runSixActionBanditTest(options);

    assert.equal(first.success, true);
    assert.ok(first.probs.b > 0.7, `P(b) was ${first.probs.b}`);
    assert.deepEqual(first.probs, second.probs);
});

test('novelty is bounded and decays both within and across episodes', () => {
    const core = new ReinforceCore({
        stateSize: 1,
        numActions: 2,
        rolloutSize: 8,
        intrinsicRewardScale: 0.04,
        intrinsicRewardCap: 0.04,
    });
    const state = new Float32Array([0.5]);
    core.observe(state, 0, 0, false, 0, 0);
    core.observe(state, 0, 0, false, 0, 0);
    core.observe(state, 0, 0, true, 0, 0);
    core.observe(state, 0, 0, false, 0, 0);

    assert.ok(Math.abs(core.buffer.intrinsicRewards[0] - 0.04) < 1e-7);
    assert.ok(core.buffer.intrinsicRewards[1] < core.buffer.intrinsicRewards[0]);
    assert.ok(core.buffer.intrinsicRewards[2] < core.buffer.intrinsicRewards[1]);
    assert.ok(core.buffer.intrinsicRewards[3] < core.buffer.intrinsicRewards[0]);
});

test('familiar states retain bounded episodic novelty without enabling same-episode farming', () => {
    const core = new ReinforceCore({
        stateSize: 1,
        numActions: 2,
        rolloutSize: 128,
        intrinsicRewardScale: 0.01,
        intrinsicRewardCap: 0.02,
        intrinsicLifelongFloor: 0.25,
    });
    const state = new Float32Array([0.5]);
    for (let episode = 0; episode < 64; episode++) {
        core.observe(state, 0, 0, true, 0, 0, 0, 0, 'known-route-cell');
    }
    const firstVisit = core.buffer.intrinsicRewards[63];
    core.observe(state, 0, 0, false, 0, 0, 0, 0, 'known-route-cell');
    core.observe(state, 0, 0, false, 0, 0, 0, 0, 'known-route-cell');
    const repeatedVisit = core.buffer.intrinsicRewards[65];

    assert.ok(firstVisit >= 0.0025 && firstVisit <= 0.01, `first visit bonus was ${firstVisit}`);
    assert.ok(repeatedVisit < firstVisit, 'same-episode repetition must still decay');
});

test('advantages are normalized independently for heterogeneous environment streams', () => {
    const advantages = new Float32Array([100, 200, 1, 2]);
    const streams = new Uint8Array([0, 0, 1, 1]);
    normalizeAdvantagesByStream(advantages, streams, advantages.length);

    assert.deepEqual([...advantages].map(value => Math.round(value)), [-1, 1, -1, 1]);
});

test('GAE bootstraps truncations but never crosses terminal boundaries', () => {
    const core = new ReinforceCore({
        stateSize: 1,
        numActions: 2,
        rolloutSize: 3,
        gamma: 0.9,
        gaeLambda: 1,
        intrinsicRewardScale: 0,
        normalizeReturns: false,
    });
    const state = new Float32Array([0]);
    core.observe(state, 0, 1, false, 0, 0, 0.5, 0.75);
    core.observe(state, 0, 2, true, 0, 0, 0.75, 99);
    core._computeGAE(2);

    assert.ok(Math.abs(core._advantages[1] - 1.25) < 1e-6);
    assert.ok(Math.abs(core._advantages[0] - 2.3) < 1e-6);
});
