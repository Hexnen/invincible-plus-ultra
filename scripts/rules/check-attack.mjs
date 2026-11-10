// node scripts/rules/check-attack.mjs -- stunts, attacks, defences, escapes, banter, help, minions.
import * as S from "./stunts.mjs";
import * as A from "./attack.mjs";
import * as M from "./maneuvers.mjs";
import { buildPool } from "./dice.mjs";
import { ok, eq, throws, done } from "./testkit.mjs";

const opts = (ctx) => Object.fromEntries(S.stuntOptions(ctx).map((o) => [o.id, o.ok ? true : o.reason]));
const base = { target: {}, sharp: true, zoneEmpty: false, otherOpponents: 2, movementLeft: 1 };

// stunt lists per attack
eq(Object.keys(opts({ ...base, attack: "slugfest" })), ["doubleDamage", "knockback", "stun", "bangHeads", "trap", "disarm", "deadlyHit", "special", "own"], "slugfest stunts (book 2433-2442)");
eq(Object.keys(opts({ ...base, attack: "shooting" })), ["doubleDamage", "suppressed", "trickShot", "disarm", "deadlyHit", "special", "own"], "shooting stunts (book 2515-2522)");
eq(Object.keys(opts({ ...base, attack: "charge" })), ["doubleDamage", "slam"], "charge stunts (book 2493)");
eq(Object.keys(opts({ ...base, attack: "grappleAttack" })), ["doubleDamage"], "grapple attack (book 2497)");
eq(Object.keys(opts({ ...base, attack: "grapple" })), [], "first grapple: no stunts (ruling 5)");
eq(Object.keys(opts({ ...base, attack: "snare" })), [], "Snare: no stunts (book 1606)");
eq(Object.keys(opts({ ...base, attack: "counterattack" })).length, 9, "counterattack uses the slugfest list (ruling 4)");
throws(() => S.stuntOptions({ attack: "nope" }), "unknown attack");

// conditions
{
  const huge = opts({ ...base, attack: "slugfest", target: { huge: true } });
  eq([huge.knockback, huge.stun, huge.deadlyHit, huge.doubleDamage, huge.bangHeads], ["huge", "huge", "huge", true, true], "huge creature immunities (book 2501)");
  eq(opts({ ...base, attack: "shooting", target: { huge: true } }).suppressed, "huge", "Suppressed not against huge");
  eq(opts({ ...base, attack: "charge", target: { huge: true } }).slam, "huge", "Slam not against huge");
  eq(opts({ ...base, attack: "slugfest", sharp: false }).deadlyHit, "sharp", "Deadly Hit needs sharp damage");
  eq(opts({ ...base, attack: "slugfest", zoneEmpty: true }).trap, "emptyZone", "no Trap in an empty zone (ruling 20)");
  eq(opts({ ...base, attack: "charge", movementLeft: 0 }).slam, "noMovement", "Slam needs movement left");
  eq(opts({ ...base, attack: "slugfest", otherOpponents: 0 }).bangHeads, "noOtherTarget", "Bang Heads needs another opponent");
  eq(opts({ ...base, attack: "shooting", otherOpponents: 0 }).trickShot, "noOtherTarget", "Trick Shot needs another opponent");
  eq(opts({ ...base, attack: "slugfest", targetHoldsItem: false }).disarm, "noItem", "Disarm needs an item");
  eq(opts({ ...base, attack: "slugfest", chosen: ["doubleDamage"] }).doubleDamage, "chosen", "once per target");
  eq(opts({ ...base, attack: "slugfest", chosen: ["bangHeads"] }).bangHeads, true, "Bang Heads may repeat");
  eq(opts({ ...base, attack: "slugfest", otherOpponents: 1, chosen: ["bangHeads"] }).bangHeads, "noOtherTarget", "one extra opponent = one Bang Heads");
  eq(opts({ ...base, attack: "slugfest", chosen: ["knockback"] }).deadlyHit, "exclusive", "Deadly Hit excludes Knockback");
  eq(opts({ ...base, attack: "slugfest", chosen: ["deadlyHit"] }).bangHeads, "exclusive", "Deadly Hit excludes Bang Heads");
  eq(opts({ ...base, attack: "slugfest", chosen: ["deadlyHit"] }).knockback, "exclusive", "and the other way round");
  eq(opts({ ...base, attack: "shooting", chosen: ["deadlyHit"] }).trickShot, true, "shooting has no such exclusion");
  eq(S.stuntOptions({ ...base, attack: "slugfest" }).find((o) => o.id === "own").gm, true, "own stunts need the GM");
}

// whole selections
{
  const ctxFor = () => ({ ...base, attack: "slugfest" });
  eq(S.validateStunts({ picks: [{ stunt: "doubleDamage", target: "t" }, { stunt: "knockback", target: "t" }], sixes: 3, ctxFor }).ok, true, "book example 2504: two stunts from three sixes");
  eq(S.validateStunts({ picks: [{ stunt: "doubleDamage", target: "t" }, { stunt: "knockback", target: "t" }], sixes: 2, ctxFor }).errors[0].reason, "budget", "more stunts than sixes");
  eq(S.validateStunts({ picks: [{ stunt: "doubleDamage", target: "t" }, { stunt: "doubleDamage", target: "t" }], sixes: 3, ctxFor }).errors[0], { index: 1, reason: "chosen" }, "same stunt twice on one target");
  eq(S.validateStunts({ picks: [{ stunt: "doubleDamage", target: "t" }, { stunt: "doubleDamage", target: "u" }], sixes: 3, ctxFor }).ok, true, "same stunt on two targets");
  eq(S.validateStunts({ picks: [{ stunt: "slam", target: "t" }], sixes: 2, ctxFor }).errors[0].reason, "notOffered", "Slam is not a plain slugfest stunt");
  eq(S.validateStunts({ picks: [], sixes: 0, ctxFor }).ok, true, "nothing chosen");
}
eq([S.knockbackDistance(8), S.knockbackDistance(7), S.bangHeadsDamage(5), S.slamDamage(9), S.trickShotDamage(3)], [4, 4, 3, 5, 3], "half STRENGTH rounded up; Trick Shot = base Damage");
eq(S.stunOutcome({ taken: 0 }), { rollNeeded: false, losesTurn: false }, "no damage, no Stun roll");
eq(S.stunOutcome({ taken: 2, presenceSixes: 0 }).losesTurn, true, "failed PRESENCE roll loses the turn");
eq(S.stunOutcome({ taken: 2, presenceSixes: 1 }).losesTurn, false, "PRESENCE success shrugs it off");
eq([S.fullAutoDice(1), S.fullAutoDice(3)], [0, -2], "full auto: -1 per extra target");

// attack modifiers
const mods = (x) => Object.fromEntries(A.attackModifiers(x).map((m) => [m.source, m.dice]));
eq(mods({ attack: "slugfest", target: { held: true } }), { restrained: 2 }, "+2 against a held target in slugfest");
eq(mods({ attack: "shooting", target: { held: true } }), {}, "no bonus for the shooter (ruling 6)");
eq(mods({ attack: "shooting", target: { unaware: true } }), {}, "book gives the unaware bonus only in slugfest");
eq(mods({ attack: "charge", target: { snared: true } }), { restrained: 2 }, "+2 against a snared target (ruling 21)");
eq(mods({ attack: "slugfest", target: { trapped: true } }), {}, "trapped is not restrained (ruling 20)");
eq(mods({ attack: "slugfest", target: { unaware: true, held: true } }), { restrained: 2 }, "bonus is not doubled");
eq(mods({ attack: "shooting", distance: 0, range: [1, 8], weaponBonus: 1, targets: 3 }), { weapon: 1, minRange: -3, fullAuto: -2 }, "shooting modifiers");
eq(mods({ attack: "slugfest", wreckBonus: 3, helpers: 2, critDice: 2 }), { wreck: 3, help: 2, crit: -2 }, "wreck, help, crit");
eq(buildPool(6, A.attackModifiers({ attack: "grapple", weaponBonus: 0 })).dice, 6, "pool from modifiers");
eq([A.ATTACKS.charge.attr, A.ATTACKS.charge.cost, A.ATTACKS.shooting.attr, A.ATTACKS.ram.attr], ["strength", ["full", "quick"], "agility", "agility"], "attack table");

// defences
const defs = (x) => { const d = A.defenceOptions(x); return [d.block.ok || d.block.reason, d.dodge.ok || d.dodge.reason]; };
eq(defs({ attack: "slugfest" }), [true, "notAllowed"], "slugfest is blocked");
eq(defs({ attack: "shooting" }), ["notAllowed", true], "shooting is dodged");
eq(defs({ attack: "charge" }), ["notAllowed", true], "a charge is dodged, never blocked (book 2492)");
eq(defs({ attack: "grapple" }), [true, "notAllowed"], "a grapple is blocked as usual");
eq(defs({ attack: "grappleAttack" }), ["notAllowed", "notAllowed"], "grapple attack has no defence");
eq(defs({ attack: "counterattack" }), ["notAllowed", "notAllowed"], "counterattack has no defence (ruling 4)");
eq(defs({ attack: "slugfest", defender: { held: true } }), ["held", "notAllowed"], "held: no block (ruling 6)");
eq(defs({ attack: "shooting", defender: { held: true } }), ["notAllowed", "held"], "held: no dodge (ruling 6)");
eq(defs({ attack: "shooting", defender: { snared: true } }), ["notAllowed", "snared"], "snared: no defence (ruling 21)");
eq(defs({ attack: "slugfest", defender: { trapped: true } }), [true, "notAllowed"], "trapped may block (ruling 20)");
eq(defs({ attack: "shooting", defender: { trapped: true } }), ["notAllowed", true], "trapped may dodge (ruling 20)");
eq(defs({ attack: "slugfest", defender: { unaware: true } }), ["unaware", "notAllowed"], "unaware cannot block (book 2430)");
eq(defs({ attack: "shooting", defender: { unaware: true } }), ["notAllowed", "unaware"], "dodge needs awareness (book 2524)");
eq(defs({ attack: "slugfest", defender: { hasQuick: false } }), ["noQuickAction", "notAllowed"], "needs a quick action");
eq(defs({ attack: "shooting", defender: { noInterrupts: true } }), ["notAllowed", "noInterrupts"], "stunned: no interrupts (ruling 10)");
eq(defs({ attack: "shooting", defender: { carriedAloft: true } }), ["notAllowed", "carriedAloft"], "carried aloft (book 2392)");
eq(defs({ attack: "charge", inChase: true }), ["notAllowed", "notAllowed"], "the charge that ends a chase");

// outcomes
eq(A.resolveAttack({ attack: "slugfest", attackSixes: 3 }), { hit: true, net: 3, stunts: 2, counterattack: null, dodgeMove: 0 }, "book example 2504: three sixes, two stunts");
eq(A.resolveAttack({ attack: "slugfest", attackSixes: 0 }).hit, false, "no six, no hit");
eq(A.resolveAttack({ attack: "slugfest", attackSixes: 3, defence: "block", defenceSixes: 1 }), { hit: true, net: 2, stunts: 1, counterattack: null, dodgeMove: 0 }, "block eats sixes");
eq(A.resolveAttack({ attack: "slugfest", attackSixes: 2, defence: "block", defenceSixes: 2 }), { hit: false, net: 0, stunts: 0, counterattack: null, dodgeMove: 0 }, "tie: miss, no counterattack");
eq(A.resolveAttack({ attack: "slugfest", attackSixes: 1, defence: "block", defenceSixes: 4 }).counterattack, { sixes: 3, stunts: 2 }, "ruling 4: first surplus six hits, the rest are stunts");
eq(A.resolveAttack({ attack: "slugfest", attackSixes: 0, defence: "block", defenceSixes: 1 }).counterattack, { sixes: 1, stunts: 0 }, "counterattack with one six");
eq(A.resolveAttack({ attack: "shooting", attackSixes: 1, defence: "dodge", defenceSixes: 3 }), { hit: false, net: 0, stunts: 0, counterattack: null, dodgeMove: 2 }, "dodge move: one zone per six beyond (book 2526)");
eq(A.resolveAttack({ attack: "charge", attackSixes: 1, defence: "dodge", defenceSixes: 2 }).counterattack, null, "a dodge never counterattacks");
eq(A.resolveAttack({ attack: "grapple", attackSixes: 3 }), { hit: true, net: 3, stunts: 0, counterattack: null, dodgeMove: 0 }, "ruling 5: hold only");
eq(A.resolveAttack({ attack: "counterattack", attackSixes: 2 }), { hit: true, net: 2, stunts: 1, counterattack: null, dodgeMove: 0 }, "counterattack hits automatically");

// area / full auto (ruling 14)
{
  const r = A.resolveAreaAttack({ attackSixes: 3, targets: [{ id: "a" }, { id: "b", dodgeSixes: 2 }, { id: "c", dodgeSixes: 3 }, { id: "d", dodgeSixes: 5 }] });
  eq(r.budget, 2, "stunt budget from the attack roll");
  eq(r.targets.map((t) => [t.hit, t.stuntsMax, t.dodgeMove]), [[true, 2, 0], [true, 0, 0], [false, 0, 0], [false, 0, 2]], "each target dodges on its own");
  eq(A.resolveAreaAttack({ attackSixes: 0, targets: [{ id: "a" }] }).anyHit, false, "a failed attack hurts nobody");
}

// charge, grapple
eq(A.chargeCheck({ sameZone: true, hasFull: true, hasQuick: true, moveDistance: 0, moveAllowance: 1 }).reason, "sameZone", "no charge inside one zone (book 2490)");
eq(A.chargeCheck({ sameZone: false, hasFull: true, hasQuick: false, moveDistance: 1, moveAllowance: 1 }).reason, "actions", "charge needs full + quick");
eq(A.chargeCheck({ sameZone: false, hasFull: true, hasQuick: true, moveDistance: 3, moveAllowance: 2 }).reason, "tooFar", "target beyond the move");
eq(A.chargeCheck({ sameZone: false, hasFull: true, hasQuick: true, moveDistance: Infinity, moveAllowance: 4 }).reason, "tooFar", "no route");
eq(A.chargeCheck({ sameZone: false, hasFull: true, hasQuick: true, moveDistance: 1, moveAllowance: 4 }), { ok: true, reason: null, movementLeft: 3 }, "movement left for Slam");
eq(A.chargeEndZone("Z"), "Z", "a dodged charge ends where the target stood (ruling 19)");
eq([A.grappleCheck({ targetHuge: true }).reason, A.grappleCheck({ usesWeapon: true }).reason, A.grappleCheck({}).ok], ["huge", "weapon", true], "grapple legality");

// escapes
eq(M.escapeOutcome({ kind: "grapple", sixes: 2, holderSixes: 1 }).free, true, "break free: more sixes than the holder");
eq(M.escapeOutcome({ kind: "grapple", sixes: 1, holderSixes: 1 }).free, false, "a tie keeps the hold");
eq(M.escapeOutcome({ kind: "trap", sixes: 1, holderSixes: 5 }).free, true, "trap is not opposed");
eq(M.escapeOutcome({ kind: "snare", sixes: 0 }).free, false, "snare: a plain roll");
eq([M.ESCAPES.grapple.action, M.ESCAPES.trap.action, M.ESCAPES.snare.action], ["quick", "quick", "full"], "escape costs (ruling 21: snare is a full action)");
eq(M.ESCAPES.trap.attrs, ["agility", "strength"], "trap: AGILITY or STRENGTH");
eq(M.SNARE_ESCAPE_DICE, { basic: -2, major: -3, massive: -4, monstrous: -5 }, "snare penalties (book 1606-1609)");

// banter (ruling 17)
eq(M.banterCheck({ sameZone: true }).ok, true, "banter in the same zone");
eq(M.banterCheck({ sameZone: false }).reason, "zone", "banter needs the same zone");
eq(M.banterCheck({ sameZone: true, targetBanteredThisRound: true }).reason, "oncePerRound", "once per round per target");
eq(M.banterCheck({ sameZone: true, targetHuge: true }), { ok: false, reason: "huge", gmMayAllow: true }, "typically not against huge creatures");
eq([M.banterStress(3, 1), M.banterStress(1, 1), M.banterStress(0, 2)], [2, 0, 0], "stress = sixes beyond the target's");
eq([M.BANTER.attr, M.BANTER.defenceAttr], ["presence", "presence"], "PRESENCE against PRESENCE");

// orders, help
eq(M.ordersBonus(3), 3, "+1 die per six");
{
  const h = M.helpCheck({ helpers: [{ id: "a" }, { id: "b", hasFull: false }, { id: "c" }, { id: "d" }, { id: "e" }] });
  eq([h.dice, h.accepted], [3, ["a", "c", "d"]], "three helpers at most");
  eq(h.refused, [{ id: "b", reason: "noFullAction", gmMayAllow: true }, { id: "e", reason: "tooMany", gmMayAllow: false }], "ruling 11: refused without a full action, GM may allow");
}

// fastball, carrying
eq(M.fastballCheck({ throwerStrength: 9, thrownStrength: 4 }), { ok: true, reason: null, zones: 5 }, "thrown the STRENGTH difference");
eq(M.fastballCheck({ throwerStrength: 5, thrownStrength: 5 }).reason, "strength", "needs lower STRENGTH");
eq(M.carryCheck({ canFly: true }).ok, true, "a flyer carries one");
eq([M.carryCheck({ canFly: false }).reason, M.carryCheck({ canFly: true, alreadyCarrying: true }).reason, M.carryCheck({ canFly: true, charging: true }).reason], ["cannotFly", "oneOnly", "charge"], "carry limits");
eq([M.carryEndsAloft("elevated"), M.carryEndsAloft("ground")], [true, false], "aloft after an airborne end");

// minions
eq(M.minionAttacks(6), [{ members: 6, helpDice: 5 }], "six minions: +5");
eq(M.minionAttacks(10), [{ members: 10, helpDice: 9 }], "ten minions: +9");
eq(M.minionAttacks(13), [{ members: 10, helpDice: 9 }, { members: 3, helpDice: 2 }], "more than ten: a second attack");
eq(M.minionAttacks(0), [], "nobody left");
eq([M.splitMinions(8), M.splitMinions(10), M.splitMinions(11), M.splitMinions(25)], [[8], [10], [6, 5], [9, 8, 8]], "large numbers are divided (ruling 24)");
eq(M.minionDamage({ members: 5, taken: 2 }), { members: 3, removed: 2, wiped: false }, "one minion per point of damage");
eq(M.minionDamage({ members: 2, taken: 6 }).wiped, true, "group wiped out");

// immunity flags instead of one "huge" boolean (book 2499-2503 huge creature, 1975 grown hero, 1888 Impervious)
{
  eq(S.immunitiesOf({ huge: true }).sort(), ["banter", "deadlyHit", "grapple", "knockback", "slam", "stun", "suppressed"], "huge creature: five stunts, grappling, banter");
  eq(S.immunitiesOf({ grown: true }).sort(), ["grapple", "knockback", "slam"], "grown hero: only what Size Alteration lists (book 1975)");
  eq(S.immunitiesOf({ impervious: true }), ["deadlyHit"], "Impervious: Deadly Hit (book 1888)");
  eq(S.immunitiesOf({ immune: ["trap"], grown: true }).sort(), ["grapple", "knockback", "slam", "trap"], "single ids add to a set");
  eq(S.immunitiesOf({}), [], "an ordinary target has none");
  eq([S.isImmune({ grown: true }, "slam"), S.isImmune({ grown: true }, "stun"), S.isImmune(undefined, "stun")], [true, false, false], "isImmune");
  const grown = opts({ ...base, attack: "slugfest", target: { grown: true } });
  eq([grown.knockback, grown.stun, grown.deadlyHit, grown.doubleDamage], ["immune", true, true, true], "a grown hero can still be stunned and take a Deadly Hit");
  eq(opts({ ...base, attack: "charge", target: { grown: true } }).slam, "immune", "no Slam on a grown hero");
  eq(opts({ ...base, attack: "shooting", target: { grown: true } }).suppressed, true, "Suppressed works on a grown hero");
  eq(opts({ ...base, attack: "shooting", target: { impervious: true } }).deadlyHit, "immune", "Impervious blocks Deadly Hit");
  eq(opts({ ...base, attack: "slugfest", target: { huge: true } }).knockback, "huge", "a huge creature keeps the reason huge");
  eq([S.reachesElevated({ huge: true }), S.reachesElevated({ grown: true }), S.reachesElevated({ reachesElevated: true }), S.reachesElevated({})], [true, true, true, false], "who reaches elevated targets (book 2500, 1975, 2429)");
  eq(A.grappleCheck({ target: { grown: true } }), { ok: false, reason: "immune" }, "a grown hero cannot be grappled (book 1975)");
  eq(A.grappleCheck({ target: { huge: true } }).reason, "huge", "target.huge = targetHuge");
  eq(A.grappleCheck({ target: { impervious: true } }).ok, true, "Impervious does not stop a grapple");
  eq(M.banterCheck({ sameZone: true, target: { grown: true } }).ok, true, "a grown hero is not immune to banter");
  eq(M.banterCheck({ sameZone: true, target: { huge: true } }), { ok: false, reason: "huge", gmMayAllow: true }, "target.huge = targetHuge for banter");
  eq(M.banterCheck({ sameZone: true, target: { immune: ["banter"] } }), { ok: false, reason: "immune", gmMayAllow: true }, "banter immunity by flag");
}

// per-target stunt cap of area and full-auto attacks inside validateStunts (ruling 14, reading 10)
{
  const ctxFor = () => ({ ...base, attack: "shooting" });
  // 4 sixes: budget 3. a did not dodge (net 4, cap 3), b cancelled two (net 2, cap 1), c cancelled three (net 1, cap 0), d dodged all
  const area = A.resolveAreaAttack({ attackSixes: 4, targets: [{ id: "a" }, { id: "b", dodgeSixes: 2 }, { id: "c", dodgeSixes: 3 }, { id: "d", dodgeSixes: 4 }] });
  eq(area.targets.map((t) => t.stuntsMax), [3, 1, 0, 0], "caps from the dodges");
  const v = (picks) => S.validateStunts({ picks, sixes: 4, ctxFor, targets: area.targets });
  eq(v([{ stunt: "doubleDamage", target: "a" }, { stunt: "suppressed", target: "a" }, { stunt: "doubleDamage", target: "b" }]).ok, true, "three stunts spread within the caps");
  eq(v([{ stunt: "doubleDamage", target: "b" }, { stunt: "suppressed", target: "b" }]).errors, [{ index: 1, reason: "targetBudget" }], "b has one six left for stunts");
  eq(v([{ stunt: "doubleDamage", target: "c" }]).errors, [{ index: 0, reason: "targetBudget" }], "c was hit by the last six: no stunt");
  eq(v([{ stunt: "doubleDamage", target: "d" }]).errors, [{ index: 0, reason: "notHit" }], "d dodged everything");
  eq(v([{ stunt: "doubleDamage", target: "zz" }]).errors, [{ index: 0, reason: "notHit" }], "a target that is not on the list");
  eq(v([{ stunt: "doubleDamage", target: "a" }, { stunt: "suppressed", target: "a" }, { stunt: "disarm", target: "a" }, { stunt: "doubleDamage", target: "b" }]).errors, [{ index: 3, reason: "budget" }], "the shared pool still limits the total");
  eq(v([{ stunt: "doubleDamage", target: "a" }, { stunt: "doubleDamage", target: "b" }]).perTarget, { a: { used: 1, max: 3 }, b: { used: 1, max: 1 } }, "per-target usage is reported");
  eq(S.validateStunts({ picks: [{ stunt: "doubleDamage", target: "b" }, { stunt: "suppressed", target: "b" }], sixes: 4, ctxFor }).ok, true, "without the list only the total is checked (as before)");
  eq(S.validateStunts({ picks: [{ stunt: "doubleDamage", target: "t" }], sixes: 2, ctxFor }).perTarget, { t: { used: 1, max: null } }, "no cap without the list");
}

// help dice per helper (book 2238, 2167 Supportive)
{
  const h = M.helpCheck({ helpers: [{ id: "a", supportive: true }, { id: "b" }, { id: "c", supportive: true }, { id: "d", supportive: true }] });
  eq([h.dice, h.accepted], [5, ["a", "b", "c"]], "two Supportive helpers and a plain one: +5; the fourth is refused");
  eq(h.perHelper, [{ id: "a", dice: 2 }, { id: "b", dice: 1 }, { id: "c", dice: 2 }], "dice per helper");
  eq(M.helpCheck({ helpers: [{ id: "a" }, { id: "b" }] }).perHelper, [{ id: "a", dice: 1 }, { id: "b", dice: 1 }], "plain helpers give one die each");
  eq(M.helpCheck({ helpers: [{ id: "a", supportive: true, hasFull: false }] }).dice, 0, "a refused Supportive helper gives nothing");
}

done("check-attack");
