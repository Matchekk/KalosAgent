from pathlib import Path

from kalos_agent.battle.belief import OpponentBeliefModel
from kalos_agent.battle.learning import BattleLearningStore
from kalos_agent.battle.parser import BattleStateParser, SemanticBattleOCR
from kalos_agent.battle.planner import BattlePlanner
from kalos_agent.battle.runtime import BattleIntelligenceRuntime
from kalos_agent.layout import UILayoutRegistry, UIRegionSemantic
from kalos_agent.models import GameState, OCRLine, Scene
from kalos_agent.testing import FakeOCRBackend, synthetic_frame
from tests.battle_fixtures import build_knowledge_database


def test_fake_battle_runtime_plans_and_records_offline_turn(tmp_path: Path) -> None:
    knowledge = build_knowledge_database(tmp_path / "knowledge.sqlite3")
    learning_path = tmp_path / "learning.sqlite3"
    learning = BattleLearningStore(learning_path)
    lines = {
        UIRegionSemantic.OPPONENT_NAME.value: [OCRLine(text="Glurak", score=0.99)],
        UIRegionSemantic.OPPONENT_LEVEL.value: [OCRLine(text="Lv. 50", score=0.99)],
        UIRegionSemantic.PLAYER_NAME.value: [OCRLine(text="Pikachu", score=0.99)],
        UIRegionSemantic.PLAYER_LEVEL.value: [OCRLine(text="Lv. 50", score=0.99)],
        UIRegionSemantic.PLAYER_HP_TEXT.value: [OCRLine(text="90 / 100", score=0.99)],
        UIRegionSemantic.MOVE_SLOT_1.value: [OCRLine(text="Donnerblitz", score=0.99)],
        UIRegionSemantic.MOVE_PP_1.value: [OCRLine(text="AP 15/15", score=0.99)],
        UIRegionSemantic.MOVE_SLOT_2.value: [OCRLine(text="Tackle", score=0.99)],
    }
    registry = UILayoutRegistry()
    belief_model = OpponentBeliefModel(knowledge)
    runtime = BattleIntelligenceRuntime(
        semantic_ocr=SemanticBattleOCR(FakeOCRBackend(lines), registry),
        registry=registry,
        parser=BattleStateParser(knowledge),
        belief_model=belief_model,
        planner=BattlePlanner(knowledge),
        learning=learning,
        knowledge=knowledge,
    )
    frame = synthetic_frame(24, frame_id="battle-before")
    state = GameState(
        frame_id=frame.frame_id,
        scene=Scene.BATTLE_MOVE_MENU,
        scene_confidence=0.99,
        screen_stable=True,
    )
    try:
        result = runtime.plan(frame, state)
        assert result.battle_state.generation == 6
        assert result.belief is not None and result.belief.pokemon == "charizard"
        assert result.decision is not None
        assert result.decision.action.move == "thunderbolt"
        assert result.action_plan.actions[-1].reason == "Confirm thunderbolt."

        after = synthetic_frame(26, frame_id="battle-after")
        after_state = state.model_copy(update={"frame_id": after.frame_id})
        learned = runtime.record_outcome(
            result,
            after,
            after_state,
            progress_score=0.5,
        )
        assert learned is not None
        assert learned["chosen_action"]["move"] == "thunderbolt"
        assert len(learning.records()) == 1
    finally:
        runtime.close()
