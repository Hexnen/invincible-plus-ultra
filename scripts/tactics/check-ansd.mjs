// node scripts/tactics/check-ansd.mjs -- ANSD: the user's answers of 2026-11-12 on the chase (dev/combat-answers-2026-11-12.md), no Foundry:
//   CHASE2-9  the crews' order is held: the pursuers shoot first, then the fleeing [B3438]; free among the pursuers (also between groups);
//             a crew member may give the shot up (op crewPass); the GM's exception lifts the order for the round (chaseSet crewFree)
//   CHASE2-1  on a catch every pursuing unit that reached the prey may strike (charge / ram) [B3434], each picking its target
//   CHASE-4   "escaped": the fleeing NPCs leave the fight (Combat and map), undoable from the journal
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as CP from "./ui/chase-pure.mjs";
import * as R from "./relay-pure.mjs";
import { t as say, EN, PL } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
const t = (k, p, fb) => say(k, p, fb === undefined ? k : fb);
const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined,
  c: (id) => (T.c[id] ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: T.c[id].kind === "vehicle" ? null : CP.wayOf(T.c[id]) } : null), userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false });
const view = (T, me, owns) => (me === "gm" ? T.state : V.viewFor(T.state, { id: me, staff: false, owns }, { hidden: [], npc: Object.keys(T.c).filter((id) => T.c[id].npc) }));
const panel = (T, me, owns = [], own = {}) => CP.chaseData(view(T, me, owns), own, facts(T, view(T, me, owns), me), t);
const shoot = (actor, target) => ({ op: "declare", actor, decl: { action: "shoot", targets: [target], weapon: "gun" } });

/* the van (Kid driving, Omni aboard) and a flier pursue a getaway truck (Doc driving, Mauler aboard), a bike and a runner */
async function table({ prey = ["V2"], pursuer = ["V1"], distance = 1, bike = false } = {}) {
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" }).hero("H3", "p3", { name: "Eve", movement: [{ mode: "flight", tier: "basic" }] });
  T.npc("N1", { name: "Doc" }).npc("N2", { name: "Mauler" });
  T.add("V1", car({ name: "Van" })); T.add("V2", car({ name: "Truck" })); T.add("V3", car({ name: "Bike" }));
  T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
  T.order(["H1", "N1", "H2", "N2", "H3"]).turn("H1");
  T.npc("N3", { name: "Beast" }).npc("N4", { name: "Runner", attrs: { agility: 2 } });
  for (const [v, who, role] of [["V1", "H1", "driver"], ["V1", "H2", "passenger"], ["V2", "N1", "driver"], ["V2", "N2", "passenger"], ...(bike ? [["V3", "N3", "driver"]] : [])])
    await T.gm({ op: "vehicleSet", vehicle: v, seat: { who, role }, ...(role === "driver" ? { started: true } : {}) });
  eq(code(await T.gm({ op: "chaseStart", prey, pursuer, distance })), "ok", `table: the chase starts (${pursuer} after ${prey})`);
  return T;
}
/* one round where neither side closes in (nobody is caught): the crews get their shots */
async function runRound(T, { prey = 1, pursuer = 1, keys = ["pursuer"] } = {}) {
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "a chase round");
  await T.roll("prey", prey);
  for (const k of keys) await T.roll(k, pursuer);
}

/* ================================================================== CHASE2-9: the crews' order is held */
{
  const T = await table({ distance: 2 });
  await runRound(T);
  eq([T.state.chase.crew.ids, T.state.chase.crew.pursuers], [["H2", "N2"], ["H2"]], "CHASE2-9: the crews of the round, the pursuers' named as the ones who shoot first");
  eq([P1.crewOrderHold(T.state, "N2"), P1.crewOrderHold(T.state, "H2")], [true, false], "CHASE2-9: the fleeing passenger waits, the pursuing one does not");
  const cp = P1.canPay(T.state, "N2", "full", { ranged: true });
  eq([cp.ok, cp.reason, cp.gmMayAllow], [false, "crewOrder", true], "CHASE2-9: the fleeing crew's unit cannot pay while a pursuer may still shoot; the GM may allow it");
  eq([P1.canPay(T.state, "N2", "full", { ranged: true, gm: true }).ok], [true], "CHASE2-9: the GM acting through an override is not held");
  const r1 = await T.gm(shoot("N2", "H1"));
  eq([code(r1), r1.error?.params?.reason, T.state.stack.length], ["noAction", "crewOrder", 0], "CHASE2-9: the fleeing passenger's shot is refused (the reason: pursuers first), nothing on the stack");
  /* the panel: the fleeing shot greyed with why; the GM's exception button */
  { const g = panel(T, "gm"), w = g.waits.find((x) => x.id === "crew");
    eq(w.buttons.map((b) => [b.id, !!b.disabled, b.req ?? null]), [["arm:H2", false, null], ["arm:N2", true, null], ["crewFree", false, { op: "chaseSet", crewFree: true }]], "CHASE2-9 panel: the GM's fleeing shot is greyed; the exception lifts the order");
    eq(w.buttons[1].disabled, EN["ITAC.reason.crewOrder"], "CHASE2-9 panel: the greyed button says why");
    eq(g.beats.find((b) => b.id === "crew").text, `${say("ITAC.chase.crew.left", { n: 2 })}; ${EN["ITAC.chase.crew.order"]}`, "CHASE2-9 panel: the crew beat says the pursuers shoot first"); }
  /* the pursuer shoots: the order lets the fleeing go */
  eq(code(await T.req("p2", shoot("H2", "N1"))), "ok", "CHASE2-9: the pursuing passenger shoots");
  await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 0);
  eq([P1.crewOrderHold(T.state, "N2"), P1.canPay(T.state, "N2", "full", { ranged: true }).ok], [false, true], "CHASE2-9: every pursuer has shot: the fleeing may");
  eq(code(await T.gm(shoot("N2", "H1"))), "ok", "CHASE2-9: and the fleeing passenger shoots");
}
/* giving the shot up; the GM's exception; undo */
{
  const T = await table({ distance: 2 });
  await runRound(T);
  eq(code(await T.req("p1", { op: "crewPass", actor: "H2" })), "notOwner", "CHASE2-9 pass: nobody gives up another's shot");
  eq(code(await T.req("p2", { op: "crewPass", actor: "N2" })), "notOwner", "CHASE2-9 pass: nor an NPC's");
  { const p = panel(T, "p2", ["H2"]); eq(p.decision.buttons.map((b) => [b.id, b.label, b.req ?? null]), [["shoot:H2", EN["ITAC.action.shoot"], null], ["pass:H2", EN["ITAC.chase.pass"], { op: "crewPass", actor: "H2" }]], "CHASE2-9 panel: the pursuer's own seat: shoot, or no shot"); }
  eq(code(await T.req("p2", { op: "crewPass", actor: "H2" })), "ok", "CHASE2-9 pass: Omni gives the shot up");
  eq([T.state.ledger.H2.grants.find((g) => g.kind === "chaseCrew").usedBy, P1.crewOrderHold(T.state, "N2")], ["pass", false], "CHASE2-9 pass: the shot is spent, the fleeing may shoot");
  eq(code(await T.req("p2", { op: "crewPass", actor: "H2" })), "gone", "CHASE2-9 pass: twice is nothing");
  eq(T.log.list[T.log.list.length - 1].label.gm, `Omni: ${EN["ITAC.journal.crewPass"]}`.replace(EN["ITAC.journal.crewPass"], "{ITAC.journal.crewPass}"), "CHASE2-9 pass: one journal line");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "CHASE2-9 pass: the GM undoes it");
  eq([!!T.state.ledger.H2.grants.find((g) => g.kind === "chaseCrew").usedBy, P1.crewOrderHold(T.state, "N2")], [false, true], "CHASE2-9 pass: the shot is back, the order holds again");
  /* the GM's exception for the round */
  eq(code(await T.gm({ op: "chaseSet", crewFree: true })), "ok", "CHASE2-9 exception: the GM lets the fleeing shoot now");
  eq([T.state.chase.crew.free, P1.crewOrderHold(T.state, "N2")], [1, false], "CHASE2-9 exception: the order is lifted for this round");
  { const g = panel(T, "gm"), w = g.waits.find((x) => x.id === "crew"); eq(w.buttons.map((b) => [b.id, !!b.disabled]), [["arm:H2", false], ["arm:N2", false]], "CHASE2-9 exception panel: both shots open, no exception button"); }
  eq(code(await T.gm(shoot("N2", "H1"))), "ok", "CHASE2-9 exception: the fleeing passenger shoots first");
  /* the next round's crews are held again */
  await T.answer("gm", "reaction", "pass", "H1").catch(() => {}); for (let k = 0; k < 4 && T.state.stack.length; k++) { const r = T.top()?.rolls ? Object.keys(T.top().rolls).find((x) => T.top().rolls[x].sixes == null) : null; if (r) await T.roll(r, 0); else break; }
  for (let k = 0; k < 4 && T.prompts().length; k++) await T.answer("gm", T.prompts()[0].kind, "pass", T.prompts()[0].about);
  eq(T.state.stack.length, 0, "CHASE2-9 exception: (the shot resolved)");
  await runRound(T);
  eq([T.state.chase.crew.free ?? null, P1.crewOrderHold(T.state, "N2")], [null, true], "CHASE2-9 exception: only for the round it was given; the next round's crews are held again");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "combat" })), "ok", "CHASE2-9: (the chase ends)");
  eq(code(await T.gm({ op: "chaseSet", crewFree: true })), "gone", "CHASE2-9 exception: nothing to lift without a chase");
  ok(R.normalize({ op: "crewPass", actor: "H2" }).ok && !R.normalize({ op: "crewPass" }).ok, "CHASE2-9: a player may send crewPass for a combatant, nothing else");
  for (const L of [EN, PL]) for (const k of ["ITAC.reason.crewOrder", "ITAC.chase.pass", "ITAC.chase.passAs", "ITAC.chase.gm.crewFree", "ITAC.chase.gm.crewFreeTip", "ITAC.chase.do.crewWait", "ITAC.journal.crewPass"]) ok(typeof L[k] === "string" && L[k], `CHASE2-9: ${k} in ${L === EN ? "EN" : "PL"}`);
}
/* free among the pursuers, also between groups; the fleeing seat's own panel */
{
  const T = await table({ distance: 2, pursuer: ["V1", "V3"], bike: true });
  await T.gm({ op: "chaseSet", unit: "V3", side: "pursuer", group: "new", distance: 2 });
  /* the bike carries a passenger, a pursuer of group B */
  await T.gm({ op: "vehicleSet", vehicle: "V3", seat: { who: "H3", role: "passenger" } });
  await runRound(T, { keys: ["pursuer:g1", "pursuer:g2"] });
  eq([T.state.chase.crew.pursuers.slice().sort(), P1.crewOrderHold(T.state, "H3"), P1.crewOrderHold(T.state, "H2")], [["H2", "H3"], false, false], "CHASE2-9 groups: both groups' crews are pursuers, neither waits for the other");
  eq(code(await T.req("p3", shoot("H3", "N1"))), "ok", "CHASE2-9 groups: group B's passenger shoots before group A's");
  await T.answer("gm", "reaction", "pass", "N1"); await T.roll("attack", 0);
  eq(P1.crewOrderHold(T.state, "N2"), true, "CHASE2-9 groups: the fleeing still wait for group A");
  T.users.p5 = { id: "p5", staff: false, active: true }; T.c.N2.owners = ["p5"]; T.c.N2.npc = false;      // the fleeing passenger as a player's seat
  const p = panel(T, "p5", ["N2"]);
  eq([p.decision?.kind, p.decision?.text, p.decision?.buttons.map((b) => [b.id, !!b.disabled, b.arm ?? null])], ["crew", EN["ITAC.chase.do.crewWait"], [["shoot:N2", true, null], ["pass:N2", false, null]]], "CHASE2-9 panel: a fleeing seat sees its shot greyed until the pursuers are done, and may give it up");
}

/* ================================================================== CHASE2-1: every unit that reached the prey may strike, its pick of target */
{
  const T = await table({ distance: 1, pursuer: ["V1", "H3"], prey: ["V2", "N4", "V3"], bike: true });
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "CHASE2-1: a round");
  await T.roll("prey", 0); await T.roll("pursuer", 2);
  eq(T.state.chase.distance, 0, "CHASE2-1: caught");
  /* the one who rolled for the pursuers first (the flier: the slowest), then the van */
  const q1 = T.prompt("chaseCatch");
  eq([q1.about, q1.data.targets, q1.options.map((o) => o.id)], ["H3", ["N4", "V2", "V3"], ["attack", "attack:V2", "attack:V3", "pass"]], "CHASE2-1: the flier (who rolled) is asked first; the target is hers to pick, the one who rolled for the fleeing offered first");
  { const p = panel(T, "p3", ["H3"]); eq(p.decision.buttons.map((b) => b.label), [say("ITAC.chase.catch.at", { what: EN["ITAC.opt.charge"], name: "Runner" }), say("ITAC.chase.catch.at", { what: EN["ITAC.opt.charge"], name: "Truck" }), say("ITAC.chase.catch.at", { what: EN["ITAC.opt.charge"], name: "Bike" }), EN["ITAC.opt.pass"]], "CHASE2-1 panel: one button per target, named");
    eq([p.catch.text, p.catch.pick], [say("ITAC.chase.catch.whoChargePick", { name: "Eve" }), true], "CHASE2-1 panel: the catch line says she picks"); }
  eq(code(await T.answer("p3", "chaseCatch", "attack:V2")), "ok", "CHASE2-1: Eve charges the truck");
  eq([T.top().action, T.top().actor, T.top().decl.targets, T.top().data.chaseCatch], ["charge", "H3", ["V2"], 1], "CHASE2-1: the charge at the picked target");
  for (let k = 0; k < 6 && T.top()?.flow !== "chase"; k++) { const p = T.prompts().find((x) => x.inst === T.top().id); if (p) { await T.answer("gm", p.kind, p.options?.find((o) => o.id === "pass") ? "pass" : p.options[0].id, p.about); continue; } const r = Object.keys(T.top().rolls ?? {}).find((x) => T.top().rolls[x].sixes == null); if (r) await T.roll(r, 0); else break; }
  const q2 = T.prompt("chaseCatch");
  eq([q2?.about, q2?.data.ram, q2?.options.map((o) => o.id)], ["H1", 1, ["attack", "attack:V2", "attack:V3", "pass"]], "CHASE2-1: then the van's driver may ram, his own pick");
  eq(code(await T.answer("p1", "chaseCatch", "attack:V3")), "ok", "CHASE2-1: Kid rams the bike");
  eq([T.top().action, T.top().actor, T.top().decl.targets], ["ram", "H1", ["V3"]], "CHASE2-1: the ram at the bike");
}
/* one target: the card as before; a pursuer that cannot move does not strike; groups: only those of the group that reached them */
{
  const T = await table({ distance: 1, pursuer: ["V1", "H3"], prey: ["N4"] });
  T.c.H3.health = 0;
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "CHASE2-1: a round");
  await T.roll("prey", 0); await T.roll("pursuer", 2);
  const q = T.prompt("chaseCatch");
  eq([q.about, q.options.map((o) => o.id), panel(T, "p1", ["H1"]).decision.buttons.map((b) => b.label)], ["H1", ["attack", "pass"], [EN["ITAC.action.ram"], EN["ITAC.opt.pass"]]], "CHASE2-1: one target: the card as before; the broken flier does not strike");
  await T.answer("p1", "chaseCatch", "pass");
  eq(T.prompts("chaseCatch").length, 0, "CHASE2-1: nobody else to ask");
}
{
  const T = await table({ distance: 1, pursuer: ["V1", "H3"], prey: ["V2"] });
  await T.gm({ op: "chaseSet", unit: "H3", side: "pursuer", group: "new", distance: 3 });
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "CHASE2-1 groups: a round");
  await T.roll("prey", 0); await T.roll("pursuer:g1", 2); await T.roll("pursuer:g2", 0);
  eq([T.state.chase.groups.map((g) => g.distance), T.prompts("chaseCatch").map((p) => p.about)], [[0, 3], ["H1"]], "CHASE2-1 groups: only the group that reached them strikes");
  await T.answer("p1", "chaseCatch", "pass");
  eq(T.prompts("chaseCatch").length, 0, "CHASE2-1 groups: the flier 3 behind is not asked");
}

/* ================================================================== CHASE-4: "escaped" takes the fleeing NPCs out of the fight */
{
  const T = await table({ distance: 4, prey: ["V2", "N4", "V3"], bike: true });
  T.hero("H5", "p5", { name: "Robot" });
  await T.gm({ op: "vehicleSet", vehicle: "V3", seat: { who: "H5", role: "passenger" } });      // a hero rides the bike: it stays
  const before = Object.keys(T.c).length;
  eq(code(await T.gm({ op: "chaseEnd", outcome: "escaped" })), "ok", "CHASE-4: the GM ends the chase: they got away");
  eq([["V2", "N1", "N2", "N4"].map((id) => !!T.c[id]), ["V3", "N3", "H5", "V1", "H1", "H2"].map((id) => !!T.c[id])], [[false, false, false, false], [true, true, true, true, true, true]],
    "CHASE-4: the truck with its NPC crew and the runner leave the fight; the bike with a hero aboard stays; the pursuers stay");
  eq([Object.keys(T.c).length, T.state.chaseEnded.gone.map((x) => x.name).sort()], [before - 4, ["Doc", "Mauler", "Runner", "Truck"]], "CHASE-4: four combatants gone, their names kept on the end record");
  const e = panel(T, "p1", ["H1"]);
  eq([e.ended.sides.find((s) => s.id === "prey").units[0], /Doc|Mauler|Runner|Truck/.test(e.ended.gone)], ["Truck", true], "CHASE-4 panel: the end card still names who left, and says they left the fight");
  eq(code(await T.gm({ op: "undo", tx: T.log.list[T.log.list.length - 1].id })), "ok", "CHASE-4: the GM undoes the end");
  eq([["V2", "N1", "N2", "N4"].every((id) => !!T.c[id]), T.state.kind, T.state.chaseEnded ?? null], [true, "chase", null], "CHASE-4: undone, they are back in the fight and in the chase");
  eq([T.state.vehicles.V2?.driver, T.state.vehicles.V2?.crew, (T.state.statuses.N2 ?? []).map((x) => x.id), !!T.state.ledger.N1], ["N1", ["N2"], ["inVehicle"], true], "CHASE-4: undone, the truck has its driver and passenger again (seats, marks and ledgers are part of the undone entry)");
}
{
  const T = await table({ distance: 4, prey: ["V2", "N4"] });
  eq(code(await T.gm({ op: "chaseEnd", outcome: "gaveUp" })), "ok", "CHASE-4: another end");
  eq([["V2", "N1", "N2", "N4"].every((id) => !!T.c[id]), T.state.chaseEnded.gone ?? null, panel(T, "gm").ended.gone], [true, null, null], "CHASE-4: only \"escaped\" takes anybody out");
  const T2 = await table({ distance: 4, prey: ["H3"], pursuer: ["V2"] });
  eq(code(await T2.gm({ op: "chaseEnd", outcome: "escaped" })), "ok", "CHASE-4: a hero escapes");
  eq([!!T2.c.H3, T2.state.chaseEnded.gone ?? null], [true, null], "CHASE-4: a player's character never leaves by itself");
  for (const L of [EN, PL]) ok(/\{names\}/.test(L["ITAC.chase.end.gone"]) && /NPC/.test(L["ITAC.chase.end.tip.escaped"]), `CHASE-4: the end card line and the button's tip say it (${L === EN ? "EN" : "PL"})`);
}
done("check-ansd");
