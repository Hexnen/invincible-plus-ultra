/* Challenges HUD: the DOM layer. No Foundry documents in here: main.mjs hands over plain items and callbacks.
   Structure (all built with createElement, text via textContent, nothing from a document is ever parsed as HTML):
     div#invincible-challenges[role=region]  (fixed, pointer-events:none, only the handle and the cards take the pointer)
       button.ich-handle[aria-expanded]      small tab: chevron + "Challenges" + count; toggles the collapsed state
       div.ich-dock#ich-dock                 slides out to the right when collapsed (transform only), made inert
         ul.ich-list > li.ich-item > div.ich-card ... | li.ich-more ("+N more")
   Motion: transform / opacity only. Bars are a scaleX() fill, numbers count with a registered CSS custom property (@property --ich-n),
   so nothing runs per frame in JS. Item shape:
     { id, name, subtitle, img, hidden, selected, cr, crMax, tl, tlMax, unit, crLabel, tlLabel, crHint, tlHint, canOpen, canPan, canDrag } */

import { t, UNITS, DEFAULT_UNIT, unitName, unitLabel } from "./lang.mjs";

const ID = "invincible-challenges";
const L = (k) => t(k);
const F = (k, d) => t(k, d);

let root = null, dock = null, list = null, handle = null, countEl = null, chip = null, chipBtn = null, chipDesc = null;
let byeTimer = 0;
const cards = new Map();   // token id -> { el, li, refs, prev, item }
let collapsed = false, right = 0, scale = 1;
/* View model. What shows and how comes from two client settings (main.mjs -> setView) plus measured numbers: the card heights are read
   from the real cards (full and compact, by a synchronous class swap that is never painted), the room from the viewport minus whatever
   sits under the dock (main.mjs -> setBottom). All layout numbers are in layout px (before the root's scale()). */
let view = { visible: "auto", compact: "auto" };
let expanded = false, curCompact = false, curPlan = { limit: 4, base: 4, compact: false, hidden: 0 };
let lastItems = [], bottomY = 0, hDirty = true, layoutKey = "", wheelOn = false, scrollTimer = 0, sbw = null;
/* Start values only (the real card heights are measured on the first render, measureHeights): a full card is 108 (one-line name, no subtitle) to
   124 (with a subtitle) and 138 with a two-line name; the planner keeps the running maximum. A compact card measures 38; the "+N more" chip 24. */
const M = { full: { h: 124, g: 6 }, compact: { h: 38, g: 4 }, chip: 24, pad: 16, availL: 600, seen: false };
const EASE = "cubic-bezier(.16, 1, .3, 1)";
let cb = { open: () => {}, pan: () => {}, toggle: () => {}, known: () => false, dragStart: () => false, dragEnd: () => {} };

const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

export function configure(callbacks) { cb = { ...cb, ...callbacks }; }

/* ---------- placement (main.mjs measures the sidebar and passes the result) ---------- */
export function setRight(px) {
  right = Math.max(0, Math.round(px) || 0);
  root?.style.setProperty("--ich-right", `${right}px`);
}
export function setScale(s) {
  scale = Math.max(0.8, Math.min(1.6, Number(s) || 1));   // below 0.8 the 12px labels fall under 10px: the setting's slider starts there too
  root?.style.setProperty("--ich-scale", String(scale));
  layoutKey = "";
  relayout();
}
export function setCollapsed(on, silent) {
  collapsed = !!on;
  if (!root) return;
  root.classList.toggle("ich-collapsed", collapsed);
  dock.inert = collapsed;   // not focusable and not readable while it is off screen (the live region still speaks)
  handle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  paintHandle();
  if (!silent && collapsed) pingHandle(false);
}

function paintHandle() {
  if (!handle) return;
  const n = lastItems.length || cards.size;
  countEl.textContent = String(n);
  handle.setAttribute("aria-label", `${L(collapsed ? "INCH.Handle.Show" : "INCH.Handle.Hide")} (${n})`);
  handle.dataset.tooltip = L(collapsed ? "INCH.Handle.Show" : "INCH.Handle.Hide");
}
function pingHandle() {
  if (reduced() || !handle) return;
  handle.classList.remove("ich-ping");
  void handle.offsetWidth;   // restart the one-shot
  handle.classList.add("ich-ping");
}

/* ---------- view model: how many cards, full or compact, expanded or not ---------- */
const normVisible = (x) => { const n = Math.round(Number(x)); return Number.isFinite(n) && n >= 1 ? Math.min(12, n) : "auto"; };
export function setView(v = {}) {
  view = { visible: normVisible(v.visible), compact: ["off", "on", "auto"].includes(v.compact) ? v.compact : "auto" };
  if (root?.isConnected && lastItems.length) render(lastItems, { quiet: true });
}
export function setBottom(y) { bottomY = Number(y) > 0 ? Math.round(y) : 0; relayout(); }
export const visibleLimit = () => curPlan.base;
export const isExpanded = () => expanded;
export const box = () => (root?.isConnected ? root.getBoundingClientRect() : null);

function sbWidth() {   // the thin scrollbar's width, measured once (the list reserves it so cards never change width when it appears)
  if (sbw !== null) return sbw;
  const d = mk("div");
  d.style.cssText = "position:absolute;visibility:hidden;width:80px;height:80px;overflow:scroll;scrollbar-width:thin";
  document.body.append(d);
  sbw = Math.max(0, d.offsetWidth - d.clientWidth);
  d.remove();
  return sbw;
}

/* the plan: how many cards (limit) and full or compact, for `exp` expanded or not. Pure function of the items and the measured numbers,
   so it cannot flicker: it only changes when the count, the room or a card height changes. */
function planFor(items, exp) {
  const n = items.length, sel = items.reduce((a, i) => a + (i.selected ? 1 : 0), 0);
  const room = M.availL - M.pad;
  const fits = (k, c, withChip) => k * c.h + Math.max(0, k - 1) * c.g + (withChip ? M.chip + c.g : 0) <= room;
  const count = (c, withChip) => Math.max(1, Math.floor((room - (withChip ? M.chip + c.g : 0) + c.g) / (c.h + c.g)));
  const want = view.visible === "auto" ? Infinity : view.visible;
  const asked = exp ? n : Math.min(n, want);
  const compact = view.compact === "on" ? true : view.compact === "off" ? false : !fits(asked, M.full, !exp && n > asked);
  const c = compact ? M.compact : M.full;
  const limit = exp ? n : want !== Infinity ? Math.min(n, want) : fits(n, c, false) ? n : Math.min(n, count(c, true));
  return { limit: Math.min(n, Math.max(limit, sel, 1)), compact };
}
function choose(items) {
  const coll = planFor(items, false);
  if (coll.limit >= items.length) expanded = false;   // nothing is folded away: nothing to expand
  const p = expanded ? planFor(items, true) : coll;
  return { limit: p.limit, compact: p.compact, base: coll.limit, hidden: Math.max(0, items.length - coll.limit) };
}

/* the room: list top to the lowest allowed y (main.mjs measured what sits under the dock). Cheap; called on resize and each render. */
function relayout(replan = true) {
  if (!root?.isConnected || !list || root.classList.contains("ich-bye")) return;
  const dw = dock.offsetWidth, key = `${scale}|${innerWidth < 1100}|${innerHeight <= 740}|${dw <= 232 ? 2 : dw <= 264 ? 1 : 0}`;
  if (key !== layoutKey) { layoutKey = key; hDirty = true; M.seen = false; }
  const top = list.getBoundingClientRect().top;
  const limitY = bottomY > top + 80 ? bottomY : innerHeight - 14;
  const cs = getComputedStyle(list);
  M.pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  M.availL = Math.max(100, (limitY - top) / scale);
  list.style.setProperty("--ich-maxh", `${Math.floor(M.availL)}px`);
  if (!replan || !lastItems.length) return;
  const p = choose(lastItems);
  if (hDirty || p.limit !== curPlan.limit || p.compact !== curCompact || p.hidden !== curPlan.hidden) render(lastItems, { quiet: true });
  else syncScroll();
}

/* real card heights, both modes: swap the class, read, swap back (synchronous, never painted). Kept as a running maximum per layout key. */
function measureHeights() {
  hDirty = false;
  const lis = [...list.children].filter((n) => n.classList.contains("ich-item") && !n.classList.contains("ich-leaving"));
  if (!lis.length) return;
  const was = root.classList.contains("ich-compact");
  const read = () => ({ h: lis.reduce((m, li) => Math.max(m, li.offsetHeight), 0), g: parseFloat(getComputedStyle(list).rowGap) || 0 });
  const a = read();
  root.classList.toggle("ich-compact", !was);
  const b = read();
  root.classList.toggle("ich-compact", was);
  const [f, c] = was ? [b, a] : [a, b];
  const keep = (old, cur) => (M.seen ? { h: Math.max(old.h, cur.h), g: cur.g } : cur);
  M.full = keep(M.full, f);
  M.compact = keep(M.compact, c);
  M.seen = true;
  if (chip?.isConnected) M.chip = chip.offsetHeight || M.chip;
}

/* scrolling: only a list that can scroll gets the clip, the styled bar and the (non-passive) wheel guard that keeps the canvas from zooming */
const stopWheel = (ev) => ev.stopPropagation();
function syncScroll() {
  if (!list) return;
  const can = list.scrollHeight > list.clientHeight + 1;
  list.classList.toggle("ich-scrolls", can);
  if (can !== wheelOn) {
    wheelOn = can;
    if (can) list.addEventListener("wheel", stopWheel, { passive: false });
    else list.removeEventListener("wheel", stopWheel);
  }
}

/* ---------- motion helpers (all Web Animations on transform-ish individual properties, so they compose with the CSS ones) ---------- */
const anim = (el, frames, opts) => { try { return el.animate(frames, { easing: EASE, ...opts }); } catch { return null; } };

/* FLIP for cards that stay: first rects (with any running glide included), cancel the running glides, mutate, last rects, inverse translate -> 0.
   Rects are read in one batch before and one after; li elements only (translate), so it never meets the card's own transforms. */
function flipRects() {
  const m = new Map();
  for (const [id, c] of cards) if (c.li.isConnected && !c.li.classList.contains("ich-leaving")) m.set(c.li, c.li.getBoundingClientRect().top);
  if (chip?.isConnected) m.set(chip, chip.getBoundingClientRect().top);
  for (const el of m.keys()) for (const a of el.getAnimations?.() ?? []) if (a.id === "ich-flip") a.cancel();
  return m;
}
function flipPlay(first) {
  if (reduced() || !first.size) return;
  const moves = [];
  for (const [el, y0] of first) if (el.isConnected) { const dy = (y0 - el.getBoundingClientRect().top) / scale; if (Math.abs(dy) > 1) moves.push([el, dy]); }
  for (const [el, dy] of moves) { const a = anim(el, [{ translate: `0 ${dy}px` }, { translate: "0 0" }], { duration: 300 }); if (a) a.id = "ich-flip"; }
}

/* a mode flip (full <-> compact): the cards that stay fade/slide in from a few px, short stagger */
function swapFx() {
  let k = 0;
  const calm = reduced();
  for (const c of cards.values()) {
    if (c.el.classList.contains("ich-new")) continue;
    anim(c.el, calm ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: "11px 0" }, { opacity: 1, translate: "0 0" }], { duration: calm ? 140 : 280, delay: calm ? 0 : Math.min(k++, 6) * 24, fill: "backwards" });
  }
}

/* live outcomes (never on load / re-sort / re-show: paintCard only calls these on a state change seen on a card that already exists) */
function shakeFx(card) {
  card.el.classList.add("ich-hot-fail");
  clearTimeout(card.hot);
  card.hot = setTimeout(() => card.el.classList.remove("ich-hot-fail", "ich-hot-win"), 2600);
  if (reduced()) return;
  anim(card.el, [
    { translate: "0 0", rotate: "0deg" }, { translate: "-7px 0", rotate: "-1.4deg" }, { translate: "6px 0", rotate: "1.2deg" },
    { translate: "-5px 0", rotate: "-.9deg" }, { translate: "3px 0", rotate: ".5deg" }, { translate: "-2px 0", rotate: "-.2deg" }, { translate: "0 0", rotate: "0deg" }
  ], { duration: 520, easing: "ease-out" });
  for (const r of [card.refs.tl, card.refs.cr]) anim(r.bar, [{ translate: "0 0" }, { translate: "-3px 0" }, { translate: "3px 0" }, { translate: "-2px 0" }, { translate: "0 0" }], { duration: 420, delay: 90, easing: "ease-out" });
}
function winFx(card) {
  card.el.classList.add("ich-hot-win");
  clearTimeout(card.hot);
  card.hot = setTimeout(() => card.el.classList.remove("ich-hot-fail", "ich-hot-win"), 3200);
  if (reduced()) return;
  anim(card.el, [{ scale: "1", translate: "0 0" }, { scale: "1.06", translate: "0 -5px" }, { scale: ".99", translate: "0 1px" }, { scale: "1", translate: "0 0" }], { duration: 720, easing: "cubic-bezier(.34, 1.56, .64, 1)" });
  const sweep = card.refs.shine.firstChild;
  anim(sweep, [{ translate: "-140% 0", opacity: 0 }, { opacity: 1, offset: .25 }, { translate: "420% 0", opacity: 0 }], { duration: 760, delay: 80, easing: "ease-in-out" });
  anim(card.refs.cr.bar, [{ scale: "1 1", filter: "brightness(1)" }, { scale: "1 1.5", filter: "brightness(1.7)" }, { scale: "1 1", filter: "brightness(1)" }], { duration: 560 });
  anim(card.refs.stamp, [{ scale: "1" }, { scale: "1.3" }, { scale: ".93" }, { scale: "1" }], { duration: 520, delay: 300 });
}

function toggleExpanded() {
  if (!chip?.isConnected) return;
  expanded = !expanded;
  render(lastItems, { quiet: true });
  cb.remeasure?.();
  say("more", expanded ? F("INCH.Live.Expanded", { n: lastItems.length }) : F("INCH.Live.Collapsed", { n: cards.size, total: lastItems.length }));
  if (!expanded && list) list.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
}

/* ---------- time unit menu (GM): a tiny popover list of the units, a check on the current one ----------
   One element on the body (so no card, clip or scale can cut it), popover="auto": the browser provides the top layer and the outside-click light
   dismiss. Keyboard: Arrow keys / Home / End move, Enter / Space choose (they are buttons), Escape closes (and is kept from Foundry's own Escape),
   Tab leaves and closes. Focus goes to the current unit on open and back to the unit button on close. */
let menu = null, menuFor = null, menuBtn = null, menuClosedAt = 0, menuClosedFor = null;
function ensureMenu() {
  if (menu?.isConnected) return menu;
  menu = mk("div", "ich-umenu");
  menu.id = `${ID}-umenu`;
  menu.setAttribute("popover", "auto");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", L("INCH.Unit.Menu"));
  const title = mk("p", "ich-um-t", L("INCH.Unit.Menu"));
  title.setAttribute("aria-hidden", "true");
  menu.append(title);
  for (const u of UNITS) {
    const b = mk("button", "ich-um-i");
    b.type = "button";
    b.dataset.unit = u;
    b.tabIndex = -1;
    b.setAttribute("role", "menuitemradio");
    b.setAttribute("aria-checked", "false");
    const tick = mk("i", "ich-um-c");
    tick.setAttribute("aria-hidden", "true");
    b.append(tick, mk("span", "ich-um-l", unitLabel(u)));
    menu.append(b);
  }
  menu.addEventListener("click", (ev) => {
    const b = ev.target.closest?.(".ich-um-i");
    if (!b) return;
    const id = menuFor;
    closeMenu(true);
    if (id) cb.setUnit?.(id, b.dataset.unit);
  });
  menu.addEventListener("keydown", (ev) => {
    const items = [...menu.querySelectorAll(".ich-um-i")];
    const at = items.indexOf(document.activeElement);
    let to = null;
    if (ev.key === "ArrowDown") to = items[(at + 1) % items.length];
    else if (ev.key === "ArrowUp") to = items[(at - 1 + items.length) % items.length];
    else if (ev.key === "Home") to = items[0];
    else if (ev.key === "End") to = items[items.length - 1];
    else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closeMenu(true); return; }
    else if (ev.key === "Tab") { closeMenu(false); return; }
    else return;
    ev.preventDefault();
    ev.stopPropagation();
    to?.focus();
  });
  menu.addEventListener("toggle", (ev) => {
    if (ev.newState !== "closed") return;
    menuClosedAt = performance.now();
    menuClosedFor = menuFor;
    menuBtn?.setAttribute("aria-expanded", "false");
    menuFor = null;
    menuBtn = null;
  });
  document.body.appendChild(menu);
  return menu;
}
function checkMenu(unit) {
  for (const b of menu?.querySelectorAll(".ich-um-i") ?? []) b.setAttribute("aria-checked", b.dataset.unit === unit ? "true" : "false");
}
function toggleMenu(btn) {
  const id = btn.closest(".ich-item")?.dataset.id;
  if (!id) return;
  // a press on the button while its menu is open first light-dismisses the menu (pointerdown), then arrives here as a click: that is a close, not a reopen
  if (menuFor === id) { closeMenu(true); return; }
  if (menuClosedFor === id && performance.now() - menuClosedAt < 600) return;
  const card = cards.get(id);
  if (!card) return;
  const m = ensureMenu();
  if (menuFor) closeMenu(false);
  menuFor = id;
  menuBtn = btn;
  checkMenu(card.item?.unit);
  btn.setAttribute("aria-expanded", "true");
  try { m.showPopover(); } catch { menuFor = menuBtn = null; btn.setAttribute("aria-expanded", "false"); return; }
  const r = btn.getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w));
  const below = r.bottom + 4 + h <= innerHeight - 8;
  m.style.left = `${Math.round(left)}px`;
  m.style.top = `${Math.round(below ? r.bottom + 4 : Math.max(8, r.top - 4 - h))}px`;
  (m.querySelector('.ich-um-i[aria-checked="true"]') ?? m.querySelector(".ich-um-i"))?.focus({ preventScroll: true });
}
function closeMenu(refocus) {
  const btn = menuBtn;
  try { if (menu?.matches(":popover-open")) menu.hidePopover(); } catch { /* already closed */ }
  if (refocus && btn?.isConnected && !btn.hidden) btn.focus({ preventScroll: true });
}
/* after every render: the menu follows its card (the unit changed from the sheet, the card left the list) */
function syncMenu() {
  if (!menuFor) return;
  const card = cards.get(menuFor);
  if (!card || card.li.classList.contains("ich-leaving") || card.refs.tl.unitB.hidden) { closeMenu(false); return; }
  menuBtn = card.refs.tl.unitB;
  menuBtn.setAttribute("aria-expanded", "true");
  checkMenu(card.item?.unit);
}
function killMenu() {
  menuFor = null;
  try { if (menu?.matches(":popover-open")) menu.hidePopover(); } catch { /* gone */ }
  menu?.remove();
  menu = menuBtn = null;
}


/* ---------- live region (screen readers): one polite status, messages gathered for a moment and read together ---------- */
let live = null, liveTimer = 0;
const pending = new Map();   // key -> text (a later message about the same challenge replaces the earlier one)
function say(key, text) {
  if (!text) return;
  pending.set(key, text);
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    const text2 = [...pending.values()].join(". ");
    pending.clear();
    if (!live?.isConnected) {
      live = mk("div", "ich-sr");
      live.id = `${ID}-live`;
      live.setAttribute("role", "status");
      live.setAttribute("aria-live", "polite");
      live.setAttribute("aria-atomic", "true");
      document.body.appendChild(live);
    }
    live.textContent = "";
    setTimeout(() => { if (live) live.textContent = text2; }, 40);   // clear first so the same sentence is read again
  }, 600);
}

/* ---------- root ---------- */
function ensureRoot() {
  if (root?.isConnected) {
    if (root.classList.contains("ich-bye")) { clearTimeout(byeTimer); root.classList.remove("ich-bye"); }
    return;
  }
  root = mk("div");
  root.id = ID;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", L("INCH.Region"));
  root.style.setProperty("--ich-right", `${right}px`);
  root.style.setProperty("--ich-scale", String(scale));

  handle = mk("button", "ich-handle");
  handle.type = "button";
  handle.setAttribute("aria-controls", "ich-dock");
  handle.dataset.tooltipDirection = "LEFT";
  handle.append(mk("i", "ich-chev"), mk("span", "ich-hl", L("INCH.Region")), countEl = mk("b", "ich-count", "0"));
  handle.firstChild.setAttribute("aria-hidden", "true");
  handle.addEventListener("click", () => { setCollapsed(!collapsed, true); cb.toggle(collapsed); });

  dock = mk("div", "ich-dock");
  dock.id = "ich-dock";
  list = mk("ul", "ich-list");
  list.id = "ich-list";
  list.setAttribute("role", "list");
  dock.append(list);
  root.append(handle, dock);
  const sw = sbWidth();
  root.style.setProperty("--ich-sbw", `${sw}px`);
  root.style.setProperty("--ich-pr", `${Math.max(0, Math.min(4, 12 - sw))}px`);
  wheelOn = false; layoutKey = ""; curCompact = false; hDirty = true; M.seen = false;
  document.fonts?.ready?.then(() => { hDirty = true; M.seen = false; relayout(); });   // the Titles / Comic faces change the card heights

  // GM steppers: a mousedown there must not move focus (the canvas selection stays as it is)
  root.addEventListener("mousedown", (ev) => { if (ev.target.closest?.(".ich-sb")) ev.preventDefault(); });
  root.addEventListener("click", (ev) => {
    if (ev.target.closest?.(".ich-more-b")) { toggleExpanded(); return; }
    const ub = ev.target.closest?.(".ich-unit-b");
    if (ub) { ev.stopPropagation(); toggleMenu(ub); return; }
    const sb = ev.target.closest?.(".ich-sb");
    if (sb) {
      ev.stopPropagation();
      const id = sb.closest(".ich-item")?.dataset.id;
      if (id && !sb.disabled) cb.adjust?.(id, sb.dataset.k, Number(sb.dataset.d), ev.shiftKey ? 5 : 1);
      return;
    }
    const card = ev.target.closest?.(".ich-card");
    if (!card || ev.target.closest(".ich-art")) return;   // the portrait has its own gesture (double-click)
    if (card.dataset.open) cb.open(card.parentElement.dataset.id);
  });
  root.addEventListener("dblclick", (ev) => {
    const art = ev.target.closest?.(".ich-art");
    const card = art?.closest(".ich-card");
    if (card?.dataset.pan) { ev.preventDefault(); cb.pan(card.parentElement.dataset.id); }
  });
  // drag a card's portrait onto the map (GM; the payload and the drop are drag.mjs): the card dims while it is carried
  root.addEventListener("dragstart", (ev) => {
    const art = ev.target.closest?.(".ich-art");
    const card = art?.closest(".ich-card");
    if (!card?.dataset.drag || !cb.dragStart?.(card.parentElement.dataset.id, ev, art)) { ev.preventDefault(); return; }
    setTimeout(() => card.classList.add("ich-dragging"), 0);   // after the browser took the drag image: the ghost stays at full strength
  });
  root.addEventListener("dragend", (ev) => {
    ev.target.closest?.(".ich-card")?.classList.remove("ich-dragging");
    cb.dragEnd?.();
  });
  root.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || ev.target !== ev.target.closest?.(".ich-card")) return;   // only when the card itself has focus
    const card = ev.target, id = card.parentElement.dataset.id;
    ev.preventDefault();
    if (ev.shiftKey) { if (card.dataset.pan) cb.pan(id); }
    else if (card.dataset.open) cb.open(id);
  });
  document.body.appendChild(root);
  setCollapsed(collapsed, true);
}

/* ---------- one card ---------- */
function makeCard(item) {
  const li = mk("li", "ich-item");
  li.dataset.id = item.id;
  const el = mk("div", "ich-card ich-new");
  const art = mk("div", "ich-art");
  const ph = mk("i", "ich-ph");
  ph.setAttribute("aria-hidden", "true");
  const img = mk("img", "ich-img");
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  img.addEventListener("error", () => { img.dataset.bad = img.getAttribute("src") ?? ""; img.remove(); });   // a broken picture falls back to the glyph behind it
  art.append(ph, img);

  const body = mk("div", "ich-body");
  const head = mk("div", "ich-head");
  const name = mk("h3", "ich-name");
  const nameText = mk("span");
  name.append(nameText);
  const tag = mk("span", "ich-tag");
  tag.hidden = true;
  tag.append(mk("i", "ich-tag-i"), mk("span", "ich-tag-t", L("INCH.Hidden")));
  tag.dataset.tooltip = L("INCH.HiddenTip");
  head.append(name, tag);
  const sub = mk("p", "ich-sub");

  const row = (kind, title) => {
    const r = mk("div", `ich-row ich-${kind}`);
    const lab = mk("div", "ich-rl");
    const t = mk("span", "ich-lab", title);
    const small = mk("span", "ich-small");
    // the time row also carries its unit: plain text for everyone, a menu button for the GM (paintCard shows one of the two)
    const grp = mk("span", "ich-sg");
    grp.append(small);
    let unit = null, unitB = null;
    if (kind === "tl") {
      unit = mk("span", "ich-unit");
      unitB = mk("button", "ich-unit ich-unit-b");
      unitB.type = "button";
      unitB.hidden = true;
      unitB.setAttribute("aria-haspopup", "menu");
      unitB.setAttribute("aria-expanded", "false");
      unitB.dataset.tooltipDirection = "LEFT";
      grp.append(unit, unitB);
    }
    lab.append(t, grp);
    const bar = mk("div", "ich-bar");
    const fill = mk("i", "ich-fill");
    const glint = mk("i", "ich-glint");
    bar.append(fill, glint);
    const n = mk("b", "ich-num");
    n.setAttribute("aria-hidden", "true");
    // GM steppers (overlay on the bar's right end, shown on hover / focus-within; they reserve no space). "+" always means "more of the good thing":
    // progress +1 (CR -1) on the progress row, time +1 (TL +1) on the time row.
    const step = mk("span", "ich-step");
    step.setAttribute("role", "group");
    const sb = (d, glyph) => {
      const b = mk("button", "ich-sb", glyph);
      b.type = "button";
      b.dataset.k = kind;
      b.dataset.d = String(d);
      b.dataset.tooltipDirection = "UP";
      return b;
    };
    const minus = sb(-1, "−"), plus = sb(1, "+");
    step.append(minus, plus);
    r.append(lab, bar, n, step);
    return { r, lab: t, rl: lab, sg: grp, small, unit, unitB, bar, fill, glint, n, step, minus, plus };
  };
  const cr = row("cr", L("INCH.Progress"));
  const tl = row("tl", L("INCH.TimeLeft"));
  const stamp = mk("span", "ich-stamp");
  stamp.setAttribute("aria-hidden", "true");
  stamp.append(mk("i", "ich-stamp-i"), mk("span", "ich-stamp-t"));

  const shine = mk("span", "ich-shine");   // clipped sweep for the "overcome" moment
  shine.setAttribute("aria-hidden", "true");
  shine.append(mk("i"));
  body.append(head, sub, cr.r, tl.r);
  el.append(art, body, stamp, shine);
  li.append(el);
  return { li, el, refs: { art, ph, img, name, nameText, tag, sub, cr, tl, stamp, shine }, prev: null, item: null, hot: 0 };
}

function paintCard(card, item, first) {
  const { el, refs } = card;
  const prev = card.prev;
  const crV = num(item.cr), crMax = num(item.crMax), tlV = num(item.tl), tlMax = num(item.tlMax);
  const crKnown = crV !== null && crMax !== null && crMax > 0;
  const tlKnown = tlV !== null && tlMax !== null && tlMax > 0;
  const prog = crKnown ? clamp01(1 - crV / crMax) : 0;
  const pct = crKnown ? Math.round(prog * 100) : null;
  const time = tlKnown ? clamp01(tlV / tlMax) : 0;
  const overcome = crKnown && crV <= 0;
  const failed = !overcome && tlKnown && tlV <= 0;
  const low = !overcome && !failed && tlKnown && time <= 1 / 3;
  const state = overcome ? "overcome" : failed ? "failed" : "";
  // time unit: "TL 3 / 6 rounds" (agrees with the maximum), or with the value when there is no maximum; plural-aware (lang.mjs unitName)
  const unit = UNITS.includes(item.unit) ? item.unit : DEFAULT_UNIT;
  const unitTxt = unitName(unit, tlKnown ? tlMax : tlV ?? 0, tlKnown);

  if (refs.nameText.textContent !== item.name) refs.nameText.textContent = item.name;
  refs.name.title = item.name;
  refs.sub.textContent = item.subtitle || "";
  refs.sub.title = item.subtitle || "";
  refs.sub.hidden = !item.subtitle;
  el.classList.toggle("ich-hidden", !!item.hidden);
  markSelected(el, !!item.selected);
  refs.tag.hidden = !item.hidden;
  el.dataset.state = state;
  el.classList.toggle("ich-low", low);
  el.classList.toggle("ich-dim", overcome || failed);

  // portrait: a failing image is removed (glyph behind it); a changed source is swapped in place
  if (item.img && refs.img.dataset.bad !== item.img) {
    if (!refs.img.parentNode) refs.art.append(refs.img);
    if (refs.img.getAttribute("src") !== item.img) { delete refs.img.dataset.bad; refs.img.src = item.img; }
  } else refs.img.remove();
  card.el.dataset.pan = item.canPan ? "1" : "";
  card.el.dataset.open = item.canOpen ? "1" : "";
  if (!item.canPan) delete card.el.dataset.pan;
  if (!item.canOpen) delete card.el.dataset.open;
  card.el.dataset.drag = item.canDrag ? "1" : "";
  if (!item.canDrag) delete card.el.dataset.drag;
  refs.art.draggable = !!item.canDrag;
  // portrait tooltip: the double-click hint and (GM) the drag hint, two lines (module-owned strings only, escaped anyway)
  const tipLines = [item.canPan ? L("INCH.Art.Pan") : "", item.canDrag ? L("INCH.Art.Drag") : ""].filter(Boolean);
  delete refs.art.dataset.tooltip;
  delete refs.art.dataset.tooltipHtml;
  if (tipLines.length > 1) refs.art.dataset.tooltipHtml = tipLines.map((s) => `<p>${s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])}</p>`).join("");
  else if (tipLines.length) refs.art.dataset.tooltip = tipLines[0];
  refs.art.dataset.tooltipDirection = "LEFT";

  // progress row (Challenge Rating counts DOWN; progress = 1 - CR / max)
  const crTxt = crV === null ? "-" : crMax !== null && crMax > 0 ? `${crV} / ${crMax}` : String(crV);
  refs.cr.small.textContent = `${item.crLabel} ${crTxt}`;
  refs.cr.bar.dataset.tooltip = crMax !== null && crMax > 0 && crV !== null
    ? F("INCH.Bar.Cr", { hint: item.crHint, value: crV, max: crMax }) : F("INCH.Bar.CrNoMax", { hint: item.crHint, value: crV ?? "-" });
  refs.cr.bar.dataset.tooltipDirection = "LEFT";
  refs.cr.bar.classList.toggle("ich-unknown", !crKnown);
  refs.cr.n.classList.toggle("ich-null", pct === null);
  refs.cr.n.classList.toggle("ich-pct", true);
  // time row (Time Limit counts DOWN to 0 = time is up; the bar and the number stay unitless, the unit is the text beside them)
  refs.tl.unit.textContent = unitTxt;
  refs.tl.unitB.textContent = unitTxt;
  refs.tl.unit.hidden = !!item.canAdjust;
  refs.tl.unitB.hidden = !item.canAdjust;
  refs.tl.unitB.dataset.unit = unit;
  refs.tl.unitB.setAttribute("aria-label", F("INCH.Unit.Tip", { unit: unitLabel(unit).toLocaleLowerCase() }));
  refs.tl.unitB.dataset.tooltip = F("INCH.Unit.Tip", { unit: unitLabel(unit).toLocaleLowerCase() });
  refs.tl.small.textContent = `${item.tlLabel} ${tlV === null ? "-" : tlMax !== null && tlMax > 0 ? `${tlV} / ${tlMax}` : tlV}`;
  refs.tl.bar.dataset.tooltip = tlMax !== null && tlMax > 0 && tlV !== null
    ? F("INCH.Bar.Tl", { hint: item.tlHint, value: tlV, max: tlMax, unit: unitTxt }) : F("INCH.Bar.TlNoMax", { hint: item.tlHint, value: tlV ?? "-", unit: unitTxt });
  refs.tl.bar.dataset.tooltipDirection = "LEFT";
  refs.tl.bar.classList.toggle("ich-unknown", !tlKnown);
  refs.tl.n.classList.toggle("ich-null", tlV === null);

  // segments: one per point up to 20, otherwise ten (so a Challenge Rating of 3 or of 12 both read as a count)
  const segs = (m) => (m !== null && m > 0 && m <= 20 ? Math.round(m) : 10);
  refs.cr.bar.style.setProperty("--ich-tick", `${(100 / segs(crMax)).toFixed(3)}%`);
  refs.tl.bar.style.setProperty("--ich-tick", `${(100 / segs(tlMax)).toFixed(3)}%`);
  refs.cr.bar.dataset.dense = segs(crMax) > 12 ? "1" : "";
  refs.tl.bar.dataset.dense = segs(tlMax) > 12 ? "1" : "";

  // stamp (the outcome is also in the card's accessible name)
  refs.stamp.hidden = !state;
  refs.stamp.querySelector(".ich-stamp-t").textContent = state === "overcome" ? L("INCH.Overcome") : state === "failed" ? L("INCH.TimeUp") : "";

  // values: a new card starts at 0 and lands after its entrance; a changed value transitions and flashes
  const apply = () => {
    refs.cr.fill.style.setProperty("--ich-v", prog.toFixed(4));
    refs.tl.fill.style.setProperty("--ich-v", time.toFixed(4));
    refs.cr.n.style.setProperty("--ich-n", String(pct ?? 0));
    refs.tl.n.style.setProperty("--ich-n", String(tlV === null ? 0 : Math.max(0, Math.round(tlV))));
  };
  if (first) {
    refs.cr.fill.style.setProperty("--ich-v", "0");
    refs.tl.fill.style.setProperty("--ich-v", "0");
    refs.cr.n.style.setProperty("--ich-n", "0");
    refs.tl.n.style.setProperty("--ich-n", "0");
    requestAnimationFrame(() => requestAnimationFrame(apply));
  } else apply();

  const flash = (row, good) => {
    // a flash is state feedback (colour only, nothing moves), so it also plays under reduced motion
    row.glint.classList.remove("ich-good", "ich-bad");
    void row.glint.offsetWidth;
    row.glint.classList.add(good ? "ich-good" : "ich-bad");
  };
  const changedCr = prev && (prev.crV !== crV || prev.crMax !== crMax);
  const changedTl = prev && (prev.tlV !== tlV || prev.tlMax !== tlMax);
  const changedUnit = !!prev && prev.unit !== unit;   // no flash: the number did not move, only what a point means
  if (changedCr) flash(refs.cr, (crV ?? 0) < (prev.crV ?? 0));    // CR down = progress = good
  if (changedTl) flash(refs.tl, (tlV ?? 0) > (prev.tlV ?? 0));    // TL up = more time = good

  // accessible name: the plain-language state of the whole card
  const crSay = crKnown ? F("INCH.Live.Cr", { value: crV, max: crMax, pct }) : F("INCH.Live.CrNoMax", { value: crV ?? "-" });
  const tlSay = tlKnown ? F("INCH.Live.Tl", { value: tlV, max: tlMax, unit: unitTxt }) : F("INCH.Live.TlNoMax", { value: tlV ?? "-", unit: unitTxt });
  const stateSay = overcome ? L("INCH.Live.Overcome") : failed ? L("INCH.Live.TimeUp") : "";
  const full = [item.name, item.subtitle, crSay, tlSay, stateSay, item.hidden ? L("INCH.Live.Hidden") : ""].filter(Boolean).join(". ") + ".";
  const hints = [item.canOpen ? L("INCH.Card.Open") : "", item.canPan ? L("INCH.Card.Pan") : ""].filter(Boolean).join(" ");
  // GM steppers: labels say exactly what they do; limits disable them
  const shiftTip = L("INCH.StepShift");
  const stepper = (r, up, down, vUp, vDown) => {
    r.step.hidden = !item.canAdjust;
    r.plus.disabled = !vUp; r.minus.disabled = !vDown;
    for (const [b, key] of [[r.plus, up], [r.minus, down]]) { b.setAttribute("aria-label", L(key)); b.dataset.tooltip = `${L(key)}. ${shiftTip}`; }
  };
  if (item.canAdjust) {
    stepper(refs.cr, "INCH.StepCrUp", "INCH.StepCrDown", crV !== null && crV > 0, crV !== null && (crMax === null || crV < crMax));
    stepper(refs.tl, "INCH.StepTlUp", "INCH.StepTlDown", tlV !== null && (tlMax === null || tlV < tlMax), tlV !== null && tlV > 0);
  } else { refs.cr.step.hidden = true; refs.tl.step.hidden = true; }
  card.el.dataset.adjust = item.canAdjust ? "1" : "";
  if (!item.canAdjust) delete card.el.dataset.adjust;
  if (item.canOpen) {
    el.setAttribute("role", item.canAdjust ? "group" : "button");   // a button must not contain buttons
    el.tabIndex = 0;
    el.setAttribute("aria-label", `${full} ${hints}`.trim());
  } else {
    el.setAttribute("role", "group");
    el.removeAttribute("tabindex");
    el.setAttribute("aria-label", full);
  }

  // a live outcome: the state changed on a card that was already showing (not on load, not when a card is re-sorted or re-shown: those rebuild or keep `prev`)
  const enteredFail = !first && !!prev && state === "failed" && prev.state !== "failed";
  const enteredWin = !first && !!prev && state === "overcome" && prev.state !== "overcome";
  if (!first && prev && (changedCr || changedTl || changedUnit || prev.state !== state || prev.hidden !== !!item.hidden)) {
    const lead = enteredFail ? F("INCH.Live.TimeUpFor", { name: item.name }) : enteredWin ? F("INCH.Live.OvercomeFor", { name: item.name }) : item.name;
    say(item.id, [lead, crSay, tlSay, enteredFail || enteredWin ? "" : stateSay, item.hidden ? L("INCH.Live.Hidden") : ""].filter(Boolean).join(", "));
  }
  card.prev = { crV, crMax, tlV, tlMax, unit, state, hidden: !!item.hidden };
  card.item = item;
  paintTip(card);
  if (enteredFail) shakeFx(card);
  else if (enteredWin) winFx(card);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/* compact cards drop the subtitle and the labels: the card's tooltip carries them; the small sticker icon gets its word */
function paintTip(card) {
  const { el, refs } = card, item = card.item;
  const word = el.dataset.state === "overcome" ? L("INCH.Overcome") : el.dataset.state === "failed" ? L("INCH.TimeUp") : "";
  if (word && curCompact) refs.stamp.dataset.tooltip = word; else delete refs.stamp.dataset.tooltip;
  delete el.dataset.tooltip;
  delete el.dataset.tooltipHtml;
  if (!curCompact || !item) return;
  const lines = [`<strong>${esc(item.name)}</strong>`, item.subtitle ? `<em>${esc(item.subtitle)}</em>` : "", esc(refs.cr.small.textContent), esc(`${refs.tl.small.textContent} ${refs.tl.unit.textContent}`), esc(word)];
  el.dataset.tooltipHtml = lines.filter(Boolean).map((s) => `<p>${s}</p>`).join("");
  el.dataset.tooltipDirection = "LEFT";
}

/* ---------- selection (the token is controlled on the map): classes only, no rebuild ---------- */
function markSelected(el, on) {
  el.classList.toggle("ich-sel", on);
  if (on) el.setAttribute("aria-current", "true"); else el.removeAttribute("aria-current");
}
function paintSelectionFlag() {
  root?.classList.toggle("ich-has-sel", [...cards.values()].some((c) => c.el.classList.contains("ich-sel")));
}
/* ids = Set of token ids. Returns false when a selected challenge has no card yet (beyond the cap / in "+N more"): the caller re-syncs, which
   promotes it into the visible set. */
export function setSelection(ids) {
  let complete = true, fresh = null;
  for (const [id, card] of cards) {
    const on = ids.has(id);
    if (on && ids.size === 1 && !card.el.classList.contains("ich-sel")) fresh = card;
    markSelected(card.el, on);
  }
  for (const id of ids) if (!cards.has(id) && cb.known?.(id)) complete = false;
  // a single newly selected card inside a scrolling list is brought into view
  if (fresh && list?.classList.contains("ich-scrolls") && !collapsed) fresh.li.scrollIntoView?.({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  paintSelectionFlag();
  return complete;
}
export function setHover(id, on) {
  const card = cards.get(id);
  if (card) card.el.classList.toggle("ich-echo", !!on);
}

function leaveCard(id, card) {
  cards.delete(id);
  card.li.classList.add("ich-leaving");
  card.el.inert = true;
  setTimeout(() => card.li.remove(), reduced() ? 200 : 340);
}

/* ---------- public: render the whole list ----------
   items = every challenge the user may see, in document order; quiet = true on the first population of a scene (no announcements) */
export function render(items, { quiet = false } = {}) {
  const before = lastItems;
  lastItems = items;
  if (!items.length && !cards.size) { hide(); return; }
  if (items.length) ensureRoot();
  if (!root) return;
  relayout(false);

  // keyed in place: every card is reused by token id; this pass reads the cards' rects first (FLIP), mutates, then plays the glides
  const fresh = !cards.size;   // the first population of an empty list: cards slide in staggered, no unfolding
  const first = flipRects();
  let plan = choose(items);
  let added = applyPlan(items, plan, fresh);
  if (items.length && (added || hDirty)) {
    measureHeights();
    const again = choose(items);
    if (again.limit !== plan.limit || again.compact !== plan.compact) { plan = again; added += applyPlan(items, plan, fresh); }
  }
  curPlan = plan;
  if (!added) flipPlay(first);   // an insertion unfolds the list natively (grid rows): FLIP would fight it

  if (!quiet) {
    const had = new Set(before.map((i) => i.id)), now = new Set(items.map((i) => i.id));
    for (const i of items) if (!had.has(i.id) && cards.has(i.id)) say(`new:${i.id}`, F("INCH.Live.Appeared", { name: i.name }));
    for (const i of before) if (!now.has(i.id)) say(`gone:${i.id}`, F("INCH.Live.Gone", { name: i.name }));
  }
  if (!items.length) hide();
  syncMenu();
  paintSelectionFlag();
  paintHandle();
  syncScroll();
  clearTimeout(scrollTimer);
  scrollTimer = setTimeout(syncScroll, 420);   // after the leaving cards are gone
  if (added && collapsed && !quiet) pingHandle();
}

/* A row's label word ("Time left" / "Pozostały czas") and its value ("TL 6 / 6 rounds") share one line. When they do not fit (a narrow card, a long
   translation, a three-digit value) the label would be cut to "TIM…": the row drops the label instead (CSS .ich-nolab) and the value stays as the
   bar's caption. Writes first, then reads, so the whole list costs one layout. Compact cards hide the label line altogether (width 0: never flagged). */
function fitLabels() {
  const list = [...cards.values()];
  for (const c of list) { c.refs.cr.r.classList.remove("ich-nolab"); c.refs.tl.r.classList.remove("ich-nolab"); }
  const tight = (r) => r.rl.clientWidth > 0 && r.lab.scrollWidth + 6 + r.sg.offsetWidth + 3 > r.rl.clientWidth;   // 6 = the flex gap, 3 = spare so a sub-pixel font difference never ellipsizes
  const flag = list.filter((c) => tight(c.refs.cr) || tight(c.refs.tl));   // read everything first, then write
  for (const c of flag) { c.refs.cr.r.classList.add("ich-nolab"); c.refs.tl.r.classList.add("ich-nolab"); }   // both rows of a card together, so a card never has one captioned bar and one bare
}

/* one pass: set the mode, leave / create / paint the cards of the plan, order them, paint the chip. Returns the number of created cards. */
function applyPlan(items, plan, fresh) {
  // the cap: selected challenges are promoted into the visible set, the remaining places go to the others in document order; the order stays the document's
  const pick = new Set(items.filter((i) => i.selected).map((i) => i.id));
  for (const i of items) { if (pick.size >= plan.limit) break; pick.add(i.id); }
  const shown = items.filter((i) => pick.has(i.id));
  const over = items.filter((i) => !pick.has(i.id));
  const keep = new Set(shown.map((i) => i.id));

  const flipped = plan.compact !== curCompact;
  if (flipped) { curCompact = plan.compact; root.classList.toggle("ich-compact", curCompact); }
  root.classList.toggle("ich-expanded", expanded);

  for (const [id, card] of [...cards]) if (!keep.has(id)) leaveCard(id, card);

  let index = 0, added = 0;
  for (const item of shown) {
    let card = cards.get(item.id);
    const first = !card;
    if (first) {
      card = makeCard(item);
      cards.set(item.id, card);
      card.el.style.setProperty("--i", String(Math.min(index, 6)));
      if (!fresh) {   // joining a list that is already showing: the row unfolds (grid 0fr -> 1fr) so the cards below glide down
        card.li.classList.add("ich-enter");
        setTimeout(() => card.li.classList.remove("ich-enter"), 460);
      }
      list.insertBefore(card.li, chip?.isConnected ? chip : null);
      setTimeout(() => { card.el.classList.remove("ich-new"); card.el.classList.add("ich-settled"); }, 1600 + index * 70);
      added++;
    }
    paintCard(card, item, first);
    if (first) index++;
  }
  if (flipped) {
    for (const c of cards.values()) paintTip(c);
    swapFx();
  }

  // order: move only the nodes that are out of place, walking from the end (a moved settled card does not replay its entrance)
  let next = chip?.isConnected ? chip : null;
  for (let i = shown.length - 1; i >= 0; i--) {
    const n = cards.get(shown[i].id).li;
    let sib = n.nextElementSibling;
    while (sib && sib.classList.contains("ich-leaving")) sib = sib.nextElementSibling;
    if (sib !== next) list.insertBefore(n, next);
    next = n;
  }
  fitLabels();

  // "+N more" / "Show fewer": one real button
  if (plan.hidden > 0) {
    if (!chip?.isConnected) {
      chip = mk("li", "ich-more");
      chip.setAttribute("role", "listitem");
      chipBtn = mk("button", "ich-more-b");
      chipBtn.type = "button";
      chipBtn.setAttribute("aria-controls", "ich-list");
      chipBtn.setAttribute("aria-describedby", "ich-more-desc");
      chipBtn.dataset.tooltipDirection = "LEFT";
      const ico = mk("i", "ich-more-i");
      ico.setAttribute("aria-hidden", "true");
      chipBtn.append(mk("span", "ich-more-t"), ico);
      chipDesc = mk("span", "ich-sr");
      chipDesc.id = "ich-more-desc";
      chip.append(chipBtn, chipDesc);
      list.append(chip);
    }
    chip.dataset.n = String(plan.hidden);
    chipBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    chipBtn.firstChild.textContent = expanded ? L("INCH.Fewer") : F("INCH.More", { n: plan.hidden });
    chipDesc.textContent = L(expanded ? "INCH.FewerDesc" : "INCH.MoreDesc");
    if (expanded || !over.length) delete chipBtn.dataset.tooltip; else chipBtn.dataset.tooltip = over.map((i) => i.name).join(" · ");
    chip.classList.remove("ich-leaving");
  } else if (chip?.isConnected) {
    const c = chip;
    chip = chipBtn = chipDesc = null;
    c.classList.add("ich-leaving");
    setTimeout(() => c.remove(), reduced() ? 200 : 340);
  }
  return added;
}

/* the whole HUD leaves (no challenge on the scene any more) */
function hide() {
  if (!root?.isConnected) return;
  for (const [id, card] of [...cards]) leaveCard(id, card);
  chip = chipBtn = chipDesc = null;
  expanded = false;
  root.classList.add("ich-bye");
  clearTimeout(byeTimer);
  const el = root;
  byeTimer = setTimeout(() => {
    if (!el.classList.contains("ich-bye")) return;   // a new challenge came back in time
    el.remove();
    if (root === el) { root = dock = list = handle = countEl = null; wheelOn = false; layoutKey = ""; }
    cards.clear();
  }, reduced() ? 220 : 480);
}

/* canvasTearDown / disabling: nothing may stay behind */
export function destroy() {
  killMenu();
  clearTimeout(byeTimer);
  clearTimeout(liveTimer);
  clearTimeout(scrollTimer);
  pending.clear();
  root?.remove();
  live?.remove();
  root = dock = list = handle = countEl = chip = chipBtn = chipDesc = live = null;
  cards.clear();
  lastItems = [];
  expanded = false; curCompact = false; wheelOn = false; layoutKey = "";
}
export const isOpen = () => !!root?.isConnected && !root.classList.contains("ich-bye");
