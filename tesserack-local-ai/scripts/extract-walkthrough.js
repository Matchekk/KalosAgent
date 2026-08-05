#!/usr/bin/env node
/**
 * Extract structured walkthrough data from Prima Pokemon Red/Blue guide
 *
 * Usage: node scripts/extract-walkthrough.js
 *
 * Requires: ANTHROPIC_API_KEY environment variable
 * Output: data/walkthrough-graph.json
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

// Known locations for validation
const KNOWN_LOCATIONS = [
  'Pallet Town', 'Route 1', 'Viridian City', 'Route 2', 'Viridian Forest',
  'Pewter City', 'Route 3', 'Mt. Moon', 'Route 4', 'Cerulean City',
  'Route 24', 'Route 25', 'Route 5', 'Underground Path', 'Route 6',
  'Vermilion City', 'Route 11', "Diglett's Cave", 'Route 9', 'Route 10',
  'Rock Tunnel', 'Lavender Town', 'Pokemon Tower', 'Route 8', 'Route 7',
  'Saffron City', 'Celadon City', 'Route 16', 'Route 17', 'Route 18',
  'Fuchsia City', 'Safari Zone', 'Route 15', 'Route 14', 'Route 13',
  'Route 12', 'Power Plant', 'Seafoam Islands', 'Route 19', 'Route 20',
  'Cinnabar Island', 'Pokemon Mansion', 'Route 21', 'Route 22', 'Route 23',
  'Victory Road', 'Indigo Plateau'
];

const KNOWN_GYMS = [
  { city: 'Pewter City', leader: 'Brock', badge: 'Boulder Badge', type: 'Rock' },
  { city: 'Cerulean City', leader: 'Misty', badge: 'Cascade Badge', type: 'Water' },
  { city: 'Vermilion City', leader: 'Lt. Surge', badge: 'Thunder Badge', type: 'Electric' },
  { city: 'Celadon City', leader: 'Erika', badge: 'Rainbow Badge', type: 'Grass' },
  { city: 'Fuchsia City', leader: 'Koga', badge: 'Soul Badge', type: 'Poison' },
  { city: 'Saffron City', leader: 'Sabrina', badge: 'Marsh Badge', type: 'Psychic' },
  { city: 'Cinnabar Island', leader: 'Blaine', badge: 'Volcano Badge', type: 'Fire' },
  { city: 'Viridian City', leader: 'Giovanni', badge: 'Earth Badge', type: 'Ground' },
];

/**
 * Split guide text into sections by location and merge duplicates
 */
function splitIntoSections(text) {
  const sectionMap = new Map(); // name -> combined text
  const lines = text.split('\n');

  let currentSection = null;
  let currentLines = [];

  // Patterns that indicate a new location section
  const locationPatterns = [
    /^(Pallet Town|Viridian City|Pewter City|Cerulean City|Vermilion City)/i,
    /^(Lavender Town|Celadon City|Fuchsia City|Saffron City|Cinnabar Island)/i,
    /^(Route \d+)/i,
    /^(Mt\. Moon|Rock Tunnel|Victory Road|Pokemon Tower|Safari Zone)/i,
    /^(Viridian Forest|Diglett'?s Cave|Seafoam Islands|Power Plant|Pokemon Mansion)/i,
    /^(Indigo Plateau)/i,
  ];

  // Normalize location names
  function normalizeName(name) {
    return name.toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/^route\s+(\d+)$/i, 'Route $1')
      .replace(/^mt\.\s*/i, 'Mt. ')
      .replace(/^pokemon\s+/i, 'Pokemon ')
      .replace(/^(pallet|viridian|pewter|cerulean|vermilion|lavender|celadon|fuchsia|saffron)\s+(town|city)/i,
        (_, c, t) => c.charAt(0).toUpperCase() + c.slice(1).toLowerCase() + ' ' + t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
      );
  }

  function saveCurrentSection() {
    if (currentSection && currentLines.length > 10) {
      const normalized = normalizeName(currentSection);
      const existing = sectionMap.get(normalized) || '';
      sectionMap.set(normalized, existing + '\n\n---\n\n' + currentLines.join('\n'));
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Check if this line starts a new section
    let newSectionName = null;

    for (const pattern of locationPatterns) {
      const match = trimmed.match(pattern);
      if (match && trimmed.length < 50) { // Avoid matching mid-sentence
        newSectionName = match[1];
        break;
      }
    }

    if (newSectionName) {
      saveCurrentSection();
      currentSection = newSectionName;
      currentLines = [line];
    } else {
      currentLines.push(line);
    }
  }

  // Don't forget the last section
  saveCurrentSection();

  // Convert map to array, sorted by approximate game order
  const gameOrder = [
    'Pallet Town', 'Route 1', 'Viridian City', 'Route 22', 'Route 2',
    'Viridian Forest', 'Pewter City', 'Route 3', 'Mt. Moon', 'Route 4',
    'Cerulean City', 'Route 24', 'Route 25', 'Route 5', 'Route 6',
    'Vermilion City', 'Route 11', "Diglett's Cave", 'Route 9', 'Route 10',
    'Rock Tunnel', 'Lavender Town', 'Pokemon Tower', 'Route 8', 'Route 7',
    'Saffron City', 'Celadon City', 'Route 16', 'Route 17', 'Route 18',
    'Fuchsia City', 'Safari Zone', 'Route 15', 'Route 14', 'Route 13',
    'Route 12', 'Power Plant', 'Seafoam Islands', 'Route 19', 'Route 20',
    'Cinnabar Island', 'Pokemon Mansion', 'Route 21', 'Route 23',
    'Victory Road', 'Indigo Plateau'
  ];

  const sections = [];
  for (const name of gameOrder) {
    if (sectionMap.has(name)) {
      sections.push({ name, text: sectionMap.get(name) });
      sectionMap.delete(name);
    }
  }

  // Add any remaining sections not in game order
  for (const [name, text] of sectionMap) {
    sections.push({ name, text });
  }

  return sections;
}

/**
 * Call Claude API to extract structured data from a section
 */
async function extractWithLLM(sectionName, sectionText) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable required');
  }

  const prompt = `Extract structured data from this Pokemon Red/Blue strategy guide section about "${sectionName}".

TEXT:
${sectionText.slice(0, 8000)}

Return ONLY valid JSON (no markdown, no explanation) with this structure:
{
  "location": {
    "name": "string - the location name",
    "type": "city|route|dungeon|building",
    "description": "string - brief description"
  },
  "objectives": [
    {
      "name": "string - objective name",
      "description": "string - how to complete it",
      "prerequisites": ["string - required items/badges/events"]
    }
  ],
  "items": [
    {
      "name": "string - item name",
      "how_to_get": "string - how to obtain it"
    }
  ],
  "pokemon": [
    {
      "name": "string - pokemon name",
      "availability": "common|uncommon|rare",
      "version": "both|red|blue",
      "notes": "string - any special notes"
    }
  ],
  "connections": [
    {
      "to": "string - connected location name",
      "method": "walk|surf|fly|teleport",
      "requirements": ["string - what's needed to access"]
    }
  ],
  "trainers": [
    {
      "name": "string - trainer name or type",
      "is_gym_leader": boolean,
      "badge": "string - badge name if gym leader"
    }
  ]
}

If a field has no data, use an empty array []. Be thorough but only include information actually present in the text.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  const content = data.content[0].text;

  // Parse JSON from response
  try {
    return JSON.parse(content);
  } catch (e) {
    // Try to extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    console.error(`Failed to parse JSON for ${sectionName}:`, content.slice(0, 200));
    return null;
  }
}

/**
 * Build graph from extracted sections
 */
function buildGraph(extractedSections) {
  const nodes = [];
  const edges = [];
  const nodeMap = new Map();

  let nodeId = 0;

  // Helper to add a node
  function addNode(type, name, data = {}) {
    const key = `${type}:${name}`;
    if (nodeMap.has(key)) {
      return nodeMap.get(key);
    }
    const id = `${type}_${nodeId++}`;
    const node = { id, type, name, ...data };
    nodes.push(node);
    nodeMap.set(key, id);
    return id;
  }

  // Process each section
  for (const section of extractedSections) {
    if (!section.extracted) continue;
    const data = section.extracted;

    // Add location node
    const locId = addNode('location', data.location?.name || section.name, {
      locationType: data.location?.type,
      description: data.location?.description
    });

    // Add objectives
    for (const obj of (data.objectives || [])) {
      const objId = addNode('objective', obj.name, {
        description: obj.description,
        location: data.location?.name
      });
      edges.push({ from: locId, to: objId, type: 'contains' });

      // Add prerequisite edges
      for (const prereq of (obj.prerequisites || [])) {
        const prereqId = addNode('requirement', prereq);
        edges.push({ from: prereqId, to: objId, type: 'requires' });
      }
    }

    // Add items
    for (const item of (data.items || [])) {
      const itemId = addNode('item', item.name, {
        howToGet: item.how_to_get
      });
      edges.push({ from: locId, to: itemId, type: 'contains' });
    }

    // Add pokemon
    for (const poke of (data.pokemon || [])) {
      const pokeId = addNode('pokemon', poke.name, {
        availability: poke.availability,
        version: poke.version,
        notes: poke.notes
      });
      edges.push({ from: locId, to: pokeId, type: 'has_pokemon' });
    }

    // Add connections
    for (const conn of (data.connections || [])) {
      const toId = addNode('location', conn.to);
      edges.push({
        from: locId,
        to: toId,
        type: 'leads_to',
        method: conn.method,
        requirements: conn.requirements
      });
    }

    // Add trainers
    for (const trainer of (data.trainers || [])) {
      const trainerId = addNode('trainer', trainer.name, {
        isGymLeader: trainer.is_gym_leader,
        badge: trainer.badge
      });
      edges.push({ from: locId, to: trainerId, type: 'has_trainer' });
    }
  }

  return { nodes, edges };
}

/**
 * Validate graph against known game data
 */
function validateGraph(graph) {
  const issues = [];

  const locationNodes = graph.nodes.filter(n => n.type === 'location');
  const locationNames = locationNodes.map(n => n.name.toLowerCase());

  // Check for known locations
  for (const known of KNOWN_LOCATIONS) {
    if (!locationNames.some(name => name.includes(known.toLowerCase()))) {
      issues.push(`Missing location: ${known}`);
    }
  }

  // Check for gym leaders
  const trainerNodes = graph.nodes.filter(n => n.type === 'trainer');
  for (const gym of KNOWN_GYMS) {
    if (!trainerNodes.some(t => t.name.toLowerCase().includes(gym.leader.toLowerCase()))) {
      issues.push(`Missing gym leader: ${gym.leader}`);
    }
  }

  return {
    valid: issues.length < 10, // Allow some missing data
    issues,
    stats: {
      locations: locationNodes.length,
      objectives: graph.nodes.filter(n => n.type === 'objective').length,
      items: graph.nodes.filter(n => n.type === 'item').length,
      pokemon: graph.nodes.filter(n => n.type === 'pokemon').length,
      trainers: trainerNodes.length,
      edges: graph.edges.length
    }
  };
}

/**
 * Main extraction pipeline
 */
async function main() {
  console.log('Pokemon Red/Blue Strategy Guide Extraction');
  console.log('==========================================\n');

  // Read guide text
  const guidePath = path.join(DATA_DIR, 'prima-guide-text.txt');
  if (!fs.existsSync(guidePath)) {
    console.error('Guide text not found. Run: curl to download first.');
    process.exit(1);
  }

  const guideText = fs.readFileSync(guidePath, 'utf-8');
  console.log(`Loaded guide: ${guideText.length} characters\n`);

  // Split into sections
  console.log('Splitting into sections...');
  const sections = splitIntoSections(guideText);
  console.log(`Found ${sections.length} sections:\n`);

  for (const section of sections) {
    console.log(`  - ${section.name} (${section.text.length} chars)`);
  }

  // Extract data from each section
  console.log('\nExtracting structured data with LLM...\n');

  const extractedSections = [];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    process.stdout.write(`  [${i + 1}/${sections.length}] ${section.name}...`);

    try {
      const extracted = await extractWithLLM(section.name, section.text);
      extractedSections.push({ ...section, extracted });
      console.log(' done');

      // Rate limiting
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      console.log(` error: ${err.message}`);
      extractedSections.push({ ...section, extracted: null, error: err.message });
    }
  }

  // Build graph
  console.log('\nBuilding graph...');
  const graph = buildGraph(extractedSections);

  // Validate
  console.log('Validating...');
  const validation = validateGraph(graph);

  console.log('\nStats:');
  console.log(`  Locations: ${validation.stats.locations}`);
  console.log(`  Objectives: ${validation.stats.objectives}`);
  console.log(`  Items: ${validation.stats.items}`);
  console.log(`  Pokemon: ${validation.stats.pokemon}`);
  console.log(`  Trainers: ${validation.stats.trainers}`);
  console.log(`  Edges: ${validation.stats.edges}`);

  if (validation.issues.length > 0) {
    console.log(`\nValidation issues (${validation.issues.length}):`);
    for (const issue of validation.issues.slice(0, 10)) {
      console.log(`  - ${issue}`);
    }
  }

  // Save output
  const outputPath = path.join(DATA_DIR, 'walkthrough-graph.json');
  fs.writeFileSync(outputPath, JSON.stringify(graph, null, 2));
  console.log(`\nSaved to: ${outputPath}`);

  // Also save raw extraction for debugging
  const rawPath = path.join(DATA_DIR, 'walkthrough-raw.json');
  fs.writeFileSync(rawPath, JSON.stringify(extractedSections, null, 2));
  console.log(`Raw extractions: ${rawPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
