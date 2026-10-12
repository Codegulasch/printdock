# Erste Schritte

*English below.*

In zehn Minuten vom ersten Start bis zum ersten Druck aus PrintDock. Installation: [installation.md](installation.md).

## 1. Einrichtungsassistent

Beim ersten Öffnen (`http://<ip>:3080`, als Add-on über die Seitenleiste) fragt PrintDock Sprache, Aussehen, Funktionen und Zugang ab. Wer erst schauen möchte: **Demo-Daten einspielen** legt fünf simulierte Drucker mit Aufträgen und Verlauf an – sie lassen sich mit einem Klick wieder entfernen (*Einstellungen → System*).

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
- **Von Hand:** *Dateien → Hochladen* (G-code oder geslicte 3MF).
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

PrintDock sichert sich täglich selbst (*Einstellungen → System*). Druckdateien, Fotos und Sicherungen können auf ein **NAS** (SMB-Freigabe direkt, ohne Einhängen) – *Einstellungen → System → Speicherort*.

Fragen oder Fehler: [GitHub-Issues](https://github.com/Codegulasch/printdock/issues). Hilfreich sind dabei die Version (*Einstellungen → System*) und der *Plattform-Check*.

---

# Getting started

From first start to the first print from PrintDock in ten minutes. Installation: [installation.md](installation.md).

1. **Setup wizard** – on first open (`http://<ip>:3080`, as add-on via the sidebar) PrintDock asks for language, look, features and access. *Load demo data* creates five simulated printers to try things out; remove them with one click under *Settings → System*.
2. **Add printers** – *Printers → + Printer*: Klipper/Moonraker (Snapmaker U1, Voron …: IP), Bambu Lab LAN (IP, serial, access code; LAN mode, developer mode on newer firmware), Anycubic LAN mode (IP; starting prints needs Rinkhals), OctoPrint (API key). Enter the **printer model** as the slicer names it. Several rooms or a print farm? *Settings → Printers & filament → Areas …*
3. **Get files in** – OrcaSlicer/PrusaSlicer: add a physical printer of type *OctoPrint* with address and API key from *Settings → Slicer*. Bambu Studio: *Export plate sliced file* into the inbox folder. Or upload under *Files*. Prints sent straight from the slicer to the printer still end up in the **Archive** – PrintDock fetches the file from the printer.
4. **Print** – *Queue → Schedule file* and **Start**, or create an **order** with files, quantities, due date and a **print mode**: series (automatic) starts by itself after "plate clear", series (manual) waits for the start button, single print schedules one part at a time. After every print the card shows **Clear plate** – nothing starts before **Plate is clear**.
5. **Filament** – add spools under *Filament → Spools* and put them into slots under *Slots*. PrintDock then deducts after every print, warns about low spools and reserves filament for the queue.
6. **Overview** – *Today* (what to do, what is running, what comes next), *Archive* (every print with start and end, search, filters, CSV), notifications (ntfy, Telegram, Discord, Gotify, webhook), Home Assistant (plugs, MQTT devices, dashboard cards, blueprints).
7. **Backup and storage** – daily automatic backup under *Settings → System*. Print files, photos and backups can live on a **NAS** (SMB share directly, no mounting) – *Settings → System → Storage location*.

Questions or bugs: [GitHub issues](https://github.com/Codegulasch/printdock/issues) – please include the version (*Settings → System*) and the *platform check*.
