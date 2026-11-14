/* node scripts/sweep-checks/wire1-splash.mjs -- WIRE1 (2026-11-14): impact frames (the engine's L.impact) in the dice-roll splash.
   Fails on tactics @ 3a7701d (nothing called L.impact; the critical had a 170 ms flash and a shake of its own). Pinned (the owner): the
   critical first, strong results a short accent, nothing below; one per event at the instant the word lands; no flash or shake of our own
   on top; the same impact on every seat (the event decides, not a seat's setting); a hero this seat does not see is never handed in;
   reduced motion passed as true only; no caller key reaches the photosensitivity guard; the real guard makes every spec gentle / still.
   The page and the engine are check-fxld2's fakes (copied), the engine also records L.impact.play. */
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd, rng = seq([0.1, 0.5, 0.9, 0.3])) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng, st: null, dryN: 0 });
function fakeDom(W, H, ui = {}) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "", anims: [],
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, contains: (c) => self.className.split(" ").includes(c) }; },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
      animate(k, o) { this.anims.push(o); return { onfinish: null, cancel() {} }; }, getAnimations: () => [], querySelectorAll() { return []; }, querySelector() { return null; },
      get clientWidth() { return parseFloat(this.style.width) || 0; },
      getBoundingClientRect() {
        if (this.className.includes("ins-badge")) return { left: 0, top: 0, width: 150, height: 60, right: 150, bottom: 60 };
        const w = parseFloat(this.style.width) || 0, h = w * 0.6;
        const cx = parseFloat(this.style.left) || W / 2, cy = parseFloat(this.style.top) || H / 2;
        return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
      } };
    return e;
  };
  const R = (l, t, w, h) => ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h });
  const rects = {
    "#sidebar": R(W - 300, 0, 300, H),
    "#hotbar": R(W * 0.3, H - 64, 520, 56),
    "#scene-controls": R(0, 40, 48, H - 200),
    "#scene-navigation li": R(104, 16, 170, 32),
    ...(ui.card ? { "#chat-notifications .chat-log > li": R(W - 361, H * 0.45, 295, 260) } : {}),
    ...(ui.party ? { "#invincible-party li": [R(60, H - 330, 230, 70), R(60, H - 255, 230, 70)] } : {})
  };
  const el = (r) => ({ getBoundingClientRect: () => r });
  const dice = mk("canvas"); dice.style.zIndex = String(ui.diceZ ?? 0);
  dice.getBoundingClientRect = () => R(0, 0, W, H);
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: (id) => (id === "sidebar" ? el(rects["#sidebar"]) : id === "dice-box-canvas" && ui.diceZ != null ? dice : null),
    querySelector: () => null, querySelectorAll: (s) => { const r = rects[s]; return r ? (Array.isArray(r) ? r : [r]).map(el) : []; } };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style.zIndex ?? "auto", display: e.style.display ?? "block", visibility: "visible", opacity: e.style.opacity ?? "1" });
  return doc;
}
function fakeEngine(o = {}) {
  const calls = []; let n = 0;
  const box = (text) => { const lines = String(text).split("\n"); return { w: 0.6 * Math.max(...lines.map((l) => l.length)) + 0.3, h: 1.2 * lines.length + 0.1 }; };
  const L = { calls, prefs: o.prefs ?? { enabled: true, scale: 1 },
    planFor: (text, op) => ({ plan: { _holdBox: box(text), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` } }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) {
      const h = { id: "h" + ++n, hand: `hand-${op.seed ?? n}`, alive: true, off: false, stops: [], moves: [], stop(x) { h.alive = false; h.stops.push(x); }, moveTo(a) { h.moves.push(a); }, ready: Promise.resolve(true), finished: new Promise(() => {}) };
      calls.push({ text, o: op, h }); return h;
    } };
  return L;
}
const tok = (id, x, y, o = {}) => ({ id, visible: o.visible ?? true, document: { id, x, y, width: o.size ?? 1, height: o.size ?? 1, hidden: !!o.hidden, texture: { scaleX: o.k ?? 1, scaleY: o.k ?? 1 } },
  x, y, w: 100 * (o.size ?? 1), h: 100 * (o.size ?? 1), center: { x: x + 50 * (o.size ?? 1), y: y + 50 * (o.size ?? 1) } });
let runN = 0;
async function run(W, H, ui, fn) {
  globalThis.document = fakeDom(W, H, ui);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (fn2, ms) => { timers.push({ f: fn2, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  const Stage = await import(`../splash/stage.mjs?wire1-${++runN}`);
  const S = await import("../splash/splash.mjs");
  const flush = (upTo = 1e9) => { let t; while ((t = timers.filter((x) => !x.done && x.ms <= upTo).sort((a, b) => a.ms - b.ms)[0])) { t.done = true; t.f(); } };
  return fn({ Stage, S, flush, timers });
}
function scene({ zoom = 1, pan = { x: 0, y: 0 }, tokens = [] }) {
  const view = { zoom, toClient: (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y }) };
  return { ready: true, grid: { size: 100 }, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 3000, height: 2000 } },
    stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: (q) => view.toClient(q) },
    app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
    tokens: { placeables: tokens }, notes: { placeables: [] } };
}
/* one seat playing one roll: what the engine was asked (words, impact frames), the flashes, the shakes */
async function seat({ W = 1600, H = 900, layer = "screen", e, name = "x", hero = null, tokens = [], full = true, fx = 1, gm = true, reduced = false, noImpact = false }) {
  return run(W, H, {}, async ({ Stage, S, flush }) => {
    globalThis.canvas = scene({ tokens: tokens.length ? tokens : hero ? [hero] : [] });
    globalThis.game = { user: { isGM: gm, id: gm ? "GM" : "P1" } };
    const L = fakeEngine({ prefs: { enabled: true, scale: 1 } });
    const play0 = L.play.bind(L), wordAt = [];
    const wordStart = [];
    L.play = (text, op) => { const h = play0(text, op); h.plan = { timeline: { ent: [{ ticks: 2 }, { ticks: 3 }] } }; if (/:word$/.test(op.seed ?? "")) { wordAt.push(performance.now()); wordStart.push(op.startAt ?? performance.now()); } return h; };
    const impacts = [];
    if (!noImpact) L.impact = { play(spec) { impacts.push({ spec, t: performance.now() }); return { alive: true, plan: { magnitude: spec.magnitude }, finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} }; } };
    Stage.setLetters(L); Stage.setLayer(layer); S.setReduced(reduced);
    const ctl = Stage.play(e, { token: hero, scale: 1, hold: 1, fx, fullFrom: full ? 0.7 : null, seed: "S-" + name, resolve: () => ({ now: 5, max: 8 }), backdrop: false });
    const flashes = [];
    const walk = (nd) => { if (!nd) return; if (nd.className === "ins-flash") flashes.push(nd); (nd.children ?? []).forEach(walk); };
    for (const t of [100, 300, 700, 1500, 2500]) { flush(t); walk(document.body); }
    flush(1e9);
    const moves = L.calls.reduce((a, c) => a + (c.h.moves?.length ?? 0), 0);
    const out = { impacts, flashes: [...new Set(flashes)].length, moves, wordAt, wordStart, calls: L.calls, ctl };
    Stage.clearAll(); Stage.setLayer("screen"); S.setReduced(false); delete globalThis.canvas;
    return out;
  });
}
const IP = await import("../splash/impact-plan.mjs");
const R = { crit: ev({ n: 4, sixes: 4 }), strong: ev({ n: 5, sixes: 3 }), good: ev({ n: 5, sixes: 2 }), routine: ev({ n: 1, sixes: 0 }), rare: ev({ n: 12, sixes: 0 }),
  shot: ev({ n: 5, sixes: 3, action: "shooting" }), dodge: ev({ n: 5, sixes: 3, action: "dodge" }), pushed: ev({ n: 4, sixes: 4, pushed: true, newSixes: 2, rerolled: 2, stress: 1 }) };
ok(R.crit.power >= IP.CRIT_P && R.strong.power >= IP.STRONG_P && R.strong.power < IP.CRIT_P && R.good.power < IP.STRONG_P, `(the rolls: crit P ${R.crit.power.toFixed(2)}, strong ${R.strong.power.toFixed(2)}, good ${R.good.power.toFixed(2)})`);

/* ---- the critical: ONE impact frame, the whole set for the rarest, on the hero this seat sees, at the word's landing; no own flash or shake */
{
  const hero = tok("HERO", 650, 380);
  const s = await seat({ e: R.crit, name: "c1", hero });
  const im = s.impacts[0]?.spec ?? {};
  eq(s.impacts.length, 1, "critical: one impact frame (one per event)");
  ok(im.kind === "crit" && im.magnitude >= 1.35, `critical: the critical's kind, the whole set for a 1-in-1296 roll (${im.kind} ${im.magnitude})`);
  /* FXI-SPLASH (ADVI 7, FXIS-1) replaced "the struck figure is the rolling hero": a roll strikes nobody, the impact marks the result word
     (sweep-checks/fxi-splash.mjs W); the hero never appears in the spec */
  ok(im.subject !== hero && !im.subject?.document && Number.isFinite(im.subject?.w), "critical: the impact marks the result word, not the roller (FXI-SPLASH W)");
  eq([im.over, im.seed], ["ui", "S-c1:impact"], "critical (screen layer): over the windows, under the word; seeded by the message every seat shares");
  /* FXI-SPLASH (ADVI 2) replaced "at the end of the word's whole entrance" (that was the defect: 0.2-0.4 s after the hit): the impact is now
     asked for before the word and its peak falls on the word's contact tick (sweep-checks/fxi-splash.mjs T); here: never after the word's start + entrance */
  ok(Number.isFinite(im.startAt) && s.wordStart.length && im.startAt <= s.wordStart[0] + 5 * 1000 / 24, `critical: no later than the word's entrance (${Math.round(im.startAt - (s.wordStart[0] ?? 0))} ms after the word starts)`);
  eq(s.flashes, 0, "critical: no flash of our own on top of the impact frame (the 170 ms slam flash is gone)");
  eq(s.moves, 0, "critical: no shake of our own on top (the engine's frame punch is the shove)");
  ok(!("reduced" in im) && !("photosafe" in im) && !("flashes" in im) && !("frames" in im) && !("vision" in im), `critical: nothing that could weaken the guard or override the OS reduced-motion switch (${Object.keys(im)})`);
  const lo = IP.impactFor({ ...R.crit, power: IP.CRIT_P }), hi = IP.impactFor({ ...R.crit, power: 1 });
  ok(lo.kind === "crit" && lo.magnitude >= 0.85 && lo.magnitude < hi.magnitude, `critical: rarer is stronger (${lo.magnitude} at the threshold, ${hi.magnitude} at the top)`);
}
/* ---- a strong result: a short accent (no full-field strength); below it and on a miss: none */
{
  const hero = tok("HERO", 650, 380);
  const s = await seat({ e: R.strong, name: "s1", hero, full: false });
  const im = s.impacts[0]?.spec ?? {};
  ok(s.impacts.length === 1 && im.kind === "hit" && im.magnitude < 0.85, `a strong blow (1 in ${Math.round(1 / R.strong.p)}): a short accent (${im.kind} ${im.magnitude})`);
  eq(s.moves, 0, "a strong blow: no shake of our own on top of its impact frame");
  eq(IP.impactFor(R.shot)?.kind, "shock", "a strong shot: the energy kind");
  eq(IP.impactFor(R.dodge)?.kind, "word", "a strong dodge (no blow): only the accent behind its word");
  for (const [k, e] of [["good", R.good], ["routine miss", R.routine], ["rare miss", R.rare]]) eq((await seat({ e, name: k, hero, full: false })).impacts.length, 0, `${k}: no impact frame`);
  ok(Math.max(...[0.46, 0.5, 0.6, 0.69].map((P) => IP.impactFor({ power: P, action: "slugfest", wreck: true }).magnitude)) < 0.85 && IP.impactFor({ power: 0.7, action: "slugfest" }).magnitude > IP.impactFor({ power: 0.69, action: "slugfest", wreck: true }).magnitude,
    "the critical is always stronger than any strong result (the strongest moment, the strongest frame)");
}
/* ---- one moment for the table: two seats (GM, player; one with the full screen off) get the same impact */
{
  const hero = tok("HERO", 650, 380);
  const g = await seat({ e: R.crit, name: "m", hero, gm: true, full: true });
  const p = await seat({ e: R.crit, name: "m", hero, gm: false, full: false });
  const a = g.impacts[0]?.spec, b = p.impacts[0]?.spec;
  ok(a && b && a.kind === b.kind && a.magnitude === b.magnitude && a.seed === b.seed && Math.abs((a.startAt - g.wordStart[0]) - (b.startAt - p.wordStart[0])) < 1, `GM and player: one impact (kind, strength, seed, landing tick) whatever each seat's full-screen setting (${a?.kind} ${a?.magnitude} / ${b?.kind} ${b?.magnitude})`);
}
/* ---- privacy: a hero this seat does not see is never the subject */
{
  const hid = tok("HID", 650, 380, { hidden: true }), unseen = tok("UNS", 650, 380, { visible: false });
  for (const [what, hero] of [["hidden", hid], ["out of sight", unseen]]) {
    const s = await seat({ e: R.crit, name: "h", hero, gm: false });
    const im = s.impacts[0]?.spec;
    ok(im && im.subject !== hero && !im.subject?.document && Number.isFinite(im.subject?.x) && !("from" in im), `a ${what} hero on the player's seat: the impact stands on the word's point, the token is not handed in (${JSON.stringify(im?.subject)})`);
  }
  /* FXI-SPLASH (FXIS-1): the GM too gets the impact on the word (no seat gets the roller's silhouette any more) */
  const s = await seat({ e: R.crit, name: "h", hero: hid, gm: true });
  ok(s.impacts.length === 1 && s.impacts[0].spec.subject !== hid, "... the GM gets the same impact, on the word");
}
/* ---- map layer: the shared moment over the map; an unseen hero gives a scene point */
{
  const hero = tok("HERO", 1200, 900);
  const s = await seat({ layer: "overlay", e: R.crit, name: "w", hero });
  const im = s.impacts[0]?.spec ?? {};
  ok(im.over === "scene" && im.space === "world" && im.subject !== hero && Number.isFinite(im.subject?.w), `map layer: over the map, under the bars (${im.over}), on the word in scene space (FXI-SPLASH)`);
  /* FXI-SPLASH (ADVI 10) replaced "the hero unseen by this seat: a scene point": that scene point was the privacy defect (it marked where the
     unseen roller stands). Now an unseen roller's moment has no place on the board at all on that seat */
  const u = await seat({ layer: "overlay", e: R.crit, name: "w", hero: tok("UNS", 1200, 900, { visible: false }), gm: false });
  const iu = u.impacts[0]?.spec ?? {};
  ok(iu.space !== "world" && !iu.subject?.document && u.calls.every((c) => c.o.space !== "world"), `map layer, the hero unseen by this seat: nothing on the board (${JSON.stringify(iu.subject)} ${iu.space})`);
  eq((await seat({ layer: "ui", e: R.crit, name: "u", hero })).impacts[0]?.spec?.over, "scene", "the engine's own ui layer (under the windows): the impact goes under the bars too (it would cover the word)");
}
/* ---- calm and effects */
{
  const hero = tok("HERO", 650, 380);
  eq((await seat({ e: R.crit, name: "r", hero, reduced: true })).impacts[0]?.spec?.reduced, true, "reduced motion (the splash's Motion setting / the OS): the impact is asked for calm");
  eq((await seat({ e: R.crit, name: "o", hero, fx: 0 })).impacts.length, 0, "Effects off: no impact frame");
  const lo = (await seat({ e: R.crit, name: "q", hero, fx: 0.5 })).impacts[0]?.spec;
  ok(lo && lo.magnitude <= 1.5 && lo.hitstop === false, `Effects reduced: one strength lower, no hold of the scene (${lo?.magnitude}, hitstop ${lo?.hitstop})`);
  const old = await seat({ e: R.crit, name: "n", hero, noImpact: true });
  ok(old.flashes === 1 && old.impacts.length === 0, `an engine without impact frames: the critical keeps its one short accent (${old.flashes})`);
  const pu = await seat({ e: R.pushed, name: "p", hero });
  eq(pu.impacts.length, 1, "a pushed critical: one impact frame, on its main word (after the push grunt)");
}
/* ---- the real guard over every spec this caller makes */
{
  const { planImpact, safety } = await import("../letters/impact/plan.mjs");
  const specs = [];
  for (let P = 0.46; P <= 1.001; P += 0.03) for (const action of ["slugfest", "shooting", "charge", "dodge"]) for (const wreck of [false, true]) specs.push(IP.impactFor({ power: P, action, wreck }));
  const off = specs.filter((sp) => { const p = safety(planImpact(sp), { flashes: false }, { flashLog: [], now: 0 }); return p.mode === "local" && p.frames.every((x) => !x.full && !x.stop); }).length;
  const still = specs.filter((sp) => { const p = safety(planImpact(sp), {}, { callerReduced: true, flashLog: [], now: 0 }); return p.mode === "static" && p.frames.length === 1; }).length;
  eq(off, specs.length, `flashes off: every splash impact is the gentle variant (${off}/${specs.length})`);
  eq(still, specs.length, `reduced motion: one still drawing (${still}/${specs.length})`);
}
done("wire1-splash");
const sm = summary();
console.log(`sweep wire1-splash: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
