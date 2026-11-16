// node scripts/sweep-checks/capstar.mjs  -- CAPSTAR (2026-11-15): the roll splash's lettering composes with the impact's STAR.
// Engine 1.9.23 (IMPACT5) draws the star of the blow (the struck target, else the roller the blow comes from) enlarged at its own place for the
// whole impact (up to 0.34-0.44 of the view's short side). Live (CALLER5 sheets, a real fight critical): on the GM's seat the critical's captions
// ("6 SIXES", "THE ODDS ARE SHATTERED!", "1 IN 47K") lay across the starred target and the roller while on the player's seat they stood under
// the word. Now (letter-plan.mjs CUT / STAR_W / starBox, stage.mjs starOf): the star's cut-in reach is an obstacle of the table's block, of every
// seat's place and of the board block, from shared data only (the first unhidden target, else the roller; the table's strength).
// Checks, over seats (windows 1000..1920, zooms 0.25..0.8, panels, reduced motion) x outcomes x layers x boards, with an engine that has the cut-in:
//   C1 the mirrored constants equal the vendored engine's (plan.mjs LIMITS.figScale / cutMax / CU_TOP / STEP_AT; draw.mjs cutScale);
//   C2 starBox: grows with the strength, at least the token, never past cutMax of the short side, the token's own size when it is bigger;
//   C3 the star is the shared one: the first unhidden target, else the roller; none on a miss or without the engine's cut-in;
//   C4 no lettering on the star's cut-in on any seat where a clean place exists: the letters cover at most STAR_OK of the star box, and
//      over all cases the covered share drops against the same seats without the star (the CALLER5 picture: before vs after);
//   C5 the same picture: the splashsame rules S1 (relative sizes), S2 (arrangement), S4 (ranks), S7 (one instant) hold with the star on;
//   C6 a star obstacle is never a token's cover (coverMax ignores it);
//   C7 the live fight's geometry (no clean place on the GM's seat): even its least-covering block keeps off the star;
//   C8 the live fight's captured seatPlace inputs (GM seat, three runs) keep off the star;
//   C9 SAKUGATOKEN (engine 1.9.27: figures at their tokens' size, LIMITS.figScale): the star's box is the struck token's own, kept clear.
// C1-C8 run on the harness's 1.9.23-1.9.26 engine (cut: true, no figScale: that engine may still be the one running on a page).
// Fails on tactics-integrated-152 (C3, C4: no star); passes after.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { seatPlay, GS, BOARDS as BOARDS_X, SEATS as SEAT_X } from "./lib/splash-seat.mjs";
import * as LP from "../splash/letter-plan.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let n = 0, f = 0;
const fails = [];
const ok = (c, msg) => { n++; if (!c) { f++; fails.push(msg); } };
const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));

/* C1: the mirror of the engine's numbers */
{
  /* SAKUGATOKEN (engine 1.9.27): the engine no longer enlarges a figure (LIMITS.figScale = 1; draw.mjs cutScale returns it), so CUT_WANT and
     the least cut-in 1.3 left its source: CUT.want / CUT.min are now the frozen numbers of the 1.9.23-1.9.26 cut-in (for a page whose running
     engine is one of those) and the pins here are what the vendored engine still has: figScale, cutMax (the size a figure is counted at), CU_TOP */
  const draw = readFileSync(join(here, "../letters/impact/draw.mjs"), "utf8"), plan = readFileSync(join(here, "../letters/impact/plan.mjs"), "utf8");
  const max = Number(/cutMax: ([\d.]+)/.exec(plan)?.[1]), fig = Number(/figScale: ([\d.]+)/.exec(plan)?.[1]);
  const top = JSON.parse(/const CU_TOP = (\[[^\]]+\])/.exec(plan)?.[1] ?? "null");
  ok(fig === LP.CUT.fig && fig === 1, `C1 CUT.fig ${LP.CUT.fig} = engine LIMITS.figScale ${fig} = 1 (the token does not get bigger)`);
  ok(/export function cutScale\(e, g, f\) \{ return LIMITS\.figScale; \}/.test(draw), "C1 the engine draws every figure at LIMITS.figScale");
  ok(LP.CUT.want === 0.34 && LP.CUT.min === 1.3, "C1 the 1.9.23-1.9.26 cut-in's numbers stay for an older running engine");
  ok(max === LP.CUT.max, `C1 CUT.max ${LP.CUT.max} = engine LIMITS.cutMax ${max}`);
  ok(JSON.stringify(top) === JSON.stringify(LP.CUT.top), `C1 CUT.top ${LP.CUT.top} = engine CU_TOP ${top}`);
  ok(/const STEP_AT = \[0\.35, 0\.6, 0\.85, 1\.35, 1\.7\]/.test(plan), "C1 the harness's STEP_AT = the engine's");
}
/* C2: the box */
{
  const c = { x: 0, y: 0 }, u = 900;
  let prev = 0;
  for (let st = 0; st <= 5; st++) {
    const b = LP.starBox(c, 100, u, st), w = b.r - b.l;
    ok(w >= prev - 1e-9 && w >= 100 && w <= LP.CUT.max * u + 1e-6, `C2 step ${st}: ${w.toFixed(1)} px, grows, at least the token, at most cutMax`);
    prev = w;
  }
  ok(Math.abs((LP.starBox(c, 100, u, 5).r - LP.starBox(c, 100, u, 5).l) - Math.min(LP.CUT.max * u, LP.CUT.want * u * LP.CUT.reach)) < 1e-6, "C2 the full cut reaches CUT.want of the short side (and the pop's reach)");
  ok(LP.starBox(c, 500, u, 5).r === 250, "C2 a token bigger than the cap is not enlarged");
  ok(LP.starBox(c, 0, u, 5) === null && LP.starBox(null, 10, u, 5) === null, "C2 nothing without a place or a size");
  /* SAKUGATOKEN: with an engine that tells its figScale the star's box is the token's own, at every strength and every view */
  for (let st = 0; st <= 5; st++) for (const uu of [600, 900, 2000]) { const b = LP.starBox(c, 100, uu, st, LP.CUT.max, 1); ok(b.r - b.l === 100 && b.b - b.t === 100 && b.l === -50, `C2 figScale 1, step ${st}, view ${uu}: the star's box is its token (${b.r - b.l} px)`); }
  ok(LP.starBox(c, 100, u, 5, LP.CUT.max, null).r > 50 && LP.starBox(c, 100, u, 5, LP.CUT.max, NaN).r > 50, "C2 an engine that tells no figScale keeps the 1.9.23 cut-in box");
}
/* C6 */
{
  const o = { items: [{ x: 50, y: 50, w: 100, h: 100 }] };
  ok(LP.coverMax(o, { avoid: [{ l: 0, t: 0, r: 100, b: 100, w: LP.STAR_W, star: true }] }) === 0, "C6 a star box is no token's cover");
  ok(LP.coverMax(o, { avoid: [{ l: 0, t: 0, r: 100, b: 100, w: LP.TARGET_W }] }) > 0.9, "C6 a target's box still is");
}

/* C3 + C4 + C5 over the seats */
const SEATS = ["gm", "gmr", "p1", "p1r", "small", "big", "far"];
const LAYERS = ["screen", "overlay"], BOARDS = ["empty", "warehouse", "crowd", "live"], OUTS = ["ordinary", "strong", "critical"];
const STAR_OK = 0.02;
const starOn = (r) => {
  const t = r.target, cx = (t.l + t.r) / 2, cy = (t.t + t.b) / 2, u = Math.min(r.W, r.H);
  return LP.starBox({ x: cx, y: cy }, t.r - t.l, u, r.star?.step ?? 3);
};
/* the letters' boxes (hold box) on this seat against the star's box on this seat (its window's short side) */
const coverOf = (r) => {
  const sb = starOn(r);
  if (!sb) return 0;
  const A = (sb.r - sb.l) * (sb.b - sb.t);
  let c = 0;
  for (const d of r.drawn) c += area(d, sb);
  return c / A;
};
const R = {}, B = {};
for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) for (const seat of SEATS) {
  const k = `${layer}/${bd}/${out}/${seat}`;
  R[k] = await seatPlay({ seat, layer, bd, outcome: out, cut: true });
  B[k] = await seatPlay({ seat, layer, bd, outcome: out, cut: false });
}
/* C3 */
for (const [k, r] of Object.entries(R)) ok(r.star?.id === "TARGETaaaaaaaaaa", `C3 ${k}: the star is the roll's target (${r.star?.id})`);
for (const [k, r] of Object.entries(B)) ok(r.star == null, `C3 ${k}: no star without the engine's cut-in`);
{
  const r = await seatPlay({ seat: "gm", layer: "screen", bd: "empty", outcome: "miss", cut: true });
  ok(r.star == null, "C3 a miss has no star");
}
/* C4 */
let sumA = 0, sumB = 0, worse = [];
const table = [];
for (const k of Object.keys(R)) {
  const r = R[k], b = B[k];
  if (!r.drawn.length) continue;
  const ca = coverOf(r), cb = coverOf({ ...b, star: r.star });
  sumA += ca; sumB += cb;
  table.push([k, cb, ca, r.same?.moved ?? r.rule ?? "-"]);
  /* clean wherever the seat found a clean place for its block (moved 'least' = nothing clean on that seat). A BOARD block (drawn in the scene)
     is one scene place for every seat, planned round the star as a seat near the board's reference scale draws it (m = its board squares
     against the reference height): a seat zoomed far out (m < 0.75) draws the cut-in larger against the board than that, so its rows are
     only reported (--table), not held to it (provisional CAPSTAR-2) */
  const board = r.drawn.some((d) => d.world), m = 4.5 * GS * r.zoom / 900;
  if ((r.same?.moved ?? "none") !== "least" && (!board || m >= 0.75)) ok(ca <= STAR_OK, `C4 ${k}: the letters cover ${(ca * 100).toFixed(1)} % of the star's cut-in (before ${(cb * 100).toFixed(1)} %, ${r.same?.moved ?? r.rule})`);
  if (ca > cb + 0.02) worse.push(`${k} ${(cb * 100).toFixed(1)} -> ${(ca * 100).toFixed(1)}`);
}
ok(sumA < sumB, `C4 over all cases the star is covered less (${sumA.toFixed(2)} vs ${sumB.toFixed(2)} before)`);
/* C9 SAKUGATOKEN (engine 1.9.27, the owner: what belongs to a token stays on the token and its close surroundings; the token does not get
   bigger): with the engine that draws its figures at their tokens' size the star is still the shared one, its box is the struck token's own
   box on every seat, and where a seat found a clean place no lettering lies on it (same exemptions as C4) */
{
  let nFig = 0, room = 0;
  for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) for (const seat of SEATS) {
    const k = `${layer}/${bd}/${out}/${seat}`, r = await seatPlay({ seat, layer, bd, outcome: out, cut: "fig" });
    ok(r.star?.id === "TARGETaaaaaaaaaa" && r.star.fig === 1, `C9 ${k}: the star is the roll's target, drawn at its token's size (${r.star?.id}, ${r.star?.fig})`);
    if (!r.drawn.length) continue;
    const t = r.target, A = (t.r - t.l) * (t.b - t.t); let c = 0; for (const d of r.drawn) c += area(d, t);
    const board = r.drawn.some((d) => d.world), m = 4.5 * GS * r.zoom / 900;
    nFig++;
    if ((r.same?.moved ?? "none") !== "least" && (!board || m >= 0.75)) ok(c / A <= STAR_OK, `C9 ${k}: the letters cover ${(c / A * 100).toFixed(1)} % of the struck token (${r.same?.moved ?? r.rule})`);
    /* the room the enlarged copy took is the board's again: the block never stands farther from the struck token than with the cut-in box */
    const far = (rr) => Math.min(...rr.drawn.map((d) => Math.hypot((d.l + d.r) / 2 - (t.l + t.r) / 2, (d.t + d.b) / 2 - (t.t + t.b) / 2)));
    if (R[k]?.drawn.length && far(r) <= far(R[k]) + 1) room++;
  }
  ok(nFig > 100 && room >= nFig * 0.6, `C9 over ${nFig} cases the lettering stands as near the struck token as with the cut-in box, or nearer, in ${room}`);
}
/* C7: the live fight (lane 5, 2026-11-15 take a1: Omni-Man at 1750,1400 strikes the Soldier two squares to his right on The Warehouse, the
   whole cast on the board; the views where the tactics left them, GM 1600 x 900 at 0.6, the player 1366 x 768 at 0.45). No clean place on
   the GM's seat, so its block is the least-covering one: at STAR_W 20 its captions still lay across the star (20 % of it, live: "THE ODDS
   ARE SHATTERED!" over the Soldier); the star must weigh more than the token itself (100; 50 still covered it on the live inputs) */
{
  BOARDS_X.fight = { at: [1750, 1400], nb: [[1, 0], [4, 0], [1, -2], [2, -3], [4, -1, "hidden"], [6, 2], [8, 2], [8, 3], [-3, -1]], pin: null, tgt: [2, 0] };
  const live = [["gm", 0.6, { x: 2.2, y: 0.75 }], ["p1", 0.45, { x: 0.3, y: 0.86 }]];
  for (const [s, zoom, off] of live) {
    const r = await seatPlay({ seat: { ...SEAT_X[s], name: `${s}@${zoom}`, zoom }, layer: "screen", bd: "fight", outcome: "critical", cut: true, off });
    ok(r.drawn.length > 0 && coverOf(r) <= STAR_OK, `C7 the live fight critical on ${s} at ${zoom}: the letters cover ${(coverOf(r) * 100).toFixed(1)} % of the star (${r.same?.moved})`);
  }
}
/* C8: the same fight's REAL inputs to LP.seatPlace on the GM's seat (lane 5, three runs of the fight critical: the table's block and the
   seat's frame as stage.mjs built them, resting dice, panels and all; lib/capstar-live-fight.json). Two of the three laid the captions across
   the star at STAR_W 20 and 50 (16-20 % of it); none may now. The star boxes carry the weight they were captured with: re-weighed here */
{
  const D = JSON.parse(readFileSync(join(here, "lib/capstar-live-fight.json"), "utf8"));
  D.forEach((d, n) => {
    for (const a of [...d.seat.avoid, ...(d.a.avoid1 ?? [])]) if (a.star) a.w = LP.STAR_W;
    const out = LP.seatPlace(d.a, d.seat), sb = d.seat.avoid.find((a) => a.star), A = (sb.r - sb.l) * (sb.b - sb.t);
    const c = out.items.reduce((s, i) => s + area({ l: i.x - i.w / 2, t: i.y - i.h / 2, r: i.x + i.w / 2, b: i.y + i.h / 2 }, sb), 0) / A;
    ok(out.items.length === 4 && c <= STAR_OK, `C8 live fight input ${n}: the letters cover ${(c * 100).toFixed(1)} % of the star (${out.moved})`);
  });
}
if (process.argv.includes("--table")) {
  for (const [k, cb, ca, m] of table) console.log(k.padEnd(36), (cb * 100).toFixed(1).padStart(6), "->", (ca * 100).toFixed(1).padStart(6), m);
  console.log("worse:", worse);
}
/* C5 (splashsame S1, S2, S4, S7 with the star on) */
const wordOf = (r) => r.drawn.find((d) => d.role === "word");
const moved = (r) => r.same?.moved ?? "none";
const get = (k) => R[k];
for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) {
  const rs = SEATS.map((s) => get(`${layer}/${bd}/${out}/${s}`)).filter((r) => r.drawn.length && !r.drawn.some((d) => d.world));
  const ref = rs[0];
  if (!ref) continue;
  const w0 = wordOf(ref);
  for (const r of rs.slice(1)) {
    const w = wordOf(r);
    for (const d of r.drawn) {
      const d0 = ref.drawn.find((x) => x.role === d.role);
      if (!d0 || !w || !w0) continue;
      const a = d.S / w.S, b = d0.S / w0.S;
      ok(Math.abs(a - b) <= 0.04 * b + 0.01, `C5/S1 ${layer}/${bd}/${out}: ${d.role} is ${a.toFixed(3)} of the word on ${r.seat}, ${b.toFixed(3)} on ${ref.seat}`);
    }
  }
}
const apart = (a, b, ax) => (ax === "y" ? a.b <= b.t || b.b <= a.t : a.r <= b.l || b.r <= a.l);
for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) {
  const rs = SEATS.map((s) => get(`${layer}/${bd}/${out}/${s}`)).filter((r) => r.drawn.length && !r.drawn.some((d) => d.world));
  const ref = rs.find((r) => moved(r) !== "swapped");
  if (!ref) continue;
  for (const r of rs) {
    if (r === ref || moved(r) === "swapped") continue;
    for (let i = 0; i < ref.drawn.length; i++) for (let j = i + 1; j < ref.drawn.length; j++) {
      const a0 = ref.drawn[i], b0 = ref.drawn[j], a = r.drawn.find((x) => x.role === a0.role), b = r.drawn.find((x) => x.role === b0.role);
      if (!a || !b) continue;
      for (const ax of ["y", "x"]) {
        if (!apart(a0, b0, ax) || (ax === "x" && apart(a0, b0, "y"))) continue;
        ok(Math.sign(b[ax] - a[ax]) === Math.sign(b0[ax] - a0[ax]), `C5/S2 ${layer}/${bd}/${out}: ${b0.role} vs ${a0.role} on ${ax} differs on ${r.seat} (${moved(r)}) from ${ref.seat}`);
      }
    }
  }
}
for (const layer of LAYERS) for (const bd of BOARDS) for (const seat of SEATS) {
  const px = OUTS.map((o) => wordOf(get(`${layer}/${bd}/${o}/${seat}`))?.S ?? 0);
  ok(px[0] > 0 && px[0] < px[1] && px[1] < px[2], `C5/S4 ${layer}/${bd}/${seat}: ordinary ${px[0]} < strong ${px[1]} < critical ${px[2]}`);
}
for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) {
  const rs = SEATS.map((s) => get(`${layer}/${bd}/${out}/${s}`));
  for (const r of rs.slice(1)) for (const d of r.drawn) {
    const d0 = rs[0].drawn.find((x) => x.role === d.role);
    if (d0) ok((d.startAt ?? null) === (d0.startAt ?? null), `C5/S7 ${layer}/${bd}/${out}: ${d.role} starts at ${d.startAt} on ${r.seat}, ${d0.startAt} on ${rs[0].seat}`);
  }
}
for (const m of fails.slice(0, 40)) console.log("FAIL", m);
if (fails.length > 40) console.log(`... and ${fails.length - 40} more`);
console.log(`capstar: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
