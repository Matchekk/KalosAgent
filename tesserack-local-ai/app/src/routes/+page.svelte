<script>
    import { onMount } from 'svelte';
    import { browser } from '$app/environment';
    import { Info, Github, ExternalLink } from 'lucide-svelte';

    // Components
    import Header from '$lib/components/Header.svelte';
    import GameCanvas from '$lib/components/GameCanvas.svelte';
    import ModeSelector from '$lib/components/ModeSelector.svelte';
    import GameStateBar from '$lib/components/GameStateBar.svelte';
    import AIPanel from '$lib/components/AIPanel.svelte';
    import ProgressBar from '$lib/components/ProgressBar.svelte';
    import GameControls from '$lib/components/GameControls.svelte';
    import HintInput from '$lib/components/HintInput.svelte';
    import ActivityFeed from '$lib/components/ActivityFeed.svelte';
    import AdvancedPanel from '$lib/components/AdvancedPanel.svelte';
    import ModelStatus from '$lib/components/ModelStatus.svelte';
    import LabView from '$lib/components/lab/LabView.svelte';
    import WatchView from '$lib/components/WatchView.svelte';

    // Stores
    import { romLoaded, gameState } from '$lib/stores/game';
    import { activeMode } from '$lib/stores/agent';
    import { modelState } from '$lib/stores/training';
    import { feedSystem } from '$lib/stores/feed';

    // View mode: 'lab' (default), 'watch', or 'classic'
    let viewMode = 'lab';
    let mounted = false;

    onMount(() => {
        // Restore last view mode (but default to lab)
        const savedMode = localStorage.getItem('tesserack_viewMode');
        if (savedMode === 'watch' || savedMode === 'classic') {
            viewMode = savedMode;
        }
        mounted = true;

        feedSystem('Welcome to Tesserack! Drop a Pokemon Red ROM to begin.');
    });

    // Save view mode when it changes (only after initial mount)
    $: if (mounted && viewMode) {
        localStorage.setItem('tesserack_viewMode', viewMode);
    }

</script>

<div class="app">
    <Header {viewMode} onViewModeChange={(mode) => viewMode = mode} />

    {#if viewMode === 'watch'}
        <!-- Watch Mode (Default) - Live stream -->
        <main class="watch-content">
            <WatchView />
        </main>
    {:else if viewMode === 'lab'}
        <!-- Lab Mode - Train your own -->
        <main class="lab-content">
            <div class="lab-layout">
                <div class="lab-main">
                    <LabView />
                </div>
                <div class="lab-sidebar">
                    <ActivityFeed />
                </div>
            </div>
        </main>
    {:else}
        <!-- Classic Mode -->
        <main class="main-content">
            <div class="left-column">
                {#if !$romLoaded}
                    <div class="play-prompt">
                        <p>Load a ROM using the dropdown above to start playing</p>
                    </div>
                {:else}
                    <GameCanvas />
                {/if}

                <ProgressBar />

                {#if $romLoaded}
                    <GameControls />
                    <HintInput />
                {/if}
            </div>

            <div class="right-column">
                {#if $romLoaded}
                    <ModeSelector />
                    <ModelStatus />
                    <GameStateBar />
                    <AIPanel />
                {/if}
            </div>
        </main>

        <AdvancedPanel />

        <div class="global-feed">
            <ActivityFeed />
        </div>
    {/if}

    <footer class="credits-footer">
        <span>Made by Sid Mohan</span>
        <div class="credits-links">
            <a href="https://github.com/sidmohan0" target="_blank" rel="noopener noreferrer">
                <Github size={14} />
                <span>GitHub</span>
            </a>
            <a href="https://threadfork.com" target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} />
                <span>Threadfork</span>
            </a>
            <a href="https://datafog.ai" target="_blank" rel="noopener noreferrer">
                <ExternalLink size={14} />
                <span>DataFog</span>
            </a>
        </div>
    </footer>
</div>

<style>
    .app {
        max-width: 1400px;
        margin: 0 auto;
        padding: 12px 8px;
        min-height: 100vh;
        display: flex;
        flex-direction: column;
    }

    .watch-content {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
    }

    .lab-content {
        margin-top: 8px;
        min-height: 800px;
        flex: 1;
    }


    .lab-layout {
        display: grid;
        grid-template-columns: 1fr 340px;
        gap: 12px;
        height: 100%;
    }

    .lab-main {
        min-width: 0; /* Prevent grid blowout */
        height: 100%;
    }

    .lab-sidebar {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .lab-sidebar :global(.activity-feed) {
        position: sticky;
        top: 16px;
        max-height: calc(100vh - 150px);
    }

    .lab-sidebar :global(.feed-list) {
        max-height: calc(100vh - 250px);
    }

    @media (max-width: 1000px) {
        .lab-layout {
            grid-template-columns: 1fr;
        }

        .lab-sidebar {
            order: -1; /* Put feed above on mobile */
        }

        .lab-sidebar :global(.activity-feed) {
            position: static;
            max-height: 200px;
        }

        .lab-sidebar :global(.feed-list) {
            max-height: 160px;
        }
    }

    .play-prompt {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 40px 20px;
        background: var(--bg-panel);
        border: 2px dashed var(--border-color);
        border-radius: var(--border-radius);
        text-align: center;
        color: var(--text-muted);
        font-size: 14px;
        aspect-ratio: 160 / 144;
    }

    .main-content {
        display: grid;
        grid-template-columns: 400px 1fr;
        gap: 20px;
        margin-top: 16px;
    }

    .left-column {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .right-column {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    @media (max-width: 900px) {
        .main-content {
            grid-template-columns: 1fr;
        }
    }

    .credits-footer {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 16px;
        margin-top: 16px;
        padding: 12px;
        font-size: 12px;
        color: var(--text-muted);
    }

    .credits-footer span {
        font-weight: 500;
    }

    .credits-links {
        display: flex;
        gap: 16px;
    }

    .credits-links a {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--text-secondary);
        text-decoration: none;
        transition: color 0.15s;
    }

    .credits-links a:hover {
        color: var(--accent-primary);
    }

    /* Global Activity Feed */
    .global-feed {
        margin-top: 16px;
    }

    .global-feed :global(.activity-feed) {
        min-height: 120px;
        max-height: 200px;
    }

    .global-feed :global(.feed-list) {
        max-height: 160px;
    }
</style>
