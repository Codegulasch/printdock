// Unter welcher Adresse ist PrintDock im Heimnetz erreichbar?
//
// Normalfall: erste IPv4-Adresse des Rechners. Als Home-Assistant-Add-on läuft PrintDock
// aber in einem internen Docker-Netz (172.30.x.x) – dort fragen wir den Supervisor nach
// der IP des Home-Assistant-Rechners und dem nach außen freigegebenen Port.
const os = require('os');

const ADDON = () => Boolean(process.env.SUPERVISOR_TOKEN);
const info = { ip: null, port: null, source: null };

function localIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}

async function supervisor(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(`http://supervisor${path}`, { headers: { Authorization: `Bearer ${process.env.SUPERVISOR_TOKEN}` }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).data;
  } finally {
    clearTimeout(t);
  }
}

/** Einmal beim Start (und bei Bedarf erneut) aufrufen. */
async function refresh(internalPort) {
  if (!ADDON()) return info;
  try {
    const net = await supervisor('/network/info');
    const ifs = (net?.interfaces || []).filter((i) => i.enabled !== false && i.ipv4?.address?.length);
    const pick = ifs.find((i) => i.primary) || ifs[0];
    if (pick) {
      info.ip = String(pick.ipv4.address[0]).split('/')[0];
      info.source = 'supervisor';
    }
  } catch (err) {
    console.warn(`Supervisor: Netzwerk-Info nicht lesbar (${err.message})`);
  }
  try {
    const self = await supervisor('/addons/self/info');
    const mapped = self?.network?.[`${internalPort}/tcp`];
    info.port = mapped === null ? 0 : Number(mapped) || null; // 0 = Port in den Add-on-Einstellungen abgeschaltet
  } catch {}
  return info;
}

/** Adresse für Slicer, Downloads und Home Assistant (ohne Schrägstrich am Ende). */
function directUrl(internalPort, publicUrl) {
  if (publicUrl) return publicUrl.replace(/\/+$/, '');
  if (ADDON() && info.ip) return `http://${info.ip}:${info.port || internalPort}`;
  return `http://${localIp()}:${internalPort}`;
}

module.exports = { refresh, directUrl, info, localIp };
