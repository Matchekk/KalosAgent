import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.requestAnimationFrame = callback => callback();

const { runGradientCheck, runSixActionBanditTest } = await import('../src/lib/core/lab/bandit-test.js');

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
