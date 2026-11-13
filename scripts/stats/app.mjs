/* Plus Ultra STATISTICS, the window (ApplicationV2, one per client, id ipu-stats; styles/stats.css). Plain DOM like the session panel: the
   model (model.mjs) is rebuilt from the store when something changed and the content is drawn again (a few dozen nodes), at most once per
   animation frame. The window reads; only the GM's "delete this fight" writes (through the store's writer queue on the GM's own client).
   Tabs: characters, players, fights (icon buttons, their names in the tooltips); the period (session / all time) and, for the GM, heroes /
   NPCs. FIGHT SECTIONS (the next package, titles): api.stats.fightSections.push(fn) adds a renderer under a fight's summary:
     fn({ rec, rows, titles, gm, t }) -> HTMLElement | null      rec = the fight record as this viewer may see it (pure.newFight shape; a
     player's copy has no hidden participant), rows = pure.fightSummary rows, titles = rec.titles already filtered for this viewer. */
import * as Store from "./store.mjs";
import * as M from "./model.mjs";
import { t } from "./lang.mjs";
import { fightSection, collectedStrip } from "./titles-ui.mjs";

const MOD = Store.MOD;
const ID = "ipu-stats";
const { ApplicationV2 } = foundry.applications.api;
export const fightSections = [fightSection];      // AWRD: the titles of the fight (titles-ui.mjs) are the first section
let TL = null;      // the tactical strings (action, stunt and attribute names), loaded on first open
const ui0 = { tab: "chars", period: "session", side: "h", sel: { chars: null, players: null, fights: null } };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === null || v === undefined || v === false) continue; if (k === "class") el.className = v; else if (k === "text") el.textContent = v; else el.setAttribute(k, v === true ? "" : String(v)); }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};
const icon = (fa) => h("i", { class: `fa-solid ${fa}`, "aria-hidden": "true" });
const tl = (key, fb) => { try { const s = TL?.t?.(key, {}, null); return s ?? fb; } catch { return fb; } };
const names = {
  t,
  attr: (id) => tl(`ITAC.ui.attr.${id}`, id),
  action: (id) => tl(`ITAC.action.${id}`, null) ?? tl(`ITAC.ui.rx.${id}`, null) ?? (id === "block" ? (game.i18n.lang === "pl" ? "Blok" : "Block") : id === "dodge" ? (game.i18n.lang === "pl" ? "Unik" : "Dodge") : id),
  stunt: (id) => tl(`ITAC.stunt.${id}`, id),
  out: (id) => t(`IPU.Stats.out.${id}`),
  user: (id) => game.users.get(id)?.name ?? null,
  players: () => game.users.filter((u) => !u.isGM).map((u) => ({ id: u.id, name: u.name, avatar: u.avatar || u.character?.img || null })),
  when: (ms) => { try { return new Date(ms).toLocaleString(game.i18n.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return ""; } }
};
const viewer = () => ({ gm: !!game.user?.isGM, id: game.user?.id ?? null });
const TAB_ICON = { chars: "fa-mask", players: "fa-user", fights: "fa-hand-fist" };

export class StatsApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: ID, classes: ["invincible-plus-ultra", "ipu-st-app"], tag: "div",
    window: { icon: "fa-solid fa-chart-simple", resizable: true, contentClasses: ["ipu-st-content"] },
    position: { width: 760, height: 600 }
  };
  static async open(o = {}) {
    if (!TL) TL = await import("../tactics/lang.mjs").catch(() => ({}));
    if (o.tab && M.TABS.includes(o.tab)) ui0.tab = o.tab;
    const was = foundry.applications.instances.get(ID);
    if (was) { if (was.minimized) await was.maximize?.(); was.bringToFront?.(); await was.render({ force: true }); return was; }
    const app = new StatsApp();
    await app.render({ force: true });
    return app;
  }
  #root = null; #unsub = null; #raf = 0; #key = "";
  constructor(options = {}) {
    options.position = { ...(options.position ?? {}) };
    options.position.width ??= Math.max(360, Math.min(780, window.innerWidth - 40));
    options.position.height ??= Math.max(420, Math.min(640, window.innerHeight - 60));
    super(options);
  }
  get title() { return t("IPU.Stats.title"); }
  async _prepareContext() { return {}; }
  async _renderHTML() {
    if (!this.#root) { this.#root = h("div", { class: "ipu-st ipu-on-ink", "data-tooltip-class": "ipu-tip" }); this.#root.addEventListener("click", (e) => this.#click(e)); }
    this.#paint(true);
    return this.#root;
  }
  _replaceHTML(result, content) { if (!content.contains(result)) content.replaceChildren(result); }
  _onFirstRender(c, o) { super._onFirstRender?.(c, o); this.#unsub = Store.subscribe(() => this.#want()); }
  _onClose(o) { super._onClose?.(o); this.#unsub?.(); this.#unsub = null; cancelAnimationFrame(this.#raf); }
  #want() { cancelAnimationFrame(this.#raf); this.#raf = requestAnimationFrame(() => this.#paint()); }

  #click(e) {
    const b = e.target.closest?.("[data-act]");
    if (!b || !this.#root.contains(b) || b.getAttribute("aria-disabled") === "true") return;
    const act = b.dataset.act, v = b.dataset.v;
    if (act === "tab") ui0.tab = v;
    else if (act === "period") ui0.period = v;
    else if (act === "side") { ui0.side = v; ui0.sel.chars = null; }
    else if (act === "sel") ui0.sel[ui0.tab] = v;
    else if (act === "delFight") return this.#deleteFight(v);
    this.#paint(true);
    if (act === "sel") this.#root.querySelector(`.ipu-st-rail [data-v="${CSS.escape(v)}"]`)?.focus();
  }
  async #deleteFight(f) {
    if (!game.user?.isGM) return;
    const rec = Store.all().fights[f]; if (!rec) return;
    const yes = await foundry.applications.api.DialogV2.confirm({ window: { title: t("IPU.Stats.fight.delete") }, content: `<p>${esc(t("IPU.Stats.fight.deleteAsk", { when: names.when(rec.t0) }))}</p>`, rejectClose: false, modal: true });
    if (!yes) return;
    if (Store.isWriter()) { Store.dropFight(f); await Store.settle(); }
    else ui.notifications?.warn("The active GM's client keeps the statistics.");
    ui0.sel.fights = null;
    this.#paint(true);
  }

  #paint(force = false) {
    if (!this.#root) return;
    const data = Store.all(), vw = viewer();
    const key = `${Store.ver()}|${ui0.tab}|${ui0.period}|${ui0.side}|${ui0.sel[ui0.tab]}|${game.i18n.lang}`;
    if (!force && key === this.#key) return;
    this.#key = key;
    const vm = M.view(data, vw, { ...ui0, sel: ui0.sel[ui0.tab] }, names);
    const scroll = this.#root.querySelector(".ipu-st-detail")?.scrollTop ?? 0, rs = this.#root.querySelector(".ipu-st-rail")?.scrollTop ?? 0;
    this.#root.replaceChildren(this.#head(vm), this.#body(vm));
    const d = this.#root.querySelector(".ipu-st-detail"); if (d) d.scrollTop = scroll;
    const r = this.#root.querySelector(".ipu-st-rail"); if (r) r.scrollTop = rs;
  }
  #head(vm) {
    const seg = (act, items, label) => h("div", { class: "ipu-st-seg", role: "group", "aria-label": label },
      items.map(([v, fa, name, on]) => h("button", { type: "button", class: "ipu-ic", "data-act": act, "data-v": v, "aria-pressed": on ? "true" : "false", "aria-label": name, "data-tooltip": name }, icon(fa))));
    return h("div", { class: "ipu-st-head ipu-on-ink" },
      h("div", { class: "ipu-st-tabs", role: "tablist", "aria-label": t("IPU.Stats.title") },
        vm.tabs.map((x) => h("button", { type: "button", role: "tab", class: "ipu-st-tab", "data-act": "tab", "data-v": x.id, "aria-selected": x.on ? "true" : "false", "data-tooltip": x.label, "aria-label": x.label }, icon(TAB_ICON[x.id]), h("span", { class: "ipu-st-tab-l", text: x.label })))),
      h("div", { class: "ipu-st-tools" },
        vm.gm && vm.tab === "chars" ? seg("side", [["h", "fa-mask", t("IPU.Stats.side.h"), vm.side === "h"], ["n", "fa-skull", t("IPU.Stats.side.n"), vm.side === "n"]], t("IPU.Stats.side.h")) : null,
        vm.tab !== "fights" ? seg("period", [["session", "fa-calendar-day", `${t("IPU.Stats.period.session")}`, vm.period === "session"], ["all", "fa-infinity", t("IPU.Stats.period.all"), vm.period === "all"]], t("IPU.Stats.period.tip")) : null,
        vm.gm ? h("span", { class: "ipu-st-gm", "data-tooltip": t("IPU.Stats.gmOnly"), "aria-label": t("IPU.Stats.gmOnly"), role: "img" }, icon("fa-eye")) : null));
  }
  #body(vm) {
    if (vm.empty) return h("div", { class: "ipu-st-body ipu-st-empty" }, h("p", { text: vm.empty }));
    const rail = h("div", { class: "ipu-st-rail", role: "listbox", "aria-label": vm.tabs.find((x) => x.on)?.label ?? "" },
      vm.rail.map((x) => h("button", { type: "button", role: "option", class: "ipu-st-pick", "data-act": "sel", "data-v": x.id, "aria-selected": x.sel ? "true" : "false" },
        vm.tab === "fights" ? h("span", { class: "ipu-st-date" }, x.when) : avatar(x.img, x.name),
        h("span", { class: "ipu-st-pick-n" }, h("b", { text: x.name }), vm.tab === "fights" ? h("small", { text: x.sub }) : h("small", { class: "ipu-st-kdmini", text: `${x.kd.k}/${x.kd.d}/${x.kd.a}` })))));
    const detail = h("div", { class: "ipu-st-detail" }, vm.tab === "fights" ? this.#fight(vm) : this.#entry(vm));
    return h("div", { class: "ipu-st-body" }, rail, detail);
  }
  #entry(vm) {
    const d = vm.detail;
    const kd = h("div", { class: "ipu-st-kd", role: "img", "aria-label": `${t("IPU.Stats.kd")}: ${d.kd.k} ${t("IPU.Stats.m.kills")}, ${d.kd.d} ${t("IPU.Stats.m.deaths")}, ${d.kd.a} ${t("IPU.Stats.m.assists")}`, "data-tooltip": t("IPU.Stats.kd.tip") },
      h("span", { class: "ipu-st-kd-l", text: t("IPU.Stats.kd") }), h("b", { text: `${d.kd.k}/${d.kd.d}` }), h("span", { class: "ipu-st-kd-a", text: `+${d.kd.a}` }), h("span", { class: "ipu-st-kd-r", text: (Math.round(d.kd.ratio * 10) / 10).toFixed(1) }));
    const head = h("div", { class: "ipu-st-who" }, avatar(d.img, d.name, "big"), h("div", { class: "ipu-st-who-t" }, h("h2", { class: "ipu-plate", text: d.name }), d.sub ? h("p", { text: d.sub }) : null), kd);
    const col = (m, fa) => h("th", { scope: "col", "data-tooltip": t(`IPU.Stats.col.${m}.tip`) }, icon(fa), h("span", { text: t(`IPU.Stats.col.${m}`) }));
    const table = h("table", { class: "ipu-st-table" },
      h("thead", {}, h("tr", {}, h("td", {}), col("t", "fa-chess-knight"), col("l", "fa-dice"), col("s", "fa-plus"))),
      d.groups.map((g) => h("tbody", {}, h("tr", { class: "ipu-st-g" }, h("th", { scope: "rowgroup", colspan: "4", text: g.title })),
        g.rows.map((r) => h("tr", {}, h("th", { scope: "row", "data-tooltip": r.tip }, r.label),
          r.cells.map((c, i) => (c === null ? h("td", { class: "ipu-st-na", "data-tooltip": t("IPU.Stats.dash.tip"), "aria-label": t("IPU.Stats.dash.tip") }, "–") : h("td", { class: i === 2 ? "ipu-st-sum" : null, "data-zero": /^0(\/0)?$/.test(c) ? "1" : null }, c))))))));
    const chips = d.chips.map((c) => h("div", { class: "ipu-st-chips" }, h("span", { class: "ipu-st-chips-t", text: c.title }), c.items.map((x) => h("span", { class: "ipu-chip" }, x.label, h("b", { text: String(x.n) })))));
    return [head, collectedStrip(d.titles, t), table, ...chips].filter(Boolean);      // AWRD: the titles collected, under the name
  }
  #fight(vm) {
    const d = vm.detail, out = [];
    out.push(h("div", { class: "ipu-st-who" }, h("div", { class: "ipu-st-who-t" }, h("h2", { class: "ipu-plate", text: d.name }), h("p", { text: `${d.when} · ${d.sub}` })),
      vm.gm ? h("button", { type: "button", class: "ipu-ic", "data-kind": "danger", "data-act": "delFight", "data-v": d.id, "aria-label": t("IPU.Stats.fight.delete"), "data-tooltip": t("IPU.Stats.fight.delete") }, icon("fa-trash")) : null));
    const cols = ["dealt", "hits", "taken", "stress", "kd"];
    out.push(h("table", { class: "ipu-st-table ipu-st-fight" },
      h("thead", {}, h("tr", {}, h("td", {}), cols.map((c) => h("th", { scope: "col", text: t(`IPU.Stats.fight.col.${c}`) })))),
      h("tbody", {}, d.rows.map((r) => h("tr", { "data-side": r.s },
        h("th", { scope: "row" }, h("span", { class: "ipu-st-fwho" }, avatar(r.i, r.n), h("span", { text: r.n }), r.outLabel ? h("span", { class: "ipu-st-out", "data-out": r.out, "data-tooltip": r.outLabel, "aria-label": r.outLabel, role: "img" }, icon(r.out === "dead" ? "fa-skull" : r.out === "unconscious" ? "fa-bed" : "fa-heart-crack")) : null)),
        h("td", {}, String(r.dealt)), h("td", {}, r.attacks ? `${r.hits}/${r.attacks}` : "0"), h("td", {}, String(r.taken)), h("td", {}, String(r.stress)), h("td", {}, String(r.kills + r.minions)))))));
    /* the place of the titles (next package): a section the registered renderers fill; without one, the stored titles as plain chips */
    const sec = h("section", { class: "ipu-st-titles", "data-fight": d.id, "aria-label": t("IPU.Stats.fight.titles") });
    for (const fn of fightSections) { try { const el = fn({ rec: d.rec, rows: d.rows, titles: d.titles, gm: vm.gm, t }); if (el instanceof HTMLElement) sec.append(el); } catch (e) { console.warn(`${MOD} | stats fight section`, e); } }
    if (!fightSections.length && d.titles.length) sec.append(h("div", { class: "ipu-st-chips" }, h("span", { class: "ipu-st-chips-t", text: t("IPU.Stats.fight.titles") }), d.titles.map((x) => h("span", { class: "ipu-chip" }, String(x.id), x.c ? h("b", { text: d.rows.find((r) => r.cid === x.c)?.n ?? "" }) : null))));
    out.push(sec);
    return out;
  }
}
function avatar(img, name, size = "") {
  const box = h("span", { class: `ipu-st-av ${size}`.trim(), "aria-hidden": "true" });
  if (img) { const i = h("img", { src: img, alt: "", loading: "lazy" }); i.addEventListener("error", () => { i.remove(); box.textContent = [...String(name ?? "?")][0]?.toUpperCase() ?? "?"; }); box.append(i); }
  else box.textContent = [...String(name ?? "?")][0]?.toUpperCase() ?? "?";
  return box;
}
export const open = (o) => StatsApp.open(o);
