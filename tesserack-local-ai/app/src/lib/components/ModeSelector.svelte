<script>
    import { activeMode } from '$lib/stores/agent';
    import { stats } from '$lib/stores/agent';
    import { modelState, trainingProgress } from '$lib/stores/training';
    import { startWatchMode, stopAll, saveGame, loadGame, initAudio, setAudioEnabled, setVolume } from '$lib/core/game-init.js';
    import { Play, Pause, Square, Save, FolderOpen, Zap, Volume2, VolumeX } from 'lucide-svelte';

    let audioEnabled = false;
    let volume = 50; // 0-100

    async function toggleAudio() {
        if (!audioEnabled) {
            // First time - need to initialize from user gesture
            const success = await initAudio();
            if (success) {
                audioEnabled = true;
                setAudioEnabled(true);
                setVolume(volume / 100);
            }
        } else {
            audioEnabled = false;
            setAudioEnabled(false);
        }
    }

    function handleVolumeChange(e) {
        volume = e.target.value;
        setVolume(volume / 100);
    }

    function togglePlay() {
        if ($activeMode === 'idle') {
            // Start the simulation
            activeMode.set('watch');
            startWatchMode();
        } else {
            // Pause (stop) the simulation
            stopAll();
            activeMode.set('idle');
        }
    }

    function stop() {
        stopAll();
        activeMode.set('idle');
    }

    function handleSave() {
        saveGame();
    }

    function handleLoad() {
        loadGame();
    }

    $: isRunning = $activeMode !== 'idle';
    $: isPaused = $activeMode === 'idle';

    // Progress calculation - use the trainer's next threshold
    const thresholds = [3000, 7000, 15000, 30000, 60000, 100000];
    $: nextAutoTrain = $modelState.nextAutoTrain || 3000;
    $: currentThreshold = typeof nextAutoTrain === 'number' ? nextAutoTrain : 100000;
    $: thresholdIndex = thresholds.indexOf(currentThreshold);
    $: prevThreshold = thresholdIndex > 0 ? thresholds[thresholdIndex - 1] : 0;
    $: progress = currentThreshold > prevThreshold
        ? Math.min(100, Math.max(0, (($stats.experiences - prevThreshold) / (currentThreshold - prevThreshold)) * 100))
        : 100;
    $: level = $modelState.sessions || 0;
    $: isTraining = $trainingProgress.active;
</script>

<div class="control-panel panel">
    <!-- Primary Controls: Play/Pause and Stop -->
    <div class="primary-controls">
        <button
            class="play-btn"
            class:running={isRunning}
            on:click={togglePlay}
            title={isRunning ? 'Pause simulation' : 'Start simulation'}
        >
            <span class="play-icon">
                {#if isRunning}
                    <Pause size={20} strokeWidth={2.5} />
                {:else}
                    <Play size={20} strokeWidth={2.5} />
                {/if}
            </span>
            <span class="play-label">{isRunning ? 'Pause' : 'Start'}</span>
            {#if isRunning}
                <span class="running-indicator"></span>
            {/if}
        </button>

        <button
            class="stop-btn"
            class:visible={isRunning}
            on:click={stop}
            title="Stop and reset"
        >
            <Square size={16} strokeWidth={2.5} />
        </button>
    </div>

    <!-- Progress Indicator -->
    <div class="progress-section" title="Training data: {$stats.experiences.toLocaleString()} samples collected. Auto-trains at {currentThreshold.toLocaleString()}.">
        <div class="progress-bar-container">
            <div class="progress-label">Learning Progress</div>
            <div class="progress-bar">
                <div
                    class="progress-fill"
                    class:training={isTraining}
                    style="width: {progress}%"
                ></div>
            </div>
            <div class="progress-info">
                {#if isTraining}
                    <Zap size={12} class="training-icon" />
                    <span>Training neural network...</span>
                {:else if level > 0}
                    <span class="level">Trained {level}x</span>
                    <span class="samples">{$stats.experiences.toLocaleString()} samples</span>
                {:else}
                    <span class="samples">{$stats.experiences.toLocaleString()} / {currentThreshold.toLocaleString()} samples</span>
                {/if}
            </div>
        </div>
    </div>

    <!-- Utility Controls: Save/Load/Audio -->
    <div class="utility-controls">
        <button class="util-btn" on:click={handleSave} title="Save game state">
            <Save size={16} />
            <span>Save</span>
        </button>
        <button class="util-btn" on:click={handleLoad} title="Load saved game">
            <FolderOpen size={16} />
            <span>Load</span>
        </button>
        <button
            class="util-btn"
            class:active={audioEnabled}
            on:click={toggleAudio}
            title={audioEnabled ? 'Mute audio' : 'Enable audio'}
        >
            {#if audioEnabled}
                <Volume2 size={16} />
            {:else}
                <VolumeX size={16} />
            {/if}
        </button>
        {#if audioEnabled}
            <input
                type="range"
                class="volume-slider"
                min="0"
                max="100"
                bind:value={volume}
                on:input={handleVolumeChange}
                title="Volume: {volume}%"
            />
        {/if}
    </div>
</div>

<style>
    .control-panel {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 12px 16px;
    }

    /* Primary Controls */
    .primary-controls {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .play-btn {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px 20px;
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: 14px;
        font-weight: 600;
        border-radius: var(--border-radius);
        transition: all 0.2s ease;
        overflow: hidden;
    }

    .play-btn:hover {
        background: var(--bg-dark);
    }

    .play-btn:active {
        transform: scale(0.98);
    }

    .play-btn.running {
        background: var(--accent-primary);
        color: white;
    }

    .play-btn.running:hover {
        background: #5fa8eb;
    }

    .play-icon {
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .running-indicator {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: rgba(255, 255, 255, 0.4);
        animation: pulse-bar 1.5s ease-in-out infinite;
    }

    @keyframes pulse-bar {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 0.8; }
    }

    .stop-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        background: var(--accent-secondary);
        color: white;
        border-radius: var(--border-radius);
        opacity: 0;
        pointer-events: none;
        transform: scale(0.8);
        transition: all 0.2s ease;
    }

    .stop-btn.visible {
        opacity: 1;
        pointer-events: auto;
        transform: scale(1);
    }

    .stop-btn:hover {
        background: #ff8787;
    }

    .stop-btn:active {
        transform: scale(0.95);
    }

    /* Progress Section */
    .progress-section {
        flex: 1;
        min-width: 120px;
    }

    .progress-bar-container {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .progress-bar {
        height: 6px;
        background: var(--bg-dark);
        border-radius: 3px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-primary), #a29bfe);
        border-radius: 3px;
        transition: width 0.5s ease;
    }

    .progress-fill.training {
        background: linear-gradient(90deg, var(--accent-success), #55efc4);
        animation: shimmer 1.5s ease-in-out infinite;
    }

    @keyframes shimmer {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.7; }
    }

    .progress-info {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--text-muted);
    }

    .progress-info :global(.training-icon) {
        color: var(--accent-success);
        animation: zap 0.5s ease-in-out infinite alternate;
    }

    @keyframes zap {
        from { opacity: 0.6; }
        to { opacity: 1; }
    }

    .progress-label {
        font-size: 10px;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        margin-bottom: 4px;
    }

    .level {
        font-weight: 600;
        color: var(--accent-primary);
    }

    .samples {
        color: var(--text-secondary);
    }

    /* Utility Controls */
    .utility-controls {
        display: flex;
        gap: 4px;
        padding-left: 12px;
        border-left: 1px solid var(--border-color);
    }

    .util-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 12px;
        background: var(--bg-input);
        color: var(--text-secondary);
        font-size: 12px;
        font-weight: 500;
        border-radius: var(--border-radius);
        transition: all 0.15s ease;
    }

    .util-btn:hover {
        background: var(--bg-dark);
        color: var(--text-primary);
    }

    .util-btn:active {
        transform: scale(0.98);
    }

    .util-btn.active {
        background: var(--accent-primary);
        color: white;
    }

    .util-btn.active:hover {
        background: #5fa8eb;
    }

    .volume-slider {
        width: 60px;
        height: 4px;
        -webkit-appearance: none;
        appearance: none;
        background: var(--bg-dark);
        border-radius: 2px;
        cursor: pointer;
    }

    .volume-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 12px;
        height: 12px;
        background: var(--accent-primary);
        border-radius: 50%;
        cursor: pointer;
    }

    .volume-slider::-moz-range-thumb {
        width: 12px;
        height: 12px;
        background: var(--accent-primary);
        border-radius: 50%;
        cursor: pointer;
        border: none;
    }
</style>
