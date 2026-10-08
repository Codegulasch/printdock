// Einfache JSON-Ablage im Datenordner – atomar geschrieben, damit bei
// Stromausfall nichts halb auf der Platte landet.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/** Liefert { data, save() } für eine JSON-Datei im Datenordner. */
function store(name, fallback) {
  const file = path.join(DATA_DIR, name);
  const s = {
    data: readJson(file, fallback),
    save() {
      writeJson(file, s.data);
    },
  };
  return s;
}

module.exports = { DATA_DIR, store, readJson, writeJson };
