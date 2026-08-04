from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

import numpy as np

from .models import CropRect, GameState, Scene, ScreenFrame, ScreenName


class UILayoutKind(StrEnum):
    SINGLE_WILD_MAIN = "single_wild_main"
    SINGLE_TRAINER_MAIN = "single_trainer_main"
    DOUBLE_MAIN = "double_main"
    SINGLE_MOVE_SELECT = "single_move_select"
    DOUBLE_MOVE_SELECT = "double_move_select"
    PARTY_SELECT = "party_select"
    MOVE_LEARN = "move_learn"
    MEGA_EVOLUTION = "mega_evolution"
    BAG = "bag"
    DIALOGUE = "dialogue"
    OVERWORLD = "overworld"


class UIRegionSemantic(StrEnum):
    OPPONENT_NAME = "opponent_name"
    OPPONENT_LEVEL = "opponent_level"
    OPPONENT_HP_BAR = "opponent_hp_bar"
    OPPONENT_2_NAME = "opponent_2_name"
    OPPONENT_2_LEVEL = "opponent_2_level"
    OPPONENT_2_HP_BAR = "opponent_2_hp_bar"
    PLAYER_NAME = "player_name"
    PLAYER_LEVEL = "player_level"
    PLAYER_HP_BAR = "player_hp_bar"
    PLAYER_HP_TEXT = "player_hp_text"
    PLAYER_2_NAME = "player_2_name"
    PLAYER_2_LEVEL = "player_2_level"
    PLAYER_2_HP_BAR = "player_2_hp_bar"
    BATTLE_MAIN_MENU = "battle_main_menu"
    MOVE_SLOT_1 = "move_slot_1"
    MOVE_SLOT_2 = "move_slot_2"
    MOVE_SLOT_3 = "move_slot_3"
    MOVE_SLOT_4 = "move_slot_4"
    MOVE_PP_1 = "move_pp_1"
    MOVE_PP_2 = "move_pp_2"
    MOVE_PP_3 = "move_pp_3"
    MOVE_PP_4 = "move_pp_4"
    PARTY_MENU = "party_menu"
    PARTY_SLOT_1 = "party_slot_1"
    PARTY_SLOT_2 = "party_slot_2"
    PARTY_SLOT_3 = "party_slot_3"
    PARTY_SLOT_4 = "party_slot_4"
    PARTY_SLOT_5 = "party_slot_5"
    PARTY_SLOT_6 = "party_slot_6"
    BAG_MENU = "bag_menu"
    DIALOGUE_TEXT = "dialogue_text"
    BATTLE_TEXT = "battle_text"
    LOCATION_NAME = "location_name"
    TOUCH_ELEMENTS = "touch_elements"
    MOVE_LEARN_OLD = "move_learn_old"
    MOVE_LEARN_NEW = "move_learn_new"
    MEGA_TOGGLE = "mega_toggle"


@dataclass(frozen=True, slots=True)
class UILayoutRegion:
    semantic: UIRegionSemantic
    screen: ScreenName
    rect: CropRect
    text: bool = False


def _region(
    semantic: UIRegionSemantic,
    screen: ScreenName,
    x: float,
    y: float,
    width: float,
    height: float,
    *,
    text: bool = False,
) -> UILayoutRegion:
    return UILayoutRegion(
        semantic=semantic,
        screen=screen,
        rect=CropRect(x=x, y=y, width=width, height=height),
        text=text,
    )


COMMON_SINGLE_TOP = (
    _region(UIRegionSemantic.OPPONENT_NAME, ScreenName.TOP, 0.04, 0.05, 0.36, 0.10, text=True),
    _region(UIRegionSemantic.OPPONENT_LEVEL, ScreenName.TOP, 0.36, 0.05, 0.13, 0.10, text=True),
    _region(UIRegionSemantic.OPPONENT_HP_BAR, ScreenName.TOP, 0.12, 0.15, 0.34, 0.055),
    _region(UIRegionSemantic.PLAYER_NAME, ScreenName.TOP, 0.55, 0.65, 0.27, 0.09, text=True),
    _region(UIRegionSemantic.PLAYER_LEVEL, ScreenName.TOP, 0.81, 0.65, 0.13, 0.09, text=True),
    _region(UIRegionSemantic.PLAYER_HP_BAR, ScreenName.TOP, 0.63, 0.75, 0.30, 0.055),
    _region(UIRegionSemantic.PLAYER_HP_TEXT, ScreenName.TOP, 0.70, 0.82, 0.23, 0.08, text=True),
    _region(UIRegionSemantic.BATTLE_TEXT, ScreenName.TOP, 0.03, 0.70, 0.94, 0.27, text=True),
)

MAIN_BOTTOM = (
    _region(UIRegionSemantic.BATTLE_MAIN_MENU, ScreenName.BOTTOM, 0.0, 0.0, 1.0, 1.0, text=True),
    _region(UIRegionSemantic.TOUCH_ELEMENTS, ScreenName.BOTTOM, 0.0, 0.0, 1.0, 1.0),
)

MOVE_BOTTOM = (
    _region(UIRegionSemantic.MOVE_SLOT_1, ScreenName.BOTTOM, 0.02, 0.08, 0.46, 0.28, text=True),
    _region(UIRegionSemantic.MOVE_SLOT_2, ScreenName.BOTTOM, 0.52, 0.08, 0.46, 0.28, text=True),
    _region(UIRegionSemantic.MOVE_SLOT_3, ScreenName.BOTTOM, 0.02, 0.48, 0.46, 0.28, text=True),
    _region(UIRegionSemantic.MOVE_SLOT_4, ScreenName.BOTTOM, 0.52, 0.48, 0.46, 0.28, text=True),
    _region(UIRegionSemantic.MOVE_PP_1, ScreenName.BOTTOM, 0.25, 0.29, 0.21, 0.08, text=True),
    _region(UIRegionSemantic.MOVE_PP_2, ScreenName.BOTTOM, 0.75, 0.29, 0.21, 0.08, text=True),
    _region(UIRegionSemantic.MOVE_PP_3, ScreenName.BOTTOM, 0.25, 0.69, 0.21, 0.08, text=True),
    _region(UIRegionSemantic.MOVE_PP_4, ScreenName.BOTTOM, 0.75, 0.69, 0.21, 0.08, text=True),
    _region(UIRegionSemantic.MEGA_TOGGLE, ScreenName.BOTTOM, 0.35, 0.82, 0.30, 0.15, text=True),
)

DOUBLE_TOP = (
    _region(UIRegionSemantic.OPPONENT_NAME, ScreenName.TOP, 0.02, 0.04, 0.26, 0.08, text=True),
    _region(UIRegionSemantic.OPPONENT_LEVEL, ScreenName.TOP, 0.27, 0.04, 0.10, 0.08, text=True),
    _region(UIRegionSemantic.OPPONENT_HP_BAR, ScreenName.TOP, 0.05, 0.12, 0.25, 0.045),
    _region(UIRegionSemantic.OPPONENT_2_NAME, ScreenName.TOP, 0.52, 0.04, 0.26, 0.08, text=True),
    _region(UIRegionSemantic.OPPONENT_2_LEVEL, ScreenName.TOP, 0.77, 0.04, 0.10, 0.08, text=True),
    _region(UIRegionSemantic.OPPONENT_2_HP_BAR, ScreenName.TOP, 0.55, 0.12, 0.25, 0.045),
    _region(UIRegionSemantic.PLAYER_NAME, ScreenName.TOP, 0.12, 0.68, 0.24, 0.08, text=True),
    _region(UIRegionSemantic.PLAYER_LEVEL, ScreenName.TOP, 0.35, 0.68, 0.10, 0.08, text=True),
    _region(UIRegionSemantic.PLAYER_HP_BAR, ScreenName.TOP, 0.12, 0.77, 0.24, 0.045),
    _region(UIRegionSemantic.PLAYER_2_NAME, ScreenName.TOP, 0.61, 0.68, 0.24, 0.08, text=True),
    _region(UIRegionSemantic.PLAYER_2_LEVEL, ScreenName.TOP, 0.84, 0.68, 0.10, 0.08, text=True),
    _region(UIRegionSemantic.PLAYER_2_HP_BAR, ScreenName.TOP, 0.61, 0.77, 0.24, 0.045),
    _region(UIRegionSemantic.BATTLE_TEXT, ScreenName.TOP, 0.03, 0.82, 0.94, 0.16, text=True),
)

PARTY_REGIONS = tuple(
    _region(
        UIRegionSemantic(f"party_slot_{index}"),
        ScreenName.BOTTOM,
        0.02 if index % 2 else 0.51,
        0.03 + ((index - 1) // 2) * 0.31,
        0.47,
        0.28,
        text=True,
    )
    for index in range(1, 7)
)


class UILayoutRegistry:
    """Owns UI meaning. OCR receives already-labelled crops and never infers semantics."""

    def __init__(self) -> None:
        self._layouts: dict[UILayoutKind, tuple[UILayoutRegion, ...]] = {
            UILayoutKind.SINGLE_WILD_MAIN: COMMON_SINGLE_TOP + MAIN_BOTTOM,
            UILayoutKind.SINGLE_TRAINER_MAIN: COMMON_SINGLE_TOP + MAIN_BOTTOM,
            UILayoutKind.SINGLE_MOVE_SELECT: COMMON_SINGLE_TOP + MOVE_BOTTOM,
            UILayoutKind.DOUBLE_MAIN: DOUBLE_TOP + MAIN_BOTTOM,
            UILayoutKind.DOUBLE_MOVE_SELECT: DOUBLE_TOP + MOVE_BOTTOM,
            UILayoutKind.PARTY_SELECT: COMMON_SINGLE_TOP
            + PARTY_REGIONS
            + (_region(UIRegionSemantic.PARTY_MENU, ScreenName.BOTTOM, 0, 0, 1, 1),),
            UILayoutKind.BAG: COMMON_SINGLE_TOP
            + (_region(UIRegionSemantic.BAG_MENU, ScreenName.BOTTOM, 0, 0, 1, 1, text=True),),
            UILayoutKind.MOVE_LEARN: (
                _region(
                    UIRegionSemantic.MOVE_LEARN_OLD,
                    ScreenName.TOP,
                    0.04,
                    0.08,
                    0.92,
                    0.60,
                    text=True,
                ),
                _region(
                    UIRegionSemantic.MOVE_LEARN_NEW,
                    ScreenName.BOTTOM,
                    0.04,
                    0.10,
                    0.92,
                    0.75,
                    text=True,
                ),
                _region(
                    UIRegionSemantic.DIALOGUE_TEXT,
                    ScreenName.TOP,
                    0.03,
                    0.72,
                    0.94,
                    0.25,
                    text=True,
                ),
            ),
            UILayoutKind.MEGA_EVOLUTION: COMMON_SINGLE_TOP + MOVE_BOTTOM,
            UILayoutKind.DIALOGUE: (
                _region(
                    UIRegionSemantic.DIALOGUE_TEXT,
                    ScreenName.TOP,
                    0.03,
                    0.66,
                    0.94,
                    0.31,
                    text=True,
                ),
            ),
            UILayoutKind.OVERWORLD: (
                _region(
                    UIRegionSemantic.LOCATION_NAME,
                    ScreenName.TOP,
                    0.10,
                    0.02,
                    0.80,
                    0.18,
                    text=True,
                ),
                _region(UIRegionSemantic.TOUCH_ELEMENTS, ScreenName.BOTTOM, 0, 0, 1, 1),
            ),
        }

    def register(self, kind: UILayoutKind, regions: tuple[UILayoutRegion, ...]) -> None:
        self._layouts[kind] = regions

    def regions(self, kind: UILayoutKind) -> tuple[UILayoutRegion, ...]:
        return self._layouts[kind]

    def resolve_kind(
        self,
        state: GameState,
        *,
        battle_type: str = "wild_single",
        mega_available: bool = False,
    ) -> UILayoutKind:
        if state.scene == Scene.BATTLE_MOVE_MENU:
            if mega_available:
                return UILayoutKind.MEGA_EVOLUTION
            return (
                UILayoutKind.DOUBLE_MOVE_SELECT
                if "double" in battle_type
                else UILayoutKind.SINGLE_MOVE_SELECT
            )
        if state.scene == Scene.BATTLE_PARTY_MENU:
            return UILayoutKind.PARTY_SELECT
        if state.scene == Scene.BAG_MENU:
            return UILayoutKind.BAG
        if state.scene == Scene.BATTLE:
            if "double" in battle_type:
                return UILayoutKind.DOUBLE_MAIN
            if "trainer" in battle_type:
                return UILayoutKind.SINGLE_TRAINER_MAIN
            return UILayoutKind.SINGLE_WILD_MAIN
        if state.scene in {Scene.DIALOGUE, Scene.CHOICE_DIALOGUE, Scene.CUTSCENE}:
            return UILayoutKind.DIALOGUE
        return UILayoutKind.OVERWORLD

    def extract(
        self,
        frame: ScreenFrame,
        kind: UILayoutKind,
        *,
        text_only: bool = False,
    ) -> dict[str, np.ndarray]:
        sources = {
            ScreenName.FULL: frame.full_frame,
            ScreenName.TOP: frame.top_screen,
            ScreenName.BOTTOM: frame.bottom_screen,
        }
        output: dict[str, np.ndarray] = {}
        for region in self.regions(kind):
            if text_only and not region.text:
                continue
            source = sources[region.screen]
            x, y, width, height = region.rect.pixels(source.shape[1], source.shape[0])
            output[region.semantic.value] = source[y : y + height, x : x + width].copy()
        return output
