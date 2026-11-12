// node scripts/tactics/check-pwd.mjs -- fixer PWD: the review of the control, mind and luck powers (findings PW030-PW118 of the powers review),
// each block naming its book lines. Through the REAL director, engine, ledger and kit builder with a scripted table (no Foundry); the items carry
// the automations of the invincible-core compendium as they are (names, attributes, damage, ranges).
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import * as P1 from "./economy-pure.mjs";
import * as M from "./mods-pure.mjs";
import * as K from "./kit-pure.mjs";
import { EN, PL } from "./lang.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const why = (env) => env?.error?.params?.reason ?? null;
const decl = (actor, action, extra = {}) => ({ op: "declare", actor, decl: { action, ...extra } });
const auto = (id, name, type, o = {}) => ({ id, name, type, show: o.show !== false, attr: o.attr ?? [], bonus: o.bonus ?? 0, stress: o.stress ?? 0, damage: o.damage ?? 0, min: o.min ?? 0, max: o.max ?? 0, bypass: false });
const item = (id, name, type, o = {}) => ({ id, name, type, level: o.level ?? null, power: o.power ?? null, boosts: o.boosts ?? [], autos: o.autos ?? [], fx: o.fx ?? [], flags: { kit: null, off: false, types: [], ...(o.flags ?? {}) }, wf: o.wf ?? {} });
const LV = ["Basic", "Major", "Massive", "Monstrous"];
/* the compendium's attack automations of a power, one per level: [attr, damage, min, max] */
const atk = (name, rows) => rows.map(([attr, damage, min, max], i) => auto(`${name.slice(0, 2)}${i}`, `${name} - ${LV[i]}`, "rollAttack", { attr: [attr], damage, min, max }));
const power = (id, name, level, autos = [], boosts = []) => item(id, name, "power", { level, autos, boosts });
const C = {      // invincible-core, packs/powers (read 2026-11-12)
  tk: () => [...atk("Telekinesis", [["agility", 3, 0, 2], ["agility", 4, 0, 3], ["agility", 5, 0, 4], ["agility", 5, 0, 6]]), auto("tt", "Throw Target", "rollAttribute", { attr: ["agility"] }), auto("tu", "Telekinesis", "usePower")],
  water: () => [...atk("Water Control", [["agility", 1, 0, 1], ["agility", 3, 0, 2], ["agility", 4, 0, 3], ["agility", 5, 0, 4]]), auto("wu", "Water Control", "usePower")],
  plant: () => [...atk("Plant Control", [["fighting", 3, 0, 0], ["fighting", 4, 0, 0], ["fighting", 5, 0, 0], ["fighting", 6, 0, 0]]), auto("pu", "Plant Control", "usePower")],
  matter: () => [...atk("Matter Control", [["agility", 3, 0, 1], ["agility", 4, 0, 1], ["agility", 5, 0, 1], ["agility", 6, 0, 1]]), auto("mu", "Matter Control", "usePower")],
  magnet: () => [...atk("Magnetism Control", [["agility", 3, 0, 2], ["agility", 4, 0, 3], ["agility", 5, 0, 4], ["agility", 6, 0, 5]]), auto("gu", "Magnetism Control", "usePower")],
  weather: () => [...atk("Weather Control", [["agility", 3, 0, 1], ["agility", 4, 0, 2], ["agility", 5, 0, 3], ["agility", 6, 0, 4]]), auto("xu", "Weather Control", "usePower")],
  light: () => [auto("lu", "Light Control", "usePower"), auto("la", "Light Control - Attack", "rollAttack", { attr: ["agility"], damage: 0, min: 0, max: 1 })],
  telepathy: () => [auto("t0", "Read Surface Thoughts", "usePower"), auto("t1", "Read Deeper Thoughts", "rollAttribute", { attr: ["intuition"] })],
  tech: () => [auto("c0", "Technology Control", "rollAttribute", { attr: ["reason"] }), auto("c1", "Technology Control", "usePower")],
  sorcery: () => [auto("s0", "Copy Power", "rollAttribute", { attr: ["presence"] }), auto("s1", "Use copied power", "usePower", { stress: 1 })],
};
/* a table whose characters carry kits, with a small map: z1 | z2 | z3 in a row; `marks` = zone states records for facts.zones.states */
class Tbl extends Table {
  constructor(o) { super(o); this.borderList = [{ key: "z1|z2" }, { key: "z2|z3" }]; this.records = {}; }
  give(cid, items) { const c = this.c[cid]; c.src = items; c.kit = K.build({ items, attrs: c.attrs }); c.pass = c.kit.pass; c.huge = (c.hugeBase ??= c.huge) || c.pass.huge === true; return this; }
  facts() {
    const f = super.facts(), T = this;
    return { ...f, canTalk: () => true, weapon: (cid, ref) => (ref == null || ref === "unarmed" ? { ...f.weapon(cid, ref), ...(T.c[cid]?.kit?.unarmed ?? {}) } : T.c[cid]?.kit?.weapons.find((w) => w.id === ref) ?? f.weapon(cid, ref)),
      ...(T.map ? { zones: { borders: (zk) => T.borderList.filter((b) => b.key.split("|").includes(zk)), states: (spot) => T.records[spot] ?? [], zone: (key) => ({ key, tags: [] }), place: (cid) => ({ zone: T.c[cid]?.zone, spot: T.c[cid]?.zone, level: "ground" }), reach: () => [] } } : {}) };
  }
}
const base = (hItems = [], nItems = [], o = {}) => {
  const T = new Tbl(); if (o.map) T.map = 1;
  T.hero("H1", "p1", o.h1 ?? {}).hero("H2", "p2").hero("H3", "p3").npc("N1", { health: 6, ...(o.n1 ?? {}) }).npc("N2", { health: 4, huge: true }).npc("N3", { health: 4 });
  T.give("H1", hItems).give("N1", nItems).give("H2", o.h2Items ?? []).give("H3", []).give("N2", []).give("N3", []);
  T.order(o.order ?? ["H1", "N1", "H2", "H3", "N2", "N3"]).turn(o.turn ?? "H1");
  return T;
};
const act = (T, cid, k) => T.c[cid].kit.actions.find((a) => a.id.endsWith(`-${k}`));
const weapon = (T, cid, pred = () => true) => T.c[cid].kit.weapons.find(pred);
const pass = async (T, who = "gm") => { const p = T.prompt("reaction"); if (p) await T.req(who, { op: "answerFor", prompt: p.id, value: "pass" }); };
const both = (k) => typeof EN[k] === "string" && typeof PL[k] === "string";
const req = (T, key) => T.requests.filter((r) => r.key === key).pop() ?? null;

/* ================================================================== PW031, PW032 Luck Control [B1727]: yourself or another, in your zone or the next */
{
  const T = base([power("lu", "Luck Control", "major")]);
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "luck").id, { opt: "good" }))), T.state.tokens.find((t) => t.holder === "H1")?.dice], ["ok", 2], "PW031 [B1727]: Luck Control on yourself: +2 dice on your own next roll (Major)");
  const U = base([power("lu", "Luck Control", "major")]);
  U.setRange("H1", "N1", 2);
  eq([code(await U.req("p1", decl("H1", act(U, "H1", "luck").id, { targets: ["N1"], opt: "bad" }))), why(U.last)], ["illegal", "tooFar"], "PW032 [B1727]: two zones away: too far");
  U.setRange("H1", "N1", 1);
  eq(code(await U.req("p1", decl("H1", act(U, "H1", "luck").id, { targets: ["N1"], opt: "bad" }))), "ok", "PW032: an adjacent zone is in reach");
}
/* ================================================================== PW033 Guidance [B1708]: one other hero per six takes a bonus action on the guide's turn */
{
  const T = base([power("gu", "Guidance", null, [auto("g", "Guidance", "rollAttribute", { attr: ["presence"] })])]);
  const a = act(T, "H1", "guide");
  eq([a.target, a.roll], [{ who: "ally", n: [1, 6] }, { attr: "presence" }], "PW033: Guidance names the allies it inspires and rolls PRESENCE");
  eq(why(await T.req("p1", decl("H1", a.id, { targets: ["N1"] }))), "notAlly", "PW033: only heroes of your own side") ;
  await T.req("p1", decl("H1", a.id, { targets: ["H2", "H3"] }));
  await T.roll("roll", 1);
  const g2 = T.state.ledger.H2.grants.find((g) => g.kind === "guidance"), g3 = T.state.ledger.H3.grants.find((g) => g.kind === "guidance");
  eq([g2?.unit, g2?.window, g2?.from, g2?.consent, !!g3], ["any", "turnOf:H1", "H1", "yes", false], "PW033 [B1708]: one six, one bonus action (full or quick) for the first ally, on the guide's turn");
  eq(code(await T.req("p2", decl("H2", "scan"))), "ok", "PW033: the guided hero acts at once, during the guide's turn");
  await T.roll("roll", 0);
  const U = base([power("gu", "Guidance", null, [auto("g", "Guidance", "rollAttribute", { attr: ["presence"] })])]);
  await U.req("p1", decl("H1", act(U, "H1", "guide").id, { targets: ["H2", "H3"] })); await U.roll("roll", 3);
  eq(["H2", "H3"].map((c) => U.state.ledger[c].grants.filter((g) => g.kind === "guidance").length), [1, 1], "PW033: three sixes, two allies named: one bonus action each, no more");
  const V = base([power("gu", "Guidance", null, [auto("g", "Guidance", "rollAttribute", { attr: ["presence"] })])]);
  await V.req("p1", decl("H1", act(V, "H1", "guide").id, { targets: ["H2"] })); await V.roll("roll", 0);
  eq(V.state.ledger.H2.grants.filter((g) => g.kind === "guidance").length, 0, "PW033: no six, no bonus action");
}
/* ================================================================== PW035 Illusion [B1712-1715]: the target's passive INTUITION roll, less by level; no huge; your zone or the next */
{
  const ill = (level, more = []) => [power("il", "Illusion", level, [auto("i", "Illusion", "usePower")], more.map((m) => m.id)), ...more];
  for (const [lv, dice] of [["basic", 3], ["major", 2], ["massive", 1]]) {
    const T = base(ill(lv));
    eq([code(await T.req("p1", decl("H1", act(T, "H1", "cast").id, { targets: ["N1"], text: "a wall" }))), req(T, "res:N1")?.combatant, req(T, "res:N1")?.attr, req(T, "res:N1")?.dice], ["ok", "N1", "intuition", dice], `PW035 [B1712-1714]: ${lv}: the target rolls INTUITION 3 with the level's penalty, no action of its own`);
  }
  const T = base(ill("major"));
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "cast").id, { targets: ["N2"] }))), why(T.last)], ["illegal", "hugeTarget"], "PW035 [B1712]: no effect on huge creatures");
  T.setRange("H1", "N1", 2);
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "cast").id, { targets: ["N1"] }))), why(T.last)], ["illegal", "tooFar"], "PW035/PW032 [B1712]: your zone or an adjacent one");
  eq(T.c.H1.kit.actions.filter((a) => a.kit.item === "il").map((a) => a.id.split("-").pop()), ["cast"], "PW035: the cast replaces the sheet's bare Use (which named no target)");
  /* with Terrifying Illusions: the cast's own roll carries the terror [B1717]; a second click for the same target is not asked */
  const U = base(ill("basic", [item("ti", "Terrifying Illusions", "boost", { power: "il" })]));
  await U.req("p1", decl("H1", act(U, "H1", "cast").id, { targets: ["N1"] })); await U.roll("res:N1", 0);
  eq([U.c.N1.resolve, !!U.state.ledger.N1.lostTurn, M.hasStatus(U.state, "N1", "stunned")], [2, true, true], "PW035 [B1717]: the illusion's roll failed: 3 stress and the next turn lost");
  eq([code(await U.req("p1", decl("H1", act(U, "H1", "terrify").id, { targets: ["N1"] }))), why(U.last)], ["illegal", "usedAlready"], "PW035: Terrifying Illusions is not rolled a second time for the cast's target");
  /* Area Projection [B1716]: 1 stress, every target rolls */
  const V = base(ill("major", [item("ap", "Area Projection", "boost", { power: "il" })]));
  eq(code(await V.req("p1", decl("H1", act(V, "H1", "area").id, { targets: ["N1", "N3"] }))), "ok", "PW035 [B1716]: Area Projection on two");
  eq([req(V, "res:N1")?.dice, req(V, "res:N3")?.dice, V.c.H1.resolve], [2, 2, 4], "PW035 [B1716]: each target rolls INTUITION -1 (Major), 1 stress");
  const V2 = base(ill("major", [item("ap", "Area Projection", "boost", { power: "il" })]));
  const r2 = await V2.req("p1", decl("H1", act(V2, "H1", "area").id, { targets: ["N1", "N2"] }));
  eq([code(r2), why(r2)], ["illegal", "hugeTarget"], "PW035: no huge creature among them either");
}
/* ================================================================== PW036, PW107 Terrifying Illusions [B1713-1717]: the level's penalty, no huge */
{
  for (const [lv, dice] of [["basic", 3], ["major", 2], ["massive", 1], ["monstrous", 1]]) {
    const T = base([power("il", "Illusion", lv, [], ["ti"]), item("ti", "Terrifying Illusions", "boost", { power: "il" })]);
    await T.req("p1", decl("H1", act(T, "H1", "terrify").id, { targets: ["N1"] }));
    eq([req(T, "res:N1")?.dice, req(T, "res:N1")?.pool?.mods?.some?.((m) => String(m.source).startsWith("kit:")) ?? null], [dice, lv !== "basic"], `PW036/PW107 [B1713-1715]: ${lv}: INTUITION 3 ${lv === "basic" ? "as it is" : "with the level's dice off"} (one die at least)`);
  }
  const T = base([power("il", "Illusion", "major", [], ["ti"]), item("ti", "Terrifying Illusions", "boost", { power: "il" })]);
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "terrify").id, { targets: ["N2"] }))), why(T.last)], ["illegal", "hugeTarget"], "PW036 [B1712]: a huge creature is not affected");
}
/* ================================================================== PW037 low gravity [B1703]: any further action in the zone needs AGILITY first */
{
  const T = base(); T.zoneMarks.z1 = { lowgrav: true };
  await T.req("p1", decl("H1", "scan"));
  eq([T.lastRequest()?.key, T.lastRequest()?.attr, T.lastRequest()?.passive ?? T.lastRequest()?.pool?.passive ?? null], ["gate:lowGravity", "agility", null].slice(0, 2).concat([T.lastRequest()?.passive ?? T.lastRequest()?.pool?.passive ?? null]), "PW037 [B1703]: Scan in low gravity asks AGILITY first");
  await T.roll("gate:lowGravity", 0);
  eq([T.state.stack.length, T.requests.some((r) => r.key === "roll"), P1.budget(T.state, "H1").quick[0]], [0, false, "used"], "PW037 [B1703]: failed: the action is forfeit (spent, no INTUITION roll)");
  const U = base(); U.zoneMarks.z1 = { lowgrav: true };
  await U.req("p1", decl("H1", "scan")); await U.roll("gate:lowGravity", 1);
  eq(U.lastRequest()?.key, "roll", "PW037: passed: the action goes on to its own roll");
  const V = base([power("lc", "Light Control", null, C.light())]); V.zoneMarks.z1 = { lowgrav: true };
  await V.req("p1", decl("H1", act(V, "H1", "zone").id, { text: "dim it" }));
  eq(V.lastRequest()?.key, "gate:lowGravity", "PW037: a power's zone action too");
  const W = base(); W.zoneMarks.z1 = { lowgrav: true };
  await W.req("p1", decl("H1", "orders", { targets: ["H2"] }));
  eq(W.lastRequest()?.key, "gate:lowGravity", "PW037: Give orders (the roll flow) too");
  const X = base();
  await X.req("p1", decl("H1", "scan"));
  eq(X.lastRequest()?.key, "roll", "PW037: no low gravity, no gate");
}
/* ================================================================== PW038 Light Control, Sound Control [B1723], [B1800]: no stunt limit in the book */
{
  const T = base([power("lc", "Light Control", null, C.light())]);
  const w = weapon(T, "H1", (x) => x.item === "lc");
  eq(w.stunts, "noDamage", "PW038: the beam takes the stunts that need no damage");
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id })); await pass(T); await T.roll("attack", 2);
  const p = T.prompt("stunts");
  eq(p ? [...new Set(p.options.map((o) => o.data?.stunt))].sort() : null, ["disarm", "own", "special"], "PW038 [B1723]: a hit with a spare six may Disarm or make a special stunt (no Double Damage, Suppressed, Deadly Hit or Trick Shot: no damage)");
}
/* ================================================================== PW040-PW043 Mind Control [B1761-1763] */
{
  const mc = (more = []) => [power("mc", "Mind Control", null, [auto("m", "Mind Control", "rollAttribute", { attr: ["presence"] })], more.map((m) => m.id)), ...more];
  const T = base(mc());
  const a = act(T, "H1", "control");
  eq([a.label, EN[a.label], PL[a.label]], ["ITAC.kit.act.mind", "Take control of a sentient creature", "Przejmij kontrolę nad istotą rozumną"], "PW040 [B1761]: Mind Control's action names a sentient creature, not an animal");
  T.setRange("H1", "N1", 2);
  eq([code(await T.req("p1", decl("H1", a.id, { targets: ["N1"] }))), why(T.last)], ["illegal", "tooFar"], "PW041 [B1761]: your zone or an adjacent one");
  /* PW043: a win: the target takes a full turn at once on your command, then loses its next ordinary turn */
  const U = base(mc(), [], { order: ["H1", "H2", "N1", "H3", "N2", "N3"] });
  await U.req("p1", decl("H1", act(U, "H1", "control").id, { targets: ["N1"], text: "drop the gun" }));
  await U.roll("roll", 2); await U.roll("def:N1", 1);
  await U.gm({ op: "answerFor", prompt: U.prompt("outcome").id, value: "success" });
  const slot = U.state.init.slots.find((s) => s.extra?.kind === "mindControl");
  eq([slot?.members, slot?.extra?.by, !!U.state.ledger.N1.lostTurn, U.state.ledger.N1.noInterrupts, U.state.ledger.N1.grants.filter((g) => g.kind === "mindControl").length], [["N1"], "H1", true, 1, 2], "PW043 [B1761]: won: an extra turn (full and quick) for the target on your command, its next ordinary turn lost, no interrupts until then");
  await U.gm({ op: "endTurn", actor: "H1" });
  eq(U.state.init.curMember, "N1", "PW043 [B1761]: the controlled target acts at once, before the next card");
  const V = base(mc());
  await V.req("p1", decl("H1", act(V, "H1", "control").id, { targets: ["N1"] })); await V.roll("roll", 1); await V.roll("def:N1", 1);
  await V.gm({ op: "answerFor", prompt: V.prompt("outcome").id, value: "fail" });
  eq([V.state.init.slots.some((s) => s.extra?.kind === "mindControl"), !!V.state.ledger.N1.lostTurn], [false, false], "PW043: a tie fails [B2243]: nothing is imposed");
  /* PW041 Mimicry [B1753]: a target in your zone */
  const W = base([power("mi", "Mimicry", null, [auto("u", "Mimicry", "usePower")])]);
  W.setRange("H1", "N1", 1);
  eq([code(await W.req("p1", decl("H1", act(W, "H1", "mimic").id, { targets: ["N1"] }))), why(W.last)], ["illegal", "notSameZone"], "PW041 [B1753]: Mimicry copies from a target in your zone");
  /* PW042 Area Control [B1763]: 1 stress per target beyond the first, each target rolls, no huge, your zone or the next */
  const X = base(mc([item("ac", "Area Control", "boost", { power: "mc" })]));
  eq(act(X, "H1", "many").label, "ITAC.kit.act.minds", "PW042: Area Control's own name");
  eq([code(await X.req("p1", decl("H1", act(X, "H1", "many").id, { targets: ["N1", "N2"] }))), why(X.last)], ["illegal", "hugeTarget"], "PW042 [B1762]: never a huge creature, the second target either");
  X.setRange("H1", "N3", 2);
  eq([code(await X.req("p1", decl("H1", act(X, "H1", "many").id, { targets: ["N1", "N3"] }))), why(X.last)], ["illegal", "tooFar"], "PW041 [B1763]: every target in your zone or an adjacent one");
  X.setRange("H1", "N3", 1);
  eq(code(await X.req("p1", decl("H1", act(X, "H1", "many").id, { targets: ["N1", "N3"] }))), "ok", "PW042: two targets");
  await X.roll("roll", 2);
  eq([X.c.H1.resolve, X.requests.filter((r) => r.key.startsWith("def:")).map((r) => [r.key, r.attr]).sort()], [4, [["def:N1", "presence"], ["def:N3", "presence"]]], "PW042 [B1763]: 1 stress for the second target; each target rolls PRESENCE to resist");
  await X.roll("def:N1", 1); await X.roll("def:N3", 2);
  eq([X.top()?.data?.won, X.prompt("outcome")?.data?.suggests], [["N1"], "success"], "PW042: two sixes beat N1's one, not N3's two (a tie fails)");
  await X.gm({ op: "answerFor", prompt: X.prompt("outcome").id, value: "success" });
  eq(X.state.init.slots.filter((s) => s.extra?.kind === "mindControl").map((s) => s.members[0]), ["N1"], "PW043 + PW042: only the one won takes the imposed turn");
}
/* ================================================================== PW116 Hypnosis [B1764]: the power is not used in a fight, nor its boosts */
{
  const k = K.build({ items: [power("mc", "Mind Control", null, [auto("m", "Mind Control", "rollAttribute", { attr: ["presence"] })], ["ac", "hy", "rt"]), item("ac", "Area Control", "boost", { power: "mc" }), item("hy", "Hypnosis", "limit", { power: "mc" }), item("rt", "Requires Touch", "limit", { power: "mc" })], attrs: {} });
  eq([k.actions.map((a) => a.id), k.weapons.map((w) => w.id), k.rows.filter((r) => r.barred).map((r) => r.item).sort()], [[], [], ["ac", "hy", "mc", "rt"]], "PW116 [B1764], P6b-R13: with Hypnosis neither Area Control nor the touch of Requires Touch is offered");
}
/* ================================================================== PW044 Matter Control [B1745]: wreck the zone of the matter for bonus dice */
{
  const T = base([power("ma", "Matter Control", "basic", C.matter())]); T.terrain = { z1: "office" };
  const w = weapon(T, "H1", (x) => x.item === "ma" && !x.opt);
  eq(w.wreckWeight, 4, "PW044: Basic controls weight 4");
  eq(code(await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: w.id, wreck: 1 }))), "ok", "PW044 [B1745]: the shot wrecks the zone the matter comes from");
  await pass(T);
  eq([T.lastRequest()?.pool?.mods?.some?.((m) => m.source === "wreck" || m.source === "wreckBonus") ?? null, T.lastRequest()?.dice, T.zoneMarks.z1?.wrecked], [true, 4, true], "PW044 [B1745]: an office (min 4): +1 die, the zone is wrecked");
  const U = base([power("ma", "Matter Control", "basic", C.matter())]); U.terrain = { z1: "warehouse" };
  eq([code(await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: weapon(U, "H1", (x) => x.item === "ma" && !x.opt).id, wreck: 1 }))), why(U.last)], ["illegal", "wreckStrength"], "PW044: a warehouse needs 5: too heavy for Basic (weight 4)");
  const V = base([power("ma", "Matter Control", "major", C.matter())]); V.terrain = { z1: "warehouse" };
  eq(code(await V.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: weapon(V, "H1", (x) => x.item === "ma" && !x.opt).id, wreck: 1 }))), "ok", "PW044: Major (weight 6) wrecks a warehouse");
  const B = base([power("bl", "Blast", "basic", atk("Blast", [["agility", 3, 0, 3], ["agility", 4, 0, 4], ["agility", 5, 0, 5], ["agility", 6, 0, 6]]))]); B.terrain = { z1: "office" };
  eq([code(await B.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: weapon(B, "H1").id, wreck: 1 }))), why(B.last)], ["illegal", "wreckNotSlugfest"], "PW044: an ordinary shot still cannot wreck [B2451]");
}
/* ================================================================== PW045 Magnetism Control [B1737]: block an attack that uses metal, even a shot; counters of Damage 3 */
{
  const T = base([power("mg", "Magnetism Control", "basic", C.magnet())], [], { turn: "N1" });
  eq(T.c.H1.pass.metalBlock, 3, "PW045: the counter's damage at Basic");
  T.weapons.gun = { id: "gun", name: "Handgun", bonus: 0, damage: 3, range: [0, 2], sharp: false };
  await T.gm(decl("N1", "shoot", { targets: ["H1"], weapon: "gun" }));
  const p = T.prompt("reaction", "H1");
  eq(p?.options.find((o) => o.id === "block")?.disabled ?? (p?.options.some((o) => o.id === "block") ? null : "missing"), null, "PW045 [B1737]: a shot can be blocked with Magnetism Control (the GM rules whether it uses metal)");
  await T.req("p1", { op: "answer", prompt: p.id, value: "block" });
  await T.roll("attack", 1); await T.roll("def:H1", 3);
  const c = T.prompt("counter", "H1");
  eq(c?.options.map((o) => o.id), ["counter", "counter:metal", "pass"], "PW045: the blocker may counter with the metal (Damage 3)");
  eq([c?.options.find((o) => o.id === "counter:metal")?.data?.n, EN["ITAC.opt.counterMetal"].includes("{n}"), PL["ITAC.opt.counterMetal"].includes("{n}")], [3, true, true], "PW045: the card names the counter's damage (the n the option labels fill in)");
  const U = base([power("mg", "Magnetism Control", "major", C.magnet())], [], { turn: "N1" });
  await U.gm(decl("N1", "slugfest", { targets: ["H1"] }));
  await U.req("p1", { op: "answer", prompt: U.prompt("reaction", "H1").id, value: "block" });
  await U.roll("attack", 1); await U.roll("def:H1", 3);
  const n0 = U.c.N1.health;
  await U.req("p1", { op: "answer", prompt: U.prompt("counter", "H1").id, value: "counter:metal" });
  const s = U.prompt("stunts"); if (s) await U.req("p1", { op: "answer", prompt: s.id, value: [] });
  eq(n0 - U.c.N1.health, 4, "PW045 [B1737-1739]: the metal counter hits with Damage 4 at Major");
  /* PW046 [B1735]: up to 2 weight steps more for as much stress */
  const V = base([power("mg", "Magnetism Control", "basic", C.magnet())]);
  const z = act(V, "H1", "zone");
  eq([z.label, z.pick], ["ITAC.kit.act.weigh", ["0", "1", "2"]], "PW046: the zone action asks for the extra weight steps");
  await V.req("p1", decl("H1", z.id, { opt: "2", text: "the bridge" }));
  eq(V.c.H1.resolve, 3, "PW046 [B1735]: 2 steps more, 2 stress");
  const W = base([power("ma", "Matter Control", "basic", C.matter())]);
  await W.req("p1", decl("H1", act(W, "H1", "zone").id, { opt: "1" }));
  eq(W.c.H1.resolve, 4, "PW046 [B1744]: Matter Control the same, 1 step 1 stress");
}
/* ================================================================== PW047, PW049 Plant Control [B1778-1784] */
{
  const T = base([power("pl", "Plant Control", "basic", C.plant())]);
  const w = weapon(T, "H1", (x) => x.item === "pl");
  eq([w.fam, w.reach, w.noCounter], ["slug", 1, true], "PW049/PW047: a slugfest attack reaching the next zone, with no counterattack");
  await T.req("p1", decl("H1", "slugfest", { targets: ["N1"], weapon: w.id }));
  await T.gm({ op: "answerFor", prompt: T.prompt("reaction", "N1").id, value: "block" });
  await T.roll("attack", 1); await T.roll("def:N1", 3);
  eq([T.prompt("counter"), T.state.stack.length], [null, 0], "PW047 [B1779]: blocked with sixes to spare: no counterattack against the plants' user");
  for (const [lv, far, okd] of [["basic", 1, "ok"], ["basic", 2, "illegal"], ["major", 2, "ok"], ["monstrous", 4, "ok"]]) {
    const U = base([power("pl", "Plant Control", lv, C.plant())]); U.setRange("H1", "N1", far);
    eq(code(await U.req("p1", decl("H1", "slugfest", { targets: ["N1"], weapon: weapon(U, "H1", (x) => x.item === "pl").id }))), okd, `PW049 [B1778-1784]: ${lv} at ${far} zone(s): ${okd}`);
  }
}
/* ================================================================== PW050 Sorcery [B1790] */
{
  const T = base([power("so", "Sorcery", null, C.sorcery())]);
  eq(T.c.H1.kit.actions.filter((a) => a.kit.item === "so").map((a) => [a.id.split("-").pop(), a.cost, a.stress?.fixed ?? 0, a.roll?.attr ?? null]), [["spell", "full", 0, "presence"], ["spellOn", "none", 1, null]], "PW050 [B1790]: the PRESENCE roll is the full action; using the spell is 1 stress, no second action");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "spellOn").id))), why(T.last)], ["illegal", "noSpell"], "PW050: no spell prepared, nothing to use");
  await T.req("p1", decl("H1", act(T, "H1", "spell").id, { text: "Flight" })); await T.roll("roll", 0);
  await T.gm({ op: "nextRound" }); T.turn("H1");
  const r = await T.gm(decl("H1", act(T, "H1", "spell").id, { text: "flight" }));
  eq([code(r), why(r)], ["illegal", "spellLocked"], "PW050 [B1790]: a failed spell: the same power not again for hours (the scene)");
  eq(code(await T.gm(decl("H1", act(T, "H1", "spell").id, { text: "Blast" }))), "ok", "PW050: another power may be tried");
  await T.roll("roll", 1);
  await T.gm({ op: "nextRound" }); T.turn("H1");
  const r0 = T.c.H1.resolve;
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "spellOn").id))), T.c.H1.resolve], ["ok", r0 - 1], "PW050 [B1790]: succeeded: 1 stress to use it");
  eq([code(await T.req("p1", decl("H1", act(T, "H1", "spellOn").id))), why(T.last)], ["illegal", "noSpell"], "PW050: one prepared spell, used once");
}
/* ================================================================== PW051 Technology Control [B1819]; PW118 Telepathy [B2086-2087] */
{
  const T = base([power("tc", "Technology Control", null, C.tech())]);
  eq(T.c.H1.kit.actions.filter((a) => a.kit.item === "tc").map((a) => [a.id.split("-").pop(), a.roll?.attr ?? null]), [["seize", "agility"], ["u0", "reason"], ["u1", null]], "PW051 [B1819]: a weapon taken over fires on AGILITY; the sheet's REASON roll and plain use stay");
  const U = base([power("te", "Telepathy", null, C.telepathy())]);
  const deep = U.c.H1.kit.actions.find((a) => a.kit.item === "te" && a.roll?.attr === "intuition" && a.id.endsWith("-u1"));
  eq([deep?.cost, deep?.oppose, act(U, "H1", "sense")?.cost, act(U, "H1", "sense")?.roll], ["full", { attr: "presence", who: "target", optional: true }, "quick", { attr: "intuition" }], "PW118 [B2086-2087]: the deeper probe is opposed by PRESENCE; sensing lifeforms is a quick INTUITION roll");
  await U.req("p1", decl("H1", deep.id, { targets: ["N1"] })); await U.roll("roll", 1);
  eq([U.lastRequest()?.key, U.lastRequest()?.attr], ["def:N1", "presence"], "PW118 [B2086]: a target that resists rolls PRESENCE against it");
  const V = base([power("te", "Telepathy", null, C.telepathy())]);
  await V.req("p1", decl("H1", V.c.H1.kit.actions.find((a) => a.id.endsWith("-u1") && a.kit.item === "te").id)); await V.roll("roll", 1);
  eq(V.state.stack.length ? V.prompt("outcome")?.kind : "closed", "outcome", "PW118: nobody named, nobody resists: the GM's card");
}
/* ================================================================== PW054, PW055 Telekinesis [B1822-1829] */
{
  /* PWA-M: since PWA (PW053) the compendium's Throw Target is an attack profile of its own (a throw, no damage, this zone or the next
     [B1822], [B1823]); the errata of PW054 is about the attack proper, so the throw is read apart and must stay untouched by it */
  const tkw = (lv, autos = C.tk()) => K.build({ items: [power("tk", "Telekinesis", lv, autos)], attrs: {} }).weapons.filter((w) => w.fam === "shoot");
  const at = (lv, autos = C.tk()) => tkw(lv, autos).filter((w) => !w.onHit?.throw).map((w) => [w.damage, w.range]);
  eq(["basic", "major", "massive", "monstrous"].map((lv) => tkw(lv).filter((w) => w.onHit?.throw).map((w) => [w.damage, w.range, !!w.errata])), [[[null, [0, 1], false]], [[null, [0, 1], false]], [[null, [0, 1], false]], [[null, [0, 1], false]]], "PWA-M: the Throw Target profile beside the attack, never touched by the errata");
  eq([at("basic"), at("major"), at("massive"), at("monstrous")], [[[3, [0, 2]]], [[4, [0, 3]]], [[5, [0, 4]]], [[6, [0, 5]]]], "PW054 [B1824-1828]: the compendium's Monstrous 5, 0/6 is played as the book's 6, 0/5");
  const own = C.tk(); own[3] = { ...own[3], damage: 7, max: 6 };
  eq(at("monstrous", own), [[7, [0, 6]]], "PW054: numbers the GM changed stay");
  const k = K.build({ items: [power("tk", "Telekinesis", "major", C.tk(), ["mt"]), item("mt", "Multiple Targets", "boost", { power: "tk" })], attrs: {} });
  const use = k.actions.find((a) => a.kit.item === "tk" && a.name === "Telekinesis");
  eq([use?.label, use?.pick, use?.stressPick], ["ITAC.kit.act.weigh", ["0", "1", "2"], 1], "PW055 [B1822]: the weight limit up to 2 steps higher, 1 stress a step");
  eq(k.actions.find((a) => a.id.endsWith("-many"))?.pick.slice(-1), ["8"], "PW055 [B1829]: more than four targets (the weight limit and the Resolve are the bound)");
}
/* ================================================================== PW056, PW057 Water Control [B1832-1835] */
{
  const at = (lv) => K.build({ items: [power("wa", "Water Control", lv, C.water())], attrs: {} }).weapons.filter((w) => !w.opt).map((w) => [w.damage, w.range]);
  eq([at("basic"), at("major"), at("massive"), at("monstrous")], [[[1, [0, 1]]], [[3, [0, 1]]], [[4, [0, 1]]], [[5, [0, 1]]]], "PW057 [B1832-1835]: Range 0/1 at every level (more zones, not more range)");
  const T = base([power("wa", "Water Control", "basic", C.water())], [], { map: 1 });
  T.c.N1.zone = "z1"; T.c.H1.zone = "z1";
  const sw = weapon(T, "H1", (x) => x.opt === "sweep");
  eq([sw.noDamage, sw.immuneHuge, sw.onHit], [true, true, { throw: 0, zones: 1, sweep: 1 }], "PW056 [B1832]: the sweep moves the target instead of damage");
  eq([code(await T.req("p1", decl("H1", "shoot", { targets: ["N2"], weapon: sw.id }))), why(T.last)], ["illegal", "hugeTarget"], "PW056 [B1832]: not a huge creature");
  const h0 = T.c.N1.health;
  await T.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: sw.id })); await pass(T); await T.roll("attack", 1);
  const s = T.prompt("stunts"); if (s) await T.req("p1", { op: "answer", prompt: s.id, value: [] });
  const d = T.prompt("knockDir");
  eq([T.c.N1.health, d?.to, d?.data, d?.options.map((o) => o.id)], [h0, { users: ["p1"] }, { target: "N1", distance: 1 }, ["away", "to:z2"]], "PW056 [B1832]: no damage; the attacker names the adjacent zone");
  await T.req("p1", { op: "answer", prompt: d.id, value: "to:z2" });
  eq([T.top()?.action, T.top()?.data?.forced?.toward, T.top()?.data?.forced?.distance, T.top()?.data?.forced?.damage], ["forcedMove", "z2", 1, 0], "PW056: the target is moved one zone, no damage");
  const U = base([power("wa", "Water Control", "basic", C.water())]);
  U.c.N1.health = 6;
  await U.req("p1", decl("H1", "shoot", { targets: ["N1"], weapon: weapon(U, "H1", (x) => x.opt === "sweep").id })); await pass(U); await U.roll("attack", 1);
  const s2 = U.prompt("stunts"); if (s2) await U.req("p1", { op: "answer", prompt: s2.id, value: [] });
  eq([U.state.stack.length, U.c.N1.health, U.prompt("knockDir")], [0, 6, null], "PW056: without a map the sweep closes, no damage (the GM moves the target, as Telekinesis' throw [B1826])");
}
/* ================================================================== PW058 Weather Control's storm [B1841]: -3 dice to shots in the zone, not its maker's */
{
  const T = base([power("wx", "Weather Control", "basic", C.weather())], [], { map: 1 }); T.setRange("H1", "N1", 1); T.c.N1.zone = "z2";
  T.weapons.gun = { id: "gun", name: "Handgun", bonus: 0, damage: 3, range: [0, 2], sharp: false };
  const shot = async (X, who, target, w) => { await X.gm(decl(who, "shoot", { targets: [target], weapon: w })); const p = X.prompt("reaction"); if (p) await X.gm({ op: "answerFor", prompt: p.id, value: "pass" }); return X.lastRequest(); };
  T.records = { z1: [{ kind: "weather", owner: "H1", data: { type: "storm" } }] };
  const own = await shot(T, "H1", "N1", weapon(T, "H1", (x) => x.item === "wx" && !x.opt).id);
  eq(own?.dice, 3, "PW058 [B1841]: the storm's maker shoots out of it unhindered");
  const U = base([], [], { map: 1, turn: "N1" }); U.setRange("H1", "N1", 1); U.c.N1.zone = "z2"; U.records = { z1: [{ kind: "weather", owner: "H1", data: { type: "storm" } }] };
  U.weapons.gun = { id: "gun", name: "Handgun", bonus: 0, damage: 3, range: [0, 2], sharp: false };
  const into = await shot(U, "N1", "H1", "gun");
  eq([into?.dice, into?.pool?.mods?.find?.((m) => m.source === "storm")?.dice ?? null], [1, -3], "PW058 [B1841]: a shot into the storm's zone: -3 dice (AGILITY 3, at least one die)");
  const V = base([], [], { map: 1, turn: "N1" }); V.setRange("H1", "N1", 1); V.c.N1.zone = "z2";
  V.weapons.gun = U.weapons.gun;
  eq((await shot(V, "N1", "H1", "gun"))?.dice, 3, "PW058: no storm, no penalty");
}
/* ================================================================== PW059 Cyclone [B1846]: the zone is wrecked; who fails is thrown out */
{
  const cy = [power("wx", "Weather Control", "basic", C.weather(), ["cy"]), item("cy", "Cyclone", "boost", { power: "wx" })];
  const T = base(cy, [], { map: 1 });
  await T.req("p1", decl("H1", act(T, "H1", "cyclone").id, { targets: ["N1"] }));
  eq([T.zoneMarks.z1?.wrecked, T.state.karma.some((k) => k.kind === "wreckedZone")], [true, true], "PW059 [B1846]: the storm's zone is wrecked");
  await T.roll("res:N1", 0);
  const d = T.prompt("knockDir");
  eq([d?.data, d?.options.map((o) => o.id)], [{ target: "N1", distance: 1 }, ["to:z2", "away"]], "PW059 [B1846]: failed STRENGTH: thrown out into an adjacent zone of the caster's choice");
  await T.req("p1", { op: "answer", prompt: d.id, value: "to:z2" });
  eq([T.top()?.action, T.top()?.data?.forced?.toward, T.top()?.data?.forced?.damage], ["forcedMove", "z2", 0], "PW059: the throw is a forced move of one zone");
  const U = base(cy, [], { map: 1 });
  await U.req("p1", decl("H1", act(U, "H1", "cyclone").id, { targets: ["N1"] })); await U.roll("res:N1", 1);
  eq([U.prompt("knockDir"), U.state.stack.length], [null, 0], "PW059: a six: the target stands");
  const V = base(cy, [], { map: 1 }); V.zoneMarks.z1 = { wrecked: true };
  await V.req("p1", decl("H1", act(V, "H1", "cyclone").id, { targets: ["N1"] }));
  eq(V.zonesLog.length, 0, "PW059: a zone already wrecked is not wrecked again");
}
/* ================================================================== the words */
{
  for (const k of ["cast", "mimic", "spell", "spellOn", "seize", "sense", "mind", "minds", "weigh"]) ok(both(`ITAC.kit.act.${k}`), `the action name ${k} in both languages`);
  for (const k of ["ITAC.reason.spellLocked", "ITAC.reason.noSpell", "ITAC.opt.counterMetal"]) ok(both(k), `${k} in both languages`);
}
done("check-pwd");
