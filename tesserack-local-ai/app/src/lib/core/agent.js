// agent.js - Game agent that coordinates LLM and emulator
import { chat, resetContext } from './llm.js';
import { parseResponse } from './action-parser.js';

// LLM call counter for periodic memory cleanup
let llmCallCount = 0;
const RESET_CONTEXT_EVERY = 30; // Reset LLM context every N calls to free memory

const SYSTEM_PROMPT = `You are an expert AI playing Pokemon Red. Your ultimate goal is to become the Pokemon Champion.

CONTROLS:
- Valid buttons: up, down, left, right, a, b, start, select
- Press 'a' to talk, confirm, advance dialog, or select menu items
- Press 'b' to cancel or go back
- Use directions to move on the map or navigate menus
- In battle: select moves with up/down, confirm with 'a'

IMPORTANT RULES:
- NEVER press 'start' or 'select' - the menu is disabled
- Focus on MOVEMENT (up/down/left/right) and INTERACTION (a/b)
- If dialog is showing, press 'a' repeatedly to advance it
- If stuck in a menu, press 'b' repeatedly to exit
- When stuck, try moving in different directions
- Your actions should be mostly: movement keys + 'a' for interaction

OUTPUT FORMAT (follow exactly):
PLAN: <brief 1-line explanation of your immediate goal>
ACTIONS: button1, button2, button3, button4, button5, button6, button7, button8, button9, button10

Example:
PLAN: Walk right to exit room and talk to NPC
ACTIONS: right, right, right, up, up, a, a, a, a, a`;

// Objective tracking based on game progress
const OBJECTIVES = {
    START: {
        description: "Start your adventure: Get your first Pokemon from Professor Oak",
        hint: "Go downstairs, leave house, try to enter tall grass. Oak will stop you and give you a Pokemon."
    },
    RIVAL_BATTLE_1: {
        description: "Beat your rival in Oak's lab",
        hint: "Use your starter's moves (Tackle/Scratch) to defeat rival's Pokemon."
    },
    OAKS_PARCEL: {
        description: "Deliver Oak's Parcel from Viridian City",
        hint: "Go north to Route 1, then to Viridian City. Visit the Poke Mart to get the parcel."
    },
    BOULDER_BADGE: {
        description: "Defeat Brock and earn the Boulder Badge",
        hint: "Train on Route 22 and Viridian Forest. Brock uses Rock types - use Water or Grass moves."
    },
    CASCADE_BADGE: {
        description: "Defeat Misty and earn the Cascade Badge",
        hint: "Go through Mt. Moon to Cerulean City. Misty uses Water types - use Electric or Grass."
    },
    THUNDER_BADGE: {
        description: "Defeat Lt. Surge and earn the Thunder Badge",
        hint: "Go to Vermilion City via Nugget Bridge and Route 5-6. Surge uses Electric - use Ground types."
    },
    RAINBOW_BADGE: {
        description: "Defeat Erika and earn the Rainbow Badge",
        hint: "In Celadon City. Erika uses Grass types - use Fire, Flying, or Ice moves."
    },
    SOUL_BADGE: {
        description: "Defeat Koga and earn the Soul Badge",
        hint: "In Fuchsia City. Koga uses Poison types - use Ground or Psychic moves."
    },
    MARSH_BADGE: {
        description: "Defeat Sabrina and earn the Marsh Badge",
        hint: "In Saffron City (need Silph Scope first). Sabrina uses Psychic - use Bug or Ghost."
    },
    VOLCANO_BADGE: {
        description: "Defeat Blaine and earn the Volcano Badge",
        hint: "On Cinnabar Island. Blaine uses Fire types - use Water, Ground, or Rock."
    },
    EARTH_BADGE: {
        description: "Defeat Giovanni and earn the Earth Badge",
        hint: "In Viridian City. Giovanni uses Ground types - use Water, Grass, or Ice."
    },
    POKEMON_LEAGUE: {
        description: "Defeat the Elite Four and become Champion",
        hint: "Victory Road to Indigo Plateau. Face Lorelei (Ice), Bruno (Fighting), Agatha (Ghost), Lance (Dragon), then Champion."
    }
};

// Global cooldown tracking for menu buttons
let startCooldown = 0;
const START_COOLDOWN_CALLS = 10; // Only allow start once every 10 LLM calls

// Track recent actions to detect stuck behavior
let recentActions = [];
const STUCK_THRESHOLD = 15; // If same action repeated this many times, we're stuck

/**
 * Filter actions to reduce menu spam and prevent getting stuck
 * @param {string[]} actions - Raw actions from LLM
 * @param {boolean} inBattle - Whether currently in battle
 * @returns {string[]} - Filtered actions
 */
function filterActions(actions, inBattle = false) {
    const filtered = [];
    const movements = ['up', 'down', 'left', 'right'];

    for (const action of actions) {
        const btn = action.toLowerCase();

        // Block start almost entirely (unless in battle where it might be needed)
        if (btn === 'start') {
            if (!inBattle && startCooldown > 0) {
                continue; // Just skip it, don't replace with b
            }
            startCooldown = START_COOLDOWN_CALLS;
        }

        // Block select entirely - almost never needed
        if (btn === 'select') {
            continue;
        }

        filtered.push(btn);
    }

    // Decrement cooldown
    if (startCooldown > 0) startCooldown--;

    // Check for stuck behavior - if we'd be repeating too much, inject random movement
    const wouldBeStuck = filtered.length > 0 &&
        recentActions.length >= STUCK_THRESHOLD &&
        recentActions.slice(-STUCK_THRESHOLD).every(a => a === filtered[0]);

    if (wouldBeStuck) {
        // Force a random movement to break out of stuck state
        const randomMove = movements[Math.floor(Math.random() * movements.length)];
        return [randomMove, randomMove, 'a', randomMove, randomMove];
    }

    return filtered;
}

/**
 * Track an executed action for stuck detection
 */
function trackAction(action) {
    recentActions.push(action.toLowerCase());
    // Keep only last 30 actions
    if (recentActions.length > 30) {
        recentActions.shift();
    }
}

function getObjective(state) {
    const badgeCount = state.badges.length;
    const location = state.location;

    // Check based on badge count
    if (badgeCount === 0) {
        // Early game checks
        if (state.party.length === 0) {
            return OBJECTIVES.START;
        }
        if (location.includes('OAK')) {
            return OBJECTIVES.RIVAL_BATTLE_1;
        }
        // Check if we have Oaks Parcel
        const hasParcel = state.items.some(item => item.name === 'OAKS PARCEL');
        if (hasParcel || location === 'VIRIDIAN CITY' || location === 'ROUTE 1') {
            return OBJECTIVES.OAKS_PARCEL;
        }
        return OBJECTIVES.BOULDER_BADGE;
    }
    if (badgeCount === 1) return OBJECTIVES.CASCADE_BADGE;
    if (badgeCount === 2) return OBJECTIVES.THUNDER_BADGE;
    if (badgeCount === 3) return OBJECTIVES.RAINBOW_BADGE;
    if (badgeCount === 4) return OBJECTIVES.SOUL_BADGE;
    if (badgeCount === 5) return OBJECTIVES.MARSH_BADGE;
    if (badgeCount === 6) return OBJECTIVES.VOLCANO_BADGE;
    if (badgeCount === 7) return OBJECTIVES.EARTH_BADGE;
    return OBJECTIVES.POKEMON_LEAGUE;
}

export class GameAgent {
    constructor(emulator, memoryReader, onUpdate) {
        this.emu = emulator;
        this.reader = memoryReader;
        this.onUpdate = onUpdate;
        this.running = false;
        this.turboMode = false;
        this.manualOverrideUntil = 0;
        this.stepCount = 0;
        this.actionQueue = [];
        // Conversation history for context (reduced to 5 for performance)
        this.history = [];
        this.maxHistoryLength = 5;
        // User hint for guiding the agent
        this.userHint = null;
        // Objective override (persistent until cleared)
        this.objectiveOverride = null;
    }

    /**
     * Set a persistent objective override
     * @param {string} objective - Custom objective to use instead of auto-detected
     */
    setObjectiveOverride(objective) {
        this.objectiveOverride = objective && objective.trim() ? objective.trim() : null;
        // Clear history when objective changes (fresh start)
        if (this.objectiveOverride) {
            this.clearHistory();
        }
    }

    /**
     * Clear the objective override, returning to auto-detection
     */
    clearObjectiveOverride() {
        this.objectiveOverride = null;
    }

    /**
     * Get current objective override
     * @returns {string|null}
     */
    getObjectiveOverride() {
        return this.objectiveOverride;
    }

    /**
     * Add an exchange to conversation history
     * @param {string} userMessage - The game state message sent
     * @param {string} assistantResponse - The LLM's response
     */
    addToHistory(userMessage, assistantResponse) {
        this.history.push(
            { role: 'user', content: userMessage },
            { role: 'assistant', content: assistantResponse }
        );
        // Keep only last N exchanges (2 messages per exchange)
        while (this.history.length > this.maxHistoryLength * 2) {
            this.history.shift();
            this.history.shift();
        }
    }

    /**
     * Set a hint from the user to guide the agent
     * @param {string} hint - User's guidance message
     */
    setUserHint(hint) {
        this.userHint = hint && hint.trim() ? hint.trim() : null;
        this.hintUsageCount = 0;
        // Clear history when user gives new direction (fresh start)
        if (this.userHint) {
            this.clearHistory();
        }
    }

    /**
     * Clear the current user hint
     */
    clearUserHint() {
        this.userHint = null;
        this.hintUsageCount = 0;
    }

    /**
     * Get current user hint
     * @returns {string|null}
     */
    getUserHint() {
        return this.userHint;
    }

    /**
     * Build the user message with current game state
     * @param {Object} state - Game state from memory reader
     * @returns {string}
     */
    buildUserMessage(state) {
        const autoObjective = getObjective(state);
        const lines = [];

        // User hint takes priority if present
        if (this.userHint) {
            lines.push(`USER INSTRUCTION: ${this.userHint}`);
            lines.push('(Follow this instruction from the player!)');
            lines.push('');
        }

        // Use override objective if set, otherwise auto-detected
        if (this.objectiveOverride) {
            lines.push(`CURRENT OBJECTIVE: ${this.objectiveOverride}`);
            lines.push('(Custom objective set by player)');
        } else {
            lines.push(`CURRENT OBJECTIVE: ${autoObjective.description}`);
            lines.push(`HINT: ${autoObjective.hint}`);
        }
        lines.push('');

        // Game state
        lines.push('GAME STATE:');
        lines.push(`Location: ${state.location}`);
        lines.push(`Coordinates: (${state.coordinates.x}, ${state.coordinates.y})`);
        lines.push(`Money: $${state.money}`);
        lines.push(`Badges: ${state.badges.length > 0 ? state.badges.join(', ') : 'None'} (${state.badges.length}/8)`);

        // Party info
        lines.push('');
        lines.push('PARTY:');
        if (state.party.length > 0) {
            for (const p of state.party) {
                const status = p.status !== 'OK' ? ` [${p.status}]` : '';
                lines.push(`  ${p.species} Lv.${p.level} HP:${p.currentHP}/${p.maxHP}${status}`);
                if (p.moves.length > 0) {
                    lines.push(`    Moves: ${p.moves.join(', ')}`);
                }
            }
        } else {
            lines.push('  (No Pokemon yet)');
        }

        // Battle state
        if (state.inBattle) {
            lines.push('');
            lines.push('[IN BATTLE]');
        }

        // Dialog text if present
        if (state.dialog && state.dialog.trim().length > 0) {
            lines.push('');
            lines.push(`DIALOG: "${state.dialog}"`);
        }

        lines.push('');
        lines.push('What are your next 10 actions?');

        return lines.join('\n');
    }

    async step() {
        // If we have queued actions, execute one
        if (this.actionQueue.length > 0) {
            const action = this.actionQueue.shift();
            this.emu.pressButton(action);
            trackAction(action); // Track for stuck detection
            this.stepCount++;

            // Autosave every 50 steps
            if (this.stepCount % 50 === 0) {
                import('./storage.js').then(({ saveState }) => {
                    saveState(this.emu);
                    console.log('Autosaved at step', this.stepCount);
                });
            }

            if (this.onUpdate) {
                this.onUpdate({
                    action: [action],
                    reasoning: `Executing queued action (${this.actionQueue.length} remaining)`,
                    state: this.reader.getGameState()
                });
            }
            return;
        }

        // Get new actions from LLM
        const state = this.reader.getGameState();
        const userMessage = this.buildUserMessage(state);
        const objective = getObjective(state);

        try {
            // Periodic memory cleanup
            llmCallCount++;
            if (llmCallCount % RESET_CONTEXT_EVERY === 0) {
                await resetContext();
                this.clearHistory(); // Also clear our history
            }

            // Use chat() with system prompt, history, and current state
            const response = await chat(SYSTEM_PROMPT, this.history, userMessage, 256);
            const { plan, actions } = parseResponse(response);

            // Add to conversation history
            this.addToHistory(userMessage, response);

            // Track hint usage - auto-clear after 5 LLM calls
            if (this.userHint) {
                this.hintUsageCount = (this.hintUsageCount || 0) + 1;
                if (this.hintUsageCount >= 5) {
                    this.userHint = null;
                    this.hintUsageCount = 0;
                }
            }

            // Filter out excessive menu actions and queue
            this.actionQueue = filterActions(actions, state.inBattle);

            if (this.onUpdate) {
                // Use override objective if set
                const displayObjective = this.objectiveOverride || objective.description;
                const displayHint = this.objectiveOverride ? null : objective.hint;

                this.onUpdate({
                    action: actions,
                    reasoning: plan,
                    objective: displayObjective,
                    objectiveHint: displayHint,
                    objectiveOverrideActive: !!this.objectiveOverride,
                    userHint: this.userHint,
                    hintRemaining: this.userHint ? (5 - this.hintUsageCount) : 0,
                    state,
                    gameState: {
                        location: state.location,
                        coordinates: state.coordinates,
                        party: state.party,
                        badges: state.badges,
                        inBattle: state.inBattle,
                        dialog: state.dialog
                    }
                });
            }
        } catch (err) {
            console.error('LLM error:', err);
            // Default actions on error
            this.actionQueue = ['a', 'a', 'a'];
        }
    }

    async runLLM() {
        this.running = true;
        this.turboMode = false;

        while (this.running) {
            // Check manual override
            if (Date.now() < this.manualOverrideUntil) {
                await this.sleep(100);
                continue;
            }

            await this.step();
            // Increased delay between actions for better performance
            await this.sleep(150);
        }
    }

    runTurbo() {
        this.running = true;
        this.turboMode = true;

        const loop = () => {
            if (!this.running || !this.turboMode) return;

            this.emu.pressButton('a');
            this.stepCount++;

            // Autosave every 50 steps
            if (this.stepCount % 50 === 0) {
                import('./storage.js').then(({ saveState }) => {
                    saveState(this.emu);
                    console.log('Autosaved at step', this.stepCount);
                });
            }

            if (this.stepCount % 10 === 0 && this.onUpdate) {
                this.onUpdate({
                    action: ['Turbo: a'],
                    reasoning: `Turbo mode - step ${this.stepCount}`,
                    state: this.reader.getGameState()
                });
            }

            setTimeout(loop, 50);
        };

        loop();
    }

    stop() {
        this.running = false;
        this.turboMode = false;
        this.actionQueue = [];
    }

    /**
     * Clear conversation history (useful when game context changes significantly)
     */
    clearHistory() {
        this.history = [];
    }

    /**
     * Get current objective based on game state
     * @returns {Object} - {description, hint}
     */
    getCurrentObjective() {
        const state = this.reader.getGameState();
        return getObjective(state);
    }

    manualButton(button) {
        this.manualOverrideUntil = Date.now() + 3000;
        this.emu.pressButton(button);

        if (this.onUpdate) {
            this.onUpdate({
                action: [`Manual: ${button}`],
                reasoning: 'Manual control - LLM paused for 3s',
                state: this.reader.getGameState()
            });
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
