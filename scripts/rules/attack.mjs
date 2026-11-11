/* Rules library: attack kinds, legality, dice modifiers, defences and the outcome of an attack from given dice.
   Pure ES module, no Foundry globals. "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

import { opposed, stuntCount } from "./dice.mjs";
import { fullAutoDice, isImmune } from "./stunts.mjs";
import { MIN_RANGE_PENALTY } from "./zones.mjs";

/* attack kinds. attr = attribute rolled, defence = the interrupt that may answer it, cost = actions consumed, family = which stunt and
   bonus rules apply.
   slugfest       book 2425: FIGHTING, full action, blocked (2446)
   charge         book 2490-2492: STRENGTH, full + quick action (combined with movement), cannot be blocked, dodged like a shooting attack
   grapple        book 2496: FIGHTING, blocked as usual, no weapon
   grappleAttack  book 2497: a slugfest attack by the one holding, cannot be blocked
   counterattack  book 2448: hits automatically, cannot be blocked (ruling 4)
   shooting       book 2510, 2524: AGILITY, full action, dodged
   ram            book 3148: a slugfest attack rolled with AGILITY (+ Maneuverability); in a chase it cannot be blocked (book 3434) */
export const ATTACKS = {
  slugfest: { attr: "fighting", defence: "block", cost: ["full"], family: "slugfest" },
  charge: { attr: "strength", defence: "dodge", cost: ["full", "quick"], family: "slugfest" },
  grapple: { attr: "fighting", defence: "block", cost: ["full"], family: "slugfest" },
  grappleAttack: { attr: "fighting", defence: null, cost: ["full"], family: "slugfest" },
  counterattack: { attr: null, defence: null, cost: [], family: "slugfest" },
  shooting: { attr: "agility", defence: "dodge", cost: ["full"], family: "shooting" },
  ram: { attr: "agility", defence: "block", cost: ["full"], family: "slugfest" },
};
export const DEFENCES = { block: { attr: "fighting", cost: "quick" }, dodge: { attr: "agility", cost: "quick" } };   // book 2310-2314, 2446, 2524

/* Conditions of a target that matter to attackers and defences.
   held        held in a grapple (book 2496; ruling 6: no block, no dodge, +2 dice for attackers in slugfest only)
   snared      caught by the Snare power (book 1606; ruling 21: no physical actions, no defence, +2 dice for attackers in slugfest)
   trapped     the Trap stunt (book 2438; ruling 20: only movement and slugfest attacks are blocked; the target still blocks and dodges)
   unaware     does not know of the attacker (book 2430, 2524)
   noInterrupts lost its coming turn to Stun / Suppressed or a similar effect (book 2436, 2517; ruling 10)
   carriedAloft carried by a flyer who stayed airborne, or that flyer (book 2392: no attack, block or dodge until landed)
   out         out of action: broken, unconscious or dead (book 2707: no movement, no attribute roll, no power); the value is the reason id
   holding     holds somebody in a grapple (book 2497: the only actions left are movement and the grapple attack; a block and a dodge are
               quick actions, book 2446, 2524) */
export const restrained = (t = {}) => !!(t.held || t.snared);

/* Dice modifiers of an attack roll (to be added to the attribute with dice.mjs buildPool).
   input: { attack, target (conditions above), weaponBonus, wreckBonus, distance, range: [min, max], targets (full auto count), helpers, critDice }
   book 2430 + ruling 6 / 21: +2 dice against a restrained or unaware target, in slugfest only (never for shooting);
   book 2511: -3 dice closer than the minimum range; book 2536: weapon bonus; book 2452: bonus dice for wrecking the zone;
   book 2543: full auto, -1 die per target beyond the first; book 2238: +1 per helper (cap applied by the caller with helpDice).
   Returns [{ source, dice }]. */
export const UNAWARE_BONUS = 2;
export function attackModifiers({ attack, target = {}, weaponBonus = 0, wreckBonus = 0, distance = null, range = null, targets = 1, helpers = 0, critDice = 0 }) {
  const def = ATTACKS[attack];
  if (!def) throw new Error(`attackModifiers: unknown attack "${attack}"`);
  const mods = [];
  const add = (source, dice) => { if (dice) mods.push({ source, dice }); };
  add("weapon", weaponBonus);
  if (def.family === "slugfest") {
    if (restrained(target)) add("restrained", UNAWARE_BONUS);
    else if (target.unaware) add("unaware", UNAWARE_BONUS);
    add("wreck", wreckBonus);
  }
  if (def.family === "shooting") {
    if (range && distance != null && distance < range[0]) add("minRange", MIN_RANGE_PENALTY);
    add("fullAuto", fullAutoDice(targets));
  }
  add("help", helpers);
  add("crit", critDice ? -Math.abs(critDice) : 0);
  return mods;
}

/* May the target answer with a block or a dodge?
   input: { attack, defender: conditions + { hasQuick }, inChase }
   block: book 2446-2447 slugfest only, a quick action must be left; 2430 not when restrained or unaware; 2492 never a charge;
          2497 never a grapple attack; 2448 + ruling 4 never a counterattack; 3434 never the charge / ram that ends a chase.
   dodge: book 2524-2525 shooting attacks (and charges, book 2492), a quick action must be left, only when aware of the attacker.
   both:  book 2707 not while out of action; ruling 6 not while held; ruling 21 not while snared; book 2497 not while holding somebody;
          ruling 20 a trapped target may do both; book 2436 / 2517 + ruling 10 not after losing the coming turn; book 2392 not while
          carried aloft.
   Returns { block: { ok, reason }, dodge: { ok, reason } }. */
export function defenceOptions({ attack, defender = {}, inChase = false }) {
  const def = ATTACKS[attack];
  if (!def) throw new Error(`defenceOptions: unknown attack "${attack}"`);
  const common = defender.out ? (typeof defender.out === "string" ? defender.out : "broken") : defender.held ? "held" : defender.snared ? "snared" : defender.holding ? "grappling" : defender.noInterrupts ? "noInterrupts" : defender.carriedAloft ? "carriedAloft"
    : defender.unaware ? "unaware" : defender.hasQuick === false ? "noQuickAction" : null;
  const one = (kind) => {
    if (def.defence !== kind || (inChase && (attack === "charge" || attack === "ram"))) return { ok: false, reason: "notAllowed" };
    return common ? { ok: false, reason: common } : { ok: true, reason: null };
  };
  return { block: one("block"), dodge: one("dodge") };
}

/* Outcome of an attack from the dice.
   input: { attack, attackSixes, defence: null | "block" | "dodge", defenceSixes }
   book 2426, 2512 a hit needs one 6; book 2446, 2524 a defence makes it an opposed roll (each defence 6 removes an attack 6);
   book 2433, 2515 6s beyond the first buy stunts (after the defence took its share);
   book 2448 + ruling 4 a blocker with more 6s than the attacker counterattacks: of the 6s beyond those that cancelled the attack the
   first is the hit and the rest are stunts; the counterattack cannot be blocked;
   book 2526 a dodger with more 6s makes a dodge move of up to one zone per 6 beyond the attacker's;
   ruling 5 the grapple that takes hold buys no stunts.
   Returns { hit, net, stunts, counterattack: null | { sixes, stunts }, dodgeMove }. */
export function resolveAttack({ attack, attackSixes, defence = null, defenceSixes = 0 }) {
  if (!ATTACKS[attack]) throw new Error(`resolveAttack: unknown attack "${attack}"`);
  if (attack === "counterattack") return { hit: true, net: attackSixes, stunts: stuntCount(attackSixes), counterattack: null, dodgeMove: 0 };
  const o = opposed(attackSixes, defence ? defenceSixes : 0);
  const out = { hit: o.win, net: o.net, stunts: attack === "grapple" ? 0 : stuntCount(o.net), counterattack: null, dodgeMove: 0 };
  if (defence === "block" && o.surplus > 0) out.counterattack = { sixes: o.surplus, stunts: stuntCount(o.surplus) };
  if (defence === "dodge" && o.surplus > 0) out.dodgeMove = o.surplus;
  return out;
}

/* Area effect and full auto (book 1221, 2542-2543, 2920; ruling 14): one attack roll; every target declares a dodge before the roll and
   rolls its own; a failed attack hurts nobody; everybody hit takes the base Damage; the stunts are distributed among the targets hit.
   input: { attackSixes, targets: [{ id, dodgeSixes }] }.
   Reading: the stunt budget is the attack's 6s beyond the first; a stunt can only be given to a target that was hit, and for that
   target only 6s left after its own dodge are available (a target that cancelled all but one 6 takes no stunt).
   Returns { anyHit, budget, targets: [{ id, hit, net, stuntsMax, dodgeMove }] }. */
export function resolveAreaAttack({ attackSixes, targets }) {
  const res = targets.map((t) => {
    const o = opposed(attackSixes, t.dodgeSixes ?? 0);
    return { id: t.id, hit: o.win, net: o.net, stuntsMax: stuntCount(o.net), dodgeMove: o.surplus };
  });
  return { anyHit: res.some((r) => r.hit), budget: stuntCount(attackSixes), targets: res };
}

/* Charge (book 2490-2494; ruling 19).
   legality: must be combined with movement (a full and a quick action), cannot start in the target's zone, the move must end at the
   target. input: { sameZone, hasFull, hasQuick, moveDistance (zones to the target along a passable route), moveAllowance }.
   Returns { ok, reason, movementLeft } (movementLeft feeds the Slam stunt). */
export function chargeCheck({ sameZone, hasFull, hasQuick, moveDistance, moveAllowance }) {
  if (sameZone || moveDistance === 0) return { ok: false, reason: "sameZone", movementLeft: 0 };
  if (!hasFull || !hasQuick) return { ok: false, reason: "actions", movementLeft: 0 };
  if (!(moveDistance <= moveAllowance)) return { ok: false, reason: "tooFar", movementLeft: 0 };
  return { ok: true, reason: null, movementLeft: moveAllowance - moveDistance };
}
/* ruling 19 (book 2490, 2492): the charge stops at the point of attack: also when it is dodged, the charger ends in the zone where the
   target stood. */
export const chargeEndZone = (targetZoneAtDeclaration) => targetZoneAtDeclaration;

/* Grapple (book 2496-2497, 2502). legality of the attempt. `target` carries the immunity flags of stunts.mjs (immunitiesOf): a huge
   creature gives reason "huge" (book 2502), a target otherwise immune to grappling gives "immune" (a hero grown by Size Alteration,
   book 1975). `targetHuge` is the older form of target.huge. */
export function grappleCheck({ targetHuge = false, usesWeapon = false, target = null }) {
  if (targetHuge || target?.huge) return { ok: false, reason: "huge" };
  if (target && isImmune(target, "grapple")) return { ok: false, reason: "immune" };
  if (usesWeapon) return { ok: false, reason: "weapon" };
  return { ok: true, reason: null };
}
/* book 2497: what the one holding may do until releasing: move (pulling the held one along), a grapple attack, let go. */
export const GRAPPLER_ACTIONS = ["move", "grappleAttack", "release"];
/* book 2496: the held one cannot move or act with the body (slugfest and shooting included) except to break free. */
export const HELD_ACTIONS = ["breakFree"];
