/* Tactical combat, the surfaces: WHAT A USER SET UP FOR THEMSELVES (pure; ui/main.mjs reads and writes it).
   U62  THE SIZE of the dock, the desk and the cards on them: one number, the percent of their drawn size (80..140, step 5), kept per
        BROWSER (a client setting with a slider: the size is about this screen and these eyes, like Foundry's own interface scale, and it
        is separate from that one). The stylesheet scales the two surfaces by it (styles/tactics-ui.css, --ita-scale); the placement
        code keeps working in window pixels.
   U64  THE LAYOUT a user left: the macro bar shown or folded, the key marks, the desk open or folded, which parts of the desk's Table
        tab are folded. Kept per USER (a flag on the user's own document, which every user may write), so it comes back in the next
        session and on another machine. What belongs to one turn (an armed action, an open list, the dock opened to look) is not layout
        and is not kept.
   Everything stored is read through clean(): an unknown key, a wrong type or a value out of range falls back to the default. */
export const SCALE = Object.freeze({ min: 80, max: 140, step: 5, def: 100 });
/** percent -> the percent the surfaces are drawn at (clamped, on the slider's steps; anything unreadable is 100) */
export function scaleOf(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return SCALE.def;
  return Math.max(SCALE.min, Math.min(SCALE.max, Math.round(n / SCALE.step) * SCALE.step));
}
/** the factor the stylesheet multiplies by ("1.15") */
export const factorOf = (v) => String(scaleOf(v) / 100);
/** the factor in force, read back from where the stylesheet reads it (--ita-scale on the body; absent or unreadable = 1) */
export function factor(body) {
  try { const n = parseFloat(body?.style?.getPropertyValue?.("--ita-scale")); return Number.isFinite(n) && n > 0 ? n : 1; } catch { return 1; }
}

/* the parts of the desk's Table tab that fold, and how they stand for a GM who never touched them: the three tools used now and then
   start folded (their headings stay, with their counts), so the per-NPC answers are on screen without scrolling (U80) */
export const FOLDS = Object.freeze({ force: true, hazard: true, karma: true, npcs: false });
export const DEFAULT = Object.freeze({ hotbar: false, keys: false, desk: null, folds: Object.freeze({}) });
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);

/** what was stored -> a layout. `seed`: what this browser remembered before layouts were kept per user ({ hotbar, keys }). */
export function clean(raw, seed = null) {
  const r = isObj(raw) ? raw : null, s = isObj(seed) ? seed : {};
  const folds = {};
  for (const [k, v] of Object.entries(isObj(r?.folds) ? r.folds : {})) if (k in FOLDS && typeof v === "boolean" && v !== FOLDS[k]) folds[k] = v;
  return {
    hotbar: typeof r?.hotbar === "boolean" ? r.hotbar : s.hotbar === true,
    keys: typeof r?.keys === "boolean" ? r.keys : s.keys === true,
    desk: r?.desk === "open" || r?.desk === "folded" ? r.desk : null,      // null: the desk opens or folds by the room the window has, until the GM chooses
    folds,
  };
}
/** is part `id` of the Table tab folded? */
export const folded = (layout, id) => (id in FOLDS ? layout?.folds?.[id] ?? FOLDS[id] : false);
/** a change -> the new layout (never the same object), or the SAME object when nothing changed (nothing is written then) */
export function merge(layout, change) {
  const next = clean({ ...layout, ...(isObj(change) ? change : {}), folds: { ...(layout?.folds ?? {}), ...(isObj(change?.folds) ? change.folds : {}) } });
  return same(layout, next) ? layout : next;
}
export const same = (a, b) => JSON.stringify(clean(a)) === JSON.stringify(clean(b));
/** what goes into the user's flag: only what differs from the default (an untouched layout stores nothing) */
export function stored(layout) {
  const l = clean(layout), out = {};
  if (l.hotbar) out.hotbar = true;
  if (l.keys) out.keys = true;
  if (l.desk) out.desk = l.desk;
  if (Object.keys(l.folds).length) out.folds = l.folds;
  return out;
}
/** U64: how the desk stands when the surfaces start: { collapsed, touched } from the layout, or null (by the room) */
export const deskStart = (layout) => (layout?.desk ? { collapsed: layout.desk === "folded", touched: true } : null);

/** U108: Dice So Nice rolls its dice on a canvas laid over the whole window (z-index 1000, or above every window in its "auto" mode), and
    the dice rolled across the dock and the initiative bar and hid them. While that canvas SHOWS dice (`display` not none, `opacity` not 0)
    the two bars stand one step above it; else (or a canvas under the interface: z below `base`) nothing changes.
    style = { display, opacity, zIndex } of the canvas (strings as the DOM gives them) | null -> the z-index to raise to, or null */
/** U108 (LIVE ver8): one roll, followed. `on` from diceSoNiceRollStart until the dice are gone; the canvas is still hidden when the first
    roll after a pause starts (Dice So Nice shows it a moment later), so a hidden canvas ends the roll only once it was SEEN showing dice.
    state { on, shown }, style of the canvas | null -> the next state */
export function diceWatch(state, style) {
  if (!state?.on) return { on: false, shown: false };
  const vis = !!style && style.display !== "none" && String(style.opacity ?? "") !== "0";
  if (vis) return { on: true, shown: true };
  return state.shown ? { on: false, shown: false } : { on: true, shown: false };
}
export function diceRaise(style, base = 29) {
  if (!style || style.display === "none" || String(style.opacity ?? "") === "0") return null;
  const z = Number.parseInt(style.zIndex, 10);
  return Number.isFinite(z) && z >= base ? z + 1 : null;
}
/** U148 (UX review 1): THE BAR KEEPS ITS SHAPE. One row or the actions over the unit (data-tight) was decided by the width of what the
    bar held at that moment, so a few pixels more after an action resolved (a chip, a longer number) folded the row into two and the
    buttons moved under the pointer; on the GM seat a hero's resting bar was shorter than an NPC's and the camera button took the place
    of "Move". Now the shape is decided by the WIDEST bar this room has held (per width of the room, `memo` : Map), plus `slack` for
    the small growth of one turn: within one room the bar can only go from one row to two once and never back, and the resting bar
    is drawn with every button (dock.mjs), so it is as wide as the bar of a turn. -> { tight: 0 | 1 | 2, width } */
export function steadyShape(memo, avail, natural, inner, slack = 0) {
  const key = String(Math.round(Number(avail) || 0));
  const was = memo?.get?.(key) ?? { natural: 0, inner: 0 };
  const now = { natural: Math.max(was.natural, Number(natural) || 0), inner: Math.max(was.inner, Number(inner) || 0) };
  try { memo?.set?.(key, now); } catch { /* no memory: decided by now alone */ }
  const tight = now.natural + slack > avail ? (now.inner + slack > avail ? 2 : 1) : 0;
  return { tight, width: now.natural };
}

/** U163 (ver11): THE ACTIONS STAY ON ONE ROW. USER 2026-11-12, on the GM's bar at 1366 x 768 with the surfaces at 140 %: "the dock
    wrapped its buttons into a line more again; the star dropped a line lower". The same wrap had come back: in P5 the door button left
    the bar to stop a third row at 1366, and the bar has gained actions since (the star, a group of the scene's actions), so the actions'
    row grew past the room and its last button fell to a line of its own. The narrow forms keep their lines (as before the regression,
    slots2 sheets at 1366): data-tight="1" the actions over the unit, the tail beside the unit; data-tight="2" the tail on a third line.
    What is new is that THE ACTIONS' ROW ALWAYS FITS, whatever number of buttons it gets: where it does not at the user's size (U62),
    the bar alone is drawn smaller, just as much as that row needs, never below `FIT.min` (the slider's floor); everything else of the
    bar keeps the user's size where it fits. `w` = the bar's own (unscaled) px, measured in one row: `natural` the whole row, `acts` the
    actions, `inner` unit + slots + tail with their gaps; `avail` the room in window px; `k` the user's size; `slack` (unscaled px) the
    growth of one turn (a chip by the slots; the actions' row is drawn with every button whether it is the turn or not). The widest bar
    each room has held decides (as U148), so neither the shape nor the size changes under the pointer within a room.
    -> { tight: 0 | 1 | 2, scale (the bar is drawn at), width (window px the bar needs) } */
export const FIT = Object.freeze({ min: 0.8, pad: 26 });
export function barFit(memo, avail, k, w, slack = 0) {
  const A = Number(avail) || 0, K = Number(k) > 0 ? Number(k) : 1, min = Math.min(FIT.min, K);
  const key = `fit:${Math.round(A)}`;
  const was = memo?.get?.(key) ?? { natural: 0, inner: 0, acts: 0 };
  const now = { natural: Math.max(was.natural, Number(w?.natural) || 0), inner: Math.max(was.inner, Number(w?.inner) || 0), acts: Math.max(was.acts, Number(w?.acts) || 0) };
  try { memo?.set?.(key, now); } catch { /* no memory: decided by now alone */ }
  if ((now.natural + slack) * K <= A) return { tight: 0, scale: K, width: Math.round(now.natural * K) };
  const row = now.acts + FIT.pad, scale = Math.max(min, Math.floor(Math.min(K, A / Math.max(1, row)) * 1000) / 1000);
  const tight = (now.inner + slack) * scale <= A ? 1 : 2;
  return { tight, scale, width: Math.round(Math.min(A, Math.max(row, tight === 1 ? now.inner : 0) * scale)) };
}

/** U185 (UX review 2): the middle of the bar in its room [lo, hi]: centred in the room, or over the macro bar (hotCx) when that is open, and
    in both cases kept so that the whole bar (w window px) stays inside the room. Before, only 140 px were kept from each end, so a bar over
    the macro bar beside a popped-out chat slid half under the chat. A bar wider than its room stays centred in it. -> px */
export function barCentre(lo, hi, w, hotCx = null) {
  const L = Number(lo) || 0, H = Number(hi) || 0, half = Math.max(0, Number(w) || 0) / 2, mid = (L + H) / 2;
  const want = Number.isFinite(hotCx) && hotCx !== null ? Number(hotCx) : mid;
  if (half * 2 >= H - L) return Math.round(mid);
  return Math.round(Math.max(L + half, Math.min(H - half, want)));
}

/** U136: the free stretch [lo, hi] beside a window that floats over the map (the popped-out chat, as tall as the map): the dock keeps to
    the WIDER side of it, `gap` px clear; a window outside the stretch, or one that leaves neither side `min` px, changes nothing (then
    the dock stays where it was, under it). r = { left, right } -> { lo, hi } */
export function besideFloating(lo, hi, r, min = 280, gap = 10) {
  if (!r || !(r.right > lo) || !(r.left < hi)) return { lo, hi };
  const left = r.left - gap - lo, right = hi - r.right - gap;
  if (Math.max(left, right) < min) return { lo, hi };
  return left >= right ? { lo, hi: r.left - gap } : { lo: r.right + gap, hi };
}
