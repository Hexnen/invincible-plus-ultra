// node scripts/tactics/check-pfa.mjs -- PFA (perf PERF5-1 and PERF5-5): the macro bar's own resize no longer rebuilds Dice So Nice, and a
// draw of the dock that put back what stood there does not force a full placement.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as Lay from "./ui/layout-pure.mjs";

const src = (p) => readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n");

/* ---- PERF5-1: the gate (layout-pure.rebuildGate) */
{
  const G = Lay.rebuildGate();
  eq(G.pass(), true, "PERF5-1: a rebuild nobody of ours asked about runs (Dice So Nice as before)");
  G.ours(); G.seen(true);
  eq(G.pass(), false, "PERF5-1: a rebuild only our own resize asked for is let go");
  eq(G.pass(), true, "PERF5-1: the gate lets one go only: the next rebuild runs");
  G.seen(false);
  eq(G.pass(), true, "PERF5-1: a real resize alone rebuilds");
  G.ours(); G.seen(true); G.seen(false);
  eq(G.pass(), true, "PERF5-1: our resize and a real one within Dice So Nice's second: it rebuilds (the window did change)");
  G.seen(false); G.ours(); G.seen(true);
  eq(G.pass(), true, "PERF5-1: a real resize just before ours (one debounced call for both): it rebuilds");
  G.ours(); G.seen(true); G.ours(); G.seen(true);
  eq(G.pass(), false, "PERF5-1: two folds within the second, nothing else: let go");
  eq(G.pass(), true, "PERF5-1: and the gate is open again after it");
}

/* ---- PERF5-1: the wiring in ui/main.mjs */
{
  const mn = src("./ui/main.mjs");
  const hs = mn.slice(mn.indexOf("function hotbarSync(on)"), mn.indexOf("const previews = new Map()"));
  ok(/diceQuiet\(\); const ev = new Event\("resize"\); ownResize = ev; window\.dispatchEvent\(ev\);/.test(hs) && /finally \{ ownResize = null; \}/.test(hs), "PERF5-1: the fold still sends its resize to the page (map director bar, progress line, our surfaces), marked as ours, after arming the gate");
  ok(/if \(!first \|\| fold\) setTimeout\(/.test(hs), "PERF5-1: the resize is sent when it was sent before (a change of the fold, or the first fold)");
  ok(/const d = game\.dice3d, fn = d\?\.resizeAndRebuild;\s*\n\s*if \(typeof fn !== "function"\) return;/.test(hs), "PERF5-1: without Dice So Nice (or without that method) nothing is wrapped");
  ok(/if \(!fn\.ipuGate\) \{ const gated = function \(\.\.\.a\) \{ return diceGate\.pass\(\) \? fn\.apply\(this, a\) : undefined; \}; gated\.ipuGate = true; d\.resizeAndRebuild = gated; \}/.test(hs), "PERF5-1: the instance's rebuild is wrapped once, through the gate, with its own this");
  ok(/listen\(window, "resize", resizeSeen, \{ capture: true, passive: true \}\);/.test(mn) && /const resizeSeen = \(ev\) => diceGate\.seen\(ev === ownResize\);/.test(mn), "PERF5-1: every resize is seen by the gate from the start (a real one before ours is not missed)");
  ok(!/dice-so-nice\/|Dice3D\.prototype/.test(mn), "PERF5-1: Dice So Nice's code is not touched (no import, no prototype)");
}

/* ---- PERF5-5: the dock's draw counts new content only */
{
  const dk = src("./ui/dock.mjs");
  const sig = dk.slice(dk.indexOf("let drawnSig = null;"), dk.indexOf("/* the dock's own sizes"));
  ok(/const drawSig = \(d\) => \[d\?\.onTurn \? 1 : 0, d\?\.rest \? 1 : 0, stack\?\.innerHTML \?\? "", \.\.\.SLOT_NAMES\.map\(\(n\) => slotEls\[n\]\?\.innerHTML \?\? ""\)\]\.join\("\\u0001"\);/.test(sig), "PERF5-5: what a draw drew = the markup of the stack and of every place, and the turn / rest look of the root");
  ok(/if \(sig !== drawnSig\) \{ drawnSig = sig; drawn\+\+; \}/.test(dk), "PERF5-5: only a draw with other content counts as new");
  ok(/slotEls = \{\}; drawnSig = null; kept = null;/.test(dk) && /root = stack = null; drawnSig = null;/.test(dk), "PERF5-5: a new or destroyed dock forgets the last draw (its first draw always places in full)");
  ok(/if \(!place\(\)\) \{ const pe = stack\.querySelector\(":scope > \.itd-panel"\); if \(pe\) requestAnimationFrame\(\(\) => markMore\(pe\)\); \}/.test(dk), "PERF5-5 (U105): a skipped placement still marks the new panel's 'more below'");
  const pl = dk.slice(dk.indexOf("export function place()"), dk.indexOf("let drawnSig = null;"));
  ok(/if \(!root\) return false;/.test(pl) && /return true;\s*\n\}/.test(pl), "PERF5-5: place() says whether it ran");
  /* everything the draw writes into the dock outside the stack and the places would escape the signature: only the root's turn / rest
     classes (in it) and the panel key (an entry animation, no size) */
  const draw = dk.slice(dk.indexOf("function draw(d, ui)"), dk.indexOf("function reveal()"));
  const rootWrites = [...draw.matchAll(/root\.classList\.toggle\("([\w-]+)"/g)].map((m) => m[1]);
  eq(rootWrites.sort(), ["itd-rest", "itd-same", "itd-turn"], "PERF5-5: the draw's own writes on the root are the turn / rest look (in the signature) and the entry key");
}

done("check-pfa");
