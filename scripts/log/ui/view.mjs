/* Activity log UI: the shared LOG VIEW (spec 6.1). Plain DOM, one instance per mounted tab, driven by a SOURCE object so the hero tab (L4), the base tab (L5)
   and the Table log window (L6) reuse it with a different scope:
     source = { key, scope: "hero"|"base", actor?, name, read() -> {entries, canSee, access}, enabled(), canNote(), canGm(), note(text, {gmOnly}),
                annotate(id, text), redact(id), subscribe(fn) -> unsubscribe, hasScribe(), exportAll(fmt), exportEntries(list, fmt) }
   `actorSource(actor)` builds one from api.log. View state (filters, density, expanded rows, scroll) lives in a STATE object kept per source key by the caller
   (`stateFor`), so a re-render of the host sheet never loses it. The view never writes anything itself: notes go through source.note (relay), annotate and
   redact through source.annotate / source.redact. Secrecy note: GM-only rows are hidden by this interface, they are NOT protected by it. */
import * as E from "../events.mjs";
import * as F from "../filter.mjs";
import { t, tn } from "../lang.mjs";
import { h, icon, sr, uid, append } from "./dom.mjs";
import * as R from "./rows.mjs";

const MOD = E.MOD_ID;
const PAGE = 80;
const reduced = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
const logApi = () => globalThis.game?.modules?.get(MOD)?.api?.log ?? null;
const offsetMin = () => -new Date().getTimezoneOffset();

/* ------------------------------------------------------------------ client settings (density, minor) */
function clientSetting(key, fallback) { try { return game.settings.get(MOD, key); } catch { return fallback; } }
function setClient(key, value) { try { game.settings.set(MOD, key, value); } catch { /* not registered */ } }

/* ------------------------------------------------------------------ persisted view state (per source key) */
const STATES = new Map();
export function stateFor(key) {
  let s = STATES.get(key);
  if (!s) {
    s = { cats: [], users: [], actors: [], actorsAll: false, preset: "all", fromStr: "", toStr: "", roundFrom: null, roundTo: null, search: "", showMinor: clientSetting("logShowMinor", false) === true,
      onlyMine: false, density: clientSetting("logDensity", "compact") === "detailed" ? "detailed" : "compact", filtersOpen: false, toggled: new Set(), scrollTop: 0, limit: PAGE };
    STATES.set(key, s);
  }
  return s;
}
export const dropState = (key) => STATES.delete(key);

/* ------------------------------------------------------------------ sources */
export function actorSource(actor) {
  const scope = actor.flags?.[MOD]?.base?.kind === "teamBase" ? "base" : "hero";
  const L = () => logApi();
  const users = () => Object.fromEntries(game.users.map((u) => [u.id, u.name]));
  const exportCtx = (ctx) => ({
    actor: { id: actor.id, name: actor.name, uuid: actor.uuid, type: scope }, exportedAt: Date.now(), exportedBy: game.user.name, users: users(), scope,
    text: (e) => R.sentenceText(e, ctx, { kid: true }), labels: { gmOnly: t("IPL.UI.GmOnly") }, offsetMin: offsetMin()
  });
  return {
    key: actor.uuid, scope, actor, get name() { return actor.name; },
    read() {
      const l = L(); if (!l) throw new Error("api.log is not available");
      const r = l.read(actor);
      // display rule (not security): a type that is GM-only by definition never shows to a non-GM, even if it was stored in the public journal
      if (!game.user.isGM && r.entries.some((e) => E.visibilityOf(e) === "G")) { const entries = r.entries.filter((e) => E.visibilityOf(e) !== "G"); return { ...r, entries, total: entries.length }; }
      return r;
    },
    enabled: () => L()?._internal?.Store?.enabled?.() !== false,
    canNote: () => !!L()?.canNote?.(actor),
    canGm: () => !!game.user.isGM,
    note: (text, o) => L().note(actor, text, o),
    annotate: (id, text) => L().annotate(actor, id, text),
    redact: (id) => L().redact(actor, [id]),
    subscribe: (fn) => L().subscribe(actor, fn),
    hasScribe: () => !!game.users.activeGM,
    queued: () => (game.user.isGM ? 0 : (L()?.queue?.().n ?? 0)),
    exportAll: (fmt, ctx) => L().export(actor, { format: fmt, all: true, ...exportCtx(ctx) }),
    exportEntries: (list, fmt, ctx) => L().pure.X.exportEntries(list, fmt, exportCtx(ctx))
  };
}

/* ------------------------------------------------------------------ the view */
export class LogView {
  #ro = null; #unsub = null; #timer = null; #changeTimer = null; #io = null; #hooks = []; #seq = 0;
  constructor(source, state, opts = {}) {
    this.src = source; this.s = state; this.o = opts;
    this.id = uid("ipl");
    this.scroller = opts.scroller ?? null;
    this.data = { entries: [], canSee: true, access: "gm", error: null, loaded: false };
    this.known = new Set(); this.notesOn = new Map();
    this.filtered = []; this.counts = { all: 0, cats: {} };
    this.fresh = new Set(); this.pending = 0; this.cursor = 0; this.plan = []; this.cur = null; this.rowsDone = 0;
    this.destroyed = false; this.dirty = false;
    this.ctx = {
      scope: source.scope, isGM: source.canGm(),
      userName: (id) => (id ? (game.users.get(id)?.name ?? t("IPL.UI.UnknownUser")) : t("IPL.UI.System")),
      showActor: !!source.facets,                                       // merged Table log: every row names its actor
      actorName: (id) => source.nameOf?.(id) ?? "",
      actor: (e) => (e?.aid ? (game.actors.get(e.aid) ?? null) : (source.actor ?? null)),
      lookupMessage: (id) => !!game.messages?.get(id),
      notesOn: this.notesOn
    };
    this.#build();
    this.#unsub = source.subscribe((info) => this.#onChange(info));
    for (const hk of ["userConnected", "updateUser", `${MOD}.logQueue`]) { const fn = () => this.#renderBanner(); Hooks.on(hk, fn); this.#hooks.push([hk, fn]); }
    { const fn = (setting) => { if (String(setting?.key ?? "").startsWith(`${MOD}.log`)) setTimeout(() => this.#load(false), 400); }; Hooks.on("updateSetting", fn); this.#hooks.push(["updateSetting", fn]); }   // switched off / read access changed
    this.#renderAll();
    setTimeout(() => { if (!this.destroyed) this.#load(true); }, 30);   // not rAF: a hidden browser tab never fires it
  }
  get root() { return this.el; }
  get visible() { return !!this.el.isConnected && this.el.offsetParent !== null; }

  /* ---------------------------------------------------------------- lifecycle */
  /** Put the view into a host element (the tab section). Idempotent. */
  attach(host, { scroller } = {}) {
    if (this.el.parentElement !== host) host.replaceChildren(this.el);
    this.scroller = scroller ?? host;
    this.scroller.removeEventListener("scroll", this.#onScroll);
    this.scroller.addEventListener("scroll", this.#onScroll, { passive: true });
    this.#observe();
    const top = this.s.scrollTop || 0;
    if (top) requestAnimationFrame(() => { if (this.scroller) this.scroller.scrollTop = top; });
    this.show();
  }
  /** The host became visible: catch up with changes made meanwhile. */
  show() {
    if (this.destroyed) return;
    if (this.dirty) { this.dirty = false; this.#load(false); }
    this.pending = 0; this.#renderPill();
    this.o.onShown?.(this);
  }
  destroy() {
    this.destroyed = true;
    this.#unsub?.(); this.#unsub = null;
    clearTimeout(this.#timer); clearTimeout(this.#changeTimer);
    this.#io?.disconnect(); this.#ro?.disconnect();
    this.scroller?.removeEventListener("scroll", this.#onScroll);
    for (const [hk, fn] of this.#hooks) Hooks.off(hk, fn);
    this.#hooks = [];
    this.el.remove();
  }
  /** Apply filters from outside (api.log.open): {cats, users, search, showMinor, preset, onlyMine}. */
  applyFilters(f = {}) {
    for (const k of ["cats", "users", "actors", "search", "showMinor", "preset", "onlyMine", "roundFrom", "roundTo", "fromStr", "toStr"]) if (k in f) this.s[k] = f[k];
    this.s.limit = PAGE; this.#syncControls(); this.#renderAll();
  }
  refresh() { this.#load(false); }

  /* ---------------------------------------------------------------- data */
  #load(first) {
    if (this.destroyed) return;
    let r;
    try { r = this.src.read(); this.data = { entries: r.entries ?? [], canSee: r.canSee !== false, access: r.access, error: null, loaded: true }; }
    catch (e) { console.warn(`${MOD} | log view: read failed`, e); this.data = { entries: [], canSee: true, access: "none", error: e, loaded: true }; }
    this.known = new Set(this.data.entries.map((e) => e.id));
    this.#indexNotes();
    if (first) this.o.onFirstLoad?.(this);
    this.#renderAll();
  }
  #indexNotes() {
    this.notesOn.clear();
    for (const e of this.data.entries) if (e.k === "note.gm" && e.d && e.d.on) { const a = this.notesOn.get(e.d.on) ?? []; a.push(e); this.notesOn.set(e.d.on, a); }
  }
  #onChange(info) {
    if (this.destroyed || this.#changeTimer) return;
    this.#changeTimer = setTimeout(() => { this.#changeTimer = null; this.#sync(); }, 250);
  }
  #sync() {
    if (this.destroyed) return;
    const prev = this.known;
    let r;
    try { r = this.src.read(); } catch (e) { this.data = { entries: [], canSee: true, error: e, loaded: true }; this.#renderAll(); return; }
    const added = r.entries.filter((e) => !prev.has(e.id));
    this.data = { entries: r.entries, canSee: r.canSee !== false, access: r.access, error: null, loaded: true };
    this.known = new Set(r.entries.map((e) => e.id));
    this.#indexNotes();
    if (!this.visible) { this.dirty = true; this.o.onChanged?.(this); return; }
    const f = this.#filterObj(), fc = this.#filterCtx();
    const news = added.filter((e) => F.matches(e, f, fc) && e.u !== game.user.id);
    if (!added.length || this.#atTop()) {
      this.fresh = new Set(added.map((e) => e.id));
      this.#renderAll({ keepScroll: true });
      if (news.length) this.#announce(tn("IPL.Plural.New", news.length));
      setTimeout(() => this.fresh.clear(), 700);
    } else {
      this.pending += news.length;
      this.#recompute(); this.#renderChrome(); this.#renderPill();
      if (news.length) this.#announce(tn("IPL.Plural.New", this.pending));
    }
    this.o.onChanged?.(this);
  }
  #atTop() { return !this.scroller || this.scroller.scrollTop < 12; }

  /* ---------------------------------------------------------------- filtering */
  #filterObj() {
    const s = this.s, now = Date.now(), off = offsetMin();
    let range = { from: null, to: null };
    if (s.preset === "today" || s.preset === "7days") range = F.datePreset(s.preset === "7days" ? "7days" : "today", now, this.data.entries, off);
    else if (s.preset === "lastSession") range = F.datePreset("lastSession", now, this.data.entries, off);
    else if (s.preset === "custom") {
      const a = s.fromStr ? new Date(`${s.fromStr}T00:00:00`).getTime() : null, b = s.toStr ? new Date(`${s.toStr}T23:59:59.999`).getTime() : null;
      range = { from: Number.isFinite(a) ? a : null, to: Number.isFinite(b) ? b : null };
    }
    return { cats: s.cats, users: s.users, actors: s.actors, from: range.from, to: range.to, roundFrom: s.roundFrom, roundTo: s.roundTo, search: s.search, showMinor: s.showMinor, onlyMine: s.onlyMine, includeHidden: false };
  }
  #filterCtx() { return { scope: this.src.scope, userId: game.user.id, users: Object.fromEntries(game.users.map((u) => [u.id, u.name])), textOf: (e) => R.sentenceText(e, this.ctx) + (e.aid ? ` ${this.ctx.actorName(e.aid)}` : "") }; }
  #recompute() {
    const f = this.#filterObj(), fc = this.#filterCtx();
    const raw = this.data.entries;
    this.filtered = F.filterEntries(raw, f, fc);
    this.counts = F.countsByCategory(raw, f, fc);
    this.actorCounts = this.src.facets ? F.countsByActor(raw, f, fc) : null;
    this.filterCount = this.#activeFilters();
  }
  #activeFilters() {
    const s = this.s;
    return (s.cats.length ? 1 : 0) + (s.actors.length ? 1 : 0) + (s.users.length ? 1 : 0) + (s.preset !== "all" ? 1 : 0) + (s.roundFrom != null || s.roundTo != null ? 1 : 0) + (s.search ? 1 : 0) + (s.showMinor ? 1 : 0) + (s.onlyMine ? 1 : 0);
  }
  /** Filters that narrow the view (the minor toggle widens it, so it does not count as "narrowing"). */
  #narrowing() { const s = this.s; return !!(s.cats.length || s.actors.length || s.users.length || s.preset !== "all" || s.roundFrom != null || s.roundTo != null || s.search || s.onlyMine); }
  #clearFilters() {
    Object.assign(this.s, { cats: [], actors: [], users: [], preset: "all", fromStr: "", toStr: "", roundFrom: null, roundTo: null, search: "", onlyMine: false, limit: PAGE });
    this.#syncControls(); this.#renderAll();
  }

  /* ---------------------------------------------------------------- build (static chrome) */
  #build() {
    const id = this.id;
    this.el = h("section.ipl", { "aria-label": t("IPL.UI.Region"), "data-density": this.s.density, "data-phase": "loading", dataset: { scope: this.src.scope } });
    this.el.addEventListener("click", (ev) => this.#onClick(ev));
    this.el.addEventListener("keydown", (ev) => this.#onKey(ev));
    this.el.append(h("h2.ipl-sr", t("IPL.UI.Region")));
    // search
    this.$search = h("input.ipl-input", { type: "search", id: `${id}-q`, placeholder: t("IPL.UI.SearchPh"), autocomplete: "off", spellcheck: "false", "aria-controls": `${id}-list`, value: this.s.search });
    this.$search.addEventListener("input", () => { clearTimeout(this.#timer); this.#timer = setTimeout(() => { this.s.search = this.$search.value.trim(); this.s.limit = PAGE; this.#renderAll({ announce: true }); }, 150); });
    const searchBox = h("div.ipl-search", h("label.ipl-sr", { for: `${id}-q` }, t("IPL.UI.Search")), icon("fa-magnifying-glass", "ipl-search-ico"), this.$search);
    // controls
    this.$filterBtn = h("button.ipl-btn", { type: "button", "aria-expanded": String(!!this.s.filtersOpen), "aria-controls": `${id}-fp`, "data-ipl-act": "filters" }, icon("fa-sliders"), h("span.ipl-lbl"), h("span.ipl-fcount", { "aria-hidden": "true" }));
    this.$dens = h("div.ipl-seg", { role: "group", "aria-label": t("IPL.UI.Density") },
      ["compact", "detailed"].map((m) => h("button.ipl-btn.ipl-seg-b", { type: "button", "data-ipl-act": "density", "data-ipl-id": m, title: t(m === "compact" ? "IPL.UI.Compact" : "IPL.UI.Detailed"), "aria-pressed": String(this.s.density === m) }, icon(m === "compact" ? "fa-bars" : "fa-list-ul"), h("span", t(m === "compact" ? "IPL.UI.Compact" : "IPL.UI.Detailed")))));
    this.$exportMenu = h("details.ipl-menu", h("summary.ipl-btn", { title: t("IPL.UI.Export") }, icon("fa-file-arrow-down"), h("span", t("IPL.UI.Export"))), h("div.ipl-menu-panel", { role: "group", "aria-label": t("IPL.UI.Export") }));
    this.$exportMenu.addEventListener("toggle", () => { if (this.$exportMenu.open) this.#fillExportMenu(); });
    this.$noteBtn = h("button.ipl-btn.ipl-primary", { type: "button", "data-ipl-act": "note", "aria-expanded": "false", "aria-controls": `${id}-note` }, icon("fa-pen-to-square"), h("span", t("IPL.UI.AddNote")));
    const row1 = h("div.ipl-row1", searchBox, h("div.ipl-ctl", this.$filterBtn, this.$dens, this.$exportMenu, this.$noteBtn));
    this.$chips = h("div.ipl-chips", { role: "group", "aria-label": t("IPL.UI.Categories") });
    this.$panel = h("div.ipl-fpanel", { id: `${id}-fp`, hidden: !this.s.filtersOpen });
    this.$count = h("p.ipl-count", { role: "status", "aria-live": "polite", "aria-atomic": "true" });
    this.$clear = h("button.ipl-linkbtn", { type: "button", "data-ipl-act": "clear", hidden: true }, t("IPL.UI.ClearFilters"));
    this.$live = h("p.ipl-sr", { role: "status", "aria-live": "polite", "aria-atomic": "true" });
    this.$panel.addEventListener("change", (ev) => this.#onFilterInput(ev));
    this.$actors = h("div.ipl-chips.ipl-actors", { role: "group", "aria-label": t("IPL.Table.Actors"), hidden: !this.src.facets });
    this.$row1 = row1;
    this.$bar = h("div.ipl-bar", row1, this.$chips, this.$actors);
    this.$status = h("div.ipl-status", this.$count, this.$clear);
    this.$banner = h("div.ipl-banner", { hidden: true, role: "note" }, icon("fa-plug-circle-xmark"), h("p", t("IPL.UI.NoScribe")));
    this.$note = h("form.ipl-note", { id: `${id}-note`, hidden: true });
    this.$note.addEventListener("submit", (ev) => { ev.preventDefault(); this.#submitNote(); });
    this.$pill = h("button.ipl-pill", { type: "button", hidden: true, "data-ipl-act": "pill" });
    this.$body = h("div.ipl-body", { id: `${id}-list` });
    this.el.append(this.$bar, this.$panel, this.$status, this.$banner, this.$note, h("div.ipl-pillwrap", this.$pill), this.$body, this.$live);
    this.#renderFilterPanel();
    if (typeof ResizeObserver !== "undefined") { this.#ro = new ResizeObserver(() => this.el.style.setProperty("--ipl-bar-h", `${this.$row1.offsetHeight}px`)); this.#ro.observe(this.$row1); }
  }

  #renderFilterPanel() {
    const id = this.id, s = this.s, p = this.$panel;
    p.replaceChildren();
    // person
    const users = F.usersOf(this.data.entries);
    const sel = h("select.ipl-input", { id: `${id}-u`, "data-ipl-f": "user" },
      h("option", { value: "" }, t("IPL.UI.Everyone")),
      users.map((u) => h("option", { value: u.id, selected: s.users[0] === u.id }, `${u.id ? this.ctx.userName(u.id) : t("IPL.UI.System")} (${u.n})`)));
    // when
    const presets = [["all", "IPL.UI.AnyTime"], ["today", "IPL.UI.Today"], ["lastSession", "IPL.UI.LastSession"], ["7days", "IPL.UI.Days7"]];
    const when = h("div.ipl-seg", { role: "group", "aria-label": t("IPL.UI.When") }, presets.map(([k, key]) => h("button.ipl-btn.ipl-seg-b", { type: "button", "data-ipl-act": "preset", "data-ipl-id": k, "aria-pressed": String(s.preset === k) }, t(key))));
    const from = h("input.ipl-input", { type: "date", id: `${id}-df`, value: s.fromStr, "data-ipl-f": "from" }), to = h("input.ipl-input", { type: "date", id: `${id}-dt`, value: s.toStr, "data-ipl-f": "to" });
    const rb = F.roundBounds(this.data.entries);
    const rf = h("input.ipl-input", { type: "number", min: rb?.min ?? 0, max: rb?.max ?? 99, id: `${id}-rf`, value: s.roundFrom ?? "", "data-ipl-f": "rfrom", inputmode: "numeric" });
    const rt = h("input.ipl-input", { type: "number", min: rb?.min ?? 0, max: rb?.max ?? 99, id: `${id}-rt`, value: s.roundTo ?? "", "data-ipl-f": "rto", inputmode: "numeric" });
    const field = (label, ctl, cls = "") => h("div.ipl-field", { class: cls }, h("label", { for: ctl.id }, label), ctl);
    const check = (key, label, hint, on) => h("label.ipl-check", h("input", { type: "checkbox", "data-ipl-f": key, checked: on }), h("span", label, hint && h("small", hint)));
    append(p, [
      field(t("IPL.UI.Person"), sel),
      h("div.ipl-field.ipl-when", h("span.ipl-flabel", t("IPL.UI.When")), when, h("div.ipl-dates", field(t("IPL.UI.From"), from), field(t("IPL.UI.To"), to))),
      rb && h("div.ipl-field.ipl-rounds", h("span.ipl-flabel", t("IPL.UI.Rounds")), h("div.ipl-dates", field(t("IPL.UI.RoundFrom"), rf), field(t("IPL.UI.RoundTo"), rt))),
      h("div.ipl-checks", check("minor", t("IPL.UI.ShowMinor"), t("IPL.UI.ShowMinorHint"), s.showMinor), check("mine", t("IPL.UI.OnlyMine"), "", s.onlyMine))
    ]);
  }
  #syncControls() {
    this.$search.value = this.s.search;
    this.$dens.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.iplId === this.s.density)));
    this.el.dataset.density = this.s.density;
    this.$panel.hidden = !this.s.filtersOpen;
    this.$filterBtn.setAttribute("aria-expanded", String(!!this.s.filtersOpen));
    this.#renderFilterPanel();
  }
  #onFilterInput(ev) {
    const el = ev.target, k = el.dataset?.iplF, s = this.s;
    if (!k) return;
    if (k === "user") s.users = el.value ? [el.value] : [];
    else if (k === "from") { s.fromStr = el.value; s.preset = el.value || s.toStr ? "custom" : "all"; }
    else if (k === "to") { s.toStr = el.value; s.preset = el.value || s.fromStr ? "custom" : "all"; }
    else if (k === "rfrom") s.roundFrom = el.value === "" ? null : Number(el.value);
    else if (k === "rto") s.roundTo = el.value === "" ? null : Number(el.value);
    else if (k === "minor") { s.showMinor = el.checked; setClient("logShowMinor", s.showMinor); }
    else if (k === "mine") s.onlyMine = el.checked;
    s.limit = PAGE;
    this.#renderAll({ announce: true, keepPanel: true });
  }

  /* ---------------------------------------------------------------- render */
  #renderAll(opts = {}) {
    if (this.destroyed) return;
    if (this.src.facets) this.ctx.showActor = this.s.actors.length !== 1;     // filtered to ONE actor: its name on every row is noise
    this.#recompute();
    this.#renderChrome(opts);
    this.#renderBody(opts);
    this.#renderBanner();
  }
  #phase() {
    if (!this.data.loaded) return "loading";
    if (this.data.error) return "error";
    if (!this.src.enabled()) return "off";
    if (!this.data.canSee) return "private";
    // nothing worth listing yet (no entries, or only minor / explained ones that the default view hides) = the first-use state, not "no match"
    if (!this.data.entries.length || (!this.filtered.length && !this.#narrowing() && !this.s.showMinor && this.data.entries.every((e) => e.h || E.severityOf(e.k) === 0))) return "empty";
    if (!this.filtered.length) return "nomatch";
    return "list";
  }
  #renderChrome(opts = {}) {
    const ph = this.#phase();
    this.el.dataset.phase = ph;
    this.$noteBtn.hidden = !(this.src.canNote() && ["empty", "list", "nomatch"].includes(ph));
    // chips
    const cats = E.CATEGORIES[this.src.scope] ?? E.CATEGORIES.hero;
    const sel = this.s.cats;
    const chip = (key, label, n, pressed) => h("button.ipl-chip.ipl-cat", { type: "button", "aria-pressed": String(pressed), "data-ipl-act": "cat", "data-ipl-id": key, "data-cat": key === "*" ? null : key, disabled: false },
      h("span.ipl-cat-l", label), h("span.ipl-cat-n", { "aria-hidden": "true" }, String(n)), sr(`, ${tn("IPL.Plural.Entries", n)}`));
    this.$chips.replaceChildren(chip("*", t("IPL.UI.All"), this.counts.all, sel.length === 0), ...cats.filter((c) => (this.counts.cats[c] ?? 0) > 0 || sel.includes(c)).map((c) => chip(c, R.catLabel(c), this.counts.cats[c] ?? 0, sel.includes(c))));
    if (this.src.facets) this.#renderActorChips();
    // filter button label
    const nf = this.filterCount;
    this.$filterBtn.querySelector(".ipl-lbl").textContent = this.$filterBtn.title = nf ? t("IPL.UI.FiltersOn", { n: nf }) : t("IPL.UI.Filters");
    this.$filterBtn.querySelector(".ipl-fcount").textContent = nf ? String(nf) : "";
    // status
    const total = this.data.entries.filter((e) => !e.h).length;
    const count = tn("IPL.Plural.Shown", total, { n: this.filtered.length, total });
    this.$count.textContent = count;
    this.$clear.hidden = !this.#narrowing();
    if (opts.announce) this.#announce(count);
    if (!opts.keepPanel) { this.#refreshUsers(); }
  }
  /** Merged Table log: one chip per hero / base / deleted actor with entries under the current filters (selected ones always show). */
  #renderActorChips() {
    const sel = this.s.actors, counts = this.actorCounts ?? new Map();
    const all = (this.src.facets() ?? []).map((f) => ({ ...f, n: counts.get(f.id) ?? 0 })).filter((f) => f.n > 0 || sel.includes(f.id)).sort((a, b) => (sel.includes(b.id) - sel.includes(a.id)) || b.n - a.n || a.label.localeCompare(b.label));
    const LIMIT = 8;
    const shown = this.s.actorsAll ? all : all.slice(0, LIMIT);
    const chip = (f) => h("button.ipl-chip.ipl-cat.ipl-actorchip", { type: "button", "aria-pressed": String(sel.includes(f.id)), "data-ipl-act": "actor-f", "data-ipl-id": f.id, "data-scope": f.orphan ? "orphan" : f.scope },
      icon(f.orphan ? "fa-ghost" : f.scope === "base" ? "fa-people-roof" : "fa-mask", "ipl-actorchip-ico"), h("span.ipl-cat-l", f.label + (f.orphan ? ` (${t("IPL.Table.Orphan")})` : "")), h("span.ipl-cat-n", { "aria-hidden": "true" }, String(f.n)), sr(`, ${tn("IPL.Plural.Entries", f.n)}`));
    const nodes = shown.map(chip);
    if (all.length > LIMIT) nodes.push(h("button.ipl-linkbtn", { type: "button", "data-ipl-act": "actors-more", "aria-expanded": String(!!this.s.actorsAll) }, this.s.actorsAll ? t("IPL.Table.FewerActors") : t("IPL.Table.MoreActors", { n: all.length })));
    this.$actors.replaceChildren(...nodes);
    this.$actors.hidden = all.length < 2 && !sel.length;
  }
  #refreshUsers() {
    const want = F.usersOf(this.data.entries).map((u) => `${u.id}:${u.n}`).join("|") + `|${F.roundBounds(this.data.entries)?.max ?? ""}`;
    if (this.userSig === want) return;
    this.userSig = want;
    this.#renderFilterPanel();
  }
  #announce(text) { this.$live.textContent = ""; setTimeout(() => { this.$live.textContent = text; }, 30); }
  #renderBanner() {
    if (this.destroyed) return;
    const noScribe = this.src.enabled() && this.data.canSee && !this.src.hasScribe();
    const waiting = this.src.queued?.() ?? 0;
    this.$banner.hidden = !(noScribe || (waiting > 0 && this.data.canSee));
    const p = this.$banner.querySelector("p");
    p.replaceChildren(noScribe ? t("IPL.UI.NoScribe") : "", noScribe && waiting ? " " : "", waiting ? tn("IPL.Plural.Queued", waiting) : "");
    this.$banner.querySelector("i").className = `fa-solid ${noScribe ? "fa-plug-circle-xmark" : "fa-hourglass-half"}`;
  }
  #renderPill() {
    const n = this.pending;
    this.$pill.hidden = n <= 0;
    if (n > 0) { this.$pill.replaceChildren(icon("fa-arrow-up"), h("span", tn("IPL.Plural.New", n))); }
  }

  #state(cls, iconCls, title, body, actions) {
    return h("div.ipl-state", { class: cls, role: cls === "ipl-err" ? "alert" : null }, icon(iconCls, "ipl-state-ico"), h("div.ipl-state-t", h("p.ipl-state-h", title), body && h("p.ipl-state-b", body), actions));
  }
  #renderBody(opts = {}) {
    const ph = this.el.dataset.phase;
    this.#io?.disconnect();
    const keep = opts.keepScroll && this.scroller ? this.scroller.scrollTop : null;
    this.$body.replaceChildren();
    this.cur = null; this.plan = []; this.cursor = 0; this.rowsDone = 0;
    if (ph === "loading") {
      this.$body.append(h("div.ipl-skel", { "aria-busy": "true", role: "status" }, sr(t("IPL.UI.Loading")), [0, 1, 2].map(() => h("div.ipl-skel-row", h("i"), h("b"), h("span")))));
      return;
    }
    if (ph === "error") { this.$body.append(this.#state("ipl-err", "fa-triangle-exclamation", t("IPL.UI.Error"), null, h("button.ipl-btn", { type: "button", "data-ipl-act": "retry" }, icon("fa-rotate"), h("span", t("IPL.UI.Retry"))))); return; }
    if (ph === "off") { this.$body.append(this.#state("ipl-off", "fa-power-off", this.ctx.isGM ? t("IPL.UI.OffGm") : t("IPL.UI.Off"))); return; }
    if (ph === "private") { this.$body.append(this.#state("ipl-private", "fa-lock", t("IPL.UI.NoPermission"))); return; }
    if (ph === "empty") { this.$body.append(this.#state("ipl-empty", "fa-clock-rotate-left", t("IPL.UI.Empty"), t(this.src.facets ? "IPL.UI.TableEmpty" : this.src.scope === "base" ? "IPL.UI.EmptyBase" : "IPL.UI.EmptyHint"))); return; }
    if (ph === "nomatch") {
      const minorHidden = !this.s.showMinor && this.data.entries.some((e) => E.severityOf(e.k) === 0);
      this.$body.append(this.#state("ipl-nomatch", "fa-filter-circle-xmark", t("IPL.UI.EmptyFiltered"), minorHidden ? t("IPL.UI.EmptyFilteredMinor") : null,
        h("button.ipl-btn", { type: "button", "data-ipl-act": "clear" }, icon("fa-xmark"), h("span", t("IPL.UI.ClearFilters")))));
      return;
    }
    // list
    const groups = F.groupByDay(this.filtered, { now: Date.now(), offsetMin: offsetMin(), order: "desc" });
    for (const g of groups) {
      this.plan.push({ kind: "day", g });
      for (const it of g.items) { this.plan.push({ kind: "row", it, g }); if (it.sessionBreak) this.plan.push({ kind: "session", gap: it.gapMs }); }
    }
    this.$days = h("div.ipl-days");
    this.$more = h("div.ipl-morewrap");
    this.$sentinel = h("div.ipl-sentinel", { "aria-hidden": "true" });
    this.$body.append(this.$days, this.$more, this.$sentinel);
    this.#renderMore(Math.max(PAGE, this.s.limit || PAGE));
    if (keep != null && this.scroller) this.scroller.scrollTop = keep;
    this.#observe();
  }
  /** Append the next `rows` rows (plus their day headings and session dividers). */
  #renderMore(rows) {
    let made = 0;
    while (this.cursor < this.plan.length && made < rows) {
      const p = this.plan[this.cursor++];
      if (p.kind === "day") this.#openDay(p.g);
      else if (p.kind === "row") { this.cur.ol.append(this.#row(p.it.entry)); made++; this.rowsDone++; }
      else if (p.kind === "session") this.cur.ol.append(h("li.ipl-session", h("span", t("IPL.UI.SessionBreak", { gap: R.fmtGap(p.gap) }))));
    }
    // consume trailing session dividers so "show older" never starts with one
    while (this.cursor < this.plan.length && this.plan[this.cursor].kind === "session") { const p = this.plan[this.cursor++]; this.cur?.ol.append(h("li.ipl-session", h("span", t("IPL.UI.SessionBreak", { gap: R.fmtGap(p.gap) })))); }
    this.s.limit = Math.max(this.s.limit || PAGE, this.rowsDone);
    this.#renderMoreBtn();
  }
  #openDay(g) {
    const hid = `${this.id}-day-${g.key}`;
    const label = g.label === "today" ? t("IPL.UI.Today") : g.label === "yesterday" ? t("IPL.UI.Yesterday") : R.fmtDay(g.start + 12 * 3600000);
    const ol = h("ol.ipl-rows");
    const sec = h("section.ipl-day", { "aria-labelledby": hid }, h("h3.ipl-dayh", { id: hid }, h("span", label), h("small", tn("IPL.Plural.Entries", g.count))), ol);
    this.$days.append(sec);
    this.cur = { sec, ol, g };
  }
  #renderMoreBtn() {
    const left = this.plan.slice(this.cursor).filter((p) => p.kind === "row").length;
    this.$more.replaceChildren();
    if (left > 0) this.$more.append(h("button.ipl-btn", { type: "button", "data-ipl-act": "older" }, icon("fa-angles-down"), h("span", t("IPL.UI.ShowOlderN", { n: left }))));
    else if (this.rowsDone > PAGE) this.$more.append(h("p.ipl-end", t("IPL.UI.EndOfLog")));
  }
  #observe() {
    this.#io?.disconnect();
    if (!this.$sentinel || typeof IntersectionObserver === "undefined" || !this.scroller) return;
    this.#io = new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting) && this.cursor < this.plan.length) this.#renderMore(PAGE); }, { root: this.scroller, rootMargin: "300px 0px" });
    this.#io.observe(this.$sentinel);
  }
  #onScroll = () => { if (this.scroller) { this.s.scrollTop = this.scroller.scrollTop; if (this.scroller.scrollTop < 12 && this.pending) { this.pending = 0; this.#renderPill(); } } };

  /* ---------------------------------------------------------------- one row */
  #open(e) { return this.s.density === "detailed" ? !this.s.toggled.has(e.id) : this.s.toggled.has(e.id); }
  /** One row; a damaged entry (hostile data from a file or another module) becomes a plain "damaged entry" row instead of breaking the list (L8). */
  #row(e) {
    try { return this.#rowBuild(e); }
    catch (err) {
      console.warn(`${MOD} | log view: a row could not be built`, e?.id, err);
      return h("li.ipl-row", { "data-id": String(e?.id ?? ""), "data-cat": "system", "data-sev": 1 },
        h("time.ipl-time", Number.isFinite(e?.t) ? { datetime: new Date(e.t).toISOString() } : {}, Number.isFinite(e?.t) ? R.fmtClock(e.t) : "—"),
        h("span.ipl-ico", { "data-cat": "system" }, icon("fa-triangle-exclamation")),
        h("div.ipl-main", h("p.ipl-sum", h("span.ipl-sumt", t("IPL.UI.Damaged", { type: String(e?.k ?? "") })))));
    }
  }
  #rowBuild(e) {
    const n = ++this.#seq, did = `${this.id}-d${n}`;
    const cat = R.catOf(e, this.ctx), sev = E.severityOf(e.k);
    const open = this.#open(e);
    const sentence = R.sentenceNodes(e, this.ctx);
    const btn = h("button.ipl-exp", { type: "button", "aria-expanded": String(open), "aria-controls": did, "aria-label": `${open ? t("IPL.UI.Collapse") : t("IPL.UI.Expand")}: ${R.sentenceText(e, this.ctx)}`, "data-ipl-act": "toggle", "data-ipl-id": e.id }, icon("fa-chevron-down"));
    const li = h("li.ipl-row", { "data-id": e.id, "data-aid": e.aid ?? null, "data-cat": cat, "data-sev": sev, class: this.fresh.has(e.id) ? "ipl-fresh" : "", "data-gm": E.visibilityOf(e) === "G" ? "1" : null },
      h("time.ipl-time", { datetime: new Date(e.t).toISOString(), title: R.fmtFull(e.t) }, R.fmtClock(e.t)),
      h("span.ipl-ico", { "data-cat": cat }, icon(R.iconClass(e))),
      h("div.ipl-main", h("p.ipl-sum", sr(`${R.catLabel(cat)}. `), h("span.ipl-sumt", sentence)), h("div.ipl-badges", R.badgesOf(e, this.ctx))),
      btn,
      h("div.ipl-detail", { id: did, hidden: !open })
    );
    if (open) this.#fillDetail(li, e);
    return li;
  }
  #fillDetail(li, e, full = false) {
    const box = li.querySelector(".ipl-detail");
    try { box.replaceChildren(R.detailOf(e, this.ctx, { fullKids: full }), this.#actionsRow(e)); }
    catch (err) { console.warn(`${MOD} | log view: a detail panel could not be built`, e?.id, err); box.replaceChildren(h("p.ipl-muted", t("IPL.UI.Damaged", { type: String(e?.k ?? "") }))); }
    box.dataset.filled = "1";
  }
  #actionsRow(e) {
    const row = h("div.ipl-actions");
    for (const a of R.actionsOf(e, this.ctx)) row.append(h("button.ipl-btn.ipl-sm", { type: "button", "data-ipl-act": a.act, "data-ipl-id": a.id, "aria-disabled": a.disabled ? "true" : null }, icon(a.icon), h("span", a.label)));
    if (this.src.canGm() && e.k !== "log.redact") {
      row.append(h("button.ipl-btn.ipl-sm", { type: "button", "data-ipl-act": "annotate", "data-ipl-id": e.id, "aria-expanded": "false" }, icon("fa-user-secret"), h("span", t("IPL.UI.Annotate"))));
      if (!["log.start", "log.prune"].includes(e.k)) row.append(h("button.ipl-btn.ipl-sm.ipl-danger", { type: "button", "data-ipl-act": "redact", "data-ipl-id": e.id }, icon("fa-eraser"), h("span", t("IPL.UI.Redact"))));
    }
    return row.childElementCount ? row : document.createDocumentFragment();
  }

  /* ---------------------------------------------------------------- events */
  #entry(id, li = null) { const aid = li?.dataset?.aid; return this.data.entries.find((x) => x.id === id && (!aid || x.aid === aid)) ?? null; }     // merged Table log: ids are only unique per log, the row knows its log
  #onKey(ev) {
    if (ev.isComposing || ev.keyCode === 229) return;                 // L10: Escape / Enter inside an IME composition belongs to the IME (it closed the note composer and lost the draft)
    if (ev.key === "/" && !ev.ctrlKey && !ev.metaKey && !ev.altKey && !ev.target.closest?.("input, textarea, select, [contenteditable]")) { ev.preventDefault(); this.$search.focus(); return; }
    if (ev.key === "Escape") {
      if (!this.$note.hidden && this.$note.contains(ev.target)) { this.#closeNote(true); ev.stopPropagation(); }
      else if (this.$exportMenu.open) { this.$exportMenu.open = false; this.$exportMenu.querySelector("summary").focus(); ev.stopPropagation(); }
    }
  }
  #onClick(ev) {
    const b = ev.target.closest?.("[data-ipl-act]");
    if (!b || !this.el.contains(b)) { if (this.$exportMenu.open && !ev.target.closest?.(".ipl-menu")) this.$exportMenu.open = false; return; }
    if (b.getAttribute("aria-disabled") === "true") { ev.preventDefault(); return; }
    const act = b.dataset.iplAct, id = b.dataset.iplId;
    switch (act) {
      case "cat": {
        const s = this.s;
        if (id === "*") s.cats = []; else s.cats = s.cats.includes(id) ? s.cats.filter((x) => x !== id) : [...s.cats, id];
        s.limit = PAGE; this.#renderAll({ announce: true, keepPanel: true });
        this.$chips.querySelector(`[data-ipl-id="${CSS.escape(id)}"]`)?.focus();
        break;
      }
      case "actor-f": {
        const s = this.s;
        s.actors = s.actors.includes(id) ? s.actors.filter((x) => x !== id) : [...s.actors, id];
        s.limit = PAGE; this.#renderAll({ announce: true, keepPanel: true });
        this.$actors.querySelector(`[data-ipl-id="${CSS.escape(id)}"]`)?.focus();
        break;
      }
      case "actors-more": this.s.actorsAll = !this.s.actorsAll; this.#renderChrome({ keepPanel: true }); this.$actors.querySelector('[data-ipl-act="actors-more"]')?.focus(); break;
      case "filters": this.s.filtersOpen = !this.s.filtersOpen; this.$panel.hidden = !this.s.filtersOpen; b.setAttribute("aria-expanded", String(this.s.filtersOpen)); break;
      case "clear": this.#clearFilters(); break;
      case "density": {
        this.s.density = id; setClient("logDensity", id); this.s.toggled.clear(); this.el.dataset.density = id;
        this.$dens.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.iplId === id)));
        this.#renderBody({ keepScroll: true });
        break;
      }
      case "preset": { this.s.preset = id; this.s.fromStr = ""; this.s.toStr = ""; this.s.limit = PAGE; this.#renderFilterPanel(); this.#renderAll({ announce: true, keepPanel: true }); this.$panel.querySelector(`[data-ipl-id="${id}"]`)?.focus(); break; }
      case "toggle": this.#toggleRow(b, id); break;
      case "older": { const before = this.$days.querySelectorAll(".ipl-row").length; this.#renderMore(PAGE); this.$days.querySelectorAll(".ipl-row")[before]?.querySelector(".ipl-exp")?.focus({ preventScroll: false }); break; }
      case "pill": this.pending = 0; this.#renderPill(); this.fresh = new Set(); this.#renderAll({ keepScroll: false }); if (this.scroller) this.scroller.scrollTop = 0; break;
      case "retry": this.#load(false); break;
      case "note": this.#openNote(); break;
      case "item": { const aid = b.closest("li.ipl-row")?.dataset.aid; const act = aid ? game.actors.get(aid) : this.src.actor; act?.items?.get(id)?.sheet?.render(true); break; }
      case "actor": { game.actors?.get(id)?.sheet?.render(true); break; }
      case "chat": this.#showChat(id); break;
      case "allkids": { const li = b.closest("li.ipl-row"), e = this.#entry(id, li); if (li && e) this.#fillDetail(li, e, true); break; }
      case "annotate": this.#annotate(b, id); break;
      case "redact": this.#redact(b, id); break;
      case "export": this.#export(b.dataset.iplFmt, b.dataset.iplId === "view"); break;
      default: break;
    }
  }
  #toggleRow(btn, id) {
    const li = btn.closest("li.ipl-row"), e = this.#entry(id, li); if (!li || !e) return;
    const box = li.querySelector(".ipl-detail");
    const open = btn.getAttribute("aria-expanded") !== "true";
    if (open && !box.dataset.filled) this.#fillDetail(li, e);
    box.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    btn.setAttribute("aria-label", `${open ? t("IPL.UI.Collapse") : t("IPL.UI.Expand")}: ${R.sentenceText(e, this.ctx)}`);
    // remember the deviation from the density default
    const dflt = this.s.density === "detailed";
    if (open === dflt) this.s.toggled.delete(id); else this.s.toggled.add(id);
  }
  #showChat(id) {
    const msg = game.messages?.get(id);
    if (!msg) { ui.notifications?.warn(t("IPL.UI.ChatGone")); return; }
    try { ui.sidebar?.changeTab?.("chat", "primary"); } catch { /* sidebar collapsed */ }
    const find = () => (ui.chat?.element ?? document).querySelector?.(`li[data-message-id="${id}"]`);
    const go = () => { const li = find(); if (!li) return false; li.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" }); li.classList.add("ipl-flash"); setTimeout(() => li.classList.remove("ipl-flash"), 1800); return true; };
    if (!go()) setTimeout(() => { if (!go()) ui.notifications?.info(t("IPL.UI.ChatGone")); }, 250);
  }

  /* ---------------------------------------------------------------- notes, annotate, redact */
  #openNote() {
    if (!this.$note.hidden) { this.#closeNote(true); return; }
    const id = this.id;
    this.$note.replaceChildren(
      h("label", { for: `${id}-nt` }, t("IPL.UI.NoteLabel")),
      this.$ta = h("textarea.ipl-input", { id: `${id}-nt`, rows: "3", maxlength: "1000", placeholder: t("IPL.UI.NotePh"), "aria-describedby": `${id}-nl` }),
      h("div.ipl-note-row", h("span.ipl-hint", { id: `${id}-nl` }, t("IPL.UI.NoteLeft", { n: 1000 })),
        this.src.canGm() && h("label.ipl-check", this.$gmOnly = h("input", { type: "checkbox" }), h("span", t("IPL.UI.NoteGm")))),
      this.$noteErr = h("p.ipl-err-t", { role: "alert", hidden: true }),
      h("div.ipl-note-row", h("button.ipl-btn.ipl-primary", { type: "submit" }, icon("fa-check"), h("span", t("IPL.UI.NoteSave"))), h("button.ipl-btn", { type: "button", onclick: () => this.#closeNote(true) }, t("IPL.UI.NoteCancel")))
    );
    this.$ta.addEventListener("input", () => { this.$note.querySelector(`#${id}-nl`).textContent = t("IPL.UI.NoteLeft", { n: 1000 - this.$ta.value.length }); });
    this.$note.hidden = false; this.$noteBtn.setAttribute("aria-expanded", "true");
    this.$ta.focus();
  }
  #closeNote(refocus) { this.$note.hidden = true; this.$note.replaceChildren(); this.$noteBtn.setAttribute("aria-expanded", "false"); if (refocus) this.$noteBtn.focus(); }
  async #submitNote() {
    const text = this.$ta.value.trim();
    if (!text) { this.$noteErr.textContent = t("IPL.UI.NoteEmpty"); this.$noteErr.hidden = false; this.$ta.focus(); return; }
    const btn = this.$note.querySelector("button[type=submit]"); btn.disabled = true;
    let r = null;
    try { r = await this.src.note(text, { gmOnly: !!this.$gmOnly?.checked }); } catch { r = null; }
    btn.disabled = false;
    if (!r) { this.$noteErr.textContent = t("IPL.UI.NoteFailed"); this.$noteErr.hidden = false; return; }
    this.#closeNote(true); this.#announce(r.queued ? t("IPL.UI.NoteQueued") : t("IPL.UI.NoteAdded"));
    if (r.queued) { ui.notifications?.info(t("IPL.UI.NoteQueued"), { console: false }); this.#renderBanner(); return; }
    setTimeout(() => this.#sync(), 400);
  }
  #annotate(btn, id) {
    const li = btn.closest("li.ipl-row"); if (!li) return;
    const ex = li.querySelector(".ipl-annot-form");
    if (ex) { ex.remove(); btn.setAttribute("aria-expanded", "false"); return; }
    const fid = `${this.id}-an-${id}`;
    const form = h("form.ipl-annot-form", h("label", { for: fid }, t("IPL.UI.Annotate")), h("textarea.ipl-input", { id: fid, rows: "2", maxlength: "1000", placeholder: t("IPL.UI.AnnotatePh") }),
      h("p.ipl-err-t", { role: "alert", hidden: true }),
      h("div.ipl-note-row", h("button.ipl-btn.ipl-sm.ipl-primary", { type: "submit" }, t("IPL.UI.AnnotateSave")), h("button.ipl-btn.ipl-sm", { type: "button", onclick: () => { form.remove(); btn.setAttribute("aria-expanded", "false"); btn.focus(); } }, t("IPL.UI.NoteCancel"))));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const ta = form.querySelector("textarea"), err = form.querySelector(".ipl-err-t");
      if (!ta.value.trim()) { err.textContent = t("IPL.UI.NoteEmpty"); err.hidden = false; return; }
      const r = await this.src.annotate(id, ta.value.trim(), li.dataset.aid || undefined).catch(() => null);
      if (!r) { err.textContent = t("IPL.UI.NoteFailed"); err.hidden = false; return; }
      form.remove(); btn.setAttribute("aria-expanded", "false"); setTimeout(() => this.#sync(), 400);
    });
    li.querySelector(".ipl-actions")?.after(form) ?? li.querySelector(".ipl-detail").append(form);
    btn.setAttribute("aria-expanded", "true"); form.querySelector("textarea").focus();
  }
  #redact(btn, id) {
    const bar = btn.parentElement;
    const ask = h("span.ipl-ask", { role: "group" }, h("span", t("IPL.UI.RedactAsk")),
      h("button.ipl-btn.ipl-sm.ipl-danger", { type: "button", onclick: async () => {
        const r = await this.src.redact(id, btn.closest("li.ipl-row")?.dataset.aid || undefined).catch(() => null);
        if (!r) { ask.replaceChildren(h("span.ipl-err-t", { role: "alert" }, t("IPL.UI.RedactFailed"))); return; }
        setTimeout(() => this.#sync(), 400);
      } }, t("IPL.UI.RedactYes")),
      h("button.ipl-btn.ipl-sm", { type: "button", onclick: () => { ask.remove(); btn.hidden = false; btn.focus(); } }, t("IPL.UI.NoteCancel")));
    btn.hidden = true; bar.append(ask); ask.querySelector("button").focus();
  }

  /* ---------------------------------------------------------------- export */
  #fillExportMenu() {
    const panel = this.$exportMenu.querySelector(".ipl-menu-panel");
    const nView = this.filtered.length, nAll = this.data.entries.length;
    const grp = (scope, label) => h("div.ipl-menu-g", h("p.ipl-menu-h", label), ["json", "csv", "md"].map((f) => h("button.ipl-menuitem", { type: "button", "data-ipl-act": "export", "data-ipl-id": scope, "data-ipl-fmt": f }, t("IPL.UI.ExportAs", { format: f === "md" ? "Markdown" : f.toUpperCase() }))));
    panel.replaceChildren(grp("view", t("IPL.UI.ExportView", { n: nView })), grp("all", t("IPL.UI.ExportAll", { n: nAll })));
  }
  #export(fmt, thisView) {
    this.$exportMenu.open = false;
    try {
      const res = thisView ? this.src.exportEntries(this.filtered, fmt, this.ctx) : this.src.exportAll(fmt, this.ctx);
      if (!res) throw new Error("no export");
      const file = thisView ? res.filename.replace(/(\.\w+)$/, "-view$1") : res.filename;
      foundry.utils.saveDataToFile(res.text, res.mime, file);
      this.#announce(t("IPL.UI.Exported", { file }));
      ui.notifications?.info(t("IPL.UI.Exported", { file }));
    } catch (e) { console.warn(`${MOD} | log export failed`, e); ui.notifications?.error(t("IPL.UI.ExportFailed")); }
  }

  /* ---------------------------------------------------------------- data for the host */
  /** Entries newer than `since` that someone else made and that show by default (the tab badge). */
  unseenSince(since) {
    let n = 0;
    for (const e of this.data.entries) if (e.t > since && e.u !== game.user.id && !e.h && E.severityOf(e.k) > 0) n++;
    return n;
  }
}
