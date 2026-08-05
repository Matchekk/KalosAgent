"""Parse LLM responses into game actions."""

import re


VALID_BUTTONS = {"a", "b", "start", "select", "up", "down", "left", "right"}


def parse_response(response: str) -> tuple[str, list[str]]:
    """Parse LLM response into reasoning and actions.

    Args:
        response: Raw LLM output

    Returns:
        Tuple of (reasoning, list of button names)
    """
    print(f"[LLM RAW] {response[:500]}")  # Log first 500 chars

    reasoning = ""
    actions = []

    # Look for PLAN: line
    plan_match = re.search(r'PLAN:\s*(.+?)(?:\n|$)', response, re.IGNORECASE)
    if plan_match:
        reasoning = plan_match.group(1).strip()

    # Look for ACTIONS: line (plural, for batch)
    match = re.search(r'ACTIONS?:\s*(.+?)(?:\n|$)', response, re.IGNORECASE)
    if match:
        action_str = match.group(1)
        # Parse button sequence
        buttons = re.split(r'[,\s]+', action_str.lower())
        actions = [b.strip() for b in buttons if b.strip() in VALID_BUTTONS]

    # If no plan found, use everything before ACTIONS as reasoning
    if not reasoning:
        action_start = re.search(r'actions?:', response, re.IGNORECASE)
        if action_start:
            reasoning = response[:action_start.start()].strip()
        else:
            reasoning = response.strip()

    # Default to exploration if no valid actions found
    if not actions:
        print("[PARSER] No valid actions found, defaulting to: right, right, a")
        actions = ["right", "right", "a"]

    print(f"[PARSER] Plan: {reasoning[:100]}")
    print(f"[PARSER] Actions: {actions}")

    return reasoning, actions
