# Druckportal-Schnittstelle

*[English](portal-api.md) · Deutsch*

PrintDock arbeitet mit einem **Druckportal** zusammen – einer Website, auf der Kunden STL/3MF-Dateien hochladen, eine Preisschätzung bekommen und ein Angebot bestätigen. Das Portal läuft auf normalem Webhosting; PrintDock verbindet sich nur **nach draußen** dorthin, das Heimnetz bleibt zu.

Jedes Portal, das die folgende Schnittstelle bietet, lässt sich unter *Einstellungen → Fernzugriff → Druckportal* verbinden (Adresse + API-Schlüssel). PrintDock

- übernimmt bestätigte Aufträge (Modelldateien in die Bibliothek, Auftrag mit Positionen und Statuslink) und meldet den Fortschritt zurück,
- schickt jede Minute einen Schnappschuss „Was druckt gerade?“ (*Werkstatt live*),
- zeigt den Menüpunkt **Druckportal**: Anfragen mit 3D-Vorschau, Angebote, Wartungsmodus, Materialien, Preise, Mailtexte und Einstellungen.

## Grundlagen

- Basisadresse: `<portal>/api/v1/?r=<route>`
- Anmeldung: Header `X-API-Key: <schlüssel>` (oder `Authorization: Bearer <schlüssel>`). Nie als Parameter in der Adresse
- Anfragen und Antworten sind JSON (`Content-Type: application/json`); jede Antwort hat `"ok": true|false`, Fehler zusätzlich `"error": "Text"` und einen passenden HTTP-Status
- Zeiten im ISO-Format in UTC (`2026-10-19T09:00:00Z`)
- Status: `angefragt`, `angebot`, `bestaetigt`, `im_druck`, `versendet`, `abgeschlossen`, `storniert`

## Aufträge

| Route | Methode | Zweck |
|---|---|---|
| `ping` | GET | Verbindungstest → `{ app, version, statuses, admin, shop, unseen, features }`. `admin: true` schaltet den Menüpunkt *Druckportal* frei |
| `orders` | GET | Liste. Optional `status=a,b`, `since=<ISO>`, `items=1` (mit Positionen) |
| `order&id=42` | GET | Ein Auftrag mit `items` und `log` (Verlauf) |
| `file&item=7` | GET | Modelldatei einer Position (binär) |
| `status` | POST | `{ id, status, note, notify, public, tracking }` – Status aus PrintDock |
| `link` | POST | `{ id, share_token, nr }` – PrintDock-Auftrag verknüpfen (Statuslink) |
| `order_update` | POST | `{ id, status, offer_price, offer_shipping, offer_note, message, notify, tracking, admin_note }` – fehlende Felder bleiben unverändert. Status `angebot` braucht einen Preis |
| `order_paid` | POST | `{ id, paid: true|false }` |
| `order_delete` | POST | `{ id }` – löscht den Auftrag samt Dateien |
| `seen` | POST | `{ id }` oder `{ all: true }` – Kunden-Ereignisse als gesehen markieren → `{ marked, unseen }` |

**Kunden-Ereignisse** (ab Portal 1.6): Jeder Auftrag hat `kunde: { event, at }` mit dem letzten Ereignis vom Kunden – `neu` (Anfrage eingegangen), `angenommen`, `abgelehnt` (Angebot) oder `nachricht` (Nachricht von der Statusseite) – und `unseen: true|false`. `unseen` bleibt gesetzt, bis der Auftrag im Admin oder in PrintDock geöffnet bzw. per `seen` markiert wird. PrintDock meldet ein Ereignis einmal je `kunde.at`. Außerdem `terms_at`: Zeitpunkt, zu dem der Kunde die AGB bestätigt hat.

Aufbau eines Auftrags: siehe [englische Fassung](portal-api.md#orders). `weight_g` und `hours` je Stück nutzt PrintDock für den Preisvorschlag.

## Einstellungen, Materialien, Wartung

| Route | Methode | Zweck |
|---|---|---|
| `config` | GET | `{ config, materials, statuses: [{id,label}], mail_keys: {schlüssel: name}, base_url, version }` |
| `config` | POST | Einstellungen ändern – nur die Schlüssel, die GET liefert; alles andere wird abgewiesen |
| `material` | POST | Material anlegen (`id: 0`) oder ändern: `{ id, name, density, price_per_g, colors: [{name, hex}], note, multicolor, active, sort }` |
| `material_delete` | POST | `{ id }` |
| `testmail` | POST | Testmail an die Shop-Adresse |
| `wartung` | GET | Wartungsschalter → `{ an, ziele: { <schlüssel>: { an, text, ok, name, domain, farbe } } }` |
| `wartung&ziel=<schlüssel>` | POST | `{ an: true|false, text }` – ein Ziel; `ziel=alle` schaltet alle |
| `generator` | GET | Teile des Generators → `{ teile: [{ id, name, kurz, material, quelle: mit|eigen, aktiv, vorschau, url }], materials, page }`. `vorschau` öffnet den Generator auch für ausgeblendete Teile |
| `generator_scad&id=<id>` | GET | OpenSCAD-Quelltext → `{ scad }` |
| `generator_save` | POST | `{ teile: [{ id, name?, kurz?, material?, aktiv? }] }` – Reihenfolge der Liste = Reihenfolge im Generator |
| `generator_upload` | POST | `{ id?, name, kurz, material, aktiv, scad }` – neues eigenes Teil oder neue Fassung (max. 300 KB, ohne include/use/import, mindestens ein Regler) |
| `generator_delete` | POST | `{ id }` – nur eigene Teile; eine eigene Fassung eines mitgelieferten Teils macht das Original wieder sichtbar |
| `werkstatt` | POST | Schnappschuss für Werkstatt live `{ hinweis, drucker: [{ name, farbe, status, was, material, fortschritt, fertig_um }] }` |

Die Liste der Einstellungs-Schlüssel steht in der [englischen Fassung](portal-api.md#settings-materials-maintenance). Ab Portal 1.6 liefert `config` zusätzlich `legal: { agb_vorlage, widerruf_vorlage, fehlt, aktiv, seiten }` – die aus den aktuellen Angaben erzeugten Vorlagen der AGB und der Widerrufsbelehrung, fehlende Pflichtangaben und die Adressen der Seiten. Die Wartungsziele legt das Portal fest – PrintDock zeigt an, was `wartung` liefert, mit Name, Domain und Farbe.

## Statusseiten für Kunden

Liefert das Portal auch die Statusseiten der Kunden, bietet es unter derselben Adresse und mit demselben Schlüssel die Schnittstelle des Status-Servers aus [`relay/`](../relay/README.de.md).

## Sicherheit

Der API-Schlüssel kann alles, was der Admin des Portals kann – außer Passwort und Schlüssel selbst zu ändern. Er gehört nur in PrintDock; wird er bekannt, im Portal einen neuen erzeugen und in PrintDock eintragen.
