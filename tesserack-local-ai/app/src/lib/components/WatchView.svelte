<script>
    import { onMount, onDestroy } from 'svelte';
    import { FlaskConical, Cpu, BookOpen } from 'lucide-svelte';
    import { twitchStatus, setLive } from '$lib/stores/twitch.js';

    const TWITCH_CHANNEL = 'sidmosf';

    let playerContainer;
    let player = null;

    $: isLive = $twitchStatus.isLive;

    onMount(() => {
        // Load Twitch Embed SDK
        if (typeof window !== 'undefined' && !window.Twitch) {
            const script = document.createElement('script');
            script.src = 'https://embed.twitch.tv/embed/v1.js';
            script.onload = initPlayer;
            document.head.appendChild(script);
        } else if (window.Twitch) {
            initPlayer();
        }
    });

    function initPlayer() {
        if (!playerContainer || player) return;

        const parent = window.location.hostname || 'localhost';

        player = new window.Twitch.Embed(playerContainer, {
            channel: TWITCH_CHANNEL,
            width: '100%',
            height: '100%',
            parent: [parent],
            muted: true,
            autoplay: true,
        });

        player.addEventListener(window.Twitch.Embed.VIDEO_READY, () => {
            const twitchPlayer = player.getPlayer();

            // Check initial state after a short delay
            setTimeout(() => {
                checkLiveStatus(twitchPlayer);
            }, 2000);

            // Listen for play/pause which can indicate stream status
            twitchPlayer.addEventListener(window.Twitch.Player.PLAYING, () => {
                checkLiveStatus(twitchPlayer);
            });

            twitchPlayer.addEventListener(window.Twitch.Player.OFFLINE, () => {
                setLive(false);
            });

            twitchPlayer.addEventListener(window.Twitch.Player.ONLINE, () => {
                setLive(true);
            });
        });
    }

    function checkLiveStatus(twitchPlayer) {
        // getChannel returns channel info - if there's a stream, it's live
        try {
            const playback = twitchPlayer.getPlaybackStats();
            // If we have playback stats with video info, stream is likely live
            if (playback && playback.videoResolution) {
                setLive(true);
            }
        } catch (e) {
            // Can't determine, assume checking
        }
    }

    onDestroy(() => {
        player = null;
    });
</script>

<div class="watch-view">
    <div class="watch-header">
        {#if isLive}
            <span class="live-badge">LIVE</span>
        {:else}
            <span class="offline-badge">OFFLINE</span>
        {/if}
        <span class="stream-title">
            {#if isLive}
                AI learning Pokemon with unit test rewards
            {:else}
                Stream offline - check back later or try the Lab!
            {/if}
        </span>
    </div>

    <div class="stream-container">
        <div class="stream-wrapper" bind:this={playerContainer}></div>
    </div>

    <div class="info-section">
        <div class="info-card">
            <div class="info-icon"><Cpu size={20} /></div>
            <div class="info-content">
                <h3>What's happening?</h3>
                <p>A REINFORCE policy network is learning to play Pokemon Red using dense rewards extracted from the Prima Strategy Guide. No human input - pure reinforcement learning.</p>
            </div>
        </div>

        <div class="info-card">
            <div class="info-icon"><BookOpen size={20} /></div>
            <div class="info-content">
                <h3>How it works</h3>
                <p>Claude Vision read 55 pages of the guide and extracted 675 unit tests across 41 locations. The agent gets rewarded for walking toward objectives, reaching landmarks, and completing goals.</p>
            </div>
        </div>

        <div class="info-card">
            <div class="info-icon"><FlaskConical size={20} /></div>
            <div class="info-content">
                <h3>Try it yourself</h3>
                <p>Switch to the <strong>Lab</strong> tab to train your own agent in-browser. No server required - runs entirely on WebGPU.</p>
            </div>
        </div>
    </div>
</div>

<style>
    .watch-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 16px;
        padding: 16px;
    }

    .watch-header {
        display: flex;
        align-items: center;
        gap: 12px;
    }

    .live-badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        background: #e74c3c;
        color: white;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        border-radius: 4px;
        animation: pulse-live 2s ease-in-out infinite;
    }

    .offline-badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 8px;
        background: var(--bg-input);
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.5px;
        border-radius: 4px;
    }

    @keyframes pulse-live {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
    }

    .stream-title {
        flex: 1;
        font-size: 14px;
        color: var(--text-secondary);
    }

    .stream-container {
        flex: 1;
        min-height: 400px;
    }

    .stream-wrapper {
        position: relative;
        background: #000;
        border-radius: 8px;
        overflow: hidden;
        aspect-ratio: 16 / 9;
        max-width: 100%;
    }

    .stream-wrapper :global(iframe) {
        border-radius: 8px;
    }

    .info-section {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 12px;
    }

    @media (max-width: 900px) {
        .info-section {
            grid-template-columns: 1fr;
        }
    }

    .info-card {
        display: flex;
        gap: 12px;
        padding: 16px;
        background: var(--bg-panel);
        border-radius: 8px;
        border: 1px solid var(--border-color);
    }

    .info-icon {
        flex-shrink: 0;
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg-input);
        border-radius: 8px;
        color: var(--accent-primary);
    }

    .info-content {
        flex: 1;
        min-width: 0;
    }

    .info-content h3 {
        margin: 0 0 4px 0;
        font-size: 14px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .info-content p {
        margin: 0;
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.5;
    }
</style>
