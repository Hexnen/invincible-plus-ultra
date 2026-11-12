/* Challenges: time passes on the challenge's own initiative. A challenge token that is a combatant in a started combat loses 1 point of Time Limit
   (TL, system.derived.resolve.value) each time the combat's active turn arrives on it (nextTurn / nextRound landing on it, or startCombat landing on it:
   its first turn in round 1 counts). Stepping back past a turn that was counted refunds the point. Everything runs on ONE client, the active GM
   (game.user.isActiveGM = game.users.activeGM: highest role, then lowest id), through plain actor updates, so the HUD, the time bar and the Time-up
   shake / camera react through their existing updateActor hooks.
   Position: Combat#_onUpdate (core combat.mjs 634-648) records combat.previous = the state BEFORE the update, and Document then fires updateCombat, so inside
   the hook combat.previous.{round,turn} is the old position and combat.round / combat.turn the new one (turn is an index into combat.turns, or null).
   (combatTurnChange is not used: the active GM receives it only after awaiting the turn events, by which time previous may already be overwritten.)
   Forward move: every (round, turn) in (previous, current] is "passed through", also the ones a multi-turn / multi-round jump skips over, and the
   combatant standing there is charged once. Key `combatId:round:tokenId` (a Year Zero duplicate of a token charges once per round, on its first arrival; the redraw update and a waiting draw are ignored) is kept in memory (this client) so duplicate hook calls never charge twice;
   when the position later lies BEFORE a counted key (previousTurn / previousRound / round reset) the key is cleared and the point given back (clamped to
   max). Not charged: defeated combatants, combatants without a numeric initiative (core sorts them last, they take no real turn), TL max 0 / missing,
   TL already 0. Several combatants of one linked actor are separate initiatives and each charge on their own turn.
   Time unit: only challenges whose unit (actor flag timeUnit, lang.mjs unitOf; missing = rounds) is "rounds" take part. One counted in minutes / hours /
   days / weeks is neither charged nor refunded (no key is recorded for it, so a later switch back to rounds finds nothing to refund; a point already
   charged while it was in rounds is not given back after the switch).
   Updates tagged turnEvents:false (core's own reorder after rolling initiative) are ignored: the pointer only follows the reordered list.
   Nothing here may break combat: all entry points are try / catch, updates go through one sequential queue.
   TACTICAL COMBAT (scripts/tactics/, the module's own card initiative): everything above describes a combat run by core or by Year Zero Engine:
   Combat. In a combat that carries the module's own state a challenge has no card and no turn [R22] [I12]; its time limit counted in rounds
   runs down by one at the END of every round. The tactics engine does that itself (scripts/tactics/engine-pure.mjs challengeClock): the tick
   is an entry of its journal the GM can undo, and at 0 the engine raises the "time is up" card. Nothing here touches such a combat. */
import * as Camera from "./camera.mjs";
import { t, unitOf, DEFAULT_UNIT } from "./lang.mjs";
import { yzeWaiting } from "../yze.mjs";
import { tacticsState } from "../tactics/source.mjs";

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (challenges combat) |`;
export const COMBAT_KEY = "challengesCombatTime";
const KEYS_FLAG = "challengeCharges";   // combat flag: the charged keys survive a reload / GM handover (the Map below is rebuilt from it)
const HUSH_MS = 2500;
const MAX_ROUNDS_JUMP = 100;

const counted = new Map();   // `${combatId}:${round}:${tokenId}` -> { combatId, round, tid, applied: null | true | false } (one per TOKEN: Year Zero duplicates of one token charge once)
const tokenOf = (c) => c?.tokenId ?? c?.token?.id ?? c?.id;
let started = false, chain = Promise.resolve();

const enabled = () => { try { return game.settings.get(MOD, COMBAT_KEY) !== false; } catch { return true; } };

export function registerCombatSettings() {
  if (game.settings.settings.has(`${MOD}.${COMBAT_KEY}`)) return;
  game.settings.register(MOD, COMBAT_KEY, {
    name: t("INCH.Settings.CombatTime.Name"), hint: t("INCH.Settings.CombatTime.Hint"), scope: "world", config: true, type: Boolean, default: true
  });
}

/* the challenge actor of a combatant that may be charged (token actor: the synthetic one for an unlinked token), or null */
function chargeable(c) {
  const actor = c?.token?.actor;
  if (!actor || actor.type !== "challenge" || unitOf(actor) !== DEFAULT_UNIT || c.isDefeated || !Number.isFinite(Number(c.initiative)) || c.initiative === null) return null;
  return actor;
}

/* queued change of the TL; a plain tick stays out of the cinematic camera, reaching 0 must not be hushed so the "state" (time up) shot still fires */
function tick(actor, delta, rec) {
  chain = chain.then(async () => {
    try {
      if (!enabled() || !game.user.isActiveGM || unitOf(actor) !== DEFAULT_UNIT) { if (rec && delta < 0) rec.applied = false; return; }   // the unit may have changed while queued
      const d = actor.system?.derived?.resolve;
      const max = Number(d?.max), cur = Number(d?.value);
      if (!(max > 0) || !Number.isFinite(cur)) { if (rec && delta < 0) rec.applied = false; return; }
      if (delta < 0 && rec && cur <= 0) { rec.applied = false; return; }                // nothing to consume
      if (delta > 0 && rec?.applied === false) return;                                  // the charge never happened: nothing to give back
      const next = Math.min(max, Math.max(0, cur + delta));
      if (next === cur) { if (rec && delta < 0) rec.applied = false; return; }
      Camera.hush(next > 0 ? HUSH_MS : 0);
      await actor.update({ "system.derived.resolve.value": next });
      if (rec && delta < 0) rec.applied = true;
    } catch (e) { console.warn(LOG, "update failed", e); if (rec && delta < 0) rec.applied = false; }
    finally { try { Camera.hush(0); } catch { /* no camera */ } }
  }).catch((e) => console.warn(LOG, e));
}

const posCmp = (r1, t1, r2, t2) => (r1 - r2) || (t1 - t2);

/* an empty Map for this combat (reload, new active GM) is refilled from the flag written alongside the charges */
function hydrate(combat) {
  for (const rec of counted.values()) if (rec.combatId === combat.id) return;
  let saved = null;
  try { saved = combat.getFlag?.(MOD, KEYS_FLAG); } catch { /* no flag */ }
  for (const r of Array.isArray(saved) ? saved : []) {
    if (!r || !Number.isFinite(Number(r.round)) || r.tid === undefined || r.tid === null) continue;
    counted.set(`${combat.id}:${r.round}:${r.tid}`, { combatId: combat.id, round: Number(r.round), tid: r.tid, applied: true });
  }
}

/* queued after the ticks (so applied is known): write the keys whose charge really happened */
function persist(combat) {
  chain = chain.then(async () => {
    try {
      if (!game.user.isActiveGM) return;
      const now = [...counted.values()].filter((r) => r.combatId === combat.id && r.applied === true).map((r) => ({ round: r.round, tid: r.tid }));
      let old = null;
      try { old = combat.getFlag?.(MOD, KEYS_FLAG); } catch { /* none */ }
      if (JSON.stringify(old ?? []) === JSON.stringify(now)) return;
      await combat.setFlag(MOD, KEYS_FLAG, now);
    } catch (e) { console.warn(LOG, "persist failed", e); }
  }).catch((e) => console.warn(LOG, e));
}

function onUpdateCombat(combat, changes, options) {
  if (!combat || !game.user.isActiveGM || !enabled()) return;
  if (tacticsState(combat)) return;                                                  // the tactics engine runs the clock itself, journaled (scripts/tactics/engine-pure.mjs challengeClock)
  if (changes?.round === undefined && changes?.turn === undefined) return;
  // Year Zero Engine: Combat redraw of the round (update({turn: 0}, {diff: false}) after the initiative reset) is a rebuild of the order, not a move
  if (changes?.round === undefined && options?.diff === false) return;
  const R = Number(combat.round) || 0;
  const T = combat.turn ?? -1;
  const turns = combat.turns ?? [];
  if (yzeWaiting(combat)) return;                                                    // the draw has not landed: no order, no turn, nothing to charge or refund

  hydrate(combat);
  // 1. back: every counted key that now lies after the current position is undone (a round reset to 0 undoes all of them)
  for (const [key, rec] of counted) {
    if (rec.combatId !== combat.id) continue;
    const idx = turns.findIndex((c) => tokenOf(c) === rec.tid);                       // first entry of the token (its first arrival)
    if (R > 0 && idx === -1) { counted.delete(key); continue; }                     // the combatant left the combat: no refund
    if (R > 0 && posCmp(rec.round, idx, R, T) <= 0) continue;
    counted.delete(key);
    const actor = (turns[idx] ?? combat.combatants.find((c) => tokenOf(c) === rec.tid))?.token?.actor;
    if (actor?.type === "challenge" && unitOf(actor) === DEFAULT_UNIT) tick(actor, +1, rec);
  }
  persist(combat);

  // 2. forward: every position in (previous, current] is passed through
  if (R < 1 || options?.turnEvents === false) return;
  const pr = Number(combat.previous?.round) || 0, pt = combat.previous?.turn ?? -1;
  if (posCmp(R, T, pr, pt) <= 0) return;
  for (let r = Math.max(pr, 1, R - MAX_ROUNDS_JUMP); r <= R; r++) {
    const lo = r === pr ? pt + 1 : 0, hi = r === R ? T : turns.length - 1;
    for (let tn = lo; tn <= hi; tn++) {
      const c = turns[tn], actor = chargeable(c);
      if (!actor) continue;
      const key = `${combat.id}:${r}:${tokenOf(c)}`;      // later duplicates of the same token in this round find the key and do nothing
      if (counted.has(key)) continue;
      const rec = { combatId: combat.id, round: r, tid: tokenOf(c), applied: null };
      counted.set(key, rec);
      tick(actor, -1, rec);
    }
  }
  persist(combat);
}

export function start() {
  if (started) return;
  started = true;
  try {
    Hooks.on("updateCombat", (combat, changes, options) => { try { onUpdateCombat(combat, changes, options); } catch (e) { console.warn(LOG, e); } });
    Hooks.on("deleteCombat", (c) => { try { for (const [k, r] of counted) if (r.combatId === c.id) counted.delete(k); } catch { /* ignore */ } });
  } catch (e) { console.warn(LOG, "start failed", e); }
}
