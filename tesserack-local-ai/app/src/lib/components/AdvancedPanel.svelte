<script>
    import { modelState, autoTrainEnabled } from '$lib/stores/training';
    import { stats } from '$lib/stores/agent';
    import { ChevronDown, ChevronUp, Download, Trash2 } from 'lucide-svelte';
    import {
        trainNow as doTrainNow,
        clearModel as doClearModel,
        exportTrainingData,
        exportModel,
    } from '$lib/core/game-init.js';

    let expanded = false;

    async function trainNow() {
        await doTrainNow();
    }

    async function clearModel() {
        if (confirm('Clear the trained model? You will need to retrain.')) {
            await doClearModel();
        }
    }

    function exportData() {
        const data = exportTrainingData();
        if (data) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tesserack-training-data.json';
            a.click();
            URL.revokeObjectURL(url);
        }
    }

    async function exportModelData() {
        const data = await exportModel();
        if (data) {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'tesserack-model.json';
            a.click();
            URL.revokeObjectURL(url);
        }
    }
</script>

<div class="advanced-panel">
    <button class="toggle-btn" on:click={() => expanded = !expanded}>
        {#if expanded}
            <ChevronUp size={16} />
        {:else}
            <ChevronDown size={16} />
        {/if}
        Advanced
    </button>

    {#if expanded}
        <div class="advanced-content">
            <!-- Training Section -->
            <div class="section">
                <div class="section-title">Neural Network Training</div>
                <div class="section-content">
                    <div class="stat-row">
                        <span class="stat-label">Experiences</span>
                        <span class="stat-value">{$stats.experiences.toLocaleString()}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Training Sessions</span>
                        <span class="stat-value">{$modelState.sessions}</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Policy Usage</span>
                        <span class="stat-value">{$modelState.policyUsage}%</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">Next Auto-Train</span>
                        <span class="stat-value">{$modelState.nextAutoTrain.toLocaleString()} steps</span>
                    </div>

                    <div class="button-row">
                        <button class="btn-primary" on:click={trainNow}>
                            Train Now
                        </button>
                        <button class="btn-ghost" on:click={clearModel}>
                            <Trash2 size={14} />
                            Clear Model
                        </button>
                    </div>

                    <label class="toggle-row">
                        <input type="checkbox" bind:checked={$autoTrainEnabled} />
                        <span>Auto-train when threshold reached</span>
                    </label>
                </div>
            </div>

            <!-- Export Section -->
            <div class="section">
                <div class="section-title">Data Export</div>
                <div class="section-content">
                    <div class="button-row">
                        <button class="btn-ghost" on:click={exportData}>
                            <Download size={14} />
                            Export Training Data
                        </button>
                        <button class="btn-ghost" on:click={exportModelData}>
                            <Download size={14} />
                            Export Model
                        </button>
                    </div>
                </div>
            </div>
        </div>
    {/if}
</div>

<style>
    .advanced-panel {
        margin-top: 16px;
        border-top: 1px solid var(--border-color);
        padding-top: 16px;
    }

    .toggle-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        background: transparent;
        color: var(--text-secondary);
        font-size: 13px;
        padding: 8px 12px;
    }

    .toggle-btn:hover {
        color: var(--text-primary);
    }

    .advanced-content {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 20px;
        margin-top: 16px;
        padding: 20px;
        background: var(--bg-panel);
        border-radius: var(--border-radius);
    }

    .section-title {
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-secondary);
        margin-bottom: 12px;
    }

    .stat-row {
        display: flex;
        justify-content: space-between;
        padding: 6px 0;
        font-size: 13px;
    }

    .stat-label {
        color: var(--text-secondary);
    }

    .stat-value {
        color: var(--text-primary);
        font-weight: 500;
    }

    .button-row {
        display: flex;
        gap: 8px;
        margin-top: 12px;
        flex-wrap: wrap;
    }

    .button-row button {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        padding: 8px 12px;
    }

    .toggle-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 12px;
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
    }

    .toggle-row input {
        cursor: pointer;
    }
</style>
