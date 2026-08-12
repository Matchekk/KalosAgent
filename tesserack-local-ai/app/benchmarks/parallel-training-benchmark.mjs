import { readFile } from 'node:fs/promises';
import { ReinforceCore } from '../src/lib/core/lab/reinforce-core.js';
import { RolloutBuffer } from '../src/lib/core/lab/rollout-buffer.js';

const parallelModule = await import('../src/lib/core/lab/parallel-training.js').catch(() => null);
const labViewSource = await readFile(new URL('../src/lib/components/lab/LabView.svelte', import.meta.url), 'utf8');

const checks = [];
function check(name, predicate, detail = '') {
    let passed = false;
    try {
        passed = Boolean(predicate());
    } catch (error) {
        detail = error.message;
    }
    checks.push({ name, passed, detail: passed ? '' : detail });
}

check('rollout buffer records an environment stream id', () => {
    const buffer = new RolloutBuffer(4, 1);
    buffer.push(new Float32Array([1]), 0, 1, 0, false, 3);
    return buffer.streamIds?.[0] === 3;
});

check('discounted returns stay isolated between interleaved environments', () => {
    const core = new ReinforceCore({ stateSize: 1, numActions: 2, rolloutSize: 4, gamma: 0.5, normalizeReturns: false });
    const state = new Float32Array([0]);
    core.observe(state, 0, 1, false, 0, 0);
    core.observe(state, 0, 10, false, 0, 1);
    core.observe(state, 0, 2, true, 0, 0);
    core.observe(state, 0, 20, true, 0, 1);
    const returns = Array.from(core._computeReturns().subarray(0, 4));
    return JSON.stringify(returns) === JSON.stringify([2, 20, 2, 20]);
}, 'Expected [2,20,2,20] for two independent gamma=0.5 streams.');

check('parallel plan defaults to four environments', () => {
    const plan = parallelModule?.createParallelTrainingPlan?.({ rolloutSize: 128 });
    return plan?.workerCount === 4 && plan?.visibleWorker === 0 && plan?.startWorker === 3;
});

check('four environments reserve one evaluator and aggregate three local rollouts', () => {
    const plan = parallelModule?.createParallelTrainingPlan?.({ workerCount: 4, rolloutSize: 128 });
    return plan?.aggregateRolloutSize === 384 && plan?.trainingWorkerCount === 3;
});

check('exactly one worker rehearses from the original start', () => {
    const plan = parallelModule?.createParallelTrainingPlan?.({ workerCount: 4, rolloutSize: 128 });
    return plan?.workers?.filter(worker => worker.resetFromInitial).length === 1;
});

check('the fresh-start worker is isolated for frozen evaluation', () => {
    const plan = parallelModule?.createParallelTrainingPlan?.({ workerCount: 4, rolloutSize: 128 });
    return plan?.workers?.filter(worker => worker.evaluationOnly).length === 1
        && plan.workers[plan.startWorker].evaluationOnly === true;
});

check('16x has a true twofold scheduler rate over 8x', () => {
    const at8 = parallelModule?.trainingIntervalMs?.(8);
    const at16 = parallelModule?.trainingIntervalMs?.(16);
    return at8 === 25 && at16 === 12.5;
});

check('background batching compensates the one-second timer clamp', () => {
    const rounds = parallelModule?.trainingRoundsPerTick;
    return rounds?.(8, { hidden: true }) === 40
        && rounds?.(16, { hidden: true }) === 80
        && rounds?.(16, { hidden: false }) === 1;
}, 'Expected hidden 8x/16x batches of 40/80 rounds and one visible round.');

check('Champion outranks every non-Champion state', () => {
    const compare = parallelModule?.compareProgressStates;
    return compare?.(
        { location: 'HALL OF FAME', badgeCount: 0, party: [] },
        { location: 'Viridian Gym', badgeCount: 8, party: [{ level: 100 }] },
    ) > 0;
});

check('badge count outranks party size and levels', () => {
    const compare = parallelModule?.compareProgressStates;
    return compare?.(
        { badgeCount: 1, party: [{ level: 5 }] },
        { badgeCount: 0, party: Array.from({ length: 6 }, () => ({ level: 100 })) },
    ) > 0;
});

check('Oak rival flag outranks party and levels at equal badges', () => {
    const compare = parallelModule?.compareProgressStates;
    return compare?.(
        { badgeCount: 0, progressFlags: { battledRivalInOaksLab: true }, party: [{ level: 5 }] },
        { badgeCount: 0, party: Array.from({ length: 6 }, () => ({ level: 100 })) },
    ) > 0;
});

check('checkpoint selection ignores short-term reward', () => {
    const choose = parallelModule?.chooseCheckpointCandidate;
    const current = { workerId: 0, steps: 50, reward: 999, state: { badgeCount: 0, party: [] } };
    const durable = { workerId: 1, steps: 100, reward: -10, state: { badgeCount: 0, party: [{ level: 5 }] } };
    return choose?.(current, [durable]) === durable;
});

check('equal progress prefers fewer environment steps', () => {
    const choose = parallelModule?.chooseCheckpointCandidate;
    const slow = { workerId: 0, steps: 500, state: { badgeCount: 0, party: [{ level: 5 }] } };
    const fast = { workerId: 1, steps: 300, state: { badgeCount: 0, party: [{ level: 5 }] } };
    return choose?.(slow, [fast]) === fast;
});

check('Train UI exposes 16x playback', () => /const speeds\s*=\s*\[[^\]]*16/.test(labViewSource));
check('Train UI reports parallel environment count', () => /Environments|Envs|Workers/.test(labViewSource));
check('Train UI reports aggregate samples per second', () => /Samples\/s|samplesPerSecond/.test(labViewSource));

const passed = checks.filter(item => item.passed).length;
const total = checks.length;
const score = Number(((passed / total) * 100).toFixed(3));

console.log(JSON.stringify({ passed, total, score, checks }, null, 2));
console.log(`METRIC parallel_training_quality_pct=${score}`);
