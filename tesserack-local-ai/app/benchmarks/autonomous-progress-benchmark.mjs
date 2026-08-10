import { readFile } from 'node:fs/promises';

import {
    AUTONOMOUS_TARGET_LEVEL,
    AutonomousProgressTracker,
    detectAutonomousMilestone,
} from '../src/lib/core/lab/autonomous-progress.js';
import { UnitTestRewards } from '../src/lib/core/lab/unit-test-rewards.js';

const ui = await readFile(new URL('../src/lib/components/lab/LabView.svelte', import.meta.url), 'utf8');
const coordinator = await readFile(new URL('../src/lib/core/lab/parallel-trainer.js', import.meta.url), 'utf8');
const checks = [];
const check = (name, condition) => checks.push({ name, passed: Boolean(condition) });
const state = (overrides = {}) => ({
    location: 'PLAYERS HOUSE 2F',
    coordinates: { x: 3, y: 6 },
    badgeCount: 0,
    party: [],
    progressFlags: { battledRivalInOaksLab: false },
    inBattle: false,
    dialog: '',
    menu: { open: false },
    ...overrides,
});
const starter = [{ speciesId: 7, level: 5, currentHP: 20, maxHP: 20 }];

check('NO ACTIVE MAP scores zero', detectAutonomousMilestone(state({ location: 'NO ACTIVE MAP' })) === 0);
check('starter requires credible party RAM', detectAutonomousMilestone(state({ location: 'OAKS LAB', party: starter })) === 5);
check('Route 1 requires Oak rival evidence', detectAutonomousMilestone(state({ location: 'ROUTE 1', party: starter })) === 5);
check('Boulder Badge is the configured proof target', AUTONOMOUS_TARGET_LEVEL === 13);

const tracker = new AutonomousProgressTracker({ freshWorkerId: 3, stableObservations: 1 });
const badge = state({ location: 'PEWTER GYM', party: starter, badgeCount: 1 });
tracker.observe({ workerId: 1, state: badge, episode: 1, totalSamples: 1 });
check('checkpoint workers do not prove clean-start ability', tracker.summary(1).targetSuccesses === 0);
for (let episode = 1; episode <= 3; episode++) {
    tracker.observe({ workerId: 3, state: badge, episode, totalSamples: episode + 1 });
}
check('three fresh starts verify Badge 1', tracker.summary(4).targetProven === true);
check('proof snapshot round-trips', new AutonomousProgressTracker({ stableObservations: 1 })
    .restoreSnapshot(tracker.exportSnapshot()) === true);

const inactiveRewards = new UnitTestRewards().evaluate(
    state({ location: 'NO ACTIVE MAP' }),
    state({ location: 'NO ACTIVE MAP' }),
    'down',
);
check('inactive screens have zero shaping reward', inactiveRewards.total === 0 && inactiveRewards.context === 'inactive');
check('coordinator observes every worker outcome', /autonomousProgress\.observe/.test(coordinator));
check('coordinator labels the reset-from-initial worker', /resetFromInitial/.test(coordinator));
check('UI states the no-checkpoint proof contract', /fresh ROM, no checkpoint restore/.test(ui));
check('UI distinguishes best from verified', /Best fresh start/.test(ui) && />Verified</.test(ui));
check('UI exposes an explicit unproven verdict', /UNPROVEN/.test(ui));

const passed = checks.filter(item => item.passed).length;
const score = Number(((passed / checks.length) * 100).toFixed(3));
console.log(JSON.stringify({ passed, total: checks.length, score, checks }, null, 2));
console.log(`METRIC autonomy_metric_quality_pct=${score}`);
