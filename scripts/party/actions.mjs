/* Party cards: ACTION USAGE adapter.
   NOTE: groupsFor() is SHARED: the initiative bar (scripts/combat/bar.mjs) imports it too and picks its tile's group by combatant id (group.id).
   What the data is (yze-combat 1.7.x, see scripts/yze.mjs): action usage lives on the ACTOR as status effects,
   "fastAction" / "slowAction" (setting slowAndFastActions) or "action1".."action9" (singleAction), shared by every entry of a token and cleared by
   nextTurn() between a token's entries, so it is only trustworthy for the entry that owns it: the LAST entry of that token whose index is <= the
   current turn. Earlier entries show "past" (unknown), later ones "open". While the round's initiative is still being drawn everything is "open".
   A token with speed N is N combatants with the same tokenId (duplicateCombatantOnCombatStart): one pip group per entry. */
import { yzeOn, yzeWaiting, yzeMode, hasStatus } from "../yze.mjs";

/* the combat the pips belong to: the active combat of the viewed scene (or scene-less), else the one the tracker views; only once started */
export function pickCombat() {
  const ok = (c) => !!c && !!c.started && (!c.scene || c.scene.id === canvas?.scene?.id);
  try { const a = game.combats?.active; if (ok(a)) return a; } catch { /* none */ }
  try { const v = game.combat; if (ok(v)) return v; } catch { /* none */ }
  return null;
}

/* status ids that are action marks, not conditions (so the effects chip does not count them) */
export const isActionStatus = (id) => id === "fastAction" || id === "slowAction" || /^action[1-9]$/.test(String(id ?? ""));

/* [{ slot, slots, active, pips: [{ k: "fast"|"slow"|"one", state: "used"|"open"|"past" }] }] or null (no combat / not in it / mode none / adaptations off) */
export function groupsFor(tokenIds, actor, combat) {
  try {
    if (!combat || !actor || !yzeOn()) return null;
    const mode = yzeMode();
    if (mode === "none") return null;
    const turns = combat.turns ?? [], turnIdx = combat.turn ?? null, waiting = yzeWaiting(combat);
    for (const tokenId of tokenIds) {
      const entries = [];
      let ownerId = null;
      turns.forEach((c, i) => {
        if (c.tokenId !== tokenId) return;
        entries.push({ c, i });
        if (turnIdx !== null && i <= turnIdx) ownerId = c.id;
      });
      if (!entries.length) continue;
      const used = (id) => hasStatus(actor, id);
      return entries.map(({ c, i }, k) => {
        const slot = k + 1, own = ownerId === c.id, past = turnIdx !== null && i < turnIdx;
        const lone = (kind, id) => ({ k: kind, state: waiting ? "open" : own ? (used(id) ? "used" : "open") : past ? "past" : "open" });
        const pips = mode === "fastslow" ? [lone("fast", "fastAction"), lone("slow", "slowAction")]
          : [{ k: "one", state: waiting ? "open" : used(`action${slot}`) ? "used" : "open" }];
        return { id: c.id, slot, slots: entries.length, active: !waiting && i === turnIdx, pips };
      });
    }
  } catch { /* no pips */ }
  return null;
}

/* is it the turn of one of these tokens (any of its entries)? nobody has the turn while the round's initiative is being drawn */
export function isTurnOf(tokenIds, combat) {
  try {
    const cb = combat ?? pickCombat();
    const id = cb?.combatant?.tokenId;
    return !!id && tokenIds.includes(id) && !(yzeOn() && yzeWaiting(cb));
  } catch { return false; }
}
