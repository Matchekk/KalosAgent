"""WebSocket server for browser UI connection."""

import asyncio
import json
import base64
from dataclasses import dataclass, asdict
from typing import Optional, Set
from enum import Enum

try:
    import websockets
    from websockets.server import serve
except ImportError:
    raise ImportError("websockets not installed. Run: pip install websockets")


class MessageType(str, Enum):
    # Server -> Client
    FRAME = "frame"
    STATE = "state"
    LLM_REQUEST = "llm_request"
    LLM_RESPONSE = "llm_response"
    TASK_UPDATE = "task_update"
    CHECKPOINT = "checkpoint"
    METRICS = "metrics"
    STATUS = "status"
    RL_STEP = "rl_step"  # Pure RL mode step data

    # Client -> Server
    COMMAND = "command"


@dataclass
class ServerState:
    """Current state of the experiment for new connections."""
    experiment_name: str = ""
    is_running: bool = False
    is_paused: bool = False
    speed: int = 1
    total_steps: int = 0
    current_checkpoint: int = 0
    current_task: Optional[str] = None


class LabServer:
    """WebSocket server that bridges lab experiments to browser UI."""

    def __init__(self, host: str = "localhost", port: int = 8765):
        self.host = host
        self.port = port
        self.clients: Set = set()
        self.state = ServerState()
        self.server = None
        self._loop = None
        self._command_queue: asyncio.Queue = None

        # Control flags
        self.paused = False
        self.speed = 1  # 1 = normal, 10 = 10x, etc.

    async def start(self):
        """Start the WebSocket server."""
        self._command_queue = asyncio.Queue()
        self.server = await serve(
            self._handle_client,
            self.host,
            self.port,
        )
        print(f"Lab server started on ws://{self.host}:{self.port}")

    async def stop(self):
        """Stop the WebSocket server."""
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def _handle_client(self, websocket):
        """Handle a client connection."""
        self.clients.add(websocket)
        print(f"Client connected. Total clients: {len(self.clients)}")

        # Send current state to new client
        await self._send_to_client(websocket, MessageType.STATUS, asdict(self.state))

        try:
            async for message in websocket:
                await self._handle_message(websocket, message)
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)
            print(f"Client disconnected. Total clients: {len(self.clients)}")

    async def _handle_message(self, websocket, message: str):
        """Handle incoming message from client."""
        try:
            data = json.loads(message)
            msg_type = data.get("type")

            if msg_type == MessageType.COMMAND:
                command = data.get("command")
                if command == "pause":
                    self.paused = True
                    self.state.is_paused = True
                    await self.broadcast(MessageType.STATUS, {"paused": True})
                elif command == "resume":
                    self.paused = False
                    self.state.is_paused = False
                    await self.broadcast(MessageType.STATUS, {"paused": False})
                elif command == "set_speed":
                    self.speed = data.get("value", 1)
                    self.state.speed = self.speed
                    await self.broadcast(MessageType.STATUS, {"speed": self.speed})
                elif command == "step":
                    # Single step when paused
                    await self._command_queue.put(("step", None))

        except json.JSONDecodeError:
            pass

    async def broadcast(self, msg_type: MessageType, data: dict):
        """Broadcast message to all connected clients."""
        if not self.clients:
            return

        message = json.dumps({
            "type": msg_type.value,
            "data": data,
        })

        # Debug: log first frame broadcast
        if msg_type == MessageType.FRAME and not hasattr(self, '_frame_logged'):
            print(f"[WS] Broadcasting first frame to {len(self.clients)} clients")
            self._frame_logged = True

        await asyncio.gather(
            *[self._send_raw(client, message) for client in self.clients],
            return_exceptions=True,
        )

    async def _send_to_client(self, websocket, msg_type: MessageType, data: dict):
        """Send message to specific client."""
        message = json.dumps({
            "type": msg_type.value,
            "data": data,
        })
        await self._send_raw(websocket, message)

    async def _send_raw(self, websocket, message: str):
        """Send raw message, handling errors."""
        try:
            await websocket.send(message)
        except websockets.exceptions.ConnectionClosed:
            self.clients.discard(websocket)

    # Methods called by harness during experiment

    async def send_frame(self, frame_data: bytes):
        """Send game frame to clients."""
        encoded = base64.b64encode(frame_data).decode('ascii')
        await self.broadcast(MessageType.FRAME, {"frame": encoded})

    async def send_state(self, state_dict: dict):
        """Send game state to clients."""
        await self.broadcast(MessageType.STATE, state_dict)

    async def send_llm_request(self, prompt: str, objective: str):
        """Notify clients of LLM request."""
        await self.broadcast(MessageType.LLM_REQUEST, {
            "prompt": prompt[:500] + "..." if len(prompt) > 500 else prompt,
            "objective": objective,
        })

    async def send_llm_response(self, response: str, task: Optional[dict] = None):
        """Send LLM response to clients."""
        await self.broadcast(MessageType.LLM_RESPONSE, {
            "response": response,
            "task": task,
        })

    async def send_task_update(
        self,
        task_type: str,
        target: str,
        status: str,
        steps: int,
        budget: int,
    ):
        """Send task status update."""
        self.state.current_task = f"{task_type}: {target}"
        await self.broadcast(MessageType.TASK_UPDATE, {
            "type": task_type,
            "target": target,
            "status": status,
            "steps": steps,
            "budget": budget,
        })

    async def send_checkpoint(self, checkpoint_id: int, name: str):
        """Notify clients of checkpoint reached."""
        self.state.current_checkpoint = checkpoint_id
        await self.broadcast(MessageType.CHECKPOINT, {
            "id": checkpoint_id,
            "name": name,
        })

    async def send_metrics(self, metrics: dict):
        """Send metrics update."""
        self.state.total_steps = metrics.get("total_steps", 0)
        await self.broadcast(MessageType.METRICS, metrics)

    async def send_rl_step(self, step_data: dict):
        """Send pure RL step data (action, rewards, epsilon)."""
        self.state.total_steps = step_data.get("step", 0)
        await self.broadcast(MessageType.RL_STEP, step_data)

    def update_status(self, **kwargs):
        """Update server state (called synchronously)."""
        for key, value in kwargs.items():
            if hasattr(self.state, key):
                setattr(self.state, key, value)

    def should_pause(self) -> bool:
        """Check if experiment should pause."""
        return self.paused

    def get_speed(self) -> int:
        """Get current speed multiplier."""
        return self.speed


# Synchronous wrapper for use in harness
class LabServerSync:
    """Synchronous wrapper around LabServer for easier integration."""

    def __init__(self, host: str = "localhost", port: int = 8765):
        self.server = LabServer(host, port)
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread = None
        self._ready = False

    def start(self):
        """Start server in background thread."""
        import threading

        def run_server():
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            try:
                self._loop.run_until_complete(self.server.start())
                self._ready = True
                print("WebSocket server started on ws://localhost:8765")
                self._loop.run_forever()
            except Exception as e:
                print(f"WebSocket server failed to start: {e}")
                self._ready = False

        self._thread = threading.Thread(target=run_server, daemon=True)
        self._thread.start()

        # Give server time to start
        import time
        time.sleep(0.5)

    def stop(self):
        """Stop the server."""
        if self._loop:
            self._loop.call_soon_threadsafe(self._loop.stop)

    def _run_async(self, coro):
        """Run async coroutine from sync context."""
        if not self._ready:
            # Server not ready, close the coroutine to avoid "never awaited" warning
            coro.close()
            return
        if self._loop and self._loop.is_running():
            future = asyncio.run_coroutine_threadsafe(coro, self._loop)
            try:
                return future.result(timeout=5.0)
            except Exception as e:
                # Don't crash on send failures
                pass
        else:
            # Close the coroutine to avoid warning
            coro.close()

    def send_frame(self, frame_data: bytes):
        self._run_async(self.server.send_frame(frame_data))

    def send_state(self, state_dict: dict):
        self._run_async(self.server.send_state(state_dict))

    def send_llm_request(self, prompt: str, objective: str):
        self._run_async(self.server.send_llm_request(prompt, objective))

    def send_llm_response(self, response: str, task: dict = None):
        self._run_async(self.server.send_llm_response(response, task))

    def send_task_update(self, task_type: str, target: str, status: str, steps: int, budget: int):
        self._run_async(self.server.send_task_update(task_type, target, status, steps, budget))

    def send_checkpoint(self, checkpoint_id: int, name: str):
        self._run_async(self.server.send_checkpoint(checkpoint_id, name))

    def send_metrics(self, metrics: dict):
        self._run_async(self.server.send_metrics(metrics))

    def send_rl_step(self, step_data: dict):
        self._run_async(self.server.send_rl_step(step_data))

    def update_status(self, **kwargs):
        self.server.update_status(**kwargs)

    def should_pause(self) -> bool:
        return self.server.should_pause()

    def get_speed(self) -> int:
        return self.server.get_speed()
