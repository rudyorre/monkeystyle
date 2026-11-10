/**
 * Derivations that go beyond the 10 upstream colors: an 8-color categorical
 * accent ramp (for charts, tags, syntax-ish UI) that stays on-palette and
 * legible against the theme background.
 */
import {
  contrast,
  ensureContrast,
  hexToOklch,
  hueDistance,
  distance,
  oklchToHex,
  type OKLCH,
} from "./color.ts";
import type { Palette } from "./types.ts";

export const ACCENT_COUNT = 8;
const MIN_ACCENT_CONTRAST = 3;

/**
 * Build `count` distinct accents for a theme.
 *
 * 1. Seed with colors the theme author actually chose: harvested `extras`,
 *    then `main`, `caret`, `colorfulError`, `error`, `colorfulErrorExtra`.
 * 2. Drop greys and near-duplicates.
 * 3. Fill remaining slots with new hues placed in the widest hue gaps, using
 *    the seeds' average lightness/chroma so they feel native to the theme.
 * 4. Nudge every accent to >= 3:1 contrast against `bg`.
 */
export function deriveAccents(
  palette: Palette,
  extras: readonly string[] = [],
  count = ACCENT_COUNT,
): string[] {
  const seeds = [
    ...extras,
    palette.main,
    palette.caret,
    palette.colorfulError,
    palette.error,
    palette.colorfulErrorExtra,
  ];

  const picked: OKLCH[] = [];
  for (const hex of seeds) {
    const c = hexToOklch(ensureContrast(hex, palette.bg, MIN_ACCENT_CONTRAST));
    if (c.c < 0.045) continue;
    if (picked.some((p) => distance(p, c) < 0.07 || (hueDistance(p.h, c.h) < 18 && Math.abs(p.l - c.l) < 0.12))) continue;
    picked.push(c);
    if (picked.length >= count) break;
  }

  const darkBg = contrast(palette.bg, "#ffffff") > contrast(palette.bg, "#000000");
  const avg = (xs: number[], fallback: number) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : fallback;
  const targetL = avg(picked.map((p) => p.l), darkBg ? 0.76 : 0.56);
  const targetC = Math.min(0.16, Math.max(0.08, avg(picked.map((p) => p.c), 0.11)));

  while (picked.length < count) {
    let bestHue = picked.length ? (picked[0]!.h + 180) % 360 : 25;
    let bestGap = -1;
    for (let h = 0; h < 360; h += 3) {
      const gap = picked.length ? Math.min(...picked.map((p) => hueDistance(p.h, h))) : 360;
      if (gap > bestGap) {
        bestGap = gap;
        bestHue = h;
      }
    }
    const hex = ensureContrast(
      oklchToHex({ l: targetL, c: targetC, h: bestHue }),
      palette.bg,
      MIN_ACCENT_CONTRAST,
    );
    picked.push(hexToOklch(hex));
  }

  return picked.slice(0, count).map((c) => oklchToHex(c));
}
