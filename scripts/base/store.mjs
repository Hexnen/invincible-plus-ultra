/* Team & Base card, phase B3: STORE. A team card is a world JournalEntry with its data in flags["invincible-plus-ultra"].base (schema: pure.mjs).
   A "team" argument anywhere in the base API may be a JournalEntry, its id, its uuid or a view returned by this file. Views are
   { id, uuid, ...normalized B }. Membership lives on the heroes (flags[...].base.team), members are derived. No UI here. */
import * as P from "./pure.mjs";
import { t } from "./lang.mjs";

export const MODULE_ID = "invincible-plus-ultra";
export const FOLDER_NAME = "Plus Ultra - Team cards";
export const SETTING_SHOW = "baseShowInJournal";
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
export const isCard = (entry) => !!entry && entry.documentName === "JournalEntry" && !!entry.flags?.[MODULE_ID]?.[P.FLAG_KEY];

export function resolve(ref) {
  let e = ref;
  if (ref && typeof ref === "object" && !(ref instanceof foundry.abstract.Document)) e = ref.id ? game.journal.get(ref.id) : null;
  else if (typeof ref === "string") e = game.journal.get(ref) ?? (ref.startsWith("JournalEntry.") ? fromUuidSync(ref) : null);
  if (!isCard(e)) throw new BaseError("notFound", { id: typeof ref === "string" ? ref : ref?.id ?? "" });
  return e;
}
export const rawData = (entry) => entry.flags?.[MODULE_ID]?.[P.FLAG_KEY] ?? {};
/** Normalized B, name mirrored from the entry. */
export function data(ref) {
  const e = resolve(ref);
  const B = P.normalize(clone(rawData(e)));
  B.name = e.name;
  return B;
}
export function view(ref) {
  const e = resolve(ref);
  return { id: e.id, uuid: e.uuid, ...data(e) };
}
export function list() { return game.journal.filter(isCard).map((e) => view(e)); }
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
  for (const e of game.journal.filter(isCard)) out.push([e.id, (await reconcileOwnership(e)).changed]);
  return out;
}

/* ------------------------------------------------------------------ create / update / remove */
async function ensureFolder() {
  let f = game.folders.find((x) => x.type === "JournalEntry" && x.flags?.[MODULE_ID]?.baseFolder);
  if (!f) f = await Folder.create({ name: FOLDER_NAME, type: "JournalEntry", flags: { [MODULE_ID]: { baseFolder: true } } });
  return f;
}
const actorOf = (a) => (typeof a === "string" ? game.actors.get(a) : a);

/** Create a card. GM/assistant create directly, everybody else is relayed to the active GM (needs basePlayersCreate).
    opts: { name, rank, actors[], fromActor (Actor|id: link it and read its rank flag) } */
export async function create(opts = {}) {
  const from = actorOf(opts.fromActor);
  if (!isStaff()) {
    if (!bridge.request) throw new BaseError("relay");
    const res = await bridge.request("createTeam", { name: opts.name ?? "", rank: opts.rank ?? "", fromActorId: from?.id ?? "" });
    const id = res?.id;
    for (let i = 0; i < 40 && !game.journal.get(id); i++) await new Promise((r) => setTimeout(r, 100));
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
  const entry = await JournalEntry.create({
    name: B.name, folder: folder.id, ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
    flags: { [MODULE_ID]: { [P.FLAG_KEY]: B } }
  });
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
  const { name, ...rest } = patch;
  const flagPatch = { ...rest, meta: { updated: { by: user.id, at: Date.now() } } };
  if (typeof name === "string") flagPatch.name = P.clampText(name.trim(), 80);
  const upd = { flags: { [MODULE_ID]: { [P.FLAG_KEY]: flagPatch } } };
  if (typeof name === "string" && name.trim()) upd.name = P.clampText(name.trim(), 80);
  await e.update(upd);
  if ("policy" in patch && isStaff()) await reconcileOwnership(e);
  return view(e);
}
export function setPolicy(ref, patch, opts) {
  return update(ref, { policy: patch }, opts);
}

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
  for (const id of ids.filter((x) => x && game.journal.get(x))) {
    if (isStaff()) await reconcileOwnership(id);
    else if (bridge.request) { try { await bridge.request("reconcile", { teamId: id }); } catch (_) { /* no GM online: reconciled at the next GM login */ } }
  }
}

/* ------------------------------------------------------------------ directory hook */
const showInJournal = () => { try { return game.settings.get(MODULE_ID, SETTING_SHOW) === true; } catch { return false; } };

/** renderJournalDirectory: hides team cards (and their folder) from the sidebar unless the client setting reveals them. */
export function hideInDirectory(app, html) {
  try {
    if (showInJournal()) return;
    const root = html instanceof HTMLElement ? html : html?.[0] ?? app?.element;
    if (!root?.querySelectorAll) return;
    for (const li of root.querySelectorAll("li[data-entry-id]")) if (isCard(game.journal.get(li.dataset.entryId))) li.remove();
    for (const li of root.querySelectorAll("li[data-folder-id]")) {
      const f = game.folders.get(li.dataset.folderId);
      if (f?.flags?.[MODULE_ID]?.baseFolder) li.remove();
    }
  } catch (e) { console.warn(`${MODULE_ID} | base: directory hook failed`, e); }
}
