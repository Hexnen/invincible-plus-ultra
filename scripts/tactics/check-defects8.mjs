// node scripts/tactics/check-defects8.mjs -- the defects D101, D102, D106, D110, D111 and the usability row U110 of dev/combat-defects.md
// (adversary 8, played live on four seats). Scripted table, no Foundry.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as Hz from "./flows/hazards.mjs";
import * as V from "./view-pure.mjs";
import * as UI from "./ui/model-pure.mjs";
import * as Desk from "./desk-pure.mjs";
import { t as say, EN } from "./lang.mjs";

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

/* ================================================================== D110: a minion group with nobody standing does not burn */
{
  const T = new Table();
  T.hero("H1", "p1").add("G", { npc: true, kind: "minions", health: 2, maxHealth: 10, members: 2, name: "Soldier" });
  T.order(["H1", "G"]).turn("H1");
  await T.gm({ op: "statusAdd", combatant: "G", status: { id: "burning", data: { intensity: 9 } } });
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "burning" } });
  const dfb = () => Hz.derived(T.state, T.facts(), { at: "roundStart" }).filter((t) => t.run.type === "fireAttack").map((t) => t.subject.combatant).sort();
  eq(dfb(), ["G", "H1"], "D110: a burning group with members burns at the start of a round");
  T.c.G.health = 0; T.c.G.members = 0;
  eq(dfb(), ["H1"], "D110: a group whose last members are out is not offered a fire attack");
  /* the same in a burning zone: the group is not among the targets of the zone's attack */
  const F = { ...T.facts(), zones: { place: (cid) => (T.c[cid] ? { zone: T.c[cid].zone, level: "ground", spot: T.c[cid].zone, area: null } : null), zone: (k) => ({ key: k, tags: [] }),
    states: (k) => (k === "z1" ? [{ id: "mark:fire", kind: "fire", level: 5, source: "mark", zone: "z1" }] : []), graph: () => ({ zones: [{ id: "z1", tags: [] }], borders: [] }) } };
  const zoneHit = Hz.derived(T.state, F, { at: "roundStart" }).find((t) => t.run.type === "fireAttack" && t.subject.zone === "z1");
  eq(zoneHit?.run.targets, ["H1"], "D110: an emptied group standing in a burning zone is not a target of the zone's fire");
}

/* ================================================================== D111 / U110: what a failed challenge does, and what the table is told */
{
  const tEN = (k, p = {}, fb) => say(k, p, fb);
  const playerFacts = (T) => ({ staff: false, me: "p1", c: (id) => (T.c[id] ? { name: T.c[id].name } : null) });
  const pview = (T) => V.viewFor(T.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: Object.keys(T.c).filter((id) => T.c[id].npc) });
  const pjournal = (T) => V.journalFor(T.log, { id: "p1", staff: false, owns: ["H1"] }, { concealed: [], name: (id) => T.c[id]?.name }).map((j) => UI.marks(tEN, j.text));
  const timeUp = async (T) => { T.c.CH.resolve = 1; await T.gm({ op: "nextRound", force: true }); const p = T.prompt("challengeFail"); return p; };

  /* the Doomsday Device: "run" sets off the book's Blast 10 explosion on everybody in its zone */
  {
    const T = new Table();
    T.hero("H1", "p1", { zone: "z1" }).hero("H2", "p2", { zone: "z2" }).npc("N1", { zone: "z1" });
    T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 3, maxResolve: 3, name: "Device", zone: "z1" });
    T.order(["H1", "N1", "H2"]).turn("H1");
    await T.gm({ op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice" });
    const p = await timeUp(T);
    eq(!!p, true, "D111: time is up: the GM's card");
    await T.gm({ op: "answer", prompt: p.id, value: "run" });
    const I = T.top();
    eq([I?.flow, I?.data?.hz?.kind, I?.data?.hz?.rating, I?.decl.targets, I?.status === "manual"], ["blast", "blast", 10, ["H1", "N1"], false], "D111: 'apply' sets off a Blast 10 explosion on everybody in the challenge's zone (not the device, not the one elsewhere)");
    for (let n = 0; n < 6 && T.prompts("hazardDodge").length; n++) { const d = T.prompts("hazardDodge")[0]; await T.gm({ op: "answerFor", prompt: d.id, value: "pass" }); }
    eq(T.state.stack.length, 0, "D111: the explosion resolves by itself");
    eq(pjournal(T).some((l) => l.includes("Device") && l.includes(EN["ITAC.ui.effect.blast"])), true, "U110: the players' journal names what the failed challenge did");
    const nd = UI.newsData(pview(T), {}, playerFacts(T), tEN);
    eq([nd?.text.includes("Device"), nd?.text.includes(EN["ITAC.ui.effect.blast"])], [true, true], "U110: the news names the challenge and its consequence");
  }
  /* the device off the map (no zone): the explosion cannot find its targets; the GM's item says so */
  {
    const T = new Table();
    T.hero("H1", "p1").npc("N1");
    T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 3, maxResolve: 3, name: "Device" });
    T.c.CH.zone = null;
    T.order(["H1", "N1"]).turn("H1");
    await T.gm({ op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice" });
    await T.gm({ op: "answer", prompt: (await timeUp(T)).id, value: "run" });
    eq([T.top()?.status, T.top()?.data?.challengeFx], ["manual", { challenge: "CH", kind: "blast" }], "D111: off the map the blast waits in the GM's hand");
  }
  /* Toxic Accident: the bystanders die. Nothing for the engine to do; the GM's item says what is left, and the table is told */
  {
    const T = new Table();
    T.hero("H1", "p1").npc("N1");
    T.add("CH", { kind: "challenge", npc: true, health: 10, resolve: 5, maxResolve: 5, name: "Spill" });
    T.order(["H1", "N1"]).turn("H1");
    await T.gm({ op: "challengeSetup", challenge: "CH", preset: "toxicAccident" });
    for (const q of T.prompts("triggerQueue")) await T.gm({ op: "answerFor", prompt: q.id, value: [] });
    await T.gm({ op: "answer", prompt: (await timeUp(T)).id, value: "run" });
    for (const q of T.prompts("triggerQueue")) await T.gm({ op: "answerFor", prompt: q.id, value: [] });
    const I = T.top();
    eq([I?.status, I?.data?.challengeFx?.kind], ["manual", "bystandersDie"], "D111: the bystanders' death is the GM's to settle");
    const desk = Desk.deskModel(T.state, T.log, { c: (id) => T.c[id], facts: T.facts() });
    const m = desk.manual.find((x) => x.inst === I.id);
    const md = UI.manualData ? UI.manualData(m, {}, { staff: true }, tEN) : null;
    eq([md?.costs ?? null, typeof md?.why === "string" && md.why.includes(EN["ITAC.ui.effect.bystandersDie"])], [null, true], "D111: no cost picker for nobody's action; the item says what the failure does");
    await T.gm({ op: "manual", inst: I.id, result: { cost: "none", note: "", damage: [] } });
    eq(pjournal(T).some((l) => l.includes("Spill") && l.includes(EN["ITAC.ui.effect.bystandersDie"])), true, "U110: an empty note still leaves a line the players read, naming what happened");
    const nd = UI.newsData(pview(T), {}, playerFacts(T), tEN);
    eq([nd?.text.includes("Spill"), nd?.text.includes(EN["ITAC.ui.effect.bystandersDie"])], [true, true], "U110: and the news says it");
  }
  /* the GM's words go with it */
  {
    const T = new Table();
    T.hero("H1", "p1").npc("N1");
    T.add("CH", { kind: "challenge", npc: true, health: 3, resolve: 3, maxResolve: 3, name: "Standoff" });
    T.order(["H1", "N1"]).turn("H1");
    await T.gm({ op: "challengeSetup", challenge: "CH", preset: "hostageNegotiation" });
    await T.gm({ op: "answer", prompt: (await timeUp(T)).id, value: "run" });
    await T.gm({ op: "manual", inst: T.top().id, result: { note: "two got out" } });
    const nd = UI.newsData(pview(T), {}, playerFacts(T), tEN);
    eq([nd?.text.includes(EN["ITAC.ui.effect.hostagesDie"]), nd?.text.includes("two got out")], [true, true], "U110: the GM's note is read by the players with it");
  }
}

done("check-defects8");
