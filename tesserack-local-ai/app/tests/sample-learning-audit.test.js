import test from 'node:test';
import assert from 'node:assert/strict';

import { SampleLearningAudit } from '../src/lib/core/lab/sample-learning-audit.js';

function autonomy(overrides = {}) {
    return {
        freshBestLevel: 1,
        freshBestMilestone: 'Players House 2F',
        verifiedLevel: 1,
        verifiedMilestone: 'Players House 2F',
        targetSuccesses: 0,
        attempts: 10,
        samplesSinceFreshProgress: 40_000,
        ...overrides,
    };
}

function observe(audit, totalSamples, proof, diagnostics = {}) {
    return audit.observe({
        totalSamples,
        autonomy: proof,
        trainSteps: diagnostics.trainSteps ?? 100,
        entropy: diagnostics.entropy ?? 1.5,
        avgReturn: diagnostics.avgReturn ?? -5,
        clipFraction: diagnostics.clipFraction ?? 0.1,
    });
}

test('50k audit does not report before its exact sample boundary', () => {
    const audit = new SampleLearningAudit();
    const summary = observe(audit, 49_999, autonomy());
    assert.equal(summary.completedAudits, 0);
    assert.equal(summary.nextBoundary, 50_000);
});

test('first 50k audit is an explicit outcome-only baseline', () => {
    const audit = new SampleLearningAudit();
    const summary = observe(audit, 50_000, autonomy());
    assert.equal(summary.last.verdict, 'baseline');
    assert.equal(summary.last.boundarySamples, 50_000);
    assert.equal(summary.nextBoundary, 100_000);
});

test('fresh-ROM progress is the only signal that marks an audit improving', () => {
    const audit = new SampleLearningAudit();
    observe(audit, 50_000, autonomy());
    const summary = observe(audit, 100_000, autonomy({
        freshBestLevel: 5,
        freshBestMilestone: 'Starter selected',
        verifiedLevel: 2,
        verifiedMilestone: 'Players House 1F',
        attempts: 25,
        samplesSinceFreshProgress: 1_000,
    }));
    assert.equal(summary.last.verdict, 'improving');
    assert.equal(summary.last.deltas.freshBestLevel, 4);
    assert.equal(summary.last.deltas.verifiedLevel, 1);
});

test('two stagnant 50k intervals become a hardstuck instead of a success claim', () => {
    const audit = new SampleLearningAudit();
    observe(audit, 50_000, autonomy());
    assert.equal(observe(audit, 100_000, autonomy({
        attempts: 20,
        samplesSinceFreshProgress: 90_000,
    })).last.verdict, 'plateau-watch');
    const summary = observe(audit, 150_000, autonomy({
        attempts: 30,
        samplesSinceFreshProgress: 140_000,
    }));
    assert.equal(summary.last.verdict, 'hardstuck');
    assert.match(summary.last.reason, /Two 50k intervals/);
});

test('reward, return, entropy and checkpoint-like diagnostics cannot fake improvement', () => {
    const audit = new SampleLearningAudit();
    observe(audit, 50_000, autonomy(), { trainSteps: 100, avgReturn: -10 });
    const summary = observe(audit, 100_000, autonomy({ attempts: 20 }), {
        trainSteps: 999,
        entropy: 1.9,
        avgReturn: 100,
        clipFraction: 0.01,
    });
    assert.equal(summary.last.verdict, 'plateau-watch');
    assert.equal(summary.last.deltas.freshBestLevel, 0);
});

test('a fresh worker with no new independent attempt is an immediate technical hardstuck', () => {
    const audit = new SampleLearningAudit();
    observe(audit, 50_000, autonomy({ attempts: 10 }));
    const summary = observe(audit, 100_000, autonomy({ attempts: 10 }));
    assert.equal(summary.last.verdict, 'hardstuck');
    assert.match(summary.last.reason, /completed no new/);
});

test('audit snapshot survives environment rotation without duplicating boundaries', () => {
    const source = new SampleLearningAudit();
    observe(source, 50_000, autonomy());

    const restored = new SampleLearningAudit({ initialTotalSamples: 50_000 });
    assert.equal(restored.restoreSnapshot(source.exportSnapshot()), true);
    assert.equal(observe(restored, 99_999, autonomy()).completedAudits, 1);
    const summary = observe(restored, 100_000, autonomy({ attempts: 20 }));
    assert.equal(summary.completedAudits, 2);
    assert.deepEqual(summary.history.map(entry => entry.boundarySamples), [50_000, 100_000]);
});
