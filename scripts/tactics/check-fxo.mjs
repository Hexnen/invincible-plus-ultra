// node scripts/tactics/check-fxo.mjs -- fixer FXO (ver11 findings U163, U164), 2026-11-12.
//   U163  the actions' row of the dock never wraps (the star never falls to a line of its own), in every room a real table could have:
//         small and scaled windows, a fresh load or a window resized mid-fight. The guard is a matrix of rooms x sizes x bars, with the
//         widths measured live on lane 5 (the widest bar of each seat) and with bars that keep growing, so a new button cannot bring
//         the wrap back unnoticed (it came back once already: P5's door button, then the star and the scene group).
//   U164  the end-of-fight summary: a name breaks only between words; the list shows as many rows as its place has room for.
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as Lay from "./ui/layout-pure.mjs";

const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const dock = read("./ui/dock.mjs"), uiCss = read("../../styles/tactics-ui.css");

/* ---- U163: the pure rule */
{
  ok(typeof Lay.barFit === "function", "U163: layout-pure has the fit of the bar (barFit)");
  const fit = (...a) => (typeof Lay.barFit === "function" ? Lay.barFit(...a) : { tight: -1, scale: 0, width: 0 });
  /* the bars measured live (unscaled px, one row; ver11 scene, PL): the GM driving an NPC (the most actions) and a player's hero */
  const BARS = {
    gm: { natural: 1000, inner: 598, acts: 407 },
    p1: { natural: 984, inner: 567, acts: 407 },
    /* ver11's bar at the moment of 47-layout-1366-gm.png: two actions more (the scene group had four), 12 + the star */
    ver11: { natural: 1080, inner: 598, acts: 487 },
  };
  /* the actions' row in window px, as the stylesheet draws it (the bar's padding and the plate's edge are FIT.pad) */
  const row = (b, s) => (b.acts + (Lay.FIT?.pad ?? 26)) * s;
  /* rooms a real table could have: the bar's room at each window (window width less the party column, the players list, the sidebar
     or the chat box; measured live on lane 5 at 1366 x 768: GM 703, player 715), and the user's size of the surfaces (U62 slider) */
  const rooms = [280, 362, 420, 426, 480, 520, 600, 618, 645, 656, 704, 768, 820, 900, 965, 1002, 1100, 1200, 1322, 1500, 1700];
  const sizes = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.4];
  let wraps = [], shrunk = [], lost = [];
  for (const [seat, b0] of Object.entries(BARS)) for (const grow of [0, 40, 80, 160]) {
    /* grow: buttons the bar may still gain (two to four more actions) */
    const b = { natural: b0.natural + grow, inner: b0.inner, acts: b0.acts + grow };
    for (const avail of rooms) for (const k of sizes) {
      const f = fit(null, avail, k, b, 32);
      const minScale = Math.min(Lay.FIT?.min ?? 0.8, k);
      /* the actions' row fits whenever it can at the floor of the sizes */
      if (f.tight > 0 && row(b, minScale) <= avail && row(b, f.scale) > avail + 0.5) wraps.push(`${seat}+${grow} room ${avail} @${k}: row ${Math.round(row(b, f.scale))}`);
      if (!(f.scale <= k + 1e-9) || !(f.scale >= minScale - 1e-9)) shrunk.push(`${seat}+${grow} room ${avail} @${k}: scale ${f.scale}`);
      /* the user's size is kept wherever the actions' row fits at it (nothing smaller than it must be) */
      if (row(b, k) <= avail && f.scale !== k) lost.push(`${seat}+${grow} room ${avail} @${k}: drawn at ${f.scale}`);
    }
  }
  eq(wraps.slice(0, 5), [], "U163: the actions' row never wraps where the floor size lets it fit (rooms x sizes x growing bars)");
  eq(shrunk.slice(0, 5), [], "U163: the bar is never drawn bigger than the user's size nor smaller than the slider's floor");
  eq(lost.slice(0, 5), [], "U163: the user's size is kept wherever the actions' row fits at it");

  /* the reported case: 1366 x 768 at 140 % (ver11 47-layout-1366-gm.png): the star stays on the actions' row */
  const g = fit(null, 704, 1.4, BARS.ver11, 32), p = fit(null, 768, 1.4, BARS.p1, 32);
  ok(g.tight > 0 && row(BARS.ver11, g.scale) <= 704 && g.scale > 1.3, `U163: ver11's GM bar at 1366 x 768 @140 % (room 704): actions and star on one row, drawn just a little smaller (tight ${g.tight}, scale ${g.scale}, row ${Math.round(row(BARS.ver11, g.scale))} of 704)`);
  ok(row(BARS.ver11, 1.4) > 704 && Lay.steadyShape(null, 704, BARS.ver11.natural * 1.4, BARS.ver11.inner * 1.4, 32 * 1.4).tight > 0, "U163: ... the same bar at 140 % is wider than that room: the old rule wrapped it (the defect as reported)");
  eq([p.tight, p.scale], [2, 1.4], "U163: the player's bar at 1366 x 768 @140 % (room 768) is as before: its actions fit at 140 %, three lines (actions / unit / tail)");
  const s1024 = fit(null, 426, 1.4, BARS.p1, 32);
  ok(s1024.tight === 2 && row(BARS.p1, s1024.scale) <= 426, `U163: 1024 x 768 @140 % (room 426, seen live wrapping the star to a line of its own): actions on one row at ${s1024.scale}`);
  /* the shapes at sizes that already worked are as before: one row at 1920 / 1600 at 100 % (rooms measured live) */
  eq([fit(null, 1322, 1, BARS.p1, 32).tight, fit(null, 1322, 1, BARS.p1, 32).scale], [0, 1], "U163: the player at 1920 x 1080 @100 % (room 1322): one row, the user's size (as before)");
  eq([fit(null, 965, 1, BARS.gm, 32).tight, fit(null, 965, 1, BARS.gm, 32).scale], [1, 1], "U163: the GM at 1920 x 1080 @100 % beside the desk (room 965): two rows at the user's size (as before)");
  eq([fit(null, 1002, 1, BARS.p1, 32).tight, fit(null, 645, 1, BARS.gm, 32).tight, fit(null, 645, 1, BARS.gm, 32).scale], [1, 1, 1], "U163: 1600 x 900 @100 % (rooms 1002 / 645): two rows at the user's size (as before)");
  /* ver11 / U163: the old memory kept window px, so a resize that met the old size for one frame (the window first, the size of the
     surfaces a moment later) left a room marked "too narrow" for the session: at 1920 @100 % after 1024 @140 % the player's bar stayed
     in two rows (seen live: SAME-p1-1920-100-before vs -before-fresh). The new memory keeps the bar's own px: a size met in passing
     changes nothing */
  const m2 = new Map(); fit(m2, 1322, 1.4, BARS.p1, 32);
  eq(fit(m2, 1322, 1, BARS.p1, 32).tight, 0, "U163: a room met once at another size keeps its own answer at this size (resize mid-fight)");
  const m3 = new Map(); Lay.steadyShape(m3, 1322, BARS.p1.natural * 1.4 + 2, BARS.p1.inner * 1.4, 32 * 1.4);
  eq(Lay.steadyShape(m3, 1322, BARS.p1.natural + 2, BARS.p1.inner, 32).tight, 1, "U163: ... the old rule did not (the room stayed two rows)");
  /* the narrow forms are those of before the regression: tight 1 (actions over unit + tail) where the unit and the tail fit, else 2 */
  eq(fit(null, 900, 1, BARS.gm, 32).tight, 1, "U163: actions over the unit and the tail where both rows fit");

  /* fresh load = resized mid-fight: the same room gives the same answer; the widest bar a room held decides (U148) */
  const memo = new Map();
  const a = fit(memo, 704, 1.4, BARS.ver11, 32), b = fit(memo, 704, 1.4, { natural: 600, inner: 300, acts: 300 }, 32);
  eq([b.tight, b.scale], [a.tight, a.scale], "U163: within a room a narrower bar later keeps the shape and the size (no change under the pointer)");
  eq([fit(new Map(), 704, 1.4, BARS.ver11, 32).scale], [a.scale], "U163: a fresh load in that room gives the same size");
  /* the old rule is kept for its own checks (check-uxa U148) */
  eq(Lay.steadyShape(null, 1000, 900, 500, 0).tight, 0, "U148: steadyShape still answers");
}

/* ---- U163: the dock as wired */
{
  ok(/Lay\.barFit\(shapes, avail, k, \{ natural: natU, inner, acts \}, SLACK\)/.test(dock), "U163: the dock decides shape and size through barFit");
  ok(/const acts = barEl\.querySelector\("\.itd-acts"\)\?\.offsetWidth/.test(dock), "U163: the actions' row is measured in one row (before data-tight is set)");
  ok(/barSlot\.style\.setProperty\("--ita-scale", String\(kb\)\)/.test(dock) && /barSlot\.style\.removeProperty\("--ita-scale"\)/.test(dock), "U163: the size is set on the bar's own place only (the cards and the line keep the user's size)");
  ok(/const barH = barEl \? barEl\.offsetHeight \* kb : \(last\?\.d\?\.who \? 60 \* k : 0\)/.test(dock) && /pe\.offsetWidth \* kb/.test(dock), "U163: the bar's and the panel's lengths are read at the size they are drawn at");
  ok(/stack\?\.parentElement\?\.style\.cssText/.test(dock.slice(dock.indexOf("function outcome()"), dock.indexOf("function placeSlots(rec)"))), "U163: the bar's size is part of a placement's outcome (P2-1 skip)");
  ok(/\.itd-stack \{[^}]*zoom: var\(--ita-scale, 1\)/.test(uiCss), "U163: the bar's stack is drawn at --ita-scale (the nearest one: the bar's place, else the body)");
  ok(/\[data-tight\] \.itd-acts \{[^}]*flex-wrap: wrap/.test(uiCss), "U163: the actions may still wrap as a last resort below the floor (never silently cut)");
}

/* ---- U164: the end-of-fight summary */
{
  const rule = (sel) => (uiCss.match(new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`)) ?? [])[1] ?? "";
  const n = rule("#invincible-tactics-dock .ita-sum-n"), rows = rule("#invincible-tactics-dock .ita-sum-rows");
  ok(!/overflow-wrap: anywhere|word-break: break-all/.test(n) && /min-width: min-content/.test(n), "U164: a name breaks only between words and is never narrower than its longest word");
  ok(/-webkit-line-clamp: 2/.test(n), "U161: a long name still takes a second line");
  ok(!/max-height: 236px/.test(rows) && /max-height: min\(340px, calc\(var\(--its-h/.test(rows), "U164: the list takes the room of its place (eight rows of a fight fit), then scrolls");
  ok(/\.ita-sum-row \{[^}]*flex-wrap: wrap/.test(uiCss), "U164: where the name's longest word leaves no room, the counts go under the name");
}
done("check-fxo");
