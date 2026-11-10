import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, isDark, parseColor } from "../src/color.ts";
import { deriveAccents } from "../src/derive.ts";
import { getTheme, headScript, listThemes, themeCSS, themeVars, PALETTE_KEYS } from "../src/index.ts";

const all = listThemes();

test("bundles the full Monkeytype snapshot with valid palettes", () => {
  assert.ok(all.length >= 180, `expected ~187 themes, got ${all.length}`);
  for (const t of all) {
    for (const k of PALETTE_KEYS) assert.ok(parseColor(t[k]), `${t.name}.${k} = ${t[k]}`);
    assert.equal(t.scheme, isDark(t.bg) ? "dark" : "light", t.name);
  }
});

test("lookup and filtering", () => {
  assert.equal(getTheme("serika_dark")?.main, "#e2b714");
  assert.equal(getTheme("nope"), undefined);
  assert.ok(listThemes({ scheme: "light" }).every((t) => t.scheme === "light"));
  assert.ok(listThemes({ query: "serika" }).some((t) => t.name === "serika_dark"));
});

test("harvested extras survive for themes with custom stylesheets", () => {
  const dracula = getTheme("dracula")!;
  assert.ok(dracula.extras.includes("#50fa7b"), "dracula green");
  assert.ok(dracula.extras.includes("#8be9fd"), "dracula cyan");
});

test("every theme gets 8 distinct accents with >= 3:1 contrast", () => {
  for (const t of all) {
    const accents = deriveAccents(t, t.extras);
    assert.equal(accents.length, 8, t.name);
    assert.equal(new Set(accents).size, 8, `${t.name}: ${accents.join(" ")}`);
    for (const a of accents) {
      assert.ok(contrast(a, t.bg) >= 2.95, `${t.name}: ${a} on ${t.bg} = ${contrast(a, t.bg).toFixed(2)}`);
    }
  }
});

test("accents prefer colors the theme author chose", () => {
  const dracula = getTheme("dracula")!;
  const accents = deriveAccents(dracula, dracula.extras);
  assert.deepEqual(accents.slice(0, 2), ["#ec75c4", "#8be9fd"]);
});

test("themeVars / themeCSS emit the documented variables", () => {
  const vars = themeVars(getTheme("serika_dark")!, { monkeytypeNames: true });
  assert.equal(vars["--mt-bg"], "#323437");
  assert.equal(vars["--main-color"], "#e2b714");
  assert.equal(vars["--mt-scheme"], "dark");
  assert.equal(vars["--mt-on-main"], "#323437");
  assert.equal(themeVars(getTheme("serika")!)["--mt-on-main"], getTheme("serika")!.text);
  assert.ok(vars["--mt-accent-8"]);
  assert.match(themeCSS(getTheme("serika_dark")!, ".x"), /^\.x \{\n {2}--mt-bg: #323437;/);
});

test("custom palettes work too", () => {
  const vars = themeVars({ ...getTheme("serika_dark")!, bg: "#ffffff", scheme: undefined } as never);
  assert.equal(vars["--mt-bg"], "#ffffff");
});

test("head script is self-contained", () => {
  const src = headScript({ storageKey: "k", attribute: "data-x" });
  assert.match(src, /localStorage\.getItem\("k"\)/);
  assert.match(src, /setAttribute\("data-x"/);
  assert.ok(src.length < 400);
});
