/* Team & Base card, phase L5 (activity log project): the LOG tab. Interface: ./index.mjs. A thin host for the shared log view of scripts/log/ui/view.mjs, driven by
   the base actor as the log source (scope "base": base categories, base sentences). Nothing here reads or writes log data itself: reading goes through
   api.log.read (via the view), notes through api.log.note (relay for players), annotate / redact / export through the view's source.
   - The tab is always listed (the tab interface cannot hide one); a user who may not read the log gets the view's own "private" / "off" state.
   - The sheet repaints the body on card changes (innerHTML): the view OBJECT lives per team id (module level) and is re-attached into the new host by mount(),
     filters / density / expanded rows / scroll live in the per-actor state of view.mjs, so a repaint loses nothing. The host is the scroller of the view (its listeners
     die with the host), the panel around it loses its padding (styles/log.css, .ipl-host).
   - Unseen badge on the tab button: entries by OTHER users newer than the last visit of this tab (localStorage "ipl-seen:<user>:<uuid>", the same marker as the
     hero tab), patched into the open sheets' tab button when the log changes (no repaint of the sheet).
   - The log module is loaded on demand (dynamic import of ../../log/ui/view.mjs, the SAME module instance as the log feature's own); when it is missing the tab says so.
   - The label string for this tab is registered at load into the base string tables (the tab list reads the key made of the tab id); the key is built, not written as a literal, so
     check-lang does not demand a second definition once the line is moved into lang.mjs. */
import { EN, PL } from "../lang.mjs";

const MOD = "invincible-plus-ultra";
const ID = "log";
const KEY = ["IPB", "Tab", ID].join(".");
EN[KEY] ??= "Log";
PL[KEY] ??= "Dziennik";

const VIEWS = new Map();                   // team id -> { view, uuid }
let LIB = null;                            // { LogView, actorSource, stateFor } once loaded
let LOADING = null;
let subscribed = false;
let closeHooked = false;
const logApi = () => game.modules.get(MOD)?.api?.log ?? null;
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const trl = (key, fallback) => { try { const v = game.modules.get(MOD)?.api?.log?.t?.(key); return v && v !== key ? v : fallback; } catch { return fallback; } };

function loadLib() {
  if (LIB) return Promise.resolve(LIB);
  LOADING ??= import("../../log/ui/view.mjs").then((m) => (LIB = { LogView: m.LogView, actorSource: m.actorSource, stateFor: m.stateFor })).catch((err) => { LOADING = null; console.warn(`${MOD} | base log tab: the log view could not be loaded`, err); return null; });
  return LOADING;
}

/* ------------------------------------------------------------------ seen marker and badge */
const seenKey = (a) => `ipl-seen:${game.user?.id}:${a.uuid}`;
function getSeen(a) {
  try { const v = localStorage.getItem(seenKey(a)); if (v === null) { localStorage.setItem(seenKey(a), String(Date.now())); return Date.now(); } return Number(v) || 0; } catch { return Date.now(); }
}
function setSeen(a, ms = Date.now()) { try { localStorage.setItem(seenKey(a), String(ms)); } catch { /* private window */ } }
function countUnseen(actor) {
  try {
    const l = logApi(); if (!l || !actor || !l.canView(actor)) return 0;
    const E = l.pure?.E; const since = getSeen(actor); let n = 0;
    for (const e of l.read(actor).entries) if (e.t > since && e.u !== game.user.id && !e.h && (!E || E.severityOf(e.k) > 0) && (game.user.isGM || !e.v)) n++;
    return n;
  } catch { return 0; }
}
const baseSheets = (teamId) => [...(foundry.applications?.instances?.values?.() ?? [])].filter((a) => a?.element && typeof a.teamId === "string" && (!teamId || a.teamId === teamId) && a.element.querySelector?.(".ipb-tablist"));
/** patch the badge of the Log tab button in every open sheet of this team (the sheet's own tab repaint reads badge() as well) */
function refreshBadge(teamId) {
  for (const app of baseSheets(teamId)) {
    const btn = app.element.querySelector(`.ipb-tab[data-tab="${ID}"]`); if (!btn) continue;
    const actor = game.actors.get(app.teamId); if (!actor) continue;
    const here = !!VIEWS.get(app.teamId)?.view?.visible;
    const n = here ? 0 : countUnseen(actor);
    let b = btn.querySelector(".ipb-tab-badge");
    if (!n) { b?.remove(); continue; }
    if (!b) { b = document.createElement("b"); b.className = "ipb-tab-badge"; btn.append(b); }
    b.textContent = n > 99 ? "99+" : String(n);
  }
}
function ensureHooks() {
  if (!subscribed) {
    const l = logApi();
    if (l?.subscribe) { subscribed = true; l.subscribe("*", (info) => { if (info?.actorId) refreshBadge(info.actorId); }); }
  }
  if (!closeHooked) {
    closeHooked = true;
    Hooks.on("closeApplicationV2", (app) => {
      const id = app?.teamId; if (typeof id !== "string") return;
      const rec = VIEWS.get(id); if (rec) { rec.view.destroy(); VIEWS.delete(id); }
    });
  }
}

/* ------------------------------------------------------------------ mounting */
function attach(ctx, host, panel) {
  const actor = game.actors.get(ctx.team.id);
  if (!actor || !LIB) return;
  let rec = VIEWS.get(actor.id);
  if (rec && (rec.view.destroyed || rec.uuid !== actor.uuid)) { try { rec.view.destroy(); } catch { /* gone */ } rec = null; }
  if (!rec) {
    const src = LIB.actorSource(actor);
    const view = new LIB.LogView(src, LIB.stateFor(src.key), {
      scroller: host,
      onShown: () => { setSeen(actor); refreshBadge(actor.id); },
      onChanged: (v) => { if (v.visible) setSeen(actor); refreshBadge(actor.id); }
    });
    rec = { view, uuid: actor.uuid };
    VIEWS.set(actor.id, rec);
  }
  rec.view.attach(host, { scroller: host });
  // a short tab (small window, wrapped header) cannot afford a sticky toolbar of up to 170px: below 330px of height it scrolls away with the list
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => { host.dataset.short = host.clientHeight && host.clientHeight < 330 ? "1" : ""; }).observe(host);
}

export const log = {
  id: ID,
  icon: "fa-solid fa-clock-rotate-left",
  render(_ctx) {
    return `<div class="ipl-host" data-ipl="base"><p class="ipl-host-wait" role="status">${esc(trl("IPL.Host.Wait", "Loading the log..."))}</p></div>`;
  },
  mount(ctx, root) {
    const host = root.querySelector(".ipl-host");
    if (!host) return;
    ensureHooks();
    const fail = () => { host.replaceChildren(Object.assign(document.createElement("p"), { className: "ipl-host-wait", textContent: trl("IPL.Host.Missing", "The activity log is not available.") })); };
    if (LIB) { attach(ctx, host, root); return; }
    loadLib().then((lib) => { if (!lib) return fail(); if (host.isConnected) attach(ctx, host, root); });
  },
  badge(ctx) {
    ensureHooks();
    const actor = game.actors.get(ctx.team.id); if (!actor) return "";
    if (VIEWS.get(actor.id)?.view?.visible) return "";
    const n = countUnseen(actor);
    return n ? (n > 99 ? "99+" : n) : "";
  }
};
export default log;
