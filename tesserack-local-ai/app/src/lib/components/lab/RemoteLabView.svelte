<script>
    import { onMount, onDestroy } from 'svelte';
    import { Wifi, WifiOff, Play, Pause } from 'lucide-svelte';

    // Connection state
    let ws = null;
    let connected = false;
    let connectionError = '';

    // Game state from server
    let frame = null;
    let gameState = null;
    let rlStep = null;

    // Cumulative metrics
    let totalReward = 0;
    let stepHistory = [];
    const MAX_HISTORY = 100;

    // WebSocket URL
    export let wsUrl = 'ws://localhost:8765';

    function connect() {
        connectionError = '';
        try {
            ws = new WebSocket(wsUrl);

            ws.onopen = () => {
                connected = true;
                console.log('[RemoteLab] Connected to', wsUrl);
            };

            ws.onclose = () => {
                connected = false;
                console.log('[RemoteLab] Disconnected');
            };

            ws.onerror = (e) => {
                connectionError = 'Failed to connect to lab server';
                console.error('[RemoteLab] Error:', e);
            };

            ws.onmessage = (event) => {
                try {
                    const msg = JSON.parse(event.data);
                    handleMessage(msg);
                } catch (e) {
                    console.error('[RemoteLab] Parse error:', e);
                }
            };
        } catch (e) {
            connectionError = e.message;
        }
    }

    function disconnect() {
        if (ws) {
            ws.close();
            ws = null;
        }
        connected = false;
    }

    function handleMessage(msg) {
        const { type, data } = msg;

        switch (type) {
            case 'frame':
                // Base64 PNG frame
                frame = 'data:image/png;base64,' + data.frame;
                break;

            case 'state':
                gameState = data;
                break;

            case 'rl_step':
                rlStep = data;
                totalReward += data.reward;
                // Keep history for sparkline
                stepHistory = [...stepHistory.slice(-MAX_HISTORY + 1), data];
                break;

            case 'status':
                // Server status update
                console.log('[RemoteLab] Status:', data);
                break;

            case 'checkpoint':
                console.log('[RemoteLab] Checkpoint reached:', data.name);
                break;
        }
    }

    function sendCommand(command, value = null) {
        if (ws && connected) {
            ws.send(JSON.stringify({
                type: 'command',
                command,
                value
            }));
        }
    }

    onMount(() => {
        connect();
    });

    onDestroy(() => {
        disconnect();
    });

    // Format reward with sign and color
    function formatReward(r) {
        if (r > 0) return '+' + r.toFixed(3);
        if (r < 0) return r.toFixed(3);
        return '0.000';
    }

    // Get reward class for styling
    function rewardClass(r) {
        if (r > 0) return 'positive';
        if (r < 0) return 'negative';
        return 'neutral';
    }
</script>

<div class="remote-lab">
    <!-- Connection Status -->
    <div class="connection-bar" class:connected>
        <div class="status">
            {#if connected}
                <Wifi size={16} />
                <span>Connected to {wsUrl}</span>
            {:else}
                <WifiOff size={16} />
                <span>{connectionError || 'Disconnected'}</span>
            {/if}
        </div>
        <div class="controls">
            {#if connected}
                <button on:click={() => sendCommand('pause')}>
                    <Pause size={14} />
                </button>
                <button on:click={() => sendCommand('resume')}>
                    <Play size={14} />
                </button>
                <button class="disconnect" on:click={disconnect}>Disconnect</button>
            {:else}
                <button class="connect" on:click={connect}>Connect</button>
            {/if}
        </div>
    </div>

    <div class="main-content">
        <!-- Game Frame -->
        <div class="frame-container">
            {#if frame}
                <img src={frame} alt="Game frame" class="game-frame" />
            {:else}
                <div class="no-frame">
                    <span>Waiting for frame...</span>
                </div>
            {/if}
        </div>

        <!-- RL Metrics Panel -->
        <div class="metrics-panel">
            {#if rlStep}
                <div class="metric-row">
                    <span class="label">Step</span>
                    <span class="value">{rlStep.step.toLocaleString()}</span>
                </div>

                <div class="metric-row">
                    <span class="label">Action</span>
                    <span class="value action">{rlStep.action}</span>
                </div>

                <div class="metric-row">
                    <span class="label">Epsilon</span>
                    <span class="value">{(rlStep.epsilon * 100).toFixed(1)}%</span>
                </div>

                <div class="divider"></div>

                <div class="metric-row">
                    <span class="label">Step Reward</span>
                    <span class="value {rewardClass(rlStep.reward)}">{formatReward(rlStep.reward)}</span>
                </div>

                <div class="metric-row">
                    <span class="label">Total Reward</span>
                    <span class="value {rewardClass(totalReward)}">{formatReward(totalReward)}</span>
                </div>

                <div class="divider"></div>

                <h4>Reward Breakdown</h4>

                <div class="tier-grid">
                    <div class="tier" class:active={rlStep.tier1 > 0}>
                        <span class="tier-label">Tier 1</span>
                        <span class="tier-value">{rlStep.tier1.toFixed(2)}</span>
                        <span class="tier-desc">Movement</span>
                    </div>
                    <div class="tier" class:active={rlStep.tier2 > 0}>
                        <span class="tier-label">Tier 2</span>
                        <span class="tier-value">{rlStep.tier2.toFixed(2)}</span>
                        <span class="tier-desc">Map Change</span>
                    </div>
                    <div class="tier" class:active={rlStep.tier3 > 0}>
                        <span class="tier-label">Tier 3</span>
                        <span class="tier-value">{rlStep.tier3.toFixed(2)}</span>
                        <span class="tier-desc">Milestone</span>
                    </div>
                    <div class="tier penalty" class:active={rlStep.penalties < 0}>
                        <span class="tier-label">Penalty</span>
                        <span class="tier-value">{rlStep.penalties.toFixed(2)}</span>
                        <span class="tier-desc">Idle/Stuck</span>
                    </div>
                </div>

                {#if rlStep.fired_tests && rlStep.fired_tests.length > 0}
                    <div class="fired-tests">
                        <h4>Fired Tests</h4>
                        <ul>
                            {#each rlStep.fired_tests as test}
                                <li>{test}</li>
                            {/each}
                        </ul>
                    </div>
                {/if}
            {:else}
                <div class="no-data">
                    Waiting for RL data...
                </div>
            {/if}
        </div>
    </div>

    <!-- Game State -->
    {#if gameState}
        <div class="state-bar">
            <span class="state-item">
                <strong>Map:</strong> {gameState.map_id}
            </span>
            <span class="state-item">
                <strong>Pos:</strong> ({gameState.player_x}, {gameState.player_y})
            </span>
            <span class="state-item">
                <strong>Badges:</strong> {gameState.badge_count}/8
            </span>
            <span class="state-item">
                <strong>Party:</strong> {gameState.party?.length || 0}
            </span>
            {#if gameState.in_battle}
                <span class="state-item battle">IN BATTLE</span>
            {/if}
        </div>
    {/if}
</div>

<style>
    .remote-lab {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: var(--bg-panel);
        border-radius: 8px;
        overflow: hidden;
    }

    .connection-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: #d63031;
        color: white;
        font-size: 12px;
    }

    .connection-bar.connected {
        background: #00b894;
    }

    .status {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .controls {
        display: flex;
        gap: 8px;
    }

    .controls button {
        padding: 4px 8px;
        background: rgba(255,255,255,0.2);
        border: none;
        border-radius: 4px;
        color: white;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .controls button:hover {
        background: rgba(255,255,255,0.3);
    }

    .controls button.connect {
        background: var(--accent-primary);
    }

    .main-content {
        display: flex;
        flex: 1;
        gap: 12px;
        padding: 12px;
        min-height: 0;
    }

    .frame-container {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        border-radius: 8px;
        overflow: hidden;
    }

    .game-frame {
        max-width: 100%;
        max-height: 100%;
        image-rendering: pixelated;
    }

    .no-frame {
        color: var(--text-muted);
        font-size: 14px;
    }

    .metrics-panel {
        width: 200px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        background: var(--bg-input);
        border-radius: 8px;
        font-size: 12px;
    }

    .metric-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
    }

    .label {
        color: var(--text-muted);
    }

    .value {
        font-weight: 600;
        color: var(--text-primary);
    }

    .value.action {
        text-transform: uppercase;
        background: var(--accent-primary);
        color: white;
        padding: 2px 8px;
        border-radius: 4px;
    }

    .value.positive {
        color: #00b894;
    }

    .value.negative {
        color: #d63031;
    }

    .divider {
        height: 1px;
        background: var(--border-color);
        margin: 4px 0;
    }

    h4 {
        margin: 8px 0 4px;
        font-size: 11px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
    }

    .tier-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
    }

    .tier {
        padding: 8px;
        background: var(--bg-panel);
        border-radius: 6px;
        text-align: center;
        opacity: 0.5;
    }

    .tier.active {
        opacity: 1;
        background: rgba(0, 184, 148, 0.1);
        border: 1px solid rgba(0, 184, 148, 0.3);
    }

    .tier.penalty.active {
        background: rgba(214, 48, 49, 0.1);
        border: 1px solid rgba(214, 48, 49, 0.3);
    }

    .tier-label {
        display: block;
        font-size: 10px;
        color: var(--text-muted);
    }

    .tier-value {
        display: block;
        font-size: 16px;
        font-weight: 700;
        color: var(--text-primary);
    }

    .tier-desc {
        display: block;
        font-size: 9px;
        color: var(--text-muted);
    }

    .fired-tests {
        margin-top: 8px;
    }

    .fired-tests ul {
        margin: 4px 0 0;
        padding-left: 16px;
    }

    .fired-tests li {
        font-size: 10px;
        color: #00b894;
    }

    .no-data {
        color: var(--text-muted);
        text-align: center;
        padding: 20px;
    }

    .state-bar {
        display: flex;
        gap: 16px;
        padding: 8px 12px;
        background: var(--bg-input);
        font-size: 11px;
        border-top: 1px solid var(--border-color);
    }

    .state-item {
        color: var(--text-secondary);
    }

    .state-item strong {
        color: var(--text-muted);
    }

    .state-item.battle {
        color: #d63031;
        font-weight: 600;
    }
</style>
