# PrintDock

*English · [Deutsch](README.de.md)*

**One dashboard for every 3D printer in the house – no matter the brand.**
Bambu Lab, Snapmaker U1, Anycubic (with ACE), Voron and any Klipper/Moonraker or OctoPrint printer. Inspired by [BamBuddy](https://github.com/maziggy/bambuddy), but not limited to Bambu Lab.

![Printer overview](docs/screenshots/board-dark.png)

Fully local – no cloud, no account, no database. Runs as a **Home Assistant add-on**, in **Docker** (NAS, server, Raspberry Pi), as a **service on the Pi** or with **Node.js on Windows, macOS and Linux** – with the same features everywhere.

## What PrintDock does

### Printers at a glance

- **Live status** of all printers: progress, time left, ETA, layer, temperatures with history, fans, light, speed; pause, resume, cancel
- **Status lights** on every card: idle = green, printing = blue running light, waiting = flashing yellow, fault = flashing red
- **Camera** for every printer (incl. Bambu RTSP and JPEG streams) with full-screen view and snapshot; optional **photo after the first layer**
- **Start page "Today"**: what needs doing (clear plates, failed prints, stuck entries, labels, humidity, shopping, maintenance, due dates), what is printing and what comes next
- **Notifications** with camera image via ntfy, Telegram, Discord, Gotify or webhook
- **Archive** of all prints with start and end, grouped by day, with search, filters and CSV export – **including prints sent straight from the slicer or started on the touchscreen**
- **Areas** for print farms and different rooms: assign printers, overview grouped and filterable by area, send queue entries and orders to an area
- **Statistics**: prints, success rate, print hours, material, costs, failed prints and scrap, printers compared

### Production

- **Parts with variants**: one model, one sliced file per printer – schedule the part, it prints on the free printer with a matching variant (across brands)
- **File library** for G-code and 3MF with detected print time, filament, printer profile and preview; on upload PrintDock asks which part and which printers the file belongs to
- **Slicer integration**: send from OrcaSlicer, PrusaSlicer & co., from Bambu Studio via the inbox folder; open files in your slicer
- **Print mode per order and entry**: *series print (automatic)*, *series print (manual)* or *single print*
- **Print queue** with *"plate is clear"* confirmation and **automatic printer choice** by profile and loaded filament
- **Orders** with items (file × quantity), due date, priority, **several parts per plate**, estimate/quote and actual costs
- **Series printing**: print finished → the next part of the order is queued on that printer → starts by itself after "plate clear"
- **Start windows** per printer and waiting for cheap power or PV surplus
- **"Does not start because …"**: after "plate clear" PrintDock says right away whether it starts – or why not, with a button to fix it
- **Failed prints** requeued with one click, reasons, scrap in costs and statistics
- **Stuck entries** ("printing" although the printer finished long ago) are detected and cleaned up
- **Post-processing** steps (remove supports → check → packed → shipped)
- **Colour mapping at start**: Bambu AMS mapping, tools renumbered in the G-code on Klipper/OctoPrint
- **Maintenance planner** by operating hours, prints or days

### Filament

- **Spool inventory** with AMS, ACE and toolhead slots, automatic deduction after every print, costs and low-stock warnings
- **Reservation** for all open prints, **shopping list** with shop link, "ordered" and "arrived"
- **Humidity**: monitoring of AMS/ACE, Home Assistant sensors and stations; **humidity check before starting** ("dry first, then start automatically"); **drying at the push of a button**
- **PrintDock Station** (ESP32 with NFC, scale, humidity sensor) as a **workbench**: place a spool → recognised, weighed, loaded into a free slot with one button; create or assign new tags, history, notice from anywhere and **stocktake**
- **Read and write RFID/NFC tags with the phone** (Chrome on Android); spool labels with QR code
- **Spoolman** optional – import inventory and report usage back

### Customers

- **Status link per order**: progress, due date, expected finish, post-processing and photos of finished parts – no costs, no login
- **Your own status server** (`relay/`): customer links work from anywhere without opening the home network – as **PHP for regular web hosting** or Node.js/Docker
- **Labels** for finished parts with a QR code to the status link

### Home Assistant

- Switch printers via **smart plugs**, **auto-off** after cool-down, **electricity per print**
- Every printer as an **MQTT device**, two **dashboard cards**, **automation blueprints**
- **Emergency stop**: smoke detector or temperature sensor switches the printers off
- Runs as an **add-on** with sidebar entry, automatic connection and inclusion in HA backups

### Access and operation

- **Remote access** via Tailscale or Cloudflare Tunnel – switched on right in PrintDock
- **Login protection** always or only from outside; **several users** (admin, operator) with a **log**
- **Updates** with one click (add-on, Docker, Pi, PC), **daily backup**, moving via backup zip
- **Platform check** shows what works on the current installation
- **Setup levels** Hobby, Maker, Workshop – PrintDock shows only what you need; switched-off features are listed under **"Discover more"**
- **Setup wizard**, **every feature can be switched off**, **arrange the menu, "Today" and printer cards** and choose the start page
- **German and English**, accent colour, light and dark mode, works on phones
- **Demo data** with one click: 5 simulated printers, files, spools, orders and 30 days of history

| Today | Archive |
|---|---|
| ![Today](docs/screenshots/today.png) | ![Archive](docs/screenshots/archive.png) |
| **Station** | **Statistics** |
| ![Station](docs/screenshots/station.png) | ![Statistics](docs/screenshots/stats.png) |
| **Parts** | **Setup wizard** |
| ![Parts](docs/screenshots/parts.png) | ![Setup](docs/screenshots/setup.png) |

**New here?** → [Getting started](docs/getting-started.md#getting-started): from first start to first print in ten minutes.

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

**Windows:** run `scripts\start-windows.cmd` instead of `npm start` – PrintDock then restarts by itself after an update or a restore.

Then open `http://<ip>:3080`. The setup wizard asks for language, look, features and access and can load demo data. Everything can be changed later under **Settings → General**. **Settings → System → Platform check** shows what works on this installation (restart, update, ffmpeg, remote access, Home Assistant, inbox, backup, time zone).

## Supported printers

| Connection | Printers | Requirements |
|---|---|---|
| **Klipper / Moonraker** | Snapmaker U1, Anycubic Kobra 3 / S1 (with [Rinkhals](https://github.com/rinkhals-community/Rinkhals)), Voron, rooted Creality K1/K2, any Klipper printer | Moonraker reachable (port 7125) |
| **Anycubic (LAN mode)** | Kobra S1 / S1 Max, Kobra 3 / 3 Max, Kobra 2 Pro with stock firmware, incl. ACE Pro | LAN mode enabled on the printer; IP address |
| **Bambu Lab (LAN)** | X1, P1, A1, H2D, X2D | LAN mode (newer firmware: developer mode); IP, serial number, access code |
| **OctoPrint** | Any Marlin printer with OctoPrint | API key |
| **Demo** | – | Simulated printer to try things out |

- **Snapmaker U1** – Moonraker is enabled out of the box; add it as *Klipper / Moonraker*.
- **Anycubic Kobra S1 / Kobra 3** – with the stock firmware, enable *LAN mode* on the printer and add it as *Anycubic (LAN mode)*: status, pause/resume/cancel, light, camera, ACE slots (material and colour) and ACE drying. To start prints, install Rinkhals and also enter its Moonraker port (usually 7125): status, ACE and drying stay on LAN mode, prints go through Moonraker. Without Rinkhals, start prints on the printer or from the slicer. The LAN protocol follows [anycubic-lan](https://github.com/Nino6689/anycubic-lan).
- **Bambu Lab** – enable LAN mode; the access code is in the network menu. Newer firmware only accepts control commands from third-party software in developer mode. Starting prints and the second nozzle of H2D/X2D are **experimental** – feedback from real devices is welcome.

## Status lights

| Light | Meaning |
|---|---|
| 🟢 green, glowing | **Idle** – ready for the next print |
| 🔵 blue, running | **Printing** (also preparing / sending a file) |
| 🟡 yellow, flashing | **Waiting** – paused, or the plate needs clearing |
| 🔴 red, flashing | **Fault** |
| ⚪ grey | Unreachable |

The colours are fixed and independent of the accent colour; every light also shows the state as text.

## Interface

Sidebar with all areas and counters for open items; at the bottom language (DE/EN), light/dark and logout. **Order, hidden items and start page** of the menu are set under *Settings → General → Menu* – for all devices or only this one (e.g. the phone). Features switched off under *Settings → General → Features* disappear from the menu and the cards; their data is kept.

**Setup levels:** in the setup wizard and under *Settings → General* you pick a starting point – **Hobby**, **Maker** (adds queue with auto start, statistics, maintenance) or **Workshop** (adds orders with costing, customer links, post-processing, areas). Every feature can still be switched individually; what is off is listed under **"Discover more"** with one sentence on what it does.

**Arrange:** on *Today* and *Printers*, **Arrange** lets you drag (or move with arrows, also on phones) boxes and printer cards and hide boxes on *Today* – for all devices or only this one.

**Parts with variants:** under *Files → Parts* a part is a model with one sliced file per printer (type). Queue and orders schedule the part; it starts on the free printer that has a variant – an order "20 × cable clip" spreads over several printers of different brands. On upload PrintDock asks which part the file belongs to and for which printers (preselected by the printer model in the file), optionally scheduling it right away. Files from the slicer and the inbox are assigned automatically: same name and printer = new version, same name and other printer = another variant.

Every printer card shows header (model image, name, nozzle, plug button), badges (connection, Wi-Fi, Bambu HMS, humidity, maintenance, planned prints), status (preview, file, order, progress, time left, finish time, layer – or "clear plate" / "ready", then the next queued print or "does not start: …" with the reason), temperatures with history, fans, controls (light, camera, speed, pause/resume/stop) and filament (AMS/ACE units with humidity, temperature and dryer, every slot with colour, material and remaining amount).

## How a print flows through PrintDock

```
Slicer ──"Send to printer"──┐
Upload (Files) ─────────────┴─> File library
                                   │
Order (file × quantity) ───────────┤ "Schedule"
                                   ▼
                     Queue ──Start (confirm plate clear) / automatic──> printing
                       ▲                                                   │
          "Plate is clear" confirmed  <──────── print finished ────────────┘
                                         (history, order progress, filament deducted,
                                          maintenance hours counted)
```

- **Plate clear:** after every print the card shows "clear plate" (flashing yellow). Only after **Plate is clear** does the next print start. Manual starts from the queue or an order also require ticking **"build plate is clear"** (can be switched off).
- **Print mode** (on the order and on every entry; default under *Settings → Printers & filament → Print start*):
  - **Series print (automatic)** – all prints are queued, after "plate clear" the next one starts by itself.
  - **Series print (manual)** – all prints are queued, the next one waits with **Start** on the printer card and never starts by itself.
  - **Single print** – only one print is queued at a time and started by hand; *Print* on an order prints the next single part.
- **Does not start?** After "plate clear" PrintDock tries to start immediately and shows on the card, on *Today* and in a message "Starting: X" or "Does not start because …" – print mode manual or single, entry still stuck on "printing", last start failed, filament too humid, outside the start window, profile or filament does not match – each with the button that fixes it. Failed starts are retried after 2 minutes (up to 3 times).
- **Assignment:** an entry belongs to a fixed printer or to "matching printer". The latter goes to the free printer whose profile the file was sliced for and that has the matching filament loaded (closest colour wins). Files sliced for another profile are never started.
- **Order:** requeued failed prints first, then order priority (urgent before normal), due date and manual order (▲▼).
- **Colours at start:** PrintDock suggests which slot or tool prints which filament of the slice by material and colour – every row can be changed. Bambu gets it as AMS mapping; on Klipper and OctoPrint the tools are renumbered in the G-code (e.g. T0 → T2).
- **File format:** Klipper and OctoPrint need `.gcode`, Bambu a sliced `.gcode.3mf`. PrintDock checks this before starting. Starting on Bambu (FTPS + MQTT, LAN/developer mode) is experimental.
- **Transfer:** as soon as the printer reports the print, the start counts as done – even if the answer to the upload never arrives (e.g. Snapmaker U1). If PrintDock restarts during a transfer, it matches the entry against the history instead of printing the file twice.

### Series printing and start windows

- **Series print (automatic):** when a print is finished, PrintDock queues the next open part – of the same order first, otherwise of another automatic order by priority and due date – on this printer and starts it as soon as the plate is confirmed clear. Only files with matching profile, filament and humidity.
- **Start window** (in the printer settings): automatic starts only e.g. between 07:00 and 22:00 (outside only short prints). Long prints can wait for cheap power – any Home Assistant entity: price below a value, export above a value or a PV-surplus switch. Manual starts always work.

### Parts per plate, post-processing, failed prints

- **Parts per print** per order item: 20 parts with 4 per print plans 5 prints; progress, costs, time left and reservation count accordingly.
- **Post-processing** (option): steps such as remove supports → check → packed → shipped with counters per order, a summary on *Today* and progress in the customer status link.
- **Failed prints:** cancelled or failed prints appear on *Today* with **Requeue** (same file and colour mapping, top of the queue) or *Fine as is*. A finished but unusable part can be marked as **failed** in the history – it no longer counts as done and its material is booked as scrap. Reasons show up in the statistics per printer.
- **Stuck entries:** running prints survive a restart of PrintDock (e.g. during an update). If an entry still shows "printing" while the printer has been ready for 3 minutes, PrintDock closes it as finished at 95 % or more, otherwise it asks on *Today* and in the queue: *Was finished* / *Cancelled*. Order, history and filament are updated. Every running entry also has *Stuck?*.

### Costs, electricity and photos

Every print in the history shows its costs – filament by spool price, electricity (from a metering plug in Home Assistant, or estimated), optionally machine hours and markup. Orders show an estimate from the sliced files, the actual costs and scrap; *Print estimate / quote* creates a printable page. At the end of a print PrintDock saves a camera image of the finished part, optionally also after the first layer. Finished orders can be archived.

## Archive

*Archive* in the menu lists every finished print with **start and end** (from–to), duration, printer, file, photo, filament, costs, order and result – grouped by day, with totals (prints, success rate, print time, filament, costs).

- **Search** across file, order, customer and printer; **filters** for period (today, 7/30 days, month, year, custom), printer, result (incl. failed print), source (from PrintDock or printer/slicer) and order (with, without, not yet assigned, a specific one); **CSV export** of the filtered list
- **Print again** schedules the same file (same plate) again
- up to 20,000 prints are kept

**Prints that did not come from PrintDock** – sent straight from the slicer to the printer or started on the touchscreen – end up in the archive too:

- PrintDock notices them in the printer status and **fetches the file from the printer** into the library (*taken over from the printer*): Klipper/Snapmaker U1 via Moonraker, Bambu via FTPS from the SD card (incl. the printed plate), OctoPrint via its download URL, Anycubic only with Rinkhals. Identical files are recognised by content and stored once. That gives preview, grams per colour, filament deduction (also on Bambu), costs and *Print again*. For multi-colour prints the grams go to the tools or – on Bambu – to the used slots by material and colour.
- **Assign an order:** if the print clearly matches one open order item (same file or same name), it counts there automatically. Otherwise it shows up on *Today* and in the archive with *Assign order …* (suggestions, any order or *no order*). Assigned prints count as finished parts – with costs, photo, label and customer status link; a waiting queue entry of that item counts as done.
- While such a print runs, the queue says "waiting until X is done" and *Today* says the printer is busy with a print that did not come from PrintDock.
- **Resumed after a power cut:** if the printer resumes the same print at the same point shortly after it stopped, PrintDock counts it as one print – no double deduction, no failed-print question.
- **Re-sliced version:** when a file with the same name but different content is uploaded and an open order still uses the old one, *Today* offers to switch that order to the new version.
- Settings under *Settings → Printers & filament → Archive*: take over files on/off, maximum size, delete taken-over files without an order after X days (default 90, the archive entry stays), assign automatically on/off.

## Customer links

Every order can get a **status link** with QR code: progress, due date, expected finish, post-processing and photos of finished parts – **no costs**, no login, not guessable. Plus **labels** for finished parts (order, part x of y, customer, date, QR code), printed together from *Today* or the order.

When PrintDock runs at home, such a link points to an address like `192.168.x.x` that customers cannot reach. That is what the **status server** in [`relay/`](relay/README.md) is for: it runs on your own server or web hosting, and PrintDock **pushes** status data and photos to it on every change. Connections only go out from PrintDock; the home network stays closed.

- **PHP version** (`relay/php`) for regular web hosting: upload via FTP, put a key into `config.php`, done – also without URL rewriting and on hosts that only allow GET/POST
- **Node.js/Docker version** (`relay/server.js`) for your own server
- several PrintDock installations with their own keys, company name and link in the footer, pages expire after the order is done (default 30 days), turning a link off deletes it on the server too

Set it up under *Settings → Remote access → Customer links*; guide in [relay/README.md](relay/README.md) (German).

## Filament

**Spools** (*Filament → Spools*): material, brand, colour, net and empty weight, price, storage place. Remaining amount by **weighing** (straight from the PrintDock Station or by hand), **− g** or automatically. **Slots** (*Filament → Slots*): tap a slot, choose a spool. Bambu AMS RFID spools are assigned automatically; a slot turns red when the printer reports a different material.

**Deduction after every print:** started from PrintDock – grams per filament from the slicer file (also multi-colour), partial on cancel or error. Started on the printer – Klipper reports the length, converted to grams ("estimated"); Bambu reports no amount. Below the warning threshold (default 100 g) you get "spool running low". *Filament → Usage* lists every booking with costs.

**Reservation and shopping:** every open print reserves its grams on the spool it will print from. Spools show *reserved / free*; entries warn when there is not enough filament and suggest another spool. The **shopping list** (spools page and *Today*, printable) shows what is missing for all open prints and orders, by material and colour with a remembered shop and link. *Ordered …* counts against the shortage, *Arrived* creates the spools.

**Humidity:** AMS and ACE units that measure humidity are monitored automatically. Other units, printers and dry boxes/storage places get a sensor under *Settings → Printers & filament → Humidity & drying*: any Home Assistant humidity sensor or a PrintDock Station with a humidity sensor (SHT31/SHT40/AHT20/HTU21D). Warnings appear on the cards, in the header, on the Home Assistant card and under *Filament → Humidity & drying*, with 48 h history and a drying date per spool. The built-in dryer of an offline printer stays visible.

**Humidity check before printing:** limits per material (e.g. PLA 60 %, PETG 50 %, PA 30 % and dry every 7 days). If the filament is too wet, the start dialog offers *dry first, then start automatically*, another printer or *print anyway*. Auto start waits while the filament is too wet (switchable).

**Drying at the push of a button:** Bambu AMS 2 Pro (45–65 °C) and AMS HT (45–85 °C) via MQTT (LAN + developer mode), Anycubic ACE Pro in LAN mode, Klipper/Moonraker via a G-code macro, everything else via Home Assistant (dry box on a plug or a dryer with its own integration). Temperature and time are suggested from the spools in the unit.

**PrintDock Station:** an ESP32 with NFC reader (PN532), scale (HX711), optional humidity sensor and small display, with its own firmware: [printdock-station](https://github.com/Codegulasch/printdock-station). Put a spool on it → PrintDock recognises it (tag UID, spool link, OpenSpool or Anycubic data), books the remaining amount by weight and remembers it for 3 minutes: the next slot that reports a newly loaded spool gets it, and on Bambu material and colour go to the AMS. The page *Filament → Station* shows gross/net weight live, the tag data and the recognised spool – take over the weight, write the tag, tare. **Stocktake:** put spool after spool on the scale. Pair with a six-digit code under *Settings → PrintDock Station*; `node scripts/station-sim.js` simulates one.

**RFID/NFC with the phone** (Chrome on Android, over HTTPS): *Read tag* opens known spools, turns OpenSpool tags into a new spool and lets you assign unknown tags. Blank tags can be written in four formats (PrintDock + OpenSpool, OpenSpool, link only, Anycubic ACE) – with the phone or at the station. iPhones do not allow NFC in web pages (QR labels work); original Bambu tags are encrypted, only their ID is readable. ESPHome readers use `POST /api/rfid` with `{"tag": "…", "printer": "…", "slot": "…"}`.

**Spool labels** with QR code in 62 × 29 mm (Brother QL), 50 × 30, 40 × 30, 57 × 25 mm or as an A4 sheet. **Spoolman (optional)** under *Settings → Printers & filament → Filament*: imports the inventory and reports usage, weights and the current slot back.

## Home Assistant

- **Power switching:** a switchable entity (`switch.…`, `light.…`, `input_boolean.…`) per printer; an on/off button appears on the card. Optional auto-off once the print is done and the nozzle has cooled down. With a metering plug PrintDock records the **electricity per print**.
- **Emergency stop:** a smoke detector or temperature sensor raises an alarm → PrintDock switches off the printers' plugs and sends "Emergency stop". Test alarm without switching off.
- **MQTT discovery:** every printer becomes a device with status, progress, time left, finish time, file, layer, temperatures, connectivity, "clear plate", buttons (pause, resume, cancel, plate is clear), light switch, speed select and camera image – plus a PrintDock device with queue, active printers, overdue orders, low spools and due maintenance.
- **Blueprints:** "Print finished" with a *Plate is clear* button in the phone notification, light on when finished, exhaust fan while printing, alert on fault/pause.
- **Dashboard cards:** `custom:printdock-card` (one printer with camera, temperatures, filament and controls) and `custom:printdock-overview-card` (all printers, queue, orders, low spools, maintenance; `area: <name>` limits it to one area), both with a visual editor. Installed automatically with the add-on; otherwise *Add to Home Assistant* under *Settings → Home Assistant*, HACS (*Dashboard* repository) or the resource `http://<printdock>:3080/printdock-card.js` (JavaScript module).
- **Add-on:** sidebar entry via ingress, automatic connection to Home Assistant and the Mosquitto broker, included in HA backups. Port 3080 stays reachable for slicer uploads, camera images and phones on the home network.

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

## Remote access, users and security

On your home network PrintDock runs without login. For access on the go, switch it on under **Settings → Remote access** (guide: [docs/remote-access.md](docs/remote-access.md)):

- **Tailscale** – private VPN, nothing public; sign in via link or auth key, optionally with an HTTPS address `https://printdock.<tailnet>.ts.net`
- **Cloudflare Tunnel** – quick test without an account or your own address with a tunnel token; only with login protection
- **Home Assistant** – the add-on is available wherever Home Assistant is

PrintDock downloads `tailscale` or `cloudflared` itself and keeps it running – the same as add-on, in Docker and on a Pi. On Windows and macOS it downloads the matching `cloudflared`; for Tailscale it uses the installed Tailscale app (also an existing Tailscale on a Pi or server).

**Login protection** (*Settings → System*) applies always or only from outside; the Home Assistant sidebar never asks for the PrintDock password. **Several users:** *admin* may do everything, *operator* may start prints, confirm plate clear, requeue, weigh and assign spools – but not change settings. The **log** under *System* shows who changed what.

Passwords are stored with scrypt, sessions use HttpOnly cookies, 5 wrong attempts lock for a minute. Never forward port 3080 directly on your router.

## Updates, backup, platforms

**Updates:** *Settings → System → Updates* checks GitHub for a new version (also automatically every 6 hours, optionally with a notification) and installs it with one click: as an add-on Home Assistant rebuilds PrintDock, on PC and Raspberry Pi PrintDock replaces its files and restarts, **in Docker** the new version is kept in the data folder (a newer image via `docker compose pull` wins again). For a private repository enter a read-only GitHub token under "Update source".

**Backup:** PrintDock backs itself up daily – as add-on into `/share/printdock/sicherungen` (via Samba `\\homeassistant\share\printdock\sicherungen`), otherwise into the data folder; keeps the last 7 (adjustable), with or without print files. *Settings → System → Backup* downloads a single `.zip` with everything. Restore it there or in the setup wizard of a fresh installation. As add-on, Docker container, systemd service or with `start-windows.cmd` PrintDock restarts by itself. The previous state is kept in `before-restore-…` inside the data folder.

**Storage location (NAS):** print files, photos and backups can be moved to a NAS, a server or a second disk under *Settings → System → Storage location* – so Home Assistant does not fill up and HA backups stay small. Settings, archive and spools always stay in the data folder. Three modes:

| Mode | For | How |
|---|---|---|
| **Data folder** | default | nothing to set |
| **SMB share** (recommended) | NAS, TrueNAS, Synology, Windows share – **no mounting, no Home Assistant needed** | enter server (IP), share, optional subfolder, user and password, *Check*, *Apply* |
| **Mounted folder** | a folder the system already knows | add-on: HA network storage → `/share/<name>` or `/media/<name>` · Docker: volume, e.g. `/mnt/nas/printdock:/nas` · Pi/Linux: `/etc/fstab` · Windows: UNC path `\\nas\print\printdock` · macOS: `/Volumes/<share>/printdock` |

PrintDock creates the subfolders `dateien`, `fotos` and `sicherungen` (each optional), copies the existing files over and only then deletes them locally. **With SMB** new files go to a small staging area in the data folder first and are then pushed to the share; when a file is needed (print start, download, photo) PrintDock fetches it back. Thumbnails stay local so the interface stays fast. Print files and photos are then **not** part of the PrintDock or HA backup – they already live on the NAS. Switching back to the data folder pulls everything back; the copies on the NAS stay. SMB needs `smbclient` – included in the add-on and Docker images, installed on the Pi by the installer (`apt install smbclient`), macOS `brew install samba`; Windows uses the network path directly.

*TrueNAS:* create a user with "Samba Authentication" and give it write access to the dataset; enter only the share name, not the path on the NAS. If Home Assistant runs as a VM on the same TrueNAS, the VM needs a network bridge to reach the NAS.

If the NAS is unreachable for a while, PrintDock stores locally meanwhile and moves the files over once it is back; *Today* and the platform check show this. For mounted folders a marker file prevents writing into an empty mount point on the local disk.

**Platform check:** *Settings → System → Platform check* shows installation type, data folder, ffmpeg, restart, update, remote access, Home Assistant, inbox, backup and time zone – and what is missing for everything to work as on the other platforms.

## Slicer

PrintDock presents itself to slicers as an OctoPrint server. In OrcaSlicer, PrusaSlicer, SuperSlicer and derivatives (Snapmaker Orca, Anycubic Slicer Next): printer profile → *Add/edit physical printer* → host type **OctoPrint** → address and API key from *Settings → Slicer*:

- `http://<printdock>:3080/slicer` – library only
- `http://<printdock>:3080/slicer/queue` – into the queue (matching printer)
- `http://<printdock>:3080/slicer/<printer-id>` – into the queue of a specific printer

**Bambu Studio:** use the **inbox folder** – *Export plate sliced file* (Ctrl+G) into `\\homeassistant\share\printdock` (add-on, Samba add-on required); the subfolder `warteschlange` puts the file straight into the queue. Paths are shown under *Settings → Slicer*. **Open in slicer** works via `orcaslicer://`, `bambustudio://`, `prusaslicer://`.

## Camera

PrintDock fetches images on the server and passes them to the browser, so credentials stay on the server and cameras browsers cannot show directly still work. The camera only runs while someone watches (plus 30 seconds).

| Printer | Protocol | Note |
|---|---|---|
| Bambu X1, H2D, H2S, X2D | RTSPS (port 322) | Enable "LAN live view" on the printer. Needs `ffmpeg`. |
| Bambu P1, A1 | JPEG stream (port 6000) | No extra software. |
| Anycubic (LAN mode) | via the printer | Enable the camera on the printer. |
| Klipper / Moonraker | snapshot URL | Read from Moonraker, or enter it in the printer dialog. |
| OctoPrint | snapshot URL | Default `/webcam/?action=snapshot`. |

`ffmpeg` is included in the Docker image and the add-on; otherwise `winget install ffmpeg`, `brew install ffmpeg` or your package manager. Endpoints: `/api/printers/:id/camera.jpg` and `/api/printers/:id/camera.mjpg`.

## Notifications

Any number of channels (ntfy, Telegram, Discord, Gotify, webhook – all but Gotify with image), each with its own events: print finished, started, paused, cancelled, error, offline for 2 minutes, photo after the first layer, maintenance due, spool running low, filament too humid, drying finished, emergency stop, PrintDock update available. After a restart only real state changes are reported; the same event is sent at most once per minute per printer.

## Writing a printer driver

Every vendor is a driver in `drivers/`. A driver extends `BaseDriver` (`drivers/base.js`), describes its settings in `static meta` (the UI builds the form from it), reports state with `this.update({...})` in the shared status format, and optionally implements `command(cmd)` (pause, resume, cancel, light, speed), `startPrint(job)` and `cameraSource()`. Register it in `drivers/index.js`. `drivers/demo.js` is the shortest example.

## Translations

German texts are the keys; `public/i18n-en.js` maps them to English. To add a language, copy that file (e.g. `i18n-fr.js`), translate it, load it in `index.html` and register it with `PD_I18N.register('fr', …)`. `npm run check` reports missing translations.

## Project layout

```
server.js              HTTP server, REST API, live updates (SSE), history, running jobs
launcher.js            Docker entry point (uses a newer version downloaded by the updater)
camera.js              camera proxy: HTTP snapshots, RTSP via ffmpeg, Bambu JPEG stream
notify.js              event detection and notification channels
drivers/               moonraker.js, anycubic.js, bambu.js, octoprint.js, demo.js, base.js
lib/
  app.js               language, accent colour, features, menu, login, users
  production.js        orders, queue, print start, print mode, maintenance
  startrules.js        start windows, cheap power
  failures.js          failed prints, requeue
  filament.js          spools, slots, deduction, usage, RFID
  reserve.js, shop.js  reservation, shopping list, orders
  drying.js, humcheck.js  humidity, drying, humidity check before start
  stations.js, tags.js PrintDock Station, tag formats
  spoolman.js          Spoolman sync
  homeassistant.js     plugs, MQTT discovery, cards, blueprints
  emergency.js         emergency stop
  energy.js, costs.js  electricity and costs
  statuspage.js        customer status page (data)
  statusrender.js      customer status page (HTML, shared with the status server)
  relay.js             sync with the status server
  storage.js           storage location (data folder, SMB, mounted folder) for print files, photos, backups
  smb.js               SMB share directly via smbclient
  archive.js           archive: detect outside prints, fetch the file from the printer, assign orders, search, CSV
  remote.js            remote access: Tailscale, Cloudflare Tunnel
  audit.js             log
  platform.js, env.js, hostinfo.js  platform check, environment
  updater.js           updates
  backup.js, autobackup.js  backups
  files.js, zip.js, inbox.js, slicer.js  file library, 3MF, inbox folder, slicer
  stats.js, i18n.js, store.js, …
public/                web interface without build step (app.js, board.js, today-ui.js, *-ui.js, i18n.js, i18n-en.js)
dist/printdock-card.js Home Assistant cards
blueprints/            Home Assistant automation blueprints
relay/                 status server for customer links (php/, server.js, Docker)
scripts/               install.sh, start-windows.cmd, station-sim.js, check.js, build-ha-addon.js
ha-addon/              Home Assistant add-on (config.yaml, Dockerfile, CHANGELOG.md)
docs/                  installation, getting started, remote access, screenshots
.github/               issue templates
data/                  JSON files, print files, photos (created on start)
```

The full API table is in the [German README](README.de.md#api).

## Contributing

New printers, translations and bug reports are welcome – please report bugs via the [issue template](https://github.com/Codegulasch/printdock/issues/new/choose) with version and platform check. Please run `npm run check` before opening a pull request.

## License

MIT
