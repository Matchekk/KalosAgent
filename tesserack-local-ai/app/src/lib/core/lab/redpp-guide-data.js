/** Convert the canonical Red++ guide data into the graph and bundle shapes used by the Lab UI. */

export function redppGuideToGraph(guide) {
    if (!guide?.sections || !Array.isArray(guide.sections)) return { meta: guide?.meta || {}, nodes: [], edges: [] };

    const nodes = [];
    const edges = [];
    const locations = new Map();

    for (const section of guide.sections) {
        for (const entry of section.locations || []) {
            const key = normalize(entry.name);
            if (!locations.has(key)) {
                const node = {
                    id: `location_${slug(entry.name)}`,
                    type: 'location',
                    name: entry.name,
                    locationType: entry.locationType || inferLocationType(entry.name),
                    description: entry.summary || '',
                    section: section.title,
                    source: guide.meta?.title,
                };
                locations.set(key, node);
                nodes.push(node);
            }
        }
    }

    for (const section of guide.sections) {
        for (const entry of section.locations || []) {
            const location = locations.get(normalize(entry.name));
            for (const [index, objective] of (entry.objectives || []).entries()) {
                const item = typeof objective === 'string' ? { name: objective } : objective;
                const node = {
                    // A city can legitimately occur in more than one guide
                    // section (Viridian before Brock and before the League,
                    // for example). Include the section in child IDs so later
                    // visits cannot alias the first visit's objective.
                    id: `objective_${slug(section.id)}_${slug(entry.name)}_${index}`,
                    type: 'objective',
                    name: item.name,
                    description: item.description || '',
                    location: entry.name,
                    requiredForChampion: item.requiredForChampion !== false,
                    sourceSection: section.id,
                };
                nodes.push(node);
                edges.push({ from: location.id, to: node.id, type: 'contains' });
            }
            for (const [index, item] of (entry.items || []).entries()) {
                const value = typeof item === 'string' ? { name: item } : item;
                const node = {
                    id: `item_${slug(section.id)}_${slug(entry.name)}_${index}`,
                    type: 'item',
                    name: value.name,
                    howToGet: value.howToGet || entry.summary || '',
                };
                nodes.push(node);
                edges.push({ from: location.id, to: node.id, type: 'contains' });
            }
            for (const [index, species] of (entry.encounters || []).entries()) {
                const node = {
                    id: `pokemon_${slug(section.id)}_${slug(entry.name)}_${index}`,
                    type: 'pokemon',
                    name: species,
                    location: entry.name,
                    optionalCollection: true,
                };
                nodes.push(node);
                edges.push({ from: location.id, to: node.id, type: 'has_pokemon' });
            }
            for (const nextName of entry.nextLocations || []) {
                const target = locations.get(normalize(nextName));
                if (target) edges.push({ from: location.id, to: target.id, type: 'leads_to', method: 'walk/HM' });
            }
        }
    }

    return {
        meta: guide.meta || {},
        championRoute: guide.championRoute || [],
        runtimeRoute: guide.runtimeRoute || [],
        nodes,
        edges,
    };
}

export function redppGuideToBundles(guide) {
    const bundles = {
        _default: {
            source: guide?.meta?.title || 'Red++ Oak Guide',
            guide_version: guide?.meta?.sourceGuideVersion || 'unknown',
            target_rom_version: guide?.meta?.targetRomVersion || 'unknown',
            compatibility: guide?.meta?.compatibility || '',
            objectives: (guide?.championRoute || []).map(step => step.objective),
            next_locations: [],
            tests: [],
            penalties: [],
        },
    };

    for (const section of guide?.sections || []) {
        for (const entry of section.locations || []) {
            const key = normalize(entry.name);
            const existing = bundles[key];
            bundles[key] = {
                source: guide.meta?.title || 'Red++ Oak Guide',
                guide_version: guide.meta?.sourceGuideVersion || 'unknown',
                target_rom_version: guide.meta?.targetRomVersion || 'unknown',
                section: existing ? `${existing.section}; ${section.title}` : section.title,
                dex_target: section.dexTarget ?? null,
                objectives: unique([
                    ...(existing?.objectives || []),
                    ...(entry.objectives || []).map(item => typeof item === 'string' ? item : item.name),
                ]),
                next_locations: unique([...(existing?.next_locations || []), ...(entry.nextLocations || [])]),
                encounters: unique([...(existing?.encounters || []), ...(entry.encounters || [])]),
                notes: [existing?.notes, entry.summary].filter(Boolean).join(' '),
                tests: [],
                penalties: [],
            };
        }
    }
    return bundles;
}

function unique(values) {
    return [...new Set(values)];
}

function normalize(value) {
    return String(value || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
}

function slug(value) {
    return normalize(value).toLowerCase().replace(/\s+/g, '_');
}

function inferLocationType(name) {
    if (/ROUTE/i.test(name)) return 'route';
    if (/CITY|TOWN|ISLAND|PLATEAU/i.test(name)) return 'city';
    return 'dungeon';
}
