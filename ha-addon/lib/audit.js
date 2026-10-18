// Protokoll: wer hat was geändert (alle schreibenden API-Aufrufe), letzte 3000 Einträge.
const { store } = require('./store');

const db = store('audit.json', []);
let timer = null;

function log(entry) {
  db.data.push({ at: new Date().toISOString(), ...entry });
  if (db.data.length > 3000) db.data.splice(0, db.data.length - 3000);
  clearTimeout(timer);
  timer = setTimeout(() => db.save(), 5000);
}

function list({ limit = 300, user = null } = {}) {
  const rows = user ? db.data.filter((x) => x.user === user) : db.data;
  return rows.slice(-limit).reverse();
}

function flush() {
  clearTimeout(timer);
  db.save();
}

module.exports = { log, list, flush };
