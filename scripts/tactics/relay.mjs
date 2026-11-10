/* Tactical combat (package P1): the RELAY (spec 12.1). A client that is not the executor (a player, an assistant, a second GM user) asks
   the active GM's client to run a request. Own message kinds "tcreq" / "tcres" on the module channel (the base, log and session relays
   ignore them; this one ignores theirs). Protocol number ops-pure.PROTO: an older GM tab answers "stale".
   TRUST: the server hands every socket listener the REAL sender id as the second argument; that id is the only identity the executor
   believes. A request whose server id is missing is "untrusted" and refused. The reply is bound to the request id plus a nonce only the
   executor and the asking client saw, and is accepted from a GM sender only.
   No GM connected: the call fails at once with noGM (no queue). The public event broadcast "tcev" of the spec belongs to the journal (P2);
   in P1 every client learns of a change from the Combat document itself. */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as Store from "./store.mjs";
import * as GM from "./gm.mjs";

const CHANNEL = `module.${Store.MOD}`;
export const TIMEOUT = 8000, STALE_WAIT = 900;
let started = false, seq = 0;
const pending = new Map(), seen = new Map();

/** Run `req` ({ op, ... }) for a combat: here when this client is the executor, otherwise through the socket. Resolves to an envelope, never rejects. */
export async function request(combatId, req) {
  try {
    if (Store.iAmExecutor()) return await GM.exec(game.user, combatId, req, { trusted: true, via: "local", noJitter: true });
    if (!game.users.activeGM) return S.err("noGM");
    return await send(combatId, req);
  } catch (e) { return S.err("internal", { msg: String(e?.message ?? e).slice(0, 80) }); }
}
function send(combatId, req) {
  return new Promise((resolve) => {
    const id = `${++seq}${Math.random().toString(36).slice(2, 6)}`;
    const nonce = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
    const gmId = game.users.activeGM?.id;
    let staleTimer = 0;
    const done = (env) => { clearTimeout(timer); clearTimeout(staleTimer); pending.delete(id); resolve(env); };
    const timer = setTimeout(() => done(S.err("noGM", { reason: "timeout" })), TIMEOUT);
    // a "stale" answer (an older GM tab) is final only when no better one arrives within a moment
    pending.set(id, { nonce, fn: (env) => { if (env?.error?.code === "stale") staleTimer ||= setTimeout(() => done(env), STALE_WAIT); else done(env); } });
    const msg = { k: "tcreq", id, n: nonce, combat: String(combatId ?? ""), req: { ...req, id }, proto: O.PROTO };
    try { if (gmId) game.socket.emit(CHANNEL, msg, { recipients: [gmId] }); else game.socket.emit(CHANNEL, msg); } catch { done(S.err("noGM", { reason: "socket" })); }
  });
}

export function start() {
  if (started) return;
  started = true;
  game.socket.on(CHANNEL, async (msg, senderId) => {
    try {
      if (!msg || typeof msg !== "object") return;
      if (msg.k === "tcreq") {
        if (!Store.iAmExecutor()) return;
        const real = typeof senderId === "string" && game.users.has(senderId) ? senderId : null;            // the server's word
        if (!real) return;                                                                                   // nobody to answer; an unsigned request is dropped
        const sk = `${real}|${msg.id}`;
        if (seen.has(sk)) return;                                                                            // the same envelope twice
        seen.set(sk, Date.now()); if (seen.size > 300) seen.delete(seen.keys().next().value);
        let bytes = Infinity;
        try { bytes = JSON.stringify(msg.req ?? null).length; } catch { /* not serialisable: refused by the size check */ }
        const req = msg.req && typeof msg.req === "object" ? { ...msg.req, id: String(msg.id ?? "").slice(0, 24) } : msg.req;
        const env = await GM.exec(game.users.get(real), typeof msg.combat === "string" ? msg.combat.slice(0, 64) : "", req, { trusted: true, via: "relay", proto: msg.proto, bytes });
        const out = { k: "tcres", id: msg.id, n: msg.n, to: real, env };
        try { game.socket.emit(CHANNEL, out, { recipients: [real] }); } catch { game.socket.emit(CHANNEL, out); }
      } else if (msg.k === "tcres" && msg.to === game.user.id) {
        if (game.users.get(senderId)?.isGM !== true) return;                                                // only a GM can answer
        const p = pending.get(msg.id);
        if (p && typeof msg.n === "string" && msg.n === p.nonce) p.fn(msg.env);
      }
    } catch (e) { console.warn(`${Store.MOD} | tactics relay`, e); }
  });
}
/** Test helper: run a request as another user on this (executor) client without any transport. */
export const _runAs = (userId, combatId, req, meta = {}) => GM.exec(game.users.get(userId), combatId, req, { trusted: true, via: "relay", noJitter: true, ...meta });
