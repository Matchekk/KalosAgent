/**
 * Lab Mode Initialization
 *
 * Initializes game systems for Lab mode with GuideAgent integration.
 * Supports two modes:
 *   - 'llm': GuideAgent with LLM calls (default)
 *   - 'purerl': PureRLAgent with deterministic rewards only
 */

import { get, writable } from 'svelte/store';
import { Emulator } from '../emulator.js';
import { MemoryReader } from '../memory-reader.js';
import { GuideAgent } from './guide-agent.js';
import { PureRLAgent } from './pure-rl-agent.js';
import { ParallelTrainingCoordinator } from './parallel-trainer.js';
import { createParallelTrainingPlan, trainingIntervalMs } from './parallel-training.js';
import { CombinedRewardSystem } from '../adaptive-rewards.js';
import { feedSystem } from '$lib/stores/feed';
import {
    walkthroughGraph,
    currentGraphLocation,
    labMetrics,
    updateLocation,
    updateAgentStatus,
    recordStep,
    setLLMCallCount,
    loadWalkthroughGraph,
    rlConfig
} from '$lib/stores/lab';
import { gameState, updateGameState } from '$lib/stores/game';
import { assetUrl } from '$lib/core/asset-url.js';
import { formatPositiveRewardEvents } from './training-utils.js';
import { clearPureRLPolicy, getPureRLPolicy, setPureRLPolicy } from '../persistence.js';

// Lab mode instances
let labEmulator = null;
let labReader = null;
let labAgent = null;
let labPureRLAgent = null;  // Pure RL agent instance
let parallelTrainer = null;
let parallelInitPromise = null;
let parallelPlan = null;
let labRomBuffer = null;
let labRewardSystem = null;
let labCanvas = null;
let isInitialized = false;
let labSpeed = 1; // Playback speed multiplier
let initializationGeneration = 0;
let lastPersistedTrainStep = -1;
let policyPersistInFlight = false;
const PARALLEL_ENVIRONMENT_COUNT = 4;

// Current mode: 'llm' or 'purerl'
export const labMode = writable('llm');
let currentMode = 'llm';

// Pure RL metrics store
export const pureRLMetrics = writable({
    step: 0,
    action: null,
    reward: 0,
    totalReward: 0,
    breakdown: { tier1: 0, tier2: 0, tier3: 0, penalties: 0 },
    firedTests: [],
    context: 'overworld',
    matrixVersion: null,
    // Test bundle metrics
    currentLocation: null,
    bundleInfo: null,
    totalRewards: { tier1: 0, tier2: 0, tier3: 0, penalties: 0, total: 0 },
    completedObjectives: [],
    teamQuality: null,
    // Training metrics (REINFORCE)
    trainSteps: 0,
    bufferFill: 0,
    bufferSize: 128,
    avgRawReturn: 0,
    policyEntropy: 0,
    episode: 1,
    episodeSteps: 0,
    bestProgressScore: 0,
    checkpointCount: 0,
    confirmedWins: 0,
    environmentCount: PARALLEL_ENVIRONMENT_COUNT,
    samplesPerSecond: 0,
    checkpointWorker: null,
    workers: [],
    memoryDiagnostics: null,
    // Chart history (rolling window of last 50 rollouts)
    history: {
        returns: [],    // { step, value }[]
        entropy: [],    // { step, value }[]
        rewards: [],    // { step, t1, t2, t3, penalties }[]
    },
    maxHistoryLength: 50,
});

async function persistPureRLPolicy() {
    if (!labPureRLAgent || policyPersistInFlight
        || labPureRLAgent.core.trainSteps === lastPersistedTrainStep) return;
    const trainStep = labPureRLAgent.core.trainSteps;
    const snapshot = labPureRLAgent.exportPolicy();
    policyPersistInFlight = true;
    try {
        if (await setPureRLPolicy(snapshot)) lastPersistedTrainStep = trainStep;
    } finally {
        policyPersistInFlight = false;
    }
}

/**
 * Handle agent updates - sync with lab stores
 */
function handleLabAgentUpdate(update) {
    updateAgentStatus(update);
    if (update.llmCallCount !== undefined) {
        setLLMCallCount(update.llmCallCount);
    }

    // Update game state
    if (update.state) {
        updateGameState(update.state);
    }

    // Update location on graph
    if (update.state?.location) {
        updateLocation(update.state.location);
    }

    // Report errors to activity feed
    if (update.error) {
        const errorMsg = update.error;
        if (errorMsg.includes('WebLLM not initialized')) {
            feedSystem('LLM Error: Browser model not loaded. Select a model in the header.');
        } else if (errorMsg.includes('No model configured')) {
            feedSystem('LLM Error: No model selected. Configure in the Model dropdown.');
        } else if (errorMsg.includes('No endpoint configured')) {
            feedSystem('LLM Error: No API endpoint configured.');
        } else if (errorMsg.includes('401') || errorMsg.includes('Unauthorized')) {
            feedSystem('LLM Error: Invalid API key. Check your key in Model settings.');
        } else if (errorMsg.includes('429') || errorMsg.includes('rate limit')) {
            feedSystem('LLM Error: Rate limited. Wait a moment and try again.');
        } else {
            feedSystem(`LLM Error: ${errorMsg.slice(0, 80)}`);
        }
    }

    // Log successful LLM calls with plan info
    if (update.reasoning && !update.error && update.plansGenerated > 0) {
        // Only log occasionally to avoid spam
        const callCount = update.llmCallCount ?? update.rlStats?.llmCalls ?? 0;
        if (callCount % 5 === 1) {
            feedSystem(`Plan: ${update.reasoning.slice(0, 60)}...`);
        }
    }
}

/**
 * Handle pure RL agent step updates
 */
function handlePureRLStep(stepData) {
    // Update pure RL metrics store
    pureRLMetrics.update(prev => {
        const newMetrics = {
            step: stepData.step,
            action: stepData.action,
            reward: stepData.reward,
            totalReward: stepData.totalReward,
            breakdown: stepData.breakdown,
            firedTests: stepData.firedTests,
            context: stepData.context ?? prev.context,
            matrixVersion: stepData.matrixVersion ?? prev.matrixVersion,
            // Test bundle metrics
            currentLocation: stepData.currentLocation ?? prev.currentLocation,
            bundleInfo: stepData.bundleInfo ?? prev.bundleInfo,
            totalRewards: stepData.totalRewards ?? prev.totalRewards,
            completedObjectives: stepData.completedObjectives ?? prev.completedObjectives,
            teamQuality: stepData.teamQuality ?? prev.teamQuality,
            // Training metrics
            trainSteps: stepData.trainSteps ?? 0,
            bufferFill: stepData.bufferFill ?? 0,
            bufferSize: stepData.bufferSize ?? 128,
            avgRawReturn: stepData.avgRawReturn ?? 0,
            policyEntropy: stepData.policyEntropy ?? 0,
            episode: stepData.episode ?? prev.episode,
            episodeSteps: stepData.episodeSteps ?? prev.episodeSteps,
            bestProgressScore: stepData.bestProgressScore ?? prev.bestProgressScore,
            checkpointCount: stepData.checkpointCount ?? prev.checkpointCount,
            confirmedWins: stepData.confirmedWins ?? prev.confirmedWins,
            environmentCount: stepData.environmentCount ?? prev.environmentCount,
            samplesPerSecond: stepData.samplesPerSecond ?? prev.samplesPerSecond,
            checkpointWorker: stepData.checkpointWorker ?? prev.checkpointWorker,
            workers: stepData.workers ?? prev.workers,
            memoryDiagnostics: stepData.memoryDiagnostics ?? prev.memoryDiagnostics,
            // Preserve history
            history: prev.history,
            maxHistoryLength: prev.maxHistoryLength,
        };

        // Append to history on training update (when trainSteps increases)
        if (stepData.trainSteps > prev.trainSteps) {
            const maxLen = prev.maxHistoryLength;
            const step = stepData.trainSteps;

            // Returns history
            const returns = [...prev.history.returns, { step, value: stepData.avgRawReturn ?? 0 }];
            if (returns.length > maxLen) returns.shift();

            // Entropy history
            const entropy = [...prev.history.entropy, { step, value: stepData.policyEntropy ?? 0 }];
            if (entropy.length > maxLen) entropy.shift();

            // Rewards breakdown history (cumulative from breakdown)
            const rewards = [...prev.history.rewards, {
                step,
                t1: stepData.breakdown?.tier1 ?? 0,
                t2: stepData.breakdown?.tier2 ?? 0,
                t3: stepData.breakdown?.tier3 ?? 0,
                penalties: stepData.breakdown?.penalties ?? 0,
            }];
            if (rewards.length > maxLen) rewards.shift();

            newMetrics.history = { returns, entropy, rewards };
        }

        return newMetrics;
    });

    // Update game state
    if (stepData.state) {
        updateGameState(stepData.state);
    }

    // Update location on graph
    if (stepData.state?.location) {
        updateLocation(stepData.state.location);
    }

    // Record step (use total from breakdown)
    recordStep(stepData.reward);

    // Log milestone rewards to feed
    if (stepData.firedTests.length > 0) {
        const tests = formatPositiveRewardEvents(stepData.firedTests);
        if (tests.length > 0) {
            const roundReward = Number(stepData.reward) || 0;
            const sign = roundReward >= 0 ? '+' : '';
            feedSystem(`RL: ${tests.join('; ')} (round ${sign}${roundReward.toFixed(2)})`);
        }
    }
}

/**
 * Update game state from memory on each frame
 */
function updateLabGameState() {
    if (!labReader) return;

    const state = labReader.getGameState();
    updateGameState(state);

    // Update location tracking
    if (state.location) {
        const current = get(currentGraphLocation);
        if (state.location !== current) {
            updateLocation(state.location);
        }
    }
}

/**
 * Initialize Lab mode with a ROM buffer
 * @param {ArrayBuffer} romBuffer - ROM file data
 * @param {HTMLCanvasElement} canvas - Canvas element for rendering
 */
export async function initializeLab(romBuffer, canvas) {
    if (isInitialized) {
        console.log('[Lab] Already initialized');
        return { emulator: labEmulator, agent: labAgent, reader: labReader };
    }

    const generation = ++initializationGeneration;
    labCanvas = canvas;
    labRomBuffer = romBuffer.slice(0);

    feedSystem('Initializing Lab mode...');

    try {
        // 1. Load walkthrough graph
        await loadWalkthroughGraph();
        if (generation !== initializationGeneration) return null;

        // 2. Create emulator
        const emulator = new Emulator(canvas);
        labEmulator = emulator;
        await emulator.loadROM(romBuffer);
        if (generation !== initializationGeneration) {
            emulator.destroy();
            return null;
        }

        // 3. Create memory reader
        labReader = new MemoryReader(labEmulator);

        // 4. Create guide-enhanced agent (LLM mode)
        labAgent = new GuideAgent(labEmulator, labReader, handleLabAgentUpdate);

        // 5. Create reward system
        labRewardSystem = new CombinedRewardSystem(canvas, labReader);
        labAgent.setExternalRewardSource(labRewardSystem);

        // 6. Create pure RL agent (REINFORCE - no epsilon, pure policy sampling)
        const currentRLConfig = get(rlConfig);
        parallelPlan = createParallelTrainingPlan({
            workerCount: PARALLEL_ENVIRONMENT_COUNT,
            rolloutSize: currentRLConfig.rolloutSize,
        });
        labPureRLAgent = new PureRLAgent(labEmulator, labReader, {
            workerId: 0,
            actionHoldFrames: 12,
            frameSkip: 16,      // More frames per step = smoother movement
            actionRepeat: 1,    // One decision per transition for correct credit assignment
            autoCheckpoint: false,
            persistCheckpoint: true,
            rehearseEvery: 0,
            // REINFORCE config
            rolloutSize: parallelPlan.aggregateRolloutSize,
            learningRate: currentRLConfig.learningRate,
            gamma: currentRLConfig.gamma,
            normalizeReturns: true,
        });
        await labPureRLAgent.restorePersistedCheckpoint();
        // Preserve the true ROM start even when a later curriculum checkpoint
        // was restored from storage. One parallel worker always rehearses it.
        labPureRLAgent.setInitialState(labEmulator.saveState());

        const savedPolicy = await getPureRLPolicy();
        if (savedPolicy) {
            try {
                labPureRLAgent.loadPolicy(savedPolicy);
                lastPersistedTrainStep = labPureRLAgent.core.trainSteps;
                pureRLMetrics.update(metrics => ({
                    ...metrics,
                    trainSteps: labPureRLAgent.core.trainSteps,
                    avgRawReturn: labPureRLAgent.core.lastAvgRawReturn,
                    policyEntropy: labPureRLAgent.core.lastEntropy,
                    bufferSize: parallelPlan.aggregateRolloutSize,
                }));
                feedSystem(`Restored trained policy (${labPureRLAgent.core.trainSteps} updates).`);
            } catch (err) {
                console.warn('[Lab] Saved Pure RL policy is incompatible:', err.message);
                await clearPureRLPolicy();
                feedSystem('Old Train policy was incompatible with Red++ state mapping and was reset.');
            }
        }

        // 6b. Load Red++ guide metadata. Numeric rewards remain matrix-owned.
        try {
            await labPureRLAgent.rewards.loadBundles(assetUrl('data/redpp-oak-guide.json'));
        } catch (err) {
            console.warn('[Lab] Failed to load Red++ guide metadata, using defaults:', err.message);
        }
        if (generation !== initializationGeneration) {
            emulator.destroy();
            return null;
        }

        // 7. Start emulator
        labEmulator.frameCallback = updateLabGameState;
        labEmulator.start();

        isInitialized = true;

        feedSystem('Lab mode ready! Click Run to start the agent.');

        return { emulator: labEmulator, agent: labAgent, pureRLAgent: labPureRLAgent, reader: labReader };
    } catch (err) {
        console.error('[Lab] Initialization failed:', err);
        cleanupLab();
        feedSystem(`Lab error: ${err.message}`);
        throw err;
    }
}

async function ensureParallelTrainer() {
    if (parallelTrainer) return parallelTrainer;
    if (parallelInitPromise) return parallelInitPromise;
    if (!labPureRLAgent || !labEmulator || !labRomBuffer || !parallelPlan) {
        throw new Error('Parallel Train is not initialized');
    }

    parallelInitPromise = (async () => {
        const agents = [labPureRLAgent];
        const hiddenAgents = [];
        try {
            labPureRLAgent.ensureCheckpoint();
            labPureRLAgent.loadCheckpointIntoEnvironment();

            for (const worker of parallelPlan.workers.slice(1)) {
                const canvas = document.createElement('canvas');
                canvas.width = 160;
                canvas.height = 144;

                const emulator = new Emulator(canvas);
                await emulator.loadROM(labRomBuffer);
                const reader = new MemoryReader(emulator);
                const agent = new PureRLAgent(emulator, reader, {
                    workerId: worker.workerId,
                    sharedCore: labPureRLAgent.core,
                    actionHoldFrames: labPureRLAgent.config.actionHoldFrames,
                    frameSkip: labPureRLAgent.config.frameSkip,
                    actionRepeat: 1,
                    maxEpisodeSteps: labPureRLAgent.config.maxEpisodeSteps,
                    noProgressSteps: labPureRLAgent.config.noProgressSteps,
                    resetFromInitial: worker.resetFromInitial,
                    rehearseEvery: 0,
                    autoCheckpoint: false,
                    persistCheckpoint: false,
                    rolloutSize: parallelPlan.aggregateRolloutSize,
                    learningRate: labPureRLAgent.core.learningRate,
                    gamma: labPureRLAgent.core.gamma,
                    normalizeReturns: labPureRLAgent.core.normalizeReturns,
                    entropyCoefficient: labPureRLAgent.core.entropyCoefficient,
                });

                agent.setInitialState(labPureRLAgent.initialState);
                agent.adoptCheckpoint(
                    labPureRLAgent.checkpointState,
                    labPureRLAgent.bestProgressScore,
                );
                if (worker.resetFromInitial) {
                    emulator.loadState(agent.initialState);
                } else {
                    agent.loadCheckpointIntoEnvironment();
                }
                for (let frame = 0; frame < 4; frame++) emulator.runFrame();
                await agent.rewards.loadBundles(assetUrl('data/redpp-oak-guide.json'));
                hiddenAgents.push(agent);
                agents.push(agent);
            }

            parallelTrainer = new ParallelTrainingCoordinator({
                agents,
                visibleWorker: parallelPlan.visibleWorker,
                onCheckpoint(candidate) {
                    feedSystem(`Global checkpoint: environment ${candidate.workerId + 1} advanced durable Red++ progress.`);
                },
            });
            feedSystem(`Parallel Train ready: ${agents.length} environments share one policy; environment ${parallelPlan.startWorker + 1} rehearses from ROM start.`);
            return parallelTrainer;
        } catch (error) {
            for (const agent of hiddenAgents) agent.emu.destroy();
            throw error;
        } finally {
            parallelInitPromise = null;
        }
    })();

    return parallelInitPromise;
}

function destroyParallelTrainer() {
    if (!parallelTrainer) return;
    parallelTrainer.destroy();
    parallelTrainer = null;
}

/**
 * Set the lab mode
 * @param {'llm' | 'purerl'} mode - The mode to switch to
 */
export function setLabMode(mode) {
    if (mode !== 'llm' && mode !== 'purerl') {
        console.error('[Lab] Invalid mode:', mode);
        return;
    }

    // Stop current agent before switching
    stopLabAgent();

    currentMode = mode;
    labMode.set(mode);

    if (mode === 'purerl') {
        // Train advances frames only through credited policy transitions.
        // Stopping RAF also makes 16x/headless training substantially faster.
        labEmulator?.stop();
        feedSystem('Switched to Pure RL mode (no LLM calls)');
    } else {
        destroyParallelTrainer();
        if (labEmulator?.e && !labEmulator.running) labEmulator.start();
        feedSystem('Switched to LLM mode (Guide-enhanced agent)');
    }
}

/**
 * Get current lab mode
 */
export function getLabMode() {
    return currentMode;
}

/**
 * Start the lab agent
 */
export async function startLabAgent() {
    if (currentMode === 'purerl') {
        if (!labPureRLAgent) {
            console.error('[Lab] Pure RL agent not initialized');
            return false;
        }
        const trainer = await ensureParallelTrainer();
        trainer.start();
        runPureRLLoop();
    } else {
        if (!labAgent) {
            console.error('[Lab] Agent not initialized');
            return false;
        }
        labAgent.running = true;
        runLabLoop();
    }
    return true;
}

/**
 * Stop the lab agent
 */
export function stopLabAgent() {
    if (labAgent) {
        labAgent.running = false;
    }
    parallelTrainer?.stop();
    labPureRLAgent?.stop();
}

/**
 * Lab agent loop (LLM mode)
 */
async function runLabLoop() {
    if (!labAgent || !labAgent.running) return;

    try {
        await labAgent.step();
    } catch (err) {
        console.error('[Lab] Agent step error:', err);
    }

    // Continue loop with speed adjustment
    if (labAgent.running) {
        const interval = Math.max(10, 100 / labSpeed); // Faster with higher speed
        setTimeout(runLabLoop, interval);
    }
}

/**
 * Pure RL agent loop
 */
async function runPureRLLoop() {
    if (!labPureRLAgent || !parallelTrainer?.running) return;

    try {
        const result = await parallelTrainer.stepRound();
        if (result.trainInfo) void persistPureRLPolicy();
        handlePureRLStep({
            ...result,
            firedTests: result.firedTests ?? [],
        });
    } catch (err) {
        console.error('[Lab] Pure RL step error:', err);
        feedSystem(`Parallel Train paused: ${err.message}`);
        parallelTrainer?.stop();
    }

    // Continue loop with speed adjustment
    if (parallelTrainer?.running) {
        const interval = trainingIntervalMs(labSpeed);
        setTimeout(runPureRLLoop, interval);
    }
}

/**
 * Set playback speed
 * @param {number} speed - Speed multiplier (0.5, 1, 2, 4, 8, 16)
 */
export function setLabSpeed(speed) {
    labSpeed = speed;
    console.log(`[Lab] Speed set to ${speed}x`);
}

/**
 * Step one frame (for manual stepping)
 */
export async function stepLabAgent() {
    if (currentMode === 'purerl') {
        if (!labPureRLAgent) {
            console.error('[Lab] Pure RL agent not initialized');
            return false;
        }
        try {
            labEmulator?.stop();
            const trainer = await ensureParallelTrainer();
            const result = await trainer.stepRound();
            if (result.trainInfo) void persistPureRLPolicy();
            handlePureRLStep({
                ...result,
                firedTests: result.firedTests ?? [],
            });
            return true;
        } catch (err) {
            console.error('[Lab] Pure RL step error:', err);
            return false;
        }
    } else {
        if (!labAgent) {
            console.error('[Lab] Agent not initialized');
            return false;
        }
        try {
            await labAgent.step();
            return true;
        } catch (err) {
            console.error('[Lab] Step error:', err);
            return false;
        }
    }
}

/**
 * Reset lab mode
 */
export function resetLab() {
    stopLabAgent();

    labMetrics.update(m => ({
        ...m,
        totalSteps: 0,
        llmCalls: 0,
        objectivesCompleted: 0,
        guideAdherenceScore: 0,
        currentReward: 0,
        episodeReward: 0
    }));

    // Reset all environments while keeping the shared learned policy.
    if (parallelTrainer) parallelTrainer.reset();
    else labPureRLAgent?.reset();

    // Reset pure RL metrics store
    pureRLMetrics.set({
        step: 0,
        action: null,
        reward: 0,
        totalReward: 0,
        breakdown: { tier1: 0, tier2: 0, tier3: 0, penalties: 0 },
        firedTests: [],
        context: 'overworld',
        matrixVersion: null,
        // Test bundle metrics
        currentLocation: null,
        bundleInfo: null,
        totalRewards: { tier1: 0, tier2: 0, tier3: 0, penalties: 0, total: 0 },
        completedObjectives: [],
        teamQuality: null,
        // Training metrics
        trainSteps: 0,
        bufferFill: 0,
        bufferSize: parallelPlan?.aggregateRolloutSize ?? 512,
        avgRawReturn: 0,
        policyEntropy: 0,
        episode: 1,
        episodeSteps: 0,
        bestProgressScore: 0,
        checkpointCount: 0,
        confirmedWins: 0,
        environmentCount: parallelPlan?.workerCount ?? PARALLEL_ENVIRONMENT_COUNT,
        samplesPerSecond: 0,
        checkpointWorker: null,
        workers: [],
        history: {
            returns: [],
            entropy: [],
            rewards: [],
        },
        maxHistoryLength: 50,
    });
}

/**
 * Get current lab instances
 */
export function getLabInstances() {
    return {
        emulator: labEmulator,
        agent: labAgent,
        pureRLAgent: labPureRLAgent,
        reader: labReader,
        rewardSystem: labRewardSystem,
        parallelTrainer,
        parallelPlan,
        isInitialized,
        currentMode
    };
}

/**
 * Check if lab is initialized
 */
export function isLabInitialized() {
    return isInitialized;
}

/**
 * Update RL agent configuration (hyperparameters)
 * @param {Object} config - { learningRate, rolloutSize, gamma }
 */
export function updateRLConfig(config) {
    if (labPureRLAgent) {
        parallelPlan = createParallelTrainingPlan({
            workerCount: PARALLEL_ENVIRONMENT_COUNT,
            rolloutSize: config.rolloutSize,
        });
        labPureRLAgent.updateConfig({
            ...config,
            rolloutSize: parallelPlan.aggregateRolloutSize,
        });
        parallelTrainer?.setSharedCore(labPureRLAgent.core);
        feedSystem(`Config updated: LR=${config.learningRate}, Rollout=${config.rolloutSize}, γ=${config.gamma}`);
    }
}

/**
 * Cleanup lab mode
 */
export function cleanupLab() {
    initializationGeneration++;
    stopLabAgent();
    destroyParallelTrainer();

    if (labEmulator) {
        labEmulator.destroy();
    }

    labEmulator = null;
    labReader = null;
    labAgent = null;
    labPureRLAgent = null;
    labRewardSystem = null;
    labCanvas = null;
    labRomBuffer = null;
    parallelPlan = null;
    parallelInitPromise = null;
    isInitialized = false;
    currentMode = 'llm';
    labMode.set('llm');
}
