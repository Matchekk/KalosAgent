import test from 'node:test';
import assert from 'node:assert/strict';

import { parseMultiplePlans } from '../src/lib/core/action-parser.js';

test('numbered plans retain startup controls and pair by plan number', () => {
    const plans = parseMultiplePlans(`PLAN2: Move after boot
ACTIONS1: down, down
PLAN1: Leave title screen
ACTIONS2: start, a, right`);

    assert.deepEqual(plans, [
        { plan: 'Move after boot', actions: ['start', 'a', 'right'] },
        { plan: 'Leave title screen', actions: ['down', 'down'] },
    ]);
});

test('multi-plan parser supports plan numbers above nine', () => {
    assert.deepEqual(parseMultiplePlans('PLAN10: Continue\nACTIONS10: start, a'), [
        { plan: 'Continue', actions: ['start', 'a'] },
    ]);
});

test('runaway and raw mini-model outputs are capped and remain actionable', () => {
    const repeated = Array(30).fill('a').join(', ');
    assert.equal(parseMultiplePlans(`PLAN1: Continue\nACTIONS1: ${repeated}`)[0].actions.length, 12);
    assert.deepEqual(parseMultiplePlans('a\nstart'), [
        { plan: 'Direct action plan', actions: ['a', 'start'] },
    ]);
});
