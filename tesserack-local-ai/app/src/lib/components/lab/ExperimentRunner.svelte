<script>
    import { Play, Download, Trash2, BarChart3 } from 'lucide-svelte';
    import {
        labConfig,
        labMetrics,
        experimentRuns,
        saveExperimentRun,
        loadExperimentHistory,
        resetMetrics
    } from '$lib/stores/lab';
    import { onMount } from 'svelte';

    // Experiment configuration
    let experimentName = '';
    let selectedVariable = 'llmQueryFrequency';
    let variableValues = '1, 5, 10, 25';
    let runsPerConfig = 1;
    let targetCheckpoint = 'Boulder Badge';

    // Available variables to sweep
    const variables = [
        { id: 'llmQueryFrequency', label: 'LLM Query Frequency', unit: 'steps' },
        { id: 'explorationRate', label: 'Exploration Rate', unit: '%' },
        { id: 'guideAdherenceWeight', label: 'Guide Adherence Weight', unit: '%' }
    ];

    // Checkpoints
    const checkpoints = [
        'Get Starter Pokemon',
        'Reach Viridian City',
        'Boulder Badge',
        'Cascade Badge',
        'Thunder Badge'
    ];

    // Experiment state
    let isRunning = false;
    let currentRun = 0;
    let totalRuns = 0;
    let results = [];

    onMount(() => {
        loadExperimentHistory();
    });

    function parseValues(str) {
        return str.split(',').map(v => {
            const num = parseFloat(v.trim());
            return isNaN(num) ? null : num;
        }).filter(v => v !== null);
    }

    async function runExperiment() {
        const values = parseValues(variableValues);
        if (values.length === 0) {
            alert('Please enter valid values to test');
            return;
        }

        if (!experimentName.trim()) {
            experimentName = `${selectedVariable}_sweep_${Date.now()}`;
        }

        isRunning = true;
        totalRuns = values.length * runsPerConfig;
        currentRun = 0;
        results = [];

        for (const value of values) {
            for (let run = 0; run < runsPerConfig; run++) {
                currentRun++;

                // Set the variable
                labConfig.update(c => ({
                    ...c,
                    [selectedVariable]: selectedVariable.includes('Rate') || selectedVariable.includes('Weight')
                        ? value / 100
                        : value
                }));

                // Reset metrics for this run
                resetMetrics();

                // Record run config
                const runResult = {
                    variable: selectedVariable,
                    value,
                    runIndex: run,
                    config: { ...$labConfig },
                    startTime: Date.now()
                };

                // TODO: Actually run the agent here
                // For now, simulate with a delay
                await new Promise(r => setTimeout(r, 500));

                // Capture metrics
                runResult.metrics = { ...$labMetrics };
                runResult.endTime = Date.now();
                runResult.duration = runResult.endTime - runResult.startTime;

                results.push(runResult);
            }
        }

        // Save experiment
        const experiment = {
            name: experimentName,
            variable: selectedVariable,
            values,
            runsPerConfig,
            targetCheckpoint,
            results,
            timestamp: Date.now()
        };

        // Store in localStorage
        const stored = JSON.parse(localStorage.getItem('tesserack_experiments') || '[]');
        stored.push(experiment);
        localStorage.setItem('tesserack_experiments', JSON.stringify(stored));

        isRunning = false;
    }

    function exportResults() {
        const data = {
            experiments: $experimentRuns,
            exportedAt: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tesserack_experiments_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function exportCSV() {
        if (results.length === 0) return;

        const headers = ['variable', 'value', 'run', 'steps', 'objectives', 'reward', 'duration_ms'];
        const rows = results.map(r => [
            r.variable,
            r.value,
            r.runIndex,
            r.metrics.totalSteps,
            r.metrics.objectivesCompleted,
            r.metrics.episodeReward.toFixed(2),
            r.duration
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `experiment_${experimentName}_${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function clearHistory() {
        if (confirm('Clear all experiment history?')) {
            localStorage.removeItem('tesserack_experiments');
            experimentRuns.set([]);
        }
    }
</script>

<div class="experiment-runner panel">
    <div class="runner-header">
        <BarChart3 size={18} />
        <h3>Experiment Runner</h3>
    </div>

    <div class="runner-form">
        <div class="form-group">
            <label for="exp-name">Experiment Name</label>
            <input
                id="exp-name"
                type="text"
                bind:value={experimentName}
                placeholder="e.g., query_frequency_sweep"
            />
        </div>

        <div class="form-row">
            <div class="form-group">
                <label for="var-sweep">Variable to Sweep</label>
                <select id="var-sweep" bind:value={selectedVariable}>
                    {#each variables as v}
                        <option value={v.id}>{v.label}</option>
                    {/each}
                </select>
            </div>

            <div class="form-group">
                <label for="var-values">Values ({variables.find(v => v.id === selectedVariable)?.unit})</label>
                <input
                    id="var-values"
                    type="text"
                    bind:value={variableValues}
                    placeholder="1, 5, 10, 25"
                />
            </div>
        </div>

        <div class="form-row">
            <div class="form-group">
                <label for="runs-per-config">Runs per Config</label>
                <input
                    id="runs-per-config"
                    type="number"
                    bind:value={runsPerConfig}
                    min="1"
                    max="10"
                />
            </div>

            <div class="form-group">
                <label for="target-checkpoint">Target Checkpoint</label>
                <select id="target-checkpoint" bind:value={targetCheckpoint}>
                    {#each checkpoints as cp}
                        <option value={cp}>{cp}</option>
                    {/each}
                </select>
            </div>
        </div>

        <div class="form-actions">
            <button class="run-btn" on:click={runExperiment} disabled={isRunning}>
                <Play size={16} />
                {isRunning ? `Running ${currentRun}/${totalRuns}...` : 'Run Experiment'}
            </button>
        </div>
    </div>

    {#if results.length > 0}
        <div class="results-section">
            <div class="results-header">
                <span>Results ({results.length} runs)</span>
                <button class="export-btn" on:click={exportCSV}>
                    <Download size={14} />
                    CSV
                </button>
            </div>

            <div class="results-table">
                <table>
                    <thead>
                        <tr>
                            <th>Value</th>
                            <th>Run</th>
                            <th>Steps</th>
                            <th>Objectives</th>
                            <th>Reward</th>
                        </tr>
                    </thead>
                    <tbody>
                        {#each results as r}
                            <tr>
                                <td>{r.value}</td>
                                <td>{r.runIndex + 1}</td>
                                <td>{r.metrics.totalSteps}</td>
                                <td>{r.metrics.objectivesCompleted}</td>
                                <td>{r.metrics.episodeReward.toFixed(1)}</td>
                            </tr>
                        {/each}
                    </tbody>
                </table>
            </div>
        </div>
    {/if}

    {#if $experimentRuns.length > 0}
        <div class="history-section">
            <div class="history-header">
                <span>History ({$experimentRuns.length})</span>
                <div class="history-actions">
                    <button class="icon-btn" on:click={exportResults} title="Export all">
                        <Download size={14} />
                    </button>
                    <button class="icon-btn danger" on:click={clearHistory} title="Clear history">
                        <Trash2 size={14} />
                    </button>
                </div>
            </div>

            <div class="history-list">
                {#each $experimentRuns.slice(-5).reverse() as exp}
                    <div class="history-item">
                        <span class="exp-name">{exp.name || 'Unnamed'}</span>
                        <span class="exp-date">{new Date(exp.timestamp).toLocaleDateString()}</span>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>

<style>
    .experiment-runner {
        padding: 16px;
    }

    .runner-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
        color: var(--text-primary);
    }

    .runner-header h3 {
        margin: 0;
        font-size: 14px;
    }

    .runner-form {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .form-group label {
        font-size: 11px;
        color: var(--text-muted);
        text-transform: uppercase;
    }

    .form-group input,
    .form-group select {
        padding: 8px 10px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        font-size: 13px;
    }

    .form-group input:focus,
    .form-group select:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }

    .form-actions {
        margin-top: 8px;
    }

    .run-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        padding: 10px;
        background: var(--accent-primary);
        border: none;
        border-radius: 6px;
        color: white;
        font-weight: 500;
        cursor: pointer;
        transition: filter 0.15s;
    }

    .run-btn:hover:not(:disabled) {
        filter: brightness(1.1);
    }

    .run-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
    }

    .results-section,
    .history-section {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid var(--border-color);
    }

    .results-header,
    .history-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
        font-size: 12px;
        color: var(--text-secondary);
    }

    .export-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: var(--bg-input);
        border: none;
        border-radius: 4px;
        color: var(--text-secondary);
        font-size: 11px;
        cursor: pointer;
    }

    .export-btn:hover {
        background: var(--bg-input);
    }

    .results-table {
        max-height: 200px;
        overflow-y: auto;
    }

    .results-table table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
    }

    .results-table th,
    .results-table td {
        padding: 6px 8px;
        text-align: left;
        border-bottom: 1px solid var(--border-color);
    }

    .results-table th {
        color: var(--text-muted);
        font-weight: 500;
    }

    .results-table td {
        color: var(--text-secondary);
    }

    .history-actions {
        display: flex;
        gap: 4px;
    }

    .icon-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: var(--bg-input);
        border: none;
        border-radius: 4px;
        color: var(--text-muted);
        cursor: pointer;
    }

    .icon-btn:hover {
        background: var(--bg-input);
        color: var(--text-secondary);
    }

    .icon-btn.danger:hover {
        background: rgba(214, 48, 49, 0.2);
        color: var(--accent-secondary);
    }

    .history-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .history-item {
        display: flex;
        justify-content: space-between;
        padding: 6px 8px;
        background: var(--bg-input);
        border-radius: 4px;
        font-size: 12px;
    }

    .exp-name {
        color: var(--text-secondary);
    }

    .exp-date {
        color: var(--text-muted);
    }
</style>
