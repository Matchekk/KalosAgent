<script>
    import { CheckCircle, Circle, AlertTriangle, Info, ChevronDown } from 'lucide-svelte';

    // Props
    export let currentLocation = null;
    export let bundleInfo = null;
    export let firedTests = [];
    export let totalRewards = { tier1: 0, tier2: 0, tier3: 0, penalties: 0, total: 0 };
    export let completedObjectives = [];

    let showInfo = false;

    // Format reward with sign
    function formatReward(reward) {
        const sign = reward >= 0 ? '+' : '';
        return `${sign}${reward.toFixed(2)}`;
    }

    // Get tier label
    function getTierLabel(tier) {
        if (tier === 1) return 'T1';
        if (tier === 2) return 'T2';
        if (tier === 3) return 'T3';
        if (tier === 'penalty') return 'P';
        return '?';
    }

    // Get tier class for styling
    function getTierClass(tier) {
        if (tier === 1) return 'tier1';
        if (tier === 2) return 'tier2';
        if (tier === 3) return 'tier3';
        if (tier === 'penalty') return 'penalty';
        return '';
    }

    // Calculate bar widths for visualization
    $: maxReward = Math.max(
        Math.abs(totalRewards.tier1),
        Math.abs(totalRewards.tier2),
        Math.abs(totalRewards.tier3),
        Math.abs(totalRewards.penalties),
        1
    );
</script>

<div class="tests-panel">
    <div class="panel-header">
        <span class="panel-title">Tests</span>
        {#if currentLocation}
            <span class="location-badge">{currentLocation}</span>
        {/if}
    </div>

    <div class="panel-content">
        <!-- Bundle Info -->
        {#if bundleInfo}
            <div class="bundle-info">
                <span class="bundle-stat">{bundleInfo.testCount} tests</span>
                <span class="bundle-divider">·</span>
                <span class="bundle-stat">{bundleInfo.penaltyCount} penalties</span>
                {#if bundleInfo.hasMapData}
                    <span class="bundle-divider">·</span>
                    <span class="bundle-stat map-badge">MAP</span>
                {/if}
            </div>
        {/if}

        <!-- Last Step -->
        <div class="section">
            <div class="section-label">Last Step</div>
            {#if firedTests.length > 0}
                <div class="fired-tests">
                    {#each firedTests.slice(0, 5) as test}
                        <div class="fired-test {getTierClass(test.tier)}">
                            <span class="test-tier">{getTierLabel(test.tier)}</span>
                            <span class="test-id">{test.id}</span>
                            <span class="test-reward">{formatReward(test.reward)}</span>
                        </div>
                    {/each}
                    {#if firedTests.length > 5}
                        <div class="more-tests">+{firedTests.length - 5} more</div>
                    {/if}
                </div>
            {:else}
                <div class="no-tests">No tests fired</div>
            {/if}
        </div>

        <!-- Reward Breakdown -->
        <div class="section">
            <div class="section-label">Reward Breakdown</div>
            <div class="reward-bars">
                <div class="reward-row">
                    <span class="reward-label tier1">Tier 1</span>
                    <div class="reward-bar-container">
                        <div
                            class="reward-bar tier1"
                            style="width: {Math.min(Math.abs(totalRewards.tier1) / maxReward * 100, 100)}%"
                        ></div>
                    </div>
                    <span class="reward-value">{formatReward(totalRewards.tier1)}</span>
                </div>
                <div class="reward-row">
                    <span class="reward-label tier2">Tier 2</span>
                    <div class="reward-bar-container">
                        <div
                            class="reward-bar tier2"
                            style="width: {Math.min(Math.abs(totalRewards.tier2) / maxReward * 100, 100)}%"
                        ></div>
                    </div>
                    <span class="reward-value">{formatReward(totalRewards.tier2)}</span>
                </div>
                <div class="reward-row">
                    <span class="reward-label tier3">Tier 3</span>
                    <div class="reward-bar-container">
                        <div
                            class="reward-bar tier3"
                            style="width: {Math.min(Math.abs(totalRewards.tier3) / maxReward * 100, 100)}%"
                        ></div>
                    </div>
                    <span class="reward-value">{formatReward(totalRewards.tier3)}</span>
                </div>
                <div class="reward-row">
                    <span class="reward-label penalty">Penalty</span>
                    <div class="reward-bar-container">
                        <div
                            class="reward-bar penalty"
                            style="width: {Math.min(Math.abs(totalRewards.penalties) / maxReward * 100, 100)}%"
                        ></div>
                    </div>
                    <span class="reward-value penalty">{formatReward(totalRewards.penalties)}</span>
                </div>
            </div>
        </div>

        <!-- Completed Objectives -->
        {#if completedObjectives.length > 0}
            <div class="section">
                <div class="section-label">Completed</div>
                <div class="objectives-list">
                    {#each completedObjectives.slice(0, 8) as objective}
                        <div class="objective completed">
                            <CheckCircle size={12} />
                            <span>{objective}</span>
                        </div>
                    {/each}
                    {#if completedObjectives.length > 8}
                        <div class="more-objectives">+{completedObjectives.length - 8} more</div>
                    {/if}
                </div>
            </div>
        {/if}

        <!-- Info Toggle -->
        <button class="info-toggle" on:click={() => showInfo = !showInfo}>
            <Info size={12} />
            <span>About test bundles</span>
            <ChevronDown size={12} class="chevron {showInfo ? 'expanded' : ''}" />
        </button>

        {#if showInfo}
            <div class="info-box">
                <p>
                    Test bundles compiled from <strong>Prima Strategy Guide (1999)</strong> using Claude Vision.
                    Location-specific tests provide dense reward signals during training.
                </p>
                <p class="replicate-note">
                    To replicate or modify: run in dev mode, see <code>docs/EXTRACTION.md</code>
                </p>
            </div>
        {/if}
    </div>
</div>

<style>
    .tests-panel {
        background: var(--bg-panel);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        overflow: hidden;
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        background: var(--bg-input);
        border-bottom: 1px solid var(--border-color);
    }

    .panel-title {
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-secondary);
    }

    .location-badge {
        font-size: 10px;
        font-weight: 600;
        padding: 2px 6px;
        background: var(--accent-primary);
        color: white;
        border-radius: 4px;
        text-transform: uppercase;
    }

    .panel-content {
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .bundle-info {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        color: var(--text-muted);
    }

    .bundle-divider {
        color: var(--border-color);
    }

    .map-badge {
        background: var(--accent-secondary, #10b981);
        color: white;
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 9px;
        font-weight: 600;
    }

    .section {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .section-label {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: var(--text-muted);
    }

    .fired-tests {
        display: flex;
        flex-direction: column;
        gap: 3px;
    }

    .fired-test {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        padding: 3px 6px;
        background: var(--bg-input);
        border-radius: 4px;
    }

    .test-tier {
        font-size: 9px;
        font-weight: 700;
        padding: 1px 4px;
        border-radius: 3px;
        background: var(--text-muted);
        color: var(--bg-panel);
    }

    .fired-test.tier1 .test-tier { background: #6b7280; }
    .fired-test.tier2 .test-tier { background: #3b82f6; }
    .fired-test.tier3 .test-tier { background: #10b981; }
    .fired-test.penalty .test-tier { background: #ef4444; }

    .test-id {
        flex: 1;
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .test-reward {
        font-family: monospace;
        font-size: 10px;
        font-weight: 600;
    }

    .fired-test.tier1 .test-reward,
    .fired-test.tier2 .test-reward,
    .fired-test.tier3 .test-reward { color: #10b981; }
    .fired-test.penalty .test-reward { color: #ef4444; }

    .no-tests, .more-tests, .more-objectives {
        font-size: 11px;
        color: var(--text-muted);
        font-style: italic;
    }

    .reward-bars {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .reward-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .reward-label {
        font-size: 10px;
        font-weight: 500;
        width: 40px;
        flex-shrink: 0;
    }

    .reward-label.tier1 { color: #6b7280; }
    .reward-label.tier2 { color: #3b82f6; }
    .reward-label.tier3 { color: #10b981; }
    .reward-label.penalty { color: #ef4444; }

    .reward-bar-container {
        flex: 1;
        height: 6px;
        background: var(--bg-input);
        border-radius: 3px;
        overflow: hidden;
    }

    .reward-bar {
        height: 100%;
        border-radius: 3px;
        transition: width 0.2s ease;
    }

    .reward-bar.tier1 { background: #6b7280; }
    .reward-bar.tier2 { background: #3b82f6; }
    .reward-bar.tier3 { background: #10b981; }
    .reward-bar.penalty { background: #ef4444; }

    .reward-value {
        font-family: monospace;
        font-size: 10px;
        font-weight: 600;
        width: 50px;
        text-align: right;
        flex-shrink: 0;
        color: var(--text-secondary);
    }

    .reward-value.penalty {
        color: #ef4444;
    }

    .objectives-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }

    .objective {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 10px;
        padding: 2px 6px;
        background: var(--bg-input);
        border-radius: 4px;
        color: var(--text-muted);
    }

    .objective.completed {
        color: #10b981;
    }

    .objective.completed :global(svg) {
        color: #10b981;
    }

    .info-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 8px;
        margin-top: 4px;
        background: transparent;
        border: 1px dashed var(--border-color);
        border-radius: 4px;
        color: var(--text-muted);
        font-size: 11px;
        cursor: pointer;
        transition: all 0.15s;
    }

    .info-toggle:hover {
        border-color: var(--text-muted);
        color: var(--text-secondary);
    }

    .info-toggle :global(.chevron) {
        margin-left: auto;
        transition: transform 0.2s;
    }

    .info-toggle :global(.chevron.expanded) {
        transform: rotate(180deg);
    }

    .info-box {
        padding: 10px;
        background: var(--bg-input);
        border-radius: 6px;
        font-size: 11px;
        color: var(--text-secondary);
        line-height: 1.5;
    }

    .info-box p {
        margin: 0 0 8px 0;
    }

    .info-box p:last-child {
        margin-bottom: 0;
    }

    .info-box strong {
        color: var(--text-primary);
    }

    .replicate-note {
        padding-top: 8px;
        border-top: 1px solid var(--border-color);
        color: var(--text-muted);
    }

    .replicate-note code {
        background: var(--bg-panel);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 10px;
    }
</style>
