// experience-buffer.js - Stores experiences for RL training

/**
 * Circular buffer for storing RL experiences
 * Supports prioritized sampling based on reward magnitude
 */
export class ExperienceBuffer {
    constructor(maxSize = 10000) {
        this.maxSize = maxSize;
        this.buffer = [];
        this.position = 0;
        this.totalExperiences = 0;
        this.onAdd = null; // Callback when experience is added (for persistence)
    }

    /**
     * Set callback for when experiences are added
     * @param {Function} callback - Function to call with new experience
     */
    setOnAdd(callback) {
        this.onAdd = callback;
    }

    /**
     * Encode game state into compact representation for RL
     * @param {Object} gameState - Full game state from memory reader
     * @returns {Object} - Compact state representation
     */
    encodeState(gameState) {
        const party = gameState.party || [];
        const totalHP = party.reduce((sum, p) => sum + p.currentHP, 0);
        const maxHP = party.reduce((sum, p) => sum + p.maxHP, 0);
        const avgLevel = party.length > 0
            ? party.reduce((sum, p) => sum + p.level, 0) / party.length
            : 0;

        return {
            // Location (could be one-hot encoded for neural net)
            location: gameState.location,
            x: gameState.coordinates?.x || 0,
            y: gameState.coordinates?.y || 0,

            // Progress metrics (normalized)
            badgeCount: (gameState.badges?.length || 0) / 8,
            partyCount: party.length / 6,
            avgLevel: avgLevel / 100,
            hpRatio: maxHP > 0 ? totalHP / maxHP : 1,

            // Context flags
            inBattle: gameState.inBattle ? 1 : 0,
            hasDialog: (gameState.dialog?.length || 0) > 0 ? 1 : 0,

            // Resources (log-scaled)
            money: Math.log10(Math.max(gameState.money || 1, 1)),

            // Party details (for more advanced policies)
            partyTypes: party.map(p => p.type1),
            partyStatus: party.map(p => p.status),
        };
    }

    /**
     * Encode action plan into representation
     * @param {string[]} actions - Array of button presses
     * @returns {Object} - Action representation
     */
    encodeAction(actions) {
        const actionCounts = {
            up: 0, down: 0, left: 0, right: 0,
            a: 0, b: 0, start: 0, select: 0
        };

        for (const action of actions) {
            const btn = action.toLowerCase();
            if (btn in actionCounts) {
                actionCounts[btn]++;
            }
        }

        return {
            raw: actions,
            counts: actionCounts,
            length: actions.length,
            movementRatio: (actionCounts.up + actionCounts.down +
                actionCounts.left + actionCounts.right) / actions.length,
            interactionRatio: (actionCounts.a + actionCounts.b) / actions.length,
        };
    }

    /**
     * Add an experience to the buffer
     * @param {Object} state - Game state before action
     * @param {string[]} action - Actions taken
     * @param {number} reward - Reward received
     * @param {Object} nextState - Game state after action
     * @param {boolean} done - Whether episode ended
     * @param {Object} metadata - Additional info (plan, reasoning, etc.)
     */
    add(state, action, reward, nextState, done = false, metadata = {}) {
        const experience = {
            id: this.totalExperiences++,
            timestamp: Date.now(),
            state: this.encodeState(state),
            action: this.encodeAction(action),
            reward,
            nextState: this.encodeState(nextState),
            done,
            metadata: {
                plan: metadata.plan,
                objective: metadata.objective,
                rawState: state,  // Keep raw for debugging
            },
            // Priority for sampling (higher reward magnitude = higher priority)
            priority: Math.abs(reward) + 0.1,
        };

        if (this.buffer.length < this.maxSize) {
            this.buffer.push(experience);
        } else {
            this.buffer[this.position] = experience;
        }

        this.position = (this.position + 1) % this.maxSize;

        // Notify persistence layer
        if (this.onAdd) {
            this.onAdd(experience);
        }
    }

    /**
     * Sample a batch of experiences
     * @param {number} batchSize - Number of experiences to sample
     * @param {boolean} prioritized - Use prioritized sampling
     * @returns {Object[]} - Array of experiences
     */
    sample(batchSize = 32, prioritized = true) {
        if (this.buffer.length === 0) return [];

        batchSize = Math.min(batchSize, this.buffer.length);

        if (!prioritized) {
            // Uniform random sampling
            const indices = [];
            while (indices.length < batchSize) {
                const idx = Math.floor(Math.random() * this.buffer.length);
                if (!indices.includes(idx)) {
                    indices.push(idx);
                }
            }
            return indices.map(i => this.buffer[i]);
        }

        // Prioritized sampling based on reward magnitude
        const totalPriority = this.buffer.reduce((sum, exp) => sum + exp.priority, 0);
        const samples = [];
        const usedIndices = new Set();

        while (samples.length < batchSize) {
            let rand = Math.random() * totalPriority;
            for (let i = 0; i < this.buffer.length; i++) {
                if (usedIndices.has(i)) continue;
                rand -= this.buffer[i].priority;
                if (rand <= 0) {
                    samples.push(this.buffer[i]);
                    usedIndices.add(i);
                    break;
                }
            }
        }

        return samples;
    }

    /**
     * Get experiences with positive rewards (for imitation learning)
     * @param {number} minReward - Minimum reward threshold
     * @returns {Object[]} - Positive experiences
     */
    getPositiveExperiences(minReward = 10) {
        return this.buffer.filter(exp => exp.reward >= minReward);
    }

    /**
     * Get experiences with negative rewards (for learning what to avoid)
     * @param {number} maxReward - Maximum reward threshold
     * @returns {Object[]} - Negative experiences
     */
    getNegativeExperiences(maxReward = -10) {
        return this.buffer.filter(exp => exp.reward <= maxReward);
    }

    /**
     * Get statistics about the buffer
     */
    getStats() {
        if (this.buffer.length === 0) {
            return { size: 0, avgReward: 0, minReward: 0, maxReward: 0 };
        }

        const rewards = this.buffer.map(exp => exp.reward);
        return {
            size: this.buffer.length,
            totalExperiences: this.totalExperiences,
            avgReward: rewards.reduce((a, b) => a + b, 0) / rewards.length,
            minReward: Math.min(...rewards),
            maxReward: Math.max(...rewards),
            positiveCount: rewards.filter(r => r > 0).length,
            negativeCount: rewards.filter(r => r < 0).length,
            zeroCount: rewards.filter(r => r === 0).length,
        };
    }

    /**
     * Export buffer for offline training
     */
    export() {
        return JSON.stringify({
            metadata: {
                exportedAt: new Date().toISOString(),
                totalExperiences: this.totalExperiences,
                bufferSize: this.buffer.length,
            },
            experiences: this.buffer,
        }, null, 2);
    }

    /**
     * Import experiences from exported data
     */
    import(jsonData) {
        const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
        this.buffer = data.experiences || [];
        this.totalExperiences = data.metadata?.totalExperiences || this.buffer.length;
        this.position = this.buffer.length % this.maxSize;
    }

    /**
     * Clear the buffer
     */
    clear() {
        this.buffer = [];
        this.position = 0;
        this.totalExperiences = 0;
    }
}

/**
 * Simple action statistics tracker
 * Tracks which actions work well in which situations
 */
export class ActionStatistics {
    constructor() {
        this.stats = {};  // location -> action -> {count, totalReward, avgReward}
    }

    /**
     * Update statistics for an action
     */
    update(location, action, reward) {
        if (!this.stats[location]) {
            this.stats[location] = {};
        }

        const actionKey = Array.isArray(action) ? action.join(',') : action;

        if (!this.stats[location][actionKey]) {
            this.stats[location][actionKey] = {
                count: 0,
                totalReward: 0,
                avgReward: 0,
            };
        }

        const stat = this.stats[location][actionKey];
        stat.count++;
        stat.totalReward += reward;
        stat.avgReward = stat.totalReward / stat.count;
    }

    /**
     * Get best actions for a location
     */
    getBestActions(location, topN = 5) {
        if (!this.stats[location]) return [];

        return Object.entries(this.stats[location])
            .map(([action, stat]) => ({ action, ...stat }))
            .sort((a, b) => b.avgReward - a.avgReward)
            .slice(0, topN);
    }

    /**
     * Get action score for policy weighting
     */
    getActionScore(location, action) {
        const actionKey = Array.isArray(action) ? action.join(',') : action;
        const stat = this.stats[location]?.[actionKey];
        if (!stat || stat.count < 3) return 0;  // Not enough data
        return stat.avgReward;
    }

    /**
     * Export statistics
     */
    export() {
        return JSON.stringify(this.stats, null, 2);
    }

    /**
     * Import statistics
     */
    import(jsonData) {
        this.stats = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    }
}
