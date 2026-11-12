/* Tactical combat, the surfaces: the tooltips of the dock, the question cards and the GM desk open by ONE RULE (tip-pure.mjs; ledger
   U88 / U97): outside the block the owner stands in, never on it.
   Foundry places a tooltip in TooltipManager#_setAnchor (called by activate() once the tooltip has its text and its class, for the
   pointer and for the keyboard alike). start() wraps that one method on the game's own manager: an owner inside the dock or the desk
   is placed by the rule, everything else goes to Foundry's own placement untouched. Should a later Foundry have no such method, nothing
   is wrapped and the dock's old direction (data-tooltip-direction="UP" on its root) still holds. */
import { placeTip, shown, orderFor } from "./tip-pure.mjs";

const DOCK = "#invincible-tactics-dock", DESK = "#invincible-tactics-desk";
/* the blocks of the dock (dock.mjs draw()) and what a tooltip keeps off besides its own block: the other cards, the panel, the bar, the desk */
const DOCK_BLOCKS = ".ita-ask, .itd-panel, .itd-bar, .itd-wait, .itd-hint1";
/* U103: the line over the bar (who the table waits for, the news) and the first-fight hint are kept off too: a bar button's tooltip opened
   on the news line and hid it; now it takes the place over them ("over" in tip-pure.mjs) */
const KEEP_OFF = `${DOCK} .ita-ask, ${DOCK} .itd-panel, ${DOCK} .itd-bar, ${DOCK} .itd-wait, ${DOCK} .itd-hint1, ${DESK} .igd`;
const rectOf = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };

/** the block of `el` and the order of places for it -> null: not ours, Foundry places it */
export function blockOf(el) {
  const dock = el.closest?.(DOCK);
  if (dock) {
    const b = el.closest(DOCK_BLOCKS);
    if (!b) return null;
    const box = b.closest(".itd-asks");      // a card scrolled half out of the questions' box counts by what shows of it
    return { el: b, rect: shown(rectOf(b), box ? rectOf(box) : null), order: orderFor("dock") };
  }
  const col = el.closest?.(DESK) ? el.closest(".igd") : null;      // the desk is one column of cards: its tooltips open beside the column
  return col ? { el: col, rect: rectOf(col), order: orderFor("desk") } : null;
}

function anchor(tm) {
  const tip = tm.tooltip, el = tm.element, b = el && tip ? blockOf(el) : null;
  if (!b) return false;
  const view = tip.ownerDocument.defaultView, st = tip.style;
  /* measured from the window's corner: a tooltip left near the right edge by its last owner would be measured squeezed */
  const measure = (maxW) => { st.maxWidth = maxW ? `${maxW}px` : ""; st.left = "0px"; st.top = "0px"; st.right = ""; st.bottom = ""; return { w: tip.offsetWidth, h: tip.offsetHeight }; };
  const avoid = [...tip.ownerDocument.querySelectorAll(KEEP_OFF)].filter((x) => x !== b.el && !b.el.contains(x)).map(rectOf).filter((r) => r.right - r.left > 8 && r.bottom - r.top > 8);
  const p = placeTip({ owner: rectOf(el), block: b.rect, size: measure, win: { w: view.innerWidth, h: view.innerHeight }, avoid, order: b.order });
  st.maxWidth = p.maxW ? `${p.maxW}px` : "";
  st.left = `${p.left}px`; st.top = `${p.top}px`; st.right = ""; st.bottom = "";
  tip.classList.remove("text-center", "text-right"); tip.classList.add("text-left");
  tip.dataset.side = p.side;
  return true;
}

let started = false;
/** tm = the game's tooltip manager (main.mjs hands it over) */
export function start(tm) {
  try {
    if (started || !tm || typeof tm._setAnchor !== "function") return;
    started = true;
    const own = tm._setAnchor;
    tm._setAnchor = function (direction) {
      try { this.tooltip.style.maxWidth = ""; delete this.tooltip.dataset.side; if (anchor(this)) return; } catch (e) { console.warn("invincible-plus-ultra | tactics tooltip", e); }
      return own.call(this, direction);
    };
  } catch { /* Foundry's own placement stays */ }
}
