/* node scripts/tactics/check-ldic.mjs -- builder LDIC (2026-11-13): the moment after a roll, lettered by the comic lettering engine
   (scripts/letters/, contract v1). Pinned here:
     (a) the plan (scripts/splash/letter-plan.mjs, pure): every kind of roll gets its letterings (good, bad, critical, a miss, a routine
         miss, a pushed roll, a wreck), the word's mood says the kind of action, size / loudness / pitch / colour say how good or bad,
         the numbers are lettered and keep their own colours, everything fits the stage, every text letters with the engine's characters
         in English and in Polish;
     (b) the stage (scripts/splash/stage.mjs) with a fake DOM and a fake engine: one L.play per lettering, in order, on the same seed on
         every client (message id + role), inside the splash layer, inside the viewport at 1366x768 and 1920x1080, reduced motion handed
         on, a newer splash / clearAll stops the words; without the engine the classic splash plays;
     (c) the sources: main.mjs keeps every rule of who sees what before the lettered stage, the stub engine (no renderer) is not used,
         the setting exists in both languages. */
import { readFileSync } from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as LP from "../splash/letter-plan.mjs";
import * as SLang from "../splash/lang.mjs";

const here = new URL(".", import.meta.url);
const src = (p) => readFileSync(new URL(p, here), "utf8");
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd, rng = seq([0.1, 0.5, 0.9, 0.3])) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng, st: null, dryN: 0 });
const roles = (p) => p.items.map((it) => it.role);
const by = (p, r) => p.items.find((it) => it.role === r);
const plan = (e, o = {}) => LP.planMoment(e, { W: 746, ...o });

/* ================================================================== (a) the plan */
{
  const good = ev({ n: 5, sixes: 2 }), bad = ev({ n: 6, sixes: 0 }), crit = ev({ n: 4, sixes: 4 }), routine = ev({ n: 1, sixes: 0 });
  const rare = ev({ n: 12, sixes: 0 }), pushed = ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3 });
  const pushedMiss = ev({ n: 5, sixes: 0, pushed: true, rerolled: 4 }), wreck = ev({ n: 6, sixes: 3, wreck: true });
  eq(roles(plan(good)), ["word", "six", "say", "odds"], "a good roll: the word, the sixes, the sentence and the odds");
  eq(roles(plan(ev({ n: 8, sixes: 1 }))), ["word", "six"], "a routine success (no odds sentence): the word and the sixes");
  eq(roles(plan(crit)), ["word", "six", "say", "odds"], "a critical roll: the same parts");
  eq(roles(plan(routine)), ["word"], "a routine miss (more likely than not): one quiet word");
  eq(roles(plan(rare)), ["word", "say", "odds"], "a rare miss: the word, UNLUCKY / WHAT A FLOP and the odds of missing");
  eq(roles(plan(bad)), ["word"], "a common miss: the word alone");
  eq(roles(plan(pushed)), ["pre", "word", "six", "say", "odds"], "a pushed roll: the grunt first, then the result");
  eq(roles(plan(pushedMiss)), ["pre", "word"], "a pushed roll that missed: the grunt, then the break");
  eq(roles(plan(wreck)), ["word", "wreck", "six", "say", "odds"], "a wreck: the crash word beside the hit");
  ok(by(plan(pushed), "word").delay >= by(plan(pushed), "pre").delay + by(plan(pushed), "pre").hold, "the push grunt is gone before the result comes");
  const g = plan(good), d = (r) => by(g, r).delay;
  ok(d("word") < d("six") && d("six") < d("say") && d("say") < d("odds"), "the order of the beat: word, sixes, sentence, odds");
  ok(d("odds") - d("word") <= 500, "the numbers come within half a second of the word (one moment)");

  /* what kind of action: the word's own sound */
  const mood = (action, word) => LP.moodOf(word, action);
  eq([mood("slugfest", "WHAM!"), mood("shooting", "KRAK!"), mood("dodge", "ZIP!"), mood("presence", "ROAR!"), mood("shooting", "ZAP!"), mood("generic", "BOOM!")],
    ["impact", "crack", "whoosh", "roar", "zap", "boom"], "the mood follows the sound of the word (a hit, a crack, a whoosh, a roar, a zap, a boom)");
  for (const w of [...Object.values(SL.ACTIONS).flat(), ...SL.PUSHPRE, ...SL.WRECK]) ok(w in LP.WORD_MOOD, `every sound word has its mood (${w})`);
  const moods = new Set(Object.values(SL.ACTIONS).flat().map((w) => LP.WORD_MOOD[w]));
  ok(moods.size >= 8, `the action words use many shapes of sound (${moods.size} moods)`);

  /* how good: louder, bigger, higher, grittier, hotter */
  const pw = (s) => by(plan(ev({ n: 6, sixes: s })), "word");
  const low = pw(1), mid = pw(3), top = pw(6);
  ok(low.sound.loud < mid.sound.loud && mid.sound.loud < top.sound.loud, "a rarer success is louder");
  ok(low.size < mid.size && mid.size < top.size, "... and bigger");
  ok(low.sound.pitch < top.sound.pitch && top.sound.pitch > 0, "... and rises higher");
  ok(top.sound.rough > low.sound.rough, "... and has more grit");
  ok(low.colors === null && Array.isArray(top.colors) && top.colors.length === 3, "a weak success keeps the mood's own colours (variety); a strong one climbs the power scale");
  ok(LP.powerColors(0.2)[1] !== LP.powerColors(0.95)[1], "the power scale changes colour from low to top");
  const hex = /^#[0-9a-f]{6}$/i;
  for (const P of [0, 0.3, 0.6, 1]) ok(LP.powerColors(P).every((c) => hex.test(c)) && LP.powerColors(P, 150).every((c) => hex.test(c)), `the power colours are hex (the engine reads #rrggbb; hsl() turned the top rolls grey live) P=${P}`);
  for (const c of [LP.SIX_COLORS, LP.ODDS_COLORS, LP.STRESS_COLORS, LP.FAIL_COLORS, LP.SOFT_COLORS]) ok(c.every((x) => hex.test(x)), "fixed palettes are hex");
  ok(by(plan(ev({ n: 6, sixes: 4, npc: true })), "word").colors[1] !== by(plan(ev({ n: 6, sixes: 4 })), "word").colors[1], "an opponent's success has its own colours");
  /* how bad */
  const bw = by(plan(bad), "word"), rw = by(plan(rare, { dF: 1 }), "word"), sw = by(plan(routine), "word");
  eq([bw.mood, sw.mood], ["fail", "tick"], "a miss falls (fail); a routine miss mutters (tick)");
  ok(bw.sound.pitch < 0 && rw.sound.pitch < bw.sound.pitch, "a miss falls in pitch, a rare one further");
  ok(rw.sound.loud > bw.sound.loud && rw.size > bw.size && sw.size < bw.size && sw.sound.loud < bw.sound.loud, "a rare miss is loud, a routine one small and quiet");
  eq([bw.colors, sw.colors], [LP.FAIL_COLORS, LP.SOFT_COLORS], "misses are cold grey-blue, routine ones grey");
  const crackEv = { ...pushedMiss, word: "CRACK!" };
  eq(by(plan(crackEv), "word").mood, "crack", "a pushed roll that broke on CRACK! cracks");

  /* the numbers are lettered, in their own steady colours */
  eq(by(g, "six").text, "2 SIXES", "the sixes are lettered with their count");
  eq(by(plan(ev({ n: 3, sixes: 1 })), "six").text, "1 SIX", "... one six");
  eq([by(g, "six").colors, by(g, "odds").colors], [LP.SIX_COLORS, LP.ODDS_COLORS], "sixes are always gold, the odds a white stamp");
  ok(by(plan(ev({ n: 6, sixes: 4 })), "six").size > by(plan(ev({ n: 6, sixes: 1 })), "six").size, "more sixes, bigger figure");
  eq(LP.planStress(2).colors, LP.STRESS_COLORS, "the stress number is blood red");
  eq(LP.planStress(2).mood, "pain", "... and hurts (mood pain)");
  ok(/ - PUSH$/.test(by(plan(pushed), "odds").text), "a pushed roll's odds say PUSH after the figure (FXLD: one caption row)");

  /* fits: readable sizes, held long enough (FXLD: the stage-percent positions went; where things go is composeMoment's, pinned in
     check-fxld.mjs: inside the free window, nothing overlapping, at 1366 and 1920, token near every edge) */
  for (const token of [false, true]) {
    for (const e of [good, bad, crit, routine, rare, pushed, pushedMiss, wreck]) {
      const p = LP.planMoment(e, { token, dF: 0.8 });
      for (const it of p.items) {
        ok(it.wMax > 0 && it.wMax <= 0.8 && it.cap > 0, `${token ? "token" : "screen"} ${it.role}: a width share and a cap height`);
        ok(it.size >= 14, `${it.role}: cap height ${it.size} px readable`);
        ok(it.hold >= 300, `${it.role}: holds long enough to be read`);
      }
    }
  }
  ok(by(g, "word").size >= 2 * by(g, "odds").size, "hierarchy: the word is at least twice the odds figure");
  ok(by(plan(crit), "word").hold > by(plan(ev({ n: 8, sixes: 1 })), "word").hold, "a critical roll holds longer than a routine one");
  ok(plan(good, { holdK: 2 }).end > plan(good, { holdK: 1 }).end * 1.6, "the Hold setting stretches the moment");
  ok(plan(good, { reduced: true }).items.every((it) => !it.rotation), "reduced motion: no extra tilt");

  /* every text letters with the engine's characters, English and Polish */
  const allowed = /^[\p{L}\p{N}!?\-+'. \n]+$/u;
  const texts = [];
  const eventsFor = () => [good, bad, crit, routine, rare, pushed, pushedMiss, wreck, ev({ n: 9, sixes: 2 }), ev({ n: 20, sixes: 9 })];
  for (const lang of ["en", "pl"]) {
    const D = lang === "pl" ? SLang.PL : SLang.EN, F = (k, d) => String(D[k] ?? SLang.EN[k]).replace(/\{(\w+)\}/g, (_, x) => d[x]);
    SL.setLabels({ oneIn: (n) => F("INSPLASH.Badge.OneIn", { n }), miss: (n) => F("INSPLASH.Badge.Miss", { n }), push: D["INSPLASH.Badge.Push"], stress: (n) => F("INSPLASH.Badge.Stress", { n }),
      words: Object.fromEntries(Object.values(SL.SAYS).map((k) => [k, D[`INSPLASH.Say.${k}`]])) });
    for (const e of eventsFor()) for (const it of LP.planMoment({ ...e, tag: null }, { dF: 0.8 }).items) texts.push([lang, it.text]);
    for (const t of Object.keys(SL.SAYS)) texts.push([lang, SL.say(t)]);
    texts.push([lang, LP.planStress(3).text], [lang, SL.LBL.miss(SL.fmtOdds(1234))], [lang, SL.oddsLabel(1 / 123456)]);
    if (lang === "pl") ok(texts.some(([l, t]) => l === "pl" && /[ĄĆĘŁŃÓŚŹŻ]/.test(t)), "PL: Polish letters reach the lettering");
  }
  SL.setLabels({ oneIn: (n) => "1 IN " + n, miss: (n) => "1 IN " + n + " TO MISS", push: "PUSH", stress: (n) => "STRESS +" + n, words: {} });
  for (const w of [...SL.FAIL, ...SL.SOFTFAIL, ...SL.PUSHFAIL]) texts.push(["en", w]);
  for (const [lang, t] of texts) { const x = LP.letterable(t); ok(allowed.test(x) && x.trim().length > 0, `${lang}: "${t}" letters as "${x}"`); }
  eq(LP.letterable("HMM…"), "HMM...", "the ellipsis becomes three dots");
  eq(LP.letterable("1 IN 1,234"), "1 IN 1234", "a thousands comma goes");
  eq([LP.seedOf("msg1", "word"), LP.seedOf(null, "word")], ["msg1:word", undefined], "seed: message id + role (none in a preview: random)");
}

/* ================================================================== (b) the stage, fake DOM + fake engine */
function fakeDom(W, H) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } }, attrs: {},
      _cls: new Set(), className: "",
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, contains: (c) => self.className.split(" ").includes(c) }; },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { c.parent = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
      animate() { return { onfinish: null, cancel() {} }; }, getAnimations: () => [], querySelectorAll() { return []; }, querySelector() { return null; },
      get clientWidth() { return parseFloat(this.style.width) || 0; }, scrollWidth: 0, textContent: "",
      getBoundingClientRect() {
        const w = parseFloat(this.style.width) || 0, ratio = this.className.includes("on-token") ? 0.75 : 9 / 16, h = w * ratio;
        const cx = this.style.left ? parseFloat(this.style.left) : (W - 300) / 2, cy = this.style.top ? parseFloat(this.style.top) : (this.className.includes("full") ? 0.5 : 0.4) * H;
        return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
      } };
    return e;
  };
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t), getElementById: (id) => (id === "sidebar" ? { getBoundingClientRect: () => ({ left: W - 300, width: 300 }) } : null), querySelector: () => null };
  return doc;
}
function fakeEngine() {
  const calls = []; let n = 0;
  const L = { calls, play(text, o) { const h = { id: "h" + ++n, hand: `hand-${o.seed ?? n}`, alive: true, stops: [], moves: [], stop(x) { h.alive = false; h.stops.push(x); }, moveTo(a) { h.moves.push(a); }, ready: Promise.resolve(), finished: new Promise(() => {}) }; calls.push({ text, o, h }); return h; } };
  return L;
}
async function run(W, H, fn) {
  globalThis.document = fakeDom(W, H);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  const Stage = await import(`../splash/stage.mjs?${W}x${H}-${Math.random()}`);
  const S = await import("../splash/splash.mjs");
  const flush = (upTo = 1e9) => { let t; while ((t = timers.filter((x) => !x.done && x.ms <= upTo).sort((a, b) => a.ms - b.ms)[0])) { t.done = true; t.f(); } };
  return fn({ Stage, S, flush, timers });
}
{
  for (const [W, H] of [[1366, 768], [1920, 1080]]) {
    await run(W, H, async ({ Stage, S, flush }) => {
      const L = fakeEngine();
      Stage.setLetters(L);
      ok(Stage.lettersOn(), `${W}: the engine is on`);
      const e = ev({ n: 5, sixes: 3, stress: 2 });
      const ctl = Stage.play(e, { scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "MSG1", resolve: () => ({ now: 5, max: 8 }) });
      flush(2000);
      eq(L.calls.map((c) => c.o.seed), ["MSG1:word", "MSG1:six", "MSG1:say", "MSG1:odds", "MSG1:stress"], `${W}: one L.play per lettering, in order, seeded by the message`);
      ok(L.calls.every((c) => c.o.space === "screen" && c.o.parent === ctl.lw && ctl.lw.parent?.attrs["aria-hidden"] === "true"), `${W}: drawn into the moment's wrapper inside the aria-hidden splash layer`);
      ok(L.calls.every((c) => c.o.at.x >= 0 && c.o.at.x <= W - 300 && c.o.at.y >= 0 && c.o.at.y <= H), `${W}x${H}: every lettering is placed on screen, left of the chat (${JSON.stringify(L.calls.map((c) => c.o.at))})`);
      ok(L.calls.every((c) => c.o.at.x + c.o.maxWidth / 2 <= W - 300 + 2), `${W}: nothing reaches under the chat (FXLD: was 40 px slack)`);
      eq(L.calls[1].o.avoid, [L.calls[0].h.hand], `${W}: the sixes look different from the word (avoid = the word's hand)`);
      eq(L.calls[0].o.reduced, false, `${W}: full motion handed on`);
      /* FXLD: the composition measures every box, so the size is exact (fit "exact"); the magnitude still goes along */
      ok(L.calls.every((c) => c.o.hold > 0 && c.o.fit === "exact" && c.o.size > 0 && c.o.magnitude >= 0 && c.o.mood), `${W}: hold, magnitude, exact size and mood given (the layout knows every box)`);
      ok(L.calls[1].o.in === "slam" && L.calls[1].o.out === "pop", `${W}: the motion technique reaches the engine`);
      ok(L.calls.some((c) => c.o.seed === "MSG1:stress" && /\+2/.test(c.text)), `${W}: the stress number is lettered`);
      /* a second client: the same message letters the same */
      const L2 = fakeEngine(); Stage.setLetters(L2);
      Stage.play(e, { scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "MSG1", resolve: () => ({ now: 5, max: 8 }) });
      flush(10000);
      eq(L2.calls.map((c) => [c.text, c.o.seed, c.o.size, c.o.mood, JSON.stringify(c.o.sound), c.o.colors]), L.calls.map((c) => [c.text, c.o.seed, c.o.size, c.o.mood, JSON.stringify(c.o.sound), c.o.colors]), `${W}: another client gets identical lettering calls`);
      ok(L.calls.every((c) => c.h.stops.length && c.h.stops[0].quick === true), `${W}: a newer splash on the same place stops the old words at once`);
      /* reduced */
      S.setReduced(true);
      const L3 = fakeEngine(); Stage.setLetters(L3);
      Stage.play(ev({ n: 3, sixes: 0 }), { scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "MSG2" });
      flush(20000);
      ok(L3.calls.length === 1 && L3.calls[0].o.reduced === true && L3.calls[0].o.rotation === 0, `${W}: reduced motion handed on to the engine`);
      S.setReduced(false);
      /* clearAll (scene change) */
      const L4 = fakeEngine(); Stage.setLetters(L4);
      Stage.play(ev({ n: 6, sixes: 4 }), { scale: 1, hold: 1, fx: 0, fullFrom: 0.7, seed: "MSG3" });
      flush(30000);
      Stage.clearAll();
      ok(L4.calls.length >= 2 && L4.calls.every((c) => c.h.stops.length), `${W}: a scene change stops every word`);
      /* without the engine: the classic splash, no lettering */
      Stage.setLetters(null);
      const L5 = fakeEngine();
      const c5 = Stage.play(ev({ n: 4, sixes: 2 }), { scale: 1, hold: 1, fx: 0, fullFrom: null, seed: "MSG4" });
      flush(40000);
      ok(!c5.lw && L5.calls.length === 0, `${W}: without the engine the classic splash plays`);
      /* the display layer: on the map = the engine's world space, scene coordinates, scene px */
      globalThis.canvas = { ready: true, stage: { scale: { x: 0.5 }, toLocal: (q) => ({ x: q.x * 2 + 100, y: q.y * 2 + 100 }), toGlobal: (q) => q }, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } } };
      const L6 = fakeEngine(); Stage.setLetters(L6); Stage.setLayer("tokens");
      Stage.play(ev({ n: 5, sixes: 2 }), { scale: 1, hold: 1, fx: 0, fullFrom: null, seed: "MSG5" });
      flush(50000);
      const w0 = L6.calls[0];
      ok(w0 && w0.o.space === "world" && w0.o.layer === "tokens" && !w0.o.parent, `${W}: layer "on the map: over tokens": the words go to the canvas (world space, the engine's tokens layer)`);
      ok(w0 && w0.o.fit === "exact" && w0.o.size > 0 && w0.o.magnitude > 0 && w0.o.at.x > 100, `${W}: ... in scene coordinates and scene px (FXLD: the block zooms as one)`);
      eq(document.body.children.find((c) => c.attrs?.["aria-hidden"] === "true")?.dataset?.layer, "tokens", `${W}: the layer knows its setting`);
      Stage.setLayer("ui");
      const L7 = fakeEngine(); Stage.setLetters(L7);
      Stage.play(ev({ n: 5, sixes: 2 }), { scale: 1, hold: 1, fx: 0, fullFrom: null, seed: "MSG6" });
      flush(60000);
      ok(L7.calls.length && L7.calls.every((c) => c.o.space === "screen" && c.o.layer === "ui" && !c.o.parent), `${W}: layer "over the bars": the engine's ui layer, not our wrapper`);
      Stage.setLayer("nonsense"); eq(Stage.layerOf(), "screen", `${W}: an unknown layer value falls back to over everything`);
      delete globalThis.canvas;
    });
  }
}

/* ================================================================== (a2) the motion technique: the word's mood plus the result */
{
  const w = (e, o) => by(plan(e, o), "word");
  const top = w(ev({ n: 4, sixes: 4 })), miss = w(ev({ n: 6, sixes: 0 })), soft = w(ev({ n: 1, sixes: 0 })), rare = w(ev({ n: 12, sixes: 0 }));
  eq([top.in, top.holdKind], ["slam", "shake"], "a top roll slams in and shakes");
  ok(["burst", "shatter"].includes(top.out), "... and bursts or shatters away");
  eq([miss.in, miss.holdKind, miss.out], ["drop", "wobble", "droop"], "a miss drops, wobbles and droops away");
  eq(rare.out, "fall", "a rare miss falls away");
  eq([soft.in, soft.out], ["pop", "dissolve"], "a routine miss pops and dissolves");
  const mid = w(ev({ n: 6, sixes: 2 }));
  ok(!mid.in && !mid.out, "a middling success keeps the motion its word's mood picks (variety)");
  const z = LP.motionOf({ role: "word", mood: "whoosh" }, { power: 0.9 });
  eq([z.in, z.out], ["zip", "zipout"], "a whoosh keeps zipping even at the top");
  eq([by(plan(ev({ n: 5, sixes: 2 })), "six").in, LP.planStress(2).holdKind], ["slam", "throb"], "the sixes stamp in, the stress throbs");
  const MOT = { in: ["slam", "pop", "crackIn", "drop", "rise", "grow", "zip"], holdKind: ["boil", "shake", "throb", "rattle", "wobble", "buzz", "flicker"], out: ["shatter", "pop", "burst", "fall", "droop", "rise", "shrink", "zipout", "dissolve"] };
  for (const e of [ev({ n: 4, sixes: 4 }), ev({ n: 6, sixes: 0 }), ev({ n: 1, sixes: 0 }), ev({ n: 12, sixes: 0 }), ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3 }), ev({ n: 6, sixes: 3, wreck: true })])
    for (const it of [...plan(e).items, LP.planStress(1)]) for (const k of Object.keys(MOT)) if (it[k]) ok(MOT[k].includes(it[k]), `${it.role}: ${k} "${it[k]}" is one of the engine's motions`);
}

/* ================================================================== (a3) sizes: cap heights from the viewport (FXLD: the composition sizes
   every lettering itself, exactly, from the viewport height; the engine's size model is no longer asked, see check-fxld.mjs) */
{
  const px = (it, vw, vh, full = false) => {
    const safe = { l: 60, t: 40, r: vw - 300, b: vh - 80 };
    const lay = LP.composeMoment([it], { vh, safe, focus: { x: (vw - 300) / 2, y: vh * 0.42 }, token: null });
    return lay.items[0].S;
  };
  for (const [vw, vh] of [[1366, 768], [1920, 1080]]) {
    for (const e of [ev({ n: 6, sixes: 1 }), ev({ n: 6, sixes: 3 }), ev({ n: 4, sixes: 4 }), ev({ n: 12, sixes: 0 }), ev({ n: 6, sixes: 0 }), ev({ n: 1, sixes: 0 })]) {
      const p = LP.planMoment(e, {});
      const w = by(p, "word"), six = by(p, "six"), odds = by(p, "odds");
      if (six) ok(px(w, vw, vh) > px(six, vw, vh), `${vw}: the word (${px(w, vw, vh).toFixed(0)} px) over the sixes (${px(six, vw, vh).toFixed(0)} px)`);
      if (odds) ok(px(six ?? w, vw, vh) >= px(odds, vw, vh), `${vw}: the sixes over the odds`);
      for (const it of p.items) ok(px(it, vw, vh) >= 15, `${vw}x${vh} ${it.role}: legible (${px(it, vw, vh).toFixed(0)} px)`);
    }
    const crit = by(LP.planMoment(ev({ n: 4, sixes: 4 }), { full: true }), "word"), routine = by(LP.planMoment(ev({ n: 6, sixes: 1 }), {}), "word");
    ok(px(crit, vw, vh) > 1.8 * px(routine, vw, vh), `${vw}: a critical word is far bigger than a routine one (${px(crit, vw, vh).toFixed(0)} vs ${px(routine, vw, vh).toFixed(0)} px)`);
  }
  const at = (vw, vh) => px(by(LP.planMoment(ev({ n: 6, sixes: 3 }), {}), "word"), vw, vh);
  ok(Math.abs(at(1366, 768) - by(LP.planMoment(ev({ n: 6, sixes: 3 }), {}), "word").size) < 3, "at 1366x768 the word is the designed size");
  ok(at(1920, 1080) > at(1366, 768) * 1.3, "a bigger window, a bigger moment");
  eq([LP.magnitudeOf({ role: "word" }, ev({ n: 4, sixes: 4 })) > 1, LP.magnitudeOf({ role: "word" }, ev({ n: 1, sixes: 0 })) <= 0.1], [true, true], "magnitude: a crit over 1, a routine miss near 0");
}

/* ================================================================== (b2) the real engine's design (pure): the calls stage.mjs makes */
{
  const fs = await import("node:fs");
  const { FontBank } = await import("../letters/fontbank.mjs");
  const { makePlan, FONTS } = await import("../letters/design.mjs");
  const bank = new FontBank();
  for (const [id, f] of Object.entries(FONTS)) { const b = fs.readFileSync(new URL(`../letters/${f.file}`, import.meta.url)); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
  const api = { adv: (f, c) => bank.adv(f, c) };
  const momentHands = (e, seedBase, mem) => {
    const hands = [];
    for (const it of LP.planMoment(e, { W: 746 }).items) {
      const o = { mood: it.mood, sound: it.sound, colors: it.colors ?? undefined, seed: LP.seedOf(seedBase, it.role), avoid: hands.slice(), reduced: false };
      hands.push(makePlan(LP.letterable(it.text), o, api, o.seed == null ? mem : []).hand.id);
    }
    return hands;
  };
  const e = ev({ n: 6, sixes: 3 });
  const a = momentHands(e, "MSGX", []), b = momentHands(e, "MSGX", ["some-recent-hand", "another"]);
  eq(a, b, "real design: the same message letters the same hands on two clients with different recent memories");
  ok(new Set(a).size === a.length, `real design: every lettering of one moment has its own hand (${a.join(" / ")})`);
  const looks = new Set(["m1", "m2", "m3", "m4", "m5", "m6"].map((m) => momentHands(e, m, [])[0]));
  ok(looks.size >= 4, `real design: different rolls, different word looks (${looks.size} of 6)`);
  const crit = makePlan("WHAM!", { mood: "impact", sound: by(plan(ev({ n: 4, sixes: 4 })), "word").sound, seed: "s" }, api, []);
  const weak = makePlan("WHAM!", { mood: "impact", sound: by(plan(ev({ n: 8, sixes: 1 })), "word").sound, seed: "s" }, api, []);
  ok(crit.sizeK > weak.sizeK, `real design: a critical WHAM! is lettered bigger than a routine one (${crit.sizeK.toFixed(2)} > ${weak.sizeK.toFixed(2)})`);
  const { LAYERS } = await import("../letters/engine.mjs");
  const Stage0 = src("../splash/stage.mjs");
  const ids = (name) => JSON.parse(/export const SCREEN_LAYERS = (\[[^\]]*\]), WORLD_LAYERS = (\[[^\]]*\])/.exec(Stage0)[name === "s" ? 1 : 2].replace(/'/g, '"'));
  ok(ids("s").every((k) => LAYERS[k]?.space === "screen") && ids("w").every((k) => LAYERS[k]?.space === "world"), "every layer the setting offers is one of the engine's, in the right space");
  const pl = makePlan(LP.letterable("SZANSE ROZBITE! 1 NA 1,296"), { mood: "tick", seed: "pl" }, api, []);
  ok(pl && pl.hand, "real design: a Polish sentence with a figure letters");
}

/* ================================================================== (c) the sources */
{
  const m = src("../splash/main.mjs"), st = src("../splash/stage.mjs");
  const iPlay = m.indexOf("Stage.play(ev, {\n      rnd: mulberry32");
  ok(iPlay > 0 && ["visibleToMe(message)", "cs('others')", "waitDice(message)", "Moment.verdict", "resolveToken(message)"].every((k) => m.lastIndexOf(k, iPlay) > m.indexOf("hook('createChatMessage'")), "the lettered moment comes after every rule of who sees it (visible, others, dice, verdict, token)");
  ok(/resolve, seed: id\n/.test(m) && /resolve, seed: message\.id \}\);/.test(m), "the seed is the message id (the same lettering on every client)");
  ok(/L\.design\?\.\('A'\)\?\.stub === true/.test(m) && /Stage\.setLetters\(stub \|\| !cs\('lettering'\) \? null : L\)/.test(m), "the stub engine (no renderer) and the setting off leave the classic splash");
  ok(/if \(lettersOn\(\)\) return playLetters\(ev, o\);/.test(st), "Stage.play letters when the engine is there (and its master switch is on)");
  ok(!/game\.|message\./.test(st.slice(st.indexOf("function playLetters"), st.indexOf("function stressLettered"))), "the lettered stage reads nothing of the message or the game (only the event and the Resolve reader it is handed)");
  for (const L of [SLang.EN, SLang.PL]) ok(["Name", "Hint", "screen", "ui", "hud", "overlay", "weather", "tokens", "ground"].every((k) => L[`INSPLASH.Settings.Layer.${k}`]), "the layer setting and its seven choices (the engine's layers) are named in both languages");
  ok(m.includes("client('layer', {") && /client\('layer', \{[^\n]*default: 'screen'/.test(m) && m.includes("Stage.setLayer(cs('layer'))"), "the layer setting (client) defaults to over everything and is applied at ready");
  for (const L of [SLang.EN, SLang.PL]) ok(L["INSPLASH.Settings.Lettering.Name"] && L["INSPLASH.Settings.Lettering.Hint"], "the lettering setting is named in both languages");
}
done("ldic");
