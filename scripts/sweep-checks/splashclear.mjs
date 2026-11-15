// node scripts/sweep-checks/splashclear.mjs  -- SPLASHCLEAR (2026-11-15): the roll splash keeps off what the table must still see.
// ADVS2 D4 (live): the ordinary word over the GM's map meter and scene list, "1 IN 1296" on the challenges' panel, the critical's word over the
// map's numbered zone badges 2 and 5. Before, the screen layer drew over a seat's own panels on purpose (SAMEPIC-3) and the splash never read
// the zone badges. Now (stage.mjs localScreen: own panels at OWN_W; zoneBadges: shared obstacles; letter-plan.mjs seatPlace: a seat with no
// clean place in its band looks again in its whole free view before it lies on anything; the owner: a seat that cannot show a block clean may
// show it farther away but clean).
// Checks, over seats x boards (empty, The Warehouse, the live Warehouse with zone badges and a hidden token, crowd) x every outcome x layers:
//   C1 on the screen layer no letter, line or gauge lies on a seat's own panel (scene list, map meter, challenges, party cards, desk),
//      unless that seat logged 'least' (nothing clean anywhere: then the weights decide, a token before a panel); C1b a chat card that
//      popped up on one seat never moves its block (check-fxld F4): under the block it steps back (faded) for the moment;
//   C2 no part lies on a zone badge every seat sees, on any seat and layer, unless 'least' (C2b: the badges in the zones' corners);
//   C3 a seat that moved for its panels keeps the table's words, sizes and ranks (the arrangement itself: splashsame S1..S4);
//   C4 the crowded board's critical on the big window (1920 x 1080) is clean: before it lay on the pin (the wider room).
// Fails on tactics-integrated-147 (70 of 1356: the screen block on the GM's scene list and map meter, on the badges, the crowd's critical
// on the big window); passes after.
import { seatPlay, SEATS } from "./lib/splash-seat.mjs";

let n = 0, f = 0;
const fails = [];
const ok = (c, msg) => { n++; if (!c) { f++; fails.push(msg); } };
const ar = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
const R = (q) => ({ l: q.left, t: q.top, r: q.right, b: q.bottom });
/* a seat's own panels (the edge bars and the sidebar are its view's edge, kept by the band) */
const PANELS = ["#scene-navigation li", ".mm-vram", "#ich-dock", "#invincible-party li", "#invincible-tactics-desk:not(.igd-collapsed) .igd"];
/* what pops up on one seat for a moment (a chat card the roll popped up): it never moves the block (check-fxld F4, SAMEPIC), it steps back */
const POPUPS = ["#chat-notifications .chat-log > li"];
const LAYERS = ["screen", "overlay"], BOARDS = ["empty", "warehouse", "live", "crowd"];
const OUTS = ["routine", "miss", "ordinary", "strong", "critical", "pushed", "stressed"];
const R0 = {};
for (const layer of LAYERS) for (const bd of BOARDS) for (const out of OUTS) for (const seat of Object.keys(SEATS)) {
  const r = await seatPlay({ seat, layer, bd, outcome: out });
  R0[`${layer}/${bd}/${out}/${seat}`] = r;
  const tag = `${layer}/${bd}/${out}/${seat}`, least = r.same?.moved === "least";
  const parts = [...r.drawn.map((d) => ({ role: d.role, world: d.world, q: { l: d.l, t: d.t, r: d.r, b: d.b } })), ...(r.gauges ?? []).map((q) => ({ role: "gauge", world: false, q }))];
  if (!parts.length) continue;
  /* C1: the screen layer's block off this seat's own panels (a map-layer block is the board's: its panels yield, MAPSEAT-2) */
  if (parts.every((p) => !p.world)) for (const sel of PANELS) {
    const v = r.ui[sel];
    if (!v) continue;
    for (const q of (Array.isArray(v) ? v : [v]).map(R)) {
      const c = parts.reduce((s, p) => s + ar(p.q, q), 0);
      if (!least) ok(c <= 1, `C1 ${tag}: the block lies on the seat's ${sel} (${Math.round(c)} px2, ${r.same?.moved})`);
    }
  }
  /* C1b: a pop-up under a screen block steps back (faded) while the block is up */
  if (parts.every((p) => !p.world)) for (const sel of POPUPS) {
    const v = r.ui[sel];
    if (!v) continue;
    const c = (Array.isArray(v) ? v : [v]).map(R).reduce((s, q) => s + parts.reduce((s2, p) => s2 + ar(p.q, q), 0), 0);
    if (c > 1) ok(r.yielded.includes(sel), `C1b ${tag}: the block lies on the seat's ${sel} (${Math.round(c)} px2) and it did not step back`);
  }
  /* C2: zone badges every seat sees (the parts' boxes here are the engine's HOLD boxes, a few px wider than the ink the planner keeps off:
     a graze of that rim, under 12 % of the badge, leaves the number whole; before, the critical's word stood on half of badge 2) */
  for (const q of r.badges ?? []) {
    const c = parts.reduce((s, p) => s + ar(p.q, q), 0);
    if (!least) ok(c <= 0.12 * ar(q, q), `C2 ${tag}: the block lies on the zone badge ${q.id ?? ""} (${Math.round(c)} px2, ${r.same?.moved})`);
  }
}
/* C2b: badges in the zones' corners (the comic looks' default; live the Warehouse has them there): read where moinen-maps puts them */
for (const layer of LAYERS) for (const out of OUTS) for (const seat of Object.keys(SEATS)) {
  const r = await seatPlay({ seat, layer, bd: "live", outcome: out, badgePlace: "corner" });
  if (r.same?.moved === "least") continue;
  const parts = [...r.drawn.map((d) => ({ l: d.l, t: d.t, r: d.r, b: d.b })), ...(r.gauges ?? [])];
  for (const q of r.badges) { const c = parts.reduce((s, p) => s + ar(p, q), 0); ok(c <= 0.12 * ar(q, q), `C2b ${layer}/live/${out}/${seat}: the block lies on a corner zone badge (${Math.round(c)} px2, ${r.same?.moved})`); }
}
/* C3: a seat that moved its screen block for its panels keeps the table's words and their relative sizes (against the empty seat's) */
const wordOf = (r) => r.drawn.find((d) => d.role === "word");
for (const bd of BOARDS) for (const out of OUTS) {
  const ref = R0[`screen/${bd}/${out}/p1`], g = R0[`screen/${bd}/${out}/gm`];
  if (!ref?.drawn.length || !g?.drawn.length || g.drawn.some((d) => d.world) || ref.drawn.some((d) => d.world)) continue;
  ok(g.drawn.map((d) => d.text).join("|") === ref.drawn.map((d) => d.text).join("|"), `C3 screen/${bd}/${out}: the GM's lines differ from the player's`);
  const w = wordOf(g), w0 = wordOf(ref);
  if (w && w0) for (const d of g.drawn) { const d0 = ref.drawn.find((x) => x.role === d.role); if (d0) ok(Math.abs(d.S / w.S - d0.S / w0.S) <= 0.04 * (d0.S / w0.S) + 0.01, `C3 screen/${bd}/${out}: ${d.role} ${(d.S / w.S).toFixed(3)} of the word on gm, ${(d0.S / w0.S).toFixed(3)} on p1`); }
}
/* C4: the crowded board's critical on the big window: clean (no pin, no token but the rim the band allows) */
for (const layer of LAYERS) {
  const r = R0[`${layer}/crowd/critical/big`];
  ok(r.same?.moved !== "least", `C4 ${layer}/crowd/critical/big: no clean place found (${r.same?.moved})`);
}
for (const m of fails.slice(0, 40)) console.log("FAIL", m);
if (fails.length > 40) console.log(`... and ${fails.length - 40} more`);
console.log(`splashclear: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
