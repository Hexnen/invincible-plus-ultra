// node scripts/sweep-checks/gorepink.mjs  (GOREPINK: the owner's standing rule for these effects, "no pink", applied to the blood on the
// screen. The crumbling front and the flakes of a drying stain were a pale salmon [214, 128, 100]; the wet lit rim a coral, the glint a
// rosy white, a glint left through red mixed with white; and red at a low alpha over a LIGHT map is pink whatever the palette says.)
// What is checked, and each would fail if a pink or salmon colour came back:
//   1. the measure itself (scripts/gore/tone.mjs isPink) on named colours: the old colours are pink, blood reds and ochre are not;
//   2. both palettes (the table's and the photosensitive seat's): no pink colour, none of the removed ones;
//   3. every glide between colours: drying, a glint leaving, the crumbling front nearing, at every step;
//   4. everything DRAWN: both looks, the table's levels 1 / 2 / 3, a still (reduced motion) seat, a splash that lives its whole life
//      and one cut while wet, in the open and in the see-through middle, tick by tick: no painted colour is pink, and no pixel as SHOWN
//      over a dark, a grey, a light and a white ground or over map colours (grass, sand, snow, wood, water) is pink;
//   5. the glass: with the shade a shown pixel is never lighter than its paint (so 2-4 hold on any map); WITHOUT it the dried stain over
//      a light map is pink (why the shade exists); main.mjs builds that glass;
//   6. the crumbling stage is still there to see: a dry front and flakes that stand out from the crust on a dark and on a light ground.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const dir = dirname(fileURLToPath(import.meta.url)), root = join(dir, "..");
const P = await import("../gore/plan.mjs");
const R = await import("../gore/raster.mjs");
const TN = await import("../gore/tone.mjs");
const { isPink, shown, onGround } = TN;
const T = P.TICK_MS;
const sm = (u) => u * u * (3 - 2 * u);      // raster.mjs smooth(): the gloss is 1 - sm(time)
const mix = (a, b, u) => a.map((v, i) => Math.round(v + (b[i] - v) * u));

/* ---------------- 1. the measure ---------------- */
{
  const pink = { salmon: [250, 128, 114], "light coral": [240, 128, 128], "dark salmon": [233, 150, 122], "hot pink": [255, 105, 180], "pale violet red": [219, 112, 147], "Indian red": [205, 92, 92], "rosy brown": [188, 143, 143],
    "the old crumbling front": [214, 128, 100], "the old wet lit rim": [255, 112, 100], "the old photosensitive glint": [222, 196, 190],
    "the old dried crust over a light map": [154, 124, 123], "the old dried crust over white": [185, 155, 153] };
  const not = { "pure red": [255, 0, 0], crimson: [220, 20, 60], firebrick: [178, 34, 34], maroon: [128, 0, 0], ochre: [204, 119, 34], peru: [205, 133, 63], amber: [236, 160, 72], white: [255, 255, 255], "warm white": [255, 242, 222], grey: [128, 128, 128], black: [0, 0, 0],
    "wet blood": [170, 16, 28], "dried crust": [96, 28, 24], sienna: [160, 82, 45] };
  ck(`the measure calls pink and salmon pink (${Object.entries(pink).filter(([, c]) => !isPink(...c)).map(([k]) => k).join(", ") || "all " + Object.keys(pink).length})`, Object.values(pink).every((c) => isPink(...c)));
  ck(`... and leaves red, blood, ochre, amber, white alone (${Object.entries(not).filter(([, c]) => isPink(...c)).map(([k]) => k).join(", ") || "all " + Object.keys(not).length})`, Object.values(not).every((c) => !isPink(...c)));
}

/* ---------------- 2. the palettes ---------------- */
const LOOKS = [["table", R.PAL, false], ["photosensitive", R.PAL_SAFE, true]];
{
  for (const [name, pal] of LOOKS) {
    const bad = [];
    for (const [st, roles] of Object.entries(pal)) for (const [role, c] of Object.entries(roles)) if (isPink(...c)) bad.push(`${st}.${role} ${c}`);
    ck(`${name} palette: no pink colour (${bad.join("; ") || "none of " + Object.values(pal).reduce((a, r) => a + Object.keys(r).length, 0)})`, bad.length === 0);
  }
  const all = LOOKS.flatMap(([, pal]) => Object.values(pal).flatMap((r) => Object.values(r).map((c) => c.join(","))));
  ck("the removed colours are in neither palette (salmon front, coral rim, rosy glints)", ![[214, 128, 100], [255, 112, 100], [255, 232, 224], [150, 112, 100], [222, 196, 190]].some((c) => all.includes(c.join(","))));
  ck("the front and the flakes are one colour in every stage of a look (a splash cut early crumbles the same)", LOOKS.every(([, pal]) => new Set(Object.values(pal).map((r) => r.crumb.join(","))).size === 1));
}

/* ---------------- 3. the glides ---------------- */
{
  for (const [name, pal] of LOOKS) {
    const bad = new Set();
    let steps = 0;
    const at = (d) => { const [A, B, u] = d < 0.5 ? [pal.wet, pal.drying, d * 2] : [pal.drying, pal.dried, d * 2 - 1]; const o = {}; for (const k of Object.keys(A)) o[k] = mix(A[k], B[k], u); return o; };
    const crust = pal.dried.b;
    for (let q = 0; q <= 64; q++) {
      const pq = at(q / 64);
      for (const [role, c] of Object.entries(pq)) {
        /* the glint's colours (spec, g1, g2) are read at the wet end only (raster.mjs glintC), the front's is one colour */
        if (role === "crumb" || role === "g1" || role === "g2" || role === "spec") { if (q === 0) { steps++; if (isPink(...c)) bad.add(`${role} ${c}`); } continue; }
        steps++; if (isPink(...c)) bad.add(`drying ${role} ${c}`);
        /* a glint leaving the blood under it; the dried middle flattening toward the crust colour; the front nearing */
        for (let g = 0; g <= 240; g++) { steps++; const v = R.glintC(c, pal.wet, 1 - sm(g / 240)); if (isPink(...v)) bad.add(`glint over ${role} ${v}`); }
        for (let u = 0; u <= 16; u++) { steps++; const v = mix(c, pq.b, u / 16); if (isPink(...v)) bad.add(`flattening ${role} ${v}`); }
        for (let u = 0; u <= 16; u++) { steps++; const v = R.frontC(c, crust, pq.crumb, u / 16); if (isPink(...v)) bad.add(`front over ${role} ${v}`); }
      }
    }
    ck(`${name} look: no step of any glide is pink: drying, a glint leaving, the crust flattening, the front nearing (${steps} steps${bad.size ? "; " + [...bad].slice(0, 4).join("; ") : ""})`, bad.size === 0);
  }
  /* the glides are still glides: their ends are the colours they join */
  const c = [170, 16, 28];
  ck("a glint starts as the warm white and ends as the blood under it; the front starts as the blood and ends as the ochre", R.glintC(c, R.PAL.wet, 1).join() === R.PAL.wet.spec.join() && R.glintC(c, R.PAL.wet, 0).join() === c.join() && R.frontC(c, R.PAL.dried.b, R.PAL.wet.crumb, 0).join() === c.join() && R.frontC(c, R.PAL.dried.b, R.PAL.wet.crumb, 1).join() === R.PAL.wet.crumb.join());
  let jump = 0;
  for (const cc of [R.PAL.wet.m, R.PAL.wet.b, R.PAL.wet.lit, R.PAL.wet.d]) for (let g = 0; g < 400; g++) { const a = R.glintC(cc, R.PAL.wet, 1 - sm(g / 400)), b = R.glintC(cc, R.PAL.wet, 1 - sm((g + 1) / 400)); for (let k = 0; k < 3; k++) jump = Math.max(jump, Math.abs(a[k] - b[k])); }
  ck(`a glint's way has no jump (400 even steps of time: the largest ${jump} levels <= 3)`, jump <= 3);
}

/* ---------------- 4. everything drawn ---------------- */
const g = P.grid(1600, 900, 1);
const sf = R.surface(g.w, g.h);
const NEUTRAL = []; for (let v = 0; v <= 255; v += 15) NEUTRAL.push([v, v, v]);
const MAPS = { grass: [86, 125, 70], sand: [214, 189, 148], snow: [235, 240, 245], wood: [120, 84, 56], water: [60, 110, 160], concrete: [150, 148, 142], paper: [244, 236, 214], night: [24, 26, 34] };
const GROUNDS = [...NEUTRAL, ...Object.values(MAPS)];
ck("the grounds the blood is judged on are not pink themselves", GROUNDS.every((c) => !isPink(...c)));
/* every distinct painted pixel (colour + alpha) of a splash's life, with the first moment it was seen */
function life(spec, { cutAt = Infinity, at = null } = {}) {
  const plan = P.bloodPlan(g, { seed: "pk", dir: 1.1, at: at ?? { fx: 0.24, fy: 0.3 }, ...spec });
  const it = { plan, t0: 0, cutAt };
  const end = P.endOf(plan), gone = Math.min(plan.life.gone, cutAt);
  const seen = new Map();
  let frames = 0;
  for (let k = 0; k * T <= end + T; k += k < 30 || k * T > gone - 200 ? 1 : 5) {
    R.render(sf, [it], k * T + 1);
    frames++;
    const a = sf.rgba, b = sf.box;
    if (!b) continue;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) { const o = (y * g.w + x) * 4; if (a[o + 3]) { const key = (a[o] << 24 | a[o + 1] << 16 | a[o + 2] << 8 | a[o + 3]) >>> 0; if (!seen.has(key)) seen.set(key, Math.round(k * T)); } }
  }
  R.render(sf, [], 0);
  return { seen, frames, plan };
}
const rgbOf = (key) => [key >>> 24, (key >>> 16) & 255, (key >>> 8) & 255, key & 255];
{
  let cases = 0, frames = 0, colours = 0;
  const paintBad = new Set(), shownBad = new Set();
  for (const [look, , safe] of LOOKS) for (const level of [1, 2, 3]) for (const base of [0.35, 1]) for (const mode of ["whole", "cut wet", "cut drying", "still", "middle"]) {
    const strength = P.scaled(base, level);
    const spec = { strength, safe, still: mode === "still", seed: `pk|${look}|${level}|${base}|${mode}` };
    const r = life(spec, { cutAt: mode === "cut wet" ? 420 : mode === "cut drying" ? 2600 : Infinity, at: mode === "middle" ? { fx: 0.5, fy: 0.5 } : null });
    cases++; frames += r.frames; colours += r.seen.size;
    for (const [key, ms] of r.seen) {
      const px = rgbOf(key);
      if (isPink(px[0], px[1], px[2])) paintBad.add(`${look} L${level} ${mode} @${ms}ms paint ${px.slice(0, 3)}`);
      for (const bg of GROUNDS) { const s = shown(px, bg).map(Math.round); if (isPink(...s)) { shownBad.add(`${look} L${level} ${mode} @${ms}ms ${px} over ${bg} = ${s}`); break; } }
    }
  }
  ck(`nothing PAINTED is pink: ${cases} splashes (both looks, levels 1-3, light blow and knock-down, whole life / cut wet / cut drying / still / in the middle), ${frames} drawings, ${colours} colours${paintBad.size ? ": " + [...paintBad].slice(0, 4).join("; ") : ""}`, paintBad.size === 0 && colours > 500);
  ck(`nothing SHOWN is pink over ${GROUNDS.length} grounds (black to white, grass, sand, snow, wood, water, concrete, paper, night)${shownBad.size ? ": " + shownBad.size + " e.g. " + [...shownBad].slice(0, 4).join("; ") : ""}`, shownBad.size === 0);
  /* the check sees a pink colour when there is one: the old front over the new picture */
  const old = [214, 128, 100, 110];
  ck("... the same test catches the old salmon front, painted or shown over a dark and over a light map", isPink(...old) && isPink(...shown(old, [200, 200, 200]).map(Math.round)) && isPink(...[old[0], old[1], old[2]]) && NEUTRAL.some((bg) => { const a = old[3] / 255; return isPink(...old.slice(0, 3).map((c, i) => Math.round(c * a + bg[i] * (1 - a)))); }));
}

/* ---------------- 5. the glass ---------------- */
{
  let lighter = 0, tries = 0, r = P.rng("glass");
  for (let i = 0; i < 20000; i++) { const c = (r() * 256) | 0, a = (r() * 256) | 0, bg = (r() * 256) | 0, v = onGround(c, a, bg); tries++; if (v > c + 1e-9 || v < Math.min(c, bg) - 1e-9) lighter++; }
  ck(`with the shade a shown channel lies between the darker of (ground, paint) and the paint: never lighter than the paint (${lighter} of ${tries})`, lighter === 0);
  ck("... over a ground darker than the paint it is plain alpha (a dark map looks as it did)", [[96, 110, 32], [170, 200, 10], [34, 255, 20]].every(([c, a, bg]) => Math.abs(onGround(c, a, bg) - (c * a + bg * (255 - a)) / 255) < 1e-9));
  /* why the shade exists: the dried crust at its settled alpha, plain alpha over a light map and over white, is pink */
  const crust = R.PAL.dried.b, a = (R.ALPHA[2] * R.SEE * (1 - R.LATE)) / 255;
  const plain = (bg) => crust.map((c) => Math.round(c * a + bg * (1 - a)));
  ck(`without the shade the dried crust over a light map is pink (plain alpha ${a.toFixed(2)}: ${plain(200)} over 200, ${plain(255)} over white); with it ${shown([...crust, a * 255], [255, 255, 255]).map(Math.round)}`, isPink(...plain(200)) && isPink(...plain(255)) && !isPink(...shown([...crust, a * 255], [255, 255, 255]).map(Math.round)));
  const src = readFileSync(join(root, "gore/main.mjs"), "utf8");
  ck("main.mjs builds that glass: a shade pane blended 'darken', put right after #board after the blood's pane (so under it), fed the blood's pixels at full alpha",
    /export const SHADE_BLEND = "darken";/.test(src) && /m\.wrap\.style\.mixBlendMode = SHADE_BLEND;/.test(src) && /const m = make\("ipu-gore-shade", zBoard\);[\s\S]{0,160}board\.after\(m\.wrap\);/.test(src)
    && src.indexOf('make("ipu-gore-shade"') > src.indexOf("if (name === \"blood\") { board.after(m.wrap)") && /buf\[o \+ 3\] = 255;/.test(src) && /if \(name === "blood"\) shade\(L\.sf\.rgba,/.test(src));
}

/* ---------------- 6. the crumbling stage is still there to see ---------------- */
{
  const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  for (const [look, pal, safe] of LOOKS) {
    const plan = P.bloodPlan(g, { strength: 0.8, seed: "front", dir: 0.3, at: { fx: 0.22, fy: 0.3 }, safe });
    const it = { plan, t0: 0 }, g0 = plan.life.gone, d0 = plan.life.dissolve;
    const res = {};
    for (const [gname, bg] of [["dark", [32, 32, 32]], ["light", [200, 200, 200]]]) {
      /* the flat crust as shown on this ground, at this splash's alpha */
      R.render(sf, [it], g0 - 50);
      let al = 0; for (let o = 3; o < sf.rgba.length; o += 4) if (sf.rgba[o]) { al = sf.rgba[o]; break; }
      const base = luma(shown([...pal.dried.b, al], bg));
      let front = 0, flakes = 0, body = 0, ticks = 0, lift = 0;
      for (let k = 0; k <= 12; k++) {
        R.render(sf, [it], g0 + 1 + k * (d0 / 12));
        const a = sf.rgba; let here = 0;
        for (let o = 0; o < a.length; o += 4) if (a[o + 3]) {
          const l = luma(shown([a[o], a[o + 1], a[o + 2], a[o + 3]], bg));
          if (l >= base + 12) { here++; lift = Math.max(lift, l - base); if (a[o] === pal.dried.crumb[0] && a[o + 1] === pal.dried.crumb[1] && a[o + 2] === pal.dried.crumb[2]) flakes++; else front++; } else body++;
        }
        if (here) ticks++;
      }
      res[gname] = { front, flakes, body, ticks, lift };
    }
    const ok = (v) => v.front + v.flakes > 200 && v.ticks >= 9 && v.lift >= 24;
    ck(`${look} look: the crumbling front and its flakes stand out from the crust on a dark ground (${res.dark.front + res.dark.flakes} px over the clearing, up to ${res.dark.lift.toFixed(0)} levels lighter, in ${res.dark.ticks} of 13 drawings) and on a light one (${res.light.front + res.light.flakes} px, ${res.light.lift.toFixed(0)} levels, ${res.light.ticks})`, ok(res.dark) && ok(res.light));
  }
  /* the front and the flakes are no weaker on a dark map than the salmon was: the ochre lifts the crust as much */
  const lift = (c) => luma(shown([...c, 112], [32, 32, 32])) - luma(shown([...R.PAL.dried.b, 112], [32, 32, 32]));
  ck(`the ochre front stands out from the crust on a dark map as much as the salmon did (${lift(R.PAL.dried.crumb).toFixed(1)} levels of luma against ${lift([214, 128, 100]).toFixed(1)})`, lift(R.PAL.dried.crumb) >= lift([214, 128, 100]));
}

console.log(`sweep gorepink: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
