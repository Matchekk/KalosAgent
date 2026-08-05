import test from 'node:test';
import assert from 'node:assert/strict';

const testStorage = new Map();
globalThis.localStorage = {
    getItem: (key) => testStorage.get(key) ?? null,
    setItem: (key, value) => testStorage.set(key, String(value)),
    removeItem: (key) => testStorage.delete(key),
};

const { BrowserTrainer } = await import('../src/lib/core/browser-trainer.js');
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

test('memory reader uses stable WRAM bank 1 instead of the transient mapped bank', () => {
    const wram = new Uint8Array(0x2000);
    wram[ADDRESSES.PLAYER_X - 0xC000] = 7;
    wram[ADDRESSES.PLAYER_Y - 0xC000] = 11;
    const reader = new MemoryReader({
        getWRAM: () => wram,
        readMemory: () => { throw new Error('mapped bank must not be used'); },
    });

    assert.deepEqual(reader.getCoordinates(), { x: 7, y: 11 });
});
