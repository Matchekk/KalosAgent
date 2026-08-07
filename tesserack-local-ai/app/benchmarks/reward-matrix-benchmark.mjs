import { UnitTestRewards } from '../src/lib/core/lab/unit-test-rewards.js';
import { analyzeRedppTeam } from '../src/lib/core/lab/redpp-team-quality.js';
import { REDPP_REWARD_MATRIX } from '../src/lib/core/lab/redpp-reward-matrix.js';

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
let dialogSequenceTotal = 0;
for (let i = 0; i < 45; i++) {
    dialogLate = dialogSequenceRewards.evaluate(
        state({ dialog: `PAGE ${i}` }),
        state({ dialog: `PAGE ${i + 1}` }),
        'a',
    );
    dialogSequenceTotal += dialogLate.total;
}
check('long dialog never triggers stuck', () => !hasEvent(dialogLate, 'stuck'));
check('every correct A in a long dialog remains positive', () => dialogLate.total > 0);

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

const noOp = evaluate(posA, posA, 'b');
check('ineffective overworld face buttons are explicitly penalized', () =>
    hasEvent(noOp, 'overworld_inaction')
        && noOp.total < REDPP_REWARD_MATRIX.overworld.decisionCost);
check('overworld inaction is less severe than a two-tile loop', () =>
    Math.abs(REDPP_REWARD_MATRIX.overworld.inaction)
        < Math.abs(REDPP_REWARD_MATRIX.overworld.twoCycle));

let loopTotal = 0;
for (let i = 0; i < 20; i++) {
    loopTotal += exploration.evaluate(i % 2 ? posB : posA, i % 2 ? posA : posB, i % 2 ? 'left' : 'right').total;
}
check('two-tile loop is cumulatively negative', () => loopTotal < 0);

const menuRewards = new UnitTestRewards();
const menuParty = [{ speciesId: 1, level: 8, currentHP: 24, maxHP: 24, moveIds: [33] }];
const menuClosed = state({ party: menuParty });
const menuOpen = state({
    party: menuParty,
    menu: { open: true, currentItem: 2, listScrollOffset: 0, screenHash: 99 },
});
menuRewards.evaluate(menuClosed, menuOpen, 'start');
let menuIdle;
for (let i = 0; i < REDPP_REWARD_MATRIX.menu.graceSteps; i++) {
    menuIdle = menuRewards.evaluate(menuOpen, menuOpen, 'a');
}
const menuLaterIdle = menuRewards.evaluate(menuOpen, menuOpen, 'down');
check('optional menu has a grace period before idle pressure', () => hasEvent(menuIdle, 'menu_idle'));
check('menu idle pressure escalates but stays bounded', () =>
    menuLaterIdle.total < menuIdle.total
        && menuLaterIdle.total >= REDPP_REWARD_MATRIX.menu.idleCap + REDPP_REWARD_MATRIX.menu.decisionCost);
check('menu directions never look like blocked overworld movement', () => !hasEvent(menuLaterIdle, 'blocked_movement'));
menuRewards.evaluate(menuOpen, menuClosed, 'b');
const rapidReopen = menuRewards.evaluate(menuClosed, menuOpen, 'start');
check('rapid menu reopening is explicitly penalized', () => hasEvent(rapidReopen, 'menu_reopened'));
const strategicMenu = state({
    party: [{ ...menuParty[0], currentHP: 20 }],
    menu: { open: true, currentItem: 2, listScrollOffset: 0, screenHash: 100 },
});
const strategicUse = menuRewards.evaluate(menuOpen, strategicMenu, 'a');
check('real item or party changes waive idle pressure', () => !hasEvent(strategicUse, 'menu_idle'));

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
check('an entire long dialog is worth less than one level', () => dialogSequenceTotal < lowLevel.total);

const sparse = evaluate({}, {}, 'a');
check('sparse/corrupt state remains finite', () => Number.isFinite(sparse.total));

const balancedTeam = [
    { speciesId: 9, level: 40, type1: 'WATER', moves: [{ id: 55 }, { id: 58 }] },
    { speciesId: 59, level: 40, type1: 'FIRE', moves: [{ id: 53 }] },
    { speciesId: 26, level: 40, type1: 'ELECTRIC', moves: [{ id: 85 }] },
    { speciesId: 65, level: 40, type1: 'PSYCHIC', moves: [{ id: 94 }] },
    { speciesId: 68, level: 40, type1: 'FIGHTING', moves: [{ id: 66 }] },
    { speciesId: 149, level: 40, type1: 'DRAGON', type2: 'FLYING', moves: [{ id: 58 }, { id: 89 }] },
];
const repeatedTypes = balancedTeam.map(mon => ({ ...mon, type1: 'WATER', type2: null, moves: [{ id: 55 }] }));
const unevenLevels = balancedTeam.map((mon, index) => ({ ...mon, level: [10, 20, 30, 40, 50, 60][index] }));
const balancedQuality = analyzeRedppTeam(balancedTeam);
check('team quality is normalized', () => balancedQuality.score > 0 && balancedQuality.score <= 1);
check('diverse typing beats repeated typing', () =>
    balancedQuality.score > analyzeRedppTeam(repeatedTypes).score);
check('balanced levels beat uneven levels', () =>
    balancedQuality.score > analyzeRedppTeam(unevenLevels).score);
check('six roster rewards plus completion remain below a badge', () =>
    REDPP_REWARD_MATRIX.team.member * 6 + REDPP_REWARD_MATRIX.team.fullTeam
        < REDPP_REWARD_MATRIX.milestone.badge);
check('all bounded team acquisition and quality shaping remain below a badge', () =>
    REDPP_REWARD_MATRIX.team.member * 6
        + REDPP_REWARD_MATRIX.team.fullTeam
        + REDPP_REWARD_MATRIX.team.qualityScale
        < REDPP_REWARD_MATRIX.milestone.badge);
check('reward tiers form a strict semantic hierarchy', () => {
    const { dialog, overworld, milestone, team, battle } = REDPP_REWARD_MATRIX;
    return dialog.positionCap < milestone.levelUnit
        && overworld.novelTile < overworld.newLocation
        && overworld.newLocation < milestone.levelUnit
        && milestone.levelUnit < team.member
        && team.member < battle.wildWin
        && battle.wildWin < battle.trainerWin
        && battle.trainerWin < milestone.badge
        && milestone.badge < milestone.champion;
});
check('one dense battle transition cannot outweigh a win', () =>
    REDPP_REWARD_MATRIX.denseRewardCap < REDPP_REWARD_MATRIX.battle.wildWin);
check('special Oak win plus trainer win remains below a badge', () =>
    REDPP_REWARD_MATRIX.milestone.oakRival + REDPP_REWARD_MATRIX.battle.trainerWin
        < REDPP_REWARD_MATRIX.milestone.badge);
check('penalty severity follows gameplay consequence', () =>
    Math.abs(REDPP_REWARD_MATRIX.battle.escapeOrDraw)
        < Math.abs(REDPP_REWARD_MATRIX.battle.loss)
        && Math.abs(REDPP_REWARD_MATRIX.battle.loss)
        < Math.abs(REDPP_REWARD_MATRIX.milestone.whiteout));

const passed = checks.filter(item => item.passed).length;
const score = Number((100 * passed / checks.length).toFixed(3));
console.log(JSON.stringify({ passed, total: checks.length, score, checks }, null, 2));
console.log(`METRIC reward_quality_pct=${score}`);
