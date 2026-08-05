// data-collector.js - Automated and human demonstration data collection

import { RewardCalculator } from './reward-calculator.js';
import { ExperienceBuffer } from './experience-buffer.js';

/**
 * Random exploration policy weights
 * Biased toward movement to explore the world
 */
const EXPLORATION_WEIGHTS = {
    up: 20,
    down: 20,
    left: 20,
    right: 20,
    a: 15,      // Interact/confirm
    b: 5,       // Cancel (less frequent)
    // No start/select - avoid menus
};

const ACTIONS = Object.keys(EXPLORATION_WEIGHTS);
const TOTAL_WEIGHT = Object.values(EXPLORATION_WEIGHTS).reduce((a, b) => a + b, 0);

/**
 * Pick a weighted random action
 */
function randomAction() {
    let rand = Math.random() * TOTAL_WEIGHT;
    for (const [action, weight] of Object.entries(EXPLORATION_WEIGHTS)) {
        rand -= weight;
        if (rand <= 0) return action;
    }
    return 'a';
}

/**
 * Smart random action based on context
 */
function smartRandomAction(state) {
    // In battle: mostly 'a' with some up/down for move selection
    if (state.inBattle) {
        const r = Math.random();
        if (r < 0.6) return 'a';
        if (r < 0.75) return 'up';
        if (r < 0.9) return 'down';
        return 'b';
    }

    // Dialog showing: advance it
    if (state.dialog && state.dialog.trim().length > 0) {
        return Math.random() < 0.8 ? 'a' : 'b';
    }

    // Otherwise: weighted random with movement bias
    return randomAction();
}

/**
 * Data Collector for automated exploration and human demonstrations
 */
export class DataCollector {
    constructor(emulator, memoryReader, onUpdate) {
        this.emu = emulator;
        this.reader = memoryReader;
        this.onUpdate = onUpdate;

        // Separate buffers for different data types
        this.explorationBuffer = new ExperienceBuffer(50000);
        this.humanBuffer = new ExperienceBuffer(10000);
        this.rewardCalc = new RewardCalculator();

        // State
        this.running = false;
        this.mode = null;  // 'explore' or 'record'
        this.stepCount = 0;
        this.prevState = null;
        this.prevAction = null;

        // Recording state
        this.isRecording = false;
        this.recordingStartTime = null;

        // Stats
        this.stats = {
            explorationSteps: 0,
            humanDemos: 0,
            totalReward: 0,
            positiveRewards: 0,
            negativeRewards: 0,
        };
    }

    /**
     * Start random exploration mode
     * @param {number} maxSteps - Maximum steps to run (0 = unlimited)
     */
    async startExploration(maxSteps = 0) {
        this.running = true;
        this.mode = 'explore';
        this.stepCount = 0;
        this.prevState = null;

        console.log('Starting random exploration...');

        while (this.running && (maxSteps === 0 || this.stepCount < maxSteps)) {
            await this.explorationStep();
            await this.sleep(80);  // Faster than LLM mode
        }

        console.log(`Exploration stopped. ${this.stepCount} steps collected.`);
    }

    /**
     * Single exploration step
     */
    async explorationStep() {
        const currState = this.reader.getGameState();

        // Compute reward for previous action
        if (this.prevState && this.prevAction) {
            const { total: reward, breakdown } = this.rewardCalc.computeReward(
                this.prevState, currState, this.prevAction
            );

            // Store experience
            this.explorationBuffer.add(
                this.prevState,
                [this.prevAction],
                reward,
                currState,
                false,
                { source: 'exploration', step: this.stepCount }
            );

            this.stats.totalReward += reward;
            if (reward > 0) this.stats.positiveRewards++;
            if (reward < 0) this.stats.negativeRewards++;

            // Log significant events
            if (Math.abs(reward) >= 50) {
                console.log(`Step ${this.stepCount}: Reward ${reward}`, breakdown);
            }
        }

        // Choose and execute action
        const action = smartRandomAction(currState);
        this.emu.pressButton(action, 60);

        // Update state
        this.prevState = currState;
        this.prevAction = action;
        this.stepCount++;
        this.stats.explorationSteps++;

        // Callback
        if (this.onUpdate && this.stepCount % 10 === 0) {
            this.onUpdate({
                mode: 'exploration',
                action: [action],
                stepCount: this.stepCount,
                state: currState,
                stats: this.getStats(),
            });
        }
    }

    /**
     * Start human demonstration recording
     */
    startRecording() {
        this.isRecording = true;
        this.mode = 'record';
        this.recordingStartTime = Date.now();
        this.prevState = this.reader.getGameState();
        console.log('Recording started. Play the game - your inputs will be captured.');

        if (this.onUpdate) {
            this.onUpdate({
                mode: 'recording',
                status: 'started',
                stats: this.getStats(),
            });
        }
    }

    /**
     * Stop human demonstration recording
     */
    stopRecording() {
        this.isRecording = false;
        this.mode = null;
        const duration = Date.now() - this.recordingStartTime;
        console.log(`Recording stopped. Duration: ${(duration / 1000).toFixed(1)}s, Demos: ${this.stats.humanDemos}`);

        if (this.onUpdate) {
            this.onUpdate({
                mode: 'recording',
                status: 'stopped',
                duration,
                stats: this.getStats(),
            });
        }
    }

    /**
     * Record a human action (call this from input handlers)
     * @param {string} action - Button pressed by human
     */
    recordHumanAction(action) {
        if (!this.isRecording) return;

        const currState = this.reader.getGameState();

        // Compute reward for this action
        let reward = 0;
        if (this.prevState) {
            const result = this.rewardCalc.computeReward(this.prevState, currState, action);
            reward = result.total;
        }

        // Store as expert demonstration
        this.humanBuffer.add(
            this.prevState || currState,
            [action],
            reward,
            currState,
            false,
            {
                source: 'human',
                isExpert: true,
                timestamp: Date.now(),
            }
        );

        this.prevState = currState;
        this.stats.humanDemos++;
        this.stats.totalReward += reward;

        if (this.onUpdate) {
            this.onUpdate({
                mode: 'recording',
                action: [action],
                reward,
                humanDemos: this.stats.humanDemos,
                state: currState,
            });
        }
    }

    /**
     * Stop all collection
     */
    stop() {
        this.running = false;
        if (this.isRecording) {
            this.stopRecording();
        }
        this.mode = null;
    }

    /**
     * Get collection statistics
     */
    getStats() {
        return {
            ...this.stats,
            explorationBufferSize: this.explorationBuffer.buffer.length,
            humanBufferSize: this.humanBuffer.buffer.length,
            explorationStats: this.explorationBuffer.getStats(),
            humanStats: this.humanBuffer.getStats(),
            rewardStats: this.rewardCalc.getStats(),
        };
    }

    /**
     * Export all collected data
     */
    exportData() {
        const explorationData = JSON.parse(this.explorationBuffer.export());
        const humanData = JSON.parse(this.humanBuffer.export());

        return {
            metadata: {
                exportedAt: new Date().toISOString(),
                stats: this.getStats(),
            },
            exploration: explorationData,
            humanDemonstrations: humanData,
            combined: {
                experiences: [
                    ...explorationData.experiences.map(e => ({ ...e, source: 'exploration' })),
                    ...humanData.experiences.map(e => ({ ...e, source: 'human', isExpert: true })),
                ],
            },
        };
    }

    /**
     * Export in format ready for PyTorch training
     */
    exportForTraining() {
        const allExperiences = [
            ...this.explorationBuffer.buffer,
            ...this.humanBuffer.buffer,
        ];

        // Convert to training format
        const trainingData = allExperiences.map(exp => ({
            // State features (flat array for neural net)
            state: [
                exp.state.x / 20,
                exp.state.y / 20,
                exp.state.badgeCount,
                exp.state.partyCount,
                exp.state.avgLevel,
                exp.state.hpRatio,
                exp.state.inBattle,
                exp.state.hasDialog,
                exp.state.money / 10,
            ],
            // Action (one-hot or index)
            action: ACTIONS.indexOf(exp.action.raw[0]),
            actionName: exp.action.raw[0],
            // Reward
            reward: exp.reward,
            // Next state
            nextState: [
                exp.nextState.x / 20,
                exp.nextState.y / 20,
                exp.nextState.badgeCount,
                exp.nextState.partyCount,
                exp.nextState.avgLevel,
                exp.nextState.hpRatio,
                exp.nextState.inBattle,
                exp.nextState.hasDialog,
                exp.nextState.money / 10,
            ],
            // Metadata
            isExpert: exp.metadata?.isExpert || false,
            location: exp.state.location,
        }));

        return {
            metadata: {
                stateSize: 9,
                actionSize: ACTIONS.length,
                actions: ACTIONS,
                totalSamples: trainingData.length,
                expertSamples: trainingData.filter(d => d.isExpert).length,
            },
            data: trainingData,
        };
    }

    /**
     * Clear all buffers
     */
    clear() {
        this.explorationBuffer.clear();
        this.humanBuffer.clear();
        this.rewardCalc.reset();
        this.stats = {
            explorationSteps: 0,
            humanDemos: 0,
            totalReward: 0,
            positiveRewards: 0,
            negativeRewards: 0,
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
