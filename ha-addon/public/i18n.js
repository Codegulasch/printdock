/* PrintDock – Übersetzung. Deutsche Texte sind die Schlüssel; weitere Sprachen
   liefern Wörterlisten (i18n-en.js). Schlüssel mit Platzhaltern wie „{p}: Druck fertig“
   übersetzen auch fertig zusammengesetzte Meldungen vom Server. Läuft im Browser und in Node. */
(function (root) {
  'use strict';
  const DICTS = {};
  const patterns = {}; // lang -> [{ re, names, out }]
  const cache = {}; // lang -> Map

  function register(lang, dict) {
    DICTS[lang] = Object.assign(DICTS[lang] || {}, dict);
    patterns[lang] = Object.entries(DICTS[lang])
      .filter(([k]) => /\{\w+\}/.test(k))
      .map(([k, out]) => {
        const names = [];
        const src = k.split(/(\{\w+\})/).map((part) => {
          const m = part.match(/^\{(\w+)\}$/);
          if (m) { names.push(m[1]); return '([\\s\\S]+?)'; }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('');
        return { re: new RegExp(`^${src}$`), names, out, len: k.length };
      })
      .sort((a, b) => b.len - a.len);
    cache[lang] = new Map();
  }

  function fill(s, vars) {
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  }

  /** Übersetzt key in lang. Ohne Treffer bleibt der deutsche Text stehen. */
  function translate(lang, key, vars) {
    if (key == null) return '';
    key = String(key);
    // Kontext-Zusatz wie „Drucker#pl“ (Mehrzahl) nur für andere Sprachen
    const plain = key.replace(/#\w+$/, '');
    if (!lang || lang === 'de' || !DICTS[lang]) return fill(plain, vars);
    const d = DICTS[lang];
    if (Object.prototype.hasOwnProperty.call(d, key)) return fill(d[key], vars);
    if (plain !== key) return translate(lang, plain, vars);
    if (vars) return fill(key, vars);
    // Fertig zusammengesetzte Meldung: Muster suchen
    const c = cache[lang];
    if (c.has(key)) return c.get(key);
    let out = key;
    if (key.length < 400) {
      for (const p of patterns[lang]) {
        const m = key.match(p.re);
        if (!m) continue;
        const v = {};
        p.names.forEach((n, i) => { v[n] = translate(lang, m[i + 1]); });
        out = fill(p.out, v);
        break;
      }
    }
    if (c.size > 2000) c.clear();
    c.set(key, out);
    return out;
  }

  const api = { register, translate, DICTS };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
    try { register('en', require('./i18n-en.js')); } catch (err) { /* Wörterliste fehlt */ }
  } else {
    root.PD_I18N = api;
    if (root.PD_DICT_EN) register('en', root.PD_DICT_EN);
  }
})(typeof window !== 'undefined' ? window : globalThis);
