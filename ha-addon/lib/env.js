// Umgebung vervollständigen – muss vor allen anderen Modulen geladen werden.
//
// Home-Assistant-Add-ons starten über s6-overlay. Das startet das Programm mit leerer
// Umgebung und legt die eigentlichen Variablen (SUPERVISOR_TOKEN, DATA_DIR …) unter
// /run/s6/container_environment ab. Ohne diesen Schritt kennt PrintDock weder seinen
// Datenordner /data (→ Daten wären nach jedem Update weg) noch den Supervisor.
const fs = require('fs');
const path = require('path');

const S6_ENV = '/run/s6/container_environment';
try {
  for (const name of fs.readdirSync(S6_ENV)) {
    if (process.env[name] === undefined) process.env[name] = fs.readFileSync(path.join(S6_ENV, name), 'utf8');
  }
} catch {}

// Sicherheitsnetz: in einem Home-Assistant-Add-on gehören die Daten immer nach /data
if (!process.env.DATA_DIR && fs.existsSync('/data/options.json')) process.env.DATA_DIR = '/data';

module.exports = {};
