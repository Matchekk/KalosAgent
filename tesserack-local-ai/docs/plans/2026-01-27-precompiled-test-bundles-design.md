# Pre-compiled Test Bundles: OLMoCR-2 Style Reward System

**Date:** 2026-01-27
**Status:** Design approved, ready for implementation

## Overview

Implement a pre-compiled unit test reward system inspired by [OLMoCR-2](https://allenai.org/blog/olmocr-2). An LLM extraction pipeline processes the Prima Strategy Guide PDF to generate location-specific test bundles that provide dense, deterministic reward signals during RL training.

## Key Insight from OLMoCR-2

> "Because we control the source, transcription errors don't corrupt our training signal"

By having Claude extract structured data from the strategy guide, we create a ground truth that tests can verify against deterministically. Tests are pre-compiled once at build time and shipped with the app — no runtime LLM calls needed.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      BUILD TIME (developer machine)             │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │  Prima PDF   │───▶│ Page Images  │───▶│ Claude Vision    │  │
│  │  (archive.org)│    │ (walkthrough │    │ Analysis         │  │
│  │  91MB        │    │  section)    │    │                  │  │
│  └──────────────┘    └──────────────┘    └────────┬─────────┘  │
│                                                    │            │
│                                                    ▼            │
│                                          ┌──────────────────┐  │
│                                          │ Structured JSON  │  │
│                                          │ per page         │  │
│                                          └────────┬─────────┘  │
│                                                    │            │
│                                                    ▼            │
│                                          ┌──────────────────┐  │
│                                          │  Test Bundle     │  │
│                                          │  Generator       │  │
│                                          └────────┬─────────┘  │
│                                                    │            │
│                                                    ▼            │
│                                          ┌──────────────────┐  │
│                                          │ test-bundles.json│  │
│                                          │ (committed)      │  │
│                                          └──────────────────┘  │
│                                                                 │
│   Cost: ~$2 one-time, requires ANTHROPIC_API_KEY               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RUNTIME (user's browser)                   │
│                                                                 │
│   tesserack.ai loads test-bundles.json (static asset)          │
│   UnitTestRewards evaluates tests each step                     │
│   TestsPanel shows which tests fired                            │
│                                                                 │
│   Cost: $0, no API calls, fully deterministic                  │
└─────────────────────────────────────────────────────────────────┘
```

## Claude Vision Extraction

For each walkthrough page (pages 7-61, ~55 pages), Claude Vision analyzes the image and extracts:

**From text content:**
- Location name
- Objectives listed
- Directional instructions
- Items to collect

**From map images:**
- Grid coordinates of landmarks (doors, stairs, NPCs, items)
- Coordinate regions for objectives
- Exit positions and destinations

**Output format per page:**
```json
{
  "page": 12,
  "location": "Pallet Town",
  "map_analyzed": true,
  "grid_size": { "width": 20, "height": 18 },
  "landmarks": [
    { "name": "Player's House", "region": { "x": [4, 6], "y": [2, 4] } },
    { "name": "Oak's Lab", "region": { "x": [10, 14], "y": [8, 12] } },
    { "name": "Exit to Route 1", "region": { "x": [10, 12], "y": [0, 0] }, "leads_to": "Route 1" }
  ],
  "objectives": [
    { "name": "Choose starter Pokemon", "location": "Oak's Lab", "region": { "x": [11, 13], "y": [9, 10] } }
  ],
  "directions": [
    { "instruction": "Head south to Oak's Lab", "from": "Player's House", "movement": "+y" }
  ]
}
```

## Test Bundle Structure

Generated bundles use tiered rewards:

**Tier 1 - Micro-movement (reward: 0.1-0.5)**
```json
{ "id": "moved", "type": "coords_changed", "reward": 0.1 },
{ "id": "moved_south", "type": "coord_delta", "axis": "y", "direction": "positive", "reward": 0.2 }
```

**Tier 2 - Reached landmark (reward: 1-5)**
```json
{ "id": "reached_oaks_lab", "type": "coord_in_region",
  "minX": 10, "maxX": 14, "minY": 8, "maxY": 12,
  "reward": 3, "once": true }
```

**Tier 3 - Objective complete (reward: 10-50)**
```json
{ "id": "got_starter", "type": "party_size_increased", "reward": 50, "once": true },
{ "id": "exited_to_route1", "type": "location_changed_to", "target": "Route 1", "reward": 20, "once": true }
```

**Penalties:**
```json
{ "id": "stuck", "type": "coords_same", "threshold": 30, "reward": -0.5 },
{ "id": "went_backwards", "type": "location_changed_to", "target": "Player's House 2F", "reward": -2 }
```

**Final bundle format:**
```json
{
  "PALLET TOWN": {
    "objectives": ["Choose starter Pokemon", "Get Pokedex"],
    "next_locations": ["Route 1", "Player's House"],
    "tests": [ ... ],
    "penalties": [ ... ]
  },
  "_default": {
    "tests": [ /* universal tests */ ],
    "penalties": [ /* universal penalties */ ]
  }
}
```

## Test Types

| Type | Description | Parameters |
|------|-------------|------------|
| `coords_changed` | Player moved | - |
| `coords_same` | Player didn't move | `threshold` (steps) |
| `coord_delta` | Moved in direction | `axis`, `direction` |
| `coord_in_region` | Player in area | `minX`, `maxX`, `minY`, `maxY` |
| `location_changed_to` | Changed location | `target` |
| `party_size_increased` | Caught/received Pokemon | - |
| `badge_count_increased` | Earned badge | - |
| `level_increased` | Pokemon leveled up | - |

## UnitTestRewards Integration

Modified class loads bundles and evaluates dynamically:

```javascript
export class UnitTestRewards {
    constructor(config = {}) {
        this.bundles = null;
        this.currentBundle = null;
        this.firedOnce = new Set();
    }

    async loadBundles(url = '/data/test-bundles.json') {
        const response = await fetch(url);
        this.bundles = await response.json();
    }

    setLocation(locationName) {
        const key = this.matchLocation(locationName);
        this.currentBundle = this.bundles[key] || this.bundles['_default'];
    }

    evaluate(prevState, currState) {
        if (currState.location !== prevState.location) {
            this.setLocation(currState.location);
        }

        let total = 0;
        const fired = [];
        const breakdown = { tier1: 0, tier2: 0, tier3: 0, penalties: 0 };

        for (const test of this.currentBundle.tests) {
            if (test.once && this.firedOnce.has(test.id)) continue;

            if (this.evalTest(test, prevState, currState)) {
                total += test.reward;
                fired.push({ id: test.id, reward: test.reward, tier: test.tier });
                breakdown[`tier${test.tier}`] += test.reward;
                if (test.once) this.firedOnce.add(test.id);
            }
        }

        for (const penalty of this.currentBundle.penalties) {
            if (this.evalTest(penalty, prevState, currState)) {
                total += penalty.reward;
                fired.push({ id: penalty.id, reward: penalty.reward, tier: 'penalty' });
                breakdown.penalties += penalty.reward;
            }
        }

        return { total, breakdown, firedTests: fired };
    }
}
```

## Training Transparency UI

New `TestsPanel.svelte` component shows real-time test evaluation:

```
┌─────────────────────────────────────────────────────┐
│ Tests                              PALLET TOWN      │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Active Bundle: 12 tests, 3 penalties               │
│                                                     │
│  Last Step:                                         │
│  ├─ ✓ moved_south        +0.2   (Tier 1)           │
│  └─ ✓ approaching_lab    +1.0   (Tier 2)           │
│                                                     │
│  Reward Breakdown:                                  │
│  ┌──────────────────────────────────────────┐      │
│  │ Tier 1 ████████░░░░░░░░░░  +12.4         │      │
│  │ Tier 2 ████░░░░░░░░░░░░░░   +8.0         │      │
│  │ Tier 3 ██░░░░░░░░░░░░░░░░  +50.0         │      │
│  │ Penalty ██░░░░░░░░░░░░░░░   -4.2         │      │
│  └──────────────────────────────────────────┘      │
│                                                     │
│  Completed (once):                                  │
│  ✓ got_starter  ✓ exited_house  ○ got_pokedex     │
│                                                     │
│  ─────────────────────────────────────────────────  │
│  To replicate: run in dev mode, see docs/EXTRACTION │
└─────────────────────────────────────────────────────┘
```

**UI copy for replication:**
> "Test bundles compiled from Prima Strategy Guide (1999). To replicate or modify the extraction, run in dev mode and follow instructions in docs/EXTRACTION.md"

## File Structure

```
scripts/
├── download-prima-guide.js     # Fetch PDF from archive.org
├── extract-pages.js            # PDF → page images
├── extract-with-claude.js      # Pages → Claude Vision → JSON
├── generate-test-bundles.js    # Extractions → test-bundles.json
└── validate-bundles.js         # Sanity checks

data/
├── prima-pages/                # Page images (gitignored, large)
│   ├── page-007.png
│   └── ...
├── extractions/                # Claude extractions (committed)
│   ├── page-007.json
│   └── ...
└── prima-guide-text.txt        # Existing OCR text

app/static/data/
└── test-bundles.json           # Compiled bundles (committed)

app/src/lib/
├── components/lab/
│   ├── TestsPanel.svelte       # New UI component
│   └── LabView.svelte          # Modified to include TestsPanel
└── core/lab/
    └── unit-test-rewards.js    # Modified to load bundles

docs/
└── EXTRACTION.md               # Replication instructions
```

## npm Scripts

```json
{
  "guide:download": "node scripts/download-prima-guide.js",
  "guide:extract-pages": "node scripts/extract-pages.js",
  "guide:extract-claude": "node scripts/extract-with-claude.js",
  "guide:generate-bundles": "node scripts/generate-test-bundles.js",
  "guide:validate": "node scripts/validate-bundles.js",
  "guide:full-pipeline": "npm run guide:download && npm run guide:extract-pages && npm run guide:extract-claude && npm run guide:generate-bundles && npm run guide:validate"
}
```

## Replication Instructions (docs/EXTRACTION.md)

```markdown
# Replicating the Test Bundle Extraction

The test bundles shipped with Tesserack were extracted from the
Prima Strategy Guide (1999) using Claude Vision. You can replicate
or modify this extraction.

## Prerequisites

- Node.js 18+
- Anthropic API key with Claude Vision access
- ~$2-3 for API costs (~55 pages)

## Steps

1. Set your API key:
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   ```

2. Run the full pipeline:
   ```bash
   npm run guide:full-pipeline
   ```

   Or run steps individually:
   ```bash
   npm run guide:download        # Fetch PDF from archive.org
   npm run guide:extract-pages   # Convert to page images
   npm run guide:extract-claude  # Extract with Claude Vision
   npm run guide:generate-bundles # Generate test-bundles.json
   npm run guide:validate        # Validate output
   ```

3. Extractions are cached in `data/extractions/`. To re-extract
   a specific page, delete its JSON file and re-run.

4. The final `test-bundles.json` is written to `app/static/data/`.

## Modifying Extractions

- Edit files in `data/extractions/` to correct errors
- Re-run `npm run guide:generate-bundles` to regenerate bundles
- Submit a PR with your improvements

## Source

Prima's Official Strategy Guide (1999)
https://archive.org/details/prima1999pokemonredblue
```

## Validation Checks

The `validate-bundles.js` script verifies:

1. All 8 gym cities have bundles
2. Route numbers are present and connected
3. Early game locations have coordinate regions
4. No duplicate test IDs within a bundle
5. All `leads_to` targets exist as bundle keys
6. Reward values are within expected ranges

## Success Criteria

1. **Pre-compiled**: Tests generated at build time, not runtime
2. **Deterministic**: Same state + action = same test results
3. **Guide-aligned**: Tests encode Prima guide knowledge
4. **Location-aware**: Different tests per location
5. **Transparent**: UI shows which tests fire and why
6. **Reproducible**: Anyone can re-run extraction with instructions

## Cost Estimate

- Claude Vision: ~55 pages × ~$0.02/page = ~$1-2
- One-time extraction, cached for future runs
- Free for end users (bundles shipped as static JSON)

## References

- OLMoCR-2: https://allenai.org/blog/olmocr-2
- Prima Guide: https://archive.org/details/prima1999pokemonredblue
- Existing design: docs/plans/2026-01-26-unit-test-rewards-design.md
