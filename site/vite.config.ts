import { defineConfig, type Plugin } from "vite";
import { fileURLToPath } from "node:url";
import { headScript } from "../src/index.ts";

/** Inline monkeystyle's no-flash head script (dogfooding `headScript()`). */
function monkeystyleHead(): Plugin {
  return {
    name: "monkeystyle-head",
    transformIndexHtml(html) {
      return html.replace("<!--monkeystyle:head-->", `<script>${headScript()}</script>`);
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/",
  plugins: [monkeystyleHead()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
  },
});
