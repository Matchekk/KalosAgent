# LocalLLMPlaysPokemon Design

A local LLM-powered agent that plays Pokemon Red, inspired by ClaudePlaysPokemonStarter.

## Overview

This project creates an autonomous Pokemon Red player using:
- **PyBoy** for Game Boy emulation
- **llama-cpp-python** for local LLM inference
- **Memory reading** for game state extraction (no vision required)
- **ReAct-style prompting** for action generation
- **Web UI** for live viewing and debugging

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Web UI (FastAPI + WebSocket)       │
│   - Live game screen                                    │
│   - LLM reasoning stream                                │
│   - Game state display                                  │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                     Game Agent                          │
│   - Main loop orchestrator                              │
│   - Formats game state for LLM                          │
│   - Parses LLM actions                                  │
│   - Manages history/context                             │
└─────────────────────────────────────────────────────────┘
            │                           │
            ▼                           ▼
┌───────────────────────┐   ┌───────────────────────────┐
│   LLM Backend         │   │   Emulator (PyBoy)        │
│   (Pluggable)         │   │   - Memory Reader         │
│   - llama-cpp-python  │   │   - Button input          │
│   - Ollama (optional) │   │   - Screenshot capture    │
└───────────────────────┘   └───────────────────────────┘
```

## Key Design Decisions

### 1. LLM Backend: Pluggable with llama-cpp-python default

Abstract interface allows swapping backends:

```python
from abc import ABC, abstractmethod

class LLMBackend(ABC):
    @abstractmethod
    def generate(self, prompt: str, max_tokens: int = 512) -> str:
        pass

    @abstractmethod
    def get_model_info(self) -> dict:
        pass
```

Default implementation uses llama-cpp-python with:
- Model: `Qwen3-4B-Instruct-2507-Q4_K_M.gguf` (2.3GB)
- Context: 4096 tokens
- Full Metal GPU acceleration on Apple Silicon

### 2. Input Method: Memory-only (no vision)

The Pokemon Red memory reader provides comprehensive game state:
- Player location and coordinates
- Full Pokemon party with stats, moves, HP, status
- Inventory items and money
- Badges earned
- Current dialog text
- Collision map for navigation

This is faster and more reliable than vision, and works with smaller text-only models.

### 3. Action Format: ReAct-style prompting

Prompt template:
```
You are playing Pokemon Red. Your goal is to become the Pokemon Champion.

CURRENT GAME STATE:
- Location: {location}
- Position: ({x}, {y})
- Pokemon Party: {party_summary}
- Money: ${money}
- Badges: {badges}
- Current Dialog: {dialog_text}

VALID MOVES: {valid_directions}

COLLISION MAP:
{collision_map}

Format your response EXACTLY as:
REASONING: <your step-by-step thinking>
ACTION: <button sequence>

Valid buttons: a, b, start, select, up, down, left, right
Example: ACTION: up, up, a, a

REASONING:
```

Parser extracts actions with regex, with fallback to pressing 'a' for dialog advancement.

### 4. Context Management: Rolling summary + recent history

Local models have 4K-8K context windows. Strategy:
- Keep last 5 turns in full detail
- Compress older turns into a brief narrative summary
- Stays within ~3000 tokens for game context

### 5. Web UI: FastAPI + WebSocket + vanilla JS

Features:
- Live game screen display (canvas)
- Real-time LLM reasoning stream
- Game state panel (location, Pokemon, items)
- Controls: Start, Pause, Step (manual mode)

No heavy frontend framework - simple HTML/JS/CSS.

## Project Structure

```
LocalLLMPlaysPokemon/
├── main.py                     # Entry point, CLI args
├── config.py                   # Configuration
├── requirements.txt
│
├── agent/
│   ├── __init__.py
│   ├── game_agent.py           # Main orchestrator loop
│   ├── emulator.py             # PyBoy wrapper
│   ├── memory_reader.py        # Pokemon memory extraction
│   ├── context_manager.py      # Rolling history + summary
│   └── action_parser.py        # ReAct response parsing
│
├── llm/
│   ├── __init__.py
│   ├── base.py                 # Abstract LLMBackend class
│   └── llama_cpp_backend.py    # llama-cpp-python implementation
│
├── web/
│   ├── server.py               # FastAPI + WebSocket
│   ├── static/
│   │   ├── index.html
│   │   ├── style.css
│   │   └── app.js
│
└── models/
    └── .gitkeep
```

## Configuration

```python
# config.py
MODEL_PATH = "/Users/sidmohan/Library/Application Support/ai.threadfork.app/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
CONTEXT_SIZE = 4096
ROM_PATH = "pokemon.gb"
WEB_PORT = 8000
N_GPU_LAYERS = -1  # Use all layers on GPU (Metal)
```

## Main Game Loop

```python
async def run_step(self) -> dict:
    # 1. Get game state from memory
    state = self.emulator.get_state_from_memory()
    collision_map = self.emulator.get_collision_map()
    screenshot = self.emulator.get_screenshot_base64()

    # 2. Build prompt with context
    prompt = self._build_prompt(state, collision_map)

    # 3. Get LLM response
    response = self.llm.generate(prompt, max_tokens=512)

    # 4. Parse action
    reasoning, actions = parse_action(response)

    # 5. Execute buttons
    for button in actions:
        self.emulator.press_button(button)

    # 6. Update context history
    self.context.add_turn(state, reasoning, actions)

    # 7. Notify web UI via WebSocket
    return {"screenshot": screenshot, "state": state, "reasoning": reasoning, "action": actions}
```

## Dependencies

```
pyboy==2.2.0
llama-cpp-python>=0.2.0
fastapi>=0.100.0
uvicorn>=0.23.0
websockets>=11.0
Pillow>=10.0.0
numpy>=1.24.0
```

## Usage

```bash
# Start with web UI
python main.py --rom pokemon.gb --web

# Headless mode
python main.py --rom pokemon.gb --steps 100

# Custom model
python main.py --rom pokemon.gb --model path/to/model.gguf --web
```

## Future Enhancements (not in initial scope)

- Ollama backend support
- Session save/load
- Decision logging and replay
- Multiple game support
