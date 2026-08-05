#!/usr/bin/env node
/**
 * Extract structured data from Prima Guide pages using Claude Vision
 *
 * Usage: node scripts/extract-with-claude.js [--start N] [--end N] [--force]
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 * Input: data/prima-pages/page-XXX.png
 * Output: data/extractions/page-XXX.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const PAGES_DIR = path.join(DATA_DIR, 'prima-pages');
const OUTPUT_DIR = path.join(DATA_DIR, 'extractions');

// Page range for walkthrough section
const DEFAULT_START_PAGE = 7;
const DEFAULT_END_PAGE = 61;

// Rate limiting
const DELAY_BETWEEN_REQUESTS_MS = 1000;

// Parse command line args
function parseArgs() {
    const args = process.argv.slice(2);
    let startPage = DEFAULT_START_PAGE;
    let endPage = DEFAULT_END_PAGE;
    let force = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--start' && args[i + 1]) {
            startPage = parseInt(args[i + 1], 10);
        }
        if (args[i] === '--end' && args[i + 1]) {
            endPage = parseInt(args[i + 1], 10);
        }
        if (args[i] === '--force') {
            force = true;
        }
    }

    return { startPage, endPage, force };
}

/**
 * The extraction prompt for Claude Vision
 */
const EXTRACTION_PROMPT = `You are analyzing a page from the Prima Pokemon Red/Blue Strategy Guide (1999).

Extract structured data from this page. Look for:

1. **Location name** - The area/map this page covers (e.g., "Pallet Town", "Route 1", "Viridian City")
2. **Objectives** - Things the player should do here
3. **Items** - Collectible items mentioned and their locations
4. **Map analysis** - If there's a map image, extract coordinate regions for key landmarks

For maps, estimate a grid coordinate system where:
- The map is divided into roughly 20x20 cells
- (0,0) is top-left, (19,19) is bottom-right
- Identify regions for: doors, stairs, NPCs, items, exits

Return a JSON object with this structure:
{
  "location": "Location Name",
  "location_type": "city" | "route" | "building" | "cave" | "other",
  "description": "Brief description of this area",
  "has_map": true/false,
  "map_analysis": {
    "grid_size": { "width": 20, "height": 20 },
    "landmarks": [
      {
        "name": "Landmark name",
        "type": "door" | "stairs" | "npc" | "item" | "exit" | "other",
        "region": { "x": [min, max], "y": [min, max] },
        "leads_to": "Destination if exit/door" | null,
        "notes": "Any relevant notes"
      }
    ],
    "recommended_path": "Description of movement through this area"
  },
  "objectives": [
    {
      "name": "Objective name",
      "description": "What to do",
      "landmark": "Associated landmark name" | null,
      "reward": "What you get" | null
    }
  ],
  "items": [
    {
      "name": "Item name",
      "location_description": "Where to find it",
      "landmark": "Associated landmark" | null
    }
  ],
  "connections": [
    {
      "to": "Connected location name",
      "direction": "north" | "south" | "east" | "west" | "up" | "down" | null,
      "method": "walk" | "surf" | "fly" | "teleport",
      "requirements": ["HM01", "Badge"] | []
    }
  ],
  "pokemon_encounters": [
    {
      "name": "Pokemon name",
      "method": "grass" | "water" | "fishing" | "gift" | "trade",
      "rarity": "common" | "uncommon" | "rare" | null
    }
  ],
  "trainers": [
    {
      "name": "Trainer name/type",
      "location_hint": "Where they are"
    }
  ]
}

If the page doesn't contain walkthrough content (e.g., it's a Pokedex page or title page), return:
{
  "location": null,
  "skip_reason": "Reason this page isn't walkthrough content"
}

Be thorough with the map analysis - the coordinate regions will be used to generate reward signals for an RL agent.`;

/**
 * Extract data from a single page using Claude Vision
 */
async function extractPage(client, imagePath, pageNum) {
    // Read image and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    // Determine media type
    const ext = path.extname(imagePath).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

    try {
        const response = await client.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: {
                                type: 'base64',
                                media_type: mediaType,
                                data: base64Image,
                            },
                        },
                        {
                            type: 'text',
                            text: EXTRACTION_PROMPT,
                        },
                    ],
                },
            ],
        });

        // Extract JSON from response
        const text = response.content[0].text;

        // Try to parse as JSON (Claude might wrap it in markdown code blocks)
        let jsonStr = text;
        const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        }

        const extracted = JSON.parse(jsonStr);
        extracted._meta = {
            page: pageNum,
            extracted_at: new Date().toISOString(),
            model: 'claude-sonnet-4-20250514',
            input_tokens: response.usage.input_tokens,
            output_tokens: response.usage.output_tokens,
        };

        return extracted;
    } catch (error) {
        if (error.message.includes('JSON')) {
            console.error(`\n  Warning: Could not parse JSON for page ${pageNum}`);
            return {
                location: null,
                skip_reason: 'JSON parse error',
                _error: error.message,
                _meta: { page: pageNum, extracted_at: new Date().toISOString() },
            };
        }
        throw error;
    }
}

/**
 * Sleep for a specified number of milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('=== Claude Vision Extraction ===\n');

    // Check API key
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error('Error: ANTHROPIC_API_KEY environment variable not set');
        console.error('Export your API key: export ANTHROPIC_API_KEY=sk-ant-...');
        process.exit(1);
    }

    const { startPage, endPage, force } = parseArgs();
    console.log(`Processing pages ${startPage}-${endPage}`);
    if (force) console.log('Force mode: re-extracting existing files');
    console.log();

    // Check pages directory exists
    if (!fs.existsSync(PAGES_DIR)) {
        console.error(`Error: Pages directory not found: ${PAGES_DIR}`);
        console.error('Run `node scripts/extract-pages.js` first.');
        process.exit(1);
    }

    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    // Initialize Anthropic client
    const client = new Anthropic();

    // Process pages
    let processed = 0;
    let skipped = 0;
    let errors = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
        const paddedNum = String(pageNum).padStart(3, '0');
        const imagePath = path.join(PAGES_DIR, `page-${paddedNum}.png`);
        const outputPath = path.join(OUTPUT_DIR, `page-${paddedNum}.json`);

        // Check if image exists
        if (!fs.existsSync(imagePath)) {
            console.log(`Page ${pageNum}: image not found (skipping)`);
            skipped++;
            continue;
        }

        // Skip if already extracted (unless force)
        if (fs.existsSync(outputPath) && !force) {
            console.log(`Page ${pageNum}: already extracted (skipping)`);
            skipped++;
            continue;
        }

        console.log(`Page ${pageNum}: extracting...`);

        try {
            const extracted = await extractPage(client, imagePath, pageNum);

            // Save extraction
            fs.writeFileSync(outputPath, JSON.stringify(extracted, null, 2));

            // Track tokens
            if (extracted._meta) {
                totalInputTokens += extracted._meta.input_tokens || 0;
                totalOutputTokens += extracted._meta.output_tokens || 0;
            }

            const locationInfo = extracted.location
                ? `location: ${extracted.location}`
                : `skipped: ${extracted.skip_reason || 'unknown'}`;
            console.log(`  -> ${locationInfo}`);

            processed++;

            // Rate limiting
            if (pageNum < endPage) {
                await sleep(DELAY_BETWEEN_REQUESTS_MS);
            }
        } catch (error) {
            console.error(`  Error: ${error.message}`);
            errors++;

            // Handle rate limiting
            if (error.message.includes('rate') || error.status === 429) {
                console.log('  Rate limited. Waiting 60 seconds...');
                await sleep(60000);
                pageNum--; // Retry this page
            }
        }
    }

    console.log('\n=== Summary ===');
    console.log(`Processed: ${processed} pages`);
    console.log(`Skipped: ${skipped} pages`);
    console.log(`Errors: ${errors} pages`);
    console.log(`Total tokens: ${totalInputTokens} input, ${totalOutputTokens} output`);

    // Estimate cost (Claude Sonnet pricing as of 2024)
    const inputCost = (totalInputTokens / 1000000) * 3;
    const outputCost = (totalOutputTokens / 1000000) * 15;
    console.log(`Estimated cost: $${(inputCost + outputCost).toFixed(2)}`);

    console.log(`\nOutput: ${OUTPUT_DIR}`);
}

main().catch(console.error);
