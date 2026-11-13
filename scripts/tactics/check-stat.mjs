/* node scripts/tactics/check-stat.mjs -- package STAT: the statistics (scripts/stats/) and the Plus Ultra menu (scripts/menu.mjs).
   A. facts of the engine's events (real fights through testkit's Table: an attack, its undo, an aborted action);
   B. the sums (hits, misses, damage, armor, block / dodge, stress, K/D/A, one defeat per target per fight, friendly fire, minions);
   C. loose rolls (push replaces, GM-only rolls, damage cards and defeats); D. who sees what (players: no GM-only fact, no hidden
   participant, no NPC rail; titles filtered); E. periods; F. strings; G. the source pins (itx on every event, the minions event, the
   one import line, the menu tool, the store never in the sidebar). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Table, ok, eq, done } from "./testkit.mjs";
import * as P from "../stats/pure.mjs";
import * as M from "../stats/model.mjs";
import * as L from "../stats/lang.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", f), "utf8");
const decl = (actor, action, targets, extra = {}) => ({ op: "declare", actor, decl: { action, targets, ...extra } });
const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
/* the capture's own fold over a list of events: facts by id, undo / abort drop */
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
const sides = (aid) => (aid.startsWith("A_N") ? "n" : "h");

/* ---- A. real fights through the engine */
{
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.order(["H1", "N1", "H2", "N2"]);
  eq((await T.req("p1", decl("H1", "slugfest", ["N1"]))).ok, true, "A: the attack is declared");
  await pass(T);
  await T.roll("attack", 2);
  await T.req("p1", { op: "answer", prompt: T.prompt("stunts").id, value: ["doubleDamage@N1"] });
  await pass(T);
  ok(T.events.length > 0 && T.events.filter((e) => e.inst).every((e) => typeof e.itx === "string" && e.itx.length > 0), "A: every event of an action carries the transaction of its instance (itx)");
  const f1 = fold(T.events, whoOf(T));
  const kinds = f1.map((x) => x.k).sort();
  ok(kinds.includes("act") && kinds.includes("roll") && kinds.includes("hit"), `A: the attack gives an action, a roll and a hit (${kinds.join(",")})`);
  const roll = f1.find((x) => x.k === "roll" && x.atk);
  eq([roll?.a, roll?.s, roll?.m, roll?.f], ["A_H1", 2, "t", "C1_f1"], "A: the attack roll is H1's, two sixes, tactical, in its fight");
  const hit = f1.find((x) => x.k === "hit");
  eq([hit?.a, hit?.o, hit?.h], ["A_H1", "A_N1", 1], "A: the hit is H1's on N1");
  const dmg = f1.find((x) => x.k === "dmg");
  ok(dmg && dmg.a === "A_H1" && dmg.o === "A_N1" && dmg.tk > 0, "A: the damage is dealt by H1 to N1");
  const s1 = P.tally(f1, { sides });
  eq([s1.get("A_H1")?.t.hits, s1.get("A_H1")?.t.attacks, s1.get("A_H1")?.t.dealt > 0, s1.get("A_N1")?.t.taken === s1.get("A_H1")?.t.dealt], [1, 1, true, true], "A: the sums of the attack");
  /* the same events twice (a reload, a second tab) are the same facts */
  eq(fold([...T.events, ...T.events], whoOf(T)).length, f1.length, "A: an event seen twice counts once (deterministic ids)");
  /* undo: the GM takes the attack back; every fact of its transaction goes */
  const tx = T.log.list.at(-1);
  eq((await T.gm({ op: "undo", tx: tx.id })).ok, true, "A: undo");
  ok(T.events.some((e) => e.type === "undo" && e.tx === tx.id), "A: the engine said undo");
  const f2 = fold(T.events, whoOf(T));
  eq(f2.filter((x) => x.x === P.safe(tx.id)).length, 0, "A: after the undo no fact of the attack is left");
  eq(P.tally(f2, { sides }).get("A_H1")?.t.attacks ?? 0, 0, "A: an undone attack is no statistic");
  /* an action declared and cancelled before the roll (aborted): its facts go */
  T.turn("H2");
  await T.req("p2", decl("H2", "slugfest", ["N2"]));
  const inst = T.state.stack.at(-1)?.id;
  ok(fold(T.events, whoOf(T)).some((x) => x.i === P.safe(inst) && x.k === "act"), "A: a declared action is counted while it stands");
  await T.req("p2", { op: "cancel", inst });
  ok(T.events.some((e) => e.type === "actionClosed" && e.inst === inst && e.summary?.status === "aborted"), "A: a cancelled action closes aborted");
  eq(fold(T.events, whoOf(T)).filter((x) => x.i === P.safe(inst)).length, 0, "A: an aborted action leaves no fact");
  /* GM-only: an event the public stream did not carry is a GM-only fact */
  const f3 = fold(T.events.slice(0, T.events.findIndex((e) => e.type === "undo")), whoOf(T), () => false);
  ok(f3.length > 0 && f3.every((x) => x.v === 1), "A: facts of an event the table did not see are GM-only");
}

/* ---- B. the sums */
{
  const F = (x) => ({ m: "t", f: "C1_f1", t: 1000, ...x });
  const facts = [
    F({ id: "a1", k: "hit", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", h: 1 }),
    F({ id: "a2", k: "hit", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", h: 0, df: "block" }),
    F({ id: "a3", k: "hit", a: "A_N1", ac: "N1", o: "A_H1", oc: "H1", h: 0, df: "dodge" }),
    F({ id: "a4", k: "hit", a: "A_N1", ac: "N1", o: "A_H1", oc: "H1", h: 0 }),
    F({ id: "d1", k: "dmg", a: "A_H2", ac: "H2", o: "A_N1", oc: "N1", tk: 3, ar: 1 }),
    F({ id: "d2", k: "dmg", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", tk: 4, t: 1001 }),
    F({ id: "s1", k: "str", a: "A_N1", ac: "N1", o: "A_H1", oc: "H1", n: 2 }),
    F({ id: "s2", k: "str", o: "A_H1", oc: "H1", n: 1, own: 1 }),
    F({ id: "x1", k: "down", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", fate: "broken", n: 1, t: 1002 }),
    F({ id: "x2", k: "down", a: "A_H2", ac: "H2", o: "A_N1", oc: "N1", fate: "dead", n: 1, t: 1003 }),      // the same target later in the same fight: one defeat
    F({ id: "x3", k: "down", a: "A_H1", ac: "H1", o: "A_H2", oc: "H2", fate: "broken", n: 1, t: 1004 }),     // friendly fire: no kill
    F({ id: "x4", k: "down", a: "A_H2", ac: "H2", o: "A_M1", oc: "M1", fate: "unconscious", n: 3, mn: 1, t: 1005 }),
    F({ id: "r1", k: "act", a: "A_H1", ac: "H1", nm: "slugfest", st: 1 }),
    F({ id: "r2", k: "rx", a: "A_H1", ac: "H1", nm: "dodge", st: 1 }),
    F({ id: "c1", k: "crit", a: "A_H1", ac: "H1", o: "A_N2", oc: "N2" }),
    F({ id: "st1", k: "stunt", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", nm: "knockback" })
  ];
  const s = P.tally(facts, { sides: (a) => (a.startsWith("A_H") ? "h" : "n") });
  const h1 = s.get("A_H1").t, h2 = s.get("A_H2").t, n1 = s.get("A_N1").t;
  eq([h1.attacks, h1.hits, h1.misses], [2, 1, 1], "B: H1 attacks, hits, misses");
  eq([n1.blocked, h1.dodged, h1.missedMe], [1, 1, 1], "B: a block, a dodge and a plain miss on the defender's side");
  eq([h2.dealt, h1.dealt, n1.taken, n1.armor], [3, 4, 7, 1], "B: damage dealt, taken, and what Armor stopped");
  eq([h1.stressIn, h1.stressOut], [2, 1 + 1 + 1], "B: stress taken from others; stress paid (own power, action, reaction)");
  eq([h1.kills, h2.kills, h2.minions, n1.deaths, h2.deaths], [1, 0, 3, 1, 1], "B: one defeat per target per fight (the first), minions counted by members, friendly fire no kill");
  eq(h2.assists, 1, "B: H2 hurt N1 that H1 defeated: an assist");
  eq(P.kd(P.sum(h1, P.blank())), { k: 1, d: 0, a: 0, ratio: 1 }, "B: K/D of H1");
  eq(P.kd(P.sum(h2, P.blank())), { k: 3, d: 1, a: 1, ratio: 3 }, "B: K/D of H2 (minions count)");
  eq([h1.acts, h1.rx, h1.stunts, h1.critsDealt, h1.actions.slugfest, h1.actions["rx:dodge"], h1.stuntsBy.knockback], [1, 1, 1, 1, 1, 1, 1], "B: actions, reactions, stunts, criticals and what they were");
  eq(h1.fights, 1, "B: fights taken part in");
  /* the fight's summary as the table's card counts it */
  const rec = { ...P.newFight("C1_f1", "C1", 900, "Warehouse"), t1: 2000, r: 3, pc: { H1: { a: "A_H1", n: "Hero", s: "h" }, H2: { a: "A_H2", n: "Kid", s: "h" }, N1: { a: "A_N1", n: "Thug", s: "n", out: "dead" }, N2: { a: "A_N2", n: "Turret", s: "n", hid: 1, out: "unconscious" }, M1: { a: "A_M1", n: "Soldiers", s: "n" } } };
  const gm = P.fightSummary(rec, facts, { gm: true }), pl = P.fightSummary(rec, facts, { gm: false, id: "p1" });
  ok(gm.some((r) => r.cid === "N2") && !pl.some((r) => r.cid === "N2"), "B: a participant hidden at the end is in the GM's summary only");
  const thug = pl.find((r) => r.cid === "N1"), hero = pl.find((r) => r.cid === "H1");
  eq([thug?.taken, thug?.out, hero?.dealt, hero?.hits, hero?.attacks, hero?.kills], [7, "dead", 4, 1, 2, 1], "B: the summary rows");
}

/* ---- C. loose rolls */
{
  const r0 = P.factOfRoll({ id: "m1", actorId: "A1", userId: "p1", time: 1000, mode: "public", flavor: "Fighting", roll: { successCount: 0, baneCount: 0, pushCount: 0, dice: [1, 2, 3], attackDamage: 2 } });
  eq([r0.k, r0.m, r0.n, r0.atk, r0.v], ["roll", "l", 3, 1, undefined], "C: a public loose attack roll");
  const r1 = P.factOfRoll({ id: "m2", actorId: "A1", userId: "p1", time: 5000, mode: "public", flavor: "Fighting", roll: { successCount: 1, baneCount: 1, pushCount: 1, dice: [6, 1, 3], attackDamage: 2 } });
  eq(P.pushParent([r0], r1, [r0.id]), r0.id, "C: a pushed roll replaces the roll it re-threw");
  eq(P.pushParent([r0], { ...r1, u: "p2" }, []), null, "C: never another user's roll");
  const s = P.tally([r1], {}).get("A1").l;
  eq([s.rolls, s.sixes, s.pushes, s.attacks, s.hits, s.ones], [1, 1, 1, 1, 1, 1], "C: the pushed roll counts once, with its push; a loose attack with a six is a hit");
  const g = P.factOfRoll({ id: "m3", actorId: "A1", userId: "p1", time: 1, mode: "gm", roll: { successCount: 2, dice: [6, 6] } });
  const b = P.factOfRoll({ id: "m4", actorId: "A1", userId: "p1", time: 1, mode: "blind", roll: { successCount: 2, dice: [6, 6] } });
  eq([P.visible(g, { gm: false, id: "p1" }), P.visible(g, { gm: false, id: "p2" }), P.visible(b, { gm: false, id: "p1" }), P.visible(b, { gm: true })], [true, false, false, true], "C: a GM-roll is its author's and the GM's; a blind roll the GM's only");
  const dc = P.factsOfDamageCard({ id: "m5", actorId: "A2", attackerId: "A1", amount: 4, from: 4, to: 0, time: 9, mode: "public" });
  eq(dc.map((x) => x.k), ["dmg", "down"], "C: a Damage Taken card that broke its target is damage and a defeat");
  const sc = P.tally(dc, { sides: (a) => (a === "A1" ? "h" : "n") });
  eq([sc.get("A1").l.dealt, sc.get("A1").l.kills, sc.get("A2").l.taken, sc.get("A2").l.deaths], [4, 1, 4, 1], "C: loose damage and K/D");
  eq(P.factsOfDamageCard({ id: "m6", actorId: "A2", amount: 1, from: 5, to: 4, mode: "gm" }).map((x) => [x.k, x.v, x.a]), [["dmg", 1, undefined]], "C: a GM-only card without attacker");
}

/* ---- D. the model: who is listed */
{
  const names = { t: L.t, attr: (x) => x, action: (x) => x, stunt: (x) => x, out: (x) => x, user: (id) => ({ p1: "Gracz 1" })[id] ?? null, players: () => [{ id: "p1", name: "Gracz 1" }, { id: "p2", name: "Gracz 2" }], when: () => "t" };
  const data = {
    actors: { A_H1: { n: "Hero", h: 1, own: ["p1"] }, A_N1: { n: "Thug", h: 0, own: [] } },
    facts: [{ id: "r1", k: "roll", m: "l", t: 10, a: "A_H1", n: 3, s: 1 }, { id: "r2", k: "roll", m: "l", t: 11, a: "A_N1", n: 3, s: 2, v: 1 }, { id: "r3", k: "roll", m: "l", t: 12, a: "A_H1", n: 2, s: 2, v: 1 }],
    fights: { C1_f1: { ...P.newFight("C1_f1", "C1", 5, "Warehouse"), t1: 9, pc: { N9: { a: "A_N1", n: "Hidden", s: "n", hid: 1 } }, titles: [{ id: "mvp", c: "N9" }, { id: "gm", v: 1 }] }, C1_f2: { ...P.newFight("C1_f2", "C1", 6, "Dock"), t1: 9, pc: { H1: { a: "A_H1", n: "Hero", s: "h" }, N9: { a: "A_N1", n: "Hidden", s: "n", hid: 1 } }, titles: [{ id: "mvp", c: "H1" }, { id: "x", c: "N9" }, { id: "gm", v: 1 }] } }
  };
  const pv = M.view(data, { gm: false, id: "p2" }, { tab: "chars", period: "all" }, names);
  eq(pv.rail.map((x) => x.id), ["A_H1"], "D: a player sees the player characters, no NPC");
  const rolls = pv.detail.groups.find((g) => g.id === "rolls").rows.find((r) => r.id === "rolls").cells;
  eq(rolls, ["0", "1", "1"], "D: the player's numbers leave the GM-only roll out");
  const gv = M.view(data, { gm: true, id: "gm" }, { tab: "chars", period: "all", side: "n" }, names);
  eq(gv.rail.map((x) => x.id), ["A_N1"], "D: the GM's NPC switch lists the NPCs");
  const gh = M.view(data, { gm: true, id: "gm" }, { tab: "chars", period: "all", side: "h" }, names);
  eq(gh.detail.groups.find((g) => g.id === "rolls").rows.find((r) => r.id === "rolls").cells, ["0", "2", "2"], "D: the GM counts every roll");
  const pf = M.view(data, { gm: false, id: "p1" }, { tab: "fights" }, names);
  eq(pf.rail.map((x) => x.id), ["C1_f2"], "D: a player does not list a fight where only hidden ones took part");
  eq(pf.detail.titles.map((x) => x.id), ["mvp"], "D: a player gets no title of a hidden participant and no GM-only title");
  ok(!("N9" in pf.detail.rec.pc), "D: a player's copy of the record has no hidden participant");
  const gf = M.view(data, { gm: true, id: "gm" }, { tab: "fights", sel: "C1_f2" }, names);
  eq(gf.detail.titles.length, 3, "D: the GM gets every title");
  const pp = M.view(data, { gm: false, id: "p1" }, { tab: "players", period: "all" }, names);
  eq([pp.rail.map((x) => x.id), pp.detail.groups[0].rows[0].cells[2]], [["p1"], "1"], "D: a player is listed with the characters they own");
  ok(pv.detail.groups.flatMap((g) => g.rows).find((r) => r.id === "rolls").cells[1] === "1", "D: the loose column");
  const nl = M.view({ actors: {}, facts: [], fights: {} }, { gm: false }, { tab: "chars" }, names);
  ok(typeof nl.empty === "string" && nl.empty.length > 10, "D: an empty world says what fills it");
  const g = M.groupsOf(P.blank(), P.blank(), names);
  ok(g.flatMap((x) => x.rows).every((r) => ["rolls", "attacks", "dealt", "taken", "kills", "deaths"].includes(r.id)), "D: zero rows are left out except the core ones");
  ok(g.flatMap((x) => x.rows).find((r) => r.id === "kills").cells[1] === "0", "D: kills are counted loose too");
}

/* ---- E. periods */
{
  const H = 3600 * 1000;
  const f = [1, 2, 10, 11].map((h, i) => ({ id: `x${i}`, k: "roll", m: "l", a: "A", t: h * H }));
  eq(P.sessionStart(f), 10 * H, "E: a session starts after a four-hour break");
  eq(P.inPeriod(f, "session").length, 2, "E: the session's facts");
  eq(P.inPeriod(f, "all").length, 4, "E: all time");
}

/* ---- F. strings */
{
  const en = Object.keys(L.EN), pl = Object.keys(L.PL);
  eq(en.filter((k) => !pl.includes(k)), [], "F: every English string has a Polish one");
  eq(pl.filter((k) => !en.includes(k)), [], "F: no Polish string without an English one");
  const ph = (s) => [...new Set([...s.matchAll(/\{(\w+)[|}]/g)].map((m) => m[1]))].sort().join(",");
  eq(en.filter((k) => ph(L.EN[k]) !== ph(L.PL[k])), [], "F: the same placeholders in both languages");
  eq([L.tIn("pl", "IPU.Stats.fight.rounds", { n: 1 }), L.tIn("pl", "IPU.Stats.fight.rounds", { n: 3 }), L.tIn("pl", "IPU.Stats.fight.rounds", { n: 5 }), L.tIn("en", "IPU.Stats.fight.rounds", { n: 2 })], ["1 runda", "3 rundy", "5 rund", "2 rounds"], "F: counted words");
}

/* ---- G. source pins */
{
  const ep = read("tactics/engine-pure.mjs"), kit = read("tactics/flows/kit.mjs"), mod = read("module.js"), menu = read("menu.mjs"), main = read("stats/main.mjs"), store = read("stats/store.mjs"), css = fs.readFileSync(path.join(here, "..", "..", "styles", "sheet-plus.css"), "utf8");
  ok(/at: X\.host\.now\(\), \.\.\.\(inst\?\.tx \? \{ itx: inst\.tx \} : \{\}\) \}\);/.test(ep), "G: emit tags every event of an instance with its transaction");
  ok(/R\.events\.push\(\{ type: "minions", target: t, n: dm\.minions\.removed/.test(kit), "G: a minion group's losses are an event");
  eq((mod.match(/import\(\s*["']\.\/stats\/main\.mjs["']\s*\)/g) ?? []).length, 1, "G: module.js loads the statistics with one guarded import");
  ok(/getSceneControlButtons/.test(menu) && /button: true/.test(menu) && !/layer:/.test(menu), "G: the menu is a scene-controls group of buttons that takes no canvas layer");
  ok(/Menu\.add\(\{ name: "stats"/.test(main), "G: the statistics are the menu's first tool");
  ok(/renderJournalDirectory", Store\.hideInDirectory/.test(main) && /data-entry-id/.test(store), "G: the store's journal never shows in the Journals sidebar");
  ok(/@import url\("stats\.css"\)/.test(css), "G: the stylesheet is loaded");
  ok(/options\?\.deleteAll\) return/.test(read("stats/capture.mjs")), "G: clearing the chat takes no statistic back");
  ok(/roll\.options\?\.tactics/.test(read("stats/capture.mjs")), "G: a tactical roll card is never counted again as a loose one");
  /* live 2026-11-13: one shared options object was filled by Foundry (parent) on the first page write, and every later journal update
     failed as an "embedded" one: fight records and registry lines were lost while the facts were kept */
  ok(/const OPT = \(\) => \(\{/.test(store) && !/[,(]\s*OPT\s*\)/.test(store) && !/\.\.\.OPT\s*\}/.test(store), "G: every journal write gets a fresh options object");
}
done("check-stat");
