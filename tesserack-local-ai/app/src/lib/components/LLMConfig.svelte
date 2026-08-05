<script>
    import {
        llmState,
        tokenStats,
        PROVIDERS,
        setProvider,
        setModel,
        setApiKey,
        setCustomEndpoint,
        setCustomModel,
        setLlamacppEndpoint,
        setLlamacppModel
    } from '$lib/stores/llm';
    import { ChevronDown, ChevronUp, RefreshCw, Check, AlertCircle } from 'lucide-svelte';
    import { testConnection } from '$lib/core/llm.js';

    let expanded = true;

    // Local state
    let apiKey = $llmState.apiKey;
    let customEndpoint = $llmState.customEndpoint;
    let customModel = $llmState.customModel;
    let llamacppEndpoint = $llmState.llamacppEndpoint;
    let llamacppModel = $llmState.llamacppModel;
    let showApiKey = false;
    let testing = false;
    let testResult = null; // null | 'success' | 'error'
    let testError = '';

    // Track if browser model changed (requires reload)
    let browserModelChanged = false;
    let originalBrowserModel = $llmState.model;

    $: provider = PROVIDERS[$llmState.provider] || PROVIDERS.browser;
    $: isLocal = ['ollama', 'lmstudio'].includes($llmState.provider);
    $: isCustom = $llmState.provider === 'custom';
    $: isLlamacpp = $llmState.provider === 'llamacpp';
    $: isBrowser = $llmState.provider === 'browser';

    function handleProviderChange(providerId) {
        setProvider(providerId);
        // Reset tracking
        browserModelChanged = false;
        originalBrowserModel = PROVIDERS[providerId]?.models?.find(m => m.default)?.id || '';
        // Reset test state
        testResult = null;
        testError = '';
    }

    // Sync local apiKey with store when provider changes (store loads per-provider key)
    $: apiKey = $llmState.apiKey;

    function handleModelChange(event) {
        const newModel = event.target.value;
        setModel(newModel);
        if (isBrowser) {
            browserModelChanged = newModel !== originalBrowserModel;
        }
    }

    function handleApiKeyBlur() {
        setApiKey(apiKey);
        // Reset test state when API key changes
        testResult = null;
        testError = '';
    }

    function handleCustomEndpointBlur() {
        setCustomEndpoint(customEndpoint);
    }

    function handleCustomModelBlur() {
        setCustomModel(customModel);
    }

    async function handleTestConnection() {
        testing = true;
        testResult = null;
        testError = '';
        const endpoint = isCustom ? customEndpoint : isLlamacpp ? llamacppEndpoint : provider.endpoint;
        const result = await testConnection(endpoint, apiKey);
        testing = false;
        if (result.success) {
            testResult = 'success';
        } else {
            testResult = 'error';
            testError = result.error || 'Connection failed';
        }
    }

    function selectAvailableModel(modelId) {
        if (isCustom) {
            customModel = modelId;
            setCustomModel(modelId);
        } else if (isLlamacpp) {
            llamacppModel = modelId;
            setLlamacppModel(modelId);
        } else {
            setModel(modelId);
        }
    }

    function reloadPage() {
        window.location.reload();
    }
</script>

<div class="llm-config">
    <button class="toggle-btn" on:click={() => expanded = !expanded}>
        {#if expanded}
            <ChevronUp size={16} />
        {:else}
            <ChevronDown size={16} />
        {/if}
        LLM Configuration
    </button>

    {#if expanded}
        <div class="config-content">
            <!-- Provider Selection -->
            <div class="provider-grid">
                {#each Object.values(PROVIDERS) as p}
                    <button
                        class="provider-card"
                        class:selected={$llmState.provider === p.id}
                        on:click={() => handleProviderChange(p.id)}
                    >
                        <span class="provider-name">{p.name}</span>
                        <span class="provider-desc">{p.description}</span>
                        {#if $llmState.provider === p.id}
                            <Check size={16} class="check-icon" />
                        {/if}
                    </button>
                {/each}
            </div>

            <!-- Configuration for selected provider -->
            <div class="provider-config">
                {#if isBrowser}
                    <!-- Browser Model Selection -->
                    <div class="config-row">
                        <div class="config-group">
                            <label for="browser-model">Model</label>
                            <select
                                id="browser-model"
                                value={$llmState.model}
                                on:change={handleModelChange}
                            >
                                {#each provider.models as model}
                                    <option value={model.id}>
                                        {model.name} {model.size ? `(${model.size})` : ''}
                                    </option>
                                {/each}
                            </select>
                        </div>
                    </div>

                    {#if browserModelChanged}
                        <div class="reload-notice">
                            <span>Reload required to switch browser models</span>
                            <button class="btn-primary btn-small" on:click={reloadPage}>
                                <RefreshCw size={12} />
                                Reload
                            </button>
                        </div>
                    {/if}

                {:else if isCustom}
                    <!-- Custom Endpoint -->
                    <div class="config-row">
                        <div class="config-group">
                            <label for="custom-endpoint">Endpoint URL</label>
                            <input
                                id="custom-endpoint"
                                type="text"
                                bind:value={customEndpoint}
                                on:blur={handleCustomEndpointBlur}
                                placeholder="https://api.example.com/v1"
                            />
                        </div>
                        <div class="config-group">
                            <label for="custom-model">Model Name</label>
                            <div class="input-with-btn">
                                <input
                                    id="custom-model"
                                    type="text"
                                    bind:value={customModel}
                                    on:blur={handleCustomModelBlur}
                                    placeholder="model-name"
                                />
                                <button
                                    class="btn-icon"
                                    class:spinning={testing}
                                    on:click={handleTestConnection}
                                    disabled={testing || !customEndpoint}
                                    title="Test connection & fetch models"
                                >
                                    <RefreshCw size={14} />
                                </button>
                            </div>
                        </div>
                        <div class="config-group">
                            <label for="custom-key">API Key <span class="optional">(optional)</span></label>
                            <div class="input-with-btn">
                                <input
                                    id="custom-key"
                                    type={showApiKey ? 'text' : 'password'}
                                    bind:value={apiKey}
                                    on:blur={handleApiKeyBlur}
                                    placeholder="sk-..."
                                />
                                <button
                                    class="btn-icon"
                                    on:click={() => showApiKey = !showApiKey}
                                >
                                    {showApiKey ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>
                    </div>

                {:else if isLlamacpp}
                    <!-- llama.cpp Endpoint -->
                    <div class="config-row">
                        <div class="config-group">
                            <label for="llamacpp-endpoint">Endpoint URL</label>
                            <input
                                id="llamacpp-endpoint"
                                type="text"
                                bind:value={llamacppEndpoint}
                                on:blur={() => setLlamacppEndpoint(llamacppEndpoint)}
                                placeholder="http://localhost:8080/v1"
                            />
                        </div>
                        <div class="config-group">
                            <label for="llamacpp-model">Model Name</label>
                            <div class="input-with-btn">
                                <input
                                    id="llamacpp-model"
                                    type="text"
                                    bind:value={llamacppModel}
                                    on:blur={() => setLlamacppModel(llamacppModel)}
                                    placeholder="model-name"
                                />
                                <button
                                    class="btn-icon"
                                    class:spinning={testing}
                                    on:click={handleTestConnection}
                                    disabled={testing || !llamacppEndpoint}
                                    title="Test connection & fetch models"
                                >
                                    <RefreshCw size={14} />
                                </button>
                            </div>
                        </div>
                        <div class="config-group">
                            <label for="llamacpp-key">API Key <span class="optional">(optional)</span></label>
                            <div class="input-with-btn">
                                <input
                                    id="llamacpp-key"
                                    type={showApiKey ? 'text' : 'password'}
                                    bind:value={apiKey}
                                    on:blur={handleApiKeyBlur}
                                    placeholder="sk-..."
                                />
                                <button
                                    class="btn-icon"
                                    on:click={() => showApiKey = !showApiKey}
                                >
                                    {showApiKey ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>
                    </div>

                {:else if isLocal}
                    <!-- Local Provider (Ollama/LM Studio) -->
                    <div class="config-row">
                        <div class="config-group">
                            <span class="config-label">Endpoint</span>
                            <div class="endpoint-display">
                                <code>{provider.endpoint}</code>
                                <button
                                    class="btn-icon"
                                    class:spinning={testing}
                                    on:click={handleTestConnection}
                                    disabled={testing}
                                    title="Test connection & fetch models"
                                >
                                    <RefreshCw size={14} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {#if $llmState.connectionStatus === 'error'}
                        <div class="status-message error">
                            <AlertCircle size={14} />
                            <span>Not running. Start {provider.name.split(' ')[0]} to use.</span>
                        </div>
                    {/if}

                {:else}
                    <!-- Cloud Provider (OpenAI, Groq, Together) -->
                    <div class="config-row cloud-row">
                        <div class="config-group flex-grow">
                            <label for="api-key">API Key</label>
                            <div class="input-with-btn">
                                <input
                                    id="api-key"
                                    type={showApiKey ? 'text' : 'password'}
                                    bind:value={apiKey}
                                    on:blur={handleApiKeyBlur}
                                    placeholder={provider.id === 'openai' ? 'sk-...' : 'Enter API key'}
                                />
                                <button
                                    class="btn-icon"
                                    on:click={() => showApiKey = !showApiKey}
                                >
                                    {showApiKey ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>
                        <div class="config-group">
                            <label for="cloud-model">Model</label>
                            <select
                                id="cloud-model"
                                value={$llmState.model}
                                on:change={handleModelChange}
                            >
                                {#each provider.models as model}
                                    <option value={model.id}>
                                        {model.name} {model.description ? `- ${model.description}` : ''}
                                    </option>
                                {/each}
                            </select>
                        </div>
                        <div class="config-group test-btn-group">
                            <span class="config-label">&nbsp;</span>
                            <button
                                class="btn-test"
                                on:click={handleTestConnection}
                                disabled={testing || !apiKey}
                            >
                                {#if testing}
                                    Testing...
                                {:else}
                                    Test
                                {/if}
                            </button>
                        </div>
                    </div>

                    {#if provider.needsKey && !apiKey}
                        <div class="status-message warning">
                            <AlertCircle size={14} />
                            <span>API key required to use {provider.name}</span>
                        </div>
                    {:else if testResult === 'success'}
                        <div class="status-message success">
                            <Check size={14} />
                            <span>Connected to {provider.name}</span>
                        </div>
                    {:else if testResult === 'error'}
                        <div class="status-message error">
                            <AlertCircle size={14} />
                            <span>{testError}</span>
                        </div>
                    {/if}
                {/if}

                <!-- Available models from API (for local/custom) -->
                {#if (isLocal || isCustom || isLlamacpp) && $llmState.availableModels.length > 0}
                    <div class="available-models">
                        <span class="label">Available models:</span>
                        <div class="model-chips">
                            {#each $llmState.availableModels as model}
                                <button
                                    class="model-chip"
                                    class:selected={$llmState.model === model.id || customModel === model.id || llamacppModel === model.id}
                                    on:click={() => selectAvailableModel(model.id)}
                                >
                                    {model.name}
                                </button>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Connection Status for local/custom -->
                {#if (isLocal || isCustom || isLlamacpp) && $llmState.connectionStatus !== 'unknown'}
                    <div class="connection-status" class:connected={$llmState.connectionStatus === 'connected'}>
                        {#if $llmState.connectionStatus === 'connected'}
                            <Check size={14} />
                            <span>Connected</span>
                        {:else if $llmState.connectionStatus === 'checking'}
                            <span class="spinning"><RefreshCw size={14} /></span>
                            <span>Checking...</span>
                        {/if}
                    </div>
                {/if}
            </div>

            <!-- Token Stats -->
            {#if $tokenStats.requestCount > 0}
                <div class="token-stats">
                    <span>Requests: {$tokenStats.requestCount}</span>
                    <span>Tokens: {$tokenStats.totalTokens.toLocaleString()}</span>
                    <span>{$tokenStats.avgTokensPerSecond} tok/s</span>
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    .llm-config {
        margin-bottom: 12px;
    }

    .toggle-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        background: transparent;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 500;
        padding: 8px 12px;
    }

    .toggle-btn:hover {
        color: var(--text-primary);
    }

    .config-content {
        margin-top: 8px;
        padding: 16px;
        background: var(--bg-panel);
        border-radius: var(--border-radius);
    }

    /* Provider Grid */
    .provider-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 8px;
        margin-bottom: 16px;
    }

    .provider-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        padding: 12px;
        background: var(--bg-input);
        border: 2px solid var(--border-color);
        border-radius: 8px;
        cursor: pointer;
        transition: all 0.15s;
        text-align: left;
    }

    .provider-card:hover {
        border-color: var(--text-muted);
    }

    .provider-card.selected {
        background: rgba(116, 185, 255, 0.1);
        border-color: var(--accent-primary);
    }

    .provider-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .provider-desc {
        font-size: 11px;
        color: var(--text-muted);
        line-height: 1.3;
    }

    .provider-card :global(.check-icon) {
        position: absolute;
        top: 8px;
        right: 8px;
        color: var(--accent-primary);
    }

    /* Provider Config */
    .provider-config {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .config-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
    }

    .config-row.cloud-row {
        grid-template-columns: 1fr auto auto;
    }

    .config-group.flex-grow {
        min-width: 200px;
    }

    .config-group.test-btn-group {
        min-width: auto;
    }

    .btn-test {
        padding: 8px 20px;
        background: var(--accent-primary);
        border: none;
        border-radius: 6px;
        color: white;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
    }

    .btn-test:hover:not(:disabled) {
        background: var(--accent-primary-hover, #5a9fd4);
        filter: brightness(1.1);
    }

    .btn-test:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .config-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .config-group label,
    .config-group .config-label {
        font-size: 12px;
        color: var(--text-secondary);
    }

    .config-group input,
    .config-group select {
        padding: 8px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 13px;
    }

    .config-group input:focus,
    .config-group select:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .config-group select {
        cursor: pointer;
    }

    .optional {
        color: var(--text-muted);
        font-weight: normal;
    }

    .input-with-btn {
        display: flex;
        gap: 8px;
    }

    .input-with-btn input {
        flex: 1;
    }

    .btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-secondary);
        cursor: pointer;
        flex-shrink: 0;
    }

    .btn-icon:hover:not(:disabled) {
        background: var(--bg-hover);
        color: var(--text-primary);
    }

    .btn-icon:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .endpoint-display {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .endpoint-display code {
        padding: 8px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        font-size: 12px;
        color: var(--text-secondary);
    }

    /* Status Messages */
    .status-message {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
    }

    .status-message.error {
        background: rgba(255, 107, 107, 0.1);
        color: var(--accent-secondary);
    }

    .status-message.warning {
        background: rgba(255, 193, 7, 0.1);
        color: #f0ad4e;
    }

    .status-message.success {
        background: rgba(46, 213, 115, 0.1);
        color: var(--accent-success, #2ed573);
    }

    /* Available Models */
    .available-models {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .available-models .label {
        font-size: 11px;
        color: var(--text-muted);
    }

    .model-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .model-chip {
        padding: 4px 10px;
        font-size: 11px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.15s;
    }

    .model-chip:hover {
        border-color: var(--text-muted);
        color: var(--text-primary);
    }

    .model-chip.selected {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
    }

    /* Connection Status */
    .connection-status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        color: var(--text-muted);
    }

    .connection-status.connected {
        color: var(--accent-success);
    }

    .spinning,
    .spinning :global(svg) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    /* Token Stats */
    .token-stats {
        display: flex;
        gap: 16px;
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid var(--border-color);
        font-size: 12px;
        color: var(--text-secondary);
    }

    /* Reload Notice */
    .reload-notice {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        background: rgba(116, 185, 255, 0.1);
        border: 1px solid rgba(116, 185, 255, 0.3);
        border-radius: 6px;
        font-size: 12px;
        color: var(--accent-primary);
    }

    .btn-small {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 10px !important;
        font-size: 11px !important;
    }
</style>
