import { chooseCheckpointCandidate, progressScore } from './parallel-training.js';

/**
 * Coordinates several emulator trajectories around one on-policy learner.
 * Agents are stepped round-robin so a shared rollout always contains one
 * transition per environment before the policy can update.
 */
export class ParallelTrainingCoordinator {
    constructor({ agents, visibleWorker = 0, onCheckpoint = null } = {}) {
        if (!Array.isArray(agents) || agents.length === 0) {
            throw new Error('Parallel training requires at least one environment');
        }
        const sharedCore = agents[0].core;
        if (!agents.every(agent => agent.core === sharedCore)) {
            throw new Error('All parallel environments must share one REINFORCE core');
        }

        this.agents = agents;
        this.visibleWorker = Math.max(0, Math.min(agents.length - 1, visibleWorker));
        this.onCheckpoint = onCheckpoint;
        this.running = false;
        this.totalSamples = 0;
        this.startedAt = nowMs();
        this.checkpointCount = Math.max(1, agents[0].checkpointCount || 0);

        const visible = agents[this.visibleWorker];
        this.globalCheckpoint = visible.checkpointState ? {
            workerId: this.visibleWorker,
            steps: Number.POSITIVE_INFINITY,
            state: visible.mem.getGameState(),
            checkpoint: visible.checkpointState.slice(),
        } : null;
    }

    start() {
        this.running = true;
        this.startedAt = nowMs();
        for (const agent of this.agents) agent.running = true;
    }

    stop() {
        this.running = false;
        for (const agent of this.agents) agent.stop();
    }

    async stepRound() {
        const results = [];
        const candidates = [];

        for (const agent of this.agents) {
            const result = await agent.step();
            results.push(result);
            const candidate = agent.consumeCheckpointCandidate();
            if (candidate) candidates.push(candidate);
        }

        const selected = chooseCheckpointCandidate(this.globalCheckpoint, candidates);
        if (selected && selected !== this.globalCheckpoint) {
            this.globalCheckpoint = {
                ...selected,
                checkpoint: selected.checkpoint.slice(),
            };
            this.checkpointCount++;
            for (let index = 0; index < this.agents.length; index++) {
                this.agents[index].adoptCheckpoint(selected.checkpoint, selected.state, {
                    persist: index === this.visibleWorker,
                    count: index === this.visibleWorker,
                });
            }
            this.onCheckpoint?.({
                workerId: selected.workerId,
                score: progressScore(selected.state),
                state: selected.state,
                steps: selected.steps,
                checkpointCount: this.checkpointCount,
            });
        }

        this.totalSamples += results.length;
        const visibleAgent = this.agents[this.visibleWorker];
        const visibleResult = results[this.visibleWorker];
        visibleAgent.emu.render();

        return this._summarizeRound(results, visibleAgent, visibleResult);
    }

    setSharedCore(core) {
        for (const agent of this.agents) agent.setSharedCore(core);
    }

    reset() {
        for (const agent of this.agents) agent.reset();
        this.totalSamples = 0;
        this.startedAt = nowMs();
    }

    destroy() {
        this.stop();
        for (let index = 0; index < this.agents.length; index++) {
            if (index !== this.visibleWorker) this.agents[index].emu.destroy();
        }
        this.agents = [];
    }

    _summarizeRound(results, visibleAgent, visibleResult) {
        const core = visibleAgent.core;
        const elapsedSeconds = Math.max(0.001, (nowMs() - this.startedAt) / 1000);
        const rewardStats = visibleAgent.rewards.getStats();
        const breakdown = { tier1: 0, tier2: 0, tier3: 0, penalties: 0 };
        const firedTests = [];

        for (const result of results) {
            for (const key of Object.keys(breakdown)) breakdown[key] += Number(result.breakdown?.[key]) || 0;
            if (Array.isArray(result.firedTests)) firedTests.push(...result.firedTests);
        }

        return {
            step: this.totalSamples,
            action: visibleResult.actionStr,
            reward: results.reduce((sum, result) => sum + (Number(result.reward) || 0), 0),
            totalReward: this.agents.reduce((sum, agent) => sum + agent.totalReward, 0),
            breakdown,
            firedTests,
            context: visibleResult.context,
            matrixVersion: visibleResult.matrixVersion,
            state: visibleAgent.mem.getGameState(),
            trainInfo: visibleResult.trainInfo,
            trainSteps: core.trainSteps,
            bufferFill: core.buffer.length,
            bufferSize: core.rolloutSize,
            avgRawReturn: core.lastAvgRawReturn,
            policyEntropy: core.lastEntropy,
            episode: visibleAgent.episode,
            episodeSteps: visibleAgent.episodeSteps,
            bestProgressScore: this.globalCheckpoint ? progressScore(this.globalCheckpoint.state) : 0,
            checkpointCount: this.checkpointCount,
            confirmedWins: this.agents.reduce((sum, agent) => sum + agent.confirmedWins, 0),
            environmentCount: this.agents.length,
            samplesPerSecond: this.totalSamples / elapsedSeconds,
            checkpointWorker: this.globalCheckpoint?.workerId ?? null,
            currentLocation: rewardStats.currentLocation,
            bundleInfo: rewardStats.bundleInfo,
            totalRewards: rewardStats.totalRewards,
            completedObjectives: rewardStats.completedObjectives,
            workers: this.agents.map(agent => ({
                workerId: agent.workerId,
                episode: agent.episode,
                episodeSteps: agent.episodeSteps,
                totalSteps: agent.totalSteps,
                resetFromInitial: Boolean(agent.config.resetFromInitial),
                location: agent.mem.getGameState()?.location || 'Unknown',
            })),
        };
    }
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

export default ParallelTrainingCoordinator;
