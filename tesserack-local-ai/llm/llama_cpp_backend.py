"""llama-cpp-python backend implementation."""

from llama_cpp import Llama

from llm.base import LLMBackend


class LlamaCppBackend(LLMBackend):
    """LLM backend using llama-cpp-python."""

    def __init__(
        self,
        model_path: str,
        n_ctx: int = 4096,
        n_gpu_layers: int = -1,
        verbose: bool = False,
    ):
        """Initialize the llama.cpp backend.

        Args:
            model_path: Path to the .gguf model file
            n_ctx: Context window size
            n_gpu_layers: Number of layers to offload to GPU (-1 = all)
            verbose: Whether to print llama.cpp logs
        """
        self.model_path = model_path
        self.n_ctx = n_ctx

        self.llm = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_gpu_layers=n_gpu_layers,
            verbose=verbose,
        )

    def generate(self, prompt: str, max_tokens: int = 512) -> str:
        """Generate a response from the model."""
        output = self.llm(
            prompt,
            max_tokens=max_tokens,
            stop=["ACTION:", "\n\nREASONING:"],
            echo=False,
        )
        return output["choices"][0]["text"]

    def get_model_info(self) -> dict:
        """Get model information."""
        return {
            "backend": "llama-cpp-python",
            "model_path": self.model_path,
            "context_size": self.n_ctx,
        }
