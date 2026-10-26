/* End-of-session panel, phase S3: the WINDOW. One ApplicationV2 (singleton per client, id ips-panel), plain DOM like the chargen and base shells: the frame is built
   once, every world update only PATCHES it (api.session.subscribe -> one rAF-coalesced paint), so nothing flickers and focus stays where it is.
   Data comes ONLY from the S2 api (state / status / summary / heroInfo / canAnswer, and the envelope-returning writes); the window never decides a permission, it
   explains the reducer's (ui/model.mjs). A player's own click is OPTIMISTIC (painted at once, rolled back with a message if the GM side refuses; the same cell
   is sent one request at a time so the order on the GM side cannot swap). An envelope {ok:true, changed:false} is a success: the paint comes from the state. */
import { sessionApi as api } from "../api.mjs";
import * as Store from "../store.mjs";
import * as Book from "../book.mjs";
import * as P from "../pure.mjs";
import { t, errText } from "../lang.mjs";
import * as M from "./model.mjs";
import { el, icon, setText, setAttr, setHidden } from "./dom.mjs";
import { createQuestion } from "./quest.mjs";
import { createSummary } from "./summary.mjs";
import { createStart } from "./start.mjs";
import { createBar } from "./bar.mjs";
import * as D from "./dialogs.mjs";

const MOD = Store.MOD;
const ID = "ips-panel";
const { ApplicationV2 } = foundry.applications.api;
const isCard = (a) => !!a?.flags?.[MOD]?.base?.kind;
const STATE_WORD = { yes: "IPL.Session.UI.Yes", no: "IPL.Session.UI.No", none: "IPL.Session.UI.None" };

export class SessionPanel extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: ID, classes: ["invincible-plus-ultra", "ips-app"], tag: "div",
    window: { icon: "fa-solid fa-flag-checkered", resizable: true, contentClasses: ["ips-content"] },
    position: { width: 560, height: 700 }
  };

  /** Open or refocus the single panel of this client. */
  static async open() {
    const existing = foundry.applications.instances.get(ID);
    if (existing) {
      if (existing.minimized) await existing.maximize?.();
      existing.bringToFront?.();
      await existing.render({ force: true });
      return existing;
    }
    const app = new SessionPanel();
    await app.render({ force: true });
    return app;
  }
  static instance() { return foundry.applications.instances.get(ID) ?? null; }

  #root = null; #bound = false; #unsub = null; #raf = 0; #timers = new Set();
  #vm = null; #viewKey = ""; #view = null; #start = null; #bar = null; #dots = null; #dotKey = "";
  #pending = new Map(); #inflight = new Map(); #own = new Map(); #busy = 0; #prev = null; #announceT = 0; #flashT = 0; #booked = false;

  constructor(options = {}) {
    options.position = { ...(options.position ?? {}) };
    options.position.width ??= Math.max(340, Math.min(560, window.innerWidth - 24));
    options.position.height ??= Math.max(420, Math.min(680, window.innerHeight - 24));
    super(options);
  }
  get title() { return t("IPL.Session.UI.Title"); }

  /* ---------------------------------------------------------------- lifecycle */
  async _prepareContext() { return {}; }
  async _renderHTML() { return (this.#root ??= this.#frame()); }
  _replaceHTML(result, content) { if (!content.contains(result)) content.replaceChildren(result); }
  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this.#unsub = api.subscribe((info) => this.#want(info));
    if (!this.#booked) { this.#booked = true; Book.load().then(() => this.#want()).catch(() => {}); }
  }
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!this.#bound) { this.#bound = true; this.#bind(); }
    this.#paint(true);
  }
  _onClose(options) {
    super._onClose?.(options);
    this.#unsub?.(); this.#unsub = null;
    cancelAnimationFrame(this.#raf); clearTimeout(this.#raf);
    for (const id of this.#timers) clearTimeout(id);
    this.#timers.clear(); clearTimeout(this.#announceT); clearTimeout(this.#flashT);
  }
  #later(fn, ms) { const id = setTimeout(() => { this.#timers.delete(id); fn(); }, ms); this.#timers.add(id); return id; }

  /* ---------------------------------------------------------------- frame */
  #frame() {
    const root = el("div", "ips-shell", { "data-view": "none" });
    const dots = el("ol", "ips-dots", { "aria-label": t("IPL.Session.UI.Progress.label") });
    const head = el("header", "ips-head", dots);
    const bNoGm = el("p", "ips-banner ips-banner-warn", { "data-b": "noGM", role: "status" }, icon("fa-solid fa-plug-circle-xmark"), el("span", "", t("IPL.Session.UI.Banner.noGM")));
    const bResume = el("p", "ips-banner ips-banner-warn", { "data-b": "resume" }, icon("fa-solid fa-triangle-exclamation"), el("span", "ips-banner-t"),
      el("button", "ips-btn ips-btn-small", { type: "button", "data-ips": "resume", "data-fk": "resume" }, icon("fa-solid fa-play"), el("span", "ips-btn-t", t("IPL.Session.UI.Resume"))));
    const banners = el("div", "ips-banners", bNoGm, bResume);
    const main = el("main", "ips-main", { tabindex: "-1" });
    const toast = el("p", "ips-toast", { role: "status", hidden: true });
    this.#bar = createBar();
    this.#dots = dots;
    root.append(head, banners, el("div", "ips-mainwrap", main, toast), this.#bar.el, el("p", "ips-sr", { "aria-live": "polite", "data-live": "1" }));
    return root;
  }
  #q(sel) { return this.#root?.querySelector(sel) ?? null; }

  /* ---------------------------------------------------------------- environment / paint */
  #want() {
    if (this.#raf || !this.rendered) return;
    const run = () => { this.#raf = 0; this.#paint(); };
    this.#raf = document.hidden ? setTimeout(run, 60) : requestAnimationFrame(run);       // a hidden tab never runs rAF: its panel (and the live region) must stay current anyway
  }
  #questions(s) {
    return P.questions(!!s?.askBad).map((q, index) => ({ id: q.id, key: q.key, group: q.group, ...(q.flaw ? { flaw: true } : {}), label: Book.label(q.id), text: Book.text(q.id), index }));
  }
  #env() {
    const s = Store.current();
    const status = api.status();
    const env = { s, status, me: { id: game.user.id, staff: Store.isStaff(game.user) }, questions: s ? this.#questions(s) : [], info: (id) => api.heroInfo(id), pending: this.#pending };
    if (s && P.view(s) === "summary") env.summary = api.summary();
    return env;
  }
  #candidates() {
    const def = new Set(api.defaultHeroes().map((h) => h.id));
    return game.actors.filter((a) => a.type === "superhero" && !isCard(a)).map((a) => ({ id: a.id, name: a.name, img: a.img || "", def: def.has(a.id) }))
      .sort((a, b) => (b.def - a.def) || a.name.localeCompare(b.name));
  }

  #paint(force = false) {
    if (!this.#root || !this.rendered) return;
    // optimistic cells: drop those the state has caught up with, or that expired
    const s0 = Store.current();
    for (const [k, p] of [...this.#pending]) {
      if (!p.done) continue;
      const [h, q] = k.split("|");
      const c = s0 ? P.cellOf(s0, q, h) : null;
      if ((c && c.v === p.v) || Date.now() - p.done > 1600) this.#pending.delete(k);
    }
    const vm = M.build(this.#env());
    const prev = this.#prev;
    this.#vm = vm;
    this.#root.dataset.view = vm.view;
    this.#root.dataset.state = vm.state ?? "none";
    this.#root.dataset.staff = vm.staff ? "1" : "0";
    this.#paintHead(vm);
    this.#paintBanners(vm);
    this.#paintMain(vm, force);
    this.#bar.patch(vm);
    this.#announceChanges(prev, vm);
    this.#prev = { key: vm.key, qid: vm.q?.id ?? null, gmOnline: vm.gmOnline, state: vm.state, cells: new Map(vm.heroes.map((h) => [h.id, h.state])), index: vm.index, own: null };
    if (this.#pending.size) this.#later(() => this.#want(), 700);
  }

  #paintHead(vm) {
    const head = this.#q(".ips-head");
    setHidden(head, vm.view === "none");
    if (vm.view === "none") return;
    setAttr(this.#dots, "data-n", vm.total > 12 ? "many" : null);
    const dk = `${vm.total}|${vm.staff}`;
    if (dk !== this.#dotKey) {
      this.#dotKey = dk;
      const items = [];
      for (let i = 0; i <= vm.total; i++) {
        const sum = i === vm.total;
        const li = el("li", "ips-dot-li");
        const inner = vm.staff
          ? el("button", "ips-dot", { type: "button", "data-ips": "dot", "data-i": String(i), "data-fk": `dot-${i}`, tabindex: "-1" })
          : el("span", "ips-dot", { "data-i": String(i) });
        if (sum) inner.append(icon("fa-solid fa-list-check")); else inner.append(el("span", "ips-dot-n"));
        li.append(inner); items.push(li);
      }
      this.#dots.replaceChildren(...items);
    }
    const lis = [...this.#dots.children];
    const goodN = P.GOOD.length;
    lis.forEach((li, i) => {
      const d = li.firstElementChild;
      const sum = i === vm.total;
      const dot = sum ? null : vm.dots[i];
      const state = sum ? (vm.view === "summary" ? "current" : "none") : dot.state;
      setAttr(d, "data-state", state);
      setAttr(d, "data-group", dot?.group === "bad" ? "bad" : "good");
      setAttr(li, "data-gap", !sum && dot.group === "bad" && i === goodN ? "1" : null);
      if (!sum) setText(d.querySelector(".ips-dot-n"), String(dot.n));
      const label = sum ? t("IPL.Session.UI.Dot.summary") : t("IPL.Session.UI.Dot.state", { n: dot.n, answered: dot.answered, total: dot.total });
      setAttr(d, "aria-label", vm.staff ? `${sum ? t("IPL.Session.UI.Dot.summary") : t("IPL.Session.UI.Dot.go", { n: dot.n })}. ${sum ? "" : label}`.trim() : label);
      setAttr(d, "title", sum ? t("IPL.Session.UI.Dot.summary") : `${dot.label}`);
      setAttr(d, "aria-current", state === "current" ? "step" : null);
      if (vm.staff) setAttr(d, "tabindex", state === "current" ? "0" : "-1");
      if (vm.staff) setAttr(d, "aria-disabled", vm.canNav ? null : "true");
    });
    if (vm.staff && !this.#dots.querySelector('.ips-dot[tabindex="0"]')) lis[0]?.firstElementChild?.setAttribute("tabindex", "0");
  }

  #paintBanners(vm) {
    const none = vm.view === "none";
    setHidden(this.#q('[data-b="noGM"]'), vm.gmOnline || (none && vm.staff));
    const r = this.#q('[data-b="resume"]');
    const show = vm.staff && vm.resumable && !none;
    setHidden(r, !show);
    if (show) setText(r.querySelector(".ips-banner-t"), t(Store.current()?.award?.state === "undoing" ? "IPL.Session.UI.Banner.resumeUndo" : "IPL.Session.UI.Banner.resume"));
  }

  #paintMain(vm, force) {
    const main = this.#q(".ips-main");
    const kind = vm.view;
    const key = kind === "none" ? "none" : `${kind}`;
    const switching = key !== this.#viewKey || (force && !this.#view);
    if (switching) {
      const had = main.contains(document.activeElement) || document.activeElement === document.body || !document.activeElement;
      this.#viewKey = key;
      this.#view = kind === "question" ? createQuestion() : kind === "summary" ? createSummary() : createStart();
      main.replaceChildren(this.#view.el);
      this.#start = kind === "none" ? this.#view : null;
      this.#focusOnPaint = had && !force;
    }
    if (kind === "none") this.#view.patch(vm, vm.staff ? this.#candidates() : []);
    else this.#view.patch(vm);
    if (switching && this.#focusOnPaint) { this.#focusOnPaint = false; this.#view.el.querySelector("[data-focus-first]")?.focus({ preventScroll: true }); }
    if (switching && !force) main.scrollTop = 0;
  }
  #focusOnPaint = false;

  /* ---------------------------------------------------------------- announcements / toast */
  #announce(text) {
    const live = this.#q("[data-live]");
    if (!live) return;
    live.textContent = "";
    this.#later(() => { live.textContent = text; }, 40);
  }
  #announceChanges(prev, vm) {
    if (!prev) return;
    const parts = [];
    if (prev.key !== vm.key) {
      if (vm.view === "none") parts.push(t("IPL.Session.UI.Live.none"));
      else if (vm.view === "summary") parts.push(t("IPL.Session.UI.Live.summary"));
    }
    if (vm.view === "question" && vm.q && prev.qid !== vm.q.id) parts.push(t("IPL.Session.UI.Live.question", { n: vm.index + 1, total: vm.total, label: vm.q.label }));
    else if (vm.view === "question" && prev.cells) {
      const mineKeys = new Set([...this.#own.keys()].filter((k) => Date.now() - this.#own.get(k) < 2500));
      const names = [];
      for (const h of vm.heroes) {
        const was = prev.cells.get(h.id);
        if (was !== undefined && was !== h.state && !mineKeys.has(`${h.id}|${vm.q.id}`)) names.push(t("IPL.Session.UI.Live.change", { hero: h.name, state: t(STATE_WORD[h.state]) }));
      }
      if (names.length) parts.push(names.slice(0, 4).join(". "));
    }
    if (prev.gmOnline !== undefined && prev.gmOnline !== vm.gmOnline && !vm.staff) parts.push(t(vm.gmOnline ? "IPL.Session.UI.Live.back" : "IPL.Session.UI.Live.gone"));
    if (prev.state && prev.state !== "awarded" && vm.state === "awarded") parts.push(t("IPL.Session.UI.Live.awarded"));
    if (parts.length) {
      clearTimeout(this.#announceT);
      this.#announceT = setTimeout(() => this.#announce(parts.join(". ")), 120);
    }
  }
  #flash(text, kind = "warn") {
    const n = this.#q(".ips-toast");
    if (!n) return;
    n.textContent = text; n.hidden = false; n.dataset.kind = kind;
    n.getAnimations?.().forEach((a) => a.cancel());
    n.animate?.([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: 160, easing: "cubic-bezier(.16, 1, .3, 1)" });
    this.#announce(text);
    clearTimeout(this.#flashT);
    this.#flashT = setTimeout(() => { n.hidden = true; }, 6500);
  }
  #fail(r) { this.#flash(errText(r?.error) || t("IPL.Session.err.internal")); }

  /* ---------------------------------------------------------------- events */
  #bind() {
    const root = this.#root;
    root.addEventListener("click", (ev) => {
      const target = ev.target instanceof Element ? ev.target : null;
      if (this.#bar.menuOpen() && !target?.closest(".ips-more")) this.#bar.toggleMenu(false);
      const b = target?.closest("[data-ips]");
      if (!b || !root.contains(b)) return;
      const act = b.dataset.ips;
      if (act !== "more" && b.closest(".ips-menu")) this.#bar.toggleMenu(false);
      this.#dispatch(act, b);
    });
    root.addEventListener("keydown", (ev) => this.#key(ev));
    root.addEventListener("focusin", (ev) => {                                      // roving tabindex of the progress dots
      const d = ev.target instanceof Element ? ev.target.closest("button.ips-dot") : null;
      if (!d) return;
      for (const x of this.#dots.querySelectorAll("button.ips-dot")) x.setAttribute("tabindex", x === d ? "0" : "-1");
    });
  }
  #key(ev) {
    const t0 = ev.target instanceof Element ? ev.target : null;
    if (!t0) return;
    if (ev.key === "Escape" && this.#bar.menuOpen()) { ev.stopPropagation(); ev.preventDefault(); this.#bar.toggleMenu(false); this.#q('[data-ips="more"]')?.focus(); return; }
    const move = (list, from, dir) => {
      const i = list.indexOf(from);
      if (i < 0) return;
      const n = dir === "home" ? 0 : dir === "end" ? list.length - 1 : Math.max(0, Math.min(list.length - 1, i + dir));
      ev.preventDefault(); list[n]?.focus();
    };
    const dir = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: "home", End: "end" }[ev.key];
    if (dir === undefined || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const sw = t0.closest(".ips-sw, .ips-over");
    if (sw && !sw.classList.contains("ips-over")) { move([...this.#root.querySelectorAll(".ips-hero:not([hidden]) .ips-sw")], sw, dir); return; }
    const dot = t0.closest("button.ips-dot");
    if (dot) { if (dir === 1 || dir === -1 || typeof dir === "string") move([...this.#dots.querySelectorAll("button.ips-dot")], dot, dir); return; }
    const mi = t0.closest(".ips-menu-i");
    if (mi && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) move([...mi.parentElement.querySelectorAll(".ips-menu-i")], mi, dir);
  }

  async #dispatch(act, btn) {
    const vm = this.#vm;
    if (!vm) return;
    if (btn.getAttribute("aria-disabled") === "true" && act !== "cell" && act !== "over" && act !== "lean" && act !== "start") {
      if (act === "bad") this.#flash(t("IPL.Session.err.badState"), "info");
      return;
    }
    try {
      switch (act) {
        case "cell": return await this.#cell(btn, false);
        case "over": return await this.#cell(btn, true);
        case "unlock": { const h = btn.closest(".ips-hero")?.dataset.id; const r = await api.unlock(h, vm.q?.id); if (!r.ok) this.#fail(r); return; }
        case "prev": return this.#nav(await api.navigate("prev"));
        case "next": return this.#nav(await api.navigate("next"));
        case "dot": { const i = Number(btn.dataset.i); if (Number.isInteger(i) && i !== vm.index) this.#nav(await api.jump(i)); return; }
        case "toSummary": return this.#nav(await api.jump(vm.total));
        case "lean": return await this.#lean();
        case "bad": { const r = await api.toggleBad(); if (!r.ok) this.#fail(r); return; }
        case "more": this.#bar.toggleMenu(); return;
        case "addHero": return await this.#addHero();
        case "removeHero": return await this.#removeHero();
        case "discard": return await this.#discard();
        case "reopen": { const r = await api.reopen(); if (!r.ok) this.#fail(r); return; }
        case "award": return await this.#award();
        case "undo": return await this.#undo();
        case "postChat": { const r = await api.postSummary(); if (r.ok) this.#flash(t("IPL.Session.UI.Posted"), "ok"); else this.#fail(r); return; }
        case "dismiss": { const r = await api.dismiss(); if (r.ok) this.#flash(t("IPL.Session.UI.Dismiss.done"), "ok"); else this.#fail(r); return; }
        case "start": return await this.#startReview();
        case "resume": return await this.#resume();
        default: return;
      }
    } catch (e) { console.warn(`${MOD} | session panel action failed`, act, e); this.#flash(t("IPL.Session.err.internal")); }
  }
  #nav(r) { if (!r?.ok) this.#fail(r); }

  /* ---------------------------------------------------------------- the cell (optimistic, one request at a time per cell) */
  async #cell(btn, over) {
    const vm = this.#vm, id = btn.closest(".ips-hero")?.dataset.id, h = vm.heroes.find((x) => x.id === id);
    if (!h || !vm.q) return;
    const blocked = over ? !h.canOver : !h.canToggle;
    if (btn.getAttribute("aria-disabled") === "true" || blocked) {
      this.#flash(h.reason ? t(`IPL.Session.UI.Reason.${h.reason}`) : t("IPL.Session.err.noPermission"), "info");
      return;
    }
    const value = over ? (h.v === 2 ? 1 : 2) : (h.v !== null && h.v >= 1 ? 0 : 1);
    this.#answer(h.id, vm.q.id, value);
  }
  #answer(hero, q, value) {
    const key = `${hero}|${q}`;
    this.#pending.set(key, { v: value });
    this.#own.set(key, Date.now());
    this.#paint();
    const run = this.#inflight.get(key);
    if (run) { run.want = value; return run.promise; }
    const rec = { want: value, promise: null };
    this.#inflight.set(key, rec);
    rec.promise = (async () => {
      try {
        for (;;) {
          const sent = rec.want;
          const r = await api.answer(hero, q, sent);
          if (!r?.ok) {
            this.#pending.delete(key);
            this.#fail(r);
            this.#announce(t("IPL.Session.UI.Live.refused", { reason: errText(r?.error) }));
            this.#paint();
            return r;
          }
          if (rec.want === sent) { const p = this.#pending.get(key); if (p) p.done = Date.now(); this.#paint(); this.#later(() => this.#want(), 1700); return r; }
        }
      } catch (e) {
        this.#pending.delete(key); this.#flash(t("IPL.Session.err.relay")); this.#paint(); console.warn(`${MOD} | session answer failed`, e);
      } finally { this.#inflight.delete(key); }
    })();
    return rec.promise;
  }

  /* ---------------------------------------------------------------- GM flows */
  async #lean() {
    const vm = this.#vm;
    if (!vm.q) return;
    const ids = vm.undecided.slice();
    if (!ids.length) { this.#flash(t("IPL.Session.UI.Lean.none"), "info"); return; }
    if (!(await D.confirmLean(ids.length))) return;
    let n = 0;
    for (const id of ids) { const r = await api.answer(id, vm.q.id, 1); if (r.ok) n++; else { this.#fail(r); break; } }
    if (n) this.#flash(t("IPL.Session.UI.Lean.done", { n }), "ok");
  }
  async #addHero() {
    const s = Store.current();
    if (!s) return;
    const inS = new Set(s.heroes.map((h) => h.id));
    const options = game.actors.filter((a) => a.type === "superhero" && !isCard(a) && !inS.has(a.id)).map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name));
    const id = await D.pickHero({ title: t("IPL.Session.UI.AddHero.title"), icon: "fa-solid fa-user-plus", options, go: t("IPL.Session.UI.AddHero.go"), none: t("IPL.Session.UI.AddHero.none") });
    if (!id) return;
    const r = await api.addHero(id);
    if (!r.ok) this.#fail(r);
  }
  async #removeHero() {
    const s = Store.current();
    if (!s) return;
    const options = s.heroes.map((h) => ({ id: h.id, name: api.heroInfo(h.id).name }));
    const id = await D.pickHero({ title: t("IPL.Session.UI.RemoveHero.title"), icon: "fa-solid fa-user-minus", options, go: t("IPL.Session.UI.RemoveHero.go"), body: t("IPL.Session.UI.RemoveHero.body") });
    if (!id) return;
    const r = await api.removeHero(id);
    if (!r.ok) this.#fail(r);
  }
  async #discard() {
    if (!(await D.confirmDiscard())) return;
    const r = await api.discard();
    if (!r.ok) this.#fail(r);
  }
  async #startReview() {
    const sv = this.#start;
    if (!sv) return;
    const ids = sv.selected();
    if (!ids.length) { this.#flash(t("IPL.Session.err.noHeroes"), "info"); return; }
    this.#working(true);
    try { const r = await api.start({ heroes: ids, askBad: sv.askBad() }); if (!r.ok) this.#fail(r); } finally { this.#working(false); }
  }
  async #award() {
    if (this.#busy) return;
    const vm = this.#vm, sum = vm.sum;
    if (!sum) return;
    const live = sum.rows.filter((r) => !r.missing);
    const res = await D.confirmAward({ rows: live.map((r) => ({ name: r.name, before: r.before ?? 0, after: r.after ?? r.before ?? 0 })), skipped: sum.rows.filter((r) => r.missing).map((r) => r.name), chat: Store.setting(Store.SETTING_CHAT, false) === true });
    if (!res.go) return;
    this.#working(true);
    try {
      if (Store.current()?.state === "open") { const c = await api.closeSession(); if (!c.ok) { this.#fail(c); return; } }
      const r = await api.award({ chat: res.chat });
      if (!r.ok) { this.#fail(r); return; }
      const n = (r.rows ?? []).filter((x) => x.st === 1).length;
      this.#flash(r.state === "done" ? t("IPL.Session.UI.Award.done", { n }) : t("IPL.Session.UI.Award.partial"), r.state === "done" ? "ok" : "warn");
      this.#stamp();
    } finally { this.#working(false); }
  }
  async #undo() {
    if (this.#busy) return;
    const vm = this.#vm, s = Store.current();
    if (!s?.award) return;
    const name = (id) => api.heroInfo(id).name;
    const rows = s.award.rows.filter((r) => r.st === 1).map((r) => ({ name: name(r.h), before: r.before, after: r.after }));
    if (!(await D.confirmUndo(rows))) return;
    this.#working(true);
    try {
      const r = await api.undo({ mode: "strict" });
      if (!r.ok) { this.#fail(r); return; }
      const drift = (r.results ?? []).filter((x) => x.status === "drift");
      if (drift.length) {
        const choice = await D.confirmDrift(drift.map((x) => ({ name: name(x.h), current: x.current, expected: x.expected })));
        if (choice === "relative") { const r2 = await api.undo({ mode: "relative" }); if (!r2.ok) { this.#fail(r2); return; } }
      }
      if (!Store.current()?.award) this.#flash(t("IPL.Session.UI.Undo.done"), "ok");
    } finally { this.#working(false); }
  }
  async #resume() {
    const aw = Store.current()?.award;
    this.#working(true);
    try { const r = aw?.state === "undoing" ? await api.undo({ mode: "strict" }) : await api.award({}); if (!r.ok) this.#fail(r); } finally { this.#working(false); }
  }
  #working(on) {
    this.#busy += on ? 1 : -1;
    if (this.#busy < 0) this.#busy = 0;
    this.#root?.classList.toggle("ips-busy", this.#busy > 0);
    setAttr(this.#root, "aria-busy", this.#busy > 0 ? "true" : null);
  }
  /** A short stamp when the award lands (transform + opacity; the reduced-motion twin is in the CSS). */
  #stamp() { const n = this.#root; if (!n) return; n.classList.remove("ips-stamping"); void n.offsetWidth; n.classList.add("ips-stamping"); this.#later(() => n.classList.remove("ips-stamping"), 900); }
}
