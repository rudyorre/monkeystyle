/**
 * The 10 semantic colors every Monkeytype theme defines.
 * Field names match monkeytype's `frontend/src/ts/constants/themes.ts`.
 */
export interface Palette {
  /** Page background. */
  bg: string;
  /** Primary accent (logo, active states, links). */
  main: string;
  /** Typing caret / focus indicator. */
  caret: string;
  /** Secondary text (untyped words, labels). */
  sub: string;
  /** Secondary background (inputs, cards, key caps). */
  subAlt: string;
  /** Primary text. */
  text: string;
  /** Error color. */
  error: string;
  /** Darker / extra error color. */
  errorExtra: string;
  /** Error color used in "colorful" mode. */
  colorfulError: string;
  /** Extra error color used in "colorful" mode. */
  colorfulErrorExtra: string;
}

export type PaletteKey = keyof Palette;

export type Scheme = "light" | "dark";

/** A bundled theme record (palette + metadata computed at import time). */
export interface ThemeRecord extends Palette {
  /** Whether the background is light or dark. Drives `color-scheme`. */
  scheme: Scheme;
  /**
   * Extra accent colors harvested from the theme's custom upstream stylesheet
   * (only for themes that ship one). Ordered by how often they appear.
   */
  extras: string[];
  /** True if upstream ships a custom stylesheet for this theme. */
  hasCss: boolean;
}

export interface Theme extends ThemeRecord {
  name: string;
}

export const PALETTE_KEYS: readonly PaletteKey[] = [
  "bg",
  "main",
  "caret",
  "sub",
  "subAlt",
  "text",
  "error",
  "errorExtra",
  "colorfulError",
  "colorfulErrorExtra",
];
