/* node scripts/tactics/check-fxg2.mjs -- FXG2: bug hunt 6 (dev/combat-defects.md, D207-D209), its class and its suspicion.
   Fights run through the REAL director, engine and round driver (testkit Table). Every check here failed on tactics-integrated-85.
     D207  a grapple / carry pair ends for the one left behind when the other leaves the fight (GM deletes it, a chase ends "escaped");
           the undo of the chase's end brings the pair back
     D208  [B1671] the quaker is never a target of its own Earthquake (ruling FXG2-R1; A40 still holds for other area attacks)
     D209  allies of one who left: the GM-marked / controlled get a card of their own and act (FXG2-2); the engine's summoned leave
     class what else is keyed to a leaver ends with it (effects it holds, its ice barrier, tokens it holds, bonus actions "on its turn");
           the engine's own leave of summoned allies is journaled with what the roster prunes, so its undo brings that back
     S1    the GM's step back passes over a lost turn (it is not reopened as a whole turn; FXG2-3) */
import { Table, ok, eq, done } from "./testkit.mjs";
import * as M from "./mods-pure.mjs";
import * as O from "./ops-pure.mjs";
import * as K from "./kit-pure.mjs";
import * as Lg from "./ledger-pure.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const st = (T, id) => M.statusesOf(T.state, id).map((s) => s.id);
const cardOf = (T, id) => !!T.state.init.slots.find((s) => s.members.includes(id));
const next = (T) => { const r = O.reduce(T.state, { type: "nextTurn" }, { user: "gm", staff: true, owns: () => true, parts: T.parts(), rng: T.rng }); if (r.ok) T.state = r.state; return r.ok; };
async function leave(T, id, mode, pursuer) {
  if (mode === "escaped") { await T.gm({ op: "chaseStart", prey: [id], pursuer: [pursuer], distance: 4 }); eq(code(await T.gm({ op: "chaseEnd", outcome: "escaped" })), "ok", `(${id} escapes)`); }
  else { delete T.c[id]; await T.gm({ op: "roster" }); }
}

/* ================================================================== D207: the pair ends when one side leaves */
for (const mode of ["deleted", "escaped"]) for (const side of ["holds", "held"]) {
  const T = new Table();
  T.hero("H1", "p1").npc("N1").npc("N2");
  T.order(["H1", "N2", "N1"]).turn("H1");
  const [a, b] = side === "holds" ? ["H1", "N1"] : ["N1", "H1"];
  await T.gm({ op: "statusAdd", combatant: a, status: { id: "grappling", data: { held: b } } });
  await T.gm({ op: "statusAdd", combatant: b, status: { id: "grappled", data: { by: a } } });
  await leave(T, "N1", mode, "N2");
  if (T.state.init.curMember !== "H1") T.turn("H1");
  eq([!!T.state.ledger.N1, st(T, "H1")], [false, []], `D207 ${mode}/${side}: N1 left; H1 neither grappling nor grappled`);
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N2"] } })), "ok", `D207 ${mode}/${side}: H1 may attack somebody else`);
  ok(T.evs("status").some((e) => e.target === "H1" && e.status?.on === false && e.cause === "left"), `D207 ${mode}/${side}: the end is told`);
}
/* the undo of the chase's end brings the pair back (one journal entry) */
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1").npc("N2");
  T.order(["H1", "N2", "N1"]).turn("H1");
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "grappling", data: { held: "H1" } } });
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "grappled", data: { by: "N1" } } });
  await leave(T, "N1", "escaped", "N2");
  eq(st(T, "H1"), [], "D207 undo: (the pair ended with the escape)");
  const end = [...T.log.list].reverse().find((x) => x.state !== "undone" && x.ops.some((o) => o.t === "summon-"));
  eq(code(await T.gm({ op: "undo", tx: end?.id })), "ok", "D207 undo: the chase's end is undone");
  eq([!!T.c.N1, st(T, "H1"), st(T, "N1")], [true, ["grappled"], ["grappling"]], "D207 undo: N1 is back and the pair with it");
}
/* a carry: the carried one left behind loses the carry and the air mark the carry gave; a flyer's own air mark stays */
{
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2").npc("N1").npc("N2");
  T.order(["H1", "H2", "N2", "N1"]).turn("H1");
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "carrying", data: { held: "H1" } } });
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "carried", data: { by: "N1" } } });
  await T.gm({ op: "statusAdd", combatant: "H1", status: { id: "airborne", source: { kind: "action", name: "carry" } } });
  await T.gm({ op: "statusAdd", combatant: "N2", status: { id: "carrying", data: { held: "H2" } } });
  await T.gm({ op: "statusAdd", combatant: "N2", status: { id: "airborne", source: { kind: "power", name: "Flight" } } });
  await T.gm({ op: "statusAdd", combatant: "H2", status: { id: "carried", data: { by: "N2" } } });
  delete T.c.N1; delete T.c.H2; await T.gm({ op: "roster" });
  eq([st(T, "H1"), st(T, "N2")], [[], ["airborne"]], "D207 carry: the carried one left behind is set down; the carrier left behind keeps its own flight");
}

/* ================================================================== D208: the quaker is not hit by its own quake [B1671] */
{
  const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: 0, stress: 0, damage: o.damage ?? 0, min: 0, max: 0, bypass: false });
  const item = (id, name, type, o = {}) => ({ id, name, type, level: null, power: null, boosts: [], autos: o.autos ?? [], fx: [], flags: { kit: null, off: false, types: [] }, wf: {} });
  const LV = ["Basic", "Major", "Massive", "Monstrous"];
  const eqk = (lv) => [item("eq", "Earthquake", "power", { autos: LV.map((w, i) => auto(`Eq${i}`, `Earthquake - ${w}`, "rollAttack", { attr: ["might"], damage: 3 + i, show: i === lv })) })];
  class FT extends Table {
    give(cid, items) { const c = this.c[cid]; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; return this; }
    facts() { const f = super.facts(), T = this; const place = (cid) => (T.c[cid] ? { zone: T.c[cid].zone, level: "ground", spot: T.c[cid].zone, area: null } : null);
      return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? f.weapon(cid, ref) : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)),
        zones: { place, reach: () => [], zone: (key) => ({ key, tags: [] }), states: () => [], graph: () => ({ zones: ["z1", "z2"].map((id) => ({ id, flammable: false, tags: [] })), borders: [] }) } }; }
  }
  for (const lv of [0, 1]) {
    const T = new FT();
    T.hero("H1", "p1", { zone: "z1", health: 6 }).npc("N1", { health: 6, zone: "z1" }).npc("N2", { zone: "z2" });
    T.give("H1", eqk(lv)).give("N1", []).give("N2", []); T.terrain = { z1: "street" };
    T.order(["H1", "N1", "N2"]).turn("H1");
    eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "shoot", targets: ["N1"], weapon: `eq~Eq${lv}` } })), "ok", `D208 ${LV[lv]}: (the quake is declared)`);
    eq(T.top()?.decl?.targets, ["N1"], `D208 ${LV[lv]}: the quaker is not a target of its own quake`);
    const rolled = new Set();
    for (let i = 0; i < 16; i++) {
      const inst = T.top(); const r = inst && Object.keys(inst.rolls ?? {}).find((k) => !rolled.has(`${inst.id}:${k}`) && inst.rolls[k].sixes == null);
      if (r) { rolled.add(`${inst.id}:${r}`); await T.roll(r, r === "attack" ? 2 : 0); continue; }
      const p = T.prompts()[0]; if (!p) break;
      await T.gm({ op: "answerFor", prompt: p.id, value: p.kind === "stunts" ? [] : p.options?.find((o) => o.id === "pass")?.id ?? p.options?.find((o) => /armor|noDodge|take/i.test(o.id))?.id ?? p.options?.[0]?.id });
    }
    eq([T.c.H1.health, T.c.N1.health < 6, !!T.zoneMarks.z1?.wrecked], [6, true, true], `D208 ${LV[lv]}: the quaker keeps its Health, the other is hit, the zone is wrecked`);
  }
}

/* ================================================================== D209: allies of one who left */
for (const mode of ["deleted", "escaped"]) {
  const T = new Table();
  T.hero("H1", "p1").npc("N1", { name: "Boss" }).npc("N2"); T.order(["H1", "N1", "N2"]).turn("H1");
  T.npc("S1", { name: "Hounds", kind: "minions", summonOf: "N1" }); await T.gm({ op: "roster" });
  eq(cardOf(T, "S1"), false, `D209 ${mode}: (the hounds act on the boss's turn, no card)`);
  await leave(T, "N1", mode, "H1");
  eq([!!T.c.S1, cardOf(T, "S1"), T.state.summons ?? []], [true, true, []], `D209 ${mode}: the boss gone, the hounds hold a card of their own`);
  const turns = new Set();
  for (let i = 0; i < 10; i++) { if (!next(T)) break; if (T.state.init.curMember) turns.add(T.state.init.curMember); }
  ok(turns.has("S1"), `D209 ${mode}: the hounds get turns (${[...turns].join(",")})`);
}
/* the undo of the escape: the hounds are the boss's again (the card goes back) */
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1").npc("N2"); T.order(["H1", "N1", "N2"]).turn("H1");
  T.npc("S1", { kind: "minions", summonOf: "N1" }); await T.gm({ op: "roster" });
  await leave(T, "N1", "escaped", "H1");
  eq(cardOf(T, "S1"), true, "D209 undo: (a card of their own)");
  const end = [...T.log.list].reverse().find((x) => x.state !== "undone" && x.ops.some((o) => o.t === "summon-"));
  await T.gm({ op: "undo", tx: end?.id });
  await T.gm({ op: "roster" });
  eq([!!T.c.N1, cardOf(T, "S1"), (T.state.summons ?? []).map((s) => [s.owner, s.combatants])], [true, false, [["N1", ["S1"]]]], "D209 undo: the boss is back and the hounds act on its turn again");
}
/* the engine's own summoned allies leave with their owner [B1812] */
for (const mode of ["deleted", "escaped"]) {
  const T = new Table();
  T.hero("H1", "p1").npc("N1").npc("N2"); T.order(["H1", "N1", "N2"]).turn("H1");
  T.npc("S1", { kind: "minions", summonOf: "N1" }); T.c.S1.summon = { kind: "summon", auto: 1 }; await T.gm({ op: "roster" });
  await leave(T, "N1", mode, "H1");
  if (mode === "deleted") await T.gm({ op: "roster" });
  eq([!!T.c.S1, cardOf(T, "S1"), T.evs("draw").some((e) => e.members?.includes("S1"))], [false, false, false], `D209 ${mode}: summoned allies leave with their owner (never dealt a card)`);
}

/* ================================================================== the class: more keyed to a leaver */
{
  const T = new Table();
  T.hero("H1", "p1").hero("H2", "p2").npc("N1").npc("N2"); T.order(["H1", "H2", "N1", "N2"]).turn("H1");
  await T.gm({ op: "effectAdd", effect: { id: "fA", kind: "copies", holder: "N1", source: { kind: "power", name: "Duplication" }, data: { n: 3 }, ends: { at: "sceneEnd" } } });
  await T.gm({ op: "effectAdd", effect: { id: "fB", kind: "barrier", holder: "H2", source: { kind: "power", name: "Cold Control" }, data: { armor: 3, by: "N1", zone: "z1" }, ends: { at: "breached" } } });
  await T.gm({ op: "effectAdd", effect: { id: "fC", kind: "barrier", holder: "H2", source: { kind: "power", name: "Barrier" }, data: { armor: 3, by: "N1" }, ends: { at: "breached" } } });
  await T.gm({ op: "tokenAdd", token: { id: "kA", holder: "N1", dice: 2, scope: { rolls: ["attack"] }, uses: "all", source: { kind: "power", name: "Action Plan" }, expires: { at: "roundEnd" } } });
  await T.gm({ op: "ledgerEdit", combatant: "H2", edit: "grant", grant: { kind: "gm", unit: "quick", window: "turnOf:N1", expires: "turnEnd" } });
  ok(Lg.budget(T.state.ledger.H2).grants.some((g) => g.window === "turnOf:N1"), "class: (H2 holds a quick action for N1's turn)");
  delete T.c.N1; await T.gm({ op: "roster" });
  eq((T.state.effects ?? []).map((e) => e.id), ["fC"], "class: N1's own effect and the ice barrier it made end; a plain Barrier it raised for H2 stays (the scene)");
  eq((T.state.tokens ?? []).filter((t) => t.holder === "N1").length, 0, "class: tokens N1 held go");
  ok(!Lg.budget(T.state.ledger.H2).grants.some((g) => g.window === "turnOf:N1"), "class: the quick action for N1's turn (which never comes) goes");
}
/* the engine's leave of summoned allies writes what the roster prunes into its own entry: the undo restores a grapple with them */
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1").npc("N2"); T.order(["H1", "N1", "N2"]).turn("H1");
  T.hero("S1", "p1", { kind: "minions", summonOf: "H1", health: 3 }); T.c.S1.summon = { kind: "summon", auto: 1 }; await T.gm({ op: "roster" });
  await T.gm({ op: "statusAdd", combatant: "S1", status: { id: "grappling", data: { held: "N1" } } });
  await T.gm({ op: "statusAdd", combatant: "N1", status: { id: "grappled", data: { by: "S1" } } });
  await T.gm({ op: "setHealth", combatant: "H1", value: 0 });
  eq([!!T.c.S1, st(T, "N1")], [false, []], "class: the summoner broken, its allies leave [B1812]; the one they held is free");
  const tx = [...T.log.list].reverse().find((x) => x.state !== "undone" && x.ops.some((o) => o.t === "summon-"));
  ok(!!tx && tx.ops.some((o) => o.t === "state"), "class: the leave's entry holds what was pruned");
  await T.gm({ op: "undo", tx: tx?.id });
  eq([!!T.c.S1, st(T, "N1"), st(T, "S1")], [true, ["grappled"], ["grappling"]], "class: the undo of the leave brings the grapple back");
}

/* ================================================================== S1: the step back passes over a lost turn */
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1").npc("N2");
  T.order(["N1", "H1", "N2"]).turn("N1");
  await T.gm({ op: "ledgerEdit", combatant: "H1", edit: "loseTurn" });
  await T.gm({ op: "nextTurn" });
  eq(T.state.init.curMember, "N2", "S1: (H1's turn was lost and went by)");
  eq(code(await T.gm({ op: "prevTurn" })), "ok", "S1: the GM steps back");
  eq([T.state.init.curMember, T.state.init.slots.find((s) => s.members.includes("H1"))?.state], ["N1", "lost"], "S1: the step goes to N1; H1's lost turn stays lost");
  eq(code(await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["N1"] } })), "notYourTurn", "S1: H1 gets no whole turn out of its lost one");
  await T.gm({ op: "nextTurn" });
  eq(T.state.init.curMember, "N2", "S1: N1 ends, N2 again (the lost turn is not opened anew)");
}
{
  const T = new Table();
  T.hero("H1", "p1").npc("N1");
  T.order(["H1", "N1"]).turn("H1");
  await T.gm({ op: "nextTurn" });          // H1 passes; N1's turn
  await T.gm({ op: "ledgerEdit", combatant: "H1", edit: "loseTurn" });
  for (let i = 0; i < 6 && T.state.round < 2; i++) await T.gm({ op: "nextTurn" });
  eq([T.state.round, T.state.init.curMember], [2, "N1"], "S1: (round 2: H1's turn was lost, N1 has the turn)");
  eq(code(await T.gm({ op: "prevTurn" })), "noPrev", "S1: only a lost turn behind: no step back (nothing changes)");
}

done("check-fxg2");
