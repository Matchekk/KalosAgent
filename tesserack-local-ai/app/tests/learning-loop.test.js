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
const { MemoryReader, ADDRESSES, PARTY_ADDRESSES } = await import('../src/lib/core/memory-reader.js');

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
    assert.deepEqual({
        player: ADDRESSES.PLAYER_NAME,
        party: ADDRESSES.PARTY_COUNT,
        money: ADDRESSES.MONEY,
        badges: ADDRESSES.BADGES,
        map: ADDRESSES.MAP_ID,
        y: ADDRESSES.PLAYER_Y,
        x: ADDRESSES.PLAYER_X,
        items: ADDRESSES.ITEM_COUNT,
        battle: ADDRESSES.BATTLE_TYPE,
        effectiveness: ADDRESSES.DAMAGE_MULTIPLIERS,
        damage: ADDRESSES.DAMAGE,
        textBox: ADDRESSES.TEXT_BOX_ID,
        events: ADDRESSES.EVENT_FLAGS,
    }, {
        player: 0xD15D,
        party: 0xD168,
        money: 0xD3FA,
        badges: 0xD409,
        map: 0xD411,
        y: 0xD414,
        x: 0xD415,
        items: 0xD330,
        battle: 0xD05D,
        effectiveness: 0xD05E,
        damage: 0xD0DA,
        textBox: 0xD128,
        events: 0xD7CD,
    });
    assert.deepEqual(PARTY_ADDRESSES.BASE, [0xD170, 0xD19C, 0xD1C8, 0xD1F4, 0xD220, 0xD24C]);
    assert.deepEqual(PARTY_ADDRESSES.NICKNAMES, [0xD2BA, 0xD2C5, 0xD2D0, 0xD2DB, 0xD2E6, 0xD2F1]);

    const wram = new Uint8Array(0x8000);
    wram[ADDRESSES.PLAYER_X - 0xC000] = 7;
    wram[ADDRESSES.PLAYER_Y - 0xC000] = 11;
    const reader = new MemoryReader({
        getWRAM: () => wram,
        readMemory: () => 0,
    });

    assert.deepEqual(reader.getCoordinates(), { x: 7, y: 11 });
});

test('zero-initialized Red++ startup memory is not Pallet Town', () => {
    const wram = new Uint8Array(0x8000);
    const reader = new MemoryReader({
        getWRAM: () => wram,
        readMemory: () => 0,
    });

    assert.equal(reader.getLocation(), 'NO ACTIVE MAP');

    wram[ADDRESSES.MAP_HEIGHT - 0xC000] = 9;
    wram[ADDRESSES.MAP_WIDTH - 0xC000] = 10;
    wram[ADDRESSES.MAP_DATA_PTR - 0xC000] = 0xC2;
    wram[ADDRESSES.MAP_DATA_PTR - 0xC000 + 1] = 0x80;
    assert.equal(reader.getLocation(), 'PALLET TOWN');
});

test('memory reader exposes exact Red++ map and early event flags', () => {
    const wram = new Uint8Array(0x8000);
    const writeBit = index => {
        wram[ADDRESSES.EVENT_FLAGS - 0xC000 + (index >> 3)] |= 1 << (index & 7);
    };
    wram[ADDRESSES.MAP_ID - 0xC000] = 0x36;
    writeBit(0x022);
    writeBit(0x025);
    writeBit(0x039);
    writeBit(0x077);
    const reader = new MemoryReader({
        getWRAM: () => wram,
        readMemory: () => 0,
    });

    const flags = reader.getProgressFlags();
    assert.equal(reader.getMapId(), 0x36);
    assert.equal(flags.gotStarter, true);
    assert.equal(flags.gotPokedex, true);
    assert.equal(flags.gotOaksParcel, true);
    assert.equal(flags.beatBrock, true);
    assert.equal(flags.battledRivalInOaksLab, false);
    assert.equal(flags.eventBytes.length, 16);
});

test('overworld tilemap glyphs cannot masquerade as Red++ dialog', () => {
    const wram = new Uint8Array(0x8000);
    const tilemapOffset = ADDRESSES.TILEMAP_START - 0xC000;
    // These are valid Pokemon text glyphs, but on an overworld screen they are
    // map/sprite tiles and must never create dialog progress or rewards.
    wram.set([0x80, 0x81, 0x82, 0x7F, 0xA0, 0xA1, 0xF6], tilemapOffset + 40);
    const reader = new MemoryReader({
        getWRAM: () => wram,
        readMemory: () => 0,
    });

    assert.equal(reader.getDialog(), '');
    assert.equal(reader.getMenuState('', false).open, false);
});

test('Red++ Start-menu sub-screens cannot masquerade as overworld dialog', () => {
    const wram = new Uint8Array(0x8000);
    const start = ADDRESSES.TILEMAP_START - 0xC000;
    const put = (x, y, value) => { wram[start + (y * 20) + x] = value; };
    put(0, 12, 0x79);
    put(19, 12, 0x7B);
    put(0, 17, 0x7D);
    put(19, 17, 0x7E);
    for (let x = 1; x < 19; x++) {
        put(x, 12, 0x7A);
        put(x, 17, 0x7A);
    }
    for (let y = 13; y < 17; y++) {
        put(0, y, 0x7C);
        put(19, y, 0x7C);
        for (let x = 1; x < 19; x++) put(x, y, 0x7F);
    }
    put(1, 14, 0x80);
    // A full-screen menu can keep the font, window and the exact same border
    // active. Its hSpriteIndexOrTextID remains zero, unlike overworld text.
    wram[ADDRESSES.FONT_LOADED - 0xC000] = 0x01;
    const reader = new MemoryReader({
        getWRAM: () => wram,
        readMemory: address => {
            const relative = address - ADDRESSES.WINDOW_TILEMAP_START;
            const x = relative % 32;
            const y = Math.floor(relative / 32);
            if (relative >= 0 && y < 18 && x < 20) return wram[start + (y * 20) + x];
            return 0;
        },
    });

    assert.equal(reader.getDialog(), '');
    const menu = reader.getMenuState('', false);
    assert.equal(menu.open, true);
    assert.equal(Number.isSafeInteger(menu.screenHash), true);
});

test('Red++ standard message box exposes only its text interior', () => {
    const wram = new Uint8Array(0x8000);
    const start = ADDRESSES.TILEMAP_START - 0xC000;
    const put = (x, y, value) => { wram[start + (y * 20) + x] = value; };

    put(0, 12, 0x79);
    put(19, 12, 0x7B);
    put(0, 17, 0x7D);
    put(19, 17, 0x7E);
    for (let x = 1; x < 19; x++) {
        put(x, 12, 0x7A);
        put(x, 17, 0x7A);
    }
    for (let y = 13; y < 17; y++) {
        put(0, y, 0x7C);
        put(19, y, 0x7C);
        for (let x = 1; x < 19; x++) put(x, y, 0x7F);
    }
    // "HELLO!" on the two actual text rows. Noise outside the box is ignored.
    [0x87, 0x84, 0x8B, 0x8B, 0x8E, 0xE7].forEach((value, index) => put(index + 1, 14, value));
    put(5, 4, 0x99);
    wram[ADDRESSES.FONT_LOADED - 0xC000] = 0x01;

    const reader = new MemoryReader({
        getWRAM: () => wram,
        readMemory: address => {
            const relative = address - ADDRESSES.WINDOW_TILEMAP_START;
            const x = relative % 32;
            const y = Math.floor(relative / 32);
            if (relative >= 0 && y < 18 && x < 20) return wram[start + (y * 20) + x];
            if (address === ADDRESSES.SPRITE_OR_TEXT_ID) return 1;
            return 0;
        },
    });
    assert.equal(reader.getDialog(), 'HELLO!');
    assert.equal(reader.getMenuState(reader.getDialog(), false).open, false);

    // One broken border tile proves this is no longer a live dialog box.
    put(10, 12, 0x7F);
    assert.equal(reader.getDialog(), '');
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

test('memory reader preserves Red++ party move IDs for coverage scoring', () => {
    const wram = new Uint8Array(0x8000);
    const write = (address, ...values) => values.forEach((value, index) => {
        wram[address - 0xC000 + index] = value;
    });
    write(ADDRESSES.PARTY_COUNT, 1);
    write(PARTY_ADDRESSES.BASE[0], 7, 0, 20, 0, 0, 21, 21, 0, 55, 58, 0, 0);
    write(PARTY_ADDRESSES.BASE[0] + 0x21, 8, 0, 25);
    const party = new MemoryReader({
        getWRAM: () => wram,
        readMemory: () => 0,
    }).getParty();

    assert.deepEqual(party[0].moveIds, [55, 58]);
    assert.deepEqual(party[0].moves, ['WATER GUN', 'ICE BEAM']);
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
