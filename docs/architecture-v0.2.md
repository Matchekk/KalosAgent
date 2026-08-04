# Architektur v0.2

## Schichten

`KalosRuntime` verbindet ausschließlich austauschbare Backends:

| Schnittstelle | Standardimplementierung | Verantwortung |
| --- | --- | --- |
| `CaptureBackend` | `AzaharCaptureBackend` | Fensterprüfung, Capture und 3DS-Splitting |
| `OCRBackend` | `PaddleOCRBackend` | Text aus genau einer Region |
| `VisionBackend` | `OllamaVisionBackend` | visuelle Zustandsindizien, keine Aktionen |
| `PlannerBackend` | Ollama oder OpenAI-kompatibel | Ziel-/Aktionsplan aus strukturierten Daten |
| `ActionBackend` | `VirtualGamepadActionBackend` | genau eine atomare Eingabe |
| `TelemetryProvider` | `NullTelemetryProvider` | optionale, höher priorisierte Zustandsdaten |

Der Planner besitzt keine Referenzen auf Capture, OCR oder Controller. `ActionExecutor`
ist die einzige Schicht, die einen validierten Plan in Eingaben übersetzt.

## Laufzeitfluss

1. Capture läuft mit ungefähr 10 Hz und erzeugt ein `ScreenFrame`.
2. `ScreenSegmenter` trennt Top-/Bottom-Screen und konfigurierte ROIs.
3. `FrameChangeDetector` berechnet schnellen Hash, pHash und Pixeländerung je Screen/ROI.
4. `EventDrivenOCR` schickt ausschließlich neue oder veränderte Text-ROIs an einen
   einzelnen CPU-Worker. Während Übergängen wird der letzte OCR-Stand genutzt.
5. `StateClassifier` vereinigt deterministische Signale, OCR, optionale Vision und
   Telemetrie mit Hysterese zu einem `GameState`.
6. Einfache Title-/Dialog-/Transition-Fälle werden deterministisch behandelt. Nur
   unklare oder strategische Zustände erreichen den Planner.
7. `PlanValidator`, `MacroFactory` und `ActionExecutor` begrenzen und unterbrechen
   jede Aktion. Nach jedem Input erfolgt eine neue Beobachtung.
8. `ProgressTracker` und `LoopDetector` vergleichen Vorher/Nachher und aktivieren
   eine siebenstufige, szenenabhängige Recovery-Leiter.
9. SQLite speichert semantische Erinnerungen; der Replay-Recorder speichert die
   vollständigen Evaluationsartefakte.

## Nebenläufigkeit und CPU/GPU-Aufteilung

```text
CPU                                      NVIDIA GPU
Capture + Split + Hashing                Azahar rendering
deterministische UI-Erkennung            serialized Ollama inference
ThreadPoolExecutor(1): PP-OCRv6 Small      ├─ Vision classification
SQLite + Replay encoding                   └─ Gemma 4 planning/thinking
Action validation and safety
```

OCR ist ein eigener CPU-Worker. Ollama-Vision und Planner teilen
`OLLAMA_INFERENCE_LOCK`; damit existiert höchstens eine lokale Modellinferenz zur
gleichen Zeit. Die Capture-Schleife selbst bleibt synchron, wodurch Zustand und
Eingabereihenfolge deterministisch und Replay-freundlich bleiben.

## RTX 4070 Super (12 GB)

Die Beispielkonfiguration nutzt `gemma4:12b` Q4_K_M, 8192 Kontexttokens,
`keep_alive: 30m`, niedrige Temperatur und maximal 1200 Ausgabetokens. Der Planner
nutzt Thinking, der Vision-Klassifikator nicht. Höhere Kontextgrößen sind möglich,
reduzieren aber die VRAM-Reserve für Azahar und den Vision-Encoder.

## Aktionssicherheit

Pläne werden zuerst als Pydantic-Objekte geparst und anschließend szenenabhängig
validiert. Ungültiges JSON erhält genau einen Reparaturversuch; danach folgt WAIT.
Makros haben erlaubte Ausgangsszenen, erwartete Folgeszenen, Timeout, Inputlimit,
Abbruchbedingungen und Grund. Fokusverlust, STOP, Emulatorende, Übergänge und neue
Dialog-/Menü-/Kampfszenen wirken zwischen atomaren Aktionen. `B` ist in
Kampfszenen für Cancel-/Close-Makros gesperrt.

## Erweiterungspunkte

Ein RAM-Leser implementiert künftig nur `TelemetryProvider.read()` und liefert ein
`TelemetrySnapshot`; State, Planner und Replay bleiben unverändert. Navigation kann
später als eigener Planner oder Makroanbieter ergänzt werden. `landmarks` und
Replay-Fingerprints sind dafür bereits vorhanden.
