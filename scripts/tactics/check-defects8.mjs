// node scripts/tactics/check-defects8.mjs -- the defects D101, D102, D106, D110, D111 and the usability row U110 of dev/combat-defects.md
// (adversary 8, played live on four seats). Scripted table, no Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });

/* ================================================================== D101: a refused chase roll does not open the next round */
{
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2").npc("N1").npc("N2");
  T.add("V1", car({ name: "Van" })).add("V2", car({ name: "Bike" }));
  T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 9, maxResolve: 9 });
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true });
  eq(code(await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2 })), "ok", "D101: the chase starts");
  await T.gm({ op: "chaseRound" }); await T.roll("prey", 1); await T.roll("pursuer", 1);
  eq([T.state.chase.rolled, T.state.stack.length], [T.state.round, 0], "D101: the roll of this round is made");
  eq(code(await T.gm({ op: "chaseSet", unit: "V2", side: null })), "ok", "D101: the prey drops out (as a wreck would)");
  const round0 = T.state.round, clock0 = T.c.CH.resolve, prompts0 = T.prompts().length, log0 = T.log.list.length, rev0 = T.state.rev;
  const env = await T.gm({ op: "chaseRound" });
  eq([code(env), why(env)], ["illegal", "chaseSides"], "D101: no roll without both sides");
  eq([T.state.round, T.c.CH.resolve, T.prompts().length, T.log.list.length, T.state.rev], [round0, clock0, prompts0, log0, rev0], "D101: the refusal changes nothing: the round, the clock, the cards, the journal");
  eq(env.changed ?? false, false, "D101: the answer says nothing changed");
  /* the legal case still opens the next round first */
  await T.gm({ op: "chaseSet", unit: "V2", side: "prey" });
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "D101: with both sides back the roll is made");
  eq([T.state.round, T.c.CH.resolve, T.top()?.flow], [round0 + 1, clock0 - 1, "chase"], "D101: the second roll of a round still opens the next round first");
}

/* ================================================================== D102: a book preset sets the numbers the table plays with */
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1");
  T.add("CH", { kind: "challenge", npc: true, health: 2, resolve: 2, maxResolve: 2, name: "Spill" });
  T.add("CB", { kind: "challenge", npc: true, health: 2, resolve: 2, maxResolve: 2, name: "Fire" });
  T.add("CI", { kind: "challenge", npc: true, health: 2, resolve: 1, maxResolve: 1, name: "Case" });
  T.order(["H1", "N1"]).turn("H1");
  eq(code(await T.gm({ op: "challengeSetup", challenge: "CH", preset: "toxicAccident" })), "ok", "D102: the preset is set");
  eq([T.c.CH.health, T.c.CH.maxHealth, T.c.CH.resolve, T.c.CH.maxResolve], [10, 10, 5, 5], "D102: the challenge's rating and time are the book's (Toxic Accident 10 / 5)");
  eq(T.evs("challenge").pop() && [T.evs("challenge").pop().rating, T.evs("challenge").pop().timeLeft], [10, 5], "D102: the event carries the numbers now in play");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "D102: the set-up can be undone");
  eq([T.c.CH.health, T.c.CH.maxHealth, T.c.CH.resolve, T.c.CH.maxResolve], [2, 2, 2, 2], "D102: undo gives the sheet's numbers back");
  await T.gm({ op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice", keep: true });
  eq([T.c.CH.health, T.c.CH.resolve], [2, 2], "D102: keep:true keeps the sheet's numbers");
  await T.gm({ op: "challengeSetup", challenge: "CB", preset: "burningBuilding" });
  eq([T.c.CB.health, T.c.CB.resolve, T.c.CB.maxResolve], [6, 2, 2], "D102: a preset with no time limit sets the rating only");
  await T.gm({ op: "challengeSetup", challenge: "CI", preset: "complexInvestigation" });
  eq([T.c.CI.health, T.c.CI.resolve, T.c.CI.maxResolve], [4, 1, 1], "D102: a limit counted in days does not become a clock of rounds (rating only)");
}

/* ================================================================== D106: undoing the end of a chase takes back the turn it opened */
{
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2").npc("N1").npc("N2");
  T.add("V1", car({ name: "Van" })).add("V2", car({ name: "Bike" }));
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  for (const id of ["H1", "H2", "N1", "N2"]) await T.gm({ op: "triggerAdd", trigger: { at: "turnStart", subject: { combatant: id }, run: { type: "hazard", hazard: { kind: "fixed", amount: 1 } }, source: { kind: "gm", name: `poison ${id}` } } });
  await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, started: true });
  await T.gm({ op: "vehicleSet", vehicle: "V2", seat: { who: "N1", role: "driver" }, started: true });
  for (const p of T.prompts("triggerQueue")) await T.gm({ op: "answerFor", prompt: p.id, value: [] });
  eq(code(await T.gm({ op: "chaseStart", prey: ["V2"], pursuer: ["V1"], distance: 2 })), "ok", "D106: the chase starts");
  const q0 = T.prompts("triggerQueue").length, trig0 = T.state.triggers.map((t) => t.id).sort();
  eq(code(await T.gm({ op: "chaseEnd", outcome: "combat" })), "ok", "D106: the GM ends the chase");
  const first = T.state.init.curMember;
  eq([T.state.kind, typeof first, T.prompts("triggerQueue").filter((p) => p.about === first).length], ["combat", "string", 1], "D106: the fight's first turn opens with its turn-start card");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "D106: the end of the chase is undone");
  eq([T.state.kind, T.state.init.slots.length, T.prompts("triggerQueue").length], ["chase", 0, q0], "D106: the chase is back and the turn-start card that step opened is gone");
  eq(T.state.triggers.map((t) => t.id).sort(), trig0, "D106: the triggers are as they were");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "combat" })), "ok", "D106: the chase is ended again");
  const second = T.state.init.curMember;
  eq(T.prompts("triggerQueue").map((p) => p.about), [second], "D106: one turn-start card, of the one whose turn it is now");
}

done("check-defects8");
