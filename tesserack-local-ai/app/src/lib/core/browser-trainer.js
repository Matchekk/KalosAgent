// browser-trainer.js - In-browser neural network training with TensorFlow.js

/**
 * Browser-based policy network trainer
 * Trains a small neural network to predict good actions from game state
 */
export class BrowserTrainer {
    constructor(onProgress) {
        this.model = null;
        this.onProgress = onProgress || (() => {});
        this.isTraining = false;
        this.trainingSessions = 0;
        this.totalEpochsTrained = 0;

        // Training configuration
        this.config = {
            stateSize: 12,      // Number of state features
            actionSize: 6,      // up, down, left, right, a, b
            hiddenUnits: [64, 32],
            learningRate: 0.001,
            batchSize: 32,
            epochs: 20,
            validationSplit: 0.1,
        };

        // Auto-training thresholds
        this.trainingThresholds = [128, 512, 1500, 3000, 7000, 15000, 30000];
        this.nextThresholdIndex = 0;

        // Model storage key
        // v2 intentionally does not load models trained to imitate random actions.
        this.modelStorageKey = 'tesserack-policy-model-v2';

        // TensorFlow.js loaded flag
        this.tfLoaded = false;
    }

    /**
     * Load TensorFlow.js dynamically
     */
    async loadTensorFlow() {
        if (this.tfLoaded) return true;

        try {
            // Check if already loaded
            if (typeof tf !== 'undefined') {
                this.tfLoaded = true;
                console.log('TensorFlow.js already loaded');
                return true;
            }

            // Dynamically import TensorFlow.js
            this.onProgress({ stage: 'loading', message: 'Loading TensorFlow.js...' });

            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
                script.onload = resolve;
                script.onerror = reject;
                document.head.appendChild(script);
            });

            // Wait for tf to be available
            await new Promise(resolve => setTimeout(resolve, 100));

            if (typeof tf !== 'undefined') {
                this.tfLoaded = true;
                console.log('TensorFlow.js loaded:', tf.version.tfjs);
                return true;
            }

            throw new Error('TensorFlow.js failed to initialize');
        } catch (e) {
            console.error('Failed to load TensorFlow.js:', e);
            return false;
        }
    }

    /**
     * Build the policy network
     */
    buildModel() {
        if (!this.tfLoaded) {
            throw new Error('TensorFlow.js not loaded');
        }

        const { stateSize, actionSize, hiddenUnits, learningRate } = this.config;

        this.model = tf.sequential();

        // Input layer
        this.model.add(tf.layers.dense({
            inputShape: [stateSize],
            units: hiddenUnits[0],
            activation: 'relu',
            kernelInitializer: 'heNormal'
        }));

        // Dropout for regularization
        this.model.add(tf.layers.dropout({ rate: 0.2 }));

        // Hidden layer
        this.model.add(tf.layers.dense({
            units: hiddenUnits[1],
            activation: 'relu',
            kernelInitializer: 'heNormal'
        }));

        // Output layer (action probabilities)
        this.model.add(tf.layers.dense({
            units: actionSize,
            activation: 'softmax'
        }));

        // Compile with Adam optimizer
        this.model.compile({
            optimizer: tf.train.adam(learningRate),
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });

        console.log('Policy network built:');
        this.model.summary();

        return this.model;
    }

    /**
     * Convert game state to feature vector
     */
    stateToFeatures(state) {
        const location = String(state.location || 'UNKNOWN');
        let locationHash = 0;
        for (let i = 0; i < location.length; i++) {
            locationHash = ((locationHash * 31) + location.charCodeAt(i)) >>> 0;
        }

        const badgeCount = state.badges?.length ?? state.badgeCount ?? 0;
        const party = state.party || [];
        const partyCount = party.length || state.partyCount || 0;
        const avgLevel = party.length > 0
            ? party.reduce((sum, pokemon) => sum + (pokemon.level || 0), 0) / party.length
            : (state.avgLevel || 0);
        const hpRatio = party.length > 0
            ? party.reduce((sum, pokemon) => sum + ((pokemon.currentHP || 0) / Math.max(1, pokemon.maxHP || 1)), 0) / party.length
            : (state.hpRatio ?? 1);
        const coordinates = state.coordinates || state;
        const compact = state.normalized === true;

        // Normalize features to [0, 1] range
        return [
            (coordinates.x || 0) / 256,              // X position normalized
            (coordinates.y || 0) / 256,              // Y position normalized
            (locationHash % 4096) / 4095,            // Stable location identity
            compact ? badgeCount : badgeCount / 8,
            compact ? partyCount : partyCount / 6,
            compact ? avgLevel : avgLevel / 100,
            hpRatio,
            state.inBattle ? 1 : 0,                  // In battle flag
            state.hasDialog ? 1 : 0,                 // Dialog showing
            Math.min((state.money || 0) / 100000, 1), // Money normalized
            (coordinates.x || 0) % 2,                // X parity (helps with grid)
            (coordinates.y || 0) % 2,                // Y parity
        ];
    }

    /**
     * Convert action name to index
     */
    actionToIndex(action) {
        const actions = ['up', 'down', 'left', 'right', 'a', 'b'];
        const idx = actions.indexOf(action?.toLowerCase?.() || action);
        return idx >= 0 ? idx : 4; // Default to 'a'
    }

    /**
     * Convert index to action name
     */
    indexToAction(index) {
        const actions = ['up', 'down', 'left', 'right', 'a', 'b'];
        return actions[index] || 'a';
    }

    isTrainingSignal(exp) {
        const source = exp?.metadata?.source;
        const trustedSource = ['agent', 'exploration', 'human'].includes(source)
            || exp?.metadata?.isExpert === true;
        return trustedSource
            && !!exp?.state
            && !!exp?.action
            && Math.abs(Number(exp.reward) || 0) >= 0.01;
    }

    countTrainingSignals(experiences) {
        return experiences.filter(exp => this.isTrainingSignal(exp)).length;
    }

    /**
     * Prepare training data from experience buffer
     */
    prepareTrainingData(experiences) {
        const states = [];
        const actions = [];
        const rewards = [];
        const sampleWeights = [];

        for (const exp of experiences) {
            if (!this.isTrainingSignal(exp)) continue;

            // Get state features
            const features = this.stateToFeatures(exp.metadata?.rawState || exp.state);

            // Get action (handle both array and single action)
            const actionName = Array.isArray(exp.action.raw)
                ? exp.action.raw[0]
                : exp.action.raw;
            const actionIdx = this.actionToIndex(actionName);

            const reward = Number(exp.reward) || 0;
            if (Math.abs(reward) < 0.01) continue;
            states.push(features);
            const target = new Array(this.config.actionSize).fill(0);
            if (reward > 0) {
                target[actionIdx] = 1;
            } else {
                // Penalized actions must not be taught as the correct label.
                const alternativeProbability = 1 / (this.config.actionSize - 1);
                target.fill(alternativeProbability);
                target[actionIdx] = 0;
            }
            actions.push(target);
            rewards.push(reward);
            sampleWeights.push(Math.min(8, 1 + Math.log1p(Math.abs(reward))));
        }

        return { states, actions, rewards, sampleWeights };
    }

    /**
     * Train the model on collected experiences
     */
    async train(experiences, options = {}) {
        if (this.isTraining) {
            console.log('Training already in progress');
            return null;
        }

        const signalCount = this.countTrainingSignals(experiences);
        if (signalCount < 32) {
            console.log(`Not enough reward-bearing experiences to train: ${signalCount}/32`);
            return null;
        }

        this.isTraining = true;
        const startTime = Date.now();

        try {
            // Load TensorFlow if needed
            if (!this.tfLoaded) {
                const loaded = await this.loadTensorFlow();
                if (!loaded) throw new Error('Could not load TensorFlow.js');
            }

            // Build or reuse model
            if (!this.model) {
                this.buildModel();
            }

            this.onProgress({
                stage: 'preparing',
                message: `Preparing ${experiences.length} experiences...`
            });

            // Prepare data
            const { states, actions, sampleWeights } = this.prepareTrainingData(experiences);

            if (states.length < 32) {
                throw new Error(`Not enough reward-bearing samples (${states.length}/32)`);
            }

            console.log(`Training on ${states.length} samples`);

            // Convert to tensors
            const xs = tf.tensor2d(states);
            const ys = tf.tensor2d(actions);
            const weights = tf.tensor1d(sampleWeights);

            // Training configuration
            const epochs = options.epochs || this.config.epochs;
            const batchSize = options.batchSize || this.config.batchSize;

            this.onProgress({
                stage: 'training',
                message: 'Training neural network...',
                epoch: 0,
                totalEpochs: epochs
            });

            // Train
            const history = await this.model.fit(xs, ys, {
                epochs,
                batchSize,
                validationSplit: this.config.validationSplit,
                shuffle: true,
                sampleWeight: weights,
                callbacks: {
                    onEpochEnd: (epoch, logs) => {
                        this.onProgress({
                            stage: 'training',
                            message: `Epoch ${epoch + 1}/${epochs}`,
                            epoch: epoch + 1,
                            totalEpochs: epochs,
                            loss: logs.loss,
                            accuracy: logs.acc,
                            valLoss: logs.val_loss,
                            valAccuracy: logs.val_acc
                        });
                    }
                }
            });

            // Clean up tensors
            xs.dispose();
            ys.dispose();
            weights.dispose();

            // Save model
            this.onProgress({ stage: 'saving', message: 'Saving model...' });
            await this.saveModel();

            // Update stats
            this.trainingSessions++;
            this.totalEpochsTrained += epochs;

            // Save updated metadata immediately
            this.saveMetadata();

            const duration = (Date.now() - startTime) / 1000;
            const finalLoss = history.history.loss[history.history.loss.length - 1];
            const finalAcc = history.history.acc[history.history.acc.length - 1];

            console.log(`Training complete: sessions=${this.trainingSessions}, loss=${finalLoss.toFixed(4)}, acc=${(finalAcc * 100).toFixed(1)}%`);

            this.onProgress({
                stage: 'complete',
                message: `Training complete! Loss: ${finalLoss.toFixed(4)}, Accuracy: ${(finalAcc * 100).toFixed(1)}%`,
                duration,
                loss: finalLoss,
                accuracy: finalAcc,
                sessions: this.trainingSessions
            });

            console.log(`Training complete in ${duration.toFixed(1)}s. Loss: ${finalLoss.toFixed(4)}`);

            return {
                loss: finalLoss,
                accuracy: finalAcc,
                duration,
                samples: states.length,
                epochs
            };

        } catch (e) {
            console.error('Training failed:', e);
            this.onProgress({
                stage: 'error',
                message: `Training failed: ${e.message}`
            });
            return null;
        } finally {
            this.isTraining = false;
        }
    }

    /**
     * Predict action probabilities for a state
     */
    predict(state) {
        if (!this.model || !this.tfLoaded) {
            return null;
        }

        try {
            const features = this.stateToFeatures(state);
            const input = tf.tensor2d([features]);
            const output = this.model.predict(input);
            const probs = output.dataSync();

            input.dispose();
            output.dispose();

            return Array.from(probs);
        } catch (e) {
            console.warn('Prediction failed:', e);
            return null;
        }
    }

    /**
     * Get the best action for a state
     */
    getBestAction(state) {
        const probs = this.predict(state);
        if (!probs) return null;

        const maxIdx = probs.indexOf(Math.max(...probs));
        return {
            action: this.indexToAction(maxIdx),
            confidence: probs[maxIdx],
            allProbs: probs.map((p, i) => ({
                action: this.indexToAction(i),
                probability: p
            }))
        };
    }

    /**
     * Score a sequence of actions for a given state
     */
    scoreActions(state, actions) {
        const probs = this.predict(state);
        if (!probs) return 0;

        let score = 0;
        for (const action of actions) {
            const idx = this.actionToIndex(action);
            score += probs[idx];
        }
        return score / actions.length;
    }

    /**
     * Save model to IndexedDB
     */
    async saveModel() {
        if (!this.model) return false;

        try {
            await this.model.save(`indexeddb://${this.modelStorageKey}`);

            // Also save metadata
            localStorage.setItem(`${this.modelStorageKey}-meta`, JSON.stringify({
                trainingSessions: this.trainingSessions,
                totalEpochsTrained: this.totalEpochsTrained,
                nextThresholdIndex: this.nextThresholdIndex,
                savedAt: Date.now(),
                config: this.config
            }));

            console.log('Model saved to IndexedDB');
            return true;
        } catch (e) {
            console.error('Failed to save model:', e);
            return false;
        }
    }

    /**
     * Load model from IndexedDB
     */
    async loadModel() {
        // Always try to load metadata first (even if model doesn't exist)
        this.loadMetadata();

        try {
            if (!this.tfLoaded) {
                const loaded = await this.loadTensorFlow();
                if (!loaded) return false;
            }

            this.model = await tf.loadLayersModel(`indexeddb://${this.modelStorageKey}`);

            // Recompile the model (required after loading for training)
            this.model.compile({
                optimizer: tf.train.adam(this.config.learningRate),
                loss: 'categoricalCrossentropy',
                metrics: ['accuracy']
            });

            console.log(`Model loaded from IndexedDB (sessions: ${this.trainingSessions}, nextThreshold: ${this.trainingThresholds[this.nextThresholdIndex]})`);
            return true;
        } catch (e) {
            console.log('No saved model found (this is normal for first run)');
            return false;
        }
    }

    /**
     * Load metadata from localStorage
     */
    loadMetadata() {
        try {
            const metaStr = localStorage.getItem(`${this.modelStorageKey}-meta`);
            if (metaStr) {
                const meta = JSON.parse(metaStr);
                this.trainingSessions = meta.trainingSessions || 0;
                this.totalEpochsTrained = meta.totalEpochsTrained || 0;
                this.nextThresholdIndex = meta.nextThresholdIndex || 0;
                console.log(`Loaded training metadata: sessions=${this.trainingSessions}, nextThresholdIndex=${this.nextThresholdIndex}`);
            }
        } catch (e) {
            console.warn('Failed to load training metadata:', e);
        }
    }

    /**
     * Check if auto-training should trigger
     */
    shouldAutoTrain(experienceCount) {
        if (this.isTraining) return false;
        if (this.nextThresholdIndex >= this.trainingThresholds.length) return false;

        const threshold = this.trainingThresholds[this.nextThresholdIndex];
        return experienceCount >= threshold;
    }

    /**
     * Mark that auto-training occurred
     */
    markAutoTrainComplete() {
        this.nextThresholdIndex++;
        // Persist the updated threshold index
        this.saveMetadata();
    }

    /**
     * Save metadata to localStorage (without full model save)
     */
    saveMetadata() {
        localStorage.setItem(`${this.modelStorageKey}-meta`, JSON.stringify({
            trainingSessions: this.trainingSessions,
            totalEpochsTrained: this.totalEpochsTrained,
            nextThresholdIndex: this.nextThresholdIndex,
            savedAt: Date.now(),
            config: this.config
        }));
    }

    /**
     * Get training status
     */
    getStatus() {
        return {
            hasModel: !!this.model,
            isTraining: this.isTraining,
            trainingSessions: this.trainingSessions,
            totalEpochsTrained: this.totalEpochsTrained,
            nextThreshold: this.trainingThresholds[this.nextThresholdIndex] || 'max',
            tfLoaded: this.tfLoaded
        };
    }

    /**
     * Export model weights as JSON (for sharing/backup)
     */
    async exportWeights() {
        if (!this.model) return null;

        const weights = [];
        for (const layer of this.model.layers) {
            const layerWeights = layer.getWeights();
            const layerData = [];
            for (const w of layerWeights) {
                layerData.push({
                    shape: w.shape,
                    data: Array.from(w.dataSync())
                });
            }
            weights.push(layerData);
        }

        return {
            config: this.config,
            weights,
            metadata: {
                trainingSessions: this.trainingSessions,
                totalEpochsTrained: this.totalEpochsTrained,
                exportedAt: Date.now()
            }
        };
    }

    /**
     * Clear saved model
     */
    async clearModel() {
        try {
            await tf.io.removeModel(`indexeddb://${this.modelStorageKey}`);
            localStorage.removeItem(`${this.modelStorageKey}-meta`);
            this.model = null;
            this.trainingSessions = 0;
            this.totalEpochsTrained = 0;
            this.nextThresholdIndex = 0;
            console.log('Model cleared');
            return true;
        } catch (e) {
            console.warn('Failed to clear model:', e);
            return false;
        }
    }
}
