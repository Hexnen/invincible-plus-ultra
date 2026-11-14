/* Scena splasha: warstwa ekranowa (fixed) albo przy tokenie (wewnątrz #hud rdzenia, zsynchronizowanego z canvasem).
   Jeden splash na klucz ('screen' albo id tokena); nowy wypiera poprzedni. */
import { FS, LBL, oddsText, hueOf, hsl, fmtOdds, say, shownEv } from './logic.mjs';
import * as S from './splash.mjs';
import * as LP from './letter-plan.mjs';
import * as IP from './impact-plan.mjs';
import { seesToken } from './seen.mjs';
import * as SP from '../same-picture.mjs';   // SAMEPIC: one picture for the table

const active = new Map();   // key -> ctl
const MAX_STAGES = 4;
/* położenia (% sceny): przy tokenie słowo jest tuż nad jego głową, reszta (plakietki, wstążka) w CSS .on-token */
const POS_SCREEN = { main: [50, 45], mainWreck: [34, 45], wreck: [79, 60], fail: [50, 45], pre: [50, 22] };
const POS_TOKEN = { main: [50, 21], mainWreck: [38, 21], wreck: [74, 31], fail: [50, 22], pre: [50, 8] };
let layer = null;

/* Obszar roboczy: okno bez otwartego paska bocznego (czat). Scena centruje się na nim i nie wchodzi pod czat.
   Wymiary trafiają też do warstwy jako --ins-cx / --ins-right (CSS przycina warstwę do obszaru). */
let area = { w: window.innerWidth, cx: window.innerWidth / 2, right: 0 };
export function getArea() { return area; }
export function measureArea() {
  let right = 0;
  try {
    const r = document.getElementById('sidebar')?.getBoundingClientRect();
    const rr = r ? window.innerWidth - r.left : 0;
    /* tylko wiarygodny pasek po prawej: węższy niż pół okna (inaczej zakładamy, że to nie panel boczny) */
    if (r && r.width > 0 && rr > 0 && rr < window.innerWidth * 0.5) right = Math.round(rr);
  } catch (e) { right = 0; }
  const w = Math.max(320, window.innerWidth - right);
  area = { w, cx: w / 2, right };
  if (layer) { layer.style.setProperty('--ins-right', right + 'px'); layer.style.setProperty('--ins-cx', area.cx.toFixed(1) + 'px'); }
  return area;
}
/* zmiana rozmiaru okna / zwinięcie paska: przelicz obszar i przestaw trwające sceny przy tokenach */
export function refreshArea() {
  measureArea();
  for (const ctl of active.values()) if (ctl.token && !ctl.lw) placeTokenStage(ctl);
}

function ensureLayer() {
  if (layer?.isConnected) { measureArea(); return layer; }
  layer = document.createElement('div');
  layer.id = 'invincible-splash-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.dataset.layer = LAYER;
  document.body.appendChild(layer);
  measureArea();
  return layer;
}

/* Żywy komunikat dla czytników ekranu: warstwa wizualna jest aria-hidden, więc wynik ogłasza ten element. */
let live = null, liveTimer = 0;
export function announce(text) {
  try {
    if (!text) return;
    if (!live?.isConnected) {
      live = document.createElement('div');
      live.id = 'invincible-splash-live'; live.className = 'ins-sr-only';
      live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); live.setAttribute('aria-atomic', 'true');
      document.body.appendChild(live);
    }
    live.textContent = '';   // czyszczenie przed ustawieniem, żeby ten sam tekst z kolejnego rzutu został odczytany ponownie
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => { live.textContent = text; liveTimer = setTimeout(() => { if (live) live.textContent = ''; }, 9000); }, 60);
  } catch (e) { /* komunikat to dodatek: nigdy nie psuje splasha */ }
}

/* szerokość słowa w em z prawdziwym fontem (zapas na szerokość liter) */
let _ctx = null;
function wordEm(word) {
  try {
    _ctx ??= document.createElement('canvas').getContext('2d');
    _ctx.font = '100px Comic, Impact, sans-serif';
    return _ctx.measureText(word).width / 100 + 0.04 * word.length;
  } catch (e) { return word.length * 0.6; }
}
function uOf(stage) { return parseFloat(stage.style.getPropertyValue('--u')) || 1; }
function fitFs(stage, word, base, P, frac, minFs) {
  const w = stage.clientWidth || 700, u = uOf(stage);
  const factor = 0.95 + 0.4 * P, pad = 1.5 * (1 + 0.25 * P);
  const maxFs = ((w * frac) / (u * (wordEm(word) + pad)) - 36 * P) / factor;
  return Math.max(minFs || 14, Math.min(base, Math.floor(maxFs)));
}

function tokenScale() { return canvas?.stage?.scale?.x || 1; }
/* Scena przy tokenie żyje w tej samej warstwie co ekranowa (nad oknami kart postaci), a środek tokena liczymy
   w pikselach ekranu: canvas.stage.toGlobal + położenie płótna na stronie. Zoom nie zmienia rozmiaru sceny. */
function placeTokenStage(ctl) {
  try {
    const g = canvas.stage.toGlobal(ctl.token.center);
    const r = canvas.app.view.getBoundingClientRect();
    let x = r.left + g.x, y = r.top + g.y;
    /* trzymaj scenę w obszarze roboczym: nie pod czatem (słowo zajmuje ~64% szerokości) i nie nad górną krawędzią */
    const W = ctl.W || 470, H = W * 0.75, hx = W * 0.34;
    x = Math.max(hx, Math.min(area.w - hx, x));
    const yMin = H * 0.4, yMax = Math.max(yMin, window.innerHeight - H * 0.45);
    y = Math.min(yMax, Math.max(yMin, y));
    /* FXS2 (U234): nie na otwartym biurku MG (słowo przy tokenie stojącym tuż obok zakrywało nagłówek biurka i jego kartę):
       scena odsuwa się w lewo od biurka, o ile tam się mieści */
    const desk = document.querySelector('#invincible-tactics-desk:not(.igd-collapsed) .igd')?.getBoundingClientRect();
    if (desk && desk.width > 0 && x + hx > desk.left && x - hx < desk.right && y + H * 0.4 > desk.top && y - H * 0.4 < desk.bottom && desk.left - hx >= hx) x = desk.left - hx;
    ctl.el.style.left = x.toFixed(1) + 'px';
    ctl.el.style.top = y.toFixed(1) + 'px';
  } catch (e) { /* płótno niegotowe: zostaje ostatnia pozycja */ }
}
export function onCanvasPan() {
  for (const ctl of active.values()) {
    if (ctl.lw) followPan(ctl);                 // FXLD: the lettered block follows its token / the scene
    else if (ctl.token) placeTokenStage(ctl);
  }
}

/* ------------------------------------------------------------------ LDIC: the lettered moment (LETR engine, scripts/letters/)
   The engine is handed in by main.mjs once it is loaded; null (not loaded yet, the stub without a renderer, or the setting off) = the
   classic SVG splash below. Every lettering of a moment goes into one wrapper inside the splash layer (fixed, inset 0: client px are
   the wrapper's px, the layer's clip keeps it off the chat and its z-index over the sheets; aria-hidden like the rest).
   FXLD: the moment is laid out as ONE block (letter-plan.mjs composeMoment): every lettering measured from the engine's own plan of
   that word, placed by the token or on the focus, kept inside the free part of the window, nothing overlapping; the sizes are exact
   (fit "exact": the layout knows every box), the engine's own Scale setting and ours both enlarge it and the layout counts both. */
let LE = null;
export function setLetters(engine) { LE = engine || null; }
/* the display layer (client setting splashLayer), the engine's layers (contract v3):
   screen  = over everything, sheets and dialogs too (our own splash layer, z 5000, as always);
   ui, hud = the engine's screen layers: over the bars and under the windows / over the map and under the bars;
   overlay, weather, tokens, ground = ON the map (the engine's world space: the words pan and zoom with the scene), over the whole
   scene / over the weather and smoke / over the tokens / on the ground under the tokens.
   The rest of the moment (the Resolve gauge, the rays) stays HTML: over everything with "screen", under the windows otherwise; on the
   map it follows the pan (FXLD, ADVD 13). */
export const SCREEN_LAYERS = ['screen', 'ui', 'hud'], WORLD_LAYERS = ['overlay', 'weather', 'tokens', 'ground'];
let LAYER = 'screen';
export function setLayer(v) {
  LAYER = SCREEN_LAYERS.includes(v) || WORLD_LAYERS.includes(v) ? v : 'screen';
  if (layer) layer.dataset.layer = LAYER;
}
export function layerOf() { return LAYER; }
function toScene(p) {
  try { const r = canvas.app.view.getBoundingClientRect(), q = canvas.stage.toLocal({ x: p.x - r.left, y: p.y - r.top }); return { x: Math.round(q.x), y: Math.round(q.y) }; } catch (e) { return null; }
}
function toClient(q) {
  try { const r = canvas.app.view.getBoundingClientRect(), g = canvas.stage.toGlobal(q); return { x: r.left + g.x, y: r.top + g.y }; } catch (e) { return null; }
}
/* FXLD (ADVD 14): the engine's master switch (TOOL, contract v6) off = its words never show: then the classic splash plays */
export function lettersOn() { return !!LE && LE.prefs?.enabled !== false; }
const onMap = () => WORLD_LAYERS.includes(LAYER) && !!globalThis.canvas?.ready;

/* ---- the frame of a moment: the free part of the window, the token's box, the focus point (client px) */
/* the bars the block keeps off: the left tool column, the scene bar on top, and at the bottom the hotbar, the players list and the
   tactics bars docked there (the replay pill of the log). Only a bar that really sits at that edge counts. */
export const UI_LEFT = ['#scene-controls', '#controls'];
/* v14's #scene-navigation is a column as tall as the window; its scene rows (li) are what sits on top, so the rows count */
export const UI_TOP = ['#scene-navigation li', '#scene-navigation .scene', '#navigation'];
export const UI_BOTTOM = ['#hotbar', '#players', '#mm-dir-bar', '.ilg-replay', '.ilg-bar', '#ilg-replay'];
/* v14 with the sidebar collapsed: a new chat card pops up at the right (#chat-notifications, 300 px wide, over the map) just when the
   splash starts (live, 1366: the pushed roll's sixes and gauge sat on it); a visible card is a bar on the right */
export const UI_RIGHT = ['#chat-notifications .chat-log > li', '#chat-notifications .chat-message'];
function leftOf(sel, vw) {
  let left = Infinity;
  try {
    for (const e of document.querySelectorAll(sel)) {
      const q = e.getBoundingClientRect();
      if (q && q.width > 0 && q.height > 0 && q.left > vw * 0.45) left = Math.min(left, q.left);
    }
  } catch (e) { /* a selector this Foundry does not know */ }
  return left;
}
function topOf(sel, vh) {
  let bottom = -1;
  try {
    for (const e of document.querySelectorAll(sel)) {
      const q = e.getBoundingClientRect();
      if (q && q.width > 0 && q.height > 0 && q.top < vh * 0.15 && q.bottom < vh * 0.25) bottom = Math.max(bottom, q.bottom);
    }
  } catch (e) { /* a selector this Foundry does not know */ }
  return bottom;
}
function boxOf(sel) {
  try {
    for (const e of document.querySelectorAll(sel)) {
      const q = e.getBoundingClientRect();
      if (q && q.width > 0 && q.height > 0) return q;
    }
  } catch (e) { /* a selector this Foundry does not know */ }
  return null;
}
/* core: only Foundry's own bars and the tactics bars every seat has (SAMEPIC: not the chat cards popped up on one seat, not the GM's
   director pill, not the scene bar's rows, whose number differs per seat (live: GM to 176 px, player to 96; the first row is in the
   reserve), not a bottom bar standing inside the tool column (the players list)) */
export function safeRect({ core = false } = {}) {
  measureArea();
  const vw = window.innerWidth, vh = window.innerHeight;
  let l = 12, t = 10, r = area.w - 14, b = vh - 10;
  for (const s of UI_LEFT) { const q = boxOf(s); if (q && q.left < vw * 0.15 && q.right < vw * 0.2) l = Math.max(l, q.right + 8); }
  if (!core) for (const s of UI_TOP) { const y = topOf(s, vh); if (y >= 0) t = Math.max(t, y + 6); }
  if (!core) for (const s of UI_RIGHT) { const x = leftOf(s, vw); if (x < r) r = Math.max(l + vw * 0.3, x - 10); }
  for (const s of UI_BOTTOM) { if (core && s === '#mm-dir-bar') continue; const q = boxOf(s); if (core && q && q.right <= l) continue; if (q && q.top > vh * 0.6 && q.left < area.w) b = Math.min(b, q.top - 8); }
  if (b - t < vh * 0.45) { t = 10; b = vh - 10; }   // a strange layout: the whole height rather than a slit
  /* on a map layer the words are drawn inside the scene and cut at its edge (live 1920: BARREL! lost its top at the scene's top edge,
     the dark padding above it): the block stays inside the scene rectangle too, while that leaves a usable area */
  if (onMap()) {
    try {
      const sr = canvas.dimensions?.sceneRect;
      const a = sr && toClient({ x: sr.x, y: sr.y }), c = sr && toClient({ x: sr.x + sr.width, y: sr.y + sr.height });
      if (a && c) {
        const q = { l: Math.max(l, a.x + 6), t: Math.max(t, a.y + 6), r: Math.min(r, c.x - 6), b: Math.min(b, c.y - 6) };
        if (q.r - q.l >= vw * 0.3 && q.b - q.t >= vh * 0.3) ({ l, t, r, b } = q);
      }
    } catch (e) { /* the window's rectangle */ }
  }
  return { l, t, r, b };
}
function tokenBox(token) {
  try {
    const d = token.document, gs = canvas.grid?.size ?? 100;
    const x0 = token.x ?? d.x, y0 = token.y ?? d.y, w = token.w ?? (d.width ?? 1) * gs, h = token.h ?? (d.height ?? 1) * gs;
    const a = toClient({ x: x0, y: y0 }), c = toClient({ x: x0 + w, y: y0 + h });
    if (!a || !c) return null;
    /* the art, not the grid square: a token picture scaled up (texture scale, live 1920: the caption sat on the ring of Kid
       Omni-Man's art) covers more than its square */
    const k = Math.max(1, Math.abs(d.texture?.scaleX ?? 1), Math.abs(d.texture?.scaleY ?? 1));
    const cx = (a.x + c.x) / 2, cy = (a.y + c.y) / 2, hw = (c.x - a.x) / 2 * k, hh = (c.y - a.y) / 2 * k;
    const box = { x: cx, y: cy, l: cx - hw, t: cy - hh, r: cx + hw, b: cy + hh };
    /* the drawn picture when the canvas knows it (live 1920: the art ran 41 px past its square on every side at zoom 0.75) */
    try {
      const mb = token.mesh?.getBounds?.(), v = canvas.app?.view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      if (mb && mb.width > 0 && mb.width < (c.x - a.x) * 3) {
        box.l = Math.min(box.l, v.left + mb.x); box.t = Math.min(box.t, v.top + mb.y);
        box.r = Math.max(box.r, v.left + mb.x + mb.width); box.b = Math.max(box.b, v.top + mb.y + mb.height);
      }
    } catch (e) { /* the square is enough */ }
    return box;
  } catch (e) { return null; }
}
/* the box of each lettering: the engine's own plan of that word (the same seed, avoid and hand as the play), so the layout knows
   its real width; the estimate when the engine cannot plan it */
function measureItems(items, base) {
  const hands = [];
  for (const it of items) {
    const o = engineOpts(it, base, hands);
    it._o = o;
    let m = null;
    try {
      /* SAMEPIC: measured as every seat measures it: a seat's reduced motion (no tilt, no entrance smear) plays the same block still, it
         does not lay it out smaller or elsewhere */
      const om = { ...o, reduced: false, rotation: Number.isFinite(it.rot0) ? it.rot0 : o.rotation };
      const r = LE.planFor ? LE.planFor(LP.letterable(it.text), om) : null;
      const p = r?.plan ?? (LE._plan ? (() => { const q = LE._plan(LP.letterable(it.text), om); LE._settle?.(q); return q; })() : null);
      if (p?._holdBox?.w > 0 && p.sizeK > 0) m = { w: p._holdBox.w, h: p._holdBox.h, sizeK: p.sizeK, hand: p.hand?.id, grow: IP.growOf(p), contact: IP.contactMs(p) };   // FXI-SPLASH: the entrance's biggest drawing and the instant it hits
    } catch (e) { m = null; }
    if (!m) { let k = 0.62 + 0.7 * (it.sound?.loud ?? 0.5); try { k = LE.design(LP.letterable(it.text), { ...o, reduced: false })?.sizeK ?? k; } catch (e) { /* estimate */ } const b = LP.estimateBox(it, 1); m = { w: b.w, h: b.h, sizeK: k, hand: null }; }
    it._m = m;
    if (m.hand) hands.push(m.hand);
  }
}
const measureFn = (it, S) => (it._m ? { w: it._m.w * S, h: it._m.h * S, grow: it._m.grow ?? 1 } : LP.estimateBox(it, S));
function engineOpts(it, base, hands) {
  const o = {
    mood: it.mood, sound: it.sound, hold: it.hold, rotation: it.rotation || 0, reduced: S.isReduced(), magnitude: it.magnitude,
    seed: LP.seedOf(base.seed, it.role), avoid: hands.slice(), anchor: 'center'
  };
  if (Number.isFinite(base.from) && it.from != null) o.from = base.from;
  else if (Number.isFinite(it.from)) o.from = it.from;
  if (it.colors) o.colors = it.colors.slice();
  if (it.hand) o.hand = { ...it.hand };
  for (const k of ['in', 'out', 'holdKind']) if (it[k]) o[k] = it[k];
  return o;
}
const SIDE_FROM = { above: 90, below: -90, right: 180, left: 0, focus: 90 };

/* ---- FXLD2 (ADVD2 1, 3): ONE moment for the table.
   On a map layer the block is laid out in SCENE units from what every seat shares: the hero token's document (not its animated mesh),
   the scene rectangle, the grid size, the other tokens nobody hides and the map note pins. Nothing of this seat's window (size, zoom,
   pan, bars, chat card, the engine's or our client Scale) enters that layout, so the GM and every player see the block at the same
   scene position and size. One seat's bars are not avoided there: they differ per seat, and on the map the block is part of the board
   (it pans and zooms with it).
   On the screen layers what is shared is the content (the same words in the same hand: seeded by the message), the timing (the shared
   start, beat.mjs, and the table's Duration) and the size class (a share of the window height); the place follows each seat's own
   view: by the token where that seat sees it, off that seat's bars, panels, neighbours, pins and resting dice. */
/* a map moment is sized as on a window GRID_VH grid squares tall: a mid roll's word is about half a square tall, a critical's more than
   a square (live, The Warehouse: a 350 px grid seen at zoom 0.75 shows about 4 squares in 1080 px; 10.8 made the words 2.6x too big) */
export const GRID_VH = 4.5;   // live 2026-11-13: 5 left no clean place by a roller with neighbours and a pin round him
const docOf = (t) => t?.document ?? null;
function docBox(t, gs) {
  const d = docOf(t) ?? {};
  const x0 = d.x ?? t.x ?? 0, y0 = d.y ?? t.y ?? 0, w = (d.width ?? 1) * gs, h = (d.height ?? 1) * gs;
  const k = Math.max(1, Math.abs(d.texture?.scaleX ?? 1), Math.abs(d.texture?.scaleY ?? 1));
  const cx = x0 + w / 2, cy = y0 + h / 2;
  return { x: cx, y: cy, l: cx - w / 2 * k, t: cy - h / 2 * k, r: cx + w / 2 * k, b: cy + h / 2 * k };
}
const grow = (b, p) => ({ ...b, l: b.l - p, t: b.t - p, r: b.r + p, b: b.b + p });
export function noteBox(n, gs = 100) {
  const d = docOf(n) ?? n, s = Number(d.iconSize) > 0 ? Number(d.iconSize) : 40;
  const q = { l: d.x - s * 0.6, t: d.y - s * 0.6, r: d.x + s * 0.6, b: d.y + s * 1.1 };   // the icon and its label under it
  /* a moinen-maps pin stands on the note's point and rises about 1.1 grid squares above it, 0.8 square wide (live, The Warehouse,
     350 px grid: the head and stem about 275 x 375 px; its container, 457 x 497 px, also holds the faint ground ripple, which a word
     may cross; the icon size said 40). Read from the document, not from the drawing: a seat that does not draw the pin must still
     lay the block out the same way. */
  if (d.flags?.['moinen-maps']?.pin) { q.l = Math.min(q.l, d.x - 0.42 * gs); q.r = Math.max(q.r, d.x + 0.42 * gs); q.t = Math.min(q.t, d.y - 1.15 * gs); q.b = Math.max(q.b, d.y + 0.1 * gs); }
  return q;
}
const sameTok = (a, b) => !!a && !!b && (a === b || (a.id != null && a.id === b.id));
/* the shared frame of a map moment (scene px) */
export function sharedFrame(hero) {
  const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100;
  const token = docBox(hero, gs);
  const sr = C?.dimensions?.sceneRect;
  const ins = 0.1 * gs;
  const safe = sr ? { l: sr.x + ins, t: sr.y + ins, r: sr.x + sr.width - ins, b: sr.y + sr.height - ins }
    : { l: token.x - 40 * gs, t: token.y - 40 * gs, r: token.x + 40 * gs, b: token.y + 40 * gs };
  const avoid = [];
  for (const t of C?.tokens?.placeables ?? []) {
    const d = docOf(t);
    if (!d || sameTok(t, hero) || d.hidden) continue;   // a hidden token is not on every seat's board: it never moves the block
    avoid.push(grow(docBox(t, gs), 0.06 * gs));
  }
  for (const n of C?.notes?.placeables ?? []) { try { if (docOf(n)) avoid.push(noteBox(n, gs)); } catch (e) { /* a pin without a place */ } }
  const vh = GRID_VH * gs;
  return { vh, freeW: vh * 16 / 9, safe, token, avoid, gap: Math.round(0.12 * gs), focus: { x: token.x, y: token.y } };
}
/* the bars and panels that are not at an edge: the party cards, the map's VRAM meter and pins panel, the GM's desk, the tactics dock */
export const UI_AVOID = ['#invincible-party li', '.mm-vram', '#mm-filter', '#invincible-tactics-desk:not(.igd-collapsed) .igd', '#ich-dock'];
function uiAvoid() {
  const out = [];
  for (const sel of UI_AVOID) {
    try {
      for (const e of document.querySelectorAll(sel)) {
        const q = e.getBoundingClientRect();
        if (q && q.width > 0 && q.height > 0) out.push({ l: q.left - 6, t: q.top - 6, r: q.right + 6, b: q.bottom + 6, w: UI_WEIGHT });
      }
    } catch (e) { /* a selector this Foundry does not know */ }
  }
  return out;
}
/* FXI-SPLASH (ADVI 11: the critical's word over the VRAM panel): a panel weighs as much as a bar would: the block shrinks (to 0.4) before
   it lies on a panel; it gives way only where nothing at all is free */
export const UI_WEIGHT = 20;
/* Dice So Nice's dice still lying on the table (client px): the screen layer draws over them, so the block keeps off them (ADVD2 3:
   the die inside the M of BAM!). Read from its dice box (each die's position projected by its camera); nothing while it is hidden. */
export const DIE_R = 0.06;   // a resting die's half-size as a share of the dice canvas height
export function diceRects() {
  try {
    if (diceZ() <= 0) return [];
    const box = globalThis.game?.dice3d?.box, cam = box?.camera, cv = document.getElementById(DICE_CANVAS);
    if (!box || !cam || !cv) return [];
    const r = cv.getBoundingClientRect(), list = box.diceList;
    const arr = Array.isArray(list) ? list : (list?.values ? [...list.values()] : []);
    const R = DIE_R * (r.height || window.innerHeight), out = [];
    for (const m of arr) {
      try {
        const p = m?.position?.clone?.();
        if (!p?.project) continue;
        m.getWorldPosition?.(p);
        p.project(cam);
        if (!(Math.abs(p.x) <= 1.2 && Math.abs(p.y) <= 1.2)) continue;
        const x = r.left + (p.x + 1) / 2 * r.width, y = r.top + (1 - p.y) / 2 * r.height;
        out.push({ l: x - R, t: y - R, r: x + R, b: y + R });
      } catch (e) { /* one die */ }
    }
    return out;
  } catch (e) { return []; }
}
/* SAMEPIC (owner, binding: the GM and the players see the SAME moment; ADVX 1: with one view at one instant the block stood right of the
   heroes on the GM's seat and lower-left on the player's, at another size). The screen block is laid out from what every seat shares
   (same-picture.mjs): the token's DOCUMENT box (not its animated mesh, which tips and sways per seat), the tokens nobody hides and the map
   pins as documents (not what this seat's vision or permissions draw: a GM saw the hidden ones and avoided them), the reference height
   SP.REF_VH (not this window's), the standard view (Foundry's bars reserved alike, the sidebar as if open). Not avoided any more by the
   shared layout: this seat's resting dice (they rest at another time on each seat) and its own panels (the GM's desk): on the screen
   layer the words are drawn over both; on the layers under the interface this seat's own guard (localScreen) moves the block only where it
   would really be hidden. */
const projBox = (b) => { const a = toClient({ x: b.l, y: b.t }), c = toClient({ x: b.r, y: b.b }); return a && c ? { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, l: a.x, t: a.y, r: c.x, b: c.y } : null; };
function sharedTokenBox(tok) { try { const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100; return projBox(docBox(tok, gs)); } catch (e) { return null; } }
export function standardSafe(p = null) { return SP.standardRect(window.innerWidth, window.innerHeight, p); }   // p: the client point the moment describes
function sharedScreenAvoid(hero, full) {
  const out = [];
  const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100;
  for (const t of C?.tokens?.placeables ?? []) {
    try { const d = docOf(t); if (!d || d.hidden || sameTok(t, hero)) continue; const q = projBox(grow(docBox(t, gs), 0.06 * gs)); if (q) out.push(q); } catch (e) { /* one token */ }
  }
  for (const n of C?.notes?.placeables ?? []) { try { if (!docOf(n)) continue; const q = projBox(noteBox(n, gs)); if (q) out.push(q); } catch (e) { /* one pin */ } }
  for (const z of SP.panelZones(window.innerWidth, window.innerHeight)) out.push({ ...z, w: UI_WEIGHT });   // the party panel's corner, the same zone on every seat
  if (full && hero) { const h = sharedTokenBox(hero); if (h) out.push({ ...grow(h, Math.max(10, 0.15 * (h.r - h.l))), w: 50 }); }   // the drawn art (hair, a fist) reaches past the token's box; the hero weighs most
  return out;
}
/* this seat's own limits (tier 3): screen = over everything, cut only by the window and the open sidebar (the layer's clip); ui = under
   the windows (the GM's desk is one); hud = under the bars, the panels and the resting dice */
export const UI_WINDOWS = ['#invincible-tactics-desk:not(.igd-collapsed) .igd'];
function boxesOf(sels, pad = 6) {
  const out = [];
  for (const sel of sels) { try { for (const e of document.querySelectorAll(sel)) { const q = e.getBoundingClientRect(); if (q && q.width > 0 && q.height > 0) out.push({ l: q.left - pad, t: q.top - pad, r: q.right + pad, b: q.bottom + pad }); } } catch (e) { /* none */ } }
  return out;
}
/* this seat's band: its window minus the SAME reserve every seat keeps and minus its own core bars where those are wider (client px) */
function seatBand() {
  measureArea();
  const vw = window.innerWidth, vh = window.innerHeight, win = { l: 2, t: 2, r: area.w - 2, b: vh - 2 };
  const band = { l: Math.max(win.l, SP.RESERVE.l), t: Math.max(win.t, SP.RESERVE.t), r: Math.min(win.r, vw - SP.RESERVE.r), b: Math.min(win.b, vh - SP.RESERVE.b) };
  if (band.r - band.l < 0.4 * vw || band.b - band.t < 0.4 * vh) Object.assign(band, win);   // a tiny window: the whole of it
  const core = safeRect({ core: true }), m = meet(band, core);
  if (m.r - m.l >= 0.4 * vw && m.b - m.t >= 0.4 * vh) Object.assign(band, m);
  return band;
}
/* what of THIS seat's interface hides a block drawn under it, where it really stands (not as a full-width bar: live the GM's scene rows
   reach 176 px down a 170 px wide column, the player's 96, and the full-width reading moved the GM's map block 107 scene px lower):
   the scene bar's rows, the director pill, a chat card popped up, the floating panels */
/* for the log: what of this seat's limits the shared block touched (its band's edges, its own panels), rounded */
function whyMoved(r, loc) {
  if (!r || !loc) return null;
  const o = [], R = (q) => [Math.round(q.l), Math.round(q.t), Math.round(q.r), Math.round(q.b)];
  if (loc.safe && (r.l < loc.safe.l || r.t < loc.safe.t || r.r > loc.safe.r || r.b > loc.safe.b)) o.push(['edge', R(loc.safe)]);
  for (const q of loc.avoid ?? []) if (r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t) o.push(['panel', R(q)]);
  return o;
}
function seatOwn() { return [...uiAvoid(), ...boxesOf([...UI_TOP, '#mm-dir-bar', ...UI_RIGHT])]; }
function localScreen() {
  measureArea();
  /* over the interface (screen) and under the windows only (ui): this seat's window minus the SAME reserve band every seat keeps (Foundry's
     bars) and minus its open sidebar where that is wider. Not this seat's own panels, pop-up cards or the GM's director pill: the moment is
     drawn over them for its few seconds (provisional SAMEPIC-3; checked: avoiding them, the party cards that stand at a height that
     follows each window moved every seat's block differently). Under the windows also the GM's desk (a window would hide the block).
     Under the bars (hud) the block would be HIDDEN by anything of this seat: its real bars, panels and resting dice */
  const vw = window.innerWidth, vh = window.innerHeight, band = seatBand();
  /* a window smaller than the reference keeps the party corner where it really is on this window (it is moving the block anyway) */
  const small = vw < SP.REF_VW || vh < SP.REF_VH ? SP.panelZones(vw, vh, true).filter((z) => z.at === 'bl') : [];   // the party cards (over the scene list it is drawn on the screen layers)
  if (LAYER === 'screen') return { safe: band, avoid: small };
  if (LAYER === 'ui') return { safe: band, avoid: [...small, ...boxesOf(UI_WINDOWS)] };
  return { safe: band, avoid: [...seatOwn(), ...boxesOf(UI_WINDOWS), ...diceRects()] };
}
const meet = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
/* the last moments' layouts on this seat (for the checks and the live log): shared, or moved here and how */
const SAME_LOG = [];
export const sameLog = () => SAME_LOG.slice();
function logSame(row) { SAME_LOG.push(row); if (SAME_LOG.length > 20) SAME_LOG.shift(); }
/* compose: measure, lay out, and (when the block had to go below or beside the token) measure again with the sound coming from there */
function compose(ctl, items, extra = {}) {
  const vh = window.innerHeight, k = Number(LE?.prefs?.scale) > 0 ? Number(LE.prefs.scale) : 1;
  let frame;
  if (ctl.shared) {
    /* a critical on the map is a board moment like the others (live: sized to fill a share of a 16:9 'screen' of the board, it went
       two tokens away and past every seat's view): still the biggest word, but anchored by the hero */
    for (const it of items) if (it.wMin) { it.wMin = 0; it.cap = Math.min(it.cap, LP.MAP_CRIT_CAP); it.wMax = Math.min(it.wMax ?? 0.6, 0.58); }
    /* the map: scene units, nothing of this seat (the engine's Scale is divided out again in letterOne: the drawn size is S) */
    const g = extra.gauge && ctl.gaugeK ? { w: extra.gauge.w * ctl.gaugeK, h: extra.gauge.h * ctl.gaugeK } : extra.gauge;
    frame = { ...sharedFrame(ctl.hero), scale: 1, ...extra, ...(g ? { gauge: g } : {}) };
  } else {
    /* SAMEPIC: the shared frame (see sharedScreenAvoid): reference height, the table's Scale only (the engine's own Scale is divided out
       in letterOne, as on the map), the standard view, the token's document box, shared obstacles */
    const T = ctl.token ? sharedTokenBox(ctl.token) : null, std = standardSafe(T);
    frame = { vh: SP.REF_VH, scale: ctl.userScale || 1, safe: std, token: T, avoid: sharedScreenAvoid(ctl.hero, !ctl.token),
      gap: T ? Math.max(8, Math.round(0.08 * (T.r - T.l))) : 6, focus: { x: (std.l + std.r) / 2, y: vh * (ctl.full ? 0.47 : 0.42) }, ...extra };
  }
  let out = composeIn(ctl, items, frame), same = 'none', why = null;
  if (ctl.shared) {
    /* FXI-SPLASH (ADVI 6) + SAMEPIC: the map block is laid out from what every seat shares; when it would lie past the STANDARD view while
       its token is in view, it is laid out again inside that view (the same on every seat with this view: before, each seat used its own
       measured bars, and the GM's scene bar moved his block 80 scene px down from the player's: ADVX 1, take D) */
    const hc = ctl.hero ? sharedTokenBox(ctl.hero) : null, std = sceneRectOf(standardSafe(hc)), T = frame.token;
    const tokIn = (v) => !!v && !!T && T.r > v.l && T.l < v.r && T.b > v.t && T.t < v.b;
    if (tokIn(std) && !inRect(out.rect, std)) {
      const q = meet(frame.safe, std);
      if (q.r - q.l >= 0.25 * frame.vh && q.b - q.t >= 0.25 * frame.vh) { const f2 = { ...frame, safe: q }; out = composeIn(ctl, items, f2); out.seat = true; frame = f2; }
    }
    /* tier 3: this seat's own bars (beyond the reserve) and panels hide the board under them: only then does this seat move its block */
    const real = sceneRectOf(seatBand());   // the band (on a map layer its core part also keeps inside the scene rectangle)
    if (tokIn(real)) {
      const loc = { safe: real, avoid: [...seatOwn(), ...boxesOf(UI_WINDOWS)].map(sceneRectOf).filter(Boolean) };
      why = whyMoved(out.rect, loc);
      const fx = LP.localFix(out, frame, loc, std, () => { const q = meet(frame.safe, real); return q.r - q.l >= 0.25 * frame.vh && q.b - q.t >= 0.25 * frame.vh ? composeIn(ctl, items, { ...frame, safe: q, avoid: [...frame.avoid, ...loc.avoid] }) : null; });
      out = fx.out; same = fx.moved;
    }
  } else {
    const loc = localScreen(), std = frame.safe;
    why = whyMoved(out.rect, loc);
    const fx = LP.localFix(out, frame, loc, std, () => composeIn(ctl, items, { ...frame, safe: meet(std, loc.safe), avoid: [...frame.avoid, ...loc.avoid] }));
    out = fx.out; same = fx.moved;
  }
  out.k = k; out.frame = frame; out.same = same;
  logSame({ id: ctl.momentId ?? ctl.seed, layer: LAYER, shared: !!ctl.shared, moved: same, ...(same !== 'none' && why ? { why } : {}), tok: frame.token ? [Math.round(frame.token.l), Math.round(frame.token.t)] : null, rect: out.rect ? { l: Math.round(out.rect.l), t: Math.round(out.rect.t), r: Math.round(out.rect.r), b: Math.round(out.rect.b) } : null });
  return out;
}
function composeIn(ctl, items, frame) {
  const anchored = !!frame.token;
  let side = 'above', out = null;
  for (let pass = 0; pass < 2; pass++) {
    measureItems(items, { seed: ctl.seed, from: anchored ? SIDE_FROM[side] : null });
    out = LP.composeMoment(items, frame, measureFn);
    if (!anchored || out.side === side) break;
    side = out.side;
  }
  return out;
}
const inRect = (r, q) => r.l >= q.l - 1 && r.t >= q.t - 1 && r.r <= q.r + 1 && r.b <= q.b + 1;
/* a client rect in scene px (null when the canvas cannot say) */
function sceneRectOf(s) {
  try {
    const a = toScene({ x: s.l, y: s.t }), c = toScene({ x: s.r, y: s.b });
    return a && c && c.x > a.x && c.y > a.y ? { l: a.x, t: a.y, r: c.x, b: c.y } : null;
  } catch (e) { return null; }
}

function letterWrap(ctl) {
  if (ctl.lw?.isConnected) return ctl.lw;
  const w = document.createElement('div'); w.className = 'ins-letters';
  w.style.setProperty('--u', String(Math.max(0.7, Math.min(1.6, SP.REF_VH / 768)).toFixed(3)));   // SAMEPIC: the reference height, not this window's
  ensureLayer().appendChild(w);
  ctl.lw = w; ctl.letters = []; ctl.hands = [];
  ctl.el.classList.add('lettered');
  return w;
}
/* one placed lettering (composeMoment item) -> L.play; seed = message id + role, so every client letters it alike */
function letterOne(ctl, it) {
  if (!LE || ctl.dead) return null;
  const lw = letterWrap(ctl);
  const o = { ...(it._o ?? engineOpts(it, { seed: ctl.seed }, ctl.hands)) };
  o.avoid = [...new Set([...(o.avoid ?? []), ...ctl.hands])];   // the hands measured first are the real ones; the played ones join (a set: same choice)
  const sizeK = it._m?.sizeK || 1, k = ctl.k || 1;
  Object.assign(o, { space: 'screen', parent: lw, at: { x: it.x, y: it.y }, fit: 'exact', size: Math.round((it.S / (sizeK * k)) * 100) / 100,
    maxWidth: Math.ceil(it.w * 1.06) });
  /* the engine's own screen layers (under the windows): its layer, not our wrapper */
  if (LAYER === 'ui' || LAYER === 'hud') { delete o.parent; o.layer = LAYER; }
  /* on the map: the shared block, already in scene coordinates and scene px (FXLD2: the same on every seat; it zooms as one, ADVD 7) */
  let world = false;
  if (ctl.shared && it.sceneAt) {
    Object.assign(o, { space: 'world', layer: mapLayerFor(it.role), at: { ...it.sceneAt }, out: LP.mapExit(o), size: it.S / (sizeK * k), keepInView: false });   // unrounded: the drawn size is exactly S on every seat, whatever its engine Scale; keepInView off (engine 1.7.0 pulls a world word into each seat's own view: live, the block slid onto the neighbours)
    if (ctl.hero) o.token = ctl.hero;
    delete o.parent;
    world = true;
  }
  /* FXI-SPLASH (ADVI 2): every lettering starts on a known instant a little ahead (its first picture is painted meanwhile), so the impact
     frame can be put on the very tick the word hits. The impact is asked for FIRST: it owns the flash budget of that instant and the
     word's own flash frame gives way to it (one accent, the impact's guard). */
  o.startAt = performance.now() + LEAD_MS;
  /* ALIGN (engine 1.9.1 recipe, owner: one accent): the result word that gets the roll's impact does not flash on its own (`flash: false`);
     the impact is its accent, landing on its contact. Every seat decides it from the event alone, so the word's contact is one rule. Before,
     the impact was asked for first so that it took the flash budget from the word: that worked only while the impact had two flashes */
  const struck = it.role === 'word' && !!ctl.impactPlan && !ctl.impact && !!LE?.impact?.play;
  let shot = null;
  if (struck) {
    o.flash = false;
    let contact = it._m?.contact ?? 0;
    try { const r = LE.planFor ? LE.planFor(LP.letterable(it.text), o) : null; if (r?.plan) contact = IP.contactMs(r.plan); } catch (e) { /* the measured one */ }
    /* SPLASHPL: a seat that shows the word in its own language strikes on the instant of the shared English word, so every seat sees
       the blow (and the token reactions wait) on one instant: the shown word starts earlier or later by the difference of the two contacts
       (0 in the invincible look, whose contact does not depend on the text; a legacy look's can) */
    let lead = 0;
    if (it.en && it.en !== it.text) try { const r = LE.planFor ? LE.planFor(LP.letterable(it.en), o) : null; if (r?.plan) lead = IP.contactMs(r.plan) - contact; } catch (e) { lead = 0; }
    shot = impactShot(ctl, it, contact + lead);
    o.startAt += lead;
    if (shot?.shift > 0) o.startAt += shot.shift;
    ctl.wordAt = o.startAt; ctl.contactAt = o.startAt + contact;
  }
  let h = null;
  try {
    h = LE.play(LP.letterable(it.text), o);
    ctl.letters.push({ h, base: { ...o.at }, role: it.role, world, own: !!o.parent });
    if (h?.hand) ctl.hands.push(h.hand);
  } catch (e) { console.warn('invincible-plus-ultra (splash) | lettering failed', e); h = null; }
  /* ALIGN: the impact after its word, on the word's contact as the ENGINE reads it (L.contactAt: on the 24 Hz grid in stepped motion) */
  if (shot) {
    try { const c = h && LE.contactAt ? LE.contactAt(h) : null; if (Number.isFinite(c)) ctl.contactAt = c; } catch (e) { /* the planned one */ }
    fireImpact(ctl, shot, ctl.contactAt, h);
  }
  if (it.role === 'word' && ctl.bdLater) enterBackdrop(ctl, shot);
  /* FIN-CALLERS (FXIT-S1, ADVI 8): the result word strikes now: the token reactions wait until it and its impact are over */
  if (it.role === 'word') {
    const at = ctl.contactAt ?? o.startAt;
    tellLand(ctl, at, ctl.impactEnd ? Math.max(0, ctl.impactEnd - at) : 0);
  }
  return h;
}
/* FXLD2 (ADVD2 12, the caller's part): the layers in the scene's light (ground, tokens, weather) tint the letters with the room's
   light and draw rain over them (live: salmon numbers under a red alarm). The sound word keeps the chosen layer (that is what the
   setting asks for); the numbers and the caption are read, so on those layers they go over the lighting and the weather (overlay). */
export const LIT_LAYERS = ['ground', 'tokens', 'weather'];
const INFO = new Set(['six', 'say', 'odds', 'stress']);
export function mapLayerFor(role) { return LIT_LAYERS.includes(LAYER) && INFO.has(role) ? 'overlay' : LAYER; }
function stopLetters(ctl, quick) {
  for (const it of ctl.letters || []) { try { it.h.stop({ quick }); } catch (e) { /* already gone */ } }
  const lw = ctl.lw;
  if (lw) setTimeout(() => lw.remove(), quick ? 0 : 900);
}
/* FXLD (ADVD 12): the shake of a strong hit reaches the words on every layer: each word is moved through the engine (moveTo, the
   contract) in a stepped, decaying jolt (one picture per 42 ms, like the engine's own stepped clock), and the gauge with them */
const SHAKE = [[-1, 0.5], [1, -0.6], [-0.7, -0.2], [0.6, 0.4], [-0.35, 0.15], [0.2, -0.1], [0, 0]];
export function shakeLetters(ctl, px) {
  if (['reduced', 'gentle'].includes(LE?.prefs?.motion)) return;   // the engine's own Motion setting asks for calm too
  px = Math.min(px, 12);
  const z = onMap() ? (canvas.stage.scale.x || 1) : 1;
  SHAKE.forEach(([sx, sy], i) => ctl.later(() => {
    for (const it of ctl.letters || []) {
      if (!it.h?.alive || !it.base) continue;
      const k = it.world ? 1 / z : 1, off = ctl.offset ?? { x: 0, y: 0 };
      try { it.h.moveTo({ x: it.base.x + (off.x + sx * px) * k, y: it.base.y + (off.y + sy * px) * k }); } catch (e) { /* the engine dropped it */ }
    }
    if (ctl.gaugeEl && !ctl.shared) ctl.gaugeEl.style.translate = `${Math.round(sx * px)}px ${Math.round(sy * px)}px`;   // on the map the gauge is pinned to the board
  }, i * 42));
}
/* the block follows its token (screen layers) or the scene (map layers: the words pan by themselves, the HTML parts follow) */
function followPan(ctl) {
  if (ctl.dead) return;
  if (ctl.shared) {
    /* FXLD2: each HTML part is pinned to its own scene point (the gauge also scales with the zoom, as the words do) */
    const z = globalThis.canvas?.stage?.scale?.x || 1;
    for (const p of ctl.pins || []) {
      const c = toClient(p.at);
      if (!c) continue;
      p.el.style.translate = `${Math.round(c.x - p.c0.x)}px ${Math.round(c.y - p.c0.y)}px`;
      if (p.k) p.el.style.scale = (p.k * z).toFixed(3);
    }
    return;
  }
  if (!ctl.token || !ctl.tokenAnchor) return;
  const tb = sharedTokenBox(ctl.token);   // SAMEPIC: the document box (the mesh sways per seat)
  if (!tb) return;
  ctl.offset = { x: Math.round(tb.x - ctl.tokenAnchor.x), y: Math.round(tb.y - ctl.tokenAnchor.y) };
  for (const it of ctl.letters || []) { try { if (it.h.alive && !it.world) it.h.moveTo({ x: it.base.x + ctl.offset.x, y: it.base.y + ctl.offset.y }); } catch (e) { /* gone */ } }
  if (ctl.gaugeEl) ctl.gaugeEl.style.translate = `${ctl.offset.x}px ${ctl.offset.y}px`;
}
/* FXLD (ADVD 9): Dice So Nice raises its dice canvas over the windows (its "auto" mode climbs with the windows' z-index), so the dice
   still lying on the table covered the lettering for 1-2 s: our layer goes just over the dice canvas (never over tooltips) */
const DICE_CANVAS = 'dice-box-canvas';
/* Dice So Nice (live, lane 20): its canvas sits in <body> at z 0, raised to ApplicationV2._maxZ + 1 (101) while dice are shown, or
   1000 with its "over" option, and fades out about 2 s after they stop. The screen layer (5000) is above either; the ui layer (80,
   under the windows) is not, so for a moment with dice up it goes one over them; a map layer is the board itself, under any HTML,
   so a lettered map moment waits for the dice to go (diceClear, main.mjs). ADVD 9: the dice drew over the words for 1-2 s. */
export function diceZ() {
  try {
    const c = document.getElementById(DICE_CANVAS);
    if (!c) return 0;
    const cs = getComputedStyle(c);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity ?? '1') < 0.1) return 0;
    const z = parseInt(cs.zIndex, 10);
    return Number.isFinite(z) ? z : 0;
  } catch (e) { return 0; }
}
export function overDice() {
  try {
    const lay = ensureLayer();
    const z = diceZ();
    if (LAYER === 'screen') lay.style.zIndex = z >= 5000 ? String(Math.min(9990, z + 1)) : '';
    else if (LAYER === 'ui') lay.style.zIndex = z >= 80 ? String(Math.min(9990, z + 1)) : '';
    else lay.style.zIndex = '';
  } catch (e) { /* no dice, no change */ }
}
/* a lettered moment on a map layer: wait (at most maxMs) until the dice are gone; resolves with the ms waited.
   FXLD2 (ADVD2 5): Dice So Nice keeps the dice up for its "time before hide" (2 s by default) and then fades them for 1 s, so the map
   moment came about 4 s after the result (the screen layer: ~0.5 s). The dice have done their job when they rest (the result is read
   in the chat card and lettered by the moment), so on a map layer this seat asks Dice So Nice to fade them now, with its own fade
   (DICE_FADE ms; the persistent dice stay), and the moment starts as they go. */
export const DICE_FADE = 320;
export function hurryDice() {
  try {
    const d = globalThis.game?.dice3d;
    if (!d) return false;
    if (d.box?.persistentDiceList?.length && typeof d.box.fadeOutEphemeral === 'function') { d.box.fadeOutEphemeral(DICE_FADE); return true; }
    if (typeof d._fadeOutCanvas === 'function') { d._fadeOutCanvas(DICE_FADE, () => { try { d.box?.clearAll?.(); } catch (e) { /* gone already */ } }); return true; }
  } catch (e) { /* its own timer hides them */ }
  return false;
}
export const onMapLayer = () => onMap();
export function diceClear(maxMs = 2600) {
  if (!lettersOn() || !onMap() || diceZ() <= 0) return Promise.resolve(0);
  hurryDice();
  let w = 0;
  return new Promise((res) => {
    const tick = () => { w += 100; if (diceZ() <= 0 || w >= maxMs) res(w); else setTimeout(tick, 100); };
    setTimeout(tick, 100);
  });
}

function playLetters(ev, o) {
  const full = o.fullFrom != null && !ev.fail && ev.power != null && ev.power >= o.fullFrom;
  /* FXLD2: on a map layer the moment needs a token everybody sees (o.token = the board's token, main.mjs mapToken); without one it
     has no place on the board and plays on the screen, by each seat's view */
  /* FXI-SPLASH (ADVI 10): and only a token THIS seat sees: an unseen roller's moment plays on this seat's screen, placed by nothing of it */
  if (o.token && !seesToken(o.token)) o = { ...o, token: null };
  const shared = onMap() && !!o.token;
  const ctl = openStage(full ? { ...o, full: true } : o, shared);
  const stage = ctl.el, later = ctl.later, holdK = o.hold || 1;
  /* a moment needs a seed even when no message gives one (the preview): an unseeded word draws a new random hand at every call, so
     the hand measured for the layout was not the hand played (live: the critical's 4 SIXES stood 170 px off a narrower word) */
  ctl.seed = o.seed ?? `local-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`; ctl.full = full;
  letterWrap(ctl);
  overDice();
  const dF = LP.failStrength(ev);
  /* WIRE1: the impact frame of this result (impact-plan.mjs; null = none). Planned from the event alone, so every seat agrees */
  ctl.impactPlan = LE?.impact?.play ? IP.impactFor(ev, { fx: o.fx }) : null;
  ctl.targets = IP.cleanTargets(o.targets); ctl.from = o.from ?? null;   // ROLLTARGET: where the impact lands, where the blow comes from
  const plan = LP.planMoment(ev, { token: !!ctl.token, full, holdK, npc: !!ev.npc, dF, reduced: S.isReduced() });
  const word = plan.items.find(it => it.role === 'word');
  const t0 = word?.delay ?? 0;
  /* the owner (2026-11-13): backdrops are an extra, default without; the full wash and rays only with the client setting Backdrop.
     CRITFIX: our layer is above the engine's impact overlay (the words must stay on top of it), so a wash already up covered the impact
     frame (the black-and-white slam turned lavender, the clear spot glowed white over it, the struck silhouette was lost). With an impact
     planned for the result word the backdrop now ENTERS AFTER the impact (enterBackdrop, from letterOne): the blow reads exactly as with
     the backdrop off, the wash and rays are its aftermath. Without an impact it is up from the start, as before. */
  if (full && o.backdrop) {
    const bdK = o.fullFrom >= 1 ? 1 : (ev.power - o.fullFrom) / (1 - o.fullFrom);
    if (ctl.impactPlan && word) ctl.bdLater = () => addBackdrop(ctl, ev.power, bdK, o.fx);
    else addBackdrop(ctl, ev.power, bdK, o.fx);
  }
  if (!word) later(() => tellLand(ctl, performance.now(), 0), 0);   // FIN-CALLERS: a moment without a result word has struck once it shows
  /* the stress row and its gauge belong to the block (measured once, shown at its time) */
  const resolve = ev.stress ? (o.resolve ? o.resolve() : null) : null;
  let gauge = null;
  if (ev.stress) {
    /* it leaves with the word and its gauge (live: STRESS +1 stood alone half a second after the moment had gone) */
    const st = LP.planStress(ev.stress, { holdK, reduced: S.isReduced() });
    if (word) st.hold = Math.max(900, Math.min(st.hold, word.delay + word.hold - (t0 + 560)));
    plan.items.push({ ...st, delay: t0 + 560 });
    gauge = probeGauge(ctl, ev.stress, resolve);
  }
  const lay = compose(ctl, plan.items, gauge ? { gauge } : {});
  ctl.k = lay.k; ctl.rect = lay.rect; ctl.layout = lay;   // (kept for inspection: frame, side, hit)
  ctl.tokenAnchor = ctl.token ? sharedTokenBox(ctl.token) : null;
  const wp = lay.items.find(it => it.role === 'word');
  if (ctl.shared) {
    /* the block is in scene coordinates already (the same on every seat); a part lettered later keeps its scene place whatever the
       camera did meanwhile (live, 1366: the sentence of a map moment landed on the token when the view panned) */
    for (const it of lay.items) it.sceneAt = { x: it.x, y: it.y };
    const c = wp ? toClient({ x: wp.x, y: wp.y }) : null;
    if (c) { stage.style.left = c.x + 'px'; stage.style.top = c.y + 'px'; pin(ctl, stage, { x: wp.x, y: wp.y }, c); }
    for (const x of ctl.extras.filter(e => e.classList?.contains('ins-fullrays'))) pin(ctl, x, { x: wp?.x ?? 0, y: wp?.y ?? 0 }, c ?? { x: 0, y: 0 });
    ctl.rayPin = { at: { x: wp?.x ?? 0, y: wp?.y ?? 0 }, c: c ?? { x: 0, y: 0 } };   // CRITFIX: rays that enter after the impact are pinned the same way
  } else if (wp) { stage.style.left = wp.x + 'px'; stage.style.top = (wp.y + 0.04 * stage.clientWidth) + 'px'; }   // the rays, the flash and the sparks centre on the word
  let first = true;
  for (const it of lay.items) {
    later(() => {
      if (it.role === 'stress') stressGauge(ctl, ev.stress, resolve, lay.gauge);
      const h = letterOne(ctl, it);
      /* FXLD (ADVD 14): the engine switched off under us (its master switch) -> the classic splash instead of rays with no word */
      if (first && h && (h.off === true || (h.alive === false && LE?.prefs?.enabled === false))) { ctl.momentId = null; ctl.landed = false; endCtl(ctl, true); playClassic(ev, o); first = false; return; }   // the classic splash tells the story from here
      first = false;
    }, it.delay);
  }
  /* the old splash's surroundings stay: rays, the soft flash, the shake and the sparks of a strong result; the shake of a rare miss */
  /* WIRE1 (the owner: no flash or shake of our own on top of an impact frame): a result with an impact frame keeps only the sparks */
  if (!ev.fail && o.fx) later(() => { accentFx(stage, ev.tag ? Math.max(ev.power, 0.32) : ev.power, later, o, full, !!ctl.impactPlan); if (!S.isReduced() && ev.power > 0.45 && !ctl.impactPlan) shakeLetters(ctl, Math.round(4 + 8 * ev.power)); }, t0 + 60);
  if (ev.fail && !ev.softFail && dF > 0.3 && o.fx && !S.isReduced()) later(() => shakeLetters(ctl, 4 + Math.round(6 * dF)), t0 + 380);
  const wordEnd = word ? word.delay + word.hold : plan.end;
  if (full) later(() => fadeExtrasEarly(ctl), wordEnd + 300);
  const badgesEnd = ev.stress ? t0 + 450 + Math.round(2600 * holdK) + 200 : 0;
  later(() => { if (ctl.gaugeEl) S.leaveSlide(ctl.gaugeEl); }, Math.max(wordEnd, badgesEnd - 200));
  later(() => endCtl(ctl, false), Math.max(plan.end, badgesEnd) + 800);
  return ctl;
}
/* the owner (2026-11-13, «tła strasznie zasłaniają ekran i to co się dzieje»): by default the moment draws nothing behind the words
   (no rays, no wash, no flash over the view): the letters read by their own outline and depth. Kept: the sparks of a strong result
   (small, local) and, for the critical, one short flash (about four frames) as the impact accent. Backdrop on = the old surroundings.
   WIRE1: with the engine's impact frames (L.impact) the critical's accent IS the impact frame (fireImpact): the short flash stays only
   for an engine without them; the backdrop's own flash and rays are skipped under an impact frame too (one accent, the impact's guard). */
export const ACCENT_MS = 170;
function accentFx(stage, P, later, o, full, impact = false) {
  if (o.backdrop && !impact) return S.fxFor(stage, P, later, o.fx, full);
  if (S.isReduced() || !(o.fx > 0)) return;
  if (full && o.fx >= 1 && !impact) S.flash(stage, 0.45, ACCENT_MS);
  if (P > 0.55 && o.fx >= 1) {
    const waves = Math.min(2, 1 + Math.floor((P - 0.55) * 4)), h = hueOf(P);
    for (let i = 0; i < waves; i++) later(() => S.particles(stage, 10 + Math.round(8 * P), h), i * 170);
  }
}
/* WIRE1 + FXI-SPLASH (ADVI 2, 6, 7, 10): the impact frame of a result, ON the tick its word hits.
   WHEN: the word's contact (IP.contactMs from the engine's plan of that very word; once it plays, L.contactAt) is the impact's `blowAt`
   (ALIGN, engine 1.9.1: the engine starts the impact plan.peakMs earlier), so the impact's peak drawing and the word's hit are one instant;
   when the word hits sooner than that lead-in takes, the word waits for it. Every seat starts the moment at the same server time (beat.mjs) with the same word, seed and plan, so the
   same drawings fall on the same instant.
   WHERE (ROLLTARGET, the owner: «cel»): on the roll's TARGET (IP.rollTargets / IP.targetChoice), the token itself as the subject (its
   picture is the silhouette) with the blow coming from the roller; never on the roller (ADVI 7). Only a target THIS seat sees and has in
   view is handed in (ADVI 10: nothing marks a token a seat cannot see); otherwise, and for a roll with no target, the result word (its box).
   On the screen layers the word stays on top of the impact (its layer is one under ours / under the engine's ui and hud layers); on a map
   layer the word is IN the scene under the impact, so only drawings that leave the word's spot clear play there (IP.MAP_FRAMES), and only
   when the word is in this seat's view (a frame at the view's edge for a word nobody here sees would mark nothing).
   Reduced motion is passed only as true (a false would override the OS switch); the photosensitivity guard is the engine's. */
export const LEAD_MS = 90;   // ms: a lettering starts this far ahead of its call (its first picture and the impact's drawings are painted meanwhile)
function wordInView(at) {
  const c = toClient(at);
  return !!c && c.x >= 0 && c.y >= 0 && c.x <= window.innerWidth && c.y <= window.innerHeight;
}
/* ALIGN: the impact of the result word, planned before the word plays (its spec, and how much later the word must start so that the impact's
   lead-in fits before the contact: the shift), then played once the word is up (fireImpact) */
/* ROLLTARGET: how a target token stands on THIS seat (IP.targetChoice's look): on this scene, not hidden by the GM, seen by this seat
   (seen.mjs: vision, walls, fog), its centre inside the seat's work area (not off the view, not under the open sidebar) */
export function targetLook(id) {
  try {
    const C = globalThis.canvas;
    const tok = C?.ready ? C.tokens?.get?.(id) : null;
    if (!tok || tok.destroyed || !tok.document || tok.document.hidden) return 'gone';
    if (!seesToken(tok)) return 'unseen';
    const p = toClient(tok.center);
    if (!p || p.x < 0 || p.y < 0 || p.x > Math.min(window.innerWidth, measureArea().w) || p.y > window.innerHeight) return 'off';
    return 'ok';
  } catch (e) { return 'gone'; }
}
/* ROLLTARGET: the last impacts' places on this seat (for the live checks and the debug log): { id, where: target|word|none, why, target } */
const IMPACT_LOG = [];
export const impactLog = () => IMPACT_LOG.slice();
function logImpact(row) { IMPACT_LOG.push({ at: Math.round(performance.now()), ...row }); if (IMPACT_LOG.length > 20) IMPACT_LOG.shift(); }
function impactShot(ctl, it, contact) {
  const I = LE?.impact, ip = ctl.impactPlan;
  if (!I?.play || !ip || ctl.impact) return null;
  try {
    const map = !!(ctl.shared && it.sceneAt);
    /* ROLLTARGET: the target when this seat may mark it, else the result word; a map word off this view marks nothing. The word still
       waits the same lead-in on every seat (shift below), so the instant is one whatever each seat can show (before, a seat whose map
       word was off its view started the word earlier than the others) */
    const pick = IP.targetChoice(ctl.targets, targetLook);
    const tok = pick.id ? globalThis.canvas.tokens.get(pick.id) : null;
    const fire = !!tok || !map || wordInView(it.sceneAt);
    const c = map ? it.sceneAt : { x: it.x, y: it.y };
    const w = Math.max(20, Number(it.w) || 0), hh = Math.max(20, Number(it.h) || 0);
    const spec = { kind: ip.kind, magnitude: ip.magnitude, seed: IP.impactSeed(ctl.seed), subject: tok ?? { x: c.x - w / 2, y: c.y - hh / 2, w, h: hh },
      over: LAYER === 'screen' ? 'ui' : 'scene' };
    /* the blow comes from the roller (only a token this seat sees: the engine checks it again) */
    if (tok && ctl.from && ctl.from !== tok && seesToken(ctl.from)) spec.from = ctl.from;
    if (map) { spec.space = 'world'; spec.frames = IP.mapFrames(ip.magnitude); }
    if (ip.tone) spec.tone = ip.tone;
    if (ip.hitstop === false) spec.hitstop = false;
    if (S.isReduced()) spec.reduced = true;
    /* ALIGN (engine 1.9.1): the lead-in before the impact's strongest drawing is the engine's own plan.peakMs (read from the full plan, the
       same on every seat whatever its reduced or guard setting); IP.leadMs (leading "lines" only) stays for an engine without it */
    let lead = 0;
    try { const p = I.plan?.({ ...spec, reduced: false }); lead = Number.isFinite(p?.peakMs) ? p.peakMs : IP.leadMs(p?.frames ?? spec.frames ?? []); } catch (e) { lead = 0; }
    return { spec, map, lead, shift: Math.max(0, lead - contact), contact, fire, where: tok ? 'target' : (fire ? 'word' : 'none'), why: pick.why, target: pick.id };
  } catch (e) { console.warn('invincible-plus-ultra (splash) | impact frame failed', e); return null; }
}
/* blowAt = the word's contact on this page's clock; word = its handle (kept readable on a map layer) */
function fireImpact(ctl, shot, blowAt, word) {
  const I = LE?.impact;
  if (!I?.play || !shot || ctl.impact) return null;
  logImpact({ id: ctl.momentId ?? ctl.seed, where: shot.where, why: shot.why, target: shot.target, blowAt: Math.round(blowAt) });
  if (!shot.fire) return null;
  try {
    const spec = { ...shot.spec, blowAt };
    /* ALIGN (engine 1.9.1 `keep`): on a map layer the word is IN the scene under the impact's overlay: it stays readable through every
       drawing (a hole cut round it, followed while it moves). The map's own frames (IP.MAP_FRAMES, drawings that leave its spot clear) stay
       too: keep is the second guard, not a licence for the full kinds there (ALIGN-1). On the screen layers the word is above the impact. */
    if (shot.map && word && word.alive !== false) spec.keep = word;
    ctl.impact = I.play(spec);
    const start = blowAt - shot.lead;
    ctl.impactPeak = blowAt;
    /* FIN-CALLERS (FXIT-S1): when the impact's last drawing is over (the token reactions wait for it) */
    let ms = 0;
    try { ms = Number(I.plan?.(spec)?.ms) || 0; } catch (e) { ms = 0; }
    if (ctl.impact && ctl.impact.alive !== false && ms > 0) ctl.impactEnd = start + ms;
    return ctl.impact;
  } catch (e) { console.warn('invincible-plus-ultra (splash) | impact frame failed', e); return null; }
}
/* ------------------------------------------------------------------ FIN-CALLERS (FXIT-S1, FXIT-S2; ADVI 8): one story, in order
   An attack roll and its hit tell one story: the roll's result word strikes (and its impact plays), THEN the target answers. The splash
   says where it is on MOMENT_HOOK, on this page's clock:
     { phase: "start", id }                      the roll's moment is coming (the card; said again right before it plays),
     { phase: "land", id, landAt, impactMs }     its result word strikes at landAt (performance.now), its impact lasts impactMs after it,
     { phase: "done", id }                       it is over or was dropped (said on every way out).
   The token reactions (tokenreact/main.mjs) wait for it (at least STORY_READ there: the roll's word is read before the target answers).
   They ask where the splash stands on REACT_HOOK ({ phase: "place", blocks: [] }: each landed moment adds its block, client px) and keep
   their words off it; they say each blow ({ phase: "hit", at, ids }) and a moment that has struck and COVERS a struck token (its block on
   the token's box, COVER_K of a token round it) makes room: its words leave ROOM_MS before the blow (seen live: a moment that only stood
   beside the target was ended 0.1 s after its word struck; now the target's word goes beside it instead). */
export const MOMENT_HOOK = 'invincible-plus-ultra.splashMoment', REACT_HOOK = 'invincible-plus-ultra.tokenReact';
export const ROOM_MS = 240, COVER_K = 0.1;
export function tellMoment(data) {
  try { globalThis.Hooks?.callAll?.(MOMENT_HOOK, data); } catch (e) { /* a listener's failure is not the splash's */ }
}
function tellLand(ctl, landAt, impactMs) {
  if (!ctl.momentId || ctl.landed) return;
  ctl.landed = true;
  tellMoment({ phase: 'land', id: ctl.momentId, landAt, impactMs: Math.round(Math.max(0, impactMs) || 0) });
}
function tellDone(ctl) {
  if (!ctl.momentId || ctl.told) return;
  ctl.told = true;
  tellMoment({ phase: 'done', id: ctl.momentId });
}
/* the block of a moment and a token's box, in the same units (scene px on the map, client px on the screen layers) */
function blockOf(ctl) {
  if (ctl.rect && Number.isFinite(ctl.rect.l)) {
    const o = !ctl.shared && ctl.offset ? ctl.offset : { x: 0, y: 0 };
    return { l: ctl.rect.l + o.x, t: ctl.rect.t + o.y, r: ctl.rect.r + o.x, b: ctl.rect.b + o.y };
  }
  try { const q = ctl.el?.getBoundingClientRect?.(); if (q && q.width > 0) return { l: q.left, t: q.top, r: q.right, b: q.bottom }; } catch (e) { /* none */ }
  return null;
}
function tokenAreaOf(ctl, tok) {
  if (ctl.shared) { const gs = globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100; return docBox(tok, gs); }
  return sharedTokenBox(tok);   // SAMEPIC
}
export function nearBlock(block, tb, k = COVER_K) {
  if (!block || !tb) return false;
  const p = k * Math.max(tb.r - tb.l, tb.b - tb.t);
  return block.l < tb.r + p && block.r > tb.l - p && block.t < tb.b + p && block.b > tb.t - p;
}
export function makeRoom(ids, at) {
  try {
    if (!Array.isArray(ids) || !ids.length) return 0;
    const toks = ids.map((id) => globalThis.canvas?.tokens?.get?.(id)).filter(Boolean);
    let n = 0;
    for (const ctl of [...active.values()]) {
      if (ctl.dead || !ctl.landed || ctl.roomFor) continue;   // a moment that has not struck yet keeps its story (it comes after the blow anyway)
      const block = blockOf(ctl);
      if (!toks.some((t) => nearBlock(block, tokenAreaOf(ctl, t)))) continue;
      ctl.roomFor = at;
      const ms = Math.max(0, (Number.isFinite(at) ? at : performance.now()) - ROOM_MS - performance.now());
      ctl.later(() => endCtl(ctl, false), ms);
      n++;
    }
    return n;
  } catch (e) { return 0; }
}
/* the landed moments' blocks in client px (a map moment's scene block projected on this seat's view) */
export function blocks() {
  const out = [];
  for (const ctl of active.values()) {
    if (ctl.dead || !ctl.landed || ctl.roomFor) continue;
    const b = blockOf(ctl);
    if (!b) continue;
    if (ctl.shared) { const a = toClient({ x: b.l, y: b.t }), c = toClient({ x: b.r, y: b.b }); if (a && c) out.push({ l: a.x, t: a.y, r: c.x, b: c.y }); }
    else out.push(b);
  }
  return out;
}
export function onTokenReact(data) {
  if (data?.phase === 'hit') makeRoom(data.ids, data.at);
  else if (data?.phase === 'place' && Array.isArray(data.blocks)) data.blocks.push(...blocks());
}
/* the screen pins of a map moment: an HTML part follows its scene point (followPan) */
function pin(ctl, el, at, c0, k = 0) { (ctl.pins ??= []).push({ el, at, c0, k }); }

/* the Resolve gauge: a DOM gauge (pips, the line under it) inside the block, beside its lettered number. Measured first (a hidden
   copy), so the block leaves room for it. On a map moment it is measured at the reference size (--u 1, the same on every seat) and
   drawn at the scene's scale. */
function probeGauge(ctl, stress, resolve) {
  try {
    const lw = letterWrap(ctl);
    const b = S.stressBadge(lw, stress, resolve, null);
    if (ctl.shared) b.style.setProperty('--u', '1');
    b.style.visibility = 'hidden';
    const q = b.getBoundingClientRect();
    b.remove();
    return q && q.width > 0 ? { w: Math.ceil(q.width), h: Math.ceil(q.height) } : null;
  } catch (e) { return null; }
}
function stressGauge(ctl, stress, resolve, g) {
  const b = S.stressBadge(letterWrap(ctl), stress, resolve, ctl.backdrop ? ctl.later : null);   // the red flash of a broken hero is a backdrop too
  if (ctl.shared) {
    b.style.setProperty('--u', '1');
    const c = g ? toClient(g) : null, z = globalThis.canvas?.stage?.scale?.x || 1;
    const gk = ctl.gaugeK * (g?.k ?? 1);
    if (c) { b.style.left = c.x + 'px'; b.style.top = c.y + 'px'; b.style.scale = (gk * z).toFixed(3); pin(ctl, b, { x: g.x, y: g.y }, c, gk); }
  } else if (g) { b.style.left = g.x + 'px'; b.style.top = g.y + 'px'; if ((g.k ?? 1) < 0.999) b.style.scale = g.k.toFixed(3); }   // shrunk with the block
  ctl.gaugeEl = b;
  return b;
}
/* the stress after Accept: its own small block (number + gauge) right under the moment that is still up, else by the token */
function stressLettered(ctl, stress, resolve, holdK, seed) {
  const it = { ...LP.planStress(stress, { holdK, reduced: S.isReduced() }) };
  const gauge = probeGauge(ctl, stress, resolve);
  ctl.seed ??= seed;
  const r = ctl.rect;
  const lay = compose(ctl, [it], { ...(gauge ? { gauge } : {}), ...(r ? { token: null, focus: { x: (r.l + r.r) / 2, y: r.b + 0.05 * (ctl.shared ? (ctl.layout?.frame?.vh ?? SP.REF_VH) : SP.REF_VH) } } : {}) });   // SAMEPIC: the reference height
  ctl.k = lay.k;
  const p = lay.items[0];
  if (p) p._o = { ...p._o, seed: seed ?? p._o?.seed };
  stressGauge(ctl, stress, resolve, lay.gauge);
  if (p) letterOne(ctl, p);
}

/* CRITFIX: the deferred backdrop of a result with an impact frame enters when this seat's impact is over (its last drawing), on the
   word's strike when this seat shows no impact (the target and the word out of its view, the engine refused it). A moment that ended
   or already let its surroundings go gets none. The struck target this seat sees keeps a clear spot like the hero. */
export const IMPACT_MAX_MS = 500;   // the engine's longest impact (12 ticks at 24 Hz): the fallback end when its plan gave no length
function enterBackdrop(ctl, shot) {
  const add = ctl.bdLater;
  ctl.bdLater = null;
  if (!add) return;
  const live = !!ctl.impact && ctl.impact.alive !== false;
  const now = performance.now();
  const end = live ? (Number.isFinite(ctl.impactEnd) ? ctl.impactEnd : (Number.isFinite(ctl.impactPeak) ? ctl.impactPeak : now) + IMPACT_MAX_MS) : now;
  if (live && shot?.where === 'target' && shot.target) ctl.spotTarget = shot.target;
  ctl.later(() => { if (!ctl.dead && !ctl.extrasGone) add(); }, Math.max(0, Math.round(end - now)));
}
/* the struck target's token for a clear spot: only while this seat still sees it in its view (a spot must not mark a hidden token) */
function spotToken(id) {
  if (!id || targetLook(id) !== 'ok') return null;
  try { return globalThis.canvas.tokens.get(id) ?? null; } catch (e) { return null; }
}
/* tło pełnoekranowe: poświata w kolorze wyniku i promienie na cały widok; nigdy nie zasłania całkiem mapy */
function addBackdrop(ctl, P, strength, fx) {
  const h = hueOf(P), k = 0.5 + 0.5 * strength, reduced = S.isReduced();
  const bd = document.createElement('div'); bd.className = 'ins-backdrop';
  bd.style.background =
    'radial-gradient(circle at 50% 46%, ' + hsl(h + 20, 100, 70, (0.30 * k).toFixed(2)) + ' 0%, ' + hsl(h, 100, 52, (0.22 * k).toFixed(2)) + ' 32%, ' + hsl(h - 28, 90, 10, (0.62 * k).toFixed(2)) + ' 100%)';
  const layerEl = ensureLayer();
  /* FXLD2 (ADVD2 6): with the Backdrop setting on, the wash still never hides the hero: a clear spot over the rolling token.
     CRITFIX: and none over the struck target this seat sees (its impact landed there); several spots = mask layers intersected */
  const spots = [ctl.hero, spotToken(ctl.spotTarget)].filter((t, i, a) => t && a.indexOf(t) === i).map(tokenBox).filter(Boolean);
  const hole = spots.length ? spots.map(spotMask).join(', ') : null;
  if (hole) { bd.style.maskImage = hole; bd.style.webkitMaskImage = hole; if (spots.length > 1) { bd.style.maskComposite = 'intersect'; bd.style.webkitMaskComposite = 'source-in'; } }
  layerEl.insertBefore(bd, ctl.el);
  ctl.extras.push(bd);
  if (!reduced) bd.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out', fill: 'backwards' });
  /* obracające się promienie to czysty efekt ruchu: bez nich przy ograniczonym ruchu i przy Efekty = Wyłączone (poświata zostaje) */
  if (reduced || !fx) return;
  const ray = document.createElement('div'); ray.className = 'ins-fullrays';
  ray.style.setProperty('--ray', hsl(h + 20, 100, 72, (0.50 * k).toFixed(2)));
  /* the rays turn, so their clear spot is cut by a still wrapper around them (its mask does not turn) */
  let host = ray;
  if (hole) { host = document.createElement('div'); host.className = 'ins-raywrap'; host.style.maskImage = hole; host.style.webkitMaskImage = hole; ray.style.position = 'absolute'; host.appendChild(ray); }   // absolute in the fixed wrapper (a fixed child escaped its mask live)
  if (hole && spots.length > 1) { host.style.maskComposite = 'intersect'; host.style.webkitMaskComposite = 'source-in'; }
  layerEl.insertBefore(host, ctl.el);
  ctl.extras.push(ray);
  if (host !== ray) ctl.extras.push(host);
  if (ctl.shared && ctl.rayPin) pin(ctl, ray, ctl.rayPin.at, ctl.rayPin.c);   // CRITFIX: entered after the impact: pinned like the ones placed with the block
  {
    ray.animate([{ opacity: 0, transform: 'translate(-50%,-50%) rotate(0deg) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(10deg) scale(1)', offset: 0.2 }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(60deg) scale(1)' }],
      { duration: 7000, easing: 'linear', fill: 'forwards' });
  }
}

/* a CSS mask with a clear ellipse over a client box (the hero), feathered.
   CRITFIX: the wash is full again right at the token's edge (+2 px) and feathers INSIDE it, over its outer SPOT_FEATHER of the half
   size (at least 6 px): the figure stays clear, the token's own rim takes a little of the wash. Before, the spot reached 1.2x the half
   size with a 0.3x feather: a ring of unwashed map round the token, darker than the bright wash, read as a dark halo in every hold
   frame; live, a feather outside the rim (raw ground ramping up to the wash) still read as a thin dark ring. */
export const SPOT_FEATHER = 0.14;
export function spotMask(b) {
  const cx = Math.round((b.l + b.r) / 2), cy = Math.round((b.t + b.b) / 2), hw = Math.max(1, (b.r - b.l) / 2), hh = Math.max(1, (b.b - b.t) / 2);
  const rx = Math.round(hw + 2), ry = Math.round(hh + 2), f = Math.max(6, SPOT_FEATHER * Math.max(hw, hh));
  const clear = Math.max(50, Math.min(96, Math.round((100 * (hw + 2 - f)) / rx)));
  return `radial-gradient(${rx}px ${ry}px at ${cx}px ${cy}px, transparent 0, transparent ${clear}%, #000 100%)`;
}

/* Pełny ekran: poświata i obracające się promienie schodzą razem ze słowem, nie dopiero po całym ogonie sceny (finish = hold + 3 s).
   Bez tego ściemniony widok z promieniami wisiał nad mapą jeszcze ok. 3 s po zniknięciu słowa. Węzły wychodzą z ctl.extras,
   żeby endCtl nie wygaszał ich drugi raz (animacja 1 -> 0 na już przezroczystym węźle mignęłaby z powrotem). */
function fadeExtrasEarly(ctl) {
  ctl.extrasGone = true;   // CRITFIX: a backdrop still waiting for its impact to end does not come after the surroundings went
  for (const x of ctl.extras.splice(0)) {
    if (S.isReduced() || !x.animate) { x.remove(); continue; }
    const a = x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, fill: 'forwards' });
    a.onfinish = () => x.remove();
    setTimeout(() => x.remove(), 1000);   // gdy karta jest ukryta, animacje nie kończą się same
  }
}

function endCtl(ctl, quick) {
  if (ctl.dead) return;
  ctl.dead = true;
  ctl.timers.forEach(clearTimeout);
  tellDone(ctl);   // FIN-CALLERS (FXIT-S1): over or dropped, on every way out
  if (active.get(ctl.key) === ctl) active.delete(ctl.key);
  if (ctl.lw) stopLetters(ctl, quick);   // LDIC: a newer splash on the same place, the limit, a scene change: the words exit (quick = at once)
  if (quick && ctl.impact?.alive) { try { ctl.impact.stop(); } catch (e) { /* already over */ } }   // WIRE1: a moment cut short takes its impact frame with it
  for (const x of ctl.extras || []) {
    if (quick || S.isReduced()) { x.remove(); continue; }
    const a = x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 600, fill: 'forwards' });
    a.onfinish = () => x.remove();
    setTimeout(() => x.remove(), 900);   // gdy karta jest ukryta, animacje nie kończą się same
  }
  if (quick) {
    for (const n of Array.from(ctl.el.children)) {
      if (n.classList.contains('ins-splash')) S.leaveSplash(n); else S.fadeOut(n, 160);
    }
    setTimeout(() => ctl.el.remove(), 700);
  } else if (S.isReduced() || !ctl.el.animate) ctl.el.remove();
  else {
    /* koniec naturalny: krótkie wygaszenie zamiast nagłego zniknięcia ostatnich plakietek */
    const a = ctl.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: 'forwards' });
    a.onfinish = () => ctl.el.remove();
    setTimeout(() => ctl.el.remove(), 500);
  }
}

/* tworzy scenę; opts: { token (Token|null), scale } */
function openStage(opts, shared = false) {
  const token = opts.full ? null : (opts.token || null);
  const key = token ? 't:' + token.id : 'screen';
  const old = active.get(key);
  if (old) endCtl(old, true);
  while (active.size >= MAX_STAGES) endCtl(active.values().next().value, true);   // limit scen naraz (spam rzutów)

  const el = document.createElement('div');
  el.className = 'ins-stage' + (token ? ' on-token' : '') + (opts.full ? ' full' : '');
  const scale = opts.scale || 1;
  const lay = ensureLayer();   // mierzy też obszar roboczy (okno bez czatu)
  let W;
  if (token) {
    /* scena jest mała i wyśrodkowana na tokenie: elementy układają się wokół niego, a nie w dużym kadrze */
    const tokenPx = (token.w || 100) * tokenScale();
    W = Math.round(Math.max(470, Math.min(tokenPx * 4.6, 660)) * scale);
    W = Math.min(W, Math.round(area.w * 0.9), Math.round(window.innerHeight * 1.2));   // scena 4:3 nie wyższa niż okno
  } else if (opts.full) {
    /* pełny ekran: scena prawie na całą szerokość obszaru roboczego (16:9 mieści się też w niskim oknie) */
    W = Math.round(Math.min(area.w * 0.92, window.innerHeight * 1.4, 1600) * scale);
    W = Math.min(W, Math.round(area.w * 0.96), Math.round(window.innerHeight * 1.5));
  } else {
    W = Math.round(Math.min(area.w * 0.7, 900) * scale);
    W = Math.min(W, Math.round(area.w * 0.96), Math.round(window.innerHeight * 1.45));
  }
  el.style.width = W + 'px';
  lay.appendChild(el);
  el.style.setProperty('--u', Math.max(0.4, Math.min(opts.full ? 2.2 : 1.4, W / 760)).toFixed(3));
  const ctl = { key, el, token, W, extras: [], timers: [], dead: false, pos: token ? POS_TOKEN : POS_SCREEN, userScale: shared ? 1 : scale,
    hero: opts.token || null, shared, backdrop: !!opts.backdrop, momentId: opts.momentId ?? null };
  /* FXLD2: a map moment's gauge: scene px per reference px (the gauge is measured at --u 1, the 768 px reference) */
  if (shared) ctl.gaugeK = GRID_VH * (globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100) / LP.REF_VH;
  ctl.later = (fn, ms) => {
    ctl.timers.push(setTimeout(() => {
      if (ctl.dead) return;
      try { fn(); } catch (e) { console.warn('invincible-plus-ultra (splash) | stage step failed', e); endCtl(ctl, false); }   // wyjątek nie zostawia sceny w DOM
    }, ms));
  };
  if (token) placeTokenStage(ctl);
  active.set(key, ctl);
  return ctl;
}

/* Odtwarza zdarzenie.
   o: { rnd, token, scale, hold (mnożnik czasu), fx (0/1), resolve: () => ({now,max}) | null, label } */
export function play(ev, o) {
  if (lettersOn()) return playLetters(ev, o);   // LDIC: lettered by the comic lettering engine; the classic splash below when it is not there (or its master switch is off)
  return playClassic(ev, o);
}
function playClassic(ev, o) {
  ev = shownEv(ev);   // SPLASHPL: the words as this seat shows them (the event keeps the shared English key)
  const rnd = o.rnd || Math.random;
  /* rzadszy sukces (moc >= próg) dostaje pełny ekran; porażki i rutyna nie */
  const full = o.fullFrom != null && !ev.fail && ev.power != null && ev.power >= o.fullFrom;
  const ctl = openStage(full ? { ...o, full: true } : o);
  const stage = ctl.el, later = ctl.later;
  if (full && o.backdrop) addBackdrop(ctl, ev.power, o.fullFrom >= 1 ? 1 : (ev.power - o.fullFrom) / (1 - o.fullFrom), o.fx);   // FXLD2: backdrops opt-in (the owner)
  const holdK = o.hold || 1;
  const hueShift = ev.npc ? 150 : 0;

  const finish = ms => later(() => endCtl(ctl, false), ms);
  const stressNow = () => {
    if (!ev.stress) return;
    S.stressBadge(stage, ev.stress, o.resolve ? o.resolve() : null, later);
  };

  let t = 0;
  if (ev.pushed && ev.prefix) {
    const pre = S.buildSplash({ word: ev.prefix, tier: 5, fs: fitFs(stage, ev.prefix, 34, 0, 0.6), fill: '#ff9330', rnd });
    pre.style.top = ctl.pos.pre[1] + '%';
    later(() => { stage.appendChild(pre); S.popIn(pre, 1.15, 7, rnd); }, 0);
    later(() => S.fadeOut(pre, 220), 650);
    t = 680;
  }

  later(() => {
    tellLand(ctl, performance.now(), 0);   // FIN-CALLERS (FXIT-S1): the classic word pops now; it has no impact frame
    if (ev.fail) {
      /* siła porażki z jej rzadkości: rutyna (>50%) jest cicha, rzadka porażka silnej postaci jest komiczna */
      const dF = ev.failP == null ? 0.3 : Math.max(0, Math.min(1, Math.log(0.5 / ev.failP) / Math.log(10)));
      if (ev.softFail) {
        const sf = S.buildSplash({ word: ev.word, tier: 1, fs: fitFs(stage, ev.word, 36, 0, 0.55), fill: '#b1afc4', rnd });
        sf.style.top = ctl.pos.fail[1] + '%'; sf.style.opacity = '0';
        stage.appendChild(sf);
        if (!S.isReduced()) sf.animate([{ opacity: 0, transform: 'translate(-50%,-50%) translateY(8px)' }, { opacity: 0.85, transform: 'translate(-50%,-50%)', offset: 0.25 }, { opacity: 0.85, transform: 'translate(-50%,-50%)', offset: 0.7 }, { opacity: 0, transform: 'translate(-50%,-50%) translateY(-6px)' }], { duration: 2300 * holdK, fill: 'forwards' });
        else sf.style.opacity = '0.8';
        if (ev.stress) later(stressNow, 300);
        finish(2500 * holdK + (ev.stress ? 2600 : 0));
        return;
      }
      const f = S.buildSplash({ word: ev.word, tier: 1, fs: fitFs(stage, ev.word, Math.round((ev.pushed ? 40 : 34) + 34 * dF), 0, 0.7), fill: '#b4b2c2', rnd });
      f.style.top = ctl.pos.fail[1] + '%';
      stage.appendChild(f); S.droop(f); later(() => S.fadeOut(f, 600), 2800 * holdK);
      if (dF > 0.3 && !ev.pushed && ev.failP) {
        later(() => {
          S.oddsRibbon(stage, 0, ev.failP, false, null, !!ev.stress && !ctl.token, {
            text: say(dF > 0.6 ? 'WHAT A FLOP!' : 'UNLUCKY!'), color: '#8fa3d9',
            pill: LBL.miss(fmtOdds(Math.round(1 / ev.failP)))
          });
          if (!S.isReduced() && o.fx) S.shake(stage, 4 + Math.round(8 * dF));
        }, 350);
      }
      if (ev.stress) later(stressNow, 450);
      finish(3600 * holdK + 800);
      return;
    }

    const P = ev.power;
    const ribbon = !!oddsText(P) || !!ev.tag;
    const label = o.label || null;
    const fs = fitFs(stage, ev.word, FS[ev.tier - 1], P, ev.wreckWord ? 0.40 : (ev.sixes > 0 ? 0.64 : 0.76));
    const s = S.buildSplash({ word: ev.word, tier: ev.tier, label, power: P, hueShift, shape: ev.shape, fs, rnd, glow: o.fx >= 1 });
    const pm = ev.wreckWord ? ctl.pos.mainWreck : ctl.pos.main;
    s.style.left = pm[0] + '%'; s.style.top = pm[1] + '%';
    const hold = Math.round((3400 + 1800 * P) * holdK);
    later(() => {
      S.leaveSplash(s);
      Array.from(stage.querySelectorAll('.ins-odds,.ins-sixbadge')).forEach((n, i) => later(() => S.leaveSlide(n), 120 + i * 90));
    }, hold);
    later(() => Array.from(stage.querySelectorAll('.ins-badge')).forEach(S.leaveSlide), hold + 1400);
    if (full) later(() => fadeExtrasEarly(ctl), hold + 300);   // słowo schodzi w hold (520 ms); tło znika zaraz za nim
    stage.appendChild(s); S.popIn(s, 1.05 + 0.55 * P, 5 + 9 * P, rnd); S.idle(s, P, rnd);
    if (o.fx) S.fxFor(stage, ev.tag ? Math.max(P, 0.32) : P, later, o.fx, full || !o.backdrop);
    if (ev.sixes > 0) later(() => S.sixBadge(stage, ev.sixes), 260);
    if (ev.p != null && ribbon) later(() => S.oddsRibbon(stage, P, ev.p, ev.pushed, ev.tag, !!ev.stress && !ctl.token), 380);
    if (ev.wreckWord) {
      later(() => {
        const wp = Math.min(1, P + 0.1);
        const wshape = ['burst', 'shard', 'splat'][Math.floor(rnd() * 3)];
        const x = S.buildSplash({ word: ev.wreckWord, tier: ev.tier, fs: fitFs(stage, ev.wreckWord, Math.round(FS[ev.tier - 1] * 0.55), wp, 0.3, 20), power: wp, hueShift: -22 + hueShift, simple: true, shape: wshape, rnd });
        x.style.left = ctl.pos.wreck[0] + '%'; x.style.top = ctl.pos.wreck[1] + '%';
        stage.appendChild(x); S.popIn(x, 1.25, 10, rnd); S.idle(x, wp, rnd);
        later(() => S.leaveSplash(x), hold - 550 + 160);
        if (o.fx && !S.isReduced()) S.shake(stage, 5);
      }, 550);
    }
    if (ev.stress) later(stressNow, 450);
    finish(hold + 3000 * holdK);
  }, t);
  return ctl;
}

/* Sam stres (np. po Accept, gdy rzut był pushowalny w chwili splasha). */
export function playStress(ev, o) {
  /* jeśli splash tego tokena (albo ekranu) jeszcze trwa, plakietka dołącza do niego zamiast go wypierać */
  const key = o.token ? 't:' + o.token.id : 'screen';
  const existing = active.get(key);
  const joined = !!existing && !existing.dead;
  const ctl = joined ? existing : openStage(o);
  const stage = ctl.el;
  if (lettersOn()) ctl.later(() => stressLettered(ctl, ev.stress, o.resolve ? o.resolve() : null, o.hold || 1, o.seed != null ? o.seed + ':late' : null), 100);
  else ctl.later(() => S.stressBadge(stage, ev.stress, o.resolve ? o.resolve() : null, ctl.later), 100);
  ctl.later(() => Array.from(stage.querySelectorAll('.ins-badge')).forEach(S.leaveSlide), 3400 * (o.hold || 1));
  if (ctl.lw) ctl.later(() => Array.from(ctl.lw.querySelectorAll('.ins-badge')).forEach(S.leaveSlide), 3400 * (o.hold || 1));
  if (!joined) ctl.later(() => endCtl(ctl, false), 4000 * (o.hold || 1));
  return ctl;
}

export function clearAll() { for (const c of Array.from(active.values())) endCtl(c, true); }
export function activeCount() { return active.size; }
