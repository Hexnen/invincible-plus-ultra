/* Tactical combat: the ACTION ECONOMY AT STATE LEVEL. NO Foundry globals.
   The action engine (engine-pure.mjs, flows/*.mjs, desk-pure.mjs) asks its questions about a combatant of the STATE ("can N1 pay a quick
   action now, as an interrupt?"); the rules of the action economy live in ledger-pure.mjs and work on ONE ledger with the facts of the
   moment handed in (on turn, whose turn, Resolve). This file is only that bridge: it reads the facts from the state and calls the ledger.
   It holds no rule of its own; the truth tables are check-ledger.mjs. (It replaces the stand-in the engine was built against.)
     isOnTurn(state, cid) / turnInfo(state)          ops-pure.mjs [I14]
     canPay(state, cid, cost, o)   -> { ok, reason, pay: grantId|null, gmMayAllow?, forfeitsFull? }
                                      o = { interrupt?, defense?, gm?, grant?, cause?: "help", resolve? }
     pay(state, cid, cost, o, data) -> { ok, ledger, entryId } | { ok:false, reason }      data as ledger-pure.pay (action, inst, tags, target ...)
     voidEntry(ledger, entryId)     -> ledger (unchanged when the entry is unknown)
     budget(state, cid) / history(state, cid, scope, tag) / ledgerOf(state, cid) / loseNextTurn(ledger, source) / canInterrupt(state, cid) */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as Lg from "./ledger-pure.mjs";

export const isId = S.isId;
export const SEEN_MAX = S.SEEN_MAX;
export const ledgerOf = (state, cid) => state?.ledger?.[cid] ?? Lg.newLedger(state?.round ?? 0);
export const isOnTurn = (state, cid) => O.isOnTurn(state, cid);
export const turnInfo = (state) => ({ round: state.round, slot: state.init?.cur ?? null, combatant: state.init?.curMember ?? null });
/* spec 1.4, 14.5: in free mode, and for a participant marked free, only "is a unit left" is asked */
const forced = (state, cid, o) => o.gm === true || state.mode !== "tactical" || !!state.free?.[cid];

function request(state, cid, cost, o = {}) {
  const req = { cost, onTurn: isOnTurn(state, cid), interrupt: !!o.interrupt, turnOf: state.init?.curMember ?? undefined, tags: o.defense ? ["defence"] : [] };
  if (o.cause) req.cause = o.cause;
  if (o.resolve !== undefined && o.resolve !== null) req.resolve = o.resolve;
  if (forced(state, cid, o)) req.force = true;
  return req;
}
/* The unit that pays: the base pair when it can [L1] [L3]; otherwise the first usable grant (Quickness [R1], a defence grant [B2105],
   a GM grant ...). [D] the base pair goes first because it costs no stress; choosing between several ways to pay is a UI matter
   (ledger-pure.payOptions lists them, `o.grant` names one). */
export function canPay(state, cid, cost, o = {}) {
  if (cost === "none" || cost === "free" || cost == null) return { ok: true, reason: null, pay: null, stress: 0 };
  if (o.gm === true) return { ok: true, reason: null, pay: null, stress: 0, waived: true };      // spec 14: the GM acting through an override waives the cost
  const L = ledgerOf(state, cid), req = request(state, cid, cost, o);
  if (o.grant) { const r = Lg.canPay(L, { ...req, grant: o.grant }); return r.ok ? { ok: true, reason: null, pay: r.pay.grant, stress: r.pay.stress ?? 0 } : { ok: false, reason: r.reason, pay: null, gmMayAllow: !!r.gmMayAllow }; }
  const base = Lg.canPay(L, req);
  if (base.ok) return { ok: true, reason: null, pay: base.pay.grant, stress: 0, forfeitsFull: !!base.forfeitsFull };
  for (const g of L.grants) {
    if (g.kind === "base" || g.slot) continue;
    const r = Lg.canPay(L, { ...req, grant: g.id });
    if (r.ok) return { ok: true, reason: null, pay: r.pay.grant, stress: r.pay.stress ?? 0 };
  }
  return { ok: false, reason: base.reason === "fullOnTurn" ? "notYourTurn" : base.reason, pay: null, gmMayAllow: !!base.gmMayAllow };
}
/** Write the ledger entry of a paid action. `grant` = the unit canPay named (null: the base pair). -> { ok, ledger, entryId, stress } */
export function pay(state, cid, cost, o = {}, data = {}) {
  const L = ledgerOf(state, cid), req = request(state, cid, cost, o);
  if (o.force) req.force = true;
  if (o.grant) req.grant = o.grant;
  else if (!req.force && cost !== "none" && cost !== "free" && cost != null) {       // pay with the unit canPay chose: a grant when the base pair cannot
    const c = canPay(state, cid, cost, o);
    if (c.ok && c.pay && c.pay !== Lg.BASE_A && c.pay !== Lg.BASE_B) req.grant = c.pay;
  }
  const r = Lg.pay(L, req, { slot: state.init?.cur ?? undefined, ...data });
  return r.ok ? { ok: true, ledger: r.ledger, entryId: r.entry.id, stress: r.entry.stress ?? 0 } : { ok: false, reason: r.reason };
}
export function voidEntry(ledger, entryId) { const r = Lg.voidEntry(ledger, entryId); return r.ok ? r.ledger : ledger; }
export function budget(state, cid) {
  const b = Lg.budget(ledgerOf(state, cid));
  if (b.lostTurn && b.full === "open") b.full = "lost";                    // [L7]: the coming turn is lost, the bar shows it
  return b;
}
export const history = (state, cid, scope, tag) => { const v = Lg.history(ledgerOf(state, cid), scope, tag); return typeof v === "number" ? v > 0 : Array.isArray(v) ? v.length > 0 : !!v; };
export const loseNextTurn = (ledger, source) => Lg.loseNextTurn(ledger, source ?? null);
export function canInterrupt(state, cid) {
  const L = ledgerOf(state, cid);
  return L.noInterrupts || L.lostTurn ? { ok: false, reason: "noInterrupts" } : { ok: true, reason: null };      // [L7]
}
