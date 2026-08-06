// Champion-first Red++ curriculum derived from the user-supplied Oak Guide.
// Source guide: Red++ 4.5.3. Runtime target: Red++ 3.0.2.
// Checkpoints are informational: numeric rewards are owned by reward systems.

export const CHECKPOINT_TYPES = Object.freeze({
    BADGE: 'badge',
    KEY_ITEM: 'key_item',
    LOCATION: 'location',
    EVENT: 'event',
    OPTIONAL: 'optional',
});

export const REWARDS = Object.freeze({
    [CHECKPOINT_TYPES.BADGE]: 0,
    [CHECKPOINT_TYPES.KEY_ITEM]: 0,
    [CHECKPOINT_TYPES.LOCATION]: 0,
    [CHECKPOINT_TYPES.EVENT]: 0,
    [CHECKPOINT_TYPES.OPTIONAL]: 0,
});

export const CURRICULUM = [
    checkpoint('starter', 'Choose a starter Pokemon', 'Finish Oak\'s opening sequence.', 'event', 1,
        state => (state.party?.length || 0) > 0),
    checkpoint('oak_rival', 'Defeat the Oak Lab rival', 'Confirm the first Red++ rival battle.', 'event', 2,
        state => Boolean(state.progressFlags?.battledRivalInOaksLab)),
    badge('boulder', 'Boulder Badge', 'Defeat Brock and leave Pewter to the east.', 3, 'BOULDER'),
    location('mt_moon', 'Cross Mt. Moon', 'Reach and cross the Red++ Mt. Moon route.', 4, 'MT MOON'),
    badge('cascade', 'Cascade Badge', 'Defeat Misty to unlock Cut progression.', 5, 'CASCADE'),
    item('cut', 'Obtain HM01 Cut', 'Clear the S.S. Anne before it departs.', 6, ['HM01', 'CUT']),
    item('silph_scope', 'Obtain the Silph Scope', 'Clear the Celadon Rocket Hideout.', 7, ['SILPH SCOPE']),
    item('poke_flute', 'Obtain the Poke Flute', 'Clear Pokemon Tower and rescue Mr. Fuji.', 8, ['POKE FLUTE']),
    badge('soul', 'Soul Badge', 'Defeat Koga; the Oak Guide prioritizes Surf access.', 9, 'SOUL'),
    item('surf', 'Obtain HM03 Surf', 'Reach the Safari Zone secret house.', 10, ['HM03', 'SURF']),
    item('strength', 'Obtain HM04 Strength', 'Return the Gold Teeth to the Safari Warden.', 11, ['HM04', 'STRENGTH']),
    badge('rainbow', 'Rainbow Badge', 'Defeat Erika; Strength is now useful with Surf.', 12, 'RAINBOW'),
    badge('thunder', 'Thunder Badge', 'Defeat Lt. Surge; the Oak route safely delays this badge.', 13, 'THUNDER'),
    item('master_ball', 'Clear Silph Co.', 'Obtain the Master Ball after defeating Team Rocket.', 14, ['MASTER BALL']),
    badge('marsh', 'Marsh Badge', 'Defeat Sabrina.', 15, 'MARSH'),
    item('secret_key', 'Obtain the Secret Key', 'Explore Pokemon Mansion to open Cinnabar Gym.', 16, ['SECRET KEY']),
    badge('volcano', 'Volcano Badge', 'Defeat Blaine.', 17, 'VOLCANO'),
    badge('earth', 'Earth Badge', 'Defeat Giovanni for the eighth badge.', 18, 'EARTH'),
    location('victory_road', 'Enter Victory Road', 'Pass the badge gates and enter the final cave.', 19, 'VICTORY ROAD'),
    location('indigo_plateau', 'Reach Indigo Plateau', 'Finish Victory Road and prepare for the League.', 20, 'INDIGO PLATEAU'),
    location('champion', 'Become Pokemon Champion', 'Defeat the Elite Four and Champion.', 21, 'HALL OF FAME', 'CHAMPIONS ROOM'),
];

function checkpoint(id, name, description, type, order, condition) {
    return { id, name, description, type, order, reward: 0, condition, guideRef: 'Red++ Oak Guide 4.5.3' };
}

function badge(id, name, description, order, badgeName) {
    return checkpoint(`badge_${id}`, name, description, CHECKPOINT_TYPES.BADGE, order,
        state => hasBadge(state, badgeName));
}

function item(id, name, description, order, names) {
    return checkpoint(`item_${id}`, name, description, CHECKPOINT_TYPES.KEY_ITEM, order,
        state => hasItem(state, names));
}

function location(id, name, description, order, ...locationNames) {
    return checkpoint(`location_${id}`, name, description, CHECKPOINT_TYPES.LOCATION, order,
        state => locationNames.some(value => normalize(state.location).includes(normalize(value))));
}

function hasBadge(state, name) {
    return (state.badges || []).some(value => normalize(value).includes(normalize(name)));
}

function hasItem(state, names) {
    return (state.items || []).some(itemValue => {
        const name = normalize(typeof itemValue === 'string' ? itemValue : itemValue?.name);
        return names.some(expected => name.includes(normalize(expected)));
    });
}

function normalize(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
}

export class CurriculumTracker {
    constructor() {
        this.storageKey = 'tesserack-redpp-curriculum-v2';
        this.completedCheckpoints = new Set();
        this.checkpointHistory = [];
        this.totalReward = 0;
        this.load();
    }

    checkProgress(gameState = {}) {
        const newlyCompleted = [];
        for (const entry of CURRICULUM) {
            if (this.completedCheckpoints.has(entry.id)) continue;
            try {
                if (!entry.condition(gameState)) continue;
                this.completedCheckpoints.add(entry.id);
                const completed = {
                    id: entry.id,
                    name: entry.name,
                    description: entry.description,
                    type: entry.type,
                    reward: 0,
                    timestamp: Date.now(),
                    order: entry.order,
                };
                this.checkpointHistory.push(completed);
                newlyCompleted.push(completed);
            } catch (error) {
                console.warn(`[Curriculum] Could not evaluate ${entry.id}:`, error.message);
            }
        }
        if (newlyCompleted.length > 0) this.save();
        return newlyCompleted;
    }

    getNextCheckpoint() {
        return CURRICULUM.find(entry => !this.completedCheckpoints.has(entry.id)) || null;
    }

    getUncompletedCheckpoints() {
        return CURRICULUM.filter(entry => !this.completedCheckpoints.has(entry.id));
    }

    getStats() {
        const badgeEntries = CURRICULUM.filter(entry => entry.type === CHECKPOINT_TYPES.BADGE);
        const completedBadges = badgeEntries.filter(entry => this.completedCheckpoints.has(entry.id)).length;
        return {
            source: 'Red++ Oak Guide 4.5.3 (advisory for ROM 3.0.2)',
            totalCheckpoints: CURRICULUM.length,
            completedCheckpoints: this.completedCheckpoints.size,
            completionPercent: Math.round(100 * this.completedCheckpoints.size / CURRICULUM.length),
            totalReward: 0,
            badges: `${completedBadges}/8`,
            nextCheckpoint: this.getNextCheckpoint(),
        };
    }

    getSummaryForLLM() {
        const stats = this.getStats();
        const next = stats.nextCheckpoint;
        const lines = [
            '[RED++ CHAMPION CURRICULUM]',
            `Progress: ${stats.completionPercent}% (${stats.completedCheckpoints}/${stats.totalCheckpoints})`,
            `Badges: ${stats.badges}`,
        ];
        if (next) lines.push(`Next objective: ${next.name}`, next.description);
        return lines.join('\n');
    }

    save() {
        if (typeof localStorage === 'undefined') return;
        try {
            localStorage.setItem(this.storageKey, JSON.stringify({
                version: 2,
                completed: [...this.completedCheckpoints],
                history: this.checkpointHistory,
            }));
        } catch (error) {
            console.warn('[Curriculum] Save failed:', error.message);
        }
    }

    load() {
        if (typeof localStorage === 'undefined') return;
        try {
            const saved = JSON.parse(localStorage.getItem(this.storageKey) || 'null');
            if (saved?.version !== 2) return;
            this.completedCheckpoints = new Set(saved.completed || []);
            this.checkpointHistory = saved.history || [];
        } catch (error) {
            console.warn('[Curriculum] Ignoring invalid saved curriculum:', error.message);
        }
    }

    reset() {
        this.completedCheckpoints.clear();
        this.checkpointHistory = [];
        this.totalReward = 0;
        if (typeof localStorage !== 'undefined') localStorage.removeItem(this.storageKey);
    }
}

export const curriculumTracker = new CurriculumTracker();
