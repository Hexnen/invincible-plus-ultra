/* SAMEPIC: one picture for the table (owner, binding: the GM and the players see the SAME moment). PURE (no DOM, no Foundry).
   A lettered moment (the roll splash's word block, a token's reaction word) is laid out from what every seat shares, never from what
   differs per seat: not this window's height, not the open or closed sidebar, not the GM's own panels, not the dice still lying on one
   seat's table, not the tokens one seat's vision shows, not one seat's own Scale. Two seats with the same view (zoom and pan) and the
   same window therefore draw the same picture; two windows of different sizes draw it at the same size and place relative to the token.

   Three tiers, in this order:
   1. SHARED inputs: the token's document box, the other tokens nobody hides, the map note pins (documents), the scene, the grid, the
      table's settings, and a REFERENCE window height (REF_VH) instead of this window's height.
   2. The STANDARD view: this seat's window minus a fixed reserve for Foundry's own bars (RESERVE: the left tool column, the scene bar on
      top, the hotbar and players list at the bottom, the right sidebar as if it were open). Every seat keeps off the same band of the
      view whether its sidebar is open or not and whatever its bars measure.
   3. LOCAL guards: only when the shared picture would really be cut by THIS seat's view edge or hidden under THIS seat's own interface
      (a sidebar wider than the reserve, a smaller window, the GM's desk on a layer under the windows) does this seat move it: first the
      smallest shift, then a new layout. Those are the residual differences (logged per seat as `same: false`). */

/* the REFERENCE window (CSS px, provisional SAMEPIC-1): the moment is sized for its height and laid out inside it, centred on the view's
   middle, on every seat. 1600 x 900: every window at least this big shows one picture; a smaller one moves or shrinks only what it cannot
   show (tier 3) */
export const REF_VH = 900;
export const REF_VW = 1600;
/* Foundry v14's own bars, the band every seat keeps the moment off (CSS px from the window's edges). Measured live on lane 5 (The
   Warehouse, 1600 x 900, GM and Test Gracz 1, 2026-11-14): tool column 16..88 (both), first scene-bar row 16..48 (both; the GM's
   scene list goes on to 176, the player's to 96: per seat, so not part of the band), hotbar top 824 (76 from the bottom), the players
   list 780..884 inside the tool column, open sidebar 1252..1600 (348), collapsed 48. With a few px of air */
export const RESERVE = Object.freeze({ l: 96, t: 54, r: 356, b: 98 });

/* the standard safe rect of a window W x H (client px): the REFERENCE window centred where this window's centre is, minus the reserve. The
   canvas fills the window, so the window's centre is the view's centre: two seats with one view (zoom and the scene point in the middle)
   get one rect around it in scene terms, whatever their window sizes. A thing to describe (p, client px) outside that rect (near the edge
   of a bigger window) widens it to this window's own standard band, or the block could not stand by it: such a moment is seen whole only
   on windows that big anyway. */
export function standardRect(W, H, p = null, reserve = RESERVE) {
  const cx = W / 2, cy = H / 2;
  const r = { l: cx - REF_VW / 2 + reserve.l, t: cy - REF_VH / 2 + reserve.t, r: cx + REF_VW / 2 - reserve.r, b: cy + REF_VH / 2 - reserve.b };
  if (p && !(p.x >= r.l && p.x <= r.r && p.y >= r.t && p.y <= r.b)) {
    r.l = Math.min(r.l, reserve.l); r.t = Math.min(r.t, reserve.t); r.r = Math.max(r.r, W - reserve.r); r.b = Math.max(r.b, H - reserve.b);
  }
  return r;
}

const ar = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
/* how much of rect r (l,t,r,b) lies outside rect s */
export function outsideOf(r, s) { return Math.max(0, (r.r - r.l) * (r.b - r.t) - ar(r, s)); }
/* the part of a moment's box this seat cannot show cleanly: outside its real view, or under one of its own panels */
export function localCost(r, local) {
  let c = local?.safe ? outsideOf(r, local.safe) : 0;
  for (const q of local?.avoid ?? []) c += ar(r, q);
  return c;
}
/* is a shared placement clean on this seat? It may stick out of this seat's view no more than it already sticks out of the standard view
   (then every seat cuts it alike), and it touches none of this seat's own panels */
export function cleanHere(r, std, local, tol = 1) {
  if (!local) return true;
  const out = local.safe ? outsideOf(r, local.safe) : 0, stdOut = std ? outsideOf(r, std) : 0;
  if (out > stdOut + tol) return false;
  for (const q of local.avoid ?? []) if (ar(r, q) > tol) return false;
  return true;
}
/* the smallest shift (dx, dy) that brings rect r inside s (a rect bigger than s is centred on that axis) */
export function shiftInto(r, s) {
  const ax = (lo, hi, a, b) => (hi - lo > b - a ? (a + b) / 2 - (lo + hi) / 2 : lo < a ? a - lo : hi > b ? b - hi : 0);
  return { dx: ax(r.l, r.r, s.l, s.r), dy: ax(r.t, r.b, s.t, s.b) };
}

/* the panels at a corner of the window, as SHARED obstacles: where they stand on the reference window centred like the standard view.
   A seat's panels are not read from its page for the shared layout (their state, length and presence are that user's or the GM's
   alone), so every seat keeps the block off the same zone (provisional SAMEPIC-3). Measured live (lane 5, 1600 x 900, 2026-11-14): the
   party cards (#invincible-party, peek, bottom-left) GM 96..336 x 510..790, player 0..240 x 488..768 (FXLD2 N6 live: WHAM! on them).
   Not a zone: the scene bar's list of scenes (GM to 176 px down, player to 96, x 104..274) and the GM's map meter (.mm-vram 96..360 x
   92..144): a zone in the view would make the map moment depend on the view (FXLD2 N1: one scene place for every view), so on the map
   layers they move only the seat they cover (tier 3, SAMEPIC-4); on the screen layers the moment is drawn over them.
   CSS px from the window corner named by `at`. own = true: at THIS window's own corners (a window smaller than the reference, tier 3) */
export const PANEL_ZONES = Object.freeze([{ at: "bl", l: 0, r: 340, up0: 108, up1: 414 }]);
export function panelZones(W, H, own = false) {
  const ox = own ? 0 : W / 2 - REF_VW / 2, oy1 = own ? H : H / 2 + REF_VH / 2;
  return PANEL_ZONES.map((z) => ({ at: z.at, l: ox + z.l, t: oy1 - z.up1, r: ox + z.r, b: oy1 - z.up0 }));
}

/* the challenges' panel (#ich-dock, top-right, as tall as the challenges standing: the same on every seat) hugs the sidebar: live (lane 5)
   GM sidebar closed 1232..1542, player sidebar open 932..1242, both 48..281. As a shared zone it stands where it is with the sidebar
   open, against the standard view's right edge, at its measured height (box: the panel's client rect on this seat). Its top too is
   measured from the reference window's top (live, take W: a 1366 x 768 seat kept the panel's real top, 66 px lower against the view's
   middle than the GM's, and its blow word took a 0.74 fit the GM's did not) */
export function dockZone(W, H, box) {
  if (!box || !(box.width > 0) || !(box.height > 0)) return null;
  const r = W / 2 + REF_VW / 2 - RESERVE.r + 2, t = H / 2 - REF_VH / 2 + box.top;
  return { l: r - box.width, t, r, b: t + box.height };
}
