// node scripts/tactics/check-defects.mjs -- the defects of dev/combat-defects.md (P8), each reproduction turned into a check that fails on
// the tree the adversaries reviewed (tag tactics-integrated-4) and passes on the fix. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as M from "./mods-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import { MTable } from "./check-kit-map.mjs";

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

done("check-defects");
