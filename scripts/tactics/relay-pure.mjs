/* Tactical combat: RELAY, the pure half (spec section 12). NO Foundry globals (node-tested in check-relay.mjs).
   Protocol constants, the request whitelist per operation, the limits for non-staff, request ids, envelopes, and the decisions of both ends
   (is this incoming request admissible; is this incoming reply mine). relay.mjs only moves messages. Modelled on scripts/session (reviewed pattern). */
import { ERROR_CODES } from "./engine-pure.mjs";
import { PLAYER_OPS, GM_OPS, ROUND_PLAYER_OPS } from "./director-pure.mjs";
import * as O from "./ops-pure.mjs";

export const PROTO = 1;
export const KIND = Object.freeze({ req: "tcreq", res: "tcres", ev: "tcev", roll: "tcroll", wip: "tcwip" });
/* S081: `timeout` is how long a requester waits for the executor to take the request at all (no GM: fail fast, spec 12.1); `working`
   how long it waits once the executor said it is carrying it out (tcwip): a long animated move or a busy queue is not "no GM". */
export const LIMITS = Object.freeze({ bytes: 4096, perMin: 90, inFlight: 3, readsPerMin: 180, text: 300, timeout: 8000, staleWait: 900, working: 120000 });   // spec 12.1
export const RELAY_CODES = Object.freeze([...new Set([...ERROR_CODES, "relay", "noPrev"])]);          // every code either machine or the transport can answer
const ID_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const BAD = new Set(["__proto__", "prototype", "constructor"]);
export const isId = (v) => typeof v === "string" && ID_RE.test(v) && !BAD.has(v);
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
export const bad = (code, params = {}) => ({ ok: false, changed: false, error: { key: `ITAC.err.${code}`, code, params } });
export const sizeOf = (v) => { try { const s = JSON.stringify(v); let n = 0; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3; } return n; } catch { return Infinity; } };
export const clamp = (s, n = LIMITS.text) => (typeof s === "string" ? s.slice(0, n) : undefined);
/** spec 12.1: every request gets the id `<senderId>:<id>`; the sender part is the server's word, so one user cannot replay or pre-empt another's ids. */
export const makeRid = (senderId, id) => `${senderId}:${String(id ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}`;

/* ------------------------------------------------------------------ what a player may send (spec 12.2): fields per op, everything else is dropped */
const ids = (v, n = 12) => (Array.isArray(v) ? [...new Set(v.filter(isId))].slice(0, n) : undefined);      // D92: an id named twice is named once
/* P3: what a move may carry (spec 9.6): where to, which way of moving, the stress option, quick or full, barriers to force, who is carried */
function moveOf(r) {
  const out = {};
  if (typeof r.to === "string") out.to = r.to.slice(0, 60);
  if (typeof r.mode === "string" && isId(r.mode)) out.mode = r.mode.slice(0, 24);
  if (r.stress === true || r.stress === 1) out.stress = 1;
  if (r.pay === "quick" || r.pay === "full") out.pay = r.pay;
  if (typeof r.airborne === "boolean") out.airborne = r.airborne;
  if (r.force === true || r.force === 1) out.force = true;
  else if (isObj(r.force)) out.force = Object.fromEntries(Object.entries(r.force).filter(([k, x]) => k.length <= 50 && !BAD.has(k) && (x === "door" || x === "wall")).slice(0, 12));
  const carry = ids(r.carry, 4); if (carry) out.carry = carry;
  return out;
}
function declOf(d) {
  if (!isObj(d)) return null;
  const out = {};
  if (typeof d.action === "string") out.action = d.action.slice(0, 40);
  for (const k of ["targets", "fullAuto", "tokens"]) { const v = ids(d[k]); if (v) out[k] = v; }
  if (d.fullAuto === true || d.fullAuto === 1) out.fullAuto = true;                          // [B2543]: the flag the declare panel sends; the targets are the declaration's
  for (const k of ["weapon", "power"]) if (typeof d[k] === "string") out[k] = d[k].slice(0, 120);
  for (const k of ["zone", "special", "attr", "item"]) if (typeof d[k] === "string") out[k] = d[k].slice(0, 40);
  if (typeof d.opt === "string") out.opt = d.opt.slice(0, 120);                              // as long as the engine keeps it (engine-pure.OPT_MAX)
  if (Array.isArray(d.path)) out.path = d.path.filter((z) => typeof z === "string").slice(0, 24).map((z) => z.slice(0, 40));
  Object.assign(out, moveOf(d));
  for (const k of ["wreck", "area", "blind", "noPush"]) if (d[k] === true || d[k] === 1) out[k] = 1;
  if (Array.isArray(d.exploits)) out.exploits = d.exploits.filter((e) => isObj(e) && isId(e.id)).slice(0, 8).map((e) => ({ id: e.id, stress: Math.max(0, Math.min(20, Math.trunc(Number(e.stress) || 0))) }));
  if (Number.isFinite(d.pulled)) out.pulled = Math.max(0, Math.trunc(d.pulled));
  if (typeof d.text === "string") out.text = clamp(d.text);
  if (isObj(d.exception) && typeof d.exception.text === "string") out.exception = { text: clamp(d.exception.text) };
  return out;                                                       // `secret`, `mod`, forced values: GM only, never from a player
}
function valueOf(v, depth = 0) {
  if (typeof v === "string") return clamp(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "boolean") return v;
  if (depth > 2) return undefined;
  if (Array.isArray(v)) return v.slice(0, 16).map((x) => valueOf(x, depth + 1)).filter((x) => x !== undefined);
  if (isObj(v)) { const o = {}; for (const k of Object.keys(v).slice(0, 12)) { if (BAD.has(k) || k.length > 24 || k === "always") continue; const x = valueOf(v[k], depth + 1); if (x !== undefined) o[k] = x; } return o; }
  return undefined;
}
const SHAPES = {
  declare: (r) => (isId(r.actor) && isObj(r.decl) ? { actor: r.actor, decl: declOf(r.decl) } : null),
  amend: (r) => (isId(r.inst) && isObj(r.decl) ? { inst: r.inst, decl: declOf(r.decl) } : null),
  cancel: (r) => (isId(r.inst) ? { inst: r.inst } : null),
  answer: (r) => { const value = valueOf(r.value); return isId(r.prompt) && value !== undefined && value !== null ? { prompt: r.prompt, value } : null; },
  help: (r) => (isId(r.inst) && isId(r.helper) ? { inst: r.inst, helper: r.helper } : null),
  move: (r) => (isId(r.actor) ? { actor: r.actor, ...moveOf(r), action: ["openDoor", "breachDoor", "unseal"].includes(r.action) ? r.action : undefined } : null),
  exception: (r) => (isId(r.actor) && typeof r.text === "string" && r.text ? { actor: r.actor, text: clamp(r.text), inst: isId(r.inst) ? r.inst : undefined,
    /* U3: the rule that refused (an id from the engine's own refusal) and the declaration that was refused, so a grant can run it */
    reason: isId(r.reason) ? r.reason : undefined, decl: isObj(r.decl) ? declOf(r.decl) : undefined } : null),
  preview: (r) => (isId(r.actor) && isObj(r.decl) ? { actor: r.actor, decl: declOf(r.decl), of: ids(r.of, 40), at: isId(r.at) ? r.at : undefined, acts: Array.isArray(r.acts) ? r.acts.filter(isObj).slice(0, 12).map(declOf) : undefined } : null),   // reads only: the dice a declaration would roll; W1: and whom it could be aimed at (`of`: the candidates)
  other: (r) => (isId(r.actor) && typeof r.text === "string" && r.text ? { actor: r.actor, text: clamp(r.text) } : null),
  crewPass: (r) => (isId(r.actor) ? { actor: r.actor } : null),      // ANSD (CHASE2-9): a chase crew member gives up the shot of this round
};
/** Normalise a request. Players: whitelist + size cap. Staff: any known operation, payload as sent (the executor still validates every field).
    Returns { ok:true, req } or { ok:false, code }. */
export function normalize(req, { staff = false } = {}) {
  if (!isObj(req) || typeof req.op !== "string") return { ok: false, code: "badInput" };
  const known = PLAYER_OPS.includes(req.op) || GM_OPS.includes(req.op);
  if (!known) return { ok: false, code: "badInput" };
  if (staff) return sizeOf(req) <= 64 * 1024 ? { ok: true, req } : { ok: false, code: "badInput" };
  if (!PLAYER_OPS.includes(req.op)) return { ok: false, code: "noPermission" };
  if (sizeOf(req) > LIMITS.bytes) return { ok: false, code: "tooBig" };
  if (ROUND_PLAYER_OPS.includes(req.op)) {                          // the round driver's own operations: its own whitelist (ops-pure.normalize), one definition
    const n = O.normalize(req, { staff: false });
    if (!n.ok) return { ok: false, code: n.error?.code === "notOwner" ? "noPermission" : "badInput" };
    const { type, ...rest } = n.action;
    return { ok: true, req: { op: type, ...rest } };
  }
  const shaped = SHAPES[req.op]?.(req);
  if (!shaped) return { ok: false, code: "badInput" };
  for (const k of Object.keys(shaped)) if (shaped[k] === undefined) delete shaped[k];
  return { ok: true, req: { op: req.op, ...shaped } };
}

/* ------------------------------------------------------------------ limits for non-staff (spec 12.1): 90 per minute, 3 in flight */
/** a request that only asks (nothing is written, nothing is spent, no card): counted apart from the ones that act */
export const isRead = (req) => req?.op === "preview";
export class Gate {
  constructor(limits = LIMITS) { this.limits = limits; this.times = new Map(); this.flying = new Map(); this.reads = new Map(); }
  /** null when admitted (and counted), else "rate" / "busy". Staff are never limited.
      `read` (P8f): a question that changes nothing (op "preview": the pool, who is in reach, the menu at a token) has a budget of its
      own and is not counted as in flight. The surfaces ask such questions by themselves on every change of the fight, of the map and
      of a sheet; counted with the real requests they could use up the 90 a minute, and the answer to a reaction card or a
      declaration then came back `rate` / `busy` although the player had done nothing. A flood of questions is still stopped. */
  admit(userId, now, staff = false, read = false) {
    if (staff) return null;
    if (read) {
      const rl = (this.reads.get(userId) ?? []).filter((t) => now - t < 60000);
      if (rl.length >= (this.limits.readsPerMin ?? this.limits.perMin)) { this.reads.set(userId, rl); return "rate"; }
      rl.push(now); this.reads.set(userId, rl);
      return null;
    }
    const list = (this.times.get(userId) ?? []).filter((t) => now - t < 60000);
    if (list.length >= this.limits.perMin) { this.times.set(userId, list); return "rate"; }
    if ((this.flying.get(userId) ?? 0) >= this.limits.inFlight) return "busy";
    list.push(now); this.times.set(userId, list);
    this.flying.set(userId, (this.flying.get(userId) ?? 0) + 1);
    return null;
  }
  release(userId, staff = false, read = false) { if (!staff && !read) this.flying.set(userId, Math.max(0, (this.flying.get(userId) ?? 0) - 1)); }
}

/* ------------------------------------------------------------------ the executor's admission of one incoming tcreq
   ctx = { senderId (the socket listener's 2nd argument, or null), user: (id) -> { id, staff } | null, gate, now, seen: Map,
           hasCombat: (id) -> bool      the executor serves every combat of the world: an unknown one is `gone`
           | combatId                   or exactly one combat: no combat is `off`, another one is `stale` }
   Returns { ok:true, rid, req, user } or { ok:false, env, to } (to = whom to answer, null = nobody). */
export function admit(msg, ctx) {
  if (!isObj(msg) || msg.k !== KIND.req) return { ok: false, env: null, to: null };
  const user = typeof ctx.senderId === "string" ? ctx.user(ctx.senderId) : null;
  if (!user) return { ok: false, env: bad("untrusted"), to: null };                         // spec 12.1: identity is the server-supplied sender id and nothing else
  const to = user.id;
  if (typeof msg.id !== "string" && typeof msg.id !== "number") return { ok: false, env: bad("badInput"), to };
  const sk = `${user.id}|${msg.id}`;
  if (ctx.seen) { if (ctx.seen.has(sk)) return { ok: false, env: null, to: null }; ctx.seen.set(sk, ctx.now); if (ctx.seen.size > 300) ctx.seen.delete(ctx.seen.keys().next().value); }
  if (msg.proto !== PROTO) return { ok: false, env: bad("stale", { proto: PROTO }), to };
  if (typeof ctx.hasCombat === "function") { if (typeof msg.combat !== "string" || !ctx.hasCombat(msg.combat)) return { ok: false, env: bad("gone"), to }; }
  else {
    if (ctx.combatId == null) return { ok: false, env: bad("off"), to };
    if (msg.combat !== ctx.combatId) return { ok: false, env: bad("stale", { combat: 1 }), to };
  }
  const n = normalize(msg.req, { staff: !!user.staff });
  if (!n.ok) return { ok: false, env: bad(n.code), to };
  const lim = ctx.gate ? ctx.gate.admit(user.id, ctx.now, !!user.staff, isRead(n.req)) : null;
  if (lim) return { ok: false, env: bad(lim), to };
  return { ok: true, rid: makeRid(user.id, msg.id), req: n.req, user: { id: user.id, staff: !!user.staff }, to };
}
/** The envelope as it travels: never the state (clients render from the Combat flag). */
export function wireEnv(env) {
  if (!isObj(env)) return bad("internal");
  const out = { ok: env.ok === true, changed: env.changed === true };
  for (const k of ["dup", "inst", "prompt"]) if (env[k] !== undefined) out[k] = env[k];
  /* D99 (spec 15: a failed inverse is told to the GM): what the request could not do travels too, to the GM's own desk (this function
     also shapes the local executor's answers) and to a player whose request it was: `partial` (carried out only in part), `failed`
     (which kind of write stayed as it was; kinds and reason ids only, no name and no value), `parked` (the action that went to the
     GM's hand), `undone` (the transactions an undo took back), `rev` (the state the answer is about). */
  if (env.partial) out.partial = true;
  if (Array.isArray(env.failed) && env.failed.length) out.failed = env.failed.filter(isObj).slice(0, 20).map((f) => ({ ...(isId(f.tx) ? { tx: f.tx } : {}), t: String(f.t ?? "").slice(0, 24), ...(isId(f.reason) ? { reason: f.reason } : {}), ...(isId(f.what) ? { what: f.what } : {}) }));
  if (isId(env.parked)) out.parked = env.parked;
  if (Array.isArray(env.undone)) out.undone = env.undone.filter(isId).slice(0, 200);
  if (Number.isFinite(env.rev) || env.rev === null) out.rev = env.rev;
  if (env.asked) out.asked = 1;
  if (isObj(env.preview)) out.preview = env.preview;                 // the asker's own pool (engine-pure.opPreview refuses anything the asker does not own)
  if (!out.ok) out.error = isObj(env.error) && RELAY_CODES.includes(env.error.code) ? { key: `ITAC.err.${env.error.code}`, code: env.error.code, params: isObj(env.error.params) ? env.error.params : {} } : bad("internal").error;
  return out;
}
/** Requester side: is this tcres the answer to one of my pending requests? Accepted only from a GM sender and only with the matching nonce. */
export function acceptReply(msg, { me, pending, senderIsGM }) {
  if (!isObj(msg) || msg.k !== KIND.res || msg.to !== me || !senderIsGM) return null;
  const p = pending.get(msg.id);
  if (!p || p.nonce !== msg.n) return null;
  return { id: msg.id, env: wireEnv(msg.env), stale: msg.env?.error?.code === "stale" };
}
/** S081: the executor's word that it took the request and is carrying it out (sent before the work, the envelope follows). */
export const makeWorking = ({ id, n, to }) => ({ k: KIND.wip, id, n, to });
/** Requester side: is this tcwip about one of my pending requests? The same trust as a reply: a GM sender, the matching nonce. -> the id or null */
export function acceptWorking(msg, { me, pending, senderIsGM }) {
  if (!isObj(msg) || msg.k !== KIND.wip || msg.to !== me || !senderIsGM) return null;
  const p = pending.get(msg.id);
  return p && p.nonce === msg.n ? msg.id : null;
}
export const makeRequest = ({ id, nonce, mod, combat, rev, req }) => ({ k: KIND.req, id, n: nonce, proto: PROTO, mod, combat, rev, req });
