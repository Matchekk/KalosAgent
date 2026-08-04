from __future__ import annotations

import os
from html.parser import HTMLParser
from typing import ClassVar

import cv2
import numpy as np

from .models import OCRLine


class _HTMLTextExtractor(HTMLParser):
    _BLOCK_TAGS: ClassVar[set[str]] = {
        "br",
        "div",
        "li",
        "p",
        "table",
        "td",
        "th",
        "tr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _plain_text(html: str) -> str:
    parser = _HTMLTextExtractor()
    parser.feed(html)
    parser.close()
    return " ".join("".join(parser.parts).split())


class SuryaOCREngine:
    MODEL_ID = "datalab-to/surya-ocr-2"

    def __init__(
        self,
        *,
        backend: str = "auto",
        inference_url: str | None = None,
        parallel: int = 1,
        min_score: float = 0.45,
        upscale: float = 2.0,
    ) -> None:
        if backend not in {"auto", "vllm", "llamacpp"}:
            raise ValueError("Surya backend must be auto, vllm, or llamacpp.")

        # Surya reads these settings while its modules are imported.
        os.environ["SURYA_MODEL_CHECKPOINT"] = self.MODEL_ID
        os.environ["SURYA_INFERENCE_PARALLEL"] = str(parallel)
        if backend != "auto":
            os.environ["SURYA_INFERENCE_BACKEND"] = backend
        if inference_url:
            os.environ["SURYA_INFERENCE_URL"] = inference_url

        try:
            from PIL import Image
            from surya.inference import SuryaInferenceManager
            from surya.recognition import RecognitionPredictor
        except ImportError as exc:
            raise RuntimeError(
                "Surya OCR is not installed. Run `pip install -e .`."
            ) from exc

        self._image_type = Image
        self.min_score = min_score
        self.upscale = upscale
        method = None if backend == "auto" else backend
        self._manager = SuryaInferenceManager(method=method)
        self._predictor = RecognitionPredictor(self._manager)
        self._predictor.disable_tqdm = True

    def _prepare(self, frame: np.ndarray) -> np.ndarray:
        if self.upscale == 1.0:
            return frame
        return cv2.resize(
            frame,
            None,
            fx=self.upscale,
            fy=self.upscale,
            interpolation=cv2.INTER_CUBIC,
        )

    def read(self, frame: np.ndarray) -> list[OCRLine]:
        prepared = self._prepare(frame)
        rgb = cv2.cvtColor(prepared, cv2.COLOR_BGR2RGB)
        image = self._image_type.fromarray(rgb)
        pages = self._predictor([image], full_page=True)
        if not pages:
            return []

        lines: list[OCRLine] = []
        blocks = sorted(pages[0].blocks, key=lambda block: block.reading_order)
        for block in blocks:
            if block.skipped or block.error:
                continue
            score = float(block.confidence if block.confidence is not None else 0.0)
            if score < self.min_score:
                continue
            text = _plain_text(block.html)
            if not text:
                continue
            box = [round(float(value) / self.upscale) for value in block.bbox[:4]]
            lines.append(OCRLine(text=text, score=score, box=box))
        return lines

    def close(self) -> None:
        self._manager.stop()
