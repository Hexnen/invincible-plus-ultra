/* Scena splasha: warstwa ekranowa (fixed) albo przy tokenie (wewnątrz #hud rdzenia, zsynchronizowanego z canvasem).
   Jeden splash na klucz ('screen' albo id tokena); nowy wypiera poprzedni. */
import { FS, LBL, oddsText, hueOf, hsl, fmtOdds, say, shownEv } from './logic.mjs';
import * as S from './splash.mjs';
import * as LP from './letter-plan.mjs';
import * as IP from './impact-plan.mjs';
import { seesToken } from './seen.mjs';
import * as SP from '../same-picture.mjs';   // SAMEPIC: one picture for the table
import * as Dir from '../direct.mjs';   // DIRECT: the lettering goes the way of the action
import * as Share from './seat-share.mjs';   // SPLASHSEAT: what stands on every seat's screen, told round the table

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
/* SIZEDEAD: the lettering's own Size as the TABLE holds it (engine 1.9.16+: one value on every seat; an older engine's is each screen's own: 1) */
export function lettersScale() { try { const k = Number(LE?.table?.scale); return typeof LE?.setTable === 'function' && k > 0 ? k : 1; } catch (e) { return 1; } }
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
export function safeRect({ core = false, screen = false } = {}) {
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
  if (onMap() && !screen) {
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
/* CRITLATE: what the engine said about each lettering, kept by its exact input (the text, the options measured with, the layer, the engine's
   version and table preferences): the same call gives the same answer, so a moment laid out ahead (prepare) is not measured again at its
   instant. A changed input is a new key (measured afresh). */
const MEASURE_MEMO = new Map(), MEASURE_MAX = 240;
function engineKey() {
  let p = '';
  try { p = JSON.stringify(LE?.prefs ?? null); } catch (e) { p = '?'; }
  return `${LE?.version ?? '?'}|${p}`;
}
function measureItems(items, base) { return LP.runSteps(measureSteps(items, base)); }
/* CRITFREEZE: the measuring in steps (after each lettering the engine measured afresh; a kept one costs nothing) */
function* measureSteps(items, base) {
  const hands = [];
  const ek = engineKey(), gs = globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100;
  for (const it of items) {
    const o = engineOpts(it, base, hands);
    it._o = o;
    let m = null;
    const mk = memoKey([ek, it.text, o, !!base.map, base.map ? gs : 0]);
    const hit = mk ? MEASURE_MEMO.get(mk) : null;
    if (hit) {
      MEASURE_MEMO.delete(mk); MEASURE_MEMO.set(mk, hit);   // most recent last
      it._m = hit;
      if (hit.hand) hands.push(hit.hand);
      continue;
    }
    try {
      /* SAMEPIC: measured as every seat measures it: a seat's reduced motion (no tilt, no entrance smear) plays the same block still, it
         does not lay it out smaller or elsewhere */
      const om = { ...o, reduced: false, rotation: Number.isFinite(it.rot0) ? it.rot0 : o.rotation };
      /* CALLERS (engine 1.9.11 L.measure): the same plan, plus the word's real entrance reach (a whoosh flies in from the side, a fire word
         rises from below: the biggest pose alone missed up to 1.7 caps of it) and, on the map, the ink rim its world word gets (1.9.12) */
      const me = LE.measure ? LE.measure(LP.letterable(it.text), base.map ? { ...om, space: 'world', keepInView: false } : om) : null;
      const r = LE.planFor ? LE.planFor(LP.letterable(it.text), om) : null;   // size and hold box stay the planFor ones (no picture change)
      const p = r?.plan ?? me?.plan ?? (LE._plan ? (() => { const q = LE._plan(LP.letterable(it.text), om); LE._settle?.(q); return q; })() : null);
      if (p?._holdBox?.w > 0 && p.sizeK > 0) m = { w: p._holdBox.w, h: p._holdBox.h, sizeK: p.sizeK, hand: p.hand?.id, grow: IP.growOf(p), contact: IP.contactMs(p) };   // FXI-SPLASH: the entrance's biggest drawing and the instant it hits
      if (m && me?.reach && me.unit > 0) m.reach = { l: me.reach.l / me.unit, r: me.reach.r / me.unit, u: me.reach.u / me.unit, d: me.reach.d / me.unit };
      if (m && LE.measure) m.footAt = footAt(LP.letterable(it.text), base.map ? { ...om, space: 'world', keepInView: false } : om, base.map, m.sizeK);
    } catch (e) { m = null; }
    if (!m) { let k = 0.62 + 0.7 * (it.sound?.loud ?? 0.5); try { k = LE.design(LP.letterable(it.text), { ...o, reduced: false })?.sizeK ?? k; } catch (e) { /* estimate */ } const b = LP.estimateBox(it, 1); m = { w: b.w, h: b.h, sizeK: k, hand: null }; }
    else if (mk) { MEASURE_MEMO.set(mk, m); if (MEASURE_MEMO.size > MEASURE_MAX) MEASURE_MEMO.delete(MEASURE_MEMO.keys().next().value); }   // (an estimate is not kept: the engine may answer next time)
    it._m = m;
    if (m.hand) hands.push(m.hand);
    yield;
  }
}
/* CRITLATE: a key that only equal inputs share (non-finite numbers kept apart; functions, DOM nodes and tokens make the input unkeyable: null) */
export function memoKey(v) {
  let bad = false;
  const s = JSON.stringify(v, (k, x) => {
    if (typeof x === 'number') return Number.isFinite(x) ? (Object.is(x, -0) ? '§-0' : x) : `§n:${x}`;
    if (x === undefined) return '§u';
    if (typeof x === 'function' || typeof x === 'symbol' || typeof x === 'bigint') { bad = true; return null; }
    if (x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null) { bad = true; return null; }
    return x;
  });
  return bad ? null : s;
}
/* CALLERS2 (engine 1.9.18, L.measure standBox): a part's standing footprint past its hold box, in caps, measured by the engine at the size the
   layout tries (S px per cap: the rim's pixel floor and cap depend on it), the same on every seat: one device pixel per CSS px (view.dpr 1)
   and, on the map, the board's reference scale (view.zoom) instead of this seat's zoom. Cached per size (the layout tries a few). */
function footAt(text, o, map, sizeK = 1) {
  const memo = new Map();
  const gs = globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100;
  const view = map ? { dpr: 1, zoom: SP.REF_VH / (GRID_VH * gs) } : { dpr: 1 };
  return (S) => {
    const key = Math.round(S * 4) / 4;
    if (memo.has(key)) return memo.get(key);
    let f = null;
    try {
      const me = LE.measure(text, { ...o, fit: 'exact', size: key / (sizeK || 1), view });
      const hb = me?.plan?._holdBox, st = me?.stand, u = me?.unit;
      if (hb?.w > 0 && hb?.h > 0 && st && u > 0) f = { l: st.l / u - hb.w / 2, r: st.r / u - hb.w / 2, u: st.u / u - hb.h / 2, d: st.d / u - hb.h / 2 };
    } catch (e) { f = null; }
    memo.set(key, f);
    return f;
  };
}
const measureFn = (it, S) => (it._m ? { w: it._m.w * S, h: it._m.h * S, grow: it._m.grow ?? 1, ...LP.roomOf(it._m, S) } : LP.estimateBox(it, S));
function engineOpts(it, base, hands) {
  const o = {
    mood: it.mood, sound: it.sound, hold: it.hold, rotation: it.rotation || 0, reduced: S.isReduced(), magnitude: it.magnitude,
    seed: LP.seedOf(base.seed, it.role), avoid: hands.slice(), anchor: 'center'
  };
  if (Number.isFinite(base.from) && it.from != null) o.from = base.from;
  else if (Number.isFinite(it.from)) o.from = it.from;
  if (it.colors) o.colors = it.colors.slice();
  if (it.hand) o.hand = { ...it.hand };
  /* MAPSEAT (ADVX 18, the map word low in contrast among the map's drawings): NOT solved here. The engine's paper rim (look.outline
     "sticker") was tried on the board's sound words: it separates them from dark and mid ground, but the engine strokes it OVER the word's
     coloured duplicate block, which then vanishes (offline render, 2026-11-15), against the owner's look ruling (a word is set off by its
     duplicated block more often than by a light outline). Engine request: a light rim painted UNDER the duplicate (MAPSEAT-4).
     CALLERS: answered by engine 1.9.12 (RIMUNDER): every invincible WORLD word now gets an ink rim under its whole lettering by default
     (look.rim "auto" = ink in world space, none on the screen), so the map block's words have it without an option here; the rim is not
     in the measured hold box (about 0.07 of the cap + the keyline): the block's pad holds it (check-callers M). */
  for (const k of ['in', 'out', 'holdKind']) if (it[k]) o[k] = it[k];
  if (it.kind) o.kind = it.kind;   // WORDPOOL2: the engine's motion row of the word's own sound (letter-plan kindOf); the same on every seat
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
export const MAPSEAT_WIDE = 3;   // MAPSEAT (provisional MAPSEAT-3): how much wider than the board window a crowded board looks for room
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
/* SPLASHCLEAR (ADVS2 D4: the critical's word over the map's numbered zone badges 2 and 5): the map's zone badges (moinen-maps public zones API,
   as tokenreact reads them, CROWDKO): a badge stands on its zone's label point at a fixed size ON SCREEN (moinen-maps display: radius
   min(19, max(8, 0.8 r zoom)) CSS px, a shaped badge up to 1.2 of that). zoom: the scale the badge is drawn at (a seat's, or the table's
   reference scale). -> { shared: [scene boxes] }: shown to every seat = a shared obstacle (a pin's weight). Badges shown to the GM only are
   not read (like his hidden tokens they would move the GM's picture off the players': SPLASHCLEAR-3). A badge shown under the pointer only
   is not read (no fixed place) */
/* a badge is a number the table reads: it weighs a few pins (a 15 px graze of it is not clean on any window) */
export const BADGE_W = 3;
export function zoneBadges(zoom = 1) {
  const shared = [];
  try {
    const mod = globalThis.game?.modules?.get?.('moinen-maps'), api = mod?.active ? mod.api?.zones : null;
    const Z = api?.zones?.(), lk = api?.look?.();
    if (!Z?.zones?.length || !lk || lk.numbers !== 'always' || lk.who !== 'all') return { shared };
    /* a badge in the zone's corner (the comic looks' default; the live Warehouse): its point as moinen-maps places it (display.mjs follow:
       geometry.cornerPoint(zone, min(0.9 label r, 0.55 grid)), on the public API's geometry) */
    const corner = lk.place === 'corner', cp = api?.geometry?.cornerPoint, g = globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100;
    if (corner && typeof cp !== 'function') return { shared };
    const z = Math.max(0.02, Number(zoom) || 1);
    for (const q of Z.zones) {
      const l = q?.label;
      if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) continue;
      let p = l;
      if (corner) { try { p = cp(q, Math.min((Number(l.r) || 40) * 0.9, g * 0.55)); } catch (e) { p = null; } }
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const r = Math.min(19, Math.max(8, (Number(l.r) || 40) * 0.8 * z)) * 1.2 / z;
      shared.push({ l: p.x - r, t: p.y - r, r: p.x + r, b: p.y + r });
    }
  } catch (e) { /* no map, no badges */ }
  return { shared };
}
/* the shared frame of a map moment (scene px) */
export function sharedFrame(hero, targets = [], star = null) {
  const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100;
  const zoom = Math.max(0.02, Number(C?.stage?.scale?.x) || 1);   // this view's zoom: for inspection and the seat's readability test only
  const token = docBox(hero, gs);
  const sr = C?.dimensions?.sceneRect;
  const ins = 0.1 * gs;
  const scene = sr ? { l: sr.x + ins, t: sr.y + ins, r: sr.x + sr.width - ins, b: sr.y + sr.height - ins }
    : { l: token.x - 40 * gs, t: token.y - 40 * gs, r: token.x + 40 * gs, b: token.y + 40 * gs };
  /* MAPSEAT: the block is laid out inside the BOARD WINDOW (same-picture.mjs boardWindow: the reference view centred on the roller at the
     board's reference scale), cut by the scene; one rectangle on every seat, whatever its view. A roller at the scene's edge keeps at least
     the part of the window inside the scene */
  /* a roller near the scene's edge: the window slides into the scene (it keeps its size where the scene allows), as a seat's view would */
  const inScene = (w) => { const d = SP.shiftInto(w, scene); return meet(scene, { l: w.l + d.dx, t: w.t + d.dy, r: w.r + d.dx, b: w.b + d.dy }); };
  const q = inScene(SP.boardWindow(token, GRID_VH * gs / SP.REF_VH));
  const safe = q.r - q.l > 2 * gs && q.b - q.t > 2 * gs ? q : scene;
  /* the wider window a crowded board searches before the block lies on a token (LP.composeMoment, MAPSEAT_WIDE x the board window) */
  const wq = inScene(SP.boardWindow(token, MAPSEAT_WIDE * GRID_VH * gs / SP.REF_VH)), wide = wq.r - wq.l > safe.r - safe.l || wq.b - wq.t > safe.b - safe.t ? wq : null;
  const avoid = [];
  for (const t of C?.tokens?.placeables ?? []) {
    const d = docOf(t);
    if (!d || sameTok(t, hero) || d.hidden) continue;   // a hidden token is not on every seat's board: it never moves the block
    avoid.push({ ...grow(docBox(t, gs), 0.06 * gs), w: targets.includes(t.id) ? LP.TARGET_W : LP.OTHER_W });   // CRITPEAK: the roll's target weighs most
  }
  for (const n of C?.notes?.placeables ?? []) { try { if (docOf(n)) avoid.push(noteBox(n, gs)); } catch (e) { /* a pin without a place */ } }
  for (const q of zoneBadges(SP.REF_VH / (GRID_VH * gs)).shared) avoid.push({ ...q, w: BADGE_W });   // SPLASHCLEAR: the zone badges every seat sees (at the board's scale)
  const vh = GRID_VH * gs;
  /* CAPSTAR: the star's cut-in on the board, as a seat at the board's reference scale draws it (its view's short side = the board height vh):
     one scene box on every seat (the block is the board's; a seat at another zoom sees the cut-in at its own share of its view) */
  if (star) { try { const b = docBox(star.tok, gs), s = starAvoid(star, b, Math.max(b.r - b.l, b.b - b.t), vh); if (s) avoid.push(s); } catch (e) { /* no star */ } }
  /* CRITPEAK: nothing of this seat's view sizes the block (SAMEPIC: one scene place and one scene size on every seat, whatever its zoom):
     the ranks' sizes are shares of the board height (vh). A seat zoomed so far out that the board word is a speck plays the moment on its
     screen layer instead (playLetters, LP.MAP_READ) */
  return { vh, freeW: vh * 16 / 9, safe, wide, token, avoid, gap: Math.round(0.12 * gs), focus: { x: token.x, y: token.y }, zoom };
}
/* the bars and panels that are not at an edge: the party cards, the map's VRAM meter and pins panel, the GM's desk, the tactics dock */
/* SPLASHSEAT (live, the GM's seat: twelve rows of his scene list that are not drawn, visibility hidden with their folded menu, were kept
   off as panels: 33 "own" boxes, the left third of his view, so his block went another way than a player's): only what is really shown
   counts as a panel */
const seenEl = (e) => { try { return typeof e.checkVisibility === 'function' ? e.checkVisibility({ visibilityProperty: true }) : true; } catch (x) { return true; } };
export const UI_AVOID = ['#invincible-party li', '.mm-vram', '#mm-filter', '#invincible-tactics-desk:not(.igd-collapsed) .igd', '#ich-dock'];
function uiAvoid() {
  const out = [];
  for (const sel of UI_AVOID) {
    try {
      for (const e of document.querySelectorAll(sel)) {
        const q = e.getBoundingClientRect();
        if (q && q.width > 0 && q.height > 0 && seenEl(e)) out.push({ l: q.left - 6, t: q.top - 6, r: q.right + 6, b: q.bottom + 6, w: UI_WEIGHT });
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
const liveProj = projBox;
/* SPLASHBLOCK (the owner: the GM and the players see the same picture at the same moment; KOSAME, repeated real fights on two seats: the
   reaction word's size or place differed in 11 of 16, traced to the roll's screen block standing in another shape and place per seat).
   The cause, read off the fights' logs and captured inputs: a screen moment by its roller was the table's block (tableFrame) placed by
   LP.seatPlace on THIS seat's live view: its pan (the users' own views differ by ~190 px by the map's design, the action camera drifts while
   it holds a shot), its own panels (the GM's scene list and desk) and the documents as that instant's view projected them. On a crowded
   board nothing is clean, the least-covering search is chaotic in those inputs, and two seats drew two arrangements (joined at the bottom on
   the GM, split round the fighters on the player).
   Now the seat's block is decided in two steps:
   1. the table's block placed on the CANONICAL seat of this seat's view (canonSeat): a window of this size at this zoom (in ZOOM_STEP
      steps) with the roller at the middle of the SNAP px cell he stands in, and nothing of this seat in it: no panels, no sidebar state, no
      px of camera drift. From documents, the zoom step, the window's size and the roller's cell alone, so seats whose views agree to within
      a cell and a zoom step get one block. LP.seatPlace as before (the table's arrangement, sides, order and one factor: SPLASHSAME);
   2. that block on THIS seat: moved with the roller by the few px he stands off his cell's middle (the usual case), else shifted as ONE
      piece into the seat's view (LP.seatPlace rigid: a few px of view give a few px of shift, never another arrangement), and only when
      that covers more than the canonical block does or lands on the seat's own panel, the seat's own search (as before: farther but
      clean, then smaller).
   The zoom and the roller's place are read off the view the moment is SHOWN on (planView): the action camera's shot while it is parked
   away (the same shot on every seat of one window size; the live view drifts while a shot is held and differs per seat by the users' own
   views once it goes home), else the live view. Seats that look at the board differently (another zoom, another window, another part of
   the map) still place the one table block each on what they see: provisional SPLASHBLOCK-1 */
export const SNAP = 64;
const CANON_FREE = 0.01, CANON_COVER = 0.03, CELL_HOLD = 12;
export const SHARE_REACH = SNAP / 2 + CELL_HOLD;   // SPLASHSEAT: how far a seat's roller may stand off his cell's middle (canonSeat)
export const RIM_W = 0.1;   // SPLASHSEAT: a told box's rim, per px2 (a fifth of the box itself: a corner of it, 1600 px2, still passes as clean)
export const ZOOM_STEP = 1.025;
export const quantZoom = (z) => { const s = Math.log(ZOOM_STEP); return Math.exp(Math.round(Math.log(Math.max(0.02, Number(z) || 1)) / s) * s); };
/* the view a screen moment is laid out on: { x, y, scale, shot } (scene point in the middle of the window, zoom) */
export function planView() {
  const C = globalThis.canvas, st = C?.stage;
  try {
    const mm = globalThis.game?.modules?.get?.('moinen-maps'), d = mm?.active ? mm.api?.directorStage?.status?.() : null, p = d?.parked;
    if (p && d.home && [p.x, p.y, p.scale].every(Number.isFinite) && p.scale > 0 && st?.position && Number.isFinite(st.position.x)) return { x: p.x, y: p.y, scale: p.scale, shot: true };
  } catch (e) { /* no map, no shot */ }
  const z = Number(st?.scale?.x) || 1;
  return st?.pivot && Number.isFinite(st.pivot.x) ? { x: st.pivot.x, y: st.pivot.y, scale: z } : { x: 0, y: 0, scale: z };
}
/* a scene point on the plan view, client px (the live view: the stage's own transform) */
function planClient(q, pv) {
  if (!pv?.shot) return toClient(q);
  try { const r = canvas.app.view.getBoundingClientRect(), o = canvas.stage.position; return { x: r.left + o.x + (q.x - pv.x) * pv.scale, y: r.top + o.y + (q.y - pv.y) * pv.scale }; } catch (e) { return toClient(q); }
}
/* the canonical seat of a zoom step, a window size and the roller's cell (client px of this window; at = the roller's middle on the plan
   view): { hero, safe, avoid, proj, zoom, W, H, ox, oy, scene(q) } */
function canonSeat(hero, targets, star, zq, W, H, at, keep = null, sh = null) {
  const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100;
  /* keep: the cell this moment was laid out in a moment ago (seen live: the roller on a cell's edge, 445.9 and 448.9 px on two layouts of
     one moment, 448 the edge: the moment's block jumped between two arrangements on one seat). It stays in that cell while the roller is
     within CELL_HOLD px past its edge */
  const held = keep && keep.zq === zq && Math.abs(at.x - keep.x) <= SNAP / 2 + CELL_HOLD && Math.abs(at.y - keep.y) <= SNAP / 2 + CELL_HOLD;
  const hb = docBox(hero, gs), cx = held ? keep.x : (Math.floor(at.x / SNAP) + 0.5) * SNAP, cy = held ? keep.y : (Math.floor(at.y / SNAP) + 0.5) * SNAP;
  const proj = (b) => ({ x: ((b.l + b.r) / 2 - hb.x) * zq + cx, y: ((b.t + b.b) / 2 - hb.y) * zq + cy, l: (b.l - hb.x) * zq + cx, t: (b.t - hb.y) * zq + cy, r: (b.r - hb.x) * zq + cx, b: (b.b - hb.y) * zq + cy });
  const win = { l: 2, t: 2, r: W - 2, b: H - 2 };
  const band = { l: Math.max(win.l, SP.RESERVE.l), t: Math.max(win.t, SP.RESERVE.t), r: Math.min(win.r, W - SP.RESERVE.r), b: Math.min(win.b, H - SP.RESERVE.b) };
  if (band.r - band.l < 0.4 * W || band.b - band.t < 0.4 * H) Object.assign(band, win);      // a tiny window: the whole of it (seatBand)
  const cv = { proj, zoom: zq, W, H, ox: 0, oy: 0 };
  /* SPLASHSEAT: the table's list (every seat's panels, windows and chat column: seat-share.mjs) as zones of this window: each box as told
     (OWN_W) and a rim round it SHARE_REACH wide (RIM_W). The block goes with the roller, who stands up to SHARE_REACH off his cell's
     middle on a seat, while a panel stays where the window has it: a block clean of the rim here is off the panel itself on every seat of
     the cell. The rim weighs little: where nothing is clean the block rather stands in a rim than on a bystander */
  const zones = (sh?.rects ?? []).flatMap((q) => [{ ...q, w: OWN_W, at: 'seat' }, { l: q.l - SHARE_REACH, t: q.t - SHARE_REACH, r: q.r + SHARE_REACH, b: q.b + SHARE_REACH, w: RIM_W, at: 'seat', rim: true }]);
  return { ...cv, cell: { zq, x: cx, y: cy }, hero: proj(hb), safe: band, avoid: [...sharedScreenAvoid(hero, false, targets, star, cv), ...zones], scene: (q) => ({ x: hb.x + (q.x - cx) / zq, y: hb.y + (q.y - cy) / zq }) };
}
/* SPLASHBLOCK: what a block really draws, part by part (the layout's px): each part's letters' boxes and their standing ink. The block's
   outline (rect) is the union of its parts with their entrance room: a split block's outline spans whatever its parts frame (live: the
   roll's critical framed the fighters, word above and caption below, and its outline covered the struck token and most of the view) */
/* SPLASHSEAT: a placed block moved in one piece (its items, its parts, its outline, its gauge) */
export const NUDGE = 16, NUDGE_MAX = 128, PART_NUDGE_MAX = 192;
function shiftPart(lay, i, dx, dy) {
  const mv = (q) => ({ ...q, l: q.l + dx, t: q.t + dy, r: q.r + dx, b: q.b + dy });
  const parts = lay.parts.map((q, j) => (j === i ? mv(q) : q));
  return { ...lay, items: lay.items.map((it, n) => (lay.pi[n] === i && it.x != null ? { ...it, x: it.x + dx, y: it.y + dy } : { ...it })), parts,
    rect: { ...lay.rect, l: Math.min(parts[0].l, parts[1].l), t: Math.min(parts[0].t, parts[1].t), r: Math.max(parts[0].r, parts[1].r), b: Math.max(parts[0].b, parts[1].b) },
    ...(lay.gauge && lay.gpi === i ? { gauge: { ...lay.gauge, x: lay.gauge.x + dx, y: lay.gauge.y + dy } } : {}),
    ...(Array.isArray(lay.d) && lay.d.length === 2 ? { d: lay.d.map((d, j) => (j === i ? { dx: d.dx + dx, dy: d.dy + dy } : d)) } : {}) };
}
function shiftLay(lay, dx, dy) {
  const mv = (q) => (q && Number.isFinite(q.l) ? { ...q, l: q.l + dx, t: q.t + dy, r: q.r + dx, b: q.b + dy } : q);
  return { ...lay, items: lay.items.map((it) => (it.x == null ? { ...it } : { ...it, x: it.x + dx, y: it.y + dy })), rect: mv(lay.rect), ...(lay.parts ? { parts: lay.parts.map(mv) } : {}),
    ...(lay.gauge ? { gauge: { ...lay.gauge, x: lay.gauge.x + dx, y: lay.gauge.y + dy } } : {}), ...(Array.isArray(lay.d) ? { d: lay.d.map((d) => ({ dx: d.dx + dx, dy: d.dy + dy })) } : {}) };
}
export function partBoxes(lay) {
  if (!lay?.items?.length) return lay?.rect && Number.isFinite(lay.rect.l) ? [{ ...lay.rect }] : [];
  const parts = lay.parts?.length === 2 ? lay.parts : [lay.rect], out = parts.map(() => ({ l: Infinity, t: Infinity, r: -Infinity, b: -Infinity }));
  const near = (x, y) => { let bi = 0, bd = Infinity; parts.forEach((q, i) => { const dd = Math.hypot(Math.max(0, q.l - x, x - q.r), Math.max(0, q.t - y, y - q.b)); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
  const pi = parts.length === 2 && lay.pi?.length === lay.items.length ? lay.pi : null;
  for (let n = 0; n < lay.items.length; n++) {
    const it = lay.items[n];
    if (!(it.w > 0) || it.x == null) continue;
    const r = out[pi ? pi[n] : near(it.x, it.y)], st = it.room?.stand ?? { l: 2, r: 2, u: 2, d: 2 };
    r.l = Math.min(r.l, it.x - it.w / 2 - st.l); r.r = Math.max(r.r, it.x + it.w / 2 + st.r); r.t = Math.min(r.t, it.y - it.h / 2 - st.u); r.b = Math.max(r.b, it.y + it.h / 2 + st.d);
  }
  if (lay.gauge) { const g = lay.gauge, r = out[pi && lay.gpi != null ? lay.gpi : near(g.x + g.w / 2, g.y + g.h / 2)]; r.l = Math.min(r.l, g.x); r.t = Math.min(r.t, g.y); r.r = Math.max(r.r, g.x + g.w); r.b = Math.max(r.b, g.y + g.h); }
  return out.filter((r) => Number.isFinite(r.l));
}
function sharedTokenBox(tok) { try { const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100; return projBox(docBox(tok, gs)); } catch (e) { return null; } }
/* CRITPEAK: is a token's document box (not its swaying mesh) inside the standard view of this view by at least half of it? */
export function mapScaleOk() {
  const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100;
  const zoom = Math.max(0.02, Number(C?.stage?.scale?.x) || 1), m = GRID_VH * gs * zoom / SP.REF_VH;
  return m >= LP.MAP_BAND[0] && m <= LP.MAP_BAND[1];
}
export function boardInView(tok) {
  const q = sharedTokenBox(tok);
  if (!q) return false;
  const s = SP.standardRect(window.innerWidth, window.innerHeight);
  const ix = Math.max(0, Math.min(q.r, s.r) - Math.max(q.l, s.l)), iy = Math.max(0, Math.min(q.b, s.b) - Math.max(q.t, s.t));
  return ix * iy >= 0.5 * Math.max(1, (q.r - q.l) * (q.b - q.t));
}
export function standardSafe(p = null) { return SP.standardRect(window.innerWidth, window.innerHeight, p); }   // p: the client point the moment describes
/* CAPSTAR: the star of the moment's impact cut-in (LP.starBox), from SHARED data only: the roll's first target with a token on the scene that
   the GM has not hidden, else the roller the blow comes from (the engine's starOf: target, else `from`), and the TABLE's strength of the impact
   (IP.impactFor at full Effects, the engine's stepOf). Null: no impact (a miss, an engine without the cut-in), no star token. -> { tok, step, max } */
export function starOf(ev, ctl) {
  try {
    const I = LE?.impact, max = Number(I?.limits?.cutMax);
    if (!(max > 0) || !ev || ev.fail) return null;
    const q = IP.impactFor(ev, { fx: 1 });
    if (!q) return null;
    const C = globalThis.canvas, get = (id) => C?.tokens?.get?.(id);
    let tok = (ctl.targets ?? []).map(get).find((t) => t && !t.destroyed && t.document && t.document.hidden !== true) ?? null;
    if (!tok) {
      const f = ctl.from && typeof ctl.from === 'object' ? ctl.from : (ctl.rollerId ? get(ctl.rollerId) : null);
      tok = f && !f.destroyed && f.document && f.document.hidden !== true ? f : null;
    }
    if (!tok) return null;
    const step = typeof I.stepOf === 'function' ? I.stepOf(q.magnitude) : (q.magnitude >= 0.85 ? 3 : 1);
    const fig = Number(I?.limits?.figScale);   // SAKUGATOKEN: an engine that draws its figures at their tokens' size says so
    return { tok, step, max, fig: Number.isFinite(fig) && fig > 0 ? fig : null };
  } catch (e) { return null; }
}
/* the star's cut-in box: c = its centre, size = its drawn size, u = the view's short side (one unit); weighed STAR_W, marked star */
const starAvoid = (st, c, size, u) => { const b = st && c ? LP.starBox(c, size, u, st.step, st.max, st.fig) : null; return b ? { ...b, w: LP.STAR_W, star: true } : null; };
function sharedScreenAvoid(hero, full, targets = [], star = null, cv = null) {
  const out = [];
  const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100;
  /* SPLASHBLOCK: cv = the canonical seat (canonSeat): its projection of a scene box, its zoom and its window; else this seat's live view */
  const projBox = cv?.proj ?? liveProj, W = cv?.W ?? window.innerWidth, H = cv?.H ?? window.innerHeight, zoomNow = cv?.zoom ?? (C?.stage?.scale?.x || 1);
  const sharedTokenBox = (tok) => { try { return projBox(docBox(tok, gs)); } catch (e) { return null; } };
  /* CAPSTAR: on this seat's screen the engine sizes the cut-in by THIS window's short side */
  if (star) { const q = sharedTokenBox(star.tok); const s = q && starAvoid(star, q, Math.max(q.r - q.l, q.b - q.t), Math.min(window.innerWidth, window.innerHeight)); if (s) out.push(s); }
  for (const t of C?.tokens?.placeables ?? []) {
    /* CRITPEAK (ADVX 3: the critical's caption lines across the target's face): the roll's target weighs as much as the hero, every other
       token is heavy too (a pin may give way, a token never) */
    try { const d = docOf(t); if (!d || d.hidden || sameTok(t, hero)) continue; const q = projBox(grow(docBox(t, gs), 0.06 * gs)); if (q) out.push({ ...q, w: targets.includes(t.id) ? LP.TARGET_W : LP.OTHER_W }); } catch (e) { /* one token */ }
  }
  for (const n of C?.notes?.placeables ?? []) { try { if (!docOf(n)) continue; const q = projBox(noteBox(n, gs)); if (q) out.push(q); } catch (e) { /* one pin */ } }
  for (const b of zoneBadges(zoomNow).shared) { const q = projBox(b); if (q) out.push({ ...q, w: BADGE_W }); }   // SPLASHCLEAR: the zone badges every seat sees
  for (const z of SP.panelZones(W, H)) out.push({ ...(cv ? { ...z, l: z.l + cv.ox, t: z.t + cv.oy, r: z.r + cv.ox, b: z.b + cv.oy } : z), w: UI_WEIGHT });   // the party panel's corner, the same zone on every seat
  if (full && hero) { const h = sharedTokenBox(hero); if (h) out.push({ ...grow(h, Math.max(10, 0.15 * (h.r - h.l))), w: 50 }); }   // the drawn art (hair, a fist) reaches past the token's box; the hero weighs most
  return out;
}
/* SPLASHSAME: the TABLE's frame of a screen moment (table px): the reference window (SP.REF_VW x SP.REF_VH) as it would stand round the roller
   at the board's reference scale (GRID_VH squares in SP.REF_VH: the map block's scale), built from documents alone: the roller's box, the
   tokens nobody hides (the roll's targets weigh most), the map pins, the hero of a critical. Every seat builds the same frame, whatever its
   window, zoom, pan, sidebar or panels, so every seat composes the same block (LP.composeMoment) and only places it (LP.seatPlace).
   hero: the token the moment describes; full: the critical (the hero is avoided, the block stands by him). -> { frame, hero (table px) } */
/* SPLASHSAME: the zooms (of the reference board scale) the table plans its block round the documents at */
export const TABLE_ZOOMS = Object.freeze([1, 0.75, 0.5]);
export function tableFrame(hero, full, targets = [], scale = 1, star = null) {
  const C = globalThis.canvas, gs = C?.dimensions?.size ?? C?.grid?.size ?? 100;
  const z = SP.REF_VH / (GRID_VH * gs), hb = docBox(hero, gs), cx = SP.REF_VW / 2, cy = SP.REF_VH / 2;
  const tp = (b) => ({ ...(b.x != null ? { x: (b.x - hb.x) * z + cx, y: (b.y - hb.y) * z + cy } : {}), l: (b.l - hb.x) * z + cx, t: (b.t - hb.y) * z + cy, r: (b.r - hb.x) * z + cx, b: (b.b - hb.y) * z + cy });
  /* the block is laid out in the standard view of a reference window whose middle is the roller (a seat looking straight at him); a seat
     whose view has less room round him (the roller near its edge, a small window, a closer zoom) moves or shrinks it there (LP.seatPlace) */
  const H = tp(hb), std = SP.standardRect(SP.REF_VW, SP.REF_VH), bw = std.r - std.l, bh = std.b - std.t;
  const avoid = [];
  /* a document's place round the roller at the seats' zooms too: a seat zoomed out from the reference (the roller smaller, his neighbours
     nearer on its screen; the block keeps its px size and its distance from his edge, seatPlace) meets them elsewhere. The table plans
     round them at TABLE_ZOOMS of the reference as well, each seen from the roller's edge as seatPlace places the block, so the seats at
     those zooms need not move it (samepic S1: every seat at zoom 1 moved the reference-zoom block off a neighbour) */
  const hh = { x: (H.r - H.l) / 2, y: (H.b - H.t) / 2 };
  const atZoom = (q, r) => {
    if (r === 1) return q;
    const cxq = (q.l + q.r) / 2 - cx, cyq = (q.t + q.b) / 2 - cy, w = (q.r - q.l) * r, h = (q.b - q.t) * r;
    /* where the seat's block stands against it: moved in by the roller's shrink along the part's side (seatPlace), so the copy reaches out
       by that shrink on its own side of the roller (a part beside him does not move along) */
    const x = cx + cxq * r, y = cy + cyq * r, ex = hh.x * (1 - r), ey = hh.y * (1 - r);
    return { l: x - w / 2 - (cxq < 0 ? ex : 0), t: y - h / 2 - (cyq < 0 ? ey : 0), r: x + w / 2 + (cxq > 0 ? ex : 0), b: y + h / 2 + (cyq > 0 ? ey : 0) };
  };
  const both = (q, w) => { for (const r of TABLE_ZOOMS) avoid.push({ ...atZoom(q, r), ...(w != null ? { w } : {}), ...(r === 1 ? { z1: true } : {}) }); };
  for (const t of C?.tokens?.placeables ?? []) {
    try { const d = docOf(t); if (!d || d.hidden || sameTok(t, hero)) continue; both(tp(grow(docBox(t, gs), 0.06 * gs)), targets.includes(t.id) ? LP.TARGET_W : LP.OTHER_W); } catch (e) { /* one token */ }
  }
  for (const n of C?.notes?.placeables ?? []) { try { if (docOf(n)) both(tp(noteBox(n, gs))); } catch (e) { /* one pin */ } }
  /* CAPSTAR: the star's cut-in, at each zoom the table plans round: its centre where the seat at that zoom has it (moved in toward the roller as
     atZoom moves a document), its size the engine's share of the reference window's short side (the cut-in is a share of the VIEW, not of the
     board: at a far zoom it is as big on the screen as at a close one) */
  if (star) {
    try {
      const sb = tp(docBox(star.tok, gs)), u = Math.min(SP.REF_VW, SP.REF_VH);
      for (const r of TABLE_ZOOMS) {
        const c = { x: cx + ((sb.l + sb.r) / 2 - cx) * r, y: cy + ((sb.t + sb.b) / 2 - cy) * r };
        const s = starAvoid(star, c, Math.max(sb.r - sb.l, sb.b - sb.t) * r, u);
        if (s) avoid.push({ ...s, ...(r === 1 ? { z1: true } : {}) });
      }
    } catch (e) { /* no star */ }
  }
  /* SPLASHCLEAR: the zone badges are NOT the table's obstacles (each seat keeps off them, sharedScreenAvoid): live (lane 5, the Warehouse's
     corner badges, the critical at zoom 0.35) the table's least-covering block took a bystander (46 % of his box) to spare two badges,
     and a seat near the table's zoom keeps that place (SPLASHSAME-7) */
  if (full) avoid.push({ ...grow(H, Math.max(10, 0.15 * (H.r - H.l))), w: 50 });
  /* the party panel's corner of the reference window (every seat keeps that zone: the table's block does not plan its caption into it) */
  for (const zn of SP.panelZones(SP.REF_VW, SP.REF_VH)) avoid.push({ ...zn, w: UI_WEIGHT });
  const frame = { vh: SP.REF_VH, ref: SP.REF_VH, px: 1, scale, safe: std, freeW: bw, freeH: bh, token: full ? null : H, avoid,
    gap: full ? 6 : Math.max(8, Math.round(0.08 * (H.r - H.l))), focus: { x: H.x, y: H.y } };
  return { frame, hero: H };
}
/* SPLASHSAME: this seat's place of the table's block: its roller (document box at its zoom), its free view (its window minus the bars every
   seat keeps, its open sidebar), the same documents as obstacles at its zoom, the party corner of a small window and, under the interface, its
   own panels (localScreen) */
/* SPLASHCLEAR: all of this seat's free view (client px): its window inside the bars it really has (the tool column, the hotbar and players list,
   the open sidebar; not the reserve band of the standard view), for a block that finds no clean place in the band (LP.seatPlace, last moves) */
function seatWide(lay) {
  try { measureArea(); const c = safeRect({ core: true, screen: lay === 'screen' }); return { l: c.l, t: Math.max(c.t, 10), r: Math.min(c.r, area.w - 14), b: c.b }; } catch (e) { return null; }
}
/* this seat's own limits (tier 3): screen = over everything, cut only by the window and the open sidebar (the layer's clip); ui = under
   the windows (the GM's desk is one); hud = under the bars, the panels and the resting dice */
export const UI_WINDOWS = ['#invincible-tactics-desk:not(.igd-collapsed) .igd'];
function boxesOf(sels, pad = 6) {
  const out = [];
  for (const sel of sels) { try { for (const e of document.querySelectorAll(sel)) { const q = e.getBoundingClientRect(); if (q && q.width > 0 && q.height > 0 && seenEl(e)) out.push({ l: q.left - pad, t: q.top - pad, r: q.right + pad, b: q.bottom + pad }); } } catch (e) { /* none */ } }
  return out;
}
/* this seat's band: its window minus the SAME reserve every seat keeps and minus its own core bars where those are wider (client px) */
function seatBand(screen = false) {
  measureArea();
  const vw = window.innerWidth, vh = window.innerHeight, win = { l: 2, t: 2, r: area.w - 2, b: vh - 2 };
  const band = { l: Math.max(win.l, SP.RESERVE.l), t: Math.max(win.t, SP.RESERVE.t), r: Math.min(win.r, vw - SP.RESERVE.r), b: Math.min(win.b, vh - SP.RESERVE.b) };
  if (band.r - band.l < 0.4 * vw || band.b - band.t < 0.4 * vh) Object.assign(band, win);   // a tiny window: the whole of it
  const core = safeRect({ core: true, screen }), m = meet(band, core);
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
/* SPLASHCLEAR: what pops up on ONE seat for a moment (the GM's director pill, a chat card the roll itself just popped up): it never moves
   that seat's screen block (SAMEPIC, check-fxld F4: the GM's picture = the players'), it steps back under the block instead (POPUP_YIELD,
   as a map layer's panels do: faded to a trace while the part is up, hovering brings it back) */
export const POPUPS = ['#mm-dir-bar', ...UI_RIGHT];
function seatPanels() { return [...uiAvoid(), ...boxesOf(UI_TOP)]; }
/* MAPSEAT: on a map layer this seat's own floating interface steps back while the board block is up (provisional MAPSEAT-2). A panel is
   HTML over the board: before, the GM's panels (the map meter, the challenges, the party cards, his desk, the scene list) moved and shrank
   HIS block only. Now the block stays the board's and a panel over any of its parts fades to a trace for the moment (hovering it brings it
   back, so the GM can still use it); the screen layer draws over the same panels (SAMEPIC-3), so both layers read alike. Foundry's edge
   bars (tool column, hotbar, players list, the open sidebar) do not fade: they are this seat's view edge (SP.mapSeat 'cut'). */
export const YIELD_PANELS = [...UI_AVOID, ...UI_TOP, '#mm-dir-bar', ...UI_RIGHT, ...UI_WINDOWS];
export const YIELD_CLASS = 'ins-yield';
function yieldPanels(ctl) {
  if (!ctl?.layout?.items?.length) return;
  const boxes = [];
  for (const it of ctl.layout.items) {
    const p = LP.PAD * (it.S || 0), q = { x: it.x - it.w / 2 - p, y: it.y - it.h / 2 - p }, q2 = { x: it.x + it.w / 2 + p, y: it.y + it.h / 2 + p };
    const a = ctl.shared ? toClient(q) : q, c = ctl.shared ? toClient(q2) : q2;
    if (a && c) boxes.push({ l: a.x, t: a.y, r: c.x, b: c.y });
  }
  ctl.yielded ??= new Set();
  /* the screen layer: only the pop-ups yield (its panels moved the block, SPLASHCLEAR-1) */
  for (const sel of ctl.shared ? YIELD_PANELS : POPUPS) {
    try {
      for (const e of document.querySelectorAll(sel)) {
        if (!e?.classList || ctl.yielded.has(e)) continue;
        const q = e.getBoundingClientRect?.();
        if (!q || !(q.width > 0) || !(q.height > 0)) continue;
        if (boxes.some((b) => b.l < q.right && b.r > q.left && b.t < q.bottom && b.b > q.top)) { e.classList.add(YIELD_CLASS); ctl.yielded.add(e); }
      }
    } catch (e) { /* a selector this Foundry does not know */ }
  }
}
function unyield(ctl) { for (const e of ctl?.yielded ?? []) { try { e.classList.remove(YIELD_CLASS); } catch (e2) { /* gone */ } } ctl?.yielded?.clear?.(); }
/* SPLASHCLEAR: a seat's own panel weighs OWN_W per px2 (a token 10 / 50, a pin 1): a panel is big, so any real overlap still is not clean and
   moves the block, but where nothing is clean a bystander's art is spared first (tried 2: the crowded board's pushed result moved from the
   party cards onto a bystander, 23 % -> 31 % of its box).
   Tokens hidden from the players (and zone badges shown to the GM only) are NOT obstacles of the GM's seat: tried, they moved the GM's block
   off the place every player kept (samepic S2: the GM's and the player's picture must be one), and the block's side on the GM's screen would
   still tell nothing to a player, but the table's one picture is the contract. Provisional SPLASHCLEAR-3 (combat-questions) */
export const OWN_W = 0.5;
/* lay: the layer this moment is drawn on (a map-layer seat whose moment has no board place draws it on the screen layer: CRITPEAK) */
function localScreen(lay = LAYER, sh = null, canon = false) {
  measureArea();
  /* over the interface (screen) and under the windows only (ui): this seat's window minus the SAME reserve band every seat keeps (Foundry's
     bars) and minus its open sidebar where that is wider, and its own panels (SPLASHCLEAR below; before, SAMEPIC-3 drew over them).
     Under the bars (hud) the block would be HIDDEN by anything of this seat: its real bars, panels and resting dice */
  const vw = window.innerWidth, vh = window.innerHeight, band = seatBand(lay === 'screen');
  /* a window smaller than the reference keeps the party corner where it really is on this window (it is moving the block anyway) */
  const small = vw < SP.REF_VW || vh < SP.REF_VH ? SP.panelZones(vw, vh, true).filter((z) => z.at === 'bl') : [];   // the party cards (over the scene list it is drawn on the screen layers)
  /* own: what of this seat would HIDE the block (SPLASHSAME: the table's place is never kept on it, LP.seatPlace) */
  /* SPLASHCLEAR (ADVS2 D4: the ordinary word over the GM's map meter and scene list, "1 IN 1296" on the challenges' panel and on the stunt
     card; the owner: a seat that cannot show a block clean may show it farther away but clean): on the screen layer too this seat's own
     panels (its party cards, map meter and filter, challenges, scene list rows, the GM's desk; its pop-ups yield instead: POPUPS) are
     things the block must not cover. They never change the TABLE's block (every seat composes the same one); a seat whose plain place lands
     on one moves that block away (LP.seatPlace: its side, then smaller, then farther), the same arrangement and ratios. Before (SAMEPIC-3)
     the screen layer drew over them. Provisional SPLASHCLEAR-1 */
  /* where nothing is clean, the block rather lies on a seat's own panel (OWN_W) than on a token the table needs to see (the panel is drawn
     under it and comes back when the moment is over) */
  const ownW = () => [...seatPanels(), ...boxesOf(UI_WINDOWS)].map((q) => ({ ...q, w: OWN_W }));
  /* SPLASHSEAT: with the table's list for this roll (sh: every seat's boxes, this seat's own among them as it told them) the seat keeps the
     block off THAT list, not off what it alone has: the same list on every seat of this window. canon: the canonical seat already weighs
     the list (canonSeat's zones); here it only says what the block must never stand on */
  if ((lay === 'screen' || lay === 'ui') && sh) { const o = sh.rects.map((q) => ({ ...q, w: OWN_W })); return { safe: band, avoid: canon ? small : [...small, ...o], own: o, told: true }; }
  if (lay === 'screen' || lay === 'ui') { const o = ownW(); return { safe: band, avoid: [...small, ...o], own: o }; }
  const own = [...seatOwn(), ...boxesOf(UI_WINDOWS), ...diceRects()];
  return { safe: band, avoid: own, own };
}
const meet = (a, b) => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
/* SPLASHSEAT: what stands on THIS seat's screen that lettering must not cover nor stand under, as this seat tells the table when a roll
   arrives (seat-share.mjs; main.mjs sends it). Client px of this window:
   - its panels (the party cards, the map's meter and filter, the challenges, the scene list's rows, the GM's desk and director bar);
   - its open windows (sheets, dialogs, journals: Foundry's framed applications that are rendered and not minimised; never the roll dialog,
     which is closing as its roll arrives);
   - the column its chat cards pop up in (the roll's own card pops up there when the dice stop, too late to be measured: the column is
     told whole; a seat with the chat open in the sidebar has no such column).
   -> { v, w, h, o: [[l, t, r, b]] } */
export const SHARE_PANELS = ['#mm-dir-bar'];
export const SHARE_COLUMN = '#chat-notifications';
export const SHARE_SKIP = ['roll-dialog'];   // window classes never told
function openWindows() {
  const out = [], seen = new Set();
  const add = (el) => {
    try {
      if (!el || seen.has(el) || SHARE_SKIP.some((c) => el.classList?.contains?.(c))) return;
      seen.add(el);
      const q = el.getBoundingClientRect?.();
      if (q && q.width > 0 && q.height > 0) out.push({ l: q.left - 6, t: q.top - 6, r: q.right + 6, b: q.bottom + 6 });
    } catch (e) { /* one window */ }
  };
  try { for (const app of globalThis.foundry?.applications?.instances?.values?.() ?? []) { if (app?.rendered && !app.minimized && app.hasFrame !== false && app.options?.window?.frame !== false) add(app.element); } } catch (e) { /* no such registry */ }
  try { for (const app of Object.values(globalThis.ui?.windows ?? {})) { if (app?.rendered && !app._minimized) add(app.element?.[0] ?? app.element); } } catch (e) { /* no old windows */ }
  return out;
}
function chatColumn() {
  try {
    const side = document.getElementById?.('sidebar')?.getBoundingClientRect?.();
    return boxesOf([SHARE_COLUMN]).filter((q) => !side || !(side.width > 0) || q.l + 6 < side.left - 1);
  } catch (e) { return []; }
}
export function seatReport() {
  const W = window.innerWidth, H = window.innerHeight;
  const o = [...seatPanels(), ...boxesOf([...SHARE_PANELS, ...UI_WINDOWS]), ...openWindows(), ...chatColumn()].map((q) => [q.l, q.t, q.r, q.b]);
  return Share.clean({ v: Share.VERSION, w: W, h: H, o }) ?? { v: Share.VERSION, none: true };
}
/* the table's list for a moment (its roll's id: main.mjs passes momentId, or shareId for a later part of the same roll), for this window */
function shareOf(ctl) {
  try { const id = ctl?.shareId ?? ctl?.momentId; return id ? Share.unionFor(id, window.innerWidth, window.innerHeight) : null; } catch (e) { return null; }
}
/* the last moments' layouts on this seat (for the checks and the live log): shared, or moved here and how */
const SAME_LOG = [];
export const sameLog = () => SAME_LOG.slice();
/* MAPSEAT: per map moment, this seat's rule (ok / cut / speck), the table's board block and this seat's view (scene px), the parts' px */
const SEAT_LOG = [];
export const seatLog = () => SEAT_LOG.slice();
function logSame(row) { SAME_LOG.push(row); if (SAME_LOG.length > 20) SAME_LOG.shift(); }
/* compose: measure, lay out, and (when the block had to go below or beside the token) measure again with the sound coming from there */
function compose(ctl, items, extra = {}) {
  const vh = window.innerHeight, k = Number(LE?.prefs?.scale) > 0 ? Number(LE.prefs.scale) : 1;
  let frame, tab = null;
  if (ctl.shared) {
    /* a critical on the map is a board moment like the others (live: sized to fill a share of a 16:9 'screen' of the board, it went
       two tokens away and past every seat's view): still the biggest word, but anchored by the hero */
    /* CRITPEAK: no width fill on the board; its size is its rank's (LP.RANK_WORD), held readable at this view's zoom (sharedFrame). Before,
       MAP_CRIT_CAP (0.14 of the board height) put the critical under an ordinary roll's word (ADVX 2: 84 vs 137 scene px) */
    items = items.map((it) => (it.wMin ? { ...it, wMin: 0 } : it));   // a copy: a block that falls back to the screen keeps its width fill
    /* the map: scene units, nothing of this seat but its view (the engine's Scale is divided out again in letterOne: the drawn size is S) */
    const g = extra.gauge && ctl.gaugeK ? { w: extra.gauge.w * ctl.gaugeK, h: extra.gauge.h * ctl.gaugeK } : extra.gauge;
    const sf = sharedFrame(ctl.hero, ctl.targets ?? [], ctl.star);
    frame = { ...sf, scale: ctl.userScale || 1, ...extra, ...(g ? { gauge: g } : {}) };   // SIZEDEAD: the table's Size on the board too (it was 1 there: the choice did nothing on a map layer)
  } else {
    /* SAMEPIC: the shared frame (see sharedScreenAvoid): reference height, the table's Scale only (the engine's own Scale is divided out
       in letterOne, as on the map), the standard view, the token's document box, shared obstacles */
    const T = ctl.token ? sharedTokenBox(ctl.token) : null, std = standardSafe(T);
    /* SPLASHSAME: a moment by its roller (a token moment, or the critical with its hero) whose roller stands in this seat's window: the
       TABLE's block (tableFrame: the same on every seat), placed on this seat (LP.seatPlace). Without a roller in the window (none, unseen,
       off this seat's screen) the moment is this seat's own, laid out round its view as before */
    /* SPLASHBLOCK: the roller where the view the moment is shown on has him (planView: the action camera's shot, else the live view) */
    const pv = planView(), gsA = globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100;
    const anchor = ctl.token ?? (ctl.full ? ctl.hero : null);
    let A = null;
    if (anchor) { try { const hb = docBox(anchor, gsA), c = planClient({ x: hb.x, y: hb.y }, pv); A = c && Number.isFinite(c.x) ? c : null; } catch (e) { A = null; } }
    if (A && A.x >= 0 && A.y >= 0 && A.x <= window.innerWidth && A.y <= window.innerHeight && globalThis.canvas?.ready) {
      const tf = tableFrame(anchor, !ctl.token, ctl.targets ?? [], ctl.userScale || 1, ctl.star);
      frame = { ...tf.frame, ...extra };
      tab = { hero: tf.hero, at: A, zq: quantZoom(pv.scale), anchor };   // (not in the frame: the kept layout is the table's, whatever the view)
    } else frame = { vh: SP.REF_VH, ref: SP.REF_VH, px: 1, scale: ctl.userScale || 1, safe: std, token: T, avoid: sharedScreenAvoid(ctl.hero, !ctl.token, ctl.targets ?? [], ctl.star),
      gap: T ? Math.max(8, Math.round(0.08 * (T.r - T.l))) : 6, focus: { x: (std.l + std.r) / 2, y: vh * (ctl.full ? 0.47 : 0.42) }, ...extra };
  }
  let out = composeIn(ctl, items, frame), same = 'none', why = null, fit = null;  if (ctl.shared) {
    /* MAPSEAT: the map block is the board's: laid out once from what every seat shares (sharedFrame, the board window) and never moved,
       shrunk or laid out again by one seat's view, window or panels. Before (FXI-SPLASH + SAMEPIC + CRITPEAK) it was laid out again inside
       this seat's standard view, shrunk into the part of the scene this view shows and moved off this seat's own panels: one roll, another
       block per zoom and per seat (live: the GM's critical 99-113 px against the player's 120.5, a strong roll 63-68 against 83).
       fit = what this seat shows of the board (its window minus Foundry's bars where they stand, in scene px): only the seat's layer rule
       reads it (playLetters, SP.mapSeat) */
    fit = sceneRectOf(safeRect({ core: true }));
  } else if (tab) {
    /* SPLASHSAME: the table's block (composed above from the table's frame), placed on this seat */
    const lay = WORLD_LAYERS.includes(LAYER) ? 'screen' : LAYER;
    const tableOut = out, tb = tab;
    /* SPLASHBLOCK: the canonical seat of this view (shared: documents, zoom step, window size, the roller's cell) */
    /* SPLASHSEAT: the table's list of what stands on the seats' screens for this roll (null: nobody told, a preview: this seat's own, as before) */
    const sh = shareOf(ctl);
    const cs = canonSeat(tb.anchor, ctl.targets ?? [], ctl.star, tb.zq, window.innerWidth, window.innerHeight, tb.at, ctl.cell, sh);
    ctl.cell = cs.cell;
    const T1 = { ...tableOut, hero: tb.hero, ref: frame.ref, scale: frame.scale, tsafe: frame.safe, avoid1: frame.avoid.filter((q) => q.z1) };
    const worst = (m) => m === 'least' || m === 'swapped';
    /* ... and this seat: the shared things as the canonical seat has them, moved with the roller to where he stands here (a few px of
       camera drift do not weigh another cover), its own view and panels */
    const dx = tb.at.x - (cs.hero.l + cs.hero.r) / 2, dy = tb.at.y - (cs.hero.t + cs.hero.b) / 2;
    /* (a window's own zone, the party corner, stays where this window has it) */
    const mvq = (q) => q.at ? { ...q, l: q.l - cs.ox, t: q.t - cs.oy, r: q.r - cs.ox, b: q.b - cs.oy } : ({ ...q, l: q.l + dx, t: q.t + dy, r: q.r + dx, b: q.b + dy, ...(q.x != null ? { x: q.x + dx, y: q.y + dy } : {}) });
    const loc = localScreen(lay, sh, true), T2 = mvq(cs.hero);
    const seat = { hero: T2, safe: loc.safe, wide: seatWide(lay), avoid: [...cs.avoid.map(mvq), ...loc.avoid], own: loc.own ?? [], gap: frame.gap };   // the table's gap to the roller
    /* SPLASHBLOCK 0: a seat on which the table's block holds where the table set it shows exactly that (SPLASHSAME: every such seat the
       same block round the roller); the steps below are for a seat that has to move it */
    /* SPLASHSEAT: with the table's list (loc.told) the block is decided on the canonical seat ALONE (shared inputs only: this seat's live
       view, a few px off another seat's, never chooses between two places) and shown here moved with the roller; this seat searches by
       itself only when it cannot show that block at all (its letters outside its view) */
    let own = loc.told ? null : seatPlaceKept(T1, { ...seat, plainOnly: true });
    const placeC2 = (avoid, ownL, more = {}) => seatPlaceKept(T1, { hero: cs.hero, safe: cs.safe, wide: null, avoid, own: ownL, gap: frame.gap, ...more });
    const placeC = (avoid, ownL) => placeC2(avoid, ownL);
    let c1;
    if (own) c1 = own;
    else if (!loc.told) c1 = placeC(cs.avoid, []);
    else {
      /* SPLASHSEAT, with the table's list:
         1 the block the canonical seat places WITHOUT the list (what every seat showed before, from the documents alone): where it
           stands off every told box and rim, that is the block (the same picture as without any panel, one search);
         2 else a CLEAN place off the list, the told boxes (OWN_W; never kept on one: own) and their rims;
         3 else a clean place off the boxes themselves (on a seat whose roller stands off his cell's middle its edge may then reach up
           to SHARE_REACH into a panel's edge);
         4 nothing clean of the boxes: the block of step 1 moved in ONE piece the least way (steps of NUDGE px, NUDGE_MAX at most) to
           where it covers least, weighed one way (every part's box against the tokens, pins, stars and the told boxes; the roller as
           a star); then a block in two parts has each part moved by itself the same way (PART_NUDGE_MAX), and a block in one part
           that still lies on a told box takes the least-covering search with the boxes, where that covers less.
         Steps 2 and 3 are skipped where step 1 found nothing clean (a place clean with the list is clean without it). The
         least-covering search with the list is the dear one for a block in two parts (live, a critical: 1.9-3 s in one task while the
         dice rolled, its pair search prunes by the best sum, which the zones raise everywhere; 0.14 s without the list): it is never
         run for one; for a block in one part once at most, without the rims, and only where it would otherwise lie on a panel */
      const noList = cs.avoid.filter((q) => !q.at), noRim = cs.avoid.filter((q) => !q.rim), zones = cs.avoid.filter((q) => q.at), boxes = zones.filter((q) => !q.rim);
      const on = (c, list) => partBoxes(c).reduce((sum, q) => sum + LP.blockHits(q, list), 0);
      const c0 = placeC(noList, []);
      if (on(c0, zones) <= 0.5) c1 = c0;
      else {
        c1 = worst(c0.moved) ? null : (placeC2(cs.avoid, loc.own, { cleanOnly: true }) ?? placeC2(noRim, loc.own, { cleanOnly: true }));
        if (!c1) {
          const onHero = (q) => Math.max(0, Math.min(q.r, cs.hero.r) - Math.max(q.l, cs.hero.l)) * Math.max(0, Math.min(q.b, cs.hero.b) - Math.max(q.t, cs.hero.t)) * LP.TOKEN_W;
          const costOf = (qs) => qs.reduce((sum, q) => sum + LP.blockHits(q, noRim) + onHero(q), 0);
          const pb = partBoxes(c0), inBand = (q) => q.l >= cs.safe.l - 1 && q.t >= cs.safe.t - 1 && q.r <= cs.safe.r + 1 && q.b <= cs.safe.b + 1;
          let best = { dx: 0, dy: 0, v: costOf(pb) };
          for (let dy = -NUDGE_MAX; dy <= NUDGE_MAX; dy += NUDGE) for (let dx = -NUDGE_MAX; dx <= NUDGE_MAX; dx += NUDGE) {
            if (!dx && !dy) continue;
            const qs = pb.map((q) => ({ l: q.l + dx, t: q.t + dy, r: q.r + dx, b: q.b + dy }));
            if (!qs.every(inBand)) continue;
            const v = costOf(qs);
            if (v < best.v - 0.5 || (Math.abs(v - best.v) <= 0.5 && Math.hypot(dx, dy) < Math.hypot(best.dx, best.dy) - 0.5)) best = { dx, dy, v };
          }
          c1 = best.dx || best.dy ? shiftLay(c0, best.dx, best.dy) : c0;
          const split = c1.parts?.length === 2 && c1.pi?.length === c1.items.length;
          if (split) {
            /* a block in two parts (a critical): each part in turn (the caption first) moved by itself the least way to where the two
               cover least, never onto the other part (its box weighs like a star) nor past it (the caption stays on its side of the
               word, up or down). Cheap: boxes only */
            for (const i of [1, 0]) {
              const qb = partBoxes(c1), me = qb[i], other = qb[1 - i], side = Math.sign((me.t + me.b) - (other.t + other.b));
              const onOther = (q) => Math.max(0, Math.min(q.r, other.r) - Math.max(q.l, other.l)) * Math.max(0, Math.min(q.b, other.b) - Math.max(q.t, other.t)) * LP.TOKEN_W;
              const cost1 = (q) => costOf([q]) + onOther(q);
              let b1 = { dx: 0, dy: 0, v: cost1(me) };
              for (let dy = -PART_NUDGE_MAX; dy <= PART_NUDGE_MAX; dy += NUDGE) for (let dx = -PART_NUDGE_MAX; dx <= PART_NUDGE_MAX; dx += NUDGE) {
                if (!dx && !dy) continue;
                const q = { l: me.l + dx, t: me.t + dy, r: me.r + dx, b: me.b + dy };
                if (!inBand(q) || Math.sign((q.t + q.b) - (other.t + other.b)) !== side) continue;
                const v = cost1(q);
                if (v < b1.v - 0.5 || (Math.abs(v - b1.v) <= 0.5 && Math.hypot(dx, dy) < Math.hypot(b1.dx, b1.dy) - 0.5)) b1 = { dx, dy, v };
              }
              if (b1.dx || b1.dy) c1 = shiftPart(c1, i, b1.dx, b1.dy);
            }
          } else if (on(c1, boxes) > 0.5) { const cL = placeC2(noRim, loc.own); if (costOf(partBoxes(cL)) < costOf(partBoxes(c1)) - 0.5) c1 = cL; }
          /* (it stands on something told, or by a rim: 'least' for the log, the checks and this seat, which shows it as it is) */
          if (!worst(c1.moved)) c1 = { ...c1, moved: 'least' };
        }
      }
    }
    /* SPLASHBLOCK 1: else the block the canonical seat places (c1); SPLASHBLOCK 2: shown here as it is, or moved in one piece (never searched again from where the canonical seat left it: two
       searches one after the other carried a block from over the roller to beside him) */
    out = own ?? seatPlaceKept({ ...c1, hero: cs.hero, ref: frame.ref, scale: frame.scale, tsafe: cs.safe, avoid1: cs.avoid, rigid: true },
      /* (weighed here: the documents, moved with the roller, and this seat's own panels; the window's shared corner zone was weighed on
         the canonical seat, a few px away) */
      { ...seat, ...(loc.told ? { own: [] } : {}), avoid: cs.avoid.filter((q) => !q.at).map(mvq), rigidOnly: true, slack: SNAP / 2 + CELL_HOLD + 1, asIs: worst(c1.moved) });
    /* SPLASHBLOCK 3: a seat that cannot take it so (its own panel under a clean block, its edge), or whose canonical seat found nothing
       clean while its own view has a clean place (the owner: farther away but clean before anything is covered), places the table's block
       itself, as before. Where neither has a clean place the canonical block stands as it is (asIs: seen live, each seat searched by itself
       for the few per cent less it covered there, and two seats on one shot showed two arrangements) ... */
    let dbg = null;
    if (!out || (worst(c1.moved) && !loc.told)) {
      const alt = seatPlaceKept(T1, seat), toks = { token: seat.hero, avoid: seat.avoid.filter((q) => q.x != null && !q.at) };
      /* (... unless this seat's own search keeps every token free, CANON_FREE of a token's box at most, where the canonical block lies
         on one, over CANON_COVER of it: the roller a few px off his cell's middle can leave the canonical seat less room than this seat has) */
      if (Array.isArray(globalThis.__splashFit)) dbg = { rigid: out ? out.moved : null, c1hit: c1.hit ?? null, alt: alt.moved, althit: alt.hit ?? null, cov: [LP.coverMax(alt, toks), out ? LP.coverMax(out, toks) : null], own: seat.own.length };
      if (!out || !worst(alt.moved) || (LP.coverMax(alt, toks) <= CANON_FREE && LP.coverMax(out, toks) > CANON_COVER)) out = own = alt;
    }
    out.table = { rect: tableOut.rect, side: tableOut.side, split: !!tableOut.split };
    /* the block as this seat shows it, part by part in scene px of the planned view (the token reactions plan round it: the same rects on
       every seat that shows the canonical block) */
    /* (seen live, two seats on one shot: a canonical block shifted a few px into each seat's view gave the reactions two rects a few px
       apart, and a reaction another side per seat: the rect told is the CANONICAL block's, before this seat's shift; the drawn block still
       pushes this seat's word live) */
    const via = !own ? 'canon' : own === c1 ? 'table' : 'own', told = via === 'canon' ? partBoxes(c1) : null, shown = partBoxes(out);
    const sceneOf = (q, ox, oy) => { const a = cs.scene({ x: q.l - ox, y: q.t - oy }), c = cs.scene({ x: q.r - ox, y: q.b - oy }); return { l: a.x, t: a.y, r: c.x, b: c.y }; };
    out.canon = { moved: c1.moved, own: !!own, via, zq: tb.zq, told: sh ? sh.seats : 0, scene: told && told.length === shown.length ? told.map((q) => sceneOf(q, 0, 0)) : shown.map((q) => sceneOf(q, dx, dy)) };
    /* a live probe may collect how each seat got its block (set globalThis.__splashFit = [] in a console); nothing is kept otherwise */
    if (Array.isArray(globalThis.__splashFit)) globalThis.__splashFit.push({ dbg, via, told: sh ? [sh.seats, sh.rects.length] : null, c1: c1.moved, seat: out.moved, hit: out.hit ?? null, zq: tb.zq, at: tb.at, cell: { x: (cs.hero.l + cs.hero.r) / 2, y: (cs.hero.t + cs.hero.b) / 2 }, scene: out.canon.scene, shown });
    /* how this seat got it, for the log and the checks: 'swapped', then 'least' (nothing clean: on either step) first, then this seat's
       own move, then the canonical seat's */
    const ms = own ? [own.moved] : [out.moved, c1.moved];
    same = ms.includes('swapped') ? 'swapped' : ms.includes('least') ? 'least' : ms[0] !== 'none' ? ms[0] : ms.at(-1);
    out.moved2 = out.moved; out.moved = same;
    if (same !== 'none') why = whyMoved(tableOut.rect, { safe: seat.safe, avoid: [] });
    frame = { ...frame, safe: seat.safe, token: ctl.full ? null : seat.hero, avoid: seat.avoid, gap: seat.gap };
  } else {
    const loc = localScreen(WORLD_LAYERS.includes(LAYER) ? 'screen' : LAYER, shareOf(ctl)), std = frame.safe;   // CRITPEAK: off the board it is drawn on the screen layer
    why = whyMoved(out.rect, loc);
    const fx = LP.localFix(out, frame, loc, std, () => composeIn(ctl, items, { ...frame, safe: meet(std, loc.safe), avoid: [...frame.avoid, ...loc.avoid] }));
    out = fx.out; same = fx.moved;
  }
  out.k = k; out.frame = frame; out.same = same; out.fit = fit;
  if (!ctl.dry) logSame({ id: ctl.momentId ?? ctl.seed, layer: LAYER, shared: !!ctl.shared, moved: same, told: out.canon?.told ?? (shareOf(ctl)?.seats ?? 0), via: out.canon?.via ?? null, ...(same !== 'none' && why ? { why } : {}), star: ctl.star ? { id: ctl.star.tok?.id ?? null, step: ctl.star.step } : null, tok: frame.token ? [Math.round(frame.token.l), Math.round(frame.token.t)] : null, rect: out.rect ? { l: Math.round(out.rect.l), t: Math.round(out.rect.t), r: Math.round(out.rect.r), b: Math.round(out.rect.b) } : null });
  return out;
}
/* CRITLATE (live: a critical's layout took 0.4-0.55 s in ONE task, run on the moment's own instant, so its word was called 52-479 ms after
   its start, without its entrance, and its impact frame was cut or lost): the layout of a moment is a pure function of what it is given (the
   items, the frame, the engine's answers), so it is kept by that input. prepare() lays the moment out ahead, while the dice still roll; at the
   instant play() finds the same input and takes the kept layout (a copy: the caller moves its parts). Any input that changed (a token moved,
   the view panned, another window) is a new key: laid out afresh, as before. */
const LAYOUT_MEMO = new Map(), LAYOUT_MAX = 24;
export const layoutStats = { fresh: 0, reused: 0, ms: 0, seatFresh: 0, seatKept: 0, seatMs: 0, seatUnkeyed: 0 };
const plainItem = (it) => { const o = {}; for (const k of Object.keys(it)) if (k[0] !== '_') o[k] = it[k]; return o; };
/* ROLLSTALL (live, two seats, a crowded board: the table's block was kept by its input since CRITLATE, but its PLACING on the seat
   (LP.seatPlace: the canonical seat's search, then this seat's) was worked out again on every layout: while the dice rolled, again when the
   instant was known, and a third time ON the instant, 0.2-0.8 s in one task each; the critical's word and its impact were called 0.2-1 s
   after their start, 5-14 of the impact's 19 drawings shown). LP.seatPlace is a pure function of the table's block and the seat it is given:
   its answer is kept by that exact input, like the layout itself. At the instant play() takes what prepare() worked out; an input that
   changed (the roller moved, the view panned, a panel opened) is a new key: placed afresh, as before. What is kept is only what seatPlace
   itself sets (a copy each time: the caller writes on it); everything else of the answer is the table handed in, as seatPlace returns it.
   A live probe of the placing (globalThis.__splashFit) always places afresh. */
const SEAT_MEMO = new Map(), SEAT_MAX = 96;
const SEAT_SET = ['items', 'rect', 'parts', 'pi', 'gpi', 'rel', 'gauge', 'k', 'moved', 'd', 'f', 'hit'];
const seatCopy = (v) => (Array.isArray(v) ? v.map(seatCopy) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).map((k) => [k, seatCopy(v[k])])) : v);
function seatPlaceKept(table, seat) {
  let key = null;
  if (!Array.isArray(globalThis.__splashFit)) {
    try { key = memoKey([{ ...table, items: table.items.map(plainItem) }, seat]); } catch (e) { key = null; }
    if (!key) layoutStats.seatUnkeyed++;
  }
  const kept = key ? SEAT_MEMO.get(key) : undefined;
  if (kept !== undefined) {
    SEAT_MEMO.delete(key); SEAT_MEMO.set(key, kept);
    layoutStats.seatKept++;
    if (kept === null) return null;
    /* each line is the one handed in now (its engine marks and inner objects as seatPlace passes them on), at its kept place and size */
    return { ...table, ...seatCopy(kept), items: table.items.map((it, n) => ({ ...it, ...kept.items[n] })) };
  }
  /* CRITFREEZE: the search itself in steps (a sliced prepare takes as many as its slot holds and goes on from there in its next one; the
     table handed in when the search began is the one it ends on: the same input by its key) */
  const run = stepped(SEAT_STEPS, key, () => ({ g: LP.seatPlaceSteps(table, seat), table }), (ms) => { layoutStats.seatMs += ms; });
  const out = run.value, mine = run.own.table === table;
  layoutStats.seatFresh++;
  if (key) {
    const table0 = table;
    table = run.own.table;
    let v = null;
    if (out) { v = {}; for (const k of SEAT_SET) if (Object.prototype.hasOwnProperty.call(out, k) && out[k] !== table[k]) v[k] = out[k]; v = seatCopy(v); v.items = out.items.map((it, n) => { const src = table.items[n], o = {}; for (const k of ['x', 'y', 'S', 'w', 'h']) if (it[k] !== src[k]) o[k] = it[k]; return o; }); }
    SEAT_MEMO.set(key, v);
    if (SEAT_MEMO.size > SEAT_MAX) SEAT_MEMO.delete(SEAT_MEMO.keys().next().value);
    table = table0;
    /* (a search begun in an earlier slot ran on that slot's copy of the table: handed out as a kept placing is, on the table given now) */
    if (!mine) return v === null ? null : { ...table, ...seatCopy(v), items: table.items.map((it, n) => ({ ...it, ...v.items[n] })) };
  }
  return out;
}
const copyLayout = (out) => out && {
  ...out, items: out.items.map((it) => ({ ...it })), rect: out.rect && { ...out.rect }, gauge: out.gauge && { ...out.gauge },
  ...(out.parts ? { parts: out.parts.map((q) => ({ ...q })) } : {}), ...(out.foot ? { foot: { ...out.foot } } : {})
};
function composeIn(ctl, items, frame) {
  const key = memoKey([engineKey(), ctl.seed, !!ctl.shared, items.map(plainItem), frame]);
  const kept = key ? LAYOUT_MEMO.get(key) : null;
  if (kept) {
    LAYOUT_MEMO.delete(key); LAYOUT_MEMO.set(key, kept);
    kept.marks.forEach(([o, m], i) => { if (items[i]) { items[i]._o = o; items[i]._m = m; } });   // as the measuring left them
    layoutStats.reused++;
    return copyLayout(kept.out);
  }
  /* CRITFREEZE: the measuring and the search in steps (a sliced prepare takes as many as its slot holds and goes on from there in its next
     one, on the items handed in when the layout began: the same input by its key) */
  const seed = ctl.seed, map = !!ctl.shared;
  const run = stepped(LAYOUT_STEPS, key, () => ({ g: composeSteps(items, frame, seed, map), items }), (ms) => { layoutStats.ms += ms; });
  const out = run.value, done = run.own.items;
  layoutStats.fresh++;
  if (key && out) {
    const kept = { out: copyLayout(out), marks: done.map((it) => [it._o, it._m]) };
    LAYOUT_MEMO.set(key, kept);
    if (LAYOUT_MEMO.size > LAYOUT_MAX) LAYOUT_MEMO.delete(LAYOUT_MEMO.keys().next().value);
    /* (a layout begun in an earlier slot ran on that slot's items: handed out as a kept layout is, on the items given now) */
    if (done !== items) { kept.marks.forEach(([o, m], i) => { if (items[i]) { items[i]._o = o; items[i]._m = m; } }); return copyLayout(kept.out); }
  } else if (done !== items) done.forEach((it, i) => { if (items[i]) { items[i]._o = it._o; items[i]._m = it._m; } });
  return out;
}
function* composeSteps(items, frame, seed, map) {
  const anchored = !!frame.token;
  let side = 'above', out = null;
  for (let pass = 0; pass < 2; pass++) {
    yield* measureSteps(items, { seed, from: anchored ? SIDE_FROM[side] : null, map });
    out = yield* LP.composeMomentSteps(items, frame, measureFn);
    if (!anchored || out.side === side) break;
    side = out.side;
  }
  return out;
}
/* CRITFREEZE (live, two seats, The Warehouse: laid out ahead while the dice rolled, a critical's layout held the page 176-218 ms in one
   task, then twice more 70-175 ms: the prepare was cut BETWEEN its layouts only, and one layout of a critical is 0.15-0.45 s). One unit of
   layout work (a block composed, a block placed on the seat) is a generator of steps (LP.composeMomentSteps, LP.seatPlaceSteps): a few ms
   each. Unsliced (the play, the prepare with the instant) it runs to its end here, as before. In a sliced prepare it runs until the slot
   is used up (always one step at least), is put by under its input's key and PREP_YIELD ends the slot; the next slot comes back to the
   same key (everything before it is kept) and goes on from that step. Whoever asks for the same input unsliced meanwhile (the instant
   came) finishes what is left. The answer is the search's own, whatever the slots: nothing is read between two steps that the search did
   not already hold. Without a key (a live probe, an input that cannot be keyed) there is nothing to come back to: run to the end.
   -> { value, own: what make() made (the generator's own input) } */
const LAYOUT_STEPS = new Map(), SEAT_STEPS = new Map(), STEPS_MAX = 6;
export const stepStats = { slots: 0, steps: 0, worst: 0 };   // (for the checks and a live probe: slots ended early, steps taken, the longest step in ms)
function stepped(pending, key, make, spent) {
  let own = key ? pending.get(key) : null;
  /* a slot already used up by what came before this unit: the unit begins in the next one (a slot that did nothing yet takes one step) */
  if (prepDeadline != null && key && prepDid && performance.now() > prepDeadline) throw PREP_YIELD;
  if (!own) own = make();
  const t0 = performance.now();
  let t1 = t0;
  try {
    for (;;) {
      const r = own.g.next();
      prepDid = true;
      const t = performance.now();
      stepStats.steps++; if (t - t1 > stepStats.worst) stepStats.worst = t - t1;
      t1 = t;
      if (r.done) { if (key) pending.delete(key); return { value: r.value, own }; }
      if (prepDeadline != null && key && t > prepDeadline) {
        pending.delete(key); pending.set(key, own);
        if (pending.size > STEPS_MAX) pending.delete(pending.keys().next().value);
        stepStats.slots++;
        throw PREP_YIELD;
      }
    }
  } catch (e) {
    if (e !== PREP_YIELD && key) pending.delete(key);   // a search that failed is not gone on with
    throw e;
  } finally { spent(performance.now() - t0); }
}
/* a client rect in scene px (null when the canvas cannot say) */
function sceneRectOf(s) {
  try {
    const a = toScene({ x: s.l, y: s.t }), c = toScene({ x: s.r, y: s.b });
    return a && c && c.x > a.x && c.y > a.y ? { l: a.x, t: a.y, r: c.x, b: c.y } : null;
  } catch (e) { return null; }
}

function wrapEl() {
  const w = document.createElement('div'); w.className = 'ins-letters';
  w.style.setProperty('--u', String(Math.max(0.7, Math.min(1.6, SP.REF_VH / 768)).toFixed(3)));   // SAMEPIC: the reference height, not this window's
  ensureLayer().appendChild(w);
  return w;
}
function letterWrap(ctl) {
  if (ctl.lw?.isConnected) return ctl.lw;
  const w = wrapEl();
  ctl.lw = w; ctl.letters = []; ctl.hands = [];
  ctl.el.classList.add('lettered');
  return w;
}
/* one placed lettering (composeMoment item) -> L.play; seed = message id + role, so every client letters it alike */
/* CRITLATE: the contact (ms after its start) of the plan the engine makes for a lettering's options, kept by that input (the plan does not
   depend on the start instant: not in the key). letterOne asks it for the struck word at the moment's instant; prepare() asks it ahead.
   -> { c } (c = IP.contactMs of the plan) or null when the engine made no plan */
const CONTACT_MEMO = new Map(), CONTACT_MAX = 120;
function contactOf(text, o) {
  const key = memoKey([engineKey(), text, { ...o, startAt: undefined, parent: !!o.parent, token: o.token?.id ?? o.token ?? null }]);
  if (key && CONTACT_MEMO.has(key)) return CONTACT_MEMO.get(key);
  const r = LE?.planFor ? LE.planFor(text, o) : null;
  /* (p: what L.contactAt reads of that plan, for the impact asked ahead: ROLLSTALL, armEarly) */
  const v = r?.plan ? { c: IP.contactMs(r.plan), p: { timeline: true, contactMs: r.plan.contactMs, motion: r.plan.motion ? { mode: r.plan.motion.mode, in: r.plan.motion.in } : undefined } } : null;
  if (key) { CONTACT_MEMO.set(key, v); if (CONTACT_MEMO.size > CONTACT_MAX) CONTACT_MEMO.delete(CONTACT_MEMO.keys().next().value); }
  return v;
}
/* one placed lettering's engine options (letterOne; prepare() for the struck word's contact): the place, size, layer and the table's options */
function letterOpts(ctl, it, lw) {
  const o = { ...(it._o ?? engineOpts(it, { seed: ctl.seed, map: !!ctl.shared }, ctl.hands ?? [])) };
  o.avoid = [...new Set([...(o.avoid ?? []), ...(ctl.hands ?? [])])];   // the hands measured first are the real ones; the played ones join (a set: same choice)
  /* DIRECT: an attack's word grows away from the roller, toward the target. Played with it, laid out without it (as before): measured with
     it, the grown word's wider entrance sent a crowded far seat's board block to its screen, bigger than the critical (splashsame S4) */
  if (Number.isFinite(it.dirFrom)) o.from = it.dirFrom;
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
  const struck = it.role === 'word' && !!(ctl.impactTiming ?? ctl.impactPlan) && !ctl.impact && !!LE?.impact?.play;
  if (struck && ctl.impactPlan) o.flash = false;
  const tableOpts = { ...o, reduced: false };
  if (struck && ctl.impactTiming) tableOpts.flash = false; else if (!struck) delete tableOpts.flash;
  return { o, world, struck, tableOpts };
}
/* ROLLSTALL: when a lettering starts against the table's contact, and its impact's shot (letterOne's own lines, moved here unchanged so
   that the impact asked ahead, armEarly, reads the very same instants). Sets o.startAt (given as the moment's zero + the item's delay + the
   lead); for the struck word also ctl.wordAt and ctl.contactAt. -> { shot } */
function strikeAt(ctl, it, o, tableOpts, struck) {
  const rm = {};
  if (LE?.planFor && (o.reduced || o.flash !== tableOpts.flash)) try {
    const a = contactOf(LP.letterable(it.text), o), b = contactOf(LP.letterable(it.text), tableOpts);
    if (a && b) { rm.own = a.c; rm.table = b.c; if (Number.isFinite(rm.own) && Number.isFinite(rm.table)) o.startAt += rm.table - rm.own; }
  } catch (e) { /* its own entrance on the shared start */ }
  let shot = null;
  if (struck) {
    let contact = it._m?.contact ?? 0;
    try { const r = contactOf(LP.letterable(it.text), o); if (r) contact = r.c; } catch (e) { /* the measured one */ }
    const own = Number.isFinite(rm.own) ? rm.own : contact;
    if (Number.isFinite(rm.table)) contact = rm.table;      // SYNC: the table's contact (full motion), see rm
    /* SPLASHPL: a seat that shows the word in its own language strikes on the instant of the shared English word, so every seat sees
       the blow (and the token reactions wait) on one instant: the shown word starts earlier or later by the difference of the two contacts
       (0 in the invincible look, whose contact does not depend on the text; a legacy look's can) */
    let lead = 0;
    if (it.en && it.en !== it.text) try { const r = contactOf(LP.letterable(it.en), tableOpts); if (r) lead = r.c - contact; } catch (e) { lead = 0; }
    shot = impactShot(ctl, it, contact + lead);
    o.startAt += lead;
    if (shot?.shift > 0) o.startAt += shot.shift;
    ctl.wordAt = o.startAt; ctl.contactAt = o.startAt + own;
  }
  return { shot };
}
function letterOne(ctl, it) {
  if (!LE || ctl.dead) return null;
  const lw = letterWrap(ctl);
  overDice();   // CRITPEAK (ADVX 3: resting dice drew over the critical's captions): the dice canvas may come up after the moment opened
  const { o, world, struck, tableOpts } = letterOpts(ctl, it, lw);
  /* FXI-SPLASH (ADVI 2): every lettering starts on a known instant a little ahead (its first picture is painted meanwhile), so the impact
     frame can be put on the very tick the word hits. The impact is asked for FIRST: it owns the flash budget of that instant and the
     word's own flash frame gives way to it (one accent, the impact's guard). */
  /* SYNC (ADVX 5): on the moment's zero (the table's instant), never on "now": the item's own delay after it, plus the lead */
  o.startAt = (Number.isFinite(ctl.t0) ? ctl.t0 + (Number(it.delay) || 0) : performance.now()) + LEAD_MS;
  /* ALIGN (engine 1.9.1 recipe, owner: one accent): the result word that gets the roll's impact does not flash on its own (`flash: false`);
     the impact is its accent, landing on its contact. Every seat decides it from the event alone, so the word's contact is one rule. Before,
     the impact was asked for first so that it took the flash budget from the word: that worked only while the impact had two flashes.
     SYNC: the word's timing follows the table's impact (impactTiming), also on a seat whose Effects setting draws none */
  /* SYNC (live: a seat with Effects off struck 42 ms after the others, one 24 Hz tick): the word's entrance depends on this seat's settings.
     The struck word of a seat that draws the impact gives up its own flash frame (`flash: false`, one tick shorter), a seat with Effects off
     keeps it; reduced motion may draw another entrance. The TABLE's contact is the one drawn with the table's options (full motion, and no
     flash frame when the table's impact strikes this word); on this seat every lettering starts earlier or later by the difference, so ITS
     contact lands on the table's instant and its own look stays */
  const { shot } = strikeAt(ctl, it, o, tableOpts, struck);
  let h = null;
  /* DIRECT: the result word of an attack travels the action's way on its own clock (Dir.travelAt: in from the roller's side, strikes on its
     contact, drifts on, leaves the same way), kept inside this seat's view; the moves of the block (followPan, the shake) set its place */
  const base = { ...o.at };
  let go = null;
  if (it.role === 'word' && it.dir && !o.reduced) {
    let cur = { ...base };
    const t0 = o.startAt, cap = it.S || 0;
    const holdEnd = () => (h?.plan?.timeline?.ent ?? []).reduce((a, p) => a + (p.ticks ?? 0) * (1000 / 24), 0) + (it.hold || 0);
    /* a function for the engine (read every frame), carrying its place as x / y too (what the block's checks and logs read) */
    o.at = Object.assign(() => {
      const contact = Number.isFinite(ctl.contactAt) ? ctl.contactAt - t0 : (it._m?.contact ?? 120);
      const q = Dir.travelAt(it.dir, performance.now() - t0, { contact, holdEnd: holdEnd() });
      const safe = { l: 0, t: 0, r: window.innerWidth, b: window.innerHeight };
      let off = { x: q.x * cap, y: q.y * cap };
      if (world) {
        const z = globalThis.canvas?.stage?.scale?.x || 1, c = toClient(cur);
        if (c) { const d = Dir.clampTravel(c, { x: off.x * z, y: off.y * z }, (it.w || 0) * z / 2, (it.h || 0) * z / 2, safe); off = { x: d.x / z, y: d.y / z }; }
      } else off = Dir.clampTravel(cur, off, (it.w || 0) / 2, (it.h || 0) / 2, safe);
      return { x: cur.x + off.x, y: cur.y + off.y };
    }, { x: base.x, y: base.y });
    const fn = o.at;
    go = (p) => { cur = { x: p.x, y: p.y }; fn.x = p.x; fn.y = p.y; };
  }
  try {
    h = LE.play(LP.letterable(it.text), o);
    ctl.letters.push({ h, base, role: it.role, world, own: !!o.parent, go });
    if (h?.hand) ctl.hands.push(h.hand);
  } catch (e) { console.warn('invincible-plus-ultra (splash) | lettering failed', e); h = null; }
  /* ALIGN: the impact after its word, on the word's contact as the ENGINE reads it (L.contactAt: on the 24 Hz grid in stepped motion) */
  if (shot) {
    try { const c = h && LE.contactAt ? LE.contactAt(h) : null; if (Number.isFinite(c)) ctl.contactAt = c; } catch (e) { /* the planned one */ }
    fireImpact(ctl, shot, ctl.contactAt, h);
  }
  if (it.role === 'word' && ctl.early) { stopEarly(ctl.early); ctl.early = null; earlyStats.dropped++; }   // ROLLSTALL: asked ahead, not taken
  if (it.role === 'word' && ctl.bdLater) enterBackdrop(ctl, shot);
  /* FIN-CALLERS (FXIT-S1, ADVI 8): the result word strikes now: the token reactions wait until it and its impact are over */
  if (it.role === 'word') {
    const at = ctl.contactAt ?? o.startAt;
    /* CALLER5: the table's impact length after the blow (shot.lead before it), on every seat alike; this seat's own end only without it */
    tellLand(ctl, at, Number.isFinite(ctl.tableImpactMs) && shot ? Math.max(0, ctl.tableImpactMs - shot.lead) : ctl.impactEnd ? Math.max(0, ctl.impactEnd - at) : 0);
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
      try { const p = { x: it.base.x + (off.x + sx * px) * k, y: it.base.y + (off.y + sy * px) * k }; if (it.go) it.go(p); else it.h.moveTo(p); } catch (e) { /* the engine dropped it */ }
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
    if (ctl.yielded?.size) yieldPanels(ctl);   // MAPSEAT: the board moved under the panels
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
  for (const it of ctl.letters || []) { try { if (it.h.alive && !it.world) { const p = { x: it.base.x + ctl.offset.x, y: it.base.y + ctl.offset.y }; if (it.go) it.go(p); else it.h.moveTo(p); } } catch (e) { /* gone */ } }   // DIRECT: a travelling word keeps its travel
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

/* CRITLATE: the moment's options as THIS seat plays it (which token it may stand by, which layer); the same for prepare() and play() */
/* DIRECT: the way of an attack roll on the board: from the roller to its targets (their middle, for several), from the DOCUMENTS (the same on
   every seat); none without a roller or a target on this scene, or when the GM hid either (direct.mjs, DIRECT-1 / DIRECT-4) */
export function splashDir(roller, targets) {
  try {
    const C = globalThis.canvas;
    if (!C?.ready || !roller) return null;
    const gs = C.dimensions?.size ?? C.grid?.size ?? 100;
    const src = typeof roller === 'string' ? C.tokens?.get(roller)?.document : (roller.document ?? roller);
    if (!src || src.hidden) return null;
    const cs = (targets ?? []).map((id) => C.tokens?.get(id)?.document).filter((d) => d && !d.hidden && d.id !== src.id).map((d) => Dir.centreOf(d, gs)).filter(Boolean);
    if (!cs.length) return null;
    const c = { x: cs.reduce((a, p) => a + p.x, 0) / cs.length, y: cs.reduce((a, p) => a + p.y, 0) / cs.length };
    return Dir.between(src, { x: c.x, y: c.y, width: 0, height: 0 }, gs);
  } catch (e) { return null; }
}
function momentOpts(ev, o) {
  const full = o.fullFrom != null && !ev.fail && ev.power != null && ev.power >= o.fullFrom;
  /* FXLD2: on a map layer the moment needs a token everybody sees (o.token = the board's token, main.mjs mapToken); without one it
     has no place on the board and plays on the screen, by each seat's view */
  /* FXI-SPLASH (ADVI 10): and only a token THIS seat sees: an unseen roller's moment plays on this seat's screen, placed by nothing of it */
  if (o.token && !seesToken(o.token)) o = { ...o, token: null };
  /* CRITPEAK (SYNC take M1/M2: a map word no seat saw): a map moment stands by its roller on the board; with the roller outside the STANDARD
     view (the same rect on every seat with this view) it was laid out up by the roller, beyond every seat's view. Then it plays on this
     seat's screen like a moment without a board token (the impact still lands on the target) */
  if (onMap() && o.token && !boardInView(o.token)) o = { ...o, token: null, hero: o.token };   // (still the hero: the screen block keeps off him)
  /* CRITPEAK (ADVX 2, 4): the board block is sized by the board (GRID_VH squares = the reference height), the same scene size on every seat;
     on this seat's view the board is m times the screen rule. Far out (m < band) it is a speck, close in (m > band) it is bigger than the
     screen's ranks and than the view: outside LP.MAP_BAND the moment plays on this seat's screen, every kind alike, so one seat at one view
     sees the ranks of one layer, in order */
  if (onMap() && o.token && !mapScaleOk()) o = { ...o, onScreen: true };   // by the token, as the screen layer letters it
  const shared = onMap() && !!o.token && !o.onScreen;
  return { o, full, shared };
}
/* CRITLATE: the moment's layout (its items, the block, this seat's rule on the map), from the event, the options and the stage's fields
   (shared, token, hero, targets, seed, full, userScale, gaugeK). A dry stage (prepare) logs nothing and draws nothing. */
function layoutMoment(ev, o, ctl, full) {
  const holdK = o.hold || 1;
  const dF = LP.failStrength(ev);
  const plan = LP.planMoment(ev, { token: !!ctl.token, full, holdK, npc: !!ev.npc, dF, reduced: S.isReduced() });
  const word = plan.items.find(it => it.role === 'word');
  /* DIRECT: an attack that landed has a way on the board, from the roller to its target (documents: the same on every seat): the result
     word grows and leans that way (laid out with it, so the block is the same on every seat) and travels it as it strikes (letterOne) */
  ctl.dir = word && !ev.fail ? splashDir(o.rollerId ?? o.from, ctl.targets) : null;
  /* CAPSTAR: the lettering frames the impact's star (its cut-in reach is an obstacle of the table's block and of every seat's place) */
  ctl.star = word ? starOf(ev, ctl) : null;
  if (ctl.dir) { word.dir = ctl.dir; word.dirFrom = Dir.fromOf(ctl.dir); word.rot0 = Dir.tiltOf(ctl.dir, word.rot0 ?? 0); if (!S.isReduced()) word.rotation = word.rot0; }
  const t0 = word?.delay ?? 0;
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
  let lay = compose(ctl, plan.items, gauge ? { gauge } : {});
  /* CRITPEAK (ADVX 4): at a far view the scene itself is small on screen; a block readable there does not fit inside the part of it this view
     shows (the map layer cuts the words at the scene's edge), or this seat's own guard would shrink it under its rank's floor: the moment then
     plays on the screen layer, by the token as every seat with this view sees it */
  const zoomNow = Math.max(0.02, Number(globalThis.canvas?.stage?.scale?.x) || 1);
  /* MAPSEAT: ONE rule decides this seat's layer (SP.mapSeat): the board block as every seat has it, or, when this seat cannot show it well
     (a part a speck at its zoom, or outside what its view shows of the board), the moment on its screen layer. Never a copy of the board
     block moved or shrunk for this seat (before: shrunk in place into a close view, moved off the GM's own panels, compared by cover) */
  let seatRule = ctl.shared ? SP.mapSeat([lay.rect], lay.fit, lay.items.map((it) => ({ px: it.S * zoomNow, word: it.role === 'word' || it.role === 'pre' })), LP.MAP_READ) : null;
  if (ctl.shared && !ctl.dry) {
    ctl.seatRule = seatRule; ctl.board = lay;   // (kept for inspection: the table's board block, also on a seat that plays it on its screen)
    const R = (q) => q && { l: Math.round(q.l), t: Math.round(q.t), r: Math.round(q.r), b: Math.round(q.b) };
    SEAT_LOG.push({ id: ctl.momentId ?? ctl.seed, seat: seatRule, board: R(lay.rect), view: R(lay.fit), px: lay.items.map((it) => Math.round(it.S * zoomNow * 10) / 10) });
    if (SEAT_LOG.length > 20) SEAT_LOG.shift();
  }
  const mustScreen = ctl.shared && seatRule !== 'ok';
  if (mustScreen) {
    const big = seatRule !== 'speck', mw = lay.items.find((it) => it.role === 'word');
    const onScreen = mw ? mw.S * zoomNow : 0;   // the word as this seat's close view drew the board block
    ctl.shared = false; ctl.userScale = o.scale || 1;
    if (ev.stress) gauge = probeGauge(ctl, ev.stress, resolve);
    lay = compose(ctl, plan.items, gauge ? { gauge } : {});
    /* a close view: the board's ordinary blocks are drawn big here, so a block too big for this view does not come back smaller than they
       are on this very view (the ranks stay in order on one seat: a critical never under the strong roll before it) */
    /* SPLASHSAME: by THIS SEAT's board scale (m: the board's reference squares on its view against the screen rule), one factor for every
       outcome it shows (before: each outcome's own ratio of its board word to its screen word, so on a 1366 x 768 seat at zoom 0.8 an ordinary
       roll came back at 80 px and a strong one at 75). A screen block then matches the board blocks of this view in size and the ranks stay in
       order on the seat */
    const gsN = globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100, mSeat = GRID_VH * gsN * zoomNow / SP.REF_VH;
    /* only a window as big as the reference: a smaller one is short of room already (at 1366 x 768, zoom 0.8 a critical upscaled 1.4 x
       covered the roller where the plain one stood clean; provisional SPLASHSAME-3) */
    const kS = LP.seatFactor(localScreen('screen').safe, SP.standardRect(SP.REF_VW, SP.REF_VH));
    const sw = lay.items.find((it) => it.role === 'word'), up = kS >= 0.999 ? Math.min(LP.MAP_UP, Math.max(1, mSeat)) : 1;
    if (big && sw && onScreen > 0 && up > 1.02) {
      /* MAPSEAT: never onto a token the plain screen picture keeps off (the crowded board at 0.5: the board block stood in the wide window
         off this view, and the upscaled screen block lay over a bystander, 91 % of its box, where the plain one stood clean) */
      /* SPLASHSAME: a moment by its roller (the table's block, placed by seatPlace) keeps the seat's factor for every outcome: seatPlace keeps
         it clean (farther away, then smaller down to its rank's floor at this factor, so the ranks stay in order on the seat; nothing clean: the
         least covering place). Before, a block that covered more upscaled came back plain, per outcome: a strong roll then stood under the
         upscaled ordinary one (80 vs 75 px at 1366 x 768, zoom 0.8). A moment without a roller in this view keeps that cover test */
      const plain = lay, plainGauge = gauge, uScale = ctl.userScale;
      ctl.userScale = (o.scale || 1) * up;
      if (ev.stress) gauge = probeGauge(ctl, ev.stress, resolve);
      lay = compose(ctl, plan.items, gauge ? { gauge } : {});
      if (!lay.table && plain.frame && lay.frame && LP.coverMax(lay, lay.frame) > Math.max(LP.RIM_OK, LP.coverMax(plain, plain.frame))) {
        lay = plain; gauge = plainGauge; ctl.userScale = uScale;
        if (ev.stress) gauge = probeGauge(ctl, ev.stress, resolve);
      }
    }
  }
  return { plan, word, t0, dF, resolve, lay };
}
function playLetters(ev, o) {
  const mo = momentOpts(ev, o), full = mo.full, shared = mo.shared;
  o = mo.o;
  const ctl = openStage(full ? { ...o, full: true } : o, shared);
  const stage = ctl.el, later = ctl.later, holdK = o.hold || 1;
  /* a moment needs a seed even when no message gives one (the preview): an unseeded word draws a new random hand at every call, so
     the hand measured for the layout was not the hand played (live: the critical's 4 SIXES stood 170 px off a narrower word) */
  ctl.seed = o.seed ?? `local-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`; ctl.full = full;
  /* SYNC (ADVX 5): the moment's zero is the table's instant (main.mjs: the shared start on the shared clock, on this page's clock), not the
     instant this seat got here: the layout's measuring, a late timer or a busy frame no longer move the word; a seat that comes late joins the
     same timeline (the engine plays a word whose start is past from where it stands by then) */
  ctl.t0 = Number.isFinite(o.at) ? o.at : performance.now();
  { const id = ctl.momentId ?? ctl.seed, e = EARLY.get(id); if (e) { EARLY.delete(id); clearTimeout(e.dog); ctl.early = e; } }   // ROLLSTALL: the impact asked ahead is this moment's
  const at = (fn, ms) => later(fn, Math.max(0, ctl.t0 + ms - performance.now()));
  letterWrap(ctl);
  overDice();
  /* CRITPEAK (ADVX 3): Dice So Nice raises its canvas when the dice come and lowers it as they go; the layer follows it for the moment's
     first seconds (the dice of this very roll rest there), so resting dice never sit on the captions */
  for (let ms = 250; ms <= 4000; ms += 250) later(overDice, ms);
  /* WIRE1: the impact frame of this result (impact-plan.mjs; null = none). Planned from the event alone, so every seat agrees */
  ctl.impactPlan = LE?.impact?.play ? IP.impactFor(ev, { fx: o.fx }) : null;
  /* SYNC: WHEN the word strikes is the table's: its lead-in for the impact is read from the impact at the table's full strength, whatever
     this seat's Effects setting (reduced: one strength lower; off: none) draws. Before, a seat with Effects off started its word earlier */
  ctl.impactTiming = LE?.impact?.play ? IP.impactFor(ev, { fx: 1 }) : null;
  ctl.targets = IP.cleanTargets(o.targets); ctl.from = o.from ?? null;   // ROLLTARGET: where the impact lands, where the blow comes from
  ctl.rollerId = typeof o.rollerId === 'string' ? o.rollerId : null;   // CALLER5: the roller as SHARED data (the map cut's figures, the same on every seat)
  warmFigures(ctl);
  const { plan, word, t0, dF, resolve, lay } = layoutMoment(ev, o, ctl, full);
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
  if (!word) at(() => tellLand(ctl, ctl.t0, 0), 0);   // FIN-CALLERS: a moment without a result word has struck once it shows
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
    at(() => {
      if (it.role === 'stress') stressGauge(ctl, ev.stress, resolve, lay.gauge);
      yieldPanels(ctl);   // MAPSEAT: this seat's own panels over the board block step back (each part as it comes); SPLASHCLEAR: on the screen, its pop-ups
      const h = letterOne(ctl, it);
      /* FXLD (ADVD 14): the engine switched off under us (its master switch) -> the classic splash instead of rays with no word */
      if (first && h && (h.off === true || (h.alive === false && LE?.prefs?.enabled === false))) { ctl.momentId = null; ctl.landed = false; endCtl(ctl, true); playClassic(ev, o); first = false; return; }   // the classic splash tells the story from here
      first = false;
    }, it.delay);
  }
  /* the old splash's surroundings stay: rays, the soft flash, the shake and the sparks of a strong result; the shake of a rare miss */
  /* WIRE1 (the owner: no flash or shake of our own on top of an impact frame): a result with an impact frame keeps only the sparks */
  if (!ev.fail && o.fx) at(() => { accentFx(stage, ev.tag ? Math.max(ev.power, 0.32) : ev.power, later, o, full, !!ctl.impactPlan); if (!S.isReduced() && ev.power > 0.45 && !ctl.impactPlan) shakeLetters(ctl, Math.round(4 + 8 * ev.power)); }, t0 + 60);
  if (ev.fail && !ev.softFail && dF > 0.3 && o.fx && !S.isReduced()) at(() => shakeLetters(ctl, 4 + Math.round(6 * dF)), t0 + 380);
  const wordEnd = word ? word.delay + word.hold : plan.end;
  if (full) at(() => fadeExtrasEarly(ctl), wordEnd + 300);
  const badgesEnd = ev.stress ? t0 + 450 + Math.round(2600 * holdK) + 200 : 0;
  at(() => { if (ctl.gaugeEl) S.leaveSlide(ctl.gaugeEl); }, Math.max(wordEnd, badgesEnd - 200));
  at(() => endCtl(ctl, false), Math.max(plan.end, badgesEnd) + 800);
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
/* CALLER5: the roller takes part in the cut as a figure on the table (shared data: his token is on this scene and the GM has not hidden it;
   whether THIS seat may draw him is the engine's matter), so a map layer's cut is the same list of drawings on every seat */
function rollerShared(ctl) {
  try { const t = ctl.rollerId ? globalThis.canvas?.tokens?.get?.(ctl.rollerId) : null; return !!t && t.document?.hidden !== true; } catch (e) { return false; }
}
/* CALLER5 (engine 1.9.23 `I.warm`): the figures' art (cut-out, negative, hue) is worked out as soon as the moment is known, seconds before
   its blow (the dice still roll), never in a frame of the cut: the targets and the roller this seat sees */
function warmFigures(ctl) {
  try {
    const I = LE?.impact;
    if (typeof I?.warm !== 'function' || !ctl.impactTiming) return;
    const list = [...ctl.targets.map((id) => globalThis.canvas?.tokens?.get?.(id)), ctl.from].filter((t) => t && !t.destroyed && t.document?.hidden !== true && seesToken(t));
    if (list.length) I.warm(list);
  } catch (e) { /* a warm-up is a courtesy */ }
}
/* ROLLTARGET: the last impacts' places on this seat (for the live checks and the debug log): { id, where: target|word|none, why, target } */
const IMPACT_LOG = [];
export const impactLog = () => IMPACT_LOG.slice();
function logImpact(row) { IMPACT_LOG.push({ at: Math.round(performance.now()), ...row }); if (IMPACT_LOG.length > 20) IMPACT_LOG.shift(); }
function impactShot(ctl, it, contact) {
  const I = LE?.impact, ip = ctl.impactPlan, tp = ctl.impactTiming ?? ip;
  if (!I?.play || !tp || ctl.impact) return null;
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
    const specOf = (q) => {
      const s = { kind: q.kind, magnitude: q.magnitude, seed: IP.impactSeed(ctl.seed), subject: tok ?? { x: c.x - w / 2, y: c.y - hh / 2, w, h: hh },
        over: LAYER === 'screen' ? 'ui' : 'scene' };
      /* the blow comes from the roller (only a token this seat sees: the engine checks it again).
         CALLER5 (engine 1.9.23 IMPACT5-4; ADVI2 7: a critical with no target had no token in it): with no target token as the subject (the
         result word is), the roller is passed too: the engine's cut-in then stars the attacker (enlarged at his own place, winding up and
         driving toward his word) for the whole cut; the subject stays the word, so the impact still lands on the result, never on him */
      if (ctl.from && ctl.from !== tok && seesToken(ctl.from)) s.from = ctl.from;
      /* IMPCALL (engine 1.9.20/1.9.21: the tokens take part as figures): the roll's OTHER targets join the impact as `also` (the same list on
         every seat: the targets after the first, from the roll's shared data; GM-hidden ones never; the engine draws each only where it may
         be seen) */
      const also = IP.alsoTargets(ctl.targets).map((id) => globalThis.canvas?.tokens?.get?.(id)).filter((t) => t && t !== tok && t !== s.from && t.document?.hidden !== true);
      if (also.length) s.also = also;
      if (map) { s.space = 'world'; s.frames = IP.mapFrames(q.magnitude, LE?.impact, { figs: IP.hasFigures(ctl.targets, rollerShared(ctl)), rung: q.rung }); }
      else if (Array.isArray(q.frames)) s.frames = q.frames.map((f) => ({ ...f }));      // a result that is no blow: the callers' own cut (impact-plan impactFor; CALLER6: a blow's is the engine's ladder)
      if (q.tone) s.tone = q.tone;
      if (q.hitstop === false) s.hitstop = false;
      if (q.gentle === true) s.gentle = true;      // IMPCALL2: Effects reduced: the engine's gentle variant of the table's impact (only ever true: a false would raise nothing)
      return s;
    };
    const spec = ip ? specOf(ip) : null;
    if (spec && S.isReduced()) spec.reduced = true;
    /* ALIGN (engine 1.9.1): the lead-in before the impact's strongest drawing is the engine's own plan.peakMs (read from the full plan, the
       same on every seat whatever its reduced or guard setting); IP.leadMs (leading "lines" only) stays for an engine without it.
       SYNC: read from the TABLE's impact (full Effects), so a seat with Effects reduced or off starts its word on the same instant */
    let lead = 0, tableMs = null;
    const ts = specOf(tp);
    try { const p = I.plan?.({ ...ts, reduced: false }); lead = Number.isFinite(p?.peakMs) ? p.peakMs : IP.leadMs(p?.frames ?? ts.frames ?? []);
      /* CALLER5: how long the TABLE's impact lasts (the token reactions wait for it: tellLand), the same on every seat whether or not this
         seat draws it (a map word off its view, a target off it). Before, a seat that drew none told 0 and its target answered earlier than
         on the other seats. CALLER6 (engine 1.9.24): the engine's plan says it itself (`plan.tableMs`, the full plan before this seat's
         safety), so a reduced-motion seat (its own plan: one still) tells the table's length for the engine's ladders too */
      tableMs = IP.tableImpactMs(p, ts.frames, I);
      /* IMPCALL2 (item 3): the table's strength of this impact when it lands on the roll's targets (shared data: the targets and the table's
         plan), told with the landing so the target's damage reaction joins this event instead of striking a second cut */
      if (ctl.targets?.length && Number.isFinite(p?.step)) ctl.tableStep = p.step; } catch (e) { lead = 0; }
    const draws = fire && !!spec;
    if (spec && Number.isFinite(tableMs)) ctl.tableImpactMs = tableMs; else delete ctl.tableImpactMs;
    return { spec, map, lead, tableMs, shift: Math.max(0, lead - contact), contact, fire: draws, where: !spec ? 'none' : tok ? 'target' : (fire ? 'word' : 'none'), why: spec ? pick.why : 'effects-off', target: pick.id };
  } catch (e) { console.warn('invincible-plus-ultra (splash) | impact frame failed', e); return null; }
}
/* ROLLSTALL (live, two seats, lane 5: the impact of a roll was asked for in the result word's own task, 53-98 ms before its first drawing;
   the engine works a figure's art off and paints its full-view drawings one per task from the call on, 20-40 ms each, so that work fell into
   the frames that show the impact's first drawings: 50-117 ms frames at its start, where a token reaction's blow, asked 160-216 ms ahead,
   runs 17-32 ms frames on the same pages). The impact is asked for as soon as the table's instant is known (main.mjs: the last layout ahead,
   up to Beat.MARGIN before the instant; LEAD_MS more before the word starts): the same spec, on the same blow instant (the word's contact as
   the engine will read it: L.contactAt of the same plan and start), so nothing of the picture or its timing changes; only the engine's
   preparation moves out of the impact's first frames. play() claims it and fireImpact takes it. Only where it is exactly the call letterOne
   would make: the result word is the moment's first lettering (a pushed roll's prefix comes first and changes the word's hand: as before),
   on a screen layer (a map word is handed to the engine as `keep`, and it does not exist yet: as before). A moment that never plays
   (its message deleted, the tab hidden) drops it (tellMoment 'done'; EARLY_HOLD_MS after its instant at the latest). */
const EARLY = new Map();
export const EARLY_HOLD_MS = 400;
export const earlyStats = { armed: 0, taken: 0, redone: 0, dropped: 0 };
function stopEarly(e) { try { clearTimeout(e.dog); if (e.h?.alive) e.h.stop(); } catch (x) { /* already over */ } }
export function dropEarly(id) {
  const e = EARLY.get(id);
  if (!e) return false;
  EARLY.delete(id); stopEarly(e); earlyStats.dropped++;
  return true;
}
const plainObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x) && (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
function sameVal(a, b) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.01;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameVal(x, b[i]));
  return plainObj(a) && plainObj(b) && sameSpec(a, b);
}
/* two impact specs are one call: the same keys, tokens the same objects, numbers within 0.01 (ms, px) */
export function sameSpec(a, b) {
  const ka = Object.keys(a).filter((k) => a[k] !== undefined), kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameVal(a[k], b[k]));
}
function armEarly(ctl, it, q, t0, items) {
  const I = LE?.impact, id = ctl.momentId ?? ctl.seed;
  if (!I?.play || !q?.struck || id == null || !Number.isFinite(t0) || EARLY.has(id)) return null;
  if ((ctl.shared && it.sceneAt) || items.some((x) => x !== it && !((Number(x.delay) || 0) > (Number(it.delay) || 0)))) return null;
  ctl.t0 = t0;
  q.o.startAt = t0 + (Number(it.delay) || 0) + LEAD_MS;   // as letterOne sets it
  const { shot } = strikeAt(ctl, it, q.o, q.tableOpts, true);
  if (!shot?.fire || shot.map || !shot.spec) return null;
  let blowAt = ctl.contactAt;
  try { const p = contactOf(LP.letterable(it.text), q.o)?.p, c = p && LE.contactAt ? LE.contactAt(p, q.o.startAt) : null; if (Number.isFinite(c)) blowAt = c; } catch (e) { /* the planned one */ }
  if (!Number.isFinite(blowAt) || blowAt - shot.lead <= performance.now()) return null;   // its first drawing is due already: asked with its word, as before
  const spec = { ...shot.spec, blowAt }, e = { spec, h: null, dog: 0 };
  e.h = I.play(spec);
  EARLY.set(id, e); earlyStats.armed++;
  e.dog = setTimeout(() => { if (EARLY.get(id) === e) dropEarly(id); }, Math.max(0, t0 - performance.now()) + EARLY_HOLD_MS);
  return e;
}
/* CRITFREEZE (live: asked ~200 ms before its start, the impact's arts, 3 jobs of ~31 ms for a critical's two figures, were worked out in
   the last frames before the word landed: display frames of 50-67 ms there). The layout ahead knows the blow while the dice still roll
   (not its instant yet): the engine is told then (I.warmFor, engine 1.9.26: the arts worked out in the page's idle moments, nothing
   painted, shown or counted), once per moment. The impact itself is asked as before (armEarly, fireImpact): the same call, the same
   drawings. An engine without warmFor: nothing, as before */
const WARMED = new Set();
function warmImpact(ctl, it, q) {
  const I = LE?.impact, id = ctl.momentId ?? ctl.seed;
  if (typeof I?.warmFor !== 'function' || !q?.struck || id == null || WARMED.has(id)) return 0;
  try {
    /* (the shot as the play will ask it: on a copy, an instant far enough ahead; only its spec is read) */
    const { shot } = strikeAt({ ...ctl }, it, { ...q.o, startAt: performance.now() + 60000 }, q.tableOpts, true);
    if (!shot?.fire || !shot.spec) return 0;
    WARMED.add(id); if (WARMED.size > 40) WARMED.delete(WARMED.values().next().value);
    earlyStats.warmed = (earlyStats.warmed ?? 0) + 1;
    return I.warmFor(shot.spec) || 0;
  } catch (e) { return 0; }
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
    /* ROLLSTALL: the impact asked ahead for this moment (armEarly) IS this call when its spec and its blow's instant are the same; anything
       else (the clock corrected meanwhile, the target left this seat's view, the block moved) and it is stopped before its first drawing
       (the engine frees its window and its flash instants) and the impact is asked now, as before */
    const e = ctl.early; ctl.early = null;
    if (e && sameSpec(e.spec, spec)) { ctl.impact = e.h; earlyStats.taken++; }
    else { if (e) { stopEarly(e); earlyStats.redone++; } ctl.impact = I.play(spec); }
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
  if (data?.phase === 'done' && data.id != null) dropEarly(data.id);   // ROLLSTALL: a moment that is over before it played takes the impact asked ahead with it
  try { globalThis.Hooks?.callAll?.(MOMENT_HOOK, data); } catch (e) { /* a listener's failure is not the splash's */ }
}
function tellLand(ctl, landAt, impactMs) {
  if (!ctl.momentId || ctl.landed) return;
  ctl.landed = true;
  const one = Number.isFinite(ctl.tableStep) && ctl.targets?.length ? { targets: ctl.targets.slice(), step: ctl.tableStep } : {};      // IMPCALL2: one event with its damage
  tellMoment({ phase: 'land', id: ctl.momentId, landAt, impactMs: Math.round(Math.max(0, impactMs) || 0), ...one });
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
/* SPLASHBLOCK (seen live, the fight's critical: on the player's seat the roll's lettering left about 1 s after the impact while it stood
   about 4 s on the GM's): the moment's block was its OUTLINE, the union of its parts. A split critical frames the fighters (the word over
   them, the caption under them), so its outline covered the struck token although no letter did; the reaction's blow then made that seat's
   moment make room (and the reaction's word, kept off that outline, shrank to 0.35-0.4 of its size: the tiny THROOMF!). The block is now
   its PARTS as drawn (partBoxes: letters and standing ink): a moment makes room only when a part really stands on a struck token, and a
   reaction's word may stand between the parts, by its token */
function partsOf(ctl) {
  const lay = ctl.layout;
  if (lay?.items?.length && Number.isFinite(lay.rect?.l)) {
    const o = !ctl.shared && ctl.offset ? ctl.offset : { x: 0, y: 0 };
    return partBoxes(lay).map((q) => ({ l: q.l + o.x, t: q.t + o.y, r: q.r + o.x, b: q.b + o.y }));
  }
  const b = blockOf(ctl);
  return b ? [b] : [];
}
export function makeRoom(ids, at) {
  try {
    if (!Array.isArray(ids) || !ids.length) return 0;
    const toks = ids.map((id) => globalThis.canvas?.tokens?.get?.(id)).filter(Boolean);
    let n = 0;
    for (const ctl of [...active.values()]) {
      if (ctl.dead || !ctl.landed || ctl.roomFor) continue;   // a moment that has not struck yet keeps its story (it comes after the blow anyway)
      const parts = partsOf(ctl);
      if (!toks.some((t) => { const tb = tokenAreaOf(ctl, t); return parts.some((b) => nearBlock(b, tb)); })) continue;
      ctl.roomFor = at;
      const ms = Math.max(0, (Number.isFinite(at) ? at : performance.now()) - ROOM_MS - performance.now());
      ctl.later(() => endCtl(ctl, false), ms);
      n++;
    }
    return n;
  } catch (e) { return 0; }
}
/* the landed moments' blocks in client px (a map moment's scene block projected on this seat's view) */
/* SPLASHBLOCK: part by part (partsOf). scene (optional array, filled alongside): each block's SCENE rect where the splash knows one that
   every seat shares (a map moment's board block; a screen moment's canonical block, compose): a reaction planned on another view than the
   live one takes that rect through the scene, so every seat plans round the same thing; null = only this seat's client rect */
export function blocks(scene = null) {
  const out = [];
  for (const ctl of active.values()) {
    if (ctl.dead || !ctl.landed || ctl.roomFor) continue;
    const ps = partsOf(ctl);
    if (ctl.shared) { for (const b of ps) { const a = toClient({ x: b.l, y: b.t }), c = toClient({ x: b.r, y: b.b }); if (a && c) { out.push({ l: a.x, t: a.y, r: c.x, b: c.y }); scene?.push({ ...b }); } } continue; }
    const cn = ctl.layout?.canon?.scene, ok = Array.isArray(cn) && cn.length === ps.length;
    ps.forEach((b, i) => { out.push(b); scene?.push(ok ? { ...cn[i] } : null); });
  }
  return out;
}
export function onTokenReact(data) {
  if (data?.phase === 'hit') makeRoom(data.ids, data.at);
  else if (data?.phase === 'place' && Array.isArray(data.blocks)) data.blocks.push(...blocks(Array.isArray(data.scene) ? data.scene : null));
}
/* the screen pins of a map moment: an HTML part follows its scene point (followPan) */
function pin(ctl, el, at, c0, k = 0) { (ctl.pins ??= []).push({ el, at, c0, k }); }

/* the Resolve gauge: a DOM gauge (pips, the line under it) inside the block, beside its lettered number. Measured first (a hidden
   copy), so the block leaves room for it. On a map moment it is measured at the reference size (--u 1, the same on every seat) and
   drawn at the scene's scale. */
function probeGauge(ctl, stress, resolve) {
  let tmp = null;
  try {
    /* CRITLATE: a dry stage (prepare) has no wrapper of its own: a hidden one like letterWrap's, removed again */
    const lw = ctl.el ? letterWrap(ctl) : (tmp = wrapEl());
    const b = S.stressBadge(lw, stress, resolve, null);
    if (ctl.shared) b.style.setProperty('--u', '1');
    b.style.visibility = 'hidden';
    /* SPLASHCLEAR (live, lane 5: the gauge stood on two tokens beside a "far" block): its layout size, not its box on screen: the box
       caught the gauge's pop-in transform at its start (0.44 of its size), so the block was planned round a gauge 63 x 36 px that is
       drawn 143 x 82 */
    const q = b.getBoundingClientRect(), ow = b.offsetWidth, oh = b.offsetHeight;
    b.remove();
    if (ow > 0 && oh > 0) return { w: Math.ceil(ow), h: Math.ceil(oh) };
    return q && q.width > 0 ? { w: Math.ceil(q.width), h: Math.ceil(q.height) } : null;
  } catch (e) { return null; } finally { try { tmp?.remove(); } catch (e) { /* gone */ } }
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
export const IMPACT_MAX_MS = 1000;   // the engine's longest impact (IMPCALL: 1.9.21 = 24 ticks at 24 Hz; was 12 = 500 ms): the fallback end when its plan gave no length
/* IMPCALL: the running engine's own longest impact when it says it (I.limits.maxTicks), else IMPACT_MAX_MS */
export const impactMaxMs = (I) => { const t = Number(I?.limits?.maxTicks); return Number.isFinite(t) && t > 0 ? Math.ceil(t * IP.TICK) : IMPACT_MAX_MS; };
function enterBackdrop(ctl, shot) {
  const add = ctl.bdLater;
  ctl.bdLater = null;
  if (!add) return;
  const live = !!ctl.impact && ctl.impact.alive !== false;
  const now = performance.now();
  const end = live ? (Number.isFinite(ctl.impactEnd) ? ctl.impactEnd : (Number.isFinite(ctl.impactPeak) ? ctl.impactPeak : now) + impactMaxMs(LE?.impact)) : now;
  if (live && shot?.where === 'target' && shot.target) ctl.spotTarget = shot.target;
  /* CRITLATE (engine 1.9.20: a 500 ms impact ends on a fraction of a millisecond; Math.round brought the wash a third of a ms early):
     rounded up, never before the end, whatever the plan's length */
  ctl.later(() => { if (!ctl.dead && !ctl.extrasGone) add(); }, Math.max(0, Math.ceil(end - now)));
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
  unyield(ctl);    // MAPSEAT: the panels that stepped back come back
  if (active.get(ctl.key) === ctl) active.delete(ctl.key);
  if (ctl.lw) stopLetters(ctl, quick);   // LDIC: a newer splash on the same place, the limit, a scene change: the words exit (quick = at once)
  if (quick && ctl.impact?.alive) { try { ctl.impact.stop(); } catch (e) { /* already over */ } }   // WIRE1: a moment cut short takes its impact frame with it
  if (ctl.early) { stopEarly(ctl.early); ctl.early = null; earlyStats.dropped++; }   // ROLLSTALL: asked ahead and never taken
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

/* what a stage knows of its moment (openStage, and a dry stage for prepare(): the layout reads exactly these) */
function stageFields(opts, shared) {
  const f = { token: opts.full ? null : (opts.token || null), userScale: opts.scale || 1, hero: opts.token || opts.hero || null, shared,
    backdrop: !!opts.backdrop, momentId: opts.momentId ?? null, shareId: opts.shareId ?? opts.momentId ?? null };
  /* FXLD2: a map moment's gauge: scene px per reference px (the gauge is measured at --u 1, the 768 px reference) */
  if (shared) f.gaugeK = GRID_VH * (globalThis.canvas?.dimensions?.size ?? globalThis.canvas?.grid?.size ?? 100) / LP.REF_VH;
  return f;
}
/* CRITLATE: lay a moment out AHEAD of its instant (main.mjs: while the dice roll, and again once the table's instant is known), with the
   very options play() will get: the measuring and the layout are kept by their input (composeIn, measureItems), so play() at the instant
   only takes them. Nothing is drawn, logged or ended here. `slice` (while the dice roll: live, one prepare of a crowded critical held the
   page 0.25-0.5 s and the dice stood still): the work is cut between the layouts it makes, each slice in its own idle slot of the page
   (a later slice finds the earlier layouts kept and goes on from there). -> the ms the first slice took, or null (nothing to lay out) */
export const PREP_SLICE_MS = 12;
/* CRITFREEZE: a slot is as long as the page says it is idle for (IdleDeadline.timeRemaining), PREP_SLICE_MS at most; a slot the page
   had no idle time for (it came by its timeout: the dice and the map are busy drawing) is PREP_BUSY_MS, so it never makes a frame late by
   more than that and a step; the next slot is asked for PREP_RETRY_MS later at the latest (every other frame) */
export const PREP_BUSY_MS = 6, PREP_RETRY_MS = 32;
function slotMs(idle) {
  try {
    if (!idle) return PREP_SLICE_MS;
    if (idle.didTimeout) return PREP_BUSY_MS;
    const r = typeof idle.timeRemaining === 'function' ? idle.timeRemaining() : NaN;
    return Number.isFinite(r) ? Math.max(PREP_BUSY_MS, Math.min(PREP_SLICE_MS, r)) : PREP_SLICE_MS;
  } catch (e) { return PREP_SLICE_MS; }
}
const PREP_YIELD = { yield: true };
let prepDeadline = null, prepDid = false;
export const PREP_ROUNDS = 4000;   // CRITFREEZE: a layout of 0.5 s in slots of 12 ms is ~45 slots; a crowded board's worst (3 s) 250
export function prepare(ev, o, slice = false, round = 0, idle = null) {
  try {
    if (!lettersOn() || !o?.seed) return null;
    prepDeadline = slice ? performance.now() + slotMs(idle) : null; prepDid = false;
    const t = performance.now();
    const mo = momentOpts(ev, o), opts = mo.full ? { ...mo.o, full: true } : mo.o;
    const ctl = { ...stageFields(opts, mo.shared), dry: true, seed: o.seed, full: mo.full, targets: IP.cleanTargets(mo.o.targets),
      rollerId: typeof mo.o.rollerId === 'string' ? mo.o.rollerId : null,      // CALLER5: the same map cut as the play (rollerShared)
      from: mo.o.from ?? null };      // CAPSTAR: the star of a cut without a target (starOf), as the play has it
    const { lay } = layoutMoment(ev, mo.o, ctl, mo.full);
    /* the struck word's contact, as letterOne will ask it (its options from the same letterOpts; kept by contactOf) */
    ctl.impactPlan = LE?.impact?.play ? IP.impactFor(ev, { fx: mo.o.fx }) : null;
    ctl.impactTiming = LE?.impact?.play ? IP.impactFor(ev, { fx: 1 }) : null;
    ctl.k = lay?.k;
    const wp = lay?.items?.find((it) => it.role === 'word');
    if (wp) {
      if (ctl.shared) wp.sceneAt = { x: wp.x, y: wp.y };
      const q = letterOpts(ctl, wp, document.createElement('div'));
      if (q.struck) {
        if (q.o.reduced || q.o.flash !== q.tableOpts.flash) contactOf(LP.letterable(wp.text), q.tableOpts);
        contactOf(LP.letterable(wp.text), q.o);
        if (wp.en && wp.en !== wp.text) contactOf(LP.letterable(wp.en), q.tableOpts);
        /* ROLLSTALL: the table's instant is known (o.at, this page's clock): the impact is asked for now */
        if (!slice && Number.isFinite(o.at)) armEarly(ctl, wp, q, o.at, lay.items);
        else warmImpact(ctl, wp, q);
      }
    }
    return performance.now() - t;
  } catch (e) {
    if (e === PREP_YIELD && round < PREP_ROUNDS) {
      const again = (d) => prepare(ev, o, true, round + 1, d ?? null);
      if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(again, { timeout: PREP_RETRY_MS }); else setTimeout(again, 0);
      return 0;
    }
    return null;
  } finally { prepDeadline = null; }
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
  const ctl = { key, el, W, extras: [], timers: [], dead: false, pos: token ? POS_TOKEN : POS_SCREEN, ...stageFields(opts, shared) };
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

export function clearAll() { for (const c of Array.from(active.values())) endCtl(c, true); for (const id of [...EARLY.keys()]) dropEarly(id); }
export function activeCount() { return active.size; }
