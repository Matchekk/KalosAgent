import { readFile } from 'node:fs/promises';

const [preview, labView, labInit, trainer] = await Promise.all([
    readFile(new URL('../src/lib/components/lab/ParallelWorkerPreview.svelte', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/components/lab/LabView.svelte', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/core/lab/lab-init.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/core/lab/parallel-trainer.js', import.meta.url), 'utf8'),
]);

const checks = [
    ['renders a card for every configured environment', /#each workers as worker/.test(preview)],
    ['shows a live 160 by 144 screen per worker', /width="160"[\s\S]*height="144"/.test(preview)],
    ['uses pixelated scaling for Game Boy frames', /image-rendering:\s*pixelated/.test(preview)],
    ['color-codes independent workers', /workerColors/.test(preview) && /--worker-color/.test(preview)],
    ['labels each worker role', /worker\.role/.test(preview)],
    ['surfaces location coordinates action episode and team', ['location', 'worker.x', 'worker.y', 'worker.action', 'worker.episode', 'worker.partySize'].every(token => preview.includes(token))],
    ['marks exactly the proof-eligible role in telemetry', /proofEligible/.test(trainer) && /Fresh-ROM proof/.test(trainer)],
    ['states that only Fresh-ROM counts as proof', /Only the green Fresh-ROM card counts as autonomy proof/.test(preview)],
    ['preview copying is exported by the lab runtime', /export function renderLabWorkerPreview/.test(labInit)],
    ['preview copy performs no frame advance or input', !/function renderLabWorkerPreview[\s\S]{0,900}(runFrame|setButton|pressButton|loadState)/.test(labInit)],
    ['preview is mounted in Train mode', /mode === 'train'[\s\S]{0,160}<ParallelWorkerPreview/.test(labView)],
    ['manual teaching hides parallel preview to avoid false worker claims', /mode === 'train'\s*&&\s*!\$labDemonstration\.active/.test(labView)],
];

const passed = checks.filter(([, ok]) => ok).length;
const score = Number((100 * passed / checks.length).toFixed(3));
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
console.log(`METRIC parallel_preview_integrity_pct=${score}`);
if (passed !== checks.length) process.exitCode = 1;
