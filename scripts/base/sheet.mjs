/* Team & Base card SHEET (phase B4b). The card is a real Actor (store.mjs); this is its ActorSheetV2, registered for the host type and chosen only for flagged
   actors through the native per-document override flags.core.sheetClass (store.SHEET_ID), so ordinary vehicles keep the system's sheet.
   Plain DOM like the chargen wizard (no Handlebars, module.json needs no template declaration). The frame is built once; four regions are repainted
   independently (head, tab bar, tab panel, footer facts) so the window keeps its position and focus. The frame, the header controls (token,
   portrait, sheet and ownership configuration, UUID copy) and the permission model (OBSERVER views, OWNER edits - the card policy decides whether
   an owner may write) come from the core sheet. What is inside a tab belongs to the tab modules (tabs/index.mjs documents the interface).
   Repaint rules: any change of the card actor, a member hero or the member list repaints from the live data (throttled, 120 ms); a region
   whose text field has focus is repainted on blur instead, so typing is never interrupted. Style: styles/base.css (root .ipb-app). */
import * as S from "./store.mjs";
import * as P from "./pure.mjs";
import * as Sync from "./sync.mjs";
import { TABS, tabById } from "./tabs/index.mjs";
import { t, tn } from "./lang.mjs";
import { esc, icon, rankName, reportError, guard } from "./util.mjs";
import { resolveConflicts, chooseHero } from "./dialogs.mjs";

const MOD = S.MODULE_ID;
const { ActorSheetV2 } = foundry.applications.sheets;
const TEXT_FIELD = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=range]), textarea";
const api = () => game.modules.get(MOD)?.api?.base;

export class BaseSheet extends ActorSheetV2 {
  static DEFAULT_OPTIONS = {
    classes: ["invincible-plus-ultra", "ipb-app", "ipb-sheet"],
    tag: "div",                                   // not a form: the inputs commit through our own handlers (an implicit form submit must never write to the actor)
    window: { icon: "fa-solid fa-people-roof", resizable: true, contentClasses: ["ipb-content"] },
    position: { width: 900, height: 660 }
  };

  /** open (or focus) the sheet of a team base; opts.tab = tab id. Resolves the sheet, or null when the team is gone / not visible. */
  static async open({ team, tab = null } = {}) {
    const actor = S.cardById(typeof team === "string" ? team : team?.id);
    if (!actor) { ui.notifications?.warn(t("IPB.Entry.Deleted")); return null; }
    const sheet = actor.sheet;
    if (!(sheet instanceof BaseSheet)) { ui.notifications?.warn(t("IPB.Entry.NoSheet")); return null; }
    if (tab && TABS.some((x) => x.id === tab)) sheet.#tab = tab;
    if (sheet.minimized) await sheet.maximize?.();
    await sheet.render({ force: true });
    sheet.bringToFront?.();
    if (tab && sheet.#painted) sheet.go(tab);
    return sheet;
  }
  /** all open base sheets (for the hooks in entry.mjs) */
  static all() { return [...foundry.applications.instances.values()].filter((a) => a instanceof BaseSheet); }
  /** repaint the sheets that show this team (or all of them without an argument: a member hero changed) */
  static refresh({ teamId = null } = {}) {
    for (const app of BaseSheet.all()) if (!teamId || app.teamId === teamId) app.refresh();
  }

  #tab = "base";
  #root = null;
  #bound = false;
  #painted = false;
  #timer = 0;
  #pending = new Set();
  #busy = 0;

  constructor(options = {}) {
    options.position = { ...(options.position ?? {}) };
    options.position.width ??= Math.max(640, Math.min(900, window.innerWidth - 24));
    options.position.height ??= Math.max(480, Math.min(660, window.innerHeight - 24));
    super(options);
  }

  get title() {
    const team = this.#team();
    return t("IPB.Window.Title", { team: team?.name ?? this.document.name });
  }
  /** the id of the world actor that carries the card (a token's synthetic actor shares it) */
  get teamId() { return this.document.id; }
  get tab() { return this.#tab; }

  // ---------- ApplicationV2 plumbing ----------
  async _prepareContext() { return {}; }
  async _renderHTML() { return (this.#root ??= this.#buildFrame()); }
  _replaceHTML(result, content) { if (!content.contains(result)) content.replaceChildren(result); }
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!this.#bound) { this.#bound = true; this.#bind(); }
    if (!this.#painted) { this.#painted = true; this.#paintAll(); } else this.refresh();       // later renders (a document update) go through the careful, focus-safe repaint
  }
  _onClose(options) { clearTimeout(this.#timer); this.#painted = false; super._onClose(options); }

  // ---------- drops: the Gear tab (B8) takes items and vehicles; until then nothing may land on the actor itself ----------
  async _onDropItem() { return null; }
  async _onDropActiveEffect() { return null; }
  async _onDropFolder() { return null; }

  // ---------- data ----------
  #team() { return S.get(this.teamId); }
  #ctx(team = this.#team()) {
    const members = S.members(team.id);
    const facts = S.memberFacts(team.id);
    const base = api();
    const self = this;
    return {
      app: this, team, B: team, actor: null, members, facts, stats: P.teamStats(facts),
      canEdit: S.canEdit(team.id), isStaff: S.isStaff(), user: game.user, api: base,
      update: (patch, opts) => guard(S.update(team.id, patch, opts)),
      run: (promise) => self.#run(promise),
      rerender: () => self.#paintBody(),
      announce: (text) => self.#announce(text),
      go: (id) => self.go(id),
      t, tn, esc, icon
    };
  }
  async #run(promise) {
    this.#busy++; this.#root?.classList.add("ipb-busy");
    try { return await promise; } catch (err) { reportError(err); return null; } finally { if (--this.#busy <= 0) { this.#busy = 0; this.#root?.classList.remove("ipb-busy"); } }
  }
  #announce(text) { const el = this.#root?.querySelector("[data-live]"); if (el) { el.textContent = ""; setTimeout(() => { el.textContent = text; }, 30); } }

  // ---------- frame ----------
  #buildFrame() {
    const root = document.createElement("div");
    root.className = "ipb-shell";
    root.innerHTML = `
      <header class="ipb-head"></header>
      <nav class="ipb-tabs" aria-label="${esc(t("IPB.Tab.List"))}"><div class="ipb-tablist" role="tablist"></div></nav>
      <div class="ipb-panel" id="${esc(this.id)}-panel" role="tabpanel" tabindex="0"></div>
      <footer class="ipb-foot" aria-label="${esc(t("IPB.Foot.Label"))}"></footer>
      <p class="ipb-sr" aria-live="polite" data-live></p>`;
    return root;
  }
  #q(sel) { return this.#root?.querySelector(sel) ?? null; }

  #bind() {
    const root = this.#root;
    root.addEventListener("click", (ev) => {
      const el = ev.target instanceof Element ? ev.target.closest("[data-ipb]") : null;
      if (!el || !root.contains(el) || el.disabled || el.getAttribute("aria-disabled") === "true") return;
      const a = el.dataset.ipb;
      if (a === "tab") this.go(el.dataset.tab);
      else if (a === "art") this.#chooseArt();
      else if (a === "member") this.#openSheet(el.dataset.actor);
      else if (a === "member-add") this.#addMember();
      else if (a === "update-sheets") this.#updateSheets();
    });
    root.addEventListener("change", (ev) => {
      const el = ev.target instanceof Element ? ev.target.closest("[data-ipb-field]") : null;
      if (el) this.#commitField(el);
    });
    root.addEventListener("keydown", (ev) => {
      const el = ev.target instanceof Element ? ev.target : null;
      if (!el) return;
      if (el.matches("[data-ipb-field]") && el.tagName === "INPUT") {
        if (ev.key === "Enter") { ev.preventDefault(); el.blur(); }
        else if (ev.key === "Escape") { ev.stopPropagation(); el.value = el.dataset.orig ?? el.value; el._ipbEsc = true; }   // revert here, blur on keyup (core closes the window on the Escape key-up otherwise)
      } else if (el.matches('[role="tab"]')) this.#tabKeys(ev, el);
    });
    root.addEventListener("keyup", (ev) => {
      const el = ev.target instanceof Element ? ev.target : null;
      if (ev.key === "Escape" && el?._ipbEsc) { ev.stopPropagation(); el._ipbEsc = false; el.blur(); }
    });
    // short windows (min size 640x480): hide the picture and tighten the header so the tab panel keeps room (data-compact, styles/base.css)
    new ResizeObserver(() => { const h = root.parentElement?.clientHeight ?? 999; root.dataset.compact = h < 580 ? "1" : "0"; }).observe(root.parentElement ?? root);
    root.addEventListener("focusin", (ev) => { const el = ev.target; if (el?.matches?.("[data-ipb-field]")) el.dataset.orig = el.value; });
    root.addEventListener("focusout", () => { setTimeout(() => this.#flushPending(), 0); });
  }

  // ---------- painting ----------
  #editing(region) {
    const ae = document.activeElement;
    return !!(region && ae && region.contains(ae) && ae.matches?.(TEXT_FIELD));
  }
  #flushPending() {
    if (!this.#pending.size || !this.rendered) return;
    for (const r of [...this.#pending]) {
      const el = this.#q(r);
      if (this.#editing(el)) continue;
      this.#pending.delete(r);
      if (r === ".ipb-head") this.#paintHead(); else if (r === ".ipb-panel") this.#paintBody(); else if (r === ".ipb-foot") this.#paintFoot(); else this.#paintTabs();
    }
  }
  /** capture the focused control (data-fk / name) and restore it after `fn` repainted its region */
  #keepFocus(region, fn) {
    const ae = document.activeElement;
    const inside = region && ae && region.contains(ae);
    const key = inside ? (ae.dataset?.fk || ae.getAttribute?.("name")) : null;
    const range = inside && typeof ae.selectionStart === "number" ? [ae.selectionStart, ae.selectionEnd] : null;
    fn();
    if (!key) return;
    const next = region.querySelector(`[data-fk="${CSS.escape(key)}"], [name="${CSS.escape(key)}"]`);
    if (next) { next.focus({ preventScroll: true }); if (range && typeof next.setSelectionRange === "function") try { next.setSelectionRange(...range); } catch { /* not a text field */ } }
  }

  #paintAll() {
    if (!this.#root) return;
    this.#root.dataset.phase = "card";
    const team = this.#team();
    if (!team) return;
    this.#paintHead(); this.#paintTabs(); this.#paintBody(); this.#paintFoot();
    this.#syncTitle();
  }
  #syncTitle() { const el = this.window?.title; if (el && el.textContent !== this.title) el.textContent = this.title; }

  refresh() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#repaint(), 120);
  }
  #repaint() {
    if (!this.rendered || !this.#root) return;
    const team = this.#team();
    if (!team) {
      ui.notifications?.warn(t("IPB.Entry.Deleted"));
      this.close({ force: true });
      return;
    }
    const regions = [[".ipb-head", () => this.#paintHead()], [".ipb-tablist", () => this.#paintTabs()], [".ipb-panel", () => this.#paintBody()], [".ipb-foot", () => this.#paintFoot()]];
    for (const [sel, fn] of regions) {
      const el = this.#q(sel);
      if (this.#editing(el)) this.#pending.add(sel); else fn();
    }
    this.#syncTitle();
  }

  // ----- head
  #paintHead() {
    const el = this.#q(".ipb-head");
    const team = this.#team();
    if (!el || !team) return;
    const ctx = this.#ctx(team);
    const { canEdit } = ctx;
    const art = team.img
      ? `<img src="${esc(team.img)}" alt="" loading="lazy">`
      : `<span class="ipb-art-empty">${icon("fa-solid fa-people-roof")}<span>${esc(team.base.kind || t("IPB.Head.ArtNone"))}</span></span>`;
    const artEl = canEdit
      ? `<button type="button" class="ipb-art-btn" data-ipb="art" data-fk="art" aria-label="${esc(t("IPB.Head.ArtChoose"))}" data-tooltip="${esc(t("IPB.Head.ArtChoose"))}">${art}</button>`
      : `<div class="ipb-art-btn ipb-art-static">${art}</div>`;
    const name = canEdit
      ? `<span class="ipb-plate"><input class="ipb-name" type="text" name="ipb-name" data-ipb-field="name" data-fk="name" maxlength="80" value="${esc(team.name)}" aria-label="${esc(t("IPB.Head.Name"))}" autocomplete="off" spellcheck="false"></span>`
      : `<h1 class="ipb-plate"><span class="ipb-name-ro">${esc(team.name)}</span></h1>`;
    const ranks = P.RANKS.map((r) => `<option value="${r}"${r === team.rank ? " selected" : ""}>${esc(rankName(r))}</option>`).join("");
    const rank = canEdit
      ? `<label class="ipb-rank"><span class="ipb-sr">${esc(t("IPB.Head.Rank"))}</span><select class="ipb-input" name="ipb-rank" data-ipb-field="rank" data-fk="rank">${ranks}</select></label>`
      : `<span class="ipb-rank-ro">${icon("fa-solid fa-shield-halved")} ${esc(rankName(team.rank))}</span>`;
    const motto = canEdit
      ? `<label class="ipb-motto"><span class="ipb-sr">${esc(t("IPB.Head.Motto"))}</span><input class="ipb-input" type="text" name="ipb-motto" data-ipb-field="motto" data-fk="motto" maxlength="160" value="${esc(team.motto)}" placeholder="${esc(t("IPB.Head.MottoHint"))}" autocomplete="off"></label>`
      : (team.motto ? `<p class="ipb-motto-ro">${esc(team.motto)}</p>` : "");
    const members = ctx.members;
    const mems = members.map((a) => `<li><button type="button" class="ipb-mem" data-ipb="member" data-actor="${esc(a.id)}" aria-label="${esc(t("IPB.Head.OpenSheet", { name: a.name }))}" data-tooltip="${esc(a.name)}"><img src="${esc(a.img)}" alt=""><span class="ipb-mem-name">${esc(a.name)}</span></button></li>`).join("");
    const hidden = members.hidden ? `<p class="ipb-mem-hidden">${icon("fa-solid fa-eye-slash")} ${esc(tn("IPB.Head.Hidden", members.hidden))}</p>` : "";
    const add = this.#canLinkSomething()
      ? `<button type="button" class="ipb-btn ipb-btn-icon ipb-btn-small ipb-add" data-ipb="member-add" data-fk="member-add" aria-label="${esc(t("IPB.Head.AddMember"))}" data-tooltip="${esc(t("IPB.Head.AddMember"))}">${icon("fa-solid fa-user-plus")}</button>` : "";
    const view = canEdit ? "" : `<p class="ipb-viewonly">${icon("fa-solid fa-lock")} <span>${esc(t("IPB.Head.ViewOnly"))}</span></p>`;
    this.#keepFocus(el, () => {
      el.innerHTML = `
        <div class="ipb-art">${artEl}</div>
        <div class="ipb-id">${name}<div class="ipb-id-row">${rank}${motto}</div>${view}</div>
        <section class="ipb-members" aria-labelledby="${esc(this.id)}-mh">
          <h2 id="${esc(this.id)}-mh" class="ipb-mem-h">${esc(t("IPB.Head.Members"))}</h2>
          <ul class="ipb-mems">${mems || `<li class="ipb-muted ipb-mem-none">${esc(t("IPB.Head.NoMembers"))}</li>`}${add ? `<li>${add}</li>` : ""}</ul>
          ${hidden}
        </section>`;
    });
  }
  #canLinkSomething() {
    return game.actors.some((a) => a.type === "superhero" && !S.linkOf(a) && (S.isStaff() || a.testUserPermission(game.user, "OWNER")));
  }

  // ----- tabs
  #paintTabs() {
    const list = this.#q(".ipb-tablist");
    const team = this.#team();
    if (!list || !team) return;
    const ctx = this.#ctx(team);
    list.innerHTML = TABS.map((tab) => {
      const sel = tab.id === this.#tab;
      const badge = tab.badge ? tab.badge(ctx) : "";
      return `<button type="button" role="tab" class="ipb-tab" id="${esc(this.id)}-tab-${tab.id}" data-ipb="tab" data-tab="${tab.id}" aria-selected="${sel}" aria-controls="${esc(this.id)}-panel" tabindex="${sel ? 0 : -1}">`
        + `${icon(tab.icon)}<span class="ipb-tab-name">${esc(t(`IPB.Tab.${tab.id}`))}</span>${badge !== "" && badge != null ? `<b class="ipb-tab-badge">${esc(String(badge))}</b>` : ""}</button>`;
    }).join("");
    this.#q(".ipb-panel")?.setAttribute("aria-labelledby", `${this.id}-tab-${this.#tab}`);
  }
  #tabKeys(ev, el) {
    const ids = TABS.map((x) => x.id);
    let i = ids.indexOf(el.dataset.tab);
    if (ev.key === "ArrowRight") i = (i + 1) % ids.length;
    else if (ev.key === "ArrowLeft") i = (i - 1 + ids.length) % ids.length;
    else if (ev.key === "Home") i = 0;
    else if (ev.key === "End") i = ids.length - 1;
    else return;
    ev.preventDefault();
    this.go(ids[i]);
    this.#q(`[role="tab"][data-tab="${ids[i]}"]`)?.focus();
  }
  go(id) {
    if (!TABS.some((x) => x.id === id)) return;
    const changed = id !== this.#tab;
    this.#tab = id;
    this.#paintTabs();
    this.#paintBody({ enter: changed });
    if (changed) this.#announce(t(`IPB.Tab.${id}`));
  }

  // ----- body
  #paintBody({ enter = false } = {}) {
    const panel = this.#q(".ipb-panel");
    const team = this.#team();
    if (!panel || !team) return;
    if (!enter && this.#editing(panel)) { this.#pending.add(".ipb-panel"); return; }
    const ctx = this.#ctx(team);
    const tab = tabById(this.#tab);
    this.#keepFocus(panel, () => {
      let html = "";
      try { html = tab.render(ctx); } catch (err) { console.error(`${MOD} | base tab ${tab.id} failed`, err); html = `<p class="ipb-error">${esc(String(err?.message ?? err))}</p>`; }
      panel.innerHTML = html;
      try { tab.mount?.(ctx, panel); } catch (err) { console.error(`${MOD} | base tab ${tab.id} mount failed`, err); }
    });
    if (enter) { panel.classList.remove("ipb-enter"); void panel.offsetWidth; panel.classList.add("ipb-enter"); panel.scrollTop = 0; }
  }

  // ----- footer facts
  #paintFoot() {
    const el = this.#q(".ipb-foot");
    const team = this.#team();
    if (!el || !team) return;
    const ctx = this.#ctx(team);
    const { stats } = ctx;
    const who = (x) => (x.value > 0 && x.who ? ` <span class="ipb-fact-who">${esc(x.who)}</span>` : ` <span class="ipb-fact-who">${esc(t("IPB.Foot.Nobody"))}</span>`);
    const dirty = team.policy.syncHeroes ? Sync.outOfDate(team.id) : [];
    const writable = dirty.filter((r) => r.canWrite).length;
    const chip = dirty.length
      ? `<div class="ipb-chip" role="status">${icon("fa-solid fa-triangle-exclamation")}<span>${esc(tn("IPB.Foot.OutOfDate", dirty.length))}</span>`
        + (writable ? `<button type="button" class="ipb-btn ipb-btn-small" data-ipb="update-sheets" data-fk="update-sheets">${esc(t("IPB.Foot.Update"))}</button>` : "") + `</div>` : "";
    const vis = ctx.members.hidden ? `<p class="ipb-foot-note">${esc(t("IPB.Foot.Visible"))}</p>` : "";
    this.#keepFocus(el, () => {
      el.innerHTML = `<dl class="ipb-facts">
        <div class="ipb-fact"><dt>${esc(t("IPB.Foot.Karma"))}</dt><dd>${stats.karmaPool}</dd></div>
        <div class="ipb-fact"><dt>${esc(t("IPB.Foot.Reputation"))}</dt><dd>${stats.maxReputation.value}${who(stats.maxReputation)}</dd></div>
        <div class="ipb-fact"><dt>${esc(t("IPB.Foot.Resources"))}</dt><dd>${stats.maxResources.value}${who(stats.maxResources)}</dd></div>
      </dl>${vis}${chip}`;
    });
  }


  // ---------- actions ----------
  async #commitField(el) {
    const team = this.#team();
    if (!team) return;
    const field = el.dataset.ipbField;
    let value = el.value;
    if (field === "name") { value = value.trim(); if (!value) { el.value = team.name; return; } }
    if (field === "motto") value = value.trim();
    if (value === team[field]) return;
    const res = await guard(S.update(team.id, { [field]: value }));
    if (!res) { el.value = team[field]; return; }
    if (field === "rank") this.#announce(rankName(value));
  }
  async #chooseArt() {
    const team = this.#team();
    if (!team || !S.canEdit(team.id)) return;
    const FP = foundry.applications.apps.FilePicker.implementation;
    new FP({ type: "image", current: team.img || "", callback: (path) => { guard(S.update(team.id, { img: path })); } }).render({ force: true });
  }
  #openSheet(actorId) {
    const a = game.actors.get(actorId);
    if (a) a.sheet.render({ force: true });
  }
  async #addMember() {
    const team = this.#team();
    if (!team) return;
    const free = game.actors.filter((a) => a.type === "superhero" && !S.linkOf(a) && (S.isStaff() || a.testUserPermission(game.user, "OWNER")));
    const hero = await chooseHero(team, free);
    if (!hero) return;
    const res = await this.#run(S.link(hero, team.id));
    if (res) this.#announce(t("IPB.Empty.Joined", { actor: hero.name, team: team.name }));
  }
  async #updateSheets() {
    const team = this.#team();
    if (!team) return;
    const res = await this.#run(Sync.push(team.id, { resolve: resolveConflicts }));
    if (!res) return;
    const msg = res.disabled ? t("IPB.Sync.Disabled") : res.pushed.length ? tn("IPB.Sync.Done", res.pushed.length) : t("IPB.Sync.Nothing");
    ui.notifications?.info(msg, { console: false });
    this.#announce(msg);
    this.refresh();
  }
}
