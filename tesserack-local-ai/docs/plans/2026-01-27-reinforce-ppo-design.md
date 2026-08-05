# REINFORCE → PPO Implementation Design

## Current State

### What Exists Today

The browser-based Pure RL mode has all the **infrastructure** for reinforcement learning but **no actual learning**:

| Component | Status | Notes |
|-----------|--------|-------|
| Emulator | Done | binjgb WebAssembly, runs in browser |
| Memory Reader | Done | Reads game state (position, badges, party, etc.) |
| State Encoder | Done | 16-dim vector: position, location hash, progress indicators |
| Policy Network | Done | 2-layer MLP (16→64→6), random weights, softmax output |
| Action Selection | Done | Epsilon-greedy (30%→5% decay), samples from policy |
| Reward System | Done | Unit tests: movement (+0.1), map change (+1-2), milestones (+5-10), penalties |
| Metrics UI | Done | Real-time display of rewards, actions, epsilon, tier breakdown |

### What's Missing

The reward signal is computed and displayed but **never used to update the policy weights**. The system is instrumented for RL but running as pure exploration.

```
Current:  state → policy(random weights) → action → reward → [discarded]
                        ↑
                   never changes

Target:   state → policy → action → reward → gradient → weight update
                        ↑                              |
                        └──────────────────────────────┘
```

---

## Design: REINFORCE Implementation

### Approach

Incremental path to PPO:
1. **REINFORCE** (this doc) — vanilla policy gradient with returns-to-go
2. **Value baseline** (future) — reduce variance with critic network
3. **PPO clipping** (future) — prevent destructive updates

Plain JavaScript with manual gradients (no TensorFlow.js dependency).

---

### 1. Experience Buffer

Store one rollout of 128 steps before updating:

```javascript
this.buffer = {
    states: [],      // Float32Array[16] per step (cloned, not referenced)
    actions: [],     // action index (0-5)
    rewards: [],     // scalar reward from unit tests
    logProbs: [],    // log π(a|s) at time of action — stored for PPO, unused in REINFORCE
    dones: [],       // boolean - true if episode ended after this step
    length: 0
};
this.rolloutSize = 128;
```

**Important**: Clone state vectors to avoid reference reuse bugs:
```javascript
this.buffer.states.push(new Float32Array(stateVec));
```

---

### 2. Canonical Step Loop

Restructure to the standard RL loop to avoid off-by-one bugs:

```javascript
async step() {
    // 1. Observe state s
    const state = this.mem.getGameState();
    const stateVec = encodeState(state);

    // 2. Choose action a (sample from policy, no epsilon-greedy)
    const probs = this.policy.forward(stateVec);
    const actionIdx = this.sampleFromProbs(probs);
    const logProb = Math.log(probs[actionIdx] + 1e-8);

    // 3. Apply action
    await this.executeAction(ACTIONS[actionIdx]);

    // 4. Observe new state s'
    const nextState = this.mem.getGameState();

    // 5. Compute reward r = tests(s, s')
    const result = this.rewards.evaluate(state, nextState);
    const reward = result.total;

    // 6. Check done (whiteout, manual reset, etc.)
    const done = this.checkDone(state, nextState);

    // 7. Store (s, a, r, logProb, done)
    this.buffer.states.push(new Float32Array(stateVec));
    this.buffer.actions.push(actionIdx);
    this.buffer.rewards.push(reward);
    this.buffer.logProbs.push(logProb);
    this.buffer.dones.push(done);
    this.buffer.length++;

    // 8. Train when buffer is full
    if (this.buffer.length >= this.rolloutSize) {
        this.train();
    }

    // Update metrics, callbacks...
}
```

**Key change**: Removed epsilon-greedy. Actions are sampled purely from the policy distribution. This keeps REINFORCE on-policy and mathematically correct. Exploration comes from the softmax distribution itself (and we can add an entropy bonus later for PPO).

---

### 3. Returns Computation (with done boundaries)

Discounted rewards-to-go with γ=0.99, respecting episode boundaries:

```javascript
computeReturns() {
    const returns = new Float32Array(this.buffer.length);
    let R = 0;

    for (let t = this.buffer.length - 1; t >= 0; t--) {
        // Reset return at episode boundary
        if (this.buffer.dones[t]) {
            R = 0;
        }
        R = this.buffer.rewards[t] + this.gamma * R;
        returns[t] = R;
    }

    return returns;
}
```

**Why done boundaries matter**: Without them, reward from a new episode leaks backward into the previous one, corrupting the gradient signal.

---

### 4. Forward Pass with Cache

Use a cached forward pass to avoid recomputation and ensure consistency between action sampling and gradient computation:

```javascript
// In SimplePolicy class
forwardWithCache(stateVec) {
    const hiddenPreRelu = new Float32Array(this.hiddenSize);
    const hidden = new Float32Array(this.hiddenSize);

    for (let j = 0; j < this.hiddenSize; j++) {
        let sum = this.b1[j];
        for (let i = 0; i < this.stateSize; i++) {
            sum += stateVec[i] * this.w1[i * this.hiddenSize + j];
        }
        hiddenPreRelu[j] = sum;
        hidden[j] = Math.max(0, sum);  // ReLU
    }

    // Output layer: softmax(hidden * W2 + b2)
    const logits = new Float32Array(this.outputSize);
    let maxLogit = -Infinity;
    for (let j = 0; j < this.outputSize; j++) {
        let sum = this.b2[j];
        for (let i = 0; i < this.hiddenSize; i++) {
            sum += hidden[i] * this.w2[i * this.outputSize + j];
        }
        logits[j] = sum;
        maxLogit = Math.max(maxLogit, sum);
    }

    // Softmax with numerical stability
    const probs = new Float32Array(this.outputSize);
    let sumExp = 0;
    for (let j = 0; j < this.outputSize; j++) {
        probs[j] = Math.exp(logits[j] - maxLogit);
        sumExp += probs[j];
    }
    for (let j = 0; j < this.outputSize; j++) {
        probs[j] /= sumExp;
    }

    return { hiddenPreRelu, hidden, logits, probs };
}
```

---

### 5. Gradient Computation (In-Place Accumulation)

**Performance note**: To avoid GC pauses in the browser, write gradients directly into the accumulator instead of allocating new arrays per step. The signature becomes:

```javascript
computeGradientsInto(acc, stateVec, actionIdx, advantage, cache)
```

Where `acc` is the pre-allocated accumulator that gets mutated.

For clarity, here's the math (actual implementation should use in-place writes):

```javascript
// In SimplePolicy class
computeGradients(stateVec, actionIdx, advantage, cache) {
    const { hiddenPreRelu, hidden, probs } = cache;

    // Clip advantage to prevent instability from reward spikes
    const clippedAdv = Math.max(-5, Math.min(5, advantage));

    // Gradient of log π(a|s) w.r.t. logits
    // For softmax: ∂log π(a)/∂logit_j = 1{j=a} - π(j)
    const dLogits = new Float32Array(this.outputSize);
    for (let j = 0; j < this.outputSize; j++) {
        dLogits[j] = ((j === actionIdx) ? 1 : 0) - probs[j];
    }

    // Gradient for W2: dL/dW2[i,j] = hidden[i] * dLogits[j]
    const gW2 = new Float32Array(this.hiddenSize * this.outputSize);
    for (let i = 0; i < this.hiddenSize; i++) {
        for (let j = 0; j < this.outputSize; j++) {
            gW2[i * this.outputSize + j] = clippedAdv * hidden[i] * dLogits[j];
        }
    }

    // Gradient for b2
    const gb2 = new Float32Array(this.outputSize);
    for (let j = 0; j < this.outputSize; j++) {
        gb2[j] = clippedAdv * dLogits[j];
    }

    // Backprop through hidden layer (using ORIGINAL W2)
    const dHidden = new Float32Array(this.hiddenSize);
    for (let i = 0; i < this.hiddenSize; i++) {
        let sum = 0;
        for (let j = 0; j < this.outputSize; j++) {
            sum += dLogits[j] * this.w2[i * this.outputSize + j];
        }
        // ReLU derivative: 1 if pre-activation > 0, else 0
        dHidden[i] = sum * (hiddenPreRelu[i] > 0 ? 1 : 0);
    }

    // Gradient for W1
    const gW1 = new Float32Array(this.stateSize * this.hiddenSize);
    for (let i = 0; i < this.stateSize; i++) {
        for (let j = 0; j < this.hiddenSize; j++) {
            gW1[i * this.hiddenSize + j] = clippedAdv * stateVec[i] * dHidden[j];
        }
    }

    // Gradient for b1
    const gb1 = new Float32Array(this.hiddenSize);
    for (let j = 0; j < this.hiddenSize; j++) {
        gb1[j] = clippedAdv * dHidden[j];
    }

    return { gW1, gb1, gW2, gb2 };
}
```

---

### 6. Apply Accumulated Gradients

Apply gradients after accumulating over the full rollout (ONE update per rollout, not 128):

```javascript
// In SimplePolicy class
applyGradients(accGrads, lr) {
    for (let i = 0; i < this.w1.length; i++) {
        this.w1[i] += lr * accGrads.gW1[i];
    }
    for (let i = 0; i < this.b1.length; i++) {
        this.b1[i] += lr * accGrads.gb1[i];
    }
    for (let i = 0; i < this.w2.length; i++) {
        this.w2[i] += lr * accGrads.gW2[i];
    }
    for (let i = 0; i < this.b2.length; i++) {
        this.b2[i] += lr * accGrads.gb2[i];
    }
}
```

**Why one update per rollout**: Calling backward() 128 times in a loop applies 128 separate SGD steps, where later updates use weights already changed by earlier steps. This compounds bias and makes the effective step size huge. Accumulating gradients and applying once is cleaner and more stable.

---

### 7. Training Method (Batch Gradient Accumulation)

```javascript
train() {
    // Compute raw returns (before normalization)
    const rawReturns = this.computeReturns();

    // Track raw metrics before normalization
    const sumRawReturns = rawReturns.reduce((a, b) => a + b, 0);
    this.lastAvgRawReturn = sumRawReturns / rawReturns.length;

    // Normalize returns (reduces variance)
    const returns = new Float32Array(rawReturns);
    const mean = sumRawReturns / returns.length;
    let variance = 0;
    for (let i = 0; i < returns.length; i++) {
        variance += (returns[i] - mean) ** 2;
    }
    const std = Math.sqrt(variance / returns.length) + 1e-8;
    for (let i = 0; i < returns.length; i++) {
        returns[i] = (returns[i] - mean) / std;
    }

    // Initialize gradient accumulators
    const accGrads = {
        gW1: new Float32Array(this.policy.stateSize * this.policy.hiddenSize),
        gb1: new Float32Array(this.policy.hiddenSize),
        gW2: new Float32Array(this.policy.hiddenSize * this.policy.outputSize),
        gb2: new Float32Array(this.policy.outputSize),
    };

    // Accumulate gradients over rollout + compute entropy
    let entropySum = 0;
    for (let t = 0; t < this.buffer.length; t++) {
        const state = this.buffer.states[t];
        const action = this.buffer.actions[t];
        const advantage = returns[t];

        // Forward pass with cache
        const cache = this.policy.forwardWithCache(state);

        // Compute entropy
        for (let i = 0; i < cache.probs.length; i++) {
            if (cache.probs[i] > 1e-8) {
                entropySum -= cache.probs[i] * Math.log(cache.probs[i]);
            }
        }

        // Compute gradients for this sample
        const grads = this.policy.computeGradients(state, action, advantage, cache);

        // Accumulate (sum over rollout)
        for (let i = 0; i < accGrads.gW1.length; i++) accGrads.gW1[i] += grads.gW1[i];
        for (let i = 0; i < accGrads.gb1.length; i++) accGrads.gb1[i] += grads.gb1[i];
        for (let i = 0; i < accGrads.gW2.length; i++) accGrads.gW2[i] += grads.gW2[i];
        for (let i = 0; i < accGrads.gb2.length; i++) accGrads.gb2[i] += grads.gb2[i];
    }

    this.lastEntropy = entropySum / this.buffer.length;

    // Average gradients over rollout size
    const n = this.buffer.length;
    for (let i = 0; i < accGrads.gW1.length; i++) accGrads.gW1[i] /= n;
    for (let i = 0; i < accGrads.gb1.length; i++) accGrads.gb1[i] /= n;
    for (let i = 0; i < accGrads.gW2.length; i++) accGrads.gW2[i] /= n;
    for (let i = 0; i < accGrads.gb2.length; i++) accGrads.gb2[i] /= n;

    // Apply ONE update with accumulated gradients
    this.policy.applyGradients(accGrads, this.learningRate);

    this.trainSteps++;
    this.clearBuffer();
}
```

**Key stability improvements:**
- Accumulate gradients over full rollout, then apply once (not 128 separate updates)
- Average gradients by rollout size (consistent effective learning rate)
- Advantage clipping in `computeGradients()` prevents instability from reward spikes
- Uses cached forward pass for consistency

**Naming note**: After normalization, `returns` becomes our "advantage" proxy. In actual implementation, rename to `advantages` after normalization to avoid confusion when adding a critic later (PPO will use `advantages = returns - V(s)`).

---

### 8. UI Metrics

Track meaningful metrics that won't be misleading:

```javascript
// In lab-init.js, extend pureRLMetrics
export const pureRLMetrics = writable({
    // Existing
    step: 0,
    action: null,
    reward: 0,
    totalReward: 0,
    epsilon: 0,  // Now always 0 (no epsilon-greedy)
    breakdown: { tier1: 0, tier2: 0, tier3: 0, penalties: 0 },
    firedTests: [],

    // Training metrics
    trainSteps: 0,           // number of gradient updates
    bufferFill: 0,           // current buffer size (0-128)
    avgRawReturn: 0,         // mean return BEFORE normalization (shows improvement)
    policyEntropy: 0,        // mean entropy of action distribution (shows exploration)

    // Per-rollout reward breakdown
    rolloutTier1: 0,
    rolloutTier2: 0,
    rolloutTier3: 0,
    rolloutPenalties: 0,
});
```

**Why avgRawReturn**: The normalized return will always be ~0 by construction. The raw return shows actual improvement.

**Why entropy**: As policy improves, entropy typically decreases (more confident). If entropy collapses to 0 too fast, we're overfitting.

---

### 9. Observation Scaling

Normalize all continuous inputs to [0, 1] range for consistent gradient magnitudes:

```javascript
function encodeState(state) {
    const vec = new Float32Array(16);
    let i = 0;

    // Position (normalized by max map size)
    vec[i++] = (state.coordinates?.x ?? 0) / 256;
    vec[i++] = (state.coordinates?.y ?? 0) / 256;

    // Location: use sin/cos of hash to avoid "map 200 > map 30" ordering problem
    // A raw hash makes the MLP treat it as a continuous ordered value, which is wrong
    const locHash = hashString(state.location || '');
    vec[i++] = Math.sin(locHash);
    vec[i++] = Math.cos(locHash);

    // Progress indicators (already normalized)
    vec[i++] = (state.badgeCount ?? 0) / 8;
    vec[i++] = (state.party?.length ?? 0) / 6;

    // Party stats
    if (state.party && state.party.length > 0) {
        const avgLevel = state.party.reduce((s, p) => s + (p.level || 0), 0) / state.party.length;
        vec[i++] = avgLevel / 100;

        const totalHP = state.party.reduce((s, p) => s + (p.currentHP || 0), 0);
        const maxHP = state.party.reduce((s, p) => s + (p.maxHP || 1), 0);
        vec[i++] = totalHP / Math.max(maxHP, 1);
    } else {
        vec[i++] = 0;
        vec[i++] = 0;
    }

    // Battle/dialog state (binary)
    vec[i++] = state.inBattle ? 1 : 0;
    vec[i++] = (state.dialog && state.dialog.length > 0) ? 1 : 0;

    // Money (log scale, normalized)
    vec[i++] = Math.log10((state.money || 0) + 1) / 6;

    // Pad remaining
    while (i < 16) vec[i++] = 0;

    return vec;
}
```

**Note on location hash**: A raw hash integer makes the MLP think "map 200 is larger than map 30" which is semantically wrong. Using sin/cos wraps it into a circular space. Better long-term: one-hot encoding or learned embeddings.

---

### 10. Reward Scaling (Prevent Reward Farming)

Cap tier-1 (movement) rewards per rollout to prevent "pacing around" behavior:

```javascript
// In UnitTestRewards or train()
this.tier1RewardThisRollout = 0;
const TIER1_CAP_PER_ROLLOUT = 5.0;

// When computing tier1 reward:
if (this.tier1RewardThisRollout < TIER1_CAP_PER_ROLLOUT) {
    const tier1 = 0.1;
    this.tier1RewardThisRollout += tier1;
    reward += tier1;
}
```

Also ensure movement rewards are for **tile changes**, not pixel changes (the current implementation already does this via coordinate comparison).

---

### 11. Configuration

```javascript
this.config = {
    // Existing (modified)
    // epsilon removed - pure policy sampling now

    // REINFORCE params
    rolloutSize: 128,        // steps per update (can start with 64 to validate faster)
    learningRate: 0.001,
    gamma: 0.99,
    normalizeReturns: true,
};
```

---

### 12. Done Detection & Environment Reset

```javascript
checkDone(prevState, currState) {
    // Whiteout (all Pokemon fainted)
    // IMPORTANT: .every() returns true on empty array, so check length first
    if (currState.party && currState.party.length > 0 &&
        currState.party.every(p => p.currentHP === 0)) {
        return true;
    }

    // Manual reset detected (e.g., location jump that's impossible)
    // This is optional - we can add more conditions as needed

    return false;
}
```

**When `done=true`, reset the environment:**

```javascript
// In step(), after storing to buffer:
if (done) {
    await this.resetEnv();  // Load known save state or soft reset
}

async resetEnv() {
    // Option 1: Load a saved state from early game
    if (this.checkpointState) {
        this.emu.loadState(this.checkpointState);
        // Settle frames: let emulator stabilize after state load
        // Prevents reward glitches from inconsistent RAM reads
        for (let i = 0; i < 4; i++) {
            this.emu.runFrame();
        }
    }
    // Option 2: Could also soft-reset to title screen
    // this.emu.pressButton('start+select+a+b', 60);
}
```

Without explicit reset, "episode boundary" is logical only but the world state continues—which can work for continuing tasks but is confusing when we call it "episode ended."

---

## Pre-Validation Tests

Before running on Pokemon, validate the implementation:

### Test 1: Finite-Difference Gradient Check

On a single (state, action) pair, numerically approximate gradients:

```javascript
function gradientCheck(policy, state, action, advantage) {
    const eps = 1e-5;

    // IMPORTANT: Define objective as J(θ) = advantage * log π_θ(a|s)
    // We're doing gradient ASCENT on J, so analytical gradient = advantage * ∇log π

    function objective(policy) {
        const probs = policy.forward(state);
        return advantage * Math.log(probs[action] + 1e-8);
    }

    // For each weight w_i:
    // numerical_grad[i] = (J(w_i + eps) - J(w_i - eps)) / (2 * eps)
    // Compare to analytical gradient from computeGradients()

    // If you accidentally gradient-check -log π (common mistake),
    // you'll think it's wrong when it's right.
}
```

If this fails, Pokemon results won't be trustworthy.

### Test 2: Two-Armed Bandit

Replace emulator with a simple bandit:
- action 0: reward 1 with prob 0.2
- action 1: reward 1 with prob 0.8

The policy should learn to pick action 1 within ~50 updates. This validates the entire buffer → returns → gradient → update pipeline.

---

## Implementation Estimate

| Component | Lines (est.) |
|-----------|--------------|
| Experience buffer with cloning & dones | ~25 |
| `forwardWithCache()` | ~35 |
| `computeGradients()` with advantage clipping | ~50 |
| `applyGradients()` | ~15 |
| `train()` with batch accumulation | ~50 |
| `step()` restructured (canonical loop) | ~40 |
| `checkDone()` + `resetEnv()` | ~20 |
| UI metrics updates | ~20 |
| **Total** | **~255** |

---

## Expected Behavior

### What REINFORCE Will Do
- Update policy weights every 128 steps
- Increase probability of actions that led to high returns
- Decrease probability of actions that led to low returns
- avgRawReturn should trend upward (even if noisy)
- Entropy should decrease gradually (more confident policy)

### What REINFORCE Won't Do (Yet)
- Converge quickly (high variance without baseline)
- Train stably (no clipping to prevent large updates)
- Reach Boulder Badge reliably (that requires PPO + tuning)

### Success Criteria
1. Gradient check passes (finite difference matches analytical)
2. Bandit test: learns to pick better arm in <100 updates
3. Pokemon: `avgRawReturn` trends upward over 1000+ updates
4. Pokemon: action distribution becomes non-uniform (entropy drops from ~1.8 to <1.5)

---

## Future: PPO Additions

After REINFORCE is validated:

1. **Value baseline** — Add critic network V(s), compute advantages A = R - V(s)
2. **PPO clipping** — Clip ratio π_new/π_old to [1-ε, 1+ε]
3. **Multiple epochs** — Reuse same rollout for K gradient updates
4. **Entropy bonus** — Add entropy term to loss to maintain exploration

These are additive changes, not rewrites. The gradient accumulation structure we're using is already PPO-compatible.
