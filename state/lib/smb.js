// SMB-Freigabe (NAS, TrueNAS, Synology, Windows-Freigabe) direkt ansprechen – ohne Einhängen im Betriebssystem
// und ohne Home Assistant. Nutzt smbclient von Samba (zuverlässig, SMB2/3, NTLMv2, Signierung, Verschlüsselung).
//   Add-on / Docker: im Image enthalten · Pi/Linux: „apt install smbclient“ · macOS: „brew install samba“
//   Windows: braucht kein smbclient – dort geht der Netzwerkpfad (\\server\freigabe) direkt (siehe storage.js)
//
// Zugangsdaten gehen über eine Auth-Datei (nur für PrintDock lesbar), nicht über die Kommandozeile.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { DATA_DIR } = require('./store');

const TMP = path.join(DATA_DIR, 'tmp');
let binCache;

/** smbclient vorhanden? */
function binary() {
  if (binCache !== undefined) return binCache;
  const cands = process.platform === 'win32' ? [] : ['/usr/bin/smbclient', '/usr/local/bin/smbclient', '/opt/homebrew/bin/smbclient', '/bin/smbclient'];
  binCache = cands.find((c) => fs.existsSync(c)) || null;
  return binCache;
}

// Namen in smbclient-Befehlen: keine Anführungszeichen, keine Steuerzeichen
const clean = (s) => String(s || '').replace(/["\x00-\x1f]/g, '').replace(/^[\\/]+|[\\/]+$/g, '').replace(/\//g, '\\');

/** Verbindungsdaten prüfen und normalisieren */
function normalize(c = {}) {
  const server = String(c.server || '').trim().replace(/^(smb:)?[\\/]+/i, '').replace(/[\\/].*$/, '');
  let share = String(c.share || '').trim().replace(/^[\\/]+/, '');
  let dir = String(c.dir || '').trim();
  // „\\nas\freigabe\unterordner“ oder „nas/freigabe/x“ im Feld Server? Aufteilen
  const full = String(c.server || '').trim().replace(/^(smb:)?[\\/]+/i, '').split(/[\\/]+/).filter(Boolean);
  if (full.length > 1 && !share) {
    share = full[1];
    if (!dir && full.length > 2) dir = full.slice(2).join('/');
  }
  share = share.split(/[\\/]+/)[0];
  return { server, share, dir: clean(dir), user: String(c.user || '').trim(), password: String(c.password || ''), domain: String(c.domain || '').trim() || 'WORKGROUP' };
}

/** Ein smbclient-Aufruf mit mehreren Befehlen; liefert stdout. Fehler bei NT_STATUS_… außer erlaubten. */
function run(conn, commands, { timeoutMs = 120_000, allow = [] } = {}) {
  const bin = binary();
  if (!bin) return Promise.reject(Object.assign(new Error('smbclient fehlt – auf dem Pi/Linux: „sudo apt install smbclient“, macOS: „brew install samba“'), { code: 'NOSMBCLIENT' }));
  const c = normalize(conn);
  if (!c.server || !c.share) return Promise.reject(new Error('Server und Freigabe angeben'));
  fs.mkdirSync(TMP, { recursive: true });
  const auth = path.join(TMP, `smb-${crypto.randomUUID()}.auth`);
  fs.writeFileSync(auth, `username = ${c.user || 'guest'}\npassword = ${c.password}\ndomain = ${c.domain}\n`, { mode: 0o600 });
  const args = [`//${c.server}/${c.share}`, '-A', auth, '-m', 'SMB3', '-t', String(Math.ceil(timeoutMs / 1000)), '-c', commands.join('; ')];
  if (!c.user) args.splice(1, 2, '-N');
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs + 5000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      fs.rmSync(auth, { force: true });
      const out = `${stdout || ''}\n${stderr || ''}`;
      const status = (out.match(/NT_STATUS_[A-Z_]+/g) || []).filter((s) => !allow.includes(s));
      if (status.length || (err && !/NT_STATUS/.test(out) && err.killed)) return reject(explain(status[0] || (err?.killed ? 'TIMEOUT' : err?.message), out));
      if (err && err.code && !status.length && !stdout) return reject(explain(err.message, out));
      resolve(stdout || '');
    });
  });
}

/** Verständliche Fehlermeldungen */
function explain(code, raw = '') {
  const map = {
    NT_STATUS_LOGON_FAILURE: 'Anmeldung abgelehnt – Benutzer oder Passwort falsch (bei TrueNAS: SMB-Benutzer mit „Samba Authentication“)',
    NT_STATUS_ACCESS_DENIED: 'Kein Zugriff – der Benutzer braucht Schreibrecht auf die Freigabe bzw. das Dataset',
    NT_STATUS_BAD_NETWORK_NAME: 'Freigabe nicht gefunden – nur den Freigabenamen eintragen (z. B. „printdock“), nicht den Pfad auf dem NAS',
    NT_STATUS_HOST_UNREACHABLE: 'Server nicht erreichbar – IP-Adresse prüfen (Home Assistant als VM auf TrueNAS: Netzwerkbrücke nötig)',
    NT_STATUS_IO_TIMEOUT: 'Zeitüberschreitung – Server antwortet nicht (Firewall, falsche IP, VM ohne Netzwerkbrücke?)',
    NT_STATUS_CONNECTION_REFUSED: 'Verbindung abgelehnt – ist SMB auf dem NAS eingeschaltet?',
    NT_STATUS_UNSUCCESSFUL: 'Verbindung fehlgeschlagen – Servername/IP prüfen',
    NT_STATUS_NOT_FOUND: 'Server nicht gefunden – besser die IP-Adresse eintragen',
    NT_STATUS_PROTOCOL_NOT_SUPPORTED: 'SMB-Version passt nicht – am NAS SMB2/SMB3 erlauben',
    NT_STATUS_OBJECT_PATH_NOT_FOUND: 'Unterordner nicht gefunden',
    NT_STATUS_OBJECT_NAME_NOT_FOUND: 'Datei nicht gefunden',
    NT_STATUS_DISK_FULL: 'Freigabe ist voll',
    TIMEOUT: 'Zeitüberschreitung bei der Übertragung',
  };
  const msg = map[code] || (code ? `${code}${/Connection to .* failed/.test(raw) ? ' – Server nicht erreichbar' : ''}` : 'SMB-Fehler');
  return Object.assign(new Error(msg), { smb: code || null });
}

const sub = (base, s) => [base, s].filter(Boolean).join('\\');

/** Ordner anlegen (Kette), vorhandene sind kein Fehler */
async function mkdirs(conn, dir) {
  const parts = clean(dir).split('\\').filter(Boolean);
  if (!parts.length) return;
  const cmds = [];
  for (let i = 1; i <= parts.length; i++) cmds.push(`mkdir "${parts.slice(0, i).join('\\')}"`);
  await run(conn, cmds, { allow: ['NT_STATUS_OBJECT_NAME_COLLISION'] });
}

/** Dateien eines Ordners: [{ name, size }] */
async function list(conn, dir) {
  const out = await run(conn, [`cd "${clean(dir) || '\\'}"`, 'ls'], { allow: ['NT_STATUS_NO_SUCH_FILE'] });
  const files = [];
  for (const line of out.split('\n')) {
    // "  name.gcode    A   12345  Mon Oct 12 19:31:39 2026"
    const m = line.match(/^\s{2}(.+?)\s+([ADHNRS]*)\s+(\d+)\s+\w{3} \w{3}\s+\d+ [\d:]+ \d{4}\s*$/);
    if (!m || m[1] === '.' || m[1] === '..' || m[2].includes('D')) continue;
    files.push({ name: m[1], size: Number(m[3]) });
  }
  return files;
}

/** Mehrere lokale Dateien hochladen: [{ local, name }] → in Ordner dir */
async function put(conn, dir, items) {
  if (!items.length) return;
  for (let i = 0; i < items.length; i += 50) {
    const part = items.slice(i, i + 50);
    await run(conn, [`cd "${clean(dir)}"`, ...part.map((x) => `put "${x.local}" "${clean(x.name)}"`)], { timeoutMs: 30 * 60_000 });
  }
}

/** Datei herunterladen */
async function get(conn, dir, name, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  try {
    await run(conn, [`cd "${clean(dir)}"`, `get "${clean(name)}" "${tmp}"`], { timeoutMs: 30 * 60_000 });
    fs.renameSync(tmp, dest);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

async function remove(conn, dir, names) {
  if (!names.length) return;
  await run(conn, [`cd "${clean(dir)}"`, ...names.map((n) => `del "${clean(n)}"`)], { allow: ['NT_STATUS_OBJECT_NAME_NOT_FOUND', 'NT_STATUS_NO_SUCH_FILE'] });
}

/** Verbindung testen: anmelden, Unterordner anlegen, Testdatei schreiben, lesen, löschen; freien Platz lesen */
async function test(conn) {
  const c = normalize(conn);
  if (!binary()) return { ok: false, error: 'smbclient fehlt – auf dem Pi/Linux: „sudo apt install smbclient“, macOS: „brew install samba“', missing: true };
  try {
    if (c.dir) await mkdirs(c, c.dir);
    fs.mkdirSync(TMP, { recursive: true });
    const probe = path.join(TMP, `smbtest-${process.pid}.txt`);
    fs.writeFileSync(probe, 'PrintDock');
    const name = `.printdock-test-${process.pid}`;
    const out = await run(c, [`cd "${c.dir || '\\'}"`, `put "${probe}" "${name}"`, 'ls', `del "${name}"`]);
    fs.rmSync(probe, { force: true });
    if (!out.includes(name)) return { ok: false, error: 'Schreiben fehlgeschlagen – Schreibrecht prüfen' };
    let freeMb = null;
    const m = out.match(/(\d+) blocks of size (\d+)\. (\d+) blocks available/);
    if (m) freeMb = Math.round((Number(m[3]) * Number(m[2])) / 1024 / 1024);
    return { ok: true, freeMb, target: `\\\\${c.server}\\${c.share}${c.dir ? `\\${c.dir}` : ''}` };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { binary, normalize, run, mkdirs, list, put, get, remove, test, sub, clean };
