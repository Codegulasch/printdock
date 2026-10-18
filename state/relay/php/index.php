<?php
/**
 * PrintDock Status-Server – PHP-Version für normales Webhosting (PHP 7.4+, kein Node, keine Datenbank).
 *
 * PrintDock schickt die Statusdaten freigegebener Aufträge (ohne Kosten) und die Fotos der fertigen Teile hierher,
 * der Kunde ruft  https://eure-domain.de/status/s/<code>  auf. Das Heimnetz bleibt zu.
 *
 * Einrichten: Ordner per FTP hochladen (z. B. nach /status), config.sample.php → config.php kopieren und
 * einen Schlüssel eintragen. Gleiche Schnittstelle wie die Node-Version (relay/server.js).
 */
declare(strict_types=1);

const VERSION = '1.0.0-php';
$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) { http_response_code(500); exit('config.php fehlt – config.sample.php kopieren und Schlüssel eintragen.'); }
$CFG = require $cfgFile;
$KEYS = $CFG['keys'] ?? [];
$DATA = rtrim($CFG['data'] ?? (__DIR__ . '/data'), '/');
if (!is_dir($DATA)) @mkdir($DATA, 0750, true);

// ---------------------------------------------------------------- Pfad bestimmen (mit oder ohne URL-Umschreibung)
// Basis-Pfad des Ordners (z. B. /status) – aus SCRIPT_NAME, sonst aus der Lage im Web-Ordner
function basePath(): string {
    $sn = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
    if (preg_match('#/index\.php$#', $sn)) return rtrim(dirname($sn), '/');
    $root = rtrim(str_replace('\\', '/', (string) realpath($_SERVER['DOCUMENT_ROOT'] ?? '')), '/');
    $here = str_replace('\\', '/', __DIR__);
    return ($root !== '' && strpos($here, $root) === 0) ? rtrim(substr($here, strlen($root)), '/') : '';
}
$path = $_GET['r'] ?? ($_SERVER['PATH_INFO'] ?? null);
if ($path === null) {
    $uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
    $base = basePath();
    $path = substr($uri, strlen($base)) ?: '/';
    $path = preg_replace('#^/index\.php#', '', $path) ?: '/';
}
$path = '/' . trim($path, '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
// manche Hoster lassen nur GET/POST durch → PUT/DELETE als POST mit Kopfzeile
$override = strtoupper($_SERVER['HTTP_X_HTTP_METHOD_OVERRIDE'] ?? '');
if ($method === 'POST' && in_array($override, ['PUT', 'DELETE'], true)) $method = $override;

function send(int $status, $body, string $type = 'application/json; charset=utf-8', array $extra = []): void {
    http_response_code($status);
    header("Content-Type: $type");
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    header('X-Robots-Tag: noindex');
    foreach ($extra as $k => $v) header("$k: $v");
    echo is_string($body) ? $body : json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}
function readJson(string $f): ?array { if (!is_file($f)) return null; $j = json_decode((string) file_get_contents($f), true); return is_array($j) ? $j : null; }
function rmTree(string $dir): void { if (!is_dir($dir)) return; foreach (scandir($dir) as $f) { if ($f === '.' || $f === '..') continue; $p = "$dir/$f"; is_dir($p) ? rmTree($p) : @unlink($p); } @rmdir($dir); }
function expired(?array $m): bool { return $m && !empty($m['expiresAt']) && strtotime($m['expiresAt']) < time(); }

// gelegentlich abgelaufene Seiten löschen
if (mt_rand(1, 40) === 1) {
    foreach (glob("$DATA/*", GLOB_ONLYDIR) ?: [] as $d) { $m = readJson("$d/order.json"); if (!$m || expired($m)) rmTree($d); }
}

// ---------------------------------------------------------------- Darstellung (wie lib/statusrender.js)
function h($s): string { return htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8'); }
const TXT = [
    'de' => ['title' => 'Auftrag', 'status' => ['offen' => 'Angenommen', 'geplant' => 'Eingeplant', 'läuft' => 'Wird gedruckt', 'nachbearbeitung' => 'In der Nachbearbeitung', 'fertig' => 'Fertig', 'abgeschlossen' => 'Abgeschlossen'], 'post' => 'Nachbearbeitung', 'due' => 'Termin', 'progress' => 'Fortschritt', 'parts' => '{a} von {b} Teilen', 'eta' => 'Voraussichtlich fertig', 'photos' => 'Fertige Teile', 'updated' => 'Stand', 'gone' => 'Dieser Link ist nicht mehr gültig.', 'printing' => 'gerade im Druck', 'days' => ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.']],
    'en' => ['title' => 'Order', 'status' => ['offen' => 'Received', 'geplant' => 'Scheduled', 'läuft' => 'Printing', 'nachbearbeitung' => 'Finishing', 'fertig' => 'Finished', 'abgeschlossen' => 'Closed'], 'post' => 'Finishing', 'due' => 'Due', 'progress' => 'Progress', 'parts' => '{a} of {b} parts', 'eta' => 'Expected to be ready', 'photos' => 'Finished parts', 'updated' => 'As of', 'gone' => 'This link is no longer valid.', 'printing' => 'printing right now', 'days' => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']],
];
const POST_EN = ['Stützen entfernen' => 'Support removal', 'Prüfen' => 'Quality check', 'Verpackt' => 'Packed', 'Versendet' => 'Shipped'];

function page(string $lang, string $body, string $title = 'PrintDock'): string {
    return '<!doctype html><html lang="' . $lang . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
        . '<title>' . h($title) . '</title><meta http-equiv="refresh" content="120"><style>:root{--bg:#F3F5F7;--panel:#fff;--ink:#15233B;--muted:#5B6676;--line:#DDE2E8;--acc:#3F5BD8;--ok:#16A34A}'
        . '@media (prefers-color-scheme:dark){:root{--bg:#171C23;--panel:#212933;--ink:#E8EDF3;--muted:#9BA7B6;--line:#384452;--acc:#7B93FF}}'
        . 'body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}'
        . 'main{max-width:640px;margin:0 auto;padding:24px 16px 40px}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 18px 16px;margin-bottom:14px}'
        . 'h1{font-size:1.5rem;margin:0 0 2px}.m{color:var(--muted);font-size:.9rem}.st{display:inline-block;margin-top:10px;padding:3px 10px;border-radius:999px;background:var(--acc);color:#fff;font-weight:600;font-size:.85rem}'
        . '.st.done{background:var(--ok)}.bar{height:10px;background:var(--line);border-radius:6px;overflow:hidden;margin:8px 0 4px}.bar i{display:block;height:100%;background:var(--acc)}'
        . '.row{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}'
        . '.ph{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}.ph img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;border:1px solid var(--line)}'
        . 'footer{text-align:center;color:var(--muted);font-size:.8rem}footer a{color:inherit}</style></head><body><main>' . $body . '</main></body></html>';
}
function gone(string $lang = 'de'): string { $lang = $lang === 'en' ? 'en' : 'de'; return page($lang, '<div class="card"><p>' . TXT[$lang]['gone'] . '</p></div>'); }

function renderOrder(string $lang, array $d, callable $photoUrl): string {
    $lang = $lang === 'en' ? 'en' : 'de';
    $T = TXT[$lang];
    if (!empty($d['tz'])) @date_default_timezone_set($d['tz']);
    $date = function ($iso) use ($T, $lang) { if (!$iso) return '–'; $t = strtotime($iso); return $T['days'][(int) date('w', $t)] . ', ' . ($lang === 'de' ? date('d.m.Y', $t) : date('d/m/Y', $t)); };
    $dt = function ($iso) use ($T, $lang) { $t = strtotime($iso); return $T['days'][(int) date('w', $t)] . ', ' . ($lang === 'de' ? date('d.m., H:i', $t) : date('d/m, H:i', $t)); };
    $qty = (int) ($d['qty'] ?? 0); $done = (int) ($d['done'] ?? 0);
    $pct = $qty ? (int) round($done / $qty * 100) : 0;
    $parts = fn ($a) => str_replace(['{a}', '{b}'], [(string) $a, (string) $qty], $T['parts']);
    $isDone = in_array($d['status'] ?? '', ['fertig', 'abgeschlossen'], true);
    $brand = !empty($d['brand']['name']) ? (!empty($d['brand']['url']) ? '<a href="' . h($d['brand']['url']) . '" rel="noopener">' . h($d['brand']['name']) . '</a>' : h($d['brand']['name'])) : 'PrintDock';
    $b = '<div class="card"><div class="m">' . $T['title'] . ' ' . h($d['nr'] ?? '') . '</div><h1>' . h($d['title'] ?? '') . '</h1>'
        . (!empty($d['customer']) ? '<div class="m">' . h($d['customer']) . '</div>' : '')
        . '<span class="st' . ($isDone ? ' done' : '') . '">' . h($T['status'][$d['status'] ?? ''] ?? ($d['status'] ?? '')) . '</span></div>'
        . '<div class="card"><div class="row"><span>' . $T['progress'] . '</span><b>' . $parts($done) . '</b></div><div class="bar"><i style="width:' . $pct . '%"></i></div>'
        . (!empty($d['printing']) ? '<div class="m">' . $T['printing'] . '</div>' : '')
        . '<div class="row"><span>' . $T['due'] . '</span><b>' . $date($d['due'] ?? null) . '</b></div>'
        . (!empty($d['eta']) ? '<div class="row"><span>' . $T['eta'] . '</span><b>' . $dt($d['eta']) . '</b></div>' : '') . '</div>';
    if (!empty($d['post']) && $done) {
        $b .= '<div class="card"><b>' . $T['post'] . '</b>';
        foreach ($d['post'] as $r) $b .= '<div class="row"><span>' . h($lang === 'en' ? (POST_EN[$r['name']] ?? $r['name']) : $r['name']) . '</span><b>' . $parts((int) $r['done']) . '</b></div>';
        $b .= '</div>';
    }
    if (!empty($d['photos'])) {
        $b .= '<div class="card"><b>' . $T['photos'] . '</b><div class="ph" style="margin-top:10px">';
        foreach ($d['photos'] as $id) $b .= '<img src="' . h($photoUrl($id)) . '" alt="" loading="lazy">';
        $b .= '</div></div>';
    }
    $b .= '<footer>' . $T['updated'] . ' ' . ($lang === 'de' ? date('d.m.Y, H:i', strtotime($d['updatedAt'] ?? 'now')) : date('d/m/Y, H:i', strtotime($d['updatedAt'] ?? 'now'))) . ' · ' . $brand . '</footer>';
    return page($lang, $b, ($d['nr'] ?? '') . ' – ' . ($d['title'] ?? ''));
}

// ---------------------------------------------------------------- Routen
$base = basePath();
$pretty = empty($_GET['r']) && strpos($_SERVER['REQUEST_URI'] ?? '', 'index.php') === false;
$url = fn ($p) => $pretty ? "$base$p" : "$base/index.php?r=" . rawurlencode($p);

if ($path === '/health') send(200, ['ok' => true, 'version' => VERSION]);
if ($path === '/' && $method === 'GET') send(200, str_replace(TXT['de']['gone'], 'PrintDock Status-Server – bitte den vollständigen Link aus Ihrer Auftragsbestätigung verwenden.', gone()), 'text/html; charset=utf-8');

if ($method === 'GET' && preg_match('#^/s/([a-f0-9]{24})$#', $path, $m)) {
    $meta = readJson("$DATA/{$m[1]}/order.json");
    if (!$meta || expired($meta)) send(404, gone($meta['lang'] ?? 'de'), 'text/html; charset=utf-8');
    $code = $m[1];
    send(200, renderOrder($meta['lang'] ?? 'de', array_merge($meta['data'], ['brand' => $meta['brand'] ?? null]), fn ($id) => $url("/s/$code/p/$id.jpg")), 'text/html; charset=utf-8', ['Cache-Control' => 'no-cache']);
}
if ($method === 'GET' && preg_match('#^/s/([a-f0-9]{24})/p/([\w-]{8,64})\.jpg$#', $path, $m)) {
    $meta = readJson("$DATA/{$m[1]}/order.json");
    $f = "$DATA/{$m[1]}/photos/{$m[2]}.jpg";
    if (!$meta || expired($meta) || !in_array($m[2], $meta['data']['photos'] ?? [], true) || !is_file($f)) send(404, 'Nicht gefunden', 'text/plain');
    send(200, (string) file_get_contents($f), 'image/jpeg', ['Cache-Control' => 'public, max-age=86400']);
}

// ---------------------------------------------------------------- API für PrintDock
if (strpos($path, '/api/v1/') !== 0) send(404, ['error' => 'Nicht gefunden']);
$given = '';
if (!empty($_SERVER['HTTP_AUTHORIZATION']) && preg_match('/^Bearer\s+(.+)$/i', $_SERVER['HTTP_AUTHORIZATION'], $mm)) $given = trim($mm[1]);
elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION']) && preg_match('/^Bearer\s+(.+)$/i', $_SERVER['REDIRECT_HTTP_AUTHORIZATION'], $mm)) $given = trim($mm[1]);
elseif (!empty($_SERVER['HTTP_X_RELAY_KEY'])) $given = trim($_SERVER['HTTP_X_RELAY_KEY']); // Hoster, die „Authorization“ verschlucken
$owner = null;
foreach ($KEYS as $name => $key) if ($given !== '' && hash_equals((string) $key, $given)) $owner = (string) $name;
if ($owner === null) send(401, ['error' => 'Schlüssel fehlt oder ist falsch']);
if ($path === '/api/v1/ping') send(200, ['ok' => true, 'name' => $owner, 'version' => VERSION]);

if (!preg_match('#^/api/v1/orders/([a-f0-9]{24})(?:/photos/([\w-]{8,64}))?$#', $path, $m)) send(404, ['error' => 'Nicht gefunden']);
$code = $m[1];
$photo = $m[2] ?? null;
$dir = "$DATA/$code";
$meta = readJson("$dir/order.json");
if ($meta && ($meta['owner'] ?? '') !== $owner) send(403, ['error' => 'Gehört zu einem anderen PrintDock']);

if (!$photo && $method === 'PUT') {
    $raw = (string) file_get_contents('php://input');
    if (strlen($raw) > 1000000) send(413, ['error' => 'Zu groß']);
    $b = json_decode($raw, true);
    if (!is_array($b) || empty($b['data']['nr'])) send(400, ['error' => 'Daten fehlen']);
    $photos = array_values(array_slice(array_filter($b['data']['photos'] ?? [], fn ($id) => is_string($id) && preg_match('/^[\w-]{8,64}$/', $id)), 0, 24));
    $b['data']['photos'] = $photos;
    if (!is_dir("$dir/photos")) @mkdir("$dir/photos", 0750, true);
    $next = ['owner' => $owner, 'lang' => ($b['lang'] ?? 'de') === 'en' ? 'en' : 'de', 'brand' => $b['brand'] ?? null, 'expiresAt' => $b['expiresAt'] ?? null, 'data' => $b['data'], 'at' => gmdate('c')];
    file_put_contents("$dir/order.json.tmp", json_encode($next, JSON_UNESCAPED_UNICODE));
    rename("$dir/order.json.tmp", "$dir/order.json");
    foreach (glob("$dir/photos/*.jpg") ?: [] as $f) if (!in_array(basename($f, '.jpg'), $photos, true)) @unlink($f);
    $missing = array_values(array_filter($photos, fn ($id) => !is_file("$dir/photos/$id.jpg")));
    send(200, ['ok' => true, 'missing' => $missing]);
}
if ($photo && $method === 'PUT') {
    if (!$meta) send(404, ['error' => 'Erst die Auftragsdaten senden']);
    $jpg = (string) file_get_contents('php://input');
    if (strlen($jpg) > 3000000) send(413, ['error' => 'Zu groß']);
    if (substr($jpg, 0, 2) !== "\xFF\xD8") send(400, ['error' => 'Kein JPEG']);
    file_put_contents("$dir/photos/$photo.jpg", $jpg);
    send(200, ['ok' => true]);
}
if (!$photo && $method === 'DELETE') {
    rmTree($dir);
    send(200, ['ok' => true]);
}
send(405, ['error' => 'Methode nicht erlaubt']);
