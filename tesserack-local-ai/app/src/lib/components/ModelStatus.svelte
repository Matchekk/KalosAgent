<script>
    import { llmState, isLLMLoading } from '$lib/stores/llm';
    import { Download, CheckCircle, AlertCircle, Cpu } from 'lucide-svelte';
</script>

{#if $isLLMLoading}
    <div class="model-status loading">
        <div class="status-icon">
            <Download size={20} class="downloading" />
        </div>
        <div class="status-content">
            <div class="status-title">
                Downloading AI Model
            </div>
            <div class="status-model">
                {$llmState.modelName}
            </div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: {$llmState.progress * 100}%"></div>
            </div>
            <div class="status-message">
                {$llmState.message}
            </div>
        </div>
    </div>
{:else if $llmState.status === 'error'}
    <div class="model-status error">
        <AlertCircle size={18} />
        <span>AI model failed to load - running exploration only</span>
    </div>
{:else if $llmState.status === 'ready'}
    <div class="model-status ready">
        <CheckCircle size={16} />
        <span>AI model ready</span>
    </div>
{/if}

<style>
    .model-status {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-radius: var(--border-radius);
        font-size: 13px;
    }

    .model-status.loading {
        background: linear-gradient(135deg, rgba(116, 185, 255, 0.15), rgba(162, 155, 254, 0.15));
        border: 1px solid var(--accent-primary);
    }

    .model-status.error {
        background: rgba(255, 118, 117, 0.1);
        color: var(--accent-secondary);
        border: 1px solid var(--accent-secondary);
    }

    .model-status.ready {
        background: rgba(39, 174, 96, 0.1);
        color: var(--accent-success);
        padding: 8px 12px;
        font-size: 12px;
    }

    .status-icon {
        flex-shrink: 0;
    }

    .status-icon :global(.downloading) {
        color: var(--accent-primary);
        animation: bounce 1s ease-in-out infinite;
    }

    @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(3px); }
    }

    .status-content {
        flex: 1;
        min-width: 0;
    }

    .status-title {
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 2px;
    }

    .status-model {
        font-size: 11px;
        color: var(--text-muted);
        margin-bottom: 8px;
    }

    .progress-bar {
        height: 6px;
        background: var(--bg-dark);
        border-radius: 3px;
        overflow: hidden;
        margin-bottom: 6px;
    }

    .progress-fill {
        height: 100%;
        background: linear-gradient(90deg, var(--accent-primary), #a29bfe);
        border-radius: 3px;
        transition: width 0.3s ease;
    }

    .status-message {
        font-size: 11px;
        color: var(--text-secondary);
    }
</style>
