/* Team & Base card: the "this hero has no team base yet" window (phase B4 empty state, kept in B4b). A small ApplicationV2 with a hand-built DOM, same
   look as the sheet (styles/base.css, .ipb-shell[data-phase="empty"]). Three ways out for a hero without a base: create one (from the hero's own Team /
   Team base text when it has some), join an existing team base, or - for a player who may not create - ask the GM. When the hero gets a team (any
   way, also from another client) the window swaps itself for the base actor's sheet. The sheet itself is sheet.mjs. */
import * as S from "./store.mjs";
import * as Sync from "./sync.mjs";
import * as Relay from "./relay.mjs";
import { t } from "./lang.mjs";
import { esc, icon, reportError } from "./util.mjs";

const MOD = S.MODULE_ID;
const { ApplicationV2 } = foundry.applications.api;
const idForNew = (actorId) => `ipb-base-new-${actorId}`;
const textOf = (v) => String(v ?? "").trim();

export class NewTeamApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    classes: ["invincible-plus-ultra", "ipb-app"],
    tag: "div",
    window: { icon: "fa-solid fa-people-roof", resizable: true, contentClasses: ["ipb-content"] },
    position: { width: 560, height: 520 }
  };

  /** open (or focus) the window for a hero without a team */
  static async open({ actor }) {
    const existing = foundry.applications.instances.get(idForNew(actor.id));
    if (existing) {
      if (existing.minimized) await existing.maximize?.();
      existing.bringToFront?.();
      await existing.render({ force: true });
      return existing;
    }
    const app = new NewTeamApp({ actor });
    await app.render({ force: true });
    return app;
  }
  static all() { return [...foundry.applications.instances.values()].filter((a) => a instanceof NewTeamApp); }
  static refresh({ actorId = null } = {}) {
    for (const app of NewTeamApp.all()) if (!actorId || app.actor?.id === actorId || !app.actor) app.refresh();
  }

  actor = null;
  #root = null;
  #bound = false;
  #timer = 0;
  #busy = 0;
  #working = false;

  constructor({ actor, ...options } = {}) {
    options.id = idForNew(actor.id);
    options.position = { ...(options.position ?? {}) };
    options.position.width ??= Math.max(480, Math.min(560, window.innerWidth - 24));
    options.position.height ??= Math.max(420, Math.min(520, window.innerHeight - 24));
    super(options);
    this.actor = actor;
  }

  get title() { return t("IPB.Window.TitleNew", { actor: this.actor?.name ?? "" }); }

  async _prepareContext() { return {}; }
  async _renderHTML() { return (this.#root ??= this.#buildFrame()); }
  _replaceHTML(result, content) { if (!content.contains(result)) content.replaceChildren(result); }
  _onRender(context, options) {
    super._onRender?.(context, options);
    if (!this.#bound) { this.#bound = true; this.#bind(); }
    this.#paint();
  }
  _onClose() { clearTimeout(this.#timer); }

  #buildFrame() {
    const root = document.createElement("div");
    root.className = "ipb-shell";
    root.dataset.phase = "empty";
    root.innerHTML = `<div class="ipb-panel" id="${esc(this.id)}-panel" role="region"></div><p class="ipb-sr" aria-live="polite" data-live></p>`;
    return root;
  }
  #q(sel) { return this.#root?.querySelector(sel) ?? null; }
  #announce(text) { const el = this.#q("[data-live]"); if (el) { el.textContent = ""; setTimeout(() => { el.textContent = text; }, 30); } }
  async #run(promise) {
    this.#busy++; this.#root?.classList.add("ipb-busy");
    try { return await promise; } catch (err) { reportError(err); return null; } finally { if (--this.#busy <= 0) { this.#busy = 0; this.#root?.classList.remove("ipb-busy"); } }
  }
  #bind() {
    this.#root.addEventListener("click", (ev) => {
      const el = ev.target instanceof Element ? ev.target.closest("[data-ipb]") : null;
      if (!el || !this.#root.contains(el) || el.disabled) return;
      const a = el.dataset.ipb;
      if (a === "create") this.#create(false);
      else if (a === "create-text") this.#create(true);
      else if (a === "join") this.#join();
      else if (a === "ask") this.#ask();
    });
  }

  refresh() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#repaint(), 120);
  }
  async #repaint() {
    if (!this.rendered || !this.#root) return;
    const found = this.actor ? S.find(this.actor) : null;
    if (found) {                                                        // the hero got a team (here or on another client): show the base sheet instead
      if (!this.#working) { const { BaseSheet } = await import("./sheet.mjs"); await BaseSheet.open({ team: found.id }); this.close({ force: true }); }
      return;
    }
    if (!this.#working) this.#paint();
  }
  #keepFocus(region, fn) {
    const ae = document.activeElement;
    const key = region && ae && region.contains(ae) ? (ae.dataset?.fk || ae.getAttribute?.("name")) : null;
    fn();
    if (key) region.querySelector(`[data-fk="${CSS.escape(key)}"], [name="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }

  #paint() {
    const panel = this.#q(".ipb-panel");
    const actor = this.actor;
    if (!panel || !actor) return;
    const name = actor.name;
    const staff = S.isStaff();
    const allowed = staff || game.settings.get(MOD, S.SETTING_PLAYERS_CREATE) === true;
    const canCreate = allowed && (staff || actor.isOwner);
    const cards = S.list();
    const text = [textOf(actor._source.system.team), textOf(actor._source.system.teamBase)].filter(Boolean).join(" / ");
    const create = canCreate
      ? `<section class="ipb-opt"><h3>${esc(t("IPB.Empty.Create"))}</h3><p>${esc(t("IPB.Empty.CreateHint", { actor: name }))}</p>`
        + (text ? `<p class="ipb-muted">${esc(t("IPB.Empty.FromText", { text }))}</p>` : "")
        + `<button type="button" class="ipb-btn ipb-btn-primary" data-ipb="${text ? "create-text" : "create"}" data-fk="create">${icon("fa-solid fa-plus")} ${esc(t("IPB.Empty.Create"))}</button></section>`
      : `<section class="ipb-opt"><h3>${esc(t("IPB.Empty.Ask"))}</h3><p>${esc(t("IPB.Empty.AskHint"))}</p>`
        + `<button type="button" class="ipb-btn ipb-btn-primary" data-ipb="ask" data-fk="ask">${icon("fa-solid fa-bullhorn")} ${esc(t("IPB.Empty.AskButton"))}</button></section>`;
    const join = cards.length && (staff || actor.isOwner)
      ? `<section class="ipb-opt"><h3>${esc(t("IPB.Empty.Join"))}</h3><label class="ipb-field"><span>${esc(t("IPB.Empty.JoinSelect"))}</span>`
        + `<select class="ipb-input" name="ipb-join">${cards.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>`
        + `<button type="button" class="ipb-btn" data-ipb="join" data-fk="join">${icon("fa-solid fa-right-to-bracket")} ${esc(t("IPB.Empty.JoinButton"))}</button></section>` : "";
    this.#keepFocus(panel, () => {
      panel.setAttribute("aria-label", t("IPB.Empty.Title", { actor: name }));
      panel.innerHTML = `<div class="ipb-empty"><h2 class="ipb-plate"><span>${esc(t("IPB.Empty.Title", { actor: name }))}</span></h2>`
        + `<p class="ipb-lede">${esc(t("IPB.Empty.Lede"))}</p><div class="ipb-opts">${create}${join}</div></div>`;
    });
    const el = this.window?.title;
    if (el && el.textContent !== this.title) el.textContent = this.title;
  }

  async #afterTeam(team, msg) {
    ui.notifications?.info(msg, { console: false });
    const { BaseSheet } = await import("./sheet.mjs");
    await BaseSheet.open({ team: team.id });
    this.close({ force: true });
  }
  async #create(fromText) {
    const actor = this.actor;
    this.#working = true;
    try {
      const team = await this.#run(fromText ? Sync.fromHero(actor) : S.create({ fromActor: actor }));
      if (team) await this.#afterTeam(team, t("IPB.Empty.Created", { team: team.name }));
    } finally { this.#working = false; }
  }
  async #join() {
    const id = this.#q('[name="ipb-join"]')?.value;
    if (!id) return;
    this.#working = true;
    try {
      const team = await this.#run(S.link(this.actor, id));
      if (team?.requested) { const msg = t("IPB.Join.Sent", { name: this.actor.name, team: team.name }); ui.notifications?.info(msg, { console: false }); this.#announce(msg); }       // B11: waits for the GM
      else if (team) await this.#afterTeam(team, t("IPB.Empty.Joined", { actor: this.actor.name, team: team.name }));
    } finally { this.#working = false; }
  }
  async #ask() {
    const res = await this.#run(Relay.request("askCreate", { actorId: this.actor.id }));
    if (res) { ui.notifications?.info(t("IPB.Empty.Asked", { actor: this.actor.name }), { console: false }); this.#announce(t("IPB.Empty.Asked", { actor: this.actor.name })); }
  }
}
