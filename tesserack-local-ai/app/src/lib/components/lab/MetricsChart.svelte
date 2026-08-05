<script>
    import { onMount, afterUpdate } from 'svelte';

    export let history = { returns: [], entropy: [], rewards: [] };
    export let activeTab = 'return'; // 'return' | 'entropy' | 'rewards'

    let canvas;
    let ctx;
    let containerWidth = 300;
    let containerHeight = 120;

    const tabs = [
        { id: 'return', label: 'Return' },
        { id: 'entropy', label: 'Entropy' },
        { id: 'rewards', label: 'Rewards' },
    ];

    // Colors
    const colors = {
        return: '#00b894',
        entropy: '#fdcb6e',
        tier1: '#74b9ff',
        tier2: '#00cec9',
        tier3: '#00b894',
        penalties: '#d63031',
    };

    onMount(() => {
        if (canvas) {
            ctx = canvas.getContext('2d');
            updateCanvasSize();
            draw();
        }
    });

    afterUpdate(() => {
        draw();
    });

    function updateCanvasSize() {
        if (!canvas) return;
        const rect = canvas.parentElement.getBoundingClientRect();
        containerWidth = rect.width || 300;
        containerHeight = rect.height || 120;
        canvas.width = containerWidth * window.devicePixelRatio;
        canvas.height = containerHeight * window.devicePixelRatio;
        canvas.style.width = containerWidth + 'px';
        canvas.style.height = containerHeight + 'px';
        ctx?.scale(window.devicePixelRatio, window.devicePixelRatio);
    }

    function draw() {
        if (!ctx) return;

        // Clear
        ctx.clearRect(0, 0, containerWidth, containerHeight);

        // Draw based on active tab
        if (activeTab === 'return') {
            drawLineChart(history.returns, 'value', colors.return);
        } else if (activeTab === 'entropy') {
            drawLineChart(history.entropy, 'value', colors.entropy);
        } else if (activeTab === 'rewards') {
            drawStackedArea();
        }
    }

    function drawLineChart(data, key, color) {
        if (!data || data.length < 2) {
            drawEmptyState();
            return;
        }

        const padding = { top: 10, right: 10, bottom: 20, left: 10 };
        const width = containerWidth - padding.left - padding.right;
        const height = containerHeight - padding.top - padding.bottom;

        // Find min/max
        const values = data.map(d => d[key]);
        let min = Math.min(...values);
        let max = Math.max(...values);

        // Add some padding to the range
        const range = max - min || 1;
        min -= range * 0.1;
        max += range * 0.1;

        // Scale functions
        const xScale = (i) => padding.left + (i / (data.length - 1)) * width;
        const yScale = (v) => padding.top + height - ((v - min) / (max - min)) * height;

        // Draw gradient fill
        const gradient = ctx.createLinearGradient(0, padding.top, 0, containerHeight - padding.bottom);
        gradient.addColorStop(0, color + '40');
        gradient.addColorStop(1, color + '00');

        ctx.beginPath();
        ctx.moveTo(xScale(0), containerHeight - padding.bottom);
        for (let i = 0; i < data.length; i++) {
            ctx.lineTo(xScale(i), yScale(data[i][key]));
        }
        ctx.lineTo(xScale(data.length - 1), containerHeight - padding.bottom);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        // Draw line
        ctx.beginPath();
        ctx.moveTo(xScale(0), yScale(data[0][key]));
        for (let i = 1; i < data.length; i++) {
            ctx.lineTo(xScale(i), yScale(data[i][key]));
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Draw latest value label
        const latest = data[data.length - 1][key];
        ctx.fillStyle = 'var(--text-muted)';
        ctx.font = '10px system-ui';
        ctx.textAlign = 'right';
        ctx.fillText(latest.toFixed(3), containerWidth - padding.right, padding.top + 12);
    }

    function drawStackedArea() {
        const data = history.rewards;
        if (!data || data.length < 2) {
            drawEmptyState();
            return;
        }

        const padding = { top: 10, right: 10, bottom: 20, left: 10 };
        const width = containerWidth - padding.left - padding.right;
        const height = containerHeight - padding.top - padding.bottom;

        // Calculate stacked totals
        const stacked = data.map(d => ({
            t1: Math.abs(d.t1),
            t2: Math.abs(d.t1) + Math.abs(d.t2),
            t3: Math.abs(d.t1) + Math.abs(d.t2) + Math.abs(d.t3),
            total: Math.abs(d.t1) + Math.abs(d.t2) + Math.abs(d.t3) + Math.abs(d.penalties),
        }));

        const maxTotal = Math.max(...stacked.map(d => d.total)) || 1;

        const xScale = (i) => padding.left + (i / (data.length - 1)) * width;
        const yScale = (v) => padding.top + height - (v / maxTotal) * height;

        // Draw areas from top to bottom (reverse order so layers stack correctly)
        const layers = [
            { key: 'total', color: colors.penalties },
            { key: 't3', color: colors.tier3 },
            { key: 't2', color: colors.tier2 },
            { key: 't1', color: colors.tier1 },
        ];

        for (const layer of layers) {
            ctx.beginPath();
            ctx.moveTo(xScale(0), containerHeight - padding.bottom);
            for (let i = 0; i < stacked.length; i++) {
                ctx.lineTo(xScale(i), yScale(stacked[i][layer.key]));
            }
            ctx.lineTo(xScale(stacked.length - 1), containerHeight - padding.bottom);
            ctx.closePath();
            ctx.fillStyle = layer.color + '80';
            ctx.fill();
        }
    }

    function drawEmptyState() {
        ctx.fillStyle = 'var(--text-muted)';
        ctx.font = '11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('Waiting for training data...', containerWidth / 2, containerHeight / 2);
    }

    // Redraw on resize
    function handleResize() {
        updateCanvasSize();
        draw();
    }
</script>

<svelte:window on:resize={handleResize} />

<div class="metrics-chart">
    <div class="tabs">
        {#each tabs as tab}
            <button
                class="tab"
                class:active={activeTab === tab.id}
                on:click={() => activeTab = tab.id}
            >
                {tab.label}
            </button>
        {/each}
    </div>
    <div class="chart-container">
        <canvas bind:this={canvas}></canvas>
    </div>
    <div class="chart-label">
        Last {history[activeTab === 'return' ? 'returns' : activeTab === 'entropy' ? 'entropy' : 'rewards'].length || 0} updates
    </div>
</div>

<style>
    .metrics-chart {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .tabs {
        display: flex;
        gap: 4px;
        background: var(--bg-input);
        padding: 3px;
        border-radius: 6px;
    }

    .tab {
        flex: 1;
        padding: 6px 8px;
        border: none;
        border-radius: 4px;
        background: transparent;
        color: var(--text-muted);
        font-size: 11px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
    }

    .tab:hover {
        color: var(--text-primary);
    }

    .tab.active {
        background: var(--bg-panel);
        color: var(--text-primary);
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .chart-container {
        position: relative;
        width: 100%;
        height: 120px;
        background: var(--bg-input);
        border-radius: 6px;
        overflow: hidden;
    }

    canvas {
        display: block;
    }

    .chart-label {
        font-size: 10px;
        color: var(--text-muted);
        text-align: center;
    }
</style>
