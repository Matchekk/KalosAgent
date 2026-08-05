// persistence.js - Robust local persistence for all training data
// Uses IndexedDB for large data, localStorage for small metadata

const DB_NAME = 'tesserack-db';
const DB_VERSION = 1;
const PURE_RL_POLICY_KEY = 'tesserack-pure-rl-policy-v1';

// Store names
const STORES = {
    EXPERIENCES: 'experiences',
    DISCOVERIES: 'discoveries',
    CHECKPOINTS: 'checkpoints',
    REWARD_HISTORY: 'rewardHistory',
    LLM_TESTS: 'llmTests',
};

let db = null;

/**
 * Initialize IndexedDB
 */
export async function initDB() {
    if (db) return db;

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Experience buffer store
            if (!database.objectStoreNames.contains(STORES.EXPERIENCES)) {
                const expStore = database.createObjectStore(STORES.EXPERIENCES, { keyPath: 'id', autoIncrement: true });
                expStore.createIndex('timestamp', 'timestamp', { unique: false });
                expStore.createIndex('reward', 'reward', { unique: false });
            }

            // Discoveries store
            if (!database.objectStoreNames.contains(STORES.DISCOVERIES)) {
                const discStore = database.createObjectStore(STORES.DISCOVERIES, { keyPath: 'id' });
                discStore.createIndex('type', 'type', { unique: false });
                discStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // Checkpoints store
            if (!database.objectStoreNames.contains(STORES.CHECKPOINTS)) {
                database.createObjectStore(STORES.CHECKPOINTS, { keyPath: 'name' });
            }

            // Reward history store
            if (!database.objectStoreNames.contains(STORES.REWARD_HISTORY)) {
                const rewardStore = database.createObjectStore(STORES.REWARD_HISTORY, { keyPath: 'id', autoIncrement: true });
                rewardStore.createIndex('timestamp', 'timestamp', { unique: false });
            }

            // LLM-generated tests store
            if (!database.objectStoreNames.contains(STORES.LLM_TESTS)) {
                database.createObjectStore(STORES.LLM_TESTS, { keyPath: 'id' });
            }
        };
    });
}

/**
 * Generic store operations
 */
async function getStore(storeName, mode = 'readonly') {
    const database = await initDB();
    const tx = database.transaction(storeName, mode);
    return tx.objectStore(storeName);
}

async function putItem(storeName, item) {
    const store = await getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
        const request = store.put(item);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getItem(storeName, key) {
    const store = await getStore(storeName);
    return new Promise((resolve, reject) => {
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function getAllItems(storeName) {
    const store = await getStore(storeName);
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function clearStore(storeName) {
    const store = await getStore(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function countItems(storeName) {
    const store = await getStore(storeName);
    return new Promise((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// ============ EXPERIENCE BUFFER ============

/**
 * Save a batch of experiences (more efficient than one at a time)
 */
export async function saveExperiences(experiences) {
    const database = await initDB();
    const tx = database.transaction(STORES.EXPERIENCES, 'readwrite');
    const store = tx.objectStore(STORES.EXPERIENCES);

    for (const exp of experiences) {
        store.put(exp);
    }

    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(experiences.length);
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * Save a single experience
 */
export async function saveExperience(experience) {
    return putItem(STORES.EXPERIENCES, experience);
}

/**
 * Load all experiences
 */
export async function loadExperiences() {
    return getAllItems(STORES.EXPERIENCES);
}

/**
 * Get experience count
 */
export async function getExperienceCount() {
    return countItems(STORES.EXPERIENCES);
}

/**
 * Clear all experiences
 */
export async function clearExperiences() {
    return clearStore(STORES.EXPERIENCES);
}

/**
 * Get recent experiences (for display)
 */
export async function getRecentExperiences(limit = 100) {
    const database = await initDB();
    const tx = database.transaction(STORES.EXPERIENCES, 'readonly');
    const store = tx.objectStore(STORES.EXPERIENCES);
    const index = store.index('timestamp');

    return new Promise((resolve, reject) => {
        const experiences = [];
        const request = index.openCursor(null, 'prev'); // newest first

        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor && experiences.length < limit) {
                experiences.push(cursor.value);
                cursor.continue();
            } else {
                resolve(experiences);
            }
        };
        request.onerror = () => reject(request.error);
    });
}

// ============ DISCOVERIES ============

/**
 * Save a discovery
 */
export async function saveDiscovery(discovery) {
    return putItem(STORES.DISCOVERIES, {
        ...discovery,
        id: `${discovery.type}-${discovery.name}`,
        timestamp: discovery.timestamp || Date.now(),
    });
}

/**
 * Load all discoveries
 */
export async function loadDiscoveries() {
    return getAllItems(STORES.DISCOVERIES);
}

/**
 * Check if discovery exists
 */
export async function hasDiscovery(type, name) {
    const item = await getItem(STORES.DISCOVERIES, `${type}-${name}`);
    return !!item;
}

/**
 * Clear all discoveries
 */
export async function clearDiscoveries() {
    return clearStore(STORES.DISCOVERIES);
}

// ============ CHECKPOINTS ============

/**
 * Save a checkpoint
 */
export async function saveCheckpoint(checkpoint) {
    return putItem(STORES.CHECKPOINTS, checkpoint);
}

/**
 * Load all checkpoints
 */
export async function loadCheckpoints() {
    return getAllItems(STORES.CHECKPOINTS);
}

/**
 * Clear all checkpoints
 */
export async function clearCheckpoints() {
    return clearStore(STORES.CHECKPOINTS);
}

// ============ REWARD HISTORY ============

/**
 * Save reward event
 */
export async function saveRewardEvent(event) {
    return putItem(STORES.REWARD_HISTORY, {
        ...event,
        timestamp: event.timestamp || Date.now(),
    });
}

/**
 * Load reward history
 */
export async function loadRewardHistory() {
    return getAllItems(STORES.REWARD_HISTORY);
}

/**
 * Clear reward history
 */
export async function clearRewardHistory() {
    return clearStore(STORES.REWARD_HISTORY);
}

// ============ LLM TESTS ============

/**
 * Save LLM-generated tests
 */
export async function saveLLMTests(tests) {
    for (const test of tests) {
        await putItem(STORES.LLM_TESTS, {
            ...test,
            id: test.test, // Use test description as ID
        });
    }
}

/**
 * Load LLM tests
 */
export async function loadLLMTests() {
    return getAllItems(STORES.LLM_TESTS);
}

/**
 * Clear LLM tests
 */
export async function clearLLMTests() {
    return clearStore(STORES.LLM_TESTS);
}

// ============ ROM STORAGE ============

const ROM_KEY = 'tesserack-rom';

/**
 * Save ROM to IndexedDB for returning users
 */
export async function saveROM(romBuffer) {
    const database = await initDB();

    // Create a simple object store transaction for ROM
    // We'll store it as a blob in localStorage since it's simpler
    // and ROMs are typically < 2MB
    try {
        const base64 = arrayBufferToBase64(romBuffer);
        localStorage.setItem(ROM_KEY, base64);
        console.log('[Persistence] ROM saved');
        return true;
    } catch (e) {
        console.error('[Persistence] Failed to save ROM:', e);
        return false;
    }
}

/**
 * Load ROM from storage
 */
export function loadROM() {
    try {
        const base64 = localStorage.getItem(ROM_KEY);
        if (!base64) return null;

        const buffer = base64ToArrayBuffer(base64);
        console.log('[Persistence] ROM loaded from storage');
        return buffer;
    } catch (e) {
        console.error('[Persistence] Failed to load ROM:', e);
        return null;
    }
}

/**
 * Check if ROM is saved
 */
export function hasROM() {
    return !!localStorage.getItem(ROM_KEY);
}

/**
 * Clear saved ROM
 */
export function clearROM() {
    localStorage.removeItem(ROM_KEY);
}

// Helper functions for ArrayBuffer <-> Base64
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
}

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

// ============ METADATA (localStorage) ============

const META_KEY = 'tesserack-meta';

/**
 * Save metadata (small data, frequent updates)
 */
export function saveMetadata(meta) {
    const existing = loadMetadata();
    const updated = { ...existing, ...meta, lastUpdated: Date.now() };
    localStorage.setItem(META_KEY, JSON.stringify(updated));
    return updated;
}

/**
 * Load metadata
 */
export function loadMetadata() {
    const data = localStorage.getItem(META_KEY);
    return data ? JSON.parse(data) : {
        totalExperiences: 0,
        totalReward: 0,
        sessionsPlayed: 0,
        uniqueLocations: 0,
        lastPlayed: null,
    };
}

// ============ LAB SAVE STATES ============

const LAB_STATES_KEY = 'tesserack_lab_states';

/**
 * Get Lab save states from localStorage
 */
export function getLabSaveStates() {
    try {
        const stored = localStorage.getItem(LAB_STATES_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (e) {
        console.warn('[Persistence] Failed to load lab states:', e);
        return [];
    }
}

/**
 * Set Lab save states to localStorage
 */
export function setLabSaveStates(states) {
    try {
        localStorage.setItem(LAB_STATES_KEY, JSON.stringify(states));
        return true;
    } catch (e) {
        console.error('[Persistence] Failed to save lab states:', e);
        return false;
    }
}

/** Get the most recently autosaved Pure RL policy. */
export function getPureRLPolicy() {
    try {
        const stored = localStorage.getItem(PURE_RL_POLICY_KEY);
        return stored ? JSON.parse(stored) : null;
    } catch (e) {
        console.warn('[Persistence] Ignoring unreadable Pure RL policy:', e);
        return null;
    }
}

/** Autosave a JSON-safe Pure RL policy snapshot. */
export function setPureRLPolicy(snapshot) {
    try {
        localStorage.setItem(PURE_RL_POLICY_KEY, JSON.stringify(snapshot));
        return true;
    } catch (e) {
        console.error('[Persistence] Failed to save Pure RL policy:', e);
        return false;
    }
}

export function clearPureRLPolicy() {
    localStorage.removeItem(PURE_RL_POLICY_KEY);
}

// ============ FULL EXPORT/IMPORT ============

/**
 * Export all data for backup
 */
export async function exportAllData() {
    const [experiences, discoveries, checkpoints, rewardHistory, llmTests] = await Promise.all([
        loadExperiences(),
        loadDiscoveries(),
        loadCheckpoints(),
        loadRewardHistory(),
        loadLLMTests(),
    ]);

    // Include Lab save states and the learned browser policy
    const labSaveStates = getLabSaveStates();
    const pureRLPolicy = getPureRLPolicy();

    return {
        version: 3,
        exportedAt: new Date().toISOString(),
        metadata: loadMetadata(),
        experiences,
        discoveries,
        checkpoints,
        rewardHistory,
        llmTests,
        labSaveStates,
        pureRLPolicy,
    };
}

/**
 * Import all data from backup
 */
export async function importAllData(data) {
    if (data.experiences?.length) {
        await clearExperiences();
        await saveExperiences(data.experiences);
    }

    if (data.discoveries?.length) {
        await clearDiscoveries();
        for (const d of data.discoveries) {
            await saveDiscovery(d);
        }
    }

    if (data.checkpoints?.length) {
        await clearCheckpoints();
        for (const c of data.checkpoints) {
            await saveCheckpoint(c);
        }
    }

    if (data.rewardHistory?.length) {
        await clearRewardHistory();
        for (const r of data.rewardHistory) {
            await saveRewardEvent(r);
        }
    }

    if (data.llmTests?.length) {
        await clearLLMTests();
        await saveLLMTests(data.llmTests);
    }

    if (data.metadata) {
        saveMetadata(data.metadata);
    }

    // Import Lab save states
    if (data.labSaveStates?.length) {
        setLabSaveStates(data.labSaveStates);
    }

    if (data.pureRLPolicy) {
        setPureRLPolicy(data.pureRLPolicy);
    }

    return true;
}

/**
 * Clear all data (factory reset)
 */
export async function clearAllData() {
    await Promise.all([
        clearExperiences(),
        clearDiscoveries(),
        clearCheckpoints(),
        clearRewardHistory(),
        clearLLMTests(),
    ]);
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(LAB_STATES_KEY);
    clearPureRLPolicy();
    return true;
}

/**
 * Get storage stats
 */
export async function getStorageStats() {
    const [expCount, discCount, cpCount, rewardCount, testCount] = await Promise.all([
        countItems(STORES.EXPERIENCES),
        countItems(STORES.DISCOVERIES),
        countItems(STORES.CHECKPOINTS),
        countItems(STORES.REWARD_HISTORY),
        countItems(STORES.LLM_TESTS),
    ]);

    return {
        experiences: expCount,
        discoveries: discCount,
        checkpoints: cpCount,
        rewardEvents: rewardCount,
        llmTests: testCount,
        metadata: loadMetadata(),
    };
}
