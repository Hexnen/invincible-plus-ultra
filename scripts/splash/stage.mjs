/* Scena splasha: warstwa ekranowa (fixed) albo przy tokenie (wewnątrz #hud rdzenia, zsynchronizowanego z canvasem).
   Jeden splash na klucz ('screen' albo id tokena); nowy wypiera poprzedni. */
import { FS, LBL, oddsText, hueOf, hsl, fmtOdds, say } from './logic.mjs';
import * as S from './splash.mjs';
import * as LP from './letter-plan.mjs';

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
export function safeRect() {
  measureArea();
  const vw = window.innerWidth, vh = window.innerHeight;
  let l = 12, t = 10, r = area.w - 14, b = vh - 10;
  for (const s of UI_LEFT) { const q = boxOf(s); if (q && q.left < vw * 0.15 && q.right < vw * 0.2) l = Math.max(l, q.right + 8); }
  for (const s of UI_TOP) { const y = topOf(s, vh); if (y >= 0) t = Math.max(t, y + 6); }
  for (const s of UI_RIGHT) { const x = leftOf(s, vw); if (x < r) r = Math.max(l + vw * 0.3, x - 10); }
  for (const s of UI_BOTTOM) { const q = boxOf(s); if (q && q.top > vh * 0.6 && q.left < area.w) b = Math.min(b, q.top - 8); }
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
      const r = LE.planFor ? LE.planFor(LP.letterable(it.text), o) : null;
      const p = r?.plan ?? (LE._plan ? (() => { const q = LE._plan(LP.letterable(it.text), o); LE._settle?.(q); return q; })() : null);
      if (p?._holdBox?.w > 0 && p.sizeK > 0) m = { w: p._holdBox.w, h: p._holdBox.h, sizeK: p.sizeK, hand: p.hand?.id };
    } catch (e) { m = null; }
    if (!m) { let k = 0.62 + 0.7 * (it.sound?.loud ?? 0.5); try { k = LE.design(LP.letterable(it.text), o)?.sizeK ?? k; } catch (e) { /* estimate */ } const b = LP.estimateBox(it, 1); m = { w: b.w, h: b.h, sizeK: k, hand: null }; }
    it._m = m;
    if (m.hand) hands.push(m.hand);
  }
}
const measureFn = (it, S) => (it._m ? { w: it._m.w * S, h: it._m.h * S } : LP.estimateBox(it, S));
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
/* compose: measure, lay out, and (when the block had to go below or beside the token) measure again with the sound coming from there */
function compose(ctl, items, extra = {}) {
  const vh = window.innerHeight, k = Number(LE?.prefs?.scale) > 0 ? Number(LE.prefs.scale) : 1;
  const frame = { vh, scale: (ctl.userScale || 1) * k, safe: safeRect(), token: ctl.token ? tokenBox(ctl.token) : null,
    focus: { x: area.cx, y: vh * (ctl.full ? 0.47 : 0.42) }, ...extra };
  let side = 'above', out = null;
  for (let pass = 0; pass < 2; pass++) {
    measureItems(items, { seed: ctl.seed, from: ctl.token ? SIDE_FROM[side] : null });
    out = LP.composeMoment(items, frame, measureFn);
    if (!ctl.token || out.side === side) break;
    side = out.side;
  }
  out.k = k;
  return out;
}

function letterWrap(ctl) {
  if (ctl.lw?.isConnected) return ctl.lw;
  const w = document.createElement('div'); w.className = 'ins-letters';
  w.style.setProperty('--u', String(Math.max(0.7, Math.min(1.6, window.innerHeight / 768)).toFixed(3)));
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
  /* on the map: scene coordinates and scene px, the same block (it zooms as one: ADVD 7, the odds no longer run into the sentence) */
  let world = false;
  if (onMap()) {
    const at = it.sceneAt ?? toScene(o.at), z = it.z0 ?? (canvas.stage.scale.x || 1);
    if (at) {
      Object.assign(o, { space: 'world', layer: LAYER, at, size: Math.round((o.size / z) * 100) / 100, maxWidth: Math.ceil(o.maxWidth / z) });
      if (ctl.token) o.token = ctl.token;
      delete o.parent;
      world = true;
    }
  }
  try {
    const h = LE.play(LP.letterable(it.text), o);
    ctl.letters.push({ h, base: { ...o.at }, role: it.role, world, own: !!o.parent });
    if (h?.hand) ctl.hands.push(h.hand);
    return h;
  } catch (e) { console.warn('invincible-plus-ultra (splash) | lettering failed', e); return null; }
}
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
    if (ctl.gaugeEl) ctl.gaugeEl.style.translate = `${Math.round(sx * px)}px ${Math.round(sy * px)}px`;
  }, i * 42));
}
/* the block follows its token (screen layers) or the scene (map layers: the words pan by themselves, the HTML parts follow) */
function followPan(ctl) {
  if (ctl.dead) return;
  if (ctl.sceneAnchor) {
    const c = toClient(ctl.sceneAnchor);
    if (!c) return;
    const dx = Math.round(c.x - ctl.clientAnchor.x), dy = Math.round(c.y - ctl.clientAnchor.y);
    for (const x of [ctl.gaugeEl, ...(ctl.extras || []).filter(e => e.classList?.contains('ins-fullrays')), ctl.el]) if (x) x.style.translate = `${dx}px ${dy}px`;
    return;
  }
  if (!ctl.token || !ctl.tokenAnchor) return;
  const tb = tokenBox(ctl.token);
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
/* a lettered moment on a map layer: wait (at most maxMs) until the dice are gone; resolves with the ms waited */
export function diceClear(maxMs = 2600) {
  if (!lettersOn() || !onMap() || diceZ() <= 0) return Promise.resolve(0);
  let w = 0;
  return new Promise((res) => {
    const tick = () => { w += 100; if (diceZ() <= 0 || w >= maxMs) res(w); else setTimeout(tick, 100); };
    setTimeout(tick, 100);
  });
}

function playLetters(ev, o) {
  const full = o.fullFrom != null && !ev.fail && ev.power != null && ev.power >= o.fullFrom;
  const ctl = openStage(full ? { ...o, full: true } : o);
  const stage = ctl.el, later = ctl.later, holdK = o.hold || 1;
  /* a moment needs a seed even when no message gives one (the preview): an unseeded word draws a new random hand at every call, so
     the hand measured for the layout was not the hand played (live: the critical's 4 SIXES stood 170 px off a narrower word) */
  ctl.seed = o.seed ?? `local-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6)}`; ctl.full = full;
  letterWrap(ctl);
  overDice();
  if (full) addBackdrop(ctl, ev.power, o.fullFrom >= 1 ? 1 : (ev.power - o.fullFrom) / (1 - o.fullFrom), o.fx);
  const dF = LP.failStrength(ev);
  const plan = LP.planMoment(ev, { token: !!ctl.token, full, holdK, npc: !!ev.npc, dF, reduced: S.isReduced() });
  const word = plan.items.find(it => it.role === 'word');
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
  const lay = compose(ctl, plan.items, gauge ? { gauge } : {});
  ctl.k = lay.k; ctl.rect = lay.rect;
  ctl.tokenAnchor = ctl.token ? tokenBox(ctl.token) : null;
  /* the rays, the flash and the sparks centre on the word */
  const wp = lay.items.find(it => it.role === 'word');
  if (wp) { stage.style.left = wp.x + 'px'; stage.style.top = (wp.y + 0.04 * stage.clientWidth) + 'px'; }
  if (onMap()) {
    ctl.clientAnchor = { x: (lay.rect.l + lay.rect.r) / 2, y: (lay.rect.t + lay.rect.b) / 2 }; ctl.sceneAnchor = toScene(ctl.clientAnchor);
    /* the whole block goes to scene coordinates NOW: a part lettered later (its delay) after the camera moved must not be converted
       with the new view (live, 1366: the sentence of a map moment landed on the token when the view panned meanwhile) */
    const z0 = canvas.stage.scale.x || 1;
    for (const it of lay.items) { const at = toScene({ x: it.x, y: it.y }); if (at) { it.sceneAt = at; it.z0 = z0; } }
  }
  let first = true;
  for (const it of lay.items) {
    later(() => {
      if (it.role === 'stress') stressGauge(ctl, ev.stress, resolve, lay.gauge);
      const h = letterOne(ctl, it);
      /* FXLD (ADVD 14): the engine switched off under us (its master switch) -> the classic splash instead of rays with no word */
      if (first && h && (h.off === true || (h.alive === false && LE?.prefs?.enabled === false))) { endCtl(ctl, true); playClassic(ev, o); }
      first = false;
    }, it.delay);
  }
  /* the old splash's surroundings stay: rays, the soft flash, the shake and the sparks of a strong result; the shake of a rare miss */
  if (!ev.fail && o.fx) later(() => { S.fxFor(stage, ev.tag ? Math.max(ev.power, 0.32) : ev.power, later, o.fx, full); if (!S.isReduced() && ev.power > 0.45) shakeLetters(ctl, Math.round(4 + 8 * ev.power)); }, t0 + 60);
  if (ev.fail && !ev.softFail && dF > 0.3 && o.fx && !S.isReduced()) later(() => shakeLetters(ctl, 4 + Math.round(6 * dF)), t0 + 380);
  const wordEnd = word ? word.delay + word.hold : plan.end;
  if (full) later(() => fadeExtrasEarly(ctl), wordEnd + 300);
  const badgesEnd = ev.stress ? t0 + 450 + Math.round(2600 * holdK) + 200 : 0;
  later(() => { if (ctl.gaugeEl) S.leaveSlide(ctl.gaugeEl); }, Math.max(wordEnd, badgesEnd - 200));
  later(() => endCtl(ctl, false), Math.max(plan.end, badgesEnd) + 800);
  return ctl;
}
/* the Resolve gauge: a DOM gauge (pips, the line under it) inside the block, beside its lettered number. Measured first (a hidden
   copy), so the block leaves room for it. */
function probeGauge(ctl, stress, resolve) {
  try {
    const lw = letterWrap(ctl);
    const b = S.stressBadge(lw, stress, resolve, null);
    b.style.visibility = 'hidden';
    const q = b.getBoundingClientRect();
    b.remove();
    return q && q.width > 0 ? { w: Math.ceil(q.width), h: Math.ceil(q.height) } : null;
  } catch (e) { return null; }
}
function stressGauge(ctl, stress, resolve, g) {
  const b = S.stressBadge(letterWrap(ctl), stress, resolve, ctl.later);
  if (g) { b.style.left = g.x + 'px'; b.style.top = g.y + 'px'; }
  ctl.gaugeEl = b;
  return b;
}
/* the stress after Accept: its own small block (number + gauge) right under the moment that is still up, else by the token */
function stressLettered(ctl, stress, resolve, holdK, seed) {
  const it = { ...LP.planStress(stress, { holdK, reduced: S.isReduced() }) };
  const gauge = probeGauge(ctl, stress, resolve);
  ctl.seed ??= seed;
  const r = ctl.rect;
  const lay = compose(ctl, [it], { ...(gauge ? { gauge } : {}), ...(r ? { token: null, focus: { x: (r.l + r.r) / 2, y: r.b + 0.05 * window.innerHeight } } : {}) });
  ctl.k = lay.k;
  const p = lay.items[0];
  if (p) p._o = { ...p._o, seed: seed ?? p._o?.seed };
  stressGauge(ctl, stress, resolve, lay.gauge);
  if (p) letterOne(ctl, p);
}

/* tło pełnoekranowe: poświata w kolorze wyniku i promienie na cały widok; nigdy nie zasłania całkiem mapy */
function addBackdrop(ctl, P, strength, fx) {
  const h = hueOf(P), k = 0.5 + 0.5 * strength, reduced = S.isReduced();
  const bd = document.createElement('div'); bd.className = 'ins-backdrop';
  bd.style.background =
    'radial-gradient(circle at 50% 46%, ' + hsl(h + 20, 100, 70, (0.30 * k).toFixed(2)) + ' 0%, ' + hsl(h, 100, 52, (0.22 * k).toFixed(2)) + ' 32%, ' + hsl(h - 28, 90, 10, (0.62 * k).toFixed(2)) + ' 100%)';
  const layerEl = ensureLayer();
  layerEl.insertBefore(bd, ctl.el);
  ctl.extras.push(bd);
  if (!reduced) bd.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out', fill: 'backwards' });
  /* obracające się promienie to czysty efekt ruchu: bez nich przy ograniczonym ruchu i przy Efekty = Wyłączone (poświata zostaje) */
  if (reduced || !fx) return;
  const ray = document.createElement('div'); ray.className = 'ins-fullrays';
  ray.style.setProperty('--ray', hsl(h + 20, 100, 72, (0.50 * k).toFixed(2)));
  layerEl.insertBefore(ray, ctl.el);
  ctl.extras.push(ray);
  {
    ray.animate([{ opacity: 0, transform: 'translate(-50%,-50%) rotate(0deg) scale(.6)' }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(10deg) scale(1)', offset: 0.2 }, { opacity: 1, transform: 'translate(-50%,-50%) rotate(60deg) scale(1)' }],
      { duration: 7000, easing: 'linear', fill: 'forwards' });
  }
}

/* Pełny ekran: poświata i obracające się promienie schodzą razem ze słowem, nie dopiero po całym ogonie sceny (finish = hold + 3 s).
   Bez tego ściemniony widok z promieniami wisiał nad mapą jeszcze ok. 3 s po zniknięciu słowa. Węzły wychodzą z ctl.extras,
   żeby endCtl nie wygaszał ich drugi raz (animacja 1 -> 0 na już przezroczystym węźle mignęłaby z powrotem). */
function fadeExtrasEarly(ctl) {
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
  if (active.get(ctl.key) === ctl) active.delete(ctl.key);
  if (ctl.lw) stopLetters(ctl, quick);   // LDIC: a newer splash on the same place, the limit, a scene change: the words exit (quick = at once)
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
function openStage(opts) {
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
  const ctl = { key, el, token, W, extras: [], timers: [], dead: false, pos: token ? POS_TOKEN : POS_SCREEN, userScale: scale };
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
  const rnd = o.rnd || Math.random;
  /* rzadszy sukces (moc >= próg) dostaje pełny ekran; porażki i rutyna nie */
  const full = o.fullFrom != null && !ev.fail && ev.power != null && ev.power >= o.fullFrom;
  const ctl = openStage(full ? { ...o, full: true } : o);
  const stage = ctl.el, later = ctl.later;
  if (full) addBackdrop(ctl, ev.power, o.fullFrom >= 1 ? 1 : (ev.power - o.fullFrom) / (1 - o.fullFrom), o.fx);
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
    if (o.fx) S.fxFor(stage, ev.tag ? Math.max(P, 0.32) : P, later, o.fx, full);
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
