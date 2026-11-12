// node scripts/tactics/check-perf.mjs -- perf P2: what the surfaces write where, so that a redraw does not restyle the whole page.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as V from "./ui/vars.mjs";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = src("../../styles/tactics-ui.css") + src("../../styles/combat.css") + src("../../styles/tactics-slots.css");      // U132 (trial): the fixed places' sheet

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
  V.setVar("--itd-clear", "130px", doc); V.setVar("--ita-dice-z", "101", doc); V.setVar("--ita-dice-z", null, doc);
  eq(doc.adoptedStyleSheets.length, 1, "B: one sheet, adopted once");
  eq(doc.adoptedStyleSheets[0].cssRules.map((r) => r.selectorText), [".ips-notice", "#invincible-combat-bar, #invincible-tactics-dock"], "B: one rule per number, on its readers");
  eq(writes, [[".ips-notice", "--itd-clear", "120px"], [".ips-notice", "--itd-clear", "130px"], ["#invincible-combat-bar, #invincible-tactics-dock", "--ita-dice-z", "101"], ["#invincible-combat-bar, #invincible-tactics-dock", "--ita-dice-z", null]], "B: what was written, in order");
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

/* ---- D (P2-1). the dock's placement is skipped only when the last one changed nothing and everything it read reads the same */
{
  const S = await import("./ui/settle.mjs");
  /* a fake page: elements with boxes, a document answering selectors from a table */
  const kids = {}, el = (name, r) => ({ name, r, isConnected: true, nodeType: 1, querySelectorAll: (sel) => kids[name + sel] ?? [] });
  const table = {}, doc = { nodeType: 9, querySelectorAll: (sel) => table[sel] ?? [] };
  const rectOf = (e) => (e.r ? { left: e.r[0], top: e.r[1], right: e.r[2], bottom: e.r[3] } : null);
  const a = el("a", [0, 0, 10, 10]), b = el("b", [20, 0, 30, 10]), party = el("party", [0, 100, 50, 200]), kid = el("kid", [0, 120, 40, 140]);
  table["#x, #y"] = [a, b]; table["#party"] = [party]; kids["party.kid"] = [kid];
  const run = () => { const rec = S.recorder(doc, rectOf); for (const e of rec.q("#x, #y")) rec.rect(e); rec.q("#x, #y"); const p = rec.one("#party"); rec.rect(p); for (const k of rec.q(".kid", p)) rec.rect(k); rec.rect(null); return rec.take(); };
  const kept = run();
  eq(kept.lists.length, 3, "D: each question is kept once (the same selector asked twice in one run)");
  eq(kept.rects.length, 4, "D: each element's box is kept once");
  eq(S.unchanged(kept, rectOf), true, "D: nothing moved: the placement may be skipped");
  b.r = [21, 0, 30, 10];
  eq(S.unchanged(kept, rectOf), false, "D: a box moved by one pixel: the placement runs");
  b.r = [20, 0, 30, 10]; eq(S.unchanged(kept, rectOf), true, "D: back where it was: skipped again");
  b.r = null; eq(S.unchanged(kept, rectOf), false, "D: an element that hid itself: runs");
  b.r = [20, 0, 30, 10];
  const c = el("c", [40, 0, 50, 10]); table["#x, #y"] = [a, b, c];
  eq(S.unchanged(kept, rectOf), false, "D: a new element matching a selector (a chat toast came in): runs");
  table["#x, #y"] = [a, b]; kids["party.kid"] = [];
  eq(S.unchanged(kept, rectOf), false, "D: an element under another one went away: runs");
  kids["party.kid"] = [kid]; party.isConnected = false;
  eq(S.unchanged(kept, rectOf), false, "D: an element asked from left the page: runs");
  party.isConnected = true; kid.isConnected = false;
  eq(S.unchanged(kept, rectOf), false, "D: a measured element left the page: runs");
  kid.isConnected = true;
  eq(S.unchanged(kept, rectOf), true, "D: all back: skipped");
  eq([S.unchanged({ lists: [], rects: [[a, null]] }, () => { throw new Error("x"); }), S.unchanged({ lists: [[{ nodeType: 9, querySelectorAll: () => { throw new Error("x"); } }, "#boom", []]], rects: [] }, rectOf)], [false, false], "D: a read that throws: runs");
  eq([S.sameFacts([1, "a", null, NaN], [1, "a", null, NaN]), S.sameFacts([1, 2], [1, 2, 3]), S.sameFacts(null, []), S.sameFacts([1, 2], [1, 3])], [true, false, false, false], "D: flat facts compare entry by entry");
  /* the dock's own sizes: the stack, its blocks and the parts of the bar */
  const box = (className, w, ch = []) => ({ className, offsetWidth: w, offsetHeight: 10, scrollWidth: w, scrollHeight: 10, clientHeight: 10, children: ch, classList: { contains: (x) => className.split(" ").includes(x) } });
  const stack = box("itd-stack", 300, [box("itd-panel", 280), box("itd-bar", 300, [box("itd-unit", 100), box("itd-slots", 60)])]);
  eq(S.sizesOf(stack).length, 5 * 6, "D: sizes of the stack, the panel, the bar and the bar's parts");
  const before = S.sizesOf(stack); stack.children[1].children[0].offsetWidth = 104;
  eq(S.sameFacts(before, S.sizesOf(stack)), false, "D: a part of the bar that grew without a draw (the Resolve preview): runs");
  eq(S.sizesOf(null), [], "D: no stack, no sizes");
  /* the dock: the rule as wired */
  const dock = readFileSync(new URL("./ui/dock.mjs", import.meta.url), "utf8");
  const head = dock.slice(dock.indexOf("export function place()"), dock.indexOf("function placeNow(rec)")), body = dock.slice(dock.indexOf("function placeNow(rec)"), dock.indexOf("function placeSlots(rec)"));
  /* U132 (trial): the placement of the fixed places keeps the same rule (what it writes is in the outcome too) */
  const slotsBody = dock.slice(dock.indexOf("function placeSlots(rec)"), dock.indexOf("function markMore(el)"));
  ok(/if \(kept && Settle\.sameFacts\(kept\.facts, facts\(\)\) && Settle\.unchanged\(kept\.read, visibleRect\) && Settle\.sameFacts\(kept\.sizes, sizesNow\(\)\)\) return;/.test(head) && /const sizesNow = \(\) => \[\.\.\.Settle\.sizesOf\(stack\)/.test(dock), "D: place() returns early only with kept facts, reads and sizes all the same");
  ok(/kept = null;\s*if \(Slots\.getMode\(\) === "off"\) placeNow\(rec\); else placeSlots\(rec\);\s*if \(Settle\.sameFacts\(before, outcome\(\)\)\) kept = /.test(head), "D: what a run read is kept only when the run changed nothing");
  ok(/const facts = \(\) => \[drawn, window\.innerWidth, window\.innerHeight, Lay\.factor\(document\.body\)\]/.test(head), "D: the draw count, the window and the size are facts of a placement");
  const out = dock.slice(dock.indexOf("function outcome()"), dock.indexOf("function placeNow(rec)"));
  for (const w of ["root.style.cssText", "root.dataset.tight", "root.dataset.under", "underTop", "hint?.style.cssText", "hint?.dataset.tick", 'varOf("--itd-clear")', '"ita-notice-wait"']) ok(out.includes(w), `D: the outcome of a placement includes ${w}`);
  ok(!/document\.(querySelector|querySelectorAll|getElementById)\(|visibleRect\(/.test(body), "D: placeNow asks the page only through the recorder (no read escapes the list)");
  /* every write of placeNow is one the outcome covers: take the known writes away, nothing that writes may be left */
  const rest = body.replace(/root\.style\.(setProperty|removeProperty)\("--itd-under-top"/g, "").replace(/root\.style\.setProperty\("--itd-(room|bottom|maxw|up-maxw|panel-maxh|maxh|cx|up-dx)"/g, "")      // U123 (fixer H): --itd-under-top is a root property too (root.style.cssText in the outcome)
    .replace(/(delete )?root\.dataset\.(tight|under)( = )?/g, "").replace(/document\.body\.classList\.toggle\("ita-notice-wait"/g, "")
    .replace(/setVar\("--itd-(clear|over)"/g, "").replace(/hint\.style\.setProperty\("--itd-hint-x"/g, "").replace(/(delete )?hint\.dataset\.tick( = )?/g, "").replace(/underTop = top/g, "");
  ok(!/\.style\.(setProperty|removeProperty|cssText)|\.dataset\.\w+ =(?!=)|delete [\w.]+\.dataset|classList\.(add|toggle|remove)|setVar\(|setAttribute|removeAttribute|\bunderTop =/.test(rest), "D: placeNow writes nothing outside what the outcome compares");
  ok(!/document\.(querySelector|querySelectorAll|getElementById)\(|visibleRect\(/.test(slotsBody), "D (U132): placeSlots asks the page only through the recorder");
  for (const w of ["el.parentElement?.style.cssText", "el.parentElement?.dataset.anchor", "frameKey", 'varOf("--its-nt")', 'varOf("--its-nx")']) ok(out.includes(w), `D (U132): the outcome of a placement includes ${w}`);
  const restS = slotsBody.replace(/root\.style\.(setProperty|removeProperty)\("--(itd|its)-[\w-]+"/g, "").replace(/(delete )?root\.dataset\.(tight|under)( = )?/g, "").replace(/(delete )?hint\.dataset\.tick( = )?/g, "")
    .replace(/st\.(display|left|width|top|bottom) =/g, "").replace(/st\.setProperty\("--its-[hw]"/g, "").replace(/el\.dataset\.(anchor|align) =/g, "").replace(/setVar\("--its-n[tx]"/g, "").replace(/document\.body\.classList\.remove\("ita-notice-wait"\)/g, "").replace(/frameKey = key/g, "");
  ok(!/\.style\.(setProperty|removeProperty|cssText)|\.dataset\.\w+ =(?!=)|delete [\w.]+\.dataset|classList\.(add|toggle|remove)|setVar\(|setAttribute|removeAttribute/.test(restS), "D (U132): placeSlots writes nothing outside what the outcome compares");
  ok(/drawn\+\+;[^\n]*\n\s*place\(\);\s*\n\s*reveal\(\);/.test(dock), "D: a draw counts before it places (new content always places in full)");
  ok(/addEventListener\("load", \(\) => \{ drawn\+\+; \}, true\)/.test(dock) && /"loadingdone", \(\) => \{ drawn\+\+; \}/.test(dock), "D: a picture or a font that finished loading counts as new content");
  ok(/last = null; kept = null;( slotEls = \{\}; tabWas = tabPicked = null; asksWere = ""; frameKey = "";)? \}/.test(dock), "D: a destroyed dock forgets what it read");
}

done("check-perf");
