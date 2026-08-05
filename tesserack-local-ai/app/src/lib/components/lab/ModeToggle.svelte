<script>
    import { createEventDispatcher } from 'svelte';
    import { Play, Brain } from 'lucide-svelte';

    export let mode = 'play'; // 'play' | 'train'
    export let disabled = false;

    const dispatch = createEventDispatcher();

    function setMode(newMode) {
        if (disabled || newMode === mode) return;
        mode = newMode;
        dispatch('change', { mode: newMode });
    }
</script>

<div class="mode-toggle" class:disabled>
    <button
        class="mode-btn"
        class:active={mode === 'play'}
        on:click={() => setMode('play')}
        {disabled}
        title="Play mode - LLM-guided agent follows strategy guide"
    >
        <Play size={14} />
        <span>Play</span>
    </button>
    <button
        class="mode-btn"
        class:active={mode === 'train'}
        on:click={() => setMode('train')}
        {disabled}
        title="Train mode - Pure RL learning with REINFORCE"
    >
        <Brain size={14} />
        <span>Train</span>
    </button>
</div>

<style>
    .mode-toggle {
        display: flex;
        background: var(--bg-input);
        border-radius: 6px;
        padding: 3px;
        gap: 2px;
    }

    .mode-toggle.disabled {
        opacity: 0.6;
        pointer-events: none;
    }

    .mode-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
    }

    .mode-btn:hover:not(:disabled) {
        color: var(--text-primary);
        background: var(--bg-panel);
    }

    .mode-btn.active {
        background: var(--accent-primary);
        color: white;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .mode-btn:disabled {
        cursor: not-allowed;
    }
</style>
