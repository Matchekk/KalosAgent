/**
 * Context-gated Red++ reinforcement rewards.
 *
 * Test bundles now provide guide metadata only. Numeric learning signals come
 * from one versioned matrix so an outdated walkthrough cannot silently alter
 * the optimization objective.
 */
import {
    REDPP_REWARD_MATRIX,
    REDPP_REWARD_MATRIX_VERSION,
    REWARD_CONTEXT,
    clamp,
    classifyRewardContext,
    dialogProgress,
    hpRatio,
} from './redpp-reward-matrix.js';
import { redppGuideToBundles } from './redpp-guide-data.js';

const DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const CHAMPION_LOCATIONS = new Set(['HALL OF FAME', 'CHAMPIONS ROOM']);
const SAVE_TEXT = /(?:SAVED THE GAME|SAVE COMPLETE|GAME HAS BEEN SAVED)/i;

export class UnitTestRewards {
    constructor(config = {}) {
        this.config = {
            tier1Weight: config.tier1Weight ?? 1,
            tier2Weight: config.tier2Weight ?? 1,
            tier3Weight: config.tier3Weight ?? 1,
            penaltyWeight: config.penaltyWeight ?? 1,
            enableTier1: config.enableTier1 ?? true,
            enableTier2: config.enableTier2 ?? true,
            enableTier3: config.enableTier3 ?? true,
            enablePenalties: config.enablePenalties ?? true,
            bundlesUrl: config.bundlesUrl ?? '/data/redpp-oak-guide.json',
        };

        this.bundles = null;
        this.bundlesLoaded = false;
        this.currentLocation = null;
        this.currentBundle = null;
        this.firedOnce = new Set();
        this.completedObjectives = [];

        this.positionVisits = new Map();
        this.visitedPositions = new Set();
        this.visitedLocations = new Set();
        this.recentPositions = [];
        this.stuckCounter = 0;
        this.consecutiveStartActions = 0;
        this.transitionCount = 0;
        this.lastSaveTransition = -Infinity;
        this.saveStreak = 0;
        this.championReached = false;

        this.totalRewards = this._emptyBreakdown(true);
        this.firedTests = [];
        this.lastContext = REWARD_CONTEXT.OVERWORLD;
    }

    async loadBundles(url = null) {
        const bundleUrl = url || this.config.bundlesUrl;
        try {
            const response = await fetch(bundleUrl);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            this.bundles = data.sections ? redppGuideToBundles(data) : (data.bundles || data);
        } catch (error) {
            console.warn('[UnitTestRewards] Guide metadata unavailable:', error.message);
            this.bundles = this._getDefaultBundles();
        }
        this.bundlesLoaded = true;
        this.currentBundle = this.bundles._default || this._getDefaultBundle();
    }

    setLocation(locationName) {
        if (!this.bundles || !locationName) return;
        const normalized = normalizeLocation(locationName);
        this.currentBundle = this.bundles[normalized] || Object.entries(this.bundles)
            .find(([key]) => key !== '_default' && (normalized.includes(key) || key.includes(normalized)))?.[1]
            || this.bundles._default
            || this._getDefaultBundle();
        this.currentLocation = normalized;
    }

    evaluate(prevState = {}, currState = {}, action = null) {
        this._ensureBundles();
        this.transitionCount++;
        if (currState?.location && normalizeLocation(currState.location) !== this.currentLocation) {
            this.setLocation(currState.location);
        }

        const context = classifyRewardContext(prevState, currState);
        const breakdown = this._emptyBreakdown();
        const fired = [];
        const add = (id, reward, tier, metadata = {}) => {
            if (!Number.isFinite(reward) || reward === 0) return;
            const weighted = this._weightedReward(reward, tier);
            if (weighted === 0) return;
            const key = tier === 1 ? 'tier1' : tier === 2 ? 'tier2' : tier === 3 ? 'tier3' : 'penalties';
            breakdown[key] += weighted;
            fired.push({ id, reward: weighted, tier: tier === 'penalty' ? 'penalty' : tier, ...metadata });
        };

        this._evaluateDurableMilestones(prevState, currState, add);

        if (context === REWARD_CONTEXT.DIALOG) {
            this._evaluateDialog(prevState, currState, action, add);
        } else if (context === REWARD_CONTEXT.BATTLE) {
            this._evaluateBattle(prevState, currState, add);
            this._resetSpatialPenaltyState();
        } else {
            this._evaluateOverworld(prevState, currState, action, add);
        }

        this._evaluateSaveBehavior(prevState, currState, add);
        breakdown.total = breakdown.tier1 + breakdown.tier2 + breakdown.tier3 + breakdown.penalties;

        for (const key of ['tier1', 'tier2', 'tier3', 'penalties', 'total']) {
            this.totalRewards[key] += breakdown[key];
        }
        this.firedTests = fired;
        this.lastContext = context;

        const bundle = this.currentBundle || this._getDefaultBundle();
        return {
            total: breakdown.total,
            breakdown: {
                tier1: breakdown.tier1,
                tier2: breakdown.tier2,
                tier3: breakdown.tier3,
                penalties: breakdown.penalties,
            },
            firedTests: fired,
            context,
            matrixVersion: REDPP_REWARD_MATRIX_VERSION,
            currentLocation: this.currentLocation,
            bundleInfo: {
                location: this.currentLocation,
                testCount: bundle.tests?.length || 0,
                penaltyCount: 0,
                objectiveCount: bundle.objectives?.length || 0,
                encounterCount: bundle.encounters?.length || 0,
                source: bundle.source || 'Red++ reward matrix',
                guideVersion: bundle.guide_version || null,
                targetRomVersion: bundle.target_rom_version || null,
            },
        };
    }

    _evaluateDialog(prev, curr, action, add) {
        this._resetSpatialPenaltyState();
        const progress = dialogProgress(prev, curr);
        if (action === 'a' && (progress.changed || progress.closed)) {
            add('dialog_advanced', progress.closed
                ? REDPP_REWARD_MATRIX.dialog.closed
                : REDPP_REWARD_MATRIX.dialog.advanced, 1,
            { context: REWARD_CONTEXT.DIALOG });
        } else if ((DIRECTIONS.has(action) || action === 'start') && !progress.changed && !progress.closed) {
            add('dialog_inaction', REDPP_REWARD_MATRIX.dialog.inaction, 'penalty',
                { context: REWARD_CONTEXT.DIALOG });
        }
    }

    _evaluateOverworld(prev, curr, action, add) {
        const matrix = REDPP_REWARD_MATRIX.overworld;
        const prevKey = this._positionKey(prev);
        const currKey = this._positionKey(curr);
        this._rememberInitialPosition(prevKey);

        const moved = this._coordsChanged(prev, curr);
        const locationChanged = normalizeLocation(prev?.location) !== normalizeLocation(curr?.location)
            && Boolean(prev?.location && curr?.location);
        const dialogChanged = dialogProgress(prev, curr).changed || dialogProgress(prev, curr).closed;

        if (action) add('decision_cost', matrix.decisionCost, 'penalty', { context: REWARD_CONTEXT.OVERWORLD });

        if (locationChanged && curr?.location && !this.visitedLocations.has(normalizeLocation(curr.location))) {
            this.visitedLocations.add(normalizeLocation(curr.location));
            add('new_location', matrix.newLocation, 2, { context: REWARD_CONTEXT.OVERWORLD });
        }

        if (moved && currKey) {
            const visits = this.positionVisits.get(currKey) || 0;
            if (visits === 0) {
                add('novel_tile', matrix.novelTile, 1, { context: REWARD_CONTEXT.OVERWORLD });
            } else {
                const revisit = Math.max(matrix.revisitCap, matrix.revisitBase * Math.sqrt(visits));
                add('revisited_tile', revisit, 'penalty', { context: REWARD_CONTEXT.OVERWORLD, visits });
            }

            const last = this.recentPositions.at(-1);
            const twoBack = this.recentPositions.at(-2);
            if (currKey === twoBack && prevKey === last) {
                add('two_tile_loop', matrix.twoCycle, 'penalty', { context: REWARD_CONTEXT.OVERWORLD });
            }
            this._rememberPosition(currKey);
            this.stuckCounter = 0;
        } else if (DIRECTIONS.has(action) && !locationChanged && !dialogChanged) {
            this.stuckCounter++;
            add('blocked_movement', matrix.blockedMovement, 'penalty', { context: REWARD_CONTEXT.OVERWORLD });
            if (this.stuckCounter >= matrix.stuckStart) {
                const stuck = Math.max(matrix.stuckCap, matrix.stuckSlope * (this.stuckCounter - matrix.stuckStart + 1));
                add('stuck', stuck, 'penalty', { context: REWARD_CONTEXT.OVERWORLD, count: this.stuckCounter });
            }
        } else if (action !== 'start') {
            this.stuckCounter = 0;
        }

        if (action === 'start' && !locationChanged && !dialogChanged) {
            this.consecutiveStartActions++;
            const excess = this.consecutiveStartActions - REDPP_REWARD_MATRIX.menu.freeStartActions;
            if (excess > 0) {
                const spam = Math.max(REDPP_REWARD_MATRIX.menu.spamCap,
                    REDPP_REWARD_MATRIX.menu.spamBase * (2 ** (excess - 1)));
                add('menu_spam', spam, 'penalty', { context: REWARD_CONTEXT.OVERWORLD, streak: this.consecutiveStartActions });
            }
        } else {
            this.consecutiveStartActions = 0;
        }
    }

    _evaluateBattle(prev, curr, add) {
        let dense = 0;
        const prevBattle = prev?.battle;
        const currBattle = curr?.battle;

        // Red++ reuses battle WRAM during boot and state restoration. A lone
        // non-zero wIsInBattle byte can therefore look like a zero-result win
        // before a starter exists. Only score battle transitions backed by a
        // real party and coherent combatant structs.
        if (!isCredibleBattleState(prev, prevBattle)) return;

        if (prev?.inBattle && curr?.inBattle && prevBattle && currBattle) {
            if (prevBattle.opponent?.speciesId === currBattle.opponent?.speciesId) {
                const enemyDelta = Math.max(0, hpRatio(prevBattle.opponent) - hpRatio(currBattle.opponent));
                dense += enemyDelta * REDPP_REWARD_MATRIX.battle.enemyHpFraction;
                if (enemyDelta > 0) {
                    const effect = currBattle.lastMove?.effectiveness;
                    if (effect === 'super effective') dense += REDPP_REWARD_MATRIX.battle.superEffective;
                    if (effect === 'not very effective') dense += REDPP_REWARD_MATRIX.battle.resisted;
                    if (effect === 'immune') dense += REDPP_REWARD_MATRIX.battle.immune;
                    if (currBattle.lastMove?.stab) dense += REDPP_REWARD_MATRIX.battle.stab;
                }
            }
            const ownDelta = Math.max(0, hpRatio(prevBattle.active) - hpRatio(currBattle.active));
            dense += ownDelta * REDPP_REWARD_MATRIX.battle.ownHpFraction;
        }

        dense = clamp(dense, -REDPP_REWARD_MATRIX.denseRewardCap, REDPP_REWARD_MATRIX.denseRewardCap);
        add('redpp_battle_progress', dense, dense >= 0 ? 1 : 'penalty', { context: REWARD_CONTEXT.BATTLE });

        if (prev?.inBattle && !curr?.inBattle) {
            if (curr?.battleResult === 0) {
                const trainer = prevBattle?.kind === 'trainer';
                add('redpp_battle_won', trainer
                    ? REDPP_REWARD_MATRIX.battle.trainerWin
                    : REDPP_REWARD_MATRIX.battle.wildWin, 2,
                { context: REWARD_CONTEXT.BATTLE, kind: trainer ? 'trainer' : 'wild' });
            } else if (curr?.battleResult === 1) {
                add('redpp_battle_lost', REDPP_REWARD_MATRIX.battle.loss, 'penalty', { context: REWARD_CONTEXT.BATTLE });
            } else {
                add('redpp_battle_escaped', REDPP_REWARD_MATRIX.battle.escapeOrDraw, 'penalty', { context: REWARD_CONTEXT.BATTLE });
            }
        }
    }

    _evaluateDurableMilestones(prev, curr, add) {
        const matrix = REDPP_REWARD_MATRIX.milestone;
        const badgeDelta = Math.max(0, (curr?.badgeCount || 0) - (prev?.badgeCount || 0));
        if (badgeDelta > 0) add('badge_earned', matrix.badge * badgeDelta, 3, { count: badgeDelta });

        const partyDelta = Math.max(0, (curr?.party?.length || 0) - (prev?.party?.length || 0));
        if (partyDelta > 0) add('pokemon_caught', matrix.partyMember * partyDelta, 3, { count: partyDelta });

        const levelDelta = this._sharedPartyLevelGain(prev?.party, curr?.party);
        if (levelDelta > 0) {
            add('level_up', Math.min(matrix.levelCap, matrix.levelUnit * Math.sqrt(levelDelta)), 2, { levels: levelDelta });
        }

        if (curr?.progressFlags?.battledRivalInOaksLab && !prev?.progressFlags?.battledRivalInOaksLab) {
            add('oak_rival_defeated', matrix.oakRival, 3);
        }

        const wasWhiteout = this._allFainted(prev);
        if (this._allFainted(curr) && !wasWhiteout) add('whiteout', matrix.whiteout, 'penalty');

        if (!this.championReached && this._isChampionState(curr)) {
            this.championReached = true;
            add('redpp_champion', matrix.champion, 3);
            this.completedObjectives.push('redpp_champion');
        }
    }

    _evaluateSaveBehavior(prev, curr, add) {
        const before = String(prev?.dialog || '');
        const after = String(curr?.dialog || '');
        if (!SAVE_TEXT.test(after) || after === before) return;

        const distance = this.transitionCount - this.lastSaveTransition;
        this.saveStreak = distance <= REDPP_REWARD_MATRIX.menu.saveCooldown ? this.saveStreak + 1 : 1;
        this.lastSaveTransition = this.transitionCount;
        if (this.saveStreak <= 1) return;

        const penalty = Math.max(REDPP_REWARD_MATRIX.menu.repeatSaveCap,
            REDPP_REWARD_MATRIX.menu.repeatSaveBase * (2 ** (this.saveStreak - 2)));
        add('repeat_save', penalty, 'penalty', { streak: this.saveStreak, cooldown: distance });
    }

    _weightedReward(reward, tier) {
        if (tier === 1) return this.config.enableTier1 ? reward * this.config.tier1Weight : 0;
        if (tier === 2) return this.config.enableTier2 ? reward * this.config.tier2Weight : 0;
        if (tier === 3) return this.config.enableTier3 ? reward * this.config.tier3Weight : 0;
        return this.config.enablePenalties ? reward * this.config.penaltyWeight : 0;
    }

    _sharedPartyLevelGain(prevParty = [], currParty = []) {
        let gain = 0;
        for (let i = 0; i < Math.min(prevParty.length, currParty.length); i++) {
            if (prevParty[i]?.speciesId !== currParty[i]?.speciesId) continue;
            gain += Math.max(0, (currParty[i]?.level || 0) - (prevParty[i]?.level || 0));
        }
        return gain;
    }

    _coordsChanged(prev, curr) {
        return Number.isFinite(prev?.coordinates?.x) && Number.isFinite(prev?.coordinates?.y)
            && Number.isFinite(curr?.coordinates?.x) && Number.isFinite(curr?.coordinates?.y)
            && (prev.coordinates.x !== curr.coordinates.x || prev.coordinates.y !== curr.coordinates.y);
    }

    _positionKey(state) {
        if (!state?.location || !Number.isFinite(state?.coordinates?.x) || !Number.isFinite(state?.coordinates?.y)) return null;
        const progress = `${state.badgeCount || 0}:${state.party?.length || 0}:${state.progressFlags?.battledRivalInOaksLab ? 1 : 0}`;
        return `${progress}:${normalizeLocation(state.location)}:${state.coordinates.x}:${state.coordinates.y}`;
    }

    _rememberInitialPosition(key) {
        if (this.positionVisits.size === 0 && key) this._rememberPosition(key);
    }

    _rememberPosition(key) {
        if (!key) return;
        this.positionVisits.set(key, (this.positionVisits.get(key) || 0) + 1);
        this.visitedPositions.add(key);
        this.recentPositions.push(key);
        if (this.recentPositions.length > 32) this.recentPositions.shift();
    }

    _resetSpatialPenaltyState() {
        this.stuckCounter = 0;
        this.consecutiveStartActions = 0;
    }

    _allFainted(state) {
        return Boolean(state?.party?.length && state.party.every(mon => mon.currentHP === 0));
    }

    _isChampionState(state) {
        return CHAMPION_LOCATIONS.has(normalizeLocation(state?.location));
    }

    _ensureBundles() {
        if (this.bundlesLoaded) return;
        this.bundles = this._getDefaultBundles();
        this.currentBundle = this.bundles._default;
        this.bundlesLoaded = true;
    }

    _getDefaultBundles() {
        return { _default: this._getDefaultBundle() };
    }

    _getDefaultBundle() {
        return {
            source: 'Red++ v3 reward matrix',
            objectives: [],
            next_locations: [],
            tests: [],
            penalties: [],
        };
    }

    _emptyBreakdown(includeTotal = false) {
        const value = { tier1: 0, tier2: 0, tier3: 0, penalties: 0 };
        if (includeTotal) value.total = 0;
        return value;
    }

    reset() {
        this.positionVisits.clear();
        this.visitedPositions.clear();
        this.visitedLocations.clear();
        this.recentPositions = [];
        this.stuckCounter = 0;
        this.consecutiveStartActions = 0;
        this.transitionCount = 0;
        this.lastSaveTransition = -Infinity;
        this.saveStreak = 0;
        this.championReached = false;
        this.firedOnce.clear();
        this.completedObjectives = [];
        this.totalRewards = this._emptyBreakdown(true);
        this.firedTests = [];
        this.currentLocation = null;
        this.currentBundle = this.bundles?._default || this._getDefaultBundle();
    }

    getStats() {
        return {
            matrixVersion: REDPP_REWARD_MATRIX_VERSION,
            context: this.lastContext,
            totalRewards: { ...this.totalRewards },
            visitedLocations: this.visitedLocations.size,
            visitedPositions: this.visitedPositions.size,
            stuckCounter: this.stuckCounter,
            saveStreak: this.saveStreak,
            completedObjectives: [...this.completedObjectives],
            currentLocation: this.currentLocation,
            bundleInfo: this.currentBundle ? {
                testCount: this.currentBundle.tests?.length || 0,
                penaltyCount: 0,
                objectiveCount: this.currentBundle.objectives?.length || 0,
                encounterCount: this.currentBundle.encounters?.length || 0,
                objectives: this.currentBundle.objectives || [],
                nextLocations: this.currentBundle.next_locations || [],
                source: this.currentBundle.source || 'Red++ reward matrix',
                guideVersion: this.currentBundle.guide_version || null,
                targetRomVersion: this.currentBundle.target_rom_version || null,
            } : null,
        };
    }
}

function isCredibleBattleState(state, battle) {
    const party = Array.isArray(state?.party) ? state.party : [];
    // MemoryReader always supplies battleType. Lightweight deterministic test
    // adapters predate that field, so keep accepting those synthetic states.
    if (battle?.battleType == null) return Boolean(battle);
    return party.length > 0 && (battle.battleType === 1 || battle.battleType === 2);
}

function normalizeLocation(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
}

export default UnitTestRewards;
