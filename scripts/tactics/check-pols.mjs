/* node scripts/tactics/check-pols.mjs -- package POLS: how the end-of-fight titles and the statistics are SHOWN (scripts/stats/show-pure.mjs,
   the wording in scripts/stats/lang.mjs, the card in ui/dom.mjs + ui/feedback.mjs, the window in scripts/stats/app.mjs). Nothing here
   checks what is counted or who wins (titles-pure, pure.mjs: check-awrd, check-stat).
   A. U219: a title shared by a tie is one entry (one MVP banner) with every holder, its line said once; your own marked
   B. U223 / U224: the wording in both languages (Polish number forms, no gendered verb of the holder, no "Pan", the two "Rzuty")
   C. U221: the reveal's clock (how long, when it still runs, a redraw carries on) and how the fight ended
   D. U222: what opens first (the fight's card over an open window, a round's card not)
   E. U226: the K/D in words, no ratio before the first own defeat
   F. U227: the fights' rail by session
   G. source pins (the card's reveal keyed to --aw-el, reduced motion, no fixed 360 px box, the lift, the window's order, the no-GM note) */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, eq, done } from "./testkit.mjs";
import * as TP from "../stats/titles-pure.mjs";
import * as SP from "../stats/show-pure.mjs";
import * as L from "../stats/lang.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, "..", "..", f), "utf8");
const en = (k, p) => L.tIn("en", k, p), pl = (k, p) => L.tIn("pl", k, p);

/* a stored fight record with titles (the shape titles-pure.award writes) */
const pc = { H1: { a: "A1", n: "Anna", s: "h" }, H2: { a: "A2", n: "Bolek", s: "h" }, H3: { a: "A3", n: "Cela", s: "h" }, N1: { a: "N", n: "Brute", s: "n" }, NX: { a: "X", n: "Hidden", s: "n", hid: 1 } };
const rec = { f: "C_f", c: "C", t0: 1, t1: 2, pc, tm: { v: 1 }, titles: [
  { id: "mvp", c: "H1", a: "A1", n: 9, d: { dealt: 6, kills: 1 } }, { id: "mvp", c: "H2", a: "A2", n: 9, d: { dealt: 3, kills: 2 } },
  { id: "killer", c: "H1", a: "A1", n: 2 }, { id: "killer", c: "H2", a: "A2", n: 2 },
  { id: "defender", c: "H3", a: "A3", n: 4, d: { armor: 4, blocks: 0 } }, { id: "nemesis", c: "N1", a: "N", n: 5 }, { id: "lucky", c: "NX", a: "X", n: 9 }] };

/* ---- A. U219 */
{
  const v = SP.titlesView(rec, { gm: false }, en, (cid) => (cid === "H2" ? { mine: true } : null));
  eq(v.state, "ok", "A: (the titles are there)");
  /* MVP1 (AWRD-2, the user's decision of 2026-11-13): the MVP is never shared; a record stored with two is shown with one (Anna: more damage) */
  eq([v.mvp.who.map((w) => w.n), v.mvp.shared, v.mvp.names], [["Anna"], false, "Anna"], "A: a stored shared MVP is ONE banner with ONE holder (MVP1)");
  eq(v.mvp.why, "6 damage · 1 knockout", "A: ... with that holder's own line");
  eq(SP.titlesView(rec, { gm: true }, en).mvp.names, "Anna", "A: ... the same one for the GM");
  eq(v.list.map((g) => [g.id, g.who.length]), [["killer", 2], ["defender", 1], ["nemesis", 1]], "A: one line per title, in the titles' order; a hidden NPC's title never shows to a player");
  eq(v.list[0].why, en("IPU.Awrd.why.killer", { n: 2 }), "A: the same line for every holder is said once");
  eq([v.mvp.mine, v.list[0].mine, v.list[1].mine], [false, true, false], "A: a title one of your own characters holds is marked yours (Bolek's MVP share is gone: MVP1)");
  eq(SP.titlesView(rec, { gm: false }, en, (cid) => (cid === "H1" ? { mine: true } : null)).mvp.mine, true, "A: your own MVP is marked yours");
  eq(v.count, 4, "A: four entries (seven stored titles: two shared, one hidden)");
  eq(SP.titlesView(rec, { gm: true }, en).list.map((g) => g.id), ["killer", "defender", "nemesis", "lucky"], "A: the GM also sees the hidden NPC's");
  eq(SP.joinNames(["A", "B", "C"]), "A, B & C", "A: three holders in one line");
  eq(SP.titlesView({ ...rec, tm: undefined }, { gm: false }, en).state, "wait", "A: not counted yet: wait");
  eq(SP.numParts("15 damage · 1 knockout"), [["15", true], [" damage · ", false], ["1", true], [" knockout", false]], "A: the numbers of a line stand out");
  const solo = SP.titlesView({ ...rec, titles: [{ id: "mvp", c: "H1", a: "A1", n: 9, d: { dealt: 6, kills: 1 } }, { id: "defender", c: "H3", a: "A3", n: 4, d: { armor: 4 } }] }, { gm: false }, en);
  eq([solo.mvp.shared, solo.mvp.why], [false, "6 damage · 1 knockout"], "A: a single MVP keeps its own line");
}

/* ---- B. U223 / U224: the words */
{
  const why = (l, x) => TP.why(x, l === "pl" ? pl : en);
  eq(why("pl", { id: "bag", n: 12, d: { out: 0 } }), "12 na klatę i dalej na nogach", "B: Punching Bag (pl) has no gendered verb");
  eq(why("pl", { id: "bag", n: 3, d: { out: 1 } }), "3 na klatę, potem na deski", "B: ... nor when the holder went down");
  eq(why("pl", { id: "nemesis", n: 3 }), "3 obrażenia zadane bohaterom", "B: Nemesis (pl) 3: obrażenia");
  eq(why("pl", { id: "nemesis", n: 5 }), "5 obrażeń zadanych bohaterom", "B: Nemesis (pl) 5: obrażeń");
  eq(why("pl", { id: "defender", n: 2, d: {} }), "2 obrażenia zatrzymane", "B: Defender (pl) without parts: no '2 zatrzymanych'");
  eq(why("pl", { id: "mvp", n: 9, d: { dealt: 2, kills: 1 } }), "2 obrażenia · 1 nokaut", "B: the MVP's parts (pl): no '2 obrażeń'");
  eq(why("pl", { id: "mvp", n: 9, d: { dealt: 22, kills: 5 } }), "22 obrażenia · 5 nokautów", "B: ... 22 obrażenia, 5 nokautów");
  eq(why("pl", { id: "firefighter", n: 3, d: { chal: 1, won: 2 } }), "1 szóstka w wyzwaniach · 2 wyzwania pokonane", "B: challenges overcome (pl)");
  eq(why("pl", { id: "killer", n: 1 }), "1 wróg na deskach", "B: Knockout (pl) 1");
  eq(why("pl", { id: "killer", n: 6 }), "6 wrogów na deskach", "B: Knockout (pl) 6");
  eq(why("en", { id: "killer", n: 1 }), "1 foe on the canvas", "B: Knockout (en) 1");
  eq(why("en", { id: "defender", n: 4, d: { armor: 4, blocks: 1 } }), "Armor soaked 4 · 1 block", "B: Defender (en): Armor soaked, not '4 on Armor'");
  ok(!/remember/i.test(why("en", { id: "unlucky", n: 3 })) && !/pamiętają/.test(why("pl", { id: "unlucky", n: 3 })), "B: Unlucky is a joke on the dice, not a sour one");
  const plAw = Object.entries(L.PL).filter(([k]) => k.startsWith("IPU.Awrd."));
  eq(plAw.filter(([, v]) => /\bPan\b|Przyjął|Pokonał|zanim padł|dalej stoi/.test(v)).map(([k]) => k), [], "B: no Polish title line names the holder with a gendered verb or 'Pan'");
  eq([en("IPU.Awrd.t.killer"), pl("IPU.Awrd.t.killer"), en("IPU.Awrd.t.everywhere"), pl("IPU.Awrd.t.everywhere")], ["Knockout", "Nokaut", "Everywhere", "Wszędzie"], "B: POLS-1 / POLS-2 provisional names");
  ok(pl("IPU.Stats.chips.attrs") !== pl("IPU.Stats.g.rolls") && en("IPU.Stats.chips.attrs") !== en("IPU.Stats.g.rolls"), "B: the window no longer has two different things both called 'Rzuty'");
  for (const k of ["IPU.Awrd.over", "IPU.Awrd.end.scene", "IPU.Awrd.end.stop", "IPU.Awrd.end.gone", "IPU.Awrd.you", "IPU.Awrd.tie", "IPU.Awrd.tie.tip", "IPU.Awrd.below", "IPU.Stats.kd.ratio", "IPU.Stats.noGm", "IPU.Stats.rail.fights", "IPU.Stats.rail.more"])
    ok(typeof L.EN[k] === "string" && typeof L.PL[k] === "string" && L.EN[k] !== L.PL[k], `B: ${k} in both languages`);
  eq([pl("IPU.Stats.rail.fights", { n: 1 }), pl("IPU.Stats.rail.fights", { n: 3 }), pl("IPU.Stats.rail.fights", { n: 12 })], ["1 walka", "3 walki", "12 walk"], "B: the session line counts fights in Polish");
}

/* ---- C. U221: the reveal */
{
  eq(SP.revealMs(0, true), SP.REVEAL.why + 400, "C: an MVP alone");
  eq(SP.revealMs(7, true), SP.REVEAL.row0 + 6 * SP.REVEAL.step + SP.REVEAL.row, "C: an MVP and seven titles");
  ok(SP.revealMs(7, true) >= 1800 && SP.revealMs(7, true) <= 2400, "C: a usual fight's reveal lasts about two seconds (POLS-3)");
  eq([SP.revealOn(0, 3), SP.revealOn(900, 3), SP.revealOn(SP.revealMs(3) + 400, 3), SP.revealOn(null, 3)], [true, true, false, false], "C: it runs from the arrival until its end (then the card stands still)");
  eq([SP.endKey("scene"), SP.endKey("stop"), SP.endKey("gone"), SP.endKey("x")], ["IPU.Awrd.end.scene", "IPU.Awrd.end.stop", "IPU.Awrd.end.gone", "IPU.Awrd.end.gone"], "C: how the fight ended");
  const fb = read("scripts/tactics/ui/feedback.mjs");
  ok(/endFight\(combat, "scene"\)/.test(fb) && /endFight\(c, "stop"\)/.test(fb) && /function endFight\(combat, how = "gone"\)/.test(fb), "C: the scene's end, the GM's stop and a deleted combat each say so");
}

/* ---- D. U222: which comes first */
{
  eq(SP.cardLift({ kind: "fight" }, 104), 105, "D: the fight's card goes one step over the highest open window");
  eq(SP.cardLift({ kind: "round" }, 104), null, "D: a round's card stays in the dock's place");
  eq(SP.cardLift(null, 104), null, "D: no card, no lift");
}

/* ---- E. U226 */
{
  const a = SP.kdView({ k: 3, d: 0, a: 1 }, en);
  eq([a.cells.map((c) => `${c.n} ${c.label}`), a.ratio], [["3 Defeated", "0 Defeats", "1 Assists"], null], "E: three numbers with their names, no ratio while there is no own defeat (no '133.0')");
  eq(SP.kdView({ k: 3, d: 2, a: 0 }, pl).ratio, "1.5 na porażkę", "E: the ratio once there is a defeat, in words");
}

/* ---- F. U227 */
{
  const H = 3600 * 1000, mk = (i, t0, sel = false) => ({ id: `f${i}`, t0, sel });
  const items = [mk(1, 100 * H), mk(2, 99 * H), mk(3, 90 * H), mk(4, 89.5 * H), mk(5, 10 * H)];
  const g = SP.railSessions(items);
  eq(g.map((x) => [x.n, x.open, x.items.length]), [[2, true, 2], [2, false, 0], [1, false, 0]], "F: three sessions; the newest open, the older ones folded");
  eq(SP.railSessions(items.map((x) => (x.id === "f4" ? { ...x, sel: true } : x)))[1].open, true, "F: the session of the selected fight is open");
  eq(SP.railSessions(items, { open: new Set([g[2].key]) })[2].items.map((x) => x.id), ["f5"], "F: a session the viewer opened");
  const long = Array.from({ length: 400 }, (_, i) => mk(i, 1000 * H - i * 60000));
  const lg = SP.railSessions(long);
  eq([lg.length, lg[0].items.length, lg[0].rest], [1, SP.RAIL_CAP, 400 - SP.RAIL_CAP], "F: 400 fights in one session: the first ones and a 'show more'");
  eq(SP.railSessions(long, { more: new Set([lg[0].key]) })[0].items.length, 400, "F: ... all of them on 'show more'");
  eq(SP.railSessions(long.map((x, i) => (i === 350 ? { ...x, sel: true } : x)))[0].items.at(-1).id, "f350", "F: the selected fight is drawn even past the cap");
}

/* ---- G. source pins */
{
  const dom = read("scripts/tactics/ui/dom.mjs"), css = read("styles/tactics-ui.css"), app = read("scripts/stats/app.mjs"), scss = read("styles/stats.css"), fb = read("scripts/tactics/ui/feedback.mjs");
  ok(/--aw-el:\$\{-Math\.round\(el\)\}ms/.test(dom) && /var\(--aw-el, 0ms\)/.test(css), "G: the reveal is keyed to the titles' arrival (a redraw carries on)");
  ok(/@media \(prefers-reduced-motion: reduce\) \{\s*#invincible-tactics-dock \.ita-aw\[data-fresh\][^}]*animation: ita-aw-fade/.test(css), "G: reduced motion: the reveal only fades");
  const aw = /#invincible-tactics-dock \.ita-aw \{[^}]*\}/.exec(css)?.[0] ?? "";
  ok(aw && !/360px/.test(aw) && /var\(--its-h/.test(aw), "G: no fixed 360 px box: the titles take the free height (U218)");
  ok(/animation-timeline: --ita-aw-sc/.test(css), "G: a chevron says there is more below");
  ok(/body\.ita-card-up #invincible-tactics-dock \{ z-index: var\(--ita-card-z/.test(css) && css.indexOf("body.ita-card-up") < css.indexOf("body.ita-dice-up #invincible-tactics-dock"), "G: the lift rule, before the dice's (the dice still go over it)");
  ok(/SP\.cardLift\(card, top\)/.test(fb) && /classList\.toggle\("ita-card-up"/.test(fb), "G: feedback lifts the dock while the fight's card stands");
  ok(/ghost\(aw\.note\)/.test(dom) && /aria-busy/.test(dom), "G: while the titles are counted the card holds its size with a ghost");
  ok(app.indexOf("POLS (U225)") > 0 && app.indexOf("out.push(sec)") < app.indexOf('out.push(h("table"'), "G: the window's fight shows the titles before the numbers");
  ok(/IPU\.Stats\.noGm/.test(app) && /\.ipu-st-nogm/.test(scss), "G: the window says when no GM is connected");
  ok(/SP\.railSessions\(/.test(app) && /\.ipu-st-sess/.test(scss), "G: the fights' rail by session");
  ok(!/kd\.k\}\/\$\{x\.kd\.d\}\/\$\{x\.kd\.a/.test(app), "G: no cryptic '1/0/1' in the rail");
  ok(/kids\.flat\(Infinity\)/.test(app), "G: (found live) the window's DOM helper flattens nested children: the session groups printed '[object HTMLButtonElement]'");
}
done("check-pols");
