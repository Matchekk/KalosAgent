// rl-agent.js - RL-enhanced game agent combining LLM with learned policy

import { chat, resetContext } from './llm.js';
import { parseResponse } from './action-parser.js';
import { RewardCalculator } from './reward-calculator.js';
import { ExperienceBuffer, ActionStatistics } from './experience-buffer.js';

/**
 * System prompt that asks LLM to generate multiple candidate plans
 */
const SYSTEM_PROMPT = `You are an expert AI playing Pokemon Red. Your ultimate goal is to become the Pokemon Champion.

CONTROLS:
- Valid buttons: up, down, left, right, a, b
- Press 'a' to talk, confirm, advance dialog
- Press 'b' to cancel or go back
- NEVER use 'start' or 'select'

Generate 3 DIFFERENT action plans for the current situation. Each plan should have a different strategy.

OUTPUT FORMAT (follow exactly):
PLAN1: <strategy description>
ACTIONS1: btn1, btn2, btn3, btn4, btn5, btn6, btn7, btn8, btn9, btn10

PLAN2: <different strategy>
ACTIONS2: btn1, btn2, btn3, btn4, btn5, btn6, btn7, btn8, btn9, btn10

PLAN3: <another strategy>
ACTIONS3: btn1, btn2, btn3, btn4, btn5, btn6, btn7, btn8, btn9, btn10`;

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
 * Parse multiple plans from LLM response
 */
function parseMultiplePlans(response) {
    const plans = [];
    const planRegex = /PLAN(\d):\s*(.+?)(?=\n|$)/gi;
    const actionRegex = /ACTIONS(\d):\s*(.+?)(?=\n|PLAN|$)/gi;

    const planMatches = [...response.matchAll(planRegex)];
    const actionMatches = [...response.matchAll(actionRegex)];

    for (let i = 0; i < Math.min(planMatches.length, actionMatches.length); i++) {
        const planText = planMatches[i]?.[2]?.trim() || '';
        const actionsText = actionMatches[i]?.[2]?.trim() || '';

        const actions = actionsText
            .split(/[,\s]+/)
            .map(a => a.toLowerCase().trim())
            .filter(a => ['up', 'down', 'left', 'right', 'a', 'b'].includes(a));

        if (actions.length > 0) {
            plans.push({ plan: planText, actions });
        }
    }

    // Fallback to single plan parsing if multi-plan failed
    if (plans.length === 0) {
        const { plan, actions } = parseResponse(response);
        if (actions.length > 0) {
            plans.push({ plan, actions });
        }
    }

    return plans;
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

        // RL components
        this.rewardCalc = new RewardCalculator();
        this.expBuffer = new ExperienceBuffer(10000);
        this.actionStats = new ActionStatistics();

        // State tracking
        this.prevState = null;
        this.prevActions = null;
        this.llmCallCount = 0;

        // Policy parameters (simple weighted selection)
        this.explorationRate = 0.2;  // 20% random exploration
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

    /**
     * Build user message for LLM
     */
    buildUserMessage(state) {
        const objective = getObjective(state);
        const lines = [];

        lines.push(`OBJECTIVE: ${objective.description}`);
        lines.push('');
        lines.push('GAME STATE:');
        lines.push(`Location: ${state.location}`);
        lines.push(`Position: (${state.coordinates.x}, ${state.coordinates.y})`);
        lines.push(`Badges: ${state.badges.length}/8`);

        if (state.party.length > 0) {
            lines.push('');
            lines.push('PARTY:');
            for (const p of state.party) {
                lines.push(`  ${p.species} Lv.${p.level} HP:${p.currentHP}/${p.maxHP}`);
            }
        }

        if (state.inBattle) {
            lines.push('');
            lines.push('[IN BATTLE]');
        }

        if (state.dialog?.trim()) {
            lines.push('');
            lines.push(`DIALOG: "${state.dialog}"`);
        }

        lines.push('');
        lines.push('Generate 3 different action plans:');

        return lines.join('\n');
    }

    /**
     * Select best plan using RL policy (neural network + action stats + heuristics)
     * @param {Object[]} plans - Candidate plans from LLM
     * @param {Object} state - Current game state
     * @returns {Object} - Selected plan
     */
    selectPlan(plans, state) {
        if (plans.length === 0) {
            return { plan: 'fallback', actions: ['a', 'a', 'a'] };
        }

        if (plans.length === 1) {
            return plans[0];
        }

        // Exploration: random selection
        if (Math.random() < this.explorationRate) {
            const idx = Math.floor(Math.random() * plans.length);
            return { ...plans[idx], selected: 'exploration' };
        }

        // Convert state for trained policy
        const policyState = {
            x: state.coordinates?.x || 0,
            y: state.coordinates?.y || 0,
            mapId: state.mapId || 0,
            badgeCount: state.badges?.length || 0,
            partyCount: state.party?.length || 0,
            avgLevel: state.party?.length > 0
                ? state.party.reduce((sum, p) => sum + p.level, 0) / state.party.length
                : 0,
            hpRatio: state.party?.length > 0
                ? state.party.reduce((sum, p) => sum + (p.currentHP / p.maxHP), 0) / state.party.length
                : 1,
            inBattle: state.inBattle || false,
            hasDialog: !!(state.dialog?.trim()),
            money: state.money || 0
        };

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

        // Prefer movement over button mashing
        const movements = actions.filter(a =>
            ['up', 'down', 'left', 'right'].includes(a)).length;
        score += movements * 0.5;

        // Penalize too many repeated actions
        const uniqueActions = new Set(actions).size;
        score += uniqueActions * 0.3;

        // In battle, prefer 'a' for attacking
        if (state.inBattle) {
            const aCount = actions.filter(a => a === 'a').length;
            score += aCount * 0.5;
        }

        // If dialog showing, prefer 'a' to advance
        if (state.dialog?.trim()) {
            const aCount = actions.filter(a => a === 'a').length;
            score += aCount * 0.3;
        }

        return score;
    }

    /**
     * Execute one step of the agent
     */
    async step() {
        // Execute queued actions first
        if (this.actionQueue.length > 0) {
            const action = this.actionQueue.shift();
            this.emu.pressButton(action);
            this.stepCount++;

            // Update UI
            if (this.onUpdate) {
                this.onUpdate({
                    action: [action],
                    reasoning: `Executing: ${this.currentPlan} (${this.actionQueue.length} remaining)`,
                    state: this.reader.getGameState(),
                    rlStats: this.getStats(),
                });
            }
            return;
        }

        // Get current state and compute reward for previous actions
        const currState = this.reader.getGameState();

        if (this.prevState && this.prevActions) {
            // Compute base reward from reward calculator
            const { total: baseReward, breakdown } = this.rewardCalc.computeReward(
                this.prevState, currState, this.prevActions[0]
            );

            // Add external reward (from combined reward system if available)
            let externalReward = 0;
            let externalBreakdown = null;
            if (this.externalRewardSource) {
                try {
                    const extResult = await this.externalRewardSource.processStep(currState, {
                        generateTests: this.llmCallCount % 10 === 0,  // Generate tests every 10 steps
                        checkVisual: true,
                    });
                    externalReward = extResult.reward || 0;
                    externalBreakdown = extResult.breakdown;
                } catch (e) {
                    console.warn('External reward error:', e);
                }
            }

            const totalReward = baseReward + externalReward;

            // Store experience
            this.expBuffer.add(
                this.prevState,
                this.prevActions,
                totalReward,
                currState,
                false,
                { plan: this.currentPlan, externalReward }
            );

            // Update action statistics
            this.actionStats.update(
                this.prevState.location,
                this.prevActions,
                totalReward
            );

            // Log significant rewards
            if (Math.abs(totalReward) >= 10) {
                console.log(`Reward: ${totalReward} (base: ${baseReward}, external: ${externalReward})`, breakdown, externalBreakdown);
            }
        }

        // Get new plans from LLM
        const userMessage = this.buildUserMessage(currState);

        try {
            this.llmCallCount++;

            // Periodic context reset for memory management
            if (this.llmCallCount % 30 === 0) {
                await resetContext();
            }

            const response = await chat(SYSTEM_PROMPT, [], userMessage, 512);
            const plans = parseMultiplePlans(response);

            // Select plan using RL policy
            const selected = this.selectPlan(plans, currState);

            // Filter out any menu buttons that slipped through
            const filteredActions = selected.actions.filter(a =>
                ['up', 'down', 'left', 'right', 'a', 'b'].includes(a.toLowerCase())
            );

            // Queue actions
            this.actionQueue = filteredActions.length > 0 ? filteredActions : ['a', 'a', 'a'];
            this.currentPlan = selected.plan;
            this.prevState = currState;
            this.prevActions = [...this.actionQueue];

            // Update UI
            if (this.onUpdate) {
                this.onUpdate({
                    action: this.actionQueue,
                    reasoning: `${selected.plan} [${selected.selected || 'selected'}]`,
                    plansGenerated: plans.length,
                    state: currState,
                    rlStats: this.getStats(),
                });
            }
        } catch (err) {
            console.error('LLM error:', err);
            this.actionQueue = ['a', 'a', 'up', 'a', 'a'];
        }
    }

    /**
     * Main run loop
     */
    async run() {
        this.running = true;

        while (this.running) {
            await this.step();
            await this.sleep(150);
        }
    }

    /**
     * Stop the agent
     */
    stop() {
        this.running = false;
        this.actionQueue = [];
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
