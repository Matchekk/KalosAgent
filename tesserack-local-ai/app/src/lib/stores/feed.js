// Activity feed store - unified stream of all events
import { writable, derived } from 'svelte/store';

// Feed items array
export const feedItems = writable([]);

// Max items to keep
const MAX_ITEMS = 50;

// Feed item types
export const FEED_TYPES = {
    DISCOVERY: 'discovery',      // New location, Pokemon, badge
    TRAINING: 'training',        // Training started, completed
    CHECKPOINT: 'checkpoint',    // Visual checkpoint reached
    REWARD: 'reward',           // Significant reward earned
    ACTION: 'action',           // Agent action (optional, can be noisy)
    SYSTEM: 'system',           // System messages
    HINT: 'hint',               // User hints
};

// Add item to feed
export function addFeedItem(type, message, data = {}) {
    const item = {
        id: Date.now() + Math.random(),
        type,
        message,
        timestamp: Date.now(),
        ...data,
    };

    feedItems.update(items => {
        const newItems = [item, ...items];
        return newItems.slice(0, MAX_ITEMS);
    });

    return item;
}

// Convenience functions for common events
export function feedDiscovery(name, reward, significance = 'minor') {
    return addFeedItem(FEED_TYPES.DISCOVERY, name, { reward, significance });
}

export function feedTraining(message, status = 'info') {
    return addFeedItem(FEED_TYPES.TRAINING, message, { status });
}

export function feedCheckpoint(name, reward) {
    return addFeedItem(FEED_TYPES.CHECKPOINT, `Checkpoint: ${name}`, { reward });
}

export function feedReward(reason, reward) {
    return addFeedItem(FEED_TYPES.REWARD, reason, { reward });
}

export function feedSystem(message) {
    return addFeedItem(FEED_TYPES.SYSTEM, message);
}

export function feedHint(hint) {
    return addFeedItem(FEED_TYPES.HINT, `Hint: "${hint}"`);
}

// Clear feed
export function clearFeed() {
    feedItems.set([]);
}

// Progress tracking (derived from feed)
export const discoveries = writable({
    locations: new Set(),
    pokemon: new Set(),
    badges: 0,
});

export function trackDiscovery(type, name) {
    discoveries.update(d => {
        if (type === 'location') d.locations.add(name);
        if (type === 'pokemon') d.pokemon.add(name);
        if (type === 'badge') d.badges++;
        return d;
    });
}

// Discovery counts (derived)
export const discoveryCounts = derived(discoveries, $d => ({
    locations: $d.locations.size,
    pokemon: $d.pokemon.size,
    badges: $d.badges,
}));
