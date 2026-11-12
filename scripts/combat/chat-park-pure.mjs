/* FXX (U185, FXR-5 follow-up): THE POPPED-OUT CHAT'S PLACE IN A FIGHT. Pure: no DOM, no Foundry (scripts/tactics/check-fxx.mjs runs it).
   Foundry opens the popped-out chat in the middle of the window, as tall as the window. At 1366 px that leaves about 190 px on either side
   between the map's panels at the left and the challenges at the right: every fight surface that kept "beside" it (the initiative bar, the
   line, the chase panel and its end card) was squeezed into a strip that no longer read as itself, or ran under the window. A fight screen
   has one place a 300 px column of chat belongs: the right column, where the docked chat lives. So while a fight is shown the popped-out
   chat is PARKED there, against the sidebar's left edge, and every surface that already keeps clear of the open sidebar keeps clear of it
   the same way (rightEdge). A chat the user dragged elsewhere is left where the user put it. */

export const PARK_GAP = 6;        // px between the parked chat and the sidebar's tab strip
export const PARK_TOL = 24;       // a chat whose right edge stands this close to the sidebar's left edge counts as parked (user nudges, rounding)
export const CENTRE_TOL = 3;      // Foundry centres a new popout to the pixel (left = (W - w) / 2)

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);

/** the sidebar's left edge in window px, from its rect; W when there is no plausible right-hand column (none, empty, wider than half the window). */
export function sideLeft(r, W) {
  const w = num(W);
  if (!r || !(num(r.width) > 0) || !(num(r.left) > w * 0.5) || !(num(r.left) < w)) return w;
  return Math.round(num(r.left));
}

/** where the chat parks: its right edge PARK_GAP left of the sidebar's left edge; top and height stay Foundry's. -> { left } */
export function parkSpot(side, w) {
  return { left: Math.max(0, Math.round(num(side) - PARK_GAP - Math.max(0, num(w) || 0))) };
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
    s = { fight, rect, W, side, last: { left, top } | null } -> { left } | null */
export function parkNow(s) {
  if (!s?.fight || !s.rect) return null;
  const r = s.rect, spot = parkSpot(s.side, r.width);
  if (Math.abs(num(r.left) - spot.left) <= 1) return null;                     // already there
  const ours = !!s.last && Math.abs(num(r.left) - num(s.last.left)) <= 1 && Math.abs(num(r.top) - num(s.last.top)) <= 1;
  return ours || isFoundryDefault(r, s.W) ? spot : null;
}

/** THE RIGHT COLUMN's left edge for every fight surface: the sidebar's left edge, or a parked chat's left edge when one stands left of it.
    side: sideLeft(), chat: the popped-out chat's rect | null -> px */
export function rightEdge(side, chat, W) {
  const s = num(side);
  return isParked(chat, s, W) ? Math.min(s, Math.round(num(chat.left))) : s;
}
