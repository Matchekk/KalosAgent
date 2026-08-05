import test from 'node:test';
import assert from 'node:assert/strict';

import { isInteractiveKeyboardTarget } from '../src/lib/core/keyboard.js';

test('global game shortcuts ignore form and editable targets', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']) {
        assert.equal(isInteractiveKeyboardTarget({ tagName }), true);
    }
    assert.equal(isInteractiveKeyboardTarget({ tagName: 'DIV', isContentEditable: true }), true);
});

test('nested control content is interactive but the page background is not', () => {
    assert.equal(isInteractiveKeyboardTarget({ tagName: 'svg', closest: () => ({ tagName: 'BUTTON' }) }), true);
    assert.equal(isInteractiveKeyboardTarget({ tagName: 'DIV', closest: () => null }), false);
    assert.equal(isInteractiveKeyboardTarget(null), false);
});
