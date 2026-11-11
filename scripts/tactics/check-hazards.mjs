// node scripts/tactics/check-hazards.mjs -- package P5: the hazards (spec 9.8) and the triggers the map and the statuses make due by
// themselves (spec 6.1), through the REAL director, engine, round driver and journal with a scripted table and a small scripted map.
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as Hz from "./flows/hazards.mjs";
import { hazards } from "../rules/index.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const st = (T, cid) => M.statusesOf(T.state, cid).map((s) => s.id);
const closed = (T) => T.evs("actionClosed").pop()?.summary?.result;
/* a table with a map: zones with tags, borders (the rules library's graph shape), registry fire states, and the GM's own fire mark */
class HT extends Table {
  constructor(o) { super(o); this.map = { zones: { z1: {}, z2: { flammable: true }, z3: { flammable: true }, z4: {} }, borders: [{ id: "z1|z2", a: "z1", b: "z2", wall: null, door: null }, { id: "z1|z3", a: "z1", b: "z3", wall: { armor: 2, state: "intact" }, door: null }, { id: "z1|z4", a: "z1", b: "z4", wall: null, door: null }], registry: {}, areas: {} }; }
  statesOf(key) { return [...(this.map.registry[key] ?? []), ...(this.zoneMarks[key]?.fire ? [{ id: "mark:fire", kind: "fire", level: this.zoneMarks[key].fire, source: "mark", zone: key }] : [])]; }
  facts() {
    const f = super.facts(), T = this;
    const place = (cid) => (T.c[cid] ? (T.map.areas[cid] ? { zone: null, area: T.map.areas[cid], spot: `@${T.map.areas[cid]}` } : { zone: T.c[cid].zone, level: "ground", spot: T.c[cid].zone, area: null }) : null);
    return { ...f, zones: { place, zone: (key) => (T.map.zones[key] ? { key, tags: T.map.zones[key].tags ?? [] } : null), states: (key) => T.statesOf(String(key).split(":")[0]),
      graph: () => ({ zones: Object.entries(T.map.zones).map(([id, z]) => ({ id, flammable: !!z.flammable, tags: z.tags ?? [] })), borders: T.map.borders }) } };
  }
  async perform(e) {
    if (e.t === "zones" && e.op?.op === "zoneState.remove") { const z = Object.keys(this.map.registry).find((k) => this.map.registry[k].some((s) => s.id === e.op.id)); if (!z) return { ok: false, reason: "noState" }; const state = this.map.registry[z].find((s) => s.id === e.op.id); this.map.registry[z] = this.map.registry[z].filter((s) => s !== state); this.performed.push(e); return e.undo ? {} : { op: { t: "zones", op: e.op, inverse: { op: "zoneState.add", zone: z, state } } }; }
    if (e.t === "zones" && e.op?.op === "zoneState.add") { (this.map.registry[e.op.zone] ??= []).push(e.op.state); this.performed.push(e); return {}; }
    return super.perform(e);
  }
}
const base = (o = {}) => { const T = new HT(); T.hero("H1", "p1", { zone: "z1", ...(o.H1 ?? {}) }).hero("H2", "p2", { zone: "z2" }).npc("N1", { health: 5, zone: "z1", armor: [{ id: "vest", armor: 1 }] }).npc("N2", { health: 4, zone: "z4" }); T.order(["H1", "N1", "H2", "N2"]).turn("H1"); return T; };
const endTurn = (T, user, actor) => T.req(user, { op: "endTurn", actor, round: T.state.round, slot: T.state.init.cur, ...(user === "gm" ? { force: true } : {}) });
/* play the round out: everybody ends the turn in the order of the cards */
async function endRound(T) { for (let g = 0; g < 8 && T.state.phase === "turns" && T.state.init.curMember; g++) await endTurn(T, "gm", T.state.init.curMember); }

/* ================================================================== placed explosive [B2905-2923] */
{
  eq([4, 6, 8, 10].map(hazards.blastDamage), [2, 3, 4, 5], "[B2905-2921] base Damage = half the Blast rating, rounded up");
  const T = base();
  eq(code(await T.req("p1", { op: "hazardRun", run: { type: "blast", rating: 6 }, subject: { zone: "z1" } })), "noPermission", "a player cannot set off a hazard");
  T.dice.push([6, 3, 3, 2, 1, 4]);                                // one six: it goes off, nobody is doubled
  eq(code(await T.gm({ op: "hazardRun", run: { type: "blast", rating: 6 }, subject: { zone: "z1" } })), "ok", "blast: the GM sets it off in a zone");
  let I = T.top();
  eq([I.flow, I.step, I.decl.targets, I.initiator.type, I.actor], ["blast", "dodge", ["H1", "N1"], "hazard", null], "blast: everybody in the zone, no actor");
  const hp = T.prompt("hazardDodge", "H1"), np = T.prompt("hazardDodge", "N1");
  eq([hp.to, np.to, hp.options.map((o) => o.id), hp.options[0].cost], [{ users: ["p1"] }, "gm", ["dodge", "pass"], "quick"], "blast: each target may dodge [B2922]; the NPC at the GM desk");
  await T.req("p1", { op: "answer", prompt: hp.id, value: "dodge" });
  eq(P1.budget(T.state, "H1").quick.filter((q) => q === "used").length, 1, "blast: the dodge costs a quick action");
  await T.gm({ op: "answerFor", prompt: np.id, value: "pass" });
  eq([T.lastRequest().key, T.lastRequest().attr, T.lastRequest().maxPush], ["def:H1", "agility", 0], "blast: the dodger rolls AGILITY, no push [B2241]");
  const h0 = T.c.H1.health, n0 = T.c.N1.health;
  await T.roll("def:H1", 1);
  eq([T.state.stack.length, T.c.H1.health, T.c.N1.health, closed(T)], [0, h0, n0 - 2, "hit"], "blast 6 with one six: Damage 3, Armor 1 taken off; a dodge with as many sixes avoids it");
  eq(T.requests.filter((r) => r.key === "blast").length, 0, "blast: the hazard's dice are the executor's, never a roll request (no push [B2922])");
  /* undo restores Health and the quick action */
  const undone = await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
  eq([T.c.N1.health, P1.budget(T.state, "H1").quick.filter((q) => q === "used").length], [n0, 0], "blast: one transaction, undone as one");
  /* extra sixes double single targets before Armor, at most one each [B2923] */
  const U = base();
  await U.gm({ op: "npcPolicy", combatant: "N1", policy: { dodge: "never" } });
  U.dice.push([6, 6, 6, 1, 1, 1]);
  await U.gm({ op: "hazardRun", run: { type: "blast", rating: 6 }, subject: { zone: "z1" } });
  eq(U.prompts("hazardDodge").map((p) => p.about), ["H1"], "blast: an NPC whose policy is never to dodge is not asked (spec 13.3)");
  await U.answer("p1", "hazardDodge", "pass", "H1");
  eq([6 - U.c.H1.health, 5 - U.c.N1.health], [6, 5], "blast: two extra sixes, two targets: both doubled before Armor (3x2, 3x2-1)");
  eq(st(U, "N1").includes("broken"), true, "blast: a target at 0 Health is broken");
  /* no six: a dud */
  const D = base();
  D.dice.push([1, 2, 3, 4]);
  await D.gm({ op: "hazardRun", run: { type: "blast", rating: 4, targets: ["N2"] } });
  await D.answer("gm", "hazardDodge", "pass", "N2");
  eq([closed(D), D.c.N2.health], ["dud", 4], "blast: without a six nothing happens [B2921]");
  eq(code(await D.gm({ op: "hazardRun", run: { type: "blast", rating: 4 }, subject: { zone: "z3" } })), "illegal", "blast: nobody there, nothing to run");
  /* the GM overrides the damage (spec 14.1) */
  const G = base();
  G.dice.push([6, 1, 1, 1]);
  await G.gm({ op: "hazardRun", run: { type: "blast", rating: 4, targets: ["N2"] } });
  await G.gm({ op: "setDamage", inst: G.top().id, target: "N2", amount: 1 });
  await G.answer("gm", "hazardDodge", "pass", "N2");
  eq(G.c.N2.health, 3, "blast: the GM's number stands");
}
/* ================================================================== an area attack of a hazard: the Magical Ward [B2876] */
{
  const T = base();
  T.dice.push([6, 6, 6, 2, 2, 2, 2, 2]);
  await T.gm({ op: "hazardRun", run: { type: "area", pool: 8, damage: 5, name: "Magical Ward" }, subject: { zone: "z1" } });
  await T.answer("p1", "hazardDodge", "pass", "H1"); await T.answer("gm", "hazardDodge", "pass", "N1");
  eq([6 - T.c.H1.health, 5 - T.c.N1.health], [5, 4], "ward: pool 8, Damage 5 to everybody hit, Armor applies");
  const sp = T.prompt("hazardStunts");
  eq([sp?.to, sp?.data?.surplus], ["gm", 2], "ward: the surplus sixes go to the GM as stunts to distribute");
  T.dice.push([3]);                                               // the injury die of the broken NPC, if the GM asks for one
  await T.gm({ op: "answerFor", prompt: sp.id, value: "done" });
  ok(T.state.stack.length === 0 || T.prompts().length > 0, "ward: closed, or waiting for the GM's word on the broken NPC");
}
/* ================================================================== fire at the start of a round: attacks and spread from the map [B2925-2927] */
{
  const T = base();
  T.zoneMarks.z1 = { fire: 7 };                                    // the GM's own fire mark, Intensity 7
  eq(Hz.burningZones(T.facts().zones), [{ zone: "z1", at: null, intensity: 7, refs: [{ source: "mark", id: "mark:fire" }] }], "the burning zones are read from the map");
  eq(Hz.spreadCandidates(T.facts().zones, "z1"), ["z2"], "[B2927] spread: a neighbour behind an open border that can burn (z3 is behind a wall, z4 holds nothing that burns)");
  await gmBurn(T, "H2");                                           // on fire, but not in a burning zone
  await endRound(T);
  eq([T.state.round, T.state.phase], [2, "roundStart"], "round 2 waits at its start");
  const q = T.prompt("triggerQueue");
  eq(q.options.map((o) => [o.data.type, o.data.zone ?? o.data.combatant, o.data.intensity, o.data.targets ?? null]), [["fireAttack", "z1", 7, ["H1", "N1"]], ["fireAttack", "H2", 6, ["H2"]], ["fireSpread", "z1", 7, null]],
    "the queue: the zone's attack on everybody in it, the burning character's own attack, then the spread roll [OQ-4]");
  eq(T.state.triggers.length, 0, "nothing was registered: the queue is derived from the map and the statuses");
  T.dice.push([6, 1, 1, 1, 1, 1, 1], [6, 6, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1], [5], [1]);       // H1: one six; N1: two; H2: none; spread D6 = 5; the pick among one candidate
  const h1 = T.c.H1.health, n1 = T.c.N1.health, h2 = T.c.H2.health;
  await T.gm({ op: "answer", prompt: q.id, value: { order: [] } });
  eq([h1 - T.c.H1.health, n1 - T.c.N1.health, T.c.H2.health], [2, 3, h2], "fire: 2 damage per six, Armor applies [B2925]");
  eq([st(T, "H1").includes("burning"), M.statusesOf(T.state, "H1").find((s) => s.id === "burning")?.data?.intensity, st(T, "H2")], [true, 7, []],
    "fire: damage sets on fire (the status remembers the Intensity); outside a burning zone an attack without damage puts the fire out [B2926]");
  const sp = T.prompt("fireSpread");
  eq([sp?.to, sp?.options.map((o) => o.id), sp?.data?.pick, sp?.data?.from], ["gm", ["z:z2", "none"], "z2", "z1"], "spread: 5-6 spreads; the GM confirms the zone the dice named [OQ-15]");
  eq(T.state.round, 2, "the round is held while the hazards run");
  await T.gm({ op: "answerFor", prompt: sp.id, value: "z:z2" });
  eq([T.zoneMarks.z2?.fire, T.state.stack.length, T.state.phase], [7, 0, "turns"], "spread: the neighbour burns with the same Intensity; the round goes on");
  eq(T.prompts("triggerQueue").length, 0, "the new fire does not attack in the round it started [A4]");
  /* the next round: two burning zones; H2 stands in the new one */
  await endRound(T);
  const q2 = T.prompt("triggerQueue");
  eq(q2.options.map((o) => [o.data.type, o.data.zone]), [["fireAttack", "z1"], ["fireAttack", "z2"], ["fireSpread", "z1"], ["fireSpread", "z2"]], "round 3: both zones attack and roll for spreading; H1 burns but is attacked once (in its zone)");
  /* the GM unticks one attack; a 1-2 puts a fire out */
  T.dice.push([1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1], [2], [3]);
  const skip = q2.options.filter((o) => o.data.type === "fireAttack" && o.data.zone === "z2").map((o) => o.id);
  await T.gm({ op: "answer", prompt: q2.id, value: { order: [], skip } });
  eq([T.zoneMarks.z1?.fire ?? null, T.zoneMarks.z2?.fire, T.state.stack.length], [null, 7, 0], "spread: 1-2 the fire of z1 goes out, 3-4 the fire of z2 stays");
  eq(st(T, "H1").includes("burning"), true, "a character stays on fire when its zone stops burning (an attack inside a burning zone without damage changes nothing)");
  const undone = await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
  ok(undone?.ok !== false && T.log.list.at(-1).state === "undone", "the last hazard can be undone as one transaction");
}
async function gmBurn(T, cid) { await T.gm({ op: "statusAdd", combatant: cid, status: { id: "burning" } }); }
/* a registry fire (a power's, with an owner) goes out through the registry; nowhere to spread holds the fire */
{
  const T = base();
  T.map.registry.z4 = [{ id: "s7", kind: "fire", level: 9, source: "registry", zone: "z4" }];
  await endRound(T);
  const q = T.prompt("triggerQueue");
  eq(q.options.map((o) => [o.data.type, o.data.zone, o.data.intensity]), [["fireAttack", "z4", 9], ["fireSpread", "z4", 9]], "a registry fire counts like a mark");
  T.dice.push([1, 1, 1, 1, 1, 1, 1, 1, 1], [6]);
  await T.gm({ op: "answer", prompt: q.id, value: { order: [] } });
  eq([closed(T), T.prompts("fireSpread").length, T.map.registry.z4.length], ["nowhere", 0, 1], "spread: 5-6 but z1 next door holds nothing that burns: the fire stays where it is");
  await endRound(T);
  T.dice.push([1, 1, 1, 1, 1, 1, 1, 1, 1], [1]);
  await T.gm({ op: "answer", prompt: T.prompt("triggerQueue").id, value: { order: [] } });
  eq([T.map.registry.z4.length, T.performed.filter((e) => e.t === "zones" && e.op?.op === "zoneState.remove").length], [0, 1], "spread: 1-2 removes the registry state");
  await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
  eq(T.map.registry.z4.length, 1, "and the undo puts it back through the map's own inverse");
}
/* a trigger registered by hand for the same thing is not doubled */
{
  const T = base();
  T.zoneMarks.z1 = { fire: 6 };
  await T.gm({ op: "triggerAdd", trigger: { at: "roundStart", subject: { zone: "z1" }, run: { type: "fireAttack", intensity: 6 }, source: { kind: "gm", name: "fire" } } });
  await endRound(T);
  eq(T.prompt("triggerQueue").options.map((o) => o.data.type), ["fireAttack", "fireSpread"], "one fire attack per zone, the registered one");
}
/* ================================================================== vacuum [B2929], [B2260] */
{
  eq([1, 2, 3, 4].map(hazards.vacuumDice), [0, -1, -2, -3], "[B2929] unmodified in the first round, one die less each further round");
  const T = base();
  T.map.zones.z1.tags = ["vacuum"];
  ok(Hz.inVacuum(T.facts(), "H1") && !Hz.inVacuum(T.facts(), "H2"), "vacuum: a zone marked so");
  T.c.N1.vacuumSafe = true;
  ok(!Hz.inVacuum(T.facts(), "N1"), "vacuum: not with a suit, a hull or a protective power");
  T.map.areas.N2 = "orbit";
  ok(Hz.inVacuum(T.facts(), "N2"), "vacuum: in orbit [B2260]");
  await endRound(T);                                              // round 2 starts; the first card's turn opens
  const first = T.state.init.curMember;
  T.turn("H1");
  const q = T.prompts("triggerQueue").find((p) => p.about === "H1");
  eq([q?.data?.at, q?.options.map((o) => o.data.type)], ["turnStart", ["vacuum"]], "vacuum: due at the start of the character's turn");
  await T.gm({ op: "answer", prompt: q.id, value: { order: [] } });
  let r = T.lastRequest();
  eq([r.key, r.attr, r.dice, r.maxPush, T.top().flow], ["roll", "strength", 4, 0, "vacuum"], "vacuum: STRENGTH, no action, never pushed [A-2]");
  await T.roll("roll", 1);
  eq([T.state.stack.length, T.c.H1.health, M.counterGet(T.state, M.counterKey.scene("H1", "vacuum"))], [0, 6, 1], "vacuum: a success holds; the round of exposure is counted");
  await T.gm({ op: "hazardRun", run: { type: "vacuum" }, subject: { combatant: "H1" } });
  r = T.lastRequest();
  eq([r.dice, r.pool.mods.find((m) => m.source === "vacuum")?.dice], [3, -1], "vacuum: one die less in the second round");
  await T.roll("roll", 0);
  eq([T.c.H1.health, st(T, "H1").sort(), T.c.H1.crits, closed(T)], [0, ["broken", "suffocating"], [], "broken"], "vacuum: a failure drops to 0 Health: broken, no critical injury");
  ok(first !== undefined, "the round had a first card");
  /* the turn after: no roll, the GM says whether the character reached pressure */
  await T.gm({ op: "hazardRun", run: { type: "vacuum" }, subject: { combatant: "H1" } });
  const fp = T.prompt("vacuumDeath");
  eq([fp?.to, fp?.about, fp?.options.map((o) => o.id), T.requests.filter((x) => x.key === "roll").length], ["gm", "H1", ["saved", "dead"], 2], "vacuum: dead on the next turn unless brought to pressure: the GM's card, no third roll");
  await T.gm({ op: "answerFor", prompt: fp.id, value: "dead" });
  eq([st(T, "H1").sort(), closed(T)], [["broken", "dead"], "dead"], "vacuum: dead");
  await T.gm({ op: "undo", tx: T.log.list.at(-1).id });
  eq(st(T, "H1").sort(), ["broken", "suffocating"], "vacuum: the undo takes the death back");
  await T.gm({ op: "hazardRun", run: { type: "vacuum" }, subject: { combatant: "H1" } });
  await T.answer("gm", "vacuumDeath", "saved");
  eq(st(T, "H1"), ["broken"], "vacuum: saved, still broken");
  /* a suffocating character is due on its turn even after leaving the zone */
  eq(Hz.derived({ ...T.state, statuses: { H2: [{ id: "suffocating" }] } }, T.facts(), { at: "turnStart", combatant: "H2" }).map((t) => t.run.type), ["vacuum"], "vacuum: the turn after the failure is due wherever the character is");
}
/* ================================================================== disease and poison [B2899-2902] */
{
  const T = base();
  await T.gm({ op: "hazardRun", run: { type: "disease", virulence: 2, name: "Swamp fever" }, subject: { combatant: "H1" } });
  let r = T.lastRequest();
  eq([r.attr, r.dice, r.maxPush, r.pool.mods.find((m) => m.source === "virulence")?.dice, r.users], ["strength", 2, 0, -2, ["p1"]], "disease: STRENGTH with the virulence as a penalty, passive, rolled by the patient's player");
  await T.roll("roll", 0);
  eq([T.c.H1.health, st(T, "H1"), closed(T)], [5, ["sick"], "sick"], "disease: exposed and failed: sick, 1 damage");
  await T.gm({ op: "hazardRun", run: { type: "disease", virulence: 2, carer: "H2" }, subject: { combatant: "H1" } });
  r = T.lastRequest();
  eq([r.attr, r.combatant, r.users], ["reason", "H2", ["p2"]], "disease: a carer rolls REASON in the patient's place");
  await T.roll("roll", 0);
  eq(T.c.H1.health, 4, "disease: sick and failed: 1 more damage");
  T.c.H1.health = 1;
  await T.gm({ op: "hazardRun", run: { type: "disease" }, subject: { combatant: "H1" } }); await T.roll("roll", 0);
  eq([T.c.H1.health, st(T, "H1").sort(), T.c.H1.crits], [0, ["broken", "sick"], []], "disease: broken by it without a critical injury");
  await T.gm({ op: "hazardRun", run: { type: "disease" }, subject: { combatant: "H1" } }); await T.roll("roll", 0);
  eq([st(T, "H1").sort(), closed(T)], [["broken", "dead"], "dead"], "disease: broken and failed again: dead");
  const U = base();
  await U.gm({ op: "statusAdd", combatant: "N1", status: { id: "sick" } });
  await U.gm({ op: "hazardRun", run: { type: "disease", secret: true }, subject: { combatant: "N1" } });
  eq([U.lastRequest().secret, U.lastRequest().users], [1, ["gm"]], "disease: the GM may roll it in secret [B2899]");
  await U.roll("roll", 1);
  eq([st(U, "N1"), closed(U)], [[], "cured"], "disease: sick and succeeded: cured");
}
/* ================================================================== triggers that name a hazard run it (spec 6.1); an unknown one stays the GM's */
{
  const T = base();
  await T.gm({ op: "triggerAdd", trigger: { at: "roundEnd", subject: { zone: "z1" }, run: { type: "blast", rating: 4 }, source: { kind: "gm", name: "Doomsday Device" }, expires: { afterRuns: 1 } } });
  await endRound(T);
  const q = T.prompt("triggerQueue");
  eq([q.data.at, q.options.map((o) => o.data.type)], ["roundEnd", ["blast"]], "a registered explosion waits in the queue of its point");
  T.dice.push([6, 1, 1, 1]);
  await T.gm({ op: "answer", prompt: q.id, value: { order: [] } });
  eq([T.top()?.flow, T.top()?.cause, T.top()?.data?.trigger?.id != null], ["blast", "trigger", true], "the engine runs it as a blast instance");
  await T.answer("p1", "hazardDodge", "pass", "H1"); await T.answer("gm", "hazardDodge", "pass", "N1");
  eq([T.c.H1.health, T.state.triggers.length, T.state.round], [4, 0, 2], "it ran once, expired, and the round went on");
}
/* ================================================================== P8: Burning Building [B2845]: the fire spreads by itself, one zone a round, and no D6 of a typical fire [B2927] puts it out */
{
  const T = base();
  T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 3, maxResolve: 3, name: "Burning Building", zone: "z1" });
  T.map.zones.z3.flammable = true; T.map.borders.find((b) => b.id === "z1|z3").wall = null;      // z2 and z3 can both catch fire
  eq(code(await T.gm({ op: "challengeSetup", challenge: "CH", preset: "burningBuilding", zone: "z1" })), "ok", "burning building: set up in z1");
  eq([T.zoneMarks.z1?.fire, T.state.triggers.filter((t) => t.run.type === "fireSpread").map((t) => [t.at, t.run.automatic, t.run.zone, t.run.intensity])], [8, [["roundStart", 1, "z1", 8]]], "burning building: Intensity 8, and its own spread trigger names the zone");
  await endRound(T);
  let q = T.prompt("triggerQueue");
  eq(q.options.map((o) => o.data.type).sort(), ["fireAttack", "fireSpread"], "burning building: the round starts with the fire attack and ONE spread, the challenge's own; no D6 spread of a typical fire");
  T.dice.push([1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [1]);                           // no fire damage; the pick among the candidates (no spread die is asked)
  await T.gm({ op: "answer", prompt: q.id, value: { order: [] } });
  const card = T.prompt("fireSpread");
  eq([card?.data?.from, card?.options.map((o) => o.id)], ["z1", ["z:z2", "z:z3", "none"]], "burning building: it spreads without a roll; the GM confirms where");
  await T.gm({ op: "answerFor", prompt: card.id, value: "z:z2" });
  eq([T.zoneMarks.z1?.fire, T.zoneMarks.z2?.fire], [8, 8], "burning building: the next zone burns with the same Intensity, the first one still burns");
  for (let g = 0; g < 12 && T.state.round < 3; g++) { const p = T.prompts()[0]; if (p && p.kind !== "triggerQueue") { await T.gm({ op: "answerFor", prompt: p.id, value: p.options[0].id }); continue; } if (T.state.phase !== "turns") break; await endTurn(T, "gm", T.state.init.curMember); }
  q = T.prompt("triggerQueue");
  eq(q?.options.filter((o) => o.data.type === "fireSpread").length, 1, "burning building: next round again one spread for the whole fire");
  T.dice.push([1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [1]);
  await T.gm({ op: "answer", prompt: q.id, value: { order: [] } });
  eq(T.prompt("fireSpread")?.options.map((o) => o.id), ["z:z3", "none"], "burning building: it goes on from wherever it burns by now");
}
{ /* once the challenge is overcome the fire is a typical one again (and the GM puts it out) */
  const T = base(); T.zoneMarks.z1 = { fire: 7 };
  T.state = { ...T.state, challenges: { CH: { preset: "burningBuilding", name: "x", objectives: [], effects: [{ when: "roundStart", kind: "fireSpread", zones: 1, automatic: true }], done: "overcome" } } };
  await endRound(T);
  eq(T.prompt("triggerQueue").options.map((o) => o.data.type).includes("fireSpread"), true, "a fire with no running challenge of its own rolls the D6 of a typical fire as before");
}
done("check-hazards");
