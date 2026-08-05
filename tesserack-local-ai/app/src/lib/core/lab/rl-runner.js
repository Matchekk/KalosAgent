/**
 * RLRunner - Thin canonical loop wrapper
 *
 * Layer B of the hybrid architecture:
 *   - Owns the SINGLE correct transition wiring
 *   - Both Pokemon and Bandit use this, so no forked logic
 *
 * This is intentionally "thin and dumb" - it just wires:
 *   observe s → encode → act → execute → observe s' → reward → done → store → train
 */

export class RLRunner {
    /**
     * @param {ReinforceCore} core - The pure RL algorithm
     * @param {Object} env - Environment interface
     * @param {Function} env.getState - () => gameState
     * @param {Function} env.encodeStateInto - (gameState, outVec) => void
     * @param {Function} env.executeAction - async (actionStr) => void
     * @param {Function} env.rewardFn - (prevState, nextState) => { total, breakdown, firedTests }
     * @param {Function} env.checkDone - (prevState, nextState) => boolean
     * @param {Function} env.resetEnv - async () => void
     * @param {string[]} env.ACTIONS - Action strings ['up', 'down', ...]
     * @param {Float32Array} env.stateVec - Pre-allocated state vector (optional, will create if missing)
     */
    constructor(core, env) {
        this.core = core;
        this.env = env;

        // Ensure stateVec exists
        if (!env.stateVec) {
            env.stateVec = new Float32Array(core.stateSize);
        }
    }

    /**
     * Run one step of the canonical RL loop
     *
     * @returns {Promise<{
     *   actionIdx: number,
     *   actionStr: string,
     *   reward: number,
     *   breakdown: Object,
     *   done: boolean,
     *   trainInfo: { avgRawReturn: number, entropy: number, trainSteps: number } | null
     * }>}
     */
    async step() {
        const { core, env } = this;

        // 1. Observe state s
        const prevState = env.getState();
        env.encodeStateInto(prevState, env.stateVec);

        // 2. Act (sample from policy)
        const { actionIdx, logProb } = core.act(env.stateVec);
        const actionStr = env.ACTIONS[actionIdx];

        // 3. Execute action in environment
        await env.executeAction(actionStr);

        // 4. Observe new state s'
        const nextState = env.getState();

        // 5. Compute reward
        const rewardResult = env.rewardFn(prevState, nextState);
        const reward = rewardResult.total;
        const breakdown = rewardResult.breakdown ?? {};
        const firedTests = rewardResult.firedTests ?? [];

        // 6. Check done
        const done = env.checkDone(prevState, nextState);

        // 7. Store transition (observe)
        core.observe(env.stateVec, actionIdx, reward, done, logProb);

        // 8. Reset env if done
        if (done && env.resetEnv) {
            await env.resetEnv();
        }

        // 9. Train if buffer full
        let trainInfo = null;
        if (core.shouldTrain()) {
            trainInfo = core.train();
        }

        // Return rich object for UI
        return {
            actionIdx,
            actionStr,
            reward,
            breakdown,
            firedTests,
            done,
            trainInfo,
        };
    }

    /**
     * Get current metrics (delegates to core + adds buffer status)
     */
    getMetrics() {
        const bufferStatus = this.core.getBufferStatus();
        return {
            trainSteps: this.core.trainSteps,
            bufferFill: bufferStatus.length,
            bufferSize: bufferStatus.capacity,
            avgRawReturn: this.core.lastAvgRawReturn,
            policyEntropy: this.core.lastEntropy,
        };
    }
}

export default RLRunner;
