# Changelog

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
