// node scripts/tactics/check-fxr2.mjs -- FXR2: the third full live fight (FF8, dev/combat-defects.md section "ff8"), no Foundry:
//   D1  the chase panel's catch row names the target the striker PICKED (every seat), also after the answer and after the round; a pass is
//       told as one; a target concealed from a player is "somebody" there, the striker's row stays
//   D2  a player's chase panel reads a broken hero (the "broken" status, table knowledge) as the GM's does: never the side's roller, tagged
//   D3  an ally marked "summoned by" whose owner left the fight and who is back on its own (other) side: the table is told in a news line;
//       nothing told when the side does not change, nor for a player who may not know the ally
//   D4  Polish: the attribute after "na" is in the accusative ("rzucając na Siłę")
//   D5  a news line about one who left the fight in sight names it (the Combat's leftNames), never one who left hidden
//   D6  the statistics' chase mark says the fight had a chase
import { ok, eqc as eq, done, Table } from "./testkit.mjs";
import { readFileSync } from "node:fs";
import * as V from "./view-pure.mjs";
import * as CF from "./flows/chase.mjs";
import * as CP from "./ui/chase-pure.mjs";
import * as MP from "./ui/model-pure.mjs";
import { t as say, tIn, EN, PL } from "./lang.mjs";
import { TERMS, ATTR_ACC_PL } from "../i18n/terms.mjs";

const code = (env) => env?.error?.code ?? (env?.ok ? "ok" : "?");
const t = (k, p, fb) => say(k, p, fb === undefined ? k : fb);
const hiddenOf = (T) => Object.keys(T.c).filter((id) => T.c[id].hidden);
const facts = (T, v, me, left = null) => ({ view: v, staff: me === "gm", me, whole: me === "gm" ? (id) => T.c[id] ?? null : undefined, left,
  c: (id) => (T.c[id] && (me === "gm" || !T.c[id].hidden) ? { name: T.c[id].name ?? id, npc: !!T.c[id].npc, kind: T.c[id].kind ?? null, img: null, way: T.c[id].kind === "vehicle" ? null : CP.wayOf(T.c[id]) } : null), userName: (u) => `User ${u}`, online: () => true, rollBusy: () => false });
const view = (T, me, owns) => (me === "gm" ? T.state : V.viewFor(T.state, { id: me, staff: false, owns }, { hidden: hiddenOf(T), npc: Object.keys(T.c).filter((id) => T.c[id].npc) }));
const panel = (T, me, owns = []) => CP.chaseData(view(T, me, owns), {}, facts(T, view(T, me, owns), me), t);
const SEATS = [["gm", []], ["p3", ["H3"]], ["p1", ["H1"]]];
const strikeRows = (p) => (p.catch?.rows ?? []).filter((r) => r.kind !== "barred").map((r) => [r.kind, r.name, r.tag]);
const at = (who) => say("ITAC.chase.catch.at", { what: EN["ITAC.chase.catch.rowCharge"], name: who });

async function table({ prey = ["N1", "N2"], pursuer = ["H3"], distance = 1 } = {}) {
  const T = new Table();
  T.hero("H1", "p1", { name: "Kid" }).hero("H3", "p3", { name: "Eve", movement: [{ mode: "flight", tier: "basic" }] });
  T.npc("N1", { name: "Doc" }).npc("N2", { name: "Soldier", attrs: { agility: 1 } });
  T.order(["H1", "N1", "H3", "N2"]).turn("H1");
  eq(code(await T.gm({ op: "chaseStart", prey, pursuer, distance })), "ok", `table: the chase starts (${pursuer} after ${prey})`);
  return T;
}
async function caught(T) {
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "a chase round");
  await T.roll("prey", 0);
  await T.roll("pursuer", 3);
  eq(T.state.chase.distance, 0, "(caught)");
}
async function settle(T) {
  for (let k = 0; k < 16 && T.top() && T.top().flow !== "chase"; k++) {
    const p = T.prompts().find((x) => x.inst === T.top().id);
    if (p) { await T.answer("gm", p.kind, p.options?.find((o) => o.id === "pass") ? "pass" : p.options[0].id, p.about); continue; }
    const r = Object.keys(T.top().rolls ?? {}).find((x) => T.top().rolls[x].sixes == null);
    if (r) await T.roll(r, 0); else break;
  }
}

/* ================================================================== D1: the catch row names the picked target */
{
  const T = await table();
  await caught(T);
  const q = T.prompt("chaseCatch"), first = q?.data?.target, other = (q?.data?.targets ?? []).find((x) => x !== first);
  ok(!!first && !!other, `D1 premise: Eve may pick between two fleeing (default ${first}, other ${other})`);
  const nm = (id) => T.c[id].name;
  for (const [me, owns] of SEATS) eq(strikeRows(panel(T, me, owns)), [["strike", "Eve", say("ITAC.chase.catch.rowPick", { what: EN["ITAC.chase.catch.rowCharge"] })]], `D1 ${me}: while the card is open, Eve picks a target`);
  eq(code(await T.answer("p3", "chaseCatch", `attack:${other}`)), "ok", "D1: Eve charges the one the engine did not offer first");
  eq([T.top().action, T.top().decl.targets], ["charge", [other]], "D1: (the engine charges that one)");
  eq(T.state.chase.last.struck, [{ who: "H3", unit: "H3", at: other }], "D1: the pick is recorded in state.chase.last.struck");
  for (const [me, owns] of SEATS) {
    const p = panel(T, me, owns);
    eq(strikeRows(p), [["strike", "Eve", at(nm(other))]], `D1 ${me}: during the charge the row names ${nm(other)} (was the fleeing roller ${nm(first)})`);
    ok(p.catch.text.includes(nm(other)) && !p.catch.text.includes(nm(first)), `D1 ${me}: the catch line's tooltip names the picked target only`);
  }
  await settle(T);
  for (const [me, owns] of SEATS) eq(strikeRows(panel(T, me, owns)), [["strike", "Eve", at(nm(other))]], `D1 ${me}: after the charge, to the end of the round, the row still names ${nm(other)}`);
  /* the GM hides the picked target: a player's row says "somebody", nothing of the hidden one; the GM's row keeps the name */
  T.c[other].hidden = true;
  eq(strikeRows(panel(T, "p1", ["H1"])), [["strike", "Eve", at(EN["ITAC.Someone"])]], "D1: a target hidden from a player: the striker's row stays, the target is somebody");
  ok(!JSON.stringify(panel(T, "p1", ["H1"])).includes(nm(other)) && !JSON.stringify(view(T, "p1", ["H1"]).chase).includes(other), "D1: nothing of the hidden target in the player's panel or chase record");
  eq(strikeRows(panel(T, "gm")), [["strike", "Eve", at(nm(other))]], "D1: the GM's row names it");
}
/* a pass is told as a pass (before, the row kept "Charge: <the fleeing roller>") */
{
  const T = await table();
  await caught(T);
  eq(code(await T.answer("p3", "chaseCatch", "pass")), "ok", "D1 pass: Eve passes");
  await settle(T);
  eq(T.state.chase.last.struck, [{ who: "H3", unit: "H3", pass: 1 }], "D1 pass: recorded");
  for (const [me, owns] of SEATS) eq(strikeRows(panel(T, me, owns)), [["pass", "Eve", EN["ITAC.chase.catch.passed"]]], `D1 pass ${me}: the row says Eve passed`);
}
/* two strikers: the first one's pick stands while the second's card is open */
{
  const T = await table({ pursuer: ["H3", "H1"] });
  T.c.H1.movement = [{ mode: "flight", tier: "basic" }];
  eq(code(await T.gm({ op: "chaseRound" })), "ok", "D1 two: a round");
  await T.roll("prey", 0); await T.roll("pursuer", 3);
  const q1 = T.prompt("chaseCatch"), o1 = q1.data.targets.find((x) => x !== q1.data.target);
  eq(code(await T.answer(q1.about === "H3" ? "p3" : "p1", "chaseCatch", `attack:${o1}`)), "ok", "D1 two: the first striker picks the other target");
  await settle(T);
  const q2 = T.prompt("chaseCatch");
  ok(!!q2 && q2.about !== q1.about, "D1 two: (the second striker's card is open)");
  const rows = strikeRows(panel(T, "gm"));
  eq(rows, [["strike", T.c[q1.about].name, at(T.c[o1].name)], ["strike", T.c[q2.about].name, say("ITAC.chase.catch.rowPick", { what: EN["ITAC.chase.catch.rowCharge"] })]], "D1 two: one row per striker: the first's pick, the second's open card");
}

/* ================================================================== D2: a broken hero on a player's panel */
{
  const T = await table({ pursuer: ["H1", "H3"] });
  eq(code(await T.gm({ op: "setHealth", combatant: "H1", value: 0 })), "ok", "D2: Kid is broken (Health 0)");
  ok((T.state.statuses?.H1 ?? []).some((s) => s.id === "broken"), "D2 premise: the broken status stands (table knowledge)");
  const gm = panel(T, "gm"), side = (p) => p.sides.find((s) => s.id === "pursuer");
  const gmKid = side(gm).units.find((u) => u.id === "H1");
  eq([side(gm).roller?.id, gmKid?.stuck], ["H3", "down"], "D2 premise: the GM's panel: Eve rolls, Kid is down");
  for (const [me, owns] of [["p1", ["H1"]], ["p3", ["H3"]]]) {
    const p = panel(T, me, owns), s = side(p), kid = s.units.find((u) => u.id === "H1");
    eq([s.roller?.id, s.lead?.id, kid?.stuck, kid?.stuckText, s.rolls.text, s.able], ["H3", "H3", "down", EN["ITAC.chase.stuck.down"], say("ITAC.chase.rollsNext", { name: "Eve" }), 1],
      `D2 ${me}: as on the GM's panel: Eve is the one who will roll, Kid is tagged down (was "the slowest rolls" with Kid's picture)`);
  }
}

/* ================================================================== D3: an ally back on its own side when its owner leaves */
{
  const mkT = () => { const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).hero("H3", "p3", { name: "Eve" }).npc("N1", { name: "Doc" });
    T.npc("S1", { name: "Soldier", kind: "minions", members: 3, health: 3, summonOf: "H1" }); T.order(["H1", "H3", "N1"]).turn("H3");
    const base = T.parts.bind(T);      // the participant's `team` as system-adapter reads it: its own side, or its owner's while the owner is in the Combat
    T.parts = () => base().map((p) => (p.summonOf ? { ...p, team: (T.c[p.id]?.team === "heroes" || (T.c[p.summonOf] && !T.c[p.summonOf].npc)) ? "heroes" : "gm" } : p));
    return T; };
  const T = mkT();
  await T.gm({ op: "roster" });
  eq([T.state.teams, (T.state.summons ?? []).map((s) => s.owner)], [{ S1: "heroes" }, ["H1"]], "D3 premise: the Soldiers act for Omni, on the heroes' side");
  const n0 = (T.state.news ?? []).length;
  T.c.H1.defeated = true; await T.gm({ op: "roster" });
  eq([(T.state.news ?? []).length, T.state.teams], [n0, { S1: "heroes" }], "D3: Omni defeated (still in the Combat): the side stays, nothing told (FXK2-1)");
  delete T.c.H1; await T.gm({ op: "roster" });
  const line = (T.state.news ?? []).at(-1);
  eq([line?.kind, line?.actor, line?.owner, line?.team, T.state.teams], ["ally", "S1", "H1", "gm", { S1: "gm" }], "D3: Omni left the Combat: the Soldiers are back on their own side and the table is told");
  const left = (id) => (id === "H1" ? "Omni" : null);
  const nd = MP.newsData(view(T, "p3", ["H3"]), {}, facts(T, view(T, "p3", ["H3"]), "p3", left), t);
  eq(nd?.text, say("ITAC.ui.news.allyLost", { name: "Soldier", owner: "Omni" }), "D3: Eve's player reads that the Soldiers are no longer on the heroes' side");
  ok(PL["ITAC.ui.news.allyLost"].includes("{owner}") && PL["ITAC.ui.news.allyGained"].includes("{name}"), "D3: Polish lines exist");
  await T.gm({ op: "roster" });
  eq((T.state.news ?? []).filter((n) => n.kind === "ally").length, 1, "D3: told once");
}
/* a hidden ally: the line never reaches a player */
{
  const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).hero("H3", "p3", { name: "Eve" }).npc("N1");
  T.npc("S1", { name: "Spy", summonOf: "H1", hidden: true }); T.order(["H1", "H3", "N1"]).turn("H3");
  const base = T.parts.bind(T); T.parts = () => base().map((p) => (p.summonOf ? { ...p, team: T.c[p.summonOf] ? "heroes" : "gm" } : p));
  await T.gm({ op: "roster" }); delete T.c.H1; await T.gm({ op: "roster" });
  eq((T.state.news ?? []).at(-1)?.kind, "ally", "D3 hidden: (the engine writes the line)");
  ok(!(view(T, "p3", ["H3"]).news ?? []).some((n) => n.kind === "ally") && !JSON.stringify(view(T, "p3", ["H3"])).includes("S1"), "D3 hidden: a player gets nothing of the hidden ally");
}
/* a friendly NPC marked as the hero's: its side does not change, nothing is told */
{
  const T = new Table(); T.hero("H1", "p1").hero("H3", "p3").npc("N1");
  T.npc("S1", { name: "Cop", summonOf: "H1", team: "heroes" }); T.order(["H1", "H3", "N1"]).turn("H3");
  const base = T.parts.bind(T); T.parts = () => base().map((p) => (p.summonOf ? { ...p, team: "heroes" } : p));
  await T.gm({ op: "roster" }); delete T.c.H1; await T.gm({ op: "roster" });
  ok(!(T.state.news ?? []).some((n) => n.kind === "ally"), "D3: a friendly ally stays with the heroes: nothing told");
}
/* the participant reads the side as the engine's facts do (source) */
{
  const SA = readFileSync(new URL("./system-adapter.mjs", import.meta.url), "utf8");
  ok(/summonOf: S\.isId\(summonOf\) \? summonOf : null, \.\.\.\(S\.isId\(summonOf\) \? \{ team: \[c, c\?\.parent\?\.combatants\?\.get\(summonOf\)\]\.some\([^\n]*S\.allySide\(/.test(SA), "D3: the participant's team = its own side or its owner's in the Combat (S.allySide, as engine.mjs team)");
}

/* ================================================================== D4: the accusative after "na" */
{
  const pl = (k, p, fb) => tIn("pl", k, p, fb === undefined ? k : fb);
  eq(Object.fromEntries([...MP.ACC_PL]), Object.fromEntries(Object.entries(ATTR_ACC_PL).map(([k, v]) => [TERMS.pl[k], v])), "D4: the accusative table equals the system glossary (i18n/terms.mjs)");
  eq(["strength", "fighting", "presence", "intuition", "agility", "reason"].map((a) => MP.attrAccText(pl, a)), ["Siłę", "Walkę", "Prezencję", "Intuicję", "Zwinność", "Rozum"], "D4: Polish accusative");
  eq(MP.attrAccText(t, "strength"), "Strength", "D4: English as it was");
  const T = new Table(); T.hero("H1", "p1", { name: "Omni" }).npc("N1"); T.order(["H1", "N1"]).turn("H1");
  const p = { id: "o", kind: "objective", about: "H1", data: { challenge: "N1", attr: "strength" }, options: [{ id: "accept", label: "ITAC.opt.accept", req: {} }], answerReq: (v) => ({ op: "answer", prompt: "o", value: v }) };
  const card = JSON.stringify(MP.askData(p, { t: pl, facts: facts(T, T.state, "gm"), own: {}, desk: true }));
  ok(card.includes("rzucając na Siłę") && !card.includes("na Siła"), "D4: the GM's approve card reads 'rzucając na Siłę'");
  const opt = JSON.stringify(MP.askData({ ...p, kind: "chaseOption", data: { obstacle: "crowd", attr: "agility" } }, { t: pl, facts: facts(T, T.state, "gm"), own: {}, desk: true }));
  ok(opt.includes("rzucić na Zwinność"), "D4: the chase option card too");
}

/* ================================================================== D5: one who left in sight keeps its name */
{
  let list = V.leftNameAdd(null, "N2", "The Mauler Twins A");
  eq(list, [{ id: "N2", name: "The Mauler Twins A" }], "D5: the name of one who left in sight is written down");
  eq(V.leftNameAdd(list, "N2", "The Mauler Twins A"), null, "D5: written once");
  list = V.leftNameAdd(list, "N3", "Doc");
  eq([V.leftName(list, "N2"), V.leftName(list, "N2", ["N2"]), V.leftName(list, "N9")], ["The Mauler Twins A", null, null], "D5: read back; never for one in the hidden list");
  const v = { round: 3, kind: "combat", knowledge: { H1: {} }, news: [{ id: "n5_f1", round: 3, kind: "action", actor: "N2", action: "grapple", flow: "attack", result: "done", rows: [{ target: "H1", hit: true }] }] };
  const f = (left) => ({ view: v, staff: false, me: "p2", left, c: (id) => (id === "H1" ? { name: "Kid Omni-Man" } : null), zone: () => null });
  const before = MP.newsData(v, {}, f(null), t), after = MP.newsData(v, {}, f((id) => V.leftName(list, id)), t);
  ok(before.text.startsWith(EN["ITAC.Someone"]), `D5 premise: without the record the line says somebody (${before.text})`);
  ok(after.text.startsWith("The Mauler Twins A") && after.text.includes("Kid Omni-Man"), `D5: the news line names the Mauler (${after.text})`);
  const M = readFileSync(new URL("./main.mjs", import.meta.url), "utf8"), U = readFileSync(new URL("./ui/main.mjs", import.meta.url), "utf8");
  ok(/!V\.concealed\(cb, cb\.token\) \? V\.leftNameAdd\(c\.flags\?\.\[MOD\]\?\.leftNames/.test(M), "D5: the GM writes down a combatant not hidden from the players as it is deleted");
  ok(/left: \(id\) => \{ try \{ if \(combat\.combatants\.get\(id\)\) return null;[^\n]*\n[^\n]*"unseen"\)\) return null;\n\s*return leftName\(combat\.flags\?\.\[Store\.MOD\]\?\.leftNames, id, combat\.flags\?\.\[Store\.MOD\]\?\.hidLeft/.test(U), "D5: the surfaces read it, never for one that left hidden or unseen");
}

/* ================================================================== D6: the statistics' chase mark */
{
  const SL = readFileSync(new URL("../stats/lang.mjs", import.meta.url), "utf8");
  ok(/"IPU\.Stats\.fight\.chase": "z pościgiem"/.test(SL) && /"IPU\.Stats\.fight\.chase": "with a chase"/.test(SL), "D6: the mark says the fight had a chase, not how it ended");
}

done("check-fxr2");
