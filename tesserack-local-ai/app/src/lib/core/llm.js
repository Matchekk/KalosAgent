// llm.js - LLM backend abstraction (Browser WebLLM + OpenAI-compatible APIs)
import {
    recordTokenUsage,
    setConnectionStatus,
    setAvailableModels,
    getConfig
} from '../stores/llm.js';

let engine = null;
const CONNECTION_TIMEOUT_MS = 5000;
const CHAT_TIMEOUT_MS = 120000;

/**
 * Join an OpenAI-compatible base endpoint and API path without double slashes.
 */
export function buildApiUrl(endpoint, path) {
    const base = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('No endpoint configured');
    return `${base}/${String(path).replace(/^\/+/, '')}`;
}

/**
 * Keep an explicit model choice, otherwise use the first model discovered from
 * an OpenAI-compatible endpoint. This makes local servers a one-click setup.
 */
export function selectDiscoveredModel(currentModel, models = []) {
    const explicit = String(currentModel || '').trim();
    if (explicit) return explicit;
    return String(models[0]?.id || '').trim();
}

function getCompletionContent(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        throw new Error('API returned no completion text');
    }
    return content;
}

/**
 * Initialize WebLLM engine for browser-based inference
 */
export async function initBrowserLLM(modelId, onProgress) {
    console.log('Initializing WebLLM with model:', modelId);

    // WebLLM is several megabytes and only needed for the browser provider.
    // Keep it out of the initial route for users of llama.cpp and other APIs.
    const webllm = await import('@mlc-ai/web-llm');
    engine = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (progress) => {
            if (onProgress) {
                onProgress(progress);
            }
        }
    });

    return engine;
}

/**
 * Check if WebLLM engine is ready
 */
export function isBrowserLLMReady() {
    return engine !== null;
}

/**
 * Test connection to API endpoint and fetch available models
 */
export async function testConnection(endpoint, apiKey = '') {
    setConnectionStatus('checking');
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }

        const response = await fetch(buildApiUrl(endpoint, 'models'), {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
        });

        if (!response.ok) {
            setConnectionStatus('error');
            return { success: false, error: `HTTP ${response.status}`, models: [] };
        }

        const data = await response.json();
        const models = (data.data || []).map(m => ({
            id: m.id,
            name: m.id,
        }));

        setConnectionStatus('connected');
        setAvailableModels(models);
        return { success: true, models };
    } catch (err) {
        console.log('API connection failed:', err.message);
        setConnectionStatus('error');
        setAvailableModels([]);
        return { success: false, error: err.message, models: [] };
    }
}

/**
 * Chat via OpenAI-compatible API endpoint
 */
async function chatApi(endpoint, model, apiKey, systemPrompt, history, userMessage, maxTokens) {
    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
    ];

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const startTime = performance.now();

    const response = await fetch(buildApiUrl(endpoint, 'chat/completions'), {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
        body: JSON.stringify({
            model,
            messages,
            max_tokens: maxTokens,
            temperature: 0.7,
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const duration = performance.now() - startTime;

    if (data.usage) {
        recordTokenUsage(data.usage, duration);
    }

    return getCompletionContent(data);
}

/**
 * Chat via WebLLM (browser)
 */
async function chatBrowser(systemPrompt, history, userMessage, maxTokens) {
    if (!engine) {
        throw new Error('WebLLM not initialized');
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
    ];

    const startTime = performance.now();

    const response = await engine.chat.completions.create({
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
    });

    const duration = performance.now() - startTime;

    if (response.usage) {
        recordTokenUsage(response.usage, duration);
    }

    return getCompletionContent(response);
}

/**
 * Main chat function - routes to appropriate backend based on config
 */
export async function chat(systemPrompt, history = [], userMessage, maxTokens = 256) {
    const config = getConfig();

    if (config.isBrowser) {
        return chatBrowser(systemPrompt, history, userMessage, maxTokens);
    } else {
        if (!config.model) {
            throw new Error('No model configured');
        }
        if (!config.endpoint) {
            throw new Error('No endpoint configured');
        }
        return chatApi(
            config.endpoint,
            config.model,
            config.apiKey,
            systemPrompt,
            history,
            userMessage,
            maxTokens
        );
    }
}

/**
 * Legacy generate function for backwards compatibility
 */
export async function generate(prompt, maxTokens = 256) {
    return chat('', [], prompt, maxTokens);
}

/**
 * Check if LLM is ready (either backend)
 */
export function isReady() {
    const config = getConfig();
    if (config.isBrowser) {
        return engine !== null;
    }
    // For API providers, we're "ready" if we have endpoint and model configured
    return !!config.endpoint && !!config.model;
}

/**
 * Reset the chat context (WebLLM only)
 */
export async function resetContext() {
    if (engine) {
        try {
            await engine.resetChat();
            console.log('LLM context reset');
        } catch (err) {
            console.warn('Failed to reset LLM context:', err);
        }
    }
}

/**
 * Get engine stats for debugging (WebLLM only)
 */
export function getStats() {
    if (engine && engine.stats) {
        return engine.stats();
    }
    return null;
}
