/* FXX (U185, FXR-5 follow-up): THE POPPED-OUT CHAT'S PLACE IN A FIGHT. Pure: no DOM, no Foundry (scripts/tactics/check-fxx.mjs runs it).
   Foundry opens the popped-out chat in the middle of the window, as tall as the window. At 1366 px that leaves about 190 px on either side
   between the map's panels at the left and the challenges at the right: every fight surface that kept "beside" it (the initiative bar, the
   line, the chase panel and its end card) was squeezed into a strip that no longer read as itself, or ran under the window. A fight screen
   has one place a 300 px column of chat belongs: the right column, where the docked chat lives. So while a fight is shown the popped-out
   chat is PARKED there, against the sidebar's left edge, UNDER the challenges that hang in that column's top (so the top band keeps its
   whole width: the initiative bar stays on its top row, the challenges stay where they were), down to the window's bottom margin. Every
   surface that already keeps clear of the open sidebar keeps clear of it the same way where it shares the chat's height (rightEdge). When
   the challenges leave the chat under PARK_MIN_H, the chat takes the whole height and the challenges stand left of it. A chat the user
   dragged elsewhere is left where the user put it. */

export const PARK_GAP = 6;        // px between the parked chat and the sidebar's tab strip
export const PARK_TOL = 24;       // a chat whose right edge stands this close to the sidebar's left edge counts as parked (user nudges, rounding)
export const CENTRE_TOL = 3;      // Foundry centres a new popout to the pixel (left = (W - w) / 2)
export const PARK_MIN_H = 360;    // a chat shorter than this shows one message card: then it takes the whole height instead
export const PARK_EDGE = 8;       // px kept from the window's bottom and under what hangs above it

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/** the sidebar's left edge in window px, from its rect; W when there is no plausible right-hand column (none, empty, wider than half the window). */
export function sideLeft(r, W) {
  const w = num(W);
  if (!r || !(num(r.width) > 0) || !(num(r.left) > w * 0.5) || !(num(r.left) < w)) return w;
  return Math.round(num(r.left));
}

/** where the chat parks: its right edge PARK_GAP left of the sidebar's left edge; its top under `ceil` (the bottom of what hangs in the
    right column's top: the challenges), down to the window's bottom margin; when that leaves under PARK_MIN_H, the whole height.
    -> { left, top, height } */
export function parkSpot(side, w, H, ceil = 0) {
  const left = Math.max(0, Math.round(num(side) - PARK_GAP - Math.max(0, num(w) || 0)));
  const h = num(H) || 0, c = Math.max(0, num(ceil) || 0);
  const top = c > 0 && h - PARK_EDGE - (c + PARK_EDGE) >= PARK_MIN_H ? Math.round(c + PARK_EDGE) : 0;
  return { left, top, height: Math.max(0, Math.round(h - PARK_EDGE - top)) };
}

/** what hangs in the right column's top over the chat's place: the lowest bottom of the boxes (window rects) that start in the top third
    of the window; 0 when none. Where they stand across does not count: the challenges belong to the right column, and while they stand
    left of the chat for a moment (they were opened over it) the chat still makes room under them, so they go back (no climbing chat). */
export function ceilOver(boxes, H) {
  let c = 0;
  for (const b of Array.isArray(boxes) ? boxes : []) {
    if (!b || !(num(b.width) > 0) || !(num(b.height) > 0)) continue;
    if (num(b.top) > num(H) / 3) continue;
    c = Math.max(c, num(b.bottom));
  }
  return Math.round(c);
}

/** is the chat standing in the right column (parked by us or put there by the user)? r: its rect, side: sideLeft(), W: window width */
export function isParked(r, side, W) {
  if (!r || !(num(r.width) > 0) || !(num(r.height) > 0)) return false;
  const gap = num(side) - num(r.right);
  return gap >= -2 && gap <= PARK_TOL && num(r.left) > num(W) * 0.5;
}

/** is the chat where Foundry put it when it opened (centred across)? */
export function isFoundryDefault(r, W) {
  if (!r || !(num(r.width) > 0)) return false;
  return Math.abs((num(r.left) + num(r.right)) / 2 - num(W) / 2) <= CENTRE_TOL;
}

/** should the chat be (re)parked now? While a fight is shown, a chat that stands where Foundry opened it, or where we parked it last time
    (the window or the sidebar changed size since), moves to the right column; a chat the user dragged anywhere else stays.
    s = { fight, rect, W, H, side, ceil, last: { left, top } | null } -> { left, top, height } | null */
export function parkNow(s) {
  if (!s?.fight || !s.rect) return null;
  const r = s.rect, spot = parkSpot(s.side, r.width, s.H, s.ceil);
  if (Math.abs(num(r.left) - spot.left) <= 1 && Math.abs(num(r.top) - spot.top) <= 1 && Math.abs(num(r.height) - spot.height) <= 1) return null;   // already there
  const ours = !!s.last && Math.abs(num(r.left) - num(s.last.left)) <= 1 && Math.abs(num(r.top) - num(s.last.top)) <= 1;
  return ours || isFoundryDefault(r, s.W) ? spot : null;
}

/** THE RIGHT COLUMN's left edge for every fight surface: the sidebar's left edge, or a parked chat's left edge when one stands left of it.
    side: sideLeft(), chat: the popped-out chat's rect | null, band: the asking surface's { top, bottom } (omitted: any height) -> px.
    A surface wholly above the parked chat (the challenges it parks under) keeps the sidebar's edge. */
export function rightEdge(side, chat, W, band = null) {
  const s = num(side);
  if (!isParked(chat, s, W)) return s;
  if (band && (num(band.bottom) <= num(chat.top) || num(band.top) >= num(chat.bottom))) return s;
  return Math.min(s, Math.round(num(chat.left)));
}
