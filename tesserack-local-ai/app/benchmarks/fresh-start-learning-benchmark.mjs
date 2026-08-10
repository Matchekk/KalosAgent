import { adaptiveCoverageCoefficient, ReinforceCore } from '../src/lib/core/lab/reinforce-core.js';
import { PureRLAgent } from '../src/lib/core/lab/pure-rl-agent.js';
import { UnitTestRewards } from '../src/lib/core/lab/unit-test-rewards.js';

let passed = 0;
let total = 0;

function check(name, condition) {
    total++;
    const result = typeof condition === 'function' ? condition() : condition;
    if (result) passed++;
    console.log(`${result ? 'PASS' : 'FAIL'} ${name}`);
}

function world(location, x, y) {
    return {
        location,
        coordinates: { x, y },
        party: [],
        badgeCount: 0,
        progressFlags: {},
        menu: { open: false },
    };
}

const rewards = new UnitTestRewards();
const origin = world('PLAYERS HOUSE 2F', 2, 2);
const neighbour = world('PLAYERS HOUSE 2F', 3, 2);
rewards.evaluate(origin, origin, null);
const firstDiscovery = rewards.evaluate(origin, neighbour, 'right');
rewards.resetEpisodeState();
rewards.evaluate(origin, origin, null);
const repeatedDiscovery = rewards.evaluate(origin, neighbour, 'right');
check('a globally familiar tile is not re-awarded after reset',
    firstDiscovery.total > 0 && repeatedDiscovery.total <= 0);

const inactive = { location: 'NO ACTIVE MAP', coordinates: { x: 0, y: 0 }, party: [] };
const active = world('PLAYERS HOUSE 2F', 2, 2);
const bootRewards = new UnitTestRewards();
const bootTransition = bootRewards.evaluate(inactive, active, 'start');
check('entering the first active RAM map provides boot credit', bootTransition.total > 0);

const core = new ReinforceCore({
    stateSize: 1,
    numActions: 2,
    rolloutSize: 4,
    intrinsicRewardScale: 0.02,
    intrinsicRewardCap: 0.02,
});
const state = new Float32Array([0]);
core.observe(state, 0, 0, true, 0, 0, 0, 0, 'same-cell');
const firstIntrinsic = core.buffer.intrinsicRewards[0];
core.observe(state, 0, 0, true, 0, 0, 0, 0, 'same-cell');
const secondIntrinsic = core.buffer.intrinsicRewards[1];
check('intrinsic novelty decays across episodes', secondIntrinsic < firstIntrinsic);

const agent = new PureRLAgent({}, {});
check('production action coverage is adaptive rather than a permanent probability floor',
    adaptiveCoverageCoefficient({
        probabilities: Array.from({ length: agent.core.numActions }, () => 1 / agent.core.numActions),
        coefficient: agent.core.actionCoverageCoefficient,
        minimumProbability: agent.core.minimumActionProbability,
    }) === 0
    && agent.core.actionCoverageCoefficient <= 0.02
    && agent.core.minimumActionProbability <= 0.01);
check('production entropy target allows exploitation after learning',
    agent.core.entropyTargetRatio <= 0.6 && agent.core.maxEntropyCoefficient <= 0.05);

const score = Number(((passed / total) * 100).toFixed(3));
console.log(`RESULT ${passed}/${total}`);
console.log(`METRIC fresh_start_learning_quality_pct=${score}`);
