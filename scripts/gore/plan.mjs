/* GORE: blood and cracks on the screen, the PURE part (no Foundry, no DOM; node checks: scripts/sweep-checks/gore.mjs).
   The owner, 2026-11-15: «Nowy efekt, krew na ekranie i drugi pęknięcia. Warto pixelartowe. Krew będzie potencjalnie pojawiać się przy
   obrażeniach postaci. Więc muszą pojawiać się jak chlapanie.»

   Both effects live ON THE GLASS of the table's view (screen space), drawn as pixel art on a fixed grid of art pixels (ART_CSS CSS px
   each, a whole number of device px: raster.mjs, main.mjs). Everything here is a pure function of (seed, strength, grid size, time since
   the contact): every seat with the same seed sees the same splash at the same instant, laid out in fractions of its own view.

   BLOOD, one splash in layers (animation principles):
     primary   tick 0 the SMEAR (the mass still flying: stretched along its way, speed streaks behind it), tick 1 the SQUASH (flattened,
               bigger than it settles), tick 2.. settled with its lobes; tendrils shoot out on ticks 1-3 and end in crown beads
     secondary satellites and mist arrive by their distance (ticks 1-6), stretched along their flight, a tail pointing home
     consequence the bottom rim swells into beads (anticipation) and RUNS: stick-slip drips down the glass; the blood DRIES in stages
               (wet with a glint -> drying -> a dark crust, the rim darkest); it CLEARS by a pixel dissolve (ordered dither), never a fade
   CRACKS: a crater, radials racing out with branches and spider-web rings, a glint running along the fresh cracks, glass chips that
     tumble down; they hold, then retract from the tips back into the crater.
   SAFETY: an arrival is ONE change of the picture; big arrivals keep at least ARRIVAL_GAP ms apart (<= 2 a second, the photo-safety
   rationing of the impact frames: LIMITS.fullPerSec 2); a photosensitive seat gets the dim palette (no saturated red: R share < 0.7) and
   every arrival under SAFE_AREA of the view (WCAG 2.3.1's small safe area); a reduced-motion seat gets each stage as a still (no
   flight, no running, no glint, no chips). The middle of the view stays readable (CENTRE: big blobs never centred there, blood there
   drawn see-through). */

export const TICK_MS = 1000 / 24;          // the comic's beat: arrivals and runs step on it
export const ART_CSS = 3;                  // one art pixel = round(3 x DPR) device px (the map's lens grid: one look on the glass)
export const ARRIVAL_GAP = 500;            // ms between two big arrivals on one seat (<= 2 a second)
export const SAFE_GAP = 1000;              // ... on a photosensitive seat
export const SAFE_AREA = 0.025;            // photosensitive seat: one arrival covers at most this share of the view
export const MAX_LIVE = 8;                 // splashes alive at once; the oldest dissolves early beyond
export const CENTRE = { rx: 0.30, ry: 0.28, alpha: 0.55 };      // the readable middle: an ellipse (fractions of the view) and blood's alpha there
export const BIG = 0.4;                    // an arrival from this strength up counts in the rationing

/* ---------------- seeded numbers ---------------- */
export function hash(str) {
  let h = 2166136261 >>> 0;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function rng(seed) {
  let a = (typeof seed === "number" ? seed : hash(seed)) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, u) => a + (b - a) * u;
const easeOut = (u) => 1 - (1 - clamp(u, 0, 1)) ** 2;

/* ---------------- the table's options (world, GM: scripts/gore/main.mjs registers them) ---------------- */
export const KEYS = { blood: "goreBlood", cracks: "goreCracks", seats: "goreSeats", hold: "goreHold" };
export const SEATS = ["all", "owners"];
export const DEFAULTS = { goreBlood: 2, goreCracks: 2, goreSeats: "all", goreHold: 1 };
/* the 0..3 slider (the owner's size rule for the map lettering, 2026-11-15: 0 = none, 2 = the normal size): strength x */
export const LEVEL = [0, 0.65, 1, 1.3];
export function cleanOpts(v = {}) {
  const lvl = (x, d) => (Number.isFinite(Number(x)) ? clamp(Math.round(Number(x)), 0, 3) : d);
  return {
    blood: lvl(v.goreBlood, DEFAULTS.goreBlood),
    cracks: lvl(v.goreCracks, DEFAULTS.goreCracks),
    seats: SEATS.includes(v.goreSeats) ? v.goreSeats : DEFAULTS.goreSeats,
    hold: Number.isFinite(Number(v.goreHold)) ? clamp(Number(v.goreHold), 0.5, 2) : DEFAULTS.goreHold
  };
}

/* ---------------- from a change of a character to an effect (GORE-1, GORE-2, GORE-3: provisional, combat-questions.md) ----------------
   change = { stat: "health" | "resolve", from, to, max, type: actor type, push: the character chose that stress }
   -> null | { kind: "blood" | "cracks", strength 0..1, down } */
export function effectOf(ch) {
  if (!ch || ch.type === "challenge") return null;      // a challenge's "Health" is its Challenge Rating: nothing bleeds
  if (!Number.isFinite(ch.from) || !Number.isFinite(ch.to) || !(ch.to < ch.from)) return null;
  const loss = ch.from - ch.to, max = Math.max(1, Number.isFinite(ch.max) && ch.max > 0 ? ch.max : Math.max(ch.from, 1));
  const share = clamp(loss / max, 0, 1);
  const down = ch.to <= 0;
  let s = clamp(0.22 + 0.85 * share, 0.22, 0.9);
  if (down) s = 1;
  if (ch.stat === "health") return { kind: ch.type === "vehicle" ? "cracks" : "blood", strength: s, down };
  if (ch.stat === "resolve") return ch.push ? null : { kind: "cracks", strength: down ? 1 : clamp(s * 0.9, 0.2, 0.85), down };
  return null;
}
/** the strength a seat plays: the effect's, times the table's level (0 = off) */
export function scaled(strength, level) {
  const k = LEVEL[clamp(Math.round(level ?? 2), 0, 3)];
  return k ? clamp(strength * k, 0.12, 1.25) : 0;
}

/* ---------------- the grid ---------------- */
/** the art grid for a view of vw x vh CSS px at dpr: px = device px per art px (whole), w x h art px covering the view */
export function grid(vw, vh, dpr = 1) {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const px = Math.max(1, Math.round(ART_CSS * d));
  const w = Math.max(8, Math.ceil((vw * d) / px)), h = Math.max(8, Math.ceil((vh * d) / px));
  return { px, w, h, dpr: d, css: px / d, vw, vh };
}

/* ---------------- arrivals (rationing; pure so the checks can run it) ---------------- */
/** when an effect asked for at `want` (ms) may arrive, given this seat's earlier big arrivals (sorted ms); small ones are never moved */
export function arrivalAt(want, strength, past = [], safe = false) {
  if (strength < BIG && !safe) return want;
  const gap = safe ? SAFE_GAP : ARRIVAL_GAP;
  let t = want;
  for (const p of [...past].sort((a, b) => a - b)) if (t < p + gap && t > p - gap) t = p + gap;
  return t;
}

/* ---------------- BLOOD: the plan of one splash ----------------
   opts = { strength, seed, dir (radians, the way the blood flies; null = from the seed), at ({ fx, fy } fractions; null = by dir),
            safe (photosensitive), still (reduced motion), hold (x) }; g = grid(...) */
export function bloodPlan(g, opts = {}) {
  const r = rng(`blood|${opts.seed ?? "x"}`);
  let s = clamp(Number(opts.strength) || 0.5, 0.12, 1.25);
  const m = Math.min(g.w, g.h);
  const dir = Number.isFinite(opts.dir) ? opts.dir : r() * Math.PI * 2;
  const dx = Math.cos(dir), dy = Math.sin(dir);
  let R = (0.03 + 0.085 * Math.min(s, 1) + 0.02 * Math.max(0, s - 1)) * m;
  /* photosensitive seat: the whole splash (blob + crown + satellites ~ 2.2 x the blob's area) under SAFE_AREA of the view */
  if (opts.safe) R = Math.min(R, Math.sqrt((SAFE_AREA * g.w * g.h) / (Math.PI * 2.2)));
  /* where it lands: on the side of the view the blood flies to, off the middle (a seat's view: fractions) */
  let cx, cy;
  if (opts.at && Number.isFinite(opts.at.fx) && Number.isFinite(opts.at.fy)) { cx = opts.at.fx * g.w; cy = opts.at.fy * g.h; }
  else {
    const reach = lerp(0.68, 0.88, r());
    const perp = (r() - 0.5) * 0.5;
    cx = g.w / 2 + (dx * reach - dy * perp) * g.w / 2;
    cy = g.h / 2 + (dy * reach + dx * perp) * g.h / 2;
  }
  cx = clamp(cx, R * 0.3, g.w - R * 0.3); cy = clamp(cy, R * 0.3, g.h - R * 0.3);
  const lob = [0, 1, 2].map(() => r() * Math.PI * 2);
  const amp = [lerp(0.08, 0.16, r()), lerp(0.05, 0.1, r()), lerp(0.03, 0.06, r())];
  const blobs = [];
  /* the main mass */
  blobs.push({ x: cx, y: cy, r: R, h: 1, at: 0, main: true, lob, amp, e: 1.12 });
  /* bumps round its rim: the cartoon splat's lobes */
  const nb = 4 + Math.round(4 * Math.min(s, 1));
  for (let i = 0; i < nb; i++) {
    const a = r() * Math.PI * 2, d = R * lerp(0.75, 1.0, r()), rr = R * lerp(0.22, 0.42, r());
    blobs.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, r: rr, h: 0.85, at: 1, lob: [r() * 6, r() * 6, r() * 6], amp: [0.1, 0.06, 0.03], e: 1 });
  }
  /* tendrils: spokes out of the rim, most of them the way it flew, each ending in a crown bead */
  const tendrils = [];
  const nt = 3 + Math.round(7 * Math.min(s, 1));
  for (let i = 0; i < nt; i++) {
    const fwd = r() < 0.72;
    const a = fwd ? dir + (r() - 0.5) * Math.PI * 0.9 : r() * Math.PI * 2;
    const len = R * lerp(0.5, fwd ? 1.7 : 0.9, r()) * (0.7 + 0.3 * Math.min(s, 1));
    const w0 = Math.max(1.2, R * lerp(0.12, 0.24, r()));
    const x0 = cx + Math.cos(a) * R * 0.8, y0 = cy + Math.sin(a) * R * 0.8;
    const bend = (r() - 0.5) * 0.35;
    tendrils.push({ x: x0, y: y0, a, len, w0, bend, bead: Math.max(1, lerp(1.2, 2.8, r()) * (R > 12 ? 1 : 0.7)), at: 1, grow: 3 });
  }
  /* satellites: flying drops, stretched along their flight, arriving by distance */
  const sats = [];
  const ns = Math.round(6 + 34 * Math.min(s, 1));
  for (let i = 0; i < ns; i++) {
    const fwd = r() < 0.75;
    const a = fwd ? dir + (r() - 0.5) * Math.PI * 0.75 : r() * Math.PI * 2;
    const dist = R * (fwd ? lerp(1.3, 4.2, r() ** 0.8) : lerp(1.1, 2.0, r()));
    const rad = Math.max(0.7, lerp(3.4, 0.7, (dist / R - 1.1) / 3.1) * lerp(0.6, 1.1, r()) * (R / 20) ** 0.5);
    const x = cx + Math.cos(a) * dist, y = cy + Math.sin(a) * dist;
    sats.push({ x, y, r: rad, a, st: lerp(1.4, 2.6, r()), at: 1 + Math.min(5, Math.floor((dist / R - 1) * 1.6)), h: 0.8 });
  }
  /* mist: single pixels and pairs in a wide cone */
  const mist = [];
  const nm = Math.round(10 + 110 * Math.min(s, 1));
  for (let i = 0; i < nm; i++) {
    const a = dir + (r() - 0.5) * Math.PI * 1.3, dist = R * lerp(1.2, 5.5, r());
    mist.push({ x: cx + Math.cos(a) * dist, y: cy + Math.sin(a) * dist, two: r() < 0.25, at: 2 + Math.floor(r() * 5) });
  }
  /* the smear frame: streaks behind the flying mass */
  const streaks = [];
  for (let i = 0; i < 3 + Math.round(3 * Math.min(s, 1)); i++) streaks.push({ off: (r() - 0.5) * 1.4 * R, len: R * lerp(1.0, 2.2, r()), w: Math.max(1, R * lerp(0.06, 0.14, r())) });
  /* drips: from the lowest parts of the big blobs, a bead swells, then runs stick-slip */
  const drips = [];
  const nd = 1 + Math.round(4 * Math.min(s, 1));
  for (let i = 0; i < nd; i++) {
    const u = (i + 0.5) / nd, a = Math.PI / 2 + (u - 0.5) * 1.6 + (r() - 0.5) * 0.25;
    const x0 = cx + Math.cos(a) * R * 0.86, y0 = cy + Math.sin(a) * R * 0.86;
    drips.push(dripOf(r, x0, y0, R * lerp(0.7, 2.3, r()) * (0.6 + 0.4 * Math.min(s, 1)), lerp(450, 1100, r()), R > 14 ? 2 : 1));
  }
  for (const sat of sats) if (sat.r >= 2.6 && r() < 0.5) drips.push(dripOf(r, sat.x, sat.y + sat.r * 0.8, sat.r * lerp(3, 7, r()), lerp(700, 1600, r()), 1));
  /* life: wet, drying, dried, cleared (ms after contact) */
  const hold = clamp(Number(opts.hold) || 1, 0.5, 2);
  const wet = 2600 + 1500 * Math.min(s, 1);
  const life = { wet, dry: wet + 1800, gone: (5500 + 5500 * Math.min(s, 1)) * hold, dissolve: 1400 };
  life.gone = Math.max(life.gone, life.dry + 600);
  const glints = blobs.filter((b) => b.r >= 5).map((b) => ({ x: b.x - b.r * 0.42, y: b.y - b.r * 0.45, big: b.r >= 12 }));
  /* a knock-down's second blow: a second splash two ticks later, beside the first */
  const plan = { kind: "blood", seed: opts.seed ?? "x", s, dir, dx, dy, R, cx, cy, blobs, tendrils, sats, mist, streaks, drips, glints, life,
    safe: !!opts.safe, still: !!opts.still, g: { w: g.w, h: g.h } };
  if (s >= 0.98 && !opts.second && !opts.safe) {
    const a2 = dir + (r() < 0.5 ? 1 : -1) * lerp(0.6, 1.1, r());
    const p2 = bloodPlan(g, { ...opts, strength: 0.55, seed: `${opts.seed}|2`, dir: a2, second: true,
      at: { fx: clamp((cx + Math.cos(a2) * R * 2.2) / g.w, 0.04, 0.96), fy: clamp((cy + Math.sin(a2) * R * 2.2) / g.h, 0.04, 0.96) } });
    plan.second = { plan: p2, delay: 2 * TICK_MS };
  }
  return plan;
}
function dripOf(r, x, y, len, start, w) {
  /* stick-slip: segments of (wait ms, slide px, speed px/s); the bead swells for `swell` ms before the first slide */
  const segs = [];
  let sum = 0;
  while (sum < len) {
    const d = Math.min(len - sum, lerp(3, 12, r()));
    segs.push({ wait: lerp(60, 300, r()), d, v: lerp(70, 170, r()) });
    sum += d;
  }
  return { x, y, len: sum, start, swell: 320, segs, wob: r() * 6, w };
}
/** how far a drip has run at ms after contact (px), and whether it is moving */
export function dripAt(d, ms) {
  let t = ms - d.start - d.swell;
  if (t <= 0) return { y: 0, moving: false, swell: clamp((ms - d.start) / d.swell, 0, 1) };
  let y = 0;
  for (const s of d.segs) {
    if (t < s.wait) return { y, moving: false, swell: 1 };
    t -= s.wait;
    const need = (s.d / s.v) * 1000;
    if (t < need) return { y: y + s.d * (t / need), moving: true, swell: 1 };
    t -= need; y += s.d;
  }
  return { y: d.len, moving: false, swell: 1 };
}

/* ---------------- CRACKS: the plan of one strike ---------------- */
export function crackPlan(g, opts = {}) {
  const r = rng(`cracks|${opts.seed ?? "x"}`);
  const s = clamp(Number(opts.strength) || 0.5, 0.12, 1.25);
  const m = Math.min(g.w, g.h);
  let px, py;
  if (opts.at && Number.isFinite(opts.at.fx) && Number.isFinite(opts.at.fy)) { px = opts.at.fx * g.w; py = opts.at.fy * g.h; }
  else {
    const a = r() * Math.PI * 2, k = lerp(0.5, 0.82, r());
    px = g.w / 2 + Math.cos(a) * k * g.w / 2; py = g.h / 2 + Math.sin(a) * k * g.h / 2;
  }
  const strikes = [{ x: px, y: py, at: 0, s }];
  if (s >= 0.95 && !opts.safe) {
    const a = r() * Math.PI * 2;
    strikes.push({ x: clamp(px + Math.cos(a) * m * 0.35, 4, g.w - 4), y: clamp(py + Math.sin(a) * m * 0.35, 4, g.h - 4), at: 3 * TICK_MS, s: 0.6 });
  }
  const lines = [];      // { pts: [[x, y, d]...] (d = path distance from the crater), t0 (ms the line starts), speed (px/ms), lvl }
  const craters = [];
  const chips = [];
  const facets = [];
  for (const st of strikes) {
    const sm = Math.min(st.s, 1);
    const reach = (0.17 + 0.37 * sm) * m * (opts.safe ? 0.7 : 1);
    const rc = Math.max(2, lerp(2.5, 5, sm));
    craters.push({ x: st.x, y: st.y, r: rc, at: st.at, seed: r() * 1e9 });
    const n = 5 + Math.round(5 * sm);
    const base = r() * Math.PI * 2;
    const radials = [];
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * Math.PI * 2 + (r() - 0.5) * (Math.PI / n);
      const L = reach * lerp(0.45, 1.0, r() ** 0.7);
      const pts = walk(r, st.x + Math.cos(a) * rc, st.y + Math.sin(a) * rc, a, L, 0.22, rc);
      radials.push(pts);
      lines.push({ pts, t0: st.at, speed: (reach / 190), lvl: 0, wide: rc + L * 0.4 });
      /* branches */
      const nbr = Math.round(lerp(0, 2.4, sm) * r() + (L > reach * 0.7 ? 1 : 0));
      for (let b = 0; b < nbr; b++) {
        const at = Math.floor(lerp(0.3, 0.75, r()) * (pts.length - 1));
        const p = pts[at];
        const ba = a + (r() < 0.5 ? 1 : -1) * lerp(0.35, 0.8, r());
        const bp = walk(r, p[0], p[1], ba, (L - p[2]) * lerp(0.3, 0.6, r()), 0.3, p[2]);
        lines.push({ pts: bp, t0: st.at, speed: (reach / 190) * 0.8, lvl: 1 });
      }
    }
    /* rings: jagged arcs joining neighbouring radials (the spider web); the cells inside the first ring are FACETS that catch the light
       (a faint light or dark tint, alternating: the broken glass's planes) */
    const nr = 1 + Math.round(2 * sm);
    const angs = radials.map((pts) => Math.atan2(pts[pts.length - 1][1] - st.y, pts[pts.length - 1][0] - st.x));
    for (let k = 0; k < nr; k++) {
      const rho = reach * lerp(0.14, 0.55, (k + r() * 0.6) / nr);
      for (let i = 0; i < radials.length; i++) {
        if (r() < (k === 0 ? 0.15 : 0.35)) continue;
        const A = pointAt(radials[i], rho), B = pointAt(radials[(i + 1) % radials.length], rho * lerp(0.9, 1.1, r()));
        if (!A || !B) continue;
        const pts = [[A[0], A[1], rho]];
        const sag = (r() - 0.35) * 0.18 * rho;
        for (const u of [0.33, 0.66]) {
          const qx = A[0] + (B[0] - A[0]) * u, qy = A[1] + (B[1] - A[1]) * u;
          const ox = qx - st.x, oy = qy - st.y, ol = Math.hypot(ox, oy) || 1;
          const jx = qx + (ox / ol) * sag + (r() - 0.5) * 2.5, jy = qy + (oy / ol) * sag + (r() - 0.5) * 2.5;
          const last = pts[pts.length - 1];
          pts.push([jx, jy, last[2] + Math.hypot(jx - last[0], jy - last[1])]);
        }
        const last = pts[pts.length - 1];
        pts.push([B[0], B[1], last[2] + Math.hypot(B[0] - last[0], B[1] - last[1])]);
        lines.push({ pts, t0: st.at + 40 + k * 30, speed: (reach / 190) * 0.9, lvl: 2 });
        if (k === 0 && !opts.safe) facets.push({ x: st.x, y: st.y, a0: angs[i], a1: angs[(i + 1) % radials.length], r: rho * 0.97, light: i & 1 ? 1 : 0, at: st.at + 60 });
      }
    }
    /* glass chips that fall out of the crater */
    const nc = opts.still ? 0 : 3 + Math.round(9 * sm);
    for (let i = 0; i < nc; i++) chips.push({ x: st.x + (r() - 0.5) * rc * 2, y: st.y + (r() - 0.5) * rc * 2, vx: (r() - 0.5) * 70, vy: lerp(-60, 10, r()), at: st.at + r() * 140, big: r() < 0.45, spin: Math.floor(r() * 3) });
  }
  const hold = clamp(Number(opts.hold) || 1, 0.5, 2);
  const life = { gone: (4500 + 4000 * Math.min(s, 1)) * hold, retract: 900 };
  const maxD = Math.max(1, ...lines.map((l) => l.pts[l.pts.length - 1][2]));
  return { kind: "cracks", seed: opts.seed ?? "x", s, strikes, craters, lines, chips, facets, life, maxD, safe: !!opts.safe, still: !!opts.still, g: { w: g.w, h: g.h } };
}
function walk(r, x, y, a, L, jit, d0) {
  const pts = [[x, y, d0]];
  let d = d0, ang = a;
  const end = d0 + L;
  while (d < end) {
    const st = lerp(2, 4.5, r());
    ang += (r() - 0.5) * jit * 2;
    ang = a + clamp(ang - a, -0.5, 0.5);
    x += Math.cos(ang) * st; y += Math.sin(ang) * st; d += st;
    pts.push([x, y, d]);
  }
  return pts;
}
function pointAt(pts, rho) {
  for (const p of pts) if (p[2] >= rho) return p;
  return null;
}
/** how far the cracks of a plan reach at ms after contact (px of path), and the retract cut (path px beyond which nothing shows) */
export function crackReach(line, ms, still = false) {
  if (still) return Infinity;
  const t = ms - line.t0;
  if (t < 0) return 0;
  const total = line.pts[line.pts.length - 1][2] - line.pts[0][2];
  const T = total / line.speed;
  return line.pts[0][2] + total * easeOut(t / Math.max(1, T));
}
export function crackCut(plan, ms) {
  const { gone, retract } = plan.life;
  if (ms < gone - retract) return Infinity;
  return plan.maxD * clamp(1 - (ms - (gone - retract)) / retract, 0, 1);
}

/** ms after contact when a plan is over */
export const endOf = (p) => (p.kind === "blood" ? p.life.gone + p.life.dissolve + (p.second ? p.second.delay : 0) : p.life.gone);
