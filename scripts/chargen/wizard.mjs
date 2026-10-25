/* Character generator WIZARD WINDOW (phase 4 shell). The module's first real ApplicationV2.
   Plain ApplicationV2 (no Handlebars): the frame is built once as DOM, then four regions are repainted independently:
     stepper (ol), step body (one step module at a time, steps/index.mjs), live preview (aside), footer (undo/redo, seed, back/next).
   Repainting a region never rebuilds the frame, so the window keeps its position / focus; the body restores focus by data-fk / name.
   State: ONE serialisable object (state.mjs) held in a history (undo / redo, 50 steps). A draft is kept in localStorage for 7 days.
   Free navigation: Back / Next / the stepper never block; problems show as badges, in the preview and in the footer note, and Review
   blocks Apply while rules.validate has errors (decision: all attribute points must be spent). The wizard NEVER writes to the actor:
   only apply() (called from the Review step) does. Closing a touched, not applied wizard asks first (the draft is kept).
   Strings: lang.mjs (IPC.*). Style: styles/chargen.css (root .ipc-app). Interface for step modules: steps/index.mjs. */
import { t } from "./lang.mjs";
import * as S from "./state.mjs";
import { newSeed } from "./rng.mjs";
import { STEP_IDS, RANKS, validate, derive, attributeBudget, slots, ATTRS } from "./rules.mjs";
import { STEPS } from "./steps/index.mjs";
import { esc, icon, attrShort, rankName, msgText } from "./steps/util.mjs";
import { describeActor } from "./import.mjs";

const MOD = "invincible-plus-ultra";
const { ApplicationV2, DialogV2 } = foundry.applications.api;
const DRAFT_TTL = 7 * 864e5;
const LIVE_THROTTLE = 700;
const MARK = { current: "fa-solid fa-caret-right", done: "fa-solid fa-circle-check", issue: "fa-solid fa-triangle-exclamation", todo: "fa-regular fa-circle" };

const chargenApi = () => game.modules.get(MOD)?.api?.chargen;
const setting = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };
const idFor = (actor) => `ipc-chargen-${String(actor.uuid ?? actor.id).replace(/[^A-Za-z0-9_-]/g, "-")}`;
const draftKey = (actor) => `ipc-chargen-draft:${actor.uuid}`;

export class ChargenApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["invincible-plus-ultra", "ipc-app"],
    tag: "div",
    window: { icon: "fa-solid fa-wand-magic-sparkles", resizable: true, contentClasses: ["ipc-content"] },
    position: { width: 940, height: 660 }
  };

  /** open (or focus) the wizard of an actor */
  static async open(actor) {
    const existing = foundry.applications.instances.get(idFor(actor));
    if (existing) {
      if (existing.minimized) await existing.maximize?.();
      await existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    const app = new ChargenApp({ actor });
    await app.render({ force: true });
    return app;
  }

  // ---------- instance state ----------
  actor;
  #root = null;
  #hist;
  #phase = "loading";                  // loading | blocked | ready
  #blocked = null;                     // { kind, ... } for the empty state
  #stepId = "start";
  #visited = new Set(["start"]);
  #ctxs = new Map();
  #loaded = new Set();
  #info;
  #draft = null;
  #provider = null;
  #valid = null;                       // cached validate(state)
  #applied = false;
  #closing = false;
  #navToken = 0;
  #lastCoalesce = null; #lastCoalesceAt = 0;
  #draftTimer = 0;
  #lastPoints = null; #liveAt = 0;
  #busy = 0;
  #bound = false;
  #narrow = false;                     // single-column layout: the stepper shows icons, names go to tooltips

  constructor({ actor, ...options } = {}) {
    options.id = idFor(actor);
    options.position = { ...(options.position ?? {}) };
    const w = Math.max(560, Math.min(940, window.innerWidth - 24)), h = Math.max(440, Math.min(660, window.innerHeight - 24));
    options.position.width ??= w; options.position.height ??= h;
    super(options);
    this.actor = actor;
    const rank = RANKS[setting("chargenRank", "global")] ? setting("chargenRank", "global") : "global";
    this.#hist = S.createHistory(S.createState({ seed: newSeed(), rank, mode: "manual" }));
    this.#info = describeActor(actor);
    this.#draft = this.#readDraft();
  }

  get title() { return t("IPC.Window.Title", { actor: this.actor?.name ?? "" }); }
  get state() { return this.#hist.present; }
  get stepId() { return this.#stepId; }

  // ---------- ApplicationV2 plumbing ----------
  async _prepareContext() { return {}; }
  async _renderHTML() { return (this.#root ??= this.#buildFrame()); }
  _replaceHTML(result, content) { if (!content.contains(result)) content.replaceChildren(result); }
  async _onFirstRender() { /* the frame is painted in _onRender */ }
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!this.#bound) { this.#bound = true; this.#bind(); this.#boot(); }
    else if (this.#phase === "ready") this.#paintAll();
  }
  _onClose() { clearTimeout(this.#draftTimer); this.#flushDraft(); }

  async close(options = {}) {
    if (!options.force && this.#isDirty() && !this.#closing) {
      this.#closing = true;
      let ok = false;
      try {
        ok = await DialogV2.confirm({
          window: { title: t("IPC.Close.Title"), icon: "fa-solid fa-triangle-exclamation" },
          classes: ["ipc-dialog"],
          content: `<p>${esc(t("IPC.Close.Body"))}</p>`,
          yes: { label: t("IPC.Close.Yes") },
          no: { label: t("IPC.Close.No"), default: true },
          rejectClose: false, modal: false
        });
      } finally { this.#closing = false; }
      if (!ok) return this;
    }
    return super.close(options);
  }

  // ---------- frame ----------
  #buildFrame() {
    const root = document.createElement("div");
    root.className = "ipc-shell";
    root.dataset.phase = "loading";
    root.innerHTML = `
      <nav class="ipc-stepper" aria-label="${esc(t("IPC.Stepper.Label"))}"><ol class="ipc-steps"></ol></nav>
      <div class="ipc-main"><div class="ipc-body" tabindex="-1"></div></div>
      <aside class="ipc-preview" aria-label="${esc(t("IPC.Preview.Label"))}"></aside>
      <footer class="ipc-foot"></footer>
      <p class="ipc-sr" aria-live="polite" data-live></p>`;
    return root;
  }
  #q(sel) { return this.#root?.querySelector(sel) ?? null; }

  #bind() {
    const root = this.#root;
    root.addEventListener("click", (ev) => {
      const el = ev.target instanceof Element ? ev.target.closest("[data-ipc]") : null;
      if (!el || !root.contains(el) || el.getAttribute("aria-disabled") === "true") return;
      const a = el.dataset.ipc;
      if (a === "step") this.go(el.dataset.step);
      else if (a === "back") this.go(this.#neighbour(-1));
      else if (a === "next") this.go(this.#neighbour(1));
      else if (a === "undo") this.#history(-1);
      else if (a === "redo") this.#history(1);
      else if (a === "build-tables") this.#buildTables(el);
      else if (a === "retry") this.#boot();
      else if (a === "close") this.close({ force: true });
    });
    new ResizeObserver(() => {
      const narrow = (root.parentElement?.clientWidth ?? 999) < 560;
      if (narrow !== this.#narrow) { this.#narrow = narrow; this.#paintStepper(); }
    }).observe(root.parentElement ?? root);
    root.addEventListener("keydown", (ev) => {
      if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
      const tag = ev.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ev.target?.isContentEditable) return;
      const k = ev.key.toLowerCase();
      if (k === "z" && !ev.shiftKey) { ev.preventDefault(); this.#history(-1); }
      else if (k === "y" || (k === "z" && ev.shiftKey)) { ev.preventDefault(); this.#history(1); }
    });
  }

  // ---------- boot: environment check -> blocked | ready ----------
  async #boot() {
    this.#setPhase("loading");
    const api = chargenApi();
    try {
      if (!api?.catalog || !api?.apply || !api?.tables) { this.#blocked = { kind: "api" }; return this.#setPhase("blocked"); }
      const av = api.catalog.available();
      if (!av.ok) { this.#blocked = { kind: "core", missing: av.missing }; return this.#setPhase("blocked"); }
      const st = await api.tables.status();
      const ready = !!st.pack && st.built > 0 && (!st.bookOk || !st.missing.length);
      if (!ready) { this.#blocked = { kind: "tables", status: st }; return this.#setPhase("blocked"); }
    } catch (err) {
      console.error(`${MOD} | chargen environment check failed`, err);
      this.#blocked = { kind: "error", error: err?.message ?? String(err) };
      return this.#setPhase("blocked");
    }
    this.#blocked = null;
    this.#setPhase("ready");
    this.#revalidate();
    this.#paintAll();
    await this.#enter(this.#stepId, { focus: false });
  }

  #setPhase(phase) {
    this.#phase = phase;
    this.#root.dataset.phase = phase;
    if (phase === "ready") return;
    const body = this.#q(".ipc-body");
    if (phase === "loading") body.innerHTML = `<p class="ipc-loading">${icon("fa-solid fa-spinner fa-spin-pulse")} ${esc(t("IPC.Empty.Loading"))}</p>`;
    else this.#paintBlocked();
    this.#q(".ipc-steps").replaceChildren();
    this.#q(".ipc-preview").replaceChildren();
    this.#q(".ipc-foot").replaceChildren();
  }

  #paintBlocked() {
    const b = this.#blocked ?? { kind: "error", error: "" }, gm = game.user.isGM;
    let title = t("IPC.Empty.Title"), text = "", actions = "";
    if (b.kind === "core") { title = t("IPC.Empty.CoreTitle"); text = t("IPC.Empty.Core", { missing: b.missing.join(", ") }); }
    else if (b.kind === "api") text = t("IPC.Empty.Api");
    else if (b.kind === "error") text = t("IPC.Empty.Error", { error: b.error });
    else if (b.kind === "tables") {
      const st = b.status;
      title = t("IPC.Empty.TablesTitle");
      text = !st.pack ? t("IPC.Empty.NoPack") : (!st.bookInstalled ? t("IPC.Empty.NoBook") : (gm ? t("IPC.Empty.TablesGm") : t("IPC.Empty.TablesPlayer")));
      if (st.error && st.pack) text += ` ${st.error}`;
      if (gm && st.pack && st.bookInstalled) actions += `<button type="button" class="ipc-btn ipc-btn-primary" data-ipc="build-tables" data-fk="build">${icon("fa-solid fa-hammer")} ${esc(t("IPC.Empty.Build"))}</button>`;
      if (b.result) text += ` ${b.result}`;
    }
    actions += `<button type="button" class="ipc-btn" data-ipc="retry">${icon("fa-solid fa-rotate")} ${esc(t("IPC.Empty.Retry"))}</button><button type="button" class="ipc-btn ipc-btn-quiet" data-ipc="close">${esc(t("IPC.Empty.Close"))}</button>`;
    this.#q(".ipc-body").innerHTML = `<section class="ipc-empty-state" aria-labelledby="ipc-empty-h"><h2 class="ipc-plate" id="ipc-empty-h" tabindex="-1"><span>${esc(title)}</span></h2><p>${esc(text)}</p><div class="ipc-actions">${actions}</div></section>`;
  }

  async #buildTables(btn) {
    const api = chargenApi();
    btn.setAttribute("aria-disabled", "true");
    btn.innerHTML = `${icon("fa-solid fa-spinner fa-spin-pulse")} ${esc(t("IPC.Empty.Building"))}`;
    try {
      const rep = await api.tables.build();
      ui.notifications.info(rep?.message ?? t("IPC.Empty.Built"));
      await this.#boot();
    } catch (err) {
      console.error(`${MOD} | chargen tables build failed`, err);
      this.#blocked = { ...this.#blocked, result: t("IPC.Empty.BuildFailed", { error: err?.message ?? String(err) }) };
      this.#paintBlocked();
    }
  }

  // ---------- validation ----------
  #revalidate() {
    const v = validate(this.state);
    const by = {};
    for (const i of v.issues) (by[i.step] ??= { errors: [], warnings: [], infos: [] })[i.severity === "error" ? "errors" : i.severity === "warn" ? "warnings" : "infos"].push(i);
    this.#valid = { all: { errors: v.errors, warnings: v.warnings, infos: v.issues.filter((i) => i.severity === "info") }, by };
  }
  #issuesOf(id) { return this.#valid?.by[id] ?? { errors: [], warnings: [], infos: [] }; }

  // ---------- step context ----------
  #ctx(id) {
    let ctx = this.#ctxs.get(id);
    if (ctx) return ctx;
    const app = this;
    ctx = {
      id, app, data: {}, t, esc,
      get actor() { return app.actor; },
      get state() { return app.state; },
      get rank() { return RANKS[app.state.rank] ?? null; },
      get derived() { return derive(app.state, app.bonuses); },
      get budget() { return attributeBudget(app.state); },
      get issues() { return app.#issuesOf(id); },
      get allIssues() { return app.#valid.all; },
      get info() { return app.#info; },
      get draft() { return app.#draft; },
      get api() { return chargenApi(); },
      get catalog() { return chargenApi()?.catalog; },
      get apply() { return chargenApi()?.apply; },
      update: (fn, o = {}) => app.commit(fn(app.state), { ...o, step: o.touch === false ? null : id }),
      commit: (state, o = {}) => app.commit(state, { ...o, step: o.touch === false ? null : id }),
      replace: (state, o) => app.replaceState(state, o),
      rerender: () => app.#paintBody({ restoreFocus: true }),
      go: (to) => app.go(to),
      announce: (text) => app.announce(text),
      busy: (p) => app.#busyWrap(p),
      provider: () => app.#getProvider(),
      restoreDraft: () => app.#restoreDraft(),
      discardDraft: () => { app.#clearDraft(); app.#draft = null; }
    };
    this.#ctxs.set(id, ctx);
    return ctx;
  }
  /** item-effect bonuses for the live preview (health, resolve, slugfest, resources, reputation): filled by phases 5c/5d */
  bonuses = {};

  #getProvider() { return (this.#provider ??= chargenApi().provider({ excludeActorId: this.actor.id })); }
  #busyWrap(p) {
    this.#busy++; this.#root?.classList.add("ipc-busy");
    return Promise.resolve(p).finally(() => { if (--this.#busy <= 0) { this.#busy = 0; this.#root?.classList.remove("ipc-busy"); } });
  }

  // ---------- navigation ----------
  #neighbour(d) { const i = STEP_IDS.indexOf(this.#stepId) + d; return STEP_IDS[Math.min(STEP_IDS.length - 1, Math.max(0, i))]; }

  async go(id, { focus = true } = {}) {
    if (!STEPS[id] || this.#phase !== "ready") return;
    if (id === this.#stepId && this.#q(".ipc-step")) { if (focus) this.focusBody(".ipc-plate"); return; }
    await this.#enter(id, { focus, animate: true });
  }

  async #enter(id, { focus = true, animate = false } = {}) {
    const token = ++this.#navToken;
    this.#stepId = id;
    this.#visited.add(id);
    this.#revalidate();
    this.#paintStepper(); this.#paintFooter(); this.#paintPreview();
    const step = STEPS[id], ctx = this.#ctx(id);
    if ((step.load && !this.#loaded.has(id)) || id === "review") {
      this.#q(".ipc-body").innerHTML = `<p class="ipc-loading">${icon("fa-solid fa-spinner fa-spin-pulse")} ${esc(t("IPC.Empty.LoadingStep"))}</p>`;
      try { await step.load?.(ctx); this.#loaded.add(id); } catch (err) {
        console.error(`${MOD} | chargen step "${id}" failed to load`, err);
        if (token !== this.#navToken) return;
        this.#q(".ipc-body").innerHTML = `<section class="ipc-empty-state"><p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Empty.StepFailed", { error: err?.message ?? String(err) }))}</p><div class="ipc-actions"><button type="button" class="ipc-btn" data-ipc="retry-step">${esc(t("IPC.Empty.Retry"))}</button></div></section>`;
        this.#q('[data-ipc="retry-step"]')?.addEventListener("click", () => this.#enter(id, { focus, animate }), { once: true });
        return;
      }
    }
    if (token !== this.#navToken) return;
    this.#paintBody({ animate });
    if (focus) this.focusBody(".ipc-plate");
    this.announce(t("IPC.Stepper.Entered", { step: t(`IPC.Step.${id}.Title`), n: STEP_IDS.indexOf(id) + 1, total: STEP_IDS.length }));
  }

  /** focus an element in the body (the step heading by default) */
  focusBody(selector = ".ipc-plate") {
    const el = this.#q(".ipc-body")?.querySelector(selector);
    if (!el) return;
    if (!el.hasAttribute("tabindex") && !/^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(el.tagName)) el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: false });
  }

  announce(text) {
    const live = this.#q("[data-live]");
    if (!live || !text) return;
    live.textContent = "";
    requestAnimationFrame(() => { live.textContent = text; });
  }

  // ---------- state changes ----------
  /** commit a new state. o = { coalesce, body, step (marks it touched), silent } */
  commit(next, o = {}) {
    if (!next || next === this.state) return;
    let n = next;
    if (o.step && !n.touched?.[o.step] && STEP_IDS.includes(o.step) && o.step !== "start" && o.step !== "review") n = S.markTouched(n, o.step);
    const rankBefore = this.state.rank;
    if (o.coalesce && o.coalesce === this.#lastCoalesce && Date.now() - this.#lastCoalesceAt < 1500) this.#hist = { ...this.#hist, present: n };
    else this.#hist = S.pushHistory(this.#hist, n);
    this.#lastCoalesce = o.coalesce ?? null; this.#lastCoalesceAt = Date.now();
    if (n.rank !== rankBefore) { try { game.settings.set(MOD, "chargenRank", n.rank); } catch { /* setting missing */ } }
    this.#afterChange({ body: !!o.body });
  }

  /** swap the whole state (roll a hero, import a hero, restore a draft) */
  replaceState(next, { visitAll = false, go = null } = {}) {
    this.#hist = S.pushHistory(this.#hist, next);
    this.#lastCoalesce = null;
    if (visitAll) for (const id of STEP_IDS) this.#visited.add(id);
    this.#revalidate();
    this.#afterChange({ external: true });
    if (go) this.go(go);
    else this.#paintBody({ restoreFocus: false });
  }

  #afterChange({ body = false, external = false } = {}) {
    this.#revalidate();
    this.#paintStepper(); this.#paintPreview(); this.#paintFooter();
    this.#scheduleDraft();
    if (external) STEPS[this.#stepId].onState?.(this.#ctx(this.#stepId));
    if (body) this.#paintBody({ restoreFocus: true });
  }

  #history(dir) {
    const h = this.#hist, next = dir < 0 ? S.undo(h) : S.redo(h);
    if (next === h) return;
    this.#hist = next; this.#lastCoalesce = null;
    this.#afterChange({ external: true });
    this.#paintBody({ restoreFocus: false });
    this.announce(t(dir < 0 ? "IPC.Footer.Undone" : "IPC.Footer.Redone"));
  }

  // ---------- draft + dirty ----------
  #isDirty() { return this.#phase === "ready" && !this.#applied && this.#hist.past.length > 0; }
  markApplied(flag = true) {
    this.#applied = !!flag;
    if (flag) { this.#clearDraft(); this.#draft = null; }
    const title = this.element?.querySelector(".window-title");   // the hero may have been renamed by the apply
    if (title) title.textContent = this.title;
  }
  #readDraft() {
    try {
      const raw = localStorage.getItem(draftKey(this.actor));
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d?.at || Date.now() - d.at > DRAFT_TTL) { localStorage.removeItem(draftKey(this.actor)); return null; }
      return { at: d.at, state: S.deserialize(d.state) };
    } catch { return null; }
  }
  #scheduleDraft() {
    clearTimeout(this.#draftTimer);
    this.#draftTimer = setTimeout(() => this.#flushDraft(), 500);
  }
  #flushDraft() {
    try {
      if (this.#isDirty()) localStorage.setItem(draftKey(this.actor), JSON.stringify({ at: Date.now(), state: S.serialize(this.state) }));
      else if (this.#applied) localStorage.removeItem(draftKey(this.actor));
    } catch { /* storage unavailable: the wizard works without it */ }
  }
  #clearDraft() { try { localStorage.removeItem(draftKey(this.actor)); } catch { /* ignore */ } }
  #restoreDraft() {
    const d = this.#draft;
    if (!d) return;
    this.#draft = null;
    this.replaceState(d.state, { visitAll: true, go: "rank" });
    this.announce(t("IPC.Start.DraftRestored"));
  }

  // ---------- painting ----------
  #paintAll() { this.#paintStepper(); this.#paintPreview(); this.#paintFooter(); }

  #paintStepper() {
    if (this.#phase !== "ready") return;
    const ol = this.#q(".ipc-steps");
    const total = this.#valid.all.errors.length;
    const html = STEP_IDS.map((id, i) => {
      const iss = id === "review" ? { errors: this.#valid.all.errors } : this.#issuesOf(id);
      const errs = iss.errors.length;
      const cur = id === this.#stepId, seen = this.#visited.has(id);
      const state = cur ? "current" : !seen ? "todo" : errs ? "issue" : "done";
      const label = t(`IPC.Step.${id}.Label`);
      const showBadge = errs > 0 && (seen || cur) && id !== "start";
      const sr = [t("IPC.Stepper.Of", { n: i + 1, total: STEP_IDS.length }), t(`IPC.Stepper.State.${state}`), showBadge ? t("IPC.Stepper.Problems", { n: errs }) : ""].filter(Boolean).join(", ");
      return `<li class="ipc-st" data-state="${state}"><button type="button" class="ipc-st-btn" data-ipc="step" data-step="${id}"${this.#narrow ? ` data-tooltip="${esc(label)}" data-tooltip-direction="DOWN"` : ""}${cur ? ' aria-current="step"' : ""}>
        <span class="ipc-st-mark">${icon(MARK[state])}</span><span class="ipc-st-name">${esc(label)}</span>${showBadge ? `<span class="ipc-st-badge" aria-hidden="true">${errs}</span>` : ""}<span class="ipc-sr">${esc(sr)}</span></button></li>`;
    }).join("");
    if (ol.dataset.html !== html) { ol.innerHTML = html; ol.dataset.html = html; }
    void total;
  }

  #paintPreview() {
    if (this.#phase !== "ready") return;
    const s = this.state, el = this.#q(".ipc-preview");
    const r = RANKS[s.rank], b = attributeBudget(s), d = derive(s, this.bonuses), S_ = slots(s);
    const over = b.left < 0;
    const name = s.heroName || this.actor.name;
    const errs = this.#valid.all.errors, warns = this.#valid.all.warnings;
    const pointsText = over ? t("IPC.Preview.Over", { n: -b.left }) : t("IPC.Preview.Left");
    const issues = errs.length || warns.length
      ? `<ul class="ipc-pv-issues">${errs.slice(0, 3).map((i) => `<li class="ipc-iss-err">${icon("fa-solid fa-circle-exclamation")}<span>${esc(msgText(i))}</span></li>`).join("")}${errs.length > 3 ? `<li class="ipc-muted">${esc(t("IPC.Preview.More", { n: errs.length - 3 }))}</li>` : ""}</ul>`
      : `<p class="ipc-ok">${icon("fa-solid fa-circle-check")} ${esc(t("IPC.Preview.Clean"))}</p>`;
    const html = `
      <h3 class="ipc-pv-name">${esc(name)}</h3>
      <p class="ipc-pv-rank">${esc(rankName(s.rank))}${r ? ` <span class="ipc-muted">${esc(t("IPC.Preview.Cap", { cap: r.cap }))}</span>` : ""}</p>
      <div class="ipc-pv-points${over ? " ipc-over" : ""}" role="group" aria-label="${esc(t("IPC.Preview.Points"))}"><span class="ipc-pv-num" data-pop>${b.left}</span><span class="ipc-pv-cap">${esc(pointsText)}</span></div>
      <p class="ipc-pv-budget">${esc(t("IPC.Preview.Budget", { spent: b.spent, budget: b.budget }))}</p>
      <ul class="ipc-pv-attrs" aria-label="${esc(t("IPC.Preview.Attrs"))}">${ATTRS.map((k) => `<li><span>${esc(attrShort(k))}</span><b>${s.attrs?.[k] ?? 0}</b></li>`).join("")}</ul>
      <dl class="ipc-pv-vitals"><div><dt>${esc(t("IPC.Preview.Health"))}</dt><dd>${d.health}</dd></div><div><dt>${esc(t("IPC.Preview.Resolve"))}</dt><dd>${d.resolve}</dd></div><div><dt>${esc(t("IPC.Preview.Slugfest"))}</dt><dd>${d.slugfest}</dd></div></dl>
      <p class="ipc-pv-slots${r && S_ > r.powers ? " ipc-over" : ""}">${esc(t("IPC.Preview.Slots", { used: S_, max: r?.powers ?? 0 }))}</p>
      <div class="ipc-pv-sec"><h4>${esc(t("IPC.Preview.Problems", { n: errs.length }))}</h4>${issues}</div>`;
    if (el.dataset.html === html) return;
    el.innerHTML = html; el.dataset.html = html;
    if (this.#lastPoints !== null && this.#lastPoints !== b.left) {
      const num = el.querySelector("[data-pop]");
      if (num && !matchMedia("(prefers-reduced-motion: reduce)").matches) { num.classList.add("ipc-pop"); num.addEventListener("animationend", () => num.classList.remove("ipc-pop"), { once: true }); }
      if (Date.now() - this.#liveAt > LIVE_THROTTLE) { this.#liveAt = Date.now(); this.announce(over ? t("IPC.Preview.OverLive", { n: -b.left }) : t("IPC.Preview.LeftLive", { n: b.left })); }
    }
    this.#lastPoints = b.left;
  }

  #paintFooter() {
    if (this.#phase !== "ready") return;
    const foot = this.#q(".ipc-foot"), id = this.#stepId, i = STEP_IDS.indexOf(id);
    const iss = id === "review" ? this.#valid.all : this.#issuesOf(id);
    const prev = STEP_IDS[i - 1], next = STEP_IDS[i + 1];
    let note = "";
    if (iss.errors.length && id !== "review" && id !== "start") note = `<span class="ipc-note ipc-note-err" role="status">${icon("fa-solid fa-circle-exclamation")} ${esc(msgText(iss.errors[0]))}${iss.errors.length > 1 ? ` <span class="ipc-muted">${esc(t("IPC.Preview.More", { n: iss.errors.length - 1 }))}</span>` : ""}</span>`;
    const hist = this.#hist;
    const focusKey = foot.contains(document.activeElement) ? document.activeElement.dataset?.ipc : null;   // keep focus on undo / redo after the repaint
    foot.innerHTML = `
      <div class="ipc-foot-l">
        <button type="button" class="ipc-btn ipc-btn-icon" data-ipc="undo" aria-label="${esc(t("IPC.Footer.Undo"))}" data-tooltip="${esc(t("IPC.Footer.Undo"))}"${hist.past.length ? "" : ' aria-disabled="true"'}>${icon("fa-solid fa-rotate-left")}</button>
        <button type="button" class="ipc-btn ipc-btn-icon" data-ipc="redo" aria-label="${esc(t("IPC.Footer.Redo"))}" data-tooltip="${esc(t("IPC.Footer.Redo"))}"${hist.future.length ? "" : ' aria-disabled="true"'}>${icon("fa-solid fa-rotate-right")}</button>
        <span class="ipc-seed">${esc(t("IPC.Footer.Seed"))} <code>${esc(this.state.seed)}</code></span>
      </div>
      <div class="ipc-foot-r">${note}
        <button type="button" class="ipc-btn" data-ipc="back"${prev ? "" : ' aria-disabled="true"'}>${icon("fa-solid fa-arrow-left")} ${esc(t("IPC.Footer.Back"))}</button>
        ${next ? `<button type="button" class="ipc-btn ipc-btn-primary" data-ipc="next">${esc(t("IPC.Footer.Next", { step: t(`IPC.Step.${next}.Label`) }))} ${icon("fa-solid fa-arrow-right")}</button>` : ""}
      </div>`;
    if (focusKey) foot.querySelector(`[data-ipc="${focusKey}"]`)?.focus({ preventScroll: true });
  }

  #focusKey(el) {
    if (!el) return null;
    return el.dataset?.fk ? `[data-fk="${CSS.escape(el.dataset.fk)}"]` : el.name ? `[name="${CSS.escape(el.name)}"]` : null;
  }

  #paintBody({ animate = false, restoreFocus = false } = {}) {
    if (this.#phase !== "ready") return;
    const host = this.#q(".ipc-body"), id = this.#stepId, step = STEPS[id], ctx = this.#ctx(id);
    let key = null, sel = null;
    const act = document.activeElement;
    if (restoreFocus && act && host.contains(act)) { key = this.#focusKey(act); sel = act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null; }
    const scroll = restoreFocus ? host.scrollTop : 0;
    let inner = "";
    try { inner = step.render(ctx); } catch (err) {
      console.error(`${MOD} | chargen step "${id}" render failed`, err);
      inner = `<p class="ipc-error" role="alert">${icon("fa-solid fa-triangle-exclamation")} ${esc(t("IPC.Empty.StepFailed", { error: err?.message ?? String(err) }))}</p>`;
    }
    host.innerHTML = `<section class="ipc-step${animate ? " ipc-enter" : ""}" data-step="${id}" aria-labelledby="ipc-h-${id}">
      <header class="ipc-step-head"><h2 class="ipc-plate" id="ipc-h-${id}" tabindex="-1"><span>${esc(t(`IPC.Step.${id}.Title`))}</span></h2><p class="ipc-hint">${esc(t(`IPC.Step.${id}.Hint`))}</p></header>
      <div class="ipc-step-body">${inner}</div></section>`;
    const section = host.querySelector(".ipc-step");
    if (animate) section.addEventListener("animationend", () => section.classList.remove("ipc-enter"), { once: true });
    try { step.mount?.(ctx, section); } catch (err) { console.error(`${MOD} | chargen step "${id}" mount failed`, err); }
    if (restoreFocus) {
      host.scrollTop = scroll;
      const el = key ? host.querySelector(key) : null;
      if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) { try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not a text input */ } } }
    } else host.scrollTop = 0;
  }
}
