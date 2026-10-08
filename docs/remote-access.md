# Fernzugriff · Remote access

*English below.*

PrintDock ist fürs Heimnetz gebaut. Für den Zugriff von unterwegs gibt es drei sichere Wege – **niemals** einfach Port 3080 am Router freigeben.

| Weg | Für wen | Öffentlich erreichbar? | Login-Schutz nötig? |
|---|---|---|---|
| **Tailscale** (VPN) | Nur du und deine Geräte | Nein | Empfohlen |
| **Cloudflare Tunnel** | Eigene Adresse mit HTTPS, z. B. für Kollegen | Ja | **Pflicht** |
| **Home Assistant** (Add-on) | Wer Home Assistant schon von außen nutzt | über HA | nein (HA-Login) |

Zuerst die Einrichtung in PrintDock abschließen (der Assistent ist ohne Login erreichbar, solange er nicht abgeschlossen ist).

## Login-Schutz einschalten

**Einstellungen → Allgemein → Zugriff und Sicherheit**: Benutzer und Passwort (mind. 6 Zeichen) eintragen, **Login-Schutz** einschalten. Danach braucht jeder Browser eine Anmeldung (30 Tage gültig). Nach 5 falschen Versuchen ist eine Minute Pause.

Ohne Anmeldung bleiben nur erreichbar:
- `/slicer/…` – Upload aus dem Slicer, geschützt durch den Slicer-API-Key,
- Kamerabild und Download-Links mit `?k=<API-Key>` (für Home Assistant), Schlüssel unter *Einstellungen → Allgemein → API-Key*.

## Tailscale

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

## Cloudflare Tunnel

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
5. In PrintDock den **Login-Schutz einschalten** (siehe oben). Zusätzlich lässt sich in Cloudflare *Access* davorschalten (z. B. Anmeldung per E-Mail-Code).

Ohne Docker: `cloudflared` nach [Anleitung](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) installieren und `sudo cloudflared service install <TOKEN>` ausführen.

Hinweise:
- Slicer-Upload über den Tunnel: Adresse `https://drucker.example.com/slicer/queue` mit dem Slicer-API-Key.
- Cloudflare begrenzt Uploads im kostenlosen Tarif auf 100 MB pro Datei.

## Home Assistant

Als Add-on erscheint PrintDock in der Home-Assistant-Seitenleiste. Ist Home Assistant von außen erreichbar (Nabu Casa oder eigener Zugang), ist es PrintDock automatisch auch – mit der Home-Assistant-Anmeldung.

---

## English

PrintDock is built for your home network. For access on the go there are three safe options – **never** just forward port 3080 on your router.

| Option | For | Public? | Login protection |
|---|---|---|---|
| **Tailscale** (VPN) | You and your devices only | No | Recommended |
| **Cloudflare Tunnel** | Own address with HTTPS, e.g. for colleagues | Yes | **Required** |
| **Home Assistant** (add-on) | If you already use HA remotely | via HA | no (HA login) |

Finish the setup wizard first (it is reachable without login until completed).

**Login protection:** *Settings → General → Access and security* – set user and password (min. 6 characters), enable **Login protection**. Sessions last 30 days; 5 wrong attempts lock for a minute. Without login only `/slicer/…` (slicer API key) and camera/download links with `?k=<API key>` remain reachable.

**Tailscale:** create an auth key in the Tailscale admin console, put `TS_AUTHKEY=…` into `.env`, run `docker compose --profile tailscale up -d`, then open `http://printdock:3080` from any device in your tailnet. Without Docker: install Tailscale on the host; `sudo tailscale serve --bg 3080` adds HTTPS.

**Cloudflare Tunnel:** in Cloudflare Zero Trust create a tunnel (type Cloudflared), add a public hostname pointing to `http://localhost:3080`, put the token into `.env` as `CF_TUNNEL_TOKEN=…`, run `docker compose --profile cloudflare up -d` and **enable login protection** in PrintDock. Optionally put Cloudflare Access in front. Free plan uploads are limited to 100 MB per file.

**Home Assistant:** the add-on is available wherever your Home Assistant is, using Home Assistant's login.
