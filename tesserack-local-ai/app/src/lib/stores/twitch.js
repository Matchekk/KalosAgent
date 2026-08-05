// Twitch live status store
import { writable } from 'svelte/store';

export const twitchStatus = writable({
    isLive: false,
    checking: true,
});

export function setLive(isLive) {
    twitchStatus.set({ isLive, checking: false });
}

export function setChecking() {
    twitchStatus.update(s => ({ ...s, checking: true }));
}
