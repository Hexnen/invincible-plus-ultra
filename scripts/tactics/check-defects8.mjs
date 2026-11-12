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

done("check-defects8");
