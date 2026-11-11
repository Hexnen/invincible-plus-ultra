/* node scripts/tactics/check-fight.mjs -- one whole fight through the director on the REAL state: the round driver (draws, ledger,
   scheduler) and the action engine (flows, journal, modifier tokens) working on the same state object, with no stand-in.
   Round 1: start with draws (one choice of two cards), turns, a declared attack with a reaction, rolls, a stunt, damage; a turn that
   cannot end while an action is open; at the end of the round a queue of two triggers that holds the round until both instances are
   done (one resolved by the GM by hand, one a fire hazard resolved by the engine); modifier tokens, counters expiring with the round.
   Round 2: a kept card paid with stress through the engine; undo of a change of this round and of the attack of the round before. */
import { Table, seeded, ok, eq, done } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as S from "./state-pure.mjs";
import * as V from "./view-pure.mjs";

const code = (r) => (r?.ok ? "ok" : r?.error?.code ?? "?");
const T = new Table({ redraw: "everyRound" });
T.hero("H1", "p1", { veteran: true }).hero("H2", "p2", { reflexes: true }).npc("N1", { health: 5 }).npc("N2", { health: 4 });
T.rng = seeded(11);
const types = (from = 0) => T.events.slice(from).map((e) => e.type);
const order = () => T.state.init.slots.map((x) => [x.card, x.members.join("+")]);
const endTurn = (u, a) => T.req(u, { op: "endTurn", actor: a, round: T.state.round, slot: T.state.init.cur, ...(u === "gm" ? { force: true } : {}) });
const open = () => Object.values(T.state.prompts).filter((p) => !p.answered).map((p) => p.kind);

/* ---- start: the draw of round 1 */
eq(code(await T.req("p1", { op: "start", mode: "tactical", opts: {} })), "notOwner", "a player cannot start the fight");
eq(code(await T.gm({ op: "start", mode: "tactical", opts: {} })), "ok", "the GM starts tactical combat");
eq([T.state.mode, T.state.round, T.state.phase, open()], ["tactical", 1, "draw", ["reflexes"]], "round 1 waits in the draw for the one who picks from two cards");
const rp = T.prompt("reflexes");
eq([rp.to, rp.about, rp.options.length], [{ users: ["p2"] }, "H2", 2], "the choice goes to the owner of that character");
eq(code(await T.req("p1", { op: "answer", prompt: rp.id, value: rp.options[0].id })), "notOwner", "somebody else cannot pick for them");
eq(code(await T.req("p2", { op: "answer", prompt: rp.id, value: rp.options[0].id })), "ok", "the owner picks a card");
eq([T.state.phase, T.state.init.curMember, order()], ["turns", "N1", [[1, "N1"], [5, "H2"], [6, "H1"], [9, "N2"]]], "cards dealt, lowest first, the first turn begun");
eq(types(), ["combatStart", "draw", "draw", "draw", "draw", "roundStart", "turnStart"], "events of the start");
eq(T.events.map((e) => e.seq), T.events.map((_, i) => i + 1), "sequence numbers are gapless across both halves");
eq(["H1", "H2", "N1", "N2"].map((c) => P1.budget(T.state, c).full), ["open", "open", "open", "open"], "everybody has a fresh ledger");

/* ---- things that wait for the end of the round (the engine's edits, journaled, on the state the scheduler reads) */
eq(code(await T.gm({ op: "tokenAdd", token: { holder: "H1", dice: 2, scope: { rolls: ["attack"] }, source: { kind: "talent", name: "Edge" }, expires: { at: "roundEnd" } } })), "ok", "a modifier token until the end of the round");
eq(code(await T.gm({ op: "triggerAdd", trigger: { at: "roundEnd", subject: { combatant: "H2" }, run: { type: "fireAttack", intensity: 3 }, source: { kind: "gm", name: "Burning floor" } } })), "ok", "a fire attack on one combatant at the end of the round");
eq(code(await T.gm({ op: "triggerAdd", trigger: { at: "roundEnd", subject: { combatant: "N2" }, run: { type: "note" }, source: { kind: "power", owner: "N2", name: "Ward pulse" } } })), "ok", "and a trigger the engine has no flow for");
eq(code(await T.gm({ op: "counterSet", key: "round:banter:N1", value: 1 })), "ok", "a counter of this round");
eq([T.state.tokens.length, T.state.triggers.length, T.state.counters["round:banter:N1"]], [1, 2, 1], "all of it lives in the one state");

/* ---- turns up to the hero */
eq(code(await endTurn("p1", "N1")), "notOwner", "a player cannot end the NPC's turn");
eq(code(await endTurn("gm", "N1")), "ok", "the GM ends it");
ok(!(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } })).ok, "no full action out of turn");
eq(code(await endTurn("p2", "H2")), "ok", "the second hero passes");
eq(T.state.init.curMember, "H1", "the hero has the turn");

/* ---- the attack: declared, paid in the real ledger, a reaction, rolls, a stunt, damage */
const e0 = T.events.length;
eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"], tokens: [T.state.tokens[0].id] } })), "ok", "the hero declares an attack and puts the modifier token on it");
const inst = T.top().id, L = () => T.state.ledger;
eq([L().H1.entries.length, L().H1.entries[0].action, L().H1.entries[0].cost, L().H1.entries[0].inst, L().H1.entries[0].own, P1.budget(T.state, "H1").full, P1.budget(T.state, "H1").open],
  [1, "slugfest", "full", inst, 1, "used", true], "the full action is an entry of the real ledger, tied to the instance, on the hero's own turn");
eq(code(await endTurn("p1", "H1")), "busy", "the turn cannot end while the action is open");
eq(code(await T.gm({ op: "nextTurn" })), "busy", "nor can the GM move the turn on past it");
eq([T.prompt("reaction")?.to, T.prompt("reaction")?.about], ["gm", "N1"], "the defender is offered a reaction");
eq(code(await T.answer("gm", "reaction", "block", "N1")), "ok", "the defender blocks");
const be = L().N1.entries[0];
eq([be.action, be.cost, be.interrupt, be.onTurnOf, be.inst, P1.budget(T.state, "N1").quick.filter((x) => x === "open").length, P1.budget(T.state, "N1").full], ["block", "quick", 1, "H1", inst, 1, "open"],
  "the reaction is a quick action paid as an interrupt in the defender's ledger, on the attacker's turn");
eq([T.requests.at(-1).key, T.requests.at(-1).pool.mods.some((m) => m.dice === 2), T.requests.at(-1).dice], ["attack", true, 6], "the attacker is asked to roll, the modifier token in the pool");
eq(code(await T.roll("attack", 3)), "ok", "attack: three successes");
eq(code(await T.roll("def:N1", 1)), "ok", "block: one success");
const sp = T.prompt("stunts");
eq([sp.to, sp.options.some((o) => o.id === "doubleDamage@N1")], [{ users: ["p1"] }, true], "the spare successes go to the attacker as stunts");
const hp0 = T.c.N1.health;
eq(code(await T.req("p1", { op: "answer", prompt: sp.id, value: ["doubleDamage@N1"] })), "ok", "a stunt is picked");
ok(T.c.N1.health < hp0, `the defender lost Health (${hp0} -> ${T.c.N1.health})`);
eq([T.state.stack.length, open(), P1.budget(T.state, "H1").full], [0, [], "used"], "the action is closed, nothing waits, the full action stays spent");
eq(types(e0), ["ledger", "actionDeclared", "reactionWindow", "ledger", "reaction", "actionLocked", "reactionWindow", "roll", "roll", "outcome", "stunt", "damage", "actionClosed"], "events of the attack");
const atk = T.log.list.at(-1);
eq([atk.state, atk.round, /slugfest/.test(atk.label.gm), atk.ops.length > 0], ["closed", 1, true, true], "one closed transaction in the journal");
eq(T.state.tokens.length, 0, "the modifier token was spent on that roll");
eq(code(await T.gm({ op: "tokenAdd", token: { holder: "N1", dice: 1, scope: { rolls: ["attack"] }, source: { kind: "talent", name: "Second wind" }, expires: { at: "roundEnd" } } })), "ok", "another token that nobody uses this round");
{ /* the journal as a player gets it: public lines only, no operations */
  const rows = V.journalFor(T.log, { id: "p2", staff: false, owns: ["H2"] });
  eq([rows.length, rows[0].text.includes("N1"), "ops" in rows[0]], [1, false, false], "a player's journal has the attack's public line only (the GM's edits have none)");
}

/* ---- the end of the round: the queue holds the round until its instances are done */
eq(code(await endTurn("p1", "H1")), "ok", "the hero ends the turn");
T.dice.push([6, 6, 2]);                                          // the fire's dice
eq(code(await endTurn("gm", "N2")), "ok", "the last turn ends");
eq([T.state.round, T.state.phase, open()], [1, "roundEnd", ["triggerQueue"]], "the round does not end yet: the GM gets the queue of its triggers");
const q = T.prompt("triggerQueue");
eq(q.options.map((o) => o.data.type), ["fireAttack", "note"], "both triggers are in the queue, in the order they were added");
eq(code(await T.gm({ op: "nextRound" })), "busy", "the next round cannot start over an open queue");
const [fire, note] = q.options.map((o) => o.id), e1 = T.events.length;
eq(code(await T.gm({ op: "answer", prompt: q.id, value: { order: [note, fire] } })), "ok", "the GM sets the order");
eq([T.state.sched.hold, T.state.round, T.state.stack.map((i) => i.flow), T.top().status], ["1:re", 1, ["hazard", "other"], "manual"],
  "the round is held; the engine took both: the fire as a hazard, the unknown one as an instance for the GM, first in order on top");
eq([T.c.H2.health, T.state.tokens.length, T.state.counters["round:banter:N1"]], [6, 1, 1], "nothing has run or expired yet");
eq(code(await T.gm({ op: "nextRound" })), "busy", "still no next round");
eq(code(await T.req("p1", { op: "manual", inst: T.top().id, result: { note: "x" } })), "noPermission", "a player cannot resolve it");
eq(code(await T.gm({ op: "manual", inst: T.top().id, result: { note: "pulse resolved at the table" } })), "ok", "the GM resolves the first by hand");
ok(T.c.H2.health < 6, `then the fire ran by itself with the executor's dice (Health 6 -> ${T.c.H2.health})`);
ok((T.state.statuses.H2 ?? []).some((x) => x.id === "burning"), "and left its status");
eq([T.state.sched.hold ?? null, T.state.stack.length, T.state.round, T.state.phase], [null, 0, 2, "draw"], "with the stack empty the round went on by itself: round 2, the draw");
eq(types(e1), ["trigger", "trigger", "override", "actionClosed", "damage", "status", "actionClosed", "roundEnd"], "events of the end of the round");
eq([T.state.tokens.length, Object.keys(T.state.counters).length, T.state.triggers.map((t) => t.runs)], [0, 0, [1, 1]], "the scheduler dropped the round's token and counter and counted the runs");
eq(["H1", "N1"].map((c) => [P1.budget(T.state, c).full, P1.budget(T.state, c).quick.join()]), [["open", "open,open"], ["open", "open,open"]], "new ledgers for the new round");
const haz = T.log.list.at(-1);
eq([haz.state, haz.round, haz.label.gm, haz.label.pub], ["closed", 1, "{ITAC.ui.hz.kind.fire} -> H2 ({ITAC.result.done})", "{ITAC.ui.hz.kind.fire} ({ITAC.result.done})"], "the hazard is a transaction of round 1, named by what it is and whom it hit, with no raw id");

/* ---- round 2: a kept card costs stress, applied by the engine and journaled */
const vp = T.prompt("veteran");
eq([vp.to, vp.about, T.prompt("reflexes") ?? null], [{ users: ["p1"] }, "H1", null], "the one who may keep a card is asked first");
const res0 = T.c.H1.resolve;
eq(code(await T.req("p1", { op: "answer", prompt: vp.id, value: "keep" })), "ok", "the card is kept");
eq([T.c.H1.resolve, T.state.init.slots.find((x) => x.members.includes("H1")).card, T.log.list.at(-1).round, T.log.list.at(-1).state], [res0 - 1, 6, 2, "closed"], "one stress through the engine: the sheet changed, the journal has it");
eq(open(), ["reflexes"], "then the pick from two cards");

/* ---- undo */
const cut = (s) => JSON.stringify({ tokens: s.tokens, triggers: s.triggers, counters: s.counters, statuses: s.statuses, ledger: s.ledger, init: s.init, stack: s.stack, prompts: s.prompts, round: s.round, phase: s.phase });
const before = cut(T.state), n0 = T.log.list.length;
eq(code(await T.gm({ op: "tokenAdd", token: { holder: "N1", dice: -1, scope: { rolls: ["attack"] }, source: { kind: "gm", name: "Dazed" }, expires: { at: "sceneEnd" } } })), "ok", "a change of this round");
eq(code(await T.req("p1", { op: "undo", tx: T.log.list.at(-1).id })), "noPermission", "a player cannot undo");
const r1 = await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
eq([code(r1), r1.undone.length, cut(T.state) === before, T.log.list.length, T.log.list.at(-1).state], ["ok", 1, true, n0 + 1, "undone"], "undone within the round: the state is as before, the journal keeps the line");
const led = JSON.stringify(T.state.ledger), slots = JSON.stringify(T.state.init.slots);
const r2 = await T.gm({ op: "undo", tx: atk.id });
eq([code(r2), r2.undone.length], ["ok", 4], "undoing the attack of round 1 takes back everything after it first (the kept card's stress, the hazard, the GM's token, the attack)");
eq([T.c.N1.health, T.c.H2.health, T.c.H1.resolve, (T.state.statuses.H2 ?? []).length], [hp0, 6, res0, 0], "Health, Resolve and statuses are back on the sheets and in the state");
eq([T.state.round, T.state.phase, JSON.stringify(T.state.ledger) === led, JSON.stringify(T.state.init.slots) === slots, open()], [2, "draw", true, true, ["reflexes"]],
  "but the round is not rewound: round 2 goes on with its own ledgers and cards (ledger writes of the old round are skipped)");
eq(code(await T.gm({ op: "undo", tx: atk.id })), "gone", "no second undo");
eq(T.events.slice(-3).map((e) => e.type), ["undo", "undo", "undo"], "one event per undone transaction");

/* ---- the round goes on after all of it, and the state survives its own JSON */
const rp2 = T.prompt("reflexes");
eq(code(await T.req("p2", { op: "answer", prompt: rp2.id, value: rp2.options[0].id })), "ok", "the pick of round 2");
eq([T.state.phase, T.state.init.curMember != null, T.state.stack.length], ["turns", true, 0], "round 2 is in its turns");
eq(JSON.stringify(S.sanitize(JSON.parse(JSON.stringify(T.state)))), JSON.stringify(S.sanitize(T.state)), "the state round-trips through JSON and the sanitizer unchanged");
eq(T.events.map((e) => e.seq), T.events.map((_, i) => i + 1), "sequence numbers stayed gapless to the end");
done("check-fight");
