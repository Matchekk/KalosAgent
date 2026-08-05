"""Abstract base class for LLM backends."""

from abc import ABC, abstractmethod


class LLMBackend(ABC):
    """Abstract interface for LLM backends."""

    @abstractmethod
    def generate(self, prompt: str, max_tokens: int = 512) -> str:
        """Generate a response from the LLM.

        Args:
            prompt: The input prompt
            max_tokens: Maximum tokens to generate

        Returns:
            The generated text response
        """
        pass

    @abstractmethod
    def get_model_info(self) -> dict:
        """Get information about the loaded model.

        Returns:
            Dict with model name, context size, etc.
        """
        pass
