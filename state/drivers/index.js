// Treiberregister. Neuer Hersteller? Datei in diesem Ordner anlegen
// (Vorlage: demo.js) und hier eintragen.

const drivers = [
  require('./moonraker'),
  require('./bambu'),
  require('./anycubic'),
  require('./octoprint'),
  require('./demo'),
];

const byId = Object.fromEntries(drivers.map((D) => [D.meta.id, D]));

module.exports = { drivers, byId };
