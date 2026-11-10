// node scripts/rules/check-zones.mjs -- zone graph, both distances, reach, range, communication, barriers, wrecking, forced movement.
import * as Z from "./zones.mjs";
import { ok, eq, throws, done } from "./testkit.mjs";

/* street S1 - S2 - S3 in a row; building B (rooftop) next to S2 behind an exterior wall with a locked door; vault V inside B behind a
   reinforced wall; park P next to S3 behind a freestanding wall without a door; upper floor F2 of a large building T above T1 (stairs). */
const data = {
  zones: [
    { id: "S1", terrain: "street" }, { id: "S2", terrain: "street" }, { id: "S3", terrain: "street" },
    { id: "B", terrain: "building", rooftop: true }, { id: "V", terrain: "office" },
    { id: "P", terrain: "woods" }, { id: "T1", terrain: "office", level: 0 }, { id: "F2", terrain: "office", level: 1 },
    { id: "field", empty: true },
  ],
  borders: [
    { id: "s12", a: "S1", b: "S2", wall: null, door: null },
    { id: "s23", a: "S2", b: "S3", wall: null, door: null },
    { id: "s2b", a: "S2", b: "B", wall: { armor: 3, state: "intact" }, door: { armor: 2, state: "locked" } },
    { id: "bv", a: "B", b: "V", wall: { armor: 4, state: "intact" }, door: null },
    { id: "s3p", a: "S3", b: "P", wall: { armor: 2, state: "intact" }, door: null },
    { id: "s1t", a: "S1", b: "T1", wall: { armor: 3, state: "intact" }, door: { armor: 2, state: "closed" } },
    { id: "stairs", a: "T1", b: "F2", wall: null, door: null },
    { id: "pf", a: "P", b: "field", wall: null, door: null },
  ],
};
const g = Z.makeGraph(data);
const at = (zone, alt = "ground") => ({ zone, alt });

// graph validation
throws(() => Z.makeGraph({ zones: [{ id: "a" }], borders: [{ a: "a", b: "x" }] }), "border to an unknown zone");
throws(() => Z.makeGraph({ zones: [{ id: "a" }, { id: "a" }] }), "duplicate zone");
throws(() => Z.makeGraph({ zones: [{ id: "a" }, { id: "b" }], borders: [{ a: "a", b: "b", wall: { armor: 1, state: "gone" } }] }), "unknown wall state");
eq(Z.makeGraph({ zones: { a: {}, b: {} }, borders: [{ a: "a", b: "b" }] }).zones.size, 2, "zones may be an object keyed by id");
eq(data.zones[0].wrecked, undefined, "makeGraph does not modify its input");

// border states (book 2254, 2418)
const B = (wall, door) => ({ wall, door });
eq(Z.borderOpen(B(null, null)), true, "no wall = open");
eq(Z.borderOpen(B({ armor: 3, state: "intact" }, null)), false, "wall blocks");
eq(Z.borderOpen(B({ armor: 3, state: "breached" }, null)), true, "breached wall is open");
eq(Z.borderOpen(B({ armor: 3, state: "removed" }, null)), true, "removed wall is open");
eq(["open", "closed", "locked", "sealed", "breached"].map((s) => Z.borderOpen(B({ armor: 3, state: "intact" }, { armor: 2, state: s }))), [true, true, false, false, true], "door states");

// range distance: borders counted, walls included (book 2255, ruling 23)
eq(Z.borderDistance(g, "S1", "S3"), 2, "two open borders");
eq(Z.borderDistance(g, "S1", "V"), 3, "range counts blocked borders too");
eq(Z.borderDistance(g, "S1", "S1"), 0, "same zone");
eq(Z.rangeDistance(g, at("S2"), at("B")), 1, "through a wall the range is still 1");
// altitude (ruling 2)
eq(Z.rangeDistance(g, at("S2"), at("B", "elevated")), 2, "target on the roof next door: +1");
eq(Z.rangeDistance(g, at("S2"), at("S2", "elevated")), 1, "target above in the same zone: 1");
eq(Z.rangeDistance(g, at("S1", "elevated"), at("S3", "elevated")), 2, "both elevated: horizontal only");
eq(Z.rangeDistance(g, at("S1"), at("F2")), 2, "floors are zones: border count grows by itself");
eq(Z.rangeDistance(g, at("S1", "sky"), at("S3", "sky")), 0, "sky high is one zone");
eq(Z.rangeDistance(g, at("S1", "sky"), at("S1")), Infinity, "no attacks to or from sky high");
eq(Z.rangeDistance(g, at("S1", "orbit"), at("S1", "sky")), Infinity, "orbit and sky do not see each other");
eq([...Z.zonesInRange(g, "S2", 1).keys()].sort(), ["B", "S1", "S2", "S3"], "zones in range 1 ignore walls");

// movement distance: passable routes only (ruling 23)
eq(Z.moveDistance(g, "S1", "S3"), 2, "walk two zones");
eq(Z.moveDistance(g, "S2", "B"), Infinity, "locked door blocks movement");
eq(Z.moveDistance(g, "S1", "F2"), 2, "closed unlocked door is passable, stairs are a border");
eq(Z.moveDistance(g, "S3", "P"), Infinity, "wall without a door");
eq(Z.moveDistance(g, "S2", "B", { aerial: true }), 1, "flyers go over the top of a building (book 2385)");
eq(Z.moveRoute(g, "S2", "B", { aerial: true }).steps[0].over, true, "the aerial step is marked as over the top");
eq(Z.moveDistance(g, "B", "V", { aerial: true }), 1, "leaving a rooftop zone over the top");
eq(Z.moveDistance(g, "S3", "P", { aerial: true }), Infinity, "a freestanding wall has no stated aerial rule: not crossed");
eq(Z.moveDistance(g, "S1", "V", { through: "any" }), 3, "teleport-like movement counts borders");
eq(Z.moveRoute(g, "S1", "S3").zones, ["S1", "S2", "S3"], "route zones");
eq(Z.moveRoute(g, "S1", "S3").borders.map((b) => b.id), ["s12", "s23"], "route borders");
eq([...Z.zonesReachable(g, "S2", 1).keys()].sort(), ["S1", "S2", "S3"], "reachable zones respect walls");
eq(Z.straightRoute(g, "S2", "V").length, 2, "straight route ignores barriers");
{
  const g2 = Z.makeGraph({ ...data, zones: data.zones.map((z) => (z.id === "B" ? { ...z, wrecked: true } : z)) });
  eq(Z.moveDistance(g2, "S2", "B", { aerial: true }), Infinity, "a levelled building has no rooftop to fly over (book 2457)");
}
throws(() => Z.moveDistance(g, "S1", "nope"), "unknown destination");

// altitude change cost (book 2386-2388)
eq([Z.altitudeChangeCost("ground", "elevated"), Z.altitudeChangeCost("elevated", "sky"), Z.altitudeChangeCost("orbit", "ground"), Z.altitudeChangeCost("sky", "sky")], ["quick", "full", "full", "none"], "altitude costs");

// slugfest reach (book 2425, 2429, 2500, 2453)
eq(Z.slugfestReach(g, at("S1"), at("S1")).ok, true, "same zone");
eq(Z.slugfestReach(g, at("S1"), at("S2")).reason, "distance", "adjacent zone is out of reach");
eq(Z.slugfestReach(g, at("S1"), at("S1", "elevated")).reason, "elevated", "ground cannot hit elevated");
eq(Z.slugfestReach(g, at("S1"), at("S1", "elevated"), { huge: true }).ok, true, "huge creatures reach elevated targets");
eq(Z.slugfestReach(g, at("S1", "elevated"), at("S1", "elevated")).ok, true, "two elevated in one horizontal zone");
eq(Z.slugfestReach(g, at("S1"), at("S2"), { range: 1 }).ok, true, "wrecking gives range 1");
eq(Z.slugfestReach(g, at("S1"), at("S3"), { range: 1 }).ok, false, "range 1 is not range 2");
eq(Z.slugfestReach(g, at("S1", "sky"), at("S3", "sky")).ok, true, "sky high is one zone");
eq(Z.slugfestReach(g, at("S1", "sky"), at("S1")).reason, "altitude", "no slugfest across sky high");
eq(Z.slugfestReach(g, at("S1"), at("S2", "elevated"), { huge: true }).ok, false, "huge reach is for the same horizontal zone");

// shooting range (book 2511)
eq(Z.shootingRange(0, [1, 8]), { ok: true, dice: -3, reason: null }, "closer than minimum: -3 dice");
eq(Z.shootingRange(8, [1, 8]).ok, true, "at maximum range");
eq(Z.shootingRange(9, [1, 8]).reason, "tooFar", "beyond maximum");
eq(Z.canShoot(g, at("S2"), at("B"), [0, 1]).ok, true, "range goes through walls (ruling 23)");
eq(Z.canShoot(g, at("S1"), at("S1", "orbit"), [0, 99]).reason, "altitude", "no shots into orbit");

// communication (book 2381)
eq(Z.canCommunicate(g, at("S1"), at("S2")).ok, true, "adjacent zones talk");
eq(Z.canCommunicate(g, at("S1"), at("S3")).reason, "distance", "two zones away need a link");
eq(Z.canCommunicate(g, at("S1"), at("S3"), { link: true }), { ok: true, direct: false, reason: null }, "communicator works");
eq(Z.canCommunicate(g, at("S2"), at("B")).reason, "wall", "a wall impedes");
eq(Z.canCommunicate(g, at("S1", "elevated"), at("S1")).ok, true, "same horizontal zone");
eq(Z.canCommunicate(g, at("S1", "sky"), at("S1")).ok, false, "sky high is off the map");

// barriers (book 2418-2419)
eq([Z.canBreach(4, 2), Z.canBreach(5, 2), Z.canBreach(6, 3), Z.canBreach(7, 3)], [false, true, false, true], "half STRENGTH rounded up must exceed Armor");
eq(Z.breachOptions(g.borders[0]), [], "open border needs nothing");
eq(Z.breachOptions(g.borders[2]).map((o) => `${o.element}:${o.attr}:${o.action}:${o.crashOnly}`), ["door:strength:quick:false", "wall:strength:quick:true"], "locked door options");
eq(Z.breachOptions({ wall: { armor: 3, state: "intact" }, door: { armor: 2, state: "sealed" } })[0], { element: "door", armor: 2, attr: "reason", action: "full", crashOnly: false }, "sealed door: REASON, full action");
eq(Z.breachOutcome({ strength: 7, armor: 3, sixes: 1, crashing: true }), { allowed: true, breached: true, stopped: false, damage: 0 }, "crash through");
eq(Z.breachOutcome({ strength: 7, armor: 3, sixes: 0, crashing: true }), { allowed: true, breached: false, stopped: true, damage: 3 }, "failed crash: stop and take the Armor as damage");
eq(Z.breachOutcome({ strength: 7, armor: 3, sixes: 0 }).damage, 0, "failed standing attempt costs nothing");
eq(Z.breachOutcome({ strength: 6, armor: 3, sixes: 4 }).allowed, false, "too weak whatever the roll");

// wrecking (book 2451-2485)
eq(Z.wreckCheck(g.zones.get("S1"), 6), { ok: true, reason: null, bonus: 3, range: 1, levelsRooftop: false }, "street: STRENGTH 6, +3");
eq(Z.wreckCheck(g.zones.get("S1"), 5).reason, "strength", "too weak for a street");
eq(Z.wreckCheck(g.zones.get("B"), 8).levelsRooftop, true, "wrecking a building levels it");
eq(Z.wreckCheck(g.zones.get("field"), 12).reason, "terrain", "an empty field cannot be wrecked");
eq(Z.wreckCheck({ terrain: "cliffs", wrecked: true }, 12).reason, "alreadyWrecked", "only once");
eq(Object.entries(Z.WRECK_TABLE).map(([k, v]) => `${k}${v[0]}+${v[1]}`).join(" "), "office4+1 warehouse5+2 street6+3 woods7+4 building8+5 cliffs9+6", "wreck table");

// forced movement (book 2435, 2494, 2504; ruling 8)
{
  // book example 2504: knocked 4 zones, hits an exterior wall (Armor 3) with damage 4, target Armor 2: takes 2 and goes through
  const r = Z.forcedMove(g, { path: ["S1", "S2", "B", "V"], distance: 4, damage: 4, targetArmor: 2 });
  eq(r.hits[0], { border: "s2b", element: "wall", armor: 3, raw: 4, taken: 2, through: true }, "book example: through the wall");
  // second barrier: damage 3 against Armor 4: held, still hurts (ruling 8)
  eq(r.hits[1], { border: "bv", element: "wall", armor: 4, raw: 3, taken: 1, through: false }, "second barrier: -1, holds, still damages");
  eq([r.zone, r.moved, r.stoppedBy], ["B", 2, "bv"], "stops at the barrier that holds");
  eq(r.breached, ["s2b"], "breached borders reported");
  const held = Z.forcedMove(g, { path: ["S2", "B"], distance: 2, damage: 3, targetArmor: 5 });
  eq([held.zone, held.hits[0].taken, held.hits[0].through], ["S2", 0, false], "barrier Armor equal to the damage holds; target Armor is not part of the comparison");
  const open = Z.forcedMove(g, { path: ["S1", "S2", "S3"], distance: 1, damage: 4 });
  eq([open.zone, open.moved, open.hits.length], ["S2", 1, 0], "distance limits the move");
  const slam = Z.forcedMove(g, { path: ["S2", "B", "V"], distance: 3, damage: 5, decay: 0 });
  eq(slam.hits.map((h) => h.raw), [5, 5], "Slam: no decay stated");
  eq(slam.zone, "V", "Slam continues through both barriers");
  const door = Z.forcedMove(g, { path: ["S2", "B"], distance: 1, damage: 3, elements: { s2b: "door" } });
  eq([door.hits[0].element, door.hits[0].through], ["door", true], "GM may name the door as the element hit");
  throws(() => Z.forcedMove(g, { path: ["S1", "S3"], distance: 1, damage: 1 }), "path must follow neighbours");
}

done("check-zones");
