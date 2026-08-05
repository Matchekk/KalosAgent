// Training state store - manages neural network training
import { writable, derived } from 'svelte/store';

// Training instances (held, not reactive)
export const trainedPolicy = writable(null);
export const autoTrainer = writable(null);

// Model state
export const modelState = writable({
    hasModel: false,
    isTraining: false,
    sessions: 0,
    policyUsage: 0,
    nextAutoTrain: 3000,
});

// Training progress (during active training)
export const trainingProgress = writable({
    active: false,
    stage: '', // 'loading' | 'preparing' | 'training' | 'saving' | 'complete' | 'error'
    message: '',
    epoch: 0,
    totalEpochs: 0,
    loss: null,
    accuracy: null,
});

// Auto-train enabled
export const autoTrainEnabled = writable(true);

// Derived: model version string
export const modelVersion = derived(modelState, $state => {
    if (!$state.hasModel) return 'Not trained';
    return `v${$state.sessions}`;
});

// Update model state
export function updateModelState(update) {
    modelState.update(state => ({ ...state, ...update }));
}

// Update training progress
export function updateTrainingProgress(update) {
    trainingProgress.update(state => ({ ...state, ...update }));
}
