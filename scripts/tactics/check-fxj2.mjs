// node scripts/tactics/check-fxj2.mjs -- FXJ2: the chase defects of the second full live fight (FF7, dev/combat-defects.md), no Foundry:
//   D212  the catch-up card of a player's striker never names, counts, preselects or offers an NPC hidden from that player (Foundry-hidden
//         or unseen by every one of the player's characters); a hidden pursuer's crew does not hold a visible fleeing crew's shot
//   D211  a vehicle that was never started does not drive in a chase (it cannot roll, cannot ram); nobody who reached the prey is left out of
//         the catch in silence: who cannot strike, and why, is told on every seat (also a strike the rules refuse after it was picked)
//   D213  a held (grappled), snared or trapped character cannot move [B2496]: it never rolls for its side nor strikes on a catch; a holder
//         moves but may not charge [B2497]
//   D214  a unit out of the fight (unconscious, dead, defeated) leaves the chase: not listed, never the roller, never a target, not on the
//         end card, does not "escape"
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as V from "./view-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as CF from "./flows/chase.mjs";
import * as CP from "./ui/chase-pure.mjs";
import { t as say, EN, PL } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const car = (o = {}) => ({ kind: "vehicle", npc: true, health: 8, vehicle: { type: "ground", speed: 3, maneuver: 1, passengers: 3, weapons: 0 }, ...o });
const t = (k, p, fb) => say(k, p, fb === undefined ? k : fb);
const hiddenOf = (T) => Object.keys(T.c).filter((id) => T.c[id].hidden);
const facts = (T, v, me) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined,
  c: (id) => (T.c[id] && (me === "gm" || !T.c[id].hidden) ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: T.c[id].kind === "vehicle" ? null : CP.wayOf(T.c[id]) } : null), userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false });
const view = (T, me, owns) => (me === "gm" ? T.state : V.viewFor(T.state, { id: me, staff: false, owns }, { hidden: hiddenOf(T), npc: Object.keys(T.c).filter((id) => T.c[id].npc) }));
const panel = (T, me, owns = [], own = {}) => CP.chaseData(view(T, me, owns), own, facts(T, view(T, me, owns), me), t);
const txt = (x) => JSON.stringify(x);

/* Kid drives the van, Omni and Eve (a flier) are on their own; the fleeing: Doc, the Mauler, a Soldier group, a hidden Turret */
async function table({ prey = ["N1", "N2"], pursuer = ["H3"], distance = 1, started = true, hidden = [], seat = true } = {}) {
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni", movement: [{ mode: "flight", tier: "basic" }] }).hero("H3", "p3", { name: "Eve", movement: [{ mode: "flight", tier: "basic" }] });
  T.npc("N1", { name: "Doc" }).npc("N2", { name: "Mauler" }).npc("N3", { name: "Soldier", kind: "minions", members: 3, health: 3, attrs: { agility: 1 } }).npc("NT", { name: "Turret", hidden: hidden.includes("NT"), attrs: { agility: 1 } });
  T.add("V1", car({ name: "Van" }));
  T.order(["H1", "N1", "H2", "N2", "H3", "N3", "NT"]).turn("H1");
  if (seat) await T.gm({ op: "vehicleSet", vehicle: "V1", seat: { who: "H1", role: "driver" }, ...(started ? { started: true } : {}) });
  eq(code(await T.gm({ op: "chaseStart", prey, pursuer, distance })), "ok", `table: the chase starts (${pursuer} after ${prey})`);
  return T;
}
async function caught(T, keys = ["pursuer"]) {
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "a chase round");
  await T.roll("prey", 0);
  for (const k of keys) await T.roll(k, 3);
  eq(T.state.chase.distance, 0, "(caught)");
}
/* the strike in progress plays out with every answer passed and every roll a miss, until the chase round is on top again */
async function settle(T) {
  for (let k = 0; k < 12 && T.top() && T.top().flow !== "chase"; k++) {
    const p = T.prompts().find((x) => x.inst === T.top().id);
    if (p) { await T.answer("gm", p.kind, p.options?.find((o) => o.id === "pass") ? "pass" : p.options[0].id, p.about); continue; }
    const r = Object.keys(T.top().rolls ?? {}).find((x) => T.top().rolls[x].sixes == null);
    if (r) await T.roll(r, 0); else break;
  }
}

/* ================================================================== D212: no hidden NPC on a player's catch-up card */
{
  const T = await table({ prey: ["NT", "N1", "N2"], hidden: ["NT"] });
  eq(CF.rollerOf({ state: T.state, facts: T.facts() }, "prey").id, "NT", "D212 premise: the hidden Turret is the slowest, so it rolls for the fleeing");
  await caught(T);
  const q = T.prompt("chaseCatch");
  eq([q?.about, q?.data.target, q?.data.targets, q?.options.map((o) => o.id)], ["H3", "N1", ["N1", "N2"], ["attack", "attack:N2", "pass"]],
    "D212: Eve's card offers only the fleeing she knows of; the first one she can see is preselected, never the hidden Turret");
  const p = panel(T, "p3", ["H3"]);
  eq([p.decision?.text, p.decision?.buttons.map((b) => [b.label, b.primary])], [say("ITAC.chase.catch.whoChargePick", { name: "Eve" }),
    [[say("ITAC.chase.catch.at", { what: EN["ITAC.opt.charge"], name: "Doc" }), true], [say("ITAC.chase.catch.at", { what: EN["ITAC.opt.charge"], name: "Mauler" }), false], [EN["ITAC.opt.pass"], false]]],
    "D212 panel: every strike button names its target, no unnamed button, no count of somebody unseen");
  ok(!/Turret|NT/.test(txt(view(T, "p3", ["H3"]))) && !/Turret|NT/.test(txt(p)), "D212: nothing of the Turret in Eve's player's view or panel");
  ok(!/Turret|NT/.test(txt(panel(T, "p1", ["H1"]))), "D212: nor on another player's panel (the catch line)");
  /* the GM's own NPC striker still sees everything (nothing hidden from the GM) */
  eq(panel(T, "gm").waits.length > 0, true, "D212: the GM is told who the table waits for");
}
/* a card opened before the GM hid the target: the view drops the hidden one's option and preselects a visible one */
{
  const T = await table({ prey: ["N1", "N2"] });
  await caught(T);
  T.c.N1.hidden = true;                                    // the GM hides Doc while Eve's card stands open
  const q = view(T, "p3", ["H3"]).prompts[T.prompt("chaseCatch").id];
  eq([q?.data?.target, q?.data?.targets, q?.options.map((o) => o.id)], ["N2", ["N2"], ["attack:N2", "pass"]], "D212 view: the hidden one's option goes, the card keeps its data and preselects a visible target");
  const p = panel(T, "p3", ["H3"]);
  eq([p.decision?.text, p.decision?.buttons.map((b) => b.label)], [say("ITAC.ui.line.chaseCharge", { name: "Eve", target: "Mauler" }), [EN["ITAC.opt.charge"], EN["ITAC.opt.pass"]]], "D212 panel: one target left: the card names it");
  eq(code(await T.answer("p3", "chaseCatch", "attack:N2")), "ok", "D212: Eve charges the one she sees");
  eq([T.top().action, T.top().decl.targets], ["charge", ["N2"]], "D212: at the Mauler");
}
/* unseen (knowledge): every character of the player has the fleeing NPC as unseen */
{
  const T = await table({ prey: ["N1", "N2"] });
  T.state.knowledge = { ...(T.state.knowledge ?? {}), H3: { ...(T.state.knowledge?.H3 ?? {}), N1: "unseen" } };
  await caught(T);
  eq(T.prompt("chaseCatch")?.data.targets, ["N2"], "D212 unseen: Eve's card leaves out the one she has as unseen");
}
/* the crews: a hidden pursuer's shot does not hold the visible fleeing crew (the hold would tell of somebody unseen) */
{
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H2", "p2", { name: "Omni" });
  T.npc("N1", { name: "Doc" }).npc("N2", { name: "Spy", hidden: true });
  T.add("V1", car({ name: "Van" })); T.add("V2", car({ name: "Truck" }));
  T.weapons.gun = { id: "gun", name: "gun", bonus: 1, damage: 3, range: [0, 3], sharp: false };
  T.order(["H1", "N1", "H2", "N2"]).turn("H1");
  for (const [v, who, role] of [["V2", "N1", "driver"], ["V2", "N2", "passenger"], ["V1", "H1", "driver"], ["V1", "H2", "passenger"]]) await T.gm({ op: "vehicleSet", vehicle: v, seat: { who, role }, ...(role === "driver" ? { started: true } : {}) });
  eq(code(await T.gm({ op: "chaseStart", prey: ["V1"], pursuer: ["V2"], distance: 2 })), "ok", "D212 crews: the heroes flee a truck with a hidden Spy aboard");
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "D212 crews: a round"); await T.roll("prey", 1); await T.roll("pursuer", 1);
  eq([T.state.chase.crew.ids.slice().sort(), P1.crewOrderHold(T.state, "H2")], [["H2", "N2"], false], "D212 crews: Omni's shot is not held by the hidden Spy's");
}

/* ================================================================== D211: a vehicle never started */
{
  const T = await table({ prey: ["N1"], pursuer: ["V1", "H3"], started: false });
  const v = { state: T.state, facts: T.facts() };
  eq([CF.stuckOf(v, "V1"), CF.rollerOf(v, "pursuer").id], ["notStarted", "H3"], "D211: the van that was never started cannot drive in the chase; Eve rolls for the pursuers");
  { const g = panel(T, "gm"), u = g.sides.find((s) => s.id === "pursuer").units.find((x) => x.id === "V1");
    eq([u.stuck, u.stuckText], ["notStarted", EN["ITAC.chase.stuck.notStarted"]], "D211 panel: the van says it is not started"); }
  await caught(T);
  eq(T.prompts("chaseCatch").map((p) => p.about), ["H3"], "D211: only Eve is asked; the van does not ram");
  await T.answer("p3", "chaseCatch", "pass");
  eq(T.state.chase.last.barred, [{ who: "H1", unit: "V1", reason: "notStarted" }], "D211: the chase records who could not strike and why");
  for (const [me, owns] of [["p1", ["H1"]], ["p3", ["H3"]], ["gm", []]]) {
    const b = panel(T, me, owns).beats.find((x) => x.id === "catch");
    ok(b && b.text.includes(say("ITAC.chase.catch.barred", { name: "Kid", why: EN["ITAC.reason.notStarted"] })), `D211 panel: ${me} reads that Kid could not ram and why (${b?.text})`);
  }
  eq([PL["ITAC.chase.stuck.notStarted"], typeof PL["ITAC.chase.catch.barred"]], ["Nieuruchomiony", "string"], "D211: the Polish words");
}
/* the GM marks the van not started while Kid's card stands open: the card goes, and the table is told why */
{
  const T = await table({ prey: ["N1"], pursuer: ["V1"] });
  await caught(T);
  eq(T.prompt("chaseCatch")?.about, "H1", "D211 stopped: Kid is asked to ram");
  eq(code(await T.gm({ op: "vehicleSet", vehicle: "V1", started: false })), "ok", "D211 stopped: the GM marks the van not started while the card stands open");
  eq([T.prompts("chaseCatch").length, T.state.chase.last.barred], [0, [{ who: "H1", unit: "V1", reason: "notStarted" }]], "D211 stopped: Kid's card goes, the reason is recorded");
  ok(panel(T, "p1", ["H1"]).beats.find((x) => x.id === "catch")?.text.includes(EN["ITAC.reason.notStarted"]), "D211 stopped: Kid's seat reads why nothing happened");
}
/* a strike picked, then refused by the rules when it is made (Eve took hold of somebody meanwhile): told, not dropped */
{
  const T = await table({ prey: ["N1"], pursuer: ["H3"] });
  await caught(T);
  eq(T.prompt("chaseCatch")?.about, "H3", "D211 refused: Eve is asked to charge");
  await T.gm({ op: "statusAdd", combatant: "H3", status: { id: "grappling", data: { held: "N2" } } });
  await T.gm({ op: "statusAdd", combatant: "N2", status: { id: "grappled", data: { by: "H3" } } });
  eq(T.prompt("chaseCatch")?.about, "H3", "D211 refused: (her card still stands)");
  eq(code(await T.answer("p3", "chaseCatch", "attack")), "ok", "D211 refused: Eve charges");
  ok(!T.state.stack.some((i) => i.action === "charge"), "D211 refused: (the rules refuse the charge of a holder [B2497])");
  eq(T.state.chase.last.barred, [{ who: "H3", unit: "H3", reason: "grappling" }], "D211 refused: the refusal is recorded, with its reason");
  ok(panel(T, "p3", ["H3"]).beats.find((x) => x.id === "catch")?.text.includes(EN["ITAC.reason.grappling"]), "D211 refused: Eve's seat reads why nothing happened");
}

/* ================================================================== D213: a held character cannot move */
{
  const T = await table({ prey: ["N1", "N2"], pursuer: ["H2", "H3"] });
  await T.gm({ op: "statusAdd", combatant: "H2", status: { id: "grappled", data: { by: "N2" } } });
  await T.gm({ op: "statusAdd", combatant: "N2", status: { id: "grappling", data: { held: "H2" } } });
  const v = { state: T.state, facts: T.facts() };
  eq([CF.stuckOf(v, "H2"), CF.rollerOf(v, "pursuer").id], ["held", "H3"], "D213: the held Omni cannot move [B2496]: he never rolls for the pursuers");
  eq(CF.stuckOf(v, "N2"), null, "D213: the holder may move (pulling the held one) [B2497]");
  { const g = panel(T, "gm"), u = g.sides.find((s) => s.id === "pursuer").units.find((x) => x.id === "H2");
    eq([u.stuck, u.stuckText], ["held", EN["ITAC.chase.stuck.held"]], "D213 panel: Omni is shown held"); }
  await caught(T);
  eq(T.prompts("chaseCatch").map((p) => p.about), ["H3"], "D213: the held Omni is not offered the charge");
  await T.answer("p3", "chaseCatch", "pass");
  eq(T.state.chase.last.barred, [{ who: "H2", unit: "H2", reason: "held" }], "D213: who could not strike, and why");
  ok(panel(T, "p2", ["H2"]).beats.find((x) => x.id === "catch")?.text.includes(EN["ITAC.reason.held"]), "D213 panel: Omni's seat reads why he does not strike");
}
{
  /* a holder that pursues: it moves, but its only attack is the grapple's [B2497]: no charge */
  const T = await table({ prey: ["N1"], pursuer: ["H3"] });
  await T.gm({ op: "statusAdd", combatant: "H3", status: { id: "grappling", data: { held: "N2" } } });
  await T.gm({ op: "statusAdd", combatant: "N2", status: { id: "grappled", data: { by: "H3" } } });
  await caught(T);
  eq([T.prompts("chaseCatch").length, T.state.chase.last.barred], [0, [{ who: "H3", unit: "H3", reason: "grappling" }]], "D213 holder: Eve holds the Mauler: no charge, told why");
}

/* ================================================================== D214: a unit out of the fight leaves the chase */
{
  const T = await table({ prey: ["N3", "N1", "N2"] });
  const v0 = { state: T.state, facts: T.facts() };
  eq(CF.rollerOf(v0, "prey").id, "N3", "D214 premise: the Soldier group (the slowest) rolls for the fleeing");
  await T.gm({ op: "statusAdd", combatant: "N3", status: { id: "unconscious" } });
  const v = { state: T.state, facts: T.facts() };
  eq([CF.stuckOf(v, "N3"), CF.rollerOf(v, "prey").id], ["out", "N1"], "D214: the knocked-out group is out of the chase; Doc rolls for the fleeing now");
  for (const [me, owns] of [["gm", []], ["p3", ["H3"]]]) {
    const pr = panel(T, me, owns).sides.find((s) => s.id === "prey");
    eq([pr.units.map((u) => u.id), pr.roller?.id ?? null], [["N1", "N2"], me === "gm" ? "N1" : null], `D214 panel (${me}): the Soldier is not listed among the fleeing, nor as their roller`);
  }
  await caught(T);
  eq(T.prompt("chaseCatch")?.data.targets, ["N1", "N2"], "D214: nobody may charge the knocked-out group");
  await T.answer("p3", "chaseCatch", "pass");
  eq(code(await T.gm({ op: "chaseEnd", outcome: "escaped" })), "ok", "D214: the chase ends: escaped");
  eq([T.state.chaseEnded.sides.prey, !!T.c.N3, T.state.chaseEnded.gone.map((x) => x.id).sort()], [["N1", "N2"], true, ["N1", "N2"]], "D214: the end card names only who was still fleeing; the knocked-out group does not escape (it stays in the fight)");
  ok(!/Soldier/.test(txt(panel(T, "p3", ["H3"]).ended)), "D214 panel: the end card does not name the Soldier");
}
{
  /* dead and defeated the same; a broken (0 Health, may rally) hero still stands in the list, as it did */
  const T = await table({ prey: ["N1", "N2"], pursuer: ["H3", "H2"] });
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "dead" } });
  T.c.N2.defeated = true;
  T.c.H2.health = 0;
  const v = { state: T.state, facts: T.facts() };
  eq([CF.stuckOf(v, "N1"), CF.stuckOf(v, "N2"), CF.stuckOf(v, "H2")], ["out", "out", "down"], "D214: dead and defeated are out; broken is down (still listed)");
  eq(code(await T.gm({ op: "chaseRound" })), "illegal", "D214: nobody left to flee: no roll");
}
for (const L of [EN, PL]) for (const k of ["ITAC.chase.stuck.notStarted", "ITAC.chase.stuck.held", "ITAC.chase.stuck.snared", "ITAC.chase.stuck.trapped", "ITAC.chase.stuck.driver", "ITAC.chase.stuck.out", "ITAC.chase.catch.barred"]) ok(typeof L[k] === "string" && L[k], `FXJ2: ${k} in ${L === EN ? "EN" : "PL"}`);
done("check-fxj2");
