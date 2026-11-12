// node scripts/tactics/check-odds.mjs -- row U133 (TRIAL): the chance of a target drawn instead of written, three looks behind the client
// switch tacticsOddsLook ("off" = the words, as before). What can be held without Foundry: every band has a mark in every look (kit.css,
// the map's pictures, a name in both languages), what the board hands the map per look, the legend, and that "off" changes nothing.
// The live look (lane 5) is in dev/combat-handoff.md; the map's side is moinen-maps dev/zones-board.test.mjs section 42.
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

/* ---- the marks ---- */
eq(Kit.ODDS_LEVELS, BANDS.map((b) => b.id), "1 one mark per band of the engine, in its order");
for (const look of Kit.ODDS_LOOKS) for (let i = 0; i < 4; i++) {
  const k = Kit.oddsKind(i, look);
  ok(MARK_SVG[k] && css.includes(`--ipu-m-${k}: url("${MARK_SVG[k].uri}")`) && css.includes(`.ipu-k-${k} {`), `2 ${look} ${i}: one drawing, the same in kit.css and on the map's canvas`);
}
for (const look of Kit.ODDS_LOOKS) ok(new Set([0, 1, 2, 3].map((i) => MARK_SVG[Kit.oddsKind(i, look)].uri)).size === 4, `3 ${look}: four different shapes (never a colour alone: one ink for all)`);
ok(new Set(Kit.ODDS_LOOKS.flatMap((look) => [0, 1, 2, 3].map((i) => MARK_SVG[Kit.oddsKind(i, look)].uri))).size === 12, "4 three looks, twelve drawings");
eq(Kit.ODDS_LEVELS.map((id) => Kit.markName(id, "pl")), ["Mała szansa", "Pół na pół", "Spora szansa", "Prawie pewne"], "6 the Polish names are the words the pill said");
eq(Kit.ODDS_LEVELS.map((id) => Kit.markName(id, "en")), Kit.ODDS_LEVELS.map((id) => T0(`ITAC.ui.band.${id}`)), "7 the English names are the words the pill said");
ok(Kit.oddsKind(4, "bars") === null && Kit.oddsKind(1, "off") === null && Kit.oddsKind(1.5, "ring") === null, "8 no mark for what is not a band or not a look");
ok(/role="img" aria-label="Likely" data-tooltip="Likely"/.test(Kit.oddsMarkHtml(2, "bars", { name: true })) && /aria-hidden="true"/.test(Kit.oddsMarkHtml(2, "bars")), "9 a mark that stands alone names itself; beside its name it is silent");

/* ---- the legend ---- */
Kit.setOddsLook(null);
const L0 = Kit.legendHtml("en");
ok(!L0.includes("ipu-k-odds-") && !L0.includes(">Chance<"), "10 off: the legend as before");
for (const look of Kit.ODDS_LOOKS) {
  Kit.setOddsLook(look);
  for (const lang of ["en", "pl"]) { const L = Kit.legendHtml(lang); ok(L.includes(`>${Kit.markName("legend.chance", lang)}<`) && Kit.ODDS_LEVELS.every((id, i) => L.includes(`ipu-k-odds-${look}-${i + 1}`) && L.includes(`<dd>${Kit.markName(id, lang)}</dd>`)), `11 ${look} ${lang}: the legend shows the four marks of the look with their names`); }
}
Kit.setOddsLook("nonsense");
ok(Kit.getOddsLook() === null, "12 an unknown look is off");

/* ---- what the board hands the map ---- */
const odds = (level, say = null) => ({ level, text: T0(`ITAC.ui.band.${BANDS[level].id}`), say: say ?? T0(`ITAC.ui.band.${BANDS[level].id}`), defended: null });
const panel = (o) => ({ kind: "declare", targets: [{ id: "c1", map: true, reach: "in", odds: o, hit: { base: 3, toStress: false, taken: 2, now: 7, max: 9 } }, { id: "c2", map: true, reach: "out", why: "too far" }] });
for (let i = 0; i < 4; i++) {
  const p = panel(odds(i)), off = BP.reachMarks(p, T0), offStr = BP.reachMarks(p, T0, "off");
  eq(offStr, off, `13 level ${i}: the switch "off" hands exactly what the board handed before`);
  ok(off[0].label === T0(`ITAC.ui.band.${BANDS[i].id}`) && !off[0].badge && !off[0].meter, `14 level ${i} off: the words in the pill`);
  const bars = BP.reachMarks(p, T0, "bars")[0], ring = BP.reachMarks(p, T0, "ring")[0], arrow = BP.reachMarks(p, T0, "arrow")[0];
  ok(!bars.label && bars.badge?.at === "ne" && bars.badge.plate === true && bars.badge.signs[0].img === MARK_SVG[`odds-bars-${i + 1}`].uri && bars.badge.name === T0(`ITAC.ui.band.${BANDS[i].id}`), `15 level ${i} A: no pill; the bars on a plate at the top right corner, named`);
  ok(!ring.label && !ring.badge && ring.meter?.n === i + 1 && ring.meter.of === 4 && ring.meter.name, `16 level ${i} B: no pill; the ring in four quarters, ${i + 1} heavy`);
  ok(!arrow.label && arrow.badge?.at === "se" && arrow.badge.plate === false && arrow.badge.signs[0].img === MARK_SVG[`odds-arrow-${i + 1}`].uri, `17 level ${i} C: no pill; the chevrons alone at the bottom right corner`);
  for (const x of [bars, ring, arrow]) {
    ok(x.tip?.includes(T0(`ITAC.ui.band.${BANDS[i].id}`)), `18 level ${i}: the pointer's tip says the chance in words`);
    ok(x.hover?.label === "-2" && x.hover.signs?.label?.length === 1 && x.hover.signs.label[0].n === "-2" && x.hover.bar?.loss === 2, `19 level ${i}: under the pointer the pill says what a hit does, alone (the damage mark), the bar as before`);
  }
  eq(BP.reachMarks(p, T0, "bars")[1], off[1], `20 level ${i}: a target out of reach looks as before (dimmed, the no-entry sign)`);
}
/* the GM's chance is a per cent: the mark is the band's, the per cent stays in the tip */
const gm = BP.reachMarks(panel(odds(2, "72%")), T0, "bars")[0];
ok(gm.badge.name === T0("ITAC.ui.band.likely") && gm.tip.includes("72%") && !gm.label, "21 the GM: the band's mark, the per cent in the tip");
ok(BP.reachMarks(panel(odds(2, "72%")), T0)[0].label === "72%", "22 the GM, off: the per cent in the pill as before");
/* an area's caught token (ui/board.mjs caught) */
eq(BP.oddsShow(odds(1), null), { label: T0("ITAC.ui.band.even") }, "23 an area's caught token, off: its words");
ok(BP.oddsShow(odds(1), "ring").meter?.n === 2 && BP.oddsShow(null, "ring") && Object.keys(BP.oddsShow(null, "ring")).length === 0, "24 an area's caught token with a look: the look; no chance: nothing");
/* the switch: a client setting, temporary, default off */
const main = readFileSync(new URL("main.mjs", here), "utf8");
ok(/reg\("tacticsOddsLook", \{[^}]*scope: "client"[^}]*default: "off"/.test(main), "25 the switch is this browser's, off by default");
ok(/getOddsLook\(\)/.test(readFileSync(new URL("ui/board.mjs", here), "utf8")), "26 the board reads the switch");
Kit.setOddsLook(null);
done("check-odds");
