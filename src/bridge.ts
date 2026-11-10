/**
 * The translation layer.
 *
 * Reads a site's CSS, finds its color custom properties, infers what role each
 * one plays (page background, muted text, border, accent, …) and generates a
 * "bridge": one CSS rule that re-points those properties at monkeystyle's
 * `--mt-*` variables while a theme is active.
 *
 * Fully deterministic, no network, no LLM: names, values and usage are scored
 * with simple heuristics, and every decision comes with a confidence score and
 * a human-readable reason so it can be reviewed or overridden.
 */
import { hueDistance, parseColor, rgbToOklch, type OKLCH, type RGBA } from "./color.ts";

export type Role =
  | "bg"
  | "surface"
  | "surfaceAlt"
  | "fg"
  | "fgMuted"
  | "fgFaint"
  | "border"
  | "borderStrong"
  | "accent"
  | "onAccent"
  | "caret"
  | "selection"
  | "backdrop"
  | "danger"
  | "categorical";

export const ROLES: readonly Role[] = [
  "bg",
  "surface",
  "surfaceAlt",
  "fg",
  "fgMuted",
  "fgFaint",
  "border",
  "borderStrong",
  "accent",
  "onAccent",
  "caret",
  "selection",
  "backdrop",
  "danger",
  "categorical",
];

/** What each role means, for docs and reports. */
export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  bg: "page background",
  surface: "raised surface (cards, popovers)",
  surfaceAlt: "subtle/sunken surface (code blocks, hovers)",
  fg: "primary text",
  fgMuted: "secondary text",
  fgFaint: "tertiary / disabled text",
  border: "hairline borders & dividers",
  borderStrong: "emphasized borders",
  accent: "brand / link / primary action",
  onAccent: "text on accent backgrounds",
  caret: "focus ring / caret",
  selection: "text selection & highlights",
  backdrop: "modal backdrop / scrim",
  danger: "errors & destructive actions",
  categorical: "series color (charts, tags)",
};

/** How each role is expressed in terms of the theme's `--mt-*` variables. */
export function roleExpression(role: Role, opts: { index?: number; alpha?: number } = {}): string {
  switch (role) {
    case "bg":
      return "var(--mt-bg)";
    case "surface":
      return "color-mix(in oklch, var(--mt-sub-alt) 55%, var(--mt-bg))";
    case "surfaceAlt":
      return "var(--mt-sub-alt)";
    case "fg":
      return "var(--mt-text)";
    case "fgMuted":
      return "var(--mt-sub)";
    case "fgFaint":
      return "color-mix(in oklch, var(--mt-sub) 65%, var(--mt-bg))";
    case "border":
      return "color-mix(in oklch, var(--mt-sub) 30%, var(--mt-sub-alt))";
    case "borderStrong":
      return "color-mix(in oklch, var(--mt-sub) 60%, var(--mt-sub-alt))";
    case "accent":
      return "var(--mt-main)";
    case "onAccent":
      return "var(--mt-on-main)";
    case "caret":
      return "var(--mt-caret)";
    case "selection":
      return "color-mix(in oklch, var(--mt-main) 30%, var(--mt-bg))";
    case "backdrop": {
      const pct = Math.round(Math.min(0.9, Math.max(0.4, opts.alpha ?? 0.6)) * 100);
      return `color-mix(in srgb, var(--mt-bg) ${pct}%, transparent)`;
    }
    case "danger":
      return "var(--mt-error)";
    case "categorical":
      return `var(--mt-accent-${(((opts.index ?? 1) - 1) % 8) + 1})`;
  }
}

/* -------------------------------------------------------------------------- */
/* CSS scanning                                                                */
/* -------------------------------------------------------------------------- */

export interface CustomProperty {
  name: string;
  /** Value from the most "base" rule (`:root`, `html`, …), or the first seen. */
  value: string;
  selector: string;
  /** Every selector the property is (re)defined in. */
  definedIn: string[];
  /** CSS properties that consume it via `var(--name)`. */
  usedBy: string[];
}

export interface HardcodedColor {
  selector: string;
  property: string;
  value: string;
}

export interface ScanResult {
  properties: CustomProperty[];
  /** Color literals in regular declarations; these won't follow a theme. */
  hardcoded: HardcodedColor[];
}

const BASE_SELECTOR = /^(?::root|html|:host|body)(?:\s*,\s*(?::root|html|:host|body))*$/;
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\([^)]*\)/;

/** Minimal CSS scanner: handles nesting/at-rules, comments and quoted strings. */
export function scanCSS(input: string | string[]): ScanResult {
  const sources = Array.isArray(input) ? input : [input];
  const props = new Map<string, CustomProperty>();
  const usage = new Map<string, Set<string>>();
  const hardcoded: HardcodedColor[] = [];

  for (const source of sources) {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const stack: string[] = [];
    let buf = "";
    let quote: string | null = null;
    let parens = 0;

    const flushDeclaration = () => {
      const decl = buf.trim();
      buf = "";
      if (!decl || !stack.length) return;
      const colon = decl.indexOf(":");
      if (colon <= 0) return;
      const property = decl.slice(0, colon).trim();
      const value = decl.slice(colon + 1).replace(/!important\s*$/, "").trim();
      const selector = stack.filter((s) => !s.startsWith("@")).at(-1) ?? stack.at(-1)!;
      const atRules = stack.filter((s) => s.startsWith("@"));
      const context = [...atRules, selector].join(" ");

      if (property.startsWith("--")) {
        const existing = props.get(property);
        const isBase = BASE_SELECTOR.test(selector) && atRules.length === 0;
        if (!existing) {
          props.set(property, { name: property, value, selector: context, definedIn: [context], usedBy: [] });
        } else {
          existing.definedIn.push(context);
          if (isBase && !(BASE_SELECTOR.test(existing.selector))) {
            existing.value = value;
            existing.selector = context;
          }
        }
      } else if (COLOR_LITERAL.test(value) && !/^(?:src|content|grid|font)/.test(property)) {
        hardcoded.push({ selector: context, property, value });
      }

      for (const m of value.matchAll(/var\(\s*(--[\w-]+)/g)) {
        const set = usage.get(m[1]!) ?? new Set<string>();
        set.add(property);
        usage.set(m[1]!, set);
      }
    };

    for (let i = 0; i < css.length; i++) {
      const ch = css[i]!;
      if (quote) {
        buf += ch;
        if (ch === quote && css[i - 1] !== "\\") quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        buf += ch;
      } else if (ch === "(") {
        parens++;
        buf += ch;
      } else if (ch === ")") {
        parens = Math.max(0, parens - 1);
        buf += ch;
      } else if (ch === ";" && parens === 0) {
        flushDeclaration();
      } else if (ch === "{" && parens === 0) {
        stack.push(buf.trim().replace(/\s+/g, " "));
        buf = "";
      } else if (ch === "}" && parens === 0) {
        flushDeclaration();
        stack.pop();
      } else {
        buf += ch;
      }
    }
  }

  for (const [name, set] of usage) {
    const p = props.get(name);
    if (p) p.usedBy = [...set].sort();
  }
  return { properties: [...props.values()], hardcoded };
}

/* -------------------------------------------------------------------------- */
/* Role inference                                                              */
/* -------------------------------------------------------------------------- */

export interface Mapping {
  name: string;
  /** Original value (from the base rule). */
  value: string;
  role: Role;
  /** 0..1, how sure the classifier is. Review anything under ~0.5. */
  confidence: number;
  /** Short explanation of the strongest signals. */
  reason: string;
  /** CSS expression the bridge assigns. */
  expression: string;
  /** True when the role came from `overrides`. */
  overridden?: boolean;
}

export interface Skipped {
  name: string;
  value: string;
  reason: string;
}

export interface BridgeOptions {
  /**
   * Selector for the bridge rule. Default `html:root[data-mt]`, which out-ranks
   * typical `:root[data-theme="dark"]` rules without `!important`.
   */
  selector?: string;
  /** Force a role (or a raw CSS expression) for specific properties. */
  overrides?: Record<string, Role | { expression: string }>;
  /** Properties to leave untouched. */
  ignore?: string[];
  /** Include a comment with role + confidence after each line. Default true. */
  comments?: boolean;
}

export interface BridgeResult {
  css: string;
  mappings: Mapping[];
  skipped: Skipped[];
  hardcoded: HardcodedColor[];
}

type Family = "bgFamily" | "fgFamily" | "borderFamily";

const FAMILY_ROLES: Record<Family, Role[]> = {
  bgFamily: ["bg", "surface", "surfaceAlt"],
  fgFamily: ["fg", "fgMuted", "fgFaint"],
  borderFamily: ["border", "borderStrong"],
};

/** Ideal position between page bg (0) and primary text (1) for neutral roles. */
const TIER: Partial<Record<Role, number>> = {
  bg: 0,
  surface: 0.035,
  surfaceAlt: 0.07,
  border: 0.16,
  borderStrong: 0.32,
  fgFaint: 0.5,
  fgMuted: 0.7,
  fg: 1,
};

const T = (...words: string[]) => new Set(words);
const W = {
  bg: T("bg", "background", "canvas", "page", "base", "backdrop-bg"),
  surface: T("surface", "card", "panel", "popover", "paper", "sheet", "container", "raised", "elevated", "elevation", "menu", "dialog", "modal"),
  subtle: T("subtle", "alt", "secondary", "sunken", "inset", "well", "soft", "muted", "hover", "weak", "dim", "2", "code", "inline"),
  text: T("fg", "foreground", "text", "ink", "copy", "content", "heading", "title", "body", "font", "type"),
  muted: T("muted", "secondary", "sub", "dim", "soft", "meta", "quiet", "subtle", "2", "light", "weak"),
  faint: T("faint", "tertiary", "disabled", "placeholder", "hint", "ghost", "3", "lighter"),
  border: T("border", "line", "divider", "rule", "outline", "stroke", "grid", "separator", "hairline", "edge"),
  strong: T("strong", "emphasis", "bold", "heavy", "hover", "dark", "2", "active"),
  accent: T("accent", "primary", "brand", "main", "link", "theme", "tint", "interactive", "action", "cta"),
  caret: T("caret", "cursor", "focus", "ring"),
  selection: T("selection", "select", "selected", "highlight", "mark", "marker"),
  backdrop: T("backdrop", "overlay", "scrim", "mask", "veil", "dim"),
  danger: T("error", "danger", "destructive", "invalid", "negative", "alert", "red", "critical"),
  categorical: T("chart", "series", "palette", "data", "categorical", "swatch", "tag", "label", "hue"),
  on: T("on", "contrast", "inverse", "inverted"),
};

interface Features {
  tokens: string[];
  rgba: RGBA;
  lch: OKLCH;
  /** position between page bg (0) and fg (1) by OKLCH lightness */
  tier: number;
  chromatic: boolean;
  seriesIndex: number | null;
}

function tokenize(name: string): string[] {
  return name
    .replace(/^--/, "")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .split(/[-_]+|(?<=[a-z])(?=\d)/)
    .filter(Boolean);
}

/** Follow `var(--x)` aliases to a concrete value (for analysis only). */
function resolveValue(value: string, byName: Map<string, CustomProperty>, depth = 0): string {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value.trim());
  if (!m || depth > 8) return value;
  const target = byName.get(m[1]!);
  if (target) return resolveValue(target.value, byName, depth + 1);
  return m[2] ? resolveValue(m[2], byName, depth + 1) : value;
}

function pickReference(
  props: CustomProperty[],
  primary: Set<string>,
  disqualify: Set<string>,
  usageProps: RegExp,
): CustomProperty | undefined {
  const scored = props
    .map((p) => {
      const tokens = tokenize(p.name);
      let score = 0;
      if (tokens.some((t) => primary.has(t))) score += 3;
      score -= tokens.filter((t) => disqualify.has(t)).length * 2;
      score -= Math.max(0, tokens.length - 1) * 0.5;
      if (p.usedBy.some((u) => usageProps.test(u))) score += 1;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.p;
}

/**
 * Infer roles for a set of scanned custom properties.
 * Returns mappings for color properties and the reasons others were skipped.
 */
export function inferRoles(
  properties: CustomProperty[],
  options: Pick<BridgeOptions, "overrides" | "ignore"> = {},
): { mappings: Mapping[]; skipped: Skipped[] } {
  const byName = new Map(properties.map((p) => [p.name, p]));
  const skipped: Skipped[] = [];
  const colors: { prop: CustomProperty; rgba: RGBA }[] = [];

  for (const prop of properties) {
    if (options.ignore?.includes(prop.name)) {
      skipped.push({ name: prop.name, value: prop.value, reason: "ignored by config" });
      continue;
    }
    if (/^var\(/.test(prop.value.trim()) && !options.overrides?.[prop.name]) {
      skipped.push({ name: prop.name, value: prop.value, reason: "alias of another variable (follows automatically)" });
      continue;
    }
    const rgba = parseColor(resolveValue(prop.value, byName));
    if (!rgba) {
      if (!options.overrides?.[prop.name]) {
        skipped.push({ name: prop.name, value: prop.value, reason: "not a color" });
      }
      continue;
    }
    colors.push({ prop, rgba });
  }

  const colorProps = colors.map((c) => c.prop);
  const bgRef =
    pickReference(colorProps, W.bg, new Set([...W.surface, ...W.subtle, ...W.on, ...W.selection, ...W.text]), /^background/) ??
    colorProps.find((p) => p.usedBy.some((u) => /^background/.test(u)));
  const fgRef =
    pickReference(colorProps, W.text, new Set([...W.muted, ...W.faint, ...W.on, ...W.selection, ...W.bg]), /^color$/);
  const bgRGBA = (bgRef && colors.find((c) => c.prop === bgRef)?.rgba) ?? parseColor("#ffffff")!;
  const bgL = rgbToOklch(bgRGBA).l;
  const fgL = fgRef ? rgbToOklch(colors.find((c) => c.prop === fgRef)!.rgba).l : bgL > 0.5 ? 0 : 1;
  const span = Math.abs(fgL - bgL) < 0.2 ? (bgL > 0.5 ? -bgL : 1 - bgL) : fgL - bgL;

  // Series detection: --foo-1, --foo-2, --foo-3 … with at least 3 members.
  const seriesCount = new Map<string, number>();
  for (const p of colorProps) {
    const m = /^(.*?)-?(\d+)$/.exec(p.name);
    if (m) seriesCount.set(m[1]!, (seriesCount.get(m[1]!) ?? 0) + 1);
  }

  const mappings: Mapping[] = [];
  for (const { prop, rgba } of colors) {
    const override = options.overrides?.[prop.name];
    const lch = rgbToOklch(rgba);
    const tokens = tokenize(prop.name);
    const sm = /^(.*?)-?(\d+)$/.exec(prop.name);
    const f: Features = {
      tokens,
      rgba,
      lch,
      tier: (lch.l - bgL) / span,
      chromatic: lch.c >= 0.06,
      seriesIndex: sm && (seriesCount.get(sm[1]!) ?? 0) >= 3 ? Number(sm[2]) : null,
    };

    if (override) {
      const role = typeof override === "string" ? override : "accent";
      mappings.push({
        name: prop.name,
        value: prop.value,
        role,
        confidence: 1,
        reason: "set in overrides",
        expression: typeof override === "string" ? roleExpression(override, { index: f.seriesIndex ?? 1, alpha: rgba.a }) : override.expression,
        overridden: true,
      });
      continue;
    }

    const { role, confidence, reason } = classify(prop, f, prop === bgRef, prop === fgRef);
    mappings.push({
      name: prop.name,
      value: prop.value,
      role,
      confidence,
      reason,
      expression: roleExpression(role, { index: f.seriesIndex ?? 1, alpha: rgba.a }),
    });
  }

  return { mappings, skipped };
}

function classify(
  prop: CustomProperty,
  f: Features,
  isBgRef: boolean,
  isFgRef: boolean,
): { role: Role; confidence: number; reason: string } {
  const score = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  const why: Partial<Record<Role, string[]>> = {};
  const add = (role: Role, n: number, reason: string) => {
    score[role] += n;
    (why[role] ??= []).push(reason);
  };
  const has = (set: Set<string>) => f.tokens.find((t) => set.has(t));
  const addFamily = (family: Family, n: number, reason: string) => {
    for (const r of FAMILY_ROLES[family]) add(r, n, reason);
  };

  // --- name signals -------------------------------------------------------
  const tText = has(W.text);
  const tBg = has(W.bg);
  const tSurface = has(W.surface);
  const tBorder = has(W.border);
  const tOn = has(W.on);
  // "plain" = nothing but the role word (optionally with "color"), e.g. --bg, --text-color
  const plain = f.tokens.filter((t) => t !== "color").length === 1;

  if (isBgRef) add("bg", 4, "page background reference");
  if (isFgRef) add("fg", 4, "primary text reference");

  if (tOn && (has(W.accent) || has(W.danger))) {
    add("onAccent", 5, `"${tOn}" + accent name`);
  }
  if (tBg || tSurface) {
    addFamily("bgFamily", 2, `name "${tBg ?? tSurface}"`);
    const sub = has(W.subtle);
    if (sub) add("surfaceAlt", 2, `"${sub}"`);
    else if (tSurface) add("surface", 2, `"${tSurface}"`);
    if (!tSurface && !sub && plain) add("bg", 1, "plain background name");
  }
  if (tText && !tBg) {
    addFamily("fgFamily", 2, `name "${tText}"`);
    const faint = has(W.faint);
    const muted = has(W.muted);
    if (faint) add("fgFaint", 2, `"${faint}"`);
    else if (muted) add("fgMuted", 2, `"${muted}"`);
    else if (plain) add("fg", 1, "plain text name");
  }
  if (!tText && !tBg && !tSurface) {
    const faint = has(W.faint);
    const muted = has(W.muted);
    if (faint) add("fgFaint", 1.5, `"${faint}"`);
    else if (muted && !has(W.border) && !has(W.accent)) add("fgMuted", 1.5, `"${muted}"`);
  }
  if (tBorder) {
    addFamily("borderFamily", 3, `name "${tBorder}"`);
    const strong = has(W.strong);
    if (strong) add("borderStrong", 2, `"${strong}"`);
  }
  const tAccent = has(W.accent);
  if (tAccent && !tOn) add("accent", 4, `name "${tAccent}"`);
  const tCaret = has(W.caret);
  if (tCaret) add("caret", 4, `name "${tCaret}"`);
  const tSel = has(W.selection);
  if (tSel) add("selection", 5, `name "${tSel}"`);
  const tBackdrop = has(W.backdrop);
  if (tBackdrop) add("backdrop", f.rgba.a < 1 ? 5 : 3, `name "${tBackdrop}"`);
  const tDanger = has(W.danger);
  if (tDanger && !tOn) add("danger", 5, `name "${tDanger}"`);
  if (f.seriesIndex !== null && (f.chromatic || has(W.categorical) || tAccent)) {
    add("categorical", 6, `numbered series member (#${f.seriesIndex})`);
  } else if (has(W.categorical) && f.chromatic) {
    add("categorical", 2, `name "${has(W.categorical)}"`);
  }

  // --- usage signals ------------------------------------------------------
  if (prop.usedBy.some((u) => /^background/.test(u))) addFamily("bgFamily", 0.75, "used as background");
  if (prop.usedBy.some((u) => u === "color" || u === "fill")) addFamily("fgFamily", 0.75, "used as text color");
  if (prop.usedBy.some((u) => /^(border|outline)/.test(u))) addFamily("borderFamily", 0.75, "used in borders");
  if (f.rgba.a < 1 && f.rgba.a > 0) add("backdrop", 1, "translucent");

  // --- value signals ------------------------------------------------------
  const neutralWeight = f.chromatic ? 0.6 : 1.6;
  for (const role of Object.keys(TIER) as Role[]) {
    // Sunken surfaces/borders can sit on either side of the page bg, so match
    // distance from bg for those; text tiers keep their direction.
    const tier = role.startsWith("fg") ? f.tier : Math.abs(f.tier);
    const d = (tier - TIER[role]!) / 0.12;
    const v = Math.exp(-d * d) * neutralWeight;
    if (v > 0.15) add(role, v, `lightness tier ${tier.toFixed(2)}`);
  }
  if (f.chromatic) {
    add("accent", 1.2, `chromatic (C=${f.lch.c.toFixed(2)})`);
    const redHue = hueDistance(f.lch.h, 25) < 22;
    if (redHue) add("danger", 0.8, "red hue");
  }

  // --- decide -------------------------------------------------------------
  const ranked = (Object.entries(score) as [Role, number][]).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  const role = top![0];
  const confidence = 1 / (1 + Math.exp(-(top![1] - second![1]) * 1.2));
  const reasons = [...new Set(why[role] ?? [])].slice(0, 3).join(", ");
  return { role, confidence: Math.round(confidence * 100) / 100, reason: reasons || "best fit" };
}

/* -------------------------------------------------------------------------- */
/* Bridge generation                                                           */
/* -------------------------------------------------------------------------- */

export const DEFAULT_BRIDGE_SELECTOR = "html:root[data-mt]";

/** Scan CSS, infer roles, and render the bridge rule. */
export function generateBridge(css: string | string[], options: BridgeOptions = {}): BridgeResult {
  const { properties, hardcoded } = scanCSS(css);
  const { mappings, skipped } = inferRoles(properties, options);
  return { css: renderBridge(mappings, options), mappings, skipped, hardcoded };
}

export function renderBridge(mappings: Mapping[], options: BridgeOptions = {}): string {
  const selector = options.selector ?? DEFAULT_BRIDGE_SELECTOR;
  const comments = options.comments !== false;
  const width = Math.max(0, ...mappings.map((m) => m.name.length + m.expression.length + 4));
  const lines = mappings.map((m) => {
    const decl = `${m.name}: ${m.expression};`;
    if (!comments) return `  ${decl}`;
    const flag = m.confidence < 0.5 ? " ⚠ review" : "";
    return `  ${decl.padEnd(width)} /* ${m.role} ${Math.round(m.confidence * 100)}%${flag} */`;
  });
  return [
    "/* monkeystyle bridge: maps this site's tokens onto the active Monkeytype theme. */",
    `${selector} {`,
    "  color-scheme: var(--mt-scheme);",
    ...lines,
    "}",
    "",
  ].join("\n");
}
