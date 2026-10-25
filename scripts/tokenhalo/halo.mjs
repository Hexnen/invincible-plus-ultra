/* Token halo: the canvas layer. One halo = a PIXI.Container with two baked sprites, living in canvas.primary (NOT a child of the Token).

   WHY THE PRIMARY GROUP (core evidence, Foundry 14 client/):
     - config.mjs `layers.tokens.group = "interface"`: the Token placeable (its border, nameplate, bars, TokenTurnMarker child) is drawn in the
       InterfaceCanvasGroup, ABOVE the primary group, the lighting and the visibility mask. A child of the Token can therefore never be
       behind the token art: the art is `token.mesh`, a PrimarySpriteMesh inside canvas.primary (token.mjs `_draw`: canvas.primary.addToken).
     - groups/primary.mjs `_compareObjects`: children are ordered by elevation, then sortLayer, then sort, then zIndex; SORT_LAYERS are
       SCENE 0, TILES 500, DRAWINGS 600, TOKENS 700. A plain container with sortLayer 650 and the token's elevation sits above the map, tiles
       and drawings and below EVERY token at that elevation (so a halo never paints over a neighbour's art).
     - The halo follows the token through the `refreshToken` hook (placeable-object.mjs applyRenderFlags calls it after every incremental
       refresh; token.mjs `_onAnimationUpdate` sets refreshPosition / refreshVisibility / refreshSize on every movement-animation frame),
       so it glides with the token. It ignores token rotation on purpose (it is never rotated).
   Textures: each (seed, variant, size, colour) is drawn once with PIXI.Graphics and baked with renderer.generateTexture at 2x (3x on dense
   screens); the cache is bounded (MAX_KEYS) and reference counted. Two textures per key: the steady dots with the ink duplicate, and the
   shimmer group (its sprite's alpha alternates 2-3 times a second). Nothing is redrawn per frame; the canvas ticker callback exists only
   while a halo needs motion (enter / leave ramps, breathing, shimmer) and removes itself otherwise. */
import { dotsFor, extentOf, inkOffset, PALETTE } from "./dots.mjs";

const MAX_KEYS = 40;
const SORT_LAYER = 650;                                   // between DRAWINGS (600) and TOKENS (700)
const ALPHA = { hover: 0.82, select: 0.92, turn: 0.94 };  // the dots' alpha per variant (the spec says about 0.9)
/* Motion modes (client setting): off = static, calm (default) = a soft pop-in / fade-out, and ONLY the active-turn ring breathes slowly,
   lively = the first version (every ring breathes, 1.8 s cycle, and a group of dots flickers 2.5 times a second). Nothing else ever repeats. */
const BREATH = {
  calm: { hover: 0, select: 0, turn: 0.02, ms: 4200 },     // full cycle 4.2 s, cosine = ease in-out, at most 2% scale
  lively: { hover: 0, select: 0.025, turn: 0.04, ms: 1800 }
};
const ENTER_MS = 160, LEAVE_MS = 130, SHIMMER_MS = 400;
const LOG = "invincible-plus-ultra (token halo) |";

const halos = new Map();      // token id -> halo record
const cache = new Map();      // key -> { texS, texB, ext, refs }
let tickerOn = false;
const hidBorder = new Set();                // token ids whose core border we hid
const hidMarker = new Map();                // token id -> the TokenTurnMarker we hid

const hex = (s) => parseInt(String(s).replace("#", ""), 16);
const INK = hex(PALETTE.ink);
const nowMs = () => performance.now();

/* ---------- baking ---------- */
function resolution() { return (window.devicePixelRatio || 1) > 1.25 ? 3 : 2; }

function bake(key, token, variant, color, ring, cell, sizePx) {
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }   // LRU: most recent last
  const dots = dotsFor(token.id, sizePx, { cell, variant, ring });
  const ink = inkOffset(cell, sizePx);
  const ext = Math.ceil(extentOf(dots) + ink.y + 3);
  const col = hex(color), a = ALPHA[variant] ?? 0.9;
  const S = new PIXI.Graphics(), B = new PIXI.Graphics();
  for (const d of dots) if (d.k === "disc") S.beginFill(INK, 0.26).drawCircle(d.x, d.y, d.r).endFill();
  for (const d of dots) if (d.k !== "disc") S.beginFill(INK, 0.9).drawCircle(d.x + ink.x, d.y + ink.y, d.r).endFill();
  for (const d of dots) {
    if (d.k === "disc") continue;
    (d.g ? B : S).beginFill(col, 1).drawCircle(d.x, d.y, d.r).endFill();
  }
  const region = new PIXI.Rectangle(-ext, -ext, 2 * ext, 2 * ext);
  const opts = { region, resolution: resolution(), scaleMode: PIXI.SCALE_MODES.LINEAR, multisample: PIXI.MSAA_QUALITY?.HIGH ?? 4 };
  const r = canvas.app.renderer;
  const rec = { texS: r.generateTexture(S, opts), texB: r.generateTexture(B, opts), ext, refs: 0, alpha: a };
  S.destroy(true); B.destroy(true);
  cache.set(key, rec);
  evict();
  return rec;
}

function evict() {
  if (cache.size <= MAX_KEYS) return;
  for (const [k, rec] of cache) {
    if (cache.size <= MAX_KEYS) break;
    if (rec.refs > 0) continue;
    dropTextures(rec);
    cache.delete(k);
  }
}
function dropTextures(rec) { try { rec.texS.destroy(true); rec.texB.destroy(true); } catch { /* gone */ } }

/* ---------- the halo of one token ---------- */
function destroyRecord(h) {
  halos.delete(h.id);
  try { h.cont.destroy({ children: true }); } catch { /* the canvas group may already be gone */ }
  const rec = cache.get(h.key);
  if (rec) rec.refs = Math.max(0, rec.refs - 1);
}

/* the animation preference: this setting AND the OS reduced-motion AND core's performance mode */
function motionOk(mode) {
  if (mode !== "calm" && mode !== "lively") return false;
  try { if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return false; } catch { /* default on */ }
  try { if (game.settings.get("core", "performanceMode") === CONST.CANVAS_PERFORMANCE_MODES.LOW) return false; } catch { /* default on */ }
  return true;
}

const breathAmp = (h) => (BREATH[h.mode]?.[h.variant] ?? 0);
const dynamic = (h) => h.motion && (h.leaving || nowMs() - h.born < ENTER_MS + 30 || breathAmp(h) > 0 || h.mode === "lively");
const soft = (x) => x * x * (3 - 2 * x);                   // smoothstep: no overshoot

function frame(h, t) {
  let e = 1, l = 0;
  if (h.motion) {
    e = soft(Math.min(1, (t - h.born) / ENTER_MS));
    if (h.leaving) l = soft(Math.min(1, (t - h.leaveAt) / LEAVE_MS));
  }
  h.cont.alpha = h.baseAlpha * e * (1 - l);
  let s = 0.94 + 0.06 * e;
  const amp = breathAmp(h);
  if (h.motion && amp > 0) s *= 1 + amp * (0.5 - 0.5 * Math.cos(2 * Math.PI * (t - h.born) / BREATH[h.mode].ms));
  h.cont.scale.set(s);
  h.sprB.alpha = h.motion && h.mode === "lively" && h.variant !== "hover" && Math.floor(t / SHIMMER_MS) % 2 ? 0.38 : 1;
  return l >= 1;
}

function tick() {
  try {
    const t = nowMs();
    let any = false;
    for (const h of [...halos.values()]) {
      if (frame(h, t)) { destroyRecord(h); continue; }
      if (dynamic(h)) any = true;
    }
    if (!any) stopTicker();
  } catch (e) { console.warn(LOG, "tick", e); stopTicker(); }
}
function startTicker() { if (!tickerOn && canvas?.app?.ticker) { canvas.app.ticker.add(tick); tickerOn = true; } }
function stopTicker() { if (tickerOn) { try { canvas.app?.ticker?.remove(tick); } catch { /* gone */ } tickerOn = false; } }

function place(h, token) {
  const c = token.center;
  h.cont.position.set(c.x, c.y);
  const el = token.mesh?.elevation ?? token.document.elevation ?? 0;
  const sort = token.document.sort ?? 0;
  if (h.cont.elevation !== el || h.cont.sort !== sort) { h.cont.elevation = el; h.cont.sort = sort; canvas.primary.sortDirty = true; }
  const shown = !!token.visible && token.mesh?.visible !== false;
  h.cont.visible = shown;
  h.baseAlpha = (token.document.hidden ? 0.5 : 1) * Math.min(1, token.document.alpha ?? 1);
  if (!h.motion || !tickerOn) frame(h, nowMs());
}

/* Show / update / remove the halo of a token. want = null (no halo) or
   { variant, color, ring, motion: "off"|"calm"|"lively", hideBorder, hideMarker }. Safe to call as often as you like. */
export function update(token, want) {
  const id = token.id;
  let h = halos.get(id);
  if (!want) { if (h) leave(h, token); else restoreCore(token); return; }
  const { width, height } = token.document.getSize();
  const sizePx = Math.min(width, height);
  const cell = canvas.grid?.size || 100;
  const key = [token.id, want.variant, want.color, Math.round(sizePx), cell, want.ring, resolution()].join("|");
  if (h && (h.key !== key || h.leaving)) {   // another variant / colour / size (or it was leaving): swap the textures in place
    const wasLeaving = h.leaving, changed = h.variant !== want.variant;
    const old = cache.get(h.key); if (old) old.refs = Math.max(0, old.refs - 1);
    const rec = bake(key, token, want.variant, want.color, want.ring, cell, sizePx);
    rec.refs++;
    h.key = key; h.variant = want.variant; h.leaving = false;
    h.sprS.texture = rec.texS; h.sprB.texture = rec.texB;
    if (wasLeaving || changed) h.born = nowMs();
  } else if (!h) {
    const rec = bake(key, token, want.variant, want.color, want.ring, cell, sizePx);
    rec.refs++;
    const cont = new PIXI.Container();
    cont.name = `isp-halo-${id}`;
    cont.eventMode = "none";
    cont.interactiveChildren = false;
    cont.sortLayer = SORT_LAYER;
    cont.zIndex = 0;
    const sprS = new PIXI.Sprite(rec.texS), sprB = new PIXI.Sprite(rec.texB);
    sprS.anchor.set(0.5); sprB.anchor.set(0.5);
    cont.addChild(sprS, sprB);
    canvas.primary.addChild(cont);
    h = { id, key, variant: want.variant, cont, sprS, sprB, born: nowMs(), leaving: false, leaveAt: 0, baseAlpha: 1, motion: false, mode: "calm" };
    halos.set(id, h);
  }
  h.variant = want.variant;
  h.mode = want.motion === "lively" ? "lively" : "calm";
  h.motion = motionOk(want.motion);
  place(h, token);
  applyCore(token, h, want);
  if (h.motion && dynamic(h)) startTicker();
}

function leave(h, token) {
  restoreCore(token);
  if (h.leaving) return;
  if (h.motion && tickerOn) { h.leaving = true; h.leaveAt = nowMs(); startTicker(); }
  else destroyRecord(h);
}

/* ---------- what we hide from core, and how it comes back ---------- */
function applyCore(token, h, want) {
  try {
    const shown = h.cont.visible;
    if (want.hideBorder && shown && token.border) { token.border.visible = false; hidBorder.add(token.id); }
    else if (hidBorder.delete(token.id)) token.renderFlags.set({ refreshState: true });   // core recomputes border.visible itself
    const tm = token.turnMarker;
    if (want.hideMarker && want.variant === "turn" && shown && tm && !tm.destroyed) { tm.visible = false; hidMarker.set(token.id, tm); }
    else restoreMarker(token.id);
  } catch (e) { console.warn(LOG, "core visuals", e); }
}
function restoreMarker(id) {
  const tm = hidMarker.get(id);
  if (!tm) return;
  hidMarker.delete(id);
  try { if (!tm.destroyed) tm.visible = true; } catch { /* gone */ }
}
function restoreCore(token) {
  try {
    if (hidBorder.delete(token.id)) token.renderFlags.set({ refreshState: true });
    restoreMarker(token.id);
  } catch (e) { console.warn(LOG, "restore", e); }
}

/* ---------- lifecycle ---------- */
export const has = (id) => halos.has(id);
export const count = () => halos.size;
export const info = () => ({ halos: halos.size, cache: cache.size, ticker: tickerOn, variants: [...halos.values()].map((h) => `${h.id}:${h.variant}`) });

export function remove(id) {   // the token was destroyed: no restore needed (its border / marker are gone with it)
  const h = halos.get(id);
  hidBorder.delete(id); hidMarker.delete(id);
  if (h) destroyRecord(h);
  if (!halos.size) stopTicker();
}

export function destroyAll(restore = true) {
  for (const h of [...halos.values()]) {
    if (restore) { const tk = canvas?.tokens?.get?.(h.id); if (tk) restoreCore(tk); }
    destroyRecord(h);
  }
  halos.clear(); hidBorder.clear(); hidMarker.clear();
  stopTicker();
  for (const rec of cache.values()) dropTextures(rec);
  cache.clear();
}
