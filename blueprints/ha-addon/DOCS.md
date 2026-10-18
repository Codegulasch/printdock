# PrintDock

*Deutsch unten · German below*

PrintDock manages and monitors 3D printers from any vendor in one place: live status, camera, parts and files, queue, orders, filament, maintenance and statistics.

> **Public beta** – PrintDock is used daily, but it is still under development and things may change. Your data is included in every Home Assistant backup, and PrintDock also makes its own daily backup. Please report bugs at https://github.com/Codegulasch/printdock/issues – with version and the platform check (*Settings → System*).

## After installing

1. **Start** the add-on and enable **Show in sidebar**.
2. Open PrintDock from the sidebar. A short **setup wizard** asks for language, look, the setup level (Hobby, Maker, Workshop) and – if wanted – loads demo data.
3. Add your printers under **Settings → Printers & filament**.

A step-by-step guide is in [Getting started](https://github.com/Codegulasch/printdock/blob/main/docs/getting-started.md).

## Home Assistant

As an add-on, PrintDock connects to Home Assistant automatically:

- **Power printers on/off:** choose a smart plug (e.g. `switch.printer_workshop`) per printer. Optionally PrintDock turns it off after printing once the nozzle has cooled down.
- **Printers as Home Assistant devices:** enable "MQTT devices" under **Settings → Home Assistant**. The Mosquitto add-on is used automatically. Every printer appears with status, progress, time left, temperatures, camera and buttons.
- **Dashboard cards:** the add-on installs the PrintDock cards automatically. In a dashboard choose **Add card → PrintDock Card** (one printer) or **PrintDock Overview** (all printers, queue, orders, low spools, maintenance). Reload the browser once after the first start.

## Direct access (port 3080)

Port 3080 is also reachable directly (`http://<home-assistant-ip>:3080`). It is needed for uploads from OrcaSlicer/PrusaSlicer, the PrintDock Station, the reslicing helper on your PC, camera images in Home Assistant and phone access on your home network. If port 3080 is reachable from outside your home network, enable **login protection** under **Settings → System**.

Remote access works through Home Assistant itself (Nabu Casa or your own HA remote access) – the sidebar entry uses Home Assistant's login. Alternatively switch on Tailscale or a Cloudflare Tunnel right in PrintDock under *Settings → Remote access*.

## Backup and moving

All data lives in the add-on's `/data` folder and is included in Home Assistant backups. In addition PrintDock saves a daily backup to `/share/printdock/sicherungen`. To move to a new installation, download a backup under **Settings → System → Backup** and restore it in the setup wizard of the new installation.

---

# PrintDock (Deutsch)

PrintDock verwaltet und überwacht 3D-Drucker aller Hersteller an einem Ort: Live-Status, Kamera, Teile und Dateien, Warteschlange, Aufträge, Filament, Wartung und Statistik.

> **Öffentliche Beta** – PrintDock wird täglich genutzt, ist aber noch in Entwicklung, und manches kann sich ändern. Deine Daten stecken in jeder Home-Assistant-Sicherung, zusätzlich sichert sich PrintDock täglich selbst. Fehler bitte unter https://github.com/Codegulasch/printdock/issues melden – mit Version und Plattform-Check (*Einstellungen → System*).

## Nach der Installation

1. **Starten** und **In der Seitenleiste anzeigen** einschalten.
2. PrintDock in der Seitenleiste öffnen. Ein kurzer **Einrichtungsassistent** fragt Sprache, Aussehen und die Ausbaustufe (Hobby, Maker, Werkstatt) ab und spielt auf Wunsch Demo-Daten ein.
3. Drucker unter **Einstellungen → Drucker & Filament** anlegen.

Schritt für Schritt: [Erste Schritte](https://github.com/Codegulasch/printdock/blob/main/docs/getting-started.de.md).

## Home Assistant

- **Drucker ein- und ausschalten:** beim Drucker eine Steckdose (z. B. `switch.drucker_werkstatt`) eintragen. Optional schaltet PrintDock nach dem Druck aus, sobald die Düse abgekühlt ist.
- **Drucker als Geräte:** unter **Einstellungen → Home Assistant** „MQTT-Geräte“ einschalten. Das Mosquitto-Add-on wird automatisch genutzt. Jeder Drucker erscheint mit Status, Fortschritt, Restzeit, Temperaturen, Kamera und Knöpfen.
- **Dashboard-Karten:** das Add-on installiert die PrintDock-Karten automatisch. Im Dashboard **Karte hinzufügen → PrintDock Card** (ein Drucker) oder **PrintDock Overview** (alle Drucker, Warteschlange, Aufträge, knappe Spulen, Wartung). Nach dem ersten Start den Browser einmal neu laden.

## Direktzugriff (Port 3080)

Port 3080 ist zusätzlich direkt erreichbar (`http://<home-assistant-ip>:3080`). Ihn brauchen Slicer-Uploads aus OrcaSlicer/PrusaSlicer, die PrintDock Station, der Umslice-Helfer auf dem PC, Kamerabilder in Home Assistant und das Handy im Heimnetz. Ist Port 3080 von außerhalb des Heimnetzes erreichbar, unter **Einstellungen → System** den **Login-Schutz** einschalten.

Fernzugriff läuft am einfachsten über Home Assistant selbst (Nabu Casa oder eigener HA-Fernzugriff) – der Seitenleisten-Eintrag nutzt die Home-Assistant-Anmeldung. Alternativ unter *Einstellungen → Fernzugriff* Tailscale oder einen Cloudflare Tunnel direkt in PrintDock einschalten.

## Sicherung und Umzug

Alle Daten liegen im Ordner `/data` des Add-ons und stecken in jeder Home-Assistant-Sicherung. Zusätzlich legt PrintDock täglich eine Sicherung unter `/share/printdock/sicherungen` ab. Für den Umzug auf eine neue Installation unter **Einstellungen → System → Datensicherung** eine Sicherung herunterladen und im Einrichtungsassistenten der neuen Installation einspielen.
