<script>
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { Play, Pause, RotateCcw, Save, FolderOpen, FastForward, SkipForward, ChevronDown, Download, Upload, Check, Loader } from 'lucide-svelte';
    import LabCanvas from './LabCanvas.svelte';
    import ModeToggle from './ModeToggle.svelte';
    import HyperparamsPopover from './HyperparamsPopover.svelte';
    import MetricsChart from './MetricsChart.svelte';
    import RewardBar from './RewardBar.svelte';
    import TestsPanel from './TestsPanel.svelte';
    import WalkthroughGraph from './WalkthroughGraph.svelte';
    import {
        walkthroughGraph,
        currentGraphLocation,
        completedObjectives,
        labMetrics,
        graphStats,
        completionPercentage,
        loadWalkthroughGraph,
        resetMetrics,
        rlConfig
    } from '$lib/stores/lab';
    import {
        startLabAgent,
        stopLabAgent,
        resetLab,
        getLabInstances,
        setLabSpeed,
        stepLabAgent,
        setLabMode,
        labMode,
        labRunStatus,
        pureRLMetrics,
        labDemonstration,
        startLabDemonstration,
        recordLabDemonstrationAction,
        advanceLabDemonstration,
        finishLabDemonstration,
        updateRLConfig,
        cleanupLab
    } from '$lib/core/lab/lab-init.js';
    import { exportAllData, importAllData, getLabSaveStates, setLabSaveStates } from '$lib/core/persistence.js';
    import { feedSystem } from '$lib/stores/feed';
    import { romLoaded } from '$lib/stores/game';
    import { llmState, PROVIDERS, setModel, setLLMProgress, setLLMReady, setLLMError } from '$lib/stores/llm';
    import { initBrowserLLM, isReady as isLLMConfigured } from '$lib/core/llm.js';
    import { getLabRunBlockReason } from '$lib/core/lab/lab-readiness.js';
    import { resolveRedppLocation } from '$lib/core/lab/redpp-location-data.js';
    import { deriveRedppGuideObjectives } from '$lib/core/lab/redpp-objective-progress.js';

    let isRunning = false;
    let labInitialized = false;
    $: isRunning = $labRunStatus.running || $labRunStatus.recovering;
    let hyperparamsOpen = false;
    let howItWorksExpanded = false;
    let demonstrationInputBusy = false;

    // Mode: 'play' (LLM) or 'train' (RL)
    $: mode = $labMode === 'purerl' ? 'train' : 'play';

    // LLM model state for Play mode
    let modelLoading = false;
    let modelLoadProgress = 0;
    let modelLoadMessage = '';
    $: browserModels = PROVIDERS.browser.models;
    $: selectedModel = $llmState.model;
    $: isModelReady = $llmState.status === 'ready';
    $: selectedProvider = PROVIDERS[$llmState.provider] || PROVIDERS.browser;
    $: selectedApiModel = $llmState.provider === 'llamacpp'
        ? $llmState.llamacppModel
        : $llmState.provider === 'custom'
            ? $llmState.customModel
            : $llmState.model;
    $: selectedEndpoint = $llmState.provider === 'llamacpp'
        ? $llmState.llamacppEndpoint
        : $llmState.provider === 'custom'
            ? $llmState.customEndpoint
            : selectedProvider.endpoint;
    $: runBlockReason = getLabRunBlockReason({
        romLoaded: $romLoaded,
        labInitialized,
        mode,
        provider: $llmState.provider,
        needsApiKey: selectedProvider.needsKey,
        apiKey: $llmState.apiKey,
        endpoint: selectedEndpoint,
        model: selectedApiModel,
    });

    // Playback controls
    let playbackSpeed = 1;
    const speeds = [0.5, 1, 2, 4, 8, 16];

    // Save states
    let savedStates = [];
    let showSaveStates = false;
    let autosaveEnabled = false;
    let autosaveInterval = null;

    // Historical storage id retained so existing user settings still load.
    const algorithms = [
        { id: 'reinforce', label: 'PPO/GAE' },
    ];
    let selectedAlgorithm = 'reinforce';
    let showAlgorithmDropdown = false;

    // Train uses objective evidence from the currently rendered worker's RAM.
    // The independent fresh-ROM E4 proof remains separate and is never
    // promoted by this diagnostic map.
    $: trainMapCompletedObjectives = deriveRedppGuideObjectives(
        $pureRLMetrics.visibleState,
        $pureRLMetrics.completedObjectives,
    );
    $: mapCompletedObjectives = mode === 'train'
        ? trainMapCompletedObjectives
        : $completedObjectives;
    $: guideContext = buildGuideContext($currentGraphLocation, $walkthroughGraph, mapCompletedObjectives);

    function buildGuideContext(locationName, graph, completed) {
        if (!graph?.nodes?.length || !locationName) return null;

        const { exactLocation, guideLocation } = resolveRedppLocation(locationName);

        const location = graph.nodes.find(n =>
            n.type === 'location' &&
            n.name.toLowerCase() === guideLocation.toLowerCase()
        );

        if (!location) return null;

        const objectives = [];
        for (const edge of graph.edges) {
            if (edge.from === location.id && edge.type === 'contains') {
                const target = graph.nodes.find(n => n.id === edge.to);
                if (target?.type === 'objective' && !completed.has(target.name)) {
                    objectives.push(target);
                }
            }
        }

        return {
            location: exactLocation,
            guideLocation: location.name,
            description: location.description || '',
            objectives: objectives.slice(0, 4)
        };
    }

    onMount(async () => {
        await loadWalkthroughGraph();
        // Load saved states
        try {
            const stored = localStorage.getItem('tesserack_lab_states');
            if (stored) savedStates = JSON.parse(stored);
            // Restore autosave preference
            autosaveEnabled = localStorage.getItem('tesserack_autosave') === 'true';
        } catch (e) {}
    });

    onDestroy(() => {
        cleanupLab();
        if (autosaveInterval) clearInterval(autosaveInterval);
    });

    // Handle autosave toggle
    $: {
        if (autosaveEnabled && labInitialized) {
            if (!autosaveInterval) {
                autosaveInterval = setInterval(() => {
                    if (labInitialized && isRunning) {
                        saveState();
                    }
                }, 30000); // Every 30 seconds
            }
            localStorage.setItem('tesserack_autosave', 'true');
        } else {
            if (autosaveInterval) {
                clearInterval(autosaveInterval);
                autosaveInterval = null;
            }
            localStorage.setItem('tesserack_autosave', 'false');
        }
    }

    function handleLabInitialized() {
        labInitialized = true;
        feedSystem('Lab ready. Select Play or Train mode.');
    }

    function handleModeChange(event) {
        const newMode = event.detail.mode;
        if (isRunning) {
            stopLabAgent();
            isRunning = false;
        }
        setLabMode(newMode === 'train' ? 'purerl' : 'llm');
    }

    async function loadBrowserModel() {
        if (modelLoading) return;

        modelLoading = true;
        modelLoadProgress = 0;
        modelLoadMessage = 'Initializing...';
        feedSystem('Loading browser AI model...');

        try {
            await initBrowserLLM(selectedModel, (progress) => {
                modelLoadProgress = progress.progress || 0;
                modelLoadMessage = progress.text || 'Loading...';
                setLLMProgress(progress);
                if (progress.progress < 1) {
                    const pct = Math.round(progress.progress * 100);
                    if (pct % 10 === 0) {
                        feedSystem(`Downloading model: ${pct}%`);
                    }
                }
            });
            setLLMReady();
            feedSystem('AI model loaded!');
        } catch (err) {
            console.error('Model load failed:', err);
            setLLMError(err);
            feedSystem(`Model load failed: ${err.message}`);
        } finally {
            modelLoading = false;
        }
    }

    function handleModelChange(e) {
        setModel(e.target.value);
    }

    async function toggleRun() {
        if (isRunning) {
            pauseLab();
            return;
        }

        if (runBlockReason) {
            feedSystem(runBlockReason);
            return;
        }

        // Only the browser provider needs a model download. API-backed providers
        // (including llama.cpp) are ready as soon as endpoint + model are configured.
        if (mode === 'play' && !isLLMConfigured()) {
            const state = get(llmState);
            if (state.provider === 'browser') {
                await loadBrowserModel();
                if (!isLLMConfigured()) {
                    feedSystem('Cannot start: model failed to load');
                    return;
                }
            } else {
                feedSystem('Cannot start: configure an endpoint and model first');
                return;
            }
        }

        if (await startLabAgent()) {
            isRunning = true;
            feedSystem(mode === 'train' ? 'Training started...' : 'Playing with LLM guidance...');
        } else {
            isRunning = false;
            feedSystem('Cannot start: the Lab agent is unavailable.');
        }
    }

    function pauseLab(message = 'Paused.') {
        stopLabAgent();
        isRunning = false;
        feedSystem(message);
    }

    async function demonstrate(action) {
        if (!$labDemonstration.active || demonstrationInputBusy) return;
        demonstrationInputBusy = true;
        try {
            await recordLabDemonstrationAction(action);
        } finally {
            demonstrationInputBusy = false;
        }
    }

    async function toggleDemonstration() {
        if ($labDemonstration.active) await finishLabDemonstration();
        else startLabDemonstration();
    }

    function handleLabKeydown(event) {
        if ($labDemonstration.active) {
            if (event.key === ' ') {
                event.preventDefault();
                advanceLabDemonstration();
                return;
            }
            const keyMap = {
                ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
                z: 'a', x: 'b', Enter: 'start',
            };
            const action = keyMap[event.key];
            if (action) {
                event.preventDefault();
                void demonstrate(action);
                return;
            }
        }
        if (event.key !== 'Escape' || !isRunning) return;
        event.preventDefault();
        pauseLab('Paused with Escape.');
    }

    function handleReset() {
        stopLabAgent();
        resetLab();
        resetMetrics();
        isRunning = false;
        feedSystem(mode === 'train' ? 'Run reset; learned policy kept.' : 'Reset complete.');
    }

    function stepOnce() {
        if (!labInitialized || isRunning) return;
        stepLabAgent();
    }

    function cycleSpeed() {
        const idx = speeds.indexOf(playbackSpeed);
        playbackSpeed = speeds[(idx + 1) % speeds.length];
        setLabSpeed(playbackSpeed);
    }

    // Save/Load state helpers
    function uint8ArrayToBase64(arr) {
        let binary = '';
        for (let i = 0; i < arr.byteLength; i++) {
            binary += String.fromCharCode(arr[i]);
        }
        return btoa(binary);
    }

    function base64ToUint8Array(base64) {
        const binary = atob(base64);
        const arr = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            arr[i] = binary.charCodeAt(i);
        }
        return arr;
    }

    async function saveState() {
        if (!labInitialized) return;
        const { emulator } = getLabInstances();
        if (!emulator) return;

        try {
            const state = emulator.saveState();
            const newState = {
                id: Date.now(),
                name: `State ${savedStates.length + 1}`,
                timestamp: new Date().toISOString(),
                location: $currentGraphLocation,
                data: uint8ArrayToBase64(state)
            };
            savedStates = [...savedStates, newState];
            localStorage.setItem('tesserack_lab_states', JSON.stringify(savedStates));
            feedSystem(`Saved: ${newState.name}`);
        } catch (e) {
            feedSystem(`Save failed: ${e.message}`);
        }
    }

    async function loadState(state) {
        if (!labInitialized) return;
        const { emulator } = getLabInstances();
        if (!emulator) return;

        try {
            emulator.loadState(base64ToUint8Array(state.data));
            feedSystem(`Loaded: ${state.name}`);
            showSaveStates = false;
        } catch (e) {
            feedSystem(`Load failed: ${e.message}`);
        }
    }

    function deleteState(state) {
        savedStates = savedStates.filter(s => s.id !== state.id);
        localStorage.setItem('tesserack_lab_states', JSON.stringify(savedStates));
    }

    // Export all data (training data + save states)
    async function handleExport() {
        try {
            feedSystem('Exporting data...');
            const data = await exportAllData();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tesserack-backup-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            feedSystem(`Exported ${data.labSaveStates?.length || 0} save states + training data`);
        } catch (err) {
            feedSystem(`Export failed: ${err.message}`);
        }
    }

    // Import data from file
    function handleImportClick() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                feedSystem('Importing data...');
                const text = await file.text();
                const data = JSON.parse(text);

                if (!data.version) {
                    feedSystem('Invalid backup file format');
                    return;
                }

                await importAllData(data);

                // Reload Lab save states into local variable
                savedStates = getLabSaveStates();

                feedSystem(`Imported ${data.labSaveStates?.length || 0} save states + training data`);
            } catch (err) {
                feedSystem(`Import failed: ${err.message}`);
            }
        };
        input.click();
    }

    function handleHyperparamsApply(event) {
        const { learningRate, rolloutSize, gamma } = event.detail;
        updateRLConfig({ learningRate, rolloutSize, gamma });
    }

    // Format helpers
    function formatReward(r) {
        if (r > 0) return '+' + r.toFixed(3);
        if (r < 0) return r.toFixed(3);
        return '0.000';
    }

    function rewardClass(r) {
        if (r > 0) return 'positive';
        if (r < 0) return 'negative';
        return 'neutral';
    }
</script>

<svelte:window on:keydown={handleLabKeydown} />

<div class="lab-view">
    <!-- Header -->
    <header class="lab-header">
        <div class="header-left">
            <ModeToggle {mode} disabled={isRunning} on:change={handleModeChange} />

            {#if mode === 'train'}
                <!-- Algorithm Dropdown -->
                <div class="algorithm-dropdown">
                    <button
                        class="dropdown-trigger"
                        on:click={() => showAlgorithmDropdown = !showAlgorithmDropdown}
                        disabled={isRunning || !labInitialized}
                    >
                        <span>{algorithms.find(a => a.id === selectedAlgorithm)?.label}</span>
                        <ChevronDown size={14} />
                    </button>
                    {#if showAlgorithmDropdown}
                        <div class="dropdown-menu">
                            {#each algorithms as algo}
                                <button
                                    class="dropdown-item"
                                    class:active={selectedAlgorithm === algo.id}
                                    on:click={() => { selectedAlgorithm = algo.id; showAlgorithmDropdown = false; }}
                                >
                                    {algo.label}
                                </button>
                            {/each}
                        </div>
                    {/if}
                </div>

                <HyperparamsPopover
                    bind:open={hyperparamsOpen}
                    disabled={isRunning || !labInitialized}
                    on:apply={handleHyperparamsApply}
                />
                <button
                    class="header-btn teach-btn"
                    class:active={$labDemonstration.active}
                    on:click={toggleDemonstration}
                    disabled={isRunning || !labInitialized}
                    title={$labDemonstration.active ? 'Finish demonstration and consolidate learning' : 'Teach from a fresh ROM start'}
                >
                    {$labDemonstration.active ? 'Finish & Learn' : 'Teach AI'}
                </button>
            {/if}
        </div>

        <div class="header-right">
            <label class="header-btn autosave-toggle" class:disabled={!labInitialized} title="Auto-save every 30s while running">
                <input type="checkbox" bind:checked={autosaveEnabled} disabled={!labInitialized} />
                <span>Auto</span>
            </label>
            <button class="header-btn" on:click={saveState} disabled={!labInitialized} title="Save state">
                <Save size={16} />
            </button>
            <div class="save-states-container">
                <button
                    class="header-btn"
                    class:active={showSaveStates}
                    on:click={() => showSaveStates = !showSaveStates}
                    disabled={!labInitialized}
                    title="Load state"
                >
                    <FolderOpen size={16} />
                </button>
                {#if showSaveStates}
                    <div class="states-dropdown">
                        {#if savedStates.length > 0}
                            {#each savedStates as state}
                                <div class="state-item">
                                    <button class="state-load" on:click={() => loadState(state)}>
                                        <span class="state-name">{state.name}</span>
                                        <span class="state-location">{state.location}</span>
                                    </button>
                                    <button class="state-delete" on:click={() => deleteState(state)}>×</button>
                                </div>
                            {/each}
                        {:else}
                            <div class="states-empty">No saved states</div>
                        {/if}
                    </div>
                {/if}
            </div>

            <button class="header-btn" on:click={handleExport} title="Export all data">
                <Download size={16} />
            </button>
            <button class="header-btn" on:click={handleImportClick} title="Import data">
                <Upload size={16} />
            </button>

            <div class="header-divider"></div>

            <button class="header-btn speed" on:click={cycleSpeed} disabled={!labInitialized} title="Playback speed">
                <FastForward size={16} />
                <span>{playbackSpeed}x</span>
            </button>
            <button
                class="header-btn"
                on:click={stepOnce}
                disabled={isRunning || !labInitialized}
                title="Step once"
            >
                <SkipForward size={16} />
            </button>
            <button class="header-btn" on:click={handleReset} disabled={!labInitialized} title="Reset">
                <RotateCcw size={16} />
            </button>

            <button
                class="run-btn"
                class:running={isRunning}
                on:click={toggleRun}
                disabled={!isRunning && (!!runBlockReason || modelLoading)}
                title={isRunning ? 'Pause (Esc)' : runBlockReason || 'Run'}
            >
                {#if isRunning}
                    <Pause size={18} />
                    <span>Pause</span>
                {:else}
                    <Play size={18} />
                    <span>Run</span>
                {/if}
            </button>
        </div>
    </header>

    <div class="lab-status" class:blocked={!!runBlockReason && !isRunning} class:running={isRunning} role="status">
        {#if isRunning}
            {#if mode === 'play' && $labMetrics.phase === 'planning'}
                Asking {selectedProvider.name} for the next plan…
            {:else if mode === 'play' && $labMetrics.currentAction}
                Agent running · Action: {$labMetrics.currentAction} · Esc to pause
            {:else}
                Agent running · Press Esc to pause
            {/if}
        {:else if modelLoading}
            {modelLoadMessage || 'Loading model…'}
        {:else if runBlockReason}
            {runBlockReason}
        {:else}
            {mode === 'train' ? 'Ready to train · 4 environments share one policy (1 visible + 3 headless)' : 'Ready to run'}
        {/if}
    </div>

    <!-- Main Content -->
    <div class="main-content">
        <!-- Game Column (60%) -->
        <div class="game-area">
            <div class="game-container">
                <div class="container-label">Game View</div>
                <div class="canvas-wrapper">
                    <LabCanvas on:initialized={handleLabInitialized} />
                </div>
                {#if $labDemonstration.active}
                    <div class="teach-panel" aria-label="Human demonstration controls">
                        <div class="teach-copy">
                            <strong>TEACHING SHARED PPO</strong>
                            <span>
                                {$labDemonstration.samples} transitions ·
                                {$labDemonstration.trainSteps} BC updates ·
                                {($labDemonstration.accuracy * 100).toFixed(1)}% accuracy
                            </span>
                        </div>
                        <div class="teach-controls">
                            <div class="teach-dpad">
                                <button class="teach-key teach-up" on:click={() => demonstrate('up')}>↑</button>
                                <button class="teach-key" on:click={() => demonstrate('left')}>←</button>
                                <button class="teach-key" on:click={() => demonstrate('down')}>↓</button>
                                <button class="teach-key" on:click={() => demonstrate('right')}>→</button>
                            </div>
                            <button class="teach-key teach-menu" title="Advance animation without adding an expert label" on:click={() => advanceLabDemonstration()}>Wait</button>
                            <button class="teach-key teach-menu" on:click={() => demonstrate('start')}>Start</button>
                            <button class="teach-key teach-action teach-b" on:click={() => demonstrate('b')}>B</button>
                            <button class="teach-key teach-action teach-a" on:click={() => demonstrate('a')}>A</button>
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <!-- Metrics Panel (40%) -->
        <div class="metrics-panel">
            {#if mode === 'train'}
                <!-- Train Mode: How it Works (Collapsible) -->
                <button class="how-it-works-toggle" on:click={() => howItWorksExpanded = !howItWorksExpanded}>
                    <span class="section-header">PPO/GAE Training</span>
                    <ChevronDown size={14} class="toggle-icon {howItWorksExpanded ? 'expanded' : ''}" />
                </button>
                {#if howItWorksExpanded}
                    <p class="how-desc">
                        Four Red++ environments train one shared PPO/GAE actor-critic. One exploits the strongest RAM-verified checkpoint, two revisit autonomously discovered frontier cells, and one always rehearses from ROM start. No route or button is scripted.
                    </p>
                {/if}

                <div class="metrics-divider"></div>

                {#if $pureRLMetrics.autonomy}
                    <div class="autonomy-proof {$pureRLMetrics.autonomy.status}">
                        <div class="section-header">Autonomous outcome proof</div>
                        <p class="proof-contract">
                            E{$pureRLMetrics.autonomy.evaluationWorker + 1}: fresh ROM, no checkpoint restore,
                            no scripted buttons. A result is verified after
                            {$pureRLMetrics.autonomy.proofRunsRequired} separate start episodes.
                        </p>
                        <div class="metric-row">
                            <span class="metric-label">Best fresh start</span>
                            <span class="metric-value mono">{$pureRLMetrics.autonomy.freshBestMilestone}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Verified</span>
                            <span class="metric-value mono">{$pureRLMetrics.autonomy.verifiedMilestone}</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Badge 1 proof</span>
                            <span class="metric-value mono">
                                {$pureRLMetrics.autonomy.targetSuccesses}/{$pureRLMetrics.autonomy.attempts} starts
                                ({($pureRLMetrics.autonomy.targetSuccessRate * 100).toFixed(0)}%)
                            </span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Last fresh progress</span>
                            <span class="metric-value mono">
                                {$pureRLMetrics.autonomy.samplesSinceFreshProgress.toLocaleString()} samples ago
                            </span>
                        </div>
                        <div class="proof-progress" title="Verified milestone coverage toward Champion">
                            <div class="proof-progress-fill" style="width: {$pureRLMetrics.autonomy.progressPct}%"></div>
                        </div>
                        <div class="proof-verdict">
                            {#if $pureRLMetrics.autonomy.targetProven}
                                PROVEN: {$pureRLMetrics.autonomy.targetMilestone} reproduced autonomously
                            {:else if $pureRLMetrics.autonomy.status === 'stalled'}
                                STALLED: no RAM-confirmed fresh-start milestone
                            {:else}
                                UNPROVEN: training is running, outcome proof is still missing
                            {/if}
                        </div>
                    </div>

                    <div class="metrics-divider"></div>
                {/if}

                {#if $pureRLMetrics.learningAudit}
                    <div class="autonomy-proof {$pureRLMetrics.learningAudit.last?.verdict || 'collecting'}">
                        <div class="section-header">50k learning audit</div>
                        <p class="proof-contract">
                            Fixed sample boundaries. Only independent fresh-ROM outcomes count as learning;
                            rewards, returns and checkpoints are diagnostics.
                        </p>
                        {#if $pureRLMetrics.learningAudit.last}
                            <div class="metric-row">
                                <span class="metric-label">Audited boundary</span>
                                <span class="metric-value mono">
                                    {$pureRLMetrics.learningAudit.last.boundarySamples.toLocaleString()} samples
                                </span>
                            </div>
                            <div class="metric-row">
                                <span class="metric-label">Verdict</span>
                                <span class="metric-value mono">{$pureRLMetrics.learningAudit.last.verdict}</span>
                            </div>
                            <div class="metric-row">
                                <span class="metric-label">Fresh / verified Δ</span>
                                <span class="metric-value mono">
                                    {$pureRLMetrics.learningAudit.last.deltas.freshBestLevel}
                                    / {$pureRLMetrics.learningAudit.last.deltas.verifiedLevel}
                                </span>
                            </div>
                            <div class="proof-verdict">
                                {$pureRLMetrics.learningAudit.last.reason}
                            </div>
                        {:else}
                            <div class="proof-verdict">
                                NEXT AUDIT: {$pureRLMetrics.learningAudit.nextBoundary.toLocaleString()} samples
                            </div>
                        {/if}
                    </div>

                    <div class="metrics-divider"></div>
                {/if}

                <!-- Train Mode Metrics -->
                <div class="metrics-section">
                    <div class="metric-row">
                        <span class="metric-label">Step</span>
                        <span class="metric-value mono">{$pureRLMetrics.step.toLocaleString()}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Action</span>
                        <span class="metric-value action-badge">{$pureRLMetrics.action || '-'}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Updates</span>
                        <span class="metric-value mono">{$pureRLMetrics.trainSteps}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Human demos / BC</span>
                        <span class="metric-value mono">
                            {$pureRLMetrics.demonstration.samples} / {$pureRLMetrics.demonstration.trainSteps}
                        </span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Environments</span>
                        <span class="metric-value mono">{$pureRLMetrics.environmentCount}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Samples/s</span>
                        <span class="metric-value mono">{$pureRLMetrics.samplesPerSecond.toFixed(1)}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Episode</span>
                        <span class="metric-value mono">{$pureRLMetrics.episode} / {$pureRLMetrics.episodeSteps} steps</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Confirmed wins</span>
                        <span class="metric-value mono">{$pureRLMetrics.confirmedWins}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Checkpoints</span>
                        <span class="metric-value mono">{$pureRLMetrics.checkpointCount}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Exploration archive</span>
                        <span class="metric-value mono">{$pureRLMetrics.archiveSize} cells / {$pureRLMetrics.archiveSelections} restores</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Value loss / PPO clip</span>
                        <span class="metric-value mono">
                            {$pureRLMetrics.valueLoss.toFixed(4)} / {($pureRLMetrics.clipFraction * 100).toFixed(1)}%
                        </span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Best environment</span>
                        <span class="metric-value mono">
                            {$pureRLMetrics.checkpointWorker === null ? '-' : $pureRLMetrics.checkpointWorker + 1}
                        </span>
                    </div>
                    {#if $pureRLMetrics.memoryDiagnostics}
                        <div class="metric-row" title="Direct bank-1 wCurMap, wXCoord and wYCoord bytes">
                            <span class="metric-label">WRAM map / x / y</span>
                            <span class="metric-value mono">
                                {$pureRLMetrics.memoryDiagnostics.directMapXY.join(' / ')}
                            </span>
                        </div>
                        <div class="metric-row" title="Direct bank-1 map height, width and data-pointer bytes">
                            <span class="metric-label">WRAM h / w / ptr</span>
                            <span class="metric-value mono">
                                {$pureRLMetrics.memoryDiagnostics.directMapMeta.join(' / ')}
                            </span>
                        </div>
                        <div class="metric-row" title="Currently mapped wCurMap, wXCoord and wYCoord bytes">
                            <span class="metric-label">Mapped map / x / y</span>
                            <span class="metric-value mono">
                                {$pureRLMetrics.memoryDiagnostics.mappedMapXY.join(' / ')}
                            </span>
                        </div>
                        <div class="metric-row" title="Currently mapped map height, width and data-pointer bytes">
                            <span class="metric-label">Mapped h / w / ptr</span>
                            <span class="metric-value mono">
                                {$pureRLMetrics.memoryDiagnostics.mappedMapMeta.join(' / ')}
                            </span>
                        </div>
                        <div class="metric-row" title="wFontLoaded / hWY shadow / rWY LCD register / wTextBoxID / hSpriteIndexOrTextID / WRAM border / rendered VRAM border">
                            <span class="metric-label">Text / hWY / rWY / box / ID / WRAM / VRAM</span>
                            <span class="metric-value mono">
                                {$pureRLMetrics.memoryDiagnostics.textState?.join(' / ') || '-'}
                            </span>
                        </div>
                    {/if}
                    {#if $pureRLMetrics.teamQuality}
                        <div class="metric-row" title="Bounded Red++ roster, stats, balance, typing and move-coverage score">
                            <span class="metric-label">Team quality</span>
                            <span class="metric-value mono">{($pureRLMetrics.teamQuality.score * 100).toFixed(1)}%</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Roster / Avg BST</span>
                            <span class="metric-value mono">
                                {$pureRLMetrics.teamQuality.size}/6 · {$pureRLMetrics.teamQuality.meanBaseStatTotal.toFixed(0)}
                            </span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Level balance</span>
                            <span class="metric-value mono">{($pureRLMetrics.teamQuality.levelBalance * 100).toFixed(0)}%</span>
                        </div>
                        <div class="metric-row">
                            <span class="metric-label">Type / move coverage</span>
                            <span class="metric-value mono">
                                {($pureRLMetrics.teamQuality.typeDiversity * 100).toFixed(0)}% /
                                {($pureRLMetrics.teamQuality.offensiveCoverage * 100).toFixed(0)}%
                            </span>
                        </div>
                    {/if}
                </div>

                <div class="metrics-divider"></div>

                <div class="metrics-section">
                    <div class="metric-row">
                        <span class="metric-label">Buffer</span>
                        <span class="metric-value mono">{$pureRLMetrics.bufferFill}/{$pureRLMetrics.bufferSize}</span>
                    </div>
                    <div class="buffer-bar">
                        <div
                            class="buffer-fill"
                            style="width: {($pureRLMetrics.bufferFill / $pureRLMetrics.bufferSize) * 100}%"
                        ></div>
                    </div>
                </div>

                <div class="metrics-divider"></div>

                <div class="metrics-section">
                    <div class="metric-row">
                        <span class="metric-label">Avg Return</span>
                        <span class="metric-value mono {rewardClass($pureRLMetrics.avgRawReturn)}">
                            {formatReward($pureRLMetrics.avgRawReturn)}
                        </span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Entropy</span>
                        <span class="metric-value mono">{$pureRLMetrics.policyEntropy.toFixed(3)}</span>
                    </div>
                </div>

                <div class="metrics-divider"></div>

                <!-- Chart -->
                <div class="chart-section">
                    <MetricsChart history={$pureRLMetrics.history} />
                </div>

                <div class="metrics-divider"></div>

                <!-- Reward Breakdown -->
                <div class="reward-section">
                    <div class="section-header">Reward Breakdown</div>
                    <RewardBar breakdown={$pureRLMetrics.breakdown} />
                </div>

                <div class="metrics-divider"></div>

                <!-- Tests Panel -->
                <TestsPanel
                    currentLocation={$pureRLMetrics.currentLocation}
                    bundleInfo={$pureRLMetrics.bundleInfo}
                    firedTests={$pureRLMetrics.firedTests || []}
                    totalRewards={$pureRLMetrics.totalRewards || { tier1: 0, tier2: 0, tier3: 0, penalties: 0, total: 0 }}
                    completedObjectives={$pureRLMetrics.completedObjectives || []}
                    context={$pureRLMetrics.context}
                    matrixVersion={$pureRLMetrics.matrixVersion}
                />

            {:else}
                <!-- Play Mode: How it Works (Collapsible) -->
                <button class="how-it-works-toggle" on:click={() => howItWorksExpanded = !howItWorksExpanded}>
                    <span class="section-header">LLM-Guided Agent</span>
                    <ChevronDown size={14} class="toggle-icon {howItWorksExpanded ? 'expanded' : ''}" />
                </button>
                {#if howItWorksExpanded}
                    <p class="how-desc">
                        The configured LLM reads the game state (location, party, items) and strategy guide context to generate action plans. The agent executes these plans while tracking progress toward walkthrough objectives.
                    </p>
                {/if}

                <div class="metrics-divider"></div>

                <!-- Play Mode: Model Configuration -->
                <div class="metrics-section model-config">
                    {#if $llmState.provider === 'browser'}
                        <div class="section-header">Browser Model</div>
                        <div class="model-select-row">
                            <select
                                value={selectedModel}
                                on:change={handleModelChange}
                                disabled={modelLoading || isRunning}
                            >
                                {#each browserModels as model}
                                    <option value={model.id}>{model.name} ({model.size})</option>
                                {/each}
                            </select>
                            {#if isModelReady}
                                <span class="model-status ready"><Check size={14} /> Ready</span>
                            {:else if modelLoading}
                                <span class="model-status loading"><Loader size={14} class="spin" /> {Math.round(modelLoadProgress * 100)}%</span>
                            {:else}
                                <button class="load-btn" on:click={loadBrowserModel} disabled={isRunning}>
                                    <Download size={14} />
                                    <span>Load</span>
                                </button>
                            {/if}
                        </div>
                        {#if modelLoading}
                            <div class="model-progress">
                                <div class="model-progress-fill" style="width: {modelLoadProgress * 100}%"></div>
                            </div>
                            <div class="model-progress-text">{modelLoadMessage}</div>
                        {/if}
                    {:else}
                        <div class="section-header">{selectedProvider.name}</div>
                        <div class="model-select-row">
                            <span>{selectedApiModel || 'Configure a model in the header'}</span>
                            {#if selectedApiModel}
                                <span class="model-status ready"><Check size={14} /> Configured</span>
                            {/if}
                        </div>
                    {/if}
                </div>

                <div class="metrics-divider"></div>

                <!-- Play Mode Metrics -->
                <div class="metrics-section">
                    <div class="metric-row">
                        <span class="metric-label">Steps</span>
                        <span class="metric-value mono">{$labMetrics.totalSteps.toLocaleString()}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">LLM Calls</span>
                        <span class="metric-value mono">{$labMetrics.llmCalls}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Objectives</span>
                        <span class="metric-value mono">{$labMetrics.objectivesCompleted}/{$graphStats.objectives}</span>
                    </div>
                    <div class="metric-row">
                        <span class="metric-label">Action</span>
                        <span class="metric-value action-badge">{$labMetrics.currentAction || '-'}</span>
                    </div>
                    {#if $labMetrics.currentPlan}
                        <div class="current-plan" title={$labMetrics.currentPlan}>
                            <span>Plan</span>
                            <p>{$labMetrics.currentPlan}</p>
                        </div>
                    {/if}
                </div>

                <div class="metrics-divider"></div>

                <!-- Guide Context -->
                <div class="guide-section">
                    <div class="guide-header">Current Guide Context</div>
                    {#if guideContext}
                        <div class="guide-location">{guideContext.location}</div>
                        {#if guideContext.description}
                            <p class="guide-desc">{guideContext.description}</p>
                        {/if}
                        {#if guideContext.objectives.length > 0}
                            <ul class="guide-objectives">
                                {#each guideContext.objectives as obj}
                                    <li>{obj.name}</li>
                                {/each}
                            </ul>
                        {/if}
                    {:else}
                        <p class="guide-empty">No context for current location</p>
                    {/if}
                </div>
            {/if}
        </div>
    </div>

    <!-- Map Row -->
    <div class="map-row">
        <div class="map-container">
            <div class="container-label">
                Kanto Map{mode === 'train' ? ` · visible E${$pureRLMetrics.visibleWorker + 1}` : ''}
            </div>
            {#if mode === 'train'}
                <div class="map-scope-note">
                    RAM map and objectives for the visible worker only; fresh-ROM proof is measured separately above.
                </div>
            {/if}
            <div class="map-wrapper">
                <WalkthroughGraph
                    graphData={$walkthroughGraph}
                    currentLocation={$currentGraphLocation}
                    completedObjectives={mapCompletedObjectives}
                />
            </div>
        </div>
    </div>

    <!-- Bottom Bar (Play mode only) -->
    {#if mode === 'play'}
        <div class="bottom-bar">
            <div class="progress-bar-container">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: {$completionPercentage}%"></div>
                </div>
                <span class="progress-label">{$completionPercentage}% complete</span>
            </div>
        </div>
    {/if}
</div>

<style>
    .lab-view {
        display: flex;
        flex-direction: column;
        height: 100%;
        gap: 8px;
        padding: 8px;
        background: var(--bg-main);
    }

    /* Header */
    .lab-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: var(--bg-panel);
        border-radius: 8px;
        gap: 8px;
        flex-wrap: wrap;
        position: relative;
        z-index: 10;
    }

    .header-left, .header-right {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
    }

    .header-left {
        flex-wrap: wrap;
    }

    .header-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        padding: 8px;
        border: none;
        border-radius: 6px;
        background: var(--bg-input);
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.15s;
    }

    .header-btn:hover:not(:disabled) {
        background: var(--bg-panel);
        color: var(--text-primary);
    }

    .header-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .autosave-toggle.disabled {
        opacity: 0.4;
        cursor: not-allowed;
    }

    .header-btn.active {
        background: var(--accent-primary);
        color: white;
    }

    .header-btn.speed {
        padding: 6px 10px;
        font-size: 11px;
        font-weight: 600;
    }

    .autosave-toggle {
        cursor: pointer;
        padding: 6px 10px;
        gap: 6px;
    }

    .autosave-toggle input[type="checkbox"] {
        appearance: none;
        width: 14px;
        height: 14px;
        border: 1.5px solid var(--border-color);
        border-radius: 3px;
        background: var(--bg-input);
        cursor: pointer;
        transition: all 0.15s;
        margin: 0;
    }

    .autosave-toggle input[type="checkbox"]:checked {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
    }

    .autosave-toggle input[type="checkbox"]:checked::after {
        content: '✓';
        display: block;
        color: white;
        font-size: 10px;
        line-height: 11px;
        text-align: center;
    }

    .autosave-toggle span {
        font-size: 11px;
        font-weight: 500;
    }

    .autosave-toggle:hover input[type="checkbox"] {
        border-color: var(--text-muted);
    }

    /* Responsive header */
    @media (max-width: 800px) {
        .lab-header {
            padding: 6px 8px;
        }

        .header-left, .header-right {
            gap: 4px;
        }

        .header-btn {
            padding: 6px;
        }

        .run-btn {
            padding: 6px 10px;
        }

        .run-btn span {
            display: none;
        }

        .header-divider {
            display: none;
        }
    }

    .header-divider {
        width: 1px;
        height: 24px;
        background: var(--border-color);
    }

    .run-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        background: var(--accent-primary);
        color: white;
        flex-shrink: 0;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
    }

    .run-btn:hover {
        filter: brightness(1.1);
    }

    .run-btn:disabled {
        opacity: 0.45;
        cursor: not-allowed;
        filter: none;
    }

    .run-btn.running {
        background: #e17055;
    }

    .lab-status {
        padding: 6px 12px;
        border: 1px solid rgba(74, 222, 128, 0.2);
        border-radius: 6px;
        background: rgba(74, 222, 128, 0.06);
        color: var(--text-secondary);
        font-size: 12px;
    }

    .lab-status.blocked {
        border-color: rgba(250, 176, 5, 0.25);
        background: rgba(250, 176, 5, 0.08);
    }

    .lab-status.running {
        border-color: rgba(116, 185, 255, 0.3);
        background: rgba(116, 185, 255, 0.08);
    }

    /* Algorithm Dropdown */
    .algorithm-dropdown {
        position: relative;
    }

    .dropdown-trigger {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 12px;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background: var(--bg-input);
        color: var(--text-primary);
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
    }

    .dropdown-trigger:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .dropdown-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 120px;
        background: var(--bg-panel);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        z-index: 100;
        overflow: hidden;
    }

    .dropdown-item {
        display: block;
        width: 100%;
        padding: 8px 12px;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        font-size: 12px;
        text-align: left;
        cursor: pointer;
    }

    .dropdown-item:hover {
        background: var(--bg-input);
        color: var(--text-primary);
    }

    .dropdown-item.active {
        background: var(--accent-primary);
        color: white;
    }

    /* Save States */
    .save-states-container {
        position: relative;
    }

    .states-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        width: 180px;
        max-height: 200px;
        overflow-y: auto;
        background: var(--bg-panel);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        z-index: 100;
    }

    .state-item {
        display: flex;
        align-items: center;
        border-bottom: 1px solid var(--border-color);
    }

    .state-item:last-child {
        border-bottom: none;
    }

    .state-load {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 8px 10px;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-primary);
    }

    .state-load:hover {
        background: var(--bg-input);
    }

    .state-name {
        font-size: 12px;
        font-weight: 500;
    }

    .state-location {
        font-size: 10px;
        color: var(--text-muted);
    }

    .state-delete {
        padding: 8px;
        background: none;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        font-size: 16px;
    }

    .state-delete:hover {
        color: #d63031;
    }

    .states-empty {
        padding: 12px;
        text-align: center;
        color: var(--text-muted);
        font-size: 12px;
    }

    /* Main Content */
    .main-content {
        flex: 1;
        display: flex;
        gap: 8px;
        min-height: 0;
    }

    .game-area {
        flex: 6;
        display: flex;
        flex-direction: column;
        min-height: 0;
    }

    .game-container {
        flex: 1;
        display: flex;
        flex-direction: column;
        background: var(--bg-panel);
        border-radius: 8px;
        overflow: hidden;
        min-height: 0;
    }

    /* Map Row */
    .map-row {
        flex-shrink: 0;
        height: 280px;
    }

    .map-container {
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--bg-panel);
        border-radius: 8px;
        overflow: hidden;
    }

    .container-label {
        flex-shrink: 0;
        padding: 8px 12px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        background: var(--bg-input);
        border-bottom: 1px solid var(--border-color);
    }

    .map-scope-note {
        flex-shrink: 0;
        padding: 5px 12px;
        color: var(--text-muted);
        background: var(--bg-panel);
        border-bottom: 1px solid var(--border-color);
        font-size: 10px;
        line-height: 1.35;
    }

    .canvas-wrapper {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 0;
        overflow: hidden;
        padding: 0;
    }

    .canvas-wrapper :global(.lab-canvas-container) {
        width: auto;
        height: 100%;
        max-width: 100%;
    }

    .map-wrapper {
        flex: 1;
        min-height: 0;
        height: 100%;
    }

    /* Metrics Panel */
    .metrics-panel {
        flex: 2.5;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--bg-panel);
        border-radius: 8px;
        overflow-y: auto;
        min-width: 200px;
    }

    .metrics-section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .autonomy-proof {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border: 1px solid rgba(250, 176, 5, 0.3);
        border-radius: 7px;
        background: rgba(250, 176, 5, 0.06);
    }

    .autonomy-proof.proven {
        border-color: rgba(0, 184, 148, 0.45);
        background: rgba(0, 184, 148, 0.08);
    }

    .autonomy-proof.stalled {
        border-color: rgba(214, 48, 49, 0.45);
        background: rgba(214, 48, 49, 0.07);
    }

    .proof-contract {
        margin: 0;
        color: var(--text-muted);
        font-size: 10px;
        line-height: 1.4;
    }

    .proof-progress {
        height: 6px;
        overflow: hidden;
        border-radius: 3px;
        background: var(--bg-input);
    }

    .proof-progress-fill {
        height: 100%;
        border-radius: 3px;
        background: var(--accent-primary);
        transition: width 0.2s ease-out;
    }

    .proof-verdict {
        color: var(--text-secondary);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.03em;
    }

    .metrics-divider {
        height: 1px;
        background: var(--border-color);
        margin: 4px 0;
    }

    .metric-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .metric-label {
        font-size: 12px;
        color: var(--text-muted);
    }

    .metric-value {
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
    }

    .metric-value.mono {
        font-family: 'Monaco', 'Menlo', monospace;
    }

    .metric-value.positive {
        color: #00b894;
    }

    .metric-value.negative {
        color: #d63031;
    }

    .current-plan {
        padding: 8px 10px;
        border-radius: 6px;
        background: var(--bg-tertiary);
    }

    .current-plan span {
        color: var(--text-muted);
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .current-plan p {
        margin: 3px 0 0;
        color: var(--text-primary);
        font-size: 12px;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .action-badge {
        display: inline-block;
        padding: 2px 8px;
        background: var(--accent-primary);
        color: white;
        border-radius: 4px;
        font-size: 11px;
        text-transform: uppercase;
    }

    .buffer-bar {
        width: 100%;
        height: 6px;
        background: var(--bg-input);
        border-radius: 3px;
        overflow: hidden;
    }

    .buffer-fill {
        height: 100%;
        background: var(--accent-primary);
        border-radius: 3px;
        transition: width 0.15s ease-out;
    }

    .chart-section {
        flex: 1;
        min-height: 180px;
    }

    /* Guide Section (Play mode) */
    .guide-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .guide-header {
        font-size: 11px;
        font-weight: 600;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .guide-location {
        font-size: 14px;
        font-weight: 600;
        color: var(--accent-primary);
    }

    .guide-desc {
        font-size: 12px;
        color: var(--text-secondary);
        margin: 0;
        line-height: 1.5;
    }

    .guide-objectives {
        margin: 0;
        padding-left: 16px;
        font-size: 12px;
        color: var(--text-secondary);
    }

    .guide-objectives li {
        margin: 4px 0;
    }

    .guide-empty {
        font-size: 12px;
        color: var(--text-muted);
        font-style: italic;
        margin: 0;
    }

    /* How It Works (Collapsible) */
    .how-it-works-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        width: 100%;
        padding: 0;
        background: none;
        border: none;
        cursor: pointer;
        color: var(--text-secondary);
    }

    .how-it-works-toggle:hover {
        color: var(--text-primary);
    }

    .how-it-works-toggle :global(.toggle-icon) {
        transition: transform 0.2s;
    }

    .how-it-works-toggle :global(.toggle-icon.expanded) {
        transform: rotate(180deg);
    }

    .how-desc {
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.5;
        margin: 4px 0 0 0;
    }

    /* Model Configuration */
    .model-config {
        gap: 10px;
    }

    .section-header {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
    }

    .model-select-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .model-select-row select {
        flex: 1;
        padding: 8px 10px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 12px;
        cursor: pointer;
    }

    .model-select-row select:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .model-select-row select:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .model-status {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 500;
        padding: 4px 8px;
        border-radius: 4px;
        white-space: nowrap;
    }

    .model-status.ready {
        color: #00b894;
        background: rgba(0, 184, 148, 0.1);
    }

    .model-status.loading {
        color: var(--accent-primary);
        background: rgba(116, 185, 255, 0.1);
    }

    .model-status.loading :global(svg) {
        animation: spin 1s linear infinite;
    }

    @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
    }

    .load-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        background: var(--accent-primary);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: filter 0.15s;
        white-space: nowrap;
    }

    .load-btn:hover:not(:disabled) {
        filter: brightness(1.1);
    }

    .load-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .model-progress {
        width: 100%;
        height: 4px;
        background: var(--bg-input);
        border-radius: 2px;
        overflow: hidden;
    }

    .model-progress-fill {
        height: 100%;
        background: var(--accent-primary);
        border-radius: 2px;
        transition: width 0.2s ease-out;
    }

    .model-progress-text {
        font-size: 10px;
        color: var(--text-muted);
        text-overflow: ellipsis;
        overflow: hidden;
        white-space: nowrap;
    }

    .teach-btn.active {
        color: #07140e;
        background: #55efc4;
        border-color: #55efc4;
        font-weight: 700;
    }

    .teach-panel {
        margin-top: 10px;
        padding: 10px 12px;
        border: 1px solid rgba(85, 239, 196, 0.55);
        border-radius: 8px;
        background: rgba(85, 239, 196, 0.08);
    }

    .teach-copy {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        color: #55efc4;
        font-size: 11px;
    }

    .teach-controls {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-top: 10px;
    }

    .teach-dpad {
        display: grid;
        grid-template-columns: repeat(3, 34px);
        grid-template-rows: repeat(2, 34px);
        gap: 3px;
    }

    .teach-up { grid-column: 2; }
    .teach-dpad .teach-key:nth-child(2) { grid-column: 1; }

    .teach-key {
        min-width: 34px;
        height: 34px;
        padding: 0 9px;
        border: 1px solid var(--border-color);
        border-radius: 7px;
        background: var(--bg-input);
        color: var(--text-primary);
        font-weight: 700;
    }

    .teach-key:active { transform: scale(0.94); }
    .teach-action { width: 38px; border-radius: 50%; }
    .teach-a { background: var(--accent-secondary); }
    .teach-b { background: var(--accent-primary); }
    .teach-menu { font-size: 10px; border-radius: 14px; }

    /* Bottom Bar */
    .bottom-bar {
        flex-shrink: 0;
    }

    .progress-bar-container {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        background: var(--bg-panel);
        border-radius: 8px;
    }

    .progress-bar {
        flex: 1;
        height: 8px;
        background: var(--bg-input);
        border-radius: 4px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: var(--accent-primary);
        border-radius: 4px;
        transition: width 0.3s ease-out;
    }

    .progress-label {
        font-size: 12px;
        font-weight: 600;
        color: var(--text-secondary);
        white-space: nowrap;
    }
</style>
