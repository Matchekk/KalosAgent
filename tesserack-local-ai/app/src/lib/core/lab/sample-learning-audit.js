export const LEARNING_AUDIT_VERSION = 1;
export const LEARNING_AUDIT_INTERVAL = 50_000;

/**
 * Persisted, outcome-first learning audits at fixed sample boundaries.
 * Checkpoints, rewards and returns are diagnostic only: only the independent
 * fresh-ROM proof can turn an audit into "improving".
 */
export class SampleLearningAudit {
    constructor({
        interval = LEARNING_AUDIT_INTERVAL,
        maxHistory = 24,
        initialTotalSamples = 0,
    } = {}) {
        this.interval = positiveInteger(interval, LEARNING_AUDIT_INTERVAL);
        this.maxHistory = positiveInteger(maxHistory, 24);
        this.history = [];
        this.stagnantIntervals = 0;
        const initial = finiteCounter(initialTotalSamples);
        this.nextBoundary = (Math.floor(initial / this.interval) + 1) * this.interval;
    }

    observe({
        totalSamples = 0,
        autonomy = null,
        trainSteps = 0,
        entropy = 0,
        avgReturn = 0,
        clipFraction = 0,
    } = {}) {
        const samples = finiteCounter(totalSamples);
        if (!autonomy || samples < this.nextBoundary) return this.summary();

        while (samples >= this.nextBoundary) {
            this._recordBoundary({
                boundarySamples: this.nextBoundary,
                observedSamples: samples,
                autonomy,
                trainSteps,
                entropy,
                avgReturn,
                clipFraction,
            });
            this.nextBoundary += this.interval;
        }
        return this.summary();
    }

    _recordBoundary({ boundarySamples, observedSamples, autonomy, ...diagnostics }) {
        const previous = this.history.at(-1) || null;
        const outcome = {
            freshBestLevel: finiteCounter(autonomy.freshBestLevel),
            freshBestMilestone: String(autonomy.freshBestMilestone || 'ROM start'),
            verifiedLevel: finiteCounter(autonomy.verifiedLevel),
            verifiedMilestone: String(autonomy.verifiedMilestone || 'ROM start'),
            targetSuccesses: finiteCounter(autonomy.targetSuccesses),
            attempts: finiteCounter(autonomy.attempts),
            samplesSinceFreshProgress: finiteCounter(autonomy.samplesSinceFreshProgress),
        };
        const deltas = previous ? {
            freshBestLevel: outcome.freshBestLevel - previous.outcome.freshBestLevel,
            verifiedLevel: outcome.verifiedLevel - previous.outcome.verifiedLevel,
            targetSuccesses: outcome.targetSuccesses - previous.outcome.targetSuccesses,
            attempts: outcome.attempts - previous.outcome.attempts,
        } : { freshBestLevel: 0, verifiedLevel: 0, targetSuccesses: 0, attempts: 0 };
        const improved = deltas.freshBestLevel > 0
            || deltas.verifiedLevel > 0
            || deltas.targetSuccesses > 0;

        if (!previous || improved) this.stagnantIntervals = 0;
        else this.stagnantIntervals++;

        let verdict = 'baseline';
        let reason = 'First outcome-only 50k sample measurement';
        if (previous && improved) {
            verdict = 'improving';
            reason = 'Independent fresh-ROM outcome proof increased';
        } else if (previous && deltas.attempts <= 0) {
            verdict = 'hardstuck';
            reason = 'Fresh-ROM worker completed no new independent start episode';
        } else if (previous && (this.stagnantIntervals >= 2
            || outcome.samplesSinceFreshProgress >= this.interval * 2)) {
            verdict = 'hardstuck';
            reason = 'Two 50k intervals without a new fresh-ROM outcome';
        } else if (previous) {
            verdict = 'plateau-watch';
            reason = 'No fresh-ROM improvement in this 50k interval';
        }

        this.history.push(Object.freeze({
            boundarySamples,
            observedSamples,
            verdict,
            reason,
            stagnantIntervals: this.stagnantIntervals,
            outcome: Object.freeze(outcome),
            deltas: Object.freeze(deltas),
            diagnostics: Object.freeze({
                trainSteps: finiteCounter(diagnostics.trainSteps),
                entropy: finiteNumber(diagnostics.entropy),
                avgReturn: finiteNumber(diagnostics.avgReturn),
                clipFraction: finiteNumber(diagnostics.clipFraction),
            }),
        }));
        if (this.history.length > this.maxHistory) this.history.shift();
    }

    summary() {
        return Object.freeze({
            version: LEARNING_AUDIT_VERSION,
            interval: this.interval,
            nextBoundary: this.nextBoundary,
            completedAudits: this.history.length,
            last: this.history.at(-1) || null,
            history: Object.freeze([...this.history]),
        });
    }

    exportSnapshot() {
        return {
            version: LEARNING_AUDIT_VERSION,
            interval: this.interval,
            maxHistory: this.maxHistory,
            nextBoundary: this.nextBoundary,
            stagnantIntervals: this.stagnantIntervals,
            history: this.history.map(entry => structuredClone(entry)),
        };
    }

    restoreSnapshot(snapshot) {
        if (snapshot?.version !== LEARNING_AUDIT_VERSION
            || positiveInteger(snapshot.interval, 0) !== this.interval
            || !Array.isArray(snapshot.history)) return false;
        this.history = snapshot.history
            .filter(validAuditEntry)
            .slice(-this.maxHistory)
            .map(entry => Object.freeze(structuredClone(entry)));
        this.stagnantIntervals = finiteCounter(snapshot.stagnantIntervals);
        const lastBoundary = this.history.at(-1)?.boundarySamples || 0;
        this.nextBoundary = Math.max(
            lastBoundary + this.interval,
            positiveInteger(snapshot.nextBoundary, this.interval),
        );
        return true;
    }
}

function validAuditEntry(entry) {
    return entry && finiteCounter(entry.boundarySamples) > 0
        && typeof entry.verdict === 'string'
        && entry.outcome && entry.deltas && entry.diagnostics;
}

function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function finiteCounter(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function positiveInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : fallback;
}
