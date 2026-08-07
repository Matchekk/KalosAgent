/**
 * Canonical Red++ v3.0.2 location semantics.
 *
 * `exactLocation` is the RAM map and must be shown to the user unchanged.
 * `guideLocation` is only the containing world-map/guide node. `progressOrder`
 * is a conservative, champion-directed curriculum rank; it is never inferred
 * from a fuzzy substring and therefore cannot turn an unknown map into Pallet.
 */

const EXACT_NAMES = Object.freeze({
    'PLAYERS HOUSE 2F': 'Players House 2F',
    'PLAYERS HOUSE 1F': 'Players House 1F',
    'RIVALS HOUSE': 'Rivals House',
    'OAKS LAB': "Oak's Lab",
    'PALLET TOWN': 'Pallet Town',
    'ROUTE 1': 'Route 1',
    'VIRIDIAN CITY': 'Viridian City',
    'ROUTE 2': 'Route 2',
    'VIRIDIAN FOREST': 'Viridian Forest',
    'PEWTER CITY': 'Pewter City',
    'PEWTER GYM': 'Pewter Gym',
    'MT MOON 1F': 'Mt. Moon 1F',
    'MT MOON B1F': 'Mt. Moon B1F',
    'MT MOON B2F': 'Mt. Moon B2F',
    'SS ANNE 1F': 'S.S. Anne 1F',
    'HALL OF FAME': 'Hall of Fame',
    'CHAMPIONS ROOM': "Champion's Room",
});

const EXACT_GUIDE_PARENTS = Object.freeze({
    'PLAYERS HOUSE 2F': 'Pallet Town',
    'PLAYERS HOUSE 1F': 'Pallet Town',
    'RIVALS HOUSE': 'Pallet Town',
    'OAKS LAB': 'Pallet Town',
    'PEWTER GYM': 'Pewter City',
    'SS ANNE 1F': 'S.S. Anne',
    'HALL OF FAME': 'Indigo Plateau',
    'CHAMPIONS ROOM': 'Indigo Plateau',
});

// Ordered around real early-game transitions, then major Champion-route gates.
// Re-visiting an earlier city is not regression: the shared best checkpoint is
// monotonic, while party/badge/event dimensions outrank this location rank.
const PROGRESS_ORDER = Object.freeze({
    'PLAYERS HOUSE 2F': 0,
    'PLAYERS HOUSE 1F': 1,
    'RIVALS HOUSE': 2,
    'OAKS LAB': 2,
    // Leaving Oak's Lab is a distinct earned transition. Keeping Pallet tied
    // with the lab discarded that transition whenever an episode reset.
    'PALLET TOWN': 3,
    'ROUTE 1': 4,
    'VIRIDIAN CITY': 5,
    'ROUTE 22': 5,
    'ROUTE 2': 6,
    'VIRIDIAN FOREST': 7,
    'PEWTER CITY': 8,
    'PEWTER GYM': 9,
    'ROUTE 3': 10,
    'MT MOON': 11,
    'ROUTE 4': 12,
    'CERULEAN CITY': 13,
    'CERULEAN GYM': 14,
    'ROUTE 24': 15,
    'ROUTE 25': 16,
    'ROUTE 5': 17,
    'ROUTE 6': 18,
    'VERMILION CITY': 19,
    'SS ANNE': 20,
    'VERMILION GYM': 21,
    'ROUTE 9': 22,
    'ROUTE 10': 23,
    'ROCK TUNNEL': 24,
    'LAVENDER TOWN': 25,
    'CELADON CITY': 26,
    'ROCKET HIDEOUT': 27,
    'POKEMON TOWER': 28,
    'FUCHSIA CITY': 29,
    'SAFARI ZONE': 30,
    'FUCHSIA GYM': 31,
    'SAFFRON CITY': 32,
    'SILPH CO': 33,
    'SAFFRON GYM': 34,
    'CINNABAR ISLAND': 35,
    'POKEMON MANSION': 36,
    'CINNABAR GYM': 37,
    'VIRIDIAN GYM': 38,
    'VICTORY ROAD': 39,
    'INDIGO PLATEAU': 40,
    'HALL OF FAME': 41,
    'CHAMPIONS ROOM': 42,
});

const PREFIX_PARENTS = Object.freeze([
    ['VIRIDIAN ', 'Viridian City'],
    ['PEWTER ', 'Pewter City'],
    ['CERULEAN ', 'Cerulean City'],
    ['VERMILION ', 'Vermilion City'],
    ['CELADON ', 'Celadon City'],
    ['SAFFRON ', 'Saffron City'],
    ['LAVENDER ', 'Lavender Town'],
    ['FUCHSIA ', 'Fuchsia City'],
    ['CINNABAR ', 'Cinnabar Island'],
    ['POKEMONTOWER ', 'Pokemon Tower'],
    ['POKEMON TOWER ', 'Pokemon Tower'],
    ['MT MOON ', 'Mt. Moon'],
    ['ROCK TUNNEL ', 'Rock Tunnel'],
    ['VICTORY ROAD ', 'Victory Road'],
    ['SILPH CO ', 'Silph Co.'],
    ['ROCKET HIDEOUT ', 'Rocket Hideout'],
    ['SAFARI ZONE ', 'Safari Zone'],
    ['SEAFOAM ISLANDS ', 'Seafoam Islands'],
    ['SS ANNE ', 'S.S. Anne'],
]);

export const REDPP_RUNTIME_ROUTE = Object.freeze([
    'Players House 2F', 'Players House 1F', 'Pallet Town', 'Route 1',
    'Viridian City', 'Route 2', 'Viridian Forest', 'Pewter City', 'Pewter Gym',
]);

export function normalizeRedppLocation(name) {
    return String(name || '').trim().toUpperCase().replaceAll('_', ' ').replace(/\s+/g, ' ');
}

export function resolveRedppLocation(name) {
    const normalized = normalizeRedppLocation(name);
    if (!normalized) return Object.freeze({ exactLocation: '', guideLocation: '', progressOrder: 0, known: false });

    const exactLocation = EXACT_NAMES[normalized] || titleCaseLocation(normalized);
    let guideLocation = EXACT_GUIDE_PARENTS[normalized] || exactLocation;
    if (!EXACT_GUIDE_PARENTS[normalized]) {
        const prefix = PREFIX_PARENTS.find(([candidate]) => normalized.startsWith(candidate));
        if (prefix) guideLocation = prefix[1];
    }

    const progressKey = normalizeRedppLocation(guideLocation);
    const progressOrder = PROGRESS_ORDER[normalized] ?? PROGRESS_ORDER[progressKey] ?? 0;
    const known = normalized in EXACT_NAMES || progressOrder > 0 || guideLocation !== exactLocation;
    return Object.freeze({ exactLocation, guideLocation, progressOrder, known });
}

export function getRedppLocationProgress(name) {
    return resolveRedppLocation(name).progressOrder;
}

function titleCaseLocation(value) {
    return value.toLowerCase().replace(/(^|\s)([a-z])/g, (_, space, letter) => `${space}${letter.toUpperCase()}`)
        .replace(/\bSs Anne\b/g, 'S.S. Anne')
        .replace(/\bMt Moon\b/g, 'Mt. Moon')
        .replace(/\bPokemon\b/g, 'Pokemon');
}
