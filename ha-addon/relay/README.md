# PrintDock status server

*English · [Deutsch](README.de.md)*

> PrintDock is in **public beta** – please report problems via [GitHub issues](https://github.com/Codegulasch/printdock/issues/new/choose).

Public status pages for your customers – without opening your home network. Two equivalent variants with the same interface: **PHP** for regular web hosting (`relay/php`) and **Node.js/Docker** for your own server (`relay/server.js`).

PrintDock usually runs on your home network (`192.168.x.x`). A customer link pointing there does not work for customers. The status server runs on a separate server on the internet: whenever a shared order changes, PrintDock **pushes** the status data (progress, due date, estimated finish, post-processing – **no costs**) and the photos of the finished parts to it. The customer opens `https://status.example.com/s/<code>`. Connections only go out from PrintDock.

- Node.js 18+, no dependencies, no database (files in the `data/` folder)
- several PrintDock installations possible – each with its own key
- pages are deleted automatically after the order is completed (configurable in PrintDock, default 30 days)
- turning a link off or deleting the order in PrintDock deletes the page here too

## Setup on a web hosting package (PHP) – the easiest way

For regular web hosting (PHP 7.4 or newer, FTP access) – no own server, no Node, no database needed.

1. Upload the folder **`relay/php`** to your web space via FTP, e.g. as **`/status`** (the address is then `https://your-domain.com/status`). Or point a subdomain like `status.your-domain.com` at it.
2. There, copy **`config.sample.php`** to **`config.php`** and enter a long, random key (e.g. from a password generator, 40+ characters).
3. Check: `https://your-domain.com/status/health` shows `{"ok":true,…}`.
4. In PrintDock: *Settings → Remote access → Customer links* → address `https://your-domain.com/status`, enter the key, switch it on, *Test connection*.

If `…/status/health` does not work (error 404), your host has no URL rewriting (`mod_rewrite`) enabled. Then enter **`https://your-domain.com/status/index.php`** as the address in PrintDock – customer links then look like this: `…/status/index.php/s/<code>`. If that does not work either: **`https://your-domain.com/status/index.php?r=`**.

Notes:
- The data is stored in `status/data/` and blocked via `.htaccess`. On hosts without `.htaccess` support (nginx), set `data` in `config.php` to a folder **outside** the web directory.
- PrintDock sends changes as `POST` with `X-HTTP-Method-Override` and additionally sends the key as `X-Relay-Key` – so it also works with hosts that block `PUT`/`DELETE` or the `Authorization` header.
- Photos up to 3 MB; if your host has a very small upload limit (`post_max_size`), raise it if needed.

## Setup with Docker (own server)

In the PrintDock folder (the status server also needs the file `lib/statusrender.js` from the PrintDock repository):

```bash
cd relay
echo "RELAY_KEYS=werkstatt:$(openssl rand -hex 24)" > .env
cat .env                       # Schlüssel notieren – kommt in PrintDock
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

`RELAY_KEYS` has the form `name:key` (several PrintDock installations: separate with commas) – note down the key, you will enter it in PrintDock.

The container only listens on `127.0.0.1:8080`. Put a reverse proxy with HTTPS in front of it.

**Caddy** (`/etc/caddy/Caddyfile`):

```
status.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

**nginx**:

```nginx
server {
    server_name status.example.com;
    client_max_body_size 4m;
    location / { proxy_pass http://127.0.0.1:8080; proxy_set_header X-Forwarded-For $remote_addr; }
    # listen 443 ssl; … (z. B. certbot --nginx)
}
```

## Without Docker (systemd)

```bash
sudo mkdir -p /opt/printdock-relay && sudo cp relay/server.js /opt/printdock-relay/ && sudo cp lib/statusrender.js /opt/printdock-relay/render.js
sudo tee /etc/systemd/system/printdock-relay.service >/dev/null <<'EOF'
[Unit]
Description=PrintDock Status-Server
After=network.target
[Service]
Environment=PORT=8080 DATA_DIR=/var/lib/printdock-relay RELAY_KEYS=werkstatt:HIER-SCHLUESSEL
ExecStart=/usr/bin/node /opt/printdock-relay/server.js
Restart=always
DynamicUser=yes
StateDirectory=printdock-relay
[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now printdock-relay
```

Replace `HIER-SCHLUESSEL` with your own long, random key.

## In PrintDock

*Settings → Remote access → Customer links*: enter the *Status server address* (`https://status.example.com`) and the key, switch it on, *Test connection*. From then on, customer links, QR codes and labels point to the status server. Optional: *Company name on the page* and website for the page footer.

## Interface

`Authorization: Bearer <key>`

| Method | Path | Content |
|---|---|---|
| GET | `/api/v1/ping` | `{ ok, name, version }` |
| PUT | `/api/v1/orders/<code>` | JSON `{ lang, data, brand, expiresAt }` → `{ missing: [photo IDs] }` |
| PUT | `/api/v1/orders/<code>/photos/<id>` | JPEG, max. 3 MB |
| DELETE | `/api/v1/orders/<code>` | delete the page |

Public: `GET /s/<code>`, `GET /s/<code>/p/<id>.jpg`, `GET /health`. The code is 24 random characters (96 bits) and cannot be guessed; pages carry `noindex`.
