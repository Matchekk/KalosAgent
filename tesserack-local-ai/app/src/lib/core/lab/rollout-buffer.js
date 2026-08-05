/**
 * Rollout Buffer - Typed, flat storage for RL experiences (no GC)
 *
 * Uses flat Float32Array storage to avoid per-step allocations.
 * States are stored contiguously: [t0_state..., t1_state..., ...]
 */

export class RolloutBuffer {
    constructor(rolloutSize, stateSize) {
        this.rolloutSize = rolloutSize;
        this.stateSize = stateSize;

        // Flat state storage: [t0_state..., t1_state..., ...]
        this.states = new Float32Array(rolloutSize * stateSize);

        this.actions = new Int16Array(rolloutSize);
        this.rewards = new Float32Array(rolloutSize);
        this.logProbs = new Float32Array(rolloutSize); // Stored for PPO; unused in REINFORCE
        this.dones = new Uint8Array(rolloutSize); // 0/1

        this.length = 0;
    }

    clear() {
        this.length = 0;
    }

    isFull() {
        return this.length >= this.rolloutSize;
    }

    /**
     * Copy a stateVec into flat storage
     * @param {Float32Array} stateVec - State vector to store
     * @param {number} actionIdx - Action index (0-5)
     * @param {number} reward - Reward value
     * @param {number} logProb - Log probability of action
     * @param {boolean} done - Episode termination flag
     */
    push(stateVec, actionIdx, reward, logProb, done) {
        const t = this.length;
        if (t >= this.rolloutSize) return false;

        const base = t * this.stateSize;
        for (let i = 0; i < this.stateSize; i++) {
            this.states[base + i] = stateVec[i];
        }

        this.actions[t] = actionIdx;
        this.rewards[t] = reward;
        this.logProbs[t] = logProb;
        this.dones[t] = done ? 1 : 0;

        this.length++;
        return true;
    }

    /**
     * Get the offset into the flat states array for timestep t
     */
    stateOffset(t) {
        return t * this.stateSize;
    }
}

export default RolloutBuffer;
