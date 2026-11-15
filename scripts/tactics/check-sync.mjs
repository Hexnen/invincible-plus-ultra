import "../tokenreact/impact-node-prime.mjs";      // CALLERS2: the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
/* node scripts/tactics/check-sync.mjs -- fixer SYNC (2026-11-14): the owner's binding ruling "the GM and the players see the same MOMENT"
   (blind two-seat review ADVX finding 5: a critical's word and impact landed 171 and 291 ms apart between GM and player; token-hit impact
   frames about two film frames apart). Seats are modelled with their own page clocks, their own dice durations, report delays, late timers,
   Effects levels and reduced motion. Every check here failed on tactics @ 361d5ff (tactics-integrated-123) or guards the new rule:
     S1  the table's clock (shared-clock.mjs): the fastest ping's offset is within half its round trip; Foundry's averaged serverTime is not;
     S2  the shared start (beat.mjs): seats whose dice stop up to WINDOW after the roll's stamp, 0.85 s apart (the live spread), with
         random report delays, a late seat and a missing seat, ALL compute the same start; ordinary rolls start as promptly as before
         (latest stop + MARGIN); a missing seat holds the table at most until the shared bound;
     S3  the map layer's dice fade is the table's (any seat lettering on the map adds the same fade on every seat);
     S4  the splash (stage.mjs): one shared instant, seats that reach play() at different moments (compose time, a late timer), with Effects
         full / reduced / off and reduced motion start the result word on the same shared instant and put the impact's peak on it;
     S5  the call sites: main.mjs hands the shared instant to Stage.play and no per-seat poll or sleep sits between the shared start and it;
     S6  token reactions: the blow's instant comes from the change's server stamp (sharedHit), not from this seat's timer. */
import fs from "node:fs";
import { ok, eq, done, seeded } from "./testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as C from "../shared-clock.mjs";
import { impactApi } from "../tokenreact/impact-node.mjs";   // CALLERS2: fake engines carry the engine's public impact table

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

/* ================================================================== S1: the table's clock */
{
  const rnd = seeded(51);
  /* a server clock; a seat whose page clock starts at another origin; pings whose answers are sometimes read late (a busy frame) */
  const trials = [];
  for (let k = 0; k < 40; k++) {
    const pageOrigin = 1.7e12 + rnd() * 1e6;   // server ms at this page's performance.now() = 0
    const S = [], foundry = { dts: [] };
    let pnow = 1000 + rnd() * 5000, worstFoundry = 0;
    for (let i = 0; i < 12; i++) {
      const out = 0.5 + rnd() * 2, back = 0.5 + rnd() * 2, busy = rnd() < 0.35 ? 15 + rnd() * 60 : 0;
      const t0 = pnow, serverAt = pageOrigin + t0 + out, t1 = t0 + out + back + busy;
      S.push(C.sample(t0, t1, Math.floor(serverAt)));
      /* Foundry's GameTime.sync: the last answer, minus the AVERAGE one-way time of the last four */
      foundry.dts.push(t1 - t0); if (foundry.dts.length > 4) foundry.dts.shift();
      const dt = Math.round(foundry.dts.reduce((a, b) => a + b, 0) / (foundry.dts.length * 2));
      const fOff = Math.floor(serverAt) - (t1 - dt);
      worstFoundry = Math.max(worstFoundry, Math.abs(fOff - pageOrigin));
      pnow = t1 + 3000 + rnd() * 7000;
    }
    const e = C.estimate(S, pnow);
    trials.push({ ours: Math.abs(e.off - pageOrigin), bound: e.rtt / 2 + 0.5, foundry: worstFoundry });
  }
  const worst = Math.max(...trials.map((t) => t.ours)), worstF = Math.max(...trials.map((t) => t.foundry));
  ok(trials.every((t) => t.ours <= t.bound + 1e-9), `S1: the kept offset is within half the fastest round trip (+0.5 ms tick) in every trial (worst ${worst.toFixed(2)} ms)`);
  ok(worst <= 3, `S1: two seats on this clock differ by at most ~2 x ${worst.toFixed(2)} ms (local server pings of 1-4 ms)`);
  ok(worstF >= 10, `S1: Foundry's averaged serverTime errs by tens of ms after a busy frame (worst ${worstF.toFixed(1)} ms): that is why it is not the table's clock`);
  ok(C.estimate([{ off: 5, rtt: 9, at: 0 }, { off: 1, rtt: 2, at: 1 }, { off: 7, rtt: 30, at: 2 }])?.off === 1, "S1: estimate keeps the fastest sample");
  ok(C.estimate([{ off: 1, rtt: 2, at: 0 }, { off: 4, rtt: 6, at: 200000 }], 200000)?.off === 4, "S1: a sample older than KEEP_MS is dropped (the clocks drift)");
  ok(C.sample(10, 5, 1e12) === null && C.sample(1, 3, NaN) === null, "S1: a broken answer is no sample");
}
/* S1b: the server's two clocks (seen live 2026-11-14: the "time" socket answered ~5.2e7, documents carry epoch ms ~1.79e12). A seat learns
   their difference from stamped documents (the least delayed one wins) and maps an epoch stamp onto the table's clock. */
{
  C._reset();
  const UP = 5.2e7, K = 1.79e12;                       // server clock now; epoch minus server clock
  const pOrigin = UP - performance.now();
  const g0 = globalThis.game;
  globalThis.game = { socket: { emit: (n, cb) => cb({ serverTime: Math.floor(performance.now() + pOrigin) }) } };
  await C.ping();
  globalThis.game = g0;
  const now = C.serverNow();
  ok(Math.abs(now - (performance.now() + pOrigin)) < 5, "S1b: the table's clock is the time socket's (uptime) scale");
  ok(C.epochToServer(K + now) === null, "S1b: an epoch stamp maps to nothing before any stamp was heard");
  for (const delay of [30, 4, 55, 12]) C.noteEpoch(K + now - delay, now);   // documents made at now-delay, heard at now
  ok(Math.abs(C.epochOffset(now) - (K - 4)) < 0.01, "S1b: the least delayed stamp gives the clocks' difference");
  ok(Math.abs(C.epochToServer(K + now - 1000) - (now - 996)) < 0.01, "S1b: an epoch stamp lands on the table's clock (to within the fastest delivery)");
  C.noteEpoch(UP, now);
  ok(Math.abs(C.epochOffset(now) - (K - 4)) < 0.01, "S1b: a non-epoch number is not a stamp");
  const m = src("../splash/main.mjs");
  ok(/ev\.t0 = Math\.round\(Clock\.serverNow\(\)\)/.test(m) && /const t0 = Number\(message\?\.flags\?\.\[FLAG\]\?\.ev\?\.t0\)/.test(m) && !/function stampOf\(message\) \{ const t = Number\(message\?\.timestamp\)/.test(m),
    "S1b: the roll's shared bound starts at the roller's table-clock instant (flag t0), never at the epoch message.timestamp");
  C._reset();
}

/* ================================================================== S2 + S3: the shared start */
let modN = 0;
const freshBeat = () => import(`../splash/beat.mjs?sync-${++modN}`);
/* a table of seats on one virtual server clock. seats: [{ u, stop (server ms its dice stop; null: never), lat (ms a report travels to the
   others), x }]. ref = the roll's stamp. Late seats (stop > ref + WINDOW) race the bound as main.mjs does. -> { at per seat, B } */
async function table(seats, { ref = 0, legacy = false } = {}) {
  const mods = await Promise.all(seats.map(() => freshBeat()));
  const B = mods[0];
  let T = ref; const due = [];
  const sleep = (ms) => new Promise((r) => due.push({ at: T + ms, r }));
  const env = () => (legacy ? { now: () => T, sleep } : { now: () => T, sleep, ref });
  const starts = {};
  const expected = seats.map((s) => s.u);
  const bound = ref + B.WINDOW;
  const run = async (s, i) => {
    if (s.stop == null) return;   // never reports, never plays (a closed tab)
    /* its report goes to the others when its dice stop */
    const sendAt = s.stop;
    due.push({ at: sendAt, r: () => { mods.forEach((m, j) => { if (j === i) m.note("M", s.u, s.stop, s.x ?? 0); else due.push({ at: T + (s.lat ?? 40) + (seats[j].lat ?? 0) * 0, r: () => m.note("M", s.u, s.stop, s.x ?? 0) }); }); } });
    const late = !legacy && s.stop > bound;
    const joinAt = late ? bound : s.stop;
    while (T < joinAt) await sleep(joinAt - T);
    const r = await mods[i].start("M", s.u, late ? null : s.stop, expected, { ...env(), x: s.x ?? 0 });
    starts[s.u] = legacy ? T : r.at;
    if (!legacy) starts[s.u + ":r"] = r;
  };
  const ps = seats.map(run);
  for (let i = 0; i < 4000 && Object.keys(starts).filter((k) => !k.includes(":")).length < seats.filter((s) => s.stop != null).length; i++) {
    await null; await null; await null; await null;
    due.sort((a, b) => a.at - b.at);
    const d = due.shift(); if (!d) continue;
    T = Math.max(T, d.at); d.r();
  }
  await Promise.race([Promise.all(ps), new Promise((r) => setTimeout(r, 0))]);
  return { starts, B };
}
{
  const { B } = { B: await freshBeat() };
  /* the review's spread: the GM's dice stopped ~0.85 s after the player's (the roller's) */
  const live = [{ u: "p1", stop: 3150, lat: 30 }, { u: "gm", stop: 4000, lat: 30 }];
  const old = await table(live, { legacy: true });
  ok(old.starts.p1 !== old.starts.gm, `S2 (the cause): with the old own-stop cap two seats 0.85 s apart start ${Math.abs(old.starts.p1 - old.starts.gm)} ms apart (player ${old.starts.p1}, GM ${old.starts.gm})`);
  const now = await table(live, { ref: 0 });
  ok(now.starts.p1 === now.starts.gm, `S2: ... now they start on the same server instant (player ${now.starts.p1}, GM ${now.starts.gm})`);
  eq(now.starts.gm, 4000 + B.MARGIN, "S2: ... the latest stop + MARGIN (as prompt as before for the seat that stopped last)");
  /* random tables: 2-4 seats, dice spread up to 2.5 s, report delays 2-200 ms, sometimes a late seat or one that never reports */
  const rnd = seeded(77);
  let agree = 0, prompt = 0, promptN = 0, bounded = true, trials = 0;
  for (let k = 0; k < 120; k++) {
    const n = 2 + Math.floor(rnd() * 3);
    const base = 2500 + rnd() * 1500;
    const seats = Array.from({ length: n }, (_, i) => ({ u: `s${i}`, stop: Math.round(base + rnd() * 2500), lat: Math.round(2 + rnd() * 198), x: rnd() < 0.2 ? 380 : 0 }));
    const mode = rnd();
    if (mode < 0.15) seats[n - 1].stop = B.WINDOW + 400 + Math.round(rnd() * 3000);      // its dice are late (slow machine, slow dice setting)
    else if (mode < 0.25 && n > 2) seats[n - 1].stop = null;                              // it never reports
    const t = await table(seats, { ref: 0 });
    trials++;
    const ats = seats.filter((s) => s.stop != null).map((s) => t.starts[s.u]);
    if (ats.every((a) => a === ats[0])) agree++;
    const counted = seats.filter((s) => s.stop != null && s.stop <= B.WINDOW);
    if (mode >= 0.25 && counted.length === n) {
      promptN++;
      const want = Math.max(...counted.map((s) => s.stop)) + B.MARGIN + Math.max(0, ...counted.map((s) => s.x));
      if (ats[0] === want) prompt++;
    }
    if (ats[0] > B.WINDOW + B.SLACK + B.MARGIN + 380 + 1) bounded = false;
  }
  eq(agree, trials, `S2: in ${trials} random tables (2-4 seats, dice 0-2.5 s apart, reports 2-200 ms on the way, late and missing seats) every seat computes the same start`);
  eq(prompt, promptN, `S2: when every seat reports in time the start is exactly the latest stop + MARGIN (+ a map seat's fade) (${promptN} tables)`);
  ok(bounded, "S2: a late or missing seat holds the table at most until the roll's stamp + WINDOW + SLACK");
  /* a missing seat with everyone else early */
  const miss = await table([{ u: "gm", stop: 3000, lat: 20 }, { u: "p1", stop: 3100, lat: 20 }, { u: "p2", stop: null }], { ref: 0 });
  ok(miss.starts.gm === miss.starts.p1 && miss.starts.gm === B.WINDOW + B.SLACK, `S2: a seat that never reports: the others start together at the shared bound + SLACK (${miss.starts.gm} / ${miss.starts.p1})`);
  ok(miss.starts["gm:r"].waited <= B.WINDOW + B.SLACK - 3000 + 1, `S2: ... and they wait for it only until the shared bound (${Math.round(miss.starts["gm:r"].waited)} ms after their dice)`);
  /* a late seat joins the table's instant (it does not drag the others, nor start on its own) */
  const late = await table([{ u: "gm", stop: 3000, lat: 20 }, { u: "p1", stop: B.WINDOW + 900, lat: 20 }], { ref: 0 });
  ok(late.starts.gm === late.starts.p1 && late.starts["p1:r"].late === true, `S2: a seat whose dice stop after the bound joins the table's start (GM ${late.starts.gm}, player ${late.starts.p1}, late ${late.starts["p1:r"].late})`);
  /* S3: one seat letters on the map: every seat adds its fade */
  const map = await table([{ u: "gm", stop: 3000, lat: 20, x: 380 }, { u: "p1", stop: 3200, lat: 20, x: 0 }], { ref: 0 });
  ok(map.starts.gm === map.starts.p1 && map.starts.gm === 3200 + B.MARGIN + 380 && map.starts["p1:r"].base === 3200 + B.MARGIN,
    `S3: a seat lettering on the map adds the dice fade for the whole table (both start at ${map.starts.gm}; dice faded at the base ${map.starts["p1:r"].base})`);
  /* the old N8 (no stamp) still behaves as before */
  const leg = await table([{ u: "gm", stop: 1000, lat: 40 }, { u: "p1", stop: 1180, lat: 40 }], { legacy: true });
  ok(leg.starts.gm === leg.starts.p1, "S2: without a stamp (preview, old message) the old rule still agrees for seats within its cap");
}

/* ================================================================== S4: the splash on several seats from one shared instant */
function fakeDom(W, H) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "", anims: [],
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, contains: (c) => self.className.split(" ").includes(c), remove() {} }; },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
      animate(k, o) { this.anims.push(o); return { onfinish: null, cancel() {} }; }, getAnimations: () => [], querySelectorAll() { return []; }, querySelector() { return null; },
      get clientWidth() { return parseFloat(this.style.width) || 0; },
      getBoundingClientRect() { const w = parseFloat(this.style.width) || 0, h = w * 0.6; return { left: 0, top: 0, width: w, height: h, right: w, bottom: h }; } };
    return e;
  };
  const R = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: (id) => (id === "sidebar" ? { getBoundingClientRect: () => R(W - 300, 0, 300, H) } : null),
    querySelector: () => null, querySelectorAll: () => [] };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style?.zIndex ?? "auto", display: "block", visibility: "visible", opacity: "1" });
  return doc;
}
const { planImpact } = await import("../letters/impact/plan.mjs");
/* the word's contact as the engine plans it (live 2026-11-14: 104 ms with its own flash frame, 62 without (`flash: false`, one 24 Hz tick
   shorter); reduced motion modelled as another entrance with a later contact) */
const CONTACT = (op) => (op?.flash === false ? 83 : 125) + (op?.reduced ? 42 : 0);
function fakeEngine(rec, reducedSeat) {
  const box = (text) => ({ w: 0.6 * String(text).length + 0.3, h: 1.3 });
  return { prefs: { enabled: true, scale: 1, motion: reducedSeat ? "reduced" : "full" },
    planFor: (text, op) => ({ plan: { _holdBox: box(text), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` }, contactMs: CONTACT(op) }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) { const h = { hand: `hand-${op.seed}`, alive: true, off: false, stop() { h.alive = false; }, moveTo() {}, ready: Promise.resolve(true), finished: new Promise(() => {}) }; rec.words.push({ text, o: op, page: rec.clock() }); return h; },
    contactAt: (h) => null,
    impact: { ...impactApi(), play(spec) { rec.impacts.push({ spec, page: rec.clock() }); return { alive: true }; }, plan: (spec) => planImpact(spec) } };
}
let runN = 0;
/* one seat: its page clock is shared - origin; it reaches Stage.play `late` ms after the shared instant (compose, a late timer) */
async function seatPlay(e, { origin, late = 0, fx = 1, reduced = false, layer = "screen" }) {
  const W = 1600, H = 900;
  globalThis.document = fakeDom(W, H);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: reduced }) };
  const SHARED = 5_000_000;                 // the table's instant (server ms)
  let page = SHARED - origin + late;        // this page's clock when play() is called
  const timers = [];
  globalThis.performance = { now: () => page };
  globalThis.setTimeout = (f, ms) => { timers.push({ f, at: page + (ms || 0) }); return timers.length; };
  globalThis.clearTimeout = () => {};
  const Stage = await import(`../splash/stage.mjs?sync-${++runN}`);
  const S = await import("../splash/splash.mjs");
  S.setReduced?.(reduced);
  const rec = { words: [], impacts: [], clock: () => page };
  Stage.setLetters(fakeEngine(rec, reduced)); Stage.setLayer(layer);
  Stage.play(e, { token: null, scale: 1, hold: 1, fx, fullFrom: null, seed: "SYNC-roll", targets: [], from: null, resolve: () => null, at: SHARED - origin });
  for (let g = 0; g < 200; g++) { const t = timers.filter((x) => !x.done).sort((a, b) => a.at - b.at)[0]; if (!t || t.at > SHARED - origin + 3000) break; t.done = true; page = Math.max(page, t.at); t.f(); }
  Stage.clearAll();
  const toShared = (p) => p + origin;
  const word = rec.words.find((w) => /:word$/.test(w.o.seed ?? ""));
  return { wordStart: word ? Math.round(toShared(word.o.startAt) * 100) / 100 : null, wordContact: word ? Math.round(toShared(word.o.startAt + CONTACT(word.o)) * 100) / 100 : null, blow: rec.impacts[0] ? Math.round(toShared(rec.impacts[0].spec.blowAt) * 100) / 100 : null,
    words: rec.words.map((w) => ({ seed: w.o.seed, start: Math.round(toShared(w.o.startAt) + CONTACT(w.o)) })), impacts: rec.impacts.length };      // each part at its contact (reduced motion: its own later entrance)
}
{
  const ev = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng: () => 0.4, st: null, dryN: 0 });
  for (const [name, e] of [["critical", ev({ n: 3, sixes: 3 })], ["strong", ev({ n: 5, sixes: 2 })], ["ordinary", ev({ n: 4, sixes: 1 })]]) {
    const seats = {
      gm: await seatPlay(e, { origin: 1.0e6, late: 0 }),
      player: await seatPlay(e, { origin: 3.3e6, late: 70 }),                   // reached play() 70 ms later (layout, a late timer)
      reducedFx: await seatPlay(e, { origin: 2.1e6, late: 20, fx: 0.5 }),       // Effects: reduced (one strength lower)
      noFx: await seatPlay(e, { origin: 4.4e6, late: 35, fx: 0 }),              // Effects: off (no impact drawn)
      reducedMotion: await seatPlay(e, { origin: 5.5e6, late: 10, reduced: true })
    };
    const starts = Object.entries(seats).filter(([k]) => k !== "reducedMotion" && k !== "noFx").map(([, s]) => s.wordStart);
    ok(starts.every((s) => s != null && s === starts[0]), `S4 ${name}: the result word starts on ONE shared instant on every seat drawing the same entrance (${Object.entries(seats).map(([k, s]) => `${k} ${s.wordStart}`).join(", ")})`);
    const hits = Object.values(seats).map((s) => s.wordContact);
    ok(hits.every((s) => s != null && s === hits[0]), `S4 ${name}: the result word STRIKES (its contact) on one shared instant on every seat, reduced motion included (${Object.entries(seats).map(([k, s]) => `${k} ${s.wordContact}`).join(", ")})`);
    const drawn = Object.entries(seats).filter(([, s]) => s.blow != null);
    if (e.power >= 0.5) ok(drawn.length >= 3 && drawn.every(([, s]) => s.blow === drawn[0][1].blow), `S4 ${name}: the impact's blow is one shared instant wherever one is drawn (${drawn.map(([k, s]) => `${k} ${s.blow}`).join(", ")})`);
    const all = Object.values(seats).map((s) => s.words.map((w) => `${w.seed}@${w.start}`).join(" "));
    ok(all.every((x) => x === all[0]), `S4 ${name}: every part of the block (the word's strike, sixes, caption) lands on the same shared instants on every seat`);
  }
}

/* ================================================================== S5: the call sites */
{
  const m = src("../splash/main.mjs");
  ok(/const serverNow = \(\) => Clock\.serverNow\(\);/.test(m), "S5: the splash's server clock is the table's clock (shared-clock.mjs)");
  ok(/Beat\.start\(id, game\.user\.id, own, seatsFor\(message\), \{[^}]*ref: ref/.test(m), "S5: the shared start is bounded by the roll's instant on the table's clock (flag t0), not by each seat's own stop");
  ok(/Promise\.race\(\[settled\(message\), Clock\.sleepUntil\(bound\)/.test(m), "S5: a seat whose dice still roll at the bound joins the table's instant");
  ok(/at: Clock\.toPage\(at\),/.test(m), "S5: Stage.play gets the shared instant (on this page's clock)");
  ok(!/await sleep\(ev\.stress/.test(m) && !/await Stage\.diceClear\(/.test(m), "S5: no per-seat sleep or dice poll between the shared start and the moment");
  ok(/Clock\.driveGrid\(L\)/.test(m), "S5: the engine's stepped grid runs on the table's clock");
  const s = src("../splash/stage.mjs");
  ok(/ctl\.t0 = Number\.isFinite\(o\.at\) \? o\.at : performance\.now\(\);/.test(s) && /o\.startAt = \(Number\.isFinite\(ctl\.t0\) \? ctl\.t0 \+ \(Number\(it\.delay\) \|\| 0\)/.test(s), "S5: the stage schedules every lettering from the shared instant");
  ok(/ctl\.impactTiming = LE\?\.impact\?\.play \? IP\.impactFor\(ev, \{ fx: 1 \}\)/.test(s), "S5: the word's lead for its impact is the table's (full Effects), whatever this seat draws");
}

/* ================================================================== S6: token reactions */
{
  const t = src("../tokenreact/main.mjs");
  ok(/const T0s = sharedHit\(ready, performance\.now\(\), Clock\.toPage, P\.HIT_LEAD\);/.test(t), "S6: the blow's instant is the table's (sharedHit), not this seat's now + HIT_LEAD");
  ok(/shared\(e, srvStamp\(options\)/.test(t), "S6: a change's instant is its server stamp (options.modifiedTime)");
  ok(!/Math\.max\(performance\.now\(\) \+ 1, tHit - contact\)/.test(t), "S6: a word a little behind still strikes on the table's instant (its entrance may start in the past)");
}

done("check-sync");
