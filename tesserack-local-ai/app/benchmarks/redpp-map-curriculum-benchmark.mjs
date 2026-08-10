import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    chooseCheckpointCandidate,
    compareProgressStates,
} from '../src/lib/core/lab/parallel-training.js';
import { redppGuideToGraph } from '../src/lib/core/lab/redpp-guide-data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guide = JSON.parse(fs.readFileSync(path.join(root, 'static/data/redpp-oak-guide.json'), 'utf8'));
const graphSource = fs.readFileSync(path.join(root, 'src/lib/components/lab/WalkthroughGraph.svelte'), 'utf8');
const labViewSource = fs.readFileSync(path.join(root, 'src/lib/components/lab/LabView.svelte'), 'utf8');
const agentSource = fs.readFileSync(path.join(root, 'src/lib/core/lab/pure-rl-agent.js'), 'utf8');

let locationData = {};
let objectiveProgress = {};
try {
    locationData = await import('../src/lib/core/lab/redpp-location-data.js');
    objectiveProgress = await import('../src/lib/core/lab/redpp-objective-progress.js');
} catch {
    // The frozen baseline intentionally predates the canonical location layer.
}

const resolve = locationData.resolveRedppLocation || (name => ({ exactLocation: name, guideLocation: name, progressOrder: 0 }));
const progress = locationData.getRedppLocationProgress || (() => 0);
const deriveObjectives = objectiveProgress.deriveRedppGuideObjectives || (() => new Set());
const objectiveNames = objectiveProgress.REDPP_PROVABLE_OBJECTIVES || {};
const checks = [];

function check(name, predicate, detail = '') {
    let passed = false;
    let error = '';
    try {
        passed = Boolean(predicate());
    } catch (caught) {
        error = caught?.message || String(caught);
    }
    checks.push({ name, passed, detail: error || detail });
}

check('canonical Red++ location resolver exists', () => typeof locationData.resolveRedppLocation === 'function');
check('Players House 2F remains the exact displayed RAM location', () => resolve('PLAYERS HOUSE 2F').exactLocation === 'Players House 2F');
check('Players House 2F maps to Pallet only as its guide parent', () => resolve('PLAYERS HOUSE 2F').guideLocation === 'Pallet Town');
check('Players House 1F advances beyond 2F', () => progress('PLAYERS HOUSE 1F') > progress('PLAYERS HOUSE 2F'));
check('Pallet Town outdoors advances beyond the house', () => progress('PALLET TOWN') > progress('PLAYERS HOUSE 1F'));
check('Route 1 advances beyond Pallet Town', () => progress('ROUTE 1') > progress('PALLET TOWN'));
check('Viridian City advances beyond Route 1', () => progress('VIRIDIAN CITY') > progress('ROUTE 1'));
check('Route 2 advances beyond Viridian City', () => progress('ROUTE 2') > progress('VIRIDIAN CITY'));
check('Viridian Forest advances beyond Route 2', () => progress('VIRIDIAN FOREST') > progress('ROUTE 2'));
check('Pewter City advances beyond Viridian Forest', () => progress('PEWTER CITY') > progress('VIRIDIAN FOREST'));
check('Pewter Gym advances beyond Pewter City', () => progress('PEWTER GYM') > progress('PEWTER CITY'));
check('unknown RAM locations remain exact instead of becoming Pallet Town', () => resolve('UNKNOWN TEST MAP').exactLocation === 'Unknown Test Map' && resolve('UNKNOWN TEST MAP').guideLocation === 'Unknown Test Map');

check('guide declares an exact early-game runtime route through Pewter Gym', () => {
    const names = (guide.runtimeRoute || []).map(entry => entry.name);
    return ['Players House 2F', 'Players House 1F', 'Pallet Town', 'Route 1', 'Viridian City', 'Route 2', 'Viridian Forest', 'Pewter City', 'Pewter Gym']
        .every(name => names.includes(name));
});
check('runtime route entries explain observable progress', () => (guide.runtimeRoute || []).every(entry => entry.summary && entry.observable));
check('guide graph preserves runtime route metadata', () => redppGuideToGraph(guide).runtimeRoute?.length === guide.runtimeRoute?.length && guide.runtimeRoute?.length > 0);

check('equal-party progress ranks Pallet Town above Players House 2F', () => compareProgressStates(
    { location: 'PALLET TOWN', party: [] },
    { location: 'PLAYERS HOUSE 2F', party: [] },
) > 0);
check('a legitimately chosen starter outranks a later no-party map', () => compareProgressStates(
    { location: 'PLAYERS HOUSE 2F', party: [{ level: 5 }] },
    { location: 'PEWTER GYM', party: [] },
) > 0);
check('a badge outranks pre-badge location progress', () => compareProgressStates(
    { location: 'PALLET TOWN', badgeCount: 1, party: [{ level: 5 }] },
    { location: 'PEWTER GYM', badgeCount: 0, party: [{ level: 50 }] },
) > 0);
check('checkpoint selection chooses earned later location, not larger reward', () => chooseCheckpointCandidate(
    { steps: 100, reward: 999, state: { location: 'PLAYERS HOUSE 2F', party: [] } },
    [{ steps: 200, reward: -10, state: { location: 'PALLET TOWN', party: [] } }],
)?.state?.location === 'PALLET TOWN');
check('agent treats increasing mapped location as durable progress', () => /compareProgressStates\(curr, prev\)\s*>\s*0/.test(agentSource));
check('map UI separates exact location display from guide-parent centering', () => graphSource.includes('exactLocation') && graphSource.includes('guideLocation'));
check('Lab guide context resolves exact RAM location through the canonical mapper', () => labViewSource.includes('resolveRedppLocation') && labViewSource.includes('exactLocation'));
check('Train map derives objective completion from visible worker RAM', () => labViewSource.includes('deriveRedppGuideObjectives') && labViewSource.includes('$pureRLMetrics.visibleState'));
check('Train map labels the visible worker separately from fresh-ROM proof', () => labViewSource.includes('visible E${$pureRLMetrics.visibleWorker + 1}') && labViewSource.includes('fresh-ROM proof is measured separately'));
check('credible party proves starter selection without claiming Viridian', () => {
    const completed = deriveObjectives({ location: 'PALLET TOWN', party: [{ speciesId: 1, level: 5 }] });
    return completed.has(objectiveNames.starter) && !completed.has(objectiveNames.viridian);
});
check('standing in Viridian cannot falsely prove parcel delivery', () => {
    const completed = deriveObjectives({
        location: 'VIRIDIAN CITY',
        party: [{ speciesId: 1, level: 5 }],
        progressFlags: { battledRivalInOaksLab: true },
    });
    return completed.has(objectiveNames.viridian) && !completed.has(objectiveNames.oakSequence);
});
check('northbound Route 2 with durable opening flag proves Oak sequence', () => deriveObjectives({
    location: 'ROUTE 2',
    party: [{ speciesId: 1, level: 5 }],
    progressFlags: { battledRivalInOaksLab: true },
}).has(objectiveNames.oakSequence));
check('Brock objective requires the Boulder badge RAM bit', () => {
    const before = deriveObjectives({ location: 'PEWTER GYM', party: [{ speciesId: 1, level: 8 }], badges: [] });
    const after = deriveObjectives({ location: 'PEWTER GYM', party: [{ speciesId: 1, level: 8 }], badges: ['Boulder'] });
    return !before.has(objectiveNames.boulder) && after.has(objectiveNames.boulder);
});

const passed = checks.filter(item => item.passed).length;
const total = checks.length;
const score = Number(((passed / total) * 100).toFixed(3));
console.log(JSON.stringify({ passed, total, score, checks }, null, 2));
console.log(`METRIC map_curriculum_quality_pct=${score}`);
