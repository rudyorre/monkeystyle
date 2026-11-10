import { test } from "node:test";
import assert from "node:assert/strict";
import { contrast, hexToOklch, oklchToHex, parseColor, toHex, ensureContrast } from "../src/color.ts";

test("parses hex, rgb, hsl and named colors", () => {
  assert.equal(toHex(parseColor("#abc")!), "#aabbcc");
  assert.equal(toHex(parseColor("#11223380")!), "#11223380");
  assert.equal(toHex(parseColor("rgb(255, 0, 0)")!), "#ff0000");
  assert.equal(toHex(parseColor("rgba(0 0 0 / 50%)")!), "#00000080");
  assert.equal(toHex(parseColor("hsl(120, 100%, 50%)")!), "#00ff00");
  assert.equal(toHex(parseColor("white")!), "#ffffff");
  assert.equal(parseColor("var(--x)"), null);
  assert.equal(parseColor("Inter, sans-serif"), null);
});

test("WCAG contrast matches known values", () => {
  assert.equal(Math.round(contrast("#000", "#fff")), 21);
  assert.equal(contrast("#777", "#777"), 1);
});

test("OKLCH round-trips sRGB colors", () => {
  for (const hex of ["#e2b714", "#323437", "#ff5555", "#8be9fd", "#ffffff", "#000000"]) {
    assert.equal(oklchToHex(hexToOklch(hex)), hex);
  }
});

test("ensureContrast nudges lightness until the ratio is met", () => {
  const fixed = ensureContrast("#444444", "#323437", 3);
  assert.ok(contrast(fixed, "#323437") >= 3);
  assert.equal(ensureContrast("#ffffff", "#000000", 4.5), "#ffffff");
});
