# Remote access

*English · [Deutsch](remote-access.de.md)*

PrintDock is built for your home network. For access on the go there are three safe options – **never** just forward port 3080 on your router.

> PrintDock is in **public beta** – please report problems via [GitHub issues](https://github.com/Codegulasch/printdock/issues/new/choose).

| Option | For | Publicly reachable? | Login protection needed? |
|---|---|---|---|
| **Tailscale** (VPN) | You and your devices only | No | Recommended |
| **Cloudflare Tunnel** | Your own address with HTTPS, e.g. for colleagues | Yes | **Required** |
| **Home Assistant** (add-on) | If you already use Home Assistant remotely | via HA | No (HA login) |

Finish the setup wizard in PrintDock first (it is reachable without login until it is completed).

## Easiest: right in PrintDock (0.15+)

**Settings → Remote access.** When you switch an option on, PrintDock downloads the matching program by itself (into the data folder under `bin/`, kept across updates, not included in backups) and starts it again on every start. Works the same for the Home Assistant add-on, Docker and a Raspberry Pi – no root rights and no `/dev/net/tun` needed.

**Tailscale**
1. Switch on *Tailscale*.
2. Without an auth key, *Sign in to Tailscale* appears – open the link and confirm with your Tailscale account. With an auth key (*Tailscale admin → Settings → Keys*) it works without a click.
3. The page then shows the address, e.g. `http://printdock:3080`, and – if *HTTPS Certificates* is enabled under *DNS* in your tailnet – `https://printdock.<tailnet>.ts.net`. You need the HTTPS address for NFC on your phone.
4. *Sign out and reset* leaves the tailnet; afterwards remove the device in the Tailscale admin console.

**Cloudflare Tunnel** (only with login protection)
- *Quick test*: no account needed, random address `https://….trycloudflare.com` – it changes on every restart.
- *Own address*: create a tunnel in Cloudflare Zero Trust (*Networks → Tunnels → Create → Cloudflared*), paste the token into PrintDock (pasting the whole command shown works too) and under *Public Hostname* add e.g. `printer.example.com` with service **HTTP** and URL **`localhost:3080`**.
- If you turn login protection off, PrintDock stops the tunnel to be safe.

**Login “Only from outside”**: under *Settings → Remote access → Require sign-in* you choose whether sign-in is required *Always* or *Only from outside*. “Only from outside” means: devices on your home network (private address, no proxy) and the Home Assistant sidebar get in without a password; everything coming in via tunnel or Tailscale needs the password. The Home Assistant sidebar never asks for the PrintDock password – Home Assistant has already signed you in.

The Docker Compose setups below still work, e.g. if Tailscale is already running on the machine.

## Turn on login protection

**Settings → System → Access**: switch on **Login protection**, enter user and password (at least 6 characters), *Save access*. From then on every browser needs to sign in (valid for 30 days). After 5 wrong attempts there is a one-minute pause.

Without signing in, only these remain reachable:
- `/slicer/…` – uploads from the slicer, protected by the slicer API key,
- camera image and download links with `?k=<API key>` (for Home Assistant); the key is under *Settings → System → Access → API key*.

## Tailscale with Docker Compose

1. Create a free account at [tailscale.com](https://tailscale.com) and install Tailscale on your phone/laptop.
2. Create an auth key: *Admin console → Settings → Keys → Generate auth key*.
3. Next to `docker-compose.yml`, create a file `.env` (template: `.env.example`):
   ```
   TS_AUTHKEY=tskey-auth-…
   TS_HOSTNAME=printdock
   ```
4. Start:
   ```bash
   docker compose --profile tailscale up -d
   ```
5. On the go (Tailscale on): `http://printdock:3080`

If PrintDock runs without Docker (Raspberry Pi with `install.sh`), install Tailscale directly: `curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up`. For HTTPS in your tailnet: `sudo tailscale serve --bg 3080` → `https://printdock.<tailnet>.ts.net`.

## Cloudflare Tunnel with Docker Compose

Requirement: your own domain at Cloudflare.

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → *Networks → Tunnels → Create a tunnel* → type *Cloudflared* → give it a name → copy the **token** shown.
2. Under *Public Hostname* add e.g. `printer.example.com`, service **HTTP**, URL **`localhost:3080`**.
3. In `.env`:
   ```
   CF_TUNNEL_TOKEN=eyJh…
   ```
4. Start:
   ```bash
   docker compose --profile cloudflare up -d
   ```
5. **Turn on login protection** in PrintDock (see [above](#turn-on-login-protection)). You can additionally put Cloudflare *Access* in front (e.g. sign-in with an email code).

Without Docker: install `cloudflared` following the [guide](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/) and run `sudo cloudflared service install <TOKEN>`.

Notes:
- Slicer upload through the tunnel: address `https://printer.example.com/slicer/queue` with the slicer API key.
- On the free plan, Cloudflare limits uploads to 100 MB per file.

## Home Assistant

As an add-on, PrintDock appears in the Home Assistant sidebar. If your Home Assistant is reachable from outside (Nabu Casa or your own setup), PrintDock is too – with the Home Assistant login.

## Customer links for customers outside your network

Status pages for customers run on your own **status server** on the internet – set it up under *Settings → Remote access → Customer links*, guide in [relay/README.md](../relay/README.md).

Back to [Getting started](getting-started.md) · [Installation](installation.md)
