// node scripts/tactics/check-odds.mjs -- row U133: the chance of a target drawn instead of written: the way it points, a sign in the
// token's corner (a chevron down, a level dash, a chevron up, two up; the owner's choice of 2026-11-12, "znaki v -"). What can be held
// without Foundry: every band has its sign (kit.css, the map's pictures, a name in both languages), each its own shape, the level dash
// not the quick action's bar, what the board hands the map, the legend, and that no words stand over the token. The live look (lane 5)
// is in dev/combat-handoff.md; the map's side (the plate, the corner) is moinen-maps dev/zones-board.test.mjs section 42.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as Kit from "../kit.mjs";
import { MARK_SVG } from "../kit-marks.mjs";
import * as BP from "./ui/board-pure.mjs";
import { BANDS } from "./flows/kit.mjs";
import { t as T0 } from "./lang.mjs";

globalThis.game = { ...(globalThis.game ?? {}), i18n: { lang: "en" } };
const here = new URL(".", import.meta.url);
const css = readFileSync(new URL("../../styles/kit.css", here), "utf8");
const band = (i) => T0(`ITAC.ui.band.${BANDS[i].id}`);
const pts = (d) => d.replace(/^M|Z$/g, "").split("L").map((q) => q.split(",").map(Number));
const shapesOf = (k) => (decodeURIComponent(MARK_SVG[k].uri).match(/M[^MZ]+Z/g) ?? []).map(pts);

/* ---- the marks ---- */
eq(Kit.ODDS_LEVELS, BANDS.map((b) => b.id), "1 one mark per band of the engine, in its order");
for (let i = 0; i < 4; i++) {
  const k = Kit.oddsKind(i);
  ok(k === `odds-${i + 1}` && MARK_SVG[k] && css.includes(`--ipu-m-${k}: url("${MARK_SVG[k].uri}")`) && css.includes(`.ipu-k-${k} {`), `2 level ${i}: one drawing, the same in kit.css and on the map's canvas`);
  const svg = decodeURIComponent(MARK_SVG[k].uri), shapes = shapesOf(k);
  eq([MARK_SVG[k].w, shapes.length, /stroke|fill='none'/.test(svg)], [12, i === 3 ? 2 : 1, false], `3 level ${i}: one ink, filled shapes only (${i === 3 ? "two chevrons" : "one shape"}), in a square box`);
  const all = shapes.flat(), xs = all.map((q) => q[0]), ys = all.map((q) => q[1]);
  ok(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2 - 6) < 0.05 && Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - 6) < 0.05 && Math.min(...xs) >= 0.5 && Math.max(...xs) <= 11.5, `3b level ${i}: centred in its box, one span for all four`);
}
/* each level its own shape: which way it points (a chevron's apex is its point on the middle line) */
const pointsOf = (k) => shapesOf(k).map((s) => { const apex = s.find((q) => q[0] === 6), ys = s.map((q) => q[1]); return apex ? (apex[1] === Math.min(...ys) ? "up" : apex[1] === Math.max(...ys) ? "down" : "?") : "level"; });
eq([1, 2, 3, 4].map((n) => pointsOf(`odds-${n}`).join("+")), ["down", "level", "up", "up+up"], "3c the four point down, level, up, up twice: the shape says the level, never a colour alone");
{ /* the level dash is not the quick action's bar (a leaning slab half the box high, flat ends) */
  const [d] = shapesOf("odds-2"), [q] = shapesOf("quick"), hOf = (s) => Math.max(...s.map((p) => p[1])) - Math.min(...s.map((p) => p[1]));
  ok(d.length === 6 && d.some((p) => p[1] === 6 && p[0] < 1) && d.some((p) => p[1] === 6 && p[0] > 11) && hOf(d) < hOf(q) * 0.75 && q.length === 4, "3d the level dash lies level, ends in points and is thinner than the quick action's leaning bar");
}
eq(Object.keys(MARK_SVG).filter((k) => k.startsWith("odds-")).sort(), ["odds-1", "odds-2", "odds-3", "odds-4"], "4 the chance has one drawing per level and no other (no trial look, no ring)");
ok(!/odds-(bars|ring|arrow)/.test(css) && !/quarters/i.test(css), "5 kit.css draws no trial look and no ring in quarters");
eq(Kit.ODDS_LEVELS.map((id) => Kit.markName(id, "pl")), ["Mała szansa", "Pół na pół", "Spora szansa", "Prawie pewne"], "6 the Polish names are the words the pill said");
eq(Kit.ODDS_LEVELS.map((id) => Kit.markName(id, "en")), Kit.ODDS_LEVELS.map((id) => T0(`ITAC.ui.band.${id}`)), "7 the English names are the words the pill said");
ok(Kit.oddsKind(4) === null && Kit.oddsKind(-1) === null && Kit.oddsKind(1.5) === null && Kit.oddsKind("1") === null, "8 no mark for what is not a band");
ok(/^<span class="ipu-odds-plate" role="img" aria-label="Likely" data-tooltip="Likely"><i class="ipu-cost ipu-k-odds-3"><\/i><\/span>$/.test(Kit.oddsMarkHtml(2, { name: true })) && /^<span class="ipu-odds-plate" aria-hidden="true">/.test(Kit.oddsMarkHtml(2)), "9 a mark that stands alone names itself; beside its name it is silent; it stands on its plate");
ok(/:where\(\.ipu-odds-plate\) \{[^}]*width: 24px;[^}]*border: 1\.5px solid var\(--ipu-target\);[^}]*background: var\(--ipu-plate\);[^}]*color: var\(--ipu-yellow\);/.test(css) && /--ipu-target: #ff9d4d;/.test(css), "10 the legend's sign stands on the map's plate (its dark, rimmed in the target's colour, the sign yellow), a row's size");
eq([0, 1, 2, 3].map((i) => Kit.oddsSign(i, { lang: "pl" })?.name), ["Mała szansa", "Pół na pół", "Spora szansa", "Prawie pewne"], "10b the map's sign names itself in the reader's language");
ok([0, 1, 2, 3].every((i) => { const s = Kit.oddsSign(i, { name: "x" }); return s.img === MARK_SVG[`odds-${i + 1}`].uri && s.w === 12 && s.color === 0xffe72a && s.el.cls === `ipu-cost ipu-k-odds-${i + 1}`; }) && Kit.oddsSign(4) === null, "10c the map's sign is the kit's picture, in the marks' yellow");

/* ---- the legend ---- */
for (const lang of ["en", "pl"]) {
  const L = Kit.legendHtml(lang);
  ok(L.includes(`>${Kit.markName("legend.chance", lang)}<`) && Kit.ODDS_LEVELS.every((id, i) => L.includes(`ipu-k-odds-${i + 1}`) && L.includes(`<dd>${Kit.markName(id, lang)}</dd>`)), `11 ${lang}: the legend has the column of the chance, the four signs with their names`);
}

/* ---- what the board hands the map ---- */
const odds = (level, say = null) => ({ level, text: band(level), say: say ?? band(level), defended: null });
const panel = (o, picked = false) => ({ kind: "declare", targets: [{ id: "c1", map: true, reach: "in", picked, odds: o, hit: { base: 3, toStress: false, taken: 2, now: 7, max: 9 } }, { id: "c2", map: true, reach: "out", why: "too far" }] });
for (let i = 0; i < 4; i++) {
  const [m, out] = BP.reachMarks(panel(odds(i)), T0);
  ok(!("label" in m) && !m.signs && !("meter" in m), `12 level ${i}: no words over the token, no ring meter`);
  eq(m.badge, { sign: Kit.oddsSign(i, { name: band(i) }), name: band(i) }, `13 level ${i}: the band's sign in the token's corner, named by the band's words`);
  ok(m.tip === `${T0("ITAC.ui.chance")}: ${band(i)}`, `14 level ${i}: the pointer's tip says the chance in words`);
  ok(m.hover?.label === "-2" && m.hover.signs?.label?.length === 1 && m.hover.signs.label[0].n === "-2" && m.hover.bar?.loss === 2 && m.hover.tip.startsWith(m.tip), `15 level ${i}: under the pointer the pill says what a hit does, alone (the damage mark), the bar as before`);
  eq(out, { cid: "c2", state: "out", tip: "too far" }, `16 level ${i}: a target out of reach looks as before (dimmed, the no-entry sign, the reason)`);
  eq(BP.reachMarks(panel(odds(i), true), T0)[0].badge, m.badge, `17 level ${i}: a chosen target keeps its sign (the heavy ring is the chosen one's)`);
}
/* the GM's chance is a per cent: the sign is the band's, the per cent stays in the tip */
const gm = BP.reachMarks(panel(odds(2, "72%")), T0)[0];
ok(gm.badge?.sign?.img === MARK_SVG["odds-3"].uri && gm.badge.name === band(2) && gm.tip.includes("72%") && !("label" in gm), "18 the GM: the band's sign, named by the band, the per cent in the tip");
/* a defended chance stays in the tip */
const dfd = { ...odds(1), defended: { ...odds(0), label: T0("ITAC.ui.ifDefends", { how: T0("ITAC.action.block") }) } };
ok(BP.reachMarks(panel(dfd), T0)[0].badge.sign.img === MARK_SVG["odds-2"].uri && BP.reachMarks(panel(dfd), T0)[0].tip.includes(band(0)), "19 the chance if the target defends: words in the tip, the sign is the open chance");
/* an area's caught token (ui/board.mjs caught) */
eq(BP.oddsShow(odds(1)), { badge: { sign: Kit.oddsSign(1, { name: band(1) }), name: band(1) } }, "20 an area's caught token: its sign");
eq([BP.oddsShow(null), BP.oddsShow({ level: 7, say: "x" }), BP.oddsShow({ level: 1, say: null })], [{}, {}, {}], "21 no chance, no band: nothing (the plain ring)");
/* no switch is left */
const main = readFileSync(new URL("main.mjs", here), "utf8"), board = readFileSync(new URL("ui/board.mjs", here), "utf8"), lang = readFileSync(new URL("lang.mjs", here), "utf8");
ok(!/OddsLook|oddsLook/.test(main + board + lang) && !("setOddsLook" in Kit) && !("ODDS_LOOKS" in Kit), "22 the trial's switch is gone (no setting, no words for it, the board and the legend read none)");
ok(!/meter|quarters/i.test(readFileSync(new URL("ui/board-pure.mjs", here), "utf8") + board), "23 the board hands the map no ring meter and speaks of no quarters");
done("check-odds");
