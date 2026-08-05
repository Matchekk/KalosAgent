# Tesserack Test Bed Harness Design

**Date:** 2026-01-26
**Goal:** Create a deterministic harness that enables a small LLM to beat Pokemon Red

## Overview

Tesserack evolves into a hybrid system:
- **Python test bed** (`/lab`) — Full experimentation capabilities, batch runs, rich metrics
- **Browser version** (`/browser`) — Demo and showcase, zero-setup experience

The test bed is a **hierarchical learning system** where an LLM acts as a strategic planner and a policy network acts as a tactical executor that learns over time.

## Architecture

### LLM Layer (Strategic Planner)
- Receives game state + context, issues task-level goals
- Examples: "Navigate to Viridian Forest", "Catch a Pikachu", "Train party to level 14"
- Consults strategy guide excerpts for decision making
- Re-plans when tasks fail or get stuck

### Policy Network Layer (Tactical Executor)
- Receives current task + game state, outputs button presses
- Learns from experience which micro-actions achieve which tasks
- Over time, handles more tasks autonomously (teacher dynamic)
- Signals success (goal reached) or stuck (step budget exceeded)

### The Harness
- Manages the game (PyBoy), reads state, tracks progress
- Routes information between LLM and policy network
- Detects task completion via memory triggers
- Logs everything for analysis

## Core Components

### PyBoy Emulator Wrapper
- Runs Pokemon Red headless at accelerated speed (10x+ for training)
- Exposes memory read/write for game state extraction
- Handles save states for checkpointing and recovery
- Provides frame stepping for precise control

### Game State Reader
- Extracts structured state from RAM: location, party (Pokemon, levels, HP, moves), badges, items, money, battle state
- Outputs a clean `GameState` object that both LLM and policy network consume

### LLM Interface
- Swappable backend: local (Ollama, llama.cpp), API (OpenAI, Groq), or direct (transformers)
- Prompt builder: assembles context (game state, task history, strategy guide excerpts)
- Response parser: extracts structured task from LLM output
- Configurable: model, temperature, prompt templates all adjustable

### Policy Network
- Input: game state + current task embedding
- Output: action probabilities (A, B, Start, Select, D-pad)
- Architecture swappable (MLP, small transformer, etc.)
- Trains on experience buffer: (state, task, action, outcome)

### Metrics Logger
- Every LLM call, task attempt, policy update, checkpoint reached
- Structured logs for analysis (JSON)
- Enables experiment comparison

## Task System

### Task Definition
```
Task:
  type: "navigate" | "catch" | "train" | "battle" | "buy" | "use_item" | ...
  target: specific goal (location, pokemon, level, item, etc.)
  context: why this task (optional, for LLM re-planning)
  budget: max steps before considered stuck
```

### Task Lifecycle
1. **Issued** — LLM outputs a task based on current state + objective
2. **Active** — Policy network executes, harness monitors progress
3. **Completed** — Memory trigger fires (location reached, Pokemon caught, etc.)
4. **Failed** — Step budget exceeded, or impossible state detected

### Completion Triggers (memory-based)
- `navigate`: player coordinates match target area
- `catch`: party contains target Pokemon species
- `train`: target Pokemon reaches target level
- `battle`: specific trainer flag set in memory
- `buy`: item count increased in bag

### On Failure
- Log what happened (steps taken, final state, what was attempted)
- Return control to LLM with failure context
- LLM re-plans: break task into smaller pieces, or try different approach

## Main Loop

```
1. INITIALIZE
   - Load ROM, start new game (or load save state)
   - Load strategy guide, set current objective (checkpoint 1)
   - Initialize policy network (fresh or pre-trained)

2. LLM PLANNING
   - Build context: game state, objective, recent task history
   - Query LLM: "What task should we do next?"
   - Parse response into Task object

3. POLICY EXECUTION
   - While task not complete and budget remaining:
       - Policy network selects action given (state, task)
       - Step emulator, read new state
       - Log experience: (state, task, action, new_state)
       - Check completion triggers

4. TASK RESOLUTION
   - If completed: log success, add to task history
   - If failed: log failure with context, return to step 2

5. CHECKPOINT CHECK
   - If current objective completed (badge earned, etc.)
       - Log checkpoint, advance to next objective
   - If game beaten: done

6. TRAINING (periodic)
   - Sample from experience buffer
   - Update policy network
   - Log training metrics

Loop 2-6 until victory or experiment ends.
```

## LLM Context Strategy

### Always included:
- Current game state (location, party summary, badges, key items, money)
- Current objective from strategy guide
- Last 5 tasks with outcomes (success/fail, steps taken)

### Included when stuck or at decision points:
- Failure details with context
- Relevant strategy guide excerpt for current area/objective
- Policy network confidence scores

### Prompt structure:
```
SYSTEM: You are playing Pokemon Red. Issue one task at a time.
Available task types: navigate, catch, train, battle, buy, use_item

OBJECTIVE: {current_checkpoint}

GAME STATE:
{formatted_state}

RECENT TASKS:
{task_history}

{optional: FAILURE_CONTEXT}
{optional: STRATEGY_HINT}

What is the next task? Respond in format:
TASK: {type} | {target} | {reason}
```

## Metrics & Experiment Tracking

### Per-task metrics:
- Task type, target, success/fail
- Steps taken, time elapsed
- LLM calls required
- Policy network confidence

### Per-checkpoint metrics:
- Tasks attempted, success rate
- Total steps, total LLM calls
- Time to complete
- Deaths/whiteouts

### Per-run summary:
- Checkpoints reached (out of 47)
- Total steps, total LLM calls
- Policy network training episodes
- Final party state

### Experiment comparison:
- Config file captures: LLM model, prompt template, policy architecture, reward function
- Each run tagged with config hash
- Compare runs across configs

## Repo Structure

```
tesserack/
├── browser/                    # Current SvelteKit app
│   ├── src/
│   ├── package.json
│   └── ...
│
├── lab/                        # Python test bed
│   ├── tesserack/
│   │   ├── emulator.py         # PyBoy wrapper
│   │   ├── state.py            # Game state reader
│   │   ├── tasks.py            # Task definitions, triggers
│   │   ├── llm.py              # LLM interface
│   │   ├── policy.py           # Policy network
│   │   ├── harness.py          # Main loop orchestration
│   │   ├── metrics.py          # Logging, experiment tracking
│   │   └── config.py           # Experiment configuration
│   ├── configs/                # Experiment config files
│   ├── data/
│   │   └── strategy_guide.json
│   ├── runs/                   # Experiment outputs
│   ├── scripts/
│   │   └── run_experiment.py
│   ├── requirements.txt
│   └── README.md
│
├── shared/                     # Shared assets/configs
│   └── memory_map.json         # Pokemon Red RAM addresses
│
└── README.md
```

## User Personas & Transition

| Use Case | "I just want to watch" | "I want to tinker" | "I want to run experiments" | "I want to contribute" |
|----------|------------------------|--------------------|-----------------------------|------------------------|
| Served by | Browser version | Browser + local LLM | Python lab | Either layer |
| Setup | Zero | Minimal (run local LLM) | Python environment | Clone repo |

## MVP Scope

**Goal:** Small LLM beats first 2 gyms (Brock + Misty)

### In scope:
- PyBoy wrapper with state extraction
- Basic task system (navigate, catch, train, battle)
- Single LLM backend (Ollama or OpenAI-compatible)
- Simple policy network (MLP)
- Core loop running end-to-end
- Basic logging (JSON files)
- Strategy guide parsed through Misty checkpoint

### Out of scope for MVP:
- Swappable policy architectures
- Fancy experiment comparison UI
- Browser integration
- Full 47 checkpoints
- Optimized training

### Success criteria:
- Starting from new game, reaches Cerulean City with Cascade Badge
- Logged run shows task sequence, LLM calls, training progress
- Reproducible: can re-run with same config, get similar results
