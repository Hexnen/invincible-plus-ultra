/* Tactical combat, the surfaces: THE FIXED PLACES (U132, U134; pure, no DOM).
   USER 2026-11-12: "nie podoba mi się piętrzenie i przeskakiwanie okienek i powiadomień nad dokiem akcji. nie możemy im dać jakiś
   konkretnych miejsc?" Before, everything that spoke to the user stood in ONE column over the bar (the questions, the line, the hint,
   the panel, the bar) and every newcomer pushed the others up. Now each kind of surface has its own place on the screen, worked out
   from what does not change during a turn (the window, the sidebar, the party column, the initiative bar, the open desk, the bar's own
   room), never from what comes and goes (a card, a toast, a hint). A place is an anchored box: what it holds grows AWAY from its anchor
   and never into another place, so nothing moves when another surface appears, changes its size or goes.
   THE LAYOUT, "top and bottom" (the owner's choice of three trials, 2026-11-12):
     TOP     what the table says hangs from the initiative bar: the line (owed rolls, who the table waits for, the news), under it the
             questions (reaction cards, the summary of the round, the legend); the first-fight hint at the right end of that band
             (on a narrow band it takes the questions' place while no question stands); the end-of-session notice under the hint.
     BOTTOM  the hands act: the bar and, on it, the armed action's panel. The bar never moves for anything that comes and goes.
   THE RIGHT COLUMN (U134): the challenges keep a band at the top whose height does not depend on how many there are (the challenges
   HUD scrolls in it); the GM desk starts under the band, open or folded to its tab, and ends over the toasts' strip, or over the bar
   where the bar takes the edge under it; the chat toasts keep a strip of their own over the chat box (they scroll in it).
   Lengths are window px; a box is { x0, y0, x1, y1 }; k = the surfaces' own size (U62, 0.8..1.4). */

/* base sizes (unscaled px, the stylesheet's own numbers: styles/tactics-ui.css) */
export const SIZE = Object.freeze({
  card: 340,        // a question card (.ita-ask)
  line: 30,         // one row of the line (.itd-wait)
  hint: 340,        // the first-fight hint's column at the right end of the band
  hintH: 150,       // the most the hint may take there
  hintRow: 96,      // the hint in the questions' place (a narrow band)
  notice: 460,      // the end-of-session notice's column
  bar2: 104,        // a bar in two rows (what the desk keeps clear of when the bar takes the edge under it)
  beside: 820,      // the least room the bar needs beside the open desk; with less it takes the whole bottom edge (U48)
  desk: 230,        // the least the open desk keeps over the bar (its head and a few rows); the GM's band gives way for it
});
export const GAP = 8;
export const TOAST = Object.freeze({ h: 132, min: 64, share: 0.2 });     // the chat toasts' strip (window px; Foundry's toasts are not scaled by U62)
export const BAND = Object.freeze({ share: 0.38, min: 150, max: 350 });  // the challenges' band on the GM seat (the desk stands under it)
export const PANEL_SHARE = 0.38;                                         // U105: the most of the window's height the armed action's panel takes

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const r = Math.round;
export const box = (x0, y0, x1, y1) => ({ x0: r(x0), y0: r(y0), x1: r(Math.max(x0, x1)), y1: r(Math.max(y0, y1)) });
export const meets = (a, b) => !!a && !!b && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** where the toasts' strip stands: over the chat box Foundry floats at the bottom right (sidebar folded), else at the bottom edge */
export function toastStrip({ H, chatTop = null }) {
  const bottom = (Number.isFinite(chatTop) && chatTop > H * 0.4 ? chatTop : H) - 6;
  const h = r(clamp(H * TOAST.share, TOAST.min, TOAST.h));
  return { top: bottom - h, bottom, h };
}

/** THE FRAME: every place, from what does not change during a turn.
    f = { W, H, k, staff, hints (the first-fight hints are on for this user),
          top0 (the lowest thing hanging from the top over the middle: the initiative bar), topCx (the middle of the initiative bar),
          topL (the right edge of what stands at the left under it: the map's panels), topR (the left edge of a window floating at the
          right over the band: the popped-out chat; or null), side (the sidebar's left edge or W), chatTop (the floating chat box's top or null),
          hud: { present, x0 } (the challenges HUD: its left edge), desk: { open, x0 } | null (the open GM desk),
          bar: { lo, hi, top, bottom } (the bar's room and where it stands: dock.mjs works that out without the toasts) }
    -> { toast, band, desk, slots: { line, cards, hint, notice }, up: { lo, hi }, panelMax, reserved: [boxes] } */
export function frame(f) {
  const W = f.W, H = f.H, k = f.k || 1, bar = f.bar, side = Math.min(W, f.side ?? W);
  const toast = toastStrip({ H, chatTop: f.chatTop });
  const deskOpen = !!(f.staff && f.desk?.open);
  const top0 = Math.max(8, f.top0 ?? 8);
  const hudOn = !!f.hud?.present;
  const out = { toast, band: null, desk: null, slots: {}, up: { lo: bar.lo, hi: bar.hi }, panelMax: r(H * PANEL_SHARE), reserved: [] };
  /* the challenges' band (U134): on the GM seat a fixed share of the column (the desk, open or folded to its tab, keeps its top under
     it); on a player's seat nothing stands under it, so it reaches down to the toasts */
  let bandEnd = hudOn ? (f.staff ? 11 + clamp(H * BAND.share, BAND.min, BAND.max) : toast.top - GAP) : 11;
  /* the GM desk: under the band, over the toasts' strip, and over the bar where the bar takes the edge under it. Where the bar takes
     that edge (a low window, big surfaces) the band gives way, down to its least, so the open desk keeps room for its head and a few
     rows; worked out the same whether the desk is open or folded, so folding it moves nothing */
  if (f.staff) {
    const dx0 = f.desk?.x0 ?? side - 380 * k;
    const wouldUnder = dx0 - bar.lo < SIZE.beside * k, under = deskOpen && wouldUnder;
    const floorUnder = Math.min(toast.top - GAP, bar.bottom - Math.max(bar.bottom - bar.top, SIZE.bar2 * k) - 10);
    if (hudOn && wouldUnder) bandEnd = Math.max(11 + BAND.min, Math.min(bandEnd, floorUnder - SIZE.desk * k - GAP));
    out.desk = { top: hudOn ? r(bandEnd + GAP) : 11, floor: r(under ? floorUnder : toast.top - GAP), toastH: toast.h, under };
  }
  out.band = { present: hudOn, y1: r(bandEnd) };
  const deskX0 = deskOpen ? (f.desk?.x0 ?? side) : side;
  /* where the bar took the edge under the open desk, the panel over the bar keeps left of the desk */
  if (out.desk?.under) out.up = { lo: bar.lo, hi: Math.min(bar.hi, deskX0 - 10) };
  /* how far up the panel may reach: never into the places hanging from the top */
  out.panelMax = r(Math.max(110, Math.min(out.panelMax, bar.top - GAP - (top0 + GAP))));

  /* THE TOP BAND under the initiative bar, between what stands at the left (the map's panels) and the challenges / the open desk / a
     window floating at the right */
  const L = Math.max(12, Number(f.topL) || 12);
  const R = Math.min(hudOn && Number.isFinite(f.hud.x0) ? f.hud.x0 - 10 : side - 12, deskOpen ? deskX0 - 10 : Infinity, Number.isFinite(f.topR) ? f.topR - 10 : Infinity);
  const lineH = SIZE.line * k, y = top0 + 4;
  /* the hint: the right end of the band beside the questions when both fit side by side; on a narrow band it takes the questions'
     place (its top, as wide as it): a question comes first and the hint waits while one stands (dock.mjs draw) */
  const side2 = !!f.hints && R - L >= (SIZE.card + SIZE.hint) * k + GAP;
  const hintW = side2 ? SIZE.hint * k : 0;
  const cardsR = side2 ? R - hintW - GAP : R;
  /* the line and the questions hang centred under the initiative bar, as wide as stays free on both sides of its middle */
  let lx0 = L, lx1 = cardsR;
  const cx = Number(f.topCx), half = Math.min(cx - L, cardsR - cx);
  if (Number.isFinite(cx) && half * 2 >= SIZE.card * k) { lx0 = cx - half; lx1 = cx + half; }
  out.slots.line = { ...box(lx0, y, lx1, y + lineH), anchor: "top", align: "center" };
  /* the questions may reach down to the bar: a question and the user's own armed panel rarely stand together (a question comes on
     another's turn); when they do, the questions stop over the panel (dock.mjs placeSlots) and the panel never moves */
  const cardsTop = y + lineH + 6, cardsEnd = Math.max(cardsTop + 140, bar.top - GAP);
  out.slots.cards = { ...box(lx0, cardsTop, lx1, cardsEnd), anchor: "top", align: "center" };
  if (f.hints) out.slots.hint = side2 ? { ...box(R - hintW, y, R, y + SIZE.hintH * k), anchor: "top", align: "end" }
    : { ...box(lx0, cardsTop, lx1, cardsTop + SIZE.hintRow * k), anchor: "top", align: "center", share: "cards" };
  /* the end-of-session notice: the right end of the band, under the hint's place (on a narrow band under the line, at the right end
     of the questions' place: the questions stand centred, so it meets them only when they fill the band) */
  const ny = side2 ? y + SIZE.hintH * k + GAP : cardsTop;
  out.slots.notice = { ...box(Math.max(L, R - SIZE.notice), ny, R, ny + 120), anchor: "top", align: "end" };
  /* what the map keeps its menus and its "My view" chip clear of (zones-api.md section 41): the panel's room over the bar and the line's
     row, whether something stands in them now or not (a place that empties is still that surface's place: the chip does not move into it) */
  out.reserved = [box(out.up.lo, bar.top - out.panelMax - GAP, out.up.hi, bar.top), out.slots.line].map((b) => box(b.x0, b.y0, b.x1, b.y1));
  return out;
}
