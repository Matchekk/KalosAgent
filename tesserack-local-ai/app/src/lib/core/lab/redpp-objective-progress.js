import { hasCredibleParty } from './autonomous-progress.js';
import { getRedppLocationProgress, normalizeRedppLocation } from './redpp-location-data.js';

/**
 * Exact guide objective names that can be proven from stable Red++ RAM.
 *
 * This deliberately excludes objectives such as optional catches or item
 * collection when the memory reader has no durable evidence for them. The UI
 * must prefer an honest pending objective over a false completion.
 */
export const REDPP_PROVABLE_OBJECTIVES = Object.freeze({
    starter: 'Choose a starter Pokemon',
    viridian: 'Reach Viridian City',
    oakSequence: "Complete Oak's parcel and Pokedex sequence",
    forest: 'Traverse Viridian Forest to Pewter City',
    boulder: 'Defeat Brock for the Boulder Badge',
    cascade: 'Defeat Misty for the Cascade Badge',
    thunder: 'Defeat Lt. Surge for the Thunder Badge',
    rainbow: 'Defeat Erika for the Rainbow Badge and Strength access',
    soul: 'Defeat Koga for the Soul Badge and Surf access',
    marsh: 'Defeat Sabrina for the Marsh Badge',
    volcano: 'Defeat Blaine for the Volcano Badge',
    earth: 'Defeat Giovanni for the Earth Badge',
});

const BADGE_OBJECTIVES = Object.freeze([
    ['BOULDER', REDPP_PROVABLE_OBJECTIVES.boulder],
    ['CASCADE', REDPP_PROVABLE_OBJECTIVES.cascade],
    ['THUNDER', REDPP_PROVABLE_OBJECTIVES.thunder],
    ['RAINBOW', REDPP_PROVABLE_OBJECTIVES.rainbow],
    ['SOUL', REDPP_PROVABLE_OBJECTIVES.soul],
    ['MARSH', REDPP_PROVABLE_OBJECTIVES.marsh],
    ['VOLCANO', REDPP_PROVABLE_OBJECTIVES.volcano],
    ['EARTH', REDPP_PROVABLE_OBJECTIVES.earth],
]);

function normalizeCompleted(values) {
    if (values instanceof Set) return [...values];
    return Array.isArray(values) ? values : [];
}

/**
 * Derive guide completion solely from the visible worker's stable RAM state.
 * Existing names are retained, but reward-only IDs are harmless because the
 * graph only matches exact objective names/IDs.
 */
export function deriveRedppGuideObjectives(state = {}, existing = []) {
    const completed = new Set(normalizeCompleted(existing));
    if (!hasCredibleParty(state)) return completed;

    completed.add(REDPP_PROVABLE_OBJECTIVES.starter);

    const location = normalizeRedppLocation(state.location);
    const locationProgress = getRedppLocationProgress(location);
    const viridianProgress = getRedppLocationProgress('VIRIDIAN CITY');
    const pewterProgress = getRedppLocationProgress('PEWTER CITY');

    if (locationProgress >= viridianProgress) {
        completed.add(REDPP_PROVABLE_OBJECTIVES.viridian);
    }

    // Map order cannot prove that Oak received the parcel. Only the durable
    // Red++ event may complete the objective; imported heuristic snapshots
    // remain diagnostic data and deliberately do not pass this proof.
    if (state.progressFlags?.gotPokedex) {
        completed.add(REDPP_PROVABLE_OBJECTIVES.oakSequence);
    }

    if (state.progressFlags?.gotPokedex && locationProgress >= pewterProgress) {
        completed.add(REDPP_PROVABLE_OBJECTIVES.forest);
    }

    const badges = new Set((state.badges || []).map(name => String(name).toUpperCase()));
    for (const [badge, objective] of BADGE_OBJECTIVES) {
        if (badges.has(badge)) completed.add(objective);
    }

    return completed;
}
