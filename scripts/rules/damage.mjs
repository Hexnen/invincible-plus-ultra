/* Rules library: armor selection, damage, damage sources, Health and Resolve bookkeeping, recovery. Pure ES module, no Foundry globals.
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md. */

/* book 2689-2702: body armor as data. dice = penalties to attribute rolls while worn. */
export const BODY_ARMOR = {
  "Kevlar vest": { armor: 1, dice: {} },
  "Riot gear": { armor: 2, dice: { intuition: -2 } },
  "Archaic armor": { armor: 2, dice: { agility: -2, intuition: -2 } },
};

/* Choose the armor that counts against one hit.
   sources: [{ id, armor, barrier?: boolean, only?: [source...], stress?: boolean }]
     barrier  the Barrier power's shield (book 1859)
     only     armor limited to some damage sources (book 1920, Plasticity: Armor 3 against kinetic attacks only)
     stress   armor that works only against attacks that inflict stress (book 1865, Defiance)
   opts: { source = "kinetic" (the nature of the damage, as in hitDamage), toStress = false (the attack turns its damage into stress) }.
   Without opts every source counts except the stress-only ones, as before.
   book 2682: only one armor at a time. ruling 13 (book 2682, 1859): Barrier and own Armor do not add up, the higher one counts.
   On a tie the source that is not a Barrier is used, so the shield is not spent for nothing (implementation choice inside ruling 13).
   Against an attack that inflicts stress both ordinary armor (book 1591: the attack has to pierce any armor) and stress armor are
   candidates, and still only one counts (book 2682).
   Returns { armor, source } (source null when unarmored). */
export function selectArmor(sources = [], opts = {}) {
  const kind = opts.source ?? "kinetic";
  let best = null;
  for (const s of sources) {
    if (!s || !(s.armor > 0)) continue;
    if (s.stress && !opts.toStress) continue;
    if (Array.isArray(s.only) && !s.only.includes(kind)) continue;
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

/* book 2113 (Find Weakness, a slugfest stunt), book 1680 (Electricity Control attacks): the Armor rating is halved, rounding up. */
export const halvedArmor = (armor) => Math.ceil(Math.max(0, armor) / 2);

/* book 1907-1910 (Duplication): damage is applied to the copy bonus first; at zero all copies are gone; the character's armor is
   applied once per attack (so `taken` here is the damage after Armor). Reading: "first" means that damage beyond the copy bonus
   goes on to Health. Returns { copies, absorbed, taken (what is left for Health), gone }. */
export function absorbByCopies({ taken, copies = 0 }) {
  const before = Math.max(0, copies), absorbed = Math.min(before, Math.max(0, taken));
  return { copies: before - absorbed, absorbed, taken: Math.max(0, taken) - absorbed, gone: before > 0 && before - absorbed === 0 };
}

/* book 2160 (Resilience): whenever damage would go to Health the character may turn it into stress, one point of stress removing
   one point of damage; not usable at Resolve 0. `convert` = how many points the player wants to turn (a choice, default none).
   Reading: at most as many points as the character has Resolve left (stress beyond 0 has no effect, book 2816, so it is not "taken");
   opts.uncapped lifts that limit. Returns { taken, stress, converted }. */
export function resilienceConvert({ taken, resolve, convert = 0 }, opts = {}) {
  if (!(resolve > 0)) return { taken: Math.max(0, taken), stress: 0, converted: 0 };
  const converted = Math.max(0, Math.min(Math.floor(convert) || 0, Math.max(0, taken), opts.uncapped ? Infinity : resolve));
  return { taken: Math.max(0, taken) - converted, stress: converted, converted };
}

/* The whole damage of one hit against one target, steps 1-6 of the damage order (hitDamage covers the plain case and stays as it is).
   input (everything of hitDamage, plus):
     addAfterDouble   damage added after the Double Damage stunt (book 1685, Discharge: +1 per point of stress taken, up to 10)
     armorSources     the target's armors for selectArmor (instead of a single `armor` number); type-limited and stress armor are
                      sorted out here (book 1920, 1865)
     halveArmor       book 2113, 1680: the Armor that counts is halved, rounding up
     ignoreArmor      true: no armor at all (book 1575, 1596, 1618, 1626); "exceptStress": ordinary armor is ignored but stress armor
                      still counts. The mental boosts say "armor has no effect" and the book does not say whether that covers
                      Defiance, which "acts as Armor" against stress attacks (book 1865): the caller chooses, `true` is the literal reading.
     toStress         book 1591 (Distress): what gets through the armor becomes stress instead of damage; Double Damage becomes extra stress
     copies           current copy bonus of a Duplication user (book 1910): absorbs damage after Armor, before Health
     resilience       points the target chooses to turn into stress (book 2160), with `resolve` = its current Resolve
   Order (spec 9.5): pulled -> Double Damage -> add-ons after doubling -> vulnerability doubling (Armor ignored) / immunity -> the one
   Armor that counts, halved or ignored -> Barrier breached? -> conversion to stress, or the buffers: copies first, then Resilience.
   Damage turned into stress by the attack itself never reaches the copies or Health (nothing is left as damage).
   Returns { raw, armor, armorSource, through (after Armor), barrierBreached, immune, vulnerable, copies: { before, absorbed, left, gone },
             converted (Resilience), taken (to Health), stress (to Resolve: the attack's own or Resilience's) }. */
export function resolveHit({ base, pulled = null, doubled = false, addAfterDouble = 0, source = "kinetic", immunities = [], vulnerabilities = [],
  armor = 0, armorSources = null, ignoreArmor = false, halveArmor = false, toStress = false, copies = 0, resilience = 0, resolve = 0 }) {
  let raw = Math.max(0, pulled == null ? base : Math.min(base, pulled));
  if (doubled) raw *= 2;
  raw += Math.max(0, addAfterDouble);
  const vulnerable = vulnerabilities.includes(source);
  if (vulnerable) raw *= 2;
  const immune = !vulnerable && (immunities.includes(source) || (source !== "kinetic" && immunities.includes("nonKinetic")));
  const noCopies = { before: Math.max(0, copies), absorbed: 0, left: Math.max(0, copies), gone: false };
  if (immune) return { raw, armor: 0, armorSource: null, through: 0, barrierBreached: false, immune: true, vulnerable: false, copies: noCopies, converted: 0, taken: 0, stress: 0 };
  let pick = { armor: Math.max(0, armor), source: null };
  if (armorSources) pick = selectArmor(ignoreArmor === "exceptStress" ? armorSources.filter((s) => s?.stress) : armorSources, { source, toStress });
  else if (ignoreArmor === "exceptStress") pick = { armor: 0, source: null };
  let used = vulnerable || ignoreArmor === true ? 0 : pick.armor;
  if (halveArmor) used = halvedArmor(used);
  const counted = used > 0 ? pick.source : null;
  const through = Math.max(0, raw - used);
  const out = { raw, armor: used, armorSource: counted, through, barrierBreached: barrierBreached(counted, through), immune: false, vulnerable, copies: noCopies, converted: 0, taken: 0, stress: 0 };
  if (toStress) { out.stress = through; return out; }
  const c = absorbByCopies({ taken: through, copies });
  out.copies = { before: noCopies.before, absorbed: c.absorbed, left: c.copies, gone: c.gone };
  const r = resilienceConvert({ taken: c.taken, resolve, convert: resilience });
  out.converted = r.converted; out.stress = r.stress; out.taken = r.taken;
  return out;
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
   A few hours of rest: all Health.
   book 2802-2808, 2819: Resolve comes back after the scene only through a social scene: a short one +PRESENCE, one with a break of a
   few hours all. So `socialScene` defaults to FALSE (it was true until 2026-11-10): the end of an action scene alone leaves Resolve
   as it is. book 2148 (Loner): that talent recovers the same amounts without a social scene (`loner: true`).
   book 1893 (Regeneration): all remaining damage heals in a few minutes (`regeneration: true`).
   book 1686 (Body Battery): Resolve above the maximum is gone after a few minutes, so Resolve is cut to the maximum in any case.
   span: "minutes" | "hours". Returns the new { health, resolve }. */
export function recoverAfterScene({ health, maxHealth, resolve, maxResolve, strength, presence, span = "minutes", socialScene = false, loner = false, regeneration = false }) {
  const social = socialScene || loner;
  const out = { health, resolve: Math.min(maxResolve, resolve) };
  if (span === "hours") { out.health = maxHealth; if (social) out.resolve = maxResolve; return out; }
  out.health = regeneration ? maxHealth : Math.min(maxHealth, health + strength);
  if (social) out.resolve = Math.min(maxResolve, resolve + presence);
  return out;
}
