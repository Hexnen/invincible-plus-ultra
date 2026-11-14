/* TOKANIM: the options of the token's own reaction animations.
   Where: the map module's Tokens workspace (moinen-maps, "Tokens" section of its tools: Entering, Leaving, Idle, Death, ... ) gets a
   dock panel "Reactions" next to its Death panel (added with its own registry's extendSection: the map module is not changed), and the
   Plus Ultra menu (scripts/menu.mjs) gets a tool that opens the same panel in a window, for every user (and for tables without the map).
   What: the GM's table settings (on for the table; per event the animation and its intensity), a preview of each event and of a series
   on the selected tokens (this screen only), defaults; and each user's own screen (full / gentle / off). Players see the table settings
   read-only and can preview them. Look and pattern: the dock's own form rows (label column, the control filling the rest, explanations
   in tooltips, the actions in a row at the bottom), compact like the tactical UI (icon buttons, text in tooltips). */
import * as P from "./pure.mjs";
import * as R from "./main.mjs";
import { t } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isGM = () => !!game.user?.isGM;
let uid = 0;

/* ---------- the markup ---------- */
function animOptions(kind, value) {
  const fits = P.FITS[kind] ?? [], rest = P.ANIM_IDS.filter((id) => id !== "none" && !fits.includes(id));
  const opt = (id) => `<option value="${esc(id)}"${id === value ? " selected" : ""} title="${esc(t(`ITA.AnimHint.${id}`))}">${esc(t(`ITA.Anim.${id}`))}</option>`;
  return `<optgroup label="${esc(t("ITA.Panel.fits"))}">${fits.map(opt).join("")}</optgroup><optgroup label="${esc(t("ITA.Panel.others"))}">${rest.map(opt).join("")}</optgroup>${opt("none")}`;
}
const fmt = (v) => (Math.round(Number(v) * 10) / 10).toFixed(1);
function rowHtml(kind, row, gm) {
  const id = `ipu-tka-${++uid}`, ev = t(`ITA.Event.${kind}`), dis = gm ? "" : " disabled";
  return `<div class="form-group ipu-tka-row" data-kind="${kind}">
    <label for="${id}" data-tooltip="${esc(t(`ITA.EventHint.${kind}`))}">${esc(ev)}</label>
    <div class="form-fields">
      <select id="${id}" data-k="anim" aria-label="${esc(t("ITA.Panel.animOf", { event: ev }))}" data-tooltip="${esc(t(`ITA.AnimHint.${row.anim}`))}"${dis}>${animOptions(kind, row.anim)}</select>
      <input type="range" data-k="str" min="${P.STR.min}" max="${P.STR.max}" step="${P.STR.step}" value="${row.str}" aria-label="${esc(t("ITA.Panel.strOf", { event: ev, value: fmt(row.str) }))}" data-tooltip="${esc(t("ITA.Panel.str"))}: ${fmt(row.str)}"${dis}${row.anim === "none" ? " hidden" : ""}>
      <output class="ipu-tka-val" aria-hidden="true"${row.anim === "none" ? " hidden" : ""}>${fmt(row.str)}</output>
      <button type="button" class="ipu-tka-play" data-act="play" aria-label="${esc(t("ITA.Panel.playOf", { event: ev }))}" data-tooltip="${esc(t("ITA.Panel.play"))}"${row.anim === "none" ? " disabled" : ""}><i class="fa-solid fa-play" inert></i></button>
    </div>
  </div>`;
}
function html() {
  const gm = isGM(), ev = R.events(), on = R.worldOn(), mineId = `ipu-tka-${++uid}`, onId = `ipu-tka-${++uid}`;
  return `<div class="ipu-tka mm-ws-form">
    ${gm ? `<div class="form-group ipu-tka-on"><label for="${onId}" data-tooltip="${esc(t("ITA.Panel.onHint"))}">${esc(t("ITA.Panel.on"))}</label><div class="form-fields"><input type="checkbox" id="${onId}" data-k="on"${on ? " checked" : ""}></div></div>`
      : `<p class="ipu-tka-note">${esc(t("ITA.Panel.gmOnly"))}</p>`}
    <div class="ipu-tka-rows" data-dep="on"${on ? "" : " hidden"}>
      ${P.EVENTS.map((k) => rowHtml(k, ev[k], gm)).join("")}
      <p class="ipu-tka-note">${esc(t("ITA.Panel.amountNote"))} ${esc(t("ITA.Panel.previewNote"))}</p>
      <div class="ipu-tka-actions">
        <button type="button" data-act="series" data-tooltip="${esc(t("ITA.Panel.seriesHint"))}"><i class="fa-solid fa-forward" inert></i> ${esc(t("ITA.Panel.series"))}</button>
        ${gm ? `<button type="button" data-act="reset" data-tooltip="${esc(t("ITA.Panel.resetHint"))}"><i class="fa-solid fa-rotate-left" inert></i> ${esc(t("ITA.Panel.reset"))}</button>` : ""}
      </div>
    </div>
    <div class="form-group ipu-tka-mine"><label for="${mineId}" data-tooltip="${esc(t("ITA.Panel.mineHint"))}">${esc(t("ITA.Panel.mine"))}</label>
      <div class="form-fields"><select id="${mineId}" data-k="mine">${R.MINE.map((k) => `<option value="${k}"${k === R.mine() ? " selected" : ""}>${esc(t(`ITA.Mine.${k}`))}</option>`).join("")}</select></div></div>
  </div>`;
}

/* ---------- the behaviour ---------- */
const selected = () => (canvas?.tokens?.controlled ?? []).filter((tok) => R.seen(tok));
function needPick() { const list = selected(); if (!list.length) ui.notifications?.info(t("ITA.Panel.pickFirst")); return list; }
let writeTimer = 0, pendingRows = null;
function writeRows(rows) {
  pendingRows = P.cleanEvents(rows);
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => { const v = pendingRows; pendingRows = null; if (v && isGM()) game.settings.set(MOD, R.KEY.events, v).catch((e) => console.warn(`${MOD} | token animations not saved`, e)); }, 250);
}
const current = () => pendingRows ?? R.events();

/** build the panel into host; returns its cleanup */
export function mount(host) {
  host.innerHTML = html();
  const root = host.querySelector(".ipu-tka");
  const rowOf = (el) => el.closest?.(".ipu-tka-row")?.dataset.kind ?? null;
  const readRow = (kind) => {
    const r = root.querySelector(`.ipu-tka-row[data-kind="${kind}"]`);
    return { anim: r.querySelector('[data-k="anim"]').value, str: Number(r.querySelector('[data-k="str"]').value) };
  };
  const syncRow = (kind, row) => {
    const r = root.querySelector(`.ipu-tka-row[data-kind="${kind}"]`); if (!r) return;
    const ev = t(`ITA.Event.${kind}`), sel = r.querySelector('[data-k="anim"]'), rng = r.querySelector('[data-k="str"]'), out = r.querySelector("output"), play = r.querySelector('[data-act="play"]');
    if (document.activeElement !== sel) sel.value = row.anim;
    if (document.activeElement !== rng) rng.value = String(row.str);
    out.textContent = fmt(row.str);
    sel.dataset.tooltip = t(`ITA.AnimHint.${row.anim}`);
    rng.dataset.tooltip = `${t("ITA.Panel.str")}: ${fmt(row.str)}`; rng.setAttribute("aria-label", t("ITA.Panel.strOf", { event: ev, value: fmt(row.str) }));
    const none = row.anim === "none"; rng.hidden = none; out.hidden = none; play.disabled = none;
  };
  const playKind = (kind) => { const row = readRow(kind); for (const tok of needPick()) R.preview(tok, kind, { anim: row.anim, strength: row.str }); };
  const onInput = (ev) => {
    const el = ev.target, k = el.dataset?.k, kind = rowOf(el);
    if (k === "str" && kind) { const out = el.parentElement.querySelector("output"); if (out) out.textContent = fmt(el.value); }
  };
  const onChange = (ev) => {
    const el = ev.target, k = el.dataset?.k;
    if (k === "mine") { game.settings.set(MOD, R.KEY.mine, el.value); return; }
    if (k === "on" && isGM()) { game.settings.set(MOD, R.KEY.on, !!el.checked); root.querySelector('[data-dep="on"]').hidden = !el.checked; return; }
    const kind = rowOf(el);
    if (!kind || !isGM()) return;
    const rows = { ...current(), [kind]: readRow(kind) };
    syncRow(kind, rows[kind]);
    writeRows(rows);
    if (rows[kind].anim !== "none") { const list = selected(); for (const tok of list) R.preview(tok, kind, { anim: rows[kind].anim, strength: rows[kind].str }); }
  };
  const onClick = (ev) => {
    const b = ev.target.closest?.("[data-act]"); if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    if (act === "play") { const kind = rowOf(b); if (kind) playKind(kind); }
    else if (act === "series") {
      const rows = current(), anims = {}, strengths = {};
      for (const k of P.EVENTS) { const r = readRow(k); anims[k] = r.anim; strengths[k] = r.str; }
      for (const tok of needPick()) R.series(tok, { anims, strengths });
      void rows;
    } else if (act === "reset" && isGM()) {
      const rows = P.cleanEvents(null);
      for (const k of P.EVENTS) syncRow(k, rows[k]);
      writeRows(rows);
    }
  };
  root.addEventListener("input", onInput);
  root.addEventListener("change", onChange);
  root.addEventListener("click", onClick);
  /* a change made elsewhere (another GM window, the other place of this panel) flows back into the controls */
  const hook = Hooks.on("updateSetting", (s) => {
    try {
      if (s?.key === `${MOD}.${R.KEY.events}` && !pendingRows) { const rows = R.events(); for (const k of P.EVENTS) syncRow(k, rows[k]); }
      else if (s?.key === `${MOD}.${R.KEY.on}`) { const on = R.worldOn(), c = root.querySelector('[data-k="on"]'); if (c) c.checked = on; root.querySelector('[data-dep="on"]').hidden = !on; }
      else if (s?.key === `${MOD}.${R.KEY.mine}`) { const sel = root.querySelector('[data-k="mine"]'); if (sel && document.activeElement !== sel) sel.value = R.mine(); }
    } catch { /* the panel is gone */ }
  });
  return () => { root.removeEventListener("input", onInput); root.removeEventListener("change", onChange); root.removeEventListener("click", onClick); Hooks.off("updateSetting", hook); };
}

/* ---------- the look: the map dock's form rows (inherits its variables there), the same in the window ---------- */
const CSS = `
.ipu-tka { display: grid; gap: 0.1rem; }
.ipu-tka .form-group { display: grid; grid-template-columns: 6.2rem minmax(0, 1fr); align-items: center; gap: 0.5rem; margin: 0; padding: 0.12rem 0; }
.ipu-tka .form-group > label { min-width: 0; line-height: 1.2; overflow-wrap: break-word; cursor: help; }
.ipu-tka .form-fields { display: flex; align-items: center; gap: 0.3rem; min-width: 0; }
.ipu-tka .ipu-tka-row select { flex: 1 1 auto; min-width: 0; width: 100%; }
.ipu-tka .ipu-tka-row input[type="range"] { flex: 0 1 4.2rem; width: 4.2rem; min-width: 2.6rem; margin: 0; }
.ipu-tka .ipu-tka-val { flex: none; width: 1.7rem; text-align: right; font-variant-numeric: tabular-nums; font-size: var(--font-size-12, 0.75rem); color: var(--mm-ws-muted, var(--color-text-secondary, inherit)); }
.ipu-tka .ipu-tka-play { flex: none; width: 1.75rem; height: 1.75rem; min-height: 0; margin: 0; padding: 0; display: grid; place-items: center; line-height: 1; }
.ipu-tka .ipu-tka-play i { margin: 0; font-size: 0.7rem; }
.ipu-tka .ipu-tka-on { display: flex; flex-direction: row-reverse; justify-content: flex-end; gap: 0.45rem; }
.ipu-tka .ipu-tka-on > label { flex: 1 1 auto; cursor: pointer; }
.ipu-tka .ipu-tka-on .form-fields { flex: none; }
.ipu-tka .ipu-tka-on input { margin: 0; }
.ipu-tka .ipu-tka-rows { display: grid; gap: 0.1rem; }
.ipu-tka .ipu-tka-note { margin: 0.2rem 0 0.3rem; color: var(--mm-ws-muted, var(--color-text-secondary, inherit)); font-size: var(--font-size-12, 0.75rem); line-height: 1.3; }
.ipu-tka .ipu-tka-actions { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0.2rem 0 0.35rem; }
.ipu-tka .ipu-tka-actions button { flex: 1 1 auto; width: auto; height: 1.9rem; margin: 0; padding: 0 0.6rem; white-space: nowrap; }
.ipu-tka .ipu-tka-mine { margin-top: 0.25rem; padding-top: 0.45rem; border-top: 1px solid var(--mm-edge, var(--color-border, rgba(127,127,127,0.35))); }
.ipu-tka [hidden] { display: none !important; }
.ipu-tka-app .window-content { padding: 0.6rem 0.8rem; }
/* the narrow map dock: the event's name above its controls, so the animation's name is never cut */
.ipu-tka { container-type: inline-size; }
@container (max-width: 21rem) {
  .ipu-tka .ipu-tka-row { grid-template-columns: minmax(0, 1fr); gap: 0.15rem; padding: 0.2rem 0 0.25rem; }
  .ipu-tka .ipu-tka-mine { grid-template-columns: minmax(0, 1fr); gap: 0.15rem; }
}
@media (prefers-reduced-motion: reduce) { .ipu-tka * { transition: none !important; } }
`;
function style() {
  if (document.getElementById("ipu-tka-style")) return;
  const s = document.createElement("style"); s.id = "ipu-tka-style"; s.textContent = CSS; document.head.append(s);
}

/* ---------- the window (Plus Ultra menu): the same panel ---------- */
let App = null;
function appClass() {
  if (App) return App;
  const { ApplicationV2 } = foundry.applications.api;
  App = class TokAnimApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = { id: "ipu-tka-app", classes: ["ipu-tka-app"], window: { title: "ITA.Panel.windowTitle", icon: "fa-solid fa-person-falling-burst", resizable: true }, position: { width: 400, height: "auto" } };
    get title() { return t("ITA.Panel.windowTitle"); }
    async _renderHTML() { const div = document.createElement("div"); return div; }
    _replaceHTML(result, content) { this._off?.(); content.replaceChildren(result); this._off = mount(result); }
    async close(o) { this._off?.(); this._off = null; return super.close(o); }
  };
  return App;
}
export function open() { style(); const C = appClass(); const app = foundry.applications.instances?.get("ipu-tka-app") ?? new C(); app.render({ force: true }); return app; }

/* ---------- the places ---------- */
async function intoMaps() {
  try {
    if (!game.modules.get("moinen-maps")?.active) return false;
    const url = foundry.utils.getRoute("modules/moinen-maps/scripts/workspace/registry.mjs");
    const Reg = await import(url);
    if (!Reg?.extendSection || !Reg.sectionById?.("tokens")) return false;
    Reg.extendSection("tokens", { panels: [{ id: "ipuReactions", title: t("ITA.Panel.title"), icon: "fa-solid fa-person-falling-burst", open: false, mount: (host) => { style(); return mount(host); } }] });
    return true;
  } catch (err) { console.warn(`${MOD} | token animations: the map's Tokens dock was not extended`, err); return false; }
}
async function intoMenu() {
  try {
    const Menu = await import("../menu.mjs");
    Menu.add({ name: "ipuTokenAnim", title: () => t("ITA.Panel.menu"), icon: "fa-solid fa-person-falling-burst", order: 40, onChange: () => open() });
  } catch (err) { console.warn(`${MOD} | token animations: no Plus Ultra menu tool`, err); }
}
export let inMaps = false;
export async function start() { style(); inMaps = await intoMaps(); await intoMenu(); }
