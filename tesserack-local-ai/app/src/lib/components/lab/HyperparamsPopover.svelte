<script>
    import { createEventDispatcher } from 'svelte';
    import { Settings, ChevronDown, ChevronRight } from 'lucide-svelte';
    import { rlConfig, RL_PRESETS, setRLConfig } from '$lib/stores/lab';

    export let open = false;
    export let disabled = false;

    const dispatch = createEventDispatcher();

    let showAdvanced = false;

    // Local state for editing
    let localConfig = { ...$rlConfig };

    // Sync local state when store changes
    $: if (!open) {
        localConfig = { ...$rlConfig };
    }

    // Preset names for display
    const presetNames = ['conservative', 'balanced', 'fast'];

    function selectPreset(name) {
        const preset = RL_PRESETS[name];
        localConfig = { preset: name, ...preset };
    }

    function handleSliderChange(key, value) {
        localConfig[key] = value;
        localConfig.preset = 'custom';
    }

    function handleApply() {
        setRLConfig(localConfig);
        dispatch('apply', localConfig);
        open = false;
    }

    function handleReset() {
        selectPreset('balanced');
    }

    function toggle() {
        if (disabled) return;
        open = !open;
    }

    function handleClickOutside(event) {
        if (open && !event.target.closest('.hyperparams-popover')) {
            open = false;
        }
    }

    // Format values for display
    function formatLR(v) {
        return v.toFixed(3);
    }
</script>

<svelte:window on:click={handleClickOutside} />

<div class="hyperparams-popover" class:disabled>
    <button
        class="trigger-btn"
        class:open
        on:click|stopPropagation={toggle}
        {disabled}
        title="Training hyperparameters"
    >
        <Settings size={14} />
        <span>Hyperparams</span>
    </button>

    {#if open}
        <div class="popover">
            <div class="popover-header">
                Training Config
            </div>

            <div class="popover-content">
                <!-- Presets -->
                <div class="section">
                    <div class="section-label">Preset</div>
                    <div class="preset-buttons">
                        {#each presetNames as name}
                            <button
                                class="preset-btn"
                                class:active={localConfig.preset === name}
                                on:click={() => selectPreset(name)}
                            >
                                {name.charAt(0).toUpperCase() + name.slice(1)}
                            </button>
                        {/each}
                    </div>
                </div>

                <!-- Advanced Toggle -->
                <button class="advanced-toggle" on:click={() => showAdvanced = !showAdvanced}>
                    {#if showAdvanced}
                        <ChevronDown size={14} />
                    {:else}
                        <ChevronRight size={14} />
                    {/if}
                    <span>Advanced</span>
                    {#if localConfig.preset === 'custom'}
                        <span class="custom-badge">Custom</span>
                    {/if}
                </button>

                {#if showAdvanced}
                    <div class="advanced-section">
                        <!-- Learning Rate -->
                        <div class="slider-row">
                            <label for="learning-rate">Learning Rate</label>
                            <input
                                id="learning-rate"
                                type="range"
                                min="0.001"
                                max="0.1"
                                step="0.001"
                                value={localConfig.learningRate}
                                on:input={(e) => handleSliderChange('learningRate', parseFloat(e.target.value))}
                            />
                            <span class="slider-value">{formatLR(localConfig.learningRate)}</span>
                        </div>

                        <!-- Rollout Size -->
                        <div class="slider-row">
                            <label for="rollout-size">Rollout Size</label>
                            <input
                                id="rollout-size"
                                type="range"
                                min="32"
                                max="512"
                                step="32"
                                value={localConfig.rolloutSize}
                                on:input={(e) => handleSliderChange('rolloutSize', parseInt(e.target.value))}
                            />
                            <span class="slider-value">{localConfig.rolloutSize}</span>
                        </div>

                        <!-- Gamma -->
                        <div class="slider-row">
                            <label for="discount-gamma">Discount (γ)</label>
                            <input
                                id="discount-gamma"
                                type="range"
                                min="0.9"
                                max="0.999"
                                step="0.001"
                                value={localConfig.gamma}
                                on:input={(e) => handleSliderChange('gamma', parseFloat(e.target.value))}
                            />
                            <span class="slider-value">{localConfig.gamma.toFixed(3)}</span>
                        </div>
                    </div>
                {/if}
            </div>

            <div class="popover-footer">
                <button class="footer-btn secondary" on:click={handleReset}>
                    Reset
                </button>
                <button class="footer-btn primary" on:click={handleApply}>
                    Apply
                </button>
            </div>
        </div>
    {/if}
</div>

<style>
    .hyperparams-popover {
        position: relative;
    }

    .hyperparams-popover.disabled {
        opacity: 0.6;
        pointer-events: none;
    }

    .trigger-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border: none;
        border-radius: 6px;
        background: var(--bg-input);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .trigger-btn:hover:not(:disabled) {
        background: var(--bg-panel);
        color: var(--text-primary);
    }

    .trigger-btn.open {
        background: var(--accent-primary);
        color: white;
    }

    .popover {
        position: absolute;
        top: calc(100% + 8px);
        left: 0;
        width: 280px;
        background: var(--bg-panel);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
        z-index: 1000;
        overflow: hidden;
    }

    .popover-header {
        padding: 12px 16px;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        border-bottom: 1px solid var(--border-color);
    }

    .popover-content {
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .section-label {
        display: block;
        font-size: 11px;
        font-weight: 500;
        color: var(--text-muted);
        margin-bottom: 6px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .preset-buttons {
        display: flex;
        gap: 4px;
    }

    .preset-btn {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background: var(--bg-input);
        color: var(--text-secondary);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .preset-btn:hover {
        border-color: var(--accent-primary);
        color: var(--text-primary);
    }

    .preset-btn.active {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
    }

    .advanced-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 8px 0;
        border: none;
        background: transparent;
        color: var(--text-muted);
        font-size: 12px;
        cursor: pointer;
        transition: color 0.15s;
    }

    .advanced-toggle:hover {
        color: var(--text-primary);
    }

    .custom-badge {
        margin-left: auto;
        padding: 2px 6px;
        background: var(--accent-secondary);
        color: white;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
    }

    .advanced-section {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        background: var(--bg-input);
        border-radius: 6px;
    }

    .slider-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .slider-row label {
        font-size: 11px;
        color: var(--text-muted);
    }

    .slider-row input[type="range"] {
        width: 100%;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background: var(--border-color);
        border-radius: 2px;
        cursor: pointer;
    }

    .slider-row input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        background: var(--accent-primary);
        border-radius: 50%;
        cursor: pointer;
    }

    .slider-value {
        font-size: 12px;
        font-family: 'Monaco', 'Menlo', monospace;
        font-weight: 600;
        color: var(--text-primary);
        text-align: right;
    }

    .popover-footer {
        display: flex;
        gap: 8px;
        padding: 12px 16px;
        border-top: 1px solid var(--border-color);
    }

    .footer-btn {
        flex: 1;
        padding: 8px 16px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .footer-btn.secondary {
        background: var(--bg-input);
        color: var(--text-secondary);
    }

    .footer-btn.secondary:hover {
        background: var(--bg-panel);
        color: var(--text-primary);
    }

    .footer-btn.primary {
        background: var(--accent-primary);
        color: white;
    }

    .footer-btn.primary:hover {
        filter: brightness(1.1);
    }
</style>
