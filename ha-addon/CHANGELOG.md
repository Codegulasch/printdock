# Changelog

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
