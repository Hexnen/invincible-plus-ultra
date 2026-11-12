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
  /* D90: `did` counts what was asked of the host (documents, the map, dice), `undid` the inverses among it, `ops` keeps the journal ops the
     host handed back in this call (a request that fails before it is through takes them back), `failed` what the host could not do. */
  const X = { state, log: log ?? J.emptyLog(), host, user: user ?? { id: "engine", staff: true }, facts: null, events: [], changed: false, did: 0, undid: 0, ops: [], failed: [], parked: null };
  X.facts = liveFacts(X);
  return X;
}
/* P7 [B3412]: in a chase there is no map, the range between the sides is the chase distance (flows/chase.mjs reads the state of now) */
const liveFacts = (X) => Chase.facts(X.host.facts(), () => X.state);
const nextId = (X, p) => { X.state = { ...X.state, seq: (X.state.seq ?? 0) + 1 }; return S.idOf(X.state, p, X.state.seq); };      // H3-1: the fight's tag on every id
const view = (X) => ({ state: X.state, facts: X.facts, entry: (inst) => C.entryFor(X.state, inst.actor, inst.action, X.facts) });
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
  X.did++;
  const r = (await X.host.perform(effect)) ?? {};
  if (r.op) { record(X, txId, r.op, inst, step, tag); X.changed = true; X.ops.push(r.op); }
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
  if (tx.ops.length || label?.keep) X.log = J.pushLog(X.log, J.closeTx(tx, label ? { pub: label.pub ?? "", gm: label.gm ?? "", ...(label.pub && isObj(label.who) ? { who: label.who } : {}), ...(label.pub && label.own ? { own: label.own } : {}) } : tx.label));
  X.changed = true;
}
/* [L5] [B2293]: every ledger is new at the start of a round and nothing is carried over. An undo that reaches back over a round boundary
   therefore leaves the ledger writes of the old round alone (they no longer exist); everything else is restored. [D]
   The one thing a ledger does carry over is a lost turn that has not come yet, with its interrupt ban [L7] [B2436]: undoing the Stun that
   took the turn gives it back in whatever round the undo happens. */
const CARRIED = ["lostTurn", "noInterrupts"];                                                // what a new ledger takes over from the old one (ledger-pure.newLedger [L7]): these writes are still alive
const dead = ([p]) => p[0] === "ledger" && !(p.length === 3 && CARRIED.includes(p[2]));
/* D38 (spec 3.3, 15): somebody who has left the fight has no ledger, no statuses, no entry of any per-combatant table (ops-pure.removeOne
   takes them away); an undo gives back what still exists, so the writes into those tables for one who is gone are left out, as the
   writes into the ledgers of a finished round are. (One whom the same undo brings back, a summoned group, is there again by then.) */
const PER_COMBATANT = ["ledger", "statuses", "free", "npc", "revealed", "knowledge"];
const goneOf = (X) => { let f = null; return ([p]) => PER_COMBATANT.includes(p[0]) && p.length >= 2 && !(f ??= X.host.facts()).c(p[1]); };
const liveOp = (X, op, round) => {
  if (op.t !== "state") return op;
  const old = round != null && round !== X.state.round, gone = goneOf(X), out = (w) => (old && dead(w)) || gone(w);
  return op.patch.some(out) || op.inverse.some(out) ? { ...op, patch: op.patch.filter((w) => !out(w)), inverse: op.inverse.filter((w) => !out(w)) } : op;
};
/** Undo a list of ops (newest first). State ops are applied here, document ops go to the host as their inverse request. */
async function undoOps(X, ops, round = null) {
  for (const op0 of [...ops].reverse()) {
    const op = liveOp(X, op0, round);
    if (op.t === "state") X.state = J.applyStateOp(X.state, op, true);
    else { const eff = J.inverseEffect(op); if (eff) await inverse(X, op, eff); }
  }
  X.facts = liveFacts(X); X.changed = true;
}
/* D90 / D99 (spec 15): one inverse asked of the host. One that the host refuses ({ ok:false }: the map said no, the document is gone)
   or that throws (a rejected update) does not stop the others: the writes before it cannot be taken back as one, so the rest is
   still undone and what stayed as it was is NAMED in the answer (`failed`), for the GM to put right by hand. -> true when it was done */
async function inverse(X, op, eff, tx = null) {
  X.did++; X.undid++;
  let reason = null;
  try { const r = await X.host.perform({ ...eff, undo: 1 }); if (r && r.ok === false) reason = String(r.reason ?? "error").slice(0, 40); }
  catch (e) { reason = "error"; warn(X, "inverse", e, { t: op.t }); }
  if (reason) X.failed.push({ ...(tx ? { tx } : {}), t: String(op.t).slice(0, 24), reason });
  return !reason;
}
const warn = (X, what, e, more = {}) => { try { X.host.warn?.(what, e, more); } catch { /* a courtesy */ } };

/* who rolls: the players who own the character and are at the table; NPC rolls and rolls of absent players are made at the GM desk.
   FXP (D160): ONE of them, the acting seat. The roll's chat card is that client's (its author), and only the author may push or accept it
   (Foundry refuses another user's update / delete of the card), so a request to several owners let the first owner online throw it and
   locked out the player who was playing the hero. The acting seat: on the character's own action the owner who declared it (I.by), else
   the owner whose assigned character it is (`player`, Foundry's user.character), else the owner who declared, else the first online. */
export function rollUsers(X, who, I = null) {
  const players = (who?.owners ?? []).filter((u) => !X.facts.user(u)?.staff && X.facts.user(u)?.active !== false);
  if (!who || who.npc || !players.length) return ["gm"];
  const own = I && I.actor === who.id ? [I.by, who.player] : [who.player, I?.by];
  return [own.find((u) => players.includes(u)) ?? players[0]];
}
/* U7: who may see the dice. A secret roll and the roll of a combatant Foundry hides from the players go to the GM alone ("gm"), whatever
   the roller's own chat mode is; every other roll of a fight is public (undefined). The roller's client applies it (system-adapter). */
const rollMode = (e, who) => (e.secret || who?.hidden === true ? "gm" : undefined);

/* ------------------------------------------------------------------ effects of a flow step */
async function applyEffect(X, I, e, step) {
  const tx = I.tx, c = e.who ? X.facts.c(e.who) : null;
  switch (e.t) {
    case "state": write(X, tx, e.path, e.to, I, step); return false;
    case "pay": {
      const r = P1.pay(X.state, e.who, e.cost, { interrupt: !!e.interrupt, defense: !!e.defense, ranged: !!e.ranged, cause: e.cause, force: !!e.force, resolve: c?.resolve, ...(e.grant ? { grant: e.grant } : {}) }, { action: e.action, inst: I.id, tags: e.tags ?? (e.defense ? ["defence"] : []), target: e.target, onTurnOf: e.onTurnOf,
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
    case "status+": {
      const w = M.statusAdd(X.state, e.who, e.status); write(X, tx, w.path, w.to, I, step);
      if (e.status?.id === "dead" && c && !c.defeated) await perform(X, tx, { t: "defeated", combatant: e.who, on: true, tx }, I, step);      // FXP (D163): the dead are marked defeated in the tracker (undone with the step)
      return false;
    }
    case "status-": { const w = M.statusRemove(X.state, e.who, e.id); write(X, tx, w.path, w.to, I, step); return false; }
    case "fx": if (c) await perform(X, tx, { t: "fx", uuid: c.actorUuid, item: e.item, fx: e.fx, on: e.on === true, tx }, I, step); return false;      // P6: an item's active effect (a form, a size)
    case "crit": if (c) await perform(X, tx, { t: "critAdd", uuid: c.actorUuid, n: e.n, id: e.id, tx }, I, step); return false;
    case "dice": { const faces = await perform(X, tx, { t: "dice", n: e.n, why: e.key, ...(e.sides > 0 ? { sides: Math.trunc(e.sides) } : {}) }, I, step); (I.data.res ??= {})[e.key] = Array.isArray(faces) ? faces : []; return true; }
    case "roll": {
      const rid = nextId(X, "r");
      const who = e.who === "hazard" ? null : X.facts.c(e.who);
      const users = rollUsers(X, who, I), mode = rollMode(e, who);
      I.rolls[e.key] = { key: e.key, who: e.who, attr: e.attr, pool: e.pool, pushed: 0, pushable: false, ...(e.secret ? { secret: 1 } : {}), req: { rid, users, at: X.host.now(), dice: e.dice, maxPush: e.maxPush, label: e.label ?? null, ...(mode ? { mode } : {}) } };
      const res = await perform(X, tx, { t: "rollRequest", inst: I.id, key: e.key, rid, users, actorUuid: who?.actorUuid ?? null, combatant: e.who, attr: e.attr, pool: e.pool, dice: e.dice, maxPush: e.maxPush, secret: e.secret, label: e.label, ...(mode ? { mode } : {}) }, I, step);
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
    /* P6 [B1808]: a summoned group arrives beside its owner, or leaves; [B1637] a combatant acts for another from now on. Documents of the
       table: the host creates, removes or marks them and hands back the op that undoes it. The round driver follows (director-pure.mjs). */
    case "summon": { const res = await perform(X, tx, { t: "summonCreate", owner: e.who, members: e.members, item: e.item ?? null, delayed: e.delayed ? 1 : 0, tx }, I, step); if (isObj(res) && res.combatant) I.data.summoned = res.combatant; return false; }
    case "summonLeave": for (const id of Array.isArray(e.combatants) ? e.combatants : []) await perform(X, tx, { t: "summonRemove", combatant: id, tx }, I, step); return false;
    case "summonFlag": await perform(X, tx, { t: "summonFlag", combatant: e.who, owner: e.owner ?? null, tx }, I, step); return false;
    default: return false;
  }
}
/* who answers for a combatant: its player owners, else the GM desk (spec 5.4) */
const addresseeOf = (X, cid) => { const c = X.facts.c(cid), users = (c?.owners ?? []).filter((u) => !X.facts.user(u)?.staff); return !c || c.npc || !users.length ? "gm" : { users }; };
function openPrompt(X, I, spec, step) {
  const id = nextId(X, "p");
  const p = { id, inst: I?.id ?? null, step, kind: spec.kind, to: spec.to, options: spec.options ?? [], at: X.host.now() };      // U59: since when the table waits for this answer
  for (const k of ["about", "multi", "min", "max", "free", "gmOnlyData", "data"]) if (spec[k] != null) p[k] = spec[k];      // (a card about nobody, a hazard's, carries no `about`: null does not survive the store)
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
  const entry = C.entryFor(X.state, actor, action, X.facts);
  const f = flow ?? entry?.flow ?? "other";
  const inst = { id: nextId(X, "a"), action, flow: FLOWS[f] ? f : "other", actor: actor ?? null, initiator: initiator ?? (actor ? { type: "combatant", id: actor } : { type: "gm", id: X.user.id }),
    by: X.user.id, parent, cause, step: FLOWS[FLOWS[f] ? f : "other"].STEPS[0], status: "open", decl, locked: false, waits: [], rolls: {}, data: { ...data }, overrides: [], tx: null };
  if (entry?.flow === "attack" && !inst.data.kind) inst.data.kind = entry.attack ?? "slugfest";
  if (entry?.kit && entry.name) inst.data.label = { label: entry.label, name: String(entry.name).slice(0, 80), ...(entry.fxOn !== undefined ? { fxOn: !!entry.fxOn } : {}) };   // P6: an action of the sheet keeps its name for the lists
  if (part) inst.part = 1;
  return inst;
}
/* U10 / U3: what the table is told happened, kept in the state (the last NEWS_MAX) so every client can say it in its own surface: the result
   of an action that closed (who, what, per target: hit or not, damage taken, stunts), and the GM's word on a request for an exception. It
   is not journaled (an undo marks the entry instead of removing it) and it reaches a player only through view-pure.viewFor, which drops
   whatever names somebody concealed from that player. */
export const NEWS_MAX = 12;
function pushNews(X, n) {
  /* P8e-1: the id is drawn FIRST. Inside the object literal the spread had already copied the old counter, so the number was handed out
     and then forgotten: two lines in a row (two undos, two turns passed) carried one id, and the surface, which tells "already read" by
     that number (ui/model-pure.newsData), never showed the second one to whoever had dismissed the first. */
  const id = nextId(X, "n");
  X.state = { ...X.state, news: [...(X.state.news ?? []), { id, round: X.state.round ?? null, at: X.host.now(), ...n }].slice(-NEWS_MAX) }; X.changed = true;
}
/* D123: the engine's own damage (kind "fixed") is named by what dealt it: a barrier or a wall, a fall, a vehicle, a chase; a GM trigger
   of that kind has none and reads "Damage" */
const HZ_CAUSES = ["barrier", "fall", "vehicle", "chase"];
/* UXB (U141 / U146): a line says what an action came to in full: minions that fell (`out`), a character it put out of action (`down`), the
   defence that turned it into a miss (`def`); a counterattack is named as one (`counter`), and `inst` / `parent` let the surface tell
   the counter that answered an attack together with that attack (ui/news-pure.mjs) */
function newsRow(I, t) {
  const o = I.data?.out?.[t], dm = I.data?.dmg?.[t], st = (I.data?.stunts ?? []).filter((p) => p.target === t).map((p) => p.stunt);
  const atk = I.rolls?.attack, six = Number(atk?.forced?.sixes ?? atk?.sixes) || 0, df = I.data?.def?.[t]?.defence;
  return { target: t, ...(o ? { hit: o.hit === true } : {}), ...(dm && Number.isFinite(dm.taken) ? { taken: dm.taken, ...(dm.tags?.toStress ? { stress: 1 } : {}) } : {}), ...(st.length ? { stunts: st } : {}),
    ...(dm?.minions?.removed > 0 ? { out: dm.minions.removed } : (dm?.newlyBroken || dm?.broke) && !dm.minions ? { down: 1 }      /* BH4-3: a hazard's record (fire, blast, fall) has no newlyBroken, only kit.brokenAndCrit's `broke` */ : {}),
    ...(o && !o.hit && !o.forced && six > 0 && (df === "block" || df === "dodge") ? { def: df } : {}),
    ...(Number.isFinite(dm?.crit?.n) ? { crit: { n: Math.trunc(dm.crit.n), id: critKey(dm.crit.id) } } : {}),      // D127: the critical injury of a key character
    /* FXP (U181): where a knockback or a throw landed, and the vehicle it threw the character out of */
    ...(I.data?.landed?.[t]?.at ? { land: I.data.landed[t].at, ...(I.data.landed[t].outOf ? { seat: I.data.landed[t].outOf } : {}) }
      : I.flow === "forced" && t === I.data?.mv?.who && typeof I.data.mv.at === "string" && I.data.mv.at !== I.data.mv.from && I.data.result !== "none" ? { land: I.data.mv.at.slice(0, 40), ...(P1.isId(I.data.mv.outOf) ? { seat: I.data.mv.outOf } : {}) } : {}) };
}
function newsOf(I) {
  const rows = (I.decl?.targets ?? []).map((t) => newsRow(I, t));
  const fx = isObj(I.data?.challengeFx) ? I.data.challengeFx : null, note = fx && typeof I.data?.manual?.note === "string" && I.data.manual.note.trim() ? I.data.manual.note.trim().slice(0, 300) : null;
  return { kind: "action", tx: I.tx ?? null, inst: I.id, ...(I.parent ? { parent: I.parent } : {}), ...(I.data?.kind === "counterattack" ? { counter: 1 } : {}),
    actor: I.actor ?? null, action: I.action, flow: I.flow, ...(I.data?.label?.name ? { name: I.data.label.name } : {}), ...(I.data?.hazard?.kind ? { hazard: String(I.data.hazard.kind) } : {}),
    ...(I.data?.hazard?.kind === "fixed" && HZ_CAUSES.includes(I.data.hazard.id) ? { hzCause: I.data.hazard.id } : {}),      // D123: what dealt the engine's own damage
    ...(fx ? { fx: { challenge: fx.challenge, kind: fx.kind }, ...(note ? { note } : {}) } : {}),        // U110: what a failed challenge did, and the GM's words about it
    result: I.data?.result ?? null, status: I.status, ...(I.data?.forced?.outcome ? { forced: 1 } : {}), ...(I.decl?.secret || fx?.hidden ? { secret: 1 } : {}), rows, ...reactsOf(I) };
}
/* D113: what the reactions of the table's eyes came to (Discretion, Warning Call, Guardian, one the GM settled by hand): told with the result, so a
   price paid is never paid in silence. { reacts: [{ who, effect, result, about?, name?, label?, note? }] } | {} */
const REACT_RESULTS = ["moved", "failed", "card", "dice", "byHand", "noAlly", "noTarget", "took"];      // U125 (d): "took" = a guardian took the hit for `about`
function reactsOf(I) {
  const list = (I.data?.reacted ?? []).filter((r) => isObj(r) && P1.isId(r.who) && REACT_RESULTS.includes(r.result)).slice(0, 8);
  return list.length ? { reacts: list.map((r) => ({ who: r.who, effect: r.effect, result: r.result, ...(P1.isId(r.about) ? { about: r.about } : {}), ...(r.name ? { name: String(r.name).slice(0, 80) } : {}), ...(typeof r.label === "string" && r.label.startsWith("ITAC.") ? { label: r.label.slice(0, 80) } : {}), ...(r.note ? { note: String(r.note).slice(0, 200) } : {}) })) } : {};
}
const reactWhat = (r) => (r.name ? String(r.name).replace(/[{}]/g, "") : typeof r.label === "string" && /^ITAC\.[\w.]+$/.test(r.label) ? `{${r.label}}` : "");
/* U120: an action of somebody Foundry hides (or aimed at somebody hidden) has no public journal line (label: `pub` ""), and its news line
   is marked `hid` when it is written: view-pure keeps it from the players for good, also after the GM reveals that combatant (the
   reveal shows who is there now, not what was done unseen; question A9F-2). Its own player still reads it. */
const hiddenNow = (X, I) => { try { return [I.actor, ...(I.decl?.targets ?? [])].some((c) => typeof c === "string" && X.facts.c(c)?.hidden === true); } catch { return false; } };
/* UXB (U141): who was hidden when it was written: `hidA` the doer, `hidT` the targets. A target's own player is then told what was done to
   that character by "somebody unseen" (view-pure: no doer, no action, no power name), as the attack's own card told it */
const hiddenWho = (X, I) => { try { const hs = (I.decl?.targets ?? []).filter((c) => typeof c === "string" && X.facts.c(c)?.hidden === true); return { ...(I.actor && X.facts.c(I.actor)?.hidden === true ? { hidA: 1 } : {}), ...(hs.length ? { hidT: hs.slice(0, 12) } : {}) }; } catch { return {}; } };
/* D32 / D33: a public journal line does not carry a name. It carries the mark `{c:<id>}` and the list `who` of the combatants it is about
   (the doer, and the targets, whom it does not name), so each reader gets the name as THAT reader knows it (namesake numbers never count
   somebody hidden from a player, ruling U5-7) and no line about somebody concealed from that reader (view-pure.journalFor).
   who = { id: the plain name, kept for when the combatant has left the fight } */
const cMark = (id) => `{c:${id}}`;
const whoOf = (X, ids) => Object.fromEntries([...new Set(ids)].filter((id) => typeof id === "string" && id).map((id) => { const c = X.facts.c(id); return [id, String(c?.bare ?? c?.name ?? "").slice(0, 80)]; }));
function pushInst(X, inst) { X.state = { ...X.state, stack: [...X.state.stack, inst] }; X.changed = true; }
const JOURNAL_HAZARDS = ["fire", "blast", "area", "vacuum", "disease"];
function label(X, inst, what) {
  const a = inst.actor ? X.facts.c(inst.actor) : null, e = C.entryFor(X.state, inst.actor, inst.action, X.facts);
  /* the engine has no language: an action and a result are written as `{key}` marks that the surfaces put into the reader's language (lang.mjs
     `marks`); an entry with a name of its own (a granted power) keeps that name */
  const act = e?.name || (typeof e?.label === "string" && !e.label.startsWith("ITAC.") ? e.label : inst.action === "fireSpread" ? "{ITAC.journal.fireSpread}" : `{ITAC.action.${inst.action}}`);      // the card of the spread is titled with a question; the journal states what it was
  const res = what ? ` ({ITAC.result.${what}})` : "";
  /* nobody's action (a hazard, a forced move, a consequence of a challenge, a waiting trigger): the doer is the GM's hand or nobody, never an id;
     what it is comes from the hazard's kind or from the trigger's own name; `{zone:key}` is the place, named by the surface as the map names it */
  const hk = inst.data?.hazard?.kind, own = !inst.actor && typeof inst.decl?.text === "string" && inst.decl.text.trim() ? inst.decl.text.trim().slice(0, 80) : null;
  /* U110: what a challenge does is named as a mark (each reader's language), with the challenge as `{c:id}`, and the GM's note after it */
  const fx = isObj(inst.data?.challengeFx) && P1.isId(inst.data.challengeFx.challenge) ? inst.data.challengeFx : null;
  if (fx) {
    const cc = X.facts.c(fx.challenge), note = typeof inst.data?.manual?.note === "string" && inst.data.manual.note.trim() ? ` "${inst.data.manual.note.trim().slice(0, 120).replace(/[{}]/g, "")}"` : "";
    const head = `{ITAC.ui.effect.${fx.kind}}`, res = what ? ` ({ITAC.result.${what}})` : "", spot = inst.decl?.zone ?? inst.data?.hz?.zone ?? null;
    const names = (inst.decl?.targets ?? []).map((t) => X.facts.c(t)?.name).filter(Boolean).join(", ");
    return { keep: true, who: whoOf(X, [fx.challenge, ...(inst.decl?.targets ?? [])]), pub: cc?.hidden || fx.hidden ? "" : `${cMark(fx.challenge)}: ${head}${res}${note}`,
      gm: `${cc?.name ?? ""}: ${head}${names ? ` -> ${names}` : ""}${typeof spot === "string" && spot ? ` @ {zone:${spot.slice(0, 60)}}` : ""}${res}${note}` };
  }
  const what0 = own ?? (inst.action === "hazard" && JOURNAL_HAZARDS.includes(hk) ? `{ITAC.ui.hz.kind.${hk}}` : act);
  const who = a?.name ?? (inst.cause === "gm" || inst.initiator?.type === "gm" ? "{ITAC.journal.gm}" : "");
  const spot = inst.decl?.zone ?? inst.data?.hz?.zone ?? inst.data?.hazard?.zone ?? (["move", "drive", "fastball"].includes(inst.flow) ? inst.data?.mv?.at ?? inst.data?.mv?.to ?? null : null);
  const names = (inst.decl?.targets ?? []).map((t) => X.facts.c(t)?.name).filter(Boolean).join(", ");
  const pub = a?.hidden ? "" : `${a?.name ? `${cMark(inst.actor)}: ` : ""}${a ? act : what0}${res}`;       // spec 10: two texts; a hidden actor has no public line, and no public line names a target or a place
  /* D113: the reactions it met, after the result: "[Omni-Man: Warning Call (warned)]"; a reactor hidden from the table is in the GM's line only */
  const rx = (reactsOf(inst).reacts ?? []).map((r) => ({ r, w: reactWhat(r) })), rxText = (nm, list) => list.map(({ r, w }) => ` [${nm(r.who)}: ${w}${w ? " " : ""}({ITAC.journal.react.${r.result}})]`).join("");
  const rxPub = rx.filter(({ r }) => !X.facts.c(r.who)?.hidden);
  /* (the reactors are not put into `who`: a reader who does not know one of them would lose the whole line of the attack, view-pure.journalFor) */
  return { who: whoOf(X, [inst.actor, ...(inst.decl?.targets ?? [])]), pub: a || (inst.decl?.targets ?? []).every((t) => !X.facts.c(t)?.hidden) ? (pub ? pub + rxText(cMark, rxPub) + hurtText(X, inst, cMark, true) : pub) : "", gm: `${who ? `${who}: ` : ""}${what0}${names ? ` -> ${names}` : ""}${typeof spot === "string" && spot ? ` @ {zone:${spot.slice(0, 60)}}` : ""}${res}${rxText((id) => X.facts.c(id)?.name ?? "", rx)}${hurtText(X, inst, (id) => X.facts.c(id)?.name ?? "")}` };
}
/* D127: what an action did to whoever it broke, after its result, so nobody (the GM least of all) is left with a bare injury die: the
   critical injury with its number and name ("[Doc Seismic: critical injury 5 (Concussed!)]"), else knocked out, killed or broken.
   `pub`: only about somebody the table may see. */
const CRIT_IDS = ["torn-suit", "bruised", "bloodied", "beaten-up", "concussed", "battered", "crushed-arm", "crushed-leg", "cracked-skull", "crushed", "skewered", "head-crushed", "torn-apart"];
export const critKey = (id) => String(id ?? "").replace(/-(\w)/g, (m, c) => c.toUpperCase());      // "torn-suit" -> "tornSuit" (a mark is letters and dots)
function hurtText(X, inst, nm, pub = false) {
  return Object.entries(isObj(inst.data?.dmg) ? inst.data.dmg : {}).filter(([t, dm]) => isObj(dm) && P1.isId(t) && !(pub && X.facts.c(t)?.hidden)).slice(0, 8).map(([t, dm]) => {
    const what = Number.isFinite(dm.crit?.n) ? `{ITAC.journal.crit} ${Math.trunc(dm.crit.n)}${CRIT_IDS.includes(dm.crit.id) ? ` ({ITAC.crit.${critKey(dm.crit.id)}})` : ""}`
      : dm.npcOutcome === "kill" ? "{ITAC.status.dead}" : dm.npcOutcome === "ko" ? "{ITAC.status.unconscious}" : dm.broke ? "{ITAC.status.broken}" : "";
    return what ? ` [${nm(t)}: ${what}]` : "";
  }).join("");
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
  if (!I.part && I.status !== "aborted" && !I.data?.free) pushNews(X, { ...newsOf(I), ...(hiddenNow(X, I) ? { hid: 1, ...hiddenWho(X, I) } : {}) });
  emit(X, I, { type: "actionClosed", summary: { result: I.data.result ?? null, status: I.status }, tx: I.part ? null : I.tx });
  const parent = I.parent ? instOf(X, I.parent) : null;
  if (!parent) return;
  const P = J.clone(parent);
  (P.data.children ??= {})[I.id] = { action: I.action, status: I.status, result: I.data.result ?? null };
  const mv = I.flow === "forced" ? I.data?.mv : null;      // FXP (U181): where a knockback / slam of this action landed (its own line has none: it is a part)
  if (mv && P1.isId(mv.who) && typeof mv.at === "string" && mv.at !== mv.from && I.data.result !== "none" && I.data.result !== "aborted" && I.status !== "aborted") (P.data.landed ??= {})[mv.who] = { at: mv.at.slice(0, 40), ...(P1.isId(mv.outOf) ? { outOf: mv.outOf } : {}) };
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
/* D37 (spec 3.3; spec 0 principle 4): somebody an open action is aimed at has left the fight. Its cards went with it, so an action that
   waited for its answer waited for nothing, and one that went on hit nobody. Now the one who left is taken out of every open action
   (as a target, as a helper); an action that still has a target goes on, and one left without any is held on the GM's card `revalidate`
   [OQ-3] (the owner aims it again, or it is given up with or without its cost): the engine never decides that by itself. */
function targetGone(X, id) {
  for (const inst of X.state.stack) {
    const d = inst.decl ?? {}, aimed = (d.targets ?? []).includes(id), helps = (d.helpers ?? []).some((h) => h.id === id);
    if (!aimed && !helps) continue;
    const I = J.clone(inst);
    if (helps) I.decl.helpers = I.decl.helpers.filter((h) => h.id !== id);
    if (aimed) {
      I.decl.targets = I.decl.targets.filter((t) => t !== id);
      for (const k of ["def", "out"]) if (isObj(I.data[k])) delete I.data[k][id];
      (I.data.notes ??= []).push({ note: "targetGone", target: id });
      if (!I.decl.targets.length && !I.data.hold) {
        I.data.hold = "revalidate"; I.data.holdReasons = ["noTarget"]; I.data.holdKey = `gone:${id}`;
        openPrompt(X, I, { key: `gone:${id}`, kind: "revalidate", to: "gm", about: I.actor, options: REVALIDATE_OPTIONS.filter((o) => o !== "continue").map((o) => ({ id: o, label: `ITAC.opt.${o}` })), data: { reasons: ["noTarget"] } }, I.step);
      }
    }
    I.waits = waitsOf(X, I);
    setInst(X, I);
  }
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
    /* D90 / D91 (spec 5.3; principle 4: nothing blocks the table): a step that throws does not leave the fight. Before, the instance
       stayed on top at the throwing step, so EVERY later request ran into it again and was answered `internal` although its own effect
       was saved. Now the failure ends here: what the step had not yet handed to the host is as if it never ran, what it had is kept
       (and journaled), and the instance is handed to the GM (`manual`, with `data.failed`) to settle by hand, to step or to cancel. */
    const snap = { state: X.state, log: X.log, events: X.events.length, did: X.did }, at = { I: null, post: null };
    let go;
    try { go = await stepOnce(X, inst, at); } catch (e) { failStep(X, inst, e, snap, at); return; }
    if (!go) return;
  }
}
/* one turn of the driver -> true: again, false: the stack waits */
async function stepOnce(X, inst, at) {
  if (inst.data.hold) return resolveHold(X, inst);
  const flow = FLOWS[inst.flow], fn = flow.steps[inst.step];
  if (!fn) { const I = J.clone(inst); I.status = "manual"; setInst(X, I); return false; }      // unknown step: never guess, hand it to the GM
  const R = fn(view(X), inst), I = R.inst;
  at.I = I;
  if (!I.hist?.[I.step]) (I.hist ??= {})[I.step] = JSON.stringify({ data: inst.data, rolls: inst.rolls, locked: inst.locked, decl: inst.decl });   // for goToStep / amend
  let progress = false;
  for (const e of R.effects) progress = (await applyEffect(X, I, e, inst.step)) || progress;
  /* D103 / D104: a card the step withdraws (its question is no longer true: the attack went to somebody else). Only one nobody has
     answered yet; its key is forgotten, so the step may ask that seat again later with a card that says what is true then. */
  for (const k of Array.isArray(R.drop) ? R.drop : []) {
    const pid = I.data.pk?.[k], p = pid ? X.state.prompts[pid] : null;
    if (p && !p.answered) { dropPrompts(X, (q) => q.id === pid); delete I.data.pk[k]; X.changed = true; progress = true; }
  }
  for (const p of R.prompts) progress = openPrompt(X, I, p, inst.step) || progress;
  for (const ev of R.events) emit(X, I, ev);
  at.post = { state: X.state, log: X.log, events: X.events.length };                         // the step's effects are through; what follows only moves the stack
  if (R.done) { setInst(X, I); await closeInst(X, I); return true; }
  if (R.push) {
    I.status = "waiting"; I.waits = waitsOf(X, I); setInst(X, I);
    const r = pushChild(X, I, R.push);
    if (!r.ok) { const P = J.clone(instOf(X, I.id)); (P.data.notes ??= []).push({ note: "pushRefused", action: R.push.action, reason: r.reason }); if (R.push.part) (P.data.results ??= []).push({ action: R.push.action, status: "aborted", result: "illegal" }); P.status = "open"; setInst(X, P); }
    return true;
  }
  if (R.goto) { I.step = R.goto; I.status = "open"; I.waits = waitsOf(X, I); setInst(X, I); return true; }
  I.status = I.status === "manual" ? "manual" : "waiting"; I.waits = waitsOf(X, I);
  setInst(X, I);
  return progress;
}
/* The instance whose step failed goes to the GM. `at.post`: the effects were through and only the bookkeeping after them failed (pure:
   put back exactly, the step's results kept on the instance). Nothing asked of the host: the whole step is taken back. Otherwise the
   effects carried out stay, journaled in the open transaction, so "cancel" undoes them and "by hand" keeps them. */
function failStep(X, inst, e, snap, at) {
  warn(X, "step", e, { inst: inst.id, action: inst.action, flow: inst.flow, step: inst.step });
  const pure = X.did === snap.did;
  if (at.post) { X.state = at.post.state; X.log = at.post.log; X.events.length = at.post.events; }
  else if (pure) { X.state = snap.state; X.log = snap.log; X.events.length = snap.events; }
  X.facts = liveFacts(X);
  const cur = instOf(X, inst.id);
  park(X, cur ? (at.I && (at.post || !pure) ? { ...at.I, step: cur.step } : cur) : top(X), inst, e);
}
function park(X, base, inst, e) {
  if (!base) return;
  const I = J.clone(base);
  I.status = "manual";
  I.data.failed = { step: String(inst.step ?? "").slice(0, 40), msg: String(e?.message ?? e).slice(0, 120), ...(I.id !== inst.id ? { after: inst.id } : {}) };
  I.waits = waitsOf(X, I);
  setInst(X, I);
  X.parked = I.id;
  emit(X, I, { type: "stepFailed", step: I.data.failed.step, gmOnly: 1 });
}
/* D90: a transaction nobody holds any more (its instance left the stack on a failure before it was closed) is closed, so what was
   written under it is in the journal and can be undone. Every open transaction belongs to an instance of the stack otherwise. */
function sweepTx(X) {
  const held = new Set(X.state.stack.map((i) => i.tx));
  for (const id of Object.keys(X.state.txOpen ?? {})) if (!held.has(id)) { const tx = X.state.txOpen[id]; closeTx(X, id, { pub: "", gm: tx.label?.gm || "{ITAC.journal.cutShort}" }); }
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
/** The longest id of a choice (`decl.opt`): the relay and the engine cut at the same length, and no choice of the kit is longer (check-defects). */
export const OPT_MAX = 120;
function sanitizeDecl(d, action, staff = false) {
  /* D92 (spec 1.4): somebody named twice is named once. A doubled target counted as one target more (full auto lost a die for it) and
     the ledger entry in memory then differed from what the store keeps (state-pure dedupes an entry's targets). */
  const ids = (v, n = 12) => (Array.isArray(v) ? [...new Set(v.filter(P1.isId))].slice(0, n) : []);
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
  if (typeof d?.opt === "string") out.opt = d.opt.slice(0, OPT_MAX);                          // P6: the choice an action of the kit asks for (a plan, good or bad luck, how much, the features of summoned allies [B1813-1815])
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
/** The triggers due at the start or the end of a turn come BEFORE whatever is done next (spec 4.4: turnStart runs the turn-start triggers,
    then opens the turn; [B2889], [B2926], [B2929]): while their queue card waits for the GM nothing new is declared. */
export const queueHolds = (state) => Object.values(state?.prompts ?? {}).some((p) => p.kind === "triggerQueue" && !p.answered);
function placement(X, actor, entry) {
  const t = top(X);
  if (!t) return queueHolds(X.state) ? { ok: false, code: "busy", params: { reason: "triggersFirst" } } : { ok: true, cause: "turn", parent: null };
  if (t.locked || !t.data.window || t.actor === actor) return { ok: false, code: "busy" };
  if (entry.interrupt?.on?.includes(t.data.window)) return { ok: true, cause: "interrupt", parent: t.id };
  /* D40 [R1] [B1953], [B2292]: the extra action of Quickness may be any action, quick or full, taken as an interrupt: it answers an action
     somebody else declared, before that action's dice, and is paid with that unit and nothing else. */
  const unit = t.data.window === "beforeRoll" && (entry.cost === "full" || entry.cost === "quick" || priced0(entry)) ? P1.extraUnit(X.state, actor) : null;
  return unit ? { ok: true, cause: "interrupt", parent: t.id, grant: unit } : { ok: false, code: "busy" };
}
const priced0 = (entry) => typeof FLOWS[entry.flow]?.price === "function";                 // a flow that names its own cost answers for the turn itself
/* D54 (spec 10: an NPC's numbers stay the GM's until revealed). An action for "an ally" (recover Resolve [B2818], rally [B2773],
   Healing, Inspiration ...) asks about its subject's numbers before anything is rolled: `resolveFull`, `notBroken`, `notDying`. Asked
   by a PLAYER about an NPC whose statistics the GM has not revealed, every such answer (of "preview", which costs nothing and takes 40
   targets a question, and of a refused "declare") told a number that player may not know. For a player such a subject is therefore
   refused BEFORE its numbers are read, with one reason that says nothing of them (`notAlly`; the GM may allow: the request for an
   exception, whose card the GM answers knowing the numbers). The GM's own hand and a granted declaration are not asked (ruling P8f-R1).
   -> { ok: false, reason, params } | null */
function strangerGate(X, entry, decl, actor) {
  if (X.user.staff === true || entry?.target?.who !== "ally" || X.facts.c(actor)?.npc) return null;
  const t = (decl.targets ?? []).find((id) => id !== actor && X.facts.c(id)?.npc === true && !X.state.revealed?.[id]?.stats);
  return t ? { ok: false, reason: "notAlly", params: { gmMayAllow: 1 } } : null;
}
/** the legality a declaration of this user meets: the gate of D54, then the entry's and the flow's own rules */
const legalFor = (X, inst, entry) => strangerGate(X, entry, inst.decl ?? {}, inst.actor) ?? K.legality(view(X), inst, FLOWS[inst.flow]);
async function opDeclare(X, a) {
  const actor = a.actor;
  if (X.state.mode === "off") return bad("off");
  if (!P1.isId(actor) || !X.facts.c(actor) || (X.facts.c(actor).hidden && !X.user.staff)) return bad("unknown");
  if (!owns(X, actor)) return bad("notOwner");
  const entry = C.entryFor(X.state, actor, a.decl?.action, X.facts);
  if (!entry || entry.reaction?.effect === "defence" || (entry.reactionOnly && !X.user.staff)) return bad("unknown", { action: String(a.decl?.action ?? "").slice(0, 32) });      // D34: what exists only as an answer in a reaction window (Discretion) is never declared by a player
  const decl = sanitizeDecl(a.decl, entry.id, X.user.staff === true);
  if (X.state.mode === "free" || X.state.free?.[actor]) {                                  // spec 14.5: nothing is validated, nobody is prompted; logged as declared
    const inst = makeInst(X, { action: entry.id, actor, decl, flow: "other", data: { free: 1 } });
    inst.tx = openTx(X, { inst: inst.id }); inst.status = "manual"; pushInst(X, inst);
    emit(X, inst, { type: "actionDeclared", decl: publicDecl(decl), cost: "none", stress: 0, targets: decl.targets });
    return ok({ inst: inst.id });
  }
  if (entry.id === "gmRoll" && !X.user.staff) return bad("noPermission");
  const pl = placement(X, actor, entry);
  if (!pl.ok) return bad(pl.code, pl.params);
  /* D34 [L2] [L4] [B2290], [B2292]: on an empty stack a new action is the action of the one whose turn it is. What costs no action passed
     here whatever the turn (economy-pure.canPay asks nothing for cost "none"), so a player out of turn could put an instance on the
     stack and hold the one whose turn it is. Now: "something else" from a player out of turn is the request to the GM that the op
     `other` makes of it (ruling P8-R11: a card, nobody held); another built-in that costs no action is refused as the bar already
     shows it (desk-pure.barModel). The GM's hand, a grant, free mode and what a character's own kit lets it use at any time stay. */
  if (pl.cause === "turn" && !X.user.staff && !priced0(entry) && (entry.cost === "none" || entry.cost == null) && !P1.isOnTurn(X.state, actor)) {
    if (!entry.kit) return entry.id === "other" && decl.text ? opAsk(X, { actor, text: decl.text }, "other") : bad("notYourTurn");
    /* the same for what a character's kit uses without an action when it cannot end at once (a roll somebody owes, the GM's word): out of
       turn it is a request to the GM that carries the declaration, and the GM's yes runs it. What ends at once (Quickness, Regeneration,
       Resilience ...) holds nobody and goes through. */
    if (entry.roll || ["resist", "narrative"].includes(entry.effect?.kind)) return opAsk(X, { actor, text: String(entry.name ?? entry.id).slice(0, 120), decl: a.decl, reason: "notYourTurn" }, "exception");
  }
  const gm = X.user.staff && a.gm === true;                                                // the GM acting through an override: costs waived
  const priced = typeof FLOWS[entry.flow]?.price === "function";                           // P3: a flow that names its own cost (a move: quick or full, free inside the zone)
  const payable = (cost) => { if (pl.grant && cost !== "full" && cost !== "quick") return bad("busy"); const cp = P1.canPay(X.state, actor, cost, { interrupt: pl.cause === "interrupt", gm, ranged: P1.isRanged(entry), resolve: X.facts.c(actor)?.resolve, ...(pl.grant ? { grant: pl.grant } : {}) });      /* a unit that costs stress (Quickness [R1], a defence grant [B2105]) pays nothing at Resolve 0 [B2816], [B2228] */ return cp.ok ? null : bad(cp.reason === "notYourTurn" ? "notYourTurn" : "noAction", { reason: cp.reason }); };   // [L1]-[L4], [L7], [L8]
  if (!priced) { const no = payable(entry.cost); if (no) return no; }
  const inst = makeInst(X, { action: entry.id, actor, decl, cause: pl.cause, parent: pl.parent, data: a.data && X.user.staff ? a.data : {} });
  const l = legalFor(X, inst, entry);
  if (!l.ok && !decl.exception) return bad("illegal", { reason: l.reason, ...l.params });
  const price = priced ? FLOWS[inst.flow].price(view(X), inst) : null, cost = priced ? price?.cost ?? "none" : entry.cost;
  if (priced) { const no = payable(cost); if (no) return no; }
  inst.tx = openTx(X, { inst: inst.id });
  if (pl.parent) { const P = J.clone(instOf(X, pl.parent)); P.status = "waiting"; setInst(X, P); }
  pushInst(X, inst);
  const I = J.clone(inst);
  if (cost === "full" || cost === "quick" || (cost === "free" && price?.tags)) {
    await applyEffect(X, I, { t: "pay", who: actor, cost: gm ? "none" : cost, action: entry.id, key: "own", own: 1, interrupt: pl.cause === "interrupt", grant: pl.grant, ranged: P1.isRanged(entry), tags: price?.tags ?? entry.tags, target: decl.targets, zoneFrom: price?.zoneFrom, zoneTo: price?.zoneTo, borders: price?.borders }, "declare");   // waived by the GM: the entry is recorded (the facts of the turn), no unit is spent
    I.entry = I.data.paid?.own ?? null;
  }
  if (a.granted === true && X.user.staff) { I.data.exception = { reason: l.ok ? null : l.reason, params: l.ok ? {} : l.params, by: "gm" }; I.decl.exception = { ...I.decl.exception, state: "granted" }; }      // U3: the GM already said yes on the card of the request: no second card
  else if (!l.ok) {                                                                         // an illegal option with a request for an exception (spec 9.12): a desk card
    I.data.exception = { reason: l.reason, params: l.params }; I.data.hold = "exception"; I.status = "waiting";
    openPrompt(X, I, { key: "exception", kind: "exception", to: "gm", about: actor, free: 1, options: [{ id: "grant", label: "ITAC.opt.grant" }, { id: "deny", label: "ITAC.opt.deny" }], data: { reason: l.reason, text: decl.exception.text } }, "declare");
    I.data.holdKey = "exception";
  }
  setInst(X, I);
  emit(X, I, { type: "actionDeclared", decl: publicDecl(decl), cost, stress: decl.stressTotal, targets: decl.targets, zone: decl.zone, path: decl.path });
  return ok({ inst: inst.id });
}
/* D42 (handoff U3; spec 9.12): what refuses this declaration from its owner at this moment, as opDeclare would: the table (another
   action open, triggers first), the cost (not the turn, no unit left) and the rules of the flow, ALL of them, in the order they are
   asked. The GM's card of a free-standing request for an exception shows this list, never a word the asking client sent, and a grant
   overrules exactly this list. -> { reasons: [id], waive }   waive: a refusal of the table or of the cost is among them (ruling P9F-R1:
   there is nothing to pay with, so the granted declaration goes in with its cost waived); with only a rule of the flow overruled the
   action is paid for as always. Nothing is written. */
function refusalsOf(X, actor, d) {
  const entry = isObj(d) ? C.entryFor(X.state, actor, d.action, X.facts) : null;
  if (!entry || X.state.mode !== "tactical" || X.state.free?.[actor]) return { reasons: [], waive: false };
  const reasons = [], before = X.state;
  let waive = false;
  try {
    const pl = placement(X, actor, entry);
    if (!pl.ok) { reasons.push(pl.params?.reason ?? pl.code); waive = true; }
    const inst = makeInst(X, { action: entry.id, actor, decl: sanitizeDecl(d, entry.id, false), cause: pl.ok ? pl.cause : "turn", parent: pl.ok ? pl.parent : null });
    const flow = FLOWS[inst.flow], l = strangerGate({ ...X, user: { ...X.user, staff: false } }, entry, inst.decl, actor) ?? K.legality(view(X), inst, flow), priced = typeof flow?.price === "function";      // (as its owner would meet it: D54)
    const cost = priced ? (l.ok ? flow.price(view(X), inst)?.cost ?? "none" : null) : entry.cost;
    if (!priced && (cost === "none" || cost == null)) { if (!P1.isOnTurn(X.state, actor) && (!pl.ok || pl.cause === "turn") && (!entry.kit || entry.roll || ["resist", "narrative"].includes(entry.effect?.kind))) { reasons.push("notYourTurn"); waive = true; } }
    else if (cost != null) {
      const cp = pl.ok && pl.grant && cost !== "full" && cost !== "quick" ? { ok: false, reason: "busy" } : P1.canPay(X.state, actor, cost, { interrupt: pl.ok && pl.cause === "interrupt", ranged: P1.isRanged(entry), resolve: X.facts.c(actor)?.resolve, ...(pl.ok && pl.grant ? { grant: pl.grant } : {}) });
      if (!cp.ok) { reasons.push(cp.reason ?? "noAction"); waive = true; }
    }
    if (!l.ok) reasons.push(l.reason ?? "illegal");
  } catch { /* a declaration that cannot even be read refuses nothing by name: the grant runs into the engine's own answer */ }
  X.state = before;                                                                         // the probe took an id from the counter: given back
  return { reasons: [...new Set(reasons.map((r) => String(r).slice(0, 40)))], waive };
}
/* S063: an instance a trigger put on the stack (a start-of-turn effect, a toxin: pushTrigger's "other" item names the character it is
   about as its actor) is the GM's to run, not the owner's own declaration: the owner may not take it back or reword it. */
const gmRun = (X, inst) => inst.cause === "trigger" && X.user.staff !== true;
async function opAmend(X, a) {
  const inst = instOf(X, a.inst);
  if (!inst) return bad("gone");
  if (!inst.actor || !owns(X, inst.actor)) return bad("notOwner");
  if (gmRun(X, inst)) return bad("notOwner");                                               // S063: what a trigger brought is the GM's to run
  if (inst.locked && !X.user.staff) return bad("locked");                                  // spec 5.5: after the lock only the GM changes it
  const decl = sanitizeDecl({ ...a.decl, action: inst.action }, inst.action, X.user.staff === true);
  /* who helps, helps the action, whatever it is changed into before its dice [B2238]: their full action is spent and stays theirs to
     have spent. Only an action turned against its own helper cannot keep that helper. */
  decl.helpers = J.clone(inst.decl.helpers ?? []);
  if (decl.helpers.some((h) => decl.targets.includes(h.id))) return bad("illegal", { reason: "helpTarget" });
  const probe = { ...inst, decl };
  const l = legalFor(X, probe, C.entryFor(X.state, inst.actor, inst.action, X.facts));
  if (!l.ok && !X.user.staff) return bad("illegal", { reason: l.reason, ...l.params });
  /* P8d: a flow that names its own cost (a move) is priced again for what it was changed into. The price was taken once, at the
     declaration; a move the rules refused, declared with a request for an exception, has no price (the engine does not guess a route),
     so changing it into a legal move ran that move for nothing. The first payment is given back and the new price is paid; one that
     cannot be paid refuses the change (the GM's own change goes through with the cost waived). [L1]-[L4] */
  const flow = FLOWS[inst.flow], reprice = typeof flow?.price === "function", ownCost = (o) => o.i === inst.id && o.cost;
  const price = reprice && l.ok ? flow.price(view(X), probe) : null, cost = price?.cost ?? "none";
  let waived = false;
  if (reprice) {
    let s = X.state;
    for (const op of (X.state.txOpen[inst.tx]?.ops ?? []).filter(ownCost).reverse()) if (op.t === "state") s = J.applyStateOp(s, op, true);      // as if the first price had not been paid
    const cp = P1.canPay(s, inst.actor, cost, { interrupt: inst.cause === "interrupt", resolve: X.facts.c(inst.actor)?.resolve });
    if (!cp.ok && !X.user.staff) return bad(cp.reason === "notYourTurn" ? "notYourTurn" : "noAction", { reason: cp.reason });
    waived = !cp.ok;
  }
  dropPrompts(X, (p) => p.inst === inst.id && p.step === "declare" && p.kind === "exception");        // the GM's card of the held request: the hold is lifted below, an answer to it would do nothing
  await rewind(X, inst.id, FLOWS[inst.flow].STEPS[0]);
  if (reprice) {
    const tx = X.state.txOpen[inst.tx], paid = (tx?.ops ?? []).filter(ownCost);
    if (paid.length) { await undoOps(X, paid, tx.round); X.state = { ...X.state, txOpen: { ...X.state.txOpen, [inst.tx]: { ...X.state.txOpen[inst.tx], ops: X.state.txOpen[inst.tx].ops.filter((o) => !paid.includes(o)) } } }; }
  }
  const I = J.clone(instOf(X, inst.id));
  I.decl = decl; delete I.data.hold; delete I.data.holdKey; if (I.data.pk) delete I.data.pk.exception; I.locked = false; I.hist = {};
  if (reprice) {
    if (I.data.paid) delete I.data.paid.own; I.entry = null;
    if (cost === "full" || cost === "quick" || (cost === "free" && price?.tags)) {
      await applyEffect(X, I, { t: "pay", who: I.actor, cost: waived ? "none" : cost, action: I.action, key: "own", own: 1, interrupt: I.cause === "interrupt", tags: price?.tags, target: decl.targets, zoneFrom: price?.zoneFrom, zoneTo: price?.zoneTo, borders: price?.borders }, "declare");
      I.entry = I.data.paid?.own ?? null;
    }
  }
  if (!l.ok) I.data.exception = { reason: l.reason, params: l.params, by: "gm" };          // spec 14.1: the GM may amend into what the rules refuse; it runs as a granted exception
  setInst(X, I);
  emit(X, I, { type: "actionDeclared", decl: publicDecl(decl), amended: true, targets: decl.targets });
  return ok({ inst: I.id });
}
async function opCancel(X, a) {
  const inst = instOf(X, a.inst);
  if (!inst) return bad("gone");
  if (!inst.actor || !owns(X, inst.actor)) return bad("notOwner");
  if (gmRun(X, inst)) return bad("notOwner");                                               // S063
  if (!inst.locked || X.user.staff) { await abortInst(X, inst.id, true); return ok(); }     // not locked: removed and refunded
  const asked = inst.data.pk?.cancelAsk ? X.state.prompts[inst.data.pk.cancelAsk] : null;
  if (asked && !asked.answered) return ok({ changed: false });                              // S064: one card at a time; after the GM's "deny" the player may ask again (spec 12.2)
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
    const vr = FLOWS[inst.flow].validate?.(view(X), inst, p, value, X.user.staff === true);
    if (vr && !vr.ok) return bad("illegal", { reason: vr.reason });
    if (p.answered && inst.data.done?.[Object.keys(inst.data.pk ?? {}).find((k) => inst.data.pk[k] === p.id)]) return bad("locked");   // already acted upon
  }
  /* D42: a grant overrules what the card showed. When the table has changed since the card was made (another rule refuses now, or none
     does any more), the card is brought up to date and the GM is told so; nothing runs on a reason the GM never read. */
  if (!inst && p.kind === "exception" && isObj(p.data?.decl) && !p.data.other && Array.isArray(p.data.reasons) && (typeof value === "string" ? value : value.id) === "grant" && X.facts.c(p.about)) {
    const now = refusalsOf(X, p.about, p.data.decl);
    if (JSON.stringify(now.reasons) !== JSON.stringify(p.data.reasons) || !!now.waive !== !!p.data.waive) {
      const { reason: _r, reasons: _rs, waive: _w, ...rest } = p.data;
      X.state = { ...X.state, prompts: { ...X.state.prompts, [p.id]: { ...p, data: { ...rest, reasons: now.reasons, ...(now.reasons.length ? { reason: now.reasons[0] } : {}), ...(now.waive ? { waive: 1 } : {}) } } } }; X.changed = true;
      return bad("stale", { reason: now.reasons[0] ?? null, prompt: p.id });
    }
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
    pushNews(X, { kind: "exception", actor: I.actor, action: I.action, held: 1, granted: id === "grant", ran: id === "grant" ? 1 : 0, ...(typeof value?.text === "string" && value.text ? { note: value.text.slice(0, 200) } : {}) });      // U3: the asker is told
    if (id !== "grant") await abortInst(X, I.id, true);
  } else if (inst.data.pk?.cancelAsk === p.id) { const id = typeof value === "string" ? value : value.id; if (id === "cancel") await abortInst(X, inst.id, true); else if (id === "forfeit") await abortInst(X, inst.id, false); }
  return ok({ prompt: p.id });
}
/** Prompts that belong to no instance (exception request without an action, token confirmation ...): answering closes them. */
async function standalone(X, p) {
  dropPrompts(X, (q) => q.id === p.id); emit(X, null, { type: "override", op: "card", kind: p.kind, value: p.answered.value });
  if (p.kind === "exception" && p.about && X.facts.c(p.about)) await exceptionAnswered(X, p);
}
/* U3: the GM's word on a free-standing request for an exception has a consequence both sides can see and use. Granted, and the request
   named the action it was about (the dock sends the declaration it could not make): that action is declared for the asker at once, its
   cost waived (the refusal was "no action left" or "not your turn": there is nothing to pay with, and the GM said yes) and the rules'
   own refusal overruled. Granted without a declaration that can run (free words, or the table is busy): an action "by hand" opens on the
   desk when nothing else is in progress, so the GM has the card to settle it on. Either way, and on a refusal, the asker's dock says what
   was decided (state.news) and the journal keeps a line. */
async function exceptionAnswered(X, p) {
  const v = p.answered.value, id = typeof v === "string" ? v : v?.id, granted = id === "grant", note = typeof v?.text === "string" ? v.text.slice(0, 200) : "";
  const d = p.data ?? {}, name = X.facts.c(p.about)?.name ?? "";
  let ran = 0, why = null;
  const action = isObj(d.decl) && typeof d.decl.action === "string" ? d.decl.action.slice(0, 40) : d.other ? "other" : null;
  if (granted && action && !d.other) {
    const env = await opDeclare(X, { actor: p.about, gm: !Array.isArray(d.reasons) || !!d.waive, granted: true, decl: { ...d.decl, exception: { text: String(d.text ?? "").slice(0, 300) } } });
    if (env.ok) ran = 1; else why = String(env.error?.params?.reason ?? env.error?.code ?? "internal").slice(0, 40);
  }
  if (granted && !ran && !X.state.stack.length && !queueHolds(X.state)) {
    const inst = makeInst(X, { action: "other", actor: p.about, decl: { action: "other", targets: [], helpers: [], exploits: [], stressTotal: 0, text: String(d.text ?? "").slice(0, 300) }, flow: "other" });
    inst.tx = openTx(X, { inst: inst.id }); inst.status = "manual"; pushInst(X, inst);
    emit(X, inst, { type: "actionDeclared", decl: { action: "other" }, cost: "none", stress: 0, targets: [] });
    ran = 2;
  }
  pushNews(X, { kind: "exception", actor: p.about, ...(action ? { action } : {}), granted, ran, ...(why ? { why } : {}), ...(note ? { note } : {}) });
  const mark = granted ? "{ITAC.journal.exceptionGranted}" : "{ITAC.journal.exceptionDenied}", text = String(d.text ?? "").slice(0, 120);
  closeTx(X, openTx(X, {}), { pub: X.facts.c(p.about)?.hidden ? "" : `${cMark(p.about)}: ${mark}`, who: whoOf(X, [p.about]), own: p.about, gm: `${name}: ${mark}${text ? ` ("${text}")` : ""}${note ? ` / ${note}` : ""}`, keep: 1 });
}
/* The dice an action would roll if it were declared like this, from the SAME builder the roll uses (each flow's `preview`): what the
   dock's panel shows before "Declare". Nothing is written, nothing is spent, no instance is kept. -> env.preview = { attr, dice, base, mods } | null */
function opPreview(X, a) {
  const actor = a.actor;
  if (!P1.isId(actor) || !X.facts.c(actor) || (X.facts.c(actor).hidden && !X.user.staff)) return bad("unknown");
  if (!owns(X, actor)) return bad("notOwner");
  const entry = C.entryFor(X.state, actor, a.decl?.action, X.facts);
  if (!entry) return bad("unknown");
  const before = X.state;
  let out = null;
  try {
    const decl = sanitizeDecl(a.decl, entry.id, X.user.staff === true);
    /* D41 (spec 10; [B2075], [B1903]; ruling P8-R17): somebody the asking player's character has as `unseen` is not there for that player.
       The preview answered about it all the same (the minimum-range penalty told whether it stood in the hero's own zone, the modifiers
       named its conditions), and the op costs nothing and may be asked at will. Such a target is swapped for an id nobody has, so the
       answer is the one a target that does not exist gets, as the director's veil does for one Foundry hides. */
    if (!X.user.staff) {
      let nobody = "nobody"; for (let i = 0; X.facts.c(nobody); i++) nobody = `nobody${i}`;
      const ghost = (t) => (X.state.knowledge?.[actor]?.[t] === "unseen" ? nobody : t);
      decl.targets = decl.targets.map(ghost); if (decl.carry) decl.carry = decl.carry.map(ghost);
    }
    const run = (d) => { const inst = makeInst(X, { action: entry.id, actor, decl: d }); return FLOWS[inst.flow]?.preview?.(view(X), inst) ?? null; };
    const line = (m) => ({ source: String(m.source ?? "").slice(0, 40), dice: Math.trunc(m.dice) });
    /* D49 (spec 6.2): a bonus die that needs the GM's word at the roll (flows/kit.mjs tokenGate) is not a die of the pool yet: the GM may
       refuse it. The preview counted it as certain; now the number is the pool without such dice, and they are listed apart as `pending`. */
    const wait = new Set((X.state.tokens ?? []).filter((t) => t?.needsGm && (decl.tokens ?? []).includes(t.id)).map((t) => t.id));
    const full = wait.size ? run(decl) : null, p = run(wait.size ? { ...decl, tokens: decl.tokens.filter((id) => !wait.has(id)) } : decl);
    if (p?.pool && Number.isFinite(p.pool.dice)) {
      out = { attr: p.attr ?? null, dice: p.pool.dice, base: p.pool.base ?? 0, mods: (p.pool.mods ?? []).filter((m) => m.dice).slice(0, 24).map(line) };
      const pending = (full?.pool?.mods ?? []).filter((m) => m.dice && String(m.source ?? "").startsWith("token:") && wait.has(String(m.source).slice(6))).slice(0, 12).map(line);
      if (pending.length) out.pending = pending;
      /* D60: the dice the one target would defend with, from the builder of the roll, for whoever may know that target's numbers */
      const t0 = decl.targets.length === 1 ? decl.targets[0] : null;
      if (t0 && X.facts.c(t0) && numbersOpen(X, t0)) { const inst = makeInst(X, { action: entry.id, actor, decl }), df = FLOWS[inst.flow]?.defPreview?.(view(X), inst, t0); if (df && Object.keys(df).length) out.def = df; }
    }
  } catch { out = null; }
  /* W1 (U33, U34): WHOM THIS DECLARATION COULD BE AIMED AT. `of` = the candidates the asker's map would mark. For each one the
     answer of the SAME legality the declaration will meet (so the map never promises what "declare" then refuses), the dice of the
     same builder as the roll, and what a plain hit would do (the damage step's own numbers). Per asker: nobody concealed from the
     asker is answered about (hidden in Foundry, or unseen by every character of theirs: view-pure.concealedFor), and of an NPC the
     numbers after its Armor and its Health go out only once the GM revealed them (spec 10). */
  let per = null, acts = null;
  const staff = X.user.staff === true, mine = staff ? [] : Object.keys(X.state.ledger ?? {}).filter((id) => owns(X, id));
  const concealed = (t) => !staff && (X.facts.c(t)?.hidden === true || (mine.length > 0 && mine.every((o) => X.state.knowledge?.[o]?.[t] === "unseen")));
  const probe = (en, decl, t) => {
    try {
      const tf = X.facts.c(t);
      if (!tf || t === actor || concealed(t)) return null;
      /* D52 [B2543]: full auto is ONE roll at everybody named, a die less per target beyond the first, all of them in one zone. The
         answer about `t` is therefore the answer for the declaration with `t` beside the targets already chosen (the declaration's
         own `targets`): the dice over each token are the dice of the roll that will be made, and a candidate in another zone than
         the chosen ones is refused here (`notSameZone`), not after "Declare". Any other declaration has one target: `t` alone. */
      const d0 = sanitizeDecl(isObj(decl) ? decl : {}, en.id, staff), base = d0.fullAuto ? d0.targets.filter((x) => x !== t && x !== actor && X.facts.c(x) && !concealed(x) && X.state.knowledge?.[actor]?.[x] !== "unseen") : [];
      const inst = makeInst(X, { action: en.id, actor, decl: { ...d0, targets: [...base, t].slice(0, 12) } });
      const l = legalFor(X, inst, en);
      const row = l.ok ? { ok: true } : { ok: false, reason: String(l.reason ?? "rules").slice(0, 40), params: Object.fromEntries(Object.entries(l.params ?? {}).filter(([k, x]) => k.length <= 24 && (Number.isFinite(x) || (typeof x === "string" && x.length <= 40))).slice(0, 6)) };
      const p = FLOWS[inst.flow]?.preview?.(view(X), inst) ?? null;
      if (p?.pool && Number.isFinite(p.pool.dice)) row.dice = p.pool.dice;
      const h = l.ok ? FLOWS[inst.flow]?.hitPreview?.(view(X), inst, t) ?? null : null;
      if (h) {
        const npc = tf.npc === true, rv = X.state.revealed?.[t] ?? {};
        row.hit = { base: h.base, toStress: h.toStress, ...(staff || !npc || rv.stats ? { taken: h.taken, most: h.most, ...(h.copies ? { copies: h.copies } : {}) } : {}), ...(staff || !npc || rv.health ? { now: h.now, max: h.max } : {}) };
      }
      if (l.ok && numbersOpen(X, t)) { const df = FLOWS[inst.flow]?.defPreview?.(view(X), inst, t); if (df && Object.keys(df).length) row.def = df; }      // D60
      return row;
    } catch { return null; }                                                                // no answer about that one rather than a wrong one
  };
  if (Array.isArray(a.of)) {
    per = {};
    for (const t of a.of.filter(P1.isId).slice(0, REACH_MAX)) { if (per[t]) continue; const row = probe(entry, a.decl, t); if (row) per[t] = row; }
  }
  /* ... and WHAT COULD BE DONE TO ONE OF THEM (U35: the menu at a token): the same answer for several actions against `at` */
  if (Array.isArray(a.acts) && P1.isId(a.at)) {
    acts = {};
    for (const d of a.acts.filter(isObj).slice(0, ACTS_MAX)) {
      const en = C.entryFor(X.state, actor, d.action, X.facts);
      if (!en || en.reaction?.effect === "defence" || acts[en.id]) continue;
      const row = probe(en, d, a.at);
      if (row) acts[en.id] = row;
    }
  }
  X.state = before;                                                                         // the probe took an id from the counter: given back
  return { ok: true, changed: false, preview: per || acts ? { ...(out ?? {}), ...(per ? { per } : {}), ...(acts ? { acts } : {}) } : out };
}
export const REACH_MAX = 40, ACTS_MAX = 12;
/** may this user know the dice `t` rolls? the GM; the owner of `t`; anybody once the GM revealed its statistics (spec 10; as the surfaces' `attrs`) */
function numbersOpen(X, t) { return X.user.staff === true || owns(X, t) || !!X.state.revealed?.[t]?.stats; }
/** The same, at once and without a host that can do anything: for the executor's own client and the checks. -> { attr, dice, base, mods } | null */
export function previewFor(state, facts, user, req) {
  try { const env = opPreview(makeX(state, null, { facts: () => facts, now: () => 0 }, user), req ?? {}); return env.ok ? env.preview ?? null : null; } catch { return null; }
}

async function opHelp(X, a) {
  const inst = instOf(X, a.inst);
  if (!inst || !inst.actor) return bad("gone");
  /* P8d (spec 10; ruling P8-R17): the action of somebody the helper's player cannot know about (hidden by the GM, or unseen by the helper)
     is not there to be helped. Before, the request was carried out: the hero's full action went into the hidden NPC's action. */
  if (!X.user.staff && !owns(X, inst.actor) && (X.facts.c(inst.actor)?.hidden === true || X.state.knowledge?.[a.helper]?.[inst.actor] === "unseen")) return bad("gone");
  if (!P1.isId(a.helper) || !owns(X, a.helper)) return bad("notOwner");
  if (inst.locked) return bad("locked");
  if (a.helper === inst.actor || (inst.decl.helpers ?? []).some((h) => h.id === a.helper)) return bad("badInput");
  if ((inst.decl.targets ?? []).includes(a.helper)) return bad("illegal", { reason: "helpTarget" });                   // [B2238]: an ally helps; nobody helps the action aimed at them
  const out = M.outOfAction(X.state, a.helper, X.facts.c(a.helper));                                                    // [B2707]: out of action
  if (out) return bad("illegal", { reason: out });
  const has = P1.canPay(X.state, a.helper, "full", { cause: "help", resolve: X.facts.c(a.helper)?.resolve });                    // [L9], [L2], [B2273]: the helper's full action is spent on the helped character's turn
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
  /* "something else" (spec 9.12) is a GM-driven instance and, like every instance, it is somebody's action: on the stack it holds the
     table. From a player whose turn it is not it is a request to the GM instead (the card below), which holds nobody. */
  const asAction = kind === "other" && (X.user.staff || X.state.mode !== "tactical" || X.state.free?.[a.actor] || P1.isOnTurn(X.state, a.actor));
  if (asAction) {
    if (X.state.stack.length) return bad("busy");
    if (queueHolds(X.state)) return bad("busy", { reason: "triggersFirst" });
    const inst = makeInst(X, { action: "other", actor: a.actor, decl: { action: "other", targets: [], helpers: [], exploits: [], stressTotal: 0, text }, flow: "other" });
    inst.tx = openTx(X, { inst: inst.id }); inst.status = "manual"; pushInst(X, inst);
    emit(X, inst, { type: "actionDeclared", decl: { action: "other" }, cost: "none", stress: 0, targets: [] });
    return ok({ inst: inst.id });
  }
  if (Object.values(X.state.prompts).filter((p) => p.kind === "exception" && !p.inst && p.about === a.actor).length >= 3) return bad("rate");
  /* U3: the request may name the declaration it was about (the dock sends it): the GM's card shows it, and a grant runs that declaration.
     D42: the rule that said no is the engine's own answer about that declaration at this moment (refusalsOf), every refusal of it, not the
     word the asking client sent: a crafted request put "no action left" on the card of a punch at somebody out of reach, and the grant
     overruled the reach. The client's word stays only on a request that names no declaration (a grant of that runs nothing). */
  const entry = isObj(a.decl) && kind !== "other" ? C.entryFor(X.state, a.actor, a.decl.action, X.facts) : null;
  const decl = entry && entry.reaction?.effect !== "defence" && entry.id !== "gmRoll" ? (({ helpers, exploits, stressTotal, exception, ...rest }) => rest)(sanitizeDecl(a.decl, entry.id, false)) : undefined;
  const no = decl ? refusalsOf(X, a.actor, decl) : null;
  const reason = no ? no.reasons[0] : typeof a.reason === "string" && /^[A-Za-z]{1,40}$/.test(a.reason) ? a.reason : undefined;
  openPrompt(X, null, { key: "x", kind: "exception", to: "gm", about: a.actor, free: 1, options: [{ id: "grant", label: "ITAC.opt.grant" }, { id: "deny", label: "ITAC.opt.deny" }], data: { text, inst: P1.isId(a.inst) ? a.inst : undefined, ...(kind === "other" ? { other: 1 } : {}), ...(reason ? { reason } : {}), ...(no ? { reasons: no.reasons, ...(no.waive ? { waive: 1 } : {}) } : {}), ...(decl ? { decl } : {}) } }, null);
  return ok(kind === "other" ? { asked: 1 } : undefined);
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
      /* D48: "Accept for them" takes the result the desk showed (a roll that may still be pushed) as it stands. When the roller's push
         came in first, that result is no more: the request was still carried out, put the old sixes back and threw away the stunt card
         of a push whose stress was paid. It is out of date now; a number the GM types in (no `accept`) stays an override of anything. */
      if (a.accept === true) { const rec = I.rolls[key]; if (!rec || rec.forced != null || rec.sixes !== sixes || !rec.pushable || (rec.pushed ?? 0) !== Math.max(0, Math.trunc(Number(a.pushed) || 0))) return bad("stale", { roll: key }); }
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
      /* U4: the exchange stands on its dice (a roll somebody owes, a push not taken) and the result of every target is now the GM's word:
         what it was still waiting for is dropped and it goes on to that result (flows/attack.mjs roll). Before the dice (a reaction still
         open) the word is only recorded, as before: the GM may still set the damage, and answers the reaction for whoever is missing. */
      if (I.step === "roll" && idx("roll") < idx("outcome") && I.decl.targets.every((t) => typeof I.data.forced.outcome[t] === "boolean")) {
        dropPrompts(X, (p) => p.inst === I.id && p.step === I.step);
        delete I.data.hold; delete I.data.holdKey; I.data.window = null; I.step = "roll"; I.status = "open";
      }
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
    case "askRoll": {                                                                       // U4: the dice somebody owes are asked for again (a new request id: the old one is void)
      const key = String(a.roll ?? "").slice(0, 40), rec = I.rolls[key];
      if (!rec?.req || rec.forced != null || rec.sixes != null) return bad("locked");
      const who = rec.who === "hazard" ? null : X.facts.c(rec.who), rid = nextId(X, "r"), users = rollUsers(X, who, I);
      noteOverride(X, I, op, rec.req.rid, rid);
      I.rolls[key] = { ...rec, req: { ...rec.req, rid, users, at: X.host.now() } };
      setInst(X, I);
      X.did++;
      await X.host.perform({ t: "rollRequest", inst: I.id, key, rid, users, actorUuid: who?.actorUuid ?? null, combatant: rec.who, attr: rec.attr, pool: rec.pool, dice: rec.req.dice, maxPush: rec.req.maxPush, secret: rec.secret, label: rec.req.label, ...(rec.req.mode ? { mode: rec.req.mode } : {}) });
      return ok({ inst: I.id });
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
      I.decl.targets = [...new Set(I.decl.targets.map((t) => (t === a.from ? a.to : t)))];      // D92: turned onto somebody who is a target already, that one stays one target
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
    const r = P1.pay(X.state, I.actor, res.cost, { force: true }, { action: I.action, inst: I.id, tags: C.entryFor(X.state, I.actor, I.action, X.facts)?.tags ?? [] });
    if (r.ok) { write(X, I.tx, ["ledger", I.actor], r.ledger, I, "manual"); I.entry = r.entryId; }
    else (I.data.notes ??= []).push({ note: "costNotCharged", cost: res.cost, reason: r.reason });      // no unit of that kind is left: nothing is invented, the GM sees the note
  }
  for (const d of (Array.isArray(res.damage) ? res.damage : []).slice(0, 24)) {
    const c = X.facts.c(d?.target), amount = Math.max(0, Math.trunc(Number(d?.amount) || 0));
    if (!c || !amount) continue;
    const R = { effects: [] }, ab = K.copiesAbsorb({ state: X.state, facts: X.facts }, R, d.target, amount);                 // [B1910]: the GM's number is damage too, the copy bonus takes it first
    for (const e of R.effects) await applyEffect(X, I, e, "manual");
    if (ab.taken) await perform(X, I.tx, { t: "actor", uuid: c.actorUuid, path: "health", to: damage.applyDamage({ health: c.health, taken: ab.taken }).health, tx: I.tx }, I, "manual");   // [B2708]: never below 0
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
    /* D53 [B2436], [R10] (D1, D2): "stunned" IS the lost next turn; the mark and the ledger's lost turn belong together. The GM's switch
       wrote the mark alone: switched off after a real Stun, the turn was still taken away with no mark to say why; switched on, no
       turn was lost. Now the GM's word on that state writes both, in one journal entry (one undo). */
    case "statusAdd": if (c(a.combatant) && typeof a.status?.id === "string") {
      const src = a.status.source ?? { kind: "gm", name: "gm" }, x = M.statusAdd(X.state, a.combatant, { ...a.status, source: src }); w(x.path, x.to);
      if (a.status.id === "stunned" && X.state.ledger?.[a.combatant] && !X.state.ledger[a.combatant].lostTurn) w(["ledger", a.combatant], Lg.loseNextTurn(X.state.ledger[a.combatant], M.source(src)));
    } else err = "badInput"; break;
    case "statusRemove": if (P1.isId(a.combatant)) {
      const x = M.statusRemove(X.state, a.combatant, String(a.id)); w(x.path, x.to);
      const L = X.state.ledger?.[a.combatant];
      if (String(a.id) === "stunned" && L && (L.lostTurn || L.noInterrupts)) w(["ledger", a.combatant], Lg.clearLostTurn(L));
    } else err = "badInput"; break;
    /* `value`: the number to set; `delta` (P8f): a step from what the character has NOW, read by the executor at the moment of the
       edit. The map's steppers send steps: an absolute number counted on the GM's screen from what stood there when the menu opened
       took back whatever hit the character in the meantime. */
    case "setHealth": case "setResolve": {
      const cc = c(a.combatant), hp = op === "setHealth", cur = Number(hp ? cc?.health : cc?.resolve), max = Number(hp ? cc?.maxHealth : cc?.maxResolve);
      const d = Number.isFinite(Number(a.delta)) && a.value == null ? Math.trunc(Number(a.delta)) : null;
      const v = d == null ? Math.trunc(Number(a.value)) : Math.max(0, Math.min(Number.isFinite(max) && max > 0 ? max : Infinity, (Number.isFinite(cur) ? cur : 0) + d));
      if (!cc || !Number.isFinite(v) || v < 0) { err = "badInput"; break; }
      await perform(X, tx, { t: "actor", uuid: cc.actorUuid, path: hp ? "health" : "resolve", to: v, tx });
      /* D59 [B2707]: Health is the character's state, so a correction of it corrects the state with it, in the same journal entry.
         Raised from 0: no longer broken, nor knocked out by that break. Set to 0: broken (it holds and carries nobody); no injury is
         rolled and nobody is asked: the correction is the GM's word (ruling P8f-R3, question P8f-2). A machine and a challenge have
         no such state (mods-pure.outOfAction). */
      if (hp && cc.kind !== "vehicle" && cc.kind !== "challenge" && Number.isFinite(cur)) {
        const drop = (who, id) => { if (M.hasStatus(X.state, who, id)) { const x = M.statusRemove(X.state, who, id); w(x.path, x.to); } };
        if (v > 0) { drop(a.combatant, "broken"); if (cur <= 0) drop(a.combatant, "unconscious"); }
        else if (cur > 0) {
          if (!M.hasStatus(X.state, a.combatant, "broken")) { const x = M.statusAdd(X.state, a.combatant, { id: "broken", source: { kind: "gm", name: "gm" } }); w(x.path, x.to); }
          for (const e of [...K.grappleRelease(X.state, a.combatant), ...K.carryRelease(X.state, a.combatant)]) drop(e.who, e.id);
        }
      }
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
    case "npcPolicy": if (P1.isId(a.combatant) && isObj(a.policy)) { const pol = {}; for (const k of ["block", "dodge"]) if (["ask", "always", "never"].includes(a.policy[k])) pol[k] = a.policy[k]; if (["ask", "never"].includes(a.policy.push)) pol.push = a.policy.push; if (["ask", "ko", "kill", "crit"].includes(a.policy.onBroken)) pol.onBroken = a.policy.onBroken; if (typeof a.policy.major === "boolean") pol.major = a.policy.major; if (a.policy.quick === true) pol.quick = true;      /* U61: a minion group settled quickly (flows/kit.mjs quickGroup) */ if (["defence", "turn"].includes(a.policy.keepQuickFor)) pol.keepQuickFor = a.policy.keepQuickFor; w(["npc", a.combatant], pol); } else err = "badInput"; break;
    case "ledgerEdit": {                                                                    // one implementation with the reducer's operation (ops-pure.ledgerEditOf); here it is journaled
      if (!P1.isId(a.combatant) || !X.state.ledger[a.combatant]) { err = "gone"; break; }
      const legacy = a.edit ? a : P1.isId(a.voidEntry) ? { ...a, edit: "void", entry: a.voidEntry } : isObj(a.grant) ? { ...a, edit: "grant", grant: { template: "gm", ...a.grant } } : null;
      const r = legacy ? ledgerEditOf(X.state, legacy) : null;
      if (!r?.ok) { err = r?.code ?? "badInput"; errParams = r?.params ?? {}; break; }
      w(["ledger", a.combatant], r.ledger);
      if (legacy.edit === "clearLostTurn" && M.hasStatus(X.state, a.combatant, "stunned")) { const x = M.statusRemove(X.state, a.combatant, "stunned"); w(x.path, x.to); }      // the mark goes with the lost turn it stands for [B2436]
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
    /* ---- P6: what the GM says about an item of a sheet (which book entry it is, whether it is out of the fight, what an Immunity is about) and who
       summoned a combatant [I14]. Both are edits of documents outside the state; the host hands back what stood there before, so the journal undoes them. */
    case "kitFlag": {
      const cc = c(a.combatant), key = ["kit", "off", "types", "alt"].includes(a.key) ? a.key : null;
      if (!cc || !key || typeof a.item !== "string") { err = "badInput"; break; }
      const value = key === "off" || key === "alt" ? a.value === true : key === "kit" ? (typeof a.value === "string" && a.value ? a.value.slice(0, 60) : null) : Array.isArray(a.value) ? a.value.filter((s) => typeof s === "string" && s).map((s) => s.slice(0, 24)).slice(0, 12) : null;
      await perform(X, tx, { t: "kitFlag", uuid: cc.actorUuid, item: a.item.slice(0, 40), key, value, tx });
      break;
    }
    case "summonSet": {
      if (!c(a.combatant) || (a.owner != null && !c(a.owner)) || a.owner === a.combatant) { err = "badInput"; break; }
      await perform(X, tx, { t: "summonFlag", combatant: a.combatant, owner: a.owner ?? null, tx });
      break;
    }
    /* W1 (U44): the GM put a token down by hand on the map (Alt-drop: no route, no price, nobody asked). The map has already moved it
       and handed over the op that puts it back; the placement becomes a transaction of its own, so it is in the journal and is
       undone like every other override. */
    case "placed": {
      const cc = c(a.combatant), inv = a.inverse;
      if (!cc || !isObj(inv) || inv.op !== "tokens" || !Array.isArray(inv.rows) || !inv.rows.length || inv.rows.length > 24) { err = "badInput"; break; }
      await perform(X, tx, { t: "placed", who: a.combatant, inverse: J.clone(inv), to: typeof a.zone === "string" ? a.zone.slice(0, 60) : null, tx });
      /* D55 [B2496-2497], [B2392] (D7, D12): a grapple and a carry are two characters in ONE place. Put somewhere else by hand, the
         pair is over, as after a move, a throw or a fall (flows/kit.separated), in this same journal entry: undo puts the token back
         and the link with it. */
      for (const e of K.separated(view(X), [a.combatant])) if (e.t === "status-" && M.hasStatus(X.state, e.who, e.id)) { const x = M.statusRemove(X.state, e.who, e.id); w(x.path, x.to); }
      emit(X, null, { type: "placed", combatant: a.combatant, zone: typeof a.zone === "string" ? a.zone.slice(0, 60) : undefined, cause: "gm" });
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
      /* D102: the HUD and the engine read the challenge's sheet, so a book preset writes its rating and time there (journaled with the
         set-up, undone with it). `keep: true` keeps the sheet's numbers (the GM's own). Question C-D102 (combat-questions.md). */
      const nums = preset && a.clear !== true && a.keep !== true ? Challenge.presetNumbers(preset) : { rating: null, time: null };
      const put = async (path, to) => { if (to != null && Number(cc[path]) !== to) await perform(X, tx, { t: "actor", uuid: cc.actorUuid, path, to, tx }); };
      await put("maxHealth", nums.rating); await put("health", nums.rating);
      await put("maxResolve", nums.time); await put("resolve", nums.time);
      emit(X, null, { type: "challenge", challenge: a.challenge, rating: nums.rating ?? cc.health, timeLeft: nums.time ?? cc.resolve, state: "setup", preset });
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
      w(["chase"], plan.chase); w(["kind"], "chase"); if (X.state.chaseEnded) w(["chaseEnded"], null); w(["init"], { ...S.newInit(), deck: X.state.init?.deck ?? 10 });      // CHASE (U168): the card of the last chase goes
      X.state = { ...X.state, init: { ...X.state.init, cur: X.state.init.cur ?? null, curMember: X.state.init.curMember ?? null } };       // the journal writes "nobody" by removing the key; the state keeps it as null
      for (const p of plan.puts) await perform(X, tx, { t: "zput", who: p.who, to: "@chase", group: p.group, tx });
      emit(X, null, { type: "chase", state: "start", distance: plan.chase.distance, sides: plan.chase.sides });
      break;
    }
    case "chaseSet": {
      if (P1.isId(a.unit) && X.state.stack.length) { err = "busy"; break; }                  // P8e-3: nobody joins or drops out under a chase roll that is being made (the one asked to roll could leave it); the distance can still be set
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
      /* CHASE (U168): how the chase ended stands in the state until the next chase starts, so every seat shows the same end card (each
         seat puts it away on its own, by its number `n`) */
      w(["chaseEnded"], { n: (Number(X.state.chaseEnded?.n) || 0) + 1, outcome: Chase.OUTCOMES.includes(a.outcome) ? a.outcome : "combat", distance: ch.distance, lostAt: ch.lostAt, rounds: ch.round ?? 0, round: X.state.round, sides: { prey: (ch.sides?.prey ?? []).slice(), pursuer: (ch.sides?.pursuer ?? []).slice() } });
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
  /* an inverse the host could not carry out (the map refused it, a document is gone): the undo goes on, since the writes before it
     cannot be taken back as one, and the answer and the event NAME what stayed as it was, for the GM to put right by hand */
  const f0 = X.failed.length, host = (id, op, eff) => inverse(X, op, eff, id);
  for (const id of list) {
    const tx = X.log.list.find((t) => t.id === id), n0 = X.failed.length;
    for (const op0 of [...tx.ops].reverse()) {
      const op = liveOp(X, op0, tx.round);
      if (op.t === "state") {
        if (a.force && mode === "leave" && J.driftOf(op, X.state)) continue;
        X.state = J.applyStateOp(X.state, op, true);
      } else if (op.t === "actor" && a.force) {
        const cur = X.facts.actorValue?.(op.uuid, op.path), to = cur !== undefined && J.driftOf(op, cur) ? J.resolveDrift(op, cur, mode ?? "restore") : op.from;
        if (to !== undefined) await host(id, op, { t: "actor", uuid: op.uuid, path: op.path, to });
      } else { const eff = J.inverseEffect(op); if (eff) await host(id, op, eff); }
    }
    X.log = J.markUndone(X.log, id, X.host.now());
    /* U10: the players are told what the GM took back: the result they read is marked, and a line of its own says so */
    const was = (X.state.news ?? []).find((n) => n.tx === id && n.kind === "action" && !n.undone);
    if (was) X.state = { ...X.state, news: X.state.news.map((n) => (n.tx === id ? { ...n, undone: 1 } : n)) };
    pushNews(X, { kind: "undo", ...(was ? { actor: was.actor, action: was.action, ...(was.name ? { name: was.name } : {}), ...(was.secret ? { secret: 1 } : {}) } : {}) });
    emit(X, null, { type: "undo", tx: id, ...(X.failed.length > n0 ? { failed: X.failed.slice(n0).map((f) => ({ t: f.t, reason: f.reason })) } : {}) });
  }
  X.facts = liveFacts(X); X.changed = true;
  return ok({ undone: list });                                                              // what an inverse could not do is in the answer's `failed` (handle)
}
async function opHazard(X, a) {
  const h = isObj(a.hazard) ? { kind: String(a.hazard.kind), intensity: Math.max(1, Math.min(12, Math.trunc(Number(a.hazard.intensity) || 1))), inZone: a.hazard.inZone !== false, amount: Math.max(0, Math.trunc(Number(a.hazard.amount) || 0)), armor: a.hazard.armor === true, source: typeof a.hazard.source === "string" ? a.hazard.source.slice(0, 24) : undefined, cause: a.hazard.cause, id: String(a.hazard.id ?? a.hazard.kind).slice(0, 40), zone: typeof a.hazard.zone === "string" ? a.hazard.zone.slice(0, 40) : undefined } : null;
  const inst = makeInst(X, { action: "hazard", actor: null, decl: { action: "hazard", targets: [...new Set((Array.isArray(a.targets) ? a.targets : []).filter(P1.isId))].slice(0, 40), helpers: [], exploits: [], stressTotal: 0 }, cause: a.cause === "trigger" ? "trigger" : "gm", flow: "hazard", data: { hazard: h }, initiator: { type: "hazard", id: h?.id ?? "hazard" }, parent: top(X)?.id ?? null });
  const l = Hazard.legality(view(X), inst);
  if (!l.ok) return bad("illegal", { reason: l.reason });
  inst.tx = openTx(X, { inst: inst.id });
  if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); inst.cause = "trigger"; }
  pushInst(X, inst);
  if (!a.quiet) emit(X, inst, { type: "trigger", at: a.at ?? "gm", subject: { zone: h.zone }, run: { type: h.kind } });
  return ok({ inst: inst.id });
}

/** P7, GM op: one round of the chase [B3432] as an instance (flows/chase.mjs). */
async function opChaseRound(X, a = {}) {
  if (X.state.stack.length) return bad("busy");
  if (a.obstacle != null && !Chase.OBSTACLES.includes(a.obstacle)) return bad("badInput", { field: "obstacle" });      // CHASE (U176)
  const spec = Chase.roundSpec(a.obstacle ?? null);
  const inst = makeInst(X, { action: spec.action, actor: null, decl: spec.decl, cause: "gm", flow: spec.flow });
  const l = FLOWS[inst.flow].legality(view(X), inst);
  if (!l.ok) return bad("illegal", { reason: l.reason, ...l.params });
  inst.tx = openTx(X, { inst: inst.id });
  pushInst(X, inst);
  emit(X, inst, { type: "actionDeclared", decl: { action: spec.action }, cost: "none", stress: 0, targets: [] });
  return ok({ inst: inst.id });
}
/** D101: would the chase roll be legal in the NEXT round (the one the director opens for a second roll in a round)? Pure: nothing is
    written, no round is opened. -> { ok:true } | the refusal opChaseRound would answer */
export function chaseRoundProbe(state, host) {
  const ch = state?.chase;
  const X = makeX(ch ? { ...state, chase: { ...ch, rolled: null } } : state, null, host, null);
  const l = FLOWS[Chase.roundSpec().flow].legality(view(X));
  return l.ok ? { ok: true } : bad("illegal", { reason: l.reason, ...l.params });
}
/* P7 [R22] [I12] [B2841]: the end of a round runs the clock of every challenge down by one. One transaction per challenge, so the GM can
   take a tick back; at 0 the "time is up" card of the round driver opens (its answer `run` comes back as the effect `challengeFail`).
   The end-of-round side effects that are due are GM-run instances. Off with the world setting `challengesCombatTime`. */
async function challengeClock(X) {
  if (X.host.setting?.("challengesCombatTime") === false) return;
  for (const p of (X.host.parts?.() ?? []).filter((x) => x.challenge && !x.defeated)) {
    /* FXN (bug hunt 4, suspicion 4): while the GM's "old clock" card about this challenge (U157 challengeStale) waits unanswered, its
       clock does not run: nothing changes without that word, so "time is up" cannot open beside it and "Reset" never puts back a
       clock whose failure card already stands */
    if (Object.values(X.state.prompts ?? {}).some((q) => q.kind === "challengeStale" && q.about === p.id && !q.answered)) continue;
    const c = X.facts.c(p.id), r = Challenge.clock(c, Challenge.cfgOf(X.state, p.id));
    if (!r) continue;
    if (r.to != null && r.to !== c.resolve) {
      const tx = openTx(X, {});
      await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "resolve", to: r.to, tx });
      closeTx(X, tx, { pub: c.hidden ? "" : `${cMark(p.id)}: {ITAC.journal.clock} ${r.to}`, who: whoOf(X, [p.id]), gm: `${c.name ?? ""}: {ITAC.journal.clock} ${c.resolve} -> ${r.to}` });
      emit(X, null, { type: "challenge", challenge: p.id, rating: c.health, timeLeft: r.to, state: r.failed ? "failed" : "active", clock: 1 });
    }
    if (r.failed && !Object.values(X.state.prompts).some((q) => q.kind === "challengeFail" && q.about === p.id && !q.answered))
      openPrompt(X, null, { key: "cf", kind: "challengeFail", to: "gm", about: p.id, options: [{ id: "run", label: "run" }, { id: "other", label: "other" }], data: { effects: Challenge.failKinds(Challenge.cfgOf(X.state, p.id)) } }, "roundEnd");
    for (const kind of r.effects) pushManual(X, p.id, kind, { at: "roundEnd" });
  }
}
/* U157: a challenge whose clock counted in rounds already ran (time left below its limit) when this fight starts was counted down in an
   earlier fight: its countdown would mean nothing here (at 0 it never ticks again). The GM gets ONE card per such challenge: start its
   clock again (the time back to its limit), or leave it as it is. Nothing changes without that word. */
function challengeStale(X) {
  if (X.host.setting?.("challengesCombatTime") === false) return;
  for (const p of (X.host.parts?.() ?? []).filter((x) => x.challenge && !x.defeated)) {
    const c = X.facts.c(p.id);
    if (!c || (c.timeUnit ?? "rounds") !== "rounds" || !(c.maxResolve > 0) || !(c.resolve < c.maxResolve) || !(c.health > 0)) continue;
    if (Object.values(X.state.prompts).some((q) => q.kind === "challengeStale" && q.about === p.id && !q.answered)) continue;
    openPrompt(X, null, { key: "cs", kind: "challengeStale", to: "gm", about: p.id, options: [{ id: "reset", label: "ITAC.opt.clockReset" }, { id: "keep", label: "ITAC.opt.clockKeep" }], data: { left: Math.max(0, c.resolve), max: c.maxResolve } }, "start");
  }
}
async function challengeReset(X, cid) {
  const c = P1.isId(cid) ? X.facts.c(cid) : null;
  if (!c || !(c.maxResolve > 0) || c.resolve === c.maxResolve) return;
  const tx = openTx(X, {}), from = c.resolve, max = c.maxResolve;
  await perform(X, tx, { t: "actor", uuid: c.actorUuid, path: "resolve", to: max, tx });
  closeTx(X, tx, { pub: c.hidden ? "" : `${cMark(cid)}: {ITAC.journal.clockReset} ${max}`, who: whoOf(X, [cid]), gm: `${c.name ?? ""}: {ITAC.journal.clockReset} ${from} -> ${max}` });
  emit(X, null, { type: "challenge", challenge: cid, rating: c.health, timeLeft: max, state: "active", clock: 1 });
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
    closeTx(X, tx, { pub: c.hidden ? "" : `${cMark(cid)}: {ITAC.journal.wardReset}`, who: whoOf(X, [cid]), gm: `${c.name ?? ""}: {ITAC.journal.wardReset} (${r.ward.dice})` });
    emit(X, null, { type: "challenge", challenge: cid, rating: r.ward.rating, timeLeft: r.ward.time, state: "reset", dice: r.ward.dice });
  }
  else if (cfg && Object.keys(cfg).length && !cfg.done && X.state.challenges?.[cid]) {      // D47 [B2841]: failed for good, its clock stops (journaled, so an undo gives the challenge back); what it had set going stays with the GM
    const tx = openTx(X, {});
    write(X, tx, ["challenges", cid, "done"], "failed");
    closeTx(X, tx, { pub: c.hidden ? "" : `${cMark(cid)}: {ITAC.journal.challengeFailed}`, who: whoOf(X, [cid]), gm: `${c.name ?? ""}: {ITAC.journal.challengeFailed}` });
    emit(X, null, { type: "challenge", challenge: cid, rating: c.health, timeLeft: c.resolve, state: "failed", done: 1 });
  }
  for (const kind of r.manual) if (!(kind === "blast" && failBlast(X, cid, c, cfg))) pushManual(X, cid, kind, { at: "onFail" });
}
/* D111 (spec 9.10: "the Blast 10 explosion of the Doomsday Device as a hazard instance"): the explosion of a failed challenge is the
   engine's blast hazard [B2856], [B2921]: the rating of the challenge's effect, everybody in the challenge's zone. Without a zone on the
   map (or nobody in it) it stays the GM's item. -> true when the instance stands */
function failBlast(X, cid, c, cfg) {
  const e = (cfg?.effects ?? []).find((x) => x.when === "onFail" && x.kind === "blast"), zone = X.facts.zone?.(cid)?.key;
  if (!e || typeof zone !== "string" || !zone) return false;
  const targets = (X.facts.inZoneKey?.(zone) ?? []).filter((id) => { const f = X.facts.c(id); return id !== cid && !!f && f.kind !== "challenge" && f.present !== false && !(f.kind === "minions" && !(Number(f.health) > 0)); });      // H2-2: D110's rule, an emptied group is out
  if (!targets.length) return false;
  const spec = Hz.specOf({ type: "blast", rating: e.rating, targets }, { zone }, view(X));
  if (!spec) return false;
  const inst = makeInst(X, { action: spec.action, actor: null, decl: spec.decl, cause: "trigger", flow: spec.flow, data: { ...spec.data, challengeFx: fxOf(cid, "blast", c) }, initiator: { type: "trigger", id: "blast" }, parent: top(X)?.id ?? null });
  if (!FLOWS[inst.flow].legality(view(X), inst).ok) return false;
  inst.tx = openTx(X, { inst: inst.id });
  if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); }
  pushInst(X, inst);
  emit(X, inst, { type: "trigger", at: "onFail", subject: { zone }, run: { type: "blast" } });
  return true;
}
/* U110: what a challenge does, kept on the instance, so the journal and the news name it in each reader's language */
const fxOf = (cid, kind, c) => ({ challenge: cid, kind: String(kind).slice(0, 40), ...(c?.hidden ? { hidden: 1 } : {}) });
/** A side effect the GM runs by hand (spec 5.3): an instance that names it, with the challenge as its source. */
function pushManual(X, cid, kind, o = {}) {
  const name = X.facts.c(cid)?.name ?? cid;
  const inst = makeInst(X, { action: "other", actor: null, decl: { action: "other", targets: [], helpers: [], exploits: [], stressTotal: 0, text: `${name}: ${kind}`.slice(0, 300) }, cause: "trigger", flow: "other",
    data: { trigger: { at: o.at ?? null, run: { type: "challenge", kind, challenge: cid }, source: { kind: "challenge", owner: cid, name } }, challengeFx: fxOf(cid, kind, X.facts.c(cid)) }, initiator: { type: "trigger", id: String(kind).slice(0, 40) }, parent: top(X)?.id ?? null });
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
  /* D90: each thing the round driver hands over stands for itself. One that fails (a rejected write of a sheet) is named in the answer
     (`failed`), what it had written is closed into the journal (sweepTx), and the others still happen: a due trigger is not lost
     because the recovery before it could not be written. */
  for (const fx of Array.isArray(effects) ? effects : []) {
    try { await systemOne(X, fx, triggers); }
    catch (e) { warn(X, "sys", e, { type: fx?.type }); X.failed.push({ t: "sys", what: String(fx?.type ?? "error").slice(0, 40) }); X.facts = liveFacts(X); X.changed = true; }
  }
  for (const t of triggers.reverse()) {
    try { await pushTrigger(X, t); }
    catch (e) { warn(X, "trigger", e, { id: t?.id }); X.failed.push({ t: "sys", what: "trigger" }); X.changed = true; }
  }
}
async function systemOne(X, fx, triggers) {
  {
    if (fx?.type === "stress") {
      const c = X.facts.c(fx.combatant), n = Math.max(0, Math.trunc(Number(fx.n) || 0));
      if (!c || !n) return;
      const s = damage.applyStress({ resolve: c.resolve, stress: n });                      // [B2816]
      if (!s.lost) return;
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
    } else if (fx?.type === "summonLeave") {                                                 // P6 [B1812]: its owner is broken, the group is, or the scene is over
      const tx = openTx(X, {});
      for (const id of Array.isArray(fx.combatants) ? fx.combatants : []) await perform(X, tx, { t: "summonRemove", combatant: id, tx });
      closeTx(X, tx, { pub: "{ITAC.journal.summonLeft}", gm: "{ITAC.journal.summonLeft}" });
    } else if (fx?.type === "turnPassed") {                                                  // U9: the round driver let a turn pass (ops-pure.openTurn); the GM reads it in the journal, the table in its news
      const c = X.facts.c(fx.combatant), why = ["broken", "unconscious", "dead"].includes(fx.reason) ? fx.reason : "broken";
      if (!c) return;
      const line = `${c.name ?? ""}: {ITAC.journal.turnPassed.${why}}`;
      closeTx(X, openTx(X, {}), { pub: c.hidden ? "" : `${cMark(fx.combatant)}: {ITAC.journal.turnPassed.${why}}`, who: whoOf(X, [fx.combatant]), gm: line, keep: true });
      pushNews(X, { kind: "turn", actor: fx.combatant, result: `pass.${why}` });             // view-pure drops it for whoever the combatant is concealed from
    } else if (fx?.type === "abortInstances") {
      for (const inst of [...X.state.stack].reverse()) if (inst.actor === fx.actor && instOf(X, inst.id)) await abortInst(X, inst.id, true);
      dropPrompts(X, (p) => p.about === fx.actor);
      targetGone(X, fx.actor);
    } else if (fx?.type === "roundEnd") await challengeClock(X);                          // P7
    else if (fx?.type === "combatStart") challengeStale(X);                                  // U157
    else if (fx?.type === "challengeReset") await challengeReset(X, fx.challenge);
    else if (fx?.type === "challengeFail") await challengeFailRun(X, fx.challenge);
    else if (fx?.type === "trigger" && isObj(fx.trigger)) triggers.push(fx.trigger);
  }
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
  /* H2-1 (U110): a challenge's own side effect at a round point (the ward's blast) names the challenge and the effect like a failed one
     (pushManual): the journal and the news name it, and a challenge hidden from the players keeps it secret */
  const cfx = run.type === "challenge" && P1.isId(run.challenge) && X.facts.c(run.challenge) ? fxOf(run.challenge, run.kind ?? "challenge", X.facts.c(run.challenge)) : null;
  const inst = makeInst(X, { action: "other", actor, decl: { action: "other", targets: [], helpers: [], exploits: [], stressTotal: 0, text: String(t.source?.name || run.type || "").slice(0, 300) }, cause: "trigger", flow: "other",
    data: { trigger: { id: t.id, at: t.at, run: J.clone(run), source: J.clone(t.source ?? null) }, ...(cfx ? { challengeFx: cfx } : {}) }, initiator: { type: "trigger", id: String(t.id ?? "trigger").slice(0, 40) }, parent: top(X)?.id ?? null });
  inst.tx = openTx(X, { inst: inst.id }); inst.status = "manual";
  if (inst.parent) { const P = J.clone(instOf(X, inst.parent)); P.status = "waiting"; setInst(X, P); }
  pushInst(X, inst);
}

export const PLAYER_OPS = Object.freeze(["declare", "amend", "cancel", "answer", "help", "move", "exception", "other", "preview"]);       // endTurn, holdOff, mark: director-pure.mjs
export const GM_INST_OPS = Object.freeze(["setPool", "setSixes", "setOutcome", "setDamage", "skipStep", "goToStep", "abort", "manual", "retarget", "askRoll"]);
export const GM_EDIT_OPS = Object.freeze(["ledgerEdit", "statusAdd", "statusRemove", "setHealth", "setResolve", "tokenAdd", "tokenRemove", "triggerAdd", "triggerRemove", "counterSet", "effectAdd", "effectEnd",
  "powerGrant", "powerRevoke", "itemState", "reveal", "knowledgeSet", "karmaNote", "npcPolicy", "setFree", "setMode", "zoneSet", "levelSet", "borderSet", "zoneOp",
  "challengeSetup", "vehicleSet", "chaseStart", "chaseSet", "chaseEnd", "kitFlag", "summonSet", "placed"]);                                                                    // P7
export const GM_OPS = Object.freeze([...GM_INST_OPS, ...GM_EDIT_OPS, "answerFor", "undo", "hazard", "forcedMove", "fall", "hazardRun", "chaseRound", "nudge"]);       // the initiative and round operations of spec 14.2 are the director's (director-pure.mjs)

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
    case "preview": return opPreview(X, req);
    case "other": return opAsk(X, req, "other");
    case "move": return opDeclare(X, { actor: req.actor, gm: req.gm, decl: { ...(isObj(req.decl) ? req.decl : {}), action: typeof req.action === "string" ? req.action : "move", to: req.to, mode: req.mode, stress: req.stress, pay: req.pay, force: req.force, carry: req.carry, airborne: req.airborne } });   // P3: a move is a declaration like any other
    case "forcedMove": case "fall": return opForced(X, op, req);
    case "undo": return opUndo(X, req);
    case "hazard": return opHazard(X, req);
    case "hazardRun": return opHazardRun(X, req);
    case "chaseRound": return opChaseRound(X, req);
    case "nudge": return opNudge(X, req);
    default:
      if (GM_INST_OPS.includes(op)) return gmInstOp(X, op, req);
      if (GM_EDIT_OPS.includes(op)) return gmEdit(X, op, req);
      return bad("badInput", { op: String(op ?? "").slice(0, 24) });
  }
}
/* U59: THE GM'S NUDGE. The table waits for somebody's answer or dice; the GM asks them to hurry. Nothing of the fight changes and nothing is
   journaled: the ones waited for get one line of news (state.news, kind "nudge", read only by them: view-pure.viewFor), which their own
   surface shows. A newer nudge of the same people replaces the older one. No limit of time follows from it [U]. */
function opNudge(X, a) {
  let to = null, what = null;
  if (P1.isId(a.prompt)) { const p = X.state.prompts[a.prompt]; if (!p || p.answered) return bad("gone"); to = p.to; what = { prompt: p.id, ask: p.kind }; }
  else if (P1.isId(a.inst)) { const r = instOf(X, a.inst)?.rolls?.[String(a.roll ?? "").slice(0, 40)]; if (!r?.req || r.forced != null || (r.sixes != null && !r.pushable)) return bad("gone"); to = { users: r.req.users }; what = { inst: a.inst, roll: r.key }; }
  else return bad("badInput");
  const users = (isObj(to) && Array.isArray(to.users) ? to.users : []).filter((u) => { const x = X.facts.user(u); return !!x && !x.staff && x.active; }).slice(0, 12);
  if (!users.length) return bad("gone");                                                    // nobody at the table to nudge (the GM answers for an absent player: spec 13.1 proxy)
  const same = (n) => n.kind === "nudge" && Array.isArray(n.to) && n.to.length === users.length && n.to.every((u) => users.includes(u));
  X.state = { ...X.state, news: (X.state.news ?? []).filter((n) => !same(n)) };
  pushNews(X, { kind: "nudge", to: users, ...what });
  return ok();
}
function takeRoll(X, r) {
  const inst = instOf(X, r.inst), rec = inst?.rolls?.[r.key];
  if (!rec?.req || rec.req.rid !== r.rid || rec.forced != null) return false;
  const author = X.facts.user(r.author);
  if (!author || !(author.staff || rec.req.users.includes(r.author))) return false;         // spec 11: identity = the message author, checked against the user the roll was asked from
  if (!Number.isFinite(r.sixes) || r.sixes < 0) return false;
  /* a result that is in stays: only its own message (accepted) or a push of it (one push more) replaces it. A second roll of the same
     request (two owners of one hero, a click on "Roll" after the dice were already thrown) changes nothing. */
  if (rec.sixes != null && !(rec.pushable && ((typeof r.messageId === "string" && r.messageId === rec.messageId) || (Math.trunc(Number(r.pushed) || 0) > (rec.pushed ?? 0))))) return false;
  const I = J.clone(inst);
  I.rolls[r.key] = { ...rec, sixes: Math.trunc(r.sixes), ones: Math.max(0, Math.trunc(Number(r.ones) || 0)), pushed: Math.max(0, Math.trunc(Number(r.pushed) || 0)), pushable: r.pushable === true && rec.req.maxPush !== 0, messageId: typeof r.messageId === "string" ? r.messageId : rec.messageId };
  setInst(X, I);
  return true;
}

/* ------------------------------------------------------------------ entry point */
export async function handle({ state, log }, input, host) {
  const user = input?.t === "req" ? input.user : null;
  const X = makeX(state, log, host, user);
  let env, driving = false;
  try {
    if (!state) return { state, log, env: bad("off"), events: [], changed: false };
    if (input?.t === "req") {
      if (!user || !P1.isId(user.id)) return { state, log, env: bad("untrusted"), events: [], changed: false };
      if (input.rid && state.seen.includes(input.rid)) return { state, log, env: { ok: true, changed: false, dup: true }, events: [], changed: false };     // spec 1.3: two tabs of one GM are harmless
      if (state.mode === "off" && !user.staff) return { state, log, env: bad("off"), events: [], changed: false };
      env = await request(X, input.req);
      if (env.ok && input.req?.op !== "preview") { applyHelpAnswers(X); driving = true; await drive(X); }
    } else if (input?.t === "sys") {
      await system(X, input.effects); env = ok(); driving = true; await drive(X);
    } else if (input?.t === "roll") {
      env = takeRoll(X, input) ? ok() : bad("badInput");
      if (env.ok) { driving = true; await drive(X); }
    } else { env = ok({ changed: false }); driving = true; await drive(X); }
  } catch (e) {
    /* D90 (spec 12: an answer says what was saved). A request that fails before it is through is taken back whole: what it had asked of
       the host is undone, the state and the journal are the ones it found, and the answer is `internal` with nothing changed, so it can
       be sent again. Only when that is not possible (it had already undone something itself, or an inverse failed) the state it left
       is kept, every transaction of it is closed into the journal, and the answer says `partial`. The driver does not throw (see
       `drive`); should it, the request itself was carried out and stays, and the action on top goes to the GM. */
    warn(X, driving ? "drive" : "request", e, { op: input?.req?.op ?? input?.t });
    const msg = String(e?.message ?? e).slice(0, 120);
    if (!driving && !X.undid) {
      const n0 = X.failed.length;
      for (const op of [...X.ops].reverse()) { const eff = J.inverseEffect(op); if (eff) await inverse(X, op, eff); }
      env = bad("internal", { msg });
      if (X.failed.length > n0) { env.partial = true; env.failed = X.failed.slice(0, FAILED_MAX); }
      return { state, log, env, events: [], changed: false };
    }
    try { if (driving && top(X)) park(X, top(X), top(X), e); } catch { /* the state as it stands */ }
    env = driving && env?.ok ? { ...env, partial: true } : { ...bad("internal", { msg }), partial: true };
    X.changed = true;
  }
  if (!X.changed) return { state, log, env: { ...env, changed: false, ...(X.failed.length ? { failed: X.failed.slice(0, FAILED_MAX) } : {}) }, events: X.events, changed: false };
  try { sweepTx(X); } catch (e) { warn(X, "sweep", e); }
  if (X.failed.length) env = { ...env, failed: X.failed.slice(0, FAILED_MAX) };
  if (X.parked && instOf(X, X.parked)) env = { ...env, parked: X.parked };                     // an action went to the GM's hand in this call (D90)
  const seen = input?.rid ? [...X.state.seen, input.rid].slice(-P1.SEEN_MAX) : X.state.seen;
  return { state: { ...X.state, rev: (state.rev ?? 0) + 1, seen }, log: X.log, env: env.ok ? { ...env, changed: true } : env, events: X.events, changed: true };
}
export const FAILED_MAX = 20;
/** Read helpers for the API and the checks. */
export const topInstance = (state) => state?.stack?.[state.stack.length - 1] ?? null;
export const openPrompts = (state) => Object.values(state?.prompts ?? {}).filter((p) => !p.answered);
