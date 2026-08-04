# Navigation Memory

## Knoten

Ein Knoten speichert Ortsname, visuelles Embedding, Szene, perceptual Hash,
geschätzte Blickrichtung, Landmark-Namen und Konfidenz. Ein Knoten wird erst nach
mehrfacher Wiedererkennung stabil. Der voreingestellte Embedding-Backend ist ein
kleines normalisiertes HSV-Histogramm und funktioniert vollständig offline auf der
CPU.

## Landmarken

Ortsschilder, Gebäude, Türen, Treppen, Kreuzungen, Pokémon-Center, Arenen, NPCs,
besondere Objekte und Kartenwechsel können als Keyframe gespeichert werden. Eine
LLM-Beschreibung ist nur ein Kandidat. Stabil wird die Landmarke nach mehreren
visuell ähnlichen Beobachtungen oder nach einem bestätigten Übergang.

## Kanten und Lernen

Gerichtete Kanten speichern Quellknoten, Makro, Zielknoten, Erfolge, Fehler,
mittlere Dauer, Kollisionen, erforderliche Interaktion und letzte Beobachtung. Die
Zuverlässigkeit nutzt einen geglätteten Erfolgsanteil. A* gewichtet Dauer,
Zuverlässigkeit, Fehler und Kollisionen; zu unzuverlässige Kanten werden ignoriert.

Nach jeder Bewegung prüft `NavigationTransitionEvaluator` Bild- und Ortsänderung,
Kartenwechsel, neue Landmarke und wirkungslose Bewegung. Damit werden auch
Kollisionen und wiederholt leere Aktionen explizit gelernt.

## Hierarchische Nutzung

`StrategicNavigationGoal` beschreibt das Ziel. `HierarchicalNavigator` sucht den
bekannten Zielknoten und plant die Folge der Graphkanten. Der bestehende lokale
Action-Layer führt jedes Makro kurz, validiert und unterbrechbar aus. Ist kein Pfad
bekannt, wählt die vorsichtige Exploration die bisher am wenigsten getestete kurze
Richtung oder Interaktion.
