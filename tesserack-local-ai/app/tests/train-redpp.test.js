import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PURE_RL_ACTIONS,
    REDPP_STATE_SIZE,
    encodeRedppStateInto,
    PureRLAgent,
} from '../src/lib/core/lab/pure-rl-agent.js';
import { UnitTestRewards } from '../src/lib/core/lab/unit-test-rewards.js';
import { REDPP_REWARD_MATRIX } from '../src/lib/core/lab/redpp-reward-matrix.js';
import { MAP_NAMES } from '../src/lib/core/memory-reader.js';

function state(overrides = {}) {
    return {
        location: 'PALLET TOWN',
        coordinates: { x: 5, y: 6 },
        badgeCount: 0,
        party: [],
        money: 3000,
        inBattle: false,
        battleResult: 255,
        battle: null,
        progressFlags: { battledRivalInOaksLab: false },
        dialog: '',
        menu: { open: false, currentItem: 0, listScrollOffset: 0, screenHash: 0 },
        items: [],
        ...overrides,
    };
}

test('Train exposes Start and encodes Red++ combat state', () => {
    assert.ok(PURE_RL_ACTIONS.includes('start'));
    const vector = new Float32Array(REDPP_STATE_SIZE);
    encodeRedppStateInto(state({
        party: [{ speciesId: 7, level: 8, currentHP: 23, maxHP: 25, type1: 'WATER', type2: null }],
        inBattle: true,
        battle: {
            battleType: 2,
            opponent: { speciesId: 74, level: 10, currentHP: 12, maxHP: 30, type1Id: 5, type2Id: 4 },
            active: { speciesId: 7, level: 8, currentHP: 23, maxHP: 25, type1Id: 11, type2Id: 11, moves: [{ id: 55 }] },
            lastMove: { typeId: 11, power: 40, damage: 8, effectiveness: 'super effective', stab: true },
            menu: { battleSelection: 0, moveListIndex: 2 },
        },
    }), vector);

    assert.equal(vector.length, REDPP_STATE_SIZE);
    assert.ok(vector[9] > 0, 'lead species should be encoded');
    assert.ok(vector[17] > 0, 'opponent species should be encoded');
    assert.equal(vector[30], 1, 'super-effective result should be visible');
    assert.equal(vector[31], 1, 'STAB should be visible');
    assert.ok(vector[35] > 0, 'team-quality score should be encoded');
    assert.ok(vector[36] > 0, 'Red++ base-stat quality should be encoded');
    assert.equal(vector[37], 1, 'a one-Pokemon party is internally level-balanced');

    const overworld = new Float32Array(REDPP_STATE_SIZE);
    const report = new Float32Array(REDPP_STATE_SIZE);
    encodeRedppStateInto(state(), overworld);
    encodeRedppStateInto(state({ menu: {
        open: true, currentItem: 4, listScrollOffset: 1, screenHash: 0xabcdef01,
    } }), report);
    assert.equal(overworld[41], 0);
    assert.equal(report[41], 1, 'menu-open state must be visible to the policy');
    assert.ok(report[42] > 0, 'menu selection must be visible to the policy');
    assert.notDeepEqual([...report.slice(41)], [...overworld.slice(41)]);
});

test('all Red++ v3 map IDs are mapped, including added islands and late game', () => {
    assert.equal(Object.keys(MAP_NAMES).length, 248);
    assert.equal(MAP_NAMES[0x6d], 'FARAWAY ISLAND OUTSIDE');
    assert.equal(MAP_NAMES[0x78], 'CHAMPIONS ROOM');
    assert.equal(MAP_NAMES[0xee], 'NAVEL ROCK LUGIA ROOM');
});

test('Train rewards only confirmed Red++ wins and battle damage', () => {
    const rewards = new UnitTestRewards();
    const battle = {
        kind: 'wild',
        battleType: 1,
        opponent: { speciesId: 19, currentHP: 10, maxHP: 20 },
        active: { speciesId: 7, currentHP: 20, maxHP: 20 },
        lastMove: { effectiveness: 'super effective', stab: true },
    };
    const party = [{ speciesId: 7, level: 8, currentHP: 20, maxHP: 20 }];
    const damage = rewards.evaluate(
        state({ party, inBattle: true, battle }),
        state({ party, inBattle: true, battle: { ...battle, opponent: { ...battle.opponent, currentHP: 5 } } }),
        'a',
    );
    assert.ok(damage.total > 0);
    assert.ok(damage.firedTests.some(event => event.id === 'redpp_battle_progress'));

    const ran = rewards.evaluate(
        state({ party, inBattle: true, battle }),
        state({ party, battleResult: 2 }),
        'b',
    );
    assert.ok(ran.total < 0);
    assert.ok(ran.firedTests.some(event => event.id === 'redpp_battle_escaped'));

    const won = rewards.evaluate(
        state({ party, inBattle: true, battle }),
        state({ party, battleResult: 0 }),
        'a',
    );
    assert.ok(won.firedTests.some(event =>
        event.id === 'redpp_battle_won' && event.reward === REDPP_REWARD_MATRIX.battle.wildWin));

    const startupGlitch = rewards.evaluate(
        state({ inBattle: true, battle }),
        state({ battleResult: 0 }),
        'a',
    );
    assert.ok(!startupGlitch.firedTests.some(event => event.id === 'redpp_battle_won'));
});

test('Train cannot farm reward by walking in a circle', () => {
    const rewards = new UnitTestRewards();
    const a = state({ coordinates: { x: 5, y: 6 } });
    const b = state({ coordinates: { x: 6, y: 6 } });
    rewards.evaluate(a, b, 'right');
    rewards.evaluate(b, a, 'left');
    const revisit = rewards.evaluate(a, b, 'right');
    assert.ok(revisit.total < 0, `revisit reward must be negative, got ${revisit.total}`);

});

test('ineffective overworld face buttons cannot become a safe local optimum', () => {
    const rewards = new UnitTestRewards();
    const unchanged = state();
    const noOp = rewards.evaluate(unchanged, unchanged, 'b');

    assert.ok(noOp.firedTests.some(event =>
        event.id === 'overworld_inaction' && event.reward === REDPP_REWARD_MATRIX.overworld.inaction));
    assert.ok(noOp.total < REDPP_REWARD_MATRIX.overworld.decisionCost);
    assert.ok(Math.abs(REDPP_REWARD_MATRIX.overworld.inaction)
        < Math.abs(REDPP_REWARD_MATRIX.overworld.twoCycle));

    const start = rewards.evaluate(unchanged, unchanged, 'start');
    assert.equal(start.firedTests.some(event => event.id === 'overworld_inaction'), false);
});

test('alternating face-button no-ops and blocked movement cannot evade stuck pressure', () => {
    const rewards = new UnitTestRewards();
    const unchanged = state({ coordinates: { x: 8, y: 17 } });
    let result;

    for (let step = 0; step < REDPP_REWARD_MATRIX.overworld.stuckStart; step++) {
        result = rewards.evaluate(unchanged, unchanged, step % 2 === 0 ? 'b' : 'down');
    }

    const stuck = result.firedTests.find(event => event.id === 'stuck');
    assert.ok(stuck, 'mixed stationary actions must reach the stuck threshold');
    assert.equal(stuck.count, REDPP_REWARD_MATRIX.overworld.stuckStart);
    assert.equal(rewards.getStats().stuckCounter, REDPP_REWARD_MATRIX.overworld.stuckStart);

    const moved = rewards.evaluate(
        unchanged,
        state({ coordinates: { x: 8, y: 16 } }),
        'up',
    );
    assert.equal(moved.firedTests.some(event => event.id === 'stuck'), false);
    assert.equal(rewards.getStats().stuckCounter, 0);
});

test('reward learning memory survives scheduled WASM environment rotation', () => {
    const beforeRotation = new UnitTestRewards();
    const a = state({ coordinates: { x: 5, y: 6 } });
    const b = state({ coordinates: { x: 6, y: 6 } });
    beforeRotation.evaluate(a, b, 'right');

    const dialogA = state({ coordinates: { x: 6, y: 6 }, dialog: 'HELLO' });
    const dialogB = state({ coordinates: { x: 6, y: 6 }, dialog: 'WORLD' });
    const firstDialog = beforeRotation.evaluate(dialogA, dialogB, 'a');
    const firstCredit = firstDialog.firedTests.find(event => event.id === 'dialog_advanced').reward;

    const afterRotation = new UnitTestRewards();
    afterRotation.restoreLearningState(beforeRotation.exportLearningState());
    const revisit = afterRotation.evaluate(a, b, 'right');
    assert.equal(revisit.firedTests.some(event => event.id === 'novel_tile'), false);
    assert.ok(revisit.firedTests.some(event => event.id === 'revisited_tile'));

    const continuedDialog = afterRotation.evaluate(dialogB, { ...dialogB, dialog: 'NEXT' }, 'a');
    const continuedCredit = continuedDialog.firedTests.find(event => event.id === 'dialog_advanced').reward;
    assert.ok(continuedCredit < firstCredit, 'dialog credit must not reset during WASM rotation');
});

test('episode reset renews exploration without erasing durable anti-farming memory', () => {
    const rewards = new UnitTestRewards();
    const a = state({ coordinates: { x: 5, y: 6 } });
    const b = state({ coordinates: { x: 6, y: 6 } });
    const firstVisit = rewards.evaluate(a, b, 'right');
    assert.ok(firstVisit.firedTests.some(event => event.id === 'novel_tile'));

    const dialogA = state({ coordinates: { x: 6, y: 6 }, dialog: 'HELLO' });
    const dialogB = state({ coordinates: { x: 6, y: 6 }, dialog: 'WORLD' });
    const firstDialog = rewards.evaluate(dialogA, dialogB, 'a');
    const firstCredit = firstDialog.firedTests.find(event => event.id === 'dialog_advanced').reward;
    const totalBeforeReset = rewards.getStats().totalRewards.total;

    rewards.resetEpisodeState();
    const renewedVisit = rewards.evaluate(a, b, 'right');
    assert.ok(renewedVisit.firedTests.some(event => event.id === 'novel_tile'),
        'checkpoint reload must start a fresh episodic exploration map');
    assert.ok(rewards.getStats().totalRewards.total > totalBeforeReset,
        'cumulative training telemetry must survive episode reset');

    const continuedDialog = rewards.evaluate(dialogB, { ...dialogB, dialog: 'NEXT' }, 'a');
    const continuedCredit = continuedDialog.firedTests.find(event => event.id === 'dialog_advanced').reward;
    assert.ok(continuedCredit < firstCredit, 'durable dialog anti-farming credit must survive episode reset');
});

test('PureRLAgent clears trajectory-local rewards whenever an episode reloads', async () => {
    const saved = new Uint8Array([1, 2, 3, 4]);
    const emulator = {
        saveState: () => saved.slice(),
        loadState: () => {},
        runFrame: () => {},
        pressButton: () => {},
    };
    const agent = new PureRLAgent(emulator, { getGameState: () => state() });
    agent.ensureCheckpoint();
    agent.rewards.evaluate(
        state({ coordinates: { x: 5, y: 6 } }),
        state({ coordinates: { x: 6, y: 6 } }),
        'right',
    );
    assert.equal(agent.rewards.positionVisits.size > 0, true);

    await agent._resetEnv();
    assert.equal(agent.rewards.positionVisits.size, 0);
    assert.equal(agent.rewards.recentPositions.length, 0);
});

test('optional menu idling and rapid reopening escalate without locking strategic actions', () => {
    const rewards = new UnitTestRewards();
    const party = [
        { speciesId: 1, level: 8, currentHP: 24, maxHP: 24, status: 'OK', moveIds: [33] },
        { speciesId: 7, level: 8, currentHP: 22, maxHP: 22, status: 'OK', moveIds: [33] },
    ];
    const closed = state({ party });
    const report = state({ party, menu: { open: true, currentItem: 2, listScrollOffset: 0, screenHash: 99 } });

    rewards.evaluate(closed, report, 'start');
    let idle;
    for (let step = 0; step < REDPP_REWARD_MATRIX.menu.graceSteps; step++) {
        idle = rewards.evaluate(report, report, 'a');
    }
    assert.ok(idle.firedTests.some(event => event.id === 'menu_idle'));
    const laterIdle = rewards.evaluate(report, report, 'down');
    assert.ok(laterIdle.firedTests.find(event => event.id === 'menu_idle').reward
        < idle.firedTests.find(event => event.id === 'menu_idle').reward);
    assert.equal(laterIdle.firedTests.some(event => event.id === 'blocked_movement'), false);

    const exited = rewards.evaluate(report, closed, 'b');
    assert.equal(exited.firedTests.some(event => event.id === 'menu_idle'), false);
    const reopened = rewards.evaluate(closed, report, 'start');
    assert.ok(reopened.firedTests.some(event => event.id === 'menu_reopened'));

    const reordered = state({
        party: [party[1], party[0]],
        menu: { open: true, currentItem: 2, listScrollOffset: 0, screenHash: 100 },
    });
    const useful = rewards.evaluate(report, reordered, 'a');
    assert.equal(useful.firedTests.some(event => event.id === 'menu_idle'), false);
});

test('Train checkpoints earned durable progress without choosing an action', () => {
    const saved = new Uint8Array([1, 2, 3, 4]);
    const emulator = {
        saveState: () => saved.slice(),
        loadState: () => {},
        runFrame: () => {},
        pressButton: () => {},
    };
    let current = state();
    const agent = new PureRLAgent(emulator, { getGameState: () => current }, { noProgressSteps: 20 });
    agent.ensureCheckpoint();
    const before = agent.checkpointCount;
    current = state({ party: [{ speciesId: 1, level: 5, currentHP: 20, maxHP: 20, type1: 'GRASS' }] });
    assert.equal(agent._checkDone(state(), current), false);
    assert.ok(agent.checkpointCount > before);
});

test('becoming Red++ Champion is an explicit terminal-scale objective', () => {
    const rewards = new UnitTestRewards();
    const result = rewards.evaluate(state(), state({ location: 'HALL OF FAME' }), 'up');
    assert.ok(result.firedTests.some(event =>
        event.id === 'redpp_champion' && event.reward === REDPP_REWARD_MATRIX.milestone.champion));
});

test('mandatory dialog never accrues movement, step, or stuck penalties', () => {
    const rewards = new UnitTestRewards();
    let result;
    for (let page = 0; page < 60; page++) {
        result = rewards.evaluate(
            state({ dialog: `PAGE ${page}` }),
            state({ dialog: `PAGE ${page + 1}` }),
            'a',
        );
    }
    const forbidden = new Set(['decision_cost', 'step_cost', 'stuck', 'blocked_movement', 'revisited_tile']);
    assert.equal(result.context, 'dialog');
    assert.ok(result.total > 0);
    assert.equal(result.firedTests.some(event => forbidden.has(event.id)), false);

    const closed = rewards.evaluate(state({ dialog: 'THE END' }), state({ dialog: '' }), 'a');
    assert.ok(closed.firedTests.some(event =>
        event.id === 'dialog_advanced'
            && event.reward > 0
            && event.reward <= REDPP_REWARD_MATRIX.dialog.closed));
});

test('repeated saves receive an exponentially escalating, capped penalty', () => {
    const rewards = new UnitTestRewards();
    const save = () => rewards.evaluate(
        state({ dialog: 'WOULD YOU LIKE TO SAVE?' }),
        state({ dialog: 'SAVED THE GAME' }),
        'a',
    );

    const first = save();
    const second = save();
    const third = save();
    assert.equal(first.firedTests.some(event => event.id === 'repeat_save'), false);
    assert.ok(second.firedTests.some(event =>
        event.id === 'repeat_save' && event.reward === REDPP_REWARD_MATRIX.menu.repeatSaveBase));
    assert.ok(third.firedTests.some(event =>
        event.id === 'repeat_save' && event.reward === REDPP_REWARD_MATRIX.menu.repeatSaveBase * 2));
    assert.ok(third.total < second.total);
});

test('reward hierarchy and normalized battle coefficients stay coherent', () => {
    const { battle, dialog, milestone, overworld, team } = REDPP_REWARD_MATRIX;
    assert.ok(Math.abs(overworld.decisionCost) < overworld.novelTile);
    assert.ok(Math.abs(overworld.decisionCost) < Math.abs(overworld.inaction));
    assert.ok(Math.abs(overworld.inaction) < Math.abs(overworld.twoCycle));
    assert.ok(dialog.positionCap < milestone.levelUnit);
    assert.ok(overworld.novelTile < overworld.newLocation);
    assert.ok(overworld.newLocation < milestone.levelUnit);
    assert.ok(milestone.levelUnit < team.member);
    assert.ok(team.member < battle.wildWin);
    assert.ok(battle.trainerWin > battle.wildWin);
    assert.ok(milestone.badge > battle.trainerWin);
    assert.ok(milestone.champion > milestone.badge);
    assert.ok(battle.enemyHpFraction > 0 && battle.ownHpFraction < 0);
    assert.ok(team.member * 6 + team.fullTeam + team.qualityScale < milestone.badge);
    assert.ok(team.qualityTransitionCap < battle.wildWin);
    assert.ok(REDPP_REWARD_MATRIX.denseRewardCap < battle.wildWin);
});
