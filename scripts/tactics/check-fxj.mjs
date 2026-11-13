// node scripts/tactics/check-fxj.mjs -- polisher J, row U125: (b) a lone range number has the kit's plain range mark (U119); (e) the
// comic splash and the action camera's result beat are one moment (scripts/moment.mjs). (a) is the map's (moinen-maps
// dev/zones-room.test.mjs). What can be held without Foundry; the live look is in dev/combat-handoff.md.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as Kit from "../kit.mjs";
import { MARK_SVG } from "../kit-marks.mjs";
import * as Moment from "../moment.mjs";

const here = new URL(".", import.meta.url);
const src = (f) => readFileSync(new URL(f, here), "utf8");

/* ---- (b) U119: the plain range mark ---- */
ok(Kit.SYM_KINDS.includes("range") && MARK_SVG.range?.w === 16, "b1 the kit knows a plain range mark, as wide as the two arrows of the ends");
ok(MARK_SVG.range.uri !== MARK_SVG.rmax.uri && MARK_SVG.range.uri !== MARK_SVG.rmin.uri, "b2 it is a drawing of its own, not the greatest or the least range");
eq([Kit.markName("range", "en"), Kit.markName("range", "pl")], ["Range", "Zasięg"], "b3 its name: Range / Zasięg (glossary: the word itself)");
ok(/ipu-k-range/.test(Kit.symMarkHtml("range", { n: 0 })) && />0<\/b>/.test(Kit.symMarkHtml("range", { n: 0 })), "b4 the mark with its number (a melee weapon's 0)");
const leg = Kit.LEGEND.flatMap((g) => g.rows.map(([id]) => id));
ok(leg.includes("range") && leg.indexOf("range") < leg.indexOf("rmin"), "b5 the legend shows it, before the two ends");
const mp = src("ui/model-pure.mjs");
/* ANSH (FXJ-4, the user 2026-11-12): the pin follows the answer: one number AND a span are both the range mark (no least / greatest pair) */
ok(/x\.range\[0\] === x\.range\[1\] \? \{ mark: "range"/.test(mp) && /: \{ mark: "range", n: `\$\{x\.range\[0\]\}–\$\{x\.range\[1\]\}`/.test(mp) && !/mark: "rm(in|ax)"/.test(mp), "b6 + FXJ-4 the dock: one number for both ends, and a span, is the range mark, named Range");
const rd = readFileSync(new URL("../../styles/rolldialog.css", here), "utf8");
ok(/\[data-ird-fact="min"\]:has\(\+ \[data-ird-same\]\)::before \{ -webkit-mask-image: var\(--ipu-m-range\); mask-image: var\(--ipu-m-range\); \}/.test(rd), "b7 the roll window's strip: one number for both ends paints the range mark");
const sp = Kit.markSigns("range", { n: 2, name: true });
ok(sp.length === 1 && sp[0].img === MARK_SVG.range.uri && sp[0].name === "Range: 2", "b8 where the map draws: the same picture and name");

/* ---- (e) one moment ---- */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
{
  Moment.active(true);
  const e = Moment.expect(["tokA", "tokB"]);
  const p = Moment.landing(["tokB"], { wait: 250, cap: 1600 });
  await wait(40); e.land(120);
  const ms = await p;
  ok(ms >= 140 && ms < 400, `e1 the splash waits for the blow to land (${ms} ms)`);
  const q = await Moment.landing(["tokZ"], { wait: 60, cap: 1600 });
  ok(q >= 50 && q < 300, `e2 nothing on its way for this roll: a short look, then it goes (${q} ms)`);
  const e2 = Moment.expect(["tokC"]);
  const r = Moment.landing(["tokC"], { cap: 1600 });
  e2.drop();
  ok((await r) < 100, "e3 a beat that will not play lets the splash go at once");
  Moment.expect(["tokD"]);
  const capd = await Moment.landing(["tokD"], { cap: 150 });
  ok(capd >= 140 && capd < 400, `e4 never longer than the cap (${capd} ms)`);
  Moment.active(false);
  eq(await Moment.landing(["tokE"], { wait: 500 }), 0, "e5 outside a tactical fight with shots: the splash goes at once");
  eq(Moment.state().pending.length, 0, "e6 turned off: nothing left waiting");
}
const cam = src("ui/camera.mjs");
ok(/waitFor3DAnimationByMessageID/.test(cam) && /_dice3danimating/.test(cam) && /DICE_MS = 9000/.test(cam), "e7 a result beat waits for the dice in flight (Dice So Nice's own wait, at most 9 s)");
ok(/const RESULT = Object\.freeze\(\["hit", "miss", "kill"\]\)/.test(cam) && /CP\.eventShot\(ev, look\)/.test(cam), "e8 only results wait, and they are asked of the user's look when the dice settle");
ok(/chain\.get\(k\) \?\? Promise\.resolve\(\)/.test(cam), "e9 the beats of one exchange keep their order (the close never overtakes its result)");
ok(/\(waiting\.get\(shownKey\(ev\.inst, c\.focus\)\) \?\? 0\) > 0\) return;/.test(cam), "e10 the quiet cue of the same blow does not move the view while its shot waits");
ok(/exp\?\.land\(Number\.isFinite\(r\.lands\) \? r\.lands : 0\)/.test(cam), "e11 the map's `lands` tells the splash when the blow lands");
const spl = readFileSync(new URL("../splash/main.mjs", here), "utf8");
const iWait = spl.indexOf("Moment.landing(speakerTokens(message)"), iTok = spl.indexOf("const seen = resolveToken(message);");   // FXLD2: the seat's own view is \`seen\`; \`token\` is the board's token on a map layer
ok(iWait > 0 && iTok > iWait && spl.indexOf("await waitDice(message)") < iWait, "e12 the splash: dice, then the camera's landing, then the token's place on screen");

done("check-fxj");
