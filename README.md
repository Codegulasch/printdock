# PrintDock

*English · [Deutsch](README.de.md)*

**One dashboard for every 3D printer in the house – no matter the brand.**
Inspired by [BamBuddy](https://github.com/maziggy/bambuddy), but not limited to Bambu Lab: Bambu Lab, Snapmaker U1, Anycubic, Voron and any Klipper/Moonraker or OctoPrint printer.

![Printer overview](docs/screenshots/board-dark.png)

## Features

- **Live status** of all printers: progress, time left, ETA, layer, temperatures with history, fans, light, speed
- **Status lights** on every card: idle = glowing green, printing = blue running light, waiting = flashing yellow, fault = flashing red
- **Camera** for every printer (incl. Bambu RTSP and JPEG streams) with full-screen view and snapshot
- **Print queue** with mandatory *"build plate is clear"* confirmation and optional auto start per printer
- **Orders** (file × quantity, due date, priority, progress) – start the next print of an order with one click
- **File library**: G-code and 3MF with detected print time, filament, printer model and preview
- **Slicer integration**: send from OrcaSlicer, PrusaSlicer & co. (OctoPrint-compatible endpoint); from Bambu Studio via the inbox folder (*Export plate sliced file* into `\\homeassistant\share\printdock`, subfolder `warteschlange` = queue); open files in your slicer
- **Filament management** built in (no Spoolman needed): spools, remaining amounts, AMS/ACE/toolhead slots, RFID auto-assign, automatic deduction after every print, cost, low-stock warnings
- **Maintenance planner** by operating hours, prints or days
- **Statistics**: prints, success rate, print hours, material and cost, printers compared
- **Notifications** on finish, error, pause, offline, maintenance, low filament – with camera image – via ntfy, Telegram, Discord, Gotify or webhook
- **Home Assistant**: switch printers via smart plugs (with auto-off after cool-down), every printer as an MQTT device, runs as an add-on with sidebar entry
- **German and English** – interface, notifications and Home Assistant entities
- **Setup wizard** and **every feature can be switched off**
- **Selectable accent colour**, light and dark mode, works on phones
- **Runs anywhere**: Docker on NAS and Raspberry Pi (amd64, arm64, armv7), native installer for the Pi, Home Assistant add-on
- **Remote access** via Tailscale or Cloudflare Tunnel with optional login protection
- Fully local, no cloud, no account. Few dependencies, no database – data is plain JSON
- **Demo data** with one click: 5 simulated printers, files, spools, orders and 30 days of history

| Statistics | Setup wizard |
|---|---|
| ![Statistics](docs/screenshots/stats.png) | ![Setup](docs/screenshots/setup.png) |

## Installation

Details in [docs/installation.md](docs/installation.md).

```bash
# Docker (NAS, Raspberry Pi, server)
curl -O https://raw.githubusercontent.com/Codegulasch/printdock/main/docker-compose.yml
docker compose up -d

# Raspberry Pi / Debian without Docker (systemd service)
curl -fsSL https://raw.githubusercontent.com/Codegulasch/printdock/main/scripts/install.sh | sudo bash

# Node.js 18+ (Windows, macOS, Linux)
npm install && npm start
```

**Home Assistant:** *Settings → Add-ons → Add-on store → ⋮ → Repositories* → `https://github.com/Codegulasch/printdock` → install **PrintDock**.

Then open `http://<ip>:3080`. The setup wizard asks for language, look, features and access and can load demo data. Everything can be changed later under **Settings → General**.

**Assign colours at print start:** when starting from the queue, PrintDock suggests which slot or tool prints which filament of the slice by material and colour – every row can be changed. Bambu gets it as AMS mapping; on Klipper and OctoPrint printers PrintDock renumbers the tools in the G-code (e.g. T0 → T2).

**Costs, electricity and photos:** every print in the history shows its costs – filament by spool price, electricity (from a metering plug in Home Assistant, or estimated), optionally machine hours and markup. Orders show an estimate from the sliced files and the actual costs; *Print estimate / quote* creates a printable page. At the end of a print PrintDock saves a camera image of the finished part. Finished orders can be archived.

**Automatic printer choice:** queue entries without a fixed printer go to the free printer with auto-start whose profile the file was sliced for and that has the matching filament loaded. Files sliced for another profile are never started.

## Supported printers

| Connection | Printers | Requirements |
|---|---|---|
| **Klipper / Moonraker** | Snapmaker U1, Anycubic Kobra 3 / S1 (with [Rinkhals](https://github.com/rinkhals-community/Rinkhals)), Voron, rooted Creality K1/K2, any Klipper printer | Moonraker reachable (port 7125) |
| **Anycubic (LAN mode)** | Kobra S1 / S1 Max, Kobra 3 / 3 Max, Kobra 2 Pro with stock firmware, incl. ACE Pro | LAN mode enabled on the printer; IP address |
| **Bambu Lab (LAN)** | X1, P1, A1, H2D, X2D | LAN mode (newer firmware: developer mode); IP, serial number, access code |
| **OctoPrint** | Any Marlin printer with OctoPrint | API key |
| **Demo** | – | Simulated printer to try things out |

Notes:
- **Snapmaker U1** – Moonraker is enabled out of the box; add it as *Klipper / Moonraker*.
- **Anycubic Kobra S1 / Kobra 3** – with the stock firmware, enable *LAN mode* on the printer and add it as *Anycubic (LAN mode)*: status, pause/resume/cancel, light, camera, ACE slots (material and colour) and ACE drying. To start prints, install Rinkhals and also enter its Moonraker port (usually 7125): status, ACE and drying stay on LAN mode, prints go through Moonraker. Without Rinkhals, start prints on the printer or from the slicer. With the community firmware Rinkhals you can use *Klipper / Moonraker* instead. The LAN protocol follows [anycubic-lan](https://github.com/Nino6689/anycubic-lan).
- **Bambu Lab** – enable LAN mode; the access code is in the network menu. Starting prints and the second nozzle of H2D/X2D are **experimental** – feedback from real devices is welcome.

## Status lights

| Light | Meaning |
|---|---|
| 🟢 green, glowing | **Idle** – ready for the next print |
| 🔵 blue, running | **Printing** (also preparing / sending a file) |
| 🟡 yellow, flashing | **Waiting** – paused, or the plate needs clearing |
| 🔴 red, flashing | **Fault** |
| ⚪ grey | Unreachable |

The colours are fixed and independent of the accent colour; every light also shows the state as text.

## How a print flows through PrintDock

```
Slicer ──"Send to printer"──┐
Upload (Files) ─────────────┴─> File library
                                   │
Order (file × quantity) ───────────┤ "Schedule"
                                   ▼
                     Queue ──Start (confirm plate clear) / Auto start──> printing
                       ▲                                                   │
          "Plate is clear" confirmed  <──────── print finished ────────────┘
                                         (history, order progress, filament deducted,
                                          maintenance hours counted)
```

## Remote access and security

On your home network PrintDock runs without login. For access from outside, enable **login protection** under **Settings → General** and use one of the options in [docs/remote-access.md](docs/remote-access.md):

- **Tailscale** – private VPN, nothing public: `docker compose --profile tailscale up -d`
- **Cloudflare Tunnel** – your own HTTPS address: `docker compose --profile cloudflare up -d`
- **Home Assistant** – the add-on is available wherever Home Assistant is

Passwords are stored with scrypt, sessions use HttpOnly cookies, 5 wrong attempts lock for a minute. Never forward port 3080 directly on your router.

## Filament: Spoolman, humidity, labels, RFID

- **PrintDock Station (new in 0.9):** an ESP32 with NFC reader (PN532), scale (HX711) and small display, with its own firmware: [printdock-station](https://github.com/Codegulasch/printdock-station). Put a spool on it → PrintDock recognises it (tag UID, spool link, OpenSpool or Anycubic data), books the remaining amount by weight (learns the empty spool weight from a new, full spool) and remembers it for 3 minutes: the next slot that reports a newly loaded spool gets it, and on Bambu printers material and colour are sent to the AMS slot. Blank tags can be written from the spool sheet in four formats (PrintDock + OpenSpool, OpenSpool, link only, Anycubic ACE) – at the station or with the phone. Pairing with a six-digit code under *Settings → PrintDock Station*; no hardware yet? `node scripts/station-sim.js` simulates one.

- **Spoolman (optional):** *Settings → Printers & filament → Filament* takes the spool inventory from Spoolman and reports usage, weighed remaining amounts and the current printer/slot back. Spools created in PrintDock can also be added to Spoolman. If Spoolman is briefly unavailable, PrintDock catches up.
- **Filament humidity:** AMS and ACE units that measure humidity are monitored automatically. Units without a measurement, printers and dry boxes/storage places get a sensor under *Settings → Printers & filament → Humidity & drying*: any Home Assistant humidity sensor (e.g. a Zigbee or Bluetooth thermometer in the box) or a PrintDock Station with a humidity sensor (SHT31/SHT40/AHT20/HTU21D – also as a sensor-only device). Warning and alarm thresholds are shown on the printer cards (badge and unit), in the header, on the Home Assistant card and under *Filament → Humidity & drying*; "Filament too humid" notification names the affected spools (for a dry box: all spools with that storage place), plus 48 h history and a drying date per spool.
- **Drying at the push of a button** (*Filament → Humidity & drying*): Bambu AMS 2 Pro (45–65 °C) and AMS HT (45–85 °C) directly via MQTT (LAN mode with developer mode), Anycubic ACE Pro directly in LAN mode; Klipper/Moonraker printers via a G-code macro (template for the ACE Pro with the Klipper ACE driver); everything else via Home Assistant – a dry box on a smart plug (on, off when done) or a dryer with its own integration (start/stop button plus number entities for temperature and duration, e.g. the Anycubic integration for the ACE). Suggested temperature and time from the spools in the unit (the most sensitive one sets the temperature, capped at the device limit); "Drying finished" notification and drying date on the spools.
- **Spool labels:** with QR code in 62 × 29 mm (Brother QL), 50 × 30, 40 × 30, 57 × 25 mm or as an A4 sheet. Scanning opens the spool with quick actions.
- **RFID/NFC:** write the spool link to an NFC sticker from the phone (Chrome on Android) – for readers use the PrintDock Station. Existing ESPHome readers keep working through the API `POST /api/rfid` with `{"tag": "…", "printer": "…", "slot": "…"}`.

## Updates

*Settings → System → Updates* checks GitHub for a new version (also automatically every 6 hours) and installs it with one click: as an add-on Home Assistant rebuilds PrintDock, on PC and Raspberry Pi PrintDock replaces its files and restarts. For a private repository enter a read-only GitHub token under “Update source”. Docker: `docker compose pull && docker compose up -d`.

## Backup and moving

*Settings → System → Backup* downloads a single `.zip` with everything: settings, printers, queue, orders, spools, maintenance, history and print files. Restore it on the same page or directly in the setup wizard of a fresh installation (e.g. a new Home Assistant). PrintDock restarts by itself as add-on, Docker container or systemd service; otherwise restart it manually. The previous state is kept in `before-restore-…` inside the data folder. As an add-on, PrintDock is also part of every Home Assistant backup.

## Home Assistant

- **Power switching:** enter a switchable entity (`switch.…`, `light.…`, `input_boolean.…`) per printer; an on/off button appears on the card. Optional auto-off once the print is done and the nozzle has cooled down.
- **MQTT discovery:** every printer becomes a device with status, progress, time left, finish time, file, layer, temperatures, connectivity, "clear plate", buttons (pause, resume, cancel, plate is clear), light switch, speed select and camera image – plus a PrintDock device with queue, active printers, overdue orders, low spools and due maintenance.
- **Dashboard cards:** `custom:printdock-card` (one printer with camera, temperatures, filament and controls) and `custom:printdock-overview-card` (all printers, queue, orders, low spools, maintenance). Both have a visual editor. Installed automatically with the add-on; otherwise click *Add to Home Assistant* under *Settings → Home Assistant*, add this repository to HACS as a *Dashboard* repository, or add the resource `http://<printdock>:3080/printdock-card.js` (JavaScript module) yourself.
- **Add-on:** sidebar entry via ingress, automatic connection to Home Assistant and the Mosquitto broker, included in HA backups.

![PrintDock cards in Home Assistant](docs/screenshots/ha-cards.png)

```yaml
type: custom:printdock-card
entity: sensor.workshop_x2d_status
show_camera: true      # camera button (camera_open: true = shown initially)
height: 560            # optional: equal height for all cards, content scrolls

type: custom:printdock-overview-card
sections: [printers, queue, orders, spools, maintenance]
max_items: 6
```

## Writing a printer driver

Every vendor is a driver in `drivers/`. A driver extends `BaseDriver` (`drivers/base.js`), describes its settings in `static meta` (the UI builds the form from it), reports state with `this.update({...})` in the shared status format, and optionally implements `command(cmd)` (pause, resume, cancel, light, speed), `startPrint(job)` and `cameraSource()`. Register it in `drivers/index.js`. `drivers/demo.js` is the shortest example.

## Translations

German texts are the keys; `public/i18n-en.js` maps them to English. To add a language, copy that file (e.g. `i18n-fr.js`), translate it, load it in `index.html` and register it with `PD_I18N.register('fr', …)`. `npm run check` reports missing translations.

## Project layout

```
server.js            HTTP server, REST API, live updates (SSE), history
camera.js            camera proxy: HTTP snapshots, RTSP via ffmpeg, Bambu JPEG stream
notify.js            event detection and notification channels
lib/app.js           language, accent colour, feature switches, login
lib/production.js    orders, queue, print start, maintenance
lib/filament.js      spools, slots, deduction, usage
lib/stats.js         statistics
lib/homeassistant.js Home Assistant: smart plugs, MQTT discovery
lib/files.js         file library, G-code/3MF parsing
lib/slicer.js        OctoPrint-compatible upload, slicer links
drivers/             moonraker.js, bambu.js, octoprint.js, demo.js
public/              web interface without build step (i18n.js, i18n-en.js, app.js, board.js, …)
scripts/install.sh   native installer for Raspberry Pi / Debian
scripts/check.js     smoke test (npm run check)
ha-addon/            Home Assistant add-on
docs/                installation, remote access, screenshots
```

## Contributing

New printers, translations and bug reports are welcome. Please run `npm run check` before opening a pull request.

## License

MIT
