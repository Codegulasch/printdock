# PrintDock

*[English](README.md) · Deutsch*

Eine Oberfläche für alle 3D-Drucker im Haus – egal von welchem Hersteller.
Inspiriert von [BamBuddy](https://github.com/maziggy/bambuddy), aber nicht auf Bambu Lab beschränkt.

![Druckerübersicht](docs/screenshots/board-dark.png)

- **Statusampel** auf jeder Druckerkarte: frei = grün leuchtend, druckt = blaues Lauflicht, wartet = gelb blinkend, Störung = rot blinkend
- **Deutsch und Englisch** – Oberfläche, Benachrichtigungen und Home-Assistant-Entitäten
- **Einrichtungsassistent** beim ersten Start; **jede Funktion abschaltbar** (Filament, Warteschlange, Aufträge, Wartung, Statistik, Kamera …)
- **Statistik**: Drucke, Erfolgsquote, Druckstunden, Material und Kosten, Drucker im Vergleich
- **Akzentfarbe** wählbar (Kobalt, Violett, Petrol, Orange, Magenta, Graphit), hell und dunkel
- **Rückfrage „Druckplatte geräumt?“** vor jedem Start aus Warteschlange oder Auftrag
- **Läuft überall**: Docker auf NAS und Raspberry Pi (amd64, arm64, armv7), Installationsskript für den Pi, Home-Assistant-Add-on
- **Fernzugriff** über Tailscale oder Cloudflare Tunnel, mit optionalem Login-Schutz

- Live-Status aller Drucker: Fortschritt, Restzeit, voraussichtliches Ende, Schicht, Temperaturen
- Pausieren, Fortsetzen, Abbrechen
- **Aufträge** mit Positionen (Datei × Stückzahl), Termin, Priorität und Fortschritt
- **Druckwarteschlange** mit „Platte frei“-Bestätigung und optionalem Auto-Start je Drucker
- **Dateibibliothek**: G-code und 3MF mit automatisch erkannter Druckzeit, Filament, Druckermodell und Vorschaubild
- **Slicer-Anbindung**: aus OrcaSlicer, PrusaSlicer & Co. direkt an PrintDock senden; Dateien per Klick im Slicer öffnen
- **Wartungsplaner** nach Betriebsstunden, Drucken oder Tagen, mit Erinnerung
- **Filamentverwaltung**: Spulenlager, Belegung von AMS/ACE/Werkzeugköpfen, automatische Abbuchung nach jedem Druck, Kosten, Warnung bei knappen Spulen
- **Home Assistant**: Drucker über Steckdosen ein-/ausschalten (mit Auto-Aus nach dem Abkühlen), alle Drucker als Geräte in Home Assistant (MQTT), Betrieb als Add-on mit eigenem Seitenleisten-Eintrag
- **Demo-Daten** mit einem Klick: 5 simulierte Drucker, Dateien, Spulen, Aufträge und 30 Tage Verlauf
- Kamera-Livebild für alle Drucker, auch Bambu Lab – mit Großansicht und Bild speichern
- Benachrichtigungen bei Fertigstellung, Fehler, Pause, Abbruch oder Verbindungsverlust – mit Kamerabild,
  per ntfy, Telegram, Discord, Gotify oder Webhook (z. B. Home Assistant)
- Verlauf aller abgeschlossenen Drucke mit Dauer und Ergebnis
- Läuft komplett lokal im Heimnetz, keine Cloud, kein Konto – Zugriff von unterwegs optional (siehe [Fernzugriff](docs/remote-access.md))
- Wenige Abhängigkeiten (`mqtt`, `busboy`, `basic-ftp`), keine Datenbank – Daten liegen als JSON im Ordner `data/`
- Bedienung im Stil des Leitstands: Seitenleiste, Kennzahlen-Leiste, große Knöpfe, hell und dunkel
- Optional: `ffmpeg` für RTSP-Kameras (im Docker-Image enthalten)

## Installation

Ausführlich in [docs/installation.md](docs/installation.md). Kurz:

```bash
# Docker (NAS, Raspberry Pi, Server)
curl -O https://raw.githubusercontent.com/Codegulasch/printdock/main/docker-compose.yml
docker compose up -d

# Raspberry Pi / Debian ohne Docker (Systemdienst)
curl -fsSL https://raw.githubusercontent.com/Codegulasch/printdock/main/scripts/install.sh | sudo bash

# Node.js 18+ (Windows, macOS, Linux)
npm install && npm start
```

**Home Assistant:** *Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories* → `https://github.com/Codegulasch/printdock` → „PrintDock“ installieren.

Dann `http://<ip>:3080` öffnen – der Einrichtungsassistent fragt Sprache, Aussehen, Funktionen und Zugang ab und spielt auf Wunsch Demo-Daten ein. Alles lässt sich später unter **Einstellungen → Allgemein** ändern.

## Statusampel

| Anzeige | Bedeutung |
|---|---|
| 🟢 grün, leuchtend | **Frei** – bereit für den nächsten Druck |
| 🔵 blau, Lauflicht | **Druckt** (auch: bereitet vor, Datei wird übertragen) |
| 🟡 gelb, blinkend | **Wartet** – pausiert, oder Platte muss geräumt werden |
| 🔴 rot, blinkend | **Störung** |
| ⚪ grau | Nicht erreichbar |

Die Farben sind fest und unabhängig von der gewählten Akzentfarbe. Neben jeder Leuchte steht der Zustand als Text.

## Funktionen an- und abschalten

Unter **Einstellungen → Allgemein → Funktionen** (oder im Assistenten): Warteschlange, Aufträge, Dateien, Filamentverwaltung, Wartungsplaner, Verlauf, Statistik, Kamera, Benachrichtigungen, Home Assistant, Slicer-Anbindung, Demo-Daten. Abgeschaltete Bereiche verschwinden aus Menü und Druckerkarten, ihre Daten bleiben erhalten. Abhängigkeiten werden automatisch beachtet (Aufträge brauchen Warteschlange und Dateien).

## Statistik

**Auswertung → Statistik** für 7, 30, 90 Tage, 12 Monate oder gesamt: Anzahl Drucke, Erfolgsquote, Druckstunden, Filament und Materialkosten, Drucke und Stunden je Tag/Woche, Drucker im Vergleich (Stunden, Auslastung, Erfolgsquote), Verbrauch je Material, häufigste Dateien und Fehler.

## Sicherheit und Fernzugriff

Im Heimnetz läuft PrintDock ohne Anmeldung. Für den Zugriff von außen unter **Einstellungen → Allgemein** den **Login-Schutz** einschalten und einen der Wege aus [docs/remote-access.md](docs/remote-access.md) nutzen:

- **Tailscale** – privates VPN, nichts öffentlich: `docker compose --profile tailscale up -d`
- **Cloudflare Tunnel** – eigene Adresse mit HTTPS: `docker compose --profile cloudflare up -d`
- **Home Assistant** – das Add-on ist überall erreichbar, wo Home Assistant es ist

Passwörter werden mit scrypt gespeichert, Sitzungen per HttpOnly-Cookie, nach 5 Fehlversuchen eine Minute Sperre. Access Codes, API-Keys und Bot-Tokens liegen im Klartext in `data/`; die Oberfläche zeigt sie nie an.

**Farben beim Druckstart zuordnen:** Beim Start aus der Warteschlange schlägt PrintDock nach Material und Farbe vor, welches Fach bzw. Werkzeug welches Filament aus dem Slice druckt – jede Zeile lässt sich ändern. Bambu bekommt die Zuordnung als AMS-Mapping, bei Klipper- und OctoPrint-Druckern nummeriert PrintDock die Werkzeuge im G-code um (z. B. T0 → T2).

## Unterstützte Drucker

| Anbindung | Drucker | Was der Drucker braucht |
|---|---|---|
| **Klipper / Moonraker** | Snapmaker U1, Anycubic Kobra 3 / S1 / S1 Max (mit Rinkhals), Voron, Creality K1/K2 (gerootet), alle anderen Klipper-Drucker | Moonraker erreichbar (Standard-Port 7125) |
| **Anycubic (LAN-Modus)** | Kobra S1 / S1 Max, Kobra 3 / 3 Max, Kobra 2 Pro mit Original-Firmware, samt ACE Pro | LAN-Modus am Drucker eingeschaltet; IP-Adresse |
| **Bambu Lab (LAN)** | X1, P1, A1, H2D, X2D | LAN-Modus, bei neuer Firmware zusätzlich Entwicklermodus; IP, Seriennummer, Access Code |
| **OctoPrint** | Alle Marlin-Drucker mit OctoPrint | API-Key |
| **Demo** | – | Simulierter Drucker zum Ausprobieren |

### Hinweise zu einzelnen Herstellern

**Snapmaker U1** – Moonraker ist ab Werk aktiv. IP am Touchscreen nachsehen und als Anbindung *Klipper / Moonraker* wählen.

**Anycubic Kobra S1 / Kobra 3** – Mit der Original-Firmware am Drucker den *LAN-Modus* einschalten und als *Anycubic (LAN-Modus)* einbinden: Status, Pause/Weiter/Abbrechen, Licht, Kamera, ACE-Fächer (Material und Farbe) und ACE-Trocknen. Drucke starten geht damit noch nicht.
Alternativ die Community-Firmware [Rinkhals](https://github.com/rinkhals-community/Rinkhals) – sie ergänzt Moonraker, dann als *Klipper / Moonraker* einbinden. Das LAN-Protokoll folgt [anycubic-lan](https://github.com/Nino6689/anycubic-lan).

**Bambu Lab** – Am Drucker LAN-Modus aktivieren; der Access Code steht im Netzwerkmenü. Seit den Firmware-Änderungen 2025 lassen neuere Modelle Steuerbefehle von Drittsoftware nur im Entwicklermodus zu.
Die Temperaturen der zweiten Düse (H2D, X2D) werden aus einem gepackten Wert gelesen – das ist noch **experimentell**. Rückmeldungen mit echten Geräten sind willkommen.

## Oberfläche

Seitenleiste mit allen Bereichen, Zähler für offene Punkte. Jede Druckerkarte zeigt:

- **Kopf**: Bauform-Bild, Name, Modell und Düsendurchmesser, Steckdosen-Knopf (Home Assistant), Einstellungen
- **Plaketten**: Verbindung, WLAN-Signal, Gerätemeldungen (Bambu HMS), Wartungsstand, eingeplante Drucke
- **Status**: Vorschaubild, Datei, Auftrag, Fortschritt, Restzeit, Endzeit, Schicht – bzw. „Platte räumen“ oder „Bereit“; darunter der nächste Druck aus der Warteschlange
- **Temperaturen** mit Verlauf der letzten Minuten, aktive Düse hervorgehoben; **Lüfter** in Prozent
- **Steuerung**: Licht, Kamera, Geschwindigkeit (Leise/Standard/Sport/Turbo), Pause/Weiter/Stopp
- **Filament**: AMS/ACE-Einheiten mit Feuchte und Temperatur, jedes Fach mit Farbe, Material und Restmenge

Oben fasst eine Zeile zusammen, wie viele Drucker frei sind, drucken, warten oder eine Störung haben, und welcher als Nächstes frei wird. Suche und Filter helfen bei vielen Druckern. Sprache (DE/EN) und Hell/Dunkel lassen sich unten links umschalten.

## Demo-Daten

**Einstellungen → Demo-Daten → Demo-Daten einspielen** legt einen kompletten, laufenden Druckerpark an: Bambu X2D mit AMS (druckt), Snapmaker U1 mit 4 Werkzeugen (druckt), Anycubic Kobra S1 mit ACE (fertig), Voron 2.4 (bereit) und Bambu A1 (pausiert), dazu 9 Dateien mit Vorschaubildern, 20 Spulen, 4 Aufträge, Warteschlange, 30 Tage Verlauf und Wartungsaufgaben. Alles ist als Demo markiert und lässt sich mit einem Klick wieder entfernen – eigene Daten bleiben unberührt.

## Filament: Spoolman, Feuchte, Etiketten, RFID

- **PrintDock Station (neu in 0.9):** ein ESP32 mit NFC-Leser (PN532), Waage (HX711) und kleinem Display, mit eigener Firmware: [printdock-station](https://github.com/Codegulasch/printdock-station). Spule auflegen → PrintDock erkennt sie (Tag-Kennung, Spulen-Link, OpenSpool- oder Anycubic-Daten), bucht die Restmenge nach Gewicht (das Leergewicht lernt es an einer neuen, vollen Spule) und merkt sie sich 3 Minuten: Das nächste Fach, das eine frisch eingelegte Spule meldet, bekommt sie – bei Bambu gehen Material und Farbe gleich ans AMS. Leere Tags lassen sich aus der Spulenansicht in vier Formaten beschreiben (PrintDock + OpenSpool, OpenSpool, Nur Link, Anycubic ACE) – an der Station oder mit dem Handy. Koppeln per sechsstelligem Code unter *Einstellungen → PrintDock Station*; ohne Hardware simuliert `node scripts/station-sim.js` eine Station.

- **Spoolman (optional):** *Einstellungen → Drucker & Filament → Filament* übernimmt den Spulenbestand aus Spoolman und meldet Verbrauch, gewogene Restmengen und den aktuellen Drucker/Platz zurück. In PrintDock angelegte Spulen landen auf Wunsch auch in Spoolman. Ist Spoolman kurz weg, holt PrintDock die Buchungen nach.
- **Filamentfeuchte:** AMS- und ACE-Einheiten, die selbst messen, überwacht PrintDock automatisch. Einheiten ohne Messung, Drucker und Trockenboxen/Lagerorte bekommen unter *Einstellungen → Drucker & Filament → Feuchte & Trocknen* einen Sensor: einen beliebigen Feuchtesensor aus Home Assistant (z. B. Zigbee- oder Bluetooth-Thermometer in der Box) oder eine PrintDock Station mit Feuchtesensor (SHT31/SHT40/AHT20/HTU21D – auch als reiner Feuchtemesser). Warn- und Alarmwert erscheinen an den Druckerkarten (Plakette und Einheit), in der Kopfzeile, auf der Home-Assistant-Karte und unter *Filament → Feuchte & Trocknen*; die Meldung „Filament zu feucht“ nennt die betroffenen Spulen (bei einer Trockenbox alle Spulen mit diesem Lagerort). Dazu Verlauf über 48 Stunden und Trocknungsdatum je Spule.
- **Trocknen per Knopf** (*Filament → Feuchte & Trocknen*): Bambu AMS 2 Pro (45–65 °C) und AMS HT (45–85 °C) direkt per MQTT (LAN-Modus mit Entwicklermodus), Anycubic ACE Pro direkt im LAN-Modus; Klipper/Moonraker-Drucker über ein G-Code-Makro (Vorlage für den ACE Pro mit Klipper-ACE-Treiber); alles andere über Home Assistant – Trockenbox an einer Steckdose (an, nach Ablauf aus) oder ein Trockner mit eigener Integration (Start-/Stopp-Taste und Zahl-Entitäten für Temperatur und Dauer, z. B. die Anycubic-Integration für das ACE). Vorschlag für Temperatur und Dauer aus den Spulen der Einheit (die empfindlichste bestimmt die Temperatur, begrenzt aufs Gerät); Meldung „Trocknen fertig“ und Trocknungsdatum an den Spulen.
- **Spulen-Etiketten:** mit QR-Code in 62 × 29 mm (Brother QL), 50 × 30, 40 × 30, 57 × 25 mm oder als A4-Bogen. Scannen öffnet die Spule mit Schnellaktionen.
- **RFID/NFC:** Spulen-Link vom Handy auf einen NFC-Sticker schreiben (Chrome auf Android) – als Leser dient die PrintDock Station. Vorhandene ESPHome-Leser funktionieren weiter über die Schnittstelle `POST /api/rfid` mit `{"tag": "…", "printer": "…", "slot": "…"}`.

## Updates

*Einstellungen → System → Updates* sieht auf GitHub nach einer neuen Version (auch automatisch alle 6 Stunden, auf Wunsch mit Benachrichtigung) und installiert sie per Klick: als Add-on baut Home Assistant PrintDock neu, auf PC und Raspberry Pi ersetzt PrintDock seine Dateien und startet neu. Für ein privates Repository unter „Update-Quelle“ einen GitHub-Token mit Leserecht eintragen. Docker: `docker compose pull && docker compose up -d`.

## Datensicherung und Umzug

*Einstellungen → System → Datensicherung* lädt eine `.zip` mit allem herunter: Einstellungen, Drucker, Warteschlange, Aufträge, Spulen, Wartung, Verlauf und Druckdateien. Einspielen lässt sie sich dort oder direkt im Einrichtungsassistenten einer neuen Installation (z. B. eines neuen Home Assistant). Als Add-on, Docker-Container oder systemd-Dienst startet PrintDock danach von selbst neu, sonst von Hand neu starten. Der vorherige Stand bleibt im Datenordner unter `before-restore-…` erhalten. Als Add-on steckt PrintDock außerdem in jeder Home-Assistant-Sicherung.

## Home Assistant

**Drucker ein- und ausschalten.** Unter *Einstellungen → Home Assistant* Adresse und Langzeit-Token eintragen (beim Add-on automatisch). Je Drucker eine schaltbare Entität (`switch.…`, `light.…`, `input_boolean.…`) wählen. Die Druckerkarte bekommt einen Ein/Aus-Knopf; ausgeschaltete Drucker lassen sich direkt aus der Karte einschalten. **Auto-Aus** schaltet nach Druckende ab, aber erst wenn die Düse unter der eingestellten Temperatur ist und kein neuer Druck läuft. Während eines Drucks verweigert PrintDock das Ausschalten.

**PrintDock in Home Assistant.** Mit eingeschalteten *MQTT-Geräten* meldet PrintDock jeden Drucker per MQTT-Discovery an:

| Typ | Entitäten |
|---|---|
| Sensoren | Status, Fortschritt, Restzeit, Fertig um, Datei, Schicht, Temperaturen (je Düse, Bett, Kammer) |
| Binärsensoren | Verbunden, Druckt, Platte räumen |
| Knöpfe | Pause, Fortsetzen, Abbrechen, Platte ist frei |
| Schalter / Auswahl | Licht, Geschwindigkeit |
| Bild | Kamera |
| Gerät „PrintDock“ | Warteschlange, aktive Drucker, überfällige Aufträge, knappe Spulen, fällige Wartungen |

Damit lassen sich Automationen bauen, z. B. „Licht in der Werkstatt an, wenn ein Druck fertig ist“ oder „Benachrichtigung, wenn die Platte geräumt werden muss“.

**PrintDock-Karten fürs Dashboard.** Zwei eigene Karten zeigen PrintDock direkt im Home-Assistant-Dashboard (Voraussetzung: *MQTT-Geräte* sind eingeschaltet):

- `custom:printdock-card` – ein Drucker mit Statusampel, Auftrag, Fortschritt, Kamera, Temperaturen, Lüftern, Filamentbelegung und Steuerung (Licht, Geschwindigkeit, Pause/Weiter/Stopp, „Platte ist frei“, Ein/Aus).
- `custom:printdock-overview-card` – alle Drucker auf einen Blick plus Warteschlange, Aufträge, knappe Spulen und fällige Wartungen. Bereiche und Listenlänge sind wählbar.

Beide Karten haben einen grafischen Editor (*Karte hinzufügen → PrintDock Card / PrintDock Overview*). Installation: beim Add-on automatisch; sonst *Einstellungen → Home Assistant → In Home Assistant eintragen*, über HACS (dieses Repository als *Dashboard* hinzufügen) oder von Hand als Ressource `http://<printdock>:3080/printdock-card.js` (JavaScript-Modul).

![PrintDock-Karten in Home Assistant](docs/screenshots/ha-cards.png)

```yaml
type: custom:printdock-card
entity: sensor.werkstatt_x2d_status
height: 560            # optional: gleiche Höhe für alle Karten, Inhalt scrollt
show_camera: true      # Kamera-Knopf (camera_open: true = anfangs sichtbar); außerdem show_temps, show_fans, show_filament, show_controls, compact

type: custom:printdock-overview-card
sections: [printers, queue, orders, spools, maintenance]
max_items: 6
```

**Als Add-on.** PrintDock läuft auch direkt in Home Assistant – mit Eintrag in der Seitenleiste (Ingress), automatischer Verbindung zu Home Assistant und zum Mosquitto-Broker sowie Datensicherung über die Home-Assistant-Backups:

1. In Home Assistant: *Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories* → `https://github.com/Codegulasch/printdock`.
2. Das Add-on-Image (amd64, aarch64, armv7) baut die GitHub-Action und legt es unter `ghcr.io/codegulasch/printdock-addon-*` ab.
3. „PrintDock“ installieren, starten, „In Seitenleiste anzeigen“.

Port 3080 bleibt zusätzlich direkt erreichbar – für Slicer-Uploads, Kamerabilder in Home Assistant und das Handy im Heimnetz.

**Als Dashboard-Seite.** Läuft PrintDock auf einem NAS oder PC, lässt es sich in Home Assistant als *Webseite*-Dashboard einbinden (Adresse unter *Einstellungen → Home Assistant*).

## So läuft ein Druck durch PrintDock

```
Slicer ──„An Drucker senden“──┐
Hochladen (Planung → Dateien) ─┴─> Dateibibliothek
                                       │
Auftrag anlegen (Datei × Stückzahl) ───┤ „Einplanen“
                                       ▼
                              Warteschlange ──Start / Auto-Start──> Drucker druckt
                                       ▲                                   │
                         „Platte ist frei“ bestätigen  <── Druck fertig ───┘
                                                         (Verlauf, Auftrag zählt mit, Wartung zählt Stunden)
```

- **Platte frei:** Nach jedem Druck zeigt die Druckerkachel „Platte räumen“ (gelb blinkend). Erst nach dem Tippen auf **Platte ist frei** startet der nächste Druck. Wer einen Druck von Hand aus Warteschlange oder Auftrag startet, muss im Start-Dialog zusätzlich **„Druckplatte ist geräumt“** ankreuzen (abschaltbar unter Einstellungen → Allgemein) – so landet nie ein Druck auf einem belegten Bett.
- **Auto-Start** (pro Drucker einstellbar): Ist er an, startet der nächste passende Eintrag sofort nach der Bestätigung. Ist er aus, steht der nächste Druck mit einem **Start**-Knopf auf der Kachel.
- **Zuweisung:** Ein Eintrag gehört entweder fest zu einem Drucker oder zu „passender Drucker“. Letzteres geht nur an Drucker, deren eingetragenes **Druckermodell** zu dem Modell passt, für das die Datei gesliced wurde.
- **Reihenfolge:** Priorität des Auftrags (eilig vor normal), dann Termin, dann manuelle Reihenfolge (▲▼).
- **Dateiformat:** Klipper und OctoPrint brauchen `.gcode`, Bambu eine geslicte `.gcode.3mf`. PrintDock prüft das vor dem Start.
- **Bambu-Druckstart ist experimentell:** Übertragung per FTPS (Port 990) und Start über MQTT. Funktioniert nur im LAN-/Entwicklermodus. AMS-Zuordnung und Platte lassen sich beim Einplanen wählen.

## Slicer

**Aus dem Slicer senden.** PrintDock gibt sich gegenüber dem Slicer als OctoPrint-Server aus. In OrcaSlicer, PrusaSlicer, SuperSlicer oder darauf aufbauenden Slicern (Snapmaker Orca, Anycubic Slicer Next):

1. Druckerprofil öffnen → *Physischen Drucker hinzufügen/bearbeiten*
2. Host-Typ **OctoPrint**
3. Adresse und API-Key aus *Einstellungen → Slicer* eintragen:
   - `http://<printdock>:3080/slicer` – nur in die Bibliothek
   - `http://<printdock>:3080/slicer/queue` – in die Warteschlange (passender Drucker)
   - `http://<printdock>:3080/slicer/<Drucker-ID>` – in die Warteschlange eines bestimmten Druckers
4. *Test* drücken. Danach landet „Hochladen“ bzw. „Hochladen und drucken“ direkt in PrintDock (letzteres ganz oben in der Warteschlange).

Bambu Studio kann Bambu-Drucker nicht über OctoPrint ansprechen. Dort die Platte als `.gcode.3mf` exportieren und hochladen.

**Im Slicer öffnen.** Bei jeder Datei öffnet „Öffnen in …“ den Slicer auf dem eigenen Rechner (`orcaslicer://`, `bambustudio://`, `prusaslicer://`). Weitere Slicer lassen sich mit ihrem Link-Schema ergänzen. Manche Slicer akzeptieren nur Links bestimmter Webseiten – dann „Herunterladen“ nutzen.

## Filament

**Spulen** (Filament → Spulen): Material, Hersteller, Farbe, Netto- und Leergewicht, Preis, Lagerort. Mehrere gleiche Spulen lassen sich in einem Schritt anlegen. Restmenge per **Wiegen** (Brutto minus Leerspule), per **− g** von Hand oder automatisch.

**Belegung** (Filament → Belegung): Jeder Drucker hat Filament-Plätze. Platz antippen, Spule wählen.

| Drucker | Plätze | Was PrintDock automatisch weiß |
|---|---|---|
| Bambu mit AMS | AMS-Fächer + externe Spule | Material, Farbe, aktives Fach; bei Bambu-Spulen RFID und Restmenge in %. **RFID-Spulen werden automatisch zugeordnet**, unbekannte lassen sich mit einem Klick als Spule anlegen. |
| Snapmaker U1 | Werkzeug 1–4 (je Düse) | aktives Werkzeug, Verbrauch in mm |
| Anycubic mit ACE (Rinkhals) | beim Drucker benennen, z. B. „ACE 1, ACE 2, ACE 3, ACE 4“ | Verbrauch in mm |
| andere | ein Platz je Düse | je nach Firmware |

Meldet der Drucker ein anderes Material als die zugeordnete Spule, markiert PrintDock den Platz rot.

**Abbuchung nach jedem Druck**

- Aus PrintDock gestartet: Gramm je Filament aus der Slicer-Datei (auch mehrfarbig), bei Abbruch oder Fehler anteilig nach Fortschritt. Filament 1, 2, … geht an Werkzeug 1, 2, … bzw. bei Bambu an die gewählte AMS-Zuordnung.
- Direkt am Drucker gestartet: Klipper meldet die verbrauchte Länge, PrintDock rechnet sie über Dichte und Durchmesser in Gramm um („geschätzt“). Bambu meldet keine Menge – dort bei Bedarf von Hand abbuchen.
- Ohne zugeordnete Spule wird der Verbrauch protokolliert, aber nicht abgebucht.

Vor jedem Start zeigt PrintDock, welche Spule wie viel braucht und ob es reicht oder das Material nicht passt. Fällt eine Spule unter die Warnschwelle (Standard 100 g, unter Filament → Verbrauch einstellbar), kommt eine Benachrichtigung „Spule wird knapp“.

**Verbrauch** (Filament → Verbrauch): Protokoll aller Abbuchungen mit Kosten sowie Summen der letzten 30 Tage je Material.

## Wartungsplan

Aufgaben je Drucker mit Intervall in **Betriebsstunden**, **Drucken** oder **Tagen**. Stunden und Drucke zählt PrintDock aus dem Verlauf; Stunden aus der Zeit vor PrintDock trägt man beim Drucker unter „Betriebsstunden vor PrintDock“ ein. „Vorschläge übernehmen“ legt übliche Aufgaben an (Platte reinigen, Düse, Führungen, Riemen, Lüfter/Filter, Firmware) – das sind allgemeine Richtwerte, bitte mit der Anleitung des Druckers abgleichen. Wird eine Aufgabe fällig, kommt einmalig eine Benachrichtigung.

## Kamera

PrintDock holt die Bilder auf dem Server und reicht sie an den Browser weiter. Dadurch funktionieren auch Kameras, die ein Browser nicht direkt anzeigen kann, und Zugangsdaten bleiben auf dem Server. Die Kamera läuft nur, solange jemand zuschaut (plus 30 Sekunden).

| Drucker | Protokoll | Hinweis |
|---|---|---|
| Bambu X1, H2D, H2S, X2D | RTSPS (Port 322) | Am Drucker „LAN-Liveview“ aktivieren. Braucht `ffmpeg`. |
| Bambu P1, A1 | JPEG-Stream (Port 6000) | Läuft ohne Zusatzsoftware. |
| Klipper / Moonraker | Snapshot-URL | Wird automatisch aus Moonraker gelesen, sonst im Drucker-Dialog eintragen. |
| OctoPrint | Snapshot-URL | Standard `/webcam/?action=snapshot`, anpassbar. |

Bei Bambu erkennt PrintDock das Protokoll automatisch; im Drucker-Dialog lässt es sich auch fest einstellen.
Ohne Docker `ffmpeg` installieren: Windows `winget install ffmpeg`, macOS `brew install ffmpeg`, Linux über die Paketverwaltung.

Endpunkte: `/api/printers/:id/camera.jpg` (Einzelbild) und `/api/printers/:id/camera.mjpg` (Livebild) – lassen sich z. B. auch in Home Assistant einbinden.

## Benachrichtigungen

Unter **Benachrichtigungen** beliebig viele Kanäle anlegen und je Kanal wählen, welche Ereignisse gemeldet werden. Mit „Test senden“ prüfen, ob alles ankommt.

| Ereignis | Wann |
|---|---|
| Druck fertig | Job erfolgreich beendet (mit Dauer) |
| Fehler | Drucker meldet einen Fehler oder Klipper fällt aus |
| Pausiert | Druck pausiert – oft Filament leer oder Bambu-Fehlererkennung |
| Abgebrochen | Job abgebrochen |
| Gestartet | Neuer Job beginnt (mit voraussichtlicher Endzeit) |
| Nicht erreichbar | Drucker seit 2 Minuten ohne Verbindung |
| Wartung fällig | Eine Wartungsaufgabe hat ihr Intervall erreicht |
| Spule wird knapp | Restmenge einer Spule unter der Warnschwelle |

| Kanal | Bild | Einrichtung |
|---|---|---|
| ntfy | ja | App installieren, Thema abonnieren, gleiches Thema hier eintragen. Eigener Server möglich. |
| Telegram | ja | Bot über @BotFather anlegen, Token und Chat-ID eintragen. |
| Discord | ja | Webhook-URL des Kanals eintragen. |
| Gotify | nein | Server-URL und App-Token. |
| Webhook | ja (Base64) | JSON per POST, z. B. an Home Assistant oder Node-RED. |

Nach einem Serverneustart meldet PrintDock nichts für Zustände, die schon vorher bestanden – nur echte Wechsel. Dasselbe Ereignis wird pro Drucker höchstens einmal pro Minute verschickt.

## Einen neuen Drucker-Treiber schreiben

Jeder Hersteller ist ein Treiber in `drivers/`. Ein Treiber:

1. erbt von `BaseDriver` (`drivers/base.js`),
2. beschreibt in `static meta` seine Einstellungsfelder – daraus baut die Oberfläche das Formular,
3. meldet seinen Zustand mit `this.update({...})` im gemeinsamen Statusformat (dokumentiert in `base.js`),
4. setzt optional `command(cmd)` für `pause`, `resume` und `cancel` um,
5. liefert optional mit `cameraSource()` eine Kameraquelle (siehe `camera.js`),
6. wird in `drivers/index.js` eingetragen.

Benachrichtigungen, Kamera-Großansicht und Verlauf funktionieren dann automatisch.

`drivers/demo.js` ist die kürzeste Vorlage. Server, Oberfläche und Verlauf müssen dafür nicht angefasst werden.

## Aufbau

```
server.js            HTTP-Server, REST-API, Live-Updates (Server-Sent Events), Verlauf
camera.js            Kamera-Proxy: HTTP-Snapshots, RTSP über ffmpeg, Bambu-JPEG-Stream
notify.js            Ereigniserkennung und Benachrichtigungskanäle
lib/production.js    Aufträge, Warteschlange, Druckstart, Wartungsplan
lib/filament.js      Spulen, Filament-Plätze, Abbuchung, Verbrauch
lib/homeassistant.js Home Assistant: Steckdosen schalten, MQTT-Discovery
lib/demo-data.js     Demo-Daten einspielen/entfernen
lib/demo-assets.js   Erzeugt Vorschaubilder, G-code und 3MF für die Demo
lib/files.js         Dateibibliothek, Auswertung von G-code/3MF
lib/slicer.js        OctoPrint-kompatibler Upload, Slicer-Links
lib/zip.js           Minimaler ZIP-Leser für 3MF
lib/store.js         JSON-Ablage
drivers/
  base.js            Basisklasse und gemeinsames Statusformat
  moonraker.js       Klipper / Moonraker
  bambu.js           Bambu Lab über LAN-MQTT
  octoprint.js       OctoPrint
  demo.js            Simulierter Drucker
public/index.html    Oberfläche: Gestaltung (angelehnt an den Leitstand)
public/app.js        Oberfläche: Logik (ohne Build-Schritt)
public/filament-ui.js  Oberfläche: Filament
public/board.js      Oberfläche: Druckerkarten
public/ha-ui.js      Oberfläche: Home Assistant, Demo-Daten
public/stats-ui.js   Oberfläche: Statistik
public/setup-ui.js   Oberfläche: Einrichtungsassistent, Anmeldung, Einstellungen → Allgemein
public/i18n.js       Übersetzung (deutsche Texte sind die Schlüssel)
public/i18n-en.js    Englische Wörterliste
lib/app.js           Sprache, Akzentfarbe, Module, Login
lib/stats.js         Statistik
lib/i18n.js          Übersetzung auf dem Server (Meldungen, Home Assistant)
scripts/install.sh   Installation auf Raspberry Pi / Debian als Systemdienst
scripts/check.js     Schnelltest (npm run check)
docs/                Installation, Fernzugriff, Screenshots
.github/workflows/   Prüfung, Docker-Images, Home-Assistant-Add-on
ha-addon/            Home-Assistant-Add-on (config.yaml, Dockerfile)
repository.yaml      Add-on-Repository für Home Assistant
data/                JSON-Dateien und hochgeladene Dateien (wird angelegt)
```

### API

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/printers` | Alle Drucker mit aktuellem Status |
| POST | `/api/printers` | Drucker anlegen `{name, driver, config}` |
| PUT / DELETE | `/api/printers/:id` | Drucker ändern / entfernen |
| POST | `/api/printers/:id/command` | `{cmd: "pause" \| "resume" \| "cancel"}` |
| GET / DELETE | `/api/history` | Verlauf lesen / leeren |
| GET | `/api/printers/:id/camera.jpg` | Aktuelles Kamerabild |
| GET | `/api/printers/:id/camera.mjpg` | Kamera-Livebild (MJPEG) |
| GET / POST | `/api/notifications` | Benachrichtigungskanäle lesen / anlegen |
| PUT / DELETE | `/api/notifications/:id` | Kanal ändern / entfernen |
| POST | `/api/notifications/:id/test` | Testnachricht senden |
| POST | `/api/printers/:id/plate-clear` | Druckplatte als frei bestätigen |
| GET / POST | `/api/files` | Bibliothek lesen / Datei hochladen (Rohdaten, Name im Header `X-Filename`) |
| GET | `/api/files/:id/thumb`, `/api/files/:id/dl/:name` | Vorschaubild / Download |
| GET / POST | `/api/queue` | Warteschlange lesen / einplanen `{fileId, printerId?, count, options}` |
| PUT / DELETE | `/api/queue/:id` | Eintrag ändern / entfernen |
| POST | `/api/queue/:id/start`, `/api/queue/:id/requeue`, `/api/queue/reorder` | Starten / erneut einreihen / sortieren |
| GET / POST | `/api/orders` | Aufträge lesen / anlegen |
| PUT / DELETE | `/api/orders/:id` | Auftrag ändern / löschen |
| POST | `/api/orders/:id/plan` | Offene Stückzahlen einplanen |
| GET | `/api/maintenance` | Wartungsaufgaben, Betriebsstunden, Protokoll |
| POST | `/api/maintenance/tasks`, `/api/maintenance/tasks/:id/done`, `/api/maintenance/templates` | Aufgabe anlegen / erledigt / Vorschläge |
| GET | `/api/filament` | Spulen, Plätze je Drucker, Verbrauch |
| POST | `/api/filament/assign` | Spule in Platz legen `{printerId, key, spoolId \| null}` |
| POST | `/api/filament/from-slot` | Spule aus Platz-Angaben anlegen (z. B. RFID) |
| GET | `/api/filament/check?printerId&queueId` | Reicht das Filament für einen Eintrag? |
| POST / PUT / DELETE | `/api/spools`, `/api/spools/:id` | Spulen anlegen / ändern / löschen |
| POST | `/api/spools/:id/weigh`, `/api/spools/:id/book` | Wiegen / von Hand abbuchen |
| GET / PUT / DELETE | `/api/stations`, `/api/stations/:id` | Stationen anzeigen / einstellen / entfernen |
| POST | `/api/stations/pair`, `/api/stations/:id/{tare,calibrate,identify,write}` | Koppeln, Tara, Kalibrieren, Finden, Tag beschreiben (`{spoolId, format}`) |
| POST / PUT / DELETE | `/api/filament/dryers`, `/api/filament/dryers/:id` | Trockner einrichten: `{method: "gcode"|"ha", target, start, stop | startEntity, stopEntity, tempEntity, durationEntity, durationUnit, maxTemp}` |
| POST | `/api/filament/dry` | Trocknen starten `{key, temp, hours}` bzw. beenden `{key, stop: true}` |
| POST / PUT / DELETE | `/api/filament/hum-sources`, `/api/filament/hum-sources/:id` | Feuchte-Messstelle: `{kind: "ha"|"station", entity | stationId, target: {type: "printer", printerId, unit} | {type: "storage", name}}` |
| WS | `/api/station/ws` | Verbindung der Station (Protokoll: printdock-station/docs/protocol.md) |
| POST | `/api/printers/:id/command` | auch `{cmd: "light", on}` und `{cmd: "speed", level: 1–4}` |
| POST | `/api/printers/:id/power` | Steckdose über Home Assistant `{on: true \| false}` |
| GET / PUT | `/api/ha` | Home-Assistant-Einstellungen |
| POST | `/api/ha/test` | Verbindung prüfen |
| GET | `/api/ha/entities` | Schaltbare Entitäten |
| GET | `/api/demo`, POST `/api/demo/load`, `/api/demo/remove` | Demo-Daten |
| GET | `/api/summary` | Kennzahlen für die Übersicht |
| GET / PUT | `/api/app` | Sprache, Akzentfarbe, Module, Login-Schutz, Einrichtung |
| POST | `/api/login`, `/api/logout` | Anmelden / abmelden |
| GET | `/api/stats?days=30` | Statistik (`days=0` = gesamt) |
| GET / PUT | `/api/settings` | Slicer-Einstellungen |
| GET | `/api/drivers` | Verfügbare Treiber und ihre Felder |
| GET | `/api/events` | Live-Stream (SSE): `status`, `printers`, `history`, `channels`, `production`, `files`, `settings` |

## Mitmachen

Neue Drucker, Übersetzungen und Fehlerberichte sind willkommen. Vor einem Pull Request `npm run check` ausführen.
Neue Sprache: `public/i18n-en.js` kopieren (z. B. `i18n-fr.js`), übersetzen, in `index.html` laden und mit `PD_I18N.register('fr', …)` anmelden.

## Geplant

- Etiketten mit QR-Code für Spulen, Auftragszettel drucken
- ACE- und U1-RFID-Daten direkt auslesen, sobald die Firmware sie bereitstellt
- Drucker vor dem Start aus der Warteschlange automatisch einschalten (Home Assistant)
- Ruhezeiten und Wiederholung für Benachrichtigungen, E-Mail
- Mehrere Benutzer mit Rollen

## Lizenz

MIT
