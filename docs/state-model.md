# GameState und Evidenzmodell

`GameState` ist die einzige Wahrnehmungsdarstellung, die Planner, Aktionsvalidierung,
Fortschritt und Replay gemeinsam verwenden. Es enthält:

- `scene`, Konfidenz, Unsicherheit, Stabilität und Übergangsstatus
- strukturierte `dialogue`, `menu`, `battle`, `overworld` und `title`-Teilzustände
- normalisierte OCR-Zeilen und ihre Regionen
- aktive/veränderte Regionen, schnellen Hash und pHash
- optionale Telemetrie und eine sortierte Evidenzliste

Unterstützte Szenen sind `TITLE`, `LOADING`, `DIALOGUE`, `CHOICE_DIALOGUE`,
`MAIN_MENU`, `PARTY_MENU`, `BAG_MENU`, `BATTLE`, `BATTLE_MOVE_MENU`,
`BATTLE_PARTY_MENU`, `OVERWORLD`, `CUTSCENE`, `NAMING_SCREEN`, `TOUCH_MENU` und
`UNKNOWN`.

## Evidenz

Jede Aussage kann ein `Evidence` mit Quelle, Wert, Konfidenz und Region tragen. Die
Priorität ist fest:

1. Telemetrie
2. deterministische UI-Erkennung
3. OCR
4. Vision-LLM
5. frühere Erinnerung

Ein Vision-Modell überschreibt damit kein klares Telemetrie- oder UI-Signal. OCR
und Vision bleiben trotzdem im Zustand erhalten, sodass Fehlklassifikationen im
Replay nachvollziehbar sind.

## Hysterese und Stabilität

Ein mittel-konfidenter Szenenwechsel muss standardmäßig in zwei aufeinanderfolgenden
Klassifikationen erscheinen. Nur ein Signal ab `high_confidence_scene_switch`
wechselt sofort. Frame-Stabilität ist davon getrennt: mehrere kleine Bilddeltas
markieren einen stabilen Frame, große oder anhaltende Änderungen einen Übergang.

## Beobachtungs-Fingerprint

Der Fingerprint kombiniert Szene, normalisierten OCR-Text, pHash, aktive Regionen,
letzte Aktionen, aktuelles Objective und optionale Telemetrie. `LoopDetector`
verwendet ihn gemeinsam mit Szenen-, Makro-, Effekt- und Plansignatur-Historien für
unveränderte Zustände, A-B-A-B-Zyklen, Menü-Toggles, Bewegung ohne Ortsänderung,
wiederholte Interaktionen und mehrfach fehlgeschlagene Pläne.

## Speichergrenzen

Schnell wechselnde Zustände bleiben im `WorkingMemory`. Ausführungen und Resultate
gehören in episodische Tabellen. Nur stabile Fakten wie Starter, Figuren, Orte,
bekannte Menüabläufe oder strategische Erkenntnisse werden als `durable_facts`
persistiert. Landmark-Daten sind getrennt und können später eine Navigationsebene
versorgen.
