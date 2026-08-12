<script>
    import { onMount } from 'svelte';
    import { pureRLMetrics, renderLabWorkerPreview } from '$lib/core/lab/lab-init.js';

    const workerColors = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c'];
    let canvases = new Map();
    let available = new Set();

    $: workerCount = Math.max(1, Number($pureRLMetrics.environmentCount) || 4);
    $: workers = Array.from({ length: workerCount }, (_, workerId) => {
        const live = $pureRLMetrics.workers?.find(worker => worker.workerId === workerId);
        const isFresh = workerId === ($pureRLMetrics.autonomy?.evaluationWorker ?? workerCount - 1);
        return live || {
            workerId,
            episode: 0,
            episodeSteps: 0,
            location: 'Waiting for Train',
            x: 0,
            y: 0,
            action: '-',
            partySize: 0,
            maxLevel: 0,
            role: isFresh ? 'Fresh-ROM proof' : workerId === 0 ? 'Checkpoint exploit' : 'Frontier replay',
            proofEligible: isFresh,
            checkpointSource: false,
        };
    });

    function registerCanvas(node, workerId) {
        canvases.set(workerId, node);
        return {
            update(nextWorkerId) {
                canvases.delete(workerId);
                workerId = nextWorkerId;
                canvases.set(workerId, node);
            },
            destroy() {
                canvases.delete(workerId);
            },
        };
    }

    function paint() {
        const nextAvailable = new Set();
        for (const [workerId, canvas] of canvases) {
            if (renderLabWorkerPreview(workerId, canvas)) nextAvailable.add(workerId);
        }
        available = nextAvailable;
    }

    onMount(() => {
        paint();
        const interval = setInterval(paint, 125);
        return () => clearInterval(interval);
    });
</script>

<section class="worker-preview" aria-label="Parallel Red live preview">
    <div class="preview-heading">
        <div>
            <strong>Parallel Red live preview</strong>
            <span>Four independent screens · one shared policy</span>
        </div>
        <span class="proof-note">Only the green Fresh-ROM card counts as autonomy proof</span>
    </div>

    <div class="worker-grid">
        {#each workers as worker (worker.workerId)}
            <article
                class:proof-worker={worker.proofEligible}
                class:checkpoint-worker={worker.checkpointSource}
                class="worker-card"
                style="--worker-color: {workerColors[worker.workerId % workerColors.length]}"
            >
                <div class="worker-title">
                    <span class="worker-dot"></span>
                    <strong>E{worker.workerId + 1}</strong>
                    <span>{worker.role}</span>
                    {#if worker.proofEligible}<b>PROOF</b>{/if}
                </div>
                <div class="screen-shell">
                    <canvas
                        use:registerCanvas={worker.workerId}
                        width="160"
                        height="144"
                        aria-label="Environment {worker.workerId + 1} screen"
                    ></canvas>
                    {#if !available.has(worker.workerId)}
                        <div class="screen-wait">Starts with Train</div>
                    {/if}
                </div>
                <div class="worker-telemetry">
                    <span class="location" title={worker.location}>{worker.location}</span>
                    <span>M{worker.mapId ?? 0} · {worker.x},{worker.y}</span>
                    <span>A {worker.action || '-'}</span>
                    <span>Ep {worker.episode || 0}:{worker.episodeSteps || 0}</span>
                    <span>Team {worker.partySize || 0} · Lv{worker.maxLevel || 0}</span>
                </div>
            </article>
        {/each}
    </div>
</section>

<style>
    .worker-preview {
        flex-shrink: 0;
        padding: 8px;
        border-top: 1px solid var(--border-color);
        background: color-mix(in srgb, var(--bg-panel) 90%, #000);
    }

    .preview-heading {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 7px;
        color: var(--text-primary);
        font-size: 11px;
    }

    .preview-heading div {
        display: flex;
        align-items: baseline;
        gap: 8px;
    }

    .preview-heading span,
    .proof-note {
        color: var(--text-muted);
        font-size: 9px;
    }

    .worker-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
    }

    .worker-card {
        min-width: 0;
        overflow: hidden;
        border: 1px solid color-mix(in srgb, var(--worker-color) 55%, var(--border-color));
        border-radius: 6px;
        background: var(--bg-input);
        box-shadow: inset 0 2px 0 var(--worker-color);
    }

    .worker-card.proof-worker {
        box-shadow: inset 0 2px 0 #69db7c, 0 0 0 1px rgba(105, 219, 124, 0.25);
    }

    .worker-card.checkpoint-worker:not(.proof-worker) {
        border-style: dashed;
    }

    .worker-title {
        display: flex;
        align-items: center;
        gap: 4px;
        min-height: 25px;
        padding: 4px 6px;
        color: var(--text-secondary);
        font-size: 8px;
        white-space: nowrap;
    }

    .worker-title strong { color: var(--text-primary); font-size: 10px; }
    .worker-title b { margin-left: auto; color: #69db7c; font-size: 7px; letter-spacing: .08em; }
    .worker-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--worker-color); }

    .screen-shell {
        position: relative;
        aspect-ratio: 160 / 144;
        overflow: hidden;
        background: #050505;
    }

    canvas {
        display: block;
        width: 100%;
        height: 100%;
        image-rendering: pixelated;
    }

    .screen-wait {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: #777;
        font-size: 8px;
        text-transform: uppercase;
        letter-spacing: .08em;
    }

    .worker-telemetry {
        display: grid;
        grid-template-columns: 1.5fr 1fr;
        gap: 2px 6px;
        padding: 5px 6px 6px;
        color: var(--text-muted);
        font-family: 'Monaco', 'Menlo', monospace;
        font-size: 7px;
        line-height: 1.25;
    }

    .worker-telemetry .location {
        grid-column: 1 / -1;
        overflow: hidden;
        color: var(--text-primary);
        font-size: 8px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    @media (max-width: 1050px) {
        .worker-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        .proof-note { display: none; }
    }
</style>
