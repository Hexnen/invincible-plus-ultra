/* Team & Base card: the ACTORS DIRECTORY side (phase B4b). The bases are real actors in a folder "Team bases"; this file adds, on every render of the
   Actors directory, (1) a "Create team base" button next to the core create buttons (GM / assistant always; a player when the world setting
   basePlayersCreate is on and he owns a hero without a base) and (2) a small marker on the base entries. Does nothing else. */
import * as S from "./store.mjs";
import * as P from "./pure.mjs";
import { t } from "./lang.mjs";
import { esc, icon, rankName, guard } from "./util.mjs";

const MOD = S.MODULE_ID;
const ICON = "fa-solid fa-people-roof";
const mayCreate = () => S.isStaff() || (game.settings.get(MOD, S.SETTING_PLAYERS_CREATE) === true && game.actors.some((a) => a.type === "superhero" && !S.linkOf(a) && a.isOwner));

/** "Create team base": prompt, create (relayed for players), open the new sheet. */
export async function createBase() {
  const { promptNewBase } = await import("./dialogs.mjs");
  const res = await promptNewBase(S, P, rankName);
  if (!res) return null;
  const team = await guard(S.create({ name: res.name, rank: res.rank, fromActor: res.actor }));
  if (!team) return null;
  ui.notifications?.info(t("IPB.Empty.Created", { team: team.name }), { console: false });
  const { BaseSheet } = await import("./sheet.mjs");
  await BaseSheet.open({ team: team.id });
  return team;
}

/** renderActorDirectory(app, element) */
export function decorate(app, html) {
  try {
    const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
    if (!root?.querySelector) return;
    const actions = root.querySelector(".directory-header .header-actions");
    let btn = actions?.querySelector(".ipb-dir-create");
    if (actions && mayCreate()) {
      if (!btn) {
        btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ipb-dir-create";
        btn.dataset.tooltip = t("IPB.Dir.CreateTip");
        btn.innerHTML = `${icon(ICON)}<span>${esc(t("IPB.Dir.Create"))}</span>`;
        btn.addEventListener("click", (ev) => { ev.preventDefault(); createBase(); });
        actions.append(btn);
      }
    } else btn?.remove();
    for (const li of root.querySelectorAll("li[data-entry-id]")) {
      const a = game.actors.get(li.dataset.entryId);
      const on = S.isCard(a);
      li.classList.toggle("ipb-dir-base", on);
      const old = li.querySelector(".ipb-dir-mark");
      if (on && !old) {
        const mark = document.createElement("i");
        mark.className = `${ICON} ipb-dir-mark`;
        mark.setAttribute("aria-hidden", "true");
        mark.dataset.tooltip = t("IPB.Dir.Mark");
        (li.querySelector(".entry-name, a.entry-name, .name") ?? li).append(mark);
      } else if (!on) old?.remove();
    }
  } catch (e) { console.warn(`${MOD} | base: actor directory hook failed`, e); }
}
