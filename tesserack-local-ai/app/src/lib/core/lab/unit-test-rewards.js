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
import { analyzeRedppTeam } from './redpp-team-quality.js';

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
        this.dialogCredits = new Map();
        this.recentPositions = [];
        this.stuckCounter = 0;
        this.menuSteps = 0;
        this.menuReopenStreak = 0;
        this.lastMenuCloseTransition = -Infinity;
        this.transitionCount = 0;
        this.lastSaveTransition = -Infinity;
        this.saveStreak = 0;
        this.championReached = false;
        this.maxPartySize = 0;
        this.bestTeamQuality = 0;
        this.lastTeamAnalysis = analyzeRedppTeam([]);

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
        } else if (context === REWARD_CONTEXT.MENU) {
            this._evaluateMenu(prevState, currState, action, add);
        } else if (context === REWARD_CONTEXT.INACTIVE) {
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
            const matrix = REDPP_REWARD_MATRIX.dialog;
            const key = this._positionKey(curr) || this._positionKey(prev) || 'unknown';
            const credit = this.dialogCredits.get(key) || { count: 0, total: 0 };
            const base = progress.closed ? matrix.closed : matrix.advanced;
            const remaining = Math.max(0, matrix.positionCap - credit.total);
            const reward = Math.min(remaining, base * (matrix.diminishingFactor ** credit.count));
            credit.count++;
            credit.total += reward;
            this.dialogCredits.set(key, credit);
            add('dialog_advanced', reward, 1, {
                context: REWARD_CONTEXT.DIALOG,
                dialogCredit: credit.total,
                dialogCreditCap: matrix.positionCap,
            });
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
            const recentVisits = this.recentPositions.reduce(
                (count, position) => count + (position === currKey ? 1 : 0), 0);
            if (visits === 0) {
                add('novel_tile', matrix.novelTile, 1, { context: REWARD_CONTEXT.OVERWORLD });
            } else {
                const revisit = Math.max(matrix.revisitCap, matrix.revisitBase * Math.sqrt(visits));
                add('revisited_tile', revisit, 'penalty', { context: REWARD_CONTEXT.OVERWORLD, visits });
            }

            if (recentVisits >= matrix.recentRepeatThreshold) {
                const excess = recentVisits - matrix.recentRepeatThreshold;
                const loopPenalty = Math.max(matrix.recentLoopCap,
                    matrix.recentLoopBase + matrix.recentLoopSlope * excess);
                add('recent_movement_loop', loopPenalty, 'penalty', {
                    context: REWARD_CONTEXT.OVERWORLD,
                    visitsInWindow: recentVisits + 1,
                    window: matrix.recentWindow,
                });
            }

            const last = this.recentPositions.at(-1);
            const twoBack = this.recentPositions.at(-2);
            if (currKey === twoBack && prevKey === last) {
                add('two_tile_loop', matrix.twoCycle, 'penalty', { context: REWARD_CONTEXT.OVERWORLD });
            }
            this._rememberPosition(currKey);
            this.stuckCounter = 0;
        } else if (DIRECTIONS.has(action) && !locationChanged && !dialogChanged) {
            add('blocked_movement', matrix.blockedMovement, 'penalty', { context: REWARD_CONTEXT.OVERWORLD });
            this._advanceStationaryPressure(add, matrix);
        } else if ((action === 'a' || action === 'b') && !locationChanged && !dialogChanged) {
            // Without this signal, a no-op face button pays only decisionCost
            // and can dominate exploration once revisits become expensive.
            add('overworld_inaction', matrix.inaction, 'penalty', {
                context: REWARD_CONTEXT.OVERWORLD,
                action,
            });
            // Face-button no-ops are part of the same stationary trajectory as
            // blocked directions. Resetting here let a policy alternate B with
            // a wall press forever without ever reaching the escalating stuck
            // penalty.
            this._advanceStationaryPressure(add, matrix);
        } else if (action !== 'start') {
            this.stuckCounter = 0;
        }

    }

    _evaluateMenu(prev, curr, action, add) {
        this._resetSpatialPenaltyState();
        const matrix = REDPP_REWARD_MATRIX.menu;
        const prevOpen = Boolean(prev?.menu?.open);
        const currOpen = Boolean(curr?.menu?.open);
        const eligible = Math.max(prev?.party?.length || 0, curr?.party?.length || 0) > 0;

        // Title/name-selection screens are required progression, not optional
        // menu browsing. A real party is the robust boundary for Start menus.
        if (!eligible) {
            this.menuSteps = 0;
            return;
        }

        if (action) add('menu_decision_cost', matrix.decisionCost, 'penalty', {
            context: REWARD_CONTEXT.MENU,
        });

        const strategicChange = strategicMenuFingerprint(prev) !== strategicMenuFingerprint(curr);
        if (!prevOpen && currOpen) {
            this.menuSteps = 1;
            const sinceClose = this.transitionCount - this.lastMenuCloseTransition;
            this.menuReopenStreak = sinceClose <= matrix.reopenWindow
                ? this.menuReopenStreak + 1
                : 1;
            const excess = this.menuReopenStreak - matrix.freeReopens;
            if (excess > 0) {
                const penalty = Math.max(matrix.reopenCap, matrix.reopenBase * (2 ** (excess - 1)));
                add('menu_reopened', penalty, 'penalty', {
                    context: REWARD_CONTEXT.MENU,
                    streak: this.menuReopenStreak,
                    sinceClose,
                });
            }
        } else if (prevOpen && currOpen) {
            this.menuSteps = strategicChange ? 0 : this.menuSteps + 1;
        } else if (prevOpen && !currOpen) {
            this.menuSteps = 0;
            this.lastMenuCloseTransition = this.transitionCount;
            return;
        }

        // Party reordering, item use, move changes and healing are legitimate
        // strategic menu work. They waive and reset idle pressure, but provide no
        // extra farmable reward here; durable systems score real improvements.
        if (strategicChange) {
            this.menuSteps = 0;
            this.menuReopenStreak = Math.max(1, this.menuReopenStreak - 1);
            return;
        }

        const excessSteps = this.menuSteps - matrix.graceSteps;
        if (currOpen && excessSteps > 0) {
            const penalty = Math.max(matrix.idleCap,
                matrix.idleBase + matrix.idleSlope * (excessSteps - 1));
            add('menu_idle', penalty, 'penalty', {
                context: REWARD_CONTEXT.MENU,
                steps: this.menuSteps,
                graceSteps: matrix.graceSteps,
            });
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

        this._evaluateTeamProgress(prev, curr, add);

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

    _evaluateTeamProgress(prev, curr, add) {
        const matrix = REDPP_REWARD_MATRIX.team;
        const previous = analyzeRedppTeam(prev?.party);
        const current = analyzeRedppTeam(curr?.party);

        // Prime from the transition's real starting state. This prevents a
        // loaded six-mon save from receiving six synthetic capture rewards.
        this.maxPartySize = Math.max(this.maxPartySize, previous.size);
        this.bestTeamQuality = Math.max(this.bestTeamQuality, previous.score);

        const newPeakMembers = Math.max(0, current.size - this.maxPartySize);
        if (newPeakMembers > 0) {
            add('pokemon_caught', matrix.member * newPeakMembers, 2, {
                count: newPeakMembers,
                partySize: current.size,
            });
        }
        if (this.maxPartySize < 6 && current.size === 6) {
            add('full_team', matrix.fullTeam, 3, { partySize: 6 });
            this.completedObjectives.push('full_team');
        }
        this.maxPartySize = Math.max(this.maxPartySize, current.size);

        const qualityImprovement = current.score - this.bestTeamQuality;
        if (qualityImprovement >= matrix.qualityEpsilon) {
            add('team_quality_improved',
                Math.min(matrix.qualityTransitionCap, matrix.qualityScale * qualityImprovement),
                2,
                {
                    score: current.score,
                    improvement: qualityImprovement,
                    levelBalance: current.levelBalance,
                    typeDiversity: current.typeDiversity,
                    offensiveCoverage: current.offensiveCoverage,
                    defensiveResilience: current.defensiveResilience,
                    meanBaseStatTotal: current.meanBaseStatTotal,
                });
            this.bestTeamQuality = current.score;
        }
        this.lastTeamAnalysis = current;
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
        while (this.recentPositions.length > REDPP_REWARD_MATRIX.overworld.recentWindow) {
            this.recentPositions.shift();
        }
    }

    _resetSpatialPenaltyState() {
        this.stuckCounter = 0;
    }

    _advanceStationaryPressure(add, matrix) {
        this.stuckCounter++;
        if (this.stuckCounter < matrix.stuckStart) return;

        const stuck = Math.max(
            matrix.stuckCap,
            matrix.stuckSlope * (this.stuckCounter - matrix.stuckStart + 1),
        );
        add('stuck', stuck, 'penalty', {
            context: REWARD_CONTEXT.OVERWORLD,
            count: this.stuckCounter,
        });
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

    /**
     * Reset trajectory-local shaping when the emulator starts a new episode.
     *
     * Durable anti-farming state (dialog/save credits, milestones, team bests
     * and cumulative telemetry) intentionally survives. Position visit counts
     * do not: carrying them across a checkpoint reload eventually labels every
     * reachable tile as a capped revisit and removes the exploration signal
     * from all later episodes.
     */
    resetEpisodeState() {
        this.positionVisits.clear();
        this.recentPositions = [];
        this.stuckCounter = 0;
        this.menuSteps = 0;
        this.firedTests = [];
    }

    reset() {
        this.positionVisits.clear();
        this.visitedPositions.clear();
        this.visitedLocations.clear();
        this.dialogCredits.clear();
        this.recentPositions = [];
        this.stuckCounter = 0;
        this.menuSteps = 0;
        this.menuReopenStreak = 0;
        this.lastMenuCloseTransition = -Infinity;
        this.transitionCount = 0;
        this.lastSaveTransition = -Infinity;
        this.saveStreak = 0;
        this.championReached = false;
        this.maxPartySize = 0;
        this.bestTeamQuality = 0;
        this.lastTeamAnalysis = analyzeRedppTeam([]);
        this.firedOnce.clear();
        this.completedObjectives = [];
        this.totalRewards = this._emptyBreakdown(true);
        this.firedTests = [];
        this.currentLocation = null;
        this.currentBundle = this.bundles?._default || this._getDefaultBundle();
    }

    /**
     * Preserve anti-farming and exploration memory while WASM emulator
     * instances are recycled. Emulator state is handled separately by the
     * curriculum checkpoint; this snapshot contains only reward bookkeeping.
     */
    exportLearningState() {
        return {
            version: 1,
            firedOnce: [...this.firedOnce],
            completedObjectives: [...this.completedObjectives],
            positionVisits: [...this.positionVisits.entries()],
            visitedPositions: [...this.visitedPositions],
            visitedLocations: [...this.visitedLocations],
            dialogCredits: [...this.dialogCredits.entries()].map(([key, credit]) => [key, { ...credit }]),
            recentPositions: [...this.recentPositions],
            menuReopenStreak: this.menuReopenStreak,
            lastMenuCloseTransition: this.lastMenuCloseTransition,
            transitionCount: this.transitionCount,
            lastSaveTransition: this.lastSaveTransition,
            saveStreak: this.saveStreak,
            championReached: this.championReached,
            maxPartySize: this.maxPartySize,
            bestTeamQuality: this.bestTeamQuality,
            lastTeamAnalysis: { ...this.lastTeamAnalysis },
            totalRewards: { ...this.totalRewards },
            lastContext: this.lastContext,
            currentLocation: this.currentLocation,
        };
    }

    restoreLearningState(snapshot) {
        if (!snapshot || snapshot.version !== 1) {
            throw new Error('Unsupported reward learning snapshot');
        }

        this.firedOnce = new Set(snapshot.firedOnce || []);
        this.completedObjectives = [...(snapshot.completedObjectives || [])];
        this.positionVisits = new Map(snapshot.positionVisits || []);
        this.visitedPositions = new Set(snapshot.visitedPositions || []);
        this.visitedLocations = new Set(snapshot.visitedLocations || []);
        this.dialogCredits = new Map((snapshot.dialogCredits || [])
            .map(([key, credit]) => [key, { ...credit }]));
        this.recentPositions = [...(snapshot.recentPositions || [])].slice(-32);
        this.menuReopenStreak = finiteNonNegativeInteger(snapshot.menuReopenStreak);
        this.lastMenuCloseTransition = finiteOrNegativeInfinity(snapshot.lastMenuCloseTransition);
        this.transitionCount = finiteNonNegativeInteger(snapshot.transitionCount);
        this.lastSaveTransition = finiteOrNegativeInfinity(snapshot.lastSaveTransition);
        this.saveStreak = finiteNonNegativeInteger(snapshot.saveStreak);
        this.championReached = Boolean(snapshot.championReached);
        this.maxPartySize = finiteNonNegativeInteger(snapshot.maxPartySize);
        this.bestTeamQuality = clamp(Number(snapshot.bestTeamQuality) || 0, 0, 1);
        this.lastTeamAnalysis = snapshot.lastTeamAnalysis
            ? { ...snapshot.lastTeamAnalysis }
            : analyzeRedppTeam([]);
        this.totalRewards = {
            ...this._emptyBreakdown(true),
            ...(snapshot.totalRewards || {}),
        };
        this.lastContext = Object.values(REWARD_CONTEXT).includes(snapshot.lastContext)
            ? snapshot.lastContext
            : REWARD_CONTEXT.OVERWORLD;

        // Transient pressure belongs to the discarded emulator trajectory,
        // while long-horizon anti-farming state above must survive.
        this.stuckCounter = 0;
        this.menuSteps = 0;
        this.firedTests = [];
        this.currentLocation = null;
        this.currentBundle = this.bundles?._default || this._getDefaultBundle();
        if (snapshot.currentLocation) {
            if (this.bundles) this.setLocation(snapshot.currentLocation);
            else this.currentLocation = normalizeLocation(snapshot.currentLocation);
        }
        return true;
    }

    getStats() {
        return {
            matrixVersion: REDPP_REWARD_MATRIX_VERSION,
            context: this.lastContext,
            totalRewards: { ...this.totalRewards },
            visitedLocations: this.visitedLocations.size,
            visitedPositions: this.visitedPositions.size,
            dialogCreditPositions: this.dialogCredits.size,
            stuckCounter: this.stuckCounter,
            menuSteps: this.menuSteps,
            menuReopenStreak: this.menuReopenStreak,
            saveStreak: this.saveStreak,
            maxPartySize: this.maxPartySize,
            bestTeamQuality: this.bestTeamQuality,
            teamQuality: this.lastTeamAnalysis,
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

function strategicMenuFingerprint(state = {}) {
    const party = (state.party || []).map(mon => [
        Number(mon?.speciesId) || 0,
        Number(mon?.currentHP) || 0,
        Number(mon?.maxHP) || 0,
        String(mon?.status || ''),
        ...(mon?.moveIds || mon?.moves || []).map(move => Number(move?.id ?? move) || String(move || '')),
        ...(mon?.movePP || []).map(pp => Number(pp) || 0),
    ]);
    const items = (state.items || []).map(item => [String(item?.name || ''), Number(item?.quantity) || 0]);
    return JSON.stringify([party, items, Number(state.money) || 0]);
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

function finiteNonNegativeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function finiteOrNegativeInfinity(value) {
    return Number.isFinite(Number(value)) ? Number(value) : -Infinity;
}

export default UnitTestRewards;
