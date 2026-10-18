# Getting started

*English · [Deutsch](getting-started.de.md)*

From first start to the first print from PrintDock in ten minutes. Installation: [installation.md](installation.md).

> **Public beta:** PrintDock is used every day, but it is still in public beta – things can still change. Make regular backups (*Settings → System → Backup*) and please report problems via [GitHub issues](https://github.com/Codegulasch/printdock/issues/new/choose), including the version and the *Platform check* (*Settings → System → Platform check*).

## 1. Setup wizard

On first open (`http://<ip>:3080`, or via the sidebar when running as a Home Assistant add-on) PrintDock asks for language, appearance, the **setup level** (Hobby, Maker or Workshop – you can change it any time) and access. Just want to look around first? **Load demo data** creates five simulated printers with orders and history – remove them again with one click (*Settings → System*).

## 2. Add printers

*Printers → + Printer*. Choose the connection:

| Printer | Connection | What you need |
|---|---|---|
| Snapmaker U1, Voron, Klipper in general | Klipper / Moonraker | IP address |
| Bambu Lab (X1, P1, A1, H2D, X2D) | Bambu Lab (LAN) | IP, serial number, access code (network menu); LAN mode, developer mode on newer firmware |
| Anycubic Kobra S1 / Kobra 3 (stock firmware) | Anycubic (LAN mode) | LAN mode on the printer, IP; starting prints needs Rinkhals |
| Marlin with OctoPrint | OctoPrint | API key |

Enter the **Printer model** exactly as your slicer names it (e.g. “Bambu Lab X2D”) – prints without a fixed printer then only go to matching machines. Several printers in different rooms or a print farm? *Settings → Printers & filament → Areas …*

## 3. Get files in

- **OrcaSlicer, PrusaSlicer & co.:** in the printer profile, add a physical printer of type *OctoPrint* with the address and API key from *Settings → Slicer*. “Upload and print” goes straight into the queue.
- **Bambu Studio:** *Export plate sliced file* into the inbox folder (path under *Settings → Slicer*).
- **By hand:** *Files → Parts → Upload* (G-code or sliced 3MF). PrintDock asks which **part** the file belongs to and which printers it is for. If you slice the same part for a second printer, it becomes another variant – you schedule the part, and it prints on whichever free printer has a matching variant.
- If you keep printing straight from the slicer to the printer, the print still ends up in the **Archive** – PrintDock fetches the file from the printer.

## 4. Print

- **Single print:** *Queue → Schedule file*, pick a printer or “Matching printer”, then **Start**.
- **Orders:** *Orders → New order* – files with quantity, due date and priority. The **Print mode** decides what happens next: *Series print (automatic)* starts by itself after “plate clear”, *Series print (manual)* waits for the start button, *Single print* schedules one part at a time.
- After every print the printer card shows **Clear plate**. Nothing continues until you press **Plate is clear** – a print never lands on an occupied bed.

## 5. Filament

Add spools under *Filament → Spools* (material, colour, weight, price) and load them into slots under *Slots*. Bambu spools with an RFID chip are assigned automatically. From then on PrintDock deducts the usage after every print, warns about low spools and reserves filament for the queue.

## 6. Keep an eye on everything

- **Today** – what to do, what is running, what comes next.
- **Archive** – every print with start and end, search, filters, CSV export.
- **Notifications** – ntfy, Telegram, Discord, Gotify or webhook, optionally with a camera snapshot.
- **Home Assistant** – plugs, MQTT devices, dashboard cards, blueprints.

## 7. Backup and storage

PrintDock backs itself up daily (*Settings → System → Automatic backup*); a manual backup is under *Settings → System → Backup*. Print files, photos and backups can live on a **NAS** (SMB share directly, no mounting needed) – *Settings → System → Storage location*.

## Next steps

- [Installation](installation.md)
- [Remote access](remote-access.md) – reach PrintDock safely when you're away
- [Overview of all features](../README.md)

Questions or bugs: [GitHub issues](https://github.com/Codegulasch/printdock/issues/new/choose). Please include the version (*Settings → System*) and the *Platform check*.
