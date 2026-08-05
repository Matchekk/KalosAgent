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

// Available actions
const ACTIONS = ['up', 'down', 'left', 'right', 'a', 'b'];

/**
 * Encode game state into a fixed-size vector for the policy network.
 * Uses sin/cos for location hash to avoid ordering problems.
 */
function encodeStateInto(state, outVec) {
    if (!state) {
        outVec.fill(0);
        return;
    }

    let i = 0;

    // Position (normalized by max map size)
    outVec[i++] = (state.coordinates?.x ?? 0) / 256;
    outVec[i++] = (state.coordinates?.y ?? 0) / 256;

    // Location: sin/cos of hash to avoid "map 200 > map 30" ordering problem
    const locHash = hashString(state.location || '');
    outVec[i++] = Math.sin(locHash);
    outVec[i++] = Math.cos(locHash);

    // Progress indicators
    outVec[i++] = (state.badgeCount ?? 0) / 8;
    outVec[i++] = (state.party?.length ?? 0) / 6;

    // Party stats
    if (state.party && state.party.length > 0) {
        const avgLevel = state.party.reduce((s, p) => s + (p.level || 0), 0) / state.party.length;
        outVec[i++] = avgLevel / 100;

        const totalHP = state.party.reduce((s, p) => s + (p.currentHP || 0), 0);
        const maxHP = state.party.reduce((s, p) => s + (p.maxHP || 1), 0);
        outVec[i++] = totalHP / Math.max(maxHP, 1);
    } else {
        outVec[i++] = 0;
        outVec[i++] = 0;
    }

    // Battle/dialog state (binary)
    outVec[i++] = state.inBattle ? 1 : 0;
    outVec[i++] = (state.dialog && state.dialog.length > 0) ? 1 : 0;

    // Money (log scale, normalized)
    outVec[i++] = Math.log10((state.money || 0) + 1) / 6;

    // Pad remaining with zeros
    while (i < 16) outVec[i++] = 0;
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
            actionRepeat: config.actionRepeat ?? 3,
            // REINFORCE config
            rolloutSize: config.rolloutSize ?? 128,
            learningRate: config.learningRate ?? 0.001,
            gamma: config.gamma ?? 0.99,
            normalizeReturns: config.normalizeReturns ?? true,
            ...config
        };

        // Unit test rewards
        this.rewards = new UnitTestRewards(config.rewards || {});

        // Create the Pokemon environment interface for RLRunner
        this.env = this._createEnv();

        // Create core (pure RL algorithm)
        this.core = new ReinforceCore({
            stateSize: 16,
            numActions: ACTIONS.length,
            rolloutSize: this.config.rolloutSize,
            learningRate: this.config.learningRate,
            gamma: this.config.gamma,
            normalizeReturns: this.config.normalizeReturns,
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

        // Checkpoint state for resets
        this.checkpointState = null;

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
            ACTIONS,
            stateVec: new Float32Array(16),

            getState() {
                return self.mem.getGameState();
            },

            encodeStateInto(gameState, outVec) {
                encodeStateInto(gameState, outVec);
            },

            async executeAction(actionStr) {
                await self._executeAction(actionStr);
            },

            rewardFn(prevState, nextState) {
                return self.rewards.evaluate(prevState, nextState);
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
        // Whiteout: all Pokemon fainted
        // IMPORTANT: .every() returns true on empty array
        const party = currState.party;
        if (party && party.length > 0 && party.every(p => p.currentHP === 0)) {
            return true;
        }
        return false;
    }

    /**
     * Reset environment (load checkpoint or settle)
     * @private
     */
    async _resetEnv() {
        if (this.checkpointState) {
            this.emu.loadState(this.checkpointState);
            // Settle frames after state load
            for (let i = 0; i < 4; i++) {
                this.emu.runFrame();
            }
        }
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
        this.lastStepResult = result;

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
            stateSize: 16,
            numActions: ACTIONS.length,
            rolloutSize: this.config.rolloutSize,
            learningRate: this.config.learningRate,
            gamma: this.config.gamma,
            normalizeReturns: this.config.normalizeReturns,
        });
        this.runner = new RLRunner(this.core, this.env);
    }

    /**
     * Save current emulator state as checkpoint for resets
     */
    saveCheckpoint() {
        this.checkpointState = this.emu.saveState();
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

            // Reward stats
            rewardStats: this.rewards.getStats(),
        };
    }

    /**
     * Get policy probabilities for current state (for debugging/visualization)
     */
    getPolicyProbs() {
        const state = this.mem.getGameState();
        const stateVec = new Float32Array(16);
        encodeStateInto(state, stateVec);
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
                stateSize: 16,
                numActions: ACTIONS.length,
                rolloutSize: this.config.rolloutSize,
                learningRate: this.config.learningRate,
                gamma: this.config.gamma,
                normalizeReturns: this.config.normalizeReturns,
            });

            copyReinforceState(oldCore, this.core);

            // Reconnect runner
            this.runner = new RLRunner(this.core, this.env);
        }

        console.log('[PureRLAgent] Config updated:', this.config);
    }
}

export default PureRLAgent;
