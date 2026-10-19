# Themes – eigenes Erscheinungsbild

*[English](themes.md) · Deutsch*

PrintDock lässt sich im eigenen Look anzeigen: Farben, Logo, Name und Schriften. Ein **Theme-Paket** ist eine kleine Zip-Datei, die du unter *Einstellungen → Allgemein → Darstellung → Stil → Theme-Paket hochladen …* hochlädst. Danach steht es im Stil-Schalter neben *PrintDock*.

Die Pakete liegen im Datenordner (`data/themes/<name>/`). Sie überstehen Updates und sind in jeder Sicherung enthalten. Nichts wird aus dem Internet geladen – Schriften und Logo kommen aus dem Paket.

## Inhalt eines Pakets

```
mein-theme.zip
├── theme.json      Pflicht – Name, Farben, Logo, Schriften
├── logo.svg        optional – Logo in der Seitenleiste (SVG, PNG oder WebP)
├── favicon.svg     optional – Symbol im Browser-Tab (sonst das Logo)
├── *.woff2         optional – Schriften
├── theme.css       optional – Feinheiten, die theme.json nicht abdeckt
└── LICENSE-*.txt   optional – Lizenzen der Schriften
```

Die Dateien dürfen direkt im Zip oder in genau einem Ordner darin liegen. Andere Dateien und Unterordner werden ignoriert. Grenzen: 8 MB je Paket, 3 MB je Datei.

Ein vollständiges Beispiel liegt in [`docs/themes/example`](themes/example) – Ordner zippen und hochladen.

## theme.json

```json
{
  "name": "Werkbank",
  "version": "1.0",
  "brand": { "text": "Werk", "accentText": "bank", "sub": "printdock", "title": "Werkbank", "logo": "logo.svg", "favicon": "favicon.svg" },
  "fontFamilies": { "body": "Inter", "heading": "Inter", "mono": "JetBrains Mono" },
  "fonts": [
    { "family": "Inter", "file": "inter-variable.woff2", "weight": "100 900" },
    { "family": "JetBrains Mono", "file": "jetbrains-mono-700.woff2", "weight": 700 }
  ],
  "headings": { "weight": 800, "stretch": "100%", "letterSpacing": "-0.02em" },
  "radius": "0.625rem",
  "light": { "bg": "#EEF1EC", "panel": "#FFFFFF", "ink": "#1E2A22", "accent": "#0E7C66", "accentBg": "#DDF1EB" },
  "dark":  { "bg": "#141A16", "panel": "#1D251F", "ink": "#E8EFE9", "accent": "#4FD1B0", "accentBg": "#173A31", "accentInk": "#062019" }
}
```

| Feld | Bedeutung |
|---|---|
| `name` | Name im Stil-Schalter; bestimmt auch den Ordnernamen. Ein Paket mit gleichem Namen ersetzt das alte |
| `brand.text`, `brand.accentText` | Name in der Seitenleiste; `accentText` steht in der Akzentfarbe direkt hinter `text` |
| `brand.sub` | Kleine Zeile unter dem Namen |
| `brand.title` | Titel im Browser-Tab (danach „· PrintDock“) |
| `brand.logo`, `brand.favicon` | Dateinamen im Paket |
| `fonts` | `@font-face`-Einträge: `family`, `file` (woff2/woff), optional `weight` (z. B. `700` oder `100 900`), `stretch` (z. B. `62% 125%`), `style` |
| `fontFamilies` | Welche Schrift für Text, Überschriften/Knöpfe und Festbreite gilt |
| `headings` | Stärke, Breite (`stretch`, nur variable Schriften) und Laufweite großer Überschriften |
| `radius` | Eckenradius von Karten und Listen |
| `light`, `dark` | Farben für hell und dunkel (Hex `#RRGGBB`). Fehlende Farben bleiben wie bei PrintDock |

Farbnamen: `bg`, `panel`, `panel2`, `ink`, `muted`, `line`, `accent`, `accentBg`, `accentInk`, `btn`, `btnInk`, `run`, `runBg`, `warn`, `warnBg`, `warnInk`, `fault`, `faultBg`, `pause`, `pauseBg`, `stripe` sowie die Statusleuchten `stFree`, `stRun`, `stRun2`, `stWait`, `stFault`, `stOff`.

Die Akzentfarbe des Themes ersetzt die unter *Darstellung* gewählte Akzentfarbe.

## theme.css

Für alles Weitere. Jede Regel mit `:root[data-skin="custom"]` beginnen, damit sie nur bei aktivem Theme gilt, und Dateien im Paket relativ ansprechen (`url(muster.svg)`):

```css
:root[data-skin="custom"] .side-brand { border-bottom: 3px solid var(--accent) }
:root[data-skin="custom"] .shead::before { content: "// " }
```

Klassennamen können sich zwischen PrintDock-Versionen ändern – theme.css also klein halten.

## Schriften und Lizenzen

Nur Schriften beilegen, die weitergegeben werden dürfen (z. B. SIL Open Font License), und die Lizenzdatei dazulegen.
