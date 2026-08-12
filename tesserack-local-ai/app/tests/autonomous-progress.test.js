import test from 'node:test';
import assert from 'node:assert/strict';

import {
    AUTONOMOUS_TARGET_LEVEL,
    AutonomousProgressTracker,
    detectAutonomousMilestone,
} from '../src/lib/core/lab/autonomous-progress.js';

function state(overrides = {}) {
    return {
        location: 'PLAYERS HOUSE 2F',
        coordinates: { x: 3, y: 6 },
        badgeCount: 0,
        party: [],
        progressFlags: { battledRivalInOaksLab: false },
        ...overrides,
    };
}

const starter = [{ speciesId: 7, level: 5, currentHP: 20, maxHP: 20 }];

test('inactive or corrupt RAM can never create autonomous progress', () => {
    assert.equal(detectAutonomousMilestone(state({ location: 'NO ACTIVE MAP' })), 0);
    assert.equal(detectAutonomousMilestone(state({ location: 'UNKNOWN (38)' })), 0);
    assert.equal(detectAutonomousMilestone(state({
        location: 'PEWTER GYM',
        badgeCount: 1,
        party: [{ speciesId: 255, level: 250 }],
    })), 0);
});

test('early milestones require coherent state and Oak progress', () => {
    assert.equal(detectAutonomousMilestone(state()), 1);
    assert.equal(detectAutonomousMilestone(state({ location: 'OAKS LAB' })), 4);
    assert.equal(detectAutonomousMilestone(state({ location: 'OAKS LAB', party: starter })), 5);
    assert.equal(detectAutonomousMilestone(state({
        location: 'ROUTE 1',
        party: starter,
        progressFlags: { battledRivalInOaksLab: false },
    })), 5, 'a transient route byte cannot skip the Oak rival proof');
    assert.equal(detectAutonomousMilestone(state({
        location: 'ROUTE 1',
        party: starter,
        progressFlags: { battledRivalInOaksLab: true },
    })), 7);
    assert.equal(detectAutonomousMilestone(state({
        location: 'ROUTE 2',
        party: starter,
        progressFlags: { battledRivalInOaksLab: true, gotPokedex: false },
    })), 8, 'Route 2 RAM cannot replace the exact Oak/Pokedex proof');
    assert.equal(detectAutonomousMilestone(state({
        location: 'ROUTE 2',
        party: starter,
        progressFlags: { battledRivalInOaksLab: true, gotPokedex: true },
    })), 9);
});

test('one lucky fresh-start result is not called verified', () => {
    const tracker = new AutonomousProgressTracker({ freshWorkerId: 3, stableObservations: 3 });
    const badge = state({ location: 'PEWTER GYM', party: starter, badgeCount: 1 });
    for (let sample = 1; sample <= 3; sample++) {
        tracker.observe({ workerId: 3, state: badge, episode: 1, episodeSteps: sample, totalSamples: sample });
    }
    const summary = tracker.summary(3);
    assert.equal(summary.freshBestLevel, AUTONOMOUS_TARGET_LEVEL);
    assert.equal(summary.verifiedLevel, 0);
    assert.equal(summary.targetSuccesses, 1);
    assert.equal(summary.targetProven, false);
});

test('three separate clean-start episodes verify a reproducible milestone', () => {
    const tracker = new AutonomousProgressTracker({ freshWorkerId: 3, stableObservations: 3 });
    const starterState = state({ location: 'OAKS LAB', party: starter });
    let sample = 0;
    for (let episode = 1; episode <= 3; episode++) {
        for (let observation = 0; observation < 3; observation++) {
            sample++;
            tracker.observe({
                workerId: 3,
                state: starterState,
                episode,
                episodeSteps: observation + 1,
                totalSamples: sample,
            });
        }
    }
    const summary = tracker.summary(sample);
    assert.equal(summary.verifiedLevel, 5);
    assert.equal(summary.verifiedMilestone, 'Starter selected');
    assert.equal(summary.verifiedProofRuns, 3);
    assert.equal(summary.targetProven, false);
});

test('checkpoint workers can advance the frontier but not clean-start proof', () => {
    const tracker = new AutonomousProgressTracker({ freshWorkerId: 3, stableObservations: 2 });
    const badge = state({ location: 'PEWTER GYM', party: starter, badgeCount: 1 });
    tracker.observe({ workerId: 1, state: badge, episode: 1, totalSamples: 1 });
    tracker.observe({ workerId: 1, state: badge, episode: 1, totalSamples: 2 });
    const summary = tracker.summary(2);
    assert.equal(summary.frontierLevel, AUTONOMOUS_TARGET_LEVEL);
    assert.equal(summary.freshBestLevel, 0);
    assert.equal(summary.targetSuccesses, 0);
});

test('autonomous proof survives trainer rotation and reload', () => {
    const source = new AutonomousProgressTracker({ freshWorkerId: 3, stableObservations: 1 });
    source.observe({ workerId: 3, state: state({ location: 'OAKS LAB', party: starter }), episode: 2, totalSamples: 500 });

    const restored = new AutonomousProgressTracker({ freshWorkerId: 3, stableObservations: 1 });
    assert.equal(restored.restoreSnapshot(source.exportSnapshot()), true);
    const summary = restored.summary(700);
    assert.equal(summary.freshBestMilestone, 'Starter selected');
    assert.equal(summary.targetSuccesses, 0);
    assert.equal(summary.samplesSinceFreshProgress, 200);
});

test('a reload cannot reuse an earlier episode as another proof run', () => {
    const milestoneState = state({ location: 'OAKS LAB', party: starter });
    const source = new AutonomousProgressTracker({ freshWorkerId: 3, stableObservations: 1 });
    source.observe({ workerId: 3, state: milestoneState, episode: 1, totalSamples: 10 });

    const restored = new AutonomousProgressTracker({ freshWorkerId: 3, stableObservations: 1 });
    restored.restoreSnapshot(source.exportSnapshot());
    restored.observe({ workerId: 3, state: milestoneState, episode: 1, totalSamples: 20 });

    const snapshot = restored.exportSnapshot();
    assert.deepEqual(snapshot.hitEpisodes[5], [1, 2]);
    assert.equal(restored.summary(20).verifiedLevel, 0);
});
