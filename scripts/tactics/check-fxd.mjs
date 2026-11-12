// node scripts/tactics/check-fxd.mjs -- fixer D after live verifier 8: D112 (a slow drag read as a script), U101 (a token shown again
// redraws the initiative bar), U108 (the first roll after a pause on a hidden canvas), U111 (the sticky foot of a capped panel).
// What can be held without Foundry; the live look is in dev/combat-handoff.md.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as MP from "./movement-pure.mjs";
import * as Lay from "./ui/layout-pure.mjs";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");

/* ---- D112: a hand on the map, held however long, is no script; U107's script (no hand) still is */
{
  const run = (steps, at) => { const h = MP.handTracker(); for (const [f, ...a] of steps) h[f](...a); return h.byScript(at); };
  eq(run([], 10000), true, "D112/U107: no hand ever: a script");
  eq(run([["down", 1000, true], ["move", 1100, 1]], 6100), false, "D112: pressed on the map and held 5 s without moving: a hand (the drop comes before the release)");
  eq(run([["down", 1000, true], ["move", 1100, 1], ["move", 2900, 1]], 3000), false, "D112: a 2 s drag: a hand");
  eq(run([["down", 1000, true], ["move", 1200, 1], ["up", 1500]], 1520), false, "D112: the drop handled after the release (an awaited confirm): a hand");
  eq(run([["down", 1000, true], ["up", 1500]], 4000), true, "U107: a release 2.5 s ago and no hand since: a script");
  eq(run([["down", 1000, false], ["up", 1100]], 1200), true, "U107: a press off the map (a macro's button) is no drag: a script");
  eq(run([["down", 1000, false], ["move", 1050, 1]], 1100), true, "U107: moving with a button held off the map is no drag either");
  eq(run([["move", 1000, 0]], 1100), true, "U107: a pointer merely passing over is no hand");
  eq(run([["key", 1000]], 1500), false, "a key within 1.5 s (a token nudged with the keys): a hand");
  eq(run([["down", 1000, true], ["cancel", 1200]], 1300), false, "a cancelled press renews the time once");
  eq(run([["down", 1000, true], ["cancel", 1200]], 3000), true, "...and is no hand after that");
  const mv = src("./movement.mjs");
  /* the listeners on a fake window: capture phase, and a real sequence of a 5 s held drag */
  const L = {}, opts = {}, win = { addEventListener: (ev, fn, o) => { L[ev] = fn; opts[ev] = o; } };
  let now = 0; const h = MP.handTracker(), board = { id: "board" };
  ok(h.listen(win, (e) => e.target === board, () => now) === true, "D112: listen says it follows");
  eq(["pointerdown", "pointermove", "pointerup", "pointercancel", "blur", "keydown"].map((ev) => typeof L[ev] === "function" && opts[ev]?.capture === true), [true, true, true, true, true, true], "D112: every listener on the window in the capture phase");
  now = 1000; L.pointerdown({ target: board }); now = 1300; L.pointermove({ buttons: 1 }); now = 6300;
  eq(h.byScript(now), false, "D112: a press on the map held 5 s: the drop is a hand's");
  L.pointerup({}); now = 9000; eq(h.byScript(now), true, "U107: 2.7 s after the release, no hand: a script");
  now = 9100; L.pointerdown({ target: { id: "hotbar" } }); L.pointerup({}); eq(h.byScript(9150), true, "U107: a click off the map (a macro) is no drag");
  ok(/inputOn = hand\.listen\(window, onBoard, Date\.now\)/.test(mv), "D112: movement.mjs follows the window's hand");
  ok(!/lastInput/.test(mv), "D112: the old release-only time is gone");
}

/* ---- U101: a token shown again (it has no tile then) still redraws the initiative bar */
{
  ok(/if \(!Bar\.touchesToken\(td\) && !\(changes && "hidden" in changes\)\) return;/.test(src("../combat/main.mjs")), "U101: a change of `hidden` always schedules the bar");
}

/* ---- U108: the first roll after a pause */
{
  const H = { display: "none", opacity: "", zIndex: "105" }, V = { display: "", opacity: "", zIndex: "106" };
  let s = { on: true, shown: false };
  s = Lay.diceWatch(s, H); eq(s, { on: true, shown: false }, "U108: the roll starts on a hidden canvas: still on");
  eq(Lay.diceRaise(V), 107, "U108: ...and raised once the canvas shows");
  s = Lay.diceWatch(s, V); eq(s, { on: true, shown: true }, "U108: the canvas shows the dice");
  s = Lay.diceWatch(s, H); eq(s, { on: false, shown: false }, "U108: hidden after it showed: the dice are gone");
  eq(Lay.diceWatch({ on: false, shown: false }, V), { on: false, shown: false }, "U108: a canvas showing between rolls raises nothing");
  eq(Lay.diceWatch({ on: true, shown: true }, { display: "", opacity: "0", zIndex: "106" }), { on: false, shown: false }, "U108: faded out counts as gone");
  ok(/dice = Lay\.diceWatch\(dice, style\)/.test(src("./ui/main.mjs")) && !/diceOn/.test(src("./ui/main.mjs")), "U108: main.mjs follows the roll by diceWatch");
}

/* ---- U111: the sticky foot lies on the panel's edge (a sticky box stops at the scroller's padding) */
{
  const css = readFileSync(new URL("../../styles/tactics-ui.css", import.meta.url), "utf8");
  const pad = /\.itd-panel \{[^}]*padding: 0 12px (\d+)px;/.exec(css)?.[1], foot = /\.itd-panel:not\(\[data-picking\]\) > \.itd-pfoot \{ position: sticky; bottom: -(\d+)px;[^}]*margin: 0 -12px -(\d+)px; padding: 0 12px (\d+)px;/.exec(css);
  ok(pad && foot && foot[1] === pad && foot[2] === pad && foot[3] === pad, `U111: the foot's sticky offset, margin and padding all equal the panel's bottom padding (${pad}, ${foot?.slice(1).join("/")})`);
}

done("check-fxd");
