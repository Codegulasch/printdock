// Simulierte Drucker (Treiber „demo“, z. B. aus den Demo-Daten): getrennt von echten Daten halten.
//  - Demo-Drucker bekommen nur Demo-Spulen und buchen nur auf Demo-Spulen
//  - gibt es echte Drucker, zählen Demo-Drucke nicht in Statistik, Verbrauch, Reservierung und Einkaufsliste
//    (ohne echte Drucker – reine Demo-Installation – bleibt alles sichtbar, damit man es ausprobieren kann)

/** Ist das ein simulierter Drucker? */
const isDemo = (cfg) => Boolean(cfg && (cfg.demo || cfg.driver === 'demo'));

/** Echte Daten von Demo-Daten trennen? Nur, wenn es mindestens einen echten Drucker gibt. */
const separate = (printers = []) => printers.some((p) => !isDemo(p));

/** Simulationstempo: Faktor gegenüber Echtzeit. 60× war bis 0.23 fest eingestellt. */
const SPEEDS = { real: 1, x10: 10, x60: 60, x300: 300 };

module.exports = { isDemo, separate, SPEEDS };
