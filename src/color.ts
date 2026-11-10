/**
 * Tiny, dependency-free color utilities: parsing, OKLab/OKLCH, WCAG contrast,
 * and gamut-safe OKLCH -> hex. Enough for theme derivation and CSS analysis.
 */

export interface RGBA {
  /** sRGB channels in 0..1 */
  r: number;
  g: number;
  b: number;
  /** alpha in 0..1 */
  a: number;
}

export interface OKLCH {
  /** lightness 0..1 */
  l: number;
  /** chroma, ~0..0.37 */
  c: number;
  /** hue in degrees 0..360 */
  h: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const NAMED: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  transparent: "#00000000",
};

/** Parse #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(), hsl()/hsla(), white/black/transparent. */
export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  if (s in NAMED) return parseColor(NAMED[s]!);

  if (s.startsWith("#")) {
    let hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      hex = [...hex].map((ch) => ch + ch).join("");
    }
    if (hex.length !== 6 && hex.length !== 8) return null;
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return { r: n(0), g: n(2), b: n(4), a: hex.length === 8 ? n(6) : 1 };
  }

  const fn = /^(rgba?|hsla?|oklch|oklab)\(([^)]*)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[2]!
    .replace(/\//g, " ")
    .split(/[\s,]+/)
    .filter(Boolean);
  if (parts.length < 3) return null;

  const alpha = (p: string | undefined) => {
    if (p === undefined) return 1;
    return p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p);
  };

  const kind = fn[1]!;
  if (kind.startsWith("rgb")) {
    const ch = (p: string) =>
      p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p) / 255;
    const [r, g, b] = parts.slice(0, 3).map(ch) as [number, number, number];
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: clamp01(alpha(parts[3])) };
  }

  if (kind === "oklch") {
    const l = parts[0]!.endsWith("%") ? parseFloat(parts[0]!) / 100 : parseFloat(parts[0]!);
    const c = parts[1]!.endsWith("%") ? (parseFloat(parts[1]!) / 100) * 0.4 : parseFloat(parts[1]!);
    const hRaw = parts[2]!;
    const h = hRaw === "none" ? 0 : hRaw.endsWith("turn") ? parseFloat(hRaw) * 360 : hRaw.endsWith("rad") ? (parseFloat(hRaw) * 180) / Math.PI : parseFloat(hRaw);
    if ([l, c, h].some(Number.isNaN)) return null;
    const rgb = oklchToRgb({ l, c, h: ((h % 360) + 360) % 360 });
    return { r: clamp01(rgb.r), g: clamp01(rgb.g), b: clamp01(rgb.b), a: clamp01(alpha(parts[3])) };
  }

  if (kind === "oklab") {
    const l = parts[0]!.endsWith("%") ? parseFloat(parts[0]!) / 100 : parseFloat(parts[0]!);
    const a = parts[1]!.endsWith("%") ? (parseFloat(parts[1]!) / 100) * 0.4 : parseFloat(parts[1]!);
    const b = parts[2]!.endsWith("%") ? (parseFloat(parts[2]!) / 100) * 0.4 : parseFloat(parts[2]!);
    if ([l, a, b].some(Number.isNaN)) return null;
    const c = Math.hypot(a, b);
    let h = (Math.atan2(b, a) * 180) / Math.PI;
    if (h < 0) h += 360;
    const rgb = oklchToRgb({ l, c, h });
    return { r: clamp01(rgb.r), g: clamp01(rgb.g), b: clamp01(rgb.b), a: clamp01(alpha(parts[3])) };
  }

  const h = parseFloat(parts[0]!);
  const sat = parseFloat(parts[1]!) / 100;
  const light = parseFloat(parts[2]!) / 100;
  if ([h, sat, light].some(Number.isNaN)) return null;
  const { r, g, b } = hslToRgb(h, sat, light);
  return { r, g, b, a: clamp01(alpha(parts[3])) };
}

function hslToRgb(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}

export function toHex({ r, g, b, a }: RGBA): string {
  const h = (n: number) =>
    Math.round(clamp01(n) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a) : ""}`;
}

const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const fromLinear = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

export function rgbToOklch({ r, g, b }: RGBA): OKLCH {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l_ = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m_ = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s_ = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const c = Math.hypot(A, B);
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { l: L, c, h: c < 1e-4 ? 0 : h };
}

/** OKLCH -> sRGB without clamping (channels may fall outside 0..1). */
function oklchToRgbRaw({ l, c, h }: OKLCH): RGBA {
  const hr = (h * Math.PI) / 180;
  const A = c * Math.cos(hr);
  const B = c * Math.sin(hr);
  const l_ = l + 0.3963377774 * A + 0.2158037573 * B;
  const m_ = l - 0.1055613458 * A - 0.0638541728 * B;
  const s_ = l - 0.0894841775 * A - 1.291485548 * B;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return {
    r: fromLinear(4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S),
    g: fromLinear(-1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S),
    b: fromLinear(-0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S),
    a: 1,
  };
}

const inGamut = ({ r, g, b }: RGBA) =>
  [r, g, b].every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** OKLCH -> sRGB, reducing chroma (binary search) until the color fits in sRGB. */
export function oklchToRgb(color: OKLCH): RGBA {
  const l = clamp01(color.l);
  let rgb = oklchToRgbRaw({ ...color, l });
  if (inGamut(rgb)) return rgb;
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const candidate = oklchToRgbRaw({ l, c: mid, h: color.h });
    if (inGamut(candidate)) {
      lo = mid;
      rgb = candidate;
    } else {
      hi = mid;
    }
  }
  return oklchToRgbRaw({ l, c: lo, h: color.h });
}

export const oklchToHex = (color: OKLCH) => toHex(oklchToRgb(color));

export function hexToOklch(hex: string): OKLCH {
  const rgb = parseColor(hex);
  if (!rgb) throw new Error(`Invalid color: ${hex}`);
  return rgbToOklch(rgb);
}

/** WCAG 2.x relative luminance. */
export function luminance({ r, g, b }: RGBA): number {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.x contrast ratio (1..21). Accepts parsed colors or CSS color strings. */
export function contrast(a: RGBA | string, b: RGBA | string): number {
  const ca = typeof a === "string" ? parseColor(a) : a;
  const cb = typeof b === "string" ? parseColor(b) : b;
  if (!ca || !cb) return 1;
  const la = luminance(ca);
  const lb = luminance(cb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** True when white text would be more legible than black text on this color. */
export function isDark(color: RGBA | string): boolean {
  return contrast(color, "#ffffff") > contrast(color, "#000000");
}

/** Perceptual distance in OKLab (deltaE OK). ~0.02 is barely noticeable. */
export function distance(a: OKLCH, b: OKLCH): number {
  const ar = (a.h * Math.PI) / 180;
  const br = (b.h * Math.PI) / 180;
  return Math.hypot(
    a.l - b.l,
    a.c * Math.cos(ar) - b.c * Math.cos(br),
    a.c * Math.sin(ar) - b.c * Math.sin(br),
  );
}

/** Smallest angle between two hues, in degrees (0..180). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Nudge a color's OKLCH lightness away from `bg` until it reaches `min`
 * contrast (or hits black/white). Hue and chroma are preserved where possible.
 */
export function ensureContrast(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color;
  const c = hexToOklch(color);
  const dir = isDark(bg) ? 1 : -1;
  for (let l = c.l; l >= 0 && l <= 1; l += dir * 0.01) {
    const hex = oklchToHex({ ...c, l });
    if (contrast(hex, bg) >= min) return hex;
  }
  return dir > 0 ? "#ffffff" : "#000000";
}
