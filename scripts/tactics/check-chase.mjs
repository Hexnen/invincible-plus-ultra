// node scripts/tactics/check-chase.mjs -- CHASE: the chase panel in the middle (ui/chase-pure.mjs) and what the engine now exposes for it:
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
const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null } : null), userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false });
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
  const dock = { prompts: [{ id: Object.values(T.state.prompts).find((p) => p.kind === "chaseCatch" && !p.answered).id }, { id: "other" }], turn: "Chase, distance 0", news: null, rolls: [], waiting: [{ who: "x" }], sum: { x: 1 } };
  const tr = CP.lineTrim(dock, view(T, "p1", ["H1"]));
  eq([tr.prompts.map((p) => p.id), tr.turn, tr.sum, tr.waiting], [["other"], "", null, []], "A (U169 / U170): while the panel speaks the line drops the chase's turn line, its card and the round summary");
  await T.answer("p1", "chaseCatch", "pass");

  /* after the roll: the crew's shot, then gone from the list (U172) */
  const c5 = panel(T, "p2", ["H2"]), g5 = panel(T, "gm");
  eq([c5.phase, c5.decision?.kind, c5.decision?.buttons[0].arm], ["after", "crew", { sel: "H2", action: "shoot" }], "A: the passenger's shot is offered on the panel and arms the dock's shot");
  eq([g5.decision.kind, /Omni/.test(g5.decision.text), g5.result.head], ["gmRoll", true, EN["ITAC.chase.res.caught"]], "A: the GM sees who may still shoot before the next roll");
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

/* ================================================================== C: texts and files */
{
  eq(raw.filter((k) => !/^ITAC\.ui\.chase\.obstacle\./.test(k)), [], "C: no raw key reached the panel");
  for (const k of Object.keys(EN).filter((k) => k.startsWith("ITAC.chase."))) ok(k in PL && PL[k].trim(), `C: ${k} in Polish`);
  ok(Chase.OBSTACLES.every((id) => `ITAC.chase.fx.${id}` in EN && `ITAC.ui.chase.obstacle.${id}` in EN), "C: every obstacle has a name and an effect line");
  eq(CP.LOOKS, ["A", "B", "C"], "C: three looks");
  eq([CP.lookOf("b"), CP.lookOf("x"), CP.lookOf(null)], ["B", "A", "A"], "C: an unknown look falls back to A");
  const css = readFileSync(new URL("../../styles/tactics-chase.css", import.meta.url), "utf8");
  for (const l of ["A", "B", "C"]) ok(css.includes(`[data-look="${l}"]`), `C: the stylesheet draws look ${l}`);
  ok(/@import url\("tactics-chase\.css"\)/.test(readFileSync(new URL("../../styles/sheet-plus.css", import.meta.url), "utf8")), "C: the stylesheet is loaded");
  const ui = readFileSync(new URL("./ui/chase.mjs", import.meta.url), "utf8");
  for (const l of ["A", "B", "C"]) ok(new RegExp(`\\b${l}: `).test(ui), `C: the panel has a drawer for look ${l}`);
  ok(/tacticsChaseLook/.test(readFileSync(new URL("./main.mjs", import.meta.url), "utf8")), "C: the look is a client setting");
}

done("check-chase");
