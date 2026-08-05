<script>
    import { gameState } from '$lib/stores/game';
    import { MapPin, Users, Award } from 'lucide-svelte';

    $: state = $gameState;
    $: partyDisplay = (state.party || []).map(p => `${p.species} Lv${p.level}`).join(', ');
    $: badgeCount = state.badges?.length || 0;
    $: location = state.location || 'Unknown';
    $: coords = state.coordinates || { x: 0, y: 0 };
</script>

<div class="game-state-bar panel">
    <div class="state-item">
        <MapPin size={14} />
        <span class="label">Location</span>
        <span class="value">{location}</span>
        <span class="coords">({coords.x}, {coords.y})</span>
    </div>

    <div class="state-item">
        <Users size={14} />
        <span class="label">Party</span>
        <span class="value">
            {#if partyDisplay}
                {partyDisplay}
            {:else}
                No Pokemon
            {/if}
        </span>
    </div>

    <div class="state-item">
        <Award size={14} />
        <span class="label">Badges</span>
        <span class="value badge-count">{badgeCount}/8</span>
    </div>
</div>

<style>
    .game-state-bar {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        padding: 12px 16px;
        font-size: 12px;
    }

    .state-item {
        display: flex;
        align-items: center;
        gap: 6px;
        color: var(--text-secondary);
    }

    .state-item :global(svg) {
        color: var(--text-muted);
    }

    .label {
        color: var(--text-muted);
    }

    .value {
        color: var(--text-primary);
        font-weight: 500;
    }

    .coords {
        color: var(--text-muted);
        font-size: 11px;
    }

    .badge-count {
        color: var(--accent-primary);
    }
</style>
