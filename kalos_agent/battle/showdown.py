from __future__ import annotations

from typing import Any

from .belief import OpponentBeliefModel
from .knowledge import KnowledgeDatabase
from .models import (
    BattlePokemon,
    BattleState,
    BattleType,
    DamageClass,
    HPState,
    MoveState,
    PokemonStatus,
    PokemonType,
    StatBlock,
)
from .planner import BattleActionKind, BattlePlanner


def _identifier(value: Any) -> str:
    raw = getattr(value, "value", value)
    return str(raw).casefold().replace(" ", "-").replace("_", "-")


class ShowdownBattleAdapter:
    """Converts poke-env or compatible fakes into the emulator's canonical state."""

    def __init__(self, knowledge: KnowledgeDatabase) -> None:
        self.knowledge = knowledge

    def pokemon(self, source: Any) -> BattlePokemon:
        raw_name = getattr(source, "species", None) or getattr(source, "base_species", None)
        match = self.knowledge.resolve_alias(str(raw_name), "pokemon")
        canonical = match.canonical_name if match else _identifier(raw_name)
        record = self.knowledge.pokemon(canonical)
        if record:
            types = record.types
            base_stats = record.base_stats
            abilities = record.abilities
        else:
            types = [PokemonType(_identifier(item)) for item in getattr(source, "types", [])]
            stats = getattr(source, "base_stats", {})
            base_stats = StatBlock(
                hp=int(stats.get("hp", 1)),
                attack=int(stats.get("atk", 1)),
                defense=int(stats.get("def", 1)),
                special_attack=int(stats.get("spa", 1)),
                special_defense=int(stats.get("spd", 1)),
                speed=int(stats.get("spe", 1)),
            )
            abilities = []
        hp_fraction = float(getattr(source, "current_hp_fraction", 1.0) or 0.0)
        status_raw = _identifier(getattr(source, "status", "none"))
        status_map = {
            "brn": PokemonStatus.BURN,
            "frz": PokemonStatus.FREEZE,
            "par": PokemonStatus.PARALYSIS,
            "psn": PokemonStatus.POISON,
            "tox": PokemonStatus.BAD_POISON,
            "slp": PokemonStatus.SLEEP,
        }
        return BattlePokemon(
            canonical_name=canonical,
            level=int(getattr(source, "level", 50)),
            types=types,
            base_stats=base_stats,
            ability=_identifier(getattr(source, "ability", "")) or None,
            possible_abilities=abilities,
            hp=HPState(ratio=hp_fraction, confidence=1),
            status=status_map.get(status_raw, PokemonStatus.NONE),
            fainted=bool(getattr(source, "fainted", False)),
            revealed_moves=[_identifier(move) for move in getattr(source, "moves", {})],
            confidence=1,
        )

    def move(self, source: Any) -> MoveState:
        raw_name = getattr(source, "id", None) or getattr(source, "name", None)
        match = self.knowledge.resolve_alias(str(raw_name), "move")
        canonical = match.canonical_name if match else _identifier(raw_name)
        record = self.knowledge.move(canonical)
        if record:
            return MoveState(
                canonical_name=canonical,
                type=record.type,
                damage_class=record.damage_class,
                power=record.power,
                accuracy=record.accuracy,
                priority=record.priority,
                pp=int(getattr(source, "current_pp", record.pp) or 0),
                max_pp=int(getattr(source, "max_pp", record.pp) or record.pp),
                min_hits=record.min_hits,
                max_hits=record.max_hits,
                drain_percent=record.drain_percent,
                healing_percent=record.healing_percent,
                crit_rate=record.crit_rate,
            )
        return MoveState(
            canonical_name=canonical,
            type=PokemonType(_identifier(getattr(source, "type", "normal"))),
            damage_class=DamageClass(_identifier(getattr(source, "category", "status"))),
            power=int(getattr(source, "base_power", 0) or 0),
            accuracy=int(getattr(source, "accuracy", 100) or 100),
            priority=int(getattr(source, "priority", 0) or 0),
            pp=int(getattr(source, "current_pp", 0) or 0),
            max_pp=int(getattr(source, "max_pp", 0) or 0),
        )

    def to_battle_state(self, battle: Any) -> BattleState:
        active = getattr(battle, "active_pokemon", None)
        opponent = getattr(battle, "opponent_active_pokemon", None)
        battle_format = str(getattr(battle, "battle_format", "")).casefold()
        team = [self.pokemon(item) for item in getattr(battle, "team", {}).values()]
        opponent_team = [
            self.pokemon(item) for item in getattr(battle, "opponent_team", {}).values()
        ]
        return BattleState(
            battle_id=str(getattr(battle, "battle_tag", "showdown")),
            battle_type=(
                BattleType.SHOWDOWN_DOUBLE
                if "double" in battle_format or "vgc" in battle_format
                else BattleType.SHOWDOWN_SINGLE
            ),
            turn_number=int(getattr(battle, "turn", 0)),
            player_active=[self.pokemon(active)] if active else [],
            player_party=team,
            opponent_active=[self.pokemon(opponent)] if opponent else [],
            opponent_known_party=opponent_team,
            available_moves=[self.move(item) for item in getattr(battle, "available_moves", [])],
            uncertainty=0,
        )


class PokeEnvTrainingInterface:
    """Optional local-Showdown runner; importing KalosAgent never imports poke-env."""

    def __init__(
        self,
        knowledge: KnowledgeDatabase,
        planner: BattlePlanner,
        belief_model: OpponentBeliefModel,
        *,
        battle_format: str = "gen6randombattle",
        server_configuration: object | None = None,
    ) -> None:
        self.adapter = ShowdownBattleAdapter(knowledge)
        self.planner = planner
        self.belief_model = belief_model
        self.battle_format = battle_format
        self.server_configuration = server_configuration

    def create_player(self, **player_kwargs: Any) -> Any:
        try:
            from poke_env.player import Player
        except ImportError as exc:
            raise RuntimeError("Showdown training requires the `showdown` extra.") from exc
        interface = self

        class SharedPlannerPlayer(Player):
            async def choose_move(self, battle: Any) -> Any:
                state = interface.adapter.to_battle_state(battle)
                opponent = state.active_opponent
                if opponent is None:
                    return self.choose_random_move(battle)
                belief = interface.belief_model.initialize(opponent)
                decision = interface.planner.plan(state, belief)
                if decision.action.kind == BattleActionKind.MOVE:
                    slot = decision.action.move_slot or 0
                    moves = list(getattr(battle, "available_moves", []))
                    if slot < len(moves):
                        return self.create_order(moves[slot])
                if decision.action.kind == BattleActionKind.SWITCH:
                    index = decision.action.switch_index or 0
                    switches = list(getattr(battle, "available_switches", []))
                    if index < len(switches):
                        return self.create_order(switches[index])
                return self.choose_random_move(battle)

        player_kwargs.setdefault("battle_format", self.battle_format)
        if self.server_configuration is not None:
            player_kwargs.setdefault("server_configuration", self.server_configuration)
        return SharedPlannerPlayer(**player_kwargs)

    async def run_self_play(
        self,
        n_battles: int,
        *,
        first_player: dict[str, Any] | None = None,
        second_player: dict[str, Any] | None = None,
    ) -> dict[str, int | float]:
        if n_battles < 1:
            raise ValueError("n_battles must be positive")
        first = self.create_player(**(first_player or {}))
        second = self.create_player(**(second_player or {}))
        try:
            await first.battle_against(second, n_battles=n_battles)
            finished = int(first.n_finished_battles)
            wins = int(first.n_won_battles)
            return {
                "battles": finished,
                "first_player_wins": wins,
                "second_player_wins": int(second.n_won_battles),
                "first_player_win_rate": wins / finished if finished else 0.0,
            }
        finally:
            await first.ps_client.stop_listening()
            await second.ps_client.stop_listening()
