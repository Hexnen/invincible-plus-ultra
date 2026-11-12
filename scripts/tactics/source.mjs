/* Tactical combat: the READ SIDE for the parts of the module that used to read Year Zero Engine: Combat markers (turn tray,
   initiative bar, party cards, token halo, Challenges time). It only reads plain properties of the Combat document it is given
   (flags, combatants), so it runs in node as well (check-source.mjs) and can be imported statically by those parts.
   When a combat carries the module's own state, that state is the truth; otherwise the callers fall back to scripts/yze.mjs (so a table
   that still runs yze-combat with tactical mode off loses nothing).
   What a pip is here [L1] [B2289] [B2291]: the base budget of a turn is one full and one quick action, or two quick ones: TWO slots
   (U31: three pips read as three actions). The big one is the full action, or the second quick one (the full action is then given
   up [L3]); the small one is the quick action. */
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
/** U118: who sits in a vehicle of this fight, the driver first ([] when nobody, or the combat is not ours) */
export function aboard(combat, vid) {
  const r = tacticsState(combat)?.vehicles?.[vid];
  return r && typeof r === "object" ? [r.driver, ...(Array.isArray(r.crew) ? r.crew : [])].filter((x) => typeof x === "string" && x) : [];
}
/** U118: the side a vehicle shows on the initiative bar. A vehicle is a thing: the token's own disposition (hostile by default for a new
    token) says nothing about whose it is. It shows the side of the first one aboard who has one, else friendly when a player owns it,
    else neutral. `disps` = the dispositions of those aboard, in order; D = CONST.TOKEN_DISPOSITIONS */
export const vehicleDisp = (disps, playerOwned, D) => (disps ?? []).map(Number).find((n) => n === D.FRIENDLY || n === D.HOSTILE || n === D.NEUTRAL) ?? (playerOwned ? D.FRIENDLY : D.NEUTRAL);
/** H3-4: THE side of an actor for every surface that is not the engine (the splash, ...), by the one rule (state-pure.heroSide, D114):
    a superhero actor a player owns (a non-GM user with Owner in its ownership table, as system-adapter.ownersOf reads it) or whose token
    (the scene token it stands for, else its synthetic token, else its prototype) is friendly. A book villain is not. users = the
    caller's game.users (this file reads no global) */
export function heroActor(actor, token = null, users = []) {
  try {
    if (!actor) return false;
    const list = Array.isArray(users) ? users : users?.contents ?? (users && typeof users[Symbol.iterator] === "function" ? [...users] : []);
    const owned = list.some((u) => u && !u.isGM && O.ownsFrom(actor.ownership, u.id, 3));
    return S.heroSide({ type: actor.type, owned, disposition: (token ?? actor.token ?? actor.prototypeToken)?.disposition });
  } catch { return false; }
}
/** "tactics": the module's own card initiative and ledger run this combat. null: they do not (yze-combat or plain core). */
export const sourceOf = (combat) => (tacticsState(combat) ? "tactics" : null);
/** nobody has the turn: the cards of the round are being dealt, a blocking queue is open, the scene has ended, or the engine is switched off */
export function waiting(combat) {
  const s = tacticsState(combat);
  return !!s && (O.isWaiting(s) || s.phase === "sceneEnd" || s.phase === "idle" || !s.init.curMember);
}
/** D107: WHY nobody has the turn, for the bar's plate (it said "drawing" for a whole chase): "chase" (a chase holds no cards, its
    rounds turn at the GM's word), "draw", "roundStart", "roundEnd", "sceneEnd", "idle", "nobody" (turns, but no member now), or null
    when somebody has the turn (or the combat is not ours) */
export function waitKind(combat) {
  const s = tacticsState(combat);
  if (!s || !waiting(combat)) return null;
  if (s.kind === "chase") return "chase";
  if (["draw", "roundStart", "roundEnd", "sceneEnd", "idle"].includes(s.phase)) return s.phase;
  return "nobody";
}
/** ids of the combatants that have the turn (the member whose turn it is and what acts on its turn [I14]) */
export const onTurn = (combat) => { const s = tacticsState(combat); return s ? O.onTurnIds(s) : []; };

const combatantsOf = (combat) => { const c = combat?.combatants; return Array.isArray(c) ? c : c?.contents ?? (c && typeof c[Symbol.iterator] === "function" ? [...c] : []); };

/** The pips of one ledger, one per slot: [{ id, k, lk, unit, state: "open"|"used"|"lost" }]. k is the look the existing widgets know
    ("slow" = the big slot, "fast" = the small one), lk the label kind ("full" | "quick": the big slot spent on a quick action reads
    "quick"), unit what a hand-made mark of it asks for. */
export function pipsOf(ledger) {
  const [a, b] = Lg.slots(Lg.budget(ledger));
  return [
    { id: "tac:full", k: "slow", lk: a.as ?? a.only ?? "full", unit: a.unit, state: a.state },
    { id: "tac:quick", k: "fast", lk: "quick", unit: "quick", state: b.state }
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
