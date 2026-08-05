// Game state store - manages emulator, memory reader, and game state
import { writable, derived } from 'svelte/store';

// Core instances (not reactive, just held here)
export const emulator = writable(null);
export const memoryReader = writable(null);

// Game state (reactive)
export const gameState = writable({
    location: 'Unknown',
    coordinates: { x: 0, y: 0 },
    mapId: 0,
    badges: [],
    party: [],
    money: 0,
    inBattle: false,
    dialog: ''
});

// ROM loaded state
export const romLoaded = writable(false);

// ROM buffer (passed from dropzone to canvas for initialization)
export const romBuffer = writable(null);

// Derived state
export const badgeCount = derived(gameState, $state => $state.badges?.length || 0);
export const partyCount = derived(gameState, $state => $state.party?.length || 0);
export const isInBattle = derived(gameState, $state => $state.inBattle);

// Update game state from memory reader
export function updateGameState(state) {
    gameState.set(state);
}
