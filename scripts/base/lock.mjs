/* Team & Base card, phase B4d: LOCK. While a hero is a MEMBER of a team base (its link flag points at an existing card), the two hero fields the card
   mirrors (system.team, system.teamBase) belong to the card: the sheet shows them read-only (entry.mjs) and this preUpdateActor guard refuses direct edits.
   Allowed writers: our own sync (update option { ipbSync: true }) and a GM using { ipbOverride: true } from a macro / the console. Everything else
   (sheet forms, other modules, chargen apply) has the two fields STRIPPED from the update; the rest of that update still goes through. Client-side only
   (Foundry has no server hook), so it protects against mistakes, not against a hostile console. Leaving the base or deleting it unlocks the fields,
   which keep their last text. */
import * as S from "./store.mjs";
import { t } from "./lang.mjs";

export const FIELDS = ["team", "teamBase"];

/** The base actor the hero belongs to, or null (not a hero, a compendium actor, no link, or a dangling link). */
export function cardOf(actor) {
  if (!actor || actor.type !== "superhero" || actor.pack) return null;
  return S.cardById(S.linkOf(actor));
}
export const isMember = (actor) => !!cardOf(actor);

const hasFlat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** preUpdateActor: strips changed locked fields; returns false only when nothing else is left to write. */
export function guard(actor, changes, options, userId) {
  if (userId && userId !== game.user.id) return true;
  if (options?.ipbSync) return true;
  if (options?.ipbOverride && game.user.isGM) return true;
  const card = cardOf(actor);
  if (!card) return true;
  let stripped = false;
  for (const f of FIELDS) {
    const flat = `system.${f}`;
    let next, present = false;
    if (hasFlat(changes, flat)) { next = changes[flat]; present = true; if (String(next ?? "") !== String(actor._source.system[f] ?? "")) stripped = true; delete changes[flat]; }
    if (changes.system && typeof changes.system === "object" && hasFlat(changes.system, f)) {
      next = changes.system[f]; present = true;
      if (String(next ?? "") !== String(actor._source.system[f] ?? "")) stripped = true;
      delete changes.system[f];
    }
    void present;
  }
  if (changes.system && typeof changes.system === "object" && !Object.keys(changes.system).length) delete changes.system;
  if (stripped) ui.notifications?.warn(t("IPB.Lock.Refused", { team: card.name }));
  if (!stripped) return true;
  return Object.keys(changes).some((k) => k !== "_id" && k !== "_stats");
}
