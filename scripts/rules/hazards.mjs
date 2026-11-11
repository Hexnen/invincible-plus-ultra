/* Rules library: hazards: fire, falling, placed explosives, vacuum, disease and poison. Pure ES module, no Foundry globals.
   Hazards are initiators without a character: their rolls are never pushed (book 2922; plan 5.2). Dice are inputs; `rng` is a function
   returning [0, 1) where the book asks for a random choice.
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

import { opposed } from "./dice.mjs";
import { borderOpen } from "./zones.mjs";

/* ------------------------------------------------------------------ fire ------------------------------------------------------------------ */

/* book 2925: a fire has an Intensity (typically 6-9) and attacks with that many dice; every 6 = 2 points of damage; Armor works as usual. */
export const FIRE_DAMAGE_PER_SIX = 2;
export const firePool = (intensity) => Math.max(1, Math.floor(intensity));
export const fireDamage = (sixes) => FIRE_DAMAGE_PER_SIX * Math.max(0, sixes);

/* book 2925-2926: who suffers a fire attack. On entering a burning zone; at the start of a round for everybody in a burning zone and
   for everybody who is on fire, wherever they are (one attack per character and round). when: "enter" | "roundStart". */
export function fireAttackDue({ when, inBurningZone, burning = false }) {
  if (when === "enter") return !!inBurningZone;
  if (when === "roundStart") return !!inBurningZone || !!burning;
  return false;
}

/* Result of a fire attack on one character. input: { sixes, armor, inBurningZone, wasBurning, immune, vulnerable }.
   book 2193 (Vulnerable to fire): the damage is doubled and no Armor counts; as in damage.hitDamage a vulnerability goes before an immunity.
   book 2926: damage from a fire attack sets the character on fire; a fire attack suffered outside a burning zone that does no damage
   ends it. (Inside a burning zone an attack without damage changes nothing.) Returns { raw, taken, burning }. */
export function fireOutcome({ sixes, armor = 0, inBurningZone, wasBurning = false, immune = false, vulnerable = false }) {
  const raw = fireDamage(sixes) * (vulnerable ? 2 : 1);
  const taken = immune && !vulnerable ? 0 : Math.max(0, raw - (vulnerable ? 0 : Math.max(0, armor)));
  const burning = taken > 0 ? true : inBurningZone ? wasBurning : false;
  return { raw, taken, burning };
}

/* book 2926: putting out a burning character: AGILITY roll, full action, by the character or by an ally in the same zone. */
export const EXTINGUISH = { attr: "agility", action: "full", by: ["self", "allySameZone"] };
export const extinguishOutcome = (sixes) => ({ burning: !(sixes > 0) });

/* book 2927: a typical fire rolls a D6 at the start of each round: 1-2 it goes out, 5-6 it spreads to a random adjacent zone with the
   same Intensity, provided the border is not blocked and the zone holds something that burns. Returns "out" | "stays" | "spreads". */
export function fireSpreadRoll(d6) {
  return d6 <= 2 ? "out" : d6 >= 5 ? "spreads" : "stays";
}
/* zones a fire in `zone` can spread to (book 2927): neighbours behind a border that is not blocked, flammable, not yet burning.
   burning: iterable of zone ids already on fire.
   The book asks for a border that is "not blocked" and for "something that can burn" and says no more (question OQ-15 of the handoff),
   so the criteria are parameters; the defaults are what this library did from the start:
     opts.doors          "pass" (default): a border open to movement lets fire through, an unlocked door included;
                         "block": any standing wall stops it, with or without a door (book 2254 calls a border with a door a blocked
                         border; this is what the map's own fire round does)
     opts.needFlammable  true (default): only zones marked flammable burn; false: every zone can
     opts.water          "burns" (default) | "never": zones marked `water` do not catch fire (the map's own fire round) */
export function fireSpreadTargets(graph, zone, burning = [], opts = {}) {
  const lit = new Set(burning);
  const out = new Set();
  const passes = (border) => (opts.doors === "block" ? !(border.wall && border.wall.state === "intact") : borderOpen(border));
  for (const { to, border } of graph.adj.get(zone) ?? []) {
    const z = graph.zones.get(to);
    if (!passes(border) || lit.has(to) || to === zone) continue;
    if (opts.needFlammable !== false && !z.flammable) continue;
    if (opts.water === "never" && z.water) continue;
    out.add(to);
  }
  return [...out];
}
/* the random adjacent zone, or null when the fire has nowhere to go */
export function pickFireSpread(rng, graph, zone, burning = [], opts = {}) {
  const c = fireSpreadTargets(graph, zone, burning, opts);
  return c.length ? c[Math.floor(rng() * c.length)] : null;
}

/* ------------------------------------------------------------------ falling ------------------------------------------------------------------ */

/* book 2391: a fall from elevated altitude does D6 damage, from sky high 2D6; nobody falls in orbit. Returns the number of D6. */
export function fallDice(fromAlt) {
  return fromAlt === "elevated" ? 1 : fromAlt === "sky" ? 2 : 0;
}
/* book 2391: AGILITY roll (no action): every 6 removes 1 point; with something to grab on the way down one success negates the fall;
   some powers negate falling altogether (pass immune). input: { dice: [d6...], agilitySixes, canGrab, immune }.
   The book does not say whether Armor reduces falling damage: the number returned is before any Armor. Returns { rolled, damage }. */
export function fallOutcome({ dice, agilitySixes = 0, canGrab = false, immune = false }) {
  const rolled = dice.reduce((s, d) => s + d, 0);
  if (immune || (canGrab && agilitySixes > 0)) return { rolled, damage: 0 };
  return { rolled, damage: Math.max(0, rolled - Math.max(0, agilitySixes)) };
}

/* ------------------------------------------------------------------ placed explosives ------------------------------------------------------------------ */

/* book 2905-2921: a detonation that is not a shooting attack has a Blast rating; base Damage = half the rating rounded up
   (4:2, 6:3, 8:4, 10:5); the blast rolls as many dice as its rating. */
export const blastDamage = (rating) => Math.ceil(rating / 2);
export const blastPool = (rating) => Math.max(1, Math.floor(rating));

/* Outcome of a blast. input: { rating, sixes, targets: [{ id, dodgeSixes?, armor?, vulnerable?, immune? }] }, rng.
   book 2193: a target vulnerable to the source of the blast suffers double damage and its Armor does not count; book 1877: a target
   immune to it suffers none (a vulnerability goes first, as in damage.hitDamage).
   book 2921 one 6 or more: everybody in the zone suffers the base Damage; 2922 never pushed, can be dodged normally, Armor applies;
   2923 6s beyond the first go to random potential targets, never more than one each, and double that target's damage before Armor.
   Reading: a dodge is the usual opposed roll against the blast's 6s; the extra 6s are dealt among ALL potential targets, so one may
   land on a target that dodged and is then lost.
   Returns { exploded, base, targets: [{ id, hit, doubled, raw, taken }] }. */
export function blastOutcome({ rating, sixes, targets }, rng) {
  const base = blastDamage(rating);
  if (!(sixes > 0)) return { exploded: false, base, targets: targets.map((t) => ({ id: t.id, hit: false, doubled: false, raw: 0, taken: 0 })) };
  const order = targets.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
  const lucky = new Set(order.slice(0, Math.min(sixes - 1, targets.length)));
  return {
    exploded: true, base,
    targets: targets.map((t, i) => {
      const hit = opposed(sixes, t.dodgeSixes ?? 0).win;
      const doubled = hit && lucky.has(i);
      const raw = hit ? base * (doubled ? 2 : 1) * (t.vulnerable ? 2 : 1) : 0;
      return { id: t.id, hit, doubled, raw, taken: t.immune && !t.vulnerable ? 0 : Math.max(0, raw - (t.vulnerable ? 0 : Math.max(0, t.armor ?? 0))) };
    }),
  };
}

/* ------------------------------------------------------------------ vacuum ------------------------------------------------------------------ */

/* book 2929, 2260: without a space suit, a ship's hull or a protective power (Adaptation, Life Support) a character in a vacuum makes a
   STRENGTH roll (no action) on each of their turns: unmodified in the first round, -1 die in the second, -2 in the third and so on. */
export const VACUUM_PROTECTION = ["spaceSuit", "hull", "adaptation", "lifeSupport"];
export const vacuumDice = (roundOfExposure) => -Math.max(0, Math.floor(roundOfExposure) - 1);
/* book 2929: a failed roll drops the character straight to 0 Health: broken, WITHOUT a critical injury, and dead on their next turn
   unless brought into a pressurised area before then. Returns { ok } or { ok: false, health: 0, broken, crit: false, diesNextTurn }. */
export function vacuumOutcome(sixes) {
  return sixes > 0 ? { ok: true } : { ok: false, health: 0, broken: true, crit: false, diesNextTurn: true };
}

/* ------------------------------------------------------------------ disease and poison ------------------------------------------------------------------ */

/* book 2899-2902: exposure calls for a STRENGTH roll: passive, never pushed, the GM may roll it in secret; the virulence rating is a
   negative modifier (0 when not listed). A carer may roll REASON instead of the patient's STRENGTH (medical gear may add dice). */
export const DISEASE = { attr: "strength", carerAttr: "reason", passive: true };
export const diseaseDice = (virulence = 0) => -Math.max(0, virulence);

/* One step of the common disease effect (book 2901; other effects are in each disease's own description).
   input: { state: "exposed" | "sick", sixes, broken }.
     exposed + failure -> sick, 1 point of damage, further rolls at intervals (typically every few hours)
     sick + failure    -> 1 more point of damage; if already broken by the disease: death
     sick + success    -> cured (recovery may start)
   While sick, damage is not recovered normally; being broken by this damage gives no critical injury.
   Reading: Armor does not reduce it (book 2682 speaks of external attacks).
   Returns { state: "healthy" | "sick" | "cured" | "dead", damage, crit: false }. */
export function diseaseStep({ state, sixes, broken = false }) {
  const success = sixes > 0;
  if (state === "exposed") return success ? { state: "healthy", damage: 0, crit: false } : { state: "sick", damage: 1, crit: false };
  if (state !== "sick") throw new Error(`diseaseStep: unknown state "${state}"`);
  if (success) return { state: "cured", damage: 0, crit: false };
  return broken ? { state: "dead", damage: 0, crit: false } : { state: "sick", damage: 1, crit: false };
}
