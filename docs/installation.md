# Installation

*English · [Deutsch](installation.de.md)*

PrintDock runs anywhere Node.js 18+ or Docker runs. Data is stored as JSON files in one folder – no database. On first open, a **setup wizard** walks you through language, appearance, features and access.

> PrintDock is in **public beta** – keep backups and please report problems via [GitHub issues](https://github.com/Codegulasch/printdock/issues/new/choose).

| Platform | Recommended |
|---|---|
| Synology, QNAP, Unraid, TrueNAS, servers | [Docker](#docker-nas-server) |
| Raspberry Pi 3/4/5 | [Docker](#docker-nas-server) or the [install script](#raspberry-pi-without-docker) |
| Home Assistant OS / Supervised | [Add-on](#home-assistant-add-on) |
| Windows, macOS, Linux desktop | [Node.js](#nodejs-windows-macos-linux) |

Ready-made images: `ghcr.io/codegulasch/printdock` for **amd64**, **arm64** and **armv7**.

Afterwards, continue with [Getting started](getting-started.md).

## Docker (NAS, server)

```bash
mkdir printdock && cd printdock
curl -O https://raw.githubusercontent.com/Codegulasch/printdock/main/docker-compose.yml
docker compose up -d
```

Then open `http://<ip>:3080`. Data is stored in `./data`.

Keep `network_mode: host` (already in the file): PrintDock needs to reach your printers on the home network directly (Bambu MQTT, camera streams).

**Synology (Container Manager):** create the folder `docker/printdock` → *Container Manager → Project → Create* → choose the path, paste the contents of `docker-compose.yml` → *Done*.
**QNAP (Container Station):** *Applications → Create* → paste the YAML.
**Unraid:** plugin *Compose Manager* → add a new stack → paste the YAML. Or *Docker → Add Container*: repository `ghcr.io/codegulasch/printdock:latest`, network type `host`, path `/data` → `/mnt/user/appdata/printdock`.
**TrueNAS SCALE:** *Apps → Discover → Custom App* → image `ghcr.io/codegulasch/printdock`, host network on, storage `/data`.

Update: `docker compose pull && docker compose up -d`.

Without `docker compose`:
```bash
docker run -d --name printdock --restart unless-stopped --network host \
  -e TZ=Europe/Berlin -v "$PWD/data:/data" ghcr.io/codegulasch/printdock:latest
```

## Raspberry Pi without Docker

For Raspberry Pi OS (Bookworm, 32 or 64 bit), Debian and Ubuntu:

```bash
curl -fsSL https://raw.githubusercontent.com/Codegulasch/printdock/main/scripts/install.sh | sudo bash
```

The script installs Node.js and ffmpeg, puts PrintDock into `/opt/printdock` and its data into `/var/lib/printdock`, and sets up the `printdock` service (starts with the Pi). To update, run the same command again.

```bash
systemctl status printdock     # is it running?
journalctl -u printdock -f     # log
```

A Pi 3 is enough for several printers. For RTSP cameras (Bambu X1/H2D/X2D) a Pi 4 or 5 is more comfortable, because ffmpeg converts the video.

## Home Assistant add-on

1. *Settings → Add-ons → Add-on Store → ⋮ → Repositories* → add `https://github.com/Codegulasch/printdock`.
2. Install and start **PrintDock**, enable *Show in sidebar*.

Home Assistant and the Mosquitto broker are connected automatically. Runs on amd64, aarch64 (Pi 4/5, Green, Yellow) and armv7.

## Node.js (Windows, macOS, Linux)

Install Node.js 18 or newer from [nodejs.org](https://nodejs.org), then:

```bash
git clone https://github.com/Codegulasch/printdock.git
cd printdock
npm install
npm start
```

For Bambu cameras with RTSP you also need ffmpeg: Windows `winget install ffmpeg`, macOS `brew install ffmpeg`.

**Windows:** instead of `npm start`, double-click `scripts\start-windows.cmd` – PrintDock then restarts by itself after an update from the interface or after restoring a backup. Remote access: PrintDock downloads Cloudflare Tunnel by itself; for Tailscale, install the Tailscale app and sign in (see [Remote access](remote-access.md)).

## Updates and platform check

*Settings → System → Platform check* shows what works on your installation. Updates are under *Settings → System → Updates* – in Docker too (since 0.16). The new version is then stored in the data folder; a newer image pulled with `docker compose pull` takes precedence again.

## Settings via environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3080` | Port of the web interface |
| `DATA_DIR` | `./data` (Docker: `/data`) | Data folder |
| `PRINTDOCK_LANG` | `de` | Language on first start (`de`, `en`) |
| `TZ` | – | Time zone for times in notifications |
| `FFMPEG_PATH` | `ffmpeg` | Path to ffmpeg |

## Backup

Back up the data folder (`./data`, `/var/lib/printdock`, or the add-on backup). It contains settings, printers, history, spools and uploaded files. You can also download a backup file in PrintDock under *Settings → System → Backup*.
