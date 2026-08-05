"""PyBoy emulator wrapper for Pokemon Red."""

import base64
import io

from PIL import Image
from pyboy import PyBoy

from agent.memory_reader import PokemonRedReader


class Emulator:
    """Wrapper around PyBoy for Pokemon Red."""

    VALID_BUTTONS = {"a", "b", "start", "select", "up", "down", "left", "right"}

    def __init__(self, rom_path: str, headless: bool = True, sound: bool = False):
        window = "null" if headless else "SDL2"
        self.pyboy = PyBoy(rom_path, window=window, sound=sound, cgb=True)
        self.reader = None

    def initialize(self):
        """Run emulator for a bit to ensure it's ready."""
        self.pyboy.set_emulation_speed(0)
        for _ in range(60):
            for _ in range(60):
                self.pyboy.tick()
        self.pyboy.set_emulation_speed(1)
        self._update_reader()

    def _update_reader(self):
        """Update memory reader reference."""
        self.reader = PokemonRedReader(self.pyboy.memory)

    def tick(self, frames: int = 1):
        """Advance emulator by frames."""
        for _ in range(frames):
            self.pyboy.tick()

    def press_button(self, button: str, hold_frames: int = 5, wait_frames: int = 10):
        """Press a single button."""
        if button not in self.VALID_BUTTONS:
            return False
        self.pyboy.button_press(button)
        self.tick(hold_frames)
        self.pyboy.button_release(button)
        self.tick(wait_frames)
        return True

    def press_buttons(self, buttons: list[str]) -> list[str]:
        """Press a sequence of buttons."""
        results = []
        for button in buttons:
            if self.press_button(button):
                results.append(f"Pressed {button}")
            else:
                results.append(f"Invalid button: {button}")
        return results

    def get_screenshot(self) -> Image.Image:
        """Get current screen as PIL Image."""
        return Image.fromarray(self.pyboy.screen.ndarray)

    def get_screenshot_base64(self) -> str:
        """Get screenshot as base64 string."""
        img = self.get_screenshot()
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        return base64.b64encode(buffer.getvalue()).decode()

    def get_state(self) -> dict:
        """Get complete game state from memory."""
        self._update_reader()

        party = self.reader.read_party_pokemon()
        party_summary = []
        for p in party:
            types = p.type1.name
            if p.type2:
                types += f"/{p.type2.name}"
            party_summary.append(
                f"{p.nickname} ({p.species_name}) Lv.{p.level} "
                f"HP:{p.current_hp}/{p.max_hp} [{types}]"
            )

        return {
            "player_name": self.reader.read_player_name(),
            "rival_name": self.reader.read_rival_name(),
            "money": self.reader.read_money(),
            "location": self.reader.read_location(),
            "coordinates": self.reader.read_coordinates(),
            "badges": self.reader.read_badges(),
            "party": party_summary,
            "party_pokemon": party,
            "items": self.reader.read_items(),
            "dialog": self.reader.read_dialog(),
        }

    def get_collision_map(self) -> str | None:
        """Get ASCII collision map showing player position."""
        try:
            collision = self.pyboy.game_wrapper.game_area_collision()

            # Downsample 18x20 to 9x10
            terrain = collision.reshape(9, 2, 10, 2).mean(axis=(1, 3))

            # Get player direction
            full_map = self.pyboy.game_wrapper.game_area()
            direction = self._get_direction(full_map)

            dir_chars = {"up": "^", "down": "v", "left": "<", "right": ">"}
            player_char = dir_chars.get(direction, "P")

            lines = ["+----------+"]
            for i in range(9):
                row = "|"
                for j in range(10):
                    if i == 4 and j == 4:
                        row += player_char
                    elif terrain[i][j] == 0:
                        row += "#"  # Wall
                    else:
                        row += "."  # Walkable
                row += "|"
                lines.append(row)
            lines.append("+----------+")

            return "\n".join(lines)
        except Exception:
            return None

    def _get_direction(self, array) -> str:
        """Determine player facing direction from sprite pattern."""
        rows, cols = array.shape
        for i in range(rows - 1):
            for j in range(cols - 1):
                grid = list(array[i:i+2, j:j+2].flatten())
                if grid == [0, 1, 2, 3]:
                    return "down"
                elif grid == [4, 5, 6, 7]:
                    return "up"
                elif grid == [9, 8, 11, 10]:
                    return "right"
                elif grid == [8, 9, 10, 11]:
                    return "left"
        return "down"

    def get_valid_moves(self) -> list[str]:
        """Get list of valid movement directions."""
        try:
            collision = self.pyboy.game_wrapper.game_area_collision()
            terrain = collision.reshape(9, 2, 10, 2).mean(axis=(1, 3))

            moves = []
            if terrain[3][4] != 0:
                moves.append("up")
            if terrain[5][4] != 0:
                moves.append("down")
            if terrain[4][3] != 0:
                moves.append("left")
            if terrain[4][5] != 0:
                moves.append("right")
            return moves
        except Exception:
            return ["up", "down", "left", "right"]

    def load_state(self, path: str):
        """Load emulator state from file."""
        with open(path, "rb") as f:
            self.pyboy.load_state(f)
        self._update_reader()

    def save_state(self, path: str):
        """Save emulator state to file."""
        with open(path, "wb") as f:
            self.pyboy.save_state(f)

    def stop(self):
        """Stop the emulator."""
        self.pyboy.stop()
