/* Year Zero Engine: Combat (yze-combat 1.7.x) support, shared by the combat bar, the Challenges time-on-initiative and the token halo.
   Nothing here touches the other module; it only reads public data. What the module really does (read from yze-combat.js):
     - CONFIG.Combat/Combatant.documentClass = YearZeroCombat / YearZeroCombatant (CONFIG.YZE_COMBAT exists). combat.turns is the core order
       (Combat#setupTurns -> YearZeroCombat#_sortCombatants: flags['yze-combat'].cardValue ascending by the setting initSortOrder, 1 = LOW first);
       the active turn is the core pair combat.turn / combat.combatant (an index into turns), nothing of its own.
     - Initiative = the value of a card (1..10) drawn from a deck (no suits): combatant.initiative === flags['yze-combat'].cardValue (+ the deck size
       when ambushed); followers of a group leader share it (their cardValue gets +/-0.01 only to sort behind the leader).
     - A token with speed N (actor path in the setting actorSpeedAttribute; the Invincible system sets system.initiativeKept) becomes N combatants
       with the same tokenId when the combat starts (duplicateCombatantOnCombatStart) or when it is added to a started one: the duplicates are
       ordinary combatants that each draw their own card.
     - resetEachRound: nextRound() sets every unlocked, living combatant's initiative to null (ONE combat update with all combatants), then with
       initAutoDraw redraws all (updateEmbeddedDocuments + update({turn: 0}, {diff:false}, no `direction`), THEN core's round update {round+1, turn:0}.
       So for a moment the order is rebuilt and initiative is null; previousRound() restores the saved snapshot (flags history).
     - Action usage lives on the ACTOR as status effects (not on the combatant): "fastAction" / "slowAction" (slowAndFastActions) or "action1".."action9"
       (singleAction). The tracker buttons toggle them (Actor#toggleStatusEffect); nextTurn() clears them when the token still has a later duplicate;
       nextRound()/endCombat() clear them for every token. */
export const MODULE = "yze-combat";
export const KEY = "combatYze";

/* the module is installed, active, and its combat classes are the ones in use */
export function yzeActive() {
  try { return !!game.modules.get(MODULE)?.active && !!CONFIG.YZE_COMBAT; } catch { return false; }
}
/* adaptations on: the module is there and the world setting (default on) allows them */
export function yzeOn() {
  try { return yzeActive() && game.settings.get("invincible-plus-ultra", KEY) !== false; } catch { return false; }
}
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/* every living combatant still has no initiative: the draw of the round has not happened (or cannot): order is meaningless, nobody has the turn */
export function yzeWaiting(combat) {
  try {
    const live = (combat?.turns ?? []).filter((c) => !c.isDefeated);
    return live.length > 0 && live.every((c) => num(c.initiative) === null);
  } catch { return false; }
}
/* the module's own switches (read-only) */
export function yzeMode() {
  try {
    const slowFast = !!game.settings.get(MODULE, "slowAndFastActions");
    const single = !slowFast && !!game.settings.get(MODULE, "singleAction");
    return slowFast ? "fastslow" : single ? "single" : "none";
  } catch { return "none"; }
}
/* the actor whose statuses carry the action marks of this combatant */
export const actorOf = (c) => c?.token?.actor ?? c?.actor ?? null;
export const hasStatus = (actor, id) => { try { return !!actor?.statuses?.has?.(id); } catch { return false; } };
