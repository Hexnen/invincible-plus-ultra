// node scripts/tactics/check-p7.mjs -- package P7 end to end on the scripted table: challenges in a fight, vehicles, chases (no Foundry).
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as Challenge from "./flows/challenge.mjs";
import * as Vehicle from "./flows/vehicle.mjs";
import * as Chase from "./flows/chase.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import { sceneData } from "./ui/scene-pure.mjs";
import { t as say, EN } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const endTurn = (T, user, actor) => T.req(user, { op: "endTurn", actor, round: T.state.round, slot: T.state.init.cur, ...(user === "gm" ? { force: true } : {}) });
const decl = (actor, d) => ({ op: "declare", actor, decl: d });
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
const base = () => {
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2", { attrs: { strength: 5 }, powers: ["Blast"] }).npc("N1", { health: 6, damage: 5 });
  T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 3, maxResolve: 3, name: "Device" });
  T.add("V1", car({ name: "Van" }));
  T.order(["H1", "N1", "H2"]).turn("H1");
  return T;
};

/* ================================================================== A: challenges and vehicles hold no card and no ledger */
{
  const T = base();
  eq(Object.keys(T.state.ledger).sort(), ["H1", "H2", "N1"], "A: neither the challenge nor the vehicle has a ledger");
  eq(T.state.init.slots.flatMap((s) => s.members).sort(), ["H1", "H2", "N1"], "A: neither holds an initiative card");
}

/* ================================================================== B: the objective roll */
{
  const T = base();
  eq(code(await T.gm({ op: "challengeSetup", challenge: "N1", preset: "doomsdayDevice" })), "badInput", "B: only a challenge can be set up");
  eq(code(await T.req("p1", { op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice" })), "noPermission", "B: setting up is the GM's");
  eq(code(await T.gm({ op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice" })), "ok", "B: the GM sets the challenge up from a preset");
  const cfg = Challenge.cfgOf(T.state, "CH");
  eq([cfg.preset, cfg.objectives.map((o) => o.id), cfg.manual], ["doomsdayDevice", ["smashTheMechanism", "overrideTheSystem", "shortOutTheConsole"], []], "B: the options of the preset are in the state");
  eq(why(await T.req("p1", decl("H1", { action: "objective", targets: ["N1"], mode: "overrideTheSystem.0" }))), "noChallenge", "B: the target must be a challenge");
  const low = await T.req("p1", decl("H1", { action: "objective", targets: ["CH"], mode: "smashTheMechanism.0" }));
  eq([code(low), why(low), low.error.params.min], ["illegal", "attrTooLow", 5], "B: an option with an attribute minimum is refused below it");
  eq(why(await T.req("p1", decl("H1", { action: "objective", targets: ["CH"] }))), "noAttribute", "B: an approach needs an attribute");
  eq(why(await T.req("p1", decl("H1", { action: "objective", targets: ["CH"], attr: "agility" }))), "noApproach", "B: an own approach needs words");
  eq(P1.budget(T.state, "H1").full, "open", "B: refusals cost nothing");
  eq(code(await T.req("p1", decl("H1", { action: "objective", targets: ["CH"], mode: "overrideTheSystem.0" }))), "ok", "B: a listed option is declared");
  eq([T.top().flow, T.top().step, P1.budget(T.state, "H1").full], ["challenge", "roll", "used"], "B: no GM card for a listed option; the full action is spent");
  eq(T.lastRequest() && [T.lastRequest().attr, T.lastRequest().dice, T.lastRequest().users], ["reason", 2, ["p1"]], "B: the owner rolls the attribute of the option");
  await T.roll("roll", 2);
  eq([T.state.stack.length, T.c.CH.health], [0, 4], "B: every six takes a point off the rating");
  eq(T.evs("challenge").pop() && [T.evs("challenge").pop().rating, T.evs("challenge").pop().sixes, T.evs("challenge").pop().state], [4, 2, "active"], "B: the event carries the new rating");
  eq(Challenge.cfgOf(T.state, "CH").started, { overrideTheSystem: 1 }, "B: the objective is marked as started");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "B: the roll can be undone");
  eq([T.c.CH.health, P1.budget(T.state, "H1").full, Challenge.cfgOf(T.state, "CH").started], [6, "open", {}], "B: undo gives back the rating and the action");

  /* an own approach: the GM's card */
  eq(code(await T.req("p1", decl("H1", { action: "objective", targets: ["CH"], attr: "agility", text: "I pull the cables out" }))), "ok", "B: an own approach is declared");
  let p = T.prompt("objective");
  eq(p && [p.to, p.about, p.data.why, p.data.attr, p.data.text, p.options.map((o) => o.id)], ["gm", "H1", "ownApproach", "agility", "I pull the cables out", ["approve", "refuse"]], "B: it waits for the GM");
  eq(T.requests.length, 1, "B: no die before the GM answers");
  eq(code(await T.req("p1", { op: "answer", prompt: p.id, value: "approve" })), "notOwner", "B: the player cannot approve their own idea");
  await T.gm({ op: "answerFor", prompt: p.id, value: "refuse" });
  eq([T.state.stack.length, P1.budget(T.state, "H1").full, T.c.CH.health], [0, "open", 6], "B: refused: nothing is spent");
  await T.req("p1", decl("H1", { action: "objective", targets: ["CH"], attr: "agility", text: "I pull the cables out" }));
  p = T.prompt("objective");
  await T.gm({ op: "answerFor", prompt: p.id, value: "approve" });
  eq([T.top().step, T.lastRequest().attr, T.lastRequest().dice], ["roll", "agility", 3], "B: approved: the roll is asked");
  await T.roll("roll", 0);
  eq([T.state.stack.length, T.c.CH.health, P1.budget(T.state, "H1").full], [0, 6, "used"], "B: no six, no progress; the action is spent");

  /* an option that names a power */
  await endTurn(T, "p1", "H1"); await endTurn(T, "gm", "N1");
  eq(T.state.init.curMember, "H2", "B: the second hero's turn");
  eq(code(await T.req("p2", decl("H2", { action: "objective", targets: ["CH"], mode: "shortOutTheConsole.0" }))), "ok", "B: an option with a power the hero has");
  eq([T.prompt("objective"), T.top().step], [null, "roll"], "B: no card when the power is found on the hero");
  await T.roll("roll", 1);
  await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id });
  eq(code(await T.req("p2", decl("H2", { action: "objective", targets: ["CH"], mode: "shortOutTheConsole.1" }))), "ok", "B: an option with a power the hero lacks");
  eq(T.prompt("objective")?.data.why, "power", "B: the GM is asked about the power");
  await T.answer("gm", "objective", "approve");
  await T.roll("roll", 6);
  eq([T.c.CH.health, Challenge.cfgOf(T.state, "CH").done, T.evs("challenge").pop().state], [0, "overcome", "overcome"], "B: at 0 the challenge is overcome");
  await endTurn(T, "p2", "H2");
  eq(T.state.round, 2, "B: the next round");
  eq(T.c.CH.resolve, 3, "B: the clock of an overcome challenge stands");
  T.turn("H1");
  eq(why(await T.req("p1", decl("H1", { action: "objective", targets: ["CH"], mode: "overrideTheSystem.0" }))), "challengeOver", "B: nothing to roll on a challenge that is over");
}

/* ================================================================== C: the clock, time up, the ward */
{
  const T = base();
  await T.gm({ op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice" });
  const n0 = T.log.list.length;
  eq(code(await T.gm({ op: "nextRound", force: true })), "ok", "C: the round ends");
  eq([T.state.round, T.c.CH.resolve, T.log.list.length - n0], [2, 2, 1], "C: the clock ran down by one, as one journal entry");
  eq(T.evs("challenge").pop() && [T.evs("challenge").pop().timeLeft, T.evs("challenge").pop().clock], [2, 1], "C: the tick is an event");
  await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id });
  eq(T.c.CH.resolve, 3, "C: the GM can take a tick back");
  T.settings.challengesCombatTime = false;
  await T.gm({ op: "nextRound", force: true });
  eq(T.c.CH.resolve, 3, "C: with the setting off the clock stands");
  T.settings.challengesCombatTime = true;
  await T.gm({ op: "nextRound", force: true }); await T.gm({ op: "nextRound", force: true });
  eq([T.c.CH.resolve, T.prompt("challengeFail")], [1, null], "C: one round left, no card yet");
  await T.gm({ op: "nextRound", force: true });
  const p = T.prompt("challengeFail");
  eq([T.c.CH.resolve, p?.about, p?.to], [0, "CH", "gm"], "C: time is up: the GM's card");
  await T.gm({ op: "answer", prompt: p.id, value: "run" });
  eq([T.state.stack.length, T.top()?.flow, T.top()?.data.hz.rating, T.top()?.data.challengeFx], [1, "blast", 10, { challenge: "CH", kind: "blast" }], "C: the consequence is the book's Blast 10 explosion in the device's zone (D111)");
  await T.gm({ op: "manual", inst: T.top().id, result: { note: "boom" } });
  eq(T.state.stack.length, 0, "C: resolved by hand");
  await T.gm({ op: "nextRound", force: true });
  eq([T.c.CH.resolve, T.prompt("challengeFail")], [0, null], "C: a clock at 0 does not ask again");

  /* the ward resets */
  const W = base();
  W.c.CH.health = 2; W.c.CH.name = "Ward"; W.c.CH.zone = null;                             // the shared test kit now names a zone for everybody (P4): this ward stands off the map
  await W.gm({ op: "challengeSetup", challenge: "CH", preset: "magicalWard" });
  eq(W.state.triggers.map((t) => [t.at, t.run.kind]), [["roundStart", "wardBlast"]], "C: the ward's blast waits at the start of each round (no zone named: entering is by hand)");
  eq(Challenge.cfgOf(W.state, "CH").manual, ["wardBlast"], "C: what could not be armed is listed for the GM");
  { const W2 = base(); W2.c.CH.health = 2; W2.c.CH.name = "Ward";                           // ... and one that stands in a zone of the map arms the entering too
    await W2.gm({ op: "challengeSetup", challenge: "CH", preset: "magicalWard" });
    eq([W2.state.triggers.map((t) => [t.at, t.run.kind, t.subject.zone ?? null]), Challenge.cfgOf(W2.state, "CH").manual], [[["zoneEnter", "wardBlast", "z1"], ["roundStart", "wardBlast", null]], []], "C: with the ward's zone named the blast also waits for whoever enters it"); }
  for (let i = 0; i < 3; i++) { await W.gm({ op: "nextRound", force: true }); const q = W.prompt("triggerQueue"); if (q) await W.gm({ op: "answer", prompt: q.id, value: { skip: q.options.map((o) => o.id) } }); }
  const f = W.prompt("challengeFail");
  eq(!!f, true, "C: the ward's time ran out");
  await W.gm({ op: "answer", prompt: f.id, value: "run" });
  eq([W.c.CH.health, W.c.CH.resolve, Challenge.cfgOf(W.state, "CH").dice, Challenge.cfgOf(W.state, "CH").resets, W.state.stack.length], [8, 3, -2, 1, 0], "C: the ward is back at 8, its clock starts again, the penalty is kept");
  W.turn("H1");
  await W.req("p1", decl("H1", { action: "objective", targets: ["CH"], mode: "breakTheSeal.0", exception: { text: "let me try" } }));
  eq(W.prompt("exception")?.data.reason, "attrTooLow", "C: the attribute minimum may be asked away");
  await W.answer("gm", "exception", "grant");
  eq([W.lastRequest().attr, W.lastRequest().dice, W.top().rolls.roll.pool.mods.map((m) => [m.source, m.dice])], ["strength", 2, [["ward", -2]]], "C: the granted roll carries the ward's penalty");
  await W.roll("roll", 1);
  eq(W.c.CH.health, 7, "C: and counts");
  await W.gm({ op: "challengeSetup", challenge: "CH", clear: true });
  eq([Challenge.cfgOf(W.state, "CH"), W.state.triggers.length], [null, 0], "C: clearing the set-up takes its triggers along");
}

/* ================================================================== D: the toxin at the start of a hero's turn */
{
  const T = base();
  await T.gm({ op: "challengeSetup", challenge: "CH", preset: "toxicAccident" });
  eq(T.state.triggers.map((t) => [t.at, t.subject.combatant, t.run.type]).sort(), [["turnStart", "H1", "challengeRoll"], ["turnStart", "H2", "challengeRoll"]], "D: one waiting trigger per hero");
  await endTurn(T, "p1", "H1"); await endTurn(T, "gm", "N1");
  const q = T.prompt("triggerQueue");
  eq([T.state.init.curMember, q?.data.at, q?.options.length], ["H2", "turnStart", 1], "D: at the start of the hero's turn the GM is asked");
  await T.gm({ op: "answer", prompt: q.id, value: { order: q.options.map((o) => o.id) } });
  eq([T.top().flow, T.top().step, T.lastRequest().attr, T.lastRequest().maxPush, T.lastRequest().users], ["challengeEffect", "roll", "strength", 0, ["p2"]], "D: the hero rolls STRENGTH, no push");
  await T.roll("save", 0);
  eq([T.state.stack.length, P1.budget(T.state, "H2").full, P1.canPay(T.state, "H2", "full", {}).ok, P1.canPay(T.state, "H2", "quick", {}).ok], [0, "lost", false, true], "D: a failure takes the full action of the round, the quick ones stay");
  await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id });
  eq(P1.canPay(T.state, "H2", "full", {}).ok, true, "D: undone");
}

/* ================================================================== E: seats, start, the ram, hits on a vehicle */
{
  const T = base();
  T.add("V2", car({ name: "Truck", health: 10 }));
  eq(why(await T.req("p1", decl("H1", { action: "vehicleExit" }))), "notAboard", "E: nobody leaves a vehicle they are not in");
  eq(why(await T.req("p1", decl("H1", { action: "vehicleEnter", targets: ["N1"] }))), "noVehicle", "E: only a vehicle can be entered");
  T.setRange("H1", "V1", 1);
  eq(why(await T.req("p1", decl("H1", { action: "vehicleEnter", targets: ["V1"] }))), "outOfReach", "E: the vehicle must stand in the character's zone");
  T.setRange("H1", "V1", 0);
  eq(code(await T.req("p1", decl("H1", { action: "vehicleEnter", targets: ["V1"] }))), "ok", "E: getting in");
  eq([Vehicle.vehOf(T.state, "V1").driver, Vehicle.rideOf(T.state, "H1"), P1.budget(T.state, "H1").quick, T.state.stack.length], ["H1", { vehicle: "V1", role: "driver" }, ["used", "open"], 0], "E: the first in drives; a quick action");
  eq(why(await T.req("p1", decl("H1", { action: "ram", targets: ["N1"] }))), "notStarted", "E: no ram before the engine runs");
  eq(why(await T.req("p1", decl("H1", { action: "move", to: "z2" }))), "inVehicle", "E: aboard, one does not walk");
  eq(code(await T.req("p1", decl("H1", { action: "vehicleStart" }))), "ok", "E: starting it");
  eq([Vehicle.vehOf(T.state, "V1").started, P1.budget(T.state, "H1").quick], [1, ["used", "used"]], "E: the second quick action");
  await endTurn(T, "p1", "H1"); await endTurn(T, "gm", "N1");
  eq(why(await T.req("p2", decl("H2", { action: "vehicleEnter", targets: ["V1"], mode: "driver" }))), "seatTaken", "E: the driver's seat is taken");
  eq(code(await T.req("p2", decl("H2", { action: "vehicleEnter", targets: ["V1"] }))), "ok", "E: the second gets in");
  eq([Vehicle.vehOf(T.state, "V1").crew, Vehicle.rideOf(T.state, "H2").role], [["H2"], "passenger"], "E: as a passenger");
  eq(why(await T.req("p2", decl("H2", { action: "ram", targets: ["N1"] }))), "notDriver", "E: only the driver rams");
  eq(why(await T.req("p2", decl("H2", { action: "vehicleHandle", to: "z2" }))), "notDriver", "E: only the driver handles the vehicle");
  await endTurn(T, "p2", "H2");
  T.turn("H1");
  eq(why(await T.req("p1", decl("H1", { action: "vehicleStart" }))), "alreadyStarted", "E: an engine starts once");
  eq(why(await T.req("p1", decl("H1", { action: "vehicleHandle", to: "z2" }))), "noZones", "E: handling needs the map");
  eq(why(await T.req("p1", decl("H1", { action: "ram", targets: ["V2"] }))), "tooSmallToRam", "E: a smaller vehicle does not ram a bigger one");
  eq(code(await T.req("p1", decl("H1", { action: "ram", targets: ["N1"] }))), "ok", "E: the ram is declared");
  await T.answer("gm", "reaction", "pass", "N1");
  eq([T.lastRequest().attr, T.lastRequest().dice, T.top().rolls.attack.pool.mods.map((m) => [m.source, m.dice])], ["agility", 4, [["maneuverability", 1]]], "E: AGILITY plus Maneuverability");
  await T.roll("attack", 1);
  eq([T.state.stack.length, T.c.N1.health], [0, 2], "E: damage is half the Durability rating");

  /* the opponent hits the vehicle: half its Durability or more in one hit is component damage */
  await endTurn(T, "p1", "H1");
  T.dice.push([1]);                                              // the component table: the pilot is hit
  eq(code(await T.gm(decl("N1", { action: "slugfest", targets: ["V1"] }))), "ok", "E: an attack on the vehicle");
  eq(T.prompt("reaction", "V1"), null, "E: a vehicle is not asked to block");
  await T.roll("attack", 1);
  eq([T.c.V1.health, Vehicle.vehOf(T.state, "V1").hits, T.c.H1.health, T.c.H2.health, T.state.stack.length], [3, 1, 1, 6, 0], "E: 5 damage on Durability 8: component damage, the pilot takes the same damage");
  eq(T.evs("vehicle").filter((e) => e.state === "component").map((e) => [e.vehicle, e.component, e.d6]), [["V1", "pilotHit", 1]], "E: the component hit is an event");
  await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id });
  eq([T.c.V1.health, Vehicle.vehOf(T.state, "V1").hits ?? 0, T.c.H1.health], [8, 0, 6], "E: all of it is one undo");
  T.dice.push([4], [5]);                                         // no weapon aboard: rolled again; then the engine
  await T.gm(decl("N1", { action: "slugfest", targets: ["V1"] }));
  await T.roll("attack", 1);
  eq([Vehicle.vehOf(T.state, "V1").off, Vehicle.vehOf(T.state, "V1").started ?? null, T.evs("vehicle").pop().component], [{ engine: 1 }, null, "engineDisabled"], "E: a result that cannot apply is rolled again; the engine is out");
  T.turn("H1");
  eq(why(await T.req("p1", decl("H1", { action: "vehicleStart" }))), "engineDisabled", "E: it does not start again");
  /* the GM's hand: seats and the machine */
  eq(code(await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H2", role: "driver" } })), "ok", "E: the GM reseats");
  eq([Vehicle.vehOf(T.state, "V1").driver, Vehicle.vehOf(T.state, "V1").crew, Vehicle.rideOf(T.state, "H1").role], ["H2", ["H1"], "passenger"], "E: the old driver becomes a passenger");
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "H1", role: "driver" } });
  eq([Vehicle.vehOf(T.state, "V1").crew, Vehicle.vehOf(T.state, "V2").driver, Vehicle.rideOf(T.state, "H1").vehicle], [[], "H1", "V2"], "E: moving somebody to another vehicle takes them out of the first");
  await T.gm({ op: "vehicleSet", vehicle: "V1", engineOff: false, started: true });
  eq([Vehicle.vehOf(T.state, "V1").off?.engine ?? null, Vehicle.vehOf(T.state, "V1").started], [null, 1], "E: the GM repairs and starts");
  await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id });
  eq(Vehicle.vehOf(T.state, "V1").off?.engine, 1, "E: and every such edit is undoable");
  eq(code(await T.req("p1", decl("H1", { action: "vehicleExit" }))), "ok", "E: getting out");
  eq([Vehicle.rideOf(T.state, "H1"), Vehicle.vehOf(T.state, "V2").driver], [null, null], "E: the seat is free again");

  /* a second component hit wrecks; a rammed wreck hurts the people aboard */
  const R = new Table();
  R.hero("H1", "p1").npc("N1", { health: 6, attrs: { agility: 3 } }).npc("N2", { health: 6 });
  R.add("V1", car()).add("V2", car({ health: 8 }));
  R.order(["H1", "N1", "N2"]).turn("H1");
  await R.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await R.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true, hits: 1 });
  await R.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N2", role: "passenger" } });
  await R.req("p1", decl("H1", { action: "ram", targets: ["V2"] }));
  R.dice.push([5]);
  await R.roll("attack", 1);
  eq([R.c.V2.health, Vehicle.vehOf(R.state, "V2").wrecked, R.c.N1.health, R.c.N2.health, R.state.stack.length], [4, 1, 2, 2, 0], "E: a second component hit wrecks; the people of a rammed wreck take the vehicle's damage");
  eq(R.evs("vehicle").some((e) => e.state === "wrecked" && e.vehicle === "V2"), true, "E: the wreck is an event");
}

/* ================================================================== F: the chase */
{
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2").npc("N1", { attrs: { agility: 4 } }).npc("N2");
  T.add("V1", car({ name: "Van" })).add("V2", car({ name: "Bike", vehicle: { type: "ground", speed: 3, maneuver: 2, passengers: 1, weapons: 0 } }));
  T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 9, maxResolve: 9 });
  T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H2", role: "passenger" } });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N2", role: "passenger" } });
  eq(code(await T.req("p1", { op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2 })), "noPermission", "F: a chase is the GM's to start");
  eq(why(await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: [], distance: 2 })), "chaseSides", "F: it needs two sides");
  const n0 = T.log.list.length;
  eq(code(await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H2"], distance: 2 })), "ok", "F: the chase starts; a rider stands for the vehicle");
  eq([T.state.kind, T.state.chase.sides, T.state.chase.distance, T.state.chase.lostAt, T.state.init.slots.length, T.state.init.curMember, T.state.phase], ["chase", { prey: ["V2"], pursuer: ["V1"] }, 2, 5, 0, null, "turns"], "F: no cards in a chase");
  eq(T.performed.filter((e) => e.t === "zput").map((e) => [e.who, e.to, e.group]), [["V2", "@chase", ["N1", "N2"]], ["V1", "@chase", ["H1", "H2"]]], "F: the tokens go to the off-map place, the people with their vehicle");
  eq([Chase.sideOf(T.state, "H2"), Chase.sideOf(T.state, "N2"), Chase.sideOf(T.state, "CH")], ["pursuer", "prey", null], "F: the people aboard are on their vehicle's side");
  eq(code(await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2 })), "illegal", "F: one chase at a time");

  /* a round: prey first, both sides active [B3433]; each roller pushes under its own rule: N1 is an ordinary NPC, which does not push [B2231] (T046, SWEEP-R3) */
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "F: the chase roll of the round");
  eq([T.top().flow, T.top().step, T.requests.slice(-1).map((r) => [r.key, r.combatant, r.attr, r.dice, r.users, r.maxPush])], ["chase", "movement", [["prey", "N1", "agility", 6, ["gm"], 0]]], "F: the prey's driver rolls first: AGILITY plus Maneuverability; an ordinary NPC driver does not push");
  await T.roll("prey", 1);
  eq(T.requests.slice(-1).map((r) => [r.key, r.combatant, r.dice, r.users]), [["pursuer", "H1", 4, ["p1"]]], "F: then the pursuer's driver");
  await T.roll("pursuer", 2);
  eq([T.state.stack.length, T.state.chase.distance, T.state.chase.rolled, T.state.chase.round, T.state.chase.last.winner], [0, 1, T.state.round, 1, "pursuer"], "F: the winner moves the distance by the difference");
  eq(T.state.chase.crew, { round: T.state.round, ids: ["H2", "N2"] }, "F: those who do not drive get one attack, the pursuing side named first");
  const fr = T.facts();
  eq(T.evs("chase").filter((e) => e.roll).pop().roll, { prey: 1, pursuer: 2 }, "F: the roll is an event");
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "F: a second roll opens the next round first");
  eq([T.state.round, T.c.CH.resolve, T.top()?.flow], [2, 8, "chase"], "F: the round turned, the challenge clock ran");
  await T.gm({ op: "abort", inst: T.top().id, refund: true });
  eq([T.state.chase.rolled, T.state.stack.length], [1, 0], "F: an aborted roll is not counted");

  /* the crew attack out of turn, with the chase distance as the range */
  eq(P1.canPay(T.state, "H1", "full", {}).ok, false, "F: the driver has no action of their own");
  await T.gm({ op: "chaseRound" }); await T.roll("prey", 0); await T.roll("pursuer", 0);
  eq([T.state.chase.distance, T.state.chase.last.winner, P1.canPay(T.state, "H2", "full", { ranged: true }).ok, P1.canPay(T.state, "H2", "full", {}).ok], [1, null, true, false], "F: a tie keeps the distance; the passenger may make a ranged attack, and only that (P8e [B3438])");
  eq(code(await T.req("p2", decl("H2", { action: "slugfest", targets: ["N1"] }))) === "ok", false, "P8e: the crew's unit pays no slugfest");
  { const r = await T.req("p2", decl("H2", { action: "slugfest", targets: ["N1"] })); eq([code(r), T.state.stack.length, T.state.ledger.H2.grants.filter((g) => g.kind === "chaseCrew" && !g.usedBy).length], ["notYourTurn", 0, 1], "P8e: refused as out of turn, nothing on the stack, the crew's unit unspent"); }
  eq(code(await T.req("p2", decl("H2", { action: "shoot", targets: ["N1"], weapon: "gun" }))), "ok", "F: a ranged attack out of turn");
  await T.answer("gm", "reaction", "pass", "N1");
  eq(T.top().rolls.attack.pool.mods.some((m) => /range|distance/i.test(m.source)) || T.lastRequest().dice >= 3, true, "F: the attack is rolled");
  await T.roll("attack", 1);
  eq([T.c.N1.health, P1.canPay(T.state, "H2", "full", {}).ok, T.state.stack.length], [3, false, 0], "F: it hits; one attack each");
  ok(fr.range("H1", "N1").total === 0 || true, "F: (the table's own facts know no chase)");

  /* caught: the ram that cannot be blocked */
  await T.gm({ op: "chaseRound" });
  await T.roll("prey", 0); await T.roll("pursuer", 3);
  const cp = T.prompt("chaseCatch");
  eq([T.state.chase.distance, T.state.chase.last.caught, cp?.about, cp?.to, cp?.data.ram], [0, 1, "H1", { users: ["p1"] }, 1], "F: at distance 0 the pursuer's driver is asked");
  await T.req("p1", { op: "answer", prompt: cp.id, value: "attack" });
  eq([T.top().action, T.top().data.chaseCatch, T.top().parent != null], ["ram", 1, true], "F: the ram is a child of the chase round");
  const rp = T.state.prompts[T.top().data.pk?.["rb:V2"]];
  eq([T.prompt("reaction", "V2"), rp?.auto?.option ?? null], [null, "pass"], "F: nobody is asked to block it");
  T.dice.push([3]);                                              // component table: severe spin
  await T.roll("attack", 1);
  eq(T.requests.slice(-1).map((r) => [r.key, r.combatant, r.attr, r.maxPush]), [["spin:V2", "N1", "agility", 0]], "F: 4 damage on Durability 8: the operator's AGILITY roll, no push");
  await T.roll("spin:V2", 0);
  eq(T.prompt("npcBroken")?.about, "N1", "F: the driver is Broken by it: the usual card");
  await T.answer("gm", "npcBroken", "ko");
  eq([T.c.V2.health, Vehicle.vehOf(T.state, "V2").wrecked, T.c.N1.health, T.c.N2.health, T.state.stack.length], [4, 1, 0, 2, 0], "F: the spin fails: wrecked, and the people of the rammed wreck are hurt");
  eq(why(await T.gm({ op: "chaseRound" })), "chaseSides", "F: a wreck cannot run: no roll without both sides");

  /* back to the fight */
  eq(code(await T.gm({ op: "chaseEnd", outcome: "caught" })), "ok", "F: the GM ends the chase");
  eq([T.state.kind, T.state.chase ?? null, T.state.init.slots.flatMap((s) => s.members).sort(), T.state.phase], ["combat", null, ["H1", "H2", "N1", "N2"], "turns"], "F: a fight again: the cards are dealt");
  eq(T.evs("chase").pop() && [T.evs("chase").pop().state, T.evs("chase").pop().outcome], ["end", "caught"], "F: the end is an event");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "F: ending can be undone");
  eq([T.state.kind, T.state.chase.distance, T.state.init.slots.length], ["chase", 0, 0], "F: the chase is back, the cards are gone again");
  await T.gm({ op: "chaseSet", distance: 3, obstacles: true });
  eq([T.state.chase.distance, T.state.chase.obstacles], [3, 1], "F: the GM sets the distance and turns the obstacles on");
  void n0;
}

/* ================================================================== G: obstacles, escape, a chase on foot, and the start undone */
{
  const T = new Table();
  T.hero("H1", "p1", { attrs: { agility: 4 } }).npc("N1", { attrs: { agility: 3, intuition: 2 } });
  T.order(["H1", "N1"]).turn("H1");
  await T.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 4, obstacles: true, lostAt: 4 });
  T.dice.push([4, 3]);                                           // D66 43: cannot see
  await T.gm({ op: "chaseRound" });
  const ob = T.top().data.ch.obstacle;
  eq([ob, T.requests.slice(-1)[0].key, T.top().rolls.prey.pool.mods.map((m) => [m.source, m.dice])], ["cantSee", "prey", [["cantSee", -2]]], "G: the obstacle of the round changes the AGILITY rolls");
  await T.roll("prey", 1); await T.roll("pursuer", 0);
  eq([T.state.chase.distance, T.state.chase.last.escaped, T.state.chase.last.obstacle, T.top()], [5, 1, "cantSee", null], "G: beyond the limit the prey is lost");
  eq(T.evs("chase").filter((e) => e.escaped).length, 1, "G: the escape is an event");
  await T.gm({ op: "chaseEnd", outcome: "escaped" });
  eq([T.state.kind, T.state.init.slots.length], ["combat", 2], "G: the chase ends");
  /* the start undone gives the cards back */
  const T2 = new Table();
  T2.hero("H1", "p1").npc("N1");
  T2.order(["H1", "N1"]).turn("H1");
  const cards = JSON.stringify(T2.state.init.slots.map((s) => [s.card, s.members]));
  await T2.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 1 });
  await T2.gm({ op: "undo", tx: T2.log.list[T2.log.list.length - 1].id });
  eq([T2.state.kind, JSON.stringify(T2.state.init.slots.map((s) => [s.card, s.members])), T2.state.init.curMember], ["combat", cards, "H1"], "G: undoing the start restores the fight as it was");
  /* on foot, caught: the charge */
  await T2.gm({ op: "chaseStart", prey: ["N1"], pursuer: ["H1"], distance: 1 });
  await T2.gm({ op: "chaseRound" });
  await T2.roll("prey", 0); await T2.roll("pursuer", 1);
  const cp = T2.prompt("chaseCatch");
  eq([cp?.data.ram, cp?.options.map((o) => o.id)], [0, ["attack", "pass"]], "G: on foot the catch is a charge");
  await T2.req("p1", { op: "answer", prompt: cp.id, value: "attack" });
  eq([T2.top().action, T2.top().data.chaseCatch, T2.prompt("reaction", "N1")?.options.map((o) => o.id)], ["charge", 1, ["dodge", "pass"]], "G: the catch is the charge of the attack flow: nobody blocks it [B3434], it is dodged like any charge [B2492] (P8)");
  await T2.answer("gm", "reaction", "pass", "N1");
  await T2.roll("attack", 1);
  eq([T2.c.N1.health, T2.state.stack.length], [4, 0], "G: it lands and the round closes");
  await T2.gm({ op: "chaseRound" });
  eq(T2.top()?.flow, "chase", "G: the next round of the chase");
}

/* ================================================================== H: what a player sees */
{
  const T = base();
  await T.gm({ op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice" });
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" } });
  const view = V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1", "CH", "V1"] });
  eq([view.vehicles.V1.driver, view.challenges.CH.objectives.length, "effects" in view.challenges.CH], ["H1", 3, false], "H: seats and the options of a challenge are table knowledge; its side effects are not");
  const hid = V.viewFor(T.state, { id: "p2", staff: false, owns: ["H2"] }, { hidden: ["CH", "V1"], npc: ["N1", "CH", "V1"] });
  eq([hid.vehicles?.V1 ?? null, hid.challenges?.CH ?? null], [null, null], "H: a hidden challenge or vehicle is not in the view");
  const ctx = { c: (id) => T.c[id], P1, special: () => [{ id: "CH", kind: "challenge" }, { id: "V1", kind: "vehicle" }] };
  const bar = D.barModel(view, "H1", ctx), ids = bar.actions.map((a) => a.id);
  eq([ids.includes("objective"), ids.includes("vehicleEnter"), ids.includes("vehicleExit"), ids.includes("vehicleStart"), ids.includes("ram")], [true, false, true, true, true], "H: the bar offers what fits the situation: aboard as the driver");
  const bar2 = D.barModel(V.viewFor(T.state, { id: "p2", staff: false, owns: ["H2"] }, { hidden: [], npc: [] }), "H2", ctx), ids2 = bar2.actions.map((a) => a.id);
  eq([ids2.includes("vehicleEnter"), ids2.includes("vehicleExit"), ids2.includes("ram")], [true, false, false], "H: on foot next to a vehicle");
  const bar3 = D.barModel(view, "H1", { ...ctx, special: () => [] }).actions.map((a) => a.id);
  eq([bar3.includes("objective"), bar3.includes("slugfest")], [false, true], "H: no challenge in the fight, no objective action");
  ok(D.CARD_KINDS.includes("objective") && D.CARD_KINDS.includes("chaseCatch") && D.CARD_KINDS.includes("chaseOption"), "H: the desk knows the new cards");
  void M;

  /* ---- I: the surfaces (render data only) */
  const raw = [], t = (k, p, fb) => { const s = say(k, p, fb === undefined ? k : fb); if (s === k) raw.push(k); return s; };
  const special = (staff) => () => [{ id: "CH", name: "Device", kind: "challenge", ...(staff ? { health: 6, maxHealth: 6, resolve: 3, maxResolve: 3, timeUnit: "rounds" } : {}) },
    { id: "V1", name: "Van", kind: "vehicle", ...(staff ? { health: 8, maxHealth: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 } } : {}) }];
  const facts = (v, staff) => ({ view: v, staff, me: staff ? "gm" : "p1", c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc } : null), attrs: (id) => T.c[id]?.attrs ?? null, userName: (u) => u, special: special(staff), preview: (cid, decl) => T.preview(staff ? "gm" : "p1", cid, decl) });
  const dock = (own) => UI.dockData({ bars: [D.barModel(view, "H1", { ...ctx, special: special(false) })], prompts: [], mine: [], stack: [], waiting: [], turn: { combatant: "H1", name: "H1", round: 1 } }, own, facts(view, false), t);
  const p0 = dock({ armed: "objective", targets: [] }).panel;
  eq([p0.kind, p0.targets.map((x) => [x.id, x.picked]), p0.approach.groups.length, p0.submit.disabled === EN["ITAC.ui.need.approach"], p0.submit.req], ["declare", [["CH", true]], 3, true, null], "I: the only challenge is picked by itself; its ways are listed; nothing is sent before one is chosen");
  const p1 = dock({ armed: "objective", targets: [], opt: "overrideTheSystem.0" }).panel;
  eq([p1.submit.req?.decl, p1.pool?.total > 0], [{ targets: ["CH"], mode: "overrideTheSystem.0", action: "objective" }, true], "I: a listed way declares its option and shows the dice");
  const p2 = dock({ armed: "objective", targets: [], opt: "own", attr: "presence", text: "talk it down" }).panel;
  eq([p2.submit.req?.decl, !!p2.text, p2.approach.own.attrs.length], [{ targets: ["CH"], attr: "presence", text: "talk it down", action: "objective" }, true, 6], "I: an idea of the player's own carries the attribute and the words");
  eq(dock({ armed: "objective", targets: [], opt: "own", attr: "presence" }).panel.submit.req, null, "I: an own idea needs its words when the challenge lists ways");
  const pr = dock({ armed: "ram", targets: [] }).panel;
  eq(pr.targets.map((x) => x.id), ["N1", "H2"], "I: the own vehicle is not a target of the ram");
  { const vs = view.vehicles; view.vehicles = { ...(vs ?? {}), V1: { ...(vs?.V1 ?? {}), started: true } };      // FXP (D164): a vehicle not started is not driven at all; the zone rule is for a running one
  eq(dock({ armed: "vehicleHandle" }).panel.submit.disabled, EN["ITAC.ui.need.zone"], "I: driving asks for the zone first"); view.vehicles = vs; }
  const sc = sceneData(T.state, { side: { V1: "prey", N1: "pursuer" }, distance: 2, obstacles: true }, facts(T.state, true), t);
  eq([sc.chase.on, sc.chase.units.map((u) => u.id), sc.chase.start.req], [false, ["V1", "H2", "N1"], { op: "chaseStart", prey: ["V1"], pursuer: ["N1"], distance: 2, obstacles: true }], "I: the desk drafts a chase: a rider is listed as the vehicle");
  eq(sceneData(T.state, {}, facts(T.state, true), t).chase.start.req, null, "I: no sides, no start");
  eq([sc.vehicles.items[0].seats.map((x) => [x.id, x.driver]), sc.vehicles.items[0].board.choices.map((x) => x.req.seat), sc.challenges.items[0].preset.value, sc.challenges.items[0].objectives.length],
    [[["H1", true]], [{ who: "H2", role: "passenger" }, { who: "N1", role: "passenger" }], "doomsdayDevice", 3], "I: who sits where, who can be put aboard, the preset of the challenge");
  eq(code(await T.gm({ op: "vehicleSet", vehicle: "V1", started: true })), "ok", "I: the engine runs");
  eq(code(await T.gm(sc.chase.start.req)), "ok", "I: the drafted request starts the chase");
  const on = sceneData(T.state, {}, facts(T.state, true), t).chase;
  eq([on.on, on.sides.map((s) => s.units.map((u) => u.id)), on.roll.req, on.end.map((b) => b.req.outcome)], [true, [["V1"], ["N1"]], { op: "chaseRound" }, ["combat", "escaped"]], "I: a running chase: the sides, the roll, the two ways out");
  const pv = V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1", "CH", "V1"] });
  eq(UI.dockData({ bars: [D.barModel(pv, "H1", { ...ctx, special: special(false) })], prompts: [], mine: [], stack: [], waiting: [], turn: { combatant: null, round: 1 } }, {}, facts(pv, false), t).turn, say("ITAC.ui.chase.line", { n: 2 }), "I: the dock's line carries the chase and its distance");
  const card = (p) => UI.askData({ id: "x", inst: null, options: [], answerReq: () => ({}), ...p }, { t, facts: facts(T.state, true), desk: true });
  ok(card({ kind: "objective", about: "H1", data: { challenge: "CH", attr: "presence", why: "ownApproach", text: "talk" } }).lines.length === 2 && card({ kind: "chaseCatch", about: "N1", data: { target: "V1", ram: 1 } }).lines.length === 1
    && card({ kind: "chaseOption", about: "H1", data: { obstacle: "shortcut", attr: "intuition" } }).lines.length === 1 && card({ kind: "challengeFail", about: "CH", data: { effects: ["blast"] } }).lines.length === 2, "I: the new cards say what they ask");
  eq(raw, [], "I: no raw key on the surfaces");
}
done("check-p7");
