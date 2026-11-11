// node scripts/tactics/check-acts.mjs -- package P5: the rows of the two action tables that are neither an attack nor a move, and the
// escapes (spec 8.1, 9.7), end to end through the REAL director, engine, ledger and journal with a scripted table (no Foundry).
// Each row of spec 8.1 that this package brings has a block here that names its book lines.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as C from "./catalog-pure.mjs";
import { ACTIONS, applies, attrChoices } from "./actions-pure.mjs";
import { maneuvers } from "../rules/index.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const st = (T, cid) => M.statusesOf(T.state, cid).map((s) => s.id);
class Tbl extends Table {
  constructor(o) { super(o); this.deaf = new Set(); }
  facts() { const f = super.facts(), T = this; return { ...f, canTalk: (a, b) => (T.deaf.has(a) || T.deaf.has(b) ? false : true) }; }
}
const base = () => { const T = new Tbl(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 5 }).npc("N2", { health: 4, huge: true }); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const gmStatus = (T, cid, id, data) => T.gm({ op: "statusAdd", combatant: cid, status: { id, ...(data ? { data } : {}) } });
const closed = (T) => T.evs("actionClosed").pop()?.summary?.result;

/* ================================================================== the rows are data, and all of them are in the catalog */
{
  const ids = ["pickUp", "scan", "banter", "useItem", "usePower", "breakLift", "technology", "stabilize", "rally", "recoverResolve", "persuade", "saveBystanders", "breakFree", "escapeTrap", "escapeSnare", "escapeImmobilised", "extinguish"];
  eq(Object.keys(ACTIONS).sort(), ids.slice().sort(), "the rows this package brings");
  for (const id of ids) {
    const e = C.BUILTIN[id];
    ok(e && e.flow === "act" && e.label === `ITAC.action.${id}` && e.src.length && e.src.every((n) => Number.isInteger(n) && n > 200 && n < 3500), `${id}: a catalog row with its book lines`);
  }
  const cost = (id) => C.BUILTIN[id].cost;
  eq(["pickUp", "scan", "banter", "useItem", "breakFree", "escapeTrap"].map(cost), Array(6).fill("quick"), "the quick ones [B2305-2334], [B2496], [B2438]");
  eq(["usePower", "breakLift", "technology", "stabilize", "rally", "recoverResolve", "persuade", "saveBystanders", "escapeSnare", "escapeImmobilised", "extinguish"].map(cost), Array(11).fill("full"), "the full ones [B2337-2377], [B1606], [B1645], [B2926]");
  eq([C.BUILTIN.scan.roll.attr, C.BUILTIN.banter.roll.attr, C.BUILTIN.breakLift.roll.attr, C.BUILTIN.technology.roll.attr, C.BUILTIN.stabilize.roll.attr, C.BUILTIN.rally.roll.attr, C.BUILTIN.recoverResolve.roll.attr, C.BUILTIN.persuade.roll.attr, C.BUILTIN.extinguish.roll.attr],
    ["intuition", "presence", "strength", "reason", "reason", "presence", "presence", "presence", "agility"], "the attribute column of the two tables");
  eq(attrChoices(C.BUILTIN.escapeTrap), ["agility", "strength"], "[B2438] Trap: AGILITY or STRENGTH");
  eq(attrChoices(C.BUILTIN.saveBystanders).length, 6, "[B2374] save bystanders: varies");
  ok(applies(ACTIONS.breakFree, "a", { a: [{ id: "grappled" }] }) && !applies(ACTIONS.breakFree, "a", {}), "an escape is offered only to the one held");
  ok(applies(ACTIONS.rally, "a", {}, ["b"]) && !applies(ACTIONS.rally, "a", {}, []) && applies(ACTIONS.scan, "a", {}), "rally is offered when somebody is broken; scan always");
}

/* ================================================================== scan [B2319]: quick, INTUITION, the GM states what is found */
{
  const T = base();
  eq(code(await T.req("p1", decl("H1", "scan"))), "ok", "scan: declared");
  eq([T.top().flow, T.lastRequest().attr, T.lastRequest().dice, T.lastRequest().maxPush], ["act", "intuition", 3, null], "scan: an INTUITION roll the player may push");
  eq(P1.budget(T.state, "H1").quick.filter((q) => q === "used").length, 1, "scan: a quick action is spent");
  await T.roll("roll", 2);
  const p = T.prompt("outcome");
  eq([p?.to, p?.data?.sixes, p?.data?.suggests, p?.free], ["gm", 2, "success", 1], "scan: the outcome card goes to the GM with the sixes");
  eq(code(await T.req("p1", { op: "answer", prompt: p.id, value: "success" })), "notOwner", "scan: a player cannot answer the GM's card");
  await T.gm({ op: "answerFor", prompt: p.id, value: { id: "success", text: "a hatch under the crates" } });
  eq(T.state.stack.length, 0, "scan: closed");
  eq([closed(T), T.evs("outcome").pop()?.text], ["success", "a hatch under the crates"], "scan: the GM's words are the outcome");
}
/* ================================================================== technology [B2356], breakLift [B2353]: full, REASON / STRENGTH; the GM may overrule the dice */
{
  const T = base();
  await T.req("p1", decl("H1", "technology"));
  eq([T.lastRequest().attr, P1.budget(T.state, "H1").full], ["reason", "used"], "technology: REASON, a full action");
  await T.roll("roll", 0);
  eq(T.prompt("outcome").data.suggests, "fail", "technology: no six suggests a failure");
  await T.answer("gm", "outcome", "success");
  eq(closed(T), "success", "technology: the GM has the last word");
  const U = base();
  await U.req("p1", decl("H1", "breakLift"));
  eq([U.lastRequest().attr, U.lastRequest().dice], ["strength", 4], "breakLift: STRENGTH");
  await U.roll("roll", 1); await U.answer("gm", "outcome", "success");
  eq(U.state.stack.length, 0, "breakLift: closed");
  const before = JSON.stringify(U.state.ledger.H1);
  await U.gm({ op: "undo", tx: U.log.list[U.log.list.length - 1].id });
  ok(JSON.stringify(U.state.ledger.H1) !== before && P1.budget(U.state, "H1").full === "open", "breakLift: undo gives the full action back");
}
/* ================================================================== banter [B2784-2785], [R17] */
{
  const T = base();
  eq([code(await T.req("p1", decl("H1", "banter"))), why(T.last)], ["illegal", "noTarget"], "banter: needs an opponent");
  T.setRange("H1", "N1", 1);
  eq([code(await T.req("p1", decl("H1", "banter", { targets: ["N1"] }))), why(T.last)], ["illegal", "notSameZone"], "banter: only in the same zone");
  T.setRange("H1", "N1", 0);
  eq([code(await T.req("p1", decl("H1", "banter", { targets: ["N2"] }))), why(T.last), T.last.error.params.gmMayAllow], ["illegal", "hugeTarget", 1], "banter: typically not against a huge creature, the GM may allow");
  eq(code(await T.req("p1", decl("H1", "banter", { targets: ["N1"] }))), "ok", "banter: declared");
  eq([T.lastRequest().attr, T.lastRequest().combatant], ["presence", "H1"], "banter: the active PRESENCE roll first");
  await T.roll("roll", 3);
  const dr = T.lastRequest();
  eq([dr.key, dr.attr, dr.maxPush, dr.users], ["def:N1", "presence", 0, ["gm"]], "banter: the target rolls PRESENCE at the GM desk and cannot push [B2241]");
  const res0 = T.c.N1.resolve;
  await T.roll("def:N1", 1);
  eq([T.state.stack.length, T.c.N1.resolve, closed(T)], [0, res0 - 2, "success"], "banter: 1 stress per six more than the target");
  eq(M.counterGet(T.state, M.counterKey.round("N1", "bantered")), 1, "banter: the target is marked for the round");
  eq([code(await T.req("p1", decl("H1", "banter", { targets: ["N1"] }))), why(T.last)], ["illegal", "banteredAlready"], "banter: once per round per target");
  /* a tie fails for the active party [B2243] */
  const U = base();
  await U.req("p1", decl("H1", "banter", { targets: ["N1"] })); await U.roll("roll", 2); await U.roll("def:N1", 2);
  eq([closed(U), U.c.N1.resolve], ["fail", 5], "banter: a tie does nothing");
  /* the next round the target can be bantered again */
  eq(M.counterKey.round("N1", "bantered").startsWith("round:"), true, "banter: the mark is a per-round counter (cleared at the round start)");
}
/* ================================================================== persuade [B2371]: PRESENCE; opposed by INTUITION when resisted [B2241] */
{
  const T = base();
  await T.req("p1", decl("H1", "persuade"));
  await T.roll("roll", 1);
  ok(T.prompt("outcome") && !T.top().rolls["def:N1"], "persuade: nobody named, nobody resists; the GM states the outcome");
  await T.answer("gm", "outcome", "success");
  const U = base();
  await U.req("p1", decl("H1", "persuade", { targets: ["N1"] }));
  await U.roll("roll", 1);
  eq([U.lastRequest().key, U.lastRequest().attr], ["def:N1", "intuition"], "persuade: a named character resists with INTUITION");
  await U.roll("def:N1", 1);
  eq([U.prompt("outcome").data.suggests, U.prompt("outcome").data.net], ["fail", 0], "persuade: a tie suggests a failure");
  await U.answer("gm", "outcome", "fail");
  eq(closed(U), "fail", "persuade: closed as failed");
}
/* ================================================================== useItem [B2334], usePower [B2350]: "varies": an attribute named by the player, or no roll */
{
  const T = base();
  await T.req("p1", decl("H1", "useItem", { text: "the grappling hook" }));
  eq([T.top().step, T.requests.length, T.prompt("outcome").data.rolled, T.prompt("outcome").data.text], ["outcome", 0, 0, "the grappling hook"], "useItem: without an attribute nothing is rolled, the GM gets the words");
  await T.answer("gm", "outcome", "success");
  eq(P1.budget(T.state, "H1").quick.filter((q) => q === "used").length, 1, "useItem: quick");
  await T.req("p1", decl("H1", "usePower", { attr: "agility", text: "ice slide" }));
  eq([T.lastRequest().attr, P1.budget(T.state, "H1").full], ["agility", "used"], "usePower: the named attribute, a full action");
  await T.roll("roll", 2); await T.answer("gm", "outcome", "success");
  const U = base();
  eq([code(await U.req("p1", decl("H1", "useItem", { attr: "luck" }))), why(U.last)], ["illegal", "noAttribute"], "useItem: an unknown attribute is refused");
}
/* ================================================================== saveBystanders [B2374]: varies, karma note either way (spec 9.11) */
{
  const T = base();
  eq([code(await T.req("p1", decl("H1", "saveBystanders"))), why(T.last)], ["illegal", "noAttribute"], "saveBystanders: the attribute must be named");
  await T.req("p1", decl("H1", "saveBystanders", { attr: "agility" }));
  await T.roll("roll", 1);
  await T.gm({ op: "answerFor", prompt: T.prompt("outcome").id, value: { id: "success", text: "the bus" } });
  eq(T.state.karma.map((k) => [k.who, k.kind, k.note]), [["H1", "savedBystanders", "the bus"]], "saveBystanders: a karma note for the saved");
  const tx = T.log.list[T.log.list.length - 1].id;
  await T.gm({ op: "undo", tx });
  eq(T.state.karma.length, 0, "saveBystanders: the undo takes the note back");
  await T.req("p1", decl("H1", "saveBystanders", { attr: "strength" })); await T.roll("roll", 0); await T.answer("gm", "outcome", "fail");
  eq(T.state.karma.map((k) => k.kind), ["failedBystanders"], "saveBystanders: a failure is noted too");
}
/* ================================================================== pickUp [B2316]: quick, no roll */
{
  const T = base();
  await T.gm({ op: "itemState", item: { id: "it1", name: "pipe", owner: "N1", state: "ground", zone: "z1" } });
  eq([code(await T.req("p1", decl("H1", "pickUp", { item: "nope" }))), why(T.last)], ["illegal", "noItem"], "pickUp: an item that does not lie there");
  eq(code(await T.req("p1", decl("H1", "pickUp", { item: "it1" }))), "ok", "pickUp: declared");
  eq([T.state.stack.length, T.requests.length, T.state.items.find((i) => i.id === "it1").state, T.state.items.find((i) => i.id === "it1").holder], [0, 0, "held", "H1"], "pickUp: no roll, the item is held");
  eq(code(await T.req("p1", decl("H1", "pickUp"))), "ok", "pickUp: something the engine does not track costs the quick action all the same");
  eq(P1.budget(T.state, "H1").quick.filter((q) => q === "used").length, 2, "pickUp: both quick actions are spent");
}
/* ================================================================== rally [B2773-2775] */
{
  const T = base();
  eq([code(await T.req("p1", decl("H1", "rally"))), why(T.last)], ["illegal", "notBroken"], "rally: only a broken character");
  T.c.H2.health = 0;
  T.deaf.add("H2");
  eq([code(await T.req("p1", decl("H1", "rally", { targets: ["H2"] }))), why(T.last)], ["illegal", "cannotHear"], "rally: the other must be able to hear");
  T.deaf.clear();
  T.c.H2.crits = [9];
  eq([code(await T.req("p1", decl("H1", "rally", { targets: ["H2"] }))), why(T.last)], ["illegal", "rallyCrit"], "rally: not with an injury of 9 or worse");
  T.c.H2.crits = [4];
  await T.gm({ op: "statusAdd", combatant: "H2", status: { id: "broken" } });
  eq(code(await T.req("p1", decl("H1", "rally", { targets: ["H2"] }))), "ok", "rally: another character rolls PRESENCE");
  eq([T.lastRequest().attr, T.lastRequest().combatant, P1.budget(T.state, "H1").full], ["presence", "H1", "used"], "rally: the rallier's full action and roll");
  await T.roll("roll", 2);
  eq([T.c.H2.health, st(T, "H2"), T.c.H2.crits, T.state.stack.length], [2, [], [4], 0], "rally: 1 Health per six, no longer broken, the injury stays");
  /* the broken character itself, on its own turn */
  const U = base();
  U.c.H1.health = 0;
  eq([code(await U.req("p1", decl("H1", "scan"))), why(U.last)], ["illegal", "broken"], "a broken character does nothing else [B2707]");
  eq(code(await U.req("p1", decl("H1", "rally"))), "ok", "rally: the broken character may try on its own turn");
  await U.roll("roll", 0);
  eq([U.c.H1.health, closed(U)], [0, "fail"], "rally: no six, still broken");
  U.turn("H2");
  U.c.H2.health = 0; U.c.H2.maxHealth = 3;
  await U.req("p2", decl("H2", "rally")); await U.roll("roll", 5);
  eq(U.c.H2.health, 3, "rally: never above the maximum");
}
/* ================================================================== recoverResolve [B2818] */
{
  const T = base();
  eq([code(await T.req("p1", decl("H1", "recoverResolve"))), why(T.last)], ["illegal", "resolveFull"], "recoverResolve: nothing to recover");
  T.c.H1.resolve = 1;
  await T.req("p1", decl("H1", "recoverResolve")); await T.roll("roll", 2);
  eq([T.c.H1.resolve, P1.budget(T.state, "H1").full], [3, "used"], "recoverResolve: 1 Resolve per six, a full action");
  T.turn("H2"); T.c.H1.resolve = 4;
  await T.req("p2", decl("H2", "recoverResolve", { targets: ["H1"] })); await T.roll("roll", 3);
  eq(T.c.H1.resolve, 5, "recoverResolve: by another, never above the maximum");
}
/* ================================================================== stabilize [B2777], [B2359] */
{
  const T = base();
  T.c.H2.health = 0; T.c.H2.crits = [10];
  await T.gm({ op: "statusAdd", combatant: "H2", status: { id: "dying", data: { within: "hours" } } });
  eq([code(await T.req("p1", decl("H1", "stabilize", { targets: ["N1"] }))), why(T.last)], ["illegal", "notDying"], "stabilize: only a dying character");
  eq([code(await T.req("p1", decl("H1", "stabilize", { targets: ["H2"] }))), why(T.last), T.last.error.params.gmMayAllow], ["illegal", "needsGear", 1], "stabilize: advanced medical gear is the GM's word");
  eq(code(await T.req("p1", decl("H1", "stabilize", { targets: ["H2"], exception: { text: "the med bay is right here" } }))), "ok", "stabilize: asked as an exception");
  eq(T.prompt("exception")?.data?.reason, "needsGear", "stabilize: the GM's card names the missing gear");
  await T.answer("gm", "exception", "grant");
  eq([T.lastRequest().attr, P1.budget(T.state, "H1").full], ["reason", "used"], "stabilize: REASON, a full action");
  await T.roll("roll", 0);
  eq([st(T, "H2"), M.counterGet(T.state, M.counterKey.scene("H2", "stabilize"))], [["dying"], 1], "stabilize: a failed attempt is still the one attempt");
  T.turn("N1");
  eq([code(await T.gm(decl("N1", "stabilize", { targets: ["H2"], confirmed: ["medicalGear"] }))), why(T.last)], ["illegal", "stabilizeTried"], "stabilize: one attempt only");
  const U = base();
  U.c.H2.crits = [11]; await U.gm({ op: "statusAdd", combatant: "H2", status: { id: "dying", data: { within: "minutes" } } });
  eq(code(await U.gm(decl("H1", "stabilize", { targets: ["H2"], confirmed: ["medicalGear"] }))), "ok", "stabilize: the GM vouches for the gear");
  await U.roll("roll", 1);
  eq(st(U, "H2"), [], "stabilize: the deadline is gone");
}
/* ================================================================== breakFree [B2496]: STRENGTH against the holder's STRENGTH, quick; the holder spends nothing */
{
  const T = base();
  eq([code(await T.req("p1", decl("H1", "breakFree"))), why(T.last)], ["illegal", "notHeld"], "breakFree: only when grappled");
  await gmStatus(T, "H1", "grappled", { by: "N1" }); await gmStatus(T, "N1", "grappling", { held: "H1" });
  eq([code(await T.req("p1", decl("H1", "breakLift"))), why(T.last), T.last.error.params.status], ["illegal", "restrained", "grappled"], "grappled: nothing that needs body movement [B2496]");
  { const S = base(); await gmStatus(S, "H1", "grappled", { by: "N1" }); eq(code(await S.req("p1", decl("H1", "scan"))), "ok", "grappled: looking around is still possible"); }
  const ledN = JSON.stringify(T.state.ledger.N1);
  await T.req("p1", decl("H1", "breakFree"));
  eq([T.lastRequest().attr, T.lastRequest().dice], ["strength", 4], "breakFree: STRENGTH");
  await T.roll("roll", 1);
  eq([T.lastRequest().key, T.lastRequest().attr, T.lastRequest().maxPush], ["def:N1", "strength", 0], "breakFree: the holder answers with STRENGTH, no push");
  await T.roll("def:N1", 1);
  eq([st(T, "H1"), st(T, "N1"), closed(T)], [["grappled"], ["grappling"], "fail"], "breakFree: a tie keeps the hold [B2243]");
  eq(JSON.stringify(T.state.ledger.N1), ledN, "breakFree: no action of the holder is spent");
  await T.req("p1", decl("H1", "breakFree")); await T.roll("roll", 2); await T.roll("def:N1", 1);
  eq([st(T, "H1"), st(T, "N1"), P1.budget(T.state, "H1").quick.filter((q) => q === "used").length], [[], [], 2], "breakFree: free, both statuses end; two quick actions were spent on the tries");
  /* the holder itself: only movement and the grapple attack [B2497] */
  const U = base();
  await gmStatus(U, "H1", "grappling", { held: "N1" });
  eq([code(await U.req("p1", decl("H1", "scan"))), why(U.last), U.last.error.params.gmMayAllow], ["illegal", "holding", 1], "the holder can do nothing of this package while holding");
}
/* ================================================================== escapeTrap [B2438]: AGILITY or STRENGTH, quick, not opposed */
{
  const T = base();
  await gmStatus(T, "H1", "trapped");
  await T.req("p1", decl("H1", "escapeTrap", { attr: "agility" }));
  eq([T.lastRequest().attr, T.lastRequest().dice], ["agility", 3], "escapeTrap: the attribute the player named");
  await T.roll("roll", 0);
  eq(st(T, "H1"), ["trapped"], "escapeTrap: no six, still trapped");
  await T.req("p1", decl("H1", "escapeTrap"));
  eq(T.lastRequest().attr, "strength", "escapeTrap: nothing named: the better of the two");
  await T.roll("roll", 1);
  eq([st(T, "H1"), T.requests.filter((r) => String(r.key).startsWith("def:")).length], [[], 0], "escapeTrap: one six is enough, nobody rolls against it");
}
/* ================================================================== escapeSnare [B1606-1609], [R21]: STRENGTH with the Snare's penalty, FULL action */
{
  for (const [data, pen] of [[undefined, -2], [{ level: "major" }, -3], [{ level: "massive" }, -4], [{ level: "monstrous" }, -5], [{ dice: -1 }, -1]]) {
    const T = base();
    await gmStatus(T, "H1", "snared", data);
    await T.req("p1", decl("H1", "escapeSnare"));
    const r = T.lastRequest();
    eq([r.attr, r.pool.mods.find((m) => m.source === "snare")?.dice, r.dice, P1.budget(T.state, "H1").full], ["strength", pen, Math.max(1, 4 + pen), "used"], `escapeSnare: penalty ${pen} (${JSON.stringify(data ?? "basic")}), a full action, never below one die`);
    await T.roll("roll", 1);
    eq(st(T, "H1"), [], "escapeSnare: free");
  }
  eq(maneuvers.SNARE_ESCAPE_DICE.basic, -2, "the basic Snare penalty is the library's");
  const T = base();
  await gmStatus(T, "H1", "snared");
  eq([code(await T.req("p1", decl("H1", "pickUp"))), why(T.last)], ["illegal", "restrained"], "snared: no action that needs body movement [B1606]");
}
/* ================================================================== escapeImmobilised [B1645]: STRENGTH, full action, no penalty */
{
  const T = base();
  await gmStatus(T, "H1", "immobilised");
  await T.req("p1", decl("H1", "escapeImmobilised"));
  eq([T.lastRequest().attr, T.lastRequest().dice, T.lastRequest().pool.mods.length], ["strength", 4, 0], "escapeImmobilised: plain STRENGTH");
  await T.roll("roll", 1);
  eq([st(T, "H1"), P1.budget(T.state, "H1").full], [[], "used"], "escapeImmobilised: free, a full action");
}
/* ================================================================== extinguish [B2926]: AGILITY, full, the burning character or an ally in the same zone */
{
  const T = base();
  eq([code(await T.req("p1", decl("H1", "extinguish"))), why(T.last)], ["illegal", "notBurning"], "extinguish: nobody burns");
  await gmStatus(T, "H2", "burning");
  T.setRange("H1", "H2", 1);
  eq([code(await T.req("p1", decl("H1", "extinguish", { targets: ["H2"] }))), why(T.last)], ["illegal", "notSameZone"], "extinguish: an ally only in the same zone");
  T.setRange("H1", "H2", 0);
  await T.req("p1", decl("H1", "extinguish", { targets: ["H2"] }));
  eq([T.lastRequest().attr, T.lastRequest().combatant], ["agility", "H1"], "extinguish: the helper rolls AGILITY");
  await T.roll("roll", 0);
  eq(st(T, "H2"), ["burning"], "extinguish: no six, still burning");
  T.turn("H2");
  await T.req("p2", decl("H2", "extinguish")); await T.roll("roll", 1);
  eq([st(T, "H2"), P1.budget(T.state, "H2").full], [[], "used"], "extinguish: the burning character puts itself out with a full action");
}
/* ================================================================== the common rules: turn, cost, undo, GM overrides, push */
{
  const T = base();
  eq(code(await T.req("p2", decl("H2", "scan"))), "notYourTurn", "an action of this package needs the own turn");
  await T.req("p1", decl("H1", "technology"));
  eq(code(await T.req("p1", decl("H1", "breakLift"))), "busy", "one action at a time");
  await T.gm({ op: "setSixes", inst: T.top().id, roll: "roll", sixes: 3 });
  eq(T.prompt("outcome")?.data?.sixes, 3, "the GM sets the sixes (spec 14.1)");
  await T.answer("gm", "outcome", "success");
  eq(code(await T.req("p1", decl("H1", "breakLift"))), "noAction", "the full action is gone");
  /* the roll of an active action may be pushed: the result is final only once the system says it cannot be pushed any more */
  const U = base();
  await U.req("p1", decl("H1", "scan")); await U.roll("roll", 0, { pushable: true });
  eq([U.top().step, U.prompts("outcome").length], ["roll", 0], "a pushable roll waits for the push");
  await U.roll("roll", 1, { pushed: 1 });
  eq(U.prompt("outcome")?.data?.sixes, 1, "the pushed result counts");
  await U.gm({ op: "abort", inst: U.top().id, refund: true });
  eq([U.state.stack.length, P1.budget(U.state, "H1").quick.filter((q) => q === "used").length], [0, 0], "a veto refunds the action");
}
done("check-acts");
