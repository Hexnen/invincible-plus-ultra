/* Team & Base card PICKER (phase B4): a small window listing every team card (open, and for the GM create / delete). Opened by api.base.pick(),
   by the party-panel button when there is more than one card, and wherever a user is not tied to one team. Plain ApplicationV2, DOM built per
   render (the list is short). Style: styles/base.css (.ipb-picker). */
import * as S from "./store.mjs";
import { t, tn } from "./lang.mjs";
import { esc, icon, rankName, guard } from "./util.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;
const ID = "ipb-picker";

export class PickerApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: ID,
    classes: ["invincible-plus-ultra", "ipb-app", "ipb-picker"],
    tag: "div",
    window: { icon: "fa-solid fa-people-roof", title: "IPB.Pick.Title", resizable: false, contentClasses: ["ipb-content"] },
    position: { width: 460, height: "auto" }
  };
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
      });
    }
    const staff = S.isStaff();
    const cards = S.list();
    const items = cards.map((c) => {
      const n = S.members(c.id, { all: true }).length;
      return `<li class="ipb-pk-row"><div class="ipb-pk-main"><strong>${esc(c.name)}</strong><span class="ipb-muted">${esc(rankName(c.rank))} - ${esc(tn("IPB.Pick.Members", n))}</span></div>`
        + `<button type="button" class="ipb-btn ipb-btn-small" data-ipb="pk-open" data-team="${esc(c.id)}" aria-label="${esc(t("IPB.Pick.OpenAria", { team: c.name }))}">${icon("fa-solid fa-arrow-up-right-from-square")} ${esc(t("IPB.Pick.Open"))}</button>`
        + (staff ? `<button type="button" class="ipb-btn ipb-btn-small ipb-btn-icon ipb-btn-danger" data-ipb="pk-delete" data-team="${esc(c.id)}" aria-label="${esc(t("IPB.Pick.DeleteAria", { team: c.name }))}" data-tooltip="${esc(t("IPB.Pick.Delete"))}">${icon("fa-solid fa-trash")}</button>` : "")
        + `</li>`;
    }).join("");
    this.#root.innerHTML = `<ul class="ipb-pk-list">${items || `<li class="ipb-pk-empty">${esc(t("IPB.Pick.None"))}</li>`}</ul>`
      + (staff ? `<div class="ipb-pk-foot"><button type="button" class="ipb-btn ipb-btn-primary" data-ipb="pk-new">${icon("fa-solid fa-plus")} ${esc(t("IPB.Pick.New"))}</button></div>` : "");
    return this.#root;
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
    const team = S.get(id);
    if (!team) return;
    const ok = await DialogV2.confirm({
      window: { title: t("IPB.Pick.DeleteTitle"), icon: "fa-solid fa-trash" }, classes: ["ipb-dialog"],
      content: `<p>${esc(t("IPB.Pick.DeleteBody", { team: team.name }))}</p>`,
      yes: { label: t("IPB.Pick.DeleteYes", { team: team.name }) }, no: { label: t("IPB.Pick.DeleteNo"), default: true }, rejectClose: false, modal: false
    });
    if (ok) await guard(S.remove(id));
  }
}
