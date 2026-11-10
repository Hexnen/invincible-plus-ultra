/* Rules library: weapon tables as data (numbers and feature flags only). Pure ES module, no Foundry globals.
   "book N" = line N of dev/book-dump.txt.
   range: [min, max] in zones (0 = the attacker's own zone) | null = slugfest only (book 2538). miles = ranges the book gives in miles,
   which are not zones (no conversion is stated, so such weapons carry no zone range here).
   Features (book 2541-2546): singleUse, areaEffect, fullAuto, sharp, noMovement (no moving in the round of firing), mounted.
   stunEffect: the table's "STUN effect" note (book 2576, 2583); the book does not spell out its mechanics beyond pointing at the stunts.
   only: target class restriction of some vehicle weapons (book 3137-3156). fire: Intensity of the fire a hit starts (book 3132).
   blocksVision: smoke grenade (book 2646). bonus 0 = the table's dash. */

/* book 2557-2675 */
export const WEAPONS = {
  "Blunt melee weapon": { bonus: 1, damage: 2, range: null },
  "Sharp melee weapon": { bonus: 1, damage: 2, range: null, sharp: true },
  "Pepper Spray": { bonus: 2, damage: 1, range: [0, 0], stunEffect: true },
  "Taser": { bonus: 1, damage: 2, range: [0, 0], stunEffect: true },
  "Handgun": { bonus: 1, damage: 2, range: [0, 1], sharp: true },
  "Shotgun": { bonus: 2, damage: 2, range: [0, 1] },
  "Submachine gun": { bonus: 1, damage: 2, range: [0, 2], fullAuto: true, sharp: true },
  "Hunting rifle": { bonus: 1, damage: 3, range: [1, 8], sharp: true },
  "Assault rifle": { bonus: 1, damage: 3, range: [0, 4], fullAuto: true, sharp: true },
  "Sniper rifle": { bonus: 2, damage: 3, range: [1, 10], sharp: true, noMovement: true },
  "Plasma rifle": { bonus: 2, damage: 3, range: [0, 3], fullAuto: true },
  "Hand grenade": { bonus: 0, damage: 3, range: [0, 1], singleUse: true, areaEffect: true },
  "Smoke grenade": { bonus: 0, damage: 0, range: [0, 1], singleUse: true, blocksVision: true },
  "Machinegun": { bonus: 2, damage: 3, range: [1, 6], fullAuto: true, sharp: true, noMovement: true },
  "Rocket launcher": { bonus: 0, damage: 5, range: [1, 4], singleUse: true, areaEffect: true },
  "Cruise missile": { bonus: 0, damage: 9, range: null, miles: 600, areaEffect: true, mounted: true, singleUse: true },
  "Nuclear missile": { bonus: 0, damage: 12, range: null, miles: 6000, areaEffect: true, areaMiles: 1, mounted: true, singleUse: true },
};

/* book 3113-3156 */
export const VEHICLE_WEAPONS = {
  "Autocannon": { bonus: 2, damage: 4, range: [1, 10], fullAuto: true, sharp: true },
  "Tank cannon": { bonus: 1, damage: 6, range: [1, 20], areaEffect: true },
  "Plasma cannon": { bonus: 2, damage: 7, range: [1, 8] },
  "Flamethrower": { bonus: 1, damage: 2, range: [0, 1], areaEffect: true, fire: 9 },
  "Tactical missile launcher": { bonus: 2, damage: 7, range: [1, 30], areaEffect: true, only: "ground" },
  "Air-to-air missile launcher": { bonus: 2, damage: 6, range: [1, 100], only: "aerial" },
  "Ship laser": { bonus: 1, damage: 8, range: null, miles: 10, fullAuto: true, only: "space" },
  "Turbolaser battery": { bonus: 2, damage: 9, range: null, miles: 300, fullAuto: true, only: "space" },
  "Energy torpedo": { bonus: 1, damage: 10, range: null, miles: 100, only: "space" },
};
for (const w of Object.values(VEHICLE_WEAPONS)) w.mounted = true;      // book 2546, 3105: fitted to the vehicle

const FLAGS = ["sharp", "fullAuto", "areaEffect", "singleUse", "noMovement", "mounted", "stunEffect", "blocksVision"];

/* A weapon completed from the tables; the fields of the object given win over the table (a homebrew or adventure weapon passes through).
   Returns { name, bonus, damage, range, miles, only, fire, ...flags as booleans }. */
export function weaponProfile(weapon) {
  const w = typeof weapon === "string" ? { name: weapon } : weapon ?? {};
  const t = WEAPONS[w.name] ?? VEHICLE_WEAPONS[w.name] ?? {};
  const pick = (k, d) => (w[k] !== undefined ? w[k] : t[k] !== undefined ? t[k] : d);
  const out = { name: w.name ?? null, bonus: pick("bonus", 0), damage: pick("damage", 0), range: pick("range", null), miles: pick("miles", null), only: pick("only", null), fire: pick("fire", null) };
  for (const f of FLAGS) out[f] = !!pick(f, false);
  return out;
}

/* book 2538: a weapon without a zone range is used in slugfest; one with a range allows shooting attacks. */
export const isRanged = (profile) => Array.isArray(profile.range);

/* book 2541: single use weapons are discarded after one use; book 2547-2548: no other ammunition is tracked. */
export const usesLeft = (profile, used = 0) => (profile.singleUse ? Math.max(0, 1 - used) : Infinity);

/* book 2545: a "no movement" weapon cannot be fired in a round in which the shooter moved (and the shooter cannot move after firing). */
export function noMovementCheck(profile, { movedThisRound = false } = {}) {
  return profile.noMovement && movedThisRound ? { ok: false, reason: "moved" } : { ok: true, reason: null };
}
