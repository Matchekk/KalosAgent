#!/usr/bin/env node
/**
 * Generate test bundles from Claude Vision extractions
 *
 * Usage: node scripts/generate-test-bundles.js
 *
 * Input: data/extractions/page-XXX.json
 * Output: app/static/data/test-bundles.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const EXTRACTIONS_DIR = path.join(DATA_DIR, 'extractions');
const OUTPUT_PATH = path.join(__dirname, '..', 'app', 'static', 'data', 'test-bundles.json');

// Location name normalization map (game names -> canonical names)
const LOCATION_ALIASES = {
    "player's house": "PLAYERS HOUSE 1F",
    "player's house 1f": "PLAYERS HOUSE 1F",
    "player's house 2f": "PLAYERS HOUSE 2F",
    "your house": "PLAYERS HOUSE 1F",
    "home": "PLAYERS HOUSE 1F",
    "pallet town": "PALLET TOWN",
    "route 1": "ROUTE 1",
    "viridian city": "VIRIDIAN CITY",
    "route 2": "ROUTE 2",
    "viridian forest": "VIRIDIAN FOREST",
    "pewter city": "PEWTER CITY",
    "route 3": "ROUTE 3",
    "mt. moon": "MT MOON",
    "mt moon": "MT MOON",
    "route 4": "ROUTE 4",
    "cerulean city": "CERULEAN CITY",
    "route 24": "ROUTE 24",
    "route 25": "ROUTE 25",
    "route 5": "ROUTE 5",
    "underground path": "UNDERGROUND PATH",
    "route 6": "ROUTE 6",
    "vermilion city": "VERMILION CITY",
    "s.s. anne": "SS ANNE",
    "ss anne": "SS ANNE",
    "route 11": "ROUTE 11",
    "diglett's cave": "DIGLETTS CAVE",
    "digletts cave": "DIGLETTS CAVE",
    "route 9": "ROUTE 9",
    "route 10": "ROUTE 10",
    "rock tunnel": "ROCK TUNNEL",
    "lavender town": "LAVENDER TOWN",
    "pokemon tower": "POKEMON TOWER",
    "route 8": "ROUTE 8",
    "route 7": "ROUTE 7",
    "saffron city": "SAFFRON CITY",
    "silph co": "SILPH CO",
    "silph co.": "SILPH CO",
    "celadon city": "CELADON CITY",
    "game corner": "CELADON GAME CORNER",
    "celadon game corner": "CELADON GAME CORNER",
    "rocket hideout": "ROCKET HIDEOUT",
    "route 16": "ROUTE 16",
    "route 17": "ROUTE 17",
    "cycling road": "ROUTE 17",
    "route 18": "ROUTE 18",
    "fuchsia city": "FUCHSIA CITY",
    "safari zone": "SAFARI ZONE",
    "route 15": "ROUTE 15",
    "route 14": "ROUTE 14",
    "route 13": "ROUTE 13",
    "route 12": "ROUTE 12",
    "power plant": "POWER PLANT",
    "seafoam islands": "SEAFOAM ISLANDS",
    "route 19": "ROUTE 19",
    "route 20": "ROUTE 20",
    "cinnabar island": "CINNABAR ISLAND",
    "pokemon mansion": "POKEMON MANSION",
    "route 21": "ROUTE 21",
    "route 22": "ROUTE 22",
    "route 23": "ROUTE 23",
    "victory road": "VICTORY ROAD",
    "indigo plateau": "INDIGO PLATEAU",
    "elite four": "INDIGO PLATEAU",
    "prof. oak's lab": "OAKS LAB",
    "oak's lab": "OAKS LAB",
    "professor oak's lab": "OAKS LAB",
    "oaks lab": "OAKS LAB",
};

/**
 * Normalize a location name to match game memory reader output
 */
function normalizeLocation(name) {
    if (!name) return null;
    const lower = name.toLowerCase().trim();
    return LOCATION_ALIASES[lower] || name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Generate tests from a single extraction
 */
function generateTestsForLocation(extraction) {
    const tests = [];
    const penalties = [];

    // Tier 1: Basic movement
    tests.push({
        id: 'moved',
        type: 'coords_changed',
        reward: 0.1,
        tier: 1,
    });

    // Generate directional movement tests from connections
    if (extraction.connections) {
        for (const conn of extraction.connections) {
            if (conn.direction) {
                const directionMap = {
                    north: { axis: 'y', direction: 'negative' },
                    south: { axis: 'y', direction: 'positive' },
                    east: { axis: 'x', direction: 'positive' },
                    west: { axis: 'x', direction: 'negative' },
                    up: { axis: 'y', direction: 'negative' },
                    down: { axis: 'y', direction: 'positive' },
                };
                const dir = directionMap[conn.direction];
                if (dir) {
                    tests.push({
                        id: `moved_toward_${normalizeLocation(conn.to).toLowerCase().replace(/\s+/g, '_')}`,
                        type: 'coord_delta',
                        axis: dir.axis,
                        direction: dir.direction,
                        reward: 0.2,
                        tier: 1,
                    });
                }
            }
        }
    }

    // Tier 2: Reached landmarks (from map analysis)
    if (extraction.map_analysis?.landmarks) {
        for (const landmark of extraction.map_analysis.landmarks) {
            if (landmark.region) {
                const landmarkId = landmark.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                tests.push({
                    id: `reached_${landmarkId}`,
                    type: 'coord_in_region',
                    minX: landmark.region.x[0],
                    maxX: landmark.region.x[1],
                    minY: landmark.region.y[0],
                    maxY: landmark.region.y[1],
                    reward: landmark.type === 'exit' ? 3 : 2,
                    tier: 2,
                    once: true,
                });

                // If it's an exit, add location change test
                if (landmark.leads_to) {
                    const targetLocation = normalizeLocation(landmark.leads_to);
                    tests.push({
                        id: `exited_to_${targetLocation.toLowerCase().replace(/\s+/g, '_')}`,
                        type: 'location_changed_to',
                        target: targetLocation,
                        reward: 5,
                        tier: 2,
                        once: true,
                    });
                }
            }
        }
    }

    // Tier 2: Location changes from connections
    if (extraction.connections) {
        for (const conn of extraction.connections) {
            const targetLocation = normalizeLocation(conn.to);
            const existingTest = tests.find(t =>
                t.type === 'location_changed_to' && t.target === targetLocation
            );

            if (!existingTest) {
                tests.push({
                    id: `reached_${targetLocation.toLowerCase().replace(/\s+/g, '_')}`,
                    type: 'location_changed_to',
                    target: targetLocation,
                    reward: 5,
                    tier: 2,
                    once: true,
                });
            }
        }
    }

    // Tier 3: Objectives
    if (extraction.objectives) {
        for (const obj of extraction.objectives) {
            const objId = obj.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30);

            // Try to map objective to a testable condition
            const objLower = obj.name.toLowerCase();

            if (objLower.includes('choose') && objLower.includes('pokemon')) {
                tests.push({
                    id: 'got_starter_pokemon',
                    type: 'party_size_increased',
                    reward: 50,
                    tier: 3,
                    once: true,
                });
            } else if (objLower.includes('badge')) {
                tests.push({
                    id: `got_badge_${objId}`,
                    type: 'badge_count_increased',
                    reward: 100,
                    tier: 3,
                    once: true,
                });
            } else if (objLower.includes('catch') || objLower.includes('capture')) {
                tests.push({
                    id: `caught_pokemon_${objId}`,
                    type: 'party_size_increased',
                    reward: 20,
                    tier: 3,
                    once: true,
                });
            } else if (objLower.includes('defeat') || objLower.includes('beat')) {
                // Battle victory - we can detect this via battle state changes
                tests.push({
                    id: `battle_${objId}`,
                    type: 'battle_won',
                    reward: 15,
                    tier: 3,
                    once: true,
                });
            }
        }
    }

    // Tier 3: Items
    if (extraction.items) {
        for (const item of extraction.items) {
            // Item pickup detection would require memory reading
            // For now, we note these as objectives
        }
    }

    // Penalties
    penalties.push({
        id: 'stuck',
        type: 'coords_same',
        threshold: 30,
        reward: -0.5,
    });

    penalties.push({
        id: 'step_cost',
        type: 'always',
        reward: -0.01,
    });

    return { tests, penalties };
}

/**
 * Generate universal tests that apply to all locations
 */
function generateUniversalTests() {
    return {
        tests: [
            { id: 'moved', type: 'coords_changed', reward: 0.1, tier: 1 },
            { id: 'dialog_advanced', type: 'dialog_changed', reward: 0.05, tier: 1 },
            { id: 'won_battle', type: 'battle_won', reward: 10, tier: 2 },
            { id: 'pokemon_caught', type: 'party_size_increased', reward: 30, tier: 3, once: true },
            { id: 'pokemon_evolved', type: 'pokemon_evolved', reward: 20, tier: 3 },
            { id: 'level_up', type: 'level_increased', reward: 5, tier: 2 },
            { id: 'badge_earned', type: 'badge_count_increased', reward: 100, tier: 3, once: true },
            { id: 'new_map', type: 'new_location', reward: 10, tier: 2, once: true },
        ],
        penalties: [
            { id: 'stuck', type: 'coords_same', threshold: 30, reward: -0.5 },
            { id: 'whiteout', type: 'all_fainted', reward: -50 },
            { id: 'step_cost', type: 'always', reward: -0.01 },
        ],
    };
}

async function main() {
    console.log('=== Test Bundle Generator ===\n');

    // Check extractions directory
    if (!fs.existsSync(EXTRACTIONS_DIR)) {
        console.error(`Error: Extractions directory not found: ${EXTRACTIONS_DIR}`);
        console.error('Run `node scripts/extract-with-claude.js` first.');
        process.exit(1);
    }

    // Ensure output directory exists
    const outputDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Read all extraction files
    const files = fs.readdirSync(EXTRACTIONS_DIR)
        .filter(f => f.endsWith('.json'))
        .sort();

    console.log(`Found ${files.length} extraction files\n`);

    // Group extractions by location
    const locationMap = new Map();
    let skipped = 0;

    for (const file of files) {
        const filePath = path.join(EXTRACTIONS_DIR, file);
        const extraction = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (!extraction.location) {
            skipped++;
            continue;
        }

        const normalizedLocation = normalizeLocation(extraction.location);

        if (!locationMap.has(normalizedLocation)) {
            locationMap.set(normalizedLocation, []);
        }
        locationMap.get(normalizedLocation).push(extraction);
    }

    console.log(`Unique locations: ${locationMap.size}`);
    console.log(`Skipped pages: ${skipped}\n`);

    // Generate bundles
    const bundles = {};

    for (const [location, extractions] of locationMap) {
        // Merge extractions for same location (multiple pages)
        const merged = {
            location,
            map_analysis: null,
            objectives: [],
            items: [],
            connections: [],
        };

        for (const ext of extractions) {
            if (ext.map_analysis && !merged.map_analysis) {
                merged.map_analysis = ext.map_analysis;
            }
            if (ext.objectives) {
                merged.objectives.push(...ext.objectives);
            }
            if (ext.items) {
                merged.items.push(...ext.items);
            }
            if (ext.connections) {
                merged.connections.push(...ext.connections);
            }
        }

        // Deduplicate
        merged.objectives = [...new Map(merged.objectives.map(o => [o.name, o])).values()];
        merged.items = [...new Map(merged.items.map(i => [i.name, i])).values()];
        merged.connections = [...new Map(merged.connections.map(c => [c.to, c])).values()];

        // Generate tests
        const { tests, penalties } = generateTestsForLocation(merged);

        // Deduplicate tests by ID
        const uniqueTests = [...new Map(tests.map(t => [t.id, t])).values()];
        const uniquePenalties = [...new Map(penalties.map(p => [p.id, p])).values()];

        bundles[location] = {
            objectives: merged.objectives.map(o => o.name),
            next_locations: merged.connections.map(c => normalizeLocation(c.to)),
            has_map_data: !!merged.map_analysis,
            tests: uniqueTests,
            penalties: uniquePenalties,
        };

        console.log(`  ${location}: ${uniqueTests.length} tests, ${uniquePenalties.length} penalties`);
    }

    // Add default bundle
    bundles['_default'] = generateUniversalTests();
    console.log(`  _default: ${bundles['_default'].tests.length} tests, ${bundles['_default'].penalties.length} penalties`);

    // Add metadata
    const output = {
        _meta: {
            generated_at: new Date().toISOString(),
            source: 'Prima Strategy Guide (1999) via Claude Vision',
            total_locations: locationMap.size,
            total_tests: Object.values(bundles).reduce((sum, b) => sum + b.tests.length, 0),
        },
        bundles,
    };

    // Write output
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));

    console.log(`\nOutput: ${OUTPUT_PATH}`);
    console.log(`Total locations: ${locationMap.size}`);
    console.log(`Total tests: ${output._meta.total_tests}`);
}

main().catch(console.error);
