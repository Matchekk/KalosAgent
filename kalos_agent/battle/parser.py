from __future__ import annotations

import re
import time
from dataclasses import dataclass

import numpy as np

from ..backends import OCRBackend
from ..layout import UILayoutKind, UILayoutRegistry, UIRegionSemantic
from ..models import GameState, OCRLine, ScreenFrame
from .knowledge import EntityMatch, KnowledgeDatabase, MoveRecord, PokemonRecord
from .models import (
    BattleLogEvent,
    BattlePokemon,
    BattleState,
    BattleType,
    HPState,
    MoveState,
    PokemonStatus,
    StatStages,
    Terrain,
    Weather,
)

LEVEL_PATTERN = re.compile(r"(?:lv\.?|lvl\.?|level)\s*(\d{1,3})", re.IGNORECASE)
HP_PATTERN = re.compile(r"(\d{1,4})\s*/\s*(\d{1,4})")
PP_PATTERN = re.compile(r"(?:pp|ap)\s*(\d{1,2})\s*/\s*(\d{1,2})", re.IGNORECASE)
USED_MOVE_PATTERNS = (
    re.compile(r"(?:setzt|setzte)\s+(.+?)\s+ein", re.IGNORECASE),
    re.compile(r"used\s+(.+?)[!.]?$", re.IGNORECASE),
)


@dataclass(slots=True)
class SemanticOCRResult:
    lines: list[OCRLine]
    calls: int
    latency_ms: float
    layout: UILayoutKind
    crops: dict[str, np.ndarray]


class SemanticBattleOCR:
    """Runs OCR on registry-defined crops; semantics never come from OCR itself."""

    def __init__(self, backend: OCRBackend, registry: UILayoutRegistry) -> None:
        self.backend = backend
        self.registry = registry

    def recognize(
        self,
        frame: ScreenFrame,
        state: GameState,
        *,
        battle_type: BattleType,
        mega_available: bool = False,
    ) -> SemanticOCRResult:
        started = time.perf_counter()
        layout = self.registry.resolve_kind(
            state,
            battle_type=battle_type.value,
            mega_available=mega_available,
        )
        crops = self.registry.extract(frame, layout, text_only=True)
        lines = [
            line
            for semantic, image in crops.items()
            for line in self.backend.recognize(image, region=semantic)
        ]
        return SemanticOCRResult(
            lines=lines,
            calls=len(crops),
            latency_ms=(time.perf_counter() - started) * 1000,
            layout=layout,
            crops=crops,
        )


class BattleParseInput:
    def __init__(
        self,
        *,
        battle_id: str,
        frame_id: str,
        battle_type: BattleType,
        lines: list[OCRLine],
        hp_ratios: dict[str, float] | None = None,
        previous: BattleState | None = None,
    ) -> None:
        self.battle_id = battle_id
        self.frame_id = frame_id
        self.battle_type = battle_type
        self.lines = lines
        self.hp_ratios = hp_ratios or {}
        self.previous = previous


class BattleStateParser:
    def __init__(self, knowledge: KnowledgeDatabase) -> None:
        self.knowledge = knowledge

    @staticmethod
    def _group(lines: list[OCRLine]) -> dict[str, list[OCRLine]]:
        output: dict[str, list[OCRLine]] = {}
        for line in lines:
            output.setdefault(line.region or "unknown", []).append(line)
        return output

    @staticmethod
    def _text(grouped: dict[str, list[OCRLine]], semantic: UIRegionSemantic) -> str:
        return " ".join(line.text for line in grouped.get(semantic.value, []))

    @staticmethod
    def _level(*texts: str, fallback: int = 50) -> tuple[int, float]:
        for text in texts:
            match = LEVEL_PATTERN.search(text)
            if match:
                return min(100, max(1, int(match.group(1)))), 0.98
        return fallback, 0.25

    @staticmethod
    def _clean_name(text: str) -> str:
        text = LEVEL_PATTERN.sub("", text)
        text = HP_PATTERN.sub("", text)
        return " ".join(re.sub(r"[^\wÄÖÜäöüß'\-. ]+", " ", text).split())

    def _pokemon(
        self,
        text: str,
        level_text: str,
        hp: HPState,
        previous: BattlePokemon | None,
    ) -> tuple[BattlePokemon | None, float]:
        cleaned = self._clean_name(text)
        match = self.knowledge.resolve_alias(cleaned, "pokemon") if cleaned else None
        if match is None:
            return (
                (previous.model_copy(deep=True), previous.confidence * 0.8)
                if previous
                else (None, 0.0)
            )
        record = self.knowledge.pokemon(match.canonical_name)
        if record is None:
            return None, 0.0
        level, level_confidence = self._level(
            level_text, text, fallback=previous.level if previous else 50
        )
        result = self._from_record(record, match, level, hp, previous)
        return result, min(match.confidence, level_confidence if level_text else match.confidence)

    @staticmethod
    def _from_record(
        record: PokemonRecord,
        match: EntityMatch,
        level: int,
        hp: HPState,
        previous: BattlePokemon | None,
    ) -> BattlePokemon:
        return BattlePokemon(
            canonical_name=record.canonical_name,
            display_name=match.matched_alias,
            form=record.form_name,
            level=level,
            types=record.types,
            base_stats=record.base_stats,
            ability=previous.ability if previous else None,
            possible_abilities=record.abilities,
            hp=hp,
            status=previous.status if previous else PokemonStatus.NONE,
            stat_stages=previous.stat_stages if previous else StatStages(),
            revealed_moves=previous.revealed_moves if previous else [],
            possible_moves=previous.possible_moves if previous else {},
            speed_estimate=previous.speed_estimate if previous else None,
            fainted=hp.ratio <= 0,
            confidence=match.confidence,
        )

    def _move(self, text: str, pp_text: str) -> tuple[MoveState | None, float]:
        cleaned = PP_PATTERN.sub("", text).strip(" -:|")
        match = self.knowledge.resolve_alias(cleaned, "move") if cleaned else None
        if match is None:
            return None, 0.0
        record = self.knowledge.move(match.canonical_name)
        if record is None:
            return None, 0.0
        current_pp, maximum_pp = record.pp, record.pp
        pp_match = PP_PATTERN.search(f"{text} {pp_text}")
        if pp_match:
            current_pp, maximum_pp = int(pp_match.group(1)), int(pp_match.group(2))
        return self._move_from_record(record, match, current_pp, maximum_pp), match.confidence

    @staticmethod
    def _move_from_record(
        record: MoveRecord,
        match: EntityMatch,
        current_pp: int,
        maximum_pp: int,
    ) -> MoveState:
        return MoveState(
            canonical_name=record.canonical_name,
            display_name=match.matched_alias,
            type=record.type,
            damage_class=record.damage_class,
            power=record.power,
            accuracy=record.accuracy,
            priority=record.priority,
            pp=current_pp,
            max_pp=maximum_pp,
            min_hits=record.min_hits,
            max_hits=record.max_hits,
            drain_percent=record.drain_percent,
            healing_percent=record.healing_percent,
            crit_rate=record.crit_rate,
            effect_chance=record.effect_chance,
            ailment=record.ailment,
            confidence=match.confidence,
        )

    @staticmethod
    def _hp(text: str, ratio: float | None) -> HPState:
        match = HP_PATTERN.search(text)
        if match:
            return HPState(
                current=int(match.group(1)),
                maximum=int(match.group(2)),
                confidence=0.98,
            )
        if ratio is not None:
            return HPState(ratio=min(1.0, max(0.0, ratio)), confidence=0.85)
        return HPState(confidence=0.0)

    def _battle_log(self, text: str, turn: int) -> list[BattleLogEvent]:
        events: list[BattleLogEvent] = []
        for pattern in USED_MOVE_PATTERNS:
            match = pattern.search(text)
            if not match:
                continue
            move_match = self.knowledge.resolve_alias(match.group(1).strip(" .!"), "move")
            events.append(
                BattleLogEvent(
                    turn=turn,
                    kind="move_revealed",
                    move=move_match.canonical_name if move_match else None,
                    text=text,
                    confidence=move_match.confidence if move_match else 0.3,
                )
            )
            break
        return events

    def parse(self, source: BattleParseInput) -> BattleState:
        grouped = self._group(source.lines)
        previous = source.previous
        opponent_previous = previous.active_opponent if previous else None
        player_previous = previous.active_player if previous else None
        opponent_2_previous = (
            previous.opponent_active[1]
            if previous and len(previous.opponent_active) > 1
            else None
        )
        player_2_previous = (
            previous.player_active[1] if previous and len(previous.player_active) > 1 else None
        )
        opponent_hp = self._hp(
            self._text(grouped, UIRegionSemantic.OPPONENT_HP_BAR),
            source.hp_ratios.get(UIRegionSemantic.OPPONENT_HP_BAR.value),
        )
        player_hp_text = " ".join(
            (
                self._text(grouped, UIRegionSemantic.PLAYER_HP_TEXT),
                self._text(grouped, UIRegionSemantic.PLAYER_HP_BAR),
            )
        )
        player_hp = self._hp(
            player_hp_text,
            source.hp_ratios.get(UIRegionSemantic.PLAYER_HP_BAR.value),
        )
        opponent, opponent_confidence = self._pokemon(
            self._text(grouped, UIRegionSemantic.OPPONENT_NAME),
            self._text(grouped, UIRegionSemantic.OPPONENT_LEVEL),
            opponent_hp,
            opponent_previous,
        )
        player, player_confidence = self._pokemon(
            self._text(grouped, UIRegionSemantic.PLAYER_NAME),
            self._text(grouped, UIRegionSemantic.PLAYER_LEVEL),
            player_hp,
            player_previous,
        )
        opponent_2, opponent_2_confidence = self._pokemon(
            self._text(grouped, UIRegionSemantic.OPPONENT_2_NAME),
            self._text(grouped, UIRegionSemantic.OPPONENT_2_LEVEL),
            self._hp(
                self._text(grouped, UIRegionSemantic.OPPONENT_2_HP_BAR),
                source.hp_ratios.get(UIRegionSemantic.OPPONENT_2_HP_BAR.value),
            ),
            opponent_2_previous,
        )
        player_2, player_2_confidence = self._pokemon(
            self._text(grouped, UIRegionSemantic.PLAYER_2_NAME),
            self._text(grouped, UIRegionSemantic.PLAYER_2_LEVEL),
            self._hp(
                self._text(grouped, UIRegionSemantic.PLAYER_2_HP_BAR),
                source.hp_ratios.get(UIRegionSemantic.PLAYER_2_HP_BAR.value),
            ),
            player_2_previous,
        )
        moves: list[MoveState] = []
        confidences = [
            value
            for value in (
                opponent_confidence,
                opponent_2_confidence,
                player_confidence,
                player_2_confidence,
            )
            if value
        ]
        for index in range(1, 5):
            semantic = UIRegionSemantic(f"move_slot_{index}")
            pp_semantic = UIRegionSemantic(f"move_pp_{index}")
            move, confidence = self._move(
                self._text(grouped, semantic),
                self._text(grouped, pp_semantic),
            )
            if move:
                moves.append(move)
                confidences.append(confidence)
        turn = previous.turn_number if previous else 0
        battle_text = self._text(grouped, UIRegionSemantic.BATTLE_TEXT)
        new_events = self._battle_log(battle_text, turn)
        log = list(previous.battle_log if previous else []) + new_events
        average_confidence = sum(confidences) / len(confidences) if confidences else 0.0
        player_party = list(previous.player_party if previous else [])
        if player and not any(
            item.canonical_name == player.canonical_name for item in player_party
        ):
            player_party.insert(0, player)
        if player_2 and not any(
            item.canonical_name == player_2.canonical_name for item in player_party
        ):
            player_party.append(player_2)
        opponent_party = list(previous.opponent_known_party if previous else [])
        if opponent and not any(
            item.canonical_name == opponent.canonical_name for item in opponent_party
        ):
            opponent_party.append(opponent)
        if opponent_2 and not any(
            item.canonical_name == opponent_2.canonical_name for item in opponent_party
        ):
            opponent_party.append(opponent_2)
        return BattleState(
            battle_id=source.battle_id,
            battle_type=source.battle_type,
            turn_number=turn,
            weather=previous.weather if previous else Weather.NONE,
            terrain=previous.terrain if previous else Terrain.NONE,
            player_active=[item for item in (player, player_2) if item],
            player_party=player_party,
            opponent_active=[item for item in (opponent, opponent_2) if item],
            opponent_known_party=opponent_party,
            available_moves=moves,
            available_switches=previous.available_switches if previous else [],
            battle_log=log,
            uncertainty=1.0 - average_confidence,
            source_frame_id=source.frame_id,
        )
