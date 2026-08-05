export const MAX_UNCHANGED_DIALOG_PRESSES = 2;

const INTERACTIVE_SCREEN_PATTERNS = [
    /\bYOUR NAME\b/i,
    /\bRIVAL(?:'S)? NAME\b/i,
    /\bLOWER CASE\b/i,
    /\bUPPER CASE\b/i,
    /\bNEW GAME\b/i,
    /\bCONTINUE\b/i,
    /\bOPTION\b/i,
    /\bYES\s+NO\b/i,
    /\bNO\s+YES\b/i,
];

export function isInteractiveDialogScreen(dialog) {
    const text = String(dialog || '').replace(/\s+/g, ' ').trim();
    return text.length > 0 && INTERACTIVE_SCREEN_PATTERNS.some(pattern => pattern.test(text));
}

export function getDialogPlanBias(actions = []) {
    const aCount = actions.filter(action => action === 'a').length;
    const movementCount = actions.filter(action =>
        ['up', 'down', 'left', 'right'].includes(action)).length;

    return (Math.min(aCount, 6) * 1.25) - (movementCount * 0.5);
}

/**
 * Decide whether a dialog can be advanced without asking the LLM.
 * Changed text can advance immediately; unchanged text gets only a small
 * retry budget so stale screen buffers cannot trap the agent in an A loop.
 */
export function getDialogAdvanceDecision(state, tracker = {}) {
    const dialog = String(state?.dialog || '').replace(/\s+/g, ' ').trim();
    const reset = { lastDialog: '', unchangedPresses: 0 };

    if (!dialog || state?.inBattle || isInteractiveDialogScreen(dialog)) {
        return { shouldAdvance: false, tracker: reset };
    }

    const lastDialog = String(tracker.lastDialog || '');
    const unchangedPresses = Number.isFinite(tracker.unchangedPresses)
        ? Math.max(0, tracker.unchangedPresses)
        : 0;

    if (dialog !== lastDialog) {
        return {
            shouldAdvance: true,
            tracker: { lastDialog: dialog, unchangedPresses: 0 },
        };
    }

    if (unchangedPresses >= MAX_UNCHANGED_DIALOG_PRESSES) {
        return {
            shouldAdvance: false,
            tracker: { lastDialog: dialog, unchangedPresses },
        };
    }

    return {
        shouldAdvance: true,
        tracker: { lastDialog: dialog, unchangedPresses: unchangedPresses + 1 },
    };
}
