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
import { PureRLAgent, REDPP_TRAINING_OBJECTIVE_VERSION } from './pure-rl-agent.js';
import { ParallelTrainingCoordinator } from './parallel-trainer.js';
import { createParallelTrainingPlan, trainingIntervalMs, trainingRoundsPerTick } from './parallel-training.js';
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
import {
    captureRewardLearningStates,
    captureTrainingProgress,
    isFatalEmulatorError,
    restoreRewardLearningStates,
    restoreTrainingProgress,
    shouldRecycleEnvironments,
} from './training-recovery.js';
import {
    clearPureRLAutonomy,
    clearPureRLPolicy,
    getPureRLAutonomy,
    getPureRLPolicy,
    setPureRLAutonomy,
    setPureRLPolicy,
} from '../persistence.js';

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
let lastPersistedDemonstrationTrainStep = -1;
let lastPersistedDemonstrationLength = -1;
let policyPersistInFlight = false;
let parallelSampleCount = 0;
let parallelLifecycleStartSamples = 0;
let parallelRecoveryPromise = null;
let lastFatalParallelRecoveryAt = 0;
let lastLearningAuditFeedBoundary = 0;
const PARALLEL_ENVIRONMENT_COUNT = 4;
const RECOVERY_RETRY_COOLDOWN_MS = 60_000;

// Current mode: 'llm' or 'purerl'
export const labMode = writable('llm');
export const labRunStatus = writable({ running: false, recovering: false, error: null });
export const labDemonstration = writable({
    active: false,
    correctionMode: false,
    samples: 0,
    trainSteps: 0,
    loss: 0,
    accuracy: 0,
});
let currentMode = 'llm';
let demonstrationActive = false;

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
    // Training metrics (PPO/GAE)
    trainSteps: 0,
    bufferFill: 0,
    bufferSize: 128,
    avgRawReturn: 0,
    policyEntropy: 0,
    valueLoss: 0,
    clipFraction: 0,
    intrinsicReward: 0,
    episode: 1,
    episodeSteps: 0,
    bestProgressScore: 0,
    checkpointCount: 0,
    confirmedWins: 0,
    environmentCount: PARALLEL_ENVIRONMENT_COUNT,
    samplesPerSecond: 0,
    checkpointWorker: null,
    archiveSize: 0,
    archiveSelections: 0,
    autonomy: null,
    learningAudit: null,
    demonstration: { samples: 0, capacity: 8192, trainSteps: 0, loss: 0, accuracy: 0 },
    workers: [],
    visibleWorker: 0,
    visibleState: null,
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
    if (!labPureRLAgent || policyPersistInFlight) return;
    const trainStep = labPureRLAgent.core.trainSteps;
    const demonstrationTrainStep = labPureRLAgent.core.demonstrationTrainSteps || 0;
    const demonstrationLength = labPureRLAgent.core.demonstrationLength || 0;
    if (trainStep === lastPersistedTrainStep
        && demonstrationTrainStep === lastPersistedDemonstrationTrainStep
        && demonstrationLength === lastPersistedDemonstrationLength) return;
    const snapshot = labPureRLAgent.exportPolicy();
    policyPersistInFlight = true;
    try {
        if (await setPureRLPolicy(snapshot)) {
            lastPersistedTrainStep = trainStep;
            lastPersistedDemonstrationTrainStep = demonstrationTrainStep;
            lastPersistedDemonstrationLength = demonstrationLength;
            if (parallelTrainer) {
                await setPureRLAutonomy(parallelTrainer.exportAutonomousProgress());
            }
        }
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
            valueLoss: stepData.valueLoss ?? prev.valueLoss,
            clipFraction: stepData.clipFraction ?? prev.clipFraction,
            intrinsicReward: stepData.intrinsicReward ?? prev.intrinsicReward,
            episode: stepData.episode ?? prev.episode,
            episodeSteps: stepData.episodeSteps ?? prev.episodeSteps,
            bestProgressScore: stepData.bestProgressScore ?? prev.bestProgressScore,
            checkpointCount: stepData.checkpointCount ?? prev.checkpointCount,
            confirmedWins: stepData.confirmedWins ?? prev.confirmedWins,
            environmentCount: stepData.environmentCount ?? prev.environmentCount,
            samplesPerSecond: stepData.samplesPerSecond ?? prev.samplesPerSecond,
            checkpointWorker: stepData.checkpointWorker ?? prev.checkpointWorker,
            archiveSize: stepData.archiveSize ?? prev.archiveSize,
            archiveSelections: stepData.archiveSelections ?? prev.archiveSelections,
            autonomy: stepData.autonomy ?? prev.autonomy,
            learningAudit: stepData.learningAudit ?? prev.learningAudit,
            demonstration: stepData.demonstration ?? prev.demonstration,
            workers: stepData.workers ?? prev.workers,
            visibleWorker: stepData.visibleWorker ?? prev.visibleWorker,
            visibleState: stepData.state ?? prev.visibleState,
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

    const audit = stepData.learningAudit?.last;
    if (audit?.boundarySamples > lastLearningAuditFeedBoundary) {
        lastLearningAuditFeedBoundary = audit.boundarySamples;
        const delta = audit.deltas;
        feedSystem(
            `50k learning audit @ ${audit.boundarySamples.toLocaleString()}: ${audit.verdict} - `
            + `${audit.reason}; fresh best delta ${delta.freshBestLevel}, `
            + `verified delta ${delta.verifiedLevel}, attempts delta ${delta.attempts}.`,
        );
    }

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

        // 6. Create the browser-native PPO/GAE agent.
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
            // PPO/GAE config
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
                if (savedPolicy.version !== 2 || savedPolicy.algorithm !== 'ppo-gae'
                    || savedPolicy.objectiveVersion !== REDPP_TRAINING_OBJECTIVE_VERSION) {
                    throw new Error('saved policy targets an incompatible training objective');
                }
                labPureRLAgent.loadPolicy(savedPolicy);
                lastPersistedTrainStep = labPureRLAgent.core.trainSteps;
                lastPersistedDemonstrationTrainStep = labPureRLAgent.core.demonstrationTrainSteps || 0;
                lastPersistedDemonstrationLength = labPureRLAgent.core.demonstrationLength || 0;
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
                await clearPureRLAutonomy();
                feedSystem('The saved Train policy and its proof counters were reset for the corrected objective.');
            }
        }
        const restoredDemonstrations = labPureRLAgent.core.getDemonstrationStatus();
        labDemonstration.set({ active: false, ...restoredDemonstrations });
        pureRLMetrics.update(metrics => ({ ...metrics, demonstration: restoredDemonstrations }));

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
                initialTotalSamples: parallelSampleCount,
                onCheckpoint(candidate) {
                    feedSystem(`Global checkpoint: environment ${candidate.workerId + 1} advanced durable Red++ progress.`);
                },
            });
            const savedAutonomy = await getPureRLAutonomy();
            if (savedAutonomy) {
                parallelTrainer.restoreAutonomousProgress(savedAutonomy);
                const restoredBoundary = savedAutonomy.version === 2
                    ? savedAutonomy.learningAudit?.history?.at(-1)?.boundarySamples
                    : 0;
                lastLearningAuditFeedBoundary = Math.max(
                    lastLearningAuditFeedBoundary,
                    Number(restoredBoundary) || 0,
                );
            }
            parallelLifecycleStartSamples = parallelTrainer.totalSamples;
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
    parallelSampleCount = Math.max(parallelSampleCount, parallelTrainer.totalSamples);
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
    try {
        if (demonstrationActive) await finishLabDemonstration();
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
        labRunStatus.set({ running: true, recovering: false, error: null });
        return true;
    } catch (error) {
        console.error('[Lab] Agent start failed:', error);
        labRunStatus.set({ running: false, recovering: false, error: error.message });
        feedSystem(`Cannot start Train: ${error.message}`);
        return false;
    }
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
    labRunStatus.set({ running: false, recovering: false, error: null });
}

/** Begin a clean, visible human demonstration from the true ROM start. */
export function startLabDemonstration() {
    if (!labPureRLAgent || !labEmulator) return false;
    stopLabAgent();
    destroyParallelTrainer();
    labEmulator.stop();
    if (!labPureRLAgent.initialState) throw new Error('ROM-start state is unavailable');
    labEmulator.loadState(labPureRLAgent.initialState);
    for (let frame = 0; frame < 4; frame++) labEmulator.runFrame();
    labPureRLAgent.reset();
    demonstrationActive = true;
    const status = labPureRLAgent.core.getDemonstrationStatus();
    labDemonstration.set({ active: true, correctionMode: false, ...status });
    updateGameState(labReader.getGameState());
    feedSystem('Teach mode: fresh ROM. Every manual transition trains the shared PPO actor; autonomy proof remains untouched.');
    return true;
}

/** Pause the learner and collect DAgger-style labels on states it actually reached. */
export function startLabCorrection() {
    if (!labPureRLAgent || !labEmulator) return false;
    stopLabAgent();
    destroyParallelTrainer();
    labEmulator.stop();
    demonstrationActive = true;
    const status = labPureRLAgent.core.getDemonstrationStatus();
    labDemonstration.set({ active: true, correctionMode: true, ...status });
    updateGameState(labReader.getGameState());
    feedSystem('Correction mode: label the learner-induced state currently on screen. Autonomous proof remains untouched until the corrected policy is consolidated.');
    return true;
}

/** Execute one deterministic manual action and record it as expert data. */
export async function recordLabDemonstrationAction(action) {
    if (!demonstrationActive || !labPureRLAgent) return false;
    const correctionMode = Boolean(get(labDemonstration).correctionMode);
    const result = await labPureRLAgent.demonstrate(action, { correction: correctionMode });
    const metrics = labPureRLAgent.getMetrics();
    const rewardStats = metrics.rewardStats || {};
    const status = result.demonstration;
    labDemonstration.set({ active: true, correctionMode, ...status });
    handlePureRLStep({
        step: labPureRLAgent.totalSteps,
        action,
        reward: result.reward,
        totalReward: labPureRLAgent.totalReward,
        breakdown: result.breakdown,
        firedTests: result.firedTests,
        context: result.context,
        matrixVersion: result.matrixVersion,
        trainSteps: labPureRLAgent.core.trainSteps,
        bufferFill: labPureRLAgent.core.buffer.length,
        bufferSize: labPureRLAgent.core.rolloutSize,
        avgRawReturn: labPureRLAgent.core.lastAvgRawReturn,
        policyEntropy: labPureRLAgent.core.lastEntropy,
        valueLoss: labPureRLAgent.core.lastValueLoss,
        clipFraction: labPureRLAgent.core.lastClipFraction,
        episode: labPureRLAgent.episode,
        episodeSteps: labPureRLAgent.episodeSteps,
        confirmedWins: labPureRLAgent.confirmedWins,
        currentLocation: rewardStats.currentLocation,
        bundleInfo: rewardStats.bundleInfo,
        totalRewards: rewardStats.totalRewards,
        completedObjectives: rewardStats.completedObjectives,
        teamQuality: rewardStats.teamQuality,
        demonstration: status,
        state: result.nextState,
        memoryDiagnostics: result.nextState?.memoryDiagnostics,
    });
    // A browser/tab interruption must not discard the last completed BC block.
    // Await the IndexedDB snapshot here instead of fire-and-forget: expert
    // collection is intentionally low-frequency (once per 32 transitions), so
    // the small pause is preferable to silently losing a teaching episode.
    if (result.demonstrationTraining) await persistPureRLPolicy();
    return result;
}

/** Let non-interactive animation progress without teaching an arbitrary key. */
export function advanceLabDemonstration(frames = 20) {
    if (!demonstrationActive || !labPureRLAgent) return false;
    labPureRLAgent.advanceDemonstration(frames);
    updateGameState(labReader.getGameState());
    return true;
}

/** Consolidate the demonstration and persist both actor weights and demo replay. */
export async function finishLabDemonstration() {
    if (!labPureRLAgent) return null;
    const result = labPureRLAgent.finishDemonstration();
    demonstrationActive = false;
    const status = labPureRLAgent.core.getDemonstrationStatus();
    labDemonstration.set({ active: false, correctionMode: false, ...status });
    await persistPureRLPolicy();
    // Supervision changed the evaluated policy. Previous fresh-ROM attempts
    // therefore belong to a different policy and must never be combined with
    // the post-demonstration proof. Keep the learned actor/replay, but restart
    // the autonomous sample clock, outcome proof and 50k audit from zero.
    parallelSampleCount = 0;
    parallelLifecycleStartSamples = 0;
    lastLearningAuditFeedBoundary = 0;
    await clearPureRLAutonomy();
    pureRLMetrics.update(metrics => ({
        ...metrics,
        step: 0,
        autonomy: null,
        learningAudit: null,
        demonstration: status,
    }));
    feedSystem(`Teaching data learned: ${status.samples} transitions, ${(status.accuracy * 100).toFixed(1)}% BC accuracy, ${(status.collisionRate * 100).toFixed(2)}% state-label collisions.`);
    feedSystem('Autonomous proof reset: the learned policy must now reproduce the route from a fresh ROM without human input.');
    return result;
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
        const trainer = parallelTrainer;
        const rounds = trainingRoundsPerTick(labSpeed, {
            hidden: globalThis.document?.hidden === true,
        });
        for (let round = 0; round < rounds; round++) {
            if (parallelTrainer !== trainer || !trainer.running) return;
            const result = await trainer.stepRound();
            if (result.trainInfo) void persistPureRLPolicy();
            handlePureRLStep({
                ...result,
                firedTests: result.firedTests ?? [],
            });
            parallelSampleCount = Math.max(parallelSampleCount, result.step ?? 0);

            if (shouldRecycleEnvironments(parallelSampleCount, parallelLifecycleStartSamples)) {
                trainer.stop();
                void recoverParallelTraining('scheduled WASM memory rotation');
                return;
            }
        }
    } catch (err) {
        console.error('[Lab] Pure RL step error:', err);
        parallelTrainer?.stop();
        if (isFatalEmulatorError(err)) {
            const now = Date.now();
            if (now - lastFatalParallelRecoveryAt >= RECOVERY_RETRY_COOLDOWN_MS) {
                void recoverParallelTraining('WASM memory exhaustion');
                return;
            }
            feedSystem(`Parallel Train paused after repeated WASM recovery failure: ${err.message}`);
        } else {
            feedSystem(`Parallel Train paused: ${err.message}`);
        }
        labRunStatus.set({ running: false, recovering: false, error: err.message });
    }

    // Continue loop with speed adjustment
    if (parallelTrainer?.running) {
        const interval = trainingIntervalMs(labSpeed);
        setTimeout(runPureRLLoop, interval);
    }
}

async function recoverParallelTraining(reason) {
    if (parallelRecoveryPromise) return parallelRecoveryPromise;
    if (!labRomBuffer || !labCanvas) {
        const message = 'ROM or Lab canvas is unavailable for automatic recovery';
        labRunStatus.set({ running: false, recovering: false, error: message });
        feedSystem(`Parallel Train paused: ${message}.`);
        return false;
    }

    // A planned rotation must not suppress the first real OOM recovery. Only
    // repeated fatal recoveries are cooldown-limited.
    if (reason === 'WASM memory exhaustion') lastFatalParallelRecoveryAt = Date.now();
    const romBuffer = labRomBuffer.slice(0);
    const canvas = labCanvas;
    const speed = labSpeed;
    const retainedSamples = Math.max(parallelSampleCount, parallelTrainer?.totalSamples ?? 0);
    const retainedRewardStates = captureRewardLearningStates(parallelTrainer?.agents || []);
    const retainedProgress = captureTrainingProgress(parallelTrainer);
    labRunStatus.set({ running: false, recovering: true, error: null });
    feedSystem(`Parallel Train recovering from ${reason}; policy, checkpoint and reward memory are retained.`);

    parallelRecoveryPromise = (async () => {
        await persistPureRLPolicy();
        destroyParallelTrainer();
        try {
            labEmulator?.destroy();
        } catch (error) {
            // An aborted WASM module cannot always execute its destructors.
            // Dropping all JS references lets the browser reclaim the module.
            console.warn('[Lab] Aborted visible emulator cleanup failed:', error);
        }

        labEmulator = null;
        labReader = null;
        labAgent = null;
        labPureRLAgent = null;
        labRewardSystem = null;
        parallelInitPromise = null;
        parallelPlan = null;
        isInitialized = false;
        parallelSampleCount = retainedSamples;

        await initializeLab(romBuffer, canvas);
        setLabSpeed(speed);
        currentMode = 'purerl';
        labMode.set('purerl');
        labEmulator?.stop();

        const trainer = await ensureParallelTrainer();
        restoreRewardLearningStates(trainer.agents, retainedRewardStates);
        restoreTrainingProgress(trainer, retainedProgress);
        trainer.start();
        labRunStatus.set({ running: true, recovering: false, error: null });
        feedSystem(`Parallel Train resumed automatically at sample ${trainer.totalSamples.toLocaleString()}.`);
        setTimeout(runPureRLLoop, trainingIntervalMs(labSpeed));
        return true;
    })().catch(error => {
        console.error('[Lab] Parallel Train recovery failed:', error);
        labRunStatus.set({ running: false, recovering: false, error: error.message });
        feedSystem(`Parallel Train recovery failed: ${error.message}`);
        return false;
    }).finally(() => {
        parallelRecoveryPromise = null;
    });

    return parallelRecoveryPromise;
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
    demonstrationActive = false;
    const demoStatus = labPureRLAgent?.core.getDemonstrationStatus()
        || { samples: 0, capacity: 8192, trainSteps: 0, loss: 0, accuracy: 0 };
    labDemonstration.set({ active: false, ...demoStatus });
    lastLearningAuditFeedBoundary = 0;

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
        valueLoss: 0,
        clipFraction: 0,
        intrinsicReward: 0,
        episode: 1,
        episodeSteps: 0,
        bestProgressScore: 0,
        checkpointCount: 0,
        confirmedWins: 0,
        environmentCount: parallelPlan?.workerCount ?? PARALLEL_ENVIRONMENT_COUNT,
        samplesPerSecond: 0,
        checkpointWorker: null,
        archiveSize: 0,
        archiveSelections: 0,
        autonomy: null,
        learningAudit: null,
        demonstration: demoStatus,
        workers: [],
        visibleWorker: 0,
        visibleState: null,
        memoryDiagnostics: null,
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
    parallelSampleCount = 0;
    parallelLifecycleStartSamples = 0;
    lastFatalParallelRecoveryAt = 0;
    isInitialized = false;
    currentMode = 'llm';
    demonstrationActive = false;
    labMode.set('llm');
    labDemonstration.set({ active: false, samples: 0, trainSteps: 0, loss: 0, accuracy: 0 });
    labRunStatus.set({ running: false, recovering: false, error: null });
}
