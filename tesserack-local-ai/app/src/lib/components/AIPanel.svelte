<script>
    import { activeMode, aiState, stats, objectiveOverride } from '$lib/stores/agent';
    import { trainingProgress } from '$lib/stores/training';
    import { setObjectiveOverride, clearObjectiveOverride } from '$lib/core/game-init.js';
    import { Brain, Sparkles, Target, Zap, ArrowRight, ChevronDown, ChevronUp, Eye, Lightbulb, Edit3, X, MapPin, TrendingUp } from 'lucide-svelte';

    $: isRunning = $activeMode !== 'idle';

    let showGameState = false;
    let editingObjective = false;
    let customObjective = '';

    function startEditObjective() {
        customObjective = $objectiveOverride || $aiState.objective || '';
        editingObjective = true;
    }

    function saveObjective() {
        if (customObjective.trim()) {
            setObjectiveOverride(customObjective.trim());
        }
        editingObjective = false;
    }

    function cancelEdit() {
        editingObjective = false;
        customObjective = '';
    }

    function clearOverride() {
        clearObjectiveOverride();
        objectiveOverride.set('');
    }

    function handleKeypress(e) {
        if (e.key === 'Enter') {
            saveObjective();
        } else if (e.key === 'Escape') {
            cancelEdit();
        }
    }

    // Parse reasoning into plan and status
    $: parsedReasoning = parseReasoning($aiState.reasoning);

    function parseReasoning(text) {
        if (!text) return { plan: '', status: '', remaining: null };

        // Check for "Executing: X (Y remaining)" format
        const execMatch = text.match(/Executing:\s*(.+?)\s*\((\d+)\s*remaining\)/);
        if (execMatch) {
            return {
                plan: execMatch[1].trim(),
                status: 'executing',
                remaining: parseInt(execMatch[2])
            };
        }

        // Check for "Plan [source]" format
        const planMatch = text.match(/^(.+?)\s*\[([^\]]+)\]$/);
        if (planMatch) {
            return {
                plan: planMatch[1].trim(),
                status: 'planning',
                source: planMatch[2]
            };
        }

        return { plan: text, status: 'thinking' };
    }

    // Format action for display
    function formatAction(action) {
        const icons = {
            'up': '↑', 'down': '↓', 'left': '←', 'right': '→',
            'a': 'A', 'b': 'B', 'start': 'ST', 'select': 'SE'
        };
        return icons[action.toLowerCase()] || action;
    }
</script>

<div class="ai-panel panel">
    {#if $trainingProgress.active}
        <!-- Training in progress -->
        <div class="panel-header">
            <Sparkles size={16} class="header-icon training" />
            <span class="panel-title">Training Model</span>
        </div>

        <div class="training-status">
            <div class="progress-text">{$trainingProgress.message}</div>
            <div class="progress-bar">
                <div
                    class="progress-fill"
                    style="width: {($trainingProgress.epoch / $trainingProgress.totalEpochs) * 100}%"
                ></div>
            </div>
            {#if $trainingProgress.accuracy}
                <div class="training-metric">
                    Accuracy: {($trainingProgress.accuracy * 100).toFixed(1)}%
                </div>
            {/if}
        </div>

    {:else if isRunning}
        <!-- AI is running -->
        <div class="panel-header">
            <Brain size={16} class="header-icon active" />
            <span class="panel-title">AI Thinking</span>
            {#if parsedReasoning.status === 'executing'}
                <span class="status-badge executing">
                    <Zap size={10} />
                    Executing
                </span>
            {:else if parsedReasoning.status === 'planning'}
                <span class="status-badge planning">Planning</span>
            {/if}
        </div>

        {#if editingObjective}
            <div class="objective-edit">
                <input
                    type="text"
                    bind:value={customObjective}
                    on:keydown={handleKeypress}
                    placeholder="Enter custom objective..."
                />
                <div class="edit-actions">
                    <button class="btn-save" on:click={saveObjective}>Save</button>
                    <button class="btn-cancel" on:click={cancelEdit}>Cancel</button>
                </div>
            </div>
        {:else if $aiState.objective}
            <div class="objective-row" class:override={$aiState.objectiveOverrideActive}>
                <Target size={14} class="objective-icon" />
                <div class="objective-content">
                    <div class="objective-header">
                        <span class="objective-text">{$aiState.objective}</span>
                        {#if $aiState.objectiveOverrideActive}
                            <span class="override-badge">CUSTOM</span>
                            <button class="btn-icon" on:click={clearOverride} title="Clear override">
                                <X size={12} />
                            </button>
                        {/if}
                        <button class="btn-icon edit-btn" on:click={startEditObjective} title="Set custom objective">
                            <Edit3 size={12} />
                        </button>
                    </div>
                    {#if $aiState.objectiveHint && !$aiState.objectiveOverrideActive}
                        <div class="objective-hint">
                            <Lightbulb size={12} />
                            <span>{$aiState.objectiveHint}</span>
                        </div>
                    {/if}
                </div>
            </div>

            {#if $aiState.progress}
                <div class="progress-section">
                    <div class="progress-header">
                        <TrendingUp size={12} />
                        <span>Progress to Checkpoint</span>
                        <span class="progress-percent">{$aiState.progress.distancePercent}%</span>
                    </div>
                    <div class="checkpoint-progress-bar">
                        <div class="checkpoint-progress-fill" style="width: {$aiState.progress.distancePercent}%"></div>
                    </div>
                    <div class="progress-details">
                        <span class="region-badge">
                            <MapPin size={10} />
                            {$aiState.progress.region || 'unknown'}
                        </span>
                        <span class="game-progress">
                            Game: {$aiState.progress.gameProgress}%
                        </span>
                    </div>
                </div>
            {/if}
        {:else}
            <button class="set-objective-btn" on:click={startEditObjective}>
                <Target size={14} />
                <span>Set Custom Objective</span>
            </button>
        {/if}

        <div class="plan-box">
            <div class="plan-label">Current Strategy</div>
            <div class="plan-text">
                {parsedReasoning.plan || 'Analyzing game state...'}
            </div>
            {#if parsedReasoning.remaining !== null && parsedReasoning.remaining !== undefined}
                <div class="remaining-bar">
                    <div class="remaining-fill" style="width: {Math.min(100, parsedReasoning.remaining * 10)}%"></div>
                </div>
                <div class="remaining-text">{parsedReasoning.remaining} actions queued</div>
            {/if}
        </div>

        {#if $aiState.actions.length > 0}
            <div class="actions">
                <span class="actions-label">Next:</span>
                <div class="action-buttons">
                    {#each $aiState.actions.slice(0, 8) as action, i}
                        <span class="action-btn" class:current={i === 0}>
                            {formatAction(action)}
                        </span>
                        {#if i < Math.min($aiState.actions.length - 1, 7)}
                            <ArrowRight size={10} class="action-arrow" />
                        {/if}
                    {/each}
                    {#if $aiState.actions.length > 8}
                        <span class="more-actions">+{$aiState.actions.length - 8}</span>
                    {/if}
                </div>
            </div>
        {/if}

        {#if $aiState.planSource}
            <div class="source">
                via <span class="source-name">{$aiState.planSource}</span>
            </div>
        {/if}

        <!-- Collapsible game state view -->
        {#if $aiState.gameState}
            <button class="state-toggle" on:click={() => showGameState = !showGameState}>
                <Eye size={12} />
                <span>What LLM Sees</span>
                {#if showGameState}
                    <ChevronUp size={12} />
                {:else}
                    <ChevronDown size={12} />
                {/if}
            </button>

            {#if showGameState}
                <div class="game-state-box">
                    <div class="state-row">
                        <span class="state-label">Location</span>
                        <span class="state-value">{$aiState.gameState.location}</span>
                    </div>
                    <div class="state-row">
                        <span class="state-label">Coords</span>
                        <span class="state-value">({$aiState.gameState.coordinates?.x}, {$aiState.gameState.coordinates?.y})</span>
                    </div>
                    {#if $aiState.gameState.party?.length > 0}
                        <div class="state-row">
                            <span class="state-label">Party</span>
                            <span class="state-value">
                                {$aiState.gameState.party.map(p => `${p.species} Lv${p.level}`).join(', ')}
                            </span>
                        </div>
                    {/if}
                    {#if $aiState.gameState.inBattle}
                        <div class="state-row battle">
                            <span class="state-label">Status</span>
                            <span class="state-value">IN BATTLE</span>
                        </div>
                    {/if}
                    {#if $aiState.gameState.dialog}
                        <div class="state-row">
                            <span class="state-label">Dialog</span>
                            <span class="state-value dialog">"{$aiState.gameState.dialog}"</span>
                        </div>
                    {/if}
                </div>
            {/if}
        {/if}

    {:else}
        <!-- Idle state -->
        <div class="panel-header">
            <Brain size={16} class="header-icon" />
            <span class="panel-title">AI Status</span>
        </div>

        <div class="idle-content">
            <p class="idle-message">Press <strong>Start</strong> to let the AI play.</p>
            <p class="idle-hint">You can use the gamepad anytime, whether AI is running or not.</p>
        </div>
    {/if}
</div>

<style>
    .ai-panel {
        min-height: 140px;
    }

    .panel-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 12px;
    }

    .panel-header :global(.header-icon) {
        color: var(--text-muted);
    }

    .panel-header :global(.header-icon.active) {
        color: var(--accent-primary);
        animation: pulse-icon 2s ease-in-out infinite;
    }

    .panel-header :global(.header-icon.training) {
        color: var(--accent-success);
        animation: pulse-icon 1s ease-in-out infinite;
    }

    @keyframes pulse-icon {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
    }

    .panel-title {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-secondary);
    }

    .status-badge {
        margin-left: auto;
        font-size: 10px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .status-badge.executing {
        background: rgba(116, 185, 255, 0.2);
        color: var(--accent-primary);
    }

    .status-badge.planning {
        background: rgba(253, 203, 110, 0.2);
        color: #fdcb6e;
    }

    .objective-row {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        margin-bottom: 12px;
        padding: 8px 10px;
        background: rgba(116, 185, 255, 0.1);
        border-radius: var(--border-radius-sm);
        border-left: 3px solid var(--accent-primary);
    }

    .objective-row :global(.objective-icon) {
        color: var(--accent-primary);
        flex-shrink: 0;
        margin-top: 2px;
    }

    .objective-row.override {
        border-left-color: #fdcb6e;
        background: rgba(253, 203, 110, 0.1);
    }

    .objective-row.override :global(.objective-icon) {
        color: #fdcb6e;
    }

    .objective-header {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .override-badge {
        font-size: 9px;
        font-weight: 700;
        padding: 2px 6px;
        background: #fdcb6e;
        color: #1a1a2e;
        border-radius: 3px;
        letter-spacing: 0.5px;
    }

    .btn-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        background: transparent;
        border: none;
        color: var(--text-muted);
        cursor: pointer;
        border-radius: 4px;
        transition: all 0.2s;
    }

    .btn-icon:hover {
        background: var(--bg-input);
        color: var(--text-primary);
    }

    .edit-btn {
        margin-left: auto;
        opacity: 0;
        transition: opacity 0.2s;
    }

    .objective-row:hover .edit-btn {
        opacity: 1;
    }

    .objective-edit {
        background: var(--bg-input);
        border-radius: var(--border-radius-sm);
        padding: 12px;
        margin-bottom: 12px;
    }

    .objective-edit input {
        width: 100%;
        padding: 10px 12px;
        font-size: 13px;
        background: var(--bg-dark);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        color: var(--text-primary);
        margin-bottom: 10px;
    }

    .objective-edit input:focus {
        outline: none;
        border-color: var(--accent-primary);
    }

    .edit-actions {
        display: flex;
        gap: 8px;
    }

    .btn-save {
        padding: 6px 14px;
        background: var(--accent-primary);
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
    }

    .btn-save:hover {
        opacity: 0.9;
    }

    .btn-cancel {
        padding: 6px 14px;
        background: transparent;
        color: var(--text-muted);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
    }

    .btn-cancel:hover {
        color: var(--text-primary);
        border-color: var(--text-muted);
    }

    .set-objective-btn {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 12px;
        margin-bottom: 12px;
        background: var(--bg-input);
        border: 1px dashed var(--border-color);
        border-radius: var(--border-radius-sm);
        color: var(--text-muted);
        font-size: 13px;
        cursor: pointer;
        transition: all 0.2s;
    }

    .set-objective-btn:hover {
        border-color: var(--accent-primary);
        color: var(--accent-primary);
    }

    .objective-content {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .objective-text {
        font-size: 13px;
        font-weight: 500;
        color: var(--text-primary);
        line-height: 1.4;
    }

    .objective-hint {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        font-size: 12px;
        color: var(--text-muted);
        line-height: 1.4;
    }

    .objective-hint :global(svg) {
        flex-shrink: 0;
        margin-top: 2px;
        color: #fdcb6e;
    }

    .plan-box {
        background: var(--bg-input);
        border-radius: var(--border-radius-sm);
        padding: 12px;
        margin-bottom: 12px;
    }

    .plan-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
        margin-bottom: 6px;
    }

    .plan-text {
        font-size: 13px;
        color: var(--text-secondary);
        line-height: 1.5;
    }

    .remaining-bar {
        height: 3px;
        background: var(--bg-dark);
        border-radius: 2px;
        margin-top: 10px;
        overflow: hidden;
    }

    .remaining-fill {
        height: 100%;
        background: var(--accent-primary);
        transition: width 0.3s ease;
    }

    .remaining-text {
        font-size: 11px;
        color: var(--text-muted);
        margin-top: 4px;
    }

    .actions {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
    }

    .actions-label {
        font-size: 12px;
        color: var(--text-muted);
    }

    .action-buttons {
        display: flex;
        align-items: center;
        gap: 4px;
        flex-wrap: wrap;
    }

    .action-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 24px;
        padding: 0 6px;
        background: var(--bg-input);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        font-size: 11px;
        font-weight: 600;
        font-family: monospace;
        color: var(--text-secondary);
    }

    .action-btn.current {
        background: var(--accent-primary);
        border-color: var(--accent-primary);
        color: white;
    }

    .action-buttons :global(.action-arrow) {
        color: var(--text-muted);
    }

    .more-actions {
        font-size: 11px;
        color: var(--text-muted);
        margin-left: 4px;
    }

    .source {
        font-size: 11px;
        color: var(--text-muted);
    }

    .source-name {
        color: var(--text-secondary);
        font-weight: 500;
    }

    .training-status {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .progress-bar {
        height: 6px;
        background: var(--bg-dark);
        border-radius: 3px;
        overflow: hidden;
    }

    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-success), #55efc4);
        transition: width 0.3s;
    }

    .progress-text {
        font-size: 13px;
        color: var(--text-secondary);
    }

    .training-metric {
        font-size: 12px;
        color: var(--accent-success);
        font-weight: 500;
    }

    .idle-content {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .idle-message {
        font-size: 14px;
        color: var(--text-primary);
        margin: 0;
    }

    .idle-message strong {
        color: var(--accent-primary);
    }

    .idle-hint {
        font-size: 12px;
        color: var(--text-muted);
        margin: 0;
    }

    .state-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 8px 0;
        margin-top: 8px;
        background: transparent;
        border: none;
        border-top: 1px solid var(--border-color);
        color: var(--text-muted);
        font-size: 11px;
        cursor: pointer;
        transition: color 0.2s;
    }

    .state-toggle:hover {
        color: var(--text-secondary);
    }

    .game-state-box {
        background: var(--bg-dark);
        border-radius: var(--border-radius-sm);
        padding: 10px;
        margin-top: 8px;
        font-size: 11px;
    }

    .state-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        border-bottom: 1px solid var(--border-color);
    }

    .state-row:last-child {
        border-bottom: none;
    }

    .state-row.battle {
        color: var(--accent-secondary);
    }

    .state-label {
        color: var(--text-muted);
        font-weight: 500;
    }

    .state-value {
        color: var(--text-secondary);
        text-align: right;
        max-width: 60%;
    }

    .state-value.dialog {
        font-style: italic;
        font-size: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .progress-section {
        background: var(--bg-input);
        border-radius: var(--border-radius-sm);
        padding: 10px;
        margin-bottom: 12px;
    }

    .progress-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--text-muted);
        margin-bottom: 8px;
    }

    .progress-header :global(svg) {
        color: var(--accent-success);
    }

    .progress-percent {
        margin-left: auto;
        font-weight: 600;
        color: var(--accent-success);
    }

    .checkpoint-progress-bar {
        height: 6px;
        background: var(--bg-dark);
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 8px;
    }

    .checkpoint-progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-success), #55efc4);
        transition: width 0.5s ease;
        border-radius: 3px;
    }

    .progress-details {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 10px;
    }

    .region-badge {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: rgba(116, 185, 255, 0.15);
        border-radius: 10px;
        color: var(--accent-primary);
        text-transform: capitalize;
    }

    .game-progress {
        color: var(--text-muted);
    }
</style>
