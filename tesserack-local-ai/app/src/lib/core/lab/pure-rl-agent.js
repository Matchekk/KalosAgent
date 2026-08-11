/**
 * Pure RL Agent - Browser-based PPO/GAE with deterministic Red++ rewards.
 *
 * Uses the hybrid architecture:
 *   - ReinforceCore: Pure RL math (act, observe, train)
 *   - RLRunner: Canonical loop (no forked logic)
 *   - PureRLAgent: UI/pacing wrapper (action repetition, frameSkip, metrics)
 *
 * Both Pokemon and the bandit test use the same RLRunner.step() -
 * this ensures the transition wiring is correct everywhere.
 */

import { ReinforceCore } from './reinforce-core.js';
import { RLRunner } from './rl-runner.js';
import { UnitTestRewards } from './unit-test-rewards.js';
import {
    copyReinforceState,
    createReinforceSnapshot,
    executeRepeatedAction,
    restoreReinforceSnapshot,
} from './training-utils.js';
import { compareProgressStates, progressScore } from './parallel-training.js';
import { analyzeRedppTeam } from './redpp-team-quality.js';
import {
    clearPureRLCheckpoint,
    getPureRLCheckpoint,
    setPureRLCheckpoint,
} from '../persistence.js';

// Every action needed to complete Red++. `start` is essential for booting the
// game and for party/item/save menus; the policy, not a controller, chooses it.
export const PURE_RL_ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start'];
export const REDPP_STATE_SIZE = 58;
export const REDPP_TRAINING_OBJECTIVE_VERSION = 'redpp-ppo-v3.8';
// v6 appends behavior memory to the observable Red++ features.
const TYPE_NAMES = [
    'NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST',
    'STEEL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON',
    'DARK', 'FAIRY', 'UNKNOWN',
];

function cloneProgressState(state = {}) {
    return {
        location: state.location || '',
        badgeCount: Number(state.badgeCount) || 0,
        party: (state.party || []).map(mon => ({
            speciesId: Number(mon?.speciesId) || 0,
            level: Number(mon?.level) || 0,
            type1: mon?.type1 || null,
            type2: mon?.type2 || null,
            moveIds: (mon?.moveIds || []).map(moveId => Number(moveId) || 0),
            moves: (mon?.moves || []).map(move => ({ id: Number(move?.id ?? move) || 0 })),
        })),
        progressFlags: { ...(state.progressFlags || {}) },
    };
}

/**
 * Encode game state into a fixed-size vector for the policy network.
 * Uses sin/cos for location hash to avoid ordering problems.
 */
export function encodeRedppStateInto(state, outVec, context = {}) {
    if (!state) {
        outVec.fill(0);
        return;
    }

    let i = 0;

    // Position (Game Boy maps use byte coordinates; clamp corrupt/title RAM).
    outVec[i++] = Math.min(1, (state.coordinates?.x ?? 0) / 64);
    outVec[i++] = Math.min(1, (state.coordinates?.y ?? 0) / 64);

    // Location: sin/cos of hash to avoid "map 200 > map 30" ordering problem
    const locHash = hashString(state.location || '');
    outVec[i++] = Math.sin(locHash);
    outVec[i++] = Math.cos(locHash);

    // Progress indicators
    outVec[i++] = (state.badgeCount ?? 0) / 8;
    outVec[i++] = (state.party?.length ?? 0) / 6;

    // Party stats and lead identity/types.
    if (state.party && state.party.length > 0) {
        const avgLevel = state.party.reduce((s, p) => s + (p.level || 0), 0) / state.party.length;
        outVec[i++] = avgLevel / 100;

        const totalHP = state.party.reduce((s, p) => s + (p.currentHP || 0), 0);
        const maxHP = state.party.reduce((s, p) => s + (p.maxHP || 1), 0);
        outVec[i++] = totalHP / Math.max(maxHP, 1);
        const lead = state.party[0];
        outVec[i++] = Math.max(...state.party.map(p => p.level || 0), 0) / 100;
        outVec[i++] = (lead.speciesId || 0) / 208;
        outVec[i++] = encodeType(lead.type1);
        outVec[i++] = encodeType(lead.type2);
    } else {
        for (let n = 0; n < 6; n++) outVec[i++] = 0;
    }

    // Battle/dialog state (binary)
    outVec[i++] = state.inBattle ? 1 : 0;
    outVec[i++] = (state.dialog && state.dialog.length > 0) ? 1 : 0;

    // Money (log scale, normalized)
    outVec[i++] = Math.log10((state.money || 0) + 1) / 6;

    // Durable Red++ event flags.
    outVec[i++] = state.progressFlags?.battledRivalInOaksLab ? 1 : 0;

    // Red++ battle structs: opponent, active mon, move calculation and menus.
    const battle = state.battle;
    if (battle) {
        outVec[i++] = (battle.battleType || 0) / 2;
        outVec[i++] = (battle.opponent?.speciesId || 0) / 208;
        outVec[i++] = (battle.opponent?.level || 0) / 100;
        outVec[i++] = ratio(battle.opponent?.currentHP, battle.opponent?.maxHP);
        outVec[i++] = encodeTypeId(battle.opponent?.type1Id);
        outVec[i++] = encodeTypeId(battle.opponent?.type2Id);
        outVec[i++] = (battle.active?.speciesId || 0) / 208;
        outVec[i++] = (battle.active?.level || 0) / 100;
        outVec[i++] = ratio(battle.active?.currentHP, battle.active?.maxHP);
        outVec[i++] = encodeTypeId(battle.active?.type1Id);
        outVec[i++] = encodeTypeId(battle.active?.type2Id);
        outVec[i++] = encodeTypeId(battle.lastMove?.typeId);
        outVec[i++] = (battle.lastMove?.power || 0) / 250;
        outVec[i++] = Math.min(1, (battle.lastMove?.damage || 0) / 500);
        outVec[i++] = encodeEffectiveness(battle.lastMove?.effectiveness);
        outVec[i++] = battle.lastMove?.stab ? 1 : 0;
        outVec[i++] = (battle.menu?.battleSelection || 0) / 3;
        outVec[i++] = (battle.menu?.moveListIndex || 0) / 3;
        outVec[i++] = (battle.active?.moves?.length || 0) / 4;
    } else {
        for (let n = 0; n < 19; n++) outVec[i++] = 0;
    }

    // Bounded full-team features let the policy distinguish merely having six
    // Pokemon from building a strong, balanced and complementary party.
    const team = analyzeRedppTeam(state.party);
    outVec[i++] = team.score;
    outVec[i++] = team.baseStats;
    outVec[i++] = team.levelBalance;
    outVec[i++] = team.typeDiversity;
    outVec[i++] = team.offensiveCoverage;
    outVec[i++] = team.defensiveResilience;

    // Optional menus must be distinguishable from the overworld. Appending
    // these inputs keeps old 41-feature snapshots exactly migratable.
    const menu = state.menu;
    outVec[i++] = menu?.open ? 1 : 0;
    outVec[i++] = menu?.open ? Math.min(1, (menu.currentItem || 0) / 15) : 0;
    outVec[i++] = menu?.open ? Math.min(1, (menu.listScrollOffset || 0) / 15) : 0;
    const menuAngle = menu?.open ? ((menu.screenHash >>> 0) / 0xffffffff) * Math.PI * 2 : 0;
    outVec[i++] = menu?.open ? Math.sin(menuAngle) : 0;
    outVec[i++] = menu?.open ? Math.cos(menuAngle) : 0;

    // Short-term memory distinguishes identical-looking frames after different
    // actions and exposes repetition/stagnation directly to the policy.
    const previousAction = PURE_RL_ACTIONS.indexOf(context.lastAction);
    for (let action = 0; action < PURE_RL_ACTIONS.length; action++) {
        outVec[i++] = action === previousAction ? 1 : 0;
    }
    outVec[i++] = Math.max(-1, Math.min(1, Number(context.deltaX) || 0));
    outVec[i++] = Math.max(-1, Math.min(1, Number(context.deltaY) || 0));
    outVec[i++] = Math.max(0, Math.min(1, Number(context.stagnation) || 0));
    outVec[i++] = Math.max(0, Math.min(1, (Number(context.actionStreak) || 0) / 16));
    outVec[i++] = Math.max(0, Math.min(1, Number(context.explorationProfile) || 0));

    // Pad remaining with zeros
    while (i < REDPP_STATE_SIZE) outVec[i++] = 0;
}

function ratio(value, max) {
    return max > 0 ? Math.max(0, Math.min(1, (value || 0) / max)) : 0;
}

function encodeType(name) {
    const index = TYPE_NAMES.indexOf(String(name || '').toUpperCase());
    return index >= 0 ? (index + 1) / TYPE_NAMES.length : 0;
}

function encodeTypeId(id) {
    return Number.isFinite(id) ? Math.min(1, (id + 1) / 32) : 0;
}

function encodeEffectiveness(value) {
    return ({ immune: -1, 'not very effective': -0.5, neutral: 0, 'super effective': 1 })[value] ?? 0;
}

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

/**
 * Pure RL Agent - Wraps ReinforceCore + RLRunner for Pokemon.
 *
 * Responsibilities:
 *   - Create Pokemon env interface for RLRunner
 *   - Handle action repetition for smoother movement
 *   - Handle frame pacing
 *   - Expose metrics for UI
 */
export class PureRLAgent {
    constructor(emulator, memoryReader, config = {}) {
        this.emu = emulator;
        this.mem = memoryReader;
        const { sharedCore = null, ...agentConfig } = config;
        this.workerId = Math.max(0, Math.trunc(Number(agentConfig.workerId) || 0));

        // Config - pacing/UI options
        this.config = {
            actionHoldFrames: agentConfig.actionHoldFrames ?? 12,
            frameSkip: agentConfig.frameSkip ?? 16,
            actionRepeat: agentConfig.actionRepeat ?? 1,
            releaseFrames: agentConfig.releaseFrames ?? 4,
            maxEpisodeSteps: agentConfig.maxEpisodeSteps ?? 4000,
            noProgressSteps: agentConfig.noProgressSteps ?? 900,
            resetFromInitial: agentConfig.resetFromInitial ?? false,
            rehearseEvery: agentConfig.rehearseEvery ?? 5,
            autoCheckpoint: agentConfig.autoCheckpoint ?? true,
            persistCheckpoint: agentConfig.persistCheckpoint ?? (this.workerId === 0),
            // Savestate creation is expensive in binjgb's fixed 16 MiB WASM
            // heap. A bounded sample of frontier cells is enough for Go-Explore
            // while preventing novel-tile discovery from exhausting the heap.
            archiveCaptureLimit: agentConfig.archiveCaptureLimit ?? 16,
            // PPO/GAE config
            rolloutSize: agentConfig.rolloutSize ?? 128,
            learningRate: agentConfig.learningRate ?? 0.0003,
            gamma: agentConfig.gamma ?? 0.995,
            gaeLambda: agentConfig.gaeLambda ?? 0.95,
            clipRatio: agentConfig.clipRatio ?? 0.2,
            updateEpochs: agentConfig.updateEpochs ?? 6,
            miniBatchSize: agentConfig.miniBatchSize ?? 64,
            valueCoefficient: agentConfig.valueCoefficient ?? 0.5,
            maxGradNorm: agentConfig.maxGradNorm ?? 0.5,
            intrinsicRewardScale: agentConfig.intrinsicRewardScale ?? 0.01,
            intrinsicRewardProfiles: agentConfig.intrinsicRewardProfiles ?? [0, 0.75, 1.5, 1],
            intrinsicLifelongFloor: agentConfig.intrinsicLifelongFloor ?? 0.25,
            normalizeReturns: agentConfig.normalizeReturns ?? true,
            entropyCoefficient: agentConfig.entropyCoefficient ?? 0.003,
            entropyTargetRatio: agentConfig.entropyTargetRatio ?? 0.6,
            maxEntropyCoefficient: agentConfig.maxEntropyCoefficient ?? 0.05,
            entropyResponseGain: agentConfig.entropyResponseGain ?? 4,
            actionCoverageCoefficient: agentConfig.actionCoverageCoefficient ?? 0.02,
            minimumActionProbability: agentConfig.minimumActionProbability ?? 0.01,
            ...agentConfig
        };

        // Unit test rewards
        this.rewards = new UnitTestRewards(agentConfig.rewards || {});

        // Create the Pokemon environment interface for RLRunner
        this.env = this._createEnv();

        // Create core (pure RL algorithm)
        this.core = sharedCore || new ReinforceCore({
            stateSize: REDPP_STATE_SIZE,
            numActions: PURE_RL_ACTIONS.length,
            rolloutSize: this.config.rolloutSize,
            learningRate: this.config.learningRate,
            gamma: this.config.gamma,
            gaeLambda: this.config.gaeLambda,
            clipRatio: this.config.clipRatio,
            updateEpochs: this.config.updateEpochs,
            miniBatchSize: this.config.miniBatchSize,
            valueCoefficient: this.config.valueCoefficient,
            maxGradNorm: this.config.maxGradNorm,
            intrinsicRewardScale: this.config.intrinsicRewardScale,
            intrinsicRewardProfiles: this.config.intrinsicRewardProfiles,
            intrinsicLifelongFloor: this.config.intrinsicLifelongFloor,
            normalizeReturns: this.config.normalizeReturns,
            entropyCoefficient: this.config.entropyCoefficient,
            entropyTargetRatio: this.config.entropyTargetRatio,
            maxEntropyCoefficient: this.config.maxEntropyCoefficient,
            entropyResponseGain: this.config.entropyResponseGain,
            actionCoverageCoefficient: this.config.actionCoverageCoefficient,
            minimumActionProbability: this.config.minimumActionProbability,
        });
        this.core.trainingObjectiveVersion = REDPP_TRAINING_OBJECTIVE_VERSION;

        // Create runner (canonical loop)
        this.runner = new RLRunner(this.core, this.env);

        // Last sampled action (repeats execute inside one observed transition)
        this.currentAction = null;

        // State tracking
        this.totalSteps = 0;
        this.totalReward = 0;
        this.running = false;
        this.lastStepResult = null;

        this.episode = 1;
        this.episodeSteps = 0;
        this.episodeReward = 0;
        this.lastProgressEpisodeStep = 0;
        this.bestProgressScore = -1;
        this.checkpointCount = 0;
        this.confirmedWins = 0;
        this.resetReason = null;
        this.pendingCheckpointCandidate = null;
        this.pendingArchiveCandidate = null;
        this.knownArchiveCells = new Set();
        this.archiveCaptureCount = 0;
        this.stableLocation = '';
        this.stableLocationSteps = 0;
        this.lastDeltaX = 0;
        this.lastDeltaY = 0;
        this.actionStreak = 0;
        this.lastBehaviorAction = null;

        // Checkpoint state for resets
        this.checkpointState = null;
        this.checkpointProgressState = null;
        this.initialState = null;
        this.explorationState = null;

        // Callbacks
        this.onStep = null;
    }

    /**
     * Create Pokemon environment interface for RLRunner
     * @private
     */
    _createEnv() {
        const self = this;

        return {
            ACTIONS: PURE_RL_ACTIONS,
            stateVec: new Float32Array(REDPP_STATE_SIZE),
            streamId: this.workerId,

            getState() {
                return self.mem.getGameState();
            },

            noveltyKey(gameState) {
                return self._noveltyKey(gameState);
            },

            encodeStateInto(gameState, outVec) {
                encodeRedppStateInto(gameState, outVec, self._behaviorContext());
            },

            async executeAction(actionStr) {
                await self._executeAction(actionStr);
            },

            rewardFn(prevState, nextState, action) {
                self.lastDeltaX = (nextState?.coordinates?.x ?? 0) - (prevState?.coordinates?.x ?? 0);
                self.lastDeltaY = (nextState?.coordinates?.y ?? 0) - (prevState?.coordinates?.y ?? 0);
                self.actionStreak = action === self.lastBehaviorAction ? self.actionStreak + 1 : 1;
                self.lastBehaviorAction = action;
                return self.rewards.evaluate(prevState, nextState, action);
            },

            checkDone(prevState, nextState) {
                return self._checkDone(prevState, nextState);
            },

            async resetEnv() {
                await self._resetEnv();
            },
        };
    }

    _behaviorContext() {
        return {
            lastAction: this.lastBehaviorAction,
            deltaX: this.lastDeltaX,
            deltaY: this.lastDeltaY,
            stagnation: this.config.noProgressSteps > 0
                ? (this.episodeSteps - this.lastProgressEpisodeStep) / this.config.noProgressSteps
                : 0,
            actionStreak: this.actionStreak,
            explorationProfile: Math.min(1, this.workerId / 3),
        };
    }

    _noveltyKey(state) {
        const location = String(state?.location || 'NO ACTIVE MAP');
        const x = Math.trunc(Number(state?.coordinates?.x) || 0);
        const y = Math.trunc(Number(state?.coordinates?.y) || 0);
        const context = state?.inBattle ? 'battle' : (state?.menu?.open ? 'menu' : (state?.dialog ? 'dialog' : 'world'));
        const battle = state?.battle;
        const screen = state?.menu?.open ? (state.menu.screenHash >>> 0) : 0;
        const dialogHash = state?.dialog ? hashString(state.dialog) : 0;
        return [
            location, x, y, context, screen, dialogHash,
            Number(state?.badgeCount) || 0,
            state?.party?.length || 0,
            battle?.opponent?.speciesId || 0,
            Math.ceil((battle?.opponent?.currentHP || 0) / 4),
        ].join('|');
    }

    /**
     * Execute an action on the emulator with frame pacing
     * @private
     */
    async _executeAction(action) {
        await executeRepeatedAction(this.emu, action, this.config);
    }

    /**
     * Execute and learn one human-demonstrated action. This deliberately does
     * not touch the PPO rollout or autonomy/checkpoint proof: the transition is
     * off-policy expert data and is trained with behavior cloning instead.
     */
    async demonstrate(action) {
        const actionIdx = PURE_RL_ACTIONS.indexOf(action);
        if (actionIdx < 0) throw new Error(`Unsupported demonstration action: ${action}`);

        const prevState = this.mem.getGameState();
        const stateVec = new Float32Array(REDPP_STATE_SIZE);
        encodeRedppStateInto(prevState, stateVec, this._behaviorContext());
        await this._executeAction(action);
        // Headless PPO workers intentionally skip rendering, but Teach mode is
        // a visible human session and must show the exact post-action frame.
        this.emu.render?.();
        this.emu.frameCallback?.();
        const nextState = this.mem.getGameState();
        const rewardResult = this.env.rewardFn(prevState, nextState, action);
        const reward = Number(rewardResult?.total) || 0;

        this.core.observeDemonstration(stateVec, actionIdx, reward);
        this.currentAction = action;
        this.totalSteps++;
        this.totalReward += reward;
        this.episodeSteps++;
        this.episodeReward += reward;
        this.lastStepResult = {
            actionIdx,
            actionStr: action,
            reward,
            breakdown: rewardResult?.breakdown || {},
            firedTests: rewardResult?.firedTests || [],
            context: rewardResult?.context,
            matrixVersion: rewardResult?.matrixVersion,
            done: false,
        };

        let demonstrationTraining = null;
        if (this.core.demonstrationLength % 32 === 0) {
            demonstrationTraining = this.core.trainDemonstrations({ epochs: 3, coefficient: 1 });
        }
        return {
            ...this.lastStepResult,
            nextState,
            demonstration: this.core.getDemonstrationStatus(),
            demonstrationTraining,
        };
    }

    /** Advance a boot/fade animation without creating a false expert label. */
    advanceDemonstration(frames = 20) {
        const neutralFrames = Math.max(1, Math.trunc(frames || 1));
        for (const button of ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select']) {
            this.emu.setButton(button, false);
        }
        for (let frame = 0; frame < neutralFrames; frame++) this.emu.runFrame();
        this.emu.render?.();
        this.emu.frameCallback?.();
    }

    /** Finish an expert episode with a stronger supervised consolidation pass. */
    finishDemonstration() {
        return this.core.trainDemonstrations({ epochs: 8, coefficient: 1 });
    }

    /**
     * Check if episode should end (whiteout)
     * @private
     */
    _checkDone(prevState, currState) {
        this.episodeSteps++;
        if (currState?.location && currState.location === this.stableLocation) {
            this.stableLocationSteps++;
        } else {
            this.stableLocation = currState?.location || '';
            this.stableLocationSteps = 1;
        }
        const progressScore = this._progressScore(currState);
        const archiveKey = this._archiveCellKey(currState);
        if (archiveKey && !this.knownArchiveCells.has(archiveKey)) {
            this.knownArchiveCells.add(archiveKey);
            // A multi-day browser session must not accumulate an unbounded
            // Set. The coordinator keeps the strongest restorable cells.
            if (this.knownArchiveCells.size > 4096) {
                this.knownArchiveCells.delete(this.knownArchiveCells.values().next().value);
            }
            const archiveCaptureLimit = Math.max(0,
                Math.trunc(Number(this.config.archiveCaptureLimit) || 0));
            if (this.archiveCaptureCount < archiveCaptureLimit) {
                this.pendingArchiveCandidate = {
                    key: archiveKey,
                    workerId: this.workerId,
                    steps: this.totalSteps + 1,
                    state: cloneProgressState(currState),
                    checkpoint: this.emu.saveState(),
                };
                this.archiveCaptureCount++;
            }
        }
        const progressBaseline = this.checkpointProgressState || prevState;
        const locationOnlyProgress = this._isLocationOnlyProgress(progressBaseline, currState);
        const stableEnough = !locationOnlyProgress || this.stableLocationSteps >= 3;
        if (progressScore > this.bestProgressScore && stableEnough) {
            this.bestProgressScore = progressScore;
            this.lastProgressEpisodeStep = this.episodeSteps;
            // Starter, rival, level and badge milestones become curriculum
            // checkpoints. No action is supplied: the policy earned the state.
            if (this.checkpointState && this._isDurableProgress(progressBaseline, currState)) {
                this.pendingCheckpointCandidate = {
                    workerId: this.workerId,
                    steps: this.totalSteps + 1,
                    episodeSteps: this.episodeSteps,
                    state: currState,
                    checkpoint: this.emu.saveState(),
                };
                if (this.config.autoCheckpoint) this.saveCheckpoint(currState);
            }
        }

        // Whiteout: all Pokemon fainted
        // IMPORTANT: .every() returns true on empty array
        const party = currState.party;
        if (party && party.length > 0 && party.every(p => p.currentHP === 0)) {
            this.resetReason = 'whiteout';
            return true;
        }
        if (this.episodeSteps >= this.config.maxEpisodeSteps) {
            this.resetReason = 'episode_limit';
            return true;
        }
        if (this.episodeSteps - this.lastProgressEpisodeStep >= this.config.noProgressSteps) {
            this.resetReason = 'no_progress';
            return true;
        }
        return false;
    }

    /**
     * Reset environment (load checkpoint or settle)
     * @private
     */
    async _resetEnv() {
        const rehearseEvery = Math.max(0, Math.trunc(Number(this.config.rehearseEvery) || 0));
        const rehearseFromStart = this.config.resetFromInitial
            || (rehearseEvery > 0 && this.episode % rehearseEvery === 0);
        const state = rehearseFromStart
            ? this.initialState
            : (this.explorationState || this.checkpointState);
        this.explorationState = null;
        this.rewards.resetEpisodeState();
        if (state) {
            this.emu.loadState(state);
            // Settle frames after state load
            for (let i = 0; i < 4; i++) {
                this.emu.runFrame();
            }
        }
        this.episode++;
        this.episodeSteps = 0;
        this.episodeReward = 0;
        this.lastProgressEpisodeStep = 0;
        this.stableLocation = '';
        this.stableLocationSteps = 0;
        this.lastDeltaX = 0;
        this.lastDeltaY = 0;
        this.actionStreak = 0;
        this.lastBehaviorAction = null;
    }

    /**
     * Execute one RL step (with action repetition for smooth movement)
     */
    async step() {
        // Run canonical RL step via runner
        const result = await this.runner.step();

        // Track the action selected for this complete transition
        this.currentAction = result.actionStr;

        // Update totals
        this.totalSteps++;
        this.totalReward += result.reward;
        this.episodeReward += result.reward;
        this.lastStepResult = result;
        if (result.firedTests?.some(test => test.id === 'redpp_battle_won')) {
            this.confirmedWins++;
        }

        // Get test bundle stats
        const rewardStats = this.rewards.getStats();

        // Callback with full metrics
        if (this.onStep) {
            this.onStep({
                step: this.totalSteps,
                action: result.actionStr,
                reward: result.reward,
                breakdown: result.breakdown,
                firedTests: result.firedTests,
                context: result.context,
                matrixVersion: result.matrixVersion,
                done: result.done,
                totalReward: this.totalReward,
                // Test bundle metrics
                currentLocation: result.currentLocation || rewardStats.currentLocation,
                bundleInfo: result.bundleInfo || rewardStats.bundleInfo,
                totalRewards: rewardStats.totalRewards,
                completedObjectives: rewardStats.completedObjectives,
                teamQuality: rewardStats.teamQuality,
                // Training metrics
                trainSteps: this.core.trainSteps,
                bufferFill: this.core.buffer.length,
                bufferSize: this.config.rolloutSize,
                avgRawReturn: this.core.lastAvgRawReturn,
                policyEntropy: this.core.lastEntropy,
                trainInfo: result.trainInfo,
                episode: this.episode,
                episodeSteps: this.episodeSteps,
                bestProgressScore: this.bestProgressScore,
                checkpointCount: this.checkpointCount,
                confirmedWins: this.confirmedWins,
            });
        }

        return result;
    }

    /**
     * Run the agent loop
     */
    async run(stepCallback = null) {
        this.running = true;
        this.onStep = stepCallback;

        while (this.running) {
            await this.step();

            // Small delay to allow UI updates
            await new Promise(r => setTimeout(r, 1));
        }
    }

    /**
     * Stop the agent
     */
    stop() {
        this.running = false;
    }

    /**
     * Reset the agent state (does NOT reset policy weights)
     */
    reset() {
        this.totalSteps = 0;
        this.totalReward = 0;
        this.currentAction = null;
        this.lastStepResult = null;
        this.episodeSteps = 0;
        this.episodeReward = 0;
        this.lastProgressEpisodeStep = 0;
        this.stableLocation = '';
        this.stableLocationSteps = 0;
        this.lastDeltaX = 0;
        this.lastDeltaY = 0;
        this.actionStreak = 0;
        this.lastBehaviorAction = null;
        this.rewards.reset();
        // Note: Core (policy weights, buffer) is NOT reset
        // Call resetFull() to also reset learning
    }

    /**
     * Full reset including policy weights
     */
    resetFull() {
        this.reset();
        // Recreate core to reset weights
        this.core = new ReinforceCore({
            stateSize: REDPP_STATE_SIZE,
            numActions: PURE_RL_ACTIONS.length,
            rolloutSize: this.config.rolloutSize,
            learningRate: this.config.learningRate,
            gamma: this.config.gamma,
            gaeLambda: this.config.gaeLambda,
            clipRatio: this.config.clipRatio,
            updateEpochs: this.config.updateEpochs,
            miniBatchSize: this.config.miniBatchSize,
            valueCoefficient: this.config.valueCoefficient,
            maxGradNorm: this.config.maxGradNorm,
            intrinsicRewardScale: this.config.intrinsicRewardScale,
            intrinsicRewardProfiles: this.config.intrinsicRewardProfiles,
            intrinsicLifelongFloor: this.config.intrinsicLifelongFloor,
            normalizeReturns: this.config.normalizeReturns,
            entropyCoefficient: this.config.entropyCoefficient,
            entropyTargetRatio: this.config.entropyTargetRatio,
            maxEntropyCoefficient: this.config.maxEntropyCoefficient,
            entropyResponseGain: this.config.entropyResponseGain,
            actionCoverageCoefficient: this.config.actionCoverageCoefficient,
            minimumActionProbability: this.config.minimumActionProbability,
        });
        this.runner = new RLRunner(this.core, this.env);
    }

    /**
     * Save current emulator state as checkpoint for resets
     */
    saveCheckpoint(state = this.mem.getGameState()) {
        this.checkpointState = this.emu.saveState();
        this.checkpointProgressState = cloneProgressState(state);
        if (!this.initialState) this.initialState = this.checkpointState.slice();
        this.bestProgressScore = Math.max(this.bestProgressScore, this._progressScore(state));
        this.checkpointCount++;
        if (this.config.persistCheckpoint) void this._persistCheckpoint();
    }

    ensureCheckpoint() {
        if (!this.checkpointState) this.saveCheckpoint();
    }

    _progressScore(state) {
        return progressScore(state);
    }

    _isDurableProgress(prev, curr) {
        return compareProgressStates(curr, prev) > 0;
    }

    _isLocationOnlyProgress(prev, curr) {
        if (!this._isDurableProgress(prev, curr)) return false;
        const withoutLocation = state => ({ ...state, location: prev?.location });
        return compareProgressStates(withoutLocation(curr), withoutLocation(prev)) === 0;
    }

    async _persistCheckpoint() {
        if (typeof indexedDB === 'undefined' || !this.checkpointState) return;
        const saved = await setPureRLCheckpoint({
                version: 4,
                savedAt: new Date().toISOString(),
                progressScore: this.bestProgressScore,
                progressState: this.checkpointProgressState,
                state: this.checkpointState.slice(),
            });
        if (!saved) console.warn('[PureRLAgent] Could not persist curriculum checkpoint.');
    }

    setInitialState(stateBytes) {
        if (!(stateBytes instanceof Uint8Array)) throw new Error('Initial state must be Uint8Array');
        this.initialState = stateBytes.slice();
    }

    adoptCheckpoint(stateBytes, stateOrScore, { persist = false, count = false } = {}) {
        if (!(stateBytes instanceof Uint8Array)) throw new Error('Checkpoint must be Uint8Array');
        this.checkpointState = stateBytes.slice();
        const score = typeof stateOrScore === 'number' ? stateOrScore : this._progressScore(stateOrScore);
        if (typeof stateOrScore !== 'number') this.checkpointProgressState = cloneProgressState(stateOrScore);
        this.bestProgressScore = Math.max(this.bestProgressScore, Number(score) || 0);
        if (count) this.checkpointCount++;
        if (persist && this.config.persistCheckpoint) void this._persistCheckpoint();
    }

    loadCheckpointIntoEnvironment() {
        if (!this.checkpointState) return false;
        this.emu.loadState(this.checkpointState);
        for (let frame = 0; frame < 4; frame++) this.emu.runFrame();
        return true;
    }

    consumeCheckpointCandidate() {
        const candidate = this.pendingCheckpointCandidate;
        this.pendingCheckpointCandidate = null;
        return candidate;
    }

    consumeArchiveCandidate() {
        const candidate = this.pendingArchiveCandidate;
        this.pendingArchiveCandidate = null;
        return candidate;
    }

    adoptExplorationState(stateBytes) {
        if (!(stateBytes instanceof Uint8Array)) return false;
        this.explorationState = stateBytes.slice();
        return true;
    }

    _archiveCellKey(state) {
        const location = String(state?.location || '');
        const x = Number(state?.coordinates?.x);
        const y = Number(state?.coordinates?.y);
        if (!location || location === 'NO ACTIVE MAP' || !Number.isFinite(x) || !Number.isFinite(y)) return '';
        if (state?.inBattle || state?.dialog || state?.menu?.open) return '';
        return [
            location,
            Math.trunc(x),
            Math.trunc(y),
            Number(state?.badgeCount) || 0,
            state?.party?.length || 0,
            state?.progressFlags?.battledRivalInOaksLab ? 1 : 0,
        ].join('|');
    }

    setSharedCore(core) {
        if (!core || core.stateSize !== REDPP_STATE_SIZE || core.numActions !== PURE_RL_ACTIONS.length) {
            throw new Error('Incompatible shared PPO/GAE core');
        }
        this.core = core;
        this.runner = new RLRunner(this.core, this.env);
    }

    async restorePersistedCheckpoint() {
        if (typeof indexedDB === 'undefined') return;
        try {
            const saved = await getPureRLCheckpoint();
            if (saved?.version !== 4 || !saved.state) return;
            const bytes = saved.state instanceof Uint8Array
                ? saved.state
                : new Uint8Array(saved.state);
            this.checkpointState = bytes;
            this.bestProgressScore = Number(saved.progressScore) || 0;
            this.checkpointProgressState = saved.progressState
                ? cloneProgressState(saved.progressState)
                : null;
            this.checkpointCount = 1;
        } catch (error) {
            console.warn('[PureRLAgent] Ignoring invalid curriculum checkpoint:', error.message);
            await clearPureRLCheckpoint();
        }
    }

    /**
     * Get current metrics for UI
     */
    getMetrics() {
        return {
            // Step metrics
            totalSteps: this.totalSteps,
            totalReward: this.totalReward,
            lastAction: this.currentAction,
            lastReward: this.lastStepResult?.reward ?? 0,
            lastBreakdown: this.lastStepResult?.breakdown ?? {},

            // Training metrics
            trainSteps: this.core.trainSteps,
            bufferFill: this.core.buffer.length,
            bufferSize: this.config.rolloutSize,
            avgRawReturn: this.core.lastAvgRawReturn,
            policyEntropy: this.core.lastEntropy,
            episode: this.episode,
            episodeSteps: this.episodeSteps,
            episodeReward: this.episodeReward,
            bestProgressScore: this.bestProgressScore,
            checkpointCount: this.checkpointCount,
            confirmedWins: this.confirmedWins,
            resetReason: this.resetReason,
            demonstration: this.core.getDemonstrationStatus(),

            // Reward stats
            rewardStats: this.rewards.getStats(),
        };
    }

    /**
     * Get policy probabilities for current state (for debugging/visualization)
     */
    getPolicyProbs() {
        const state = this.mem.getGameState();
        const stateVec = new Float32Array(REDPP_STATE_SIZE);
        encodeRedppStateInto(state, stateVec, this._behaviorContext());
        return this.core.getProbs(stateVec);
    }

    /** Export the learned policy for local autosave and backup. */
    exportPolicy() {
        return createReinforceSnapshot(this.core);
    }

    /** Restore a compatible learned policy. Partial rollouts are intentionally not restored. */
    loadPolicy(snapshot) {
        return restoreReinforceSnapshot(this.core, snapshot);
    }

    /**
     * Update hyperparameters. Takes effect on next rollout boundary.
     * @param {Object} newConfig - { learningRate, rolloutSize, gamma }
     */
    updateConfig(newConfig) {
        const needsBufferResize = newConfig.rolloutSize && newConfig.rolloutSize !== this.config.rolloutSize;

        // Update local config
        if (newConfig.learningRate !== undefined) {
            this.config.learningRate = newConfig.learningRate;
        }
        if (newConfig.gamma !== undefined) {
            this.config.gamma = newConfig.gamma;
        }
        if (newConfig.rolloutSize !== undefined) {
            this.config.rolloutSize = newConfig.rolloutSize;
        }

        // Update core's learning rate (takes effect immediately)
        if (newConfig.learningRate !== undefined) {
            this.core.learningRate = newConfig.learningRate;
        }
        if (newConfig.gamma !== undefined) {
            this.core.gamma = newConfig.gamma;
        }

        // If rollout size changed, need to recreate core (buffer resizing)
        if (needsBufferResize) {
            // Preserve current policy weights and metrics while discarding the
            // partial rollout, whose capacity no longer matches.
            const oldCore = this.core;

            // Create new core with new buffer size
            this.core = new ReinforceCore({
                stateSize: REDPP_STATE_SIZE,
                numActions: PURE_RL_ACTIONS.length,
                rolloutSize: this.config.rolloutSize,
                learningRate: this.config.learningRate,
                gamma: this.config.gamma,
                gaeLambda: this.config.gaeLambda,
                clipRatio: this.config.clipRatio,
                updateEpochs: this.config.updateEpochs,
                miniBatchSize: this.config.miniBatchSize,
                valueCoefficient: this.config.valueCoefficient,
                maxGradNorm: this.config.maxGradNorm,
                intrinsicRewardScale: this.config.intrinsicRewardScale,
                intrinsicRewardProfiles: this.config.intrinsicRewardProfiles,
                intrinsicLifelongFloor: this.config.intrinsicLifelongFloor,
                normalizeReturns: this.config.normalizeReturns,
                entropyCoefficient: this.config.entropyCoefficient,
                entropyTargetRatio: this.config.entropyTargetRatio,
                maxEntropyCoefficient: this.config.maxEntropyCoefficient,
                entropyResponseGain: this.config.entropyResponseGain,
                actionCoverageCoefficient: this.config.actionCoverageCoefficient,
                minimumActionProbability: this.config.minimumActionProbability,
            });

            copyReinforceState(oldCore, this.core);

            // Reconnect runner
            this.runner = new RLRunner(this.core, this.env);
        }

        console.log('[PureRLAgent] Config updated:', this.config);
    }
}

export default PureRLAgent;
