# Local OpenAI-Compatible API Endpoint Support

**Date:** 2026-01-24
**Status:** Approved for implementation

## Overview

Add support for local OpenAI V1-compatible endpoints (e.g., LM Studio) alongside the existing WebLLM browser-based models, with a unified model selector in AdvancedPanel.

## Requirements

1. Unified model dropdown combining WebLLM and local API models
2. Auto-detect local API at `localhost:1234/v1` (LM Studio default) with override field
3. Fetch available models from `/v1/models` endpoint
4. Graceful fallback: if local API offline, show only WebLLM models with subtle indicator
5. Persist preferences to localStorage (endpoint URL, selected model)
6. If saved model is local but API is down, fall back to WebLLM default but remember preference
7. Reposition model selection to top of AdvancedPanel

## Design

### State Management

**New localStorage keys:**
- `tesserack-local-api-url` - Custom endpoint URL (default: `http://localhost:1234/v1`)
- `tesserack-selected-model` - Existing key, now stores WebLLM IDs or `local:`-prefixed IDs

**Updates to `stores/llm.js`:**

```javascript
export const llmState = writable({
  // ... existing fields ...
  localApiStatus: 'unknown',  // 'unknown' | 'checking' | 'available' | 'offline'
  localApiUrl: 'http://localhost:1234/v1',
  localModels: [],  // Array of { id, name } from /v1/models
});
```

**Model identification:**
- WebLLM: `Qwen2.5-1.5B-Instruct-q4f16_1-MLC`
- Local: `local:qwen2.5-7b-instruct`

### Local API Integration (`llm.js`)

```javascript
// Check if local API is available and fetch models
export async function probeLocalApi(baseUrl = 'http://localhost:1234/v1') {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return { available: false, models: [] };

    const data = await response.json();
    const models = data.data.map(m => ({
      id: `local:${m.id}`,
      name: m.id,
      backend: 'local',
    }));
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  }
}

// Chat via OpenAI-compatible endpoint
export async function chatLocal(baseUrl, model, systemPrompt, history, userMessage, maxTokens = 150) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const start = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.replace('local:', ''),
      messages,
      max_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  const duration = performance.now() - start;

  if (data.usage) {
    recordTokenUsage(data.usage, duration);
  }

  return data.choices[0].message.content;
}
```

### Chat Routing

Update `chat()` to dispatch based on model prefix:

```javascript
export async function chat(systemPrompt, history, userMessage, maxTokens = 150) {
  const selectedModel = getSelectedModel();

  if (selectedModel.startsWith('local:')) {
    const url = getLocalApiUrl();
    return chatLocal(url, selectedModel, systemPrompt, history, userMessage, maxTokens);
  } else {
    // Existing WebLLM code
  }
}
```

### Startup Changes (`game-init.js`)

```javascript
export async function startWatchMode() {
  const selectedModel = getSelectedModel();

  if (selectedModel.startsWith('local:')) {
    const { available } = await probeLocalApi(getLocalApiUrl());
    if (!available) {
      feedSystem('Local API unavailable. Falling back to browser model.');
      await initLLM(onProgress);
    } else {
      setLLMReady();
      feedSystem('Connected to local API.');
    }
  } else {
    await initLLM(onProgress);
  }

  rlAgentInstance.run();
}
```

### UI Changes (`AdvancedPanel.svelte`)

**Section order (top to bottom):**
1. Model Selection (moved from bottom)
2. Neural Network Training
3. Data Export

**Unified dropdown with optgroups:**

```svelte
<select bind:value={selectedModelId} on:change={handleModelChange}>
  <optgroup label="Browser (WebLLM)">
    {#each AVAILABLE_MODELS as model}
      <option value={model.id}>{model.name} ({model.size})</option>
    {/each}
  </optgroup>

  {#if $llmState.localApiStatus === 'available' && $llmState.localModels.length > 0}
    <optgroup label="Local API">
      {#each $llmState.localModels as model}
        <option value={model.id}>{model.name}</option>
      {/each}
    </optgroup>
  {/if}
</select>
```

**Endpoint configuration field:**

```svelte
<div class="endpoint-config">
  <label>Local API Endpoint</label>
  <input
    type="text"
    bind:value={localApiUrl}
    placeholder="http://localhost:1234/v1"
    on:blur={handleEndpointChange}
  />
  <span class="status-indicator">
    {#if $llmState.localApiStatus === 'available'}
      ● Connected
    {:else if $llmState.localApiStatus === 'checking'}
      ○ Checking...
    {:else}
      ○ Offline
    {/if}
  </span>
  <button on:click={refreshLocalApi}>↻</button>
</div>
```

### Error Handling

**Connection loss mid-session:**
- Catch error in `chatLocal()`
- Update `localApiStatus` to `'offline'`
- Throw error for agent to handle

**Model unloaded:**
- On `probeLocalApi()`, model list updates
- If selected model gone, show warning in UI

**CORS:**
- LM Studio permissive by default
- Remote endpoints may need CORS configuration
- Failed fetch → status shows "Offline"

## Files to Modify

1. `svelte-app/src/lib/stores/llm.js` - Add local API state
2. `svelte-app/src/lib/core/llm.js` - Add `probeLocalApi()`, `chatLocal()`, update dispatcher
3. `svelte-app/src/lib/core/game-init.js` - Handle local API in startup
4. `svelte-app/src/lib/components/AdvancedPanel.svelte` - UI changes, reorder sections
