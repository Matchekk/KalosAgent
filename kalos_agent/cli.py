from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict
from pathlib import Path
from typing import cast

from rich.console import Console

from .agent import build_runtime
from .capture import AzaharCaptureBackend, save_frame
from .config import AppConfig, load_config
from .ocr_engine import PaddleOCRBackend
from .perception import EventDrivenOCR, FrameChangeDetector
from .planner import OllamaPlannerBackend, OpenAICompatiblePlannerBackend
from .replay import ReplayEngine, ReplayMode


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kalos-agent")
    parser.add_argument("--config", default="config.yaml")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("capture", help="Save one segmented Azahar screenshot.")
    subparsers.add_parser("observe", help="Print event-driven OCR and state changes.")

    run_parser = subparsers.add_parser("run", help="Run KalosAgent v0.3.")
    run_parser.add_argument("--live", action="store_true")
    run_parser.add_argument("--record", action="store_true")

    record_parser = subparsers.add_parser("record", help="Record a replay episode.")
    record_parser.add_argument(
        "--live",
        action="store_true",
        help="Explicitly permit inputs; recording is otherwise dry-run.",
    )

    replay_parser = subparsers.add_parser(
        "replay", help="Replay an episode without Azahar or a controller."
    )
    replay_parser.add_argument("episode_directory")
    replay_parser.add_argument(
        "--mode", choices=("saved", "planner", "perception"), default="saved"
    )

    benchmark_parser = subparsers.add_parser(
        "benchmark", help="Aggregate metrics from a replay dataset."
    )
    benchmark_parser.add_argument("dataset_directory")

    inspect_parser = subparsers.add_parser("inspect", help="Inspect replay contents and metrics.")
    inspect_parser.add_argument("episode_directory")

    subparsers.add_parser(
        "knowledge-import",
        help="Cache PokéAPI and build the local Generation-VI X/Y database.",
    )
    subparsers.add_parser("knowledge-status", help="Inspect the local battle database.")
    battle_benchmark = subparsers.add_parser(
        "battle-benchmark", help="Evaluate recorded canonical battle turns offline."
    )
    battle_benchmark.add_argument("database", nargs="?")
    battle_export = subparsers.add_parser(
        "battle-export", help="Export offline learning datasets from recorded turns."
    )
    battle_export.add_argument("output_directory")
    battle_export.add_argument("--database")
    navigation_inspect = subparsers.add_parser(
        "navigation-inspect", help="Inspect the learned navigation graph."
    )
    navigation_inspect.add_argument("--database")
    showdown = subparsers.add_parser(
        "showdown-self-play",
        help="Run the canonical BattlePlanner against itself on local Showdown.",
    )
    showdown.add_argument("--battles", type=int, default=10)
    return parser


def _config(path: str) -> AppConfig:
    config_path = Path(path)
    return load_config(config_path) if config_path.exists() else AppConfig()


def _print_json(value: object) -> None:
    Console().print_json(json.dumps(value, ensure_ascii=False))


def command_capture(config_path: str) -> None:
    config = _config(config_path)
    capture = AzaharCaptureBackend(config.window, config.capture)
    try:
        frame = capture.capture()
        output = config.capture.debug_dir / "capture.png"
        save_frame(output, frame.full_frame)
        debug = config.capture.debug_dir / "capture-regions.png"
        save_frame(debug, capture.segmenter.debug_overlay(frame))
        Console().print(f"Saved [bold]{output.resolve()}[/bold] and {debug.resolve()}")
    finally:
        capture.close()


def command_observe(config_path: str) -> None:
    config = _config(config_path)
    capture = AzaharCaptureBackend(config.window, config.capture)
    backend = PaddleOCRBackend(
        detection_model=config.ocr.detection_model,
        recognition_model=config.ocr.recognition_model,
        device=config.ocr.device,
        min_score=config.ocr.min_score,
        upscale=config.ocr.upscale,
    )
    ocr = EventDrivenOCR(backend, config.ocr)
    detector = FrameChangeDetector(config.change)
    interval = 1 / config.capture.capture_hz
    try:
        while not config.agent.stop_file.exists():
            frame = capture.capture()
            event = detector.analyze(frame)
            result = ocr.process(frame, event)
            Console().print(
                f"stable={event.stable} transition={event.transition_active} "
                f"ocr_calls={result.calls}: "
                + (" | ".join(line.text for line in result.lines) or "(no text)")
            )
            time.sleep(interval)
    except KeyboardInterrupt:
        pass
    finally:
        ocr.close()
        capture.close()


def command_run(config_path: str, *, live: bool, record: bool) -> None:
    config = _config(config_path)
    runtime = build_runtime(config, live=live, record=record)
    runtime.run(live_requested=live)


def command_replay(config_path: str, directory: str, mode: str) -> None:
    config = _config(config_path)
    engine = ReplayEngine(
        layout=config.capture.layout,
        change=config.change,
        agent=config.agent,
    )
    planner = None
    if mode == "planner":
        planner = (
            OpenAICompatiblePlannerBackend(config.planner)
            if config.planner.backend == "openai"
            else OllamaPlannerBackend(config.planner)
        )
    try:
        _print_json(engine.run(directory, mode=cast(ReplayMode, mode), planner=planner))
    finally:
        if planner:
            planner.close()


def command_knowledge_import(config_path: str) -> None:
    from .battle.knowledge import CachedPokeAPIClient, KnowledgeDatabase, PokeAPIImporter

    config = _config(config_path)
    database = KnowledgeDatabase(config.knowledge.database_path)
    client = CachedPokeAPIClient(
        config.knowledge.cache_dir,
        base_url=config.knowledge.base_url,
    )
    try:
        summary = PokeAPIImporter(database, client).import_all()
        _print_json(asdict(summary))
    finally:
        client.close()
        database.close()


def command_knowledge_status(config_path: str) -> None:
    from .battle.knowledge import KnowledgeDatabase

    config = _config(config_path)
    database = KnowledgeDatabase(config.knowledge.database_path, read_only=True)
    try:
        counts = {
            table: database.connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in (
                "pokemon",
                "moves",
                "abilities",
                "learnsets",
                "machines",
                "type_efficacy",
                "aliases",
            )
        }
        _print_json({"database": str(database.path.resolve()), "generation": 6, **counts})
    finally:
        database.close()


def command_battle_store(
    config_path: str,
    *,
    database_path: str | None,
    output_directory: str | None = None,
) -> None:
    from .battle.learning import BattleLearningStore

    config = _config(config_path)
    store = BattleLearningStore(database_path or config.battle_intelligence.learning_database_path)
    try:
        if output_directory:
            paths = store.export_datasets(output_directory)
            _print_json({name: str(path.resolve()) for name, path in paths.items()})
        else:
            _print_json(store.benchmark())
    finally:
        store.close()


def command_navigation_inspect(config_path: str, database_path: str | None) -> None:
    from .navigation import NavigationMemory

    config = _config(config_path)
    navigation = NavigationMemory(database_path or config.navigation.database_path)
    try:
        _print_json(navigation.benchmark())
    finally:
        navigation.close()


def command_showdown_self_play(config_path: str, battles: int) -> None:
    import asyncio

    try:
        from poke_env import ServerConfiguration
    except ImportError as exc:
        raise RuntimeError("Install the optional showdown extra first.") from exc
    from .battle.belief import OpponentBeliefModel
    from .battle.knowledge import KnowledgeDatabase
    from .battle.planner import BattlePlanner
    from .battle.showdown import PokeEnvTrainingInterface

    config = _config(config_path)
    knowledge = KnowledgeDatabase(config.knowledge.database_path, read_only=True)
    try:
        belief = OpponentBeliefModel(knowledge)
        interface = PokeEnvTrainingInterface(
            knowledge,
            BattlePlanner(knowledge),
            belief,
            battle_format=config.showdown.battle_format,
            server_configuration=ServerConfiguration(
                config.showdown.server_url,
                config.showdown.authentication_url,
            ),
        )
        _print_json(asyncio.run(interface.run_self_play(battles)))
    finally:
        knowledge.close()


def main() -> None:
    args = build_parser().parse_args()
    if args.command == "capture":
        command_capture(args.config)
    elif args.command == "observe":
        command_observe(args.config)
    elif args.command == "run":
        command_run(args.config, live=args.live, record=args.record)
    elif args.command == "record":
        command_run(args.config, live=args.live, record=True)
    elif args.command == "replay":
        command_replay(args.config, args.episode_directory, args.mode)
    elif args.command == "benchmark":
        _print_json(ReplayEngine.benchmark(args.dataset_directory))
    elif args.command == "inspect":
        _print_json(ReplayEngine.inspect(args.episode_directory))
    elif args.command == "knowledge-import":
        command_knowledge_import(args.config)
    elif args.command == "knowledge-status":
        command_knowledge_status(args.config)
    elif args.command == "battle-benchmark":
        command_battle_store(args.config, database_path=args.database)
    elif args.command == "battle-export":
        command_battle_store(
            args.config,
            database_path=args.database,
            output_directory=args.output_directory,
        )
    elif args.command == "navigation-inspect":
        command_navigation_inspect(args.config, args.database)
    elif args.command == "showdown-self-play":
        command_showdown_self_play(args.config, args.battles)
    else:  # pragma: no cover
        raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    main()
