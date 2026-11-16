// node scripts/sweep-checks/splashseat.mjs  -- SPLASHSEAT (2026-11-16): one roll, one picture on every seat, off every seat's panels.
// ADVS3 D1 + D13 (tag 161, live, the GM and a player with ONE window size and ONE view): the same strong / pushed / Reason roll's block stood
// right of the heroes against the roll card on the GM's seat and far left on the player's; the critical's caption ended on the roll card's
// edge and on the challenges' panel. The cause: each seat kept the block off ITS OWN panels (SPLASHCLEAR-1), which no other seat knows, so
// the canonical block was refused on one seat and each searched alone. Now the seats tell each other what stands on their screens
// (seat-share.mjs, stage.mjs seatReport, main.mjs shareSeat) and every seat places the block off the union, decided on the canonical seat.
// Checks:
//   P  the exchange itself (pure): a report is validated and bounded, the first per seat and roll counts, the union is the same whatever
//      order the reports came in, a box is set round the middle of another window, a seat that shows nothing adds nothing, wait() ends;
//   S1 two seats of one window and one view with different panels (the GM's scene list, map meter and director bar; the player's short
//      scene list), every board x every outcome: the same words at the same places and sizes;
//   S2 ... and where a clean place exists (not 'least') no drawn ink stands on any box either seat told, nor nearer than CLEAR px to it
//      (D13: the caption that ended on the roll card's edge; the chat column is told whole);
//   S3 the same with the player's view a few px off the GM's (camera drift inside the roller's cell): still off every told box;
//   S4 a window open on the player's seat only (a sheet beside the roller) moves the block on BOTH seats: the same picture, off the window;
//   S5 a player with a smaller window: each seat's block is off its own boxes (told boxes are set round each window's middle);
//   S6 without the exchange (a preview, a seat alone) a seat places as before: nothing told, its own panels kept off;
//   W  main.mjs: the list is sent before the dice report, the layout made ahead waits for the lists, the late stress line uses the roll's.
// Fails on tactics-integrated-161 (no exchange: S1 differs in 10 of 28); passes after.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as Lib from "./lib/splash-seat.mjs";
import * as Share from "../splash/seat-share.mjs";

const { seatPlay, seatTell, GS } = Lib;
let n = 0, f = 0;
const fails = [];
const ok = (c, msg) => { n++; if (!c) { f++; fails.push(msg); } };
const here = dirname(fileURLToPath(import.meta.url));

/* ---- P: the exchange ---- */
{
  const rep = (o, w = 1600, h = 900) => ({ v: Share.VERSION, w, h, o });
  ok(Share.clean(null) === null && Share.clean({ v: 99, w: 1600, h: 900, o: [] }) === null && Share.clean({ v: Share.VERSION, w: 50, h: 900, o: [] }) === null && Share.clean({ v: Share.VERSION, w: 1600, h: 900, o: "x" }) === null, "P1 a malformed report is refused");
  const c = Share.clean(rep([[10.4, 10.2, 300.9, 60], [0, 0, 4, 900], ["a", 1, 2, 3], [20, 20, 100, 50], [-50, 800, 5000, 2000]]));
  ok(c && c.o.length === 2 && c.o.every((q) => q.every((v) => v % Share.SNAP_PX === 0)) && c.o.some((q) => q[2] === 1600 && q[3] === 900), `P2 boxes are cut to the window, thin and held ones dropped, on the grid (${JSON.stringify(c?.o)})`);
  const many = Share.clean(rep(Array.from({ length: 200 }, (_, i) => [i * 7, 0, i * 7 + 20, 20 + i])));
  ok(many && many.o.length <= Share.MAX_RECTS, "P3 a report is bounded");
  ok(Share.note("p-a", "u1", rep([[10, 10, 300, 60]])) === true && Share.note("p-a", "u1", rep([[500, 500, 700, 700]])) === false, "P4 the first report of a seat for a roll counts");
  ok(Share.note("p-a", "", rep([])) === false && Share.note("", "u1", rep([])) === false && Share.note("p-a", "u9", { v: 1, w: "x" }) === false, "P4b a report without a roll, a seat or a shape is not kept");
  Share.note("p-a", "u2", rep([[1200, 20, 1500, 880]]));
  Share.note("p-b", "u2", rep([[1200, 20, 1500, 880]])); Share.note("p-b", "u1", rep([[10, 10, 300, 60]]));
  const ua = Share.unionFor("p-a", 1600, 900), ub = Share.unionFor("p-b", 1600, 900);
  ok(ua && ub && JSON.stringify(ua.rects) === JSON.stringify(ub.rects) && ua.rects.length === 2 && ua.seats === 2, "P5 the union is the same whatever order the reports came in");
  const us = Share.unionFor("p-a", 1366, 768);
  ok(us && us.rects.some((q) => q.l === 1200 - 117 && q.t === 0 && q.r === 1366 && q.b === 768), `P6 a box is set round the middle of another window and cut to it (${JSON.stringify(us?.rects)})`);
  Share.note("p-c", "u1", { v: Share.VERSION, none: true });
  const un = Share.unionFor("p-c", 1600, 900);
  ok(un && un.rects.length === 0 && un.seats === 0 && Share.unionFor("p-zz", 1600, 900) === null, "P7 a seat that shows nothing adds nothing; a roll nobody told has no list");
  ok(Share.complete("p-a", ["u1", "u2"]) && !Share.complete("p-a", ["u1", "u3"]), "P8 complete() reads the expected seats");
  let t = 0;
  const env = { now: () => t, sleep: (ms) => { t += ms; return Promise.resolve(); } };
  ok(await Share.wait("p-a", ["u1", "u3"], 300, env) === false && t >= 300 && t < 400, `P9 wait() gives up after its time (${t})`);
  t = 0;
  const w = Share.wait("p-d", ["u1"], 300, { now: () => t, sleep: () => new Promise(() => {}) });
  Share.note("p-d", "u1", rep([]));
  ok(await w === true, "P10 wait() ends as the last list comes in");
  for (const id of ["p-a", "p-b", "p-c", "p-d"]) Share.forget(id);
  ok(Share.unionFor("p-a", 1600, 900) === null, "P11 forget()");
}

/* ---- the seats ---- */
const UI_GM = { side: 48, nav: 160, vram: true, dock: true, party: true, card: true, col: true, pill: true };
const UI_P1 = { side: 48, nav: 32, dock: true, party: true, card: true, col: true };
const gm = { name: "gm", gm: true, k: 1, W: 1600, H: 900, zoom: 0.5, ui: UI_GM };
const p1 = { name: "p1", k: 1, W: 1600, H: 900, zoom: 0.5, ui: UI_P1 };
const BOARDS = ["warehouse", "live", "crowd", "empty"], OUTS = ["ordinary", "strong", "critical", "pushed", "miss", "stressed", "routine"];
const CLEAR = 6;   // px between drawn ink and a told box, where a clean place exists
const key = (d) => `${d.role}:${d.text}@${Math.round(d.x)},${Math.round(d.y)} S${d.S}`;
const boxes = (...reports) => reports.flatMap((r) => (r?.o ?? []).map(([l, t, r2, b]) => ({ l, t, r: r2, b })));
const near = (r, bs, pad) => { let w = 0; for (const d of r.drawn) for (const b of bs) { const ix = Math.min(d.r, b.r + pad) - Math.max(d.l, b.l - pad), iy = Math.min(d.b, b.b + pad) - Math.max(d.t, b.t - pad); if (ix > 0.5 && iy > 0.5) w = Math.max(w, Math.min(ix, iy)); } return w; };
const least = (r) => r.same?.moved === "least" || r.same?.moved === "swapped";

if (typeof seatTell !== "function") ok(false, "S the seats cannot tell their lists (no exchange in this tree)");
else {
  const told = { GM: await seatTell(gm), P1: await seatTell(p1) };
  ok(told.GM?.o?.length > told.P1?.o?.length && told.P1.o.length >= 4, `S0 the two seats tell different lists (${told.GM?.o?.length}, ${told.P1?.o?.length})`);
  const col = told.P1.o.find((q) => q[3] - q[1] > 700 && q[0] > 1100);
  ok(!!col, "S0b the chat pop-up column is told whole");
  const all = boxes(told.GM, told.P1);
  let clean = 0;
  for (const bd of BOARDS) for (const outcome of OUTS) {
    const a = await seatPlay({ seat: gm, bd, outcome, told }), b = await seatPlay({ seat: p1, bd, outcome, told });
    ok(JSON.stringify(a.drawn.map(key)) === JSON.stringify(b.drawn.map(key)), `S1 ${bd}/${outcome}: the GM's block is not the player's (${a.same?.moved}/${a.same?.via} | ${b.same?.moved}/${b.same?.via}) ${a.drawn.map(key).join(" ")} | ${b.drawn.map(key).join(" ")}`);
    ok(a.same?.told === 2 && b.same?.told === 2, `S1b ${bd}/${outcome}: both seats placed from two lists (${a.same?.told}, ${b.same?.told})`);
    for (const [nm, r] of [["gm", a], ["p1", b]]) {
      if (least(r)) continue;
      clean++;
      const w = near(r, all, CLEAR);
      ok(w === 0, `S2 ${bd}/${outcome}/${nm}: ink on or within ${CLEAR} px of a told box (${w.toFixed(1)} px deep, ${r.same?.moved})`);
    }
  }
  ok(clean >= 30, `S2b a clean place was found in most cases (${clean} of 56 seat views)`);

  /* S3: the player's view a few px off the GM's */
  for (const px of [9, 20]) for (const bd of ["warehouse", "empty"]) for (const outcome of ["ordinary", "strong", "miss", "routine"]) {
    const off = { x: 0.4 + px / (GS * 0.5), y: 0.2 - px / (2 * GS * 0.5) };
    const b = await seatPlay({ seat: p1, bd, outcome, off, told });
    if (least(b)) continue;
    ok(near(b, all, 0) === 0, `S3 ${bd}/${outcome} +${px} px: ink on a told box on the drifted seat (${near(b, all, 0).toFixed(1)} px deep, ${b.same?.moved})`);
  }

  /* S4: a window open on the player's seat only */
  {
    const p1w = { ...p1, ui: { ...UI_P1, wins: [[110, 190, 400, 300]] } };
    const toldW = { GM: told.GM, P1: await seatTell(p1w) };
    const win = toldW.P1.o.find((q) => q[0] <= 110 && q[2] >= 510 && q[1] <= 190 && q[3] >= 490);
    ok(!!win, `S4a an open window is told (${JSON.stringify(toldW.P1.o)})`);
    const dlg = await seatTell({ ...p1, ui: { ...UI_P1, wins: [[600, 300, 400, 300, "roll-dialog"]] } });
    ok(JSON.stringify(dlg.o) === JSON.stringify(told.P1.o), "S4b the roll's own dialog is never told");
    const allW = boxes(toldW.GM, toldW.P1);
    for (const bd of BOARDS) for (const outcome of ["ordinary", "strong", "miss", "routine"]) {
      const a = await seatPlay({ seat: gm, bd, outcome, told: toldW }), b = await seatPlay({ seat: p1w, bd, outcome, told: toldW });
      ok(JSON.stringify(a.drawn.map(key)) === JSON.stringify(b.drawn.map(key)), `S4 ${bd}/${outcome}: with the player's window the two blocks differ`);
      if (!least(a)) ok(near(a, allW, 0) === 0, `S4c ${bd}/${outcome}: the GM's block on the player's window or a panel (${near(a, allW, 0).toFixed(1)} px deep, ${a.same?.moved})`);
    }
  }

  /* S5: a player with a smaller window */
  {
    const small = { name: "p-small", k: 1, W: 1366, H: 768, zoom: 0.5, ui: UI_P1 };
    const toldS = { GM: told.GM, P1: await seatTell(small) };
    ok(toldS.P1.w === 1366 && toldS.P1.h === 768, "S5a a report carries its window");
    for (const bd of ["warehouse", "empty"]) for (const outcome of ["ordinary", "strong", "miss", "routine"]) {
      const a = await seatPlay({ seat: gm, bd, outcome, told: toldS }), b = await seatPlay({ seat: small, bd, outcome, told: toldS });
      if (!least(a)) ok(near(a, boxes(toldS.GM), 0) === 0, `S5 ${bd}/${outcome}: the GM's block on its own box (${a.same?.moved})`);
      if (!least(b)) ok(near(b, boxes(toldS.P1), 0) === 0, `S5 ${bd}/${outcome}: the small window's block on its own box (${b.same?.moved})`);
    }
  }

  /* S6: without the exchange, as before */
  for (const outcome of ["ordinary", "strong"]) {
    const a = await seatPlay({ seat: gm, bd: "warehouse", outcome });
    ok(!a.same?.told, `S6 ${outcome}: a seat alone places from its own panels (told ${a.same?.told})`);
    if (!least(a)) ok(near(a, boxes({ o: told.GM.o.filter((q) => !(q[3] - q[1] > 700)) }), 0) === 0, `S6b ${outcome}: a seat alone still keeps off its own panels`);
  }
}

/* ---- W: the wiring (main.mjs) ---- */
{
  const src = readFileSync(join(here, "..", "splash", "main.mjs"), "utf8"), stage = readFileSync(join(here, "..", "splash", "stage.mjs"), "utf8");
  ok(/if \(!p\) \{\s*shareSeat\(message\);[^\n]*\n\s*p = \(document\.visibilityState === 'hidden' \? Promise\.resolve\(\) : waitDice\(message\)\)/.test(src), "W1 a seat sends its list before its dice report (settled() begins with it)");
  ok(/msg\?\.k === SHARE_K\) Share\.note\(msg\.id, msg\.u, msg\.r\)/.test(src), "W2 a list heard on the socket is kept (validated by Share.note)");
  ok(/Share\.wait\(id, seatsFor\(message\), SHARE_WAIT_MS[^\n]*\.then\(\(\) => prepareAhead\(message, rd, 'idle'\)/.test(src), "W3 the layout made ahead waits for the seats' lists");
  ok(/Stage\.playStress\([^\n]*shareId: message\.id/.test(src), "W4 the late stress line is placed from the roll's list");
  ok(/none: true/.test(src) && /playsHere\(message\) && document\.visibilityState !== 'hidden' && Stage\.lettersOn\(\)/.test(src), "W5 a seat that shows nothing says so");
  ok(/shareId: opts\.shareId \?\? opts\.momentId \?\? null/.test(stage) && /let own = loc\.told \? null :/.test(stage), "W6 the stage takes the roll's list and decides on the canonical seat");
}

for (const m of fails.slice(0, 40)) console.log("FAIL", m.slice(0, 600));
if (fails.length > 40) console.log(`... and ${fails.length - 40} more`);
console.log(`splashseat: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
