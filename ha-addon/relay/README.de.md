# PrintDock Status-Server

*[English](README.md) · Deutsch*

> PrintDock ist in der **öffentlichen Beta** – Probleme bitte über [GitHub-Issues](https://github.com/Codegulasch/printdock/issues/new/choose) melden.

Öffentliche Statusseiten für Kunden – ohne das Heimnetz zu öffnen. Zwei gleichwertige Varianten mit derselben Schnittstelle: **PHP** für normales Webhosting (`relay/php`) und **Node.js/Docker** für eigene Server (`relay/server.js`).

PrintDock läuft meist im Heimnetz (`192.168.x.x`). Ein Kunden-Link dorthin funktioniert für Kunden nicht. Der Status-Server läuft auf einem eigenen Server im Internet: PrintDock **schickt** bei jeder Änderung eines freigegebenen Auftrags die Statusdaten (Fortschritt, Termin, voraussichtliches Ende, Nachbearbeitung – **ohne Kosten**) und die Fotos der fertigen Teile dorthin. Der Kunde ruft `https://status.example.com/s/<code>` auf. Verbindungen gehen nur von PrintDock nach außen.

- Node.js 18+, keine Abhängigkeiten, keine Datenbank (Dateien im Ordner `data/`)
- mehrere PrintDock-Installationen möglich – je eine mit eigenem Schlüssel
- Seiten nach Abschluss des Auftrags automatisch gelöscht (in PrintDock einstellbar, Standard 30 Tage)
- Link abschalten oder Auftrag löschen in PrintDock löscht die Seite auch hier

## Einrichten auf einem Webhosting-Paket (PHP) – der einfachste Weg

Für normales Webhosting (PHP 7.4 oder neuer, FTP-Zugang) – kein eigener Server, kein Node, keine Datenbank nötig.

1. Den Ordner **`relay/php`** per FTP auf den Webspace laden, z. B. als **`/status`** (dann lautet die Adresse `https://eure-domain.de/status`). Oder eine Subdomain wie `status.eure-domain.de` darauf zeigen lassen.
2. Dort **`config.sample.php`** nach **`config.php`** kopieren und einen langen, zufälligen Schlüssel eintragen (z. B. mit einem Passwort-Generator, 40+ Zeichen).
3. Prüfen: `https://eure-domain.de/status/health` zeigt `{"ok":true,…}`.
4. In PrintDock: *Einstellungen → Fernzugriff → Kunden-Links* → Adresse `https://eure-domain.de/status`, Schlüssel eintragen, einschalten, *Verbindung testen*.

Klappt `…/status/health` nicht (Fehler 404), ist beim Hoster keine URL-Umschreibung (`mod_rewrite`) aktiv. Dann in PrintDock als Adresse **`https://eure-domain.de/status/index.php`** eintragen – Kunden-Links sehen dann so aus: `…/status/index.php/s/<code>`. Geht auch das nicht: **`https://eure-domain.de/status/index.php?r=`**.

Hinweise:
- Die Daten liegen in `status/data/` und sind per `.htaccess` gesperrt. Bei Hostern ohne `.htaccess`-Unterstützung (nginx) in `config.php` unter `data` einen Ordner **außerhalb** des Web-Verzeichnisses angeben.
- PrintDock schickt Änderungen als `POST` mit `X-HTTP-Method-Override` und den Schlüssel zusätzlich als `X-Relay-Key` – so funktioniert es auch bei Hostern, die `PUT`/`DELETE` oder die `Authorization`-Kopfzeile nicht durchlassen.
- Fotos bis 3 MB; bei sehr kleinen Upload-Grenzen des Hosters (`post_max_size`) ggf. anheben.

## Einrichten mit Docker (eigener Server)

Im PrintDock-Ordner (der Status-Server braucht die Datei `lib/statusrender.js` aus dem PrintDock-Repository mit):

```bash
cd relay
echo "RELAY_KEYS=werkstatt:$(openssl rand -hex 24)" > .env
cat .env                       # Schlüssel notieren – kommt in PrintDock
docker compose up -d --build
curl http://127.0.0.1:8080/health
```

Der Container lauscht nur auf `127.0.0.1:8080`. Davor gehört ein Reverse-Proxy mit HTTPS.

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

## Ohne Docker (systemd)

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

## In PrintDock

*Einstellungen → Fernzugriff → Kunden-Links*: *Adresse des Status-Servers* (`https://status.example.com`) und Schlüssel eintragen, einschalten, *Verbindung testen*. Ab dann zeigen Kunden-Links, QR-Codes und Etiketten auf den Status-Server. Optional: Firmenname und Website für den Seitenfuß.

## Schnittstelle

`Authorization: Bearer <Schlüssel>`

| Methode | Pfad | Inhalt |
|---|---|---|
| GET | `/api/v1/ping` | `{ ok, name, version }` |
| PUT | `/api/v1/orders/<code>` | JSON `{ lang, data, brand, expiresAt }` → `{ missing: [Foto-IDs] }` |
| PUT | `/api/v1/orders/<code>/photos/<id>` | JPEG, max. 3 MB |
| DELETE | `/api/v1/orders/<code>` | Seite löschen |

Öffentlich: `GET /s/<code>`, `GET /s/<code>/p/<id>.jpg`, `GET /health`. Der Code ist 24 Zeichen zufällig (96 Bit) und nicht erratbar; Seiten tragen `noindex`.
