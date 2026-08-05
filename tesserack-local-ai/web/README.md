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

## Architecture

```
web/
  index.html          # Main HTML with UI scaffold
  style.css           # Styling
  js/
    app.js            # Main entry point, coordinates all modules
    emulator.js       # binjgb WASM wrapper
    memory-reader.js  # Pokemon Red memory reading
    llm.js            # WebLLM integration
    agent.js          # AI game agent logic
    action-parser.js  # Parse LLM responses to button presses
    storage.js        # localStorage save/load
  lib/
    binjgb.js         # GameBoy emulator
    binjgb.wasm       # Emulator WASM binary
```

## How It Works

### Overview

1. **Emulator** - binjgb runs the Pokemon Red ROM in WASM
2. **Memory Reader** - Reads game state directly from emulator memory
3. **LLM** - Qwen2.5-1.5B analyzes game state and decides actions
4. **Agent** - Executes button presses and manages game flow
5. **Storage** - Saves progress to browser localStorage

### Agent Step-by-Step Flow

When you click the **LLM** button, the agent enters a loop:

#### Step 1: Check Action Queue
```
If there are queued actions from a previous LLM call:
  → Execute the next action (e.g., press "right")
  → Wait 100ms
  → Repeat
```

#### Step 2: Queue Empty → Ask LLM

When all queued actions are executed, the agent:

**a) Reads Game State from Memory**
```
Location: PALLET_TOWN
Coordinates: (5, 3)
Money: $3000
Badges: None
Party: CHARMANDER Lv.5 HP:20/20
```

**b) Builds a Prompt**
```
You are an AI playing Pokemon Red. Goal: become Pokemon Champion.
Given the game state, output your next 10 button presses.

CURRENT GAME STATE:
Location: PALLET_TOWN
Coordinates: (5, 3)
...

PLAN:
```

**c) Calls WebLLM**

The LLM generates a response like:
```
PLAN: Walk right to exit room and talk to NPC
ACTIONS: right, right, right, up, up, a, a, a, a, a
```

**d) Parses Response**

Extracts the plan (reasoning) and actions (button presses).

**e) Queues Actions**

All 10 actions are added to the queue and executed one by one.

#### Step 3: Repeat

The loop continues - execute queued actions, then ask LLM for more when empty.

### Visual Flow

```
┌─────────────────────────────────────────────────────────┐
│                    LLM LOOP                             │
│                                                         │
│  ┌──────────────┐    ┌──────────────┐                  │
│  │ Queue empty? │─NO─► Execute next │──┐               │
│  └──────┬───────┘    │ action       │  │               │
│         │YES         └──────────────┘  │               │
│         ▼                              │               │
│  ┌──────────────┐                      │               │
│  │ Read memory  │                      │               │
│  │ (game state) │                      │               │
│  └──────┬───────┘                      │               │
│         ▼                              │               │
│  ┌──────────────┐                      │               │
│  │ Build prompt │                      │               │
│  └──────┬───────┘                      │               │
│         ▼                              │               │
│  ┌──────────────┐                      │               │
│  │ Call WebLLM  │ (2-5 seconds)        │               │
│  └──────┬───────┘                      │               │
│         ▼                              │               │
│  ┌──────────────┐                      │               │
│  │ Parse actions│                      │               │
│  │ (10 buttons) │                      │               │
│  └──────┬───────┘                      │               │
│         ▼                              │               │
│  ┌──────────────┐                      │               │
│  │ Queue actions│◄─────────────────────┘               │
│  └──────────────┘                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Key Files

| File | Role |
|------|------|
| `agent.js` | Orchestrates the loop, builds prompts, queues actions |
| `memory-reader.js` | Reads Pokemon Red RAM (location, party, badges, etc.) |
| `llm.js` | Calls WebLLM to generate responses |
| `action-parser.js` | Extracts PLAN and ACTIONS from LLM text |
| `emulator.js` | Executes button presses on the GameBoy |

### Co-pilot Mode

When you press any manual control (keyboard or on-screen buttons), the LLM is paused for 3 seconds, giving you temporary control. After 3 seconds of no input, the LLM resumes.
