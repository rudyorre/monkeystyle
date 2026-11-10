import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateBridge, scanCSS, type Role } from "../src/bridge.ts";
import { harvestExtras, parseThemesSource } from "../scripts/import-themes.ts";

const css = readFileSync(new URL("./fixtures/site.css", import.meta.url), "utf8");

test("scanner prefers :root values and tracks usage", () => {
  const { properties, hardcoded } = scanCSS(css);
  const bg = properties.find((p) => p.name === "--bg")!;
  assert.equal(bg.value, "#fafafa");
  assert.equal(bg.definedIn.length, 2);
  assert.deepEqual(bg.usedBy, ["background"]);
  assert.deepEqual(hardcoded.map((h) => h.property), ["box-shadow"]);
});

test("infers roles for a typical token set", () => {
  const { mappings, skipped } = generateBridge(css);
  const role = (name: string) => mappings.find((m) => m.name === name)?.role;
  const expected: Record<string, Role> = {
    "--bg": "bg",
    "--bg-elevated": "surface",
    "--bg-subtle": "surfaceAlt",
    "--fg": "fg",
    "--fg-muted": "fgMuted",
    "--fg-faint": "fgFaint",
    "--border": "border",
    "--border-strong": "borderStrong",
    "--accent": "accent",
    "--selection-bg": "selection",
    "--backdrop": "backdrop",
    "--glyph-bg": "surface",
    "--glyph-grid": "border",
    "--glyph-accent-1": "categorical",
    "--glyph-accent-4": "categorical",
  };
  for (const [name, r] of Object.entries(expected)) assert.equal(role(name), r, name);
  assert.ok(skipped.some((s) => s.name === "--font-sans" && s.reason === "not a color"));
  assert.ok(skipped.some((s) => s.name === "--font-body" && s.reason.startsWith("alias")));
});

test("categorical members map to the matching accent slot", () => {
  const { mappings } = generateBridge(css);
  assert.equal(mappings.find((m) => m.name === "--glyph-accent-3")?.expression, "var(--mt-accent-3)");
});

test("renders a bridge rule with configurable selector and overrides", () => {
  const { css: out, mappings } = generateBridge(css, {
    selector: ":root.themed",
    overrides: { "--glyph-ink": "fgMuted", "--accent": { expression: "var(--mt-caret)" } },
    ignore: ["--backdrop"],
    comments: false,
  });
  assert.match(out, /^\/\*.*\*\/\n:root\.themed \{\n {2}color-scheme: var\(--mt-scheme\);/);
  assert.match(out, / {2}--glyph-ink: var\(--mt-sub\);/);
  assert.match(out, / {2}--accent: var\(--mt-caret\);/);
  assert.ok(!out.includes("--backdrop"));
  assert.ok(mappings.find((m) => m.name === "--glyph-ink")?.overridden);
});

test("handles dark-first sites and naming variety", () => {
  const { mappings } = generateBridge(`
    :root {
      --color-background: #0b0d10;
      --color-surface: #14171c;
      --text-primary: #e6e8eb;
      --text-secondary: #9aa3ad;
      --color-primary: #3b82f6;
      --color-danger: #ef4444;
      --divider: #232830;
      --chart-1: #22c55e; --chart-2: #eab308; --chart-3: #a855f7;
    }`);
  const role = (name: string) => mappings.find((m) => m.name === name)?.role;
  assert.equal(role("--color-background"), "bg");
  assert.equal(role("--color-surface"), "surface");
  assert.equal(role("--text-primary"), "fg");
  assert.equal(role("--text-secondary"), "fgMuted");
  assert.equal(role("--color-primary"), "accent");
  assert.equal(role("--color-danger"), "danger");
  assert.equal(role("--divider"), "border");
  assert.equal(role("--chart-2"), "categorical");
});

test("importer parses upstream's themes.ts shape", () => {
  const src = `export const themes: Record<ThemeName, Theme> = {
  "8008": {
    bg: "#333a45", caret: "#f44c7f", main: "#f44c7f", sub: "#939eae", subAlt: "#2e343d",
    text: "#e9ecf0", error: "#da3333", errorExtra: "#791717", colorfulError: "#c5da33", colorfulErrorExtra: "#849224",
  },
  dracula: {
    bg: "#282a36", main: "#bd93f9", caret: "#bd93f9", sub: "#6272a4", subAlt: "#20222c", text: "#f8f8f2",
    error: "#ff5555", errorExtra: "#f1fa8c", colorfulError: "#ff5555", colorfulErrorExtra: "#f1fa8c",
    hasCss: true,
  },
};`;
  const parsed = parseThemesSource(src);
  assert.deepEqual(Object.keys(parsed), ["8008", "dracula"]);
  assert.equal(parsed.dracula!.hasCss, true);
  assert.equal(parsed["8008"]!.hasCss, false);

  const extras = harvestExtras(
    `[data-nav-item="a"]{color:#ec75c4} [data-nav-item="b"]{color:#8be9fd} .x{color:color-mix(in srgb,#ec75c4 75%,black 25%)} .y{color:#bd93f9;background:#282a36}`,
    parsed.dracula!,
  );
  assert.deepEqual(extras, ["#ec75c4", "#8be9fd"]);
});

test("modifiers beat base words, and sunken surfaces count as surfaces", () => {
  const { mappings } = generateBridge(`:root { --bg: #323437; --surface: #2f3134; --surface-alt: #2c2e31; --text: #d1d0c5; }`);
  const role = (name: string) => mappings.find((m) => m.name === name)?.role;
  assert.equal(role("--surface"), "surface");
  assert.equal(role("--surface-alt"), "surfaceAlt");
});
