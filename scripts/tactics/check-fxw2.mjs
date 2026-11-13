// node scripts/tactics/check-fxw2.mjs -- fixer FXW2: U114 (touch only). Foundry core never hears a pointercancel, so a touch drag the
// browser cancels left the token's interaction manager in DRAG: its preview followed the next pointer and the next ordinary tap dropped it.
// The hand tracker now tells movement.mjs of a cancelled press on the map and MP.releaseCoreDrag cancels core's pressed manager.
// What can be held without Foundry; the live before/after is in dev/combat-usability.md (U114).
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as MP from "./movement-pure.mjs";

const src = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const STATES = { NONE: 0, HOVER: 1, CLICKED: 2, GRABBED: 3, DRAG: 4, DROP: 5 };

/* a stand-in of core's MouseInteractionManager: only what cancel() does to the state (mouse-handler.mjs cancel: a pressed manager goes
   back to HOVER, one in DRAG first calls dragLeftCancel; HOVER or less is skipped) */
function manager(state, calls = []) {
  return {
    states: STATES, state,
    cancel() { calls.push("cancel"); if (this.state <= STATES.HOVER) return; if (this.state >= STATES.DRAG) calls.push("dragLeftCancel"); this.state = STATES.HOVER; },
  };
}
const touch = (id = 7) => ({ type: "pointercancel", pointerType: "touch", pointerId: id });

/* ---- releaseCoreDrag: which managers a cancel releases */
{
  for (const [name, st, want] of [["DRAG", STATES.DRAG, 1], ["GRABBED (pressed, not yet moved past the resistance)", STATES.GRABBED, 1], ["CLICKED", STATES.CLICKED, 1],
    ["HOVER", STATES.HOVER, 0], ["NONE", STATES.NONE, 0], ["DROP (core is dropping it)", STATES.DROP, 0]]) {
    const calls = [], m = manager(st, calls);
    eq(MP.releaseCoreDrag({ currentMouseManager: m }, touch()), want, `U114: a touch cancel with the token's manager ${name}: ${want ? "released" : "left alone"}`);
    eq(calls.includes("cancel"), !!want, `U114: ${name}: cancel() ${want ? "called" : "not called"}`);
  }
  { const calls = [], m = manager(STATES.DRAG, calls); MP.releaseCoreDrag({ currentMouseManager: m }, touch());
    eq([m.state, calls], [STATES.HOVER, ["cancel", "dragLeftCancel"]], "U114: a token in DRAG: core's own cancel (dragLeftCancel takes the preview away), back to HOVER"); }
  { const calls = [], m = manager(STATES.DRAG, calls);
    eq(MP.releaseCoreDrag({ currentMouseManager: m }, { type: "pointercancel", pointerType: "mouse", pointerId: 1 }), 0, "U114: a mouse's cancel changes nothing (mouse users see no change)");
    eq([m.state, calls], [STATES.DRAG, []], "U114: ...the mouse's drag is left as it is"); }
  { const m = manager(STATES.DRAG); eq(MP.releaseCoreDrag({ currentMouseManager: m }, { type: "pointercancel", pointerType: "pen", pointerId: 3 }), 1, "U114: a pen's cancel releases as a finger's"); }
  { const calls = [], m = manager(STATES.DRAG, calls);
    eq(MP.releaseCoreDrag({ currentMouseManager: m, mouseInteractionManager: m }, touch()), 1, "U114: the same manager in both places is cancelled once"); }
  { const tok = manager(STATES.DRAG), stage = manager(STATES.GRABBED);
    eq(MP.releaseCoreDrag({ currentMouseManager: tok, mouseInteractionManager: stage }, touch()), 2, "U114: a pressed token and a pressed board: both released");
    eq([tok.state, stage.state], [STATES.HOVER, STATES.HOVER], "U114: ...both back to HOVER"); }
  { const stage = manager(STATES.DRAG); eq(MP.releaseCoreDrag({ currentMouseManager: null, mouseInteractionManager: stage }, touch()), 1, "U114: a board drag (a selection box) cancelled by the browser is released too"); }
  { const bad = { states: STATES, state: STATES.DRAG, cancel() { throw new Error("torn down"); } };
    let n = -1; try { n = MP.releaseCoreDrag({ currentMouseManager: bad }, touch()); } catch { n = "threw"; }
    eq(n, 0, "U114: a manager whose object is gone does not throw out of the listener"); }
  eq([MP.releaseCoreDrag(null, touch()), MP.releaseCoreDrag({}, touch()), MP.releaseCoreDrag({ currentMouseManager: manager(STATES.DRAG) }, null), MP.releaseCoreDrag({ currentMouseManager: { state: 4 } }, touch())],
    [0, 0, 0, 0], "U114: no canvas, no managers, no event, a manager without states/cancel: nothing to do");
}

/* ---- the hand tracker tells of a cancelled press ON THE MAP only (fake window, the listeners as listen() adds them) */
{
  const setup = (withCb = true) => {
    const L = {}, win = { addEventListener: (ev, fn) => { L[ev] = fn; } }, told = [], board = { id: "board" };
    let now = 0; const h = MP.handTracker(MP.BY_HAND_MS, withCb ? (e) => told.push(e.pointerId) : null);
    h.listen(win, (e) => e.target === board, () => now);
    return { L, told, board, h, at: (t) => { now = t; } };
  };
  { const { L, told, board, h, at } = setup();
    at(1000); L.pointerdown({ target: board, pointerId: 7, pointerType: "touch" }); L.pointermove({ buttons: 1 }); at(1200); L.pointercancel(touch(7));
    eq(told, [7], "U114: a touch pressed on the map and cancelled: movement.mjs is told");
    eq([h.held(), h.byScript(1300), h.byScript(3000)], [false, false, true], "D112/U107 unchanged: the cancel ends the hold and renews the time once"); }
  { const { L, told, at } = setup();
    at(1000); L.pointerdown({ target: { id: "hotbar" }, pointerId: 7 }); L.pointercancel(touch(7));
    eq(told, [], "U114: a press off the map (a button) cancelled: core's map state is not touched"); }
  { const { L, told, board, at } = setup();
    at(1000); L.pointerdown({ target: board, pointerId: 7 }); L.pointerup({ pointerId: 7 }); L.pointercancel(touch(7));
    eq(told, [], "U114: a drag that ended normally (released) and a late cancel: nothing to release"); }
  { const { L, told, board, at } = setup();
    at(1000); L.pointerdown({ target: board, pointerId: 7 }); L.pointercancel(touch(9));
    eq(told, [], "U114: a cancel of another pointer (never pressed on the map) leaves the drag of finger 7 alone"); }
  { const { L, told } = setup(); L.pointercancel(touch(7)); eq(told, [], "U114: a cancel with no press before it: nothing"); }
  { const { L, board, at, h } = setup(false); at(1000); L.pointerdown({ target: board, pointerId: 7 });
    let threw = false; try { L.pointercancel(touch(7)); } catch { threw = true; }
    eq([threw, h.held()], [false, false], "U114: a tracker made without the callback (the older checks) still cancels its hold"); }
}

/* ---- end to end on stand-ins: a touch drag, the browser's cancel, then the next ordinary tap (the live sequence of adversary 9) */
{
  const run = (fixed) => {
    const L = {}, win = { addEventListener: (ev, fn) => { L[ev] = fn; } }, calls = [], board = { id: "board" };
    const tok = manager(STATES.HOVER, calls), cv = { currentMouseManager: null, mouseInteractionManager: manager(STATES.HOVER) };
    const h = MP.handTracker(MP.BY_HAND_MS, fixed ? (e) => MP.releaseCoreDrag(cv, e) : null); h.listen(win, (e) => e.target === board, () => 1000);
    L.pointerdown({ target: board, pointerId: 7, pointerType: "touch" }); tok.state = STATES.DRAG; cv.currentMouseManager = tok;      // core: clickLeft, dragLeftStart
    L.pointercancel(touch(7));                                                                                                       // core hears nothing of it
    return { state: tok.state, drop: tok.state === STATES.DRAG ? "the next tap drops the token (move menu)" : "the next tap is a plain tap", calls };
  };
  eq(run(false).state, STATES.DRAG, "U114 before: the cancelled touch drag leaves core in DRAG");
  const after = run(true);
  eq([after.state, after.calls, after.drop], [STATES.HOVER, ["cancel", "dragLeftCancel"], "the next tap is a plain tap"], "U114 after: the manager is cancelled, the preview removed, the next tap is ordinary");
}

/* ---- the wiring in the Foundry-facing file */
{
  const mv = src("./movement.mjs");
  ok(/const hand = MP\.handTracker\(MP\.BY_HAND_MS, \(e\) => MP\.releaseCoreDrag\(globalThis\.canvas, e\)\)/.test(mv), "U114: movement.mjs hands the cancel of a press on the map to releaseCoreDrag with the live canvas");
  ok(/inputOn = hand\.listen\(window, onBoard, Date\.now\)/.test(mv), "D112/U114: one window listener set, as before");
  ok(/add\("pointercancel", \(e\) => \{ const mine = on\.has\(pid\(e\)\); this\.cancel\(clock\(\), pid\(e\)\); if \(mine && onCancel\) onCancel\(e\); \}\)/.test(src("./movement-pure.mjs")),
    "U114: the tracker asks whether the pointer was pressed on the map BEFORE it forgets it");
}

done("fxw2");
