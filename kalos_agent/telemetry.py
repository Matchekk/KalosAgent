from __future__ import annotations

from .models import TelemetrySnapshot


class NullTelemetryProvider:
    """Telemetry seam for future Azahar state or RAM readers."""

    def read(self) -> TelemetrySnapshot:
        return TelemetrySnapshot(available=False, values={})

    def close(self) -> None:
        return
