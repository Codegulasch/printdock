# Fernzugriff

*[English](remote-access.md) · Deutsch*

PrintDock ist fürs Heimnetz gebaut. Für den Zugriff von unterwegs gibt es drei sichere Wege – **niemals** einfach Port 3080 am Router freigeben.

> PrintDock ist in der **öffentlichen Beta** – Probleme bitte über [GitHub-Issues](https://github.com/Codegulasch/printdock/issues/new/choose) melden.

| Weg | Für wen | Öffentlich erreichbar? | Login-Schutz nötig? |
|---|---|---|---|
| **Tailscale** (VPN) | Nur du und deine Geräte | Nein | Empfohlen |
| **Cloudflare Tunnel** | Eigene Adresse mit HTTPS, z. B. für Kollegen | Ja | **Pflicht** |
| **Home Assistant** (Add-on) | Wer Home Assistant schon von außen nutzt | über HA | nein (HA-Login) |

Zuerst die Einrichtung in PrintDock abschließen (der Assistent ist ohne Login erreichbar, solange er nicht abgeschlossen ist).

## Am einfachsten: direkt in PrintDock (ab 0.15)

**Einstellungen → Fernzugriff.** PrintDock lädt das passende Programm beim Einschalten selbst herunter (in den Datenordner unter `bin/`, bleibt bei Updates erhalten, nicht in Sicherungen) und startet es bei jedem Start wieder. Gleich für Home-Assistant-Add-on, Docker und Raspberry Pi – es braucht keine Root-Rechte und kein `/dev/net/tun`.

**Tailscale**
1. Schalter *Tailscale* einschalten.
2. Ohne Auth-Key erscheint *Bei Tailscale anmelden* – Link öffnen, mit dem eigenen Tailscale-Konto bestätigen. Mit Auth-Key (*Tailscale-Admin → Settings → Keys*) geht es ohne Klick.
3. Danach zeigt die Seite die Adresse, z. B. `http://printdock:3080`, und – wenn im Tailnet unter *DNS → HTTPS Certificates* eingeschaltet – `https://printdock.<tailnet>.ts.net`. Die HTTPS-Adresse braucht es für NFC am Handy.
4. *Abmelden und zurücksetzen* verlässt das Tailnet; das Gerät danach im Tailscale-Admin entfernen.

**Cloudflare Tunnel** (nur mit Login-Schutz)
- *Schnelltest*: ohne Konto, zufällige Adresse `https://….trycloudflare.com` – ändert sich bei jedem Neustart.
- *Eigene Adresse*: in Cloudflare Zero Trust einen Tunnel anlegen (*Networks → Tunnels → Create → Cloudflared*), den Token in PrintDock einfügen (auch der ganze angezeigte Befehl geht) und unter *Public Hostname* z. B. `drucker.example.com` mit Service **HTTP** und URL **`localhost:3080`** eintragen.
- Wird der Login-Schutz ausgeschaltet, stoppt PrintDock den Tunnel sicherheitshalber.

**Login-Schutz „Nur von außen“**: Unter *Einstellungen → Fernzugriff → Anmeldung verlangen* lässt sich wählen, ob die Anmeldung *Immer* oder *Nur von außen* verlangt wird. „Nur von außen“ heißt: Geräte im Heimnetz (private Adresse, kein Proxy) und die Home-Assistant-Seitenleiste ohne Passwort; alles, was über Tunnel oder Tailscale kommt, mit Passwort. Die Home-Assistant-Seitenleiste fragt nie nach dem PrintDock-Passwort – Home Assistant hat schon angemeldet.

Die Wege mit Docker Compose (unten) funktionieren weiterhin, z. B. wenn Tailscale schon auf dem Rechner läuft.

## Login-Schutz einschalten

**Einstellungen → System → Zugriff**: **Login-Schutz** einschalten, Benutzer und Passwort (mind. 6 Zeichen) eintragen, *Zugang speichern*. Danach braucht jeder Browser eine Anmeldung (30 Tage gültig). Nach 5 falschen Versuchen ist eine Minute Pause.

Ohne Anmeldung bleiben nur erreichbar:
- `/slicer/…` – Upload aus dem Slicer, geschützt durch den Slicer-API-Key,
- Kamerabild und Download-Links mit `?k=<API-Key>` (für Home Assistant), Schlüssel unter *Einstellungen → System → Zugriff → API-Key*.

## Tailscale mit Docker Compose

1. Kostenloses Konto auf [tailscale.com](https://tailscale.com), Tailscale auf Handy/Laptop installieren.
2. Auth-Key erzeugen: *Admin-Konsole → Settings → Keys → Generate auth key*.
3. Neben `docker-compose.yml` eine Datei `.env` anlegen (Vorlage `.env.example`):
   ```
   TS_AUTHKEY=tskey-auth-…
   TS_HOSTNAME=printdock
   ```
4. Starten:
   ```bash
   docker compose --profile tailscale up -d
   ```
5. Von unterwegs (Tailscale an): `http://printdock:3080`

Läuft PrintDock ohne Docker (Raspberry Pi mit `install.sh`), Tailscale direkt installieren: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`. Für HTTPS im Tailnet: `sudo tailscale serve --bg 3080` → `https://printdock.<tailnet>.ts.net`.

## Cloudflare Tunnel mit Docker Compose

Voraussetzung: eine eigene Domain bei Cloudflare.

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → *Networks → Tunnels → Create a tunnel* → Typ *Cloudflared* → Namen vergeben → den angezeigten **Token** kopieren.
2. Unter *Public Hostname* z. B. `drucker.example.com` anlegen, Service **HTTP**, URL **`localhost:3080`**.
3. In `.env`:
   ```
   CF_TUNNEL_TOKEN=eyJh…
   ```
4. Starten:
   ```bash
   docker compose --profile cloudflare up -d
   ```
5. In PrintDock den **Login-Schutz einschalten** (siehe [oben](#login-schutz-einschalten)). Zusätzlich lässt sich in Cloudflare *Access* davorschalten (z. B. Anmeldung per E-Mail-Code).

Ohne Docker: `cloudflared` nach [Anleitung](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) installieren und `sudo cloudflared service install <TOKEN>` ausführen.

Hinweise:
- Slicer-Upload über den Tunnel: Adresse `https://drucker.example.com/slicer/queue` mit dem Slicer-API-Key.
- Cloudflare begrenzt Uploads im kostenlosen Tarif auf 100 MB pro Datei.

## Home Assistant

Als Add-on erscheint PrintDock in der Home-Assistant-Seitenleiste. Ist Home Assistant von außen erreichbar (Nabu Casa oder eigener Zugang), ist es PrintDock automatisch auch – mit der Home-Assistant-Anmeldung.

## Kunden-Links für Kunden außerhalb des Heimnetzes

Statusseiten für Kunden laufen über einen eigenen **Status-Server** im Internet – Einrichtung unter *Einstellungen → Fernzugriff → Kunden-Links*, Anleitung in [relay/README.de.md](../relay/README.de.md).

Zurück zu den [ersten Schritten](getting-started.de.md) · [Installation](installation.de.md)
