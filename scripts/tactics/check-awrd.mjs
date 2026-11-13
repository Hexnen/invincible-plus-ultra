/* node scripts/tactics/check-awrd.mjs -- package AWRD: the titles of a fight (scripts/stats/titles-pure.mjs and its surfaces).
   A. the move fact (Mr Everywhere's measure) from a real move through the engine; B. every title from facts (who wins, the least number,
   ties shared, a title everybody shares is none); C. honesty: GM-only facts, participants hidden at the end, an NPC's Armor, NPCs only
   Nemesis; D. undone / aborted actions (no facts) and a small fight; E. a real fight through testkit's Table (attacks, an undo);
   F. the card and history models (cardOf, collected, model.view titles); G. strings; H. source pins (writer only, the card's tab,
   setTitles meta, the window's section). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Table, ok, eq, done } from "./testkit.mjs";
import { MTable } from "./check-kit-map.mjs";
import * as P from "../stats/pure.mjs";
import * as TP from "../stats/titles-pure.mjs";
import * as M from "../stats/model.mjs";
import * as L from "../stats/lang.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", f), "utf8");
const fold = (events, who, pub = () => true) => {
  const facts = new Map();
  for (const ev of events) {
    const out = P.factsOfEvent({ combat: "C1", fight: "f1", ...ev }, { who, pub: pub(ev) });
    if (out.drop) for (const id of P.idsToDrop([...facts.values()], out.drop)) facts.delete(id);
    for (const x of out.facts) facts.set(x.id, x);
  }
  return [...facts.values()];
};
const whoOf = (T) => (cid) => (T.c[cid] ? { a: `A_${cid}`, side: T.c[cid].npc ? "n" : "h", minion: T.c[cid].kind === "minions" } : null);
const ids = (r) => r.titles.map((x) => `${x.id}:${x.c}`);
const holder = (r, id) => r.titles.filter((x) => x.id === id).map((x) => x.c);

/* ---- A. the move fact */
{
  const T = new MTable(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }); T.put("H1", "z1").put("H2", "z1").put("N1", "z4"); T.order(["H1", "N1", "H2"]);
  eq((await T.req("p1", { op: "move", actor: "H1", to: "z2" })).ok, true, "A: (a move)");
  const mv = fold(T.events, whoOf(T)).filter((x) => x.k === "mv");
  eq(mv.map((x) => [x.a, x.ac, x.n, x.m]), [["A_H1", "H1", 1, "t"]], "A: the move is one mv fact: who and how many zones");
  eq(P.cleanFact("x", { k: "mv", m: "t", t: 1 })?.k, "mv", "A: the store keeps an mv fact");
  eq(P.factsOfEvent({ type: "move", combat: "C1", fight: "f1", seq: 3, combatant: "H1", zones: 0 }, { who: () => ({ a: "A" }), pub: true }).facts.length, 0, "A: a move of no zone is nothing");
  const s = P.tally(mv, {});
  eq(s.get("A_H1")?.t.rolls, 0, "A: the sums are not touched by a move");
}

/* ---- B. the titles from facts */
const F = (x) => ({ m: "t", f: "C1_f1", t: 1000, ...x });
const pc = { H1: { a: "A_H1", n: "Anna", s: "h" }, H2: { a: "A_H2", n: "Bolek", s: "h" }, H3: { a: "A_H3", n: "Cela", s: "h" }, N1: { a: "A_N1", n: "Thug", s: "n" }, N2: { a: "A_N2", n: "Brute", s: "n" }, NH: { a: "A_NH", n: "Shadow", s: "n", hid: 1 } };
const rec = { ...P.newFight("C1_f1", "C1", 900, "Dock"), t1: 5000, pc };
const acts = ["H1", "H2", "H3", "N1"].map((c, i) => F({ id: `act${i}`, k: "act", a: `A_${c}`, ac: c, nm: "slugfest" }));
const base = [
  ...acts,
  F({ id: "h1", k: "hit", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", h: 1 }),
  F({ id: "d1", k: "dmg", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", tk: 6, ar: 3 }),               // an NPC's Armor never counts
  F({ id: "d2", k: "dmg", a: "A_H2", ac: "H2", o: "A_N1", oc: "N1", tk: 2 }),
  F({ id: "x1", k: "down", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", fate: "broken", n: 1, t: 1100 }),
  F({ id: "x2", k: "down", a: "A_H2", ac: "H2", o: "A_N2", oc: "N2", fate: "unconscious", n: 1, t: 1200 }),
  F({ id: "n1", k: "dmg", a: "A_N2", ac: "N2", o: "A_H3", oc: "H3", tk: 4, ar: 2 }),
  F({ id: "n2", k: "hit", a: "A_N2", ac: "N2", o: "A_H3", oc: "H3", h: 0, df: "block" }),
  F({ id: "n3", k: "hit", a: "A_N1", ac: "N1", o: "A_H2", oc: "H2", h: 0, df: "dodge" }),
  F({ id: "n4", k: "hit", a: "A_N1", ac: "N1", o: "A_H2", oc: "H2", h: 0 }),
  F({ id: "c1", k: "chal", a: "A_H3", ac: "H3", o: "A_CH", oc: "CH", s: 2, win: 1 }),
  F({ id: "m1", k: "mv", a: "A_H2", ac: "H2", n: 2 }), F({ id: "m2", k: "mv", a: "A_H2", ac: "H2", n: 2, t: 1300 }), F({ id: "m3", k: "mv", a: "A_H1", ac: "H1", n: 1 }),
  F({ id: "r1", k: "roll", a: "A_H1", ac: "H1", n: 8, s: 4, b: 1, p: 1 }), F({ id: "r2", k: "roll", a: "A_H3", ac: "H3", n: 6, s: 1, b: 3, p: 2 }),
  F({ id: "st1", k: "stunt", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", nm: "doubleDamage" }), F({ id: "st2", k: "stunt", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", nm: "knockback" }),
  F({ id: "hl", k: "act", a: "A_H3", ac: "H3", nm: "stabilize", i: "ih" }), F({ id: "hlr", k: "roll", a: "A_H3", ac: "H3", n: 3, s: 1, i: "ih" })
];
{
  const r = TP.award(rec, base);
  eq(r.meta, { v: TP.TV }, "B: the titles were counted (meta)");
  eq(holder(r, "killer"), ["H1"], "B: Killer: one foe each, the more damage dealt wins (Anna 6 against Bolek 2)");
  eq(holder(r, "defender"), ["H3"], "B: Defender: Armor that took a blow (2) and a block (2x1)");
  eq(r.titles.find((x) => x.id === "defender")?.d, { armor: 2, blocks: 1 }, "B: Defender's line numbers");
  eq(holder(r, "firefighter"), ["H3"], "B: Firefighter: sixes on a challenge and the challenge overcome");
  eq(holder(r, "medic"), ["H3"], "B: Medic: a stabilise whose roll had a six");
  eq(holder(r, "everywhere"), ["H2"], "B: Mr Everywhere: the most zones of own moves (4)");
  eq(holder(r, "stuntman"), ["H1"], "B: Stuntman: two stunts");
  eq(holder(r, "untouchable"), ["H2"], "B: Untouchable: a dodge and a miss, nothing hit");
  eq(holder(r, "bag"), ["H3"], "B: Punching Bag: 4 lost to a foe");
  eq(holder(r, "lucky"), ["H1"], "B: Lucky: four sixes");
  eq(holder(r, "unlucky"), ["H3"], "B: Unlucky: three ones");
  eq(holder(r, "daredevil"), ["H3"], "B: Daredevil: two pushes");
  eq(holder(r, "finisher"), ["H2"], "B: Final Blow: the last foe down (two foes fell)");
  eq(holder(r, "nemesis"), ["N2"], "B: Nemesis: an NPC, the most damage to heroes");
  eq(holder(r, "mvp"), ["H1"], "B: MVP: Anna (6 dealt, a defeat, two stunts...)");
  ok(r.titles.filter((x) => x.id !== "nemesis").every((x) => pc[x.c].s === "h"), "B: only heroes win the hero titles");
  ok(r.titles.every((x) => x.a === pc[x.c].a && Number.isFinite(x.n)), "B: every title names the actor and the number");
  eq(TP.TITLES.map((x) => x.id).indexOf("mvp"), 0, "B: MVP comes first");
  /* thresholds */
  const few = TP.award(rec, [...acts, F({ id: "m1", k: "mv", a: "A_H2", ac: "H2", n: 2 }), F({ id: "r1", k: "roll", a: "A_H1", ac: "H1", n: 3, s: 3 })]);
  eq([holder(few, "everywhere"), holder(few, "lucky"), holder(few, "mvp")], [[], [], []], "B: under the least number a title is not given (2 zones, 3 sixes, no deeds)");
  /* a full tie is shared, more than MAX_SHARE holders is no title */
  const tie = TP.award(rec, [...acts, F({ id: "m1", k: "mv", a: "A_H1", ac: "H1", n: 3 }), F({ id: "m2", k: "mv", a: "A_H2", ac: "H2", n: 3 })]);
  eq(holder(tie, "everywhere"), ["H1", "H2"], "B: a full tie shares the title (by name)");
  const pc4 = { ...pc, H4: { a: "A_H4", n: "Dora", s: "h" } }, rec4 = { ...rec, pc: pc4 };
  const tie4 = TP.award(rec4, [...acts, ...["H1", "H2", "H3", "H4"].map((c) => F({ id: `m${c}`, k: "mv", a: `A_${c}`, ac: c, n: 3 }))]);
  eq(holder(tie4, "everywhere"), [], "B: a title all four share is no title");
  ok(TP.sameTitles({ titles: r.titles, tm: r.meta }, TP.award(rec, base)), "B: the same facts give the same titles (the writer writes no change)");
}

/* ---- C. honesty */
{
  const gmOnly = [...base, F({ id: "g1", k: "mv", a: "A_H3", ac: "H3", n: 9, v: 1 }), F({ id: "g2", k: "roll", a: "A_H3", ac: "H3", n: 12, s: 12, v: 1 })];
  const r = TP.award(rec, gmOnly);
  eq([holder(r, "everywhere"), holder(r, "lucky")], [["H2"], ["H1"]], "C: a GM-only fact counts for no title");
  const hid = TP.award(rec, [...base, F({ id: "hd", k: "dmg", a: "A_NH", ac: "NH", o: "A_H1", oc: "H1", tk: 9 }), F({ id: "hk", k: "down", a: "A_H1", ac: "H1", o: "A_NH", oc: "NH", fate: "dead", n: 1, t: 1150 })]);
  eq(holder(hid, "nemesis"), ["N2"], "C: an NPC hidden at the end never wins (its public damage only counts for the hero)");
  ok(!hid.titles.some((x) => x.c === "NH"), "C: no title names a participant hidden at the end");
  const hidHero = TP.award({ ...rec, pc: { ...pc, H1: { ...pc.H1, hid: 1 } } }, base);
  ok(!hidHero.titles.some((x) => x.c === "H1"), "C: a hero hidden at the end wins nothing either");
  /* an NPC's Armor never reaches a title: N1 had 3 on Armor, no title shows it */
  ok(!r.titles.some((x) => x.c === "N1" && x.id === "defender"), "C: an NPC's Armor is never counted (Defender is a hero's)");
  /* the stored titles a player may see */
  /* MVP1: the hidden one's stored title was a second MVP; since the user's decision (AWRD-2, 2026-11-13) nobody, the GM included, is shown two
     MVPs (check-mvp1 checks that), so the hidden one's title here is another one: the check still says the GM gets every other stored title */
  const stored = { ...rec, titles: [...r.titles, { id: "nemesis", c: "NH", a: "A_NH", n: 1 }, { id: "killer", c: "H2", v: 1, n: 1 }], tm: r.meta };
  ok(!TP.shown(stored, { gm: false }).some((x) => x.c === "NH" || x.v), "C: a player never gets a GM-only title or one of somebody hidden");
  eq(TP.shown(stored, { gm: true }).length, r.titles.length + 2, "C: the GM gets every stored title");
}

/* ---- D. undone actions, a small fight */
{
  const drop = P.idsToDrop(base.map((x) => (x.id === "m1" || x.id === "m2" ? { ...x, x: "tx9" } : x)), { x: "tx9" });
  const after = base.filter((x) => !drop.includes(x.id));
  eq(holder(TP.award(rec, after), "everywhere"), [], "D: an undone move takes Mr Everywhere back (the facts of its transaction are gone)");
  const small = TP.award(rec, base.filter((x) => x.k !== "act"));
  eq([small.titles.length, small.meta.small], [0, 1], "D: a fight of fewer than four counted actions gets no titles (small)");
  eq(TP.award(null, []).meta.small, 1, "D: no record: nothing");
  const nobody = TP.award(rec, acts);
  eq([nobody.titles.length, nobody.meta.small ?? 0], [0, 0], "D: a fight where nobody stood out: counted, no title");
}

/* ---- E. a real fight through the engine */
{
  const decl = (actor, action, targets) => ({ op: "declare", actor, decl: { action, targets } });
  const pass = async (T) => { for (const p of T.prompts("reaction")) await T.req(p.to === "gm" ? "gm" : p.to.users[0], { op: p.to === "gm" ? "answerFor" : "answer", prompt: p.id, value: "pass" }); };
  const T = new Table(); T.hero("H1", "p1").hero("H2", "p2").npc("N1", { health: 6 }).npc("N2", { health: 6 }); T.order(["H1", "N1", "H2", "N2"]);
  const fightRec = () => ({ ...P.newFight("C1_f1", "C1", 1, "Test"), t1: 2, pc: { H1: { a: "A_H1", n: "H1", s: "h" }, H2: { a: "A_H2", n: "H2", s: "h" }, N1: { a: "A_N1", n: "N1", s: "n" }, N2: { a: "A_N2", n: "N2", s: "n" } } });
  await T.req("p1", decl("H1", "slugfest", ["N1"])); await pass(T); await T.roll("attack", 3);
  await T.req("p1", { op: "answer", prompt: T.prompt("stunts").id, value: ["doubleDamage@N1"] }); await pass(T);
  T.turn("H2");
  await T.req("p2", decl("H2", "slugfest", ["N2"])); await pass(T); await T.roll("attack", 1);
  const st2 = T.prompt("stunts"); if (st2) await T.req("p2", { op: "answer", prompt: st2.id, value: [] }); await pass(T);
  const f1 = fold(T.events, whoOf(T));
  const d1 = f1.filter((x) => x.k === "dmg").map((x) => [x.ac, x.oc, x.tk > 0]);
  ok(d1.length >= 2, `E: two attacks dealt damage (${JSON.stringify(d1)})`);
  /* not enough actions yet: small; two more declared actions make it a fight */
  eq(TP.award(fightRec(), f1).meta.small, 1, "E: two actions are too small a fight");
  const more = [...f1, { id: "e1", k: "act", m: "t", f: "C1_f1", t: 9, a: "A_N1", ac: "N1", nm: "slugfest" }, { id: "e2", k: "act", m: "t", f: "C1_f1", t: 9, a: "A_N2", ac: "N2", nm: "slugfest" }];
  const r = TP.award(fightRec(), more);
  eq(holder(r, "mvp"), ["H1"], "E: the MVP of the real fight is the one who dealt more (a doubled blow)");
  /* the GM takes H1's attack back: its facts go, and with them its titles */
  const tx = T.log.list.find((x) => x.inst && f1.some((y) => y.k === "dmg" && y.ac === "H1" && y.x === P.safe(x.id)));
  ok(!!tx, "E: (the transaction of H1's attack)");
  eq((await T.gm({ op: "undo", tx: tx.id })).ok, true, "E: undo");
  const f2 = fold(T.events, whoOf(T));
  const r2 = TP.award(fightRec(), [...f2, ...more.slice(-2)]);
  ok(!r2.titles.some((x) => x.c === "H1" && ["mvp", "killer"].includes(x.id)), "E: after the undo H1's attack wins nothing");
}

/* ---- F. the card and the history */
{
  const r = TP.award(rec, base), stored = { ...rec, titles: r.titles, tm: r.meta };
  const card = TP.cardOf(stored, { gm: false }, L.t, (cid) => (cid === "H1" ? { n: "Anna (mine)", i: "a.png", mine: true } : null));
  eq([card.state, card.mvp.length, card.mvp[0].who.n, card.mvp[0].who.mine], ["ok", 1, "Anna (mine)", true], "F: the card: state, the MVP with the viewer's name for it");
  ok(card.list.every((x) => x.name && x.why && x.icon && x.tip && !/IPU\./.test(`${x.name}${x.why}${x.tip}`)), "F: every line has its name, why, tooltip and badge, no raw key");
  eq(TP.cardOf({ ...rec }, { gm: false }, L.t).state, "wait", "F: titles not counted yet: wait");
  eq(TP.cardOf({ ...rec, tm: { v: 1, small: 1 }, titles: [] }, { gm: false }, L.t).state, "small", "F: a small fight");
  eq(TP.cardOf({ ...rec, tm: { v: 1 }, titles: [] }, { gm: false }, L.t).state, "none", "F: nobody stood out");
  eq(TP.why({ id: "defender", n: 4, d: { armor: 2, blocks: 1 } }, (k, p) => L.tIn("pl", k, p)), "Pancerz wchłonął 2 · 1 blok", "F: a line in Polish");      // POLS (U223): the wording of the Armor part changed, the numbers did not
  eq(TP.why({ id: "everywhere", n: 5 }, (k, p) => L.tIn("en", k, p)), "5 zones crossed", "F: a line in English");
  /* collected over fights, a period, the model */
  const rec2 = { ...stored, f: "C1_f2", t0: 50, titles: [{ id: "mvp", c: "H1", a: "A_H1", n: 9 }, { id: "killer", c: "NH", a: "A_NH", n: 1 }], tm: { v: 1 } };
  const won = TP.collected([stored, rec2], { gm: false });
  eq(won.get("A_H1")?.mvp, 2, "F: Anna collected two MVPs");
  ok(!won.has("A_NH"), "F: nothing collected by somebody hidden");
  eq(TP.collected([stored, rec2], { gm: false }, 800).get("A_H1")?.mvp, 1, "F: since a time: only the fights after it");
  const names = { t: L.t, attr: (x) => x, action: (x) => x, stunt: (x) => x, out: (x) => x, user: () => "Gracz", players: () => [{ id: "p1", name: "Gracz 1" }], when: () => "t" };
  const data = { actors: { A_H1: { n: "Anna", h: 1, own: ["p1"] }, A_H2: { n: "Bolek", h: 1, own: ["p1"] } }, facts: base, fights: { C1_f1: stored, C1_f2: rec2 } };
  const ch = M.view(data, { gm: false, id: "p1" }, { tab: "chars", period: "all", sel: "A_H1" }, names);
  eq(ch.detail.titles.find((x) => x.id === "mvp")?.n, 2, "F: the character's titles in the window");
  const pl = M.view(data, { gm: false, id: "p1" }, { tab: "players", period: "all", sel: "p1" }, names);
  const sumOwn = [...won.get("A_H1") ? Object.values(won.get("A_H1")) : [], ...won.get("A_H2") ? Object.values(won.get("A_H2")) : []].reduce((a, b) => a + b, 0);
  eq(pl.detail.titles.reduce((a, x) => a + x.n, 0), sumOwn, "F: the player's titles are the sum of the characters they own");
}

/* ---- G. strings */
for (const T of TP.TITLES) for (const k of [`IPU.Awrd.t.${T.id}`, `IPU.Awrd.tip.${T.id}`, `IPU.Awrd.why.${T.id}`]) ok(typeof L.EN[k] === "string" && typeof L.PL[k] === "string", `G: ${k} in English and Polish`);
eq(Object.keys(L.EN).filter((k) => k.startsWith("IPU.Awrd.")).sort(), Object.keys(L.PL).filter((k) => k.startsWith("IPU.Awrd.")).sort(), "G: the same keys in both languages");

/* ---- H. source pins */
{
  const w = read("stats/titles.mjs"), fb = read("tactics/ui/feedback.mjs"), dom = read("tactics/ui/dom.mjs"), main = read("stats/main.mjs"), app = read("stats/app.mjs");
  ok(/if \(!Store\.isWriter\(\) \|\| !setTitles\) return/.test(w) && /sameTitles/.test(w), "H: only the writer counts titles, and writes only a change");
  ok(/meta && typeof meta === "object" \? \{ tm: meta \}/.test(main), "H: setTitles keeps the meta (tm)");
  ok(/fightSections = \[fightSection\]/.test(app), "H: the window's fight section is the titles'");
  ok(/sum: shown\(\)/.test(fb) && /function shown\(\) \{ const c = decorate\(sum\?\.card/.test(fb) && /StatStore\.subscribe\(onStats\)/.test(fb), "H: the fight card gets its titles and follows the statistics");      // POLS: decorate now goes through shown() (it also lifts the dock over the windows, U222)
  ok(/awardsBody\(c\)/.test(dom) && /role: "tab"/.test(dom), "H: the card has the titles tab");
}
/* ---- I. found live: the doer of a challenge roll and of a counterattack (emit() overwrites `by` with the user), the summary card's
   list that shadowed the hints' Set */
{
  const who = (cid) => (cid === "H1" ? { a: "A_H1", side: "h" } : cid === "CH" ? { a: "A_CH", side: "n" } : cid === "N1" ? { a: "A_N1", side: "n" } : null);
  const ch = P.factsOfEvent({ type: "challenge", combat: "C1", fight: "f1", seq: 5, inst: "i1", actor: "H1", by: "user1", who: "H1", challenge: "CH", sixes: 2, state: "overcome" }, { who, pub: true }).facts;
  eq(ch.map((x) => [x.k, x.a, x.ac, x.s, x.win]), [["chal", "A_H1", "H1", 2, 1]], "I: a challenge roll is its doer's though `by` is the user");
  const ch2 = P.factsOfEvent({ type: "challenge", combat: "C1", fight: "f1", seq: 6, inst: "i2", actor: "H1", by: "user1", challenge: "CH", sixes: 1 }, { who, pub: true }).facts;
  eq(ch2.map((x) => x.ac), ["H1"], "I: without `who` the instance's actor is the doer");
  const ct = P.factsOfEvent({ type: "counter", combat: "C1", fight: "f1", seq: 7, inst: "i3", actor: "N1", by: "user1", who: "H1", against: "N1", sixes: 1 }, { who, pub: true }).facts;
  eq(ct.map((x) => [x.k, x.ac, x.oc]), [["ctr", "H1", "N1"]], "I: a counterattack is the counterattacker's");
  ok(/type: "challenge", challenge: t, rating: next\.rating, timeLeft: ch\.resolve, by: I\.actor, who: I\.actor/.test(read("tactics/flows/challenge.mjs")) && /type: "counter", by: t, who: t/.test(read("tactics/flows/attack.mjs")), "I: the flows name the doer in `who`");
  const fb = read("tactics/ui/feedback.mjs");
  ok(/let sumDone = loadDone\(\)/.test(fb) && !/let done = loadDone\(\)/.test(fb), "I: the summed-up fights list no longer shadows the hints' Set (sync threw 'done.add is not a function')");
}
done("check-awrd");
