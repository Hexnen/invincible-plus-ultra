/* Activity log - RELAY (phase L3). A player (or a second GM tab) asks the scribe to record a module-originated entry or a note. Same trust rules as scripts/base/relay.mjs:
   module sockets carry no authenticated sender, so the sender id is a CLAIM; the scribe re-validates it against the real actor ownership / role, whitelists the types,
   clamps the payload, flags the entry `rel` (relayed claim) and dedupes by request id (several GM tabs all receive the request; entry ids are deterministic anyway).
   Own message kinds ("ilreq" / "ilres") on the module channel: the base relay ignores them. OPTIONAL layer: while no GM is connected a player's own record calls are queued in
   localStorage (ring buffer of 40, entries flagged approximate + relayed = unverified) and flushed when a GM is present. */
import * as E from "./events.mjs";
import * as M from "./model.mjs";
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

/* ------------------------------------------------------------------ scribe side */
function actorFor(sender, id) {
  const actor = game.actors.get(String(id ?? ""));
  if (!actor || !Scribe.state.states.has(actor.id)) throw new LogError("notFound");
  if (!isStaff(sender) && !actor.testUserPermission(sender, "OWNER")) throw new LogError("noPermission");
  return actor;
}
const HANDLERS = {
  record(sender, a) {
    const actor = actorFor(sender, a.actorId);
    const k = String(a.k ?? "");
    if (!E.RELAY_WHITELIST.includes(k)) throw new LogError("badInput", { k });
    if (JSON.stringify(a).length > MAX_BYTES) throw new LogError("badInput", { why: "size" });
    const now = Date.now();
    let t = Number(a.t);
    const maxAge = a.queued ? 7 * 86400000 : 600000;
    if (!Number.isFinite(t) || t > now + 60000 || now - t > maxAge) t = now;
    const spec = { k, d: M.sanitize(a.d && typeof a.d === "object" ? a.d : {}), rid: String(a.rid ?? "").slice(0, 40), t, a: a.queued ? 1 : 0 };
    if (a.absorb && typeof a.absorb === "object") spec.absorb = { actors: [...new Set([actor.id, ...(Array.isArray(a.absorb.actors) ? a.absorb.actors : []).map(String).filter((id) => { const x = game.actors.get(id); return !!x && Scribe.state.states.has(id) && (isStaff(sender) || x.testUserPermission(sender, "OWNER")); })])], types: (Array.isArray(a.absorb.types) ? a.absorb.types : []).filter((x) => ABSORB_TYPES.includes(x)), ms: Math.min(10000, Number(a.absorb.ms) || 3000) };
    const r = Scribe.recordLocal(actor, spec, sender.id, { rel: sender.id !== game.user.id || !!a.queued });
    if (!r || r.error) throw new LogError("badInput", { errors: r?.error });
    return { id: r.id };
  },
  note(sender, a) {
    const actor = actorFor(sender, a.actorId);
    const gmOnly = a.gmOnly === true;
    if (gmOnly && !isStaff(sender)) throw new LogError("noPermission");
    if (!isStaff(sender) && Store.setting("logPlayerNotes", true) === false) throw new LogError("noPermission");
    const text = M.clampText(String(a.text ?? "").trim(), E.POLICY.noteMax ?? 1000);
    if (!text) throw new LogError("badInput", { why: "empty" });
    const d = { text }; if (typeof a.on === "string" && M.isValidId(a.on)) d.on = a.on;
    const r = Scribe.recordLocal(actor, { k: gmOnly ? "note.gm" : "note.add", d, rid: String(a.rid ?? "").slice(0, 40), t: Number.isFinite(Number(a.t)) && Math.abs(Date.now() - Number(a.t)) < 600000 ? Number(a.t) : Date.now(), v: gmOnly }, sender.id, { rel: sender.id !== game.user.id });
    if (!r || r.error) throw new LogError("badInput", { errors: r?.error });
    return { id: r.id };
  }
};
async function run(op, args, claimed) {
  try {
    const sender = game.users.get(String(claimed ?? ""));
    if (!sender) throw new LogError("noPermission");
    const h = HANDLERS[op];
    if (!h) throw new LogError("badInput", { op: String(op) });
    return { ok: true, result: await h(sender, args && typeof args === "object" ? args : {}) };
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
  if (Scribe.isScribe()) env = await run(op, args, game.user.id);
  else {
    if (!game.users.activeGM) throw new LogError("noGM");
    env = await send(op, args);
  }
  if (!env?.ok) throw new LogError(env?.code ?? "relay", env?.params ?? {});
  return env.result;
}

/* ---- optional offline queue (player clients) */
const qKey = () => `ipl-queue:${game.user.id}`;
function qRead() { try { const a = JSON.parse(localStorage.getItem(qKey()) || "[]"); return Array.isArray(a) ? a : []; } catch { return []; } }
function qWrite(a) { try { localStorage.setItem(qKey(), JSON.stringify(a.slice(-QUEUE_MAX))); } catch { /* storage blocked */ } }
export function enqueue(args) { const q = qRead(); q.push({ ...args, queued: true, qt: Date.now() }); qWrite(q); return q.length; }
export const queued = () => qRead().length;
let flushing = false;
export async function flushQueue() {
  if (flushing || game.user.isGM || !game.users.activeGM) return 0;
  flushing = true;
  let n = 0;
  try {
    const q = qRead(); const left = [];
    for (const item of q) {
      try { await request("record", item); n++; } catch (e) { if (e?.code === "noGM" || e?.code === "relay") left.push(item); /* refused: drop */ }
    }
    qWrite(left);
  } finally { flushing = false; }
  return n;
}

export function start() {
  if (started) return;
  started = true;
  game.socket.on(CHANNEL, async (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === "ilreq") {
      if (!Scribe.isScribe()) return;
      if (seen.has(msg.id)) return;
      seen.set(msg.id, Date.now()); if (seen.size > 300) seen.delete(seen.keys().next().value);
      const env = await run(msg.op, msg.args, msg.userId);
      game.socket.emit(CHANNEL, { k: "ilres", id: msg.id, to: msg.userId, env });
    } else if (msg.k === "ilres" && msg.to === game.user.id) {
      pending.get(msg.id)?.(msg.env);
      pending.delete(msg.id);
    }
  });
  Hooks.on("userConnected", () => { setTimeout(() => flushQueue().catch(() => {}), 1500); });
  setTimeout(() => flushQueue().catch(() => {}), 3000);
}
/** Test helper: run a handler as another user on this (scribe) client without any transport. */
export const _runAs = (op, args, userId) => run(op, args, userId);
