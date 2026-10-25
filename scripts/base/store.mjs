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
const PATCHABLE = new Set(["name", "motto", "img", "purpose", "background", "base", "policy", ...P.COLLECTIONS]);

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

/** Rank of ONE hero (B4c): the chargen record when the hero has one, else an estimate from its attributes and power items (pure.heroRank).
    -> { id, name, rank: id|null, source: "flag"|"inferred"|"unknown" }. Reads _source (effect-modified numbers would inflate the estimate). */
export function heroRank(actor) {
  const a = actorOf(actor);
  if (!a) return { id: "", name: "", rank: null, source: "unknown" };
  const attrs = Object.values(a._source?.system?.attributes ?? {}).map((x) => Number(x?.value) || 0);
  const powers = (a.items?.contents ?? []).filter((i) => i.type === "power" || i.type === "boost").length;
  const r = P.heroRank({ flagRank: a.flags?.[MODULE_ID]?.chargen?.rank, attrSum: attrs.reduce((n, v) => n + v, 0), maxAttr: Math.max(0, ...attrs), powers });
  return { id: a.id, name: a.name, ...r };
}
/** The team's rank = the HIGHEST rank among ALL its member heroes the client holds (also the ones the user may not see: a rank is not a secret and the
    allowance must not differ between clients). Falls back to the card's stored rank (creation default) only while no member has a known rank. */
export function rankOf(ref) {
  const e = resolve(ref);
  const list = members(e, { all: true }).map(heroRank);
  return { ...P.deriveRank(list, { stored: rawData(e).rank }), members: list };
}
/** Normalized B, name and picture mirrored from the actor (the actor's own name / img are the source). B.rank is the DERIVED rank (B4c; never written
    back: `rank` is not patchable), B.rankInfo says where it came from. */
export function data(ref) {
  const e = resolve(ref);
  const B = P.normalize(clone(rawData(e)));
  B.name = e.name;
  B.img = artOf(e);
  const info = rankOf(e);
  B.rank = info.rank;
  B.rankInfo = info;
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
/** B11 (A1): the heroes a card VOUCHES for = flags[MOD].vouched { _: true, <heroId>: true }, written only by link() (an editor of the card) or the GM
    (join approval, create, import). Only vouched heroes earn their owners a grant on the card, so a hero flagged by hand (raw flag write) joins nothing.
    `undefined` = a card from before B11: its linked heroes are adopted on the first vouch / reconcile. */
export const vouchedOf = (e) => e?.flags?.[MODULE_ID]?.vouched;
export const isVouched = (e, a) => { const v = vouchedOf(e); return v === undefined ? true : !!v?.[a?.id]; };
const linkedHeroes = (e) => game.actors.filter((a) => a.type === "superhero" && linkOf(a) === e.id);
async function vouch(e, ids) {
  const patch = { _: true };
  if (vouchedOf(e) === undefined) for (const a of linkedHeroes(e)) patch[a.id] = true;          // adopt the links that existed before B11
  for (const id of ids) patch[id] = true;
  await e.update(modernDeletes({ [`flags.${MODULE_ID}.vouched`]: patch }));
}
async function unvouch(e, ids) {
  if (vouchedOf(e) === undefined) return;
  const patch = Object.fromEntries(ids.filter((id) => vouchedOf(e)?.[id]).map((id) => [`-=${id}`, null]));
  if (Object.keys(patch).length) await e.update(modernDeletes({ [`flags.${MODULE_ID}.vouched`]: patch }));
}

/** The ownership this card should have now (B11: policy-aware, keeps the GM's manual choices, see pure.planOwnership) -> { ownership, gen }. */
export function ownershipPlan(ref) {
  const e = resolve(ref);
  const B = data(e);
  const m = members(e, { all: true }).filter((a) => isVouched(e, a));
  const gen = e.flags?.[MODULE_ID]?.ownGen;
  return P.planOwnership({
    policy: B.policy.edit, have: e.ownership ?? {}, gen: Array.isArray(gen) ? gen : undefined,
    want: game.users.filter((u) => !isStaff(u) && m.some((a) => a.testUserPermission(u, "OWNER"))).map((u) => u.id),
    users: game.users.map((u) => ({ id: u.id, staff: isStaff(u) }))
  });
}
export function computeOwnership(ref) { return ownershipPlan(ref).ownership; }
/** GM only, idempotent. Returns { changed, ownership }. */
export async function reconcileOwnership(ref) {
  assertStaff();
  const e = resolve(ref);
  const linked = linkedHeroes(e);
  const v = vouchedOf(e);
  if (v === undefined) await vouch(e, []);                                                       // legacy card: adopt its current links once
  else {
    const stale = Object.keys(v).filter((id) => id !== "_" && !linked.some((a) => a.id === id));
    if (stale.length) await unvouch(e, stale);                                                   // heroes that left / were deleted
  }
  const plan = ownershipPlan(e);
  const changed = !P.sameOwnership(plan.ownership, e.ownership);
  if (changed) await e.update({ ownership: plan.ownership }, { diff: false, recursive: false });
  const had = e.flags?.[MODULE_ID]?.ownGen;
  if (JSON.stringify(Array.isArray(had) ? had : null) !== JSON.stringify(plan.gen)) await e.update({ [`flags.${MODULE_ID}.ownGen`]: plan.gen });
  return { changed, ownership: plan.ownership };
}
export async function reconcileAll() {
  const out = [];
  for (const e of game.actors.filter(isCard)) out.push([e.id, (await reconcileOwnership(e)).changed]);
  return out;
}

/* ------------------------------------------------------------------ create / update / remove */
/* The "Team bases" folder: SINGLE-FLIGHT (one pending creation per client), IDEMPOTENT (looks up by id, flag and name before and after the jitter) and
   created only by staff (a player is relayed to the active GM: relay op ensureFolder). The folder gets a FIXED id, so even two clients creating in the same
   network round trip collide on the id (the loser's create is refused and it takes the winner's folder) instead of leaving a duplicate behind. */
export const FOLDER_ID = "IPBTeamBases0001";
let folderMaking = null;
const folderNow = () => game.folders.get(FOLDER_ID)
  ?? game.folders.find((x) => x.type === "Actor" && x.flags?.[MODULE_ID]?.baseFolder)
  ?? game.folders.find((x) => x.type === "Actor" && !x.folder && x.name === FOLDER_NAME) ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function ensureFolder() {
  const f = folderNow();
  if (f) return Promise.resolve(f);
  folderMaking ??= makeFolder().finally(() => { folderMaking = null; });
  return folderMaking;
}
async function makeFolder() {
  if (!isStaff()) {                                                       // a player cannot create folders: ask the active GM, then wait for the document to arrive
    if (!bridge.request) throw new BaseError("relay");
    const res = await bridge.request("ensureFolder", {});
    for (let i = 0; i < 40 && !game.folders.get(res?.id); i++) await sleep(100);
    const f = game.folders.get(res?.id) ?? folderNow();
    if (!f) throw new BaseError("relay");
    return f;
  }
  await sleep(Math.random() * 250);                                       // another GM tab may be creating right now: look again after a jitter
  let f = folderNow();
  if (f) return f;
  try { f = await Folder.create({ _id: FOLDER_ID, name: FOLDER_NAME, type: "Actor", flags: { [MODULE_ID]: { baseFolder: true } } }, { keepId: true }); }
  catch (err) { await sleep(400); f = folderNow(); if (!f) throw err; }  // lost the race on the fixed id: take the winner's folder
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
  const fromRank = from ? heroRank(from).rank : null;                    // B4c: only the creation default of the stored (legacy) rank; the shown rank is derived from the members
  B.rank = P.RANKS.includes(opts.rank) ? opts.rank : P.RANKS.includes(fromRank) ? fromRank : "global";
  B.name = P.clampText(String(opts.name ?? "").trim() || from?.system?.team?.trim?.() || t("IPB.Default.Name"), 80);
  const now = Date.now();
  B.meta.created = { by: by.id, at: now };
  B.meta.updated = { by: by.id, at: now };
  const folder = await ensureFolder();
  const data0 = P.cardActorData({ name: B.name, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }, flags: { [MODULE_ID]: { [P.FLAG_KEY]: B } } },
    { type: HOST_TYPE, folder: folder.id, defaultImg: DEFAULT_IMG, sheetClass: SHEET_ID, rid: opts.rid });
  data0.flags[MODULE_ID].vouched = { _: true };                           // B11: a card made now has no pre-B11 links to adopt
  const entry = await Actor.create(data0);
  for (const a of [from, ...(opts.actors ?? []).map(actorOf)].filter(Boolean)) await link(a, entry);
  await reconcileOwnership(entry);
  return view(entry);
}

/** B13: Foundry v14 deprecates the legacy "-=key": null deletion syntax (removed in v16). Converts every such key of a document update (nested or dotted) to the ForcedDeletion operator. */
export function modernDeletes(obj) {
  const FD = globalThis.foundry?.data?.operators?.ForcedDeletion;
  if (!FD || !obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/(^|\.)-=[^.]+$/.test(k) && v === null) out[k.replace(/-=([^.]+)$/, "$1")] = new FD();
    else out[k] = (v && typeof v === "object" && v.constructor === Object) ? modernDeletes(v) : v;
  }
  return out;
}

/** Plain recursive merge with the Foundry convention "-=key" (pure.mjs; skips __proto__ / constructor / prototype). */
export const mergePatch = P.mergePatch;

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
  // B11 (A5): taking the base back (or losing it) is a GM decision; an editor cannot flip it through the Base tab or the API either
  if (!isStaff(user) && patch.base && typeof patch.base === "object" && "occupied" in patch.base && !!patch.base.occupied !== !!cur.base.occupied) throw new BaseError("noPermission");
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
  await e.update(modernDeletes(upd));
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
  const staff = isStaff(user);
  if (!staff && !a.testUserPermission(user, "OWNER")) throw new BaseError("noPermission");
  // B11 (A1, user decision): joining a base the user cannot edit needs the GM's approval: the call sends a "request to join" and returns the card view with
  // `requested: true` (nothing is linked yet). Editors of the card (policy + ownership) and staff link at once.
  if (!staff && !canEdit(e, user)) {
    if (!bridge.request) throw new BaseError("relay");
    const res = await bridge.request("requestJoin", { actorId: a.id, teamId: e.id });
    return { ...view(e), requested: !res?.linked && !res?.already, already: !!res?.already };
  }
  const old = linkOf(a);
  await vouch(e, [a.id]);                                                                          // vouch first, then flag: the GM's reconcile never sees an unvouched link of an editor
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
  await a.update(modernDeletes({ [`flags.${MODULE_ID}.-=${P.FLAG_KEY}`]: null }));
  const card = cardById(old);
  if (card) { try { await unvouch(card, [a.id]); } catch (_) { /* not an editor of the card: the GM's reconcile prunes it */ } }
  await afterLinkChange(old, "");
  return true;
}
/** B11 (A1): the GM approves a join request. Re-checks everything against real documents: the hero, the card, and that the REQUESTER still owns the hero. */
export async function approveJoin({ actorId, teamId, userId }, { by = game.user } = {}) {
  assertStaff(by);
  const a = game.actors.get(String(actorId ?? ""));
  const e = cardById(String(teamId ?? ""));
  const u = game.users.get(String(userId ?? ""));
  if (!a || a.type !== "superhero" || !e || !u) throw new BaseError("notFound", { id: String(actorId ?? "") });
  if (!a.testUserPermission(u, "OWNER")) throw new BaseError("noPermission");
  return link(a, e, { user: by });
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
/** preCreateActor (B11, A2): a NEW superhero never starts as a team member. Duplicating a hero (sidebar Duplicate, export / import, Actor.create(hero.toObject()))
    copies the link flags; the copy would double the karma pool and share the card. The link flags are removed from the new document before it is created
    (options.ipbKeepLink = true is the explicit opt-out for our own code). */
export function stripCopiedLink(actor, _data, options) {
  if (actor.type !== "superhero" || options?.ipbKeepLink) return;
  if (actor.flags?.[MODULE_ID]?.[P.FLAG_KEY] === undefined) return;
  actor.updateSource(modernDeletes({ [`flags.${MODULE_ID}.-=${P.FLAG_KEY}`]: null }));
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
    // B9: a GM tab still running pre-actor code answered the same relay request (same rid) with a JOURNAL card: the actor card wins, the journal twin is
    // dropped (its heroes are re-pointed first), so a stale tab cannot leave a second base behind.
    const rid = j.flags?.[MODULE_ID]?.rid;
    const twin = rid ? game.actors.find((x) => isCard(x) && x.flags?.[MODULE_ID]?.rid === rid) : null;
    if (twin) {
      for (const h of game.actors.filter((x) => x.type === "superhero" && linkOf(x) === j.id)) await h.update({ [`flags.${MODULE_ID}.${P.FLAG_KEY}.team`]: twin.id });
      await reconcileOwnership(twin);
      await j.delete();
      out.migrated.push({ from: j.id, to: twin.id, twin: true });
      continue;
    }
    const folder = await ensureFolder();
    const body = P.cardActorData({ id: j.id, name: j.name, ownership: j.ownership, flags: foundry.utils.deepClone(j.flags) }, { type: HOST_TYPE, folder: folder.id, defaultImg: DEFAULT_IMG, sheetClass: SHEET_ID });
    const actor = await Actor.create(body);
    for (const h of game.actors.filter((x) => x.type === "superhero" && linkOf(x) === j.id)) await h.update({ [`flags.${MODULE_ID}.${P.FLAG_KEY}.team`]: actor.id });
    await reconcileOwnership(actor);
    await j.delete();
    out.migrated.push({ from: j.id, to: actor.id });
  }
  if (out.migrated.length) {
    // every EMPTY legacy journal folder of ours (older versions raced and left a pile of duplicates); a folder holding anything is left alone
    for (const jf of game.folders.filter((f) => f.type === "JournalEntry" && f.flags?.[MODULE_ID]?.baseFolder)) {
      if (!jf.children?.length && !game.journal.some((j) => j.folder?.id === jf.id)) await jf.delete();
    }
  }
  return out;
}
const isObjectLike = (o) => !!o && typeof o === "object" && !Array.isArray(o);
