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
        this.trainingThresholds = [3000, 7000, 15000, 30000, 60000, 100000];
        this.nextThresholdIndex = 0;

        // Model storage key
        this.modelStorageKey = 'tesserack-policy-model';

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
        // Normalize features to [0, 1] range
        return [
            (state.x || 0) / 256,                    // X position normalized
            (state.y || 0) / 256,                    // Y position normalized
            (state.mapId || 0) / 256,                // Map ID normalized
            (state.badgeCount || 0) / 8,             // Badges (0-8)
            (state.partyCount || 0) / 6,             // Party size (0-6)
            (state.avgLevel || 0) / 100,             // Average level
            (state.hpRatio || 1),                    // HP ratio (0-1)
            state.inBattle ? 1 : 0,                  // In battle flag
            state.hasDialog ? 1 : 0,                 // Dialog showing
            Math.min((state.money || 0) / 100000, 1), // Money normalized
            (state.x || 0) % 2,                      // X parity (helps with grid)
            (state.y || 0) % 2,                      // Y parity
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

    /**
     * Prepare training data from experience buffer
     */
    prepareTrainingData(experiences) {
        const states = [];
        const actions = [];
        const rewards = [];

        for (const exp of experiences) {
            if (!exp.state || !exp.action) continue;

            // Get state features
            const features = this.stateToFeatures(exp.state);

            // Get action (handle both array and single action)
            const actionName = Array.isArray(exp.action.raw)
                ? exp.action.raw[0]
                : exp.action.raw;
            const actionIdx = this.actionToIndex(actionName);

            // Weight by reward (prioritize positive experiences)
            const weight = Math.max(0.1, 1 + (exp.reward || 0) / 100);

            // Add to training data (weighted by reward)
            const copies = Math.ceil(weight);
            for (let i = 0; i < copies; i++) {
                states.push(features);

                // One-hot encode action
                const oneHot = new Array(this.config.actionSize).fill(0);
                oneHot[actionIdx] = 1;
                actions.push(oneHot);

                rewards.push(exp.reward || 0);
            }
        }

        return { states, actions, rewards };
    }

    /**
     * Train the model on collected experiences
     */
    async train(experiences, options = {}) {
        if (this.isTraining) {
            console.log('Training already in progress');
            return null;
        }

        if (experiences.length < 100) {
            console.log('Not enough experiences to train:', experiences.length);
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
            const { states, actions } = this.prepareTrainingData(experiences);

            if (states.length < 100) {
                throw new Error('Not enough valid training samples');
            }

            console.log(`Training on ${states.length} samples`);

            // Convert to tensors
            const xs = tf.tensor2d(states);
            const ys = tf.tensor2d(actions);

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

            // Save model
            this.onProgress({ stage: 'saving', message: 'Saving model...' });
            await this.saveModel();

            // Update stats
            this.trainingSessions++;
            this.totalEpochsTrained += epochs;

            const duration = (Date.now() - startTime) / 1000;
            const finalLoss = history.history.loss[history.history.loss.length - 1];
            const finalAcc = history.history.acc[history.history.acc.length - 1];

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
        try {
            if (!this.tfLoaded) {
                const loaded = await this.loadTensorFlow();
                if (!loaded) return false;
            }

            this.model = await tf.loadLayersModel(`indexeddb://${this.modelStorageKey}`);

            // Load metadata
            const metaStr = localStorage.getItem(`${this.modelStorageKey}-meta`);
            if (metaStr) {
                const meta = JSON.parse(metaStr);
                this.trainingSessions = meta.trainingSessions || 0;
                this.totalEpochsTrained = meta.totalEpochsTrained || 0;
            }

            console.log('Model loaded from IndexedDB');
            return true;
        } catch (e) {
            console.log('No saved model found (this is normal for first run)');
            return false;
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
