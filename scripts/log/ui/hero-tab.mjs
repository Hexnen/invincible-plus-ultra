/* Activity log UI: the LOG TAB of the superhero sheet (spec 6.2). The sheet is the SYSTEM's InvincibleActorSheet (HandlebarsApplicationMixin(ActorSheetV2)) that
   this module only restyles. Two adapters, chosen automatically:
     "parts" (primary): at ready, PARTS gets an `ipLog` part (templates/log-tab.hbs) and three methods are wrapped: _configureRenderOptions pushes the part for
              GM / readers, _getTabs completes the tab object (the system's switch has no default case, an unknown part gets an empty tab), _preparePartContext
              hands the tab to the template. Survives every re-render because the tab is a real part.
     "dom"  (fallback): when a wrapped member is missing, a wrapper throws, or a render shows no tab although one is wanted (a system update), the tab link and
              the section are injected on every render. `setMode()` forces either adapter (tests). `tabMode` is reported through api.log.ui.
   The view itself is created lazily the first time the tab is active, kept per sheet instance and re-attached after every render; filters, density, expanded
   rows and scroll live in the per-actor state of view.mjs. Visible only for the GM and for readers per the read-access setting (api.log.canView).
   Secrecy: the tab is a display gate, not a security boundary (see the settings text). */
import * as E from "../events.mjs";
import { t } from "../lang.mjs";
import { LogView, actorSource, stateFor } from "./view.mjs";

const MOD = E.MOD_ID;
const TAB = "ipLog";
const ICON = "fa-solid fa-clock-rotate-left";
const TEMPLATE = `modules/${MOD}/templates/log-tab.hbs`;
export const tab = { mode: "pending", sheetClass: null, installed: false, error: null };
const VIEWS = new WeakMap();
const logApi = () => game.modules.get(MOD)?.api?.log ?? null;
const warn = (msg, e) => console.warn(`${MOD} | log tab: ${msg}`, e ?? "");

/* ------------------------------------------------------------------ who gets the tab */
function tabTypes() {
  try { const raw = String(logApi()?._internal?.Store?.setting?.("logActorTypes", "superhero") ?? "superhero"); const l = raw.split(/[\s,]+/).filter(Boolean); return l.length ? l : ["superhero"]; } catch { return ["superhero"]; }
}
export function wantsTab(actor) {
  try {
    if (!actor || actor.documentName !== "Actor" || !tabTypes().includes(actor.type) || actor.limited) return false;
    const l = logApi(); if (!l) return false;
    return game.user.isGM || l.canView(actor);   // the GM also sees the "off" state, so the tab is never silently missing
  } catch { return false; }
}
const isHeroSheet = (app, el) => !!el?.classList?.contains("invincible") && el.classList.contains("actor") && app?.document?.documentName === "Actor";

/* ------------------------------------------------------------------ seen marker and badge */
const seenKey = (a) => `ipl-seen:${game.user?.id}:${a.uuid}`;
function getSeen(a) {
  try { const v = localStorage.getItem(seenKey(a)); if (v === null) { localStorage.setItem(seenKey(a), String(Date.now())); return Date.now(); } return Number(v) || 0; } catch { return Date.now(); }
}
function setSeen(a, ms = Date.now()) { try { localStorage.setItem(seenKey(a), String(ms)); } catch { /* private window */ } }
function countUnseen(actor) {
  try {
    const l = logApi(); if (!l || !l.canView(actor)) return 0;
    const since = getSeen(actor); let n = 0;
    for (const e of l.read(actor).entries) if (e.t > since && e.u !== game.user.id && !e.h && E.severityOf(e.k) > 0) n++;
    return n;
  } catch { return 0; }
}
function paintBadge(app, element) {
  const a = element?.querySelector?.(`nav.sheet-tabs a[data-tab="${TAB}"]`); if (!a) return;
  const n = a.classList.contains("active") ? 0 : countUnseen(app.document);
  let b = a.querySelector(".ipl-tabbadge");
  a.tabIndex = 0; a.setAttribute("role", "button");
  if (!n) { b?.remove(); a.setAttribute("aria-label", t("IPL.TabAria")); return; }
  if (!b) { b = document.createElement("span"); b.className = "ipl-tabbadge"; b.setAttribute("aria-hidden", "true"); a.append(b); }
  b.textContent = n > 99 ? "99+" : String(n);
  a.setAttribute("aria-label", t("IPL.TabAriaNew", { n: n > 99 ? "99+" : n }));
}

/* ------------------------------------------------------------------ adapter 1: parts */
function findSheetClass() {
  const reg = CONFIG.Actor?.sheetClasses?.superhero ?? {};
  for (const cfg of Object.values(reg)) { const c = cfg?.cls; if (c && (c.name === "InvincibleActorSheet" || (c.PARTS?.powers && c.PARTS?.tabs))) return c; }
  return null;
}
const PATCH = Symbol.for("ip-log-tab-patched");
function installParts() {
  const C = findSheetClass();
  if (!C) throw new Error("the superhero sheet class was not found");
  tab.sheetClass = C.name;
  if (C[PATCH]) return;
  const P = C.prototype;
  for (const m of ["_configureRenderOptions", "_getTabs", "_preparePartContext"]) if (typeof P[m] !== "function") throw new Error(`sheet method ${m} is missing`);
  if (!C.PARTS || typeof C.PARTS !== "object") throw new Error("the sheet has no PARTS");
  const oCRO = P._configureRenderOptions, oGT = P._getTabs, oPPC = P._preparePartContext;
  C.PARTS = { ...C.PARTS, [TAB]: { template: TEMPLATE, scrollable: [""] } };
  P._configureRenderOptions = function (options) {
    oCRO.call(this, options);
    try {
      const want = wantsTab(this.document);
      if (tab.mode === "parts" && want && Array.isArray(options?.parts) && options.parts.includes("tabs") && !options.parts.includes(TAB)) options.parts.push(TAB);
      // the reader lost the tab (setting changed, ownership taken away) while it was the open one: fall back to the sheet's own first tab
      if (!want && this.tabGroups?.primary === TAB) this.tabGroups.primary = "powers";
    } catch (e) { warn("render options", e); }
  };
  P._getTabs = function (parts) {
    const tabs = oGT.call(this, parts);
    try {
      if (tabs && Array.isArray(parts) && parts.includes(TAB)) tabs[TAB] = { ...(tabs[TAB] ?? {}), id: TAB, group: "primary", icon: ICON, tooltip: t("IPL.Tab"), cssClass: this.tabGroups?.primary === TAB ? "active" : "" };
    } catch (e) { warn("tabs", e); }
    return tabs;
  };
  P._preparePartContext = async function (partId, context, ...rest) {
    if (partId === TAB) { context.tab = context.tabs?.[TAB]; return context; }
    return oPPC.call(this, partId, context, ...rest);
  };
  C[PATCH] = true;
}

/* ------------------------------------------------------------------ adapter 2: DOM injection */
function injectDom(app, element) {
  const nav = element.querySelector("nav.sheet-tabs");
  if (!nav) return false;
  const active = app.tabGroups?.primary === TAB;
  let a = nav.querySelector(`a[data-tab="${TAB}"]`);
  if (!a) {
    a = document.createElement("a");
    a.dataset.action = "tab"; a.dataset.group = "primary"; a.dataset.tab = TAB; a.dataset.tooltip = t("IPL.Tab");
    const i = document.createElement("i"); i.className = ICON; i.setAttribute("inert", ""); a.append(i);
    nav.append(a);
  }
  a.classList.toggle("active", active);
  let sec = element.querySelector(`section.tab[data-tab="${TAB}"]`);
  if (!sec) {
    sec = document.createElement("section");
    sec.className = "tab ip-log ipl-tab scrollable"; sec.dataset.group = "primary"; sec.dataset.tab = TAB;
    const last = [...element.querySelectorAll('section.tab[data-group="primary"]')].pop();
    if (last) last.after(sec); else (element.querySelector(".window-content") ?? element).append(sec);
  }
  sec.classList.toggle("active", active);
  return true;
}

/* ------------------------------------------------------------------ mounting */
function ensureMounted(app, element) {
  const section = element.querySelector(`section.tab[data-tab="${TAB}"]`);
  if (!section) return null;
  let view = VIEWS.get(app);
  if (!view) {
    const src = actorSource(app.document);
    view = new LogView(src, stateFor(src.key), {
      scroller: section,
      onShown: () => { setSeen(app.document); paintBadge(app, app.element); },
      onChanged: (v) => { if (v.visible) setSeen(app.document); paintBadge(app, app.element); }
    });
    VIEWS.set(app, view);
  }
  view.attach(section);
  return view;
}
function onRender(app, element) {
  const actor = app.document;
  if (!wantsTab(actor)) {
    // a part that is no longer rendered is NOT removed by Foundry: clear the leftovers, or an old Log section would stay on screen
    element.querySelector(`nav.sheet-tabs a[data-tab="${TAB}"]`)?.remove(); element.querySelector(`section.tab[data-tab="${TAB}"]`)?.remove();
    const v = VIEWS.get(app); if (v) { v.destroy(); VIEWS.delete(app); }
    if (app.tabGroups?.primary === TAB) { app.tabGroups.primary = "powers"; try { app.changeTab("powers", "primary"); } catch { /* sheet closing */ } }
    return;
  }
  const anchor = () => element.querySelector(`nav.sheet-tabs a[data-tab="${TAB}"]`);
  if (tab.mode === "dom") injectDom(app, element);
  else if (!anchor()) { warn("the sheet did not render the tab part; switching to the DOM adapter"); tab.mode = "dom"; tab.error = "no part rendered"; injectDom(app, element); }
  if (!element.dataset.iplBound) {
    element.dataset.iplBound = "1";
    element.addEventListener("click", (ev) => {
      const a = ev.target.closest?.(`nav.sheet-tabs a[data-tab="${TAB}"]`);
      if (a) setTimeout(() => { ensureMounted(app, element); paintBadge(app, element); }, 0);
      else if (ev.target.closest?.("nav.sheet-tabs a[data-tab]")) setTimeout(() => paintBadge(app, element), 0);
    });
  }
  paintBadge(app, element);
  const active = anchor()?.classList.contains("active") || app.tabGroups?.primary === TAB;
  if (active) ensureMounted(app, element);
}

/* ------------------------------------------------------------------ keeping open sheets in step */
const heroSheets = (actorId) => [...foundry.applications.instances.values()].filter((a) => a.element && isHeroSheet(a, a.element) && (!actorId || a.document.id === actorId));
let refreshTimer = null; const refreshIds = new Set();
export function refreshSheets(actorId = null) {
  if (actorId) refreshIds.add(actorId); else refreshIds.add("*");
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const all = refreshIds.has("*"); const ids = [...refreshIds]; refreshIds.clear();
    for (const app of heroSheets()) {
      if (!all && !ids.includes(app.document.id)) continue;
      const want = wantsTab(app.document), has = !!app.element.querySelector(`[data-tab="${TAB}"]`);
      if (want !== has) app.render();
      else paintBadge(app, app.element);
    }
  }, 300);
}

/* ------------------------------------------------------------------ public */
/** Force an adapter ("parts" | "dom") and redraw the open hero sheets. */
export function setMode(mode) {
  if (mode !== "parts" && mode !== "dom") return tab.mode;
  if (mode === "parts" && !tab.installed) return tab.mode;
  tab.mode = mode; tab.error = null;
  for (const app of heroSheets()) app.render();
  return tab.mode;
}
/** Open the hero sheet on the Log tab, optionally with filters ({cats, users, search, showMinor, preset, onlyMine}). */
export async function open(target, { filters } = {}) {
  const actor = typeof target === "string" ? (target.includes(".") ? await fromUuid(target) : game.actors.get(target)) : target;
  if (!actor || !wantsTab(actor)) return null;
  const app = actor.sheet;
  app.tabGroups.primary = TAB;
  await app.render({ force: true });
  const view = app.element ? ensureMounted(app, app.element) : null;
  if (view && filters) view.applyFilters(filters);
  return view;
}
export const viewOf = (app) => VIEWS.get(app) ?? null;
export const status = () => ({ mode: tab.mode, sheetClass: tab.sheetClass, error: tab.error, sheets: heroSheets().filter((a) => a.element.querySelector(`[data-tab="${TAB}"]`)).length });

/** Called once at ready (after api.log exists). */
export function install() {
  if (tab.installed) return;
  tab.installed = true;
  try { installParts(); tab.mode = "parts"; }
  catch (e) { tab.mode = "dom"; tab.error = String(e?.message ?? e); warn("the parts adapter is unavailable, using the DOM adapter", e); }
  Hooks.on("renderApplicationV2", (app, element) => { if (isHeroSheet(app, element)) { try { onRender(app, element); } catch (e) { warn("render hook", e); } } });
  Hooks.on("closeApplicationV2", (app) => { const v = VIEWS.get(app); if (v) { v.destroy(); VIEWS.delete(app); } });
  // the tab appears for a reader as soon as the journal exists / the setting allows it, and the badge follows new entries
  logApi()?.subscribe?.("*", (info) => refreshSheets(info?.actorId ?? null));
  Hooks.on("updateJournalEntry", (j) => { if (j?.flags?.[MOD]?.log) refreshSheets(j.id); });
  Hooks.on("createJournalEntry", (j) => { if (j?.flags?.[MOD]?.log) refreshSheets(j.id); });
  Hooks.on("updateSetting", (s) => { if (String(s?.key ?? "").startsWith(`${MOD}.log`)) refreshSheets(); });
  Hooks.on("updateActor", (a, ch) => { if (ch && "ownership" in ch) refreshSheets(a.id); });
  refreshSheets();
}
