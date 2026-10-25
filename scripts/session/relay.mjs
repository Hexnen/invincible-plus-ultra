/* End-of-session panel, phase S2: RELAY. A client that is not the active GM (a player, an assistant, a second GM user) asks the active GM client to run a request.
   Own message kinds "ssreq" / "ssres" on the module channel (the base and log relays ignore them).
   TRUST: the server hands every socket listener the REAL sender id as the second argument; that id is the only identity the GM side believes. The payload `userId`
   is used for nothing but a log hint; a request whose server id is missing is "untrusted" and refused for every action (a session has no harmless action).
   The executor (gm.mjs) does the real work: whitelist, ownership, rate limit, size cap, reducer. Protocol number: ops-pure.PROTO (an older GM tab answers "stale").
   No GM connected: the call fails at once with noGM (no queue: a silently lost check is worse than a retry). */
import * as OP from "./ops-pure.mjs";
import * as Store from "./store.mjs";
import * as GM from "./gm.mjs";

const MOD = Store.MOD;
const CHANNEL = `module.${MOD}`;
const TIMEOUT = 8000;
let started = false, seq = 0;
const pending = new Map(), seen = new Map();
const bad = (code, params = {}) => ({ ok: false, changed: false, error: { key: `IPL.Session.err.${code}`, code, params } });
const modVersion = () => String(game.modules.get(MOD)?.version ?? "");

/** Client side: run `req` ({act} or {cmd,args}) here when this client is the active GM, otherwise through the socket. Resolves to an envelope, never rejects. */
export async function request(req) {
  if (Store.iAmActiveGM()) return GM.exec(game.user, req, { trusted: true, via: "local", noJitter: true });
  if (!game.users.activeGM) return bad("noGM");
  return send(req);
}
function send(req) {
  return new Promise((resolve) => {
    const id = `${++seq}${Math.random().toString(36).slice(2, 6)}`;
    let staleTimer = 0;
    const done = (env) => { clearTimeout(timer); clearTimeout(staleTimer); pending.delete(id); resolve(env); };
    const timer = setTimeout(() => done(bad("relay")), TIMEOUT);
    // a "stale" answer (older GM tab) is only final when no better one arrives within a moment: a newer GM tab may answer as well
    pending.set(id, (env) => { if (env?.error?.code === "stale") staleTimer ||= setTimeout(() => done(env), 900); else done(env); });
    try { game.socket.emit(CHANNEL, { k: "ssreq", id, req: { ...req, id }, userId: game.user.id, proto: OP.PROTO, mod: modVersion() }); } catch { done(bad("relay")); }
  });
}

export function start() {
  if (started) return;
  started = true;
  game.socket.on(CHANNEL, async (msg, senderId) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === "ssreq") {
      if (!Store.iAmActiveGM()) return;
      const real = typeof senderId === "string" && game.users.has(senderId) ? senderId : null;            // the server's word
      const sender = real ? game.users.get(real) : null;
      const sk = `${real ?? "?"}|${msg.id}`;
      if (seen.has(sk)) return;                                                                            // the same envelope twice: ignore
      seen.set(sk, Date.now()); if (seen.size > 300) seen.delete(seen.keys().next().value);
      const to = real ?? String(msg.userId ?? "");
      const env = await GM.exec(sender, msg.req && typeof msg.req === "object" ? { ...msg.req, id: String(msg.id ?? "").slice(0, 24) } : msg.req, { trusted: !!real, via: "relay", proto: msg.proto, mod: msg.mod });
      if (!to || !game.users.has(to)) return;
      if (env?.session) env.session = undefined;                                                          // the requester renders from the world setting; do not ship the whole session back
      try { game.socket.emit(CHANNEL, { k: "ssres", id: msg.id, to, env }, { recipients: [to] }); } catch { game.socket.emit(CHANNEL, { k: "ssres", id: msg.id, to, env }); }
    } else if (msg.k === "ssres" && msg.to === game.user.id) {
      pending.get(msg.id)?.(msg.env);
    }
  });
}
/** Test helper: run a request as another user on this (GM) client without any transport. meta.trusted defaults to true (as the server would say). */
export const _runAs = (userId, req, meta = {}) => GM.exec(game.users.get(userId), req, { trusted: true, via: "relay", noJitter: true, ...meta });
export const PROTO = OP.PROTO;
