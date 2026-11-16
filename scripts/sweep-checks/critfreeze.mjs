/* node scripts/sweep-checks/critfreeze.mjs -- CRITFREEZE (2026-11-16): laying a moment out ahead never holds the page for a whole layout.
   Live (two seats, lane 5, The Warehouse, a critical from the sheet): the layout ahead ran in the page's idle slots but was cut only BETWEEN
   its layouts; one layout of a critical (LP.composeMoment's search, then LP.seatPlace's) is one call of 0.15-0.45 s, so the picture froze
   for that long ~1 s after the roll button, then again for the layouts that follow. Now the two searches are generators of steps
   (LP.composeMomentSteps, LP.seatPlaceSteps) and a sliced prepare (stage.mjs stepped) takes as many steps as its slot holds, puts the
   search by and goes on from that step in its next slot.
     F1  the SAME answer: composeMomentSteps / seatPlaceSteps stepped one step at a time, with other layouts run between the steps, give
         exactly what composeMoment / seatPlace give in one go (every item's place and size, the outline, the parts, how it moved);
     F2  the steps are small: no step of a layout measures more than a handful of blocks (the whole search measures hundreds), and the
         dear searches have many steps (the long work cannot come back as one step);
     F3  the SAME picture on the stage: a moment laid out ahead in slots (a clock on which every step uses up its slot: the finest cut),
         then played = the moment played without any layout ahead (every lettering's text, place, size, start, hand), on four boards,
         two seats with the table's lists, every kind of result; the play lays nothing out again;
     F4  no slot runs past its time by more than one step, and a critical on a crowded board takes many slots (it is cut INSIDE a layout);
     F5  a layout begun in slots and wanted at once (the instant came: an unsliced prepare, or the play itself) is finished from where
         it stood, the same picture;
     F6  an input that changed between two slots (the roller moved) is laid out afresh for the new input: the picture of a seat that never
         laid out ahead; what was put by for the old input is dropped in time (the store stays small);
     F7  a slot always goes on (one step at least, even when the slot was used up before the layout began): a prepare ends.
   The page and the canvas are fakes (lib/splash-seat.mjs), the engine's plans and measures are the real ones. */
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as Lib from "./lib/splash-seat.mjs";
import * as LP from "../splash/letter-plan.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const { seatPlay, seatTell } = Lib;
await Lib.realEngine();
/* the page's clock, by hand: `tick` ms pass on every reading (so work "takes time" the same way on every machine) */
let clock = 1000, tick = 0;
const PLAY_AT = 5e6;   // every play compared starts at this reading (a directed word travels by the clock)
const realPerf = globalThis.performance;
Object.defineProperty(globalThis, "performance", { value: { now: () => (clock += tick) }, configurable: true, writable: true });

/* ---------------------------------------------------------------- F1, F2: the two searches, stepped */
const rnd = (seed) => { let r = seed >>> 0; return () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648); };
const boxOf = (it, S) => { const n = String(it.text).length; return { w: 0.62 * n * S + 0.3 * S, h: 1.25 * S, grow: it.role === "word" ? 1.5 : 1, room: { stand: { l: 0.05 * S, r: 0.3 * S, u: 0.05 * S, d: 0.35 * S }, l: 0.05 * S, r: 0.3 * S, u: 0.05 * S, d: 0.35 * S } }; };
const crit = () => [
  { role: "word", text: "HAYMAKER!", cap: 0.13, min: 0.075, rank: "critical", wMax: 0.8 },
  { role: "six", text: "6 SIXES", cap: 0.05, min: 0.03, rank: "critical" },
  { role: "say", text: "THE ODDS ARE SHATTERED!", cap: 0.034, min: 0.022 },
  { role: "odds", text: "1 IN 46656", cap: 0.03, min: 0.02 }
];
function frameOf(seed, crowd) {
  const R = rnd(seed), W = 1600, H = 900;
  const T = { l: 700 + R() * 200, t: 380 + R() * 140 }; T.r = T.l + 100 + R() * 80; T.b = T.t + (T.r - T.l); T.x = (T.l + T.r) / 2; T.y = (T.t + T.b) / 2;
  const avoid = [];
  for (let i = 0; i < crowd; i++) { const l = 60 + R() * 1300, t = 40 + R() * 700, s = 90 + R() * 110; avoid.push({ l, t, r: l + s, b: t + s, x: l + s / 2, y: t + s / 2, w: i % 4 === 0 ? 50 : i % 4 === 3 ? 20 : 10 }); }
  return { vh: 900, ref: 900, px: 1, scale: 1, safe: { l: 100, t: 20, r: W - 310, b: H - 80 }, token: seed % 3 ? T : null, focus: { x: 640, y: 400 }, avoid: seed % 3 ? avoid : [...avoid, { ...T, w: 50 }], gap: 12 };
}
const strip = (o) => o && JSON.stringify({ items: o.items.map((it) => [it.role, it.x, it.y, it.S, it.w, it.h]), rect: o.rect, parts: o.parts ?? null, gauge: o.gauge ?? null, side: o.side, hit: o.hit, split: !!o.split, bare: !!o.bare, clean: !!o.clean, k: o.k ?? null, moved: o.moved ?? null, d: o.d ?? null });
{
  let cases = 0, stepsMax = 0, perStepMax = 0, totalMax = 0, same = 0, seatSame = 0, seatSteps = 0, seatCases = 0;
  for (let seed = 1; seed <= 36; seed++) for (const crowd of [0, 3, 8, 16]) {
    const frame = frameOf(seed, crowd);
    let calls = 0;
    const measure = (it, S) => { calls++; return boxOf(it, S); };
    const whole = LP.composeMoment(crit(), frame, measure), n0 = calls;
    /* stepped, one step at a time; between the steps another layout runs to its end (the kept places of both pass through one store) */
    calls = 0;
    const g = LP.composeMomentSteps(crit(), frame, measure);
    let r, steps = 0, worst = 0, before = 0;
    for (;;) {
      r = g.next();
      worst = Math.max(worst, calls - before);
      if (r.done) break;
      steps++;
      if (steps % 7 === 3) { const c = calls; LP.composeMoment(crit(), frameOf(seed + 100 + steps, 5), boxOf); calls = c; }
      before = calls;
    }
    cases++; stepsMax = Math.max(stepsMax, steps); perStepMax = Math.max(perStepMax, worst); totalMax = Math.max(totalMax, n0);
    if (strip(r.value) === strip(whole)) same++; else ok(false, `F1 compose seed ${seed} crowd ${crowd}: stepped is not the layout made in one go`);
    /* the block placed on a seat whose roller stands elsewhere and whose view is smaller and fuller */
    const R = rnd(seed * 7 + crowd), T = frame.token ?? frame.avoid.at(-1);
    const dx = (R() - 0.5) * 300, dy = (R() - 0.5) * 200, grow = R() * 30;
    const hero = { l: T.l + dx - grow, t: T.t + dy - grow, r: T.r + dx + grow, b: T.b + dy + grow };
    const seat = { hero, safe: { l: 80 + R() * 200, t: 40, r: 1250 - R() * 250, b: 800 - R() * 150 }, avoid: frameOf(seed + 50, crowd + 2).avoid, own: [], gap: 12 };
    const table = { ...whole, hero: { l: T.l, t: T.t, r: T.r, b: T.b }, ref: 900, scale: 1, tsafe: frame.safe, avoid1: frame.avoid.filter((q) => q !== T) };
    const one = LP.seatPlace(table, seat);
    const g2 = LP.seatPlaceSteps(table, seat);
    let r2, n2 = 0;
    while (!(r2 = g2.next()).done) { n2++; if (n2 % 11 === 5) LP.seatPlace(table, { ...seat, safe: { ...seat.safe, r: seat.safe.r - 40 } }); }
    seatCases++; seatSteps = Math.max(seatSteps, n2);
    if (strip(r2.value) === strip(one)) seatSame++; else ok(false, `F1 seat seed ${seed} crowd ${crowd}: stepped is not the placing made in one go`);
  }
  ok(same === cases && cases === 144, `F1 the stepped layout is the layout made in one go (${same} of ${cases})`);
  ok(seatSame === seatCases, `F1 the stepped placing is the placing made in one go (${seatSame} of ${seatCases})`);
  ok(perStepMax <= 40, `F2 no step of a layout measures more than a few blocks (${perStepMax} measurings in the worst step; a whole search up to ${totalMax})`);
  ok(totalMax >= 12 * perStepMax, `F2 a crowded critical's search is many times one step (${totalMax} measurings against ${perStepMax})`);
  ok(stepsMax >= 60, `F2 a crowded critical's layout has many steps (${stepsMax})`);
  ok(seatSteps >= 40, `F2 a dear placing has many steps (${seatSteps})`);
}

/* ---------------------------------------------------------------- F3 .. F7: the stage */
const UI_GM = { side: 48, nav: 160, vram: true, dock: true, party: true, card: true, col: true, pill: true };
const UI_P1 = { side: 48, nav: 32, dock: true, party: true, card: true, col: true };
const gm = { name: "gm", gm: true, k: 1, W: 1600, H: 900, zoom: 0.5, ui: UI_GM };
const p1 = { name: "p1", k: 1, W: 1600, H: 900, zoom: 0.5, ui: UI_P1 };
const told = { GM: await seatTell(gm), P1: await seatTell(p1) };
const key = (d) => `${d.role}:${d.text}@${d.x},${d.y} S${d.S} ${d.size} ${JSON.stringify(d.at)} t${d.startAt} ${d.layer}`;
const pic = (r) => JSON.stringify([r.drawn.map(key), r.same?.moved ?? null, r.same?.via ?? null, r.same?.rect ?? null, r.gauges]);
/* a layout ahead in slots, as main.mjs prepareAhead and the page's idle slots run it: every idle callback in turn until none is left.
   -> { slots, over: the worst a slot ran past PREP_SLICE_MS (ms of this clock), rounds } */
function ahead(Stage, e, opts, { maxSlots = Infinity, onSlot = null, idle = null } = {}) {
  const q = [];
  const ric0 = globalThis.requestIdleCallback;
  globalThis.requestIdleCallback = (fn) => { q.push(fn); return q.length; };
  const res = { slots: 0, over: 0, left: 0, long: 0 };
  try {
    let fn = (d) => Stage.prepare(e, opts, true, 0, d);
    while (fn && res.slots < maxSlots) {
      const t0 = clock;
      fn(idle); res.slots++;
      res.over = Math.max(res.over, clock - t0 - Stage.PREP_SLICE_MS); res.long = Math.max(res.long, clock - t0);
      if (onSlot) onSlot(res.slots);
      fn = q.shift();
    }
    res.left = (fn ? 1 : 0) + q.length;
  } finally { if (ric0) globalThis.requestIdleCallback = ric0; else delete globalThis.requestIdleCallback; }
  return res;
}
const BOARDS = ["warehouse", "live", "crowd", "empty"], OUTS = ["critical", "strong", "ordinary", "pushed", "miss", "stressed", "routine"];
{
  let n = 0, slotsCrit = 0, overWorst = 0, stepWorst = 0;
  for (const bd of BOARDS) for (const outcome of OUTS) for (const seat of [gm, p1]) {
    tick = 0;
    const plain = await seatPlay({ seat, bd, outcome, told, before: () => { clock = PLAY_AT; } });
    /* every reading of the clock is 0.75 ms: a step is at least 1.5 ms, a slot of 12 ms a few steps. The play itself on a still clock, as
       the plain one (a directed word travels by the clock: the pictures are compared at the same instant) */
    let a = null, st0 = null;
    tick = 0.75;
    const sliced = await seatPlay({ seat, bd, outcome, told, before: ({ Stage, e, opts }) => { a = ahead(Stage, e, opts); st0 = { ...Stage.layoutStats }; tick = 0; clock = PLAY_AT; } });
    tick = 0;
    n++;
    eq(pic(sliced), pic(plain), `F3 ${bd}/${outcome}/${seat.name}: laid out ahead in slots, the same picture as laid out at once`);
    ok(sliced.stats.fresh === st0.fresh && sliced.stats.seatFresh === st0.seatFresh, `F3 ${bd}/${outcome}/${seat.name}: the play lays nothing out again (layouts ${st0.fresh}->${sliced.stats.fresh}, placings ${st0.seatFresh}->${sliced.stats.seatFresh})`);
    ok(a.left === 0, `F3 ${bd}/${outcome}/${seat.name}: the slots end (${a.slots} slots)`);
    overWorst = Math.max(overWorst, a.over); stepWorst = Math.max(stepWorst, sliced.steps.worst);
    ok(a.over <= sliced.steps.worst + 3 * 0.75 + 1e-6, `F4 ${bd}/${outcome}/${seat.name}: no slot runs past its time by more than one step (${a.over.toFixed(2)} ms over, the longest step ${sliced.steps.worst.toFixed(2)} ms)`);
    if (outcome === "critical" && bd !== "empty") { slotsCrit = Math.max(slotsCrit, a.slots); ok(a.slots >= 8, `F4 ${bd}/critical/${seat.name}: the critical's layout is cut inside its layouts (${a.slots} slots for ${st0.fresh} layouts and ${st0.seatFresh} placings)`); }
  }
  ok(n === 56, `F3 every board, result and seat (${n})`);
  console.log(`  the most slots of a critical ${slotsCrit}; a slot ran over by ${overWorst.toFixed(2)} ms at most (clock of 0.75 ms a reading), the longest step ${stepWorst.toFixed(2)} ms`);
}
/* F5: wanted at once while the slots are under way */
for (const bd of ["warehouse", "crowd"]) for (const stopAt of [1, 3, 9]) for (const how of ["play", "prepare"]) {
  tick = 0;
  const plain = await seatPlay({ seat: gm, bd, outcome: "critical", told, before: () => { clock = PLAY_AT; } });
  tick = 0.75;
  let a = null, mid = null;
  const cut = await seatPlay({ seat: gm, bd, outcome: "critical", told, before: ({ Stage, e, opts }) => {
    a = ahead(Stage, e, opts, { maxSlots: stopAt });
    mid = { ...Stage.layoutStats };
    tick = 0;
    if (how === "prepare") Stage.prepare(e, opts, false);
    clock = PLAY_AT;
  } });
  tick = 0;
  ok(a.left > 0, `F5 ${bd} after ${stopAt} slots: the layout ahead is still under way (${a.slots} slots run)`);
  eq(pic(cut), pic(plain), `F5 ${bd} after ${stopAt} slots, then ${how} at once: the same picture`);
}
/* F6: the roller moved between two slots */
{
  const shift = (b) => { const h = b.hero; h.document.x += 350; h.x += 350; h.center.x += 350; };
  tick = 0;
  const fresh = await seatPlay({ seat: gm, bd: "crowd", outcome: "critical", told, before: ({ board }) => { shift(board); clock = PLAY_AT; } });
  tick = 0.75;
  let a = null, a2 = null;
  const moved = await seatPlay({ seat: gm, bd: "crowd", outcome: "critical", told, before: ({ Stage, e, opts, board }) => {
    a = ahead(Stage, e, opts, { maxSlots: 4 });
    shift(board);
    a2 = ahead(Stage, e, opts);
    tick = 0; clock = PLAY_AT;
  } });
  tick = 0;
  ok(a.left > 0 && a2.left === 0, `F6 the roller moved after ${a.slots} slots; the layout ahead for the new place ends (${a2.slots} slots)`);
  eq(pic(moved), pic(fresh), "F6 the roller moved between two slots: the picture of a seat that lays out for the new place only");
  /* many inputs begun and left: the store of searches put by stays small */
  const src = readFileSync(join(here, "../splash/stage.mjs"), "utf8");
  const max = Number(src.match(/STEPS_MAX = (\d+)/)?.[1]);
  ok(max >= 2 && max <= 12 && /if \(pending\.size > STEPS_MAX\) pending\.delete\(pending\.keys\(\)\.next\(\)\.value\)/.test(src), `F6 at most ${max} searches are put by (the oldest dropped)`);
}
/* F7: a clock on which every reading uses up a whole slot: each slot still takes its one step, the prepare ends, the picture is the same */
{
  tick = 0;
  const plain = await seatPlay({ seat: p1, bd: "crowd", outcome: "critical", told, before: () => { clock = PLAY_AT; } });
  tick = 20;
  let a = null, steps = 0;
  const hard = await seatPlay({ seat: p1, bd: "crowd", outcome: "critical", told, before: ({ Stage, e, opts }) => { a = ahead(Stage, e, opts); steps = Stage.stepStats.steps; tick = 0; clock = PLAY_AT; } });
  tick = 0;
  ok(a.left === 0 && a.slots > 20 && a.slots <= steps + 2, `F7 a slot used up before its layout still takes one step: the prepare ends (${a.slots} slots, ${steps} steps)`);
  eq(pic(hard), pic(plain), "F7 ... the same picture");
  const src = readFileSync(join(here, "../splash/stage.mjs"), "utf8");
  const rounds = Number(src.match(/PREP_ROUNDS = (\d+)/)?.[1]);
  ok(rounds >= a.slots, `F7 the prepare may take as many slots as the finest cut needs (${rounds} allowed, ${a.slots} needed)`);
  ok(/round < PREP_ROUNDS/.test(src), "F7 the slots go on up to PREP_ROUNDS");
}
/* F8: the slot is as long as the page is idle for */
{
  const run = async (idle) => { let a = null; tick = 0.25; await seatPlay({ seat: gm, bd: "crowd", outcome: "critical", told, before: ({ Stage, e, opts }) => { a = ahead(Stage, e, opts, { idle }); tick = 0; clock = PLAY_AT; } }); tick = 0; return a; };
  const free = await run(null), busy = await run({ didTimeout: true, timeRemaining: () => 0 }), short = await run({ didTimeout: false, timeRemaining: () => 2 }), mid = await run({ didTimeout: false, timeRemaining: () => 9 }), wide = await run({ didTimeout: false, timeRemaining: () => 49 });
  const lim = (ms) => ms + 4 * 0.25 + 1e-6;   // its time, one step and the readings round it
  ok(free.long <= lim(12) && free.long > 11, `F8 a slot without the page's word is 12 ms (${free.long.toFixed(2)})`);
  ok(busy.long <= lim(6) && busy.slots > free.slots * 1.5, `F8 a slot that came by its timeout (a busy page) is 6 ms (${busy.long.toFixed(2)} ms, ${busy.slots} slots against ${free.slots})`);
  ok(short.long <= lim(6), `F8 a slot the page has 2 ms for is 6 ms at most (${short.long.toFixed(2)})`);
  ok(mid.long <= lim(9) && mid.long > 8, `F8 a slot the page has 9 ms for is 9 ms (${mid.long.toFixed(2)})`);
  ok(wide.long <= lim(12) && wide.long > 11, `F8 a slot the page has 49 ms for is 12 ms (${wide.long.toFixed(2)})`);
  const src = readFileSync(join(here, "../splash/stage.mjs"), "utf8"), main = readFileSync(join(here, "../splash/main.mjs"), "utf8");
  const retry = Number(src.match(/PREP_RETRY_MS = (\d+)/)?.[1]);
  ok(retry > 0 && retry <= 50 && /requestIdleCallback\(again, \{ timeout: PREP_RETRY_MS \}\)/.test(src), `F8 the next slot is asked for ${retry} ms later at the latest`);
  ok(/Stage\.prepare\(ev, [^;]*when === 'idle', 0, when === 'idle' \? \(idle \?\? null\) : null\)/.test(main), "F8 the roll's layout ahead hands the page's idle time to the stage");
}
/* the callers: the layout's two searches are run in steps by the stage, and nowhere in one go */
{
  const src = readFileSync(join(here, "../splash/stage.mjs"), "utf8");
  ok(/LP\.composeMomentSteps\(/.test(src) && !/LP\.composeMoment\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "F2 the stage composes in steps (LP.composeMomentSteps), never in one go");
  ok(/LP\.seatPlaceSteps\(/.test(src) && !/LP\.seatPlace\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "F2 the stage places in steps (LP.seatPlaceSteps), never in one go");
}
Object.defineProperty(globalThis, "performance", { value: realPerf, configurable: true, writable: true });
done("critfreeze");
const sm = summary();
console.log(`sweep critfreeze: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
