# Tesserack Lab FAQ

Technical details about the machine learning implementation.

## Architecture

### Q: What's the overall architecture?

Two-tier hierarchical system:

- **LLM (Planner)**: Handles high-level strategic decisions. Given game state, outputs tasks like `navigate | Oak's Lab` or `train | level 14`.
- **Policy Network (Executor)**: Handles low-level tactical execution. Given state + task, outputs button presses (up/down/left/right/a/b/start/select).

This separation allows the LLM to reason about *what* to do while the policy network learns *how* to do it efficiently.

### Q: How does this differ from the browser UI agent?

| Aspect | Lab Agent (Python) | UI Agent (Browser) |
|--------|-------------------|-------------------|
| **Runs in** | Python process (headless) | Browser (JavaScript) |
| **Emulator** | PyBoy | Emulator-JS (WASM) |
| **Architecture** | LLM generates tasks, policy picks buttons | LLM generates button sequences directly |
| **Learning** | Policy gradient on MLP | Action statistics + optional neural policy |
| **Plan selection** | Single task from LLM | LLM generates 3 plans, RL scores them |
| **Designed for** | Batch experiments, fast iteration | Interactive visualization |

**Key difference**: The Lab agent has a cleaner separation of concerns (LLM for strategy, policy for tactics). The UI agent has the LLM do everything, with RL only selecting between LLM-generated plans.

---

## LLM Integration

### Q: What LLM backends are supported?

Three backends in `llm.py`:

1. **Ollama** (default): Local LLMs via Ollama server
   - Default model: `llama3.2:3b`
   - Endpoint: `http://localhost:11434`

2. **OpenAI-compatible**: Any OpenAI API-compatible service
   - Works with OpenAI, Groq, Together, etc.
   - Requires API key

3. **llama.cpp**: Direct llama-server integration
   - Can auto-start server with bundled Threadfork binary
   - Good for specific GGUF models

### Q: What does the LLM prompt look like?

The prompt includes:
- System instructions with available task types
- Current objective (from checkpoint system)
- Game state: location, party, badges, money, battle status
- Recent task history with success/failure
- Strategy hints for early game

Example LLM output: `TASK: navigate | Oak's Lab | Need to get starter Pokemon`

### Q: What task types can the LLM issue?

| Task Type | Example | Description |
|-----------|---------|-------------|
| `navigate` | `navigate \| Oak's Lab` | Go to a location |
| `catch` | `catch \| Pikachu` | Catch a Pokemon |
| `train` | `train \| level 14` | Train party to level |
| `battle` | `battle \| Brock` | Fight trainer/gym |
| `buy` | `buy \| 5 Potions` | Purchase items |
| `use_item` | `use_item \| Potion on Pikachu` | Use an item |
| `talk` | `talk \| Professor Oak` | Talk to NPC |

---

## Policy Network

### Q: What's the policy network architecture?

Simple 2-layer MLP implemented in pure NumPy:

```
Input (96 dims) → Hidden (128, ReLU) → Output (9 actions, softmax)
```

- **State encoding** (64 dims): Normalized map/position, party info (6 slots × 4 features), badges, money, battle state
- **Task encoding** (32 dims): One-hot task type + hashed target
- **Output**: Probability distribution over 9 actions

### Q: What's the exploration strategy?

Epsilon-greedy with decay:
- Starts at ε=0.3 (30% random)
- Decays by 0.995 per step
- Minimum ε=0.05 (5% random)

During exploration, 70% bias toward movement actions (up/down/left/right) since random button mashing wastes time.

### Q: How is the policy trained?

Simple policy gradient (REINFORCE):

1. Store experiences in 10k buffer: (state, task, action, reward, next_state)
2. Every 100 steps, sample batch of 32
3. Update weights: `θ += α * advantage * ∇log(π(a|s))`

No value function baseline (keeping it simple for MVP).

---

## Reward Shaping

### Q: What's the reward structure?

Three layers of rewards:

| Layer | Source | Examples | Magnitude |
|-------|--------|----------|-----------|
| **Sparse milestones** | Game events | Badge earned, Pokemon caught | Large (+100 to +1000) |
| **Dense shaping** | State transitions | Level up, new map, battle won | Medium (+30 to +200) |
| **Step penalty** | Every step | Encourages efficiency | Small (-0.01) |

### Q: What specific rewards exist?

**Positive rewards:**
- Badge earned: +10.0
- Level up: +1.0
- Battle won (trainer): +0.5
- Damage dealt: +0.1 per HP

**Negative rewards:**
- Step taken: -0.01 (encourages efficiency)

### Q: How does task-based reward work?

Different task types have different reward logic:

- **Navigate**: Could add distance-based shaping (not yet implemented)
- **Train**: +1.0 per level gained
- **Battle**: +0.5 for winning, +0.1 per damage dealt

---

## Checkpoints & Progress

### Q: What are checkpoints?

Game milestones used for:
1. **Objective generation**: LLM gets current checkpoint as its goal
2. **Progress tracking**: Know how far the agent has gotten
3. **Save states**: Emulator state saved at each checkpoint

### Q: What checkpoints are defined?

Early game checkpoints (MVP target is through #13):

| ID | Checkpoint | Badge Required |
|----|------------|----------------|
| 1 | Get starter Pokemon | 0 |
| 2 | Reach Viridian City | 0 |
| 3 | Deliver Oak's Parcel | 0 |
| 4 | Get Pokedex | 0 |
| 5 | Reach Viridian Forest | 0 |
| 6 | Reach Pewter City | 0 |
| 7 | Defeat Brock (Boulder Badge) | 1 |
| 8 | Reach Mt. Moon | 1 |
| 9 | Complete Mt. Moon | 1 |
| 10 | Reach Cerulean City | 1 |
| 11 | Defeat Rival on Nugget Bridge | 1 |
| 12 | Get HM01 Cut | 1 |
| 13 | Defeat Misty (Cascade Badge) | 2 |

---

## WebSocket Visualization

### Q: How does the browser UI connect?

The Lab can run a WebSocket server (`--server` flag) that streams:
- Game frames (PNG, ~10fps)
- Game state (JSON)
- LLM requests/responses
- Task updates
- Metrics

Browser connects to `ws://localhost:8765` and displays in real-time.

### Q: What messages are sent?

| Message Type | Direction | Content |
|--------------|-----------|---------|
| `frame` | Server→Client | Base64-encoded PNG |
| `state` | Server→Client | Game state dict |
| `llm_request` | Server→Client | Prompt preview + objective |
| `llm_response` | Server→Client | Response + parsed task |
| `task_update` | Server→Client | Task status, steps, budget |
| `metrics` | Server→Client | Total steps, epsilon, checkpoint |
| `command` | Client→Server | Pause, resume, set_speed, step |

---

## Configuration

### Q: What can be configured?

Everything. See `configs/default.json`:

```json
{
  "emulator": {
    "rom_path": "pokemon_red.gb",
    "headless": true,
    "speed": 0,              // 0 = uncapped
    "save_state_path": null  // Start from save state
  },
  "llm": {
    "backend": "ollama",
    "model": "llama3.2:3b",
    "temperature": 0.7,
    "max_tokens": 256
  },
  "policy": {
    "epsilon_start": 0.3,
    "epsilon_end": 0.05,
    "epsilon_decay": 0.995,
    "train_every": 100,
    "batch_size": 32
  },
  "task": {
    "default_budget": 1000,  // Max steps per task
    "replan_on_failure": true,
    "max_replans": 3
  }
}
```

---

## Known Issues

### Q: Why doesn't the character move?

There's a known issue with PyBoy button inputs not registering in certain states. The game runs (screen animates) but movement commands don't affect player position. Under investigation.

Symptoms:
- Screen animates (game loop running)
- Button blocking flags are clear (D730, CF94, CFBE all 0x00)
- Player direction doesn't change (stays 0x00)
- Position stays constant regardless of input

Workaround: None yet. This is blocking core functionality.
