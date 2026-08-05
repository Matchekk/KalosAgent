// action-parser.js - Parse LLM responses
const VALID_BUTTONS = new Set(['a', 'b', 'start', 'select', 'up', 'down', 'left', 'right']);

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
            .filter(b => VALID_BUTTONS.has(b));
    }

    // Fallback if no plan found
    if (!plan) {
        const actionStart = response.search(/actions?:/i);
        if (actionStart > 0) {
            plan = response.substring(0, actionStart).trim();
        } else {
            plan = response.trim();
        }
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
