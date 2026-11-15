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

done("check-callers");
