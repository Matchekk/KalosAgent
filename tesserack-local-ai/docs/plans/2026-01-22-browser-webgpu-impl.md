# Browser-Based WebGPU Tesserack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a fully client-side Pokemon AI player running in the browser with WebGPU LLM inference.

**Architecture:** Static web app using WebLLM for LLM inference, binjgb for GameBoy emulation, vanilla JS for UI. All state stored in localStorage. No backend required.

**Tech Stack:** WebLLM, binjgb, vanilla JavaScript, HTML5 Canvas, localStorage

---

### Task 1: Project Setup

**Files:**
- Create: `web/index.html`
- Create: `web/style.css`
- Create: `web/js/app.js`

**Step 1: Create basic HTML structure**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Tesserack - AI Plays Pokemon</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>Tesserack</h1>
            <p class="subtitle">AI Plays Pokemon (Browser Edition)</p>
        </header>

        <div id="status-bar">
            <span id="status-text">Drop ROM to start</span>
            <div id="progress-container" style="display:none">
                <div id="progress-bar"></div>
                <span id="progress-text">0%</span>
            </div>
        </div>

        <main>
            <div class="game-panel">
                <div id="rom-drop" class="drop-zone">
                    <p>Drop Pokemon Red ROM here</p>
                    <p class="small">or click to select file</p>
                    <input type="file" id="rom-input" accept=".gb,.gbc" style="display:none">
                </div>
                <canvas id="game-canvas" width="160" height="144" style="display:none"></canvas>
            </div>

            <div class="info-panel">
                <div class="controls-row">
                    <div class="mode-select">
                        <span class="mode-label">Start:</span>
                        <button id="turbo-btn" class="mode-btn primary" disabled>▶ Turbo</button>
                        <button id="llm-btn" class="mode-btn" disabled>▶ LLM</button>
                    </div>
                    <button id="stop-btn" disabled>Stop</button>
                    <button id="save-btn" disabled>Save</button>
                    <button id="load-btn" disabled>Load</button>
                </div>

                <div class="state-panel">
                    <h3>Game State</h3>
                    <div id="game-state">Waiting for ROM...</div>
                </div>

                <div class="reasoning-panel">
                    <h3>LLM Reasoning</h3>
                    <div id="reasoning">-</div>
                    <div class="action-display">
                        <strong>Actions:</strong> <span id="actions">-</span>
                    </div>
                </div>
            </div>
        </main>

        <div class="manual-controls">
            <div class="dpad">
                <button data-btn="up" class="dpad-up">▲</button>
                <div class="dpad-middle">
                    <button data-btn="left" class="dpad-left">◀</button>
                    <button data-btn="right" class="dpad-right">▶</button>
                </div>
                <button data-btn="down" class="dpad-down">▼</button>
            </div>
            <div class="action-btns">
                <button data-btn="b" class="btn-b">B</button>
                <button data-btn="a" class="btn-a">A</button>
            </div>
            <div class="menu-btns">
                <button data-btn="select" class="btn-select">Select</button>
                <button data-btn="start" class="btn-start">Start</button>
            </div>
            <button id="turbo-a-btn" class="turbo-a">Turbo A</button>
        </div>
    </div>

    <script type="module" src="js/app.js"></script>
</body>
</html>
```

**Step 2: Create CSS (port from existing)**

```css
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body {
    font-family: 'Courier New', monospace;
    background: #1a1a2e;
    color: #eee;
    min-height: 100vh;
}

.container {
    max-width: 1000px;
    margin: 0 auto;
    padding: 20px;
}

header {
    text-align: center;
    margin-bottom: 20px;
}

h1 {
    color: #ff6b6b;
    font-size: 2em;
}

.subtitle {
    color: #888;
    font-size: 0.9em;
}

#status-bar {
    background: #0f0f1a;
    padding: 10px 15px;
    border-radius: 8px;
    margin-bottom: 20px;
    display: flex;
    align-items: center;
    gap: 15px;
}

#progress-container {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 10px;
}

#progress-bar {
    flex: 1;
    height: 8px;
    background: #333;
    border-radius: 4px;
    overflow: hidden;
}

#progress-bar::after {
    content: '';
    display: block;
    height: 100%;
    width: var(--progress, 0%);
    background: #4ecdc4;
    transition: width 0.3s;
}

main {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 20px;
    margin-bottom: 20px;
}

.game-panel {
    background: #16213e;
    border-radius: 10px;
    padding: 20px;
}

.drop-zone {
    width: 320px;
    height: 288px;
    border: 3px dashed #333;
    border-radius: 10px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: border-color 0.3s;
}

.drop-zone:hover, .drop-zone.dragover {
    border-color: #4ecdc4;
}

.drop-zone .small {
    color: #666;
    font-size: 0.8em;
    margin-top: 5px;
}

#game-canvas {
    width: 320px;
    height: 288px;
    image-rendering: pixelated;
    background: #000;
}

.info-panel {
    display: flex;
    flex-direction: column;
    gap: 15px;
}

.controls-row {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
}

.mode-select {
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0f0f1a;
    padding: 5px 10px;
    border-radius: 8px;
}

.mode-label {
    color: #888;
    font-size: 12px;
}

.mode-btn {
    padding: 8px 16px;
    border: 2px solid #333;
    border-radius: 5px;
    cursor: pointer;
    font-family: inherit;
    font-size: 13px;
    background: #1a1a2e;
    color: #aaa;
}

.mode-btn:hover:not(:disabled) {
    border-color: #4ecdc4;
    color: #fff;
}

.mode-btn.primary {
    background: #e74c3c;
    color: #fff;
    border-color: #e74c3c;
}

.mode-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.controls-row button:not(.mode-btn) {
    padding: 8px 16px;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-family: inherit;
    background: #4ecdc4;
    color: #1a1a2e;
}

.controls-row button:disabled {
    background: #333;
    color: #666;
    cursor: not-allowed;
}

.state-panel, .reasoning-panel {
    background: #16213e;
    border-radius: 10px;
    padding: 15px;
}

h3 {
    color: #4ecdc4;
    font-size: 14px;
    margin-bottom: 10px;
}

#game-state, #reasoning {
    background: #0f0f1a;
    padding: 10px;
    border-radius: 5px;
    font-size: 12px;
    line-height: 1.5;
    max-height: 150px;
    overflow-y: auto;
}

.action-display {
    margin-top: 10px;
    padding: 8px;
    background: #ff6b6b;
    color: #1a1a2e;
    border-radius: 5px;
    font-size: 12px;
}

.manual-controls {
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 40px;
    padding: 20px;
    background: #16213e;
    border-radius: 10px;
}

.dpad {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
}

.dpad-middle {
    display: flex;
    gap: 30px;
}

.dpad button {
    width: 40px;
    height: 40px;
    border: none;
    border-radius: 8px;
    background: #333;
    color: #fff;
    font-size: 16px;
    cursor: pointer;
}

.dpad button:hover {
    background: #4ecdc4;
}

.dpad button:active {
    background: #ff6b6b;
}

.action-btns {
    display: flex;
    gap: 15px;
}

.action-btns button {
    width: 50px;
    height: 50px;
    border: none;
    border-radius: 50%;
    font-size: 16px;
    font-weight: bold;
    cursor: pointer;
}

.btn-a {
    background: #ff6b6b;
    color: #fff;
}

.btn-b {
    background: #4ecdc4;
    color: #1a1a2e;
}

.menu-btns {
    display: flex;
    gap: 10px;
}

.menu-btns button {
    padding: 8px 15px;
    border: none;
    border-radius: 15px;
    background: #555;
    color: #fff;
    font-size: 11px;
    cursor: pointer;
}

.turbo-a {
    padding: 15px 25px;
    border: none;
    border-radius: 8px;
    background: #e74c3c;
    color: #fff;
    font-weight: bold;
    cursor: pointer;
}

.turbo-a:active {
    background: #c0392b;
}
```

**Step 3: Create minimal app.js entry point**

```javascript
// app.js - Main entry point
console.log('Tesserack loading...');

// DOM elements
const romDrop = document.getElementById('rom-drop');
const romInput = document.getElementById('rom-input');
const gameCanvas = document.getElementById('game-canvas');
const statusText = document.getElementById('status-text');

// State
let romLoaded = false;

// ROM drop handling
romDrop.addEventListener('click', () => romInput.click());
romDrop.addEventListener('dragover', (e) => {
    e.preventDefault();
    romDrop.classList.add('dragover');
});
romDrop.addEventListener('dragleave', () => {
    romDrop.classList.remove('dragover');
});
romDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    romDrop.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) loadROM(file);
});
romInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadROM(file);
});

async function loadROM(file) {
    statusText.textContent = `Loading ${file.name}...`;
    const buffer = await file.arrayBuffer();
    console.log('ROM loaded:', buffer.byteLength, 'bytes');

    // TODO: Initialize emulator with ROM
    romLoaded = true;
    romDrop.style.display = 'none';
    gameCanvas.style.display = 'block';
    statusText.textContent = 'ROM loaded. Loading AI model...';

    // TODO: Initialize WebLLM
}

console.log('Tesserack ready');
```

**Step 4: Test in browser**

Run: `cd /Users/sidmohan/Projects/tesserack && python -m http.server 8080 --directory web`
Open: http://localhost:8080
Expected: See UI, can drag/drop files (no functionality yet)

**Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): add browser version HTML/CSS/JS scaffold"
```

---

### Task 2: Integrate binjgb Emulator

**Files:**
- Create: `web/js/emulator.js`
- Modify: `web/index.html` (add script)
- Modify: `web/js/app.js` (use emulator)

**Step 1: Download binjgb**

```bash
curl -L https://raw.githubusercontent.com/nickoakman/nickoakman.github.io/8f4dae0e0a0fc2c10c74c1f6f5bdb7a4bfc2e3e3/AirBoy/binjgb.js -o web/lib/binjgb.js
```

Note: If this URL doesn't work, we'll use a different GB emulator or build binjgb from source.

**Step 2: Create emulator wrapper**

```javascript
// emulator.js - GameBoy emulator wrapper
export class Emulator {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.emu = null;
        this.running = false;
        this.frameCallback = null;
    }

    async loadROM(romData) {
        // Initialize binjgb with ROM data
        if (typeof Binjgb === 'undefined') {
            throw new Error('binjgb not loaded');
        }

        this.emu = new Binjgb();
        this.emu.loadROM(new Uint8Array(romData));

        // Set up rendering
        this.imageData = this.ctx.createImageData(160, 144);

        return true;
    }

    start() {
        this.running = true;
        this.loop();
    }

    stop() {
        this.running = false;
    }

    loop() {
        if (!this.running) return;

        // Run one frame
        this.emu.runFrame();

        // Render to canvas
        const pixels = this.emu.getPixels();
        this.imageData.data.set(pixels);
        this.ctx.putImageData(this.imageData, 0, 0);

        // Notify callback
        if (this.frameCallback) {
            this.frameCallback();
        }

        requestAnimationFrame(() => this.loop());
    }

    pressButton(button) {
        const btnMap = {
            'a': 0, 'b': 1, 'select': 2, 'start': 3,
            'right': 4, 'left': 5, 'up': 6, 'down': 7
        };
        if (button in btnMap) {
            this.emu.buttonDown(btnMap[button]);
            setTimeout(() => this.emu.buttonUp(btnMap[button]), 100);
        }
    }

    getMemory() {
        return this.emu.getMemory();
    }

    saveState() {
        return this.emu.saveState();
    }

    loadState(state) {
        this.emu.loadState(state);
    }
}
```

**Step 3: Update app.js to use emulator**

```javascript
// app.js - Updated with emulator
import { Emulator } from './emulator.js';

console.log('Tesserack loading...');

// DOM elements
const romDrop = document.getElementById('rom-drop');
const romInput = document.getElementById('rom-input');
const gameCanvas = document.getElementById('game-canvas');
const statusText = document.getElementById('status-text');
const turboBtn = document.getElementById('turbo-btn');
const llmBtn = document.getElementById('llm-btn');
const stopBtn = document.getElementById('stop-btn');
const saveBtn = document.getElementById('save-btn');
const loadBtn = document.getElementById('load-btn');

// State
let emulator = null;

// ROM handling
romDrop.addEventListener('click', () => romInput.click());
romDrop.addEventListener('dragover', (e) => {
    e.preventDefault();
    romDrop.classList.add('dragover');
});
romDrop.addEventListener('dragleave', () => {
    romDrop.classList.remove('dragover');
});
romDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    romDrop.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) loadROM(file);
});
romInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadROM(file);
});

async function loadROM(file) {
    statusText.textContent = `Loading ${file.name}...`;

    try {
        const buffer = await file.arrayBuffer();

        emulator = new Emulator(gameCanvas);
        await emulator.loadROM(buffer);

        romDrop.style.display = 'none';
        gameCanvas.style.display = 'block';

        // Enable buttons
        turboBtn.disabled = false;
        llmBtn.disabled = false;
        saveBtn.disabled = false;
        loadBtn.disabled = false;

        // Start emulator display loop
        emulator.start();

        statusText.textContent = 'ROM loaded! Click Turbo or LLM to start.';
    } catch (err) {
        statusText.textContent = `Error: ${err.message}`;
        console.error(err);
    }
}

// Button handlers
turboBtn.addEventListener('click', () => {
    // TODO: Start turbo mode
    statusText.textContent = 'Turbo mode running...';
});

stopBtn.addEventListener('click', () => {
    // TODO: Stop mode
    statusText.textContent = 'Stopped';
});

console.log('Tesserack ready');
```

**Step 4: Test emulator loads**

Run: `python -m http.server 8080 --directory web`
Open: http://localhost:8080
Drop ROM file
Expected: Game screen appears (may need emulator adjustments)

**Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): integrate binjgb GameBoy emulator"
```

---

### Task 3: Memory Reader (Port from Python)

**Files:**
- Create: `web/js/memory-reader.js`

**Step 1: Create memory reader with Pokemon Red addresses**

```javascript
// memory-reader.js - Pokemon Red memory reading
export const ADDRESSES = {
    PLAYER_NAME: 0xD158,
    RIVAL_NAME: 0xD34A,
    MONEY: 0xD347,
    BADGES: 0xD356,
    PARTY_COUNT: 0xD163,
    PARTY_DATA: 0xD164,
    MAP_ID: 0xD35E,
    PLAYER_X: 0xD362,
    PLAYER_Y: 0xD361,
    CURRENT_BOX_NUM: 0xD5A0,
    TEXT_BOX_ID: 0xD125,
    BATTLE_TYPE: 0xD057,
};

export const MAP_NAMES = {
    0: 'PALLET_TOWN', 1: 'VIRIDIAN_CITY', 2: 'PEWTER_CITY',
    3: 'CERULEAN_CITY', 4: 'LAVENDER_TOWN', 5: 'VERMILION_CITY',
    6: 'CELADON_CITY', 7: 'FUCHSIA_CITY', 8: 'CINNABAR_ISLAND',
    9: 'INDIGO_PLATEAU', 10: 'SAFFRON_CITY',
    12: 'ROUTE_1', 13: 'ROUTE_2', 14: 'ROUTE_3', 15: 'ROUTE_4',
    33: 'REDS_HOUSE_1F', 34: 'REDS_HOUSE_2F', 35: 'BLUES_HOUSE',
    36: 'OAKS_LAB',
    // Add more as needed
};

export const POKEMON_NAMES = {
    1: 'BULBASAUR', 2: 'IVYSAUR', 3: 'VENUSAUR',
    4: 'CHARMANDER', 5: 'CHARMELEON', 6: 'CHARIZARD',
    7: 'SQUIRTLE', 8: 'WARTORTLE', 9: 'BLASTOISE',
    25: 'PIKACHU', 26: 'RAICHU',
    // Add more as needed
};

export class MemoryReader {
    constructor(emulator) {
        this.emu = emulator;
    }

    readByte(address) {
        const mem = this.emu.getMemory();
        return mem[address] || 0;
    }

    readBytes(address, length) {
        const mem = this.emu.getMemory();
        return Array.from(mem.slice(address, address + length));
    }

    readString(address, maxLength = 10) {
        const bytes = this.readBytes(address, maxLength);
        let str = '';
        for (const b of bytes) {
            if (b === 0x50) break; // Terminator
            // Pokemon character encoding
            if (b >= 0x80 && b <= 0x99) {
                str += String.fromCharCode('A'.charCodeAt(0) + (b - 0x80));
            } else if (b >= 0xA0 && b <= 0xB9) {
                str += String.fromCharCode('a'.charCodeAt(0) + (b - 0xA0));
            } else if (b === 0x7F) {
                str += ' ';
            }
        }
        return str;
    }

    getLocation() {
        const mapId = this.readByte(ADDRESSES.MAP_ID);
        return MAP_NAMES[mapId] || `UNKNOWN_${mapId}`;
    }

    getCoordinates() {
        return {
            x: this.readByte(ADDRESSES.PLAYER_X),
            y: this.readByte(ADDRESSES.PLAYER_Y)
        };
    }

    getMoney() {
        const bytes = this.readBytes(ADDRESSES.MONEY, 3);
        // BCD encoded
        return bytes[0] * 10000 + bytes[1] * 100 + bytes[2];
    }

    getBadges() {
        const badgeByte = this.readByte(ADDRESSES.BADGES);
        const badges = [];
        const badgeNames = ['Boulder', 'Cascade', 'Thunder', 'Rainbow',
                           'Soul', 'Marsh', 'Volcano', 'Earth'];
        for (let i = 0; i < 8; i++) {
            if (badgeByte & (1 << i)) {
                badges.push(badgeNames[i]);
            }
        }
        return badges;
    }

    getPartyCount() {
        return this.readByte(ADDRESSES.PARTY_COUNT);
    }

    getParty() {
        const count = this.getPartyCount();
        const party = [];

        for (let i = 0; i < count; i++) {
            const base = ADDRESSES.PARTY_DATA + (i * 44);
            const speciesId = this.readByte(base);
            const level = this.readByte(base + 33);
            const currentHP = (this.readByte(base + 1) << 8) | this.readByte(base + 2);
            const maxHP = (this.readByte(base + 34) << 8) | this.readByte(base + 35);

            party.push({
                species: POKEMON_NAMES[speciesId] || `Pokemon#${speciesId}`,
                level,
                currentHP,
                maxHP
            });
        }

        return party;
    }

    getGameState() {
        return {
            location: this.getLocation(),
            coordinates: this.getCoordinates(),
            money: this.getMoney(),
            badges: this.getBadges(),
            party: this.getParty()
        };
    }
}
```

**Step 2: Commit**

```bash
git add web/js/memory-reader.js
git commit -m "feat(web): add Pokemon Red memory reader"
```

---

### Task 4: Integrate WebLLM

**Files:**
- Create: `web/js/llm.js`
- Modify: `web/js/app.js`
- Modify: `web/index.html` (add importmap)

**Step 1: Update index.html with importmap for WebLLM**

Add before closing `</head>`:

```html
<script type="importmap">
{
    "imports": {
        "@mlc-ai/web-llm": "https://esm.run/@mlc-ai/web-llm"
    }
}
</script>
```

**Step 2: Create LLM wrapper**

```javascript
// llm.js - WebLLM wrapper
import * as webllm from '@mlc-ai/web-llm';

let engine = null;

export async function initLLM(onProgress) {
    const selectedModel = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

    engine = await webllm.CreateMLCEngine(selectedModel, {
        initProgressCallback: (progress) => {
            if (onProgress) {
                onProgress(progress);
            }
        }
    });

    return engine;
}

export async function generate(prompt, maxTokens = 256) {
    if (!engine) {
        throw new Error('LLM not initialized');
    }

    const response = await engine.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
        temperature: 0.7,
    });

    return response.choices[0].message.content;
}

export function isReady() {
    return engine !== null;
}
```

**Step 3: Update app.js to init LLM**

Add to app.js after ROM loads:

```javascript
import { initLLM, generate, isReady } from './llm.js';

// Add after ROM loaded successfully:
async function initializeAI() {
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    progressContainer.style.display = 'flex';
    statusText.textContent = 'Loading AI model...';

    try {
        await initLLM((progress) => {
            const pct = Math.round(progress.progress * 100);
            progressBar.style.setProperty('--progress', `${pct}%`);
            progressText.textContent = `${pct}%`;
            statusText.textContent = progress.text || 'Loading AI model...';
        });

        progressContainer.style.display = 'none';
        statusText.textContent = 'Ready! Click Turbo or LLM to start.';
        llmBtn.disabled = false;
    } catch (err) {
        statusText.textContent = `AI Error: ${err.message}`;
        console.error(err);
    }
}
```

**Step 4: Test LLM loads**

Run: `python -m http.server 8080 --directory web`
Open: http://localhost:8080
Drop ROM
Expected: Progress bar shows model download, then "Ready!"

**Step 5: Commit**

```bash
git add web/
git commit -m "feat(web): integrate WebLLM for in-browser inference"
```

---

### Task 5: Action Parser (Port from Python)

**Files:**
- Create: `web/js/action-parser.js`

**Step 1: Create action parser**

```javascript
// action-parser.js - Parse LLM responses
const VALID_BUTTONS = new Set(['a', 'b', 'start', 'select', 'up', 'down', 'left', 'right']);

export function parseResponse(response) {
    console.log('[LLM RAW]', response.substring(0, 300));

    let plan = '';
    let actions = [];

    // Look for PLAN: line
    const planMatch = response.match(/PLAN:\s*(.+?)(?:\n|$)/i);
    if (planMatch) {
        plan = planMatch[1].trim();
    }

    // Look for ACTIONS: line
    const actionsMatch = response.match(/ACTIONS?:\s*(.+?)(?:\n|$)/i);
    if (actionsMatch) {
        const actionStr = actionsMatch[1].toLowerCase();
        const buttons = actionStr.split(/[,\s]+/);
        actions = buttons
            .map(b => b.trim())
            .filter(b => VALID_BUTTONS.has(b));
    }

    // Fallback if no plan found
    if (!plan) {
        const actionStart = response.search(/actions?:/i);
        if (actionStart > 0) {
            plan = response.substring(0, actionStart).trim();
        } else {
            plan = response.trim();
        }
    }

    // Default actions if none found
    if (actions.length === 0) {
        console.log('[PARSER] No valid actions, defaulting to: right, right, a');
        actions = ['right', 'right', 'a'];
    }

    console.log('[PARSER] Plan:', plan.substring(0, 80));
    console.log('[PARSER] Actions:', actions);

    return { plan, actions };
}
```

**Step 2: Commit**

```bash
git add web/js/action-parser.js
git commit -m "feat(web): add action parser for LLM responses"
```

---

### Task 6: Game Agent

**Files:**
- Create: `web/js/agent.js`
- Modify: `web/js/app.js`

**Step 1: Create game agent**

```javascript
// agent.js - Game agent that coordinates LLM and emulator
import { generate } from './llm.js';
import { parseResponse } from './action-parser.js';

const SYSTEM_PROMPT = `You are an AI playing Pokemon Red. Goal: become Pokemon Champion.

Given the game state, output your next 10 button presses.

RULES:
- Valid buttons: up, down, left, right, a, b, start, select
- Press 'a' to talk, confirm, or advance dialog
- Press 'b' to cancel or go back
- Use directions to move on the map
- In battle: select moves with up/down, confirm with 'a'

OUTPUT FORMAT (follow exactly):
PLAN: <brief 1-line goal>
ACTIONS: button1, button2, button3, button4, button5, button6, button7, button8, button9, button10

Example:
PLAN: Walk right to exit room and talk to NPC
ACTIONS: right, right, right, up, up, a, a, a, a, a

Now analyze and respond:`;

export class GameAgent {
    constructor(emulator, memoryReader, onUpdate) {
        this.emu = emulator;
        this.reader = memoryReader;
        this.onUpdate = onUpdate;
        this.running = false;
        this.turboMode = false;
        this.manualOverrideUntil = 0;
        this.stepCount = 0;
        this.actionQueue = [];
    }

    buildPrompt(state) {
        const lines = [SYSTEM_PROMPT, '', 'CURRENT GAME STATE:'];

        lines.push(`Location: ${state.location}`);
        lines.push(`Coordinates: (${state.coordinates.x}, ${state.coordinates.y})`);
        lines.push(`Money: $${state.money}`);
        lines.push(`Badges: ${state.badges.length > 0 ? state.badges.join(', ') : 'None'}`);

        lines.push('', 'POKEMON PARTY:');
        for (const p of state.party) {
            lines.push(`  ${p.species} Lv.${p.level} HP:${p.currentHP}/${p.maxHP}`);
        }

        lines.push('', 'PLAN:');

        return lines.join('\n');
    }

    async step() {
        // If we have queued actions, execute one
        if (this.actionQueue.length > 0) {
            const action = this.actionQueue.shift();
            this.emu.pressButton(action);
            this.stepCount++;

            if (this.onUpdate) {
                this.onUpdate({
                    action: [action],
                    reasoning: `Executing queued action ${this.actionQueue.length + 1} remaining`,
                    state: this.reader.getGameState()
                });
            }
            return;
        }

        // Get new actions from LLM
        const state = this.reader.getGameState();
        const prompt = this.buildPrompt(state);

        try {
            const response = await generate(prompt);
            const { plan, actions } = parseResponse(response);

            // Queue all actions
            this.actionQueue = [...actions];

            if (this.onUpdate) {
                this.onUpdate({
                    action: actions,
                    reasoning: plan,
                    state
                });
            }
        } catch (err) {
            console.error('LLM error:', err);
            // Default actions on error
            this.actionQueue = ['a', 'a', 'a'];
        }
    }

    async runLLM() {
        this.running = true;
        this.turboMode = false;

        while (this.running) {
            // Check manual override
            if (Date.now() < this.manualOverrideUntil) {
                await this.sleep(100);
                continue;
            }

            await this.step();
            await this.sleep(100);
        }
    }

    runTurbo() {
        this.running = true;
        this.turboMode = true;

        const loop = () => {
            if (!this.running || !this.turboMode) return;

            this.emu.pressButton('a');
            this.stepCount++;

            if (this.stepCount % 10 === 0 && this.onUpdate) {
                this.onUpdate({
                    action: ['Turbo: a'],
                    reasoning: `Turbo mode - step ${this.stepCount}`,
                    state: this.reader.getGameState()
                });
            }

            setTimeout(loop, 50);
        };

        loop();
    }

    stop() {
        this.running = false;
        this.turboMode = false;
        this.actionQueue = [];
    }

    manualButton(button) {
        this.manualOverrideUntil = Date.now() + 3000;
        this.emu.pressButton(button);

        if (this.onUpdate) {
            this.onUpdate({
                action: [`Manual: ${button}`],
                reasoning: 'Manual control - LLM paused for 3s',
                state: this.reader.getGameState()
            });
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
```

**Step 2: Update app.js to use agent**

```javascript
// Add to app.js
import { GameAgent } from './agent.js';
import { MemoryReader } from './memory-reader.js';

let agent = null;
let memoryReader = null;

// After emulator starts:
memoryReader = new MemoryReader(emulator);
agent = new GameAgent(emulator, memoryReader, handleAgentUpdate);

function handleAgentUpdate(update) {
    // Update UI
    document.getElementById('game-state').innerHTML = formatState(update.state);
    document.getElementById('reasoning').textContent = update.reasoning;
    document.getElementById('actions').textContent = update.action.join(', ');
}

function formatState(state) {
    return `
        <div><strong>Location:</strong> ${state.location}</div>
        <div><strong>Position:</strong> (${state.coordinates.x}, ${state.coordinates.y})</div>
        <div><strong>Money:</strong> $${state.money}</div>
        <div><strong>Badges:</strong> ${state.badges.join(', ') || 'None'}</div>
        <div><strong>Party:</strong></div>
        ${state.party.map(p => `<div style="margin-left:10px">${p.species} Lv.${p.level} HP:${p.currentHP}/${p.maxHP}</div>`).join('')}
    `;
}

// Button handlers
turboBtn.addEventListener('click', () => {
    agent.runTurbo();
    turboBtn.disabled = true;
    llmBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent = 'Turbo mode running...';
});

llmBtn.addEventListener('click', () => {
    agent.runLLM();
    turboBtn.disabled = true;
    llmBtn.disabled = true;
    stopBtn.disabled = false;
    statusText.textContent = 'LLM mode running...';
});

stopBtn.addEventListener('click', () => {
    agent.stop();
    turboBtn.disabled = false;
    llmBtn.disabled = false;
    stopBtn.disabled = true;
    statusText.textContent = 'Stopped';
});

// Manual controls
document.querySelectorAll('[data-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
        const button = btn.dataset.btn;
        if (agent) agent.manualButton(button);
    });
});
```

**Step 3: Commit**

```bash
git add web/js/
git commit -m "feat(web): add game agent with LLM and turbo modes"
```

---

### Task 7: Storage (Save/Load)

**Files:**
- Create: `web/js/storage.js`
- Modify: `web/js/app.js`

**Step 1: Create storage module**

```javascript
// storage.js - localStorage save/load
const SAVE_KEY = 'tesserack-save';
const SETTINGS_KEY = 'tesserack-settings';

export function saveState(emulator) {
    try {
        const state = emulator.saveState();
        const encoded = btoa(String.fromCharCode(...state));
        localStorage.setItem(SAVE_KEY, encoded);
        return true;
    } catch (err) {
        console.error('Save failed:', err);
        return false;
    }
}

export function loadState(emulator) {
    try {
        const saved = localStorage.getItem(SAVE_KEY);
        if (!saved) return false;

        const bytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
        emulator.loadState(bytes);
        return true;
    } catch (err) {
        console.error('Load failed:', err);
        return false;
    }
}

export function hasSavedState() {
    return localStorage.getItem(SAVE_KEY) !== null;
}

export function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSettings() {
    const saved = localStorage.getItem(SETTINGS_KEY);
    return saved ? JSON.parse(saved) : {};
}
```

**Step 2: Add save/load buttons to app.js**

```javascript
import { saveState, loadState, hasSavedState } from './storage.js';

// Update load button state on ROM load
if (hasSavedState()) {
    loadBtn.disabled = false;
}

saveBtn.addEventListener('click', () => {
    if (saveState(emulator)) {
        statusText.textContent = 'Game saved!';
    } else {
        statusText.textContent = 'Save failed!';
    }
});

loadBtn.addEventListener('click', () => {
    if (loadState(emulator)) {
        statusText.textContent = 'Game loaded!';
    } else {
        statusText.textContent = 'Load failed!';
    }
});
```

**Step 3: Add autosave to agent**

In agent.js, add autosave every 50 steps:

```javascript
// In step() method, after stepCount++:
if (this.stepCount % 50 === 0) {
    import('./storage.js').then(({ saveState }) => {
        saveState(this.emu);
        console.log('Autosaved at step', this.stepCount);
    });
}
```

**Step 4: Commit**

```bash
git add web/js/
git commit -m "feat(web): add localStorage save/load with autosave"
```

---

### Task 8: Keyboard Controls

**Files:**
- Modify: `web/js/app.js`

**Step 1: Add keyboard event listeners**

```javascript
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

document.addEventListener('keydown', (e) => {
    const button = keyMap[e.key];
    if (button && agent) {
        agent.manualButton(button);
        e.preventDefault();
    }
});

// Turbo A button (hold)
const turboABtn = document.getElementById('turbo-a-btn');
let turboAInterval = null;

turboABtn.addEventListener('mousedown', () => {
    turboAInterval = setInterval(() => {
        if (agent) agent.manualButton('a');
    }, 100);
});

turboABtn.addEventListener('mouseup', () => {
    if (turboAInterval) {
        clearInterval(turboAInterval);
        turboAInterval = null;
    }
});

turboABtn.addEventListener('mouseleave', () => {
    if (turboAInterval) {
        clearInterval(turboAInterval);
        turboAInterval = null;
    }
});
```

**Step 2: Commit**

```bash
git add web/js/app.js
git commit -m "feat(web): add keyboard controls and turbo A button"
```

---

### Task 9: Final Integration & Polish

**Files:**
- Modify: `web/js/app.js` (final assembly)
- Create: `web/README.md`

**Step 1: Assemble final app.js**

Ensure all imports and initialization are properly ordered:

```javascript
// app.js - Final version
import { Emulator } from './emulator.js';
import { MemoryReader } from './memory-reader.js';
import { initLLM, isReady } from './llm.js';
import { GameAgent } from './agent.js';
import { saveState, loadState, hasSavedState } from './storage.js';

// ... (all the code from previous tasks combined)
```

**Step 2: Create README**

```markdown
# Tesserack Web - AI Plays Pokemon (Browser Edition)

A fully client-side AI that plays Pokemon Red, running entirely in your browser using WebGPU.

## Features

- **WebGPU LLM Inference** - Qwen2.5-1.5B runs directly in your browser
- **GameBoy Emulation** - Full Pokemon Red emulation via binjgb
- **Turbo Mode** - Rapid button mashing for dialog/menus
- **LLM Mode** - AI decides 10 actions at a time
- **Co-pilot Controls** - Take over anytime with manual input
- **Persistent Saves** - Autosaves to localStorage

## Requirements

- Modern browser with WebGPU support (Chrome 113+, Edge 113+)
- ~1.5GB for model download (cached after first load)
- Your own Pokemon Red ROM file (.gb)

## Usage

1. Open the page
2. Wait for AI model to download (first time only)
3. Drop your Pokemon Red ROM file
4. Click **Turbo** or **LLM** to start!

## Controls

| Key | Action |
|-----|--------|
| Arrow Keys | D-pad |
| Z | A button |
| X | B button |
| Enter | Start |
| Shift | Select |

## Local Development

```bash
cd web
python -m http.server 8080
# Open http://localhost:8080
```

## Hosting

Deploy the `web/` folder to any static hosting:
- GitHub Pages
- Netlify
- Vercel
- Any web server
```

**Step 3: Test everything**

Run: `python -m http.server 8080 --directory web`
Open: http://localhost:8080

Test checklist:
- [ ] ROM drag & drop works
- [ ] Model downloads with progress
- [ ] Turbo mode works
- [ ] LLM mode works
- [ ] Manual controls work
- [ ] Keyboard controls work
- [ ] Save/Load works
- [ ] Autosave works

**Step 4: Final commit**

```bash
git add web/
git commit -m "feat(web): complete browser-based Tesserack with WebGPU LLM"
```

---

### Task 10: Deploy to GitHub Pages

**Step 1: Enable GitHub Pages**

```bash
# Push to GitHub
git push origin main

# Enable Pages in repo settings, or use gh CLI:
gh repo edit --enable-pages --pages-branch main --pages-path /web
```

**Step 2: Verify deployment**

Open: https://sidmohan0.github.io/tesserack/

**Step 3: Update main README**

Add link to live demo in the main project README.

```bash
git add README.md
git commit -m "docs: add link to browser version"
git push
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Project setup (HTML/CSS/JS scaffold) |
| 2 | binjgb emulator integration |
| 3 | Memory reader (port from Python) |
| 4 | WebLLM integration |
| 5 | Action parser (port from Python) |
| 6 | Game agent |
| 7 | Storage (localStorage) |
| 8 | Keyboard controls |
| 9 | Final integration |
| 10 | Deploy to GitHub Pages |
