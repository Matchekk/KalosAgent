// rl-agent.js - RL-enhanced game agent combining LLM with learned policy

import { chat, resetContext } from './llm.js';
import { isValidButton, parseMultiplePlans } from './action-parser.js';
import { RewardCalculator, isPlayableState } from './reward-calculator.js';
import { ExperienceBuffer, ActionStatistics } from './experience-buffer.js';
import { curriculumTracker } from './curriculum.js';
import {
    getDialogAdvanceDecision,
    getDialogPlanBias,
    getMenuRecoveryAction,
} from './dialog-advance.js';

/**
 * System prompt that asks LLM to generate multiple candidate plans
 */
const SYSTEM_PROMPT = `You are playing Pokemon Red. Choose one short action sequence that makes progress.

CONTROLS: up, down, left, right, a, b, start
- Movement: up/down/left/right to walk
- 'a': confirm, talk, interact, advance text
- 'b': cancel, exit menus
- 'start': begin from the title screen or open the pause menu

CRITICAL RULES:
1. If the game is at startup/title: press 'start', then 'a' to begin
2. If showing dialog/text: press 'a' 4-6 times to advance it quickly; consecutive 'a' is allowed here
3. If in a building: navigate to exit (usually down then through door)
4. If outdoors: move toward your next objective location
5. Use no more than 8 buttons; outside dialog, never repeat a button more than 3 times
6. Always include movement when the game is past startup or dialog
7. Menus are allowed when they serve a purpose, such as choosing a stronger move,
   switching to a Pokemon with a type advantage, healing, or occasional saving

COMMON SEQUENCES:
- Exit house: down, down, down, down, a (walk to door, exit)
- Talk to someone: a, a, a, a, a, a (then move away)
- Navigate route: Mix of directions toward destination

OUTPUT EXACTLY TWO LINES, with no extra commentary:
PLAN: <short goal>
ACTIONS: btn1, btn2, btn3, btn4, btn5, btn6, btn7, btn8`;

/**
 * Objectives based on game progress
 */
const OBJECTIVES = {
    START: { description: "Get your first Pokemon from Professor Oak", priority: 1 },
    BOULDER_BADGE: { description: "Defeat Brock for the Boulder Badge", priority: 2 },
    CASCADE_BADGE: { description: "Defeat Misty for the Cascade Badge", priority: 3 },
    THUNDER_BADGE: { description: "Defeat Lt. Surge for the Thunder Badge", priority: 4 },
    POKEMON_LEAGUE: { description: "Defeat the Elite Four", priority: 10 },
};

function getObjective(state) {
    const badges = state.badges?.length || 0;
    if (badges === 0 && state.party?.length === 0) return OBJECTIVES.START;
    if (badges === 0) return OBJECTIVES.BOULDER_BADGE;
    if (badges === 1) return OBJECTIVES.CASCADE_BADGE;
    if (badges === 2) return OBJECTIVES.THUNDER_BADGE;
    return OBJECTIVES.POKEMON_LEAGUE;
}

/**
 * RL-Enhanced Game Agent
 * Combines LLM for plan generation with RL for plan selection
 */
export class RLAgent {
    constructor(emulator, memoryReader, onUpdate) {
        this.emu = emulator;
        this.reader = memoryReader;
        this.onUpdate = onUpdate;

        // Agent state
        this.running = false;
        this.stepCount = 0;
        this.actionQueue = [];
        this.currentPlan = null;
        this.loopGeneration = 0;

        // RL components
        this.rewardCalc = new RewardCalculator({ persistRun: true });
        this.expBuffer = new ExperienceBuffer(10000);
        this.actionStats = new ActionStatistics();

        // State tracking
        this.pendingTransition = null;
        this.transitionObserver = null;
        this.llmCallCount = 0;
        this.dialogAdvanceTracker = { lastDialog: '', unchangedPresses: 0 };

        // Policy parameters (simple weighted selection)
        this.explorationRate = 0.05; // Small exploration among LLM candidate plans
        this.useActionStats = true;  // Use learned action statistics

        // Optional external reward source (e.g., CombinedRewardSystem)
        this.externalRewardSource = null;

        // Trained neural network policy
        this.trainedPolicy = null;
    }

    /**
     * Set an external reward source (e.g., CombinedRewardSystem)
     * @param {Object} source - Object with processStep(state) method
     */
    setExternalRewardSource(source) {
        this.externalRewardSource = source;
    }

    /**
     * Set the trained neural network policy
     * @param {TrainedPolicy} policy - Trained policy instance
     */
    setTrainedPolicy(policy) {
        this.trainedPolicy = policy;
        console.log('Trained policy connected to RL agent');
    }

    setTransitionObserver(observer) {
        this.transitionObserver = observer;
    }

    toPolicyState(state) {
        return {
            location: state.location,
            x: state.coordinates?.x || 0,
            y: state.coordinates?.y || 0,
            badgeCount: state.badges?.length || 0,
            partyCount: state.party?.length || 0,
            avgLevel: state.party?.length > 0
                ? state.party.reduce((sum, pokemon) => sum + pokemon.level, 0) / state.party.length
                : 0,
            hpRatio: state.party?.length > 0
                ? state.party.reduce((sum, pokemon) => sum + (pokemon.currentHP / Math.max(1, pokemon.maxHP)), 0) / state.party.length
                : 1,
            inBattle: state.inBattle || false,
            hasDialog: !!(state.dialog?.trim()),
            money: state.money || 0,
            battle: state.battle || null,
        };
    }

    /**
     * Build user message for LLM
     * Now uses Prima Strategy Guide curriculum for objectives
     */
    buildUserMessage(state) {
        // Check curriculum progress and get next objective
        curriculumTracker.checkProgress(state);
        const nextCheckpoint = curriculumTracker.getNextCheckpoint();
        const stats = curriculumTracker.getStats();

        const lines = [];

        // Current situation and what to do
        lines.push('=== CURRENT SITUATION ===');
        lines.push(`Location: ${state.location}`);
        lines.push(`Position: (${state.coordinates.x}, ${state.coordinates.y})`);

        // Add immediate action hints based on location
        const locUpper = state.location.toUpperCase();
        if (locUpper.includes('HOUSE') && locUpper.includes('2F')) {
            lines.push('ACTION NEEDED: The stairs are at (7,0): move RIGHT, then UP');
        } else if (locUpper.includes('HOUSE') && locUpper.includes('1F')) {
            lines.push('ACTION NEEDED: The front door is at (3,7): move LEFT, then DOWN');
        } else if (locUpper.includes('LAB') || locUpper.includes('OAKS')) {
            lines.push('ACTION NEEDED: Talk to Prof Oak or pick a starter Pokemon');
        } else if (locUpper.includes('ROUTE')) {
            lines.push('ACTION NEEDED: Navigate toward your destination, avoid/battle wild Pokemon');
        } else if (locUpper.includes('CITY') || locUpper.includes('TOWN')) {
            lines.push('ACTION NEEDED: Explore, find Pokemon Center/Mart, or continue to next route');
        }

        if (state.dialog?.trim()) {
            lines.push('');
            lines.push(`[DIALOG SHOWING]: "${state.dialog}"`);
            lines.push('Press A to advance dialog, then MOVE to make progress');
        }

        if (state.inBattle) {
            lines.push('');
            lines.push('[IN BATTLE] - Select moves with A, navigate with directions');
            const battle = state.battle;
            if (battle?.opponent) {
                const opponentTypes = [battle.opponent.type1, battle.opponent.type2].filter(Boolean).join('/');
                const activeTypes = [battle.active?.type1, battle.active?.type2].filter(Boolean).join('/');
                lines.push(`Opponent: ${battle.opponent.species} Lv${battle.opponent.level} ${opponentTypes} HP ${battle.opponent.currentHP}/${battle.opponent.maxHP}`);
                lines.push(`Active: ${battle.active?.species} Lv${battle.active?.level} ${activeTypes} HP ${battle.active?.currentHP}/${battle.active?.maxHP}`);
                if (battle.active?.moves?.length) {
                    lines.push(`Moves: ${battle.active.moves.map(move => move.name).join(', ')}`);
                }
                if (battle.lastMove?.id) {
                    lines.push(`Last move: ${battle.lastMove.name} (${battle.lastMove.type}, ${battle.lastMove.effectiveness}${battle.lastMove.stab ? ', STAB' : ''}, ${battle.lastMove.damage} damage)`);
                }
                lines.push('Prefer super-effective damaging moves; avoid immune or not-very-effective moves. Switching Pokemon is allowed when it creates a real type advantage.');
            }
        }

        lines.push('');
        lines.push('=== OBJECTIVE ===');
        if (nextCheckpoint) {
            lines.push(`${nextCheckpoint.name}: ${nextCheckpoint.description}`);
        } else {
            lines.push('Become Pokemon Champion!');
        }

        lines.push('');
        lines.push(`Progress: ${stats.completionPercent}% | Badges: ${state.badges.length}/8`);

        if (state.party.length > 0) {
            const partyStr = state.party.map(p => `${p.species} Lv${p.level}`).join(', ');
            lines.push(`Party: ${partyStr}`);
        } else {
            lines.push('Party: Empty - need to get first Pokemon!');
        }

        if (this.stepCount < 120 && state.party.length === 0 && state.badges.length === 0) {
            lines.push('STARTUP CHECK: If a warning, intro, or title screen may be visible, use start and a before movement.');
        }

        lines.push('');
        lines.push('Generate one short plan using no more than 8 buttons:');

        return lines.join('\n');
    }

    /**
     * Select best plan using RL policy (neural network + action stats + heuristics)
     * @param {Object[]} plans - Candidate plans from LLM
     * @param {Object} state - Current game state
     * @returns {Object} - Selected plan
     */
    selectPlan(plans, state) {
        if (!isPlayableState(state) && !state.dialog?.trim()) {
            return {
                plan: 'Advance startup screen before navigating',
                actions: ['start', 'a', 'a'],
                selected: 'startup-guard',
            };
        }

        if (plans.length === 0) {
            const startup = this.stepCount < 120 && state.party?.length === 0 && state.badges?.length === 0;
            return {
                plan: startup ? 'Advance startup screen' : 'Fallback interaction',
                actions: startup ? ['start', 'a', 'start', 'a', 'down'] : ['a', 'a', 'a'],
            };
        }

        if (plans.length === 1) {
            const plan = plans[0];
            if (!this.trainedPolicy) return plan;

            const blendedActions = this.trainedPolicy.blendWithPolicy(
                this.toPolicyState(state),
                plan.actions,
            );
            const changed = blendedActions.some((action, index) => action !== plan.actions[index]);
            return {
                ...plan,
                actions: blendedActions,
                selected: changed ? 'llm+neural-policy' : 'llm',
            };
        }

        // Exploration: random selection
        if (Math.random() < this.explorationRate) {
            const idx = Math.floor(Math.random() * plans.length);
            return { ...plans[idx], selected: 'exploration' };
        }

        // Convert state for trained policy
        const policyState = this.toPolicyState(state);

        // Score plans using all available methods
        const location = state.location;
        const scoredPlans = plans.map(p => {
            let score = 0;

            // 1. Neural network policy score (highest weight if available)
            if (this.trainedPolicy) {
                const policyScore = this.trainedPolicy.scorePlan(policyState, p.actions);
                score += policyScore * 3;  // Weight neural network heavily
            }

            // 2. Action statistics score
            if (this.useActionStats) {
                score += this.actionStats.getActionScore(location, p.actions);
            }

            // 3. Heuristic score
            score += this.computeHeuristicScore(p, state);

            return { ...p, score };
        });

        // Softmax selection (higher scores more likely)
        const temperature = 0.5;
        const expScores = scoredPlans.map(p => Math.exp(p.score / temperature));
        const sumExp = expScores.reduce((a, b) => a + b, 0);
        const probs = expScores.map(e => e / sumExp);

        let rand = Math.random();
        for (let i = 0; i < probs.length; i++) {
            rand -= probs[i];
            if (rand <= 0) {
                const selectedBy = this.trainedPolicy?.trainer?.model
                    ? 'neural-policy'
                    : 'action-stats';
                return { ...scoredPlans[i], selected: selectedBy };
            }
        }

        // Default: highest score
        scoredPlans.sort((a, b) => b.score - a.score);
        return { ...scoredPlans[0], selected: 'default' };
    }

    /**
     * Compute heuristic score for a plan
     */
    computeHeuristicScore(plan, state) {
        let score = 0;
        const actions = plan.actions;

        // Prefer movement over button mashing outside dialog.
        const movements = actions.filter(a =>
            ['up', 'down', 'left', 'right'].includes(a)).length;
        score += movements * (state.dialog?.trim() ? 0 : 0.5);

        // Penalize too many repeated actions
        const uniqueActions = new Set(actions).size;
        score += uniqueActions * 0.3;

        // In battle, prefer 'a' for attacking
        if (state.inBattle) {
            const aCount = actions.filter(a => a === 'a').length;
            score += aCount * 0.5;
        }

        // During dialog, strongly prefer enough A presses to clear a full page.
        if (state.dialog?.trim()) {
            score += getDialogPlanBias(actions);
        }

        // Early-game plans must be able to leave ROM warning/title screens.
        if (this.stepCount < 120 && state.party?.length === 0 && state.badges?.length === 0
            && actions.includes('start')) {
            score += 3;
        }

        return score;
    }

    rememberAction(state, action, plan) {
        this.pendingTransition = { state, action, plan };
    }

    async settlePendingTransition(nextState) {
        const pending = this.pendingTransition;
        if (!pending) return null;
        this.pendingTransition = null;

        const { total: reward, breakdown } = this.rewardCalc.computeReward(
            pending.state,
            nextState,
            pending.action,
        );
        const metadata = { plan: pending.plan, breakdown, source: 'agent' };

        this.expBuffer.add(
            pending.state,
            [pending.action],
            reward,
            nextState,
            false,
            metadata,
        );
        this.actionStats.update(pending.state.location, pending.action, reward);
        this.transitionObserver?.({
            prevState: pending.state,
            action: pending.action,
            reward,
            nextState,
            metadata,
        });

        if (Math.abs(reward) >= 10) {
            console.log(`Action ${pending.action}: reward ${reward}`, breakdown);
        }

        return { reward, breakdown };
    }

    /**
     * Execute one step of the agent
     */
    async step() {
        const observedState = this.reader.getGameState();
        this.rewardCalc.syncProgressFlags(observedState);
        await this.settlePendingTransition(observedState);
        const recoveryAction = getMenuRecoveryAction(observedState.dialog);
        if (recoveryAction) {
            this.actionQueue = [];
            this.emu.pressButton(recoveryAction);
            this.stepCount++;
            this.rememberAction(observedState, recoveryAction, 'Close accidental trainer menu');

            this.onUpdate?.({
                action: [recoveryAction],
                executed: true,
                phase: 'acting',
                currentAction: recoveryAction,
                currentPlan: 'Close accidental trainer menu',
                reasoning: 'Trainer card detected — returning to gameplay',
                state: observedState,
                rlStats: this.getStats(),
            });
            return;
        }
        const dialogDecision = getDialogAdvanceDecision(observedState, this.dialogAdvanceTracker);
        this.dialogAdvanceTracker = dialogDecision.tracker;

        if (dialogDecision.shouldAdvance) {
            // Count this as the next queued A when the LLM already planned one,
            // while keeping any movement ready for after the dialog closes.
            if (this.actionQueue[0] === 'a') {
                this.actionQueue.shift();
            }

            this.emu.pressButton('a');
            this.stepCount++;
            this.rememberAction(observedState, 'a', 'Advance dialog automatically');

            if (this.onUpdate) {
                this.onUpdate({
                    action: ['a'],
                    executed: true,
                    phase: 'acting',
                    currentAction: 'a',
                    currentPlan: 'Advance dialog automatically',
                    reasoning: 'Dialog detected — advancing locally without an LLM call',
                    state: this.reader.getGameState(),
                    rlStats: this.getStats(),
                });
            }
            return;
        }

        // Execute queued actions first
        if (this.actionQueue.length > 0) {
            const action = this.actionQueue.shift();
            this.emu.pressButton(action);
            this.stepCount++;
            this.rememberAction(observedState, action, this.currentPlan);

            // Update UI
            if (this.onUpdate) {
                this.onUpdate({
                    action: [action],
                    executed: true,
                    phase: 'acting',
                    currentAction: action,
                    currentPlan: this.currentPlan,
                    reasoning: `Executing: ${this.currentPlan} (${this.actionQueue.length} remaining)`,
                    state: this.reader.getGameState(),
                    rlStats: this.getStats(),
                });
            }
            return;
        }

        const currState = observedState;

        // Get new plans from LLM
        const userMessage = this.buildUserMessage(currState);

        try {
            this.llmCallCount++;

            if (this.onUpdate) {
                this.onUpdate({
                    phase: 'planning',
                    llmCallCount: this.llmCallCount,
                    state: currState,
                    rlStats: this.getStats(),
                });
            }

            // Periodic context reset for memory management
            if (this.llmCallCount % 30 === 0) {
                await resetContext();
            }

            const response = await chat(SYSTEM_PROMPT, [], userMessage, 96);
            const plans = parseMultiplePlans(response);

            // Select plan using RL policy
            const selected = this.selectPlan(plans, currState);

            // Filter out any menu buttons that slipped through
            const filteredActions = selected.actions.filter(a =>
                isValidButton(a)
            );

            // Queue actions
            this.actionQueue = filteredActions.length > 0 ? filteredActions : ['a', 'a', 'a'];
            this.currentPlan = selected.plan;

            // Update UI
            if (this.onUpdate) {
                this.onUpdate({
                    action: this.actionQueue,
                    executed: false,
                    phase: 'acting',
                    currentAction: this.actionQueue[0] || null,
                    currentPlan: selected.plan,
                    llmCallCount: this.llmCallCount,
                    reasoning: `${selected.plan} [${selected.selected || 'selected'}]`,
                    plansGenerated: plans.length,
                    state: currState,
                    rlStats: this.getStats(),
                });
            }
        } catch (err) {
            console.error('LLM error:', err);
            this.actionQueue = ['a', 'a', 'up', 'a', 'a'];

            // Report error through callback
            if (this.onUpdate) {
                this.onUpdate({
                    action: this.actionQueue,
                    executed: false,
                    phase: 'error',
                    currentPlan: 'Fallback after LLM error',
                    llmCallCount: this.llmCallCount,
                    reasoning: `LLM Error: ${err.message || 'Unknown error'} - using fallback`,
                    error: err.message || String(err),
                    state: currState,
                    rlStats: this.getStats(),
                });
            }
        }
    }

    /**
     * Main run loop
     */
    async run() {
        if (this.running) return;
        this.running = true;
        const generation = ++this.loopGeneration;

        while (this.running && generation === this.loopGeneration) {
            await this.step();
            // A Red++ tile movement spans several frames. Reading RAM before
            // it settles assigns the transition reward to the next button and
            // can make waypoints oscillate around a target tile.
            const settlingAction = this.pendingTransition?.action;
            const settleDelay = ['up', 'down', 'left', 'right'].includes(settlingAction)
                ? 320
                : 150;
            await this.sleep(settleDelay);
        }
    }

    /**
     * Stop the agent
     */
    stop() {
        this.running = false;
        this.loopGeneration++;
        this.actionQueue = [];
        this.pendingTransition = null;
        this.dialogAdvanceTracker = { lastDialog: '', unchangedPresses: 0 };
    }

    /**
     * Get RL statistics
     */
    getStats() {
        return {
            reward: this.rewardCalc.getStats(),
            buffer: this.expBuffer.getStats(),
            stepCount: this.stepCount,
            llmCalls: this.llmCallCount,
            explorationRate: this.explorationRate,
        };
    }

    /**
     * Export all data for offline training
     */
    exportData() {
        return {
            experiences: this.expBuffer.export(),
            rewards: this.rewardCalc.exportHistory(),
            actionStats: this.actionStats.export(),
        };
    }

    /**
     * Adjust exploration rate
     */
    setExplorationRate(rate) {
        this.explorationRate = Math.max(0, Math.min(1, rate));
    }

    /**
     * Sleep helper
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
