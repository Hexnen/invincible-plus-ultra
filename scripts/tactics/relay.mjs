/* Tactical combat, package P2: RELAY, the Foundry half (spec section 12.1). Decisions live in relay-pure.mjs; this file moves messages.
   Kinds on the module channel (the base, log and session relays ignore them): tcreq (to the active GM), tcres (to the requester), tcev (public events,
   everyone), tcroll (the executor asks a user's client to open the roll dialog for an engine roll).
   TRUST: the socket listener's second argument (the server-supplied sender id) is the only identity. A reply counts only from a GM sender with the nonce. */
import * as R from "./relay-pure.mjs";
import * as Store from "./p1-standin-store.mjs";
import * as Engine from "./engine.mjs";
import * as Sys from "./system-adapter.mjs";
import { t } from "./lang.mjs";

const MOD = Store.MOD;
const CHANNEL = `module.${MOD}`;
let started = false, seq = 0;
const pending = new Map(), seen = new Map(), gate = new R.Gate(), opened = new Set();
const modVersion = () => String(game.modules.get(MOD)?.version ?? "");

/** Run `req` here when this client is the executor, otherwise through the socket. Resolves to an envelope, never rejects. */
export async function request(req) {
  try {
    if (Store.iAmExecutor()) return R.wireEnv(await Engine.exec(game.user, req, { via: "local" }));
    if (!game.users.activeGM) return R.bad("noGM");                                        // nothing is queued (spec 12.1)
    const combat = Store.combat();
    if (!combat) return R.bad("off");
    return await send(req, combat);
  } catch (err) { console.warn(`${MOD} | tactics relay`, err); return R.bad("internal"); }
}
function send(req, combat) {
  return new Promise((resolve) => {
    const id = `${++seq}${Math.random().toString(36).slice(2, 6)}`;
    const nonce = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
    let staleTimer = 0;
    const done = (env) => { clearTimeout(timer); clearTimeout(staleTimer); pending.delete(id); resolve(env); };
    const timer = setTimeout(() => done(R.bad("relay")), R.LIMITS.timeout);
    pending.set(id, { nonce, fn: (env, stale) => { if (stale) staleTimer ||= setTimeout(() => done(env), R.LIMITS.staleWait); else done(env); } });
    const msg = R.makeRequest({ id, nonce, mod: modVersion(), combat: combat.id, rev: Store.read(combat).state?.rev, req });
    try { game.socket.emit(CHANNEL, msg, { recipients: [game.users.activeGM.id] }); } catch { done(R.bad("relay")); }
  });
}
async function onRequest(msg, senderId) {
  if (!Store.iAmExecutor()) return;
  const a = R.admit(msg, { senderId: typeof senderId === "string" && game.users.has(senderId) ? senderId : null, user: (id) => { const u = game.users.get(id); return u ? { id: u.id, staff: Store.isStaff(u) } : null; },
    combatId: Store.combat()?.id ?? null, gate, now: Date.now(), seen });
  let env = a.env;
  if (a.ok) {
    try { env = await Engine.exec(game.users.get(a.user.id), a.req, { rid: a.rid, via: "relay" }); } catch { env = R.bad("internal"); } finally { gate.release(a.user.id, a.user.staff); }
  }
  if (!a.to || !env) return;
  const res = { k: R.KIND.res, id: msg.id, n: msg.n, to: a.to, env: R.wireEnv(env) };
  try { game.socket.emit(CHANNEL, res, { recipients: [a.to] }); } catch { /* the requester times out */ }
}
function onRoll(msg, senderId) {
  if (!game.users.get(senderId)?.isGM || !Array.isArray(msg.to) || !msg.to.includes(game.user.id) || !msg.req || typeof msg.req.rid !== "string") return;
  if (opened.has(msg.req.rid)) return;                                                     // one dialog per request, even if it is sent twice
  opened.add(msg.req.rid); if (opened.size > 200) opened.delete(opened.values().next().value);
  // the engine's breakdown is only a display: the executor reads the dice from the chat message and checks its author against the request
  Sys.openRoll(msg.req, (s) => t(`ITAC.mod.${String(s).split(":")[0]}`, {}, String(s))).catch((err) => { console.warn(`${MOD} | tactics: roll dialog`, err); ui.notifications?.warn(t("ITAC.warn.rollDialog")); });
}

export function start() {
  if (started) return;
  started = true;
  game.socket.on(CHANNEL, (msg, senderId) => {
    try {
      if (!msg || typeof msg !== "object") return;
      if (msg.k === R.KIND.req) onRequest(msg, senderId).catch((err) => console.warn(`${MOD} | tactics relay`, err));
      else if (msg.k === R.KIND.res) { const r = R.acceptReply(msg, { me: game.user.id, pending, senderIsGM: game.users.get(senderId)?.isGM === true }); if (r) pending.get(r.id)?.fn(r.env, r.stale); }
      else if (msg.k === R.KIND.ev) { if (game.users.get(senderId)?.isGM === true && msg.ev && typeof msg.ev === "object") Hooks.callAll(Engine.HOOK_PUBLIC, msg.ev); }
      else if (msg.k === R.KIND.roll) onRoll(msg, senderId);
    } catch (err) { console.warn(`${MOD} | tactics relay listener`, err); }
  });
}
/** Test helper (GM only, as in the session relay): run a request exactly as if `userId` had sent it through the relay. */
export async function _runAs(userId, req) {
  if (!Store.iAmExecutor()) return R.bad("noPermission");
  const u = game.users.get(userId);
  if (!u) return R.bad("untrusted");
  const n = R.normalize(req, { staff: Store.isStaff(u) });
  if (!n.ok) return R.bad(n.code);
  return R.wireEnv(await Engine.exec(u, n.req, { via: "relay", rid: R.makeRid(u.id, `as${++seq}`) }));
}
