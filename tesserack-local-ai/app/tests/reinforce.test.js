import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.requestAnimationFrame = callback => callback();

const { runGradientCheck, runSixActionBanditTest } = await import('../src/lib/core/lab/bandit-test.js');
const { adaptiveEntropyCoefficient } = await import('../src/lib/core/lab/reinforce-core.js');

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

test('REINFORCE analytical gradient matches Float32 finite differences', () => {
    const result = runGradientCheck();
    assert.equal(result.success, true, `max relative error: ${result.maxRelError}`);
});

test('seeded REINFORCE learns the rewarding action reproducibly', async () => {
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
