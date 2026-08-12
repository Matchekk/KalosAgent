<script>
    import { onMount } from 'svelte';
    import { modelState } from '$lib/stores/training';
    import { romLoaded, romBuffer } from '$lib/stores/game';
    import { llmState, tokenStats, PROVIDERS, setProvider, setModel, setApiKey, setCustomEndpoint, setCustomModel, setLlamacppEndpoint, setLlamacppModel } from '$lib/stores/llm';
    import { theme } from '$lib/stores/theme';
    import { feedSystem } from '$lib/stores/feed';
    import { hasROM, loadROM, saveROM } from '$lib/core/persistence.js';
    import { startIntroSkip } from '$lib/core/game-init.js';
    import { selectDiscoveredModel, testConnection } from '$lib/core/llm.js';
    import { Cpu, CheckCircle, Info, Github, ChevronDown, ChevronUp, X, Zap, Sun, Moon, Upload, PlayCircle, FastForward, Settings, AlertCircle, Check, RefreshCw, Radio, FlaskConical, Gamepad2, Eye, EyeOff } from 'lucide-svelte';
    import { twitchStatus } from '$lib/stores/twitch.js';

    // View mode props
    export let viewMode = 'lab';
    export let onViewModeChange = (mode) => {};

    $: isLive = $twitchStatus.isLive;

    let aboutOpen = false;
    let romDropdownOpen = false;
    let modelDropdownOpen = false;
    let fileInput;
    let hasSavedROM = false;
    let skipIntro = true;

    // Model config state
    let apiKey = '';
    let showApiKey = false;
    let testing = false;
    let testResult = null;
    let testError = '';
    let customEndpoint = $llmState.customEndpoint || '';
    let customModel = $llmState.customModel || '';
    let llamacppEndpoint = $llmState.llamacppEndpoint || 'http://localhost:8090/v1';
    let llamacppModel = $llmState.llamacppModel || '';

    $: hasTokenStats = $tokenStats.requestCount > 0;
    $: provider = PROVIDERS[$llmState.provider] || PROVIDERS.browser;
    $: isBrowser = $llmState.provider === 'browser';
    $: isCustom = $llmState.provider === 'custom';
    $: isLlamacpp = $llmState.provider === 'llamacpp';
    $: isConfigurable = isCustom || isLlamacpp;
    $: needsApiKey = provider.needsKey && !$llmState.apiKey;

    // Build timestamp injected by Vite
    const buildTime = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;

    onMount(() => {
        hasSavedROM = hasROM();
        apiKey = $llmState.apiKey || '';
    });

    // Sync apiKey when provider changes
    $: apiKey = $llmState.apiKey || '';

    function formatBuildTime(isoString) {
        if (!isoString) return '';
        const date = new Date(isoString);
        return `Updated ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}`;
    }

    // ROM functions
    async function handleFile(file, shouldSkipIntro = false) {
        if (!file) return;
        feedSystem(`Loading ${file.name}...`);
        try {
            const buffer = await file.arrayBuffer();
            await saveROM(buffer);
            romBuffer.set(buffer);
            romLoaded.set(true);
            romDropdownOpen = false;
            if (shouldSkipIntro) {
                setTimeout(() => startIntroSkip(), 500);
            }
        } catch (err) {
            feedSystem(`Error: ${err.message}`);
        }
    }

    function loadSavedROM(shouldSkipIntro = false) {
        feedSystem('Loading saved ROM...');
        try {
            const buffer = loadROM();
            if (buffer) {
                romBuffer.set(buffer);
                romLoaded.set(true);
                romDropdownOpen = false;
                feedSystem('ROM loaded from previous session');
                if (shouldSkipIntro) {
                    setTimeout(() => startIntroSkip(), 500);
                }
            } else {
                feedSystem('No saved ROM found');
                hasSavedROM = false;
            }
        } catch (err) {
            feedSystem(`Error: ${err.message}`);
            hasSavedROM = false;
        }
    }

    function handleInputChange(e) {
        const file = e.target.files[0];
        handleFile(file, skipIntro);
    }

    function triggerFileInput() {
        fileInput.click();
    }

    // Model functions
    function handleProviderChange(providerId) {
        setProvider(providerId);
        testResult = null;
        testError = '';
    }

    function handleModelChange(e) {
        setModel(e.target.value);
    }

    function handleApiKeyBlur() {
        setApiKey(apiKey);
        testResult = null;
    }

    async function handleTestConnection() {
        testing = true;
        testResult = null;
        const endpoint = isCustom ? customEndpoint : isLlamacpp ? llamacppEndpoint : provider.endpoint;
        const result = await testConnection(endpoint, apiKey);
        testing = false;
        if (result.success) {
            testResult = 'success';
            if (isLlamacpp) {
                const detectedModel = selectDiscoveredModel(llamacppModel, result.models);
                if (detectedModel !== llamacppModel) {
                    llamacppModel = detectedModel;
                    setLlamacppModel(detectedModel);
                }
            } else if (isCustom) {
                const detectedModel = selectDiscoveredModel(customModel, result.models);
                if (detectedModel !== customModel) {
                    customModel = detectedModel;
                    setCustomModel(detectedModel);
                }
            }
        } else {
            testResult = 'error';
            testError = result.error || 'Connection failed';
        }
    }

    // Close dropdowns when clicking outside
    function handleClickOutside(e) {
        if (!e.target.closest('.rom-dropdown-container')) {
            romDropdownOpen = false;
        }
        if (!e.target.closest('.model-dropdown-container')) {
            modelDropdownOpen = false;
        }
    }
</script>

<svelte:window on:click={handleClickOutside} />

<header class="header">
    <div class="logo">
        <div class="logo-icon">
            <Cpu size={24} />
        </div>
        <div class="logo-text">
            <h1>Tesserack</h1>
            <div class="subtitle-row">
                <span class="tagline">AI Plays Pokemon</span>
                {#if buildTime}
                    <span class="build-time">{formatBuildTime(buildTime)}</span>
                {/if}
            </div>
        </div>
    </div>

    <nav class="header-tabs">
        <button
            class="tab"
            class:active={viewMode === 'watch'}
            class:live={isLive}
            on:click={() => onViewModeChange('watch')}
        >
            {#if isLive}
                <span class="live-dot"></span>
            {:else}
                <Radio size={16} />
            {/if}
            <span>Watch</span>
        </button>
        <button
            class="tab"
            class:active={viewMode === 'lab'}
            on:click={() => onViewModeChange('lab')}
        >
            <FlaskConical size={16} />
            <span>Lab</span>
        </button>
        <button
            class="tab"
            class:active={viewMode === 'classic'}
            on:click={() => onViewModeChange('classic')}
        >
            <Gamepad2 size={16} />
            <span>Play</span>
        </button>
    </nav>

    <div class="header-center">
        <!-- ROM Dropdown -->
        <div class="rom-dropdown-container">
            <button
                class="dropdown-trigger"
                class:active={$romLoaded}
                class:highlight={!$romLoaded}
                on:click|stopPropagation={() => romDropdownOpen = !romDropdownOpen}
                title="Load or manage ROM"
            >
                <Upload size={16} />
                <span>{$romLoaded ? 'Pokemon Red' : 'Load ROM'}</span>
                <ChevronDown size={14} />
            </button>

            {#if romDropdownOpen}
                <div class="dropdown-panel rom-panel">
                    {#if hasSavedROM && !$romLoaded}
                        <button class="dropdown-item continue" on:click={() => loadSavedROM(skipIntro)}>
                            <PlayCircle size={18} />
                            <div class="item-text">
                                <strong>Continue</strong>
                                <small>Resume previous session</small>
                            </div>
                        </button>
                        <div class="dropdown-divider"></div>
                    {/if}

                    <button class="dropdown-item" on:click={triggerFileInput}>
                        <Upload size={18} />
                        <div class="item-text">
                            <strong>Load ROM</strong>
                            <small>.gb, .gbc files</small>
                        </div>
                    </button>

                    <label class="dropdown-checkbox">
                        <input type="checkbox" bind:checked={skipIntro} />
                        <FastForward size={14} />
                        <span>Quick Start (auto-skip intro)</span>
                    </label>

                    <input
                        type="file"
                        accept=".gb,.gbc"
                        bind:this={fileInput}
                        on:change={handleInputChange}
                        hidden
                    />
                </div>
            {/if}
        </div>

        <!-- Model Dropdown -->
        <div class="model-dropdown-container">
            <button
                class="dropdown-trigger"
                class:warning={needsApiKey}
                on:click|stopPropagation={() => modelDropdownOpen = !modelDropdownOpen}
                title="Configure AI model"
            >
                <Settings size={16} />
                <span>{provider.name}</span>
                {#if needsApiKey}
                    <AlertCircle size={14} class="warning-icon" />
                {:else}
                    <ChevronDown size={14} />
                {/if}
            </button>

            {#if modelDropdownOpen}
                <div class="dropdown-panel model-panel">
                    <div class="panel-section">
                        <div class="section-label">Provider</div>
                        <div class="provider-grid">
                            {#each Object.values(PROVIDERS) as p}
                                <button
                                    class="provider-chip"
                                    class:selected={$llmState.provider === p.id}
                                    on:click={() => handleProviderChange(p.id)}
                                >
                                    {p.name}
                                </button>
                            {/each}
                        </div>
                    </div>

                    {#if isLlamacpp}
                        <!-- llama.cpp endpoint config -->
                        <div class="panel-section">
                            <label class="section-label" for="llamacpp-endpoint">Endpoint URL</label>
                            <input
                                id="llamacpp-endpoint"
                                class="config-input"
                                type="text"
                                bind:value={llamacppEndpoint}
                                on:blur={() => setLlamacppEndpoint(llamacppEndpoint)}
                                placeholder="http://localhost:8090/v1"
                            />
                        </div>

                        <div class="panel-section">
                            <label class="section-label" for="llamacpp-model">Model</label>
                            <div class="api-key-row">
                                <input
                                    id="llamacpp-model"
                                    class="config-input"
                                    type="text"
                                    bind:value={llamacppModel}
                                    on:blur={() => setLlamacppModel(llamacppModel)}
                                    placeholder="model-name"
                                />
                                <button
                                    class="icon-btn test-btn"
                                    aria-label="Test llama.cpp connection"
                                    title="Test llama.cpp connection"
                                    on:click={handleTestConnection}
                                    disabled={testing || !llamacppEndpoint}
                                    class:spinning={testing}
                                >
                                    {#if testResult === 'success'}
                                        <Check size={14} />
                                    {:else}
                                        <RefreshCw size={14} />
                                    {/if}
                                </button>
                            </div>
                        </div>

                        <div class="panel-section">
                            <label class="section-label" for="llamacpp-api-key">API Key <span class="optional-label">(optional)</span></label>
                            <div class="api-key-row">
                                <input
                                    id="llamacpp-api-key"
                                    type={showApiKey ? 'text' : 'password'}
                                    bind:value={apiKey}
                                    on:blur={handleApiKeyBlur}
                                    placeholder="sk-..."
                                />
                                <button class="icon-btn" aria-label={showApiKey ? 'Hide API key' : 'Show API key'} on:click={() => showApiKey = !showApiKey}>
                                    {#if showApiKey}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
                                </button>
                            </div>
                        </div>

                        {#if $llmState.availableModels.length > 0}
                            <div class="panel-section">
                                <div class="section-label">Available Models</div>
                                <div class="model-chips">
                                    {#each $llmState.availableModels as model}
                                        <button
                                            class="model-chip"
                                            class:selected={llamacppModel === model.id}
                                            on:click={() => { llamacppModel = model.id; setLlamacppModel(model.id); }}
                                        >
                                            {model.name || model.id}
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        {#if testResult === 'error'}
                            <div class="test-error">{testError}</div>
                        {:else if testResult === 'success'}
                            <div class="test-success">Connected{llamacppModel ? ` · ${llamacppModel}` : ''}</div>
                        {/if}

                    {:else if isCustom}
                        <!-- Custom endpoint config -->
                        <div class="panel-section">
                            <label class="section-label" for="custom-endpoint">Endpoint URL</label>
                            <input
                                id="custom-endpoint"
                                class="config-input"
                                type="text"
                                bind:value={customEndpoint}
                                on:blur={() => setCustomEndpoint(customEndpoint)}
                                placeholder="https://api.example.com/v1"
                            />
                        </div>

                        <div class="panel-section">
                            <label class="section-label" for="custom-model">Model</label>
                            <div class="api-key-row">
                                <input
                                    id="custom-model"
                                    class="config-input"
                                    type="text"
                                    bind:value={customModel}
                                    on:blur={() => setCustomModel(customModel)}
                                    placeholder="model-name"
                                />
                                <button
                                    class="icon-btn test-btn"
                                    aria-label="Test custom endpoint connection"
                                    title="Test custom endpoint connection"
                                    on:click={handleTestConnection}
                                    disabled={testing || !customEndpoint}
                                    class:spinning={testing}
                                >
                                    {#if testResult === 'success'}
                                        <Check size={14} />
                                    {:else}
                                        <RefreshCw size={14} />
                                    {/if}
                                </button>
                            </div>
                        </div>

                        <div class="panel-section">
                            <label class="section-label" for="custom-api-key">API Key <span class="optional-label">(optional)</span></label>
                            <div class="api-key-row">
                                <input
                                    id="custom-api-key"
                                    type={showApiKey ? 'text' : 'password'}
                                    bind:value={apiKey}
                                    on:blur={handleApiKeyBlur}
                                    placeholder="sk-..."
                                />
                                <button class="icon-btn" aria-label={showApiKey ? 'Hide API key' : 'Show API key'} on:click={() => showApiKey = !showApiKey}>
                                    {#if showApiKey}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
                                </button>
                            </div>
                        </div>

                        {#if $llmState.availableModels.length > 0}
                            <div class="panel-section">
                                <div class="section-label">Available Models</div>
                                <div class="model-chips">
                                    {#each $llmState.availableModels as model}
                                        <button
                                            class="model-chip"
                                            class:selected={customModel === model.id}
                                            on:click={() => { customModel = model.id; setCustomModel(model.id); }}
                                        >
                                            {model.name || model.id}
                                        </button>
                                    {/each}
                                </div>
                            </div>
                        {/if}

                        {#if testResult === 'error'}
                            <div class="test-error">{testError}</div>
                        {:else if testResult === 'success'}
                            <div class="test-success">Connected{customModel ? ` · ${customModel}` : ''}</div>
                        {/if}

                    {:else}
                        <!-- Standard provider with preset models -->
                        <div class="panel-section">
                            <label class="section-label" for="provider-model">Model</label>
                            <select id="provider-model" value={$llmState.model} on:change={handleModelChange}>
                                {#each provider.models || [] as model}
                                    <option value={model.id}>{model.name}</option>
                                {/each}
                            </select>
                        </div>

                        {#if provider.needsKey}
                            <div class="panel-section">
                                <label class="section-label" for="provider-api-key">API Key</label>
                                <div class="api-key-row">
                                    <input
                                        id="provider-api-key"
                                        type={showApiKey ? 'text' : 'password'}
                                        bind:value={apiKey}
                                        on:blur={handleApiKeyBlur}
                                        placeholder="Enter API key"
                                    />
                                    <button class="icon-btn" aria-label={showApiKey ? 'Hide API key' : 'Show API key'} on:click={() => showApiKey = !showApiKey}>
                                        {#if showApiKey}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
                                    </button>
                                    <button
                                        class="icon-btn test-btn"
                                        aria-label="Test provider connection"
                                        title="Test provider connection"
                                        on:click={handleTestConnection}
                                        disabled={testing || !apiKey}
                                        class:spinning={testing}
                                    >
                                        {#if testResult === 'success'}
                                            <Check size={14} />
                                        {:else}
                                            <RefreshCw size={14} />
                                        {/if}
                                    </button>
                                </div>
                                {#if testResult === 'error'}
                                    <div class="test-error">{testError}</div>
                                {/if}
                            </div>
                        {/if}
                    {/if}

                    {#if hasTokenStats}
                        <div class="panel-section stats">
                            <span><Zap size={12} /> {$tokenStats.lastTokensPerSecond} tok/s</span>
                            <span>{($tokenStats.totalTokens / 1000).toFixed(1)}k tokens</span>
                        </div>
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <div class="header-right">
        <button class="theme-toggle" on:click={theme.toggle} title="Toggle dark mode">
            {#if $theme === 'dark'}
                <Sun size={18} />
            {:else}
                <Moon size={18} />
            {/if}
        </button>

        <button class="about-btn" on:click={() => aboutOpen = !aboutOpen}>
            <Info size={16} />
            <span>About</span>
            {#if aboutOpen}
                <ChevronUp size={14} />
            {:else}
                <ChevronDown size={14} />
            {/if}
        </button>

        {#if $romLoaded && $modelState.hasModel}
            <span class="model-badge trained">
                <CheckCircle size={14} />
                Model v{$modelState.sessions}
            </span>
        {/if}
    </div>
</header>

{#if aboutOpen}
    <div class="about-panel">
        <button class="close-btn" on:click={() => aboutOpen = false}>
            <X size={16} />
        </button>

        <h2>How It Works</h2>

        <p>
            Tesserack runs <strong>entirely in your browser</strong>. No server, no API calls, no data leaves your machine. Two modes are available:
        </p>

        <h3>Play Mode (LLM-guided)</h3>
        <p>
            A language model (WebLLM or external API) generates action plans based on game state and strategy guide context. The agent follows the guide to make progress through the game.
        </p>

        <h3>Train Mode (Pure RL)</h3>
        <p>
            The agent learns with a browser-native <strong>PPO/GAE actor-critic</strong>. Four synchronized Red++ environments encode exact map/event RAM, objective phase, inventory, dialog identity, visitation and recent actions into 144 features, choose every button autonomously, and update a shared policy with clipped multi-epoch gradients plus a learned value baseline.
        </p>

        <h3>Reward System</h3>
        <ul>
            <li><strong>T1 Movement:</strong> +0.1 for position changes (encourages exploration)</li>
            <li><strong>T2 Map:</strong> +1-2 for entering new areas</li>
            <li><strong>T3 Goals:</strong> +5-10 for badges, Pokemon caught, story progress</li>
            <li><strong>Penalties:</strong> -0.02 per step when stuck in same position</li>
        </ul>

        <h3>Architecture</h3>
        <p>
            Shared typed-array MLP (144 → 128 → 7 actions plus value head), GAE, Adam, gradient clipping, phase-balanced demonstration replay, DAgger-style learner-state corrections, bounded episodic novelty, and a 128-cell autonomous exploration archive. One worker exploits, two explore frontier states, and one independently rehearses from the true ROM start.
        </p>

        <h3>Roadmap</h3>
        <ul class="roadmap">
            <li class="done">Deterministic unit-test reward system</li>
            <li class="done">Browser-native Pure RL mode</li>
            <li class="done">Real-time reward breakdown UI</li>
            <li class="done">PPO/GAE actor-critic learning</li>
            <li class="done">Configurable hyperparameters with presets</li>
            <li class="done">Learning visualization (charts)</li>
            <li class="todo">Recurrent policy memory and prioritized replay</li>
            <li class="todo">Checkpoint-based curriculum shaping</li>
            <li class="todo">Reach Boulder Badge without LLM</li>
        </ul>

        <div class="data-notice">
            <strong>Data Storage:</strong> When using browser-based WebGPU inference, all data (training progress, experiences, model weights) is stored locally in your browser and persists across sessions. This data is specific to your browser and device. Use Export to back up or transfer your data. External API providers may have different data handling policies.
        </div>

        <div class="about-footer">
            <a href="https://github.com/sidmohan0/tesserack" target="_blank" rel="noopener" class="github-link">
                <Github size={16} />
                <span>View Source on GitHub</span>
            </a>
        </div>
    </div>
{/if}

<style>
    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--border-color);
    }

    .logo {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .logo-icon {
        color: var(--accent-primary);
    }

    .logo-text h1 {
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);
        margin: 0;
        letter-spacing: -0.5px;
    }

    .subtitle-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .tagline {
        font-size: 11px;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 1px;
    }

    .build-time {
        font-size: 10px;
        color: var(--text-muted);
        opacity: 0.7;
        padding-left: 8px;
        border-left: 1px solid var(--border-color);
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .about-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        background: var(--bg-input);
        color: var(--text-secondary);
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.15s;
    }

    .about-btn:hover {
        background: var(--bg-dark);
        color: var(--text-primary);
    }

    .model-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        padding: 6px 12px;
        border-radius: 20px;
        font-weight: 500;
    }

    .model-badge.trained {
        background: rgba(39, 174, 96, 0.15);
        color: var(--accent-success);
    }

    .about-panel {
        position: relative;
        margin-top: 16px;
        padding: 20px 24px;
        background: var(--bg-panel);
        border: 1px solid var(--border-color);
        border-radius: var(--border-radius);
        font-size: 14px;
        line-height: 1.6;
        color: var(--text-secondary);
    }

    .close-btn {
        position: absolute;
        top: 12px;
        right: 12px;
        padding: 4px;
        color: var(--text-muted);
        border-radius: 4px;
        transition: all 0.15s;
    }

    .close-btn:hover {
        background: var(--bg-input);
        color: var(--text-primary);
    }

    .about-panel h2 {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 0 0 12px 0;
    }

    .about-panel h3 {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        margin: 16px 0 8px 0;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .about-panel p {
        margin: 0 0 12px 0;
    }

    .about-panel strong {
        color: var(--text-primary);
    }

    .about-panel ul {
        margin: 0 0 12px 0;
        padding-left: 20px;
    }

    .about-panel li {
        margin-bottom: 6px;
    }

    .about-panel a {
        color: var(--accent-primary);
        text-decoration: none;
    }

    .about-panel a:hover {
        text-decoration: underline;
    }

    .roadmap {
        list-style: none;
        padding-left: 0;
    }

    .data-notice {
        margin-top: 16px;
        padding: 12px;
        background: var(--bg-input);
        border-radius: 6px;
        font-size: 12px;
        color: var(--text-muted);
        line-height: 1.5;
    }

    .data-notice strong {
        color: var(--text-secondary);
    }

    .roadmap li {
        padding: 4px 0 4px 20px;
        position: relative;
        font-size: 12px;
    }

    .roadmap li::before {
        position: absolute;
        left: 0;
        font-size: 11px;
    }

    .roadmap li.done::before {
        content: "\2713";
        color: #00b894;
    }

    .roadmap li.todo::before {
        content: "\25CB";
        color: var(--text-muted);
    }

    .about-footer {
        margin-top: 20px;
        padding-top: 16px;
        border-top: 1px solid var(--border-color);
    }

    .github-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: var(--bg-dark);
        color: var(--text-primary);
        border-radius: 6px;
        font-weight: 500;
        transition: all 0.15s;
    }

    .github-link:hover {
        background: var(--border-color);
        text-decoration: none;
    }

    .theme-toggle {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        background: var(--bg-input);
        color: var(--text-secondary);
        border-radius: 8px;
        transition: all 0.2s;
    }

    .theme-toggle:hover {
        background: var(--bg-dark);
        color: var(--accent-warning);
    }

    /* Header tabs */
    .header-tabs {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px;
        background: var(--bg-input);
        border-radius: 10px;
    }

    .tab {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: var(--text-muted);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .tab:hover {
        color: var(--text-secondary);
        background: var(--bg-panel);
    }

    .tab.active {
        background: var(--bg-panel);
        color: var(--accent-primary);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .tab.active :global(svg) {
        color: var(--accent-primary);
    }

    .tab.live {
        color: var(--text-primary);
    }

    .tab.live:not(.active) {
        background: rgba(231, 76, 60, 0.1);
    }

    .live-dot {
        width: 8px;
        height: 8px;
        background: #e74c3c;
        border-radius: 50%;
        animation: pulse-dot 1.5s ease-in-out infinite;
    }

    @keyframes pulse-dot {
        0%, 100% {
            opacity: 1;
            transform: scale(1);
        }
        50% {
            opacity: 0.6;
            transform: scale(0.9);
        }
    }

    /* Header center - dropdowns */
    .header-center {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .rom-dropdown-container,
    .model-dropdown-container {
        position: relative;
    }

    .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        color: var(--text-secondary);
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .dropdown-trigger:hover {
        background: var(--bg-dark);
        color: var(--text-primary);
    }

    .dropdown-trigger.active {
        background: rgba(116, 185, 255, 0.1);
        border-color: var(--accent-primary);
        color: var(--accent-primary);
    }

    .dropdown-trigger.warning {
        border-color: var(--accent-warning);
    }

    .dropdown-trigger :global(.warning-icon) {
        color: var(--accent-warning);
    }

    .dropdown-trigger.highlight {
        border-color: var(--accent-primary);
        border-width: 2px;
        background: rgba(116, 185, 255, 0.08);
        color: var(--accent-primary);
        animation: pulse-border 2s ease-in-out infinite;
    }

    @keyframes pulse-border {
        0%, 100% {
            box-shadow: 0 0 0 0 rgba(116, 185, 255, 0.4);
        }
        50% {
            box-shadow: 0 0 0 4px rgba(116, 185, 255, 0);
        }
    }

    .dropdown-panel {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        min-width: 280px;
        background: var(--bg-panel);
        border: 1px solid var(--border-color);
        border-radius: 12px;
        box-shadow: var(--shadow-medium);
        padding: 12px;
        z-index: 1000;
    }

    .dropdown-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 12px;
        background: transparent;
        border: none;
        border-radius: 8px;
        color: var(--text-primary);
        cursor: pointer;
        transition: background 0.15s;
        text-align: left;
    }

    .dropdown-item:hover {
        background: var(--bg-input);
    }

    .dropdown-item.continue {
        background: linear-gradient(135deg, var(--accent-primary), #a29bfe);
        color: white;
    }

    .dropdown-item.continue:hover {
        filter: brightness(1.1);
    }

    .dropdown-item :global(svg) {
        flex-shrink: 0;
    }

    .item-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .item-text strong {
        font-size: 14px;
    }

    .item-text small {
        font-size: 11px;
        opacity: 0.7;
    }

    .dropdown-divider {
        height: 1px;
        background: var(--border-color);
        margin: 8px 0;
    }

    .dropdown-checkbox {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        border-radius: 6px;
        margin-top: 4px;
    }

    .dropdown-checkbox:hover {
        background: var(--bg-input);
    }

    .dropdown-checkbox input:checked + :global(svg) {
        color: var(--accent-primary);
    }

    /* Model dropdown specific */
    .model-panel {
        min-width: 320px;
    }

    .panel-section {
        margin-bottom: 12px;
    }

    .panel-section:last-child {
        margin-bottom: 0;
    }

    .section-label {
        display: block;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: var(--text-muted);
        margin-bottom: 8px;
    }

    .provider-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .provider-chip {
        padding: 6px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.15s;
    }

    .provider-chip:hover {
        border-color: var(--text-muted);
        color: var(--text-primary);
    }

    .provider-chip.selected {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
    }

    .panel-section select {
        width: 100%;
        padding: 8px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 13px;
        cursor: pointer;
    }

    .panel-section select:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .api-key-row {
        display: flex;
        gap: 6px;
    }

    .api-key-row input {
        flex: 1;
        padding: 8px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 13px;
    }

    .api-key-row input:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-secondary);
        cursor: pointer;
        flex-shrink: 0;
    }

    .icon-btn:hover:not(:disabled) {
        background: var(--bg-dark);
        color: var(--text-primary);
    }

    .icon-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .icon-btn.test-btn :global(svg) {
        color: var(--accent-success);
    }

    .icon-btn.spinning :global(svg) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .test-error {
        margin-top: 6px;
        padding: 6px 10px;
        background: rgba(255, 107, 107, 0.1);
        border-radius: 4px;
        font-size: 11px;
        color: var(--accent-secondary);
    }

    .test-success {
        margin-top: 6px;
        padding: 6px 10px;
        background: rgba(74, 222, 128, 0.1);
        border-radius: 4px;
        font-size: 11px;
        color: var(--success, #4ade80);
        overflow-wrap: anywhere;
    }

    .panel-section.stats {
        display: flex;
        justify-content: space-between;
        padding-top: 12px;
        border-top: 1px solid var(--border-color);
        font-size: 12px;
        color: var(--text-muted);
    }

    .config-input {
        width: 100%;
        padding: 8px 12px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 13px;
    }

    .config-input:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .optional-label {
        font-weight: 400;
        text-transform: none;
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

    .panel-section.stats span {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .panel-section.stats :global(svg) {
        color: var(--accent-primary);
    }
</style>
