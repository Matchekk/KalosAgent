<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import { romBuffer, romLoaded } from '$lib/stores/game';
    import { initializeLab, isLabInitialized } from '$lib/core/lab/lab-init.js';

    const dispatch = createEventDispatcher();

    let canvas;
    let initialized = false;
    let error = null;
    let initAttempted = false;

    async function tryInitialize(buffer) {
        if (!buffer || !canvas || initAttempted) return;
        if (isLabInitialized()) {
            initialized = true;
            return;
        }

        initAttempted = true;
        error = null;

        try {
            const instances = await initializeLab(buffer, canvas);
            initialized = true;
            dispatch('initialized', instances);
        } catch (e) {
            error = e.message;
            initAttempted = false; // Allow retry on error
        }
    }

    onMount(() => {
        // Try to initialize if ROM is already loaded
        if ($romBuffer) {
            tryInitialize($romBuffer);
        }
    });

    // React to ROM being loaded
    $: if (canvas && $romBuffer && !initialized) {
        tryInitialize($romBuffer);
    }

</script>

<div class="lab-canvas-container">
    {#if !$romLoaded}
        <div class="error-message">
            <p>No ROM loaded</p>
        </div>
    {:else if error}
        <div class="error-message">
            <p>{error}</p>
        </div>
    {:else}
        <canvas
            bind:this={canvas}
            width="160"
            height="144"
            class="lab-canvas"
        ></canvas>
        {#if !initialized}
            <div class="loading-overlay">
                <span>Initializing...</span>
            </div>
        {/if}
    {/if}
</div>

<style>
    .lab-canvas-container {
        position: relative;
        background: #000;
        border-radius: 4px;
        overflow: hidden;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .lab-canvas {
        max-width: 100%;
        max-height: 100%;
        aspect-ratio: 160 / 144;
        image-rendering: pixelated;
        display: block;
        /* Scale up to fill container while maintaining aspect ratio */
        width: auto;
        height: 100%;
    }

    .error-message {
        padding: 20px;
        text-align: center;
        color: var(--text-muted);
    }

    .error-message p {
        margin: 0;
    }

    .loading-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.8);
        color: var(--text-muted);
        font-size: 14px;
    }
</style>
