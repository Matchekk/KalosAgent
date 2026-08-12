/**
 * Mastery-gated reverse curriculum for long-horizon Red++ training.
 *
 * Demonstrated or autonomously discovered savestates are training-only start
 * states. The scheduler begins near the target and walks backwards only after
 * the policy repeatedly reaches the next RAM milestone. A fixed fraction of
 * episodes always starts from the true ROM state to prevent curriculum-only
 * competence from being mistaken for full-game competence.
 */
export class MasteryCurriculum {
    constructor({
        windowSize = 12,
        minimumAttempts = 8,
        masteryRate = 0.75,
        trueRomFraction = 0.25,
        targetLevel = 13,
    } = {}) {
        this.windowSize = boundedInteger(windowSize, 4, 100);
        this.minimumAttempts = boundedInteger(minimumAttempts, 2, this.windowSize);
        this.masteryRate = Math.max(0.5, Math.min(1, Number(masteryRate) || 0.75));
        this.trueRomFraction = Math.max(0.1, Math.min(1, Number(trueRomFraction) || 0.25));
        this.targetLevel = Math.max(1, Math.trunc(Number(targetLevel) || 13));
        this.checkpoints = new Map();
        this.outcomes = new Map();
        this.assignments = new Map();
        this.episodesScheduled = 0;
        this.trueRomEpisodes = 0;
    }

    registerCheckpoint(candidate) {
        const level = Math.max(0, Math.trunc(Number(candidate?.level) || 0));
        if (!(candidate?.checkpoint instanceof Uint8Array)) return false;
        if (level >= this.targetLevel) return false;
        const current = this.checkpoints.get(level);
        if (current?.source === 'human-demonstration' && candidate.source !== 'human-demonstration') {
            return false;
        }
        this.checkpoints.set(level, {
            ...candidate,
            level,
            checkpoint: candidate.checkpoint.slice(),
        });
        return true;
    }

    completeEpisode(workerId, reachedLevel) {
        const assignment = this.assignments.get(workerId);
        this.assignments.delete(workerId);
        if (!assignment || assignment.trueRom) return null;
        const outcomes = this.outcomes.get(assignment.level) || [];
        const success = Math.max(0, Math.trunc(Number(reachedLevel) || 0)) >= assignment.level + 1;
        outcomes.push(success ? 1 : 0);
        if (outcomes.length > this.windowSize) outcomes.splice(0, outcomes.length - this.windowSize);
        this.outcomes.set(assignment.level, outcomes);
        return { level: assignment.level, success, ...this.stageStats(assignment.level) };
    }

    selectStart(workerId) {
        this.episodesScheduled++;
        const requiredTrueRom = Math.ceil(this.episodesScheduled * this.trueRomFraction);
        if (this.trueRomEpisodes < requiredTrueRom || this.checkpoints.size === 0) {
            this.trueRomEpisodes++;
            const assignment = { workerId, trueRom: true, level: 0, checkpoint: null };
            this.assignments.set(workerId, assignment);
            return assignment;
        }

        const levels = [...this.checkpoints.keys()].sort((left, right) => right - left);
        const selectedLevel = levels.find(level => !this.stageStats(level).mastered)
            ?? levels[levels.length - 1];
        const selected = this.checkpoints.get(selectedLevel);
        const assignment = {
            workerId,
            trueRom: false,
            level: selectedLevel,
            source: selected.source,
            checkpoint: selected.checkpoint.slice(),
        };
        this.assignments.set(workerId, assignment);
        return assignment;
    }

    stageStats(level) {
        const outcomes = this.outcomes.get(level) || [];
        const attempts = outcomes.length;
        const successes = outcomes.reduce((sum, value) => sum + value, 0);
        const rate = attempts > 0 ? successes / attempts : 0;
        return Object.freeze({
            attempts,
            successes,
            rate,
            mastered: attempts >= this.minimumAttempts && rate >= this.masteryRate,
        });
    }

    summary() {
        const stages = [...this.checkpoints.keys()].sort((a, b) => a - b).map(level => ({
            level,
            source: this.checkpoints.get(level).source || 'autonomous',
            ...this.stageStats(level),
        }));
        return Object.freeze({
            mode: 'mastery-gated-backward-curriculum',
            stages,
            stageCount: stages.length,
            masteredStages: stages.filter(stage => stage.mastered).length,
            trueRomEpisodes: this.trueRomEpisodes,
            episodesScheduled: this.episodesScheduled,
            trueRomFraction: this.episodesScheduled > 0
                ? this.trueRomEpisodes / this.episodesScheduled
                : 0,
            minimumTrueRomFraction: this.trueRomFraction,
        });
    }

    exportSnapshot() {
        return {
            version: 1,
            outcomes: [...this.outcomes.entries()].map(([level, values]) => [level, [...values]]),
            episodesScheduled: this.episodesScheduled,
            trueRomEpisodes: this.trueRomEpisodes,
        };
    }

    restoreSnapshot(snapshot) {
        if (snapshot?.version !== 1) return false;
        this.outcomes.clear();
        for (const [rawLevel, rawValues] of snapshot.outcomes || []) {
            const level = Math.max(0, Math.trunc(Number(rawLevel) || 0));
            if (!Array.isArray(rawValues)) continue;
            const values = rawValues.slice(-this.windowSize).map(value => value ? 1 : 0);
            this.outcomes.set(level, values);
        }
        this.episodesScheduled = Math.max(0, Math.trunc(Number(snapshot.episodesScheduled) || 0));
        this.trueRomEpisodes = Math.max(0, Math.min(
            this.episodesScheduled,
            Math.trunc(Number(snapshot.trueRomEpisodes) || 0),
        ));
        return true;
    }
}

function boundedInteger(value, minimum, maximum) {
    const number = Math.trunc(Number(value) || minimum);
    return Math.max(minimum, Math.min(maximum, number));
}

export default MasteryCurriculum;
