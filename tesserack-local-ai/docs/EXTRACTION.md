# Replicating the Test Bundle Extraction

The test bundles shipped with Tesserack were extracted from the Prima Strategy Guide (1999) using Claude Vision. This document explains how to replicate or modify the extraction.

## Overview

Tesserack uses **pre-compiled unit test rewards** inspired by [OLMoCR-2](https://allenai.org/blog/olmocr-2). Instead of hardcoded heuristics, rewards are derived from the official Prima Strategy Guide:

1. Claude Vision analyzes each walkthrough page
2. Extracts locations, objectives, map coordinates, and movement directions
3. Generates deterministic test bundles that reward progress

The extraction runs once at build time. The resulting `test-bundles.json` ships with the app — no API calls at runtime.

## Prerequisites

- Node.js 18+
- Anthropic API key with Claude Vision access
- ~$2-3 for API costs (~55 walkthrough pages)

## Quick Start

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Run the full pipeline
npm run guide:full-pipeline
```

## Step-by-Step

### 1. Download the Prima Guide

```bash
npm run guide:download
```

Downloads the PDF from [archive.org](https://archive.org/details/prima1999pokemonredblue) to `data/prima-guide.pdf`.

### 2. Extract Page Images

```bash
npm run guide:extract-pages
```

Converts walkthrough pages (7-61) to individual PNG images in `data/prima-pages/`.

### 3. Extract with Claude Vision

```bash
npm run guide:extract-claude
```

Sends each page to Claude Vision for analysis. Extracts:
- Location names and descriptions
- Objectives and items
- Map coordinates and landmark regions
- Movement directions and connections

Results saved to `data/extractions/page-XXX.json`.

**Note:** This step costs ~$2 and takes a few minutes. Extractions are cached — re-running skips already-processed pages.

### 4. Generate Test Bundles

```bash
npm run guide:generate-bundles
```

Merges all extractions into `app/static/data/test-bundles.json`:
- Groups by location
- Generates tiered tests (movement, landmarks, objectives)
- Adds penalties (stuck detection, backtracking)

### 5. Validate

```bash
npm run guide:validate
```

Sanity checks:
- All 8 gym cities present
- Routes connected properly
- No duplicate test IDs
- Reward values in expected ranges

## Modifying Extractions

Claude's extractions aren't perfect. To correct errors:

1. Edit the relevant file in `data/extractions/`
2. Re-run bundle generation:
   ```bash
   npm run guide:generate-bundles
   ```
3. Test your changes locally
4. Submit a PR with improvements

### Example: Fixing a coordinate region

```json
// data/extractions/page-012.json
{
  "landmarks": [
    {
      "name": "Oak's Lab",
      "region": { "x": [10, 14], "y": [8, 12] }  // Adjust these values
    }
  ]
}
```

## Re-extracting a Single Page

Delete the cached extraction and re-run:

```bash
rm data/extractions/page-012.json
npm run guide:extract-claude
```

Only the missing page will be processed.

## File Structure

```
data/
├── prima-guide.pdf         # Source PDF (gitignored)
├── prima-pages/            # Page images (gitignored)
│   ├── page-007.png
│   └── ...
└── extractions/            # Claude extractions (committed)
    ├── page-007.json
    └── ...

app/static/data/
└── test-bundles.json       # Final output (committed)
```

## What Gets Committed

- `data/extractions/*.json` — Raw Claude extractions (for reproducibility)
- `app/static/data/test-bundles.json` — Compiled bundles

## What's Gitignored

- `data/prima-guide.pdf` — Large file, download from archive.org
- `data/prima-pages/` — Generated images

## Source Material

**Prima's Official Strategy Guide (1999)**
- Archive.org: https://archive.org/details/prima1999pokemonredblue
- Format: PDF (91MB)
- Pages 7-61: Walkthrough section

## Troubleshooting

### "Rate limited" errors
The script includes retry logic, but if you hit rate limits:
```bash
# Extract in smaller batches
npm run guide:extract-claude -- --start 7 --end 20
npm run guide:extract-claude -- --start 21 --end 40
npm run guide:extract-claude -- --start 41 --end 61
```

### Missing coordinates in extraction
Some pages don't have maps. The generator uses `_default` tests for locations without coordinate data.

### Validation failures
Check the validation output for specific issues. Common fixes:
- Add missing location aliases in `scripts/generate-test-bundles.js`
- Correct typos in extraction JSON files

## Contributing

Improvements to extractions are welcome! Please:
1. Fork the repo
2. Make changes to `data/extractions/` files
3. Run validation to ensure no regressions
4. Submit a PR with a description of what you fixed

## References

- [OLMoCR-2: Unit test rewards](https://allenai.org/blog/olmocr-2) — Inspiration for this approach
- [Design doc](plans/2026-01-27-precompiled-test-bundles-design.md) — Full technical design
