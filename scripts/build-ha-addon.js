// Kopiert PrintDock in den Add-on-Ordner (ha-addon/app), damit Home Assistant
// das Add-on direkt aus dem GitHub-Repository bauen kann.
// Aufruf: npm run ha-addon
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const target = path.join(root, 'ha-addon', 'app');
const include = ['server.js', 'camera.js', 'notify.js', 'package.json', 'package-lock.json', 'drivers', 'lib', 'public', 'dist', 'blueprints'];

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
for (const item of include) fs.cpSync(path.join(root, item), path.join(target, item), { recursive: true });

// Versionsnummer übernehmen
const version = require(path.join(root, 'package.json')).version;
const cfgPath = path.join(root, 'ha-addon', 'config.yaml');
fs.writeFileSync(cfgPath, fs.readFileSync(cfgPath, 'utf8').replace(/^version: .*$/m, `version: "${version}"`));
console.log(`Add-on vorbereitet (Version ${version}): ${path.relative(root, target)}`);
