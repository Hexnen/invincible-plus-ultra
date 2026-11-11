/* node scripts/tactics/check-attacks.mjs -- package P4: every attack rule through the REAL director, engine, ledger and journal.
   Without a map (testkit Table): wrecking a zone, full auto, area attacks, Bang Heads and Trick Shot with their extra opponents, Disarm,
   minion groups, NPCs at 0 Health and who may push, the grapple in full, the journal's language marks.
   With the fake map (check-kit-map MTable): the charge with its approach, Slam along the charge's route, Knockback with the attacker's
   direction and the barrier it meets, a huge attacker reaching an elevated target. */
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import { stunts as RS, zones as RZ, movement as RM } from "../rules/index.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as C from "./catalog-pure.mjs";
import * as Attack from "./flows/attack.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const kinds = (T) => T.prompts().map((p) => p.kind);
const pass = async (T, who = "gm") => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const has = (T, cid, id) => M.hasStatus(T.state, cid, id);
const base = (extra = () => {}, more = []) => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }).npc("N2", { health: 6 }); extra(T); T.order(["H1", "N1", "H2", "N2", ...more]); return T; };

/* ---- A. wrecking the zone [B2451-2457] */
{
  const T = base((t) => { t.terrain = { z1: "office" }; t.c.N1.zone = "z2"; });
  const row = RZ.WRECK_TABLE.office;
  T.c.H1.attrs.strength = row[0] - 1;
  eq(why(await T.req("p1", decl("H1", "slugfest", ["N1"], { wreck: true }))), "wreckStrength", "A: too weak for this terrain");
  T.c.H1.attrs.strength = row[0];
  eq(why(await T.req("p1", decl("H1", "slugfest", ["N1"]))), "outOfReach", "A: without wrecking the next zone is out of reach");
  eq(why(await T.req("p1", decl("H1", "shoot", ["N1"], { wreck: true }))), "wreckNotSlugfest", "A: only a slugfest attack wrecks");
  eq(code(await T.req("p1", decl("H1", "slugfest", ["N1"], { wreck: true }))), "ok", "A: wrecking reaches the adjacent zone");
  await pass(T);
  const rq = T.lastRequest();
  eq([rq.key, rq.pool.mods.find((m) => m.source === "wreck")?.dice], ["attack", row[1]], "A: the bonus dice of the terrain are in the pool");
  eq([T.zoneMarks.z1?.wrecked, T.state.counters["zone:z1:wrecked"], T.state.karma.at(-1)?.kind], [true, 1, "wreckedZone"], "A: the zone is wrecked when the dice are out: mark, counter, karma note");
  await T.roll("attack", 0);
  eq([T.state.stack.length, T.zoneMarks.z1?.wrecked], [0, true], "A: a miss leaves the zone wrecked");
  const tx = T.log.list.at(-1);
  ok(/\{ITAC\.action\.slugfest\}/.test(tx.label.gm) && /\{ITAC\.result\.miss\}/.test(tx.label.gm), "A: the journal names the action and the result as language marks, not raw ids");
  T.turn("H2"); T.c.H2.attrs.strength = 9;
  eq(why(await T.req("p2", decl("H2", "slugfest", ["N1"], { wreck: true }))), "wreckDone", "A: a zone is wrecked once per scene");
  eq(code(await T.gm({ op: "undo", tx: tx.id })), "ok", "A: undo");
  eq([!!T.zoneMarks.z1?.wrecked, T.state.counters["zone:z1:wrecked"] ?? 0, T.state.karma.length], [false, 0, 0], "A: undo takes the wreck, the counter and the karma note back");
  const U = base((t) => { t.c.N1.zone = "z2"; });
  const r = await U.req("p1", decl("H1", "slugfest", ["N1"], { wreck: true }));
  eq([why(r), r.error.params.gmMayAllow], ["wreckUnset", 1], "A: terrain that was never set: refused, the GM may allow [A17]");
}

/* ---- B. full auto [B2543] */
{
  const T = base((t) => { t.weapons.smg = { id: "smg", bonus: 1, damage: 2, range: [0, 2], sharp: true, fullAuto: true }; t.weapons.gun = { id: "gun", bonus: 1, damage: 2, range: [0, 1] }; });
  eq(why(await T.req("p1", decl("H1", "shoot", ["N1", "N2"], { weapon: "gun" }))), "oneTarget", "B: two targets need full auto or an area");
  eq(why(await T.req("p1", decl("H1", "shoot", ["N1", "N2"], { weapon: "gun", fullAuto: true }))), "noFullAuto", "B: the weapon must have full auto");
  T.c.N2.zone = "z2";
  eq(why(await T.req("p1", decl("H1", "shoot", ["N1", "N2"], { weapon: "smg", fullAuto: true }))), "notSameZone", "B: the targets stand in one zone");
  T.c.N2.zone = "z1";
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1", "N2", "H2"], { weapon: "smg", fullAuto: true }))), "ok", "B: three targets in one zone");
  eq(T.prompts("reaction").map((p) => p.about).sort(), ["H2", "N1", "N2"], "B: every target is asked for its dodge before the roll");
  eq(code(await T.answer("gm", "reaction", "dodge", "N1")), "ok", "B: one dodges");
  await pass(T);
  const rq = T.requests.find((x) => x.key === "attack" && x.inst === T.top().id);
  eq(rq.pool.mods.find((m) => m.source === "fullAuto")?.dice, RS.fullAutoDice(3), "B: one die less per target beyond the first");
  await T.roll("attack", 3); await T.roll("def:N1", 2);
  const sp = T.prompt("stunts");
  eq([sp.max, sp.data.multi], [2, "fullAuto"], "B: one pool of spare sixes for all targets [R14]");
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["doubleDamage@N1"] })), "illegal", "B: a target that dodged down to one six takes no stunt [A-3]");
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["doubleDamage@N2", "suppressed@N2", "doubleDamage@H2"] })), "badInput", "B: no more stunts than spare sixes");
  const hp = [T.c.N1.health, T.c.N2.health, T.c.H2.health];
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["doubleDamage@N2", "doubleDamage@H2"] })), "ok", "B: the stunts are shared out");
  eq([hp[0] - T.c.N1.health, hp[1] - T.c.N2.health, hp[2] - T.c.H2.health], [2, 4, 4], "B: everybody hit takes the base Damage, doubled where a stunt says so");
}

/* ---- C. area attacks [B2542], minions in the area [OQ-1] */
{
  const T = base((t) => { t.weapons.nade = { id: "nade", bonus: 0, damage: 3, range: [0, 1], area: true }; t.add("M1", { npc: true, kind: "minions", members: 5, health: 5, zone: "z2" }); t.c.N1.zone = "z2"; t.c.N2.zone = "z2"; t.c.H2.zone = "z3"; }, ["M1"]);
  eq(why(await T.req("p1", decl("H1", "slugfest", ["N1"], { area: true }))), "noArea", "C: an area needs a weapon or a power that has one");
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "nade", area: true }))), "ok", "C: an area attack on a zone");
  eq(T.top().decl.targets.slice().sort(), ["M1", "N1", "N2"], "C: everyone in the target zone is a target");
  await pass(T);
  await T.roll("attack", 0);
  eq([T.state.stack.length, T.c.N1.health, T.c.M1.health], [0, 6, 5], "C: a failed area attack hurts nobody");
  T.turn("H2"); T.c.H2.zone = "z1"; T.weapons.nade2 = T.weapons.nade;
  eq(code(await T.req("p2", decl("H2", "shoot", ["N2"], { weapon: "nade", area: true }))), "ok", "C: again");
  await pass(T);
  await T.roll("attack", 1);
  const ml = T.prompt("minionLoss");
  eq([ml?.to, ml?.about, ml?.data.suggested, ml?.options.length], ["gm", "M1", 3, 6], "C: how many minions fall to an area attack is the GM's number [OQ-1]");
  eq(code(await T.answer("gm", "minionLoss", "n:2", "M1")), "ok", "C: the GM says two");
  eq(T.prompt("minionsFate")?.data.removed, 2, "C: knocked out or killed is the GM's word");
  eq(code(await T.answer("gm", "minionsFate", "kill", "M1")), "ok", "C: killed");
  eq([T.c.M1.health, T.c.N1.health, T.c.N2.health, T.state.karma.at(-1)?.kind, T.c.M1.crits.length], [3, 3, 3, "killed", 0], "C: two members gone, the others took the base Damage, a karma note, no injury roll for minions");
}

/* ---- D. Bang Heads [B2437] and further stunts on the extra opponent; E. Disarm [B2439] */
{
  const T = base((t) => { t.c.N2.armor = [{ id: "armor", armor: 1 }]; });
  eq(code(await T.req("p1", decl("H1", "slugfest", ["N1"]))), "ok", "D: a slugfest attack");
  await pass(T);
  await T.roll("attack", 4);
  const sp = T.prompt("stunts"), ids = sp.options.map((o) => o.id);
  ok(ids.includes("bangHeads@N1|N2") && ids.includes("bangHeads@N1|H2") && ids.includes("stun@N2"), "D: Bang Heads names the extra opponent; that opponent may get stunts of its own");
  const ans = (value) => T.req("p1", { op: "answer", prompt: sp.id, value });
  eq(why(await ans(["stun@N2"])), "notHit", "D: no stunt on someone the blow does not reach");
  eq(why(await ans(["bangHeads@N1|N2", "bangHeads@N1|N2"])), "chosen", "D: the same extra opponent only once");
  ok(!!sp.options.find((o) => o.id === "deadlyHit@N1")?.disabled, "D: no Deadly Hit without a sharp weapon");
  const hp = [T.c.N1.health, T.c.N2.health];
  eq(code(await ans(["bangHeads@N1|N2", "stun@N2", "disarm@N1"])), "ok", "D: Bang Heads into N2, Stun on N2, Disarm on N1");
  const dp = T.prompt("disarm");
  eq([dp?.to, dp?.options.map((o) => o.id)], [{ users: ["p1"] }, ["keep", "throw"]], "E: the attacker says what happens to the item");
  eq(code(await T.req("p1", { op: "answer", prompt: dp.id, value: "keep" })), "ok", "E: kept");
  const gc = T.prompt("stunt");
  eq([gc?.to, gc?.data.stunt, gc?.data.how], ["gm", "disarm", "keep"], "E: the GM names the item and has the last word");
  eq(code(await T.gm({ op: "answerFor", prompt: gc.id, value: { id: "approve", text: "Pistol" } })), "ok", "E: approved");
  const half = RS.bangHeadsDamage(T.c.H1.attrs.strength);
  eq([hp[0] - T.c.N1.health, hp[1] - T.c.N2.health], [2, half - 1], "D: the extra opponent takes half the attacker's STRENGTH, less its Armor");
  eq(T.lastRequest().key, "stun:N2", "D: the Stun on the extra opponent asks for its PRESENCE roll");
  await T.roll("stun:N2", 0);
  eq([has(T, "N2", "stunned"), T.state.stack.length], [true, 0], "D: stunned, the action closed");
  const it = T.state.items.at(-1);
  eq([it?.name, it?.state, it?.holder, it?.owner, has(T, "N1", "itemLost")], ["Pistol", "taken", "H1", "N1", true], "E: the item is recorded in the attacker's hands, the target has lost it");
}

/* ---- F. Trick Shot [B2518] */
{
  const T = base((t) => { t.weapons.gun = { id: "gun", bonus: 0, damage: 3, range: [0, 1] }; });
  await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "gun" }));
  await pass(T);
  await T.roll("attack", 2);
  const sp = T.prompt("stunts");
  const hp = T.c.N2.health;
  eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["trickShot@N1|N2"] })), "ok", "F: Trick Shot at another opponent in the zone");
  eq(hp - T.c.N2.health, RS.trickShotDamage(3), "F: the extra opponent takes the weapon's base Damage");
}

/* ---- G. minions: one member per point, no injuries, the group attacks together [B2825-2831] */
{
  const T = new Table(); T.hero("H1", "p1", { damage: 2 }).add("M1", { npc: true, kind: "minions", members: 4, health: 4 }); T.order(["H1", "M1"]);
  await T.req("p1", decl("H1", "slugfest", ["M1"]));
  await pass(T);
  await T.roll("attack", 2);
  await T.req("p1", { op: "answer", prompt: T.prompt("stunts").id, value: ["doubleDamage@M1"] });
  eq([T.c.M1.health, kinds(T)], [0, ["minionsFate"]], "G: four points of damage take four members; no card for a number, the hit was on the group");
  await T.answer("gm", "minionsFate", "ko", "M1");
  eq([has(T, "M1", "broken"), has(T, "M1", "unconscious"), T.c.M1.crits.length, T.state.stack.length], [true, true, 0, 0], "G: the group is out, nobody rolls an injury");
  const U = new Table(); U.hero("H1", "p1").add("M1", { npc: true, kind: "minions", members: 6, health: 6 }); U.order(["M1", "H1"]);
  await U.gm(decl("M1", "slugfest", ["H1"]));
  await pass(U);
  eq([U.lastRequest().pool.mods.find((m) => m.source === "minions")?.dice, U.lastRequest().maxPush], [5, null], "G: five helpers add five dice; a minion group may push [B2830]");
}

/* ---- H. NPCs: who pushes, what happens at 0 Health [B2771] */
{
  const T = new Table(); T.hero("H1", "p1", { damage: 4 }).npc("N1", { health: 3 }).npc("N2", { health: 3 }); T.c.N2.major = true; T.order(["N1", "N2", "H1"]);
  await T.gm(decl("N1", "slugfest", ["H1"]));
  await pass(T);
  eq(T.lastRequest().maxPush, 0, "H: an ordinary NPC is not offered the push [A12]");
  await T.roll("attack", 0);
  T.turn("N2");
  await T.gm(decl("N2", "slugfest", ["H1"]));
  await pass(T);
  eq(T.lastRequest().maxPush, null, "H: a major NPC is");
  await T.roll("attack", 0);
  eq(code(await T.gm({ op: "npcPolicy", combatant: "N1", policy: { push: "ask" } })), "ok", "H: the GM may open the push for one NPC");
  T.turn("H1");
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  await pass(T);
  await T.roll("attack", 1);
  eq(T.prompt("npcBroken")?.options.map((o) => o.id), ["ko", "kill", "crit"], "H: an ordinary NPC at 0 Health: the GM's word");
  T.dice.push([4]);
  await T.answer("gm", "npcBroken", "crit", "N1");
  eq([T.c.N1.crits.length, T.state.stack.length, T.performed.some((e) => e.t === "critAdd")], [1, 0, true], "H: 'roll an injury' rolls it like a hero's");
  const U = new Table(); U.hero("H1", "p1", { damage: 4 }).npc("N2", { health: 3 }); U.c.N2.major = true; U.order(["H1", "N2"]);
  await U.req("p1", decl("H1", "slugfest", ["N2"]));
  await pass(U);
  U.dice.push([2]);
  await U.roll("attack", 1);
  eq([U.prompt("npcBroken"), U.c.N2.crits.length], [null, 1], "H: a major NPC rolls its injury without a card");
}

/* ---- I. the grapple in full [B2496-2497] */
{
  const T = base();
  await T.req("p1", decl("H1", "grapple", ["N1"]));
  await pass(T);
  await T.roll("attack", 3);
  eq([has(T, "N1", "grappled"), has(T, "H1", "grappling"), T.c.N1.health, kinds(T)], [true, true, 6, []], "I: the hold takes, no damage, no stunts [R5]");
  T.turn("N1");
  eq(why(await T.gm(decl("N1", "slugfest", ["H1"]))), "held", "I: the one held cannot attack");
  T.turn("H2");
  await T.req("p2", decl("H2", "slugfest", ["N1"]));
  eq(T.prompt("reaction", "N1"), null, "I: the one held is not offered a defence [R6]");
  ok(T.lastRequest().pool.mods.some((m) => m.source === "restrained" && m.dice === 2), "I: two more dice against a held target in slugfest");
  await T.roll("attack", 0);
  T.turn("N2"); await T.gm({ op: "nextTurn" });
  eq(T.state.round, 2, "I: the next round"); T.turn("H1");
  eq(why(await T.req("p1", decl("H1", "slugfest", ["N2"]))), "grappling", "I: the holder can only move, attack the one held or let go");
  eq(why(await T.req("p1", decl("H1", "grappleAttack", ["N2"]))), "notHeld", "I: a grapple attack is against the one held");
  eq(code(await T.req("p1", decl("H1", "grappleAttack", ["N1"]))), "ok", "I: a grapple attack");
  eq(T.prompt("reaction", "N1"), null, "I: it cannot be blocked");
  await T.roll("attack", 3);
  eq(T.prompt("stunts").options.map((o) => o.id), ["doubleDamage@N1"], "I: the only stunt is Double Damage");
  await T.req("p1", { op: "answer", prompt: T.prompt("stunts").id, value: [] });
  eq(code(await T.req("p1", decl("H1", "release", []))), "ok", "I: letting go costs nothing");
  eq([has(T, "N1", "grappled"), has(T, "H1", "grappling"), P1.budget(T.state, "H1").quick.includes("open")], [false, false, true], "I: both are free, no action was spent on it");
  eq(why(await T.req("p1", decl("H1", "release", []))), "notHolding", "I: nothing to let go of");
  /* a holder that is broken lets go */
  const U = base();
  await U.gm({ op: "statusAdd", combatant: "N1", status: { id: "grappling", data: { held: "H2" } } });
  await U.gm({ op: "statusAdd", combatant: "H2", status: { id: "grappled", data: { by: "N1" } } });
  U.c.N1.health = 1;
  await U.req("p1", decl("H1", "slugfest", ["N1"]));
  await pass(U);
  await U.roll("attack", 1);
  await U.answer("gm", "npcBroken", "ko", "N1");
  eq([has(U, "N1", "grappling"), has(U, "H2", "grappled")], [false, false], "I: a broken holder holds nobody");
}

/* ---- J. the charge [B2490-2494] on the map:  z1 - z2 - z3 - z4(wall)  */
const FLY = [{ mode: "flight", tier: "basic" }];
const city = () => { const T = new MTable(); T.hero("H1", "p1", { attrs: { strength: 6 } }).hero("H2", "p2").npc("N1", { health: 9 }); T.put("H1", "z1").put("H2", "z1").put("N1", "z2"); T.order(["H1", "N1", "H2"]); return T; };
{
  const T = city();
  T.put("N1", "z1");
  eq(why(await T.req("p1", decl("H1", "charge", ["N1"]))), "chargeSameZone", "J: a charge cannot start in the target's zone");
  T.put("N1", "z2");
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "move", targets: [], to: "z5" } })), "ok", "J: (a move first)");
  T.put("H1", "z1");
  eq(why(await T.req("p1", decl("H1", "charge", ["N1"]))), "chargeActions", "J: a charge needs a full and a quick action");
}
{
  const T = city();
  eq(code(await T.req("p1", decl("H1", "charge", ["N1"]))), "ok", "J: a charge at the next zone");
  const b = P1.budget(T.state, "H1");
  eq([b.full, b.quick.includes("open"), T.spot("H1")], ["used", false, "z2"], "J: a full and a quick action are spent and the charger stands at the target");
  const rp = T.prompt("reaction", "N1");
  eq(rp.options.map((o) => o.id), ["dodge", "pass"], "J: a charge can be dodged, not blocked");
  await pass(T);
  eq([T.lastRequest().key, T.lastRequest().attr], ["attack", "strength"], "J: rolled with STRENGTH");
  await T.roll("attack", 3);
  const sp = T.prompt("stunts");
  eq([sp.options.map((o) => o.data.stunt).sort(), sp.options.find((o) => o.data.stunt === "slam").disabled], [["doubleDamage", "slam"], "noMovement"], "J: only Double Damage and Slam; no Slam without movement left");
  await T.req("p1", { op: "answer", prompt: sp.id, value: ["doubleDamage@N1"] });
  eq([T.state.stack.length, T.c.N1.health], [0, 9 - 4], "J: the charge hits with the charger's Slugfest Damage, doubled");
  const tx = T.log.list.at(-1);
  eq(code(await T.gm({ op: "undo", tx: tx.id })), "ok", "J: undo");
  eq([T.spot("H1"), T.c.N1.health, P1.budget(T.state, "H1").full], ["z1", 9, "open"], "J: one undo puts the charger back, heals the target and frees both actions");
}
{ /* dodged: the charger stops where the target stood [R19] */
  const T = city();
  await T.req("p1", decl("H1", "charge", ["N1"]));
  await T.answer("gm", "reaction", "dodge", "N1");
  await T.roll("attack", 1); await T.roll("def:N1", 3);
  eq(T.prompt("dodgeMove")?.about, "N1", "J: the dodger earns a move");
  await T.answer("gm", "dodgeMove", "pass", "N1");
  eq([T.state.stack.length, T.spot("H1"), T.c.N1.health], [0, "z2", 9], "J: a dodged charge ends in the zone where the target stood");
}
{ /* Slam: flight leaves movement after the point of attack */
  const T = city();
  T.c.H1.movement = FLY;
  const reach = RM.moveProfile("flight", { tier: "basic" }).zones;
  eq(code(await T.req("p1", decl("H1", "charge", ["N1"]))), "ok", "J: a flying charge");
  eq(T.top().data.charge?.mode ?? T.state.stack[0].data.charge?.mode, "flight", "J: no way of moving named: the one that leaves the most movement for a Slam");
  await pass(T);
  await T.roll("attack", 2);
  const sp = T.prompt("stunts"), slam = sp.options.find((o) => o.data.stunt === "slam");
  eq([!!slam, slam?.disabled ?? null, T.top().data.charge.left], [true, reach > 1 ? null : "noMovement", reach - 1], "J: Slam is on offer when the move has zones left");
  if (reach > 1) {
    await T.req("p1", { op: "answer", prompt: sp.id, value: ["slam@N1"] });
    const dc = T.prompt("direction");
    eq([dc?.to, dc?.data.kind, dc?.data.zones.slice(0, 2)], ["gm", "slam", ["z2", "z3"]], "J: the Slam goes on along the charge's route; the GM confirms the chain");
    await T.answer("gm", "direction", "go", "N1");
    const far = T.spot("N1");
    eq([far !== "z2", T.spot("H1") === far, T.state.stack.length], [true, true, 0], "J: the target is pushed ahead and the charger keeps moving behind it");
    if (reach - 1 >= 2) eq([far, T.c.N1.health], ["z3", 9 - 2 - Math.max(0, RS.slamDamage(6))], "J: the wall holds (Armor 2 against half STRENGTH 3 goes through otherwise)") || true;
  }
}

/* ---- K. Knockback on the map [B2435], [R7], [R8] */
{
  const T = city();
  T.put("H1", "z2");
  T.c.N1.armor = [{ id: "armor", armor: 1 }];
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  await pass(T);
  await T.roll("attack", 2);
  await T.req("p1", { op: "answer", prompt: T.prompt("stunts").id, value: ["knockback@N1"] });
  const kd = T.prompt("knockDir");
  eq([kd?.to, kd?.options.map((o) => o.id).sort(), kd?.data.distance], [{ users: ["p1"] }, ["away", "to:z1", "to:z3", "up"], RS.knockbackDistance(6)], "K: the attacker names the direction: straight away, toward a neighbouring zone, or straight up (the target stands on the ground: no down)");
  const hp = T.c.N1.health;
  await T.req("p1", { op: "answer", prompt: kd.id, value: "to:z3" });
  const dc = T.prompt("direction");
  eq([dc?.to, dc?.data.kind, dc?.data.zones.slice(0, 2)], ["gm", "knockback", ["z2", "z3"]], "K: the GM confirms the chain");
  await T.answer("gm", "direction", "go", "N1");
  /* z3|z4 is an interior wall (Armor 2): the first barrier takes the Knockback distance (3) as damage, less the target's Armor; 3 beats Armor 2 */
  eq([T.spot("N1"), hp - T.c.N1.health, T.map.borderBetween("z3", "z4").wall.state, T.state.stack.length], ["z4", RS.knockbackDistance(6) - 1, "breached", 0], "K: thrown through the wall: the Knockback distance as barrier damage, less the target's Armor [R8]");
}

/* ---- L. a huge attacker reaches an elevated target in slugfest [B2500] */
{
  const T = new MTable(); T.hero("H1", "p1").npc("N1", { health: 9, huge: true }); T.put("H1", "z6:elevated").put("N1", "z6"); T.order(["N1", "H1"]);
  eq(code(await T.gm(decl("N1", "slugfest", ["H1"]))), "ok", "L: a huge creature on the ground attacks a character on the rooftop");
  const U = new MTable(); U.hero("H1", "p1").npc("N1", { health: 9 }); U.put("H1", "z6:elevated").put("N1", "z6"); U.order(["N1", "H1"]);
  eq(why(await U.gm(decl("N1", "slugfest", ["H1"]))), "outOfReach", "L: anybody else cannot");
  eq(why(await U.gm(decl("N1", "grapple", ["H1"]))), "outOfReach", "L: nor grapple it");
}

/* ---- M. the catalog and the flow table */
{
  for (const id of ["charge", "grappleAttack", "release"]) ok(C.BUILTIN[id], `M: the catalog has ${id}`);
  eq(Attack.STEPS.includes("approach"), true, "M: the attack flow has the approach of a charge");
  eq(C.sanitizeEntry({ id: "blast", flow: "attack", attack: "shooting", area: true, fullAuto: true, range: [0, 3] })?.area, true, "M: a granted entry may carry an area");
}
/* ---- N. the dock: what an attack is made with, and its options (ui/model-pure armsOf); the journal reads in words */
{
  const D = await import("./desk-pure.mjs"), V = await import("./view-pure.mjs"), UI = await import("./ui/model-pure.mjs"), { t } = await import("./lang.mjs");
  const T = base((x) => { x.terrain = { z1: "office" }; });
  const W = [{ id: "smg", name: "SMG", bonus: 1, damage: 2, range: [0, 2], sharp: true, fullAuto: true, area: false }, { id: "nade", name: "Grenade", bonus: 0, damage: 3, range: [0, 1], area: true }, { id: "bat", name: "Bat", bonus: 1, damage: 2, range: null }];
  T.weapons = Object.fromEntries(W.map((w) => [w.id, w]));
  const meta = { hidden: [], npc: ["N1", "N2"] }, view = V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, meta);
  const facts = { view, me: "p1", staff: false, c: (id) => (T.c[id] ? { name: T.c[id].name, npc: T.c[id].npc, img: null } : null), attrs: (id) => (id === "H1" ? T.c.H1.attrs : null), userName: (u) => u, weapons: (id) => (id === "H1" ? W : []), preview: (cid, decl) => T.preview("p1", cid, decl) };
  const dock = (own) => UI.dockData(D.playerModel(view, { id: "p1", owns: ["H1"] }, { c: (id) => T.c[id] ?? null, online: () => true, P1 }), own, facts, t);
  const acts = dock({}).groups.flatMap((g) => g.items).map((a) => a.id);
  ok(["slugfest", "shoot", "grapple", "charge"].every((id) => acts.includes(id)), "N: the dock offers slugfest, shoot, grapple and charge");
  ok(!acts.includes("release") && !acts.includes("grappleAttack"), "N: letting go and the grapple attack are not on the bar of somebody who holds nobody");
  let p = dock({ armed: "shoot", targets: ["N1"] }).panel;
  eq([p.weapons.items.map((x) => [x.id, x.picked]), p.opts.map((o) => [o.id, o.on]), p.maxTargets, p.submit.req.decl.weapon, p.pool.total], [[["smg", true], ["nade", false]], [["fullAuto", false]], 1, "smg", T.c.H1.attrs.agility + 1], "N: shooting: the ranged weapons, the first is taken, its bonus is in the dice");
  p = dock({ armed: "shoot", targets: ["N1", "N2"], opts: { fullAuto: true } }).panel;
  eq([p.maxTargets > 1, p.submit.req.decl.targets, p.submit.req.decl.fullAuto, p.notes.length], [true, ["N1", "N2"], true, 1], "N: full auto: several targets ride in the declaration");
  eq(code(await T.req("p1", p.submit.req)), "ok", "N: the executor takes the dock's full auto declaration as it is");
  await T.gm({ op: "cancel", inst: T.top().id, force: true });
  p = dock({ armed: "shoot", targets: ["N1", "N2"], weapon: "nade", opts: { area: true, fullAuto: true } }).panel;
  eq([p.opts.map((o) => [o.id, o.on]), p.submit.req.decl.targets, p.submit.req.decl.area, p.submit.req.decl.fullAuto ?? null], [[["area", true]], ["N2"], true, null], "N: an area weapon: one target names the zone; no full auto on a weapon without it");
  p = dock({ armed: "slugfest", targets: ["N1"], opts: { wreck: true } }).panel;
  eq([p.weapons.items.map((x) => x.id), p.opts.map((o) => o.id), p.submit.req.decl.wreck, p.submit.req.decl.weapon ?? null], [["unarmed", "bat"], ["wreck"], true, null], "N: slugfest: bare hands or a melee weapon, and the option to wreck the zone");
  p = dock({ armed: "grapple", targets: ["N1"] }).panel;
  eq([p.weapons, p.opts], [null, []], "N: a grapple has neither a weapon nor options");
  facts.weapons = () => [];
  p = dock({ armed: "shoot", targets: ["N1"] }).panel;
  eq([p.submit.req, typeof p.submit.disabled, !!p.weapons.empty], [null, "string", true], "N: shooting without a ranged weapon cannot be declared, and the panel says why");
  eq(UI.marks(t, "Eve: {ITAC.action.slugfest} -> Mauler ({ITAC.result.hit})"), "Eve: Slugfest -> Mauler (hit)", "N: the journal's marks are put into words");
  eq(UI.marks(t, "x: {ITAC.action.zzz} ({ITAC.result.qq})"), "x: zzz (qq)", "N: an unknown mark reads as its id");
}
done("check-attacks");
