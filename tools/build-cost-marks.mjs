// node tools/build-cost-marks.mjs  -- writes the drawings of THE MARKS OF COST (ledger U86) into styles/kit.css, between the two
// "cost-marks" marker comments. Every mark is a mask (an SVG 12 units high) painted with currentColor, so a mark takes the colour of the
// text it stands in and scales with it. Three versions (a, b, c) are drawn while the user chooses (stage 1); stage 2 keeps one: delete
// the other two from SETS and run this again.
import { readFileSync, writeFileSync } from "node:fs";

const f = (n) => String(Math.round(n * 100) / 100);
const poly = (pts) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join("L")}Z`;
const skewBar = (x, w, y0 = 3.5, y1 = 8.5, k = 1.5) => poly([[x + k, y0], [x + w, y0], [x + w - k, y1], [x, y1]]);
/* a circle drawn clockwise (hole = true: the other way, so it cuts a hole in a shape drawn clockwise) */
const circle = (cx, cy, r, hole = false) => `M${f(cx)},${f(cy - r)}A${f(r)},${f(r)} 0 1 ${hole ? 0 : 1} ${f(cx)},${f(cy + r)}A${f(r)},${f(r)} 0 1 ${hole ? 0 : 1} ${f(cx)},${f(cy - r)}Z`;
const sector = (cx, cy, r, deg) => { const a = (deg * Math.PI) / 180; return `M${f(cx)},${f(cy)}L${f(cx)},${f(cy - r)}A${f(r)},${f(r)} 0 ${deg > 180 ? 1 : 0} 1 ${f(cx + r * Math.sin(a))},${f(cy - r * Math.cos(a))}Z`; };
const rot = ([x, y], deg, [ox, oy]) => { const a = (deg * Math.PI) / 180, dx = x - ox, dy = y - oy; return [ox + dx * Math.cos(a) - dy * Math.sin(a), oy + dx * Math.sin(a) + dy * Math.cos(a)]; };
const plus = (x, cy = 6, s = 5, w = 1.7) => poly([[x + (s - w) / 2, cy - s / 2], [x + (s + w) / 2, cy - s / 2], [x + (s + w) / 2, cy - w / 2], [x + s, cy - w / 2], [x + s, cy + w / 2], [x + (s + w) / 2, cy + w / 2], [x + (s + w) / 2, cy + s / 2], [x + (s - w) / 2, cy + s / 2], [x + (s - w) / 2, cy + w / 2], [x, cy + w / 2], [x, cy - w / 2], [x + (s - w) / 2, cy - w / 2]]);
/* a question mark, drawn (never a font): the hook as a stroke, the dot as a disc; (x, y) = its top left, 5 x 9.6 units at s = 1 */
const ask = (x, y, s = 1, skew = 0) => ({ stroke: `M${f(x + 0.9 * s + skew)},${f(y + 2.7 * s)}a${f(1.75 * s)},${f(1.75 * s)} 0 1 1 ${f(2.9 * s)},${f(1.35 * s)}q${f(-1.25 * s)},${f(0.9 * s)} ${f(-1.3 * s - skew * 0.5)},${f(2.5 * s)}`, sw: 1.7 * s, dot: circle(x + 2.45 * s - skew * 0.4, y + 8.6 * s, 1.0 * s) });

const A = {
  full: { w: 24, d: skewBar(0, 24) },
  quick: { w: 12, d: skewBar(0, 12) },
  turn: { w: 39, d: skewBar(0, 24) + skewBar(27, 12) },
  long: { w: 36, d: skewBar(0, 24) + poly([[26, 3.5], [28.4, 3.5], [30.6, 6], [28.4, 8.5], [26, 8.5], [28.2, 6]]) + poly([[31, 3.5], [33.4, 3.5], [35.6, 6], [33.4, 8.5], [31, 8.5], [33.2, 6]]) },
  none: { w: 12, d: poly([[6, 0.8], [11.2, 6], [6, 11.2], [0.8, 6]]) + poly([[6, 3.7], [3.7, 6], [6, 8.3], [8.3, 6]]) },
  out: { w: 11, d: poly([[0, 1.2], [7.6, 1.2], [7.6, 6.3], [10.6, 6.3], [6.3, 11.4], [2, 6.3], [5, 6.3], [5, 3.8], [0, 3.8]]) },
  gm: { w: 9, ...ask(1.6, 1.2, 1, 1.1) },
  stress: { w: 8, d: poly([[4.7, 0.4], [0.7, 6.9], [3.5, 6.9], [2.3, 11.6], [7.4, 4.7], [4.4, 4.7], [6.1, 0.4]]) },
};
const ring = (r0, r1) => circle(6, 6, r0) + circle(6, 6, r1, true);
const B = {
  quick: { w: 12, d: ring(5.6, 4.35) + sector(6, 6, 5.6, 120) },
  full: { w: 12, d: ring(5.6, 4.35) + sector(6, 6, 5.6, 240) },
  turn: { w: 12, d: circle(6, 6, 5.6) },
  long: { w: 19, d: circle(6, 6, 5.6) + plus(13.5) },
  none: { w: 12, d: ring(5.6, 4.1) },
  "quick-out": { w: 12, d: sector(5.2, 7.2, 6.6, 120) },
  "full-out": { w: 12, d: sector(6, 6, 5.8, 240) },
  gm: { w: 12, d: ring(5.6, 4.5), ...(() => { const q = ask(3.9, 2.6, 0.72); return { stroke: q.stroke, sw: q.sw, dot: q.dot }; })() },
  stress: { w: 8, d: "M4,0.4C4,0.4 7.6,5.2 7.6,7.8A3.6,3.6 0 0 1 0.4,7.8C0.4,5.2 4,0.4 4,0.4Z" },
};
B.out = B["quick-out"];      // out of turn has no mark of its own here: the slice stands alone, out of the dial
const sq = (x) => poly([[x + 0.6, 1.6], [x + 9.4, 1.6], [x + 9.4, 10.4], [x + 0.6, 10.4]]);
const tri = (x) => poly([[x + 0.6, 1.2], [x + 9, 6], [x + 0.6, 10.8]]);
const stroke3 = (deg) => poly([[7.1, 0.5], [8.9, 0.5], [8.5, 6.4], [7.5, 6.4]].map((p) => rot(p, deg, [8, 11.6])));
const C = {
  full: { w: 10, d: sq(0) },
  quick: { w: 10, d: tri(0) },
  turn: { w: 21.5, d: sq(0) + tri(11.5) },
  long: { w: 28.5, d: sq(0) + tri(11.5) + plus(23) },
  none: { w: 12, d: ring(5.2, 3.5) },
  out: { w: 12, d: poly([[6, 0.3], [7.5, 4.5], [11.7, 6], [7.5, 7.5], [6, 11.7], [4.5, 7.5], [0.3, 6], [4.5, 4.5]]) },
  gm: { w: 7, ...ask(0.9, 1.2, 1, 0) },
  stress: { w: 16, d: stroke3(0) + stroke3(-38) + stroke3(38) },
};
/* ---- the marks of things (second part of U86): only what Font Awesome does not draw for a version (kit.mjs SYM_FA has the rest) ---- */
const arrow = (x, len) => poly([[x, 5], [x + len - 5.5, 5], [x + len - 5.5, 2.4], [x + len, 6], [x + len - 5.5, 9.6], [x + len - 5.5, 7], [x, 7]]);
const stop = (x) => poly([[x, 1], [x + 2, 1], [x + 2, 11], [x, 11]]);
Object.assign(A, { rmin: { w: 16, d: stop(0) + arrow(3, 13) }, rmax: { w: 16, d: arrow(0, 13) + stop(14) } });
Object.assign(B, {
  rmin: { w: 12, d: ring(4.4, 3.3) + circle(6, 6, 1.9) },                       // one wave round the point: near
  rmax: { w: 12, d: ring(5.9, 4.9) + ring(3.8, 2.8) + circle(6, 6, 1.3) },      // two waves: far
});
const star = (cx, cy, n, r0, r1) => poly(Array.from({ length: 2 * n }, (_, i) => { const a = (Math.PI * i) / n, r = i % 2 ? r1 : r0; return [cx + r * Math.sin(a), cy - r * Math.cos(a)]; }));
const pips = (list, r) => list.map(([x, y]) => `<circle cx='${f(x)}' cy='${f(y)}' r='${f(r)}'/>`).join("");
const SIX = [[3.7, 3.1], [3.7, 6], [3.7, 8.9], [8.3, 3.1], [8.3, 6], [8.3, 8.9]], FIVE = [[3.4, 3.4], [8.6, 3.4], [6, 6], [3.4, 8.6], [8.6, 8.6]];
Object.assign(C, {
  health: { w: 12, d: "M6,11.3L1.1,6.2A2.95,2.95 0 0 1 6,2.9A2.95,2.95 0 0 1 10.9,6.2Z" },
  damage: { w: 12, d: star(6, 6, 8, 5.9, 3.1) },
  armor: { w: 12, raw: "<path fill='none' stroke='#000' stroke-width='1.9' stroke-linejoin='round' d='M1.6,1.7H10.4V5.8C10.4,8.6 8.3,10.1 6,10.9C3.7,10.1 1.6,8.6 1.6,5.8Z'/>" },
  rmin: { w: 13, d: stop(0.4) + poly([[4.2, 1.2], [12.6, 6], [4.2, 10.8]]) },
  rmax: { w: 13, d: poly([[0.4, 1.2], [8.8, 6], [0.4, 10.8]]) + stop(10.6) },
  dice: { w: 12, raw: `<rect x='1.3' y='1.3' width='9.4' height='9.4' rx='1.6' fill='none' stroke='#000' stroke-width='1.6'/>${pips([[4, 4], [8, 8], [6, 6]], 1.05)}` },
  six: { w: 12, raw: `<mask id='m'><rect width='12' height='12' fill='#fff'/><g fill='#000'>${pips(SIX, 1.05)}</g></mask><rect x='0.5' y='0.5' width='11' height='11' rx='1.8' mask='url(#m)'/>` },
  push: { w: 12, raw: "<path fill='none' stroke='#000' stroke-width='1.9' d='M9.7,3.4A4.5,4.5 0 1 0 10.5,6.9'/><path d='M11.8,0.7V5.3H7.2Z'/><circle cx='6' cy='6.2' r='1.35'/>" },
  crit: { w: 15, raw: `<path d='M2.4,4.6H6.6L5.2,7.4H2.4ZM8.4,4.6H12.6V7.4H7Z'/>${pips([[2.3, 4.1], [2.3, 7.9], [12.7, 4.1], [12.7, 7.9]], 2.05)}` },      // a bone broken in two
});
/* ---- a slot that is spent (.ipu-off): the same shape, hollow; never told by colour alone ---- */
const hollow = (pts, sw = 1.2) => `<path fill='none' stroke='#000' stroke-width='${f(sw)}' stroke-linejoin='miter' d='${poly(pts)}'/>`;
Object.assign(A, {
  "full-off": { w: 24, raw: hollow([[2.4, 4.1], [23.2, 4.1], [21.6, 7.9], [0.8, 7.9]]) },
  "quick-off": { w: 12, raw: hollow([[2.4, 4.1], [11.2, 4.1], [9.6, 7.9], [0.8, 7.9]]) },
});
const spoke = (deg) => { const a = (deg * Math.PI) / 180; return `M6,6L${f(6 + 4.6 * Math.sin(a))},${f(6 - 4.6 * Math.cos(a))}`; };
Object.assign(B, {
  "full-off": { w: 12, d: ring(5.6, 4.6), raw: `<path fill='none' stroke='#000' stroke-width='1' d='${spoke(0)}${spoke(240)}'/>` },
  "quick-off": { w: 12, d: ring(5.6, 4.6), raw: `<path fill='none' stroke='#000' stroke-width='1' d='${spoke(0)}${spoke(120)}'/>` },
});
Object.assign(C, {
  "full-off": { w: 10, raw: hollow([[1.2, 2.2], [8.8, 2.2], [8.8, 9.8], [1.2, 9.8]]) },
  "quick-off": { w: 10, raw: hollow([[1.3, 2.3], [7.8, 6], [1.3, 9.7]]) },
});
const SETS = { a: A, b: B, c: C };

const svg = (g) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${f(g.w)} 12'>${g.raw ?? ""}${g.d ? `<path d='${g.d}'/>` : ""}${g.stroke ? `<path fill='none' stroke='#000' stroke-width='${f(g.sw)}' stroke-linecap='round' d='${g.stroke}'/><path d='${g.dot}'/>` : ""}</svg>`;
const uri = (g) => `url("data:image/svg+xml,${svg(g).replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;
const lines = [];
for (const [v, set] of Object.entries(SETS)) for (const [k, g] of Object.entries(set)) {
  const sel = k.endsWith("-out") ? `.ipu-cost-${v}.ipu-k-${k.slice(0, -4)}.ipu-out` : k.endsWith("-off") ? `.ipu-cost-${v}.ipu-k-${k.slice(0, -4)}.ipu-off` : `.ipu-cost-${v}.ipu-k-${k}`;
  lines.push(`${sel} { aspect-ratio: ${f(g.w)} / 12; -webkit-mask-image: ${uri(g)}; mask-image: ${uri(g)}; }`);
}
const file = new URL("../styles/kit.css", import.meta.url), src = readFileSync(file, "utf8");
const a = "/* cost-marks:begin (generated by tools/build-cost-marks.mjs) */", b = "/* cost-marks:end */";
if (!src.includes(a) || !src.includes(b)) { console.log("markers not found in kit.css"); process.exit(1); }
writeFileSync(file, `${src.slice(0, src.indexOf(a) + a.length)}\n${lines.join("\n")}\n${src.slice(src.indexOf(b))}`);
console.log(`wrote ${lines.length} marks`);
