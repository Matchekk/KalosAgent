<script>
    import { onMount } from 'svelte';
    import { get } from 'svelte/store';
    import { romBuffer } from '$lib/stores/game';
    import { initializeGame } from '$lib/core/game-init.js';

    let canvas;

    onMount(async () => {
        const buffer = get(romBuffer);
        if (buffer && canvas) {
            await initializeGame(buffer, canvas);
        }
    });
</script>

<div class="canvas-container">
    <canvas
        bind:this={canvas}
        width="160"
        height="144"
        class="game-canvas"
    ></canvas>
</div>

<style>
    .canvas-container {
        background: var(--bg-panel);
        border-radius: var(--border-radius);
        padding: 12px;
        border: 1px solid var(--border-color);
        box-shadow: var(--shadow-soft);
    }

    .game-canvas {
        width: 100%;
        aspect-ratio: 160 / 144;
        image-rendering: pixelated;
        background: #000;
        display: block;
        border-radius: var(--border-radius-sm);
    }
</style>
