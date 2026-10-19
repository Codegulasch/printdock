# Print portal interface

*English · [Deutsch](portal-api.de.md)*

PrintDock can work together with a **print portal** – a website where customers upload STL/3MF files, get a price estimate and confirm a quote. The portal runs on regular web hosting; PrintDock only connects **outwards** to it, the home network stays closed.

Any portal that implements the interface below can be connected under *Settings → Remote access → Print portal* (address + API key). PrintDock then

- takes over confirmed orders (model files into the library, an order with items and a status link) and reports progress back,
- sends a "What's printing?" snapshot every minute (*workshop live*),
- shows the menu item **Print portal**: requests with 3D preview, quotes, maintenance mode, materials, prices, email texts and settings.

## Basics

- Base address: `<portal>/api/v1/?r=<route>`
- Authentication: header `X-API-Key: <key>` (or `Authorization: Bearer <key>`). Never as a URL parameter
- Requests and responses are JSON (`Content-Type: application/json`); every response has `"ok": true|false`, errors also `"error": "text"` and a fitting HTTP status
- Times are ISO 8601 in UTC (`2026-10-19T09:00:00Z`)
- Status values: `angefragt` (new), `angebot` (quote sent), `bestaetigt` (confirmed), `im_druck` (printing), `versendet` (shipped), `abgeschlossen` (completed), `storniert` (cancelled)

## Orders

| Route | Method | Purpose |
|---|---|---|
| `ping` | GET | Connection test → `{ app, version, statuses, admin, shop, unseen, features }`. `admin: true` enables the menu item *Print portal* |
| `orders` | GET | List. Optional `status=a,b`, `since=<ISO>`, `items=1` (with items) |
| `order&id=42` | GET | One order with `items` and `log` (history) |
| `file&item=7` | GET | Model file of an item (binary) |
| `status` | POST | `{ id, status, note, notify, public, tracking }` – status from PrintDock |
| `link` | POST | `{ id, share_token, nr }` – link the PrintDock order (status link) |
| `order_update` | POST | `{ id, status, offer_price, offer_shipping, offer_note, message, notify, tracking, admin_note }` – missing fields stay unchanged. Status `angebot` needs a price |
| `order_paid` | POST | `{ id, paid: true|false }` |
| `order_delete` | POST | `{ id }` – deletes the order including files |
| `seen` | POST | `{ id }` or `{ all: true }` – mark customer events as seen → `{ marked, unseen }` |

Order object (abridged):

```json
{
  "id": 42, "number": "P-2026-0042", "status": "angefragt", "created_at": "…", "updated_at": "…",
  "customer": { "name": "…", "email": "…", "phone": null, "company": null, "lang": "de" },
  "note": "message from the customer", "admin_note": null,
  "estimate": { "min": 18.6, "max": 23.4, "shipping": 5.49 },
  "offer": { "price": 19.9, "shipping": 5.49, "note": null },
  "paid_at": null, "tracking": null, "status_url": "https://…",
  "items": [{ "id": 7, "filename": "part.stl", "format": "stl", "size_mm": [40, 26, 60], "volume_cm3": 14.2,
              "material": "PETG", "material_id": 2, "colors": ["Black"], "qty": 4, "weight_g": 18, "hours": 1.2, "est_price": 3.9 }],
  "log": [{ "at": "…", "status": "angefragt", "note": null, "actor": "kunde", "public": true }]
}
```

`weight_g` and `hours` per piece are used for PrintDock's price suggestion.

**Customer events** (portal 1.6+): every order has `kunde: { event, at }` with the customer's latest event – `neu` (request received), `angenommen` / `abgelehnt` (quote accepted / declined) or `nachricht` (message from the status page) – and `unseen: true|false`. `unseen` stays set until the order is opened in the admin or in PrintDock, or marked via `seen`. PrintDock reports each event once per `kunde.at`. `terms_at` is when the customer accepted the terms.

## Settings, materials, maintenance

| Route | Method | Purpose |
|---|---|---|
| `config` | GET | `{ config, materials, statuses: [{id,label}], mail_keys: {key: label}, base_url, version }` |
| `config` | POST | Change settings – only the keys returned by GET; anything else is rejected |
| `material` | POST | Create (`id: 0`) or change a material: `{ id, name, density, price_per_g, colors: [{name, hex}], note, multicolor, active, sort }` |
| `material_delete` | POST | `{ id }` |
| `testmail` | POST | Send a test email to the shop address |
| `wartung` | GET | Maintenance switches → `{ an, ziele: { <key>: { an, text, ok, name, domain, farbe } } }` |
| `wartung&ziel=<key>` | POST | `{ an: true|false, text }` – one target; `ziel=alle` switches all |
| `generator` | GET | Generator parts → `{ teile: [{ id, name, kurz, material, quelle: mit|eigen, aktiv, vorschau, url }], materials, page }`. `vorschau` opens the generator even for hidden parts |
| `generator_scad&id=<id>` | GET | OpenSCAD source → `{ scad }` |
| `generator_save` | POST | `{ teile: [{ id, name?, kurz?, material?, aktiv? }] }` – list order = order in the generator |
| `generator_upload` | POST | `{ id?, name, kurz, material, aktiv, scad }` – new own part or new version (max. 300 KB, no include/use/import, at least one parameter) |
| `generator_delete` | POST | `{ id }` – own parts only; deleting your version of a built-in part brings back the original |
| `werkstatt` | POST | Workshop-live snapshot `{ hinweis, drucker: [{ name, farbe, status, was, material, fortschritt, fertig_um }] }` |

Config keys PrintDock edits: `shop_name`, `tagline_de`, `site_url`, `base_url`, `order_prefix`, `build_x|y|z`, `formats`, `max_file_mb`, `max_files`, `max_qty`, `max_colors`, `base_fee`, `fill_factor`, `machine_rate`, `throughput`, `color_surcharge`, `min_price`, `spread_pct`, `discounts` (`[{from, pct}]`), `shipping`, `free_shipping_from`, `price_note_de`, `mail_enabled`, `mail_from`, `mail_from_name`, `mail_shop`, `mail_templates` (`{key: {de: {subject, body}}}`, `null` = defaults), `impressum_url`, `privacy_url`, `agb_url`, `schichtsalat_url` (game on the status page), `werkstatt_origins`, `rate_limit_hour`, and from portal 1.6 the legal keys `agb_on`, `anbieter_name`, `anbieter_strasse`, `anbieter_ort`, `anbieter_telefon`, `kleinunternehmer`, `kunden` (`privat`|`beide`), `zahlarten` (`ueberweisung`, `paypal`, `bar`), `lieferarten` (`versand`, `abholung`), `lieferlaender`, `angebot_tage`, `agb_stand`, `agb_text`, `widerruf_text` (empty = generated template). `config` GET then also returns `legal: { agb_vorlage, widerruf_vorlage, fehlt, aktiv, seiten }`.

The maintenance targets are defined by the portal – PrintDock shows whatever `wartung` returns, with name, domain and colour.

## Customer status pages

If the portal also serves the customer status pages, it implements the status-server interface of [`relay/`](../relay/README.md) under the same address and key.

## Security

The API key can do everything the portal admin can, except changing the password and the key itself. Keep it in PrintDock only; if it leaks, create a new one in the portal and enter it in PrintDock.
