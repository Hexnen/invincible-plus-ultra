/* Tactical combat: the public API, game.modules.get("invincible-plus-ultra").api.tactics (spec 18).
   Reads answer from the Combat document through the caller's own view (spec 10: view-pure.viewFor). Every write returns an ENVELOPE
   { ok, changed?, dup?, inst?, prompt?, error?: { key, code, params } } and never throws; show errors with api.tactics.errText(error).
   A write is a request to the executor (the active GM's client, relay.mjs); on that client it runs directly.
   Every function takes the combat as an optional LAST argument (a Combat document or its id; default: the fight on the table), except
   start / stop, where spec 18 puts it first.
   With the world setting `tacticsEnabled` off (or while Year Zero Engine: Combat is the active tracker) the object exists but is idle:
   reads are empty, writes answer `off`. */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as D from "./director-pure.mjs";
import * as E from "./engine-pure.mjs";
import * as R from "./relay-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import * as I from "./initiative-pure.mjs";
import * as Sch from "./scheduler-pure.mjs";
import * as Eco from "./economy-pure.mjs";
import * as Desk from "./desk-pure.mjs";
import * as Src from "./source.mjs";
import * as Store from "./store.mjs";
import * as Mv from "./movement.mjs";
import * as Relay from "./relay.mjs";
import * as Engine from "./engine.mjs";
import * as Sys from "./system-adapter.mjs";
import * as Trace from "./trace-pure.mjs";
import * as Zones from "./zones-adapter.mjs";
import { t, errText } from "./lang.mjs";

let running = false;
/** main.mjs: tactical combat runs on this client (the setting is on, the own initiative is in charge) */
export const setRunning = (on) => { running = !!on; };
export const isRunning = () => running;
const enabled = () => Store.setting("tacticsEnabled", false) === true;

const isCombat = (x) => !!x && typeof x === "object" && x.documentName === "Combat";
const pick = (combat) => Store.combatOf(combat) ?? Store.currentCombat();
const full = (combat) => (running ? Store.stateOf(pick(combat)) : null);
/** the state as this user may see it (a fresh copy for a player; the whole state for staff), or null */
const state = (combat) => { const c = pick(combat); return running && c && Store.stateOf(c) ? Engine.view(game.user, c) : null; };
const send = (combat, req) => { const c = pick(combat); return running && c ? Relay.request(c.id, req) : Promise.resolve(R.bad("off")); };
const resolveOf = (combat, id) => { try { return Sys.participant(pick(combat).combatants.get(id)).resolve; } catch { return undefined; } };

/** the open prompts this user is asked to answer: addressed to the user, or to the GM desk when the user is the executor; the executor
    also gets a player's prompt when none of its addressees is connected */
function prompts(combat) {
  const s = state(combat);
  if (!s) return [];
  const exec = Store.iAmExecutor();
  return Object.values(s.prompts).filter((p) => {
    if (p.answered) return false;
    if (p.to === "gm") return exec;
    if (p.to?.users?.includes(game.user.id)) return true;
    return exec && !(p.to?.users ?? []).some((u) => game.users.get(u)?.active);
  });
}
/* everything the player surface / the GM desk draws (desk-pure.mjs); the ready requests in them go to request() */
const player = (combat) => { const c = pick(combat); return Desk.playerModel(state(c), Engine.viewer(game.user, c), { ...Engine.context(c), P1: Eco }); };
const desk = (combat) => { const c = pick(combat); if (!running || !c || !Store.isStaff(game.user)) return null; const r = Store.read(c); return Desk.deskModel(r.state, r.log, Engine.context(c)); };

/* the trailing combat: a Combat document, undefined, or (after at least one other argument) a string that is the id of a world Combat */
const isCombatId = (x) => typeof x === "string" && !!game.combats?.get?.(x);
const popCombat = (a) => (a.length && (isCombat(a[a.length - 1]) || a[a.length - 1] === undefined || (a.length > 1 && isCombatId(a[a.length - 1]))) ? a.pop() : undefined);
const act = (op, shape) => (...a) => { const combat = popCombat(a); return send(combat, { op, ...shape(...a) }); };
/* gm.<op>(payload, combat?) for every GM operation (spec 18). The round driver's operations also take their plain arguments
   (gm.setCard(slot, card), gm.challengeFail(challengeId) ...), as the module's widgets call them. */
const POSITIONAL = {
  endTurn: (actor) => ({ actor, force: true }),
  setCard: (slot, card, swap = false) => ({ slot, card, swap }), swapCards: (a, b) => ({ a, b }),
  group: (members) => ({ members }), ungroup: (member) => ({ member }), reorderGroup: (slot, members) => ({ slot, members }),
  insertTurn: (combatant, kind = "gm", by) => ({ combatant, kind, by }),
  ledgerEdit: (combatant, edit, data = {}) => ({ ...data, combatant, edit }),
  triggerAdd: (trigger) => ({ trigger }), triggerRemove: (id) => ({ id }),
  setFree: (combatant, on = true) => ({ combatant, on }), setMode: (mode) => ({ mode }),
  challengeFail: (challenge) => ({ challenge }),
};
const isPayload = (op, x) => !!x && typeof x === "object" && !Array.isArray(x) && !isCombat(x) && (op !== "triggerAdd" || "trigger" in x);
const gmOp = (op) => (...a) => {
  const combat = popCombat(a);
  const body = a.length === 0 ? {} : a.length === 1 && isPayload(op, a[0]) ? a[0] : POSITIONAL[op] ? POSITIONAL[op](...a) : {};
  return send(combat, { ...body, ...(op === "endTurn" ? { force: true } : {}), op });
};
const gm = Object.fromEntries([...new Set([...D.GM_OPS, "endTurn"])].map((op) => [op, gmOp(op)]));

export const tacticsApi = {
  PROTO: R.PROTO, HOOK: Store.HOOK, HOOK_GM: Store.HOOK_GM,
  enabled, running: isRunning,
  /* ---- reads (any client, through the caller's view) */
  state,
  combat: () => (running ? pick() : null),
  active: (combat) => !!full(combat),
  mode: (combat) => full(combat)?.mode ?? null,
  viewer: (combat) => Engine.viewer(game.user, pick(combat)),
  order: (combat) => O.orderOf(state(combat)),
  isOnTurn: (combatantId, combat) => { const s = state(combat); return !!s && O.isOnTurn(s, combatantId); },
  isWaiting: (combat) => running && Src.waiting(pick(combat)),
  budget: (combatantId, combat) => O.budgetOf(state(combat), combatantId),
  options: (combatantId, combat) => O.optionsOf(state(combat), combatantId, { resolve: resolveOf(combat, combatantId) }),
  prompts, player, desk,
  history: (combatantId, scope, tag, combat) => { const L = state(combat)?.ledger?.[combatantId]; return L ? Lg.history(L, scope, tag) : null; },
  triggers: (combat) => state(combat)?.triggers ?? [],
  journal: (combat) => (running ? Engine.journal(game.user, pick(combat)) : []),
  subscribe: Store.subscribe,
  t, text: t, errText, errorText: errText,
  /* ---- a player's (or the GM's) own acts (spec 12.2) */
  request: (req, combat) => send(combat, req),
  declare: act("declare", (actor, decl) => ({ actor, decl })),
  amend: act("amend", (inst, decl) => ({ inst, decl })),
  cancel: act("cancel", (inst) => ({ inst })),
  answer: act("answer", (prompt, value) => ({ prompt, value })),
  help: act("help", (inst, helper) => ({ inst, helper })),
  askException: act("exception", (actor, text, inst) => ({ actor, text, inst })),
  other: act("other", (actor, text) => ({ actor, text })),
  endTurn: (combatantId, combat) => { const s = full(combat); return send(combat, { op: "endTurn", actor: combatantId, round: s?.round, slot: s?.init.cur ?? undefined }); },
  holdOff: (combatantId, slotId, combat) => send(combat, { op: "holdOff", actor: combatantId, with: slotId }),
  mark: (combatantId, unit, on = true, combat) => send(combat, { op: "mark", actor: combatantId, unit, on }),
  /* ---- the GM's desk */
  start: (combat, opts = {}) => send(combat, { op: "start", ...(opts && typeof opts === "object" ? opts : {}) }),
  stop: (combat) => send(combat, { op: "stop" }),
  setMode: (mode, combat) => send(combat, { op: "setMode", mode }),
  /** the lines the end-of-scene procedure would apply now (spec 6.8), for the GM's confirmation */
  scenePlan: (combat) => { const c = pick(combat); return running && c && Store.isStaff(game.user) ? Sch.sceneEndPlan(Sys.sceneFacts(c), Store.stateOf(c)).map((l) => ({ ...l, name: c.combatants.get(l.id)?.name ?? l.id })) : []; },
  endScene: (...a) => { const combat = popCombat(a), opts = a[0]; return send(combat, { ...(opts && typeof opts === "object" && !isCombat(opts) ? opts : {}), op: "endScene" }); },
  gm,
  /* ---- the surroundings */
  compat: () => Sys.compat(),
  dropped: () => Trace.recent(),      // D125: what a combatant's facts could not carry on this client (trace-pure.mjs)
  zonesAvailable: () => Zones.available(),
  movement: Mv.api,                                    // P3: options(cid, to?), pick(cid), move(cid, to, opts), canTalk(a, b)
  zones: Zones,
  pure: { state: S, ops: O, director: D, engine: E, relay: R, ledger: Lg, initiative: I, scheduler: Sch, economy: Eco, desk: Desk, source: Src },
  adapter: Sys,
  /** Test helper (executor only): run a request exactly as if `userId` had sent it through the relay. _runAs(userId, req, combat?) */
  _runAs: (userId, req, combat) => { const c = pick(combat); return running && c ? Relay._runAs(userId, c.id, req) : Promise.resolve(R.bad("off")); },
};

export function attach() {
  const mod = game.modules.get(Store.MOD);
  if (!mod) return;
  (mod.api ??= {});
  mod.api.tactics = tacticsApi;
}
