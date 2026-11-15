/* GORE: the pixel painter, PURE (typed arrays only; node checks run it). Draws the live plans (plan.mjs) at one instant into an RGBA
   buffer of the art grid, one art pixel per buffer pixel; main.mjs shows it scaled by a whole number of device px with no smoothing.
   Every pixel is one of the palette's colours at one of a few alphas: no gradients, no anti-aliasing (pixel art; checked).

   Two passes:
     1. shapes into fields: blood thickness T (0..1) + its stage S (0 wet, 1 drying, 2 dried; the youngest wins) + glint G;
        cracks into a class map C (1 line, 2 lit edge, 3 crushed glass, 4 chip, 5 running glint)
     2. colour: thickness bands (dark / mid / bright, a 2x2 dither on the band edges), a dark outline where blood meets glass, a lit
        inner rim toward the top left, glints while wet; the crack classes under it; the middle of the view see-through (CENTRE).
   Cost: proportional to the drawn area (bounding boxes), not to the screen; a full 1080p glass is 640 x 360 art px. */
import { TICK_MS, CENTRE, dripAt, crackReach, crackCut } from "./plan.mjs";

export const THR = 0.06;
/* palettes: [r, g, b] per role; alpha per stage */
export const PAL = {
  wet:    { out: [58, 4, 10],  d: [112, 8, 18], m: [170, 16, 28], b: [214, 36, 44], lit: [255, 112, 100], spec: [255, 232, 224] },
  drying: { out: [46, 6, 10],  d: [88, 12, 18], m: [122, 20, 26], b: [146, 30, 34], lit: [170, 52, 50],  spec: [170, 52, 50] },
  dried:  { out: [34, 8, 8],   d: [66, 14, 14], m: [84, 22, 20], b: [96, 28, 24],  lit: [104, 34, 30],  spec: [104, 34, 30] }
};
/* the photosensitive seat's blood: no saturated red (R / (R + G + B) < 0.7 for every colour) */
export const PAL_SAFE = {
  wet:    { out: [44, 16, 18], d: [84, 32, 32], m: [110, 42, 40], b: [130, 54, 50], lit: [160, 88, 82], spec: [222, 196, 190] },
  drying: { out: [40, 16, 16], d: [74, 30, 28], m: [96, 38, 34], b: [110, 46, 42], lit: [124, 60, 54], spec: [124, 60, 54] },
  dried:  { out: [34, 14, 12], d: [60, 26, 22], m: [74, 32, 28], b: [84, 38, 32], lit: [90, 44, 38], spec: [90, 44, 38] }
};
export const ALPHA = [236, 222, 196];        // wet, drying, dried: on arrival
/* after the hit the glass lets the table read through the blood: SETTLE ms after its arrival a splash keeps SEE of its alpha */
export const SETTLE = 450, SEE = 0.7;
export const CRACK = { 1: [12, 18, 26, 232], 2: [222, 242, 255, 215], 3: [236, 246, 255, 236], 4: [204, 232, 252, 240], 5: [255, 255, 255, 252], 6: [230, 244, 255, 46], 7: [8, 14, 24, 52] };
/* 4x4 ordered dither: the dissolve keeps a pixel while its threshold is above the dissolve's progress */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

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
      live++; if (ms < 1600 || ms > p.life.gone - p.life.retract - 50) moving = true;
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
  const diss = ms > gone ? (ms - gone) / p.life.dissolve : 0;
  /* a splash whose middle lies in the readable centre of the view is see-through as a whole (one look per splash, never a seam) */
  const settled = ms >= SETTLE || still;
  const see = ((p.cx / ctx.w - 0.5) / CENTRE.rx) ** 2 + ((p.cy / ctx.h - 0.5) / CENTRE.ry) ** 2 < 1;
  const put = (x, y, t, l = 0.45) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= ctx.w || y >= ctx.h) return;
    if (diss > 0 && bayer(x, y) < diss) return;
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
    if (stage === 0 && st.swell >= 1) glint(ctx, hx, Math.round(yHead) - 1, false);
  }
  if (stage === 0) for (const gl of p.glints) if (k >= 2) glint(ctx, gl.x, gl.y, gl.big, diss);
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
  if (p.kind !== "blood") return;
  for (const q of p.second ? [p, p.second.plan] : [p]) for (let k = from; k <= upTo; k++) tickPixels(q, k, q.still);
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
      /* the SMEAR: still flying, stretched along its way, a little behind where it lands; streaks behind it */
      blob(put, { ...b, x: b.x - dx * b.r * 0.35, y: b.y - dy * b.r * 0.35 }, 0.85, 1.6, 0.68, dx, dy, 0);
      for (const st of p.streaks) {
        const ox = b.x - dy * st.off - dx * b.r * 0.6, oy = b.y + dx * st.off - dy * b.r * 0.6;
        taper(put, ox, oy, -dx, -dy, st.len, st.w, 0.55);
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
  /* satellites: stretched on the tick they land, a tail toward home */
  for (const s of p.sats) {
    if (k < s.at) continue;
    const land = k === s.at && !still;
    const draw = (q) => {
      ellipse(q, s.x, s.y, s.r * s.st * (land ? 1.45 : 1), s.r * (land ? 0.85 : 1), Math.cos(s.a), Math.sin(s.a), s.h);
      if (s.r * s.st >= 2.2) q(s.x - Math.cos(s.a) * (s.r * s.st + 1.2), s.y - Math.sin(s.a) * (s.r * s.st + 1.2), 0.3);
    };
    if (land) draw(put); else replay(s, put, draw);
  }
  for (const m of p.mist) {
    if (k < m.at) continue;
    put(m.x, m.y, 0.3);
    if (m.two) put(m.x + 1, m.y, 0.3);
  }
}
function glint(ctx, x, y, big, diss = 0) {
  x |= 0; y |= 0;
  const pts = big ? [[0, 0], [1, 0], [0, 1], [2, 2]] : [[0, 0], [1, 0]];
  for (const [ox, oy] of pts) {
    const X = x + ox, Y = y + oy;
    if (X < 0 || Y < 0 || X >= ctx.w || Y >= ctx.h || (diss > 0 && bayer(X, Y) < diss)) continue;
    ctx.sf.G[Y * ctx.w + X] = 1;
  }
}
/* a blob: polar radius with lobes, stretched by ex along (dx, dy) and ey across; thickness high inside, low at the rim */
const LOBES = 512;
function blob(put, b, scale, ex, ey, dx, dy, lobeK = 1, hK = 1) {
  const R = b.r * scale;
  /* the lobed rim as a table over the angle (three sines per pixel cost most of a splash's first ticks) */
  const tab = b._lobes ??= Float32Array.from({ length: LOBES }, (_, j) => { const th = (j + 0.5) / LOBES * 2 * Math.PI - Math.PI; return b.amp[0] * Math.sin(3 * th + b.lob[0]) + b.amp[1] * Math.sin(5 * th + b.lob[1]) + b.amp[2] * Math.sin(9 * th + b.lob[2]); });
  const rm = R * Math.max(ex, ey) * (1 + (b.amp[0] + b.amp[1] + b.amp[2]) * lobeK) + 1;
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
  const { sf, w, h, box } = ctx;
  const cut = crackCut(p, ms);
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
    if ((ms < f.at && !p.still) || cut < f.r) continue;
    f._px ??= facetPixels(f, w, h);
    for (const i of f._px) set(i % w, (i / w) | 0, f.light ? 6 : 7);
  }
  const glintD = !p.still && ms >= 120 && ms <= 560 ? ((ms - 120) / 440) * p.maxD : -99;
  for (const [li, ln] of p.lines.entries()) {
    const lim = Math.min(crackReach(ln, ms, p.still), cut);
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
        if (ln.lvl === 0 && d < ln.wide) { set(x + 1, y, gl ? 5 : 1, true); set(x - ox, y - oy, 2); }
        if (ox || oy) set(x + ox, y + oy, 2);
      });
    }
  }
  for (const c of p.craters) {
    if (ms < c.at || cut <= c.r) continue;
    const r = c.r;
    for (let y = Math.floor(c.y - r - 1); y <= Math.ceil(c.y + r + 1); y++) for (let x = Math.floor(c.x - r - 1); x <= Math.ceil(c.x + r + 1); x++) {
      const d = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y);
      const jag = r * (0.75 + 0.35 * (((x * 73856093) ^ (y * 19349663) ^ (c.seed | 0)) >>> 0) % 100 / 100);
      if (d > jag) continue;
      const hsh = (((x * 2654435761) ^ (y * 40503)) >>> 0) % 7;
      set(x, y, d < 1.3 ? 1 : d > jag - 1.1 ? 1 : hsh === 0 ? 1 : 3, true);
    }
  }
  if (!p.still) for (const ch of p.chips) {
    const t = (ms - ch.at) / 1000;
    if (t < 0 || t > 1.6) continue;
    const x = ch.x + ch.vx * t, y = ch.y + ch.vy * t + 0.5 * 260 * t * t;
    if (y > h + 2) continue;
    const tick = Math.floor(ms / TICK_MS / 2) + ch.spin;      // tumbling: the chip turns every other tick
    const shape = ch.big ? [[[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [0, 1], [0, 2]]][tick % 3] : [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0]]][tick % 3];
    for (const [ox, oy] of shape) set(x + ox, y + oy, 4, true);
  }
}
/* a facet's pixels (a wedge of the crater's first ring), once */
function facetPixels(f, w, h) {
  const out = [];
  let a1 = f.a1; while (a1 < f.a0) a1 += Math.PI * 2;
  if (a1 - f.a0 > Math.PI) return out;
  for (let y = Math.max(0, Math.floor(f.y - f.r)); y <= Math.min(h - 1, Math.ceil(f.y + f.r)); y++) for (let x = Math.max(0, Math.floor(f.x - f.r)); x <= Math.min(w - 1, Math.ceil(f.x + f.r)); x++) {
    const vx = x + 0.5 - f.x, vy = y + 0.5 - f.y;
    if (Math.hypot(vx, vy) > f.r) continue;
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
      if (edge) c = P.out;
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
