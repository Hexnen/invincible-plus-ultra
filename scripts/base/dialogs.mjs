/* Team & Base card dialogs (phase B4): the sync-conflict chooser (keep / replace per hero field) and the "add a hero" chooser.
   Both are small DialogV2 prompts (they need protected focus and a decision), styled by .ipb-dialog in styles/base.css. */
import { t } from "./lang.mjs";
import { esc } from "./util.mjs";

const { DialogV2 } = foundry.applications.api;

/** Sync.push({resolve}) callback. conflicts = [{actor, field, current, next}] -> { "<actorId>.<field>": "keep"|"replace" } ("keep" is the default). */
export async function resolveConflicts(conflicts) {
  const rows = conflicts.map((c) => {
    const name = `${c.actor.id}.${c.field}`;
    return `<fieldset class="ipb-conf"><legend>${esc(c.actor.name)} - ${esc(t(`IPB.Sync.Field.${c.field}`))}</legend>`
      + `<p><span class="ipb-muted">${esc(t("IPB.Sync.Current"))}</span> <q>${esc(c.current)}</q></p>`
      + `<p><span class="ipb-muted">${esc(t("IPB.Sync.Next"))}</span> <q>${esc(c.next)}</q></p>`
      + `<label class="ipb-radio"><input type="radio" name="${esc(name)}" value="keep" checked> <span>${esc(t("IPB.Sync.Keep"))}</span></label>`
      + `<label class="ipb-radio"><input type="radio" name="${esc(name)}" value="replace"> <span>${esc(t("IPB.Sync.Replace"))}</span></label></fieldset>`;
  }).join("");
  const out = await DialogV2.wait({
    window: { title: t("IPB.Sync.Title"), icon: "fa-solid fa-people-roof" },
    classes: ["ipb-dialog"],
    position: { width: 520 },
    content: `<p class="ipb-conf-lede">${esc(t("IPB.Sync.Body"))}</p><form class="ipb-conf-form">${rows}</form>`,
    buttons: [
      { action: "apply", label: t("IPB.Sync.Apply"), default: true, callback: (_ev, button) => {
        const fd = new FormData(button.form ?? button.closest("dialog")?.querySelector("form") ?? document.createElement("form"));
        const res = {};
        for (const [k, v] of fd.entries()) res[k] = v === "replace" ? "replace" : "keep";
        return res;
      } },
      { action: "cancel", label: t("IPB.Sync.Cancel"), callback: () => null }
    ],
    rejectClose: false, modal: false
  });
  return out && typeof out === "object" ? out : {};
}

/** Choose one of `actors` (Actor[]) to add to a team; resolves the Actor or null. */
export async function chooseHero(team, actors) {
  if (!actors.length) {
    await DialogV2.prompt({
      window: { title: t("IPB.Add.Title", { team: team.name }), icon: "fa-solid fa-user-plus" }, classes: ["ipb-dialog"],
      content: `<p>${esc(t("IPB.Add.None"))}</p>`, ok: { label: t("IPB.Add.No") }, rejectClose: false, modal: false
    });
    return null;
  }
  const options = actors.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`).join("");
  const id = await DialogV2.prompt({
    window: { title: t("IPB.Add.Title", { team: team.name }), icon: "fa-solid fa-user-plus" }, classes: ["ipb-dialog"],
    content: `<label class="ipb-dlg-field"><span>${esc(t("IPB.Add.Select"))}</span><select name="hero">${options}</select></label>`,
    ok: { label: t("IPB.Add.Yes"), callback: (_ev, button) => button.form.elements.hero.value },
    rejectClose: false, modal: false
  });
  return id ? actors.find((a) => a.id === id) ?? null : null;
}

/** "Create team base" prompt (Actors directory). Staff may leave the hero out; a player must pick a hero he owns (the base is edited through its heroes' ownership).
    Resolves { name, rank, actor|null } or null. */
export async function promptNewBase(S, P, rankName) {
  const staff = S.isStaff();
  const heroes = game.actors.filter((a) => a.type === "superhero" && !S.linkOf(a) && (staff || a.testUserPermission(game.user, "OWNER")));
  if (!staff && !heroes.length) {
    await DialogV2.prompt({
      window: { title: t("IPB.New.Title"), icon: "fa-solid fa-people-roof" }, classes: ["ipb-dialog"],
      content: `<p>${esc(t("IPB.New.NeedHero"))}</p>`, ok: { label: t("IPB.Add.No") }, rejectClose: false, modal: false
    });
    return null;
  }
  const ranks = P.RANKS.map((r) => `<option value="${r}"${r === "global" ? " selected" : ""}>${esc(rankName(r))}</option>`).join("");
  const opts = (staff ? [`<option value="">${esc(t("IPB.New.NoHero"))}</option>`] : []).concat(heroes.map((a) => `<option value="${esc(a.id)}">${esc(a.name)}</option>`)).join("");
  return DialogV2.prompt({
    window: { title: t("IPB.New.Title"), icon: "fa-solid fa-people-roof" }, classes: ["ipb-dialog"], position: { width: 420 },
    content: `<label class="ipb-dlg-field"><span>${esc(t("IPB.New.Name"))}</span><input type="text" name="name" maxlength="80" placeholder="${esc(t("IPB.Default.Name"))}" autocomplete="off" autofocus></label>`
      + `<label class="ipb-dlg-field"><span>${esc(t("IPB.New.Rank"))}</span><select name="rank">${ranks}</select></label>`
      + `<label class="ipb-dlg-field"><span>${esc(t("IPB.New.Hero"))}</span><select name="hero">${opts}</select></label>`,
    ok: {
      label: t("IPB.New.Yes"), icon: "fa-solid fa-plus",
      callback: (_ev, button) => {
        const f = button.form.elements;
        return { name: String(f.name.value || "").trim(), rank: f.rank.value, actor: f.hero.value ? game.actors.get(f.hero.value) : null };
      }
    },
    rejectClose: false, modal: false
  });
}
