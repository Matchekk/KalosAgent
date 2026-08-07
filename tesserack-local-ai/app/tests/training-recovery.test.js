import assert from 'node:assert/strict';
import test from 'node:test';

import {
    DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES,
    isFatalEmulatorError,
    shouldRecycleEnvironments,
} from '../src/lib/core/lab/training-recovery.js';

test('recognizes fatal WASM memory failures', () => {
    assert.equal(isFatalEmulatorError(new Error('Aborted(OOM). Build with -sASSERTIONS')), true);
    assert.equal(isFatalEmulatorError(new WebAssembly.RuntimeError('memory access out of bounds')), true);
    assert.equal(isFatalEmulatorError(new Error('State size mismatch')), false);
});

test('recycles only after the per-lifecycle sample budget', () => {
    assert.equal(shouldRecycleEnvironments(DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES - 1, 0), false);
    assert.equal(shouldRecycleEnvironments(DEFAULT_ENVIRONMENT_RECYCLE_SAMPLES, 0), true);
    assert.equal(shouldRecycleEnvironments(410_000, 250_000), true);
    assert.equal(shouldRecycleEnvironments(10, 20), false);
});
