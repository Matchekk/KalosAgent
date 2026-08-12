/**
 * Simple Policy Network - 2-layer MLP with forward cache and in-place gradients
 *
 * Optimized for browser: reuses scratch arrays, no GC pressure during training.
 */

export class SimplePolicy {
    constructor(stateSize = 16, hiddenSize = 128, outputSize = 6, rng = Math.random) {
        this.stateSize = stateSize;
        this.hiddenSize = hiddenSize;
        this.outputSize = outputSize;
        this.rng = rng;

        // Network weights (Xavier initialization)
        this.w1 = new Float32Array(stateSize * hiddenSize);
        this.b1 = new Float32Array(hiddenSize);
        this.w2 = new Float32Array(hiddenSize * outputSize);
        this.b2 = new Float32Array(outputSize);
        this.wv = new Float32Array(hiddenSize);
        this.bv = new Float32Array(1);

        this._initWeights();

        // Scratch arrays for forward pass (reused to avoid GC)
        this._hiddenPreRelu = new Float32Array(hiddenSize);
        this._hidden = new Float32Array(hiddenSize);
        this._logits = new Float32Array(outputSize);
        this._probs = new Float32Array(outputSize);

        // Scratch arrays for backward pass
        this._dLogits = new Float32Array(outputSize);
        this._dHidden = new Float32Array(hiddenSize);

        // Adam state. Keeping it beside the tensors makes optimizer updates
        // allocation-free and lets the browser train for days without SGD
        // oscillation from sparse, differently-scaled rewards.
        this._adamStep = 0;
        this._adamM = {};
        this._adamV = {};
        for (const key of ['w1', 'b1', 'w2', 'b2', 'wv', 'bv']) {
            this._adamM[key] = new Float32Array(this[key].length);
            this._adamV[key] = new Float32Array(this[key].length);
        }
    }

    _initWeights() {
        // Xavier/Glorot initialization
        const scale1 = Math.sqrt(2.0 / (this.stateSize + this.hiddenSize));
        const scale2 = Math.sqrt(2.0 / (this.hiddenSize + this.outputSize));

        for (let i = 0; i < this.w1.length; i++) {
            this.w1[i] = (this.rng() * 2 - 1) * scale1;
        }
        for (let i = 0; i < this.w2.length; i++) {
            this.w2[i] = (this.rng() * 2 - 1) * scale2;
        }
        const valueScale = Math.sqrt(2.0 / (this.hiddenSize + 1));
        for (let i = 0; i < this.wv.length; i++) {
            this.wv[i] = (this.rng() * 2 - 1) * valueScale;
        }
        // Biases start at 0
        this.b1.fill(0);
        this.b2.fill(0);
    }

    /**
     * Forward pass returning just probabilities (for action selection)
     * @param {Float32Array} stateVec
     * @returns {Float32Array} action probabilities
     */
    forward(stateVec) {
        const { probs } = this.forwardWithCache(stateVec);
        // Return a copy to avoid mutation issues
        return new Float32Array(probs);
    }

    /**
     * Forward pass with cache for gradient computation
     * Returns intermediate values needed for backprop
     * @param {Float32Array} stateVec
     * @returns {{ hiddenPreRelu: Float32Array, hidden: Float32Array, logits: Float32Array, probs: Float32Array }}
     */
    forwardWithCache(stateVec) {
        const hiddenPreRelu = this._hiddenPreRelu;
        const hidden = this._hidden;
        const logits = this._logits;
        const probs = this._probs;

        // Hidden layer: ReLU(stateVec * W1 + b1)
        for (let j = 0; j < this.hiddenSize; j++) {
            let sum = this.b1[j];
            for (let i = 0; i < this.stateSize; i++) {
                sum += stateVec[i] * this.w1[i * this.hiddenSize + j];
            }
            hiddenPreRelu[j] = sum;
            hidden[j] = sum > 0 ? sum : 0.05 * sum; // Leaky ReLU avoids dead sparse-state features.
        }

        // Output layer: softmax(hidden * W2 + b2)
        let maxLogit = -Infinity;
        for (let j = 0; j < this.outputSize; j++) {
            let sum = this.b2[j];
            for (let i = 0; i < this.hiddenSize; i++) {
                sum += hidden[i] * this.w2[i * this.outputSize + j];
            }
            logits[j] = sum;
            maxLogit = Math.max(maxLogit, sum);
        }

        // Softmax with numerical stability
        let sumExp = 0;
        for (let j = 0; j < this.outputSize; j++) {
            probs[j] = Math.exp(logits[j] - maxLogit);
            sumExp += probs[j];
        }
        for (let j = 0; j < this.outputSize; j++) {
            probs[j] /= sumExp;
        }

        // Return views into scratch arrays (caller must not hold references)
        let value = this.bv[0];
        for (let i = 0; i < this.hiddenSize; i++) value += hidden[i] * this.wv[i];

        return { hiddenPreRelu, hidden, logits, probs, value };
    }

    /**
     * Compute gradients and accumulate INTO provided accumulator (in-place)
     * No allocations, writes directly into acc.
     *
     * @param {Object} acc - Gradient accumulator { gW1, gb1, gW2, gb2 }
     * @param {Float32Array} stateVec - Input state
     * @param {number} actionIdx - Chosen action
     * @param {number} advantage - Advantage value (normalized return)
     * @param {Object} cache - Forward pass cache { hiddenPreRelu, hidden, probs }
     */
    computeGradientsInto(
        acc,
        stateVec,
        actionIdx,
        advantage,
        cache,
        entropyCoefficient = 0,
        coverageCoefficient = 0,
    ) {
        const { hiddenPreRelu, hidden, probs } = cache;
        const dLogits = this._dLogits;
        const dHidden = this._dHidden;

        // Clip advantage to prevent instability from reward spikes
        const clippedAdv = Math.max(-5, Math.min(5, advantage));

        // Gradient of log π(a|s) w.r.t. logits
        // For softmax: ∂log π(a)/∂logit_j = 1{j=a} - π(j)
        let entropy = 0;
        for (let j = 0; j < this.outputSize; j++) {
            if (probs[j] > 1e-8) entropy -= probs[j] * Math.log(probs[j]);
        }
        for (let j = 0; j < this.outputSize; j++) {
            const policySignal = clippedAdv * (((j === actionIdx) ? 1 : 0) - probs[j]);
            const entropySignal = entropyCoefficient > 0
                ? -entropyCoefficient * probs[j] * (Math.log(probs[j] + 1e-8) + entropy)
                : 0;
            // Maximise mean(log pi(a)) under a uniform reference distribution.
            // This is -KL(U || pi), whose logit gradient is U - pi. Unlike
            // Shannon entropy, it does not vanish for an almost-dead action.
            const coverageSignal = coverageCoefficient > 0
                ? coverageCoefficient * ((1 / this.outputSize) - probs[j])
                : 0;
            dLogits[j] = policySignal + entropySignal + coverageSignal;
        }

        // Gradient for W2: dL/dW2[i,j] = hidden[i] * dLogits[j] * advantage
        // Accumulate into acc.gW2
        for (let i = 0; i < this.hiddenSize; i++) {
            for (let j = 0; j < this.outputSize; j++) {
                acc.gW2[i * this.outputSize + j] += hidden[i] * dLogits[j];
            }
        }

        // Gradient for b2
        for (let j = 0; j < this.outputSize; j++) {
            acc.gb2[j] += dLogits[j];
        }

        // Backprop through hidden layer (using ORIGINAL W2, not updated)
        for (let i = 0; i < this.hiddenSize; i++) {
            let sum = 0;
            for (let j = 0; j < this.outputSize; j++) {
                sum += dLogits[j] * this.w2[i * this.outputSize + j];
            }
            // ReLU derivative: 1 if pre-activation > 0, else 0
            dHidden[i] = sum * (hiddenPreRelu[i] > 0 ? 1 : 0.05);
        }

        // Gradient for W1
        for (let i = 0; i < this.stateSize; i++) {
            for (let j = 0; j < this.hiddenSize; j++) {
                acc.gW1[i * this.hiddenSize + j] += stateVec[i] * dHidden[j];
            }
        }

        // Gradient for b1
        for (let j = 0; j < this.hiddenSize; j++) {
            acc.gb1[j] += dHidden[j];
        }
    }

    /** Accumulate a clipped PPO actor-critic objective (gradient ascent). */
    computePPOGradientsInto(acc, stateVec, actionIdx, oldLogProb, advantage,
        valueTarget, cache, {
            clipRatio = 0.2,
            entropyCoefficient = 0.01,
            valueCoefficient = 0.5,
            coverageCoefficient = 0,
        } = {}) {
        const { hiddenPreRelu, hidden, probs, value } = cache;
        const currentLogProb = Math.log(probs[actionIdx] + 1e-8);
        const ratio = Math.exp(Math.max(-20, Math.min(20, currentLogProb - oldLogProb)));
        const clipped = Math.max(1 - clipRatio, Math.min(1 + clipRatio, ratio));
        const useUnclipped = advantage >= 0 ? ratio <= clipped : ratio >= clipped;
        const policyWeight = useUnclipped ? ratio * Math.max(-8, Math.min(8, advantage)) : 0;

        let entropy = 0;
        for (let index = 0; index < this.outputSize; index++) {
            if (probs[index] > 1e-8) entropy -= probs[index] * Math.log(probs[index]);
        }
        for (let index = 0; index < this.outputSize; index++) {
            const policySignal = policyWeight * (((index === actionIdx) ? 1 : 0) - probs[index]);
            const entropySignal = entropyCoefficient > 0
                ? -entropyCoefficient * probs[index] * (Math.log(probs[index] + 1e-8) + entropy)
                : 0;
            const coverageSignal = coverageCoefficient > 0
                ? coverageCoefficient * ((1 / this.outputSize) - probs[index])
                : 0;
            this._dLogits[index] = policySignal + entropySignal + coverageSignal;
        }

        const valueSignal = valueCoefficient * Math.max(-10, Math.min(10, valueTarget - value));
        for (let hiddenIndex = 0; hiddenIndex < this.hiddenSize; hiddenIndex++) {
            for (let action = 0; action < this.outputSize; action++) {
                acc.gW2[hiddenIndex * this.outputSize + action]
                    += hidden[hiddenIndex] * this._dLogits[action];
            }
            acc.gWv[hiddenIndex] += hidden[hiddenIndex] * valueSignal;
        }
        for (let action = 0; action < this.outputSize; action++) acc.gb2[action] += this._dLogits[action];
        acc.gbv[0] += valueSignal;

        for (let hiddenIndex = 0; hiddenIndex < this.hiddenSize; hiddenIndex++) {
            let signal = valueSignal * this.wv[hiddenIndex];
            for (let action = 0; action < this.outputSize; action++) {
                signal += this._dLogits[action] * this.w2[hiddenIndex * this.outputSize + action];
            }
            this._dHidden[hiddenIndex] = signal * (hiddenPreRelu[hiddenIndex] > 0 ? 1 : 0.05);
        }
        for (let input = 0; input < this.stateSize; input++) {
            for (let hiddenIndex = 0; hiddenIndex < this.hiddenSize; hiddenIndex++) {
                acc.gW1[input * this.hiddenSize + hiddenIndex]
                    += stateVec[input] * this._dHidden[hiddenIndex];
            }
        }
        for (let hiddenIndex = 0; hiddenIndex < this.hiddenSize; hiddenIndex++) {
            acc.gb1[hiddenIndex] += this._dHidden[hiddenIndex];
        }
        return { entropy, valueError: valueTarget - value, ratio };
    }

    /** Adam ascent with global-norm clipping. */
    applyAdam(acc, learningRate, { beta1 = 0.9, beta2 = 0.999, epsilon = 1e-8, maxGradNorm = 0.5 } = {}) {
        const pairs = [
            ['w1', 'gW1'], ['b1', 'gb1'], ['w2', 'gW2'],
            ['b2', 'gb2'], ['wv', 'gWv'], ['bv', 'gbv'],
        ];
        let normSquared = 0;
        for (const [, gradientKey] of pairs) {
            for (const value of acc[gradientKey]) normSquared += value * value;
        }
        const norm = Math.sqrt(normSquared);
        const scale = norm > maxGradNorm ? maxGradNorm / (norm + 1e-8) : 1;
        this._adamStep++;
        const correction1 = 1 - (beta1 ** this._adamStep);
        const correction2 = 1 - (beta2 ** this._adamStep);
        for (const [tensorKey, gradientKey] of pairs) {
            const tensor = this[tensorKey];
            const gradient = acc[gradientKey];
            const first = this._adamM[tensorKey];
            const second = this._adamV[tensorKey];
            for (let index = 0; index < tensor.length; index++) {
                const grad = gradient[index] * scale;
                first[index] = beta1 * first[index] + (1 - beta1) * grad;
                second[index] = beta2 * second[index] + (1 - beta2) * grad * grad;
                const adjusted = (first[index] / correction1)
                    / (Math.sqrt(second[index] / correction2) + epsilon);
                tensor[index] += learningRate * adjusted;
            }
        }
        return norm;
    }

    /**
     * Apply accumulated gradients (gradient ascent for policy gradient)
     * @param {Object} acc - Gradient accumulator { gW1, gb1, gW2, gb2 }
     * @param {number} lr - Learning rate
     */
    applyGradients(acc, lr) {
        for (let i = 0; i < this.w1.length; i++) {
            this.w1[i] += lr * acc.gW1[i];
        }
        for (let i = 0; i < this.b1.length; i++) {
            this.b1[i] += lr * acc.gb1[i];
        }
        for (let i = 0; i < this.w2.length; i++) {
            this.w2[i] += lr * acc.gW2[i];
        }
        for (let i = 0; i < this.b2.length; i++) {
            this.b2[i] += lr * acc.gb2[i];
        }
    }

    /**
     * Create fresh gradient accumulator (zero-initialized)
     * @returns {Object}
     */
    createAccumulator() {
        return {
            gW1: new Float32Array(this.stateSize * this.hiddenSize),
            gb1: new Float32Array(this.hiddenSize),
            gW2: new Float32Array(this.hiddenSize * this.outputSize),
            gb2: new Float32Array(this.outputSize),
            gWv: new Float32Array(this.hiddenSize),
            gbv: new Float32Array(1),
        };
    }

    /**
     * Zero out accumulator (reuse instead of reallocating)
     * @param {Object} acc
     */
    zeroAccumulator(acc) {
        acc.gW1.fill(0);
        acc.gb1.fill(0);
        acc.gW2.fill(0);
        acc.gb2.fill(0);
        acc.gWv.fill(0);
        acc.gbv.fill(0);
    }
}

export default SimplePolicy;
