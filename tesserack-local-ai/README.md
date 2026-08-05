# Tesserack

**Compiling strategy guides into reward functions for reinforcement learning.**

[![Live Demo](https://img.shields.io/badge/demo-tesserack.ai-brightgreen)](https://tesserack.ai)

## What is this?

Most RL game agents learn from scratch with sparse rewards ("you won" / "you lost"). Tesserack takes a different approach: it uses an LLM to read a strategy guide and extract structured "unit tests" that fire as dense rewards throughout gameplay.

The strategy guide becomes a curriculum. Instead of stumbling randomly until the agent accidentally beats Brock, it gets rewarded for:
- Walking toward the gym (+0.1)
- Entering the gym door (+2.0)
- Winning the badge (+50.0)

## How it works

```
Human Knowledge     →  LLM Compiler  →  Unit Test Rewards  →  RL Agent
(Prima Guide PDF)      (Claude Vision)   (test-bundles.json)   (REINFORCE)
```

1. **Extract**: Claude Vision reads pages from the Prima Strategy Guide and extracts locations, objectives, and map coordinates
2. **Compile**: Extractions become tiered unit tests (movement → landmarks → objectives)
3. **Train**: REINFORCE policy network gets dense rewards as tests fire

The LLM acts as a "compiler" that translates human-readable instructions into machine-executable reward signals.

### Reward Tiers

| Tier | What It Rewards | Example | Reward |
|------|-----------------|---------|--------|
| **Tier 1** | Micro movement | Coordinates changed, moved toward objective | 0.1 - 0.2 |
| **Tier 2** | Landmarks | Reached Oak's Lab region, entered a door | 2.0 - 5.0 |
| **Tier 3** | Objectives | Got starter Pokemon, earned badge | 10.0 - 50.0 |
| **Penalties** | Bad behavior | Stuck for 30+ frames | -0.5 |

### Inspired by OLMoCR-2

[OLMoCR-2](https://allenai.org/blog/olmocr) showed that unit tests make excellent reward signals - deterministic, interpretable, and dense. Tesserack applies that insight to game playing: the strategy guide's objectives become the "unit tests" that shape agent behavior.

## Quick Start

```bash
cd app
npm install
npm run dev
```

Open http://localhost:5173, drop a Pokemon Red ROM, and switch to **Train** mode.

**Requirements:** Chrome/Edge 113+ (WebGPU), Pokemon Red ROM

## Features

- **Pure RL Mode**: REINFORCE policy network with unit test rewards (no LLM at runtime)
- **LLM Mode**: Browser-based language model for task decomposition
- **675 pre-compiled tests** across 41 locations from the Prima Guide
- **Real-time visualization**: reward breakdown, policy entropy, training metrics
- **Export/Import**: backup and restore all training data and save states

## Extraction Pipeline

To regenerate test bundles from the Prima Guide (requires Anthropic API key):

```bash
# Download guide from archive.org
npm run guide:download

# Convert PDF pages to images
npm run guide:extract-pages

# Extract structured data via Claude Vision
ANTHROPIC_API_KEY=sk-... npm run guide:extract-claude

# Compile into test bundles
npm run guide:generate-bundles

# Validate output
npm run guide:validate
```

See [docs/EXTRACTION.md](docs/EXTRACTION.md) for details.

## Architecture

### Pure RL Mode (Unit Test Rewards)

```
┌─────────────────────────────────────────────────────────────┐
│   ┌─────────────┐         ┌─────────────┐                   │
│   │   Policy    │ action  │  Emulator   │  new state        │
│   │   πθ(a|s)   │────────▶│  (binjgb)   │─────────┐         │
│   └─────────────┘         └─────────────┘         │         │
│         ▲                                         │         │
│         │ REINFORCE                               ▼         │
│   ┌─────────────┐         ┌─────────────────────────────┐   │
│   │  Rollout    │◀────────│  Unit Test Rewards          │   │
│   │  Buffer     │  reward │  tests(prev, curr) → r      │   │
│   └─────────────┘         └─────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### LLM Mode (Guide-Enhanced)

```
┌─────────────────────────────────────────────────────────────┐
│   ┌─────────────┐         ┌─────────────┐                   │
│   │  Browser    │  tasks  │   Policy    │  actions          │
│   │  LLM        │────────▶│  (Executor) │─────────▶ Game    │
│   └─────────────┘         └─────────────┘                   │
│         ▲                       │                            │
│         │                       │ learns                     │
│         │ context               ▼                            │
│   ┌─────────────┐         ┌─────────────┐                   │
│   │  Walkthrough│         │  Reward     │                   │
│   │  Graph      │         │  System     │                   │
│   └─────────────┘         └─────────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

## Why This Matters

1. **Reward engineering is hard** - Tesserack automates it by mining existing guides
2. **Curriculum is implicit** - The guide's structure naturally provides learning progression
3. **Transferable method** - Any game with a strategy guide could use this approach
4. **Interpretable rewards** - You can see exactly which tests fired and why

## Links

- [Live Demo](https://tesserack.ai)
- [Design Doc](docs/plans/2026-01-27-precompiled-test-bundles-design.md)
- [Extraction Instructions](docs/EXTRACTION.md)

## License

MIT

---

Built by [Sid Mohan](https://github.com/sidmohan0)
