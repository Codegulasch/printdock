// Plattform-Check: Was kann diese Installation (Home-Assistant-Add-on, Docker, Raspberry Pi/Server, Windows/Mac)?
// Gleiche Funktionen überall – wo etwas fehlt, sagt der Check, was zu tun ist.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA_DIR } = require('./store');

function kind() {
  if (process.env.SUPERVISOR_TOKEN) return 'addon';
  if (fs.existsSync('/.dockerenv') || process.env.PRINTDOCK_DOCKER) return 'docker';
  return 'node';
}

function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, `.pd-test-${process.pid}`);
    fs.writeFileSync(f, 'x');
    fs.unlinkSync(f);
    return true;
  } catch {
    return false;
  }
}

function freeMb(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Math.round((s.bavail * s.bsize) / 1024 / 1024);
  } catch {
    return null;
  }
}

/**
 * @param ctx { ffmpeg: async () => bool, ffmpegPath(), ha, remote, port, directUrl, inboxDir, backupDir }
 */
async function check(ctx) {
  const k = kind();
  const osName = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }[process.platform] || process.platform;
  const items = [];
  const add = (id, label, ok, value, hint = '') => items.push({ id, label, ok, value, hint });
  const KIND = { addon: 'Home-Assistant-Add-on', docker: 'Docker', node: 'Node.js' };
  add('platform', 'Installation', true, `${KIND[k]} · ${osName} ${process.arch} · Node ${process.version}`);

  const free = freeMb(DATA_DIR);
  const dataOk = writable(DATA_DIR);
  add('data', 'Datenordner', dataOk && (free == null || free > 200), `${DATA_DIR}${free != null ? ` · ${free >= 1024 ? `${(free / 1024).toFixed(1)} GB` : `${free} MB`} frei` : ''}`,
    !dataOk ? 'Kein Schreibzugriff – Rechte des Ordners prüfen.' : free != null && free <= 200 ? 'Wenig Platz – alte Druckdateien oder Sicherungen löschen.' : '');

  const ff = await ctx.ffmpeg();
  add('ffmpeg', 'Kamera (ffmpeg)', ff, ff ? ctx.ffmpegPath() : 'fehlt',
    ff ? '' : process.platform === 'win32' ? 'Für RTSP-Kameras (Bambu X1/H2D/X2D): winget install Gyan.FFmpeg' : process.platform === 'darwin' ? 'brew install ffmpeg' : 'sudo apt install ffmpeg');

  const restart = k === 'addon' || process.env.PRINTDOCK_RESTART === 'exit';
  add('restart', 'Neustart nach Update/Sicherung', restart, restart ? 'automatisch' : 'von Hand',
    restart ? (k === 'docker' ? 'Docker startet PrintDock neu, wenn „restart: unless-stopped“ gesetzt ist (Vorlage docker-compose.yml).' : '')
      : process.platform === 'win32' ? 'scripts\\start-windows.cmd verwenden – startet PrintDock nach einem Update von selbst neu.' : 'Als Dienst einrichten (scripts/install.sh) oder PRINTDOCK_RESTART=exit mit einem Dienst-Manager.');

  const root = path.join(__dirname, '..');
  const upd = k === 'addon' || (k === 'docker' ? fs.existsSync(path.join(process.env.PRINTDOCK_IMAGE_ROOT || root, 'launcher.js')) : writable(path.join(root, 'lib')));
  add('update', 'Update aus PrintDock', upd, upd ? 'möglich' : 'nicht möglich',
    upd ? '' : k === 'docker' ? 'Altes Image – einmal „docker compose pull && docker compose up -d“, danach geht es aus PrintDock.' : 'Programmordner ist schreibgeschützt.');

  const r = ctx.remote.view();
  const archOk = Boolean(r.arch);
  add('cloudflare', 'Fernzugriff: Cloudflare Tunnel', archOk, archOk ? 'verfügbar' : 'nicht für diesen Prozessor', '');
  const tsHint = process.platform === 'linux' ? (k === 'node' ? 'Nutzt ein installiertes Tailscale, sonst eigenes (ohne Root).' : 'Eigenes Tailscale im Container (ohne Root, kein /dev/net/tun nötig).') : 'Tailscale-App installieren und anmelden – PrintDock nutzt sie.';
  add('tailscale', 'Fernzugriff: Tailscale', process.platform === 'linux' ? archOk : null, r.tailscale.external ? 'Tailscale des Rechners' : process.platform === 'linux' ? 'eingebaut' : 'über die Tailscale-App', tsHint);

  const ha = ctx.ha.publicSettings();
  const haOk = ha.status?.rest === 'ok';
  add('ha', 'Home Assistant', haOk ? true : ha.url || ha.addon ? false : null, haOk ? (ha.addon ? 'über den Supervisor' : ha.url) : ha.url || ha.addon ? String(ha.status?.rest || 'nicht verbunden') : 'nicht eingerichtet',
    haOk ? '' : ha.addon ? '' : 'Optional: Adresse und Token unter Einstellungen → Home Assistant.');

  add('inbox', 'Eingangsordner (Slicer-Export)', writable(ctx.inboxDir), ctx.inboxDir,
    k === 'addon' ? 'Im Netzwerk: \\\\homeassistant\\share\\printdock (Samba-Add-on).' : k === 'docker' ? 'Liegt im Datenordner – auf dem NAS freigeben oder per Volume einbinden.' : 'Ordner im Netzwerk freigeben, dann kann der Slicer direkt hinein speichern.');
  add('backups', 'Automatische Sicherung', writable(ctx.backupDir), ctx.backupDir, '');
  if (ctx.storage) {
    const v = ctx.storage.view();
    if (v.mode === 'smb') {
      const bad = v.kinds.filter((k) => k.external && !k.ok);
      add('storage', 'Speicherort (SMB-Freigabe)', v.smbclient && !bad.length, `\\\\${v.smb?.server}\\${v.smb?.share}${v.sync?.at ? ` · abgeglichen ${new Date(v.sync.at).toLocaleString('de-DE')}` : ''}`,
        !v.smbclient ? 'smbclient fehlt – Pi/Linux: sudo apt install smbclient, macOS: brew install samba' : bad.length ? `NAS nicht erreichbar: ${bad[0].error || ''} – PrintDock speichert so lange im Datenordner und holt die Übertragung nach.` : '');
    } else if (v.path) {
      const bad = v.kinds.filter((k) => k.external && !k.ok);
      add('storage', 'Speicherort (NAS)', !bad.length, `${v.path}${v.kinds.find((k) => k.external && k.freeMb != null) ? ` · ${(v.kinds.find((k) => k.external && k.freeMb != null).freeMb / 1024).toFixed(1)} GB frei` : ''}`,
        bad.length ? `Nicht erreichbar (${bad.map((k) => k.label).join(', ')}): ${bad[0].error || ''} – PrintDock speichert so lange im Datenordner und zieht die Dateien später nach.` : '');
    } else add('storage', 'Speicherort (NAS)', true, 'Datenordner', 'Druckdateien, Fotos und Sicherungen lassen sich unter System → Speicherort auf ein NAS legen.');
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  add('tz', 'Zeitzone', tz && tz !== 'UTC' && tz !== 'Etc/UTC', tz || '?', tz === 'UTC' || tz === 'Etc/UTC' ? 'Uhrzeiten (Startzeitfenster, Meldungen) laufen in UTC – TZ=Europe/Berlin setzen.' : '');

  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  add('network', 'Adresse im Heimnetz', true, ctx.directUrl || `http://${ips[0] || 'localhost'}:${ctx.port}`, k === 'docker' ? 'Docker mit „network_mode: host“, damit Drucker (MQTT, Kameras) erreichbar sind.' : '');
  return { kind: k, os: process.platform, items };
}

module.exports = { check, kind };
