<script>
    import { onMount } from 'svelte';
    import { romLoaded, romBuffer } from '$lib/stores/game';
    import { feedSystem } from '$lib/stores/feed';
    import { hasROM, loadROM, saveROM } from '$lib/core/persistence.js';
    import { startIntroSkip } from '$lib/core/game-init.js';
    import { Upload, PlayCircle, FastForward } from 'lucide-svelte';

    let dragging = false;
    let fileInput;
    let hasSavedROM = false;
    let skipIntro = true; // Default to skipping intro

    onMount(() => {
        hasSavedROM = hasROM();
    });

    async function handleFile(file, shouldSkipIntro = false) {
        if (!file) return;

        feedSystem(`Loading ${file.name}...`);

        try {
            const buffer = await file.arrayBuffer();
            console.log('ROM loaded:', buffer.byteLength, 'bytes');

            // Save ROM for returning users
            await saveROM(buffer);

            // Store the buffer - GameCanvas will handle initialization
            romBuffer.set(buffer);
            romLoaded.set(true);

            // Start intro skip if requested (with a small delay for emulator init)
            if (shouldSkipIntro) {
                setTimeout(() => {
                    startIntroSkip();
                }, 500);
            }

        } catch (err) {
            feedSystem(`Error: ${err.message}`);
            console.error('Failed to load ROM:', err);
        }
    }

    function loadSavedROM(shouldSkipIntro = false) {
        feedSystem('Loading saved ROM...');
        try {
            const buffer = loadROM();
            if (buffer) {
                romBuffer.set(buffer);
                romLoaded.set(true);
                feedSystem('ROM loaded from previous session');

                // Start intro skip if requested
                if (shouldSkipIntro) {
                    setTimeout(() => {
                        startIntroSkip();
                    }, 500);
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

    function handleDrop(e) {
        e.preventDefault();
        dragging = false;
        const file = e.dataTransfer.files[0];
        handleFile(file, skipIntro);
    }

    function handleDragOver(e) {
        e.preventDefault();
        dragging = true;
    }

    function handleDragLeave() {
        dragging = false;
    }

    function handleClick() {
        fileInput.click();
    }

    function handleInputChange(e) {
        const file = e.target.files[0];
        handleFile(file, skipIntro);
    }
</script>

<div class="dropzone-container">
    {#if hasSavedROM}
        <button class="continue-btn" on:click={() => loadSavedROM(false)}>
            <PlayCircle size={24} />
            <span class="continue-text">
                <strong>Continue</strong>
                <small>Resume from previous session</small>
            </span>
        </button>
        <div class="or-divider">
            <span>or</span>
        </div>
    {/if}

    <div
        class="dropzone"
        class:dragging
        class:compact={hasSavedROM}
        on:drop={handleDrop}
        on:dragover={handleDragOver}
        on:dragleave={handleDragLeave}
        on:click={handleClick}
        role="button"
        tabindex="0"
        on:keypress={(e) => e.key === 'Enter' && handleClick()}
    >
        <div class="dropzone-content">
            <div class="icon">
                <Upload size={hasSavedROM ? 24 : 40} strokeWidth={1.5} />
            </div>
            {#if hasSavedROM}
                <p class="subtitle">Drop new ROM or click to select</p>
            {:else}
                <p class="title">Drop Pokemon Red ROM</p>
                <p class="subtitle">or click to select file</p>
                <p class="format">.gb, .gbc</p>
            {/if}
        </div>

        <input
            type="file"
            accept=".gb,.gbc"
            bind:this={fileInput}
            on:change={handleInputChange}
            hidden
        />
    </div>

    <label class="skip-intro-toggle">
        <input type="checkbox" bind:checked={skipIntro} />
        <FastForward size={14} />
        <span>Quick Start (auto-skip intro)</span>
    </label>
</div>

<style>
    .dropzone-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .continue-btn {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 20px 24px;
        background: linear-gradient(135deg, var(--accent-primary), #a29bfe);
        color: white;
        border-radius: var(--border-radius);
        font-size: 14px;
        text-align: left;
        transition: transform 0.15s, box-shadow 0.15s;
    }

    .continue-btn:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(116, 185, 255, 0.3);
    }

    .continue-text {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .continue-text strong {
        font-size: 16px;
    }

    .continue-text small {
        opacity: 0.8;
        font-size: 12px;
    }

    .or-divider {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--text-muted);
        font-size: 12px;
    }

    .or-divider::before,
    .or-divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: var(--border-color);
    }

    .dropzone {
        width: 100%;
        aspect-ratio: 160 / 144;
        background: var(--bg-panel);
        border: 2px dashed var(--text-muted);
        border-radius: var(--border-radius);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.2s;
    }

    .dropzone.compact {
        aspect-ratio: auto;
        padding: 16px;
    }

    .dropzone:hover,
    .dropzone.dragging {
        border-color: var(--accent-primary);
        background: rgba(116, 185, 255, 0.08);
    }

    .dropzone-content {
        text-align: center;
    }

    .icon {
        color: var(--text-muted);
        margin-bottom: 16px;
    }

    .dropzone.compact .icon {
        margin-bottom: 8px;
    }

    .dropzone:hover .icon,
    .dropzone.dragging .icon {
        color: var(--accent-primary);
    }

    .format {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 8px;
        font-family: monospace;
    }

    .title {
        font-size: 16px;
        font-weight: 500;
        margin-bottom: 4px;
    }

    .subtitle {
        font-size: 13px;
        color: var(--text-secondary);
    }

    .skip-intro-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: var(--bg-panel);
        border-radius: var(--border-radius);
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: background 0.15s;
    }

    .skip-intro-toggle:hover {
        background: var(--bg-input);
    }

    .skip-intro-toggle input {
        cursor: pointer;
    }

    .skip-intro-toggle input:checked + :global(svg) {
        color: var(--accent-primary);
    }
</style>
