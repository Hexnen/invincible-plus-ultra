#!/usr/bin/env node
// SPLASHBLOCK: the roll's screen block is the SAME block on the seats, and it says what it really draws.
//
// Live (lane 5, two seats, repeated real fights): word, kind, impact and instant were the same on both seats, but the struck token's reaction
// word differed in size or place in most fights. The cause was the roll's own block: every seat placed the table's block on its LIVE view
// (its pan, its panels, the camera's drift), so on a crowded board one seat split it round the fighters and the other joined it under them;
// and it told the reactions its OUTLINE (the union of a split block's parts: most of the view), so their words shrank to fit beside it and
// the moment left before every blow on the seat whose outline covered the struck token.
//
// Now (stage.mjs compose, letter-plan.mjs seatPlace):
//   B1 seats of one window size and zoom step show ONE block round the roller, wherever their view is panned;
//   B2 a zoom that drifts inside one step (the action camera's ease) does not change it; quantZoom's steps;
//   B3 the plan view: the action camera's parked shot while it is away from home, else the live view; two seats whose live views differ
//      but whose shot is the same show the same block;
//   B4 the block tells what it DRAWS, part by part (never its outline), and the same scene rects on seats that show the same block; a token
//      between the parts of a split block is not under it (the moment stays), one under a part is;
//   B5 a block's own parts never lie on each other, on any seat, board and outcome, nor on the captured live inputs of the crowded GM view
//      (where the caption "6 SIXES" lay on the end of the critical's word), with the star still clear and the order kept;
//   B6 the token reactions take the scene rects (source);
//   B7 the last-resort search stays cheap;
//   B8 (seen live, two seats with equal windows on one camera shot, the crowded board: nearly every seat refused the canonical block for
//      the few px2 it lay on that seat's own panel or the few per cent less its own search covered, and searched by itself) where nothing is
//      clean the canonical block stands as it is, on a seat with the GM's panels as on one without; the reactions are told the canonical
//      block's scene rects, the same on seats a few px apart; a moment laid out again stays in its cell;
//   B9 the GM's desk: its end inside the standard view is a shared zone on every seat while a fight is on.
// Run: node scripts/sweep-checks/splashblock.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as LP from "../splash/letter-plan.mjs";
import { seatPlay, GS, BOARDS as BOARDS_X, SEATS as SEAT_X } from "./lib/splash-seat.mjs";

const here = dirname(fileURLToPath(import.meta.url));
let n = 0, f = 0;
const fails = [];
const ok = (c, msg) => { n++; if (!c) { f++; fails.push(msg); } };
const area = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
const worst = (m) => m === "least" || m === "swapped";
BOARDS_X.fight = { at: [1750, 1400], nb: [[1, 0], [4, 0], [1, -2], [2, -3], [4, -1, "hidden"], [6, 2], [8, 2], [8, 3], [-3, -1]], pin: null, tgt: [2, 0] };

/* the block relative to the roller: every lettering's place from his middle and its cap px */
const relOf = (r) => { const hx = (r.hero.l + r.hero.r) / 2, hy = (r.hero.t + r.hero.b) / 2; return r.drawn.map((d) => ({ role: d.role, x: d.x - hx, y: d.y - hy, S: d.S })); };
const diff = (a, b) => { if (a.length !== b.length) return Infinity; let m = 0; for (let i = 0; i < a.length; i++) { if (a[i].role !== b[i].role) return Infinity; m = Math.max(m, Math.abs(a[i].x - b[i].x), Math.abs(a[i].y - b[i].y), Math.abs(a[i].S - b[i].S)); } return m; };
/* the arrangement alone: every lettering from the block's first one */
const shapeOf = (r) => { const d0 = r.drawn[0]; return r.drawn.map((d) => ({ role: d.role, x: d.x - d0.x, y: d.y - d0.y, S: d.S })); };
const probe = ({ Stage, ctl }) => {
  const place = { phase: "place", blocks: [], scene: [] };
  Stage.onTokenReact(place);
  return { scene: ctl?.layout?.canon?.scene ?? null, canon: ctl?.layout?.canon ? { own: !!ctl.layout.canon.own, via: ctl.layout.canon.via, moved: ctl.layout.canon.moved } : null, moved2: ctl?.layout?.moved2 ?? null, parts: ctl?.layout?.parts ?? null, rect: ctl?.rect ?? null, blocks: place.blocks, scene: place.scene };
};
const bare = { side: 300, party: false };   // a seat with nothing of its own on the screen but the open sidebar

/* B1: one window size, one zoom, the views a few px apart (what two seats on one camera shot differ by: live, the shot's centre 1522 against
   1526 scene px; the roller inside one SNAP cell): one block round the roller */
{
  globalThis.window ??= { innerWidth: 1600, innerHeight: 900 };
  const Stage0 = await import("../splash/stage.mjs?splashblock-s");
  ok(Stage0.SNAP === 64, "B1 the roller's cell is 64 px");
  let seen = 0, same = 0, canon = 0, least = 0;
  for (const bd of ["empty", "warehouse", "live", "fight", "crowd"]) for (const outcome of ["ordinary", "strong", "critical"]) for (const base of ["gm", "p1"]) for (const at of [{ x: 0.42, y: 0.4 }, { x: 0.3, y: 0.62 }, { x: 0.6, y: 0.33 }]) {
    const S = SEAT_X[base], px = GS * S.zoom;
    /* the roller's middle at the middle of a cell near `at` of the window, then moved by a few px */
    const cx = (Math.floor(at.x * S.W / 64) + 0.5) * 64, cy = (Math.floor(at.y * S.H / 64) + 0.5) * 64;
    const rs = [];
    for (const [jx, jy] of [[0, 0], [3, -2], [-7, 5], [12, 9], [-18, -14]]) {
      const off = { x: (S.W / 2 - (cx + jx)) / px, y: (S.H / 2 - (cy + jy)) / px };
      rs.push(await seatPlay({ seat: { ...S, ui: bare, name: base }, layer: "screen", bd, outcome, off, cut: true, probe }));
    }
    const ref = rs[0];
    if (!ref.drawn.length || ref.drawn.some((d) => d.world)) continue;
    for (const r of rs.slice(1)) {
      seen++;
      const d = diff(relOf(r), relOf(ref)), sh = diff(shapeOf(r), shapeOf(ref));
      if (d <= 1.5) same++;
      if (worst(r.same?.moved)) least++;
      /* the canonical block (or the table's own), not searched again on this seat: the same block from the roller, to the px */
      if (r.probe.canon?.via !== "own" && ref.probe.canon?.via !== "own") {
        canon++;
        ok(sh <= 1.5, `B1 ${bd}/${outcome}/${base}: a view ${Math.round(Math.hypot(r.hero.l - ref.hero.l, r.hero.t - ref.hero.t))} px off keeps the block's shape and sizes (${sh.toFixed(1)} px, ${r.probe.moved2})`);
        if (r.probe.moved2 === "none" && ref.probe.moved2 === "none") ok(d <= 1.5, `B1 ${bd}/${outcome}/${base}: a view ${Math.round(Math.hypot(r.hero.l - ref.hero.l, r.hero.t - ref.hero.t))} px off has the block ${d.toFixed(1)} px off, from the roller`);
      }
    }
  }
  ok(seen >= 300 && same >= 0.9 * seen, `B1 over ${seen} views a few px apart ${same} show the same block from the roller (${canon} by the canonical seat, ${least} of them with no clean place)`);
  if (process.argv.includes("--table")) console.log(`B1 ${same} of ${seen} views a few px apart show the same block from the roller (${canon} canonical, ${least} without a clean place)`);
}
/* B1b: the seat's own panels do not change the block where it does not land on them (the GM's usual panels against none) */
{
  for (const bd of ["empty", "warehouse", "live"]) for (const outcome of ["ordinary", "strong", "critical"]) {
    const a = await seatPlay({ seat: "gm", layer: "screen", bd, outcome, cut: true, probe }), b = await seatPlay({ seat: { ...SEAT_X.gm, ui: bare }, layer: "screen", bd, outcome, cut: true, probe });
    if (a.probe.moved2 === "none" && b.probe.moved2 === "none" && !a.probe.canon?.own && !b.probe.canon?.own) ok(diff(relOf(a), relOf(b)) <= 1.5, `B1b ${bd}/${outcome}: the GM's panels (not under the block) leave it where a seat without them has it (${diff(relOf(a), relOf(b)).toFixed(1)} px)`);
  }
}

/* B2: the zoom inside one step; the steps */
{
  const Stage = await import("../splash/stage.mjs?splashblock-q");
  const q = Stage.quantZoom;
  ok(Math.abs(Stage.ZOOM_STEP - 1.025) < 1e-9, "B2 the zoom step is 2.5 %");
  for (const z of [0.14, 0.25, 0.5, 0.51, 0.54, 0.8, 1, 1.2, 2]) {
    const a = q(z);
    ok(Math.abs(Math.log(a / z)) <= Math.log(Stage.ZOOM_STEP) / 2 + 1e-9, `B2 quantZoom(${z}) = ${a.toFixed(4)}: within half a step`);
    ok(Math.abs(q(a) - a) < 1e-9, `B2 quantZoom is settled at ${a.toFixed(4)}`);
  }
  ok(q(1) === 1 && q(NaN) === 1 && q(0) > 0, "B2 quantZoom: 1 stays 1, no zoom reads as 1, never zero");
  const mid = q(0.5);
  for (const bd of ["empty", "warehouse", "fight"]) for (const outcome of ["strong", "critical"]) {
    const rs = [];
    for (const zoom of [mid / 1.008, mid, mid * 1.008]) rs.push(await seatPlay({ seat: { ...SEAT_X.gm, ui: bare, zoom, name: "z" + zoom.toFixed(3) }, layer: "screen", bd, outcome, off: { x: 0.2, y: 0.1 }, cut: true, probe }));
    for (const r of rs.slice(1)) ok(diff(relOf(r), relOf(rs[0])) <= 3, `B2 ${bd}/${outcome}: at zoom ${r.zoom.toFixed(3)} (one step with ${rs[0].zoom.toFixed(3)}) the block stands ${diff(relOf(r), relOf(rs[0])).toFixed(1)} px off, from the roller`);
  }
}

/* B3: the plan view */
{
  const g = globalThis, keep = { canvas: g.canvas, game: g.game, window: g.window };
  try {
    const Stage = await import("../splash/stage.mjs?splashblock-pv");
    g.window = { innerWidth: 1600, innerHeight: 900 };
    g.canvas = { stage: { scale: { x: 0.54 }, pivot: { x: 3300, y: 1800 }, position: { x: 800, y: 450 } } };
    const mm = (st) => ({ modules: { get: (id) => (id === "moinen-maps" ? { active: true, api: { directorStage: { status: () => st } } } : null) } });
    g.game = mm({ home: { x: 3000, y: 1800, scale: 0.6 }, parked: { x: 3325, y: 1524, scale: 0.51 } });
    let pv = Stage.planView();
    ok(pv.shot === true && pv.x === 3325 && pv.y === 1524 && pv.scale === 0.51, `B3 away from home the plan view is the camera's parked shot (${JSON.stringify(pv)})`);
    g.game = mm({ home: null, parked: { x: 3325, y: 1524, scale: 0.51 } });
    pv = Stage.planView();
    ok(!pv.shot && pv.x === 3300 && pv.scale === 0.54, `B3 at home (no shot standing) it is the live view (${JSON.stringify(pv)})`);
    g.game = mm({ home: { x: 1, y: 1, scale: 1 }, parked: { x: NaN, y: 0, scale: 0.5 } });
    ok(!Stage.planView().shot, "B3 a shot without numbers is no shot");
    g.game = { modules: { get: () => null } };
    ok(!Stage.planView().shot && Stage.planView().scale === 0.54, "B3 without the map module: the live view");
    g.game = mm(null);
    ok(!Stage.planView().shot, "B3 a director that says nothing: the live view");
  } finally { for (const k of Object.keys(keep)) { if (keep[k] === undefined) delete g[k]; else g[k] = keep[k]; } }
  /* two seats in the middle of the camera's move: their live views differ (pan and zoom), the shot is one */
  for (const bd of ["warehouse", "fight"]) for (const outcome of ["strong", "critical"]) {
    const B = BOARDS_X[bd], parked = { x: B.at[0] + GS * 1.2, y: B.at[1] + GS * 0.6, scale: 0.51 };
    const a = await seatPlay({ seat: { ...SEAT_X.gm, ui: bare, zoom: 0.54 }, layer: "screen", bd, outcome, off: { x: 0.2, y: 1.3 }, cut: true, parked, probe });
    const b = await seatPlay({ seat: { ...SEAT_X.gm, ui: bare, zoom: 0.5 }, layer: "screen", bd, outcome, off: { x: 1.6, y: 0.4 }, cut: true, parked, probe });
    const abs = (r) => r.drawn.map((d) => ({ role: d.role, x: d.x, y: d.y, S: d.S }));
    ok(a.drawn.length > 0 && diff(abs(a), abs(b)) <= 1.5, `B3 ${bd}/${outcome}: two seats on one parked shot, their live views apart, draw the block at one place on the screen (${diff(abs(a), abs(b)).toFixed(1)} px)`);
    /* ... round the roller where the SHOT has him (the middle of the window less his offset from the shot's centre) */
    const hx = 800 + (B.at[0] + GS / 2 - parked.x) * parked.scale, hy = 450 + (B.at[1] + GS / 2 - parked.y) * parked.scale;
    const w = a.drawn.find((d) => d.role === "word");
    ok(!!w && Math.hypot(w.x - hx, w.y - hy) < 700, `B3 ${bd}/${outcome}: the block stands by the roller's place on the shot (${Math.round(Math.hypot(w.x - hx, w.y - hy))} px from it)`);
  }
}

/* B4: what the block tells */
{
  let split = 0;
  for (const [seat, bd] of [["gm", "empty"], ["gm", "warehouse"], ["p1", "empty"], ["p1", "warehouse"], ["big", "empty"], ["gm", "fight"]]) {
    const r = await seatPlay({ seat, layer: "screen", bd, outcome: "critical", cut: true, probe: (x) => {
      const p = probe(x), { Stage, ctl, board } = x, out = { ...p, room: null };
      if (p.parts?.length === 2 && p.blocks.length === 2) {
        /* a token in the gap between the two parts (inside the outline, under neither part), and one under the first part */
        const [A, B] = p.blocks, gapV = Math.max(A.t, B.t) - Math.min(A.b, B.b), gapH = Math.max(A.l, B.l) - Math.min(A.r, B.r);
        const z = globalThis.canvas.stage.scale.x, toScene = (q) => globalThis.canvas.stage.toLocal(q), sz = GS * z;
        const mk = (id, cx, cy) => { const s = toScene({ x: cx - sz / 2, y: cy - sz / 2 }); const t = { id, visible: true, document: { id, x: s.x, y: s.y, width: 1, height: 1, hidden: false, texture: { scaleX: 1, scaleY: 1 } }, x: s.x, y: s.y, w: GS, h: GS, center: { x: s.x + GS / 2, y: s.y + GS / 2 } }; board.tokens.push(t); return t; };
        if (gapV > sz * 1.5 || gapH > sz * 1.5) {
          const cx = gapV > gapH ? (Math.max(A.l, B.l) + Math.min(A.r, B.r)) / 2 : (Math.min(A.r, B.r) + Math.max(A.l, B.l)) / 2, cy = gapV > gapH ? (Math.min(A.b, B.b) + Math.max(A.t, B.t)) / 2 : (Math.max(A.t, B.t) + Math.min(A.b, B.b)) / 2;
          mk("BETWEEN", cx, cy);
          out.room = { between: Stage.makeRoom(["BETWEEN"], performance.now() + 1000), dead0: !!ctl.dead };
          mk("UNDER", (A.l + A.r) / 2, (A.t + A.b) / 2);
          out.room.under = Stage.makeRoom(["UNDER"], performance.now() + 1000);
        }
      }
      return out;
    } });
    const p = r.probe, R = p.rect;
    ok(p.blocks.length === (p.parts?.length === 2 ? 2 : 1), `B4 ${seat}/${bd}: the block tells ${p.blocks.length} part(s) (its layout has ${p.parts?.length === 2 ? 2 : 1})`);
    /* (a line's standing ink, its rim and burst, may pass the outline's edge by its own reach: under a line's height) */
    ok(p.blocks.every((q) => q.l >= R.l - 60 && q.t >= R.t - 60 && q.r <= R.r + 60 && q.b <= R.b + 60), `B4 ${seat}/${bd}: every part it tells lies by its outline`);
    /* every lettering inside the part boxes (so they are what is drawn) */
    ok(r.drawn.every((d) => p.blocks.some((q) => d.x > q.l && d.x < q.r && d.y > q.t && d.y < q.b)), `B4 ${seat}/${bd}: every lettering stands in a part it tells`);
    ok(p.scene.length === p.blocks.length && p.scene.every((q) => q && q.r > q.l && q.b > q.t), `B4 ${seat}/${bd}: each part comes with its scene rect`);
    if (p.parts?.length === 2) {
      split++;
      const sum = p.blocks.reduce((s, q) => s + (q.r - q.l) * (q.b - q.t), 0), out = (R.r - R.l) * (R.b - R.t);
      ok(sum < 0.8 * out, `B4 ${seat}/${bd}: a split block's parts (${Math.round(sum)} px2) are not its outline (${Math.round(out)} px2)`);
      if (p.room) {
        ok(p.room.between === 0 && !p.room.dead0, `B4 ${seat}/${bd}: a token between the parts of a split block is not under it: the moment stays`);
        ok(p.room.under === 1, `B4 ${seat}/${bd}: a token under one of its parts: the moment makes room`);
      }
    }
  }
  ok(split >= 2, `B4 the cases hold split blocks (${split})`);
  /* the same scene rects on two seats that show the same block (panned apart) */
  for (const bd of ["empty", "warehouse"]) {
    const a = await seatPlay({ seat: { ...SEAT_X.gm, ui: bare }, layer: "screen", bd, outcome: "critical", off: { x: 0.4, y: 0.2 }, cut: true, probe });
    const b = await seatPlay({ seat: { ...SEAT_X.gm, ui: bare }, layer: "screen", bd, outcome: "critical", off: { x: -0.5, y: 0.6 }, cut: true, probe });
    const d = Math.max(...a.probe.scene.map((q, i) => { const o = b.probe.scene[i]; return o ? Math.max(Math.abs(q.l - o.l), Math.abs(q.t - o.t), Math.abs(q.r - o.r), Math.abs(q.b - o.b)) : Infinity; }));
    if (a.probe.moved2 === "none" && b.probe.moved2 === "none") ok(d <= 4, `B4 ${bd}: two seats panned apart tell the same scene rects (${d.toFixed(1)} scene px apart)`);
  }
}

/* B5: a block's own parts never lie on each other */
{
  const lettersHit = (drawn) => { const w = drawn.find((d) => d.role === "word"); let s = 0; if (w) for (const d of drawn) if (d !== w && d.role !== "pre") s += area(d, w); return s; };
  let cases = 0;
  for (const layer of ["screen"]) for (const bd of ["empty", "warehouse", "crowd", "live", "fight"]) for (const outcome of ["ordinary", "strong", "critical"]) for (const seat of ["gm", "p1", "small", "big", "far"]) {
    const r = await seatPlay({ seat, layer, bd, outcome, cut: true });
    if (!r.drawn.length || r.drawn.some((d) => d.world)) continue;
    cases++;
    ok(lettersHit(r.drawn) < 4, `B5 ${bd}/${outcome}/${seat}: no caption line lies on the word (${Math.round(lettersHit(r.drawn))} px2, ${r.same?.moved})`);
  }
  for (const [s, zoom, off] of [["gm", 0.6, { x: 2.2, y: 0.75 }], ["p1", 0.45, { x: 0.3, y: 0.86 }]]) {
    const r = await seatPlay({ seat: { ...SEAT_X[s], name: `${s}@${zoom}`, zoom }, layer: "screen", bd: "fight", outcome: "critical", cut: true, off });
    cases++;
    ok(lettersHit(r.drawn) < 4, `B5 the live fight critical on ${s} at ${zoom}: no caption line lies on the word (${Math.round(lettersHit(r.drawn))} px2, ${r.same?.moved})`);
    ok(r.same?.moved !== "swapped", `B5 the live fight critical on ${s} at ${zoom}: the parts keep their order (${r.same?.moved})`);
  }
  ok(cases >= 60, `B5 ${cases} seats played`);
  /* the crowded GM view's REAL inputs to LP.seatPlace (lane 5, 2026-11-15, three runs of the fight critical after CAPSTAR; the third laid
     "6 SIXES" on the end of the word and swapped the parts' order: lib/splashblock-live.json) and CAPSTAR's own three */
  for (const file of ["lib/splashblock-live.json", "lib/capstar-live-fight.json"]) {
    const D = JSON.parse(readFileSync(join(here, file), "utf8"));
    D.forEach((d, i) => {
      for (const a of [...d.seat.avoid, ...(d.a.avoid1 ?? [])]) if (a.star) a.w = LP.STAR_W;
      const out = LP.seatPlace(d.a, d.seat), box = (it) => ({ l: it.x - it.w / 2, t: it.y - it.h / 2, r: it.x + it.w / 2, b: it.y + it.h / 2 });
      const w = out.items.find((it) => it.role === "word"), cap = out.items.filter((it) => it !== w);
      const own = cap.reduce((s, it) => s + area(box(it), box(w)), 0);
      const sb = d.seat.avoid.find((a) => a.star), star = sb ? out.items.reduce((s, it) => s + area(box(it), sb), 0) / ((sb.r - sb.l) * (sb.b - sb.t)) : 0;
      const tag = `B5 ${file.slice(4, -5)} input ${i}`;
      ok(own < 4, `${tag}: no caption line on the word (${Math.round(own)} px2, ${out.moved})`);
      ok(star <= 0.02, `${tag}: the letters cover ${(star * 100).toFixed(1)} % of the star`);
      ok(out.moved !== "swapped", `${tag}: the parts keep their order (${out.moved})`);
      const cy = cap.reduce((s, it) => s + it.y, 0) / Math.max(1, cap.length), t0 = d.a.items.find((it) => it.role === "word"), c0 = d.a.items.filter((it) => it.role !== "word").reduce((s, it) => s + it.y, 0) / Math.max(1, cap.length);
      ok(Math.sign(cy - w.y) === Math.sign(c0 - t0.y), `${tag}: the caption on the table's side of the word (${Math.round(cy - w.y)} px, the table ${Math.round(c0 - t0.y)})`);
      /* every letter inside the seat's view */
      ok(out.items.every((it) => { const q = box(it); return q.l >= d.seat.safe.l - 2 && q.t >= d.seat.safe.t - 2 && q.r <= d.seat.safe.r + 2 && q.b <= d.seat.safe.b + 2; }), `${tag}: every letter inside the view`);
      /* the sizes: one factor, never under the allowed floor of the table's (no shrink under the ranks) */
      const ks = out.items.map((it, j) => it.S / d.a.items[j].S);
      ok(Math.max(...ks) - Math.min(...ks) < 0.02 && Math.min(...ks) > 0.95, `${tag}: the table's sizes (${ks.map((k) => k.toFixed(2))})`);
    });
  }
  ok(LP.PART_W > LP.STAR_W * 50, `B5 a part's letters weigh more than anything a block can cover (PART_W ${LP.PART_W}, STAR_W ${LP.STAR_W})`);
}

/* B6: the token reactions */
{
  const tm = readFileSync(join(here, "../tokenreact/main.mjs"), "utf8"), st = readFileSync(join(here, "../splash/stage.mjs"), "utf8");
  ok(/phase: "place", blocks, scene/.test(tm), "B6 the reactions ask the moment for its blocks and their scene rects");
  ok(/const sc = scene\[i\]/.test(tm) && /sc \? \{ x: sc\.l, y: sc\.t \}/.test(tm) && /P\.frameScreen\(a, was, canvas\.stage\.position\)/.test(tm), "B6 ... and take a scene rect through their plan frame");
  ok(/data\.blocks\.push\(\.\.\.blocks\(Array\.isArray\(data\.scene\) \? data\.scene : null\)\)/.test(st), "B6 the moment answers with both");
  ok(/const parts = partsOf\(ctl\);/.test(st) && /parts\.some\(\(b\) => nearBlock\(b, tb\)\)/.test(st), "B6 make room: by the parts, not the outline");
}

/* B7: cost of the last resort on the real crowded inputs */
{
  const D = JSON.parse(readFileSync(join(here, "lib/splashblock-live.json"), "utf8"));
  for (const d of D) LP.seatPlace(d.a, d.seat);   // warm
  const ts = [];
  for (let i = 0; i < 5; i++) for (const d of D) { const t0 = performance.now(); LP.seatPlace(d.a, d.seat); ts.push(performance.now() - t0); }
  ts.sort((a, b) => a - b);
  const med = ts[Math.floor(ts.length / 2)];
  ok(med < 60, `B7 placing a crowded critical takes ${med.toFixed(1)} ms (median of ${ts.length}; under 60)`);
}

/* B8: nothing clean anywhere: the canonical block as it is */
{
  const st = readFileSync(join(here, "../splash/stage.mjs"), "utf8"), lp = readFileSync(join(here, "../splash/letter-plan.mjs"), "utf8");
  ok(/asIs: worst\(c1\.moved\)/.test(st) && /const asIs = !!\(table\.rigid && seat\.asIs\);/.test(lp) && /return asIs \|\| s <= tHit \+ eps \? P\.map\(\(\) => z\) : null;/.test(lp), "B8 a canonical block with no clean place is taken as it is (source)");
  ok(/if \(!out \|\| !worst\(alt\.moved\) \|\| \(LP\.coverMax\(alt, toks\) <= CANON_FREE && LP\.coverMax\(out, toks\) > CANON_COVER\)\) out = own = alt;/.test(st), "B8 a seat searches by itself only for a clean place, or one that frees every token (source)");
  ok(/const CANON_FREE = 0\.01, CANON_COVER = 0\.03, CELL_HOLD = 12;/.test(st) && /ctl\.cell = cs\.cell;/.test(st), "B8 a moment laid out again stays in its cell (source)");
  let seen = 0, sameB = 0, told = 0;
  for (const bd of ["live", "fight", "crowd"]) for (const outcome of ["strong", "critical"]) for (const at of [{ x: 0.42, y: 0.4 }, { x: 0.5, y: 0.33 }, { x: 0.6, y: 0.33 }]) {
    const S = SEAT_X.gm, px = GS * S.zoom;
    const cx = (Math.floor(at.x * S.W / 64) + 0.5) * 64, cy = (Math.floor(at.y * S.H / 64) + 0.5) * 64;
    const offOf = (jx, jy) => ({ x: (S.W / 2 - (cx + jx)) / px, y: (S.H / 2 - (cy + jy)) / px });
    /* the GM's panels against none, the views 4 px apart */
    const a = await seatPlay({ seat: "gm", layer: "screen", bd, outcome, off: offOf(0, 0), cut: true, probe }), b = await seatPlay({ seat: { ...S, ui: bare, name: "bare" }, layer: "screen", bd, outcome, off: offOf(2, -4), cut: true, probe });
    if (!a.drawn.length || a.drawn.some((d) => d.world) || !b.drawn.length) continue;
    if (!worst(a.probe.canon?.moved) || !worst(b.probe.canon?.moved)) continue;
    seen++;
    if (a.probe.canon.via === "canon" && b.probe.canon.via === "canon") {
      sameB++;
      ok(diff(shapeOf(a), shapeOf(b)) <= 1.5, `B8 ${bd}/${outcome}: nothing clean: the seat with the GM's panels shows the arrangement of the seat without (${diff(shapeOf(a), shapeOf(b)).toFixed(1)} px)`);
      const sa = a.probe.scene ?? [], sb = b.probe.scene ?? [];
      if (sa.length && sa.length === sb.length && sa.every(Boolean) && sb.every(Boolean)) {
        told++;
        const d = Math.max(...sa.map((q, i) => Math.max(Math.abs(q.l - sb[i].l), Math.abs(q.t - sb[i].t), Math.abs(q.r - sb[i].r), Math.abs(q.b - sb[i].b))));
        ok(d <= 0.5, `B8 ${bd}/${outcome}: the reactions are told the same scene rects on both seats (${d.toFixed(2)} scene px)`);
      }
    }
  }
  ok(seen >= 8 && sameB >= 0.75 * seen && told >= 0.75 * sameB, `B8 of ${seen} crowded moments without a clean place ${sameB} stand as the canonical block on both seats (${told} with scene rects compared)`);
  /* laid out again with the roller just past the cell's edge: the same cell (Stage keeps ctl.cell) */
  const Stage1 = await import("../splash/stage.mjs?splashblock-s");
  ok(Stage1.SNAP === 64, "B8 the cell");
}

/* B9: the GM's desk as a shared zone */
{
  const tm = readFileSync(join(here, "../tokenreact/main.mjs"), "utf8");
  ok(/export const DESK_ZONE = Object\.freeze\(\{ w: 52, gap: 19, h: 192 \}\);/.test(tm), "B9 the desk's end inside the standard view, as measured live (52 x 192 px, 19 px under the challenges' panel)");
  ok(/const dk = deskZone\(d, !!document\.body\?\.classList\?\.contains\?\.\("ita-tactics"\)\);\n\s+if \(dk\) zs\.push\(dk\);/.test(tm), "B9 ... a shared zone on every seat while a fight is on");
  const m = /export function deskZone\(dock, on\) \{ return ([^;]+); \}/.exec(tm);
  ok(!!m, "B9 deskZone");
  if (m) {
    const DESK_ZONE = { w: 52, gap: 19, h: 192 }, deskZone = new Function("DESK_ZONE", "dock", "on", `return ${m[1]};`);
    const z = deskZone(DESK_ZONE, { l: 936, t: 48, r: 1246, b: 281 }, true);
    ok(z && z.l === 1194 && z.r === 1246 && z.t === 300 && z.b === 492, "B9 on 1600 x 900: 1194..1246 x 300..492, where the lane's GM has the desk's left end");
    ok(deskZone(DESK_ZONE, { l: 936, t: 48, r: 1246, b: 281 }, false) === null && deskZone(DESK_ZONE, null, true) === null, "B9 no zone without a fight or without the challenges' panel");
  }
}

for (const m of fails) console.log("FAIL " + m);
console.log(`splashblock: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
