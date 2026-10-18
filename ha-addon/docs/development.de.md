# PrintDock für Entwickler

*[English](development.md) · Deutsch*

Diese Seite ist für alle, die an PrintDock mitarbeiten, einen Drucker-Treiber schreiben oder PrintDock aus eigenen Skripten ansprechen wollen. Für die Bedienung reicht das [README](../README.de.md).

## Starten aus dem Quellcode

```bash
git clone https://github.com/Codegulasch/printdock.git
cd printdock
npm install
npm start                 # http://localhost:3080
npm run check             # Syntax, Übersetzungen, Server-Rundlauf – vor jedem Pull Request
```

Nützliche Umgebungsvariablen: `PORT` (Standard 3080), `DATA_DIR` (Datenordner, Standard `./data`), `TZ` (Zeitzone), `INBOX_DIR` und `BACKUP_DIR` (Eingangsordner, Sicherungen).

Eine PrintDock Station ohne Hardware simuliert `node scripts/station-sim.js [ws://localhost:3080/api/station/ws]` – die Station meldet sich dann mit Kopplungscode in PrintDock. Für Tests ohne Drucker gibt es den Treiber *Demo* bzw. die Demo-Daten (*Einstellungen → System → Einrichtung*).

## Einen Drucker-Treiber schreiben

Jeder Hersteller ist ein Treiber in `drivers/`. Ein Treiber:

1. erbt von `BaseDriver` (`drivers/base.js`),
2. beschreibt in `static meta` seine Einstellungsfelder – daraus baut die Oberfläche das Formular,
3. meldet seinen Zustand mit `this.update({...})` im gemeinsamen Statusformat (dokumentiert in `base.js`),
4. setzt optional `command(cmd)` (pause, resume, cancel, light, speed), `startPrint(job)` und `cameraSource()` um,
5. wird in `drivers/index.js` eingetragen.

Benachrichtigungen, Kamera-Großansicht, Verlauf, Warteschlange und Filament funktionieren dann automatisch. `drivers/demo.js` ist die kürzeste Vorlage.

## Übersetzungen

Deutsche Texte sind die Schlüssel, `public/i18n-en.js` übersetzt sie ins Englische. Neue Sprache: die Datei kopieren (z. B. `i18n-fr.js`), übersetzen, in `index.html` laden und mit `PD_I18N.register('fr', …)` anmelden. `npm run check` meldet fehlende Übersetzungen.

## Aufbau des Projekts

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
  parts.js             Teile mit Varianten
  reslice.js           Umslicen: Profile lernen, Aufträge für den Helfer
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
helper/                Umslice-Helfer für den PC (OrcaSlicer, wird in GitHub Actions zu Programmdateien gebaut)
```

## API

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
| PUT | `/api/printers/:id/area` | Drucker einem Bereich zuordnen `{area}` |
| GET | `/api/reslice`, `/api/reslice/plan?part&printer` | Umslicen: Helfer, gelernte Profile, Aufträge / Infos für den Dialog |
| POST / DELETE | `/api/reslice/jobs`, `/api/reslice/jobs/:id`, POST `…/retry` | Auftrag zum Umslicen `{partId, printerId, sourceFileId?, plate?, materials?}` / entfernen / nochmal |
| DELETE / POST | `/api/reslice/profiles/:printerId`, `/api/reslice/token` | Gelerntes Profil vergessen, neuer Kopplungscode |
| GET / POST | `/helper/{hello,poll,jobs/:id/source,jobs/:id/result,jobs/:id/fail}` | Schnittstelle für den Umslice-Helfer (Kopplungscode als Bearer-Token, ohne Anmeldung) |
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
| POST / PUT / DELETE | `/api/spools`, `/api/spools/:id` | Spulen; `…/weigh`, `…/book`, `…/dried`, `…/store` |
| POST | `/api/rfid`, `/api/rfid/phone` | Tag von ESPHome-Leser `{tag, printer, slot}` / vom Handy |
| GET / PUT / DELETE | `/api/stations`, `/api/stations/:id` | Stationen |
| POST | `/api/stations/pair`, `/api/stations/:id/{tare,calibrate,identify,weigh,write,undo,arm}` | Koppeln, Tara, Kalibrieren, Finden, Wiegen, Tag beschreiben, letzte Wiegung zurücknehmen, zum Einlegen vormerken |
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

Neue Drucker, Übersetzungen und Fehlerberichte sind willkommen. Fehler bitte über die [Issue-Vorlage](https://github.com/Codegulasch/printdock/issues/new/choose) mit Version und Plattform-Check melden. Vor einem Pull Request `npm run check` ausführen.
