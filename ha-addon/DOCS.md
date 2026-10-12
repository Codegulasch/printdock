# PrintDock

*Deutsch unten · German below*

PrintDock manages and monitors 3D printers from any vendor in one place: live status, camera, queue, orders, filament, maintenance and statistics.

## After installing

1. **Start** the add-on and enable **Show in sidebar**.
2. Open PrintDock from the sidebar. A short **setup wizard** asks for language, look, the features you need and – if wanted – loads demo data.
3. Add your printers under **Settings → Printers**.

## Home Assistant

As an add-on, PrintDock connects to Home Assistant automatically:

- **Power printers on/off:** choose a smart plug (e.g. `switch.printer_workshop`) per printer. Optionally PrintDock turns it off after printing once the nozzle has cooled down.
- **Printers as Home Assistant devices:** enable "MQTT devices" under **Settings → Home Assistant**. The Mosquitto add-on is used automatically. Every printer appears with status, progress, time left, temperatures, camera and buttons.
- **Dashboard cards:** the add-on installs the PrintDock cards automatically. In a dashboard choose **Add card → PrintDock Card** (one printer) or **PrintDock Overview** (all printers, queue, orders, low spools, maintenance). Reload the browser once after the first start.

## Backup

All data lives in the add-on's `/data` folder and is included in Home Assistant backups. To move to a new Home Assistant installation, download a backup under **Settings → System → Backup** and restore it in the setup wizard of the new installation.

## Direct access (port 3080)

Port 3080 is also reachable directly (`http://<home-assistant>:3080`). It is used for uploads from OrcaSlicer/PrusaSlicer, camera images in Home Assistant and phone access on your home network. Remove the port mapping in the add-on configuration if you don't need it. If port 3080 is reachable from outside, enable **login protection** under **Settings → General**.

Remote access works through Home Assistant itself (Nabu Casa or your own HA remote access) – the sidebar entry uses Home Assistant's login. Alternatively switch on Tailscale or a Cloudflare Tunnel right in PrintDock under *Settings → Remote access*.

## Data

All data is stored in the add-on data folder and included in Home Assistant backups.

---

# PrintDock (Deutsch)

PrintDock verwaltet und überwacht 3D-Drucker aller Hersteller an einem Ort: Live-Status, Kamera, Warteschlange, Aufträge, Filament, Wartung und Statistik.

## Nach der Installation

1. **Starten** und **In der Seitenleiste anzeigen** einschalten.
2. PrintDock in der Seitenleiste öffnen. Ein kurzer **Einrichtungsassistent** fragt Sprache, Aussehen und die gewünschten Funktionen ab und spielt auf Wunsch Demo-Daten ein.
3. Drucker unter **Einstellungen → Drucker** anlegen.

## Home Assistant

- **Drucker ein- und ausschalten:** beim Drucker eine Steckdose (z. B. `switch.drucker_werkstatt`) eintragen. Optional schaltet PrintDock nach dem Druck aus, sobald die Düse abgekühlt ist.
- **Drucker als Geräte:** unter **Einstellungen → Home Assistant** „MQTT-Geräte“ einschalten. Das Mosquitto-Add-on wird automatisch genutzt.
- **Dashboard-Karten:** das Add-on installiert die PrintDock-Karten automatisch. Im Dashboard **Karte hinzufügen → PrintDock Card** (ein Drucker) oder **PrintDock Overview** (alle Drucker, Warteschlange, Aufträge, knappe Spulen, Wartung). Nach dem ersten Start den Browser einmal neu laden.

## Datensicherung

Alle Daten liegen im Ordner `/data` des Add-ons und stecken in jeder Home-Assistant-Sicherung. Für den Umzug auf eine neue Home-Assistant-Installation unter **Einstellungen → System → Datensicherung** eine Sicherung herunterladen und im Einrichtungsassistenten der neuen Installation einspielen.

## Direktzugriff (Port 3080)

Für Slicer-Uploads, Kamerabilder in Home Assistant und das Handy im Heimnetz. Wer ihn nicht braucht, entfernt die Portzuordnung in der Add-on-Konfiguration. Ist Port 3080 von außen erreichbar, unter **Einstellungen → Allgemein** den **Login-Schutz** einschalten.

Fernzugriff läuft am einfachsten über Home Assistant selbst (Nabu Casa oder eigener HA-Fernzugriff) – der Seitenleisten-Eintrag nutzt die Home-Assistant-Anmeldung. Alternativ unter *Einstellungen → Fernzugriff* Tailscale oder einen Cloudflare Tunnel direkt in PrintDock einschalten.

## Daten

Alle Daten liegen im Add-on-Datenordner und sind in Home-Assistant-Backups enthalten.
