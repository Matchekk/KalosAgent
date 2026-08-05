"""Main entry point for LocalLLMPlaysPokemon."""

import argparse
import asyncio

import uvicorn

import config
from agent import Emulator, GameAgent
from llm import LlamaCppBackend


def run_headless(args):
    """Run agent in headless mode."""
    print(f"Loading model from {args.model}...")
    llm = LlamaCppBackend(
        model_path=args.model,
        n_ctx=config.CONTEXT_SIZE,
        n_gpu_layers=config.N_GPU_LAYERS,
        verbose=args.verbose,
    )

    print(f"Loading ROM from {args.rom}...")
    emulator = Emulator(args.rom, headless=not args.display)
    emulator.initialize()

    if args.load_state:
        print(f"Loading state from {args.load_state}...")
        emulator.load_state(args.load_state)

    print("Creating agent...")
    agent = GameAgent(llm, emulator, max_history=args.max_history)

    def print_update(update):
        print(f"\n{'='*50}")
        print(f"Location: {update['state']['location']}")
        print(f"Reasoning: {update['reasoning'][:200]}...")
        print(f"Action: {update['action']}")

    agent.add_callback(print_update)

    print(f"\nStarting agent for {args.steps} steps...")
    try:
        asyncio.run(agent.run(steps=args.steps, delay=args.delay))
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        if args.save_state:
            print(f"Saving state to {args.save_state}...")
            emulator.save_state(args.save_state)
        emulator.stop()

    print("Done!")


def run_web(args):
    """Run with web UI."""
    # Update config with args
    config.ROM_PATH = args.rom
    config.MODEL_PATH = args.model

    print(f"Starting web server on http://{config.WEB_HOST}:{args.port}")
    uvicorn.run(
        "web.server:app",
        host=config.WEB_HOST,
        port=args.port,
        reload=False,
    )


def main():
    parser = argparse.ArgumentParser(description="LocalLLMPlaysPokemon")
    parser.add_argument("--rom", default=config.ROM_PATH, help="Path to Pokemon ROM")
    parser.add_argument("--model", default=config.MODEL_PATH, help="Path to .gguf model")
    parser.add_argument("--web", action="store_true", help="Run with web UI")
    parser.add_argument("--port", type=int, default=config.WEB_PORT, help="Web server port")
    parser.add_argument("--steps", type=int, default=10, help="Number of steps (headless mode)")
    parser.add_argument("--delay", type=float, default=0.5, help="Delay between steps")
    parser.add_argument("--display", action="store_true", help="Show emulator window")
    parser.add_argument("--max-history", type=int, default=config.MAX_HISTORY_TURNS, help="Max history turns")
    parser.add_argument("--load-state", help="Load emulator state from file")
    parser.add_argument("--save-state", help="Save emulator state to file on exit")
    parser.add_argument("--verbose", action="store_true", help="Verbose LLM output")

    args = parser.parse_args()

    if args.web:
        run_web(args)
    else:
        run_headless(args)


if __name__ == "__main__":
    main()
