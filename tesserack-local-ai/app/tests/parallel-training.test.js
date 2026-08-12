import test from 'node:test';
import assert from 'node:assert/strict';

import { ReinforceCore } from '../src/lib/core/lab/reinforce-core.js';
import { RolloutBuffer } from '../src/lib/core/lab/rollout-buffer.js';
import {
    chooseCheckpointCandidate,
    compareProgressStates,
    createParallelTrainingPlan,
    progressScore,
    trainingIntervalMs,
    trainingRoundsPerTick,
} from '../src/lib/core/lab/parallel-training.js';
import { ParallelTrainingCoordinator } from '../src/lib/core/lab/parallel-trainer.js';

test('interleaved environments retain independent discounted returns', () => {
    const buffer = new RolloutBuffer(4, 1);
    buffer.push(new Float32Array([0]), 0, 1, 0, false, 3);
    assert.equal(buffer.streamIds[0], 3);

    const core = new ReinforceCore({ stateSize: 1, numActions: 2, rolloutSize: 4, gamma: 0.5, normalizeReturns: false });
    const state = new Float32Array([0]);
    core.observe(state, 0, 1, false, 0, 0);
    core.observe(state, 0, 10, false, 0, 1);
    core.observe(state, 0, 2, true, 0, 0);
    core.observe(state, 0, 20, true, 0, 1);
    assert.deepEqual(Array.from(core._computeReturns().subarray(0, 4)), [2, 20, 2, 20]);
});

test('parallel plan makes one 512-sample update from four 128-step streams', () => {
    const plan = createParallelTrainingPlan({ workerCount: 4, rolloutSize: 128 });
    assert.equal(plan.aggregateRolloutSize, 512);
    assert.equal(plan.workers.length, 4);
    assert.deepEqual(plan.workers.map(worker => worker.resetFromInitial), [false, false, false, true]);
    assert.equal(trainingIntervalMs(8), 25);
    assert.equal(trainingIntervalMs(16), 12.5);
    assert.equal(trainingRoundsPerTick(16), 1);
    assert.equal(trainingRoundsPerTick(8, { hidden: true }), 40);
    assert.equal(trainingRoundsPerTick(16, { hidden: true }), 80);
});

test('durable Red++ progress is strictly lexicographic', () => {
    const champion = { location: 'HALL OF FAME', badgeCount: 0, party: [] };
    const allBadges = { badgeCount: 8, party: [{ level: 100 }] };
    const oneBadge = { badgeCount: 1, party: [{ level: 5 }] };
    const overlevelledParty = { badgeCount: 0, party: Array.from({ length: 6 }, () => ({ level: 100 })) };
    const oakRival = { badgeCount: 0, progressFlags: { battledRivalInOaksLab: true }, party: [{ level: 5 }] };

    assert.ok(compareProgressStates(champion, allBadges) > 0);
    assert.ok(compareProgressStates(oneBadge, overlevelledParty) > 0);
    assert.ok(compareProgressStates(oakRival, overlevelledParty) > 0);
    assert.ok(progressScore(champion) > progressScore(allBadges));
});

test('leaving Oaks Lab for Pallet is durable curriculum progress', () => {
    const oakRival = {
        location: 'OAKS LAB',
        progressFlags: { battledRivalInOaksLab: true },
        party: [{ speciesId: 1, level: 6 }],
    };
    const palletAfterRival = { ...oakRival, location: 'PALLET TOWN' };

    assert.ok(compareProgressStates(palletAfterRival, oakRival) > 0);
    assert.ok(progressScore(palletAfterRival) > progressScore(oakRival));
});

test('checkpoint choice ignores reward and breaks equal-progress ties by speed', () => {
    const current = { workerId: 0, steps: 500, reward: 999, state: { party: [] } };
    const starterSlow = { workerId: 1, steps: 400, reward: -5, state: { party: [{ level: 5 }] } };
    const starterFast = { workerId: 2, steps: 300, reward: -10, state: { party: [{ level: 5 }] } };
    assert.equal(chooseCheckpointCandidate(current, [starterSlow, starterFast]), starterFast);
});

test('coordinator shares one learner and publishes a hidden worker checkpoint to every environment', async () => {
    const core = {
        stateSize: 36,
        numActions: 7,
        trainSteps: 0,
        lastAvgRawReturn: 0,
        lastEntropy: 1,
        rolloutSize: 512,
        buffer: { length: 4 },
    };
    const adopted = [];
    let rendered = 0;

    const agents = Array.from({ length: 4 }, (_, workerId) => {
        const state = workerId === 2 ? { location: 'Pallet Town', party: [{ level: 5 }] } : { location: 'Pallet Town', party: [] };
        let candidate = workerId === 2 ? {
            workerId,
            steps: 200,
            state,
            checkpoint: new Uint8Array([1, 2, 3]),
        } : null;
        return {
            workerId,
            core,
            checkpointCount: workerId === 0 ? 1 : 0,
            checkpointState: new Uint8Array([0]),
            confirmedWins: 0,
            totalReward: 0,
            totalSteps: 1,
            episode: 1,
            episodeSteps: 1,
            config: { resetFromInitial: workerId === 3 },
            emu: { render() { if (workerId === 0) rendered++; }, destroy() {} },
            mem: { getGameState: () => state },
            rewards: { getStats: () => ({ totalRewards: {}, completedObjectives: [] }) },
            async step() {
                return {
                    actionStr: 'a',
                    reward: 0,
                    breakdown: {},
                    firedTests: workerId === 1
                        ? [{ id: 'dialog_advanced', reward: 0.04, tier: 1 }]
                        : [],
                    trainInfo: workerId === 3 ? { trainSteps: 1 } : null,
                };
            },
            consumeCheckpointCandidate() { const value = candidate; candidate = null; return value; },
            adoptCheckpoint(bytes, adoptedState, options) { adopted.push({ workerId, bytes, adoptedState, options }); },
            setSharedCore(nextCore) { this.core = nextCore; },
            stop() {},
            reset() {},
        };
    });

    const coordinator = new ParallelTrainingCoordinator({ agents, initialTotalSamples: 248_396 });
    const result = await coordinator.stepRound();
    assert.equal(result.environmentCount, 4);
    assert.equal(result.step, 248_400);
    assert.equal(result.checkpointWorker, 2);
    assert.equal(adopted.length, 4);
    assert.equal(rendered, 1);
    assert.deepEqual(result.trainInfo, { trainSteps: 1 });
    assert.deepEqual(result.firedTests, [{
        id: 'dialog_advanced', reward: 0.04, tier: 1, workerId: 1, visibleWorker: false,
    }]);
    assert.ok(Number.isFinite(result.samplesPerSecond));
    assert.deepEqual(result.workers.map(worker => worker.role), [
        'Checkpoint exploit',
        'Frontier replay',
        'Frontier replay',
        'Fresh-ROM proof',
    ]);
    assert.deepEqual(result.workers.map(worker => worker.proofEligible), [false, false, false, true]);
    assert.equal(result.workers[2].checkpointSource, true);
    assert.equal(result.workers[1].action, 'a');
    assert.equal(result.workers[2].partySize, 1);
    assert.equal(result.workers[2].maxLevel, 5);
});

test('frontier archive prefers under-restored cells and remains memory-bounded', () => {
    const core = {};
    const agents = Array.from({ length: 4 }, (_, workerId) => ({
        workerId,
        core,
        checkpointCount: 1,
        checkpointState: new Uint8Array([0]),
        mem: { getGameState: () => ({ location: 'PALLET TOWN', party: [] }) },
    }));
    const coordinator = new ParallelTrainingCoordinator({ agents });
    coordinator.archiveLimit = 2;
    const make = (key, location, byte) => ({
        key,
        state: { location, party: [] },
        checkpoint: new Uint8Array([byte]),
    });
    coordinator._rememberArchive(make('house', "PLAYER'S HOUSE 2F", 1));
    coordinator._rememberArchive(make('pallet', 'PALLET TOWN', 2));
    const first = coordinator._selectArchiveCell();
    const second = coordinator._selectArchiveCell();

    assert.notEqual(first.key, second.key, 'least-restored cells are covered before repetition');
    coordinator._rememberArchive(make('route1', 'ROUTE 1', 3));
    assert.equal(coordinator.archive.size, 2);
    assert.ok([...coordinator.archive.values()].some(cell => cell.state.location === 'ROUTE 1'));
});
