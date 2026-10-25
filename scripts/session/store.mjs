/* End-of-session panel, phase S2: STORAGE. The live session is ONE world setting `sessionState` (a JSON string written by P.serialize, so a write always REPLACES the
   whole value: no merge surprises), the last 20 finished sessions are `sessionArchive`. Foundry delivers world-setting changes to every client (late joiners load
   them with the world), so live sync and reconnect come free; every client renders from `current()` (re-sanitised: hostile or old data never breaks a UI).
   WRITER: only a GM client writes (the active GM, or a GM tab running a local click). Writes go through commit(): a per-client queue, the pure reducer, then
   a compare-and-swap by VERIFICATION: after our write we wait a moment and re-read; if another GM tab overwrote it (the request id is not in `seen`), the
   action is applied again to the newer state (rid dedupe makes a double application a no-op). */
import * as P from "./pure.mjs";
import * as OP from "./ops-pure.mjs";
import { t } from "./lang.mjs";

export const MOD = P.MOD_ID;
export const SETTING_STATE = "sessionState";
export const SETTING_ARCHIVE = "sessionArchive";
export const SETTING_ALLOW = "sessionAllowPlayers";
export const SETTING_CHAT = "sessionChatSummary";
export const SETTING_AUTO = "sessionAutoOpen";
export const SETTLE_MS = 150;
export const CAS_TRIES = 6;
const HOOK = `${MOD}.session`;

const subs = new Set();
let cache = { raw: undefined, value: null };
/** The cached session is shared by every caller: frozen, so nobody can corrupt it by accident (P functions never mutate). */
function deepFreeze(o) { if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }

/* ------------------------------------------------------------------ settings */
export function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  const reg = (key, data) => { if (!has(key)) game.settings.register(MOD, key, data); };
  reg(SETTING_STATE, { scope: "world", config: false, type: String, default: "", onChange: () => notify("state") });
  reg(SETTING_ARCHIVE, { scope: "world", config: false, type: String, default: "", onChange: () => notify("archive") });
  reg(SETTING_ALLOW, { name: t("IPL.Session.Settings.allowPlayers.Name"), hint: t("IPL.Session.Settings.allowPlayers.Hint"), scope: "world", config: true, type: Boolean, default: true });
  reg(SETTING_CHAT, { name: t("IPL.Session.Settings.chatSummary.Name"), hint: t("IPL.Session.Settings.chatSummary.Hint"), scope: "world", config: true, type: Boolean, default: false });
  reg(SETTING_AUTO, { name: t("IPL.Session.Settings.autoOpen.Name"), hint: t("IPL.Session.Settings.autoOpen.Hint"), scope: "client", config: true, type: Boolean, default: true });
}
export const setting = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };

/* ------------------------------------------------------------------ identity / roles */
export const isStaff = (u) => !!u && (u.isGM === true || u.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);
export const iAmActiveGM = () => !!game.user?.isGM && game.users.activeGM?.id === game.user.id;
export const ownerLevel = () => CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
/** Does `user` own the actor (explicit ownership table only; the GM role of a CLAIMED id never counts)? */
export const owns = (actor, user) => !!actor && !!user && OP.ownsFrom(actor.ownership, user.id, ownerLevel());

/* ------------------------------------------------------------------ reads */
/** The live session as every client sees it (sanitised copy, or null). Cached by the raw setting string. */
export function current() {
  const raw = setting(SETTING_STATE, "");
  if (cache.raw === raw) return cache.value;
  cache = { raw, value: raw ? deepFreeze(P.parse(raw)) : null };
  return cache.value;
}
export const archive = () => OP.parseArchive(setting(SETTING_ARCHIVE, ""));

/* ------------------------------------------------------------------ subscriptions */
/** subscribe(fn) -> unsubscribe. fn(info) with info = { kind: "state"|"archive"|"status"|"actor", session, status }. Listener errors never break the others. */
export function subscribe(fn) {
  if (typeof fn !== "function") return () => {};
  subs.add(fn);
  return () => subs.delete(fn);
}
export function notify(kind = "state", extra = {}) {
  const info = { kind, session: current(), ...extra };
  for (const fn of [...subs]) { try { fn(info); } catch (e) { console.warn(`${MOD} | session subscriber failed`, e); } }
  try { Hooks.callAll(HOOK, info); } catch { /* hook listener */ }
}

/* ------------------------------------------------------------------ writes (GM clients only) */
let chain = Promise.resolve();
/** Run fn after everything queued before it on THIS client (errors never break the chain). */
export const queue = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Raw write of the live slot (null clears it). Only GM clients may call this (the server refuses others). */
export async function writeState(session) {
  const raw = session ? P.serialize(session) : "";
  await game.settings.set(MOD, SETTING_STATE, raw);
  return raw;
}
export async function writeArchive(list) {
  const slim = list.map((e) => ({ at: e.at, reason: e.reason, session: { ...e.session, log: [], seen: [] } }));
  await game.settings.set(MOD, SETTING_ARCHIVE, JSON.stringify(slim));
}
/** Move a finished session to the archive and clear the live slot. Idempotent (same id replaces its older archive copy). */
export async function archiveSession(session, reason) {
  await writeArchive(OP.pushArchive(archive(), session, reason, Date.now()));
  await writeState(null);
}

/** Apply ONE reducer action to the live session. ctx = { user:{id,staff}, owns(heroId) }; the action SHOULD carry a rid (verification uses it).
    Resolves to the reducer result ({ok, changed, session, dup?, error?}) plus { attempts }. Never throws. */
export function commit(action, ctx) {
  return queue(async () => {
    let r = null;
    try {
      for (let attempt = 1; attempt <= CAS_TRIES; attempt++) {
        const cur = current();
        r = P.reduce(cur, action, { ...ctx, now: Date.now() });
        r.attempts = attempt;
        if (!r.ok || !r.changed) return r;
        const next = r.session;
        if (next.state === "discarded") { await archiveSession(next, "discarded"); return r; }
        await writeState(next);
        await wait(SETTLE_MS);
        const now = current();
        const applied = action.type === "start" ? now?.id === next.id : (action.rid ? now?.seen?.includes(action.rid) : now?.rev >= next.rev);
        if (applied) return r;                                // nobody overwrote us: done
        await wait(Math.random() * SETTLE_MS * attempt);       // lost a race with another GM tab: random, growing back-off so the two do not retry in lockstep
      }
      return { ...r, ok: false, changed: false, error: { key: "IPL.Session.err.busy", code: "busy", params: {} } };
    } catch (e) {
      console.warn(`${MOD} | session commit failed`, e);
      return { ok: false, changed: false, error: { key: "IPL.Session.err.internal", code: "internal", params: { msg: String(e?.message ?? e).slice(0, 80) } } };
    }
  });
}
/** Test helper: forget the parse cache. */
export const _resetCache = () => { cache = { raw: undefined, value: null }; };
