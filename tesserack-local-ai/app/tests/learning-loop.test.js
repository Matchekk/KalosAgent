import test from 'node:test';
import assert from 'node:assert/strict';

const testStorage = new Map();
globalThis.localStorage = {
    getItem: (key) => testStorage.get(key) ?? null,
    setItem: (key, value) => testStorage.set(key, String(value)),
    removeItem: (key) => testStorage.delete(key),
};

const { BrowserTrainer, applySampleWeights } = await import('../src/lib/core/browser-trainer.js');
const { DataCollector } = await import('../src/lib/core/data-collector.js');
const { RLAgent } = await import('../src/lib/core/rl-agent.js');
const { RewardCalculator } = await import('../src/lib/core/reward-calculator.js');
const { AutoCheckpointDiscovery } = await import('../src/lib/core/adaptive-rewards.js');
const { MemoryReader, ADDRESSES } = await import('../src/lib/core/memory-reader.js');

function gameState(overrides = {}) {
    return {
        playerName: 'RED',
        location: "PLAYER'S HOUSE 2F",
        coordinates: { x: 3, y: 4 },
        money: 3000,
        badges: [],
        party: [],
        items: [],
        inBattle: false,
        battleResult: 0,
        battle: null,
        dialog: '',
        ...overrides,
    };
}

function experience(action, reward, state = gameState()) {
    return {
        state,
        action: { raw: [action] },
        reward,
        metadata: { rawState: state, source: 'agent' },
    };
}

test('training ignores neutral actions and reverses negative action targets', () => {
    const trainer = new BrowserTrainer();
    const data = trainer.prepareTrainingData([
        experience('up', 25),
        experience('down', -50),
        experience('left', 0),
    ]);

    assert.equal(data.states.length, 2);
    assert.equal(data.actions[0][0], 1);
    assert.equal(data.actions[1][1], 0);
    assert.equal(data.actions[1].reduce((sum, value) => sum + value, 0), 1);
    assert.ok(data.sampleWeights[1] > data.sampleWeights[0]);
});

test('sample importance works without unsupported TensorFlow sampleWeight', () => {
    const weighted = applySampleWeights([[0, 1], [0.5, 0.5]], [4, 2]);
    assert.deepEqual(weighted, [[0, 4], [1, 1]]);
});

test('legacy random-imitation samples are excluded from the new policy', () => {
    const trainer = new BrowserTrainer();
    const legacy = experience('right', 100);
    delete legacy.metadata.source;

    assert.equal(trainer.countTrainingSignals([legacy]), 0);
    assert.equal(trainer.prepareTrainingData([legacy]).states.length, 0);
});

test('raw and compact progress features are not normalized twice', () => {
    const trainer = new BrowserTrainer();
    assert.equal(trainer.stateToFeatures({ badgeCount: 4 })[3], 0.5);
    assert.equal(trainer.stateToFeatures({ badgeCount: 0.5, normalized: true })[3], 0.5);
    assert.equal(trainer.stateToFeatures({ badgeCount: 1 })[3], 0.125);
});

test('policy state includes opponent HP, combatant types, and effectiveness', () => {
    const trainer = new BrowserTrainer();
    const features = trainer.stateToFeatures(gameState({
        inBattle: true,
        battle: {
            opponent: { currentHP: 15, maxHP: 30, type1Id: 5, type2Id: 5 },
            active: { type1Id: 21, type2Id: 21 },
            lastMove: { effectivenessCode: 20 },
        },
    }));

    assert.equal(features.length, 18);
    assert.equal(features[12], 0.5);
    assert.equal(features[17], 1);
});

test('passive agent recording never presses an extra button', () => {
    let pressed = 0;
    const collector = new DataCollector(
        { pressButton: () => pressed++ },
        { getGameState: () => gameState() },
    );

    collector.recordAgentTransition(gameState(), 'a', 10, gameState({ dialog: 'Next' }));

    assert.equal(pressed, 0);
    assert.equal(collector.explorationBuffer.buffer.length, 1);
    assert.equal(collector.explorationBuffer.buffer[0].metadata.source, 'agent');
});

test('trained policy can improve the only LLM plan', () => {
    const agent = new RLAgent({}, {}, null);
    agent.setTrainedPolicy({
        blendWithPolicy: (_state, actions) => ['left', ...actions.slice(1)],
    });

    const selected = agent.selectPlan(
        [{ plan: 'Move', actions: ['right', 'a'] }],
        gameState(),
    );

    assert.deepEqual(selected.actions, ['left', 'a']);
    assert.equal(selected.selected, 'llm+neural-policy');
});

test('startup guard overrides premature movement plans', () => {
    const agent = new RLAgent({}, {}, null);
    const selected = agent.selectPlan(
        [{ plan: 'Walk', actions: ['down', 'down'] }],
        gameState({ playerName: '', dialog: '' }),
    );

    assert.equal(selected.selected, 'startup-guard');
    assert.ok(selected.actions.includes('start'));
});

test('reward is assigned to exactly the action that caused the transition', async () => {
    const agent = new RLAgent({}, {}, null);
    let observed = null;
    agent.rewardCalc = { computeReward: () => ({ total: 17, breakdown: { progress: 17 } }) };
    agent.setTransitionObserver((transition) => { observed = transition; });
    agent.rememberAction(gameState(), 'down', 'Exit house');

    await agent.settlePendingTransition(gameState({ coordinates: { x: 3, y: 5 } }));

    assert.equal(observed.action, 'down');
    assert.equal(observed.reward, 17);
    assert.deepEqual(agent.expBuffer.buffer[0].action.raw, ['down']);
});

test('dense rewards teach dialog and movement controls', () => {
    const dialogRewards = new RewardCalculator().computeReward(
        gameState({ dialog: 'Hello' }),
        gameState({ dialog: 'Next page' }),
        'a',
    );
    assert.equal(dialogRewards.breakdown.dialogAdvanced, 2);

    const movementRewards = new RewardCalculator().computeReward(
        gameState({ coordinates: { x: 3, y: 4 } }),
        gameState({ coordinates: { x: 3, y: 5 } }),
        'down',
    );
    assert.equal(movementRewards.breakdown.movement, 1);
});

test('repeated saves receive a strong escalating penalty', () => {
    const rewards = new RewardCalculator();
    rewards.computeReward(gameState(), gameState({ dialog: 'Saving...' }), 'a');
    rewards.computeReward(gameState({ dialog: 'Saving...' }), gameState(), 'b');

    const secondSave = rewards.computeReward(
        gameState(),
        gameState({ dialog: 'KKKK saved the game!' }),
        'a',
    );
    assert.equal(secondSave.breakdown.repeatedSave, -100);

    rewards.computeReward(gameState({ dialog: 'KKKK saved the game!' }), gameState(), 'b');
    const thirdSave = rewards.computeReward(
        gameState(),
        gameState({ dialog: 'Saving...' }),
        'a',
    );
    assert.equal(thirdSave.breakdown.repeatedSave, -200);
});

test('invalid startup memory cannot award a badge', () => {
    const rewards = new RewardCalculator().computeReward(
        gameState({ playerName: '', badges: [] }),
        gameState({ playerName: '', badges: ['Cascade'] }),
        'a',
    );
    assert.equal(rewards.breakdown.badges, undefined);
});

test('auto-discovery ignores one-frame RAM glitches', () => {
    const discovery = new AutoCheckpointDiscovery(null, null);
    const initial = gameState();
    for (let i = 0; i < 6; i++) discovery.checkForDiscovery(initial);

    assert.equal(discovery.checkForDiscovery(gameState({ badges: ['Cascade'] })), null);
    assert.equal(discovery.checkForDiscovery(initial), null);
    assert.equal(discovery.getDiscoveries().length, 0);
});

test('memory reader uses Red++ v3.0.2 WRAM bank 1 symbols', () => {
    const wram = new Uint8Array(0x8000);
    wram[ADDRESSES.PLAYER_X - 0xC000] = 7;
    wram[ADDRESSES.PLAYER_Y - 0xC000] = 11;
    const reader = new MemoryReader({
        getWRAM: () => wram,
        readMemory: () => 0,
    });

    assert.deepEqual(reader.getCoordinates(), { x: 7, y: 11 });
});

test('memory reader exposes Red++ battle structs and type effectiveness', () => {
    const wram = new Uint8Array(0x8000);
    const write = (address, ...values) => values.forEach((value, index) => {
        wram[address - 0xC000 + index] = value;
    });
    write(ADDRESSES.BATTLE_TYPE, 2);
    write(ADDRESSES.ENEMY_SPECIES, 74);
    write(ADDRESSES.ENEMY_HP, 0, 12);
    write(ADDRESSES.ENEMY_MAX_HP, 0, 20);
    write(ADDRESSES.ENEMY_TYPE1, 5);
    write(ADDRESSES.ENEMY_TYPE2, 4);
    write(ADDRESSES.ACTIVE_SPECIES, 7);
    write(ADDRESSES.ACTIVE_HP, 0, 18);
    write(ADDRESSES.ACTIVE_MAX_HP, 0, 22);
    write(ADDRESSES.ACTIVE_TYPE1, 21);
    write(ADDRESSES.ACTIVE_TYPE2, 21);
    write(ADDRESSES.PLAYER_MOVE_ID, 55);
    write(ADDRESSES.PLAYER_MOVE_TYPE, 21);
    write(ADDRESSES.DAMAGE, 0, 8);
    write(ADDRESSES.DAMAGE_MULTIPLIERS, 0x80 | 20);
    const battle = new MemoryReader({
        getWRAM: () => wram,
        readMemory: () => 0,
    }).getBattle();

    assert.equal(battle.kind, 'trainer');
    assert.equal(battle.opponent.species, 'GEODUDE');
    assert.equal(battle.opponent.currentHP, 12);
    assert.equal(battle.active.species, 'SQUIRTLE');
    assert.equal(battle.lastMove.effectiveness, 'super effective');
    assert.equal(battle.lastMove.stab, true);
    assert.equal(battle.lastMove.damage, 8);
});

test('only Red++ win result counts as a confirmed battle win', () => {
    const battle = {
        kind: 'wild',
        opponent: { speciesId: 19, currentHP: 5, maxHP: 12 },
        active: { currentHP: 20, maxHP: 20 },
        lastMove: {},
    };
    const rewards = new RewardCalculator();
    const won = rewards.computeReward(
        gameState({ inBattle: true, battle }),
        gameState({ inBattle: false, battle: null, battleResult: 0 }),
        'a',
    );
    assert.equal(won.breakdown.battleWon, 30);
    assert.equal(rewards.getStats().battleWins, 1);

    const ran = rewards.computeReward(
        gameState({ inBattle: true, battle }),
        gameState({ inBattle: false, battle: null, battleResult: 2 }),
        'a',
    );
    assert.equal(ran.breakdown.battleWon, undefined);
    assert.equal(rewards.getStats().battleWins, 1);
});
