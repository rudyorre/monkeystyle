import "./style.css";
import sampleCSS from "../test/fixtures/site.css?raw";
import {
  applyTheme,
  CHANGE_EVENT,
  getActiveTheme,
  getSavedTheme,
  getTheme,
  headScript,
  listThemes,
  PALETTE_KEYS,
  randomTheme,
  themeVars,
  UPSTREAM,
  VAR_NAMES,
  VERSION,
  type Theme,
} from "../src/index.ts";
import { generateBridge, ROLE_DESCRIPTIONS, roleExpression, ROLES } from "../src/bridge.ts";
import { parseColor } from "../src/color.ts";

const DEFAULT_THEME = "serika_dark";
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const pretty = (name: string) => name.replace(/_/g, " ");
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/* ------------------------------------------------------------------ state */
let committed: string = getActiveTheme() ?? getSavedTheme() ?? DEFAULT_THEME;
// Re-apply on load so derived vars stay in sync with the current library version.
applyTheme(committed, { storageKey: getSavedTheme() ? undefined : false });

const preview = (name: string) => applyTheme(name, { storageKey: false });
const commit = (name: string) => {
  committed = name;
  applyTheme(name);
};

/* ------------------------------------------------------- theme-dependent UI */
function renderForTheme(theme: Theme) {
  $("#theme-chip-name").textContent = pretty(theme.name);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.bg);

  const vars = themeVars(theme);
  $("#palette").innerHTML = PALETTE_KEYS.map(
    (k) => `<div class="swatch" title="${VAR_NAMES[k]}">
      <div class="swatch__color" style="background:${theme[k]}"></div>
      <div class="swatch__meta"><span class="swatch__name">${k}</span><span class="swatch__hex">${theme[k]}</span></div>
    </div>`,
  ).join("");

  const accents = Array.from({ length: 8 }, (_, i) => vars[`--mt-accent-${i + 1}`]!);
  $("#accents").innerHTML =
    `<span class="accents__label">accents</span>` +
    accents.map((c, i) => `<span class="accents__dot" style="background:${c}" title="--mt-accent-${i + 1}: ${c}"></span>`).join("");

  $("#vars-table").innerHTML = [
    ...PALETTE_KEYS.map((k) => [VAR_NAMES[k], theme[k]] as const),
    ...accents.map((c, i) => [`--mt-accent-${i + 1}`, c] as const),
    ["--mt-on-main", vars["--mt-on-main"]!] as const,
    ["--mt-scheme", theme.scheme] as const,
  ]
    .map(([name, value]) => {
      const swatch = name === "--mt-scheme" ? "" : `<i style="background:${value}"></i>`;
      return `<div class="var-row">${swatch}<code>${name}</code><span>${value}</span></div>`;
    })
    .join("");

  for (const card of document.querySelectorAll<HTMLElement>(".tcard")) {
    card.classList.toggle("is-active", card.dataset.theme === theme.name);
  }
}

document.addEventListener(CHANGE_EVENT, (e) => {
  const theme = (e as CustomEvent<Theme | null>).detail;
  if (theme) renderForTheme(theme);
});

/* ------------------------------------------------------------- typing demo */
function typingDemo() {
  const el = $("#typing");
  const text = "monkeystyle maps your css tokens onto every monkeytype theme";
  el.innerHTML = [...text].map((ch) => `<span class="c">${ch === " " ? " " : esc(ch)}</span>`).join("");
  const chars = [...el.querySelectorAll<HTMLElement>(".c")];
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.setAttribute("aria-hidden", "true");

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    chars.forEach((c) => c.classList.add("ok"));
    el.append(caret);
    return;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const run = async () => {
    for (;;) {
      chars.forEach((c) => c.classList.remove("ok", "err"));
      chars[0]!.before(caret);
      await sleep(1200);
      el.classList.add("is-typing");
      const typos = new Set([8 + Math.floor(Math.random() * 12), 30 + Math.floor(Math.random() * 20)]);
      for (let i = 0; i < chars.length; i++) {
        const c = chars[i]!;
        if (typos.has(i) && text[i] !== " ") {
          c.classList.add("err");
          (chars[i + 1] ?? c).after(caret);
          await sleep(320);
          c.classList.remove("err");
        }
        c.classList.add("ok");
        c.after(caret);
        await sleep(text[i] === " " ? 90 + Math.random() * 60 : 38 + Math.random() * 70);
      }
      el.classList.remove("is-typing");
      await sleep(4200);
    }
  };
  void run();
}

/* ------------------------------------------------------------ code blocks */
const TOKEN = new RegExp(
  [
    String.raw`(?<c>\/\*[\s\S]*?\*\/|\/\/[^\n]*|<!--[\s\S]*?-->)`,
    String.raw`(?<s>"[^"\n]*"|'[^'\n]*'|\x60[^\x60]*\x60)`,
    String.raw`(?<v>--[\w-]+)`,
    String.raw`(?<k>\b(?:import|from|const|let|for|of|export|function|return|new|await|npm|npx|monkeystyle)\b)`,
    String.raw`(?<n>#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?%?)`,
    String.raw`(?<p>[{}()[\];,=>]+)`,
  ].join("|"),
  "g",
);

function highlight(code: string): string {
  let out = "";
  let last = 0;
  for (const m of code.matchAll(TOKEN)) {
    out += esc(code.slice(last, m.index));
    const kind = Object.entries(m.groups!).find(([, v]) => v !== undefined)![0];
    out += `<span class="tok-${kind}">${esc(m[0])}</span>`;
    last = m.index! + m[0].length;
  }
  return out + esc(code.slice(last));
}

async function copy(text: string, btn: HTMLElement, label = "copy") {
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add("is-copied");
    const target = btn.querySelector(".install__copy") ?? btn;
    target.textContent = "copied";
    setTimeout(() => {
      btn.classList.remove("is-copied");
      target.textContent = label;
    }, 1400);
  } catch {
    /* clipboard blocked: leave text selectable */
  }
}

function initCode() {
  $("#head-script-code").textContent = `<script>${headScript()}</script>`;
  for (const pre of document.querySelectorAll<HTMLPreElement>("pre.code:not(.code--output)")) {
    const code = pre.querySelector("code")!;
    const raw = code.textContent ?? "";
    code.innerHTML = highlight(raw);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "copy-btn";
    btn.textContent = "copy";
    btn.addEventListener("click", () => copy(raw, btn));
    pre.append(btn);
  }
  const install = $("#install");
  install.addEventListener("click", () => copy(install.dataset.copy!, install));
}

/* ----------------------------------------------------------------- bridge */
function initBridge() {
  const input = $<HTMLTextAreaElement>("#bridge-input");
  const output = $("#bridge-output");
  const rows = $("#bridge-rows");
  const notes = $("#bridge-notes");
  const previewStyle = $("#bridge-preview-style");
  let latest = "";

  input.value = sampleCSS.trim() + "\n";

  const run = () => {
    const result = generateBridge(input.value, { comments: false });
    latest = result.css;
    output.innerHTML = highlight(result.css);

    // Preview swatches resolve through a namespaced copy of the bridge so pasted
    // names can't clash with this page's own tokens.
    const safe = result.mappings.filter((m) => /^--[\w-]+$/.test(m.name));
    previewStyle.textContent = `#bridge-preview{${safe.map((m) => `--u${m.name}:${m.expression};`).join("")}}`;

    rows.innerHTML = safe.length
      ? safe
          .map((m) => {
            const orig = parseColor(m.value) ? m.value : "transparent";
            const pct = Math.round(m.confidence * 100);
            return `<tr>
              <td><code>${esc(m.name)}</code></td>
              <td><span class="pair"><i style="--c:${esc(orig)}" title="${esc(m.value)}"></i>→<i style="--c:var(--u${m.name})"></i></span></td>
              <td><span class="role" title="${esc(ROLE_DESCRIPTIONS[m.role])}">${m.role}</span></td>
              <td><span class="conf${m.confidence < 0.5 ? " is-low" : ""}"><span class="conf__bar"><span style="width:${pct}%"></span></span>${pct}%</span></td>
              <td class="mapping__why">${esc(m.reason)}</td>
            </tr>`;
          })
          .join("")
      : `<tr><td colspan="5" class="mapping__why">No color custom properties found. Paste a <code>:root { --bg: … }</code> block.</td></tr>`;

    const bits: string[] = [];
    if (result.skipped.length) {
      bits.push(`${result.skipped.length} skipped (${[...new Set(result.skipped.map((s) => s.reason.split(" (")[0]))].join(", ")})`);
    }
    if (result.hardcoded.length) {
      const ex = result.hardcoded[0]!;
      bits.push(
        `${result.hardcoded.length} hardcoded color${result.hardcoded.length > 1 ? "s" : ""} won't follow themes, e.g. <code>${esc(ex.selector)} { ${esc(ex.property)} }</code>`,
      );
    }
    const review = result.mappings.filter((m) => m.confidence < 0.5).length;
    if (review) bits.push(`${review} low-confidence mapping${review > 1 ? "s" : ""}: pin them with <code>overrides</code>`);
    notes.innerHTML = bits.join(" · ");
  };

  let t: number | undefined;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = window.setTimeout(run, 120);
  });
  const copyBtn = $("#copy-bridge");
  copyBtn.addEventListener("click", () => copy(latest, copyBtn));
  run();

  $("#roles-table").innerHTML = ROLES.map(
    (r) => `<div class="var-row"><code>${r}</code><span>${ROLE_DESCRIPTIONS[r]}</span></div>`,
  ).join("");
}

/* ---------------------------------------------------------------- gallery */
function dots(t: Theme) {
  return `<i style="background:${t.main}"></i><i style="background:${t.sub}"></i><i style="background:${t.text}"></i>`;
}

function initGallery() {
  const gallery = $("#gallery");
  const search = $<HTMLInputElement>("#gallery-search");
  const count = $("#gallery-count");
  const all = listThemes();
  let scheme = "";

  gallery.innerHTML =
    all
      .map(
        (t) => `<button type="button" class="tcard" data-theme="${t.name}" data-scheme="${t.scheme}"
          style="--c-bg:${t.bg};--c-main:${t.main};--c-sub:${t.sub};--c-text:${t.text}" title="${pretty(t.name)}">
          <span class="tcard__name">${pretty(t.name)}</span><span class="tcard__dots">${dots(t)}</span>
        </button>`,
      )
      .join("") + `<p class="gallery-empty" hidden>No themes match.</p>`;

  const filter = () => {
    const q = search.value.trim().toLowerCase().replace(/\s+/g, "_");
    let shown = 0;
    for (const card of gallery.querySelectorAll<HTMLElement>(".tcard")) {
      const ok = (!scheme || card.dataset.scheme === scheme) && (!q || card.dataset.theme!.includes(q));
      card.hidden = !ok;
      if (ok) shown++;
    }
    gallery.querySelector<HTMLElement>(".gallery-empty")!.hidden = shown > 0;
    count.textContent = `${shown} / ${all.length}`;
  };

  gallery.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".tcard");
    if (card) commit(card.dataset.theme!);
  });
  search.addEventListener("input", filter);
  for (const btn of document.querySelectorAll<HTMLButtonElement>(".segmented button")) {
    btn.addEventListener("click", () => {
      scheme = btn.dataset.scheme!;
      for (const b of document.querySelectorAll(".segmented button")) b.setAttribute("aria-checked", String(b === btn));
      filter();
    });
  }
  filter();
}

/* -------------------------------------------------------- command palette */
function initPalette() {
  const dialog = $<HTMLDialogElement>("#palette-dialog");
  const input = $<HTMLInputElement>("#cmd-input");
  const list = $("#cmd-list");
  const all = listThemes();
  let items: Theme[] = [];
  let index = 0;
  let previewTimer: number | undefined;

  const render = () => {
    const q = input.value.trim().toLowerCase().replace(/\s+/g, "_");
    items = all.filter((t) => !q || t.name.includes(q));
    index = Math.min(index, Math.max(0, items.length - 1));
    list.innerHTML = items.length
      ? items
          .map(
            (t, i) => `<li class="cmd__item${t.name === committed ? " is-current" : ""}" role="option" id="cmd-${t.name}"
              data-i="${i}" aria-selected="${i === index}">
              <span class="cmd__item-name">${pretty(t.name)}</span>
              <span class="cmd__item-dots" style="background:${t.bg}">${dots(t)}</span></li>`,
          )
          .join("")
      : `<li class="cmd__item">no matches</li>`;
    input.setAttribute("aria-activedescendant", items[index] ? `cmd-${items[index]!.name}` : "");
  };

  const select = (i: number, scroll = true) => {
    if (!items.length) return;
    index = (i + items.length) % items.length;
    for (const li of list.querySelectorAll<HTMLElement>(".cmd__item")) {
      li.setAttribute("aria-selected", String(Number(li.dataset.i) === index));
    }
    const active = list.querySelector<HTMLElement>(`[data-i="${index}"]`);
    if (scroll) active?.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", active?.id ?? "");
    clearTimeout(previewTimer);
    previewTimer = window.setTimeout(() => preview(items[index]!.name), 40);
  };

  const open = () => {
    if (dialog.open) return;
    input.value = "";
    index = Math.max(0, all.findIndex((t) => t.name === committed));
    render();
    dialog.showModal();
    input.focus();
    list.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: "center" });
  };
  const close = (apply: boolean) => {
    clearTimeout(previewTimer);
    if (apply && items[index]) commit(items[index]!.name);
    else preview(committed);
    dialog.close();
  };

  input.addEventListener("input", () => {
    index = 0;
    render();
    if (items[0]) select(0);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      select(index + 1);
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      select(index - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      close(true);
    }
  });
  list.addEventListener("mousemove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li && Number(li.dataset.i) !== index) select(Number(li.dataset.i), false);
  });
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li) {
      index = Number(li.dataset.i);
      close(true);
    }
  });
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close(false);
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close(false);
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (dialog.open) close(false);
      else open();
    }
  });
  $("#theme-chip").addEventListener("click", open);
  $("#open-palette").addEventListener("click", open);
  $("#random-theme").addEventListener("click", () => {
    let t = randomTheme();
    while (t.name === committed) t = randomTheme();
    commit(t.name);
  });
}

/* ------------------------------------------------------------------ chrome */
function initChrome() {
  const topbar = $(".topbar");
  const onScroll = () => topbar.classList.toggle("is-scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const links = new Map(
    [...document.querySelectorAll<HTMLAnchorElement>(".nav a")].map((a) => [a.hash.slice(1), a] as const),
  );
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          for (const [id, a] of links) a.classList.toggle("is-active", id === entry.target.id);
        }
      }
    },
    { rootMargin: "-40% 0px -55% 0px" },
  );
  for (const id of links.keys()) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }

  const vChip = $<HTMLAnchorElement>("#version-chip");
  vChip.textContent = `v${VERSION}`;
  vChip.href = `https://github.com/rudyorre/monkeystyle/releases/tag/v${VERSION}`;

  $("#theme-count").textContent = String(listThemes().length);
  $<HTMLAnchorElement>("#upstream-link").href = `https://github.com/${UPSTREAM.repo}/tree/${UPSTREAM.sha}`;
  $("#upstream-link").textContent = `monkeytype@${UPSTREAM.sha.slice(0, 7)}`;
}

typingDemo();
initCode();
initBridge();
initGallery();
initPalette();
initChrome();
renderForTheme(getTheme(committed)!);
