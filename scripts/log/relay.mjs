/* Activity log - RELAY (phase L3, trust rebuilt in L8). A player (or a second GM tab) asks the scribe to record a module-originated entry or a note.
   TRUST (L7-01): the server hands every socket listener the REAL sender id as the second argument (socketlib relies on it too); that id is the only identity the
   scribe believes. A payload `userId` is used ONLY when the server id is missing, and then the request is "untrusted": no staff rights, no GM-only notes, no absorb,
   ownership from the explicit actor ownership table only (a GM role does not count). Every entry that arrives through the relay is flagged `rel` (never the scribe's own
   plain entry); the payload time is clamped; senders have rate limits (notes: per user, per minute and day, and per actor per day).
   Own message kinds ("ilreq" / "ilres") on the module channel: the base relay ignores them. OPTIONAL layer: while no GM is connected a player's own record calls are queued in
   localStorage (ring buffer of 40, entries flagged approximate + relayed = unverified) and flushed when a GM is present. */
import * as E from "./events.mjs";
import * as M from "./model.mjs";
import * as CO from "./coalesce.mjs";
import * as Scribe from "./scribe.mjs";
import * as Store from "./store.mjs";

const MOD = E.MOD_ID;
const CHANNEL = `module.${MOD}`;
const TIMEOUT = 8000;
const MAX_BYTES = 8192;
const QUEUE_MAX = 40;
let started = false, seq = 0;
const pending = new Map(), seen = new Map();

export class LogError extends Error {
  constructor(code, params = {}) { super(`IPL.Err.${code}`); this.code = code; this.params = params; }
}
const isStaff = (u) => !!u && (u.isGM === true || u.hasRole?.(CONST.USER_ROLES.ASSISTANT) === true);
const ABSORB_TYPES = ["item.", "stat.", "team.", "upgrade.", "crate.", "member.", "card."];
const ABSORB_MAX_MS = 6000;
/** [allowed calls, window ms]. Staff are exempt. Change here only. */
export const LIMITS = Object.freeze({ req: [90, 60000], note: [12, 60000], noteDay: [150, 86400000], actorNoteDay: [300, 86400000], rec: [40, 60000] });
export const rates = new CO.RateLimiter();
const over = (key, [max, win]) => !rates.hit(key, Date.now(), max, win);
/** Ownership from the explicit table only: the GM role of a CLAIMED id must not make anybody the owner of everything. */
function owns(actor, user) {
  const o = actor.ownership ?? {};
  return (o[user.id] ?? o.default ?? 0) >= (CONST.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3);
}

/* ------------------------------------------------------------------ scribe side */
/** ctx = { staff (trusted staff sender), via ("local" | "relay"), trusted } */
function actorFor(sender, id, ctx) {
  const actor = game.actors.get(String(id ?? ""));
  if (!actor || !Scribe.state.states.has(actor.id)) throw new LogError("notFound");
  if (!ctx.staff && !owns(actor, sender)) throw new LogError("noPermission");
  return actor;
}
const HANDLERS = {
  record(sender, a, ctx) {
    const actor = actorFor(sender, a.actorId, ctx);
    const k = String(a.k ?? "");
    if (!E.RELAY_WHITELIST.includes(k)) throw new LogError("badInput", { k });
    if (JSON.stringify(a).length > MAX_BYTES) throw new LogError("badInput", { why: "size" });
    if (!ctx.staff) {
      if (over(`${sender.id}|rec`, LIMITS.rec)) throw new LogError("rate");
      if (k === "note.add" && (over(`${sender.id}|note`, LIMITS.note) || over(`${sender.id}|noteDay`, LIMITS.noteDay) || over(`${actor.id}|actorNoteDay`, LIMITS.actorNoteDay))) throw new LogError("rate");
    }
    if (k === "note.add") {      // a queued player note takes the same road as a live one: same switch, same text rules
      if (!ctx.staff && Store.setting("logPlayerNotes", true) === false) throw new LogError("noPermission");
      if (!String(a.d?.text ?? "").trim()) throw new LogError("badInput", { why: "empty" });
    }
    const now = Date.now();
    let t = Number(a.t);
    const maxAge = a.queued ? 7 * 86400000 : 120000;                    // live requests: the clock of the sender may be at most 2 minutes off; queued ones keep their (unverified) age
    if (!Number.isFinite(t) || t > now + 10000 || now - t > maxAge) t = now;
    const spec = { k, d: M.sanitize(a.d && typeof a.d === "object" ? a.d : {}), rid: String(a.rid ?? "").slice(0, 40), t, a: a.queued ? 1 : 0 };
    // absorb: only for a verified sender, only the sender's OWN drafts (Scribe.recordLocal binds it to the sender id), a short window, whitelisted types
    if (a.absorb && typeof a.absorb === "object" && ctx.trusted) spec.absorb = { actors: [...new Set([actor.id, ...(Array.isArray(a.absorb.actors) ? a.absorb.actors : []).map(String).filter((id) => { const x = game.actors.get(id); return !!x && Scribe.state.states.has(id) && (ctx.staff || owns(x, sender)); })])], types: (Array.isArray(a.absorb.types) ? a.absorb.types : []).filter((x) => ABSORB_TYPES.includes(x)), ms: Math.min(ABSORB_MAX_MS, Number(a.absorb.ms) || 3000) };
    const r = Scribe.recordLocal(actor, spec, sender.id, { rel: ctx.via === "relay" || !!a.queued });
    if (!r || r.error) throw new LogError("badInput", { errors: r?.error });
    return { id: r.id };
  },
  note(sender, a, ctx) {
    const actor = actorFor(sender, a.actorId, ctx);
    const gmOnly = a.gmOnly === true;
    if (gmOnly && !ctx.staff) throw new LogError("noPermission");
    if (!ctx.staff && Store.setting("logPlayerNotes", true) === false) throw new LogError("noPermission");
    if (!ctx.staff && (over(`${sender.id}|note`, LIMITS.note) || over(`${sender.id}|noteDay`, LIMITS.noteDay) || over(`${actor.id}|actorNoteDay`, LIMITS.actorNoteDay))) throw new LogError("rate");
    const text = M.clampText(String(a.text ?? "").trim(), E.POLICY.noteMax ?? 1000);
    if (!text) throw new LogError("badInput", { why: "empty" });
    const d = { text }; if (typeof a.on === "string" && M.isValidId(a.on)) d.on = a.on;
    const now = Date.now(), ct = Number(a.t);
    const t = Number.isFinite(ct) && ct <= now + 10000 && now - ct < 120000 ? ct : now;
    const r = Scribe.recordLocal(actor, { k: gmOnly ? "note.gm" : "note.add", d, rid: String(a.rid ?? "").slice(0, 40), t, v: gmOnly }, sender.id, { rel: ctx.via === "relay" });
    if (!r || r.error) throw new LogError("badInput", { errors: r?.error });
    return { id: r.id };
  }
};
/** claimed = the user id the request speaks for; meta = { trusted (id came from the server, or is this client), via } */
async function run(op, args, claimed, meta = {}) {
  try {
    const sender = game.users.get(String(claimed ?? ""));
    if (!sender) throw new LogError("noPermission");
    const h = HANDLERS[op];
    if (!h) throw new LogError("badInput", { op: String(op) });
    const trusted = meta.trusted === true, via = meta.via === "local" ? "local" : "relay";
    const ctx = { trusted, via, staff: trusted && isStaff(sender) };
    if (via === "relay" && !ctx.staff && over(`${sender.id}|req`, LIMITS.req)) throw new LogError("rate");
    return { ok: true, result: await h(sender, args && typeof args === "object" ? args : {}, ctx) };
  } catch (e) {
    if (!(e instanceof LogError)) console.warn(`${MOD} | log relay: ${op} failed`, e);
    return { ok: false, code: e?.code ?? "relay", params: e?.params ?? {} };
  }
}

/* ------------------------------------------------------------------ client side */
function send(op, args) {
  return new Promise((resolve) => {
    const id = `${game.user.id}:${++seq}:${Math.random().toString(36).slice(2, 6)}`;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, code: "relay" }); }, TIMEOUT);
    pending.set(id, (env) => { clearTimeout(timer); resolve(env); });
    game.socket.emit(CHANNEL, { k: "ilreq", id, op, args, userId: game.user.id });
  });
}
/** Perform op: locally when this client is the scribe, otherwise through the relay. Resolves to the result or rejects with LogError. */
export async function request(op, args = {}) {
  let env;
  if (Scribe.isScribe()) env = await run(op, args, game.user.id, { trusted: true, via: "local" });
  else {
    if (!game.users.activeGM) throw new LogError("noGM");
    env = await send(op, args);
  }
  if (!env?.ok) throw new LogError(env?.code ?? "relay", env?.params ?? {});
  return env.result;
}

/* ---- optional offline queue (player clients) */
const qKey = () => `ipl-queue:${game.user.id}`;
function qRead() { try { const a = JSON.parse(localStorage.getItem(qKey()) || "[]"); return Array.isArray(a) ? a.filter((x) => x && typeof x === "object" && !Array.isArray(x) && typeof x.k === "string") : []; } catch { return []; } }   // L10: a null / junk item in a hand-edited ring made queueInfo and flushQueue throw forever
function qWrite(a) { try { localStorage.setItem(qKey(), JSON.stringify(a.slice(-QUEUE_MAX))); } catch { /* storage blocked */ } }
/** Put an entry (a whitelisted record call or a note) into this device's ring buffer. Same rid = same entry id, so a re-send after a lost answer is idempotent.
 *  Re-queueing the SAME rid replaces the earlier copy, so the 40-slot ring never fills with duplicates. */
export function enqueue(args) {
  const q = qRead().filter((x) => x.rid !== args.rid);
  q.push({ ...args, queued: true, qt: Date.now() });
  const dropped = Math.max(0, q.length - QUEUE_MAX);
  qWrite(q);
  announceQueue();
  return { n: Math.min(q.length, QUEUE_MAX), dropped };
}
export const queued = () => qRead().length;
/** Plain info about the queue of this device: how many entries wait, how old the oldest is, whether a flush is running. */
export function queueInfo() {
  const q = qRead();
  return { n: q.length, oldest: q.length ? Math.min(...q.map((x) => x.qt || Date.now())) : 0, flushing, max: QUEUE_MAX, kinds: q.reduce((m, x) => { m[x.k] = (m[x.k] || 0) + 1; return m; }, {}) };
}
function announceQueue() { try { Hooks.callAll(`${MOD}.logQueue`, queueInfo()); } catch { /* listener */ } }
let flushing = false, flushTimer = 0;
const RETRY_CODES = new Set(["noGM", "relay", "notFound"]);   // the scribe may still be starting (notFound = it has not baselined this actor yet): keep the item and try again
const MAX_TRIES = 6;
/** Send every queued entry to the scribe once. Returns how many were recorded. Items refused for good (permission, bad input) are dropped; transient failures stay (up to 6 tries). */
export async function flushQueue() {
  if (flushing || game.user.isGM || !game.users.activeGM) return 0;
  flushing = true;
  let n = 0, left = [];
  try {
    const q = qRead();
    for (const item of q) {
      try { await request("record", item); n++; }
      catch (e) {
        const tries = (item.tries || 0) + 1;
        if (RETRY_CODES.has(e?.code) && tries < MAX_TRIES) left.push({ ...item, tries });
        else console.warn(`${MOD} | log queue: dropped a queued entry (${e?.code ?? "error"})`, item.k);
      }
    }
    // entries queued while the flush was running must survive: merge with whatever is stored now
    const now = qRead().filter((x) => !q.some((o) => o.rid === x.rid));
    qWrite([...left, ...now]);
    left = [...left, ...now];
  } finally { flushing = false; announceQueue(); }
  if (left.length) { clearTimeout(flushTimer); flushTimer = setTimeout(() => { flushQueue().catch(() => {}); }, 6000); }
  return n;
}

export function start() {
  if (started) return;
  started = true;
  game.socket.on(CHANNEL, async (msg, senderId) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === "ilreq") {
      if (!Scribe.isScribe()) return;
      const real = typeof senderId === "string" && game.users.has(senderId) ? senderId : null;       // the server's word (second listener argument)
      const who = real ?? String(msg.userId ?? "");
      const sk = `${who}|${msg.id}`;
      if (seen.has(sk)) return;
      seen.set(sk, Date.now()); if (seen.size > 300) seen.delete(seen.keys().next().value);
      const env = await run(msg.op, msg.args, who, { trusted: !!real, via: "relay" });
      try { game.socket.emit(CHANNEL, { k: "ilres", id: msg.id, to: who, env }, { recipients: [who] }); } catch { game.socket.emit(CHANNEL, { k: "ilres", id: msg.id, to: who, env }); }
    } else if (msg.k === "ilres" && msg.to === game.user.id) {
      pending.get(msg.id)?.(msg.env);
      pending.delete(msg.id);
    }
  });
  const kick = (ms) => setTimeout(() => flushQueue().catch(() => {}), ms);
  Hooks.on("userConnected", () => kick(2500));                 // the GM client needs a moment to elect itself scribe and baseline the actors
  Hooks.on("updateUser", (u, ch) => { if ("active" in ch && u.isGM) kick(2500); });
  kick(3000);
}
/** Test helper: run a handler as another user on this (scribe) client without any transport. */
export const _runAs = (op, args, userId, meta = { trusted: true, via: "relay" }) => run(op, args, userId, meta);
