# Changelog

## 0.16.0
- **Stuck queue entries are cleaned up:** running prints now survive a restart of PrintDock (e.g. during an update), so the end of the print is no longer missed. If an entry still shows "printing" while the printer has been ready for 3 minutes, PrintDock closes it as finished at 95 % or more, otherwise it asks on *Today* and in the queue: *Was finished* / *Cancelled* – order, history and filament are updated. Every running entry has *Stuck?* for the same
- **Arrange the menu:** order, hide items and choose the start page under *Settings → General → Menu* – for all devices or only this one (e.g. the phone)
- **Keep printing orders (option per printer):** when a print is finished, the next open part of an order is queued on this printer and started as soon as the plate is confirmed clear – even without auto-start. *Same order first* or *by priority and due date*; only files with a matching profile, filament and humidity
- **Start windows per printer:** automatic starts only between e.g. 07:00 and 22:00 (outside only short prints), long prints wait for cheap power – any Home Assistant entity: price below a value, export above a value or a PV-surplus switch. Manual starts always work
- **Several parts per plate:** per order item "parts per print" – 20 parts with 4 per print plans 5 prints; progress, costs, remaining time and filament reservation count accordingly
- **Post-processing (option):** steps such as remove supports → check → packed → shipped with counters per order, a summary on *Today* and the progress in the customer status link
- **Photo after the first layer (option):** camera image as soon as the first layer is down – on *Today* and as notification
- **Shopping list with orders:** remember shop and link per material/colour, *Ordered …* (counts against the shortage), *Arrived* creates the spools
- **PrintDock Station page** (*Filament → Station*): live gross/net weight, tag data (UID, format, material, colour, brand, link), the recognised spool with remaining amount – take over the weight, write the tag, tare. **Stocktake:** put spool after spool on the scale. **Weigh** on a spool now reads the weight straight from the station (manual entry still possible)
- **Emergency stop via Home Assistant:** smoke detector or temperature sensor raises an alarm → PrintDock switches off the printers' plugs and sends "Emergency stop". Test alarm without switching off
- **Several users:** admin and operator (start prints, confirm plate clear, requeue, weigh and assign spools – no settings). **Log** of who changed what under *System*
- **Same features on every platform:** new *System → Platform check* (installation, data folder, ffmpeg, restart, update, remote access, Home Assistant, inbox, backup, time zone). **Updates from PrintDock now also in Docker** (the new version is kept in the data folder, a newer image wins again). **Remote access on Windows and macOS:** Cloudflare Tunnel downloads the right program, Tailscale uses the installed Tailscale app (also an existing Tailscale on a Pi/server). `scripts/start-windows.cmd` restarts PrintDock after an update

## 0.15.0
- **Requeue failed prints with one click:** cancelled or failed prints show up on *Today* with *Requeue* (same file, same colour mapping, top of the queue) – or *Fine as is*. A print that finished but is unusable (spaghetti, came loose …) can be marked as *failed* in the history: it no longer counts as a done part of the order and its material is booked as scrap. Optional reason; *Statistics* shows failed prints per printer with their most common reasons and the scrap in grams, orders show the scrap costs
- **Filament reservation for the queue:** every open print reserves the grams from its file on the spool it will print from. Spool cards show *reserved / free*, queue entries warn *not enough filament* with a suggestion for another spool, the start dialog warns when a spool will then be short for the following prints. New **shopping list** (spools page and *Today*, printable): what is missing in stock for all open prints and orders, by material and colour
- **Humidity check before printing:** limits per material (e.g. PLA 60 %, PETG 50 %, PA 30 % and dry every 7 days). If the filament is too wet, the start dialog offers *dry first, then start automatically* (AMS 2 Pro/HT, ACE macro, dryer via Home Assistant), another printer or *print anyway*. Auto-start waits while the filament is too wet (switchable). Settings under *Printers & filament → Humidity & drying*
- **Read RFID/NFC tags with the phone** (Chrome on Android, over HTTPS): *Read tag* on the spools page – known spools open, OpenSpool tags become a new spool, unknown tags can be assigned. Writing tags with the phone was already possible. On the iPhone Apple does not allow NFC in web pages (QR labels work); original Bambu tags are encrypted, only their ID can be read
- **Remote access built in:** new page *Settings → Remote access*. Tailscale (private VPN, sign-in via link or auth key, optional HTTPS address `https://printdock.<tailnet>.ts.net`) and Cloudflare Tunnel (quick test without an account or your own address with a tunnel token) are switched on right in PrintDock – it downloads the program itself and keeps it running. Works the same as Home Assistant add-on, Docker and on a Pi. Cloudflare only with login protection
- **Login protection "only from outside":** no password at home and in the Home Assistant sidebar, password through tunnel and Tailscale. The Home Assistant sidebar (ingress) never asks for the PrintDock password any more – Home Assistant has already signed you in
- The clock at the bottom left of the sidebar is gone

## 0.14.0
- **New start page "Today"**: what needs doing (clear plates, faults, labels to print, humid filament, low spools, unassigned spools, maintenance due, overdue orders, failed starts, updates), what is printing right now with finish time, what comes next in the queue and the orders due this week
- **Automatic backup**: once a day into `/share/printdock/sicherungen` (add-on, reachable via Samba) or the data folder, keeps the last 7 (adjustable), with or without print files. List, download and "Back up now" under *System*. Restoring a backup without print files keeps the existing ones
- **Customer status link (optional per order)**: a page without login showing progress, due date, expected finish and photos of the finished parts – no costs. Create, renew or turn off the link in the order
- **Label after printing (optional)**: every finished part of an order gets a label (order, part x of y, customer, date, QR code to the status link) – printed together from "Today" or from the order
- **Home Assistant blueprints**: "Print finished" notification with a *Plate is clear* button in the notification, light on when finished, exhaust fan while printing, alert on fault/pause. As add-on one click copies them into Home Assistant, otherwise download
- Settings pages Home Assistant and Slicer now follow the same layout as the other settings

## 0.13.0
- **Electricity per print:** with a plug that measures in Home Assistant (energy meter in kWh or power in W) PrintDock records the consumption of every print – the meter of the plug's device is found automatically, or choose one under *Settings → Home Assistant*. Without metering it estimates from a power value and learns the average per printer once measurements exist
- **Costs and quotes:** every print in the history shows its costs (filament by spool price, electricity, optional machine hour rate and markup). Orders show an estimate per item from the sliced files plus the actual costs so far, and *Print estimate / quote* opens a printable page. Prices under *Settings → Printers & filament → Costs*
- **Automatic printer choice that respects the profile:** queue entries without a fixed printer go to the free printer (with auto-start) whose profile the file was sliced for **and** that has the needed filament loaded (material, similar colour, enough left) – the closest colours win. Files sliced for another profile are no longer started on the wrong printer: the start dialog greys such printers out and the start is refused with a clear message. The queue shows why an entry is still waiting
- **Photos of finished parts:** at the end of a successful print PrintDock saves a camera image – shown in the history and on the order (switchable under *Costs*)
- **Archive orders:** finished or closed orders can be archived and restored; new filter *Archive*

## 0.12.9
- Fix: **print end was missed on printers that jump straight back to "ready"** (e.g. Anycubic in LAN mode) – no "print finished" notification, no history entry, the order was not completed and no filament was booked. PrintDock now also detects the end from that jump: at 95 % progress or more (or less than 3 minutes left) as finished, otherwise as cancelled

## 0.12.8
- **Inbox folder for Bambu Studio** (and any other slicer): files saved into it are picked up within seconds – into the library, or from the subfolder `warteschlange` straight into the queue. As add-on the folder is `/share/printdock`, reachable over the network as `\\homeassistant\share\printdock` with the Samba add-on. In Bambu Studio: slice, *Export plate sliced file* (Ctrl+G), save into the folder. Paths are shown under *Settings → Slicer*
- **Bambu: "553 Could not create file" when starting a print.** If the printer does not allow writing to the root folder, PrintDock now tries its storage folders (e.g. `sdcard`, `usb`, `cache`). If that fails too, the message says what to check (SD card/USB stick inserted, free space) and lists the folders the printer offers

## 0.12.7
- **Anycubic: start prints from PrintDock (two-track).** With Rinkhals on the printer, enter the Moonraker port (usually 7125) in the *Anycubic (LAN mode)* connection: status, ACE and drying keep running over LAN mode, prints are sent and started through Moonraker – including the colour assignment at start (ACE slots, tools renumbered in the G-code)

## 0.12.6
- **Choose colours when starting from the queue – now also on Klipper and OctoPrint printers** (e.g. Snapmaker U1, Voron with several toolheads, ACE/MMU via Klipper). The start dialog suggests which tool or slot prints which filament of the slice by material and colour, and every row can be changed. If the assignment differs from the slice, PrintDock renumbers the tools in the G-code before sending it (T0 → T2, swapping works too) – including tool temperatures and Klipper `EXTRUDER=` / `TOOL=` parameters. Bambu keeps using the AMS mapping as before

## 0.12.5
- **Smart plugs via Home Assistant are reliable again:** if Home Assistant closes a connection or answers late, PrintDock now retries once and then looks at the plug state – instead of "Home Assistant not reachable" while the plug had switched anyway. Longer timeout for slow plugs (cloud, Zigbee)
- **Hide measuring points** under *Settings → Printers & filament → Humidity & drying* (✕), e.g. a printer without AMS and without dryer like the Snapmaker U1. Hidden points can be shown again with one click
- **Updates are checked every 6 hours** (was once a day). A new version is announced once – with the new notification event "PrintDock update available" (switch it on per channel under *Notifications*). If the check fails (e.g. private repository without token), *System → Updates* now says why

## 0.12.4
- **Bambu: unloading before drying is now opt-in and heats the nozzle first.** Cold filament sticks in the nozzle and can snap when it is pulled back. If filament from the unit is loaded, the drying dialog offers "Unload filament first": PrintDock heats the nozzle to the filament's upper print temperature, waits until it is hot, unloads, switches the heater off again and then starts drying ("Nozzle heating up …" → "Unloading filament …"). Without the option PrintDock asks you to unload on the printer

## 0.12.3
- PrintDock Station: a board without modules (no NFC reader, scale or humidity sensor yet) now shows up under *Settings → PrintDock Station* with its pairing code instead of in the humidity-sensor list, with a hint that modules can be connected later
- A new device asking to pair now shows a notice on every page, with its code

## 0.12.2
- **Bambu: filament is really retracted before drying now.** The unload command now matches Bambu Studio (AMS number of the unit, and on two-nozzle printers like the X2D/H2D the nozzle that holds the filament). The printer heats the nozzle itself; each nozzle with filament from that AMS is unloaded in turn. If the printer refuses to unload, PrintDock shows its reason
- PrintDock Station: the setup guide explains the Wi-Fi step in detail (http://192.168.4.1, *Configure WiFi*, address field)
- PrintDock Station: the D1 Mini with ESP8266 is supported from station firmware 0.3.0 (PN532 in I²C mode)

## 0.12.1
- **Bambu: drying with loaded filament.** Bambu refuses to dry while filament from that AMS is loaded (it sits in the AMS outlet). PrintDock now retracts it into the AMS first – the nozzle heats up briefly for this – and starts drying as soon as the slot is free ("Unloading filament …"). During a print this is not possible; PrintDock then says so straight away. Clearer reasons when the printer still refuses

## 0.12.0
- **New connection Anycubic (LAN mode)** for Kobra S1 / S1 Max, Kobra 3 and Kobra 2 Pro with the stock firmware – no Rinkhals needed. Enable LAN mode on the printer, then pick *Anycubic (LAN mode)*: status, temperatures, fans, pause/resume/cancel, light, camera, ACE Pro slots with material and colour, and **ACE drying at the push of a button**. Starting prints from PrintDock is not supported with this connection yet
- **Drying now reports back:** after *Start*, PrintDock waits for the device to confirm ("Starting …"). If the printer refuses or does not react, the reason is shown at the measuring point instead of a timer that runs without anything happening. Bambu: the drying command now matches the format of the Bambu app; LAN mode with developer mode is required for commands from PrintDock
- **Updates install by themselves again:** after downloading, PrintDock waits until Home Assistant has picked up the new version and then starts the update – no more detour through the add-on page. The update dialog shows each step and, if Home Assistant refuses, the reason
- **Settings with their own navigation** (left on large screens, a row at the top on phones), each entry with a short description. *Printers & filament* brings together printers, print start (plate check, auto-start), filament (warnings, labels, Spoolman) and humidity & drying on one page with jump links. The PrintDock Station has its own entry
- Fix: the printer view no longer jumps to the top while scrolling – live updates keep the scroll position and the page height while images reload

## 0.11.0
- **Drying at the push of a button** under *Filament → Humidity & drying*, for as many devices as possible: Bambu AMS 2 Pro and AMS HT directly (model detected from the printer), Klipper/Moonraker printers via a G-code macro (template for the ACE Pro with the Klipper ACE driver), and anything Home Assistant can control – a dry box on a smart plug or a dryer with its own integration (start/stop buttons, number entities for temperature and duration, e.g. Anycubic ACE via the Anycubic integration). PrintDock suggests temperature and time from the loaded spools, caps them at the device limit, shows the remaining time on the printer card, sends "Drying finished" and records the drying date on the spools
- **New page Filament → Humidity & drying** with every measuring point, its 48 h history and the dryer controls. *Slots* only shows a hint when something is too humid
- **Clearer menus:** the sidebar is grouped into Production, Material and Workshop; settings are grouped into PrintDock (General, System), Workshop (Printers, Filament, Humidity & drying, PrintDock Station) and Connections (Home Assistant, Slicer, Notifications)
- **PrintDock Sensor:** devices with only a humidity sensor are listed and paired under *Settings → Humidity & drying* instead of with the stations
- Appearance: new accent colour green; the status preview was removed
- Fix: the printer view no longer jumps back to the top while scrolling – live updates now only replace what changed (images and camera stay in place)

## 0.10.0
- **Humidity for every unit and dry box:** *Settings → Filament → Humidity* lists every measuring point – AMS/ACE units that measure themselves, units and printers without a measurement, plus dry boxes and storage places. Assign any Home Assistant humidity sensor (e.g. a Zigbee or Bluetooth thermometer in the box) or a PrintDock Station with a humidity sensor. A dry box covers all spools with that storage place. The humidity sensor in the printer settings has moved there automatically
- **Warnings on the printers:** a humidity badge on the printer card (e.g. "AMS lite 52 %"), coloured unit headers including external sensors, a "too humid" chip in the header and a hint on the Home Assistant card
- **PrintDock Station** is now called that in the settings, with a short description, links to the project, firmware download and wiring. Station firmware 0.2.0 supports SHT4x, SHT3x, AHT20 and HTU21D humidity sensors and also works as a sensor-only humidity meter
- The ESPHome RFID reader entry was removed from the settings – the PrintDock Station replaces it; `POST /api/rfid` keeps working for existing readers

## 0.9.1
- Writing a tag that is too small for the chosen format could hang PrintDock while it looked for a format that fits (Node 18 crashed). Fixed
- Checks run on Node 18 again (station test without the built-in WebSocket)

## 0.9.0
- **PrintDock Station:** own NFC reader + scale + display on an ESP32 (WROOM devkit or D1 Mini ESP32), firmware in the new project [printdock-station](https://github.com/Codegulasch/printdock-station). Pair it under *Settings → Filament → Stations* with the code from its display
- **One workflow for spools, RFID and QR:** put a spool on the station → PrintDock recognises it, shows it on the display and in the spool colour, books the remaining amount by weight (learns the empty spool weight from new, full spools) and assigns it to the next printer slot it is loaded into. Stations at a printer can place spools into a fixed slot right away
- **Bambu AMS:** material and colour of a spool without a Bambu chip are set on the AMS slot automatically when it is assigned (switchable)
- **Write tags** from the spool sheet: "PrintDock + OpenSpool" (link + material data, NTAG215/216), "OpenSpool" (e.g. Snapmaker U1 with community firmware), "Link only" (NTAG213) or "Anycubic ACE" (ACE Pro / Kobra S1 recognises material and colour) – at a station or with the phone (Chrome on Android)
- **Read tags:** Anycubic and OpenSpool tags of new spools are recognised and offered as a new spool with material, colour and weight filled in
- `scripts/station-sim.js` simulates a station for trying it without hardware

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
