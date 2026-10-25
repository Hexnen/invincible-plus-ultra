/* Team & Base card, phase B3: RELAY. Lets a non-GM ask the active GM client to do what only a GM may: create a team card (a player has no
   JOURNAL_CREATE), re-grant card ownership after linking a hero (reconcile), or "ask the GM" for a purchase. The GM side re-validates
   EVERYTHING against real documents (the sender's actual ownership / role, input clamped); nothing in the payload is trusted.
   Transport follows scripts/turn: socketlib when it is active (module.json has "socket": true), otherwise the module's own channel
   "module.invincible-plus-ultra". LIMIT (Foundry): module sockets carry no authenticated sender, so the sender id inside the payload is
   a claim; the GM handlers therefore only perform operations that are harmless for any claimed user (see handlers). */
import * as P from "./pure.mjs";
import * as S from "./store.mjs";

const MOD = S.MODULE_ID;
const CHANNEL = `module.${MOD}`;
const TIMEOUT = 8000;
let sock = null, started = false, seq = 0;
const pending = new Map();

const iAmActiveGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

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
    const team = await S.createLocal({
      name: P.clampText(String(args.name ?? ""), 80), rank: P.RANKS.includes(args.rank) ? args.rank : undefined, fromActor: from
    }, sender);
    return { id: team.id };
  },
  /** args { teamId }. Idempotent and harmless (computes ownership from real actor ownership), so any known user may ask. */
  async reconcile(_sender, args) {
    const e = game.journal.get(String(args.teamId ?? ""));
    if (!S.isCard(e)) throw new S.BaseError("notFound", { id: String(args.teamId ?? "") });
    return { changed: (await S.reconcileOwnership(e)).changed };
  },
  /** args { teamId, what }. The player asks the GM for something (e.g. buying an upgrade); the GM client gets a notification + a hook. */
  async ask(sender, args) {
    const e = game.journal.get(String(args.teamId ?? ""));
    if (!S.isCard(e)) throw new S.BaseError("notFound", { id: String(args.teamId ?? "") });
    const what = P.clampText(String(args.what ?? ""), 200);
    Hooks.callAll(`${MOD}.baseRequest`, { team: e.id, from: sender.id, what });
    ui.notifications?.info(`${sender.name}: ${what} (${e.name})`);
    return { delivered: true };
  }
};

/** Runs on the GM client. Returns an envelope, never throws. */
async function run(op, args, claimedUserId) {
  try {
    const sender = game.users.get(String(claimedUserId ?? ""));
    if (!sender) throw new S.BaseError("noPermission");
    const h = HANDLERS[op];
    if (!h) throw new S.BaseError("badInput", { op: String(op) });
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
  if (iAmActiveGM()) env = await run(op, args, game.user.id);
  else {
    if (!game.users.activeGM) throw new S.BaseError("noGM");
    env = await send(op, args);
  }
  if (!env?.ok) throw new S.BaseError(env?.code ?? "relay", env?.params ?? {});
  return env.result;
}

function send(op, args) {
  if (sock) return sock.executeAsGM("ipbRelay", op, args).catch(() => ({ ok: false, code: "relay" }));
  return new Promise((resolve) => {
    const id = `${game.user.id}:${++seq}`;
    const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, code: "relay" }); }, TIMEOUT);
    pending.set(id, (env) => { clearTimeout(timer); resolve(env); });
    game.socket.emit(CHANNEL, { k: "req", id, op, args, userId: game.user.id });
  });
}

export function start() {
  if (started) return;
  started = true;
  S.bridge.request = request;
  try {
    if (globalThis.socketlib && game.modules.get("socketlib")?.active && game.modules.get(MOD)?.socket) {
      sock = globalThis.socketlib.registerModule(MOD) ?? null;
      sock?.register("ipbRelay", function (op, args) { return run(op, args, this?.socketdata?.userId); });
      return;
    }
  } catch (e) { console.warn(`${MOD} | base relay: socketlib not usable, using the module channel`, e); sock = null; }
  game.socket.on(CHANNEL, async (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.k === "req") {
      if (!iAmActiveGM()) return;
      const env = await run(msg.op, msg.args, msg.userId);
      game.socket.emit(CHANNEL, { k: "res", id: msg.id, to: msg.userId, env });
    } else if (msg.k === "res" && msg.to === game.user.id) {
      pending.get(msg.id)?.(msg.env);
      pending.delete(msg.id);
    }
  });
}
export const transport = () => (sock ? "socketlib" : "channel");
/** Test helper: run a handler as another user on this (GM) client without any transport. */
export const _runAs = (op, args, userId) => run(op, args, userId);
