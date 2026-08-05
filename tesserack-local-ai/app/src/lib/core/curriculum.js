// curriculum.js - Prima Strategy Guide-based checkpoint curriculum
// Source: Prima's Official Strategy Guide for Pokemon Red & Blue (1999)
//
// This curriculum defines ordered checkpoints extracted from the official guide,
// mapped to memory-verifiable conditions for reward shaping.

/**
 * Checkpoint categories for reward scaling
 */
export const CHECKPOINT_TYPES = {
    BADGE: 'badge',           // Gym badges - major milestones
    KEY_ITEM: 'key_item',     // Critical progression items
    LOCATION: 'location',     // Reaching new areas
    EVENT: 'event',           // Story events (rival battles, etc.)
    OPTIONAL: 'optional',     // Side content (fossils, etc.)
};

/**
 * Reward values by checkpoint type
 */
export const REWARDS = {
    [CHECKPOINT_TYPES.BADGE]: 1000,
    [CHECKPOINT_TYPES.KEY_ITEM]: 500,
    [CHECKPOINT_TYPES.LOCATION]: 200,
    [CHECKPOINT_TYPES.EVENT]: 300,
    [CHECKPOINT_TYPES.OPTIONAL]: 100,
};

/**
 * Map IDs from memory-reader.js for reference
 */
const MAP_IDS = {
    PALLET_TOWN: 0x00,
    VIRIDIAN_CITY: 0x01,
    PEWTER_CITY: 0x02,
    CERULEAN_CITY: 0x03,
    LAVENDER_TOWN: 0x04,
    VERMILION_CITY: 0x05,
    CELADON_CITY: 0x06,
    FUCHSIA_CITY: 0x07,
    CINNABAR_ISLAND: 0x08,
    INDIGO_PLATEAU: 0x09,
    SAFFRON_CITY: 0x0A,
    OAKS_LAB: 0x28,
    VIRIDIAN_FOREST: 0x33,
    PEWTER_GYM: 0x36,
    MT_MOON_1F: 0x3B,
    CERULEAN_GYM: 0x41,
    VERMILION_GYM: 0x5C,
    SS_ANNE: 0x5F,
    ROCK_TUNNEL: 0x52,
    POKEMON_TOWER: 0x8E,
    CELADON_GYM: 0x86,
    GAME_CORNER: 0x87,
    SAFARI_ZONE: 0x9C,
    FUCHSIA_GYM: 0x9D,
    SILPH_CO: 0xB5,
    SAFFRON_GYM: 0xB2,
    CINNABAR_GYM: 0xA6,
    VIRIDIAN_GYM: 0x2D,
    VICTORY_ROAD: 0x6C,
    ELITE_FOUR_LORELEI: 0xF5,
    ELITE_FOUR_BRUNO: 0xF6,
    ELITE_FOUR_AGATHA: 0xF7,
    CHAMPION_LANCE: 0x71,
    HALL_OF_FAME: 0x76,
};

/**
 * Item IDs from memory-reader.js for reference
 */
const ITEM_IDS = {
    TOWN_MAP: 0x05,
    POKEDEX: 0x09,
    OAKS_PARCEL: 0x46,
    SS_TICKET: 0x3F,
    BICYCLE: 0x06,
    OLD_AMBER: 0x1F,
    DOME_FOSSIL: 0x29,
    HELIX_FOSSIL: 0x2A,
    SILPH_SCOPE: 0x48,
    POKE_FLUTE: 0x49,
    GOLD_TEETH: 0x40,
    SECRET_KEY: 0x2B,
    CARD_KEY: 0x30,
    MASTER_BALL: 0x01,
    HM01_CUT: 0xC4,
    HM02_FLY: 0xC5,
    HM03_SURF: 0xC6,
    HM04_STRENGTH: 0xC7,
    HM05_FLASH: 0xC8,
};

/**
 * Prima Guide Curriculum - Ordered checkpoints following the official walkthrough
 *
 * Each checkpoint has:
 * - id: Unique identifier
 * - name: Human-readable name
 * - description: From the Prima guide "Things to Do"
 * - type: Checkpoint category
 * - order: Sequence in the guide's progression
 * - condition: Function to verify completion from game state
 * - reward: Points awarded (defaults to type-based reward)
 * - guideRef: Page reference in Prima guide (1999 edition)
 */
export const CURRICULUM = [
    // ============ PALLET TOWN (Guide Page 10-14) ============
    {
        id: 'start_game',
        name: 'Begin Adventure',
        description: 'Leave your house and start your Pokemon journey',
        type: CHECKPOINT_TYPES.EVENT,
        order: 1,
        condition: (state) => state.location !== 'PLAYERS HOUSE 1F' && state.location !== 'PLAYERS HOUSE 2F',
        guideRef: 'p.10'
    },
    {
        id: 'get_starter',
        name: 'Choose Starter Pokemon',
        description: "Visit Prof. Oak's Lab and choose your first Pokemon",
        type: CHECKPOINT_TYPES.EVENT,
        order: 2,
        condition: (state) => state.partyCount >= 1,
        guideRef: 'p.10'
    },
    {
        id: 'get_pokedex',
        name: 'Obtain Pokedex',
        description: "Deliver Oak's Parcel and receive the Pokedex",
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 5,
        condition: (state) => state.items.some(i => i.name === 'POKEDEX'),
        guideRef: 'p.11'
    },
    {
        id: 'get_town_map',
        name: 'Get Town Map',
        description: "Visit your Rival's sister to get the Town Map",
        type: CHECKPOINT_TYPES.OPTIONAL,
        order: 6,
        condition: (state) => state.items.some(i => i.name === 'TOWN MAP'),
        guideRef: 'p.11'
    },

    // ============ ROUTE 1 & VIRIDIAN CITY (Guide Page 12-14) ============
    {
        id: 'reach_viridian',
        name: 'Reach Viridian City',
        description: 'Travel north through Route 1 to Viridian City',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 3,
        condition: (state) => state.mapId === MAP_IDS.VIRIDIAN_CITY || state.location === 'VIRIDIAN CITY',
        guideRef: 'p.12'
    },
    {
        id: 'get_oaks_parcel',
        name: "Get Oak's Parcel",
        description: "Pick up Oak's Parcel at the Viridian Poke Mart",
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 4,
        condition: (state) => state.items.some(i => i.name === 'OAKS PARCEL'),
        guideRef: 'p.12'
    },

    // ============ VIRIDIAN FOREST & PEWTER CITY (Guide Page 15-17) ============
    {
        id: 'enter_viridian_forest',
        name: 'Enter Viridian Forest',
        description: 'Navigate through Route 2 and enter Viridian Forest',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 7,
        condition: (state) => state.mapId === MAP_IDS.VIRIDIAN_FOREST || state.location === 'VIRIDIAN FOREST',
        guideRef: 'p.15'
    },
    {
        id: 'reach_pewter',
        name: 'Reach Pewter City',
        description: 'Exit Viridian Forest and arrive at Pewter City',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 8,
        condition: (state) => state.mapId === MAP_IDS.PEWTER_CITY || state.location === 'PEWTER CITY',
        guideRef: 'p.16'
    },
    {
        id: 'badge_boulder',
        name: 'Boulder Badge',
        description: "Defeat Brock at Pewter Gym - Gym Leader #1",
        type: CHECKPOINT_TYPES.BADGE,
        order: 9,
        condition: (state) => state.badges.includes('Boulder'),
        guideRef: 'p.17'
    },
    {
        id: 'get_old_amber',
        name: 'Get Old Amber',
        description: "Get the Old Amber from the Pewter Museum's research facility",
        type: CHECKPOINT_TYPES.OPTIONAL,
        order: 10,
        condition: (state) => state.items.some(i => i.name === 'OLD AMBER'),
        guideRef: 'p.17'
    },

    // ============ MT. MOON (Guide Page 18-20) ============
    {
        id: 'enter_mt_moon',
        name: 'Enter Mt. Moon',
        description: 'Travel Route 3 and enter Mt. Moon cave',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 11,
        condition: (state) => state.location && state.location.includes('MT MOON'),
        guideRef: 'p.18'
    },
    {
        id: 'get_fossil',
        name: 'Obtain Fossil',
        description: 'Get the Dome Fossil or Helix Fossil from Mt. Moon',
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 12,
        condition: (state) => state.items.some(i => i.name === 'DOME FOSSIL' || i.name === 'HELIX FOSSIL'),
        guideRef: 'p.19'
    },

    // ============ CERULEAN CITY (Guide Page 21-23) ============
    {
        id: 'reach_cerulean',
        name: 'Reach Cerulean City',
        description: 'Exit Mt. Moon via Route 4 and reach Cerulean City',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 13,
        condition: (state) => state.mapId === MAP_IDS.CERULEAN_CITY || state.location === 'CERULEAN CITY',
        guideRef: 'p.21'
    },
    {
        id: 'badge_cascade',
        name: 'Cascade Badge',
        description: 'Defeat Misty at Cerulean Gym - Gym Leader #2',
        type: CHECKPOINT_TYPES.BADGE,
        order: 14,
        condition: (state) => state.badges.includes('Cascade'),
        guideRef: 'p.22'
    },
    {
        id: 'defeat_rival_route24',
        name: 'Defeat Rival on Nugget Bridge',
        description: 'Battle and defeat your Rival on Route 24',
        type: CHECKPOINT_TYPES.EVENT,
        order: 15,
        // Verified by progressing past Nugget Bridge (approximated by SS Ticket or later progress)
        condition: (state) => state.items.some(i => i.name === 'SS TICKET'),
        guideRef: 'p.22'
    },
    {
        id: 'visit_bill',
        name: 'Help Bill',
        description: "Visit Bill's house on Route 25 and get the S.S. Ticket",
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 16,
        condition: (state) => state.items.some(i => i.name === 'SS TICKET'),
        guideRef: 'p.23'
    },

    // ============ VERMILION CITY & S.S. ANNE (Guide Page 25-27) ============
    {
        id: 'reach_vermilion',
        name: 'Reach Vermilion City',
        description: 'Travel through Route 5 underground passage to Vermilion City',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 17,
        condition: (state) => state.mapId === MAP_IDS.VERMILION_CITY || state.location === 'VERMILION CITY',
        guideRef: 'p.25'
    },
    {
        id: 'board_ss_anne',
        name: 'Board S.S. Anne',
        description: 'Use your S.S. Ticket to board the S.S. Anne',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 18,
        condition: (state) => state.location && state.location.includes('SS ANNE'),
        guideRef: 'p.26'
    },
    {
        id: 'get_hm_cut',
        name: 'Obtain HM01 Cut',
        description: "Help the Captain and receive HM01 Cut",
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 19,
        condition: (state) => state.items.some(i => i.name === 'HM01'),
        guideRef: 'p.27'
    },
    {
        id: 'badge_thunder',
        name: 'Thunder Badge',
        description: 'Defeat Lt. Surge at Vermilion Gym - Gym Leader #3',
        type: CHECKPOINT_TYPES.BADGE,
        order: 20,
        condition: (state) => state.badges.includes('Thunder'),
        guideRef: 'p.27'
    },

    // ============ ROCK TUNNEL & LAVENDER TOWN (Guide Page 29-31) ============
    {
        id: 'enter_rock_tunnel',
        name: 'Enter Rock Tunnel',
        description: 'Navigate Route 9 and enter Rock Tunnel (use Flash!)',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 21,
        condition: (state) => state.location && state.location.includes('ROCK TUNNEL'),
        guideRef: 'p.29'
    },
    {
        id: 'reach_lavender',
        name: 'Reach Lavender Town',
        description: 'Exit Rock Tunnel and reach Lavender Town',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 22,
        condition: (state) => state.mapId === MAP_IDS.LAVENDER_TOWN || state.location === 'LAVENDER TOWN',
        guideRef: 'p.30'
    },

    // ============ CELADON CITY (Guide Page 32-35) ============
    {
        id: 'reach_celadon',
        name: 'Reach Celadon City',
        description: 'Travel through Route 8 underground passage to Celadon City',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 23,
        condition: (state) => state.mapId === MAP_IDS.CELADON_CITY || state.location === 'CELADON CITY',
        guideRef: 'p.32'
    },
    {
        id: 'badge_rainbow',
        name: 'Rainbow Badge',
        description: 'Defeat Erika at Celadon Gym - Gym Leader #4',
        type: CHECKPOINT_TYPES.BADGE,
        order: 24,
        condition: (state) => state.badges.includes('Rainbow'),
        guideRef: 'p.35'
    },
    {
        id: 'get_silph_scope',
        name: 'Get Silph Scope',
        description: "Defeat Team Rocket at the Game Corner and get the Silph Scope",
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 25,
        condition: (state) => state.items.some(i => i.name === 'SILPH SCOPE'),
        guideRef: 'p.35'
    },

    // ============ POKEMON TOWER (Guide Page 36-37) ============
    {
        id: 'clear_pokemon_tower',
        name: 'Clear Pokemon Tower',
        description: 'Use Silph Scope to clear Pokemon Tower and rescue Mr. Fuji',
        type: CHECKPOINT_TYPES.EVENT,
        order: 26,
        condition: (state) => state.items.some(i => i.name === 'POKE FLUTE'),
        guideRef: 'p.36'
    },
    {
        id: 'get_poke_flute',
        name: 'Get Poke Flute',
        description: 'Receive the Poke Flute from Mr. Fuji',
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 27,
        condition: (state) => state.items.some(i => i.name === 'POKE FLUTE'),
        guideRef: 'p.37'
    },

    // ============ FUCHSIA CITY & SAFARI ZONE (Guide Page 40-44) ============
    {
        id: 'reach_fuchsia',
        name: 'Reach Fuchsia City',
        description: 'Travel south through Routes 12-15 to reach Fuchsia City',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 28,
        condition: (state) => state.mapId === MAP_IDS.FUCHSIA_CITY || state.location === 'FUCHSIA CITY',
        guideRef: 'p.40'
    },
    {
        id: 'badge_soul',
        name: 'Soul Badge',
        description: 'Defeat Koga at Fuchsia Gym - Gym Leader #5',
        type: CHECKPOINT_TYPES.BADGE,
        order: 29,
        condition: (state) => state.badges.includes('Soul'),
        guideRef: 'p.41'
    },
    {
        id: 'get_hm_surf',
        name: 'Obtain HM03 Surf',
        description: 'Complete Safari Zone and get HM03 Surf',
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 30,
        condition: (state) => state.items.some(i => i.name === 'HM03'),
        guideRef: 'p.42'
    },
    {
        id: 'get_gold_teeth',
        name: 'Get Gold Teeth',
        description: 'Find the Gold Teeth in Safari Zone for the Warden',
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 31,
        condition: (state) => state.items.some(i => i.name === 'GOLD TEETH'),
        guideRef: 'p.43'
    },
    {
        id: 'get_hm_strength',
        name: 'Obtain HM04 Strength',
        description: 'Give Gold Teeth to Warden and receive HM04 Strength',
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 32,
        condition: (state) => state.items.some(i => i.name === 'HM04'),
        guideRef: 'p.43'
    },

    // ============ SAFFRON CITY & SILPH CO. (Guide Page 38-39) ============
    {
        id: 'reach_saffron',
        name: 'Reach Saffron City',
        description: 'Enter Saffron City (need to give guards drinks)',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 33,
        condition: (state) => state.mapId === MAP_IDS.SAFFRON_CITY || state.location === 'SAFFRON CITY',
        guideRef: 'p.38'
    },
    {
        id: 'clear_silph_co',
        name: 'Clear Silph Co.',
        description: 'Defeat Team Rocket at Silph Co. headquarters',
        type: CHECKPOINT_TYPES.EVENT,
        order: 34,
        condition: (state) => state.items.some(i => i.name === 'MASTER BALL'),
        guideRef: 'p.39'
    },
    {
        id: 'get_master_ball',
        name: 'Get Master Ball',
        description: 'Receive the Master Ball from Silph Co. President',
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 35,
        condition: (state) => state.items.some(i => i.name === 'MASTER BALL'),
        guideRef: 'p.39'
    },
    {
        id: 'badge_marsh',
        name: 'Marsh Badge',
        description: 'Defeat Sabrina at Saffron Gym - Gym Leader #6',
        type: CHECKPOINT_TYPES.BADGE,
        order: 36,
        condition: (state) => state.badges.includes('Marsh'),
        guideRef: 'p.39'
    },

    // ============ CINNABAR ISLAND (Guide Page 45-47) ============
    {
        id: 'reach_cinnabar',
        name: 'Reach Cinnabar Island',
        description: 'Surf south from Pallet Town or Fuchsia to reach Cinnabar Island',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 37,
        condition: (state) => state.mapId === MAP_IDS.CINNABAR_ISLAND || state.location === 'CINNABAR ISLAND',
        guideRef: 'p.45'
    },
    {
        id: 'get_secret_key',
        name: 'Get Secret Key',
        description: 'Find the Secret Key in Pokemon Mansion',
        type: CHECKPOINT_TYPES.KEY_ITEM,
        order: 38,
        condition: (state) => state.items.some(i => i.name === 'SECRET KEY'),
        guideRef: 'p.46'
    },
    {
        id: 'badge_volcano',
        name: 'Volcano Badge',
        description: 'Defeat Blaine at Cinnabar Gym - Gym Leader #7',
        type: CHECKPOINT_TYPES.BADGE,
        order: 39,
        condition: (state) => state.badges.includes('Volcano'),
        guideRef: 'p.47'
    },

    // ============ VIRIDIAN GYM (Guide Page 48) ============
    {
        id: 'badge_earth',
        name: 'Earth Badge',
        description: 'Defeat Giovanni at Viridian Gym - Gym Leader #8',
        type: CHECKPOINT_TYPES.BADGE,
        order: 40,
        condition: (state) => state.badges.includes('Earth'),
        guideRef: 'p.48'
    },

    // ============ VICTORY ROAD & POKEMON LEAGUE (Guide Page 49-50) ============
    {
        id: 'enter_victory_road',
        name: 'Enter Victory Road',
        description: 'Pass through Route 22-23 and enter Victory Road',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 41,
        condition: (state) => state.location && state.location.includes('VICTORY ROAD'),
        guideRef: 'p.49'
    },
    {
        id: 'reach_indigo_plateau',
        name: 'Reach Indigo Plateau',
        description: 'Complete Victory Road and reach the Pokemon League',
        type: CHECKPOINT_TYPES.LOCATION,
        order: 42,
        condition: (state) => state.mapId === MAP_IDS.INDIGO_PLATEAU ||
                            state.location === 'INDIGO PLATEAU' ||
                            state.location === 'INDIGO PLATEAU LOBBY',
        guideRef: 'p.49'
    },
    {
        id: 'defeat_lorelei',
        name: 'Defeat Lorelei',
        description: 'Defeat Elite Four Member #1 - Lorelei',
        type: CHECKPOINT_TYPES.EVENT,
        order: 43,
        reward: 800,
        // Can verify by being past her room or having completed E4
        condition: (state) => state.mapId === MAP_IDS.ELITE_FOUR_BRUNO ||
                            state.mapId === MAP_IDS.ELITE_FOUR_AGATHA ||
                            state.mapId === MAP_IDS.CHAMPION_LANCE ||
                            state.mapId === MAP_IDS.HALL_OF_FAME,
        guideRef: 'p.50'
    },
    {
        id: 'defeat_bruno',
        name: 'Defeat Bruno',
        description: 'Defeat Elite Four Member #2 - Bruno',
        type: CHECKPOINT_TYPES.EVENT,
        order: 44,
        reward: 800,
        condition: (state) => state.mapId === MAP_IDS.ELITE_FOUR_AGATHA ||
                            state.mapId === MAP_IDS.CHAMPION_LANCE ||
                            state.mapId === MAP_IDS.HALL_OF_FAME,
        guideRef: 'p.50'
    },
    {
        id: 'defeat_agatha',
        name: 'Defeat Agatha',
        description: 'Defeat Elite Four Member #3 - Agatha',
        type: CHECKPOINT_TYPES.EVENT,
        order: 45,
        reward: 800,
        condition: (state) => state.mapId === MAP_IDS.CHAMPION_LANCE ||
                            state.mapId === MAP_IDS.HALL_OF_FAME,
        guideRef: 'p.50'
    },
    {
        id: 'defeat_lance',
        name: 'Defeat Lance',
        description: 'Defeat Elite Four Member #4 - Lance (Dragon Master)',
        type: CHECKPOINT_TYPES.EVENT,
        order: 46,
        reward: 800,
        condition: (state) => state.mapId === MAP_IDS.HALL_OF_FAME,
        guideRef: 'p.50'
    },
    {
        id: 'become_champion',
        name: 'Become Pokemon Champion',
        description: 'Defeat the Champion and enter the Hall of Fame!',
        type: CHECKPOINT_TYPES.EVENT,
        order: 47,
        reward: 5000,  // Ultimate achievement!
        condition: (state) => state.mapId === MAP_IDS.HALL_OF_FAME || state.location === 'HALL OF FAME',
        guideRef: 'p.50'
    },
];

/**
 * CurriculumTracker - Tracks checkpoint completion and awards rewards
 */
export class CurriculumTracker {
    constructor() {
        this.completedCheckpoints = new Set();
        this.checkpointHistory = [];  // [{id, timestamp, reward}]
        this.totalReward = 0;

        // Load from localStorage if available
        this.load();
    }

    /**
     * Check all checkpoints against current game state
     * @param {Object} gameState - From MemoryReader.getGameState()
     * @returns {Object[]} - Newly completed checkpoints
     */
    checkProgress(gameState) {
        const newlyCompleted = [];

        // Prepare state for condition checks
        const state = {
            ...gameState,
            mapId: this.getMapIdFromLocation(gameState.location),
        };

        for (const checkpoint of CURRICULUM) {
            // Skip already completed
            if (this.completedCheckpoints.has(checkpoint.id)) continue;

            // Check condition
            try {
                if (checkpoint.condition(state)) {
                    const reward = checkpoint.reward || REWARDS[checkpoint.type] || 100;

                    this.completedCheckpoints.add(checkpoint.id);
                    this.totalReward += reward;

                    const entry = {
                        id: checkpoint.id,
                        name: checkpoint.name,
                        description: checkpoint.description,
                        type: checkpoint.type,
                        reward,
                        timestamp: Date.now(),
                        order: checkpoint.order,
                    };

                    this.checkpointHistory.push(entry);
                    newlyCompleted.push(entry);
                }
            } catch (e) {
                // Condition check failed, skip
                console.warn(`Checkpoint ${checkpoint.id} condition error:`, e);
            }
        }

        // Save progress
        if (newlyCompleted.length > 0) {
            this.save();
        }

        return newlyCompleted;
    }

    /**
     * Get map ID from location string (reverse lookup)
     */
    getMapIdFromLocation(locationStr) {
        if (!locationStr) return null;

        // This is a simplified lookup - in practice you'd read MAP_ID directly
        const locationMap = {
            'PALLET TOWN': 0x00,
            'VIRIDIAN CITY': 0x01,
            'PEWTER CITY': 0x02,
            'CERULEAN CITY': 0x03,
            'LAVENDER TOWN': 0x04,
            'VERMILION CITY': 0x05,
            'CELADON CITY': 0x06,
            'FUCHSIA CITY': 0x07,
            'CINNABAR ISLAND': 0x08,
            'INDIGO PLATEAU': 0x09,
            'SAFFRON CITY': 0x0A,
            'HALL OF FAME': 0x76,
        };

        return locationMap[locationStr] || null;
    }

    /**
     * Get next uncompleted checkpoint in order
     * @returns {Object|null}
     */
    getNextCheckpoint() {
        const uncompleted = CURRICULUM
            .filter(c => !this.completedCheckpoints.has(c.id))
            .sort((a, b) => a.order - b.order);

        return uncompleted[0] || null;
    }

    /**
     * Get all uncompleted checkpoints
     * @returns {Object[]}
     */
    getUncompletedCheckpoints() {
        return CURRICULUM
            .filter(c => !this.completedCheckpoints.has(c.id))
            .sort((a, b) => a.order - b.order);
    }

    /**
     * Get completion statistics
     * @returns {Object}
     */
    getStats() {
        const badgeCheckpoints = CURRICULUM.filter(c => c.type === CHECKPOINT_TYPES.BADGE);
        const completedBadges = badgeCheckpoints.filter(c => this.completedCheckpoints.has(c.id));

        return {
            totalCheckpoints: CURRICULUM.length,
            completedCheckpoints: this.completedCheckpoints.size,
            completionPercent: Math.round((this.completedCheckpoints.size / CURRICULUM.length) * 100),
            totalReward: this.totalReward,
            badges: `${completedBadges.length}/8`,
            nextCheckpoint: this.getNextCheckpoint(),
        };
    }

    /**
     * Get curriculum summary for LLM context
     * @returns {string}
     */
    getSummaryForLLM() {
        const stats = this.getStats();
        const next = stats.nextCheckpoint;
        const recent = this.checkpointHistory.slice(-3);

        let summary = `Progress: ${stats.completionPercent}% (${stats.completedCheckpoints}/${stats.totalCheckpoints} checkpoints)\n`;
        summary += `Badges: ${stats.badges}\n`;

        if (next) {
            summary += `\nNext objective: ${next.name}\n`;
            summary += `  "${next.description}"\n`;
        }

        if (recent.length > 0) {
            summary += `\nRecent achievements:\n`;
            for (const entry of recent.reverse()) {
                summary += `  - ${entry.name} (+${entry.reward})\n`;
            }
        }

        return summary;
    }

    /**
     * Save progress to localStorage
     */
    save() {
        try {
            const data = {
                completed: Array.from(this.completedCheckpoints),
                history: this.checkpointHistory,
                totalReward: this.totalReward,
            };
            localStorage.setItem('tesserack-curriculum', JSON.stringify(data));
        } catch (e) {
            console.warn('Failed to save curriculum progress:', e);
        }
    }

    /**
     * Load progress from localStorage
     */
    load() {
        try {
            const saved = localStorage.getItem('tesserack-curriculum');
            if (saved) {
                const data = JSON.parse(saved);
                this.completedCheckpoints = new Set(data.completed || []);
                this.checkpointHistory = data.history || [];
                this.totalReward = data.totalReward || 0;
            }
        } catch (e) {
            console.warn('Failed to load curriculum progress:', e);
        }
    }

    /**
     * Reset all progress
     */
    reset() {
        this.completedCheckpoints.clear();
        this.checkpointHistory = [];
        this.totalReward = 0;
        localStorage.removeItem('tesserack-curriculum');
    }
}

// Export singleton instance
export const curriculumTracker = new CurriculumTracker();
