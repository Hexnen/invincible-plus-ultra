// node scripts/tactics/check-defects.mjs -- the defects of dev/combat-defects.md (P8), each reproduction turned into a check that fails on
// the tree the adversaries reviewed (tag tactics-integrated-4) and passes on the fix. Scripted table, no Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as M from "./mods-pure.mjs";
import * as P1 from "./economy-pure.mjs";

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

done("check-defects");
