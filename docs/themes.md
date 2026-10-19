# Themes – your own look

*English · [Deutsch](themes.de.md)*

PrintDock can use your own look: colours, logo, name and fonts. A **theme package** is a small zip file that you upload under *Settings → General → Appearance → Style → Upload theme package …*. After that it appears next to *PrintDock* in the style switch.

Packages are stored in the data folder (`data/themes/<name>/`). They survive updates and are part of every backup. Nothing is loaded from the internet – fonts and logo come from the package.

## Contents of a package

```
my-theme.zip
├── theme.json      required – name, colours, logo, fonts
├── logo.svg        optional – logo in the sidebar (SVG, PNG or WebP)
├── favicon.svg     optional – icon in the browser tab (default: the logo)
├── *.woff2         optional – fonts
├── theme.css       optional – fine-tuning that theme.json doesn't cover
└── LICENSE-*.txt   optional – font licences
```

The files may sit directly in the zip or in one folder inside it. Other files and subfolders are ignored. Limits: 8 MB per package, 3 MB per file.

A complete example lives in [`docs/themes/example`](themes/example) – zip the folder and upload it.

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

| Field | Meaning |
|---|---|
| `name` | Name in the style switch; also determines the folder name. A package with the same name replaces the old one |
| `brand.text`, `brand.accentText` | Name in the sidebar; `accentText` is shown in the accent colour right after `text` |
| `brand.sub` | Small line below the name |
| `brand.title` | Browser tab title (followed by "· PrintDock") |
| `brand.logo`, `brand.favicon` | File names in the package |
| `fonts` | `@font-face` entries: `family`, `file` (woff2/woff), optional `weight` (e.g. `700` or `100 900`), `stretch` (e.g. `62% 125%`), `style` |
| `fontFamilies` | Which family is used for body text, headings/buttons and monospace |
| `headings` | Weight, width (`stretch`, variable fonts only) and letter spacing of big headings |
| `radius` | Corner radius of cards and lists |
| `light`, `dark` | Colours for light and dark mode (hex `#RRGGBB`). Missing colours keep the PrintDock default |

Colour names: `bg`, `panel`, `panel2`, `ink`, `muted`, `line`, `accent`, `accentBg`, `accentInk`, `btn`, `btnInk`, `run`, `runBg`, `warn`, `warnBg`, `warnInk`, `fault`, `faultBg`, `pause`, `pauseBg`, `stripe`, and the status lights `stFree`, `stRun`, `stRun2`, `stWait`, `stFault`, `stOff`.

The accent colour of the theme replaces the accent colour chosen under *Appearance*.

## theme.css

For anything else. Start every rule with `:root[data-skin="custom"]` so it only applies while the theme is active, and refer to files in the package relatively (`url(pattern.svg)`):

```css
:root[data-skin="custom"] .side-brand { border-bottom: 3px solid var(--accent) }
:root[data-skin="custom"] .shead::before { content: "// " }
```

The class names may change between PrintDock versions – keep theme.css small.

## Fonts and licences

Only include fonts you are allowed to redistribute (e.g. SIL Open Font License) and add the licence file.
