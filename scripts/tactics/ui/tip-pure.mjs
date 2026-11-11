/* Tactical combat, the surfaces: WHERE A TOOLTIP OPENS (ledger U88 / U97). Pure geometry, no DOM.
   ONE RULE for the dock, the question cards and the GM desk:
     a tooltip opens OUTSIDE THE BLOCK its owner stands in, and never on it.
   A block is what the person reads as one thing while choosing: a question card (its head and all its answers), the panel of the armed
   action (its head and its foot), the action bar (both rows of it), the line over the bar, the desk's column. So a tooltip never lies
   on the answers the person is choosing among, nor on the head that says what they are answers to.
   Outside the block, THE NEAREST FREE PLACE to the owner among:
     up     over the block, centred on the owner (the owner's column says whose tooltip it is)
     side   beside the block at the owner's height, left and right; a side with too little room for the tooltip's width takes a
            narrower tooltip (not under NARROW px)
     down   under the block
   so the tooltip of an answer in the top row opens over the card, that of one at the card's left edge beside it, and the eye never
   travels across the card. Where two places are about as near, the earlier in that order wins (LEAN px a step).
   "free" = inside the window and not on another card or panel of the surfaces (`avoid`). When no place is free of those, the one that
   covers least of them; when none is inside the window (a block as large as the window), the one that covers least of the own block.
   The action bar takes `up` only: its tooltips stand right over the bar, where a tactics game shows them.
   Lengths are window px; a rect is { left, top, right, bottom }. */
export const GAP = 8;          // px between the block and the tooltip
export const PAD = 5;          // px kept to the window's edge (Foundry's own tooltip margin)
export const NARROW = 200;     // px: the narrowest tooltip a tight side may ask for
export const LEAN = 24;        // px a place later in the order must be nearer by, to be taken instead of an earlier one
export const ORDER = Object.freeze(["up", "side", "down"]);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
export const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const box = (left, top, s) => ({ left, top, right: left + s.w, bottom: top + s.h });

/** owner, block: rects; size: { w, h } of the tooltip as it is, or (maxW | null) -> { w, h } when it can be measured again at another
    width; win: { w, h }; avoid: rects of the other cards and panels; order: of "up" | "side" | "left" | "right" | "down".
    -> { left, top, side, maxW: null | px (the width the tooltip was measured at), free: nothing covered, w, h } */
export function placeTip({ owner, block, size, win, avoid = [], order = ORDER, gap = GAP, pad = PAD, narrow = NARROW, lean = LEAN }) {
  const measure = typeof size === "function" ? size : () => size;
  const full = measure(null), cx = (owner.left + owner.right) / 2, cy = (owner.top + owner.bottom) / 2;
  const sides = cx <= (block.left + block.right) / 2 ? ["left", "right"] : ["right", "left"];
  const list = order.flatMap((s) => (s === "side" ? sides : [s])), rank = (side) => order.indexOf(order.includes(side) ? side : "side");
  /* how far the eye goes from the owner to a place: the gap between the two boxes */
  const far = (r) => Math.max(0, r.left - owner.right, owner.left - r.right) + Math.max(0, r.top - owner.bottom, owner.top - r.bottom);
  const at = (side) => {
    if (side === "up" || side === "down") {
      const top = side === "up" ? block.top - gap - full.h : block.bottom + gap;
      return { side, maxW: null, s: full, left: clamp(cx - full.w / 2, pad, win.w - pad - full.w), top, fits: side === "up" ? top >= pad : top + full.h <= win.h - pad };
    }
    const room = side === "right" ? win.w - pad - (block.right + gap) : block.left - gap - pad;
    const tight = room < full.w && room >= narrow && typeof size === "function";
    const s = tight ? measure(Math.floor(room)) : full;
    const left = side === "right" ? block.right + gap : block.left - gap - s.w;
    return { side, maxW: tight ? Math.floor(room) : null, s, left, top: clamp(cy - s.h / 2, pad, win.h - pad - s.h), fits: s.w <= room && s.h <= win.h - 2 * pad };
  };
  const all = list.map(at).map((c, i) => { const r = box(c.left, c.top, c.s); return { ...c, i, cover: avoid.reduce((n, a) => n + overlap(r, a), 0), d: far(r) + lean * rank(c.side) }; });
  const inside = all.filter((c) => c.fits);
  let pick = inside.filter((c) => c.cover === 0).sort((a, b) => a.d - b.d || a.i - b.i)[0] ?? inside.slice().sort((a, b) => a.cover - b.cover || a.d - b.d || a.i - b.i)[0] ?? null;
  if (!pick) {
    /* nothing fits outside the block: pull each place into the window and take the one that lies least on the block itself */
    const pulled = all.map((c) => { const left = clamp(c.left, pad, win.w - pad - c.s.w), top = clamp(c.top, pad, win.h - pad - c.s.h), r = box(left, top, c.s); return { ...c, left, top, own: overlap(r, block), cover: avoid.reduce((n, a) => n + overlap(r, a), 0) }; });
    pick = pulled.sort((a, b) => a.own - b.own || a.cover - b.cover || a.i - b.i)[0];
  }
  return { left: Math.round(pick.left), top: Math.round(pick.top), side: pick.side, maxW: pick.maxW, free: !!pick.fits && pick.cover === 0, w: pick.s.w, h: pick.s.h };
}

/** the part of a block that is on screen: a card scrolled half out of its box counts by what shows of it */
export function shown(rect, clip) {
  if (!clip) return rect;
  const r = { left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top), right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom) };
  return r.right > r.left && r.bottom > r.top ? r : rect;
}
/** the order of places for a block of the dock (by its class list) or of the desk */
export const orderFor = (kind) => (kind === "bar" ? ["up"] : ORDER);
