// game-init.js - Initializes all game systems when ROM is loaded
import { get } from 'svelte/store';
import { Emulator } from './emulator.js';
import { MemoryReader } from './memory-reader.js';
import { GameAgent } from './agent.js';
import { RLAgent } from './rl-agent.js';
import { DataCollector } from './data-collector.js';
import { CombinedRewardSystem } from './adaptive-rewards.js';
import { TrainedPolicy, AutoTrainingManager } from './trained-policy.js';
import * as persistence from './persistence.js';
import { initBrowserLLM, isBrowserLLMReady, isReady as isLLMReady } from './llm.js';
import { getConfig, PROVIDERS } from '$lib/stores/llm';

// Store references
import {
    emulator as emulatorStore,
    memoryReader as memoryReaderStore,
    romLoaded,
    gameState,
    updateGameState
} from '$lib/stores/game';

import {
    gameAgent,
    rlAgent,
    dataCollector,
    activeMode,
    aiState,
    stats,
    updateAIState,
    updateStats
} from '$lib/stores/agent';

import {
    trainedPolicy as trainedPolicyStore,
    autoTrainer as autoTrainerStore,
    modelState,
    trainingProgress,
    autoTrainEnabled,
    updateModelState,
    updateTrainingProgress
} from '$lib/stores/training';

import {
    feedSystem,
    feedDiscovery,
    feedTraining,
    trackDiscovery,
    discoveries
} from '$lib/stores/feed';

import {
    llmState,
    setLLMProgress,
    setLLMReady,
    setLLMError
} from '$lib/stores/llm';

// Global instances (not in stores, just held here)
let emu = null;
let reader = null;
let agent = null;
let rlAgentInstance = null;
let collector = null;
let rewardSystem = null;
let policy = null;
let autoTrainerInstance = null;
let canvas = null;

// Persistence tracking
let unsavedExperiences = [];
let saveInterval = null;
const SAVE_INTERVAL_MS = 30000; // Save every 30 seconds
const SAVE_BATCH_SIZE = 50; // Or when we have 50+ unsaved experiences

/**
 * Queue an experience for persistence
 */
function queueExperienceForSave(experience) {
    unsavedExperiences.push(experience);

    // Save immediately if we have enough
    if (unsavedExperiences.length >= SAVE_BATCH_SIZE) {
        flushExperiences();
    }
}

/**
 * Flush unsaved experiences to IndexedDB
 */
async function flushExperiences() {
    if (unsavedExperiences.length === 0) return;

    const toSave = [...unsavedExperiences];
    unsavedExperiences = [];

    try {
        await persistence.saveExperiences(toSave);
        console.log(`[Persistence] Saved ${toSave.length} experiences`);
    } catch (e) {
        console.error('[Persistence] Failed to save experiences:', e);
        // Put them back for retry
        unsavedExperiences = [...toSave, ...unsavedExperiences];
    }
}

/**
 * Save discovery to persistence
 */
async function persistDiscovery(discovery) {
    try {
        await persistence.saveDiscovery(discovery);
    } catch (e) {
        console.error('[Persistence] Failed to save discovery:', e);
    }
}

/**
 * Setup auto-save interval and beforeunload handler
 */
function setupPersistence() {
    // Periodic save
    if (saveInterval) clearInterval(saveInterval);
    saveInterval = setInterval(flushExperiences, SAVE_INTERVAL_MS);

    // Save on page unload
    window.addEventListener('beforeunload', () => {
        flushExperiences();
    });
}

/**
 * Restore persisted data on load
 */
async function restorePersistedData() {
    try {
        const stats = await persistence.getStorageStats();
        console.log('[Persistence] Storage stats:', stats);

        // Restore experiences to collector buffer if available
        if (stats.experiences > 0 && collector) {
            const experiences = await persistence.loadExperiences();
            collector.explorationBuffer.buffer = experiences;
            collector.explorationBuffer.totalExperiences = experiences.length;
            console.log(`[Persistence] Restored ${experiences.length} experiences`);

            // Update UI stats
            updateStats({
                experiences: experiences.length,
            });
        }

        // Restore discoveries
        if (stats.discoveries > 0) {
            const discoveries = await persistence.loadDiscoveries();
            console.log(`[Persistence] Restored ${discoveries.length} discoveries`);
            // Could update the feed store here if needed
        }

        return stats;
    } catch (e) {
        console.error('[Persistence] Failed to restore data:', e);
        return null;
    }
}

/**
 * Initialize all game systems
 * @param {ArrayBuffer} romBuffer - ROM file data
 * @param {HTMLCanvasElement} gameCanvas - Canvas element for rendering
 */
export async function initializeGame(romBuffer, gameCanvas) {
    canvas = gameCanvas;

    feedSystem('Initializing emulator...');

    try {
        // 1. Create emulator
        emu = new Emulator(canvas);
        await emu.loadROM(romBuffer);
        emulatorStore.set(emu);

        // 2. Create memory reader
        reader = new MemoryReader(emu);
        memoryReaderStore.set(reader);

        // 3. Create agents
        agent = new GameAgent(emu, reader, handleAgentUpdate);
        rlAgentInstance = new RLAgent(emu, reader, handleAgentUpdate);
        gameAgent.set(agent);
        rlAgent.set(rlAgentInstance);

        // 4. Create data collector
        collector = new DataCollector(emu, reader, handleCollectorUpdate);
        dataCollector.set(collector);

        // Wire up experience persistence
        collector.explorationBuffer.setOnAdd(queueExperienceForSave);

        // 5. Create reward system
        rewardSystem = new CombinedRewardSystem(canvas, reader);
        rlAgentInstance.setExternalRewardSource(rewardSystem);

        // 6. Initialize trained policy
        policy = new TrainedPolicy(handlePolicyUpdate);
        await policy.initialize();
        trainedPolicyStore.set(policy);
        rlAgentInstance.setTrainedPolicy(policy);

        // 7. Set up auto-training
        autoTrainerInstance = new AutoTrainingManager(
            collector.explorationBuffer,
            policy,
            handleAutoTrainEvent
        );
        autoTrainerStore.set(autoTrainerInstance);

        // Subscribe to auto-train toggle
        autoTrainEnabled.subscribe(enabled => {
            if (autoTrainerInstance) {
                autoTrainerInstance.setEnabled(enabled);
            }
        });

        // 8. Initialize persistence and restore data
        await persistence.initDB();
        setupPersistence();
        const restoredStats = await restorePersistedData();
        if (restoredStats?.experiences > 0) {
            feedSystem(`Restored ${restoredStats.experiences} experiences from previous session.`);
        }

        // 9. Start emulator
        emu.frameCallback = updateGameStateFromMemory;
        emu.start();

        // 10. Mark as loaded
        romLoaded.set(true);

        feedSystem('Game loaded! Select a mode to begin.');

        return true;
    } catch (err) {
        console.error('Initialization failed:', err);
        feedSystem(`Error: ${err.message}`);
        return false;
    }
}

/**
 * Update game state from memory reader
 */
function updateGameStateFromMemory() {
    if (!reader) return;

    try {
        const state = reader.getGameState();
        updateGameState(state);

        // Check for discoveries
        if (rewardSystem) {
            const result = rewardSystem.autoDiscovery.checkForDiscovery(state);
            if (result) {
                for (const discovery of result) {
                    feedDiscovery(discovery.name, discovery.reward, discovery.significance);
                    trackDiscovery(discovery.type, discovery.name);
                }
            }
        }
    } catch (e) {
        // Ignore read errors during startup
    }
}

/**
 * Handle agent updates
 */
function handleAgentUpdate(update) {
    // Get progress info from RL agent's reward calculator
    let progressInfo = null;
    if (rlAgentInstance?.rewardCalc) {
        const stats = rlAgentInstance.rewardCalc.getStats();
        progressInfo = stats.progress;
    }

    updateAIState({
        objective: update.objective || '',
        objectiveHint: update.objectiveHint || '',
        objectiveOverrideActive: update.objectiveOverrideActive || false,
        reasoning: update.reasoning || '',
        actions: update.action || [],
        planSource: update.selected || 'llm',
        gameState: update.gameState || null,
        progress: progressInfo
    });

    if (update.state) {
        updateGameState(update.state);
    }

    if (update.rlStats) {
        updateStats({
            totalReward: update.rlStats.reward?.totalReward || 0,
            // Note: experiences is updated by handleCollectorUpdate only (authoritative source)
            mapsVisited: update.rlStats.reward?.visitedMaps || 0,
        });
    }
}

/**
 * Handle data collector updates
 */
function handleCollectorUpdate(update) {
    if (update.stats) {
        updateStats({
            explorationSteps: update.stats.explorationSteps || 0,
            humanDemos: update.stats.humanDemos || 0,
            totalReward: update.stats.totalReward || 0,
            experiences: update.stats.explorationBufferSize || 0,
        });
    }

    if (update.state) {
        updateGameState(update.state);
    }
}

/**
 * Handle policy/training updates
 */
function handlePolicyUpdate(status) {
    console.log('Policy update:', {
        hasModel: status.hasModel,
        trainingSessions: status.trainingSessions,
        nextAutoTrain: status.nextAutoTrain,
        stage: status.trainingProgress?.stage
    });

    updateModelState({
        hasModel: status.hasModel || false,
        isTraining: status.isTraining || false,
        sessions: status.trainingSessions || 0,
        policyUsage: parseFloat(status.predictionRate) || 0,
        nextAutoTrain: status.nextAutoTrain || 3000,
    });

    if (status.trainingProgress) {
        const p = status.trainingProgress;
        updateTrainingProgress({
            active: p.stage === 'training' || p.stage === 'preparing',
            stage: p.stage,
            message: p.message,
            epoch: p.epoch || 0,
            totalEpochs: p.totalEpochs || 0,
            loss: p.loss,
            accuracy: p.accuracy,
        });

        if (p.stage === 'complete') {
            feedTraining(`Training complete! Accuracy: ${(p.accuracy * 100).toFixed(1)}%`, 'success');
        }
    }
}

/**
 * Handle auto-training events
 * Only show completion messages to avoid spamming the feed
 */
function handleAutoTrainEvent(event) {
    if (event.type === 'training-complete') {
        feedTraining('Neural network trained! Model improved.', 'success');
    }
    // Note: 'training-starting' events are intentionally not shown
    // to avoid cluttering the activity feed
}

// ============ MODE CONTROL ============

/**
 * Start Watch AI mode
 */
export async function startWatchMode() {
    if (!rlAgentInstance) return;

    const config = getConfig();
    const provider = PROVIDERS[config.provider];

    if (config.isBrowser) {
        // Using browser WebLLM - initialize if not ready
        if (!isBrowserLLMReady()) {
            feedSystem('Loading browser AI model... First time may take a minute.');
            llmState.update(s => ({ ...s, status: 'loading', progress: 0, message: 'Initializing...' }));

            try {
                await initBrowserLLM(config.model, (progress) => {
                    setLLMProgress(progress);
                    if (progress.progress < 1) {
                        const pct = Math.round(progress.progress * 100);
                        feedSystem(`Downloading AI model: ${pct}%`);
                    }
                });
                setLLMReady();
                feedSystem('AI model loaded! Starting...');
            } catch (err) {
                console.error('LLM initialization failed:', err);
                setLLMError(err);
                feedSystem('AI model failed to load. Running in exploration mode.');
            }
        }
    } else {
        // Using API provider - validate config
        if (!config.model) {
            feedSystem('Error: No model selected. Please configure LLM settings.');
            setLLMError(new Error('No model configured'));
            return;
        }
        if (!config.endpoint) {
            feedSystem('Error: No endpoint configured. Please configure LLM settings.');
            setLLMError(new Error('No endpoint configured'));
            return;
        }
        if (provider?.needsKey && !config.apiKey) {
            feedSystem(`Error: ${provider.name} requires an API key.`);
            setLLMError(new Error('API key required'));
            return;
        }
        setLLMReady();
        feedSystem(`Using ${provider?.name || 'API'}: ${config.model}`);
    }

    // Start RL agent (uses LLM for planning)
    rlAgentInstance.run();

    // Also start data collector to ensure experiences are collected
    // even if LLM is slow or not yet loaded
    if (collector) {
        collector.startExploration(0);
    }

    autoTrainerInstance?.startMonitoring(15000);
    feedSystem('AI is now playing...');
}

/**
 * Start Training mode (random exploration)
 */
export function startTrainMode() {
    if (!collector) return;
    collector.startExploration(0);
    autoTrainerInstance?.startMonitoring(10000);
    feedSystem('Training mode: collecting experiences...');
}

/**
 * Stop all agents
 */
export function stopAll() {
    agent?.stop();
    rlAgentInstance?.stop();
    collector?.stop();
    autoTrainerInstance?.stopMonitoring();
    feedSystem('Stopped');
}

// ============ INTRO SKIP ============

let introSkipRunning = false;
let introSkipInterval = null;

/**
 * Auto-play through the intro (name entry, etc.)
 * Runs until player has a party (indicating starter received)
 * or until cancelled
 */
export function startIntroSkip() {
    if (!emu || introSkipRunning) return;

    introSkipRunning = true;
    let stepCount = 0;

    feedSystem('Auto-playing through intro...');

    // Button sequence timing
    const pressInterval = 150; // ms between presses

    introSkipInterval = setInterval(() => {
        if (!introSkipRunning || !emu) {
            stopIntroSkip();
            return;
        }

        stepCount++;

        // Check if we have a Pokemon (intro complete)
        try {
            const state = reader?.getGameState();
            if (state?.party?.length > 0) {
                feedSystem('Intro complete! You have your starter Pokemon.');
                stopIntroSkip();
                return;
            }
        } catch (e) {
            // Ignore read errors during intro
        }

        // Safety limit - stop after ~5 minutes of auto-play
        if (stepCount > 2000) {
            feedSystem('Intro skip timed out. You may need to continue manually.');
            stopIntroSkip();
            return;
        }

        // Alternate between A and random navigation
        // This handles text boxes (A), menus (A), and name entry (arrows + A)
        if (stepCount % 10 === 0) {
            // Occasionally press Start (for title screen)
            emu.pressButton('start', 100);
        } else if (stepCount % 5 === 0) {
            // Navigate down in menus
            emu.pressButton('down', 80);
        } else if (stepCount % 7 === 0) {
            // Navigate right in name entry
            emu.pressButton('right', 80);
        } else {
            // Mostly mash A to advance text
            emu.pressButton('a', 80);
        }
    }, pressInterval);
}

/**
 * Stop intro skip
 */
export function stopIntroSkip() {
    introSkipRunning = false;
    if (introSkipInterval) {
        clearInterval(introSkipInterval);
        introSkipInterval = null;
    }
}

/**
 * Check if intro skip is running
 */
export function isIntroSkipRunning() {
    return introSkipRunning;
}

// ============ INPUT CONTROL ============

/**
 * Press a button
 */
export function pressButton(button) {
    if (!emu) return;
    emu.pressButton(button);

    // Record if in recording mode
    if (collector?.isRecording) {
        collector.recordHumanAction(button);
    }
}

/**
 * Set button state (for hold)
 */
export function setButton(button, pressed) {
    if (!emu) return;
    emu.setButton(button, pressed);
}

// ============ OBJECTIVE OVERRIDE ============

/**
 * Set a custom objective override for the agent
 */
export function setObjectiveOverride(objective) {
    if (agent) {
        agent.setObjectiveOverride(objective);
    }
}

/**
 * Clear the objective override, returning to auto-detection
 */
export function clearObjectiveOverride() {
    if (agent) {
        agent.clearObjectiveOverride();
    }
}

// ============ AUDIO CONTROL ============

/**
 * Initialize audio (must be called from user gesture)
 */
export async function initAudio() {
    if (!emu) return false;
    return await emu.initAudio();
}

/**
 * Enable/disable audio
 */
export function setAudioEnabled(enabled) {
    if (!emu) return;
    emu.setAudioEnabled(enabled);
}

/**
 * Set audio volume (0.0 - 1.0)
 */
export function setVolume(volume) {
    if (!emu) return;
    emu.setVolume(volume);
}

/**
 * Check if audio is enabled
 */
export function isAudioEnabled() {
    return emu?.audioEnabled || false;
}

// ============ TRAINING CONTROL ============

/**
 * Train the model now
 */
export async function trainNow() {
    if (!policy || !collector) {
        feedSystem('Training not available - system not initialized');
        return false;
    }

    const experiences = [
        ...collector.explorationBuffer.buffer,
        ...collector.humanBuffer.buffer
    ];

    console.log(`trainNow called with ${experiences.length} experiences`);

    if (experiences.length < 100) {
        feedSystem('Need at least 100 experiences to train');
        return false;
    }

    feedTraining('Starting manual training...');

    try {
        const result = await policy.trainNow(experiences, { epochs: 30 });

        if (result) {
            console.log('Training succeeded:', result);
            // Force a status update to refresh the UI
            policy.onStatusChange(policy.getStatus());
            return true;
        } else {
            feedSystem('Training did not complete - check browser console for errors');
            return false;
        }
    } catch (e) {
        console.error('Training error:', e);
        feedSystem(`Training failed: ${e.message}`);
        return false;
    }
}

/**
 * Clear the trained model
 */
export async function clearModel() {
    if (!policy) return;
    await policy.clearModel();
    feedSystem('Model cleared');
}

// ============ SAVE/LOAD ============

/**
 * Convert Uint8Array to base64 string (handles large arrays)
 */
function uint8ArrayToBase64(bytes) {
    let binary = '';
    const len = bytes.byteLength;
    // Process in chunks to avoid call stack issues
    const chunkSize = 8192;
    for (let i = 0; i < len; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

/**
 * Save game state
 */
export function saveGame() {
    if (!emu) return false;
    try {
        const state = emu.saveState();
        const encoded = uint8ArrayToBase64(state);

        // Save in chunks to avoid localStorage limits
        const chunkSize = 500000;
        const chunks = Math.ceil(encoded.length / chunkSize);
        localStorage.setItem('tesserack-save-chunks', chunks.toString());
        for (let i = 0; i < chunks; i++) {
            localStorage.setItem(`tesserack-save-${i}`, encoded.slice(i * chunkSize, (i + 1) * chunkSize));
        }
        localStorage.setItem('tesserack-save-time', Date.now().toString());

        feedSystem('Game saved!');
        return true;
    } catch (e) {
        feedSystem(`Save failed: ${e.message}`);
        return false;
    }
}

/**
 * Load game state
 */
export function loadGame() {
    if (!emu) return false;
    try {
        const chunks = parseInt(localStorage.getItem('tesserack-save-chunks') || '0');
        if (chunks === 0) {
            feedSystem('No saved game found');
            return false;
        }

        let encoded = '';
        for (let i = 0; i < chunks; i++) {
            encoded += localStorage.getItem(`tesserack-save-${i}`) || '';
        }

        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        emu.loadState(bytes);
        feedSystem('Game loaded!');
        return true;
    } catch (e) {
        feedSystem(`Load failed: ${e.message}`);
        return false;
    }
}

/**
 * Check if save exists
 */
export function hasSavedGame() {
    return !!localStorage.getItem('tesserack-save-chunks');
}

// ============ EXPORT ============

/**
 * Export training data
 */
export function exportTrainingData() {
    if (!collector) return null;
    return collector.exportForTraining();
}

/**
 * Export model weights
 */
export async function exportModel() {
    if (!policy) return null;
    return await policy.exportModel();
}

/**
 * Export discoveries and checkpoints
 */
export function exportDiscoveries() {
    if (!rewardSystem) return null;
    return rewardSystem.exportData();
}

// ============ PERSISTENCE ============

/**
 * Export all data (full backup)
 */
export async function exportAllData() {
    await flushExperiences(); // Save any pending first
    return persistence.exportAllData();
}

/**
 * Import all data (restore backup)
 */
export async function importAllData(data) {
    const result = await persistence.importAllData(data);
    if (result && collector) {
        // Reload experiences into memory
        const experiences = await persistence.loadExperiences();
        collector.explorationBuffer.buffer = experiences;
        collector.explorationBuffer.totalExperiences = experiences.length;
        updateStats({ experiences: experiences.length });
        feedSystem(`Imported ${experiences.length} experiences.`);
    }
    return result;
}

/**
 * Get storage statistics
 */
export async function getStorageStats() {
    return persistence.getStorageStats();
}

/**
 * Clear all persisted data (factory reset)
 */
export async function clearAllData() {
    if (confirm('This will delete all saved experiences, discoveries, and training data. Are you sure?')) {
        await persistence.clearAllData();
        if (collector) {
            collector.explorationBuffer.clear();
        }
        updateStats({ experiences: 0 });
        feedSystem('All data cleared.');
        return true;
    }
    return false;
}
