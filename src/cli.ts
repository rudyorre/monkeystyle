#!/usr/bin/env node
/**
 * monkeystyle CLI: a thin wrapper over the library. Non-interactive and
 * deterministic, so it's equally usable by humans, CI and coding agents.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { generateBridge, ROLE_DESCRIPTIONS, roleExpression, type BridgeOptions, type Role } from "./bridge.ts";
import { getTheme, headScript, listThemes, themeCSS, UPSTREAM } from "./index.ts";

const HELP = `monkeystyle: Monkeytype themes for any website

Usage:
  monkeystyle bridge <css files...> [--out bridge.css] [--json] [--selector S] [--config F] [--no-comments]
      Scan your CSS custom properties, infer each one's role, and print a bridge
      rule mapping them onto the active Monkeytype theme.
  monkeystyle list [--scheme dark|light] [--json]
      List bundled themes.
  monkeystyle css <theme> [--selector S] [--monkeytype-names]
      Print a theme as a static CSS rule of --mt-* variables.
  monkeystyle head-script
      Print the inline <head> script that restores the saved theme without a flash.
  monkeystyle roles
      Describe every role the bridge can assign.

Config: ./monkeystyle.config.json is read automatically by "bridge" if present:
  { "selector": "html:root[data-mt]", "overrides": { "--glyph-ink": "fgMuted" }, "ignore": ["--shadow"] }
`;

function fail(msg: string): never {
  process.stderr.write(`monkeystyle: ${msg}\n`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o" },
    json: { type: "boolean" },
    selector: { type: "string" },
    config: { type: "string" },
    "no-comments": { type: "boolean" },
    scheme: { type: "string" },
    "monkeytype-names": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});

switch (command) {
  case "bridge": {
    if (!positionals.length) fail("bridge needs at least one CSS file");
    const configPath = values.config ?? "monkeystyle.config.json";
    let config: BridgeOptions = {};
    if (existsSync(configPath)) {
      config = JSON.parse(readFileSync(configPath, "utf8")) as BridgeOptions;
    } else if (values.config) {
      fail(`config not found: ${values.config}`);
    }
    const sources = positionals.map((file) => {
      if (!existsSync(file)) fail(`file not found: ${file}`);
      return readFileSync(file, "utf8");
    });
    const result = generateBridge(sources, {
      ...config,
      selector: values.selector ?? config.selector,
      comments: values["no-comments"] ? false : config.comments,
    });
    if (values.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else if (values.out) {
      writeFileSync(values.out, result.css);
      const review = result.mappings.filter((m) => m.confidence < 0.5);
      process.stderr.write(
        `wrote ${values.out}: ${result.mappings.length} mapped, ${result.skipped.length} skipped, ` +
          `${review.length} to review, ${result.hardcoded.length} hardcoded colors won't follow themes\n`,
      );
    } else {
      process.stdout.write(result.css);
    }
    break;
  }
  case "list": {
    const scheme = values.scheme as "dark" | "light" | undefined;
    if (scheme && scheme !== "dark" && scheme !== "light") fail("--scheme must be dark or light");
    const list = listThemes({ scheme });
    if (values.json) process.stdout.write(JSON.stringify(list, null, 2) + "\n");
    else process.stdout.write(list.map((t) => `${t.name.padEnd(28)} ${t.scheme.padEnd(5)} ${t.bg} ${t.main} ${t.text}`).join("\n") + "\n");
    break;
  }
  case "css": {
    const theme = positionals[0] && getTheme(positionals[0]);
    if (!theme) fail(`unknown theme "${positionals[0] ?? ""}". Try: monkeystyle list`);
    process.stdout.write(themeCSS(theme, values.selector ?? ":root", { monkeytypeNames: values["monkeytype-names"] }));
    break;
  }
  case "head-script":
    process.stdout.write(`<script>${headScript()}</script>\n`);
    break;
  case "roles":
    process.stdout.write(
      (Object.entries(ROLE_DESCRIPTIONS) as [Role, string][])
        .map(([r, d]) => `${r.padEnd(13)} ${d.padEnd(44)} ${roleExpression(r)}`)
        .join("\n") + "\n",
    );
    break;
  case "version":
  case "--version":
    process.stdout.write(`themes from ${UPSTREAM.repo}@${UPSTREAM.sha.slice(0, 7)} (${UPSTREAM.importedAt})\n`);
    break;
  default:
    process.stdout.write(HELP);
    if (command && command !== "help" && command !== "--help" && command !== "-h") process.exit(1);
}
