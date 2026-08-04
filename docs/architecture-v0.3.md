# Architektur KalosAgent v0.3

## Trennung der Systeme

Die v0.2-Backend-Grenzen (`CaptureBackend`, `OCRBackend`, `VisionBackend`,
`PlannerBackend`, `ActionBackend`, `TelemetryProvider`) bleiben erhalten. Der
allgemeine Planner greift weiterhin weder auf Capture noch OCR oder Controller zu.

```text
                           ┌─ BattleStateParser ─ Knowledge DB
Capture ─ Change/State ────┤                     ├─ Belief ─ Damage ─ Expectimax
                           └─ NavigationNode ──── Navigation Graph ─ A*
                                                        │
validated ActionPlan ─ ActionExecutor ─ post-state ─────┘
                                  │
                            Replay + Learning DB
```

Battle Intelligence und Navigation besitzen getrennte SQLite-Datenbanken. Beide
verwenden den vereinheitlichten `GameState`, haben aber keine gegenseitige
Abhängigkeit.

## Battle-Pipeline

1. `UILayoutRegistry` wählt anhand der Szene ein normalisiertes Layout.
2. `SemanticBattleOCR` liest nur die fest benannten Textregionen.
3. `BattleStateParser` normalisiert Namen über die lokale Wissensdatenbank.
4. `OpponentBeliefModel` gewichtet Trainerwissen, Beobachtungen und X/Y-Learnsets.
5. `Gen6DamageCalculator` erzeugt bei unbekannten Werten Verteilungen.
6. `BattlePlanner` filtert illegale Aktionen, bildet einen begrenzten Expectimax-
   Baum und wählt robust.
7. `BattleActionTranslator` übersetzt die kanonische Wahl über bekannte UI-Geometrie
   in ein begrenztes v0.2-Makro.
8. Der Vorher-/Nachher-Vergleich wird als Battle-Learning-Transition gespeichert.

Strategische LLM-Einschätzungen erhalten nur vorberechnete Kandidaten und dürfen
deren Score in einem engen Intervall verändern. Sie können keine Immunität,
Attackenlegalität oder mechanische Zahl überschreiben.

## Navigation

Die drei Ebenen sind getrennt:

- strategisches Ziel: Ortsname und Grund,
- Graph Planner: A* über zuverlässige Landmark-Transitionen,
- lokaler Controller: vorhandene, unterbrechbare Aktionsmakros.

Nach Overworld-Aktionen werden Bildsignatur, Landmark-Zustand, Kartenwechsel und
Kollision verglichen. Erfolg und Fehler aktualisieren dieselbe gerichtete Kante.
Unbekannte Bereiche werden über wenig getestete kurze Richtungsaktionen erkundet.

## Threads und Hardware

- Capture/State/Actions: Laufzeit-Thread, ungefähr 10 Hz Capture.
- PaddleOCR: CPU-Worker aus v0.2, nur bei relevanten Änderungen.
- Battle-OCR: semantische Battle-ROIs nur in neuen Entscheidungszuständen.
- Ollama: GPU; globale Serialisierung verhindert parallele VRAM-Inferenz.
- SQLite: WAL und komponentenlokale Sperren.

Für eine RTX 4070 Super mit 12 GB bleibt Azahar im GPU-Budget. Ein quantisiertes
12B-Vision-Modell, Kontext 8192 und niedrige Temperatur sind die dokumentierte
Startkonfiguration; die deterministischen Battle-Teile laufen auf der CPU.

## Erweiterungspunkte

- `TrainerKnowledgeProvider`: exakte X/Y-Trainerteams und Movesets.
- `VisualEmbeddingBackend`: stärkeres lokales Bild-Embedding.
- `TelemetryProvider`: späterer, explizit implementierter Azahar-State-/RAM-Reader.
- `ShowdownBattleAdapter`: derselbe `BattleState` für `poke-env` und Emulator.
