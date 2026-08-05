import test from 'node:test';
import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
};

const {
    buildApiUrl,
    chat,
    selectDiscoveredModel,
    testConnection,
} = await import('../src/lib/core/llm.js');
const {
    setLlamacppEndpoint,
    setLlamacppModel,
    setProvider,
} = await import('../src/lib/stores/llm.js');

test('buildApiUrl normalizes whitespace and trailing slashes', () => {
    assert.equal(
        buildApiUrl('  http://localhost:8080/v1/// ', '/models'),
        'http://localhost:8080/v1/models'
    );
    assert.throws(() => buildApiUrl('', 'models'), /No endpoint configured/);
});

test('selectDiscoveredModel fills only a blank model choice', () => {
    const discovered = [{ id: 'local-mini' }, { id: 'other-model' }];

    assert.equal(selectDiscoveredModel('', discovered), 'local-mini');
    assert.equal(selectDiscoveredModel('  ', discovered), 'local-mini');
    assert.equal(selectDiscoveredModel('my-explicit-model', discovered), 'my-explicit-model');
    assert.equal(selectDiscoveredModel('', []), '');
});

test('testConnection uses the normalized models endpoint', async (t) => {
    let requestedUrl;
    t.mock.method(globalThis, 'fetch', async (url) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ data: [{ id: 'tiny-model' }] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    const result = await testConnection('http://localhost:8080/v1/');

    assert.equal(requestedUrl, 'http://localhost:8080/v1/models');
    assert.deepEqual(result, {
        success: true,
        models: [{ id: 'tiny-model', name: 'tiny-model' }],
    });
});

test('chat validates malformed OpenAI-compatible responses', async (t) => {
    values.clear();
    setProvider('llamacpp');
    setLlamacppEndpoint('http://localhost:8080/v1/');
    setLlamacppModel('tiny-model');

    let requestedUrl;
    t.mock.method(globalThis, 'fetch', async (url) => {
        requestedUrl = url;
        return new Response(JSON.stringify({ choices: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    });

    await assert.rejects(
        chat('system', [], 'move', 16),
        /API returned no completion text/
    );
    assert.equal(requestedUrl, 'http://localhost:8080/v1/chat/completions');
});
