"""FastAPI web server with WebSocket for live updates."""

import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse

from agent import Emulator, GameAgent
from llm import LlamaCppBackend
import config


app = FastAPI(title="LocalLLMPlaysPokemon")

# Global state
agent: GameAgent | None = None
emulator_only: Emulator | None = None  # For turbo mode without LLM
connected_clients: list[WebSocket] = []
turbo_task: asyncio.Task | None = None
manual_override_until: float = 0  # Timestamp when manual override expires


async def broadcast(data: dict):
    """Send update to all connected WebSocket clients."""
    message = json.dumps(data, default=str)
    disconnected = []
    for client in connected_clients:
        try:
            await client.send_text(message)
        except Exception:
            disconnected.append(client)
    for client in disconnected:
        connected_clients.remove(client)


@app.get("/", response_class=HTMLResponse)
async def index():
    """Serve the main page."""
    html_path = Path(__file__).parent / "static" / "index.html"
    if html_path.exists():
        return html_path.read_text()
    return """
    <!DOCTYPE html>
    <html>
    <head><title>LocalLLMPlaysPokemon</title></head>
    <body>
        <h1>LocalLLMPlaysPokemon</h1>
        <p>Static files not found. Run from project root.</p>
    </body>
    </html>
    """


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for live updates."""
    await websocket.accept()
    connected_clients.append(websocket)

    # Send current status on connect
    if agent is not None:
        await websocket.send_text(json.dumps({"type": "started"}))
    elif emulator_only is not None:
        await websocket.send_text(json.dumps({"type": "turbo_started"}))

    try:
        while True:
            # Keep connection alive, handle any incoming messages
            data = await websocket.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "start":
                await start_agent(msg.get("rom_path", config.ROM_PATH))
            elif msg.get("type") == "stop":
                stop_agent()
            elif msg.get("type") == "step":
                if agent:
                    await agent.step()
            elif msg.get("type") == "save":
                # Manual save - works in both modes
                emu = agent.emulator if agent else emulator_only
                if emu:
                    save_path = Path(config.AUTOSAVE_PATH)
                    save_path.parent.mkdir(parents=True, exist_ok=True)
                    emu.save_state(str(save_path))
                    await broadcast({"type": "info", "message": "Game saved"})
            elif msg.get("type") == "load":
                # Manual load - works in both modes
                emu = agent.emulator if agent else emulator_only
                save_path = Path(config.AUTOSAVE_PATH)
                if emu and save_path.exists():
                    emu.load_state(str(save_path))
                    screenshot = emu.get_screenshot_base64()
                    await broadcast({
                        "type": "info",
                        "message": "Game loaded",
                        "screenshot": screenshot,
                    })
            elif msg.get("type") == "turbo_start":
                # Start turbo mode (no LLM)
                stop_agent()  # Stop LLM agent if running
                await start_turbo(msg.get("rom_path", config.ROM_PATH))
            elif msg.get("type") == "turbo_stop":
                # Stop turbo mode
                stop_turbo()
                await broadcast({"type": "turbo_stopped", "message": "Turbo mode stopped"})
            elif msg.get("type") == "button":
                # Manual button press - works in both modes
                # Also triggers manual override (pauses LLM for 3 seconds)
                global manual_override_until
                import time
                manual_override_until = time.time() + 3.0  # 3 second override

                emu = agent.emulator if agent else emulator_only
                if emu:
                    button = msg.get("button", "a")
                    emu.press_button(button)
                    screenshot = emu.get_screenshot_base64()
                    await broadcast({
                        "screenshot": screenshot,
                        "action": [f"Manual: {button}"],
                        "reasoning": "Manual control active - LLM paused",
                    })
    except WebSocketDisconnect:
        connected_clients.remove(websocket)


async def start_agent(rom_path: str):
    """Initialize and start the agent."""
    global agent

    if agent is not None:
        print("Agent already running")
        return

    print(f"Starting agent with ROM: {rom_path}")
    print(f"Model path: {config.MODEL_PATH}")

    # Initialize LLM
    print("Initializing LLM...")
    llm = LlamaCppBackend(
        model_path=config.MODEL_PATH,
        n_ctx=config.CONTEXT_SIZE,
        n_gpu_layers=config.N_GPU_LAYERS,
    )
    print("LLM initialized successfully")

    # Initialize emulator
    print("Initializing emulator...")
    emulator = Emulator(rom_path, headless=True)
    emulator.initialize()
    print("Emulator initialized successfully")

    # Create agent
    print("Creating game agent...")
    agent = GameAgent(
        llm,
        emulator,
        max_history=config.MAX_HISTORY_TURNS,
        autosave_path=config.AUTOSAVE_PATH,
        autosave_interval=config.AUTOSAVE_INTERVAL,
    )
    agent.add_callback(broadcast)

    # Try to load autosave
    if agent.load_autosave():
        await broadcast({"type": "info", "message": "Loaded autosave"})

    # Start running in background
    print("Starting agent loop...")
    agent.running = True
    asyncio.create_task(run_agent_with_error_handling())

    await broadcast({"type": "started", "message": "Agent started"})


async def run_agent_with_error_handling():
    """Run agent with exception logging and manual override support."""
    global agent, manual_override_until
    import time

    try:
        while agent and agent.running:
            # Check for manual override
            if time.time() < manual_override_until:
                # User is in control - just wait
                await asyncio.sleep(0.1)
                continue

            # LLM takes a step
            await agent.step()
            await asyncio.sleep(0.1)

    except Exception as e:
        print(f"Agent error: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        await broadcast({"type": "error", "message": str(e)})


def stop_agent():
    """Stop the running agent."""
    global agent, turbo_task
    if turbo_task:
        turbo_task.cancel()
        turbo_task = None
    if agent:
        agent.stop()
        agent.emulator.stop()
        agent = None


async def start_turbo(rom_path: str):
    """Start turbo mode - fast emulation without LLM."""
    global emulator_only, turbo_task

    if emulator_only is not None or agent is not None:
        print("Already running")
        return

    print(f"Starting TURBO mode with ROM: {rom_path}")

    # Initialize emulator only (no LLM)
    emulator_only = Emulator(rom_path, headless=True)
    emulator_only.initialize()

    # Try to load autosave
    save_path = Path(config.AUTOSAVE_PATH)
    if save_path.exists():
        emulator_only.load_state(str(save_path))
        print("Loaded autosave")

    # Start turbo loop
    turbo_task = asyncio.create_task(run_turbo_loop())
    await broadcast({"type": "turbo_started", "message": "Turbo mode started"})


async def run_turbo_loop():
    """Run turbo auto-play loop - rapidly press buttons."""
    global emulator_only
    step_count = 0
    try:
        while emulator_only:
            # Rapidly press A to advance dialog/menus
            emulator_only.press_button("a", hold_frames=3, wait_frames=5)
            step_count += 1

            # Send screenshot every 5 steps
            if step_count % 5 == 0:
                screenshot = emulator_only.get_screenshot_base64()
                await broadcast({
                    "screenshot": screenshot,
                    "action": ["Turbo: a"],
                    "reasoning": f"Turbo mode - step {step_count}",
                })

            # Autosave periodically
            if step_count % 50 == 0:
                save_path = Path(config.AUTOSAVE_PATH)
                save_path.parent.mkdir(parents=True, exist_ok=True)
                emulator_only.save_state(str(save_path))
                print(f"Turbo autosave at step {step_count}")

            # Small delay to not overwhelm
            await asyncio.sleep(0.01)

    except asyncio.CancelledError:
        print("Turbo mode stopped")
    except Exception as e:
        print(f"Turbo error: {e}")
        import traceback
        traceback.print_exc()


def stop_turbo():
    """Stop turbo mode."""
    global emulator_only, turbo_task
    if turbo_task:
        turbo_task.cancel()
        turbo_task = None
    if emulator_only:
        emulator_only.stop()
        emulator_only = None


# Mount static files
static_path = Path(__file__).parent / "static"
if static_path.exists():
    app.mount("/static", StaticFiles(directory=str(static_path)), name="static")
