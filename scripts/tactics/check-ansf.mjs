/* node scripts/tactics/check-ansf.mjs -- ANSF: the user's answers of 2026-11-12 (dev/combat-answers-2026-11-12.md) built. One block per
   answer; each pins the decision as the user worded it. Fights run through the REAL director, engine and view (testkit Table; the fake map
   of check-kit-map for falls, fire and moves).
     A7 + SWEEP-6 + P8-1      «Wszystkie jak rekomendacja»: a stop on a rooftop is no fall; a carried one left in the air falls by itself
     INT-10                   «Wszystkie 4 zmiany»: another level of the same burning zone is no new entering of the fire
     A11 + P7-1 + SWEEP-R7    «Wszystkie 4 zmiany»: the chase obstacles and the way out of the dark are pushed; a fall and the vacuum not
     A41                      «Wszystkie 4 zmiany»: an extra opponent takes every stunt on its own (Disarm, special, own too)
     A25 + P8b-R5             «Wszystkie 4 zmiany»: the weapon's STUN effect works by itself on a hit with damage
     CI1 + P8d-3 + M2         «Wszystkie 6 zmian»: a player's move let through as an exception costs a move; the GM's "without cost" is free
     P5-2 + P5-R6             «Wszystkie 6 zmian»: the vacuum exposure counts from each entering
     P5-6 + P5-R8             «Wszystkie 6 zmian»: Save Bystanders needs the body (refused when held, snared, immobilised); Use Power is open
     P7-5                     «Wszystkie 6 zmian»: the toxin "at the start of a hero's turn" reaches a hero who joined later
     P7-12                    «Wszystkie 6 zmian»: the powers of the book's challenges are found by the compendium identifier
     P6-5                     «Wszystkie 6 zmian»: Luck Control as an interrupt works on the roll of the action it interrupted */
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable, CITY } from "./check-kit-map.mjs";
import * as M from "./mods-pure.mjs";
import * as P1 from "./economy-pure.mjs";
import * as KP from "./kit-pure.mjs";
import * as K from "./flows/kit.mjs";
import * as Hz from "./flows/hazards.mjs";
import * as Challenge from "./flows/challenge.mjs";
import * as Sys from "./system-adapter.mjs";
import * as D from "./desk-pure.mjs";
import * as V from "./view-pure.mjs";
import * as UM from "./ui/model-pure.mjs";
import { tIn } from "./lang.mjs";

const t = (k, p = {}, f) => tIn("pl", k, p, f);
const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, targets = [], extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const passAll = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
const st = (T, id) => M.statusesOf(T.state, id).map((s) => s.id);
const req = (T, key) => T.requests.filter((r) => r.key === key).pop() ?? null;
const entries = (T, cid) => (T.state.ledger[cid]?.entries ?? []).filter((e) => !e.void);
const FLY = [{ mode: "flight", tier: "basic" }];

/* ================================================================== A7 + SWEEP-6: a stop on a rooftop is no fall */
{
  const map = () => { const T = new MTable(); T.hero("H1", "p1", { attrs: { strength: 5 } }).npc("N1", { health: 6 }); T.put("H1", "z3").put("N1", "z3"); T.order(["H1", "N1"]); return T; };
  /* on the rooftop of z6, standing: nothing to roll */
  const R = map(); R.put("N1", "z6:elevated");
  await R.gm({ op: "fall", combatant: "N1" });
  eq([R.state.stack.length, R.c.N1.health, R.requests.filter((r) => r.key === "agi").length, R.spot("N1")], [0, 6, 0, "z6:elevated"], "SWEEP-6: a character on a rooftop does not fall: no dice, no roll, no damage");
  /* in the air above the building (as a throw ends, zones-api section 14): it comes down on the roof */
  const A = map(); A.put("N1", "z6:elevated"); A.map._.tokens.N1.airborne = true;
  await A.gm({ op: "fall", combatant: "N1" });
  eq([A.state.stack.length, A.c.N1.health, A.map._.tokens.N1.airborne, A.spot("N1")], [0, 6, false, "z6:elevated"], "SWEEP-6: in the air over a standing building: lands on the roof, no fall");
  /* the GM's "and falls" on the knockback card (A7, as today), the throw stops over the building z6: no fall */
  const K1 = map(); K1.put("N1", "z3:elevated"); K1.put("H1", "z2");
  await K1.gm({ op: "forcedMove", combatant: "N1", direction: { dx: 0, dy: 1 }, distance: 1 });
  ok(K1.prompt("direction")?.options.some((o) => o.id === "goFall"), "A7: the GM's card still offers 'and falls' (as today)");
  await K1.answer("gm", "direction", "goFall");
  eq([K1.spot("N1"), K1.c.N1.health, K1.requests.filter((r) => r.key === "agi").length, K1.state.stack.length], ["z6:elevated", 6, 0, 0], "SWEEP-6: 'and falls', but the throw stopped over a rooftop: no fall");
  /* over open ground the GM's "and falls" still falls */
  const O = map(); O.put("N1", "z2:elevated"); O.put("H1", "z1"); O.dice.push([4]);
  await O.gm({ op: "forcedMove", combatant: "N1", direction: { dx: 1, dy: 0 }, distance: 1 });
  await O.answer("gm", "direction", "goFall"); await O.roll("agi", 0);
  eq([O.spot("N1"), O.c.N1.health], ["z3", 2], "A7: 'and falls' over open ground: the fall as before");
  eq([t("ITAC.result.onRoof"), tIn("en", "ITAC.result.onRoof")], ["na dachu", "on the roof"], "SWEEP-6: the result has words in both languages");
}
/* ================================================================== P8-1: a carried one left in the air falls by itself */
{
  const pair = (at = "z1:elevated") => {
    const T = new MTable(); T.hero("H1", "p1", { movement: FLY }).hero("H2", "p2").npc("N1", { health: 6 }); T.put("H1", at).put("H2", at).put("N1", "z4"); T.order(["H1", "H2", "N1"]);
    T.state.statuses = { H1: [{ id: "carrying", data: { held: "H2" } }, { id: "airborne" }], H2: [{ id: "carried", data: { by: "H1" } }, { id: "airborne" }] };
    return T;
  };
  /* the carrier is knocked away: the carried one stays in the air and falls */
  const T = pair(); T.dice.push([3]);
  await T.gm({ op: "forcedMove", combatant: "H1", direction: { dx: 1, dy: 0 }, distance: 1 }); await T.answer("gm", "direction", "go");
  eq([T.spot("H1"), st(T, "H2").includes("carried"), T.top()?.flow, T.top()?.data?.fall?.who, T.lastRequest()?.key, T.lastRequest()?.attr], ["z2:elevated", false, "fall", "H2", "agi", "agility"], "P8-1: the carrier thrown off: the carried one is let go and falls by itself (its AGILITY roll)");
  await T.roll("agi", 1);
  eq([T.spot("H2"), T.c.H2.health, T.state.stack.length], ["z1", 6 - 2, 0], "P8-1: it lands below with the damage of the fall (3 on the die, one six)");
  /* the carried one itself is thrown: its own fall stays the GM's word on the card (A7), nothing more */
  const U = pair();
  await U.gm({ op: "forcedMove", combatant: "H2", direction: { dx: 1, dy: 0 }, distance: 1 }); await U.answer("gm", "direction", "go");
  eq([U.state.stack.length, U.requests.filter((r) => r.key === "agi").length], [0, 0], "P8-1: the thrown one itself does not fall unless the GM said 'and falls'");
  /* the pair over a rooftop: the one left behind stands on it */
  const W = pair("z6:elevated"); W.map._.tokens.H1.airborne = true; W.map._.tokens.H2.airborne = true;
  await W.gm({ op: "forcedMove", combatant: "H1", direction: { dx: 0, dy: -1 }, distance: 1 }); await W.answer("gm", "direction", "go");
  eq([W.state.stack.length, W.c.H2.health, W.spot("H2")], [0, 6, "z6:elevated"], "P8-1 + SWEEP-6: let go over a rooftop: on the roof, no fall");
  /* undone: nobody falls */
  const X = pair();
  await X.gm({ op: "forcedMove", combatant: "H1", direction: { dx: 1, dy: 0 }, distance: 1 });
  await X.answer("gm", "direction", "none");
  eq([X.state.stack.length, st(X, "H2").includes("carried")], [0, true], "P8-1: a throw the GM stopped parts nobody: no fall");
}
/* ================================================================== INT-10: another level of the same burning zone is no new entering */
{
  const burning = (at) => { const def = CITY(); def.states.z2 = [{ id: "s1", kind: "fire", level: 2, ...(at ? { at } : {}) }]; const T = new MTable(def); T.hero("H1", "p1").npc("N1", { health: 6 }); T.put("H1", "z4").put("N1", "z2"); T.order(["H1", "N1"]); return T; };
  const fireDice = (T) => T.performed.filter((e) => e.t === "dice" && /fire/.test(String(e.key ?? e.why ?? ""))).length;
  const T = burning(); T.dice.push([1, 1]);
  await T.gm({ op: "forcedMove", combatant: "N1", direction: "up", distance: 1 }); await T.answer("gm", "direction", "go");
  eq([T.spot("N1"), fireDice(T), T.c.N1.health], ["z2:elevated", 0, 6], "INT-10: thrown up inside the burning zone it stood in: the fire does not attack again");
  const E = burning(); E.put("N1", "z1"); E.dice.push([1, 1]);
  await E.gm({ op: "forcedMove", combatant: "N1", direction: { dx: 1, dy: 0 }, distance: 1 }); await E.answer("gm", "direction", "go");
  eq([E.spot("N1"), fireDice(E)], ["z2", 1], "INT-10: coming into the burning zone from outside is entering the fire (one attack, as before)");
  const L = burning("elevated"); L.dice.push([1, 1]);
  await L.gm({ op: "forcedMove", combatant: "N1", direction: "up", distance: 1 }); await L.answer("gm", "direction", "go");
  eq([L.spot("N1"), fireDice(L)], ["z2:elevated", 1], "INT-10: from a level that does not burn into one that does: the first meeting with the fire attacks");
}
/* ================================================================== A11 + P7-1 + SWEEP-R7: what is pushed */
{
  const T = new MTable(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.put("H1", "z1").put("N1", "z2:elevated"); T.order(["H1", "N1"]); T.dice.push([3]);
  await T.gm({ op: "fall", combatant: "N1" });
  eq(T.lastRequest()?.maxPush, 0, "A11: a fall's AGILITY roll is still not pushed");
  const src = (await import("node:fs")).readFileSync(new URL("./flows/chase.mjs", import.meta.url), "utf8");
  ok(/sideRoll\(v, I, R, key, u, r\.attr, \{ mods \}\)/.test(src) && !/sideRoll\(v, I, R, key, u, r\.attr, \{ passive: true/.test(src), "P7-1: the obstacle roll of a chase is no passive roll any more (pushed under the roller's push rule)");
  const hz = (await import("node:fs")).readFileSync(new URL("./flows/hazards.mjs", import.meta.url), "utf8");
  ok(/rollEffect\("roll", t, "strength", bp\.pool, \{ passive: true, label: "ITAC\.roll\.vacuum" \}\)/.test(hz), "A11: the vacuum's STRENGTH roll stays passive (not pushed)");
}
/* ================================================================== A41: every stunt on the extra opponent */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Eve" }).npc("N1", { name: "Doc", health: 9 }).npc("N2", { name: "Thug", health: 9 }); T.order(["H1", "N1", "N2"]);
  eq(code(await T.req("p1", decl("H1", "slugfest", ["N1"]))), "ok", "A41: (Eve hits Doc)");
  await passAll(T); await T.roll("attack", 4);
  const ids = (T.prompt("stunts")?.options ?? []).map((o) => o.id);
  ok(ids.includes("bangHeads@N1|N2") && ids.includes("disarm@N2") && ids.includes("special@N2") && ids.includes("own@N2"), "A41: Disarm, a special and an own stunt are offered on the extra opponent");
  ok(!ids.includes("bangHeads@N2") && !ids.some((x) => x.startsWith("bangHeads@N2|")), "A41: a further Bang Heads is no chain of the extra opponent's own");
  const p = T.prompt("stunts");
  const r = await T.req("p1", { op: "answer", prompt: p.id, value: ["bangHeads@N1|N2", "disarm@N2", "stun@N2"] });
  eq(code(r), "ok", "A41: Bang Heads plus Disarm and Stun on the extra opponent, from the same pool, is a legal answer");
}
/* ================================================================== A25 + P8b-R5: the STUN effect of a weapon */
{
  const taser = () => { const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.weapons.taser = { id: "taser", name: "Taser", bonus: 1, damage: 2, range: [0, 0], stunEffect: true }; T.order(["H1", "N1"]); return T; };
  const T = taser();
  eq(code(await T.req("p1", decl("H1", "shoot", ["N1"], { weapon: "taser" }))), "ok", "A25: (a Taser shot)");
  await passAll(T); await T.roll("attack", 1);
  const r = req(T, "stun:N1");
  eq([r?.who ?? r?.actorUuid?.split(".").pop(), r?.attr, r?.maxPush], ["N1", "presence", 0], "A25: a hit with damage: the target rolls PRESENCE (no action, not pushed) without a six bought for it");
  await T.roll("stun:N1", 0);
  eq([st(T, "N1").includes("stunned"), !!T.state.ledger.N1.lostTurn], [true, true], "A25: failed: stunned, the next turn is lost");
  const S = taser(); await S.req("p1", decl("H1", "shoot", ["N1"], { weapon: "taser" })); await passAll(S); await S.roll("attack", 1); await S.roll("stun:N1", 1);
  eq([st(S, "N1").includes("stunned"), !!S.state.ledger.N1.lostTurn], [false, false], "A25: a six: nothing");
  const H = taser(); H.c.N1.huge = true; await H.req("p1", decl("H1", "shoot", ["N1"], { weapon: "taser" })); await passAll(H); await H.roll("attack", 1);
  eq(req(H, "stun:N1"), null, "A25: not against a huge creature (as the Stun stunt)");
  const G = taser(); G.weapons.gun = { id: "gun", bonus: 0, damage: 3, range: [0, 3] }; await G.req("p1", decl("H1", "shoot", ["N1"], { weapon: "gun" })); await passAll(G); await G.roll("attack", 1);
  eq(req(G, "stun:N1"), null, "A25: an ordinary gun stuns nobody");
  eq([t("ITAC.stunt.stunEffect"), tIn("en", "ITAC.stunt.stunEffect")], ["Efekt ogłuszenia", "STUN effect"], "A25: the roll is named in both languages");
}
/* ================================================================== CI1 + P8d-3 + M2 + P8d-R10: the cost of a move let through */
{
  const base = () => { const T = new MTable(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.put("H1", "z1").put("N1", "z5"); T.order(["H1", "N1"]); return T; };
  const T = base();
  const d = await T.req("p1", { op: "declare", actor: "H1", decl: { action: "move", to: "z4", exception: { text: "I climb over" } } });
  eq([code(d), T.prompt("exception")?.to, entries(T, "H1").length], ["ok", "gm", 0], "CI1: (a refused move asked as an exception: nothing paid while the GM decides)");
  await T.answer("gm", "exception", "grant");
  eq([T.top()?.status, entries(T, "H1").map((e) => e.cost ?? e.unit ?? e.kind)], ["manual", ["quick"]], "CI1: granted: the move costs a move action (quick), the GM moves the token by hand");
  ok(P1.budget(T.state, "H1").quick.includes("used"), "CI1: the quick action is spent");
  const G = base();
  eq(code(await G.gm({ op: "move", actor: "H1", to: "z4", gm: true, decl: { exception: { text: "GM" } } })), "ok", "CI1: (the GM's own 'move anyway, without cost')");
  eq([G.top()?.status, entries(G, "H1").filter((e) => e.cost && e.cost !== "none").length, P1.budget(G.state, "H1").quick.includes("used")], ["manual", 0, false], "CI1: the GM's own 'without cost' stays free");
}
/* ================================================================== P5-2 + P5-R6: the vacuum exposure counts from each entering */
{
  const key = M.counterKey.scene("H1", "vacuum");
  const v = (from, now, n) => ({ state: { counters: { [key]: n } }, facts: { zones: { zone: (k) => ({ key: k, tags: k === "z9" ? ["vacuum"] : [] }), place: () => (now.startsWith("@") ? { spot: now, area: now.slice(1) } : { spot: now, zone: now.split(":")[0] }) } } });
  eq(K.vacuumEntered(v("z1", "z9", 2), ["H1"], "z1"), [{ t: "state", path: ["counters", key], to: null }], "P5-2: into a vacuum zone from a zone at pressure: the exposure starts again");
  eq(K.vacuumEntered(v("z1", "@orbit", 3), ["H1"], "z1:elevated"), [{ t: "state", path: ["counters", key], to: null }], "P5-2: into orbit: the same");
  eq(K.vacuumEntered(v("z9", "z9:elevated", 2), ["H1"], "z9"), [], "P5-2: moving inside the vacuum is no new entering");
  eq(K.vacuumEntered(v("z1", "z2", 2), ["H1"], "z1"), [], "P5-2: not into the vacuum: nothing");
  /* through the move flow on the fake map: z2 tagged vacuum */
  const T = new MTable(); const z = T.map.zone; T.map.zone = (k) => { const r = z(k); return r ? { ...r, tags: k === "z2" ? ["vacuum"] : [] } : r; };
  T.hero("H1", "p1").npc("N1", { health: 6 }); T.put("H1", "z1").put("N1", "z4"); T.order(["H1", "N1"]);
  T.state.counters = { ...(T.state.counters ?? {}), [key]: 2 };
  eq((await T.req("p1", { op: "move", actor: "H1", to: "z2" })).ok, true, "P5-2: (a move into the vacuum zone)");
  eq([T.spot("H1"), M.counterGet(T.state, key)], ["z2", 0], "P5-2: arrived in the vacuum: the count starts again (the next roll is unmodified)");
}
/* ================================================================== P5-6 + P5-R8: Save Bystanders needs the body */
{
  const held = (s) => { const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 6 }); T.order(["H1", "N1"]); T.state.statuses = { H1: [s] }; return T; };
  for (const [s, label] of [[{ id: "grappled", data: { by: "N1" } }, "held"], [{ id: "snared", data: { dice: -2 } }, "snared"], [{ id: "immobilised", data: {} }, "immobilised"]]) {
    const T = held(s);
    eq(why(await T.req("p1", decl("H1", "saveBystanders", [], { attr: "agility" }))), "restrained", `P5-6: a ${label} character cannot save bystanders`);
  }
  const T = held({ id: "grappled", data: { by: "N1" } });
  eq(code(await T.req("p1", decl("H1", "usePower", [], { attr: "presence", text: "I shout" }))), "ok", "P5-6: Use Power stays allowed (the GM refuses a power that needs movement)");
  const I = held({ id: "intangible" });
  eq(code(await I.req("p1", decl("H1", "saveBystanders", [], { attr: "agility" }))), "ok", "P5-6: no restraint: Save Bystanders as before");
  const B = held({ id: "grappled", data: { by: "N1" } });
  const view = V.viewFor(B.state, { id: "p1", staff: false, owns: ["H1"] }, { hidden: [], npc: ["N1"] });
  const bar = D.playerModel(view, { id: "p1", owns: ["H1"] }, { c: (id) => B.c[id] ?? null, online: () => true, P1 });
  eq(bar.bars?.H1?.actions?.find?.((a) => a.id === "saveBystanders")?.disabled ?? bar.actions?.find?.((a) => a.id === "saveBystanders")?.disabled ?? JSON.stringify(bar).match(/"saveBystanders"[^}]*"disabled":"(\w+)"/)?.[1], "restrained", "P5-6: the dock greys Save Bystanders with the reason");
}
/* ================================================================== P7-5: the toxin reaches a hero who joined later */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 });
  T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 3, maxResolve: 3, name: "Spill" });
  T.order(["H1", "H2", "N1"]);
  T.c.H2.defeated = true;                                             // not in the fight yet when the GM sets the challenge up
  eq(code(await T.gm({ op: "challengeSetup", challenge: "CH", preset: "toxicAccident" })), "ok", "P7-5: (a Toxic Accident set up)");
  T.c.H2.defeated = false;
  eq(T.state.triggers.filter((g) => g.run?.kind === "toxin").map((g) => g.subject.combatant), ["H1"], "P7-5: (the set-up names the heroes who were there)");
  const facts = T.facts();
  const late = Hz.derived(T.state, facts, { at: "turnStart", combatant: "H2" }), early = Hz.derived(T.state, facts, { at: "turnStart", combatant: "H1" }), npc = Hz.derived(T.state, facts, { at: "turnStart", combatant: "N1" });
  eq(late.map((g) => [g.run.type, g.run.kind, g.run.challenge, g.subject.combatant, g.source.kind]), [["challengeRoll", "toxin", "CH", "H2", "challenge"]], "P7-5: the hero who joined later: the toxin is due at the start of its turn");
  eq([early.length, npc.length], [0, 0], "P7-5: no double for a hero the set-up named; nothing for an NPC");
  T.state.challenges.CH.done = 1;
  eq(Hz.derived(T.state, T.facts(), { at: "turnStart", combatant: "H2" }).length, 0, "P7-5: an overcome challenge poisons nobody");
  T.state.challenges.CH.done = undefined;
  /* the queue card runs it like the set-up's own trigger */
  const g = late[0], inst = Challenge.effectChild("H2", g.run, { id: g.id, at: g.at });
  eq([typeof inst.flow, inst.decl.targets, inst.actor ?? "H2"], ["string", ["H2"], "H2"], "P7-5: (the same child the set-up's trigger makes)");
}
/* ================================================================== P7-12: powers by the compendium identifier */
{
  const src = (id) => ({ compendiumSource: `Compendium.invincible-core.powers.Item.${id}` });
  eq(Sys.powerKey({ type: "power", name: "Wiązka", _stats: src("KO7XdrommpRV6dU6") }), "Blast", "P7-12: a renamed (Polish) Blast dragged from the compendium is Blast");
  eq(Sys.powerKey({ type: "power", name: "Mój", id: "KO7XdrommpRV6dU6" }), "Blast", "P7-12: an imported pregenerated character keeps the id as its own");
  eq([Sys.powerKey({ type: "power", name: "Blast" }), Sys.powerKey({ type: "talent", name: "x", _stats: src("KO7XdrommpRV6dU6") })], [null, null], "P7-12: no identifier, or not a power: none");
  const T = new Table(); T.hero("H1", "p1", { powers: ["Wiązka"] }).hero("H2", "p2", { powers: ["Wiązka"] }).npc("N1", { health: 6 });
  T.c.H1.powerKeys = ["Blast"];
  T.add("CH", { kind: "challenge", npc: true, health: 6, resolve: 3, maxResolve: 3, name: "Device" });
  T.order(["H1", "H2", "N1"]).turn("H1");
  await T.gm({ op: "challengeSetup", challenge: "CH", preset: "doomsdayDevice" });
  eq(code(await T.req("p1", decl("H1", "objective", ["CH"], { mode: "shortOutTheConsole.0" }))), "ok", "P7-12: (an option that names Blast)");
  eq([T.prompt("objective"), T.top()?.step], [null, "roll"], "P7-12: the power found by its identifier under a Polish name: no GM card");
  await T.roll("roll", 0);
  await T.req("p1", { op: "endTurn", actor: "H1", round: T.state.round, slot: T.state.init.cur }); T.turn("H2");
  await T.req("p2", decl("H2", "objective", ["CH"], { mode: "shortOutTheConsole.0" }));
  eq(T.prompt("objective")?.data?.why, "power", "P7-12: a Polish name with no identifier: the GM's card, as before");
}
/* ================================================================== P6-5: Luck Control on the roll of the interrupted action */
{
  const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: null, boosts: [], autos: [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const T = new Table(); T.hero("H1", "p1").npc("N1", { health: 9 }).npc("N2", { health: 9 }); T.order(["N1", "H1", "N2"]).turn("N1");
  T.c.H1.kit = KP.build({ items: [item("lu", "Luck Control", "power", { level: "basic" })], attrs: T.c.H1.attrs }); T.c.H1.pass = T.c.H1.kit.pass;
  const luck = T.c.H1.kit.actions.find((a) => a.id.endsWith("-luck"));
  eq(code(await T.gm(decl("N1", "slugfest", ["H1"]))), "ok", "P6-5: (Doc attacks Eve)");
  const r = await T.req("p1", decl("H1", luck.id, ["N1"], { opt: "bad" }));
  eq(code(r), "ok", "P6-5: (Eve answers with Luck Control as an interrupt, bad luck on Doc)");
  for (let i = 0; i < 4 && T.top()?.actor === "H1"; i++) { const p = T.prompts().find((x) => x.about === "H1" || x.to === "gm"); if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.options?.[0]?.id ?? "pass" }); }
  const tk = T.state.tokens.find((x) => x.holder === "N1");
  const atk = T.state.stack.find((x) => x.actor === "N1");
  eq([tk?.dice, tk?.scope?.inst, atk?.id != null && tk?.scope?.inst === atk?.id], [-1, atk?.id, true], "P6-5: the die is bound to the attack it interrupted");
  eq([M.tokensFor(T.state, "N1", { kind: "attack", attr: "fighting", inst: atk.id }).length, M.tokensFor(T.state, "N1", { kind: "attack", attr: "fighting", inst: "other" }).length], [1, 0], "P6-5: it counts on that action's rolls only");
  await passAll(T);
  const ar = T.requests.filter((x) => x.key === "attack").pop();
  ok(ar?.pool?.mods?.some((m) => String(m.source).startsWith("token:") && m.dice === -1), "P6-5: Doc's attack roll carries the bad-luck die");
  await T.roll("attack", 0);
  for (let i = 0; i < 6 && T.state.stack.length; i++) { const p = T.prompts()[0]; if (!p) break; await T.gm({ op: "answerFor", prompt: p.id, value: p.options?.[0]?.id ?? "pass" }); }
  eq(T.state.tokens.filter((x) => x.holder === "N1").length, 0, "P6-5: the action over, the die is gone (not kept for a later roll this round)");
  /* used on one's own turn (no action interrupted): the next roll of the round, as before */
  const U = new Table(); U.hero("H1", "p1").npc("N1", { health: 9 }); U.order(["H1", "N1"]);
  U.c.H1.kit = T.c.H1.kit; U.c.H1.pass = T.c.H1.pass;
  await U.req("p1", decl("H1", luck.id, ["N1"], { opt: "bad" }));
  const u = U.state.tokens.find((x) => x.holder === "N1");
  eq([u?.dice, u?.scope?.inst ?? null, u?.expires?.at], [-1, null, "roundEnd"], "P6-5: not an interrupt: the next roll until the round ends, as before");
}

done("check-ansf");
