// storage.js - localStorage save/load
const SAVE_KEY = 'tesserack-save';
const SETTINGS_KEY = 'tesserack-settings';

export function saveState(emulator) {
    try {
        console.log('Saving state...');
        const state = emulator.saveState();
        console.log('Got state, size:', state.length);

        // Convert Uint8Array to base64 using chunks to avoid stack overflow
        const CHUNK_SIZE = 0x8000; // 32KB chunks
        const chunks = [];
        for (let i = 0; i < state.length; i += CHUNK_SIZE) {
            const chunk = state.subarray(i, i + CHUNK_SIZE);
            chunks.push(String.fromCharCode.apply(null, chunk));
        }
        const binary = chunks.join('');
        const encoded = btoa(binary);
        console.log('Encoded size:', encoded.length);

        localStorage.setItem(SAVE_KEY, encoded);
        console.log('Saved to localStorage');
        return true;
    } catch (err) {
        console.error('Save failed:', err);
        console.error('Error stack:', err.stack);
        return false;
    }
}

export function loadState(emulator) {
    try {
        const saved = localStorage.getItem(SAVE_KEY);
        if (!saved) return false;

        const bytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
        emulator.loadState(bytes);
        return true;
    } catch (err) {
        console.error('Load failed:', err);
        return false;
    }
}

export function hasSavedState() {
    return localStorage.getItem(SAVE_KEY) !== null;
}

export function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : {};
}
