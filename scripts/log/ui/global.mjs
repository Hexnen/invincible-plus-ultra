/* Activity log UI: the GM-only TABLE LOG window (spec 6.4, phase L6). ApplicationV2 with a hand-built DOM, two sections in a tablist:
     Timeline     the shared LogView over a MERGED source (every hero, base and orphan log; actor chips; search / filters / export reuse)
     Maintenance  health, limits and the per-log manage rows (ui/maint-view.mjs)
   Opened from the module settings menu ("Table log"), a button in the Actors directory header (with an unseen badge), an optional unbound keybinding and
   api.log.open("all", {filters}). Staff only: a player gets a warning and nothing opens. The window never writes by itself. */
import * as E from "../events.mjs";
import * as X from "../export.mjs";
import * as Store from "../store.mjs";
import { t, tn } from "../lang.mjs";
import { h, icon, uid } from "./dom.mjs";
import * as R from "./rows.mjs";
import { LogView, stateFor } from "./view.mjs";
import { MaintView } from "./maint-view.mjs";

const MOD = E.MOD_ID;
const ID = "ipl-table-log";
const { ApplicationV2 } = foundry.applications.api;
const isStaff = (u = game.user) => !!u && (u.isGM === true || u.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);
const logApi = () => game.modules.get(MOD)?.api?.log ?? null;
const offsetMin = () => -new Date().getTimezoneOffset();

/* ------------------------------------------------------------------ the merged source */
export function tableSource() {
  const deco = new WeakMap();           // original entry -> decorated copy (keeps the search-blob cache of filter.mjs warm across rebuilds)
  const aidOf = new Map();
  let merged = null, names = new Map(), metas = [];
  const rebuild = () => {
    metas = Store.listLogJournals(); names = new Map(metas.map((m) => [m.actorId, m.name]));
    const all = []; aidOf.clear();
    for (const m of metas) {
      for (const e of Store.readEntries(m.actorId, { secret: true })) {
        let d = deco.get(e); if (!d) { d = { ...e, aid: m.actorId, sc: m.scope }; deco.set(e, d); }
        aidOf.set(e.id, m.actorId); all.push(d);
      }
    }
    all.sort((a, b) => (a.t - b.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    merged = all;
  };
  const L = () => logApi();
  const exportCtx = (ctx) => ({
    actors: Object.fromEntries(metas.map((m) => [m.actorId, { id: m.actorId, name: m.name, uuid: m.uuid, type: m.scope }])), exportedAt: Date.now(), exportedBy: game.user.name,
    users: Object.fromEntries(game.users.map((u) => [u.id, u.name])), title: "table-log", text: (e) => R.sentenceText(e, ctx, { kid: true }), labels: { gmOnly: t("IPL.UI.GmOnly") }, offsetMin: offsetMin()
  });
  return {
    key: "table", scope: "all", get name() { return t("IPL.Table.Title"); }, actor: null,
    facets: () => { if (!merged) rebuild(); return metas.map((m) => ({ id: m.actorId, label: m.name, scope: m.scope, orphan: m.orphan })); },
    nameOf: (id) => names.get(id) ?? "",
    read() { if (!merged) rebuild(); return { entries: merged, total: merged.length, canSee: isStaff(), access: "gm" }; },
    enabled: () => Store.enabled(),
    canNote: () => false, canGm: () => isStaff(),
    note: async () => null,
    // L7-15: the row knows which log it belongs to (ids are only unique per log), so the actor id comes from the clicked row, not from a global id map
    annotate: (id, text, aid) => { const a = aid || aidOf.get(id); return a ? L().annotate(a, id, text) : null; },
    redact: (id, aid) => { const a = aid || aidOf.get(id); return a ? L().redact(a, [id]) : null; },
    subscribe: (fn) => Store.subscribe((info) => { merged = null; fn(info); }),
    hasScribe: () => !!game.users.activeGM,
    queued: () => 0,
    exportAll: (fmt, ctx) => { if (!merged) rebuild(); return X.exportMerged(merged, fmt, exportCtx(ctx)); },
    exportEntries: (list, fmt, ctx) => { if (!merged) rebuild(); return X.exportMerged(list, fmt, exportCtx(ctx)); }
  };
}

/* ------------------------------------------------------------------ unseen badge */
const seenKey = () => `ipl-seen:${game.user?.id}:table`;
export function unseenCount() {
  try {
    if (!isStaff()) return 0;
    let since = Number(localStorage.getItem(seenKey()));
    if (!since) { localStorage.setItem(seenKey(), String(Date.now())); return 0; }
    let n = 0;
    for (const m of Store.listLogJournals()) for (const e of Store.readEntries(m.actorId, { secret: true })) if (e.t > since && e.u !== game.user.id && !e.h && E.severityOf(e.k) > 0) n++;
    return n;
  } catch { return 0; }
}
const markSeen = () => { try { localStorage.setItem(seenKey(), String(Date.now())); } catch { /* private window */ } };

/** renderActorDirectory: the GM-only "Table log" button with the unseen badge. */
export function decorateDirectory(app, html) {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
    const actions = root?.querySelector?.(".directory-header .header-actions");
    if (!actions) return;
    let btn = actions.querySelector(".ipl-dir-log");
    if (!isStaff() || !Store.enabled() && !game.user.isGM) { btn?.remove(); return; }
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button"; btn.className = "ipl-dir-log";
      btn.addEventListener("click", (ev) => { ev.preventDefault(); TableLogApp.open(); });
      actions.append(btn);
    }
    const n = unseenCount();
    btn.dataset.tooltip = t("IPL.Table.OpenTip");
    btn.replaceChildren(Object.assign(document.createElement("i"), { className: "fa-solid fa-clock-rotate-left" }), Object.assign(document.createElement("span"), { textContent: t("IPL.Table.Title") }));
    btn.firstChild.setAttribute("aria-hidden", "true");
    btn.setAttribute("aria-label", n ? `${t("IPL.Table.Title")}, ${t("IPL.Table.OpenBadge", { n: n > 99 ? "99+" : n })}` : t("IPL.Table.Title"));
    if (n) { const b = document.createElement("span"); b.className = "ipl-dir-badge"; b.setAttribute("aria-hidden", "true"); b.textContent = n > 99 ? "99+" : String(n); btn.append(b); }
  } catch (e) { console.warn(`${MOD} | log: directory button failed`, e); }
}
export function refreshDirectory() { try { ui.actors?.render?.(); } catch { /* sidebar not ready */ } }

/* ------------------------------------------------------------------ the window */
export class TableLogApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: ID, classes: ["invincible-plus-ultra", "ipl-app"], tag: "div",
    window: { icon: "fa-solid fa-clock-rotate-left", resizable: true, contentClasses: ["ipl-table-content"] },
    position: { width: 940, height: 720 }
  };
  /** The settings-menu button builds a new instance every time: a second window with the same id is never opened, the open one is raised instead. */
  async render(options, ...rest) {
    if (!isStaff()) { ui.notifications?.warn(t("IPL.Table.Closed")); return this; }
    const existing = foundry.applications.instances.get(ID);
    if (existing && existing !== this) { existing.bringToFront?.(); return existing.render(options, ...rest); }
    return super.render(options, ...rest);
  }
  /** Open (or raise) the window. opts: {tab: "timeline"|"maintenance", filters: {...view filters}, actor: id}. */
  static async open(opts = {}) {
    if (!isStaff()) { ui.notifications?.warn(t("IPL.Table.Closed")); return null; }
    let app = foundry.applications.instances.get(ID);
    if (!app) app = new TableLogApp();
    await app.render({ force: true });
    app.show(opts);
    return app;
  }
  get title() { return t("IPL.Table.Title"); }

  #root = null; #view = null; #maint = null; #tab = "timeline"; #id = uid("ipt");
  async _prepareContext() { return {}; }
  async _renderHTML() { return (this.#root ??= this.#build()); }
  _replaceHTML(result, content) { if (!content.contains(result)) content.replaceChildren(result); }
  _onFirstRender() { markSeen(); }
  _onRender(context, options) { super._onRender?.(context, options); this.#select(this.#tab, false); this.#view?.show(); markSeen(); refreshDirectory(); }
  _onClose() { this.#view?.destroy(); this.#maint?.destroy(); this.#view = this.#maint = null; this.#root = null; markSeen(); refreshDirectory(); }

  /** Apply a tab and/or filters from outside. */
  show({ tab, filters, actor } = {}) {
    if (tab) this.#select(tab === "maintenance" ? "maintenance" : "timeline", true);
    const f = { ...(filters ?? {}) };
    if (actor) f.actors = [actor];
    if (Object.keys(f).length) { this.#select("timeline", false); this.#view?.applyFilters(f); }
  }

  #build() {
    const id = this.#id;
    const mk = (key, label, ic) => h("button.ipl-btn.ipl-ttab", { type: "button", role: "tab", id: `${id}-tab-${key}`, "aria-controls": `${id}-pane-${key}`, "aria-selected": "false", tabindex: "-1", "data-tab": key }, icon(ic), h("span", label));
    const tabs = h("nav.ipl.ipl-ttabs", { role: "tablist", "aria-label": t("IPL.Table.TabsAria") }, mk("timeline", t("IPL.Table.TabTimeline"), "fa-timeline"), mk("maintenance", t("IPL.Table.TabMaint"), "fa-screwdriver-wrench"));
    tabs.addEventListener("click", (ev) => { const b = ev.target.closest("[data-tab]"); if (b) this.#select(b.dataset.tab, true); });
    tabs.addEventListener("keydown", (ev) => {
      const order = ["timeline", "maintenance"], i = order.indexOf(this.#tab);
      const next = ev.key === "ArrowRight" ? order[(i + 1) % 2] : ev.key === "ArrowLeft" ? order[(i + 1) % 2] : ev.key === "Home" ? order[0] : ev.key === "End" ? order[1] : null;
      if (next) { ev.preventDefault(); this.#select(next, true); this.#root.querySelector(`[data-tab="${next}"]`).focus(); }
    });
    const pane = (key) => h("div.ipl-tpane", { role: "tabpanel", id: `${id}-pane-${key}`, "aria-labelledby": `${id}-tab-${key}`, "data-pane": key, hidden: key !== this.#tab });
    return h("div.ipl-t", { "data-tab": this.#tab }, tabs, pane("timeline"), pane("maintenance"));
  }
  #select(key, focus) {
    this.#tab = key;
    const root = this.#root; if (!root) return;
    root.dataset.tab = key;
    for (const b of root.querySelectorAll("[data-tab]")) { const on = b.dataset.tab === key; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; }
    for (const p of root.querySelectorAll("[data-pane]")) p.hidden = p.dataset.pane !== key;
    if (key === "timeline") {
      const host = root.querySelector('[data-pane="timeline"]');
      if (!this.#view) {
        const src = tableSource();
        this.#view = new LogView(src, stateFor("table"), { scroller: host, onChanged: () => this.#markIfVisible() });
        this.#view.attach(host, { scroller: host });
      } else this.#view.show();
    } else {
      const host = root.querySelector('[data-pane="maintenance"]');
      if (!this.#maint) { this.#maint = new MaintView({ onShow: (aid) => this.show({ tab: "timeline", actor: aid }) }); host.replaceChildren(this.#maint.el); }
      else this.#maint.paint();
    }
    if (focus) root.querySelector(`[data-pane="${key}"]`)?.scrollTo?.(0, 0);
  }
  #markIfVisible() { if (this.rendered && this.#tab === "timeline") markSeen(); }
}

export function openTable(opts) { return TableLogApp.open(opts); }
