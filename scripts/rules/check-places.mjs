// node scripts/rules/check-places.mjs -- the place model (zone + level, floors as levels, off-map areas): positions, range with levels,
// routes with levels, reach and talking from numbers, the graph built from the zones API's data, and agreement with the zones API.
import * as Z from "./zones.mjs";
import * as H from "./hazards.mjs";
import { WORLD, PLACES, decode } from "./check-places-world.mjs";
import { GOLDEN } from "./check-places-golden.mjs";
import { ok, eq, throws, done } from "./testkit.mjs";

const g = Z.makeGraph(WORLD.graph);
const pos = (p) => (p.key ? { zone: p.key, alt: p.alt, floor: p.floor, airborne: p.air } : { area: p.alt });

/* ------------------------------------------------------------------ positions */
eq(Z.LEVELS, ["underground", "ground", "elevated", "floor"], "levels of the zones contract");
eq(Z.AREAS, ["sky", "orbit", "dimension", "chase"], "off-map areas of the zones contract");
eq(Z.ALTITUDES, ["ground", "elevated", "sky", "orbit"], "the book's altitudes stay exported");
eq(Z.AREAS.map(Z.isOffMap).concat(Z.isOffMap("elevated"), Z.isOffMap("underground")), [true, true, true, true, false, false], "isOffMap knows the four areas");
{
  const spots = (list) => list.map((p) => Z.toPlace(g, p).spot);
  eq(spots(["a", "a:elevated", "a:underground", "b:f2", "@sky", "@chase"]), ["a", "a:elevated", "a:underground", "b:f2", "@sky", "@chase"], "spot strings are positions");
  eq(spots([{ zone: "b", alt: "ground" }, { zone: "b", alt: "elevated" }, { zone: "b", alt: "sky" }, { zone: "b" }]), ["b", "b:elevated", "@sky", "b"], "the older { zone, alt } form");
  eq(spots([{ zone: "b", level: "floor", floor: 2 }, { zone: "b", level: "elevated", airborne: true }, { zone: "@orbit", area: "orbit", level: null }, { zone: "a", level: "underground" }]),
    ["b:f2", "b:elevated", "@orbit", "a:underground"], "places of the zones API");
  eq(spots([{ zone: "b", alt: "ground", floor: 9 }, { zone: "a", floor: 1 }, { zone: "d", floor: 1 }]), ["b", "a", "d"], "a floor the building does not have (or lost when wrecked, book 2457) is the ground");
  const roof = Z.toPlace(g, "c:elevated"), air = Z.toPlace(g, { zone: "c", level: "elevated", airborne: true }), open = Z.toPlace(g, "a:elevated"), ruin = Z.toPlace(g, "d:elevated");
  eq([roof.roof, roof.airborne, air.roof, air.airborne], [true, false, false, true], "elevated over a standing building: on its rooftop unless marked airborne (book 2258, 2396)");
  eq([open.airborne, ruin.airborne, ruin.roof], [true, true, false], "no rooftop over open ground or a wrecked building (book 2457)");
  eq([Z.sameSpot(g, "c:elevated", { zone: "c", level: "elevated", airborne: true }), Z.sameSpot(g, "c", "c:elevated"), Z.sameSpot(g, "@sky", { zone: "a", alt: "sky" }), Z.sameSpot(g, "b:f1", "b:f2")],
    [true, false, true, false], "same zone in the book's sense = equal spots (book 2258, 2259, 2262)");
  eq(Z.toPlace(g, { zone: "a", alt: "sky" }), { zone: "@sky", area: "sky", level: null, floor: 0, airborne: false, roof: false, spot: "@sky" }, "an off-map place");
  eq(Z.toPlace(g, { zone: null, level: "ground" }).spot, null, "outside every zone");
  throws(() => Z.toPlace(g, "nope"), "an unknown zone");
  throws(() => Z.toPlace(g, "a:nope"), "a malformed spot");
  throws(() => Z.toPlace(g, null), "no position");
  eq([Z.parseSpot("b:f2"), Z.parseSpot("@moon"), Z.parseSpot("")], [{ zone: "b", alt: "ground", floor: 2 }, null, null], "parseSpot");
  eq(["a", "a:elevated", "c:elevated", "b:elevated", { zone: "b", level: "elevated", airborne: true }, "b:f3", "a:underground", "@sky"].map((p) => Z.heightOf(g, p)), [0, 1, 1, 4, 1, 3, -1, null],
    "heights: floor = its number, rooftop above the top floor, other elevated 1, underground -1 (ZR-1), none off the map");
  eq([Z.floorsOf(g.zones.get("b")), Z.floorsOf(g.zones.get("d")), Z.floorsOf(g.zones.get("a"))], [3, 0, 0], "floors of a standing building only");
  const ids = Z.makeGraph({ zones: [{ id: "x:1" }, { id: "y" }], borders: [{ a: "x:1", b: "y" }] });
  eq(Z.rangeDistance(ids, "x:1", "y"), 1, "a string that names a zone is that zone, whatever characters it has");
}

/* ------------------------------------------------------------------ range: the same answers as the zones API on the same data */
{
  const want = decode(GOLDEN.range), wantLevels = decode(GOLDEN.levels);
  eq(want.length, PLACES.length * PLACES.length, "one frozen answer per pair of places");
  let bad = 0, mixed = 0, i = 0;
  for (const a of PLACES) for (const b of PLACES) {
    const r = Z.rangeBetween(g, pos(a), pos(b));
    const got = [r ? r.total : null, r ? r.levels : null], exp = [want[i], wantLevels[i]];
    if (got[0] !== exp[0] || got[1] !== exp[1]) { bad++; if (bad < 10) console.log("FAIL range", JSON.stringify(a), JSON.stringify(b), got, exp); }
    if (r && r.levels > 1) mixed++;
    if ((r ? r.total : Infinity) !== Z.rangeDistance(g, pos(a), pos(b))) bad++;
    i++;
  }
  eq(bad, 0, `rangeBetween and rangeDistance = the zones API's range for all ${i} pairs of places (floors, rooftops, underground, the air, areas)`);
  ok(mixed > 300, `the pairs include many with more than one level between them (${mixed})`);
  // the cases behind the numbers, one by one
  const R = (a, b) => Z.rangeBetween(g, a, b);
  eq(R({ zone: "a", level: "elevated", airborne: true }, "b:f2"), { borders: 1, levels: 1, total: 2 }, "a flyer over the street and a target on floor 2 next door: 1 border + 1 level (the handoff's example)");
  eq(R("a", "b:f3"), { borders: 1, levels: 3, total: 4 }, "from the street to floor 3: floors are vertical zones (book 2262)");
  eq(R("b:f1", "b:f3"), { borders: 0, levels: 2, total: 2 }, "two floors apart inside one building");
  eq(R("b", "b:elevated"), { borders: 0, levels: 4, total: 4 }, "the rooftop is above the top floor from inside (book 2417)");
  eq(R("a", "b:elevated"), { borders: 1, levels: 1, total: 2 }, "and one zone up from outside (book 2417)");
  eq(R("b:f3", "c:elevated"), { borders: 1, levels: 2, total: 3 }, "floor 3 against the neighbour's rooftop");
  eq(R("b:elevated", "e:elevated"), { borders: 1, levels: 0, total: 1 }, "two elevated characters: horizontal distance only (ruling 2)");
  eq(R("b:elevated", { zone: "b", level: "elevated", airborne: true }), { borders: 0, levels: 0, total: 0 }, "on the roof and in the air above it: the same zone (book 2258)");
  eq(R("a", "f"), { borders: 3, levels: 0, total: 3 }, "walls are borders like any other (ruling 23)");
  eq(R("a:underground", "a"), { borders: 0, levels: 1, total: 1 }, "underground is one level below the ground (ZR-1)");
  eq(R("a:underground", "b:f2"), { borders: 1, levels: 3, total: 4 }, "underground to a floor");
  eq([R("@sky", "@sky"), R("@sky", "a"), R("@sky", "@orbit"), R("@dimension", "@dimension"), R("@chase", "b:f1")], [{ borders: 0, levels: 0, total: 0 }, null, null, { borders: 0, levels: 0, total: 0 }, null],
    "off-map areas: one zone each, no range into or out of them (book 2259-2260, ruling 2)");
  eq([Z.rangeDistance(g, "@sky", "a"), Z.rangeDistance(g, { zone: null }, "a")], [Infinity, Infinity], "rangeDistance answers Infinity where there is no range");
  const split = Z.makeGraph({ zones: [{ id: "p" }, { id: "q" }], borders: [] });
  eq([Z.rangeBetween(split, "p", "q"), Z.rangeDistance(split, "p", "q")], [null, Infinity], "zones that are not connected");
  eq(Z.canShoot(g, "a", "b:f3", [0, 4]).distance, 4, "canShoot counts the levels");
  eq(Z.canShoot(g, "a", "b:f3", [0, 3]).reason, "tooFar", "and refuses beyond the weapon's range");
}

/* a graph with every floor as a zone of its own (the first version of this library) still answers, and agrees with the level model
   wherever no elevation is mixed in */
{
  const old = Z.makeGraph({
    zones: [{ id: "a" }, { id: "b0" }, { id: "b1" }, { id: "b2" }, { id: "b3" }],
    borders: [{ a: "a", b: "b0", wall: { armor: 3, state: "intact" } }, { a: "b0", b: "b1" }, { a: "b1", b: "b2" }, { a: "b2", b: "b3" }],
  });
  const at = (zone, alt = "ground") => ({ zone, alt });
  eq([Z.rangeDistance(old, at("a"), at("b3")), Z.rangeDistance(g, "a", "b:f3")], [4, 4], "street to floor 3: both models give 4");
  eq([Z.rangeDistance(old, at("b1"), at("b3")), Z.rangeDistance(g, "b:f1", "b:f3")], [2, 2], "floor 1 to floor 3: both give 2");
  eq([Z.rangeDistance(old, at("a", "elevated"), at("b2")), Z.rangeDistance(g, "a:elevated", "b:f2")], [4, 2], "a flyer against floor 2: the old model counted 3 borders + 1, the level model counts 1 + 1 (as the zones API)");
}

/* ------------------------------------------------------------------ routes with levels */
{
  const WAYS = { walk: {}, air: { aerial: true }, through: { through: "any" } };
  let bad = 0, n = 0;
  for (const [way, profile] of Object.entries(WAYS)) {
    const want = decode(GOLDEN[way]);
    let i = 0;
    for (const a of PLACES) for (const b of PLACES) {
      const r = Z.routeBetween(g, pos(a), pos(b), profile);
      if ((r ? r.total : null) !== want[i]) { bad++; if (bad < 10) console.log("FAIL route", way, JSON.stringify(a), JSON.stringify(b), r, want[i]); }
      i++; n++;
    }
  }
  eq(bad, 0, `routeBetween = the zones API's route for walk, air (A14: over exterior walls and the edges of standing buildings) and through, ${n} cases`);
  const T = (a, b, p) => Z.routeBetween(g, a, b, p);
  eq(T("e:f1", "f"), { borders: 1, levels: 1, total: 2 }, "a walker comes down the stairs first (book 2417)");
  eq(T("e", "e:elevated"), { borders: 0, levels: 2, total: 2 }, "up to the rooftop of a building with one floor: two vertical zones");
  eq(T("c", "c:elevated"), { borders: 0, levels: 1, total: 1 }, "a plain building is one zone: its rooftop is one move (book 2394)");
  eq(T("a", "b"), null, "an exterior wall stops a walker");
  eq(T("a", "b:f2", { aerial: true }), { borders: 1, levels: 0, total: 1 }, "a flyer passes over the exterior wall and changes level inside the move (book 2385-2386)");
  eq(T("a", "a:elevated", { aerial: true }), { borders: 0, levels: 1, total: 1 }, "ground to elevated in one zone: one quick action (book 2386)");
  eq(T("a", { zone: "a", level: "elevated" }), null, "the air cannot be walked to");
  eq([T("a", "a:underground"), T("a", "a:underground", { aerial: true }), T("a", "c:underground", { through: "any" })], [null, null, { borders: 2, levels: 0, total: 2 }], "only a mover that passes through reaches underground (book 1995, ZR-4)");
  eq([T("a", "@sky", { aerial: true }), T("@sky", "@sky", { aerial: true })], [null, null], "to or from an off-map area there is no route: that is a full action (book 2387-2388)");
  // flyers and blocked borders: the user's answer A14 (2026-11-12) replaced the two readings of OQ-14 (the profile option `over`
  // "rooftop" / "exterior" is gone); the old checks below changed to A14, the map's zones code (marks.mjs stopped()) agrees
  eq(Z.moveRoute(g, "a", "b", { aerial: true }).steps[0].over, true, "the step over a wall is marked");
  eq(Z.moveDistance(g, "c", "f", { aerial: true }), 1, "A14 (was: over exterior, Infinity): the wall between a standing building and open ground is crossed over the roof");
  eq(Z.moveRoute(g, "b", "e", { aerial: true }).length, 3, "A14 (was: reading 4, 1): a reinforced wall between two standing buildings is a wall inside a building and stops a flyer; it goes round (3)");
  eq(Z.moveRoute(g, "d", "e", { aerial: true }).length, 1, "A14: the locked door between a wrecked building (no roof) and a standing one is crossed over the standing one's roof");
  eq([Z.moveDistance(g, "a", "e", { aerial: true }), Z.moveDistance(g, "e", "a", { aerial: true })], [2, 2], "A14: the same both ways");
  {
    const two = (wall, za = {}, zb = {}) => Z.moveDistance(Z.makeGraph({ zones: [{ id: "x", ...za }, { id: "y", ...zb }], borders: [{ a: "x", b: "y", wall, door: null }] }), "x", "y", { aerial: true });
    const W = { armor: 2, state: "intact" }, O = { armor: 3, state: "intact", outer: true }, R = { armor: 4, state: "intact" }, roof = { building: true, rooftop: true };
    eq([two(W), two(O)], [Infinity, 1], "A14: a freestanding wall (no building on either side) stops a flyer unless it is marked exterior");
    eq([two(W, roof, roof), two(R, roof, roof), two(O, roof, roof)], [Infinity, Infinity, 1], "A14: a wall between two standing buildings stops a flyer unless it is marked exterior (two buildings side by side)");
    eq([two(W, roof), two(R, {}, roof), two(O, roof)], [1, 1, 1], "A14: from outside a flyer passes over every standing building, whatever the wall is marked as");
    eq([two(W, { ...roof, wrecked: true }), two(W, { ...roof, wrecked: true }, roof), two(W, { ...roof, wrecked: true }, { ...roof, wrecked: true })], [Infinity, 1, Infinity], "A14: a wrecked building has no roof to fly over (book 2457)");
    eq([two(W, roof, {}), Z.moveDistance(Z.makeGraph({ zones: [{ id: "x", ...roof }, { id: "y" }], borders: [{ a: "x", b: "y", wall: W, door: null }] }), "x", "y")], [1, Infinity], "A14 is for flyers only: a walker is still stopped");
    eq(two(W, roof, roof) === Infinity && Z.moveDistance(Z.makeGraph({ zones: [{ id: "x", ...roof }, { id: "y", ...roof }], borders: [{ a: "x", b: "y", wall: W, door: null }] }), "x", "y", { aerial: true, over: "rooftop" }), Infinity,
      "the old option over: \"rooftop\" no longer lets a flyer through a wall inside a building");
  }
}

/* ------------------------------------------------------------------ altitude change */
eq([Z.altitudeChangeCost("ground", "elevated"), Z.altitudeChangeCost("elevated", "sky"), Z.altitudeChangeCost("orbit", "ground"), Z.altitudeChangeCost("sky", "sky")], ["quick", "full", "full", "none"], "as before (book 2386-2388)");
eq([Z.altitudeChangeCost("ground", "underground"), Z.altitudeChangeCost("ground", "dimension"), Z.altitudeChangeCost("chase", "sky"), Z.altitudeChangeCost("chase", "chase")], ["quick", "gm", "gm", "none"],
  "underground as the map prices it; the plan's areas have no cost in the book: the GM says");

/* ------------------------------------------------------------------ slugfest reach, from the graph and from numbers */
{
  const reach = (a, b, o) => Z.slugfestReach(g, a, b, o);
  eq(reach("a", "a"), { ok: true, reason: null, distance: 0 }, "same zone (book 2425)");
  eq(reach("b:f1", "b:f2"), { ok: false, reason: "level", distance: 1 }, "another floor is another zone (book 2262)");
  eq(reach("b:f1", "b:f2", { range: 1 }).ok, true, "a range-1 attack (wrecking) reaches the next floor");
  eq(reach("b:f1", "b:f3", { range: 1 }).reason, "level", "but not two floors");
  eq(reach("b:f1", "b:f2", { huge: true }).reason, "level", "a huge attacker reaches elevated targets (book 2500), not other floors");
  eq(reach("a", "a:elevated"), { ok: false, reason: "elevated", distance: 1 }, "ground against elevated (book 2258)");
  eq([reach("a", "a:elevated", { huge: true }).ok, reach("a", "a:elevated", { reachesElevated: true }).ok, reach("a:elevated", "a", { huge: true }).ok], [true, true, false], "huge or special reach, upwards only");
  eq(reach("b:elevated", { zone: "b", level: "elevated", airborne: true }).ok, true, "rooftop and air above it fight each other (book 2258)");
  eq(reach("a", "a:underground").reason, "level", "underground is another level");
  eq(reach("a", "b").reason, "distance", "another horizontal zone");
  eq([reach("@sky", "@sky").ok, reach("@sky", "a").reason, reach("@chase", "@chase").ok], [true, "altitude", true], "off-map areas (book 2259-2260)");
  // the number-taking form gives the same answer for every pair of places of the world, fed with rangeBetween (= the zones API's range)
  let bad = 0, n = 0;
  for (const o of [{}, { range: 1 }, { huge: true }, { reachesElevated: true, range: 1 }]) for (const a of PLACES) for (const b of PLACES) {
    const A = Z.toPlace(g, pos(a)), B = Z.toPlace(g, pos(b));
    const viaGraph = Z.slugfestReach(g, pos(a), pos(b), o), viaNumbers = Z.slugfestReachAt(Z.rangeBetween(g, A, B), { level: A.level, area: A.area }, { level: B.level, area: B.area }, o);
    if (JSON.stringify(viaGraph) !== JSON.stringify(viaNumbers)) bad++;
    n++;
  }
  eq(bad, 0, `slugfestReachAt (numbers) = slugfestReach (graph), ${n} cases`);
  eq(Z.slugfestReachAt({ borders: 0, levels: 1, total: 1 }, { level: "ground" }, { level: "elevated" }, { huge: true }), { ok: true, reason: null, distance: 1 }, "from the zones API's numbers alone");
  eq(Z.slugfestReachAt(null, { level: "ground" }, { level: "ground" }), { ok: false, reason: "noRange", distance: Infinity }, "no range, nobody off the map");
  eq(Z.slugfestReachAt(null, { area: "sky" }, { level: "ground" }).reason, "altitude", "no range because of an off-map area");
}

/* ------------------------------------------------------------------ talking, from the graph and from numbers */
{
  const talk = (a, b, o) => Z.canCommunicate(g, a, b, o);
  eq(talk("a", "a:elevated").direct, true, "ground and elevated of one zone (reading 3)");
  eq(talk("a", "d:elevated").direct, true, "ground and elevated of neighbouring zones over an open border (reading 3)");
  eq(talk("a", "b"), { ok: false, direct: false, reason: "wall" }, "a wall impedes (book 2381)");
  eq(talk("e", "f").direct, true, "an open border");
  eq(talk("b:f1", "b:f2").direct, true, "the next floor is an adjacent zone (reading 3a)");
  eq(talk("b:f1", "b:f3"), { ok: false, direct: false, reason: "distance" }, "two floors apart is not adjacent");
  eq(talk("e:f1", "f").reason, "distance", "a floor and the street next door: two zones");
  eq(talk("b", "b:elevated").direct, true, "reading 3 keeps ground and rooftop of one zone within earshot whatever lies between");
  eq(talk("a", "a:underground").direct, true, "one level down counts as adjacent (reading 3a)");
  eq(talk("a", "f"), { ok: false, direct: false, reason: "distance" }, "farther away");
  eq(talk("a", "f", { link: true }), { ok: true, direct: false, reason: null }, "a communicator or a power bridges it (book 2381)");
  eq([talk("@sky", "@sky").direct, talk("@sky", "a").ok, talk("@sky", "@orbit").ok, talk("@sky", "a", { link: true }).ok], [true, false, false, true], "off-map areas");
  let bad = 0, n = 0;
  for (const link of [false, true]) for (const a of PLACES) for (const b of PLACES) {
    const A = Z.toPlace(g, pos(a)), B = Z.toPlace(g, pos(b)), r = Z.rangeBetween(g, A, B);
    const between = r && r.borders === 1 ? Z.bordersBetween(g, A.zone, B.zone) : [];
    const viaNumbers = Z.canCommunicateAt(r, { level: A.level, area: A.area }, { level: B.level, area: B.area }, { link, impeded: between.length > 0 && between.every(Z.borderImpedesTalk) });
    if (JSON.stringify(viaNumbers) !== JSON.stringify(Z.canCommunicate(g, pos(a), pos(b), { link }))) bad++;
    n++;
  }
  eq(bad, 0, `canCommunicateAt (numbers) = canCommunicate (graph), ${n} cases`);
  eq(Z.canCommunicateAt({ borders: 1, levels: 0, total: 1 }, { level: "ground" }, { level: "ground" }, { impeded: true }).reason, "wall", "from numbers: the caller says whether the border impedes");
  eq(Z.canCommunicateAt({ borders: 1, levels: 0, total: 1 }, { level: "ground" }, { level: "ground" }).direct, true, "from numbers: neighbours");
  eq(Z.canCommunicateAt(null, { level: "ground" }, { level: "ground" }).reason, "distance", "from numbers: no range");
}

/* ------------------------------------------------------------------ the graph from the zones API's data */
{
  // zones and borders as the zones API returns them (older one-kind borders)
  const api = {
    zones: [
      { key: "z1", building: false, floors: 0, rooftop: false, terrain: "street", empty: false, tags: ["flammable"], states: { wrecked: false, fire: 0 } },
      { key: "z2", building: true, floors: 2, rooftop: true, terrain: "office", empty: false, tags: ["water", "metal"], states: { wrecked: false, fire: 6 } },
      { key: "z3", building: true, floors: 0, rooftop: false, terrain: "none", empty: true, tags: [], states: { wrecked: true, fire: 0 }, props: { building: true, floors: 4, wrecked: true } },
      { key: "z4", building: false, floors: 0, rooftop: false, terrain: "", empty: false, tags: [], states: { wrecked: false, fire: 0 } },
    ],
    borders: [
      { key: "z1|z2", zones: ["z1", "z2"], kind: "outer", armor: 3 }, { key: "z1|z2", zones: ["z1", "z2"], kind: "outer", armor: 3 },
      { key: "z2|z3", zones: ["z2", "z3"], kind: "locked", armor: 2 }, { key: "z3|z4", zones: ["z3", "z4"], kind: "door", armor: 1 }, { key: "z1|z4", zones: ["z1", "z4"], kind: "open", armor: 0 },
    ],
  };
  const data = Z.graphFromZonesApi(api), gg = Z.makeGraph(data);
  eq(data.zones.map((z) => [z.id, z.terrain, z.terrainUnset, z.building, z.rooftop, z.floors, z.empty, z.wrecked, z.flammable, z.water, z.fire]), [
    ["z1", "street", false, false, false, 0, false, false, true, false, 0], ["z2", "office", false, true, true, 2, false, false, false, true, 6],
    ["z3", null, false, true, true, 4, true, true, false, false, 0], ["z4", null, true, false, false, 0, false, false, false, false, 0]], "zones: key as id, floors as levels, tags and states as flags");
  eq(data.borders.length, 4, "a border listed from both sides is taken once");
  eq(data.borders.map((b) => [b.id, b.wall?.armor ?? null, b.wall?.outer ?? null, b.door?.state ?? null, b.door?.armor ?? null]), [["z1|z2", 3, true, null, null], ["z2|z3", 2, false, "locked", 2], ["z3|z4", 2, false, "closed", 1], ["z1|z4", null, null, null, null]],
    "one-kind borders become wall + door (book 2398-2416)");
  eq([data.borders[1].wall.armorAssumed, data.borders[0].wall.armorAssumed], [true, undefined], "the wall around an old door mark has an assumed Armor, flagged");
  eq([Z.borderOpen(gg.borders[0]), Z.borderOpen(gg.borders[1]), Z.borderOpen(gg.borders[2]), Z.borderOpen(gg.borders[3])], [false, false, true, true], "passable: the unlocked door and the open border");
  eq(Z.hasRooftop(gg.zones.get("z3")), false, "a wrecked building has no rooftop (book 2457)");
  eq(Z.floorsOf(gg.zones.get("z3")), 0, "nor floors");
  eq(Z.rangeBetween(gg, "z1", "z2:f2"), { borders: 1, levels: 2, total: 3 }, "spots of the zones API are positions of the converted graph");
  eq(Z.wreckCheck(gg.zones.get("z4"), 9), { ok: false, reason: "terrainUnset", bonus: 0, range: 0, levelsRooftop: false, gmMayAllow: true }, "terrain never set: the GM decides (OQ-18)");
  eq(Z.wreckCheck(gg.zones.get("z3"), 9).reason, "terrain", "terrain 'none' cannot be wrecked (book 2455)");
  eq(Z.wreckCheck(gg.zones.get("z2"), 4).ok, true, "terrain from the table as before");
  eq(Z.wreckCheck({ terrain: null }, 9).reason, "terrain", "a hand-made zone without terrain: as before");
  throws(() => Z.graphFromZonesApi({ zones: [], borders: [{ key: "x|y", zones: ["x", "y"], kind: "moat" }] }), "an unknown border kind");
  // borders that already come as wall + door (the map's wall-plus-door model)
  const m2 = Z.graphFromZonesApi({ zones: api.zones, borders: [
    { key: "z1|z2", zones: ["z1", "z2"], kind: "door", wall: { armor: 3, state: "intact", outer: true, temp: false }, doorway: { armor: 2, state: "sealed", built: "sealed" } },
    { key: "z2|z3", zones: ["z2", "z3"], kind: "open", wall: { armor: 2, state: "breached", outer: false }, doorway: null },
    { key: "z3|z4", zones: ["z3", "z4"], kind: "open", wall: null, doorway: null },
  ] });
  eq(m2.borders, [{ id: "z1|z2", a: "z1", b: "z2", wall: { armor: 3, state: "intact", outer: true }, door: { armor: 2, state: "sealed" } },
    { id: "z2|z3", a: "z2", b: "z3", wall: { armor: 2, state: "breached", outer: false }, door: null }, { id: "z3|z4", a: "z3", b: "z4", wall: null, door: null }], "wall and door of their own are taken as they are");
  const g2 = Z.makeGraph(m2);
  eq(Z.breachOptions(g2.borders[0]).map((o) => `${o.element}:${o.attr}:${o.armor}`), ["door:reason:2", "door:strength:2", "wall:strength:3"], "an exterior sealed door: the case the one-kind marks could not express");
  eq(Z.borderOpen(g2.borders[1]), true, "a breached wall is an open border");
  // fire spread criteria as parameters (OQ-15): z2 burns; z1 behind a wall, z3 behind a locked door
  const fire = Z.makeGraph({ zones: [{ id: "f0" }, { id: "dry", flammable: true }, { id: "door", flammable: true }, { id: "plain" }, { id: "pond", flammable: true, water: true }],
    borders: [{ a: "f0", b: "dry" }, { a: "f0", b: "door", wall: { armor: 2, state: "intact" }, door: { armor: 1, state: "closed" } }, { a: "f0", b: "plain" }, { a: "f0", b: "pond" }] });
  eq(H.fireSpreadTargets(fire, "f0"), ["dry", "door", "pond"], "default: over open borders and unlocked doors into flammable zones (as before)");
  eq(H.fireSpreadTargets(fire, "f0", [], { doors: "block" }), ["dry", "pond"], "doors block: any standing wall stops the fire");
  eq(H.fireSpreadTargets(fire, "f0", [], { needFlammable: false }), ["dry", "door", "plain", "pond"], "without the flammability tag");
  eq(H.fireSpreadTargets(fire, "f0", ["dry"], { doors: "block", needFlammable: false, water: "never" }), ["plain"], "the map's own criteria: walls and doors block, water does not burn, no tag asked");
  eq(H.pickFireSpread(() => 0.99, fire, "f0", [], { doors: "block" }), "pond", "pickFireSpread takes the same options");
}

done("check-places");
