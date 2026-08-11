import { executeRepeatedAction } from '../src/lib/core/lab/training-utils.js';

const GAME_BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'];
const ACTIONS = ['up', 'right', 'a', 'down', 'left', 'b', 'start'];

class TraceEmulator {
    constructor() {
        this.active = new Set();
        this.frames = [];
        this.expected = null;
        this.pressCalls = 0;
    }

    setButton(button, pressed) {
        if (pressed) this.active.add(button);
        else this.active.delete(button);
    }

    pressButton(button, duration = 100) {
        this.pressCalls++;
        this.setButton(button, true);
        setTimeout(() => this.setButton(button, false), duration);
    }

    runFrame() {
        this.frames.push({
            expected: this.expected,
            active: [...this.active].filter(button => GAME_BUTTONS.includes(button)).sort(),
        });
    }
}

async function runSequence(actions, { yieldBetween = false } = {}) {
    const emulator = new TraceEmulator();
    const releasedAfterTransition = [];
    for (const action of actions) {
        emulator.expected = action;
        await executeRepeatedAction(emulator, action, {
            actionHoldFrames: 12,
            frameSkip: 16,
            actionRepeat: 1,
        });
        releasedAfterTransition.push(emulator.active.size === 0);
        if (yieldBetween) await new Promise(resolve => setTimeout(resolve, 15));
    }
    await new Promise(resolve => setTimeout(resolve, 15));
    return { emulator, releasedAfterTransition };
}

function sampledActionOrNeutral(frame) {
    return frame.active.length === 0
        || (frame.active.length === 1 && frame.active[0] === frame.expected);
}

function exactTransitionShape(frames, transitions) {
    if (frames.length !== transitions * 16) return false;
    for (let transition = 0; transition < transitions; transition++) {
        const slice = frames.slice(transition * 16, (transition + 1) * 16);
        if (!slice.slice(0, 12).every(frame =>
            frame.active.length === 1 && frame.active[0] === frame.expected)) return false;
        if (!slice.slice(12).every(frame => frame.active.length === 0)) return false;
    }
    return true;
}

function traceSignature(frames) {
    return frames.map(frame => `${frame.expected}:${frame.active.join('+')}`).join('|');
}

const visible = await runSequence(ACTIONS, { yieldBetween: true });
const hiddenBatch = await runSequence(Array.from({ length: 80 }, (_, index) => ACTIONS[index % ACTIONS.length]));
const hiddenComparable = await runSequence(ACTIONS);

const checks = [
    ['visible frames never execute a non-sampled action', visible.emulator.frames.every(sampledActionOrNeutral)],
    ['hidden 80-round batch never executes a non-sampled action', hiddenBatch.emulator.frames.every(sampledActionOrNeutral)],
    ['each transition synchronously releases every button', hiddenBatch.releasedAfterTransition.every(Boolean)],
    ['visible and hidden schedules have identical input traces',
        traceSignature(visible.emulator.frames) === traceSignature(hiddenComparable.emulator.frames)],
    ['frame count is fixed at sixteen per action',
        visible.emulator.frames.length === ACTIONS.length * 16
        && hiddenBatch.emulator.frames.length === 80 * 16],
    ['each transition contains twelve hold frames and four observed release frames',
        exactTransitionShape(visible.emulator.frames, ACTIONS.length)
        && exactTransitionShape(hiddenBatch.emulator.frames, 80)],
    ['training does not depend on wall-clock pressButton timers',
        visible.emulator.pressCalls === 0 && hiddenBatch.emulator.pressCalls === 0],
];

let passed = 0;
for (const [name, ok] of checks) {
    if (ok) passed++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
}

const score = (passed / checks.length) * 100;
console.log(`METRIC background_input_integrity_pct=${score.toFixed(3)}`);
