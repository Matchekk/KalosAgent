// LLM state store - manages LLM backend configuration and status
import { writable, derived } from 'svelte/store';

// Provider presets
export const PROVIDERS = {
    browser: {
        id: 'browser',
        name: 'Browser (WebGPU)',
        description: 'Runs locally in your browser. No API key needed.',
        needsKey: false,
        endpoint: null,
        models: [
            { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B', size: '~1.5GB', default: true },
            { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 3B', size: '~2.5GB' },
            { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B', size: '~1.2GB' },
            { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 3B', size: '~2.5GB' },
            { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', name: 'Phi 3.5 Mini', size: '~2.4GB' },
            { id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC', name: 'SmolLM2 1.7B', size: '~1.3GB' },
        ],
    },
    openai: {
        id: 'openai',
        name: 'OpenAI',
        description: 'GPT-4o, GPT-4o-mini, and more',
        needsKey: true,
        endpoint: 'https://api.openai.com/v1',
        models: [
            { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Fast & cheap', default: true },
            { id: 'gpt-4o', name: 'GPT-4o', description: 'Flagship model' },
            { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', description: '128k context' },
            { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', description: 'Legacy, cheapest' },
            { id: 'o1-mini', name: 'o1-mini', description: 'Reasoning model' },
        ],
    },
    groq: {
        id: 'groq',
        name: 'Groq',
        description: 'Ultra-fast inference, generous free tier',
        needsKey: true,
        endpoint: 'https://api.groq.com/openai/v1',
        models: [
            { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', description: 'Best quality', default: true },
            { id: 'llama-3.1-70b-versatile', name: 'Llama 3.1 70B', description: 'High quality' },
            { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', description: 'Fastest' },
            { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', description: '32k context' },
        ],
    },
    together: {
        id: 'together',
        name: 'Together AI',
        description: 'Wide model selection',
        needsKey: true,
        endpoint: 'https://api.together.xyz/v1',
        models: [
            { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', default: true },
            { id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', name: 'Llama 3.1 8B Turbo' },
            { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen 2.5 72B Turbo' },
            { id: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B', name: 'DeepSeek R1 70B' },
        ],
    },
    ollama: {
        id: 'ollama',
        name: 'Ollama (Local)',
        description: 'Local server on your machine',
        needsKey: false,
        endpoint: 'http://localhost:11434/v1',
        models: [], // Fetched dynamically
        detectEndpoint: 'http://localhost:11434/v1',
    },
    lmstudio: {
        id: 'lmstudio',
        name: 'LM Studio (Local)',
        description: 'Local server on your machine',
        needsKey: false,
        endpoint: 'http://localhost:1234/v1',
        models: [], // Fetched dynamically
        detectEndpoint: 'http://localhost:1234/v1',
    },
    llamacpp: {
        id: 'llamacpp',
        name: 'llama.cpp (Local)',
        description: 'Local llama.cpp server',
        needsKey: false,
        endpoint: 'http://localhost:8080/v1',
        models: [], // Fetched dynamically
        detectEndpoint: 'http://localhost:8080/v1',
    },
    custom: {
        id: 'custom',
        name: 'Custom Endpoint',
        description: 'Any OpenAI-compatible API',
        needsKey: false, // Optional
        endpoint: '',
        models: [], // Fetched or manual
    },
};

// localStorage keys
const KEYS = {
    provider: 'tesserack-llm-provider',
    model: 'tesserack-llm-model',
    customEndpoint: 'tesserack-llm-custom-endpoint',
    customModel: 'tesserack-llm-custom-model',
    llamacppEndpoint: 'tesserack-llm-llamacpp-endpoint',
    llamacppModel: 'tesserack-llm-llamacpp-model',
};

// Get provider-specific API key storage key
function getApiKeyKey(providerId) {
    return `tesserack-llm-apikey-${providerId}`;
}

// Get value from localStorage with fallback
function getStored(key, defaultValue) {
    if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(key);
        return stored !== null ? stored : defaultValue;
    }
    return defaultValue;
}

// Set value in localStorage
function setStored(key, value) {
    if (typeof localStorage !== 'undefined') {
        if (value === null || value === undefined || value === '') {
            localStorage.removeItem(key);
        } else {
            localStorage.setItem(key, value);
        }
    }
}

// Get API key for a provider (checks localStorage, then env vars)
function getApiKeyForProvider(providerId) {
    // First check localStorage
    const stored = getStored(getApiKeyKey(providerId), '');
    if (stored) return stored;

    // Fall back to environment variables (for local development)
    // These are injected at build time via Vite
    if (typeof import.meta !== 'undefined' && import.meta.env) {
        const envKey = `VITE_${providerId.toUpperCase()}_API_KEY`;
        return import.meta.env[envKey] || '';
    }
    return '';
}

// Initialize state from localStorage
function getInitialState() {
    const providerId = getStored(KEYS.provider, 'browser');
    const provider = PROVIDERS[providerId] || PROVIDERS.browser;
    const defaultModel = provider.models?.find(m => m.default)?.id || provider.models?.[0]?.id || '';

    return {
        // Runtime status
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
        progress: 0,
        message: '',
        error: null,

        // Provider configuration (persisted)
        provider: providerId,
        model: getStored(KEYS.model, defaultModel),
        apiKey: getApiKeyForProvider(providerId),
        customEndpoint: getStored(KEYS.customEndpoint, ''),
        customModel: getStored(KEYS.customModel, ''),
        llamacppEndpoint: getStored(KEYS.llamacppEndpoint, 'http://localhost:8080/v1'),
        llamacppModel: getStored(KEYS.llamacppModel, ''),

        // Connection status (runtime only)
        connectionStatus: 'unknown', // 'unknown' | 'checking' | 'connected' | 'error'
        availableModels: [], // For local providers, fetched from API
    };
}

export const llmState = writable(getInitialState());

// Token statistics store
export const tokenStats = writable({
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    requestCount: 0,
    lastRequestTokens: 0,
    lastTokensPerSecond: 0,
    avgTokensPerSecond: 0,
    totalGenerationTime: 0,
});

// Derived stores
export const isLLMReady = derived(llmState, $state => $state.status === 'ready');
export const isLLMLoading = derived(llmState, $state => $state.status === 'loading');
export const currentProvider = derived(llmState, $state => PROVIDERS[$state.provider] || PROVIDERS.browser);

// State update helpers
export function setLLMProgress(progress) {
    llmState.update(state => ({
        ...state,
        status: 'loading',
        progress: progress.progress || 0,
        message: progress.text || 'Loading model...',
    }));
}

export function setLLMReady() {
    llmState.update(state => ({
        ...state,
        status: 'ready',
        progress: 1,
        message: 'Model ready',
    }));
}

export function setLLMError(error) {
    llmState.update(state => ({
        ...state,
        status: 'error',
        error: error.message || error,
        message: 'Failed to load model',
    }));
}

// Configuration setters (persist to localStorage)
export function setProvider(providerId) {
    const provider = PROVIDERS[providerId];
    if (!provider) return;

    setStored(KEYS.provider, providerId);

    // Set default model for this provider
    const defaultModel = provider.models?.find(m => m.default)?.id || provider.models?.[0]?.id || '';
    setStored(KEYS.model, defaultModel);

    // Load API key for this provider
    const apiKey = getApiKeyForProvider(providerId);

    llmState.update(state => ({
        ...state,
        provider: providerId,
        model: defaultModel,
        apiKey: apiKey,
        status: 'idle',
        connectionStatus: 'unknown',
        availableModels: [],
    }));
}

export function setModel(modelId) {
    setStored(KEYS.model, modelId);
    llmState.update(state => ({ ...state, model: modelId }));
}

export function setApiKey(key, providerId = null) {
    // Get current provider if not specified
    let currentProvider = providerId;
    if (!currentProvider) {
        currentProvider = getStored(KEYS.provider, 'browser');
    }
    setStored(getApiKeyKey(currentProvider), key);
    llmState.update(state => ({ ...state, apiKey: key }));
}

export function setCustomEndpoint(endpoint) {
    setStored(KEYS.customEndpoint, endpoint);
    llmState.update(state => ({ ...state, customEndpoint: endpoint }));
}

export function setCustomModel(model) {
    setStored(KEYS.customModel, model);
    llmState.update(state => ({ ...state, customModel: model }));
}

export function setLlamacppEndpoint(endpoint) {
    setStored(KEYS.llamacppEndpoint, endpoint);
    llmState.update(state => ({ ...state, llamacppEndpoint: endpoint }));
}

export function setLlamacppModel(model) {
    setStored(KEYS.llamacppModel, model);
    llmState.update(state => ({ ...state, llamacppModel: model }));
}

// Connection status helpers
export function setConnectionStatus(status) {
    llmState.update(state => ({ ...state, connectionStatus: status }));
}

export function setAvailableModels(models) {
    llmState.update(state => ({ ...state, availableModels: models }));
}

// Get current config for API calls
export function getConfig() {
    const providerId = getStored(KEYS.provider, 'browser');
    const provider = PROVIDERS[providerId] || PROVIDERS.browser;
    const model = getStored(KEYS.model, provider.models?.find(m => m.default)?.id || '');
    const apiKey = getApiKeyForProvider(providerId);

    let endpoint = provider.endpoint;
    let finalModel = model;

    if (providerId === 'custom') {
        endpoint = getStored(KEYS.customEndpoint, '');
        finalModel = getStored(KEYS.customModel, '') || model;
    } else if (providerId === 'llamacpp') {
        endpoint = getStored(KEYS.llamacppEndpoint, 'http://localhost:8080/v1');
        finalModel = getStored(KEYS.llamacppModel, '') || model;
    }

    return {
        provider: providerId,
        endpoint,
        model: finalModel,
        apiKey,
        isBrowser: providerId === 'browser',
    };
}

/**
 * Record token usage from a completion
 */
export function recordTokenUsage(usage, durationMs) {
    if (!usage) return;

    const completionTokens = usage.completion_tokens || 0;
    const tokensPerSecond = durationMs > 0 ? (completionTokens / (durationMs / 1000)) : 0;

    tokenStats.update(stats => {
        const newTotalGenTime = stats.totalGenerationTime + durationMs;
        const newTotalCompletion = stats.totalCompletionTokens + completionTokens;
        const avgTps = newTotalGenTime > 0 ? (newTotalCompletion / (newTotalGenTime / 1000)) : 0;

        return {
            totalPromptTokens: stats.totalPromptTokens + (usage.prompt_tokens || 0),
            totalCompletionTokens: newTotalCompletion,
            totalTokens: stats.totalTokens + (usage.total_tokens || 0),
            requestCount: stats.requestCount + 1,
            lastRequestTokens: completionTokens,
            lastTokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
            avgTokensPerSecond: Math.round(avgTps * 10) / 10,
            totalGenerationTime: newTotalGenTime,
        };
    });
}
