/* Team & Base card (phase B4c): DROP a hero onto the base sheet = add it as a MEMBER (the same link flow as the "Add hero" picker: store.link grants the
   ownership by the card policy and mirrors the team text through sync). Browser only (uses foundry / game).
   Accepted payloads (the text/plain JSON Foundry puts on a drag): { type: "Actor", uuid } from the Actors directory (also a token's synthetic actor
   uuid "Scene.x.Token.y.Actor.z") and { type: "Token", uuid } of a token document; a token resolves to its WORLD actor (token.baseActor), so an unlinked
   token adds the hero it was made from. Only superhero actors join: a team base, a vehicle (belongs to Gear & vehicles, B8), an npc / challenge or a
   compendium actor is refused with a message (vehicles are ignored silently outside the header, see sheet.mjs).
   Permission: the viewer must be able to edit the base (store.canEdit: staff, or an owner while the policy lets members edit) AND own the hero (or be staff).
   store.link repeats the hero check, the relay path for ownership of non-staff is the one store.link already uses. Result = { status, actor?, key?, params? }:
   status "added" | "moved" | "already" | "cancelled" | "refused" (key + params = the IPB.Drop.* message). */
import * as S from "./store.mjs";
import { t } from "./lang.mjs";
import { esc } from "./util.mjs";

const DROP_TYPES = ["Actor", "Token"];
export const isDropData = (data) => !!data && DROP_TYPES.includes(data.type) && typeof data.uuid === "string" && data.uuid.length > 0;

/** Parse the drag payload of a DragEvent (text/plain JSON) without throwing. */
export function readDragData(event) {
  try { return JSON.parse(event.dataTransfer?.getData("text/plain") || "null"); } catch { return null; }
}

/** The world actor behind a dropped document: an Actor as it is, a Token document or a token's synthetic actor (an unlinked token) -> the world actor it was made
    from (looked up by id: the synthetic actor's own `baseActor` is not the world document). Compendium actors come back as they are (refused by the caller). */
export function worldActor(doc) {
  if (!doc) return null;
  if (doc.documentName === "Token") return doc.baseActor ?? (doc.actorId ? game.actors.get(doc.actorId) : null) ?? doc.actor ?? null;
  if (doc.documentName === "Actor") return doc.isToken ? (doc.token?.baseActor ?? game.actors.get(doc.id) ?? null) : doc;
  return null;
}
/** The WORLD actor behind a drop payload: { actor } or { error: { key, params } }. Synchronous lookup first (world documents), then fromUuid. */
export async function resolveActor(data) {
  if (!isDropData(data)) return { error: { key: "IPB.Drop.Unreadable" } };
  let doc = null;
  try {
    doc = fromUuidSync(data.uuid, { strict: false });
    if (!doc?.documentName) doc = await fromUuid(data.uuid);                    // a compendium uuid answers synchronously with an index entry only
  } catch { doc = null; }
  if (!doc?.documentName) return { error: { key: "IPB.Drop.Unreadable" } };
  const actor = worldActor(doc);
  if (!actor || actor.documentName !== "Actor") return { error: { key: "IPB.Drop.Unreadable" } };
  if (actor.pack) return { error: { key: "IPB.Drop.Compendium", params: { name: actor.name } } };
  return { actor };
}
/** Classify an actor for membership: null = fine, else the refusal { key, params }. */
export function whyNotMember(actor) {
  if (S.isCard(actor)) return { key: "IPB.Drop.IsBase", params: { name: actor.name } };
  if (actor.type === "vehicle") return { key: "IPB.Drop.Vehicle", params: { name: actor.name } };
  if (actor.type !== "superhero") return { key: "IPB.Drop.NotHero", params: { name: actor.name, type: actor.type } };
  return null;
}
/** Is this payload a hero that could still be added (sync check for the drop highlight; false when it cannot be told yet)? */
export function previewKind(data) {
  if (!isDropData(data)) return "other";
  let doc = null;
  try { doc = fromUuidSync(data.uuid, { strict: false }); } catch { doc = null; }
  if (!doc?.documentName) return "unknown";
  const actor = worldActor(doc);
  if (!actor) return "unknown";
  return actor.type === "superhero" && !S.isCard(actor) && !actor.pack ? "hero" : "foreign";
}

/** Ask whether a hero that already belongs to another team should move. */
async function confirmMove(actor, from, to) {
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.confirm({
    window: { title: t("IPB.Drop.MoveTitle"), icon: "fa-solid fa-people-arrows" }, classes: ["ipb-dialog"],
    content: `<p>${esc(t("IPB.Drop.MoveText", { name: actor.name, from: from.name, team: to.name }))}</p>`,
    yes: { label: t("IPB.Drop.MoveYes"), icon: "fa-solid fa-people-arrows" }, no: { label: t("IPB.Add.No") },
    rejectClose: false, modal: false
  });
}

/** Add the dropped hero to `team` (Actor | id | view). opts.user, opts.ask = false skips the "move from another team" question (tests / API). */
export async function dropHero(team, data, { user = game.user, ask = true } = {}) {
  const e = S.resolve(team);
  const res = await resolveActor(data);
  if (res.error) return { status: "refused", ...res.error };
  const actor = res.actor;
  const bad = whyNotMember(actor);
  if (bad) return { status: "refused", actor, ...bad };
  // B11 (A1, lead TODO of B4c): the owner of a hero may DROP it on a base they cannot edit exactly like the Add-hero picker: it becomes a "request to join"
  // that the GM approves (store.link decides). Only a user who owns neither the hero nor the card's edit rights is refused.
  if (!S.isStaff(user) && !actor.testUserPermission(user, "OWNER")) return { status: "refused", actor, key: "IPB.Drop.NotOwner", params: { name: actor.name } };
  const cur = S.linkOf(actor);
  if (cur === e.id) return { status: "already", actor, params: { name: actor.name } };
  const from = cur ? S.cardById(cur) : null;                                    // a dangling link (deleted base) counts as none
  if (from && ask && !(await confirmMove(actor, from, e))) return { status: "cancelled", actor };
  let lk;
  try { lk = await S.link(actor, e, { user }); } catch (err) { return { status: "refused", actor, key: null, message: err?.message ?? String(err) }; }
  if (lk?.requested) return { status: "requested", actor, params: { name: actor.name, team: e.name } };
  if (lk?.already) return { status: "already", actor, params: { name: actor.name } };
  return { status: from ? "moved" : "added", actor, params: { name: actor.name, team: e.name } };
}
