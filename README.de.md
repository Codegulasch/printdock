# PrintDock

*[English](README.md) · Deutsch*

**Eine Oberfläche für alle 3D-Drucker im Haus – egal von welchem Hersteller.**
Bambu Lab, Snapmaker U1, Anycubic (mit ACE), Voron und alle Klipper/Moonraker- oder OctoPrint-Drucker. Inspiriert von [BamBuddy](https://github.com/maziggy/bambuddy), aber nicht auf Bambu Lab beschränkt.

![Druckerübersicht](docs/screenshots/board-dark.png)

Läuft komplett lokal – keine Cloud, kein Konto, keine Datenbank. Als **Home-Assistant-Add-on**, in **Docker** (NAS, Server, Raspberry Pi), als **Systemdienst auf dem Pi** oder mit **Node.js unter Windows, macOS und Linux** – überall mit denselben Funktionen.

## Was PrintDock kann

### Drucker im Blick

- **Live-Status** aller Drucker: Fortschritt, Restzeit, voraussichtliches Ende, Schicht, Temperaturen mit Verlauf, Lüfter, Licht, Geschwindigkeit; Pause, Weiter, Abbrechen
- **Statusampel** auf jeder Karte: frei = grün, druckt = blaues Lauflicht, wartet = gelb blinkend, Störung = rot blinkend
- **Kamera** für jeden Drucker (auch Bambu RTSP und JPEG-Stream) mit Großansicht und Bild speichern; auf Wunsch **Foto nach der ersten Schicht**
- **Startseite „Heute“**: was zu tun ist (Platte räumen, Fehldrucke, hängende Einträge, Etiketten, Feuchte, Einkauf, Wartung, Termine), was gerade läuft und was als Nächstes kommt
- **Benachrichtigungen** mit Kamerabild per ntfy, Telegram, Discord, Gotify oder Webhook
- **Archiv** aller Drucke mit Start und Ende, nach Tagen gruppiert, mit Suche, Filtern und CSV-Export – **auch Drucke direkt aus dem Slicer oder vom Touchscreen**
- **Bereiche** für Printfarmen und verschiedene Räume: Drucker zuordnen, Übersicht nach Bereich gruppiert und filterbar, Warteschlange und Aufträge gezielt an einen Bereich
- **Statistik**: Drucke, Erfolgsquote, Druckstunden, Material, Kosten, Fehldrucke und Ausschuss, Drucker im Vergleich

### Produktion

- **Teile mit Varianten**: ein Modell, eine geslicte Datei je Drucker – eingeplant wird das Teil, gedruckt auf dem freien Drucker mit passender Variante (auch über verschiedene Marken hinweg)
- **Dateibibliothek** für G-code und 3MF mit erkannter Druckzeit, Filament, Druckerprofil und Vorschaubild; beim Hochladen fragt PrintDock, zu welchem Teil und welchen Druckern die Datei gehört
- **Slicer-Anbindung**: aus OrcaSlicer, PrusaSlicer & Co. direkt senden, aus Bambu Studio über den Eingangsordner; Dateien per Klick im Slicer öffnen
- **Druckart je Auftrag und Eintrag**: *Seriendruck (automatisch)*, *Seriendruck (manuell)* oder *Einzeldruck*
- **Warteschlange** mit „Platte frei“-Bestätigung und **automatischer Druckerwahl** nach Profil und eingelegtem Filament
- **Aufträge** mit Positionen (Datei × Stückzahl), Termin, Priorität, **mehreren Teilen pro Platte**, Kalkulation/Angebot und Ist-Kosten
- **Seriendruck**: Druck fertig → nächstes Teil des Auftrags wird am Drucker eingereiht → nach „Platte frei“ startet es von selbst
- **Startzeitfenster** je Drucker und Warten auf günstigen Strom oder PV-Überschuss
- **„Startet nicht, weil …“**: nach „Platte frei“ sagt PrintDock sofort, ob gestartet wird – oder warum nicht, mit passendem Knopf
- **Fehldrucke** mit einem Klick neu einreihen, Grund erfassen, Ausschuss in Kosten und Statistik
- **Hängende Einträge** („druckt“, obwohl der Drucker längst fertig ist) werden erkannt und aufgeräumt
- **Nachbearbeitung** mit Schritten (Stützen entfernen → prüfen → verpackt → versendet)
- **Farbzuordnung beim Start**: Bambu-AMS-Mapping, bei Klipper/OctoPrint werden die Werkzeuge im G-code umnummeriert
- **Wartungsplaner** nach Betriebsstunden, Drucken oder Tagen

### Filament

- **Spulenlager** mit Belegung von AMS, ACE und Werkzeugköpfen, automatischer Abbuchung nach jedem Druck, Kosten und Warnung bei knappen Spulen
- **Reservierung** für alle offenen Drucke, **Einkaufsliste** mit Shop-Link, „Bestellt“ und „Angekommen“
- **Feuchte**: Überwachung von AMS/ACE, Home-Assistant-Sensoren und Stationen; **Feuchte-Check vor dem Start** („erst trocknen, dann automatisch starten“); **Trocknen per Knopf**
- **PrintDock Station** (ESP32 mit NFC, Waage, Feuchtesensor) als **Arbeitsplatz**: Spule auflegen → erkannt, gewogen, mit Knopf direkt ins freie Fach; neue Tags anlegen oder zuordnen, Verlauf, Hinweis von überall und **Inventur**
- **RFID/NFC-Tags mit dem Handy** lesen und beschreiben (Chrome auf Android); Spulen-Etiketten mit QR-Code
- **Spoolman** optional – Bestand übernehmen und Verbrauch zurückmelden

### Kunden

- **Statuslink je Auftrag**: Fortschritt, Termin, voraussichtliches Ende, Nachbearbeitung und Fotos der fertigen Teile – ohne Kosten, ohne Anmeldung
- **Eigener Status-Server** (`relay/`): Kunden-Links funktionieren von überall, ohne das Heimnetz zu öffnen – als **PHP für normales Webhosting** oder als Node.js/Docker
- **Etiketten** für fertige Teile mit QR-Code zum Statuslink

### Home Assistant

- Drucker über **Steckdosen** ein- und ausschalten, **Auto-Aus** nach dem Abkühlen, **Stromverbrauch je Druck**
- Alle Drucker als **MQTT-Geräte**, zwei **Dashboard-Karten**, **Automations-Vorlagen**
- **Notaus**: Rauchmelder oder Temperatursensor schaltet die Drucker ab
- Betrieb als **Add-on** mit Seitenleiste, automatischer Verbindung und Sicherung in den HA-Backups

### Zugriff und Betrieb

- **Fernzugriff** über Tailscale oder Cloudflare Tunnel – direkt in PrintDock eingeschaltet
- **Login-Schutz** immer oder nur von außen; **mehrere Benutzer** (Admin, Bediener) mit **Protokoll**
- **Updates** per Klick (Add-on, Docker, Pi, PC), **tägliche Sicherung**, Umzug per Sicherungs-Zip
- **Plattform-Check** zeigt, was auf der jeweiligen Installation funktioniert
- **Ausbaustufen** Hobby, Maker, Werkstatt – PrintDock zeigt nur, was man braucht; abgeschaltete Funktionen stehen unter **„Mehr entdecken“**
- **Einrichtungsassistent**, **jede Funktion abschaltbar**, **Menü, „Heute“ und Druckerkarten frei anordnen** und Startseite wählen
- **Deutsch und Englisch**, Akzentfarbe, hell und dunkel, fürs Handy geeignet
- **Demo-Daten** mit einem Klick: 5 simulierte Drucker, Dateien, Spulen, Aufträge und 30 Tage Verlauf

| Heute | Archiv |
|---|---|
| ![Heute](docs/screenshots/today.png) | ![Archiv](docs/screenshots/archive.png) |
| **Station** | **Statistik** |
| ![Station](docs/screenshots/station.png) | ![Statistik](docs/screenshots/stats.png) |
| **Teile** | **Einrichtung** |
| ![Teile](docs/screenshots/parts.png) | ![Einrichtung](docs/screenshots/setup.png) |

**Neu hier?** → [Erste Schritte](docs/getting-started.md): in zehn Minuten vom ersten Start zum ersten Druck.

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

**Windows:** statt `npm start` besser `scripts\start-windows.cmd` starten – dann startet PrintDock nach einem Update oder dem Einspielen einer Sicherung von selbst neu.

Dann `http://<ip>:3080` öffnen. Der Einrichtungsassistent fragt Sprache, Aussehen, Funktionen und Zugang ab und spielt auf Wunsch Demo-Daten ein. Alles lässt sich später unter **Einstellungen → Allgemein** ändern. Was auf der jeweiligen Installation funktioniert (Neustart, Update, ffmpeg, Fernzugriff, Home Assistant, Eingangsordner, Sicherung, Zeitzone), zeigt **Einstellungen → System → Plattform-Check**.

## Unterstützte Drucker

| Anbindung | Drucker | Was der Drucker braucht |
|---|---|---|
| **Klipper / Moonraker** | Snapmaker U1, Anycubic Kobra 3 / S1 / S1 Max (mit Rinkhals), Voron, Creality K1/K2 (gerootet), alle anderen Klipper-Drucker | Moonraker erreichbar (Standard-Port 7125) |
| **Anycubic (LAN-Modus)** | Kobra S1 / S1 Max, Kobra 3 / 3 Max, Kobra 2 Pro mit Original-Firmware, samt ACE Pro | LAN-Modus am Drucker eingeschaltet; IP-Adresse |
| **Bambu Lab (LAN)** | X1, P1, A1, H2D, X2D | LAN-Modus, bei neuer Firmware zusätzlich Entwicklermodus; IP, Seriennummer, Access Code |
| **OctoPrint** | Alle Marlin-Drucker mit OctoPrint | API-Key |
| **Demo** | – | Simulierter Drucker zum Ausprobieren |

**Snapmaker U1** – Moonraker ist ab Werk aktiv. IP am Touchscreen nachsehen und als *Klipper / Moonraker* einbinden.

**Anycubic Kobra S1 / Kobra 3** – Mit der Original-Firmware am Drucker den *LAN-Modus* einschalten und als *Anycubic (LAN-Modus)* einbinden: Status, Pause/Weiter/Abbrechen, Licht, Kamera, ACE-Fächer (Material und Farbe) und ACE-Trocknen. Drucke starten: Mit [Rinkhals](https://github.com/rinkhals-community/Rinkhals) zusätzlich den Moonraker-Port (meist 7125) beim Drucker eintragen – Status, ACE und Trocknen laufen dann über den LAN-Modus, Drucke über Moonraker. Ohne Rinkhals am Drucker oder im Slicer starten. Alternativ mit Rinkhals komplett als *Klipper / Moonraker* einbinden. Das LAN-Protokoll folgt [anycubic-lan](https://github.com/Nino6689/anycubic-lan).

**Bambu Lab** – Am Drucker LAN-Modus aktivieren; der Access Code steht im Netzwerkmenü. Seit den Firmware-Änderungen 2025 lassen neuere Modelle Steuerbefehle von Drittsoftware nur im Entwicklermodus zu. Druckstart und die zweite Düse von H2D/X2D sind noch **experimentell** – Rückmeldungen mit echten Geräten sind willkommen.

## Statusampel

| Anzeige | Bedeutung |
|---|---|
| 🟢 grün, leuchtend | **Frei** – bereit für den nächsten Druck |
| 🔵 blau, Lauflicht | **Druckt** (auch: bereitet vor, Datei wird übertragen) |
| 🟡 gelb, blinkend | **Wartet** – pausiert, oder Platte muss geräumt werden |
| 🔴 rot, blinkend | **Störung** |
| ⚪ grau | Nicht erreichbar |

Die Farben sind fest und unabhängig von der gewählten Akzentfarbe. Neben jeder Leuchte steht der Zustand als Text.

## Oberfläche

Seitenleiste mit allen Bereichen und Zählern für offene Punkte; unten Sprache (DE/EN), hell/dunkel und Abmelden. **Reihenfolge, ausgeblendete Menüpunkte und Startseite** lassen sich unter *Einstellungen → Allgemein → Menü* festlegen – für alle Geräte oder nur für dieses (z. B. das Handy). Abgeschaltete Funktionen (*Einstellungen → Allgemein → Funktionen*) verschwinden aus Menü und Druckerkarten, ihre Daten bleiben erhalten.

**Ausbaustufen:** Im Einrichtungsassistenten und unter *Einstellungen → Allgemein* wählt man einen Startpunkt – **Hobby** (Übersicht, Teile & Dateien, Archiv, Filament, Kamera, Benachrichtigungen, Home Assistant), **Maker** (zusätzlich Warteschlange mit Auto-Start, Statistik, Wartungsplan) oder **Werkstatt** (zusätzlich Aufträge mit Kalkulation, Kunden-Links, Nachbearbeitung, Bereiche). Danach lässt sich jede Funktion einzeln schalten. Was aus ist, steht unter **„Mehr entdecken“** mit einem Satz, was es bringt, und *Einschalten*; unten in der Seitenleiste erinnert ein kleiner Hinweis daran.

**Anordnen:** Auf *Heute* und *Drucker* öffnet **Anordnen** den Umstellmodus: Kästen bzw. Druckerkarten ziehen oder mit den Pfeilen verschieben (auch am Handy), Kästen auf *Heute* aus- und einblenden. Gilt für alle oder nur für dieses Gerät; *Standard* setzt zurück.

**Teile mit Varianten:** Unter *Dateien → Teile* ist ein Teil ein Modell („Kabelclip“) mit einer geslicten Datei je Drucker bzw. Druckertyp. Warteschlange und Aufträge planen das Teil ein; gestartet wird auf dem freien Drucker, für den es eine Variante gibt – ein Auftrag „20 × Kabelclip“ verteilt sich so auf X2D, U1 und Kobra gleichzeitig. Beim Hochladen fragt PrintDock, zu welchem Teil die Datei gehört (Vorschlag nach dem Namen) und für welche Drucker sie ist (vorausgewählt nach dem Druckermodell in der Datei), auf Wunsch gleich mit Anzahl zum Einplanen. Dateien aus dem Slicer und dem Eingangsordner ordnet PrintDock selbst zu: gleicher Name und Drucker = neue Version, gleicher Name und anderer Drucker = weitere Variante. Je Variante lassen sich feste Drucker statt des Modells wählen.

Jede Druckerkarte zeigt:

- **Kopf**: Bauform-Bild, Name, Modell und Düsendurchmesser, Steckdosen-Knopf (Home Assistant), Einstellungen
- **Plaketten**: Verbindung, WLAN-Signal, Gerätemeldungen (Bambu HMS), Feuchte, Wartungsstand, eingeplante Drucke
- **Status**: Vorschaubild, Datei, Auftrag, Fortschritt, Restzeit, Endzeit, Schicht – bzw. „Platte räumen“ oder „Bereit“; darunter der nächste Druck aus der Warteschlange oder „Startet nicht: …“ mit Grund
- **Temperaturen** mit Verlauf der letzten Minuten, aktive Düse hervorgehoben; **Lüfter** in Prozent
- **Steuerung**: Licht, Kamera, Geschwindigkeit (Leise/Standard/Sport/Turbo), Pause/Weiter/Stopp
- **Filament**: AMS/ACE-Einheiten mit Feuchte, Temperatur und Trockner, jedes Fach mit Farbe, Material und Restmenge

Oben fasst eine Zeile zusammen, wie viele Drucker frei sind, drucken, warten oder eine Störung haben, und welcher als Nächstes frei wird.

## So läuft ein Druck durch PrintDock

```
Slicer ──„An Drucker senden“──┐
Hochladen (Planung → Dateien) ─┴─> Dateibibliothek
                                       │
Auftrag anlegen (Datei × Stückzahl) ───┤ „Einplanen“
                                       ▼
                              Warteschlange ──Start / automatisch──> Drucker druckt
                                       ▲                                   │
                         „Platte ist frei“ bestätigen  <── Druck fertig ───┘
                                                         (Verlauf, Auftrag zählt mit, Filament
                                                          abgebucht, Wartung zählt Stunden)
```

- **Platte frei:** Nach jedem Druck zeigt die Druckerkarte „Platte räumen“ (gelb blinkend). Erst nach **Platte ist frei** startet der nächste Druck. Wer von Hand aus Warteschlange oder Auftrag startet, kreuzt im Start-Dialog zusätzlich **„Druckplatte ist geräumt“** an (abschaltbar) – so landet nie ein Druck auf einem belegten Bett.
- **Druckart** (am Auftrag und an jedem Eintrag, Standard unter *Einstellungen → Drucker & Filament → Druckstart*):
  - **Seriendruck (automatisch)** – alle Drucke stehen in der Warteschlange, nach „Platte frei“ startet der nächste von selbst.
  - **Seriendruck (manuell)** – alle Drucke stehen in der Warteschlange, der nächste steht mit **Start** auf der Druckerkarte, startet aber nie von selbst.
  - **Einzeldruck** – es wird immer nur ein Druck eingereiht und von Hand gestartet; beim Auftrag druckt *Drucken* jeweils das nächste einzelne Teil.
- **Startet nicht?** PrintDock versucht nach „Platte frei“ sofort zu starten und meldet auf der Karte, auf *Heute* und als Hinweis „Startet: X“ oder „Startet nicht, weil …“ – Druckart manuell oder Einzeldruck, Eintrag hängt noch auf „druckt“, letzter Start fehlgeschlagen, Filament zu feucht, außerhalb des Startfensters, Profil oder Filament passt nicht – jeweils mit dem Knopf, der es behebt. Fehlgeschlagene Starts werden nach 2 Minuten automatisch erneut versucht (bis zu 3-mal).
- **Zuweisung:** Ein Eintrag gehört fest zu einem Drucker oder zu „passender Drucker“. Letzteres bekommt der freie Drucker, zu dessen Profil die Datei geslict ist und in dem das passende Filament liegt (nächstliegende Farbe gewinnt). Für ein anderes Profil geslicte Dateien startet PrintDock nie.
- **Reihenfolge:** neu eingereihte Fehldrucke zuerst, dann Priorität des Auftrags (eilig vor normal), Termin und manuelle Reihenfolge (▲▼).
- **Farben zuordnen:** Beim Start schlägt PrintDock nach Material und Farbe vor, welches Fach bzw. Werkzeug welches Filament aus dem Slice druckt – jede Zeile lässt sich ändern. Bambu bekommt die Zuordnung als AMS-Mapping, bei Klipper und OctoPrint nummeriert PrintDock die Werkzeuge im G-code um (z. B. T0 → T2).
- **Dateiformat:** Klipper und OctoPrint brauchen `.gcode`, Bambu eine geslicte `.gcode.3mf`. PrintDock prüft das vor dem Start.
- **Bambu-Druckstart ist experimentell:** Übertragung per FTPS (Port 990) und Start über MQTT, nur im LAN-/Entwicklermodus.
- **Übertragung:** Meldet der Drucker den Druck, gilt der Start als gelungen – auch wenn die Antwort auf das Hochladen ausbleibt (z. B. Snapmaker U1). Wird PrintDock während einer Übertragung neu gestartet, gleicht es den Eintrag mit dem Verlauf ab, statt die Datei ein zweites Mal zu drucken.

### Seriendruck und Startzeitfenster

- **Seriendruck (automatisch):** Ist ein Druck fertig, reiht PrintDock das nächste offene Teil – desselben Auftrags zuerst, sonst eines anderen automatischen Auftrags nach Priorität und Termin – an diesem Drucker ein und startet es, sobald die Platte als frei bestätigt ist. Nur Dateien mit passendem Profil, Filament und Feuchte.
- **Startzeitfenster** (in den Druckereinstellungen): automatische Starts nur z. B. zwischen 07:00 und 22:00 (außerhalb nur kurze Drucke). Lange Drucke können auf günstigen Strom warten – mit einer beliebigen Home-Assistant-Entität: Preis unter einem Wert, Einspeisung über einem Wert oder ein PV-Überschuss-Schalter. Von Hand starten geht immer.

### Teile pro Platte, Nachbearbeitung, Fehldrucke

- **Teile pro Druck** je Auftragsposition: 20 Teile mit 4 pro Druck ergeben 5 Drucke; Fortschritt, Kosten, Restzeit und Reservierung rechnen entsprechend.
- **Nachbearbeitung** (Option): Schritte wie Stützen entfernen → prüfen → verpackt → versendet mit Zählern je Auftrag, Übersicht auf *Heute* und Anzeige im Kunden-Statuslink.
- **Fehldrucke:** Abgebrochene oder fehlgeschlagene Drucke erscheinen auf *Heute* mit **Neu einreihen** (gleiche Datei, gleiche Farbzuordnung, oben in der Warteschlange) oder *Passt so*. Ein fertiges, aber unbrauchbares Teil lässt sich im Verlauf als **Fehldruck** werten – es zählt dann nicht mehr als erledigt, das Material wird als Ausschuss gebucht. Gründe erscheinen in der Statistik je Drucker.
- **Hängende Einträge:** Laufende Drucke überstehen einen Neustart von PrintDock (z. B. beim Update). Zeigt ein Eintrag trotzdem noch „druckt“, obwohl der Drucker seit 3 Minuten bereit ist, schließt PrintDock ihn ab 95 % als fertig ab, sonst fragt es auf *Heute* und in der Warteschlange: *War fertig* / *Abgebrochen*. Auftrag, Verlauf und Filament werden nachgetragen. Jeder laufende Eintrag hat dafür auch *Hängt?*.

### Kosten, Strom und Fotos

Jeder Druck im Verlauf zeigt seine Kosten – Filament nach Spulenpreis, Strom (über eine messende Steckdose in Home Assistant oder geschätzt), auf Wunsch Maschinenstunde und Aufschlag. Aufträge zeigen eine Kalkulation aus den geslicten Dateien, die Ist-Kosten und Ausschuss; „Kalkulation / Angebot drucken“ erzeugt eine druckbare Seite. Am Druckende speichert PrintDock ein Kamerabild des fertigen Teils im Verlauf und am Auftrag, auf Wunsch zusätzlich nach der ersten Schicht. Fertige Aufträge lassen sich archivieren.

## Archiv

*Archiv* im Menü zeigt jeden beendeten Druck mit **Start und Ende** (von–bis), Dauer, Drucker, Datei, Foto, Filament, Kosten, Auftrag und Ergebnis – nach Tagen gruppiert, mit Summen (Drucke, Erfolgsquote, Druckzeit, Filament, Kosten).

- **Suche** über Datei, Auftrag, Kunde und Drucker; **Filter** nach Zeitraum (heute, 7/30 Tage, Monat, Jahr, frei wählbar), Drucker, Ergebnis (auch Fehldruck), Quelle (aus PrintDock oder am Drucker/Slicer) und Auftrag (mit, ohne, Zuordnung offen, ein bestimmter); **CSV-Export** der gefilterten Liste (für Excel)
- **Nochmal drucken** plant die gleiche Datei (gleiche Platte) wieder ein
- es bleiben bis zu 20 000 Drucke gespeichert

**Drucke, die nicht aus PrintDock kamen** – direkt aus dem Slicer an den Drucker geschickt oder am Touchscreen gestartet – landen genauso im Archiv:

- PrintDock erkennt sie am Druckerstatus und **holt die Datei vom Drucker** in die Bibliothek (*vom Drucker übernommen*): Klipper/Snapmaker U1 über Moonraker, Bambu per FTPS von der SD-Karte (inklusive gedruckter Platte), OctoPrint über die Download-Adresse, Anycubic nur mit Rinkhals. Gleiche Dateien werden am Inhalt erkannt und nicht doppelt abgelegt. Damit gibt es Vorschaubild, Gramm je Farbe, Filament-Abbuchung (auch bei Bambu), Kosten und *Nochmal drucken*. Bei Mehrfarb-Drucken ordnet PrintDock die Gramm nach Werkzeug bzw. – bei Bambu – nach Material und Farbe der benutzten Fächer zu.
- **Auftrag zuordnen:** Passt der Druck eindeutig zu einer offenen Auftragsposition (gleiche Datei oder gleicher Name), zählt er dort automatisch mit. Sonst erscheint er auf *Heute* und im Archiv mit *Auftrag zuordnen …* (Vorschläge, beliebiger Auftrag oder *kein Auftrag*). Zugeordnete Drucke zählen als fertige Teile – mit Kosten, Foto, Etikett und Kunden-Statuslink; wartet in der Warteschlange schon ein Druck dieser Position, gilt er damit als erledigt.
- Während ein solcher Druck läuft, zeigt die Warteschlange „wartet, bis X fertig ist“ und *Heute* sagt „Drucker belegt durch einen Druck, der nicht aus PrintDock kam“.
- **Nach Stromausfall fortgesetzt:** Setzt der Drucker denselben Druck kurz nach einem Abbruch an gleicher Stelle fort, zählt PrintDock das als einen Druck – ohne doppelte Abbuchung, ohne „Fehldruck“-Nachfrage.
- **Neu geslicte Version:** Wird eine Datei mit gleichem Namen, aber anderem Inhalt hochgeladen und nutzt ein offener Auftrag noch die alte, fragt *Heute*: neue Version für diesen Auftrag übernehmen?
- Einstellungen unter *Einstellungen → Drucker & Filament → Archiv*: Datei übernehmen an/aus, Höchstgröße, übernommene Dateien ohne Auftrag nach X Tagen löschen (Standard 90, der Archiv-Eintrag bleibt), automatisch zuordnen an/aus.

## Kunden-Links

Je Auftrag gibt es auf Wunsch einen **Statuslink** mit QR-Code: Fortschritt, Termin, voraussichtliches Ende, Nachbearbeitung und Fotos der fertigen Teile – **ohne Kosten**, ohne Anmeldung, nicht erratbar. Dazu **Etiketten** für fertige Teile (Auftrag, Teil x von y, Kunde, Datum, QR-Code), gesammelt druckbar von *Heute* oder aus dem Auftrag.

Läuft PrintDock im Heimnetz, zeigt ein solcher Link auf eine Adresse wie `192.168.x.x`, die Kunden nicht erreichen. Dafür gibt es den **Status-Server** im Ordner [`relay/`](relay/README.md): Er läuft auf einem eigenen Server oder Webhosting im Internet, PrintDock **schickt** ihm bei jeder Änderung die Statusdaten und Fotos. Verbindungen gehen nur von PrintDock nach außen, das Heimnetz bleibt zu.

- **PHP-Version** (`relay/php`) für normales Webhosting: per FTP hochladen, Schlüssel in `config.php` eintragen, fertig – auch ohne URL-Umschreibung und bei Hostern, die nur GET/POST erlauben
- **Node.js/Docker-Version** (`relay/server.js`) für eigene Server
- mehrere PrintDock-Installationen mit eigenen Schlüsseln, Firmenname und Link im Seitenfuß, Seiten verfallen nach Abschluss des Auftrags (Standard 30 Tage), Link abschalten löscht die Seite auch auf dem Server

Einrichten unter *Einstellungen → Fernzugriff → Kunden-Links*, Anleitung in [relay/README.md](relay/README.md).

## Filament

**Spulen** (*Filament → Spulen*): Material, Hersteller, Farbe, Netto- und Leergewicht, Preis, Lagerort. Mehrere gleiche Spulen lassen sich in einem Schritt anlegen. Restmenge per **Wiegen** (direkt von der PrintDock Station oder von Hand: Brutto minus Leerspule), per **− g** oder automatisch.

**Belegung** (*Filament → Belegung*): Jeder Drucker hat Filament-Plätze. Platz antippen, Spule wählen.

| Drucker | Plätze | Was PrintDock automatisch weiß |
|---|---|---|
| Bambu mit AMS | AMS-Fächer + externe Spule | Material, Farbe, aktives Fach; bei Bambu-Spulen RFID und Restmenge in %. **RFID-Spulen werden automatisch zugeordnet**, unbekannte lassen sich mit einem Klick als Spule anlegen. |
| Anycubic mit ACE (LAN-Modus) | ACE-Fächer | Material und Farbe je Fach, Trockner |
| Snapmaker U1 | Werkzeug 1–4 (je Düse) | aktives Werkzeug, Verbrauch in mm |
| andere | ein Platz je Düse | je nach Firmware |

Meldet der Drucker ein anderes Material als die zugeordnete Spule, markiert PrintDock den Platz rot.

**Abbuchung nach jedem Druck:** Aus PrintDock gestartet: Gramm je Filament aus der Slicer-Datei (auch mehrfarbig), bei Abbruch oder Fehler anteilig nach Fortschritt. Direkt am Drucker gestartet: Klipper meldet die verbrauchte Länge, PrintDock rechnet sie in Gramm um („geschätzt“); Bambu meldet keine Menge. Ohne zugeordnete Spule wird der Verbrauch nur protokolliert. Fällt eine Spule unter die Warnschwelle (Standard 100 g), kommt „Spule wird knapp“. *Filament → Verbrauch* zeigt alle Abbuchungen mit Kosten.

**Reservierung und Einkauf:** Jeder offene Druck reserviert die Gramm aus seiner Datei auf der Spule, von der er drucken wird. Spulen zeigen *reserviert / frei*, Einträge warnen bei zu wenig Filament mit Vorschlag für eine andere Spule. Die **Einkaufsliste** (Spulen-Seite und *Heute*, druckbar) zeigt, was für alle offenen Drucke und Aufträge fehlt – je Material und Farbe mit gemerktem Shop und Link. *Bestellt …* zählt gegen den Fehlbestand, *Angekommen* legt die Spulen an.

**Filamentfeuchte:** AMS- und ACE-Einheiten, die selbst messen, überwacht PrintDock automatisch. Einheiten ohne Messung, Drucker und Trockenboxen/Lagerorte bekommen unter *Einstellungen → Drucker & Filament → Feuchte & Trocknen* einen Sensor: einen beliebigen Feuchtesensor aus Home Assistant oder eine PrintDock Station mit Feuchtesensor (SHT31/SHT40/AHT20/HTU21D). Warn- und Alarmwert erscheinen an den Druckerkarten, in der Kopfzeile, auf der Home-Assistant-Karte und unter *Filament → Feuchte & Trocknen*, mit Verlauf über 48 Stunden und Trocknungsdatum je Spule. Ist ein Drucker offline, bleibt sein zuletzt gemeldeter Trockner sichtbar.

**Feuchte-Check vor dem Start:** Grenzwerte je Material (z. B. PLA 60 %, PETG 50 %, PA 30 % und alle 7 Tage trocknen). Ist das Filament zu feucht, bietet der Start-Dialog *erst trocknen, dann automatisch starten*, einen anderen Drucker oder *trotzdem drucken*. Auto-Start wartet, solange das Filament zu feucht ist (abschaltbar).

**Trocknen per Knopf** (*Filament → Feuchte & Trocknen*): Bambu AMS 2 Pro (45–65 °C) und AMS HT (45–85 °C) direkt per MQTT (LAN-Modus mit Entwicklermodus), Anycubic ACE Pro direkt im LAN-Modus; Klipper/Moonraker-Drucker über ein G-Code-Makro; alles andere über Home Assistant – Trockenbox an einer Steckdose oder ein Trockner mit eigener Integration (Start-/Stopp-Taste, Temperatur, Dauer). Temperatur und Dauer schlägt PrintDock aus den Spulen der Einheit vor (die empfindlichste bestimmt die Temperatur).

**PrintDock Station:** ein ESP32 mit NFC-Leser (PN532), Waage (HX711), optional Feuchtesensor und kleinem Display, mit eigener Firmware: [printdock-station](https://github.com/Codegulasch/printdock-station). Spule auflegen → PrintDock erkennt sie (Tag-Kennung, Spulen-Link, OpenSpool- oder Anycubic-Daten), bucht die Restmenge nach Gewicht (das Leergewicht lernt es an einer neuen, vollen Spule) und merkt sie sich 3 Minuten: Das nächste Fach, das eine frisch eingelegte Spule meldet, bekommt sie – bei Bambu gehen Material und Farbe gleich ans AMS. Die Seite *Filament → Station* ist ein Arbeitsplatz je Station: links der Teller der Waage mit Live-Gewicht (leer, unbekannter Tag oder Spule mit Restmengen-Ring), rechts, was zu tun ist. Bei einer bekannten Spule: Restmenge, zuletzt gewogen, Platz und Reservierungen, *Gewicht übernommen* mit *rückgängig*, **Gleich einlegen in …** mit den freien Fächern als Knöpfe, Tag beschreiben, Etikett, ins Lager. Bei einem leeren oder unbekannten Tag: neue Spule anlegen, vorhandene zuordnen oder ignorieren – dazu Vorschläge passender Spulen ohne Tag nach Gewicht. Darunter *Zuletzt an der Station*. Legt jemand etwas auf, kommt in PrintDock ein Hinweis mit *Ansehen* (je Station abschaltbar). Bei der **Inventur** legt man Spule für Spule auf. Koppeln per sechsstelligem Code unter *Einstellungen → PrintDock Station*; ohne Hardware simuliert `node scripts/station-sim.js` eine Station.

**RFID/NFC mit dem Handy** (Chrome auf Android, über HTTPS): *Tag lesen* auf der Spulen-Seite öffnet bekannte Spulen, macht aus OpenSpool-Tags eine neue Spule und lässt unbekannte Tags zuordnen. Leere Tags lassen sich in vier Formaten beschreiben (PrintDock + OpenSpool, OpenSpool, nur Link, Anycubic ACE) – mit dem Handy oder an der Station. Auf dem iPhone erlaubt Apple kein NFC in Webseiten (QR-Etiketten funktionieren); Original-Bambu-Tags sind verschlüsselt, lesbar ist nur ihre Kennung. Vorhandene ESPHome-Leser funktionieren über `POST /api/rfid` mit `{"tag": "…", "printer": "…", "slot": "…"}`.

**Spulen-Etiketten** mit QR-Code in 62 × 29 mm (Brother QL), 50 × 30, 40 × 30, 57 × 25 mm oder als A4-Bogen. Scannen öffnet die Spule mit Schnellaktionen.

**Spoolman (optional):** *Einstellungen → Drucker & Filament → Filament* übernimmt den Spulenbestand aus Spoolman und meldet Verbrauch, gewogene Restmengen und den aktuellen Drucker/Platz zurück. Ist Spoolman kurz weg, holt PrintDock die Buchungen nach.

## Home Assistant

**Drucker ein- und ausschalten.** Unter *Einstellungen → Home Assistant* Adresse und Langzeit-Token eintragen (beim Add-on automatisch). Je Drucker eine schaltbare Entität (`switch.…`, `light.…`, `input_boolean.…`) wählen; die Druckerkarte bekommt einen Ein/Aus-Knopf. **Auto-Aus** schaltet nach Druckende ab, sobald die Düse abgekühlt ist und kein neuer Druck läuft. Während eines Drucks verweigert PrintDock das Ausschalten. Misst die Steckdose, erfasst PrintDock den **Stromverbrauch je Druck**.

**Notaus.** Ein Rauchmelder oder Temperatursensor aus Home Assistant löst Alarm aus → PrintDock schaltet die Steckdosen der Drucker ab und meldet „Notaus“. Mit Probealarm ohne Abschalten.

**PrintDock in Home Assistant.** Mit eingeschalteten *MQTT-Geräten* meldet PrintDock jeden Drucker per MQTT-Discovery an:

| Typ | Entitäten |
|---|---|
| Sensoren | Status, Fortschritt, Restzeit, Fertig um, Datei, Schicht, Temperaturen (je Düse, Bett, Kammer) |
| Binärsensoren | Verbunden, Druckt, Platte räumen |
| Knöpfe | Pause, Fortsetzen, Abbrechen, Platte ist frei |
| Schalter / Auswahl | Licht, Geschwindigkeit |
| Bild | Kamera |
| Gerät „PrintDock“ | Warteschlange, aktive Drucker, überfällige Aufträge, knappe Spulen, fällige Wartungen |

**Automations-Vorlagen** (*Einstellungen → Home Assistant*): „Druck fertig“ mit der Taste *Platte ist frei* direkt in der Handy-Meldung, Licht an bei Fertig, Abluft während des Drucks, Alarm bei Störung/Pause. Als Add-on mit einem Klick in Home Assistant kopiert, sonst zum Herunterladen.

**Dashboard-Karten** (Voraussetzung: *MQTT-Geräte* eingeschaltet):

- `custom:printdock-card` – ein Drucker mit Statusampel, Auftrag, Fortschritt, Kamera, Temperaturen, Lüftern, Filamentbelegung und Steuerung (Licht, Geschwindigkeit, Pause/Weiter/Stopp, „Platte ist frei“, Ein/Aus).
- `custom:printdock-overview-card` – alle Drucker plus Warteschlange, Aufträge, knappe Spulen und fällige Wartungen; mit `area: <Bereich>` nur ein Bereich (z. B. eine Karte je Raum).

Beide haben einen grafischen Editor. Installation: beim Add-on automatisch; sonst *Einstellungen → Home Assistant → In Home Assistant eintragen*, über HACS (dieses Repository als *Dashboard*) oder von Hand als Ressource `http://<printdock>:3080/printdock-card.js` (JavaScript-Modul).

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

**Als Add-on** läuft PrintDock direkt in Home Assistant – mit Eintrag in der Seitenleiste (Ingress), automatischer Verbindung zu Home Assistant und zum Mosquitto-Broker und Sicherung in den Home-Assistant-Backups. Das Image (amd64, aarch64, armv7) liegt unter `ghcr.io/codegulasch/printdock-addon-*`. Port 3080 bleibt zusätzlich erreichbar – für Slicer-Uploads, Kamerabilder und das Handy im Heimnetz. Läuft PrintDock auf einem NAS oder PC, lässt es sich in Home Assistant als *Webseite*-Dashboard einbinden.

## Fernzugriff, Benutzer und Sicherheit

Im Heimnetz läuft PrintDock ohne Anmeldung. Für den Zugriff von unterwegs unter **Einstellungen → Fernzugriff** einschalten (Anleitung: [docs/remote-access.md](docs/remote-access.md)):

- **Tailscale** – privates VPN, nichts öffentlich; Anmeldung per Link oder Auth-Key, auf Wunsch mit HTTPS-Adresse `https://printdock.<tailnet>.ts.net`
- **Cloudflare Tunnel** – Schnelltest ohne Konto oder eigene Adresse mit Tunnel-Token; nur mit Login-Schutz
- **Home Assistant** – das Add-on ist überall erreichbar, wo Home Assistant es ist

PrintDock lädt `tailscale` bzw. `cloudflared` beim Einschalten selbst herunter und hält es am Laufen – als Add-on, in Docker und auf dem Pi gleich. Unter Windows und macOS lädt es `cloudflared` passend herunter; für Tailscale nutzt es die installierte Tailscale-App (auch ein vorhandenes Tailscale auf Pi oder Server).

**Login-Schutz** (*Einstellungen → System*) gilt wahlweise immer oder nur von außen; die Home-Assistant-Seitenleiste fragt nie nach dem PrintDock-Passwort. **Mehrere Benutzer:** *Admin* darf alles, *Bediener* darf Drucke starten, „Platte frei“ bestätigen, neu einreihen, Spulen wiegen und zuordnen – aber keine Einstellungen ändern. Das **Protokoll** unter *System* zeigt, wer was geändert hat.

Passwörter werden mit scrypt gespeichert, Sitzungen per HttpOnly-Cookie, nach 5 Fehlversuchen eine Minute Sperre. Access Codes, API-Keys und Bot-Tokens liegen im Klartext in `data/`; die Oberfläche zeigt sie nie an. Port 3080 nie direkt im Router freigeben.

## Updates, Sicherung, Plattformen

**Updates:** *Einstellungen → System → Updates* sieht auf GitHub nach einer neuen Version (auch automatisch alle 6 Stunden, auf Wunsch mit Benachrichtigung) und installiert sie per Klick: als Add-on baut Home Assistant PrintDock neu, auf PC und Raspberry Pi ersetzt PrintDock seine Dateien und startet neu, **in Docker** liegt die neue Version im Datenordner (ein neueres Image per `docker compose pull` hat wieder Vorrang). Für ein privates Repository unter „Update-Quelle“ einen GitHub-Token mit Leserecht eintragen.

**Sicherung:** PrintDock sichert sich täglich selbst – als Add-on nach `/share/printdock/sicherungen` (per Samba `\\homeassistant\share\printdock\sicherungen`), sonst in den Datenordner; die letzten 7 bleiben (einstellbar), mit oder ohne Druckdateien. *Einstellungen → System → Datensicherung* lädt eine `.zip` mit allem herunter. Einspielen lässt sie sich dort oder im Einrichtungsassistenten einer neuen Installation. Als Add-on, Docker-Container, systemd-Dienst oder mit `start-windows.cmd` startet PrintDock danach von selbst neu. Der vorherige Stand bleibt im Datenordner unter `before-restore-…` erhalten.

**Speicherort (NAS):** Druckdateien, Fotos und Sicherungen lassen sich unter *Einstellungen → System → Speicherort* auf ein NAS, einen Server oder eine zweite Platte legen – damit läuft z. B. Home Assistant nicht voll, und die HA-Sicherungen bleiben klein. Einstellungen, Archiv und Spulen bleiben immer im Datenordner. Drei Arten:

| Art | Wofür | So geht's |
|---|---|---|
| **Datenordner** | Standard | nichts einstellen |
| **SMB-Freigabe** (empfohlen) | NAS, TrueNAS, Synology, Windows-Freigabe – **ohne Einhängen, ohne Home Assistant** | Server (IP), Freigabe, optional Unterordner, Benutzer und Passwort eintragen, *Prüfen*, *Übernehmen* |
| **Eingehängter Ordner** | Ordner, den das System schon kennt | Add-on: HA-Netzwerkspeicher → `/share/<Name>` oder `/media/<Name>` · Docker: Volume, z. B. `/mnt/nas/printdock:/nas` · Pi/Linux: `/etc/fstab` · Windows: UNC-Pfad `\\nas\drucken\printdock` · macOS: `/Volumes/<Freigabe>/printdock` |

PrintDock legt die Unterordner `dateien`, `fotos` und `sicherungen` an (jeweils zuschaltbar), kopiert die vorhandenen Dateien hinüber und löscht sie erst danach lokal. **Mit SMB** schreibt PrintDock neue Dateien zuerst in einen kleinen Zwischenspeicher im Datenordner und schiebt sie dann auf die Freigabe; gebraucht wird eine Datei (Druckstart, Download, Foto), holt PrintDock sie kurz zurück. Vorschaubilder bleiben lokal, damit die Oberfläche schnell bleibt. Druckdateien und Fotos landen dann **nicht** in der PrintDock- und HA-Sicherung – sie liegen ja schon auf dem NAS. Wechselt man zurück auf den Datenordner, holt PrintDock alles zurück; die Kopien auf dem NAS bleiben stehen. SMB braucht `smbclient` – im Add-on- und Docker-Image enthalten, auf dem Pi per Installer (`apt install smbclient`), macOS `brew install samba`; Windows nutzt den Netzwerkpfad direkt.

*TrueNAS:* einen Benutzer mit „Samba Authentication“ anlegen und ihm Schreibrecht auf das Dataset geben; als Freigabe nur den Freigabenamen eintragen, nicht den Pfad auf dem NAS. Läuft Home Assistant als VM auf demselben TrueNAS, braucht die VM eine Netzwerkbrücke, sonst erreicht sie das NAS nicht.

Ist das NAS einmal nicht erreichbar, speichert PrintDock so lange lokal und zieht die Dateien nach, sobald es wieder da ist; *Heute* und der Plattform-Check zeigen das an. Beim eingehängten Ordner verhindert eine Kennungsdatei, dass PrintDock in einen leeren Einhängepunkt auf der lokalen Platte schreibt.

**Plattform-Check:** *Einstellungen → System → Plattform-Check* zeigt Installationsart, Datenordner, ffmpeg, Neustart, Update, Fernzugriff, Home Assistant, Eingangsordner, Sicherung und Zeitzone – und was fehlt, damit alles wie auf den anderen Plattformen läuft.

## Slicer

**Aus dem Slicer senden.** PrintDock gibt sich gegenüber dem Slicer als OctoPrint-Server aus. In OrcaSlicer, PrusaSlicer, SuperSlicer oder darauf aufbauenden Slicern (Snapmaker Orca, Anycubic Slicer Next):

1. Druckerprofil öffnen → *Physischen Drucker hinzufügen/bearbeiten*
2. Host-Typ **OctoPrint**
3. Adresse und API-Key aus *Einstellungen → Slicer* eintragen:
   - `http://<printdock>:3080/slicer` – nur in die Bibliothek
   - `http://<printdock>:3080/slicer/queue` – in die Warteschlange (passender Drucker)
   - `http://<printdock>:3080/slicer/<Drucker-ID>` – in die Warteschlange eines bestimmten Druckers
4. *Test* drücken. Danach landet „Hochladen“ bzw. „Hochladen und drucken“ direkt in PrintDock (letzteres ganz oben in der Warteschlange).

**Bambu Studio** kann Bambu-Drucker nicht über OctoPrint ansprechen. Dafür gibt es den **Eingangsordner**: Platte slicen, *Geslicte Platte exportieren* (Strg+G) und in den Ordner speichern – als Add-on `\\homeassistant\share\printdock` (Samba-Add-on nötig), der Unterordner `warteschlange` legt die Datei gleich in die Warteschlange. Pfade stehen unter *Einstellungen → Slicer*.

**Im Slicer öffnen.** Bei jeder Datei öffnet „Öffnen in …“ den Slicer auf dem eigenen Rechner (`orcaslicer://`, `bambustudio://`, `prusaslicer://`). Weitere Slicer lassen sich mit ihrem Link-Schema ergänzen.

## Wartungsplan

Aufgaben je Drucker mit Intervall in **Betriebsstunden**, **Drucken** oder **Tagen**. Stunden und Drucke zählt PrintDock aus dem Verlauf; Stunden aus der Zeit vor PrintDock trägt man beim Drucker ein. „Vorschläge übernehmen“ legt übliche Aufgaben an (Platte reinigen, Düse, Führungen, Riemen, Lüfter/Filter, Firmware) – allgemeine Richtwerte, bitte mit der Anleitung des Druckers abgleichen. Wird eine Aufgabe fällig, kommt einmalig eine Benachrichtigung.

## Kamera

PrintDock holt die Bilder auf dem Server und reicht sie an den Browser weiter. Dadurch funktionieren auch Kameras, die ein Browser nicht direkt anzeigen kann, und Zugangsdaten bleiben auf dem Server. Die Kamera läuft nur, solange jemand zuschaut (plus 30 Sekunden).

| Drucker | Protokoll | Hinweis |
|---|---|---|
| Bambu X1, H2D, H2S, X2D | RTSPS (Port 322) | Am Drucker „LAN-Liveview“ aktivieren. Braucht `ffmpeg`. |
| Bambu P1, A1 | JPEG-Stream (Port 6000) | Läuft ohne Zusatzsoftware. |
| Anycubic (LAN-Modus) | über den Drucker | Kamera am Drucker einschalten. |
| Klipper / Moonraker | Snapshot-URL | Wird automatisch aus Moonraker gelesen, sonst im Drucker-Dialog eintragen. |
| OctoPrint | Snapshot-URL | Standard `/webcam/?action=snapshot`, anpassbar. |

`ffmpeg` ist im Docker-Image und im Add-on enthalten. Sonst: Windows `winget install ffmpeg`, macOS `brew install ffmpeg`, Linux über die Paketverwaltung. Endpunkte: `/api/printers/:id/camera.jpg` (Einzelbild) und `/api/printers/:id/camera.mjpg` (Livebild).

## Benachrichtigungen

Unter **Benachrichtigungen** beliebig viele Kanäle anlegen und je Kanal wählen, welche Ereignisse gemeldet werden. Mit „Test senden“ prüfen, ob alles ankommt.

| Ereignis | Wann |
|---|---|
| Druck fertig / Gestartet / Pausiert / Abgebrochen | mit Dauer bzw. voraussichtlicher Endzeit |
| Fehler | Drucker meldet einen Fehler oder Klipper fällt aus |
| Nicht erreichbar | Drucker seit 2 Minuten ohne Verbindung |
| Erste Schicht | Foto nach der ersten Schicht (Option) |
| Wartung fällig | Eine Wartungsaufgabe hat ihr Intervall erreicht |
| Spule wird knapp / Filament zu feucht / Trocknen fertig | Filament |
| Notaus | Alarm aus Home Assistant, Drucker abgeschaltet |
| Update verfügbar | neue PrintDock-Version |

| Kanal | Bild | Einrichtung |
|---|---|---|
| ntfy | ja | App installieren, Thema abonnieren, gleiches Thema hier eintragen. Eigener Server möglich. |
| Telegram | ja | Bot über @BotFather anlegen, Token und Chat-ID eintragen. |
| Discord | ja | Webhook-URL des Kanals eintragen. |
| Gotify | nein | Server-URL und App-Token. |
| Webhook | ja (Base64) | JSON per POST, z. B. an Home Assistant oder Node-RED. |

Nach einem Neustart meldet PrintDock nur echte Zustandswechsel. Dasselbe Ereignis wird pro Drucker höchstens einmal pro Minute verschickt.

## Demo-Daten

**Einstellungen → Demo-Daten → Demo-Daten einspielen** legt einen kompletten, laufenden Druckerpark an: Bambu X2D mit AMS (druckt), Snapmaker U1 mit 4 Werkzeugen (druckt), Anycubic Kobra S1 mit ACE (fertig), Voron 2.4 (bereit) und Bambu A1 (pausiert), dazu Dateien mit Vorschaubildern, 20 Spulen, Aufträge, Warteschlange, 30 Tage Verlauf und Wartungsaufgaben. Alles ist als Demo markiert und lässt sich mit einem Klick wieder entfernen – eigene Daten bleiben unberührt.

## Einen neuen Drucker-Treiber schreiben

Jeder Hersteller ist ein Treiber in `drivers/`. Ein Treiber:

1. erbt von `BaseDriver` (`drivers/base.js`),
2. beschreibt in `static meta` seine Einstellungsfelder – daraus baut die Oberfläche das Formular,
3. meldet seinen Zustand mit `this.update({...})` im gemeinsamen Statusformat (dokumentiert in `base.js`),
4. setzt optional `command(cmd)` (pause, resume, cancel, light, speed), `startPrint(job)` und `cameraSource()` um,
5. wird in `drivers/index.js` eingetragen.

Benachrichtigungen, Kamera-Großansicht, Verlauf, Warteschlange und Filament funktionieren dann automatisch. `drivers/demo.js` ist die kürzeste Vorlage.

## Aufbau

```
server.js              HTTP-Server, REST-API, Live-Updates (SSE), Verlauf, laufende Jobs
launcher.js            Start im Docker-Image (nimmt eine per Update geladene neuere Version)
camera.js              Kamera-Proxy: HTTP-Snapshots, RTSP über ffmpeg, Bambu-JPEG-Stream
notify.js              Ereigniserkennung und Benachrichtigungskanäle
drivers/               moonraker.js, anycubic.js, bambu.js, octoprint.js, demo.js, base.js
lib/
  app.js               Sprache, Akzentfarbe, Module, Menü, Login, Benutzer
  production.js        Aufträge, Warteschlange, Druckstart, Druckart, Wartungsplan
  startrules.js        Startzeitfenster, günstiger Strom
  failures.js          Fehldrucke, neu einreihen
  filament.js          Spulen, Plätze, Abbuchung, Verbrauch, RFID
  reserve.js, shop.js  Reservierung, Einkaufsliste, Bestellungen
  drying.js, humcheck.js  Feuchte, Trocknen, Feuchte-Check vor dem Start
  stations.js, tags.js PrintDock Station, Tag-Formate
  spoolman.js          Spoolman-Abgleich
  homeassistant.js     Steckdosen, MQTT-Discovery, Karten, Vorlagen
  emergency.js         Notaus
  energy.js, costs.js  Strom und Kosten
  statuspage.js        Kunden-Statusseite (Daten)
  statusrender.js      Kunden-Statusseite (HTML, auch vom Status-Server genutzt)
  relay.js             Abgleich mit dem Status-Server
  storage.js           Speicherort (Datenordner, SMB, eingehängter Ordner) für Druckdateien, Fotos, Sicherungen
  smb.js               SMB-Freigabe direkt über smbclient
  archive.js           Archiv: Fremddrucke erkennen, Datei vom Drucker holen, Auftrag zuordnen, Suche, CSV
  remote.js            Fernzugriff: Tailscale, Cloudflare Tunnel
  audit.js             Protokoll
  platform.js, env.js, hostinfo.js  Plattform-Check, Umgebung
  updater.js           Updates
  backup.js, autobackup.js  Sicherung
  files.js, zip.js, inbox.js, slicer.js  Dateibibliothek, 3MF, Eingangsordner, Slicer
  stats.js, i18n.js, store.js, …
public/                Oberfläche ohne Build-Schritt (app.js, board.js, today-ui.js, *-ui.js, i18n.js, i18n-en.js)
dist/printdock-card.js Home-Assistant-Karten
blueprints/            Home-Assistant-Automationsvorlagen
relay/                 Status-Server für Kunden-Links (php/, server.js, Docker)
scripts/               install.sh, start-windows.cmd, station-sim.js, check.js, build-ha-addon.js
ha-addon/              Home-Assistant-Add-on (config.yaml, Dockerfile, CHANGELOG.md)
docs/                  Installation, Erste Schritte, Fernzugriff, Screenshots
.github/               Vorlagen für Fehlerberichte und Wünsche
data/                  JSON-Dateien, Druckdateien, Fotos (wird angelegt)
```

### API

Alle Endpunkte unter `/api/`. Mit Login-Schutz per Sitzung oder API-Key (*Einstellungen → System*). Änderungen gehen live per SSE an alle offenen Oberflächen.

| Methode | Pfad | Zweck |
|---|---|---|
| GET / POST | `/api/printers` | Drucker mit Status / anlegen `{name, driver, config}` |
| PUT / DELETE | `/api/printers/:id` | Drucker ändern / entfernen |
| POST | `/api/printers/:id/command` | `{cmd: "pause" \| "resume" \| "cancel" \| "light" \| "speed", …}` |
| POST | `/api/printers/:id/plate-clear` | Druckplatte als frei bestätigen |
| POST | `/api/printers/:id/power` | Steckdose über Home Assistant `{on}` |
| GET | `/api/printers/:id/camera.jpg`, `…/camera.mjpg` | Kamerabild / Livebild |
| GET / DELETE | `/api/history` | Verlauf lesen / leeren |
| GET | `/api/archive?q&from&to&printer&result&source&order&offset&limit` | Archiv mit Filtern, Summen und Seiten; `/api/archive/export.csv` als CSV |
| GET / POST | `/api/archive/:id/candidates`, `/api/archive/:id/{assign,reprint}` | Passende Aufträge, zuordnen `{orderId, positionId} \| {none: true} \| {orderId: null}`, nochmal einplanen |
| GET / PUT | `/api/storage`, POST `/api/storage/test`, `/api/storage/sync` | Speicherort lesen / übernehmen `{mode: "local" \| "smb" \| "folder", smb: {server, share, dir, user, password, domain}, path, files, photos, backups}`, Verbindung prüfen, Zwischengespeichertes nachziehen |
| POST | `/api/orders/:id/use-file` | Neue Dateiversion übernehmen `{from, to}` |
| POST | `/api/history/:id/{fail,unfail,requeue,dismiss}` | Fehldruck werten, zurücknehmen, neu einreihen, „passt so“ |
| GET / POST | `/api/files` | Bibliothek / hochladen (Rohdaten, Name im Header `X-Filename`) |
| POST | `/api/files/:id/assign` | Datei einem Teil zuordnen `{partId \| partName, targets: [printerId]}` (leere targets = nach Druckermodell) |
| GET / POST / PUT / DELETE | `/api/parts`, `/api/parts/:id` | Teile mit Varianten und Abdeckung je Drucker / anlegen `{name}` / umbenennen / löschen (Dateien bleiben) |
| GET / POST | `/api/queue` | Warteschlange / einplanen `{fileId \| partId, printerId?, areaId?, count, mode?, options}` – `partId` plant ein Teil ein (Variante je Drucker), `areaId` beschränkt die Druckerwahl auf einen Bereich |
| PUT / DELETE | `/api/queue/:id` | Eintrag ändern / entfernen |
| POST | `/api/queue/:id/{start,requeue,resolve,humcheck,dry-start,dry-cancel}` | Starten, neu einreihen, hängenden Eintrag abschließen `{result}`, Feuchte prüfen, erst trocknen |
| POST | `/api/queue/reorder`, `/api/queue/clear-finished` | Sortieren / Erledigte entfernen |
| GET / POST | `/api/orders` | Aufträge (mit `shareUrl`) / anlegen, optional `areaId` |
| PUT / DELETE | `/api/orders/:id` | Auftrag ändern / löschen |
| POST | `/api/orders/:id/{plan,mode,post,share,archive}` | Einplanen, Druckart `{mode: "auto" \| "manual" \| "single"}`, Nachbearbeitung, Statuslink, archivieren |
| GET | `/api/maintenance` | Wartungsaufgaben, Betriebsstunden, Protokoll |
| GET | `/api/filament` | Spulen, Plätze, Verbrauch, Reservierungen |
| POST | `/api/filament/{assign,from-slot,dry}` | Spule zuordnen, aus Platz anlegen, trocknen |
| GET | `/api/filament/{check,mapping,humcheck,reservations}` | Reicht das Filament? Farbzuordnung, Feuchte-Check, Reservierungen |
| GET / POST | `/api/filament/shop`, `…/shop/order`, `…/shop/order/:id/arrived` | Einkaufsliste, bestellt, angekommen |
| POST / PUT / DELETE | `/api/filament/dryers`, `/api/filament/hum-sources` | Trockner, Feuchte-Messstellen |
| POST / PUT / DELETE | `/api/spools`, `/api/spools/:id` | Spulen; `…/weigh`, `…/book`, `…/dried` |
| POST | `/api/rfid`, `/api/rfid/phone` | Tag von ESPHome-Leser / vom Handy |
| GET / PUT / DELETE | `/api/stations`, `/api/stations/:id` | Stationen |
| POST | `/api/stations/pair`, `/api/stations/:id/{tare,calibrate,identify,weigh,write,undo}` | Koppeln, Tara, Kalibrieren, Finden, Wiegen, Tag beschreiben, letzte Wiegung zurücknehmen |
| WS | `/api/station/ws` | Verbindung der Station |
| GET / PUT | `/api/ha` | Home-Assistant-Einstellungen; `…/test`, `…/entities`, `…/blueprints`, `…/emergency` |
| GET / PUT | `/api/remote` | Fernzugriff (Tailscale, Cloudflare) |
| GET / PUT | `/api/relay`, POST `/api/relay/test` | Status-Server für Kunden-Links |
| GET / POST / PUT / DELETE | `/api/users`, `/api/users/:id` | Benutzer |
| GET | `/api/audit`, `/api/platform` | Protokoll, Plattform-Check |
| GET | `/api/summary`, `/api/stats?days=30` | Kennzahlen (inkl. `startInfo` je Drucker), Statistik |
| GET / PUT | `/api/app` | Sprache, Akzentfarbe, Module, Menü, Login-Schutz, Bereiche `{areas: [{id, name}]}` |
| POST | `/api/login`, `/api/logout` | Anmelden / abmelden |
| GET | `/api/events` | Live-Stream (SSE) |
| GET | `/status/<code>` | Kunden-Statusseite (ohne Anmeldung) |

## Mitmachen

Neue Drucker, Übersetzungen und Fehlerberichte sind willkommen – Fehlerberichte bitte über die [Issue-Vorlage](https://github.com/Codegulasch/printdock/issues/new/choose) mit Version und Plattform-Check. Vor einem Pull Request `npm run check` ausführen.
Deutsche Texte sind die Schlüssel, `public/i18n-en.js` übersetzt sie ins Englische. Neue Sprache: die Datei kopieren (z. B. `i18n-fr.js`), übersetzen, in `index.html` laden und mit `PD_I18N.register('fr', …)` anmelden. `npm run check` meldet fehlende Übersetzungen.

## Geplant

- ACE- und U1-RFID-Daten direkt auslesen, sobald die Firmware sie bereitstellt
- Drucker vor dem Start aus der Warteschlange automatisch einschalten (Home Assistant)
- Ruhezeiten für Benachrichtigungen, E-Mail

## Lizenz

MIT
