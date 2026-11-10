/* Tactical combat (package P1): the public API, game.modules.get("invincible-plus-ultra").api.tactics (spec 18; the P1 part).
   Reads answer from the Combat document through the caller's own view (spec 10). Every write returns an ENVELOPE
   { ok, changed?, rev?, error?: { key, code, params } } and never throws; show errors with api.tactics.errText(error).
   A write is a request to the executor (the active GM's client, relay.mjs); on that client it runs directly.
   The action engine (P2) adds its operations with registerOp() / registerAnswer() and sends them with request(). */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import * as I from "./initiative-pure.mjs";
import * as Sch from "./scheduler-pure.mjs";
import * as Src from "./source.mjs";
import * as Store from "./store.mjs";
import * as Relay from "./relay.mjs";
import * as Sys from "./system-adapter.mjs";
import { t, errText } from "./lang.mjs";

const pick = (combat) => Store.combatOf(combat) ?? Store.currentCombat();
const full = (combat) => Store.stateOf(pick(combat));
const viewer = (combat) => ({ gm: Store.isStaff(game.user), userId: game.user.id, hidden: Sys.hiddenIds(combat) });
/** the state as this user may see it (a fresh copy), or null */
function state(combat) { const c = pick(combat); const s = Store.stateOf(c); return s ? S.viewFor(s, viewer(c)) : null; }
const send = (combat, req) => { const c = pick(combat); return c ? Relay.request(c.id, req) : Promise.resolve(S.err("off")); };
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
    if (p.to.users.includes(game.user.id)) return true;
    return exec && !p.to.users.some((u) => game.users.get(u)?.active);
  });
}

const gmOp = (op, shape = () => ({})) => (...a) => { const last = a[a.length - 1]; const combat = last && typeof last === "object" && last.documentName === "Combat" ? a.pop() : undefined; return send(combat, { op, ...shape(...a) }); };

export const tacticsApi = {
  PROTO: O.PROTO, HOOK: Store.HOOK, HOOK_GM: Store.HOOK_GM,
  /* ---- reads */
  state,
  combat: () => pick(),
  active: (combat) => !!full(combat),
  mode: (combat) => full(combat)?.mode ?? null,
  order: (combat) => O.orderOf(state(combat)),
  isOnTurn: (combatantId, combat) => { const s = state(combat); return !!s && O.isOnTurn(s, combatantId); },
  isWaiting: (combat) => Src.waiting(pick(combat)),
  budget: (combatantId, combat) => O.budgetOf(state(combat), combatantId),
  options: (combatantId, combat) => O.optionsOf(state(combat), combatantId, { resolve: resolveOf(combat, combatantId) }),
  prompts,
  history: (combatantId, scope, tag, combat) => { const L = state(combat)?.ledger?.[combatantId]; return L ? Lg.history(L, scope, tag) : null; },
  triggers: (combat) => state(combat)?.triggers ?? [],
  journal: () => [],                                              // the combat journal is the action engine's (P2)
  subscribe: Store.subscribe,
  t, errText,
  /* ---- a player's (or the GM's) own acts */
  endTurn: (combatantId, combat) => { const s = full(combat); return send(combat, { op: "endTurn", actor: combatantId, round: s?.round, slot: s?.init.cur ?? undefined }); },
  holdOff: (combatantId, slotId, combat) => send(combat, { op: "holdOff", actor: combatantId, with: slotId }),
  answer: (promptId, value, combat) => send(combat, { op: "answer", prompt: promptId, value }),
  mark: (combatantId, unit, on = true, combat) => send(combat, { op: "mark", actor: combatantId, unit, on }),
  /* ---- the GM's desk */
  start: (opts = {}, combat) => send(combat, { op: "start", ...opts }),
  stop: (combat) => send(combat, { op: "stop" }),
  setMode: (mode, combat) => send(combat, { op: "setMode", mode }),
  /** the lines the end-of-scene procedure would apply now (spec 6.8), for the GM's confirmation */
  scenePlan: (combat) => { const c = pick(combat); return c ? Sch.sceneEndPlan(Sys.sceneFacts(c)).map((l) => ({ ...l, name: c.combatants.get(l.id)?.name ?? l.id })) : []; },
  endScene: (opts = {}, combat) => send(combat, { op: "endScene", ...opts }),
  gm: {
    nextTurn: gmOp("nextTurn"), nextRound: gmOp("nextRound"), prevTurn: gmOp("prevTurn"), roster: gmOp("roster"),
    endTurn: gmOp("endTurn", (actor) => ({ actor, force: true })),
    setCard: gmOp("setCard", (slot, card, swap = false) => ({ slot, card, swap })),
    swapCards: gmOp("swapCards", (a, b) => ({ a, b })),
    group: gmOp("group", (members) => ({ members })),
    ungroup: gmOp("ungroup", (member) => ({ member })),
    reorderGroup: gmOp("reorderGroup", (slot, members) => ({ slot, members })),
    insertTurn: gmOp("insertTurn", (combatant, kind = "gm", by) => ({ combatant, kind, by })),
    ledgerEdit: gmOp("ledgerEdit", (combatant, edit, data = {}) => ({ ...data, combatant, edit })),
    triggerAdd: gmOp("triggerAdd", (trigger) => ({ trigger })),
    triggerRemove: gmOp("triggerRemove", (id) => ({ id })),
    setFree: gmOp("setFree", (combatant, on = true) => ({ combatant, on })),
    challengeFail: gmOp("challengeFail", (challenge) => ({ challenge }))
  },
  /* ---- for the other packages */
  request: (req, combat) => send(combat, req),
  registerOp: O.registerOp, registerAnswer: O.registerAnswer, helpers: O.helpers,
  pure: { state: S, ops: O, ledger: Lg, initiative: I, scheduler: Sch, source: Src },
  adapter: Sys,
  _runAs: Relay._runAs
};

export function attach() {
  const mod = game.modules.get(Store.MOD);
  if (!mod) return;
  (mod.api ??= {});
  mod.api.tactics = tacticsApi;
}
