/* node scripts/tactics/check-fxq2.mjs -- fixer FXQ2: the adversary's defects ADVS-D1..D12 of the statistics, the fight titles and the window
   (scripts/stats/). Every block names the defect it proves; real fights go through testkit's Table (the engine's own events).
   D1 a group wiped out by one blow counts its members; D2 the first fight of a session has its titles under "Session"; D3 no assist for a
   blow on somebody already down; D4 a friendly unowned NPC counts its kills by the fight's sides in the window too; D5 a fight stopped by
   the GM keeps who went down; D6 the GM's Health correction to 0 is a defeat (and its undo takes it back); D7 an initiative roll is no
   loose roll; D8 a heal of oneself is no Medic help, no Final Blow while a foe the table saw still stands; D9 a reset is not undone by
   the next GM load; D10 no empty fight is listed; D11 the warning in the user's language; D12 a player's session boundary ignores GM-only
   facts. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as P from "../stats/pure.mjs";
import * as TP from "../stats/titles-pure.mjs";
import * as M from "../stats/model.mjs";
import * as L from "../stats/lang.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", f), "utf8");
function fold(events, who, pub = () => true) {
  const facts = new Map();
  for (const ev of events) {
    const out = P.factsOfEvent({ combat: "C1", fight: "f1", ...ev }, { who, pub: pub(ev) });
    if (out.drop) for (const id of P.idsToDrop([...facts.values()], out.drop)) facts.delete(id);
    for (const x of out.facts) facts.set(x.id, x);
  }
  return [...facts.values()];
}
const whoOf = (T) => (cid) => (T.c[cid] ? { a: `A_${cid}`, side: T.c[cid].npc ? "n" : "h", minion: T.c[cid].kind === "minions" } : null);
const settle = async (T, sixes = 3) => {
  for (let n = 0; n < 40; n++) {
    const p = T.prompts()[0];
    if (p) { await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: p.kind === "stunts" ? [] : (p.options?.find((o) => ["pass", "none", "kill", "ko"].includes(o.id)) ?? p.options?.[0])?.id }); continue; }
    if (T.top()?.rolls?.attack && T.top().rolls.attack.sixes == null) { await T.roll("attack", sixes); continue; }
    break;
  }
};
const F = (x) => ({ m: "t", f: "C1_f1", t: 1000, ...x });
const names = { t: L.t, attr: (x) => x, action: (x) => x, stunt: (x) => x, out: (x) => x, user: () => "Gracz", players: () => [{ id: "p1", name: "Gracz 1" }], when: () => "t", attrs: () => null };
const holder = (r, id) => r.titles.filter((x) => x.id === id).map((x) => x.c);

/* ---- D1: one blow wipes a minion group out (the engine: damage, minions n 6 left 0, broken) */
{
  const T = new Table(); T.hero("H1", "p1", { damage: 9 }).hero("H2", "p2").npc("S1", { kind: "minions", health: 6, maxHealth: 10, members: 6 }).npc("N1"); T.order(["H1", "S1", "H2", "N1"]);
  await T.req("p1", { op: "declare", actor: "H1", decl: { action: "slugfest", targets: ["S1"] } }); await settle(T);
  eq(T.events.filter((e) => ["minions", "broken"].includes(e.type) && e.target === "S1").map((e) => e.type), ["minions", "broken"], "D1: (the engine says minions, then broken, for the same target)");
  const facts = fold(T.events, whoOf(T)), downs = facts.filter((x) => x.k === "down");
  eq(downs.map((x) => [x.oc, x.n, x.mn, x.lf]), [["S1", 6, 1, 0]], "D1: one fact, the six members (the group's own broken does not overwrite it)");
  const s = P.tally(facts, { sides: (a) => (a === "A_S1" || a === "A_N1" ? "n" : "h") });
  eq([P.kd(P.sum(s.get("A_H1").t, s.get("A_H1").l)).k, s.get("A_S1").t.deaths], [6, 0], "D1: the window: K 6 for the hero, no defeat for the group");
  const pc = { H1: { a: "A_H1", n: "Omni", s: "h" }, H2: { a: "A_H2", n: "Kid", s: "h" }, S1: { a: "A_S1", n: "Soldiers", s: "n", mn: 1 }, N1: { a: "A_N1", n: "Thug", s: "n" } };
  const rec = { ...P.newFight("C1_f1", "C1", 900, "Dock"), t1: 9e9, pc };
  const row = (cid) => P.fightSummary(rec, facts).find((r) => r.cid === cid);
  eq([row("H1").minions, row("H1").kills, row("S1").deaths], [6, 0, 0], "D1: the fight card counts the same (6 members, the group never dead as one)");
  const acts = ["H1", "H2", "N1", "H2"].map((c, i) => F({ id: `a${i}`, k: "act", a: `A_${c}`, ac: c, nm: "slugfest" }));
  const r = TP.award(rec, [...acts, ...facts.map((x) => ({ ...x, f: "C1_f1" }))]);
  eq(r.titles.find((x) => x.id === "killer")?.n, 6, "D1: Killer: 6 put down");
  eq(r.titles.find((x) => x.id === "mvp")?.d?.kills, 6, "D1: MVP counts the six");
  /* the fallback of a combatant that left the Combat: the record says it was a group */
  const gone = P.factsOfEvent({ type: "broken", combat: "C1", fight: "f1", seq: 9, target: "S1" }, { who: (cid) => (cid === "S1" ? { a: "A_S1", side: "n", minion: pc.S1.mn === 1 } : null), pub: true });
  eq(gone.facts.length, 0, "D1: a group known only from the record is still a group");
  ok(/minion: p\.mn === 1/.test(read("stats/capture.mjs")) && /mn: 1/.test(read("stats/capture.mjs")), "D1: the record keeps that a participant is a group (pin)");
}

/* ---- D2: the first fight of a session: its record starts (round start, no fact) before the session's first fact */
{
  const H = 3600e3, t0 = 100 * H;
  const rec = { ...P.newFight("C1_f1", "C1", t0, "Dock"), t1: t0 + 600e3, pc: { H1: { a: "A_H1", n: "Anna", s: "h" } }, titles: [{ id: "lucky", c: "H1", a: "A_H1", n: 5 }], tm: { v: 1 } };
  const old = { ...P.newFight("C1_f0", "C1", 10 * H, "Dock"), t1: 10 * H + 5, pc: { H1: { a: "A_H1", n: "Anna", s: "h" } }, titles: [{ id: "mvp", c: "H1", a: "A_H1", n: 9 }], tm: { v: 1 } };
  const data = { actors: { A_H1: { n: "Anna", h: 1, own: ["p1"] } }, facts: [F({ id: "r0", k: "roll", a: "A_H1", ac: "H1", f: "C1_f0", t: 10 * H, n: 2, s: 1 }), F({ id: "r1", k: "roll", a: "A_H1", ac: "H1", t: t0 + 17000, n: 3, s: 1 })], fights: { C1_f1: rec, C1_f0: old } };
  for (const gm of [true, false]) {
    const v = M.view(data, { gm, id: gm ? "gm" : "p1" }, { tab: "chars", period: "session" }, names);
    eq(v.detail.titles.map((x) => `${x.id}:${x.n}`), ["lucky:1"], `D2 (${gm ? "GM" : "player"}): the session's first fight has its title under Session, the old one is not`);
  }
  eq(M.view(data, { gm: true }, { tab: "chars", period: "all" }, names).detail.titles.map((x) => x.id), ["mvp", "lucky"], "D2: all time: both");
}

/* ---- D3: no assist for a blow on somebody already down; one before the defeat stays an assist */
{
  const pc = { H1: { a: "A_H1", n: "Omni", s: "h" }, H2: { a: "A_H2", n: "Eve", s: "h" }, H3: { a: "A_H3", n: "Kid", s: "h" }, N1: { a: "A_N1", n: "Mauler", s: "n" } };
  const rec = { ...P.newFight("C1_f1", "C1", 900, "Dock"), t1: 9e9, pc };
  const facts = [...["H1", "H2", "H3", "N1"].map((c, i) => F({ id: `a${i}`, k: "act", a: `A_${c}`, ac: c, nm: "slugfest" })),
    F({ id: "d0", k: "dmg", a: "A_H3", ac: "H3", o: "A_N1", oc: "N1", tk: 2, t: 1000 }),
    F({ id: "d1", k: "dmg", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", tk: 16, t: 1100 }),
    F({ id: "x1", k: "down", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", fate: "broken", n: 1, t: 1100 }),
    F({ id: "d2", k: "dmg", a: "A_H2", ac: "H2", o: "A_N1", oc: "N1", tk: 2, t: 1500 })];
  const s = P.tally(facts, { sides: (a) => (a === "A_N1" ? "n" : "h") });
  eq([s.get("A_H3").t.assists, s.get("A_H2").t.assists], [1, 0], "D3: the window: an assist for the blow before the defeat, none for the blow on the broken Mauler");
  const g = TP.gather(rec, facts).rows;
  eq([g.get("H3").assists, g.get("H2").assists], [1, 0], "D3: the titles count assists the same way");
  eq([s.get("A_H1").t.dealt, s.get("A_N1").t.taken], [16, 20], "D3 (FXQ2-2): damage is the number the table read (after Armor, overkill and a blow on the broken included), as the news and the card");
}

/* ---- D4: a friendly unowned NPC (the fight's side h) puts a foe down: the window, the card and the titles agree */
{
  const pc = { H1: { a: "A_H1", n: "Anna", s: "h" }, AL: { a: "A_AL", n: "Ally", s: "h" }, N1: { a: "A_N1", n: "Thug", s: "n" } };
  const rec = { ...P.newFight("C1_f1", "C1", 900, "Dock"), t1: 5000, pc };
  const facts = [...["H1", "AL", "H1", "AL", "N1"].map((c, i) => F({ id: `a${i}`, k: "act", a: `A_${c}`, ac: c, nm: "slugfest" })),
    F({ id: "d1", k: "dmg", a: "A_AL", ac: "AL", o: "A_N1", oc: "N1", tk: 5 }), F({ id: "x1", k: "down", a: "A_AL", ac: "AL", o: "A_N1", oc: "N1", fate: "broken", n: 1, t: 1100 })];
  const data = { actors: { A_H1: { n: "Anna", h: 1, own: ["p1"] }, A_AL: { n: "Ally", h: 0, own: [] }, A_N1: { n: "Thug", h: 0, own: [] } }, facts, fights: { C1_f1: rec } };
  const v = M.view(data, { gm: true }, { tab: "chars", period: "all", side: "n", sel: "A_AL" }, names);
  const card = P.fightSummary(rec, facts).find((r) => r.cid === "AL");
  eq([v.detail.id, v.detail.kd.k, card.kills, holder(TP.award(rec, facts), "killer")], ["A_AL", 1, 1, ["AL"]], "D4: the window's K, the card and Killer all count Ally's kill");
  eq(M.view(data, { gm: true }, { tab: "chars", period: "all", side: "n", sel: "A_N1" }, names).detail.kd.d, 1, "D4: the Thug's defeat");
  ok(!M.view(data, { gm: false, id: "p1" }, { tab: "chars", period: "all" }, names).rail.some((x) => x.id === "A_AL"), "D4 (FXQ2-1): a player's Characters still list player characters only");
  const loose = P.tally([{ id: "l1", k: "down", m: "l", t: 1, a: "A_AL", o: "A_N1", fate: "broken", n: 1 }], { sides: (a) => (a === "A_H1" ? "h" : "n"), fights: { C1_f1: rec } });
  eq(loose.get("A_AL")?.l.kills ?? 0, 0, "D4: a loose fact (no fight) keeps the registry's sides");
}

/* ---- D5: a fight the GM stopped is closed with who went down */
{
  const facts = [F({ id: "x1", k: "down", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", fate: "broken", n: 1, t: 1100 }), F({ id: "x2", k: "down", a: "A_H1", ac: "H1", o: "A_S1", oc: "S1", fate: "dead", n: 4, mn: 1, lf: 2, t: 1200 }),
    F({ id: "x3", k: "down", a: "A_H1", ac: "H1", o: "A_S2", oc: "S2", fate: "dead", n: 3, mn: 1, lf: 0, t: 1300 }), F({ id: "x4", k: "down", a: "A_H1", ac: "H1", o: "A_N2", oc: "N2", fate: "dead", n: 1, t: 1400, f: "C1_other" })];
  eq(P.outsOf(facts, "C1_f1"), { N1: "broken", S2: "dead" }, "D5: the facts say who stayed down (a group only with nobody left; another fight not)");
  globalThis.game = { journal: new Map(), users: [], i18n: { localize: (k) => (k === "COMBAT.RollsInitiative" ? "{name} rolls for Initiative!" : k) } };
  const C = await import("../stats/capture.mjs");
  const Store = await import("../stats/store.mjs");
  Store.put(facts);
  const rec = { ...P.newFight("C1_f1", "C1", 900, "Dock"), pc: { N1: { a: "A_N1", n: "Mauler", s: "n" }, S2: { a: "A_S2", n: "Soldiers", s: "n" }, H1: { a: "A_H1", n: "Omni", s: "h" } } };
  const closed = C._test.closeRec(rec, null, null);
  eq([closed.pc.N1.out, closed.pc.S2.out, closed.pc.H1.out ?? null, typeof closed.t1], ["broken", "dead", null, "number"], "D5: closed without the state: the outcomes come from the facts (queued ones too)");
  const src = read("stats/capture.mjs");
  ok(/raw === ""\) \{ endFights\(combat, lastState\.get\(combat\.id\)/.test(src) && /if \(state\) lastState\.set\(ev\.combat, state\)/.test(src), "D5: the Stop closes the record with the state as it stood last (pin)");
  /* ---- D7: an initiative roll of a Foundry combat */
  eq([C._test.isInitiative({ flags: { core: { initiativeRoll: true } } }), C._test.isInitiative({ flavor: "Atom Eve rolls for Initiative!" }), C._test.isInitiative({ flavor: "Fighting" }), C._test.isInitiative({ flavor: "" })], [true, true, false, false], "D7: Foundry's initiative card (its flag, or its flavour) is recognised");
  ok(/if \(isInitiative\(message\)\) return null;/.test(src), "D7: and is never counted as a loose roll (pin)");
  /* ---- D9: the registry is compared with the store, not with a memory of the page */
  ok(!/actorsSeen/.test(src) && /const was = Store\.actorRec\(id\)/.test(src), "D9: after a reset every actor's registry line is written again (pin)");
  delete globalThis.game;
}

/* ---- D6: the GM's Health correction to 0 */
{
  const T = new Table(); T.hero("H1", "p1").npc("N1"); T.order(["H1", "N1"]);
  eq((await T.gm({ op: "setHealth", combatant: "H1", value: 0 })).ok, true, "D6: (Health set to 0)");
  const ev = T.events.find((e) => e.type === "healthSet");
  eq([ev?.target, ev?.out, typeof ev?.itx, "taken" in (ev ?? {}), "to" in (ev ?? {})], ["H1", "broken", "string", false, false], "D6: the engine says it, with its transaction and no number");
  let facts = fold(T.events, whoOf(T));
  eq(facts.filter((x) => x.k === "down").map((x) => [x.oc, x.fate, x.a ?? null]), [["H1", "broken", null]], "D6: a defeat by nobody");
  eq(P.tally(facts, {}).get("A_H1").t.deaths, 1, "D6: Kid's D is 1");
  await T.gm({ op: "setHealth", combatant: "H1", value: 0 });
  eq(T.events.filter((e) => e.type === "healthSet").length, 1, "D6: a second 0 (already broken) is no second defeat");
  await T.gm({ op: "undo", tx: ev.itx });
  facts = fold(T.events, whoOf(T));
  eq(facts.filter((x) => x.k === "down").length, 0, "D6: the undo of the correction takes the defeat back");
  const G = new Table(); G.hero("H1", "p1").npc("S1", { kind: "minions", health: 4, maxHealth: 10, members: 4 }); G.order(["H1", "S1"]);
  await G.gm({ op: "setHealth", combatant: "S1", value: 0 });
  eq(fold(G.events, whoOf(G)).filter((x) => x.k === "down").length, 0, "D6: a group set to 0 is no defeat of one");
}

/* ---- D8: Medic and Final Blow */
{
  const self = P.factsOfEvent({ type: "actionDeclared", combat: "C1", fight: "f1", seq: 1, inst: "i1", actor: "H1", decl: { action: "heal" }, targets: [] }, { who: (c) => ({ a: `A_${c}` }), pub: true }).facts[0];
  const other = P.factsOfEvent({ type: "actionDeclared", combat: "C1", fight: "f1", seq: 2, inst: "i2", actor: "H1", decl: { action: "heal" }, targets: ["H2"] }, { who: (c) => ({ a: `A_${c}` }), pub: true }).facts[0];
  const own = P.factsOfEvent({ type: "actionDeclared", combat: "C1", fight: "f1", seq: 3, inst: "i3", actor: "H1", decl: { action: "heal" }, targets: ["H1"] }, { who: (c) => ({ a: `A_${c}` }), pub: true }).facts[0];
  eq([self.sf, other.sf, own.sf], [1, undefined, 1], "D8: an action aimed at nobody but its doer is marked");
  const pc = { H1: { a: "A_H1", n: "Anna", s: "h" }, H2: { a: "A_H2", n: "Bolek", s: "h" }, N1: { a: "A_N1", n: "Thug", s: "n" }, N2: { a: "A_N2", n: "Brute", s: "n" } };
  const rec = { ...P.newFight("C1_f1", "C1", 900, "Dock"), t1: 5000, pc };
  const acts = ["H1", "H2", "N1", "N2"].map((c, i) => F({ id: `a${i}`, k: "act", a: `A_${c}`, ac: c, nm: "slugfest" }));
  const heal = (x) => [F({ id: "hh", k: "act", a: "A_H1", ac: "H1", nm: "heal", i: "I9", ...x }), F({ id: "hr", k: "roll", a: "A_H1", ac: "H1", i: "I9", n: 3, s: 1 })];
  eq([holder(TP.award(rec, [...acts, ...heal({ sf: 1 })]), "medic"), holder(TP.award(rec, [...acts, ...heal({})]), "medic")], [[], ["H1"]], "D8: a heal of oneself is no Medic help; a heal of an ally is");
  const downs = [F({ id: "x1", k: "down", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", fate: "broken", n: 1, t: 1100 }), F({ id: "x2", k: "down", a: "A_H2", ac: "H2", o: "A_N2", oc: "N2", fate: "broken", n: 1, t: 1200 })];
  const fin = (more) => holder(TP.award({ ...rec, pc: { ...pc, ...more } }, [...acts, ...downs]), "finisher");
  eq(fin({}), ["H2"], "D8: every foe down: Final Blow");
  eq(fin({ N3: { a: "A_N3", n: "Turret", s: "n" } }), [], "D8: a foe the table saw still stands (the fight was stopped): no Final Blow");
  eq([fin({ N3: { a: "A_N3", n: "Turret", s: "n", hid: 1 } }), fin({ N3: { a: "A_N3", n: "Hostage", s: "n", nh: 1 } }), fin({ N3: { a: "A_N3", n: "Hostages", s: "n", ty: "challenge" } }), fin({ N3: { a: "A_N3", n: "Turret", s: "n", out: "broken" } })],
    [["H2"], ["H2"], ["H2"], ["H2"]], "D8 (FXQ2-3): a hidden foe, a bystander, a challenge, or a foe the record says is out does not hold it back");
  ok(/nh: 1/.test(read("stats/capture.mjs")) && /ty === "challenge" \|\| ty === "vehicle"/.test(read("stats/capture.mjs")), "D8: the record keeps a bystander and a challenge (pin)");
}

/* ---- D9: reset makes the journal again with the chat's newest card as the high-water mark */
{
  const st = read("stats/store.mjs"), body = st.slice(st.indexOf("export async function reset"));
  ok(/await ensure\(hw\)/.test(body) && /game\.messages/.test(body) && /async function ensure\(hw = 0\)/.test(st), "D9: a reset is not counted again from the chat at the next GM load (pin)");
}

/* ---- D10: no empty fight */
{
  const recs = { a: { ...P.newFight("a", "C", 1), pc: {} }, b: { ...P.newFight("b", "C", 2), pc: { H1: { a: "A", n: "A", s: "h" } } } };
  eq([P.fightsFor(recs, [], { gm: true }).map((r) => r.f), P.fightsFor(recs, [], { gm: false }).map((r) => r.f)], [["b"], ["b"]], "D10: a record nobody is named in is listed to nobody");
  ok(/early\.set\(f, rec\); continue;/.test(read("stats/capture.mjs")), "D10: and is not written until somebody is named (pin)");
}

/* ---- D11: the warning of a GM who is not the active GM */
{
  const app = read("stats/app.mjs");
  ok(!/warn\("The active GM/.test(app) && /t\("IPU\.Stats\.fight\.deleteWriter"\)/.test(app), "D11: no English literal: the string of the language");
  ok(L.tIn("en", "IPU.Stats.fight.deleteWriter") !== "IPU.Stats.fight.deleteWriter" && L.tIn("pl", "IPU.Stats.fight.deleteWriter") !== L.tIn("en", "IPU.Stats.fight.deleteWriter"), "D11: in both languages");
}

/* ---- D12: a player's session boundary is found among the facts the player may see */
{
  const H = 3600e3;
  const facts = [{ id: "a", k: "roll", m: "l", t: 1, a: "A_H1", n: 1, s: 1 }, { id: "b", k: "roll", m: "l", t: 1 + 3 * H, a: "A_N1", n: 1, v: 1 }, { id: "c", k: "roll", m: "l", t: 1 + 6 * H, a: "A_H1", n: 1, s: 1 }];
  const data = { actors: { A_H1: { n: "Anna", h: 1, own: ["p1"] }, A_N1: { n: "Thug", h: 0, own: [] } }, facts, fights: {} };
  const rolls = (vw) => M.view(data, vw, { tab: "chars", period: "session" }, names).detail.groups[0].rows.find((r) => r.id === "rolls").cells[2];
  eq([rolls({ gm: true }), rolls({ gm: false, id: "p1" })], ["2", "1"], "D12: the GM's GM-only roll bridges the GM's session, never the player's");
}
done("check-fxq2");
