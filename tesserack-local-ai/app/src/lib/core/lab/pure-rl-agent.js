/**
 * Pure RL Agent - Browser-based REINFORCE with unit test rewards.
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

// Every action needed to complete Red++. `start` is essential for booting the
// game and for party/item/save menus; the policy, not a controller, chooses it.
export const PURE_RL_ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start'];
export const REDPP_STATE_SIZE = 36;
const CHECKPOINT_KEY = 'tesserack-redpp-train-checkpoint-v2';
const TYPE_NAMES = [
    'NORMAL', 'FIGHTING', 'FLYING', 'POISON', 'GROUND', 'ROCK', 'BUG', 'GHOST',
    'STEEL', 'FIRE', 'WATER', 'GRASS', 'ELECTRIC', 'PSYCHIC', 'ICE', 'DRAGON',
    'DARK', 'FAIRY', 'UNKNOWN',
];

/**
 * Encode game state into a fixed-size vector for the policy network.
 * Uses sin/cos for location hash to avoid ordering problems.
 */
export function encodeRedppStateInto(state, outVec) {
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

        // Config - pacing/UI options
        this.config = {
            actionHoldFrames: config.actionHoldFrames ?? 12,
            frameSkip: config.frameSkip ?? 16,
            actionRepeat: config.actionRepeat ?? 1,
            maxEpisodeSteps: config.maxEpisodeSteps ?? 4000,
            noProgressSteps: config.noProgressSteps ?? 900,
            // REINFORCE config
            rolloutSize: config.rolloutSize ?? 128,
            learningRate: config.learningRate ?? 0.001,
            gamma: config.gamma ?? 0.99,
            normalizeReturns: config.normalizeReturns ?? true,
            entropyCoefficient: config.entropyCoefficient ?? 0.01,
            ...config
        };

        // Unit test rewards
        this.rewards = new UnitTestRewards(config.rewards || {});

        // Create the Pokemon environment interface for RLRunner
        this.env = this._createEnv();

        // Create core (pure RL algorithm)
        this.core = new ReinforceCore({
            stateSize: REDPP_STATE_SIZE,
            numActions: PURE_RL_ACTIONS.length,
            rolloutSize: this.config.rolloutSize,
            learningRate: this.config.learningRate,
            gamma: this.config.gamma,
            normalizeReturns: this.config.normalizeReturns,
            entropyCoefficient: this.config.entropyCoefficient,
        });

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

        // Checkpoint state for resets
        this.checkpointState = null;
        this.initialState = null;
        this._restorePersistedCheckpoint();

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

            getState() {
                return self.mem.getGameState();
            },

            encodeStateInto(gameState, outVec) {
                encodeRedppStateInto(gameState, outVec);
            },

            async executeAction(actionStr) {
                await self._executeAction(actionStr);
            },

            rewardFn(prevState, nextState, action) {
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

    /**
     * Execute an action on the emulator with frame pacing
     * @private
     */
    async _executeAction(action) {
        await executeRepeatedAction(this.emu, action, this.config);
    }

    /**
     * Check if episode should end (whiteout)
     * @private
     */
    _checkDone(prevState, currState) {
        this.episodeSteps++;
        const progressScore = this._progressScore(currState);
        if (progressScore > this.bestProgressScore) {
            this.bestProgressScore = progressScore;
            this.lastProgressEpisodeStep = this.episodeSteps;
            // Starter, rival, level and badge milestones become curriculum
            // checkpoints. No action is supplied: the policy earned the state.
            if (this.checkpointState && this._isDurableProgress(prevState, currState)) {
                this.saveCheckpoint(currState);
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
        const rehearseFromStart = this.episode % 5 === 0 && this.initialState;
        const state = rehearseFromStart ? this.initialState : this.checkpointState;
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
        if (result.firedTests?.some(test => test.id === 'redpp_battle_progress' && test.reward >= 20)) {
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
                done: result.done,
                totalReward: this.totalReward,
                // Test bundle metrics
                currentLocation: result.currentLocation || rewardStats.currentLocation,
                bundleInfo: result.bundleInfo || rewardStats.bundleInfo,
                totalRewards: rewardStats.totalRewards,
                completedObjectives: rewardStats.completedObjectives,
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
            normalizeReturns: this.config.normalizeReturns,
            entropyCoefficient: this.config.entropyCoefficient,
        });
        this.runner = new RLRunner(this.core, this.env);
    }

    /**
     * Save current emulator state as checkpoint for resets
     */
    saveCheckpoint(state = this.mem.getGameState()) {
        this.checkpointState = this.emu.saveState();
        if (!this.initialState) this.initialState = this.checkpointState.slice();
        this.bestProgressScore = Math.max(this.bestProgressScore, this._progressScore(state));
        this.checkpointCount++;
        this._persistCheckpoint();
    }

    ensureCheckpoint() {
        if (!this.checkpointState) this.saveCheckpoint();
    }

    _progressScore(state) {
        if (!state) return 0;
        const party = state.party || [];
        const totalLevels = party.reduce((sum, mon) => sum + (mon.level || 0), 0);
        const champion = ['HALL OF FAME', 'CHAMPIONS ROOM'].includes(state.location) ? 10_000_000 : 0;
        return champion + (state.badgeCount || 0) * 1_000_000
            + (state.progressFlags?.battledRivalInOaksLab ? 100_000 : 0)
            + party.length * 20_000
            + totalLevels * 100;
    }

    _isDurableProgress(prev, curr) {
        const prevParty = prev?.party || [];
        const currParty = curr?.party || [];
        const prevLevels = prevParty.reduce((sum, mon) => sum + (mon.level || 0), 0);
        const currLevels = currParty.reduce((sum, mon) => sum + (mon.level || 0), 0);
        return (curr?.badgeCount || 0) > (prev?.badgeCount || 0)
            || currParty.length > prevParty.length
            || currLevels > prevLevels
            || Boolean(curr?.progressFlags?.battledRivalInOaksLab)
                && !prev?.progressFlags?.battledRivalInOaksLab
            || ['HALL OF FAME', 'CHAMPIONS ROOM'].includes(curr?.location)
                && curr?.location !== prev?.location;
    }

    _persistCheckpoint() {
        if (typeof localStorage === 'undefined' || typeof btoa === 'undefined' || !this.checkpointState) return;
        try {
            let binary = '';
            for (let i = 0; i < this.checkpointState.length; i += 8192) {
                binary += String.fromCharCode(...this.checkpointState.subarray(i, i + 8192));
            }
            localStorage.setItem(CHECKPOINT_KEY, JSON.stringify({
                version: 2,
                savedAt: new Date().toISOString(),
                progressScore: this.bestProgressScore,
                state: btoa(binary),
            }));
        } catch (error) {
            console.warn('[PureRLAgent] Could not persist curriculum checkpoint:', error.message);
        }
    }

    _restorePersistedCheckpoint() {
        if (typeof localStorage === 'undefined' || typeof atob === 'undefined') return;
        try {
            const saved = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) || 'null');
            if (saved?.version !== 2 || !saved.state) return;
            const binary = atob(saved.state);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            this.checkpointState = bytes;
            this.bestProgressScore = Number(saved.progressScore) || 0;
            this.checkpointCount = 1;
        } catch (error) {
            console.warn('[PureRLAgent] Ignoring invalid curriculum checkpoint:', error.message);
            localStorage.removeItem(CHECKPOINT_KEY);
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
        encodeRedppStateInto(state, stateVec);
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
                normalizeReturns: this.config.normalizeReturns,
                entropyCoefficient: this.config.entropyCoefficient,
            });

            copyReinforceState(oldCore, this.core);

            // Reconnect runner
            this.runner = new RLRunner(this.core, this.env);
        }

        console.log('[PureRLAgent] Config updated:', this.config);
    }
}

export default PureRLAgent;
