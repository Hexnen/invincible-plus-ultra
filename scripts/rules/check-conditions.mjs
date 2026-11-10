// node scripts/rules/check-conditions.mjs -- the evaluator of the catalog's predicates (Cond) and conditional modifiers (ModRule).
import * as C from "./conditions.mjs";
import * as D from "./dice.mjs";
import * as S from "./stunts.mjs";
import * as Z from "./zones.mjs";
import { ok, eq, throws, done } from "./testkit.mjs";

const snap = {
  actor: { id: "hero", strength: 6, resolve: 2, statuses: ["grown", "burning"], talents: ["hardHitter", "charger"], huge: false,
    history: { movedLastTurn: false, attackedLastTurn: false, movedThisRound: true }, round: { quickSacrificed: true, helpers: 2 } },
  target: { id: "beast", huge: true, conductive: false, strength: 9, zone: "b" },
  zone: { id: "a", tags: ["electric"], fire: 0 },
};
const E = (cond, opts) => C.evalCond(cond, snap, opts);
const PASS = { ok: true, reason: null, gmMayAllow: false, needsGm: [] };

/* facts */
eq(C.factOf(snap, "actor.history.movedLastTurn"), false, "a fact by path");
eq([C.factOf(snap, "actor.statuses.1"), C.factOf(snap, "actor.nope.deeper"), C.factOf(snap, "actor.statuses.length"), C.factOf(snap, "actor.constructor")], ["burning", undefined, 2, undefined], "list index and length; missing steps and inherited properties are undefined");
eq([E(true), E(null)], [PASS, PASS], "true and no condition hold");
eq(E(false), { ok: false, reason: "never", gmMayAllow: false, needsGm: [] }, "false never holds");
eq(E({ fact: "target.huge" }), PASS, "a truthy fact");
eq(E({ fact: "target.conductive" }), { ok: false, reason: "target.conductive", gmMayAllow: false, needsGm: [] }, "a failing fact names its path");
eq(E({ fact: "target.conductive", reason: "notConductive", gmMayAllow: true }), { ok: false, reason: "notConductive", gmMayAllow: true, needsGm: [] }, "own reason and gmMayAllow");
eq([E({ fact: "actor.history.movedLastTurn", op: "falsy" }).ok, E({ fact: "actor.missing", op: "falsy" }).ok, E({ fact: "actor.missing" }).ok], [true, true, false], "falsy; a missing fact");
eq([E({ fact: "actor.strength", value: 6 }).ok, E({ fact: "actor.strength", op: "ne", value: 6 }).ok, E({ fact: "actor.strength", op: "gt", value: 5 }).ok, E({ fact: "actor.strength", op: "gte", value: 7 }).ok,
  E({ fact: "actor.strength", op: "lt", ref: "target.strength" }).ok, E({ fact: "actor.strength", op: "lte", value: 6 }).ok], [true, false, true, false, true, true], "comparisons, against a value or another fact");
eq([E({ fact: "actor.missing", op: "lt", value: 3 }).ok, E({ fact: "actor.missing", op: "gte", value: 0 }).ok], [false, false], "a missing fact fails every comparison");
eq([E({ fact: "target.zone", op: "in", value: ["a", "b"] }).ok, E({ fact: "actor.statuses", op: "has", value: "grown" }).ok, E({ fact: "actor.statuses", op: "has", value: "shrunk" }).ok, E({ fact: "actor.strength", op: "has", value: 6 }).ok],
  [true, true, false, false], "in and has");
throws(() => E({ fact: "actor.strength", op: "almost", value: 6 }), "an unknown op");
throws(() => E("actor.strength"), "a string is not a condition");
throws(() => E({ nothing: 1 }), "an object of no kind");

/* combinations */
eq(E([{ fact: "target.huge" }, { fact: "actor.strength", op: "gte", value: 6 }]), PASS, "a list: all");
eq(E({ all: [{ fact: "target.huge" }, { fact: "target.conductive" }, { fact: "actor.huge" }] }).reason, "target.conductive", "all: the first failure speaks");
eq(E({ all: [{ fact: "target.conductive" }], reason: "noGood" }).reason, "noGood", "all: own reason");
eq(E({ any: [{ fact: "target.conductive" }, { fact: "target.huge" }] }), PASS, "any");
eq(E({ any: [{ fact: "target.conductive" }, { fact: "actor.huge", gmMayAllow: true }] }), { ok: false, reason: "target.conductive", gmMayAllow: true, needsGm: [] }, "any: fails with the first reason; the GM may allow when one branch says so");
eq([E({ any: [] }).reason, E({ all: [] }).ok, E([]).ok], ["none", true, true], "empty any fails, empty all holds");
eq([E({ not: { fact: "target.conductive" } }).ok, E({ not: { fact: "target.huge" } }).reason, E({ not: { fact: "target.huge" }, reason: "hugeTarget" }).reason], [true, "not", "hugeTarget"], "not");

/* the caller's checks: how a catalog entry names a check of this library */
{
  const g = Z.makeGraph({ zones: [{ id: "a" }, { id: "b" }, { id: "c" }], borders: [{ a: "a", b: "b" }, { a: "b", b: "c" }] });
  const checks = {
    inRange: ({ from, to, range }) => Z.canShoot(g, from, to, range),
    notImmune: ({ target, what }) => !S.isImmune(target, what),
    broken: () => "yes",
  };
  eq(E({ check: "inRange", args: { from: { ref: "zone.id" }, to: { ref: "target.zone" }, range: [0, 1] } }, { checks }), PASS, "a check with arguments read from the snapshot");
  eq(E({ check: "inRange", args: { from: "a", to: "c", range: [0, 1] } }, { checks }), { ok: false, reason: "tooFar", gmMayAllow: false, needsGm: [] }, "the check's own reason comes through");
  eq(E({ check: "inRange", args: { from: "a", to: "c", range: [0, 1] }, reason: "outOfReach" }, { checks }).reason, "outOfReach", "or the condition's");
  eq(E({ check: "notImmune", args: { target: { ref: "target" }, what: "knockback" } }, { checks }), { ok: false, reason: "notImmune", gmMayAllow: false, needsGm: [] }, "a boolean check: a huge target is immune to Knockback (book 2500)");
  eq(E({ check: "notImmune", args: { target: { ref: "actor" }, what: "knockback" } }, { checks }).ok, true, "and the hero is not");
  eq(E({ check: "lineOfSight" }, { checks }), { ok: false, reason: "unknownCheck", gmMayAllow: true, needsGm: ["check:lineOfSight"] }, "a check nobody supplied goes to the GM (spec 8)");
  throws(() => E({ check: "broken" }, { checks }), "a check must answer a boolean or a result");
}

/* GM-confirmed conditions */
eq(E({ gm: "electricityNearby" }), { ok: false, reason: "electricityNearby", gmMayAllow: true, needsGm: ["electricityNearby"] }, "unconfirmed: asks the GM");
eq([E({ gm: "x" }, { confirmed: new Set(["x"]) }).ok, E({ gm: "x" }, { confirmed: ["x"] }).ok, E({ gm: "x" }, { confirmed: { x: true } }).ok, E({ gm: "x" }, { confirmed: { x: false } }).ok, E({ gm: "x" }, { confirmed: { toString: true } }).ok],
  [true, true, true, false, false], "confirmed as a Set, a list or an object");
eq(E({ all: [{ gm: "x" }, { gm: "y" }, { gm: "x" }] }).needsGm, ["x", "y"], "every unconfirmed id is listed once");
eq(E({ any: [{ gm: "x" }, { gm: "y" }] }, { confirmed: ["y"] }).ok, true, "any with one confirmed");
{
  const conds = [{ fact: "target.huge" }, { gm: "x" }];
  const r = C.evalConds(conds, snap);
  eq([r.ok, r.reason, r.gmMayAllow, r.needsGm, r.failed.length], [false, "x", true, ["x"], 1], "evalConds: the list of a catalog entry");
  eq(C.onlyNeedsGm(conds, snap), true, "only the GM's word is missing");
  eq(C.onlyNeedsGm([{ fact: "target.conductive" }, { gm: "x" }], snap), false, "a hard failure beside it");
  eq(C.onlyNeedsGm([{ any: [{ fact: "target.conductive" }, { gm: "x" }] }], snap), true, "inside any");
  eq(C.onlyNeedsGm([{ check: "nobody" }], snap), true, "an unknown check counts as the GM's to decide");
  eq(C.onlyNeedsGm([{ gm: "x" }, { gm: "y" }], snap, { confirmed: { y: true } }), true, "with part already confirmed");
  eq(C.onlyNeedsGm([{ fact: "target.huge" }], snap), false, "nothing to ask when it holds");
  eq(C.evalConds([], snap), { ...PASS, failed: [] }, "no conditions");
  eq(C.evalConds([{ fact: "target.conductive" }, { fact: "actor.huge" }], snap).failed.map((f) => f.reason), ["target.conductive", "actor.huge"], "every failure is reported for the greyed option");
}

/* the rule texts the grammar was written for */
eq(E({ any: [{ fact: "zone.tags", op: "has", value: "electric" }, { gm: "electricityAdjacent" }] }).ok, true, "book 1680: electrical energy in the own zone (the adjacent one would ask the GM)");
eq(E({ all: [{ fact: "actor.history.movedLastTurn", op: "falsy" }, { fact: "actor.history.attackedLastTurn", op: "falsy" }] }).ok, true, "book 1903: did not move or attack on the previous turn");
eq(E({ fact: "actor.history.movedThisRound", op: "falsy", reason: "moved" }).reason, "moved", "book 2545: no movement in the round of firing");

/* conditional modifiers */
{
  const rules = [
    { source: "biggerTheyAre", dice: 2, when: { fact: "target.huge" }, rolls: ["slugfest"] },                 // book 2098
    { source: "hardHitter", dice: 2, when: { fact: "actor.round.quickSacrificed" }, rolls: ["slugfest"] },    // book 2116
    { source: "charger", dice: 2, attrs: ["strength"], rolls: ["charge"] },                                   // book 2099
    { source: "evasive", dice: 2, attrs: ["agility"], rolls: ["dodge"] },                                     // book 2111
    { source: "conductive", dice: 2, when: { fact: "target.conductive" } },                                    // book 1680
    { source: "help", dice: { ref: "actor.round.helpers", max: 3 } },                                          // a number read from the snapshot
    { source: "cover", dice: -2, when: { gm: "targetInCover" } },
    { source: "zero", dice: 0 }, null,
  ];
  eq(C.modRules(rules, snap, { attr: "fighting", roll: "slugfest" }), [{ source: "biggerTheyAre", dice: 2 }, { source: "hardHitter", dice: 2 }, { source: "help", dice: 2 }], "a slugfest attack against a huge creature");
  eq(C.modRules(rules, snap, { attr: "strength", roll: "charge" }).map((m) => m.source), ["charger", "help"], "a charge");
  eq(C.modRules(rules, snap, { attr: "agility", roll: "dodge" }).map((m) => m.source), ["evasive", "help"], "a dodge");
  eq(C.modRules(rules, snap, { attr: "fighting", roll: "dodge" }).map((m) => m.source), ["help"], "attribute and kind of roll must both fit");
  const r = C.evalModRules(rules, snap, { attr: "fighting", roll: "slugfest" });
  eq(r.pending, [{ source: "cover", dice: -2, needsGm: ["targetInCover"], reason: "targetInCover" }], "a modifier that waits for the GM's word");
  eq(C.modRules(rules, snap, { attr: "fighting", roll: "slugfest", confirmed: ["targetInCover"] }).map((m) => m.source), ["biggerTheyAre", "hardHitter", "help", "cover"], "confirmed: it applies");
  eq(D.buildPool(5, C.modRules(rules, snap, { attr: "fighting", roll: "slugfest", confirmed: ["targetInCover"] })).dice, 9, "the list feeds dice.buildPool (book 2235)");
  eq(C.modRules([{ source: "h", dice: { ref: "actor.round.helpers", times: 2, max: 3 } }, { source: "m", dice: { ref: "actor.missing" } }, { source: "s", dice: { ref: "actor.resolve", times: -1, min: -1 } }], snap),
    [{ source: "h", dice: 3 }, { source: "s", dice: -1 }], "dice read from the snapshot: factor, clamps, a missing fact gives nothing");
  eq(C.evalModRules(undefined, snap), { mods: [], pending: [] }, "no rules");
}

/* shape check for the catalog's load */
eq(C.validateCond([true, { fact: "a.b" }, { any: [{ gm: "x" }, { not: { check: "c" } }] }, { fact: "a", op: "gte", ref: "b" }]), [], "well formed");
eq(C.validateCond([{ fact: "a", op: "almost" }, { all: 3 }, { fact: "a", gm: "x" }, "x", { fact: "a", op: "gt" }, { fact: "a", value: 1, ref: "b" }, { gm: "" }, { any: [{ check: 5 }] }]).length, 8, "every fault is reported with its place");
eq(C.validateCond({ any: [{ check: 5 }] }, "requires[2]"), ["requires[2].any[0].check: not a name"], "the place of a fault");
ok(C.COND_OPS.includes("has") && C.COND_OPS.length === 10, "the ops are listed");

done("check-conditions");
