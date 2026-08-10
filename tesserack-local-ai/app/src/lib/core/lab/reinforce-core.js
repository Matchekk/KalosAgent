/**
 * Browser-native clipped PPO actor-critic.
 *
 * The historical class name remains for storage/UI compatibility, but the
 * update is now PPO + GAE + Adam: a value baseline assigns delayed credit,
 * clipped ratios bound policy drift, and interleaved emulator streams never
 * bootstrap from one another.
 */
import { RolloutBuffer } from './rollout-buffer.js';
import { SimplePolicy } from './simple-policy.js';

export function adaptiveEntropyCoefficient({
    entropy,
    numActions,
    baseCoefficient = 0.01,
    maxCoefficient = baseCoefficient,
    targetRatio = 0,
    responseGain = 0,
}) {
    const actions = Math.max(2, Math.trunc(Number(numActions) || 0));
    const base = Math.max(0, Number(baseCoefficient) || 0);
    const maximum = Math.max(base, Number(maxCoefficient) || base);
    const ratio = Math.max(0, Math.min(1, Number(targetRatio) || 0));
    if (ratio === 0 || maximum === base) return base;
    const targetEntropy = ratio * Math.log(actions);
    const observed = Math.max(0, Number(entropy) || 0);
    const deficit = Math.max(0, Math.min(1, (targetEntropy - observed) / targetEntropy));
    const gain = Math.max(0, Number(responseGain) || 0);
    const pressure = gain > 0
        ? (1 - Math.exp(-gain * deficit)) / (1 - Math.exp(-gain))
        : deficit;
    return base + (maximum - base) * pressure;
}

export function adaptiveCoverageCoefficient({ probabilities, coefficient = 0, minimumProbability = 0 }) {
    const maximum = Math.max(0, Number(coefficient) || 0);
    const floor = Math.max(0, Math.min(1, Number(minimumProbability) || 0));
    if (maximum === 0 || floor === 0 || !probabilities?.length) return 0;
    let minimum = 1;
    for (const probability of probabilities) minimum = Math.min(minimum, Math.max(0, Number(probability) || 0));
    return maximum * Math.max(0, Math.min(1, (floor - minimum) / floor));
}

export class ReinforceCore {
    constructor(config = {}) {
        this.stateSize = config.stateSize ?? 16;
        this.numActions = config.numActions ?? 6;
        this.hiddenSize = config.hiddenSize ?? 64;
        this.rolloutSize = config.rolloutSize ?? 128;
        this.learningRate = config.learningRate ?? 0.0003;
        this.gamma = config.gamma ?? 0.99;
        this.gaeLambda = config.gaeLambda ?? 0.95;
        this.clipRatio = config.clipRatio ?? 0.2;
        this.updateEpochs = config.updateEpochs ?? 6;
        this.miniBatchSize = config.miniBatchSize ?? 64;
        this.valueCoefficient = config.valueCoefficient ?? 0.5;
        this.maxGradNorm = config.maxGradNorm ?? 0.5;
        this.intrinsicRewardScale = config.intrinsicRewardScale ?? 0.01;
        this.intrinsicRewardCap = config.intrinsicRewardCap ?? 0.02;
        this.intrinsicRewardProfiles = config.intrinsicRewardProfiles ?? [1];
        this.normalizeReturns = config.normalizeReturns ?? true;
        this.entropyCoefficient = config.entropyCoefficient ?? 0.01;
        this.entropyTargetRatio = config.entropyTargetRatio ?? 0;
        this.maxEntropyCoefficient = config.maxEntropyCoefficient ?? this.entropyCoefficient;
        this.entropyResponseGain = config.entropyResponseGain ?? 0;
        this.actionCoverageCoefficient = config.actionCoverageCoefficient ?? 0;
        this.minimumActionProbability = config.minimumActionProbability ?? 0;
        this.rng = config.rng ?? Math.random;

        this.policy = new SimplePolicy(this.stateSize, this.hiddenSize, this.numActions, this.rng);
        this.buffer = new RolloutBuffer(this.rolloutSize, this.stateSize);
        this.gradAcc = this.policy.createAccumulator();
        this._returns = new Float32Array(this.rolloutSize);
        this._advantages = new Float32Array(this.rolloutSize);
        this._valueTargets = new Float32Array(this.rolloutSize);
        this._indices = new Uint32Array(this.rolloutSize);

        this.trainSteps = 0;
        this.lastAvgRawReturn = 0;
        this.lastEntropy = 0;
        this.lastEntropyCoefficient = this.entropyCoefficient;
        this.lastValueLoss = 0;
        this.lastClipFraction = 0;
        this.lastIntrinsicReward = 0;
        this._episodicVisits = new Map();
        this._lifetimeVisits = new Map();
    }

    act(stateVec) {
        const cache = this.policy.forwardWithCache(stateVec);
        const sample = this.rng();
        let cumulative = 0;
        let actionIdx = cache.probs.length - 1;
        for (let index = 0; index < cache.probs.length; index++) {
            cumulative += cache.probs[index];
            if (sample < cumulative) {
                actionIdx = index;
                break;
            }
        }
        return {
            actionIdx,
            logProb: Math.log(cache.probs[actionIdx] + 1e-8),
            value: cache.value,
        };
    }

    observe(stateVec, actionIdx, reward, done, logProb, streamId = 0, value = 0, nextValue = 0,
        noveltyKey = null) {
        const visits = this._episodicVisits.get(streamId) || new Map();
        const stateKey = noveltyKey ?? hashState(stateVec);
        const count = (visits.get(stateKey) || 0) + 1;
        visits.set(stateKey, count);
        this._episodicVisits.set(streamId, visits);
        const lifetimeVisits = this._lifetimeVisits.get(streamId) || new Uint32Array(65536);
        const lifetimeIndex = hashNoveltyKey(stateKey) & 0xffff;
        const lifetimeCount = Math.min(0xffffffff, lifetimeVisits[lifetimeIndex] + 1);
        lifetimeVisits[lifetimeIndex] = lifetimeCount;
        this._lifetimeVisits.set(streamId, lifetimeVisits);
        const profile = this.intrinsicRewardProfiles[
            Math.min(streamId, this.intrinsicRewardProfiles.length - 1)
        ] ?? 1;
        const intrinsicReward = Math.min(
            this.intrinsicRewardCap,
            (this.intrinsicRewardScale * Math.max(0, profile)) / Math.sqrt(count * lifetimeCount),
        );
        this.lastIntrinsicReward = intrinsicReward;
        this.buffer.push(
            stateVec,
            actionIdx,
            reward + intrinsicReward,
            logProb,
            done,
            streamId,
            value,
            nextValue,
            reward,
            intrinsicReward,
        );
        if (done) this._episodicVisits.delete(streamId);
    }

    shouldTrain() {
        return this.buffer.isFull();
    }

    /** Historical exact returns helper retained for diagnostics/tests. */
    _computeReturns() {
        const returnByStream = [];
        for (let t = this.buffer.length - 1; t >= 0; t--) {
            const streamId = this.buffer.streamIds[t];
            if (this.buffer.dones[t]) returnByStream[streamId] = 0;
            const value = this.buffer.extrinsicRewards[t] + this.gamma * (returnByStream[streamId] || 0);
            returnByStream[streamId] = value;
            this._returns[t] = value;
        }
        return this._returns;
    }

    _computeGAE(n) {
        const gaeByStream = [];
        for (let t = n - 1; t >= 0; t--) {
            const streamId = this.buffer.streamIds[t];
            const continuation = this.buffer.dones[t] ? 0 : 1;
            const delta = this.buffer.rewards[t]
                + this.gamma * this.buffer.nextValues[t] * continuation
                - this.buffer.values[t];
            const gae = delta + this.gamma * this.gaeLambda * continuation * (gaeByStream[streamId] || 0);
            gaeByStream[streamId] = gae;
            this._advantages[t] = gae;
            this._valueTargets[t] = gae + this.buffer.values[t];
        }
    }

    train() {
        const n = this.buffer.length;
        if (n === 0) {
            return { avgRawReturn: 0, entropy: 0, trainSteps: this.trainSteps };
        }
        this._computeGAE(n);
        let returnSum = 0;
        for (let t = 0; t < n; t++) returnSum += this._valueTargets[t];
        this.lastAvgRawReturn = returnSum / n;

        if (this.normalizeReturns) {
            normalizeAdvantagesByStream(this._advantages, this.buffer.streamIds, n);
        }

        const entropyCoefficient = adaptiveEntropyCoefficient({
            entropy: this.lastEntropy,
            numActions: this.numActions,
            baseCoefficient: this.entropyCoefficient,
            maxCoefficient: this.maxEntropyCoefficient,
            targetRatio: this.entropyTargetRatio,
            responseGain: this.entropyResponseGain,
        });
        this.lastEntropyCoefficient = entropyCoefficient;
        for (let index = 0; index < n; index++) this._indices[index] = index;

        let entropySum = 0;
        let valueErrorSquared = 0;
        let clippedSamples = 0;
        let evaluatedSamples = 0;
        for (let epoch = 0; epoch < this.updateEpochs; epoch++) {
            this._shuffleIndices(n);
            for (let start = 0; start < n; start += this.miniBatchSize) {
                const end = Math.min(n, start + this.miniBatchSize);
                const batchSize = end - start;
                this.policy.zeroAccumulator(this.gradAcc);
                for (let cursor = start; cursor < end; cursor++) {
                    const t = this._indices[cursor];
                    const offset = this.buffer.stateOffset(t);
                    const state = this.buffer.states.subarray(offset, offset + this.stateSize);
                    const cache = this.policy.forwardWithCache(state);
                    const coverageCoefficient = adaptiveCoverageCoefficient({
                        probabilities: cache.probs,
                        coefficient: this.actionCoverageCoefficient,
                        minimumProbability: this.minimumActionProbability,
                    });
                    const result = this.policy.computePPOGradientsInto(
                        this.gradAcc,
                        state,
                        this.buffer.actions[t],
                        this.buffer.logProbs[t],
                        this._advantages[t],
                        this._valueTargets[t],
                        cache,
                        {
                            clipRatio: this.clipRatio,
                            entropyCoefficient,
                            valueCoefficient: this.valueCoefficient,
                            coverageCoefficient,
                        },
                    );
                    entropySum += result.entropy;
                    valueErrorSquared += result.valueError ** 2;
                    if (Math.abs(result.ratio - 1) > this.clipRatio) clippedSamples++;
                    evaluatedSamples++;
                }
                for (const key of ['gW1', 'gb1', 'gW2', 'gb2', 'gWv', 'gbv']) {
                    for (let index = 0; index < this.gradAcc[key].length; index++) {
                        this.gradAcc[key][index] /= batchSize;
                    }
                }
                this.policy.applyAdam(this.gradAcc, this.learningRate, { maxGradNorm: this.maxGradNorm });
            }
        }

        this.lastEntropy = entropySum / Math.max(1, evaluatedSamples);
        this.lastValueLoss = valueErrorSquared / Math.max(1, evaluatedSamples);
        this.lastClipFraction = clippedSamples / Math.max(1, evaluatedSamples);
        this.trainSteps++;
        this.buffer.clear();
        return {
            avgRawReturn: this.lastAvgRawReturn,
            entropy: this.lastEntropy,
            valueLoss: this.lastValueLoss,
            clipFraction: this.lastClipFraction,
            trainSteps: this.trainSteps,
        };
    }

    _shuffleIndices(n) {
        for (let index = n - 1; index > 0; index--) {
            const swap = Math.floor(this.rng() * (index + 1));
            const value = this._indices[index];
            this._indices[index] = this._indices[swap];
            this._indices[swap] = value;
        }
    }

    getProbs(stateVec) {
        return this.policy.forward(stateVec);
    }

    getValue(stateVec) {
        return this.policy.forwardWithCache(stateVec).value;
    }

    getBufferStatus() {
        return { length: this.buffer.length, capacity: this.rolloutSize };
    }
}

export function normalizeAdvantagesByStream(advantages, streamIds, length = advantages?.length || 0) {
    const stats = new Map();
    for (let index = 0; index < length; index++) {
        const stream = streamIds[index];
        const current = stats.get(stream) || { count: 0, sum: 0, squareSum: 0 };
        const value = Number(advantages[index]) || 0;
        current.count++;
        current.sum += value;
        current.squareSum += value * value;
        stats.set(stream, current);
    }
    for (const current of stats.values()) {
        current.mean = current.sum / Math.max(1, current.count);
        const variance = Math.max(0, current.squareSum / Math.max(1, current.count) - current.mean ** 2);
        current.deviation = Math.sqrt(variance) + 1e-8;
    }
    for (let index = 0; index < length; index++) {
        const current = stats.get(streamIds[index]);
        advantages[index] = (advantages[index] - current.mean) / current.deviation;
    }
    return advantages;
}

export default ReinforceCore;

function hashState(stateVec) {
    let hash = 2166136261;
    for (let index = 0; index < stateVec.length; index++) {
        const quantized = Math.round((Number(stateVec[index]) || 0) * 1024);
        hash ^= quantized & 0xffff;
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function hashNoveltyKey(value) {
    if (typeof value === 'number') return value >>> 0;
    const text = String(value ?? '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
