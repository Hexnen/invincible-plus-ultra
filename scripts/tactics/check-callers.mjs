/* node scripts/tactics/check-callers.mjs -- CALLERS / CALLERS2: plus-ultra's lettering callers rest on the RUNNING engine's public API alone
   (engine 1.9.18: one copy runs on every seat, the newest of the active modules; it carries its own table clock, measures a word's standing
   ink before it is placed, names its impact ladders and reads every sound word in both languages). No mirrored engine table, no import of
   an engine file but its entry.
     I  the impact ladders (token reactions' series bounds and ceiling, the splash's map build) come from the running engine (L.impact steps /
        series / tiers / tierOf); nothing of scripts/letters/ is imported by the runtime callers but index.mjs
     K  ONE table clock on the page: shared-clock.mjs reads the engine's L.clock once it is GOOD (error <= ERR_OK) or no worse than its own;
        a caller waits for a good clock (settle) before it puts a shared instant on the page (a seat that just reloaded)
     W  every sound word plus-ultra itself ships passes the engine's own checks in BOTH languages' readings
     M  placement on the engine's measured standing footprint (L.measure stand) */
import fs from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as P from "../tokenreact/pure.mjs";
import * as C from "../shared-clock.mjs";
import * as SL from "../splash/logic.mjs";
import * as WD from "../splash/words.mjs";
import * as LW from "../letters/words.mjs";
import * as IPL from "../letters/impact/plan.mjs";
import * as IP from "../splash/impact-plan.mjs";
import { impactApi } from "../tokenreact/impact-node.mjs";

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

/* ---------- I: the impact table of the running engine (CALLERS2: no copy, no import of the engine's files) ---------- */
{
  for (const f of ["../tokenreact/pure.mjs", "../tokenreact/main.mjs", "../splash/impact-plan.mjs", "../splash/letter-plan.mjs", "../splash/stage.mjs", "../splash/main.mjs", "../same-picture.mjs", "../shared-clock.mjs"]) {
    const t = src(f), bad = [...t.matchAll(/(?:from\s+|import\()\s*["'](?:\.\.?\/)+letters\/([\w/.-]+)["']/g)].map((x) => x[1]).filter((x) => x !== "index.mjs");
    eq(bad, [], `I: ${f.replace("../", "")} imports no engine file but its entry`);
  }
  ok(!/STAND\s*=|LIFE_REACH|INV_RIM|m < 0\.35 \?|IMPACT_TOP\s*=\s*1\.34/.test(src("../tokenreact/pure.mjs") + src("../splash/letter-plan.mjs") + src("../splash/impact-plan.mjs") + src("../splash/stage.mjs")), "I: no mirrored engine table left (STAND, LIFE_REACH, INV_RIM, the tier thresholds, IMPACT_TOP)");
  eq(P.impactTable(), null, "I: before the running engine hands its table in there is none");
  let threw = false; try { P.withSeries({ kind: "hit", magnitude: 0.25 }, 2); } catch { threw = true; }
  ok(threw, "I: a series cannot be built before the engine's table is known (no silent default)");
  eq(P.impactOf({ kind: "hit", amt: 0.5 }, 1, {}), null, "I: without the engine's table a reaction asks for no impact frame (and does not throw)");
  const api = impactApi();
  ok(P.useImpactTable(api) === true, "I: the engine's table is taken");
  eq(P.impactTable(), { steps: IPL.STEP_AT, series: { step: IPL.SERIES_STEP, max: IPL.SERIES_MAX }, tiers: IPL.TIER_AT }, "I: the table read is the engine's (steps, series, tiers)");
  eq(P.impactTop(), 1.34, "I: the blows' ceiling sits just under the engine's whole set (its last tier 1.35): 1.34 as before");
  const spec = { kind: "hit", magnitude: 0.25 };
  const before = P.withSeries(spec, 3);
  ok(P.useImpactTable({ steps: [0.3, 0.5, 0.85, 1.35, 1.7], series: { step: 0.1, max: 2 }, tiers: [0.3, 0.85, 1.2] }) === true, "I: another engine's table is taken");
  const other = P.withSeries(spec, 3);
  ok(P.effectiveMagnitude(other) < 0.3 && other.series <= 2 && P.impactTop() === 1.19, `I: the series is bounded by the RUNNING engine's next strength, places and tiers (drawn ${P.effectiveMagnitude(other)}, places ${other.series}, top ${P.impactTop()})`);
  ok(JSON.stringify(other) !== JSON.stringify(before), "I: another engine's table gives another series (the numbers are read, not baked in)");
  ok(P.useImpactTable({ steps: [0.6, 0.3], series: { step: 0.1, max: 2 } }) === false && P.useImpactTable(null) === false && P.impactTable().steps[0] === 0.3, "I: a broken table is refused (the last good one stays)");
  P.useImpactTable(api);
  eq(P.withSeries(spec, 3), before, "I: the engine's own table again: the same series");
  const m = src("../tokenreact/main.mjs");
  ok(/P\.useImpactTable\(L\.impact\)/.test(m) && (m.match(/await runningEngine\(\)/g) ?? []).length >= 2 && !/engine = await letters\(\)|engine \?\? \(engine = await letters\(\)\)/.test(m), "I: every way token reactions get the engine hands its impact table to pure.mjs");
  /* the splash's map build reads the engine's tier: the same tier the engine's plan gives that impact */
  for (const mg of [0, 0.34, 0.35, 0.6, 0.84, 0.85, 1.1, 1.34, 1.35, 1.6, 2]) eq(IP.tierOfImpact(mg, api), IPL.planImpact({ kind: "crit", magnitude: mg }).tier, `I: the splash's map build at strength ${mg} is the engine plan's tier`);
  eq(IP.tierOfImpact(1.6, { tierOf: () => 1, seriesBoost: () => 0 }), 1, "I: another engine's tiers are read, not baked in");
  eq(IP.mapFrames(1.6, null), IP.MAP_FRAMES[0], "I: an engine without tierOf gets the lowest map build (drawings that leave the word clear)");
  ok(/IP\.mapFrames\(q\.magnitude, LE\?\.impact\)/.test(src("../splash/stage.mjs")), "I: the splash hands the running engine's L.impact to its map build");
}

/* ---------- K: one clock ---------- */
{
  C._reset();
  const pnow = () => performance.now();
  let gridSet = 0;
  const fakeClock = (off, ready = true) => ({ now: () => pnow() + off, toPage: (s) => s - off, toServer: (p) => p + off, offset: () => (ready ? off : null), error: () => 0.7, ready: () => ready, state: () => ({}) });
  globalThis.game = { time: { serverTime: Date.now() + 5000 } };
  ok(C.source() === "foundry", "K: before any answer the table's time is Foundry's");
  ok(C.adopt(fakeClock(123456, false)) === true && C.source() === "foundry" && !C.ready(), "K: an engine clock without an answer yet is not read");
  C.adopt(fakeClock(123456));
  ok(C.source() === "engine" && C.ready() && C.offset() === 123456 && C.error() === 0.7, "K: once answered (and good), the engine's clock is the table's clock");
  const t = pnow();
  ok(Math.abs(C.serverNow() - (pnow() + 123456)) < 2 && Math.abs(C.toPage(t + 123456) - t) < 1e-9 && Math.abs(C.toServer(t) - (t + 123456)) < 1e-9, "K: serverNow / toPage / toServer are the engine's");
  C.noteEpoch(1.79e12, C.serverNow());
  ok(C.epochOffset() !== null, "K: the server's epoch is learnt on the engine's clock too");
  C._reset();
  C.driveGrid({ clock: fakeClock(777), gridClock: () => { gridSet++; } });
  ok(gridSet === 0 && C.source() === "engine" && C.offset() === 777, "K: an engine with its own clock keeps its grid on it; this module reads that clock (driveGrid adopts)");
  C._reset();
  C.driveGrid({ gridClock: () => { gridSet++; } });
  ok(gridSet === 1, "K: an engine without L.clock still gets the table's clock for its grid (older engines)");
  C._reset();
  const s = src("../shared-clock.mjs");
  ok(/MoinenLetters/.test(s) && /if \(engGood\(\)\) return; await ping\(\)/.test(s) && /if \(engGood\(\)\) \{ clearInterval\(timer\)/.test(s), "K: start() adopts the running engine's clock and stops its own pings once that clock is good");
  ok(/Clock\.driveGrid\(L\)/.test(src("../splash/main.mjs")), "K: the splash hands its engine to the clock (adopt) as soon as it has it");
  /* CALLERS2 (manual 6a trap): an engine clock that is ready with a large error (a page just loaded) is not taken while this module's own
     estimate is better, and a caller waits for a good clock before it takes a shared instant */
  C._reset();
  C.adopt({ ...fakeClock(5000), error: () => 280 });
  ok(C.source() === "engine" && !C.good(), "K: with nothing better the engine's clock serves, but it is not good yet (280 ms)");
  globalThis.game.socket = { emit: (k, cb) => setTimeout(() => cb({ serverTime: pnow() + 4000 + 0.3 }), 2) };
  const e = await C.settle(800);
  ok(C.source() === "own" && C.good() && e <= C.ERR_OK && Math.abs(C.offset() - 4000) < 10, `K: settle pings until the clock is good; the better own estimate wins over the slow engine clock (${C.source()}, error ${Number(e).toFixed(1)} ms)`);
  C.adopt({ ...fakeClock(4000), error: () => 1.2 });
  ok(C.source() === "engine" && C.offset() === 4000, "K: once the engine's clock is good it is the table's clock again");
  const t0 = pnow(); await C.settle(500);
  ok(pnow() - t0 < 30, "K: settle returns at once when the clock is good");
  ok(/!Clock\.good\(\)\) await Clock\.settle\(/.test(src("../splash/main.mjs")) && /!Clock\.good\(\)\) await Clock\.settle\(/.test(src("../tokenreact/main.mjs")), "K: the splash and the token reactions wait for a good clock before they put a shared instant on the page");
  C._reset();
  delete globalThis.game;
}

/* ---------- W: sound words in both languages ---------- */
{
  const FAM = Object.keys(WD.FAMILIES);
  const all = new Set([...FAM.flatMap((f) => SL.ACTIONS[f]), ...FAM.flatMap((f) => SL.missFor(f)), ...SL.FAIL, ...SL.PUSHPRE, ...SL.PUSHFAIL, ...SL.WRECK, "WHAM!"]);
  const sounds = [...all].filter((w) => !WD.ACTION_WORDS.has(w) && !(w in SL.SFX_KEYS) && !SL.KEEP_EN.includes(w));
  ok(sounds.length >= 90, `W: the splash's sound words are all found (${sounds.length})`);
  for (const w of sounds) {
    const t = w.replace(/[!…]+$/, "");
    eq(LW.crossRefusal(t, "en", { group: "voice" }), null, `W: ${w} reads as no word in Polish either (the engine's two-language check)`);
    eq(LW.refusal(t, "en", { group: "voice" }), null, `W: ${w} is no English word`);
  }
  ok(!sounds.some((w) => /^GRR+OMM!$/.test(w)) && WD.FAMILIES.quake.ranks.ordinary.includes("HRROMM!") && WD.FAMILIES.quake.ranks.strong.includes("HRRRROMM!"), "W: the quake rumbles as the engine's own banks do (HRROMM! / HRRRROMM!, not the Polish GROM)");
  eq([WD.soundOf("HRROMM!", "quake"), WD.soundOf("HRRRROMM!", "quake")], [{ mood: "crash", kind: "rumble" }, { mood: "crash", kind: "rumble" }], "W: the new words keep the rumble's sound and motion");
  /* the token reactions letter the engine's vocabulary: every kind x loudness x step x language they ask, many seeds */
  const v = LW.createVocab(); let n = 0, bad = [];
  for (const kinds of Object.values(P.VOCAB_KIND)) for (const vk of kinds) for (const lang of ["en", "pl"]) for (let s = 0; s < 12; s++) for (const loud of [0.15, 0.4, 0.7, 1]) {
    for (const x of [...(v.series(vk, 5, { lang, loud, seed: `c${s}|${vk}` }) ?? []), v.word(vk, { lang, loud, seed: `c${s}|${vk}` })]) {
      if (!x?.text) continue; n++;
      const t = x.text.replace(/[!…]+$/, "");
      if (LW.crossRefusal(t, lang, { kind: vk })) bad.push(`${lang} ${vk} ${x.text}`);
    }
  }
  ok(n > 2000 && !bad.length, `W: the token reactions' ${n} words pass the two-language check (${bad.slice(0, 5).join(", ")})`);
}

/* ---------- M: the standing footprint is the engine's (L.measure stand / standBox, 1.9.18); the boxes hold it ---------- */
{
  /* group(): pad 0 and a number as before; a per-side pad moves the word inside its slot, the numbers keep their gap from the ink */
  const a = { cap: 40, aspect: 3, tall: 1.3, nums: ["-2"], numCap: 32, side: 1, up: 0.4, down: 0.2 };
  const g0 = P.group(a);
  eq(P.group({ ...a, pad: 0 }), g0, "M: pad 0 = the box as before");
  eq(P.group({ ...a, pad: 0.1 }), P.group({ ...a, pad: { l: 0.1, r: 0.1, u: 0.1, d: 0.1 } }), "M: one number = the same pad on every side");
  const pd = { l: 0.05, r: 0.2, u: 0.04, d: 0.18 }, g1 = P.group({ ...a, pad: pd });
  ok(Math.abs(g1.w - g0.w - 40 * 0.25) < 1e-6 && Math.abs(P.group({ ...a, nums: [], pad: pd }).h - P.group({ ...a, nums: [] }).h - 40 * 0.22) < 1e-6, "M: the word's slot grows by its footprint on each side");
  const half = 40 * 3 * 1.04 / 2, inkL = g1.word.dx - half - 40 * pd.l, inkR = g1.word.dx + half + 40 * pd.r;
  const gap0 = g0.nums[0].dx - (g0.word.dx + half), gap1 = g1.nums[0].dx - inkR;
  ok(inkL >= -g1.w / 2 - 1e-6 && Math.abs(gap1 - gap0) < 1e-6, `M: the word's ink stays in its slot and the number keeps its gap from the ink (${gap0.toFixed(1)} px)`);
  eq(P.footPad(null, { w: 3, h: 1 }), 0, "M: no measure: no footprint");
  /* the real engine (fonts in node): every reaction word's standing ink (L.measure stand, checked by the engine against every painted
     frame) stays inside its group box; another zoom measures the same caps (one device pixel per CSS px on every seat) */
  const { setup } = await import("../letters/testenv.mjs");
  const E = await setup(); const L = E.engine; L.lookStyle("invincible");
  const tok = E.addToken("t1", 1950, 1450);
  let n = 0, worst = -Infinity, alike = 0, lives = 0, rimmed = 0;
  for (const [stat, from, to] of [["health", 8, 7], ["health", 8, 4], ["health", 8, 0], ["health", 0, 3], ["resolve", 8, 6], ["resolve", 8, 0], ["resolve", 4, 7]]) for (const lang of ["en", "pl"]) for (let s = 0; s < 3; s++) {
    const c = P.classify({ stat, from, to, max: 8 }), lk = P.look({ show: true, kind: c.kind, num: c.n }, c, lang, `m${s}`);
    lk.word = P.wordFor(lk, L.vocab, { lang, seed: `m${s}` }); if (!lk.word) continue;
    const o = { space: "world", token: tok.document, anchor: "center", reduced: false, fit: "screen", mood: lk.mood, sound: lk.sound, magnitude: lk.magnitude, seed: `m${s}`, hold: lk.hold, rotation: lk.rotation, colors: lk.colors, ...lk.motion, at: { x: 2000, y: 1400 }, view: { dpr: 1 } };
    const me = L.measure(lk.word, o), h0 = me.plan._holdBox, px = me.px, pad = P.footPad(me, h0);
    const me2 = L.measure(lk.word, { ...o, view: { dpr: 1, zoom: 0.6 } }), pad2 = P.footPad(me2, me2.plan._holdBox);
    if (Math.max(...["l", "r", "u", "d"].map((k) => Math.abs(pad[k] - pad2[k]))) <= 0.02) alike++;
    lives += me.life ? 1 : 0; rimmed += me.rim > 0 ? 1 : 0;
    const g = P.group({ cap: px, aspect: h0.w, tall: h0.h, nums: ["-3"], numCap: px * 0.8, side: 1, up: 0.4, down: 0.2, pad });
    const k = px / me.unit;
    const sb = { l: g.word.dx - me.stand.l * k, r: g.word.dx + me.stand.r * k, t: g.word.dy - me.stand.u * k, b: g.word.dy + me.stand.d * k };
    worst = Math.max(worst, -g.w / 2 - sb.l, sb.r - (g.nums[0].dx - px * 0.8 * 0.25), -g.h / 2 - sb.t, sb.b - g.h / 2);
    n++;
  }
  ok(lives > 0 && rimmed === n, `M: the measured footprint holds the life (${lives} of ${n}) and every map word's rim (${rimmed})`);
  ok(n >= 30 && worst <= 0.01, `M: ${n} real reaction words: the engine's standing ink stays inside the group box and clear of the number (worst ${worst.toFixed(2)} px over)`);
  ok(alike >= n - 2, `M: the footprint in caps is the same at another zoom for ${alike} of ${n} (the rim's pixel floor/cap may move a hair)`);
  /* the splash: roomOf reads the engine's footprint per size; the block's footprint (out.foot) holds every part's standing ink */
  const LP = await import("../splash/letter-plan.mjs");
  eq(LP.roomOf({ w: 3, h: 1 }, 60), {}, "M: no measured footprint: no room (the old pad and grow decide)");
  const r = LP.roomOf({ w: 3, h: 1.2, reach: { l: 1.9, r: 1.9, u: 0.9, d: 1.1 }, footAt: (S) => ({ l: 0.05, r: 0.21, u: 0.05, d: 0.19 + 4 / S }) }, 100).room;
  ok(Math.abs(r.stand.r - 21) < 1e-6 && Math.abs(r.stand.d - 23) < 1e-6 && r.l === Math.max(5, 190 - 150), `M: roomOf = the engine's footprint per side at that size (r ${r.stand.r} px, d ${r.stand.d} px) and the measured reach`);
  const frame = { vh: 900, ref: 900, safe: { l: 0, t: 0, r: 1600, b: 900 }, focus: { x: 800, y: 450 } };
  const items = [{ role: "word", text: "POW!", cap: 0.1 }];
  const plain = (it, S) => ({ w: 2 * S, h: 1.2 * S, grow: 1 }), withRoom = (it, S) => ({ ...plain(it, S), ...LP.roomOf({ w: 2, h: 1.2, footAt: () => ({ l: 0.3, r: 0.4, u: 0.3, d: 0.45 }) }, S) });
  const a0 = LP.composeMoment(items, frame, plain), b0 = LP.composeMoment(items, frame, withRoom);
  ok(Math.abs((b0.rect.r - b0.rect.l) - (a0.rect.r - a0.rect.l)) < 0.5 && b0.foot && b0.foot.r > b0.foot.l && b0.foot.b > b0.foot.t, `M: the block's outline is unchanged; the footprint past it comes back per side as out.foot`);
  const T = { x: 800, y: 600, l: 760, t: 560, r: 840, b: 640 }, ft = { ...frame, token: T, gap: 6 };
  const b2 = LP.composeMoment(items, ft, withRoom);
  ok(b2.side === "above" && Math.abs((T.t - 6 - b2.rect.b) - b2.foot.b) < 1.5, "M: above its token the block stands its footprint off it");
  /* CALLERS2: inside a block, each part's standing ink keeps off the other parts' letters (the critical's caption rows: before, the life of
     3 SIXES stood on THE ODDS ARE SHATTERED! and that on 1 IN 216, 12-20 px in the before/after harness) */
  {
    const crit = [{ role: "word", text: "HAYMAKER!", cap: 0.12 }, { role: "six", text: "3 SIXES", cap: 0.04 }, { role: "say", text: "THE ODDS ARE SHATTERED!", cap: 0.04 }, { role: "odds", text: "1 IN 216", cap: 0.035 }];
    const fp = { l: 0.12, r: 0.3, u: 0.12, d: 0.35 };
    const bare = (it, S) => ({ w: it.text.length * 0.5 * S, h: S, grow: 1 }), withFp = (it, S) => ({ ...bare(it, S), ...LP.roomOf({ w: it.text.length * 0.5, h: 1, footAt: () => fp }, S) });
    const inkOn = (o) => {
      let w = 0;
      for (const a of o.items) for (const q of o.items) {
        if (a === q) continue;
        const al = { l: a.x - a.w / 2 - fp.l * a.S, r: a.x + a.w / 2 + fp.r * a.S, t: a.y - a.h / 2 - fp.u * a.S, b: a.y + a.h / 2 + fp.d * a.S }, qb = { l: q.x - q.w / 2, r: q.x + q.w / 2, t: q.y - q.h / 2, b: q.y + q.h / 2 };
        w = Math.max(w, Math.min(Math.max(0, Math.min(al.r, qb.r) - Math.max(al.l, qb.l)), Math.max(0, Math.min(al.b, qb.b) - Math.max(al.t, qb.t))));
      }
      return w;
    };
    const o1 = LP.composeMoment(crit.map((i) => ({ ...i })), frame, withFp), o0 = LP.composeMoment(crit.map((i) => ({ ...i })), frame, bare);
    ok(inkOn(o1) < 0.5 && inkOn(o0) > 5, `M: a critical's parts stand their footprint apart (ink on another part's letters ${inkOn(o1).toFixed(1)} px; without the footprint ${inkOn(o0).toFixed(1)} px)`);
    /* a seat's own panel: the footprint counts (CALLERS-3), the outline alone would not move the block */
    const one = { rect: { l: 500, t: 300, r: 700, b: 400 }, items: [{ x: 600, y: 350, w: 200, h: 100, S: 100 }] };
    const loc = { safe: { l: 0, t: 0, r: 1600, b: 900 }, avoid: [{ l: 705, t: 300, r: 900, b: 400 }] }, std = { l: 0, t: 0, r: 1600, b: 900 };
    const f1 = LP.localFix({ ...structuredClone(one), foot: { l: 10, t: 10, r: 10, b: 10 } }, { avoid: [], gap: 6 }, loc, std, null), f0 = LP.localFix(structuredClone(one), { avoid: [], gap: 6 }, loc, std, null);
    ok(f1.moved === "shift" && f1.out.rect.r + 10 <= 705 && f0.moved === "none", `M: this seat's panel 5 px past the letters but under their footprint moves the block (${f1.moved}, right edge ${f1.out.rect.r}); without a footprint it stays`);
    const lp = src("../splash/letter-plan.mjs");
    ok(/if \(!frame\.bare && items\.some\(it => measure\(it, 40\)\?\.room\)\)/.test(lp) && /letterHits\(c, frame\) < ph - 0\.5/.test(lp) && /foot && !frame\.bare &&/.test(lp), "M: a block with no clean place for its footprint takes the outline-clean one, else the one whose letters cover least (never worse than before)");
  }
  /* the real engine's footprint for a splash word (the map's world word has a rim, the screen word none) */
  const om = { mood: "impact", magnitude: 1, seed: "s1", anchor: "center", reduced: false };
  const fw = L.measure("KA-THOOM!", { ...om, space: "world", keepInView: false, fit: "exact", size: 60, view: { dpr: 1, zoom: 0.4 } });
  const fs2 = L.measure("KA-THOOM!", { ...om, fit: "exact", size: 60, view: { dpr: 1 } });
  ok(fw.rim > 0 && fs2.rim === 0 && fw.stand.d > fs2.stand.d, `M: on the map the measured footprint holds the rim (${fw.rim.toFixed(3)} caps), on the screen there is none`);
  const s = src("../splash/stage.mjs");
  ok(/m\.footAt = footAt\(/.test(s) && /LE\.measure\(text, \{ \.\.\.o, fit: 'exact', size: key \/ \(sizeK \|\| 1\), view \}\)/.test(s) && /zoom: SP\.REF_VH \/ \(GRID_VH \* gs\)/.test(s), "M: the splash measures each part's footprint at the size it tries, at the board's scale on the map and one device pixel per CSS px");
  const mm = src("../tokenreact/main.mjs");
  ok(/pad: P\.footPad\(m, hb\)/.test(mm) && /view: \{ dpr: 1 \}/.test(mm), "M: a reaction's word is measured once (L.measure: hold box, footprint, reach) at one device pixel per CSS px before it is placed");
  ok(/P\.edgeBox\(plan\.g, plan\.cap \|\| 0, plan\.reach\)/.test(mm) && /P\.clampInto\(P\.clampInto\(c, eb, std\), eb, safe\)/.test(mm), "M: follow keeps the reach inside the standard and this seat's view");
  E.restoreWarn();
}

done("check-callers");
