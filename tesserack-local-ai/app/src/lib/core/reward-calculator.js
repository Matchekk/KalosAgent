// reward-calculator.js - Computes verifiable rewards from game state transitions
// Uses the Red++ Champion curriculum for informational checkpoint tracking.
// Enhanced with continuous progress tracking for reward shaping

import { curriculumTracker } from './curriculum.js';
import {
    extractProgressFacts,
    computeProgressReward,
    getCurrentCheckpoint,
    measureDistanceToCheckpoint
} from './progress-tracker.js';

/**
 * Reward values for different game events
 * Based on RLVR principles - objective, verifiable milestones
 */
export const REWARDS = {
    // Major milestones
    BADGE_EARNED: 1000,
    POKEMON_CAUGHT: 100,
    POKEMON_EVOLVED: 150,

    // Progress indicators
    LEVEL_UP: 50,
    NEW_MAP: 200,
    MONEY_PER_100: 1,
    ITEM_OBTAINED: 20,

    // Battle outcomes
    WILD_BATTLE_WON: 30,
    TRAINER_BATTLE_WON: 75,
    POKEMON_FAINTED_OWN: -100,
    WHITEOUT: -500,
    DAMAGE_DEALT_PER_POINT: 0.5,
    DAMAGE_TAKEN_PER_POINT: -0.25,
    SUPER_EFFECTIVE: 12,
    NOT_VERY_EFFECTIVE: -8,
    IMMUNE_MOVE: -20,
    STAB_MOVE: 2,

    // Health management
    HP_HEALED_PER_POINT: 0.1,
    HP_LOST_PER_POINT: -0.05,

    // Penalties
    STUCK_PENALTY: -50,
    MENU_SPAM_PENALTY: -10,
    REPEATED_SAVE_PENALTY: -100,
    NO_PROGRESS_PENALTY: -5,

    // Immediate, action-specific feedback for credit assignment
    DIALOG_ADVANCED: 2,
    DIALOG_WRONG_BUTTON: -1,
    MOVEMENT_PROGRESS: 1,
    BLOCKED_MOVEMENT: -0.5,
    GAME_STARTED: 10,
};

const MOVEMENT_ACTIONS = new Set(['up', 'down', 'left', 'right']);
const SAVE_DIALOG_PATTERN = /\bSAVING\b|\bSAVED\b[\s\S]*\bGAME\b|\bGAME\b[\s\S]*\bSAVED\b/i;
const RUN_STORAGE_KEY = 'tesserack-redpp-run-v1';

export function isPlayableState(state) {
    const name = String(state?.playerName || '').trim();
    const location = String(state?.location || '').trim();
    const coordinates = state?.coordinates;
    return name.length > 0
        && name.length <= 10
        && location.length > 0
        && location !== 'UNKNOWN'
        && Number.isFinite(coordinates?.x)
        && Number.isFinite(coordinates?.y)
        && (coordinates.x !== 0 || coordinates.y !== 0)
        && Array.isArray(state?.badges)
        && state.badges.length <= 8
        && Array.isArray(state?.party)
        && state.party.length <= 6;
}

/**
 * Tracks game state and computes rewards for transitions
 */
export class RewardCalculator {
    constructor({ persistRun = false } = {}) {
        this.persistRun = persistRun;
        this.prevState = null;
        this.totalReward = 0;
        this.rewardHistory = [];
        this.visitedMaps = new Set();
        this.caughtPokemon = new Set();
        this.stepsSinceProgress = 0;
        this.lastPosition = null;
        this.positionStuckCount = 0;
        this.menuOpenCount = 0;
        this.lastMenuOpen = 0;
        this.lastSaveAt = 0;
        this.repeatedSaveCount = 0;
        this.battleWins = 0;
        this.opponentFaintedInBattle = false;
        this.runStartedAt = Date.now();
        this.bestChampionTimeMs = null;
        this.loadRunProgress();
        // Progress tracking for continuous reward shaping
        this.prevProgressFacts = null;
        this.currentCheckpointId = null;
    }

    loadRunProgress() {
        if (!this.persistRun || typeof localStorage === 'undefined') return;
        try {
            const saved = JSON.parse(localStorage.getItem(RUN_STORAGE_KEY) || 'null');
            if (!saved) return;
            this.battleWins = Math.max(0, Number(saved.battleWins) || 0);
            this.runStartedAt = Number(saved.runStartedAt) || Date.now();
            this.bestChampionTimeMs = Number(saved.bestChampionTimeMs) || null;
        } catch {
            // Ignore a malformed old metric snapshot; gameplay must continue.
        }
    }

    persistRunProgress() {
        if (!this.persistRun || typeof localStorage === 'undefined') return;
        localStorage.setItem(RUN_STORAGE_KEY, JSON.stringify({
            battleWins: this.battleWins,
            runStartedAt: this.runStartedAt,
            bestChampionTimeMs: this.bestChampionTimeMs,
        }));
    }

    syncProgressFlags(state) {
        if (state?.progressFlags?.battledRivalInOaksLab && this.battleWins < 1) {
            this.battleWins = 1;
            this.persistRunProgress();
        }
    }

    /**
     * Compute reward for a state transition
     * @param {Object} prevState - Previous game state
     * @param {Object} currState - Current game state
     * @param {string} action - Action that was taken
     * @returns {Object} - {total, breakdown} reward info
     */
    computeReward(prevState, currState, action = null) {
        if (!prevState || !currState) {
            return { total: 0, breakdown: {} };
        }

        const breakdown = {};
        this.syncProgressFlags(currState);
        let total = 0;
        const playableTransition = isPlayableState(prevState) && isPlayableState(currState);
        if (!isPlayableState(prevState) && isPlayableState(currState)) {
            breakdown.gameStarted = REWARDS.GAME_STARTED;
            total += breakdown.gameStarted;
        }

        // Dense, action-specific feedback lets the policy learn basic controls
        // before it reaches a rare milestone such as a badge or a new map.
        const prevDialog = String(prevState.dialog || '').trim();
        const currDialog = String(currState.dialog || '').trim();
        const enteredSaveDialog = SAVE_DIALOG_PATTERN.test(currDialog)
            && !SAVE_DIALOG_PATTERN.test(prevDialog);
        if (enteredSaveDialog) {
            const now = Date.now();
            if (this.lastSaveAt && now - this.lastSaveAt < 60_000) {
                this.repeatedSaveCount++;
                breakdown.repeatedSave = Math.max(
                    -500,
                    REWARDS.REPEATED_SAVE_PENALTY * this.repeatedSaveCount,
                );
                total += breakdown.repeatedSave;
            } else {
                this.repeatedSaveCount = 0;
            }
            this.lastSaveAt = now;
        }
        if (prevDialog && action === 'a' && currDialog !== prevDialog) {
            breakdown.dialogAdvanced = REWARDS.DIALOG_ADVANCED;
            total += breakdown.dialogAdvanced;
        } else if (prevDialog && action && action !== 'a') {
            breakdown.dialogWrongButton = REWARDS.DIALOG_WRONG_BUTTON;
            total += breakdown.dialogWrongButton;
        }

        if (playableTransition && MOVEMENT_ACTIONS.has(action) && !prevDialog) {
            const moved = prevState.location !== currState.location
                || prevState.coordinates.x !== currState.coordinates.x
                || prevState.coordinates.y !== currState.coordinates.y;
            breakdown.movement = moved
                ? REWARDS.MOVEMENT_PROGRESS
                : REWARDS.BLOCKED_MOVEMENT;
            total += breakdown.movement;
        }

        // Badge earned
        if (playableTransition && currState.badges.length === prevState.badges.length + 1) {
            const newBadges = currState.badges.length - prevState.badges.length;
            breakdown.badges = REWARDS.BADGE_EARNED * newBadges;
            total += breakdown.badges;
            this.stepsSinceProgress = 0;
        }

        // Pokemon caught (check party size increase or specific Pokemon)
        const prevPartyIds = new Set(prevState.party.map(p => p.speciesId));
        const currPartyIds = currState.party.map(p => p.speciesId);
        for (const id of currPartyIds) {
            if (!prevPartyIds.has(id) && !this.caughtPokemon.has(id)) {
                this.caughtPokemon.add(id);
                breakdown.caught = (breakdown.caught || 0) + REWARDS.POKEMON_CAUGHT;
                this.stepsSinceProgress = 0;
            }
        }
        if (breakdown.caught) total += breakdown.caught;

        // Level ups
        const prevLevels = prevState.party.reduce((sum, p) => sum + p.level, 0);
        const currLevels = currState.party.reduce((sum, p) => sum + p.level, 0);
        if (currLevels > prevLevels) {
            breakdown.levelUp = REWARDS.LEVEL_UP * (currLevels - prevLevels);
            total += breakdown.levelUp;
            this.stepsSinceProgress = 0;
        }

        // Give the exact button that caused damage immediate credit. The type
        // multipliers are read directly from Red++'s battle calculation RAM.
        const prevBattle = prevState.battle;
        const currBattle = currState.battle;
        if (!prevState.inBattle && currState.inBattle) {
            this.opponentFaintedInBattle = false;
        }
        if (prevState.inBattle && currState.inBattle && prevBattle && currBattle) {
            const sameOpponent = prevBattle.opponent?.speciesId === currBattle.opponent?.speciesId;
            const opponentDamage = sameOpponent
                ? Math.max(0, (prevBattle.opponent?.currentHP || 0) - (currBattle.opponent?.currentHP || 0))
                : 0;
            const ownDamage = Math.max(0, (prevBattle.active?.currentHP || 0) - (currBattle.active?.currentHP || 0));

            if (opponentDamage > 0) {
                breakdown.damageDealt = opponentDamage * REWARDS.DAMAGE_DEALT_PER_POINT;
                total += breakdown.damageDealt;
                const effectiveness = currBattle.lastMove?.effectiveness;
                if (effectiveness === 'super effective') {
                    breakdown.typeAdvantage = REWARDS.SUPER_EFFECTIVE;
                } else if (effectiveness === 'not very effective') {
                    breakdown.typeAdvantage = REWARDS.NOT_VERY_EFFECTIVE;
                } else if (effectiveness === 'immune') {
                    breakdown.typeAdvantage = REWARDS.IMMUNE_MOVE;
                }
                if (breakdown.typeAdvantage) total += breakdown.typeAdvantage;
                if (currBattle.lastMove?.stab) {
                    breakdown.stab = REWARDS.STAB_MOVE;
                    total += breakdown.stab;
                }
                this.stepsSinceProgress = 0;
            }
            if (ownDamage > 0) {
                breakdown.damageTaken = ownDamage * REWARDS.DAMAGE_TAKEN_PER_POINT;
                total += breakdown.damageTaken;
            }
            if ((currBattle.opponent?.currentHP || 0) === 0) {
                this.opponentFaintedInBattle = true;
            }
        }

        // New map discovered
        const previousMapKey = `${prevState.location}`;
        const mapKey = `${currState.location}`;
        this.visitedMaps.add(previousMapKey);
        if (playableTransition && mapKey !== previousMapKey && !this.visitedMaps.has(mapKey)) {
            this.visitedMaps.add(mapKey);
            breakdown.newMap = REWARDS.NEW_MAP;
            total += breakdown.newMap;
            this.stepsSinceProgress = 0;
        }

        // Money gained
        const moneyDiff = currState.money - prevState.money;
        if (moneyDiff > 0) {
            breakdown.money = Math.floor(moneyDiff / 100) * REWARDS.MONEY_PER_100;
            total += breakdown.money;
            if (moneyDiff >= 100) this.stepsSinceProgress = 0;
        }

        // HP changes (healing vs damage)
        const prevTotalHP = prevState.party.reduce((sum, p) => sum + p.currentHP, 0);
        const currTotalHP = currState.party.reduce((sum, p) => sum + p.currentHP, 0);
        const prevMaxHP = prevState.party.reduce((sum, p) => sum + p.maxHP, 0);
        const currMaxHP = currState.party.reduce((sum, p) => sum + p.maxHP, 0);

        // Only count HP changes if max HP is same (not from catching new Pokemon)
        if (prevMaxHP === currMaxHP && prevState.party.length === currState.party.length) {
            const hpDiff = currTotalHP - prevTotalHP;
            if (hpDiff > 0) {
                // Healed
                breakdown.healed = Math.round(hpDiff * REWARDS.HP_HEALED_PER_POINT);
                total += breakdown.healed;
            } else if (hpDiff < 0 && !currState.inBattle) {
                // Lost HP outside battle (fainted from poison, etc.)
                breakdown.hpLost = Math.round(Math.abs(hpDiff) * REWARDS.HP_LOST_PER_POINT);
                total += breakdown.hpLost;
            }
        }

        // Pokemon fainted (own)
        const prevFaintedCount = prevState.party.filter(p => p.currentHP === 0).length;
        const currFaintedCount = currState.party.filter(p => p.currentHP === 0).length;
        if (currFaintedCount > prevFaintedCount) {
            breakdown.fainted = REWARDS.POKEMON_FAINTED_OWN * (currFaintedCount - prevFaintedCount);
            total += breakdown.fainted;
        }

        // Whiteout (all Pokemon fainted - detected by being at Pokemon Center with full HP)
        const allFainted = currState.party.length > 0 &&
            currState.party.every(p => p.currentHP === 0);
        if (allFainted) {
            breakdown.whiteout = REWARDS.WHITEOUT;
            total += breakdown.whiteout;
        }

        // Red++ explicitly writes 0=win, 1=loss, 2=run/draw/capture to
        // wBattleResult, so escaped battles can no longer masquerade as wins.
        if (playableTransition && prevState.inBattle && !currState.inBattle
            && !allFainted && currState.battleResult === 0) {
            breakdown.battleWon = prevState.battle?.kind === 'trainer'
                ? REWARDS.TRAINER_BATTLE_WON
                : REWARDS.WILD_BATTLE_WON;
            total += breakdown.battleWon;
            this.battleWins++;
            this.persistRunProgress();
            this.opponentFaintedInBattle = false;
            this.stepsSinceProgress = 0;
        }

        // Stuck detection (same position for too long)
        const posKey = `${currState.location}:${currState.coordinates.x},${currState.coordinates.y}`;
        if (posKey === this.lastPosition) {
            this.positionStuckCount++;
            if (this.positionStuckCount >= 50) { // ~5 seconds
                breakdown.stuck = REWARDS.STUCK_PENALTY;
                total += breakdown.stuck;
                this.positionStuckCount = 0; // Reset to avoid repeated penalties
            }
        } else {
            this.lastPosition = posKey;
            this.positionStuckCount = 0;
        }

        // Menu spam detection
        if (action === 'start') {
            const now = Date.now();
            if (now - this.lastMenuOpen < 5000) { // Menu opened within 5s
                this.menuOpenCount++;
                if (this.menuOpenCount >= 3) {
                    breakdown.menuSpam = REWARDS.MENU_SPAM_PENALTY;
                    total += breakdown.menuSpam;
                    this.menuOpenCount = 0;
                }
            } else {
                this.menuOpenCount = 1;
            }
            this.lastMenuOpen = now;
        }

        // No progress penalty (no meaningful state change)
        this.stepsSinceProgress++;
        if (this.stepsSinceProgress >= 100) { // ~10 seconds of no progress
            breakdown.noProgress = REWARDS.NO_PROGRESS_PENALTY;
            total += breakdown.noProgress;
            this.stepsSinceProgress = 0; // Reset
        }

        // Red++ guide checkpoints are informational; their numeric reward is 0.
        const completedCheckpoints = playableTransition
            ? curriculumTracker.checkProgress(currState)
            : [];
        if (completedCheckpoints.length > 0) {
            breakdown.curriculum = 0;
            breakdown.checkpoints = [];
            for (const checkpoint of completedCheckpoints) {
                breakdown.curriculum += checkpoint.reward;
                breakdown.checkpoints.push({
                    name: checkpoint.name,
                    type: checkpoint.type,
                    reward: checkpoint.reward,
                });
            }
            total += breakdown.curriculum;
            this.stepsSinceProgress = 0; // Checkpoint = progress
        }

        // Continuous progress reward shaping (Layer 2: atomic facts)
        const currFacts = playableTransition ? extractProgressFacts(currState) : null;
        const currentCheckpoint = currFacts ? getCurrentCheckpoint(currFacts) : null;

        // Update current checkpoint target
        if (currentCheckpoint && currentCheckpoint.id !== this.currentCheckpointId) {
            this.currentCheckpointId = currentCheckpoint.id;
            this.prevProgressFacts = null; // Reset on checkpoint change
        }

        // Compute progress reward if we have previous facts
        if (currFacts && this.prevProgressFacts && this.currentCheckpointId) {
            const progressReward = computeProgressReward(
                this.prevProgressFacts,
                currFacts,
                this.currentCheckpointId
            );

            if (progressReward.reward !== 0) {
                breakdown.progress = Math.round(progressReward.reward * 10) / 10;
                breakdown.progressReason = progressReward.reason;
                breakdown.distanceToCheckpoint = Math.round(progressReward.currDistance * 100) / 100;
                total += breakdown.progress;

                if (progressReward.improvement > 0) {
                    this.stepsSinceProgress = 0; // Progress toward checkpoint
                }
            }
        }

        // Store progress facts for next iteration
        this.prevProgressFacts = currFacts;

        // Store for history
        this.totalReward += total;
        if (total !== 0) {
            this.rewardHistory.push({
                timestamp: Date.now(),
                total,
                breakdown,
                state: {
                    location: currState.location,
                    badges: currState.badges.length,
                    party: currState.party.length,
                }
            });
        }

        return { total, breakdown };
    }

    /**
     * Get summary statistics
     */
    getStats() {
        const curriculumStats = curriculumTracker.getStats();

        // Get current progress info
        let progressInfo = null;
        if (this.prevProgressFacts && this.currentCheckpointId) {
            const checkpoint = getCurrentCheckpoint(this.prevProgressFacts);
            const distance = measureDistanceToCheckpoint(this.prevProgressFacts, this.currentCheckpointId);
            progressInfo = {
                currentCheckpoint: checkpoint.description || checkpoint.id,
                distanceToCheckpoint: distance.distance,
                distancePercent: Math.round((1 - distance.distance) * 100),
                gameProgress: this.prevProgressFacts.gameProgressEstimate,
                locationOrder: this.prevProgressFacts.locationOrder,
                region: this.prevProgressFacts.region,
            };
        }

        return {
            totalReward: this.totalReward,
            visitedMaps: this.visitedMaps.size,
            caughtPokemon: this.caughtPokemon.size,
            battleWins: this.battleWins,
            runElapsedMs: Date.now() - this.runStartedAt,
            bestChampionTimeMs: this.bestChampionTimeMs,
            rewardEvents: this.rewardHistory.length,
            recentRewards: this.rewardHistory.slice(-10),
            // Curriculum progress
            curriculum: {
                completed: curriculumStats.completedCheckpoints,
                total: curriculumStats.totalCheckpoints,
                percent: curriculumStats.completionPercent,
                badges: curriculumStats.badges,
                nextObjective: curriculumStats.nextCheckpoint?.name || 'Complete!',
            },
            // Continuous progress tracking
            progress: progressInfo,
        };
    }

    /**
     * Get curriculum summary for LLM context
     * @returns {string}
     */
    getCurriculumSummary() {
        return curriculumTracker.getSummaryForLLM();
    }

    /**
     * Reset calculator state
     * @param {boolean} includeCurriculum - Also reset curriculum progress
     */
    reset(includeCurriculum = false) {
        this.prevState = null;
        this.totalReward = 0;
        this.rewardHistory = [];
        this.visitedMaps.clear();
        this.caughtPokemon.clear();
        this.stepsSinceProgress = 0;
        this.lastPosition = null;
        this.positionStuckCount = 0;
        this.lastSaveAt = 0;
        this.repeatedSaveCount = 0;
        this.battleWins = 0;
        this.opponentFaintedInBattle = false;
        // Reset progress tracking
        this.prevProgressFacts = null;
        this.currentCheckpointId = null;

        if (includeCurriculum) {
            curriculumTracker.reset();
        }
    }

    /**
     * Export reward history for offline analysis
     */
    exportHistory() {
        return JSON.stringify({
            totalReward: this.totalReward,
            visitedMaps: Array.from(this.visitedMaps),
            caughtPokemon: Array.from(this.caughtPokemon),
            battleWins: this.battleWins,
            history: this.rewardHistory,
            currentProgress: this.prevProgressFacts,
            currentCheckpoint: this.currentCheckpointId,
        }, null, 2);
    }

    /**
     * Get current progress facts for UI display
     * @returns {Object|null} Progress facts
     */
    getProgressFacts() {
        return this.prevProgressFacts;
    }

    /**
     * Get current checkpoint info for UI display
     * @returns {Object|null} Checkpoint info
     */
    getCurrentCheckpointInfo() {
        if (!this.prevProgressFacts || !this.currentCheckpointId) {
            return null;
        }
        return getCurrentCheckpoint(this.prevProgressFacts);
    }
}
