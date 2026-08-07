import test from 'node:test';
import assert from 'node:assert/strict';

import {
    analyzeRedppTeam,
    getRedppBaseStatTotal,
    getRedppMoveData,
    TEAM_QUALITY_WEIGHTS,
} from '../src/lib/core/lab/redpp-team-quality.js';
import { UnitTestRewards } from '../src/lib/core/lab/unit-test-rewards.js';
import { REDPP_REWARD_MATRIX } from '../src/lib/core/lab/redpp-reward-matrix.js';
import { compareProgressStates } from '../src/lib/core/lab/parallel-training.js';

function state(party = []) {
    return {
        location: 'CERULEAN CITY',
        coordinates: { x: 5, y: 6 },
        badgeCount: 1,
        party,
        inBattle: false,
        battleResult: 255,
        dialog: '',
        progressFlags: { battledRivalInOaksLab: true },
    };
}

function diverseTeam(levels = [40, 40, 40, 40, 40, 40]) {
    return [
        { speciesId: 9, level: levels[0], type1: 'WATER', moves: [{ id: 55 }, { id: 58 }] },
        { speciesId: 59, level: levels[1], type1: 'FIRE', moves: [{ id: 53 }] },
        { speciesId: 26, level: levels[2], type1: 'ELECTRIC', moves: [{ id: 85 }] },
        { speciesId: 65, level: levels[3], type1: 'PSYCHIC', moves: [{ id: 94 }] },
        { speciesId: 68, level: levels[4], type1: 'FIGHTING', moves: [{ id: 66 }] },
        { speciesId: 149, level: levels[5], type1: 'DRAGON', type2: 'FLYING', moves: [{ id: 58 }, { id: 89 }] },
    ];
}

function repeatedWaterTeam() {
    return diverseTeam().map(mon => ({ ...mon, type1: 'WATER', type2: null, moves: [{ id: 55 }] }));
}

test('team quality uses exact Red++ v3 species and move data', () => {
    assert.equal(getRedppBaseStatTotal(10), 175);
    assert.equal(getRedppBaseStatTotal(150), 590);
    assert.deepEqual(getRedppMoveData(55), { type: 'WATER', power: 40 });
    assert.deepEqual(getRedppMoveData(85), { type: 'ELECTRIC', power: 90 });
    const weightSum = Object.values(TEAM_QUALITY_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(weightSum - 1) < 1e-12);
});

test('six useful and distinct typings outrank six repeated typings', () => {
    const diverse = analyzeRedppTeam(diverseTeam());
    const repeated = analyzeRedppTeam(repeatedWaterTeam());
    assert.equal(diverse.size, 6);
    assert.ok(diverse.score > repeated.score);
    assert.ok(diverse.typeDiversity > repeated.typeDiversity);
    assert.ok(diverse.offensiveCoverage > repeated.offensiveCoverage);
    assert.ok(diverse.defensiveResilience > repeated.defensiveResilience);
});

test('an evenly levelled party receives the strongest balance score', () => {
    const balanced = analyzeRedppTeam(diverseTeam());
    const uneven = analyzeRedppTeam(diverseTeam([10, 20, 30, 40, 50, 60]));
    assert.equal(balanced.levelBalance, 1);
    assert.ok(uneven.levelBalance < 0.1);
    assert.ok(balanced.score > uneven.score);
});

test('higher Red++ base stats improve quality without exceeding one', () => {
    const caterpie = analyzeRedppTeam([{ speciesId: 10, level: 50, type1: 'BUG', moves: [{ id: 81 }] }]);
    const mewtwo = analyzeRedppTeam([{ speciesId: 150, level: 50, type1: 'PSYCHIC', moves: [{ id: 94 }] }]);
    assert.ok(mewtwo.baseStats > caterpie.baseStats);
    assert.ok(mewtwo.score > caterpie.score);
    assert.ok(mewtwo.score >= 0 && mewtwo.score <= 1);
});

test('each first-time party slot is rewarded and six grants one full-team bonus', () => {
    const rewards = new UnitTestRewards();
    const team = diverseTeam();
    let previous = [];
    let memberReward = 0;
    let fullTeamEvents = 0;
    for (let size = 1; size <= 6; size++) {
        const result = rewards.evaluate(state(previous), state(team.slice(0, size)), 'a');
        memberReward += result.firedTests
            .filter(event => event.id === 'pokemon_caught')
            .reduce((sum, event) => sum + event.reward, 0);
        fullTeamEvents += result.firedTests.filter(event => event.id === 'full_team').length;
        previous = team.slice(0, size);
    }
    assert.equal(memberReward, REDPP_REWARD_MATRIX.team.member * 6);
    assert.equal(fullTeamEvents, 1);

    rewards.evaluate(state(team), state(team.slice(0, 5)), 'a');
    const readded = rewards.evaluate(state(team.slice(0, 5)), state(team), 'a');
    assert.equal(readded.firedTests.some(event => event.id === 'pokemon_caught' || event.id === 'full_team'), false);
});

test('team-quality high watermark cannot be farmed by swapping back and forth', () => {
    const rewards = new UnitTestRewards();
    const repeated = repeatedWaterTeam();
    const diverse = diverseTeam();
    rewards.evaluate(state(repeated), state(repeated), null);
    const improved = rewards.evaluate(state(repeated), state(diverse), 'start');
    assert.ok(improved.firedTests.some(event => event.id === 'team_quality_improved'));

    rewards.evaluate(state(diverse), state(repeated), 'start');
    const repeatedImprovement = rewards.evaluate(state(repeated), state(diverse), 'start');
    assert.equal(repeatedImprovement.firedTests.some(event => event.id === 'team_quality_improved'), false);
});

test('equal-route checkpoints prefer the stronger team but route progress still wins', () => {
    const repeated = state(repeatedWaterTeam());
    const diverse = state(diverseTeam());
    assert.ok(compareProgressStates(diverse, repeated) > 0);
    assert.ok(compareProgressStates(
        { ...repeated, location: 'PEWTER CITY' },
        { ...diverse, location: 'VIRIDIAN FOREST' },
    ) > 0);
});
