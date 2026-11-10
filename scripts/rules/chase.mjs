/* Rules library: chases. Pure ES module, no Foundry globals. No map: only the distance in zones between the sides is tracked (book 3412).
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. Dice are inputs. */

import { opposed } from "./dice.mjs";

/* book 3436: the pursuer loses the prey when the distance grows too far; 5 zones is the default, the terrain may change it. */
export const CHASE_END_DISTANCE = 5;

/* book 3433 + ruling 25: in the chase roll both sides are active and both may push: first the prey, then the pursuer. */
export const CHASE_PUSH_ORDER = ["prey", "pursuer"];

/* Round structure (book 3432, 3436-3442): either side may give up or turn the chase into combat at the start of a round; then the
   obstacle (if used) with its rolls, prey first, which are no actions; then the opposed movement roll; then, at distance 0, the
   pursuer's charge or ram; then crew attacks: everyone in the pursuing vehicle, then everyone in the prey vehicle; a mounted weapon may
   be fired by the driver or pilot once per round at that point. */
export const CHASE_ROUND = ["endOrCombat", "obstacle", "movement", "catch", "crewPursuer", "crewPrey"];

/* book 3416-3429: the faster side (zones per action) gets bonus dice: twice the speed or more +2, three times +3, four times +4, and so on. */
export function chaseModifier(ownSpeed, otherSpeed) {
  if (!(otherSpeed > 0) || !(ownSpeed >= 2 * otherSpeed)) return 0;
  return Math.floor(ownSpeed / otherSpeed);
}

/* Dice modifiers of one side's movement roll (AGILITY, book 3432): vehicle Maneuverability, speed bonus, this round's obstacle.
   input: { speed, otherSpeed, maneuver, obstacle (id, see CHASE_OBSTACLES) }. Returns [{ source, dice }]. */
export function chaseModifiers({ speed, otherSpeed, maneuver = 0, obstacle = null }) {
  const mods = [];
  if (maneuver) mods.push({ source: "maneuverability", dice: maneuver });
  const s = chaseModifier(speed, otherSpeed);
  if (s) mods.push({ source: "speed", dice: s });
  const o = CHASE_OBSTACLES[obstacle];
  if (o?.agilityDice) mods.push({ source: obstacle, dice: o.agilityDice });
  return mods;
}

/* Result of the movement roll. input: { distance, preySixes, pursuerSixes, endDistance, preyAutoFail }.
   book 3434: the winner changes the distance by 1 zone for each 6 more than the loser (the prey widens it, the pursuer closes it);
   never below 0; at 0 the pursuer may at once make a charge attack (a ram in a vehicle) that cannot be blocked.
   book 3436: beyond the end distance the prey is lost. book 3452: a dead end makes the prey fail automatically.
   Reading: "too far" = the distance exceeds the end distance.
   Returns { distance, winner: "prey" | "pursuer" | null, caught, escaped }. */
export function chaseRoll({ distance, preySixes, pursuerSixes, endDistance = CHASE_END_DISTANCE, preyAutoFail = false }) {
  const prey = preyAutoFail ? 0 : preySixes;
  let d = distance, winner = null;
  if (prey > pursuerSixes) { d += opposed(prey, pursuerSixes).net; winner = "prey"; }
  else if (pursuerSixes > prey) { d = Math.max(0, d - opposed(pursuerSixes, prey).net); winner = "pursuer"; }
  return { distance: d, winner, caught: d === 0, escaped: d > endDistance };
}

/* book 3448-3476: chase obstacles on a D66 (tens die, ones die).
   agilityDice   modifier to all AGILITY rolls of the round
   rolls         who must roll what before the movement roll (no action; prey first, book 3442)
   onFail        what a failed roll does: { distance: +1 / -1 } moves the pursuer away / closer, { damage: n | "d6" } hurts the one who
                 failed or their vehicle, { chaseOver: true } ends the chase
   special       preyAutoFail (no push possible), hiddenPath (the pursuer rolls INTUITION only when the prey succeeded; a pursuer
                 failure ends the chase), shortcut (a pursuer success halves the distance, rounding up, before the movement roll) */
export const CHASE_OBSTACLES = {
  clear: { from: 11, to: 36 },
  deadEnd: { from: 41, to: 42, preyAutoFail: true },
  cantSee: { from: 43, to: 44, agilityDice: -2 },
  outOfTheWay: { from: 45, to: 46, rolls: [{ who: "prey", attr: "agility" }], onFail: { distance: -1 } },
  unsteady: { from: 51, to: 52, agilityDice: -2 },
  closeCall: { from: 53, to: 54, rolls: [{ who: "prey", attr: "agility" }, { who: "pursuer", attr: "agility" }], onFail: { damage: 1 } },
  blocked: { from: 55, to: 56, rolls: [{ who: "pursuer", attr: "agility" }], onFail: { distance: 1 } },
  obstruction: { from: 61, to: 62, rolls: [{ who: "prey", attr: "agility" }, { who: "pursuer", attr: "agility" }], onFail: { damage: "d6" } },
  hiddenPath: { from: 63, to: 64, rolls: [{ who: "prey", attr: "intuition", optional: true }], hiddenPath: true },
  shortcut: { from: 65, to: 66, rolls: [{ who: "pursuer", attr: "intuition", optional: true }], shortcut: true },
};
/* D66 -> obstacle id. Accepts the two dice or the two-digit number. */
export function chaseObstacle(tens, ones = null) {
  const n = ones == null ? tens : tens * 10 + ones;
  const t = Math.floor(n / 10), o = n % 10;
  if (!(t >= 1 && t <= 6 && o >= 1 && o <= 6)) throw new Error(`chaseObstacle: not a D66 result: ${n}`);
  for (const [id, e] of Object.entries(CHASE_OBSTACLES)) if (n >= e.from && n <= e.to) return id;
  throw new Error(`chaseObstacle: no entry for ${n}`);
}

/* Apply what an obstacle does to the distance before the movement roll. results: { prey?: sixes, pursuer?: sixes } of the rolls it asked for.
   book 3458 out of the way: prey failure = pursuer 1 zone closer; 3467 blocked: pursuer failure = 1 zone further away;
   3473 hidden path: prey success then pursuer failure = the chase is over; 3476 shortcut: pursuer success = distance halved, rounded up.
   Damage results (3464, 3470) are returned for the caller to apply. Returns { distance, chaseOver, damage: [{ who, amount }] }. */
export function applyObstacle({ obstacle, distance, results = {} }) {
  const e = CHASE_OBSTACLES[obstacle];
  if (!e) throw new Error(`applyObstacle: unknown obstacle "${obstacle}"`);
  const out = { distance, chaseOver: false, damage: [] };
  const failed = (who) => results[who] != null && !(results[who] > 0);
  if (e.hiddenPath) { if (results.prey > 0 && failed("pursuer")) out.chaseOver = true; return out; }
  if (e.shortcut) { if (results.pursuer > 0) out.distance = Math.ceil(distance / 2); return out; }
  for (const r of e.rolls ?? []) {
    if (!failed(r.who)) continue;
    if (e.onFail.distance) out.distance = Math.max(0, out.distance + e.onFail.distance);
    if (e.onFail.damage) out.damage.push({ who: r.who, amount: e.onFail.damage });
  }
  return out;
}

/* book 3479: with several participants on two sides only the slowest of each side rolls: lowest movement speed, lowest AGILITY on a tie.
   members: [{ id, speed, agility }]. Returns the member who rolls. */
export function chaseRoller(members) {
  return members.slice().sort((a, b) => a.speed - b.speed || a.agility - b.agility)[0] ?? null;
}

/* book 3480: the detailed way: everybody rolls; each 6 moves that participant 1 zone forward relative to all others; a participant is
   pursuer to everyone in front and prey to everyone behind. positions: { [id]: zones }, sixes: { [id]: n }. Returns new positions. */
export function chaseAdvance(positions, sixes) {
  return Object.fromEntries(Object.entries(positions).map(([id, p]) => [id, p + Math.max(0, sixes[id] ?? 0)]));
}
