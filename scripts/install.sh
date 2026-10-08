#!/usr/bin/env bash
# PrintDock – Installation ohne Docker auf Raspberry Pi OS, Debian oder Ubuntu
# (als Systemdienst, startet automatisch mit dem Rechner).
#
#   curl -fsSL https://raw.githubusercontent.com/Codegulasch/printdock/main/scripts/install.sh | sudo bash
# oder im ausgecheckten Repository:
#   sudo ./scripts/install.sh
#
# Aktualisieren: denselben Befehl erneut ausführen. Daten bleiben in /var/lib/printdock.

set -euo pipefail

REPO="${PRINTDOCK_REPO:-https://github.com/Codegulasch/printdock.git}"
BRANCH="${PRINTDOCK_BRANCH:-main}"
APP_DIR="${PRINTDOCK_DIR:-/opt/printdock}"
DATA_DIR="${PRINTDOCK_DATA:-/var/lib/printdock}"
PORT="${PORT:-3080}"
SVC_USER=printdock

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mFehler:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Bitte mit sudo ausführen."
command -v apt-get >/dev/null || die "Dieses Skript ist für Debian, Ubuntu und Raspberry Pi OS. Andere Systeme: Docker verwenden."

say "Pakete installieren (git, ffmpeg, curl)"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git ffmpeg curl ca-certificates >/dev/null

node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; }
if ! node_ok; then
  say "Node.js installieren"
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm >/dev/null || true
  if ! node_ok; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
  fi
fi
node_ok || die "Node.js 18 oder neuer konnte nicht installiert werden."
say "Node.js $(node -v)"

id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
# Zugriff auf Kameras/Video (z. B. USB-Webcam) erlauben
usermod -aG video "$SVC_USER" 2>/dev/null || true

SRC="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." 2>/dev/null && pwd || true)"
if [ -n "$SRC" ] && [ -f "$SRC/server.js" ] && [ "$SRC" != "$APP_DIR" ]; then
  say "PrintDock aus $SRC nach $APP_DIR kopieren"
  mkdir -p "$APP_DIR"
  tar -C "$SRC" --exclude=node_modules --exclude=data --exclude=.git -cf - . | tar -C "$APP_DIR" -xf -
elif [ -d "$APP_DIR/.git" ]; then
  say "PrintDock aktualisieren"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" reset --quiet --hard "origin/$BRANCH"
else
  say "PrintDock herunterladen"
  git clone --quiet --depth 1 --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

say "Abhängigkeiten installieren"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund --loglevel=error

mkdir -p "$DATA_DIR"
chown -R "$SVC_USER:$SVC_USER" "$DATA_DIR"

say "Systemdienst einrichten"
cat > /etc/systemd/system/printdock.service <<UNIT
[Unit]
Description=PrintDock – 3D printer management
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SVC_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
ExecStart=$(command -v node) $APP_DIR/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ReadWritePaths=$DATA_DIR

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now printdock.service >/dev/null
systemctl restart printdock.service

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
say "Fertig. PrintDock läuft unter  http://${IP:-localhost}:$PORT"
echo "    Status:  systemctl status printdock"
echo "    Logs:    journalctl -u printdock -f"
echo "    Daten:   $DATA_DIR"
