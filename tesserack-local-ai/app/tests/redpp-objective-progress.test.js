import test from 'node:test';
import assert from 'node:assert/strict';

import {
    deriveRedppGuideObjectives,
    REDPP_PROVABLE_OBJECTIVES,
} from '../src/lib/core/lab/redpp-objective-progress.js';

const party = [{ speciesId: 1, level: 5 }];

test('does not complete the starter objective from a location alone', () => {
    const completed = deriveRedppGuideObjectives({ location: 'PEWTER CITY', party: [] });
    assert.equal(completed.size, 0);
});

test('completes the starter objective from a credible RAM party', () => {
    const completed = deriveRedppGuideObjectives({ location: 'PALLET TOWN', party });
    assert.equal(completed.has(REDPP_PROVABLE_OBJECTIVES.starter), true);
    assert.equal(completed.has(REDPP_PROVABLE_OBJECTIVES.viridian), false);
});

test('Viridian does not falsely prove the parcel return sequence', () => {
    const completed = deriveRedppGuideObjectives({
        location: 'VIRIDIAN CITY',
        party,
        progressFlags: { battledRivalInOaksLab: true },
    });
    assert.equal(completed.has(REDPP_PROVABLE_OBJECTIVES.viridian), true);
    assert.equal(completed.has(REDPP_PROVABLE_OBJECTIVES.oakSequence), false);
});

test('Route 2 cannot prove the Oak sequence without the exact Pokedex event', () => {
    const completed = deriveRedppGuideObjectives({
        location: 'ROUTE 2',
        party,
        progressFlags: { battledRivalInOaksLab: true },
    });
    assert.equal(completed.has(REDPP_PROVABLE_OBJECTIVES.oakSequence), false);
    assert.equal(completed.has(REDPP_PROVABLE_OBJECTIVES.forest), false);
});

test('the exact Pokedex event proves Oak sequence independently of map heuristics', () => {
    const completed = deriveRedppGuideObjectives({
        location: 'PALLET TOWN',
        party,
        progressFlags: { gotPokedex: true },
    });
    assert.equal(completed.has(REDPP_PROVABLE_OBJECTIVES.oakSequence), true);
});

test('Pewter and badge RAM prove forest traversal and Brock independently', () => {
    const beforeBrock = deriveRedppGuideObjectives({
        location: 'PEWTER CITY',
        party,
        progressFlags: { battledRivalInOaksLab: true, gotPokedex: true },
        badges: [],
    });
    assert.equal(beforeBrock.has(REDPP_PROVABLE_OBJECTIVES.forest), true);
    assert.equal(beforeBrock.has(REDPP_PROVABLE_OBJECTIVES.boulder), false);

    const afterBrock = deriveRedppGuideObjectives({
        location: 'PEWTER GYM',
        party,
        progressFlags: { battledRivalInOaksLab: true, gotPokedex: true },
        badges: ['Boulder'],
    });
    assert.equal(afterBrock.has(REDPP_PROVABLE_OBJECTIVES.boulder), true);
});

test('retains explicit objective history without mutating its input', () => {
    const existing = ['custom_objective'];
    const completed = deriveRedppGuideObjectives({ location: 'PALLET TOWN', party }, existing);
    assert.deepEqual(existing, ['custom_objective']);
    assert.equal(completed.has('custom_objective'), true);
});
