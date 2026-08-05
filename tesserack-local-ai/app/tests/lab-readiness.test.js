import test from 'node:test';
import assert from 'node:assert/strict';

import { getLabRunBlockReason } from '../src/lib/core/lab/lab-readiness.js';

const ready = {
    romLoaded: true,
    labInitialized: true,
    mode: 'play',
    provider: 'llamacpp',
    endpoint: 'http://localhost:8080/v1',
    model: 'local-mini',
};

test('Lab readiness reports setup steps in user-action order', () => {
    assert.match(getLabRunBlockReason({ ...ready, romLoaded: false }), /Load a ROM/);
    assert.match(getLabRunBlockReason({ ...ready, labInitialized: false }), /initializing/);
    assert.match(getLabRunBlockReason({ ...ready, endpoint: '' }), /endpoint/);
    assert.match(getLabRunBlockReason({ ...ready, model: '' }), /model/);
    assert.equal(getLabRunBlockReason(ready), '');
});

test('browser auto-load and training remain valid start paths', () => {
    assert.equal(getLabRunBlockReason({ ...ready, provider: 'browser', model: '' }), '');
    assert.equal(getLabRunBlockReason({ ...ready, mode: 'train', endpoint: '', model: '' }), '');
});

test('hosted providers require their API key before starting', () => {
    assert.match(getLabRunBlockReason({ ...ready, provider: 'openai', needsApiKey: true, apiKey: '' }), /API key/);
    assert.equal(getLabRunBlockReason({ ...ready, provider: 'openai', needsApiKey: true, apiKey: 'secret' }), '');
});
