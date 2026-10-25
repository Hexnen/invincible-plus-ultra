/* Dice effects art: PURE functions (no DOM, no Foundry) that return SVG markup strings, so node can render a preview
   (node -e "import('./scripts/diceeffects/art.mjs').then(m=>console.log(m.svg('one','x',true)))"). viewBox is -110..110, the die sits in the middle.
   Language of the module: Ben-Day halftone dots, a hand-pulled misprint duplicate in ink, the comic palette (yellow, red-ink, ink).
   SIX = golden halftone ring (+ a starburst when bold).  ONE = a magenta X-mark in a halftone ring (alt: a red burst); no cracks.
   No zero-offset glows anywhere: depth is the offset ink duplicate and the stroke. Same (seed, bold) = same drawing. */

const YELLOW = "#ffe72a", INK = "#0c1a2e", RED = "#d2352b", RED_DEEP = "#8f1c16";
const TAU = Math.PI * 2;

function prng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(str) {   // FNV-1a
  let h = 0x811c9dc5;
  const s = String(str ?? "");
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const f = (n) => (Math.round(n * 10) / 10).toString();

/* staggered halftone lattice; size(x, y, ang, d) returns a dot radius (<= 0.35 means skip) */
function lattice(cell, reach, size, rot = 0) {
  const out = [];
  const rows = Math.ceil(reach / (cell * 0.866)) + 1;
  const cols = Math.ceil(reach / cell) + 1;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let j = -rows; j <= rows; j++) {
    for (let i = -cols; i <= cols; i++) {
      const lx = (i + (j & 1 ? 0.5 : 0)) * cell, ly = j * cell * 0.866;
      const x = lx * cr - ly * sr, y = lx * sr + ly * cr;
      const d = Math.hypot(x, y);
      if (d > reach) continue;
      const r = size(x, y, Math.atan2(y, x), d);
      if (r > 0.35) out.push([x, y, r]);
    }
  }
  return out;
}
const circles = (dots) => dots.map(([x, y, r]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`).join("");

/* a wobbling radius by angle: a few sine harmonics with seeded phases (the ring is never a perfect circle) */
function wobble(rnd, amp) {
  const ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
  return (a) => 1 + amp * (0.55 * Math.sin(2 * a + ph[0]) + 0.3 * Math.sin(3 * a + ph[1]) + 0.15 * Math.sin(5 * a + ph[2]));
}

/* ================= SIX ================= */
export function six(seed, bold = false) {
  const rnd = prng(hashSeed(seed) ^ 0x6a6a);
  const wob = wobble(rnd, 0.07);
  const ring = lattice(10.5, 100, (x, y, a, d) => {
    const mid = (bold ? 72 : 68) * wob(a), half = bold ? 24 : 27;
    const t = 1 - Math.abs(d - mid) / half;
    return t > 0 ? 5.1 * Math.pow(t, 0.85) : 0;
  }, 0.26);
  /* a few stray dots outside the band: the print is not clean */
  const stray = [];
  for (let i = 0; i < (bold ? 16 : 9); i++) {
    const a = rnd() * TAU, d = (bold ? 86 : 84) + rnd() * 10;
    stray.push([Math.cos(a) * d, Math.sin(a) * d, 1.4 + rnd() * 1.9]);
  }
  const dots = ring.concat(stray);
  let g = "";
  if (bold) {
    const spikes = 15, pts = [];
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * TAU + rnd() * 0.05;
      const r = i % 2 ? 66 + rnd() * 6 : 91 + rnd() * 8;
      pts.push(`${f(Math.cos(a) * r)},${f(Math.sin(a) * r)}`);
    }
    g += `<g class="burst"><polygon points="${pts.join(" ")}" fill="${INK}" opacity=".5" transform="translate(4 5)"/><polygon points="${pts.join(" ")}" fill="${YELLOW}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="miter"/></g>`;
    g += `<g class="dots" fill="${INK}" opacity=".34">${circles(dots.filter(([x, y]) => Math.hypot(x, y) > 40 && Math.hypot(x, y) < 76))}</g>`;
    let rays = "";
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + 0.15 + rnd() * 0.2, r0 = 96 + rnd() * 2, r1 = r0 + 5 + rnd() * 4;
      rays += `<line x1="${f(Math.cos(a) * r0)}" y1="${f(Math.sin(a) * r0)}" x2="${f(Math.cos(a) * r1)}" y2="${f(Math.sin(a) * r1)}"/>`;
    }
    g += `<g class="rays" stroke="${YELLOW}" stroke-width="2.6" stroke-linecap="round">${rays}</g>`;
  } else {
    g += `<g class="print" transform="translate(3 3.5)" fill="${INK}" opacity=".55">${circles(dots)}</g>`;
    g += `<g class="dots" fill="${YELLOW}">${circles(dots)}</g>`;
  }
  return g;
}

/* ================= ONE =================
   Why the first version was ugly: dark ink dots and dark strokes on a dark map read as a muddy blotch, the cracks were busy and ugly, the offset misprint
   smeared it, and the smoke added noise. The fix is a rule: the mark is made of BRIGHT shapes (red / magenta fill, cream outline) with a thin ink shadow
   only as an edge, so it reads on a dark map (bright against it) and on a bright map (the outline and shadow separate it). Few shapes, flat fills.
   Two looks are kept (ONE_STYLES, client setting diceFxOneStyle, hidden): c = magenta X-mark in a halftone ring (the default: the mirror of the six's
   yellow halftone ring), b = jagged red burst with a cream outline. NO cracks or fissure lines in any look (the user dislikes them): shapes only. */
const CREAM = "#fff3dc", MAGENTA = "#e8246a", RED_HOT = "#e8332b";
export const ONE_STYLES = ["c", "b"];

function jagged(rnd, n, rIn, rOut, jitter = 6) {
  const pts = [];
  const off = rnd() * TAU;
  for (let i = 0; i < n * 2; i++) {
    const a = off + (i / (n * 2)) * TAU + (rnd() - 0.5) * 0.12;
    const r = i % 2 ? rIn + (rnd() - 0.5) * jitter : rOut + (rnd() - 0.5) * jitter * 1.4;
    pts.push(`${f(Math.cos(a) * r)},${f(Math.sin(a) * r)}`);
  }
  return pts.join(" ");
}

export function one(seed, bold = false, style = "c") {
  const rnd = prng(hashSeed(seed) ^ 0x1e1e);
  const wob = wobble(rnd, 0.05);
  if (style === "c") {
    /* an X-mark (the failed mark) in a halftone ring of magenta dots; cream edge so it holds on dark, ink shadow so it holds on bright */
    const ring = lattice(10.5, 100, (x, y, a, d) => {
      const mid = 72 * wob(a), half = 22, t = 1 - Math.abs(d - mid) / half;
      return t > 0 ? 4.6 * Math.pow(t, 0.9) : 0;
    }, 0.5);
    let g = `<g class="dots" fill="${MAGENTA}" stroke="${CREAM}" stroke-width=".9">${circles(ring)}</g>`;
    const k = bold ? 68 : 62;
    const x1 = `<line x1="${-k}" y1="${-k}" x2="${k}" y2="${k}"/>`;
    const x2 = `<line x1="${k}" y1="${-k}" x2="${-k}" y2="${k}"/>`;
    g += `<g class="xmark" fill="none" stroke-linecap="square" stroke-linejoin="miter"><g stroke="${INK}" stroke-width="18" opacity=".55" transform="translate(3 4)">${x1}${x2}</g><g stroke="${CREAM}" stroke-width="16">${x1}${x2}</g><g stroke="${MAGENTA}" stroke-width="9.5">${x1}${x2}</g></g>`;
    return g;
  }
  /* b: a jagged red burst (a shattered star), cream outline, ink shadow edge */
  const pts = jagged(rnd, bold ? 11 : 9, bold ? 54 : 48, bold ? 96 : 88);
  let g = `<g class="burst"><polygon points="${pts}" fill="${INK}" opacity=".5" transform="translate(4 5)"/><polygon points="${pts}" fill="${RED_HOT}" stroke="${CREAM}" stroke-width="4.2" stroke-linejoin="miter"/></g>`;
  return g;
}

/* a standalone SVG string for one effect */
export function svg(kind, seed, bold = false, style = "c") {
  const body = kind === "six" ? six(seed, bold) : one(seed, bold, style);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-110 -110 220 220" aria-hidden="true" focusable="false">${body}</svg>`;
}
