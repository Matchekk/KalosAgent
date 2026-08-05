# Tesserack RL Architecture

## Overview

Hybrid LLM + RL system where:
- **LLM (Qwen 1.5B)**: Generates candidate actions and reasoning
- **RL Policy**: Learns to select/weight actions based on verifiable rewards
- **Reward System**: Tracks game progress with objective metrics

## Verifiable Rewards

Pokemon Red has perfect verifiable rewards - no human labeling needed.

| Event | Reward | Rationale |
|-------|--------|-----------|
| Badge earned | +1000 | Major milestone |
| Pokemon caught | +100 | Progress indicator |
| Pokemon evolved | +150 | Training progress |
| Level up (any Pokemon) | +50 | Grinding progress |
| New map discovered | +200 | Exploration |
| Money gained | +1 per $100 | Resource acquisition |
| Item obtained | +20 | Inventory growth |
| HP healed | +0.1 per HP | Recovery |
| Pokemon fainted (own) | -100 | Setback |
| Whiteout (all fainted) | -500 | Major setback |
| Stuck (no state change 60s) | -50 | Penalize loops |
| Menu opened unnecessarily | -10 | Discourage menu spam |

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                        GAME STATE                              │
│  badges, party, money, location, items, dialog, inBattle       │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│                     REWARD CALCULATOR                          │
│  Compare prev_state vs curr_state → compute reward             │
└────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────┐        ┌──────────────────────────────┐
│    EXPERIENCE        │        │         LLM (Qwen)           │
│    BUFFER            │        │  Generate 3-5 action plans   │
│  (s, a, r, s', done) │        │  Each plan = 10 buttons      │
└──────────────────────┘        └──────────────────────────────┘
              │                               │
              │                               ▼
              │                 ┌──────────────────────────────┐
              │                 │      RL POLICY NETWORK       │
              │                 │  Input: state + plan embeds  │
              │                 │  Output: plan selection      │
              └────────────────►│  (or action-value scores)    │
                                └──────────────────────────────┘
                                              │
                                              ▼
                                ┌──────────────────────────────┐
                                │       EXECUTE ACTIONS        │
                                │    Selected plan → buttons   │
                                └──────────────────────────────┘
```

## Implementation Phases

### Phase 1: Reward Tracking (No Training)
- Implement RewardCalculator class
- Track all game state changes
- Log rewards for analysis
- Display cumulative reward in UI

### Phase 2: Experience Collection
- Store (state, action, reward, next_state) tuples
- Export experiences for offline analysis
- Identify reward distribution

### Phase 3: Simple Policy (Contextual Bandit)
- LLM generates N candidate action plans
- Simple scorer ranks plans based on:
  - Past success of similar actions in similar states
  - Heuristics (avoid menus, prefer movement)
- No neural network yet - just statistics

### Phase 4: Neural Policy (Optional)
- Small MLP or transformer policy
- Train with PPO or DQN
- Could use TensorFlow.js for in-browser training
- Or train offline and load weights

## State Representation

For RL, we need a compact state representation:

```javascript
function encodeState(gameState) {
    return {
        // Location (one-hot or embedding)
        mapId: gameState.mapId,
        x: gameState.coordinates.x / 20,  // Normalize
        y: gameState.coordinates.y / 20,

        // Progress
        badgeCount: gameState.badges.length / 8,
        partyCount: gameState.party.length / 6,
        avgLevel: avgPartyLevel / 100,
        totalHP: currentHP / maxHP,

        // Context
        inBattle: gameState.inBattle ? 1 : 0,
        hasDialog: gameState.dialog.length > 0 ? 1 : 0,
        money: Math.log(gameState.money + 1) / 10,

        // Recent history
        lastActions: [...],  // Last 10 actions encoded
        stuckCounter: stuckCount / 100,
    };
}
```

## Files to Create

1. `reward-calculator.js` - Computes rewards from state transitions
2. `experience-buffer.js` - Stores and samples experiences
3. `rl-policy.js` - Policy network or heuristic selector
4. `rl-agent.js` - Coordinates LLM + RL hybrid agent

## Training Loop (Conceptual)

```
for each step:
    state = get_game_state()

    # LLM generates candidates
    candidates = llm.generate_plans(state, n=3)

    # RL policy selects
    action_plan = policy.select(state, candidates)

    # Execute
    for action in action_plan:
        emulator.press(action)
        wait(100ms)

    # Compute reward
    next_state = get_game_state()
    reward = reward_calculator.compute(state, next_state)

    # Store experience
    buffer.add(state, action_plan, reward, next_state)

    # Periodic training (if neural policy)
    if step % 100 == 0:
        policy.train(buffer.sample(batch_size=32))
```

## Offline Training Option

For more serious training:
1. Collect experiences in browser → export as JSON
2. Train policy offline with PyTorch/TensorFlow
3. Convert to TensorFlow.js or ONNX
4. Load trained weights in browser

This allows GPU training on larger batches without browser limitations.
