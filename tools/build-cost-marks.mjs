// node tools/build-cost-marks.mjs  -- writes the drawings of THE MARKS (ledger U86 / U93) into styles/kit.css, between the two
// "cost-marks" marker comments. Every mark is a mask (an SVG 12 units high) painted with currentColor, so a mark takes the colour of the
// text it stands in and scales with it. ONE set: the bars. Today's slanted yellow bar is the unit: a long bar = the full action, a
// short bar = a quick one, both = the whole turn, a hooked arrow before the bar = taken out of turn.
import { readFileSync, writeFileSync } from "node:fs";

const f = (n) => String(Math.round(n * 100) / 100);
const poly = (pts) => `M${pts.map(([x, y]) => `${f(x)},${f(y)}`).join("L")}Z`;
const skewBar = (x, w, y0 = 3.5, y1 = 8.5, k = 1.5) => poly([[x + k, y0], [x + w, y0], [x + w - k, y1], [x, y1]]);
const circle = (cx, cy, r) => `M${f(cx)},${f(cy - r)}A${f(r)},${f(r)} 0 1 1 ${f(cx)},${f(cy + r)}A${f(r)},${f(r)} 0 1 1 ${f(cx)},${f(cy - r)}Z`;
/* a question mark, drawn (never a font): the hook as a stroke, the dot as a disc; (x, y) = its top left, 5 x 9.6 units at s = 1 */
const ask = (x, y, s = 1, skew = 0) => ({ stroke: `M${f(x + 0.9 * s + skew)},${f(y + 2.7 * s)}a${f(1.75 * s)},${f(1.75 * s)} 0 1 1 ${f(2.9 * s)},${f(1.35 * s)}q${f(-1.25 * s)},${f(0.9 * s)} ${f(-1.3 * s - skew * 0.5)},${f(2.5 * s)}`, sw: 1.9 * s, dot: circle(x + 2.45 * s - skew * 0.4, y + 8.6 * s, 1.1 * s) });
const arrow = (x, len) => poly([[x, 5], [x + len - 5.5, 5], [x + len - 5.5, 2.4], [x + len, 6], [x + len - 5.5, 9.6], [x + len - 5.5, 7], [x, 7]]);
const stop = (x) => poly([[x, 1], [x + 2, 1], [x + 2, 11], [x, 11]]);
/* a slot that is spent (.ipu-off): the same shape, hollow; never told by colour alone */
const hollow = (pts, sw = 1.2) => `<path fill='none' stroke='#000' stroke-width='${f(sw)}' stroke-linejoin='miter' d='${poly(pts)}'/>`;

const MARKS = {
  full: { w: 24, d: skewBar(0, 24) },
  quick: { w: 12, d: skewBar(0, 12) },
  turn: { w: 39, d: skewBar(0, 24) + skewBar(27, 12) },
  long: { w: 36, d: skewBar(0, 24) + poly([[26, 3.5], [28.4, 3.5], [30.6, 6], [28.4, 8.5], [26, 8.5], [28.2, 6]]) + poly([[31, 3.5], [33.4, 3.5], [35.6, 6], [33.4, 8.5], [31, 8.5], [33.2, 6]]) },
  none: { w: 12, d: poly([[6, 0.8], [11.2, 6], [6, 11.2], [0.8, 6]]) + poly([[6, 3.7], [3.7, 6], [6, 8.3], [8.3, 6]]) },
  /* out of turn: a hooked arrow that drops into the row from above. U93: the whole height of the mark and a thick stem, so that it
     reads beside a bar at the smallest size (stage 1's was two thirds of this) */
  out: { w: 13, d: poly([[0, 0.5], [9.5, 0.5], [9.5, 5.9], [12.9, 5.9], [7.7, 11.7], [2.5, 5.9], [5.9, 5.9], [5.9, 3.9], [0, 3.9]]) },
  /* the GM names the price. U93: the whole height, a heavier stroke, leaning like the bars */
  gm: { w: 9, ...ask(1.3, 0.3, 1.18, 1.1) },
  stress: { w: 8, d: poly([[4.7, 0.4], [0.7, 6.9], [3.5, 6.9], [2.3, 11.6], [7.4, 4.7], [4.4, 4.7], [6.1, 0.4]]) },
  "full-off": { w: 24, raw: hollow([[2.4, 4.1], [23.2, 4.1], [21.6, 7.9], [0.8, 7.9]]) },
  "quick-off": { w: 12, raw: hollow([[2.4, 4.1], [11.2, 4.1], [9.6, 7.9], [0.8, 7.9]]) },
  /* the marks of things that Font Awesome does not draw (kit.mjs SYM_FA has the rest) */
  rmin: { w: 16, d: stop(0) + arrow(3, 13) },
  rmax: { w: 16, d: arrow(0, 13) + stop(14) },
  /* U125 (b) / U119: range as ONE number (both ends the same: a melee weapon's 0, a thrown 2/2): the arrow of the two above, with a head
     at each end and no stop, so it names neither end. Same stem, same heads, same box as rmin / rmax */
  range: { w: 16, d: poly([[0, 6], [5.5, 2.4], [5.5, 5], [10.5, 5], [10.5, 2.4], [16, 6], [10.5, 9.6], [10.5, 7], [5.5, 7], [5.5, 9.6]]) },
  /* Armor. U93: a breastplate, not a shield: the shield is Block's picture (the half shield of the answer on a reaction card) */
  armor: { w: 12, d: "M2.3,1H4.5C4.8,2.5 7.2,2.5 7.5,1H9.7L11.5,4.3L9.7,5.6V11H2.3V5.6L0.5,4.3Z" + poly([[5.4, 4.6], [5.4, 8.4], [6.6, 8.4], [6.6, 4.6]]) },
  /* U133: THE CHANCE of a target (the four bands of the engine: unlikely, even, likely, near certain) as the way it points: a chevron
     down, a level dash, a chevron up, two up. On the map it stands on a dark plate in the token's corner (moinen-maps zones-api.md
     section 42, `badge`); the legend draws the same plate (kit.css .ipu-odds-plate) */
  ...oddsMarks(),
};
/* U133: one family of strokes, all of one thickness and one span (0.6 .. 11.4), centred in the box; never a colour alone: each level is
   its own shape. A chevron of arms at 45 degrees, its point at (6, y) opening down (up = +1: points up) or up (up = -1: points down).
   The level dash is NOT the quick action's bar (a leaning slab with flat ends, half the box high): it lies level, as thin as a
   chevron's arm, and ends in the chevrons' points, so it reads as one of the four and not as a slot or a piece of a bar */
/* (the arm's thickness across it, the half span of a chevron; functions, not constants: MARKS above is built before this line runs) */
function arrowSizes() { return { ARM: 2.4, SPAN: 5.4, R2: Math.SQRT2 }; }
function chevron(y, up, s = 1) {
  const { ARM, SPAN, R2 } = arrowSizes(), a = SPAN * s, o = ARM / R2, d = (v) => y + up * v;
  // (up = +1: the point at the top, the arms going down; up = -1: mirrored)
  return poly([[6, y], [6 + a, d(a)], [6 + a - o, d(a + o)], [6, d(ARM * R2)], [6 - a + o, d(a + o)], [6 - a, d(a)]]);
}
function chevronH(s = 1) { const { ARM, SPAN, R2 } = arrowSizes(); return SPAN * s + ARM / R2; }
function oddsArrow(level) {
  const { ARM, R2 } = arrowSizes();
  if (level === 2) { const t = ARM * 1.25, e = t / 2 + 0.2; return { w: 12, d: poly([[0.6, 6], [0.6 + e, 6 - t / 2], [11.4 - e, 6 - t / 2], [11.4, 6], [11.4 - e, 6 + t / 2], [0.6 + e, 6 + t / 2]]) }; }
  if (level === 1) { const h = chevronH(); return { w: 12, d: chevron(6 + h / 2, -1) }; }
  if (level === 3) { const h = chevronH(); return { w: 12, d: chevron(6 - h / 2, 1) }; }
  // two up: the same chevron a little smaller, twice, the second a clear step under the first
  const s = 0.86, step = ARM * R2 + 1.25, h = chevronH(s) + step;
  return { w: 12, d: chevron(6 - h / 2, 1, s) + chevron(6 - h / 2 + step, 1, s) };
}
function oddsMarks() {
  const out = {};
  for (let i = 1; i <= 4; i++) out[`odds-${i}`] = oddsArrow(i);
  return out;
}

const svg = (g) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${f(g.w)} 12'>${g.raw ?? ""}${g.d ? `<path d='${g.d}'/>` : ""}${g.stroke ? `<path fill='none' stroke='#000' stroke-width='${f(g.sw)}' stroke-linecap='round' d='${g.stroke}'/><path d='${g.dot}'/>` : ""}</svg>`;
const uri = (g) => `url("data:image/svg+xml,${svg(g).replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}")`;
/* every drawing is a custom property first (--ipu-m-<kind>), so a surface that cannot add an element (the system's roll window: a
   ::before of its own row) paints the SAME drawing; the classes below are what every other surface uses */
const lines = [`:root { ${Object.entries(MARKS).map(([k, g]) => `--ipu-m-${k}: ${uri(g)};`).join(" ")} }`];
for (const [k, g] of Object.entries(MARKS)) {
  const sel = k.endsWith("-off") ? `.ipu-k-${k.slice(0, -4)}.ipu-off` : `.ipu-k-${k}`;
  lines.push(`${sel} { aspect-ratio: ${f(g.w)} / 12; -webkit-mask-image: var(--ipu-m-${k}); mask-image: var(--ipu-m-${k}); }`);
}
const file = new URL("../styles/kit.css", import.meta.url), src = readFileSync(file, "utf8");
const a = "/* cost-marks:begin (generated by tools/build-cost-marks.mjs) */", b = "/* cost-marks:end */";
if (!src.includes(a) || !src.includes(b)) { console.log("markers not found in kit.css"); process.exit(1); }
writeFileSync(file, `${src.slice(0, src.indexOf(a) + a.length)}\n${lines.join("\n")}\n${src.slice(src.indexOf(b))}`);
/* U100: the same drawings for a surface that is not a stylesheet's (the map module draws the marks on its canvas labels from these
   pictures, moinen-maps zones-api.md section 40): scripts/kit-marks.mjs, generated, never edited by hand */
const data = (g) => `data:image/svg+xml,${svg(g).replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}`;
writeFileSync(new URL("../scripts/kit-marks.mjs", import.meta.url), `// GENERATED by tools/build-cost-marks.mjs (U100): the drawings of THE MARKS as pictures, the same as kit.css --ipu-m-*. Do not edit.\nexport const MARK_SVG = Object.freeze({\n${Object.entries(MARKS).map(([k, g]) => `  ${JSON.stringify(k)}: Object.freeze({ w: ${f(g.w)}, uri: ${JSON.stringify(data(g))} }),`).join("\n")}\n});\n`);
console.log(`wrote ${lines.length - 1} marks`);
