/* Activity log - API (phase L3): game.modules.get("invincible-plus-ultra").api.log. No UI yet. Spec 5. Methods never throw unless documented; null = not logged / not allowed. */
import * as E from "./events.mjs";
import * as M from "./model.mjs";
import * as D from "./diff.mjs";
import * as CO from "./coalesce.mjs";
import * as F from "./filter.mjs";
import * as X from "./export.mjs";
import * as P from "./prune.mjs";
import * as C from "./capture-pure.mjs";
import * as Store from "./store.mjs";
import * as Scribe from "./scribe.mjs";
import * as Relay from "./relay.mjs";
import { t as tr } from "./lang.mjs";

const MOD = E.MOD_ID;
export const VERSION = "0.3.0";

function resolve(target) {
  if (!target) return null;
  if (typeof target === "object" && target.documentName === "Actor") return target;
  if (typeof target === "object" && target.id) target = target.id;
  if (typeof target !== "string") return null;
  if (target.includes(".")) { try { const d = fromUuidSync(target); return d?.documentName === "Actor" ? d : null; } catch { return null; } }
  return game.actors.get(target) ?? null;
}
const scopeOfActor = (a) => (Scribe.isBaseCard(a) ? "base" : "hero");
const isStaff = (u) => !!u && (u.isGM === true || u.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);

export const isScribe = () => Scribe.isScribe();
export const scribe = () => (game.users.activeGM ?? null);
/** Can `user` read this actor's log? GM: always; others: the journal must be visible to them (the scribe grants OBSERVER by the read-access setting). */
export function canView(target, user = game.user) {
  const a = resolve(target); if (!a || !user) return false;
  if (!Store.enabled()) return false;
  if (isStaff(user)) return true;
  return !!Store.actorJournal(a.id)?.testUserPermission(user, "OBSERVER");
}
export function canNote(target, user = game.user) {
  const a = resolve(target); if (!a || !user || !Store.enabled()) return false;
  if (isStaff(user)) return true;
  return Store.setting("logPlayerNotes", true) !== false && a.testUserPermission(user, "OWNER") && canView(a, user);
}
const accessOf = (a, user) => (isStaff(user) ? "gm" : a.testUserPermission(user, "OWNER") ? "owner" : a.testUserPermission(user, "OBSERVER") ? "observer" : "none");

export function read(target, { user } = {}) {
  const a = resolve(target);
  const u = user ? game.users.get(user) ?? game.user : game.user;
  if (!a) return { entries: [], total: 0, canSee: false, access: "none" };
  const access = accessOf(a, u);
  if (!canView(a, u)) return { entries: [], total: 0, canSee: false, access };
  const entries = Store.readEntries(a.id, { secret: isStaff(u) });
  return { entries, total: entries.length, canSee: true, access };
}
export function query(entries, filter = {}, ctx = {}) {
  return F.filterEntries(entries, filter, { scope: ctx.scope ?? "hero", userId: ctx.userId ?? game.user?.id, users: ctx.users ?? Object.fromEntries(game.users.map((u) => [u.id, u.name])), ...ctx });
}
export function subscribe(target, fn) {
  const id = target === "*" ? "*" : resolve(target)?.id;
  return Store.subscribe((info) => { if (id === "*" || info.actorId === id) fn(info); });
}

const rid = () => `${game.user.id}:${Math.random().toString(36).slice(2, 10)}`;
/** record(target, {k, d, v?, absorb?, t?}) -> {id, queued?} | null */
export async function record(target, spec = {}) {
  try {
    const a = resolve(target);
    if (!a || !spec || typeof spec.k !== "string" || !Store.enabled()) return null;
    if (!E.isKnownType(spec.k) || !E.inScope(spec.k, scopeOfActor(a))) return null;
    const t = Number.isFinite(spec.t) ? spec.t : Date.now();
    const id = rid();
    const args = { actorId: a.id, k: spec.k, d: spec.d ?? {}, absorb: spec.absorb, rid: id, t, v: !!spec.v || E.visibilityOf({ k: spec.k }) === "G" };
    if (Scribe.isScribe()) { const r = Scribe.recordLocal(a, { ...args }, game.user.id); return r && !r.error ? { id: r.id } : null; }
    if (!game.users.activeGM) {
      if (!game.user.isGM && E.RELAY_WHITELIST.includes(spec.k) && a.testUserPermission(game.user, "OWNER")) { Relay.enqueue(args); return { id: M.makeId(t, a.id, spec.k, id, game.user.id), queued: true }; }
      return null;
    }
    const r = await Relay.request("record", args);
    return { id: r.id };
  } catch (e) { if (!(e instanceof Relay.LogError)) console.warn(`${MOD} | log.record failed`, e); return null; }
}
/** note(target, text, {gmOnly?, on?}) -> {id} | null. Players need owner rights + the setting; the relay needs a GM online (no queue for notes). */
export async function note(target, text, { gmOnly = false, on } = {}) {
  try {
    const a = resolve(target);
    if (!a || !canNote(a) || (gmOnly && !isStaff(game.user))) return null;
    const args = { actorId: a.id, text: String(text ?? ""), gmOnly: !!gmOnly && isStaff(game.user), rid: rid(), t: Date.now(), ...(on ? { on } : {}) };
    const r = await Relay.request("note", args);
    return { id: r.id };
  } catch (e) { if (!(e instanceof Relay.LogError)) console.warn(`${MOD} | log.note failed`, e); return null; }
}

export function stats(target) { const a = resolve(target); return a ? Store.counts(a.id) : null; }
/** export(target, {format, filter, all}) -> {filename, mime, text} (data only; saving is the UI's job) */
export function exportLog(target, { format = "json", filter, all = true, text, labels, offsetMin } = {}) {
  const a = resolve(target); if (!a) return null;
  const r = read(a); if (!r.canSee) return null;
  const users = Object.fromEntries(game.users.map((u) => [u.id, u.name]));
  const list = all || !filter ? r.entries : query(r.entries, filter, { scope: scopeOfActor(a) });
  return X.exportEntries(list, format, { actor: { id: a.id, name: a.name, uuid: a.uuid, type: scopeOfActor(a) }, exportedAt: Date.now(), exportedBy: game.user.name, users, scope: scopeOfActor(a), ...(typeof text === "function" ? { text } : {}), ...(labels ? { labels } : {}), ...(Number.isFinite(offsetMin) ? { offsetMin } : {}) });
}

/** GM only: annotate / redact / trim. */
export async function annotate(target, id, text) { return note(target, text, { gmOnly: true, on: id }); }
export async function redact(target, ids) {
  const a = resolve(target); if (!a || !isStaff(game.user) || !Scribe.isScribe()) return null;
  const list = Array.isArray(ids) ? ids : [ids];
  const patches = [], missing = [];
  for (const id of list) {
    const f = Store.findEntry(a.id, id);
    if (!f) { missing.push(id); continue; }
    if (f.entry.k === "log.redact") continue;
    patches.push({ entry: P.redactEntry(f.entry, game.user.id), secret: f.secret });
  }
  if (patches.length) await Store.commit(a, scopeOfActor(a), { patches });
  return { redacted: patches.length, missing };
}
/** trim(target, {keep}) -> prune plan or null. keep = entries to keep (default: the retention setting). */
export async function trim(target, { keep } = {}) {
  const a = resolve(target); if (!a || !isStaff(game.user) || !Scribe.isScribe()) return null;
  await Scribe.drain();
  return Store.pruneIfNeeded(a, scopeOfActor(a), Number.isFinite(keep) ? keep : null);
}

/** Dev / world switch: restrict capture to these actor ids (null / [] = every eligible actor). GM only. */
export async function scope(actorIds) {
  if (!game.user.isGM) return null;
  if (actorIds === undefined) return Store.scopeIds();
  const ids = Array.isArray(actorIds) && actorIds.length ? actorIds.map(String) : null;
  await game.settings.set(MOD, "logScope", ids ? JSON.stringify(ids) : "");
  return ids;
}
export function status() {
  const s = Scribe.summary();
  return {
    version: VERSION, enabled: Store.enabled(), isScribe: s.on, scribe: game.users.activeGM?.name ?? null, user: game.user.name, readAccess: Store.readAccess(), scope: Store.scopeIds(),
    transport: "channel", queued: Relay.queued(), ...s, folder: !!Store.logFolder(), journals: Store.allLogJournalIds().length
  };
}
export async function flush() { if (Scribe.isScribe()) await Scribe.drain(); }

export const logApi = {
  record, note, read, query, subscribe, canView, canNote, isScribe, scribe, export: exportLog, stats, annotate, redact, trim, scope, status, flush,
  types: E.TYPES, categories: E.CATEGORIES, pure: { E, M, D, CO, F, X, P, C }, t: tr, version: VERSION, LogError: Relay.LogError,
  _internal: { Store, Scribe, Relay }
};
