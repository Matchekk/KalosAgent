import { chooseCheckpointCandidate, compareProgressStates, progressScore } from './parallel-training.js';

/**
 * Coordinates several emulator trajectories around one on-policy learner.
 * Agents are stepped round-robin so a shared rollout always contains one
 * transition per environment before the policy can update.
 */
export class ParallelTrainingCoordinator {
    constructor({ agents, visibleWorker = 0, onCheckpoint = null, initialTotalSamples = 0 } = {}) {
        if (!Array.isArray(agents) || agents.length === 0) {
            throw new Error('Parallel training requires at least one environment');
        }
        const sharedCore = agents[0].core;
        if (!agents.every(agent => agent.core === sharedCore)) {
            throw new Error('All parallel environments must share one PPO/GAE core');
        }

        this.agents = agents;
        this.visibleWorker = Math.max(0, Math.min(agents.length - 1, visibleWorker));
        this.onCheckpoint = onCheckpoint;
        this.running = false;
        this.totalSamples = Math.max(0, Math.trunc(Number(initialTotalSamples) || 0));
        this.samplesAtStart = this.totalSamples;
        this.startedAt = nowMs();
        this.checkpointCount = Math.max(1, agents[0].checkpointCount || 0);
        this.archive = new Map();
        this.archiveLimit = 128;
        this.archiveSelections = 0;

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
        this.samplesAtStart = this.totalSamples;
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
            const archiveCandidate = agent.consumeArchiveCandidate?.();
            if (archiveCandidate) this._rememberArchive(archiveCandidate);
        }

        // Worker 1 exploits the global curriculum, the last worker always
        // rehearses from ROM start, and middle workers revisit autonomously
        // discovered under-sampled cells on their next episode reset.
        for (let index = 1; index < this.agents.length - 1; index++) {
            if (!results[index]?.done) continue;
            const archived = this._selectArchiveCell();
            if (archived) this.agents[index].adoptExplorationState(archived.checkpoint);
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

    _rememberArchive(candidate) {
        if (!candidate?.key || !(candidate.checkpoint instanceof Uint8Array)) return;
        if (!this.archive.has(candidate.key)) {
            this.archive.set(candidate.key, {
                ...candidate,
                checkpoint: candidate.checkpoint.slice(),
                restores: 0,
                discoveredAt: this.totalSamples,
            });
        }
        if (this.archive.size <= this.archiveLimit) return;
        const weakest = [...this.archive.values()].sort((left, right) => {
            const progress = compareProgressStates(left.state, right.state);
            if (progress !== 0) return progress;
            if (left.restores !== right.restores) return right.restores - left.restores;
            return left.discoveredAt - right.discoveredAt;
        })[0];
        if (weakest) this.archive.delete(weakest.key);
    }

    _selectArchiveCell() {
        const selected = [...this.archive.values()].sort((left, right) => {
            if (left.restores !== right.restores) return left.restores - right.restores;
            const progress = compareProgressStates(right.state, left.state);
            if (progress !== 0) return progress;
            return right.discoveredAt - left.discoveredAt;
        })[0] || null;
        if (selected) {
            selected.restores++;
            this.archiveSelections++;
        }
        return selected;
    }

    destroy() {
        this.stop();
        for (let index = 0; index < this.agents.length; index++) {
            if (index !== this.visibleWorker) {
                try {
                    this.agents[index].emu.destroy();
                } catch (error) {
                    console.warn(`[ParallelTrain] Worker ${index + 1} cleanup failed:`, error);
                }
            }
        }
        this.agents = [];
    }

    _summarizeRound(results, visibleAgent, visibleResult) {
        const core = visibleAgent.core;
        const trainInfo = results.find(result => result.trainInfo)?.trainInfo ?? null;
        const elapsedSeconds = Math.max(0.001, (nowMs() - this.startedAt) / 1000);
        const lifecycleSamples = Math.max(0, this.totalSamples - this.samplesAtStart);
        const rewardStats = visibleAgent.rewards.getStats();
        const breakdown = { tier1: 0, tier2: 0, tier3: 0, penalties: 0 };
        const firedTests = [];

        for (let workerId = 0; workerId < results.length; workerId++) {
            const result = results[workerId];
            for (const key of Object.keys(breakdown)) breakdown[key] += Number(result.breakdown?.[key]) || 0;
            if (Array.isArray(result.firedTests)) {
                firedTests.push(...result.firedTests.map(event => ({
                    ...(typeof event === 'string' ? { id: event, reward: 0, tier: 1 } : event),
                    workerId,
                    visibleWorker: workerId === this.visibleWorker,
                })));
            }
        }

        const visibleState = visibleAgent.mem.getGameState();
        return {
            step: this.totalSamples,
            action: visibleResult.actionStr,
            reward: results.reduce((sum, result) => sum + (Number(result.reward) || 0), 0),
            totalReward: this.agents.reduce((sum, agent) => sum + agent.totalReward, 0),
            breakdown,
            firedTests,
            context: visibleResult.context,
            matrixVersion: visibleResult.matrixVersion,
            state: visibleState,
            memoryDiagnostics: visibleState.memoryDiagnostics ?? null,
            // The shared buffer fills on whichever worker contributes the
            // final sample (normally worker 4), not necessarily the rendered
            // worker. Forward that update so policy autosave cannot miss it.
            trainInfo,
            trainSteps: core.trainSteps,
            bufferFill: core.buffer.length,
            bufferSize: core.rolloutSize,
            avgRawReturn: core.lastAvgRawReturn,
            policyEntropy: core.lastEntropy,
            valueLoss: core.lastValueLoss,
            clipFraction: core.lastClipFraction,
            intrinsicReward: core.lastIntrinsicReward,
            episode: visibleAgent.episode,
            episodeSteps: visibleAgent.episodeSteps,
            bestProgressScore: this.globalCheckpoint ? progressScore(this.globalCheckpoint.state) : 0,
            checkpointCount: this.checkpointCount,
            confirmedWins: this.agents.reduce((sum, agent) => sum + agent.confirmedWins, 0),
            environmentCount: this.agents.length,
            samplesPerSecond: lifecycleSamples / elapsedSeconds,
            checkpointWorker: this.globalCheckpoint?.workerId ?? null,
            archiveSize: this.archive.size,
            archiveSelections: this.archiveSelections,
            currentLocation: rewardStats.currentLocation,
            bundleInfo: rewardStats.bundleInfo,
            totalRewards: rewardStats.totalRewards,
            completedObjectives: rewardStats.completedObjectives,
            teamQuality: rewardStats.teamQuality,
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
