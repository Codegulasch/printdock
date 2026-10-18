// Eingangsordner: Dateien, die hier landen, übernimmt PrintDock automatisch.
// Gedacht für Slicer ohne Druck-Host-Anbindung – vor allem Bambu Studio: „Geslicte Platte exportieren“
// direkt in diesen Ordner speichern (als Add-on über die Samba-Freigabe \\homeassistant\share\printdock).
//
//   <Ordner>/                 → in die Bibliothek
//   <Ordner>/warteschlange/   → in die Bibliothek und in die Warteschlange (passender Drucker)
//
// Eine Datei wird übernommen, sobald ihre Größe zweimal hintereinander gleich ist (fertig geschrieben),
// und danach aus dem Ordner gelöscht.

const fs = require('fs');
const path = require('path');
const files = require('./files');
const { DATA_DIR } = require('./store');

const ADDON = Boolean(process.env.SUPERVISOR_TOKEN);
const DIR = process.env.INBOX_DIR || (ADDON ? '/share/printdock' : path.join(DATA_DIR, 'eingang'));
const QUEUE_SUB = 'warteschlange';
const OK_EXT = /\.(gcode|3mf|stl|step|stp|obj)$/i;

class Inbox {
  constructor(ctx) {
    this.ctx = ctx; // { production, broadcast }
    this.seen = new Map(); // Pfad → Größe beim letzten Blick
    this.busy = false;
    this.ready = false;
    this.lastError = null;
    this.imported = [];
  }

  start() {
    try {
      fs.mkdirSync(path.join(DIR, QUEUE_SUB), { recursive: true });
      this.ready = true;
    } catch (err) {
      this.lastError = `Ordner ${DIR} lässt sich nicht anlegen: ${err.message}`;
      console.warn(`Eingangsordner: ${this.lastError}`);
      return;
    }
    console.log(`Eingangsordner: ${DIR}`);
    this.timer = setInterval(() => this.scan().catch((err) => (this.lastError = err.message)), 4000);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }

  view() {
    return { dir: DIR, queueDir: path.join(DIR, QUEUE_SUB), share: ADDON ? '\\\\homeassistant\\share\\printdock' : null, ready: this.ready, error: this.lastError, recent: this.imported.slice(-5).reverse() };
  }

  async scan() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const [sub, toQueue] of [['', false], [QUEUE_SUB, true]]) {
        const dir = path.join(DIR, sub);
        let names;
        try {
          names = fs.readdirSync(dir);
        } catch {
          continue;
        }
        for (const name of names) {
          if (name.startsWith('.') || name.startsWith('~') || !OK_EXT.test(name)) continue;
          const full = path.join(dir, name);
          let st;
          try {
            st = fs.statSync(full);
          } catch {
            continue;
          }
          if (!st.isFile()) continue;
          const before = this.seen.get(full);
          this.seen.set(full, st.size);
          if (before !== st.size || st.size === 0) continue; // noch nicht fertig geschrieben
          await this.take(full, name, toQueue);
          this.seen.delete(full);
        }
      }
      this.lastError = null;
    } finally {
      this.busy = false;
    }
  }

  async take(full, name, toQueue) {
    let saved;
    try {
      saved = await files.addFromStream(fs.createReadStream(full), name, { source: 'eingang' });
    } catch (err) {
      this.lastError = `${name}: ${err.message}`;
      console.warn(`Eingangsordner: ${this.lastError}`);
      // nicht unterstützt → zur Seite legen, damit es nicht immer wieder versucht wird
      try { fs.renameSync(full, `${full}.fehler`); } catch {}
      return;
    }
    try { fs.unlinkSync(full); } catch {}
    let queued = false;
    if (toQueue && saved.printable && this.ctx.production) {
      try {
        this.ctx.production.addToQueue({ fileId: saved.id });
        queued = true;
      } catch (err) {
        console.warn(`Eingangsordner: ${err.message}`);
      }
    }
    this.imported.push({ name: saved.name, queued, at: new Date().toISOString() });
    if (this.imported.length > 20) this.imported.shift();
    console.log(`Eingangsordner: ${saved.name}${queued ? ' → Warteschlange' : ' → Bibliothek'}`);
    this.ctx.broadcast('files', null);
    if (queued) this.ctx.broadcast('production', null);
  }
}

module.exports = { Inbox, INBOX_DIR: DIR };
