import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyTheme,
  CHANGE_EVENT,
  clearTheme,
  getActiveTheme,
  getSavedTheme,
  VERSION,
} from "../src/index.ts";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as { version: string };

test("VERSION matches package.json version", () => {
  assert.equal(VERSION, pkg.version);
});

test("SSR safety: getActiveTheme and getSavedTheme return null without DOM/localStorage", () => {
  assert.equal(getActiveTheme(), null);
  assert.equal(getSavedTheme(), null);
});

test("DOM lifecycle: applyTheme sets vars, attribute, storage, event; clearTheme resets all", () => {
  const store = new Map<string, string>();
  const prevStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
  });

  try {
    const props = new Map<string, string>();
    const attrs = new Map<string, string>();
    const events: unknown[] = [];
    const fakeRoot = {
      style: {
        colorScheme: "",
        get length() {
          return props.size;
        },
        item: (i: number) => [...props.keys()][i] ?? "",
        setProperty: (k: string, v: string) => props.set(k, v),
        removeProperty: (k: string) => props.delete(k),
      },
      setAttribute: (k: string, v: string) => attrs.set(k, v),
      getAttribute: (k: string) => attrs.get(k) ?? null,
      removeAttribute: (k: string) => attrs.delete(k),
      dispatchEvent: (ev: CustomEvent) => {
        events.push({ type: ev.type, detail: ev.detail });
        return true;
      },
    } as unknown as HTMLElement;

    const applied = applyTheme("dracula", { root: fakeRoot });
    assert.equal(applied.name, "dracula");
    assert.equal(attrs.get("data-mt"), "dracula");
    assert.equal(fakeRoot.style.colorScheme, "dark");
    assert.equal(props.get("--mt-bg"), "#282a36");
    assert.equal(props.get("--mt-main"), "#bd93f9");
    assert.equal(getActiveTheme({ root: fakeRoot }), "dracula");
    assert.equal(getSavedTheme(), "dracula");
    assert.equal(events.length, 1);
    assert.equal((events[0] as { type: string }).type, CHANGE_EVENT);

    clearTheme({ root: fakeRoot });
    assert.equal(attrs.has("data-mt"), false);
    assert.equal(props.size, 0);
    assert.equal(getActiveTheme({ root: fakeRoot }), null);
    assert.equal(getSavedTheme(), null);
    assert.equal((events[1] as { detail: unknown }).detail, null);

    assert.throws(() => applyTheme("not_a_real_theme", { root: fakeRoot }), /unknown theme/);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: prevStorage });
  }
});

test("CLI commands: --version, -v, --help, list --json, css, head-script, roles, bridge", () => {
  const cli = join(rootDir, "src/cli.ts");
  const run = (...args: string[]) =>
    execFileSync(process.execPath, [cli, ...args], { cwd: rootDir, encoding: "utf8" });

  assert.match(run("--version"), new RegExp(`^monkeystyle v${VERSION}`));
  assert.match(run("-v"), new RegExp(`^monkeystyle v${VERSION}`));
  assert.match(run("--help"), /Usage:\n  monkeystyle bridge/);

  const listJson = JSON.parse(run("list", "--scheme", "light", "--json")) as { name: string; scheme: string }[];
  assert.ok(listJson.length > 20);
  assert.ok(listJson.every((t) => t.scheme === "light"));

  assert.match(run("css", "serika_dark", "--selector", ".demo"), /^\.demo \{\n  --mt-bg: #323437;/);
  assert.match(run("head-script"), /^<script>\(function\(\)\{/);
  assert.match(run("roles"), /surface\s+raised surface.*color-mix/);

  const bridgeJson = JSON.parse(run("bridge", "test/fixtures/site.css", "--json")) as {
    mappings: { name: string; role: string }[];
  };
  assert.equal(bridgeJson.mappings.find((m) => m.name === "--bg")?.role, "bg");
});

test("npm pack tarball installs cleanly and resolves all subpath exports + CLI", () => {
  execFileSync("npm", ["run", "build"], { cwd: rootDir, stdio: "ignore" });
  const tmp = mkdtempSync(join(tmpdir(), "monkeystyle-pack-"));
  try {
    const packOut = execFileSync("npm", ["pack", "--pack-destination", tmp], {
      cwd: rootDir,
      encoding: "utf8",
    }).trim();
    const tgz = join(tmp, packOut.split("\n").pop()!.trim());

    execFileSync("npm", ["init", "-y"], { cwd: tmp, stdio: "ignore" });
    execFileSync("npm", ["install", "--no-save", "--no-audit", "--no-fund", tgz], {
      cwd: tmp,
      stdio: "ignore",
    });

    // Verify all 4 subpath exports resolve from an external consumer
    const verifyScript = `
      import { getTheme, VERSION } from "monkeystyle";
      import { generateBridge } from "monkeystyle/bridge";
      import { contrast } from "monkeystyle/color";
      import { themes, UPSTREAM } from "monkeystyle/themes";
      if (VERSION !== "${VERSION}") throw new Error("version mismatch");
      if (getTheme("serika_dark")?.main !== "#e2b714") throw new Error("getTheme failed");
      if (generateBridge(":root { --bg: #fff; }").mappings[0]?.role !== "bg") throw new Error("bridge failed");
      if (Math.round(contrast("#000", "#fff")) !== 21) throw new Error("color failed");
      if (!themes.dracula || !UPSTREAM.sha) throw new Error("themes failed");
    `;
    execFileSync(process.execPath, ["--input-type=module", "-e", verifyScript], { cwd: tmp });

    // Verify the installed bin executable runs directly (shebang + executable bit)
    const binPath = join(tmp, "node_modules", ".bin", "monkeystyle");
    const binOut = execFileSync(binPath, ["-v"], { cwd: tmp, encoding: "utf8" });
    assert.match(binOut, new RegExp(`^monkeystyle v${VERSION}`));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
