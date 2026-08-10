import { normalizeRedppLocation } from './redpp-location-data.js';

/**
 * Outcome-only Red++ progress proof.
 *
 * Reward, return, entropy, checkpoints and archive cells are deliberately not
 * part of this metric. A milestone is credited only from stable RAM state.
 * The dedicated fresh-start worker must reproduce it in separate episodes
 * before the UI calls it verified.
 */

export const AUTONOMOUS_PROGRESS_VERSION = 1;
export const AUTONOMOUS_PROOF_RUNS = 3;
export const AUTONOMOUS_TARGET_LEVEL = 13; // Boulder Badge

export const AUTONOMOUS_MILESTONES = Object.freeze([
    Object.freeze({ level: 0, id: 'rom_start', label: 'ROM start' }),
    Object.freeze({ level: 1, id: 'players_house_2f', label: 'Players House 2F' }),
    Object.freeze({ level: 2, id: 'players_house_1f', label: 'Players House 1F' }),
    Object.freeze({ level: 3, id: 'pallet_town', label: 'Pallet Town outdoors' }),
    Object.freeze({ level: 4, id: 'oaks_lab', label: "Oak's Lab" }),
    Object.freeze({ level: 5, id: 'starter', label: 'Starter selected' }),
    Object.freeze({ level: 6, id: 'oak_rival', label: 'Oak rival defeated' }),
    Object.freeze({ level: 7, id: 'route_1', label: 'Route 1' }),
    Object.freeze({ level: 8, id: 'viridian_city', label: 'Viridian City' }),
    Object.freeze({ level: 9, id: 'route_2', label: 'Route 2' }),
    Object.freeze({ level: 10, id: 'viridian_forest', label: 'Viridian Forest' }),
    Object.freeze({ level: 11, id: 'pewter_city', label: 'Pewter City' }),
    Object.freeze({ level: 12, id: 'pewter_gym', label: 'Pewter Gym entered' }),
    Object.freeze({ level: 13, id: 'boulder_badge', label: 'Boulder Badge' }),
    Object.freeze({ level: 14, id: 'badge_2', label: '2 badges' }),
    Object.freeze({ level: 15, id: 'badge_3', label: '3 badges' }),
    Object.freeze({ level: 16, id: 'badge_4', label: '4 badges' }),
    Object.freeze({ level: 17, id: 'badge_5', label: '5 badges' }),
    Object.freeze({ level: 18, id: 'badge_6', label: '6 badges' }),
    Object.freeze({ level: 19, id: 'badge_7', label: '7 badges' }),
    Object.freeze({ level: 20, id: 'badge_8', label: '8 badges' }),
    Object.freeze({ level: 21, id: 'champion', label: 'Champion' }),
]);

const LOCATION_LEVELS = Object.freeze({
    'PLAYERS HOUSE 2F': 1,
    'PLAYERS HOUSE 1F': 2,
    'PALLET TOWN': 3,
    'OAKS LAB': 4,
    'ROUTE 1': 7,
    'VIRIDIAN CITY': 8,
    'ROUTE 2': 9,
    'VIRIDIAN FOREST': 10,
    'PEWTER CITY': 11,
    'PEWTER GYM': 12,
});

const INVALID_LOCATIONS = new Set(['', 'NO ACTIVE MAP', 'UNKNOWN']);
const CHAMPION_LOCATIONS = new Set(['HALL OF FAME', 'CHAMPIONS ROOM']);

export function milestoneAt(level) {
    const bounded = Math.max(0, Math.min(AUTONOMOUS_MILESTONES.length - 1,
        Math.trunc(Number(level) || 0)));
    return AUTONOMOUS_MILESTONES[bounded];
}

export function hasCredibleParty(state) {
    const party = Array.isArray(state?.party) ? state.party : [];
    return party.length > 0 && party.length <= 6 && party.every(mon => {
        const species = Number(mon?.speciesId);
        const level = Number(mon?.level);
        return Number.isInteger(species) && species > 0 && species <= 208
            && Number.isInteger(level) && level > 0 && level <= 100;
    });
}

export function hasActiveMap(state) {
    const location = normalizeRedppLocation(state?.location);
    return !INVALID_LOCATIONS.has(location)
        && !location.startsWith('UNKNOWN (')
        && Number.isFinite(Number(state?.coordinates?.x))
        && Number.isFinite(Number(state?.coordinates?.y));
}

/** Return the strongest milestone directly supported by the current RAM state. */
export function detectAutonomousMilestone(state = {}) {
    if (!hasActiveMap(state)) return 0;
    const location = normalizeRedppLocation(state.location);
    const party = hasCredibleParty(state);
    const badges = Math.max(0, Math.min(8, Math.trunc(Number(state.badgeCount) || 0)));

    if (party && CHAMPION_LOCATIONS.has(location)) return 21;
    if (party && badges > 0) return 12 + badges;
    if (party && state.progressFlags?.battledRivalInOaksLab) {
        return Math.max(6, LOCATION_LEVELS[location] || 0);
    }
    if (party) return 5;
    return LOCATION_LEVELS[location] && LOCATION_LEVELS[location] <= 4
        ? LOCATION_LEVELS[location]
        : 0;
}

export class AutonomousProgressTracker {
    constructor({
        freshWorkerId = 3,
        proofRuns = AUTONOMOUS_PROOF_RUNS,
        targetLevel = AUTONOMOUS_TARGET_LEVEL,
        stableObservations = 3,
    } = {}) {
        this.freshWorkerId = Math.max(0, Math.trunc(Number(freshWorkerId) || 0));
        this.proofRuns = Math.max(1, Math.trunc(Number(proofRuns) || AUTONOMOUS_PROOF_RUNS));
        this.targetLevel = Math.max(1, Math.min(21, Math.trunc(Number(targetLevel) || AUTONOMOUS_TARGET_LEVEL)));
        this.stableObservations = Math.max(1, Math.trunc(Number(stableObservations) || 3));
        this.workers = new Map();
        this.hitEpisodes = Array.from({ length: AUTONOMOUS_MILESTONES.length }, () => new Set());
        this.frontierLevel = 0;
        this.frontierWorker = null;
        this.frontierAtSample = 0;
        this.freshBestLevel = 0;
        this.freshBestEpisodeSteps = null;
        this.freshLastProgressSample = 0;
        this.freshAttemptsStarted = 0;
        this.freshEpisodeBase = 0;
    }

    observe({ workerId, state, episode = 1, episodeSteps = 0, totalSamples = 0 } = {}) {
        const id = Math.max(0, Math.trunc(Number(workerId) || 0));
        const currentEpisode = Math.max(1, Math.trunc(Number(episode) || 1));
        const proofEpisode = id === this.freshWorkerId
            ? this.freshEpisodeBase + currentEpisode
            : currentEpisode;
        const detected = detectAutonomousMilestone(state);
        const worker = this.workers.get(id) || {
            candidateLevel: -1,
            candidateCount: 0,
            bestLevel: 0,
            episode: currentEpisode,
        };

        if (worker.episode !== currentEpisode) {
            worker.episode = currentEpisode;
            worker.candidateLevel = -1;
            worker.candidateCount = 0;
        }
        if (worker.candidateLevel === detected) worker.candidateCount++;
        else {
            worker.candidateLevel = detected;
            worker.candidateCount = 1;
        }

        if (worker.candidateCount >= this.stableObservations && detected > worker.bestLevel) {
            worker.bestLevel = detected;
            if (detected > this.frontierLevel) {
                this.frontierLevel = detected;
                this.frontierWorker = id;
                this.frontierAtSample = finiteCounter(totalSamples);
            }
            if (id === this.freshWorkerId) {
                this._creditFreshEpisode(proofEpisode, detected);
                if (detected > this.freshBestLevel) {
                    this.freshBestLevel = detected;
                    this.freshBestEpisodeSteps = finiteCounter(episodeSteps);
                    this.freshLastProgressSample = finiteCounter(totalSamples);
                }
            }
        } else if (id === this.freshWorkerId && worker.candidateCount >= this.stableObservations) {
            this._creditFreshEpisode(proofEpisode, detected);
        }

        if (id === this.freshWorkerId) {
            this.freshAttemptsStarted = Math.max(this.freshAttemptsStarted, proofEpisode);
        }
        this.workers.set(id, worker);
        return this.summary(totalSamples);
    }

    _creditFreshEpisode(episode, level) {
        for (let current = 1; current <= level; current++) {
            this.hitEpisodes[current].add(episode);
        }
    }

    summary(totalSamples = 0) {
        let verifiedLevel = 0;
        for (let level = 1; level < this.hitEpisodes.length; level++) {
            if (this.hitEpisodes[level].size >= this.proofRuns) verifiedLevel = level;
        }
        const targetSuccesses = this.hitEpisodes[this.targetLevel]?.size || 0;
        const attempts = Math.max(1, this.freshAttemptsStarted);
        const samples = finiteCounter(totalSamples);
        let status = 'collecting';
        if (verifiedLevel >= this.targetLevel) status = 'proven';
        else if (verifiedLevel > 0) status = 'verified-progress';
        else if (this.freshBestLevel > 0) status = 'unverified-progress';
        else if (samples >= 25_000) status = 'stalled';

        return Object.freeze({
            version: AUTONOMOUS_PROGRESS_VERSION,
            mode: 'fresh-rom-no-checkpoint',
            evaluationWorker: this.freshWorkerId,
            proofRunsRequired: this.proofRuns,
            targetLevel: this.targetLevel,
            targetMilestone: milestoneAt(this.targetLevel).label,
            frontierLevel: this.frontierLevel,
            frontierMilestone: milestoneAt(this.frontierLevel).label,
            frontierWorker: this.frontierWorker,
            frontierAtSample: this.frontierAtSample,
            freshBestLevel: this.freshBestLevel,
            freshBestMilestone: milestoneAt(this.freshBestLevel).label,
            freshBestEpisodeSteps: this.freshBestEpisodeSteps,
            verifiedLevel,
            verifiedMilestone: milestoneAt(verifiedLevel).label,
            verifiedProofRuns: this.hitEpisodes[verifiedLevel]?.size || 0,
            attempts,
            targetSuccesses,
            targetSuccessRate: targetSuccesses / attempts,
            samplesSinceFreshProgress: Math.max(0, samples - this.freshLastProgressSample),
            progressPct: (verifiedLevel / (AUTONOMOUS_MILESTONES.length - 1)) * 100,
            targetProven: verifiedLevel >= this.targetLevel,
            status,
        });
    }

    exportSnapshot() {
        return {
            version: AUTONOMOUS_PROGRESS_VERSION,
            freshWorkerId: this.freshWorkerId,
            proofRuns: this.proofRuns,
            targetLevel: this.targetLevel,
            stableObservations: this.stableObservations,
            hitEpisodes: this.hitEpisodes.map(episodes => [...episodes]),
            frontierLevel: this.frontierLevel,
            frontierWorker: this.frontierWorker,
            frontierAtSample: this.frontierAtSample,
            freshBestLevel: this.freshBestLevel,
            freshBestEpisodeSteps: this.freshBestEpisodeSteps,
            freshLastProgressSample: this.freshLastProgressSample,
            freshAttemptsStarted: this.freshAttemptsStarted,
        };
    }

    restoreSnapshot(snapshot) {
        if (snapshot?.version !== AUTONOMOUS_PROGRESS_VERSION) return false;
        this.frontierLevel = boundedLevel(snapshot.frontierLevel);
        this.frontierWorker = Number.isInteger(snapshot.frontierWorker) ? snapshot.frontierWorker : null;
        this.frontierAtSample = finiteCounter(snapshot.frontierAtSample);
        this.freshBestLevel = boundedLevel(snapshot.freshBestLevel);
        this.freshBestEpisodeSteps = Number.isFinite(Number(snapshot.freshBestEpisodeSteps))
            ? finiteCounter(snapshot.freshBestEpisodeSteps) : null;
        this.freshLastProgressSample = finiteCounter(snapshot.freshLastProgressSample);
        this.freshAttemptsStarted = finiteCounter(snapshot.freshAttemptsStarted);
        // A browser/process reload restarts the trainer-local episode counter at
        // one. Continue after the persisted attempts so the same episode can
        // never be credited as multiple independent proof runs.
        this.freshEpisodeBase = this.freshAttemptsStarted;
        if (Array.isArray(snapshot.hitEpisodes)) {
            for (let level = 1; level < this.hitEpisodes.length; level++) {
                const episodes = Array.isArray(snapshot.hitEpisodes[level]) ? snapshot.hitEpisodes[level] : [];
                this.hitEpisodes[level] = new Set(episodes.map(finiteCounter).filter(Boolean));
            }
        }
        return true;
    }
}

function boundedLevel(value) {
    return Math.max(0, Math.min(AUTONOMOUS_MILESTONES.length - 1,
        Math.trunc(Number(value) || 0)));
}

function finiteCounter(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}
