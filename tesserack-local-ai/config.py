from pathlib import Path

# Paths
MODEL_PATH = "/Users/sidmohan/Library/Application Support/ai.threadfork.app/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"
ROM_PATH = "Pokemon - Red Version (USA, Europe) (SGB Enhanced).gb"

# LLM settings
CONTEXT_SIZE = 4096
MAX_TOKENS = 256
N_GPU_LAYERS = -1  # -1 = use all layers on GPU (Metal)

# Agent settings
MAX_HISTORY_TURNS = 5

# Web server
WEB_HOST = "0.0.0.0"
WEB_PORT = 8000

# Autosave
AUTOSAVE_PATH = "saves/autosave.state"
AUTOSAVE_INTERVAL = 30  # Save every N steps
