/**
 * Load and process the walkthrough graph data
 */

import { assetUrl } from '../asset-url.js';
import { redppGuideToGraph } from './redpp-guide-data.js';
import { resolveRedppLocation } from './redpp-location-data.js';

// Import the static graph data
// Note: Vite handles JSON imports
let graphData = { nodes: [], edges: [] };

// Load graph data (will be populated on first access)
async function loadGraphData() {
    if (graphData.nodes.length > 0) return graphData;
    try {
        const response = await fetch(assetUrl('data/redpp-oak-guide.json'));
        graphData = redppGuideToGraph(await response.json());
    } catch (e) {
        console.error('Failed to load walkthrough graph:', e);
    }
    return graphData;
}

// Synchronous access (assumes data is loaded)
export { graphData };

/**
 * Get the full walkthrough graph
 * @returns {{nodes: Array, edges: Array}}
 */
export function getWalkthroughGraph() {
    return graphData;
}

/**
 * Get all locations from the graph
 * @returns {Array}
 */
export function getLocations() {
    return graphData.nodes.filter(n => n.type === 'location');
}

/**
 * Get all objectives from the graph
 * @returns {Array}
 */
export function getObjectives() {
    return graphData.nodes.filter(n => n.type === 'objective');
}

/**
 * Get all gym leaders from the graph
 * @returns {Array}
 */
export function getGymLeaders() {
    return graphData.nodes.filter(n => n.type === 'trainer' && n.isGymLeader);
}

/**
 * Get node by name
 * @param {string} name
 * @returns {Object|null}
 */
export function getNodeByName(name) {
    return graphData.nodes.find(n =>
        n.name.toLowerCase() === name.toLowerCase()
    ) || null;
}

/**
 * Get all nodes connected to a location
 * @param {string} locationName
 * @returns {{objectives: Array, items: Array, pokemon: Array, connections: Array}}
 */
export function getLocationDetails(locationName) {
    const { guideLocation } = resolveRedppLocation(locationName);
    const location = graphData.nodes.find(n =>
        n.type === 'location' && n.name.toLowerCase() === guideLocation.toLowerCase()
    );

    if (!location) return null;

    const objectives = [];
    const items = [];
    const pokemon = [];
    const connections = [];

    for (const edge of graphData.edges) {
        if (edge.from === location.id) {
            const target = graphData.nodes.find(n => n.id === edge.to);
            if (!target) continue;

            switch (edge.type) {
                case 'contains':
                    if (target.type === 'objective') objectives.push(target);
                    else if (target.type === 'item') items.push(target);
                    break;
                case 'has_pokemon':
                    pokemon.push(target);
                    break;
                case 'leads_to':
                    connections.push({ ...target, method: edge.method });
                    break;
            }
        }
    }

    return { location, objectives, items, pokemon, connections };
}

/**
 * Get the next objective in the walkthrough based on current state
 * @param {string} currentLocation
 * @param {Set<string>} completedObjectives
 * @returns {Object|null}
 */
export function getNextObjective(currentLocation, completedObjectives) {
    // Get objectives for current location that aren't completed
    const details = getLocationDetails(currentLocation);
    if (!details) return null;

    for (const obj of details.objectives) {
        if (!completedObjectives.has(obj.name)) {
            return obj;
        }
    }

    // If all local objectives done, suggest moving to next location
    for (const conn of details.connections) {
        const nextDetails = getLocationDetails(conn.name);
        if (nextDetails) {
            for (const obj of nextDetails.objectives) {
                if (!completedObjectives.has(obj.name)) {
                    return { ...obj, suggestedLocation: conn.name };
                }
            }
        }
    }

    return null;
}

/**
 * Build context string for LLM from current game state
 * @param {string} currentLocation
 * @param {Set<string>} completedObjectives
 * @returns {string}
 */
export function buildGuideContext(currentLocation, completedObjectives) {
    const details = getLocationDetails(currentLocation);
    if (!details) return '';

    const lines = [];
    const { exactLocation, guideLocation } = resolveRedppLocation(currentLocation);
    lines.push(`[RED++ RAM LOCATION - ${exactLocation}]`);
    lines.push(`[RED++ GUIDE CONTEXT - ${guideLocation}]`);

    if (details.location.description) {
        lines.push(details.location.description);
    }

    const pendingObjectives = details.objectives.filter(o => !completedObjectives.has(o.name));
    if (pendingObjectives.length > 0) {
        lines.push('\nObjectives:');
        for (const obj of pendingObjectives) {
            lines.push(`- ${obj.name}: ${obj.description || ''}`);
        }
    }

    if (details.items.length > 0) {
        lines.push('\nItems available:');
        for (const item of details.items.slice(0, 5)) {
            lines.push(`- ${item.name}: ${item.howToGet || ''}`);
        }
    }

    if (details.connections.length > 0) {
        lines.push('\nConnections:');
        for (const conn of details.connections) {
            lines.push(`- ${conn.name} (${conn.method || 'walk'})`);
        }
    }

    return lines.join('\n');
}

/**
 * Check if an objective matches game state (for reward calculation)
 * @param {string} objectiveName
 * @param {Object} prevState
 * @param {Object} currentState
 * @returns {boolean}
 */
export function checkObjectiveCompletion(objectiveName, prevState, currentState) {
    const lowerName = objectiveName.toLowerCase();

    // Badge-related objectives
    if (lowerName.includes('brock') || lowerName.includes('boulder badge')) {
        return currentState.badges?.includes('BOULDER') && !prevState.badges?.includes('BOULDER');
    }
    if (lowerName.includes('misty') || lowerName.includes('cascade badge')) {
        return currentState.badges?.includes('CASCADE') && !prevState.badges?.includes('CASCADE');
    }

    // Location-related objectives
    if (lowerName.includes('reach') || lowerName.includes('get to')) {
        const targetLocation = objectiveName.replace(/reach|get to/gi, '').trim();
        return currentState.location?.toLowerCase().includes(targetLocation.toLowerCase());
    }

    // Pokemon-related objectives
    if (lowerName.includes('choose') && lowerName.includes('pokemon')) {
        return currentState.party?.length > 0 && prevState.party?.length === 0;
    }

    // Item-related objectives
    if (lowerName.includes('parcel')) {
        return currentState.items?.some(i => i.name?.includes('PARCEL'));
    }
    if (lowerName.includes('pokedex')) {
        // Could check for Pokedex in items or other state
        return false; // Would need game-specific check
    }

    return false;
}
