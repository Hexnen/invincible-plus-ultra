/* DIRECT (2026-11-15, the owner: «fajnie jakby napisy szły w kierunku akcji»): the lettering of an action that has a direction on the board
   reads as GOING that way, the same way on every seat. Pure: no Foundry, no DOM, no engine; the callers (tokenreact/main.mjs, splash/stage.mjs)
   hand in plain documents and use the engine's public options only (`from`, `rotation`, a moving `at`).

   What has a direction: an action with a source token and a struck token, both on the board for the whole table (a blow with its attacker,
   an attack roll with its target; a shove is a blow whose target is then moved the same way). Read from the tokens' DOCUMENTS (scene x/y,
   width/height in squares, the grid size): the same numbers on every seat, never this seat's mesh, view or vision. A source or target the
   GM hid gives no direction (a word pointing at a hidden attacker would show where he stands: DIRECT-1). Everything else has none and is
   lettered exactly as before: healing, stress, getting up, a knock-down without an attacker, a fall (its way is down, off the board's plane),
   a roll without a target, a crowd's shared word.

   What "going that way" is on screen (the comic letterer's three tools, then the motion):
     1. GROW along it: the letters grow from the source side to the far side (the engine's `from`, the Comicraft rule: a sound grows as it
        travels away from its source). The engine bends the size only for a source to the side (|cos| > 0.35); straight up / down keeps
        the straight baseline (LOOK3).
     2. LEAN with it: the word's baseline turns toward the way the blow goes (down-right falls to the right, up-right climbs), at most TILT
        degrees, plus a slight forward climb on a flat blow; a mostly vertical blow keeps the word's own small tilt.
     3. ARRIVE along it: the word comes in from the source side, accelerating, hits home on its contact with a short overshoot past its
        place (the impact), drifts on a little while it stands (the push), and on its exit carries on the same way (follow-through). One
        offset of the word's place, in cap heights, on the word's own clock (its startAt: the table's instant), so every seat shows the
        same pose at the same instant. Reduced motion: no travel (the look of 1 and 2 stays; it is still).
     4. STAND past it (token reactions): the word prefers the side of the struck token AWAY from the source, so the sound bursts out of the
        far side as if knocked through (fitSlot's `toward`). A preference only: cover, the view's edge and the slot's own costs still win, so a
        word may still stand on the source side (seen live: a blow from above on a token near the view's bottom keeps its word above).
   Nothing here can make a word bigger, push it out of the view (travel is clamped by the caller into its view) or change when it strikes. */

export const TILT = 12;          // deg: the most a blow's direction turns a word (readable; the engine's own tilts are 2-8 deg)
export const TILT_K = 0.4;       // the word turns 0.4 of the blow's angle off the horizontal (then capped at TILT)
export const FLAT_CLIMB = 3;     // deg: a flat blow's word climbs a little toward where it goes
export const VERT = 0.3;         // |ux| under this: a mostly vertical blow (no grow, its own tilt kept)
export const MIN_SQ = 0.25;      // source and target closer than a quarter square: no direction
/* the travel, in cap heights of the word and ms (the contact is the word's own: the slam's squash, the drop's landing) */
/* tuned live on lane 5 (2026-11-15): with drift 0.16 / over 0.14 the word stood still to the eye at table zoom (a few px over a 1.2 s hold)
   and the direction read only in the exit's shards; 0.4 / 0.22 make the push visible as a slow slide without breaking the reading */
export const TRAVEL = Object.freeze({ inD: 1.1, over: 0.22, settle: 170, drift: 0.4, outD: 0.9, outMs: 380 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

const docOf = (t) => (t && typeof t === "object" ? (t.document ?? t) : null);
/** the centre of a token on the board, from its document (scene px). gs = the grid size. -> { x, y } | null */
export function centreOf(t, gs = 100) {
  const d = docOf(t);
  if (!d || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
  const w = (Number.isFinite(d.width) ? d.width : 1) * gs, h = (Number.isFinite(d.height) ? d.height : 1) * gs;
  return { x: d.x + w / 2, y: d.y + h / 2 };
}
/** the direction of an action from `src` to `dst` (tokens or documents) on the board, the same on every seat.
    -> { ang (deg, 0 right, 90 down: the scene's and the screen's sense), ux, uy } | null (no direction) */
export function between(src, dst, gs = 100) {
  const a = docOf(src), b = docOf(dst);
  if (!a || !b || a === b) return null;
  if ((a.id != null && a.id === b.id) || a.hidden === true || b.hidden === true) return null;
  const p = centreOf(a, gs), q = centreOf(b, gs);
  if (!p || !q) return null;
  const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
  if (!(d >= MIN_SQ * gs)) return null;
  const ux = dx / d, uy = dy / d;
  return { ang: r3(Math.atan2(uy, ux) * 180 / Math.PI), ux: r3(ux), uy: r3(uy) };
}
/** the engine's `from` for a direction: the angle the sound comes FROM (the opposite way), in (-180, 180] */
export function fromOf(dir) {
  if (!dir) return null;
  let a = dir.ang + 180;
  while (a > 180) a -= 360;
  while (a <= -180) a += 360;
  return r3(a);
}
/** the word's tilt for a direction (deg, positive = clockwise on screen), or `own` for a mostly vertical blow / no direction */
export function tiltOf(dir, own = 0) {
  if (!dir || Math.abs(dir.ux) < VERT) return own;
  const s = Math.sign(dir.ux), deg = Math.asin(clamp(dir.uy, -1, 1)) * 180 / Math.PI;
  return Math.round(clamp(s * TILT_K * deg - s * FLAT_CLIMB * (1 - Math.abs(dir.uy)), -TILT, TILT));
}
/** the look a direction gives a word: { from, rotation } (merge into the play options; null = nothing changes) */
export function lookOf(dir, ownRotation = 0) {
  if (!dir) return null;
  return { from: fromOf(dir), rotation: tiltOf(dir, ownRotation) };
}
/* the slot sides of tokenreact (pure.mjs SLOTS) as unit vectors from the token, for the far-side preference */
export const SLOT_VEC = Object.freeze({ above: [0, -1], aboveR: [0.707, -0.707], aboveL: [-0.707, -0.707], right: [1, 0], left: [-1, 0], below: [0, 1], on: [0, 0] });
export const FAR_K = 0.16;       // how much (in shares of the box's area) the far side is worth: above the slot order's 0.04 a step, under any cover
/** fitSlot's extra score of a side for a direction (lower is better): the far side wins ties of the slot order, the near side loses them */
export function slotBias(slot, toward, area) {
  const v = SLOT_VEC[slot];
  if (!v || !toward || !(area > 0)) return 0;
  return -FAR_K * area * (v[0] * toward.ux + v[1] * toward.uy);
}

const easeIn = (u) => u * u, easeOut = (u) => 1 - (1 - u) * (1 - u);
/** where the word stands off its place at time t (ms since its start), along the direction, in cap heights: the arrival (from -inD to 0
    by the contact), the overshoot (+over, settled by contact + settle), the drift while it stands (up to +drift by the hold's end) and the
    follow-through on the exit (+outD over outMs). contact = ms from the start to the contact; holdEnd = ms from the start to the exit.
    -> { x, y } (cap heights; 0, 0 = its place) */
export function travelAt(dir, t, { contact = 0, holdEnd = 0, reduced = false } = {}) {
  if (!dir || reduced || !Number.isFinite(t)) return { x: 0, y: 0 };
  const T = TRAVEL, c = Math.max(1, contact), he = Math.max(c + T.settle, holdEnd);
  let s;
  if (t <= 0) s = -T.inD;
  else if (t < c) s = -T.inD * (1 - easeIn(t / c));
  else if (t < c + T.settle) { const u = (t - c) / T.settle; s = T.over * Math.sin(Math.PI * u) * (1 - u) + T.drift * 0.15 * u; }
  else if (t < he) s = T.drift * (0.15 + 0.85 * easeOut((t - c - T.settle) / Math.max(1, he - c - T.settle)));
  else s = T.drift + T.outD * easeIn(Math.min(1, (t - he) / T.outMs));
  return { x: r3(s * dir.ux), y: r3(s * dir.uy) };
}
/** the farthest the travel takes the word, in cap heights per side of its place (for the callers' view clamp and checks) */
export function travelReach(dir) {
  if (!dir) return { l: 0, r: 0, u: 0, d: 0 };
  const back = TRAVEL.inD, fwd = TRAVEL.drift + TRAVEL.outD;
  const xs = [-back * dir.ux, fwd * dir.ux, TRAVEL.over * dir.ux], ys = [-back * dir.uy, fwd * dir.uy, TRAVEL.over * dir.uy];
  return { l: r3(Math.max(0, -Math.min(...xs))), r: r3(Math.max(0, Math.max(...xs))), u: r3(Math.max(0, -Math.min(...ys))), d: r3(Math.max(0, Math.max(...ys))) };
}
/** the travel offset in px, clamped so that a box of half sizes (hw, hh) round `c` stays inside `safe` ({ l, t, r, b }); a word that already
    stands past an edge is never moved further out by it. -> { x, y } (px) */
export function clampTravel(c, off, hw, hh, safe) {
  if (!safe || !c) return off;
  const fit = (p, o, lo, hi) => { const a = Math.min(lo, p), b = Math.max(hi, p); return clamp(p + o, a, b) - p; };
  return { x: fit(c.x, off.x, safe.l + hw, safe.r - hw), y: fit(c.y, off.y, safe.t + hh, safe.b - hh) };
}
