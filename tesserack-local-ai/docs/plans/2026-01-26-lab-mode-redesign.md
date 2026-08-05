# Lab Mode Redesign: Strategy Guide-Grounded LLM-RL Agent

**Date:** 2026-01-26
**Status:** Design approved, ready for implementation

## Overview

Redesign Lab mode as a browser-only visual pipeline editor that uses an extracted Prima Strategy Guide (1999) as a knowledge base for the LLM-RL agent. The system enables experimentation on LLM-RL integration for publishable research.

## Research Angle

**"Grounding LLM-RL agents with human-authored strategy guides"**

Key questions:
- How does structured external knowledge affect sample efficiency?
- What's the optimal query frequency for LLM planning?
- How should RL balance guide adherence vs. exploration?
- Can unit-test-style rewards (à la OLMoCR-2) improve training signal?

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   STRATEGY GUIDE KB                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Walkthrough │  │    Maps     │  │ Pokemon/Items   │  │
│  │   Steps     │  │  (graphs)   │  │   Reference     │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                    LLM PLANNER                           │
│  "Given current state + guide context, generate plans"   │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   RL PLAN SELECTOR                       │
│  Scores plans based on: guide adherence + learned value  │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                      EXECUTOR                            │
│            Converts plans → button presses               │
└─────────────────────────────────────────────────────────┘
```

## Walkthrough Graph Format

### Node Types
- `location` - Places (Pallet Town, Route 1, Viridian City)
- `objective` - Goals (Get starter, Deliver parcel, Beat Brock)
- `item` - Pickups (Potion, Oak's Parcel, TM)
- `pokemon` - Encounters (Pidgey on Route 1, Pikachu in Viridian Forest)

### Edge Types
- `leads_to` - Location → Location
- `requires` - Objective → prerequisite
- `contains` - Location → Item/Pokemon
- `unlocks` - Objective → Location

### Example Structure
```json
{
  "nodes": [
    {"id": "pallet_town", "type": "location", "name": "Pallet Town"},
    {"id": "get_starter", "type": "objective", "name": "Get starter Pokemon", "location": "pallet_town"},
    {"id": "route_1", "type": "location", "name": "Route 1"}
  ],
  "edges": [
    {"from": "pallet_town", "to": "route_1", "type": "leads_to"},
    {"from": "get_starter", "to": "route_1", "type": "unlocks"}
  ]
}
```

## UI Layout

```
┌────────────────────────────────────────────────────────────────┐
│  Lab Mode                                        [Run] [Step]  │
├────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                   WALKTHROUGH GRAPH                      │  │
│  │                        (~60% height)                     │  │
│  │                                                          │  │
│  │     [Pallet]──▶[Route 1]──▶[Viridian]──▶[Forest]──▶...  │  │
│  │         │          ▲            │                        │  │
│  │         ▼          │            ▼                        │  │
│  │    [Get Starter]  [●]     [Oak's Parcel]                │  │
│  │                                                          │  │
│  │  ● Current   ✓ Done   ○ Upcoming   ─ Path taken         │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │  KNOWLEDGE  │─▶│ LLM PLANNER │─▶│ RL SELECTOR │            │
│  │  [Guide]    │  │ [Prompt]    │  │ [Policy]    │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                │
│  ┌──────────────────────┐  ┌───────────────────────────────┐  │
│  │     Game Canvas      │  │  Live: Plan 2 selected (0.81) │  │
│  │      [160x144]       │  │  Next: Reach Viridian City    │  │
│  └──────────────────────┘  └───────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

## Experimentation Features

### Configurable Parameters

| Component | Parameter | Range | Research Question |
|-----------|-----------|-------|-------------------|
| LLM | Prompt template | Multiple variants | How does prompt structure affect plan quality? |
| LLM | Context window | Guide excerpt size | How much context is optimal? |
| LLM | Query frequency | 1-50 steps | Cost vs. performance tradeoff |
| RL | Exploration rate | 0-100% | Exploitation vs. exploration |
| RL | Plan selection | random / value / UCB | Which selection strategy wins? |
| Reward | Guide adherence weight | 0-1 | How much should agent follow guide? |
| Reward | Exploration bonus | 0-1 | Should agent deviate for discovery? |

### Experiment Runner
- Define variable to sweep
- Set values to test
- Choose metrics to capture
- Specify runs per config
- Export CSV/JSON for analysis

### Metrics
- Steps to checkpoint
- LLM calls made
- Guide adherence %
- Total reward
- Objective completion rate

## Technical Implementation

### Dependencies
```bash
npm install cytoscape cytoscape-dagre
```

### File Structure
```
app/src/lib/
├── components/
│   └── lab/
│       ├── LabView.svelte
│       ├── WalkthroughGraph.svelte
│       ├── PipelineToolbar.svelte
│       ├── ConfigPanel.svelte
│       └── ExperimentRunner.svelte
├── core/
│   └── lab/
│       ├── graph-loader.js
│       ├── guide-agent.js
│       └── experiment.js
├── stores/
│   └── lab.js
└── data/
    └── walkthrough-graph.json

scripts/
└── extract-walkthrough.js
```

## Walkthrough Extraction Pipeline

```
Prima Guide DjVu Text (archive.org)
        ↓
    Download & chunk by section headers
        ↓
    LLM extraction pass
    "Extract locations, objectives, items, connections"
        ↓
    Merge & deduplicate nodes
        ↓
    Validate against known game data
        ↓
    walkthrough-graph.json
```

### Validation Unit Tests
- All 8 gym cities present
- Route numbers sequential and connected
- Starter Pokemon options correct
- Known items in correct locations

### Source
- URL: https://archive.org/details/prima1999pokemonredblue
- Format: DjVu text (already OCR'd with ABBYY FineReader)
- Size: ~91MB PDF, text version available

## Task List

1. [ ] Rename `svelte-app/` → `tesserack/`
2. [ ] Download Prima guide text from archive.org
3. [ ] Build extraction script (`scripts/extract-walkthrough.js`)
4. [ ] Run extraction → `walkthrough-graph.json`
5. [ ] Install Cytoscape, create `WalkthroughGraph.svelte`
6. [ ] Build `LabView.svelte` with graph-dominant layout
7. [ ] Create `guide-agent.js` extending RLAgent
8. [ ] Add guide adherence reward signal
9. [ ] Build `ConfigPanel.svelte` for parameter editing
10. [ ] Build `ExperimentRunner.svelte` with metrics export
11. [ ] Write tests validating graph against known game data

## References

- OLMoCR-2: https://allenai.org/blog/olmocr-2 (unit test rewards)
- Prima Guide: https://archive.org/details/prima1999pokemonredblue
- Cytoscape.js: https://js.cytoscape.org/
