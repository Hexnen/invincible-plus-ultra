/* node scripts/sweep-checks/fxd2.mjs -- FXD2 (K12 / ANSF-2 against CI1, the user 2026-11-12: «Wszystkie 6 zmian»): a granted exception costs
   what its normal form costs; free stay only the GM's own "without cost" and a character with nothing left to pay with (P9F-R1, P8e-R2).
   Driving a vehicle (catalog vehicleHandle, flow drive, cost quick) is not priced by its flow, so its quick action is taken at the
   declaration like any other action's, before the GM's card; a granted drive keeps it, a refused one gives it back. Pinned here with every
   other way an exception is granted: a held declaration, a free-standing request that names the declaration, the GM's "declare anyway". */
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import { MTable } from "../tactics/check-kit-map.mjs";
import * as P1 from "../tactics/economy-pure.mjs";

const car = () => ({ kind: "vehicle", npc: true, name: "Van", health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 } });
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const paid = (T) => (T.state.ledger.H1?.entries ?? []).filter((e) => !e.void).map((e) => e.cost);
const units = (T) => { const b = P1.budget(T.state, "H1"); return [b.full, ...b.quick]; };
const fight = () => { const T = new MTable(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.put("H1", "z1").put("N1", "z5"); T.order(["H1", "N1"]); return T; };
const driving = ({ started = 1 } = {}) => {
  const T = fight(); T.add("V1", car()); T.put("V1", "z1");
  T.state.vehicles = { V1: { driver: "H1", crew: [], started } }; T.state.statuses = { H1: [{ id: "inVehicle", data: { vehicle: "V1", role: "driver" } }] };
  return T;
};
const drive = (T, to, exc = true) => T.req("p1", { op: "declare", actor: "H1", decl: { action: "vehicleHandle", to, ...(exc ? { exception: { text: "I drive" } } : {}) } });

/* ---- K12 / ANSF-2: the drive let through as an exception costs the drive's quick action */
{
  const T = driving({ started: 0 });
  eq([code(await drive(T, "z2")), T.prompt("exception")?.to, T.prompt("exception")?.data?.reason], ["ok", "gm", "notStarted"], "K12: (a drive the rules refuse, asked as an exception: the GM's card)");
  eq(units(T), ["open", "used", "open"], "K12: the drive's quick action is taken at the declaration, as any unpriced action's");
  await T.answer("gm", "exception", "grant");
  eq([T.top()?.action, T.top()?.status, paid(T), units(T)], ["vehicleHandle", "manual", ["quick"], ["open", "used", "open"]], "K12: granted: the drive costs its quick action (CI1), the GM moves the vehicle by hand");
  ok((T.state.ledger.H1.entries ?? []).some((e) => !e.void && (e.tags ?? []).includes("vehicleHandle")), "K12: and counts as a handling of the round [B3146]");
  const D = driving();
  eq(code(await drive(D, "z9")), "ok", "K12: (a drive to nowhere, asked as an exception)");
  await D.answer("gm", "exception", "deny");
  eq([D.state.stack.length, paid(D), units(D)], [0, [], ["open", "open", "open"]], "K12: refused: the quick action is given back");
  const F = driving({ started: 0 });
  eq(code(await F.req("p1", { op: "exception", actor: "H1", text: "I drive", decl: { action: "vehicleHandle", to: "z2" } })), "ok", "K12: (a free-standing request that names the drive)");
  eq([F.prompt("exception")?.data?.reasons, !!F.prompt("exception")?.data?.waive], [["notStarted"], false], "K12: only a rule refuses: nothing to waive");
  await F.answer("gm", "exception", "grant");
  eq([F.top()?.action, F.top()?.status, paid(F)], ["vehicleHandle", "manual", ["quick"]], "K12: granted from the free-standing card: the drive costs its quick action");
  const G = driving({ started: 0 });
  eq(code(await G.gm({ op: "declare", actor: "H1", decl: { action: "vehicleHandle", to: "z2", exception: { text: "GM" } } })), "ok", "K12: (the GM's own 'declare anyway' on a drive)");
  eq([G.top()?.status, paid(G)], ["manual", ["quick"]], "K12: the GM's 'declare anyway' costs the drive as well (only 'without cost' is free)");
  const W = driving({ started: 0 });
  eq(code(await W.gm({ op: "declare", actor: "H1", gm: true, decl: { action: "vehicleHandle", to: "z2", exception: { text: "GM" } } })), "ok", "K12: (the GM's own 'without cost')");
  eq([W.top()?.status, units(W)], ["manual", ["open", "open", "open"]], "K12: the GM's 'without cost' stays free");
}
/* ---- the other ways an exception is granted: none ends free while its normal form has a price */
{
  const T = fight();
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"], exception: { text: "I leap" } } })), "ok", "CI1: (a punch out of reach, asked as an exception)");
  await T.answer("gm", "exception", "grant");
  eq(paid(T), ["full"], "CI1: a granted held attack costs its full action");
  const F = fight();
  await F.req("p1", { op: "exception", actor: "H1", text: "I leap", decl: { action: "slugfest", targets: ["N1"] } });
  eq([F.prompt("exception")?.data?.reasons, !!F.prompt("exception")?.data?.waive], [["outOfReach"], false], "P8e-R2: (the free-standing card: only the reach refuses)");
  await F.answer("gm", "exception", "grant");
  eq(paid(F), ["full"], "P8e-R2: granted from the free-standing card: the attack costs its full action");
  const M = fight();
  await M.req("p1", { op: "exception", actor: "H1", text: "I climb", decl: { action: "move", to: "z4" } });
  eq(!!M.prompt("exception")?.data?.waive, false, "CI1: (a free-standing request that names a move the rules refuse)");
  await M.answer("gm", "exception", "grant");
  eq([M.top()?.status, paid(M)], ["manual", ["quick"]], "CI1: granted from the free-standing card: the move costs a move action");
  const A = fight();
  eq(code(await A.gm({ op: "declare", actor: "H1", decl: { action: "move", to: "z4", exception: { text: "GM" } } })), "ok", "CI1: (the GM's 'declare anyway' on a refused move)");
  eq([A.top()?.status, paid(A)], ["manual", ["quick"]], "CI1: the GM's 'declare anyway' on a move costs a move action");
}
done("fxd2");
const s = summary();
console.log(`sweep fxd2: ${s.checks} checks, ${s.failed} failed`);
process.exit(s.failed ? 1 : 0);
