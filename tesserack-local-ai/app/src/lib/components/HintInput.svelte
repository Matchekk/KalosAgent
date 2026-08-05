<script>
    import { userHint, hintRemaining, setHint } from '$lib/stores/agent';
    import { feedHint } from '$lib/stores/feed';
    import { Send } from 'lucide-svelte';

    let inputValue = '';

    function sendHint() {
        if (!inputValue.trim()) return;

        setHint(inputValue.trim(), 5);
        feedHint(inputValue.trim());
        inputValue = '';
    }

    function handleKeypress(e) {
        if (e.key === 'Enter') {
            sendHint();
        }
    }
</script>

<div class="hint-input">
    <input
        type="text"
        placeholder="Guide the AI: e.g., 'go north to Viridian City'"
        bind:value={inputValue}
        on:keypress={handleKeypress}
    />
    <button class="send-btn" on:click={sendHint} disabled={!inputValue.trim()}>
        <Send size={16} />
    </button>

    {#if $hintRemaining > 0}
        <div class="hint-active">
            Following: "{$userHint}" ({$hintRemaining} left)
        </div>
    {/if}
</div>

<style>
    .hint-input {
        position: relative;
    }

    input {
        width: 100%;
        padding: 12px 50px 12px 14px;
        font-size: 13px;
        border-radius: var(--border-radius);
    }

    .send-btn {
        position: absolute;
        right: 6px;
        top: 50%;
        transform: translateY(-50%);
        background: var(--accent-primary);
        color: white;
        padding: 8px;
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .send-btn:disabled {
        background: var(--text-muted);
        opacity: 0.5;
    }

    .hint-active {
        margin-top: 8px;
        font-size: 12px;
        color: var(--accent-primary);
        padding: 8px 12px;
        background: rgba(116, 185, 255, 0.15);
        border-radius: var(--border-radius-sm);
    }
</style>
