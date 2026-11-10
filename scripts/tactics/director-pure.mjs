/* Tactical combat: THE DIRECTOR, the one pure entry of the executor. NO Foundry globals (node-tested by check-fight.mjs and by every
   engine check, which all run through it).
   Two machines work on the ONE state of a fight (state-pure.mjs):
     ops-pure.mjs     the round driver: draw, turn order, ledger lifecycle, scheduler points, end of scene   (sync reducer)
     engine-pure.mjs  the action engine: declarations, the stack, prompts, rolls, effects, the journal with undo   (async, through `host`)
   handle({ state, log }, input, host) -> { state, log, env, events, changed }      the contract of engine-pure.handle, for every input
     input  { t:"req", user:{ id, staff }, rid, req:{ op, ... } } | { t:"roll", ... } | { t:"tick" }
     host   the engine's host plus what the round driver reads live:
            { facts(), perform(effect), now(), setting(key), parts() -> [Participant], rng() -> 0..1, sceneFacts() -> [...] }
   What it decides [D]:
   - which machine owns a request: ROUND_OPS and the answers to the round driver's own prompt kinds (ops-pure.P1_PROMPTS) go to the reducer,
     everything else to the engine. The GM edits that both packages had (ledgerEdit, triggerAdd, triggerRemove, setMode, setFree) run in the
     engine, because there each edit is one journaled, undoable transaction (spec 14.2);
   - what the reducer asks of the executor (its `effects`: voluntary stress, recovery, due triggers, aborts) is handed to the engine in the
     same call (input "sys"), so a due trigger becomes its own action instance (spec 6.1) and a recovery is one undoable transaction;
   - spec 4.4: a turn does not end under an open action. `endTurn` answers `busy` while the stack is not empty (tactical mode, the actor
     not marked free; the GM's forced end of turn passes). The GM's steps that move the round (BLOCKED_BY_ACTION) answer `busy` too unless
     sent with force:true;
   - a blocking trigger queue (round start, round end) holds the round (`state.sched.hold`) until the instances it started are off the
     stack; then the director sends the reducer `resume` by itself;
   - events of both machines get one sequence (`state.evSeq`), the acting user and the time. */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as E from "./engine-pure.mjs";
import * as J from "./journal-pure.mjs";

export const ROUND_OPS = Object.freeze(["start", "stop", "endTurn", "nextTurn", "nextRound", "prevTurn", "holdOff", "mark", "setCard", "swapCards", "group", "ungroup",
  "reorderGroup", "insertTurn", "roster", "endScene", "challengeFail"]);
export const ROUND_PLAYER_OPS = Object.freeze(["endTurn", "holdOff", "mark"]);          // spec 12.2 (mark: the manual action mark of the tray)
export const PLAYER_OPS = Object.freeze([...new Set([...E.PLAYER_OPS, ...ROUND_PLAYER_OPS])]);
export const GM_OPS = Object.freeze([...E.GM_OPS, ...ROUND_OPS.filter((op) => !ROUND_PLAYER_OPS.includes(op))]);
export const BLOCKED_BY_ACTION = Object.freeze(["nextTurn", "nextRound", "prevTurn", "holdOff", "endScene", "insertTurn"]);

const bad = S.err;
const out = (state, log, env, events = []) => ({ state, log, env, events, changed: false });
const isRound = (state, req) => ROUND_OPS.includes(req?.op)
  || ((req?.op === "answer" || req?.op === "answerFor") && O.P1_PROMPTS.has(state?.prompts?.[req.prompt]?.kind));

function ctxFor(host, user, state = null) {
  const facts = host.facts(), all = host.parts?.() ?? [];
  const parts = state?.kind === "chase" ? all.map((p) => ({ ...p, noCard: 1 })) : all;      // P7 [B3412]: nobody holds a card while a chase runs; the round still turns
  return { user: user.id, staff: !!user.staff, owns: (cid) => !!facts.c(cid)?.owners?.includes(user.id), parts, rng: host.rng,
    playersEnd: host.setting?.("turnPlayersEnd") !== false, sceneFacts: host.sceneFacts?.() ?? [], hold: true };
}
/* one sequence, the acting user and the time on the round driver's events (the engine stamps its own the same way) */
function stamp(state, events, user, host) {
  let seq = state.evSeq ?? 0;
  const list = (events ?? []).map((e) => ({ ...e, seq: ++seq, round: e.round ?? state.round, by: user.id, at: host.now() }));
  return { state: list.length ? { ...state, evSeq: seq } : state, events: list };
}
/** One reducer action, then what it asks of the executor through the engine. -> { ok, env, state, log, events } */
async function round(state, log, action, user, host) {
  const r = O.reduce(state, action, ctxFor(host, user, state));
  if (!r.ok) return { ok: false, env: r };
  if (!r.changed) return { ok: true, same: true, env: { ok: true, changed: false, ...(r.dup ? { dup: true } : {}) } };
  if (r.state === null) return { ok: true, env: { ok: true, changed: true, rev: null }, state: null, log: J.emptyLog(), events: (r.events ?? []).map((e, i) => ({ ...e, seq: (state?.evSeq ?? 0) + i + 1, by: user.id, at: host.now() })) };
  const st = stamp(r.state, r.events, user, host);
  let s = st.state, l = action.type === "start" ? J.emptyLog() : log;
  const events = st.events, env = { ok: true, changed: true, rev: s.rev };
  const fx = r.effects ?? [];                                                           // P7: roundEnd runs the challenge clocks in the engine, journaled [R22]
  if (fx.length) {
    const e = await E.handle({ state: s, log: l }, { t: "sys", effects: fx }, host);
    s = e.state; l = e.log; events.push(...e.events);
    if (!e.env.ok) env.partial = e.env.error;
  }
  return { ok: true, env, state: s, log: l, events };
}
/* P7: the cards follow the kind of the scene. A chase holds no cards (also after an undo that brought a chase back); a fight that
   has none while people stand in it (a chase just ended, or its start was undone) gets them dealt by the round driver [A-1]. */
async function cards(state, log, events, host) {
  if (!state || state.stack.length || state.phase !== "turns") return { state, log };
  if (state.kind === "chase") return state.init.slots.length ? { state: { ...state, init: { ...S.newInit(), deck: state.init.deck } }, log } : { state, log };
  if (state.init.slots.length || !(state.round >= 1)) return { state, log };
  const r = await round(state, log, { type: "roster" }, { id: "engine", staff: true }, host);
  if (!r.ok || r.same) return { state, log };
  events.push(...r.events);
  return { state: r.state, log: r.log };
}
/* the round waits for the trigger instances of a blocking queue: when the stack is empty again it goes on */
async function settle(state, log, events, host) {
  const c = await cards(state, log, events, host);
  let s = c.state, l = c.log;
  for (let guard = 0; guard < 6 && s?.sched?.hold && !s.stack.length; guard++) {
    const r = await round(s, l, { type: "resume" }, { id: "engine", staff: true }, host);
    if (!r.ok || r.same) break;
    s = r.state; l = r.log; events.push(...r.events);
  }
  return { state: s, log: l };
}

export async function handle({ state, log }, input, host) {
  const lg = log ?? J.emptyLog();
  try {
    if (input?.t !== "req" || !isRound(state, input.req)) {
      if (!state) return out(state, lg, bad("off"));
      let st0 = state, lg0 = lg;
      const pre = [];
      if (input?.t === "req" && input.req?.op === "chaseRound" && input.user?.staff && state.kind === "chase" && state.chase?.rolled === state.round && !state.stack.length && state.phase === "turns") {
        const nr = await round(state, lg, { type: "nextRound", force: true }, input.user, host);     // P7 [B3432]: one chase roll a round; the next one opens the next round
        if (nr.ok && !nr.same && nr.state) { st0 = nr.state; lg0 = nr.log; pre.push(...nr.events); }
      }
      const e0 = await E.handle({ state: st0, log: lg0 }, input, host);
      const e = pre.length ? { ...e0, events: [...pre, ...e0.events], changed: true, state: e0.changed ? e0.state : st0, log: e0.changed ? e0.log : lg0 } : e0;
      if (!e.changed) return e;
      const done = await settle(e.state, e.log, e.events, host);
      return { ...e, state: done.state, log: done.log };
    }
    const user = input.user, req = input.req, op = req.op;
    if (!user || !S.isId(user.id)) return out(state, lg, bad("untrusted"));
    if (state && input.rid && S.hasSeen(state, input.rid)) return out(state, lg, { ok: true, changed: false, dup: true });
    const n = O.normalize(op === "answerFor" ? { ...req, op: "answer" } : req, { staff: !!user.staff });
    if (!n.ok) return out(state, lg, n);
    const action = { ...n.action, rid: input.rid };
    if (state && state.stack.length && state.mode === "tactical" && !(user.staff && action.force === true)) {       // spec 4.4
      const refused = (op === "endTurn" && !state.free?.[action.actor]) || BLOCKED_BY_ACTION.includes(op);
      if (refused) { const probe = O.reduce(state, { ...action, rid: undefined }, ctxFor(host, user, state)); return out(state, lg, probe.ok ? bad("busy", { reason: "openAction" }) : probe); }
    }
    const r = await round(state, lg, action, user, host);
    if (!r.ok || r.same) return out(state, lg, r.env);
    if (r.state === null) return { state: null, log: r.log, env: r.env, events: r.events, changed: true };
    const done = await settle(r.state, r.log, r.events, host);
    return { state: done.state, log: done.log, env: { ...r.env, rev: done.state.rev }, events: r.events, changed: true };
  } catch (e) {
    return out(state, lg, bad("internal", { msg: String(e?.message ?? e).slice(0, 120) }));
  }
}
/** Whitelist a request for the machine that owns it (the relay and the executor call this once). -> { ok, req } | { ok:false, code } */
export const owner = (op) => (ROUND_OPS.includes(op) ? "round" : PLAYER_OPS.includes(op) || GM_OPS.includes(op) ? "engine" : null);
