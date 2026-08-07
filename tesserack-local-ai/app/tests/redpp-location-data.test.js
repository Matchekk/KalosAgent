import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getRedppLocationProgress,
    resolveRedppLocation,
} from '../src/lib/core/lab/redpp-location-data.js';
import { PureRLAgent } from '../src/lib/core/lab/pure-rl-agent.js';

test('exact Red++ RAM maps stay distinct from their guide parent', () => {
    assert.deepEqual(resolveRedppLocation('PLAYERS HOUSE 2F'), {
        exactLocation: 'Players House 2F',
        guideLocation: 'Pallet Town',
        progressOrder: 0,
        known: true,
    });
    assert.equal(resolveRedppLocation('PEWTER GYM').exactLocation, 'Pewter Gym');
    assert.equal(resolveRedppLocation('PEWTER GYM').guideLocation, 'Pewter City');
    assert.equal(resolveRedppLocation('UNKNOWN TEST MAP').guideLocation, 'Unknown Test Map');
});

test('early Red++ route has a monotonic conservative curriculum order', () => {
    const route = [
        'PLAYERS HOUSE 2F', 'PLAYERS HOUSE 1F', 'PALLET TOWN', 'ROUTE 1',
        'VIRIDIAN CITY', 'ROUTE 2', 'VIRIDIAN FOREST', 'PEWTER CITY', 'PEWTER GYM',
    ].map(getRedppLocationProgress);
    assert.ok(route.every((value, index) => index === 0 || value > route[index - 1]));
});

test('location-only checkpoints require three stable RAM observations', () => {
    const agent = Object.create(PureRLAgent.prototype);
    Object.assign(agent, {
        episodeSteps: 0,
        totalSteps: 0,
        lastProgressEpisodeStep: 0,
        bestProgressScore: 0,
        stableLocation: 'PLAYERS HOUSE 2F',
        stableLocationSteps: 0,
        checkpointState: new Uint8Array([0]),
        checkpointProgressState: { location: 'PLAYERS HOUSE 2F', party: [] },
        pendingCheckpointCandidate: null,
        workerId: 0,
        config: { autoCheckpoint: false, maxEpisodeSteps: 100, noProgressSteps: 100 },
        emu: { saveState: () => new Uint8Array([1]) },
    });
    const previous = { location: 'PLAYERS HOUSE 2F', party: [] };
    const pallet = { location: 'PALLET TOWN', party: [] };

    agent._checkDone(previous, pallet);
    agent._checkDone(pallet, pallet);
    assert.equal(agent.pendingCheckpointCandidate, null);
    agent._checkDone(pallet, pallet);
    assert.equal(agent.pendingCheckpointCandidate.state.location, 'PALLET TOWN');
});
