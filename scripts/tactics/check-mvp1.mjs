/* node scripts/tactics/check-mvp1.mjs -- package MVP1: the MVP of a fight is always ONE (AWRD-2, the user's decision of 2026-11-13).
   scripts/stats/titles-pure.mjs: after the score the order MVP1-1 (fewer own defeats, more hits, more damage dealt, more knockouts, more
   assists, the earlier first action, the combatant id), so a full tie cannot happen.
   A. each step of the order decides a tie on all the steps before it; B. a full tie (also of four: once no MVP at all) still gives one,
   whatever the order of the facts and of the record; C. stable: the same facts the same MVP, a recount after an undo, only public facts and
   no hidden participant; D. a record stored before with a shared MVP is shown with one, the same for the GM and a player, also in the
   collected titles; E. the other titles still share a tie (their rule is unchanged). */
import { ok, eq, done } from "./testkit.mjs";
import * as P from "../stats/pure.mjs";
import * as TP from "../stats/titles-pure.mjs";
import * as SP from "../stats/show-pure.mjs";
import * as L from "../stats/lang.mjs";

const F = (x) => ({ m: "t", f: "C1_f1", t: 1000, ...x });
const pc = { H1: { a: "A_H1", n: "Anna", s: "h" }, H2: { a: "A_H2", n: "Bolek", s: "h" }, H3: { a: "A_H3", n: "Cela", s: "h" }, H4: { a: "A_H4", n: "Dora", s: "h" },
  N1: { a: "A_N1", n: "Thug", s: "n" }, N2: { a: "A_N2", n: "Brute", s: "n" }, N3: { a: "A_N3", n: "Goon", s: "n" } };
const rec = { ...P.newFight("C1_f1", "C1", 900, "Dock"), t1: 5000, pc };
/* every hero acts once at the same moment (four counted actions: a fight); a test moves one act */
const acts = (t = {}) => ["H1", "H2", "H3", "H4"].map((c) => F({ id: `act${c}`, k: "act", a: `A_${c}`, ac: c, nm: "slugfest", t: t[c] ?? 1000 }));
const dmg = (id, ac, oc, tk, t = 1000) => F({ id, k: "dmg", a: `A_${ac}`, ac, o: `A_${oc}`, oc, tk, t });
const hit = (id, ac, oc, h = 1) => F({ id, k: "hit", a: `A_${ac}`, ac, o: `A_${oc}`, oc, h });
const down = (id, ac, oc, t) => F({ id, k: "down", a: `A_${ac}`, ac, o: `A_${oc}`, oc, fate: "broken", n: 1, t });
const mvps = (r) => r.titles.filter((x) => x.id === "mvp").map((x) => x.c);
const score = (facts, cid) => TP.gather(rec, facts).rows.get(cid)?.mvp;

/* ---- A. each step of the order */
{
  /* the score first (unchanged) */
  eq(mvps(TP.award(rec, [...acts(), dmg("a", "H1", "N1", 5), dmg("b", "H2", "N1", 4)])), ["H1"], "A: the higher score wins");
  /* fewer own defeats: both 5 damage, Bolek was put down */
  const d = [...acts(), dmg("a", "H1", "N1", 5), dmg("b", "H2", "N1", 5), down("x", "N2", "H2", 1500)];
  eq([score(d, "H1"), score(d, "H2")], [5, 5], "A: (a tie on the score: 5 and 5)");
  eq(mvps(TP.award(rec, d)), ["H1"], "A: a tie on the score: fewer own defeats wins");
  /* more hits */
  const h = [...acts(), dmg("a", "H1", "N1", 5), dmg("b", "H2", "N1", 5), hit("h1", "H2", "N1"), hit("h2", "H1", "N1", 0)];
  eq(mvps(TP.award(rec, h)), ["H2"], "A: ... and on defeats: more hits wins");
  /* more damage dealt: Anna 4 damage, Bolek 2 damage + a stabilise (2) */
  const dd = [...acts(), dmg("a", "H1", "N1", 4), dmg("b", "H2", "N1", 2), F({ id: "hl", k: "act", a: "A_H2", ac: "H2", nm: "stabilize" })];
  eq([score(dd, "H1"), score(dd, "H2")], [4, 4], "A: (4 and 4)");
  eq(mvps(TP.award(rec, dd)), ["H1"], "A: ... and on hits: more damage dealt wins");
  /* more knockouts: Anna 1 damage + a knockout (3), Bolek 1 damage + a challenge overcome (3) */
  const k = [...acts(), dmg("a", "H1", "N1", 1), dmg("b", "H2", "N2", 1), down("x", "H1", "N1", 1500), F({ id: "c", k: "chal", a: "A_H2", ac: "H2", o: "A_CH", oc: "CH", s: 0, win: 1 })];
  eq([score(k, "H1"), score(k, "H2")], [4, 4], "A: (4 and 4)");
  eq(mvps(TP.award(rec, k)), ["H1"], "A: ... and on damage: more knockouts wins");
  /* more assists: both 3 damage + a knockout (6); Bolek also hit Anna's victim first (an assist), Anna 1 less damage on another */
  const as = [...acts(), dmg("a1", "H1", "N1", 2, 1100), down("x1", "H1", "N1", 1500), dmg("a2", "H1", "N3", 1, 1100),
    dmg("b1", "H2", "N1", 1, 1050), dmg("b2", "H2", "N2", 2, 1100), down("x2", "H2", "N2", 1600)];
  const g = TP.gather(rec, as).rows;
  eq([g.get("H1").mvp, g.get("H2").mvp, g.get("H1").dealt, g.get("H2").dealt, g.get("H2").assists], [6, 7, 3, 3, 1], "A: (Bolek 7 with the assist)");
  eq(mvps(TP.award(rec, as)), ["H2"], "A: an assist counts in the score");
  /* equal on all the numbers: the earlier first action wins */
  const same = (t) => [...acts(t), dmg("a", "H1", "N1", 5), dmg("b", "H2", "N2", 5)];
  eq(mvps(TP.award(rec, same({ H1: 1200, H2: 1100 }))), ["H2"], "A: equal on every number: the one who acted first in the fight wins");
  eq(mvps(TP.award(rec, same({ H1: 1100, H2: 1200 }))), ["H1"], "A: ... the other way round");
  /* equal even in time: the combatant id (by code units, no language) */
  eq(mvps(TP.award(rec, same())), ["H1"], "A: equal even in time: the combatant id decides");
}

/* ---- B. a full tie still gives ONE MVP */
{
  const four = [...acts(), ...["H1", "H2", "H3", "H4"].map((c, i) => dmg(`d${c}`, c, ["N1", "N2", "N3", "N1"][i], 5))];
  const r = TP.award(rec, four);
  eq(mvps(r), ["H1"], "B: four heroes tied on everything: one MVP (the AWRD-2 'no title' for more than three does not apply to it)");
  eq(r.titles.filter((x) => x.id === "mvp").length, 1, "B: exactly one MVP entry");
  /* the order of the facts and of the record does not change it */
  const rev = TP.award({ ...rec, pc: Object.fromEntries(Object.entries(pc).reverse()) }, [...four].reverse());
  eq(mvps(rev), ["H1"], "B: facts and participants in another order: the same MVP");
  for (let s = 1; s <= 5; s++) {
    const sh = [...four].sort((a, b) => ((a.id.charCodeAt(1) * s) % 7) - ((b.id.charCodeAt(1) * s) % 7));
    eq(mvps(TP.award(rec, sh)), ["H1"], `B: shuffled facts (${s}): the same MVP`);
  }
  /* ids that a language would order otherwise ("a" vs "B"): code units, so every seat agrees */
  const pcx = { aX: { a: "A_aX", n: "Ala", s: "h" }, BX: { a: "A_BX", n: "Bea", s: "h" }, N1: pc.N1, N2: pc.N2 };
  const fx = [..."ab".split("").map((_, i) => F({ id: `ax${i}`, k: "act", a: "x", ac: i ? "BX" : "aX", nm: "slugfest" })), F({ id: "ax2", k: "act", a: "n", ac: "N1", nm: "slugfest" }), F({ id: "ax3", k: "act", a: "n", ac: "N2", nm: "slugfest" }),
    F({ id: "q1", k: "dmg", a: "A_aX", ac: "aX", o: "A_N1", oc: "N1", tk: 5 }), F({ id: "q2", k: "dmg", a: "A_BX", ac: "BX", o: "A_N2", oc: "N2", tk: 5 })];
  eq(mvps(TP.award({ ...rec, pc: pcx }, fx)), ["BX"], "B: the last key compares code units ('B' before 'a'), not a language's order");
  /* below the least number: still no MVP */
  eq(mvps(TP.award(rec, [...acts(), dmg("a", "H1", "N1", 3), dmg("b", "H2", "N1", 3)])), [], "B: a tie under the least number (3): no MVP, as before");
}

/* ---- C. stable */
{
  const f = [...acts({ H1: 1200, H2: 1100 }), dmg("a", "H1", "N1", 5), dmg("b", "H2", "N2", 5)];
  const r = TP.award(rec, f);
  ok(TP.sameTitles({ titles: r.titles, tm: r.meta }, TP.award(rec, JSON.parse(JSON.stringify(f)))), "C: the same facts (a reload: the stored copy) give the same titles: the writer writes nothing");
  /* the GM takes Bolek's blow back: the recount gives one MVP, and putting it back the first one again */
  const tx = f.map((x) => (x.id === "b" ? { ...x, x: "tx1" } : x));
  const after = tx.filter((x) => !P.idsToDrop(tx, { x: "tx1" }).includes(x.id));
  eq(mvps(TP.award(rec, after)), ["H1"], "C: after an undo the recount names one MVP");
  eq(mvps(TP.award(rec, tx)), ["H2"], "C: the same facts again: the same MVP as before");
  /* a GM-only fact never tips it, and a hero hidden at the end never wins */
  eq(mvps(TP.award(rec, [...f, F({ id: "g", k: "dmg", a: "A_H1", ac: "H1", o: "A_N1", oc: "N1", tk: 0, v: 1 }), F({ id: "g2", k: "act", a: "A_H1", ac: "H1", nm: "slugfest", t: 1, v: 1 })])), ["H2"],
    "C: a GM-only action (earlier than all) does not decide the tie");
  eq(mvps(TP.award({ ...rec, pc: { ...pc, H2: { ...pc.H2, hid: 1 } } }, f)), ["H1"], "C: a hero hidden at the end is not the MVP; the next one is");
  /* the GM's and a player's card name the same one */
  const st = { ...rec, titles: r.titles, tm: r.meta };
  eq([SP.titlesView(st, { gm: true }, L.t).mvp.names, SP.titlesView(st, { gm: false }, L.t).mvp.names], ["Bolek", "Bolek"], "C: the GM and a player see the same MVP");
}

/* ---- D. a fight stored before with a shared MVP */
{
  const old = { ...rec, tm: { v: 1 }, titles: [
    { id: "mvp", c: "H2", a: "A_H2", n: 9, d: { dealt: 3, kills: 2 } }, { id: "mvp", c: "H1", a: "A_H1", n: 9, d: { dealt: 6, kills: 1 } }, { id: "mvp", c: "H3", a: "A_H3", n: 9, d: { dealt: 6, kills: 1 } },
    { id: "killer", c: "H1", a: "A_H1", n: 2 }, { id: "killer", c: "H2", a: "A_H2", n: 2 }] };
  const gm = TP.shown(old, { gm: true }), pl = TP.shown(old, { gm: false });
  eq([gm.filter((x) => x.id === "mvp").map((x) => x.c), pl.filter((x) => x.id === "mvp").map((x) => x.c)], [["H1"], ["H1"]], "D: three stored MVPs: one shown (more damage, then the id), the same for the GM and a player");
  eq(pl.filter((x) => x.id === "killer").length, 2, "D: the other stored titles are untouched (a shared Killer stays shared)");
  eq(SP.titlesView(old, { gm: false }, L.t).mvp.shared, false, "D: the banner is no longer a tie");
  /* the MVP among the holders a player may see, also for the GM: a hidden holder or a GM-only entry does not make the GM's differ */
  const hid = { ...old, pc: { ...pc, H1: { ...pc.H1, hid: 1 } }, titles: [...old.titles, { id: "mvp", c: "H4", a: "A_H4", n: 99, v: 1 }] };
  const g2 = TP.shown(hid, { gm: true }).filter((x) => x.id === "mvp").map((x) => x.c), p2 = TP.shown(hid, { gm: false }).filter((x) => x.id === "mvp").map((x) => x.c);
  eq([g2, p2], [["H3"], ["H3"]], "D: a hidden holder and a GM-only MVP entry: the GM is shown the player's one");
  /* the collected titles count one MVP for that fight */
  const won = TP.collected([old], { gm: false });
  eq([won.get("A_H1")?.mvp ?? 0, won.get("A_H2")?.mvp ?? 0, won.get("A_H3")?.mvp ?? 0], [1, 0, 0], "D: the collected titles: one MVP for the fight");
  /* the recount of such a fight (a recent one: titles.mjs) stores one */
  const f = [...acts(), dmg("a", "H1", "N1", 5), dmg("b", "H2", "N2", 5)];
  const r = TP.award(rec, f);
  ok(!TP.sameTitles({ ...rec, titles: [...r.titles, { id: "mvp", c: "H2", a: "A_H2", n: 5, d: { dealt: 5, kills: 0, assists: 0, helps: 0, chal: 0 } }], tm: r.meta }, r), "D: a stored shared MVP differs from the recount: the writer rewrites it with one");
}

/* ---- E. the other titles keep their rule */
{
  const r = TP.award(rec, [...acts(), F({ id: "m1", k: "mv", a: "A_H1", ac: "H1", n: 3 }), F({ id: "m2", k: "mv", a: "A_H2", ac: "H2", n: 3 })]);
  eq(r.titles.filter((x) => x.id === "everywhere").map((x) => x.c), ["H1", "H2"], "E: a full tie of another title is still shared");
  eq(TP.TITLES.filter((x) => x.one).map((x) => x.id), ["mvp"], "E: only the MVP is never shared");
}

done("MVP1");
