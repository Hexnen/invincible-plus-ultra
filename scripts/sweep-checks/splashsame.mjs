// node scripts/sweep-checks/splashsame.mjs  -- SPLASHSAME (2026-11-15): one roll, the SAME picture on every seat. ADVS2 found seats with other
// windows, zooms, panels or motion settings getting other pictures: the critical's caption beside the word on one seat and under it on another,
// a 1000 x 620 seat drawing smaller words with BIGGER captions (D2); a 1366 x 768 seat at zoom 0.8 sent to the screen layer by its zoom alone
// on a map layer (D7). Now (stage.mjs tableFrame + letter-plan.mjs seatPlace, same-picture rules): the screen block is composed once as the
// TABLE's block (from documents only) and each seat only places it (one factor for the whole block, parts in the table's order, moved away from
// the roller and only then smaller); on a map layer a seat keeps the board block when its view holds it (MAPSEAT: one scene place) and its
// zoom inside the map band alone never sends it to the screen.
// Checks, over seats (windows 1000..1920, zooms 0.25..0.8, panels, reduced motion) x outcomes x layers x boards (empty, The Warehouse, crowd):
//   S1 the same relative sizes (every line against the word) on every seat;
//   S2 the same arrangement (the lines' order round the word) on every seat, unless the seat logged a swap (nothing clean in order);
//   S3 the same relative place (the word's side of the roller) unless the seat logged a move away (far / least / swapped);
//   S4 the ranks in order on every seat and board (ordinary < strong < critical), on each layer;
//   S5 reduced motion changes nothing of the layout (place, size, layer, start);
//   S6 the GM's chosen layer: on a map layer every moment whose roller is in view gets a seat rule (never the screen by zoom alone), and
//      ok moments are drawn on the board;
//   S7 the same moment: every line starts on the same table instant on every seat.
// Fails on tactics-integrated-139 (S1 29, S2 66, S3 24 of 1244); passes after.
import { seatPlay } from "./lib/splash-seat.mjs";

let n = 0, f = 0;
const fails = [];
const ok = (c, msg) => { n++; if (!c) { f++; fails.push(msg); } };
const SEATS = ["gm", "gmr", "p1", "p1r", "small", "big", "far"];
const LAYERS = ["screen", "overlay"], BOARDS = ["empty", "warehouse", "crowd"], OUTS = ["ordinary", "strong", "critical"];
const R = {};
for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) for (const seat of SEATS) {
  R[`${layer}/${bd}/${out}/${seat}`] = await seatPlay({ seat, layer, bd, outcome: out });
}
for (const seat of ["gm", "gmr", "p1", "p1r"]) for (const out of ["pushed", "stressed"]) for (const bd of ["empty", "warehouse"]) R[`screen/${bd}/${out}/${seat}`] = await seatPlay({ seat, layer: "screen", bd, outcome: out });
const get = (k) => R[k];
const wordOf = (r) => r.drawn.find((d) => d.role === "word");
const moved = (r) => r.same?.moved ?? "none";
const AWAY = new Set(["far", "least", "swapped"]);

/* S1: relative sizes (each line's cap against the word's) the same on every seat that letters on the screen (a board block is the board's) */
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
      ok(Math.abs(a - b) <= 0.04 * b + 0.01, `S1 ${layer}/${bd}/${out}: ${d.role} is ${a.toFixed(3)} of the word on ${r.seat}, ${b.toFixed(3)} on ${ref.seat}`);
    }
  }
}
/* S2: arrangement: for each pair of lines whose boxes are clearly apart on one axis on the reference seat, the same order on that axis */
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
        const s0 = Math.sign(b0[ax] - a0[ax]), s = Math.sign(b[ax] - a[ax]);
        ok(s === s0, `S2 ${layer}/${bd}/${out}: ${b0.role} ${ax === "y" ? (s0 > 0 ? "below" : "above") : (s0 > 0 ? "right of" : "left of")} ${a0.role} on ${ref.seat}, not on ${r.seat} (${moved(r)})`);
      }
    }
  }
}
/* S3: the word's side of the roller (above / below / left / right) the same, unless the seat logged a move away */
const sideOf = (r) => {
  const w = wordOf(r), h = r.hero;
  if (!w) return null;
  return w.b <= h.t ? "above" : w.t >= h.b ? "below" : w.r <= h.l ? "left" : w.l >= h.r ? "right" : "on";
};
for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) {
  const rs = SEATS.map((s) => get(`${layer}/${bd}/${out}/${s}`)).filter((r) => r.drawn.length && !r.drawn.some((d) => d.world) && !AWAY.has(moved(r)));
  const ref = rs[0];
  if (!ref) continue;
  for (const r of rs.slice(1)) ok(sideOf(r) === sideOf(ref), `S3 ${layer}/${bd}/${out}: the word ${sideOf(ref)} the roller on ${ref.seat}, ${sideOf(r)} on ${r.seat} (${moved(r)})`);
}
/* S4: ranks in order on every seat, board and layer (the word as drawn, px) */
for (const layer of LAYERS) for (const bd of BOARDS) for (const seat of SEATS) {
  const px = OUTS.map((o) => wordOf(get(`${layer}/${bd}/${o}/${seat}`))?.S ?? 0);
  ok(px[0] > 0 && px[0] < px[1] && px[1] < px[2], `S4 ${layer}/${bd}/${seat}: ordinary ${px[0]} < strong ${px[1]} < critical ${px[2]}`);
}
/* S5: reduced motion changes motion only: the same lines, places, sizes, layers and starts as its full-motion twin */
const sig = (r) => r.drawn.map((d) => [d.role, d.text, Math.round(d.x), Math.round(d.y), d.S, d.layer, d.startAt ?? null].join(":")).join("|");
for (const k of Object.keys(R)) {
  const [layer, bd, out, seat] = k.split("/");
  if (!seat.endsWith("r") || seat === "far") continue;
  const twin = R[`${layer}/${bd}/${out}/${seat.slice(0, -1)}`];
  if (twin) ok(sig(R[k]) === sig(twin), `S5 ${k}: reduced motion moved the block (${sig(R[k]).slice(0, 80)} vs ${sig(twin).slice(0, 80)})`);
}
/* S6: the GM's layer: a seat whose zoom is inside the map band gives every map moment a seat rule (ok on the board, cut / speck on its
   screen: the stated rules); a seat zoomed past the band (the stated rule MAP_BAND) shows every outcome of that board on its screen alike */
const BAND = [0.25, 1.25], mOf = (r) => 4.5 * 350 * r.zoom / 900;
for (const bd of BOARDS) for (const seat of SEATS) {
  const rs = OUTS.map((out) => get(`overlay/${bd}/${out}/${seat}`)), m = mOf(rs[0]);
  for (const [i, r] of rs.entries()) {
    const tag = `S6 overlay/${bd}/${OUTS[i]}/${seat}`;
    if (m >= BAND[0] && m <= BAND[1]) {
      ok(r.rule != null, `${tag}: no seat rule inside the map band (m ${m.toFixed(2)})`);
      if (r.rule === "ok") ok(r.drawn.length && r.drawn.every((d) => d.world), `${tag}: rule ${r.rule} but drawn off the board`);
      else ok(r.drawn.length && r.drawn.every((d) => !d.world), `${tag}: rule ${r.rule} but drawn on the board`);
    } else ok(r.rule == null && r.drawn.length && r.drawn.every((d) => !d.world), `${tag}: past the map band (m ${m.toFixed(2)}) but not on the screen`);
  }
}
/* S7: the same moment: each line's start (the table's instant) the same on every seat of one layer */
for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) {
  const rs = SEATS.map((s) => get(`${layer}/${bd}/${out}/${s}`));
  for (const r of rs.slice(1)) for (const d of r.drawn) {
    const d0 = rs[0].drawn.find((x) => x.role === d.role);
    if (d0) ok((d.startAt ?? null) === (d0.startAt ?? null), `S7 ${layer}/${bd}/${out}: ${d.role} starts at ${d.startAt} on ${r.seat}, ${d0.startAt} on ${rs[0].seat}`);
  }
}
for (const m of fails.slice(0, 40)) console.log("FAIL", m);
if (fails.length > 40) console.log(`... and ${fails.length - 40} more`);
console.log(`splashsame: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
