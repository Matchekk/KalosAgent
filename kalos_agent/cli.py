from __future__ import annotations

import argparse
import time

from rich.console import Console

from .agent import KalosAgent
from .capture import AzaharCapture
from .config import load_config
from .controller import SafetyLimits, VirtualController
from .models import ActionName, ActionPlan, ActionStep
from .ocr_engine import SuryaOCREngine


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kalos-agent")
    parser.add_argument("--config", default="config.yaml")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("capture", help="Save one Azahar client screenshot.")
    subparsers.add_parser("observe", help="Continuously print OCR results.")

    run_parser = subparsers.add_parser("run", help="Start the agent loop.")
    run_parser.add_argument(
        "--live",
        action="store_true",
        help="Actually send controller inputs. Without this flag, plans are dry-run.",
    )

    controller_parser = subparsers.add_parser(
        "controller-test", help="Send one test controller action."
    )
    controller_parser.add_argument(
        "--button",
        choices=[item.value for item in ActionName if item != ActionName.WAIT],
        default="A",
    )
    controller_parser.add_argument("--duration-ms", type=int, default=150)

    return parser


def command_capture(config_path: str) -> None:
    config = load_config(config_path)
    capture = AzaharCapture(config.window.title_contains)
    try:
        output = config.capture.debug_dir / "capture.png"
        path = capture.save(output)
        Console().print(f"Saved: [bold]{path.resolve()}[/bold]")
    finally:
        capture.close()


def command_observe(config_path: str) -> None:
    config = load_config(config_path)
    capture = AzaharCapture(config.window.title_contains)
    ocr = SuryaOCREngine(
        backend=config.ocr.backend,
        inference_url=config.ocr.inference_url,
        parallel=config.ocr.parallel,
        min_score=config.ocr.min_score,
        upscale=config.ocr.upscale,
    )
    console = Console()
    console.print("OCR observer running. Press Ctrl+C to stop.")
    try:
        while True:
            frame = capture.grab()
            lines = ocr.read(frame)
            console.print(" | ".join(line.text for line in lines) or "(no text)")
            time.sleep(config.agent.decision_interval_seconds)
    except KeyboardInterrupt:
        pass
    finally:
        ocr.close()
        capture.close()


def command_controller_test(config_path: str, button: str, duration_ms: int) -> None:
    config = load_config(config_path)
    controller = VirtualController(
        dry_run=False,
        limits=SafetyLimits(
            max_steps_per_plan=1,
            max_action_duration_ms=config.agent.max_action_duration_ms,
        ),
    )
    try:
        plan = ActionPlan(
            state_summary="Manual controller test.",
            immediate_goal=f"Send {button}.",
            confidence=1.0,
            steps=[
                ActionStep(
                    action=ActionName(button),
                    duration_ms=duration_ms,
                    reason="Manual test requested from CLI.",
                )
            ],
        )
        controller.execute(plan)
        Console().print(f"Sent controller action: [bold]{button}[/bold]")
    finally:
        controller.reset()


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "capture":
        command_capture(args.config)
    elif args.command == "observe":
        command_observe(args.config)
    elif args.command == "controller-test":
        command_controller_test(args.config, args.button, args.duration_ms)
    elif args.command == "run":
        config = load_config(args.config)
        KalosAgent(config, live=args.live).run()
    else:  # pragma: no cover
        raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
