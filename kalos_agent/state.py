from __future__ import annotations

from collections import defaultdict

from .capture import fast_frame_hash, perceptual_hash
from .config import AgentSettings
from .models import (
    EVIDENCE_PRIORITY,
    BattleState,
    DialogueState,
    Evidence,
    EvidenceSource,
    GameState,
    MenuState,
    OCRLine,
    OverworldState,
    PerceptionEvent,
    Scene,
    ScreenFrame,
    TelemetrySnapshot,
    TitleState,
    VisionObservation,
)

TITLE_TERMS = ("pokémon x", "pokémon y", "drücke start", "press start")
BATTLE_TERMS = ("kampf", "beutel", "flucht", "was soll", "kp", "setzt")
MOVE_TERMS = ("attacke", "ap", "effektiv")
MAIN_MENU_TERMS = ("pokédex", "pokémon", "beutel", "speichern", "optionen")
PARTY_TERMS = ("bericht", "tausch", "item", "team")
BAG_TERMS = ("medizin", "items", "basis-items", "tm")
CHOICE_TERMS = ("ja", "nein", "wählen", "auswählen")
NAMING_TERMS = ("name", "eingeben", "löschen", "bestätigen")


class StateClassifier:
    def __init__(self, settings: AgentSettings) -> None:
        self.settings = settings
        self._current_scene = Scene.UNKNOWN
        self._pending_scene = Scene.UNKNOWN
        self._pending_count = 0

    def reset_hysteresis(self) -> None:
        self._current_scene = Scene.UNKNOWN
        self._pending_scene = Scene.UNKNOWN
        self._pending_count = 0

    @staticmethod
    def _text_by_region(lines: list[OCRLine]) -> dict[str, str]:
        grouped: dict[str, list[str]] = defaultdict(list)
        for line in lines:
            grouped[line.region or "unknown"].append(line.text.lower())
        return {region: " ".join(values) for region, values in grouped.items()}

    @staticmethod
    def _add_candidate(
        candidates: dict[Scene, float],
        evidence: list[Evidence],
        scene: Scene,
        confidence: float,
        source: EvidenceSource,
        value: str,
        region: str | None = None,
    ) -> None:
        candidates[scene] = max(candidates.get(scene, 0.0), confidence)
        evidence.append(
            Evidence(
                source=source,
                value=value,
                confidence=confidence,
                region=region,
            )
        )

    def _hysteresis(self, candidate: Scene, confidence: float) -> Scene:
        if candidate == self._current_scene:
            self._pending_count = 0
            return candidate
        if confidence >= self.settings.high_confidence_scene_switch:
            self._current_scene = candidate
            self._pending_count = 0
            return candidate
        if candidate != self._pending_scene:
            self._pending_scene = candidate
            self._pending_count = 1
            return self._current_scene
        self._pending_count += 1
        if self._pending_count >= self.settings.state_hysteresis_frames:
            self._current_scene = candidate
            self._pending_count = 0
        return self._current_scene

    def classify(
        self,
        frame: ScreenFrame,
        event: PerceptionEvent,
        lines: list[OCRLine],
        *,
        vision: VisionObservation | None = None,
        telemetry: TelemetrySnapshot | None = None,
        apply_hysteresis: bool = True,
    ) -> GameState:
        telemetry = telemetry or TelemetrySnapshot()
        evidence: list[Evidence] = []
        candidates: dict[Scene, float] = {}
        grouped = self._text_by_region(lines)
        all_text = " ".join(grouped.values())

        telemetry_scene = telemetry.values.get("scene") if telemetry.available else None
        if telemetry_scene:
            try:
                scene = Scene(str(telemetry_scene).upper())
                self._add_candidate(
                    candidates,
                    evidence,
                    scene,
                    1.0,
                    EvidenceSource.TELEMETRY,
                    f"telemetry scene={scene.value}",
                )
            except ValueError:
                pass
        if event.transition_active:
            self._add_candidate(
                candidates,
                evidence,
                Scene.LOADING,
                0.88,
                EvidenceSource.DETERMINISTIC,
                "large sustained screen change",
            )
        if any(term in all_text for term in TITLE_TERMS):
            self._add_candidate(
                candidates, evidence, Scene.TITLE, 0.94, EvidenceSource.OCR, all_text
            )
        battle_text = " ".join(grouped.get(region, "") for region in ("battle_text", "battle_menu"))
        if any(term in battle_text for term in BATTLE_TERMS):
            battle_scene = (
                Scene.BATTLE_MOVE_MENU
                if any(term in battle_text for term in MOVE_TERMS)
                else Scene.BATTLE
            )
            self._add_candidate(
                candidates,
                evidence,
                battle_scene,
                0.86,
                EvidenceSource.OCR,
                battle_text,
                "battle_text",
            )
        menu_text = grouped.get("bottom_menu", "")
        if sum(term in menu_text for term in MAIN_MENU_TERMS) >= 2:
            self._add_candidate(
                candidates,
                evidence,
                Scene.MAIN_MENU,
                0.84,
                EvidenceSource.OCR,
                menu_text,
                "bottom_menu",
            )
        if any(term in menu_text for term in PARTY_TERMS):
            self._add_candidate(
                candidates, evidence, Scene.PARTY_MENU, 0.76, EvidenceSource.OCR, menu_text
            )
        if any(term in menu_text for term in BAG_TERMS):
            self._add_candidate(
                candidates, evidence, Scene.BAG_MENU, 0.78, EvidenceSource.OCR, menu_text
            )
        dialogue_text = grouped.get("dialogue", "")
        if dialogue_text:
            dialogue_scene = (
                Scene.CHOICE_DIALOGUE
                if sum(term in dialogue_text for term in CHOICE_TERMS) >= 2
                else Scene.DIALOGUE
            )
            self._add_candidate(
                candidates,
                evidence,
                dialogue_scene,
                0.80,
                EvidenceSource.OCR,
                dialogue_text,
                "dialogue",
            )
        if any(term in all_text for term in NAMING_TERMS):
            self._add_candidate(
                candidates,
                evidence,
                Scene.NAMING_SCREEN,
                0.75,
                EvidenceSource.OCR,
                all_text,
            )
        if vision and vision.confidence > 0:
            candidates[vision.scene] = max(
                candidates.get(vision.scene, 0.0), vision.confidence * 0.90
            )
            evidence.extend(vision.evidence)
        if not candidates and event.stable:
            self._add_candidate(
                candidates,
                evidence,
                Scene.OVERWORLD,
                0.56,
                EvidenceSource.DETERMINISTIC,
                "stable frame without recognized UI",
            )
        raw_scene, raw_confidence = max(
            candidates.items(), key=lambda item: item[1], default=(Scene.UNKNOWN, 0.0)
        )
        scene = self._hysteresis(raw_scene, raw_confidence) if apply_hysteresis else raw_scene
        if scene != raw_scene:
            raw_confidence = max(0.35, raw_confidence * 0.65)

        weighted = sorted(
            evidence,
            key=lambda item: (EVIDENCE_PRIORITY[item.source], item.confidence),
            reverse=True,
        )
        menu_scenes = {
            Scene.MAIN_MENU,
            Scene.PARTY_MENU,
            Scene.BAG_MENU,
            Scene.BATTLE_MOVE_MENU,
            Scene.BATTLE_PARTY_MENU,
            Scene.TOUCH_MENU,
        }
        battle_scenes = {
            Scene.BATTLE,
            Scene.BATTLE_MOVE_MENU,
            Scene.BATTLE_PARTY_MENU,
        }
        return GameState(
            captured_at=frame.timestamp,
            frame_id=frame.frame_id,
            scene=scene,
            scene_confidence=raw_confidence,
            screen_stable=event.stable,
            transition_active=event.transition_active,
            dialogue=DialogueState(
                active=scene in {Scene.DIALOGUE, Scene.CHOICE_DIALOGUE},
                text=dialogue_text,
                has_choices=scene == Scene.CHOICE_DIALOGUE,
            ),
            menu=MenuState(
                active=scene in menu_scenes,
                kind=scene.value if scene in menu_scenes else None,
                options=[
                    line.text for line in lines if line.region in {"bottom_menu", "battle_menu"}
                ],
            ),
            battle=BattleState(
                active=scene in battle_scenes,
                menu=scene.value if scene in battle_scenes else None,
            ),
            overworld=OverworldState(
                active=scene == Scene.OVERWORLD,
                location_name=grouped.get("location_name") or None,
                movement_detected=any(
                    event.changes.get(name) and event.changes[name].changed
                    for name in ("top_screen",)
                ),
            ),
            title=TitleState(active=scene == Scene.TITLE),
            detected_text=lines,
            evidence=weighted,
            uncertainty=1.0 - raw_confidence,
            fast_hash=fast_frame_hash(frame.full_frame),
            perceptual_hash=perceptual_hash(frame.full_frame),
            active_regions=sorted({line.region for line in lines if line.region}),
            changed_regions=sorted(
                name for name, change in event.changes.items() if change.changed
            ),
            telemetry=telemetry,
        )
