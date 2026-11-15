// node scripts/sweep-checks/gore.mjs  (GORE: blood and cracks on the screen, pixel art; the owner 2026-11-15: blood when a character is hurt,
// it must arrive "jak chlapanie", like a splash; a second effect, cracks).
// Pure part (scripts/gore/plan.mjs, raster.mjs): the change -> effect rule, the grid (whole device px per art px at every DPR), the splash
// arrives in one tick at full alpha (no fade-in) and moves smear -> squash -> settle, spatter lands by distance, drips run down, it dries,
// it dissolves to nothing; every pixel one palette colour (no gradient); the same seed draws the same picture; the photosensitive palette
// has no saturated red and its splash stays under the safe area; big arrivals keep <= 2 a second; the readable middle; reduced motion =
// stills; cracks race out, glint, retract to nothing; the cost of a frame.
// GORE3 (the owner on version 2: «Krew stopniowo przygasa a powinna płynnie. Jej osypanie brzydko się urywa na dole. Widać linie
// odcięcia animacji. Pęknięcia nie powinny być od impactów tylko np z rogów»): no step in the blood's dimming above what the eye can
// see, nothing of a splash ever touches the view's edge, its clearing never cuts a straight line, the cracks start at a corner; finding
// 5 of the blind review: blood beside the struck token, sized by it, none on a screen whose view does not hold it, no piling.
// Runtime on a fake Foundry (scripts/gore/main.mjs): a Health drop plays blood on the token reaction's blow (or after the wait when the
// reactions are off), Resolve plays cracks, a pushed roll's stress none, a hidden token nothing on a player's seat, "owners" only on
// the owner's seat, the table's 0 = none, a heal nothing; the settings are world and hidden from Foundry's list; the window has the tab.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const dir = dirname(fileURLToPath(import.meta.url)), root = join(dir, "..");
const P = await import("../gore/plan.mjs");
const R = await import("../gore/raster.mjs");

/* ---------------- the rule ---------------- */
{
  const e = (c) => P.effectOf({ max: 6, type: "character", ...c });
  ck("a Health drop = blood", e({ stat: "health", from: 5, to: 3 })?.kind === "blood");
  ck("a Resolve drop = cracks", e({ stat: "resolve", from: 5, to: 3 })?.kind === "cracks");
  ck("stress the character chose (a push) = nothing", e({ stat: "resolve", from: 5, to: 4, push: true }) === null);
  ck("a heal, no change = nothing", e({ stat: "health", from: 3, to: 5 }) === null && e({ stat: "health", from: 3, to: 3 }) === null);
  ck("a challenge (its Health is its Challenge Rating) never bleeds or cracks", P.effectOf({ stat: "health", from: 5, to: 2, max: 6, type: "challenge" }) === null);
  ck("a vehicle's Health drop = cracks, never blood", P.effectOf({ stat: "health", from: 5, to: 2, max: 6, type: "vehicle" })?.kind === "cracks");
  ck("a knock-down (0 Health) = the strongest blood", e({ stat: "health", from: 2, to: 0 }).strength === 1 && e({ stat: "health", from: 2, to: 0 }).down);
  let mono = true, prev = 0;
  for (let to = 5; to >= 1; to--) { const s = e({ stat: "health", from: 6, to }).strength; if (s < prev) mono = false; prev = s; }
  ck("a heavier blow is never a smaller splash", mono && e({ stat: "health", from: 6, to: 5 }).strength < e({ stat: "health", from: 6, to: 1 }).strength);
  ck("the table's 0 = none, 2 = as is, 3 = more", P.scaled(0.5, 0) === 0 && P.scaled(0.5, 2) === 0.5 && P.scaled(0.5, 3) > 0.5 && P.scaled(0.5, 1) < 0.5);
  ck("options are cleaned (defaults, range)", JSON.stringify(P.cleanOpts({})) === JSON.stringify({ blood: 2, cracks: 2, seats: "all", hold: 1 }) && P.cleanOpts({ goreBlood: 9, goreSeats: "x", goreHold: 7 }).blood === 3 && P.cleanOpts({ goreSeats: "x" }).seats === "all" && P.cleanOpts({ goreHold: 7 }).hold === 2);
}

/* ---------------- the grid: crisp at every DPR ---------------- */
{
  let ok = true;
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.625, 3]) for (const [vw, vh] of [[1920, 1080], [1366, 768], [1600, 900], [2560, 1440], [800, 600]]) {
    const g = P.grid(vw, vh, dpr);
    if (!Number.isInteger(g.px) || g.px < 1 || g.w * g.px < vw * dpr - 1e-6 || (g.w - 1) * g.px >= vw * dpr || g.h * g.px < vh * dpr - 1e-6 || Math.abs(g.px / dpr - P.ART_CSS) > 0.6) ok = false;
  }
  ck("every DPR and window: a whole number of device px per art px, about 3 CSS px, the grid covers the view by less than one art px", ok);
}

/* ---------------- helpers ---------------- */
const g = P.grid(1920, 1080, 1);
const sf = R.surface(g.w, g.h);
const shot = (items, ms) => { R.render(sf, items, ms); return sf.rgba.slice(); };
const count = (rgba, pred = () => true) => { let c = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] && pred(rgba, i)) c++; return c; };
const sha = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
/* cracks: every pixel one of the crack palette's colours at its alpha */
const crackCols = new Set(Object.values(R.CRACK).map((c) => c.join(",")));
const paletteOnly = (rgba) => { for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] && !crackCols.has(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]},${rgba[i + 3]}`)) return false; return true; };
/* blood (GORE3): its colours glide with its age, so pixel art is checked per drawing: one splash = a handful of flat colours and one
   alpha (no spatial gradient, no anti-aliasing) */
const flatInk = (rgba, maxCols = 16, maxAlphas = 1) => { const cs = new Set(), as = new Set(); for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) { cs.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`); as.add(rgba[i + 3]); } return cs.size <= maxCols && as.size <= maxAlphas; };
const T = P.TICK_MS;

/* ---------------- blood ---------------- */
{
  const mk = (o = {}) => ({ plan: P.bloodPlan(g, { strength: 0.8, seed: "chk", dir: 0.3, ...o }), t0: 0 });
  const it = mk();
  const f0 = shot([it], 0), f1 = shot([it], T), f2 = shot([it], 2 * T), f4 = shot([it], 4 * T), f8 = shot([it], 8 * T);
  ck("the splash ARRIVES on its first tick (drawn at once, at full alpha: no fade-in)", count(f0) > 200 && count(f0, (a, i) => a[i + 3] >= R.ALPHA[0] * P.CENTRE.alpha - 1) === count(f0));
  const fs = shot([it], R.SETTLE_AT + R.SETTLE + 50);
  ck("after the hit the blood lets the table read through it (settled alpha lower than the arrival's)", count(fs) > 0 && count(fs, (a, i) => a[i + 3] > Math.round(R.ALPHA[0] * R.SEE)) === 0);
  ck("burst -> squash -> settle: the first three ticks are three different drawings", sha(f0) !== sha(f1) && sha(f1) !== sha(f2));
  /* GORE2: tick 0 is a BURST shooting the way the blood flies (no glob in flight): its ink lies ahead of the hit along dir */
  const ahead = (rgba, p) => { let u = 0, c = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) { const q = i / 4, x = q % g.w + 0.5, y = ((q / g.w) | 0) + 0.5; u += (x - p.cx) * p.dx + (y - p.cy) * p.dy; c++; } return u / Math.max(1, c) / p.R; };
  ck(`the first tick is a burst shooting the way it flies (ink ${ahead(f0, it.plan).toFixed(2)} R ahead of the hit)`, ahead(f0, it.plan) > 0.35);
  const frames = [1, 2, 3, 4, 5].map((k) => sha(shot([it], k * T)));
  ck("the spatter keeps landing after the hit (ticks 1..5 all differ: drops fly in and land by distance)", new Set(frames).size === frames.length && count(f8) > count(f1));
  /* GORE2 (the owner: «potrzebuję też kropel bo na razie to jest bardziej jakby ktoś napluł»): DROPS, not one glob */
  const parts = (rgba) => { const seen = new Uint8Array(g.w * g.h); let n = 0; const st = []; for (let i = 0; i < g.w * g.h; i++) { if (seen[i] || !rgba[i * 4 + 3]) continue; n++; st.push(i); seen[i] = 1; while (st.length) { const q = st.pop(), x = q % g.w, y = (q / g.w) | 0; for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + ox, Y = y + oy; if (X < 0 || Y < 0 || X >= g.w || Y >= g.h) continue; const k = Y * g.w + X; if (!seen[k] && rgba[k * 4 + 3]) { seen[k] = 1; st.push(k); } } } } return n; };
  const outside = (rgba, p, k) => count(rgba, (a, i) => { const q = i / 4; return Math.hypot(q % g.w + 0.5 - p.cx, ((q / g.w) | 0) + 0.5 - p.cy) > k * p.R; });
  for (const sv of [0.35, 0.65, 1]) {
    const q = { plan: P.bloodPlan(g, { strength: sv, seed: `drops${sv}`, dir: 2 }), t0: 0 };
    const fq = shot([q], 600), np = parts(fq), share = outside(fq, q.plan, 1.25) / count(fq);
    ck(`strength ${sv}: blood splashed in drops (${np} separate drops/spots, ${(share * 100).toFixed(0)} % of the ink outside the body)`, np >= (sv < 0.5 ? 18 : 30) && share >= 0.3);
  }
  const low = (rgba) => { let m = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) m = Math.max(m, (i / 4 / g.w) | 0); return m; };
  const it2 = mk({ seed: "drip", dir: Math.PI * 1.5, at: { fx: 0.2, fy: 0.25 } });
  ck("drips run DOWN the glass (the lowest blood moves down between 0.4 s and 3 s)", low(shot([it2], 3000)) > low(shot([it2], 400)) + 4);
  ck("every drawing of a splash is a handful of flat colours at one alpha (pixel art: no gradient, no anti-aliasing)", [f0, f1, f4, shot([it], 1000), shot([it], 3000), shot([it], 7000)].every((fr) => flatInk(fr)));
  const dried = shot([it], it.plan.life.dry + 300);
  const driedSet = new Set(Object.values(R.PAL.dried).map((c) => c.join(",")));
  ck("it dries: after its drying time every blood pixel has the dried colours", count(dried) > 0 && count(dried, (a, i) => !driedSet.has(`${a[i]},${a[i + 1]},${a[i + 2]}`)) === 0);
  const g0 = it.plan.life.gone, d0 = it.plan.life.dissolve;
  const c1 = count(shot([it], g0 + d0 * 0.2)), c2 = count(shot([it], g0 + d0 * 0.6)), c3 = count(shot([it], g0 + d0 + 50));
  ck(`it clears to nothing, never a fade (${c1} -> ${c2} -> ${c3} px, flat colours)`, c1 > c2 && c2 > 0 && c3 === 0 && flatInk(shot([it], g0 + d0 * 0.5), 40));
  /* GORE2 (the owner: «Krew bardzo słabo znika»): it CRUMBLES from the thin parts in: the drops go first, the body's heart last, no
     screen-door holes inside what is left, a pale crumbling front, flakes falling */
  const rest = shot([it], g0 - 50), early = shot([it], g0 + d0 * 0.3);
  const heart = (rgba) => { const p = it.plan, i = ((p.cy | 0) * g.w + (p.cx | 0)) * 4; return rgba[i + 3] > 0; };
  ck(`it crumbles from the thin parts in: drops first (${parts(rest)} -> ${parts(early)} spots), the body's heart still there`, parts(early) < parts(rest) * 0.6 && heart(early));
  let ok = true, holes = 0, filled = 0, crumbs = 0, flakesLow = 0;
  for (let k = 0; k <= 12; k++) {
    const fr = shot([it], g0 + 1 + k * (d0 / 12));
    for (let y = 1; y < g.h - 1; y++) for (let x = 1; x < g.w - 1; x++) {
      const i = (y * g.w + x) * 4;
      if (fr[i + 3]) { filled++; if (fr[i] > R.PAL.dried.lit[0] + 20) crumbs++; continue; }      // paler than any dried crust: the front
      if (fr[i + 3 - 4] && fr[i + 3 + 4] && fr[i + 3 - g.w * 4] && fr[i + 3 + g.w * 4]) holes++;
    }
    if (!flatInk(fr, 40)) ok = false;
  }
  ck(`no screen-door: pinholes inside the crumbling blood ${(holes / Math.max(1, filled) * 100).toFixed(2)} % (<= 1 %)`, holes / Math.max(1, filled) <= 0.01 && ok);
  ck(`a pale crumbling front walks in (${crumbs} crust px over the clearing)`, crumbs > 200);
  { const q = { plan: P.bloodPlan(g, { strength: 0.8, seed: "flake", dir: 0.3, at: { fx: 0.2, fy: 0.3 } }), t0: 0 }; const gq = q.plan.life.gone; let lowest = 0, base = 0; const fr = shot([q], gq - 50); for (let i = 0; i < fr.length; i += 4) if (fr[i + 3]) base = Math.max(base, (i / 4 / g.w) | 0); for (let t = gq; t < gq + q.plan.life.dissolve; t += T) { const fz = shot([q], t); for (let i = 0; i < fz.length; i += 4) if (fz[i + 3]) lowest = Math.max(lowest, (i / 4 / g.w) | 0); } flakesLow = lowest - base; }
  ck(`flakes of crust fall off (they reach ${flakesLow} art px below the dried blood)`, flakesLow >= 3);
  ck("the same seed draws the same picture; another seed another one", sha(shot([mk()], 600)) === sha(shot([it], 600)) && sha(shot([mk({ seed: "other" })], 600)) !== sha(shot([it], 600)));
  /* the readable middle: a splash laid out by its way never lands in the middle; a splash put there is see-through */
  let mid = 0;
  for (let i = 0; i < 200; i++) { const p = P.bloodPlan(g, { strength: Math.random(), seed: `m${i}`, dir: Math.random() * 7 }); if (((p.cx / g.w - 0.5) / P.CENTRE.rx) ** 2 + ((p.cy / g.h - 0.5) / P.CENTRE.ry) ** 2 < 1) mid++; }
  ck(`a splash laid out by its way never lands in the readable middle (${mid} of 200)`, mid === 0);
  const cen = shot([mk({ at: { fx: 0.5, fy: 0.5 } })], 600);
  ck("a splash put in the middle is see-through there", count(cen) > 0 && count(cen, (a, i) => a[i + 3] > Math.round(R.ALPHA[0] * P.CENTRE.alpha)) === 0);
  /* coverage: the biggest splash covers a bounded share of the view */
  const big = shot([{ plan: P.bloodPlan(g, { strength: 1, seed: "big", dir: 0 }), t0: 0 }], 1500);
  ck(`a knock-down splash (with its second blow) covers ${(count(big) / (g.w * g.h) * 100).toFixed(1)} % of the view (<= 14 %)`, count(big) / (g.w * g.h) <= 0.14);
  /* reduced motion: stills */
  const st = { plan: P.bloodPlan(g, { strength: 0.8, seed: "chk", dir: 0.3, still: true }), t0: 0 };
  const mask = (fr) => { const m = new Uint8Array(fr.length / 4); for (let i = 0; i < m.length; i++) m[i] = fr[i * 4 + 3] ? 1 : 0; return sha(m); };
  ck("reduced motion: the first tick is already the settled splash with its drips (no smear, no running; only its colours age)", mask(shot([st], 0)) === mask(shot([st], 2000)) && mask(shot([st], 0)) === mask(shot([st], 5000)));
  /* photosensitive seat */
  let red = true;
  for (const stg of Object.values(R.PAL_SAFE)) for (const c of Object.values(stg)) if (c[0] / (c[0] + c[1] + c[2]) >= 0.7) red = false;
  ck("photosensitive palette: no saturated red (R share < 0.7 in every colour)", red);
  const sp = P.bloodPlan(g, { strength: 1.25, seed: "safe", dir: 1, safe: true });
  const safeArea = count(shot([{ plan: sp, t0: 0 }], 1500)) / (g.w * g.h);
  ck(`photosensitive seat: the strongest splash covers ${(safeArea * 100).toFixed(2)} % <= ${P.SAFE_AREA * 100} % of the view, one blow only`, safeArea <= P.SAFE_AREA && !sp.second);
  ck("normal palette: blood is red (it reads as blood)", R.PAL.wet.b[0] / R.PAL.wet.b.reduce((a, b) => a + b) > 0.7);
}

/* ---------------- GORE3: smooth dimming, clean clearing, nothing at the edge, beside the struck token ---------------- */
{
  /* the eye: a flat patch that changes by more than ~1.5 % of the screen's range from one 24 Hz tick to the next reads as a step. Each
     pixel is composited over a dark and a light map; between two ticks no pixel of a living splash may change by more than DIM_STEP
     levels (the drips held still, so only the ageing is measured). Version 2 changed by up to 130 levels in one tick (its stages). */
  const DIM_STEP = 4;
  const BGS = [[32, 32, 32], [200, 200, 200]];
  const shown = (a, i, bg, c) => (a[i + c] * a[i + 3] + bg[c] * (255 - a[i + 3])) / 255;
  for (const [sv, seed] of [[0.3, "dimA"], [0.65, "dimB"], [1, "dimC"]]) {
    const p = P.bloodPlan(g, { strength: sv, seed, dir: 1.2, at: { fx: 0.25, fy: 0.3 } });
    p.drips = []; if (p.second) p.second.plan.drips = [];
    const it = { plan: p, t0: 0 }, end = Math.min(p.life.gone, p.second ? p.second.plan.life.gone : Infinity);
    let prev = null, worst = 0, meanPrev = null, meanWorst = 0;
    for (let k = 10; k * T < end; k++) {
      const fr = shot([it], k * T + 1);
      let sum = 0, n2 = 0;
      for (let i = 0; i < fr.length; i += 4) if (fr[i + 3]) {
        sum += shown(fr, i, BGS[0], 0); n2++;
        if (prev && prev[i + 3]) for (const bg of BGS) for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(shown(fr, i, bg, c) - shown(prev, i, bg, c)));
      }
      const mean = sum / Math.max(1, n2);
      if (meanPrev != null) meanWorst = Math.max(meanWorst, Math.abs(mean - meanPrev));
      prev = fr; meanPrev = mean;
    }
    ck(`strength ${sv}: the blood dims smoothly over its whole life (worst pixel ${worst.toFixed(1)} levels a tick <= ${DIM_STEP}, the splash's mean ${meanWorst.toFixed(2)} <= ${DIM_STEP / 2})`, worst <= DIM_STEP && meanWorst <= DIM_STEP / 2);
  }
  const it3 = { plan: P.bloodPlan(g, { strength: 0.6, seed: "dimD", dir: 1, at: { fx: 0.3, fy: 0.3 } }), t0: 0 };
  const a1 = R.bloodAge(it3.plan.life, 600), a2 = R.bloodAge(it3.plan.life, 3000), a3 = R.bloodAge(it3.plan.life, it3.plan.life.gone - 10);
  ck("it ages one way: wetter -> drier, glossier -> matt, more -> less opaque", a1.dry < a2.dry && a2.dry < a3.dry && a1.gloss > a2.gloss && a1.k > a2.k && a2.k > a3.k && a3.dry > 0.99 && a3.gloss < 0.01);

  /* the clearing: no straight cut (the old one dropped every drip in one tick: a line along the splash's bottom), no mass vanishing */
  const clearing = (p) => {
    const it = { plan: p, t0: 0 };
    let prev = shot([it], p.life.gone - 1), n0 = 0;
    for (let i = 3; i < prev.length; i += 4) if (prev[i]) n0++;
    let run = 0, share = 0, ticks = 0;
    for (let k = Math.ceil(p.life.gone / T); k * T <= p.life.gone + p.life.dissolve + T; k++) {
      const fr = shot([it], k * T + 1), gone = new Uint8Array(g.w * g.h);
      let rem = 0;
      for (let q = 0; q < g.w * g.h; q++) if (prev[q * 4 + 3] && !fr[q * 4 + 3]) { gone[q] = 1; rem++; }
      if (rem) ticks++;
      share = Math.max(share, rem / Math.max(1, n0));
      for (let x = 0; x < g.w; x++) { let r2 = 0; for (let y = 0; y < g.h; y++) { r2 = gone[y * g.w + x] ? r2 + 1 : 0; run = Math.max(run, r2); } }
      for (let y = 0; y < g.h; y++) { let r2 = 0; for (let x = 0; x < g.w; x++) { r2 = gone[y * g.w + x] ? r2 + 1 : 0; run = Math.max(run, r2); } }
      prev = fr;
    }
    return { run, share, ticks };
  };
  let worstRun = 0, worstShare = 0, fewest = 99;
  for (const [fx, fy, d, sv] of [[0.25, 0.3, 1.2, 0.9], [0.5, 0.93, 1.57, 0.9], [0.95, 0.5, 0, 0.6], [0.5, 0.05, -1.57, 1], [0.96, 0.95, 0.8, 0.4]]) {
    const c = clearing(P.bloodPlan(g, { strength: sv, seed: `cut${fx}${fy}`, dir: d, at: { fx, fy } }));
    worstRun = Math.max(worstRun, c.run); worstShare = Math.max(worstShare, c.share); fewest = Math.min(fewest, c.ticks);
  }
  ck(`the clearing never cuts a straight line (longest run gone in one tick ${worstRun} art px <= 10; version 2: 27)`, worstRun <= 10);
  ck(`... nothing vanishes in a block (at most ${(worstShare * 100).toFixed(1)} % of the splash in one tick <= 18; version 2: 29), it crumbles over >= ${fewest} ticks`, worstShare <= 0.18 && fewest >= 18);
  {
    /* a splash with long drips: they are part of the clearing (version 2: they lay outside its depth map and all went in one tick) */
    const p = P.bloodPlan(g, { strength: 1, seed: "drips", dir: -1.57, at: { fx: 0.4, fy: 0.25 } });
    const it = { plan: p, t0: 0 }, before = shot([it], p.life.gone - 1), after = shot([it], Math.ceil(p.life.gone / T) * T + 1);
    let n2 = 0, kept = 0;
    for (const d of p.drips) for (let y = Math.ceil(d.y + 2); y < d.y + d.len - 1; y++) { const i = (y * g.w + Math.round(d.x)) * 4; if (before[i + 3]) { n2++; if (after[i + 3]) kept++; } }
    ck(`the drips crumble with the rest (${kept} of ${n2} drip pixels still there on the first tick of the clearing)`, n2 > 20 && kept / n2 >= 0.8);
  }

  /* nothing at the edge: a splash placed against any edge or corner, at any strength, on several windows and DPRs, never draws within
     EDGE art px of the view's edge, over its whole life (arrival, drops, drips, flakes, clearing) */
  let edgeHits = 0, cases = 0;
  for (const [vw, vh, dpr] of [[1366, 768, 1], [1920, 1080, 1.25], [1000, 620, 2]]) {
    const ge = P.grid(vw, vh, dpr), se = R.surface(ge.w, ge.h);
    for (const [fx, fy, d] of [[0.02, 0.5, Math.PI], [0.98, 0.5, 0], [0.5, 0.02, -Math.PI / 2], [0.5, 0.98, Math.PI / 2], [0.02, 0.02, -2.4], [0.98, 0.98, 0.8], [0.02, 0.98, 2.3], [0.98, 0.02, -0.8]]) for (const sv of [0.3, 1]) {
      const p = P.bloodPlan(ge, { strength: sv, seed: `edge${fx}${fy}${sv}`, dir: d, near: { fx, fy, fr: 0.04 } });
      const it = { plan: p, t0: 0 }, end = P.endOf(p);
      cases++;
      for (let k = 0; k * T <= end; k += k < 12 ? 1 : k * T > p.life.gone - 100 ? 1 : 6) {
        R.render(se, [it], k * T + 1);
        const a = se.rgba;
        for (let y = 0; y < ge.h; y++) for (let x = 0; x < ge.w; x++) if ((x < P.EDGE || y < P.EDGE || x >= ge.w - P.EDGE || y >= ge.h - P.EDGE) && a[(y * ge.w + x) * 4 + 3]) edgeHits++;
      }
    }
  }
  ck(`nothing of the blood is ever cut by the view's edge (${cases} splashes against every edge and corner, 3 windows: ${edgeHits} px within ${P.EDGE} art px of it)`, edgeHits === 0);

  /* beside the struck token (finding 5) */
  const tok = { fx: 0.4, fy: 0.45, fr: 0.04 };
  let side = true, onTok = 0, smallFar = 0;
  for (let i = 0; i < 40; i++) {
    const d = (i / 40) * Math.PI * 2, p = P.bloodPlan(g, { strength: 0.3 + (i % 4) * 0.2, seed: `near${i}`, dir: d, near: tok });
    const tx = tok.fx * g.w, ty = tok.fy * g.h, tr = tok.fr * Math.min(g.w, g.h);
    if ((p.cx - tx) * Math.cos(d) + (p.cy - ty) * Math.sin(d) < tr) side = false;
    for (const s2 of p.sats) if (Math.hypot(s2.x - tx, s2.y - ty) < tr * 0.9) onTok++;
  }
  ck("the splash lands just past the struck token, on its side away from the attacker, no drop on the token", side && onTok === 0);
  const cover = (fr) => { const p = P.bloodPlan(g, { strength: 1, seed: "far", dir: 0.5, near: { fx: 0.3, fy: 0.4, fr } }); return count(shot([{ plan: p, t0: 0 }], 1500)) / (g.w * g.h); };
  const far = cover(0.008), close = cover(0.06);
  smallFar = far;
  ck(`sized by the token on this screen: a knock-down beside a far-zoom token covers ${(smallFar * 100).toFixed(2)} % of the view (<= 1.5 %), beside a close one ${(close * 100).toFixed(1)} %`, smallFar <= 0.015 && close > far * 3);
  ck("every seat draws the same splash (one seed, its own view): the same drops in the same order", (() => { const a = P.bloodPlan(P.grid(1600, 900, 1), { strength: 0.7, seed: "seat", dir: 1, near: { fx: 0.3, fy: 0.4, fr: 0.03 } }), b = P.bloodPlan(P.grid(1366, 768, 2), { strength: 0.7, seed: "seat", dir: 1, near: { fx: 0.6, fy: 0.5, fr: 0.05 } }); return a.tendrils.length === b.tendrils.length && Math.abs(a.tendrils[0].a - b.tendrils[0].a) < 1e-9 && a.blobs[0].lob.join() === b.blobs[0].lob.join(); })());
}

/* ---------------- GORE3: the cracks come from the screen's corner ---------------- */
{
  let fromCorner = true, inward = true, early = true, hub = true, n3 = 0;
  for (let i = 0; i < 24; i++) {
    const p = P.crackPlan(g, { strength: (i % 6) / 5 + 0.05, seed: `fc${i}` });
    const [kx, ky] = P.CORNERS[p.corner], ox = kx * g.w, oy = ky * g.h, m = Math.min(g.w, g.h);
    const sx = kx ? -1 : 1, sy = ky ? -1 : 1;
    if (p.craters.some((c) => Math.hypot(c.x - ox, c.y - oy) > 0.5)) hub = false;      // no strike point inside the view
    for (const l of p.lines.filter((q) => q.lvl === 0)) {
      n3++;
      const [x0, y0] = l.pts[0], [x1, y1] = l.pts[l.pts.length - 1];
      const onEdge = (Math.abs(y0 - oy) < 1.5 && Math.abs(x0 - ox) < 0.25 * m) || (Math.abs(x0 - ox) < 1.5 && Math.abs(y0 - oy) < 0.25 * m);
      if (!onEdge && Math.hypot(x0 - ox, y0 - oy) > p.strikes[0].rc + 1.5) fromCorner = false;
      if (!(Math.hypot(x1 - ox, y1 - oy) > Math.hypot(x0 - ox, y0 - oy) + 4) || (x1 - x0) * sx < -2 || (y1 - y0) * sy < -2) inward = false;
    }
    const far = [];
    for (let k = 0; k <= 8; k++) { const fr = shot([{ plan: p, t0: 0 }], k * T + 1); let mx = 0; for (let j = 0; j < fr.length; j += 4) if (fr[j + 3]) { const q = j / 4; mx = Math.max(mx, Math.hypot(q % g.w + 0.5 - ox, ((q / g.w) | 0) + 0.5 - oy)); } far.push(mx); }
    if (far[0] > p.strikes[0].rc * 4 + 2 || far.some((v, k) => k && v < far[k - 1]) || far[1] > 0.11 * m || far[8] < far[1] * 2) early = false;
  }
  ck(`every main crack starts IN the corner or ON one of its two edges (${n3} cracks), never at a point inside the view`, fromCorner && hub);
  ck("... and runs inward, away from the corner (a quarter web round the corner, no star round a strike)", inward);
  ck("they break out of the corner: on the first tick only the crushed corner and its crumbs, then the cracks reach farther from it every tick", early);
}

/* ---------------- arrivals ---------------- */
{
  let past = [], ok = true;
  for (let i = 0; i < 10; i++) { const t = P.arrivalAt(1000 + i * 30, 0.9, past); past.push(t); }
  past.sort((a, b) => a - b);
  for (let i = 0; i < past.length; i++) if (past.filter((t) => t >= past[i] && t < past[i] + 1000).length > 2) ok = false;
  ck("ten big blows at once: at most two arrivals in any second", ok);
  ck("a small splash is never held back", P.arrivalAt(1000, 0.2, [990]) === 1000);
  ck("photosensitive seat: one arrival a second, also small ones", P.arrivalAt(1000, 0.2, [900], true) >= 1900);
}

/* ---------------- cracks ---------------- */
{
  const it = { plan: P.crackPlan(g, { strength: 0.9, seed: "cr" }), t0: 0 };
  const c0 = count(shot([it], 0)), c3 = count(shot([it], 3 * T)), c6 = count(shot([it], 8 * T));
  ck(`cracks strike at once and race out (${c0} -> ${c3} -> ${c6} px)`, c0 > 0 && c3 > c0 && c6 > c3);
  const glint = (rgba) => count(rgba, (a, i) => a[i] === 255 && a[i + 1] === 255 && a[i + 2] === 255);
  ck("a glint runs along the fresh cracks, then it is gone", glint(shot([it], 300)) > 0 && glint(shot([it], 2000)) === 0);
  ck("every crack pixel is one palette colour", [0, 3 * T, 300, 2000].every((ms) => paletteOnly(shot([it], ms))));
  const gone = it.plan.life.gone;
  ck("they are gone at the end", count(shot([it], gone + 1)) === 0);
  /* GORE2 (the owner: «Nich pęknięcia będą dużo subtelniejsze, gdzieś w rogach np.»): a small web in a corner, see-through */
  let inCorner = true, maxCover = 0, maxAlpha = 0;
  const corners = new Set();
  for (let i = 0; i < 40; i++) {
    const p = P.crackPlan(g, { strength: (i % 5) / 4 + 0.05, seed: `corner${i}` });
    corners.add(p.corner);
    const [kx, ky] = P.CORNERS[p.corner], cx = kx * g.w, cy = ky * g.h, m = Math.min(g.w, g.h);
    const fr = shot([{ plan: p, t0: 0 }], 1500);
    let n2 = 0, sa = 0;
    for (let j = 0; j < fr.length; j += 4) if (fr[j + 3] > 40) { n2++; sa += fr[j + 3]; const q = j / 4, x = q % g.w, y = (q / g.w) | 0; if (Math.abs(x - cx) > 0.45 * m || Math.abs(y - cy) > 0.45 * m) inCorner = false; }
    maxCover = Math.max(maxCover, n2 / (g.w * g.h)); maxAlpha = Math.max(maxAlpha, sa / Math.max(1, n2));
  }
  ck(`cracks stay in a corner (all four used: ${corners.size}), within 0.45 of the short side from it`, inCorner && corners.size === 4);
  ck(`cracks are subtle: their lines cover at most ${(maxCover * 100).toFixed(2)} % of the view (<= 1.5 %), mean alpha ${maxAlpha.toFixed(0)} (<= 175; the first version drew 215-232)`, maxCover <= 0.015 && maxAlpha <= 175);
  /* GORE2 (the owner on the old retraction: «Tak samo pęknięcia» [słabo znikają]): the glass FALLS OUT, shard by shard, crater first */
  const top = { plan: P.crackPlan(g, { strength: 0.8, seed: "fall", corner: 0 }), t0: 0 };
  const b0 = P.breakAt(top.plan);
  const lowest = (fr) => { let m = -1; for (let j = 0; j < fr.length; j += 4) if (fr[j + 3]) m = Math.max(m, (j / 4 / g.w) | 0); return m; };
  const restLow = lowest(shot([top], b0 - T));
  let fell = 0;
  for (let t = b0; t < top.plan.life.gone; t += T) fell = Math.max(fell, lowest(shot([top], t)) - restLow);
  const sh = R.shardsOf(top.plan, g.w, g.h);
  ck(`the cracked glass falls out: ${sh.length} shards, the crushed crater first, one after another (they fall ${fell} art px below the web)`, sh.length >= 6 && sh[0].band === 0 && sh.every((x, k) => !k || x.at >= sh[k - 1].at) && fell >= 10);
  const counts = []; for (let t = b0; t <= top.plan.life.gone; t += 2 * T) counts.push(count(shot([top], t)));
  ck("... it thins out to nothing over the fall", count(shot([top], top.plan.life.gone)) === 0 && counts[Math.floor(counts.length / 2)] < counts[0]);
  const stl = { plan: P.crackPlan(g, { strength: 0.8, seed: "fall", corner: 0, still: true }), t0: 0 };
  const restSet = new Set(); { const fr = shot([stl], b0 - T); for (let j = 0; j < fr.length; j += 4) if (fr[j + 3]) restSet.add(j); }
  let still = true; for (let t = b0; t < stl.plan.life.gone; t += T) { const fr = shot([stl], t); for (let j = 0; j < fr.length; j += 4) if (fr[j + 3] && !restSet.has(j)) still = false; }
  ck("reduced motion: the shards just go, nothing moves", still);
  const st = { plan: P.crackPlan(g, { strength: 0.9, seed: "cr", still: true }), t0: 0 };
  ck("reduced motion: the whole crack at once, no chips, no glint", sha(shot([st], 0)) === sha(shot([st], 1500)) && st.plan.chips.length === 0);
  /* GORE3: «Pęknięcia nie powinny być od impactów tylko np z rogów» (was: a broken Resolve = two strike points in a corner) */
  ck("a broken Resolve (strength 1) breaks twice, both bursts from the same corner", (() => { const p = P.crackPlan(g, { strength: 1, seed: "x" }); const w2 = p.lines.filter((l) => l.lvl === 0 && l.wave === 1); return p.waves === 2 && w2.length >= 2 && w2.every((l) => l.t0 >= 3 * T); })());
  ck("the corner comes from the seed: every seat the same", P.crackPlan(g, { seed: "same" }).corner === P.crackPlan(P.grid(1366, 768, 2), { seed: "same" }).corner);
}

/* ---------------- cost ---------------- */
{
  const items = [];
  for (let i = 0; i < 6; i++) items.push({ plan: P.bloodPlan(g, { strength: 1, seed: `c${i}`, dir: i }), t0: i * 200 });
  items.push({ plan: P.crackPlan(g, { strength: 1, seed: "cc" }), t0: 0 });
  const run = () => { const ms = []; for (let t = 0; t < 4000; t += T) { const a = performance.now(); R.render(sf, items, t); ms.push(performance.now() - a); } ms.sort((a, b) => a - b); return [ms[ms.length >> 1], ms[Math.floor(ms.length * 0.95)]]; };
  const [c50, c95] = run();      // cold: every tick recorded on first draw
  for (const it of items) { it.plan._ticks = null; R.warm(it.plan); }
  const [p50, p95] = run();      // warmed ahead, as main.mjs does before the contact
  console.log(`  cost of a 24 Hz frame, 1920 x 1080 glass, six knock-down splashes + a shatter: warmed median ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (cold ${c50.toFixed(2)} / ${c95.toFixed(2)})`);
  ck(`a crowded frame, warmed ahead, costs little (median ${p50.toFixed(2)} ms <= 3, p95 ${p95.toFixed(2)} <= 5)`, p50 <= 3 && p95 <= 5);
}

/* ---------------- runtime on a fake Foundry ---------------- */
{
  const hooks = {};
  const values = {};
  const settings = new Map();
  let clock = 1000;
  globalThis.performance = { now: () => clock };
  const timers = [];
  globalThis.setTimeout = (fn, ms) => { const t = { fn, at: clock + (ms ?? 0), id: timers.length + 1 }; timers.push(t); return t.id; };
  globalThis.clearTimeout = (id) => { const t = timers.find((x) => x.id === id); if (t) t.fn = null; };
  const advance = (ms) => { const end = clock + ms; for (;;) { const t = timers.filter((x) => x.fn && x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!t) break; clock = Math.max(clock, t.at); const fn = t.fn; t.fn = null; fn(); } clock = end; };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, after() {}, isConnected: true, getContext: () => ({ putImageData() {}, clearRect() {} }) });
  const made = [];
  const body = { ...el(), appendChild: (c) => made.push(["body", c]) };
  const board = { ...el(), after: (c) => made.push(["board", c]) };
  globalThis.document = { getElementById: (id) => (id === "board" ? board : null), createElement: () => el(), body };
  globalThis.getComputedStyle = () => ({ zIndex: "0" });
  globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
  const user = { isGM: false, id: "P1" };
  globalThis.game = { user, settings: { settings, register: (m, k, o) => { settings.set(`${m}.${k}`, o); if (!(`${m}.${k}` in values)) values[`${m}.${k}`] = o.default; }, get: (m, k) => { if (!settings.has(`${m}.${k}`)) throw new Error("not registered"); return values[`${m}.${k}`]; } },
    modules: new Map([["invincible-plus-ultra", {}]]), socket: { on() {}, emit() {} }, combats: new Map() };
  settings.set("invincible-plus-ultra.tokenReactEnabled", {}); values["invincible-plus-ultra.tokenReactEnabled"] = true;
  const scene = { id: "S" };
  const mkTok = (id, o = {}) => { const actor = { id: `A${id}`, type: o.type ?? "character", system: { derived: { health: { value: 6, max: 6 }, resolve: { value: 6, max: 6 } } }, testUserPermission: () => !!o.owner, getActiveTokens: () => [tok] }; const tok = { id, actor, scene, visible: true, isVisible: true, document: { hidden: !!o.hidden }, center: { x: 800, y: 450 }, w: 100, h: 100 }; return tok; };
  const toks = [mkTok("T1", { owner: true }), mkTok("T2"), mkTok("T3", { hidden: true }), mkTok("T4", { type: "vehicle" })];
  /* the seat's view: 1600 x 900, the canvas drawn 1:1 (a token at x 800 is in the middle of the screen) */
  globalThis.canvas = { ready: true, scene, stage: { scale: { x: 1 } }, clientCoordinatesFromCanvas: (c) => ({ x: c.x, y: c.y }), tokens: { get: (id) => toks.find((t) => t.id === id), get placeables() { return toks; } } };
  const impact = { busy: false };
  globalThis.MoinenLetters = { engine: () => ({ impact }) };
  const M = await import("../gore/main.mjs");
  M.start({ init: true, ready: true });
  await new Promise((r) => r());      // the engine promise
  const api = game.modules.get("invincible-plus-ultra").api?.gore;
  ck("the api is on the module and on globalThis", !!api && globalThis.PlusUltraGore === api && typeof api.blood === "function" && typeof api.net?.blood === "function");
  const reg = (k) => settings.get(`invincible-plus-ultra.${k}`);
  ck("the table's options: world, not in Foundry's list (the Comic effects window shows them)", ["goreBlood", "goreCracks", "goreSeats", "goreHold"].every((k) => reg(k)?.scope === "world" && reg(k)?.config === false));
  const hurt = (tok, stat, to, opt = {}) => { tok.actor.system.derived[stat].value = to; for (const fn of hooks.updateActor ?? []) fn(tok.actor, { system: { derived: { [stat]: { value: to } } } }, { modifiedTime: 12345, ...opt }); };
  const live = () => api.state().live;
  const reset = () => { api.clear({ quick: true }); for (const t of toks) { t.actor.system.derived.health.value = 6; t.actor.system.derived.resolve.value = 6; } for (const fn of hooks.canvasReady ?? []) fn(); };
  reset();
  hurt(toks[0], "health", 3);
  advance(M.QUIET + 10);
  ck("a Health drop waits for its token reaction's blow", live() === 0);
  Hooks.callAll("invincible-plus-ultra.tokenReact", { phase: "hit", at: clock + 100, ids: ["T1"] });
  advance(1);
  ck("... and plays blood on it (its start = the blow's instant)", live() === 1 && api.state().pending === 0);
  reset();
  hurt(toks[0], "health", 3);
  advance(M.QUIET + 10);
  impact.busy = true;
  Hooks.callAll("invincible-plus-ultra.tokenReact", { phase: "hit", at: clock + 100, ids: ["T1"] });
  advance(400);
  const during = live();
  impact.busy = false;
  advance(60);
  ck("an impact frame plays over the blow: the blood lands when it is over (seen hitting the glass)", during === 0 && live() === 1);
  reset();
  hurt(toks[0], "health", 3);
  advance(M.QUIET + M.HIT_WAIT + 20);
  ck("no blow came: it plays after the wait all the same", live() === 1);
  reset();
  values["invincible-plus-ultra.tokenReactEnabled"] = false;
  hurt(toks[0], "health", 3);
  advance(M.QUIET + 10);
  ck("token reactions off: it plays after the short gathering wait", live() === 1);
  reset();
  hurt(toks[0], "resolve", 4);
  advance(M.QUIET + 10);
  ck("a Resolve drop: cracks", live() === 1);
  reset();
  for (const fn of hooks.createChatMessage ?? []) fn({ speakerActor: toks[0].actor, rolls: [{ pushCount: 1 }] });
  hurt(toks[0], "resolve", 4);
  advance(M.QUIET + 10);
  ck("stress chosen for a push: nothing", live() === 0);
  reset();
  hurt(toks[0], "health", 7 - 1); toks[0].actor.system.derived.health.value = 6;
  hurt(toks[0], "health", 6);
  advance(M.QUIET + 10);
  ck("no loss: nothing", live() === 0);
  reset();
  hurt(toks[2], "health", 2);
  advance(M.QUIET + 10);
  ck("a hidden token on a player's seat: nothing (it would tell him something he cannot see was hurt)", live() === 0);
  reset();
  user.isGM = true;
  hurt(toks[2], "health", 2);
  advance(M.QUIET + 10);
  ck("... the GM sees it", live() === 1);
  user.isGM = false;
  reset();
  toks[1].visible = toks[1].isVisible = false;
  hurt(toks[1], "health", 2);
  advance(M.QUIET + 10);
  ck("a token out of this seat's sight: nothing", live() === 0);
  toks[1].visible = toks[1].isVisible = true;
  reset();
  values["invincible-plus-ultra.goreSeats"] = "owners";
  hurt(toks[1], "health", 2);
  advance(M.QUIET + 10);
  const notOwner = live();
  reset();
  hurt(toks[0], "health", 2);
  advance(M.QUIET + 10);
  ck("'owners': only the character's owner (and the GM) sees it", notOwner === 0 && live() === 1);
  values["invincible-plus-ultra.goreSeats"] = "all";
  reset();
  values["invincible-plus-ultra.goreBlood"] = 0;
  hurt(toks[0], "health", 2);
  advance(M.QUIET + 10);
  ck("the table's blood 0: none", live() === 0);
  values["invincible-plus-ultra.goreBlood"] = 2;
  reset();
  hurt(toks[3], "health", 2);
  advance(M.QUIET + 10);
  ck("a vehicle: cracks (live)", live() === 1 && api.state().live === 1);
  reset();
  hurt(toks[1], "health", 2); hurt(toks[1], "resolve", 3);
  advance(M.QUIET + 10);
  ck("Health and Resolve together: blood AND cracks, one moment", live() === 2);
  reset();
  /* GORE3 (finding 5): a seat whose view does not hold the struck token saw no blow: nothing there */
  toks[1].center = { x: -300, y: 450 };
  hurt(toks[1], "health", 2);
  advance(M.QUIET + M.HIT_WAIT + 20);
  ck("a token outside this seat's view: no blood (that screen saw no blow)", live() === 0);
  toks[1].center = { x: 800, y: 450 };
  reset();
  ck("tokScreen: the token's middle and radius in this view's fractions", (() => { const v = M.tokScreen(toks[0]); return v && Math.abs(v.fx - 0.5) < 1e-9 && Math.abs(v.fy - 0.5) < 1e-9 && Math.abs(v.fr - 50 / 900) < 1e-9 && v.inView; })());
  /* GORE3: no piling: a new splash on the same token makes the older one crumble as it lands */
  const h1 = api.blood({ strength: 0.6, token: toks[0], seed: "pile1" });
  advance(500);
  const h2 = api.blood({ strength: 0.6, token: toks[0], seed: "pile2" });
  const h3 = api.blood({ strength: 0.6, token: toks[1], seed: "pile3" });
  ck("a new splash on the same token: its older one starts to clear as it lands (another token's stays)", !!h1 && !!h2 && !!h3 && api.state().cleared === 1);
  api.clear({ quick: true });
  const pane = (id) => made.find(([, c]) => c.id === id);
  ck("two panes (GORE2): blood right after #board (under the interface), cracks on the body over the bars (z over 30, under windows)",
    pane("ipu-gore")?.[0] === "board" && pane("ipu-gore-cracks")?.[0] === "body" && Number(pane("ipu-gore-cracks")[1].style.zIndex) > 31 && Number(pane("ipu-gore-cracks")[1].style.zIndex) < 100
    && [pane("ipu-gore"), pane("ipu-gore-cracks")].every((p) => p[1].style.pointerEvents === "none"));
  ck("a public call returns a handle with its strength, the table's level applied", api.blood({ strength: 0.5 })?.strength === 0.5 && api.cracks({ strength: 0.4 })?.kind === "cracks");
  api.clear({ quick: true });
  ck("clear empties the glass", live() === 0);
  ck("mayShow: another scene never", !M.mayShow({ gm: true, sameScene: false, visible: true }));
}

/* ---------------- wiring (source pins) ---------------- */
{
  const src = (p) => readFileSync(join(root, p), "utf8");
  ck("module.js starts the area by a guarded import", /import\("\.\/gore\/main\.mjs"\)\s*\.then\(\(gore\) => gore\.start/.test(src("module.js")));
  const D = await import("../table/defs.mjs");
  ck("the Comic effects window has the tab with the four options", JSON.stringify(D.TABS.find((t) => t.id === "gore")?.sections.flatMap((s) => s.rows.map((r) => r.key))) === JSON.stringify(["goreBlood", "goreCracks", "goreSeats", "goreHold"]));
  ck("the window's Preview plays it", /tab === "gore"\) \{ \(game\.modules\.get\(MOD\)\?\.api\?\.gore/.test(src("table/app.mjs")));
  ck("the glass lies over the map and under the interface, crisp (pixelated, right after #board)", /board\.after\(wrap\)/.test(src("gore/main.mjs")) && /imageRendering: "pixelated"/.test(src("gore/main.mjs")) && /pointerEvents: "none"/.test(src("gore/main.mjs")));
}

console.log(`sweep gore: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
