// Übersetzung auf dem Server (Benachrichtigungen, Home Assistant).
// Nutzt dieselbe Wörterliste wie die Oberfläche (public/i18n.js).

const { translate } = require('../public/i18n.js');
const app = require('./app');

/** Text in der eingestellten Sprache; Platzhalter {x} werden gefüllt. */
const tr = (key, vars) => translate(app.lang, key, vars);
const locale = () => (app.lang === 'en' ? 'en-GB' : 'de-DE');

module.exports = { tr, locale };
