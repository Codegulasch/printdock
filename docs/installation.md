# Installation

*English below.*

PrintDock läuft überall, wo Node.js 18+ oder Docker läuft. Daten liegen als JSON-Dateien in einem Ordner – keine Datenbank. Beim ersten Öffnen führt ein **Einrichtungsassistent** durch Sprache, Aussehen, Funktionen und Zugang.

| Plattform | Empfohlener Weg |
|---|---|
| Synology, QNAP, Unraid, TrueNAS, Server | [Docker](#docker-nas-server) |
| Raspberry Pi 3/4/5 | [Docker](#docker-nas-server) oder [Installationsskript](#raspberry-pi-ohne-docker) |
| Home Assistant OS / Supervised | [Add-on](#home-assistant-add-on) |
| Windows, macOS, Linux-PC | [Node.js](#nodejs-windows-macos-linux) |

Fertige Images: `ghcr.io/codegulasch/printdock` für **amd64**, **arm64** und **armv7**.

## Docker (NAS, Server)

```bash
mkdir printdock && cd printdock
curl -O https://raw.githubusercontent.com/Codegulasch/printdock/main/docker-compose.yml
docker compose up -d
```

Dann `http://<ip>:3080` öffnen. Daten liegen in `./data`.

Wichtig ist `network_mode: host` (steht schon in der Datei): PrintDock muss die Drucker im Heimnetz direkt erreichen (Bambu-MQTT, Kamera-Streams).

**Synology (Container Manager):** Ordner `docker/printdock` anlegen → *Container Manager → Projekt → Erstellen* → Pfad wählen, Inhalt der `docker-compose.yml` einfügen → *Fertig*.
**QNAP (Container Station):** *Anwendungen → Erstellen* → YAML einfügen.
**Unraid:** Plugin *Compose Manager* → neuen Stack anlegen → YAML einfügen. Alternativ *Docker → Add Container*: Repository `ghcr.io/codegulasch/printdock:latest`, Network Type `host`, Pfad `/data` → `/mnt/user/appdata/printdock`.
**TrueNAS SCALE:** *Apps → Discover → Custom App* → Image `ghcr.io/codegulasch/printdock`, Host-Netzwerk an, Speicher `/data`.

Aktualisieren: `docker compose pull && docker compose up -d`.

Ohne `docker compose`:
```bash
docker run -d --name printdock --restart unless-stopped --network host \
  -e TZ=Europe/Berlin -v "$PWD/data:/data" ghcr.io/codegulasch/printdock:latest
```

## Raspberry Pi ohne Docker

Für Raspberry Pi OS (Bookworm, 32 oder 64 Bit), Debian und Ubuntu:

```bash
curl -fsSL https://raw.githubusercontent.com/Codegulasch/printdock/main/scripts/install.sh | sudo bash
```

Das Skript installiert Node.js und ffmpeg, legt PrintDock nach `/opt/printdock`, die Daten nach `/var/lib/printdock` und richtet den Dienst `printdock` ein (startet mit dem Pi). Zum Aktualisieren denselben Befehl noch einmal ausführen.

```bash
systemctl status printdock     # läuft er?
journalctl -u printdock -f     # Protokoll
```

Ein Pi 3 reicht für mehrere Drucker. Für RTSP-Kameras (Bambu X1/H2D/X2D) ist ein Pi 4 oder 5 angenehmer, weil ffmpeg das Bild umrechnet.

## Home Assistant Add-on

1. *Einstellungen → Add-ons → Add-on-Store → ⋮ → Repositories* → `https://github.com/Codegulasch/printdock` hinzufügen.
2. **PrintDock** installieren, starten, *In Seitenleiste anzeigen* einschalten.

Home Assistant und der Mosquitto-Broker werden automatisch verbunden. Läuft auf amd64, aarch64 (Pi 4/5, Green, Yellow) und armv7.

## Node.js (Windows, macOS, Linux)

Node.js 18 oder neuer von [nodejs.org](https://nodejs.org), dann:

```bash
git clone https://github.com/Codegulasch/printdock.git
cd printdock
npm install
npm start
```

Für Bambu-Kameras mit RTSP zusätzlich ffmpeg: Windows `winget install ffmpeg`, macOS `brew install ffmpeg`.

**Windows:** statt `npm start` besser `scripts\start-windows.cmd` doppelklicken – dann startet PrintDock nach einem Update aus der Oberfläche oder dem Einspielen einer Sicherung von selbst neu. Fernzugriff: Cloudflare Tunnel lädt PrintDock selbst, für Tailscale die Tailscale-App installieren und anmelden.

Was auf welcher Installation geht, zeigt *Einstellungen → System → Plattform-Check*. In Docker funktioniert das Update aus PrintDock ab 0.16 ebenfalls (die neue Version liegt im Datenordner; ein neueres Image per `docker compose pull` hat wieder Vorrang).

## Einstellungen über Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3080` | Port der Weboberfläche |
| `DATA_DIR` | `./data` (Docker: `/data`) | Datenordner |
| `PRINTDOCK_LANG` | `de` | Sprache beim ersten Start (`de`, `en`) |
| `TZ` | – | Zeitzone für Uhrzeiten in Meldungen |
| `FFMPEG_PATH` | `ffmpeg` | Pfad zu ffmpeg |

## Datensicherung

Den Datenordner sichern (`./data`, `/var/lib/printdock` bzw. Add-on-Backup). Er enthält Einstellungen, Drucker, Verlauf, Spulen und hochgeladene Dateien.

---

## English

PrintDock runs anywhere Node.js 18+ or Docker runs. Data is stored as JSON files in one folder – no database. On first open, a **setup wizard** asks for language, look, features and access.

| Platform | Recommended |
|---|---|
| Synology, QNAP, Unraid, TrueNAS, servers | Docker |
| Raspberry Pi 3/4/5 | Docker or the install script |
| Home Assistant OS / Supervised | Add-on |
| Windows, macOS, Linux desktop | Node.js |

**Docker:** download `docker-compose.yml` and run `docker compose up -d`, then open `http://<ip>:3080`. Keep `network_mode: host` so PrintDock can reach your printers directly. Images: `ghcr.io/codegulasch/printdock` (amd64, arm64, armv7). Update with `docker compose pull && docker compose up -d`.

**Raspberry Pi without Docker:** `curl -fsSL https://raw.githubusercontent.com/Codegulasch/printdock/main/scripts/install.sh | sudo bash` installs Node.js and ffmpeg, puts PrintDock into `/opt/printdock`, data into `/var/lib/printdock` and creates the `printdock` systemd service. Run it again to update.

**Home Assistant add-on:** add `https://github.com/Codegulasch/printdock` as an add-on repository, install **PrintDock**, start it and enable *Show in sidebar*.

**Node.js:** `git clone`, `npm install`, `npm start`. Install ffmpeg for Bambu RTSP cameras.

Environment variables: `PORT`, `DATA_DIR`, `PRINTDOCK_LANG` (`de`/`en`, first start only), `TZ`, `FFMPEG_PATH`. Back up the data folder.
