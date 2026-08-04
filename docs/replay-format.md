# Replay-Format v0.3

Eine Episode ist ein portables Verzeichnis:

```text
<episode-id>/
├── episode.json
└── cycles/
    └── <cycle-id>/
        ├── cycle.json
        ├── before.png
        ├── after.png
        └── regions/
            ├── before-dialogue.png
            ├── before-battle-opponent_name.png
            └── ...
```

`cycle.json` enthält den kompletten `CycleRecord`:

- OCR, GameState und Evidenz vor und nach der Aktion,
- Planner-Eingabe ohne redundantes Base64-Bild und validierte Ausgabe,
- tatsächlich ausgeführte, unterbrechbare Aktionen,
- Fortschritt, Schleifen, Fehler, Latenzen und Aufrufzähler,
- normalisierte, semantisch benannte UI-Regionen,
- erkannte Pokémon und Attacken,
- kanonischen BattleState und Opponent Belief State,
- Schadensverteilungen, Expectimax-Suchbaum und gewählte Battle-Aktion,
- beobachtetes Battle-Ergebnis und gespeicherte Learning-Transition,
- Navigation Node und aktualisierte Transition Edge,
- optionale Ground-Truth-Labels für die erweiterten Benchmarks.

Screenshots und ROIs werden als PNG gespeichert. Alle strukturierten Daten sind
JSON und können ohne Azahar, Controller, OCR-Modell oder Netzwerk gelesen werden.

## Modi

- `saved`: verwendet den gespeicherten validierten Plan.
- `perception`: segmentiert das Bild neu und testet State Classification.
- `planner`: ruft den aktuellen allgemeinen Planner erneut auf; keine Aktion wird
  ausgeführt.

Der Battle-Learning-Store ist zusätzlich eine normalisierte SQLite-Zeitreihe. Mit
`battle-export` entstehen fünf portable JSONL-Datensätze: Gegneraktion, Battle
Value, Action Ranking, LoRA-Nachrichten und RL-Transitionen.

## Metriken

Der Replay-Benchmark enthält die v0.2-Latenz-, Aufruf-, JSON-, Loop- und
Fortschrittsmetriken. Über `evaluation_labels` wertet er außerdem Namens- und
Attackenerkennung, BattleState, Typenentscheidung, KO-Vorhersage,
Gegneraktions-Prädiktion, Landmark-Wiedererkennung und Übergangserfolg aus.
`battle-benchmark` ergänzt Kampfsiegquote und Entscheidungsfehler;
`navigation-inspect` ergänzt Kollisionen, stabile Landmarken und Loop-Rate.

## Echte Testdaten

Die bevorzugte Erfassung ist `python -m kalos_agent record`. Legal erzeugte
Screenshots können als Fixture-Episode ergänzt werden. Persönliche Spielstände,
ROMs, Keys und Firmware dürfen nicht eingecheckt werden. Für Regressionstests
sollten erwartete OCR-Entitäten, BattleState und Ground-Truth-Labels im jeweiligen
`cycle.json` erhalten bleiben.
