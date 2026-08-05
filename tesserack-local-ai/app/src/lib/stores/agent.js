// Agent state store - manages AI agent state and modes
import { writable, derived } from 'svelte/store';

// Active mode: 'idle' | 'watch' | 'train' | 'manual'
export const activeMode = writable('idle');

// Agent instances (held, not reactive)
export const gameAgent = writable(null);
export const rlAgent = writable(null);
export const dataCollector = writable(null);

// AI reasoning state
export const aiState = writable({
    objective: '',
    objectiveHint: '',
    objectiveOverrideActive: false,
    reasoning: '',
    actions: [],
    planSource: '', // 'llm' | 'neural-policy' | 'exploration'
    gameState: null, // Current game state for visibility
    // Progress tracking
    progress: null, // { currentCheckpoint, distancePercent, gameProgress, locationOrder, region }
});

// Statistics
export const stats = writable({
    totalReward: 0,
    experiences: 0,
    mapsVisited: 0,
    explorationSteps: 0,
    humanDemos: 0,
});

// User hint (temporary, expires after N calls)
export const userHint = writable('');
export const hintRemaining = writable(0);

// Objective override (persistent until cleared)
export const objectiveOverride = writable('');

export function setObjectiveOverride(objective) {
    objectiveOverride.set(objective || '');
}

export function clearObjectiveOverride() {
    objectiveOverride.set('');
}

// Is agent running?
export const isRunning = derived(activeMode, $mode => $mode !== 'idle' && $mode !== 'manual');

// Update AI state
export function updateAIState(update) {
    aiState.update(state => ({ ...state, ...update }));
}

// Update stats
export function updateStats(update) {
    stats.update(s => ({ ...s, ...update }));
}

// Set hint
export function setHint(hint, duration = 5) {
    userHint.set(hint);
    hintRemaining.set(duration);
}

// Clear hint
export function clearHint() {
    userHint.set('');
    hintRemaining.set(0);
}
