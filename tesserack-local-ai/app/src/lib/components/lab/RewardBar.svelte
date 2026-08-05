<script>
    export let breakdown = { tier1: 0, tier2: 0, tier3: 0, penalties: 0 };

    // Colors for each tier
    const colors = {
        tier1: '#74b9ff',    // Blue - Movement
        tier2: '#00cec9',    // Teal - Map Change
        tier3: '#00b894',    // Green - Goal Progress
        penalties: '#d63031', // Red - Penalties
    };

    // Calculate percentages for the bar
    $: total = Math.abs(breakdown.tier1) + Math.abs(breakdown.tier2) +
               Math.abs(breakdown.tier3) + Math.abs(breakdown.penalties);

    $: segments = total > 0 ? {
        tier1: (Math.abs(breakdown.tier1) / total) * 100,
        tier2: (Math.abs(breakdown.tier2) / total) * 100,
        tier3: (Math.abs(breakdown.tier3) / total) * 100,
        penalties: (Math.abs(breakdown.penalties) / total) * 100,
    } : { tier1: 25, tier2: 25, tier3: 25, penalties: 25 };

    // Format value with sign
    function formatValue(v) {
        if (v > 0) return '+' + v.toFixed(2);
        if (v < 0) return v.toFixed(2);
        return '0.00';
    }

    // Check if segment is active (non-zero)
    function isActive(v) {
        return Math.abs(v) > 0.001;
    }
</script>

<div class="reward-bar">
    <div class="bar-container">
        <div
            class="bar-segment tier1"
            class:active={isActive(breakdown.tier1)}
            style="width: {segments.tier1}%; background: {colors.tier1}"
        ></div>
        <div
            class="bar-segment tier2"
            class:active={isActive(breakdown.tier2)}
            style="width: {segments.tier2}%; background: {colors.tier2}"
        ></div>
        <div
            class="bar-segment tier3"
            class:active={isActive(breakdown.tier3)}
            style="width: {segments.tier3}%; background: {colors.tier3}"
        ></div>
        <div
            class="bar-segment penalties"
            class:active={isActive(breakdown.penalties)}
            style="width: {segments.penalties}%; background: {colors.penalties}"
        ></div>
    </div>
    <div class="labels">
        <div class="label" class:active={isActive(breakdown.tier1)}>
            <span class="dot" style="background: {colors.tier1}"></span>
            <span class="name">T1 Movement</span>
            <span class="value">{formatValue(breakdown.tier1)}</span>
        </div>
        <div class="label" class:active={isActive(breakdown.tier2)}>
            <span class="dot" style="background: {colors.tier2}"></span>
            <span class="name">T2 Map</span>
            <span class="value">{formatValue(breakdown.tier2)}</span>
        </div>
        <div class="label" class:active={isActive(breakdown.tier3)}>
            <span class="dot" style="background: {colors.tier3}"></span>
            <span class="name">T3 Goal</span>
            <span class="value">{formatValue(breakdown.tier3)}</span>
        </div>
        <div class="label penalty" class:active={isActive(breakdown.penalties)}>
            <span class="dot" style="background: {colors.penalties}"></span>
            <span class="name">Penalties</span>
            <span class="value">{formatValue(breakdown.penalties)}</span>
        </div>
    </div>
</div>

<style>
    .reward-bar {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px 16px;
        background: var(--bg-panel);
        border-radius: 8px;
    }

    .bar-container {
        display: flex;
        height: 8px;
        border-radius: 4px;
        overflow: hidden;
        background: var(--bg-input);
    }

    .bar-segment {
        height: 100%;
        transition: width 0.3s ease-out;
        opacity: 0.3;
    }

    .bar-segment.active {
        opacity: 1;
    }

    .labels {
        display: flex;
        justify-content: space-between;
        gap: 8px;
    }

    .label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        opacity: 0.5;
        transition: opacity 0.2s;
    }

    .label.active {
        opacity: 1;
    }

    .dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex-shrink: 0;
    }

    .name {
        color: var(--text-muted);
        white-space: nowrap;
    }

    .value {
        font-family: 'Monaco', 'Menlo', monospace;
        font-weight: 600;
        color: var(--text-primary);
    }

    .label.penalty .value {
        color: #d63031;
    }

    @media (max-width: 640px) {
        .labels {
            flex-wrap: wrap;
        }
        .label {
            flex: 1 1 45%;
        }
    }
</style>
