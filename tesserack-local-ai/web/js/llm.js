// llm.js - WebLLM wrapper
import * as webllm from '@mlc-ai/web-llm';

let engine = null;

export async function initLLM(onProgress) {
    const selectedModel = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

    engine = await webllm.CreateMLCEngine(selectedModel, {
        initProgressCallback: (progress) => {
            if (onProgress) {
                onProgress(progress);
            }
        }
    });

    return engine;
}

/**
 * Generate a response using conversation format with system message
 * @param {string} systemPrompt - System instructions
 * @param {Array} history - Array of {role, content} messages
 * @param {string} userMessage - Current user message
 * @param {number} maxTokens - Max tokens to generate
 * @returns {Promise<string>}
 */
export async function chat(systemPrompt, history = [], userMessage, maxTokens = 256) {
    if (!engine) {
        throw new Error('LLM not initialized');
    }

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage }
    ];

    const response = await engine.chat.completions.create({
        messages,
        max_tokens: maxTokens,
        temperature: 0.7,
    });

    return response.choices[0].message.content;
}

// Legacy function for backwards compatibility
export async function generate(prompt, maxTokens = 256) {
    if (!engine) {
        throw new Error('LLM not initialized');
    }

    const response = await engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
    });

    return response.choices[0].message.content;
}

export function isReady() {
    return engine !== null;
}

/**
 * Reset the chat context to free memory
 * Call this periodically to prevent memory buildup
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
 * Get engine stats for debugging
 */
export function getStats() {
    if (engine && engine.stats) {
        return engine.stats();
    }
    return null;
}
