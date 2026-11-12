// node scripts/tactics/check-odds.mjs -- row U133: the chance of a target drawn instead of written: the target's ring in four quarters,
// as many heavy as the band (the owner's pick "B" of the trial, 2026-11-12). What can be held without Foundry: every band has its mark
// (kit.css, the map's pictures, a name in both languages), what the board hands the map, the legend, and that no words stand over the
// token. The live look (lane 5) is in dev/combat-handoff.md; the map's side is moinen-maps dev/zones-board.test.mjs section 42.
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

/* ---- the marks ---- */
eq(Kit.ODDS_LEVELS, BANDS.map((b) => b.id), "1 one mark per band of the engine, in its order");
for (let i = 0; i < 4; i++) {
  const k = Kit.oddsKind(i);
  ok(k === `odds-${i + 1}` && MARK_SVG[k] && css.includes(`--ipu-m-${k}: url("${MARK_SVG[k].uri}")`) && css.includes(`.ipu-k-${k} {`), `2 level ${i}: one drawing, the same in kit.css and on the map's canvas`);
  const heavy = (decodeURIComponent(MARK_SVG[k].uri).match(/stroke-width='2\.7'/g) ?? []).length, thin = (decodeURIComponent(MARK_SVG[k].uri).match(/stroke-width='0\.8'/g) ?? []).length;
  eq([heavy, thin], [i + 1, 3 - i], `3 level ${i}: four quarters, ${i + 1} heavy and the rest a hairline (one ink: never a colour alone)`);
}
eq(Object.keys(MARK_SVG).filter((k) => k.startsWith("odds-")).sort(), ["odds-1", "odds-2", "odds-3", "odds-4"], "4 the chance has one drawing per level and no other (the trial's bars and chevrons are gone)");
ok(!/odds-(bars|ring|arrow)/.test(css), "5 kit.css draws no trial look");
eq(Kit.ODDS_LEVELS.map((id) => Kit.markName(id, "pl")), ["Mała szansa", "Pół na pół", "Spora szansa", "Prawie pewne"], "6 the Polish names are the words the pill said");
eq(Kit.ODDS_LEVELS.map((id) => Kit.markName(id, "en")), Kit.ODDS_LEVELS.map((id) => T0(`ITAC.ui.band.${id}`)), "7 the English names are the words the pill said");
ok(Kit.oddsKind(4) === null && Kit.oddsKind(-1) === null && Kit.oddsKind(1.5) === null && Kit.oddsKind("1") === null, "8 no mark for what is not a band");
ok(/role="img" aria-label="Likely" data-tooltip="Likely"/.test(Kit.oddsMarkHtml(2, { name: true })) && /aria-hidden="true"/.test(Kit.oddsMarkHtml(2)), "9 a mark that stands alone names itself; beside its name it is silent");
ok(/\.ipu-k-odds-1, \.ipu-k-odds-2, \.ipu-k-odds-3, \.ipu-k-odds-4\) \{ height: 24px;/.test(css), "10 the legend's ring is drawn at a row's size (24 px), not a price mark's");

/* ---- the legend ---- */
for (const lang of ["en", "pl"]) {
  const L = Kit.legendHtml(lang);
  ok(L.includes(`>${Kit.markName("legend.chance", lang)}<`) && Kit.ODDS_LEVELS.every((id, i) => L.includes(`ipu-k-odds-${i + 1}`) && L.includes(`<dd>${Kit.markName(id, lang)}</dd>`)), `11 ${lang}: the legend has the column of the chance, the four rings with their names`);
}

/* ---- what the board hands the map ---- */
const odds = (level, say = null) => ({ level, text: band(level), say: say ?? band(level), defended: null });
const panel = (o, picked = false) => ({ kind: "declare", targets: [{ id: "c1", map: true, reach: "in", picked, odds: o, hit: { base: 3, toStress: false, taken: 2, now: 7, max: 9 } }, { id: "c2", map: true, reach: "out", why: "too far" }] });
for (let i = 0; i < 4; i++) {
  const [m, out] = BP.reachMarks(panel(odds(i)), T0);
  ok(!("label" in m) && !m.signs && !m.badge, `12 level ${i}: no words over the token, no other sign`);
  eq(m.meter, { n: i + 1, of: 4, name: band(i) }, `13 level ${i}: the ring in four quarters, ${i + 1} heavy, named by the band's words`);
  ok(m.tip === `${T0("ITAC.ui.chance")}: ${band(i)}`, `14 level ${i}: the pointer's tip says the chance in words`);
  ok(m.hover?.label === "-2" && m.hover.signs?.label?.length === 1 && m.hover.signs.label[0].n === "-2" && m.hover.bar?.loss === 2 && m.hover.tip.startsWith(m.tip), `15 level ${i}: under the pointer the pill says what a hit does, alone (the damage mark), the bar as before`);
  eq(out, { cid: "c2", state: "out", tip: "too far" }, `16 level ${i}: a target out of reach looks as before (dimmed, the no-entry sign, the reason)`);
  eq(BP.reachMarks(panel(odds(i), true), T0)[0].meter, m.meter, `17 level ${i}: a chosen target keeps its quarters (the map draws them heavier)`);
}
/* the GM's chance is a per cent: the ring is the band's, the per cent stays in the tip */
const gm = BP.reachMarks(panel(odds(2, "72%")), T0)[0];
ok(gm.meter?.n === 3 && gm.meter.name === band(2) && gm.tip.includes("72%") && !("label" in gm), "18 the GM: the band's quarters, named by the band, the per cent in the tip");
/* a defended chance stays in the tip */
const dfd = { ...odds(1), defended: { ...odds(0), label: T0("ITAC.ui.ifDefends", { how: T0("ITAC.action.block") }) } };
ok(BP.reachMarks(panel(dfd), T0)[0].meter.n === 2 && BP.reachMarks(panel(dfd), T0)[0].tip.includes(band(0)), "19 the chance if the target defends: words in the tip, the ring is the open chance");
/* an area's caught token (ui/board.mjs caught) */
eq(BP.oddsShow(odds(1)), { meter: { n: 2, of: 4, name: band(1) } }, "20 an area's caught token: its quarters");
eq([BP.oddsShow(null), BP.oddsShow({ level: 7, say: "x" }), BP.oddsShow({ level: 1, say: null })], [{}, {}, {}], "21 no chance, no band: nothing (the plain ring)");
/* no switch is left */
const main = readFileSync(new URL("main.mjs", here), "utf8"), board = readFileSync(new URL("ui/board.mjs", here), "utf8"), lang = readFileSync(new URL("lang.mjs", here), "utf8");
ok(!/OddsLook|oddsLook/.test(main + board + lang) && !("setOddsLook" in Kit) && !("ODDS_LOOKS" in Kit), "22 the trial's switch is gone (no setting, no words for it, the board and the legend read none)");
done("check-odds");
