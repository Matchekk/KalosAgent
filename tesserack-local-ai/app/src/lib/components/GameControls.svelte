<script>
    import { pressButton } from '$lib/core/game-init.js';
    import { isInteractiveKeyboardTarget } from '$lib/core/keyboard.js';
    import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-svelte';

    function press(button) {
        pressButton(button);
    }

    // Keyboard controls
    const keyMap = {
        'ArrowUp': 'up',
        'ArrowDown': 'down',
        'ArrowLeft': 'left',
        'ArrowRight': 'right',
        'z': 'a',
        'x': 'b',
        'Enter': 'start',
        'Shift': 'select'
    };

    function handleKeydown(e) {
        if (isInteractiveKeyboardTarget(e.target)) return;
        const button = keyMap[e.key];
        if (button) {
            press(button);
            e.preventDefault();
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="game-controls panel">
    <div class="dpad">
        <button class="dpad-btn up" on:click={() => press('up')}>
            <ChevronUp size={28} strokeWidth={3} />
        </button>
        <div class="dpad-row">
            <button class="dpad-btn left" on:click={() => press('left')}>
                <ChevronLeft size={28} strokeWidth={3} />
            </button>
            <button class="dpad-btn right" on:click={() => press('right')}>
                <ChevronRight size={28} strokeWidth={3} />
            </button>
        </div>
        <button class="dpad-btn down" on:click={() => press('down')}>
            <ChevronDown size={28} strokeWidth={3} />
        </button>
    </div>

    <div class="action-buttons">
        <button class="btn-b" on:click={() => press('b')}>B</button>
        <button class="btn-a" on:click={() => press('a')}>A</button>
    </div>

    <div class="menu-buttons">
        <button class="btn-menu" on:click={() => press('select')}>Sel</button>
        <button class="btn-menu" on:click={() => press('start')}>Start</button>
    </div>
</div>

<style>
    .game-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 16px;
    }

    .dpad {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
    }

    .dpad-row {
        display: flex;
        gap: 24px;
    }

    .dpad-btn {
        width: 40px;
        height: 40px;
        background: var(--bg-dark);
        color: var(--text-primary);
        border-radius: 8px;
        font-size: 14px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid var(--border-color);
        transition: all 0.1s ease;
    }

    .dpad-btn :global(svg) {
        stroke-width: 2.5;
    }

    .dpad-btn:hover {
        background: var(--border-color);
        color: var(--accent-primary);
        transform: scale(1.05);
    }

    .dpad-btn:active {
        background: var(--accent-primary);
        color: white;
        transform: scale(0.95);
    }

    .action-buttons {
        display: flex;
        gap: 12px;
    }

    .btn-a, .btn-b {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        font-weight: 600;
        font-size: 14px;
    }

    .btn-a {
        background: var(--accent-secondary);
        color: white;
    }

    .btn-b {
        background: var(--accent-primary);
        color: white;
    }

    .btn-a:active, .btn-b:active {
        transform: scale(0.95);
    }

    .menu-buttons {
        display: flex;
        gap: 8px;
    }

    .btn-menu {
        padding: 8px 14px;
        background: var(--bg-input);
        color: var(--text-secondary);
        font-size: 11px;
        border-radius: 12px;
        border: 1px solid var(--border-color);
    }

    .btn-menu:hover {
        background: var(--border-color);
        color: var(--text-primary);
    }
</style>
