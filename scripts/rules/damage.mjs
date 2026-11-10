/* Rules library: armor selection, damage, damage sources, Health and Resolve bookkeeping, recovery. Pure ES module, no Foundry globals.
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

/* book 2689-2702: body armor as data. dice = penalties to attribute rolls while worn. */
export const BODY_ARMOR = {
  "Kevlar vest": { armor: 1, dice: {} },
  "Riot gear": { armor: 2, dice: { intuition: -2 } },
  "Archaic armor": { armor: 2, dice: { agility: -2, intuition: -2 } },
};

/* Choose the armor that counts against one hit.
   sources: [{ id, armor, barrier?: boolean }]  (barrier = the Barrier power's shield, book 1859)
   book 2682: only one armor at a time. ruling 13 (book 2682, 1859): Barrier and own Armor do not add up, the higher one counts.
   On a tie the source that is not a Barrier is used, so the shield is not spent for nothing (implementation choice inside ruling 13).
   Returns { armor, source } (source null when unarmored). */
export function selectArmor(sources = []) {
  let best = null;
  for (const s of sources) {
    if (!s || !(s.armor > 0)) continue;
    if (!best || s.armor > best.armor || (s.armor === best.armor && best.barrier && !s.barrier)) best = s;
  }
  return { armor: best ? best.armor : 0, source: best };
}

/* ruling 13 (book 1859): a Barrier lasts until it is breached once. It is breached when it was the armor that counted and damage got
   through it. */
export const barrierBreached = (source, taken) => !!source?.barrier && taken > 0;

/* Damage of one hit against one target.
   input: { base, pulled?, doubled?, armor?, ignoreArmor?, source?, immunities?, vulnerabilities? }
     base         Slugfest Damage, weapon or power Damage (book 2426, 2428, 2512)
     pulled       book 2427: the attacker may choose to inflict less than the full damage (a number not above base)
     doubled      book 2434, 2516: Double Damage doubles before Armor
     armor        the single Armor that counts (selectArmor)
     ignoreArmor  effects that state "armor has no effect" (e.g. book 1575, 1596, 1618, 1626)
     source       the nature of the damage, e.g. "kinetic", "fire", "electricity", "toxin" (book 1877-1880)
     immunities   sources the target is immune to (book 1877: one non-kinetic source; Full Immunity: "nonKinetic" = every source but "kinetic")
     vulnerabilities  book 2193: damage from that source is doubled and Armor has no effect
   Order: pulled -> doubled -> vulnerability doubling -> immunity -> Armor (book 2682: reduced by the Armor rating, never below 0).
   Returns { raw, armor, taken, immune, vulnerable }. */
export function hitDamage({ base, pulled = null, doubled = false, armor = 0, ignoreArmor = false, source = "kinetic", immunities = [], vulnerabilities = [] }) {
  let raw = Math.max(0, pulled == null ? base : Math.min(base, pulled));
  if (doubled) raw *= 2;
  const vulnerable = vulnerabilities.includes(source);
  if (vulnerable) raw *= 2;
  const immune = !vulnerable && (immunities.includes(source) || (source !== "kinetic" && immunities.includes("nonKinetic")));
  if (immune) return { raw, armor: 0, taken: 0, immune: true, vulnerable: false };
  const used = ignoreArmor || vulnerable ? 0 : Math.max(0, armor);
  return { raw, armor: used, taken: Math.max(0, raw - used), immune: false, vulnerable };
}

/* book 2680: starting maximum Health = (FIGHTING + AGILITY + STRENGTH) / 2 rounded up; book 2814: Resolve the same from REASON,
   INTUITION and PRESENCE. Talents, drawbacks and powers modify them afterwards. */
export const baseHealth = (a) => Math.ceil((a.fighting + a.agility + a.strength) / 2);
export const baseResolve = (a) => Math.ceil((a.reason + a.intuition + a.presence) / 2);

/* book 2707-2708: Health never goes below 0; at 0 the character is broken. Returns { health, broken, newlyBroken, excess }
   (excess = damage beyond what was needed to break, the crit bonus of book 2707). */
export function applyDamage({ health, taken }) {
  const wasBroken = health <= 0;
  const left = Math.max(0, health - Math.max(0, taken));
  const newlyBroken = !wasBroken && left === 0 && taken > 0;
  return { health: left, broken: left === 0, newlyBroken, excess: newlyBroken ? taken - health : 0 };
}

/* book 2816: Resolve never goes below 0; at 0 the character is stressed out (acts normally, cannot push, cannot take stress
   voluntarily for powers); more stress then has no further effect. Returns { resolve, lost, stressedOut }. */
export function applyStress({ resolve, stress }) {
  const lost = Math.min(Math.max(0, resolve), Math.max(0, stress));
  const left = Math.max(0, resolve) - lost;
  return { resolve: left, lost, stressedOut: left === 0 };
}
/* book 2816, 2228: voluntary stress (power exploits, pushing) needs Resolve above 0. */
export const canTakeVoluntaryStress = (resolve) => resolve > 0;

/* book 2818: recovering Resolve in an action scene: PRESENCE roll, full action, by the character or by someone who can communicate
   with them; 1 Resolve per 6, not above the maximum. */
export function recoverResolve({ resolve, max, sixes }) {
  const gain = Math.min(Math.max(0, max - resolve), Math.max(0, sixes));
  return { resolve: resolve + gain, gain };
}

/* book 2779, 2793-2808: no Health comes back during an action scene except through powers. A few minutes after the scene: Health +STRENGTH.
   A few hours of rest: all Health. Resolve: a short social scene +PRESENCE, a social scene with a break of a few hours: all.
   span: "minutes" | "hours". Returns the new { health, resolve }; pass socialScene: false to leave Resolve alone. */
export function recoverAfterScene({ health, maxHealth, resolve, maxResolve, strength, presence, span = "minutes", socialScene = true }) {
  const out = { health, resolve };
  if (span === "hours") { out.health = maxHealth; if (socialScene) out.resolve = maxResolve; return out; }
  out.health = Math.min(maxHealth, health + strength);
  if (socialScene) out.resolve = Math.min(maxResolve, resolve + presence);
  return out;
}
