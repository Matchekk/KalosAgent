# KalosAgent

A local-first agent scaffold for letting an LLM play **Pokémon X/Y** through the
Azahar Nintendo 3DS emulator.

The first milestone is deliberately small:

> Start at the title screen, read German dialogue, advance safely, and reach the
> starter-selection sequence without human controller input.

KalosAgent combines:

- **Azahar** for emulation
- **MSS + Win32** for exact window capture
- **Surya OCR 2** (`datalab-to/surya-ocr-2`) for German dialogue and menu text
- **Ollama** for a local vision-language model
- **vgamepad** for a virtual Xbox controller
- **SQLite** for episodic memory and debugging

The agent starts in **dry-run mode**. It will show plans but will not press
buttons until `--live` is supplied.

## Important limitations

This is an MVP, not a finished autonomous playthrough.

OCR handles dialogue and menus well, but Pokémon X/Y also requires 3D navigation.
For that reason the planner receives both the screenshot and OCR text. Long-term,
reliable navigation will need route memory, landmark recognition, stuck detection,
and possibly a map-building layer.

Use only game files and system data you are legally entitled to use. This
repository does not contain Nintendo software, keys, firmware, or ROMs.

## 1. Prerequisites

- Windows 10/11
- Python 3.11 recommended
- A working Azahar installation
- A legally obtained Pokémon X or Pokémon Y game dump
- Ollama
- A local multimodal model

Recommended starting model:

```powershell
ollama pull qwen3.5:9b
```

For a weaker PC:

```powershell
ollama pull qwen3.5:4b
```

## 2. Installation

Open PowerShell in this folder:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e .
```

Surya OCR 2 needs an inference backend. In `auto` mode it uses vLLM through
Docker on NVIDIA systems and `llama-server` from llama.cpp otherwise. Install
Docker Desktop for the NVIDIA route, or put `llama-server.exe` on `PATH` for
local CPU inference. You can also configure an existing OpenAI-compatible
Surya server through `ocr.inference_url`.

The first OCR run downloads `datalab-to/surya-ocr-2` (or its GGUF variant), so
expect a longer startup and a large local model download.

Copy the configuration:

```powershell
copy config.example.yaml config.yaml
```

## 3. Configure Azahar

1. Start Pokémon X or Y in Azahar.
2. Keep the Azahar game window visible and unobstructed.
3. In Azahar's controller settings, map an Xbox controller:
   - 3DS A/B/X/Y → Xbox A/B/X/Y
   - Circle Pad → left analog stick
   - D-pad → Xbox D-pad
   - Start/Select/L/R accordingly
4. Do not enable live control yet.

The virtual controller driver is installed by `vgamepad`. Windows may ask for
permission during installation.

## 4. Test capture

```powershell
python -m kalos_agent capture
```

A screenshot is saved under `debug/capture.png`. Verify that it contains only
the game client area, including both 3DS screens.

## 5. Test OCR

```powershell
python -m kalos_agent observe
```

The first run may download OCR models. Put a dialogue box on screen and confirm
that German text appears in the console. Stop with `Ctrl+C`.

## 6. Test planning without inputs

Ensure Ollama is running, then:

```powershell
python -m kalos_agent run
```

This is dry-run mode. The model receives the screenshot plus OCR results and
prints a constrained action plan.

## 7. Enable the controller

First test a single harmless button while the Azahar window is focused:

```powershell
python -m kalos_agent controller-test --button A
```

Then start the agent:

```powershell
python -m kalos_agent run --live
```

Emergency stop options:

- Press `Ctrl+C`
- Create an empty file named `STOP` in the project folder
- Close the terminal

The controller is reset to neutral when the process exits normally or on an
exception.

## Configuration

`config.yaml` controls:

- Azahar window-title matching
- Local Ollama model
- Surya OCR backend/server, confidence threshold, and screenshot upscaling
- Decision interval
- Maximum action count and duration
- Screenshot scaling
- Whether visual input is sent to the model
- Repetition/stuck thresholds

## Architecture

```text
Azahar window
    ↓
Screenshot capture
    ├── Surya OCR 2 → dialogue/menu text
    ├── frame-change detector
    └── compressed screenshot
            ↓
     Local Ollama VLM
            ↓ constrained JSON
     safety validator
            ↓
  virtual Xbox controller
            ↓
          Azahar
            ↓
       SQLite memory
```

## Next engineering milestones

1. Title screen → starter selection
2. Reliable battle-state parser
3. Dialogue/menu macro-controller
4. Stuck detection and recovery
5. Landmark memory for routes
6. Bottom-screen/touch support
7. Party, moves, HP and inventory state extraction
8. Long-horizon quest planner
9. Optional RAM telemetry for evaluation, not decision-making
10. Stream overlay showing observation, goal, plan and memory

## Official upstream projects

- Azahar: https://github.com/azahar-emu/azahar
- Surya OCR 2: https://huggingface.co/datalab-to/surya-ocr-2
- Ollama: https://github.com/ollama/ollama
- vgamepad: https://github.com/yannbouteiller/vgamepad
- MSS: https://python-mss.readthedocs.io/
