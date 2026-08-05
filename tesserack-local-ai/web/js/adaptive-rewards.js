// adaptive-rewards.js - LLM-generated tests and visual checkpoint rewards

import { chat } from './llm.js';

/**
 * Prompt for generating game progress tests
 */
const TEST_GENERATION_PROMPT = `You are analyzing a Pokemon Red game state to generate verifiable progress tests.

Given the current game state, generate 3-5 SHORT-TERM tests the player should try to pass.
Tests must be verifiable from game state (location, party, badges, items, money).

OUTPUT FORMAT (JSON array):
[
  {"test": "description", "field": "state.field.path", "condition": ">|<|==|includes", "value": "target", "reward": number},
  ...
]

Example tests:
- {"test": "Exit starting house", "field": "location", "condition": "!=", "value": "PLAYERS HOUSE 2F", "reward": 50}
- {"test": "Have a Pokemon", "field": "partyCount", "condition": ">", "value": 0, "reward": 100}
- {"test": "Reach Viridian City", "field": "location", "condition": "==", "value": "VIRIDIAN CITY", "reward": 200}

Keep tests achievable in the next few minutes of gameplay.
Reward scale: 50 (tiny), 100 (small), 200 (medium), 500 (significant), 1000 (major milestone)`;

/**
 * Parse LLM-generated tests from response
 */
function parseGeneratedTests(response) {
    try {
        // Try to extract JSON array from response
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const tests = JSON.parse(jsonMatch[0]);
            return tests.filter(t => t.test && t.field && t.condition && t.reward);
        }
    } catch (e) {
        console.warn('Failed to parse LLM tests:', e);
    }
    return [];
}

/**
 * Evaluate a single test against game state
 */
function evaluateTest(test, state) {
    try {
        // Get the value from state using field path
        const fieldPath = test.field.replace('state.', '').split('.');
        let value = state;
        for (const key of fieldPath) {
            if (value === undefined) return false;
            value = value[key];
        }

        // Handle array length
        if (test.field.endsWith('Count') || test.field.includes('length')) {
            if (Array.isArray(value)) value = value.length;
        }

        // Evaluate condition
        const target = test.value;
        switch (test.condition) {
            case '==':
            case '===':
                return value === target || value == target;
            case '!=':
            case '!==':
                return value !== target && value != target;
            case '>':
                return Number(value) > Number(target);
            case '>=':
                return Number(value) >= Number(target);
            case '<':
                return Number(value) < Number(target);
            case '<=':
                return Number(value) <= Number(target);
            case 'includes':
                if (Array.isArray(value)) return value.includes(target);
                if (typeof value === 'string') return value.includes(target);
                return false;
            case '!includes':
                if (Array.isArray(value)) return !value.includes(target);
                if (typeof value === 'string') return !value.includes(target);
                return true;
            default:
                return false;
        }
    } catch (e) {
        console.warn('Test evaluation error:', e);
        return false;
    }
}

/**
 * Adaptive Reward System using LLM-generated tests
 */
export class AdaptiveRewards {
    constructor() {
        this.currentTests = [];
        this.passedTests = new Set();  // Track which tests have been passed
        this.testHistory = [];
        this.totalAdaptiveReward = 0;
        this.lastTestGeneration = 0;
        this.testGenerationInterval = 60000;  // Generate new tests every 60s
    }

    /**
     * Generate new tests based on current game state
     */
    async generateTests(state) {
        const stateDescription = `
CURRENT GAME STATE:
- Location: ${state.location}
- Position: (${state.coordinates?.x}, ${state.coordinates?.y})
- Badges: ${state.badges?.length || 0}/8 (${state.badges?.join(', ') || 'None'})
- Party: ${state.party?.length || 0} Pokemon
${state.party?.map(p => `  - ${p.species} Lv.${p.level}`).join('\n') || '  (empty)'}
- Money: $${state.money || 0}
- In Battle: ${state.inBattle ? 'Yes' : 'No'}
- Dialog: "${state.dialog || ''}"

Generate tests for what the player should accomplish next:`;

        try {
            const response = await chat(TEST_GENERATION_PROMPT, [], stateDescription, 512);
            const tests = parseGeneratedTests(response);

            if (tests.length > 0) {
                // Filter out already-passed tests
                this.currentTests = tests.filter(t => !this.passedTests.has(t.test));
                this.lastTestGeneration = Date.now();

                console.log('Generated tests:', this.currentTests);
                return this.currentTests;
            }
        } catch (e) {
            console.error('Test generation failed:', e);
        }

        return this.currentTests;
    }

    /**
     * Evaluate all current tests and compute reward
     */
    evaluateTests(state) {
        let reward = 0;
        const results = [];

        for (const test of this.currentTests) {
            if (this.passedTests.has(test.test)) continue;

            const passed = evaluateTest(test, state);
            results.push({ test: test.test, passed });

            if (passed) {
                reward += test.reward;
                this.passedTests.add(test.test);
                this.testHistory.push({
                    test: test.test,
                    reward: test.reward,
                    timestamp: Date.now(),
                    state: { location: state.location, badges: state.badges?.length }
                });
                console.log(`TEST PASSED: "${test.test}" +${test.reward}`);
            }
        }

        this.totalAdaptiveReward += reward;
        return { reward, results };
    }

    /**
     * Check if we should regenerate tests
     */
    shouldRegenerateTests() {
        // Regenerate if interval passed or all tests completed
        const timePassed = Date.now() - this.lastTestGeneration > this.testGenerationInterval;
        const allPassed = this.currentTests.every(t => this.passedTests.has(t.test));
        return timePassed || (this.currentTests.length > 0 && allPassed);
    }

    /**
     * Get current test status
     */
    getStatus() {
        return {
            currentTests: this.currentTests.map(t => ({
                ...t,
                passed: this.passedTests.has(t.test)
            })),
            totalReward: this.totalAdaptiveReward,
            testsPassed: this.passedTests.size,
            history: this.testHistory.slice(-10)
        };
    }

    /**
     * Reset the reward system
     */
    reset() {
        this.currentTests = [];
        this.passedTests.clear();
        this.testHistory = [];
        this.totalAdaptiveReward = 0;
        this.lastTestGeneration = 0;
    }
}

/**
 * Visual Checkpoint System
 * Captures screenshots and compares against reference images
 */
export class VisualCheckpoints {
    constructor(canvas) {
        this.canvas = canvas;
        this.checkpoints = new Map();  // name -> {image, description, reward, reached}
        this.capturedFrames = [];
        this.maxFrames = 100;
    }

    /**
     * Capture current frame as base64 image
     */
    captureFrame() {
        if (!this.canvas) return null;

        try {
            const imageData = this.canvas.toDataURL('image/png', 0.8);
            return {
                image: imageData,
                timestamp: Date.now(),
                width: this.canvas.width,
                height: this.canvas.height
            };
        } catch (e) {
            console.warn('Frame capture failed:', e);
            return null;
        }
    }

    /**
     * Add a checkpoint from current screen
     * @param {string} name - Checkpoint name
     * @param {string} description - What this checkpoint represents
     * @param {number} reward - Reward for reaching this checkpoint
     */
    addCheckpoint(name, description, reward = 100) {
        const frame = this.captureFrame();
        if (!frame) return false;

        this.checkpoints.set(name, {
            ...frame,
            description,
            reward,
            reached: false,
            addedAt: Date.now()
        });

        console.log(`Checkpoint added: "${name}" - ${description}`);
        return true;
    }

    /**
     * Add a checkpoint from uploaded image
     */
    addCheckpointFromImage(name, imageDataUrl, description, reward = 100) {
        this.checkpoints.set(name, {
            image: imageDataUrl,
            description,
            reward,
            reached: false,
            addedAt: Date.now()
        });
        return true;
    }

    /**
     * Capture frame for later analysis
     */
    recordFrame(gameState) {
        const frame = this.captureFrame();
        if (!frame) return;

        frame.gameState = {
            location: gameState.location,
            badges: gameState.badges?.length,
            party: gameState.party?.length,
            inBattle: gameState.inBattle
        };

        this.capturedFrames.push(frame);

        // Keep only recent frames
        if (this.capturedFrames.length > this.maxFrames) {
            this.capturedFrames.shift();
        }
    }

    /**
     * Compare two images using simple pixel similarity
     * Returns similarity score 0-1
     */
    async compareImages(img1DataUrl, img2DataUrl) {
        return new Promise((resolve) => {
            const img1 = new Image();
            const img2 = new Image();
            let loaded = 0;

            const onLoad = () => {
                loaded++;
                if (loaded < 2) return;

                // Create canvases for comparison
                const c1 = document.createElement('canvas');
                const c2 = document.createElement('canvas');
                const size = 40;  // Downsample for faster comparison
                c1.width = c2.width = size;
                c1.height = c2.height = size;

                const ctx1 = c1.getContext('2d');
                const ctx2 = c2.getContext('2d');

                ctx1.drawImage(img1, 0, 0, size, size);
                ctx2.drawImage(img2, 0, 0, size, size);

                const data1 = ctx1.getImageData(0, 0, size, size).data;
                const data2 = ctx2.getImageData(0, 0, size, size).data;

                // Calculate similarity
                let diff = 0;
                for (let i = 0; i < data1.length; i += 4) {
                    diff += Math.abs(data1[i] - data2[i]);      // R
                    diff += Math.abs(data1[i+1] - data2[i+1]);  // G
                    diff += Math.abs(data1[i+2] - data2[i+2]);  // B
                }

                const maxDiff = size * size * 3 * 255;
                const similarity = 1 - (diff / maxDiff);
                resolve(similarity);
            };

            img1.onload = onLoad;
            img2.onload = onLoad;
            img1.src = img1DataUrl;
            img2.src = img2DataUrl;
        });
    }

    /**
     * Check if current screen matches any checkpoint
     * @param {number} threshold - Similarity threshold (0-1)
     */
    async checkCheckpoints(threshold = 0.85) {
        const currentFrame = this.captureFrame();
        if (!currentFrame) return { matched: null, reward: 0 };

        for (const [name, checkpoint] of this.checkpoints) {
            if (checkpoint.reached) continue;

            const similarity = await this.compareImages(
                currentFrame.image,
                checkpoint.image
            );

            if (similarity >= threshold) {
                checkpoint.reached = true;
                checkpoint.reachedAt = Date.now();
                console.log(`CHECKPOINT REACHED: "${name}" (${(similarity*100).toFixed(1)}% match) +${checkpoint.reward}`);
                return {
                    matched: name,
                    checkpoint,
                    similarity,
                    reward: checkpoint.reward
                };
            }
        }

        return { matched: null, reward: 0 };
    }

    /**
     * Export captured frames for external analysis
     */
    exportFrames() {
        return {
            checkpoints: Array.from(this.checkpoints.entries()).map(([name, cp]) => ({
                name,
                description: cp.description,
                reward: cp.reward,
                reached: cp.reached,
                image: cp.image
            })),
            recentFrames: this.capturedFrames.slice(-20)  // Last 20 frames
        };
    }

    /**
     * Import checkpoints from file
     */
    importCheckpoints(data) {
        if (data.checkpoints) {
            for (const cp of data.checkpoints) {
                this.checkpoints.set(cp.name, {
                    image: cp.image,
                    description: cp.description,
                    reward: cp.reward,
                    reached: false
                });
            }
        }
    }

    /**
     * Get checkpoint status
     */
    getStatus() {
        const checkpointList = Array.from(this.checkpoints.entries()).map(([name, cp]) => ({
            name,
            description: cp.description,
            reward: cp.reward,
            reached: cp.reached
        }));

        return {
            totalCheckpoints: this.checkpoints.size,
            reachedCheckpoints: checkpointList.filter(c => c.reached).length,
            checkpoints: checkpointList,
            capturedFrames: this.capturedFrames.length
        };
    }

    /**
     * Clear all checkpoints
     */
    clear() {
        this.checkpoints.clear();
        this.capturedFrames = [];
    }
}

/**
 * Auto-Discovery System
 * Automatically captures checkpoints when significant events occur
 */
export class AutoCheckpointDiscovery {
    constructor(canvas, memoryReader) {
        this.canvas = canvas;
        this.reader = memoryReader;

        // Track state for detecting changes
        this.lastState = null;
        this.discoveredCheckpoints = [];

        // What triggers auto-capture
        this.triggers = {
            newBadge: true,
            newPokemon: true,
            newLocation: true,
            battleWon: true,
            significantDialog: true,
        };

        // Seen locations for newLocation trigger
        this.seenLocations = new Set();
        this.seenPokemon = new Set();
    }

    /**
     * Capture current frame
     */
    captureFrame() {
        if (!this.canvas) return null;
        try {
            return this.canvas.toDataURL('image/png', 0.8);
        } catch (e) {
            return null;
        }
    }

    /**
     * Check for significant events and auto-capture
     */
    checkForDiscovery(currentState) {
        if (!this.lastState) {
            this.lastState = currentState;
            // Initialize seen sets
            this.seenLocations.add(currentState.location);
            currentState.party?.forEach(p => this.seenPokemon.add(p.speciesId));
            return null;
        }

        const discoveries = [];

        // New badge earned
        if (this.triggers.newBadge) {
            const prevBadges = this.lastState.badges?.length || 0;
            const currBadges = currentState.badges?.length || 0;
            if (currBadges > prevBadges) {
                const newBadge = currentState.badges[currBadges - 1];
                discoveries.push({
                    type: 'badge',
                    name: `${newBadge} Badge`,
                    description: `Earned the ${newBadge} Badge!`,
                    reward: 1000,
                    significance: 'major'
                });
            }
        }

        // New Pokemon caught
        if (this.triggers.newPokemon) {
            const currentPokemon = currentState.party || [];
            for (const p of currentPokemon) {
                if (!this.seenPokemon.has(p.speciesId)) {
                    this.seenPokemon.add(p.speciesId);
                    discoveries.push({
                        type: 'pokemon',
                        name: `Caught ${p.species}`,
                        description: `Caught a new Pokemon: ${p.species}!`,
                        reward: 100,
                        significance: 'medium'
                    });
                }
            }
        }

        // New location discovered
        if (this.triggers.newLocation) {
            if (!this.seenLocations.has(currentState.location)) {
                this.seenLocations.add(currentState.location);
                // Higher reward for significant locations
                const isGym = currentState.location.includes('GYM');
                const isCity = currentState.location.includes('CITY') ||
                               currentState.location.includes('TOWN');
                const reward = isGym ? 300 : isCity ? 200 : 100;

                discoveries.push({
                    type: 'location',
                    name: currentState.location,
                    description: `Discovered ${currentState.location}`,
                    reward,
                    significance: isGym ? 'major' : isCity ? 'medium' : 'minor'
                });
            }
        }

        // Battle won (transitioned out of battle)
        if (this.triggers.battleWon) {
            if (this.lastState.inBattle && !currentState.inBattle) {
                // Check if we didn't white out (still have Pokemon with HP)
                const hasHP = currentState.party?.some(p => p.currentHP > 0);
                if (hasHP) {
                    discoveries.push({
                        type: 'battle',
                        name: `Battle at ${currentState.location}`,
                        description: `Won a battle at ${currentState.location}`,
                        reward: 50,
                        significance: 'minor'
                    });
                }
            }
        }

        // Capture frame for each discovery
        for (const discovery of discoveries) {
            discovery.image = this.captureFrame();
            discovery.timestamp = Date.now();
            discovery.gameState = {
                location: currentState.location,
                badges: currentState.badges?.length,
                party: currentState.party?.map(p => ({ species: p.species, level: p.level }))
            };
            this.discoveredCheckpoints.push(discovery);

            console.log(`AUTO-DISCOVERED: ${discovery.name} (+${discovery.reward})`);
        }

        this.lastState = currentState;

        return discoveries.length > 0 ? discoveries : null;
    }

    /**
     * Get all discovered checkpoints
     */
    getDiscoveries() {
        return this.discoveredCheckpoints;
    }

    /**
     * Export discoveries for reuse
     */
    exportDiscoveries() {
        return {
            checkpoints: this.discoveredCheckpoints,
            seenLocations: Array.from(this.seenLocations),
            seenPokemon: Array.from(this.seenPokemon)
        };
    }

    /**
     * Import previous discoveries
     */
    importDiscoveries(data) {
        if (data.checkpoints) {
            this.discoveredCheckpoints = data.checkpoints;
        }
        if (data.seenLocations) {
            this.seenLocations = new Set(data.seenLocations);
        }
        if (data.seenPokemon) {
            this.seenPokemon = new Set(data.seenPokemon);
        }
    }

    /**
     * Clear discoveries
     */
    clear() {
        this.discoveredCheckpoints = [];
        this.seenLocations.clear();
        this.seenPokemon.clear();
        this.lastState = null;
    }
}

/**
 * Combined Adaptive Reward System
 * Integrates LLM tests + Visual checkpoints + Auto-discovery
 */
export class CombinedRewardSystem {
    constructor(canvas, memoryReader) {
        this.adaptiveRewards = new AdaptiveRewards();
        this.visualCheckpoints = new VisualCheckpoints(canvas);
        this.autoDiscovery = new AutoCheckpointDiscovery(canvas, memoryReader);
        this.totalReward = 0;
        this.rewardLog = [];
    }

    /**
     * Process a game step and compute combined rewards
     */
    async processStep(state, options = {}) {
        let totalReward = 0;
        const breakdown = {};

        // 1. Auto-discovery (always on)
        const discoveries = this.autoDiscovery.checkForDiscovery(state);
        if (discoveries) {
            for (const d of discoveries) {
                totalReward += d.reward;
                breakdown.discovery = (breakdown.discovery || 0) + d.reward;
                breakdown.discoveryType = d.type;
            }
        }

        // 2. Check LLM-generated tests
        if (this.adaptiveRewards.currentTests.length > 0) {
            const testResult = this.adaptiveRewards.evaluateTests(state);
            if (testResult.reward > 0) {
                totalReward += testResult.reward;
                breakdown.tests = testResult.reward;
            }
        }

        // 3. Regenerate tests if needed
        if (this.adaptiveRewards.shouldRegenerateTests() && options.generateTests !== false) {
            await this.adaptiveRewards.generateTests(state);
        }

        // 4. Check visual checkpoints (if enabled and have manual checkpoints)
        if (options.checkVisual !== false && this.visualCheckpoints.checkpoints.size > 0) {
            const visualResult = await this.visualCheckpoints.checkCheckpoints();
            if (visualResult.reward > 0) {
                totalReward += visualResult.reward;
                breakdown.visual = visualResult.reward;
                breakdown.checkpoint = visualResult.matched;
            }
        }

        // 5. Record frame periodically
        if (options.recordFrames && Math.random() < 0.1) {
            this.visualCheckpoints.recordFrame(state);
        }

        // Log significant rewards
        if (totalReward > 0) {
            this.totalReward += totalReward;
            this.rewardLog.push({
                timestamp: Date.now(),
                reward: totalReward,
                breakdown,
                location: state.location
            });
        }

        return { reward: totalReward, breakdown, discoveries };
    }

    /**
     * Get combined status
     */
    getStatus() {
        return {
            totalReward: this.totalReward,
            tests: this.adaptiveRewards.getStatus(),
            checkpoints: this.visualCheckpoints.getStatus(),
            discoveries: {
                count: this.autoDiscovery.discoveredCheckpoints.length,
                locations: this.autoDiscovery.seenLocations.size,
                pokemon: this.autoDiscovery.seenPokemon.size,
                recent: this.autoDiscovery.discoveredCheckpoints.slice(-5)
            },
            recentRewards: this.rewardLog.slice(-10)
        };
    }

    /**
     * Export all data
     */
    exportData() {
        return {
            totalReward: this.totalReward,
            rewardLog: this.rewardLog,
            tests: this.adaptiveRewards.getStatus(),
            checkpoints: this.visualCheckpoints.exportFrames(),
            discoveries: this.autoDiscovery.exportDiscoveries()
        };
    }

    /**
     * Reset everything
     */
    reset() {
        this.adaptiveRewards.reset();
        this.visualCheckpoints.clear();
        this.autoDiscovery.clear();
        this.totalReward = 0;
        this.rewardLog = [];
    }
}
