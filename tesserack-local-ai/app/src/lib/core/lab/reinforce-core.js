/**
 * ReinforceCore - Pure REINFORCE algorithm (no env knowledge)
 *
 * Layer A of the hybrid architecture:
 *   - Policy forward / sample
 *   - Buffer push
 *   - Compute returns/advantages
 *   - Accumulate gradients
 *   - Apply update
 *
 * Does NOT import emulator, memory, UI, or any env-specific code.
 * Can be unit tested with pure arrays.
 */

import { RolloutBuffer } from './rollout-buffer.js';
import { SimplePolicy } from './simple-policy.js';

export class ReinforceCore {
    /**
     * @param {Object} config
     * @param {number} config.stateSize - Dimension of state vector (default: 16)
     * @param {number} config.numActions - Number of actions (default: 6)
     * @param {number} config.hiddenSize - Hidden layer size (default: 64)
     * @param {number} config.rolloutSize - Steps per update (default: 128)
     * @param {number} config.learningRate - Learning rate (default: 0.001)
     * @param {number} config.gamma - Discount factor (default: 0.99)
     * @param {boolean} config.normalizeReturns - Normalize advantages (default: true)
     * @param {Function} config.rng - Random number generator (default: Math.random)
     */
    constructor(config = {}) {
        this.stateSize = config.stateSize ?? 16;
        this.numActions = config.numActions ?? 6;
        this.hiddenSize = config.hiddenSize ?? 64;
        this.rolloutSize = config.rolloutSize ?? 128;
        this.learningRate = config.learningRate ?? 0.001;
        this.gamma = config.gamma ?? 0.99;
        this.normalizeReturns = config.normalizeReturns ?? true;
        this.rng = config.rng ?? Math.random;

        // Policy network
        this.policy = new SimplePolicy(this.stateSize, this.hiddenSize, this.numActions, this.rng);

        // Experience buffer
        this.buffer = new RolloutBuffer(this.rolloutSize, this.stateSize);

        // Gradient accumulator (reused to avoid GC)
        this.gradAcc = this.policy.createAccumulator();

        // Scratch arrays for returns computation
        this._returns = new Float32Array(this.rolloutSize);
        this._advantages = new Float32Array(this.rolloutSize);

        // Metrics
        this.trainSteps = 0;
        this.lastAvgRawReturn = 0;
        this.lastEntropy = 0;
    }

    /**
     * Choose action from policy (on-policy sampling, no epsilon)
     * @param {Float32Array} stateVec - Encoded state vector
     * @returns {{ actionIdx: number, logProb: number }}
     */
    act(stateVec) {
        const cache = this.policy.forwardWithCache(stateVec);
        const probs = cache.probs;

        // Sample from categorical distribution
        const r = this.rng();
        let cumulative = 0;
        let actionIdx = probs.length - 1; // fallback
        for (let i = 0; i < probs.length; i++) {
            cumulative += probs[i];
            if (r < cumulative) {
                actionIdx = i;
                break;
            }
        }

        const logProb = Math.log(probs[actionIdx] + 1e-8);

        return { actionIdx, logProb };
    }

    /**
     * Store transition in buffer
     * @param {Float32Array} stateVec - State at time of action
     * @param {number} actionIdx - Action taken
     * @param {number} reward - Reward received
     * @param {boolean} done - Episode ended
     * @param {number} logProb - Log probability of action
     */
    observe(stateVec, actionIdx, reward, done, logProb) {
        this.buffer.push(stateVec, actionIdx, reward, logProb, done);
    }

    /**
     * Check if buffer is full and training should occur
     * @returns {boolean}
     */
    shouldTrain() {
        return this.buffer.isFull();
    }

    /**
     * Compute discounted returns-to-go, respecting episode boundaries
     * @private
     */
    _computeReturns() {
        const returns = this._returns;
        let R = 0;

        for (let t = this.buffer.length - 1; t >= 0; t--) {
            // Reset return at episode boundary
            if (this.buffer.dones[t]) {
                R = 0;
            }
            R = this.buffer.rewards[t] + this.gamma * R;
            returns[t] = R;
        }

        return returns;
    }

    /**
     * Train on collected rollout - ONE gradient update
     * @returns {{ avgRawReturn: number, entropy: number, trainSteps: number }}
     */
    train() {
        const n = this.buffer.length;
        if (n === 0) {
            return { avgRawReturn: 0, entropy: 0, trainSteps: this.trainSteps };
        }

        // 1. Compute raw returns
        const rawReturns = this._computeReturns();

        // Track raw metrics before normalization
        let sumRawReturns = 0;
        for (let i = 0; i < n; i++) {
            sumRawReturns += rawReturns[i];
        }
        const avgRawReturn = sumRawReturns / n;
        this.lastAvgRawReturn = avgRawReturn;

        // 2. Compute advantages (optionally normalize)
        const advantages = this._advantages;
        if (this.normalizeReturns) {
            const mean = sumRawReturns / n;
            let variance = 0;
            for (let i = 0; i < n; i++) {
                variance += (rawReturns[i] - mean) ** 2;
            }
            const std = Math.sqrt(variance / n) + 1e-8;
            for (let i = 0; i < n; i++) {
                advantages[i] = (rawReturns[i] - mean) / std;
            }
        } else {
            // Use raw returns as advantages
            for (let i = 0; i < n; i++) {
                advantages[i] = rawReturns[i];
            }
        }

        // 3. Zero gradient accumulator
        this.policy.zeroAccumulator(this.gradAcc);

        // 4. Accumulate gradients + compute entropy
        let entropySum = 0;
        for (let t = 0; t < n; t++) {
            // Get state from flat buffer
            const stateOffset = this.buffer.stateOffset(t);
            const stateVec = this.buffer.states.subarray(stateOffset, stateOffset + this.stateSize);

            const actionIdx = this.buffer.actions[t];
            const advantage = advantages[t];

            // Forward pass with cache
            const cache = this.policy.forwardWithCache(stateVec);

            // Compute entropy: -Σ p log p
            for (let i = 0; i < cache.probs.length; i++) {
                if (cache.probs[i] > 1e-8) {
                    entropySum -= cache.probs[i] * Math.log(cache.probs[i]);
                }
            }

            // Accumulate gradients
            this.policy.computeGradientsInto(this.gradAcc, stateVec, actionIdx, advantage, cache);
        }

        const entropy = entropySum / n;
        this.lastEntropy = entropy;

        // 5. Average gradients over rollout
        const acc = this.gradAcc;
        for (let i = 0; i < acc.gW1.length; i++) acc.gW1[i] /= n;
        for (let i = 0; i < acc.gb1.length; i++) acc.gb1[i] /= n;
        for (let i = 0; i < acc.gW2.length; i++) acc.gW2[i] /= n;
        for (let i = 0; i < acc.gb2.length; i++) acc.gb2[i] /= n;

        // 6. Apply ONE gradient update
        this.policy.applyGradients(acc, this.learningRate);

        this.trainSteps++;

        // 7. Clear buffer
        this.buffer.clear();

        return { avgRawReturn, entropy, trainSteps: this.trainSteps };
    }

    /**
     * Get policy probabilities for a state (useful for debugging/UI)
     * @param {Float32Array} stateVec
     * @returns {Float32Array}
     */
    getProbs(stateVec) {
        return this.policy.forward(stateVec);
    }

    /**
     * Get current buffer fill level
     * @returns {{ length: number, capacity: number }}
     */
    getBufferStatus() {
        return {
            length: this.buffer.length,
            capacity: this.rolloutSize,
        };
    }
}

export default ReinforceCore;
