# Erste Schritte

*[English](getting-started.md) · Deutsch*

In zehn Minuten vom ersten Start bis zum ersten Druck aus PrintDock. Installation: [installation.de.md](installation.de.md).

> **Öffentliche Beta:** PrintDock ist im täglichen Einsatz, aber noch in der öffentlichen Beta – manches kann sich noch ändern. Mach regelmäßig Sicherungen (*Einstellungen → System → Datensicherung*) und melde Probleme bitte über [GitHub-Issues](https://github.com/Codegulasch/printdock/issues/new/choose) – mit Version und dem *Plattform-Check* (*Einstellungen → System → Plattform-Check*).

## 1. Einrichtungsassistent

Beim ersten Öffnen (`http://<ip>:3080`, als Add-on über die Seitenleiste) fragt PrintDock Sprache, Aussehen, die **Ausbaustufe** (Hobby, Maker oder Werkstatt – später jederzeit änderbar) und den Zugang ab. Wer erst schauen möchte: **Demo-Daten einspielen** legt fünf simulierte Drucker mit Aufträgen und Verlauf an – sie lassen sich mit einem Klick wieder entfernen (*Einstellungen → System*).

## 2. Drucker anlegen

*Drucker → + Drucker*. Anbindung wählen:

| Drucker | Anbindung | Was du brauchst |
|---|---|---|
| Snapmaker U1, Voron, Klipper allgemein | Klipper / Moonraker | IP-Adresse |
| Bambu Lab (X1, P1, A1, H2D, X2D) | Bambu Lab (LAN) | IP, Seriennummer, Access Code (Netzwerkmenü); LAN-Modus, bei neuer Firmware Entwicklermodus |
| Anycubic Kobra S1 / Kobra 3 (Original-Firmware) | Anycubic (LAN-Modus) | LAN-Modus am Drucker, IP; Druckstart nur mit Rinkhals |
| Marlin mit OctoPrint | OctoPrint | API-Key |

Trage beim Drucker das **Druckermodell** so ein, wie es im Slicer heißt (z. B. „Bambu Lab X2D“) – dann landen Drucke ohne festen Drucker nur auf passenden Geräten. Mehrere Drucker in verschiedenen Räumen oder einer Printfarm? *Einstellungen → Drucker & Filament → Bereiche …*

## 3. Dateien hineinbringen

- **OrcaSlicer, PrusaSlicer & Co.:** im Druckerprofil einen physischen Drucker vom Typ *OctoPrint* anlegen, Adresse und API-Key aus *Einstellungen → Slicer*. „Hochladen und drucken“ landet direkt in der Warteschlange.
- **Bambu Studio:** *Geslicte Platte exportieren* in den Eingangsordner (Pfad unter *Einstellungen → Slicer*).
- **Von Hand:** *Dateien → Teile → Hochladen* (G-code oder geslicte 3MF). PrintDock fragt, zu welchem **Teil** die Datei gehört und für welche Drucker sie ist. Slicst du dasselbe Teil für einen zweiten Drucker, wird es eine weitere Variante – eingeplant wird das Teil, gedruckt auf dem freien Drucker mit passender Variante.
- Druckst du weiter direkt aus dem Slicer an den Drucker, landet der Druck trotzdem im **Archiv** – PrintDock holt die Datei vom Drucker.

## 4. Drucken

- **Einzelner Druck:** *Warteschlange → Datei einplanen*, Drucker oder „Passender Drucker“ wählen, **Start**.
- **Aufträge:** *Aufträge → Neuer Auftrag* – Dateien mit Stückzahl, Termin, Priorität. Die **Druckart** entscheidet, wie es weitergeht: *Seriendruck (automatisch)* startet nach „Platte frei“ von selbst, *Seriendruck (manuell)* wartet auf den Start-Knopf, *Einzeldruck* plant immer nur ein Teil.
- Nach jedem Druck zeigt die Druckerkarte **Platte räumen**. Erst nach **Platte ist frei** geht es weiter – nie landet ein Druck auf einem belegten Bett.

## 5. Filament

*Filament → Spulen* anlegen (Material, Farbe, Gewicht, Preis) und unter *Belegung* in die Plätze legen. Bambu-Spulen mit Chip ordnet PrintDock selbst zu. Danach bucht PrintDock nach jedem Druck ab, warnt bei knappen Spulen und reserviert Filament für die Warteschlange.

## 6. Alles im Blick

- **Heute** – was zu tun ist, was läuft, was als Nächstes kommt.
- **Archiv** – jeder Druck mit Start und Ende, Suche, Filter, CSV-Export.
- **Benachrichtigungen** – ntfy, Telegram, Discord, Gotify oder Webhook, auf Wunsch mit Kamerabild.
- **Home Assistant** – Steckdosen, MQTT-Geräte, Dashboard-Karten, Automationsvorlagen.

## 7. Sichern und Speicher

PrintDock sichert sich täglich selbst (*Einstellungen → System → Automatische Sicherung*); eine Sicherung von Hand gibt es unter *Einstellungen → System → Datensicherung*. Druckdateien, Fotos und Sicherungen können auf ein **NAS** (SMB-Freigabe direkt, ohne Einhängen) – *Einstellungen → System → Speicherort*.

## Weiter

- [Installation](installation.de.md)
- [Fernzugriff](remote-access.de.md) – PrintDock sicher von unterwegs erreichen
- [Übersicht aller Funktionen](../README.de.md)

Fragen oder Fehler: [GitHub-Issues](https://github.com/Codegulasch/printdock/issues/new/choose). Hilfreich sind dabei die Version (*Einstellungen → System*) und der *Plattform-Check*.
