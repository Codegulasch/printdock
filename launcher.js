// Start von PrintDock im Docker-Container.
// Im Container kann PrintDock sich selbst aktualisieren: die neue Version liegt dann im Datenordner
// (DATA_DIR/app) und überlebt so ein Neuanlegen des Containers. Ist das Image neuer (docker compose pull),
// gewinnt wieder das Image und der Zwischenstand wird entfernt.
require('./lib/env');
const fs = require('fs');
const path = require('path');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const over = path.join(dataDir, 'app');
const version = (dir) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
  } catch {
    return null;
  }
};
const newer = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};

const image = version(__dirname);
const updated = version(over);
if (updated && newer(updated, image) && fs.existsSync(path.join(over, 'server.js'))) {
  console.log(`PrintDock ${updated} (aktualisiert, Image ${image})`);
  process.env.PRINTDOCK_IMAGE_ROOT = __dirname;
  require(path.join(over, 'server.js'));
} else {
  if (updated) {
    console.log(`Image ${image} ist aktuell – Zwischenstand ${updated} wird entfernt`);
    fs.rmSync(over, { recursive: true, force: true });
  }
  require('./server.js');
}
