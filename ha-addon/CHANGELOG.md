# Changelog

## 0.8.0
- **Spoolman (optional):** *Settings → Filament → Spoolman* takes over the spool inventory from Spoolman and reports usage, weighed remaining amounts and the current printer/slot back. New spools created in PrintDock can be added to Spoolman automatically. Bookings are kept and sent later if Spoolman is unreachable
- **Filament humidity:** AMS, ACE and optional Home Assistant humidity sensors (e.g. in a dry box) are monitored with warning and alarm thresholds – colour on the printer cards, tiles with a 48 h history under *Filament → Assignment*, notification "Filament too humid" with the affected spools, and a "dried" date per spool
- **Spool labels with QR code:** 62 × 29 mm (Brother QL), 50 × 30, 40 × 30, 57 × 25 mm or an A4 sheet; scanning opens the spool in PrintDock with quick actions (load, weigh, dried, label)
- **RFID/NFC:** write a spool's link to an NFC sticker from the phone (Chrome on Android), or use an ESPHome reader (PN532/RC522) at the printer: tag on the reader → PrintDock puts the spool into the slot; unknown tags are assigned once. API: `POST /api/rfid`

## 0.7.8
- **Camera image in notifications** can be switched per channel right in the list. Home Assistant notifications now carry the snapshot from the moment of the event (as an add-on stored under a random name in `/local`, deleted after 2 days), also in the Home Assistant sidebar notifications
- **Settings → General** rebuilt: appearance with segmented controls, colour swatches and a live preview of the status lights; features as a grouped list with switches
- **Settings → Notifications** as a compact list with status, image and on/off switches

## 0.7.7
- **Updates from within PrintDock:** *Settings → System → Updates* checks GitHub for a newer version (also automatically once a day) and installs it with one click – as a Home Assistant add-on Home Assistant rebuilds the add-on, on a PC/Raspberry Pi PrintDock replaces its files and restarts. For a private repository enter a read-only GitHub token. The add-on now asks for supervisor "manager" rights and access to the add-on folder for this
- **Leaner interface:** everything is sized relative to one base size; new setting *Size* (compact / standard / large), standard is noticeably smaller than before. Printer settings as a compact list, smaller feature tiles and printer cards
- **Dashboard cards:** new option `height` (px) for equal card heights – longer content scrolls inside the card. In the sections view the cards can be resized freely and fill their cell. Wide cards show two columns, narrow cards get more compact

## 0.7.6
- **Notifications via Home Assistant:** new channel "Home Assistant (Companion app)" – to the phone app (with camera image via Home Assistant, also on the go; tapping opens PrintDock) or as a notification in the Home Assistant sidebar. No setup needed as an add-on
- **Filament assignment when starting a print:** the start dialog shows each filament of the slice with its colour and preselects the best matching slot (material and colour). On Bambu printers it can be changed and is sent to the printer as AMS mapping; spool booking follows the choice

## 0.7.5
- After an update the browser or the Home Assistant app could keep using the old interface (old settings layout, no camera fallback). PrintDock now loads its scripts with the version number, lets the browser revalidate every file and reloads the page by itself when the server is newer
- Slicer: the "Device" tab in OrcaSlicer/Snapmaker Orca showed `{"error":"Nicht gefunden"}` – it now opens PrintDock
- Slicer uploads appear in Files and Queue immediately (live update)

## 0.7.4
- Cameras in PrintDock: if the live stream does not get through (e.g. via the Home Assistant sidebar/ingress), PrintDock switches to still images automatically (about one per second)
- Dashboard card: camera button to show/hide the camera, hidden by default; remembered per card and browser (`camera_open: true` to start with the camera shown)
- Add-on: PrintDock now shows the real address of the Home Assistant machine (e.g. `http://192.168.x.x:3080`) instead of the internal container address – for slicers, downloads and the phone
- Slicer upload: besides OctoPrint, PrintDock now also answers like Klipper/Moonraker (`/server/files/upload`), clearer setup page with address selection
- Settings reorganised: *General* (language, look, build plate, features) and new *System* (backup, access, API key, version, setup wizard, demo data); shorter Home Assistant page with advanced MQTT options folded away
- Files: the "Open in …" menu is no longer cut off

## 0.7.3
- **Important fix for the add-on:** the Home Assistant base image (s6-overlay) started PrintDock with an empty environment. PrintDock then stored its data inside the container instead of `/data` – so printers and settings were lost on every update – and did not recognise that it was running as an add-on (no automatic connection, no automatic card setup). From this version on, data lives in `/data`, survives updates and is part of Home Assistant backups. Data entered with an older add-on version cannot be recovered
- **Backup and restore:** *Settings → General → Backup* downloads one file with everything (settings, printers, queue, orders, spools, maintenance, history, print files). Restore it there or right in the setup wizard of a new installation – PrintDock restarts by itself (add-on, Docker, systemd)
- Home Assistant settings in the add-on: no connection or broker fields any more (automatic), installation hints hidden
- Docker image and systemd service restart PrintDock automatically after a restore

## 0.7.2
- Fix: the "new spool detected" prompt came back after adding the spool (Snapmaker U1). The U1's article number (SKU) and empty chip IDs were treated as RFID, so spools without a chip were moved between slots. Only real chip IDs count now, IDs reported by several slots at once are ignored – for all printer types. Existing data is repaired automatically
- Smart plugs: choose the Home Assistant entity from a list (grouped by area, with current state) under *Settings → Home Assistant* and in the printer dialog; "Enter another entity" for anything not listed

## 0.7.1
- Dashboard cards: if the `www` folder did not exist yet, Home Assistant only serves it after a restart. PrintDock now detects this, offers a "Restart Home Assistant" button and confirms once the cards are available
- Card setup status visible under *Settings → Home Assistant* (set up, restart needed, YAML mode with ready-to-paste lines, error)
- Works with both `/homeassistant` and `/config` mounts

## 0.7.0
- **PrintDock cards for Home Assistant dashboards** (`custom:printdock-card`, `custom:printdock-overview-card`)
  - Printer card: status light, job with progress and layers, camera, temperatures, fans, filament slots, light, speed, pause/resume/stop, "plate is clear", power on/off
  - Overview card: status counts, all printers, queue, orders, low spools and due maintenance – sections selectable, list length adjustable
  - Visual editor, German and English, follows the Home Assistant theme
- Installed automatically with the add-on; otherwise one click under *Settings → Home Assistant* or via HACS (Dashboard repository)
- New MQTT sensor "PrintDock overview" with all data for the overview card

## 0.6.2
- Light on Klipper printers detected automatically (LED/output_pin, Moonraker power device or LIGHT_ON/OFF macros)
- ffmpeg found automatically on Windows (winget, Chocolatey) and macOS (Homebrew); hint at startup if missing
- Diagnostics include platform, ffmpeg and detected light/filament/fans

## 0.6.1
- Snapmaker U1: filament per toolhead (material, colour, vendor, RFID) from `print_task_config`
- Anycubic ACE (Rinkhals `filament_hub`, Happy Hare `mmu`, ACE Klipper fork): slots with material and colour
- All fans (part, generic, heater, controller, temperature fans)
- Printer-reported filament is shown even without filament management; unassigned slots show the printer's data
- Spools from storage are assigned automatically by material and colour; swaps on the printer are detected
- New spools: prompt to add them from the printer's data (or ignore)
- Clickable badges: Bambu HMS messages with description, wiki link and "add as maintenance"
- Diagnostics download per printer

## 0.6.0
- Renamed to **PrintDock**
- German and English interface, notifications and Home Assistant entities
- Setup wizard: language, appearance, features, access
- Every feature can be switched on/off (filament, queue, orders, maintenance, …)
- Clear printer status lights: green idle, blue running, yellow waiting (flashing), red fault (flashing)
- Selectable accent colour
- Mandatory "build plate is clear" confirmation before starting from queue or orders
- Statistics: prints, success rate, print hours, material, cost, printer comparison
- Optional login protection for remote access (Cloudflare Tunnel, Tailscale)
- Multi-arch images: amd64, aarch64, armv7

## 0.5.0
- Home Assistant: power switching via smart plugs, MQTT discovery, add-on with ingress
- Demo data, redesigned printer cards
