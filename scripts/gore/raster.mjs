/* GORE: the pixel painter, PURE (typed arrays only; node checks run it). Draws the live plans (plan.mjs) at one instant into an RGBA
   buffer of the art grid, one art pixel per buffer pixel; main.mjs shows it scaled by a whole number of device px with no smoothing.
   Every pixel is one of the palette's colours at one of a few alphas: no gradients, no anti-aliasing (pixel art; checked).

   Two passes:
     1. shapes into fields: blood thickness T (0..1) + its stage S (0 wet, 1 drying, 2 dried; the youngest wins) + glint G;
        cracks into a class map C (1 line, 2 lit edge, 3 crushed glass, 4 chip, 5 running glint)
     2. colour: thickness bands (dark / mid / bright, a 2x2 dither on the band edges), a dark outline where blood meets glass, a lit
        inner rim toward the top left, glints while wet; the crack classes under it; the middle of the view see-through (CENTRE).
   Cost: proportional to the drawn area (bounding boxes), not to the screen; a full 1080p glass is 640 x 360 art px. */
import { TICK_MS, CENTRE, FLAKE_MS, FALL, FALL_MS, rng, dripAt, crackReach, breakAt } from "./plan.mjs";

export const THR = 0.06;
/* palettes: [r, g, b] per role; alpha per stage */
export const PAL = {
  wet:    { out: [58, 4, 10],  d: [112, 8, 18], m: [170, 16, 28], b: [214, 36, 44], lit: [255, 112, 100], spec: [255, 232, 224] },
  drying: { out: [46, 6, 10],  d: [88, 12, 18], m: [122, 20, 26], b: [146, 30, 34], lit: [170, 52, 50],  spec: [170, 52, 50] },
  dried:  { out: [34, 8, 8],   d: [66, 14, 14], m: [84, 22, 20], b: [96, 28, 24],  lit: [104, 34, 30],  spec: [104, 34, 30] }
};
/* GORE2: the pale dry crust of the crumbling front and its flakes (every stage: a splash cut early crumbles too) */
PAL.wet.crumb = PAL.drying.crumb = PAL.dried.crumb = [178, 94, 74];
/* the photosensitive seat's blood: no saturated red (R / (R + G + B) < 0.7 for every colour) */
export const PAL_SAFE = {
  wet:    { out: [44, 16, 18], d: [84, 32, 32], m: [110, 42, 40], b: [130, 54, 50], lit: [160, 88, 82], spec: [222, 196, 190] },
  drying: { out: [40, 16, 16], d: [74, 30, 28], m: [96, 38, 34], b: [110, 46, 42], lit: [124, 60, 54], spec: [124, 60, 54] },
  dried:  { out: [34, 14, 12], d: [60, 26, 22], m: [74, 32, 28], b: [84, 38, 32], lit: [90, 44, 38], spec: [90, 44, 38] }
};
PAL_SAFE.wet.crumb = PAL_SAFE.drying.crumb = PAL_SAFE.dried.crumb = [150, 112, 100];
export const ALPHA = [236, 222, 196];        // wet, drying, dried: on arrival
/* after the hit the glass lets the table read through the blood: SETTLE ms after its arrival a splash keeps SEE of its alpha */
export const SETTLE = 450, SEE = 0.7;
/* GORE2 («dużo subtelniejsze»): hairlines, see-through; 8 = a falling shard's lit glass */
export const CRACK = { 1: [14, 20, 28, 168], 2: [226, 240, 252, 150], 3: [228, 240, 252, 176], 4: [208, 230, 250, 196], 5: [255, 255, 255, 236], 6: [230, 244, 255, 16], 7: [8, 14, 24, 22], 8: [226, 242, 255, 72] };

export function surface(w, h) {
  return { w, h, T: new Float32Array(w * h), L: new Float32Array(w * h), S: new Uint8Array(w * h).fill(255), G: new Uint8Array(w * h), C: new Uint8Array(w * h), A: new Uint8Array(w * h).fill(1), N: new Uint8Array(w * h).fill(1),
    rgba: new Uint8ClampedArray(w * h * 4), box: null, prev: null };
}

/** draw the live items ({ plan, t0, cutAt? }) at `now` (ms, the same clock as t0). -> { box (dirty: this frame's and the last one's
    drawn area) | null, live: how many still draw, moving: whether the next tick can differ } */
export function render(sf, items, now) {
  const { w, h, T, S, G, C } = sf;
  const prev = sf.box;
  if (prev) { clearBox(sf, prev); }
  const box = { x0: w, y0: h, x1: -1, y1: -1 };
  let live = 0, moving = false;
  const ctx = { sf, box, w, h };
  for (const it of items) {
    const ms = Math.floor((now - it.t0) / TICK_MS) * TICK_MS;
    if (ms < 0) { moving = true; continue; }
    const p = it.plan;
    if (p.kind === "cracks") {
      if (ms > p.life.gone) continue;
      live++; if (ms < 1700 || ms > breakAt(p) - 50) moving = true;
      drawCracks(ctx, p, ms);
    } else {
      const parts = [[p, ms]];
      if (p.second) parts.push([p.second.plan, ms - p.second.delay]);
      for (const [q, m] of parts) {
        if (m < 0) { moving = true; continue; }
        const gone = Math.min(q.life.gone, Number.isFinite(it.cutAt) ? Math.max(0, it.cutAt - it.t0) : Infinity);
        if (m > gone + q.life.dissolve) continue;
        live++;
        if (m < q.life.dry + 200 || m > gone - 50 || q.drips.some((d) => { const s = dripAt(d, m); return s.moving || s.swell < 1 || s.y < d.len; })) moving = true;
        drawBlood(ctx, q, m, gone);
      }
    }
  }
  colour(sf, box, items.some((it) => it.plan.safe) ? PAL_SAFE : PAL);
  sf.box = box.x1 >= 0 ? box : null;
  const dirty = union(prev, sf.box);
  return { box: dirty, live, moving };
}
function union(a, b) {
  if (!a) return b; if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
function clearBox(sf, b) {
  const { w, T, L, S, G, C, A, N, rgba } = sf;
  for (let y = b.y0; y <= b.y1; y++) {
    const o = y * w;
    T.fill(0, o + b.x0, o + b.x1 + 1); L.fill(0, o + b.x0, o + b.x1 + 1); S.fill(255, o + b.x0, o + b.x1 + 1); G.fill(0, o + b.x0, o + b.x1 + 1); C.fill(0, o + b.x0, o + b.x1 + 1); A.fill(1, o + b.x0, o + b.x1 + 1); N.fill(1, o + b.x0, o + b.x1 + 1);
    rgba.fill(0, (o + b.x0) * 4, (o + b.x1 + 1) * 4);
  }
}

/* ---------------- blood ---------------- */
function drawBlood(ctx, p, ms, gone) {
  const still = p.still;
  const k = still ? 99 : Math.floor(ms / TICK_MS + 1e-6);
  const stage = ms < p.life.wet ? 0 : ms < p.life.dry ? 1 : 2;
  /* a splash whose middle lies in the readable centre of the view is see-through as a whole (one look per splash, never a seam) */
  const settled = ms >= SETTLE || still;
  const see = ((p.cx / ctx.w - 0.5) / CENTRE.rx) ** 2 + ((p.cy / ctx.h - 0.5) / CENTRE.ry) ** 2 < 1;
  /* GORE2, clearing: the crust CRUMBLES. Each pixel's depth = its distance (art px) from the edge of the settled splash; a pixel stays
     while its depth beats the erosion front E (+ a coarse 2x2 grain, so the edge breaks up in crumbs, never in a screen-door pattern).
     E moves in on twos at a steady pace: mist and small drops go first, the body shrinks to its heart. A few eroded pixels become FLAKES
     that fall off for FLAKE_MS (pure: the moment a pixel eroded follows from its depth). */
  const dms = ms - gone, diss = dms > 0;
  const er = diss ? erosion(p, dms, still) : null;
  const dep = er ? depthOf(p, ctx.w) : null;
  const raw = (x, y, t, l, gl = 0) => {
    const i = y * ctx.w + x, sf = ctx.sf;
    if (gl) sf.G[i] = gl;
    if (t > sf.T[i]) { sf.T[i] = t; sf.L[i] = l; }
    if (stage < sf.S[i]) sf.S[i] = stage;
    if (!see) sf.A[i] = 0;
    if (!settled) sf.N[i] = 0;
    const b = ctx.box;
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  };
  const put = (x, y, t, l = 0.45) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= ctx.w || y >= ctx.h) return;
    if (er) {
      const n = grain(x, y);
      const D = x >= dep.x0 && y >= dep.y0 && x < dep.x0 + dep.bw && y < dep.y0 + dep.bh ? dep.d[(y - dep.y0) * dep.bw + (x - dep.x0)] || 1 : 1;
      if (D <= er.E + n) {
        if (er.flakes && D >= 2 && hash2(x, y) < FLAKE_RATE) {
          const age = er.tick - er.span * Math.min(1, Math.max(0, (D - n) / er.Emax)) ** (1 / ERODE_POW);
          if (age >= 0 && age < FLAKE_MS) {
            const a = age / 1000, hs = hash2(y + 7, x + 3);
            const fx = Math.round(x + (hs - 0.5) * 40 * a), fy = Math.round(y + 1 + 0.5 * FLAKE_G * a * a);
            if (fx >= 0 && fy >= 0 && fx < ctx.w && fy < ctx.h) { raw(fx, fy, 0.5, 0.3, 3); if (hs < 0.45 && fx + 1 < ctx.w) raw(fx + 1, fy, 0.5, 0.3, 3); }
          }
        }
        return;
      }
      if (D <= er.E + n + CRUMB) ctx.sf.G[y * ctx.w + x] = 2;      // the crumbling front: a ring of pale dry crust walking inward
    }
    const i = y * ctx.w + x, sf = ctx.sf;
    if (t > sf.T[i]) { sf.T[i] = t; sf.L[i] = l; }
    if (stage < sf.S[i]) sf.S[i] = stage;
    if (!see) sf.A[i] = 0;
    if (!settled) sf.N[i] = 0;
    const b = ctx.box;
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x; if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  };
  /* the shapes of a tick are the same every time it is drawn (the seed decides them): each tick's pixels are recorded once (warm()
     records them ahead, before the contact) and replayed; from tick SETTLED on the splash stands still */
  const c = tickPixels(p, Math.min(k, SETTLED), still);
  for (let j = 0; j < c.idx.length; j++) { const i = c.idx[j]; put(i % ctx.w, (i / ctx.w) | 0, c.t[j], c.l[j]); }
  /* drips: a bead swells, then runs; the trail thins behind the head */
  for (const d of p.drips) {
    const st = still ? (ms >= 0 ? { y: d.len, moving: false, swell: 1 } : null) : dripAt(d, ms);
    if (!st || (!still && ms < d.start - 1)) continue;
    const yTop = d.y | 0, yHead = d.y + st.y;
    for (let yy = yTop; yy < yHead; yy++) {
      const x = d.x + Math.round(Math.sin(yy * 0.18 + d.wob) * 0.7);
      const thick = (yy - yTop) < (yHead - yTop) * 0.45 && d.w > 1;
      put(x, yy, 0.42);
      if (thick) put(x + 1, yy, 0.42);
    }
    const hx = d.x + Math.round(Math.sin(yHead * 0.18 + d.wob) * 0.7);
    disc(put, hx + (d.w > 1 ? 0.5 : 0), yHead, 0.6 + 1.0 * st.swell, 0.95);
    if (stage === 0 && st.swell >= 1 && !er) glint(ctx, hx, Math.round(yHead) - 1, false);
  }
  if (stage === 0 && !er) for (const gl of p.glints) if (k >= 2) glint(ctx, gl.x, gl.y, gl.big);
}
/* a dome's light: its normal against a light from the top left, toward the viewer (0 = away, 1 = full) */
const LX = -0.48, LY = -0.58, LZ = 0.66;
function light(nx, ny, z) { return Math.max(0, Math.min(1, nx * LX + ny * LY + z * LZ)); }
/* blood on glass is a PUDDLE, not a ball: flat on top (lit evenly), curved only in a rim RIM px wide (lit crescent top left, shadow bottom
   right); (vx, vy) from the middle, d = 0..1 to the edge, rpx = its radius in px */
const RIM = 3;
function puddle(vx, vy, d, rpx) {
  const l = Math.hypot(vx, vy) || 1;
  const e = Math.max(0, Math.min(1, ((1 - d) * rpx) / RIM));      // 0 at the edge .. 1 inside
  const k = Math.max(Math.sqrt(1 - e * e) * 0.95, 0.55 * d ** 1.5);      // the rim, and a gentle swell of the whole puddle
  return light((vx / l) * k, (vy / l) * k, Math.sqrt(1 - k * k));
}
export const SETTLED = 8;      // ticks: by then every blob, tendril, satellite and mist dot has landed (plan.mjs: arrivals <= 6)
function tickPixels(p, k, still) {
  const key = still ? SETTLED : k;
  const cache = p._ticks ??= [];
  if (cache[key]) return cache[key];
  const { w, h } = p.g, map = new Map();
  shapes(p, still ? 99 : key >= SETTLED ? 99 : key, still || key >= SETTLED, (x, y, t, l = 0.45) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x, o = map.get(i);
    if (!o || t > o[0]) map.set(i, [t, l]);
  });
  const idx = new Int32Array(map.size), t = new Float32Array(map.size), l = new Float32Array(map.size);
  let j = 0;
  for (const [i, v] of map) { idx[j] = i; t[j] = v[0]; l[j] = v[1]; j++; }
  return (cache[key] = { idx, t, l });
}
/** record a splash's drawings ahead (main.mjs calls it while the contact is still to come): its first ticks then cost a replay only */
export function warm(p, from = 0, upTo = SETTLED) {
  if (p.kind !== "blood") { if (upTo >= SETTLED) shardsOf(p, p.g.w, p.g.h); return; }
  for (const q of p.second ? [p, p.second.plan] : [p]) {
    for (let k = from; k <= upTo; k++) tickPixels(q, k, q.still);
    if (upTo >= SETTLED) depthOf(q, q.g.w);      // GORE2: the crumble's depth map, long before it is needed
  }
}
/* a standing shape drawn once into a pixel list, then replayed */
function replay(o, put, draw) {
  if (!o._px) {
    const xs = [], ys = [], ts = [], ls = [];
    draw((x, y, t, l = 0.45) => { xs.push(x | 0); ys.push(y | 0); ts.push(t); ls.push(l); });
    o._px = { xs: Int16Array.from(xs), ys: Int16Array.from(ys), ts: Float32Array.from(ts), ls: Float32Array.from(ls) };
  }
  const c = o._px;
  for (let j = 0; j < c.xs.length; j++) put(c.xs[j], c.ys[j], c.ts[j], c.ls[j]);
}
/* the standing shapes of a splash at tick k (everything but the drips) */
function shapes(p, k, still, put) {
  const { dx, dy } = p;
  /* the main mass and its rim bumps */
  for (const b of p.blobs) {
    if (k < b.at) continue;
    if (b.main && k === 0) {
      /* GORE2: the BURST (tick 0): a small ragged core where it hits and spray lines shooting out the way it flies, each a drop
         in flight with its speed trail; no glob in flight (the old oval smear read as spit) */
      blob(put, b, 0.55, 1, 1, dx, dy, 1.8, 0.9);
      for (const st of p.streaks) {
        const ux = Math.cos(st.a), uy = Math.sin(st.a);
        const hx = b.x + ux * (st.d0 + st.len), hy = b.y + uy * (st.d0 + st.len);
        taper(put, hx, hy, -ux, -uy, st.len, st.w * 2, 0.6);
      }
      continue;
    }
    const squash = k === b.at && !still;
    if (squash) blob(put, b, 1.1, 1.0, 1, dx, dy, 0.5, 0.85);
    else replay(b, put, (q) => blob(q, b, 1, b.e, 1, dx, dy, 1, 1));
  }
  /* tendrils growing over three ticks, crown beads at the tips */
  for (const td of p.tendrils) {
    if (k < td.at) continue;
    const g = Math.min(1, (k - td.at + 1) / td.grow);
    const draw = (q) => {
      let x = td.x, y = td.y;
      const n = Math.max(2, Math.ceil(td.len * g * 2));
      for (let i = 0; i <= n; i++) {
        const u = (i / n) * g, a = td.a + td.bend * u;
        x = td.x + Math.cos(a) * td.len * u; y = td.y + Math.sin(a) * td.len * u;
        disc(q, x, y, Math.max(0.55, (td.w0 / 2) * (1 - u) ** 0.8), 0.75);
      }
      if (g >= 1) disc(q, x, y, td.bead, 0.9);
    };
    if (g >= 1) replay(td, put, draw); else draw(put);
  }
  /* drops: in FLIGHT the tick before they land (the head short of its spot, a thin speed trail back toward the hit), SQUASHED across
     their way on the tick they land, then a round drop or an exclamation-mark drop (head out, tail pointing home) */
  for (const s of p.sats) {
    const ux = Math.cos(s.a), uy = Math.sin(s.a);
    if (!still && k === s.at - 1) {
      const back = (s.k - 1) * p.R * 0.3;
      const hx = s.x - ux * back, hy = s.y - uy * back;
      disc(put, hx, hy, Math.max(0.6, s.r * 0.8), s.h);
      taper(put, hx - ux * s.r * 0.6, hy - uy * s.r * 0.6, -ux, -uy, Math.max(3, back * 0.9), Math.max(1, s.r * 0.9), 0.5);
      continue;
    }
    if (k < s.at) continue;
    const land = k === s.at && !still;
    const draw = (q) => {
      if (land) { ellipse(q, s.x, s.y, s.r * 0.8, s.r * 1.35, ux, uy, s.h); return; }
      disc(q, s.x, s.y, s.r, s.h);
      if (s.tail) taper(q, s.x - ux * s.r * 0.5, s.y - uy * s.r * 0.5, -ux, -uy, s.tail, s.r * 1.5, s.h * 0.8);
    };
    if (land) draw(put); else replay(s, put, draw);
  }
  for (const m of p.mist) {
    if (k < m.at) continue;
    put(m.x, m.y, 0.3);
    if (m.two) put(m.x + 1, m.y, 0.3);
  }
}
/* the crumble's tables: erosion from E0 to EMAX (above the thickest pixel plus the grain), the grain, the flake rate and fall */
export const CRUMB = 1.6, GRAIN = 1.2, FLAKE_RATE = 0.07, FLAKE_G = 300, ERODE_POW = 1.25;
function erosion(p, dms, still) {
  const q = still ? 375 : 2 * TICK_MS;                       // on twos (a reduced-motion seat: four stills)
  const span = p.life.dissolve - (still ? 0 : FLAKE_MS);     // the erosion; the flakes of its last pixels finish by the end
  const v = Math.min(1, Math.floor(dms / q) * q / span + (still ? 0.25 : 0));
  const Emax = depthOf(p, p.g.w).max + GRAIN + 0.5;
  return { E: Emax * v ** ERODE_POW, Emax, span, tick: Math.floor(dms / TICK_MS) * TICK_MS, flakes: !still };
}
/* each settled pixel's distance from the splash's edge (chamfer 3-4, in art px), once per plan */
function depthOf(p, w) {
  if (p._dep) return p._dep;
  const c = tickPixels(p, SETTLED, p.still);
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (const i of c.idx) { const x = i % w, y = (i / w) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return (p._dep = { x0: 0, y0: 0, bw: 0, bh: 0, d: new Uint8Array(0), max: 1 });
  x0--; y0--; x1++; y1++;
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, BIGD = 1e4;
  const f = new Float32Array(bw * bh);
  for (let j = 0; j < c.idx.length; j++) { if (c.t[j] <= THR) continue; const i = c.idx[j]; f[(((i / w) | 0) - y0) * bw + (i % w) - x0] = BIGD; }
  const at = (x, y) => (x < 0 || y < 0 || x >= bw || y >= bh ? 0 : f[y * bw + x]);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) { const k = y * bw + x; if (f[k]) f[k] = Math.min(f[k], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4); }
  let max = 1;
  for (let y = bh - 1; y >= 0; y--) for (let x = bw - 1; x >= 0; x--) { const k = y * bw + x; if (f[k]) { f[k] = Math.min(f[k], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4); if (f[k] / 3 > max) max = f[k] / 3; } }
  const d = new Uint8Array(bw * bh);
  for (let k = 0; k < f.length; k++) d[k] = f[k] ? Math.min(255, Math.max(1, Math.round(f[k] / 3))) : 0;
  return (p._dep = { x0, y0, bw, bh, d, max });
}
const hash2 = (x, y) => ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ 0x5bd1e995) >>> 0) % 1000 / 1000;
const grain = (x, y) => (hash2((x >> 1) + 911, (y >> 1) + 377) - 0.5) * 2 * GRAIN;
function glint(ctx, x, y, big) {
  x |= 0; y |= 0;
  const pts = big ? [[0, 0], [1, 0], [0, 1], [2, 2]] : [[0, 0], [1, 0]];
  for (const [ox, oy] of pts) {
    const X = x + ox, Y = y + oy;
    if (X < 0 || Y < 0 || X >= ctx.w || Y >= ctx.h) continue;
    ctx.sf.G[Y * ctx.w + X] = 1;
  }
}
/* a blob: polar radius with lobes, stretched by ex along (dx, dy) and ey across; thickness high inside, low at the rim */
const LOBES = 512;
function blob(put, b, scale, ex, ey, dx, dy, lobeK = 1, hK = 1) {
  const R = b.r * scale;
  /* the lobed rim as a table over the angle (three sines per pixel cost most of a splash's first ticks) */
  const tab = b._lobes ??= Float32Array.from({ length: LOBES }, (_, j) => { const th = (j + 0.5) / LOBES * 2 * Math.PI - Math.PI, fq = b.fq ?? [3, 5, 9]; let v = 0; for (let q = 0; q < fq.length; q++) v += b.amp[q] * Math.sin(fq[q] * th + b.lob[q]); return v; });
  const rm = R * Math.max(ex, ey) * (1 + b.amp.reduce((a, c) => a + c, 0) * lobeK) + 1;
  const x0 = Math.floor(b.x - rm), x1 = Math.ceil(b.x + rm), y0 = Math.floor(b.y - rm), y1 = Math.ceil(b.y + rm);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const vx = x + 0.5 - b.x, vy = y + 0.5 - b.y;
    const u = (vx * dx + vy * dy) / ex, v = (-vx * dy + vy * dx) / ey;
    const d = Math.hypot(u, v);
    if (d > rm) continue;
    const rr = R * (1 + lobeK * tab[((Math.atan2(vy, vx) + Math.PI) * (LOBES / (2 * Math.PI))) & (LOBES - 1)]);
    if (d >= rr) continue;
    const z = Math.sqrt(1 - (d / rr) ** 2);
    put(x, y, b.h * hK * (0.3 + 0.7 * z), puddle(vx, vy, d / rr, rr));
  }
}
function ellipse(put, cx, cy, a, b, dx, dy, h) {
  const rm = Math.max(a, b) + 1;
  for (let y = Math.floor(cy - rm); y <= Math.ceil(cy + rm); y++) for (let x = Math.floor(cx - rm); x <= Math.ceil(cx + rm); x++) {
    const vx = x + 0.5 - cx, vy = y + 0.5 - cy;
    const u = (vx * dx + vy * dy) / a, v = (-vx * dy + vy * dx) / b;
    const q = u * u + v * v;
    if (q < 1) { const z = Math.sqrt(1 - q); put(x, y, h * (0.35 + 0.65 * z), puddle(vx, vy, Math.sqrt(q), Math.min(a, b))); }
  }
  if (a < 1 && b < 1) put(cx, cy, h * 0.6);
}
function disc(put, cx, cy, r, h) {
  if (r < 0.75) { put(cx, cy, h); return; }
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const q = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) / (r * r);
    if (q < 1) { const z = Math.sqrt(1 - q); put(x, y, h * (0.4 + 0.6 * z), puddle(x + 0.5 - cx, y + 0.5 - cy, Math.sqrt(q), r)); }
  }
}
function taper(put, x, y, dx, dy, len, w, h) {
  const n = Math.ceil(len * 2);
  for (let i = 0; i <= n; i++) { const u = i / n; disc(put, x + dx * len * u, y + dy * len * u, Math.max(0.5, (w / 2) * (1 - u)), h * (1 - 0.5 * u)); }
}

/* ---------------- cracks ---------------- */
function drawCracks(ctx, p, ms) {
  if (ms >= breakAt(p)) { drawShards(ctx, p, ms); drawChips(ctx, p, ms); return; }
  crackPicture(ctx, p, ms, false);
  drawChips(ctx, p, ms);
}
/* the standing crack picture at ms (build: the full picture without its glint, to cut into shards) */
function crackPicture(ctx, p, ms, build) {
  const { sf, w, h, box } = ctx;
  const set = (x, y, c, force = false) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    const cur = sf.C[i], soft = cur === 6 || cur === 7;
    if (!force && cur && cur !== 2 && !soft) return;
    if ((c === 2 || c >= 6) && cur && !soft) return;
    if (c >= 6 && cur) return;
    sf.C[i] = c;
    if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x; if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
  };
  for (const f of p.facets ?? []) {
    if (!build && ms < f.at && !p.still) continue;
    f._px ??= facetPixels(f, w, h);
    for (const i of f._px) set(i % w, (i / w) | 0, f.light ? 6 : 7);
  }
  const glintD = !build && !p.still && ms >= 120 && ms <= 560 ? ((ms - 120) / 440) * p.maxD : -99;
  for (const [li, ln] of p.lines.entries()) {
    const lim = build ? Infinity : crackReach(ln, ms, p.still);
    if (!(lim > ln.pts[0][2])) continue;
    const side = li & 1 ? 1 : -1;
    for (let i = 1; i < ln.pts.length; i++) {
      const a = ln.pts[i - 1], b = ln.pts[i];
      if (a[2] >= lim) break;
      const u = b[2] <= lim ? 1 : (lim - a[2]) / Math.max(1e-6, b[2] - a[2]);
      const bx = a[0] + (b[0] - a[0]) * u, by = a[1] + (b[1] - a[1]) * u;
      const nx = -(by - a[1]), ny = bx - a[0], nl = Math.hypot(nx, ny) || 1;
      const ox = Math.round((nx / nl) * side), oy = Math.round((ny / nl) * side);
      line(a[0], a[1], bx, by, (x, y, f) => {
        const d = a[2] + (b[2] - a[2]) * u * f;
        const gl = Math.abs(d - glintD) < 2.5;
        set(x, y, gl ? 5 : 1, true);
        /* a hairline: the lit edge only beside the radials' first stretch (the crack is open there), single pixels beyond */
        if ((ox || oy) && ln.lvl === 0 && d < p.maxD * 0.45) set(x + ox, y + oy, 2);
      });
    }
  }
  for (const c of p.craters) {
    if ((!build && ms < c.at)) continue;
    const r = c.r;
    for (let y = Math.floor(c.y - r - 1); y <= Math.ceil(c.y + r + 1); y++) for (let x = Math.floor(c.x - r - 1); x <= Math.ceil(c.x + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
      const jag = r * (0.75 + 0.35 * (((x * 73856093) ^ (y * 19349663) ^ (c.seed | 0)) >>> 0) % 100 / 100);
      if (d > jag) continue;
      const hsh = (((x * 2654435761) ^ (y * 40503)) >>> 0) % 7;
      set(x, y, d < 1 ? 1 : d > jag - 1.1 ? 1 : hsh === 0 ? 1 : 3, true);
    }
  }
}
function drawChips(ctx, p, ms) {
  if (p.still) return;
  const { sf, w, h, box } = ctx;
  for (const ch of p.chips) {
    const t = (ms - ch.at) / 1000;
    if (t < 0 || t > 0.9) continue;      // GORE2: a crumb drops a short way and is gone (it may not cross the view)
    const x = ch.x + ch.vx * t, y = ch.y + ch.vy * t + 0.5 * 260 * t * t;
    if (y > h + 2) continue;
    const tick = Math.floor(ms / TICK_MS / 2) + ch.spin;      // tumbling: the chip turns every other tick
    const shape = ch.big ? [[[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]]][((tick % 3) + 3) % 3] : [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0]]][((tick % 3) + 3) % 3];
    for (const [ox, oy] of shape) {
      const X = Math.round(x + ox), Y = Math.round(y + oy);
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      sf.C[Y * w + X] = 4;
      if (X < box.x0) box.x0 = X; if (X > box.x1) box.x1 = X; if (Y < box.y0) box.y0 = Y; if (Y > box.y1) box.y1 = Y;
    }
  }
}
/* GORE2, clearing: the cracked glass FALLS OUT. The full picture is cut once into shards (a cell between two radials and two rings of
   one strike, its lines with it; the crushed crater is band 0); from breakAt the shards drop one after another, the crater first, then
   ring by ring outward: each falls (gravity, a little sideways away from the crater) for FALL_MS, lit as it turns, and crumbles to
   nothing in its last third. A reduced-motion seat: each shard just goes, in the same order. */
export const FALL_G = 560;
export function shardsOf(p, w, h) {
  if (p._shards) return p._shards;
  const C = new Uint8Array(w * h), box = { x0: w, y0: h, x1: -1, y1: -1 };
  crackPicture({ sf: { C }, box, w, h }, p, 0, true);
  const by = new Map();
  for (let y = Math.max(0, box.y0); y <= box.y1; y++) for (let x = Math.max(0, box.x0); x <= box.x1; x++) {
    const i = y * w + x;
    if (!C[i]) continue;
    let sj = 0, best = Infinity;
    for (const [j, st] of p.strikes.entries()) { const d = Math.hypot(x + 0.5 - st.x, y + 0.5 - st.y); if (d < best) { best = d; sj = j; } }
    const st = p.strikes[sj];
    const band = best < st.rc * 1.4 ? 0 : 1 + st.rhos.filter((r) => r < best).length;
    const a = Math.atan2(y + 0.5 - st.y, x + 0.5 - st.x);
    let sec = st.angs.filter((v) => v < a).length;
    if (sec === st.angs.length) sec = 0;
    const key = sj * 1000 + band * 50 + (band ? sec : 0);
    let s = by.get(key);
    if (!s) by.set(key, (s = { key, sj, band, px: [], cls: [], sx: 0, sy: 0 }));
    s.px.push(i); s.cls.push(C[i]); s.sx += x; s.sy += y;
  }
  const r = rng(`shards|${p.seed}`);
  const list = [...by.values()].map((s) => ({ ...s, o: s.band + r() * 0.9 }));
  list.sort((a, b) => a.sj - b.sj || a.o - b.o);
  const t0 = breakAt(p), n = list.length;
  for (const [k, s] of list.entries()) {
    const st = p.strikes[s.sj];
    const cx = s.sx / s.px.length, cy = s.sy / s.px.length;
    const ax = cx - st.x, ay = cy - st.y, al = Math.hypot(ax, ay) || 1;
    Object.assign(s, { at: t0 + (n > 1 ? (k / (n - 1)) * (FALL - FALL_MS - 2 * TICK_MS) : 0), vx: (ax / al) * 22 + (r() - 0.5) * 16, vy: Math.max(0, (ay / al) * 14) + lerp(0, 12, r()),
      px: Int32Array.from(s.px), cls: Uint8Array.from(s.cls) });
  }
  return (p._shards = list);
}
const lerp = (a, b, u) => a + (b - a) * u;
function drawShards(ctx, p, ms) {
  const { sf, w, h, box } = ctx;
  const shards = shardsOf(p, w, h);
  const tick = Math.floor(ms / TICK_MS) * TICK_MS;
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x, cur = sf.C[i];
    if (cur && !(cur === 6 || cur === 7 || cur === 8) && c >= 6) return;
    sf.C[i] = c;
    if (x < box.x0) box.x0 = x; if (x > box.x1) box.x1 = x; if (y < box.y0) box.y0 = y; if (y > box.y1) box.y1 = y;
  };
  /* the ones still in place first, the falling ones over them */
  for (const s of shards) {
    if (tick >= s.at) continue;
    for (let j = 0; j < s.px.length; j++) put(s.px[j] % w, (s.px[j] / w) | 0, s.cls[j]);
  }
  if (p.still) return;
  for (const s of shards) {
    const age = tick - s.at;
    if (age < 0 || age >= FALL_MS) continue;
    const a = age / 1000, dx = Math.round(s.vx * a), dy = Math.round(s.vy * a + 0.5 * FALL_G * a * a);
    const crumble = Math.max(0, (age - FALL_MS * 0.62) / (FALL_MS * 0.38));
    /* the loose piece catches the light: clear glass with diagonal sheen streaks that slide across it as it falls, its edges bright on
       the first tick */
    const sheen = Math.floor(age / TICK_MS);
    for (let j = 0; j < s.px.length; j++) {
      const x0 = s.px[j] % w, y0 = (s.px[j] / w) | 0, x = x0 + dx, y = y0 + dy;
      if (crumble > 0 && ((Math.imul(x0, 73856093) ^ Math.imul(y0, 19349663)) >>> 0) % 1000 / 1000 < crumble) continue;
      const c = s.cls[j];
      if (c === 6 || c === 7) { if ((x0 + y0 + sheen) % 9 === 0) put(x, y, 8); continue; }
      put(x, y, age < TICK_MS && c === 1 ? 2 : c);
    }
  }
}
/* a facet's pixels (a cell of a ring band between two radials), once */
function facetPixels(f, w, h) {
  const out = [];
  let a1 = f.a1; while (a1 < f.a0) a1 += Math.PI * 2;
  if (a1 - f.a0 > Math.PI) return out;
  const r0 = f.r0 ?? 0;
  for (let y = Math.max(0, Math.floor(f.y - f.r)); y <= Math.min(h - 1, Math.ceil(f.y + f.r)); y++) for (let x = Math.max(0, Math.floor(f.x - f.r)); x <= Math.min(w - 1, Math.ceil(f.x + f.r)); x++) {
    const vx = x + 0.5 - f.x, vy = y + 0.5 - f.y, d = Math.hypot(vx, vy);
    if (d > f.r || d < r0) continue;
    let a = Math.atan2(vy, vx); while (a < f.a0) a += Math.PI * 2;
    if (a <= a1) out.push(y * w + x);
  }
  return out;
}
/* integer line (Bresenham), f = 0..1 along it */
function line(x0, y0, x1, y1, plot) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  const n = Math.max(dx, -dy) || 1;
  let err = dx + dy, i = 0;
  for (;;) {
    plot(x0, y0, i / n);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
    i++;
  }
}

/* ---------------- colour ---------------- */
function colour(sf, b, pal) {
  if (b.x1 < 0) return;
  const { w, h, T, S, G, C, rgba } = sf, Asee = sf.A, Lf = sf.L, Sett = sf.N;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : T[y * w + x]);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    const i = y * w + x, t = T[i], o = i * 4;
    if (t > THR) {
      const st = S[i] > 2 ? 2 : S[i];
      const P = st === 0 ? pal.wet : st === 1 ? pal.drying : pal.dried;
      let c;
      const edge = at(x - 1, y) <= THR || at(x + 1, y) <= THR || at(x, y - 1) <= THR || at(x, y + 1) <= THR;
      if (G[i] === 3) c = P.crumb;                    // a falling flake
      else if (edge) c = P.out;
      else if (G[i] === 2) c = P.crumb;
      else if (G[i] && st === 0) c = P.spec;
      else {
        /* light from the top left: each drop is shaded as a dome (light()), banded into the palette, a 2x2 dither where two bands meet;
           the brightest point of a big wet dome is its glint */
        const v = Lf[i] + ((x + y) & 1 ? 0.035 : -0.035);
        c = v > 0.97 && st === 0 && t > 0.5 ? P.spec : v > 0.84 ? P.lit : v > 0.56 ? P.b : v > 0.3 ? P.m : P.d;
        if (st === 2 && !(at(x - 2, y) <= THR || at(x + 2, y) <= THR || at(x, y - 2) <= THR || at(x, y + 2) <= THR)) c = (x + y) & 1 ? P.m : P.b;     // the dried crust: rim dark, the middle paler
      }
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = Math.round(ALPHA[st] * (Asee[i] ? CENTRE.alpha : 1) * (Sett[i] ? SEE : 1));
    } else if (C[i]) {
      const c = CRACK[C[i]];
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = c[3];
    }
  }
}
