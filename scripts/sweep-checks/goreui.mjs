// node scripts/sweep-checks/goreui.mjs  (GOREUI, 2026-11-16. A blind review of tag tactics-integrated-161 found, live: D6 the screen
// cracks are thin lines in one corner lying over the toolbar's and the sidebar's icons and, at level 3, over a panel's header, and
// level 3 is not visibly bigger than level 2; D10 blood lies over the zone badges and a map pin, and at a far zoom (0.2) one
// knock-down's blood spans about three token widths.)
// The rule: no effect of the glass hides what a seat reads (interface, map pins, zone badges, tokens); the three crack levels are told
// apart at a glance while all stay hairlines; blood keeps a sensible size beside its token at every zoom.
// Pure (scripts/gore/plan.mjs, raster.mjs):
//   LEVELS  one blow at the table's levels 1, 2, 3: each web clearly larger than the one before (reach and ink), at every strength, a
//           broken Resolve included (on tag 161: reach 2 -> 3 grew x 1.00 - 1.32); level 2 is the web it was (pinned fingerprint of
//           60 plans taken on tag 161); all three keep the same colours and alphas, cover little, stay in their corner;
//   CORNER  a seat breaks the seed's corner when it is as free as any, else the nearest free one; a seat that cannot tell keeps the seed's;
//   CUT     a pane of cracks handed a token's disc or a pin's box draws nothing inside it through its whole life (strike, hold, the
//           glass falling out) and is untouched elsewhere;
//   MARKS   a splash handed a zone badge and a pin as keep-outs lays no pixel on them through its whole life (before: it does);
//   FAR     a knock-down beside a one-square token at zooms 0.1 .. 2: the body never wider than the token's cap, the ink within a few
//           token widths and a few token areas at every zoom (tag 161's numbers printed beside), still a splash with drops at 0.2;
//           a token at FAR.from of the short side and up, or no token, is drawn exactly as before (pinned fingerprint);
//   UI      (runtime) every control of the page is cut out of the panes by its own box (the interface is partly see-through, so a
//           line UNDER a faded icon is still a line through it); the boxes are read, never hit-tested.
// Runtime on a fake Foundry (scripts/gore/main.mjs): the markers a seat draws (the map's zone badges by who sees them, note pins) are
// read into its view; a splash beside a badge keeps off it and the glass is cut round it; the cracks' pane is cut round tokens and
// markers; a break takes the table's level and the corner this seat shows best; api.debug({ marks: false }) is the behaviour before.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const dir = dirname(fileURLToPath(import.meta.url)), root = join(dir, "..");
const P = await import("../gore/plan.mjs");
const R = await import("../gore/raster.mjs");
const T = P.TICK_MS;
const g = P.grid(1600, 900, 1), m = Math.min(g.w, g.h), sf = R.surface(g.w, g.h);
const wipe = () => R.render(sf, [], 1e7);
const alphaAt = (x, y) => sf.rgba[(y * g.w + x) * 4 + 3];

/* ---------------- LEVELS ---------------- */
{
  /* a web at 2 s: its reach from the corner (share of the view's short side), its line pixels, its colours */
  const web = (p) => {
    R.render(sf, [{ plan: p, t0: 0 }], 2000);
    let far = 0, px = 0; const cols = new Set();
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { const a = alphaAt(x, y); if (!a) continue; const o = (y * g.w + x) * 4; cols.add(`${sf.rgba[o]},${sf.rgba[o + 1]},${sf.rgba[o + 2]},${a}`); if (a > 60) px++; far = Math.max(far, Math.hypot(x + 0.5 - p.origin.x, y + 0.5 - p.origin.y)); }
    wipe();
    return { far: far / m, px, cover: px / (g.w * g.h), cols };
  };
  const pal = new Set(Object.values(R.CRACK).map((c) => c.join(",")));
  let worst12 = Infinity, worst23 = Infinity, ink12 = Infinity, ink23 = Infinity, maxCover = 0, maxFar = 0, offPal = 0, each = 0, cases = 0;
  const rows = [];
  for (const s0 of [0.25, 0.45, 0.6, 0.85, 1]) {
    const mean = [0, 0, 0], ink = [0, 0, 0];
    for (let i = 0; i < 16; i++) {
      const w = [1, 2, 3].map((lvl) => web(P.crackPlan(g, { strength: P.scaled(s0, lvl), seed: `lv|${i}`, level: lvl })));
      w.forEach((q, k) => { mean[k] += q.far / 16; ink[k] += q.px / 16; maxCover = Math.max(maxCover, q.cover); maxFar = Math.max(maxFar, q.far); for (const c of q.cols) if (!pal.has(c)) offPal++; });
      cases++; if (w[0].far < w[1].far && w[1].far < w[2].far) each++;
    }
    worst12 = Math.min(worst12, mean[1] / mean[0]); worst23 = Math.min(worst23, mean[2] / mean[1]); ink12 = Math.min(ink12, ink[1] / ink[0]); ink23 = Math.min(ink23, ink[2] / ink[1]);
    rows.push(`${s0}: ${mean.map((v) => v.toFixed(2)).join(" < ")}`);
  }
  console.log(`  a web's reach (share of the short side) at levels 1 < 2 < 3 by the blow's strength: ${rows.join("; ")}   (tag 161, strength 0.6: 0.18, 0.20, 0.23; a broken Resolve: 0.21, 0.31, 0.31)`);
  ck(`level 2 reaches at least 1.4 x level 1 at every strength (least ${worst12.toFixed(2)}), level 3 at least 1.3 x level 2 (least ${worst23.toFixed(2)}; on tag 161: 1.00 - 1.32)`, worst12 >= 1.4 && worst23 >= 1.3);
  ck(`... and draws clearly more glass each step (ink x ${ink12.toFixed(2)} and x ${ink23.toFixed(2)} at least, >= 1.35)`, ink12 >= 1.35 && ink23 >= 1.35);
  ck(`the same blow is larger at each level for every seed (${each} of ${cases})`, each === cases);
  ck(`all three levels stay subtle: the same hairline colours and alphas (${offPal} pixels off the cracks' palette), at most ${(maxCover * 100).toFixed(2)} % of the view (<= 1.5 %), within ${maxFar.toFixed(2)} of the short side from the corner (<= 0.55)`, offPal === 0 && maxCover <= 0.015 && maxFar <= 0.55);
  ck("a broken Resolve at level 3 is larger than at level 2 (on tag 161 they were the same web)", P.crackReachOf(P.scaled(1, 3), 3) > P.crackReachOf(P.scaled(1, 2), 2) * 1.3);
  /* level 2 = the web it was: 60 plans' fingerprint taken on tag tactics-integrated-161 with this very loop */
  const h = createHash("sha1");
  for (let i = 0; i < 60; i++) { const p = P.crackPlan(g, { strength: 0.15 + (i % 10) * 0.12, seed: `cfp|${i}`, safe: i % 7 === 0, still: i % 11 === 0 }); delete p.level; h.update(JSON.stringify(p)); }
  ck("level 2 (and a plan given no level) is exactly the web of tag 161 (60 plans, pinned fingerprint)", h.digest("hex") === "8e5d013cbc7b3e29317890440df8f5b79cfeefdc");
  ck("a level out of range is cleaned (0, 9, NaN -> 1, 3, 2)", P.crackPlan(g, { seed: "x", level: 0 }).level === 1 && P.crackPlan(g, { seed: "x", level: 9 }).level === 3 && P.crackPlan(g, { seed: "x", level: NaN }).level === 2);
  const a = P.crackPlan(g, { strength: 0.7, seed: "turn", corner: 0 }), b = P.crackPlan(g, { strength: 0.7, seed: "turn", corner: 2 });
  ck("the corner a seat breaks does not change the web (the same lines, mirrored into that corner)", a.lines.length === b.lines.length && a.lines.every((l, i) => l.pts.length === b.lines[i].pts.length && Math.abs((l.pts[l.pts.length - 1][0] - a.origin.x) + (b.lines[i].pts[l.pts.length - 1][0] - b.origin.x)) < 1e-6));
}

/* ---------------- CORNER ---------------- */
{
  const c0 = P.seedCorner("pick");
  ck("the seed's corner is the plan's own when nothing else decides", P.crackPlan(g, { seed: "pick" }).corner === c0 && P.pickCorner("pick", null) === c0 && P.pickCorner("pick", [0.2, NaN, 0, 0]) === c0);
  ck("every corner equally free: the seed's (every seat the same)", P.pickCorner("pick", [0.3, 0.3, 0.3, 0.3]) === c0);
  const sc = [0.1, 0.1, 0.1, 0.1]; sc[c0] = 0.1 + P.CORNER_TOL - 0.01;
  ck("the seed's corner within the tolerance of the freest: kept", P.pickCorner("pick", sc) === c0);
  const full = [0.2, 0.2, 0.2, 0.2]; full[c0] = 0.9;
  ck("the seed's corner filled by the interface: the next free one clockwise", P.pickCorner("pick", full) === (c0 + 1) % 4);
  const one = [0.95, 0.95, 0.95, 0.95]; one[(c0 + 2) % 4] = 0.3;
  ck("only one corner shows the web: that one", P.pickCorner("pick", one) === (c0 + 2) % 4);
  let seen = new Set(), inside = true;
  for (let c = 0; c < 4; c++) { const pts = P.cornerProbe(c, 0.25, 1600, 900); seen.add(pts.length); const [kx, ky] = P.CORNERS[c]; for (const q of pts) if (!(q.fx > 0 && q.fx < 1 && q.fy > 0 && q.fy < 1) || Math.hypot((q.fx - kx) * 1600, (q.fy - ky) * 900) > 0.25 * 900 + 1e-6) inside = false; }
  ck(`a corner is probed on a grid inside the web's quarter (${[...seen][0]} points, every corner alike)`, inside && seen.size === 1 && [...seen][0] >= 40);
}

/* ---------------- CUT: the cracks' pane round a token or a marker ---------------- */
{
  const p = P.crackPlan(g, { strength: 1, seed: "cut", corner: 3, level: 3 }), it = { plan: p, t0: 0 };
  /* a token's disc and a pin's box, both where the web runs (bottom left corner) */
  const disc = { x: 28, y: g.h - 30, r: 9 }, box = { x0: 52, y0: g.h - 16, x1: 66, y1: g.h - 4 };
  const inD = (x, y) => Math.hypot(x + 0.5 - disc.x, y + 0.5 - disc.y) < disc.r, inB = (x, y) => x + 0.5 > box.x0 && x + 0.5 < box.x1 && y + 0.5 > box.y0 && y + 0.5 < box.y1;
  let inside = 0, wasInside = 0, differs = 0, drawn = 0, cutMax = 0;
  for (let ms = 0; ms <= p.life.gone; ms += ms < 600 || ms > P.breakAt(p) - 100 ? T : 400) {
    R.render(sf, [it], ms + 1);
    const plain = Uint8ClampedArray.from(sf.rgba);
    wipe();
    R.render(sf, [it], ms + 1, [disc, box]);
    cutMax = Math.max(cutMax, sf.cut);
    for (let y = g.h - 170; y < g.h; y++) for (let x = 0; x < 200; x++) {
      const o = (y * g.w + x) * 4, hit = inD(x, y) || inB(x, y);
      if (hit) { if (plain[o + 3]) wasInside++; if (sf.rgba[o + 3]) inside++; }
      else { if (sf.rgba[o + 3]) drawn++; if (sf.rgba[o + 3] !== plain[o + 3] || sf.rgba[o] !== plain[o]) differs++; }
    }
    wipe();
  }
  ck(`the web runs over the token's disc and the pin's box when nothing cuts it (${wasInside} px through its life)`, wasInside > 200);
  ck(`cut by them: no crack pixel inside either through the strike, the hold and the glass falling out (${inside}), ${cutMax} px left out at most`, inside === 0 && cutMax > 10);
  ck(`... and the web elsewhere is untouched (${differs} px differ of ${drawn})`, differs === 0 && drawn > 1000);
}

/* ---------------- MARKS: a splash beside a zone badge and a pin ---------------- */
{
  const lifeOn = (p, shapes) => {
    const it = { plan: p, t0: 0 }, end = P.endOf(p);
    let on = 0, drawn = 0;
    const hit = (cx, cy) => shapes.some((d) => (d.r !== undefined ? (cx - d.x) ** 2 + (cy - d.y) ** 2 < d.r * d.r : cx > d.x0 && cx < d.x1 && cy > d.y0 && cy < d.y1));
    for (let k = 0; k * T <= end; k += k < 14 ? 1 : k * T > p.life.gone - 100 ? 1 : 9) {
      R.render(sf, [it], k * T + 1);
      const b = sf.box;
      if (!b) continue;
      for (let y = b.y0; y <= b.y1; y++) for (let x = sf.lo[y]; x <= sf.hi[y]; x++) { if (!alphaAt(x, y)) continue; if (k === 12) drawn++; if (hit(x + 0.5, y + 0.5)) on++; }
    }
    wipe();
    return { on, drawn };
  };
  let before = 0, after = 0, none = 0, undrawn = 0, cases = 0, far = 0;
  for (let i = 0; i < 48; i++) {
    const r = P.rng(`marks|${i}`), fr = [0.012, 0.03, 0.055][i % 3], near = { fx: 0.3 + 0.4 * r(), fy: 0.3 + 0.4 * r(), fr };
    const dirA = r() * Math.PI * 2, tr = fr * m, bd = Math.max(19 * 1.2 / 3, tr * 0.5);      // a badge: up to 23 CSS px of radius = 7.6 art px
    /* a zone badge right where the blood flies to, a pin beside it */
    const bx = near.fx * g.w + Math.cos(dirA) * (tr + bd + 4), by = near.fy * g.h + Math.sin(dirA) * (tr + bd + 4);
    const badge = { fx: bx / g.w, fy: by / g.h, fr: bd / m };
    const px = near.fx * g.w + Math.cos(dirA + 0.9) * (tr + 14), py = near.fy * g.h + Math.sin(dirA + 0.9) * (tr + 14);
    const pin = { l: (px - 5) / g.w, t: (py - 9) / g.h, r: (px + 5) / g.w, b: (py + 4) / g.h };
    const shapes = [{ x: bx, y: by, r: bd }, { x0: px - 5, y0: py - 9, x1: px + 5, y1: py + 4 }];
    const base = { strength: [0.4, 0.8, 1][i % 3], seed: `marks|${i}`, dir: dirA, near };
    const p0 = P.bloodPlan(g, base), p1 = P.bloodPlan(g, { ...base, keep: [badge, pin] });
    if (!p0.none && lifeOn(p0, shapes).on > 0) before++;
    cases++;
    if (p1.none) { none++; continue; }
    const L = lifeOn(p1, shapes);
    after += L.on; if (!L.drawn) undrawn++;
    if (Math.hypot(p1.cx - near.fx * g.w, p1.cy - near.fy * g.h) > tr + P.TOK_GAP + p1.R * (2.4 + P.KEEP_FAR) + 3.5) far++;
  }
  ck(`before (no markers handed over): blood lies on the badge or the pin in ${before} of ${cases} splashes`, before >= cases * 0.8);
  ck(`with the zone badge and the pin as keep-outs: no blood pixel on either through a splash's whole life (${after} px), blood still drawn beside its token (${none} without a place, ${undrawn} empty, ${far} far off)`, after === 0 && none <= 1 && undrawn === 0 && far === 0);
}

/* ---------------- FAR: a knock-down beside a token at every zoom ---------------- */
{
  /* tag 161 on these very seeds and zooms (taken before the change): [95 % of the ink within .. token widths of the rim, ink / token area] */
  const WAS = { 0.1: [13.26, 127.5], 0.15: [8.79, 56.8], 0.2: [6.56, 31.9], 0.25: [5.23, 20.4], 0.3: [4.37, 14.2], 0.4: [3.9, 10.6], 0.5: [3.76, 9.3], 0.7: [3.63, 7.7], 1: [3.19, 5.4], 1.4: [2.31, 2.9], 2: [1.59, 1.4] };
  const rows = [];
  let okSpan = true, okArea = true, okBody = true, okSplash = true, lastR = 0, mono = true, second02 = 0, far02 = [0, 0];
  const FAR02 = [100, 20];
  for (const z of [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.7, 1, 1.4, 2]) {
    const fr = (50 * z) / 900, tr = fr * m;      // a one-square (100 px) token on a 900 px high view
    let span = 0, area = 0, ink = 0, Rm = 0, drops = 0;
    const N = 16;
    for (let i = 0; i < N; i++) {
      const p = P.bloodPlan(g, { strength: 1, seed: `far|${i}`, dir: i * 0.9, near: { fx: 0.5, fy: 0.5, fr }, hold: 1 });
      R.render(sf, [{ plan: p, t0: 0 }], 1500);
      const ds = [];
      for (let y = sf.box.y0; y <= sf.box.y1; y++) for (let x = sf.lo[y]; x <= sf.hi[y]; x++) if (alphaAt(x, y)) ds.push(Math.hypot(x + 0.5 - g.w / 2, y + 0.5 - g.h / 2));
      wipe();
      ds.sort((a, b) => a - b);
      span += (ds[Math.floor(ds.length * 0.95)] - tr) / (2 * tr) / N; area += ds.length / (Math.PI * tr * tr) / N; ink += ds.length / N; Rm += p.R / N; drops += (p.sats.length + p.tendrils.length) / N;
      if (p.R > Math.max(P.R_FLOOR, P.NEAR_K * tr) + 1e-9) okBody = false;
      if (p.second && p.second.plan.R > Math.max(P.R_FLOOR, P.FAR.second * Math.max(P.R_FLOOR, P.NEAR_K * tr)) + 1e-9) okBody = false;
      if (z === 0.2 && p.second) second02++;
    }
    if (z <= 1 && span > (z < 0.15 ? 4.5 : 3.4)) okSpan = false;
    if (z >= 0.15 && area > 6.5) okArea = false;
    if (z === 0.2) far02 = [Math.round(ink), Math.round(drops)];
    if (z === 0.2 && (ink < FAR02[0] || drops < FAR02[1])) okSplash = false;
    if (z === 0.1 && ink < 60) okSplash = false;
    if (Rm < lastR - 1e-9) mono = false; lastR = Rm;
    rows.push(`${z}: ${span.toFixed(1)} / ${area.toFixed(1)} (was ${WAS[z][0].toFixed(1)} / ${WAS[z][1].toFixed(1)})`);
  }
  console.log(`  a knock-down beside a one-square token, by zoom: 95 % of its ink within N token widths of the rim / its ink in token areas: ${rows.join("; ")}`);
  ck("at every zoom the body is no wider than the token's cap (NEAR_K token radii, never under R_FLOOR art px); a second blow at most FAR.second of that", okBody);
  ck("at every zoom up to 1 the splash stays within 3.4 token widths of its token (4.5 at the pixel floor, zoom 0.1; tag 161: 6.6 at zoom 0.2, 13.3 at 0.1)", okSpan);
  ck("from zoom 0.15 up its ink is at most 6.5 token areas (tag 161: 32 at zoom 0.2)", okArea);
  ck(`at zoom 0.2 it is still a splash with drops (${far02[0]} px of ink, ${far02[1]} drops or spikes; at least ${FAR02[0]} and ${FAR02[1]}), at 0.1 still seen`, okSplash);
  ck("a closer zoom never draws a smaller body", mono);
  ck(`at zoom 0.2 a knock-down has no second blow beside its first (${second02} of 16)`, second02 === 0);
  /* where the far rule does not reach nothing changed: goreclear.mjs's plans with no token or a token at 9 % of the short side, whole
     (second blow included), fingerprint taken on tag 161 */
  const h = createHash("sha1");
  for (const [vw, vh] of [[1920, 1080], [1366, 768], [1600, 900]]) {
    const ge = P.grid(vw, vh, 1);
    for (let i = 0; i < 60; i++) {
      if (i % 3 === 1) continue;
      const s = [0.25, 0.5, 0.8, 1, 1.25][i % 5];
      const near = i % 3 === 0 ? null : { fx: 0.08 + 0.84 * ((i * 37) % 100) / 100, fy: 0.08 + 0.84 * ((i * 61) % 100) / 100, fr: 0.09 };
      h.update(JSON.stringify(P.bloodPlan(ge, { strength: s, seed: `fp|${i}`, dir: i % 4 === 0 ? null : i * 0.7, near, at: i % 7 === 3 ? { fx: 0.3, fy: 0.6 } : null, hold: 1 })));
    }
  }
  ck("a token drawn at FAR.from of the short side or larger, or no token: the splash is exactly tag 161's (120 plans, pinned fingerprint)", h.digest("hex") === "b4757598ec4b0d4f2122ce4c31b8c85d20449a1b");
  { const at = (fr) => P.bloodPlan(g, { strength: 1, seed: "edge", dir: 1, near: { fx: 0.5, fy: 0.5, fr }, hold: 1 });
    const a = at(P.FAR.from + 0.0005), b2 = at(P.FAR.from - 0.0005);
    ck(`the far rule sets in without a jump (body ${a.R.toFixed(2)} -> ${b2.R.toFixed(2)} art px across FAR.from)`, Math.abs(a.R - b2.R) < 0.5 && !!a.second && !!b2.second); }
  const free = P.bloodPlan(g, { strength: 1, seed: "nf", dir: 1 });
  ck("a splash with no token (a public call) is not touched by the far rule (its second blow as before: 0.67 of the first)", !!free.second && Math.abs(free.second.plan.R / free.R - 0.6714) < 0.01);
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
  globalThis.cancelAnimationFrame = () => { rafs.length = 0; };
  const advance = (ms) => { const end = clock + ms; while (clock < end) { const step = Math.min(end, clock + 20); for (;;) { const t = timers.filter((x) => x.fn && x.at <= step).sort((a, b) => a.at - b.at)[0]; if (!t) break; clock = Math.max(clock, t.at); const fn = t.fn; t.fn = null; fn(); } clock = step; for (const fn of rafs.splice(0)) fn(); } };
  globalThis.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  const puts = {};
  const made = [];
  const el = () => { const e = { style: {}, setAttribute() {}, appendChild() {}, after(c) { made.push([`after ${e.id}`, c.id]); }, remove() {}, isConnected: true, getBoundingClientRect: () => ({ width: 40, height: 40 }), getContext: () => ({ putImageData(img) { puts[e.pane ?? "?"] = img; }, clearRect() {}, drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16 * 16 * 4).fill(0) }) }) }; return e; };
  /* a canvas made for a pane remembers which pane it is in (its wrap gets the id after it is made) */
  const wraps = [];
  const board = { ...el(), id: "board", after(c) { made.push(["after board", c.id]); } };
  /* the interface of this seat: rects (client px) that take the pointer; everywhere else the board does */
  let ui = [];
  /* (the page: the board, then the interface, a container as large as the window whose controls are the rects of `ui`; the glass
     READS the controls' boxes, it runs no hit tests: a page without elementFromPoint, as here, is served the same) */
  const rectOf = (q) => ({ left: q.x, top: q.y, right: q.x + q.w, bottom: q.y + q.h, width: q.w, height: q.h });
  const iface = { id: "interface", tagName: "DIV", getBoundingClientRect: () => rectOf({ x: 0, y: 0, w: 1600, h: 900 }), querySelectorAll: () => ui.map((q) => ({ getBoundingClientRect: () => rectOf(q) })) };
  const body = el(); body.children = [board, iface];
  globalThis.document = { getElementById: (id) => (id === "board" ? board : null), body, documentElement: {},
    createElement: (tag) => { const e = el(); if (tag === "div") { wraps.push(e); e.appendChild = (c) => { Object.defineProperty(c, "pane", { get: () => e.id }); }; } return e; } };
  globalThis.getComputedStyle = () => ({ zIndex: "0" });
  globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
  const user = { isGM: false, id: "P1" };
  /* the map module: three zones with numbered badges (the corner place asks its geometry for the point) */
  const look = { numbers: "always", who: "all", place: "label" };
  const zones = [{ id: 0, label: { x: 1000, y: 450, r: 40 } }, { id: 1, label: { x: 300, y: 300, r: 40 } }, { id: 2, label: { x: 5000, y: 5000, r: 40 } }];
  const maps = { active: true, api: { zones: { zones: () => ({ zones }), look: () => look, geometry: { cornerPoint: (q) => ({ x: q.label.x - 60, y: q.label.y - 60 }) } } } };
  globalThis.game = { user, settings: { settings, register: (mm, k, o) => { settings.set(`${mm}.${k}`, o); if (!(`${mm}.${k}` in values)) values[`${mm}.${k}`] = o.default; }, get: (mm, k) => { if (!settings.has(`${mm}.${k}`)) throw new Error("not registered"); return values[`${mm}.${k}`]; } },
    modules: new Map([["invincible-plus-ultra", {}], ["moinen-maps", maps]]), socket: { on() {}, emit() {} }, combats: new Map() };
  settings.set("invincible-plus-ultra.tokenReactEnabled", {}); values["invincible-plus-ultra.tokenReactEnabled"] = false;
  const scene = { id: "S" };
  const mkTok = (id, x, y) => { const actor = { id: `A${id}`, type: "character", system: { derived: { health: { value: 6, max: 6 }, resolve: { value: 6, max: 6 } } }, testUserPermission: () => true, getActiveTokens: () => [tok] }; const tok = { id, name: id, actor, scene, visible: true, isVisible: true, document: { hidden: false }, center: { x, y }, w: 100, h: 100 }; return tok; };
  const toks = [mkTok("T1", 800, 450)];
  /* a note pin drawn 30 x 44 world px above its point, one this seat is not shown */
  const mkNote = (id, x, y, o = {}) => ({ document: { id, x, y, iconSize: 40 }, visible: o.visible ?? true, renderable: true, scale: { x: 1 }, getLocalBounds: () => ({ x: -15, y: -40, width: 30, height: 44 }) });
  const notes = [mkNote("N1", 800, 300), mkNote("N2", 600, 600, { visible: false })];
  /* the view: 1600 x 900, the scene drawn 1:1 from the window's corner (zoom(z) keeps world (800, 450) in the middle) */
  const stage = { scale: { x: 1, y: 1 }, pivot: { x: 800, y: 450 }, position: { x: 800, y: 450 } };
  globalThis.canvas = { ready: true, scene, stage, dimensions: { size: 100 }, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } }, tokens: { get: (id) => toks.find((t) => t.id === id), get placeables() { return toks; } }, notes: { get placeables() { return notes; } } };
  globalThis.MoinenLetters = { engine: () => ({ impact: { busy: false } }) };
  const M = await import("../gore/main.mjs?goreui");
  M.start({ init: true, ready: true });
  await new Promise((r) => r());
  const api = game.modules.get("invincible-plus-ultra").api.gore;
  const later = () => { clock += M.MARK_MS + 600; };      // the markers and the board's origin are read again
  const reset = () => { api.clear({ quick: true }); api.log({ clear: true }); ui = []; for (const t of toks) { t.actor.system.derived.health.value = 6; t.actor.system.derived.resolve.value = 6; } for (const fn of hooks.canvasReady ?? []) fn(); later(); };
  const hurt = (tok, stat, to) => { tok.actor.system.derived[stat].value = to; for (const fn of hooks.updateActor ?? []) fn(tok.actor, { system: { derived: { [stat]: { value: to } } } }, { modifiedTime: 900 + to }); };
  const k = g.w / 1600;
  const on = (pane, shape) => { const a = puts[pane]?.data; let c = 0; if (a) for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) { if (!a[(y * g.w + x) * 4 + 3]) continue; const cx = (x + 0.5) / k, cy = (y + 0.5) / k; if (shape.r !== undefined ? Math.hypot(cx - shape.x, cy - shape.y) < shape.r : cx > shape.x0 && cx < shape.x1 && cy > shape.y0 && cy < shape.y1) c++; } return c; };
  const shown = (pane) => { const a = puts[pane]?.data; let c = 0; if (a) for (let j = 3; j < a.length; j += 4) if (a[j]) c++; return c; };

  /* the panes */
  api.cracks({ strength: 0.5, seed: "panes" }); api.blood({ strength: 0.5, seed: "panes" });
  ck("the cracks' pane is put right after the blood's, the blood's and the shade right after #board: all three under the interface, none on the body",
    made.some(([w, id]) => w === "after board" && id === "ipu-gore") && made.some(([w, id]) => w === "after ipu-gore" && id === "ipu-gore-cracks") && made.some(([w, id]) => w === "after board" && id === "ipu-gore-shade")
    && wraps.every((w) => w.style.zIndex === "0" && w.style.pointerEvents === "none") && M.CRACK_Z === undefined);
  reset();

  /* the markers of this seat */
  const mk = () => api.keepOuts().marks;
  const badge = (id) => mk().find((q) => q.id === `zone:${id}`), pin = (id) => mk().find((q) => q.id === `note:${id}`);
  ck("a zone badge shown to everyone is a disc at its label point, its size the map's (0.8 x label radius x zoom, 8..19 CSS px, x 1.2)", (() => { const b = badge(0); return !!b && Math.abs(b.fx - 1000 / 1600) < 1e-9 && Math.abs(b.fy - 0.5) < 1e-9 && Math.abs(b.fr * 900 - 19 * 1.2) < 1e-9 && M.badgeCss(40, 0.2) === 8 * 1.2 && M.badgeCss(40, 0.5) === 16 * 1.2; })());
  ck("a badge outside the view is not a marker of this seat; a pin is the box of what it draws; a pin this seat is not shown is none", !badge(2) && !!badge(1) && (() => { const q = pin("N1"); return !!q && Math.abs(q.l - 785 / 1600) < 1e-9 && Math.abs(q.r - 815 / 1600) < 1e-9 && Math.abs(q.t - 260 / 900) < 1e-9 && Math.abs(q.b - 304 / 900) < 1e-9; })() && !pin("N2"));
  look.who = "gm"; later();
  const playerSees = mk().filter((q) => q.id.startsWith("zone:")).length;
  user.isGM = true; later();
  ck("badges shown to the GM only: markers on the GM's seat, none on a player's", playerSees === 0 && mk().filter((q) => q.id.startsWith("zone:")).length === 2);
  user.isGM = false; look.who = "all"; look.numbers = "hover"; later();
  ck("badges shown only under the pointer have no place to keep clear of", mk().filter((q) => q.id.startsWith("zone:")).length === 0);
  look.numbers = "always"; look.place = "corner"; later();
  ck("badges in the zone's corner: where the map's geometry puts them", Math.abs(badge(0).fx - 940 / 1600) < 1e-9 && Math.abs(badge(0).fy - 390 / 900) < 1e-9);
  look.place = "label";
  /* the camera: zoom 0.5 round the view's middle */
  stage.scale.x = stage.scale.y = 0.5; later();
  ck("the markers follow the camera (zoom 0.5: the badge half as far from the middle, 16 x 1.2 CSS px; the pin half the size)", Math.abs(badge(0).fx - 900 / 1600) < 1e-9 && Math.abs(badge(0).fr * 900 - 19.2) < 1e-9 && Math.abs((pin("N1").r - pin("N1").l) * 1600 - 15) < 1e-9);
  stage.scale.x = stage.scale.y = 1; later();

  /* blood beside a badge: the struck token at (800, 450), the blood flies right, the badge of zone 0 moved right beside it */
  zones[0].label = { x: 900, y: 450, r: 40 };
  const B0 = { x: 900, y: 450, r: 19 * 1.2 }, N1 = { x0: 785, y0: 260, x1: 815, y1: 304 };
  reset();
  api.debug({ marks: false });
  api.blood({ strength: 1, token: toks[0], seed: "badge", dir: 0 });
  advance(900);
  const was = api.log()[0], wasOn = on("ipu-gore", B0);
  ck(`before (the take's switch off): a knock-down's blood lies on the zone badge beside its token (${wasOn} px shown on it)`, !!was && was.marks === 0 && wasOn > 20);
  api.debug({ marks: true });
  reset();
  api.blood({ strength: 1, token: toks[0], seed: "badge", dir: 0 });
  advance(100);
  const e0 = api.log()[0];
  ck("after: laid out clear of the badge and the pin (the log counts the markers, none of its ink on one), blood on the glass", !!e0 && e0.marks === 3 && e0.how === "clean" && e0.onMark === 0 && e0.ink > 300 && api.state().live === 1);
  let worst = 0, most = 0;
  for (let i = 0; i < 60; i++) { advance(100); most = Math.max(most, shown("ipu-gore")); worst = Math.max(worst, on("ipu-gore", B0) + on("ipu-gore", N1)); }
  ck(`... through six seconds of it: blood shown (${most} px at most), none on the badge or the pin (${worst})`, most > 300 && worst === 0);
  /* the camera moves a badge under a splash that stands: cut at once */
  reset();
  zones[0].label = { x: 3000, y: 3000, r: 40 }; later();
  api.blood({ strength: 1, token: toks[0], seed: "badge", dir: 0 });
  advance(900);
  const freeInk = shown("ipu-gore");
  { const a = puts["ipu-gore"].data; let bx = 0, by = 0, best = 0; for (let y = 6; y < g.h - 6; y += 2) for (let x = 6; x < g.w - 6; x += 2) { let c = 0; for (let v = -4; v <= 4; v++) for (let u = -4; u <= 4; u++) if (a[((y + v) * g.w + x + u) * 4 + 3]) c++; if (c > best) { best = c; bx = x; by = y; } }
    zones[0].label = { x: bx / k, y: by / k, r: 40 }; }
  later(); advance(100);
  const Bm = { x: zones[0].label.x, y: zones[0].label.y, r: 19 * 1.2 };
  ck(`a badge comes to lie under a splash on the glass: no blood is drawn over it (${on("ipu-gore", Bm)} px), the splash stays (${shown("ipu-gore")} of ${freeInk} px)`, on("ipu-gore", Bm) === 0 && shown("ipu-gore") > freeInk * 0.5 && api.log()[0].masked > 0);
  zones[0].label = { x: 1000, y: 450, r: 40 };

  /* cracks: the corner this seat shows best */
  reset();
  const seed = "corner-live", c0 = P.seedCorner(seed), [kx, ky] = P.CORNERS[c0];
  let h = api.cracks({ strength: 0.6, seed });
  let e = api.log().find((q) => q.kind === "cracks");
  ck("a break on a seat with nothing in its corners: the seed's corner (every such seat the same), the corners scored free", !!h && e.corner === c0 && e.seedCorner === c0 && e.scores.every((v) => v === 0));
  reset();
  /* the interface fills the seed's corner (a 420 x 420 px panel there) */
  ui = [{ x: kx ? 1600 - 420 : 0, y: ky ? 900 - 420 : 0, w: 420, h: 420 }];
  api.cracks({ strength: 0.6, seed });
  e = api.log().find((q) => q.kind === "cracks");
  ck(`the interface fills the seed's corner on this seat: the web breaks the next free one (scores ${e.scores.join(" ")})`, e.corner === (c0 + 1) % 4 && e.scores[c0] === 1 && e.scores[e.corner] === 0);
  reset();
  api.debug({ marks: false });
  ui = [{ x: kx ? 1600 - 420 : 0, y: ky ? 900 - 420 : 0, w: 420, h: 420 }];
  api.cracks({ strength: 0.6, seed });
  ck("(the take's switch off: the seed's corner whatever fills it)", api.log().find((q) => q.kind === "cracks").corner === c0);
  api.debug({ marks: true });
  reset();
  ck("a corner given by the caller is kept", api.cracks({ strength: 0.6, seed, corner: 2 }) && api.log().find((q) => q.kind === "cracks").corner === 2);
  /* a panel as large as the view (a layer, not a control) fills no corner */
  reset();
  ui = [];
  const layer = { id: "layer", tagName: "DIV", getBoundingClientRect: () => rectOf({ x: 0, y: 0, w: 1600, h: 900 }), querySelectorAll: () => [] };
  body.children.push(layer);
  api.cracks({ strength: 0.6, seed });
  ck("a layer as large as the window is not the interface (the corners stay free)", api.log().find((q) => q.kind === "cracks").scores.every((v) => v === 0));
  body.children.pop();
  /* a control in the web's corner (every corner of a Foundry seat has some): the web is drawn round it, never through it */
  {
    const [ux, uy] = P.CORNERS[3], btn = { x: ux ? 1600 - 150 : 30, y: uy ? 900 - 150 : 30, w: 120, h: 120 }, disc = { x: btn.x + 60, y: btn.y + 60, r: 56 };
    const run = (marks) => { reset(); ui = [btn]; api.debug({ marks }); api.cracks({ strength: 1, seed: "uicut", corner: 3 }); let worst = 0, most = 0; for (let i = 0; i < 80; i++) { advance(100); most = Math.max(most, shown("ipu-gore-cracks")); worst = Math.max(worst, on("ipu-gore-cracks", disc)); } return { worst, most, log: api.log().find((q) => q.kind === "cracks") }; };
    const off = run(false), onn = run(true);
    ck(`a control in the web's corner: before ${off.worst} px of crack over it, after none through the web's whole life (${onn.worst}), the web still drawn (${onn.most} px), the log counts the control`, off.worst > 10 && onn.worst === 0 && onn.most > 300 && onn.log.ui === 1 && onn.log.masked > 0);
    reset();
  }
  ui = [];

  /* the table's level sizes the web */
  const reachAt = (lvl) => { reset(); values["invincible-plus-ultra.goreCracks"] = lvl; api.cracks({ strength: 0.6, seed: "lvl" }); return api.log().find((q) => q.kind === "cracks"); };
  const r1 = reachAt(1), r2 = reachAt(2), r3 = reachAt(3);
  ck(`the table's crack level reaches the web: ${r1.reach} < ${r2.reach} < ${r3.reach} CSS px on this seat (levels ${r1.level} ${r2.level} ${r3.level}), each at least 1.3 x the one before`, r1.level === 1 && r3.level === 3 && r2.reach >= r1.reach * 1.3 && r3.reach >= r2.reach * 1.3);
  reset();
  values["invincible-plus-ultra.goreCracks"] = 3;
  ck("a raw call (the strength as given) is a level 2 web whatever the table says", api.cracks({ strength: 0.6, seed: "raw", raw: true }) && api.log().find((q) => q.kind === "cracks").level === 2);
  values["invincible-plus-ultra.goreCracks"] = 2;

  /* the cracks' pane is cut round a token and a marker in the web's corner */
  reset();
  const [qx, qy] = P.CORNERS[2];      // bottom right
  toks.push(mkTok("T9", 1600 - 70, 900 - 150));
  zones[1].label = { x: 1600 - 180, y: 900 - 40, r: 40 }; later();
  api.debug({ marks: false });
  api.cracks({ strength: 1, seed: "cutlive", corner: 2 });
  advance(1500);
  const T9 = { x: 1530, y: 750, r: 50 }, Z1 = { x: 1420, y: 860, r: 19 * 1.2 };
  const wasCr = on("ipu-gore-cracks", T9) + on("ipu-gore-cracks", Z1);
  api.debug({ marks: true });
  reset(); zones[1].label = { x: 1600 - 180, y: 900 - 40, r: 40 }; later();
  api.cracks({ strength: 1, seed: "cutlive", corner: 2 });
  let crWorst = 0, crMost = 0;
  for (let i = 0; i < 80; i++) { advance(100); crMost = Math.max(crMost, shown("ipu-gore-cracks")); crWorst = Math.max(crWorst, on("ipu-gore-cracks", T9) + on("ipu-gore-cracks", Z1)); }
  ck(`cracks in a corner with a token and a zone badge: before ${wasCr} px of crack on them, after none through the web's whole life (${crWorst}), the web still drawn (${crMost} px), the log tells what was left out`, wasCr > 20 && crWorst === 0 && crMost > 300 && api.log().find((q) => q.kind === "cracks").masked > 0);
  toks.pop();
  void qx; void qy;
}

/* ---------------- source pins ---------------- */
{
  const src = readFileSync(join(root, "gore", "main.mjs"), "utf8");
  ck("the cracks' pane has no stacking place of its own over the interface (no CRACK_Z, nothing appended to the body)", !/CRACK_Z\s*=/.test(src) && !/document\.body[^\n]*appendChild/.test(src));
  ck("the glass is drawn again in the camera's own step for cracks too (canvasPan)", /canvasPan[\s\S]{0,400}it\.kind !== "blood"/.test(src));
}

console.log(`sweep goreui: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
