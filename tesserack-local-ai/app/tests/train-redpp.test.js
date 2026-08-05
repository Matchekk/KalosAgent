import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PURE_RL_ACTIONS,
    REDPP_STATE_SIZE,
    encodeRedppStateInto,
    PureRLAgent,
} from '../src/lib/core/lab/pure-rl-agent.js';
import { UnitTestRewards } from '../src/lib/core/lab/unit-test-rewards.js';
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
        opponent: { speciesId: 19, currentHP: 10, maxHP: 20 },
        active: { currentHP: 20, maxHP: 20 },
        lastMove: { effectiveness: 'super effective', stab: true },
    };
    const damage = rewards.evaluate(
        state({ inBattle: true, battle }),
        state({ inBattle: true, battle: { ...battle, opponent: { ...battle.opponent, currentHP: 5 } } }),
        'a',
    );
    assert.ok(damage.breakdown.tier3 > 2);

    const ran = rewards.evaluate(
        state({ inBattle: true, battle }),
        state({ battleResult: 2 }),
        'b',
    );
    assert.ok(ran.breakdown.tier3 < 0);

    const won = rewards.evaluate(
        state({ inBattle: true, battle }),
        state({ battleResult: 0 }),
        'a',
    );
    assert.ok(won.breakdown.tier3 >= 20);
});

test('Train cannot farm reward by walking in a circle or spamming Start', () => {
    const rewards = new UnitTestRewards();
    const a = state({ coordinates: { x: 5, y: 6 } });
    const b = state({ coordinates: { x: 6, y: 6 } });
    rewards.evaluate(a, b, 'right');
    rewards.evaluate(b, a, 'left');
    const revisit = rewards.evaluate(a, b, 'right');
    assert.ok(revisit.total < 0, `revisit reward must be negative, got ${revisit.total}`);

    rewards.evaluate(a, a, 'start');
    rewards.evaluate(a, a, 'start');
    const spam = rewards.evaluate(a, a, 'start');
    assert.ok(spam.firedTests.some(event => event.id === 'menu_spam'));
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
    assert.ok(result.firedTests.some(event => event.id === 'redpp_champion' && event.reward === 1000));
});
