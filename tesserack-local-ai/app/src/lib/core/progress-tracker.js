// progress-tracker.js - Continuous progress tracking toward checkpoints
// Layer 2 of memory architecture: Extract atomic facts for reward shaping

/**
 * Location progression graph for Pokemon Red
 * Each location has an 'order' value representing progression through the game
 * Higher order = further in the game
 */
const LOCATION_GRAPH = {
    // Starting area (0-10)
    "PLAYER'S HOUSE 2F": { order: 0, region: 'pallet' },
    "PLAYER'S HOUSE 1F": { order: 1, region: 'pallet' },
    "PALLET TOWN": { order: 2, region: 'pallet' },
    "RIVAL'S HOUSE": { order: 3, region: 'pallet' },
    "OAK'S LAB": { order: 4, region: 'pallet' },

    // Route 1 to Viridian (10-20)
    "ROUTE 1": { order: 10, region: 'route1' },
    "VIRIDIAN CITY": { order: 15, region: 'viridian' },
    "VIRIDIAN POKEMON CENTER": { order: 16, region: 'viridian' },
    "VIRIDIAN POKEMART": { order: 17, region: 'viridian' },
    "VIRIDIAN GYM": { order: 18, region: 'viridian' }, // Locked until later

    // Back to Pallet for Oak's Parcel (20-25)
    // (Same locations, but after getting parcel)

    // Route 2 and Viridian Forest (25-40)
    "ROUTE 2": { order: 25, region: 'route2' },
    "VIRIDIAN FOREST": { order: 30, region: 'viridian_forest' },
    "VIRIDIAN FOREST SOUTH": { order: 28, region: 'viridian_forest' },
    "VIRIDIAN FOREST NORTH": { order: 32, region: 'viridian_forest' },

    // Pewter City (40-50)
    "PEWTER CITY": { order: 40, region: 'pewter' },
    "PEWTER POKEMON CENTER": { order: 41, region: 'pewter' },
    "PEWTER POKEMART": { order: 42, region: 'pewter' },
    "PEWTER GYM": { order: 45, region: 'pewter' },
    "PEWTER MUSEUM 1F": { order: 43, region: 'pewter' },
    "PEWTER MUSEUM 2F": { order: 44, region: 'pewter' },

    // Route 3 and Mt Moon (50-70)
    "ROUTE 3": { order: 50, region: 'route3' },
    "MT MOON 1F": { order: 55, region: 'mt_moon' },
    "MT MOON B1F": { order: 58, region: 'mt_moon' },
    "MT MOON B2F": { order: 60, region: 'mt_moon' },
    "ROUTE 4": { order: 65, region: 'route4' },

    // Cerulean City (70-85)
    "CERULEAN CITY": { order: 70, region: 'cerulean' },
    "CERULEAN POKEMON CENTER": { order: 71, region: 'cerulean' },
    "CERULEAN POKEMART": { order: 72, region: 'cerulean' },
    "CERULEAN GYM": { order: 75, region: 'cerulean' },
    "CERULEAN HOUSE 1": { order: 73, region: 'cerulean' },
    "CERULEAN HOUSE 2": { order: 74, region: 'cerulean' },

    // Routes 24-25 and Bill's (85-100)
    "ROUTE 24": { order: 85, region: 'nugget_bridge' },
    "ROUTE 25": { order: 90, region: 'route25' },
    "BILL'S HOUSE": { order: 95, region: 'route25' },

    // Route 5-6 to Vermilion (100-130)
    "ROUTE 5": { order: 100, region: 'route5' },
    "ROUTE 5 GATE": { order: 102, region: 'route5' },
    "UNDERGROUND PATH NORTH": { order: 105, region: 'underground' },
    "UNDERGROUND PATH SOUTH": { order: 107, region: 'underground' },
    "ROUTE 6": { order: 110, region: 'route6' },
    "ROUTE 6 GATE": { order: 112, region: 'route6' },
    "VERMILION CITY": { order: 120, region: 'vermilion' },
    "VERMILION POKEMON CENTER": { order: 121, region: 'vermilion' },
    "VERMILION POKEMART": { order: 122, region: 'vermilion' },
    "VERMILION GYM": { order: 125, region: 'vermilion' },
    "VERMILION DOCK": { order: 123, region: 'vermilion' },
    "SS ANNE 1F": { order: 126, region: 'ss_anne' },
    "SS ANNE 2F": { order: 127, region: 'ss_anne' },
    "SS ANNE CAPTAIN'S ROOM": { order: 128, region: 'ss_anne' },

    // Route 11 and Diglett's Cave (130-145)
    "ROUTE 11": { order: 130, region: 'route11' },
    "ROUTE 11 GATE 1F": { order: 132, region: 'route11' },
    "ROUTE 11 GATE 2F": { order: 133, region: 'route11' },
    "DIGLETT'S CAVE": { order: 140, region: 'digletts_cave' },

    // Route 9-10 and Rock Tunnel (145-170)
    "ROUTE 9": { order: 145, region: 'route9' },
    "ROUTE 10": { order: 150, region: 'route10' },
    "ROCK TUNNEL 1F": { order: 155, region: 'rock_tunnel' },
    "ROCK TUNNEL B1F": { order: 160, region: 'rock_tunnel' },
    "POWER PLANT": { order: 165, region: 'power_plant' },

    // Lavender Town (170-185)
    "LAVENDER TOWN": { order: 170, region: 'lavender' },
    "LAVENDER POKEMON CENTER": { order: 171, region: 'lavender' },
    "LAVENDER POKEMART": { order: 172, region: 'lavender' },
    "POKEMON TOWER 1F": { order: 175, region: 'pokemon_tower' },
    "POKEMON TOWER 2F": { order: 176, region: 'pokemon_tower' },
    "POKEMON TOWER 3F": { order: 177, region: 'pokemon_tower' },
    "POKEMON TOWER 4F": { order: 178, region: 'pokemon_tower' },
    "POKEMON TOWER 5F": { order: 179, region: 'pokemon_tower' },
    "POKEMON TOWER 6F": { order: 180, region: 'pokemon_tower' },
    "POKEMON TOWER 7F": { order: 181, region: 'pokemon_tower' },

    // Route 8 and Celadon (185-210)
    "ROUTE 8": { order: 185, region: 'route8' },
    "ROUTE 8 GATE": { order: 187, region: 'route8' },
    "CELADON CITY": { order: 200, region: 'celadon' },
    "CELADON POKEMON CENTER": { order: 201, region: 'celadon' },
    "CELADON DEPT STORE 1F": { order: 202, region: 'celadon' },
    "CELADON DEPT STORE 2F": { order: 203, region: 'celadon' },
    "CELADON DEPT STORE 3F": { order: 204, region: 'celadon' },
    "CELADON DEPT STORE 4F": { order: 205, region: 'celadon' },
    "CELADON DEPT STORE 5F": { order: 206, region: 'celadon' },
    "CELADON MANSION 1F": { order: 207, region: 'celadon' },
    "CELADON GYM": { order: 210, region: 'celadon' },
    "GAME CORNER": { order: 208, region: 'celadon' },
    "ROCKET HIDEOUT B1F": { order: 211, region: 'rocket_hideout' },
    "ROCKET HIDEOUT B2F": { order: 212, region: 'rocket_hideout' },
    "ROCKET HIDEOUT B3F": { order: 213, region: 'rocket_hideout' },
    "ROCKET HIDEOUT B4F": { order: 214, region: 'rocket_hideout' },

    // Saffron City (220-250)
    "SAFFRON CITY": { order: 220, region: 'saffron' },
    "SAFFRON POKEMON CENTER": { order: 221, region: 'saffron' },
    "SAFFRON POKEMART": { order: 222, region: 'saffron' },
    "SILPH CO 1F": { order: 230, region: 'silph_co' },
    "SILPH CO 2F": { order: 231, region: 'silph_co' },
    "SILPH CO 3F": { order: 232, region: 'silph_co' },
    "SILPH CO 4F": { order: 233, region: 'silph_co' },
    "SILPH CO 5F": { order: 234, region: 'silph_co' },
    "SILPH CO 6F": { order: 235, region: 'silph_co' },
    "SILPH CO 7F": { order: 236, region: 'silph_co' },
    "SILPH CO 8F": { order: 237, region: 'silph_co' },
    "SILPH CO 9F": { order: 238, region: 'silph_co' },
    "SILPH CO 10F": { order: 239, region: 'silph_co' },
    "SILPH CO 11F": { order: 240, region: 'silph_co' },
    "FIGHTING DOJO": { order: 245, region: 'saffron' },
    "SAFFRON GYM": { order: 250, region: 'saffron' },

    // Routes 12-15 and Fuchsia (250-290)
    "ROUTE 12": { order: 255, region: 'route12' },
    "ROUTE 12 GATE 1F": { order: 256, region: 'route12' },
    "ROUTE 13": { order: 260, region: 'route13' },
    "ROUTE 14": { order: 265, region: 'route14' },
    "ROUTE 15": { order: 270, region: 'route15' },
    "ROUTE 15 GATE 1F": { order: 272, region: 'route15' },
    "FUCHSIA CITY": { order: 280, region: 'fuchsia' },
    "FUCHSIA POKEMON CENTER": { order: 281, region: 'fuchsia' },
    "FUCHSIA POKEMART": { order: 282, region: 'fuchsia' },
    "FUCHSIA GYM": { order: 285, region: 'fuchsia' },
    "SAFARI ZONE GATE": { order: 283, region: 'fuchsia' },
    "SAFARI ZONE CENTER": { order: 284, region: 'safari_zone' },

    // Routes 16-18 and Cycling Road (290-310)
    "ROUTE 16": { order: 290, region: 'route16' },
    "ROUTE 16 GATE 1F": { order: 291, region: 'route16' },
    "ROUTE 17": { order: 295, region: 'cycling_road' },
    "ROUTE 18": { order: 300, region: 'route18' },
    "ROUTE 18 GATE 1F": { order: 302, region: 'route18' },

    // Routes 19-21 and Cinnabar (310-340)
    "ROUTE 19": { order: 310, region: 'route19' },
    "ROUTE 20": { order: 315, region: 'route20' },
    "SEAFOAM ISLANDS 1F": { order: 320, region: 'seafoam' },
    "SEAFOAM ISLANDS B1F": { order: 321, region: 'seafoam' },
    "SEAFOAM ISLANDS B2F": { order: 322, region: 'seafoam' },
    "SEAFOAM ISLANDS B3F": { order: 323, region: 'seafoam' },
    "SEAFOAM ISLANDS B4F": { order: 324, region: 'seafoam' },
    "CINNABAR ISLAND": { order: 330, region: 'cinnabar' },
    "CINNABAR POKEMON CENTER": { order: 331, region: 'cinnabar' },
    "CINNABAR POKEMART": { order: 332, region: 'cinnabar' },
    "CINNABAR GYM": { order: 335, region: 'cinnabar' },
    "POKEMON MANSION 1F": { order: 333, region: 'pokemon_mansion' },
    "POKEMON MANSION 2F": { order: 334, region: 'pokemon_mansion' },
    "POKEMON MANSION 3F": { order: 336, region: 'pokemon_mansion' },
    "POKEMON MANSION B1F": { order: 337, region: 'pokemon_mansion' },
    "CINNABAR LAB": { order: 338, region: 'cinnabar' },
    "ROUTE 21": { order: 340, region: 'route21' },

    // Victory Road and Pokemon League (350-400)
    "ROUTE 22": { order: 350, region: 'route22' },
    "ROUTE 23": { order: 355, region: 'route23' },
    "VICTORY ROAD 1F": { order: 360, region: 'victory_road' },
    "VICTORY ROAD 2F": { order: 365, region: 'victory_road' },
    "VICTORY ROAD 3F": { order: 370, region: 'victory_road' },
    "INDIGO PLATEAU": { order: 380, region: 'indigo_plateau' },
    "INDIGO PLATEAU POKEMON CENTER": { order: 381, region: 'indigo_plateau' },
    "ELITE FOUR LORELEI": { order: 385, region: 'elite_four' },
    "ELITE FOUR BRUNO": { order: 390, region: 'elite_four' },
    "ELITE FOUR AGATHA": { order: 395, region: 'elite_four' },
    "ELITE FOUR LANCE": { order: 398, region: 'elite_four' },
    "CHAMPION'S ROOM": { order: 400, region: 'elite_four' },
    "HALL OF FAME": { order: 405, region: 'elite_four' },
};

/**
 * Checkpoint requirements mapping
 * Maps curriculum checkpoint IDs to progress requirements
 */
const CHECKPOINT_REQUIREMENTS = {
    // Early game
    'get_starter': {
        targetLocation: "OAK'S LAB",
        requiredBadges: 0,
        partySize: 1,
        description: 'Get starter Pokemon from Oak'
    },
    'exit_house': {
        targetLocation: "PALLET TOWN",
        requiredBadges: 0,
        description: 'Exit your house'
    },
    'reach_route1': {
        targetLocation: "ROUTE 1",
        requiredBadges: 0,
        description: 'Reach Route 1'
    },
    'reach_viridian': {
        targetLocation: "VIRIDIAN CITY",
        requiredBadges: 0,
        description: 'Reach Viridian City'
    },
    'get_parcel': {
        targetLocation: "VIRIDIAN POKEMART",
        requiredBadges: 0,
        hasItem: "OAK'S PARCEL",
        description: 'Get Oak\'s Parcel from Viridian Mart'
    },
    'deliver_parcel': {
        targetLocation: "OAK'S LAB",
        requiredBadges: 0,
        description: 'Deliver parcel to Oak'
    },

    // First badge arc
    'reach_viridian_forest': {
        targetLocation: "VIRIDIAN FOREST",
        requiredBadges: 0,
        description: 'Enter Viridian Forest'
    },
    'exit_viridian_forest': {
        targetLocation: "ROUTE 2",
        targetOrder: 25, // North exit
        requiredBadges: 0,
        description: 'Exit Viridian Forest (north)'
    },
    'reach_pewter': {
        targetLocation: "PEWTER CITY",
        requiredBadges: 0,
        description: 'Reach Pewter City'
    },
    'boulder_badge': {
        targetLocation: "PEWTER GYM",
        requiredBadges: 1,
        description: 'Defeat Brock, get Boulder Badge'
    },

    // Second badge arc
    'reach_mt_moon': {
        targetLocation: "MT MOON 1F",
        requiredBadges: 1,
        description: 'Enter Mt. Moon'
    },
    'exit_mt_moon': {
        targetLocation: "ROUTE 4",
        requiredBadges: 1,
        description: 'Exit Mt. Moon'
    },
    'reach_cerulean': {
        targetLocation: "CERULEAN CITY",
        requiredBadges: 1,
        description: 'Reach Cerulean City'
    },
    'cascade_badge': {
        targetLocation: "CERULEAN GYM",
        requiredBadges: 2,
        description: 'Defeat Misty, get Cascade Badge'
    },

    // Bill and SS Anne arc
    'reach_bills': {
        targetLocation: "BILL'S HOUSE",
        requiredBadges: 2,
        description: 'Reach Bill\'s house'
    },
    'reach_vermilion': {
        targetLocation: "VERMILION CITY",
        requiredBadges: 2,
        description: 'Reach Vermilion City'
    },
    'board_ss_anne': {
        targetLocation: "SS ANNE 1F",
        requiredBadges: 2,
        description: 'Board the SS Anne'
    },
    'get_cut': {
        targetLocation: "SS ANNE CAPTAIN'S ROOM",
        requiredBadges: 2,
        description: 'Get HM01 Cut from Captain'
    },
    'thunder_badge': {
        targetLocation: "VERMILION GYM",
        requiredBadges: 3,
        description: 'Defeat Lt. Surge, get Thunder Badge'
    },

    // Celadon arc
    'reach_celadon': {
        targetLocation: "CELADON CITY",
        requiredBadges: 3,
        description: 'Reach Celadon City'
    },
    'rainbow_badge': {
        targetLocation: "CELADON GYM",
        requiredBadges: 4,
        description: 'Defeat Erika, get Rainbow Badge'
    },
    'get_silph_scope': {
        targetLocation: "ROCKET HIDEOUT B4F",
        requiredBadges: 4,
        description: 'Get Silph Scope from Rocket Hideout'
    },

    // Lavender and Saffron arc
    'reach_lavender': {
        targetLocation: "LAVENDER TOWN",
        requiredBadges: 3,
        description: 'Reach Lavender Town'
    },
    'pokemon_tower_top': {
        targetLocation: "POKEMON TOWER 7F",
        requiredBadges: 4,
        description: 'Reach top of Pokemon Tower'
    },
    'reach_saffron': {
        targetLocation: "SAFFRON CITY",
        requiredBadges: 4,
        description: 'Enter Saffron City'
    },
    'silph_co_complete': {
        targetLocation: "SILPH CO 11F",
        requiredBadges: 4,
        description: 'Complete Silph Co'
    },
    'marsh_badge': {
        targetLocation: "SAFFRON GYM",
        requiredBadges: 5,
        description: 'Defeat Sabrina, get Marsh Badge'
    },

    // Fuchsia arc
    'reach_fuchsia': {
        targetLocation: "FUCHSIA CITY",
        requiredBadges: 4,
        description: 'Reach Fuchsia City'
    },
    'soul_badge': {
        targetLocation: "FUCHSIA GYM",
        requiredBadges: 5,
        description: 'Defeat Koga, get Soul Badge'
    },

    // Cinnabar arc
    'reach_cinnabar': {
        targetLocation: "CINNABAR ISLAND",
        requiredBadges: 5,
        description: 'Reach Cinnabar Island'
    },
    'volcano_badge': {
        targetLocation: "CINNABAR GYM",
        requiredBadges: 7,
        description: 'Defeat Blaine, get Volcano Badge'
    },

    // Final gym
    'earth_badge': {
        targetLocation: "VIRIDIAN GYM",
        requiredBadges: 8,
        description: 'Defeat Giovanni, get Earth Badge'
    },

    // Victory Road and Elite Four
    'reach_victory_road': {
        targetLocation: "VICTORY ROAD 1F",
        requiredBadges: 8,
        description: 'Enter Victory Road'
    },
    'reach_indigo_plateau': {
        targetLocation: "INDIGO PLATEAU",
        requiredBadges: 8,
        description: 'Reach Indigo Plateau'
    },
    'defeat_elite_four': {
        targetLocation: "HALL OF FAME",
        requiredBadges: 8,
        description: 'Defeat Elite Four and Champion'
    }
};

/**
 * Get location info from the graph
 * @param {string} location - Location name
 * @returns {Object|null} Location info with order and region
 */
function getLocationInfo(location) {
    if (!location) return null;

    // Try exact match first
    const normalized = location.toUpperCase().trim();
    if (LOCATION_GRAPH[normalized]) {
        return { name: normalized, ...LOCATION_GRAPH[normalized] };
    }

    // Try partial match (for variations like "PALLET TOWN" vs "PALLET")
    for (const [key, info] of Object.entries(LOCATION_GRAPH)) {
        if (key.includes(normalized) || normalized.includes(key)) {
            return { name: key, ...info };
        }
    }

    return null;
}

/**
 * Extract atomic progress facts from game state (Layer 2 of memory architecture)
 * @param {Object} state - Game state from memory reader
 * @returns {Object} Progress facts
 */
export function extractProgressFacts(state) {
    const locationInfo = getLocationInfo(state.location);
    const facts = {
        // Location facts
        currentLocation: state.location,
        locationOrder: locationInfo?.order ?? -1,
        region: locationInfo?.region ?? 'unknown',
        coordinates: { ...state.coordinates },

        // Party facts
        partySize: state.party?.length ?? 0,
        totalPartyLevel: state.party?.reduce((sum, p) => sum + p.level, 0) ?? 0,
        avgPartyLevel: state.party?.length > 0
            ? Math.round(state.party.reduce((sum, p) => sum + p.level, 0) / state.party.length)
            : 0,
        partyHealthPercent: state.party?.length > 0
            ? Math.round(state.party.reduce((sum, p) => sum + (p.currentHP / p.maxHP), 0) / state.party.length * 100)
            : 0,
        hasUsablePokemon: state.party?.some(p => p.currentHP > 0) ?? false,

        // Progress facts
        badgeCount: state.badges?.length ?? 0,
        badges: state.badges || [],
        money: state.money ?? 0,

        // State facts
        inBattle: state.inBattle ?? false,
        hasDialog: !!(state.dialog && state.dialog.trim().length > 0),

        // Derived progression estimate (0-100%)
        gameProgressEstimate: calculateProgressEstimate(state),
    };

    return facts;
}

/**
 * Calculate estimated game progress as percentage
 * @param {Object} state - Game state
 * @returns {number} Progress estimate 0-100
 */
function calculateProgressEstimate(state) {
    const locationInfo = getLocationInfo(state.location);
    const locationProgress = locationInfo ? (locationInfo.order / 405) * 50 : 0;
    const badgeProgress = ((state.badges?.length ?? 0) / 8) * 50;
    return Math.round(locationProgress + badgeProgress);
}

/**
 * Measure distance to a checkpoint
 * Returns continuous value for reward shaping (lower = closer)
 * @param {Object} facts - Progress facts from extractProgressFacts
 * @param {string} checkpointId - ID of target checkpoint
 * @returns {Object} Distance measurement
 */
export function measureDistanceToCheckpoint(facts, checkpointId) {
    const checkpoint = CHECKPOINT_REQUIREMENTS[checkpointId];
    if (!checkpoint) {
        return {
            distance: Infinity,
            components: {},
            isComplete: false,
            error: `Unknown checkpoint: ${checkpointId}`
        };
    }

    const targetInfo = getLocationInfo(checkpoint.targetLocation);
    const targetOrder = checkpoint.targetOrder ?? targetInfo?.order ?? 0;

    const components = {
        // Location distance (normalized to 0-1 scale)
        locationDistance: Math.max(0, targetOrder - facts.locationOrder) / 405,

        // Badge distance (normalized)
        badgeDistance: Math.max(0, (checkpoint.requiredBadges ?? 0) - facts.badgeCount) / 8,

        // Same region bonus (being in the right area)
        sameRegion: targetInfo?.region === facts.region ? 0 : 0.1,
    };

    // Weighted combination
    const distance = (
        components.locationDistance * 0.5 +
        components.badgeDistance * 0.4 +
        components.sameRegion * 0.1
    );

    // Check if checkpoint is complete
    const isComplete = checkCheckpointComplete(facts, checkpoint);

    return {
        distance: isComplete ? 0 : distance,
        components,
        isComplete,
        targetLocation: checkpoint.targetLocation,
        targetOrder,
        currentOrder: facts.locationOrder,
        description: checkpoint.description
    };
}

/**
 * Check if a checkpoint's requirements are met
 * @param {Object} facts - Progress facts
 * @param {Object} checkpoint - Checkpoint requirements
 * @returns {boolean}
 */
function checkCheckpointComplete(facts, checkpoint) {
    // Badge requirement
    if (checkpoint.requiredBadges && facts.badgeCount < checkpoint.requiredBadges) {
        return false;
    }

    // Location requirement (for badge checkpoints, being at gym means we beat it if we have the badge)
    if (checkpoint.targetLocation) {
        const targetInfo = getLocationInfo(checkpoint.targetLocation);
        const targetOrder = checkpoint.targetOrder ?? targetInfo?.order ?? 0;

        // For badge checkpoints, check if we have enough badges
        if (checkpoint.requiredBadges > 0 && facts.badgeCount >= checkpoint.requiredBadges) {
            return true;
        }

        // For location checkpoints, check if we've reached or passed the location
        if (facts.locationOrder >= targetOrder) {
            return true;
        }
    }

    // Party size requirement
    if (checkpoint.partySize && facts.partySize < checkpoint.partySize) {
        return false;
    }

    return false;
}

/**
 * Compute progress-based reward for movement toward checkpoint
 * @param {Object} prevFacts - Previous step's facts
 * @param {Object} currFacts - Current step's facts
 * @param {string} checkpointId - Target checkpoint
 * @returns {Object} Reward info
 */
export function computeProgressReward(prevFacts, currFacts, checkpointId) {
    const prevDist = measureDistanceToCheckpoint(prevFacts, checkpointId);
    const currDist = measureDistanceToCheckpoint(currFacts, checkpointId);

    // If checkpoint just completed, big bonus
    if (!prevDist.isComplete && currDist.isComplete) {
        return {
            reward: 10.0,
            reason: `Checkpoint completed: ${currDist.description}`,
            prevDistance: prevDist.distance,
            currDistance: currDist.distance,
            improvement: prevDist.distance
        };
    }

    // Calculate distance improvement (positive = getting closer)
    const improvement = prevDist.distance - currDist.distance;

    // Scale reward: small continuous rewards for progress
    // Clip to prevent huge rewards from noise
    const clippedImprovement = Math.max(-0.1, Math.min(0.1, improvement));
    const reward = clippedImprovement * 5.0; // Scale factor

    let reason = 'No progress';
    if (improvement > 0.001) {
        reason = `Progress toward ${currDist.description} (+${(improvement * 100).toFixed(1)}%)`;
    } else if (improvement < -0.001) {
        reason = `Moving away from ${currDist.description} (${(improvement * 100).toFixed(1)}%)`;
    }

    return {
        reward,
        reason,
        prevDistance: prevDist.distance,
        currDistance: currDist.distance,
        improvement,
        targetDescription: currDist.description
    };
}

/**
 * Get the current/next checkpoint based on game state
 * @param {Object} facts - Progress facts
 * @returns {Object} Current checkpoint info
 */
export function getCurrentCheckpoint(facts) {
    // Find first incomplete checkpoint based on progression
    const checkpointOrder = [
        'exit_house', 'reach_route1', 'reach_viridian', 'get_parcel',
        'deliver_parcel', 'get_starter', 'reach_viridian_forest',
        'exit_viridian_forest', 'reach_pewter', 'boulder_badge',
        'reach_mt_moon', 'exit_mt_moon', 'reach_cerulean', 'cascade_badge',
        'reach_bills', 'reach_vermilion', 'board_ss_anne', 'get_cut',
        'thunder_badge', 'reach_celadon', 'rainbow_badge', 'get_silph_scope',
        'reach_lavender', 'pokemon_tower_top', 'reach_saffron',
        'silph_co_complete', 'marsh_badge', 'reach_fuchsia', 'soul_badge',
        'reach_cinnabar', 'volcano_badge', 'earth_badge',
        'reach_victory_road', 'reach_indigo_plateau', 'defeat_elite_four'
    ];

    for (const checkpointId of checkpointOrder) {
        const dist = measureDistanceToCheckpoint(facts, checkpointId);
        if (!dist.isComplete) {
            return {
                id: checkpointId,
                ...dist,
                checkpoint: CHECKPOINT_REQUIREMENTS[checkpointId]
            };
        }
    }

    // All complete - game finished!
    return {
        id: 'defeat_elite_four',
        distance: 0,
        isComplete: true,
        description: 'Become Pokemon Champion!'
    };
}

/**
 * Get all checkpoint statuses for display
 * @param {Object} facts - Progress facts
 * @returns {Array} Checkpoint statuses
 */
export function getAllCheckpointStatuses(facts) {
    return Object.entries(CHECKPOINT_REQUIREMENTS).map(([id, checkpoint]) => {
        const dist = measureDistanceToCheckpoint(facts, id);
        return {
            id,
            description: checkpoint.description,
            targetLocation: checkpoint.targetLocation,
            isComplete: dist.isComplete,
            distance: dist.distance,
            distancePercent: Math.round((1 - dist.distance) * 100)
        };
    });
}

// Export constants for external use
export { LOCATION_GRAPH, CHECKPOINT_REQUIREMENTS };
