// node scripts/tactics/check-defects.mjs -- the defects of dev/combat-defects.md (P8), each reproduction turned into a check that fails on
// the tree the adversaries reviewed (tag tactics-integrated-4) and passes on the fix. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as M from "./mods-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as Relay from "./relay-pure.mjs";
import * as Kit from "./kit-pure.mjs";
import { LEVELS } from "./kitdata-pure.mjs";
import { NAMES } from "./check-kit-names.mjs";
import * as Eng from "./engine-pure.mjs";
import * as Desk from "./desk-pure.mjs";
import * as View from "./view-pure.mjs";
import * as UiM from "./ui/model-pure.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, targets, more = {}) => ({ op: "declare", actor, decl: { action, targets, ...more } });
const st = (T, c) => M.statusesOf(T.state, c).map((s) => s.id).sort().join(",");
const opts = (p) => (p?.options ?? []).filter((o) => !o.disabled).map((o) => o.id).join(" ");
const all = (p) => (p?.options ?? []).map((o) => o.id + (o.disabled ? `(${o.disabled})` : "")).join(" ");
const fight = (o = {}) => { const T = new Table(); T.hero("H1", "p1", o.H1 ?? {}).hero("H2", "p2", o.H2 ?? {}).npc("N1", { health: 12, ...(o.N1 ?? {}) }).npc("N2", { health: 6, ...(o.N2 ?? {}) }); T.order(o.order ?? ["H1", "N1", "H2", "N2"]); return T; };
/* H1 hits N1 with two sixes and buys Stun; N1 fails the PRESENCE roll */
const stun = async (T, by = "H1", user = "p1", t = "N1") => {
  await T.req(user, decl(by, "slugfest", [t])); await T.answer("gm", "reaction", "pass", t); await T.roll("attack", 2);
  await T.req(user, { op: "answer", prompt: T.prompt("stunts").id, value: [`stun@${t}`] }); await T.roll(`stun:${t}`, 0);
};

/* ================================================================== D1: "stunned" ends with the turn it takes away [B2436], [R10] */
{
  const T = fight();
  await stun(T);
  eq(st(T, "N1"), "stunned", "D1: the failed PRESENCE roll stuns");
  ok(!!T.state.ledger.N1.lostTurn, "D1: the coming turn is lost");
  await T.req("p1", { op: "endTurn", actor: "H1" });
  eq(T.state.init.curMember, "H2", "D1: the stunned NPC's turn is passed over");
  eq(T.state.init.slots.find((s) => s.members[0] === "N1").state, "lost", "D1: its card shows the lost turn");
  eq(st(T, "N1"), "", "D1: the mark is gone once the lost turn has come");
  ok(!M.conditions(T.state, "N1").noInterrupts, "D1: no interrupt ban after the lost turn");
  eq(code(await T.req("p2", decl("H2", "slugfest", ["N1"]))), "ok", "D1: attacked later in the same round");
  eq(opts(T.prompt("reaction", "N1")), "block pass", "D1: it may block again");
}
{ /* the GM takes the lost turn back: the mark goes with it; a mark set by hand ends at the character's next own turn */
  const T = fight();
  await stun(T);
  eq(code(await T.gm({ op: "ledgerEdit", combatant: "N1", edit: "clearLostTurn" })), "ok", "D1: the GM clears the lost turn");
  eq(st(T, "N1"), "", "D1: clearing the lost turn clears the mark");
  eq(code(await T.gm({ op: "statusAdd", combatant: "N2", status: { id: "stunned" } })), "ok", "D1: a mark set by hand");
  ok(M.conditions(T.state, "N2").noInterrupts, "D1: bans interrupts while it stands");
  T.turn("N2");
  eq(st(T, "N2"), "", "D1: and ends when that character's turn comes");
}
{ /* sibling: any status with `ends`, and what lasts "until your next turn" of a character whose turn is lost */
  const T = fight();
  await T.gm({ op: "tokenAdd", token: { id: "plan", holder: "H2", dice: 2, scope: { rolls: ["attack"] }, uses: "all", source: { kind: "power", name: "Action Plan", owner: "N1" }, expires: { at: "nextTurnOf", who: "N1" } } });
  await T.gm({ op: "statusAdd", combatant: "H2", status: { id: "afflicted", ends: { at: "turnEndOf", who: "N1" } } });
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "invisible", ends: { at: "roundEnd" } } });
  await stun(T);
  await T.req("p1", { op: "endTurn", actor: "H1" });
  ok(!T.state.tokens.some((t) => t.id === "plan"), "D1: 'until your next turn' ends when that turn comes, also a lost one");
  eq(st(T, "H2"), "afflicted", "D1: a lost turn has no end, so a status that ends with it stays");
  for (let i = 0; i < 6 && T.state.round < 2; i++) await T.gm({ op: "nextTurn" });
  eq(T.state.round, 2, "D1: the round turned");
  eq(st(T, "H1"), "", "D1: a status that lasts until the end of the round is gone");
  T.turn("N1"); await T.gm({ op: "nextTurn" });
  eq(st(T, "H2"), "", "D1: a status that lasts until the end of somebody's turn ends there");
}

/* ================================================================== D2: undo of a Stun after the round turned gives the turn back */
{
  const T = fight({ N1: { health: 6 } });
  T.turn("H2");                                                                                  // N1 has had its turn of round 1
  await stun(T, "H2", "p2");
  const tx = T.log.list[T.log.list.length - 1].id;
  for (let i = 0; i < 6 && T.state.round < 2; i++) await T.gm({ op: "nextTurn" });
  eq(T.state.round, 2, "D2: the round turned before N1's lost turn came");
  ok(!!T.state.ledger.N1.lostTurn, "D2: the lost turn is carried into the new round");
  eq(code(await T.gm({ op: "undo", tx })), "ok", "D2: the GM undoes the attack");
  eq([T.c.N1.health, st(T, "N1")], [6, ""], "D2: Health and the mark are back");
  eq([!!T.state.ledger.N1.lostTurn, !!T.state.ledger.N1.noInterrupts], [false, false], "D2: and so is the turn, with the right to interrupt");
  for (let i = 0; i < 6 && T.state.init.curMember !== "N1" && T.state.round === 2; i++) await T.gm({ op: "nextTurn" });
  eq([T.state.round, T.state.init.curMember], [2, "N1"], "D2: N1 takes its turn of round 2");
}

/* ================================================================== D3: out of action means out of everything [B2707], [B2238] */
{
  const T = fight({ N1: { health: 6 } }); T.c.H2.health = 0;
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", ["H2"]));
  ok(!T.prompt("reaction", "H2"), "D3: a broken character gets no defence window");
  eq(T.lastRequest()?.key, "attack", "D3: the attack goes straight to its roll");
  await T.roll("attack", 3);
  ok(!T.prompt("counter", "H2"), "D3: and no counterattack card");
  eq(P1.budget(T.state, "H2").quick.join(","), "open,open", "D3: no action of the broken character was touched");
}
{
  const T = fight({ N1: { health: 6 } }); T.c.H2.health = 0;
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  const r = await T.req("p2", { op: "help", inst: T.top().id, helper: "H2" });
  eq([code(r), why(r)], ["illegal", "broken"], "D3: a broken character cannot help");
  eq(T.top().decl.helpers ?? [], [], "D3: no helper is recorded");
  const g = await T.gm({ op: "help", inst: T.top().id, helper: "N1" });
  eq([code(g), why(g)], ["illegal", "helpTarget"], "D3: the target of an action does not help it");
  eq(code(await T.gm({ op: "help", inst: T.top().id, helper: "N2" })), "ok", "D3: an able bystander still helps");
}
for (const s of ["unconscious", "dead"]) {
  const T = fight({ N1: { health: 6 } });
  await T.gm({ op: "statusAdd", combatant: "H2", status: { id: s } });
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  const h = await T.req("p2", { op: "help", inst: T.top().id, helper: "H2" });
  eq([code(h), why(h)], ["illegal", s], `D3: ${s}: cannot help`);
  await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 0);
  T.turn("N1");
  await T.gm(decl("N1", "slugfest", ["H2"]));
  ok(!T.prompt("reaction", "H2"), `D3: ${s}: no defence window`);
  await T.roll("attack", 0);
  T.turn("H2");
  const d = await T.req("p2", decl("H2", "slugfest", ["N1"]));
  eq([code(d), why(d)], ["illegal", s], `D3: ${s}: declares nothing`);
}
{ /* the blow that breaks the target: no PRESENCE roll is asked of it for a Stun */
  const T = fight({ N1: { health: 1 } });
  await T.req("p1", decl("H1", "slugfest", ["N1"])); await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 2);
  await T.req("p1", { op: "answer", prompt: T.prompt("stunts").id, value: ["stun@N1"] });
  ok(T.lastRequest()?.key !== "stun:N1" || T.state.stack.length === 0, "D3: a target the blow broke is not asked the Stun roll");
}

/* ================================================================== D4: a defence is paid for when it is taken, not when it is offered */
{
  const T = fight({ N1: { health: 6 } }); T.turn("N1");
  await T.gm(decl("N1", "slugfest", ["H1"]));
  const p = T.prompt("reaction", "H1");
  eq(opts(p), "block pass", "D4: the window offers a block");
  await T.req("p1", { op: "mark", actor: "H1", unit: "quick" }); await T.req("p1", { op: "mark", actor: "H1", unit: "quick" });
  const r = await T.req("p1", { op: "answer", prompt: p.id, value: "block" });
  eq([code(r), why(r)], ["illegal", "noQuickAction"], "D4: a block with no action left is refused");
  ok(!T.top().data.def?.H1, "D4: no defence is recorded");
  eq(code(await T.req("p1", { op: "answer", prompt: p.id, value: "pass" })), "ok", "D4: the window still takes a pass");
  await T.roll("attack", 1);
  eq(T.c.H1.health < 6, true, "D4: the attack lands undefended");
  ok(!T.prompt("counter", "H1"), "D4: no counterattack card");
}
{ /* the GM's own answer stands (spec 14) */
  const T = fight({ N1: { health: 6 } }); T.turn("N1");
  await T.gm(decl("N1", "slugfest", ["H1"]));
  const p = T.prompt("reaction", "H1");
  await T.req("p1", { op: "mark", actor: "H1", unit: "quick" }); await T.req("p1", { op: "mark", actor: "H1", unit: "quick" });
  eq(code(await T.gm({ op: "answer", prompt: p.id, value: "block" })), "ok", "D4: the GM may still grant the block");
  eq(T.top().data.def?.H1?.defence, "block", "D4: and it stands");
}

/* ================================================================== D5: who cannot dodge a shot cannot dodge a blast [B2922] */
{
  const mk = () => { const T = fight({ N1: { health: 6 } }); T.weapons.gun = { id: "gun", bonus: 1, damage: 2, range: [0, 2] }; return T; };
  for (const s of [null, "snared", "grappled", "stunned", "unaware", "unconscious", "dead", "immobilised", "trapped"]) {
    const add = (T) => (s ? T.gm({ op: "statusAdd", combatant: "H1", status: { id: s, ...(s === "grappled" ? { data: { by: "N2" } } : {}) } }) : null);
    const T = mk(); await add(T); T.turn("N1");
    await T.gm(decl("N1", "shoot", ["H1"], { weapon: "gun" }));
    const shot = opts(T.prompt("reaction", "H1")).includes("dodge");
    const U = mk(); await add(U);
    await U.gm({ op: "hazardRun", run: { type: "blast", rating: 6, targets: ["H1"] } });
    const blast = opts(U.prompt("hazardDodge", "H1")).includes("dodge");
    eq(blast, shot, `D5: ${s ?? "free"}: a blast is dodged exactly when a shot is`);
    eq(blast, s === null || s === "trapped", `D5: ${s ?? "free"}: dodge ${s === null || s === "trapped" ? "offered" : "not offered"}`);
  }
  /* the dodge that was offered is asked again when it is taken */
  const T = mk();
  await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6, targets: ["H1"] } });
  const p = T.prompt("hazardDodge", "H1");
  await T.req("p1", { op: "mark", actor: "H1", unit: "quick" }); await T.req("p1", { op: "mark", actor: "H1", unit: "quick" });
  const r = await T.req("p1", { op: "answer", prompt: p.id, value: "dodge" });
  eq([code(r), why(r)], ["illegal", "noQuickAction"], "D5: a blast dodge with no action left is refused");
}

/* ================================================================== D9: the holder of a grapple moves or attacks the held one, nothing else [B2497] */
{
  const T = fight({ order: ["N1", "H1", "H2", "N2"] });
  await T.gm(decl("N1", "grapple", ["H1"])); await T.answer("p1", "reaction", "pass", "H1"); await T.roll("attack", 1);
  eq([st(T, "N1"), st(T, "H1")], ["grappling", "grappled"], "D9: the grapple stands");
  T.turn("H1"); T.turn("H2");
  await T.req("p2", decl("H2", "slugfest", ["N1"]));
  ok(!opts(T.prompt("reaction", "N1")).includes("block"), "D9: the holder is offered no block");
  eq(T.lastRequest()?.key, "attack", "D9: the attack on the holder goes to its roll");
  eq(P1.budget(T.state, "N1").quick.filter((u) => u === "used").length, 0, "D9: no quick action of the holder is spent on a defence");
}

/* ================================================================== D7: a grapple is two characters in one place [B2496-2497] */
const mv = (actor, to, extra = {}) => ({ op: "move", actor, to, ...extra });
const FLY = [{ mode: "flight", tier: "basic" }];
const drain = async (T, pick = {}) => { for (let i = 0; i < 10 && T.prompts().length; i++) { const p = T.prompts()[0]; if (code(await T.gm({ op: "answerFor", prompt: p.id, value: pick[p.kind] ?? p.options?.[0]?.id })) !== "ok") break; } };
{
  const city = () => { const T = new MTable(); T.hero("H1", "p1", { attrs: { strength: 6 } }).hero("H2", "p2", { attrs: { strength: 6 } }).npc("N1", { health: 12 }).npc("N2", { health: 12, attrs: { strength: 6 } }); for (const c of ["H1", "H2", "N1", "N2"]) T.put(c, "z1"); T.order(["N1", "H1", "H2", "N2"]); return T; };
  const grab = async (T) => { await T.gm(decl("N1", "grapple", ["H1"])); await T.answer("p1", "reaction", "pass", "H1"); await T.roll("attack", 1); await drain(T); };
  const knock = async (T, by, user, t) => {
    await T.req(user, decl(by, "slugfest", [t])); if (T.prompt("reaction", t)) await T.answer("gm", "reaction", "pass", t);
    await T.roll("attack", 2); await T.req(user, { op: "answer", prompt: T.prompt("stunts").id, value: [`knockback@${t}`] });
    await drain(T, { knockDir: "to:z2", direction: "go" });
  };
  { const T = city(); await grab(T);
    eq([st(T, "N1"), st(T, "H1")], ["grappling", "grappled"], "D7: the grapple stands");
    T.turn("H1"); T.turn("H2"); await knock(T, "H2", "p2", "N1");
    ok(T.spot("N1") !== "z1" && T.spot("H1") === "z1", "D7: the holder is knocked out of the zone, the held one stays");
    eq([st(T, "N1"), st(T, "H1")], ["", ""], "D7: the grapple ends for both");
    eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "D7: the knockback is undone");
    eq([st(T, "N1"), st(T, "H1"), T.spot("N1")], ["grappling", "grappled", "z1"], "D7: and the grapple is back with the holder"); }
  { const T = city(); await grab(T);                                                              // the mirror: the held one is knocked away
    T.turn("H1"); T.turn("H2"); T.turn("N2"); await knock(T, "N2", "gm", "H1");
    ok(T.spot("H1") !== "z1" && T.spot("N1") === "z1", "D7: the held one is knocked out of the zone, the holder stays");
    eq([st(T, "N1"), st(T, "H1")], ["", ""], "D7: the grapple ends for both (the held one thrown)"); }
  { const T = city(); await grab(T);                                                              // the holder's own move pulls the held one along [B2497]
    eq(code(await T.gm(mv("N1", "z2"))), "ok", "D7: the holder moves");
    eq([T.spot("N1"), T.spot("H1"), st(T, "N1"), st(T, "H1")], ["z2", "z2", "grappling", "grappled"], "D7: the held one is pulled along and stays held"); }
}

/* ================================================================== D12: a carry ends when the pair parts; only an ally is carried [B2392] */
{
  const air = () => { const T = new MTable(); T.hero("H1", "p1", { movement: FLY }).hero("H2", "p2").npc("N1", { health: 5 }); T.put("H1", "z1").put("H2", "z1").put("N1", "z3"); T.order(["H1", "H2", "N1"]); return T; };
  { const T = air();
    eq(code(await T.req("p1", mv("H1", "z2:elevated", { mode: "flight", carry: ["H2"] }))), "ok", "D12: a flyer carries an ally aloft");
    eq([st(T, "H1"), st(T, "H2")], ["airborne,carrying", "airborne,carried"], "D12: both carry the marks while they stay in the air");
    await T.gm({ op: "nextTurn" });
    eq(code(await T.req("p2", mv("H2", "z2"))), "ok", "D12: the carried one gets down by itself");
    eq([st(T, "H1"), st(T, "H2")], ["", ""], "D12: the carry is over for both");
    eq(code(await T.req("p2", mv("H2", "z1"))), "ok", "D12: and it walks on");
    await T.gm({ op: "nextTurn" }); for (let i = 0; i < 6 && T.state.init.curMember !== "H1"; i++) await T.gm({ op: "nextTurn" });
    eq(code(await T.req("p1", mv("H1", "z3:elevated", { mode: "flight" }))), "ok", "D12: the flyer moves on alone"); }
  { const T = air();                                                                              // a stale mark from before the fix never pins the carrier
    await T.req("p1", mv("H1", "z2:elevated", { mode: "flight", carry: ["H2"] })); T.put("H2", "z5");
    await T.gm({ op: "nextTurn" }); for (let i = 0; i < 6 && T.state.init.curMember !== "H1"; i++) await T.gm({ op: "nextTurn" });
    eq(code(await T.req("p1", mv("H1", "z3:elevated", { mode: "flight" }))), "ok", "D12: a carrier whose passenger is elsewhere still moves");
    eq([st(T, "H1"), st(T, "H2")], ["", ""], "D12: and the stale marks go when it arrives"); }
  { const T = air(); T.put("N1", "z1");
    const r = await T.req("p1", mv("H1", "z2:elevated", { mode: "flight", carry: ["N1"] }));
    eq([code(r), why(r), r.error?.params?.gmMayAllow], ["illegal", "carryUnwilling", 1], "D12: a player does not carry an enemy; the GM may allow it");
    eq([T.spot("N1"), st(T, "N1")], ["z1", ""], "D12: the enemy stays where it was");
    const g = await T.req("p1", { ...mv("H1", "z2:elevated", { mode: "flight", carry: ["N1"] }), decl: { exception: { text: "I grab him" } } });
    eq([code(g), T.prompt("exception")?.to], ["ok", "gm"], "D12: asked as an exception it becomes a card for the GM"); }
}

/* ================================================================== D6: Vulnerable doubles the damage and takes the Armor away, whatever deals it [B2193] */
{
  const suit = [{ id: "suit", armor: 3 }];
  const run = async (vul, how) => {
    const T = fight({ H1: { health: 20, armor: suit, vulnerabilities: vul } });
    if (how === "fire") { T.dice.push([6, 6, 1, 1, 1, 1]); await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 6 }, targets: ["H1"] }); }
    if (how === "blast") { T.dice.push([6, 1, 1, 1, 1, 1]); await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6, source: "fire", targets: ["H1"] } }); await T.answer("p1", "hazardDodge", "pass", "H1"); }
    if (how === "area") { T.dice.push([6, 1, 1, 1]); await T.gm({ op: "hazardRun", run: { type: "area", pool: 4, damage: 4, source: "fire", targets: ["H1"] } }); if (T.prompt("hazardDodge", "H1")) await T.answer("p1", "hazardDodge", "pass", "H1"); }
    if (how === "fixed") await T.gm({ op: "hazard", hazard: { kind: "fixed", amount: 4, armor: true, source: "fire" }, targets: ["H1"] });
    return [T.state.stack.length, 20 - T.c.H1.health];
  };
  eq(await run([], "fire"), [0, 1], "D6: fire, two sixes, Armor 3: 1 damage");
  eq(await run(["fire"], "fire"), [0, 8], "D6: fire against one vulnerable to fire: 4 doubled, no Armor");
  eq(await run([], "blast"), [0, 0], "D6: Blast 6 on Armor 3: nothing gets through");
  eq(await run(["fire"], "blast"), [0, 6], "D6: a fire blast against one vulnerable to fire: 3 doubled, no Armor");
  eq(await run(["cold"], "blast"), [0, 0], "D6: a vulnerability to something else changes nothing");
  eq(await run([], "area"), [0, 1], "D6: an area hazard of Damage 4 on Armor 3: 1 damage");
  eq(await run(["fire"], "area"), [0, 8], "D6: the same against one vulnerable to its source: 8");
  eq(await run(["fire"], "fixed"), [0, 8], "D6: fixed damage did it already");
  /* sibling: the Armor that counts against a hazard is the one that works against its source [B2682] */
  const T = fight({ H1: { health: 20, armor: [{ id: "asbestos", armor: 3, only: ["fire"] }] } });
  T.dice.push([6, 6, 1, 1, 1, 1]); await T.gm({ op: "hazard", hazard: { kind: "fire", intensity: 6 }, targets: ["H1"] });
  eq(20 - T.c.H1.health, 1, "D6: Armor that works only against fire counts against a fire attack");
  const U = fight({ H1: { health: 20, armor: [{ id: "vest", armor: 3, only: ["kinetic"] }] } });
  U.dice.push([6, 6, 1, 1, 1, 1]); await U.gm({ op: "hazard", hazard: { kind: "fire", intensity: 6 }, targets: ["H1"] });
  eq(20 - U.c.H1.health, 4, "D6: Armor that works only against blows does not");
}

/* ================================================================== D8: one holds off instead of one's turn, not after part of it [B2281-2283] */
{
  const sid = (T, m) => T.state.init.slots.find((s) => s.members.includes(m)).id;
  const T = fight({ N1: { health: 6 } });
  await T.req("p1", decl("H1", "slugfest", ["N1"])); await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 0);
  const r = await T.req("p1", { op: "holdOff", actor: "H1", with: sid(T, "H2") });
  eq([code(r), why(r)], ["illegal", "turnUsed"], "D8: no holding off after an action of the turn");
  eq(T.state.init.curMember, "H1", "D8: the turn stays where it was");
  eq(code(await T.gm({ op: "holdOff", actor: "H1", with: sid(T, "H2"), force: true })), "ok", "D8: the GM may still swap the cards by force");
  /* [B2283]: interrupts spent earlier do not use the turn, not even both of them */
  const U = fight({ N1: { health: 6 }, order: ["N1", "H1", "H2", "N2"] });
  await U.req("p1", { op: "mark", actor: "H1", unit: "quick" }); await U.req("p1", { op: "mark", actor: "H1", unit: "quick" });
  U.turn("H1");
  eq(code(await U.req("p1", { op: "holdOff", actor: "H1", with: sid(U, "H2") })), "ok", "D8: with both quick actions spent as interrupts one still holds off");
  eq(U.state.init.curMember, "H2", "D8: the partner has the turn");
}

/* ================================================================== D10: what is due at the start of a turn comes before the turn's actions (spec 4.4) [B2889] */
{
  const endTurn = (T, user, actor) => T.req(user, { op: "endTurn", actor, round: T.state.round, slot: T.state.init.cur, ...(user === "gm" ? { force: true } : {}) });
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2", { attrs: { strength: 5 } }).npc("N1", { health: 6, damage: 5 });
  T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 3, maxResolve: 3, name: "Toxin" });
  T.order(["H1", "N1", "H2"]).turn("H1");
  await T.gm({ op: "challengeSetup", challenge: "CH", preset: "toxicAccident" });
  await endTurn(T, "p1", "H1"); await endTurn(T, "gm", "N1");
  const q = T.prompt("triggerQueue");
  ok(!!q && T.state.init.curMember === "H2", "D10: H2's turn opens with the toxin due");
  const r = await T.req("p2", decl("H2", "slugfest", ["N1"]));
  eq([code(r), why(r)], ["busy", "triggersFirst"], "D10: no action before the trigger is resolved");
  eq(code(await T.req("p2", { op: "move", actor: "H2", to: "z2" })) === "ok", false, "D10: no move either");
  eq(code(await T.req("p2", { op: "other", actor: "H2", text: "x" })), "busy", "D10: nor 'something else'");
  eq([P1.budget(T.state, "H2").full, T.state.stack.length], ["open", 0], "D10: nothing was spent, nothing is open");
  await T.gm({ op: "answer", prompt: q.id, value: { order: q.options.map((o) => o.id) } });
  await T.roll("save", 0);
  eq(P1.budget(T.state, "H2").full, "lost", "D10: the failed STRENGTH roll takes the full action that is still there");
  eq(code(await T.req("p2", decl("H2", "slugfest", ["N1"]))), "noAction", "D10: and the attack is not available this turn");
  eq(code(await T.req("p2", decl("H2", "banter", ["N1"]))), "ok", "D10: a quick action is");
}

/* ================================================================== D19: 'something else' from a player who is not on turn holds nobody */
{
  const T = fight();
  const r = await T.req("p2", { op: "other", actor: "H2", text: "I shout a warning" });
  eq([code(r), T.state.stack.length], ["ok", 0], "D19: off turn it opens no instance");
  const card = T.prompts().find((p) => p.kind === "exception" && p.about === "H2");
  eq([card?.to, card?.data?.text], ["gm", "I shout a warning"], "D19: the GM gets a card with the text");
  eq(code(await T.req("p1", decl("H1", "slugfest", ["N1"]))), "ok", "D19: the player on turn declares");
  await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 0);
  eq(code(await T.req("p1", { op: "endTurn", actor: "H1", round: T.state.round, slot: T.state.init.cur })), "ok", "D19: and ends the turn");
  const U = fight();
  eq([code(await U.req("p1", { op: "other", actor: "H1", text: "x" })), U.state.stack.map((i) => `${i.flow}/${i.status}`).join()], ["ok", "other/manual"], "D19: on one's own turn it is an action the GM runs, as before");
}

/* ================================================================== D11: the full auto flag of the declare panel reaches the executor [B2543] */
{
  const mk = () => { const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.weapons.smg = { id: "smg", bonus: 1, damage: 2, range: [0, 2], sharp: true, fullAuto: true }; T.order(["H1", "N1", "N2"]).turn("H1"); return T; };
  const sent = { op: "declare", actor: "H1", decl: { action: "shoot", targets: ["N1", "N2"], weapon: "smg", fullAuto: true } };      // what the declare panel builds (ui/model-pure armsOf)
  const n = Relay.normalize(sent, { staff: false });
  eq(n.req?.decl?.fullAuto, true, "D11: the relay keeps the flag");
  const T = mk();
  eq(code(await T.req("p1", n.req)), "ok", "D11: a player fires full auto at two targets");
  eq([T.top()?.decl?.fullAuto, T.top()?.decl?.targets], [1, ["N1", "N2"]], "D11: the declaration carries it");
  eq(Relay.normalize({ ...sent, decl: { ...sent.decl, fullAuto: "yes" } }, { staff: false }).req?.decl?.fullAuto, undefined, "D11: anything else is still dropped");
  eq(Relay.normalize({ ...sent, decl: { ...sent.decl, fullAuto: ["N1"] } }, { staff: false }).req?.decl?.fullAuto, ["N1"], "D11: the older list form still passes");
}

/* ================================================================== D14: every choice of the kit survives the way to the executor [B1813-1815] */
{
  const item = (name, type, level) => ({ id: "it", name, type, level, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  let longest = "", n = 0;
  for (const [type, name] of NAMES) for (const level of LEVELS) {
    let kit; try { kit = Kit.build({ items: [item(name, type, level)], attrs: { fighting: 4, agility: 4, strength: 4, reason: 4, intuition: 4, presence: 4 } }); } catch { continue; }
    for (const a of kit.actions ?? []) for (const p of Array.isArray(a.pick) ? a.pick : []) { n++; if (String(p).length > longest.length) longest = String(p); }
  }
  ok(n > 50 && longest.length > 24, "D14: the kit has choices longer than the old limit");
  ok(longest.length <= Eng.OPT_MAX, `D14: no choice of the kit is longer than the engine keeps (${longest.length} <= ${Eng.OPT_MAX})`);
  eq(Relay.normalize({ op: "declare", actor: "H1", decl: { action: "x", opt: longest } }, { staff: false }).req?.decl?.opt, longest, "D14: the relay passes the longest one whole");
  for (const level of ["massive", "monstrous"]) {
    const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); const c = T.c.H1; c.kit = Kit.build({ items: [item("Summoning", "power", level)], attrs: c.attrs }); c.pass = c.kit.pass; T.order(["H1", "N1"]).turn("H1");
    const a = c.kit.actions.find((x) => x.id.endsWith("-summon")), pick = a.pick[a.pick.length - 1], long = a.pick.reduce((m, p) => (p.length > m.length ? p : m), "");
    const r = await T.req("p1", Relay.normalize({ op: "declare", actor: "H1", decl: { action: a.id, opt: long, text: "wolves" } }, { staff: false }).req);
    eq([code(r), why(r)], ["ok", null], `D14: Summoning at ${level}: the longest feature combination (${long.length} characters) is declared`);
    ok(pick.length > 0, "D14: (fixture) the action offers combinations");
  }
}

/* ================================================================== D18: who helped an action still helps it after it is amended [B2238] */
{
  const T = fight({ N1: { health: 9 }, N2: { health: 9 } });
  await T.req("p1", decl("H1", "slugfest", ["N1"]));
  const inst = T.top().id;
  eq(code(await T.req("p2", { op: "help", inst, helper: "H2" })), "ok", "D18: H2 helps");
  eq(code(await T.req("p1", { op: "amend", inst, decl: { action: "slugfest", targets: ["N2"] } })), "ok", "D18: H1 changes the target");
  eq([T.top().decl.helpers, P1.budget(T.state, "H2").full], [[{ id: "H2", consent: "yes" }], "used"], "D18: the helper stays with the action it paid for");
  await T.answer("gm", "reaction", "pass", "N2");
  const q = T.requests.filter((x) => x.key === "attack").pop();
  eq(q?.pool?.mods.filter((m) => m.source === "help").map((m) => m.dice), [1], "D18: and its die is in the roll");
  const U = fight();
  await U.req("p1", decl("H1", "slugfest", ["N1"]));
  await U.req("p2", { op: "help", inst: U.top().id, helper: "H2" });
  const r = await U.req("p1", { op: "amend", inst: U.top().id, decl: { action: "slugfest", targets: ["H2"] } });
  eq([code(r), why(r), U.top().decl.targets], ["illegal", "helpTarget", ["N1"]], "D18: an action is not turned against its own helper");
}

/* ================================================================== D13: bonus dice for a block or a dodge reach the defence roll [B1634] */
{
  const plan = (holder, rolls, more = {}) => ({ op: "tokenAdd", token: { id: `tk${holder}${rolls.join("")}`, holder, dice: 2, scope: { rolls }, uses: "all", source: { kind: "power", name: "Action Plan", owner: "H1" }, expires: { at: "nextTurnOf", who: "H1" }, ...more } });
  const defDice = async (T, how = "block", value = how) => {
    T.turn("N1"); await T.gm(decl("N1", how === "block" ? "slugfest" : "shoot", ["H2"], how === "block" ? {} : { weapon: "gun" }));
    const p = T.prompt("reaction", "H2"); await T.req("p2", { op: "answer", prompt: p.id, value }); await T.roll("attack", 1);
    return T.requests.filter((x) => x.key === "def:H2").pop();
  };
  const mk = () => { const T = fight(); T.weapons.gun = { id: "gun", bonus: 1, damage: 2, range: [0, 2] }; return T; };
  { const T = mk(); await T.gm(plan("H2", ["block", "dodge"]));
    const q = await defDice(T);
    eq([q?.dice, q?.pool?.mods.map((m) => m.dice)], [T.c.H2.attrs.fighting + 2, [2]], "D13: the plan to defend adds its dice to a block, unasked");
    ok(T.state.tokens.some((k) => k.holder === "H2"), "D13: a standing die is not used up"); }
  { const T = mk(); await T.gm(plan("H2", ["block", "dodge"]));
    const q = await defDice(T, "dodge");
    eq(q?.dice, T.c.H2.attrs.agility + 2, "D13: and to a dodge"); }
  { const T = mk(); await T.gm(plan("H2", ["attack"]));
    const q = await defDice(T);
    eq(q?.dice, T.c.H2.attrs.fighting, "D13: a plan to attack adds nothing to a defence");
    const U = mk(); await U.gm(plan("H2", ["attack"])); U.turn("H2"); await U.req("p2", decl("H2", "slugfest", ["N1"])); await U.answer("gm", "reaction", "pass", "N1");
    eq(U.requests.filter((x) => x.key === "attack").pop()?.dice, T.c.H2.attrs.fighting + 2, "D13: it stands on every attack roll, unasked, as the book has it"); }
  { /* a die the holder chooses: offered on the card, sent with the answer, spent */
    const T = mk(); await T.gm({ op: "tokenAdd", token: { id: "ea", holder: "H2", dice: 3, scope: { attrs: ["fighting", "strength", "agility"] }, uses: 1, source: { kind: "power", name: "Energy Absorption", owner: "H2" }, expires: { at: "roundEnd" } } });
    T.turn("N1"); await T.gm(decl("N1", "slugfest", ["H2"]));
    const p = T.prompt("reaction", "H2");
    eq(p.options.find((o) => o.id === "block")?.data?.tokens?.map((k) => [k.id, k.dice]), [["ea", 3]], "D13: the block option names the die that may go on it");
    const meta = { hidden: [], npc: ["N1", "N2"] }, ctx = { c: (id) => T.c[id] ?? null, online: () => true, P1 };
    const pmodel = Desk.playerModel(View.viewFor(T.state, { id: "p2", staff: false, owns: ["H2"] }, meta), { id: "p2", owns: ["H2"] }, ctx).prompts.find((x) => x.id === p.id);
    const tr = (k, prm, fb) => fb ?? k, facts = { view: { ledger: {} }, c: (id) => T.c[id] ?? null, zone: () => null };
    const bare = UiM.askData(pmodel, { t: tr, facts, own: {} });
    eq([(bare.tokens ?? []).map((k) => [k.id, k.picked]), bare.options.find((o) => o.id === "block").req.value], [[["ea", false]], "block"], "D13: the card shows the die as a chip; untouched, the answer is the plain option");
    const picked = UiM.askData(pmodel, { t: tr, facts, own: { picks: { [`tk:${p.id}`]: ["ea"] } } });
    eq([picked.tokens?.[0]?.picked, picked.options.find((o) => o.id === "block").req.value, picked.options.find((o) => o.id === "pass").req.value], [true, { id: "block", tokens: ["ea"] }, "pass"], "D13: ticked, it rides with the block and not with a pass");
    await T.req("p2", picked.options.find((o) => o.id === "block").req); await T.roll("attack", 1);
    eq(T.requests.filter((x) => x.key === "def:H2").pop()?.dice, T.c.H2.attrs.fighting + 3, "D13: the chosen die is in the block");
    ok(!T.state.tokens.some((k) => k.id === "ea"), "D13: and it is spent"); }
  { /* the bar model of a holder (the declare panel): a standing die is counted in the preview and is not a chip */
    const T = mk(); await T.gm(plan("H1", ["attack"]));
    const bar = Desk.barModel(View.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1", "N2"] }), "H1", { c: (id) => T.c[id] ?? null, online: () => true, P1 });
    eq(bar.tokens.map((k) => k.standing), [true], "D13: the bar marks the standing die");
    const pv = UiM.poolPreview({ attr: "fighting", flow: "attack", id: "slugfest" }, bar, { c: (id) => T.c[id] ?? null, attrs: (id) => T.c[id]?.attrs ?? null, view: {} }, []);
    eq(pv?.total, T.c.H1.attrs.fighting + 2, "D13: and the preview counts it"); }
}

/* ================================================================== D15: Stun may buy Double Damage to get through Armor, and nothing else [B1625] */
{
  const item = (name) => ({ id: "it", name, type: "power", level: null, power: null, boosts: [], autos: [{ id: "a", name, type: "rollAttack", show: true, attr: ["agility"], bonus: 0, stress: 0, damage: 3, min: 0, max: 3, bypass: false }], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const mk = (armor) => {
    const T = fight({ N1: { health: 6, armor: [{ id: "plate", armor }] } }), c = T.c.H1; c.kit = Kit.build({ items: [item("Stun")], attrs: c.attrs }); c.pass = c.kit.pass;
    const f0 = T.facts.bind(T); T.facts = () => { const f = f0(); return { ...f, canTalk: () => true, inZone: (cid) => ["H1", "H2", "N1", "N2"].filter((x) => x !== cid), weapon: (cid, ref) => T.c[cid]?.kit?.weapons?.find((w) => w.id === ref) ?? f.weapon(cid, ref) }; };
    return T;
  };
  const shoot = async (T, sixes) => { await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: T.c.H1.kit.weapons[0].id })); await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", sixes); };
  { const T = mk(3);
    eq(T.c.H1.kit.weapons[0].stunts, "doubleOnly", "D15: the Stun row allows Double Damage only");
    await shoot(T, 3);
    const sp = T.prompt("stunts");
    eq(sp?.options.map((o) => o.id), ["doubleDamage@N1"], "D15: the stunt card offers Double Damage on the target, and no bystander (nothing brings one in)");
    await T.req("p1", { op: "answer", prompt: sp?.id, value: ["doubleDamage@N1"] });
    eq(T.lastRequest()?.key, "ohs:N1", "D15: doubled, Damage 3 gets through Armor 3: the PRESENCE roll is asked");
    if (T.lastRequest()?.key === "ohs:N1") await T.roll("ohs:N1", 0);
    eq([st(T, "N1"), T.c.N1.health, !!T.state.ledger.N1.lostTurn], ["stunned", 6, true], "D15: failed: the next turn is lost, no damage is done"); }
  { const T = mk(3); await shoot(T, 1);
    eq([T.state.stack.length, st(T, "N1"), T.requests.some((q) => q.key === "ohs:N1")], [0, "", false], "D15: without the stunt Damage 3 does not get through Armor 3"); }
}

/* ================================================================== D16: Hidden path: the pursuer rolls too, or the chase is over [B3473] */
{
  const run = async (preySixes, pursuerSixes) => {
    const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.order(["H1", "N1"]);
    await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 3, obstacles: true });
    T.dice.push([6, 3]); await T.gm({ op: "chaseRound" });
    const asked = [];
    for (let i = 0; i < 10 && T.top(); i++) {
      const p = T.prompts()[0];
      if (p) { await T.gm({ op: "answerFor", prompt: p.id, value: p.options[0].id }); continue; }
      const pend = Object.values(T.top().rolls).find((r) => r.sixes == null && r.forced == null);
      if (!pend) break;
      asked.push(`${pend.key}:${pend.attr}`); await T.roll(pend.key, pend.key === "obs:prey" ? preySixes : pend.key === "obs:pursuer" ? pursuerSixes : 0);
    }
    return [asked.join(" "), T.state.chase?.over ?? T.state.chase?.last?.escaped ?? null, T.state.chase?.last?.obstacle ?? null];
  };
  eq(await run(1, 0), ["obs:prey:intuition obs:pursuer:intuition", "hiddenPath", "hiddenPath"], "D16: the prey finds the path, the pursuer does not: the chase is over, no chase roll");
  eq((await run(1, 1))[0], "obs:prey:intuition obs:pursuer:intuition prey:agility pursuer:agility", "D16: both find it: the round goes on to the chase roll");
  eq((await run(0, 0))[0], "obs:prey:intuition prey:agility pursuer:agility", "D16: the prey does not find it: the pursuer is not asked");
}

/* ================================================================== D17: a chase obstacle that takes dice from all AGILITY rolls takes them from the crew's too [B3455], [B3461] */
{
  const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
  const run = async (d66, attackOf = "shoot") => {
    const T = new Table();
    T.hero("H1", "p1").hero("H2", "p2").npc("N1", { attrs: { agility: 4 } }).npc("N2");
    T.add("V1", car({ name: "Van" })).add("V2", car({ name: "Bike" }));
    T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
    T.order(["H1", "N1", "H2", "N2"]).turn("H1");
    await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true }); await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H2", role: "passenger" } });
    await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true }); await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N2", role: "passenger" } });
    await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2, obstacles: true });
    T.dice.push(d66); await T.gm({ op: "chaseRound" });
    for (let i = 0; i < 10 && T.top()?.flow === "chase"; i++) { const p = T.prompts()[0]; if (p) { await T.gm({ op: "answerFor", prompt: p.id, value: p.options[0].id }); continue; } const pend = Object.values(T.top().rolls).find((r) => r.sixes == null); if (!pend) break; await T.roll(pend.key, 1); }
    await T.req("p2", decl("H2", "shoot", ["N2"], { weapon: "gun" }));
    const rp = T.prompt("reaction", "N2"), canDodge = opts(rp).includes("dodge");
    if (canDodge) await T.answer("gm", "reaction", "dodge", "N2"); else if (rp) await T.answer("gm", "reaction", "pass", "N2");
    const q = T.requests.filter((x) => x.key === "attack").pop();
    if (canDodge) await T.roll("attack", 1);
    const dq = canDodge ? T.requests.filter((x) => x.key === "def:N2").pop() : null;
    return { obstacle: T.state.chase.last?.obstacle, shot: q?.dice, shotMods: (q?.pool?.mods ?? []).map((m) => m.source).sort().join(), dodge: dq ? [dq.dice, (dq.pool?.mods ?? []).map((m) => m.dice)] : null, agi: T.c.H2.attrs.agility, nagi: T.c.N2.attrs.agility };
  };
  const clear = await run([1, 1]), fog = await run([4, 3]), shaky = await run([5, 1]);
  eq([clear.obstacle, clear.shot], ["clear", clear.agi + 1], "D17: all clear: the crew shoots with AGILITY and the weapon");
  eq([fog.obstacle, fog.shot, fog.shotMods], ["cantSee", fog.agi + 1 - 2, "cantSee,weapon"], "D17: Can't see a thing: -2 dice on the crew's shot");
  eq([shaky.obstacle, shaky.shot, shaky.shotMods], ["unsteady", shaky.agi + 1 - 2, "unsteady,weapon"], "D17: Unsteady: -2 dice on the crew's shot");
  if (fog.dodge) eq(fog.dodge, [Math.max(1, fog.nagi - 2), [-2]], "D17: and on a dodge of that round"); else ok(clear.dodge === null, "D17: (no dodge offered in this set-up)");
}

/* ================================================================== the catch of a chase: no block [B3434]; a charge is still dodged [B2492], a ram is not */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.order(["H1", "N1"]);
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 1 });
  await T.gm({ op: "chaseRound" }); await T.roll("prey", 0); await T.roll("pursuer", 1);
  await T.req("p1", { op: "answer", prompt: T.prompt("chaseCatch").id, value: "attack" });
  eq(all(T.prompt("reaction", "N1")), "dodge pass", "catch: the charge that ends a chase offers a dodge and no block");
  await T.answer("gm", "reaction", "dodge", "N1"); await T.roll("attack", 1);
  eq([T.lastRequest()?.key, T.lastRequest()?.attr], ["def:N1", "agility"], "catch: the prey dodges with AGILITY");
}

/* ================================================================== spec 10: a hidden combatant does not exist for a player's request */
{
  const mk = () => { const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }).npc("N2", { health: 6, hidden: true }); T.weapons.gun = { id: "gun", bonus: 1, damage: 2, range: [0, 2] }; T.order(["H1", "N1", "H2", "N2"]); return T; };
  const answer = (env) => JSON.stringify([env?.error?.code ?? (env?.ok ? "ok" : "?"), env?.error?.params ?? {}]);
  const reqs = {
    slugfest: (t) => decl("H1", "slugfest", [t]), shoot: (t) => decl("H1", "shoot", [t], { weapon: "gun" }), banter: (t) => decl("H1", "banter", [t]), grapple: (t) => decl("H1", "grapple", [t]),
    "two targets": (t) => decl("H1", "slugfest", ["N1", t]), "declare as": (t) => decl(t, "slugfest", ["N1"]), mark: (t) => ({ op: "mark", actor: t, unit: "quick" }), other: (t) => ({ op: "other", actor: t, text: "x" }),
    move: (t) => ({ op: "move", actor: t, to: "z2" }), carry: (t) => ({ op: "move", actor: "H1", to: "z2", carry: [t] }), endTurn: (t) => ({ op: "endTurn", actor: t }),
  };
  for (const [name, req] of Object.entries(reqs)) {
    const T = mk(), a = await T.req("p1", req("N2")), b = await mk().req("p1", req("ZZ"));
    eq(answer(a), answer(b).replace(/ZZ/g, "N2"), `hidden: '${name}' naming a hidden NPC is answered like one naming nobody`);
    ok(!T.state.stack.some((i) => JSON.stringify(i.decl ?? {}).includes("N2")), `hidden: '${name}': no action of a player names the hidden NPC`);
  }
  { const T = mk(); await T.req("p1", decl("H1", "slugfest", ["N1"]));
    eq(answer(await T.req("p2", { op: "help", inst: T.top().id, helper: "N2" })), answer(await T.req("p2", { op: "help", inst: T.top().id, helper: "ZZ" })), "hidden: nor does it help"); }
  { const T = mk(); const G = mk(); G.turn("N2"); eq(code(await G.gm(decl("N2", "slugfest", ["H1"]))), "ok", "hidden: the GM plays it as before");
    G.turn("N1"); await G.answer("p1", "reaction", "pass", "H1"); await G.roll("attack", 0);
    const U = mk(); U.turn("N1"); eq(why(await U.gm(decl("N1", "slugfest", ["N2"]))) === "gone", false, "hidden: and names it as a target");
    T.c.N2.owners = ["p1"];
    ok(why(await T.req("p1", { op: "mark", actor: "N2", unit: "quick" })) !== "gone", "hidden: nobody is hidden from their own player"); }
}

/* ================================================================== spec 10: what an unrevealed NPC can do is not in a player's view */
{
  const T = fight();
  const meta = { hidden: [], npc: ["N1", "N2"] }, p1 = { id: "p1", staff: false, owns: ["H1"] };
  await T.gm({ op: "tokenAdd", token: { id: "npcdie", holder: "N1", dice: 3, scope: { rolls: ["attack"] }, uses: 1, source: { kind: "power", name: "Hidden Trick", owner: "N1" }, expires: { at: "sceneEnd" } } });
  await T.gm({ op: "tokenAdd", token: { id: "curse", holder: "H1", dice: -1, scope: { next: 1 }, uses: 1, forced: 1, source: { kind: "power", name: "Luck Control", owner: "N1" }, expires: { at: "roundEnd" } } });
  await T.gm({ op: "tokenAdd", token: { id: "h2die", holder: "H2", dice: 1, scope: {}, uses: 1, source: { kind: "power", name: "Aim", owner: "H2" }, expires: { at: "roundEnd" } } });
  await T.gm({ op: "effectAdd", effect: { id: "fx1", kind: "shield", source: { kind: "power", name: "Secret Shield", owner: "N1" }, holder: "N1", ends: { at: "sceneEnd" } } });
  await T.gm({ op: "effectAdd", effect: { id: "fx2", kind: "hex", source: { kind: "power", name: "Hex", owner: "N1" }, holder: "H1", ends: { at: "sceneEnd" } } });
  await T.gm({ op: "effectAdd", effect: { id: "fx3", kind: "zone", source: { kind: "power", name: "Secret Zone", owner: "N1" }, zones: ["z1"], ends: { at: "sceneEnd" } } });
  await T.gm({ op: "counterSet", key: "scene:N1:secretPower", value: 1 }); await T.gm({ op: "counterSet", key: "scene:H1:rally", value: 1 }); await T.gm({ op: "counterSet", key: "zone:z1:fire", value: 2 });
  T.turn("N1");
  await T.gm({ op: "declare", actor: "N1", decl: { action: "slugfest", targets: ["H1"], opt: "secretOpt", text: "gm note", mod: 2, pulled: 1, exploits: [{ id: "x", stress: 1 }] } });
  let v = View.viewFor(T.state, p1, meta), s = JSON.stringify(v);
  eq(v.tokens.map((k) => k.id).sort(), ["curse", "h2die"], "view: an unrevealed NPC's bonus dice are not there; a die on a hero and a hero's own are");
  eq(v.effects.map((e) => e.id).sort(), ["fx2"], "view: nor its running effects, except the one a hero is under");
  eq(Object.keys(v.counters).sort(), ["scene:H1:rally", "zone:z1:fire"], "view: nor its use counters");
  eq(Object.keys(v.stack[0].decl).sort(), ["action", "helpers", "targets"], "view: of its declaration only what the table was told");
  eq(["Hidden Trick", "Secret Shield", "Secret Zone", "secretPower", "secretOpt", "gm note"].filter((x) => s.includes(x)), [], "view: none of it anywhere in the view");
  const gmv = View.viewFor(T.state, { id: "gm", staff: true, owns: [] }, meta);
  eq([gmv.tokens.length, gmv.effects.length, gmv.stack[0].decl.opt], [3, 3, "secretOpt"], "view: the GM sees everything");
  await T.gm({ op: "reveal", combatant: "N1", powers: true });
  v = View.viewFor(T.state, p1, meta);
  eq([v.tokens.length, v.effects.length, Object.keys(v.counters).length, v.stack[0].decl.opt], [3, 3, 3, "secretOpt"], "view: once the GM reveals the NPC's powers, all of it shows");
  /* a hero's declaration is table knowledge as before */
  const U = fight(); await U.req("p2", { op: "mark", actor: "H2", unit: "quick" }); await U.req("p1", decl("H1", "slugfest", ["N1"], { mod: 0, pulled: 1 }));
  eq(View.viewFor(U.state, { id: "p2", staff: false, owns: ["H2"] }, meta).stack[0].decl.pulled, 1, "view: another hero's declaration is whole");
}

/* ================================================================== a unit that costs stress pays nothing at Resolve 0 [B2816], [B2228] */
{
  const mk = (resolve) => { const T = fight(); T.c.H1.resolve = resolve; T.c.N1.resolve = resolve; T.turn("H1"); return T; };
  const grant = async (T, cid, template) => code(await T.gm({ op: "ledgerEdit", combatant: cid, edit: "grant", grant: { template } }));
  for (const [resolve, want] of [[0, ["noAction", 0, 0]], [2, ["ok", 1, 1]]]) {
    const T = mk(resolve);
    eq([await grant(T, "H1", "quickness"), code(await T.req("p1", { op: "mark", actor: "H1", unit: "full" })), code(await T.req("p1", { op: "mark", actor: "H1", unit: "quick" }))], ["ok", "ok", "ok"], `stress unit, Resolve ${resolve}: the extra unit of Quickness is there and the base pair is spent`);
    const r = await T.req("p1", decl("H1", "slugfest", ["N1"]));
    eq([code(r), T.state.stack.length, T.c.H1.resolve], want, `stress unit, Resolve ${resolve}: the third action ${resolve ? "is paid with it, for 1 stress" : "is refused: no stress can be taken"}`);
  }
  for (const [resolve, want] of [[0, false], [2, true]]) {      /* the same for the defence a grant pays (Defender [B2105]) */
    const T = mk(resolve);
    await grant(T, "N1", "defender"); T.turn("N1");
    await T.gm({ op: "mark", actor: "N1", unit: "full" }); await T.gm({ op: "mark", actor: "N1", unit: "quick" }); T.turn("H1");
    await T.req("p1", decl("H1", "slugfest", ["N1"]));
    const p = T.prompt("reaction", "N1"), block = p?.options.find((o) => o.id === "block");
    eq(!!block && !block.disabled, want, `stress unit, Resolve ${resolve}: a block paid by a stress grant is ${want ? "offered" : "not offered"}`);
  }
}

done("check-defects");
