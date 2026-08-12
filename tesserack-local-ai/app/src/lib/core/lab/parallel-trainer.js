import { chooseCheckpointCandidate, compareProgressStates, progressScore } from './parallel-training.js';
import { AutonomousProgressTracker, detectAutonomousMilestone } from './autonomous-progress.js';
import { SampleLearningAudit } from './sample-learning-audit.js';
import { MasteryCurriculum } from './mastery-curriculum.js';

/**
 * Coordinates several emulator trajectories around one on-policy learner.
 * Agents are stepped round-robin so a shared rollout always contains one
 * transition per environment before the policy can update.
 */
export class ParallelTrainingCoordinator {
    constructor({
        agents,
        visibleWorker = 0,
        onCheckpoint = null,
        initialTotalSamples = 0,
        curriculumCheckpoints = [],
    } = {}) {
        if (!Array.isArray(agents) || agents.length === 0) {
            throw new Error('Parallel training requires at least one environment');
        }
        const evaluationWorker = agents.findIndex(agent => agent.config?.evaluationOnly === true);
        const trainingAgents = agents.filter((_, index) => index !== evaluationWorker);
        if (trainingAgents.length === 0) {
            throw new Error('Parallel training requires at least one learning environment');
        }
        const sharedCore = trainingAgents[0].core;
        if (!trainingAgents.every(agent => agent.core === sharedCore)) {
            throw new Error('All learning environments must share one PPO/GAE core');
        }
        if (evaluationWorker >= 0 && agents[evaluationWorker].core === sharedCore) {
            throw new Error('The frozen evaluator must own an isolated policy core');
        }

        this.agents = agents;
        this.trainingAgents = trainingAgents;
        this.sharedCore = sharedCore;
        this.evaluationWorker = evaluationWorker;
        this.evaluationSeeds = [0x2f6e2b1, 0x5a17c9d, 0x7c3d4e5, 0x91b2a63, 0xc41d8ef];
        this.evaluationSeedIndex = 0;
        this.evaluationPolicyTrainSteps = sharedCore.trainSteps || 0;
        this.visibleWorker = Math.max(0, Math.min(agents.length - 1, visibleWorker));
        this.onCheckpoint = onCheckpoint;
        this.running = false;
        this.totalSamples = Math.max(0, Math.trunc(Number(initialTotalSamples) || 0));
        this.samplesAtStart = this.totalSamples;
        this.startedAt = nowMs();
        this.checkpointCount = Math.max(1, agents[0].checkpointCount || 0);
        this.archive = new Map();
        // Four workers capture at most 16 savestates each per WASM lifecycle.
        this.archiveLimit = 64;
        this.archiveSelections = 0;
        this.freshWorker = evaluationWorker >= 0
            ? evaluationWorker
            : Math.max(0, agents.findIndex(agent => agent.config?.resetFromInitial));
        this.autonomousProgress = new AutonomousProgressTracker({ freshWorkerId: this.freshWorker });
        this.learningAudit = new SampleLearningAudit({ initialTotalSamples: this.totalSamples });
        this.masteryCurriculum = new MasteryCurriculum();
        for (const checkpoint of curriculumCheckpoints) {
            this.masteryCurriculum.registerCheckpoint(checkpoint);
        }

        const visible = agents[this.visibleWorker];
        this.globalCheckpoint = visible.checkpointState ? {
            workerId: this.visibleWorker,
            steps: Number.POSITIVE_INFINITY,
            state: visible.checkpointProgressState || visible.mem.getGameState(),
            checkpoint: visible.checkpointState.slice(),
        } : null;
        if (this.globalCheckpoint) {
            this.masteryCurriculum.registerCheckpoint({
                ...this.globalCheckpoint,
                level: detectAutonomousMilestone(this.globalCheckpoint.state),
                source: 'persisted-global-checkpoint',
            });
        }

        // Curriculum states are training aids only. The isolated evaluator is
        // never touched here and always remains at the true ROM start.
        for (const agent of this.trainingAgents) this._scheduleTrainingStart(agent);
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
            const candidate = agent.config?.evaluationOnly ? null : agent.consumeCheckpointCandidate();
            if (candidate) candidates.push(candidate);
            const archiveCandidate = agent.config?.evaluationOnly ? null : agent.consumeArchiveCandidate?.();
            if (archiveCandidate) {
                this._rememberArchive(archiveCandidate);
                this.masteryCurriculum.registerCheckpoint({
                    ...archiveCandidate,
                    level: detectAutonomousMilestone(archiveCandidate.state),
                    source: 'autonomous-frontier',
                });
            }
        }

        // Completed learning episodes are reassigned by mastery. The frozen
        // evaluator is excluded and continues from the true ROM start only.
        for (let index = 0; index < this.agents.length; index++) {
            if (index === this.evaluationWorker) continue;
            if (!results[index]?.done) continue;
            this.masteryCurriculum.completeEpisode(
                this.agents[index].workerId,
                detectAutonomousMilestone(results[index].nextState),
            );
            this._scheduleTrainingStart(this.agents[index]);
        }

        const selected = chooseCheckpointCandidate(this.globalCheckpoint, candidates);
        if (selected && selected !== this.globalCheckpoint) {
            this.globalCheckpoint = {
                ...selected,
                checkpoint: selected.checkpoint.slice(),
            };
            this.checkpointCount++;
            this.masteryCurriculum.registerCheckpoint({
                ...selected,
                level: detectAutonomousMilestone(selected.state),
                source: 'autonomous-checkpoint',
            });
            for (let index = 0; index < this.agents.length; index++) {
                if (index === this.evaluationWorker) continue;
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

        if (this.evaluationWorker >= 0 && results[this.evaluationWorker]?.done) {
            const evaluator = this.agents[this.evaluationWorker];
            this.autonomousProgress.completeFreshEpisode(Math.max(1, evaluator.episode - 1));
            this.evaluationSeedIndex = (this.evaluationSeedIndex + 1) % this.evaluationSeeds.length;
            evaluator.refreshFrozenPolicy(
                this.sharedCore,
                this.evaluationSeeds[this.evaluationSeedIndex],
            );
            this.evaluationPolicyTrainSteps = this.sharedCore.trainSteps || 0;
        }

        // Evaluation transitions are deliberately absent from PPO rollouts and
        // from the training sample clock. This keeps throughput and 50k audits
        // comparable when the evaluator runs longer or shorter episodes.
        this.totalSamples += this.trainingAgents.length;
        const visibleAgent = this.agents[this.visibleWorker];
        const visibleResult = results[this.visibleWorker];
        visibleAgent.emu.render();

        return this._summarizeRound(results, visibleAgent, visibleResult);
    }

    setSharedCore(core) {
        this.sharedCore = core;
        this.trainingAgents = this.agents.filter((agent, index) => {
            if (index === this.evaluationWorker) return false;
            agent.setSharedCore(core);
            return true;
        });
    }

    reset() {
        for (let index = 0; index < this.agents.length; index++) {
            if (index === this.evaluationWorker) {
                this.evaluationSeedIndex = 0;
                this.agents[index].refreshFrozenPolicy(this.sharedCore, this.evaluationSeeds[0]);
                this.evaluationPolicyTrainSteps = this.sharedCore.trainSteps || 0;
            } else {
                this.agents[index].reset();
            }
        }
        this.totalSamples = 0;
        this.startedAt = nowMs();
        this.autonomousProgress = new AutonomousProgressTracker({ freshWorkerId: this.freshWorker });
        this.learningAudit = new SampleLearningAudit();
    }

    exportAutonomousProgress() {
        return {
            version: 3,
            autonomousProgress: this.autonomousProgress.exportSnapshot(),
            learningAudit: this.learningAudit.exportSnapshot(),
            masteryCurriculum: this.masteryCurriculum.exportSnapshot(),
        };
    }

    restoreAutonomousProgress(snapshot) {
        if ([2, 3].includes(snapshot?.version) && snapshot.autonomousProgress) {
            const autonomyRestored = this.autonomousProgress.restoreSnapshot(snapshot.autonomousProgress);
            const auditRestored = snapshot.learningAudit
                ? this.learningAudit.restoreSnapshot(snapshot.learningAudit)
                : true;
            const curriculumRestored = snapshot.version < 3 || !snapshot.masteryCurriculum
                ? true
                : this.masteryCurriculum.restoreSnapshot(snapshot.masteryCurriculum);
            return autonomyRestored && auditRestored && curriculumRestored;
        }
        return this.autonomousProgress.restoreSnapshot(snapshot);
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

    _scheduleTrainingStart(agent) {
        if (!agent || agent.config?.evaluationOnly) return null;
        const assignment = this.masteryCurriculum.selectStart(agent.workerId);
        const bytes = assignment.trueRom
            ? agent.initialState
            : assignment.checkpoint;
        if (bytes instanceof Uint8Array && agent.loadTrainingStartState) {
            agent.loadTrainingStartState(bytes);
        }
        return assignment;
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
        const core = this.sharedCore;
        const trainInfo = results.find((result, index) => index !== this.evaluationWorker && result.trainInfo)?.trainInfo ?? null;
        const elapsedSeconds = Math.max(0.001, (nowMs() - this.startedAt) / 1000);
        const lifecycleSamples = Math.max(0, this.totalSamples - this.samplesAtStart);
        const rewardStats = visibleAgent.rewards.getStats();
        const breakdown = { tier1: 0, tier2: 0, tier3: 0, penalties: 0 };
        const firedTests = [];

        for (let workerId = 0; workerId < results.length; workerId++) {
            if (workerId === this.evaluationWorker) continue;
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

        const workerStates = this.agents.map(agent => agent.mem.getGameState());
        for (let workerId = 0; workerId < this.agents.length; workerId++) {
            const agent = this.agents[workerId];
            const completed = Boolean(results[workerId]?.done);
            this.autonomousProgress.observe({
                workerId,
                state: results[workerId]?.nextState || workerStates[workerId],
                episode: completed ? Math.max(1, agent.episode - 1) : agent.episode,
                episodeSteps: completed ? agent.lastCompletedEpisodeSteps : agent.episodeSteps,
                totalSamples: this.totalSamples,
                terminal: completed,
            });
        }
        const autonomy = this.autonomousProgress.summary(this.totalSamples);
        const learningAudit = this.learningAudit.observe({
            totalSamples: this.totalSamples,
            autonomy,
            trainSteps: core.trainSteps,
            entropy: core.lastEntropy,
            avgReturn: core.lastAvgRawReturn,
            clipFraction: core.lastClipFraction,
        });
        const visibleState = workerStates[this.visibleWorker];
        return {
            step: this.totalSamples,
            action: visibleResult.actionStr,
            reward: results.reduce((sum, result, index) => index === this.evaluationWorker
                ? sum
                : sum + (Number(result.reward) || 0), 0),
            totalReward: this.trainingAgents.reduce((sum, agent) => sum + agent.totalReward, 0),
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
            trainingEnvironmentCount: this.trainingAgents.length,
            visibleWorker: this.visibleWorker,
            samplesPerSecond: lifecycleSamples / elapsedSeconds,
            checkpointWorker: this.globalCheckpoint?.workerId ?? null,
            archiveSize: this.archive.size,
            archiveSelections: this.archiveSelections,
            autonomy,
            learningAudit,
            curriculum: this.masteryCurriculum.summary(),
            evaluation: this.evaluationWorker < 0 ? null : {
                frozen: true,
                noLearning: true,
                workerId: this.evaluationWorker,
                currentSeed: this.evaluationSeeds[this.evaluationSeedIndex],
                seedCount: this.evaluationSeeds.length,
                policyTrainSteps: this.evaluationPolicyTrainSteps,
                maxEpisodeSteps: this.agents[this.evaluationWorker].config.maxEpisodeSteps,
            },
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
                location: workerStates[agent.workerId]?.location || 'Unknown',
                mapId: Number(workerStates[agent.workerId]?.mapId) || 0,
                x: Number(workerStates[agent.workerId]?.coordinates?.x) || 0,
                y: Number(workerStates[agent.workerId]?.coordinates?.y) || 0,
                action: results[agent.workerId]?.actionStr || '-',
                partySize: workerStates[agent.workerId]?.party?.length || 0,
                maxLevel: Math.max(
                    0,
                    ...(workerStates[agent.workerId]?.party || []).map(mon => Number(mon?.level) || 0),
                ),
                role: agent.workerId === this.evaluationWorker
                    ? 'Frozen ROM evaluation'
                    : agent.workerId === this.freshWorker
                        ? 'Fresh-ROM proof'
                    : agent.workerId === 0
                        ? 'Checkpoint exploit'
                        : 'Frontier replay',
                proofEligible: agent.workerId === this.freshWorker,
                evaluationOnly: agent.workerId === this.evaluationWorker,
                visible: agent.workerId === this.visibleWorker,
                checkpointSource: agent.workerId === this.globalCheckpoint?.workerId,
            })),
        };
    }
}

function nowMs() {
    return globalThis.performance?.now?.() ?? Date.now();
}

export default ParallelTrainingCoordinator;
