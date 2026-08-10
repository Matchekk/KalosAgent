import { ReinforceCore } from '../src/lib/core/lab/reinforce-core.js';

function mulberry32(seed) {
    return () => {
        let value = seed += 0x6D2B79F5;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

function oneHot(index, size) {
    const state = new Float32Array(size);
    state[index] = 1;
    return state;
}

function greedyAction(core, state) {
    const probabilities = core.getProbs(state);
    let best = 0;
    for (let index = 1; index < probabilities.length; index++) {
        if (probabilities[index] > probabilities[best]) best = index;
    }
    return best;
}

function trainContextualPolicy(seed) {
    const rng = mulberry32(seed);
    const core = new ReinforceCore({
        stateSize: 4,
        numActions: 4,
        hiddenSize: 32,
        rolloutSize: 128,
        learningRate: 0.003,
        gamma: 0.99,
        entropyCoefficient: 0.003,
        rng,
    });
    for (let step = 0; step < 12_000; step++) {
        const context = Math.floor(rng() * 4);
        const state = oneHot(context, 4);
        const { actionIdx, logProb, value = 0 } = core.act(state);
        core.observe(state, actionIdx, actionIdx === context ? 1 : -0.2, true, logProb, 0, value, 0);
        if (core.shouldTrain()) core.train();
    }
    let correct = 0;
    for (let context = 0; context < 4; context++) {
        if (greedyAction(core, oneHot(context, 4)) === context) correct++;
    }
    return correct / 4;
}

function trainDelayedChain(seed) {
    const rng = mulberry32(seed);
    const length = 10;
    const core = new ReinforceCore({
        stateSize: length,
        numActions: 2,
        hiddenSize: 48,
        rolloutSize: 256,
        learningRate: 0.001,
        gamma: 0.995,
        entropyCoefficient: 0.005,
        rng,
    });
    let position = 0;
    for (let step = 0; step < 45_000; step++) {
        const state = oneHot(position, length);
        const { actionIdx, logProb, value = 0 } = core.act(state);
        const correctAction = position % 2;
        let reward = -0.002;
        let done = false;
        if (actionIdx === correctAction) {
            position++;
            if (position === length) {
                reward = 1;
                done = true;
                position = 0;
            }
        } else {
            reward = -0.02;
            done = true;
            position = 0;
        }
        const nextValue = done ? 0 : (core.getValue?.(oneHot(position, length)) ?? 0);
        core.observe(state, actionIdx, reward, done, logProb, 0, value, nextValue);
        if (core.shouldTrain()) core.train();
    }

    let successes = 0;
    for (let episode = 0; episode < 100; episode++) {
        let evalPosition = 0;
        for (let step = 0; step < length; step++) {
            if (greedyAction(core, oneHot(evalPosition, length)) !== evalPosition % 2) break;
            evalPosition++;
        }
        if (evalPosition === length) successes++;
    }
    return successes / 100;
}

const seeds = [11, 29, 47];
const contextual = seeds.map(trainContextualPolicy);
const delayed = seeds.map(trainDelayedChain);
const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
const contextualScore = mean(contextual);
const delayedScore = mean(delayed);
const learningQuality = 100 * ((0.35 * contextualScore) + (0.65 * delayedScore));

console.log(JSON.stringify({ contextual, delayed, contextualScore, delayedScore }, null, 2));
console.log(`METRIC learning_quality_pct=${learningQuality.toFixed(3)}`);
