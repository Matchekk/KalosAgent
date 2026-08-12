import test from 'node:test';
import assert from 'node:assert/strict';

import { RecurrentObservationMemory } from '../src/lib/core/lab/recurrent-observation.js';

test('recurrent visual memory distinguishes equal current frames by history', () => {
    const darkThenLight = new RecurrentObservationMemory(32);
    const lightOnly = new RecurrentObservationMemory(32);
    const dark = Float32Array.from({ length: 64 }, (_, index) => 1 - index / 63);
    const light = Float32Array.from({ length: 64 }, (_, index) => index / 63);

    darkThenLight.update(dark);
    darkThenLight.update(light);
    lightOnly.update(light);

    assert.notDeepEqual([...darkThenLight.state], [...lightOnly.state]);
    assert.ok(darkThenLight.state.every(Number.isFinite));
});

test('recurrent visual memory is deterministic, bounded and resettable', () => {
    const left = new RecurrentObservationMemory(32);
    const right = new RecurrentObservationMemory(32);
    const input = Float32Array.from({ length: 64 }, (_, index) => index / 63);
    for (let step = 0; step < 100; step++) {
        left.update(input);
        right.update(input);
    }
    assert.deepEqual([...left.state], [...right.state]);
    assert.ok(left.state.every(value => value >= -1 && value <= 1));
    left.reset();
    assert.ok(left.state.every(value => value === 0));
});
