// node scripts/rules/check-movement.mjs -- the cost of a move: zones per action, the stress option, conditions that make it a full action.
import * as M from "./movement.mjs";
import * as Z from "./zones.mjs";
import { WORLD } from "./check-places-world.mjs";
import { ok, eq, throws, done } from "./testkit.mjs";

const P = M.moveProfile;
const opt = (r) => r.options.map((o) => `${o.action}${o.stress ? "+s" : ""}`);

/* profiles */
eq(P("walk"), { mode: "walk", way: "walk", zones: 1, stressZones: null, stress: 1, actions: ["quick"], medium: "ground", assumed: false }, "walking: one zone per quick action (book 2383)");
eq(["basic", "major", "massive", "monstrous"].map((tier) => [P("flight", { tier }).zones, P("flight", { tier }).stressZones]), [[2, 4], [4, 8], [8, 16], [16, 32]], "flight by level (book 1999-2002)");
for (const mode of ["leaping", "superSpeed", "teleportation"]) eq([P(mode, { tier: "massive" }).zones, P(mode, { tier: "massive" }).stressZones], [8, 16], `${mode} has the same levels`);
eq([P("swimming").zones, P("swimming", { tier: "fast" }).stressZones, P("swinging", { tier: "fast" }).zones], [2, 8, 4], "swimming and swinging with their boosts (book 2021-2022, 2027, 2030)");
eq([P("burrowing").way, P("burrowing").zones, P("burrowing").stressZones, P("burrowing").medium], ["through", 2, 4, "ground"], "burrowing (book 1995)");
eq([P("grown").zones, P("grown").stressZones, P("grown").actions], [2, null, ["quick", "full"]], "grown: 2 zones, no stress option (book 1975)");
eq([P("earthDrift").stressZones, P("elongatedStride").vertical], [4, true], "Earth Drift, Elongated Stride (book 1676, 1922)");
eq(P("teleportation").actions, ["quick"], "teleportation is a quick action only (ruling 18)");
eq(P("flight").actions, ["quick", "full"], "the travel powers: a quick or a full action");
eq(Object.entries(M.MOVE_MODES).filter(([, m]) => m.assumed).map(([k]) => k), ["leaping", "superSpeed", "swinging"], "ways the book does not class as ground or aerial are flagged");
eq(Object.values(M.MOVE_MODES).map((m) => m.way).every((w) => ["walk", "air", "through", "swim", "swing"].includes(w)), true, "every way is one of the zones contract's");
eq(P("vehicle", { speed: 3 }), { mode: "vehicle", way: "walk", zones: 3, stressZones: null, stress: 1, actions: ["quick"], medium: "ground", assumed: false }, "a vehicle: its Speed per quick action (book 2941, 3146)");
eq([P("vehicle", { speed: 5, aerial: true }).way, P("vehicle", { speed: 5, aerial: true }).medium], ["air", "air"], "a flying vehicle");
eq([P("vehicle", { speed: 5, aerial: true }).ends, P("vehicle", { speed: 5 }).ends, P("flight").ends.includes("air")], [["ground", "rooftop", "air"], undefined, true], "a flying vehicle may end its move on the ground, on a rooftop or in the air, as flight does (book 3247, 2385); a ground vehicle has no such choice");
throws(() => P("vehicle"), "a vehicle without Speed");
throws(() => P("hover"), "an unknown way");
throws(() => P("swimming", { tier: "major" }), "a tier the way does not have");

/* one move */
eq(M.moveCost(0, P("walk")), { ok: true, reason: null, options: [{ action: "none", stress: 0, zones: 0 }], roll: null, full: [], unsettled: [], onTurnOnly: true }, "inside the zone: no action, own turn only (book 2383)");
eq(opt(M.moveCost(1, P("walk"))), ["quick"], "one zone on foot");
eq(M.moveCost(2, P("walk")).reason, "tooFar", "two zones on foot are two moves");
eq(opt(M.moveCost(2, P("flight"))), ["quick", "full"], "2 zones flying");
eq(opt(M.moveCost(3, P("flight"))), ["quick+s", "full+s"], "3 zones flying: only with 1 stress");
eq(opt(M.moveCost(2, P("flight"), { resolve: 3 })), ["quick", "full"], "within the plain reach no stress option is offered");
eq(M.moveCost(3, P("flight"), { resolve: 0 }).reason, "stressedOut", "no voluntary stress at 0 Resolve (book 2816)");
eq(opt(M.moveCost(2, P("flight"), { resolve: 0 })), ["quick", "full"], "the plain move stays");
eq(M.moveCost(5, P("flight")).reason, "tooFar", "beyond the stress reach");
eq(opt(M.moveCost(4, P("teleportation"))), ["quick+s"], "teleport 4 zones: a quick action and 1 stress");
eq([M.moveCost(null, P("walk")).reason, M.moveCost(Infinity, P("flight")).reason], ["noRoute", "noRoute"], "no route");
eq(opt(M.moveCost(3, P("vehicle", { speed: 3 }))), ["quick"], "a vehicle up to its Speed");

/* conditions */
eq(M.moveConditions(P("walk"), { crushedLeg: true }), { full: ["crushedLeg"], roll: null, blocked: null, unsettled: [] }, "crit 8: ground movement is a full action (book 2745)");
eq(opt(M.moveCost(1, P("walk"), { conditions: { crushedLeg: true } })), ["full"], "walking with a crushed leg");
eq(opt(M.moveCost(2, P("flight"), { conditions: { crushedLeg: true } })), ["quick", "full"], "flying is not ground movement");
eq(opt(M.moveCost(2, P("burrowing"), { conditions: { crushedLeg: true } })), ["full"], "burrowing works like ground movement (book 1995)");
eq(opt(M.moveCost(2, P("flight"), { conditions: { afflicted: true } })), ["full"], "Affliction: all movement (book 1574)");
{
  const r = M.moveCost(2, P("flight"), { conditions: { storm: true } });
  eq([opt(r), r.roll, r.full], [["full"], "strength", ["storm"]], "storm: full action with a STRENGTH roll (book 1841)");
  const g = M.moveCost(1, P("walk"), { conditions: { highGravity: true } });
  eq([opt(g), g.roll], [["full"], "strength"], "high gravity on the ground (book 1704)");
  const a = M.moveCost(2, P("flight"), { conditions: { highGravity: true } });
  eq([a.ok, a.reason, a.gmMayAllow], [false, "noAerial", false], "high gravity: no aerial movement (book 1704)");
  const l = M.moveCost(2, P("leaping"), { conditions: { highGravity: true } });
  eq([l.reason, l.gmMayAllow, l.unsettled], ["noAerial", true, ["highGravity"]], "leaping as aerial movement is this library's reading: flagged, the GM may allow");
  const s = M.moveCost(2, P("superSpeed"), { conditions: { crushedLeg: true } });
  eq([opt(s), s.unsettled], [["full"], ["crushedLeg"]], "super-speed as ground movement: flagged the same way");
  eq(M.moveCost(0, P("flight"), { conditions: { storm: true } }).options[0].action, "none", "moving inside the zone stays free");
  eq(M.moveCost(2, P("swimming"), { conditions: { crushedLeg: true, highGravity: true } }).full, [], "swimming is neither");
  eq(opt(M.moveCost(2, P("teleportation"), { conditions: { afflicted: true } })), ["full"], "teleport under Affliction: the condition wins by default");
  eq(M.moveCost(2, P("teleportation"), { conditions: { afflicted: true }, quickOnly: "blocked" }), { ok: false, reason: "quickOnly", options: [], roll: null, full: ["afflicted"], unsettled: [], onTurnOnly: false, gmMayAllow: true },
    "the other reading as a parameter");
  eq(opt(M.moveCost(1, P("walk"), { conditions: { afflicted: true }, quickOnly: "blocked" })), ["full"], "the parameter touches teleportation only");
}

/* several moves, reach */
eq(M.movesNeeded(5, P("flight")), { plain: 3, stressed: 2 }, "5 zones flying: 3 moves, or 2 with stress each");
eq(M.movesNeeded(3, P("walk")), { plain: 3, stressed: null }, "on foot");
eq([M.movesNeeded(0, P("walk")).plain, M.movesNeeded(Infinity, P("walk")).plain], [0, null], "nothing to cross, no route");
eq(M.moveReach(P("flight", { tier: "major" })), { plain: 4, stressed: 8 }, "reach of one move");
eq(M.moveReach(P("flight"), { resolve: 0 }), { plain: 2, stressed: 2 }, "reach without Resolve");
eq(M.moveReach(P("flight"), { conditions: { highGravity: true } }), { plain: 0, stressed: 0 }, "reach under high gravity");

/* with a route of the place model */
{
  const g = Z.makeGraph(WORLD.graph);
  const r = Z.routeBetween(g, "a", "b:f2", { aerial: true });
  eq(opt(M.moveCost(r.total, P("flight"))), ["quick", "full"], "a flyer enters floor 2 next door in one move");
  const up = Z.routeBetween(g, "e", "e:elevated");
  eq([up.total, M.moveCost(up.total, P("walk")).reason, M.movesNeeded(up.total, P("walk")).plain], [2, "tooFar", 2], "a walker climbs to the rooftop in two moves");
  ok(Z.routeBetween(g, "a", "b") === null && M.moveCost(null, P("walk")).reason === "noRoute", "no route, no price");
}

/* P3 additions: two more ways of moving, altitude access, Gliding, Teleport Allies */
eq([P("iceSlide").zones, P("iceSlide").stressZones, P("iceSlide").medium], [2, 4, "ground"], "Ice Slide moves like Earth Drift (book 1651)");
eq([P("wings").zones, P("wings").stressZones, P("wings").way, P("wings").ends], [2, null, "air", ["ground", "rooftop", "air"]], "wings of a changed shape: 2 zones, no stress option (book 1956)");
eq(M.altitudeAccess(P("flight"), "sky"), { ok: true, reason: null }, "a flyer reaches sky high");
eq(M.altitudeAccess(P("wings"), "orbit").ok, true, "wings too");
eq(M.altitudeAccess(P("leaping"), "sky"), { ok: false, reason: "needsFlight", gmMayAllow: true }, "a leaper must land (book 2007): not sky high, the GM may allow");
eq(M.altitudeAccess(P("teleportation"), "sky").reason, "needsFlight", "teleportation counts zones: sky high is the GM's word");
eq(M.altitudeAccess(M.moveProfile("vehicle", { speed: 3, aerial: true }), "sky").ok, true, "an aircraft");
eq([M.altitudeAccess(P("walk"), "elevated").reason, M.altitudeAccess(P("leaping"), "elevated").ok, M.altitudeAccess(P("elongatedStride"), "elevated").ok, M.altitudeAccess(P("swinging"), "elevated").ok], ["needsAerial", true, true, true], "elevated: aerial ways and walls climbed (book 1922)");
eq(M.altitudeAccess(P("walk"), "ground").ok, true, "coming down is not asked here");
eq([M.glidingCheck(1, 1).ok, M.glidingCheck(1, 0).ok, M.glidingCheck(0, 1)], [true, true, { ok: false, reason: "glidingUp" }], "Gliding never climbs (book 2004)");
eq([M.teleportAllies(0).stress, M.teleportAllies(1).stress, M.teleportAllies(2).stress, M.teleportAllies(4).stress, M.teleportAllies(5).ok], [0, 0, 1, 3, false], "Teleport Allies: one free, up to three more for a stress each (book 2038)");

done("check-movement");
