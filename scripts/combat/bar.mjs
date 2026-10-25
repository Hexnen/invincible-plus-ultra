/* Combat initiative bar: model + DOM + motion layer, part of Invincible - Plus Ultra. main.mjs registers the hooks and the settings and calls
   in here; styles are the "COMBAT INITIATIVE BAR" section of styles/combat.css.

   WHICH COMBAT (pick()): the same rule as the banners (main.mjs relevant()), made single-valued: the ACTIVE combat of the viewed scene
   (game.combats.active: scene-less or scene === the viewed scene), else the combat the tracker is viewing (game.combat), and in both cases only
   once it has STARTED (round > 0) and only if it is scoped to the viewed scene or to none. A combat on a scene nobody views never shows.
   Everything is derived from the documents on every sync (keyed DOM reuse by combatant id, nothing cached across syncs but the tiles).

   WHO SEES WHAT (read()). GM: everything. Player:
     - a combatant is listed only if combatant.visible (owner or not hidden), its token is not hidden (unless they own it) and its token is not
       SECRET for them (TokenDocument#isSecret: secret disposition and no Observer permission - core's own rule, so an owner/observer still sees theirs);
     - bars: the world setting "Combat bar: what players see": friendly (default) = actors they own or observe, or a FRIENDLY token; all; none.
       A challenge actor whose token is not hidden follows the Challenges HUD card (visible to every player, numbers included) unless the setting is none;
     - numbers (tooltip, aria-label, the value column of the active tile) only for actors they own or observe (and challenges, as above). A viewer that
       may not see bars gets NO bar elements and no values in the DOM at all.
   The client setting "bar shows resources" can only hide more, never show more.

   STACKING / PLACEMENT: fixed, z-index one BELOW the interface layer (above the canvas, under the menus and the scene navigation, which it
   emerges from), one ABOVE the banners (banner z is two below). Horizontally centred over the free map area (sidebar and scene controls excluded,
   and the open Challenges dock: banner.mjs freeArea() / hudLimit()), top = scene-navigation bottom + 6. The bar's bottom edge is published as
   --icbar-bottom on :root (px; 0 when hidden) and banner.mjs puts its banner under it.
   MOTION: transform / opacity only (Web Animations on the individual translate / scale properties), FLIP for tile reorder, nothing per frame. */
import { t } from "./lang.mjs";
import { freeArea, hudLimit, relayout as relayoutBanner } from "./banner.mjs";
import { unitOf, unitName } from "../challenges/lang.mjs";

const MOD = "invincible-plus-ultra";
const ID = "invincible-combat-bar";
const LOG = `${MOD} (combat bar) |`;
export const KEY = { enabled: "combatBarEnabled", size: "combatBarSize", res: "combatBarResources", players: "combatBarPlayers" };
const SIZES = { small: 0.85, normal: 1, large: 1.2 };
const EASE = "cubic-bezier(.16, 1, .3, 1)";
const VIDEO = /\.(webm|mp4|m4v|ogv)(\?.*)?$/i;

let root = null, shell = null, scroller = null, list = null, roundEl = null, roundNum = null, prevB = null, nextB = null, live = null;
let ready = false, down = false, timer = 0, again = false, goneId = null, size = "normal", wheelOn = false;
let curCombat = null, curCombatId = null, lastKey = "", lastDensity = -1, fitKey = "", activeId = null, byeTimer = 0, liveTimer = 0, hovered = null;
let ro = null, raf = 0, publishedBottom = -1, mounted = false;
const tiles = new Map();   // combatant id -> { li, tile, refs, prev, item, leaving }

const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const enabled = () => get(KEY.enabled) !== false;
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};
const anim = (el, frames, opts) => { try { return el?.animate?.(frames, { easing: EASE, ...opts }) ?? null; } catch { return null; } };
const clamp01 = (n) => Math.max(0, Math.min(1, n));
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const setText = (el, s) => { if (el && el.textContent !== s) el.textContent = s; };

/* ---------- disposition ---------- */
const D = () => CONST.TOKEN_DISPOSITIONS ?? { SECRET: -2, HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1 };
function dispOf(raw) {
  const d = D(), n = Number(raw);
  return n === d.FRIENDLY || n === d.NEUTRAL || n === d.HOSTILE || n === d.SECRET ? n : d.NEUTRAL;
}
function dispKey(n) {
  const d = D();
  return n === d.FRIENDLY ? "friendly" : n === d.HOSTILE ? "hostile" : n === d.SECRET ? "secret" : "neutral";
}

/* ---------- which combat ---------- */
function pick(prefer) {
  const ok = (c) => !!c && c.id !== goneId && !!c.started && (!c.scene || c.scene.id === canvas?.scene?.id);
  if (ok(prefer)) return prefer;
  try { const a = game.combats?.active; if (ok(a)) return a; } catch { /* none */ }
  try { const v = game.combat; if (ok(v)) return v; } catch { /* none */ }
  return null;
}

/* ---------- reading a combatant (the privacy rules live here) ---------- */
const normName = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
function nameOf(c, actor) {
  const n = normName(c.name);
  const generic = ["", "challenge", "wyzwanie"];
  if (actor?.type === "challenge" && generic.includes(n.toLocaleLowerCase())) return normName(actor.name) || n || "?";
  return n || normName(actor?.name) || "?";
}
function pictureOf(c, td, actor) {
  for (const src of [td?.texture?.src, c.img, actor?.img]) {
    if (src && !String(src).includes("*") && !VIDEO.test(src)) return src;   // wildcards and videos cannot sit in an <img>
  }
  return "";
}
function controlledIds() {
  try { return new Set((canvas?.tokens?.controlled ?? []).map((o) => o.document?.id).filter(Boolean)); } catch { return new Set(); }
}
const fmtInit = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

function read(c, isActive, ctx) {
  const gm = !!game.user.isGM;
  const td = c.token ?? null;
  const actor = c.actor ?? td?.actor ?? null;
  const owner = gm || !!(actor?.isOwner || c.isOwner);
  if (!gm) {
    if (!c.visible) return null;
    if (td?.hidden && !owner) return null;
    if (td?.isSecret) return null;
  }
  const disp = dispOf(td ? td.disposition : actor?.prototypeToken?.disposition);
  let observer = owner;
  if (!observer) { try { observer = !!actor?.testUserPermission?.(game.user, "OBSERVER"); } catch { observer = false; } }
  const challenge = actor?.type === "challenge";
  let bars = false, nums = false;
  if (gm) { bars = true; nums = true; }
  else {
    if (ctx.mode === "all") bars = true;
    else if (ctx.mode === "friendly") bars = observer || disp === D().FRIENDLY;
    nums = observer;
    if (challenge && !td?.hidden && ctx.mode !== "none") { bars = true; nums = true; }   // the Challenges HUD shows these to every player
    if (!bars) nums = false;
  }
  const d = actor?.system?.derived ?? {};
  const hp = { v: num(d.health?.value), max: num(d.health?.max) };
  const rs = { v: num(d.resolve?.value), max: num(d.resolve?.max) };
  const known = (r) => r.v !== null && r.max !== null && r.max > 0;
  const showHp = bars && ctx.res !== "none" && known(hp);
  const showRs = bars && ctx.res === "both" && known(rs);
  const init = num(c.initiative);
  const kind = challenge ? "challenge" : actor?.type === "vehicle" ? "vehicle" : "std";
  const onScene = !!td && td.parent === canvas?.scene;
  let sheet = false;
  if (actor) { sheet = gm || owner || observer; }
  return {
    id: c.id, tokenId: td?.id ?? "", actorId: actor?.id ?? "",
    name: nameOf(c, actor), img: pictureOf(c, td, actor),
    init, initText: init === null ? "–" : fmtInit(init),
    disp, own: !gm && owner, hidden: !!(c.hidden || td?.hidden), defeated: !!c.isDefeated, active: isActive,
    kind, unit: challenge ? unitOf(actor) : "", nums, hp, rs, showHp, showRs,
    canSelect: onScene && (gm || !!td?.isOwner), canPan: onScene && (gm || !td?.hidden || owner), canSheet: sheet,
    selected: onScene && ctx.sel.has(td.id)
  };
}

function build(combat) {
  const ctx = { mode: get(KEY.players) ?? "friendly", res: get(KEY.res) ?? "both", sel: controlledIds() };
  const items = [];
  const turns = combat.turns ?? [];
  turns.forEach((c, i) => { const it = read(c, i === combat.turn, ctx); if (it) items.push(it); });
  return { round: Number(combat.round) || 0, turn: combat.turn ?? null, items };
}

/* ---------- what a viewer's bars say (numbers only when `nums`) ---------- */
function rowSpec(it, key) {   // key: "hp" | "rs"  ->  { show, frac, label, count, max, suffix, unit, say, good }
  const r = it[key], show = key === "hp" ? it.showHp : it.showRs;
  if (!show) return { show: false };
  const challenge = it.kind === "challenge";
  const label = key === "hp" ? t(challenge ? "ICB.Bar.Progress" : "ICB.Bar.Health") : t(challenge ? "ICB.Bar.TimeLeft" : "ICB.Bar.Resolve");
  if (challenge && key === "hp") {
    const pct = Math.round(clamp01(1 - r.v / r.max) * 100);
    return { show, frac: pct / 100, label, count: pct, max: "", pct: true, unit: "", say: t("ICB.Bar.Pct", { label, pct }), low: false };
  }
  const unit = challenge && key === "rs" ? unitName(it.unit, r.max, true) : "";
  const frac = clamp01(r.v / r.max);
  const say = unit ? t("ICB.Bar.OfUnit", { label, value: r.v, max: r.max, unit }) : t("ICB.Bar.Of", { label, value: r.v, max: r.max });
  return { show, frac, label, count: Math.max(0, Math.round(r.v)), max: `/${r.max}`, pct: false, unit, say, low: key === "hp" && !challenge && frac <= 1 / 3 };
}

/* ---------- placement ---------- */
function navBottom() {
  try {
    const el = document.querySelector("#scene-navigation .scene-navigation-menu") ?? document.getElementById("scene-navigation");
    const r = el?.getBoundingClientRect();
    if (r && r.height > 0 && r.bottom < 220) return r.bottom;
  } catch { /* fall through */ }
  return 0;
}
function publishBottom(px) {
  const v = Math.max(0, Math.round(px));
  if (v === publishedBottom) return;
  publishedBottom = v;
  try { document.documentElement.style.setProperty("--icbar-bottom", `${v}px`); } catch { /* no root */ }
  try { relayoutBanner(); } catch { /* no banner */ }
}
/* PLACEMENT. Preferred: an "island" hanging from the very top edge (top 0), centred in the free gap to the right of the scene navigation and
   left of the Challenges dock / sidebar (freeArea() and hudLimit() from banner.mjs, the navigation's measured right edge + 14). When that gap
   is narrower than MIN_GAP the bar drops to a lower row under the navigation (top = navigation bottom + 6) and uses the whole free area. The
   strip always ends left of the dock (it shrinks, then scrolls), never under it. */
const MIN_GAP = 300;
function place() {
  if (!root || !shell) return;
  const h = shell.offsetHeight;
  const { left, right } = freeArea();
  let navR = 0;
  try {
    const r = (document.querySelector("#scene-navigation .scene-navigation-menu") ?? document.getElementById("scene-navigation"))?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0 && r.top < 150) navR = r.right;
  } catch { navR = 0; }
  let top = 0, lo = Math.max(left, navR ? navR + 14 : left), hi = Math.min(right, hudLimit(0, h));
  const low = hi - lo < MIN_GAP;
  if (low) {
    top = Math.round(Math.min(150, Math.max(navBottom(), 36)) + 6);
    lo = left;
    hi = Math.min(right, hudLimit(top, h));
  }
  const avail = Math.max(160, hi - lo);
  root.classList.toggle("icbar-low", low);
  root.style.setProperty("--icbar-top", `${top}px`);
  root.style.setProperty("--icbar-maxw", `${Math.round(avail)}px`);
  root.style.setProperty("--icbar-cx", `${Math.round(lo + avail / 2)}px`);
  if (!root.classList.contains("icbar-bye")) publishBottom(top + h);
  return top;
}
export function relayout(force = true) { if (root) { place(); fit(force); place(); } }

function setDensity(d) {
  if (d === lastDensity) return;
  lastDensity = d;
  root?.classList.toggle("icbar-d1", d === 1);
}
/* density: full tiles when they fit, compact ones when they do not, and a scrolling strip when even those do not. N comes from the measured
   widths (a synchronous class swap that is never painted), never from a fixed count. */
function fit(force) {
  if (!root || !scroller) return;
  const key = `${tiles.size}|${activeId}|${Math.round(scroller.clientWidth)}|${size}|${root.style.getPropertyValue("--icbar-maxw")}|${root.classList.contains("icbar-nobars")}`;
  if (!force && key === fitKey) { syncScroll(); return; }
  setDensity(0);
  let over = scroller.scrollWidth > scroller.clientWidth + 1;
  if (over) { setDensity(1); over = scroller.scrollWidth > scroller.clientWidth + 1; }
  fitKey = `${tiles.size}|${activeId}|${Math.round(scroller.clientWidth)}|${size}|${root.style.getPropertyValue("--icbar-maxw")}|${root.classList.contains("icbar-nobars")}`;
  syncScroll(over);
}
const stopWheel = (ev) => {
  if (!scroller || scroller.scrollWidth <= scroller.clientWidth + 1) return;
  const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
  ev.preventDefault();
  ev.stopPropagation();
  scroller.scrollLeft += d;
};
function syncScroll(over) {
  if (!scroller) return;
  const can = over ?? scroller.scrollWidth > scroller.clientWidth + 1;
  scroller.classList.toggle("icbar-scrolls", can);
  if (can !== wheelOn) {
    wheelOn = can;
    if (can) scroller.addEventListener("wheel", stopWheel, { passive: false });
    else scroller.removeEventListener("wheel", stopWheel);
  }
  fades();
}
function fades() {
  if (!scroller) return;
  const l = scroller.scrollLeft > 2, r = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2;
  scroller.classList.toggle("icbar-fl", l);
  scroller.classList.toggle("icbar-fr", r);
}
function centerOn(id, smooth) {
  const c = tiles.get(id);
  if (!c || !scroller || scroller.scrollWidth <= scroller.clientWidth + 1) return;
  const left = c.li.offsetLeft + c.li.offsetWidth / 2 - scroller.clientWidth / 2;
  const max = scroller.scrollWidth - scroller.clientWidth;
  scroller.scrollTo({ left: Math.max(0, Math.min(max, left)), behavior: smooth && !reduced() ? "smooth" : "auto" });
}

/* ---------- live region ---------- */
function say(text) {
  if (!live || !text) return;
  live.textContent = "";
  clearTimeout(liveTimer);
  liveTimer = setTimeout(() => { if (live) live.textContent = text; }, 80);
}

/* ---------- root ---------- */
function ensureRoot() {
  if (root?.isConnected) {
    if (root.classList.contains("icbar-bye")) { clearTimeout(byeTimer); root.classList.remove("icbar-bye"); mounted = true; }
    return false;
  }
  root = mk("div");
  root.id = ID;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", t("ICB.Bar.Region"));
  root.style.setProperty("--icbar-scale", String(SIZES[size] ?? 1));
  live = mk("div", "icbar-sr");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  shell = mk("div", "icbar-shell");
  prevB = mk("button", "icbar-nav icbar-prev");
  nextB = mk("button", "icbar-nav icbar-next");
  for (const [b, glyph] of [[prevB, "icbar-g-prev"], [nextB, "icbar-g-next"]]) {
    b.type = "button";
    b.dataset.tooltipDirection = "DOWN";
    const i = mk("i", glyph);
    i.setAttribute("aria-hidden", "true");
    b.append(i);
  }
  roundEl = mk("div", "icbar-round");
  roundNum = mk("b", "icbar-rn");
  roundNum.setAttribute("aria-hidden", "true");
  const roundSr = mk("span", "icbar-sr");   // the words for screen readers; the chip itself is a plain, non-interactive plate
  roundSr.dataset.role = "round";
  roundEl.append(roundNum, roundSr);
  scroller = mk("div", "icbar-scroller");
  list = mk("ul", "icbar-list");
  list.setAttribute("role", "list");
  scroller.append(list);
  shell.append(prevB, roundEl, scroller, nextB);
  root.append(live, shell);
  wire();
  document.body.appendChild(root);
  if (window.ResizeObserver) {
    ro ??= new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; relayout(false); }); });
    for (const el of [shell, document.getElementById("sidebar"), document.getElementById("scene-navigation")]) if (el) ro.observe(el);
  }
  lastDensity = -1; fitKey = ""; wheelOn = false; mounted = true;
  return true;
}

/* ---------- interactions ---------- */
const combatantOf = (id) => curCombat?.combatants?.get(id) ?? null;
function tokenDocOf(id) {
  const td = combatantOf(id)?.token;
  return td && td.parent === canvas?.scene ? td : null;
}
function doSelect(id) {
  const td = tokenDocOf(id), it = tiles.get(id)?.item;
  if (!td || !it?.canSelect) return false;
  try { return !!td.object?.control({ releaseOthers: true }); } catch { return false; }
}
function doPan(id) {
  const td = tokenDocOf(id), it = tiles.get(id)?.item, o = td?.object;
  if (!o || !it?.canPan || !(game.user.isGM || o.visible)) return;
  try { canvas.animatePan({ x: o.center.x, y: o.center.y, duration: 400 }); } catch (e) { console.warn(LOG, "pan", e); }
}
async function doSheet(id) {
  const it = tiles.get(id)?.item, actor = combatantOf(id)?.actor;
  if (!actor || !it?.canSheet) return;
  try { await actor.sheet?.render({ force: true }); actor.sheet?.bringToFront?.(); } catch (e) { console.warn(LOG, "sheet", e); }
}
function hoverTile(id, on, ev) {
  try {
    if (!on) { hovered?._onHoverOut?.(ev); hovered = null; return; }
    const o = tokenDocOf(id)?.object;
    if (!o || !(o.visible || game.user.isGM) || !o._canHover?.(game.user, ev)) return;
    if (hovered && hovered !== o) hovered._onHoverOut?.(ev);
    o._onHoverIn?.(ev, { hoverOutOthers: true });   // the same protected pair core's combat tracker uses
    hovered = o;
  } catch { hovered = null; }
}
function turnStep(dir) {
  const c = curCombat;
  if (!c || !game.user.isGM) return;
  const p = dir < 0 ? c.previousTurn() : c.nextTurn();
  Promise.resolve(p).catch((e) => console.warn(LOG, "turn", e));
}
function wire() {
  root.addEventListener("click", (ev) => {
    const nav = ev.target.closest?.(".icbar-nav");
    if (nav) { if (!nav.disabled) turnStep(nav.classList.contains("icbar-prev") ? -1 : 1); return; }
    const tile = ev.target.closest?.(".icbar-tile");
    const id = tile?.parentElement?.dataset.id;
    if (!id) return;
    if (ev.shiftKey) doSheet(id); else doSelect(id);
  });
  root.addEventListener("dblclick", (ev) => {
    const id = ev.target.closest?.(".icbar-tile")?.parentElement?.dataset.id;
    if (id) { ev.preventDefault(); doPan(id); }
  });
  root.addEventListener("mousedown", (ev) => { if (ev.target.closest?.(".icbar-nav")) ev.preventDefault(); });   // keep the canvas selection as it is
  root.addEventListener("keydown", (ev) => {
    const tile = ev.target.closest?.(".icbar-tile");
    if (!tile || ev.target !== tile) return;
    const id = tile.parentElement.dataset.id;
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (ev.shiftKey) doSheet(id);
      else if (!doSelect(id)) doPan(id);
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
      const lis = [...list.children].filter((n) => !n.classList.contains("icbar-leaving"));
      const to = lis[lis.indexOf(tile.parentElement) + (ev.key === "ArrowRight" ? 1 : -1)]?.firstElementChild;
      if (to) { ev.preventDefault(); to.focus(); }
    }
  });
  let over = null;
  root.addEventListener("pointerover", (ev) => {
    const tile = ev.target.closest?.(".icbar-tile");
    if (tile === over) return;
    if (over) hoverTile(over.parentElement.dataset.id, false, ev);
    over = tile ?? null;
    if (tile) hoverTile(tile.parentElement.dataset.id, true, ev);
  }, { passive: true });
  root.addEventListener("pointerleave", (ev) => { if (over) hoverTile(over.parentElement.dataset.id, false, ev); over = null; }, { passive: true });
  scroller.addEventListener("scroll", fades, { passive: true });
}

/* ---------- one tile ---------- */
function makeRow(kind) {
  const el = mk("div", `icbar-row icbar-${kind}`);
  const ico = mk("i", "icbar-ico");
  ico.setAttribute("aria-hidden", "true");
  const bar = mk("div", "icbar-bar");
  const fill = mk("i", "icbar-fill");
  const glint = mk("i", "icbar-glint");
  bar.append(fill, glint);
  const val = mk("span", "icbar-val");
  val.setAttribute("aria-hidden", "true");
  const n = mk("b", "icbar-num");
  const max = mk("i", "icbar-max");
  const unit = mk("small", "icbar-unit");
  val.append(n, max, unit);
  el.append(ico, bar, val);
  el.hidden = true;
  return { el, bar, fill, glint, n, max, unit, shown: false };
}
function makeTile(it) {
  const li = mk("li", "icbar-item");
  li.dataset.id = it.id;
  const tile = mk("div", "icbar-tile");
  tile.setAttribute("role", "button");
  tile.tabIndex = 0;
  const art = mk("div", "icbar-art");
  const ph = mk("i", "icbar-ph");
  ph.setAttribute("aria-hidden", "true");
  const img = mk("img", "icbar-img");
  img.alt = "";
  img.decoding = "async";
  img.draggable = false;
  img.addEventListener("error", () => { img.dataset.bad = img.getAttribute("src") ?? ""; img.remove(); });   // a broken picture falls back to the glyph behind it
  const stateI = mk("i", "icbar-state");
  stateI.setAttribute("aria-hidden", "true");
  art.append(ph, img, stateI);
  const init = mk("b", "icbar-init");
  init.setAttribute("aria-hidden", "true");
  const disp = mk("i", "icbar-disp");
  disp.setAttribute("aria-hidden", "true");
  const hid = mk("i", "icbar-hid");
  hid.setAttribute("aria-hidden", "true");
  const name = mk("div", "icbar-name");
  name.setAttribute("aria-hidden", "true");
  const nameT = mk("span");
  name.append(nameT);
  const bars = mk("div", "icbar-bars");
  bars.setAttribute("aria-hidden", "true");
  const hp = makeRow("hp"), rs = makeRow("rs");
  bars.append(hp.el, rs.el);
  tile.append(art, init, disp, hid, name, bars);
  li.append(tile);
  return { li, tile, refs: { art, ph, img, init, nameT, bars, hp, rs }, prev: null, item: null, leaving: false, shake: 0 };
}

function paintRow(card, key, spec, first) {
  const row = card.refs[key], prev = card.prev?.rows?.[key] ?? null;
  row.el.hidden = !spec.show;
  if (!spec.show) {   // nothing of a row that may not be shown stays in the DOM (not even a stale count)
    if (row.shown || first) {
      row.fill.style.removeProperty("--v");
      row.n.style.removeProperty("--icbar-n");
      row.bar.style.removeProperty("--tick");
      setText(row.max, "");
      setText(row.unit, "");
    }
    row.shown = false;
    return null;
  }
  const fresh = first || !row.shown;
  row.shown = true;
  const segs = (m) => (m > 0 && m <= 12 ? Math.round(m) : 10);
  /* a viewer without numbers gets ten plain segments: the count of segments would give the maximum away */
  const max = !card.item.nums || (key === "hp" && card.item.kind === "challenge") ? 10 : card.item[key].max;
  row.bar.style.setProperty("--tick", `${(100 / segs(max)).toFixed(3)}%`);
  row.bar.dataset.dense = segs(max) > 8 ? "1" : "";
  row.el.classList.toggle("icbar-low", !!spec.low);
  row.n.classList.toggle("icbar-pct", !!spec.pct);
  setText(row.max, card.item.nums ? spec.max : "");
  setText(row.unit, card.item.nums ? spec.unit : "");
  const shownCount = card.item.nums ? spec.count : 0;
  const apply = () => { row.fill.style.setProperty("--v", spec.frac.toFixed(4)); row.n.style.setProperty("--icbar-n", String(shownCount)); };
  if (fresh) {
    row.fill.style.setProperty("--v", "0");
    row.n.style.setProperty("--icbar-n", "0");
    requestAnimationFrame(() => requestAnimationFrame(apply));
  } else apply();
  const now = { frac: spec.frac, count: spec.count };
  if (!fresh && prev && (prev.frac !== now.frac || prev.count !== now.count)) {
    const good = now.frac !== prev.frac ? now.frac > prev.frac : now.count > prev.count;   // more Health / Resolve / progress / time = good
    row.glint.classList.remove("icbar-good", "icbar-bad");
    void row.glint.offsetWidth;   // restart the one-shot (colour only, so it also plays under reduced motion)
    row.glint.classList.add(good ? "icbar-good" : "icbar-bad");
  }
  return now;
}

function paintTile(card, it, first) {
  const { tile, refs } = card;
  const wasHp = card.prev?.hpv ?? null;
  card.item = it;
  tile.parentElement.dataset.token = it.tokenId;
  tile.dataset.disp = String(it.disp);
  const own = it.own, hid = it.hidden, dead = it.defeated;
  tile.toggleAttribute("data-own", own);
  tile.toggleAttribute("data-hidden", hid);
  tile.toggleAttribute("data-defeated", dead);
  tile.toggleAttribute("data-active", it.active);
  tile.toggleAttribute("data-sel", it.selected);
  tile.toggleAttribute("data-bars", it.showHp || it.showRs);
  tile.toggleAttribute("data-nums", it.nums && (it.showHp || it.showRs));
  tile.dataset.kind = it.kind;
  if (it.active) tile.setAttribute("aria-current", "true"); else tile.removeAttribute("aria-current");
  setText(refs.init, it.initText);
  setText(refs.nameT, it.name);
  // portrait: a failing image is removed (glyph behind it); a changed source is swapped in place
  if (it.img && refs.img.dataset.bad !== it.img) {
    if (!refs.img.parentNode) refs.art.insertBefore(refs.img, refs.art.lastChild);
    if (refs.img.getAttribute("src") !== it.img) { delete refs.img.dataset.bad; refs.img.src = it.img; }
  } else refs.img.remove();

  const specHp = rowSpec(it, "hp"), specRs = rowSpec(it, "rs");
  const nowHp = paintRow(card, "hp", specHp, first);
  const nowRs = paintRow(card, "rs", specRs, first);

  // accessible name + tooltip. Numbers only when the viewer may see them (rowSpec().say carries them, so it is only used when `nums`).
  const disp = t(`ICB.Bar.Disp.${dispKey(it.disp)}`);
  const initSay = it.init === null ? t("ICB.Bar.NoInit") : t("ICB.Bar.Init", { n: it.initText });
  const flags = [it.active ? t("ICB.Bar.Active") : "", dead ? t("ICB.Bar.Defeated") : "", hid ? t("ICB.Bar.Hidden") : "", own ? t("ICB.Bar.Yours") : ""].filter(Boolean);
  const numbers = it.nums ? [specHp.show ? specHp.say : "", specRs.show ? specRs.say : ""].filter(Boolean) : [];
  const hint = it.canSelect ? t(it.canSheet ? "ICB.Bar.Hint.Select" : "ICB.Bar.Hint.Pan") : it.canSheet ? t("ICB.Bar.Hint.Sheet") : it.canPan ? t("ICB.Bar.Hint.Pan") : "";
  tile.setAttribute("aria-label", [it.name, initSay, disp, ...flags, ...numbers, hint].filter(Boolean).join(". ") + ".");
  tile.dataset.tooltip = it.name;   // hover: the name only (escaped by Foundry as plain text); everything else is in the aria-label
  tile.removeAttribute("data-tooltip-html");
  tile.dataset.tooltipDirection = "DOWN";

  // dropping to 0 Health: one short shake (not on load, not for challenges, whose "health" is progress)
  const hpNow = it.kind !== "challenge" && it.hp.v !== null ? it.hp.v : null;
  if (!first && wasHp !== null && hpNow !== null && wasHp > 0 && hpNow <= 0 && it.showHp) shakeTile(card);
  card.prev = { hpv: hpNow, rows: { hp: nowHp, rs: nowRs } };
}

function shakeTile(card) {
  if (reduced()) return;
  anim(card.tile, [
    { translate: "0 0" }, { translate: "-5px 0" }, { translate: "4px 0" }, { translate: "-3px 0" }, { translate: "2px 0" }, { translate: "0 0" }
  ], { duration: 420, easing: "ease-out" });
}

/* ---------- FLIP ---------- */
function flipRects() {
  const m = new Map();
  for (const c of tiles.values()) if (c.li.isConnected && !c.leaving) m.set(c.li, c.li.getBoundingClientRect().left);
  for (const el of m.keys()) for (const a of el.getAnimations?.() ?? []) if (a.id === "icbar-flip") a.cancel();
  return m;
}
function flipPlay(first) {
  if (reduced() || !first.size) return;
  for (const [el, x0] of first) {
    if (!el.isConnected) continue;
    const dx = x0 - el.getBoundingClientRect().left;
    if (Math.abs(dx) > 1) { const a = anim(el, [{ translate: `${dx}px 0` }, { translate: "0 0" }], { duration: 340 }); if (a) a.id = "icbar-flip"; }
  }
}

/* ---------- the pass ---------- */
function leave(id, card) {
  tiles.delete(id);
  card.leaving = true;
  card.li.classList.add("icbar-leaving");
  card.tile.inert = true;
  const ms = reduced() ? 120 : 220;
  anim(card.tile, reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, scale: "1" }, { opacity: 0, scale: ".6" }], { duration: ms, fill: "forwards" });
  setTimeout(() => {
    const before = flipRects();
    card.li.remove();
    if (root?.isConnected) { flipPlay(before); fit(true); place(); }
  }, ms + 20);
}

function paint(model, loud) {
  const fresh = !tiles.size;
  const first = flipRects();
  const want = new Set(model.items.map((i) => i.id));
  for (const [id, card] of [...tiles]) if (!want.has(id)) leave(id, card);
  let added = 0;
  model.items.forEach((it, idx) => {
    let card = tiles.get(it.id);
    const isNew = !card;
    if (isNew) {
      card = makeTile(it);
      tiles.set(it.id, card);
      list.append(card.li);
      added++;
    }
    paintTile(card, it, isNew);
    if (isNew) {
      if (fresh) anim(card.tile, reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: "0 -12px" }, { opacity: 1, translate: "0 0" }], { duration: reduced() ? 160 : 380, delay: reduced() ? 0 : 160 + Math.min(idx, 10) * 45, fill: "backwards" });
      else anim(card.tile, reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, scale: ".6" }, { opacity: 1, scale: "1" }], { duration: reduced() ? 160 : 320, fill: "backwards" });
    }
  });
  // order: move only the nodes that are out of place, walking from the end
  const live2 = model.items.map((i) => tiles.get(i.id).li);
  let next = null;
  for (let i = live2.length - 1; i >= 0; i--) {
    const n = live2[i];
    let sib = n.nextElementSibling;
    while (sib && sib.classList.contains("icbar-leaving")) sib = sib.nextElementSibling;
    if (sib !== next) list.insertBefore(n, next);
    next = n;
  }
  // header: round chip, buttons
  const rl = t("ICB.Bar.RoundShort", { n: model.round });
  if (roundNum.textContent !== rl) {
    const bump = roundNum.textContent !== "";
    roundNum.textContent = rl;
    if (bump && !reduced()) anim(roundNum, [{ scale: ".7", opacity: ".3" }, { scale: "1.25", opacity: "1", offset: .5 }, { scale: "1" }], { duration: 420 });
  }
  setText(roundEl.querySelector(".icbar-sr"), t("ICB.Bar.RoundLong", { n: model.round }));
  const gm = !!game.user.isGM;
  let canUpdate = false;
  try { canUpdate = gm && curCombat.canUserModify(game.user, "update"); } catch { canUpdate = gm; }
  for (const b of [prevB, nextB]) b.hidden = !gm;
  prevB.disabled = !canUpdate || (model.round <= 1 && !(model.turn > 0));   // stepping back from the very first turn would un-start the combat
  nextB.disabled = !canUpdate;
  for (const [b, k] of [[prevB, "ICB.Bar.Prev"], [nextB, "ICB.Bar.Next"]]) { b.setAttribute("aria-label", t(k)); b.dataset.tooltip = t(k); }
  root.classList.toggle("icbar-nobars", !model.items.some((i) => i.showHp || i.showRs));
  root.classList.toggle("icbar-empty", !model.items.length);

  // active turn: announce, glide
  const act = model.items.find((i) => i.active) ?? null;
  const prevActive = activeId;
  activeId = act?.id ?? null;
  const key = `${curCombatId}:${model.round}:${model.turn}:${activeId}`;
  if (key !== lastKey) {
    const sameCombat = lastKey.startsWith(`${curCombatId}:`);
    lastKey = key;
    if (act && (loud || sameCombat)) say(t("ICB.Bar.Turn", { name: act.name }));
  }
  place();
  fit(true);
  place();
  flipPlay(first);
  if (activeId && (activeId !== prevActive || fresh)) requestAnimationFrame(() => centerOn(activeId, !fresh));
}

/* ---------- show / hide the whole bar ---------- */
function enter() {
  if (!shell) return;
  for (const a of shell.getAnimations?.() ?? []) a.cancel();   // a leftover fill:forwards exit
  const top = parseFloat(root.style.getPropertyValue("--icbar-top")) || 0;
  if (reduced()) { anim(shell, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); return; }
  const from = -(top + shell.offsetHeight + 30);   // fully above the top edge of the window: it comes out from under the scene navigation
  anim(shell, [{ translate: `0 ${from}px` }, { translate: "0 6px", offset: 0.74, easing: "ease-out" }, { translate: "0 0" }], { duration: 460 });
}
function unmount(quick) {
  if (hovered) { try { hovered._onHoverOut?.({ buttons: 0 }); } catch { /* gone */ } hovered = null; }
  if (!root?.isConnected) { cleanup(); return; }
  if (root.classList.contains("icbar-bye") && !quick) return;
  publishBottom(0);
  if (quick) { cleanup(); return; }
  root.classList.add("icbar-bye");
  mounted = false;
  const top = parseFloat(root.style.getPropertyValue("--icbar-top")) || 0;
  if (reduced()) anim(shell, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: "forwards" });
  else anim(shell, [{ translate: "0 0" }, { translate: `0 ${-(top + shell.offsetHeight + 30)}px` }], { duration: 320, easing: "cubic-bezier(.5, 0, .9, .4)", fill: "forwards" });
  clearTimeout(byeTimer);
  byeTimer = setTimeout(cleanup, (reduced() ? 160 : 320) + 80);
}
function cleanup() {
  clearTimeout(byeTimer);
  clearTimeout(liveTimer);
  ro?.disconnect();
  ro = null;
  root?.remove();
  root = shell = scroller = list = roundEl = roundNum = prevB = nextB = live = null;
  tiles.clear();
  curCombat = null; curCombatId = null; lastKey = ""; activeId = null; lastDensity = -1; fitKey = ""; wheelOn = false; mounted = false;
  publishBottom(0);
}

function sync(opts = {}) {
  timer = 0;
  const loud = !!opts.loud;
  try {
    const combat = ready && !down && enabled() && canvas?.scene ? pick(opts.prefer) : null;
    if (!combat) { if (root) unmount(); return; }
    if (curCombatId && curCombatId !== combat.id) { for (const [id, card] of [...tiles]) { card.li.remove(); tiles.delete(id); } lastKey = ""; }
    curCombat = combat;
    curCombatId = combat.id;
    const wasMounted = !!root?.isConnected && !root.classList.contains("icbar-bye");
    const created = ensureRoot();
    const model = build(combat);
    paint(model, loud);
    if (created || !wasMounted) { place(); enter(); }
  } catch (e) { console.warn(LOG, "update failed", e); }
  if (again) { again = false; timer = setTimeout(() => sync(), 90); }
}

/* ---------- public ---------- */
/* one debounced entry point for every hook. trail = combatant hooks: core rebuilds Combat#turns 50 ms after them, so a second pass follows. */
export function schedule(trail = false) {
  if (!ready) return;
  if (trail) again = true;
  clearTimeout(timer);
  timer = setTimeout(() => sync(), 60);
}
/* the combat is starting right now (main.mjs, before the banner): mount at once so the banner already finds the bar's bottom edge */
export function syncNow(opts = {}) {
  clearTimeout(timer);
  sync(opts);
}
export function setReady(v) { ready = !!v; if (!ready) { clearTimeout(timer); timer = 0; } }
export function setDown(v) { down = !!v; if (down) { clearTimeout(timer); timer = 0; unmount(true); } }
export function removed(combatId) {   // deleteCombat: the collection may still hand it out for a moment
  goneId = combatId;
  setTimeout(() => { if (goneId === combatId) goneId = null; }, 1500);
  syncNow();
}
export function setSize(s) {
  size = SIZES[s] ? s : "normal";
  root?.style.setProperty("--icbar-scale", String(SIZES[size]));
  if (root) { place(); fit(true); }
}
export function refresh() { syncNow(); }
export function isShowing() { return !!root?.isConnected && !root.classList.contains("icbar-bye"); }

/* hook helpers: is this document part of the bar? (cheap, no DOM) */
export function touchesToken(td) { return !!td && tiles.size > 0 && !!td.id && [...tiles.values()].some((c) => c.item?.tokenId === td.id); }
export function touchesActor(actor) {
  if (!actor || !tiles.size) return false;
  return [...tiles.values()].some((c) => c.item?.actorId === actor.id || (actor.isToken && actor.token?.id === c.item?.tokenId));
}
/* controlToken: classes only */
export function paintSelection() {
  if (!root) return;
  const sel = controlledIds();
  for (const c of tiles.values()) {
    const on = !!c.item && !!c.item.tokenId && sel.has(c.item.tokenId);
    c.tile.toggleAttribute("data-sel", on);
    if (c.item) c.item.selected = on;
  }
}
/* hoverToken: the tile echoes the token under the pointer */
export function echo(token, on) {
  if (!root) return;
  const id = token?.document?.id;
  if (!id) return;
  for (const c of tiles.values()) if (c.item?.tokenId === id) c.tile.toggleAttribute("data-echo", !!on);
}

export function destroy() {
  clearTimeout(timer); timer = 0; again = false; ready = false; down = false;
  clearTimeout(byeTimer);
  if (hovered) { try { hovered._onHoverOut?.({ buttons: 0 }); } catch { /* gone */ } hovered = null; }
  cleanup();
}
