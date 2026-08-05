// trained-policy.js - Wrapper for using trained model in decision making

import { BrowserTrainer } from './browser-trainer.js';

/**
 * Trained Policy Manager
 * Integrates the trained neural network with the RL agent
 */
export class TrainedPolicy {
    constructor(onStatusChange) {
        this.trainer = new BrowserTrainer(this.handleTrainingProgress.bind(this));
        this.onStatusChange = onStatusChange || (() => {});

        // Policy configuration
        this.useTrainedPolicy = true;
        this.policyWeight = 0.6;  // How much to weight trained policy vs heuristics
        this.minConfidence = 0.3; // Minimum confidence to use policy prediction

        // Stats
        this.predictionsUsed = 0;
        this.predictionsFallback = 0;

        // Training state
        this.trainingProgress = null;
    }

    /**
     * Initialize - load existing model if available
     */
    async initialize() {
        const loaded = await this.trainer.loadModel();
        this.onStatusChange(this.getStatus());
        return loaded;
    }

    /**
     * Handle training progress updates
     */
    handleTrainingProgress(progress) {
        this.trainingProgress = progress;
        this.onStatusChange({
            ...this.getStatus(),
            trainingProgress: progress
        });
    }

    /**
     * Check if we should auto-train and do it
     * @param {Array} experiences - Experience buffer
     * @returns {Promise<boolean>} - Whether training occurred
     */
    async checkAndTrain(experiences) {
        if (!this.trainer.shouldAutoTrain(experiences.length)) {
            return false;
        }

        console.log(`Auto-training triggered at ${experiences.length} experiences`);

        const result = await this.trainer.train(experiences);

        if (result) {
            this.trainer.markAutoTrainComplete();
            return true;
        }

        return false;
    }

    /**
     * Manually trigger training
     */
    async trainNow(experiences, options = {}) {
        return await this.trainer.train(experiences, options);
    }

    /**
     * Score a plan using the trained policy
     * @param {Object} state - Current game state
     * @param {string[]} actions - Proposed actions
     * @returns {number} - Score (higher = better)
     */
    scorePlan(state, actions) {
        if (!this.trainer.model || !this.useTrainedPolicy) {
            return 0;
        }

        const score = this.trainer.scoreActions(state, actions);
        return score * this.policyWeight;
    }

    /**
     * Get best action according to trained policy
     * @param {Object} state - Current game state
     * @returns {Object|null} - Best action with confidence, or null
     */
    getBestAction(state) {
        if (!this.trainer.model || !this.useTrainedPolicy) {
            this.predictionsFallback++;
            return null;
        }

        const result = this.trainer.getBestAction(state);

        if (result && result.confidence >= this.minConfidence) {
            this.predictionsUsed++;
            return result;
        }

        this.predictionsFallback++;
        return null;
    }

    /**
     * Get action probabilities for all actions
     */
    getActionProbabilities(state) {
        if (!this.trainer.model) return null;
        return this.trainer.predict(state);
    }

    /**
     * Select from multiple plans using trained policy
     * @param {Object[]} plans - Array of {plan, actions} objects
     * @param {Object} state - Current game state
     * @returns {Object} - Selected plan with score
     */
    selectPlan(plans, state) {
        if (!this.trainer.model || plans.length === 0) {
            return plans[0] || { plan: 'fallback', actions: ['a'] };
        }

        // Score each plan
        const scoredPlans = plans.map(p => ({
            ...p,
            policyScore: this.scorePlan(state, p.actions)
        }));

        // Sort by score
        scoredPlans.sort((a, b) => b.policyScore - a.policyScore);

        return {
            ...scoredPlans[0],
            selectedBy: 'trained-policy'
        };
    }

    /**
     * Blend policy suggestion with LLM plans
     * Returns a modified action sequence that incorporates policy suggestions
     */
    blendWithPolicy(state, llmActions) {
        const policyAction = this.getBestAction(state);

        if (!policyAction) {
            return llmActions;
        }

        // If policy is very confident and disagrees with first LLM action, prepend policy action
        if (policyAction.confidence > 0.7 && llmActions[0] !== policyAction.action) {
            return [policyAction.action, ...llmActions.slice(0, -1)];
        }

        return llmActions;
    }

    /**
     * Get current status
     */
    getStatus() {
        const trainerStatus = this.trainer.getStatus();

        return {
            ...trainerStatus,
            policyEnabled: this.useTrainedPolicy,
            policyWeight: this.policyWeight,
            predictionsUsed: this.predictionsUsed,
            predictionsFallback: this.predictionsFallback,
            predictionRate: this.predictionsUsed + this.predictionsFallback > 0
                ? (this.predictionsUsed / (this.predictionsUsed + this.predictionsFallback) * 100).toFixed(1)
                : 0,
            nextAutoTrain: this.trainer.trainingThresholds[this.trainer.nextThresholdIndex] || 'done'
        };
    }

    /**
     * Enable/disable trained policy
     */
    setEnabled(enabled) {
        this.useTrainedPolicy = enabled;
        this.onStatusChange(this.getStatus());
    }

    /**
     * Adjust policy weight
     */
    setPolicyWeight(weight) {
        this.policyWeight = Math.max(0, Math.min(1, weight));
        this.onStatusChange(this.getStatus());
    }

    /**
     * Export model for sharing
     */
    async exportModel() {
        return await this.trainer.exportWeights();
    }

    /**
     * Clear the trained model
     */
    async clearModel() {
        await this.trainer.clearModel();
        this.predictionsUsed = 0;
        this.predictionsFallback = 0;
        this.onStatusChange(this.getStatus());
    }
}


/**
 * Auto-Training Manager
 * Monitors experience collection and triggers training automatically
 */
export class AutoTrainingManager {
    constructor(experienceBuffer, trainedPolicy, onEvent) {
        this.buffer = experienceBuffer;
        this.policy = trainedPolicy;
        this.onEvent = onEvent || (() => {});

        this.checkInterval = null;
        this.lastCheckCount = 0;
        this.isMonitoring = false;
    }

    /**
     * Start monitoring for auto-training
     */
    startMonitoring(intervalMs = 10000) {
        if (this.isMonitoring) return;

        this.isMonitoring = true;
        this.checkInterval = setInterval(() => this.check(), intervalMs);
        console.log('Auto-training monitor started');
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
        this.isMonitoring = false;
        console.log('Auto-training monitor stopped');
    }

    /**
     * Check if training should occur
     */
    async check() {
        if (!this.buffer || !this.policy) return;

        const experiences = this.buffer.buffer || [];
        const count = experiences.length;

        // Only check if we have new experiences
        if (count <= this.lastCheckCount) return;
        this.lastCheckCount = count;

        // Check if we should train
        if (this.policy.trainer.shouldAutoTrain(count)) {
            this.onEvent({
                type: 'training-starting',
                experienceCount: count
            });

            const result = await this.policy.checkAndTrain(experiences);

            if (result) {
                this.onEvent({
                    type: 'training-complete',
                    experienceCount: count,
                    result
                });
            }
        }
    }

    /**
     * Get monitoring status
     */
    getStatus() {
        return {
            isMonitoring: this.isMonitoring,
            lastCheckCount: this.lastCheckCount,
            policyStatus: this.policy?.getStatus()
        };
    }
}
