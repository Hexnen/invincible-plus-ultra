/* Team & Base card: STORE. Since B4b a team card is a real world ACTOR (host type "vehicle", see HOST_TYPE) flagged flags["invincible-plus-ultra"].base.kind === "teamBase";
   its data lives in flags["invincible-plus-ultra"].base (schema: pure.mjs), its own name / img are the team name / base picture. A "team" argument anywhere in
   the base API may be that Actor, its id, its uuid or a view returned by this file. Views are { id, uuid, ...normalized B }. Membership lives on the heroes
   (flags[...].base.team = the base actor id), members are derived. Ownership of the actor = who may edit (policy). No UI here.
   Why "vehicle": smallest data model of the system (health, type, a few numbers, no attributes / resolve / items logic), its own sheet class (so ours replaces it
   only for flagged actors through the native per-document sheet override flags.core.sheetClass), not touched by the party panel (superhero) or the challenges HUD (challenge). */
import * as P from "./pure.mjs";
import { t } from "./lang.mjs";

export const MODULE_ID = "invincible-plus-ultra";
export const HOST_TYPE = "vehicle";
export const KIND = P.TEAM_BASE_KIND;
export const FOLDER_NAME = "Team bases";
export const SHEET_ID = `${MODULE_ID}.BaseSheet`;                       // DocumentSheetConfig id: `${scope}.${class name}` (sheet.mjs registers the class BaseSheet)
export const DEFAULT_IMG = "icons/environment/settlement/city-night-spire.webp";    // a core Foundry icon: always there
const DEFAULT_ARTS = [DEFAULT_IMG, "vehicle.svg"];
export const SETTING_PLAYERS_CREATE = "basePlayersCreate";
const PATCHABLE = new Set(["name", "rank", "motto", "img", "purpose", "background", "base", "policy", ...P.COLLECTIONS]);

/** Typed error. codes: noBook noPermission tooBig noGM notFound invalid prerequisite stackMax full badInput blocked karma badType relay */
export class BaseError extends Error {
  constructor(code, params = {}) {
    super(t(`IPB.Err.${code}`, params));
    this.name = "BaseError";
    this.code = code;
    this.params = params;
  }
}

/** Late-bound hooks set by relay.mjs (avoids a circular import). */
export const bridge = { request: null };

const clone = (o) => foundry.utils.deepClone(o);
export const isStaff = (user = game.user) => !!user && (user.isGM === true || user.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);

/* ------------------------------------------------------------------ resolve / read */
/** A team base actor: world actor of the host type carrying the marker. */
export const isCard = (a) => !!a && a.documentName === "Actor" && a.flags?.[MODULE_ID]?.[P.FLAG_KEY]?.kind === KIND;
/** The base actor with this id (or the one a migrated journal card used to have), else null. */
export function cardById(id) {
  if (!id) return null;
  const a = game.actors.get(id) ?? game.actors.find((x) => x.flags?.[MODULE_ID]?.migratedFrom === id);
  return isCard(a) ? a : null;
}

export function resolve(ref) {
  let e = ref;
  if (ref && typeof ref === "object" && !(ref instanceof foundry.abstract.Document)) e = ref.id ? game.actors.get(ref.id) : null;
  else if (ref instanceof foundry.abstract.Document && ref.isToken) e = ref.baseActor;        // a token's synthetic actor: the world actor is the card
  else if (typeof ref === "string") e = game.actors.get(ref) ?? (ref.startsWith("Actor.") ? fromUuidSync(ref) : null) ?? cardById(ref);
  if (!isCard(e)) throw new BaseError("notFound", { id: typeof ref === "string" ? ref : ref?.id ?? "" });
  return e;
}
export const rawData = (entry) => entry.flags?.[MODULE_ID]?.[P.FLAG_KEY] ?? {};
const artOf = (e) => (P.isDefaultArt(e.img, DEFAULT_ARTS) ? "" : e.img);
/** Normalized B, name and picture mirrored from the actor (the actor's own name / img are the source). */
export function data(ref) {
  const e = resolve(ref);
  const B = P.normalize(clone(rawData(e)));
  B.name = e.name;
  B.img = artOf(e);
  return B;
}
export function view(ref) {
  const e = resolve(ref);
  return { id: e.id, uuid: e.uuid, ...data(e) };
}
export function list() { return game.actors.filter(isCard).map((e) => view(e)); }
export function get(id) { try { return view(id); } catch { return null; } }

/* ------------------------------------------------------------------ permissions */
/** May `user` edit this card? GM/assistant always; others by the card's policy and real document ownership. */
export function canEdit(ref, user = game.user) {
  const e = resolve(ref);
  if (isStaff(user)) return true;
  const policy = data(e).policy.edit;
  if (policy === "gm") return false;
  try { return e.testUserPermission(user, "OWNER"); } catch { return false; }
}
export function assertCanEdit(ref, user = game.user) {
  if (!canEdit(ref, user)) throw new BaseError("noPermission");
}
export function assertStaff(user = game.user) {
  if (!isStaff(user)) throw new BaseError("noPermission");
}

/* ------------------------------------------------------------------ members / links */
export const linkOf = (actor) => actor?.flags?.[MODULE_ID]?.[P.FLAG_KEY]?.team ?? "";

/** The team a hero belongs to (view) or null (a dangling link counts as none). */
export function find(actor) {
  const a = typeof actor === "string" ? game.actors.get(actor) : actor;
  const id = linkOf(a);
  return id ? get(id) : null;
}
/** Heroes linked to the team that `user` may see (LIMITED or better). Also reports how many exist in total. */
export function members(ref, { user = game.user, all = false } = {}) {
  const e = resolve(ref);
  const every = game.actors.filter((a) => a.type === "superhero" && linkOf(a) === e.id);
  const seen = every.filter((a) => all || isStaff(user) || a.testUserPermission(user, "LIMITED"));
  return Object.assign(seen, { hidden: every.length - seen.length });
}

/** Facts of the members for rules (resources, occupation, karma ...). Only heroes the user can see. */
export function memberFacts(ref, user = game.user) {
  return members(ref, { user }).map((a) => ({
    id: a.id, name: a.name, resources: Number(a.system?.resources) || 0, occupation: String(a.system?.occupation ?? ""),
    karma: Math.max(0, Number(a.system?.karma) || 0), reputation: Number(a.system?.reputation) || 0
  }));
}

/* ------------------------------------------------------------------ ownership (policy) */
export function computeOwnership(ref) {
  const e = resolve(ref);
  const B = data(e);
  const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const own = { default: B.policy.edit === "everyone" ? L.OWNER : L.OBSERVER };
  if (B.policy.edit === "members") {
    const m = members(e, { all: true });
    for (const u of game.users) {
      if (isStaff(u)) continue;
      if (m.some((a) => a.testUserPermission(u, "OWNER"))) own[u.id] = L.OWNER;
    }
  }
  for (const [uid, lvl] of Object.entries(e.ownership ?? {})) {            // keep manual non-owner overrides (LIMITED / NONE ...)
    if (uid === "default" || uid in own) continue;
    if (lvl !== L.OWNER && game.users.get(uid) && !isStaff(game.users.get(uid))) own[uid] = lvl;
  }
  return own;
}
/** GM only, idempotent. Returns { changed, ownership }. */
export async function reconcileOwnership(ref) {
  assertStaff();
  const e = resolve(ref);
  const want = computeOwnership(e);
  const have = e.ownership ?? {};
  const keys = new Set([...Object.keys(want), ...Object.keys(have).filter((k) => !isStaff(game.users.get(k)))]);
  const same = [...keys].every((k) => (want[k] ?? null) === (have[k] ?? null));
  if (same) return { changed: false, ownership: want };
  const staffKeep = Object.fromEntries(Object.entries(have).filter(([k]) => k !== "default" && isStaff(game.users.get(k))));
  await e.update({ ownership: { ...want, ...staffKeep } }, { diff: false, recursive: false });
  return { changed: true, ownership: want };
}
export async function reconcileAll() {
  const out = [];
  for (const e of game.actors.filter(isCard)) out.push([e.id, (await reconcileOwnership(e)).changed]);
  return out;
}

/* ------------------------------------------------------------------ create / update / remove */
async function ensureFolder() {
  let f = game.folders.find((x) => x.type === "Actor" && x.flags?.[MODULE_ID]?.baseFolder);
  if (!f) f = game.folders.find((x) => x.type === "Actor" && !x.folder && x.name === FOLDER_NAME);
  if (!f) f = await Folder.create({ name: FOLDER_NAME, type: "Actor", flags: { [MODULE_ID]: { baseFolder: true } } });
  return f;
}
const actorOf = (a) => (typeof a === "string" ? game.actors.get(a) : a);

/** Create a card. GM/assistant create directly, everybody else is relayed to the active GM (needs basePlayersCreate).
    opts: { name, rank, actors[], fromActor (Actor|id: link it and read its rank flag) } */
export async function create(opts = {}) {
  const from = actorOf(opts.fromActor);
  if (!isStaff()) {
    if (!bridge.request) throw new BaseError("relay");
    const res = await bridge.request("createTeam", { name: opts.name ?? "", rank: opts.rank ?? "", fromActorId: from?.id ?? "", rid: foundry.utils.randomID(16) });
    const id = res?.id;
    // The actor and then the ownership grant the GM client makes right after creating it arrive as SEPARATE updates: a player must not write to
    // the card (fromHero, rename ...) before both are here or the write is refused. Wait up to 6 s for the actor and for edit rights.
    const ready = () => { const e = game.actors.get(id); return !!e && isCard(e) && canEdit(e); };
    for (let i = 0; i < 60 && !ready(); i++) await new Promise((r) => setTimeout(r, 100));
    return view(id);
  }
  return createLocal(opts, game.user);
}
/** Direct creation (used by the GM side of the relay). `by` is the user that asked. */
export async function createLocal(opts = {}, by = game.user) {
  assertStaff();
  const from = actorOf(opts.fromActor);
  const B = P.defaultBase();
  const fromRank = from?.flags?.[MODULE_ID]?.chargen?.rank;
  B.rank = P.RANKS.includes(opts.rank) ? opts.rank : P.RANKS.includes(fromRank) ? fromRank : "global";
  B.name = P.clampText(String(opts.name ?? "").trim() || from?.system?.team?.trim?.() || t("IPB.Default.Name"), 80);
  const now = Date.now();
  B.meta.created = { by: by.id, at: now };
  B.meta.updated = { by: by.id, at: now };
  const folder = await ensureFolder();
  const entry = await Actor.create(P.cardActorData({ name: B.name, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: { [MODULE_ID]: { [P.FLAG_KEY]: B } } },
    { type: HOST_TYPE, folder: folder.id, defaultImg: DEFAULT_IMG, sheetClass: SHEET_ID, rid: opts.rid }));
  for (const a of [from, ...(opts.actors ?? []).map(actorOf)].filter(Boolean)) await link(a, entry);
  await reconcileOwnership(entry);
  return view(entry);
}

/** Plain recursive merge with the Foundry convention "-=key": null deleting a key (mergeObject{performDeletions} did not delete in v14.363). */
export function mergePatch(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith("-=")) { delete target[k.slice(2)]; continue; }
    if (v && typeof v === "object" && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== "object" || Array.isArray(target[k])) target[k] = {};
      mergePatch(target[k], v);
    } else target[k] = v;
  }
  return target;
}

function newErrors(before, after) {
  const key = (x) => `${x.key}|${x.path}`;
  const had = new Set(before.filter((x) => x.level === "error").map(key));
  return after.filter((x) => x.level === "error" && !had.has(key(x)));
}

/** Validated deep patch of B (nested object, "-=id": null removes a map entry). Whitelisted top-level keys only. Returns the new view. */
export async function update(ref, patch, { user = game.user } = {}) {
  const e = resolve(ref);
  assertCanEdit(e, user);
  if (!patch || typeof patch !== "object") throw new BaseError("badInput");
  for (const k of Object.keys(patch)) if (!PATCHABLE.has(k)) throw new BaseError("badInput", { key: k });
  if ("policy" in patch) assertStaff(user);
  const cur = data(e);
  const next = mergePatch(clone(cur), clone(patch));
  const issues = newErrors(P.validate(cur), P.validate(next));
  if (issues.length) {
    const big = issues.find((x) => x.key === "IPB.Err.tooBig");
    throw new BaseError(big ? "tooBig" : "invalid", { issues, ...(big?.params ?? {}) });
  }
  const { name, img, ...rest } = patch;
  const flagPatch = { ...rest, meta: { updated: { by: user.id, at: Date.now() } } };
  const upd = { flags: { [MODULE_ID]: { [P.FLAG_KEY]: flagPatch } } };
  // the actor's own name and img ARE the team name and the base picture (B.name / B.img are mirrors, never stored)
  if (typeof name === "string" && name.trim()) { upd.name = P.clampText(name.trim(), 80); upd["prototypeToken.name"] = upd.name; }
  if (typeof img === "string") { upd.img = img.trim() || DEFAULT_IMG; if (isCurrentTokenArt(e)) upd["prototypeToken.texture.src"] = upd.img; }
  await e.update(upd);
  if ("policy" in patch && isStaff()) await reconcileOwnership(e);
  return view(e);
}
export function setPolicy(ref, patch, opts) {
  return update(ref, { policy: patch }, opts);
}

/** the prototype token still shows the base picture (or a default): then it follows the picture */
const isCurrentTokenArt = (e) => { const src = e.prototypeToken?.texture?.src; return !src || src === e.img || P.isDefaultArt(src, DEFAULT_ARTS); };

/** GM only. Deletes the card and unlinks its heroes (their team / teamBase text is kept). */
export async function remove(ref) {
  assertStaff();
  const e = resolve(ref);
  for (const a of members(e, { all: true })) await unlink(a);
  await e.delete();
  return true;
}

/* ------------------------------------------------------------------ link / unlink */
/** An owner of the hero (or staff) links it; a hero belongs to one team (moving it reconciles both). */
export async function link(actorRef, ref, { user = game.user } = {}) {
  const a = actorOf(actorRef);
  const e = resolve(ref);
  if (!a || a.type !== "superhero") throw new BaseError("badInput", { what: "actor" });
  if (!isStaff(user) && !a.testUserPermission(user, "OWNER")) throw new BaseError("noPermission");
  const old = linkOf(a);
  await a.update({ [`flags.${MODULE_ID}.${P.FLAG_KEY}.team`]: e.id });
  await afterLinkChange(old, e.id);
  return view(e);
}
export async function unlink(actorRef, { user = game.user } = {}) {
  const a = actorOf(actorRef);
  if (!a) throw new BaseError("badInput", { what: "actor" });
  if (!isStaff(user) && !a.testUserPermission(user, "OWNER")) throw new BaseError("noPermission");
  const old = linkOf(a);
  if (!old) return false;
  await a.update({ [`flags.${MODULE_ID}.-=${P.FLAG_KEY}`]: null });
  await afterLinkChange(old, "");
  return true;
}
async function afterLinkChange(...ids) {
  for (const id of ids.filter((x) => x && cardById(x))) {
    if (isStaff()) await reconcileOwnership(id);
    else if (bridge.request) { try { await bridge.request("reconcile", { teamId: id }); } catch (_) { /* no GM online: reconciled at the next GM login */ } }
  }
}

/* ------------------------------------------------------------------ guards + migration */
/** preCreateActor: a base actor created by any path (duplicate, import, API) gets the sheet override so it opens OUR sheet. */
export function forceSheetOnCreate(actor) {
  if (actor.flags?.[MODULE_ID]?.[P.FLAG_KEY]?.kind !== KIND) return;
  if (actor.flags?.core?.sheetClass !== SHEET_ID) actor.updateSource({ "flags.core.sheetClass": SHEET_ID });
}
/** preDeleteActor: only staff delete a base (owners can edit it, not remove it). Client-side courtesy: Foundry itself only needs OWNER. */
export function guardDelete(actor, _options, userId) {
  if (!isCard(actor)) return true;
  if (userId && userId !== game.user.id) return true;
  if (isStaff()) return true;
  ui.notifications?.warn(t("IPB.Err.noPermission"));
  return false;
}

/** GM only, idempotent. (1) base actors without the sheet override get it; (2) any JournalEntry that used to be a card (B3 / B4 storage) becomes a
    base actor, the heroes' links are re-pointed, the journal and the old folder are deleted. Returns { sheets, migrated:[{from,to}] }. */
export async function migrate() {
  assertStaff();
  const out = { sheets: 0, migrated: [] };
  for (const a of game.actors.filter(isCard)) {
    if (a.flags?.core?.sheetClass !== SHEET_ID) { await a.update({ "flags.core.sheetClass": SHEET_ID }); out.sheets++; }
  }
  const old = game.journal.filter((e) => e.flags?.[MODULE_ID]?.[P.FLAG_KEY]?.kind !== KIND && Number.isInteger(e.flags?.[MODULE_ID]?.[P.FLAG_KEY]?.v) && isObjectLike(e.flags[MODULE_ID][P.FLAG_KEY]));
  for (const j of old) {
    const folder = await ensureFolder();
    const body = P.cardActorData({ id: j.id, name: j.name, ownership: j.ownership, flags: foundry.utils.deepClone(j.flags) }, { type: HOST_TYPE, folder: folder.id, defaultImg: DEFAULT_IMG, sheetClass: SHEET_ID });
    const actor = await Actor.create(body);
    for (const h of game.actors.filter((x) => x.type === "superhero" && linkOf(x) === j.id)) await h.update({ [`flags.${MODULE_ID}.${P.FLAG_KEY}.team`]: actor.id });
    await reconcileOwnership(actor);
    await j.delete();
    out.migrated.push({ from: j.id, to: actor.id });
  }
  if (out.migrated.length) {
    const jf = game.folders.find((f) => f.type === "JournalEntry" && f.flags?.[MODULE_ID]?.baseFolder);
    if (jf && !game.journal.some((j) => j.folder?.id === jf.id)) await jf.delete();
  }
  return out;
}
const isObjectLike = (o) => !!o && typeof o === "object" && !Array.isArray(o);
