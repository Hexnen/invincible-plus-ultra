/* node scripts/tactics/check-callers.mjs -- CALLERS: plus-ultra's lettering callers rest on what the RUNNING engine offers (engine 1.9.11+:
   one copy runs on every seat, the newest of the active modules; it carries its own table clock, measures a word before it is placed and
   reads every sound word in both languages).
     I  the token reactions' series bounds come from the running engine's impact table (L.impact.steps / .series), not from this module's
        vendored copy (pure.mjs useImpactTable); the vendored numbers stay the default (node, no engine)
     K  ONE table clock on the page: shared-clock.mjs reads the engine's L.clock once it has an answer (adopt), stops its own pings and
        leaves the engine's stepped grid alone (driveGrid); its own estimate serves only before that or under an engine without L.clock
     W  every sound word plus-ultra itself ships (the roll splash's pools, misses, push and wreck words, the attack's verdict) passes the
        engine's own checks in BOTH languages' readings (refusal + crossRefusal, the owner: onomatopoeia only); the token reactions' words
        (the engine's vocabulary, seeded per blow) too
     M  placement on the real reach and the rim (see section M below) */
import fs from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as P from "../tokenreact/pure.mjs";
import * as C from "../shared-clock.mjs";
import * as SL from "../splash/logic.mjs";
import * as WD from "../splash/words.mjs";
import * as LW from "../letters/words.mjs";
import * as IPL from "../letters/impact/plan.mjs";

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

/* ---------- I: the impact table of the running engine ---------- */
{
  eq(P.impactTable(), { steps: IPL.STEP_AT, series: { step: IPL.SERIES_STEP, max: IPL.SERIES_MAX } }, "I: without an engine the vendored table is the default");
  const spec = { kind: "hit", magnitude: 0.25 };
  const before = P.withSeries(spec, 3);
  ok(P.useImpactTable({ steps: [0.3, 0.5, 0.85, 1.35, 1.7], series: { step: 0.1, max: 2 } }) === true, "I: a running engine's table is taken");
  const other = P.withSeries(spec, 3);
  ok(P.effectiveMagnitude(other) < 0.3 && other.series <= 2, `I: the series is bounded by the RUNNING engine's next strength and places (drawn ${P.effectiveMagnitude(other)}, places ${other.series})`);
  ok(JSON.stringify(other) !== JSON.stringify(before), "I: another engine's table gives another series (the numbers are read, not baked in)");
  ok(P.useImpactTable({ steps: [0.6, 0.3] }) === false && P.useImpactTable(null) === false && P.impactTable().steps[0] === 0.3, "I: a broken table is refused (the last good one stays)");
  P.useImpactTable({ steps: IPL.STEP_AT, series: { step: IPL.SERIES_STEP, max: IPL.SERIES_MAX } });
  eq(P.withSeries(spec, 3), before, "I: the same table as the vendored one: the same series (no picture changes today)");
  const m = src("../tokenreact/main.mjs");
  ok(/P\.useImpactTable\(L\.impact\)/.test(m) && (m.match(/await runningEngine\(\)/g) ?? []).length >= 2 && !/engine = await letters\(\)|engine \?\? \(engine = await letters\(\)\)/.test(m), "I: every way token reactions get the engine hands its impact table to pure.mjs");
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
  ok(C.source() === "engine" && C.ready() && C.offset() === 123456 && C.error() === 0.7, "K: once answered, the engine's clock is the table's clock");
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
  ok(/MoinenLetters/.test(s) && /if \(engOk\(\)\) return; await ping\(\)/.test(s) && /if \(engOk\(\)\) \{ clearInterval\(timer\)/.test(s), "K: start() adopts the running engine's clock and stops its own pings once it has one");
  ok(/Clock\.driveGrid\(L\)/.test(src("../splash/main.mjs")), "K: the splash hands its engine to the clock (adopt) as soon as it has it");
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

/* ---------- M: the token reactions' boxes hold the standing word's real footprint; the view keeps its whole reach ---------- */
{
  const MO = await import("../letters/motion.mjs"), DE = await import("../letters/design.mjs");
  eq([P.STAND.lifeXY, P.STAND.lifeS, P.STAND.rimW, P.STAND.rimMin], [MO.LIFE_REACH.xy, MO.LIFE_REACH.s, DE.INV_RIM.ink.w, DE.INV_RIM.ink.min], "M: STAND mirrors the engine's life reach and ink rim (motion.mjs LIFE_REACH, design.mjs INV_RIM)");
  const hb = { w: 3, h: 1.3 };
  const p0 = P.standPad(hb, {}), p1 = P.standPad(hb, { halo: "ink", inkW: 0.04, px: 40 }), p2 = P.standPad(hb, { halo: "ink", inkW: 0.04, px: 12 });
  ok(Math.abs(p0 - (0.0225 * 3 + 0.05)) < 1e-3 && Math.abs(p1 - p0 - (0.07 + 0.024)) < 1e-3 && p2 > p1, `M: footprint = life (+ the rim of a world word, at least 2.5 px): ${p0} / ${p1} / ${p2} caps`);
  const a = { cap: 40, aspect: 3, tall: 1.3, nums: ["-2"], numCap: 32, side: 1, up: 0.4, down: 0.2 };
  const g0 = P.group(a), g1 = P.group({ ...a, pad: p1 });
  eq(P.group({ ...a, pad: 0 }), g0, "M: pad 0 = the box as before");
  const b0 = P.group({ ...a, nums: [] }), b1 = P.group({ ...a, nums: [], pad: p1 });
  ok(Math.abs(g1.w - g0.w - 2 * 40 * p1) < 1e-6 && Math.abs(b1.h - b0.h - 2 * 40 * p1) < 1e-6, "M: the word's part grows by its footprint on every side");
  const gapA = (g) => (g.nums[0].dx - g.word.dx) - (40 * 3 * 1.04 + 2 * 40 * (g === g1 ? p1 : 0)) / 2;
  ok(Math.abs(gapA(g1) - gapA(g0)) < 1e-6, "M: the number keeps its gap from the word's footprint (not from its bare hold box)");
  const reach = { l: 2.1, r: 2.1, u: 1.2, d: 1.2 }, eb = P.edgeBox(g1, 40, reach);
  ok(eb.w >= g1.w && eb.h >= g1.h && eb.w / 2 >= Math.abs(g1.word.dx) + 2.1 * 40 - 1e-9 && eb.h / 2 >= Math.abs(g1.word.dy) + 1.2 * 40 - 1e-9, "M: the edge box holds the group and the word's whole entrance reach");
  eq(P.edgeBox(g1, 40, null), { w: g1.w, h: g1.h }, "M: no reach measured: the group box");
  const m = src("../tokenreact/main.mjs");
  ok(/L\.measure \? L\.measure\(lk\.word, ro\)/.test(m) && /pad: P\.standPad\(hb, \{ halo: pl\.hand\?\.halo/.test(m) && /plan\.reach = \{ l: m\.reach\.l \/ m\.unit/.test(m), "M: a reaction's word is measured once (L.measure: hold box, rim, reach) before it is placed");
  ok(/P\.edgeBox\(plan\.g, plan\.cap \|\| 0, plan\.reach\)/.test(m) && /P\.clampInto\(P\.clampInto\(c, eb, std\), eb, safe\)/.test(m) && /view\.panelsCached\(\), safe\), eb, safe\)/.test(m), "M: follow keeps the reach inside the standard and this seat's view, the standing box off the panels");
  /* the real engine (fonts in node): every reaction word's standing footprint stays inside its group box, and the engine's reach holds it */
  const { setup } = await import("../letters/testenv.mjs");
  const E = await setup(); const L = E.engine; L.lookStyle("invincible");
  const tok = E.addToken("t1", 1950, 1450);
  let n = 0, worst = 0, reachOk = true;
  for (const [stat, from, to] of [["health", 8, 7], ["health", 8, 4], ["health", 8, 0], ["health", 0, 3], ["resolve", 8, 6], ["resolve", 8, 0], ["resolve", 4, 7]]) for (const lang of ["en", "pl"]) for (let s = 0; s < 3; s++) {
    const c = P.classify({ stat, from, to, max: 8 }), lk = P.look({ show: true, kind: c.kind, num: c.n }, c, lang, `m${s}`);
    lk.word = P.wordFor(lk, L.vocab, { lang, seed: `m${s}` }); if (!lk.word) continue;
    const o = { space: "world", token: tok.document, anchor: "center", reduced: false, fit: "screen", mood: lk.mood, sound: lk.sound, magnitude: lk.magnitude, seed: `m${s}`, hold: lk.hold, rotation: lk.rotation, colors: lk.colors, ...lk.motion, at: { x: 2000, y: 1400 } };
    const me = L.measure(lk.word, o), h0 = me.plan._holdBox, px = me.px, pad = P.standPad(h0, { halo: me.plan.hand?.halo, inkW: me.plan.hand?.inkW, px });
    ok(me.plan.hand?.halo === "ink", `M: ${lk.word}: a reaction word on the map is drawn with the ink rim (hand.halo ${me.plan.hand?.halo})`);
    const g = P.group({ cap: px, aspect: h0.w, tall: h0.h, nums: [], numCap: px * 0.8, side: 1, up: 0.4, down: 0.2, pad });
    const foot = { x: (h0.w / 2 * P.STAND.lifeS + P.STAND.lifeXY) * px + (Math.max(0.07 * px, 2.5) + (me.plan.hand?.inkW ?? 0) * 0.6 * px), y: (h0.h / 2 * P.STAND.lifeS + P.STAND.lifeXY) * px + (Math.max(0.07 * px, 2.5) + (me.plan.hand?.inkW ?? 0) * 0.6 * px) };
    worst = Math.max(worst, foot.x - g.w / 2);
    if (!(me.reach.l >= foot.x - 1.5 && me.reach.u >= foot.y - 1.5)) { reachOk = false; if (process.env.CALLERS_VERBOSE) console.log("reach", lk.word, lk.motion.in, lk.motion.holdKind, JSON.stringify(me.reach), JSON.stringify(foot), px, !!me.plan.motion?.life); }
    n++;
  }
  ok(n >= 30 && worst <= 0.5, `M: ${n} real reaction words: the standing footprint (life + rim) stays inside the group box (worst ${worst.toFixed(2)} px over)`);
  ok(reachOk, "M: the engine's measured reach holds the standing footprint (within 1.5 px: the reach is the bigger box, kept from the view's edges)");
  E.restoreWarn();
}

done("check-callers");
