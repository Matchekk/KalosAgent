"""PyBoy emulator wrapper for Pokemon Red."""

from pathlib import Path
from typing import Optional
import numpy as np

try:
    from pyboy import PyBoy
except ImportError:
    raise ImportError("PyBoy not installed. Run: pip install pyboy")


class Emulator:
    """Wrapper around PyBoy for Pokemon Red."""

    def __init__(
        self,
        rom_path: str | Path,
        headless: bool = True,
        speed: int = 0,  # 0 = uncapped
    ):
        self.rom_path = Path(rom_path)
        if not self.rom_path.exists():
            raise FileNotFoundError(f"ROM not found: {self.rom_path}")

        window_type = "null" if headless else "SDL2"
        self.pyboy = PyBoy(
            str(self.rom_path),
            window=window_type,
        )
        self.pyboy.set_emulation_speed(speed)

    def step(self, frames: int = 1) -> None:
        """Advance emulator by N frames."""
        for _ in range(frames):
            self.pyboy.tick()

    def press(
        self,
        button: str,
        hold_frames: int = 8,
        release_frames: int = 4,
        frame_skip: int = 0,
    ) -> None:
        """Press a button and release it."""
        valid_buttons = {"a", "b", "start", "select", "up", "down", "left", "right"}
        button = button.lower()
        if button not in valid_buttons:
            raise ValueError(f"Invalid button: {button}. Valid: {valid_buttons}")

        self.pyboy.button(button)
        self.step(hold_frames)
        self.pyboy.button_release(button)
        self.step(release_frames)
        if frame_skip > 0:
            self.step(frame_skip)

    def read_memory(self, address: int) -> int:
        """Read a single byte from memory."""
        return self.pyboy.memory[address]

    def read_memory_range(self, start: int, length: int) -> bytes:
        """Read a range of bytes from memory."""
        return bytes(self.pyboy.memory[start : start + length])

    def save_state(self, path: str | Path) -> None:
        """Save emulator state to file."""
        path = Path(path)
        with open(path, "wb") as f:
            self.pyboy.save_state(f)

    def load_state(self, path: str | Path) -> None:
        """Load emulator state from file."""
        path = Path(path)
        with open(path, "rb") as f:
            self.pyboy.load_state(f)

    def screenshot(self) -> np.ndarray:
        """Get current screen as numpy array."""
        return np.array(self.pyboy.screen)

    def get_screen_png(self) -> Optional[bytes]:
        """Get current screen as PNG bytes for transmission."""
        try:
            from io import BytesIO
            pil_image = self.pyboy.screen.image
            buffer = BytesIO()
            pil_image.save(buffer, format="PNG")
            return buffer.getvalue()
        except Exception:
            # Pillow not installed or other error
            return None

    def boot_to_game(self, state_reader=None, max_presses: int = 3000) -> bool:
        """
        Boot past title screen and intro to playable game state.

        Uses similar logic to the browser app's startIntroSkip():
        - Alternates between A, Start, Down, Right to handle menus and text
        - Checks for party Pokemon to detect when intro is complete

        Args:
            state_reader: Optional StateReader to check for party (intro complete)
            max_presses: Maximum button presses before timeout

        Returns True if successfully booted to game, False if timed out.
        """
        print("Booting game (skipping intro)...")

        # Wait for title screen to appear
        self.step(60)

        for step in range(max_presses):
            # Check if intro is complete (player has a Pokemon)
            if state_reader and step % 20 == 0:
                try:
                    state = state_reader.read()
                    if len(state.party) > 0:
                        print(f"  Intro complete! Starter Pokemon received after {step} presses.")
                        self.step(30)  # Let game settle
                        return True
                except:
                    pass  # Ignore read errors during intro

            # Button sequence (matching browser app logic)
            if step % 10 == 0:
                # Occasionally press Start (for title screen)
                self.press("start", hold_frames=5, release_frames=5)
            elif step % 5 == 0:
                # Navigate down in menus
                self.press("down", hold_frames=4, release_frames=4)
            elif step % 7 == 0:
                # Navigate right in name entry
                self.press("right", hold_frames=4, release_frames=4)
            else:
                # Mostly mash A to advance text
                self.press("a", hold_frames=4, release_frames=4)

            # Progress indicator
            if step % 200 == 0 and step > 0:
                print(f"  ... {step} presses")

        print(f"  Boot sequence timed out after {max_presses} presses.")
        return False

    def close(self) -> None:
        """Clean up emulator."""
        self.pyboy.stop()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
