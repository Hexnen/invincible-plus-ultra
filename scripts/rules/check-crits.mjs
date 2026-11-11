// node scripts/rules/check-crits.mjs -- critical injuries, broken, rallying, armor, damage, stress, recovery.
import * as C from "./crits.mjs";
import * as D from "./damage.mjs";
import { ok, eq, done } from "./testkit.mjs";

// table shape (book 2716-2767)
eq(C.CRIT_TABLE.length, 14, "13 rows");
eq(C.CRIT_TABLE.slice(1).map((e) => e.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], "rows numbered");
eq(C.CRIT_TABLE[8].pen, { fighting: 1, agility: 1, strength: 1 }, "crushed leg is -1");
eq(C.CRIT_TABLE[3].pen, { reason: 2, intuition: 2, presence: 2 }, "bloodied hits the mental attributes");
eq(Object.keys(C.CRIT_TABLE[11].pen).length, 6, "skewered hits every attribute");
eq(C.CRIT_TABLE.slice(1).map((e) => e.heal), [null, "hours", "hours", "days", "days", "weeks", "weeks", "weeks", "weeks", "months", "months", null, null], "healing times");

// resolveCrit (book 2707-2709)
eq(C.resolveCrit({ d6: 1, bonus: 4 }).n, 5, "book example 2792: 1 + 4 = concussed");
eq(C.resolveCrit({ d6: 3, prior: [6] }), { roll: 4, n: 7, entry: C.CRIT_TABLE[7], shifted: true }, "book example 2709: battered, 3 -> 4 -> crushed arm");
eq(C.resolveCrit({ d6: 5, prior: [2, 4] }).n, 7, "+1 per previous crit");
eq(C.resolveCrit({ d6: 2, prior: [2, 4] }).n, 5, "equal to the worst = one step worse");
eq(C.resolveCrit({ d6: 6, bonus: 9 }).n, 13, "13+ is the last row");
eq(C.resolveCrit({ d6: 6, bonus: 9, cap: C.FAMILY_CAP }).n, 9, "family-friendly cap (book 2769)");
eq(C.resolveCrit({ d6: 1, prior: [9], cap: C.FAMILY_CAP }).n, 9, "cap also holds a shifted result");
eq(C.resolveCrit({ d6: 1, prior: [13] }).n, 13, "nothing beyond 13");
eq([C.deadlyHitBonus(3), C.deadlyHitBonus(9), C.deadlyHitBonus(0)], [3, 6, 0], "Deadly Hit bonus caps at +6");

// critForHit
const hero = { kind: "hero" };
eq(C.critForHit({ taken: 7, healthBefore: 3, target: hero }), { broken: true, newlyBroken: true, crit: { bonus: 4, cause: "broken" }, gmChoice: false }, "book example 2792: excess 4");
eq(C.critForHit({ taken: 3, healthBefore: 3, target: hero }).crit, { bonus: 0, cause: "broken" }, "exactly to zero: no bonus");
eq(C.critForHit({ taken: 2, healthBefore: 3, target: hero }).crit, null, "not broken, no crit");
eq(C.critForHit({ taken: 0, healthBefore: 0, target: hero }).crit, null, "no damage while broken, no crit");
eq(C.critForHit({ taken: 1, healthBefore: 0, target: hero }).crit, { bonus: 1, cause: "whileBroken" }, "book 2708: one point while broken");
eq(C.critForHit({ taken: 2, healthBefore: 5, deadlyHit: true, target: hero }).crit, { bonus: 2, cause: "deadlyHit" }, "Deadly Hit without breaking");
eq(C.critForHit({ taken: 0, healthBefore: 5, deadlyHit: true, target: hero }).crit, null, "Deadly Hit needs damage");
eq(C.critForHit({ taken: 5, healthBefore: 4, deadlyHit: true, target: hero }).crit, { bonus: 5, cause: "deadlyHit" }, "ruling 9: one roll, the higher bonus (deadly)");
eq(C.critForHit({ taken: 12, healthBefore: 2, deadlyHit: true, target: hero }).crit, { bonus: 10, cause: "broken" }, "ruling 9: one roll, the higher bonus (excess)");
eq(C.critForHit({ taken: 4, healthBefore: 9, deadlyHit: true, target: { kind: "hero", huge: true } }).crit, null, "no Deadly Hit against huge creatures");
eq(C.critForHit({ taken: 9, healthBefore: 2, target: { kind: "npc" } }), { broken: true, newlyBroken: true, crit: null, gmChoice: true }, "ordinary NPC: GM states the result (book 2771)");
eq(C.critForHit({ taken: 9, healthBefore: 2, target: { kind: "majorNpc" } }).crit, { bonus: 7, cause: "broken" }, "major NPC rolls like a hero");
eq(C.critForHit({ taken: 9, healthBefore: 2, target: { kind: "minions" } }).crit, null, "minions never crit (book 2828)");
eq(C.critForHit({ taken: 9, healthBefore: 2, target: { kind: "vehicle" } }).crit, null, "vehicles never crit (book 3222)");
eq(C.critForHit({ taken: 3, healthBefore: 9, deadlyHit: true, target: { impervious: true } }).crit, null, "Impervious: no Deadly Hit crit (book 1888)");
eq(C.critForHit({ taken: 3, healthBefore: 9, deadlyHit: true, target: { grown: true } }).crit, { bonus: 3, cause: "deadlyHit" }, "a grown hero is not immune to Deadly Hit (book 1975)");
eq(C.critForHit({ taken: 3, healthBefore: 9, deadlyHit: true, target: { immune: ["deadlyHit"] } }).crit, null, "Deadly Hit immunity by flag");

// penalties and states
eq(C.critPenalty([2, 4, 6], "strength"), 2, "same attribute: worst only, not cumulative");
eq(C.critPenalty([8], "agility"), 1, "crushed leg -1");
eq(C.critPenalty([8, 2], "agility"), 2, "worst of -1 and -2");
eq(C.critPenalty([3], "strength"), 0, "mental crit does not touch physical rolls");
eq(C.critPenalty([9], "reason"), 0, "deferred penalty is off while unconscious");
eq(C.critPenalty([9], "reason", { includeDeferred: true }), 2, "deferred penalty after recovery");
eq(C.critState([8]), { unconscious: false, dying: null, dead: false, canRally: true, groundMoveFullAction: true, armUnusable: false }, "crushed leg state");
eq(C.critState([9]).unconscious, true, "cracked skull knocks out");
eq([C.critState([10]).dying, C.critState([11]).dying, C.critState([10, 11]).dying], ["hours", "minutes", "minutes"], "dying clocks");
eq(C.critState([12]).dead && C.critState([13]).dead, true, "12 and 13 are dead");
eq([C.critState([8]).canRally, C.critState([9]).canRally, C.critState([10]).canRally], [true, false, false], "no rally with 9+");

// rally / stabilise
eq(C.canRally({ broken: false }).reason, "notBroken", "rally only when broken");
eq(C.canRally({ broken: true, crits: [4, 9] }).reason, "crit", "no rally with a cracked skull");
eq(C.canRally({ broken: true, crits: [7] }).ok, true, "rally with a crushed arm");
eq([C.canRally({ broken: true, primaryCopy: true }).reason, C.canRally({ broken: false, primaryCopy: true }).reason], ["copy", "notBroken"], "book 1915: the killed primary copy of Sequestered Original is not rallied");
eq(C.rallyOutcome({ sixes: 2, maxHealth: 8 }), { rallied: true, health: 2 }, "1 Health per six");
eq(C.rallyOutcome({ sixes: 0, maxHealth: 8 }).rallied, false, "failed rally");
eq(C.canStabilize({ crits: [10], hasGear: true }).ok, true, "stabilise with gear");
eq(C.canStabilize({ crits: [10] }).reason, "gear", "needs medical gear");
eq(C.canStabilize({ crits: [10], power: true }).ok, true, "or a power");
eq(C.canStabilize({ crits: [11], hasGear: true, attempted: true }).reason, "alreadyTried", "one attempt only");
eq(C.canStabilize({ crits: [6], hasGear: true }).reason, "notDying", "nothing to stabilise");
eq(C.stabilizeOutcome(1).stabilized, true, "stabilised on a success");

// armor (book 2682, ruling 13)
eq(D.selectArmor([{ id: "vest", armor: 1 }, { id: "protection", armor: 3 }]).armor, 3, "only the best armor counts");
eq(D.selectArmor([]).armor, 0, "no armor");
eq(D.selectArmor([{ id: "barrier", armor: 3, barrier: true }, { id: "protection", armor: 2 }]).source.id, "barrier", "Barrier higher than own Armor");
eq(D.selectArmor([{ id: "barrier", armor: 3, barrier: true }, { id: "protection", armor: 3 }]).source.id, "protection", "tie: the shield is not spent");
eq([D.barrierBreached({ barrier: true }, 2), D.barrierBreached({ barrier: true }, 0), D.barrierBreached({ barrier: false }, 5)], [true, false, false], "Barrier ends when breached once");
eq(Object.values(D.BODY_ARMOR).map((a) => a.armor), [1, 2, 2], "body armor ratings");

// damage (book 2434, 2504, 2528, 2792)
eq(D.hitDamage({ base: 4, doubled: true, armor: 2 }).taken, 6, "book example 2504: 4 doubled to 8, Armor 2 = 6");
eq(D.hitDamage({ base: 3, doubled: true, armor: 2 }).taken, 4, "book example 2528: 3 doubled, Armor 2 = 4");
eq(D.hitDamage({ base: 10, armor: 3 }).taken, 7, "book example 2792: 10 - Armor 3");
eq(D.hitDamage({ base: 2, armor: 5 }).taken, 0, "armor can stop everything");
eq(D.hitDamage({ base: 4, pulled: 1 }).taken, 1, "pulling the punch (book 2427)");
eq(D.hitDamage({ base: 4, pulled: 9 }).raw, 4, "cannot pull upwards");
eq(D.hitDamage({ base: 4, armor: 3, ignoreArmor: true }).taken, 4, "armor has no effect");
eq(D.hitDamage({ base: 4, armor: 3, source: "fire", immunities: ["fire"] }), { raw: 4, armor: 0, taken: 0, immune: true, vulnerable: false }, "immunity (book 1877)");
eq(D.hitDamage({ base: 4, armor: 3, source: "kinetic", immunities: ["nonKinetic"] }).taken, 1, "Full Immunity does not stop fists");
eq(D.hitDamage({ base: 4, armor: 3, source: "electricity", immunities: ["nonKinetic"] }).taken, 0, "Full Immunity stops non-kinetic sources");
eq(D.hitDamage({ base: 3, armor: 3, source: "fire", vulnerabilities: ["fire"] }).taken, 6, "Vulnerable: doubled, armor has no effect (book 2193)");

// Health / Resolve
eq(D.baseHealth({ fighting: 6, agility: 5, strength: 8 }), 10, "Health = half of FIG+AGI+STR rounded up");
eq(D.baseResolve({ reason: 3, intuition: 3, presence: 5 }), 6, "Resolve = half of REA+INT+PRE rounded up");
eq(D.applyDamage({ health: 3, taken: 7 }), { health: 0, broken: true, newlyBroken: true, excess: 4 }, "broken with excess");
eq(D.applyDamage({ health: 0, taken: 2 }), { health: 0, broken: true, newlyBroken: false, excess: 0 }, "no negative Health");
eq(D.applyDamage({ health: 5, taken: 2 }).health, 3, "plain damage");
eq(D.applyStress({ resolve: 2, stress: 5 }), { resolve: 0, lost: 2, stressedOut: true }, "no negative Resolve");
eq(D.applyStress({ resolve: 6, stress: 5 }).stressedOut, false, "still has Resolve");
eq([D.canTakeVoluntaryStress(0), D.canTakeVoluntaryStress(1)], [false, true], "no voluntary stress when stressed out");
eq(D.recoverResolve({ resolve: 1, max: 6, sixes: 2 }), { resolve: 3, gain: 2 }, "book example 2821");
eq(D.recoverResolve({ resolve: 5, max: 6, sixes: 4 }).resolve, 6, "not above the maximum");
eq(D.recoverAfterScene({ health: 1, maxHealth: 10, resolve: 0, maxResolve: 6, strength: 4, presence: 3 }), { health: 5, resolve: 0 }, "a few minutes: Health +STRENGTH, Resolve untouched by default (book 2802-2804, 2819)");
eq(D.recoverAfterScene({ health: 1, maxHealth: 10, resolve: 0, maxResolve: 6, strength: 4, presence: 3, socialScene: true }), { health: 5, resolve: 3 }, "a few minutes with a social scene: Resolve +PRESENCE");
eq(D.recoverAfterScene({ health: 1, maxHealth: 10, resolve: 0, maxResolve: 6, strength: 4, presence: 3, span: "hours" }), { health: 10, resolve: 0 }, "a few hours of rest without a social scene: Health only");
eq(D.recoverAfterScene({ health: 1, maxHealth: 10, resolve: 0, maxResolve: 6, strength: 4, presence: 3, span: "hours", socialScene: true }), { health: 10, resolve: 6 }, "a few hours with a social scene");
eq(D.recoverAfterScene({ health: 1, maxHealth: 10, resolve: 2, maxResolve: 6, strength: 14, presence: 3, socialScene: false }), { health: 10, resolve: 2 }, "no social scene, Health capped");
eq(D.recoverAfterScene({ health: 1, maxHealth: 10, resolve: 1, maxResolve: 6, strength: 4, presence: 3, loner: true }), { health: 5, resolve: 4 }, "Loner recovers Resolve without a social scene (book 2148)");
eq(D.recoverAfterScene({ health: 1, maxHealth: 10, resolve: 1, maxResolve: 6, strength: 2, presence: 3, regeneration: true }), { health: 10, resolve: 1 }, "Regeneration heals everything in a few minutes (book 1893)");
eq(D.recoverAfterScene({ health: 9, maxHealth: 10, resolve: 9, maxResolve: 6, strength: 1, presence: 3 }), { health: 10, resolve: 6 }, "Resolve above the maximum dissipates (book 1686)");

// armor by damage type and stress armor (book 1920, 1865)
{
  const plast = { id: "plasticity", armor: 3, only: ["kinetic"] }, vest = { id: "vest", armor: 1 }, defiance = { id: "defiance", armor: 3, stress: true };
  eq(D.selectArmor([plast, vest]).armor, 3, "Plasticity against fists and bullets");
  eq(D.selectArmor([plast, vest], { source: "fire" }).source.id, "vest", "Plasticity does not count against fire: the vest does");
  eq(D.selectArmor([plast], { source: "electricity" }), { armor: 0, source: null }, "no armor left");
  eq(D.selectArmor([defiance, vest]).source.id, "vest", "stress armor does not count against ordinary damage");
  eq(D.selectArmor([defiance, vest], { toStress: true }).source.id, "defiance", "against a stress attack the better of the two counts");
  eq(D.selectArmor([{ id: "prot", armor: 4 }, defiance], { toStress: true }).source.id, "prot", "ordinary armor also stops a stress attack (book 1591)");
}
eq([D.halvedArmor(3), D.halvedArmor(4), D.halvedArmor(1), D.halvedArmor(0)], [2, 2, 1, 0], "halved Armor rounds up (book 2113, 1680)");
eq(D.absorbByCopies({ taken: 2, copies: 3 }), { copies: 1, absorbed: 2, taken: 0, gone: false }, "copies absorb damage first (book 1910)");
eq(D.absorbByCopies({ taken: 5, copies: 3 }), { copies: 0, absorbed: 3, taken: 2, gone: true }, "the rest goes on to Health and the copies are gone");
eq(D.absorbByCopies({ taken: 4, copies: 0 }), { copies: 0, absorbed: 0, taken: 4, gone: false }, "no copies");
eq(D.resilienceConvert({ taken: 5, resolve: 4, convert: 3 }), { taken: 2, stress: 3, converted: 3 }, "Resilience: point for point (book 2160)");
eq(D.resilienceConvert({ taken: 5, resolve: 2, convert: 5 }), { taken: 3, stress: 2, converted: 2 }, "not more than the Resolve left");
eq(D.resilienceConvert({ taken: 5, resolve: 2, convert: 5 }, { uncapped: true }).converted, 5, "the other reading as an option");
eq(D.resilienceConvert({ taken: 5, resolve: 0, convert: 5 }), { taken: 5, stress: 0, converted: 0 }, "not at Resolve 0");
eq(D.resilienceConvert({ taken: 2, resolve: 6, convert: 9 }).converted, 2, "not more than the damage");
eq(D.resilienceConvert({ taken: 4, resolve: 6 }).converted, 0, "a choice: nothing by default");

// the whole hit (spec 9.5 steps 1-6)
{
  const plain = { base: 4, doubled: true, armor: 2 };
  const h = D.hitDamage(plain), r = D.resolveHit(plain);
  eq([r.raw, r.armor, r.taken, r.immune, r.vulnerable], [h.raw, h.armor, h.taken, h.immune, h.vulnerable], "the plain case equals hitDamage (book example 2504: 8, reduced to 6)");
  for (const c of [{ base: 5 }, { base: 5, pulled: 2 }, { base: 3, armor: 7 }, { base: 3, source: "fire", immunities: ["fire"] }, { base: 3, source: "fire", vulnerabilities: ["fire"], armor: 2 },
    { base: 3, source: "fire", immunities: ["nonKinetic"] }, { base: 3, doubled: true, ignoreArmor: true, armor: 5 }, { base: 2, source: "fire", immunities: ["fire"], vulnerabilities: ["fire"] }]) {
    const a = D.hitDamage(c), b = D.resolveHit(c);
    eq([b.raw, b.armor, b.taken, b.immune, b.vulnerable], [a.raw, a.armor, a.taken, a.immune, a.vulnerable], `resolveHit agrees with hitDamage for ${JSON.stringify(c)}`);
  }
  eq(D.resolveHit({ base: 3, doubled: true, addAfterDouble: 4, armor: 1 }).taken, 9, "Discharge is added after Double Damage (book 1685): 3 x 2 + 4 - 1");
  eq(D.resolveHit({ base: 3, addAfterDouble: -2 }).raw, 3, "an add-on never lowers the damage");
  eq(D.resolveHit({ base: 4, armor: 3, halveArmor: true }).taken, 2, "Find Weakness: Armor 3 counts as 2 (book 2113)");
  eq(D.resolveHit({ base: 3, source: "electricity", armorSources: [{ id: "prot", armor: 5 }], halveArmor: true }).armor, 3, "Electricity Control: Armor 5 counts as 3 (book 1680)");
  eq(D.resolveHit({ base: 4, source: "fire", armorSources: [{ id: "plasticity", armor: 3, only: ["kinetic"] }] }).taken, 4, "type-limited armor does not count against fire (book 1920)");
  eq(D.resolveHit({ base: 4, armorSources: [{ id: "plasticity", armor: 3, only: ["kinetic"] }] }).taken, 1, "and counts against a punch");
  const barrier = { id: "barrier", armor: 3, barrier: true };
  eq(D.resolveHit({ base: 10, armorSources: [barrier] }), { raw: 10, armor: 3, armorSource: barrier, through: 7, barrierBreached: true, immune: false, vulnerable: false,
    copies: { before: 0, absorbed: 0, left: 0, gone: false }, converted: 0, taken: 7, stress: 0 }, "book example 2792: 10 damage against a Barrier, 7 get through and the Barrier is gone");
  eq(D.resolveHit({ base: 2, armorSources: [barrier] }).barrierBreached, false, "a Barrier that holds stays");
  eq(D.resolveHit({ base: 6, armorSources: [barrier, { id: "own", armor: 3 }] }).barrierBreached, false, "on a tie the own armor counts and the Barrier is not spent");
  eq(D.resolveHit({ base: 6, armorSources: [barrier], ignoreArmor: true }).barrierBreached, false, "armor that is ignored is not breached");
  // Distress (book 1591): damage through the armor becomes stress; Defiance is armor against it (book 1865)
  eq(D.resolveHit({ base: 3, doubled: true, toStress: true, armorSources: [{ id: "defiance", armor: 3, stress: true }] }), { raw: 6, armor: 3, armorSource: { id: "defiance", armor: 3, stress: true }, through: 3,
    barrierBreached: false, immune: false, vulnerable: false, copies: { before: 0, absorbed: 0, left: 0, gone: false }, converted: 0, taken: 0, stress: 3 }, "Distress with Double Damage against Defiance: 3 stress, no damage");
  eq(D.resolveHit({ base: 3, toStress: true, copies: 3 }).copies.left, 3, "damage turned into stress does not reach the copies");
  eq(D.resolveHit({ base: 3, toStress: true, ignoreArmor: true, armorSources: [{ id: "defiance", armor: 3, stress: true }, { id: "prot", armor: 2 }] }).stress, 3, "Mental Distress, literal reading: no armor at all");
  eq(D.resolveHit({ base: 4, toStress: true, ignoreArmor: "exceptStress", armorSources: [{ id: "defiance", armor: 3, stress: true }, { id: "prot", armor: 5 }] }).stress, 1, "the other reading: only the stress armor counts");
  eq(D.resolveHit({ base: 4, ignoreArmor: "exceptStress", armor: 3 }).taken, 4, "exceptStress with a plain armor number: ignored");
  // Duplication and Resilience (book 1910, 2160)
  const d = D.resolveHit({ base: 6, armor: 1, copies: 3, resilience: 1, resolve: 4 });
  eq([d.through, d.copies, d.converted, d.taken, d.stress], [5, { before: 3, absorbed: 3, left: 0, gone: true }, 1, 1, 1], "Armor once, then the copies, then Resilience, the rest to Health");
  eq(D.resolveHit({ base: 2, armor: 1, copies: 3 }).copies, { before: 3, absorbed: 1, left: 2, gone: false }, "a small hit only costs copies");
  eq(D.resolveHit({ base: 3, source: "fire", immunities: ["fire"], copies: 2 }).copies.left, 2, "an immune target loses no copies");
  eq(D.resolveHit({ base: 3, source: "fire", vulnerabilities: ["fire"], addAfterDouble: 1, doubled: true, armor: 4 }).taken, 14, "Vulnerable doubles everything and ignores Armor (book 2193; reading 8): (3 x 2 + 1) x 2");
}

done("check-crits");
