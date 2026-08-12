/**
 * Small deterministic recurrent visual encoder.
 *
 * The recurrent state is part of every stored PPO observation, so training
 * replays exactly the memory that existed when an action was sampled. The
 * recurrence itself is fixed and contractive; PPO learns how to use its output
 * without requiring an allocation-heavy browser BPTT implementation.
 */
export class RecurrentObservationMemory {
    constructor(size = 32) {
        this.size = Math.max(8, Math.trunc(Number(size) || 32));
        this.state = new Float32Array(this.size);
        this.next = new Float32Array(this.size);
    }

    update(input = []) {
        const inputLength = Math.max(1, input.length || 0);
        for (let unit = 0; unit < this.size; unit++) {
            let projected = 0;
            for (let tap = 0; tap < 8; tap++) {
                const inputIndex = (unit * 13 + tap * 7) % inputLength;
                const sign = ((unit * 17 + tap * 11) & 1) ? 1 : -1;
                projected += sign * (Number(input[inputIndex]) || 0);
            }
            projected /= 8;
            const recurrent = 0.55 * this.state[unit]
                + 0.15 * this.state[(unit + 1) % this.size]
                - 0.1 * this.state[(unit + this.size - 1) % this.size];
            this.next[unit] = Math.tanh(recurrent + 0.4 * projected);
        }
        [this.state, this.next] = [this.next, this.state];
        return this.state;
    }

    reset() {
        this.state.fill(0);
        this.next.fill(0);
    }
}

export default RecurrentObservationMemory;
