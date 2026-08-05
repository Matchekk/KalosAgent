/**
 * Six-Action Bandit Test for REINFORCE Validation
 *
 * Uses the exact Pokemon action space to validate the pipeline:
 *   ['up', 'down', 'left', 'right', 'a', 'b']
 *
 * Reward structure:
 *   - 'b' is best arm: P(reward=1) = 0.8
 *   - 'a' is worse arm: P(reward=1) = 0.2
 *   - movement actions: P(reward=1) = 0.0
 *
 * Each step is terminal (done=true) so returns-to-go = reward.
 * This cleanly validates the REINFORCE gradient pipeline.
 *
 * Uses the same RLRunner as Pokemon - no forked logic.
 */

import { ReinforceCore } from './reinforce-core.js';
import { RLRunner } from './rl-runner.js';

// -------------------------
// Deterministic RNG (for reproducibility)
// -------------------------
export function mulberry32(seed = 123456789) {
    let t = seed >>> 0;
    return function rng() {
        t += 0x6D2B79F5;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

// -------------------------
// Six-Action Bandit Environment
// -------------------------
class SixActionBanditEnv {
    constructor({ rng, pRewardByAction }) {
        this.rng = rng;
        this.pRewardByAction = pRewardByAction;

        this.ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b'];
        this.stateVec = new Float32Array(16); // Will be allocated by runner if needed

        this.lastAction = null;
        this.lastReward = 0;
        this.t = 0;
    }

    // --- Environment interface for RLRunner ---

    getState() {
        return {
            t: this.t,
            lastAction: this.lastAction,
            lastReward: this.lastReward,
            party: [{ currentHP: 1 }], // Dummy to avoid whiteout detection
        };
    }

    encodeStateInto(gameState, outVec) {
        // Bandit is stateless, but we need a non-zero input for gradients to flow
        outVec.fill(0);
        outVec[0] = 1.0; // Constant bias feature
    }

    async executeAction(actionStr) {
        this.t++;
        this.lastAction = actionStr;

        // Bernoulli reward
        const p = this.pRewardByAction[actionStr] ?? 0.0;
        this.lastReward = this.rng() < p ? 1.0 : 0.0;
    }

    rewardFn(prevState, nextState) {
        const r = nextState.lastReward ?? 0.0;
        return {
            total: r,
            breakdown: { tier1: 0, tier2: 0, tier3: r, penalties: 0 },
            firedTests: r > 0 ? ['bandit_reward'] : [],
        };
    }

    checkDone(prevState, nextState) {
        // Each step is terminal - makes returns-to-go = reward
        return true;
    }

    async resetEnv() {
        // No-op for bandit (stateless)
    }
}

// -------------------------
// Utility: Get policy probs for constant state
// -------------------------
function getPolicyProbs(core, actions) {
    const s = new Float32Array(core.stateSize);
    s.fill(0);
    s[0] = 1.0;

    const probs = core.getProbs(s);
    const out = {};
    for (let i = 0; i < actions.length; i++) {
        out[actions[i]] = probs[i];
    }
    return out;
}

// -------------------------
// Main Test Runner
// -------------------------
export async function runSixActionBanditTest({
    seed = 123,
    totalEnvSteps = 10000,
    chunkSize = 500,
    rolloutSize = 128,
    learningRate = 0.1,
    gamma = 1.0,
    normalizeReturns = false,
    logEveryUpdates = 5,
} = {}) {
    const ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b'];

    const rng = mulberry32(seed);

    // Create bandit environment
    const env = new SixActionBanditEnv({
        rng,
        pRewardByAction: {
            up: 0.0,
            down: 0.0,
            left: 0.0,
            right: 0.0,
            a: 0.2,
            b: 0.8,
        },
    });

    // Create core (pure RL algorithm)
    const core = new ReinforceCore({
        stateSize: 16,
        numActions: ACTIONS.length,
        rolloutSize,
        learningRate,
        gamma,
        normalizeReturns,
        rng, // Pass same RNG for reproducibility
    });

    // Create runner (canonical loop)
    const runner = new RLRunner(core, env);

    console.log('[BanditTest] Starting six-action bandit sanity test...');
    console.log('[BanditTest] Target: learn to favor action "b" (0.8) over "a" (0.2) and others (0.0).');
    console.log('[BanditTest] Config:', { seed, totalEnvSteps, rolloutSize, learningRate, gamma, normalizeReturns });

    let stepsDone = 0;
    let lastLoggedUpdate = -1;

    while (stepsDone < totalEnvSteps) {
        const n = Math.min(chunkSize, totalEnvSteps - stepsDone);

        for (let i = 0; i < n; i++) {
            await runner.step();
        }
        stepsDone += n;

        // Log on training updates
        const u = core.trainSteps;
        if (u !== lastLoggedUpdate && u % logEveryUpdates === 0) {
            lastLoggedUpdate = u;

            const probs = getPolicyProbs(core, ACTIONS);
            const pb = probs['b'];
            const pa = probs['a'];
            const pMove = probs['up'] + probs['down'] + probs['left'] + probs['right'];

            console.log(
                `[BanditTest] steps=${stepsDone}/${totalEnvSteps} updates=${u} ` +
                `avgReward≈${core.lastAvgRawReturn.toFixed(3)} ` +
                `entropy≈${core.lastEntropy.toFixed(3)} ` +
                `P(b)=${pb.toFixed(3)} P(a)=${pa.toFixed(3)} P(move)=${pMove.toFixed(3)}`
            );

            // Success check
            if (pb > 0.90) {
                console.log('[BanditTest] ✅ Success: P(b) > 0.90. Pipeline appears to learn correctly.');
                return { success: true, core, probs, stepsDone, updates: u };
            }
        }

        // Yield to browser UI
        await new Promise(requestAnimationFrame);
    }

    const finalProbs = getPolicyProbs(core, ACTIONS);
    const success = finalProbs['b'] > 0.7;

    console.log('[BanditTest] Finished. Final probs:', finalProbs);
    console.log(`[BanditTest] Final avgReward≈${core.lastAvgRawReturn.toFixed(3)} entropy≈${core.lastEntropy.toFixed(3)}`);
    console.log(`[BanditTest] ${success ? '✅ PASSED' : '❌ FAILED'} (P(b) = ${finalProbs['b'].toFixed(3)}, threshold: 0.7)`);

    return { success, core, probs: finalProbs, stepsDone, updates: core.trainSteps };
}

// -------------------------
// Gradient Check (finite differences)
// -------------------------
export function runGradientCheck({ eps = 1e-2, seed = 7, verbose = false } = {}) {
    const stateSize = 4;
    const numActions = 3;
    const rng = mulberry32(seed);

    const core = new ReinforceCore({
        stateSize,
        numActions,
        hiddenSize: 8,
        rng,
    });

    const policy = core.policy;

    // Random state and action
    const state = new Float32Array(stateSize);
    for (let i = 0; i < stateSize; i++) state[i] = rng();

    const actionIdx = Math.floor(rng() * numActions);
    const advantage = 1.0; // So gradient = ∇log π(a|s)

    // Objective: J(θ) = advantage * log π_θ(a|s)
    function objective() {
        const probs = policy.forward(state);
        return advantage * Math.log(probs[actionIdx] + 1e-8);
    }

    // Get analytical gradients
    const cache = policy.forwardWithCache(state);
    const acc = policy.createAccumulator();
    policy.computeGradientsInto(acc, state, actionIdx, advantage, cache);

    let maxRelError = 0;
    const errors = [];

    // Check a sample of weights
    const checkWeight = (arr, gradArr, name, indices) => {
        for (const idx of indices) {
            const original = arr[idx];

            arr[idx] = original + eps;
            const jPlus = objective();

            arr[idx] = original - eps;
            const jMinus = objective();

            arr[idx] = original;

            const numerical = (jPlus - jMinus) / (2 * eps);
            const analytical = gradArr[idx];

            const relError = Math.abs(numerical - analytical) / (Math.abs(numerical) + Math.abs(analytical) + 1e-8);
            maxRelError = Math.max(maxRelError, relError);

            if (verbose) {
                errors.push({ param: `${name}[${idx}]`, numerical, analytical, relError });
            }
        }
    };

    checkWeight(policy.w1, acc.gW1, 'W1', [0, Math.floor(policy.w1.length / 2), policy.w1.length - 1]);
    checkWeight(policy.w2, acc.gW2, 'W2', [0, Math.floor(policy.w2.length / 2), policy.w2.length - 1]);
    checkWeight(policy.b1, acc.gb1, 'b1', [0, Math.min(2, policy.b1.length - 1)]);
    checkWeight(policy.b2, acc.gb2, 'b2', [0, Math.min(2, policy.b2.length - 1)]);

    if (verbose) {
        console.log('\nGradient check results:');
        for (const e of errors) {
            const status = e.relError < 1e-4 ? 'OK' : 'FAIL';
            console.log(`  ${e.param}: numerical=${e.numerical.toExponential(4)}, analytical=${e.analytical.toExponential(4)}, relError=${e.relError.toExponential(2)} [${status}]`);
        }
    }

    // Float32 parameters and softmax arithmetic make 1e-3 the appropriate
    // finite-difference tolerance; tighter thresholds measure rounding noise.
    const success = maxRelError < 1e-3;

    if (verbose) {
        console.log(`\nGradient check ${success ? '✅ PASSED' : '❌ FAILED'}`);
        console.log(`Max relative error: ${maxRelError.toExponential(4)} (threshold: 1e-3)`);
    }

    return { success, maxRelError };
}

// -------------------------
// Run All Tests
// -------------------------
export async function runAllTests(verbose = true) {
    if (verbose) console.log('=== Running REINFORCE Validation Tests ===\n');

    if (verbose) console.log('--- Gradient Check ---');
    const gradientCheck = runGradientCheck({ verbose });

    if (verbose) console.log('\n--- Bandit Test ---');
    const banditTest = await runSixActionBanditTest({
        seed: 42,
        totalEnvSteps: 10000,
        rolloutSize: 128,
        learningRate: 0.1,
        normalizeReturns: false,
        logEveryUpdates: 10,
    });

    const allPassed = gradientCheck.success && banditTest.success;

    if (verbose) {
        console.log('\n=== Summary ===');
        console.log(`Gradient check: ${gradientCheck.success ? '✅ PASSED' : '❌ FAILED'}`);
        console.log(`Bandit test: ${banditTest.success ? '✅ PASSED' : '❌ FAILED'}`);
        console.log(`Overall: ${allPassed ? '✅ ALL PASSED' : '❌ SOME FAILED'}`);
    }

    return { gradientCheck, banditTest, allPassed };
}

export default { runSixActionBanditTest, runGradientCheck, runAllTests };
