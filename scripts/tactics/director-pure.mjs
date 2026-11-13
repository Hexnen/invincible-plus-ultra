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
import * as Hz from "./flows/hazards.mjs";
import { sitsOut } from "./flows/kit.mjs";
import * as MP from "./movement-pure.mjs";
import * as M from "./mods-pure.mjs";
import { concealedFor } from "./view-pure.mjs";

export const ROUND_OPS = Object.freeze(["start", "stop", "endTurn", "nextTurn", "nextRound", "prevTurn", "holdOff", "mark", "setCard", "swapCards", "group", "ungroup",
  "reorderGroup", "insertTurn", "roster", "endScene", "challengeFail"]);
export const ROUND_PLAYER_OPS = Object.freeze(["endTurn", "holdOff", "mark"]);          // spec 12.2 (mark: the manual action mark of the tray)
export const PLAYER_OPS = Object.freeze([...new Set([...E.PLAYER_OPS, ...ROUND_PLAYER_OPS])]);
export const GM_OPS = Object.freeze([...E.GM_OPS, ...ROUND_OPS.filter((op) => !ROUND_PLAYER_OPS.includes(op))]);
export const BLOCKED_BY_ACTION = Object.freeze(["nextTurn", "nextRound", "prevTurn", "holdOff", "endScene", "insertTurn"]);
/* FXK2 (D210): the refusals this file answers with a code of its own (beside the engine's ERROR_CODES); the relay lets each of them through */
export const DIRECTOR_CODES = Object.freeze(["mustGlide"]);

const bad = S.err;
const out = (state, log, env, events = []) => ({ state, log, env, events, changed: false });
const isRound = (state, req) => ROUND_OPS.includes(req?.op)
  || ((req?.op === "answer" || req?.op === "answerFor") && O.P1_PROMPTS.has(state?.prompts?.[req.prompt]?.kind));

function ctxFor(host, user, state = null) {
  const facts = host.facts(), all = host.parts?.() ?? [];
  const parts = state?.kind === "chase" ? all.map((p) => ({ ...p, noCard: 1 })) : all;      // P7 [B3412]: nobody holds a card while a chase runs; the round still turns
  return { user: user.id, staff: !!user.staff, owns: (cid) => !!facts.c(cid)?.owners?.includes(user.id), parts, rng: host.rng,
    playersEnd: host.setting?.("turnPlayersEnd") !== false, sceneFacts: host.sceneFacts?.() ?? [], hold: true,
    idle: (cid, s) => sitsOut(s, cid, facts.c(cid)),                                          // U9: a turn on which nothing can be done passes by itself (ops-pure.openTurn)
    derived: (point, s) => Hz.derived(s, facts, point) };                                   // P5: what burning zones, burning characters and the vacuum make due (spec 6.1)
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
    /* D90 / D99: the round driver's step is done; what the engine could not carry out of what it handed over is said in the answer */
    if (!e.env.ok || e.env.partial || e.env.failed?.length) { env.partial = true; if (e.env.failed?.length) env.failed = e.env.failed; }
    if (e.env.parked) env.parked = e.env.parked;
  }
  return { ok: true, env, state: s, log: l, events };
}
/* P7: the cards follow the kind of the scene. A chase holds no cards (also after an undo that brought a chase back); a fight that
   has none while people stand in it (a chase just ended, or its start was undone) gets them dealt by the round driver [A-1]. */
const summonSig = (list, parts) => (parts ? O.ownParts(parts).filter((p) => p.summonOf && !p.defeated && parts.some((o) => o.id === p.summonOf)).map((p) => `${p.summonOf}>${p.id}`)
  : (list ?? []).flatMap((su) => (su.combatants ?? []).map((id) => `${su.owner}>${id}`))).sort().join(",");
function leaving(state, host) {
  const parts = (host.parts?.() ?? []).filter((p) => p.summonOf);
  if (!parts.length) return [];
  const f = host.facts();
  return parts.filter((p) => { const c = f.c(p.id), o = f.c(p.summonOf); return c?.summon?.auto && (state.phase === "sceneEnd" || !o || o.present === false || !(o.health > 0) || !(c.health > 0)); }).map((p) => p.id);
}
/* H2-4 (D106): the turn the deal after a chase opened is taken back. Has every transaction written since that deal been undone (an undo in
   LIFO order of the chase's end takes all of them)? Then whatever its turn-start card ran is gone too, and the moment must come again.
   A transaction still standing (a forced single undo of the end) keeps the old rule: an answered card has happened. */
function undoneSince(state, log) {
  const m = state?.init?.curMember, at = m ? state.moved?.[m]?.logAt : undefined;
  if (typeof at !== "string") return false;
  const list = log?.list ?? [], i = at ? list.findIndex((t) => t.id === at) : -1;
  if (at && i < 0) return false;                                                         // the journal no longer reaches back to the deal: not known, the old rule
  return list.slice(i + 1).every((t) => t.state === "undone");
}
/* `box` = { state, log }: kept up to date after every stage, so a stage that fails leaves what the stages before it did (D90) */
async function cards(box, events, host, sweep = true) {
  if (!box.state) return;
  const gone = box.state.stack.length || !sweep ? [] : leaving(box.state, host);                              // P6 [B1812]: summoned allies leave by themselves
  if (gone.length) { const e = await E.handle({ state: box.state, log: box.log }, { t: "sys", effects: [{ type: "summonLeave", combatants: gone }] }, host); if (e.changed) { box.state = e.state; box.log = e.log; events.push(...e.events); } if (e.env?.failed?.length) (box.failed ??= []).push(...e.env.failed); }
  if (summonSig(box.state.summons) !== summonSig(null, host.parts?.() ?? [])) {                 // P6 [I14]: a summoned group came, left or changed hands: the round driver follows at once
    const r = await round(box.state, box.log, { type: "roster" }, { id: "engine", staff: true }, host);
    if (r.ok && !r.same) { events.push(...r.events); box.state = r.state; box.log = r.log; }
  }
  const state = box.state;
  if (state.stack.length || state.phase !== "turns") return;
  if (state.kind === "chase") {
    if (!state.init.slots.length) return;
    const r = await round(state, box.log, { type: "undeal", undone: undoneSince(state, box.log) }, { id: "engine", staff: true }, host);      // D106: the turn the dealt cards opened goes with them
    if (r.ok && !r.same && r.state) { events.push(...r.events); box.state = r.state; box.log = r.log; }
    else box.state = { ...state, init: { ...S.newInit(), deck: state.init.deck } };
    return;
  }
  if (state.init.slots.length || !(state.round >= 1)) return;
  const r = await round(state, box.log, { type: "roster", deal: true, logAt: box.log?.list?.at(-1)?.id ?? "" }, { id: "engine", staff: true }, host);      // D43 [B3436]: the fight after a chase draws initiative (H2-4: where the journal stood)
  if (!r.ok || r.same) return;
  events.push(...r.events);
  box.state = r.state; box.log = r.log;
}
/* the round waits for the trigger instances of a blocking queue: when the stack is empty again it goes on.
   D90 (spec 12): this runs AFTER the request was carried out (documents written, the state changed). A failure in here must not
   throw that away: the answer would say "failed, nothing changed" about a request whose effects are on the sheets. What was reached
   is kept and the answer says `partial`. -> { state, log, failed?: true | [..] } */
async function settle(state, log, events, host, sweep = true) {
  const box = { state, log };
  try {
    await cards(box, events, host, sweep);
    for (let guard = 0; guard < 6 && box.state?.sched?.hold && !box.state.stack.length; guard++) {
      const r = await round(box.state, box.log, { type: "resume" }, { id: "engine", staff: true }, host);
      if (!r.ok || r.same) break;
      box.state = r.state; box.log = r.log; events.push(...r.events);
      if (r.env?.partial) (box.failed ??= []).push(...(r.env.failed ?? [{ t: "sys", what: "resume" }]));
    }
  } catch (e) {
    try { host.warn?.("settle", e, {}); } catch { /* a courtesy */ }
    (box.failed ??= []).push({ t: "sys", what: "settle" });
  }
  return box;
}
const withFailed = (env, done) => (done.failed?.length ? { ...env, partial: true, failed: [...(env.failed ?? []), ...done.failed].slice(0, E.FAILED_MAX) } : env);

/* Spec 10: a combatant the GM keeps hidden does not exist for a player. A player's request that names one (as the actor, a target, a
   helper, somebody carried) is handled exactly as the same request naming nobody: the name is swapped for an id no combatant has before
   anything looks at it, and put back in what the refusal echoes. One place, for the round driver and the action engine alike. */
const NAMES_ONE = ["actor", "helper", "combatant"], NAMES_MANY = ["targets", "carry", "fullAuto"];
/* D30: an initiative slot is named by its id (`holdOff.with`), and the ids are easy to guess. A slot the player's view does not hold (every
   member concealed from that player: hidden by the GM, or unseen by all of the player's own combatants, view-pure.concealedFor) is handled
   as a slot that is not there. A slot shared with somebody the player sees stays (the view shows it too). */
function ghostSlot(state, slotId, user, host, f) {
  const slot = (state?.init?.slots ?? []).find((s) => s.id === slotId);
  if (!slot || !slot.members?.length) return false;
  const ids = (host.parts?.() ?? []).map((p) => p.id), mine = (id) => !!f.c?.(id)?.owners?.includes(user.id);
  const concealed = concealedFor(state, { id: user.id, staff: false, owns: ids.filter(mine) }, { hidden: [...new Set([...ids, ...slot.members])].filter((id) => f.c?.(id)?.hidden === true) });
  return slot.members.every((m) => concealed.has(m));
}
function veil(input, host, state = null) {
  if (input?.t !== "req" || !input.user || input.user.staff || !input.req || typeof input.req !== "object") return null;
  let f; try { f = host.facts(); } catch { return null; }
  const ghost = (id) => { if (typeof id !== "string") return false; const c = f.c?.(id); return !!c && c.hidden === true && !(c.owners ?? []).includes(input.user.id); };
  let nobody = "nobody"; for (let i = 0; f.c?.(nobody); i++) nobody = `nobody${i}`;
  const swapped = new Set();
  const swap = (id) => (ghost(id) ? (swapped.add(id), nobody) : id);
  let noSlot = null;
  try { if (typeof input.req.with === "string" && ghostSlot(state, input.req.with, input.user, host, f)) { noSlot = "noSlot"; for (let i = 0; (state.init.slots ?? []).some((s) => s.id === noSlot); i++) noSlot = `noSlot${i}`; } } catch { noSlot = null; }
  const walk = (o, depth = 0) => {
    if (Array.isArray(o)) return depth > 6 ? o : o.map((x) => walk(x, depth + 1));
    if (!o || typeof o !== "object" || depth > 6) return o;
    const out = {};
    for (const [k, x] of Object.entries(o)) out[k] = NAMES_ONE.includes(k) ? swap(x) : NAMES_MANY.includes(k) && Array.isArray(x) ? x.map(swap) : k === "text" || k === "value" ? x : walk(x, depth + 1);
    return out;
  };
  let req = walk(input.req);
  if (noSlot) req = { ...req, with: noSlot };
  if (!swapped.size) return noSlot ? { req, back: (o) => o } : null;
  const only = swapped.size === 1 ? [...swapped][0] : null;
  const back = (o, depth = 0) => (o === nobody && only ? only : Array.isArray(o) ? o.map((x) => back(x, depth + 1)) : o && typeof o === "object" && depth < 6 ? Object.fromEntries(Object.entries(o).map(([k, x]) => [k, back(x, depth + 1)])) : o);
  return { req, back };
}
/* U121: somebody joined or left while an action stands open (a group dropped onto the map in the middle of an attack): the action on top is
   driven once, so a card that names who is in reach (the stunts' extra opponent) is made again with what is true now */
async function rosterTick(state, lg, r, host) {
  let base = { state, log: lg, events: [], env: { ok: true, changed: false } };
  if (!r.same) { const done = await settle(r.state, r.log, r.events, host); base = { state: done.state, log: done.log, events: r.events, env: withFailed({ ...r.env, rev: done.state.rev }, done) }; }
  const e = await E.handle({ state: base.state, log: base.log }, { t: "tick" }, host);
  const said = { ...(e.env?.partial ? { partial: true } : {}), ...(e.env?.failed?.length ? { failed: [...(base.env.failed ?? []), ...e.env.failed].slice(0, E.FAILED_MAX) } : {}), ...(e.env?.parked ? { parked: e.env.parked } : {}) };      // D90: what the drive could not do is said
  if (!e.changed) return r.same && !Object.keys(said).length ? out(state, lg, r.env) : { ...base, env: { ...base.env, ...said }, changed: !r.same };
  return { state: e.state, log: e.log, env: { ...base.env, ok: true, changed: true, rev: e.state?.rev ?? base.env.rev, ...said }, events: [...base.events, ...(e.events ?? [])], changed: true };
}
/* FXV (CHASE2-12): the second chase roll of a round first opens the next round (above); that step of the round driver had no journal
   entry of its own, so undoing the roll left the fight a round on (a test world ended in round 4 for 2). The change of the fight's
   state that the step made (round, order, ledger, phase ...) is put at the head of the roll's own transaction, and the undo of the
   roll puts it back. Not reverted: what the end of that round did to sheets (the challenges' clocks) has its own journal entries. */
const ROUND_SKIP = new Set(["rev", "seen", "seq", "evSeq", "txOpen"]);
function roundIntoTx(before, after, lg0, e0) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !ROUND_SKIP.has(k));
  const patch = keys.flatMap((k) => J.diffWrites(before[k], after[k], [k]));
  if (!patch.length) return {};
  const op = { t: "state", patch, inverse: patch.map(([p]) => [p, J.clone(J.getAt(before, p))]) };
  const inst = e0.env?.inst, old = new Set((lg0?.list ?? []).map((t) => t.id)), open0 = new Set(Object.keys(after.txOpen ?? {}));
  const open = Object.values(e0.state?.txOpen ?? {}).filter((t) => !open0.has(t.id)), closed = (e0.log?.list ?? []).filter((t) => !old.has(t.id));
  const pick = (l) => l.find((t) => t.inst === inst) ?? l[0];
  const o = pick(open);
  if (o) return { state: { ...e0.state, txOpen: { ...e0.state.txOpen, [o.id]: { ...o, ops: [op, ...o.ops] } } } };
  const c = pick(closed);
  if (c) return { log: { ...e0.log, list: e0.log.list.map((t) => (t.id === c.id ? { ...t, ops: [op, ...t.ops] } : t)) } };
  return {};
}
export async function handle(io, input, host) {
  const v = veil(input, host, io?.state ?? null);
  if (!v) return handle0(io, input, host);
  const r = await handle0(io, { ...input, req: v.req }, host);
  return r?.env?.error ? { ...r, env: { ...r.env, error: v.back(r.env.error) } } : r;
}
async function handle0({ state, log }, input, host) {
  const lg = log ?? J.emptyLog();
  try {
    if (input?.t !== "req" || !isRound(state, input.req)) {
      if (!state) return out(state, lg, bad("off"));
      let st0 = state, lg0 = lg;
      const pre = [];
      if (input?.t === "req" && input.req?.op === "chaseRound" && input.user?.staff && state.kind === "chase" && state.chase?.rolled === state.round && !state.stack.length && state.phase === "turns") {
        /* D101 (spec 14: a refusal changes nothing): the roll is judged BEFORE the next round is opened; opening it runs the clocks of the
           challenges on the sheets and opens the round's cards, which a refusal afterwards could not take back */
        const probe = E.chaseRoundProbe(state, host);
        if (!probe.ok) return out(state, lg, probe);
        const nr = await round(state, lg, { type: "nextRound", force: true }, input.user, host);     // P7 [B3432]: one chase roll a round; the next one opens the next round
        if (nr.ok && !nr.same && nr.state) { st0 = nr.state; lg0 = nr.log; pre.push(...nr.events); }
      }
      let e0 = await E.handle({ state: st0, log: lg0 }, input, host);
      if (st0 !== state && e0.changed && e0.env?.ok) e0 = { ...e0, ...roundIntoTx(state, st0, lg0, e0) };      // FXV (CHASE2-12): an undo of the roll takes the round it opened back too
      const e = pre.length ? { ...e0, events: [...pre, ...e0.events], changed: true, state: e0.changed ? e0.state : st0, log: e0.changed ? e0.log : lg0 } : e0;
      if (!e.changed) return e;
      const done = await settle(e.state, e.log, e.events, host, input?.req?.op !== "undo");      // an undone leave stands until the next request: the GM puts right what made the allies go
      return { ...e, env: withFailed(e.env, done), state: done.state, log: done.log };
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
    if (op === "endTurn" && state && !(user.staff && action.force === true) && glideStall(state, host, action.actor)) return out(state, lg, bad("mustGlide", { gmMayAllow: 1 }));      // PWE (PW094) [B2004]
    const r = await round(state, lg, action, user, host);
    if (op === "roster" && r.ok && r.state && state?.stack?.length) return rosterTick(state, lg, r, host);
    if (!r.ok || r.same) return out(state, lg, r.env);
    if (r.state === null) return { state: null, log: r.log, env: r.env, events: r.events, changed: true };
    const done = await settle(r.state, r.log, r.events, host);
    return { state: done.state, log: done.log, env: withFailed({ ...r.env, rev: done.state.rev }, done), events: r.events, changed: true };
  } catch (e) {
    return out(state, lg, bad("internal", { msg: String(e?.message ?? e).slice(0, 120) }));
  }
}
/** PWE (PW094) [B2004] Gliding: no hovering; at least one quick action a turn goes to moving until the glider lands. A
    glider who is in the air (the map says so) and has not moved this turn (a move, or a move within the zone such as landing) may not end
    the turn; the GM may (op endTurn with force, or nextTurn). Without a map nobody can tell: no check. */
export function glideStall(state, host, cid) {
  let f; try { f = host.facts(); } catch { return false; }
  const c = f?.c?.(cid);
  if (!c || !(c.movement ?? []).some((m) => m?.mode === "flight" && (m.limits ?? []).includes("gliding"))) return false;
  const p = f.zones?.place?.(cid);
  if (!p || p.airborne !== true) return false;
  /* FXC2 (D201): only while a move is still possible. One who cannot move at all (held, snared, Immobilize Only, trapped: movement-pure
     cannotMove; a no-movement weapon fired this round [B2545]; aboard a vehicle) is not kept from ending the turn. With the units spent
     the landing in place stays (an in-zone move is free [B2383]), so that one is still asked to glide. */
  if (MP.cannotMove(state, cid, c) || M.counterGet(state, M.counterKey.round(cid, "firedNoMove")) > 0 || M.statusesOf(state, cid).some((s) => s.id === "inVehicle")) return false;
  const h = state.ledger?.[cid]?.history?.thisTurn;
  return !(Number(h?.moved) > 0 || (h?.tags ?? []).includes("moveInZone") || (h?.tags ?? []).includes("move"));
}
/** Whitelist a request for the machine that owns it (the relay and the executor call this once). -> { ok, req } | { ok:false, code } */
export const owner = (op) => (ROUND_OPS.includes(op) ? "round" : PLAYER_OPS.includes(op) || GM_OPS.includes(op) ? "engine" : null);
