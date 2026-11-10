/* Rules library: vehicles: table, movement, ramming, damage, component damage, crashes, repairs. Pure ES module, no Foundry globals.
   "book N" = line N of dev/book-dump.txt. Dice are inputs. */

import { fallDice } from "./hazards.mjs";

/* book 2945-3143 (the table; rows 2955-3142). passengers excludes the driver or pilot (book 2939); passengersMin marks the table's "+" entries; maneuver 0 = the
   table's dash; armor 0 = dash; cost null = dash; restricted = the table's R. A mount (book 3144) uses the creature's AGILITY instead
   of the rider's (a typical horse has AGILITY 4). */
const V = (type, passengers, maneuver, speed, durability, armor, cost, extra = {}) => ({ type, passengers, maneuver, speed, durability, armor, cost, ...extra });
export const VEHICLES = {
  "Horse": V("ground", 1, 0, 2, 4, 0, 3, { mount: true, mountAgility: 4 }),
  "Car": V("ground", 4, 1, 2, 8, 1, 4),
  "Truck": V("ground", 3, 0, 2, 14, 1, 5),
  "Van": V("ground", 7, 0, 2, 10, 1, 5),
  "Sport Utility Vehicle": V("ground", 5, 0, 2, 12, 1, 5),
  "Military Utility Vehicle": V("ground", 6, 0, 2, 16, 2, 5, { restricted: true }),
  "Motorcycle": V("ground", 1, 2, 3, 5, 0, 3),
  "Armored carrier": V("ground", 8, 0, 2, 16, 4, 6, { restricted: true }),
  "Battle tank": V("ground", 0, 0, 2, 20, 5, 7, { restricted: true }),
  "Rowboat": V("water", 4, 1, 1, 5, 0, null),
  "Motorboat, small": V("water", 7, 2, 2, 6, 1, 4),
  "Helicopter": V("aerial", 5, 3, 3, 10, 1, 6),
  "Light airplane": V("aerial", 3, 1, 3, 8, 1, 6),
  "Jetliner": V("aerial", 160, 0, 4, 16, 1, 7, { passengersMin: true }),
  "Fighter jet": V("aerial", 1, 2, 6, 14, 2, 7, { restricted: true }),
  "Hoverjet, small": V("aerial", 5, 4, 4, 12, 1, 6),
  "Hoverjet, large": V("aerial", 12, 3, 3, 20, 2, 7),
  "Space shuttle": V("space", 16, 2, 6, 16, 1, 8),
  "Starfighter": V("space", 1, 4, 8, 14, 1, 8),
  "Space transport": V("space", 24, 2, 7, 20, 2, 8),
  "Capital starship": V("space", 1000, 0, 6, 30, 4, 9, { passengersMin: true }),
};

/* book 2325-2332, 2936: starting, entering or leaving a vehicle is a quick action; handling it is a quick action with AGILITY when a
   roll is needed (normal driving needs none); Maneuverability modifies those AGILITY rolls (book 2940). */
export const VEHICLE_ACTIONS = { start: "quick", enter: "quick", exit: "quick", handle: "quick" };
export const HANDLE_ATTR = "agility";

/* book 2941, 3146: handling a vehicle moves it up to its Speed in zones per quick action; like walking, it can be done twice a round. */
export const vehicleMoveZones = (vehicle) => vehicle.speed;

/* book 3148: ramming is a slugfest attack rolled with AGILITY plus the vehicle's Maneuverability (book 3144: a rider uses the mount's
   AGILITY). Damage = the vehicle's Durability rating divided by two, rounded up. Returns { attr, agility, dice, damage }. */
export function ramProfile({ agility, vehicle }) {
  return { attr: "agility", agility: vehicle.mount && vehicle.mountAgility != null ? vehicle.mountAgility : agility, dice: vehicle.maneuver ?? 0, damage: Math.ceil(vehicle.durability / 2) };
}
/* book 3223: a vehicle may ram another only when its maximum Durability is at least the target's. */
export const canRamVehicle = (ownMaxDurability, targetMaxDurability) => ownMaxDurability >= targetMaxDurability;

/* Damage to a vehicle. input: { durability (points left), max, armor, amount, componentHits (component damage suffered before) }.
   book 3221: vehicles take damage like people, Armor included; wrecked when the damage reaches the Durability.
   book 3222: no critical injuries; a single hit of at least half the Durability (rounded up, after Armor) causes component damage;
   a second component damage always wrecks the vehicle.
   Returns { taken, durability, component, wrecked }. */
export function vehicleHit({ durability, max, armor = 0, amount, componentHits = 0 }) {
  const taken = Math.max(0, amount - Math.max(0, armor));
  const left = Math.max(0, durability - taken);
  const component = taken > 0 && taken >= Math.ceil(max / 2);
  return { taken, durability: left, component, wrecked: left === 0 || (component && componentHits >= 1) };
}

/* book 3224-3244: the component damage table. `damage` in the effects = the damage inflicted on the vehicle by that hit, after its Armor. */
export const COMPONENT_DAMAGE = {
  1: { id: "pilotHit", occupants: "pilot" },
  2: { id: "passengerHit", occupants: "randomPassenger", rerollWithout: "passengers" },
  3: { id: "severeSpin", roll: { who: "operator", attr: "agility", action: "none", onFail: "wrecked" } },
  4: { id: "weaponDisabled", rerollWithout: "weapons" },
  5: { id: "engineDisabled", cannotContinue: true, aerialControlledLanding: true },
  6: { id: "fuelExplosion", occupants: "all", fireIntensity: 9, destroyed: true },
};
/* Read a D6 on the table. ctx: { passengers, weapons } (counts aboard). Returns { ...entry, reroll } (reroll true = roll again, book 3232, 3238). */
export function componentDamage(d6, ctx = {}) {
  const e = COMPONENT_DAMAGE[d6];
  if (!e) throw new Error(`componentDamage: not a D6 result: ${d6}`);
  const reroll = !!e.rerollWithout && !(ctx[e.rerollWithout] > 0);
  return { ...e, reroll };
}

/* book 3223: the people in a rammed vehicle are hurt only when it is wrecked: each then takes the damage the vehicle took (after its Armor). */
export const ramOccupantDamage = ({ wrecked, taken }) => (wrecked ? taken : 0);

/* book 3248: a wrecked aircraft, or a spacecraft inside the atmosphere, crashes: the vehicle and everyone inside suffer falling
   damage (hazards.mjs fallDice / fallOutcome). Returns the number of falling dice (0 = no crash). */
export function crashFallDice({ type, alt, wrecked }) {
  if (!wrecked) return 0;
  if (type === "aerial" || (type === "space" && alt !== "orbit")) return fallDice(alt);
  return 0;
}

/* Repairs. book 2790, 3250-3251: a REASON roll and at least a few hours; every 6 restores 1 Durability up to the starting value; a
   wrecked vehicle that regains at least 1 point is no longer wrecked; a failed roll fixes the current Durability as the new maximum, and
   a machine at 0 is then destroyed. A disabled engine or weapon needs its own REASON roll and a few hours.
   Returns { durability, max, wrecked, destroyed }. */
export function repairOutcome({ durability, max, sixes }) {
  if (sixes > 0) {
    const d = Math.min(max, durability + sixes);
    return { durability: d, max, wrecked: d === 0, destroyed: false };
  }
  return { durability, max: durability, wrecked: durability === 0, destroyed: durability === 0 };
}

/* book 3190-3218 (the notes column of the table 3149-3219): some vehicle weapons hit only ground, aerial or space targets. The caller says which class the target is in. */
export const weaponMayTarget = (profile, targetClass) => !profile.only || profile.only === targetClass;
