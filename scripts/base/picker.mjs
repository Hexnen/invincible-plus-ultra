/* Team & Base card PICKER (phase B4): a small window listing every team card (open, and for the GM create / delete). Opened by api.base.pick(),
   by the party-panel button when there is more than one card, and wherever a user is not tied to one team. Plain ApplicationV2, DOM built per
   render (the list is short). Style: styles/base.css (.ipb-picker). */
import * as S from "./store.mjs";
import { t, tn } from "./lang.mjs";
import { esc, icon, rankName, guard, reportError } from "./util.mjs";

const { ApplicationV2 } = foundry.applications.api;
const ID = "ipb-picker";

export class PickerApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: ID,
    classes: ["invincible-plus-ultra", "ipb-app", "ipb-picker"],
    tag: "div",
    window: { icon: "fa-solid fa-people-roof", title: "IPB.Pick.Title", resizable: false, contentClasses: ["ipb-content"] },
    position: { width: 540, height: "auto" }
  };
  /** The settings-menu button creates a new instance each time: a second window with the same id is never opened, the open one is raised instead. */
  async render(options, ...rest) {
    const existing = foundry.applications.instances.get(ID);
    if (existing && existing !== this) { existing.bringToFront?.(); return existing.render(options, ...rest); }
    return super.render(options, ...rest);
  }
  static async open() {
    const existing = foundry.applications.instances.get(ID);
    if (existing) { existing.bringToFront?.(); await existing.render({ force: true }); return existing; }
    const app = new PickerApp();
    await app.render({ force: true });
    return app;
  }
  static refresh() { const a = foundry.applications.instances.get(ID); if (a) a.render(); }

  #root = null;
  get title() { return t("IPB.Pick.Title"); }
  async _prepareContext() { return {}; }
  async _renderHTML() {
    if (!this.#root) {
      this.#root = document.createElement("div");
      this.#root.className = "ipb-pick";
      this.#root.addEventListener("click", (ev) => {
        const el = ev.target instanceof Element ? ev.target.closest("[data-ipb]") : null;
        if (!el) return;
        const a = el.dataset.ipb;
        if (a === "pk-open") this.#open(el.dataset.team);
        else if (a === "pk-delete") this.#delete(el.dataset.team);
        else if (a === "pk-new") this.#new();
        else if (a === "pk-dup") this.#xfer((T) => T.duplicate(el.dataset.team).then((res) => res && this.#open(res.team.id)));
        else if (a === "pk-export") this.#xfer((T) => T.exportToFile(el.dataset.team));
        else if (a === "pk-import") this.#xfer((T) => T.importFromFile());
      });
    }
    const staff = S.isStaff();
    if (staff && !this.#T) import("./transfer.mjs").then((m) => { this.#T = m; });                 // preloaded: the file chooser needs the click's user gesture
    const cards = S.list();
    const items = cards.map((c) => {
      const n = S.members(c.id, { all: true }).length;
      return `<li class="ipb-pk-row"><div class="ipb-pk-main"><strong>${esc(c.name)}</strong><span class="ipb-muted">${esc(rankName(c.rank))} - ${esc(tn("IPB.Pick.Members", n))}</span></div>`
        + `<button type="button" class="ipb-btn ipb-btn-small" data-ipb="pk-open" data-team="${esc(c.id)}" aria-label="${esc(t("IPB.Pick.OpenAria", { team: c.name }))}">${icon("fa-solid fa-arrow-up-right-from-square")} ${esc(t("IPB.Pick.Open"))}</button>`
        + (staff ? `<span class="ipb-pk-tools">`
          + `<button type="button" class="ipb-btn ipb-btn-small ipb-btn-icon" data-ipb="pk-dup" data-team="${esc(c.id)}" aria-label="${esc(t("IPB.Xfer.DuplicateAria", { team: c.name }))}" data-tooltip="${esc(t("IPB.Xfer.Duplicate"))}">${icon("fa-solid fa-clone")}</button>`
          + `<button type="button" class="ipb-btn ipb-btn-small ipb-btn-icon" data-ipb="pk-export" data-team="${esc(c.id)}" aria-label="${esc(t("IPB.Xfer.ExportAria", { team: c.name }))}" data-tooltip="${esc(t("IPB.Xfer.Export"))}">${icon("fa-solid fa-file-export")}</button>`
          + `<button type="button" class="ipb-btn ipb-btn-small ipb-btn-icon ipb-btn-danger" data-ipb="pk-delete" data-team="${esc(c.id)}" aria-label="${esc(t("IPB.Pick.DeleteAria", { team: c.name }))}" data-tooltip="${esc(t("IPB.Pick.Delete"))}">${icon("fa-solid fa-trash")}</button></span>` : "")
        + `</li>`;
    }).join("");
    this.#root.innerHTML = `<ul class="ipb-pk-list">${items || `<li class="ipb-pk-empty">${esc(t("IPB.Pick.None"))}</li>`}</ul>`
      + (staff ? `<div class="ipb-pk-foot"><button type="button" class="ipb-btn ipb-btn-primary" data-ipb="pk-new">${icon("fa-solid fa-plus")} ${esc(t("IPB.Pick.New"))}</button>`
        + `<button type="button" class="ipb-btn" data-ipb="pk-import">${icon("fa-solid fa-file-import")} ${esc(t("IPB.Xfer.Import"))}</button></div>` : "");
    return this.#root;
  }
  #T = null;
  async #xfer(fn) {
    try { this.#T ??= await import("./transfer.mjs"); await fn(this.#T); } catch (err) { reportError(err); }
  }
  _replaceHTML(result, content) { if (!content.contains(result)) content.replaceChildren(result); }

  async #open(id) {
    const { open } = await import("./entry.mjs");
    open(id);
  }
  async #new() {
    const team = await guard(S.create({}));
    if (team) { const { open } = await import("./entry.mjs"); open(team.id); }
  }
  async #delete(id) {
    if (!S.get(id)) return;
    await this.#xfer((T) => T.confirmDelete(id));          // B9: the confirm names the consequences and offers a backup file
  }
}
