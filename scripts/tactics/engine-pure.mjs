/* Tactical combat, package P2: the ACTION ENGINE (spec sections 5, 12.2, 14, 15). NO Foundry globals: everything that touches the world goes
   through `host`, so the whole engine runs in node with a scripted host (check-engine.mjs) and in Foundry with the executor's host (engine.mjs).
   The engine is never called directly by the executor: director-pure.mjs is the one entry (it also runs the turn and round operations).

   handle({ state, log }, input, host) -> { state, log, env, events, changed }
     input  { t:"req", user:{ id, staff }, rid, req:{ op, ... } }     a request (already normalised by relay-pure.mjs); players and the GM use the same door
            { t:"sys", effects:[...] }                               what the round driver hands over (director-pure.mjs): stress, recovery, due triggers, aborts
            { t:"roll", inst, key, rid, author, sixes, ones, pushed, pushable, messageId?, secret? }   a verified dice result read from chat (spec 11)
            { t:"tick" }                                             drive the stack again (reconnect, a document changed)
     host   { facts() -> Facts, perform(effect) -> Promise<{ op?, result? }>, now() -> ms, setting(key) }
     Facts  { c(cid) -> combatant facts|null, weapon(cid, ref), range(a, b) -> { total }|null|undefined, zone(cid), inZone(cid) -> [cid], user(uid) -> { id, staff, active },
              canTalk?(a, b), actorValue?(uuid, path) }    (built by engine.mjs from the system adapter and the zones adapter; scripted in the checks)
   The executor re-validates every request from scratch against `facts` (spec 1.1.1). Errors are returned as { key, code, params }, never thrown.

   EFFECTS a flow may return (performed in order; each one that changes something is journaled with its inverse in the instance's transaction):
     { t:"state", path, to }            reversible state write          { t:"pay", who, cost, action, key, interrupt?, defense?, target? }  ledger entry (P1)
     { t:"stress", who, n }             Resolve loss [B2816]            { t:"actor", who, path:"health"|"resolve", to }
     { t:"status+", who, status } / { t:"status-", who, id }            { t:"crit", who, n, id }      embeds the injury item (system adapter)
     { t:"dice", key, n }               dice rolled by the executor (hazards, injury D6); the faces come back in inst.data.res[key]
     { t:"roll", key, who, attr, pool, dice, maxPush, secret, label }   asks the owning user to roll; the result arrives later as input "roll"
     { t:"karma", note }                { t:"zones", op }  one write of the zones API (`apply`); its inverse op is journaled       { t:"message", ... }
   The history facts of spec 4.2 are not an effect: they are derived from the ledger entries (ledger-pure.mjs factsOf). */
import { damage } from "../rules/index.mjs";
import * as J from "./journal-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as S from "./state-pure.mjs";
import * as Lg from "./ledger-pure.mjs";
import { ledgerEditOf } from "./ops-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as C from "./catalog-pure.mjs";
import * as ZP from "./zones-pure.mjs";
import * as K from "./flows/kit.mjs";
import * as Attack from "./flows/attack.mjs";
import { roll as Roll, other as Other, hazard as Hazard, composite as Composite } from "./flows/simple.mjs";
import * as Move from "./flows/move.mjs";
import { act as Act } from "./flows/acts.mjs";
import * as Hz from "./flows/hazards.mjs";
import * as Challenge from "./flows/challenge.mjs";
import * as Vehicle from "./flows/vehicle.mjs";
import * as Chase from "./flows/chase.mjs";

export const FLOWS = Object.freeze({ attack: Attack, roll: Roll, other: Other, plain: Other, hazard: Hazard, composite: Composite,
  move: Move.move, fastball: Move.fastball, barrier: Move.barrier, forced: Move.forced, fall: Move.fall, release: Attack.release,       // P3: movement (flows/move.mjs)
  act: Act, blast: Hz.blast, fireSpread: Hz.fireSpread, vacuum: Hz.vacuum, disease: Hz.disease,       // P5: the other actions (flows/acts.mjs) and the hazards (flows/hazards.mjs)
  challenge: Challenge.objective, challengeEffect: Challenge.effect, seat: Vehicle.seat, drive: Vehicle.drive, chase: Chase.round });   // P7: challenges, vehicles, chases
export const ERROR_CODES = Object.freeze(["noGM", "untrusted", "stale", "rate", "badInput", "off", "notOwner", "notYourTurn", "noAction", "locked", "illegal", "unknown", "gone", "busy", "playersOff", "internal", "relay", "tooBig", "noPermission", "drift"]);
export const REVALIDATE_OPTIONS = Object.freeze(["continue", "amend", "forfeit", "cancel"]);      // [OQ-3]: the GM decides, no default
const bad = (code, params = {}) => ({ ok: false, changed: false, error: { key: `ITAC.err.${code}`, code, params } });
const ok = (extra = {}) => ({ ok: true, changed: true, ...extra });
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);

/* ------------------------------------------------------------------ context */
function makeX(state, log, host, user) {
  const X = { state, log: log ?? J.emptyLog(), host, user: user ?? { id: "engine", staff: true }, facts: null, events: [], changed: false };
  X.facts = liveFacts(X);
  return X;
}
/* P7 [B3412]: in a chase there is no map, the range between the sides is the chase distance (flows/chase.mjs reads the state of now) */
const liveFacts = (X) => Chase.facts(X.host.facts(), () => X.state);
const nextId = (X, p) => { X.state = { ...X.state, seq: (X.state.seq ?? 0) + 1 }; return `${p}${X.state.seq}`; };
const view = (X) => ({ state: X.state, facts: X.facts, entry: (inst) => C.entryFor(X.state, inst.actor, inst.action) });
const top = (X) => X.state.stack[X.state.stack.length - 1] ?? null;
const instOf = (X, id) => X.state.stack.find((i) => i.id === id) ?? null;
const setInst = (X, inst) => { X.state = { ...X.state, stack: X.state.stack.map((i) => (i.id === inst.id ? inst : i)) }; X.changed = true; };
const owns = (X, cid) => X.user.staff === true || !!X.facts.c(cid)?.owners?.includes(X.user.id);
function emit(X, inst, ev) {
  X.state = { ...X.state, evSeq: (X.state.evSeq ?? 0) + 1 };
  X.events.push({ ...ev, seq: X.state.evSeq, round: X.state.round, inst: inst?.id, action: inst?.action, actor: inst?.actor ?? undefined, by: X.user.id, at: X.host.now() });
}

/* ------------------------------------------------------------------ journal plumbing */
function record(X, txId, op, inst, step, tag) {
  const tx = X.state.txOpen[txId];
  if (!tx || !op) return;
  const o = { ...op };
  if (inst) o.i = inst.id;
  if (step) o.step = step;
  if (tag) o[tag] = 1;
  X.state = { ...X.state, txOpen: { ...X.state.txOpen, [txId]: { ...tx, ops: [...tx.ops, o] } } };
}
function write(X, txId, path, to, inst = null, step = null, tag = null) {
  const r = J.fineStateOp(X.state, path, to);
  if (!r.op) return false;
  X.state = r.state; X.changed = true;
  record(X, txId, r.op, inst, step, tag);
  return true;
}
async function perform(X, txId, effect, inst = null, step = null, tag = null) {
  const r = (await X.host.perform(effect)) ?? {};
  if (r.op) { record(X, txId, r.op, inst, step, tag); X.changed = true; }
  X.facts = liveFacts(X);
  return r.ok === false ? { ok: false, reason: r.reason } : r.result;                    // a refused command (the map said no) is the caller's to answer
}
function openTx(X, { inst = null, label = null }) {
  const id = nextId(X, "x");
  X.state = { ...X.state, txOpen: { ...X.state.txOpen, [id]: J.newTx({ id, inst, label, by: X.user.id, at: X.host.now(), round: X.state.round }) } };
  return id;
}
function closeTx(X, txId, label) {
  const tx = X.state.txOpen[txId];
  if (!tx) return;
  const { [txId]: _gone, ...rest } = X.state.txOpen;
  X.state = { ...X.state, txOpen: rest };
  if (tx.ops.length || label?.keep) X.log = J.pushLog(X.log, J.closeTx(tx, label ? { pub: label.pub ?? "", gm: label.gm ?? "" } : tx.label));
  X.changed = true;
}
/* [L5] [B2293]: every ledger is new at the start of a round and nothing is carried over. An undo that reaches back over a round boundary
   therefore leaves the ledger writes of the old round alone (they no longer exist); everything else is restored. [D] */
const liveOp = (X, op, round) => (op.t === "state" && round != null && round !== X.state.round
  ? { ...op, patch: op.patch.filter(([p]) => p[0] !== "ledger"), inverse: op.inverse.filter(([p]) => p[0] !== "ledger") } : op);
/** Undo a list of ops (newest first). State ops are applied here, document ops go to the host as their inverse request. */
async function undoOps(X, ops, round = null) {
  for (const op0 of [...ops].reverse()) {
    const op = liveOp(X, op0, round);
    if (op.t === "state") X.state = J.applyStateOp(X.state, op, true);
    else { const eff = J.inverseEffect(op); if (eff) await X.host.perform({ ...eff, undo: 1 }); }
  }
  X.facts = liveFacts(X); X.changed = true;
}

/* ------------------------------------------------------------------ effects of a flow step */
async function applyEffect(X, I, e, step) {
  const tx = I.tx, c = e.who ? X.facts.c(e.who) : null;
  switch (e.t) {
    case "state": write(X, tx, e.path, e.to, I, step); return false;
    case "pay": {
      const r = P1.pay(X.state, e.who, e.cost, { interrupt: !!e.interrupt, defense: !!e.defense, cause: e.cause, force: !!e.force }, { action: e.action, inst: I.id, tags: e.tags ?? (e.defense ? ["defence"] : []), target: e.target, onTurnOf: e.onTurnOf,
        ...(e.zoneFrom ? { zoneFrom: e.zoneFrom } : {}), ...(e.zoneTo ? { zoneTo: e.zoneTo } : {}), ...(Number.isFinite(e.borders) ? { borders: e.borders } : {}) });
      if (!r.ok) { (I.data.unpaid ??= {})[e.key] = r.reason; return false; }             // was legal when offered; shown to the GM instead of guessing
      write(X, tx, ["ledger", e.who], r.ledger, I, step, e.own ? "cost" : null);
      (I.data.paid ??= {})[e.key] = r.entryId;
      if (e.cost === "full" || e.cost === "quick") emit(X, I, { type: "ledger", combatant: e.who, unit: e.cost, on: true, entry: r.entryId });      // as the manual mark of the round driver: the action log listens
      if (r.stress > 0) await applyEffect(X, I, { t: "stress", who: e.who, n: r.stress, cost: e.own ? 1 : 0 }, step);     // the price of the unit that paid (spec 4.3; Quickness [R1], a defence grant [B2105])
      return false;
    }
    case "stress": {
      if (!c) return false;
      const s = damage.applyStress({ resolve: c.resolve, stress: e.n });                 // [B2816]: never below 0, further stress has no effect
      if (s.lost) await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "resolve", to: s.resolve, tx }, I, step, e.cost ? "cost" : null);
      return false;
    }
    case "actor": if (c) await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: e.path, to: e.to, tx }, I, step); return false;
    case "status+": { const w = M.statusAdd(X.state, e.who, e.status); write(X, tx, w.path, w.to, I, step); return false; }
    case "status-": { const w = M.statusRemove(X.state, e.who, e.id); write(X, tx, w.path, w.to, I, step); return false; }
    case "crit": if (c) await perform(X, tx, { t: "critAdd", uuid: c.actorUuid, n: e.n, id: e.id, tx }, I, step); return false;
    case "dice": { const faces = await perform(X, tx, { t: "dice", n: e.n, why: e.key, ...(e.sides > 0 ? { sides: Math.trunc(e.sides) } : {}) }, I, step); (I.data.res ??= {})[e.key] = Array.isArray(faces) ? faces : []; return true; }
    case "roll": {
      const rid = nextId(X, "r");
      const who = e.who === "hazard" ? null : X.facts.c(e.who);
      const players = (who?.owners ?? []).filter((u) => !X.facts.user(u)?.staff && X.facts.user(u)?.active !== false);
      const users = who && !who.npc && players.length ? players : ["gm"];              // NPC rolls and rolls of absent players are made at the GM desk
      I.rolls[e.key] = { key: e.key, who: e.who, attr: e.attr, pool: e.pool, pushed: 0, pushable: false, ...(e.secret ? { secret: 1 } : {}), req: { rid, users, at: X.host.now(), dice: e.dice, maxPush: e.maxPush, label: e.label ?? null } };
      const res = await perform(X, tx, { t: "rollRequest", inst: I.id, key: e.key, rid, users, actorUuid: who?.actorUuid ?? null, combatant: e.who, attr: e.attr, pool: e.pool, dice: e.dice, maxPush: e.maxPush, secret: e.secret, label: e.label }, I, step);
      if (isObj(res) && Number.isFinite(res.sixes)) { Object.assign(I.rolls[e.key], { sixes: res.sixes, ones: res.ones ?? 0, pushed: res.pushed ?? 0, pushable: !!res.pushable, messageId: res.messageId }); return true; }
      return false;
    }
    case "fact": return false;                                                             // spec 4.2: the facts of a turn are derived from the ledger entries (their tags), nothing is written twice
    case "karma": write(X, tx, ["karma"], [...X.state.karma, { id: nextId(X, "k"), round: X.state.round, ...e.note }], I, step); return false;
    case "zones": await perform(X, tx, { ...e, tx }, I, step); return false;
    /* P3: one stretch of a move (`zmove`: the map's move along the named zones, its step listener asked) or an arrival nobody is asked
       about (`zput`). The host answers { ok, done, total, stop: { reason, data } | null, spot, left } and the journal keeps the map's inverse. */
    case "zmove": case "zput": { const res = await perform(X, tx, { ...e, tx }, I, step); (I.data.res ??= {})[e.key] = isObj(res) ? res : { ok: false, reason: "noZones" }; return true; }
    case "message": await perform(X, tx, { ...e, tx }, I, step); return false;
    default: return false;
  }
}
/* who answers for a combatant: its player owners, else the GM desk (spec 5.4) */
const addresseeOf = (X, cid) => { const c = X.facts.c(cid), users = (c?.owners ?? []).filter((u) => !X.facts.user(u)?.staff); return !c || c.npc || !users.length ? "gm" : { users }; };
function openPrompt(X, I, spec, step) {
  const id = nextId(X, "p");
  const p = { id, inst: I?.id ?? null, step, kind: spec.kind, to: spec.to, options: spec.options ?? [] };
  for (const k of ["about", "multi", "min", "max", "free", "gmOnlyData", "data"]) if (spec[k] !== undefined) p[k] = spec[k];
  if (spec.auto) { p.auto = spec.auto; p.answered = { by: "auto", at: X.host.now(), value: spec.auto.option }; }     // plan 5.2 step 4: never shown
  X.state = { ...X.state, prompts: { ...X.state.prompts, [id]: p } }; X.changed = true;
  if (I) (I.data.pk ??= {})[spec.key] = id;
  return !!p.answered;
}
function dropPrompts(X, pred) {
  const keep = {};
  for (const [id, p] of Object.entries(X.state.prompts)) if (!pred(p)) keep[id] = p;
  X.state = { ...X.state, prompts: keep };
}
const waitsOf = (X, I) => Object.values(X.state.prompts).filter((p) => p.inst === I.id && !p.answered).map((p) => p.id);

/* ------------------------------------------------------------------ instances */
function makeInst(X, { action, actor, decl, cause = "turn", parent = null, data = {}, part = false, initiator = null, flow = null }) {
  const entry = C.entryFor(X.state, actor, action);
  const f = flow ?? entry?.flow ?? "other";
  const inst = { id: nextId(X, "a"), action, flow: FLOWS[f] ? f : "other", actor: actor ?? null, initiator: initiator ?? (actor ? { type: "combatant", id: actor } : { type: "gm", id: X.user.id }),
    by: X.user.id, parent, cause, step: FLOWS[FLOWS[f] ? f : "other"].STEPS[0], status: "open", decl, locked: false, waits: [], rolls: {}, data: { ...data }, overrides: [], tx: null };
  if (entry?.flow === "attack" && !inst.data.kind) inst.data.kind = entry.attack ?? "slugfest";
  if (part) inst.part = 1;
  return inst;
}
function pushInst(X, inst) { X.state = { ...X.state, stack: [...X.state.stack, inst] }; X.changed = true; }
const JOURNAL_HAZARDS = ["fire", "blast", "area", "vacuum", "disease"];
function label(X, inst, what) {
  const a = inst.actor ? X.facts.c(inst.actor) : null, e = C.entryFor(X.state, inst.actor, inst.action);
  /* the engine has no language: an action and a result are written as `{key}` marks that the surfaces put into the reader's language (lang.mjs
     `marks`); an entry with a name of its own (a granted power) keeps that name */
  const act = e?.name || (typeof e?.label === "string" && !e.label.startsWith("ITAC.") ? e.label : inst.action === "fireSpread" ? "{ITAC.journal.fireSpread}" : `{ITAC.action.${inst.action}}`);      // the card of the spread is titled with a question; the journal states what it was
  const res = what ? ` ({ITAC.result.${what}})` : "";
  /* nobody's action (a hazard, a forced move, a consequence of a challenge, a waiting trigger): the doer is the GM's hand or nobody, never an id;
     what it is comes from the hazard's kind or from the trigger's own name; `{zone:key}` is the place, named by the surface as the map names it */
  const hk = inst.data?.hazard?.kind, own = !inst.actor && typeof inst.decl?.text === "string" && inst.decl.text.trim() ? inst.decl.text.trim().slice(0, 80) : null;
  const what0 = own ?? (inst.action === "hazard" && JOURNAL_HAZARDS.includes(hk) ? `{ITAC.ui.hz.kind.${hk}}` : act);
  const who = a?.name ?? (inst.cause === "gm" || inst.initiator?.type === "gm" ? "{ITAC.journal.gm}" : "");
  const spot = inst.decl?.zone ?? inst.data?.hz?.zone ?? inst.data?.hazard?.zone ?? (["move", "drive", "fastball"].includes(inst.flow) ? inst.data?.mv?.at ?? inst.data?.mv?.to ?? null : null);
  const names = (inst.decl?.targets ?? []).map((t) => X.facts.c(t)?.name).filter(Boolean).join(", ");
  const pub = a?.hidden ? "" : `${a?.name ? `${a.name}: ` : ""}${a ? act : what0}${res}`;       // spec 10: two texts; a hidden actor has no public line, and no public line names a target or a place
  return { pub: a || (inst.decl?.targets ?? []).every((t) => !X.facts.c(t)?.hidden) ? pub : "", gm: `${who ? `${who}: ` : ""}${what0}${names ? ` -> ${names}` : ""}${typeof spot === "string" && spot ? ` @ {zone:${spot.slice(0, 60)}}` : ""}${res}` };
}
/** Start a child of `parent` (interrupt, counterattack, part of a composite). Costs are prepaid by the parent's reaction or by the composite. */
function pushChild(X, parent, spec) {
  const inst = makeInst(X, { action: spec.action, actor: spec.actor, decl: spec.decl, cause: spec.cause ?? "interrupt", parent: parent.id, data: spec.data ?? {}, part: !!spec.part, flow: spec.flow ?? null, initiator: spec.initiator ?? null });
  const l = K.legality(view(X), inst, FLOWS[inst.flow]);
  if (!l.ok) return { ok: false, reason: l.reason };
  inst.tx = spec.part ? parent.tx : openTx(X, { inst: inst.id });
  pushInst(X, inst);
  emit(X, inst, { type: "actionDeclared", decl: publicDecl(inst.decl), cost: "none", stress: 0, targets: inst.decl.targets ?? [], cause: inst.cause });
  return { ok: true, inst };
}
const publicDecl = (d) => ({ action: d.action, weapon: d.weapon, targets: d.targets ?? [], zone: d.zone, special: d.special, wreck: d.wreck, area: d.area, fullAuto: d.fullAuto, to: d.to, mode: d.mode, attr: d.attr });

async function closeInst(X, I, result = null) {
  I.status = I.status === "aborted" ? "aborted" : "done";
  if (result) I.data.result = result;
  dropPrompts(X, (p) => p.inst === I.id);
  X.state = { ...X.state, stack: X.state.stack.filter((i) => i.id !== I.id) };
  if (!I.part) closeTx(X, I.tx, label(X, I, I.data.result));
  emit(X, I, { type: "actionClosed", summary: { result: I.data.result ?? null, status: I.status }, tx: I.part ? null : I.tx });
  const parent = I.parent ? instOf(X, I.parent) : null;
  if (!parent) return;
  const P = J.clone(parent);
  (P.data.children ??= {})[I.id] = { action: I.action, status: I.status, result: I.data.result ?? null };
  if (I.part) (P.data.results ??= []).push({ action: I.action, status: I.status, result: I.data.result ?? null });
  else {                                                                                    // spec 5.1: the instance beneath is revalidated before it continues
    const rv = FLOWS[P.flow].revalidate(view(X), P);
    if (!rv.ok) {
      P.data.hold = "revalidate"; P.data.holdReasons = rv.reasons;
      openPrompt(X, P, { key: `reval:${I.id}`, kind: "revalidate", to: "gm", about: P.actor, options: REVALIDATE_OPTIONS.map((id) => ({ id, label: `ITAC.opt.${id}` })), data: { reasons: rv.reasons, after: I.id } }, P.step);   // [OQ-3]
      P.data.holdKey = `reval:${I.id}`;
    }
  }
  P.status = "open";
  setInst(X, P);
}
/** End an instance and undo what it did (spec 14.1 abort). refund=false keeps the ops tagged as the action's own cost ("action spent"). */
async function abortInst(X, id, refund) {
  const at = X.state.stack.findIndex((i) => i.id === id);
  if (at < 0) return false;
  for (const inst of [...X.state.stack.slice(at)].reverse()) {                              // everything pushed above it goes first
    const own = inst.id === id, tx = X.state.txOpen[inst.tx];
    const ids = new Set([inst.id, ...Object.keys(inst.data.children ?? {})]);
    if (tx) {
      const mine = tx.ops.filter((o) => ids.has(o.i)), undo = mine.filter((o) => !(own && !refund && o.cost));
      await undoOps(X, undo, tx.round);
      const left = tx.ops.filter((o) => !undo.includes(o));
      X.state = { ...X.state, txOpen: { ...X.state.txOpen, [inst.tx]: { ...tx, ops: left } } };
    }
    const I = J.clone(instOf(X, inst.id) ?? inst);
    I.status = "aborted"; I.data.result = "aborted";
    await closeInst(X, I);
  }
  return true;
}

/* ------------------------------------------------------------------ the stack driver */
async function drive(X) {
  for (let guard = 0; guard < 500; guard++) {
    const inst = top(X);
    if (!inst || inst.status === "manual" || inst.status === "aborted") return;
    if (inst.data.hold) { if (!(await resolveHold(X, inst))) return; continue; }
    const flow = FLOWS[inst.flow], fn = flow.steps[inst.step];
    if (!fn) { const I = J.clone(inst); I.status = "manual"; setInst(X, I); return; }      // unknown step: never guess, hand it to the GM
    const R = fn(view(X), inst), I = R.inst;
    if (!I.hist?.[I.step]) (I.hist ??= {})[I.step] = JSON.stringify({ data: inst.data, rolls: inst.rolls, locked: inst.locked, decl: inst.decl });   // for goToStep / amend
    let progress = false;
    for (const e of R.effects) progress = (await applyEffect(X, I, e, inst.step)) || progress;
    for (const p of R.prompts) progress = openPrompt(X, I, p, inst.step) || progress;
    for (const ev of R.events) emit(X, I, ev);
    if (R.done) { setInst(X, I); await closeInst(X, I); continue; }
    if (R.push) {
      I.status = "waiting"; I.waits = waitsOf(X, I); setInst(X, I);
      const r = pushChild(X, I, R.push);
      if (!r.ok) { const P = J.clone(instOf(X, I.id)); (P.data.notes ??= []).push({ note: "pushRefused", action: R.push.action, reason: r.reason }); if (R.push.part) (P.data.results ??= []).push({ action: R.push.action, status: "aborted", result: "illegal" }); P.status = "open"; setInst(X, P); }
      continue;
    }
    if (R.goto) { I.step = R.goto; I.status = "open"; I.waits = waitsOf(X, I); setInst(X, I); continue; }
    I.status = I.status === "manual" ? "manual" : "waiting"; I.waits = waitsOf(X, I);
    setInst(X, I);
    if (!progress) return;
  }
}
/** An instance held after a failed revalidation: the GM's answer decides (spec 5.1, [OQ-3]). Returns true when the driver may continue. */
async function resolveHold(X, inst) {
  if (inst.data.hold === "amend") return false;                                             // waits for the owner's `amend` (or a GM override)
  const p = X.state.prompts[inst.data.pk?.[inst.data.holdKey]];
  if (!p?.answered) return false;
  const id = typeof p.answered.value === "string" ? p.answered.value : p.answered.value?.id;
  const I = J.clone(inst);
  delete I.data.holdKey; delete I.data.holdReasons;
  if (id === "forfeit") { delete I.data.hold; setInst(X, I); await abortInst(X, I.id, false); return true; }
  if (id === "cancel") { delete I.data.hold; setInst(X, I); await abortInst(X, I.id, true); return true; }
  if (id === "amend") { I.data.hold = "amend"; I.locked = false; setInst(X, I); return false; }
  delete I.data.hold; setInst(X, I);                                                        // "continue as declared"
  return true;
}
/** Re-open an earlier step: later results are undone through the transaction (spec 14.1 goToStep; also used by `amend`). */
async function rewind(X, id, step) {
  const inst = instOf(X, id), flow = inst && FLOWS[inst.flow];
  const idx = flow ? flow.STEPS.indexOf(step) : -1;
  if (idx < 0 || idx > flow.STEPS.indexOf(inst.step)) return false;
  if (top(X).id !== id) for (const above of X.state.stack.slice(X.state.stack.findIndex((i) => i.id === id) + 1).reverse()) await abortInst(X, above.id, true);
  const later = new Set(flow.STEPS.slice(idx)), tx = X.state.txOpen[inst.tx];
  if (tx) {
    const undo = tx.ops.filter((o) => o.i === id && later.has(o.step));
    await undoOps(X, undo, tx.round);
    X.state = { ...X.state, txOpen: { ...X.state.txOpen, [inst.tx]: { ...X.state.txOpen[inst.tx], ops: X.state.txOpen[inst.tx].ops.filter((o) => !undo.includes(o)) } } };
  }
  dropPrompts(X, (p) => p.inst === id && later.has(p.step));
  const I = J.clone(instOf(X, id));
  const snap = I.hist?.[step] ? JSON.parse(I.hist[step]) : null;
  if (snap) { I.data = snap.data; I.rolls = snap.rolls; I.locked = snap.locked; I.decl = snap.decl; }
  for (const s of flow.STEPS.slice(idx)) delete I.hist?.[s];
  I.step = step; I.status = "open"; I.waits = waitsOf(X, I);
  setInst(X, I);
  return true;
}

/* ------------------------------------------------------------------ requests: players (spec 12.2) */
function sanitizeDecl(d, action, staff = false) {
  const ids = (v, n = 12) => (Array.isArray(v) ? v.filter(P1.isId).slice(0, n) : []);
  const out = { action, targets: ids(d?.targets), helpers: [], exploits: [], stressTotal: 0 };
  if (typeof d?.weapon === "string") out.weapon = d.weapon.slice(0, 120);
  if (typeof d?.power === "string") out.power = d.power.slice(0, 120);
  if (typeof d?.zone === "string") out.zone = d.zone.slice(0, 40);
  if (typeof d?.to === "string") out.to = d.to.slice(0, 60);                                // P3: where a move goes (a spot) or the border a door action works on
  if (typeof d?.mode === "string" && P1.isId(d.mode)) out.mode = d.mode.slice(0, 40);
  if (d?.pay === "quick" || d?.pay === "full") out.pay = d.pay;
  if (d?.stress === true || d?.stress === 1) out.stress = 1;
  if (typeof d?.airborne === "boolean") out.airborne = d.airborne;
  if (d?.force === true || d?.force === 1) out.force = true; else if (isObj(d?.force)) out.force = Object.fromEntries(Object.entries(d.force).filter(([k, x]) => ZP.isBorderKey(k) && (x === "door" || x === "wall")).slice(0, 12));
  if (Array.isArray(d?.carry)) out.carry = ids(d.carry, 4);
  if (Array.isArray(d?.path)) out.path = d.path.filter((z) => typeof z === "string").map((z) => z.slice(0, 40)).slice(0, 24);
  if (["charge", "grapple", "grappleAttack"].includes(d?.special)) out.special = d.special;
  for (const k of ["wreck", "area", "blind", "noPush", "secret"]) if (d?.[k] === true || d?.[k] === 1) out[k] = 1;
  if (Array.isArray(d?.fullAuto) ? d.fullAuto.length : d?.fullAuto === true || d?.fullAuto === 1) {       // [B2543]: the targets of full auto are the declaration's targets (the older list form is merged into them)
    if (Array.isArray(d.fullAuto)) out.targets = [...new Set([...out.targets, ...ids(d.fullAuto)])].slice(0, 12);
    out.fullAuto = 1;
  }
  if (Array.isArray(d?.tokens)) out.tokens = ids(d.tokens);
  if (Array.isArray(d?.exploits)) out.exploits = d.exploits.filter((e) => e && P1.isId(e.id)).slice(0, 8).map((e) => ({ id: e.id, stress: Math.max(0, Math.min(20, Math.trunc(Number(e.stress) || 0))) }));
  out.stressTotal = out.exploits.reduce((s, e) => s + e.stress, 0);
  if (Number.isFinite(d?.pulled)) out.pulled = Math.max(0, Math.trunc(d.pulled));
  if (typeof d?.attr === "string") out.attr = d.attr.slice(0, 12);
  if (Number.isFinite(d?.mod)) out.mod = Math.max(-12, Math.min(12, Math.trunc(d.mod)));
  if (typeof d?.text === "string") out.text = d.text.slice(0, 300);
  if (P1.isId(d?.item)) out.item = d.item;                                                  // P5: the ground item a "pick up" takes
  if (Array.isArray(d?.parts)) out.parts = d.parts.filter(isObj).slice(0, 6).map((p) => ({ action: String(p.action ?? "").slice(0, 32), decl: p.decl ? { targets: ids(p.decl.targets), weapon: typeof p.decl.weapon === "string" ? p.decl.weapon.slice(0, 120) : undefined } : undefined }));
  if (isObj(d?.exception) && typeof d.exception.text === "string") out.exception = { text: d.exception.text.slice(0, 300), state: "asked" };
  if (staff && Array.isArray(d?.confirmed)) out.confirmed = d.confirmed.filter((x) => typeof x === "string").map((x) => x.slice(0, 40)).slice(0, 12);      // `{ gm: id }` conditions the GM vouches for (rules/conditions.mjs)
  return out;
}
/** Where may a new action go? Empty stack: the actor's own turn (or a grant). Otherwise only as a legal interrupt of the top instance, declared before
    its dice ([B2292], spec 5.5). Returns { ok, cause, parent } or an error code. */
function placement(X, actor, entry) {
  const t = top(X);
  if (!t) return { ok: true, cause: "turn", parent: null };
  if (t.locked || !t.data.window || !entry.interrupt?.on?.includes(t.data.window)) return { ok: false, code: "busy" };
  if (t.actor === actor) return { ok: false, code: "busy" };
  return { ok: true, cause: "interrupt", parent: t.id };
}
async function opDeclare(X, a) {
  const actor = a.actor;
  if (X.state.mode === "off") return bad("off");
  if (!P1.isId(actor) || !X.facts.c(actor) || (X.facts.c(actor).hidden && !X.user.staff)) return bad("unknown");
  if (!owns(X, actor)) return bad("notOwner");
  const entry = C.entryFor(X.state, actor, a.decl?.action);
  if (!entry || entry.reaction?.effect === "defence") return bad("unknown", { action: String(a.decl?.action ?? "").slice(0, 32) });
  const decl = sanitizeDecl(a.decl, entry.id, X.user.staff === true);
  if (X.state.mode === "free" || X.state.free?.[actor]) {                                  // spec 14.5: nothing is validated, nobody is prompted; logged as declared
    const inst = makeInst(X, { action: entry.id, actor, decl, flow: "other", data: { free: 1 } });
    inst.tx = openTx(X, { inst: inst.id }); inst.status = "manual"; pushInst(X, inst);
    emit(X, inst, { type: "actionDeclared", decl: publicDecl(decl), cost: "none", stress: 0, targets: decl.targets });
    return ok({ inst: inst.id });
  }
  if (entry.id === "gmRoll" && !X.user.staff) return bad("noPermission");
  const pl = placement(X, actor, entry);
  if (!pl.ok) return bad(pl.code);
  const gm = X.user.staff && a.gm === true;                                                // the GM acting through an override: costs waived
  const priced = typeof FLOWS[entry.flow]?.price === "function";                           // P3: a flow that names its own cost (a move: quick or full, free inside the zone)
  const payable = (cost) => { const cp = P1.canPay(X.state, actor, cost, { interrupt: pl.cause === "interrupt", gm }); return cp.ok ? null : bad(cp.reason === "notYourTurn" ? "notYourTurn" : "noAction", { reason: cp.reason }); };   // [L1]-[L4], [L7], [L8]
  if (!priced) { const no = payable(entry.cost); if (no) return no; }
  const inst = makeInst(X, { action: entry.id, actor, decl, cause: pl.cause, parent: pl.parent, data: a.data && X.user.staff ? a.data : {} });
  const l = K.legality(view(X), inst, FLOWS[inst.flow]);
  if (!l.ok && !decl.exception) return bad("illegal", { reason: l.reason, ...l.params });
  const price = priced ? FLOWS[inst.flow].price(view(X), inst) : null, cost = priced ? price?.cost ?? "none" : entry.cost;
  if (priced) { const no = payable(cost); if (no) return no; }
  inst.tx = openTx(X, { inst: inst.id });
  if (pl.parent) { const P = J.clone(instOf(X, pl.parent)); P.status = "waiting"; setInst(X, P); }
  pushInst(X, inst);
  const I = J.clone(inst);
  if (cost === "full" || cost === "quick" || (cost === "free" && price?.tags)) {
    await applyEffect(X, I, { t: "pay", who: actor, cost: gm ? "none" : cost, action: entry.id, key: "own", own: 1, interrupt: pl.cause === "interrupt", tags: price?.tags ?? entry.tags, target: decl.targets, zoneFrom: price?.zoneFrom, zoneTo: price?.zoneTo, borders: price?.borders }, "declare");   // waived by the GM: the entry is recorded (the facts of the turn), no unit is spent
    I.entry = I.data.paid?.own ?? null;
  }
  if (!l.ok) {                                                                              // an illegal option with a request for an exception (spec 9.12): a desk card
    I.data.exception = { reason: l.reason, params: l.params }; I.data.hold = "exception"; I.status = "waiting";
    openPrompt(X, I, { key: "exception", kind: "exception", to: "gm", about: actor, free: 1, options: [{ id: "grant", label: "ITAC.opt.grant" }, { id: "deny", label: "ITAC.opt.deny" }], data: { reason: l.reason, text: decl.exception.text } }, "declare");
    I.data.holdKey = "exception";
  }
  setInst(X, I);
  emit(X, I, { type: "actionDeclared", decl: publicDecl(decl), cost, stress: decl.stressTotal, targets: decl.targets, zone: decl.zone, path: decl.path });
  return ok({ inst: inst.id });
}
async function opAmend(X, a) {
  const inst = instOf(X, a.inst);
  if (!inst) return bad("gone");
  if (!inst.actor || !owns(X, inst.actor)) return bad("notOwner");
  if (inst.locked && !X.user.staff) return bad("locked");                                  // spec 5.5: after the lock only the GM changes it
  const decl = sanitizeDecl({ ...a.decl, action: inst.action }, inst.action, X.user.staff === true);
  const probe = { ...inst, decl };
  const l = K.legality(view(X), probe, FLOWS[probe.flow]);
  if (!l.ok && !X.user.staff) return bad("illegal", { reason: l.reason, ...l.params });
  await rewind(X, inst.id, FLOWS[inst.flow].STEPS[0]);
  const I = J.clone(instOf(X, inst.id));
  I.decl = decl; delete I.data.hold; delete I.data.holdKey; I.locked = false; I.hist = {};
  if (!l.ok) I.data.exception = { reason: l.reason, params: l.params, by: "gm" };          // spec 14.1: the GM may amend into what the rules refuse; it runs as a granted exception
  setInst(X, I);
  emit(X, I, { type: "actionDeclared", decl: publicDecl(decl), amended: true, targets: decl.targets });
  return ok({ inst: I.id });
}
async function opCancel(X, a) {
  const inst = instOf(X, a.inst);
  if (!inst) return bad("gone");
  if (!inst.actor || !owns(X, inst.actor)) return bad("notOwner");
  if (!inst.locked || X.user.staff) { await abortInst(X, inst.id, true); return ok(); }     // not locked: removed and refunded
  if (inst.data.pk?.cancelAsk) return ok({ changed: false });
  const I = J.clone(inst);                                                                  // locked: a desk card for the GM (spec 12.2)
  openPrompt(X, I, { key: "cancelAsk", kind: "exception", to: "gm", about: inst.actor, options: [{ id: "cancel", label: "ITAC.opt.cancel" }, { id: "forfeit", label: "ITAC.opt.forfeit" }, { id: "deny", label: "ITAC.opt.deny" }], data: { reason: "cancelLocked" } }, inst.step);
  setInst(X, I);
  return ok({ prompt: I.data.pk.cancelAsk });
}
function checkValue(X, p, value) {
  const optOk = (id) => { const o = p.options.find((x) => x.id === id); return !!o && (!o.disabled || X.user.staff); };       // the GM may pick a greyed option [U]
  if (p.multi) {
    if (!Array.isArray(value) || value.length > 24 || value.length < (p.min ?? 0) || value.length > (p.max ?? 24)) return null;
    return value.every((id) => typeof id === "string" && optOk(id)) ? value.slice() : null;
  }
  if (typeof value === "string") return optOk(value) ? value : (p.free && value.length <= 300 ? { id: null, text: value } : null);
  if (!isObj(value)) return null;
  if (value.id != null && !optOk(value.id)) return null;
  const out = { id: value.id ?? null };
  if (Array.isArray(value.tokens)) out.tokens = value.tokens.filter(P1.isId).slice(0, 12);
  if (Number.isFinite(value.dice)) out.dice = Math.max(-12, Math.min(12, Math.trunc(value.dice)));
  if (Number.isFinite(value.n)) out.n = Math.max(0, Math.min(99, Math.trunc(value.n)));
  if (P1.isId(value.for)) out.for = value.for;
  if (typeof value.text === "string" && p.free) out.text = value.text.slice(0, 300);
  if (value.always === true && X.user.staff) out.always = true;
  return out.id == null && out.text == null ? null : out;
}
async function opAnswer(X, a, forAnyone = false) {
  const p = X.state.prompts[a.prompt];
  if (!p) return bad("gone");
  if (p.answered && !(X.user.staff && p.auto && p.kind === "reaction")) return bad("locked");   // an automatic NPC answer may be changed until the engine acted on it [U]
  const mine = X.user.staff || (p.to !== "gm" && p.to?.users?.includes(X.user.id)) || (p.about && p.to !== "gm" && owns(X, p.about));
  if (!mine || (forAnyone && !X.user.staff)) return bad("notOwner");
  const value = checkValue(X, p, a.value);
  if (value == null) return bad("badInput");
  const inst = p.inst ? instOf(X, p.inst) : null;
  if (inst) {
    const vr = FLOWS[inst.flow].validate?.(view(X), inst, p, value);
    if (vr && !vr.ok) return bad("illegal", { reason: vr.reason });
    if (p.answered && inst.data.done?.[Object.keys(inst.data.pk ?? {}).find((k) => inst.data.pk[k] === p.id)]) return bad("locked");   // already acted upon
  }
  X.state = { ...X.state, prompts: { ...X.state.prompts, [p.id]: { ...p, answered: { by: X.user.id, at: X.host.now(), value } } } }; X.changed = true;
  if (value?.always && p.kind === "reaction" && p.about) {                                  // spec 13.1 "always do this for this NPC"
    const pol = { ...(X.state.npc[p.about] ?? {}) };
    if (value.id === "block" || value.id === "dodge") pol[value.id] = "always"; else if (value.id === "pass") { pol.block = "never"; pol.dodge = "never"; }
    X.state = { ...X.state, npc: { ...X.state.npc, [p.about]: pol } };
  }
  if (!inst) await standalone(X, X.state.prompts[p.id]);
  else if (inst.data.hold === "exception" && inst.data.pk?.exception === p.id) {
    const I = J.clone(inst), id = typeof value === "string" ? value : value.id;
    delete I.data.hold; delete I.data.holdKey; I.decl.exception = { ...I.decl.exception, state: id === "grant" ? "granted" : "denied" };
    setInst(X, I);
    if (id !== "grant") await abortInst(X, I.id, true);
  } else if (inst.data.pk?.cancelAsk === p.id) { const id = typeof value === "string" ? value : value.id; if (id === "cancel") await abortInst(X, inst.id, true); else if (id === "forfeit") await abortInst(X, inst.id, false); }
  return ok({ prompt: p.id });
}
/** Prompts that belong to no instance (exception request without an action, token confirmation ...): answering closes them. */
async function standalone(X, p) { dropPrompts(X, (q) => q.id === p.id); emit(X, null, { type: "override", op: "card", kind: p.kind, value: p.answered.value }); }

async function opHelp(X, a) {
  const inst = instOf(X, a.inst);
  if (!inst || !inst.actor) return bad("gone");
  if (!P1.isId(a.helper) || !owns(X, a.helper)) return bad("notOwner");
  if (inst.locked) return bad("locked");
  if (a.helper === inst.actor || (inst.decl.helpers ?? []).some((h) => h.id === a.helper)) return bad("badInput");
  const has = P1.canPay(X.state, a.helper, "full", { cause: "help" });                    // [L9], [L2], [B2273]: the helper's full action is spent on the helped character's turn
  const I = J.clone(inst);
  if ((I.decl.helpers ?? []).filter((h) => h.consent === "yes").length >= 3) return bad("illegal", { reason: "tooMany" });       // [B2238]
  const paid = has.ok ? P1.pay(X.state, a.helper, "full", { cause: "help" }, { action: "help", inst: I.id, onTurnOf: I.actor ?? undefined, target: [I.actor], tags: ["help"] }) : null;
  if (paid?.ok) {
    write(X, I.tx, ["ledger", a.helper], paid.ledger, I, "declare");
    I.decl.helpers = [...(I.decl.helpers ?? []), { id: a.helper, consent: "yes" }];
  } else {                                                                                  // [R11]: refused by the interface, the GM may accept anyway
    I.decl.helpers = [...(I.decl.helpers ?? []), { id: a.helper, consent: "pending" }];
    openPrompt(X, I, { key: `help:${a.helper}`, kind: "helpOverride", to: "gm", about: a.helper, options: [{ id: "accept", label: "ITAC.opt.accept" }, { id: "refuse", label: "ITAC.opt.refuse" }], data: { reason: "noFullAction", for: I.actor } }, "declare");
  }
  setInst(X, I);
  return ok({ inst: I.id });
}
function applyHelpAnswers(X) {
  for (const inst of X.state.stack) for (const h of inst.decl?.helpers ?? []) {
    if (h.consent !== "pending") continue;
    const p = X.state.prompts[inst.data.pk?.[`help:${h.id}`]];
    if (!p?.answered) continue;
    const I = J.clone(inst), yes = (typeof p.answered.value === "string" ? p.answered.value : p.answered.value?.id) === "accept";
    I.decl.helpers = yes ? I.decl.helpers.map((x) => (x.id === h.id ? { ...x, consent: "yes" } : x)) : I.decl.helpers.filter((x) => x.id !== h.id);
    setInst(X, I);
  }
}
async function opAsk(X, a, kind) {
  if (!P1.isId(a.actor) || !X.facts.c(a.actor)) return bad("unknown");
  if (!owns(X, a.actor)) return bad("notOwner");
  const text = String(a.text ?? "").slice(0, 300);
  if (!text) return bad("badInput");
  if (kind === "other") {                                                                   // "something else" (spec 9.12): a GM-driven instance
    if (X.state.stack.length) return bad("busy");
    const inst = makeInst(X, { action: "other", actor: a.actor, decl: { action: "other", targets: [], helpers: [], exploits: [], stressTotal: 0, text }, flow: "other" });
    inst.tx = openTx(X, { inst: inst.id }); inst.status = "manual"; pushInst(X, inst);
    emit(X, inst, { type: "actionDeclared", decl: { action: "other" }, cost: "none", stress: 0, targets: [] });
    return ok({ inst: inst.id });
  }
  if (Object.values(X.state.prompts).filter((p) => p.kind === "exception" && !p.inst && p.about === a.actor).length >= 3) return bad("rate");
  openPrompt(X, null, { key: "x", kind: "exception", to: "gm", about: a.actor, free: 1, options: [{ id: "grant", label: "ITAC.opt.grant" }, { id: "deny", label: "ITAC.opt.deny" }], data: { text, inst: P1.isId(a.inst) ? a.inst : undefined } }, null);
  return ok();
}

/* ------------------------------------------------------------------ requests: GM overrides (spec 14) */
function noteOverride(X, I, op, before, after) {
  I.overrides = [...(I.overrides ?? []), { step: I.step, op, by: X.user.id, at: X.host.now(), before, after }].slice(-40);
  emit(X, I, { type: "override", op, gmOnly: 1 });
}
async function gmInstOp(X, op, a) {
  const inst = instOf(X, a.inst);
  if (!inst) return bad("gone");
  const flow = FLOWS[inst.flow], idx = (s) => flow.STEPS.indexOf(s);
  let I = J.clone(inst);
  const forced = (k) => ((I.data.forced ??= {})[k] ??= {});
  switch (op) {
    case "setPool": {
      const key = String(a.roll ?? "").slice(0, 40);
      if (K_rolled(I, key)) return bad("locked");
      const v = Number.isFinite(a.total) ? { total: Math.max(1, Math.min(40, Math.trunc(a.total))) } : Array.isArray(a.mods) ? { mods: a.mods.slice(0, 8).map((m) => ({ label: String(m?.label ?? "").slice(0, 24), dice: Math.max(-20, Math.min(20, Math.trunc(Number(m?.dice) || 0))) })) } : null;
      if (!v) return bad("badInput");
      noteOverride(X, I, op, I.data.forced?.pool?.[key] ?? null, v); forced("pool")[key] = v;
      if (I.rolls[key]) delete I.rolls[key];                                               // asked but not rolled yet: asked again with the new pool
      break;
    }
    case "setSixes": {
      const key = String(a.roll ?? "").slice(0, 40), sixes = Math.max(0, Math.min(40, Math.trunc(Number(a.sixes))));
      if (!Number.isFinite(sixes)) return bad("badInput");
      noteOverride(X, I, op, I.rolls[key]?.forced ?? I.rolls[key]?.sixes ?? null, sixes);
      setInst(X, I);
      const rs = rollStepOf(I, key), keep = I.rolls;
      if (rs && idx(rs) >= 0 && idx(rs) < idx(I.step)) {                                    // a replaced result re-runs what followed it; the other dice of that step stay
        await rewind(X, I.id, rs); I = J.clone(instOf(X, I.id));
        for (const [k, r] of Object.entries(keep)) if (rollStepOf(I, k) === rs && !I.rolls[k]) I.rolls[k] = r;
      }
      I.rolls[key] = { ...(I.rolls[key] ?? { key, who: I.actor, attr: null, pool: { base: 0, mods: [], total: 0 }, pushed: 0 }), pushable: false, forced: { sixes } };
      break;
    }
    case "setOutcome": {
      if (!P1.isId(a.target) || typeof a.hit !== "boolean" || idx("outcome") < 0) return bad("badInput");
      noteOverride(X, I, op, I.data.out?.[a.target]?.hit ?? null, a.hit); setInst(X, I);
      if (idx(I.step) > idx("outcome")) { await rewind(X, I.id, "outcome"); I = J.clone(instOf(X, I.id)); }
      ((I.data.forced ??= {}).outcome ??= {})[a.target] = a.hit;
      break;
    }
    case "setDamage": {
      if (!P1.isId(a.target) || !Number.isFinite(a.amount) || idx("damage") < 0) return bad("badInput");
      const v = { amount: Math.max(0, Math.min(999, Math.trunc(a.amount))) };
      if (Number.isFinite(a.armor)) v.armor = Math.max(0, Math.min(99, Math.trunc(a.armor)));
      noteOverride(X, I, op, I.data.dmg?.[a.target]?.taken ?? null, v); setInst(X, I);
      if (idx(I.step) > idx("damage")) { await rewind(X, I.id, "damage"); I = J.clone(instOf(X, I.id)); }
      ((I.data.forced ??= {}).damage ??= {})[a.target] = v;
      break;
    }
    case "skipStep": {
      const next = flow.STEPS[idx(I.step) + 1];
      if (!next) return bad("badInput");
      noteOverride(X, I, op, I.step, next);
      dropPrompts(X, (p) => p.inst === I.id && p.step === I.step);
      delete I.data.hold; I.data.window = null; I.step = next; I.status = "open";
      break;
    }
    case "goToStep": {
      if (idx(a.step) < 0 || idx(a.step) > idx(I.step)) return bad("badInput");
      noteOverride(X, I, op, I.step, a.step); setInst(X, I);
      await rewind(X, I.id, a.step);
      return ok({ inst: I.id });
    }
    case "abort": noteOverride(X, I, op, null, { refund: a.refund !== false }); setInst(X, I); await abortInst(X, I.id, a.refund !== false); return ok();
    case "retarget": {                                                                      // GM retargeting (spec 9.1 step 4 as an override)
      if (!P1.isId(a.from) || !P1.isId(a.to) || !I.decl.targets.includes(a.from) || !X.facts.c(a.to)) return bad("badInput");
      noteOverride(X, I, op, a.from, a.to); setInst(X, I);
      const back = flow.STEPS.includes("reactBefore") && idx(I.step) >= idx("reactBefore") ? "reactBefore" : flow.STEPS[0];
      await rewind(X, I.id, back); I = J.clone(instOf(X, I.id));
      I.decl.targets = I.decl.targets.map((t) => (t === a.from ? a.to : t));
      (I.data.retargets ??= []).push({ from: a.from, to: a.to, by: "gm" });
      dropPrompts(X, (p) => p.inst === I.id && p.about === a.from);
      break;
    }
    case "manual": return manual(X, I, isObj(a.result) ? a.result : {});
    default: return bad("badInput");
  }
  setInst(X, I);
  return ok({ inst: I.id });
}
const K_rolled = (I, key) => { const r = I.rolls?.[key]; return !!r && (r.forced != null || r.sixes != null); };
const rollStepOf = (I, key) => (key === "attack" || key.startsWith("def:") ? "roll" : key.startsWith("gate:") ? "gate" : key.startsWith("stun:") ? "effects" : key === "roll" ? "roll" : null);
/** "Resolve manually" (spec 5.3): the engine stops driving; what the GM entered is applied and journaled, and the transaction closes. */
async function manual(X, I, res) {
  for (const above of X.state.stack.slice(X.state.stack.findIndex((i) => i.id === I.id) + 1).reverse()) await abortInst(X, above.id, true);
  noteOverride(X, I, "manual", null, null);
  I.status = "manual"; I.data.manual = { note: String(res.note ?? "").slice(0, 300) };
  if (["full", "quick"].includes(res.cost) && I.actor && !I.entry) {
    const r = P1.pay(X.state, I.actor, res.cost, { force: true }, { action: I.action, inst: I.id, tags: C.entryFor(X.state, I.actor, I.action)?.tags ?? [] });
    if (r.ok) { write(X, I.tx, ["ledger", I.actor], r.ledger, I, "manual"); I.entry = r.entryId; }
    else (I.data.notes ??= []).push({ note: "costNotCharged", cost: res.cost, reason: r.reason });      // no unit of that kind is left: nothing is invented, the GM sees the note
  }
  for (const d of (Array.isArray(res.damage) ? res.damage : []).slice(0, 24)) {
    const c = X.facts.c(d?.target), amount = Math.max(0, Math.trunc(Number(d?.amount) || 0));
    if (c && amount) await perform(X, I.tx, { t: "actor", uuid: c.actorUuid, path: "health", to: damage.applyDamage({ health: c.health, taken: amount }).health, tx: I.tx }, I, "manual");   // [B2708]: never below 0
  }
  for (const d of (Array.isArray(res.stress) ? res.stress : []).slice(0, 24)) {
    const c = X.facts.c(d?.target), n = Math.max(0, Math.trunc(Number(d?.amount) || 0));
    if (c && n) await perform(X, I.tx, { t: "actor", uuid: c.actorUuid, path: "resolve", to: damage.applyStress({ resolve: c.resolve, stress: n }).resolve, tx: I.tx }, I, "manual");
  }
  for (const s of (Array.isArray(res.statuses) ? res.statuses : []).slice(0, 24)) {
    if (!P1.isId(s?.who) || typeof s.id !== "string") continue;
    const w = s.on === false ? M.statusRemove(X.state, s.who, s.id) : M.statusAdd(X.state, s.who, { id: s.id, source: { kind: "gm", name: "manual" } });
    write(X, I.tx, w.path, w.to, I, "manual");
  }
  setInst(X, I);
  await closeInst(X, I, typeof res.result === "string" ? res.result.slice(0, 24) : "manual");
  return ok();
}
/** One GM edit of the state = one transaction of its own (spec 14.2), so every edit is undoable from the journal. */
const editLabel = (X, op, a) => {                                                          // "GM: Health set -> Omni-Man": the edit as a language mark, whom or what it was about by name
  const about = [a?.combatant, a?.challenge, a?.vehicle, a?.observer, a?.subject, a?.token?.holder, a?.prey, a?.pursuer].flat().filter((id) => P1.isId(id)).map((id) => X.facts.c(id)?.name).filter(Boolean);
  const spot = typeof a?.zone === "string" ? a.zone : typeof a?.op?.zone === "string" ? a.op.zone : null;
  return { pub: "", gm: `{ITAC.journal.gm}: {ITAC.edit.${op}}${about.length ? ` -> ${[...new Set(about)].join(", ")}` : ""}${spot ? ` @ {zone:${spot.slice(0, 60)}}` : ""}` };
};
async function gmEdit(X, op, a) {
  const tx = openTx(X, { label: editLabel(X, op, a) });
  const w = (path, to) => write(X, tx, path, to);
  const c = (id) => (P1.isId(id) ? X.facts.c(id) : null);
  let err = null, errParams = {};
  switch (op) {
    case "statusAdd": if (c(a.combatant) && typeof a.status?.id === "string") { const x = M.statusAdd(X.state, a.combatant, { ...a.status, source: a.status.source ?? { kind: "gm", name: "gm" } }); w(x.path, x.to); } else err = "badInput"; break;
    case "statusRemove": if (P1.isId(a.combatant)) { const x = M.statusRemove(X.state, a.combatant, String(a.id)); w(x.path, x.to); } else err = "badInput"; break;
    case "setHealth": case "setResolve": {
      const cc = c(a.combatant), v = Math.trunc(Number(a.value));
      if (!cc || !Number.isFinite(v) || v < 0) { err = "badInput"; break; }
      await perform(X, tx, { t: "actor", uuid: cc.actorUuid, path: op === "setHealth" ? "health" : "resolve", to: v, tx });
      break;
    }
    case "tokenAdd": { const t = M.makeToken({ ...a.token, id: a.token?.id ?? nextId(X, "t") }); if (t && c(t.holder)) w(["tokens", `#${t.id}`], t); else err = "badInput"; break; }
    case "tokenRemove": if (P1.isId(a.id)) w(["tokens", `#${a.id}`], null); else err = "badInput"; break;
    case "triggerAdd": { const t = isObj(a.trigger) ? S.sanitizeTrigger({ ...J.clone(a.trigger), id: P1.isId(a.trigger.id) ? a.trigger.id : nextId(X, "g"), source: M.source(a.trigger.source), runs: 0 }) : null; if (t) w(["triggers", `#${t.id}`], t); else err = "badInput"; break; }
    case "triggerRemove": if (P1.isId(a.id)) w(["triggers", `#${a.id}`], null); else err = "badInput"; break;
    case "counterSet": if (typeof a.key === "string" && /^(round|scene|zone|session):[\w.:@-]{1,56}$/.test(a.key) && Number.isFinite(a.value)) w(["counters", a.key], a.value > 0 ? Math.trunc(a.value) : null); else err = "badInput"; break;
    case "effectAdd": { const e = M.makeEffect({ ...a.effect, id: a.effect?.id ?? nextId(X, "f") }); if (e) w(["effects", `#${e.id}`], e); else err = "badInput"; break; }
    case "effectEnd": { const ws = P1.isId(a.id) ? M.effectEndWrites(X.state, a.id) : []; if (ws.length) { for (const x of ws) w(x.path, x.to); emit(X, null, { type: "effectEnd", effect: { id: a.id } }); } else err = "gone"; break; }
    case "powerGrant": {
      const e = C.sanitizeEntry(a.entry);
      if (!e || !c(a.combatant)) { err = "badInput"; break; }
      const id = nextId(X, "f");
      w(["effects", `#${id}`], M.makeEffect({ id, kind: "borrowedPower", holder: a.combatant, source: a.source ?? { kind: "gm", name: e.id }, data: { entry: e }, ends: a.ends ?? { at: "sceneEnd" } }));
      break;
    }
    case "powerRevoke": { const ids = (X.state.effects ?? []).filter((e) => e.kind === "borrowedPower" && e.holder === a.combatant && e.data?.entry?.id === a.id).map((e) => e.id); if (ids.length) for (const id of ids) w(["effects", `#${id}`], null); else err = "gone"; break; }
    case "itemState": { const it = M.makeGroundItem({ ...a.item, id: a.item?.id ?? nextId(X, "i") }); if (it) w(["items", `#${it.id}`], a.remove ? null : it); else err = "badInput"; break; }
    case "reveal": if (c(a.combatant)) { const r = {}; for (const k of ["stats", "powers", "health"]) if (a[k]) r[k] = 1; w(["revealed", a.combatant], Object.keys(r).length ? r : null); } else err = "badInput"; break;
    case "knowledgeSet": if (P1.isId(a.observer) && P1.isId(a.subject) && ["seen", "unseen", null].includes(a.value ?? null)) w(["knowledge", a.observer, a.subject], a.value ?? null); else err = "badInput"; break;
    case "karmaNote": if (isObj(a.note) && ["wreckedZone", "savedBystanders", "failedBystanders", "killed"].includes(a.note.kind)) w(["karma"], [...X.state.karma, { id: nextId(X, "k"), who: String(a.note.who ?? "").slice(0, 40), kind: a.note.kind, round: X.state.round, zone: typeof a.note.zone === "string" ? a.note.zone.slice(0, 40) : undefined, note: typeof a.note.note === "string" ? a.note.note.slice(0, 300) : undefined }]); else err = "badInput"; break;
    case "npcPolicy": if (P1.isId(a.combatant) && isObj(a.policy)) { const pol = {}; for (const k of ["block", "dodge"]) if (["ask", "always", "never"].includes(a.policy[k])) pol[k] = a.policy[k]; if (["ask", "never"].includes(a.policy.push)) pol.push = a.policy.push; if (["ask", "ko", "kill", "crit"].includes(a.policy.onBroken)) pol.onBroken = a.policy.onBroken; if (typeof a.policy.major === "boolean") pol.major = a.policy.major; if (["defence", "turn"].includes(a.policy.keepQuickFor)) pol.keepQuickFor = a.policy.keepQuickFor; w(["npc", a.combatant], pol); } else err = "badInput"; break;
    case "ledgerEdit": {                                                                    // one implementation with the reducer's operation (ops-pure.ledgerEditOf); here it is journaled
      if (!P1.isId(a.combatant) || !X.state.ledger[a.combatant]) { err = "gone"; break; }
      const legacy = a.edit ? a : P1.isId(a.voidEntry) ? { ...a, edit: "void", entry: a.voidEntry } : isObj(a.grant) ? { ...a, edit: "grant", grant: { template: "gm", ...a.grant } } : null;
      const r = legacy ? ledgerEditOf(X.state, legacy) : null;
      if (!r?.ok) { err = r?.code ?? "badInput"; errParams = r?.params ?? {}; break; }
      w(["ledger", a.combatant], r.ledger);
      if (r.consent) openPrompt(X, null, { key: "c", kind: "grantConsent", to: addresseeOf(X, a.combatant), about: a.combatant, options: [{ id: "yes", label: "yes" }, { id: "no", label: "no" }], data: { combatant: a.combatant, grant: r.consent.id, kind: r.consent.kind, from: r.consent.from ?? null } }, "grant");   // [plan 5.3], [B1708]
      break;
    }
    case "setFree": if (a.combatant == null) w(["free"], a.on ? Object.fromEntries(Object.keys(X.state.ledger).map((k) => [k, 1])) : {}); else if (P1.isId(a.combatant)) w(["free", a.combatant], a.on ? 1 : null); else err = "badInput"; break;
    case "setMode": {
      if (!["tactical", "free", "off"].includes(a.mode)) { err = "badInput"; break; }
      if (w(["mode"], a.mode)) emit(X, null, { type: "mode", mode: a.mode });
      if (a.mode !== "tactical") X.state = { ...X.state, stack: X.state.stack.map((i) => ({ ...i, status: "manual" })) };       // spec 14.5: nothing is discarded, open instances are parked as manual
      break;
    }
    case "zoneSet": case "levelSet": case "borderSet": case "zoneOp": {                    // one write of the zones API; the inverse it returns is journaled (zones-pure.mjs)
      const zop = op === "zoneSet" ? ZP.zoneOp(a.zone, a.patch) : op === "levelSet" ? ZP.levelOp(ZP.tokenIdOf(c(a.combatant)?.tokenUuid ?? a.token), a.to)
        : op === "borderSet" ? ZP.borderOp(a.border, a) : ZP.validOp(a.zop) ? J.clone(a.zop) : null;
      if (!zop) { err = "badInput"; break; }
      const res = await perform(X, tx, { t: "zones", op: zop, tx });
      if (res && res.ok === false) { err = "illegal"; errParams = { reason: String(res.reason ?? "zones").slice(0, 40) }; break; }
      emit(X, null, { type: "zoneChange", ...ZP.changeOf(zop), cause: "gm" });
      break;
    }
    /* ---- P7: challenges, vehicles, chases. Each is one undoable transaction like every other GM edit. */
    case "challengeSetup": {                                                                // a book preset (or none) for a challenge in the fight: its options, its side effects as waiting triggers [R22]
      const cc = c(a.challenge), preset = Challenge.PRESETS.includes(a.preset) ? a.preset : null;
      if (!cc || cc.kind !== "challenge") { err = "badInput"; break; }
      const heroes = (X.host.parts?.() ?? []).filter((p) => p.hero && !p.defeated && !p.summonOf).map((p) => p.id);
      const plan = Challenge.setup(preset, { challenge: a.challenge, name: cc.name, zone: X.facts.zone?.(a.challenge)?.key ?? null, heroes });
      for (const g of (X.state.triggers ?? []).filter((t) => t.run?.challenge === a.challenge)) w(["triggers", `#${g.id}`], null);
      w(["challenges", a.challenge], a.clear === true ? null : { ...plan.config, name: String(cc.name ?? "").slice(0, 80), manual: plan.manual });
      if (a.clear !== true) for (const t of plan.triggers) { const g = S.sanitizeTrigger({ ...t, id: nextId(X, "g"), source: M.source(t.source), runs: 0 }); if (g) w(["triggers", `#${g.id}`], g); }
      const zop = a.clear !== true && plan.zone ? ZP.zoneOp(plan.zone.key, plan.zone.patch) : null;
      if (zop) { const res = await perform(X, tx, { t: "zones", op: zop, tx }); if (!(res && res.ok === false)) emit(X, null, { type: "zoneChange", ...ZP.changeOf(zop), cause: "gm" }); }
      emit(X, null, { type: "challenge", challenge: a.challenge, rating: cc.health, timeLeft: cc.resolve, state: "setup", preset });
      break;
    }
    case "vehicleSet": {                                                                    // who sits where, and the state of the machine [B2936]
      const vf = c(a.vehicle);
      if (!vf || vf.kind !== "vehicle") { err = "badInput"; break; }
      const fx = (list) => { for (const e of list) { if (e.t === "state") w(e.path, e.to); else { const x = e.t === "status+" ? M.statusAdd(X.state, e.who, e.status) : M.statusRemove(X.state, e.who, e.id); w(x.path, x.to); } } };
      if (isObj(a.seat)) {
        const who = a.seat.who, role = ["driver", "passenger"].includes(a.seat.role) ? a.seat.role : null, ride = P1.isId(who) ? Vehicle.rideOf(X.state, who) : null;
        if (!c(who) || ["vehicle", "challenge"].includes(c(who).kind)) { err = "badInput"; break; }
        if (ride && ride.vehicle !== a.vehicle) fx(Vehicle.seatEffects(X.state, who, ride.vehicle, null));
        if (role || ride?.vehicle === a.vehicle) fx(Vehicle.seatEffects(X.state, who, a.vehicle, role));
        emit(X, null, { type: "vehicle", vehicle: a.vehicle, who, state: role ? "entered" : "left", role: role ?? undefined });
      }
      const flag = (path, v) => { if (typeof v === "boolean") w(["vehicles", a.vehicle, ...path], v ? 1 : null); };
      flag(["started"], a.started); flag(["wrecked"], a.wrecked); flag(["destroyed"], a.wrecked === false ? false : undefined); flag(["off", "engine"], a.engineOff); flag(["off", "weapon"], a.weaponOff);
      if (a.wrecked === true || a.engineOff === true) w(["vehicles", a.vehicle, "started"], null);
      if (Number.isFinite(a.hits)) w(["vehicles", a.vehicle, "hits"], Math.max(0, Math.min(99, Math.trunc(a.hits))) || null);
      break;
    }
    case "chaseStart": {                                                                    // fight -> chase [B3412]: the cards go, the tokens stand in the off-map place of the map
      if (X.state.stack.length || X.state.phase !== "turns") { err = "busy"; break; }
      const plan = Chase.startPlan(X.state, X.facts, a, Number(X.host.setting?.("tacticsChaseLostAt")) || undefined);
      if (!plan.ok) { err = "illegal"; errParams = { reason: plan.reason }; break; }
      w(["chase"], plan.chase); w(["kind"], "chase"); w(["init"], { ...S.newInit(), deck: X.state.init?.deck ?? 10 });
      X.state = { ...X.state, init: { ...X.state.init, cur: X.state.init.cur ?? null, curMember: X.state.init.curMember ?? null } };       // the journal writes "nobody" by removing the key; the state keeps it as null
      for (const p of plan.puts) await perform(X, tx, { t: "zput", who: p.who, to: "@chase", group: p.group, tx });
      emit(X, null, { type: "chase", state: "start", distance: plan.chase.distance, sides: plan.chase.sides });
      break;
    }
    case "chaseSet": {
      const next = Chase.setPatch(X.state, a);
      if (!next) { err = "gone"; break; }
      if (P1.isId(a.unit)) {                                                                 // somebody joins or drops out: the token follows, and the way back is remembered [D]
        const was = Chase.chaseOf(X.state).back?.[a.unit], spot = X.facts.zone?.(a.unit)?.spot, group = Vehicle.occupants(X.state, a.unit), back = { ...(next.back ?? {}) };
        if (a.side && typeof spot === "string" && !spot.startsWith("@")) { back[a.unit] = spot; await perform(X, tx, { t: "zput", who: a.unit, to: "@chase", group, tx }); }
        else if (!a.side && typeof was === "string") { delete back[a.unit]; await perform(X, tx, { t: "zput", who: a.unit, to: was, group, tx }); }
        next.back = back;
      }
      w(["chase"], next); emit(X, null, { type: "chase", state: "set", distance: next.distance });
      break;
    }
    case "chaseEnd": {                                                                      // chase -> fight (or its end) [B3436]: everyone back where the chase began; the round driver deals the cards
      const ch = Chase.chaseOf(X.state);
      if (!ch) { err = "gone"; break; }
      if (X.state.stack.length) { err = "busy"; break; }
      for (const p of Chase.endPlan(X.state).puts) await perform(X, tx, { t: "zput", who: p.who, to: p.to, group: p.group, tx });
      w(["kind"], "combat"); w(["chase"], null);
      emit(X, null, { type: "chase", state: "end", outcome: Chase.OUTCOMES.includes(a.outcome) ? a.outcome : "combat", distance: ch.distance });
      break;
    }
    default: err = "unknown";
  }
  if (err) { const t = X.state.txOpen[tx]; await undoOps(X, t.ops); const { [tx]: _g, ...rest } = X.state.txOpen; X.state = { ...X.state, txOpen: rest }; return bad(err, errParams); }
  closeTx(X, tx, editLabel(X, op, a));
  emit(X, null, { type: "override", op, gmOnly: 1 });
  return ok();
}
async function opUndo(X, a) {
  const order = J.undoOrder(X.log, a.tx);
  if (!order) return bad("gone");
  if (X.state.stack.length) return bad("busy");                                             // undo re-opens nothing and never runs under a live action
  const list = a.force === true ? [a.tx] : order;                                           // spec 15: LIFO by default; a forced single undo behind a drift check
  const mode = ["restore", "difference", "leave"].includes(a.drift) ? a.drift : null;
  if (a.force === true) {
    const tx = X.log.list.find((t) => t.id === a.tx), drifts = [];
    for (const op0 of tx.ops) {
      const op = liveOp(X, op0, tx.round);
      const cur = op.t === "state" ? X.state : op.t === "actor" ? X.facts.actorValue?.(op.uuid, op.path) : undefined;
      const d = cur === undefined ? null : J.driftOf(op, cur);
      if (d) drifts.push({ t: op.t, path: op.t === "state" ? d.path : op.path, uuid: op.uuid, expected: d.expected, current: d.current });
    }
    if (drifts.length && !mode) return bad("drift", { list: drifts.slice(0, 20) });
  }
  for (const id of list) {
    const tx = X.log.list.find((t) => t.id === id);
    for (const op0 of [...tx.ops].reverse()) {
      const op = liveOp(X, op0, tx.round);
      if (op.t === "state") {
        if (a.force && mode === "leave" && J.driftOf(op, X.state)) continue;
        X.state = J.applyStateOp(X.state, op, true);
      } else if (op.t === "actor" && a.force) {
        const cur = X.facts.actorValue?.(op.uuid, op.path), to = cur !== undefined && J.driftOf(op, cur) ? J.resolveDrift(op, cur, mode ?? "restore") : op.from;
        if (to !== undefined) await X.host.perform({ t: "actor", uuid: op.uuid, path: op.path, to, undo: 1 });
      } else { const eff = J.inverseEffect(op); if (eff) await X.host.perform({ ...eff, undo: 1 }); }
    }
    X.log = J.markUndone(X.log, id, X.host.now());
    emit(X, null, { type: "undo", tx: id });
  }
  X.facts = liveFacts(X); X.changed = true;
  return ok({ undone: list });
}
async function opHazard(X, a) {
  const h = isObj(a.hazard) ? { kind: String(a.hazard.kind), intensity: Math.max(1, Math.min(12, Math.trunc(Number(a.hazard.intensity) || 1))), inZone: a.hazard.inZone !== false, amount: Math.max(0, Math.trunc(Number(a.hazard.amount) || 0)), armor: a.hazard.armor === true, source: typeof a.hazard.source === "string" ? a.hazard.source.slice(0, 24) : undefined, cause: a.hazard.cause, id: String(a.hazard.id ?? a.hazard.kind).slice(0, 40), zone: typeof a.hazard.zone === "string" ? a.hazard.zone.slice(0, 40) : undefined } : null;
  const inst = makeInst(X, { action: "hazard", actor: null, decl: { action: "hazard", targets: (Array.isArray(a.targets) ? a.targets : []).filter(P1.isId).slice(0, 40), helpers: [], exploits: [], stressTotal: 0 }, cause: a.cause === "trigger" ? "trigger" : "gm", flow: "hazard", data: { hazard: h }, initiator: { type: "hazard", id: h?.id ?? "hazard" }, parent: top(X)?.id ?? null });
  const l = Hazard.legality(view(X), inst);
  if (!l.ok) return bad("illegal", { reason: l.reason });
  inst.tx = openTx(X, { inst: inst.id });
  if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); inst.cause = "trigger"; }
  pushInst(X, inst);
  if (!a.quiet) emit(X, inst, { type: "trigger", at: a.at ?? "gm", subject: { zone: h.zone }, run: { type: h.kind } });
  return ok({ inst: inst.id });
}

/** P7, GM op: one round of the chase [B3432] as an instance (flows/chase.mjs). */
async function opChaseRound(X) {
  if (X.state.stack.length) return bad("busy");
  const spec = Chase.roundSpec();
  const inst = makeInst(X, { action: spec.action, actor: null, decl: spec.decl, cause: "gm", flow: spec.flow });
  const l = FLOWS[inst.flow].legality(view(X), inst);
  if (!l.ok) return bad("illegal", { reason: l.reason, ...l.params });
  inst.tx = openTx(X, { inst: inst.id });
  pushInst(X, inst);
  emit(X, inst, { type: "actionDeclared", decl: { action: spec.action }, cost: "none", stress: 0, targets: [] });
  return ok({ inst: inst.id });
}
/* P7 [R22] [I12] [B2841]: the end of a round runs the clock of every challenge down by one. One transaction per challenge, so the GM can
   take a tick back; at 0 the "time is up" card of the round driver opens (its answer `run` comes back as the effect `challengeFail`).
   The end-of-round side effects that are due are GM-run instances. Off with the world setting `challengesCombatTime`. */
async function challengeClock(X) {
  if (X.host.setting?.("challengesCombatTime") === false) return;
  for (const p of (X.host.parts?.() ?? []).filter((x) => x.challenge && !x.defeated)) {
    const c = X.facts.c(p.id), r = Challenge.clock(c, Challenge.cfgOf(X.state, p.id));
    if (!r) continue;
    if (r.to != null && r.to !== c.resolve) {
      const tx = openTx(X, {});
      await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "resolve", to: r.to, tx });
      closeTx(X, tx, { pub: `${c.name ?? ""}: {ITAC.journal.clock} ${r.to}`, gm: `${c.name ?? ""}: {ITAC.journal.clock} ${c.resolve} -> ${r.to}` });
      emit(X, null, { type: "challenge", challenge: p.id, rating: c.health, timeLeft: r.to, state: r.failed ? "failed" : "active", clock: 1 });
    }
    if (r.failed && !Object.values(X.state.prompts).some((q) => q.kind === "challengeFail" && q.about === p.id && !q.answered))
      openPrompt(X, null, { key: "cf", kind: "challengeFail", to: "gm", about: p.id, options: [{ id: "run", label: "run" }, { id: "other", label: "other" }], data: { effects: Challenge.failKinds(Challenge.cfgOf(X.state, p.id)) } }, "roundEnd");
    for (const kind of r.effects) pushManual(X, p.id, kind, { at: "roundEnd" });
  }
}
/* "Run the consequence" of a challenge whose time ran out [B2841]: the ward resets by itself [B2876]; what the engine has no flow for
   becomes a GM-run instance that names it. */
async function challengeFailRun(X, cid) {
  const c = P1.isId(cid) ? X.facts.c(cid) : null, cfg = Challenge.cfgOf(X.state, cid);
  if (!c || c.kind !== "challenge") return;
  const r = Challenge.failRun(c, cfg);
  if (r.ward) {
    const tx = openTx(X, {});
    await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "health", to: r.ward.rating, tx });
    await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "resolve", to: r.ward.time, tx });
    write(X, tx, ["challenges", cid, "dice"], r.ward.dice); write(X, tx, ["challenges", cid, "resets"], r.ward.resets); write(X, tx, ["challenges", cid, "started"], {});
    closeTx(X, tx, { pub: `${c.name ?? ""}: {ITAC.journal.wardReset}`, gm: `${c.name ?? ""}: {ITAC.journal.wardReset} (${r.ward.dice})` });
    emit(X, null, { type: "challenge", challenge: cid, rating: r.ward.rating, timeLeft: r.ward.time, state: "reset", dice: r.ward.dice });
  }
  for (const kind of r.manual) pushManual(X, cid, kind, { at: "onFail" });
}
/** A side effect the GM runs by hand (spec 5.3): an instance that names it, with the challenge as its source. */
function pushManual(X, cid, kind, o = {}) {
  const name = X.facts.c(cid)?.name ?? cid;
  const inst = makeInst(X, { action: "other", actor: null, decl: { action: "other", targets: [], helpers: [], exploits: [], stressTotal: 0, text: `${name}: ${kind}`.slice(0, 300) }, cause: "trigger", flow: "other",
    data: { trigger: { at: o.at ?? null, run: { type: "challenge", kind, challenge: cid }, source: { kind: "challenge", owner: cid, name } } }, initiator: { type: "trigger", id: String(kind).slice(0, 40) }, parent: top(X)?.id ?? null });
  inst.tx = openTx(X, { inst: inst.id }); inst.status = "manual";
  if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); }
  pushInst(X, inst);
}

/** P3, GM ops: a forced move (Knockback, Slam, anything that throws a character [B2435], [B2494]) or a fall [B2391] of one combatant, as
    an instance of its own (or on top of the open action). { op:"forcedMove", combatant, awayFrom | toward: combatant id or spot, direction?: { angle } | { dx, dy },
    distance, damage?, kind? } / { op:"fall", combatant, canGrab?, immune? } */
async function opForced(X, op, a) {
  if (!P1.isId(a.combatant) || !X.facts.c(a.combatant)) return bad("badInput");
  const ref = (x) => (typeof x === "string" && x.length <= 60 ? x : undefined), n = (x, hi) => Math.max(0, Math.min(hi, Math.trunc(Number(x) || 0)));
  const dir = a.direction === "up" || a.direction === "down" ? a.direction : isObj(a.direction) ? (Number.isFinite(a.direction.angle) ? { angle: a.direction.angle } : Number.isFinite(a.direction.dx) && Number.isFinite(a.direction.dy) ? { dx: a.direction.dx, dy: a.direction.dy } : undefined) : undefined;
  const spec = op === "fall" ? Move.fallChild(a.combatant, { canGrab: a.canGrab === true, immune: a.immune === true })
    : Move.forcedChild(a.combatant, { awayFrom: ref(a.awayFrom), toward: ref(a.toward), direction: dir, distance: Math.max(1, n(a.distance, 12)), damage: n(a.damage, 99), by: P1.isId(a.by) ? a.by : undefined, kind: ["knockback", "slam"].includes(a.kind) ? a.kind : "forced" });
  const inst = makeInst(X, { action: spec.action, actor: null, decl: spec.decl, cause: "gm", flow: spec.flow, data: spec.data, initiator: spec.initiator, parent: top(X)?.id ?? null });
  const l = FLOWS[inst.flow].legality(view(X), inst);
  if (!l.ok) return bad("illegal", { reason: l.reason });
  inst.tx = openTx(X, { inst: inst.id });
  if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); inst.cause = "trigger"; }
  pushInst(X, inst);
  return ok({ inst: inst.id });
}

/** P5, GM op: a hazard the GM (or a trigger) sets off: { op:"hazardRun", run: { type: "blast" | "area" | "fireSpread" | "vacuum" | "disease", ... }, subject?: { zone?, combatant? } }
    (flows/hazards.mjs specOf). As every hazard it is an instance of its own, or sits on top of the open action. */
async function opHazardRun(X, a) {
  const spec = Hz.specOf(isObj(a.run) ? a.run : null, isObj(a.subject) ? a.subject : {}, view(X));
  if (!spec) return bad("badInput");
  const inst = makeInst(X, { action: spec.action, actor: null, decl: spec.decl, cause: a.cause === "trigger" ? "trigger" : "gm", flow: spec.flow, data: spec.data, initiator: spec.initiator, parent: top(X)?.id ?? null });
  const l = FLOWS[inst.flow].legality(view(X), inst);
  if (!l.ok) return bad("illegal", { reason: l.reason });
  inst.tx = openTx(X, { inst: inst.id });
  if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); inst.cause = "trigger"; }
  pushInst(X, inst);
  if (!a.quiet) emit(X, inst, { type: "trigger", at: a.at ?? "gm", subject: { zone: spec.decl.zone }, run: { type: spec.action } });
  return ok({ inst: inst.id });
}

/* ------------------------------------------------------------------ what the round driver hands over (ops-pure.mjs effects; director-pure.mjs)
   { type:"stress", combatant, n, source }   voluntary stress of a round decision (Combat Veteran [I7] [B2100]): one transaction, undoable
   { type:"recover", lines }                 the end-of-scene recovery (spec 6.8): one transaction; a value that changed meanwhile is left alone
   { type:"abortInstances", actor }          a combatant left the fight: its open instances end, refunded (spec 3.3)
   { type:"trigger", trigger }               a due trigger the GM let run: its own action instance (spec 6.1). [D] How `run` is read:
       run.type "hazard"      { hazard: { kind, intensity?, amount?, ... }, targets? }   -> flow hazard
       run.type "fireAttack"  { intensity, targets? }                                     -> flow hazard, kind fire [B2925]
       anything else (the rows of spec 6.1 the later packages bring)                      -> a GM-driven instance ("resolve manually", spec 5.3)
     targets default to the trigger's subject combatant, else to facts.inZoneKey?.(subject.zone). Triggers are pushed last first, so the first runs first. */
async function system(X, effects) {
  const triggers = [];
  for (const fx of Array.isArray(effects) ? effects : []) {
    if (fx?.type === "stress") {
      const c = X.facts.c(fx.combatant), n = Math.max(0, Math.trunc(Number(fx.n) || 0));
      if (!c || !n) continue;
      const s = damage.applyStress({ resolve: c.resolve, stress: n });                      // [B2816]
      if (!s.lost) continue;
      const tx = openTx(X, {});
      await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "resolve", to: s.resolve, tx });
      closeTx(X, tx, { pub: "", gm: `${c.name ?? ""}: {ITAC.journal.stress} ${n} (${String(fx.source ?? "").slice(0, 40)})` });
    } else if (fx?.type === "recover") {
      const tx = openTx(X, {});
      for (const l of Array.isArray(fx.lines) ? fx.lines : []) {
        const c = X.facts.c(l?.id);
        if (!c) continue;
        if (l.health && l.health.to !== l.health.from && c.health === l.health.from) await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "health", to: l.health.to, tx });
        if (l.resolve && l.resolve.to !== l.resolve.from && c.resolve === l.resolve.from) await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "resolve", to: l.resolve.to, tx });
      }
      closeTx(X, tx, { pub: "", gm: "{ITAC.journal.sceneEnd}" });
    } else if (fx?.type === "abortInstances") {
      for (const inst of [...X.state.stack].reverse()) if (inst.actor === fx.actor && instOf(X, inst.id)) await abortInst(X, inst.id, true);
      dropPrompts(X, (p) => p.about === fx.actor);
    } else if (fx?.type === "roundEnd") await challengeClock(X);                          // P7
    else if (fx?.type === "challengeFail") await challengeFailRun(X, fx.challenge);
    else if (fx?.type === "trigger" && isObj(fx.trigger)) triggers.push(fx.trigger);
  }
  for (const t of triggers.reverse()) await pushTrigger(X, t);
}
async function pushTrigger(X, t) {
  const run = isObj(t.run) ? t.run : {}, sub = isObj(t.subject) ? t.subject : {};
  const hz = run.type === "hazard" && isObj(run.hazard) ? run.hazard : run.type === "fireAttack" ? { kind: "fire", intensity: run.intensity, inZone: run.inZone !== false } : null;
  if (hz) {
    const targets = Array.isArray(run.targets) ? run.targets : P1.isId(sub.combatant) ? [sub.combatant] : X.facts.inZoneKey?.(sub.zone) ?? [];
    const r = await opHazard(X, { hazard: { ...hz, id: t.id, zone: sub.zone, cause: "trigger" }, targets, cause: "trigger", at: t.at, quiet: true });
    if (r.ok) { const I = J.clone(instOf(X, r.inst)); I.data.trigger = { id: t.id, at: t.at }; I.cause = "trigger"; setInst(X, I); return; }
  }
  if (Hz.TYPES.includes(run.type)) {                                                        // P5: the hazards of flows/hazards.mjs
    const r = await opHazardRun(X, { run, subject: sub, cause: "trigger", at: t.at, quiet: true });
    if (r.ok) { const I = J.clone(instOf(X, r.inst)); I.data.trigger = { id: t.id, at: t.at }; I.cause = "trigger"; setInst(X, I); return; }
  }
  if (run.type === "challengeRoll" && P1.isId(sub.combatant)) {                           // P7: a side effect that asks a roll of the character (the toxin [B2889])
    const spec = Challenge.effectChild(sub.combatant, run, { id: t.id, at: t.at });
    const inst = makeInst(X, { action: spec.action, actor: null, decl: spec.decl, cause: "trigger", flow: spec.flow, data: spec.data, initiator: spec.initiator, parent: top(X)?.id ?? null });
    if (FLOWS[inst.flow].legality(view(X), inst).ok) {
      inst.tx = openTx(X, { inst: inst.id });
      if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); }
      pushInst(X, inst); return;
    }
  }
  const actor = P1.isId(sub.combatant) && X.facts.c(sub.combatant) ? sub.combatant : null;
  const inst = makeInst(X, { action: "other", actor, decl: { action: "other", targets: [], helpers: [], exploits: [], stressTotal: 0, text: String(t.source?.name || run.type || "").slice(0, 300) }, cause: "trigger", flow: "other",
    data: { trigger: { id: t.id, at: t.at, run: J.clone(run), source: J.clone(t.source ?? null) } }, initiator: { type: "trigger", id: String(t.id ?? "trigger").slice(0, 40) }, parent: top(X)?.id ?? null });
  inst.tx = openTx(X, { inst: inst.id }); inst.status = "manual";
  if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); }
  pushInst(X, inst);
}

export const PLAYER_OPS = Object.freeze(["declare", "amend", "cancel", "answer", "help", "move", "exception", "other"]);       // endTurn, holdOff, mark: director-pure.mjs
export const GM_INST_OPS = Object.freeze(["setPool", "setSixes", "setOutcome", "setDamage", "skipStep", "goToStep", "abort", "manual", "retarget"]);
export const GM_EDIT_OPS = Object.freeze(["ledgerEdit", "statusAdd", "statusRemove", "setHealth", "setResolve", "tokenAdd", "tokenRemove", "triggerAdd", "triggerRemove", "counterSet", "effectAdd", "effectEnd",
  "powerGrant", "powerRevoke", "itemState", "reveal", "knowledgeSet", "karmaNote", "npcPolicy", "setFree", "setMode", "zoneSet", "levelSet", "borderSet", "zoneOp",
  "challengeSetup", "vehicleSet", "chaseStart", "chaseSet", "chaseEnd"]);                                                                    // P7
export const GM_OPS = Object.freeze([...GM_INST_OPS, ...GM_EDIT_OPS, "answerFor", "undo", "hazard", "forcedMove", "fall", "hazardRun", "chaseRound"]);       // the initiative and round operations of spec 14.2 are the director's (director-pure.mjs)

async function request(X, req) {
  const op = req?.op;
  if (GM_OPS.includes(op) && !X.user.staff) return bad("noPermission");
  switch (op) {
    case "declare": return opDeclare(X, req);
    case "amend": return opAmend(X, req);
    case "cancel": return opCancel(X, req);
    case "answer": return opAnswer(X, req);
    case "answerFor": return opAnswer(X, req, true);
    case "help": return opHelp(X, req);
    case "exception": return opAsk(X, req, "exception");
    case "other": return opAsk(X, req, "other");
    case "move": return opDeclare(X, { actor: req.actor, gm: req.gm, decl: { ...(isObj(req.decl) ? req.decl : {}), action: typeof req.action === "string" ? req.action : "move", to: req.to, mode: req.mode, stress: req.stress, pay: req.pay, force: req.force, carry: req.carry, airborne: req.airborne } });   // P3: a move is a declaration like any other
    case "forcedMove": case "fall": return opForced(X, op, req);
    case "undo": return opUndo(X, req);
    case "hazard": return opHazard(X, req);
    case "hazardRun": return opHazardRun(X, req);
    case "chaseRound": return opChaseRound(X);
    default:
      if (GM_INST_OPS.includes(op)) return gmInstOp(X, op, req);
      if (GM_EDIT_OPS.includes(op)) return gmEdit(X, op, req);
      return bad("badInput", { op: String(op ?? "").slice(0, 24) });
  }
}
function takeRoll(X, r) {
  const inst = instOf(X, r.inst), rec = inst?.rolls?.[r.key];
  if (!rec?.req || rec.req.rid !== r.rid || rec.forced != null) return false;
  const author = X.facts.user(r.author);
  if (!author || !(author.staff || rec.req.users.includes(r.author))) return false;         // spec 11: identity = the message author, checked against the user the roll was asked from
  if (!Number.isFinite(r.sixes) || r.sixes < 0) return false;
  const I = J.clone(inst);
  I.rolls[r.key] = { ...rec, sixes: Math.trunc(r.sixes), ones: Math.max(0, Math.trunc(Number(r.ones) || 0)), pushed: Math.max(0, Math.trunc(Number(r.pushed) || 0)), pushable: r.pushable === true && rec.req.maxPush !== 0, messageId: typeof r.messageId === "string" ? r.messageId : rec.messageId };
  setInst(X, I);
  return true;
}

/* ------------------------------------------------------------------ entry point */
export async function handle({ state, log }, input, host) {
  const user = input?.t === "req" ? input.user : null;
  const X = makeX(state, log, host, user);
  let env;
  try {
    if (!state) return { state, log, env: bad("off"), events: [], changed: false };
    if (input?.t === "req") {
      if (!user || !P1.isId(user.id)) return { state, log, env: bad("untrusted"), events: [], changed: false };
      if (input.rid && state.seen.includes(input.rid)) return { state, log, env: { ok: true, changed: false, dup: true }, events: [], changed: false };     // spec 1.3: two tabs of one GM are harmless
      if (state.mode === "off" && !user.staff) return { state, log, env: bad("off"), events: [], changed: false };
      env = await request(X, input.req);
      if (env.ok) { applyHelpAnswers(X); await drive(X); }
    } else if (input?.t === "sys") {
      await system(X, input.effects); env = ok(); await drive(X);
    } else if (input?.t === "roll") {
      env = takeRoll(X, input) ? ok() : bad("badInput");
      if (env.ok) await drive(X);
    } else { env = ok({ changed: false }); await drive(X); }
  } catch (e) {
    env = bad("internal", { msg: String(e?.message ?? e).slice(0, 120) });                  // what was already performed stays journaled in the open transaction
    if (X.changed) env.partial = true;
  }
  if (!X.changed) return { state, log, env: { ...env, changed: false }, events: X.events, changed: false };
  const seen = input?.rid ? [...X.state.seen, input.rid].slice(-P1.SEEN_MAX) : X.state.seen;
  return { state: { ...X.state, rev: (state.rev ?? 0) + 1, seen }, log: X.log, env: env.ok ? { ...env, changed: true } : env, events: X.events, changed: true };
}
/** Read helpers for the API and the checks. */
export const topInstance = (state) => state?.stack?.[state.stack.length - 1] ?? null;
export const openPrompts = (state) => Object.values(state?.prompts ?? {}).filter((p) => !p.answered);
