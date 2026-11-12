// node scripts/tactics/check-perf.mjs -- perf P2: what the surfaces write where, so that a redraw does not restyle the whole page.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as V from "./ui/vars.mjs";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = src("../../styles/tactics-ui.css") + src("../../styles/combat.css");

/* ---- A. the numbers for other parts of the page go to the elements that read them, never to <body> */
{
  for (const f of ["./ui/dock.mjs", "./ui/desk.mjs", "./ui/main.mjs", "./ui/board.mjs", "./ui/camera.mjs", "./ui/feedback.mjs", "../combat/bar.mjs", "../combat/banner.mjs"]) {
    const s = src(f);
    ok(!/(document\.body|documentElement)\.style\.setProperty\("--(itd|igd|ita)-(clear|over|toast-maxh|dice-z)"/.test(s), `P2: ${f} writes no page-wide number on the body`);
  }
  /* every number of vars.mjs is read by exactly the elements its rule names: each var() user in the CSS is one of USERS[name] */
  for (const [name, sel] of Object.entries(V.USERS)) {
    const users = [...css.matchAll(new RegExp(`([^{}\\n]+)\\{[^}]*var\\(${name}[,)]`, "g"))].map((m) => m[1].trim());
    ok(users.length > 0, `P2: ${name} is read somewhere`);
    const parts = sel.split(",").map((x) => x.trim());
    for (const u of users) ok(u.split(",").every((x) => parts.some((p) => x.trim().endsWith(p))), `P2: ${name}: "${u}" is one of the elements the rule sets (${sel})`);
  }
}

/* ---- B. setVar: one rule per number in one constructed sheet; an unchanged value is not written; null removes; no sheet = the body */
{
  class Sheet { constructor() { this.cssRules = []; } insertRule(text, i) { const sel = text.slice(0, text.indexOf("{")).trim(), props = new Map();
    const style = { setProperty: (k, v) => { props.set(k, v); writes.push([sel, k, v]); }, removeProperty: (k) => { props.delete(k); writes.push([sel, k, null]); }, props };
    this.cssRules.splice(i, 0, { selectorText: sel, style }); return i; } }
  const writes = [], bodyWrites = [];
  const body = { style: { setProperty: (k, v) => bodyWrites.push([k, v]), removeProperty: (k) => bodyWrites.push([k, null]) } };
  globalThis.CSSStyleSheet = Sheet;
  const doc = { body, adoptedStyleSheets: [] };
  V._reset();
  eq(V.setVar("--itd-clear", "120px", doc), true, "B: a new value is written");
  eq(V.setVar("--itd-clear", "120px", doc), false, "B: the same value again writes nothing");
  V.setVar("--itd-clear", "130px", doc); V.setVar("--itd-over", "200px", doc); V.setVar("--ita-dice-z", "101", doc); V.setVar("--ita-dice-z", null, doc);
  eq(doc.adoptedStyleSheets.length, 1, "B: one sheet, adopted once");
  eq(doc.adoptedStyleSheets[0].cssRules.map((r) => r.selectorText), [".ips-notice", ".mm-dst-chip", "#invincible-combat-bar, #invincible-tactics-dock"], "B: one rule per number, on its readers");
  eq(writes, [[".ips-notice", "--itd-clear", "120px"], [".ips-notice", "--itd-clear", "130px"], [".mm-dst-chip", "--itd-over", "200px"], ["#invincible-combat-bar, #invincible-tactics-dock", "--ita-dice-z", "101"], ["#invincible-combat-bar, #invincible-tactics-dock", "--ita-dice-z", null]], "B: what was written, in order");
  eq(bodyWrites, [], "B: nothing on the body");
  doc.adoptedStyleSheets = [];                                      // another script replaced the list
  V.setVar("--itd-clear", "140px", doc);
  eq(doc.adoptedStyleSheets.length, 1, "B: the sheet goes back when somebody dropped it");
  eq(V.varOf("--itd-clear"), "140px", "B: varOf tells the value written last");
  /* an old browser: no constructed sheets -> the body, as before */
  V._reset(); delete globalThis.CSSStyleSheet;
  const old = { body, adoptedStyleSheets: undefined };
  V.setVar("--itd-over", "90px", old); V.setVar("--itd-over", "90px", old); V.setVar("--itd-over", null, old);
  eq(bodyWrites, [["--itd-over", "90px"], ["--itd-over", null]], "B: without constructed sheets the body carries it (still once per change)");
  /* a name without readers listed stays on the body */
  V._reset(); globalThis.CSSStyleSheet = Sheet; bodyWrites.length = 0;
  V.setVar("--x-other", "1", { body, adoptedStyleSheets: [] });
  eq(bodyWrites, [["--x-other", "1"]], "B: an unknown name stays on the body");
  delete globalThis.CSSStyleSheet; V._reset();
}

/* ---- C. the initiative bar paints a pass only when what it would draw differs from the last paint */
{
  const Bar = await import("../combat/bar.mjs");
  const m = (active) => ({ round: 2, turn: 1, items: [{ id: "a", active: active === "a", hp: { v: 3, max: 6 } }, { id: "b", active: active === "b", hp: { v: 5, max: 6 } }], waiting: false, waitKind: null });
  const x = ["normal", true, true, "pl", false];
  eq(Bar.paintSig(m("a"), x) === Bar.paintSig(m("a"), x), true, "C: the same model and surroundings give the same mark (the trailing pass is skipped)");
  ok(Bar.paintSig(m("a"), x) !== Bar.paintSig(m("b"), x), "C: another turn paints");
  ok(Bar.paintSig({ ...m("a"), items: [{ ...m("a").items[0], hp: { v: 2, max: 6 } }, m("a").items[1]] }, x) !== Bar.paintSig(m("a"), x), "C: a changed number paints");
  ok(Bar.paintSig(m("a"), ["small", true, true, "pl", false]) !== Bar.paintSig(m("a"), x), "C: another size paints");
  ok(Bar.paintSig(m("a"), ["normal", false, true, "pl", false]) !== Bar.paintSig(m("a"), x), "C: the GM's action buttons switched paints");
  const src = readFileSync(new URL("../combat/bar.mjs", import.meta.url), "utf8");
  ok(/keep\.size \|\| loud \|\| created \|\| !wasMounted \|\| holdOn \? null : paintSig\(/.test(src), "C: a pass that keeps a missing tile, a loud one, the first one, a comeback and a rapid-click hold always paint");
  ok((src.match(/paintedSig = null/g) ?? []).length >= 2, "C: the mark is forgotten when the bar is torn down or shows another combat");
}

done("check-perf");
