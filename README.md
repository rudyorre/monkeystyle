# monkeystyle

**[Monkeytype](https://monkeytype.com)'s themes, on any website.**

monkeystyle bundles all 187 Monkeytype palettes and maps them onto your existing CSS variables. You add one CSS rule and call one function. It works without a framework, a build plugin or an LLM.

Docs & playground: **https://monkeystyle.rudbase.com**

```bash
npm i monkeystyle
```

## How it works

1. **Every theme is ten colors.** Monkeytype describes each theme with `bg`, `main`, `caret`, `sub`, `subAlt`, `text`, `error`, `errorExtra`, `colorfulError` and `colorfulErrorExtra`. monkeystyle exposes them as `--mt-*` custom properties and derives eight on-palette accents (`--mt-accent-1..8`) for charts, tags and syntax.
2. **A bridge maps your tokens once.** The CLI reads your stylesheet and works out what each color variable is for (page background, muted text, border, accent…). It then writes one rule that points those variables at the active theme.
3. **Switch at runtime.** `applyTheme("dracula")` sets the variables and `color-scheme`, and saves the choice. A ~300-byte head script restores it before first paint.

## Quick start

```bash
npx monkeystyle bridge src/styles/global.css --out src/styles/monkeystyle.css
```

Import the generated file after your own tokens. It only applies while a theme is active (`html:root[data-mt]`), so your site is unchanged until someone picks a theme:

```css
html:root[data-mt] {
  color-scheme: var(--mt-scheme);
  --bg: var(--mt-bg);                                                     /* bg 100% */
  --bg-elevated: color-mix(in oklch, var(--mt-sub-alt) 55%, var(--mt-bg)); /* surface 89% */
  --fg-muted: var(--mt-sub);                                              /* fgMuted 98% */
  --accent: var(--mt-main);                                               /* accent 95% */
  --chart-1: var(--mt-accent-1);                                          /* categorical 100% */
}
```

Add the no-flash script to `<head>` (run `npx monkeystyle head-script` or call `headScript()`), then:

```js
import { applyTheme, clearTheme, listThemes } from "monkeystyle";

applyTheme("serika_dark");
listThemes({ scheme: "dark" }); // [{ name, bg, main, …, scheme, extras }]
clearTheme();                   // back to your native styles
```

## API

| Export | What it does |
| --- | --- |
| `applyTheme(name \| theme, opts?)` | Sets `--mt-*`, `data-mt`, `color-scheme`, saves the choice, and fires `monkeystyle:change` |
| `clearTheme(opts?)` | Removes the theme |
| `listThemes({ scheme?, query? })`, `getTheme(name)`, `randomTheme()` | Theme lookup |
| `getActiveTheme()`, `getSavedTheme()` | Current / saved theme name |
| `themeVars(theme)`, `themeCSS(theme, selector?)` | Static output for SSR/builds (works with custom palettes too) |
| `headScript(opts?)` | The inline no-flash snippet |
| `monkeystyle/bridge`: `generateBridge(css, opts?)` | Returns `{ css, mappings, skipped, hardcoded }`, each mapping with `role`, `confidence`, `reason` |
| `monkeystyle/color` | OKLCH, contrast and parsing helpers |
| `monkeystyle/themes` | Raw theme data + upstream commit |

## CLI

```
monkeystyle bridge <css files…> [--out file] [--json] [--selector S] [--config F]
monkeystyle list [--scheme dark|light] [--json]
monkeystyle css <theme> [--selector S] [--monkeytype-names]
monkeystyle head-script
monkeystyle roles
```

`monkeystyle.config.json` is picked up automatically:

```json
{
  "selector": "html:root[data-mt]",
  "overrides": { "--glyph-ink": "fgMuted", "--brand": { "expression": "var(--mt-caret)" } },
  "ignore": ["--shadow-color"]
}
```

## Development

```bash
npm install
npm test               # node --test, runs the TypeScript sources directly
npm run dev            # docs site (site/)
npm run build          # library -> dist/
npm run build:site     # docs site -> site/dist/
npm run site:bridge    # regenerate the docs site's own bridge with the CLI
npm run import-themes  # re-snapshot themes from monkeytype (optionally --sha <commit>)
```

See [DESIGN.md](./DESIGN.md) for the architecture and roadmap.

## Credits

Every palette comes from [Monkeytype](https://github.com/monkeytypegame/monkeytype), created by Jack "Miodec" and designed by the Monkeytype community. They're used with permission; see [THEMES.md](./THEMES.md). Please go type on monkeytype.com.

## License

MIT