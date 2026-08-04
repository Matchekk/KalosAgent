from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .models import OCRLine


class PaddleOCRBackend:
    """CPU-oriented PP-OCRv6 detector/recognizer adapter."""

    def __init__(
        self,
        *,
        detection_model: str = "PP-OCRv6_small_det",
        recognition_model: str = "PP-OCRv6_small_rec",
        device: str = "cpu",
        min_score: float = 0.50,
        upscale: float = 2.0,
    ) -> None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:
            raise RuntimeError(
                "PaddleOCR is not installed. Install the `ocr` project extra."
            ) from exc
        self.min_score = min_score
        self.upscale = upscale
        self._ocr = PaddleOCR(
            text_detection_model_name=detection_model,
            text_recognition_model_name=recognition_model,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            device=device,
        )

    @staticmethod
    def _payload(result: Any) -> dict[str, Any]:
        raw = getattr(result, "json", None)
        raw = raw() if callable(raw) else raw
        if not isinstance(raw, dict):
            try:
                raw = dict(result)
            except (TypeError, ValueError):
                return {}
        payload = raw.get("res", raw)
        return payload if isinstance(payload, dict) else {}

    def recognize(self, image: np.ndarray, *, region: str) -> list[OCRLine]:
        prepared = image
        if self.upscale != 1.0:
            prepared = cv2.resize(
                image,
                None,
                fx=self.upscale,
                fy=self.upscale,
                interpolation=cv2.INTER_CUBIC,
            )
        lines: list[OCRLine] = []
        for result in self._ocr.predict(prepared):
            payload = self._payload(result)
            texts = list(payload.get("rec_texts", []) or [])
            scores = list(payload.get("rec_scores", []) or [])
            boxes = list(payload.get("rec_boxes", []) or [])
            for index, raw_text in enumerate(texts):
                text = " ".join(str(raw_text).split())
                score = float(scores[index]) if index < len(scores) else 0.0
                if not text or score < self.min_score:
                    continue
                box: list[int] | None = None
                if index < len(boxes):
                    coords = np.asarray(boxes[index], dtype=float).reshape(-1)
                    if coords.size >= 4:
                        box = [round(value / self.upscale) for value in coords[:4]]
                lines.append(OCRLine(text=text, score=score, box=box, region=region))
        lines.sort(key=lambda line: (line.box or [10_000, 10_000])[:2][::-1])
        return lines

    def close(self) -> None:
        return


class NullOCRBackend:
    def recognize(self, image: np.ndarray, *, region: str) -> list[OCRLine]:
        return []

    def close(self) -> None:
        return
