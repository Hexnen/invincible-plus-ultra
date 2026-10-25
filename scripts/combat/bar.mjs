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
   MOTION: transform / opacity / clip-path only (Web Animations on the individual translate / scale properties), nothing per frame. One
   choreography, morph() below, serves every change: FLIP for the tiles, the chrome and the ring, the camera (auto-centring) folded into the
   same FLIP, expand / collapse of the active tile, rapid-click hold, round-chip digit slide. */
import { t } from "./lang.mjs";
import { freeArea, hudLimit, relayout as relayoutBanner } from "./banner.mjs";
import { unitOf, unitName } from "../challenges/lang.mjs";
import { yzeOn, yzeWaiting, yzeMode, actorOf, toggleActionMark } from "../yze.mjs";
import { groupsFor } from "../party/actions.mjs";   // Year Zero Engine Combat action usage (shared with the party cards; scripts/yze.mjs documents the data)

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
let hideTimer = 0, missTimer = 0, enteredFor = null, lowRow = false, mode = -1, backSince = 0, backTimer = 0;
let waitSince = 0, waitTimer = 0, waitEl = null, wasWaiting = false;
let layer = null, ring = null, ringOn = false, ringKey = "", holdOn = false, holdTimer = 0, lastTurnAt = 0, lastRound = null;   // motion: ring + ghosts layer, rapid-click hold, last round seen
let rnPre = null, rnWin = null, rnPost = null, rnCur = null;                                                                     // the round chip's pieces: "R", the sliding number, the rest
let hudEl = null, hudRo = null, hudMo = null, bodyMo = null, hudTimer = 0;
const GRACE_MS = 600;     // "no combat" must persist this long before the bar leaves
const WAIT_MS = 350;      // Year Zero: "every initiative null" younger than this is the reset-then-redraw of a round: the last good render stays
const MISS_MS = 350;      // a tile missing from the model for less than this stays (a transient / rebuilt Combat#turns must not blink the strip)
const BACK_AT = 0.85;     // compact -> full tiles only below this share of the room, and only after BACK_MS of it
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
  /* ACTION PIPS (YZE only): [{ k: "fast"|"slow"|"one", used }] for the entry that owns the actor's action statuses; null = draw nothing (no YZE,
     no actions mode, defeated, an earlier duplicate of the token whose marks were already cleared). Same visibility as the tile itself. */
  let acts = null;
  try {
    const g = td?.id && !c.isDefeated && !challenge ? groupsFor([td.id], td.actor ?? actor, ctx.combat)?.find((x) => x.id === c.id) : null;
    if (g?.pips?.length && g.pips.every((p) => p.state !== "past")) acts = g.pips.map((p) => ({ k: p.k, used: p.state === "used", id: p.k === "fast" ? "fastAction" : p.k === "slow" ? "slowAction" : `action${g.slot}` }));   // id = the status the GM buttons toggle (same ids as turn/main.mjs)
  } catch { acts = null; }
  return {
    acts,
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
  const ctx = { mode: get(KEY.players) ?? "friendly", res: get(KEY.res) ?? "both", sel: controlledIds(), combat };
  const items = [];
  const turns = combat.turns ?? [];
  /* Year Zero Engine: Combat, waiting for the draw: every living initiative is null, so the order means nothing and nobody has the turn */
  let waiting = false;
  try { waiting = yzeOn() && yzeWaiting(combat); } catch { waiting = false; }
  turns.forEach((c, i) => { const it = read(c, !waiting && i === combat.turn, ctx); if (it) items.push(it); });
  /* DUPLICATES (several combatants of one token, Year Zero speed): `dup` = { k: its place among the token's entries in turn order, n, first }.
     Only the FIRST shown entry carries Health / Resolve (the numbers are the same for all); a later one is the compact variant, unless it is the
     active tile, which always stays the full one. */
  const entries = new Map(), seen = new Set();
  for (const c of turns) if (c.tokenId) { const a = entries.get(c.tokenId); if (a) a.push(c.id); else entries.set(c.tokenId, [c.id]); }
  for (const it of items) {
    const ids = it.tokenId ? entries.get(it.tokenId) : null;
    if (!ids || ids.length < 2) continue;
    const first = !seen.has(it.tokenId);
    seen.add(it.tokenId);
    it.dup = { k: ids.indexOf(it.id) + 1, n: ids.length, first };
    if (!first && !it.active) { it.showHp = false; it.showRs = false; }
  }
  return { round: Number(combat.round) || 0, turn: combat.turn ?? null, items, waiting };
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
/* MIN_GAP: the island needs room for the chrome (round chip, two buttons, paddings: ~155 px) plus the ACTIVE tile in full with its fade margins
   (~260 px), so below ~430 px a lower row (the whole free width) serves better. The decision reads only things the bar does not move (the
   navigation's right edge, the sidebar, the dock's resting edge) and a FIXED band height, never the bar's own height; BACK_GAP adds hysteresis
   (an island that has dropped returns only with 50 px to spare), so a pure turn change can never flip the row. */
const MIN_GAP = 430, BACK_GAP = 480;
function place() {
  if (!root || !shell) return;
  const h = shell.offsetHeight;
  const band = Math.round(96 * (SIZES[size] ?? 1));
  const { left, right } = freeArea();
  let navR = 0;
  try {
    const r = (document.querySelector("#scene-navigation .scene-navigation-menu") ?? document.getElementById("scene-navigation"))?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0 && r.top < 150) navR = r.right;
  } catch { navR = 0; }
  let top = 0, lo = Math.max(left, navR ? navR + 14 : left), hi = Math.min(right, hudLimit(0, band));
  const low = lowRow ? hi - lo < BACK_GAP : hi - lo < MIN_GAP;
  lowRow = low;
  if (low) {
    top = Math.round(Math.min(150, Math.max(navBottom(), 36)) + 6);
    lo = left;
    hi = Math.min(right, hudLimit(top, band));
  }
  const avail = Math.max(160, hi - lo);
  root.classList.toggle("icbar-low", low);
  root.style.setProperty("--icbar-top", `${top}px`);
  root.style.setProperty("--icbar-maxw", `${Math.round(avail)}px`);
  root.style.setProperty("--icbar-cx", `${Math.round(lo + avail / 2)}px`);
  if (!root.classList.contains("icbar-bye")) publishBottom(top + h);
  return top;
}
export function relayout(force = true) { if (root) { place(); fit(force); place(); syncRing(); } }

/* density: full tiles when they fit, compact ones when they do not, and a scrolling strip when even those do not. N comes from the measured
   widths (a synchronous class swap that is never painted), never from a fixed count. */
/* The decision reads INTRINSIC widths (the list is width:max-content, the chrome is the shell minus the scroller), measured with the active
   tile's name set to its widest, so it depends on neither the bar's current width / density nor on which tile is active: a pure turn change
   gives the same two numbers. Full -> compact the moment the full width exceeds the room; compact -> full only below BACK_AT of the room
   and only after it has held for 300 ms (hysteresis), so a borderline strip cannot blink between the two. */
/* the strip's content width from LAYOUT numbers (scrollWidth also counts transforms: a tile mid-FLIP or a ghost would read as overflow) */
function contentW() {
  const cs = getComputedStyle(scroller);
  return (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + list.offsetWidth;
}
const overflowing = () => !!scroller && !!list && contentW() > scroller.clientWidth + 1;
function needAt(d) {
  root.classList.toggle("icbar-d1", d === 1);
  const cs = getComputedStyle(scroller);
  const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  return shell.offsetWidth - scroller.offsetWidth + pad + list.offsetWidth;
}
function fit(force) {
  if (!root || !scroller) return;
  const maxw = parseFloat(root.style.getPropertyValue("--icbar-maxw")) || root.clientWidth;
  const key = `${tiles.size}|${activeId}|${Math.round(maxw)}|${size}|${root.classList.contains("icbar-nobars")}|${root.classList.contains("icbar-wait")}`;
  if (!force && key === fitKey) { syncScroll(); return; }
  const a = activeId ? tiles.get(activeId) : null, saved = a?.refs.nameT.textContent;
  const forced = !!a && !a.tile.hasAttribute("data-active");   // rapid-click hold: measure as if it were open, so the density cannot flip during the hop
  if (forced) a.tile.setAttribute("data-active", "");
  if (a) a.refs.nameT.textContent = "W".repeat(60);
  const n0 = needAt(0);
  if (a) a.refs.nameT.textContent = saved;
  if (forced) a.tile.removeAttribute("data-active");
  let want = mode;
  if (mode !== 1) want = n0 > maxw ? 1 : 0;   // first pass or full tiles: compact the moment they overflow
  else if (n0 <= maxw * BACK_AT) {
    if (!backSince) backSince = performance.now();
    if (performance.now() - backSince >= 300) want = 0;
    else { clearTimeout(backTimer); backTimer = setTimeout(() => { backTimer = 0; fit(true); place(); }, 320); }
  } else backSince = 0;
  if (want !== mode) { mode = want; backSince = 0; }
  lastDensity = mode;
  root.classList.toggle("icbar-d1", mode === 1);
  fitKey = key;
  syncScroll(overflowing());
  keepActiveInView();
}
/* the active tile fully inside the strip (clear of the edge fades) whenever the strip scrolls: after a resize, a dock change or a density change */
function keepActiveInView() {
  const c = activeId ? tiles.get(activeId) : null;
  if (!c || !scroller || !overflowing()) return;
  const em = parseFloat(getComputedStyle(root).fontSize) || 16;
  const padL = parseFloat(getComputedStyle(scroller).paddingLeft) || 0;
  const m = em * 1.4 + 6;
  const l = padL + c.li.offsetLeft - m, r = padL + c.li.offsetLeft + c.li.offsetWidth + m;
  const max = contentW() - scroller.clientWidth;
  let to = scroller.scrollLeft;
  if (l < to) to = l; else if (r > to + scroller.clientWidth) to = r - scroller.clientWidth;
  to = Math.max(0, Math.min(max, to));
  if (Math.abs(to - scroller.scrollLeft) > 1) scroller.scrollTo({ left: to, behavior: "auto" });
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
  const can = over ?? overflowing();
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
  const l = scroller.scrollLeft > 2, r = scroller.scrollLeft + scroller.clientWidth < contentW() - 2;
  scroller.classList.toggle("icbar-fl", l);
  scroller.classList.toggle("icbar-fr", r);
}
function centerOn(id) {
  const c = tiles.get(id);
  if (!c || !scroller || !overflowing()) return;
  const left = (parseFloat(getComputedStyle(scroller).paddingLeft) || 0) + c.li.offsetLeft + c.li.offsetWidth / 2 - scroller.clientWidth / 2;
  const max = contentW() - scroller.clientWidth;
  scroller.scrollTo({ left: Math.max(0, Math.min(max, left)), behavior: "auto" });   // instant: the strip glide (morph) animates the jump
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
  rnPre = mk("span", "icbar-rp");
  rnWin = mk("span", "icbar-rw");   // the digit window: the number slides inside it
  rnPost = mk("span", "icbar-rp");
  rnCur = null;
  roundNum.append(rnPre, rnWin, rnPost);
  const roundSr = mk("span", "icbar-sr");   // the words for screen readers; the chip itself is a plain, non-interactive plate
  roundSr.dataset.role = "round";
  roundEl.append(roundNum, roundSr);
  waitEl = mk("div", "icbar-waiting", t("ICB.Bar.WaitingShort"));   // Year Zero: shown while the round's initiative is being drawn (a plain plate, like the round chip)
  waitEl.hidden = true;
  scroller = mk("div", "icbar-scroller");
  list = mk("ul", "icbar-list");
  list.setAttribute("role", "list");
  const track = mk("div", "icbar-track");   // list (the tiles) + layer (the ring and the ghosts of tiles changing shape: absolute, in the list's own coordinates)
  layer = mk("div", "icbar-layer");
  layer.setAttribute("aria-hidden", "true");
  ring = mkRing();
  ringOn = false; ringKey = "";
  layer.append(ring.root);
  track.append(list, layer);
  scroller.append(track);
  shell.append(prevB, roundEl, waitEl, scroller, nextB);
  root.append(live, shell);
  wire();
  document.body.appendChild(root);
  if (window.ResizeObserver) {
    ro ??= new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; relayout(false); }); });
    for (const el of [shell, document.getElementById("sidebar"), document.getElementById("scene-navigation")]) if (el) ro.observe(el);
  }
  lastDensity = -1; fitKey = ""; wheelOn = false; mounted = true; mode = -1; backSince = 0; lowRow = false;
  watchHud();
  if (window.MutationObserver) {   // the Challenges HUD is created / removed by another script: look at the body's children (not its subtree)
    bodyMo ??= new MutationObserver(() => { if (document.getElementById("invincible-challenges") !== hudEl) { watchHud(); hudChanged(); } });
    bodyMo.observe(document.body, { childList: true });
  }
  return true;
}
/* THE DOCK. The bar's right limit is the Challenges dock's left edge (banner.mjs hudLimit), so everything that moves that edge must re-run the
   placement: the HUD appearing / leaving, collapsing / opening (class on its root), cards joining or leaving (its size), and the sidebar
   (already observed). A follow-up pass after the HUD's own animations settle. */
function hudChanged() {
  if (!raf) raf = requestAnimationFrame(() => { raf = 0; relayout(false); try { relayoutBanner(); } catch { /* no banner */ } });
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => { hudTimer = 0; relayout(false); }, 520);
}
function watchHud() {
  const el = document.getElementById("invincible-challenges");
  if (el === hudEl) return;
  hudRo?.disconnect(); hudMo?.disconnect();
  hudEl = el;
  if (!el) return;
  if (window.ResizeObserver) { hudRo ??= new ResizeObserver(hudChanged); hudRo.observe(el); }
  if (window.MutationObserver) { hudMo ??= new MutationObserver(hudChanged); hudMo.observe(el, { attributes: true, attributeFilter: ["class"] }); }
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
/* GM: mark / unmark one action of the ACTIVE tile (the same call the player tray makes: yze.mjs toggleActionMark). The bar repaints from the
   ActiveEffect hooks (main.mjs), nothing is painted here. */
let gmBusy = false;
async function toggleAct(btn) {
  if (!game.user.isGM || gmBusy) return;
  const id = btn.closest(".icbar-item")?.dataset.id;
  const c = id ? combatantOf(id) : null, actor = actorOf(c);
  if (!c || !actor || !tiles.get(id)?.item?.active || !btn.dataset.id) return;
  gmBusy = true;
  try { await toggleActionMark(actor, c, btn.dataset.id); } catch (e) { console.warn(LOG, "action toggle", e); } finally { gmBusy = false; }
}
function wire() {
  root.addEventListener("click", (ev) => {
    const gb = ev.target.closest?.(".icbar-gb");
    if (gb) { toggleAct(gb); return; }
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
  root.addEventListener("mousedown", (ev) => { if (ev.target.closest?.(".icbar-nav, .icbar-gb")) ev.preventDefault(); });   // keep the canvas selection as it is
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
  const acts = mk("div", "icbar-acts");   // action pips (YZE); empty and hidden when there is nothing to say
  acts.setAttribute("aria-hidden", "true");
  acts.hidden = true;
  const dup = mk("b", "icbar-dup");   // "2/3": this tile is one of several entries of the same token (Year Zero speed); hidden when there is one
  dup.setAttribute("aria-hidden", "true");
  dup.hidden = true;
  tile.append(art, init, dup, disp, hid, name, bars, acts);
  li.append(tile);
  /* GM only: the buttons that mark / unmark this tile's actions, hanging under the tile (a SIBLING of it, so the tile's name tooltip, its click and its
     clip-path animation do not reach them). Shown by CSS for the active tile only. */
  let gm = null;
  if (game.user.isGM) {
    gm = mk("div", "icbar-gma");
    gm.setAttribute("role", "group");
    gm.setAttribute("aria-label", t("ICB.Bar.Gm.Group"));
    gm.hidden = true;
    li.append(gm);
  }
  return { li, tile, refs: { art, ph, img, init, dup, name, nameT, bars, hp, rs, acts, gm }, prev: null, item: null, leaving: false, shake: 0, actsKey: "", gmKey: "", openedAt: 0 };
}

/* the pips are rebuilt only when their kinds change; a status change flips data-st in place (CSS morphs it, nothing is re-created) */
function paintActs(card, it) {
  const box = card.refs.acts, a = it.acts;
  if (!a) {
    if (!box.hidden || card.actsKey) { box.hidden = true; box.replaceChildren(); card.actsKey = ""; }
    return;
  }
  const key = a.map((p) => p.k).join("|");
  if (key !== card.actsKey) {
    box.replaceChildren(...a.map((p) => {
      const el = mk("span", "icbar-act");
      el.dataset.k = p.k;
      el.append(mk("i", "icbar-pip"), mk("b", "icbar-pl", t(`ICB.Bar.ActL.${p.k}`)));
      return el;
    }));
    card.actsKey = key;
  }
  box.hidden = false;
  a.forEach((p, i) => { const el = box.children[i]; if (el) el.dataset.st = p.used ? "used" : "open"; });
}

/* GM buttons: rebuilt only when the kinds / ids change, otherwise patched in place (hover and focus survive a status change) */
function paintGm(card, it) {
  const box = card.refs.gm;
  if (!box) return;
  const a = game.user.isGM ? it.acts : null;
  if (!a) {
    if (!box.hidden || card.gmKey) { box.hidden = true; box.replaceChildren(); card.gmKey = ""; }
    return;
  }
  const key = a.map((p) => p.id).join("|");
  if (key !== card.gmKey) {
    box.replaceChildren(...a.map((p) => {
      const b = mk("button", "icbar-gb");
      b.type = "button";
      b.dataset.id = p.id;
      b.dataset.k = p.k;
      const ico = mk("i", "icbar-gb-i");
      ico.setAttribute("aria-hidden", "true");
      b.append(ico, mk("span", "icbar-gb-t", t(`ICB.Bar.ActL.${p.k}`)));
      return b;
    }));
    card.gmKey = key;
  }
  box.hidden = false;
  a.forEach((p, i) => {
    const b = box.children[i];
    if (!b) return;
    b.dataset.st = p.used ? "used" : "open";
    b.setAttribute("aria-pressed", p.used ? "true" : "false");
    b.setAttribute("aria-label", t("ICB.Bar.Act.Line", { name: t(`ICB.Bar.Act.${p.k}`), state: t(p.used ? "ICB.Bar.Act.used" : "ICB.Bar.Act.open") }));
  });
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
  tile.toggleAttribute("data-active", it.active && !holdOn);   // during a rapid-click hold every tile stays compact (the ring still marks the turn)
  tile.toggleAttribute("data-sel", it.selected);
  tile.toggleAttribute("data-bars", it.showHp || it.showRs);
  tile.toggleAttribute("data-nums", it.nums && (it.showHp || it.showRs));
  tile.dataset.kind = it.kind;
  if (it.active) tile.setAttribute("aria-current", "true"); else tile.removeAttribute("aria-current");
  setText(refs.init, it.initText);
  refs.dup.hidden = !it.dup;
  if (it.dup) { setText(refs.dup, `${it.dup.k}/${it.dup.n}`); tile.dataset.dup = it.dup.first ? "first" : "later"; } else delete tile.dataset.dup;
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
  const dupSay = it.dup ? [t("ICB.Bar.Dup", { k: it.dup.k, n: it.dup.n }), !it.dup.first && !it.active ? t("ICB.Bar.DupBars") : ""].filter(Boolean) : [];
  const numbers = it.nums ? [specHp.show ? specHp.say : "", specRs.show ? specRs.say : ""].filter(Boolean) : [];
  paintActs(card, it);
  paintGm(card, it);
  const actsSay = (it.acts ?? []).map((p) => t("ICB.Bar.Act.Line", { name: t(`ICB.Bar.Act.${p.k}`), state: t(p.used ? "ICB.Bar.Act.used" : "ICB.Bar.Act.open") }));
  const hint = it.canSelect ? t(it.canSheet ? "ICB.Bar.Hint.Select" : "ICB.Bar.Hint.Pan") : it.canSheet ? t("ICB.Bar.Hint.Sheet") : it.canPan ? t("ICB.Bar.Hint.Pan") : "";
  tile.setAttribute("aria-label", [it.name, initSay, disp, ...flags, ...dupSay, ...numbers, ...actsSay, hint].filter(Boolean).join(". ") + ".");
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

/* ---------- MOTION: one choreography (morph) for every change of the strip ----------
   FIRST: read where everything is on screen right now (viewport rects, so a running animation, the camera and the layout are all part of
   the number) and picture the tiles whose expanded state is about to flip; cancel our running motion; MUTATE (DOM, placement, density, the
   camera = scrollLeft set to the FINAL layout position, the ring's geometry); LAST: read again and play every element from where it was to
   where it is, with ONE duration and ONE easing: tiles, round chip / buttons, ring. The camera needs no loop of its own: its scroll jump is part
   of every tile's FLIP, so camera and highlight can never fight, and an interruption just starts from wherever things are on screen now.
   Reads, then writes, then reads, then animations: nothing is measured between two writes. */
const FLIP_EASE = "cubic-bezier(.33, 1, .68, 1)";
const FLIP_MS = 320, WRAP_MS = 520;
const BURST_MS = 150;   // turn changes closer together than this are a burst (rapid clicking): ...
const HOLD_MS = 170;    // ... the tiles stay compact, the ring hops along, and the last target unfolds this long after the last change

/* a motion of the morph: one easing, tagged so cancelMotion() finds it, will-change only while something runs on the element */
function mv(el, frames, opts) {
  if (!el) return null;
  const a = anim(el, frames, { easing: FLIP_EASE, ...opts });
  if (!a) return null;
  a.id = "icbar-m";
  el.style.willChange = "translate, scale, opacity, clip-path";
  const done = () => { if (!el.getAnimations?.().some((x) => x.playState === "running")) el.style.removeProperty("will-change"); };
  a.addEventListener("finish", done);
  a.addEventListener("cancel", done);
  return a;
}
function cancelMotion() {
  if (!root) return;
  for (const a of root.getAnimations?.({ subtree: true }) ?? []) if (a.id === "icbar-m") a.cancel();
  for (const g of layer?.querySelectorAll(".icbar-ghost") ?? []) g.remove();
}

/* ---------- the ring: four thin bars and a notch in the layer over the list (the yellow outline of the active tile, as one glide) ---------- */
const RP = 5, RT = 3;   // the ring sits 5 px outside the tile (2 px offset + 3 px line), like the outline it replaces
function mkRing() {
  const root2 = mk("div", "icbar-ring");
  root2.setAttribute("aria-hidden", "true");
  root2.dataset.on = "0";
  const e = { root: root2 };
  for (const k of ["t", "b", "l", "r", "n"]) { e[k] = mk("i", `icbar-rg icbar-rg-${k}`); root2.append(e[k]); }
  return e;
}
function ringGeom() {
  const c = activeId ? tiles.get(activeId) : null;
  if (!c || !c.li.isConnected || c.leaving) return null;
  return { x: c.li.offsetLeft - RP, y: c.li.offsetTop - RP, w: c.li.offsetWidth + 2 * RP, h: c.li.offsetHeight + 2 * RP };
}
function paintRing(g) {
  if (!ring) return;
  ringOn = !!g;
  ring.root.dataset.on = g ? "1" : "0";
  if (!g) return;
  const k = `${g.x}|${g.y}|${g.w}|${g.h}`;
  if (k === ringKey) return;
  ringKey = k;
  const set = (el, x, y, w, h) => { el.style.left = `${x}px`; el.style.top = `${y}px`; if (w !== null) el.style.width = `${w}px`; if (h !== null) el.style.height = `${h}px`; };
  set(ring.t, g.x, g.y, g.w, RT);
  set(ring.b, g.x, g.y + g.h - RT, g.w, RT);
  set(ring.l, g.x, g.y, RT, g.h);
  set(ring.r, g.x + g.w - RT, g.y, RT, g.h);
  set(ring.n, g.x + g.w / 2, g.y + g.h, null, null);
}
function syncRing() { paintRing(ringGeom()); }
function ringRect() {
  if (!ringOn || !ring) return null;
  const a = ring.t.getBoundingClientRect(), l = ring.l.getBoundingClientRect();
  return { x: a.left, y: a.top, w: a.width, h: l.height };
}

/* ---------- FIRST ---------- */
function ghostOf(c) {   // a picture of the tile as it looks right now, to fade out while the real one changes shape
  const g = c.tile.cloneNode(true);
  g.classList.add("icbar-ghost");
  for (const a of ["role", "tabindex", "aria-label", "aria-current", "data-tooltip", "data-tooltip-direction", "data-echo"]) g.removeAttribute(a);
  g.setAttribute("aria-hidden", "true");
  g.inert = true;
  g.style.removeProperty("will-change");
  return g;
}
function snap(o) {
  const s = { lis: new Map(), chrome: new Map(), ring: ringRect(), ghosts: new Map() };
  for (const c of tiles.values()) {
    if (!c.li.isConnected) continue;
    const r = c.li.getBoundingClientRect();
    s.lis.set(c, { x: r.left, y: r.top, w: r.width, h: r.height, aw: c.refs.art.offsetWidth, open: c.tile.hasAttribute("data-active") });
  }
  for (const el of [prevB, roundEl, waitEl, nextB]) if (el && !el.hidden) s.chrome.set(el, el.getBoundingClientRect().left);
  const t1 = performance.now();
  for (const id of o.ghostIds ?? []) {
    const c = tiles.get(id);
    if (!c?.li.isConnected) continue;
    if (c.tile.hasAttribute("data-active") && t1 - c.openedAt < 0.6 * FLIP_MS) continue;   // still unfolding: its plate has not shown yet, nothing to fade out
    s.ghosts.set(c, ghostOf(c));
  }
  return s;
}

/* ---------- LAST + play ---------- */
function addGhost(g, c, frames, dur) {
  g.style.left = `${c.li.offsetLeft}px`;
  g.style.top = `${c.li.offsetTop}px`;
  layer.append(g);
  const a = mv(g, frames, { duration: dur, fill: "forwards" });
  if (!a) { g.remove(); return; }
  a.addEventListener("finish", () => g.remove());
  a.addEventListener("cancel", () => g.remove());
}
function play(s, o) {
  const rm = reduced();
  const moves = [];
  let maxd = 0;
  for (const [c, f] of s.lis) {
    if (!c.li.isConnected) continue;
    const r = c.li.getBoundingClientRect();
    const dx = f.x - r.left, dy = f.y - r.top;
    moves.push({ c, f, dx, dy });
    maxd = Math.max(maxd, Math.abs(dx));
  }
  const dur = rm ? 160 : o.wrap ? WRAP_MS : Math.round(Math.min(440, Math.max(FLIP_MS, 260 + maxd * 0.16)));
  if (!rm) {
    for (const { c, dx, dy } of moves) if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) mv(c.li, [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }], { duration: dur });
    for (const [el, x0] of s.chrome) {
      if (!el.isConnected || el.hidden) continue;
      const dx = x0 - el.getBoundingClientRect().left;
      if (Math.abs(dx) > 0.5) mv(el, [{ translate: `${dx}px 0` }, { translate: "0 0" }], { duration: dur });
    }
  }
  /* a tile that opened or closed: the real one unfolds / folds, its picture (ghost) fades the other way, portrait kept in place by scaling about its corner */
  for (const { c, f, dx, dy } of moves) {
    const open = c.tile.hasAttribute("data-active");
    if (open === f.open || c.leaving) continue;
    c.openedAt = open ? performance.now() : 0;
    if (rm) { anim(c.tile, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 }); continue; }
    const art = c.refs.art, ox = art.offsetLeft, oy = art.offsetTop, origin = `${ox}px ${oy}px`;
    const g = s.ghosts.get(c) ?? null, from = `${dx}px ${dy}px`;
    if (open) {
      const s0 = Math.min(1, f.aw / Math.max(1, art.offsetWidth));
      const edge = ox + (f.w - ox) / s0;
      const inR = Math.max(-40, c.tile.offsetWidth - edge);
      mv(c.tile, [{ opacity: 0, scale: String(s0), transformOrigin: origin }, { opacity: 1, offset: 0.3 }, { opacity: 1, scale: "1", transformOrigin: origin }], { duration: dur });
      /* the plate area opens on its own, slower curve: the extra width must not show as an empty box before the name and bars arrive */
      mv(c.tile, [{ clipPath: `inset(-2em ${inR}px -2em -2em)` }, { clipPath: "inset(-2em -2em -2em -2em)" }], { duration: Math.round(dur * 1.1), easing: "cubic-bezier(.5, 0, .15, 1)" });
      for (const el of [c.refs.name, c.refs.bars, c.refs.acts]) {
        if (!el || el.hidden) continue;
        mv(el, [{ opacity: 0, translate: el === c.refs.name ? "-8px 0" : "0 0" }, { opacity: 1, translate: "0 0" }], { duration: Math.round(dur * 0.55), delay: Math.round(dur * 0.22), fill: "backwards" });
      }
      if (g) addGhost(g, c, [{ translate: from, opacity: 1 }, { opacity: 1, offset: 0.12 }, { opacity: 0, offset: 0.5 }, { translate: "0 0", opacity: 0 }], dur);
    } else {
      mv(c.tile, [{ opacity: 0 }, { opacity: 0, offset: 0.28 }, { opacity: 1, offset: 0.75 }, { opacity: 1 }], { duration: dur });
      if (g) {
        const sc = Math.min(1, Math.max(0.2, art.offsetWidth / Math.max(1, f.aw)));
        const edge = ox + (c.li.offsetWidth - ox) / sc;
        const inR = Math.max(-40, f.w - edge);
        addGhost(g, c, [
          { translate: from, scale: "1", clipPath: "inset(-2em -2em -2em -2em)", opacity: 1, transformOrigin: origin },
          { opacity: 1, offset: 0.2 },
          { opacity: 0, offset: 0.7 },
          { translate: "0 0", scale: String(sc), clipPath: `inset(-2em ${inR}px -2em -2em)`, opacity: 0, transformOrigin: origin }
        ], dur);
      }
    }
  }
  /* the ring: its four bars and the notch each go from the old rectangle to the new one (lines are moved and stretched along their length only,
     so they never get thicker); a round wrap leaves toward the end and comes back in from the other side */
  const l = ringRect(), f = s.ring;
  if (l && f && !rm) {
    const sx = f.w / l.w, sy = f.h / l.h;
    const parts = [
      [ring.t, f.x - l.x, f.y - l.y, sx, 1],
      [ring.b, f.x - l.x, f.y + f.h - (l.y + l.h), sx, 1],
      [ring.l, f.x - l.x, f.y - l.y, 1, sy],
      [ring.r, f.x + f.w - (l.x + l.w), f.y - l.y, 1, sy],
      [ring.n, f.x + f.w / 2 - (l.x + l.w / 2), f.y + f.h - (l.y + l.h), 1, 1]
    ];
    for (const [el, tx, ty, kx, ky] of parts) {
      if (Math.abs(tx) < 0.5 && Math.abs(ty) < 0.5 && Math.abs(kx - 1) < 0.005 && Math.abs(ky - 1) < 0.005) continue;
      const sc = `${kx} ${ky}`;
      if (o.wrap) {
        const d = o.wrap * 48;
        mv(el, [
          { translate: `${tx}px ${ty}px`, scale: sc, opacity: 1 },
          { translate: `${tx + d}px ${ty}px`, scale: sc, opacity: 0, offset: 0.3, easing: "ease-in" },
          { translate: `${-d}px 0px`, scale: "1 1", opacity: 0, offset: 0.36 },
          { translate: "0 0", scale: "1 1", opacity: 1 }
        ], { duration: dur });
      } else mv(el, [{ translate: `${tx}px ${ty}px`, scale: sc }, { translate: "0 0", scale: "1 1" }], { duration: dur });
    }
  }
}
function morph(mutate, o = {}) {
  if (!root || !list) return;
  const s = snap(o);
  cancelMotion();
  mutate();
  play(s, o);
}

/* the round chip: a new number slides in vertically (up for a new round, down when going back), a new round also pulses once */
function paintRound(n) {
  const [pre, post = ""] = t("ICB.Bar.RoundShort", { n: "\u0001" }).split("\u0001");
  setText(rnPre, pre);
  setText(rnPost, post);
  if (rnCur === n) return;
  const first = rnCur === null, up = rnCur === null || n > rnCur;
  rnCur = n;
  const old = [...rnWin.children];
  const nw = mk("span", "icbar-rd", String(n));
  rnWin.append(nw);
  if (first) { for (const o2 of old) o2.remove(); return; }
  if (reduced()) { for (const o2 of old) o2.remove(); anim(nw, [{ opacity: 0 }, { opacity: 1 }], { duration: 140, easing: "linear" }); return; }
  const k = up ? 1 : -1;
  for (const o2 of old) {
    if (o2.dataset.gone) { o2.remove(); continue; }
    o2.dataset.gone = "1";
    const a = anim(o2, [{ translate: "0 0", opacity: 1 }, { translate: `0 ${-k * 110}%`, opacity: 0 }], { duration: 170, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
    if (a) a.addEventListener("finish", () => o2.remove()); else o2.remove();
  }
  anim(nw, [{ translate: `0 ${k * 110}%`, opacity: 0 }, { translate: "0 0", opacity: 1 }], { duration: 230, delay: 40, easing: FLIP_EASE, fill: "backwards" });
  if (up) anim(roundEl, [{ scale: "1" }, { scale: "1.1", offset: 0.4 }, { scale: "1" }], { duration: 320, delay: 40, easing: "ease-out" });
}

/* ---------- the pass ---------- */
/* a removed tile is taken out of the flow at once (it fades and shrinks where it stands) so the gap closes in the same glide as everything else */
function leave(id, card) {
  tiles.delete(id);
  card.leaving = true;
  const li = card.li;
  li.classList.add("icbar-leaving");
  li.style.cssText += `;position:absolute;left:${li.offsetLeft}px;top:${li.offsetTop}px;width:${li.offsetWidth}px;pointer-events:none`;
  card.tile.inert = true;
  const ms = reduced() ? 120 : 200;
  const a = anim(card.tile, reduced() ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, scale: "1" }, { opacity: 0, scale: ".6" }], { duration: ms, fill: "forwards" });
  if (a) a.addEventListener("finish", () => li.remove()); else li.remove();
  setTimeout(() => li.remove(), ms + 120);
}

/* RAPID CLICKING: after a burst the compact tiles stood still and only the ring hopped; now the last target unfolds */
function release() {
  holdTimer = 0;
  if (!holdOn) return;
  if (!root?.isConnected || !list) { holdOn = false; return; }
  const was = openId();
  morph(() => {
    holdOn = false;
    for (const c of tiles.values()) c.tile.toggleAttribute("data-active", !!c.item?.active);
    keepHeight();
    place(); fit(true); place();
    if (activeId) centerOn(activeId);
    syncRing();
  }, { camera: true, ghostIds: ghostIdsFor(was, activeId) });
}
/* the strip is as tall as its tallest state (a tile open: portrait + name plate + bars) even while nobody is open (rapid-click hold, the draw
   pending): the shell and --icbar-bottom must never change while the bar moves. Measured, not guessed: it depends on size, density, numbers. */
let openH = { key: "", h: 0 };
function keepHeight() {
  if (!list) return;
  const key = `${mode}|${size}|${root.classList.contains("icbar-nobars")}`;
  list.style.minHeight = "";
  if (openId()) openH = { key, h: list.offsetHeight };
  else if (openH.key === key && openH.h) list.style.minHeight = `${openH.h}px`;
}
const openId = () => { for (const [id, c] of tiles) if (c.tile.hasAttribute("data-active")) return id; return null; };
const ghostIdsFor = (a, b) => (a === b ? [] : [a, b].filter(Boolean));

function paint(model, loud, keep) {
  const fresh = !tiles.size;
  const t0 = performance.now();
  const act = model.items.find((i) => i.active) ?? null;
  const nextActive = act?.id ?? null;
  const changed = nextActive !== activeId;
  if (fresh || !nextActive) { holdOn = false; clearTimeout(holdTimer); holdTimer = 0; }
  else if (changed) {
    holdOn = holdOn || t0 - lastTurnAt < BURST_MS;
    lastTurnAt = t0;
    clearTimeout(holdTimer);
    holdTimer = holdOn ? setTimeout(release, HOLD_MS) : 0;
  }
  const wrap = !fresh && lastRound !== null && model.round !== lastRound ? (model.round > lastRound ? 1 : -1) : 0;
  lastRound = model.round;
  const o = { fresh, wrap, camera: fresh || changed, ghostIds: ghostIdsFor(openId(), holdOn ? null : nextActive) };
  morph(() => {
    const want = new Set(model.items.map((i) => i.id));
    for (const [id, card] of [...tiles]) if (!want.has(id) && !keep?.has(id)) leave(id, card);
    let added = 0;
    model.items.forEach((it, idx) => {
      let card = tiles.get(it.id);
      const isNew = !card;
      if (isNew) {
        card = makeTile(it);
        tiles.set(it.id, card);
        list.append(card.li);
      }
      paintTile(card, it, isNew);
      if (isNew) {
        if (fresh) anim(card.tile, reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: "0 -12px" }, { opacity: 1, translate: "0 0" }], { duration: reduced() ? 160 : 380, delay: reduced() ? 0 : 160 + Math.min(idx, 10) * 45, fill: "backwards" });
        else anim(card.tile, reduced() ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, translate: "0 -14px" }, { opacity: 1, translate: "0 0" }], { duration: reduced() ? 160 : 340, delay: reduced() ? 0 : Math.min(added, 5) * 45, fill: "backwards" });
        added++;
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
    paintRound(model.round);
    setText(roundEl.querySelector(".icbar-sr"), t("ICB.Bar.RoundLong", { n: model.round }));
    const gm = !!game.user.isGM;
    let canUpdate = false;
    try { canUpdate = gm && curCombat.canUserModify(game.user, "update"); } catch { canUpdate = gm; }
    for (const b of [prevB, nextB]) b.hidden = !gm;
    prevB.disabled = !canUpdate || (model.round <= 1 && !(model.turn > 0));   // stepping back from the very first turn would un-start the combat
    nextB.disabled = !canUpdate;
    for (const [b, k] of [[prevB, "ICB.Bar.Prev"], [nextB, "ICB.Bar.Next"]]) { b.setAttribute("aria-label", t(k)); b.dataset.tooltip = t(k); }
    let gmActs = false;   // the GM's action buttons need room under the strip (a fixed reservation, so the bar's height never changes with the turn)
    try { gmActs = gm && yzeOn() && yzeMode() !== "none"; } catch { gmActs = false; }
    root.classList.toggle("icbar-gm", gmActs);
    root.classList.toggle("icbar-nobars", !model.items.some((i) => i.showHp || i.showRs));
    root.classList.toggle("icbar-empty", !model.items.length);
    root.classList.toggle("icbar-wait", !!model.waiting);   // the draw has not landed: dimmed tiles (a cross-fade), no initiative tags, nobody active
    if (waitEl) {
      const showing = !waitEl.hidden;
      waitEl.hidden = !model.waiting;
      setText(waitEl, t("ICB.Bar.WaitingShort"));
      if (model.waiting && !showing && !reduced()) anim(waitEl, [{ opacity: 0, scale: ".9" }, { opacity: 1, scale: "1" }], { duration: 220, fill: "backwards" });
    }
    if (model.waiting && !wasWaiting) say(t("ICB.Bar.Waiting"));
    wasWaiting = !!model.waiting;
    keepHeight();

    // active turn: announce, glide (the glide itself is morph's: tiles, ring and the camera set below share one FLIP)
    const prevActive = activeId;
    activeId = nextActive;
    const key = `${curCombatId}:${model.round}:${model.turn}:${activeId}`;
    if (key !== lastKey) {
      const sameCombat = lastKey.startsWith(`${curCombatId}:`);
      lastKey = key;
      if (act && (loud || sameCombat)) say(t("ICB.Bar.Turn", { name: act.name }));
    }
    place();
    fit(true);
    place();
    if (activeId && (activeId !== prevActive || fresh)) centerOn(activeId);
    syncRing();
  }, o);
}

/* ---------- show / hide the whole bar ---------- */
function enter() {
  if (!shell) return;
  enteredFor = curCombatId;   // the slide-in belongs to a combat: it is never replayed for the one already on show
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
  clearTimeout(hideTimer); clearTimeout(missTimer); clearTimeout(backTimer); clearTimeout(hudTimer); clearTimeout(waitTimer); clearTimeout(holdTimer); holdTimer = 0;
  hideTimer = missTimer = backTimer = hudTimer = waitTimer = waitSince = 0;
  ro?.disconnect();
  ro = null;
  hudRo?.disconnect(); hudMo?.disconnect(); bodyMo?.disconnect();
  hudRo = hudMo = bodyMo = hudEl = null;
  root?.remove();
  root = shell = scroller = list = roundEl = roundNum = prevB = nextB = live = waitEl = null; wasWaiting = false;
  layer = ring = rnPre = rnWin = rnPost = null; rnCur = null; ringOn = false; ringKey = ""; holdOn = false; lastRound = null; lastTurnAt = 0;
  tiles.clear();
  curCombat = null; curCombatId = null; lastKey = ""; activeId = null; lastDensity = -1; fitKey = ""; wheelOn = false; mounted = false;
  enteredFor = null; mode = -1; backSince = 0; lowRow = false;
  publishBottom(0);
}

/* WHEN THE BAR SHOWS: at once when a combat is there; it leaves only after "no combat" has held for GRACE_MS (Combat collections, `started`
   and the viewed scene all blink while a turn is being applied), unless the reason is final (setting off, scene torn down, the combat deleted).
   While it waits, the last good render stays untouched. */
function sync(opts = {}) {
  timer = 0;
  const loud = !!opts.loud;
  try {
    const hard = !ready || down || !enabled() || !!opts.hard;
    const combat = ready && !down && enabled() && canvas?.scene ? pick(opts.prefer) : null;
    if (!combat) {
      if (root && (hard || opts.settled)) { clearTimeout(hideTimer); hideTimer = 0; unmount(); }
      else if (root && !hideTimer) hideTimer = setTimeout(() => { hideTimer = 0; sync({ settled: true }); }, GRACE_MS);
    } else {
      clearTimeout(hideTimer); hideTimer = 0;
      if (curCombatId && curCombatId !== combat.id) { for (const [id, card] of [...tiles]) { card.li.remove(); tiles.delete(id); } lastKey = ""; enteredFor = null; lastRound = null; holdOn = false; clearTimeout(holdTimer); holdTimer = 0; }
      curCombat = combat;
      curCombatId = combat.id;
      const wasMounted = !!root?.isConnected && !root.classList.contains("icbar-bye");
      const created = ensureRoot();
      const model = build(combat);
      // a tile missing from the model for a moment (Combat#turns is rebuilt 50 ms after combatant changes) stays until it has been gone for MISS_MS
      const have = new Set(model.items.map((i) => i.id)), keep = new Set(), now = performance.now();
      for (const [id, card] of tiles) {
        if (have.has(id)) { card.missingAt = 0; continue; }
        card.missingAt ||= now;
        if (now - card.missingAt < MISS_MS) keep.add(id);
      }
      clearTimeout(missTimer); missTimer = 0;
      /* Year Zero resetEachRound nulls every initiative and redraws a few ms later: a waiting state shorter than WAIT_MS keeps the last good render */
      let hold = false;
      if (!model.waiting) { waitSince = 0; clearTimeout(waitTimer); waitTimer = 0; }
      else if (tiles.size && !root.classList.contains("icbar-wait")) {
        waitSince ||= now;
        if (now - waitSince < WAIT_MS) { hold = true; clearTimeout(waitTimer); waitTimer = setTimeout(() => { waitTimer = 0; sync(); }, WAIT_MS - (now - waitSince) + 40); }
      }
      if (keep.size) missTimer = setTimeout(() => { missTimer = 0; sync(); }, MISS_MS + 40);
      if (!hold && !(keep.size && !model.items.length)) paint(model, loud, keep);   // every tile gone at once = a transient: the last good render stays
      if (created) { place(); enter(); }
      else if (!wasMounted) {   // the exit was under way: come back without replaying the slide for a combat already on show
        if (enteredFor === combat.id) { for (const a of shell.getAnimations?.() ?? []) a.cancel(); place(); } else { place(); enter(); }
      }
    }
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
  syncNow({ hard: true });   // a deleted combat does not come back: no grace period
}
export function setSize(s) {
  size = SIZES[s] ? s : "normal";
  root?.style.setProperty("--icbar-scale", String(SIZES[size]));
  if (root) { place(); fit(true); syncRing(); }
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
