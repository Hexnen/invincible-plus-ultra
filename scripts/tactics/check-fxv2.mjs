/* node scripts/tactics/check-fxv2.mjs -- fixer FXV2 (2026-11-13): the two leftovers of the short live check before the merge to main
   (dev/combat-defects.md, section "smok"):
     SMOK-1  GM seat: the challenges' layout did not depend on the window alone. The band was fitted to where the HUD's rows end and that
             fitted end was also the floor the HUD laid its rows out in, so compact rows kept the band short and the short band kept them
             compact (1366 -> 1920 stayed compact; a fresh 1920 load shows full cards). The HUD now lays out in the band's room before it is
             fitted (slots-pure band.room); the desk still starts under the rows (band.y1). A change of the rows is said on the window
             (ipu:ich-rows, at once and after the glides), and tactical combat lays the frame out again, so no gap is left over the desk.
     SMOK-2  player seat: the map's tip on a hovered token kept saying "no attribute chosen" after one was chosen (the map words the tip
             only when the pointer comes onto a token). When what a token's marks say changes while it is under the pointer, board.mjs
             takes the token out of its mark sets for one synchronous step: the map drops the stale tip; the next move words the new one. */
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as SP from "./ui/slots-pure.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");

/* ================================================================== SMOK-1: the same window, the same layout */
{
  /* a GM seat at a window size; `end` = where the HUD's rows end (null: not known / not all shown) */
  const seat = (W, H, end) => SP.frame({ W, H, k: 1, staff: true, hints: false, top0: 90, topCx: W / 2, topL: 330, side: W - 48, chatTop: H - 68, listEnd: null,
    hud: { present: true, x0: W - 366, end }, desk: { open: true, x0: W - 406 }, bar: { lo: 330, hi: W - 466, top: H - 118, bottom: H - 8 } });
  for (const [W, H] of [[1366, 768], [1920, 1080]]) {
    const whole = seat(W, H, null);
    for (const end of [125, 200, 290]) eq(seat(W, H, end).band.room, whole.band.room, `SMOK-1: at ${W}x${H} the HUD's room does not depend on where its rows end (${end})`);
    ok(seat(W, H, 125).band.y1 < whole.band.y1, `SMOK-1: at ${W}x${H} the desk still starts under short rows (U234 kept)`);
    eq(whole.band.room, whole.band.y1, `SMOK-1: at ${W}x${H} with the rows unknown the room is the band`);
  }
  eq(seat(1366, 768, 125).band.room === seat(1920, 1080, 125).band.room, false, "SMOK-1: the room follows the window");
  /* the loop as it runs live, with a model of the HUD's planner (two challenges: full cards 124 high, compact 38, gap 6, the list's top 60,
     padding 16): compact exactly when the full cards do not fit the room. Started compact or full, every size settles on one answer. */
  const TOP = 60, PAD = 16, N = 2, FULL = 124, COMP = 38, G = 6;
  const plan = (floor) => (TOP + PAD + N * FULL + (N - 1) * G <= floor ? "full" : "compact");
  const endOf = (mode) => TOP + PAD / 2 + N * (mode === "full" ? FULL : COMP) + (N - 1) * G;
  const settle = (W, H, mode, floorOf) => { for (let i = 0; i < 6; i++) mode = plan(floorOf(seat(W, H, endOf(mode)))); return mode; };
  const answers = {};
  for (const [W, H] of [[1366, 768], [1920, 1080]]) {
    const a = settle(W, H, "compact", (f) => f.band.room), b = settle(W, H, "full", (f) => f.band.room);
    eq(a, b, `SMOK-1: at ${W}x${H} the rows are the same whatever they were before (${a})`);
    answers[W] = a;
    /* premise: the old wiring (the floor = the fitted end) kept the history at 1920 */
    if (W === 1920) ok(settle(W, H, "compact", (f) => f.band.y1) !== settle(W, H, "full", (f) => f.band.y1), "SMOK-1 premise: fed the fitted band, 1920 kept what it was");
  }
  eq([answers[1366], answers[1920]], ["compact", "full"], "SMOK-1: 1366x768 compact, 1920x1080 full cards (as a fresh load shows them)");
  const dock = src("./ui/dock.mjs"), main = src("./ui/main.mjs"), hud = src("../challenges/hud.mjs");
  ok(/handlers\.ichFloor\?\.\(fr\.band\?\.present \? fr\.band\.room : null\)/.test(dock), "SMOK-1: the dock gives the HUD the band's room, not the band fitted to its rows");
  ok(/if \(rowsSig\(\) !== sig0\) rowsMoved\(\);/.test(hud) && /new CustomEvent\("ipu:ich-rows"\)/.test(hud) && /requestAnimationFrame\(tell\)/.test(hud) && /rowsTimer = setTimeout\(tell,/.test(hud),
    "SMOK-1: the HUD says when its rows changed, once they stand and once their glides are over");
  ok(/listen\(window, "ipu:ich-rows", relayout\)/.test(main), "SMOK-1: tactical combat lays the frame out again then (the desk follows the rows)");
}

/* ================================================================== SMOK-2: no stale tip on a hovered token */
{
  /* a model of the map's board (moinen-maps scripts/zones/board.mjs): sets composed into ON, the tip worded only when the hovered token
     changes (setHoverTok), dropped when the hovered token leaves every set (applyMarks) */
  const sets = new Map(), hooks = [];
  let ON = new Map(), hoverTok = null, tipText = null;
  const compose = () => { const m = new Map(); for (const s of sets.values()) for (const e of s.tokens) m.set(e.token, e); return m; };
  const setHoverTok = (id) => { if (id === hoverTok) return; hoverTok = id; const e = id ? ON.get(id) : null; tipText = e ? (e.hover?.tip ?? e.tip ?? null) : null; for (const f of hooks) f(id ? { id } : null); };
  const applyMarks = () => { ON = compose(); if (hoverTok && !ON.has(hoverTok)) setHoverTok(null); };
  const zones = { markTokens: (s) => { sets.set(s.id, s); applyMarks(); return s.id; }, clearTokenMarks: (id) => { const n = sets.delete(id) ? 1 : 0; applyMarks(); return n; },
    pickMove: () => {}, present: () => {}, camera: () => null, hasShot: () => false, onContext: () => {}, intent: () => {}, cancelPick: () => {}, link: () => {}, clearLinks: () => {}, warnOn: () => {}, clearHighlights: () => {}, areaPreview: () => {}, clearArea: () => {},
    zoneOfToken: () => null, range: () => null };
  const pointerOn = (id) => setHoverTok(ON.has(id) ? id : null);      // a pointer move over the token
  globalThis.game = { modules: new Map([["moinen-maps", { active: true, api: { zones } }]]), users: [] };
  globalThis.Hooks = { on: (name, fn) => { if (name === "moinenMapsTokenHover") hooks.push(fn); return 1; }, off: () => {} };
  const B = await import("./ui/board.mjs");
  const tok = (id) => ({ id, object: { visible: true } });
  const cbs = { H1: { token: tok("tH1") }, C1: { token: tok("tC1") } };
  const combat = { combatants: { get: (id) => cbs[id], find: (fn) => Object.entries(cbs).map(([id, c]) => ({ id, tokenId: c.token.id })).find(fn) } };
  ok(B.start({ t: (k) => k, set: () => {}, send: () => {}, refresh: () => {}, request: async () => null, bar: () => null, dock: () => ({}) }) !== false, "SMOK-2 premise: the board starts on the model map");
  const facts = { where: () => null };
  const data = (why) => ({ show: true, who: { id: "H1", name: "Omni" }, panel: { kind: "declare", action: "objective", title: "Act", targets: [{ id: "C1", map: true, reach: "out", picked: true, why }] } });
  const ctx = { combat, facts, view: { ledger: {} }, staff: false, rev: 1 };
  B.sync(data("Not possible right now: no attribute chosen."), ctx);
  pointerOn("tC1");
  eq(tipText, "Not possible right now: no attribute chosen.", "SMOK-2 premise: the pointer on the token words its tip");
  B.sync(data(null), ctx);      // the attribute is chosen: the engine has nothing against it any more
  ok(tipText !== "Not possible right now: no attribute chosen.", "SMOK-2: the old tip does not stay once the token's marks say something else");
  ok(sets.get("ipu.reach")?.tokens.some((e) => e.token === "tC1"), "SMOK-2: the token keeps its marks");
  pointerOn("tC1");
  eq(tipText, null, "SMOK-2: the next pointer move words the tip from the new marks (nothing left to say)");
  B.sync(data("Not possible right now: out of reach."), ctx);
  pointerOn("tC1");
  eq(tipText, "Not possible right now: out of reach.", "SMOK-2: a new reason is the one the tip says");
  const before = tipText;
  B.sync(data("Not possible right now: out of reach."), ctx);      // nothing changed: the tip stands as it is
  eq([tipText, hoverTok], [before, "tC1"], "SMOK-2: marks that say the same leave the open tip alone");
}

done("check-fxv2");
