# Generation-VI Battle Knowledge

## Datenquelle und Filter

`knowledge-import` verwendet PokéAPI und speichert HTTP-Antworten zuerst als
content-addressed JSON im Cache. Importiert werden nur Pokémon bis Generation VI,
in X/Y verfügbare Formen, X/Y-Learnsets, deutsche/englische Namen und Gen-VI-Werte.
Historische Move-, Typ-, Stat- und Fähigkeitswerte werden berücksichtigt, falls die
heutigen API-Werte später geändert wurden.

Grundlage sind die offiziellen Ressourcenmodelle der
[PokéAPI](https://pokeapi.co/docs/v2). Die Implementierung des Schadensmodells wurde
gegen die Struktur des offenen
[Smogon Damage Calculator](https://github.com/smogon/damage-calc) abgegrenzt; es
wurde kein Quellcode übernommen.

## Offline-Garantie

`KnowledgeDatabase` führt im Battle-Pfad ausschließlich SQLite-Abfragen aus. Nur
der explizite CLI-Import erzeugt Netzwerkzugriffe. Cache und Datenbank können daher
auf den Spielrechner kopiert werden.

## Namensauflösung

Aliasse werden Unicode-normalisiert und ohne Interpunktion verglichen. Exakte
Treffer haben Vorrang. Fuzzy Matching wird nur übernommen, wenn der beste Treffer
den Schwellwert erreicht und mit ausreichendem Abstand eindeutig ist. Andernfalls
bleibt der Wert unbekannt und erhöht die Unsicherheit des `BattleState`.

## Belief State

Die Priorität lautet: exaktes Trainerwissen, beobachtete Züge, X/Y-Level-up,
TM/HM, Zucht/Tutor und zuletzt ein allgemeiner Prior. Beobachtete Attacken werden
auf Wahrscheinlichkeit 1 gesetzt; nachweislich unmögliche Kandidaten werden
entfernt. Zugreihenfolge und beobachteter Schaden aktualisieren Geschwindigkeit
und Fähigkeitswahrscheinlichkeiten.

## Schadensverteilung

Der Rechner modelliert Level, Stats, IV/EV/Wesen-Bereiche, physisch/speziell, STAB,
Typen und Immunitäten, Genauigkeit, Priorität, Krit-Chance, Status, Stufen, Wetter,
Terrain, Mehrfachtreffer, Spread, Rückstoß und Heilung. Unbekannte Parameter ergeben
gewichtete Ausgänge statt einer erfundenen Einzelzahl.

Nicht vollständig abgebildet sind alle Spezialattacken mit eigener Formel, jedes
Item und jede seltene Fähigkeitsinteraktion. Solche Fälle bleiben explizite
Unsicherheit und dürfen nicht vom LLM als Mechanik ergänzt werden.

## Showdown

Mit dem optionalen Extra `showdown` adaptiert `ShowdownBattleAdapter` ein
`poke-env`-Battle in denselben kanonischen Zustand. Ein lokaler Server kann auf der
offiziellen [Pokémon-Showdown-Simulation](https://github.com/smogon/pokemon-showdown)
basieren; die Python-Anbindung folgt der öffentlichen
[poke-env-Schnittstelle](https://github.com/hsahovic/poke-env).
