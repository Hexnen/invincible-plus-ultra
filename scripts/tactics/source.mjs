/* Tactical combat: the READ SIDE for the parts of the module that used to read Year Zero Engine: Combat markers (turn tray,
   initiative bar, party cards, token halo, Challenges time). It only reads plain properties of the Combat document it is given
   (flags, combatants), so it runs in node as well (check-source.mjs) and can be imported statically by those parts.
   When a combat carries the module's own state, that state is the truth; otherwise the callers fall back to scripts/yze.mjs (so a table
   that still runs yze-combat with tactical mode off loses nothing).
   What a pip is here [L1] [B2288]: the base budget of a turn is one full and one quick action, or two quick ones. Three pips are shown:
   full, quick, quick; taking the full action spends the second quick pip ("lost") and two quick actions spend the full pip [L3]. */
import * as S from "./state-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as Lg from "./ledger-pure.mjs";

const cache = new WeakMap();
let live = true;
/** main.mjs: with tactical combat not running on this world (the setting off, or yze-combat in charge) no combat is read as ours, even
    one that still carries a state from an earlier session: every caller falls back to what it did before this feature. */
export const setLive = (on) => { live = on !== false; };
const rawOf = (combat) => { try { const r = combat?.flags?.[S.MOD_ID]?.tactics?.state; return typeof r === "string" ? r : ""; } catch { return ""; } };

/** The module's own state of this combat (sanitised, cached by the raw flag string; never mutate it), or null: not ours. */
export function tacticsState(combat) {
  if (!live || !combat || typeof combat !== "object") return null;
  const raw = rawOf(combat);
  if (!raw) return null;
  const hit = cache.get(combat);
  if (hit && hit.raw === raw) return hit.state;
  const state = S.parse(raw);
  cache.set(combat, { raw, state });
  return state;
}
/** "tactics": the module's own card initiative and ledger run this combat. null: they do not (yze-combat or plain core). */
export const sourceOf = (combat) => (tacticsState(combat) ? "tactics" : null);
/** nobody has the turn: the cards of the round are being dealt, a blocking queue is open, the scene has ended, or the engine is switched off */
export function waiting(combat) {
  const s = tacticsState(combat);
  return !!s && (O.isWaiting(s) || s.phase === "sceneEnd" || s.phase === "idle" || !s.init.curMember);
}
/** ids of the combatants that have the turn (the member whose turn it is and what acts on its turn [I14]) */
export const onTurn = (combat) => { const s = tacticsState(combat); return s ? O.onTurnIds(s) : []; };

const combatantsOf = (combat) => { const c = combat?.combatants; return Array.isArray(c) ? c : c?.contents ?? (c && typeof c[Symbol.iterator] === "function" ? [...c] : []); };

/** The pips of one ledger: [{ id, k, lk, unit, state: "open"|"used"|"lost" }]. k is the look the existing widgets know ("slow" = the big
    action, "fast" = the small one), lk the label kind ("full" | "quick"). */
export function pipsOf(ledger) {
  const b = Lg.budget(ledger);
  return [
    { id: "tac:full", k: "slow", lk: "full", unit: "full", state: b.full },
    { id: "tac:quick", k: "fast", lk: "quick", unit: "quick", state: b.quick[0] },
    { id: "tac:quick2", k: "fast", lk: "quick", unit: "quick", state: b.quick[1] }
  ];
}
/** Same shape as party/actions.mjs groupsFor(): [{ id, slot, slots, active, tactics, lostTurn, pips }] for the first of these tokens that
    is in the combat with a ledger; null when there is nothing to draw (not in the fight, a challenge, the engine off, the scene over). */
export function groupsFor(tokenIds, combat) {
  const s = tacticsState(combat);
  if (!s || s.mode === "off" || s.phase === "sceneEnd" || s.phase === "idle") return null;
  const turn = O.onTurnIds(s);
  for (const tokenId of tokenIds ?? []) {
    const out = [];
    for (const c of combatantsOf(combat)) {
      if (c?.tokenId !== tokenId || !s.ledger[c.id]) continue;
      const L = s.ledger[c.id];
      out.push({ id: c.id, slot: out.length + 1, slots: 1, active: turn.includes(c.id), tactics: true, lostTurn: !!L.lostTurn, pips: pipsOf(L) });
    }
    if (out.length) { for (const g of out) g.slots = out.length; return out; }
  }
  return null;
}
/** is it the turn of one of these tokens? */
export function isTurnOf(tokenIds, combat) {
  const turn = onTurn(combat);
  if (!turn.length) return false;
  return combatantsOf(combat).some((c) => turn.includes(c.id) && (tokenIds ?? []).includes(c.tokenId));
}
/** what a click on a pip asks for: { unit, on } (open -> mark it used; used -> take the mark back; lost -> nothing) */
export function pipClick(pips, id) {
  const p = (pips ?? []).find((x) => x.id === id);
  if (!p || p.state === "lost") return null;
  return { unit: p.unit, on: p.state === "open" };
}
