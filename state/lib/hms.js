// Bambu-HMS-Meldungen: Klartext und Link ins Bambu-Wiki.
// Der Drucker meldet nur Codes. Den Text holt PrintDock (wenn erreichbar) aus Bambus
// öffentlicher Fehlerliste und merkt sie sich eine Woche; sonst bleibt der Wiki-Link.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./store');

const TABLE_URL = (lang) => `https://e.bambulab.com/query.php?lang=${lang}`;
const MAX_AGE = 7 * 864e5;
const tables = {}; // lang -> { at, map: Map(ecode -> text) }
const loading = {};

function wikiFamily(model) {
  const m = String(model).toLowerCase();
  if (/a1/.test(m)) return 'a1';
  if (/p1|p2/.test(m)) return 'p1';
  if (/h2|x2/.test(m)) return 'h2';
  return 'x1';
}

async function load(lang) {
  const file = path.join(DATA_DIR, `hms-${lang}.json`);
  const t = tables[lang];
  if (t && Date.now() - t.at < MAX_AGE) return t.map;
  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - cached.at < MAX_AGE) {
      tables[lang] = { at: cached.at, map: new Map(Object.entries(cached.map)) };
      return tables[lang].map;
    }
  } catch { /* noch keine Liste */ }
  if (!loading[lang]) {
    loading[lang] = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await fetch(TABLE_URL(lang), { signal: ctrl.signal });
        const json = await res.json();
        const map = {};
        const d = json?.data || {};
        for (const group of [d.device_hms, d.device_error]) {
          const list = group?.[lang] || group?.en || [];
          for (const e of list) if (e?.ecode && e.intro) map[String(e.ecode).toUpperCase()] = String(e.intro).trim();
        }
        if (Object.keys(map).length) {
          tables[lang] = { at: Date.now(), map: new Map(Object.entries(map)) };
          fs.writeFileSync(file, JSON.stringify({ at: Date.now(), map }));
        }
      } catch { /* offline oder Liste nicht verfügbar */ } finally {
        clearTimeout(timer);
        loading[lang] = null;
      }
    })();
  }
  await loading[lang];
  return tables[lang]?.map || new Map();
}

/** Liste der HMS-Meldungen mit Text (falls bekannt) und Wiki-Link. */
async function describe(list, model, lang = 'de') {
  if (!list.length) return [];
  const map = await load(lang === 'de' ? 'de' : 'en');
  // Die Code-Seiten liegen zuverlässig unter /en/x1/… (gelten modellübergreifend); A1/P1 haben eigene
  const fam = ['a1', 'p1'].includes(wikiFamily(model)) ? wikiFamily(model) : 'x1';
  const wikiLang = 'en';
  return list.map((h) => {
    const ecode = String(h.code || '').replace(/_/g, '').toUpperCase();
    return {
      code: h.code,
      text: map.get(ecode) || null,
      url: `https://wiki.bambulab.com/${wikiLang}/${fam}/troubleshooting/hmscode/${h.code}`,
      severity: h.severity || null,
    };
  });
}

module.exports = { describe };
