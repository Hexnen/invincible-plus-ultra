/* Tactical combat, package P2: STAND-IN FOR PACKAGE P1 (state shape, action ledger, turn bookkeeping). NO Foundry globals.
   ================================================================================================================================
   DROP THIS FILE AT THE MERGE. P1 (C:/ipu-tactics-p1) owns `state-pure.mjs`, `ledger-pure.mjs`, `initiative-pure.mjs` and `scheduler-pure.mjs`.
   P2 code imports ONLY the names exported here, through `import * as P1 from "./p1-standin.mjs"`; the merge replaces that one import line in
   engine-pure.mjs, flows/*.mjs, view-pure.mjs, desk-pure.mjs and the checks with a thin module that maps these names to P1's real functions.
   ================================================================================================================================
   The interface P2 expects from P1 (everything pure, plain JSON in and out, the input is never modified):
     emptyState(opts)                         -> State (spec section 2)
     serialize(state) / parse(raw)            -> string / State|null
     isOnTurn(state, cid)                     -> bool            (spec 3.2: member of the current slot, or a summon of its owner [I14])
     turnInfo(state)                          -> { round, slot, combatant }
     canPay(state, cid, cost, o)              -> { ok, reason, pay }   cost "full"|"quick"|"free"|"none"; o = { interrupt?, grant?, gm? }
     pay(state, cid, entry)                   -> { ledger, entryId }   the combatant's new Ledger with the entry written and its unit consumed
     voidEntry(ledger, entryId)               -> ledger                entry void, its unit free again
     budget(state, cid)                       -> { full, quick:[..2], grants:[...] }       (spec 18)
     history(state, cid, scope, tag)          -> bool                  (spec 4.2 "History")
     noteFact(ledger, scope facts)            -> ledger
     loseNextTurn(ledger, source)             -> ledger                [L7]
     canInterrupt(state, cid)                 -> { ok, reason }
     endTurn(state, cid)                      -> { ok, state?, reason? }   (spec 4.4; P2 only relays the intent)
   Rules implemented here are the action-economy rows of spec 4.1 with their marks; P1's truth-table tests are the authority, not this file. */

export const STATE_V = 1;
export const SEEN_MAX = 80;                      // spec 1.3
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const ID_RE = /^[A-Za-z0-9_.:-]{1,48}$/;
export const isId = (v) => typeof v === "string" && ID_RE.test(v) && v !== "__proto__" && v !== "constructor" && v !== "prototype";

export function emptyState(opts = {}) {
  return {
    v: STATE_V, rev: 0, seen: [], mode: "tactical", kind: "combat", round: 1, phase: "turns",
    init: { deck: 10, slots: [], cur: null, curMember: null, prev: {} },
    ledger: {}, stack: [], prompts: {}, triggers: [], tokens: [], statuses: {}, counters: {}, effects: [], items: [], summons: [],
    knowledge: {}, revealed: {}, npc: {}, free: {}, karma: [],
    txOpen: {},                                  // P2 [D]: open transactions live in the state until they close (then they move to the log flag)
    seq: 0,                                      // P2 [D]: id counter (instances, prompts, transactions, events)
    opts: { pushOrder: "afterDefence", redraw: "everyRound", critCap9: false, ...opts },
  };
}
export const serialize = (state) => JSON.stringify(state);
export function parse(raw) {
  try {
    const s = typeof raw === "string" ? (raw ? JSON.parse(raw) : null) : raw;
    if (!isObj(s) || s.v !== STATE_V || !Array.isArray(s.stack) || !isObj(s.prompts) || !isObj(s.ledger)) return null;
    const base = emptyState();
    for (const k of Object.keys(base)) if (s[k] === undefined || (Array.isArray(base[k]) !== Array.isArray(s[k])) || (isObj(base[k]) !== isObj(s[k]))) s[k] = base[k];
    s.rev = Number.isFinite(s.rev) ? s.rev : 0; s.seq = Number.isFinite(s.seq) ? s.seq : 0;
    s.seen = s.seen.filter((x) => typeof x === "string").slice(-SEEN_MAX);
    return s;
  } catch { return null; }
}

/* ------------------------------------------------------------------ ledger (spec 4.2) */
export const newLedger = (round) => ({
  round,
  grants: [
    { id: "A", kind: "base", unit: "A", window: "ownTurn", expires: "roundEnd" },     // [L1]: pays a full or a quick action
    { id: "B", kind: "base", unit: "B", window: "ownTurn", expires: "roundEnd" },     // [L1]: pays a quick action only
  ],
  entries: [],
  history: { round: { moved: 0, tags: [] } },
});
export const ledgerOf = (state, cid) => state.ledger[cid] ?? newLedger(state.round);
const free = (g) => !g.usedBy && g.consent !== "pending" && g.consent !== "no";
const fits = (g, cost) => (cost === "full" ? ["A", "full", "any", "fullOnly"].includes(g.unit) : ["B", "A", "quick", "any", "defense"].includes(g.unit));

export function slotOf(state, cid) { return state.init.slots.find((s) => s.members.includes(cid)) ?? null; }
export function isOnTurn(state, cid) {
  const cur = state.init.slots.find((s) => s.id === state.init.cur);
  if (cur?.members.includes(cid)) return true;
  const owner = state.summons.find((s) => s.combatants?.includes(cid))?.owner;     // [I14]
  return !!owner && !!cur?.members.includes(owner);
}
export const turnInfo = (state) => ({ round: state.round, slot: state.init.cur, combatant: state.init.curMember });

export function canInterrupt(state, cid) {
  const l = ledgerOf(state, cid);
  if (l.noInterrupts || l.lostTurn) return { ok: false, reason: "noInterrupts" };   // [L7]
  return { ok: true, reason: null };
}
/** Can `cid` pay `cost` now? o = { interrupt, defense, gm }. Returns { ok, reason, pay: grantId|null }. */
export function canPay(state, cid, cost, o = {}) {
  if (cost === "none" || cost === "free" || o.gm) return { ok: true, reason: null, pay: null };
  const l = ledgerOf(state, cid), onTurn = isOnTurn(state, cid);
  if (o.interrupt) { const ci = canInterrupt(state, cid); if (!ci.ok) return { ...ci, pay: null }; }
  if (cost === "full" && l.noFull?.round === state.round) return { ok: false, reason: "noFull", pay: null };          // [L8]
  // grants from other sources first (spec 4.2: separate entries, never changes to the base pair)
  const extra = l.grants.find((g) => g.kind !== "base" && free(g) && fits(g, cost) && (g.unit !== "defense" || o.defense)
    && (g.window === "anytime" || (g.window === "interrupt" && o.interrupt) || (g.window === "ownTurn" && onTurn) || (typeof g.window === "string" && g.window.startsWith("turnOf:") && isOnTurn(state, g.window.slice(7)))));
  if (extra) return { ok: true, reason: null, pay: extra.id };
  if (cost === "full") {
    if (!onTurn) return { ok: false, reason: "notYourTurn", pay: null };                                              // [L2]
    const a = l.grants.find((g) => g.id === "A");
    return a && free(a) ? { ok: true, reason: null, pay: "A" } : { ok: false, reason: "noAction", pay: null };        // [L1], [L3]
  }
  if (!onTurn && !o.interrupt) return { ok: false, reason: "notYourTurn", pay: null };                                // [L4]
  const b = l.grants.find((g) => g.id === "B"), a = l.grants.find((g) => g.id === "A");
  if (b && free(b)) return { ok: true, reason: null, pay: "B" };                                                      // spec 4.2 base budget
  if (a && free(a)) return { ok: true, reason: null, pay: "A" };                                                      // [L3]: the second quick action forfeits the full action
  return { ok: false, reason: "noAction", pay: null };
}
/** Write a ledger entry. entry = { id, action, inst, cost, pay (grant id from canPay), interrupt?, tags?, target?, stress?, onTurnOf? }. */
export function pay(state, cid, entry) {
  const l = ledgerOf(state, cid);
  const e = { id: entry.id, round: state.round, slot: slotOf(state, cid)?.id ?? null, onTurnOf: entry.onTurnOf ?? state.init.curMember ?? null,
    action: entry.action, inst: entry.inst, cost: entry.cost, tags: entry.tags ?? [] };
  if (entry.pay) e.grant = entry.pay;
  if (entry.interrupt) e.interrupt = 1;
  if (entry.stress) e.stress = entry.stress;
  if (entry.target?.length) e.target = entry.target;
  const grants = l.grants.map((g) => (g.id === entry.pay ? { ...g, usedBy: e.id } : g));
  return { ledger: { ...l, grants, entries: [...l.entries, e] }, entryId: e.id };
}
export function voidEntry(ledger, entryId) {
  return { ...ledger, entries: ledger.entries.map((e) => (e.id === entryId ? { ...e, void: 1 } : e)),
    grants: ledger.grants.map((g) => { if (g.usedBy !== entryId) return g; const { usedBy, ...rest } = g; return rest; }) };
}
export function budget(state, cid) {
  const l = ledgerOf(state, cid), a = l.grants.find((g) => g.id === "A"), b = l.grants.find((g) => g.id === "B");
  const usedAs = (g) => l.entries.find((e) => e.id === g?.usedBy && !e.void)?.cost ?? null;
  const lost = !!l.lostTurn || l.noFull?.round === state.round;
  return {
    full: lost ? "lost" : !a || !free(a) ? "used" : "open",
    quick: [b && free(b) ? "open" : "used", a && free(a) ? "open" : usedAs(a) === "full" ? "lost" : "used"],
    grants: l.grants.filter((g) => g.kind !== "base").map((g) => ({ id: g.id, kind: g.kind, unit: g.unit, used: !!g.usedBy, consent: g.consent ?? null })),
  };
}
export function history(state, cid, scope, tag) {
  const h = ledgerOf(state, cid).history?.[scope];
  if (!h) return false;
  if (tag === "moved") return (h.moved ?? 0) > 0;
  return h[tag] === 1 || h[tag] === true || (h.tags ?? []).includes(tag);
}
export function noteFact(ledger, facts) {
  const merge = (h = { moved: 0, tags: [] }) => ({ ...h, ...facts, moved: (h.moved ?? 0) + (facts.moved ?? 0), tags: [...new Set([...(h.tags ?? []), ...(facts.tags ?? [])])] });
  return { ...ledger, history: { ...ledger.history, round: merge(ledger.history?.round), thisTurn: merge(ledger.history?.thisTurn) } };
}
/** [L7] (Stun, Suppressed [B2436], [B2517], [R10]): the nearest coming turn is lost and there are no interrupts until then. */
export const loseNextTurn = (ledger, source) => ({ ...ledger, lostTurn: { until: "nextTurnConsumed", source }, noInterrupts: 1 });

/* ------------------------------------------------------------------ turn bookkeeping: the least the P2 checks need (P1 owns the real one, spec 4.4) */
export function setOrder(state, slots, round = state.round) {
  const s = slots.map((x, i) => ({ id: x.id ?? `s${i + 1}`, card: x.card ?? i + 1, members: x.members, state: "waiting", done: [] }));
  const ledger = {};
  for (const sl of s) for (const m of sl.members) ledger[m] = newLedger(round);
  return { ...state, round, ledger: { ...state.ledger, ...ledger }, init: { ...state.init, slots: s, cur: null, curMember: null } };
}
export function startTurn(state, cid) {
  const slot = slotOf(state, cid);
  if (!slot) return state;
  return { ...state, init: { ...state.init, cur: slot.id, curMember: cid, slots: state.init.slots.map((s) => (s.id === slot.id ? { ...s, state: "active" } : s)) } };
}
export function endTurn(state, cid) {
  if (!isOnTurn(state, cid)) return { ok: false, reason: "notYourTurn" };
  const slots = state.init.slots.map((s) => (s.id === state.init.cur ? { ...s, state: "done", done: [...new Set([...s.done, cid])] } : s));
  const next = slots.find((s) => s.state === "waiting");
  let st = { ...state, init: { ...state.init, slots, cur: null, curMember: null } };
  if (next) st = startTurn(st, next.members[0]);
  return { ok: true, state: st };
}
