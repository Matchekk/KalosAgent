<script>
    import { gameState } from '$lib/stores/game';
    import { discoveryCounts } from '$lib/stores/feed';

    const allBadges = ['Boulder', 'Cascade', 'Thunder', 'Rainbow', 'Soul', 'Marsh', 'Volcano', 'Earth'];

    $: badgeCount = $gameState.badges?.length || 0;
</script>

<div class="progress-bar">
    <div class="badges">
        <div class="badge-dots">
            {#each allBadges as badge, i}
                <div
                    class="badge-dot"
                    class:earned={i < badgeCount}
                    title={badge + ' Badge'}
                ></div>
            {/each}
        </div>
        <span class="badge-label">{badgeCount}/8 Badges</span>
    </div>

    <div class="stat-pills">
        <div class="stat-pill">
            <span class="value">{$gameState.party?.length || 0}</span>
            <span class="label">Pokemon</span>
        </div>
        <div class="stat-pill">
            <span class="value">{$discoveryCounts.locations}</span>
            <span class="label">Areas</span>
        </div>
        <div class="stat-pill">
            <span class="value">${($gameState.money || 0).toLocaleString()}</span>
            <span class="label">Money</span>
        </div>
    </div>
</div>

<style>
    .progress-bar {
        background: var(--bg-panel);
        border-radius: var(--border-radius);
        padding: 10px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 8px;
        border: 1px solid var(--border-color);
        box-shadow: var(--shadow-soft);
    }

    .badges {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .badge-label {
        font-size: 11px;
        color: var(--text-secondary);
        white-space: nowrap;
    }

    .stat-pills {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        justify-content: flex-end;
    }

    .stat-pill {
        min-width: 50px;
        padding: 4px 8px;
    }

    .stat-pill .value {
        font-size: 13px;
    }

    .stat-pill .label {
        font-size: 9px;
    }
</style>
