// action-parser.js - Parse LLM responses
export const VALID_BUTTONS = new Set(['a', 'b', 'start', 'select', 'up', 'down', 'left', 'right']);
export const MAX_PLAN_ACTIONS = 12;

export function isValidButton(button) {
    return VALID_BUTTONS.has(String(button || '').toLowerCase());
}

/** Parse numbered candidate plans while pairing plans/actions by their number. */
export function parseMultiplePlans(response) {
    const plansByNumber = new Map();
    const actionsByNumber = new Map();

    for (const match of response.matchAll(/PLAN(\d+):\s*(.+?)(?=\n|$)/gi)) {
        plansByNumber.set(match[1], match[2].trim());
    }
    for (const match of response.matchAll(/ACTIONS(\d+):\s*(.+?)(?=\n|PLAN|$)/gi)) {
        actionsByNumber.set(match[1], match[2]
            .split(/[,\s]+/)
            .map(action => action.toLowerCase().trim())
            .filter(isValidButton)
            .slice(0, MAX_PLAN_ACTIONS));
    }

    const plans = [];
    for (const [number, plan] of plansByNumber) {
        const actions = actionsByNumber.get(number) || [];
        if (actions.length > 0) plans.push({ plan, actions });
    }

    if (plans.length === 0) {
        const fallback = parseResponse(response);
        if (fallback.actions.length > 0) plans.push(fallback);
    }
    return plans;
}

export function parseResponse(response) {
    console.log('[LLM RAW]', response.substring(0, 300));

    let plan = '';
    let actions = [];

    // Look for PLAN: line
    const planMatch = response.match(/PLAN:\s*(.+?)(?:\n|$)/i);
    if (planMatch) {
        plan = planMatch[1].trim();
    }

    // Look for ACTIONS: line
    const actionsMatch = response.match(/ACTIONS?:\s*(.+?)(?:\n|$)/i);
    if (actionsMatch) {
        const actionStr = actionsMatch[1].toLowerCase();
        const buttons = actionStr.split(/[,\s]+/);
        actions = buttons
            .map(b => b.trim())
            .filter(isValidButton)
            .slice(0, MAX_PLAN_ACTIONS);
    } else {
        // Tiny local models sometimes return only a raw button sequence even
        // when a labelled format was requested. Prefer using it over a blind fallback.
        actions = (response.toLowerCase().match(/\b(?:up|down|left|right|start|select|a|b)\b/g) || [])
            .filter(isValidButton)
            .slice(0, MAX_PLAN_ACTIONS);
    }

    // Fallback if no plan found
    if (!plan && actionsMatch) {
        const actionStart = response.search(/actions?:/i);
        if (actionStart > 0) {
            plan = response.substring(0, actionStart).trim();
        } else {
            plan = response.trim();
        }
    } else if (!plan) {
        plan = actions.length > 0 ? 'Direct action plan' : response.trim();
    }

    // Default actions if none found
    if (actions.length === 0) {
        console.log('[PARSER] No valid actions, defaulting to: right, right, a');
        actions = ['right', 'right', 'a'];
    }

    console.log('[PARSER] Plan:', plan.substring(0, 80));
    console.log('[PARSER] Actions:', actions);

    return { plan, actions };
}
