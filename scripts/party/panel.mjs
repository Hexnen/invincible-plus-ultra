/* Party cards: the DOM layer. No Foundry documents in here: main.mjs hands over plain items and callbacks (text via textContent only).
   Structure:
     div#invincible-party[role=region][data-display]      fixed, bottom-left, pointer-events:none (only the handle and the cards take the pointer)
       button.ipt-handle[aria-pressed]                    cycles Hidden -> Peek -> Full
       ul.ipt-list                                        the column; scrolls (hidden bar, edge fades) when even compact cards do not fit
         li.ipt-item[data-id]  >  div.ipt-card  >  .ipt-tab .ipt-body .ipt-art
   THE SLIDE. Every li carries one individual `translate`: full = 0, peek = left by (card width - portrait - 18px) so the PORTRAIT (the right end)
   sticks out, hidden = fully off screen. The portrait is on the right, so a card pulled out of the peek moves RIGHT under the pointer: the pointer
   stays inside the same card for the whole slide (no leave event, no flicker).
   HOVER RULES (peek only). One hot card at a time (`hot`): pointerenter (mouse) / focus makes it hot at once, which retracts the previous hot card
   in the same frame; pointerleave / blur starts ONE 250 ms timer that clears `hot` only if it still points at that card, and any enter cancels it,
   so moving between neighbours across the gap never leaves two open or none flickering. Click on a portrait pins its card (a second click un-pins),
   pins live until the display state changes.
   Item shape (main.mjs): { id, name, player, color, img, tokenIds, count, hp:{v,max}|null, rs:{v,max}|null, effects, defeated, active, selected,
   groups:[{slot,slots,active,pips:[{k,state}]}]|null, canSelect, canPan, canSheet } */
import { t } from "./lang.mjs";

const ID = "invincible-party";
const EASE = "cubic-bezier(.16, 1, .3, 1)";
const H = { full: 78, compact: 48 };    // card heights (px, before the root's scale()); the CSS reads the same numbers from custom properties (--ipt-h; measured: the content needs 77.5 / 47.5)
const G = { full: 6, compact: 5 };      // gaps between cards
const HANDLE = 28 + 6;                  // handle height + its gap to the list (the Challenges handle is 28 high too)
const LEAVE_MS = 250;
const MODES = ["hidden", "peek", "full"];

let root = null, handle = null, handleLbl = null, countEl = null, list = null, live = null;
let display = "peek", size = "normal", showPips = true, scale = 1, v2 = false;   // v2 = the 'New' card style (root class ipt-v2: scopes all of its CSS; its extra DOM exists only while it is on)
let topY = 0, bottomY = 0, compact = false, scrolls = false, wheelOn = false;
let hot = null, leaveTimer = 0, stagTimer = 0, liveTimer = 0;
let lastItems = [];
const pinned = new Set();
const cards = new Map();   // actor id -> { li, el, refs, item, prev }
let cb = { select: () => {}, pan: () => {}, sheet: () => {}, hover: () => {}, cycle: () => {} };

const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const setText = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };
const anim = (el, frames, opts) => { try { return el.animate(frames, { easing: EASE, ...opts }); } catch { return null; } };

export function configure(callbacks) { cb = { ...cb, ...callbacks }; }
export const SIZES = { small: 0.9, normal: 1, large: 1.2 };   // small stays at 0.9: the 12px text is 10.8px there, 0.85 put the player line under 10px

/* ---------- colour: the player's colour, checked against the ink ---------- */
const INK = "#0c1a2e";
function rgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? "").trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lum([r, g, b]) { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
export function contrast(a, b) { const la = lum(a), lb = lum(b), hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); }
const toHex = ([r, g, b]) => `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
/* lighten toward white until the colour reaches `min` against the ink (hue is kept as long as possible) */
export function lift(hex, min) {
  const base = rgb(hex) ?? rgb("#ffe72a"), ink = rgb(INK);
  let c = base;
  for (let i = 0; i <= 20 && contrast(c, ink) < min; i++) { const k = i / 20; c = base.map((v) => v + (255 - v) * k); }
  return { hex: toHex(c), ratio: contrast(c, ink) };
}
/* frame / tab >= 3:1 (non-text), text (the player's name, small) >= 6:1 */
export function accentTokens(hex) { return { frame: lift(hex, 3.2).hex, text: lift(hex, 6).hex }; }

/* ---------- public settings ---------- */
export function setDisplay(mode, opts = {}) {
  if (!MODES.includes(mode)) mode = "peek";
  const changed = mode !== display;
  display = mode;
  if (changed) { pinned.clear(); hot = null; clearTimeout(leaveTimer); }
  if (!root) return;
  if (changed && !opts.silent && !reduced()) {   // a short stagger for the state change only (hover slides have none)
    root.classList.add("ipt-stagger");
    clearTimeout(stagTimer);
    stagTimer = setTimeout(() => root?.classList.remove("ipt-stagger"), 700);
  }
  paintDisplay();
}
export function setSize(s) {
  size = SIZES[s] ? s : "normal";
  scale = SIZES[size];
  root?.style.setProperty("--ipt-scale", String(scale));
  relayout();
}
/* 'classic' | 'new'. Live: the cards are rebuilt (different DOM), the display state and the size stay. */
export function setStyle(s) {
  const on = s === "new";
  if (on === v2) return;
  v2 = on;
  if (!root?.isConnected) return;
  const keep = lastItems, mode = display;
  destroyRoot();
  if (keep.length) { render(keep, { quiet: true }); setDisplay(mode, { silent: true }); }
}
export function setPips(on) { showPips = !!on; if (root && lastItems.length) render(lastItems, { quiet: true }); }
/* main.mjs measured the screen: the column may occupy y in [top, bottom] (screen px) */
export function setBounds(top, bottom) {
  topY = Math.max(0, Math.round(top) || 0);
  bottomY = Math.round(bottom) || 0;
  relayout();
}
export const box = () => (root?.isConnected ? root.getBoundingClientRect() : null);
export const isOpen = () => !!root?.isConnected;
export const stateName = () => display;
export const nextState = (d = display) => MODES[(MODES.indexOf(d) + 1) % MODES.length];

function paintDisplay() {
  if (!root) return;
  root.dataset.display = display;
  list.inert = display === "hidden";
  const n = lastItems.length || cards.size;
  countEl.textContent = String(n);
  root.style.setProperty("--ipt-lvl", String(MODES.indexOf(display)));
  const state = t(`IPT.State.${display}`), next = t(`IPT.State.${nextState()}`);
  handle.setAttribute("aria-label", `${t("IPT.Handle.Aria", { state, next })} (${n})`);
  handle.setAttribute("aria-pressed", display === "hidden" ? "false" : "true");
  handle.dataset.tooltip = t("IPT.Handle.Label");
  applyOpen();
}

/* ---------- placement and the compact decision ---------- */
function planCompact(n, avail) {
  const need = (m) => n * H[m] + Math.max(0, n - 1) * G[m];
  if (compact) return !(need("full") + 19 <= avail);   // hysteresis: back to full cards only with 19px to spare
  return need("full") > avail;
}
function relayout() {
  if (!root?.isConnected) return;
  const bottom = bottomY > 0 ? bottomY : innerHeight - 14;
  root.style.setProperty("--ipt-bottom", `${Math.max(0, Math.round(innerHeight - bottom))}px`);
  const col = Math.max(120, (bottom - (topY || 0)) / scale);
  const avail = Math.max(70, col - HANDLE);
  const n = cards.size;
  const wantCompact = n > 0 && planCompact(n, avail);
  if (wantCompact !== compact) { compact = wantCompact; root.classList.toggle("ipt-compact", compact); }
  const m = compact ? "compact" : "full";
  root.style.setProperty("--ipt-h", `${H[m]}px`);
  root.style.setProperty("--ipt-g", `${G[m]}px`);
  list.style.setProperty("--ipt-maxh", `${Math.floor(avail)}px`);
  const can = n * H[m] + Math.max(0, n - 1) * G[m] > avail + 1;
  scrolls = can;
  list.classList.toggle("ipt-scrolls", can);
  if (can !== wheelOn) {
    wheelOn = can;
    if (can) list.addEventListener("wheel", stopWheel, { passive: false });
    else list.removeEventListener("wheel", stopWheel);
  }
  fades();
}
const stopWheel = (ev) => ev.stopPropagation();   // a scrolling list must not zoom the canvas
function fades() {
  if (!list) return;
  list.classList.toggle("ipt-fu", scrolls && list.scrollTop > 2);
  list.classList.toggle("ipt-fd", scrolls && list.scrollTop + list.clientHeight < list.scrollHeight - 2);
}

/* ---------- which cards are pulled out ---------- */
function isOpenCard(id) { return display === "full" || (display === "peek" && (hot === id || pinned.has(id))); }
function applyOpen() {
  for (const [id, c] of cards) {
    const on = isOpenCard(id);
    c.li.classList.toggle("ipt-open", on);
    c.el.classList.toggle("ipt-pinned", pinned.has(id));
  }
}
function setHot(id) {
  clearTimeout(leaveTimer);
  if (hot === id) return;
  hot = id;
  applyOpen();
}
function leaveHot(id) {
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(() => { if (hot === id) { hot = null; applyOpen(); } }, LEAVE_MS);
}
function togglePin(id) {
  if (display !== "peek") return;
  if (pinned.has(id)) pinned.delete(id); else pinned.add(id);
  applyOpen();
}

/* ---------- live region ---------- */
function say(text) {
  if (!text) return;
  if (!live?.isConnected) {
    live = mk("div", "ipt-sr");
    live.setAttribute("role", "status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    document.body.appendChild(live);
  }
  clearTimeout(liveTimer);
  live.textContent = "";
  liveTimer = setTimeout(() => { if (live) live.textContent = text; }, 400);
}

/* ---------- root ---------- */
function ensureRoot() {
  if (root?.isConnected) return;
  root = mk("div");
  root.id = ID;
  if (v2) root.classList.add("ipt-v2");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", t("IPT.Region"));
  root.style.setProperty("--ipt-scale", String(scale));
  root.style.setProperty("--ipt-hf", `${H.full}px`);
  root.style.setProperty("--ipt-hc", `${H.compact}px`);

  handle = mk("button", "ipt-handle");
  handle.type = "button";
  handle.dataset.tooltipDirection = "RIGHT";
  const ico = mk("i", "ipt-hi"), lvl = mk("span", "ipt-lvl");
  ico.setAttribute("aria-hidden", "true");
  lvl.setAttribute("aria-hidden", "true");
  lvl.append(mk("i"), mk("i"));
  handleLbl = mk("span", "ipt-hl", t("IPT.Handle.Label"));
  countEl = mk("b", "ipt-count", "0");
  countEl.setAttribute("aria-hidden", "true");
  handle.append(ico, handleLbl, lvl, countEl);
  handle.addEventListener("click", () => cb.cycle());

  list = mk("ul", "ipt-list");
  list.setAttribute("role", "list");
  list.addEventListener("scroll", fades, { passive: true });
  root.append(handle, list);

  // delegated gestures
  root.addEventListener("click", (ev) => {
    const card = ev.target.closest?.(".ipt-card");
    if (!card) return;
    const id = card.parentElement.dataset.id;
    if (ev.shiftKey) { cb.sheet(id); return; }
    if (ev.target.closest(".ipt-art") && display === "peek") togglePin(id);
    cb.select(id);
  });
  root.addEventListener("dblclick", (ev) => {
    const card = ev.target.closest?.(".ipt-card");
    if (!card) return;
    ev.preventDefault();
    cb.pan(card.parentElement.dataset.id);
  });
  root.addEventListener("keydown", (ev) => {
    const card = ev.target.closest?.(".ipt-card");
    if (!card || ev.target !== card) return;
    const id = card.parentElement.dataset.id;
    if (ev.key === "Enter") { ev.preventDefault(); if (ev.shiftKey) cb.sheet(id); else cb.select(id); }
    else if (ev.key === " ") { ev.preventDefault(); togglePin(id); }
    else if (ev.key === "Escape") { if (pinned.delete(id) || hot === id) { hot = null; applyOpen(); } }
    else if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      const lis = [...list.children].filter((n) => !n.classList.contains("ipt-leaving"));
      const to = lis[lis.indexOf(card.parentElement) + (ev.key === "ArrowDown" ? 1 : -1)]?.firstElementChild;
      if (to) { ev.preventDefault(); to.focus(); }
    }
  });
  document.body.appendChild(root);
  paintDisplay();
  compact = false;
  document.fonts?.ready?.then(() => relayout());
}

/* ---------- one card ---------- */
function makeRow(kind) {
  const el = mk("div", `ipt-row ipt-${kind}`);
  const ico = mk("i", "ipt-ico");
  ico.setAttribute("aria-hidden", "true");
  const bar = mk("div", "ipt-bar");
  const fill = mk("i", "ipt-fill"), glint = mk("i", "ipt-glint");
  bar.append(fill, glint);
  const val = mk("span", "ipt-val");
  val.setAttribute("aria-hidden", "true");
  const n = mk("b", "ipt-n"), max = mk("i", "ipt-max");
  val.append(n, max);
  el.append(ico, bar, val);
  return { el, bar, fill, glint, n, max };
}
function makeCard(item) {
  const li = mk("li", "ipt-item");
  li.dataset.id = item.id;
  const el = mk("div", "ipt-card");
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  const tab = mk("i", "ipt-tab");
  tab.setAttribute("aria-hidden", "true");

  const body = mk("div", "ipt-body");
  const nameH = mk("h3", "ipt-name"), nameT = mk("span");
  nameH.append(nameT);
  const sub = mk("div", "ipt-sub");
  const player = mk("span", "ipt-player"), fx = mk("span", "ipt-fx"), pips = mk("span", "ipt-pips");
  fx.setAttribute("aria-hidden", "true");
  pips.setAttribute("aria-hidden", "true");
  sub.append(player, fx, pips);
  const bars = mk("div", "ipt-bars");
  bars.setAttribute("aria-hidden", "true");
  const hp = makeRow("hp"), rs = makeRow("rs");
  bars.append(hp.el, rs.el);
  body.append(nameH, sub, bars);

  const art = mk("div", "ipt-art");
  const ph = mk("i", "ipt-ph"), img = mk("img", "ipt-img"), skull = mk("i", "ipt-skull"), turn = mk("i", "ipt-turn"), multi = mk("b", "ipt-multi");
  for (const n of [ph, skull, turn, multi]) n.setAttribute("aria-hidden", "true");
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  img.addEventListener("error", () => { img.dataset.bad = img.getAttribute("src") ?? ""; img.remove(); });
  art.append(ph, img, skull, turn, multi);
  el.append(tab, body, art);
  let v = null;
  if (v2) {   // the 'New' style: a footer line (conditions | player | pips), two vertical meters on the portrait edge, a condition-count badge
    const foot = mk("div", "ipt-foot"), fxrow = mk("span", "ipt-fxrow"), fxn = mk("b", "ipt-fxn");
    fxrow.setAttribute("aria-hidden", "true");
    fxn.setAttribute("aria-hidden", "true");
    foot.append(fxrow, player, pips);
    sub.remove();
    body.append(foot);
    art.append(fxn);
    const meter = (kind) => { const m = mk("div", `ipt-vm ipt-vm-${kind}`), fill = mk("i", "ipt-vf"), glint = mk("i", "ipt-glint"); m.setAttribute("aria-hidden", "true"); m.append(fill, glint); return { el: m, fill, glint }; };
    v = { hp: meter("hp"), rs: meter("rs") };
    el.append(v.rs.el, v.hp.el);
  }
  li.append(el);

  const id = item.id;
  el.addEventListener("pointerenter", (ev) => {
    if (ev.pointerType === "mouse" || ev.pointerType === "pen") { if (display === "peek") setHot(id); }
    cb.hover(id, true, ev);
  });
  el.addEventListener("pointerleave", (ev) => {
    if (display === "peek" && hot === id) leaveHot(id);
    cb.hover(id, false, ev);
  });
  el.addEventListener("focusin", () => { if (display === "peek") setHot(id); });
  el.addEventListener("focusout", (ev) => { if (display === "peek" && !el.contains(ev.relatedTarget)) leaveHot(id); });
  return { li, el, refs: { tab, nameT, player, fx, pips, hp, rs, art, ph, img, skull, turn, multi, vm: v, fxrow: v ? el.querySelector(".ipt-fxrow") : null, fxn: v ? el.querySelector(".ipt-fxn") : null }, item: null, prev: null };
}

function paintRow(card, key, spec, label, first) {
  const row = card.refs[key], vm = card.refs.vm?.[key];
  row.el.hidden = !spec;
  if (vm) vm.el.hidden = !spec;
  if (!spec) { card.prev && (card.prev[key] = null); return null; }
  const frac = clamp01(spec.v / spec.max), v = Math.max(0, Math.round(spec.v));
  const low = key === "hp" && frac <= 1 / 3;
  const segs = spec.max > 0 && spec.max <= 12 ? Math.round(spec.max) : 10;
  row.bar.style.setProperty("--tick", `${(100 / segs).toFixed(3)}%`);
  row.bar.dataset.dense = segs > 8 ? "1" : "";
  row.el.classList.toggle("ipt-low", low);
  setText(row.n, String(v));
  setText(row.max, `/${Math.round(spec.max)}`);
  if (vm) vm.el.classList.toggle("ipt-low", low);
  const apply = () => { row.fill.style.setProperty("--v", frac.toFixed(4)); vm?.fill.style.setProperty("--v", frac.toFixed(4)); };
  if (first) { row.fill.style.setProperty("--v", "0"); vm?.fill.style.setProperty("--v", "0"); requestAnimationFrame(() => requestAnimationFrame(apply)); } else apply();
  const prev = card.prev?.[key];
  if (!first && prev && (prev.v !== v || prev.max !== spec.max)) {   // colour-only flash: white = more, red = less
    for (const g of [row.glint, vm?.glint]) {
      if (!g) continue;
      g.classList.remove("ipt-good", "ipt-bad");
      void g.offsetWidth;
      g.classList.add(v >= prev.v ? "ipt-good" : "ipt-bad");
    }
  }
  return { v, max: spec.max, say: t("IPT.Of", { label, value: v, max: Math.round(spec.max) }) + (low ? `, ${t("IPT.Low")}` : "") };
}

function paintPips(card, item) {
  const box = card.refs.pips, groups = showPips ? item.groups : null;
  box.hidden = !groups?.length;
  if (!groups?.length) { box.replaceChildren(); return ""; }
  const key = JSON.stringify(groups);
  const sayParts = [];
  groups.forEach((g) => {
    const label = g.slots > 1 ? ` (${t("IPT.Slot", { n: g.slot, m: g.slots })})` : "";
    sayParts.push(g.pips.map((p) => `${t(`IPT.Pip.${p.k}`)}${label}: ${t(`IPT.Pip.${p.state}`)}`).join(", "));
  });
  if (box.dataset.key !== key) {
    box.dataset.key = key;
    box.replaceChildren();
    for (const g of groups) {
      const grp = mk("span", "ipt-pg");
      if (g.active) grp.dataset.active = "1";
      if (g.slots > 1) grp.append(mk("i", "ipt-pn", `${g.slot}/${g.slots}`));
      for (const p of g.pips) { const b = mk("b", `ipt-pip ipt-pip-${p.k}`); b.dataset.state = p.state; grp.append(b); }
      box.append(grp);
    }
  }
  return sayParts.join("; ");
}

/* 'New' style only: up to 4 condition icons + "+n" (2 while pips share the line, none when a token has several combat entries: only the count).
   Names live in the card's accessible name, never in a tooltip (the tooltip is the character's name only). */
function paintConditions(card, item) {
  const { fxrow, fxn } = card.refs, list = item.fxList ?? [], n = item.effects > 0 ? item.effects : 0;
  const pipsOn = showPips && !!item.groups?.length;
  const max = pipsOn ? (item.groups.length > 1 ? 0 : 2) : 4;
  fxrow.hidden = !n;
  fxrow.parentElement.toggleAttribute("data-tight", pipsOn && n > 0);   // pips + conditions share the line: the player's name gives way
  setText(fxn, n ? String(n) : "");
  fxn.hidden = !n;
  const key = JSON.stringify([max, n, list.map((f) => f.icon)]);
  if (fxrow.dataset.key === key) return;
  fxrow.dataset.key = key;
  fxrow.replaceChildren();
  if (!n) return;
  if (max === 0 || !list.length) { fxrow.append(mk("b", "ipt-fr ipt-fcn", String(n))); return; }
  for (const f of list.slice(0, Math.min(max, n))) {
    const c = mk("i", "ipt-fc");
    if (f.icon) { const im = mk("img"); im.alt = ""; im.draggable = false; im.src = f.icon; im.addEventListener("error", () => im.remove()); c.append(im); }
    fxrow.append(c);
  }
  if (n > max) fxrow.append(mk("b", "ipt-fr", `+${n - max}`));
}

function paintCard(card, item, first) {
  const { el, refs } = card;
  const tokens = accentTokens(item.color);
  el.style.setProperty("--acc", tokens.frame);
  el.style.setProperty("--acc-tx", tokens.text);
  setText(refs.nameT, item.name);
  setText(refs.player, item.player);
  el.toggleAttribute("data-defeated", !!item.defeated);
  el.toggleAttribute("data-active", !!item.active);
  el.toggleAttribute("data-sel", !!item.selected);
  el.toggleAttribute("data-multi", item.count > 1);
  setText(refs.multi, item.count > 1 ? `×${item.count}` : "");
  if (item.img && refs.img.dataset.bad !== item.img) {
    if (!refs.img.parentNode) refs.art.insertBefore(refs.img, refs.skull);
    if (refs.img.getAttribute("src") !== item.img) { delete refs.img.dataset.bad; refs.img.src = item.img; }
  } else refs.img.remove();

  const hp = paintRow(card, "hp", item.hp && item.hp.max > 0 ? item.hp : null, t("IPT.Health"), first);
  const rs = paintRow(card, "rs", item.rs && item.rs.max > 0 ? item.rs : null, t("IPT.Resolve"), first);
  const pipSay = paintPips(card, item);
  refs.fx.hidden = !(item.effects > 0);
  setText(refs.fx, item.effects > 0 ? String(item.effects) : "");
  el.toggleAttribute("data-low", !!(item.hp && item.hp.max > 0 && !item.defeated && item.hp.v / item.hp.max <= 1 / 3));
  if (refs.fxrow) paintConditions(card, item);

  // tooltip: the NAME only; everything else is in the accessible name
  refs.art.dataset.tooltip = item.name;
  refs.art.dataset.tooltipDirection = "RIGHT";
  const say = [
    item.name, t("IPT.Player", { name: item.player }), hp?.say, rs?.say, pipSay,
    item.effects > 0 ? t("IPT.Effects", { n: item.effects }) + (v2 && item.fxList?.length ? `: ${item.fxList.map((f) => f.name).filter(Boolean).join(", ")}` : "") : "", item.defeated ? t("IPT.Defeated") : "", item.active ? t("IPT.Turn") : "",
    item.count > 1 ? t("IPT.Tokens", { n: item.count }) : "", t("IPT.Hint")
  ].filter(Boolean).join(". ");
  el.setAttribute("aria-label", say);
  card.prev = { hp, rs };
  card.item = item;
}

/* ---------- FLIP (vertical reorder / removal) ---------- */
function flipRects() {
  const m = new Map();
  for (const c of cards.values()) if (c.li.isConnected && !c.li.classList.contains("ipt-leaving")) m.set(c.li, c.li.getBoundingClientRect().top);
  for (const el of m.keys()) for (const a of el.getAnimations?.() ?? []) if (a.id === "ipt-flip") a.cancel();
  return m;
}
function flipPlay(first) {
  if (reduced()) return;
  for (const [el, y0] of first) {
    if (!el.isConnected) continue;
    const dy = (y0 - el.getBoundingClientRect().top) / scale;
    if (Math.abs(dy) > 1) { const a = anim(el, [{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 300 }); if (a) a.id = "ipt-flip"; }
  }
}

/* ---------- public: render ---------- */
export function selectionOf() { return [...cards.values()].filter((c) => c.el.hasAttribute("data-sel")).map((c) => c.item?.id); }
export function setSelection(tokenIds) {
  for (const c of cards.values()) {
    const on = !!c.item && c.item.tokenIds.some((id) => tokenIds.has(id));
    c.el.toggleAttribute("data-sel", on);
    if (c.item) c.item.selected = on;
  }
}
export function setEcho(tokenId, on) {
  for (const c of cards.values()) if (c.item?.tokenIds.includes(tokenId)) c.el.toggleAttribute("data-echo", !!on);
}
export function itemOf(id) { return cards.get(id)?.item ?? null; }

export function render(items, { quiet = false } = {}) {
  const before = lastItems;
  lastItems = items;
  if (!items.length && !cards.size) { destroyRoot(); return; }
  ensureRoot();
  const fresh = !cards.size;
  const first = flipRects();
  const want = new Set(items.map((i) => i.id));
  for (const [id, c] of [...cards]) if (!want.has(id)) leaveCard(id, c);
  let added = 0;
  items.forEach((item, idx) => {
    let c = cards.get(item.id);
    const isNew = !c;
    if (isNew) {
      c = makeCard(item);
      cards.set(item.id, c);
      c.li.style.setProperty("--i", String(Math.min(cards.size - 1, 8)));
      if (!reduced()) c.li.classList.add("ipt-enter");
      list.append(c.li);
      added++;
      const li = c.li;
      requestAnimationFrame(() => requestAnimationFrame(() => li.classList.remove("ipt-enter")));
    }
    paintCard(c, item, isNew);
  });
  // order: move only the nodes out of place, walking from the end
  const lis = items.map((i) => cards.get(i.id).li);
  let next = null;
  for (let i = lis.length - 1; i >= 0; i--) {
    const n = lis[i];
    let sib = n.nextElementSibling;
    while (sib && sib.classList.contains("ipt-leaving")) sib = sib.nextElementSibling;
    if (sib !== next) list.insertBefore(n, next);
    next = n;
  }
  items.forEach((item, idx) => cards.get(item.id).li.style.setProperty("--i", String(Math.min(idx, 8))));
  relayout();
  paintDisplay();
  if (!fresh) flipPlay(first);
  if (!quiet) {
    const had = new Set(before.map((i) => i.id)), now = new Set(items.map((i) => i.id));
    for (const i of items) if (!had.has(i.id)) say(t("IPT.Live.Appeared", { name: i.name }));
    for (const i of before) if (!now.has(i.id)) say(t("IPT.Live.Gone", { name: i.name }));
  }
  if (!items.length) { for (const [id, c] of [...cards]) leaveCard(id, c); setTimeout(() => { if (!cards.size && !lastItems.length) destroyRoot(); }, 450); }
}

function leaveCard(id, c) {
  cards.delete(id);
  pinned.delete(id);
  if (hot === id) hot = null;
  c.li.classList.add("ipt-leaving");
  c.el.inert = true;
  setTimeout(() => {
    const f = flipRects();   // the others glide into the closed gap
    c.li.remove();
    if (root?.isConnected) { flipPlay(f); relayout(); }
  }, reduced() ? 150 : 340);
}

function destroyRoot() {
  clearTimeout(leaveTimer); clearTimeout(stagTimer); clearTimeout(liveTimer);
  root?.remove();
  live?.remove();
  root = handle = handleLbl = countEl = list = live = null;
  cards.clear(); pinned.clear();
  hot = null; compact = false; scrolls = false; wheelOn = false;
}
export function destroy() { lastItems = []; destroyRoot(); }
