# Tesserack Lab

> **Experimental**
> This module contains research infrastructure for exploring reinforcement learning with deterministic reward specifications. Results are exploratory and configurations may change.

Python test bed for studying credit assignment in game environments.

## Overview

This is the experimentation layer of Tesserack. It supports two execution modes:

### Hierarchical Mode (`agent_mode: "hierarchical_llm"`)
- Language model decomposes objectives into tasks
- Policy network executes tasks
- Reward shaping based on task progress

### Pure RL Mode (`agent_mode: "pure_rl"`)
- Policy acts directly every step (no LLM at runtime)
- Rewards from deterministic unit tests
- Tiered reward breakdown for analysis

**Key features:**
- Full experiment tracking: every step, checkpoint, and training update logged
- Configurable reward specifications via JSON test bundles
- Ablation-ready: toggle tiers, penalties, decay independently

## Quick Start

### 1. Install dependencies

```bash
cd lab
pip install -r requirements.txt
```

### 2. Get a Pokemon Red ROM

Place `pokemon_red.gb` in the `lab` directory (or specify path with `--rom`).

### 3. Run an experiment

**Pure RL mode** (recommended starting point - no LLM needed):
```bash
python scripts/run_experiment.py configs/pure_rl_unit_tests.json
```

**Hierarchical mode** (requires Ollama or other LLM backend):
```bash
# Start Ollama first
ollama pull llama3.2:3b
ollama serve

# Then run
python scripts/run_experiment.py --rom pokemon_red.gb
```

## Browser UI Modes

The Tesserack browser UI (`npm run dev` in `/app`) supports both execution modes directly:

### LLM Mode (Default)
- Runs emulator **in browser** via WebAssembly
- Uses browser LLM (WebGPU) or external APIs for hierarchical planning
- Strategy guide provides context for LLM decisions
- Good for interactive exploration and debugging

### Pure RL Mode (Browser-native)
- Click the **"Pure RL"** button in Lab Mode header
- Runs entirely in browser - no Python backend needed
- Simple policy network with epsilon-greedy action selection
- Deterministic unit-test rewards (movement, exploration, milestones)
- Real-time metrics panel shows:
  - Step-by-step reward breakdown (T1/T2/T3/penalties)
  - Current epsilon (exploration rate)
  - Action taken each step
  - Total cumulative reward

The browser Pure RL mode is recommended for quick experimentation. Use the Python lab for headless batch experiments at higher speeds.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        HARNESS                               │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │    LLM      │    │   Policy    │    │    Emulator     │  │
│  │  (Planner)  │───▶│  (Executor) │───▶│    (PyBoy)      │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
│         │                  ▲                    │            │
│         │                  │                    │            │
│         ▼                  │                    ▼            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │    Task     │    │  Experience │    │   Game State    │  │
│  │   System    │    │   Buffer    │    │    Reader       │  │
│  └─────────────┘    └─────────────┘    └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### The Loop

1. **LLM Planning**: Given game state + objective, LLM issues a task
2. **Policy Execution**: Policy network takes actions to complete task
3. **Completion Detection**: Memory triggers detect when task succeeds
4. **Experience Collection**: State/action/reward tuples stored for training
5. **Periodic Training**: Policy network learns from collected experiences

## Configuration

See `configs/pure_rl_unit_tests.json` for pure RL mode or `configs/default.json` for hierarchical mode.

### Execution Mode Settings

```json
{
  "agent_mode": "pure_rl",       // "hierarchical_llm" or "pure_rl"
  "reward_mode": "unit_tests",   // "shaping", "unit_tests", or "mixed"
  "seed": 42
}
```

### Unit Test Rewards

```json
{
  "unit_tests": {
    "enabled": true,
    "bundles_path": "data/test-bundles.json",
    "enable_tier1": true,        // Movement rewards
    "enable_tier2": true,        // Map transitions
    "enable_tier3": true,        // Major milestones
    "enable_penalties": true,
    "tier1_weight": 1.0,
    "tier2_weight": 1.0,
    "tier3_weight": 1.0
  }
}
```

### Policy Settings

```json
{
  "policy": {
    "epsilon_start": 0.3,
    "train_every": 100,
    "ignore_task": true          // true for pure RL mode
  }
}
```

## Experiment Outputs

Each run creates in `runs/`:

- `{run_id}_config.json` - Experiment configuration
- `{run_id}_tasks.jsonl` - Task-by-task log
- `{run_id}_checkpoints.jsonl` - Checkpoint progression
- `{run_id}_summary.json` - Final metrics
- `{run_id}_policy.npz` - Trained policy weights
- `{run_id}_cp{N}.state` - Emulator save states

## Current Focus

Exploring whether hierarchical decomposition enables small models (Llama 3.2 3B or similar) to make progress through early-game milestones:

- [ ] Brock (Boulder Badge)
- [ ] Misty (Cascade Badge)

## Development

```
lab/
├── tesserack/
│   ├── emulator.py    # PyBoy wrapper
│   ├── state.py       # Game state extraction
│   ├── tasks.py       # Task definitions
│   ├── llm.py         # LLM interface
│   ├── policy.py      # Policy network
│   ├── harness.py     # Main loop (both modes)
│   ├── unit_tests.py  # Deterministic reward evaluator
│   ├── metrics.py     # Logging
│   └── config.py      # Configuration
├── configs/           # Experiment configs
├── data/              # Test bundles, reward specs
├── scripts/           # Entry points
└── runs/              # Experiment outputs
```
