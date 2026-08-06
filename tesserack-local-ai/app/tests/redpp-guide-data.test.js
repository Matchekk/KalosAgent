import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { redppGuideToBundles, redppGuideToGraph } from '../src/lib/core/lab/redpp-guide-data.js';
import { CURRICULUM } from '../src/lib/core/curriculum.js';

const guide = JSON.parse(await readFile(new URL('../static/data/redpp-oak-guide.json', import.meta.url), 'utf8'));

test('Red++ guide is versioned and explicitly advisory across ROM versions', () => {
    assert.equal(guide.meta.sourceGuideVersion, '4.5.3');
    assert.equal(guide.meta.targetRomVersion, '3.0.2');
    assert.match(guide.meta.compatibility, /RAM is authoritative/i);
    assert.equal(guide.meta.challengeRulesApplied, false);
});

test('Red++ guide converts to a connected Champion-first graph', () => {
    const graph = redppGuideToGraph(guide);
    assert.equal(graph.championRoute.length, 11);
    assert.ok(graph.nodes.some(node => node.type === 'objective' && node.name === 'Become Pokemon Champion'));
    assert.ok(graph.nodes.some(node => node.type === 'pokemon' && node.name.includes('Magnezone')));
    assert.ok(graph.edges.some(edge => edge.type === 'leads_to'));
});

test('guide bundles contain context but cannot inject numeric rewards', () => {
    const bundles = redppGuideToBundles(guide);
    assert.ok(bundles['SAFARI ZONE'].objectives.includes('Obtain HM03 Surf'));
    assert.ok(bundles['VERMILION CITY'].objectives.includes('Prepare and board the S.S. Anne'));
    assert.ok(bundles['VERMILION CITY'].objectives.includes('Defeat Lt. Surge for the Thunder Badge'));
    assert.equal(bundles['SAFARI ZONE'].tests.length, 0);
    assert.equal(bundles['SAFARI ZONE'].penalties.length, 0);
    assert.equal(Object.values(bundles).some(bundle => bundle.tests?.some(entry => 'reward' in entry)), false);
});

test('runtime curriculum follows the Red++ Oak badge order and ends at Champion', () => {
    const badges = CURRICULUM.filter(entry => entry.type === 'badge').map(entry => entry.name);
    assert.deepEqual(badges, [
        'Boulder Badge', 'Cascade Badge', 'Soul Badge', 'Rainbow Badge',
        'Thunder Badge', 'Marsh Badge', 'Volcano Badge', 'Earth Badge',
    ]);
    assert.equal(CURRICULUM.at(-1).name, 'Become Pokemon Champion');
    assert.ok(CURRICULUM.every(entry => entry.reward === 0));
});
