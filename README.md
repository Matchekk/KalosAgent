# KalosAgent v0.3

KalosAgent ist eine vollständig lokale, ereignisgesteuerte Agenten-Laufzeit für
Pokémon X/Y in Azahar. v0.3 ergänzt die sichere v0.2-Laufzeit um zwei getrennte,
lernende Systeme: deterministische Battle Intelligence und ein visuelles
Landmark-/Transition-Gedächtnis.

```text
Capture → Screen/ROI Change Detection → semantische UI-Crops → OCR
        → GameState → BattleState oder NavigationNode
        → deterministische Mechanik + begrenzte Suche
        → validiertes, unterbrechbares Makro
        → Vorher/Nachher-Vergleich → SQLite + Replay
```

Das Vision-LLM interpretiert unbekannte visuelle Situationen und darf strategische
Kandidaten nur begrenzt umbewerten. Typen, Schaden, Legalität und UI-Geometrie
kommen ausschließlich aus lokalem, strukturiertem Code. Dry-Run bleibt Standard.

## Zielsystem

- Windows 10/11, Python 3.11, Azahar
- PP-OCRv6 Small/PaddleOCR auf der CPU
- Ollama mit lokalem Vision-Modell auf der NVIDIA-GPU
- RTX 4070 Super 12 GB: `gemma4:12b`, Q4, Kontext 8192 als Ausgangspunkt
- `vgamepad` und SQLite

OCR-Worker und Emulatorlogik laufen CPU-seitig. Ollama-Aufrufe sind global
serialisiert, sodass Vision und Planner den VRAM nicht gleichzeitig belegen.

## Installation

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -e ".[ocr,dev]"
copy config.example.yaml config.yaml
ollama pull gemma4:12b
```

Optional für einen lokalen Pokémon-Showdown-Server:

```powershell
pip install -e ".[showdown]"
```

## Generation-VI-Wissen einmalig aufbauen

Der Import filtert auf Generation VI, Version Group `x-y` und die Sprachen Deutsch
und Englisch. PokéAPI-Antworten werden lokal gecacht. Nach dem Import benötigt ein
Kampf keine Netzwerkverbindung.

```powershell
python -m kalos_agent knowledge-import
python -m kalos_agent knowledge-status
```

Die Datenbank enthält Pokémon/Formen, Typen, Basiswerte, Fähigkeiten, Attacken,
historische Gen-VI-Werte, X/Y-Learnsets, Maschinen, Typentabelle und Alias-Mappings
wie `Glurak → charizard` und `Flammenwurf → flamethrower`.

## Sicher starten

```powershell
python -m kalos_agent capture
python -m kalos_agent observe
python -m kalos_agent run
```

Ohne `--live` werden niemals Controller-Eingaben gesendet. Live-Betrieb erfordert
ein gefundenes, plausibles und fokussiertes Azahar-Fenster, einen initialisierten
Controller, keine STOP-Datei und die explizite Freigabe:

```powershell
python -m kalos_agent run --live
```

Vor jeder Eingabe werden Prozess, Fokus und STOP erneut geprüft. Beim Beenden oder
bei Exceptions wird der Controller garantiert neutralisiert.

## Replay, Battle Learning und Navigation

```powershell
python -m kalos_agent record
python -m kalos_agent replay data\replays\<episode-id>
python -m kalos_agent replay data\replays\<episode-id> --mode perception
python -m kalos_agent replay data\replays\<episode-id> --mode planner
python -m kalos_agent benchmark data\replays\<episode-id>
python -m kalos_agent inspect data\replays\<episode-id>

python -m kalos_agent battle-benchmark
python -m kalos_agent battle-export data\battle-datasets
python -m kalos_agent navigation-inspect
python -m kalos_agent showdown-self-play --battles 100
```

Replay und Benchmarks öffnen weder Azahar noch `vgamepad`. Battle-Züge speichern
den kanonischen Vorher-/Nachher-Zustand, Kandidaten, Suchbaum, Erwartung und Ergebnis.
Der Export erzeugt JSONL für Gegnerprädiktion, Value, Ranking, LoRA und RL. Es findet
kein Online-Training des großen Vision-Modells statt.

## Entwicklung

```powershell
python -m pytest
python -m ruff check .
python -m mypy kalos_agent
```

Alle Tests arbeiten mit Fake-Backends, synthetischen Bildern und einer kleinen
PokéAPI-Fixture. Sie laden keine OCR-Modelle und benötigen weder Emulator noch
Controller oder Netzwerk. Echte Screenshots können als Replay-Episoden oder unter
`tests/fixtures/` ergänzt werden; ROMs, Keys und Nintendo-Systemdateien gehören
nicht ins Repository.

## Dokumentation

- [Architektur v0.3](docs/architecture-v0.3.md)
- [Battle Knowledge](docs/battle-knowledge.md)
- [Navigation Memory](docs/navigation-memory.md)
- [Replay-Format](docs/replay-format.md)
- [State-Modell v0.2](docs/state-model.md)

Die Architekturprinzipien wurden passend für Python, Azahar und Pokémon X/Y neu
implementiert. Es wurde kein fremder Quellcode übernommen.

## Bewusste Grenzen

Es gibt noch kein vollständiges autonomes 3D-Pathfinding und keine X/Y-spezifischen
RAM-Adressen. Der Schadensrechner deckt die allgemeinen Gen-VI-Regeln und mehrere
häufige Fähigkeiten ab, aber nicht jede einmalige Attacken-, Item- oder
Fähigkeitsausnahme. Exakte Trainerteams werden über die vorbereitete
`TrainerKnowledgeProvider`-Schnittstelle ergänzt. Visuelle Embeddings sind derzeit
deterministische CPU-Histogramme; ein stärkeres lokales Embedding-Backend kann über
das bestehende Protocol eingesetzt werden.
