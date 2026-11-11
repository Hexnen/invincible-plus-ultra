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
