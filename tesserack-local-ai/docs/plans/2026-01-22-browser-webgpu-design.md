# Browser-Based WebGPU LLM Pokemon Player - Design

A fully client-side version of Tesserack that runs entirely in the browser using WebGPU for LLM inference.

## Overview

**Goal:** Port Tesserack to run 100% in the browser with no backend required.

**Key Technologies:**
- **WebLLM (MLC-AI)** - WebGPU-accelerated LLM inference
- **binjgb** - Pure JavaScript GameBoy emulator
- **Vanilla JS** - No framework, minimal dependencies

**Model:** Qwen2.5-1.5B-Instruct-q4f16 (~1.5GB, cached in IndexedDB)

**Hosting:** Static site (GitHub Pages, Netlify, or Vercel)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (Client-Side Only)              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐    ┌─────────────┐    ┌────────────────┐  │
│  │   WebLLM    │    │   binjgb    │    │   Web UI       │  │
│  │  (WebGPU)   │◄──►│  (GB Emu)   │◄──►│  (Vanilla JS)  │  │
│  │             │    │             │    │                │  │
│  │ Qwen2.5-1.5B│    │ Memory API  │    │ Canvas + CSS   │  │
│  └─────────────┘    └─────────────┘    └────────────────┘  │
│         │                  │                   │            │
│         └──────────┬───────┴───────────────────┘            │
│                    ▼                                        │
│           ┌───────────────┐                                 │
│           │  Game Agent   │                                 │
│           │  (JS Module)  │                                 │
│           └───────────────┘                                 │
│                    │                                        │
│                    ▼                                        │
│           ┌───────────────┐                                 │
│           │ localStorage  │  ← Save states, settings        │
│           └───────────────┘                                 │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
tesserack-web/
├── index.html              # Single page app
├── style.css               # Styling (port existing)
├── js/
│   ├── app.js              # Main entry, UI logic
│   ├── emulator.js         # binjgb wrapper, memory reading
│   ├── memory-reader.js    # Pokemon Red memory addresses
│   ├── llm.js              # WebLLM wrapper
│   ├── agent.js            # Game agent logic
│   ├── action-parser.js    # Parse LLM responses
│   └── storage.js          # localStorage save/load
├── lib/
│   └── binjgb.js           # GameBoy emulator
└── README.md
```

## Data Flow

```
User loads ROM (drag & drop or file picker)
         │
         ▼
┌─────────────────────────────────────────────┐
│  1. Emulator initializes, starts running    │
│  2. WebLLM loads model (cached after first) │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│  GAME LOOP (runs in requestAnimationFrame)  │
│                                             │
│  if (turboMode):                            │
│      press A rapidly, update canvas         │
│  elif (llmMode && !manualOverride):         │
│      1. Read memory → game state            │
│      2. Build prompt                        │
│      3. await webllm.generate() → 10 actions│
│      4. Execute actions on emulator         │
│      5. Update UI                           │
│  elif (manualOverride):                     │
│      wait for timeout, then resume LLM      │
│                                             │
│  Autosave to localStorage every N steps     │
└─────────────────────────────────────────────┘
         │
         ▼
    Canvas renders game screen (60fps)
```

## Key Components

### Memory Reader (Port from Python)

```javascript
const ADDRESSES = {
  PLAYER_NAME: 0xD158,
  MONEY: 0xD347,
  BADGES: 0xD356,
  PARTY_COUNT: 0xD163,
  PARTY_DATA: 0xD164,
  MAP_ID: 0xD35E,
  PLAYER_X: 0xD362,
  PLAYER_Y: 0xD361,
  TEXT_BOX: 0xC4A0,
};

function getGameState(emu) {
  return {
    location: MAP_NAMES[readByte(emu, ADDRESSES.MAP_ID)],
    coordinates: [readByte(emu, ADDRESSES.PLAYER_X), readByte(emu, ADDRESSES.PLAYER_Y)],
    money: readMoney(emu),
    badges: readBadges(emu),
    party: readParty(emu),
    dialog: readDialog(emu),
  };
}
```

### WebLLM Integration

```javascript
import { CreateMLCEngine } from "@anthropic-ai/webllm";

let engine = null;

async function initLLM(onProgress) {
  engine = await CreateMLCEngine("Qwen2.5-1.5B-Instruct-q4f16_1-MLC", {
    initProgressCallback: onProgress,
  });
}

async function generate(prompt) {
  const response = await engine.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    max_tokens: 256,
    temperature: 0.7,
  });
  return response.choices[0].message.content;
}
```

### Storage

```javascript
// Save state to localStorage
function saveState(emu) {
  const state = emu.saveState();  // Uint8Array
  localStorage.setItem('tesserack-save', btoa(String.fromCharCode(...state)));
}

// Load state from localStorage
function loadState(emu) {
  const saved = localStorage.getItem('tesserack-save');
  if (saved) {
    const bytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
    emu.loadState(bytes);
  }
}
```

## Features (Ported from Python version)

- **Turbo Mode** - Rapid button mashing without LLM
- **LLM Mode** - AI decides 10 actions at a time
- **Co-pilot** - Manual input pauses LLM for 3 seconds
- **Manual Controls** - D-pad, A/B, Start/Select buttons
- **Keyboard Shortcuts** - Arrow keys, Z/X, Enter/Shift
- **Autosave** - Every 50 steps to localStorage
- **Save/Load** - Manual save and load buttons

## User Experience

1. User visits page
2. Model starts downloading (~1.5GB first time, shows progress bar)
3. User drops ROM file (or clicks file picker)
4. Emulator ready - click Turbo or LLM to start
5. Manual controls work anytime (pauses LLM temporarily)
6. Saves persist in localStorage across browser sessions

## Technical Considerations

### WebGPU Support
- Chrome 113+, Edge 113+, Firefox (behind flag)
- Fallback: Show message if WebGPU not supported

### Model Caching
- IndexedDB stores the model after first download
- Subsequent visits load instantly

### ROM Loading
- User provides their own ROM (legal/copyright reasons)
- File API reads ROM into memory
- No ROM stored on server

### Performance
- 60fps canvas rendering via requestAnimationFrame
- LLM inference: ~2-5 seconds per batch of 10 actions
- Turbo mode: As fast as the emulator can run

## Differences from Python Version

| Aspect | Python Version | Browser Version |
|--------|---------------|-----------------|
| LLM | llama-cpp-python | WebLLM (WebGPU) |
| Emulator | PyBoy | binjgb |
| Model | Qwen3-4B (2.3GB) | Qwen2.5-1.5B (1.5GB) |
| Backend | FastAPI + WebSocket | None (static) |
| Saves | File system | localStorage |
| Hosting | Self-hosted | GitHub Pages (free) |
