import { UnitTestRewards } from '../src/lib/core/lab/unit-test-rewards.js';
import { PureRLAgent } from '../src/lib/core/lab/pure-rl-agent.js';
import { adaptiveCoverageCoefficient, adaptiveEntropyCoefficient, ReinforceCore } from '../src/lib/core/lab/reinforce-core.js';

globalThis.requestAnimationFrame = callback => callback();

function state(location, x = 5, y = 5) {
    return {
        location,
        coordinates: { x, y },
        badgeCount: 0,
        party: [],
        progressFlags: {},
        dialog: '',
        inBattle: false,
        menu: { open: false },
    };
}

function event(result, id) {
    return result.firedTests.find(candidate => candidate.id === id);
}

const house2f = state('PLAYERS HOUSE 2F');
const house1f = state('PLAYERS HOUSE 1F');
const pallet = state('PALLET TOWN');
const rewards = new UnitTestRewards();

const baseline = rewards.evaluate(house2f, house2f, 'right');
const firstProgress = rewards.evaluate(house2f, house1f, 'down');
const sameLevel = rewards.evaluate(house1f, { ...house1f, coordinates: { x: 6, y: 5 } }, 'right');
rewards.resetEpisodeState();
const resetBaseline = rewards.evaluate(house2f, house2f, 'right');
const repeatedProgress = rewards.evaluate(house2f, house1f, 'down');

const checkpointRewards = new UnitTestRewards();
const checkpointBaseline = checkpointRewards.evaluate(house1f, house1f, 'right');
const checkpointAdvance = checkpointRewards.evaluate(house1f, pallet, 'down');

const novelty = new ReinforceCore({
    stateSize: 1,
    numActions: 2,
    rolloutSize: 128,
    intrinsicRewardScale: 0.01,
    intrinsicRewardCap: 0.02,
    intrinsicLifelongFloor: 0.25,
});
const familiar = new Float32Array([0.5]);
for (let episode = 0; episode < 64; episode++) {
    novelty.observe(familiar, 0, 0, true, 0, 0, 0, 0, 'known-route-cell');
}
const familiarEpisodeBonus = novelty.buffer.intrinsicRewards[63];

const agent = new PureRLAgent({}, {});
const hardstuckEntropyPressure = adaptiveEntropyCoefficient({
    entropy: 0.986,
    numActions: agent.core.numActions,
    baseCoefficient: agent.config.entropyCoefficient,
    maxCoefficient: agent.config.maxEntropyCoefficient,
    targetRatio: agent.config.entropyTargetRatio,
    responseGain: agent.config.entropyResponseGain,
});
const starvedActionPressure = adaptiveCoverageCoefficient({
    probabilities: [0.35, 0.25, 0.18, 0.1, 0.07, 0.049, 0.001],
    coefficient: agent.config.actionCoverageCoefficient,
    minimumProbability: agent.config.minimumActionProbability,
});

const checks = [
    ['episode-baseline-is-not-retroactively-rewarded', !event(baseline, 'episode_progress') && !event(resetBaseline, 'episode_progress')],
    ['new-ram-milestone-earns-episodic-progress', (event(firstProgress, 'episode_progress')?.reward || 0) >= 0.4],
    ['same-milestone-cannot-be-farmed', !event(sameLevel, 'episode_progress')],
    ['fresh-episode-can-reinforce-the-earned-route', (event(repeatedProgress, 'episode_progress')?.reward || 0) >= 0.4],
    ['checkpoint-start-is-baselined-before-forward-progress', !event(checkpointBaseline, 'episode_progress') && (event(checkpointAdvance, 'episode_progress')?.reward || 0) >= 0.4],
    ['known-route-state-retains-bounded-episodic-novelty', familiarEpisodeBonus >= 0.0025 && familiarEpisodeBonus <= 0.01],
    ['collapsed-policy-gets-targeted-recovery-pressure', hardstuckEntropyPressure >= 0.025 && starvedActionPressure > 0],
];

for (const [name, pass] of checks) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}`);
const passed = checks.filter(([, pass]) => pass).length;
console.log(`METRIC hardstuck_recovery_quality_pct=${((passed / checks.length) * 100).toFixed(3)}`);
if (passed !== checks.length) process.exitCode = 1;
