/* Tactical combat: RELAY, the Foundry half (spec section 12.1). Decisions live in relay-pure.mjs; this file moves messages.
   A client that is not the executor (a player, an assistant, a second GM user) asks the active GM's client to run a request.
   Kinds on the module channel (the base, log and session relays ignore them; this one ignores theirs):
     tcreq   to the active GM          a request for one combat
     tcres   to the requester          its envelope (never the state: clients render from the Combat flag)
     tcev    to everyone               one public event of a fight (spec 16), re-told on the hook "invincible-plus-ultra.tactics"
     tcroll  to a roller's client      the executor asks it to open the roll dialog for an engine roll
   TRUST: the socket listener's second argument (the server-supplied sender id) is the only identity. A request whose server id is
   missing is dropped. The reply is bound to the request id plus a nonce only the executor and the asking client saw, and counts only
   from a GM sender. No GM connected: the call fails at once with noGM (nothing is queued). */
import * as R from "./relay-pure.mjs";
import * as Store from "./store.mjs";
import * as Engine from "./engine.mjs";
import * as Sys from "./system-adapter.mjs";
import { t, rollTitle } from "./lang.mjs";

const MOD = Store.MOD;
const CHANNEL = `module.${MOD}`;
let started = false, seq = 0;
const pending = new Map(), seen = new Map(), gate = new R.Gate(), opened = new Set();
const modVersion = () => String(game.modules.get(MOD)?.version ?? "");

/** Run `req` ({ op, ... }) for a combat: here when this client is the executor, otherwise through the socket. Resolves to an envelope, never rejects. */
export async function request(combatId, req) {
  try {
    if (Store.iAmExecutor()) return R.wireEnv(await Engine.exec(game.user, combatId, req, { via: "local" }));
    if (!game.users.activeGM) return R.bad("noGM");                                        // nothing is queued (spec 12.1)
    const combat = Store.combatOf(combatId);
    if (!combat) return R.bad("gone");
    return await send(req, combat);
  } catch (err) { console.warn(`${MOD} | tactics relay`, err); return R.bad("internal"); }
}
function send(req, combat) {
  return new Promise((resolve) => {
    const id = `${++seq}${Math.random().toString(36).slice(2, 6)}`;
    const nonce = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
    let staleTimer = 0;
    const done = (env) => { clearTimeout(timer); clearTimeout(staleTimer); pending.delete(id); resolve(env); };
    const timer = setTimeout(() => done(R.bad("noGM", { reason: "timeout" })), R.LIMITS.timeout);
    // a "stale" answer (an older GM tab) is final only when no better one arrives within a moment
    pending.set(id, { nonce, fn: (env, stale) => { if (stale) staleTimer ||= setTimeout(() => done(env), R.LIMITS.staleWait); else done(env); } });
    const msg = R.makeRequest({ id, nonce, mod: modVersion(), combat: combat.id, rev: Store.stateOf(combat)?.rev, req });
    try { game.socket.emit(CHANNEL, msg, { recipients: [game.users.activeGM.id] }); } catch { done(R.bad("relay")); }
  });
}
const userOf = (id) => { const u = game.users.get(id); return u ? { id: u.id, staff: Store.isStaff(u) } : null; };
/* One incoming tcreq on the executor: admitted by relay-pure (trust, protocol, whitelist, limits), run, answered. -> the envelope (tests) */
async function onRequest(msg, senderId) {
  if (!Store.iAmExecutor()) return null;
  const a = R.admit(msg, { senderId: typeof senderId === "string" && game.users.has(senderId) ? senderId : null, user: userOf, hasCombat: (id) => id.length <= 64 && !!Store.combatOf(id), gate, now: Date.now(), seen });
  let env = a.env;
  if (a.ok) {
    try { env = await Engine.exec(game.users.get(a.user.id), msg.combat, a.req, { rid: a.rid, via: "relay" }); } catch { env = R.bad("internal"); } finally { gate.release(a.user.id, a.user.staff, R.isRead(a.req)); }
  }
  if (!a.to || !env) return env ?? null;
  const res = { k: R.KIND.res, id: msg.id, n: msg.n, to: a.to, env: R.wireEnv(env) };
  try { game.socket.emit(CHANNEL, res, { recipients: [a.to] }); } catch { /* the requester times out */ }
  return res.env;
}
function onRoll(msg, senderId) {
  if (!game.users.get(senderId)?.isGM || !Array.isArray(msg.to) || !msg.to.includes(game.user.id) || !msg.req || typeof msg.req.rid !== "string") return;
  /* one throw per request, even if it is sent twice; D120: the executor's roll watch sends the same request again (`again`) when no answer
     reached it: then this client throws once more (Sys.rollNow force: not within ROLL_RETRY_MS of its last throw), its first throw lost */
  const again = Number.isInteger(msg.again) && msg.again > 0;
  if (opened.has(msg.req.rid) && !again) return;
  opened.add(msg.req.rid); if (opened.size > 200) opened.delete(opened.values().next().value);
  /* U2: several players own the character: the first of them at the table throws at once, the others keep the dock's "Roll" */
  if (msg.to.find((u) => game.users.get(u)?.active) !== game.user.id) return;
  // the engine's breakdown is only a display: the executor reads the dice from the chat message and checks its author against the request
  const req = { ...msg.req, label: rollTitle(msg.req.key, typeof msg.req.labelSrc === "string" ? msg.req.labelSrc.slice(0, 80) : msg.req.label) };      // D105: titled in the ROLLER's language
  Sys.rollNow(req, (s) => t(`ITAC.mod.${String(s).split(":")[0]}`, {}, String(s)), { force: again }).catch((err) => { console.warn(`${MOD} | tactics: roll dialog`, err); ui.notifications?.warn(t("ITAC.warn.rollDialog")); });
}
function onMessage(msg, senderId) {
  try {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === R.KIND.req) onRequest(msg, senderId).catch((err) => console.warn(`${MOD} | tactics relay`, err));
    else if (msg.k === R.KIND.res) { const r = R.acceptReply(msg, { me: game.user.id, pending, senderIsGM: game.users.get(senderId)?.isGM === true }); if (r) pending.get(r.id)?.fn(r.env, r.stale); }
    else if (msg.k === R.KIND.ev) { if (game.users.get(senderId)?.isGM === true && msg.ev && typeof msg.ev === "object") Hooks.callAll(Store.HOOK, msg.ev); }
    else if (msg.k === R.KIND.roll) onRoll(msg, senderId);
  } catch (err) { console.warn(`${MOD} | tactics relay listener`, err); }
}

export function start() {
  if (started) return;
  started = true;
  game.socket.on(CHANNEL, onMessage);
}
export const isStarted = () => started;
/** Test helper (executor only, as in the session relay): run a request exactly as if `userId` had sent it through the relay: the same
    admission (trust, whitelist, limits), no transport. meta = { id?, proto?, senderId? (null: no server id) } */
export async function _runAs(userId, combatId, req, meta = {}) {
  if (!Store.iAmExecutor()) return R.bad("noGM");
  const env = await onRequest({ k: R.KIND.req, id: meta.id ?? req?.id ?? `as${++seq}`, n: "local", proto: meta.proto ?? R.PROTO, mod: modVersion(), combat: combatId, req }, "senderId" in meta ? meta.senderId : userId);
  return env ?? R.bad("untrusted");
}
/** Test helper: forget the rate counters. */
export const _resetLimits = () => { gate.times.clear(); gate.flying.clear(); gate.reads.clear(); seen.clear(); };
