/**
 * monkeystyle runtime: framework-agnostic helpers to list, render and apply
 * Monkeytype themes as CSS custom properties.
 *
 * Every theme becomes the same small set of variables on the root element:
 *
 *   --mt-bg, --mt-main, --mt-caret, --mt-sub, --mt-sub-alt, --mt-text,
 *   --mt-error, --mt-error-extra, --mt-colorful-error, --mt-colorful-error-extra,
 *   --mt-accent-1 … --mt-accent-8, --mt-on-main, --mt-scheme
 *
 * Your site maps its own tokens onto these once (see `monkeystyle/bridge`).
 */
import { contrast, isDark } from "./color.ts";
import { deriveAccents, ACCENT_COUNT } from "./derive.ts";
import { themes, UPSTREAM, type ThemeName } from "./themes.data.ts";
import { PALETTE_KEYS, type Palette, type PaletteKey, type Theme } from "./types.ts";

export type { Palette, PaletteKey, Theme, ThemeRecord, Scheme } from "./types.ts";
export type { ThemeName } from "./themes.data.ts";
export { themes, UPSTREAM, deriveAccents, ACCENT_COUNT, PALETTE_KEYS };

/** Upstream palette key -> monkeystyle CSS variable. */
export const VAR_NAMES: Record<PaletteKey, string> = {
  bg: "--mt-bg",
  main: "--mt-main",
  caret: "--mt-caret",
  sub: "--mt-sub",
  subAlt: "--mt-sub-alt",
  text: "--mt-text",
  error: "--mt-error",
  errorExtra: "--mt-error-extra",
  colorfulError: "--mt-colorful-error",
  colorfulErrorExtra: "--mt-colorful-error-extra",
};

/** Upstream palette key -> the variable name Monkeytype itself uses. */
export const MONKEYTYPE_VAR_NAMES: Record<PaletteKey, string> = {
  bg: "--bg-color",
  main: "--main-color",
  caret: "--caret-color",
  sub: "--sub-color",
  subAlt: "--sub-alt-color",
  text: "--text-color",
  error: "--error-color",
  errorExtra: "--error-extra-color",
  colorfulError: "--colorful-error-color",
  colorfulErrorExtra: "--colorful-error-extra-color",
};

export const DEFAULT_ATTRIBUTE = "data-mt";
export const DEFAULT_STORAGE_KEY = "monkeystyle";
/** Fired on `document` after a theme is applied or cleared. `detail` is the Theme or null. */
export const CHANGE_EVENT = "monkeystyle:change";

const themeNames = Object.keys(themes).sort((a, b) => a.localeCompare(b)) as ThemeName[];

export function isThemeName(name: string): name is ThemeName {
  return Object.prototype.hasOwnProperty.call(themes, name);
}

export function getTheme(name: string): Theme | undefined {
  return isThemeName(name) ? { name, ...themes[name] } : undefined;
}

export interface ListOptions {
  scheme?: "light" | "dark";
  /** Case-insensitive substring match on the theme name. */
  query?: string;
}

/** All bundled themes, alphabetically. */
export function listThemes(options: ListOptions = {}): Theme[] {
  const q = options.query?.trim().toLowerCase().replace(/\s+/g, "_");
  return themeNames
    .map((name) => ({ name, ...themes[name] }))
    .filter((t) => !options.scheme || t.scheme === options.scheme)
    .filter((t) => !q || t.name.includes(q));
}

export function randomTheme(options: ListOptions = {}): Theme {
  const list = listThemes(options);
  return list[Math.floor(Math.random() * list.length)] ?? listThemes()[0]!;
}

export interface VarsOptions {
  /** Also emit Monkeytype's own variable names (`--bg-color`, `--main-color`, …). */
  monkeytypeNames?: boolean;
  /** Emit `--mt-accent-1..8`. Default true. */
  accents?: boolean;
}

/** Resolve a theme (or a custom palette) into a flat map of CSS custom properties. */
export function themeVars(theme: Theme | Palette, options: VarsOptions = {}): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const key of PALETTE_KEYS) {
    vars[VAR_NAMES[key]] = theme[key];
    if (options.monkeytypeNames) vars[MONKEYTYPE_VAR_NAMES[key]] = theme[key];
  }
  if (options.accents !== false) {
    const extras = "extras" in theme ? theme.extras : [];
    deriveAccents(theme, extras).forEach((hex, i) => {
      vars[`--mt-accent-${i + 1}`] = hex;
    });
  }
  // Readable text on a `main`-colored background: whichever of bg/text contrasts more.
  vars["--mt-on-main"] = contrast(theme.main, theme.bg) >= contrast(theme.main, theme.text) ? theme.bg : theme.text;
  vars["--mt-scheme"] = schemeOf(theme);
  return vars;
}

/** Render a theme as a CSS rule, e.g. for static builds or SSR. */
export function themeCSS(theme: Theme | Palette, selector = ":root", options: VarsOptions = {}): string {
  const body = Object.entries(themeVars(theme, options))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `${selector} {\n${body}\n  color-scheme: ${schemeOf(theme)};\n}\n`;
}

export interface ApplyOptions {
  /** Element to theme. Default `document.documentElement`. */
  root?: HTMLElement;
  /** Attribute set to the theme name. Default `data-mt`. */
  attribute?: string;
  /** localStorage key, or `false` to skip persistence. Default `monkeystyle`. */
  storageKey?: string | false;
  /** Passed through to `themeVars`. */
  vars?: VarsOptions;
}

interface Saved {
  name: string;
  scheme: string;
  vars: Record<string, string>;
}

/**
 * Apply a theme: sets `--mt-*` inline on the root, the `data-mt` attribute,
 * `color-scheme`, persists to localStorage, and dispatches `monkeystyle:change`.
 */
export function applyTheme(theme: ThemeName | (string & {}) | Theme, options: ApplyOptions = {}): Theme {
  const resolved = typeof theme === "string" ? getTheme(theme) : theme;
  if (!resolved) throw new Error(`monkeystyle: unknown theme "${String(theme)}"`);

  const root = options.root ?? document.documentElement;
  const attribute = options.attribute ?? DEFAULT_ATTRIBUTE;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  const vars = themeVars(resolved, options.vars);

  removeVars(root);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.colorScheme = resolved.scheme;
  root.setAttribute(attribute, resolved.name);

  if (storageKey) {
    const saved: Saved = { name: resolved.name, scheme: resolved.scheme, vars };
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      /* storage unavailable (private mode, quota): theme still applies */
    }
  }

  root.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: resolved, bubbles: true }));
  return resolved;
}

/** Remove the active theme and return the site to its native styles. */
export function clearTheme(options: ApplyOptions = {}): void {
  const root = options.root ?? document.documentElement;
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  removeVars(root);
  root.style.removeProperty("color-scheme");
  root.removeAttribute(options.attribute ?? DEFAULT_ATTRIBUTE);
  if (storageKey) {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }
  root.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: null, bubbles: true }));
}

/** Name of the currently applied theme, if any. */
export function getActiveTheme(options: Pick<ApplyOptions, "root" | "attribute"> = {}): ThemeName | null {
  const root = options.root ?? document.documentElement;
  const name = root.getAttribute(options.attribute ?? DEFAULT_ATTRIBUTE);
  return name && isThemeName(name) ? name : null;
}

/** Name of the theme saved in localStorage, if any. */
export function getSavedTheme(storageKey: string = DEFAULT_STORAGE_KEY): ThemeName | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null") as Saved | null;
    return saved && isThemeName(saved.name) ? saved.name : null;
  } catch {
    return null;
  }
}

/**
 * A tiny inline script for `<head>` that re-applies the saved theme before
 * first paint (no flash). It reads the resolved variables from localStorage,
 * so it needs no theme data.
 */
export function headScript(options: { storageKey?: string; attribute?: string } = {}): string {
  const key = JSON.stringify(options.storageKey ?? DEFAULT_STORAGE_KEY);
  const attr = JSON.stringify(options.attribute ?? DEFAULT_ATTRIBUTE);
  return `(function(){try{var s=JSON.parse(localStorage.getItem(${key})||"null");if(!s||!s.vars)return;var r=document.documentElement;for(var k in s.vars)r.style.setProperty(k,s.vars[k]);r.style.colorScheme=s.scheme;r.setAttribute(${attr},s.name)}catch(e){}})();`;
}

function schemeOf(theme: Theme | Palette): "light" | "dark" {
  if ("scheme" in theme) return theme.scheme;
  return isDark(theme.bg) ? "dark" : "light";
}

function removeVars(root: HTMLElement) {
  for (let i = root.style.length - 1; i >= 0; i--) {
    const prop = root.style.item(i);
    if (prop.startsWith("--mt-") || Object.values(MONKEYTYPE_VAR_NAMES).includes(prop)) {
      root.style.removeProperty(prop);
    }
  }
}
