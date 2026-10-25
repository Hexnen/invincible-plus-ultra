/* Token halo: the dot placement, a PURE function (no PIXI, no Foundry), so the same file can be run by node for the design preview
   (tools/halo-preview.py reads the JSON that `node scripts/tokenhalo/dots.mjs --dump` prints) and by the canvas code (halo.mjs).

   The look: an irregular ring of comic-book halftone (Ben-Day) dots. It is a real halftone, not dots placed on a circle: a regular
   staggered lattice of dots is laid over the token and the DOT SIZE follows a band around a wobbling ring: biggest on the ring's
   centreline, shrinking to nothing at its inner and outer edge, so the ring reads as a printed tone fading at its borders. The ring's
   radius wobbles with low-frequency noise (a few sine harmonics with seeded phases, so every token has its own stable shape), the
   whole ring is a little off-centre (a hand-pulled stamp), a few stray dots sit outside the band, and the TURN variant adds an outer
   chain of larger beads. A faint halftone disc (a printed shadow) can sit under the token.

   Everything is in canvas pixels, relative to the token's centre. No randomness except a seeded PRNG: same (seed, size, options) =
   same dots, in the browser and in node. */

/* ---------- small helpers ---------- */
export function hashSeed(str) {   // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function prng(seed) {             // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

export const VARIANTS = ["hover", "select", "turn"];

/* The module's comic palette by token disposition (chat.css tokens: cyan, yellow, red-ink, ink). FRIENDLY cyan, NEUTRAL yellow, HOSTILE red-ink,
   SECRET a muted violet-grey; TURN is always the accent yellow. INK is the misprint duplicate under the dots. Hex strings; halo.mjs converts. */
export const PALETTE = Object.freeze({ friendly: "#1ea8e6", neutral: "#ffe72a", hostile: "#d2352b", secret: "#8a79a8", turn: "#ffe72a", ink: "#0c1a2e" });

/* per variant: how much of the full ring it shows */
const V = {
  hover: { bw: 0.84, rmax: 0.9, stray: 0.55, disc: false, outer: false, lift: 0 },
  select: { bw: 1, rmax: 1, stray: 1, disc: true, outer: false, lift: 0 },
  turn: { bw: 1.04, rmax: 1.02, stray: 1.1, disc: true, outer: true, lift: 0.03 }
};

/* Dots for one token.
     seed    any string / number (the token id)
     sizePx  the token's external diameter in canvas pixels (min of width and height)
     opts    { cell: grid size in px (default 100), variant: "hover" | "select" | "turn", ring: size multiplier (0.85 / 1 / 1.2) }
   Returns [{ x, y, r, g, k }]: g = shimmer group (0 steady, 1 shimmers), k = "ring" | "stray" | "outer" | "disc". */
export function dotsFor(seed, sizePx, opts = {}) {
  const cell = opts.cell > 0 ? opts.cell : 100;
  const variant = V[opts.variant] ? opts.variant : "select";
  const vv = V[variant];
  const ringMul = opts.ring > 0 ? opts.ring : 1;
  const R = Math.max(8, sizePx / 2);
  const rnd = prng(typeof seed === "number" ? seed : hashSeed(seed));

  /* scale of the print: small tokens get slightly finer dots, big ones slightly coarser, never extreme */
  const s = clamp(Math.pow((2 * R) / cell, 0.35), 0.75, 1.5);
  const p = 0.074 * cell * s;                                 // lattice pitch
  const rmax = 0.45 * p * vv.rmax;                            // biggest dot radius (a hex lattice touches at 0.5 p)
  const minR = Math.max(0.55, 0.075 * p);                     // anything smaller is not printed

  /* ring geometry */
  const bw0 = 0.175 * cell * (0.88 + 0.12 * Math.log2(Math.max(1, (2 * R) / cell) + 1)) * ringMul * vv.bw;
  const rc0 = R + (0.15 + vv.lift) * cell * ringMul;         // centreline radius
  const Wr = Math.min(R, 0.75 * cell);                        // wobble scale: big tokens do not get a ring that drifts away from them
  const harm = [                                              // radial wobble: k, amplitude (fraction of R), phase
    [1, 0.02 + rnd() * 0.025, rnd() * TAU],
    [2, 0.05 + rnd() * 0.05, rnd() * TAU],
    [3, 0.04 + rnd() * 0.045, rnd() * TAU],
    [4, 0.025 + rnd() * 0.03, rnd() * TAU],
    [6, 0.012 + rnd() * 0.02, rnd() * TAU]
  ];
  const wob = (phi) => { let w = 0; for (const [k, a, ph] of harm) w += a * Math.sin(k * phi + ph); return w * Wr * 1.35; };
  const bwPh = rnd() * TAU, mPh = rnd() * TAU;
  const bwAt = (phi) => bw0 * (0.82 + 0.3 * (0.5 + 0.5 * Math.sin(2 * phi + bwPh)) + 0.08 * Math.sin(5 * phi + mPh));
  const dropAt = (phi) => 0.84 + 0.16 * Math.sin(3 * phi + mPh);   // low-frequency "ink density" (misprint)
  const ecc = rnd() * TAU, eccR = (0.035 + rnd() * 0.035) * Wr;
  const ox = Math.cos(ecc) * eccR, oy = Math.sin(ecc) * eccR;      // the ring is not centred on the token

  const dots = [];
  const reach = rc0 + bw0 * 2.4 + R * 0.2;

  /* the lattice: staggered rows, rotated, random origin */
  const lattice = (theta, pitch, cb) => {
    const c = Math.cos(theta), sn = Math.sin(theta);
    const rowH = pitch * 0.8660254;
    const n = Math.ceil(reach / rowH) + 1;
    const o1 = rnd() * pitch, o2 = rnd() * rowH;
    let idx = 0;
    for (let j = -n; j <= n; j++) {
      for (let i = -n - 1; i <= n + 1; i++) {
        const lx = i * pitch + (j & 1 ? pitch / 2 : 0) + o1;
        const ly = j * rowH + o2;
        const x = lx * c - ly * sn, y = lx * sn + ly * c;
        cb(x, y, idx++);
      }
    }
  };

  /* shadow disc: a faint halftone under the token, bigger dots toward its rim, drifting down-right like a drop shadow */
  if (vv.disc) {
    const dx = 0.05 * R, dy = 0.065 * R;
    lattice(75 * Math.PI / 180 + rnd() * 0.2, p * 0.9, (x, y) => {
      const ρ = Math.hypot(x - dx, y - dy);
      if (ρ > R * 0.98) return;
      const r = rmax * 0.55 * Math.pow(ρ / R, 1.5);
      if (r >= Math.max(minR, 0.8)) dots.push({ x, y, r, g: 0, k: "disc" });
    });
  }

  /* the ring */
  const theta = (45 + (rnd() - 0.5) * 24) * Math.PI / 180;
  lattice(theta, p, (x, y, idx) => {
    const ux = x - ox, uy = y - oy;
    const ρ = Math.hypot(ux, uy);
    if (ρ > reach) return;
    const phi = Math.atan2(uy, ux);
    const bw = bwAt(phi);
    const d = Math.abs(ρ - (rc0 + wob(phi))) / bw;
    const g = ((idx * 2654435761) >>> 0) % 5 < 2 ? 1 : 0;
    if (d < 1) {
      const t = 1 - d;
      const r = rmax * Math.pow(t, 0.8) * dropAt(phi);
      if (r >= minR) dots.push({ x, y, r, g, k: "ring" });
    } else if (d < 2.4) {
      const keep = 0.17 * vv.stray * (2.4 - d) / 1.4;
      const a = rnd(), b = rnd();           // always consumed, so the sequence does not depend on the branch
      if (a < keep) dots.push({ x, y, r: Math.max(minR, rmax * (0.22 + 0.2 * b)), g: 1, k: "stray" });
    }
  });

  /* the turn variant: an outer chain of bigger beads along the wobbling curve, a few missing */
  if (vv.outer) {
    const gap = 0.9 + rnd() * 0.3;
    let phi = rnd() * TAU, n = 0;
    const start = phi;
    while (phi - start < TAU && n < 400) {
      const bw = bwAt(phi);
      const ρ = rc0 + wob(phi) + bw * (1.5 + 0.3 * Math.sin(2 * phi + mPh * 1.7)) + (rnd() - 0.5) * 0.18 * bw;
      const r = p * (0.52 + 0.16 * rnd()) * (0.9 + 0.1 * Math.sin(4 * phi + bwPh));
      const skip = rnd() < 0.09;
      if (!skip) dots.push({ x: ox + Math.cos(phi) * ρ, y: oy + Math.sin(phi) * ρ, r, g: n & 1, k: "outer" });
      phi += (p * 2.6 * gap) / ρ;
      n++;
    }
  }
  return dots;
}

/* the distance from the token's centre to the farthest edge of any dot (to size the texture) */
export function extentOf(dots) {
  let e = 0;
  for (const d of dots) e = Math.max(e, Math.hypot(d.x, d.y) + d.r);
  return e;
}

/* the misprint offset of the ink duplicate, in px */
export function inkOffset(cell, sizePx) {
  const s = clamp(Math.pow(sizePx / (cell > 0 ? cell : 100), 0.35), 0.75, 1.5);
  const o = 0.027 * (cell > 0 ? cell : 100) * s;
  return { x: o * 0.9, y: o };
}

/* ---------- node: `node dots.mjs --dump` prints the preview cases as JSON (the Python preview consumes it) ---------- */
if (typeof process !== "undefined" && process.argv?.[1] && /dots\.mjs$/.test(process.argv[1]) && process.argv.includes("--dump")) {
  const cases = [];
  const sizes = [[1, "1x1"], [2, "2x2"], [0.5, "half"], [4, "4x4"]];
  for (const [cells, name] of sizes) {
    for (const variant of VARIANTS) {
      for (const seed of ["tokenAAAA", "tokenBBBB", "tokenCCCC"]) {
        const sizePx = cells * 100;
        const dots = dotsFor(seed, sizePx, { cell: 100, variant });
        cases.push({ name, variant, seed, sizePx, cell: 100, ink: inkOffset(100, sizePx), extent: extentOf(dots), dots });
      }
    }
  }
  process.stdout.write(JSON.stringify({ palette: PALETTE, cases }));
}
