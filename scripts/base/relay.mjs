/* Team & Base card, phase B3: RELAY. Lets a non-GM ask the active GM client to do what only a GM may: create a team base (a player has no
   ACTOR_CREATE), re-grant card ownership after linking a hero (reconcile), ask to JOIN a base they cannot edit (B11: needs the GM's approval, see join.mjs),
   or "ask the GM" for a purchase. The GM side re-validates EVERYTHING against real documents (the sender's actual ownership / role, input clamped);
   nothing in the payload is trusted.
   Transport follows scripts/turn: socketlib when it is active (module.json has "socket": true), otherwise the module's own channel
   "module.invincible-plus-ultra". B11 (A8) TRUST: module sockets carry no authenticated sender on the plain channel, so a user id read from a channel payload is
   only a CLAIM. socketlib gives the real sender (`this.socketdata.userId`, set by the server): only those requests (and the GM's own, local ones) are "trusted".
   Every op except `reconcile` (idempotent, computed from real documents, harmless for any claimed user) needs a trusted sender; on the plain channel they
   answer code "untrusted" instead of acting on a claim. B11 (A9): staff are never limited, everybody else has a per-op quota (QUOTA below). */
import * as P from "./pure.mjs";
import * as S from "./store.mjs";
import * as Join from "./join.mjs";
import { t } from "./lang.mjs";

const MOD = S.MODULE_ID;
const CHANNEL = `module.${MOD}`;
const TIMEOUT = 8000;
export const PROTO = 3;                 // relay protocol number: bump when a handler's meaning changes; older GM tabs then answer "stale" (B11: 3, requestJoin + trust)
let sock = null, started = false, seq = 0;
const pending = new Map();

/** Per sender and op: [allowed calls, window in ms]. Change here only. Staff are exempt. */
export const QUOTA = Object.freeze({ createTeam: [3, 60000], requestJoin: [6, 60000], ask: [6, 60000], askCreate: [4, 60000], reconcile: [30, 60000] });
const TRUSTED_ONLY = new Set(["createTeam", "requestJoin", "ask", "askCreate"]);
const hits = new Map();
const recentNotices = new Map();         // coalescing: the same notice (sender|team|text) within NOTICE_MS shows once
const NOTICE_MS = 15000;

const iAmActiveGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

/** Is the sender a member of the team (owns a hero linked to it) or an editor of its card? */
const involved = (sender, e) => S.canEdit(e, sender) || S.members(e, { all: true }).some((a) => a.testUserPermission(sender, "OWNER"));

/* ------------------------------------------------------------------ GM side */
const HANDLERS = {
  /** args { name, rank, fromActorId }. A player needs the world setting basePlayersCreate and must own the actor given. */
  async createTeam(sender, args) {
    const staff = S.isStaff(sender);
    const allowed = staff || game.settings.get(MOD, S.SETTING_PLAYERS_CREATE) === true;
    if (!allowed) throw new S.BaseError("noPermission");
    const from = args.fromActorId ? game.actors.get(String(args.fromActorId)) : null;
    if (args.fromActorId && !from) throw new S.BaseError("notFound", { id: String(args.fromActorId) });
    if (from && !staff && (from.type !== "superhero" || !from.testUserPermission(sender, "OWNER"))) throw new S.BaseError("noPermission");
    // Several clients of the same GM user (two browser tabs) all receive the request: a random delay and a lookup by the request id make exactly one of them
    // create the card; the others return the card that already exists.
    const rid = String(args.rid ?? "").slice(0, 32);
    if (rid) {
      await new Promise((res) => setTimeout(res, Math.random() * 350));
      const dup = game.actors.find((e) => e.flags?.[MOD]?.rid === rid);
      if (dup) return { id: dup.id };
    }
    const team = await S.createLocal({
      name: P.clampText(String(args.name ?? ""), 80), rank: P.RANKS.includes(args.rank) ? args.rank : undefined, fromActor: from, rid
    }, sender);
    // B9: two tabs can still create within the same network round trip. After a short settle every creator keeps only the card with the LOWEST id for
    // this request and deletes its own when it lost, then makes sure the hero points at the survivor (a tab running the same code converges on one card).
    if (rid) {
      await new Promise((res) => setTimeout(res, 450));
      const rivals = game.actors.filter((e) => S.isCard(e) && e.flags?.[MOD]?.rid === rid).map((e) => e.id).sort();
      if (rivals.length > 1 && rivals[0] !== team.id && game.actors.get(team.id)) {
        if (from) await S.link(from, rivals[0]).catch(() => null);          // re-point the hero BEFORE deleting (main.mjs clears the links of a deleted base); as the GM: ownership was verified above
        await game.actors.get(team.id)?.delete();
        return { id: rivals[0] };
      }
    }
    return { id: team.id };
  },
  /** args { teamId }. Idempotent and harmless (computes ownership from real actor ownership), so any known user may ask. */
  async reconcile(_sender, args) {
    const e = S.cardById(String(args.teamId ?? ""));
    if (!e) throw new S.BaseError("notFound", { id: String(args.teamId ?? "") });
    return { changed: (await S.reconcileOwnership(e)).changed };
  },
  /** B11 (A1). args { actorId, teamId }. The sender must own the hero (checked here against the real document). A sender who may already edit the card is linked
      at once; everybody else gets a join request card in the GMs' chat. Returns { linked } | { already } | { requested, again }. */
  async requestJoin(sender, args) {
    const a = game.actors.get(String(args.actorId ?? ""));
    const e = S.cardById(String(args.teamId ?? ""));
    if (!a || a.type !== "superhero") throw new S.BaseError("notFound", { id: String(args.actorId ?? "") });
    if (!e) throw new S.BaseError("notFound", { id: String(args.teamId ?? "") });
    if (!S.isStaff(sender) && !a.testUserPermission(sender, "OWNER")) throw new S.BaseError("noPermission");
    if (S.linkOf(a) === e.id && S.isVouched(e, a)) return { already: true };
    if (S.isStaff(sender) || S.canEdit(e, sender)) { await S.link(a, e); return { linked: true }; }
    if (Join.pending({ userId: sender.id }).length >= Join.MAX_PENDING_PER_USER) throw new S.BaseError("rate");
    const { again } = await Join.post({ actor: a, team: e, user: sender });
    return { requested: true, again };
  },
  /** args { actorId }. A player without the right to create cards asks the GM to make one for a hero they own; the GM gets a notification + the hook. */
  async askCreate(sender, args) {
    const a = game.actors.get(String(args.actorId ?? ""));
    if (!a || a.type !== "superhero") throw new S.BaseError("notFound", { id: String(args.actorId ?? "") });
    if (!S.isStaff(sender) && !a.testUserPermission(sender, "OWNER")) throw new S.BaseError("noPermission");
    notice(sender, "", `team card for ${a.name}`, () => Hooks.callAll(`${MOD}.baseRequest`, { team: "", actor: a.id, from: sender.id, what: "create" }));
    return { delivered: true };
  },
  /** args { teamId, what }. A member / editor asks the GM for something (e.g. buying an upgrade); the GM client gets a notification + a hook. B11 (A9): not for
      strangers, and the same notice from the same user shows once per NOTICE_MS. */
  async ask(sender, args) {
    const e = S.cardById(String(args.teamId ?? ""));
    if (!e) throw new S.BaseError("notFound", { id: String(args.teamId ?? "") });
    if (!S.isStaff(sender) && !involved(sender, e)) throw new S.BaseError("noPermission");
    const what = P.clampText(String(args.what ?? ""), 200);
    notice(sender, e.id, `${what} (${e.name})`, () => Hooks.callAll(`${MOD}.baseRequest`, { team: e.id, from: sender.id, what }));
    return { delivered: true };
  }
};

/** One notification + hook per distinct (sender, team, text) per NOTICE_MS; the map is pruned so it cannot grow. */
function notice(sender, teamId, text, fire) {
  const now = Date.now();
  for (const [k, ts] of recentNotices) if (now - ts > NOTICE_MS) recentNotices.delete(k);
  const key = `${sender.id}|${teamId}|${text}`;
  if (recentNotices.has(key)) return false;
  recentNotices.set(key, now);
  fire();
  ui.notifications?.info(`${sender.name}: ${text}`);
  return true;
}

/** Runs on the GM client. Returns an envelope, never throws.
    VERSION HANDSHAKE (B9): every request carries the sender's relay protocol number. A GM tab whose code is OLDER than the sender (proto < request's)
    refuses with code "stale" instead of acting on semantics it may not know; the requester retries the idempotent ops (a newer GM tab may also have answered)
    and otherwise tells the user to reload the GM tabs. LIMIT: tabs that loaded the module BEFORE B9 have no such check (they ignore the number and answer as
    before): reload every GM tab once after updating; this only protects future protocol bumps. Bump PROTO whenever a handler's meaning changes.
    meta.trusted = the sender id comes from the server (socketlib) or is the local GM; false = read from a channel payload (a claim). */
async function run(op, args, claimedUserId, meta = {}) {
  try {
    if (Number(meta.proto) > PROTO) return { ok: false, code: "stale", params: { theirs: Number(meta.proto), mine: PROTO, version: String(meta.mod ?? "") } };
    const sender = game.users.get(String(claimedUserId ?? ""));
    if (!sender) throw new S.BaseError("noPermission");
    const h = HANDLERS[op];
    if (!h) throw new S.BaseError("badInput", { op: String(op) });
    if (TRUSTED_ONLY.has(op) && meta.trusted !== true) throw new S.BaseError("untrusted");
    if (!S.isStaff(sender) && QUOTA[op]) {
      const q = P.rateHit(hits, `${sender.id}|${op}`, Date.now(), QUOTA[op][0], QUOTA[op][1]);
      if (!q.ok) throw new S.BaseError("rate", { seconds: Math.ceil(q.retryMs / 1000) });
    }
    return { ok: true, result: await h(sender, args && typeof args === "object" ? args : {}) };
  } catch (e) {
    console.warn(`${MOD} | base relay: ${op} refused`, e);
    return { ok: false, code: e?.code ?? "relay", params: e?.params ?? {} };
  }
}

/* ------------------------------------------------------------------ client side */
/** Perform op: locally when this client is the active GM, otherwise relay to the active GM. Rejects with BaseError. */
export async function request(op, args = {}) {
  let env;
  if (iAmActiveGM()) env = await run(op, args, game.user.id, { trusted: true });
  else {
    if (!game.users.activeGM) throw new S.BaseError("noGM");
    env = await send(op, args);
    // a stale (older-code) GM tab answered first: for the idempotent ops ask again, a newer tab may have the answer ready (createTeam dedupes by rid)
    for (let i = 0; i < 2 && env?.code === "stale" && RETRY.has(op); i++) { await new Promise((res) => setTimeout(res, 900)); env = await send(op, args); }
  }
  if (!env?.ok) throw new S.BaseError(env?.code ?? "relay", env?.params ?? {});
  return env.result;
}
const RETRY = new Set(["createTeam", "reconcile"]);

const modVersion = () => String(game.modules.get(MOD)?.version ?? "");
function send(op, args) {
  if (sock) return sock.executeAsGM("ipbRelay", op, args, PROTO, modVersion()).catch(() => ({ ok: false, code: "relay" }));
  return new Promise((resolve) => {
    const id = `${game.user.id}:${++seq}`;
    let staleTimer = 0;
    const done = (env) => { clearTimeout(timer); clearTimeout(staleTimer); pending.delete(id); resolve(env); };
    const timer = setTimeout(() => done({ ok: false, code: "relay" }), TIMEOUT);
    // a "stale" answer is only final when no better one arrives within a moment (a newer GM tab may answer too)
    pending.set(id, (env) => { if (env?.code === "stale" && !env.ok) { staleTimer ||= setTimeout(() => done(env), 900); } else done(env); });
    game.socket.emit(CHANNEL, { k: "req", id, op, args, userId: game.user.id, proto: PROTO, mod: modVersion() });
  });
}

export function start() {
  if (started) return;
  started = true;
  S.bridge.request = request;
  try {
    if (globalThis.socketlib && game.modules.get("socketlib")?.active && game.modules.get(MOD)?.socket) {
      sock = globalThis.socketlib.registerModule(MOD) ?? null;
      // socketlib fills this.socketdata.userId from the server-side socket, so it is the real sender: trusted. A missing id is NOT trusted.
      sock?.register("ipbRelay", function (op, args, proto, mod) { const uid = this?.socketdata?.userId; return run(op, args, uid, { proto, mod, trusted: !!uid }); });
      return;
    }
  } catch (e) { console.warn(`${MOD} | base relay: socketlib not usable, using the module channel`, e); sock = null; }
  game.socket.on(CHANNEL, async (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === "req") {
      if (!iAmActiveGM()) return;
      const env = await run(msg.op, msg.args, msg.userId, { proto: msg.proto, mod: msg.mod, trusted: false });          // the id in the payload is a claim
      game.socket.emit(CHANNEL, { k: "res", id: msg.id, to: msg.userId, env });
    } else if (msg.k === "res" && msg.to === game.user.id) {
      pending.get(msg.id)?.(msg.env);
    }
  });
}
export const transport = () => (sock ? "socketlib" : "channel");
/** Test helper: run a handler as another user on this (GM) client without any transport. meta.trusted defaults to true (as socketlib would say). */
export const _runAs = (op, args, userId, meta = {}) => run(op, args, userId, { trusted: true, ...meta });
/** Test helper: forget the quota counters / coalesced notices. */
export const _resetLimits = () => { hits.clear(); recentNotices.clear(); };
