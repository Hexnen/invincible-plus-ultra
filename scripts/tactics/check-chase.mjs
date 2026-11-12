// node scripts/tactics/check-chase.mjs -- CHASE, CHASE2: the chase panel in the middle (ui/chase-pure.mjs; D: a complex chase, E: the line) and what the engine now exposes for it:
// the round's obstacle in a player's view (U167), the GM naming the obstacle (U176), the end of a chase as a record every seat reads
// (U168), the crew list that forgets a used shot (U172), the dock's line trimmed while the panel speaks (U169, U170). No Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as Chase from "./flows/chase.mjs";
import * as CP from "./ui/chase-pure.mjs";
import { t as say, EN, PL } from "./lang.mjs";
import { readFileSync } from "node:fs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
const raw = [], t = (k, p, fb) => { const s = say(k, p, fb === undefined ? k : fb); if (s === k) raw.push(k); return s; };
function table() {
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).npc("N1", { health: 6, damage: 5, name: "Doc" }).npc("N2", { health: 6, name: "Mauler" });
  T.add("V1", car({ name: "Car" })); T.add("V2", car({ name: "Van" }));
  T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  return T;
}
/* the panel's facts as ui/main.mjs gives them: a name, a picture, the kind, how somebody moves (CHASE2); the full facts for the GM only */
const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined,
  c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: T.c[id].kind === "vehicle" ? null : CP.wayOf(T.c[id]) } : null), userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false });
const view = (T, me, owns) => (me === "gm" ? T.state : V.viewFor(T.state, { id: me, staff: false, owns }, { hidden: [], npc: ["N1", "N2", "V1", "V2"] }));
const panel = (T, me, owns = [], own = {}) => CP.chaseData(view(T, me, owns), own, facts(T, view(T, me, owns), me), t);

/* ================================================================== A: a vehicle chase through the panel, three seats */
{
  const T = table();
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H2", role: "passenger" } });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N2", role: "passenger" } });
  eq(panel(T, "gm"), null, "A: no chase, no panel");
  eq(code(await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2, obstacles: true })), "ok", "A: the chase starts");
  const g0 = panel(T, "gm"), d0 = panel(T, "p1", ["H1"]), c0 = panel(T, "p2", ["H2"]), a0 = panel(T, "p3", []);
  eq([g0.seat, d0.seat, c0.seat, a0.seat], ["gm", "driver", "crew", "aside"], "A: the seats: GM, the driver, a passenger, somebody not in the chase");
  eq([d0.mySide, c0.mySide, a0.mySide, d0.you, c0.you], ["pursuer", "pursuer", null, EN["ITAC.chase.you.driver.pursuer"], EN["ITAC.chase.you.crew.pursuer"]], "A: each seat is told its side");
  eq([g0.phase, g0.distance.value, g0.distance.lostAt, g0.distance.toCatch, g0.distance.toEscape, g0.distance.status.id], ["before", 2, 5, 2, 4, "run"], "A: the distance and how near both ends are (lost when it exceeds 5)");
  eq(g0.sides.map((s) => [s.id, s.units.map((u) => [u.id, u.vehicle, u.people.map((p) => [p.id, p.role])])]), [["pursuer", [["V1", true, [["H1", "driver"], ["H2", "passenger"]]]]], ["prey", [["V2", true, [["N1", "driver"], ["N2", "passenger"]]]]]], "A: who sits where on each side");
  eq([g0.decision.kind, g0.decision.buttons[0].req, d0.decision], ["gmRoll", { op: "chaseRound" }, null], "A: before the round the GM's decision is the roll; a player has none");
  eq(g0.gm.ends.map((b) => [b.id, b.req.outcome]), [["escaped", "escaped"], ["caught", "caught"], ["gaveUp", "gaveUp"], ["combat", "combat"]], "A: four ways out, each says how the chase ended");
  eq(g0.gm.distance.minus, { op: "chaseSet", distance: 1 }, "A: the distance steps at once (no check mark)");
  eq(panel(T, "gm", [], { obstacle: "shortcut" }).gm.roll.req, { op: "chaseRound", obstacle: "shortcut" }, "A: the GM may name the next obstacle");

  /* the round: obstacle rolled (clear), the prey first */
  T.dice.push([1, 1]);
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "A: the GM rolls the round");
  const pv = view(T, "p1", ["H1"]), ri = pv.stack.find((i) => i.flow === "chase");
  eq([ri.data.chase?.obstacle, ri.data.chase?.d66, ri.data.chase?.pursuer?.roller, "agility" in (ri.data.chase?.pursuer ?? {})], ["clear", 11, "H1", false], "A (U167): a player's view names the round's obstacle and its D66, not the rollers' numbers");
  const g1 = panel(T, "gm"), d1 = panel(T, "p1", ["H1"]);
  eq([g1.phase, g1.obstacle?.id, g1.obstacle?.tag, g1.beats.map((b) => [b.id, b.state])], ["rolling", "clear", "D66: 11", [["obstacle", "done"], ["prey", "now"], ["pursuer", "next"], ["result", "next"]]], "A: the beats of the round in the book's order");
  eq([g1.decision.kind, g1.decision.buttons.map((b) => b.id)], ["roll", ["roll"]], "A: the prey's driver is an NPC: the GM rolls it from the panel");
  eq([d1.decision, d1.waits.length, d1.sides[1].roll.state], [null, 1, "owed"], "A: the pursuing driver waits and is told for whom");
  await T.roll("prey", 1);
  const d2 = panel(T, "p1", ["H1"]), g2 = panel(T, "gm");
  eq([d2.decision?.kind, d2.decision?.buttons.map((b) => [b.id, b.act?.do])], ["roll", [["roll", "roll"]]], "A (U166): the driver's own roll is on the panel with its button");
  eq([g2.waits.length, g2.waits[0].buttons.map((b) => b.id)], [1, ["ask", "nudge:" + T.top().id + ":pursuer"]], "A: the GM sees who is waited for, can ask again or nudge");
  await T.roll("pursuer", 3, { pushable: true });
  const d3 = panel(T, "p1", ["H1"]);
  eq([d3.decision?.kind, d3.decision?.buttons.map((b) => [b.id, b.act?.do])], ["roll", [["accept", "accept"], ["push", "push"]]], "A: a roll that may still be pushed offers accept and push on the panel");
  eq(panel(T, "gm").waits[0]?.buttons.map((b) => b.id), ["acceptFor", `nudge:${T.top().id}:pursuer`], "A: the GM may accept it for the player");
  await T.roll("pursuer", 3);
  eq([T.state.chase.distance, T.state.chase.last.winner], [0, "pursuer"], "A: two sixes more: caught");
  const d4 = panel(T, "p1", ["H1"]);
  eq([d4.decision?.kind, d4.decision?.buttons.map((b) => [b.label, b.req.op, b.req.value])], ["chaseCatch", [[EN["ITAC.action.ram"], "answer", "attack"], [EN["ITAC.opt.pass"], "answer", "pass"]]], "A (U166): the catch question is answered on the panel");
  eq([d4.distance.status.id, d4.beats.find((b) => b.id === "catch")?.state], ["caught", "now"], "A: caught, the catch is the beat now");
  const catchId = Object.values(T.state.prompts).find((p) => p.kind === "chaseCatch" && !p.answered).id;
  const dock = { prompts: [{ id: catchId }, { id: "other" }], turn: "Chase, distance 0", news: null, rolls: [], waiting: [{ who: "x", what: ["catch"], ids: [catchId] }], sum: { x: 1 } };
  const tr = CP.lineTrim(dock, view(T, "p1", ["H1"]));
  eq([tr.prompts.map((p) => p.id), tr.turn, tr.sum, tr.waiting], [["other"], "", null, []], "A (U169 / U170): while the panel speaks the line drops the chase's turn line, its card and the round summary");
  await T.answer("p1", "chaseCatch", "pass");

  /* after the roll: the crew's shot, then gone from the list (U172) */
  const c5 = panel(T, "p2", ["H2"]), g5 = panel(T, "gm");
  eq([c5.phase, c5.decision?.kind, c5.decision?.buttons[0].arm], ["after", "crew", { sel: "H2", action: "shoot" }], "A: the passenger's shot is offered on the panel and arms the dock's shot");
  eq([g5.decision.kind, /Omni/.test(g5.decision.text), /Omni/.test(g5.waits.find((w) => w.id === "crew")?.text ?? ""), g5.result.head], ["gmRoll", false, true, EN["ITAC.chase.res.caught"]],
    "A: the GM sees who may still shoot before the next roll, once: on the waiting line (with the shot buttons), not again in the roll's box");
  { const ph = T.state.phase; T.state.phase = "roundStart"; const gc = panel(T, "gm"); T.state.phase = ph;
    eq([gc.gm.roll.req, gc.gm.roll.disabled], [null, EN["ITAC.chase.gm.roundCard"]], "A: the next roll opens the next fight round, so while a round's start card is open it waits, and says so (D101)"); }
  eq(code(await T.req("p2", { op: "declare", actor: "H2", decl: { action: "shoot", targets: ["N1"], weapon: "gun" } })), "ok", "A: the shot is declared");
  await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 0);
  const c6 = panel(T, "p2", ["H2"]), g6 = panel(T, "gm");
  eq([c6.decision, g6.beats.find((b) => b.id === "crew")?.text, /Omni/.test(g6.waits.find((w) => w.id === "crew")?.text ?? ""), /Mauler/.test(g6.waits.find((w) => w.id === "crew")?.text ?? "")], [null, say("ITAC.chase.crew.left", { n: 1 }), false, true], "A (U172): a used shot leaves the list");

  /* the GM names the next obstacle (U176) */
  eq(code(await T.gm({ op: "chaseRound", obstacle: "nope" })), "badInput", "A: an unknown obstacle is refused");
  eq(code(await T.gm({ op: "chaseRound", obstacle: "shortcut" })), "ok", "A (U176): the GM names the obstacle of the round");
  eq([T.top().data.ch.obstacle, T.top().data.ch.chosen, T.prompt("chaseOption")?.about], ["shortcut", 1, "H1"], "A: no D66 is rolled; the optional roll is offered to the pursuers' driver");
  const d7 = panel(T, "p1", ["H1"]);
  eq([d7.obstacle.tag, d7.decision?.kind, d7.decision?.buttons.map((b) => b.req.value)], [EN["ITAC.chase.obstacle.chosen"], "chaseOption", ["try", "pass"]], "A: the panel says the GM chose it and asks the driver");
  await T.answer("p1", "chaseOption", "pass");
  await T.roll("prey", 0); await T.roll("pursuer", 0);
  eq([T.state.chase.distance, panel(T, "gm").gm.ends.every((b) => b.req === null)], [0, true], "A: still at 0: caught again, and nothing ends under an open question");
  await T.answer("p1", "chaseCatch", "pass");

  /* the end (U168) */
  const busy = panel(T, "gm");
  ok(busy.gm.ends.every((b) => b.req), "A: with nothing in progress the chase can end");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "escaped" })), "ok", "A: the GM ends it");
  const e1 = panel(T, "p3", []), e2 = panel(T, "p1", ["H1"]);
  eq([e1?.on, e1?.ended.outcome, e1?.ended.title, e2?.ended.n], [false, "escaped", EN["ITAC.chase.end.escaped"], 1], "A (U168): every seat, also one outside the chase, gets the end card");
  eq(panel(T, "p1", ["H1"], { endSeen: 1 }), null, "A: put away, it stays away");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "A: the end can be undone");
  eq([T.state.kind, T.state.chaseEnded ?? null, panel(T, "gm").on], ["chase", null, true], "A: and the end card goes with it");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "combat" })), "ok", "A: ended again");
  eq(T.state.chaseEnded.n, 1, "A: the number counts ends that stand");
  await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 3 });
  eq([T.state.chaseEnded ?? null, panel(T, "gm").distance.value], [null, 3], "A: a new chase takes the old end card away");
}

/* ================================================================== B: on foot, dead end */
{
  const T = table();
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 1 });
  const g = panel(T, "gm");
  eq([g.sides[0].units[0].vehicle, g.sides[0].units[0].people.map((p) => p.role), g.beats.map((b) => b.id)], [false, ["self"], ["prey", "pursuer", "result"]], "B: on foot: no obstacle beat with the table off, no crew");
  await T.gm({ op: "chaseRound", obstacle: "deadEnd" });
  const d = panel(T, "p1", ["H1"]);
  eq([d.sides[1].roll.state, d.sides[1].roll.text, d.decision?.kind], ["auto", EN["ITAC.chase.roll.auto"], "roll"], "B: a dead end: the prey fails without a roll, the pursuer rolls at once");
  await T.roll("pursuer", 1);
  const c = panel(T, "p1", ["H1"]);
  eq([c.distance.value, c.decision?.kind, c.decision?.buttons[0].label], [0, "chaseCatch", EN["ITAC.opt.charge"]], "B: on foot the catch is the charge");
}

/* ================================================================== D (CHASE2): a complex chase. Two vehicles and a flier pursue a van
   and a runner; who rolls and why, the crews in the book's order, somebody joins and drops out, a unit that cannot move, the catch */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid Omni-Man" }).hero("H2", "p2", { name: "Omni-Man" }).hero("H3", "p3", { name: "Atom Eve", movement: [{ mode: "flight", tier: "basic" }] });
  T.npc("N1", { name: "Doc Seismic" }).npc("N2", { name: "The Mauler Twins A" });
  T.add("V1", car({ name: "Guardians' van" })); T.add("V2", car({ name: "Getaway truck" })); T.add("V3", car({ name: "Pursuit bike" }));
  T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
  T.order(["H1", "N1", "H2", "N2", "H3"]).turn("H1");
  /* two more who stand outside the initiative (no card of their own): the bike's rider and a runner with a long name */
  T.npc("N3", { name: "Battle Beast" }).npc("N4", { name: "Machine Head's very long-named lieutenant", attrs: { agility: 2 } });
  for (const [v, who, role] of [["V1", "H1", "driver"], ["V1", "H2", "passenger"], ["V2", "N1", "driver"], ["V2", "N2", "passenger"], ["V3", "N3", "driver"]])
    eq(code(await T.gm({ op: "vehicleSet", vehicle: v, seat: { who, role }, ...(role === "driver" ? { started: true } : {}) })), "ok", `D: ${who} takes a seat in ${v}`);
  eq(code(await T.gm({ op: "chaseStart", prey: ["V2", "V3", "N4"], pursuer: ["V1", "H3"], distance: 3 })), "ok", "D: two pursue three");
  const g0 = panel(T, "gm"), p1 = panel(T, "p1", ["H1"]), p3 = panel(T, "p3", ["H3"]), out = panel(T, "p9", []);
  eq(g0.sides.map((s) => [s.id, s.units.map((u) => [u.id, u.people.map((p) => p.role)])]), [["pursuer", [["V1", ["driver", "passenger"]], ["H3", ["fly"]]]], ["prey", [["V2", ["driver", "passenger"]], ["V3", ["driver"]], ["N4", ["self"]]]]],
    "D: every unit of a side with its people: a van and a flier pursue; a truck, a bike and a runner flee");
  eq([g0.sides[0].roller?.id, g0.sides[0].who?.id, g0.sides[0].rolls.why, g0.sides[1].roller?.id, g0.sides[1].rolls.why, g0.sides[0].rolls.text], ["H3", "H3", EN["ITAC.chase.why.slowest"], "N4", EN["ITAC.chase.why.slowest"], say("ITAC.chase.rollsNext", { name: "Atom Eve" })],
    "D: before the round the GM sees who would roll and why: the flier (2 zones) is slower than the van (3), the runner the slowest of the fleeing");
  eq([p1.sides[0].roller, p1.sides[0].rolls.text, p3.seat, out.seat, out.you], [null, EN["ITAC.chase.why.unknown"], "driver", "aside", EN["ITAC.chase.you.aside"]],
    "D: a player is not told who will roll before the round (that reads the sheets), only that the slowest does; the flier is a seat of its own; somebody outside watches");
  eq(g0.crowd, 3, "D: the bigger side has three units (the panel draws them one line each)");
  eq([g0.gm.join.choices, g0.gm.join.none, g0.gm.join.to.map((b) => [b.req, b.disabled])], [[], EN["ITAC.chase.gm.nobodyFree"], [[null, EN["ITAC.chase.gm.nobodyFree"]], [null, EN["ITAC.chase.gm.nobodyFree"]]]], "D: everybody of the fight is in the chase: nobody to add");
  /* the round */
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "D: the GM rolls the round");
  const r1 = panel(T, "p1", ["H1"]);
  eq([r1.sides[0].roller?.id, r1.sides[0].rolls.text, r1.sides[0].rolls.why, r1.sides[1].roller?.id, r1.sides[1].rolls.why], ["H3", say("ITAC.chase.rollsBy", { name: "Atom Eve" }), EN["ITAC.chase.why.slowest"], "N4", EN["ITAC.chase.why.slowest"]],
    "D: in the round every seat is told who rolls for each side and why (no numbers)");
  eq([panel(T, "p3", ["H3"]).decision, panel(T, "gm").decision?.kind], [null, "roll"], "D: the fleeing roll first: the GM rolls the runner; the flier waits");
  await T.roll("prey", 0);
  eq(panel(T, "p3", ["H3"]).decision?.kind, "roll", "D: then the flier rolls for the pursuers, on the panel");
  await T.roll("pursuer", 3);
  eq([T.state.chase.distance, T.state.chase.last.by], [0, { prey: { unit: "N4", roller: "N4", why: "slowest" }, pursuer: { unit: "H3", roller: "H3", why: "slowest" } }], "D: caught; the round remembers who rolled for each side and why");
  const c1 = panel(T, "p2", ["H2"]), LT = "Machine Head's very long-named lieutenant";
  eq([c1.catch?.by, c1.catch?.at, c1.catch?.text], ["Atom Eve", LT, say("ITAC.chase.catch.whoCharge", { name: "Atom Eve", target: LT })], "D: the catch names who strikes (the one who rolled) and whom (the one who rolled for the fleeing)");
  eq(panel(T, "p3", ["H3"]).decision?.kind, "chaseCatch", "D: and asks the flier");
  await T.answer("p3", "chaseCatch", "pass");
  /* the crews: the pursuers' first [B3438]; the GM may arm any crew's shot */
  const a1 = panel(T, "p2", ["H2"]), g1 = panel(T, "gm");
  eq([a1.decision?.kind, a1.decision?.buttons.map((b) => b.arm)], ["crew", [{ sel: "H2", action: "shoot" }]], "D: the pursuers' passenger may shoot");
  const cw = g1.waits.find((w) => w.id === "crew");
  eq([cw?.text, cw?.buttons.map((b) => b.arm.sel)], [say("ITAC.chase.wait.crew", { names: `${say("ITAC.chase.wait.crewSide", { side: EN["ITAC.ui.chase.pursuer"], names: "Omni-Man" })}; ${say("ITAC.chase.wait.crewSide", { side: EN["ITAC.ui.chase.prey"], names: "The Mauler Twins A" })}` }), ["H2", "N2"]],
    "D: the GM sees the crews side by side, the pursuers first, and may arm each shot");
  eq(g1.beats.find((b) => b.id === "crew")?.text, say("ITAC.chase.crew.left", { n: 2 }), "D: two shots left");
  /* dropping out and joining (P8e-R8) */
  eq(code(await T.gm(g1.sides[0].units.find((u) => u.id === "H3").drop.req)), "ok", "D: the flier drops out");
  const g2 = panel(T, "gm");
  eq([g2.gm.join.choices.map((c) => c.id), g2.gm.join.to.map((b) => b.req)], [["H3"], [{ op: "chaseSet", unit: "H3", side: "pursuer" }, { op: "chaseSet", unit: "H3", side: "prey" }]], "D: and may join again, on either side");
  eq(code(await T.gm(g2.gm.join.to[0].req)), "ok", "D: the flier is back with the pursuers");
  T.npc("N5", { name: "Titan" });
  eq(code(await T.gm({ op: "chaseSet", unit: "N5", side: "prey" })), "ok", "D: a second runner joins the fleeing");
  const full = { state: T.state, facts: { c: (id) => T.c[id] } };
  eq([Chase.rollerOf(full, "prey")?.id, Chase.rollerOf(full, "prey")?.why], ["N4", "agility"], "D: two on foot tie on speed: the lower AGILITY rolls, and that is the reason given");
  /* units that cannot move: both vehicles wrecked, both runners broken -> nobody can roll for the fleeing */
  await T.gm({ op: "vehicleSet", vehicle: "V2", wrecked: true }); await T.gm({ op: "vehicleSet", vehicle: "V3", wrecked: true });
  T.c.N4.health = 0; T.c.N5.health = 0;
  const g3 = panel(T, "gm"), p1b = panel(T, "p1", ["H1"]);
  eq([g3.sides[1].units.map((u) => u.stuck), p1b.sides[1].units.map((u) => u.stuck)], [["wrecked", "wrecked", "down", "down"], ["wrecked", "wrecked", null, null]], "D: who cannot move says why (a player sees the wrecks; the GM also who is broken)");
  const noR = say("ITAC.chase.gm.noRoller", { side: EN["ITAC.ui.chase.prey"] });
  eq([g3.gm.roll.req, g3.gm.roll.disabled], [null, noR], "D: with nobody able to roll for a side the next round is not offered, and the GM is told why");
  T.c.N4.health = 6;
  eq(!!panel(T, "gm").gm.roll.req, true, "D: the runner is up again: the next round can be rolled");
  /* the last of a side cannot drop out: the chase ends instead */
  for (const u of ["V2", "V3", "N5"]) await T.gm({ op: "chaseSet", unit: u, side: null });
  eq(panel(T, "gm").sides[1].units[0].drop, { label: say("ITAC.chase.gm.drop", { name: LT }), req: null, disabled: EN["ITAC.chase.gm.dropLast"] }, "D: the last one of a side stays: the GM ends the chase instead");
  /* under a roll nobody joins or drops out (P8e-R8), the distance can still be set */
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "D: the next round");
  const g5 = panel(T, "gm");
  eq([g5.gm.join.to.every((b) => !b.req), g5.sides[0].units.every((u) => !u.drop.req && u.drop.disabled === EN["ITAC.reason.busy"]), !!g5.gm.distance.plus], [true, true, true], "D: mid-round the GM may correct the distance, not the sides");
  eq([g5.sides[1].roller?.id, g5.sides[1].rolls.why], ["N4", null], "D: a side of one: its unit rolls, no reason is needed");
  await T.roll("prey", 1); await T.roll("pursuer", 0);
  for (let k = 0; k < 5 && T.prompts().length; k++) await T.answer("gm", T.prompts()[0].kind, "pass", T.prompts()[0].about);
  /* the end card names the units, a vehicle with its driver */
  eq(code(await T.gm({ op: "chaseEnd", outcome: "gaveUp" })), "ok", "D: the GM ends the chase");
  eq(panel(T, "p9", []).ended.sides.map((s) => s.units), [[say("ITAC.ui.chase.driven", { vehicle: "Guardians' van", name: "Kid Omni-Man" }), "Atom Eve"], ["Machine Head's very long-named lieutenant"]], "D: the end card names every unit of both sides");
}

/* ================================================================== F (CHASE2 groups, OURS): pursuers in groups at different distances.
   The van (Kid driving, Omni aboard) and the flier pursue a truck; the GM splits the flier off into a group of its own, farther back. */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid Omni-Man" }).hero("H2", "p2", { name: "Omni-Man" }).hero("H3", "p3", { name: "Atom Eve", movement: [{ mode: "flight", tier: "basic" }] });
  T.npc("N1", { name: "Doc Seismic" }).npc("N2", { name: "The Mauler Twins A" });
  T.add("V1", car({ name: "Guardians' van" })); T.add("V2", car({ name: "Getaway truck" }));
  T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
  T.order(["H1", "N1", "H2", "N2", "H3"]).turn("H1");
  for (const [v, who, role] of [["V1", "H1", "driver"], ["V1", "H2", "passenger"], ["V2", "N1", "driver"], ["V2", "N2", "passenger"]])
    await T.gm({ op: "vehicleSet", vehicle: v, seat: { who, role }, ...(role === "driver" ? { started: true } : {}) });
  eq(code(await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1", "H3"], distance: 3 })), "ok", "F: the van and the flier pursue the truck, one group (the plain chase)");
  eq(T.state.chase.groups, undefined, "F: a chase starts plain: no groups in the state");
  /* the GM splits the flier off, 5 zones behind the truck */
  eq(code(await T.gm({ op: "chaseSet", unit: "H3", side: "pursuer", group: "new", distance: 5 })), "ok", "F: the GM puts the flier in a group of its own at 5");
  eq([T.state.chase.groups, T.state.chase.distance, T.state.chase.sides.pursuer], [[{ id: "g1", units: ["V1"], distance: 3 }, { id: "g2", units: ["H3"], distance: 5 }], 3, ["V1", "H3"]],
    "F: two groups, each at its own distance; the chase's distance is the nearest group's; the sides are as they were");
  { const tx = T.log.list[T.log.list.length - 1].id; eq(code(await T.gm({ op: "undo", tx })), "ok", "F: the GM undoes the split");
    eq(T.state.chase.groups, undefined, "F: undone, the chase is plain again");
    await T.gm({ op: "chaseSet", unit: "H3", side: "pursuer", group: "new", distance: 5 }); }
  eq([Chase.groupOf(T.state, "H2")?.id, Chase.groupOf(T.state, "H3")?.id, Chase.groupOf(T.state, "N1")], ["g1", "g2", null], "F: a rider is in its vehicle's group; the prey is in none");
  /* ranges on one line: the prey at 0, each group at its distance */
  const fx = Chase.facts({ range: () => ({ total: 99 }), inZone: () => [] }, () => T.state);
  eq([fx.range("H2", "N2").total, fx.range("H3", "N1").total, fx.range("H2", "H3").total, fx.range("H1", "H2").total], [3, 5, 2, 0], "F (G6): a shot from the van reaches 3, from the flier 5, between the groups 2, inside a group 0");
  /* the panel: the pursuers in groups, each with its letter, its own distance and its roller; the track shows where each stands */
  { const g = panel(T, "gm"), p3 = panel(T, "p3", ["H3"]), p9 = panel(T, "p9", []);
    eq(g.sides[0].groups.map((x) => [x.letter, x.distance, x.units.map((u) => u.id), x.roller?.id, x.lost]), [["A", 3, ["V1"], "V1", null], ["B", 5, ["H3"], "H3", null]], "F panel: group A (the van) at 3, group B (the flier) at 5, each with who rolls for it");
    eq([g.distance.value, g.distance.label, g.distance.marks.map((m) => [m.letter, m.at])], [3, EN["ITAC.chase.nearest"], [["A", 3], ["B", 5]]], "F panel: the big number is the nearest group's; under the track each group's letter at its distance");
    eq([p3.seat, p3.sides[0].groups.map((x) => x.mine), p9.sides[0].groups.map((x) => x.distance)], ["driver", [false, true], [3, 5]], "F panel: the flier's player sees her own group marked; an outsider sees both distances (table knowledge)");
    eq([g.sides[0].groups[0].units[0].group.kind, g.sides[0].groups[0].units[0].group.req, g.sides[0].groups[1].gm.minus], ["merge", { op: "chaseSet", unit: "V1", side: "pursuer", group: "g2" }, { op: "chaseSet", group: "g2", distance: 4 }],
      "F panel: the GM may put a unit alone into the other group, and step each group's distance"); }
  /* the round: no obstacles; the prey rolls once, then each group's own roller, the nearest first */
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "F: the GM rolls the round");
  eq(T.top().data.ch.groups.map((g) => [g.id, g.distance, g.roller?.roller]), [["g1", 3, "H1"], ["g2", 5, "H3"]], "F: the round names each group, the nearest first, with who rolls for it");
  await T.roll("prey", 1);
  eq(Object.keys(T.top().rolls ?? {}).filter((k) => k.startsWith("pursuer")), ["pursuer:g1"], "F: then the nearest group's roller");
  eq([panel(T, "p1", ["H1"]).decision?.kind, panel(T, "p3", ["H3"]).decision, panel(T, "gm").beats.find((b) => b.id === "pursuer")?.state], ["roll", null, "now"], "F panel: the van's driver rolls for group A; the flier waits her turn");
  eq([panel(T, "gm").sides[0].groups.map((x) => x.roller?.id), panel(T, "p9", []).sides[0].groups.map((x) => x.roller?.id)], [["V1", "H3"], ["V1", "H3"]], "F panel: in the round the GM (full state) and an outsider (view) both see each group's roller");
  await T.roll("pursuer:g1", 3);
  eq(panel(T, "p3", ["H3"]).decision?.kind, "roll", "F panel: then the flier rolls for group B");
  await T.roll("pursuer:g2", 0);
  { const g = panel(T, "gm");
    eq(g.sides[0].groups.map((x) => [x.letter, x.distance, x.moved?.text ?? null, x.lostText, x.roll.text]), [["A", 1, "3 > 1", null, say("ITAC.chase.roll.sixes", { n: 3 })], ["B", 6, "5 > 6", EN["ITAC.chase.lost.far"], say("ITAC.chase.roll.sixes", { n: 0 })]],
      "F panel: after the round each group says how far it moved and what it rolled; the flier's group says it lost them"); }
  eq([T.state.chase.groups.map((g) => [g.id, g.distance, g.lost ?? null]), T.state.chase.distance, T.state.chase.last.groups.g1, T.state.chase.last.groups.g2.lost],
    [[["g1", 1, null], ["g2", 6, "far"]], 1, { from: 3, to: 1, sixes: 3, winner: "pursuer", caught: 0 }, "far"],
    "F (G4): the van gains 2 on the truck (3 against 1), the flier loses 1 and at 6 it has lost the truck; the chase goes on at 1");
  eq([T.state.chase.last.by.groups, T.state.chase.last.escaped], [{ g1: { unit: "V1", roller: "H1", why: "only" }, g2: { unit: "H3", roller: "H3", why: "only" } }, 0], "F: the round remembers who rolled for each group; the chase is not over while one group holds on");
  eq([!!T.state.ledger.H2.grants?.some((g) => g.kind === "chaseCrew")], [true], "F: the van's passenger may shoot");
  /* the GM brings the flier back within reach (a correction) */
  eq(code(await T.gm({ op: "chaseSet", group: "g2", distance: 4 })), "ok", "F: the GM sets the flier's group at 4");
  eq(T.state.chase.groups[1], { id: "g2", units: ["H3"], distance: 4 }, "F (G7): back within reach, the group is in the chase again");
  /* round 2: the van catches the truck; the flier closes in */
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "F: round 2");
  await T.roll("prey", 0); await T.roll("pursuer:g1", 1); await T.roll("pursuer:g2", 2);
  eq([T.state.chase.groups.map((g) => g.distance), T.state.chase.last.caught, T.prompts().map((p) => [p.kind, p.about])], [[0, 2], 1, [["chaseCatch", "H1"]]], "F (G5): the van reaches the truck and may ram; the flier is 2 behind");
  await T.answer("p1", "chaseCatch", "pass");
  /* the flier joins the van's group: one group again, the plain chase */
  eq(code(await T.gm({ op: "chaseSet", unit: "H3", side: "pursuer", group: "g1" })), "ok", "F: the GM puts the flier back with the van");
  eq([T.state.chase.groups, T.state.chase.distance], [undefined, 0], "F (G7): one group left is the plain chase again, at that group's distance");
  /* hidden path: a group that fails it loses the prey; the chase ends only when every group lost it */
  await T.gm({ op: "chaseSet", distance: 3 });
  eq(code(await T.gm({ op: "chaseSet", unit: "H3", side: "pursuer", group: "new", distance: 2 })), "ok", "F: the van at 3; the flier splits off again, at 2");
  eq(code(await T.gm({ op: "chaseRound", obstacle: "hiddenPath" })), "ok", "F: round 3 with a hidden path");
  await T.answer("gm", "chaseOption", "try", "N1"); await T.roll("obs:prey", 1);
  eq(Object.keys(T.top().rolls).filter((k) => k.startsWith("obs:pursuer")), ["obs:pursuer:g2"], "F (G3): the prey found it; now each group must look for it too [B3473], the nearest first (the flier at 2)");
  await T.roll("obs:pursuer:g2", 0); await T.roll("obs:pursuer:g1", 1);
  await T.roll("prey", 0); await T.roll("pursuer:g1", 0);
  eq([T.state.chase.groups.map((g) => [g.id, g.lost ?? null]), T.state.chase.last.escaped], [[["g1", null], ["g2", "hiddenPath"]], 0], "F: the flier missed the path and lost the truck; the van found it, the chase goes on");
  /* units that cannot move: a group with nobody able does not roll; with no group able there is no round */
  await T.gm({ op: "vehicleSet", vehicle: "V1", wrecked: true });
  eq(code(await T.gm({ op: "chaseRound" })), "illegal", "F: the van is wrecked and the flier lost: no group can roll, no round");
  await T.gm({ op: "vehicleSet", vehicle: "V1", wrecked: false });
  /* plain behaviour of a distance edit in a chase of groups: it is the nearest group's */
  eq(code(await T.gm({ op: "chaseSet", distance: 4 })), "ok", "F: a plain distance edit");
  eq(T.state.chase.groups[0].distance, 4, "F (G7): in a chase of groups a plain distance edit is the nearest group's");
}

/* ================================================================== E (CHASE-6): the line over the map keeps a GM card that is not the chase's */
{
  const T = table();
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 1 });
  await T.gm({ op: "chaseRound", obstacle: "shortcut" });
  const opt = T.prompt("chaseOption");
  const dock = { prompts: [{ id: opt.id }], turn: "", news: null, rolls: [], sum: null,
    waiting: [{ who: "You", mine: true, what: ["shortcut"], ids: [opt.id] }, { who: "GM", gm: true, what: ["start of round", "shortcut (Kid)"], ids: ["trig1", opt.id] }] };
  const tr = CP.lineTrim(dock, view(T, "p1", ["H1"]));
  eq(tr.waiting, [{ who: "GM", gm: true, what: ["start of round"], ids: ["trig1"] }], "E (CHASE-6): the chase's question leaves the line; the GM's card of the round start stays");
  eq(CP.lineTrim({ ...dock, waiting: [{ who: "You", what: ["x"], ids: [opt.id] }] }, view(T, "p1", ["H1"])).waiting, [], "E: a line of nothing but the chase is empty");
  eq(CP.lineTrim({ ...dock, waiting: [{ who: "GM", what: ["x"], ids: [`${T.top().id}:prey`] }] }, view(T, "p1", ["H1"])).waiting, [], "E: an owed roll of the chase round is the panel's too");
}

/* ================================================================== C: texts and files */
{
  eq(raw.filter((k) => !/^ITAC\.ui\.chase\.obstacle\./.test(k)), [], "C: no raw key reached the panel");
  for (const k of Object.keys(EN).filter((k) => k.startsWith("ITAC.chase."))) ok(k in PL && PL[k].trim(), `C: ${k} in Polish`);
  ok(Chase.OBSTACLES.every((id) => `ITAC.chase.fx.${id}` in EN && `ITAC.ui.chase.obstacle.${id}` in EN), "C: every obstacle has a name and an effect line");
  ok(CP.WHY.every((w) => `ITAC.chase.why.${w}` in EN) && CP.STUCK.every((w) => `ITAC.chase.stuck.${w}` in EN), "C: every reason of a roller and of a unit that cannot move has its words");
  const css = readFileSync(new URL("../../styles/tactics-chase.css", import.meta.url), "utf8"), ui = readFileSync(new URL("./ui/chase.mjs", import.meta.url), "utf8");
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8"), uiMain = readFileSync(new URL("./ui/main.mjs", import.meta.url), "utf8");
  ok(/@import url\("tactics-chase\.css"\)/.test(readFileSync(new URL("../../styles/sheet-plus.css", import.meta.url), "utf8")), "C: the stylesheet is loaded");
  ok(!/data-look|itc-road|itc-board|itc-meter/.test(css + ui) && !/ChaseLook|chaseLook/.test(main + uiMain) && !("LOOKS" in CP) && !Object.keys(EN).some((k) => /ChaseLook|chase\.look\./.test(k)), "C (CHASE2): one look: the trial looks and their switch are gone (code, styles, words)");
  ok(/\.itc-dec\[data-mine\] \{[^}]*--itc-paper/.test(css) && !/\.itc-caption/.test(css), "C (CHASE2): the paper caption only for a seat with something to do");
  ok(/\[data-cut\] \{[^}]*text-overflow: ellipsis/.test(css), "C (CHASE2): long names are cut in their own box, never at the panel's edge");
}

done("check-chase");
