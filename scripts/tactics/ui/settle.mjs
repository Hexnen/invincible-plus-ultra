/* Tactical combat, the surfaces: A PLACEMENT THAT HAS SETTLED IS NOT DONE AGAIN (perf P2-1). Plain DOM, no Foundry globals.
   The dock places itself (dock.mjs place()) after every chat message (three times: the toast floats in), every resize of the things
   around it (a ResizeObserver) and every change of the sidebar, the hotbar, the players list. Each placement measures the bar in three
   states (one row, data-tight="1", data-tight="2"), and on the GM seat with the desk open twice over: several forced layouts of the
   dock, 60-130 ms per call at the round start and while the round queue is answered. Most of those calls find nothing to change.
   THE RULE: a placement is skipped only when the last one (a) changed nothing at all (the dock's attributes, its numbers, the numbers it
   gives the page) and (b) everything it read then reads the same now: the window, the size, the same elements found by the same
   selectors with the same boxes, the dock's own content (the draw count) and the dock's own sizes. Such a placement would read the same
   and write the same again, so skipping it changes nothing on screen. Anything else (a first placement after a draw, one that moved
   the dock, a toast that changed its box) runs as before.
   recorder() is handed to the placement, which asks its questions of the page through it (q, one, rect) and so leaves the list of what
   it read; unchanged() asks the same questions again. */

const box = (r) => (r ? [r.left, r.top, r.right, r.bottom] : null);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameBox = (a, b) => (a === null || b === null ? a === b : a.length === b.length && a.every((x, i) => x === b[i]));

/** what a placement reads of the page, kept as it reads it. rectOf(el) -> a DOMRect-like box or null (dom.visibleRect) */
export function recorder(doc, rectOf) {
  const lists = [], rects = new Map();
  return {
    /** all elements under `from` (default the document) matching `sel` */
    q(sel, from = doc) {
      const list = from ? [...from.querySelectorAll(sel)] : [];
      if (!lists.some(([f, s]) => f === from && s === sel)) lists.push([from, sel, list]);      // a question asked again in the same run is kept once
      return list;
    },
    /** the first such element, or null */
    one(sel, from = doc) { return this.q(sel, from)[0] ?? null; },
    /** the visible box of an element (null when hidden or tiny), as rectOf says */
    rect(el) { const r = el ? rectOf(el) : null; if (el && !rects.has(el)) rects.set(el, box(r)); return r; },
    take: () => ({ lists, rects: [...rects] }),
  };
}

/** does the page still answer the recorded questions the same way? (the cheap reads first; stops at the first difference) */
export function unchanged(rec, rectOf) {
  try {
    for (const [from, sel, list] of rec.lists) {
      if (from && from.nodeType !== 9 && !from.isConnected) return false;      // an element asked from (not the document) left the page
      if (!sameList(from ? [...from.querySelectorAll(sel)] : [], list)) return false;
    }
    for (const [el, b] of rec.rects) if (!el.isConnected || !sameBox(box(rectOf(el)), b)) return false;
    return true;
  } catch { return false; }
}

/** a flat record of plain values (numbers, strings, null); equal when every entry is */
export const sameFacts = (a, b) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i] || (Number.isNaN(x) && Number.isNaN(b[i])));

/** the dock's own sizes in the state it rests in: the stack, each of its blocks and the parts of the bar (offset and scroll sizes) */
export function sizesOf(stack) {
  const out = [];
  if (!stack) return out;
  const add = (el) => out.push(el.className ?? "", el.offsetWidth, el.offsetHeight, el.scrollWidth, el.scrollHeight, el.clientHeight);
  add(stack);
  for (const el of stack.children) {
    add(el);
    if (el.classList?.contains("itd-bar")) for (const p of el.children) add(p);
  }
  return out;
}
