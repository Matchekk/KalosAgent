const INTERACTIVE_SELECTOR = 'input, textarea, select, button, [contenteditable="true"], [role="textbox"]';

/** Return true when a global shortcut originated in a UI editing/control surface. */
export function isInteractiveKeyboardTarget(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;

    const tagName = String(target.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select', 'button'].includes(tagName)) return true;

    return Boolean(target.closest?.(INTERACTIVE_SELECTOR));
}
