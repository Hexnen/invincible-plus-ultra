/* Tactical combat (package P1): the ACTION LEDGER, the action-economy rules of the spec's section 4 (gap G-L1: these checks live here, not
   in scripts/rules). Pure ES module: NO Foundry globals. Node-tested by check-ledger.mjs.
   Citation marks as in dev/combat-spec.md 0.1: [Bn] = line n of dev/book-dump.txt, [Rn] = ruling n of the plan, [Ln] / [In] = rule rows
   of spec 4.1 / 3.1, [D] = software design, [A-n] / [OQ-n] = assumption / open question. Book text is never quoted.

   One ledger per combatant per round:
     { round, n, turnNo, turnRound, grants:[Grant], entries:[Entry], lostTurn?, noInterrupts?, noFull?, open?, held?, extra?,
       history:{ prevTurn?, thisTurn?, round } }
   Additions to the spec's shapes, all [D]: Grant.slot (the extra turn a pair of units belongs to), Grant.data, Entry.own / turnNo / borders /
   forced, Ledger.n (id counter), turnNo / turnRound (which own turn the "thisTurn" facts belong to), open (own turn in progress),
   held (turn started and handed on by holding off), extra (the extra-turn slot in progress). */
import { damage } from "../rules/index.mjs";

/* [L8] hole: the book lets an effect remove "the full action for the round" [B2889] and does not say whether the second quick action
   (which is paid by giving up the full action [B2291]) is still available. false = it is; flip to refuse it. */
export const NO_FULL_BLOCKS_SECOND_QUICK = false;
/* grants that are not consumed by a use: Defensive may be used several times a round [B2105] */
export const REPEATABLE = new Set(["defender"]);
/* [L1] the base budget as two units [D]: A pays a full OR a quick action, B pays a quick action only */
export const BASE_A = "gA", BASE_B = "gB";

const emptyFacts = () => ({ moved: 0, tags: [] });
const baseGrants = () => [
  { id: BASE_A, kind: "base", unit: "A", window: "anytime", expires: "roundEnd" },
  { id: BASE_B, kind: "base", unit: "B", window: "anytime", expires: "roundEnd" }
];
const copy = (L) => JSON.parse(JSON.stringify(L));
const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/* [L5] [B2293]: everything resets at the start of a round and nothing is carried over. What survives is not an action: the facts of the
   last turns ([I10] [B2270]: "previous turn" may lie in the round before) and a pending lost turn with its interrupt ban ([L7] [B2436],
   [B2517], [R10]: it lasts until the turn is consumed, whichever round that is). */
export function newLedger(round, prev = null) {
  const L = { round, n: prev?.n ?? 0, turnNo: prev?.turnNo ?? 0, turnRound: prev?.turnRound ?? 0, grants: baseGrants(), entries: [], history: { round: emptyFacts() } };
  if (prev?.history?.prevTurn) L.history.prevTurn = copy(prev.history.prevTurn);
  if (prev?.history?.thisTurn) L.history.thisTurn = copy(prev.history.thisTurn);
  if (prev?.lostTurn) { L.lostTurn = copy(prev.lostTurn); L.noInterrupts = 1; }
  if (prev?.noFull && prev.noFull.round === round) L.noFull = copy(prev.noFull);
  return L;
}

const used = (g) => !!g.usedBy;
const grantOf = (L, id) => L.grants.find((g) => g.id === id) ?? null;
/* the pair of units that pays ordinary actions right now: the base pair, or the pair of the extra turn in progress
   ([B1761] a commanded turn is a complete turn of its own; section 3.2: an extra turn carries its own fresh budget) */
function pair(L, slot) {
  const sl = slot ?? L.extra ?? null;
  if (sl) { const a = L.grants.find((g) => g.slot === sl && g.unit === "A"), b = L.grants.find((g) => g.slot === sl && g.unit === "B"); if (a && b) return { a, b }; }
  return { a: grantOf(L, BASE_A), b: grantOf(L, BASE_B) };
}

const UNIT_PAYS = { A: ["full", "quick"], B: ["quick"], full: ["full"], fullOnly: ["full"], quick: ["quick"], any: ["full", "quick"], defense: ["quick"] };

/* May the grant pay this request? req as in canPay. */
function grantUsable(L, g, req) {
  if (!g) return fail("unknownGrant");
  if (used(g)) return fail("grantUsed");
  if (g.needsConsent && g.consent !== "yes") return fail(g.consent === "no" ? "grantRefused" : "grantConsent");            // [plan 5.3], [B1708]
  if (!UNIT_PAYS[g.unit]?.includes(req.cost)) return fail("grantUnit");
  if (g.unit === "defense" && !(req.tags ?? []).includes("defence")) return fail("grantUnit");                               // [B1709], [B2170], [B2105]: a block or dodge only
  if (g.window === "ownTurn" && !req.onTurn) return fail("notYourTurn", { gmMayAllow: true });
  if (g.window === "interrupt" && req.onTurn) return fail("grantWindow");
  if (g.window.startsWith("turnOf:") && req.turnOf !== g.window.slice(7)) return fail("grantWindow");                        // [B1708]: on the guide's turn
  if (g.stress > 0 && req.resolve !== undefined && req.resolve !== null && !damage.canTakeVoluntaryStress(req.resolve)) return fail("noStress", { gmMayAllow: true });   // [B2816], [B2228]
  return { ok: true };
}

/* Can this combatant pay for an action now?
   req = { cost: "full"|"quick"|"free"|"none", onTurn, interrupt?, turnOf?, tags?, grant?, slot?, cause?: "help", resolve?, force? }
     onTurn     the ledger's owner has the turn (own slot, or the extra turn it was given)
     interrupt  a quick action declared as an interrupt of someone else's action [L4]
     turnOf     the combatant whose turn it is (for grants taken on another character's turn)
     grant      pay with this grant instead of the base pair
     cause      "help": the helper's full action is spent on the helped character's turn [L9] [I13] [B2273]
     force      free mode / GM override: only "is a unit left" is checked, no window, no turn (spec 1.4, 14.5)
   -> { ok, pay: { grant: id|null, stress }, forfeitsFull? } or { ok:false, reason, gmMayAllow? }. Reasons are machine ids (ITAC.reason.<id>). */
export function canPay(L, req) {
  const cost = req.cost;
  if (cost === "none" || cost === "free") {
    if ((req.tags ?? []).includes("ownTurnOnly") && !req.onTurn && !req.force) return fail("notYourTurn", { gmMayAllow: true });   // [L6] [B2383]: free movement inside a zone, own turn only
    return { ok: true, pay: { grant: null, stress: 0 } };
  }
  if (cost !== "full" && cost !== "quick") return fail("badCost");
  if (!req.force && !req.onTurn && L.noInterrupts) return fail("noInterrupts", { gmMayAllow: true });                        // [L7] [B2436], [B2517], [R10]
  if (req.grant && req.grant !== BASE_A && req.grant !== BASE_B) {
    const g = grantOf(L, req.grant);
    const u = req.force ? (g && !used(g) && UNIT_PAYS[g.unit]?.includes(cost) ? { ok: true } : fail("grantUnit")) : grantUsable(L, g, req);
    return u.ok ? { ok: true, pay: { grant: g.id, stress: g.stress ?? 0 } } : u;
  }
  const { a, b } = pair(L, req.slot);
  if (cost === "full") {
    if (!req.force && !req.onTurn && req.cause !== "help") return fail("fullOnTurn", { gmMayAllow: true });                  // [L2] [B2290]; the other exceptions of L2 are grants
    if (L.noFull && !req.slot && !L.extra) return fail("noFull", { gmMayAllow: true });                                     // [L8] [B2889]
    if (!a || used(a)) return fail("noAction", { gmMayAllow: true });                                                        // [L1] one full action; [L3] or it was given up for a second quick one
    return { ok: true, pay: { grant: a.id, stress: 0 } };
  }
  if (!req.force && !req.onTurn && !req.interrupt) return fail("notYourTurn", { gmMayAllow: true });                         // [L4] [B2292]: out of turn only as an interrupt
  if (b && !used(b)) return { ok: true, pay: { grant: b.id, stress: 0 } };                                                   // [L1]
  if (a && !used(a) && !(L.noFull && NO_FULL_BLOCKS_SECOND_QUICK && !req.slot && !L.extra)) return { ok: true, pay: { grant: a.id, stress: 0 }, forfeitsFull: true };   // [L3] [B2291]
  return fail("noAction", { gmMayAllow: true });
}

/* every way the request could be paid right now: the base pair first, then each usable grant (the caller shows them as choices) */
export function payOptions(L, req) {
  const out = [];
  const base = canPay(L, { ...req, grant: undefined });
  if (base.ok) out.push({ ...base.pay, kind: "base", forfeitsFull: !!base.forfeitsFull });
  for (const g of L.grants) {
    if (g.kind === "base" || g.slot) continue;
    const r = canPay(L, { ...req, grant: g.id });
    if (r.ok) out.push({ ...r.pay, kind: g.kind, from: g.from });
  }
  return out;
}

function factsOf(entries) {
  const f = emptyFacts();
  const tags = new Set();
  for (const e of entries) {
    if (e.void) continue;
    if (e.cost === "full" || e.cost === "quick") f.acted = 1;
    for (const t of e.tags ?? []) {
      tags.add(t);
      if (t === "move") f.moved += Number.isFinite(e.borders) ? e.borders : 1;
      else if (t === "moveInZone") f.movedWithinZone = 1;
      else if (t === "attack") f.attacked = 1;
      else if (t.startsWith("shot:")) (f.shot ??= []).push(t.slice(5));
    }
  }
  f.tags = [...tags];
  return f;
}
/* the facts are always recomputed from the entries that still count (a voided entry never happened) */
function refresh(L) {
  L.history.round = factsOf(L.entries);
  if (L.turnRound === L.round && L.turnNo > 0) L.history.thisTurn = factsOf(L.entries.filter((e) => e.own && e.turnNo === L.turnNo));
  return L;
}

/* Record a paid action. data = { action, inst?, slot?, onTurnOf?, tags?, stress?, zoneFrom?, zoneTo?, target?, borders? }.
   -> { ok, ledger, entry } or the refusal of canPay. The stress of the entry is the grant's price plus data.stress (charging it is the executor's). */
export function pay(L0, req, data = {}) {
  const chk = canPay(L0, req);
  if (!chk.ok) return chk;
  const L = copy(L0);
  const e = { id: `e${++L.n}`, round: L.round, action: String(data.action ?? "other"), inst: data.inst ?? null, cost: req.cost, tags: [...new Set(data.tags ?? req.tags ?? [])] };
  if (data.slot) e.slot = data.slot;
  if (req.turnOf ?? data.onTurnOf) e.onTurnOf = req.turnOf ?? data.onTurnOf;
  if (!req.onTurn && req.cost === "quick" && req.interrupt) e.interrupt = 1;
  if (req.onTurn) { e.own = 1; e.turnNo = L.turnNo; }
  if (req.force) e.forced = 1;
  const stress = (chk.pay.stress ?? 0) + (Number(data.stress) > 0 ? Number(data.stress) : 0);
  if (stress > 0) e.stress = stress;
  for (const k of ["zoneFrom", "zoneTo"]) if (data[k]) e[k] = data[k];
  if (Array.isArray(data.target) && data.target.length) e.target = data.target.slice();
  if (Number.isFinite(data.borders)) e.borders = data.borders;
  if (chk.pay.grant) {
    e.grant = chk.pay.grant;
    const g = grantOf(L, chk.pay.grant);
    if (g && !REPEATABLE.has(g.kind)) g.usedBy = e.id;
  }
  L.entries.push(e);
  return { ok: true, ledger: refresh(L), entry: e, forfeitsFull: !!chk.forfeitsFull };
}

/* an entry that did not happen after all (GM edit, cancelled declaration, undo): its unit is free again */
export function voidEntry(L0, entryId) {
  const L = copy(L0);
  const e = L.entries.find((x) => x.id === entryId);
  if (!e || e.void) return fail("unknownEntry");
  e.void = 1;
  for (const g of L.grants) if (g.usedBy === entryId) delete g.usedBy;
  return { ok: true, ledger: refresh(L), entry: e };
}

/* ------------------------------------------------------------------ grants (spec 4.2) */
/* Templates for the grants whose terms the book or a ruling states completely. Everything else is passed in full by its catalog entry (P6). */
export function grantTemplate(kind, p = {}) {
  switch (kind) {
    case "quickness": return { kind, unit: "any", stress: 1, window: "anytime", expires: "roundEnd" };                              // [R1] [B1953]: once per round, quick or full, own turn or interrupt
    case "guidance": return { kind, unit: p.unit === "quick" ? "quick" : "full", from: p.from, window: `turnOf:${p.from}`, expires: "turnEnd", needsConsent: 1 };   // [B1708]: on the guide's turn, refusable
    case "defender": return { kind, unit: "defense", stress: 1, window: "anytime", expires: "roundEnd" };                           // [B2105]: repeatable (REPEATABLE)
    case "gm": return { kind, unit: GRANT_UNIT(p.unit), window: p.window ?? "anytime", expires: p.expires ?? "roundEnd" };          // [plan 5.6]
    default: return null;
  }
}
const GRANT_UNIT = (u) => (["full", "quick", "any", "fullOnly", "defense"].includes(u) ? u : "any");

/* add a grant. A grant that comes from another character needs the receiver's consent before it can be used [plan 5.3] [B1708]. */
export function addGrant(L0, g0, self = null) {
  if (!g0 || !UNIT_PAYS[g0.unit]) return fail("badGrant");
  if (g0.kind === "quickness" && L0.grants.some((g) => g.kind === "quickness")) return fail("oncePerRound");                // [R1] [B1953]
  const L = copy(L0);
  const g = { id: `g${++L.n}`, kind: String(g0.kind ?? "gm"), unit: g0.unit, window: g0.window ?? "ownTurn", expires: g0.expires ?? "roundEnd" };
  for (const k of ["from", "source", "stress", "slot", "data"]) if (g0[k] !== undefined && g0[k] !== null) g[k] = g0[k];
  if (g0.needsConsent || (g.from && g.from !== self)) { g.needsConsent = 1; g.consent = g0.consent === "yes" ? "yes" : "pending"; }
  L.grants.push(g);
  return { ok: true, ledger: L, grant: g };
}
export function setConsent(L0, grantId, yes) {
  const L = copy(L0);
  const g = grantOf(L, grantId);
  if (!g || !g.needsConsent) return fail("unknownGrant");
  if (used(g)) return fail("grantUsed");
  g.consent = yes ? "yes" : "no";                                                                                           // [B1708]: a refused bonus action is gone, no substitute
  return { ok: true, ledger: L, grant: g };
}
export function removeGrant(L0, grantId) {
  if (grantId === BASE_A || grantId === BASE_B) return fail("baseGrant");
  const L = copy(L0);
  const i = L.grants.findIndex((g) => g.id === grantId);
  if (i < 0) return fail("unknownGrant");
  L.grants.splice(i, 1);
  return { ok: true, ledger: L };
}
/* the pair of units of an extra turn ([B1761]: full + quick, or two quick; spec 3.2) */
export function addTurnPair(L0, slotId, kind = "gm", by = null) {
  const L = copy(L0);
  for (const unit of ["A", "B"]) { const g = { id: `g${++L.n}`, kind, unit, window: "ownTurn", expires: "turnEnd", slot: slotId }; if (by) g.from = by; L.grants.push(g); }
  return L;
}

/* ------------------------------------------------------------------ losses */
/* [L7] [B2436], [B2517], [R10]: the nearest coming turn is lost and there are no interrupt actions until then */
export function loseNextTurn(L0, source = null) { const L = copy(L0); L.lostTurn = { until: "nextTurnConsumed", source }; L.noInterrupts = 1; return L; }
export function clearLostTurn(L0) { const L = copy(L0); delete L.lostTurn; delete L.noInterrupts; return L; }
/* [L8] [B2889]: only the full action of this round is lost */
export function loseFull(L0, source = null) { const L = copy(L0); L.noFull = { round: L.round, source }; return L; }
export function clearNoFull(L0) { const L = copy(L0); delete L.noFull; return L; }

/* ------------------------------------------------------------------ turn lifecycle (spec 4.4) */
/* -> { ledger, lost, resumed }.
   lost:    the turn was the lost one; it is consumed, the interrupt ban ends [L7].
   resumed: the turn had begun and was handed on by holding off; it now really happens, with no second roll-over of the facts
            ([I9] [B2282]: a turn does not happen until it is used). */
export function turnStart(L0, { extra = null } = {}) {
  const L = copy(L0);
  if (extra) { L.extra = extra; L.open = 1; return { ledger: L, lost: false, resumed: false, extra: true }; }   // a commanded or inserted turn is not "your turn": the facts of the own turns stay
  if (L.held) { delete L.held; L.open = 1; return { ledger: L, lost: false, resumed: true }; }
  if (L.lostTurn) { delete L.lostTurn; delete L.noInterrupts; return { ledger: L, lost: true, resumed: false }; }   // spec 4.4: consumed before anything else, the facts do not roll
  if (L.history.thisTurn) L.history.prevTurn = L.history.thisTurn;                                             // [I10]
  L.history.thisTurn = emptyFacts();
  L.turnNo += 1; L.turnRound = L.round;
  L.open = 1;
  return { ledger: L, lost: false, resumed: false };
}
export function turnEnd(L0) {
  const L = copy(L0);
  delete L.open;
  const extra = L.extra; delete L.extra;
  L.grants = L.grants.filter((g) => !(g.expires === "turnEnd" && !g.window.startsWith("turnOf:") && (!g.slot || g.slot === extra) && !used(g)));
  return L;
}
/* the turn is handed on (holding off, or the GM stepping back): it will start again later without counting as a new turn */
export function turnSuspend(L0) { const L = copy(L0); delete L.open; delete L.extra; L.held = 1; return L; }
/* a finished turn is opened again (GM stepping back) */
export function turnReopen(L0) { const L = copy(L0); L.open = 1; delete L.held; return L; }
/* the turn of `who` ended: bonus actions that had to be taken on that turn are gone [B1708] */
export function expireTurnOf(L0, who) {
  if (!L0.grants.some((g) => g.window === `turnOf:${who}` && g.expires === "turnEnd" && !used(g))) return L0;
  const L = copy(L0);
  L.grants = L.grants.filter((g) => !(g.window === `turnOf:${who}` && g.expires === "turnEnd" && !used(g)));
  return L;
}

/* ------------------------------------------------------------------ reads */
/* What the bar, the tray and the party cards draw (spec 18): the base pair as one full action and two quick actions.
   full:  "open" | "used" | "lost" (given up for the second quick action [L3], or removed [L8])
   quick: two of "open" | "used" | "lost" (the second one is the alternative use of the full action's unit and is lost once that is spent) */
export function budget(L, { slot = null } = {}) {
  const { a, b } = pair(L, slot);
  const aE = a?.usedBy ? L.entries.find((e) => e.id === a.usedBy) : null;
  const aUsed = !!a?.usedBy, bUsed = !!b?.usedBy, aAsFull = aUsed && (aE ? aE.cost === "full" : true);
  const noFull = !!L.noFull && !slot && !L.extra;
  const out = {
    full: aUsed ? (aAsFull ? "used" : "lost") : noFull ? "lost" : "open",
    quick: [bUsed ? "used" : "open", aUsed ? (aAsFull ? "lost" : "used") : (noFull && NO_FULL_BLOCKS_SECOND_QUICK ? "lost" : "open")],
    grants: L.grants.filter((g) => g.kind !== "base" && !g.slot).map((g) => ({ id: g.id, kind: g.kind, unit: g.unit, stress: g.stress ?? 0, from: g.from ?? null, window: g.window,
      state: used(g) ? "used" : g.needsConsent && g.consent === "pending" ? "pending" : g.needsConsent && g.consent === "no" ? "refused" : "open" })),
    lostTurn: !!L.lostTurn, noInterrupts: !!L.noInterrupts, open: !!L.open
  };
  return out;
}
/* nothing of the base pair is left */
export const spent = (L, o = {}) => { const b = budget(L, o); return b.full !== "open" && b.quick.every((q) => q !== "open"); };

/* Facts of a scope [plan 5.3]: "thisTurn" = the own turn in progress, or the last own turn when none is; "prevTurn" = the one before; "round". */
export const factsFor = (L, scope) => (scope === "round" ? L.history.round : scope === "prevTurn" ? L.history.prevTurn : L.history.thisTurn) ?? emptyFacts();
/* history(ledger, scope, tag): a fact by name (moved -> borders crossed, attacked, movedWithinZone, acted, shot) or "was this tag recorded" */
export function history(L, scope, tag) {
  const f = factsFor(L, scope);
  if (tag === "moved") return f.moved ?? 0;
  if (tag === "shot") return f.shot ?? [];
  if (tag === "attacked" || tag === "movedWithinZone" || tag === "acted") return !!f[tag];
  return (f.tags ?? []).includes(tag);
}
/* how many entries of this round carry the tag (banter once per round per target [B2785] and the like; target optional) */
export const countTag = (L, tag, target = null) => L.entries.filter((e) => !e.void && (e.tags ?? []).includes(tag) && (!target || (e.target ?? []).includes(target))).length;
