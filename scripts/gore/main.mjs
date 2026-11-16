/* GORE: blood and cracks on the screen, the Foundry part. Started from scripts/module.js by a guarded dynamic import, like the other areas.
   What is drawn and when is plan.mjs (pure), how it is drawn raster.mjs (pure); here:
     - the GLASS: <canvas> panes of the art grid (plan.grid: one art px = round(3 x DPR) device px): blood over the map (right
       after #board: over the scene, under the interface) with its SHADE under it (GOREPINK: the blood's colour, opaque, blended
       "darken", so no light ground shines through a splash as pink: tone.mjs), cracks over the interface's bars (CRACK_Z, under windows); scaled by a whole number of device px with no smoothing (image-rendering:
       pixelated), so every art pixel is a crisp square at any window size, zoom of the scene or DPR. Drawn on the comic's 24 Hz beat and
       only while something changes; nothing runs when the glass is empty;
     - the TABLE's options (world, GM only, live; shown in the "Comic effects" window, tab Blood and cracks): blood 0..3, cracks 0..3,
       who sees it (GOREOWN: by default only the seats of the players who own the hurt character), how long it stays. A seat's own reduced motion and Foundry's photosensitive mode still apply on that seat;
     - a character's Health / Resolve drop (any way: a roll, the tactical engine, the sheet) seen on every seat by the same hooks,
       landed on the token reaction's blow (hook invincible-plus-ultra.tokenReact, phase "hit") when one plays, else after the same short
       wait on every seat; the seed is the change's server stamp, so every seat draws the same splash;
     - never for a token this seat does not see (hidden, another scene) nor one outside this seat's view (GORE3, finding 5 of the blind
       review: a screen that saw no blow gets no blood); the splash lands beside the struck token as this seat sees it, sized by it,
       and never on it (GORE4: plan.mjs TOK_GAP; at the view's edge the splash turns to a side that has room);
     - a new splash on a token makes its older ones crumble away (no stains piling up on one character);
     - GORECLEAR: never over ANOTHER token's portrait nor over the lettering of the moment, on any seat: a splash is laid out clear of the
       other tokens this seat sees and of the token reactions' standing words and numbers (asked on the reactions' hook, phase "ink":
       plan.mjs keep-outs); while it stays, the glass draws no blood over a token under it (the camera moved, a token walked in:
       raster.mjs cutOut) and a splash that later lettering comes to stand on crumbles away at once (CLEAR_FAST);
     - GOREUI (blind review of tag 161, D6 and D10): neither effect lies over anything a seat reads. The cracks' pane sits UNDER the
       interface like the blood's (it was over the bars: hairlines across the toolbar's and the sidebar's icons and a panel's header),
       each seat breaks the corner that shows the web best (plan.mjs pickCorner: the share of each corner's quarter the interface, the
       tokens and the markers take on this seat), and both panes are cut round the tokens AND the map's markers this seat draws: the
       zone badges and the note pins (markShapes); a splash is also laid out clear of them, as of the other tokens and round every control
       of the interface (uiRects: much of it is see-through, so being under it is not enough);
     - the public API (game.modules.get("invincible-plus-ultra").api.gore, also globalThis.PlusUltraGore). Nothing here throws. */
import * as P from "./plan.mjs";
import * as R from "./raster.mjs";
import * as Clock from "../shared-clock.mjs";
import { choseStress } from "../tokenreact/pure.mjs";

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (gore) |`;
const REACT_HOOK = `${MOD}.tokenReact`, TAC_HOOK = `${MOD}.tactics`, TAC_HOOK_GM = `${MOD}.tacticsGm`;
const CHANNEL = `module.${MOD}`;
export const QUIET = 180;          // ms a change waits for its other half (Health and Resolve together, a crowd's updates)
export const HIT_WAIT = 3200;      // ms a change waits for its token reaction's blow; then it plays on its own
const PUSH_MS = 9000, ATTACK_MS = 6000;
export const IMPACT_MAX = 1500;     // ms the blood waits at most for an impact frame to end
/* GORECLEAR: on (the rule above). api.debug({ clear: false }) lays blood out as before it (GORE4's plan, no mask, no guard) on THIS page
   only, so a live take can count what the rule changes; nothing stores it */
let CLEAR = true;
/* GOREUI: on. api.debug({ marks: false }) forgets the map's markers and the choice of corner on THIS page only (a take's "before") */
let MARKS = true;
const LOG_MAX = 80;
const wlog = [];                     // GOREOWN: this seat's last answers to "is this hurt character's effect shown here"
const glog = [];                     // this seat's last splashes: how each was placed and what of it lay on a token or on lettering
let engineL = null;                  // the lettering engine on this page (its impact frames)

let started = false, warned = false;
const once = (e) => { if (!warned) { warned = true; console.warn(LOG, "a failure here never affects the game:", e); } };
const pnow = () => performance.now();

/* ---------------- options ---------------- */
function registerSettings() {
  const has = (k) => game.settings.settings.has(`${MOD}.${k}`);
  const K = P.KEYS;
  if (!has(K.blood)) game.settings.register(MOD, K.blood, { name: "Blood on the screen", scope: "world", config: false, type: Number, default: P.DEFAULTS.goreBlood, range: { min: 0, max: 3, step: 1 } });
  if (!has(K.cracks)) game.settings.register(MOD, K.cracks, { name: "Cracks on the screen", scope: "world", config: false, type: Number, default: P.DEFAULTS.goreCracks, range: { min: 0, max: 3, step: 1 } });
  if (!has(K.seats)) game.settings.register(MOD, K.seats, { name: "Who sees blood and cracks", scope: "world", config: false, type: String, default: P.DEFAULTS.goreWho, choices: Object.fromEntries(P.SEATS.map((s) => [s, s])) });
  if (!has(K.hold)) game.settings.register(MOD, K.hold, { name: "How long blood and cracks stay", scope: "world", config: false, type: Number, default: P.DEFAULTS.goreHold, range: { min: 0.5, max: 2, step: 0.25 } });
}
function opts() {
  const v = {};
  for (const k of Object.values(P.KEYS)) { try { v[k] = game.settings.get(MOD, k); } catch { /* default */ } }
  return P.cleanOpts(v);
}
function photosensitive() { try { return game.settings.settings.has("core.photosensitiveMode") && !!game.settings.get("core", "photosensitiveMode"); } catch { return false; } }
function osReduced() { try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; } catch { return false; } }

/* ---------------- the glass ---------------- */
/* two panes of the same grid (GORE2): the BLOOD pane right after #board (over the scene, under the interface: a splash never hides the
   chat or a button) and the CRACKS pane right after it. GOREUI: the cracks' pane was over the interface's bars and panels (z 32), so
   its hairlines crossed the toolbar's and the sidebar's icons and, at level 3, a panel's header; it is under the interface now, in
   the board's own stacking place: a button, a panel or a window is always drawn over a crack, on every seat and at every level. What
   the bars hide of a corner is answered by breaking the corner this seat shows best (cornerScores).
   Both ignore the pointer, so the board and every button stay playable. */
/* GOREPINK: the SHADE, a third pane right under the blood's (same grid, same place in the page): every blood pixel's colour at full
   alpha, blended "darken" with the map: each channel of the ground under a splash is cut down to the blood's (blood soaks the light
   out of what it lies on). Red at a low alpha over a light map is pink; with the shade a shown pixel is never lighter than the colour
   painted there, on any map (tone.mjs onGround is this stack; the checks composite with it). A dark map is left as it was. */
export const SHADE_BLEND = "darken";
const pane = () => ({ wrap: null, cv: null, ctx: null, sf: null, img: null, dirtyAll: true });
const G = { L: { blood: pane(), cracks: pane() }, shade: { wrap: null, cv: null, ctx: null, buf: null, img: null }, g: null, items: [], raf: 0, lastTick: -1, arrivals: [], cost: [], frames: 0 };
const layerOf = (kind) => (kind === "blood" ? "blood" : "cracks");
function ensureGlass() {
  if (G.L.blood.wrap?.isConnected && G.L.cracks.wrap?.isConnected && G.shade.wrap?.isConnected) return true;
  const board = document.getElementById("board");
  if (!board) return false;
  const make = (id, z) => {
    const wrap = document.createElement("div");
    wrap.id = id;
    wrap.setAttribute("aria-hidden", "true");
    Object.assign(wrap.style, { position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", overflow: "hidden", pointerEvents: "none", zIndex: z, contain: "strict" });
    const cv = document.createElement("canvas");
    Object.assign(cv.style, { position: "absolute", left: "0", top: "0", imageRendering: "pixelated" });
    wrap.appendChild(cv);
    return { wrap, cv, ctx: cv.getContext("2d", { alpha: true }) };
  };
  const zBoard = getComputedStyle(board).zIndex || "auto";
  let moved = false;
  for (const name of ["blood", "cracks"]) {
    const L = G.L[name];
    if (L.wrap?.isConnected) continue;
    const m = make(name === "blood" ? "ipu-gore" : "ipu-gore-cracks", zBoard);
    /* the order after #board: shade, blood, cracks (each later one over the earlier; all under the interface) */
    if (name === "blood") { board.after(m.wrap); moved = true; } else (G.L.blood.wrap?.isConnected ? G.L.blood.wrap : board).after(m.wrap);
    Object.assign(L, m);
  }
  /* the shade goes in right after #board, so UNDER the blood's pane (made again whenever the blood's pane is, to keep that order) */
  if (moved || !G.shade.wrap?.isConnected) {
    try { G.shade.wrap?.remove?.(); } catch { /* gone already */ }
    const m = make("ipu-gore-shade", zBoard);
    m.wrap.style.mixBlendMode = SHADE_BLEND;
    m.wrap.style.display = "none";
    board.after(m.wrap);
    Object.assign(G.shade, m);
  }
  G.g = null;
  return true;
}
function fit() {
  const vw = window.innerWidth, vh = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const g = P.grid(vw, vh, dpr);
  if (G.g && G.g.w === g.w && G.g.h === g.h && G.g.px === g.px && G.g.dpr === g.dpr) return false;
  G.g = g;
  for (const L of Object.values(G.L)) {
    L.cv.width = g.w; L.cv.height = g.h;
    /* the canvas covers w x px device px: CSS size = that / dpr (a whole number of device px per art px) */
    L.cv.style.width = `${(g.w * g.px) / g.dpr}px`; L.cv.style.height = `${(g.h * g.px) / g.dpr}px`;
    L.sf = R.surface(g.w, g.h);
    L.img = new ImageData(L.sf.rgba, g.w, g.h);
    L.dirtyAll = true;
  }
  const Sh = G.shade;
  Sh.cv.width = g.w; Sh.cv.height = g.h;
  Sh.cv.style.width = G.L.blood.cv.style.width; Sh.cv.style.height = G.L.blood.cv.style.height;
  Sh.buf = new Uint8ClampedArray(g.w * g.h * 4);
  Sh.img = new ImageData(Sh.buf, g.w, g.h);
  /* the plans are laid out on the grid: a new grid lays them out again (the same seeds: the same splash, in this view's fractions) */
  for (const it of G.items) { it.plan = it.make(g); if (it.fast) quicken(it.plan); warmLater(it); }
  return true;
}
/* ---------------- GORECLEAR: what the blood keeps clear of on this seat ---------------- */
/* a token this seat is shown now (the glass never tells a seat about a token it does not see) */
function seesTok(t) {
  try { return !!t && !t.destroyed && t.scene?.id === canvas.scene?.id && (t.isVisible ?? t.visible) !== false && (t.document?.hidden !== true || !!game.user?.isGM); } catch { return false; }
}
/* a token's art: a round portrait (a disc) or a picture that fills its square (a box). Round: the dynamic ring is on, or the picture's
   corners are see-through (read once per picture from a 16 x 16 copy); when it cannot be read: round, as GORE4 takes the struck token */
const artShapes = new Map();
function artShape(t) {
  try {
    if (t.document?.ring?.enabled) return "disc";
    const src = String(t.document?.texture?.src ?? "");
    if (artShapes.has(src)) return artShapes.get(src);
    let shape = "disc";
    const el = t.mesh?.texture?.baseTexture?.resource?.source ?? t.texture?.baseTexture?.resource?.source ?? null;
    if (el && (el.width || el.videoWidth) && typeof document?.createElement === "function") {
      const c = document.createElement("canvas");
      c.width = c.height = 16;
      const x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(el, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data, a = (px, py) => d[(py * 16 + px) * 4 + 3];
      if ([a(0, 0), a(15, 0), a(0, 15), a(15, 15)].filter((v) => v > 128).length >= 3) shape = "box";
    }
    if (artShapes.size > 400) artShapes.clear();
    artShapes.set(src, shape);
    return shape;
  } catch { return "disc"; }
}
/** the tokens this seat sees, in fractions of its view: a round portrait as a disc { id, fx, fy, fr }, a picture that fills its square
    as a box { id, l, t, r, b }; only those that touch the view */
export function tokDiscs(skip = null) {
  const out = [];
  try {
    const vw = window.innerWidth, vh = window.innerHeight, m = Math.min(vw, vh);
    for (const t of canvas?.tokens?.placeables ?? []) {
      if (t.id === skip || !seesTok(t)) continue;
      const s = tokScreen(t);
      if (!s) continue;
      const rx = (s.fr * m) / vw, ry = (s.fr * m) / vh;
      if (s.fx + rx < 0 || s.fy + ry < 0 || s.fx - rx > 1 || s.fy - ry > 1) continue;
      if (artShape(t) === "box") out.push({ id: t.id, l: s.fx - rx, t: s.fy - ry, r: s.fx + rx, b: s.fy + ry });
      else out.push({ id: t.id, fx: s.fx, fy: s.fy, fr: s.fr });
    }
  } catch (err) { once(err); }
  return out;
}
/** the lettering standing on this seat now: the token reactions answer the hook (phase "ink") with the boxes of their standing words
    and numbers in client px -> boxes in fractions of the view ({ l, t, r, b }) */
export function inkBoxes() {
  const out = [];
  try {
    const rects = [];
    Hooks.callAll(REACT_HOOK, { phase: "ink", rects });
    const vw = window.innerWidth, vh = window.innerHeight;
    for (const q of rects) if (q && q.w > 0 && q.h > 0 && Number.isFinite(q.x) && Number.isFinite(q.y)) out.push({ l: q.x / vw, t: q.y / vh, r: (q.x + q.w) / vw, b: (q.y + q.h) / vh });
  } catch (err) { once(err); }
  return out;
}
/* ---------------- GOREUI: the map's markers this seat draws, and what fills a corner ---------------- */
/* world px -> this window's client px, from the stage's own pivot and scale (as tokScreen: a frame ahead of the drawn transform) */
function toClient(x, y) {
  const st = canvas.stage, o = boardOrigin(), sx = st.scale.x, sy = st.scale.y ?? sx;
  return [(x - st.pivot.x) * sx + st.position.x + o.left, (y - st.pivot.y) * sy + st.position.y + o.top];
}
/* the markers in WORLD px, read at most once a second (and again when the zoom changes: a badge keeps its size on the screen):
   a note pin as the box of what it draws { id, x0, y0, x1, y1 }, a zone badge as its point and its zone's label radius { id, x, y, lr } */
export const MARK_MS = 1000;
/* a zone badge's radius on the screen, CSS px (moinen-maps zones/display.mjs: min(19, max(8, 0.8 x label radius x zoom)), a shaped
   badge up to 1.2 of that) */
export const badgeCss = (lr, zoom) => Math.min(19, Math.max(8, (Number(lr) || 40) * 0.8 * zoom)) * 1.2;
const marksW = { at: -1e9, zoom: 0, scene: null, list: [] };
function readMarks() {
  const out = [];
  try {
    for (const n of canvas.notes?.placeables ?? []) {
      const d = n.document;
      if (!d || n.destroyed || n.visible === false || n.renderable === false || !Number.isFinite(d.x) || !Number.isFinite(d.y)) continue;
      /* what the pin draws round its point (its art may be taller than its icon size; a label shown under it counts) */
      let b = null;
      try { const lb = n.getLocalBounds?.(); if (lb && lb.width > 0 && lb.height > 0) { const k = Math.abs(n.scale?.x ?? 1) || 1; b = { x0: d.x + lb.x * k, y0: d.y + lb.y * k, x1: d.x + (lb.x + lb.width) * k, y1: d.y + (lb.y + lb.height) * k }; } } catch { /* its size instead */ }
      if (!b) { const h = (Number(d.iconSize) || 40) / 2; b = { x0: d.x - h, y0: d.y - h, x1: d.x + h, y1: d.y + h }; }
      out.push({ id: `note:${d.id}`, ...b });
    }
  } catch (err) { once(err); }
  try {
    const mm = game.modules?.get?.("moinen-maps"), za = mm?.active ? mm.api?.zones : null;
    const Z = za?.zones?.(), lk = za?.look?.();
    /* numbered badges shown all the time, to everyone or to the GM (then only the GM's seat draws them) */
    if (Z?.zones?.length && lk && lk.numbers === "always" && (lk.who === "all" || (lk.who === "gm" && !!game.user?.isGM))) {
      const corner = lk.place === "corner", cp = za?.geometry?.cornerPoint, gs = canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
      if (!corner || typeof cp === "function") for (const q of Z.zones) {
        const l = q?.label;
        if (!l || !Number.isFinite(l.x) || !Number.isFinite(l.y)) continue;
        let pt = l;
        if (corner) { try { pt = cp(q, Math.min((Number(l.r) || 40) * 0.9, gs * 0.55)); } catch { pt = null; } }
        if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) out.push({ id: `zone:${q.id}`, x: pt.x, y: pt.y, lr: Number(l.r) || 40 });
      }
    }
  } catch (err) { once(err); }
  return out;
}
/** the map's markers this seat draws now, in fractions of its view: a zone badge as a disc { id, fx, fy, fr }, a note pin as a box
    { id, l, t, r, b }; only those that touch the view */
export function markShapes() {
  const out = [];
  try {
    if (!MARKS || !canvas?.ready || !canvas.stage?.pivot) return out;
    const z = Math.abs(canvas.stage.scale?.x ?? 1) || 1, t = pnow();
    if (t - marksW.at > MARK_MS || marksW.zoom !== z || marksW.scene !== canvas.scene?.id) { marksW.list = readMarks(); marksW.at = t; marksW.zoom = z; marksW.scene = canvas.scene?.id ?? null; }
    const vw = window.innerWidth, vh = window.innerHeight, m = Math.min(vw, vh);
    for (const q of marksW.list) {
      if (q.lr !== undefined) {
        const [x, y] = toClient(q.x, q.y), r = badgeCss(q.lr, z);
        if (x + r < 0 || y + r < 0 || x - r > vw || y - r > vh) continue;
        out.push({ id: q.id, fx: x / vw, fy: y / vh, fr: r / m });
      } else {
        const [x0, y0] = toClient(q.x0, q.y0), [x1, y1] = toClient(q.x1, q.y1);
        if (x1 < 0 || y1 < 0 || x0 > vw || y0 > vh) continue;
        out.push({ id: q.id, l: x0 / vw, t: y0 / vh, r: x1 / vw, b: y1 / vh });
      }
    }
  } catch (err) { once(err); }
  return out;
}
/** how much of each corner's quarter (a web of `reach` x the view's short side) is taken on this seat: by the interface, a token or
    a marker -> [0..1] x 4 (plan.mjs CORNERS), or null when this page cannot tell */
export function cornerScores(reach) {
  try {
    if (!MARKS || !document.body?.children) return null;
    const vw = window.innerWidth, vh = window.innerHeight, m = Math.min(vw, vh), ui = uiRects(0);
    const shapes = [...tokDiscs(), ...markShapes()];
    const inShape = (q, fx, fy) => (q.fr !== undefined ? ((fx - q.fx) * vw) ** 2 + ((fy - q.fy) * vh) ** 2 < (q.fr * m) ** 2 : fx > q.l && fx < q.r && fy > q.t && fy < q.b);
    return [0, 1, 2, 3].map((c) => {
      const pts = P.cornerProbe(c, reach, vw, vh);
      let n = 0;
      for (const q of pts) { const x = q.fx * vw, y = q.fy * vh; if (ui.some((b) => x >= b.l && x < b.r && y >= b.t && y < b.b) || shapes.some((sh) => inShape(sh, q.fx, q.fy))) n++; }
      return pts.length ? n / pts.length : 0;
    });
  } catch (err) { once(err); return null; }
}
/* GOREUI: the interface over an effect. The glass lies under the interface, but much of Foundry's interface is see-through (faded
   controls, the scene bar, the sidebar's tabs): a white hairline or a blot under a faded icon is still a line through the icon. So
   every control the page draws is cut out of the panes by its own box. The boxes are READ (one pass over the page's panels and the
   interface's controls at most every UI_MS, no hit testing: a hit test of this page costs about 0.3 ms, a grid of them is a dropped
   frame); a panel under half the window is one box, a larger one (the interface, the HUD) gives the boxes of its controls. */
export const UI_MS = 1000;
const UI_SEL = 'button, a, input, textarea, select, li, label, h1, h2, h3, h4, h5, h6, p, img, [data-action], [data-tooltip], [role="button"]';
const uiW = { at: -1e9, list: [] };
/** the boxes of the interface on this page now, window px: [{ l, t, r, b }] */
export function uiRects(fresh = UI_MS) {
  const now = pnow();
  if (now - uiW.at <= fresh) return uiW.list;
  const out = [];
  uiW.at = now; uiW.list = out;
  try {
    const vw = window.innerWidth, vh = window.innerHeight;
    const large = (r) => r.width > vw * 0.5 && r.height > vh * 0.5;
    const push = (r) => { if (r && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh && !large(r)) out.push({ l: r.left, t: r.top, r: r.right, b: r.bottom }); };
    for (const c of document.body?.children ?? []) {
      if (c.id === "board" || String(c.id ?? "").startsWith("ipu-gore") || /^(SCRIPT|TEMPLATE|STYLE|LINK)$/.test(c.tagName ?? "")) continue;
      const st = typeof getComputedStyle === "function" ? getComputedStyle(c) : null;
      if (st && (st.display === "none" || st.visibility === "hidden" || Number(st.opacity) === 0)) continue;
      const r = c.getBoundingClientRect?.();
      if (!r) continue;
      if (r.width > 0 && r.height > 0 && !large(r)) { push(r); continue; }
      for (const e of c.querySelectorAll?.(UI_SEL) ?? []) push(e.getBoundingClientRect?.());
    }
  } catch (err) { once(err); }
  return out;
}
/* the part of the window an item may draw in (window px): a web's corner, a splash's surroundings */
function uiRegion(it) {
  const vw = window.innerWidth, vh = window.innerHeight, k = vw / G.g.w;
  if (it.kind === "cracks") {
    const R = (it.log?.reach ?? 0.3 * Math.min(vw, vh)) * 1.08 + 6, c = P.CORNERS[it.plan.corner] ?? [0, 0];
    return { l: c[0] ? vw - R : 0, t: c[1] ? vh - R : 0, r: c[0] ? vw : R, b: c[1] ? vh : R };
  }
  if (it.plan.none) return null;
  const d = it.tok ? tokDiscs().find((q) => q.id === it.tok) : null;
  if (!d) return { l: 0, t: 0, r: vw, b: vh };
  const e = d.fr * Math.min(vw, vh) + (it.plan.R ?? 0) * k * 8 + 12, x = d.fx * vw, y = d.fy * vh;
  return { l: x - e, t: y - e, r: x + e, b: y + e };
}
/** the interface's boxes (fractions of the view) that the items of one pane may reach */
function uiShapes(items) {
  const out = [];
  try {
    if (!MARKS || !G.g || !items.length) return out;
    const vw = window.innerWidth, vh = window.innerHeight, regs = items.map(uiRegion).filter(Boolean);
    for (const b of uiRects()) if (regs.some((q) => b.r > q.l && b.l < q.r && b.b > q.t && b.t < q.b)) out.push({ l: b.l / vw, t: b.t / vh, r: b.r / vw, b: b.b / vh });
    for (const it of items) if (it.log) it.log.ui = Math.max(it.log.ui ?? 0, out.length);
  } catch (err) { once(err); }
  return out;
}
const discsPx = (ds, gap = 0) => { const g = G.g, m = Math.min(g.w, g.h); return ds.map((d) => (d.fr !== undefined ? { id: d.id, x: d.fx * g.w, y: d.fy * g.h, r: d.fr * m + gap } : { id: d.id, x0: d.l * g.w - gap, y0: d.t * g.h - gap, x1: d.r * g.w + gap, y1: d.b * g.h + gap })); };
const boxesPx = (bs) => { const g = G.g; return bs.map((b) => ({ x0: b.l * g.w, y0: b.t * g.h, x1: b.r * g.w, y1: b.b * g.h })); };
function quicken(plan) { for (const q of plan.second ? [plan, plan.second.plan] : [plan]) q.life = { ...q.life, dissolve: Math.min(q.life.dissolve, P.CLEAR_FAST) }; }
/* lettering stands (or is about to stand) where a splash lies: the splash crumbles away at once, quickly (never a straight cut round
   the word's box). Also measures, for the seat's log, the most of each splash that lay under a token or under lettering */
function guard(now = pnow()) {
  try {
    if (!G.g) return;
    const live = G.items.filter((it) => it.kind === "blood" && !it.plan.none);
    if (!live.length) return;
    const boxes = boxesPx(inkBoxes()), discs = discsPx(tokDiscs());
    for (const it of live) {
      const own = it.tok ? discs.filter((d) => d.id !== it.tok) : discs;
      const on = R.inkOn(it.plan, own, boxes), e = it.log;
      if (e) { e.maxTok = Math.max(e.maxTok, on.discs); if (now >= it.t0 && !Number.isFinite(it.cutAt)) e.maxInk = Math.max(e.maxInk, on.boxes); }
      if (!CLEAR || Number.isFinite(it.cutAt) && it.cutAt <= now) continue;
      if (on.boxes > Math.max(P.WORD_TOL.px, on.ink * P.WORD_TOL.share)) {
        it.fast = true; quicken(it.plan);
        it.cutAt = Math.max(it.t0, now);
        if (e) e.gaveWay = Math.round(now - it.t0);
      }
    }
  } catch (err) { once(err); }
}

function frame() {
  G.raf = 0;
  try {
    if (!G.items.length) { hideIfEmpty(); return; }
    if (!ensureGlass()) return;
    const resized = fit();
    const now = pnow(), tick = Math.floor(now / P.TICK_MS);
    if (tick !== G.lastTick || resized) {
      G.lastTick = tick;
      const t0 = pnow();
      let moving = false;
      for (const [name, L] of Object.entries(G.L)) {
        const mine = G.items.filter((it) => layerOf(it.kind) === name);
        if (!mine.length && !L.sf.box && !L.dirtyAll) continue;
        /* GORECLEAR: the tokens under the glass at this tick (every one this seat sees, the struck one too): no blood over them.
           GOREUI: nor over the map's markers this seat draws, and the cracks' pane is cut by the same list */
        const mask = mine.length && (name === "blood" ? CLEAR : MARKS) ? [...discsPx([...tokDiscs(), ...markShapes()], P.MASK_GAP), ...discsPx(uiShapes(mine), 0)] : null;
        const out = R.render(L.sf, mine, now, mask);
        if (name === "cracks" && L.sf.cut) for (const it of mine) if (it.log) it.log.masked = Math.max(it.log.masked, L.sf.cut);
        if (name === "blood" && mine.length) {
          if (L.sf.cut) for (const it of mine) if (it.log) it.log.masked = Math.max(it.log.masked, L.sf.cut);
          if (tick % P.GUARD_TICKS === 0) guard(now);
        }
        moving = moving || out.moving;
        const all = L.dirtyAll;
        if (all) { L.ctx.putImageData(L.img, 0, 0); L.dirtyAll = false; }
        else if (out.box) L.ctx.putImageData(L.img, 0, 0, out.box.x0, out.box.y0, out.box.x1 - out.box.x0 + 1, out.box.y1 - out.box.y0 + 1);
        if (name === "blood") shade(L.sf.rgba, all ? { x0: 0, y0: 0, x1: G.g.w - 1, y1: G.g.h - 1 } : out.box);
      }
      G.cost.push(pnow() - t0); if (G.cost.length > 240) G.cost.shift();
      G.frames++;
      /* (GORECLEAR: a splash that was made to clear early is over when its crumbling is, not at its planned end) */
      G.items = G.items.filter((it) => now - it.t0 < Math.min(P.endOf(it.plan), it.kind === "blood" && Number.isFinite(it.cutAt) ? Math.max(0, it.cutAt - it.t0) + it.plan.life.dissolve + (it.plan.second ? it.plan.second.delay : 0) : Infinity) + 100);
      if (!moving && !G.items.length) { hideIfEmpty(); return; }
      if (!moving) { G.raf = 0; G.idle = setTimeout(kick, nextChange(now)); return; }
    }
  } catch (err) { once(err); }
  G.raf = requestAnimationFrame(frame);
}
/* GOREPINK: the shade = the blood pane's pixels at full alpha (the changed box only), under it */
function shade(rgba, b) {
  const Sh = G.shade;
  if (!Sh.ctx || !Sh.buf) return;
  if (Sh.wrap.style.display) Sh.wrap.style.display = "";
  if (!b) return;
  const w = G.g.w, buf = Sh.buf;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let o = (y * w + b.x0) * 4, e = (y * w + b.x1) * 4; o <= e; o += 4) {
      if (rgba[o + 3]) { buf[o] = rgba[o]; buf[o + 1] = rgba[o + 1]; buf[o + 2] = rgba[o + 2]; buf[o + 3] = 255; } else buf[o + 3] = 0;
    }
  }
  Sh.ctx.putImageData(Sh.img, 0, 0, b.x0, b.y0, b.x1 - b.x0 + 1, b.y1 - b.y0 + 1);
}
/* nothing moves: sleep until the next stage (drying, dissolve, retract) of any live item */
function nextChange(now) {
  let soon = 1000;
  for (const it of G.items) {
    const ms = now - it.t0, p = it.plan;
    const marks = p.kind === "blood" ? [p.life.wet, p.life.dry, Math.min(p.life.gone, Number.isFinite(it.cutAt) ? it.cutAt - it.t0 : Infinity)] : [P.breakAt(p)];
    for (const m of marks) if (m > ms) soon = Math.min(soon, m - ms);
  }
  return Math.max(16, soon - 10);
}
/* a splash's drawings are recorded ahead, one tick per task (a whole knock-down splash takes ~25 ms of recording: never one long task) */
function warmLater(it) {
  const plan = it.plan;
  /* cracks: their shards are cut once, a task of its own after the strike (GORE2) */
  if (plan.kind !== "blood") { setTimeout(() => { try { if (it.plan === plan && G.items.includes(it)) R.warm(plan); } catch (err) { once(err); } }, 400); return; }
  let k = 0;
  const step = () => {
    if (it.plan !== plan || k > R.SETTLED || !G.items.includes(it)) return;
    try { R.warm(plan, k, k); } catch (err) { once(err); return; }
    k++;
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
function kick() { clearTimeout(G.idle); if (!G.raf) G.raf = requestAnimationFrame(frame); }
function hideIfEmpty() {
  if (G.items.length || !G.g) return;
  for (const L of Object.values(G.L)) {
    if (!L.ctx) continue;
    L.ctx.clearRect(0, 0, G.g.w, G.g.h);
    if (L.sf) { L.sf.rgba.fill(0); L.sf.T.fill(0); L.sf.C.fill(0); L.sf.box = null; }
  }
  /* the shade: empty and out of the page's compositing while there is no blood (a blended pane costs a pass only while it shows) */
  const Sh = G.shade;
  if (Sh.ctx) { Sh.ctx.clearRect(0, 0, G.g.w, G.g.h); Sh.buf?.fill(0); Sh.wrap.style.display = "none"; }
}

/* ---------------- playing ---------------- */
let uid = 0;
/** play an effect on THIS seat. o = { strength 0..1.25, seed, dir (radians, the way the blood flies), at ({ fx, fy }), token (a Token
    or its id: the blood lands beside it as this seat sees it; nothing when it is outside this seat's view), startAt (this page's
    performance.now() of the contact), raw (true: the strength as given, the table's level not applied) } -> handle | null */
function play(kind, o = {}) {
  try {
    const tok = typeof o.token === "string" ? canvas?.tokens?.get?.(o.token) : o.token ?? null;
    let near = o.near ?? null;
    if (tok && !near) { near = tokScreen(tok); if (!near?.inView) return null; }
    const op = opts();
    const level = kind === "blood" ? op.blood : op.cracks;
    const s = o.raw ? P.scaled(o.strength ?? 0.5, 2) : P.scaled(o.strength ?? 0.5, level);
    if (!s) return null;
    const safe = photosensitive(), still = osReduced();
    const want = Number.isFinite(o.startAt) ? o.startAt : pnow();
    const t0 = P.arrivalAt(want, s, G.arrivals, safe);
    if (s >= P.BIG || safe) { G.arrivals.push(t0); G.arrivals = G.arrivals.filter((t) => t > pnow() - 3000); }
    const seed = o.seed ?? `${kind}|${++uid}|${Math.random()}`;
    /* GORECLEAR: beside a token the blood keeps clear of the other tokens this seat sees and of the lettering standing now */
    const others = kind === "blood" && tok ? tokDiscs(tok.id) : [], ink = kind === "blood" && tok ? inkBoxes() : [];
    /* GOREUI: ... and of the map's markers this seat draws (zone badges, note pins) */
    const marks = kind === "blood" && tok && CLEAR ? markShapes() : [];
    const keep = CLEAR && others.length + ink.length + marks.length ? [...others, ...marks, ...ink] : null;
    const spec = { strength: s, seed, dir: Number.isFinite(o.dir) ? o.dir : null, at: o.at ?? null, near: kind === "blood" ? near : null, safe, still, hold: op.hold, ...(keep ? { keep } : {}) };
    /* GOREUI: a break is sized by the table's level and breaks the corner this seat shows best (the seed's own when it is as free) */
    let scores = null;
    if (kind === "cracks") {
      spec.level = o.raw ? 2 : level;
      scores = Number.isInteger(o.corner) ? null : cornerScores(P.crackReachOf(s, spec.level, safe));
      spec.corner = Number.isInteger(o.corner) ? o.corner : P.pickCorner(seed, scores);
    }
    const make = (g) => (kind === "blood" ? P.bloodPlan(g, spec) : P.crackPlan(g, spec));
    if (!ensureGlass()) return null;
    fit();
    const it = { id: ++uid, kind, t0, make, plan: make(G.g), tok: tok?.id ?? null, pv: !!o.pv };
    if (kind === "blood" && tok) {
      /* the seat's log: how it was placed, and what of its standing ink lies on another token or on lettering as laid out */
      const on = it.plan.none ? { ink: 0, discs: 0, boxes: 0 } : R.inkOn(it.plan, discsPx(others), boxesPx(ink));
      const onMark = it.plan.none || !marks.length ? 0 : R.inkOn(it.plan, discsPx(marks), []).discs;
      it.log = { id: it.id, tok: tok.id, name: tok.name ?? null, at: Date.now(), strength: s, clear: CLEAR, how: it.plan.none ? "none" : it.plan.keepHow ?? "free", tokens: others.length, words: ink.length, marks: marks.length,
        r: Math.round(it.plan.R * 10) / 10, tokR: Math.round((near?.fr ?? 0) * Math.min(G.g.w, G.g.h) * 10) / 10, ink: on.ink, onTok: on.discs, onInk: on.boxes, onMark, maxTok: on.discs, maxInk: on.boxes, masked: 0, gaveWay: null };
      glog.push(it.log); if (glog.length > LOG_MAX) glog.shift();
    }
    if (kind === "cracks") {
      it.log = { id: it.id, kind: "cracks", at: Date.now(), strength: s, level: spec.level, corner: it.plan.corner, seedCorner: P.seedCorner(seed), scores: scores ? scores.map((v) => Math.round(v * 100) / 100) : null,
        reach: Math.round(P.crackReachOf(s, spec.level, safe) * Math.min(window.innerWidth, window.innerHeight)), masked: 0 };
      glog.push(it.log); if (glog.length > LOG_MAX) glog.shift();
    }
    /* GORE4: no room beside the token in this view (it fills the screen): no blood here rather than blood on it */
    if (it.plan.none) return null;
    /* GORE3: a new splash on a token: its older ones start to crumble as this one lands (one stain per character, no piling) */
    if (kind === "blood" && it.tok) for (const x of G.items) if (x.kind === "blood" && x.tok === it.tok && !(x.cutAt <= t0)) x.cutAt = Math.max(x.t0, t0);
    G.items.push(it);
    warmLater(it);
    /* too many alive: the oldest blood dissolves now */
    const blood = G.items.filter((x) => x.kind === "blood" && !Number.isFinite(x.cutAt));
    if (G.items.length > P.MAX_LIVE && blood.length) blood[0].cutAt = pnow();
    kick();
    return { id: it.id, kind, startAt: t0, strength: s, stop: () => { it.cutAt = pnow(); kick(); } };
  } catch (err) { once(err); return null; }
}
function clear({ quick = false } = {}) {
  if (quick) { G.items = []; hideIfEmpty(); return; }
  const now = pnow();
  for (const it of G.items) { if (it.kind === "blood") it.cutAt = Math.min(it.cutAt ?? Infinity, now); else it.t0 = Math.min(it.t0, now - P.breakAt(it.plan)); }
  kick();
}

/* ---------------- the table: a change of a character ---------------- */
const seen = new Map();        // token id -> { h, hm, r, rm }
const pending = new Map();     // token id -> { tok, changes: [], timer, waitHit, seed }
const lastPush = new Map();    // actor id -> Date.now() of a roll whose stress the character chose
const attacks = new Map();     // combat id -> { who, t }
const sources = new Map();     // target token id -> { src token id, t }
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);
function read(actor) {
  const d = actor?.system?.derived;
  return d ? { h: num(d.health?.value), hm: num(d.health?.max), r: num(d.resolve?.value), rm: num(d.resolve?.max) } : null;
}
function remember(tok) { try { const v = read(tok?.actor); if (v && tok?.id) seen.set(tok.id, v); } catch (e) { once(e); } }
function rememberAll() { seen.clear(); try { for (const t of canvas?.tokens?.placeables ?? []) remember(t); } catch (e) { once(e); } }

/** whether THIS seat may be shown an effect of this token (the table's "who sees it": plan.mjs seatShows; never a token this seat does
    not see). GOREOWN: without a choice given it is the table's default, the owner rule */
export function mayShow({ gm, sameScene, visible, hidden, owner, playerOwned }, seats = P.DEFAULTS[P.KEYS.seats]) {
  if (!sameScene || !visible) return false;
  if (hidden && !gm) return false;
  return P.seatShows(seats, { gm, owner, playerOwned });
}
/** GOREOWN: whether some PLAYER owns this character (a GM owns everything, so a GM never counts; a player who is not logged in still
    does: the answer does not change when someone leaves the table) */
export function playerOwned(actor) {
  try {
    for (const u of game.users ?? []) if (u && !u.isGM && actor?.testUserPermission?.(u, "OWNER")) return true;
  } catch { /* no users: nobody */ }
  return false;
}
/* where the board's canvas starts in the window (read at most twice a second) */
let originAt = -1e9, origin = { left: 0, top: 0 };
function boardOrigin() {
  const t = pnow();
  if (t - originAt > 500) { originAt = t; try { const r = canvas.app?.view?.getBoundingClientRect?.(); origin = { left: r?.left ?? 0, top: r?.top ?? 0 }; } catch { origin = { left: 0, top: 0 }; } }
  return origin;
}
/** where a token is on THIS screen: its middle and radius as fractions of the view (radius / the short side), and whether the view
    holds its middle */
export function tokScreen(tok) {
  try {
    const c = tok.center;
    let x, y;
    /* GORECLEAR: from the stage's own pivot and scale when it has them: while the camera moves they are a frame ahead of the drawn
       transform (clientCoordinatesFromCanvas reads the last drawn one), and the glass is drawn for the frame to come */
    const st = canvas.stage;
    if (st?.pivot && st.position && Number.isFinite(st.pivot.x) && Number.isFinite(st.position.x) && Number.isFinite(st.scale?.x)) {
      const o = boardOrigin();
      x = (c.x - st.pivot.x) * st.scale.x + st.position.x + o.left; y = (c.y - st.pivot.y) * (st.scale.y ?? st.scale.x) + st.position.y + o.top;
    } else if (typeof canvas.clientCoordinatesFromCanvas === "function") ({ x, y } = canvas.clientCoordinatesFromCanvas(c));
    else {
      const T = canvas.stage.worldTransform, rect = canvas.app?.view?.getBoundingClientRect?.() ?? { left: 0, top: 0 };
      x = T.a * c.x + T.c * c.y + T.tx + rect.left; y = T.b * c.x + T.d * c.y + T.ty + rect.top;
    }
    const sc = Math.abs(canvas.stage?.scale?.x ?? 1) || 1;
    /* GORE4: the token as it is DRAWN (its art may be scaled past its square: the blood keeps clear of what the table sees) */
    const art = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
    const r = (Math.max(art(tok.w), art(tok.h), art(tok.mesh?.width), art(tok.mesh?.height)) / 2) * sc;
    const vw = window.innerWidth, vh = window.innerHeight;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !(vw > 0) || !(vh > 0)) return null;
    return { fx: x / vw, fy: y / vh, fr: Math.max(0.004, r / Math.min(vw, vh)), inView: x >= 0 && y >= 0 && x <= vw && y <= vh };
  } catch { return null; }
}
function seatMay(tok, seats = opts().seats) {
  try {
    const gm = !!game.user?.isGM;
    return mayShow({ gm, sameScene: tok.scene?.id === canvas.scene?.id, visible: (tok.isVisible ?? tok.visible) !== false, hidden: tok.document?.hidden === true,
      owner: !gm && !!tok.actor?.testUserPermission?.(game.user, "OWNER"), playerOwned: seats === "owner" && gm ? playerOwned(tok.actor) : false }, seats);
  } catch { return false; }
}
function changed(tok, options) {
  try {
    if (!tok?.id || !tok.actor) return;
    const was = seen.get(tok.id), now = read(tok.actor);
    if (!now) return;
    seen.set(tok.id, now);
    if (!was) return;
    for (const [stat, a, b, m] of [["health", was.h, now.h, now.hm], ["resolve", was.r, now.r, now.rm]]) {
      if (a === null || b === null || !(b < a)) continue;
      let e = pending.get(tok.id);
      if (!e) { e = { tok, changes: [], stamp: options?.modifiedTime ?? null }; pending.set(tok.id, e); }
      e.changes.push({ stat, from: a, to: b, max: m, type: tok.actor.type, push: stat === "resolve" && Date.now() - (lastPush.get(tok.actor.id) ?? -1e9) < PUSH_MS && !options?.ipuTactics });
      clearTimeout(e.timer);
      e.timer = setTimeout(() => settle(tok.id), QUIET);
    }
  } catch (err) { once(err); }
}
function reactionsOn() { try { return game.settings.get(MOD, "tokenReactEnabled") !== false; } catch { return false; } }
function settle(id) {
  const e = pending.get(id);
  if (!e) return;
  if (!reactionsOn()) { fire(id, pnow()); return; }
  e.waitHit = true;
  e.timer = setTimeout(() => fire(id, pnow()), HIT_WAIT);
}
function onReact(d) {
  try {
    if (d?.phase !== "hit" || !Array.isArray(d.ids)) return;
    const at = Number.isFinite(d.at) ? d.at : pnow();
    /* GORECLEAR: the words of this blow are laid out by now and come up before it: a splash already on the glass where they will stand
       starts to crumble at once (asked a task later: the reactions are started right after this hook) */
    if (G.items.length) setTimeout(guard, 0);
    const mine = d.ids.filter((id) => pending.has(id));
    if (!mine.length) return;
    for (const id of mine) clearTimeout(pending.get(id).timer);
    /* the reaction's impact frame (drawn over the map, over this glass) plays right after this hook: the blood lands when it is over, so
       the splash is seen hitting the glass (the blow, then the spatter: one cut). Impacts are planned alike on every seat (engine KEEPBOX) */
    setTimeout(() => {
      const I = engineL?.impact;
      if (!I?.busy) { for (const id of mine) fire(id, at); return; }
      const t0 = pnow();
      const poll = () => {
        if (I.busy && pnow() - t0 < IMPACT_MAX) { setTimeout(poll, P.TICK_MS); return; }
        const now = pnow();
        for (const id of mine) fire(id, Math.max(at, now));
      };
      poll();
    }, 0);
  } catch (err) { once(err); }
}
function fire(id, at) {
  const e = pending.get(id);
  pending.delete(id);
  if (!e) return;
  clearTimeout(e.timer);
  try {
    const tok = canvas.tokens?.get(id) ?? e.tok;
    if (!tok) return;
    /* GOREOWN: this seat's answer for this hurt character, kept for a live check (api.who) */
    const may = seatMay(tok);
    wlog.push({ tok: tok.id, name: tok.name ?? null, at: Date.now(), seats: opts().seats, gm: !!game.user?.isGM, shown: may, stats: e.changes.map((c) => c.stat) });
    if (wlog.length > LOG_MAX) wlog.shift();
    if (!may) return;
    /* GORE3 (finding 5): a seat whose view does not hold the struck token saw no blow: no blood, no cracks there */
    const near = tokScreen(tok);
    if (!near?.inView) return;
    const seedBase = `${tok.id}|${e.stamp ?? e.changes.map((c) => `${c.stat}${c.from}>${c.to}`).join(",")}`;
    const dir = dirOf(tok);
    const done = new Set();
    for (const c of e.changes) {
      const fx = P.effectOf(c);
      if (!fx || done.has(fx.kind)) continue;
      done.add(fx.kind);
      play(fx.kind, { strength: fx.strength, seed: `${seedBase}|${fx.kind}`, dir: fx.kind === "blood" ? dir : null, startAt: at, token: tok, near });
    }
  } catch (err) { once(err); }
}
/* the way the blood flies: from the attacker through the struck token (the world's direction: the same on every seat), else the seed's */
function dirOf(tok) {
  try {
    const s = sources.get(tok.id);
    if (!s || Date.now() - s.t > ATTACK_MS) return null;
    const src = canvas.tokens?.get(s.src);
    /* GOREOWN: the attacker only has to be SEEN by this seat (it was asked "may this seat be shown the attacker's blood": under the
       owner rules a player's own character hit by someone else's lost its direction, and co-owners could get different ones) */
    if (!src || src.id === tok.id || !seatMay(src, "all")) return null;
    const a = src.center, b = tok.center;
    return Math.atan2(b.y - a.y, b.x - a.x);
  } catch { return null; }
}
function onTactics(ev) {
  try {
    if (!ev || typeof ev !== "object" || !ev.combat) return;
    if (ev.type === "roll" && ev.key === "attack" && typeof ev.who === "string") { attacks.set(ev.combat, { who: ev.who, t: Date.now() }); return; }
    if (ev.type !== "damage" || ev.source === "hazard") return;
    const a = attacks.get(ev.combat);
    if (!a || Date.now() - a.t > ATTACK_MS) return;
    const cmb = game.combats?.get(ev.combat);
    const target = typeof ev.target === "string" ? ev.target : ev.target?.combatant;
    const tgt = cmb?.combatants?.get(target)?.token?.id, src = cmb?.combatants?.get(a.who)?.token?.id;
    if (tgt && src) sources.set(tgt, { src, t: Date.now() });
  } catch (err) { once(err); }
}
function onMessage(m) {
  try { if (m?.speakerActor && m.rolls?.some?.((r) => choseStress(r))) lastPush.set(m.speakerActor.id, Date.now()); } catch { /* a courtesy */ }
}

/* ---------------- everyone's call: the same effect on every seat ---------------- */
function send(op, o = {}) {
  try {
    const at = Clock.toServer(Number.isFinite(o.startAt) ? o.startAt : pnow() + 120);
    const seed = o.seed ?? `${op}|${game.user?.id}|${Date.now()}`;
    const msg = { k: "gore", op, o: { ...o, seed, startAt: undefined }, at };
    game.socket?.emit(CHANNEL, msg);
    return receive(msg);
  } catch (err) { once(err); return null; }
}
function receive(msg) {
  if (!msg || msg.k !== "gore") return null;
  if (msg.op === "clear") { clear(msg.o ?? {}); return null; }
  if (msg.op !== "blood" && msg.op !== "cracks") return null;
  const o = msg.o && typeof msg.o === "object" ? msg.o : {};
  return play(msg.op, { strength: Number(o.strength), seed: String(o.seed ?? ""), dir: Number.isFinite(o.dir) ? o.dir : null, token: typeof o.token === "string" ? o.token : null,
    at: o.at && Number.isFinite(o.at.fx) && Number.isFinite(o.at.fy) ? { fx: o.at.fx, fy: o.at.fy } : null, startAt: Number.isFinite(msg.at) ? Clock.toPage(msg.at) : pnow() });
}

export const api = {
  /** blood on THIS screen: { strength 0..1 (1 = a knock-down), dir, token (beside it), at: { fx, fy }, seed, startAt, raw } -> handle | null */
  blood: (o) => play("blood", o),
  /** cracks on THIS screen: { strength, at, seed, startAt, raw } */
  cracks: (o) => play("cracks", o),
  clear,
  /** where a token sits on THIS screen: { fx, fy, fr, inView } (fractions of the view; the blood's anchor) */
  tokScreen: (t) => tokScreen(typeof t === "string" ? canvas?.tokens?.get(t) : t),
  /** the same effect on EVERY seat at one instant (each seat still applies the table's levels and its own accessibility; GOREOWN: a
      call made on purpose is not asked "who sees it", that rule is for a character being hurt) */
  net: { blood: (o) => send("blood", { ...o, token: typeof o?.token === "string" ? o.token : o?.token?.id }), cracks: (o) => send("cracks", o), clear: (o) => send("clear", o) },
  /** a sample on this screen (the table window's Preview): a light blow, a crack, a knock-down, AS THE TABLE IS SET (GORE4: it
      played at the normal level whatever the GM had chosen, so a change of level showed nothing; a level at 0 now shows nothing, the
      hold applies). Pressing it again replaces the last sample. -> how many of the three played */
  preview() {
    try {
      G.items = G.items.filter((it) => !it.pv);
      const t = pnow();
      return [play("blood", { strength: 0.35, seed: "preview|1", dir: 0.3, startAt: t, pv: true }),
        play("cracks", { strength: 0.6, seed: "preview|2", startAt: t + 700, pv: true }),
        play("blood", { strength: 1, seed: "preview|3", dir: 2.6, startAt: t + 1400, pv: true })].filter(Boolean).length;
    } catch (err) { once(err); return 0; }
  },
  state: () => {
    const c = [...G.cost].sort((a, b) => a - b);
    return { live: G.items.length, grid: G.g ? { w: G.g.w, h: G.g.h, px: G.g.px, dpr: G.g.dpr } : null, frames: G.frames, running: !!G.raf,
      costMs: c.length ? { p50: c[Math.floor(c.length / 2)], p95: c[Math.floor(c.length * 0.95)], max: c[c.length - 1], n: c.length } : null,
      pending: pending.size, cleared: G.items.filter((it) => Number.isFinite(it.cutAt)).length, opts: opts(), safe: photosensitive(), still: osReduced() };
  },
  resetCost: () => { G.cost = []; G.frames = 0; },
  /** GORECLEAR: this seat's last splashes beside a token: { how: "free" (nothing near) | "clean" (laid out clear of the keep-outs) |
      "none" (no clean place: no blood here), tokens, words (keep-outs seen), ink (px of standing ink), onTok / onInk (px of it on
      another token / on lettering as laid out), maxTok / maxInk (the most through its life), masked (px the glass left out over
      tokens), gaveWay (ms after landing it started to crumble for lettering) }; { clear: true } empties it */
  log: (o) => { if (o?.clear) glog.length = 0; return glog.map((e) => ({ ...e })); },
  /** GOREOWN: this seat's last hurt characters and whether their blood / cracks were for this seat: { tok, name, seats (the table's
      choice then), gm, shown, stats }; { clear: true } empties it */
  who: (o) => { if (o?.clear) wlog.length = 0; return wlog.map((e) => ({ ...e })); },
  /** what the blood would keep clear of on this seat now: { tokens: discs, words: boxes } in fractions of the view */
  keepOuts: () => ({ tokens: tokDiscs(), words: inkBoxes(), marks: markShapes(), ui: uiRects(0).length }),
  /** GOREUI: how much of each corner's quarter is taken on this seat for a web of `reach` (share of the view's short side; default a
      level 2 break of strength 0.6) -> [top left, top right, bottom right, bottom left] 0..1, or null */
  corners: (reach) => cornerScores(Number.isFinite(reach) ? reach : P.crackReachOf(0.6, 2)),
  /** a take's switch, this page only, never stored: { clear: false } lays blood out as before GORECLEAR */
  debug: (o) => { if (o && typeof o.clear === "boolean") CLEAR = o.clear; if (o && typeof o.marks === "boolean") MARKS = o.marks; return { clear: CLEAR, marks: MARKS }; }
};

function registerHooks() {
  Hooks.on("canvasReady", () => { rememberAll(); pending.clear(); clear({ quick: true }); });
  Hooks.on("drawToken", (tok) => { if (!seen.has(tok.id)) remember(tok); });
  Hooks.on("updateActor", (actor, changes, options) => {
    try {
      const d = changes?.system?.derived;
      if (!d || (!("health" in d) && !("resolve" in d))) return;
      for (const tok of actor.getActiveTokens?.(true) ?? []) changed(tok, options);
    } catch (err) { once(err); }
  });
  Hooks.on("updateToken", (doc, changes, options) => { try { if (changes?.delta || changes?.actorData) changed(doc.object, options); } catch (err) { once(err); } });
  Hooks.on("deleteToken", (doc) => { seen.delete(doc.id); pending.delete(doc.id); });
  Hooks.on(REACT_HOOK, onReact);
  Hooks.on(TAC_HOOK, onTactics);
  Hooks.on(TAC_HOOK_GM, onTactics);
  Hooks.on("createChatMessage", onMessage);
  Hooks.on("updateChatMessage", onMessage);
  window.addEventListener("resize", () => { if (G.items.length) kick(); });
  /* GORECLEAR: the camera moves under a splash: the glass is drawn again at once, in the camera's own step (not on its next 24 Hz
     beat), so the part of it over a token goes in the same frame the token arrives under it */
  Hooks.on("canvasPan", () => {
    try {
      if (!(CLEAR && G.items.some((it) => it.kind === "blood")) && !(MARKS && G.items.some((it) => it.kind !== "blood"))) return;
      clearTimeout(G.idle);
      if (G.raf) { try { cancelAnimationFrame(G.raf); } catch { /* none */ } G.raf = 0; }
      G.lastTick = -1;
      frame();
    } catch (err) { once(err); }
  });
}
export function start(phases = {}) {
  try {
    if (started) return true;
    started = true;
    const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
    run("init", () => { try { registerSettings(); registerHooks(); } catch (err) { once(err); } });
    run("ready", () => {
      try {
        if (canvas?.ready) rememberAll();
        Promise.resolve(globalThis.MoinenLetters?.engine?.()).then((L) => { engineL = L ?? null; }).catch(() => {});
        game.socket?.on(CHANNEL, (msg) => { try { receive(msg); } catch (err) { once(err); } });
        const mod = game.modules.get(MOD);
        if (mod) mod.api = Object.assign(mod.api ?? {}, { gore: api });
        globalThis.PlusUltraGore = api;
      } catch (err) { once(err); }
    });
    return true;
  } catch (err) { console.warn(LOG, "start failed", err); return false; }
}
