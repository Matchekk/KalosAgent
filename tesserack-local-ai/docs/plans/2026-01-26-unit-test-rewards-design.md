# Unit Test Rewards for Pokemon Red

**Date:** 2026-01-26
**Status:** Draft
**Inspired by:** [olmOCR 2: Unit test rewards for document OCR](https://allenai.org/blog/olmocr-2)

## Problem

The current reward system struggles with **credit assignment at the action level**. The agent gets stuck doing repetitive actions (like pressing A) because:

1. Rewards are sparse - badges and catches are infrequent
2. No signal tells the agent "that button press was useful"
3. Current heuristics ("prefer movement") are too coarse

## Solution

Apply the olmOCR insight: use **pre-compiled, deterministic unit tests** as reward signals. Instead of approximating rewards through proxy metrics, we:

1. Parse the strategy guide into location-specific micro-objectives
2. Pre-generate deterministic tests for each micro-objective
3. Score action sequences by how many tests they pass (GRPO-style)

## Key Insight

The strategy guide implicitly defines what "progress" means at each location:

```
Location: PLAYERS HOUSE 2F
Guide says: "Go downstairs to leave your house"

Tests:
  - moved_down: y increased → +2
  - reached_stairs: at (6-8, 6-8) → +5
  - exited_floor: location changed to 1F → +25
```

Tests are **pure functions** of `(prev_state, curr_state) → pass/fail`, giving dense, deterministic rewards at the action level.

---

## Architecture

### Test Bundle Structure

Each location gets a test bundle with tiered tests:

```javascript
{
  location: "PLAYERS HOUSE 2F",
  objective: "Exit house to start adventure",

  tests: [
    // Tier 1: Micro-actions (reward: 1-2)
    { id: "moved", type: "coords_changed", reward: 1, tier: 1 },
    { id: "moved_down", type: "coord_delta", axis: "y", direction: "positive", reward: 2, tier: 1 },

    // Tier 2: Sub-objectives (reward: 5-10)
    { id: "reached_stairs", type: "coord_in_region", minX: 6, maxX: 8, minY: 6, maxY: 8, reward: 5, tier: 2, once: true },

    // Tier 3: Objective complete (reward: 20-50)
    { id: "exited_to_1f", type: "location_changed_to", target: "PLAYERS HOUSE 1F", reward: 25, tier: 3, once: true }
  ],

  penalties: [
    { id: "stuck", type: "coords_same", reward: -1 },
    { id: "wrong_direction", type: "coord_delta", axis: "y", direction: "negative", reward: -1 }
  ]
}
```

**Key properties:**
- **Tiered rewards** - small for micro-progress, large for objectives
- **`once` flag** - prevents farming; test only fires once
- **Penalties** - negative tests for clearly bad actions
- **Pure functions** - no side effects, fully deterministic

### Test Types

Tests are data-driven (JSON) with a fixed set of evaluator types:

| Type | Description | Parameters |
|------|-------------|------------|
| `coords_changed` | Player moved | - |
| `coords_same` | Player didn't move | - |
| `coord_delta` | Moved in direction | `axis`, `direction` |
| `coord_in_region` | Player in area | `minX`, `maxX`, `minY`, `maxY` |
| `location_changed_to` | Changed location | `target` |
| `party_size_increased` | Caught/received Pokemon | - |
| `dialog_changed` | Dialog text changed | - |
| `battle_ended_alive` | Won a battle | - |
| `party_level_increased` | Pokemon leveled up | - |
| `party_hp_zero` | Pokemon fainted | - |
| `all_fainted` | Whiteout | - |

### Universal Tests

Applied at every location:

```javascript
{
  "tests": [
    { "id": "dialog_advanced", "type": "dialog_changed", "reward": 1, "tier": 1 },
    { "id": "won_battle", "type": "battle_ended_alive", "reward": 15, "tier": 2 },
    { "id": "caught_pokemon", "type": "party_size_increased", "reward": 50, "tier": 3 },
    { "id": "leveled_up", "type": "party_level_increased", "reward": 10, "tier": 2 }
  ],
  "penalties": [
    { "id": "fainted", "type": "party_hp_zero", "reward": -20 },
    { "id": "whiteout", "type": "all_fainted", "reward": -100 }
  ]
}
```

---

## Plan Simulation

The agent uses **save states** to simulate plans before executing them:

```javascript
async scorePlan(plan, emulator, reader) {
  const checkpoint = emulator.saveState();

  try {
    let prevState = reader.getGameState();
    let totalScore = 0;

    for (const action of plan.actions) {
      emulator.pressButton(action);
      // Run frames for action to take effect
      for (let i = 0; i < 8; i++) emulator.step();

      const currState = reader.getGameState();

      // Evaluate all tests
      for (const test of tests) {
        if (evalTest(test, prevState, currState)) {
          totalScore += test.reward;
        }
      }

      prevState = currState;
    }

    return totalScore;
  } finally {
    emulator.loadState(checkpoint);  // Always restore
  }
}
```

**Flow:**
1. LLM generates 3 candidate plans
2. For each plan: save state → simulate → score → restore
3. Select plan with highest test passes (softmax)
4. Execute selected plan for real

**Performance:** 3 plans × 10 actions × 8 frames = 240 emulator steps per decision. Fast enough for 150ms loop interval.

---

## Build Pipeline

Test bundles are generated at build time from the walkthrough graph:

```bash
npm run build:test-bundles
# Reads: static/data/walkthrough-graph.json
# Writes: static/data/test-bundles.json
```

**Generation logic:**
1. For each location in walkthrough graph:
   - Find connected exits → generate directional movement tests
   - Find objectives → generate completion tests
   - Look up coordinate regions → generate proximity tests
2. Add universal tests
3. Write to JSON

This keeps tests **reproducible and version-controlled**.

---

## File Changes

| File | Type | Description |
|------|------|-------------|
| `static/data/test-bundles.json` | New | Compiled test definitions |
| `src/lib/core/test-scorer.js` | New | Evaluates plans against tests |
| `scripts/build-test-bundles.js` | New | Generates bundles from guide |
| `src/lib/core/rl-agent.js` | Modified | Uses TestScorer in selectPlan() |
| `package.json` | Modified | Add `build:test-bundles` script |

---

## Example: First 3 Locations

### PLAYERS HOUSE 2F

```json
{
  "objective": "Exit house to start adventure",
  "nextLocations": ["PLAYERS HOUSE 1F"],
  "tests": [
    { "id": "moved", "type": "coords_changed", "reward": 1, "tier": 1 },
    { "id": "moved_down", "type": "coord_delta", "axis": "y", "direction": "positive", "reward": 2, "tier": 1 },
    { "id": "reached_stairs", "type": "coord_in_region", "minX": 6, "maxX": 8, "minY": 6, "maxY": 8, "reward": 5, "tier": 2, "once": true },
    { "id": "exited_to_1f", "type": "location_changed_to", "target": "PLAYERS HOUSE 1F", "reward": 25, "tier": 3, "once": true }
  ],
  "penalties": [
    { "id": "stuck", "type": "coords_same", "reward": -1 }
  ]
}
```

### PLAYERS HOUSE 1F

```json
{
  "objective": "Exit house to Pallet Town",
  "nextLocations": ["PALLET TOWN"],
  "tests": [
    { "id": "moved", "type": "coords_changed", "reward": 1, "tier": 1 },
    { "id": "moved_down", "type": "coord_delta", "axis": "y", "direction": "positive", "reward": 2, "tier": 1 },
    { "id": "near_door", "type": "coord_in_region", "minX": 2, "maxX": 5, "minY": 6, "maxY": 8, "reward": 5, "tier": 2, "once": true },
    { "id": "exited_house", "type": "location_changed_to", "target": "PALLET TOWN", "reward": 25, "tier": 3, "once": true }
  ],
  "penalties": [
    { "id": "stuck", "type": "coords_same", "reward": -1 },
    { "id": "went_upstairs", "type": "location_changed_to", "target": "PLAYERS HOUSE 2F", "reward": -5 }
  ]
}
```

### PALLET TOWN

```json
{
  "objective": "Get starter Pokemon from Oak's Lab",
  "nextLocations": ["OAKS LAB", "ROUTE 1"],
  "tests": [
    { "id": "moved", "type": "coords_changed", "reward": 1, "tier": 1 },
    { "id": "approached_lab", "type": "coord_in_region", "minX": 10, "maxX": 14, "minY": 2, "maxY": 6, "reward": 3, "tier": 2, "once": true },
    { "id": "entered_lab", "type": "location_changed_to", "target": "OAKS LAB", "reward": 20, "tier": 3, "once": true },
    { "id": "got_pokemon", "type": "party_size_increased", "reward": 100, "tier": 3, "once": true }
  ],
  "penalties": [
    { "id": "stuck", "type": "coords_same", "reward": -1 },
    { "id": "left_without_pokemon", "type": "location_changed_to", "target": "ROUTE 1", "reward": -10 }
  ]
}
```

---

## Success Criteria

1. **Action-level feedback**: Agent sees immediate reward/penalty for each button press
2. **Deterministic**: Same state + action = same test results
3. **Guide-aligned**: Tests encode strategy guide knowledge
4. **No runtime LLM**: Tests are pre-compiled, not generated on the fly
5. **Observable**: Plan scores visible in UI for debugging

---

## Open Questions

1. **Coordinate data**: Need to map key regions (stairs, doors, NPCs) for each location. Could be manual or extracted from game data.

2. **Test coverage**: How many locations need bundles before this is useful? Start with early game (Pallet → Pewter)?

3. **Interaction with existing rewards**: Replace `RewardCalculator` or run alongside?

4. **Exploration balance**: With dense rewards, might need to tune exploration rate.

---

## Next Steps

1. [ ] Create `test-scorer.js` with evaluator functions
2. [ ] Build initial `test-bundles.json` for early game locations
3. [ ] Integrate into `RLAgent.selectPlan()`
4. [ ] Add UI panel showing test scores for each plan
5. [ ] Test and tune reward values
