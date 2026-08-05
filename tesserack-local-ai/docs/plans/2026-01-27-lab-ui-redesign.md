# Lab UI Redesign

**Date:** 2026-01-27
**Status:** Approved
**Goal:** Make Pure RL a first-class mode with professional dashboard aesthetics, hyperparameter controls, and learning visualization.

## Overview

Redesign the Lab view to be portfolio-quality. Game-centric layout with prominent live metrics. Two modes: Play (LLM-guided) and Train (RL), with the Train mode featuring algorithm selection, hyperparameter presets, and real-time learning charts.

## Layout Structure

```
┌──────────────────────────────────────────────────────────────────┐
│  HEADER                                                          │
│  [Play ○ | ● Train]  [REINFORCE ▼]  [Hyperparams]  [💾][📂] [1x▼] [▶]│
├────────────────────────────────────┬─────────────────────────────┤
│                                    │                             │
│                                    │   METRICS PANEL             │
│         GAME CANVAS                │   ─────────────             │
│           (60%)                    │   Step / Action / Buffer    │
│                                    │   Avg Return / Entropy      │
│         Aspect-ratio preserved     │                             │
│         Centered in space          │   ─────────────             │
│                                    │   CHART (tabbed)            │
│                                    │   [Return|Entropy|Rewards]  │
│                                    │   ┌───────────────────┐     │
│                                    │   │      📈           │     │
│                                    │   └───────────────────┘     │
│                                    │                             │
├────────────────────────────────────┴─────────────────────────────┤
│  REWARD BREAKDOWN BAR                                            │
│  ████ T1 Move  ██ T2 Map  █ T3 Goal  ░ Penalty                  │
└──────────────────────────────────────────────────────────────────┘
```

## Header Controls

### Left Group - Mode & Algorithm
- **Mode toggle**: Segmented control (`Play | Train`)
- **Algorithm dropdown**: Only visible in Train mode. Shows "REINFORCE" now, "PPO" later

### Center Group - Configuration
- **Hyperparams button**: Opens popover with presets + advanced sliders (Train mode only)
- **Save button**: Saves emulator state
- **Load button**: Opens dropdown of saved states

### Right Group - Playback
- **Speed dropdown**: `1x / 2x / 4x / 8x`
- **Step button**: Single step (only enabled when paused)
- **Run/Pause button**: Primary action, visually prominent

### Behavior
- Switching from Train → Play stops the agent and preserves state
- Loading a saved state works in both modes
- Algorithm dropdown disabled while running

## Metrics Panel (Train Mode)

```
┌─────────────────────────────┐
│  Step      1,234            │
│  Action    [RIGHT]          │  ← Pill/badge style
│  Updates   12               │
├─────────────────────────────┤
│  Buffer    ████████░░ 96/128│
├─────────────────────────────┤
│  Avg Return    +0.847       │  ← Green when positive
│  Entropy       1.23         │
├─────────────────────────────┤
│  [Return] [Entropy] [Rewards]│
│  ┌─────────────────────────┐│
│  │                    ╱──  ││
│  │               ╱───╯     ││
│  │          ╱───╯          ││
│  │     ╱───╯               ││
│  │ ───╯                    ││
│  └─────────────────────────┘│
│  Last 50 rollouts           │
└─────────────────────────────┘
```

### Chart Tabs
- **Return**: Avg return per rollout (default view)
- **Entropy**: Policy entropy over time
- **Rewards**: Stacked area showing T1/T2/T3 contributions

### Styling
- Minimal axes, no gridlines (dashboard clean)
- Smooth line with subtle gradient fill below
- Numbers use monospace font for alignment
- Color-coded values (green positive, red negative)

## Reward Breakdown Bar

```
┌──────────────────────────────────────────────────────────────────┐
│  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  │
│  T1 Movement    T2 Map Change    T3 Goal Progress    Penalties   │
│     +0.12          +0.05              +0.00            -0.02     │
└──────────────────────────────────────────────────────────────────┘
```

### Colors
- **T1 (Movement)**: Blue (`#74b9ff`)
- **T2 (Map)**: Teal (`#00cec9`)
- **T3 (Goal)**: Green (`#00b894`)
- **Penalties**: Red (`#d63031`)

### Interaction
- Segments animate smoothly as rewards come in
- When a tier fires, its segment briefly pulses

## Hyperparameters Popover

```
┌─────────────────────────────────────┐
│  Training Config                    │
├─────────────────────────────────────┤
│  Preset                             │
│  [Conservative] [Balanced] [Fast]   │
│                                     │
│  ▼ Advanced                         │
│  ┌─────────────────────────────────┐│
│  │ Learning Rate                   ││
│  │ ───●─────────────  0.01         ││
│  │                                 ││
│  │ Rollout Size                    ││
│  │ ─────●───────────  128          ││
│  │                                 ││
│  │ Discount (γ)                    ││
│  │ ────────────●────  0.99         ││
│  └─────────────────────────────────┘│
│                                     │
│  [Reset to Default]    [Apply]      │
└─────────────────────────────────────┘
```

### Preset Values

| Preset | Learning Rate | Rollout Size | Gamma |
|--------|---------------|--------------|-------|
| Conservative | 0.005 | 256 | 0.99 |
| Balanced | 0.01 | 128 | 0.99 |
| Fast | 0.05 | 64 | 0.95 |

### Behavior
- Changing a slider switches preset to "Custom"
- Apply closes popover and updates agent config
- Sliders disabled while running

## Play Mode (LLM-guided)

```
┌──────────────────────────────────────────────────────────────────┐
│  [● Play | ○ Train]                  [💾 Save] [📂 Load]  [▶ Run]│
├────────────────────────────────────┬─────────────────────────────┤
│                                    │                             │
│                                    │   AGENT PANEL               │
│         GAME CANVAS                │   ─────────────             │
│           (60%)                    │   Steps: 1,234              │
│                                    │   LLM Calls: 48             │
│                                    │   Objectives: 3/12          │
│                                    │                             │
│                                    │   ─────────────             │
│                                    │   Current Guide Context     │
│                                    │   [Pallet Town]             │
│                                    │   • Get Pokemon from Oak    │
│                                    │   • Exit to Route 1         │
│                                    │                             │
├────────────────────────────────────┴─────────────────────────────┤
│  Progress: ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░  12% complete   │
└──────────────────────────────────────────────────────────────────┘
```

### Key Differences from Train Mode
- No algorithm dropdown, no hyperparams button
- Metrics panel shows LLM-specific stats
- Shows current guide context instead of charts
- Bottom bar shows game progress instead of reward breakdown

### What Stays the Same
- Save/Load buttons work identically
- Speed controls work identically
- Same game canvas position and size

## Backwards Compatibility

- Save/Load state functionality preserved
- Existing labMode store ('llm' | 'purerl') maps to Play/Train
- All current metrics continue to be tracked

## Implementation Notes

### New Components Needed
- `ModeToggle.svelte` - Segmented control for Play/Train
- `HyperparamsPopover.svelte` - Preset selector + advanced sliders
- `MetricsChart.svelte` - Tabbed chart component (Return/Entropy/Rewards)
- `RewardBar.svelte` - Horizontal stacked bar visualization

### Store Changes
- Add chart history to `pureRLMetrics` (array of past rollout stats)
- Add hyperparameter config store with presets

### Charting
- Use Canvas 2D API for performance (no external lib)
- Keep last 50 data points, rolling window
