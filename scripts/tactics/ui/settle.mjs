/* Tactical combat, the surfaces: A PLACEMENT THAT HAS SETTLED IS NOT DONE AGAIN (perf P2-1). Plain DOM, no Foundry globals.
   The dock places itself (dock.mjs place()) after every chat message (three times: the toast floats in), every resize of the things
   around it (a ResizeObserver) and every change of the sidebar, the hotbar, the players list. Each placement measures the bar in three
   states (one row, data-tight="1", data-tight="2"), and on the GM seat with the desk open twice over: several forced layouts of the
   dock, 60-130 ms per call at the round start and while the round queue is answered. Most of those calls find nothing to change.
   THE RULE: a placement is skipped only when everything the last one read then reads the same now: the window, the size, the same
   elements found by the same selectors with the same boxes (or, for a value worked out from many boxes, the same value: derive), the
   dock's own content (the draw count: a draw with new markup, a picture new to the dock, a font) and the dock's own sizes. Such a
   placement would read the same and write the same again, so skipping it changes nothing on screen. PERF5-5: this also holds after a
   run that changed something (it read before it wrote, so whatever its writes moved that it reads makes the next one run); before,
   such a run always forced one more full run.
   recorder() is handed to the placement, which asks its questions of the page through it (q, one, rect) and so leaves the list of what
   it read; unchanged() asks the same questions again. */

const box = (r) => (r ? [r.left, r.top, r.right, r.bottom] : null);
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const sameBox = (a, b) => (a === null || b === null ? a === b : a.length === b.length && a.every((x, i) => x === b[i]));

/** what a placement reads of the page, kept as it reads it. rectOf(el) -> a DOMRect-like box or null (dom.visibleRect) */
export function recorder(doc, rectOf) {
  const lists = [], rects = new Map(), derived = [];
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
    /** PERF5-5: a value worked out from many boxes of which only the sum counts (the initiative bar's tiles move on every turn change, its
        extent does not): fn({ q, one, rect }) reads the page directly and returns plain values; what is kept is fn and its answer, and
        unchanged() asks fn again. The elements fn read are not kept one by one. */
    derive(fn) { const v = fn(plain(doc, rectOf)); derived.push([fn, JSON.stringify(v)]); return v; },
    take: () => ({ lists, rects: [...rects], derived, doc }),
  };
}

/* the same questions, not kept (derive) */
const plain = (doc, rectOf) => ({ q: (sel, from = doc) => (from ? [...from.querySelectorAll(sel)] : []), one(sel, from = doc) { return this.q(sel, from)[0] ?? null; }, rect: (el) => (el ? rectOf(el) : null) });

/** does the page still answer the recorded questions the same way? (the cheap reads first; stops at the first difference) */
export function unchanged(rec, rectOf) {
  try {
    for (const [from, sel, list] of rec.lists) {
      if (from && from.nodeType !== 9 && !from.isConnected) return false;      // an element asked from (not the document) left the page
      if (!sameList(from ? [...from.querySelectorAll(sel)] : [], list)) return false;
    }
    for (const [el, b] of rec.rects) if (!el.isConnected || !sameBox(box(rectOf(el)), b)) return false;
    for (const [fn, v] of rec.derived ?? []) if (JSON.stringify(fn(plain(rec.doc, rectOf))) !== v) return false;
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
