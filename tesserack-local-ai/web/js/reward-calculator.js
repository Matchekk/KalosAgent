// reward-calculator.js - Computes verifiable rewards from game state transitions

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

    // Health management
    HP_HEALED_PER_POINT: 0.1,
    HP_LOST_PER_POINT: -0.05,

    // Penalties
    STUCK_PENALTY: -50,
    MENU_SPAM_PENALTY: -10,
    NO_PROGRESS_PENALTY: -5,
};

/**
 * Tracks game state and computes rewards for transitions
 */
export class RewardCalculator {
    constructor() {
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
        let total = 0;

        // Badge earned
        if (currState.badges.length > prevState.badges.length) {
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

        // New map discovered
        const mapKey = `${currState.location}`;
        if (!this.visitedMaps.has(mapKey)) {
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
                breakdown.hpLost = Math.round(hpDiff * REWARDS.HP_LOST_PER_POINT);
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

        // Battle won (transition from inBattle to not, without whiteout)
        if (prevState.inBattle && !currState.inBattle && !allFainted) {
            // Could differentiate wild vs trainer by money gain
            if (moneyDiff > 0) {
                breakdown.battleWon = REWARDS.TRAINER_BATTLE_WON;
            } else {
                breakdown.battleWon = REWARDS.WILD_BATTLE_WON;
            }
            total += breakdown.battleWon;
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
        return {
            totalReward: this.totalReward,
            visitedMaps: this.visitedMaps.size,
            caughtPokemon: this.caughtPokemon.size,
            rewardEvents: this.rewardHistory.length,
            recentRewards: this.rewardHistory.slice(-10),
        };
    }

    /**
     * Reset calculator state
     */
    reset() {
        this.prevState = null;
        this.totalReward = 0;
        this.rewardHistory = [];
        this.visitedMaps.clear();
        this.caughtPokemon.clear();
        this.stepsSinceProgress = 0;
        this.lastPosition = null;
        this.positionStuckCount = 0;
    }

    /**
     * Export reward history for offline analysis
     */
    exportHistory() {
        return JSON.stringify({
            totalReward: this.totalReward,
            visitedMaps: Array.from(this.visitedMaps),
            caughtPokemon: Array.from(this.caughtPokemon),
            history: this.rewardHistory,
        }, null, 2);
    }
}
