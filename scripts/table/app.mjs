/* GMALL: the table settings window ("Comic effects: table settings"). One window for every option of the lettering, the roll splash, the
   token reactions with their animations and the language of the shown words, grouped by what they affect (defs.TABS). Foundry's own
   vocabulary: sheet tabs, fieldsets, form groups with the hint under the label. The GM's change is saved at once for the table (no Save
   button: every seat follows live, the footer says "Saved for the table"); a player sees the same window with the GM's choices as text,
   updated live when the GM changes them. Opened from Game Settings (menu "Comic effects") and the Plus Ultra menu.
   UNMIRROR: the lettering rows are the engine's own table (L.table, written with L.setTable, followed through the engine's hook
   "moinenLettersTable"); this window keeps no copy of them. An older engine copy (no L.setTable) shows its own screen's values read-only
   under a note (defs.engineMode, UNMIRROR-1). */
import * as D from "./defs.mjs";
import { t } from "./lang.mjs";
import * as T from "./main.mjs";

const { MOD } = D;
let L = null;                       // the engine that runs on this page (set at every render)
const tableEngine = () => D.engineMode(L) === "table";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isGM = () => !!game.user?.isGM;
const fmt = (v, step) => { const n = Number(v); if (!Number.isFinite(n)) return String(v ?? ""); const d = String(step ?? 1).split(".")[1]?.length ?? 0; return n.toLocaleString(game.i18n?.lang || "en", { minimumFractionDigits: d, maximumFractionDigits: d }); };

/* ---------- a row's spec and value ---------- */
function spec(row) {
  if (row.src === "info" || row.src === "seat") return { type: "info" };
  if (row.src === "mod") {
    const cfg = game.settings.settings.get(`${MOD}.${row.key}`);
    if (!cfg) return null;
    const type = cfg.type === Boolean ? "bool" : cfg.range ? "range" : cfg.choices ? "pick" : cfg.type === Number ? "range" : "pick";
    return { type, choices: row.choices ?? (cfg.choices ? Object.keys(cfg.choices) : []), range: cfg.range ?? null, default: cfg.default };
  }
  const s = D.engineSpec(row.key);
  if (!s || D.engineMode(L) === "none") return null;
  return { ...s, default: D.ENGINE_DEFAULTS[row.key] };
}
function value(row) {
  try {
    if (row.src === "mod") return game.settings.get(MOD, row.key);
    if (row.src === "engine") return D.engineValue(L, row.key);
    if (row.src === "seat") return D.seatNote(L);
  } catch { /* not registered */ }
  return undefined;
}
export const values = () => Object.fromEntries(D.ROWS.map((r) => [r.id, value(r)]));
/** the engine this window reads and writes (set at every render; a check sets it directly) */
export function useEngine(l) { L = l ?? null; return L; }
const choiceLabel = (row, c) => t(`IPT.Row.${row.id}.${c}`);
function shownText(row, sp, v) {
  if (row.src === "seat") return t(`IPT.Row.${row.id}.${v ?? "none"}`);
  if (sp.type === "info") return t(`IPT.Row.${row.id}.value`);
  if (sp.type === "bool") return v ? t("IPT.On") : t("IPT.Off");
  if (sp.type === "range") return fmt(v, sp.range?.step);
  return choiceLabel(row, v);
}

/* ---------- the markup ---------- */
let uid = 0;
function rowHtml(row, gm, vals) {
  const sp = spec(row);
  if (!sp) return "";
  if (row.src === "seat" && !vals[row.id]) return "";       // an older engine: nothing to say about this screen
  const id = `ipt-${++uid}`, v = vals[row.id], name = t(`IPT.Row.${row.id}.Name`), hint = t(`IPT.Row.${row.id}.Hint`);
  const hidden = D.shown(row, vals) ? "" : " hidden";
  /* an engine row is the GM's control only when the engine holds the table (an older copy: this screen's own value, read-only) */
  const edit = gm && !(row.src === "engine" && !tableEngine());
  const icon = row.src === "seat" ? "fa-display" : "fa-shield-halved";
  let control;
  if (!edit || sp.type === "info") control = `<output id="${id}" class="ipt-ro${sp.type === "info" ? " ipt-pin" : ""}" data-row="${row.id}" aria-describedby="${id}-h">${sp.type === "info" ? `<i class="fa-solid ${icon}" inert></i> ` : ""}${esc(shownText(row, sp, v))}</output>`;
  else if (sp.type === "bool") control = `<input type="checkbox" id="${id}" data-row="${row.id}"${v ? " checked" : ""} aria-describedby="${id}-h">`;
  else if (sp.type === "pick") control = `<select id="${id}" data-row="${row.id}" aria-describedby="${id}-h">${sp.choices.map((c) => `<option value="${esc(c)}"${c === v || (row.id === "splash.motion" && c === "auto" && v === "full") ? " selected" : ""}>${esc(choiceLabel(row, c))}</option>`).join("")}</select>`;
  else control = `<input type="range" id="${id}" data-row="${row.id}" min="${sp.range.min}" max="${sp.range.max}" step="${sp.range.step}" value="${esc(v)}" aria-describedby="${id}-h"><output class="ipt-val" for="${id}" aria-hidden="true">${esc(fmt(v, sp.range.step))}</output>`;
  // A list whose choices are whole sentences (the layers) gets the full width under its text, never a cut label.
  const wide = sp.type === "pick" && sp.choices.some((c) => String(choiceLabel(row, c)).length > 30);
  const kind = (sp.type === "bool" && edit ? " ipt-bool" : "") + (wide ? " ipt-wide" : "");
  return `<div class="form-group ipt-row${kind}" data-row-id="${row.id}"${hidden}>
    <label for="${id}">${esc(name)}</label>
    <div class="form-fields">${control}</div>
    <p class="hint" id="${id}-h">${esc(hint)}</p>
  </div>`;
}
function tabHtml(tab, gm, vals, active) {
  const secs = tab.sections.map((s) => {
    const legend = `<legend>${esc(t(`IPT.Section.${tab.id}.${s.id}`))}</legend>`;
    if (s.panel) return `<fieldset class="ipt-sec ipt-panel-host" data-panel="${s.panel}">${legend}<div class="ipt-mount"></div></fieldset>`;
    return `<fieldset class="ipt-sec">${legend}${s.rows.map((r) => rowHtml(r, gm, vals)).join("")}</fieldset>`;
  }).join("");
  /* UNMIRROR-1: an older engine copy runs on this page: its options are each screen's own there (said once, above the rows) */
  const old = tab.id === "letters" && D.engineMode(L) === "old" ? `<p class="ipt-note" role="note"><i class="fa-solid fa-triangle-exclamation" inert></i><span>${esc(t("IPT.Engine.old", { version: L?.version ?? "?" }))}</span></p>` : "";
  const preview = tab.id === "letters" || tab.id === "splash" || tab.id === "gore";
  const foot = gm || preview ? `<footer class="ipt-foot">
      ${preview ? `<button type="button" data-action="preview" data-tab-id="${tab.id}" data-tooltip="${esc(t("IPT.PreviewHint"))}"><i class="fa-solid fa-play" inert></i> ${esc(t("IPT.Preview"))}</button>` : ""}
      ${gm ? `<button type="button" data-action="defaults" data-tab-id="${tab.id}" data-tooltip="${esc(t("IPT.DefaultsHint"))}"><i class="fa-solid fa-rotate-left" inert></i> ${esc(t("IPT.Defaults"))}</button>` : ""}
    </footer>` : "";
  return `<section class="tab ipt-tab${active ? " active" : ""}" data-group="main" data-tab="${tab.id}" role="tabpanel">${old}${secs}${foot}</section>`;
}
function html(activeTab) {
  const gm = isGM(), vals = values();
  const nav = D.TABS.map((tb) => `<a data-action="tab" data-group="main" data-tab="${tb.id}"${tb.id === activeTab ? ' class="active"' : ""}><i class="${tb.icon}" inert></i><span>${esc(t(`IPT.Tab.${tb.id}`))}</span></a>`).join("");
  return `<div class="ipt">
    <p class="ipt-banner${gm ? "" : " ipt-banner-player"}"><i class="fa-solid ${gm ? "fa-users" : "fa-lock"}" inert></i><span>${esc(t(gm ? "IPT.Banner.gm" : "IPT.Banner.player"))} <span class="ipt-access">${esc(t("IPT.Banner.access"))}</span></span></p>
    <nav class="sheet-tabs tabs" aria-roledescription="${esc(game.i18n?.localize?.("SHEETS.FormNavLabel") ?? "")}">${nav}</nav>
    ${D.TABS.map((tb) => tabHtml(tb, gm, vals, tb.id === activeTab)).join("")}
    <p class="ipt-status" role="status" aria-live="polite"></p>
  </div>`;
}

/* ---------- writing (the GM) ---------- */
/* the engine's table: quick changes (a slider dragged) go out as one L.setTable of only the changed keys; the engine merges them into its
   table, writes one world document and every seat follows on its next word */
let tableWrite = null, tableTimer = 0, tableWaiting = [];
function writeTable(k, v) {
  tableWrite = { ...(tableWrite ?? {}), [k]: v };
  clearTimeout(tableTimer);
  /* every caller of the gathered write learns its one outcome */
  const p = new Promise((res, rej) => tableWaiting.push({ res, rej }));
  tableTimer = setTimeout(() => {
    const next = tableWrite, waiting = tableWaiting;
    tableWrite = null; tableWaiting = [];
    const done = (ok, err) => { for (const w of waiting) ok ? w.res(true) : w.rej(err); };
    if (!tableEngine()) { done(false, new Error(t("IPT.Engine.oldShort"))); return; }
    Promise.resolve(L.setTable(next)).then((ok) => (ok === false ? done(false, new Error(t("IPT.Notice.refused"))) : done(true)), (err) => done(false, err));
  }, 120);
  return p;
}
export function write(row, v) {
  if (!isGM()) return Promise.reject(new Error("GM only"));
  if (row.src === "mod") return game.settings.set(MOD, row.key, v);
  if (row.src === "engine") return writeTable(row.key, v);
  return Promise.resolve();
}
function readControl(el, row) {
  const sp = spec(row);
  if (el.type === "checkbox") return !!el.checked;
  if (sp?.type === "range") return Number(el.value);
  return el.value;
}

/* ---------- the window ---------- */
let App = null;
function appClass() {
  if (App) return App;
  const { ApplicationV2 } = foundry.applications.api;
  App = class TableSettings extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "ipu-table-settings", classes: ["ipt-app"],
      window: { title: "IPT.Title", icon: "fa-solid fa-burst", resizable: true, contentClasses: ["standard-form"] },
      position: { width: 660, height: 740 },
      actions: { preview: TableSettings.#preview, defaults: TableSettings.#defaults }
    };
    static TABS = { main: { initial: "letters", tabs: D.TABS.map((x) => ({ id: x.id })) } };
    get title() { return t("IPT.Title"); }
    async _renderHTML() {
      useEngine(await T.engine());
      const div = document.createElement("div");
      div.className = "ipt-root";
      div.innerHTML = html(this.tabGroups.main ?? "letters");
      return div;
    }
    _replaceHTML(result, content) {
      this._off?.();
      content.replaceChildren(result);
      const offs = [];
      /* the token animations' own panel, mounted in its section (it writes its own world settings, GM only) */
      for (const host of result.querySelectorAll('.ipt-panel-host[data-panel="tokenanim"] .ipt-mount')) {
        import("../tokenanim/panel.mjs").then((P) => { if (!host.isConnected) return; P.style(); const off = P.mount(host); offs.push(off); }).catch((err) => console.warn(`${MOD} | token animations panel not loaded`, err));
      }
      const onInput = (ev) => { const el = ev.target; if (el?.type === "range") { const o = el.parentElement?.querySelector(".ipt-val"); const row = D.rowById(el.dataset.row); if (o && row) o.textContent = fmt(el.value, spec(row)?.range?.step); } };
      const onChange = (ev) => {
        const el = ev.target, row = el?.dataset?.row ? D.rowById(el.dataset.row) : null;
        if (!row || !isGM()) return;
        const v = readControl(el, row);
        this.#deps({ ...values(), [row.id]: v });
        write(row, v).then(() => this.#status(t("IPT.Saved"))).catch((err) => { this.#status(t("IPT.NotSaved", { error: err?.message ?? err })); this.refresh(); });
      };
      result.addEventListener("input", onInput);
      result.addEventListener("change", onChange);
      /* every seat's window follows the table's values live (a player sees the GM's change at once): this module's own world settings
         (a first change from the default CREATES the world Setting document and "Defaults" deletes it: all three hooks, not only update)
         and the engine's table (its hook, on every seat, also when this screen's own reduced motion or photosensitive mode changes) */
      const follow = (s) => { try { if (String(s?.key ?? "").startsWith(`${MOD}.`)) this.refresh(); } catch { /* closed */ } };
      const hooks = ["createSetting", "updateSetting", "deleteSetting"].map((h) => [h, Hooks.on(h, follow)]);
      hooks.push(["moinenLettersTable", Hooks.on("moinenLettersTable", () => { try { this.refresh(); } catch { /* closed */ } })]);
      this._off = () => { result.removeEventListener("input", onInput); result.removeEventListener("change", onChange); for (const [h, id] of hooks) Hooks.off(h, id); for (const off of offs) try { off?.(); } catch { /* gone */ } };
    }
    async close(o) { this._off?.(); this._off = null; return super.close(o); }

    /** put the current values into the controls (never into the one the GM is using) and the dependent rows */
    refresh() {
      const root = this.element; if (!root) return;
      const vals = values();
      for (const el of root.querySelectorAll("[data-row]")) {
        const row = D.rowById(el.dataset.row), sp = row && spec(row); if (!sp) continue;
        const v = vals[row.id];
        if (el.tagName === "OUTPUT") {
          if (row.src === "seat") { const i = el.querySelector("i"); el.textContent = shownText(row, sp, v); if (i) el.prepend(i, " "); }
          else if (sp.type !== "info") el.textContent = shownText(row, sp, v);
          continue;
        }
        if (document.activeElement === el) continue;
        if (el.type === "checkbox") el.checked = !!v;
        else if (el.tagName === "SELECT") el.value = row.id === "splash.motion" && v === "full" ? "auto" : String(v);
        else { el.value = String(v); const o = el.parentElement?.querySelector(".ipt-val"); if (o) o.textContent = fmt(v, sp.range?.step); }
      }
      this.#deps(vals);
    }
    #deps(vals) { for (const g of this.element?.querySelectorAll(".ipt-row[data-row-id]") ?? []) { const row = D.rowById(g.dataset.rowId); if (row) g.hidden = !D.shown(row, vals); } }
    #status(text) {
      const s = this.element?.querySelector(".ipt-status"); if (!s) return;
      s.textContent = text; s.classList.add("on");
      clearTimeout(this._st); this._st = setTimeout(() => { s.classList.remove("on"); }, 1800);
    }

    static async #preview(_ev, btn) {
      const tab = btn?.dataset?.tabId;
      try {
        if (tab === "gore") { (game.modules.get(MOD)?.api?.gore ?? globalThis.PlusUltraGore)?.preview?.(); return; }
        if (tab === "splash") { const api = game.modules.get(MOD)?.api?.splash ?? globalThis.invincibleSplash; api?.preview?.({ n: 5, sixes: 3, action: "slugfest" }); return; }
        const { letters } = await import("../letters/index.mjs");
        const L = await letters();
        if (!L?.burst) return;
        if (!L.prefs?.enabled) { ui.notifications?.info(t("IPT.Row.letters.enabled.Name") + ": " + t("IPT.Off")); return; }
        L.burst([{ text: "KRAK!", mood: "crack", at: { x: innerWidth * 0.36, y: innerHeight * 0.4 } }, { text: "KA-BOOM!", mood: "boom", at: { x: innerWidth * 0.6, y: innerHeight * 0.46 }, delay: 260 }], { space: "screen" });
      } catch (err) { console.warn(`${MOD} | preview`, err); }
    }
    static async #defaults(_ev, btn) {
      if (!isGM()) return;
      const tab = D.TABS.find((x) => x.id === btn?.dataset?.tabId); if (!tab) return;
      const ok = await foundry.applications.api.DialogV2.confirm({ window: { title: t("IPT.Defaults") }, content: `<p>${esc(t("IPT.DefaultsHint"))}</p>` }).catch(() => false);
      if (!ok) return;
      const rows = tab.sections.flatMap((s) => s.rows ?? []).filter((r) => r.src === "mod" || r.src === "engine");
      const engine = {};
      for (const r of rows) {
        const sp = spec(r); if (!sp) continue;
        if (r.src === "engine") engine[r.key] = sp.default;
        else if (!Object.is(value(r), sp.default)) await write(r, sp.default).catch(() => {});
      }
      if (Object.keys(engine).length && tableEngine()) await L.setTable(engine);
      this.refresh(); this.#status(t("IPT.Saved"));
    }
  };
  return App;
}

let styled = false;
function style() {
  if (styled || document.getElementById("ipt-style")) { styled = true; return; }
  const s = document.createElement("style"); s.id = "ipt-style"; s.textContent = CSS; document.head.append(s); styled = true;
}
export function open(tab = null) {
  style();
  const C = appClass();
  const app = foundry.applications.instances?.get("ipu-table-settings") ?? new C();
  const valid = tab && D.TABS.some((x) => x.id === tab);
  if (app.rendered && valid) { try { app.changeTab(tab, "main", { force: true }); } catch { /* not drawn yet */ } app.bringToFront?.(); return app; }
  if (valid) app.tabGroups.main = tab;
  app.render({ force: true });
  return app;
}

/* ---------- the look: Foundry's own form vocabulary, a quiet banner, the tabs as the one strong line ---------- */
const CSS = `
.ipt-app .window-content { padding: 0; display: flex; flex-direction: column; overflow: hidden; }
.ipt-app .ipt-root, .ipt-app .ipt { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }
.ipt-app .ipt-banner { display: flex; gap: 0.6rem; align-items: flex-start; margin: 0; padding: 0.65rem 1rem 0.6rem; font-size: var(--font-size-13, 0.8125rem); line-height: 1.4; color: var(--color-text-primary); border-bottom: 1px solid var(--color-border, rgba(127,127,127,0.35)); }
.ipt-app .ipt-banner > i { flex: none; margin-top: 0.15rem; color: var(--color-text-secondary); }
.ipt-app .ipt-access { color: var(--color-text-secondary); }
.ipt-app .ipt nav.sheet-tabs { flex: none; margin: 0; padding: 0 0.6rem; gap: 0.15rem; border-bottom: 1px solid var(--color-border, rgba(127,127,127,0.35)); }
.ipt-app .ipt nav.sheet-tabs > a { display: flex; align-items: center; gap: 0.4rem; padding: 0.55rem 0.7rem; white-space: nowrap; }
.ipt-app .ipt nav.sheet-tabs > a i { font-size: 0.85em; }
.ipt-app .ipt .tab { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0.4rem 1rem 0.2rem; scrollbar-gutter: stable; }
.ipt-app .ipt .tab:not(.active) { display: none; }
.ipt-app .ipt-sec { margin: 0.55rem 0 0.9rem; padding: 0.15rem 0.85rem 0.45rem; border: 1px solid var(--color-border, rgba(127,127,127,0.35)); border-radius: 6px; }
.ipt-app .ipt-sec > legend { padding: 0 0.35rem; font-weight: 600; font-size: var(--font-size-13, 0.8125rem); letter-spacing: 0.01em; }
.ipt-app .ipt-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(9rem, 16rem); grid-template-areas: "name ctl" "hint ctl"; column-gap: 1.25rem; row-gap: 0.15rem; align-items: center; margin: 0; padding: 0.6rem 0; }
.ipt-app .ipt-row + .ipt-row { border-top: 1px solid color-mix(in srgb, var(--color-border, #888) 45%, transparent); }
.ipt-app .ipt-row > label { grid-area: name; align-self: end; font-weight: 600; line-height: 1.3; margin: 0; }
.ipt-app .ipt-row .form-fields { grid-area: ctl; display: flex; flex-wrap: nowrap; justify-content: flex-end; align-items: center; gap: 0.5rem; min-width: 0; }
.ipt-app .ipt-row .form-fields select { width: 100%; min-width: 0; }
.ipt-app .ipt-row .form-fields input[type="range"] { flex: 1 1 auto; min-width: 0; margin: 0; }
.ipt-app .ipt-row .hint { grid-area: hint; align-self: start; margin: 0; color: var(--color-text-secondary); font-size: var(--font-size-12, 0.75rem); line-height: 1.4; max-width: 62ch; }
.ipt-app .ipt-val { flex: none; min-width: 2.6rem; text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
.ipt-app .ipt-ro { flex: 1 1 auto; text-align: right; font-weight: 600; color: var(--color-text-primary); font-variant-numeric: tabular-nums; }
.ipt-app .ipt-ro.ipt-pin { font-weight: 500; color: var(--color-text-secondary); }
.ipt-app .ipt-ro.ipt-pin i { margin-right: 0.25rem; }
.ipt-app .ipt-row[hidden] { display: none !important; }
.ipt-app .ipt-row.ipt-wide { grid-template-columns: minmax(0, 1fr); grid-template-areas: "name" "hint" "ctl"; }
.ipt-app .ipt-row.ipt-wide .form-fields { justify-content: flex-start; margin-top: 0.35rem; }
.ipt-app .ipt-row.ipt-wide .form-fields select { max-width: 30rem; }
.ipt-app .ipt-row.ipt-wide .ipt-ro { margin-left: 0; text-align: left; }
.ipt-app select:disabled, .ipt-app input:disabled { opacity: 0.55; cursor: default; }
.ipt-app .ipt-panel-host .ipt-mount { padding: 0.35rem 0 0.1rem; }
.ipt-app .ipt-panel-host .ipu-tka .form-group { grid-template-columns: minmax(0, 1fr) minmax(9rem, 17rem); padding: 0.35rem 0; }
.ipt-app .ipt-panel-host .ipu-tka .form-group > label { font-weight: 600; }
.ipt-app .ipt-panel-host .ipu-tka .form-fields { flex-wrap: nowrap; }
.ipt-app .ipt-panel-host .ipu-tka .ipu-tka-on { display: grid; grid-template-columns: minmax(0, 1fr) auto; padding-bottom: 0.5rem; }
.ipt-app .ipt-panel-host .ipu-tka .ipu-tka-on > label { cursor: pointer; }
.ipt-app .ipt-panel-host .ipu-tka .form-group > label { cursor: default; }
.ipt-app .ipt-foot { display: flex; justify-content: flex-end; gap: 0.5rem; margin: 0.2rem 0 0.8rem; }
.ipt-app .ipt-foot button { flex: 0 0 auto; width: auto; padding: 0 0.9rem; }
.ipt-app .ipt-status { flex: none; margin: 0; padding: 0.35rem 1rem; min-height: 1.9rem; font-size: var(--font-size-12, 0.75rem); color: var(--color-text-secondary); border-top: 1px solid var(--color-border, rgba(127,127,127,0.35)); opacity: 0; transition: opacity 180ms ease-out; }
.ipt-app .ipt-status.on { opacity: 1; }
.ipt-app .ipt input:focus-visible, .ipt-app .ipt select:focus-visible, .ipt-app .ipt button:focus-visible, .ipt-app .ipt nav a:focus-visible { outline: 2px solid var(--color-warm-2, #ff6400); outline-offset: 1px; }
.ipt-app .ipt-note { display: flex; gap: 0.6rem; align-items: flex-start; margin: 0.55rem 0 0; padding: 0.55rem 0.75rem; line-height: 1.4; border: 1px solid var(--color-border, rgba(127,127,127,0.35)); border-radius: 6px; }
.ipt-app .ipt-note > i { flex: none; margin-top: 0.15rem; color: var(--color-text-secondary); }
.ipt-app .ipt .tab { container-type: inline-size; }
@container (max-width: 26rem) { .ipt-app .ipt-row { grid-template-columns: minmax(0, 1fr); grid-template-areas: "name" "hint" "ctl"; } .ipt-app .ipt-row .form-fields { justify-content: flex-start; } }
@media (prefers-reduced-motion: reduce) { .ipt-app .ipt-status { transition: none; } }
`;
