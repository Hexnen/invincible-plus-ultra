// node scripts/rules/check-hazards.mjs -- fire, falling, explosives, vacuum, disease; weapons; vehicles; chases; challenges.
import * as H from "./hazards.mjs";
import * as W from "./weapons.mjs";
import * as V from "./vehicles.mjs";
import * as CH from "./chase.mjs";
import * as C from "./challenge.mjs";
import { makeGraph } from "./zones.mjs";
import { seededRng } from "./dice.mjs";
import { ok, eq, throws, done } from "./testkit.mjs";

/* ---------------- fire (book 2925-2927) ---------------- */
eq([H.firePool(8), H.fireDamage(2), H.fireDamage(0)], [8, 4, 0], "Intensity dice, 2 damage per six");
eq([H.fireAttackDue({ when: "enter", inBurningZone: true }), H.fireAttackDue({ when: "enter", inBurningZone: false, burning: true })], [true, false], "attack on entering a burning zone");
eq([H.fireAttackDue({ when: "roundStart", inBurningZone: true }), H.fireAttackDue({ when: "roundStart", inBurningZone: false, burning: true }), H.fireAttackDue({ when: "roundStart", inBurningZone: false })], [true, true, false], "round start: in the zone or on fire");
eq(H.fireOutcome({ sixes: 2, armor: 3, inBurningZone: true }), { raw: 4, taken: 1, burning: true }, "damage sets you on fire, Armor works");
eq(H.fireOutcome({ sixes: 1, armor: 3, inBurningZone: false, wasBurning: true }), { raw: 2, taken: 0, burning: false }, "no damage outside the zone: no longer on fire");
eq(H.fireOutcome({ sixes: 0, inBurningZone: true, wasBurning: true }).burning, true, "no damage inside the zone changes nothing");
eq(H.fireOutcome({ sixes: 3, inBurningZone: true, immune: true }), { raw: 6, taken: 0, burning: false }, "immune to fire");
eq([H.extinguishOutcome(1).burning, H.extinguishOutcome(0).burning], [false, true], "AGILITY roll puts the flames out");
eq([1, 2, 3, 4, 5, 6].map(H.fireSpreadRoll), ["out", "out", "stays", "stays", "spreads", "spreads"], "fire D6");
{
  const g = makeGraph({
    zones: [{ id: "a", flammable: true }, { id: "b", flammable: true }, { id: "c" }, { id: "d", flammable: true }, { id: "e", flammable: true }],
    borders: [{ a: "a", b: "b" }, { a: "a", b: "c" }, { a: "a", b: "d", wall: { armor: 3, state: "intact" } }, { a: "a", b: "e" }],
  });
  eq(H.fireSpreadTargets(g, "a"), ["b", "e"], "spreads only over open borders into flammable zones");
  eq(H.fireSpreadTargets(g, "a", ["b"]), ["e"], "not into a zone already burning");
  eq(H.pickFireSpread(seededRng(1), g, "a", ["b"]), "e", "random pick among candidates");
  eq(H.pickFireSpread(seededRng(1), g, "c"), "a", "the only neighbour");
  eq(H.pickFireSpread(seededRng(1), g, "a", ["b", "e"]), null, "nowhere to spread");
}

/* ---------------- falling (book 2391) ---------------- */
eq(["ground", "elevated", "sky", "orbit"].map(H.fallDice), [0, 1, 2, 0], "D6 from elevated, 2D6 from sky high, none in orbit");
eq(H.fallOutcome({ dice: [5], agilitySixes: 2 }), { rolled: 5, damage: 3 }, "each six removes a point");
eq(H.fallOutcome({ dice: [2], agilitySixes: 4 }).damage, 0, "never below zero");
eq(H.fallOutcome({ dice: [6, 6], agilitySixes: 1, canGrab: true }).damage, 0, "something to grab + a success");
eq(H.fallOutcome({ dice: [6, 6], agilitySixes: 0, canGrab: true }).damage, 12, "nothing grabbed without a success");
eq(H.fallOutcome({ dice: [6], immune: true }).damage, 0, "powers that negate falling");

/* ---------------- placed explosives (book 2905-2923) ---------------- */
eq([4, 6, 8, 10].map(H.blastDamage), [2, 3, 4, 5], "Blast table");
eq(H.blastDamage(5), 3, "half rounded up");
{
  const t = [{ id: "a", armor: 2 }, { id: "b" }, { id: "c", dodgeSixes: 3 }];
  eq(H.blastOutcome({ rating: 10, sixes: 0, targets: t }, seededRng(1)).exploded, false, "no six: nobody is hurt");
  const one = H.blastOutcome({ rating: 10, sixes: 1, targets: t }, seededRng(1));
  eq(one.targets.map((x) => [x.hit, x.doubled, x.taken]), [[true, false, 3], [true, false, 5], [false, false, 0]], "base damage, Armor, dodge");
  for (let s = 1; s <= 50; s++) {
    const r = H.blastOutcome({ rating: 10, sixes: 3, targets: [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }] }, seededRng(s));
    ok(r.targets.filter((x) => x.doubled).length === 2 && r.targets.every((x) => x.taken === (x.doubled ? 10 : 5)), `two extra sixes double two different targets (seed ${s})`);
  }
  const many = H.blastOutcome({ rating: 10, sixes: 6, targets: [{ id: "a" }, { id: "b" }] }, seededRng(3));
  eq(many.targets.map((x) => x.raw), [10, 10], "never more than one extra six per target");
  const dodged = H.blastOutcome({ rating: 10, sixes: 2, targets: [{ id: "a", dodgeSixes: 2 }] }, seededRng(3));
  eq(dodged.targets[0], { id: "a", hit: false, doubled: false, raw: 0, taken: 0 }, "a full dodge wastes the extra six");
}

/* ---------------- vacuum (book 2929) ---------------- */
eq([1, 2, 3, 5].map(H.vacuumDice), [0, -1, -2, -4], "vacuum penalty by round");
eq(H.vacuumOutcome(1), { ok: true }, "held out");
eq(H.vacuumOutcome(0), { ok: false, health: 0, broken: true, crit: false, diesNextTurn: true }, "failed: broken without a crit, dies next turn");

/* ---------------- disease (book 2899-2902) ---------------- */
eq([H.diseaseDice(), H.diseaseDice(3)], [0, -3], "virulence is a negative modifier");
eq(H.diseaseStep({ state: "exposed", sixes: 1 }).state, "healthy", "resisted");
eq(H.diseaseStep({ state: "exposed", sixes: 0 }), { state: "sick", damage: 1, crit: false }, "falls sick: 1 damage");
eq(H.diseaseStep({ state: "sick", sixes: 0 }), { state: "sick", damage: 1, crit: false }, "each failed roll: 1 damage");
eq(H.diseaseStep({ state: "sick", sixes: 2 }).state, "cured", "a success beats the disease");
eq(H.diseaseStep({ state: "sick", sixes: 0, broken: true }).state, "dead", "broken by the disease and failing again");
eq(H.diseaseStep({ state: "sick", sixes: 1, broken: true }).state, "cured", "broken but resisting");
throws(() => H.diseaseStep({ state: "x", sixes: 0 }), "unknown disease state");

/* ---------------- weapons (book 2557-2675, 3113-3156) ---------------- */
eq(Object.keys(W.WEAPONS).length, 17, "17 weapons");
eq(Object.keys(W.VEHICLE_WEAPONS).length, 9, "9 vehicle weapons");
eq(W.weaponProfile("Sniper rifle"), { name: "Sniper rifle", bonus: 2, damage: 3, range: [1, 10], miles: null, only: null, fire: null, sharp: true, fullAuto: false, areaEffect: false, singleUse: false, noMovement: true, mounted: false, stunEffect: false, blocksVision: false }, "sniper rifle row");
eq([W.weaponProfile("Hand grenade").areaEffect, W.weaponProfile("Hand grenade").singleUse, W.weaponProfile("Hand grenade").range], [true, true, [0, 1]], "hand grenade");
eq([W.weaponProfile("Shotgun").sharp, W.weaponProfile("Handgun").sharp, W.weaponProfile("Plasma rifle").sharp], [false, true, false], "sharp flags");
eq(["Submachine gun", "Assault rifle", "Plasma rifle", "Machinegun", "Autocannon", "Ship laser", "Turbolaser battery"].every((n) => W.weaponProfile(n).fullAuto), true, "full auto weapons");
eq([W.weaponProfile("Flamethrower").fire, W.weaponProfile("Flamethrower").mounted, W.weaponProfile("Tactical missile launcher").only], [9, true, "ground"], "vehicle weapon features");
eq([W.isRanged(W.weaponProfile("Blunt melee weapon")), W.isRanged(W.weaponProfile("Taser")), W.isRanged(W.weaponProfile("Ship laser"))], [false, true, false], "slugfest only / zone range / miles");
eq(W.weaponProfile({ name: "Handgun", damage: 4 }).damage, 4, "object fields win over the table");
eq(W.weaponProfile({ name: "Homebrew", damage: 1, range: [0, 2] }).range, [0, 2], "unknown weapons pass through");
eq([W.usesLeft(W.weaponProfile("Rocket launcher")), W.usesLeft(W.weaponProfile("Rocket launcher"), 1), W.usesLeft(W.weaponProfile("Handgun"), 50)], [1, 0, Infinity], "single use");
eq(W.noMovementCheck(W.weaponProfile("Machinegun"), { movedThisRound: true }).reason, "moved", "no movement weapons");
eq(W.noMovementCheck(W.weaponProfile("Handgun"), { movedThisRound: true }).ok, true, "others do not care");

/* ---------------- vehicles (book 2955-3174) ---------------- */
eq(Object.keys(V.VEHICLES).length, 21, "21 vehicles");
eq(V.VEHICLES["Battle tank"], { type: "ground", passengers: 0, maneuver: 0, speed: 2, durability: 20, armor: 5, cost: 7, restricted: true }, "battle tank row");
eq([V.VEHICLES.Helicopter.maneuver, V.VEHICLES.Starfighter.speed, V.VEHICLES.Motorcycle.armor], [3, 8, 0], "table spot checks");
eq(V.vehicleMoveZones(V.VEHICLES["Fighter jet"]), 6, "Speed = zones per quick action");
eq(V.ramProfile({ agility: 5, vehicle: V.VEHICLES.Car }), { attr: "agility", agility: 5, dice: 1, damage: 4 }, "ram: AGILITY + Maneuverability, half Durability");
eq(V.ramProfile({ agility: 5, vehicle: V.VEHICLES.Motorcycle }).damage, 3, "half rounded up");
eq(V.ramProfile({ agility: 6, vehicle: V.VEHICLES.Horse }).agility, 4, "a rider uses the mount's AGILITY");
eq([V.canRamVehicle(8, 8), V.canRamVehicle(8, 14)], [true, false], "ram only an equal or lighter vehicle");
eq(V.vehicleHit({ durability: 8, max: 8, armor: 1, amount: 3 }), { taken: 2, durability: 6, component: false, wrecked: false }, "light hit");
eq(V.vehicleHit({ durability: 8, max: 8, armor: 1, amount: 5 }), { taken: 4, durability: 4, component: true, wrecked: false }, "half the Durability in one hit: component damage");
eq(V.vehicleHit({ durability: 5, max: 9, armor: 0, amount: 4 }).component, false, "half rounds up (5 of 9)");
eq(V.vehicleHit({ durability: 4, max: 8, armor: 1, amount: 5, componentHits: 1 }).wrecked, true, "second component damage wrecks");
eq(V.vehicleHit({ durability: 2, max: 8, armor: 1, amount: 3 }), { taken: 2, durability: 0, component: false, wrecked: true }, "out of Durability");
eq(V.vehicleHit({ durability: 8, max: 8, armor: 5, amount: 3 }).taken, 0, "Armor stops it");
eq([1, 2, 3, 4, 5, 6].map((d) => V.componentDamage(d, { passengers: 2, weapons: 1 }).id), ["pilotHit", "passengerHit", "severeSpin", "weaponDisabled", "engineDisabled", "fuelExplosion"], "component table");
eq([V.componentDamage(2, { passengers: 0 }).reroll, V.componentDamage(4, { weapons: 0 }).reroll, V.componentDamage(2, { passengers: 1 }).reroll], [true, true, false], "re-roll without passengers or weapons");
eq([V.componentDamage(6).fireIntensity, V.componentDamage(6).destroyed], [9, true], "fuel explosion");
throws(() => V.componentDamage(7), "not a D6");
eq([V.ramOccupantDamage({ wrecked: true, taken: 5 }), V.ramOccupantDamage({ wrecked: false, taken: 5 })], [5, 0], "occupants are hurt only by a wreck");
eq([V.crashFallDice({ type: "aerial", alt: "elevated", wrecked: true }), V.crashFallDice({ type: "aerial", alt: "sky", wrecked: true }), V.crashFallDice({ type: "space", alt: "orbit", wrecked: true }), V.crashFallDice({ type: "ground", alt: "ground", wrecked: true }), V.crashFallDice({ type: "aerial", alt: "sky", wrecked: false })], [1, 2, 0, 0, 0], "crashes");
eq(V.repairOutcome({ durability: 0, max: 8, sixes: 2 }), { durability: 2, max: 8, wrecked: false, destroyed: false }, "repair un-wrecks");
eq(V.repairOutcome({ durability: 6, max: 8, sixes: 5 }).durability, 8, "not above the starting value");
eq(V.repairOutcome({ durability: 3, max: 8, sixes: 0 }), { durability: 3, max: 3, wrecked: false, destroyed: false }, "failed repair fixes the damage for good");
eq(V.repairOutcome({ durability: 0, max: 8, sixes: 0 }).destroyed, true, "failed repair of a wreck destroys it");
eq([V.weaponMayTarget(W.weaponProfile("Air-to-air missile launcher"), "ground"), V.weaponMayTarget(W.weaponProfile("Air-to-air missile launcher"), "aerial"), V.weaponMayTarget(W.weaponProfile("Autocannon"), "ground")], [false, true, true], "target class restrictions");

/* ---------------- chases (book 3411-3480, ruling 25) ---------------- */
eq(CH.CHASE_PUSH_ORDER, ["prey", "pursuer"], "prey pushes first (ruling 25)");
eq([CH.chaseModifier(2, 2), CH.chaseModifier(3, 2), CH.chaseModifier(4, 2), CH.chaseModifier(5, 2), CH.chaseModifier(6, 2), CH.chaseModifier(8, 2), CH.chaseModifier(2, 4)], [0, 0, 2, 2, 3, 4, 0], "speed bonus");
eq(CH.chaseModifiers({ speed: 6, otherSpeed: 2, maneuver: 2, obstacle: "cantSee" }), [{ source: "maneuverability", dice: 2 }, { source: "speed", dice: 3 }, { source: "cantSee", dice: -2 }], "chase roll modifiers");
eq(CH.chaseRoll({ distance: 3, preySixes: 3, pursuerSixes: 1 }), { distance: 5, winner: "prey", caught: false, escaped: false }, "prey widens the gap");
eq(CH.chaseRoll({ distance: 4, preySixes: 3, pursuerSixes: 1 }).escaped, true, "beyond five zones the prey is lost");
eq(CH.chaseRoll({ distance: 2, preySixes: 0, pursuerSixes: 3 }), { distance: 0, winner: "pursuer", caught: true, escaped: false }, "never below zero; caught");
eq(CH.chaseRoll({ distance: 2, preySixes: 2, pursuerSixes: 2 }).winner, null, "a tie changes nothing");
eq(CH.chaseRoll({ distance: 2, preySixes: 4, pursuerSixes: 1, preyAutoFail: true }).distance, 1, "dead end: the prey fails automatically");
eq([11, 36, 41, 42, 43, 46, 51, 54, 56, 61, 64, 66].map((n) => CH.chaseObstacle(n)), ["clear", "clear", "deadEnd", "deadEnd", "cantSee", "outOfTheWay", "unsteady", "closeCall", "blocked", "obstruction", "hiddenPath", "shortcut"], "D66 table");
eq(CH.chaseObstacle(5, 5), "blocked", "two dice form");
{
  let n = 0;
  for (let t = 1; t <= 6; t++) for (let o = 1; o <= 6; o++) { CH.chaseObstacle(t, o); n++; }
  eq(n, 36, "every D66 result has an entry");
}
throws(() => CH.chaseObstacle(37), "37 is not a D66 result");
eq(CH.applyObstacle({ obstacle: "outOfTheWay", distance: 3, results: { prey: 0 } }).distance, 2, "out of the way: pursuer closer");
eq(CH.applyObstacle({ obstacle: "outOfTheWay", distance: 3, results: { prey: 1 } }).distance, 3, "prey got through");
eq(CH.applyObstacle({ obstacle: "blocked", distance: 3, results: { pursuer: 0 } }).distance, 4, "blocked: pursuer further away");
eq(CH.applyObstacle({ obstacle: "closeCall", distance: 3, results: { prey: 0, pursuer: 1 } }).damage, [{ who: "prey", amount: 1 }], "close call: 1 damage to whoever failed");
eq(CH.applyObstacle({ obstacle: "obstruction", distance: 3, results: { prey: 0, pursuer: 0 } }).damage.map((d) => d.amount), ["d6", "d6"], "obstruction: D6 each");
eq(CH.applyObstacle({ obstacle: "hiddenPath", distance: 3, results: { prey: 1, pursuer: 0 } }).chaseOver, true, "hidden path found and missed");
eq(CH.applyObstacle({ obstacle: "hiddenPath", distance: 3, results: { prey: 0 } }).chaseOver, false, "hidden path not found");
eq(CH.applyObstacle({ obstacle: "hiddenPath", distance: 3, results: { prey: 1, pursuer: 2 } }).chaseOver, false, "the pursuer follows");
eq(CH.applyObstacle({ obstacle: "shortcut", distance: 5, results: { pursuer: 1 } }).distance, 3, "shortcut halves, rounding up");
eq(CH.applyObstacle({ obstacle: "shortcut", distance: 5, results: { pursuer: 0 } }).distance, 5, "no shortcut found");
eq(CH.chaseRoller([{ id: "a", speed: 3, agility: 5 }, { id: "b", speed: 2, agility: 6 }, { id: "c", speed: 2, agility: 4 }]).id, "c", "slowest rolls, lowest AGILITY on a tie");
eq(CH.chaseAdvance({ a: 0, b: 2 }, { a: 3, b: 1 }), { a: 3, b: 3 }, "individual positions");

/* ---------------- challenges (book 2834-2892, rulings 15, 22) ---------------- */
eq(C.OBJECTIVE_ACTION, "full", "objective roll is a full action (ruling 15)");
{
  let ch = C.makeChallenge(C.BOOK_CHALLENGES.doomsdayDevice);
  eq([ch.rating, ch.roundsLeft, ch.status], [6, 3, "active"], "doomsday device 6 / 3 rounds");
  eq(C.challengeSeverity(ch), "serious", "rating twice the limit = serious");
  ch = C.applyObjectiveRoll(ch, 2);
  ch = C.applyObjectiveRoll(ch, 1);        // each hero's sixes count on their own
  eq(ch.rating, 3, "sixes lower the rating");
  let t = C.endOfRound(ch); t = C.endOfRound(t.challenge);
  eq([t.failed, t.challenge.roundsLeft], [false, 1], "two rounds gone");
  const win = C.applyObjectiveRoll(t.challenge, 5);
  eq([win.rating, win.status], [0, "overcome"], "overcome in the third round, before its end (ruling 22)");
  eq(C.endOfRound(win).failed, false, "an overcome challenge does not fail");
  const lost = C.endOfRound(t.challenge);
  eq([lost.failed, lost.challenge.status], [true, "failed"], "time runs out at the end of the third round");
  eq(C.applyObjectiveRoll(lost.challenge, 9).status, "failed", "too late");
  eq(C.BOOK_CHALLENGES.doomsdayDevice.effects[0], { when: "onFail", kind: "blast", rating: 10 }, "Blast 10 on failure");
}
eq(C.endOfRound(C.makeChallenge(C.BOOK_CHALLENGES.burningBuilding)).failed, false, "a special time limit has no clock");
eq(Object.values(C.BOOK_CHALLENGES).map((c) => `${c.rating}/${c.timeLimit}`), ["6/null", "4/2", "6/3", "8/4", "3/3", "9/3", "4/3", "10/5"], "book ratings and limits");
eq([C.challengeSeverity({ maxRating: 3, timeLimit: 3 }), C.challengeSeverity({ maxRating: 9, timeLimit: 3 }), C.challengeSeverity({ maxRating: 6, timeLimit: null })], ["simple", "major", "special"], "severity guide");
eq(C.objectiveAvailable({ attr: "strength", minAttr: 5 }, { attrs: { strength: 4 } }).reason, "attribute", "STRENGTH 5 needed to smash");
eq(C.objectiveAvailable({ attr: "strength", minAttr: 7 }, { attrs: { strength: 7 } }).ok, true, "STRENGTH 7 breaks the seal");
eq(C.objectiveAvailable({ attr: "agility", power: "Blast" }, { attrs: {}, powers: ["Flight"] }).reason, "power", "needs the power");
eq(C.objectiveAvailable({ attr: "reason" }, { attrs: {} }).ok, true, "open option");
{
  const ward = C.makeChallenge(C.BOOK_CHALLENGES.magicalWard);
  eq([ward.ward.agility, ward.ward.damage, ward.ward.range, ward.ward.areaEffect], [8, 5, 0, true], "ward blast numbers");
  let t = ward;
  for (let i = 0; i < 3; i++) t = C.endOfRound(t).challenge;
  eq(t.status, "failed", "ward clock ran out");
  const r1 = C.wardReset(t);
  eq([r1.rating, r1.dice, r1.status, r1.roundsLeft, r1.resets], [8, -2, "active", 3, 1], "ward resets to 8 with -2 dice");
  eq(C.wardReset(r1).dice, -4, "cumulative");
  eq(C.wardRested(r1).dice, 0, "undisturbed for a few hours");
}
eq([C.toxinOutcome(0).losesFullAction, C.toxinOutcome(1).losesFullAction], [true, false], "toxin: STRENGTH roll or lose the full action");
eq(C.BOOK_CHALLENGES.burningBuilding.effects[0].intensity, 8, "burning building: Intensity 8");
eq(C.BOOK_CHALLENGES.toxicAccident.zones, 5, "toxic accident covers 5 zones");
ok(Object.values(C.BOOK_CHALLENGES).every((c) => (c.effects ?? []).every((e) => C.EFFECT_TIMES.includes(e.when))), "every effect uses a known time");

done("check-hazards");
