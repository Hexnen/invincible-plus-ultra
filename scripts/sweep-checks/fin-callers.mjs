/* node scripts/sweep-checks/fin-callers.mjs -- FIN-CALLERS (2026-11-14): the dice-roll splash and the token reactions brought together
   (ADVI 8: an attack roll and its hit tell one story, in order) on engine 1.9.0. Every check fails without the piece it names:
     H  (FXIT-S1) the splash says its moment on `invincible-plus-ultra.splashMoment`: "start" when the roll is known (and again right before
        it plays), "land" with landAt = the instant its result word strikes and impactMs = how long its impact lasts after that, "done" on
        every way out (also when it plays nothing: skipped, dropped, cut short); the classic splash lands with impactMs 0;
     R  (FXIT-S2) a moment that has struck and stands within half a token of a token the reactions are about to strike makes room: its words
        leave ROOM_MS before the blow's instant; a far moment and a moment that has not struck yet stay;
     C  (engine 1.9.0, MOTION2) one contact rule for both callers on the real 1.9 plans (pose keys, pictures without burst or dust): the
        word's own accent tick, else its squash pose, else its biggest pose; the engine's plan.contactMs first when it has one.
   The splash's page, canvas and engine are fakes (as fxi-splash.mjs); the 1.9 plans are the real engine's (design.mjs with its fonts). */
import fs from "node:fs";
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as IP from "../splash/impact-plan.mjs";
import { planImpact } from "../letters/impact/plan.mjs";

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng: seq([0.1, 0.5, 0.9, 0.3]), st: null, dryN: 0 });
const TICK = 1000 / 24;
const HOOK = "invincible-plus-ultra.splashMoment";

/* ---------------------------------------------------------------- the splash's fake page (a trimmed fxi-splash.mjs harness) */
function fakeDom(W, H) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "", anims: [],
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, contains: (c) => self.className.split(" ").includes(c) }; },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
      animate() { return { onfinish: null, cancel() {} }; }, getAnimations: () => [], querySelectorAll() { return []; }, querySelector() { return null; },
      get clientWidth() { return parseFloat(this.style.width) || 0; },
      getBoundingClientRect() {
        const w = parseFloat(this.style.width) || 0, h = w * 0.6, cx = parseFloat(this.style.left) || W / 2, cy = parseFloat(this.style.top) || H / 2;
        return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
      } };
    return e;
  };
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style?.zIndex ?? "auto", display: "block", visibility: "visible", opacity: "1" });
  return doc;
}
const SLAM = () => ({ ent: [
  { ticks: 2, g: { s: 0.82, sx: 1.18, sy: 0.78 }, fx: [] }, { ticks: 1, g: { s: 1.12 }, fx: [], impact: true },
  { ticks: 1, g: { s: 1.6, sx: 1.08 }, fx: [{ k: "speed" }], smear: { zoom: 0.35, n: 3 } }, { ticks: 2, g: { s: 0.86, sx: 1.14, sy: 0.84 }, fx: [{ k: "burst" }] },
  { ticks: 2, g: { s: 1.05 }, fx: [] }, { ticks: 4, g: {}, fx: [] }], hold: [{ ticks: 3 }], exit: [{ ticks: 2 }] });
function fakeEngine(log, on = true) {
  const calls = []; let n = 0;
  const box = (text) => { const lines = String(text).split("\n"); return { w: 0.6 * Math.max(...lines.map((l) => l.length)) + 0.3, h: 1.2 * lines.length + 0.1 }; };
  const L = { calls, prefs: { enabled: on, scale: 1 },
    planFor: (text, op) => ({ plan: { _holdBox: box(text), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` }, timeline: SLAM() }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) {
      const h = { id: "h" + ++n, hand: `hand-${op.seed ?? n}`, alive: true, off: !on, stops: [], stop(x) { h.alive = false; h.stops.push(x); }, moveTo() {},
        ready: Promise.resolve(true), finished: new Promise(() => {}), plan: { timeline: SLAM() } };
      calls.push({ text, o: op, h }); return h;
    } };
  L.impact = {
    plan: (spec) => planImpact(spec),
    play(spec) { log.push(spec); return { alive: true, plan: planImpact(spec), finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} }; }
  };
  return L;
}
const tok = (id, x, y) => ({ id, visible: true, document: { id, x, y, width: 1, height: 1, hidden: false, texture: { scaleX: 1, scaleY: 1 } }, x, y, w: 100, h: 100, center: { x: x + 50, y: y + 50 } });
function scene(tokens) {
  return { ready: true, grid: { size: 100 }, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 4000, height: 3000 } },
    stage: { scale: { x: 1 }, toLocal: (q) => ({ x: q.x, y: q.y }), toGlobal: (q) => ({ x: q.x, y: q.y }) },
    app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
    tokens: { placeables: tokens, get: (id) => tokens.find((t) => t.id === id) }, notes: { placeables: [] } };
}
let runN = 0;
/* one seat: plays one moment, runs its timers up to `upTo` ms; returns the stage module to act on it further */
async function seat({ e, momentId = "MSG1", letters = true, tokens = [], upTo = 1500, full = true }) {
  const W = 1600, H = 900;
  globalThis.document = fakeDom(W, H);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, ms: Number(ms) || 0 }); return timers.length; };
  globalThis.clearTimeout = () => {};
  const told = [];
  globalThis.Hooks = { callAll: (k, d) => { if (k === HOOK) told.push({ ...d, t: performance.now() }); } };
  const Stage = await import(`../splash/stage.mjs?finc-${++runN}`);
  const S = await import("../splash/splash.mjs");
  const flush = (lim = 1e9) => { let t; while ((t = timers.filter((x) => !x.done && x.ms <= lim).sort((a, b) => a.ms - b.ms)[0])) { t.done = true; t.f(); } };
  globalThis.canvas = scene(tokens);
  globalThis.game = { user: { isGM: true, id: "GM" } };
  const imp = [];
  const L = fakeEngine(imp, letters);
  Stage.setLetters(letters ? L : null); Stage.setLayer("screen"); S.setReduced(false);
  const opts = { token: null, scale: 1, hold: 1, fx: 1, fullFrom: full ? 0.7 : null, seed: "S-" + runN, resolve: () => ({ now: 5, max: 8 }), backdrop: false };
  if (momentId) opts.momentId = momentId;
  const ctl = Stage.play(e, opts);
  flush(upTo);
  return { Stage, ctl, told, timers, flush, L, imp };
}
const crit = ev({ n: 4, sixes: 4 }), strong = ev({ n: 5, sixes: 3 });
const wordCall = (s) => s.L.calls.find((c) => /:word$/.test(c.o.seed ?? ""));

/* ================================================================== H: the splash says its story */
for (const [name, e] of [["crit", crit], ["strong", strong]]) {
  const s = await seat({ e, momentId: "MSG-" + name });
  const lands = s.told.filter((x) => x.phase === "land"), w = wordCall(s), im = s.imp[0];
  eq(lands.length, 1, `H ${name}: the moment lands once`);
  const contact = IP.contactMs({ timeline: w.h.plan.timeline }), hit = w.o.startAt + contact;
  ok(lands[0] && lands[0].id === "MSG-" + name && Math.abs(lands[0].landAt - hit) < 1, `H ${name}: landAt is the instant the result word strikes (${Math.round(lands[0]?.landAt - w.o.startAt)} ms after the word starts; its contact ${Math.round(contact)} ms)`);
  const end = im ? im.startAt + planImpact(im).ms : hit;
  ok(lands[0] && Math.abs(lands[0].impactMs - Math.round(end - hit)) <= 1 && (!im || lands[0].impactMs > 0), `H ${name}: impactMs is how long its impact lasts after the strike (${lands[0]?.impactMs} ms; the impact ends ${Math.round(end - hit)} ms after it)`);
  eq(s.told.filter((x) => x.phase === "done").length, 0, `H ${name}: not done while it stands`);
  s.Stage.clearAll();
  eq(s.told.filter((x) => x.phase === "done").map((x) => x.id), ["MSG-" + name], `H ${name}: done once when it is over or cut short`);
}
{ const s = await seat({ e: crit, momentId: null });
  eq(s.told.length, 0, "H: a moment without a message (the preview) says nothing");
  s.Stage.clearAll();
}
{ const s = await seat({ e: crit, momentId: "MSG-classic", letters: false });
  const l = s.told.find((x) => x.phase === "land");
  ok(!!l && l.impactMs === 0 && Number.isFinite(l.landAt), `H classic: the classic splash lands when its word pops, with no impact (${JSON.stringify(l)})`);
  s.Stage.clearAll();
  eq(s.told.filter((x) => x.phase === "done").length, 1, "H classic: ... and is done once");
}
{ const s = await seat({ e: crit, momentId: "MSG-cut", upTo: -1 });
  eq(s.told.filter((x) => x.phase === "land").length, 0, "H: a moment cut short before its word: no landing");
  s.Stage.clearAll();
  eq(s.told.filter((x) => x.phase === "done").length, 1, "H: ... but done, so nobody waits for it");
}
{ const m = src("../splash/main.mjs");
  ok(/remember\(shown, id\);\s*\n\s*\/\*[^\n]*\*\/\s*\n\s*Stage\.tellMoment\(\{ phase: 'start', id \}\);/.test(m), "H main: start is said right after the roll is taken (before the dice, the verdict and the camera are waited for)");
  ok(/try \{[\s\S]{0,4000}Stage\.tellMoment\(\{ phase: 'start', id \}\);[^\n]*\n\s*const ctl = Stage\.play\(/.test(m), "H main: start is said again right before the moment plays");
  ok(/momentId: id/.test(m) && /handed = !!ctl && !ctl\.dead;/.test(m), "H main: the moment carries the message id and is handed to the stage");
  ok(/\} finally \{ if \(!handed\) Stage\.tellMoment\(\{ phase: 'done', id \}\); \}/.test(m), "H main: every early way out (deleted, hidden tab, verdict, failure) says done");
  ok(/hook\(Stage\.REACT_HOOK, [^\n]*Stage\.onTokenReact\(data\)/.test(m), "R main: the splash listens to the token reactions' blows");
  eq([IP && "ok", (await import("../splash/stage.mjs")).MOMENT_HOOK, (await import("../splash/stage.mjs")).REACT_HOOK], ["ok", HOOK, "invincible-plus-ultra.tokenReact"], "H: the hook names the token reactions listen on (tokenreact/main.mjs SPLASH_HOOK / REACT_HOOK)");
  const tm = src("../tokenreact/main.mjs");
  ok(/SPLASH_HOOK = `\$\{MOD\}\.splashMoment`, REACT_HOOK = `\$\{MOD\}\.tokenReact`/.test(tm), "H: ... the same names on the token side");
  ok(/data\.phase === "start"\) s\.t = performance\.now\(\)/.test(tm), "H token side: a start said again restarts its wait (the dice took seconds)");
}

/* ================================================================== R: make room */
{ const s = await seat({ e: crit, momentId: "MSG-room" });
  const r = s.ctl.rect, cx = (r.l + r.r) / 2, cy = (r.t + r.b) / 2;
  const near = tok("NEAR", r.r + 20, cy - 50), far = tok("FAR", 3800, 2800);
  globalThis.canvas.tokens.placeables.push(near, far);
  eq(s.Stage.makeRoom(["FAR"], performance.now() + 1000), 0, "R: a token far from the block: the moment stays");
  ok(!s.ctl.dead, "R: ... still standing");
  const at = performance.now() + 1000, before = s.timers.length;
  eq(s.Stage.makeRoom(["NEAR"], at), 1, `R: a token within half a token of the block (${Math.round(near.x - r.r)} px from it): the moment makes room`);
  const t = s.timers.slice(before).find((x) => !x.done);
  ok(!!t && Math.abs(t.ms - (at - s.Stage.ROOM_MS - performance.now())) < 30, `R: its words leave ${s.Stage.ROOM_MS} ms before the blow (in ${Math.round(t?.ms)} ms)`);
  s.flush();
  ok(s.ctl.dead && s.L.calls.every((c) => c.h.stops.length > 0), "R: ... and they are gone by the blow");
  eq(s.told.filter((x) => x.phase === "done").length, 1, "R: the moment says done");
  ok(nearIs(s.Stage), "R: nearBlock: a box half a token away counts, one a token away does not");
  s.Stage.clearAll();
}
function nearIs(Stage) {
  const tb = { l: 0, t: 0, r: 100, b: 100 };
  return Stage.nearBlock({ l: 140, t: 0, r: 300, b: 100 }, tb) && !Stage.nearBlock({ l: 200, t: 0, r: 300, b: 100 }, tb) && !Stage.nearBlock(null, tb);
}
{ const s = await seat({ e: crit, momentId: "MSG-early", upTo: -1 });
  const r = s.ctl.rect ?? { l: 600, t: 300, r: 1000, b: 500 };
  globalThis.canvas.tokens.placeables.push(tok("ON", (r.l + r.r) / 2 - 50, (r.t + r.b) / 2 - 50));
  eq(s.Stage.makeRoom(["ON"], performance.now() + 300), 0, "R: a moment that has not struck yet keeps its story (the reactions wait for it)");
  s.Stage.clearAll();
}

/* ================================================================== C: one contact rule on engine 1.9.0's real plans */
{
  const { FontBank } = await import("../letters/fontbank.mjs");
  const { makePlan, FONTS } = await import("../letters/design.mjs");
  const { VERSION } = await import("../letters/engine.mjs").catch(() => ({ VERSION: "?" }));
  const P = await import("../tokenreact/pure.mjs");
  const bank = new FontBank();
  for (const [id, f] of Object.entries(FONTS)) { const b = fs.readFileSync(new URL(`../letters/${f.file}`, import.meta.url)); bank.add(id, b.buffer.slice(b.byteOffset, b.byteOffset + b.length)); }
  const api = { adv: (f, c) => bank.adv(f, c) };
  const plan = (t, o, mode = "smooth") => makePlan(t, { seed: 1, ...o, look: { style: "invincible", motion: mode } }, api, []);
  const keyOf = (p, f) => p.motion.entKeys.find(([, q]) => f(q));
  ok(/^1\.9\./.test(VERSION), `C: the vendored engine is 1.9 (${VERSION})`);
  const cases = [
    ["KRAK!", { mood: "impact", sound: { loud: 0.9, sharp: 0.9 } }, "flash: the accent tick", (p) => 0],
    ["WHAM!", { mood: "impact", sound: { loud: 0.5 } }, "slam: its squash", (p) => keyOf(p, (q) => q.sx > 1.1 && q.sy < 0.9)[0]],
    ["CRUSH!", { mood: "crash", sound: { loud: 0.8 } }, "drop: its landing squash", (p) => keyOf(p, (q) => q.sy < 0.8)[0]],
    ["KA-THOOM!", { mood: "boom", sound: { loud: 0.95 } }, "boom with flash: the accent tick", (p) => 0],
    ["THUD", { mood: "impact", in: "pop", sound: { loud: 0.4 } }, "pop: its biggest pose", (p) => keyOf(p, (q) => (q.s ?? 1) > 1.1)[0]]
  ];
  for (const mode of ["smooth", "stepped"]) for (const [t, o, what, want] of cases) {
    const p = plan(t, o, mode);
    const a = P.contactMs(p), b = IP.contactMs(p), w = Math.round(want(p));
    ok(Array.isArray(p.motion?.entKeys) && p.contactMs === undefined || Number.isFinite(p.contactMs), `C ${mode} ${t}: a 1.9 plan (pose keys)`);
    ok(Math.round(a) === w && Math.round(b) === w, `C ${mode} ${t} (${what}): token side ${Math.round(a)} ms, splash ${Math.round(b)} ms, the pose says ${w} ms`);
  }
  /* the token side without the 1.9 reading took half the entrance (125 ms for a 6-tick slam whose squash is at 62 ms) */
  const wham = plan("WHAM!", { mood: "impact", sound: { loud: 0.5 } });
  const half = wham.timeline.ent.reduce((x, q) => x + q.ticks, 0) * TICK * 0.5;
  ok(Math.abs(P.contactMs(wham) - half) > 30, `C: not the half-entrance guess (${Math.round(half)} ms) on a 1.9 slam`);
  eq(P.contactMs({ ...wham, contactMs: 77 }), 77, "C: the engine's own plan.contactMs wins on the token side");
  eq(IP.contactMs({ ...wham, contactMs: 77 }), 77, "C: ... and on the splash side");
  eq(P.contactMs(wham, true), 0, "C: reduced motion: the still entrance hits at once");
  /* every entrance the reactions pin (slam, pop, drop, grow, rise) strikes within the shared lead, so no seat has to start a word in the past */
  const worst = Math.max(...["slam", "pop", "drop"].map((k) => P.contactMs(plan("BLAM!", { mood: "impact", in: k, sound: { loud: 0.7 } }))));
  ok(worst <= P.HIT_LEAD, `C: the blows' entrances strike within HIT_LEAD (worst ${Math.round(worst)} ms <= ${P.HIT_LEAD} ms)`);
}

done("fin-callers");
const sm = summary();
console.log(`sweep fin-callers: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
