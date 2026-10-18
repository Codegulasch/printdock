# PrintDock for developers

*English · [Deutsch](development.de.md)*

This page is for everyone who wants to work on PrintDock, write a printer driver or talk to PrintDock from their own scripts. For using PrintDock, the [README](../README.md) is all you need.

## Running from source

```bash
git clone https://github.com/Codegulasch/printdock.git
cd printdock
npm install
npm start                 # http://localhost:3080
npm run check             # syntax, translations, server round trip – before every pull request
```

Useful environment variables: `PORT` (default 3080), `DATA_DIR` (data folder, default `./data`), `TZ` (time zone), `INBOX_DIR` and `BACKUP_DIR` (inbox folder, backups).

`node scripts/station-sim.js [ws://localhost:3080/api/station/ws]` simulates a PrintDock Station without hardware – it then shows up with a pairing code in PrintDock. For tests without printers there is the *Demo* driver and the demo data (*Settings → System → Setup*).

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
  parts.js             parts with variants
  reslice.js           reslicing: learned profiles, jobs for the helper
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
helper/                reslicing helper for the PC (OrcaSlicer; built into executables by GitHub Actions)
```

## API

All endpoints live under `/api/`. With login protection use a session or the API key (*Settings → System*). Changes are pushed live via SSE to every open interface.

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/printers` | Printers with status / add `{name, driver, config}` |
| PUT / DELETE | `/api/printers/:id` | Change / remove a printer |
| PUT | `/api/printers/:id/area` | Assign a printer to an area `{area}` |
| POST | `/api/printers/:id/command` | `{cmd: "pause" \| "resume" \| "cancel" \| "light" \| "speed", …}` |
| POST | `/api/printers/:id/plate-clear` | Confirm the build plate is clear |
| POST | `/api/printers/:id/power` | Smart plug via Home Assistant `{on}` |
| GET | `/api/printers/:id/camera.jpg`, `…/camera.mjpg` | Snapshot / live image |
| GET / DELETE | `/api/history` | Read / clear the history |
| GET | `/api/archive?q&from&to&printer&result&source&order&offset&limit` | Archive with filters, totals and paging; `/api/archive/export.csv` as CSV |
| GET / POST | `/api/archive/:id/candidates`, `/api/archive/:id/{assign,reprint}` | Matching orders, assign `{orderId, positionId} \| {none: true} \| {orderId: null}`, print again |
| GET / PUT | `/api/storage`, POST `/api/storage/test`, `/api/storage/sync` | Storage location `{mode: "local" \| "smb" \| "folder", smb: {server, share, dir, user, password, domain}, path, files, photos, backups}`, test connection, push staged files |
| POST | `/api/orders/:id/use-file` | Switch an order to a new file version `{from, to}` |
| POST | `/api/history/:id/{fail,unfail,requeue,dismiss}` | Mark as failed, undo, requeue, "fine as is" |
| GET / POST | `/api/files` | Library / upload (raw body, file name in the `X-Filename` header) |
| POST | `/api/files/:id/assign` | Assign a file to a part `{partId \| partName, targets: [printerId]}` (empty targets = by printer model) |
| GET / POST / PUT / DELETE | `/api/parts`, `/api/parts/:id` | Parts with variants and coverage per printer / create `{name}` / rename / delete (files stay) |
| GET | `/api/reslice`, `/api/reslice/plan?part&printer` | Reslicing: helper, learned profiles, jobs / data for the dialog |
| POST / DELETE | `/api/reslice/jobs`, `/api/reslice/jobs/:id`, POST `…/retry` | Reslice job `{partId, printerId, sourceFileId?, plate?, materials?}` / remove / retry |
| DELETE / POST | `/api/reslice/profiles/:printerId`, `/api/reslice/token` | Forget a learned profile, new pairing code |
| GET / POST | `/helper/{hello,poll,jobs/:id/source,jobs/:id/result,jobs/:id/fail}` | Interface for the reslicing helper (pairing code as bearer token, no login) |
| GET / POST | `/api/queue` | Queue / schedule `{fileId \| partId, printerId?, areaId?, count, mode?, options}` – `partId` schedules a part (variant per printer), `areaId` limits the printer choice to an area |
| PUT / DELETE | `/api/queue/:id` | Change / remove an entry |
| POST | `/api/queue/:id/{start,requeue,resolve,humcheck,dry-start,dry-cancel}` | Start, requeue, close a stuck entry `{result}`, humidity check, dry first |
| POST | `/api/queue/reorder`, `/api/queue/clear-finished` | Reorder / remove finished entries |
| GET / POST | `/api/orders` | Orders (with `shareUrl`) / create, optional `areaId` |
| PUT / DELETE | `/api/orders/:id` | Change / delete an order |
| POST | `/api/orders/:id/{plan,mode,post,share,archive}` | Schedule, print mode `{mode: "auto" \| "manual" \| "single"}`, post-processing, status link, archive |
| GET | `/api/maintenance` | Maintenance tasks, operating hours, log |
| GET | `/api/filament` | Spools, slots, usage, reservations |
| POST | `/api/filament/{assign,from-slot,dry}` | Assign a spool, create from a slot, dry |
| GET | `/api/filament/{check,mapping,humcheck,reservations}` | Enough filament? Colour mapping, humidity check, reservations |
| GET / POST | `/api/filament/shop`, `…/shop/order`, `…/shop/order/:id/arrived` | Shopping list, ordered, arrived |
| POST / PUT / DELETE | `/api/filament/dryers`, `/api/filament/hum-sources` | Dryers, humidity sources |
| POST / PUT / DELETE | `/api/spools`, `/api/spools/:id` | Spools; `…/weigh`, `…/book`, `…/dried`, `…/store` |
| POST | `/api/rfid`, `/api/rfid/phone` | Tag from an ESPHome reader `{tag, printer, slot}` / from the phone |
| GET / PUT / DELETE | `/api/stations`, `/api/stations/:id` | Stations |
| POST | `/api/stations/pair`, `/api/stations/:id/{tare,calibrate,identify,weigh,write,undo,arm}` | Pair, tare, calibrate, identify, weigh, write a tag, undo the last weighing, arm for loading |
| WS | `/api/station/ws` | Station connection |
| GET / PUT | `/api/ha` | Home Assistant settings; `…/test`, `…/entities`, `…/blueprints`, `…/emergency` |
| GET / PUT | `/api/remote` | Remote access (Tailscale, Cloudflare) |
| GET / PUT | `/api/relay`, POST `/api/relay/test` | Status server for customer links |
| GET / POST / PUT / DELETE | `/api/users`, `/api/users/:id` | Users |
| GET | `/api/audit`, `/api/platform` | Log, platform check |
| GET | `/api/summary`, `/api/stats?days=30` | Key figures (incl. `startInfo` per printer), statistics |
| GET / PUT | `/api/app` | Language, accent colour, features, menu, login protection, areas `{areas: [{id, name}]}` |
| POST | `/api/login`, `/api/logout` | Log in / out |
| GET | `/api/events` | Live stream (SSE) |
| GET | `/status/<code>` | Customer status page (no login) |

## Contributing

New printers, translations and bug reports are welcome. Please report bugs via the [issue template](https://github.com/Codegulasch/printdock/issues/new/choose) with version and platform check, and run `npm run check` before opening a pull request.
