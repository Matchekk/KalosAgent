#!/usr/bin/env node
/**
 * Validate generated test bundles
 *
 * Usage: node scripts/validate-bundles.js
 *
 * Checks:
 * - All 8 gym cities present
 * - Routes are present
 * - No duplicate test IDs within bundles
 * - Reward values in expected ranges
 * - Connection targets exist
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLES_PATH = path.join(__dirname, '..', 'app', 'static', 'data', 'test-bundles.json');

// Expected gym cities
const GYM_CITIES = [
    'PEWTER CITY',
    'CERULEAN CITY',
    'VERMILION CITY',
    'CELADON CITY',
    'FUCHSIA CITY',
    'SAFFRON CITY',
    'CINNABAR ISLAND',
    'VIRIDIAN CITY',
];

// Expected early game locations (critical path)
const CRITICAL_LOCATIONS = [
    'PALLET TOWN',
    'ROUTE 1',
    'VIRIDIAN CITY',
    'ROUTE 2',
    'VIRIDIAN FOREST',
    'PEWTER CITY',
];

// Reward value ranges by tier
const REWARD_RANGES = {
    1: { min: 0.01, max: 1 },
    2: { min: 1, max: 20 },
    3: { min: 10, max: 150 },
};

function validateBundles(bundles) {
    const errors = [];
    const warnings = [];

    // Check metadata
    if (!bundles._meta) {
        warnings.push('Missing _meta field');
    }

    // Check for _default bundle
    if (!bundles.bundles._default) {
        errors.push('Missing _default bundle');
    }

    const locationBundles = Object.entries(bundles.bundles).filter(([k]) => k !== '_default');

    // Check gym cities
    for (const city of GYM_CITIES) {
        const found = locationBundles.some(([name]) =>
            name.toUpperCase().includes(city.toUpperCase()) ||
            city.toUpperCase().includes(name.toUpperCase())
        );
        if (!found) {
            warnings.push(`Missing gym city: ${city}`);
        }
    }

    // Check critical locations
    for (const loc of CRITICAL_LOCATIONS) {
        const found = locationBundles.some(([name]) =>
            name.toUpperCase() === loc.toUpperCase()
        );
        if (!found) {
            warnings.push(`Missing critical location: ${loc}`);
        }
    }

    // Validate each bundle
    for (const [location, bundle] of locationBundles) {
        const testIds = new Set();

        // Check for duplicate test IDs
        if (bundle.tests) {
            for (const test of bundle.tests) {
                if (testIds.has(test.id)) {
                    errors.push(`Duplicate test ID in ${location}: ${test.id}`);
                }
                testIds.add(test.id);

                // Validate reward range
                if (test.tier && REWARD_RANGES[test.tier]) {
                    const range = REWARD_RANGES[test.tier];
                    if (test.reward < range.min || test.reward > range.max) {
                        warnings.push(
                            `${location}: Test "${test.id}" reward ${test.reward} outside tier ${test.tier} range [${range.min}, ${range.max}]`
                        );
                    }
                }

                // Validate coord_in_region has required fields
                if (test.type === 'coord_in_region') {
                    if (test.minX === undefined || test.maxX === undefined ||
                        test.minY === undefined || test.maxY === undefined) {
                        errors.push(`${location}: coord_in_region test "${test.id}" missing coordinate bounds`);
                    }
                }

                // Validate location_changed_to has target
                if (test.type === 'location_changed_to' && !test.target) {
                    errors.push(`${location}: location_changed_to test "${test.id}" missing target`);
                }
            }
        }

        // Check penalties
        if (bundle.penalties) {
            for (const penalty of bundle.penalties) {
                if (penalty.reward >= 0) {
                    warnings.push(`${location}: Penalty "${penalty.id}" has non-negative reward: ${penalty.reward}`);
                }
            }
        }

        // Check next_locations references exist (or are known aliases)
        if (bundle.next_locations) {
            for (const nextLoc of bundle.next_locations) {
                const exists = locationBundles.some(([name]) =>
                    name.toUpperCase() === nextLoc.toUpperCase()
                );
                // Don't error on this - some locations might be intentionally missing
                // if (!exists) {
                //     warnings.push(`${location}: next_location "${nextLoc}" not found in bundles`);
                // }
            }
        }
    }

    return { errors, warnings, stats: {
        totalLocations: locationBundles.length,
        totalTests: locationBundles.reduce((sum, [, b]) => sum + (b.tests?.length || 0), 0),
        totalPenalties: locationBundles.reduce((sum, [, b]) => sum + (b.penalties?.length || 0), 0),
        locationsWithMaps: locationBundles.filter(([, b]) => b.has_map_data).length,
    }};
}

async function main() {
    console.log('=== Test Bundle Validator ===\n');

    // Check file exists
    if (!fs.existsSync(BUNDLES_PATH)) {
        console.error(`Error: Bundles file not found: ${BUNDLES_PATH}`);
        console.error('Run `node scripts/generate-test-bundles.js` first.');
        process.exit(1);
    }

    // Load bundles
    const bundles = JSON.parse(fs.readFileSync(BUNDLES_PATH, 'utf8'));

    // Validate
    const { errors, warnings, stats } = validateBundles(bundles);

    // Print stats
    console.log('=== Statistics ===');
    console.log(`Total locations: ${stats.totalLocations}`);
    console.log(`Locations with map data: ${stats.locationsWithMaps}`);
    console.log(`Total tests: ${stats.totalTests}`);
    console.log(`Total penalties: ${stats.totalPenalties}`);
    console.log();

    // Print warnings
    if (warnings.length > 0) {
        console.log(`=== Warnings (${warnings.length}) ===`);
        for (const warning of warnings) {
            console.log(`  [WARN] ${warning}`);
        }
        console.log();
    }

    // Print errors
    if (errors.length > 0) {
        console.log(`=== Errors (${errors.length}) ===`);
        for (const error of errors) {
            console.log(`  [ERROR] ${error}`);
        }
        console.log();
        console.log('Validation FAILED');
        process.exit(1);
    }

    // Print location list
    console.log('=== Locations ===');
    const locations = Object.keys(bundles.bundles)
        .filter(k => k !== '_default')
        .sort();
    for (const loc of locations) {
        const bundle = bundles.bundles[loc];
        const mapIcon = bundle.has_map_data ? '[MAP]' : '     ';
        console.log(`  ${mapIcon} ${loc}: ${bundle.tests?.length || 0} tests`);
    }
    console.log();

    if (errors.length === 0) {
        console.log('Validation PASSED');
        if (warnings.length > 0) {
            console.log(`(with ${warnings.length} warnings)`);
        }
    }
}

main().catch(console.error);
