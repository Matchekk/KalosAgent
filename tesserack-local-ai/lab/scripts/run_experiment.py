#!/usr/bin/env python3
"""Run a Tesserack experiment."""

import argparse
from pathlib import Path
import sys

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from tesserack.config import ExperimentConfig
from tesserack.harness import Harness


def main():
    parser = argparse.ArgumentParser(description="Run Tesserack experiment")
    parser.add_argument(
        "config",
        nargs="?",
        default=None,
        help="Path to config JSON file",
    )
    parser.add_argument(
        "--rom",
        type=str,
        default="pokemon_red.gb",
        help="Path to Pokemon Red ROM",
    )
    parser.add_argument(
        "--model",
        type=str,
        default="llama3.2:3b",
        help="LLM model to use",
    )
    parser.add_argument(
        "--backend",
        type=str,
        default="ollama",
        choices=["ollama", "openai"],
        help="LLM backend",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=100000,
        help="Maximum steps to run",
    )
    parser.add_argument(
        "--target",
        type=int,
        default=13,  # Misty
        help="Target checkpoint (0 = no limit)",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        default=True,
        help="Run without display",
    )
    parser.add_argument(
        "--show",
        action="store_true",
        help="Show game window",
    )
    parser.add_argument(
        "--server",
        action="store_true",
        help="Start WebSocket server for browser UI (ws://localhost:8765)",
    )

    args = parser.parse_args()

    # Load or create config
    if args.config:
        config = ExperimentConfig.from_file(args.config)
        # Override headless if --show is specified
        if args.show:
            config.emulator.headless = False
    else:
        config = ExperimentConfig(
            name=f"run_{args.model.replace(':', '_')}",
            target_checkpoint=args.target,
            max_steps=args.max_steps,
        )
        config.emulator.rom_path = args.rom
        config.emulator.headless = not args.show
        config.llm.model = args.model
        config.llm.backend = args.backend

    # Run experiment
    harness = Harness(config, enable_server=args.server)
    success = harness.run()

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
