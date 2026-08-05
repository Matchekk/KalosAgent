# Lab UI Redesign - Implementation Plan

**Design:** [2026-01-27-lab-ui-redesign.md](./2026-01-27-lab-ui-redesign.md)

## Task Breakdown

### Phase 1: Stores & Data Layer

#### Task 1.1: Create hyperparameter config store
**File:** `app/src/lib/stores/lab.js`

Add:
```javascript
export const rlConfig = writable({
  preset: 'balanced', // 'conservative' | 'balanced' | 'fast' | 'custom'
  learningRate: 0.01,
  rolloutSize: 128,
  gamma: 0.99,
});

export const RL_PRESETS = {
  conservative: { learningRate: 0.005, rolloutSize: 256, gamma: 0.99 },
  balanced: { learningRate: 0.01, rolloutSize: 128, gamma: 0.99 },
  fast: { learningRate: 0.05, rolloutSize: 64, gamma: 0.95 },
};

export function applyPreset(presetName) {
  const preset = RL_PRESETS[presetName];
  if (preset) {
    rlConfig.set({ preset: presetName, ...preset });
  }
}
```

#### Task 1.2: Add chart history to pureRLMetrics
**File:** `app/src/lib/core/lab/lab-init.js`

Extend `pureRLMetrics` store:
```javascript
export const pureRLMetrics = writable({
  // ... existing fields ...
  // Chart history (rolling window of last 50 rollouts)
  history: {
    returns: [],    // { step, value }[]
    entropy: [],    // { step, value }[]
    rewards: [],    // { step, t1, t2, t3, penalties }[]
  },
  maxHistoryLength: 50,
});
```

Update `handlePureRLStep` to append to history on each training update.

---

### Phase 2: New Components

#### Task 2.1: Create ModeToggle component
**File:** `app/src/lib/components/lab/ModeToggle.svelte`

Segmented control with Play/Train options.
- Props: `mode` ('play' | 'train'), `on:change`
- Styling: Clean segmented control, active state highlighted

#### Task 2.2: Create HyperparamsPopover component
**File:** `app/src/lib/components/lab/HyperparamsPopover.svelte`

Popover with:
- Preset selector (3 buttons: Conservative/Balanced/Fast)
- Collapsible "Advanced" section with sliders
- Reset to Default + Apply buttons
- Props: `open`, `disabled`, `on:apply`, `on:close`
- Reads/writes to `rlConfig` store

#### Task 2.3: Create MetricsChart component
**File:** `app/src/lib/components/lab/MetricsChart.svelte`

Tabbed chart using Canvas 2D:
- Props: `history` (from pureRLMetrics.history), `activeTab`
- Tabs: Return | Entropy | Rewards
- Return/Entropy: Line chart with gradient fill
- Rewards: Stacked area chart (T1/T2/T3/Penalties)
- Responsive sizing, dashboard aesthetic

#### Task 2.4: Create RewardBar component
**File:** `app/src/lib/components/lab/RewardBar.svelte`

Horizontal stacked bar:
- Props: `breakdown` ({ t1, t2, t3, penalties })
- Shows proportional segments with colors
- Labels below with actual values
- Smooth animation on value changes

---

### Phase 3: Refactor LabView

#### Task 3.1: New header layout
**File:** `app/src/lib/components/lab/LabView.svelte`

Replace current header with:
- ModeToggle (left)
- Algorithm dropdown (Train mode only)
- HyperparamsPopover trigger (Train mode only)
- Save/Load buttons
- Speed dropdown
- Step button
- Run/Pause button (primary)

#### Task 3.2: New main content layout
Restructure to:
- 60/40 split (game canvas / metrics panel)
- Remove old pipeline panel and LLM instructions panel
- Metrics panel shows Train or Play content based on mode

#### Task 3.3: Train mode metrics panel
When mode === 'train':
- Live stats (Step, Action, Updates, Buffer)
- Avg Return, Entropy
- MetricsChart component
- Remove old rl-metrics-panel, use new structure

#### Task 3.4: Play mode metrics panel
When mode === 'play':
- Steps, LLM Calls, Objectives
- Current guide context
- Keep existing guide context logic

#### Task 3.5: Bottom bar
- Train mode: RewardBar component
- Play mode: Progress bar (existing completionPercentage)

---

### Phase 4: Wire Up Hyperparams

#### Task 4.1: Connect rlConfig to PureRLAgent
**File:** `app/src/lib/core/lab/lab-init.js`

- Subscribe to `rlConfig` changes
- When Apply is clicked (and agent paused), recreate ReinforceCore with new config
- Or queue config update for next rollout boundary

#### Task 4.2: Expose config update method on PureRLAgent
**File:** `app/src/lib/core/lab/pure-rl-agent.js`

Add method:
```javascript
updateConfig({ learningRate, rolloutSize, gamma }) {
  // Update core's config
  // May need to resize buffer if rolloutSize changes
}
```

---

### Phase 5: Polish & Testing

#### Task 5.1: Responsive styling
- Ensure layout works at different viewport sizes
- Test dark mode compatibility

#### Task 5.2: Animation polish
- Buffer bar smooth fill
- Reward bar segment transitions
- Chart line animations

#### Task 5.3: Manual testing
- Play mode: Run agent, save/load states
- Train mode: Run training, change hyperparams, verify charts update
- Mode switching: Verify state preserved

---

## Execution Order

1. **1.1, 1.2** - Stores (no UI changes yet)
2. **2.1** - ModeToggle (can test standalone)
3. **2.4** - RewardBar (simple, can test standalone)
4. **2.3** - MetricsChart (most complex, needs history data)
5. **2.2** - HyperparamsPopover
6. **3.1 - 3.5** - Refactor LabView (integrate everything)
7. **4.1, 4.2** - Wire hyperparams to agent
8. **5.1 - 5.3** - Polish and test

## Files Changed

- `app/src/lib/stores/lab.js` (modify)
- `app/src/lib/core/lab/lab-init.js` (modify)
- `app/src/lib/core/lab/pure-rl-agent.js` (modify)
- `app/src/lib/components/lab/ModeToggle.svelte` (new)
- `app/src/lib/components/lab/HyperparamsPopover.svelte` (new)
- `app/src/lib/components/lab/MetricsChart.svelte` (new)
- `app/src/lib/components/lab/RewardBar.svelte` (new)
- `app/src/lib/components/lab/LabView.svelte` (major refactor)
