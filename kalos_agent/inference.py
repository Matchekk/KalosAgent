from __future__ import annotations

import threading

# Ollama uses one local GPU model runner. Sharing this lock prevents planner and
# vision requests from competing for the same 12 GB VRAM allocation.
OLLAMA_INFERENCE_LOCK = threading.Lock()
