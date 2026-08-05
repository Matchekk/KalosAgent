import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getDialogAdvanceDecision,
    getDialogPlanBias,
    isInteractiveDialogScreen,
    MAX_UNCHANGED_DIALOG_PRESSES,
} from '../src/lib/core/dialog-advance.js';

test('changing dialog pages advance immediately without waiting for the LLM', () => {
    let tracker = {};

    for (const dialog of ['Hello there!', 'Welcome to Pokemon!', 'My name is Oak.']) {
        const decision = getDialogAdvanceDecision({ dialog, inBattle: false }, tracker);
        assert.equal(decision.shouldAdvance, true);
        tracker = decision.tracker;
    }
});

test('unchanged dialog has a bounded retry budget', () => {
    let decision = getDialogAdvanceDecision({ dialog: 'Long speech', inBattle: false }, {});
    assert.equal(decision.shouldAdvance, true);

    for (let i = 0; i < MAX_UNCHANGED_DIALOG_PRESSES; i++) {
        decision = getDialogAdvanceDecision(
            { dialog: 'Long speech', inBattle: false },
            decision.tracker,
        );
        assert.equal(decision.shouldAdvance, true);
    }

    decision = getDialogAdvanceDecision(
        { dialog: 'Long speech', inBattle: false },
        decision.tracker,
    );
    assert.equal(decision.shouldAdvance, false);
});

test('name entry and explicit choices are not auto-confirmed', () => {
    assert.equal(isInteractiveDialogScreen('Your name? AI Lower Case'), true);
    assert.equal(isInteractiveDialogScreen('Continue New Game Option'), true);
    assert.equal(isInteractiveDialogScreen('YES NO'), true);

    assert.equal(
        getDialogAdvanceDecision({ dialog: 'Your name? AI Lower Case', inBattle: false }).shouldAdvance,
        false,
    );
});

test('battle text is left to the agent to avoid selecting moves blindly', () => {
    assert.equal(
        getDialogAdvanceDecision({ dialog: 'Enemy used TACKLE!', inBattle: true }).shouldAdvance,
        false,
    );
});

test('dialog plans strongly favor A bursts over stale movement', () => {
    const advanceScore = getDialogPlanBias(['a', 'a', 'a', 'a', 'a', 'a']);
    const movementScore = getDialogPlanBias(['down', 'down', 'left', 'right']);

    assert.ok(advanceScore > movementScore);
});
