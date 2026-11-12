/* Tactical combat, the surfaces: FIXED PLACES (U132, U134; a TRIAL behind the client switch `tacticsSlots`; pure, no DOM).
   USER 2026-11-12: "nie podoba mi się piętrzenie i przeskakiwanie okienek i powiadomień nad dokiem akcji. nie możemy im dać jakiś
   konkretnych miejsc?" Today everything that speaks to the user stands in ONE column over the bar (dock.mjs: the questions, the line,
   the hint, the panel, the bar), and every newcomer pushes the others up. Here each kind of surface has its own place on the screen,
   worked out from what does not change during a turn (the window, the sidebar, the party column, the open desk, the bar's own room),
   never from what comes and goes (a card, a toast, a hint). A place is an anchored box: it grows AWAY from its anchor and never into
   another place, so nothing moves when another surface appears, changes its size or goes.
   THREE VARIANTS (the owner chooses; "off" = the column of today, unchanged):
     a  EDGES      the table speaks from the top, the hands act at the bottom. Under the initiative bar: the line (owed rolls, who the
                   table waits for, the news) and under it the questions; the first-fight hint at the right end of that band. At the
                   bottom: the bar and the armed action's panel on it.
     b  RAIL       one column to read, at the right edge of the map (under the challenges, over the chat): the questions at its top,
                   the hint and the line at its foot. On the GM seat the rail is the foot of the desk's column. At the bottom: the bar
                   and the panel.
     c  WINDOW     one window over the bar shows one thing at a time (a question first, then the armed action, the round's summary,
                   the hint, the legend), the others wait as tabs on its head; the line is a strip glued to the bar's top edge.
   THE RIGHT COLUMN (U134, every variant): the challenges keep a band at the top whose height does not depend on how many there are
   (the challenges HUD folds the rest behind its own "+N more" chip or scrolls in that band); the GM desk starts under the band; the
   chat toasts keep a strip of their own over the chat box (they scroll in it) and never shorten the desk or move the bar.
   Lengths are window px; a box is { x0, y0, x1, y1 }; k = the surfaces' own size (U62, 0.8..1.4). */

export const MODES = Object.freeze(["off", "a", "b", "c"]);
export const modeOf = (v) => (MODES.includes(String(v ?? "").toLowerCase()) ? String(v).toLowerCase() : "off");

/* base sizes (unscaled px, the stylesheet's own numbers: styles/tactics-ui.css) */
export const SIZE = Object.freeze({
  card: 340,        // a question card (.ita-ask)
  wide: 620,        // a wide one (stunts)
  line: 30,         // one row of the line (.itd-wait)
  hint: 340,        // the first-fight hint's column in variant a
  hintH: 150,       // the most the hint may take
  hintRow: 96,      // a: the hint's row across a narrow band
  rail: 360,        // the rail of variant b
  win: 620,         // the window of variant c
  tick: 30,         // the strip on the bar in variant c
  bar2: 104,        // a bar in two rows (what the desk keeps clear of when the bar takes the edge under it)
  beside: 820,      // the least room the bar needs beside the open desk; with less it takes the whole bottom edge (U48)
});
export const GAP = 8;
export const TOAST = Object.freeze({ h: 132, min: 64, share: 0.2 });     // the chat toasts' strip (window px; Foundry's toasts are not scaled by U62)
export const BAND = Object.freeze({ share: 0.38, min: 150, max: 350 });  // the challenges' band when the desk or the rail stands under it
export const PANEL_SHARE = 0.38;                                         // dock.mjs PANEL_SHARE (U105)

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
    f = { mode, W, H, k, staff, hints (the first-fight hints are on for this user), topCx (the middle of that thing), topL (the right edge of what stands at the left under it), top0 (the lowest thing hanging from the top over the
          middle: the initiative bar), side (the sidebar's left edge or W), chatTop (the floating chat box's top or null),
          hud: { present, x0, y1 } (the challenges HUD: its left edge, the end of its cards now), desk: { open, x0, x1, w } | null,
          bar: { lo, hi, top, bottom, cx } (the bar's room and where it stands: dock.mjs works that out as before, without the toasts) }
    -> { mode, toast, band, desk, slots: { line, cards, hint, rail, window, ticker, notice }, up: { lo, hi }, panelMax, reserved: [boxes] } */
export function frame(f) {
  const mode = modeOf(f.mode);
  const W = f.W, H = f.H, k = f.k || 1, bar = f.bar, side = Math.min(W, f.side ?? W);
  const toast = toastStrip({ H, chatTop: f.chatTop });
  const deskOpen = !!(f.staff && f.desk?.open);
  const top0 = Math.max(8, f.top0 ?? 8);
  const out = { mode, toast, band: null, desk: null, slots: {}, up: { lo: bar.lo, hi: bar.hi }, panelMax: r(H * PANEL_SHARE), reserved: [] };
  if (mode === "off") return out;
  const hudOn = !!f.hud?.present;
  /* the challenges' band (U134): a fixed share of the column when the desk (GM: open, or folded to its tab, which keeps the desk's top)
     or the rail (b) stands under it; else down to the toasts */
  const tight = !!f.staff || mode === "b";
  const bandEnd = hudOn ? (tight ? 11 + clamp(H * BAND.share, BAND.min, BAND.max) : toast.top - GAP) : 11;
  out.band = { present: hudOn, y1: r(bandEnd) };
  /* the GM desk: under the band, over the toasts' strip, and over the bar where the bar takes the edge under it */
  const panelMax = r(H * PANEL_SHARE);
  if (f.staff) {
    const dx0 = f.desk?.x0 ?? side - 380 * k;
    const under = deskOpen && dx0 - bar.lo < SIZE.beside * k;
    let floor = toast.top - GAP;
    if (under) floor = Math.min(floor, H - Math.max(bar.bottom - bar.top, SIZE.bar2 * k) - (H - bar.bottom) - 10);
    out.desk = { top: hudOn ? r(bandEnd + GAP) : 11, floor: r(floor), toastH: toast.h, under };
  }
  const deskX0 = deskOpen ? (f.desk?.x0 ?? side) : side;
  /* where the bar took the edge under the open desk, what opens over the bar keeps left of the desk */
  if (out.desk?.under) out.up = { lo: bar.lo, hi: Math.min(bar.hi, deskX0 - 10) };
  /* how far up the panel and the window may reach: never into the band hanging from the top */
  const upTop = top0 + GAP;
  out.panelMax = r(Math.max(110, Math.min(panelMax, bar.top - GAP - upTop)));

  if (mode === "a") {
    /* the band under the initiative bar, between what stands at the left (the map's panels) and the challenges / the open desk */
    const L = Math.max(12, Number(f.topL) || 12), R = Math.min(hudOn && f.hud.x0 ? f.hud.x0 - 10 : side - 12, deskOpen ? deskX0 - 10 : Infinity);
    const lineH = SIZE.line * k, y = top0 + 4;
    /* the hint: the right end of the band beside the questions when both fit side by side; on a narrow band it takes a fixed row under
       the line across the band and the questions start under it (the row is kept while the hints are on, whether a hint shows or not) */
    const side2 = f.hints && R - L >= (SIZE.card + SIZE.hint) * k + GAP;
    const hintW = !f.hints ? 0 : side2 ? SIZE.hint * k : R - L, hintH = !f.hints ? 0 : side2 ? SIZE.hintH * k : SIZE.hintRow * k;
    const cardsR = side2 ? R - hintW - GAP : R;
    /* the line and the questions hang centred under the initiative bar (what hangs above them), as wide as stays free on both sides */
    let lx0 = L, lx1 = cardsR;
    const cx = Number(f.topCx), half = Math.min(cx - L, cardsR - cx);
    if (Number.isFinite(cx) && half * 2 >= SIZE.card * k) { lx0 = cx - half; lx1 = cx + half; }
    out.slots.line = { ...box(lx0, y, lx1, y + lineH), anchor: "top", align: "center" };
    const hy = side2 ? y : y + lineH + 6;
    if (f.hints) out.slots.hint = { ...box(R - hintW, hy, R, hy + hintH), anchor: "top", align: side2 ? "end" : "center" };
    /* the questions may reach down to the bar: a question and the user's own armed panel rarely stand together (a question comes on
       another's turn); when they do, the dock holds the questions over the panel (dock.mjs placeSlots), the panel never moves */
    const cardsTop = (f.hints && !side2 ? hy + hintH + GAP : y + lineH + 6), cardsEnd = Math.max(cardsTop + 140, bar.top - GAP);
    out.slots.cards = { ...box(lx0, cardsTop, lx1, cardsEnd), anchor: "top", align: "center" };
    out.slots.notice = { ...box(R - Math.min(460, R - L), (f.hints && side2 ? y + hintH + GAP : y + lineH + 6), R, H), anchor: "top", align: "end" };
  } else if (mode === "b") {
    /* the rail: the right edge of the map, under the challenges' band, over the toasts' strip; on the GM seat with the desk open it stands
       beside the desk (the desk keeps the column: on that seat the questions are the desk's own cards) */
    const w = Math.min(SIZE.rail * k, W * 0.34);
    let x1 = side - 10, x0 = x1 - w, y0 = Math.max(top0 + 4, (hudOn ? bandEnd : 11) + GAP), y1 = toast.top - GAP;
    if (deskOpen) { x1 = deskX0 - 10; x0 = x1 - w; y0 = top0 + 4; }
    if (bar.top - GAP < y1 && x1 > bar.lo && x0 < bar.hi) y1 = bar.top - GAP;      // never over the bar
    /* its three places share its height: the line's two rows and the hint at its foot as far as there is room, the questions the rest */
    const avail = y1 - y0, lineH = Math.min(2 * SIZE.line * k, avail * 0.22), hintH = f.hints ? Math.min(SIZE.hintH * k, avail * 0.3) : 0;
    out.slots.rail = { ...box(x0, y0, x1, y1), anchor: "top", align: "end" };
    out.slots.line = { ...box(x0, y1 - lineH, x1, y1), anchor: "bottom", align: "end" };
    if (f.hints) out.slots.hint = { ...box(x0, y1 - lineH - GAP - hintH, x1, y1 - lineH - GAP), anchor: "bottom", align: "end" };
    out.slots.cards = { ...box(x0, y0, x1, y1 - lineH - GAP - (f.hints ? hintH + GAP : 0)), anchor: "top", align: "end" };
    out.slots.notice = { ...box(Math.max(12, (bar.lo + Math.min(bar.hi, x0 - 10)) / 2 - 230), top0 + 4, Math.min(bar.hi, x0 - 10), top0 + 120), anchor: "top", align: "center" };
    /* the panel on the bar keeps clear of the rail it reaches up beside */
    if (bar.top - out.panelMax < y1) out.up = { lo: out.up.lo, hi: Math.min(out.up.hi, x0 - 10) };
  } else {
    /* the window over the bar and the strip on the bar's top edge; both as wide as the window may be in the bar's room */
    const U = out.up, room = U.hi - U.lo, w = Math.min(room, SIZE.win * k);
    const cx = clamp(bar.cx, U.lo + w / 2, U.hi - w / 2);
    const tickH = SIZE.tick * k, tickY1 = bar.top - 2;
    out.slots.ticker = { ...box(cx - w / 2, tickY1 - tickH, cx + w / 2, tickY1), anchor: "bottom", align: "center" };
    const winY1 = tickY1 - tickH - GAP, winY0 = Math.max(upTop, winY1 - Math.min(H * 0.5, winY1 - upTop));
    out.slots.window = { ...box(cx - w / 2, winY0, cx + w / 2, winY1), anchor: "bottom", align: "center" };
    out.slots.notice = { ...box(bar.lo, top0 + 4, bar.hi, top0 + 120), anchor: "top", align: "center" };
    out.panelMax = r(Math.max(110, winY1 - winY0 - 34 * k));
  }
  /* what the map keeps its menus and its "My view" chip clear of (zones-api.md section 41): the places reserved for the surfaces,
     whether something stands in them now or not (a place that empties is still that surface's place: the chip does not move into it) */
  const S = out.slots;
  const panelBox = mode === "c" ? S.window : box(out.up.lo, bar.top - out.panelMax - GAP, out.up.hi, bar.top);
  out.reserved = [panelBox, S.rail, S.ticker].filter(Boolean).map((b) => box(b.x0, b.y0, b.x1, b.y1));
  return out;
}

/* ---------- variant c: what the window shows ---------- */
/* priority: a question waits for this user (the fight waits), then what the user is doing, the summary, the hint, the legend */
export const TABS = Object.freeze(["ask", "panel", "sum", "hint", "legend"]);
/** have = { ask: n, panel, sum, hint, legend } (counts or booleans); was = the tab shown last; picked = the tab the user chose (or null);
    fresh = a question arrived since the last draw -> the tab to show, or null (nothing) */
export function tabOf(have, { was = null, picked = null, fresh = false } = {}) {
  const on = (t) => !!have?.[t];
  if (fresh && on("ask")) return "ask";
  if (picked && on(picked)) return picked;
  return TABS.find(on) ?? (was && on(was) ? was : null);
}
