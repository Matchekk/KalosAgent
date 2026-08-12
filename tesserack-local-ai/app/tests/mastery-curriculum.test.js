import test from 'node:test';
import assert from 'node:assert/strict';

import { MasteryCurriculum } from '../src/lib/core/lab/mastery-curriculum.js';

const checkpoint = value => new Uint8Array([value]);

test('reverse curriculum masters late stages before moving backward', () => {
    const curriculum = new MasteryCurriculum({
        minimumAttempts: 2,
        windowSize: 4,
        masteryRate: 0.75,
        trueRomFraction: 0.1,
    });
    curriculum.registerCheckpoint({ level: 4, source: 'human-demonstration', checkpoint: checkpoint(4) });
    curriculum.registerCheckpoint({ level: 8, source: 'human-demonstration', checkpoint: checkpoint(8) });

    // The first episode satisfies the hard minimum true-ROM allocation.
    assert.equal(curriculum.selectStart(0).trueRom, true);
    curriculum.completeEpisode(0, 0);

    const lateA = curriculum.selectStart(0);
    assert.equal(lateA.level, 8);
    curriculum.completeEpisode(0, 9);
    const lateB = curriculum.selectStart(0);
    assert.equal(lateB.level, 8);
    curriculum.completeEpisode(0, 9);

    assert.equal(curriculum.stageStats(8).mastered, true);
    assert.equal(curriculum.selectStart(0).level, 4, 'scheduler walks backward after late-stage mastery');
});

test('true-ROM allocation can never be starved by curriculum starts', () => {
    const curriculum = new MasteryCurriculum({ trueRomFraction: 0.25 });
    curriculum.registerCheckpoint({ level: 5, source: 'human-demonstration', checkpoint: checkpoint(5) });
    for (let episode = 0; episode < 40; episode++) {
        const assignment = curriculum.selectStart(episode % 3);
        curriculum.completeEpisode(episode % 3, assignment.level + 1);
    }
    const summary = curriculum.summary();
    assert.ok(summary.trueRomFraction >= 0.25);
    assert.equal(summary.minimumTrueRomFraction, 0.25);
});

test('human demonstration checkpoints cannot be overwritten by autonomous noise', () => {
    const curriculum = new MasteryCurriculum();
    curriculum.registerCheckpoint({ level: 7, source: 'human-demonstration', checkpoint: checkpoint(1) });
    assert.equal(curriculum.registerCheckpoint({
        level: 7,
        source: 'autonomous-frontier',
        checkpoint: checkpoint(2),
    }), false);
    assert.equal(curriculum.selectStart(0).checkpoint, null, 'first scheduled episode is true ROM');
    assert.deepEqual(curriculum.selectStart(1).checkpoint, checkpoint(1));
});

test('curriculum never starts at or beyond the evaluation target', () => {
    const curriculum = new MasteryCurriculum({ targetLevel: 13 });
    assert.equal(curriculum.registerCheckpoint({
        level: 13,
        source: 'human-demonstration',
        checkpoint: checkpoint(13),
    }), false);
    assert.equal(curriculum.summary().stageCount, 0);
});

test('mastery outcomes survive browser environment rotation', () => {
    const source = new MasteryCurriculum({ minimumAttempts: 2, windowSize: 4, trueRomFraction: 0.1 });
    source.registerCheckpoint({ level: 8, source: 'human-demonstration', checkpoint: checkpoint(8) });
    source.selectStart(0);
    source.completeEpisode(0, 0);
    source.selectStart(0);
    source.completeEpisode(0, 9);

    const restored = new MasteryCurriculum({ minimumAttempts: 2, windowSize: 4, trueRomFraction: 0.1 });
    restored.registerCheckpoint({ level: 8, source: 'human-demonstration', checkpoint: checkpoint(8) });
    assert.equal(restored.restoreSnapshot(source.exportSnapshot()), true);
    assert.equal(restored.stageStats(8).attempts, 1);
    assert.equal(restored.summary().episodesScheduled, 2);
});
