<script>
    import { feedItems, FEED_TYPES } from '$lib/stores/feed';
    import { MapPin, Sparkles, Target, Award, Info, MessageSquare } from 'lucide-svelte';

    const iconMap = {
        [FEED_TYPES.DISCOVERY]: MapPin,
        [FEED_TYPES.TRAINING]: Sparkles,
        [FEED_TYPES.CHECKPOINT]: Target,
        [FEED_TYPES.REWARD]: Award,
        [FEED_TYPES.SYSTEM]: Info,
        [FEED_TYPES.HINT]: MessageSquare,
    };

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
</script>

<div class="activity-feed panel">
    <div class="panel-title">Activity</div>

    <div class="feed-list">
        {#if $feedItems.length === 0}
            <div class="feed-empty">
                Events will appear here as you play
            </div>
        {:else}
            {#each $feedItems as item (item.id)}
                <div class="feed-item {item.type}">
                    <div class="feed-icon">
                        <svelte:component this={iconMap[item.type] || Info} size={14} />
                    </div>
                    <div class="feed-content">
                        <span class="feed-message">{item.message}</span>
                        <span class="feed-time">{formatTime(item.timestamp)}</span>
                    </div>
                    {#if item.reward}
                        <span class="reward-badge">+{item.reward}</span>
                    {/if}
                </div>
            {/each}
        {/if}
    </div>
</div>

<style>
    .activity-feed {
        flex: 1;
        min-height: 200px;
        display: flex;
        flex-direction: column;
    }

    .feed-list {
        flex: 1;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 300px;
    }

    .feed-empty {
        color: var(--text-muted);
        font-size: 13px;
        text-align: center;
        padding: 40px 20px;
    }

    .feed-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-radius: var(--border-radius-sm);
        font-size: 13px;
        background: var(--bg-input);
    }

    .feed-item.discovery {
        border-left: 3px solid var(--accent-primary);
    }

    .feed-item.training {
        border-left: 3px solid var(--accent-success);
    }

    .feed-item.checkpoint {
        border-left: 3px solid var(--accent-warning);
    }

    .feed-item.reward {
        border-left: 3px solid var(--accent-purple);
    }

    .feed-item.system {
        border-left: 3px solid var(--text-muted);
    }

    .feed-item.hint {
        border-left: 3px solid var(--accent-secondary);
    }

    .feed-icon {
        color: var(--text-secondary);
        display: flex;
        align-items: center;
    }

    .feed-content {
        flex: 1;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
    }

    .feed-message {
        color: var(--text-primary);
    }

    .feed-time {
        font-size: 11px;
        color: var(--text-muted);
        white-space: nowrap;
    }

    .reward-badge {
        font-weight: 600;
        color: var(--accent-primary);
        font-size: 12px;
    }
</style>
