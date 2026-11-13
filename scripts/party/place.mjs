/* FXP2 (TOGL-D1, STAT-14): where the party column may stand. Pure (rects in, bounds out) so node checks it.
   The column stands bottom-left. It may occupy y in [top, bottom] at x in [left, left + width]:
   - bottom = the smallest top of a lower-screen element (players list, hotbar, the map's VRAM meter...) over that x range, minus the gap;
   - top    = the lowest bottom of a left-menu button (scene controls: layers and tools, EVERY one, however far down the column runs) or of an
              upper panel (the map's pins panel, a VRAM meter standing high) over that x range, plus the gap. The old rule counted only buttons
              starting in the upper half of the window, so a long menu (1366x768 GM: 15 groups, the layers column ends at y 608) ran under the
              column's header.
   When the band under the menu cannot hold the whole party (compact cards, no scrolling), the column moves RIGHT of every menu button over its
   x range (layers AND tools column, whatever their length: so switching the menu group does not make it jump sideways) and keeps its full
   height there. It never stands on a menu button and never leaves the screen: its bottom stays above the lower UI, and the panel scrolls
   (as before) when even the column beside the menu is too short. */
export const GAP = 12;     // vertical gap to the menu above / the UI below (as before)
export const GAP_X = 8;    // horizontal gap to the menu buttons on its left

const overX = (r, left, right) => r.width >= 8 && r.height >= 8 && r.left < right && r.right > left;

/* menu: rects of the visible left-menu buttons; low: rects of the visible lower UI (and of panels that may stand either low or high);
   upper: rects of panels that always bound from above; H: window height; width: the column's full width (screen px, the lean included);
   need: px the whole party needs at its smallest (handle + every card compact). Returns { left, top, bottom, beside }. */
export function placeColumn({ H, width, menu = [], low = [], upper = [], need = 0 }) {
  const tall = (r) => r.height < H * 0.9;   // a full-height container is not a button
  const buttons = menu.filter(tall);
  let left = 0, top = 0, bottom = H - 14;
  for (let i = 0; i < 4; i++) {
    const right = left + width;
    bottom = H - 14; top = 0;
    for (const r of low) {
      if (!overX(r, left, right) || r.height >= H * 0.5) continue;
      if (r.top > H * 0.4) bottom = Math.min(bottom, Math.round(r.top) - GAP);
      else if (r.bottom < H * 0.5) top = Math.max(top, Math.round(r.bottom) + GAP);   // a VRAM meter dragged up to the top
    }
    for (const r of upper) if (overX(r, left, right) && r.top < H * 0.5 && r.height < H * 0.9) top = Math.max(top, Math.round(r.bottom) + GAP);
    const mine = buttons.filter((r) => overX(r, left, right));
    for (const r of mine) top = Math.max(top, Math.round(r.bottom) + GAP);
    if (bottom - top >= need || !mine.length) return { left, top: Math.min(top, bottom), bottom, beside: left > 0 };
    /* the band under the menu is too short: step right of every menu button over the column */
    const next = Math.round(Math.max(...mine.map((r) => r.right))) + GAP_X;
    if (next <= left) break;
    left = next;
  }
  return { left, top: Math.min(top, bottom), bottom, beside: left > 0 };
}
