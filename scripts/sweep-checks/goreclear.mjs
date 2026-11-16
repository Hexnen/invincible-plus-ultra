// node scripts/sweep-checks/goreclear.mjs  (GORECLEAR, 2026-11-16. Seen live on a crowded board: a knock-down's blood lay over the
// neighbouring token's portrait and over the sound word lettered for that same blow. GORE4 kept blood off the STRUCK token only.)
// The rule: blood never hides another token's portrait nor the lettering of the moment, on any seat; it is still a splash with drops
// and still clearly there on a crowded board.
// Pure (scripts/gore/plan.mjs, raster.mjs):
//   SAME    a splash with nothing to keep clear of is GORE4's splash, byte for byte (pinned fingerprint of 180 plans);
//   CROWD   crowded boards (a struck token with neighbours square to square, the blow's word and number beside it, three windows,
//           three zooms, eight ways, three strengths): over a splash's WHOLE life (burst, squash, drops in flight, drips, drying,
//           clearing, flakes) no blood pixel lies on a neighbour's disc or in a lettering box; printed beside it: what the same
//           boards gave before (GORE4's layout), so the defect is on record;
//   SEEN    on those boards the splash is still drawn (few seats without a clean place), still beside its token, not shrunk under the
//           smallest allowed size, still carries drops;
//   GLASS   the glass draws no blood over a token under it (a disc handed to render): nothing inside, an outlined edge at the cut;
//   COST    laying a splash out among keep-outs stays cheap.
// Runtime on a fake Foundry (scripts/gore/main.mjs): a struck token's splash is laid out clear of the other tokens this seat sees
// and of the boxes the token reactions answer on their hook (phase "ink"); a token this seat does not see is no keep-out; lettering
// that comes to stand on a splash makes it crumble away at once (CLEAR_FAST), a splash clear of it stays; the seat's log tells it;
// api.debug({ clear: false }) is GORE4's behaviour. Source pins: the token reactions answer "ink" with their standing boxes.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const VERBOSE = !!process.env.GORECLEAR_VERBOSE;
const dir = dirname(fileURLToPath(import.meta.url)), root = join(dir, "..");
const P = await import("../gore/plan.mjs");
const R = await import("../gore/raster.mjs");
const T = P.TICK_MS;

/* ---------------- SAME: nothing to keep clear of = GORE4's splash ---------------- */
{
  const h = createHash("sha1");
  for (const [vw, vh] of [[1920, 1080], [1366, 768], [1600, 900]]) {
    const g = P.grid(vw, vh, 1);
    for (let i = 0; i < 60; i++) {
      const s = [0.25, 0.5, 0.8, 1, 1.25][i % 5];
      /* GOREUI restated this pin (honestly: the behaviour changed on purpose). It used to take all 180 plans; a third of them stand
         beside a token drawn at 4.5 % of the short side, which GOREUI's far rule now sizes smaller (the blind review of tag 161, D10:
         blood several token widths wide beside a small token; those sizes are checked in goreui.mjs, FAR). The pin now holds the 120
         plans that rule does not touch (no token, or a token at 9 %): still byte for byte what they were. */
      if (i % 3 === 1) continue;
      const near = i % 3 === 0 ? null : { fx: 0.08 + 0.84 * ((i * 37) % 100) / 100, fy: 0.08 + 0.84 * ((i * 61) % 100) / 100, fr: [0.02, 0.045, 0.09][i % 3] };
      const at = i % 7 === 3 ? { fx: 0.3, fy: 0.6 } : null;
      h.update(JSON.stringify(P.bloodPlan(g, { strength: s, seed: `fp|${i}`, dir: i % 4 === 0 ? null : i * 0.7, near, at, hold: 1 })));
    }
  }
  /* the fingerprint of these 120 plans on tag tactics-integrated-161 (the same plans as on 160: GORE4 + GOREPINK), taken before GOREUI */
  ck("a splash with no keep-outs, away from the far rule, is laid out exactly as before (120 plans, pinned fingerprint)", h.digest("hex") === "b4757598ec4b0d4f2122ce4c31b8c85d20449a1b");
  const g = P.grid(1600, 900, 1);
  const a = P.bloodPlan(g, { strength: 0.8, seed: "e", dir: 1, near: { fx: 0.5, fy: 0.5, fr: 0.05 } });
  const b = P.bloodPlan(g, { strength: 0.8, seed: "e", dir: 1, near: { fx: 0.5, fy: 0.5, fr: 0.05 }, keep: [] });
  const c = P.bloodPlan(g, { strength: 0.8, seed: "e", dir: 1, near: { fx: 0.5, fy: 0.5, fr: 0.05 }, keep: [{ fx: 0.05, fy: 0.05, fr: 0.03 }] });
  ck("an empty list of keep-outs changes nothing", JSON.stringify(a) === JSON.stringify(b));
  ck("a keep-out far from the splash moves nothing of it (same place, same way, same size; only drops that would reach it are left out)", c.keepHow === "clean" && c.cx === a.cx && c.cy === a.cy && c.dir === a.dir && c.R === a.R && c.sats.length === a.sats.length);
}

/* ---------------- CROWD / SEEN: crowded boards ---------------- */
const rnd = (seed) => P.rng(seed);
/* a board: the struck token, neighbours on the squares round it (pitch = one token: portraits rim to rim), the blow's word and number */
function board(ge, i) {
  const r = rnd(`board|${i}`), m = Math.min(ge.w, ge.h);
  const fr = [0.03, 0.045, 0.065][i % 3];                    // a far zoom .. a close one (token radius / the view's short side)
  const pitchX = (2 * fr * m) / ge.w, pitchY = (2 * fr * m) / ge.h;
  const edge = i % 5 === 4;                                   // every fifth board: the struck token near the view's edge
  const fx = edge ? [0.07, 0.93, 0.5, 0.5][(i / 5 | 0) % 4] : 0.25 + 0.5 * r(), fy = edge ? [0.5, 0.5, 0.1, 0.9][(i / 5 | 0) % 4] : 0.25 + 0.5 * r();
  const dens = [0.35, 0.6, 0.85][(i / 3 | 0) % 3];
  const toks = [];
  for (let gy = -2; gy <= 2; gy++) for (let gx = -2; gx <= 2; gx++) {
    if (!gx && !gy) continue;
    const ring = Math.max(Math.abs(gx), Math.abs(gy));
    if (r() < (ring === 1 ? dens : dens * 0.45)) toks.push({ fx: fx + gx * pitchX, fy: fy + gy * pitchY, fr });
  }
  /* the blow's word: on a side of the token (as the reactions place it), 4.5-7 token radii wide, 1.3-1.8 high; a number at its end */
  const side = Math.floor(r() * 4), ww = fr * m * (4.5 + 2.5 * r()), wh = fr * m * (1.3 + 0.5 * r()), gap = fr * m * 0.25;
  const tx = fx * ge.w, ty = fy * ge.h, tr = fr * m;
  const wc = side === 0 ? [tx, ty - tr - gap - wh / 2] : side === 1 ? [tx + tr + gap + ww / 2, ty] : side === 2 ? [tx, ty + tr + gap + wh / 2] : [tx - tr - gap - ww / 2, ty];
  const word = { l: (wc[0] - ww / 2) / ge.w, t: (wc[1] - wh / 2) / ge.h, r: (wc[0] + ww / 2) / ge.w, b: (wc[1] + wh / 2) / ge.h };
  const num = { l: word.r, t: word.t + (word.b - word.t) * 0.2, r: word.r + (fr * m * 1.6) / ge.w, b: word.b - (word.b - word.t) * 0.2 };
  return { near: { fx, fy, fr }, toks, words: [word, num], dirA: r() * Math.PI * 2, strength: [0.3, 0.7, 1][i % 3], seed: `crowd|${i}` };
}
const pxOf = (ge, b) => ({ discs: b.toks.map((t) => ({ x: t.fx * ge.w, y: t.fy * ge.h, r: t.fr * Math.min(ge.w, ge.h) })), boxes: b.words.map((q) => ({ x0: q.l * ge.w, y0: q.t * ge.h, x1: q.r * ge.w, y1: q.b * ge.h })) });
/* blood pixels on the board's tokens / lettering over a splash's whole life */
function lifeOn(ge, se, p, K) {
  const it = { plan: p, t0: 0 }, end = P.endOf(p);
  let onTok = 0, onInk = 0, drawn = 0;
  for (let k = 0; k * T <= end; k += k < 14 ? 1 : k * T > p.life.gone - 100 ? 1 : 9) {
    R.render(se, [it], k * T + 1);
    const a = se.rgba, b = se.box;
    if (!b) continue;
    for (let y = b.y0; y <= b.y1; y++) for (let x = se.lo[y]; x <= se.hi[y]; x++) {
      if (!a[(y * ge.w + x) * 4 + 3]) continue;
      if (k === 12) drawn++;
      const cx = x + 0.5, cy = y + 0.5;
      for (const d of K.discs) if ((cx - d.x) ** 2 + (cy - d.y) ** 2 < d.r * d.r) { onTok++; break; }
      for (const q of K.boxes) if (cx > q.x0 && cx < q.x1 && cy > q.y0 && cy < q.y1) { onInk++; break; }
    }
  }
  R.render(se, [], end + 5000);
  return { onTok, onInk, drawn };
}
{
  const wins = [[1600, 900, 1], [1366, 768, 1.25], [1920, 1080, 1]];
  const N = 72;      // boards per window
  let cases = 0, none = 0, onTok = 0, onInk = 0, undrawn = 0, far = 0, tiny = 0, fewDrops = 0, second = 0, downs = 0;
  let wasTok = 0, wasInk = 0, wasTokPx = 0, wasInkPx = 0, wasInkAll = 0, wasCases = 0;
  const ratio = [], worst = { tok: 0, ink: 0 };
  for (const [vw, vh, dpr] of wins) {
    const ge = P.grid(vw, vh, dpr), se = R.surface(ge.w, ge.h), m = Math.min(ge.w, ge.h);
    for (let i = 0; i < N; i++) {
      const b = board(ge, i + cases * 0), K = pxOf(ge, b);
      const base = { strength: b.strength, seed: `${b.seed}|${vw}`, dir: b.dirA, near: b.near };
      /* before: GORE4's layout on the same board */
      const p0 = P.bloodPlan(ge, base);
      if (!p0.none) {
        wasCases++;
        const o = R.inkOn(p0, K.discs, K.boxes);
        wasInkAll += o.ink;
        if (o.discs > 0) { wasTok++; wasTokPx += o.discs; worst.tok = Math.max(worst.tok, o.discs / o.ink); }
        if (o.boxes > 0) { wasInk++; wasInkPx += o.boxes; worst.ink = Math.max(worst.ink, o.boxes / o.ink); }
      }
      /* after */
      const p = P.bloodPlan(ge, { ...base, keep: [...b.toks, ...b.words] });
      cases++;
      if (p.none) { none++; continue; }
      const L = lifeOn(ge, se, p, K);
      onTok += L.onTok; onInk += L.onInk;
      if (!L.drawn) undrawn++;
      const tx = b.near.fx * ge.w, ty = b.near.fy * ge.h, tr = b.near.fr * m;
      /* still by its token: the body's middle within the search's reach of the rim */
      if (Math.hypot(p.cx - tx, p.cy - ty) > tr + P.TOK_GAP + p.R * (2.4 + P.KEEP_FAR) + 3.5) far++;
      const Rfree = P.bloodPlan(ge, { ...base, near: { ...b.near, fx: 0.5, fy: 0.5 } }).R;
      if (p.R < Rfree * Math.min(...P.KEEP_SHRINK) - 1e-9) tiny++;
      if (p.sats.length + p.tendrils.length < 4) fewDrops++;
      if (!p0.none) ratio.push(R.inkOn(p).ink / Math.max(1, R.inkOn(p0).ink));
      if (b.strength >= 1) { downs++; if (p.second) second++; }
    }
  }
  ratio.sort((a, b) => a - b);
  const med = ratio[ratio.length >> 1], p10 = ratio[Math.floor(ratio.length * 0.1)];
  console.log(`  before (GORE4's layout on the same ${wasCases} crowded boards): blood on a neighbour's portrait in ${wasTok} (${(100 * wasTok / wasCases).toFixed(0)} %), on the blow's lettering in ${wasInk} (${(100 * wasInk / wasCases).toFixed(0)} %); worst share of a splash's ink on a neighbour ${(100 * worst.tok).toFixed(0)} %, on lettering ${(100 * worst.ink).toFixed(0)} %`);
  console.log(`  after: ${cases} splashes, ${none} without a clean place (${(100 * none / cases).toFixed(1)} %), ink kept against the same splash before: median ${(100 * med).toFixed(0)} %, lowest tenth ${(100 * p10).toFixed(0)} %; a knock-down's second blow kept in ${second} of ${downs}`);
  ck(`the boards are crowded enough to show the defect (before: a neighbour covered in ${wasTok}, lettering in ${wasInk} of ${wasCases})`, wasTok > wasCases * 0.3 && wasInk > wasCases * 0.2);
  ck(`no blood pixel on another token's portrait over a splash's whole life (${cases} crowded splashes: ${onTok} px)`, onTok === 0);
  ck(`no blood pixel on the lettering of the blow over a splash's whole life (${onInk} px)`, onInk === 0);
  ck(`blood is still drawn on a crowded board: at most 3 % of the seats find no clean place (${none} of ${cases}), every other one draws (${undrawn} empty)`, none <= cases * 0.03 && undrawn === 0);
  ck(`... still by its token (${far} beyond the search's reach), never under the smallest allowed size (${tiny})`, far === 0 && tiny === 0);
  ck(`... still a splash with drops (${fewDrops} with fewer than four drops or spikes), and most of its ink kept (median ${(100 * med).toFixed(0)} %, lowest tenth ${(100 * p10).toFixed(0)} %)`, fewDrops <= cases * 0.03 && med >= 0.6 && p10 >= 0.3);
  ck(`a knock-down keeps its second blow on most crowded boards (${second} of ${downs})`, second >= downs * 0.6);
}
/* the cheapest clean place: the way the blood flies when it is free, the nearest other way when a neighbour stands there */
{
  const g = P.grid(1600, 900, 1), m = Math.min(g.w, g.h), fr = 0.05;
  const near = { fx: 0.5, fy: 0.5, fr }, px = (2 * fr * m) / g.w;
  const right = { fx: 0.5 + px, fy: 0.5, fr };
  const free = P.bloodPlan(g, { strength: 0.7, seed: "way", dir: 0, near, keep: [{ fx: 0.5, fy: 0.5 - (2 * fr * m) / g.h * 2, fr }] });
  const turned = P.bloodPlan(g, { strength: 0.7, seed: "way", dir: 0, near, keep: [right] });
  const d = Math.abs(Math.atan2(Math.sin(turned.dir), Math.cos(turned.dir)));
  ck("nothing in its way: the blood keeps the way it flies", !free.none && Math.abs(free.dir) < 1e-9);
  ck(`a neighbour square to square in its way: the splash turns to the nearest clean side (${(d * 180 / Math.PI).toFixed(0)} deg), same size, same drops`, !turned.none && d > 0.3 && d <= Math.PI / 2 + 0.01 && turned.R === free.R && turned.blobs[0].lob.join() === free.blobs[0].lob.join());
  /* walled in on every side with no gap anywhere in reach: no blood on that seat rather than blood on what it must keep clear of */
  const hx = (1.05 * fr * m) / g.w, hy = (1.05 * fr * m) / g.h;
  const wall = [{ l: 0, t: 0, r: 1, b: 0.5 - hy }, { l: 0, t: 0.5 + hy, r: 1, b: 1 }, { l: 0, t: 0, r: 0.5 - hx, b: 1 }, { l: 0.5 + hx, t: 0, r: 1, b: 1 }];
  const shut = P.bloodPlan(g, { strength: 0.7, seed: "way", dir: 0, near, keep: wall });
  ck("walled in by lettering with no gap in reach: no blood on that seat (never on the lettering)", shut.none === true && shut.keepHow === "none" && shut.blobs.length === 0);
}

/* ---------------- GLASS: no blood over a token under the glass ---------------- */
{
  const g = P.grid(1600, 900, 1), sf = R.surface(g.w, g.h);
  const p = P.bloodPlan(g, { strength: 1, seed: "glass", dir: 0.4, at: { fx: 0.4, fy: 0.5 } });
  const it = { plan: p, t0: 0 };
  R.render(sf, [it], 12 * T + 1);
  const full = sf.rgba.slice();
  const disc = { x: p.cx + p.R * 0.5, y: p.cy, r: p.R * 0.8 };
  let inside0 = 0;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (full[(y * g.w + x) * 4 + 3] && Math.hypot(x + 0.5 - disc.x, y + 0.5 - disc.y) < disc.r) inside0++;
  let inside = 0, changedOut = 0, rimDark = 0, rim = 0, worstLife = 0;
  for (let k = 0; k * T <= P.endOf(p); k += k < 14 ? 1 : 7) {
    R.render(sf, [it], k * T + 1, [disc]);
    let c = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (sf.rgba[(y * g.w + x) * 4 + 3] && Math.hypot(x + 0.5 - disc.x, y + 0.5 - disc.y) < disc.r) c++;
    worstLife = Math.max(worstLife, c);
  }
  R.render(sf, [it], 12 * T + 1, [disc]);
  const cut = sf.rgba;
  const lum = (a, o) => 0.2126 * a[o] + 0.7152 * a[o + 1] + 0.0722 * a[o + 2];
  for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
    const o = (y * g.w + x) * 4, d = Math.hypot(x + 0.5 - disc.x, y + 0.5 - disc.y);
    if (d < disc.r) { if (cut[o + 3]) inside++; continue; }
    if (!cut[o + 3] && full[o + 3]) changedOut++;
    /* a blood pixel right at the cut (a 4-neighbour inside the disc that was blood): it must be the outline's dark, as at any edge */
    if (cut[o + 3] && d < disc.r + 1.01 && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ax, ay]) => Math.hypot(x + ax + 0.5 - disc.x, y + ay + 0.5 - disc.y) < disc.r && full[((y + ay) * g.w + x + ax) * 4 + 3])) { rim++; if (lum(cut, o) <= lum(full, o) + 0.5) rimDark++; }
  }
  ck(`a token under the glass: no blood is drawn over it at any time of the splash's life (${inside0} px of the splash lay there; ${worstLife} drawn)`, inside0 > 200 && inside === 0 && worstLife === 0 && sf.cut > 0);
  ck("... nothing outside the token is taken away", changedOut === 0);
  ck(`... and the blood ends at the token's rim with its own dark outline, not a raw cut through its shading (${rimDark} of ${rim} rim pixels)`, rim > 20 && rimDark === rim);
  const o = R.inkOn(p, [disc], [{ x0: p.cx - 2, y0: p.cy - 2, x1: p.cx + 2, y1: p.cy + 2 }]);
  ck("inkOn counts a splash's standing ink on discs and in boxes", o.ink > 500 && o.discs > 200 && o.discs < o.ink && o.boxes === 16);
}

/* ---------------- COST ---------------- */
{
  const g = P.grid(1920, 1080, 1), ts = [];
  for (let i = 0; i < 40; i++) {
    const b = board(g, i);
    const t0 = process.hrtime.bigint();
    P.bloodPlan(g, { strength: 1, seed: `cost|${i}`, dir: b.dirA, near: b.near, keep: [...b.toks, ...b.words] });
    ts.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  ts.sort((a, b) => a - b);
  console.log(`  laying a knock-down's splash out among keep-outs (1920 x 1080, crowded): median ${ts[20].toFixed(1)} ms, worst ${ts[39].toFixed(1)} ms`);
  ck("laying a splash out among keep-outs: median under 12 ms, worst under 60 ms (once per splash, before its contact)", ts[20] < 12 && ts[39] < 60);
}

/* ---------------- runtime on a fake Foundry ---------------- */
{
  const hooks = {}, values = {}, settings = new Map();
  let clock = 1000;
  globalThis.performance = { now: () => clock };
  const timers = [];
  globalThis.setTimeout = (fn, ms) => { const t = { fn, at: clock + (ms ?? 0), id: timers.length + 1 }; timers.push(t); return t.id; };
  globalThis.clearTimeout = (id) => { const t = timers.find((x) => x.id === id); if (t) t.fn = null; };
  const rafs = [];
  globalThis.requestAnimationFrame = (fn) => { rafs.push(fn); return 1; };
  /* time passes: timers fire in order, the glass draws a frame every 20 ms */
  const advance = (ms) => { const end = clock + ms; while (clock < end) { const step = Math.min(end, clock + 20); for (;;) { const t = timers.filter((x) => x.fn && x.at <= step).sort((a, b) => a.at - b.at)[0]; if (!t) break; clock = Math.max(clock, t.at); const fn = t.fn; t.fn = null; fn(); } clock = step; for (const fn of rafs.splice(0)) fn(); } };
  globalThis.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  let lastPut = null;
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, after() {}, remove() {}, isConnected: true, getContext: () => ({ putImageData(img) { lastPut = img; }, clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4).fill(255) }) }) });
  const board = { ...el() };
  globalThis.document = { getElementById: (id) => (id === "board" ? board : null), createElement: () => el(), body: el() };
  globalThis.getComputedStyle = () => ({ zIndex: "0" });
  globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
  const user = { isGM: false, id: "P1" };
  globalThis.game = { user, settings: { settings, register: (m, k, o) => { settings.set(`${m}.${k}`, o); if (!(`${m}.${k}` in values)) values[`${m}.${k}`] = o.default; }, get: (m, k) => { if (!settings.has(`${m}.${k}`)) throw new Error("not registered"); return values[`${m}.${k}`]; } },
    modules: new Map([["invincible-plus-ultra", {}]]), socket: { on() {}, emit() {} }, combats: new Map() };
  settings.set("invincible-plus-ultra.tokenReactEnabled", {}); values["invincible-plus-ultra.tokenReactEnabled"] = false;      // blood plays after the short gathering wait
  const scene = { id: "S" };
  const mkTok = (id, x, y, o = {}) => { const actor = { id: `A${id}`, type: "character", system: { derived: { health: { value: 6, max: 6 }, resolve: { value: 6, max: 6 } } }, testUserPermission: () => true, getActiveTokens: () => [tok] }; const tok = { id, name: id, actor, scene, visible: true, isVisible: true, document: { hidden: !!o.hidden }, center: { x, y }, w: 100, h: 100 }; return tok; };
  /* a struck token in the middle, neighbours square to square right of it and below it, one more the players do not see above it */
  const toks = [mkTok("T1", 800, 450), mkTok("T2", 900, 450), mkTok("T3", 800, 550), mkTok("T4", 800, 350, { hidden: true })];
  globalThis.canvas = { ready: true, scene, stage: { scale: { x: 1 } }, clientCoordinatesFromCanvas: (c) => ({ x: c.x, y: c.y }), tokens: { get: (id) => toks.find((t) => t.id === id), get placeables() { return toks; } } };
  globalThis.MoinenLetters = { engine: () => ({ impact: { busy: false } }) };
  /* the token reactions' answer: the boxes standing on this seat now (client px) */
  let words = [];
  Hooks.on("invincible-plus-ultra.tokenReact", (d) => { if (d?.phase === "ink") for (const q of words) d.rects.push(q); });
  const M = await import("../gore/main.mjs?goreclear");
  M.start({ init: true, ready: true });
  await new Promise((r) => r());
  const api = game.modules.get("invincible-plus-ultra").api.gore;
  const hurt = (tok, to) => { tok.actor.system.derived.health.value = to; for (const fn of hooks.updateActor ?? []) fn(tok.actor, { system: { derived: { health: { value: to } } } }, { modifiedTime: 777 + to }); };
  const reset = () => { api.clear({ quick: true }); api.log({ clear: true }); words = []; for (const t of toks) t.actor.system.derived.health.value = 6; for (const fn of hooks.canvasReady ?? []) fn(); };
  const g = P.grid(1600, 900, 1), m = Math.min(g.w, g.h);
  const discOf = (t) => ({ x: (t.center.x / 1600) * g.w, y: (t.center.y / 900) * g.h, r: (50 / 900) * m });
  /* what the glass shows now: blood pixels on a disc / in a box (client px) */
  const shown = () => { const a = lastPut?.data; let c = 0; if (a) for (let j = 3; j < a.length; j += 4) if (a[j]) c++; return c; };
  const onDisc = (d) => { const a = lastPut?.data; let c = 0; if (a) for (let y = Math.max(0, Math.floor(d.y - d.r)); y <= Math.min(g.h - 1, Math.ceil(d.y + d.r)); y++) for (let x = Math.max(0, Math.floor(d.x - d.r)); x <= Math.min(g.w - 1, Math.ceil(d.x + d.r)); x++) if (a[(y * g.w + x) * 4 + 3] && Math.hypot(x + 0.5 - d.x, y + 0.5 - d.y) < d.r) c++; return c; };
  const onBox = (q) => { const a = lastPut?.data; let c = 0; const k = g.w / 1600; if (a) for (let y = Math.max(0, Math.floor(q.y * k)); y <= Math.min(g.h - 1, Math.ceil((q.y + q.h) * k)); y++) for (let x = Math.max(0, Math.floor(q.x * k)); x <= Math.min(g.w - 1, Math.ceil((q.x + q.w) * k)); x++) if (a[(y * g.w + x) * 4 + 3] && x + 0.5 > q.x * k && x + 0.5 < (q.x + q.w) * k && y + 0.5 > q.y * k && y + 0.5 < (q.y + q.h) * k) c++; return c; };

  ck("the api tells what the blood keeps clear of and keeps a log", typeof api.keepOuts === "function" && typeof api.log === "function" && typeof api.debug === "function" && api.debug().clear === true);
  reset();
  ck("the keep-outs of a player's seat: the tokens it sees (not the one hidden from it), the reactions' boxes", api.keepOuts().tokens.length === 3 && !api.keepOuts().tokens.some((t) => t.id === "T4") && api.keepOuts().words.length === 0);
  user.isGM = true;
  ck("... the GM's seat sees the hidden one too", api.keepOuts().tokens.length === 4);
  user.isGM = false;

  /* the live case: a knock-down, a neighbour right of the token and one below, the blow's word above it */
  const word = { x: 640, y: 330, w: 320, h: 62 };
  /* before: GORE4's layout (the page's take switch) */
  reset();
  api.debug({ clear: false });
  words = [word];
  hurt(toks[0], 0);
  advance(M.QUIET + 700);
  const was = api.log()[0];
  const wasShown = onDisc(discOf(toks[1])) + onDisc(discOf(toks[2])) + onBox(word);
  ck(`before (the take's switch off): the same knock-down lays blood on a neighbour or on the word (${was?.onTok} px on tokens, ${was?.onInk} px on lettering as laid out; ${wasShown} px shown there)`, !!was && was.clear === false && was.how === "free" && was.onTok + was.onInk > 0 && wasShown > 0);
  api.debug({ clear: true });
  /* after */
  reset();
  words = [word];
  hurt(toks[0], 0);
  advance(M.QUIET + 60);
  const e0 = api.log()[0];
  ck("a knock-down on a crowded board: laid out clean, blood on the glass", !!e0 && e0.how === "clean" && e0.tokens === 2 && e0.words === 1 && e0.ink > 300 && e0.onTok === 0 && e0.onInk === 0 && api.state().live === 1);
  let worstTok = 0, worstInk = 0, most = 0;
  for (let i = 0; i < 60; i++) { advance(100); most = Math.max(most, shown()); worstTok = Math.max(worstTok, onDisc(discOf(toks[1])) + onDisc(discOf(toks[2]))); worstInk = Math.max(worstInk, onBox(word)); }
  ck(`... through six seconds of it: blood shown (${most} px at most), none on a neighbour's portrait (${worstTok}), none on the word (${worstInk})`, most > 300 && worstTok === 0 && worstInk === 0);
  const e1 = api.log()[0];
  ck("... and the splash stayed (it did not give way to anything)", e1.gaveWay === null && e1.maxTok === 0 && e1.maxInk === 0 && e1.masked === 0);

  /* a token walks under a splash on the glass (or the camera moves): the glass leaves it free at once, the splash stays */
  reset();
  hurt(toks[0], 0);
  advance(M.QUIET + 900);
  const live1 = api.state().live, ink1 = shown();
  const pl = api.log()[0];
  /* T2 steps to where the blood lies: find a blood pixel and put it there */
  { const a = lastPut.data; let bx = -1, by = -1, best = 0; for (let y = 4; y < g.h - 4; y += 2) for (let x = 4; x < g.w - 4; x += 2) { let c = 0; for (let v = -3; v <= 3; v++) for (let u = -3; u <= 3; u++) if (a[((y + v) * g.w + x + u) * 4 + 3]) c++; if (c > best) { best = c; bx = x; by = y; } }
    toks[1].center = { x: (bx / g.w) * 1600, y: (by / g.h) * 900 }; }
  advance(100);
  const under = onDisc(discOf(toks[1]));
  advance(1500);
  ck(`a token comes to stand under a splash: no blood over it from the next drawing on (${under} px), the rest of the splash stays (${shown()} of ${ink1} px)`, live1 === 1 && ink1 > 300 && under === 0 && onDisc(discOf(toks[1])) === 0 && shown() > ink1 * 0.3 && api.state().live === 1 && api.log()[0].masked > 0 && api.log()[0].gaveWay === null);
  /* the camera moves (every token shifts on the screen at once): the glass is drawn again in the camera's own step, not on its next beat */
  { const a = lastPut.data; let bx = -1, by = -1, best = 0; for (let y = 4; y < g.h - 4; y += 2) for (let x = 4; x < g.w - 4; x += 2) { let c = 0; for (let v = -3; v <= 3; v++) for (let u = -3; u <= 3; u++) if (a[((y + v) * g.w + x + u) * 4 + 3]) c++; if (c > best) { best = c; bx = x; by = y; } }
    toks[2].center = { x: (bx / g.w) * 1600, y: (by / g.h) * 900 };
    const stale = onDisc(discOf(toks[2]));
    for (const fn of hooks.canvasPan ?? []) fn();
    ck(`the camera moves a token under a splash: the glass is drawn again in the same step, no blood over it (${stale} px lay there; ${onDisc(discOf(toks[2]))} after)`, (hooks.canvasPan ?? []).length > 0 && stale > 0 && onDisc(discOf(toks[2])) === 0 && shown() > 100); }
  toks[2].center = { x: 800, y: 550 };
  /* a token whose picture fills its square (opaque corners, no ring): its whole square is kept free, not only the disc in it */
  { toks[1].document.texture = { src: "square.webp" }; toks[1].mesh = { texture: { baseTexture: { resource: { source: { width: 64, height: 64 } } } } };
    const a = lastPut.data; let bx = -1, by = -1, best = 0; for (let y = 6; y < g.h - 6; y += 2) for (let x = 6; x < g.w - 6; x += 2) { let c = 0; for (let v = -5; v <= 5; v++) for (let u = -5; u <= 5; u++) if (a[((y + v) * g.w + x + u) * 4 + 3]) c++; if (c > best) { best = c; bx = x; by = y; } }
    toks[1].center = { x: (bx / g.w) * 1600, y: (by / g.h) * 900 };
    const sq = { x: toks[1].center.x - 50, y: toks[1].center.y - 50, w: 100, h: 100 };
    const lay = onBox(sq);
    advance(100);
    const kept = api.keepOuts().tokens.find((t) => t.id === "T2");
    ck(`a token with a square picture under a splash: kept as a box, its whole square free (${lay} px lay there; ${onBox(sq)} after)`, kept && kept.l !== undefined && kept.fr === undefined && lay > 0 && onBox(sq) === 0 && shown() > 100);
    delete toks[1].document.texture; delete toks[1].mesh; }
  toks[1].center = { x: 900, y: 450 };

  /* lettering comes to stand on a splash already on the glass: the splash crumbles away at once, quickly */
  reset();
  hurt(toks[0], 0);
  advance(M.QUIET + 900);
  { const a = lastPut.data; let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1; for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (a[(y * g.w + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const k = 1600 / g.w; words = [{ x: x0 * k, y: y0 * k, w: (x1 - x0 + 1) * k, h: ((y1 - y0 + 1) * k) / 2 }]; }
  const before = shown();
  /* the next blow's reaction announces itself (its words are laid out): asked at once */
  Hooks.callAll("invincible-plus-ultra.tokenReact", { phase: "hit", at: clock + 228, ids: ["T2"] });
  advance(30);
  const gw = api.log()[0];
  advance(P.CLEAR_FAST - P.FLAKE_MS + 60);
  const body = onBox(words[0]);
  advance(P.FLAKE_MS + 200);
  ck(`lettering comes to stand on a splash: it starts to crumble at once and is off the word in ${P.CLEAR_FAST - P.FLAKE_MS} ms (${before} px before; ${body} px then, its last flakes still falling), gone by ${P.CLEAR_FAST} ms`, before > 300 && gw.gaveWay !== null && body <= before * 0.01 && shown() === 0);
  advance(1200);
  ck("... and it is off the glass's list soon after (not kept until its planned end)", api.state().live === 0);
  ck("a quick crumble is still a crumble (shorter than the ordinary clearing, longer than its flakes' fall: no cut)", P.CLEAR_FAST < P.DISSOLVE && P.CLEAR_FAST - P.FLAKE_MS >= 6 * T);

  /* lettering beside a splash: nothing happens to it */
  reset();
  hurt(toks[0], 0);
  advance(M.QUIET + 900);
  words = [{ x: 20, y: 20, w: 200, h: 50 }];
  Hooks.callAll("invincible-plus-ultra.tokenReact", { phase: "hit", at: clock + 228, ids: ["T2"] });
  advance(1500);
  ck("lettering that stands clear of a splash leaves it alone", api.state().live === 1 && api.log()[0].gaveWay === null && shown() > 300);

  /* a seat's view without a neighbour: the splash is GORE4's own */
  reset();
  const lone = toks.splice(1);
  hurt(toks[0], 0);
  advance(M.QUIET + 60);
  ck("no other token, no lettering: the splash is laid out as before (free)", api.log()[0]?.how === "free" && api.state().live === 1);
  toks.push(...lone);
  reset();
}

/* ---------------- source pins ---------------- */
{
  const tr = readFileSync(join(root, "tokenreact", "main.mjs"), "utf8"), gm = readFileSync(join(root, "gore", "main.mjs"), "utf8");
  ck("the token reactions answer the hook's phase \"ink\" with their standing boxes (layout.mjs standAt, where follow() last drew them)", /phase === "ink"\) inkNow\(d\.rects\)/.test(tr) && /function inkNow\(rects\)[\s\S]{0,900}Lay\.standAt\(c, p\.g, k\)/.test(tr) && /plan\.at = \{ c, k \}/.test(tr));
  ck("the glass asks them when a splash is laid out, while one stays, and when a blow announces itself", /Hooks\.callAll\(REACT_HOOK, \{ phase: "ink", rects \}\)/.test(gm) && /tick % P\.GUARD_TICKS === 0\) guard\(now\)/.test(gm) && /if \(G\.items\.length\) setTimeout\(guard, 0\)/.test(gm));
  ck("the glass is drawn again when the camera moves, from the stage's own pivot and scale (a frame ahead of the drawn transform)", gm.includes('Hooks.on("canvasPan"') && gm.includes("(c.x - st.pivot.x) * st.scale.x + st.position.x + o.left"));
  ck("the take's switch is never stored (no setting, no flag)", !/settings\.(register|set)\([^)]*[cC]lear/.test(gm) && /let CLEAR = true/.test(gm));
}

console.log(`sweep goreclear: ${n} checks, ${f} failed`);
if (f) process.exit(1);
