/**
 * Unit Test Rewards - Pre-compiled test bundle evaluation for pure RL mode.
 *
 * Loads location-specific test bundles generated from the Prima Strategy Guide
 * and evaluates state transitions against them for dense, deterministic rewards.
 *
 * Inspired by OLMoCR-2's unit test reward methodology.
 *
 * Test tiers:
 * - Tier 1: Movement (coordinates changed, directional movement)
 * - Tier 2: Landmarks (reached specific regions, location changes)
 * - Tier 3: Objectives (badges, Pokemon caught, major milestones)
 * - Penalties: Stuck detection, whiteout
 */

import { assetUrl } from '../asset-url.js';

export class UnitTestRewards {
    constructor(config = {}) {
        this.config = {
            // Tier weights
            tier1Weight: config.tier1Weight ?? 1.0,
            tier2Weight: config.tier2Weight ?? 1.0,
            tier3Weight: config.tier3Weight ?? 1.0,
            penaltyWeight: config.penaltyWeight ?? 1.0,

            // Enable/disable tiers
            enableTier1: config.enableTier1 ?? true,
            enableTier2: config.enableTier2 ?? true,
            enableTier3: config.enableTier3 ?? true,
            enablePenalties: config.enablePenalties ?? true,

            // Stuck detection
            stuckThreshold: config.stuckThreshold ?? 30,

            // Bundle URL
            bundlesUrl: config.bundlesUrl ?? assetUrl('data/test-bundles.json'),
        };

        // Test bundles (loaded async)
        this.bundles = null;
        this.bundlesLoaded = false;
        this.currentLocation = null;
        this.currentBundle = null;

        // Track one-time tests that have fired
        this.firedOnce = new Set();

        // Track state for tests that need history
        this.stuckCounter = 0;
        this.visitedLocations = new Set();
        this.seenBadges = 0;
        this.seenPartyCount = 0;
        this.lastPartyLevels = [];

        // Metrics
        this.totalRewards = {
            tier1: 0,
            tier2: 0,
            tier3: 0,
            penalties: 0,
            total: 0
        };
        this.firedTests = [];
        this.completedObjectives = [];
    }

    /**
     * Load test bundles from JSON file
     */
    async loadBundles(url = null) {
        const bundleUrl = url || this.config.bundlesUrl;

        try {
            const response = await fetch(bundleUrl);
            if (!response.ok) {
                console.warn(`[UnitTestRewards] Failed to load bundles: ${response.status}`);
                this.bundles = this._getDefaultBundles();
            } else {
                const data = await response.json();
                this.bundles = data.bundles || data;
                console.log(`[UnitTestRewards] Loaded ${Object.keys(this.bundles).length - 1} location bundles`);
            }
        } catch (error) {
            console.warn('[UnitTestRewards] Error loading bundles, using defaults:', error.message);
            this.bundles = this._getDefaultBundles();
        }

        this.bundlesLoaded = true;

        // Start with default bundle
        this.currentBundle = this.bundles._default || this._getDefaultBundle();
    }

    /**
     * Get default bundles if loading fails
     */
    _getDefaultBundles() {
        return {
            _default: this._getDefaultBundle(),
        };
    }

    /**
     * Get default bundle with universal tests
     */
    _getDefaultBundle() {
        return {
            tests: [
                { id: 'moved', type: 'coords_changed', reward: 0.1, tier: 1 },
                { id: 'map_changed', type: 'location_changed', reward: 1.0, tier: 2 },
                { id: 'new_map', type: 'new_location', reward: 2.0, tier: 2, once: true },
                { id: 'badge_earned', type: 'badge_count_increased', reward: 10.0, tier: 3, once: true },
                { id: 'pokemon_caught', type: 'party_size_increased', reward: 5.0, tier: 3, once: true },
                { id: 'level_up', type: 'level_increased', reward: 1.0, tier: 3 },
            ],
            penalties: [
                { id: 'stuck', type: 'coords_same', threshold: 30, reward: -0.5 },
                { id: 'step_cost', type: 'always', reward: -0.01 },
            ],
        };
    }

    /**
     * Set current location and switch to appropriate bundle
     */
    setLocation(locationName) {
        if (!this.bundles || !locationName) return;

        // Normalize location name for matching
        const normalized = locationName.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();

        // Try exact match first
        if (this.bundles[normalized]) {
            this.currentBundle = this.bundles[normalized];
            this.currentLocation = normalized;
            return;
        }

        // Try partial match
        for (const [key, bundle] of Object.entries(this.bundles)) {
            if (key === '_default') continue;
            if (normalized.includes(key) || key.includes(normalized)) {
                this.currentBundle = bundle;
                this.currentLocation = key;
                return;
            }
        }

        // Fall back to default
        this.currentBundle = this.bundles._default || this._getDefaultBundle();
        this.currentLocation = normalized;
    }

    /**
     * Evaluate rewards for a state transition
     */
    evaluate(prevState, currState) {
        // Ensure bundles are loaded (use defaults if not)
        if (!this.bundlesLoaded) {
            this.bundles = this._getDefaultBundles();
            this.currentBundle = this.bundles._default;
            this.bundlesLoaded = true;
        }

        // Update location if changed
        if (currState?.location && currState.location !== this.currentLocation) {
            this.setLocation(currState.location);
        }

        let tier1 = 0;
        let tier2 = 0;
        let tier3 = 0;
        let penalties = 0;
        const fired = [];

        const bundle = this.currentBundle || this._getDefaultBundle();

        // Evaluate tests
        if (bundle.tests) {
            for (const test of bundle.tests) {
                // Skip one-time tests that already fired
                if (test.once && this.firedOnce.has(test.id)) continue;

                // Check tier enablement
                const tier = test.tier || 1;
                if (tier === 1 && !this.config.enableTier1) continue;
                if (tier === 2 && !this.config.enableTier2) continue;
                if (tier === 3 && !this.config.enableTier3) continue;

                // Evaluate test
                if (this._evalTest(test, prevState, currState)) {
                    const weight = this._getTierWeight(tier);
                    const reward = test.reward * weight;

                    if (tier === 1) tier1 += reward;
                    else if (tier === 2) tier2 += reward;
                    else if (tier === 3) tier3 += reward;

                    fired.push({ id: test.id, reward, tier });

                    if (test.once) {
                        this.firedOnce.add(test.id);
                        this.completedObjectives.push(test.id);
                    }
                }
            }
        }

        // Evaluate penalties
        if (bundle.penalties && this.config.enablePenalties) {
            for (const penalty of bundle.penalties) {
                if (this._evalTest(penalty, prevState, currState)) {
                    const reward = penalty.reward * this.config.penaltyWeight;
                    penalties += reward;
                    fired.push({ id: penalty.id, reward, tier: 'penalty' });
                }
            }
        }

        const total = tier1 + tier2 + tier3 + penalties;

        // Update totals
        this.totalRewards.tier1 += tier1;
        this.totalRewards.tier2 += tier2;
        this.totalRewards.tier3 += tier3;
        this.totalRewards.penalties += penalties;
        this.totalRewards.total += total;
        this.firedTests = fired;

        return {
            total,
            breakdown: { tier1, tier2, tier3, penalties },
            firedTests: fired,
            currentLocation: this.currentLocation,
            bundleInfo: {
                location: this.currentLocation,
                testCount: bundle.tests?.length || 0,
                penaltyCount: bundle.penalties?.length || 0,
            },
        };
    }

    /**
     * Get tier weight from config
     */
    _getTierWeight(tier) {
        if (tier === 1) return this.config.tier1Weight;
        if (tier === 2) return this.config.tier2Weight;
        if (tier === 3) return this.config.tier3Weight;
        return 1.0;
    }

    /**
     * Evaluate a single test
     */
    _evalTest(test, prev, curr) {
        switch (test.type) {
            case 'coords_changed':
                return this._testCoordsChanged(prev, curr);

            case 'coords_same':
                if (!this._testCoordsChanged(prev, curr)) {
                    this.stuckCounter++;
                    return this.stuckCounter >= (test.threshold || 30);
                }
                this.stuckCounter = 0;
                return false;

            case 'coord_delta':
                return this._testCoordDelta(prev, curr, test.axis, test.direction);

            case 'coord_in_region':
                return this._testCoordInRegion(curr, test.minX, test.maxX, test.minY, test.maxY);

            case 'location_changed':
                return this._testLocationChanged(prev, curr);

            case 'location_changed_to':
                return this._testLocationChangedTo(prev, curr, test.target);

            case 'new_location':
                return this._testNewLocation(curr);

            case 'party_size_increased':
                return this._testPartySizeIncreased(prev, curr);

            case 'badge_count_increased':
                return this._testBadgeIncreased(prev, curr);

            case 'level_increased':
                return this._testLevelIncreased(prev, curr);

            case 'dialog_changed':
                return this._testDialogChanged(prev, curr);

            case 'battle_won':
                return this._testBattleWon(prev, curr);

            case 'pokemon_evolved':
                return this._testPokemonEvolved(prev, curr);

            case 'all_fainted':
                return this._testAllFainted(curr);

            case 'always':
                return true;

            default:
                console.warn(`[UnitTestRewards] Unknown test type: ${test.type}`);
                return false;
        }
    }

    // === Test implementations ===

    _testCoordsChanged(prev, curr) {
        if (!prev?.coordinates || !curr?.coordinates) return false;
        return prev.coordinates.x !== curr.coordinates.x ||
               prev.coordinates.y !== curr.coordinates.y;
    }

    _testCoordDelta(prev, curr, axis, direction) {
        if (!prev?.coordinates || !curr?.coordinates) return false;
        const delta = curr.coordinates[axis] - prev.coordinates[axis];
        if (direction === 'positive') return delta > 0;
        if (direction === 'negative') return delta < 0;
        return false;
    }

    _testCoordInRegion(curr, minX, maxX, minY, maxY) {
        if (!curr?.coordinates) return false;
        const { x, y } = curr.coordinates;
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
    }

    _testLocationChanged(prev, curr) {
        if (!prev?.location || !curr?.location) return false;
        return prev.location !== curr.location;
    }

    _testLocationChangedTo(prev, curr, target) {
        if (!curr?.location) return false;
        const currNorm = curr.location.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
        const targetNorm = target.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
        const prevNorm = prev?.location?.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim() || '';

        return (currNorm === targetNorm || currNorm.includes(targetNorm) || targetNorm.includes(currNorm))
               && currNorm !== prevNorm;
    }

    _testNewLocation(curr) {
        if (!curr?.location) return false;
        if (this.visitedLocations.has(curr.location)) return false;
        this.visitedLocations.add(curr.location);
        return true;
    }

    _testPartySizeIncreased(prev, curr) {
        const prevCount = prev?.party?.length ?? 0;
        const currCount = curr?.party?.length ?? 0;
        if (currCount > prevCount && currCount > this.seenPartyCount) {
            this.seenPartyCount = currCount;
            return true;
        }
        return false;
    }

    _testBadgeIncreased(prev, curr) {
        const prevBadges = prev?.badgeCount ?? 0;
        const currBadges = curr?.badgeCount ?? 0;
        if (currBadges > prevBadges && currBadges > this.seenBadges) {
            this.seenBadges = currBadges;
            return true;
        }
        return false;
    }

    _testLevelIncreased(prev, curr) {
        if (!prev?.party || !curr?.party) return false;
        const prevMaxLevel = Math.max(...prev.party.map(p => p.level || 0), 0);
        const currMaxLevel = Math.max(...curr.party.map(p => p.level || 0), 0);
        return currMaxLevel > prevMaxLevel;
    }

    _testDialogChanged(prev, curr) {
        const prevDialog = prev?.dialog || '';
        const currDialog = curr?.dialog || '';
        return currDialog.length > 0 && currDialog !== prevDialog;
    }

    _testBattleWon(prev, curr) {
        // Detect battle ending with party still alive
        const wasInBattle = prev?.inBattle ?? false;
        const isInBattle = curr?.inBattle ?? false;
        const partyAlive = curr?.party?.some(p => p.currentHP > 0) ?? false;
        return wasInBattle && !isInBattle && partyAlive;
    }

    _testPokemonEvolved(prev, curr) {
        // Would need to track species changes - simplified for now
        return false;
    }

    _testAllFainted(curr) {
        if (!curr?.party || curr.party.length === 0) return false;
        return curr.party.every(p => p.currentHP === 0);
    }

    // === Utility ===

    reset() {
        this.stuckCounter = 0;
        this.seenBadges = 0;
        this.seenPartyCount = 0;
        this.visitedLocations.clear();
        this.firedOnce.clear();
        this.completedObjectives = [];
        this.totalRewards = { tier1: 0, tier2: 0, tier3: 0, penalties: 0, total: 0 };
        this.firedTests = [];
        this.currentLocation = null;
        this.currentBundle = this.bundles?._default || this._getDefaultBundle();
    }

    getStats() {
        return {
            totalRewards: { ...this.totalRewards },
            visitedLocations: this.visitedLocations.size,
            stuckCounter: this.stuckCounter,
            completedObjectives: [...this.completedObjectives],
            currentLocation: this.currentLocation,
            bundleInfo: this.currentBundle ? {
                testCount: this.currentBundle.tests?.length || 0,
                penaltyCount: this.currentBundle.penalties?.length || 0,
            } : null,
        };
    }

    /**
     * Get info about current bundle for UI display
     */
    getCurrentBundleInfo() {
        if (!this.currentBundle) return null;

        return {
            location: this.currentLocation,
            tests: this.currentBundle.tests || [],
            penalties: this.currentBundle.penalties || [],
            objectives: this.currentBundle.objectives || [],
            nextLocations: this.currentBundle.next_locations || [],
            hasMapData: this.currentBundle.has_map_data || false,
        };
    }

    /**
     * Get list of completed one-time tests (for UI checklist)
     */
    getCompletedTests() {
        return [...this.firedOnce];
    }
}

export default UnitTestRewards;
