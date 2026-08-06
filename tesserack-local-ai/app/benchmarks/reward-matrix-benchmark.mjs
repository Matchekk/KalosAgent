import { UnitTestRewards } from '../src/lib/core/lab/unit-test-rewards.js';

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

function battleState({ kind = 'wild', ownHP = 20, ownMaxHP = 20, enemyHP = 20, enemyMaxHP = 20,
    effectiveness = 'neutral', stab = false } = {}) {
    return state({
        inBattle: true,
        battle: {
            kind,
            opponent: { speciesId: 19, currentHP: enemyHP, maxHP: enemyMaxHP },
            active: { currentHP: ownHP, maxHP: ownMaxHP },
            lastMove: { effectiveness, stab },
        },
    });
}

function evaluate(prev, curr, action = 'a') {
    const rewards = new UnitTestRewards();
    // Prime stateful visitation/milestone trackers exactly as the live runner
    // does before judging the transition under test.
    rewards.evaluate(prev, prev, null);
    return rewards.evaluate(prev, curr, action);
}

function hasEvent(result, id) {
    return result.firedTests.some(event => event.id === id);
}

const checks = [];
function check(name, predicate, detail = '') {
    let passed = false;
    let error = '';
    try {
        passed = Boolean(predicate());
    } catch (caught) {
        error = caught?.message || String(caught);
    }
    checks.push({ name, passed, detail: error || detail });
}

const dialogAdvance = evaluate(state({ dialog: 'HELLO' }), state({ dialog: 'WORLD' }), 'a');
check('dialog advancement is positive', () => dialogAdvance.total > 0);
check('dialog has no generic step cost', () => !hasEvent(dialogAdvance, 'step_cost'));

const dialogSequenceRewards = new UnitTestRewards();
let dialogLate;
for (let i = 0; i < 45; i++) {
    dialogLate = dialogSequenceRewards.evaluate(
        state({ dialog: `PAGE ${i}` }),
        state({ dialog: `PAGE ${i + 1}` }),
        'a',
    );
}
check('long dialog never triggers stuck', () => !hasEvent(dialogLate, 'stuck'));

const dialogClose = evaluate(state({ dialog: 'GOOD BYE' }), state({ dialog: '' }), 'a');
check('closing dialog is rewarded', () => dialogClose.total > 0 && hasEvent(dialogClose, 'dialog_advanced'));

const dialogWrong = evaluate(state({ dialog: 'HELLO' }), state({ dialog: 'HELLO' }), 'up');
check('dialog inaction uses one targeted signal', () => hasEvent(dialogWrong, 'dialog_inaction'));
check('dialog inaction has no spatial or global penalty', () =>
    !['step_cost', 'stuck', 'blocked_movement', 'revisited_tile'].some(id => hasEvent(dialogWrong, id)));
check('dialog A ranks above wrong direction', () => dialogAdvance.total > dialogWrong.total);

const exploration = new UnitTestRewards();
const posA = state({ coordinates: { x: 5, y: 6 } });
const posB = state({ coordinates: { x: 6, y: 6 } });
const novel = exploration.evaluate(posA, posB, 'right');
exploration.evaluate(posB, posA, 'left');
const revisit = exploration.evaluate(posA, posB, 'right');
check('new tile is positive', () => novel.total > 0);
check('revisited tile is non-positive', () => revisit.total <= 0);

let loopTotal = 0;
for (let i = 0; i < 20; i++) {
    loopTotal += exploration.evaluate(i % 2 ? posB : posA, i % 2 ? posA : posB, i % 2 ? 'left' : 'right').total;
}
check('two-tile loop is cumulatively negative', () => loopTotal < 0);

const menuRewards = new UnitTestRewards();
const firstStart = menuRewards.evaluate(posA, posA, 'start');
const secondStart = menuRewards.evaluate(posA, posA, 'start');
const thirdStart = menuRewards.evaluate(posA, posA, 'start');
const fourthStart = menuRewards.evaluate(posA, posA, 'start');
check('menu spam waits for repeated Start', () => !hasEvent(firstStart, 'menu_spam') && !hasEvent(secondStart, 'menu_spam'));
check('repeated Start is penalized', () => hasEvent(thirdStart, 'menu_spam') && thirdStart.total < firstStart.total);
check('menu spam penalty escalates', () => fourthStart.total < thirdStart.total);

const smallDamage = evaluate(
    battleState({ enemyHP: 20, enemyMaxHP: 20 }),
    battleState({ enemyHP: 10, enemyMaxHP: 20 }),
    'a',
);
const largeDamage = evaluate(
    battleState({ enemyHP: 200, enemyMaxHP: 200 }),
    battleState({ enemyHP: 100, enemyMaxHP: 200 }),
    'a',
);
check('damage reward is HP-scale invariant', () => Math.abs(smallDamage.total - largeDamage.total) < 1e-9);
check('opponent damage is positive', () => smallDamage.total > 0);

const ownDamage = evaluate(
    battleState({ ownHP: 20, ownMaxHP: 20 }),
    battleState({ ownHP: 10, ownMaxHP: 20 }),
    'a',
);
check('own damage is negative', () => ownDamage.total < 0);

const neutral = evaluate(
    battleState({ enemyHP: 20, enemyMaxHP: 20 }),
    battleState({ enemyHP: 10, enemyMaxHP: 20 }),
    'a',
);
const effective = evaluate(
    battleState({ enemyHP: 20, enemyMaxHP: 20 }),
    battleState({ enemyHP: 10, enemyMaxHP: 20, effectiveness: 'super effective', stab: true }),
    'a',
);
check('effective STAB damage ranks above neutral damage', () => effective.total > neutral.total);
check('dense battle reward is bounded', () => Math.abs(effective.total) <= 5);

const wildWin = evaluate(battleState({ kind: 'wild' }), state({ battleResult: 0 }), 'a');
const trainerWin = evaluate(battleState({ kind: 'trainer' }), state({ battleResult: 0 }), 'a');
const loss = evaluate(battleState({ kind: 'trainer' }), state({ battleResult: 1 }), 'a');
const escape = evaluate(battleState({ kind: 'wild' }), state({ battleResult: 2 }), 'b');
check('trainer win ranks above wild win', () => trainerWin.total > wildWin.total > 0);
check('loss is negative', () => loss.total < 0);
check('escape is not counted as a win', () => escape.total <= 0 && !hasEvent(escape, 'battle_won'));

const badge = evaluate(state(), state({ badgeCount: 1 }), 'a');
const champion = evaluate(state(), state({ location: 'HALL OF FAME' }), 'up');
check('badge ranks above one trainer win', () => badge.total > trainerWin.total);
check('Champion is terminal-scale and ranks above badge', () => champion.total >= 50 && champion.total > badge.total);

const lowLevel = evaluate(
    state({ party: [{ speciesId: 1, level: 5, currentHP: 20, maxHP: 20 }] }),
    state({ party: [{ speciesId: 1, level: 6, currentHP: 22, maxHP: 22 }] }),
    'a',
);
const highLevel = evaluate(
    state({ party: [{ speciesId: 1, level: 80, currentHP: 200, maxHP: 200 }] }),
    state({ party: [{ speciesId: 1, level: 81, currentHP: 202, maxHP: 202 }] }),
    'a',
);
check('level shaping is bounded', () => lowLevel.total <= 1 && highLevel.total <= 1);
check('level reward does not grow with raw HP', () => Math.abs(lowLevel.total - highLevel.total) < 1e-9);

const sparse = evaluate({}, {}, 'a');
check('sparse/corrupt state remains finite', () => Number.isFinite(sparse.total));

const passed = checks.filter(item => item.passed).length;
const score = Number((100 * passed / checks.length).toFixed(3));
console.log(JSON.stringify({ passed, total: checks.length, score, checks }, null, 2));
console.log(`METRIC reward_quality_pct=${score}`);
