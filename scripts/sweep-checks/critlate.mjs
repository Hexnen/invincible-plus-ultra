/* node scripts/sweep-checks/critlate.mjs -- CRITLATE (2026-11-15): a roll's moment starts on its shared instant with its whole entrance and its
   whole impact frame, on every seat. Live (two seats, Omni-Man Strike, four sixes): the page stalled for ONE frame of 0.4-0.55 s exactly when
   the critical was handed to the stage: the moment's layout (the engine's measuring of every part at every size the layout tried, and the
   block's search round the roller and his neighbours) ran in one task ON the moment's own instant (main.mjs slept until the shared start and
   only then called Stage.play). Every lettering is started LEAD_MS ahead of its call, so a layout longer than that put the word's call after
   its own start (52-479 ms late, per seat): the engine joined it mid-entrance, the impact frame's first drawings were already past (a 17 ms
   frame and lines, or nothing), all parts came at once.
   Now (stage.mjs prepare / composeIn / measureItems, main.mjs prepareAhead) the moment is laid out AHEAD (while the dice roll, and again once
   the instant is known) and the layout and the measuring are kept by their exact input; at the instant play() takes them. Checked here, with
   an engine whose every plan costs time on the page's clock (normal seat 20 ms a plan, a slow seat 80 ms):
     L1  every lettering of every kind is called before its own start (startAt), on the screen and the map layer, with and without a target,
         on an empty and a crowded board, on a normal and a slow seat (fails before: the layout ran at the instant);
     L2  the impact frame is called before its first drawing (blowAt minus its lead-in) and on the target;
     L3  no task inside the hit (from the moment's instant to the impact's end) is longer than one 60 Hz frame;
     L4  the SAME picture: every call (text, options, start, size, place) and every impact spec equal with and without the layout ahead;
     L5  an input that changed after the layout ahead (the roller moved, the view panned) is laid out afresh: equal to a play without it;
     L6  the kept layout is a copy: a play that moves its parts (a seat's own guard) does not change the next play of the same moment.
   The page, the canvas and the engine are fakes (critfix.mjs's), on a virtual clock; the impact's plan is the real one. */
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";
import { planImpact } from "../letters/impact/plan.mjs";
import { impactApi } from "../tokenreact/impact-node.mjs";

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng: seq([0.1, 0.5, 0.9, 0.3]), st: null, dryN: 0 });
let clock = 1000;
const realPerf = globalThis.performance;
Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true, writable: true });

function fakeDom(W, H) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "", anims: [],
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, remove: (...c) => { self.className = self.className.split(" ").filter((x) => x && !c.includes(x)).join(" "); }, contains: (c) => self.className.split(" ").includes(c), toggle() {} }; },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { if (c.parent) c.remove(); c.parent = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
      animate(k, o) { this.anims.push({ k, o }); return { onfinish: null, cancel() {} }; }, getAnimations: () => [], querySelectorAll() { return []; }, querySelector() { return null; },
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
  const rects = { "#sidebar": R(W - 300, 0, 300, H), "#hotbar": R(W * 0.3, H - 64, 520, 56), "#scene-controls": R(0, 40, 80, H - 200) };
  const el = (r) => ({ getBoundingClientRect: () => r, className: "", classList: { add() {}, remove() {}, contains: () => false } });
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: (id) => (id === "sidebar" ? el(rects["#sidebar"]) : null),
    querySelector: () => null, querySelectorAll: (s) => { const r = rects[s]; return r ? [el(r)] : []; } };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style?.zIndex ?? "auto", display: e.style?.display ?? "block", visibility: "visible", opacity: e.style?.opacity ?? "1" });
  return doc;
}
const SLAM = () => ({ ent: [{ ticks: 2, g: { s: 0.82 }, fx: [] }, { ticks: 1, g: { s: 1.12 }, fx: [], impact: true }, { ticks: 2, g: { s: 0.86 }, fx: [{ k: "burst" }] }, { ticks: 4, g: {}, fx: [] }], hold: [{ ticks: 3 }], exit: [{ ticks: 2 }] });
/* an engine whose every plan of a word costs `cost` ms of the page's clock (the live measuring: 1-20 ms a plan, many plans a layout) */
function fakeEngine(log, cost) {
  let n = 0;
  const box = (text) => { const lines = String(text).split("\n"); return { w: 0.6 * Math.max(...lines.map((l) => l.length)) + 0.3, h: 1.2 * lines.length + 0.1 }; };
  const L = { version: "fake", prefs: { enabled: true, scale: 1 },
    planFor: (text, op) => { clock += cost; return { plan: { _holdBox: box(text), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` }, timeline: SLAM() }, opts: op }; },
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) {
      const h = { id: "h" + ++n, hand: `hand-${op.seed ?? n}`, alive: true, off: false, stop() { h.alive = false; }, moveTo() {},
        ready: Promise.resolve(true), finished: new Promise(() => {}), plan: { timeline: SLAM() } };
      log.push({ t: clock, word: text, o: { ...op, parent: op.parent ? "P" : undefined, token: op.token?.id } }); return h;
    } };
  L.impact = { ...impactApi(), plan: (spec) => planImpact(spec), play(spec) { log.push({ t: clock, impact: { ...spec, subject: spec.subject?.id ?? spec.subject, from: spec.from?.id, keep: spec.keep?.id } }); return { alive: true, finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} }; } };
  return L;
}
const tok = (id, x, y) => ({ id, name: id, visible: true, document: { id, x, y, width: 1, height: 1, hidden: false, texture: { scaleX: 1, scaleY: 1 } }, x, y, w: 100, h: 100, center: { x: x + 50, y: y + 50 } });
function scene({ tokens, zoom = 1, pan = { x: 0, y: 0 } }) {
  const toClient = (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y });
  return { ready: true, grid: { size: 100 }, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 4000, height: 3000 } },
    stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: toClient },
    app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
    tokens: { placeables: tokens, get: (id) => tokens.find((t) => t.id === id) }, notes: { placeables: [] }, visibility: null };
}
const AT = 5000;   // the moment's instant on this page's clock (the dice rolled from 1000)
let runN = 0;
/* one seat: (prepare while the dice roll) -> play at the instant -> every timer in order. Each task's length is what the engine cost it */
async function seat({ layer = "screen", e, board, targets = [], cost = 20, ahead = true, change = null, twice = false, W = 1600, H = 900 }) {
  clock = 1000;
  { let r = 777; Math.random = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648); }
  globalThis.document = fakeDom(W, H);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, at: clock + (ms || 0), i: timers.length }); return timers.length; };
  globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].done = true; };
  const Stage = await import(`../splash/stage.mjs?critlate-${++runN}`);
  const S = await import("../splash/splash.mjs");
  const tokens = board.tokens.map((t) => tok(t.id, t.x, t.y));
  globalThis.canvas = scene({ tokens, zoom: board.zoom ?? 1, pan: board.pan ?? { x: 0, y: 0 } });
  globalThis.game = { user: { isGM: true, id: "GM" } };
  const log = [], L = fakeEngine(log, cost);
  Stage.setLetters(L); Stage.setLayer(layer); S.setReduced(false);
  const hero = () => canvas.tokens.get("HERO000000000000");
  const opts = () => ({ token: hero(), from: hero(), targets, scale: 1, hold: 1, fx: 1, fullFrom: 0.7, seed: "CL-" + (e.word ?? "x"), momentId: "CL", resolve: () => ({ now: 5, max: 8 }), backdrop: false });
  const tasks = [];
  if (ahead) { const t = clock; const r = Stage.prepare?.(e, opts()); tasks.push({ at: t, ms: clock - t, what: "prepare" }); ok(!Stage.prepare || r != null, "prepare lays the moment out"); }
  if (change) change();
  clock = Math.max(clock, AT);
  const stats0 = { ...(Stage.layoutStats ?? {}) };
  const t1 = clock;
  const ctl = Stage.play(e, { ...opts(), at: AT });
  tasks.push({ at: t1, ms: clock - t1, what: "play" });
  const stats1 = { ...(Stage.layoutStats ?? {}) };
  let t;
  while ((t = timers.filter((x) => !x.done).sort((a, b) => a.at - b.at || a.i - b.i)[0])) {
    t.done = true; clock = Math.max(clock, t.at); const s = clock; t.f(); tasks.push({ at: s, ms: clock - s, what: "timer" });
    if (clock > AT + 20000) break;
  }
  let again = null;
  if (twice) {   // the same moment played again from the kept layout (a copy each time)
    clock += 10;
    const before = log.length;
    Stage.play(e, { ...opts(), at: clock });
    while ((t = timers.filter((x) => !x.done).sort((a, b) => a.at - b.at || a.i - b.i)[0])) { t.done = true; clock = Math.max(clock, t.at); t.f(); if (clock > AT + 40000) break; }
    again = log.slice(before);
  }
  const impactEnd = ctl?.impactEnd;
  Stage.clearAll(); Stage.setLayer("screen"); delete globalThis.canvas;
  return { log, tasks, impactEnd, stats0, stats1, again, ctl };
}
const KINDS = { critical: ev({ n: 4, sixes: 4 }), strong: ev({ n: 4, sixes: 2 }), ordinary: ev({ n: 4, sixes: 1 }), miss: ev({ n: 6, sixes: 0 }),
  pushed: ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, stress: 2 }) };
const H0 = { id: "HERO000000000000", x: 700, y: 400 }, T0 = { id: "TGT0000000000000", x: 830, y: 420 };
const BOARDS = {
  empty: { tokens: [H0, T0] },
  crowd: { tokens: [H0, T0, ...[[-1.2, -1.1], [0.3, 1.4], [1.05, -1], [0, 1.05], [-1, 0.2], [2, 1], [-1.3, 1], [1.3, 1.2]].map(([dx, dy], i) => ({ id: "NB" + i + "0000000000000", x: 700 + dx * 100, y: 400 + dy * 100 }))] }
};
const words = (s) => s.log.filter((x) => x.word);
const strip = (x) => { const { t, ...r } = x; return r; };
let lateWorst = 0, longWorst = 0;
for (const [bn, board] of Object.entries(BOARDS)) for (const layer of ["screen", "overlay"]) for (const [kn, e] of Object.entries(KINDS)) for (const tg of [true, false]) for (const cost of [20, 80]) {
  const tag = `${bn} ${layer} ${kn} ${tg ? "target" : "no target"} ${cost === 80 ? "slow seat" : "seat"}`;
  const targets = tg ? [T0.id] : [];
  const s = await seat({ layer, e, board, targets, cost });
  const late = words(s).map((w) => Math.round(w.t - w.o.startAt)).filter((d) => d > 0);
  lateWorst = Math.max(lateWorst, ...late, 0);
  ok(words(s).length > 0 && late.length === 0, `L1 ${tag}: every lettering called before its start (late: ${late.join(", ") || "none"} ms)`);
  const im = s.log.find((x) => x.impact);
  if (im) {
    const p = planImpact({ ...im.impact, subject: { x: 0, y: 0, w: 100, h: 100 }, from: undefined, keep: undefined });
    const first = im.impact.blowAt - (p?.peakMs ?? 0);
    ok(im.t <= first, `L2 ${tag}: the impact called before its first drawing (${Math.round(im.t - first)} ms)`);
    if (tg) eq(im.impact.subject, T0.id, `L2 ${tag}: the impact on the target`);
  } else ok(!(kn === "critical"), `L2 ${tag}: the critical has its impact`);
  const end = Math.max(s.impactEnd ?? 0, ...words(s).map((w) => w.o.startAt + 300));
  const long = s.tasks.filter((x) => x.at + x.ms >= AT && x.at <= end && x.ms > 17);
  longWorst = Math.max(longWorst, ...s.tasks.filter((x) => x.at + x.ms >= AT && x.at <= end).map((x) => x.ms), 0);
  ok(long.length === 0, `L3 ${tag}: no task longer than a frame inside the hit (${long.map((x) => `${x.what} ${x.ms} ms`).join(", ") || "none"})`);
  /* L4: the same picture with and without the layout ahead (the calls' times differ: only what is called) */
  if (cost === 20) {
    const n = await seat({ layer, e, board, targets, cost, ahead: false });
    eq(s.log.map(strip), n.log.map(strip), `L4 ${tag}: the same calls and impact with and without the layout ahead`);
    ok((s.stats1.fresh ?? 0) === (s.stats0.fresh ?? 0) && (s.stats1.reused ?? 0) > (s.stats0.reused ?? 0), `L4 ${tag}: at the instant the kept layout is taken (fresh ${s.stats0.fresh}->${s.stats1.fresh})`);
  }
}
/* L5: what changed after the layout ahead is laid out afresh */
for (const layer of ["screen", "overlay"]) {
  const e = KINDS.critical, targets = [T0.id];
  const moved = await seat({ layer, e, board: BOARDS.crowd, targets, change: () => { const h = canvas.tokens.get(H0.id); h.document.x += 160; h.x += 160; h.center.x += 160; } });
  const fresh = await seat({ layer, e, board: { ...BOARDS.crowd, tokens: BOARDS.crowd.tokens.map((t) => (t.id === H0.id ? { ...t, x: t.x + 160 } : t)) }, targets, ahead: false });
  eq(moved.log.map(strip), fresh.log.map(strip), `L5 ${layer}: the roller moved after the layout ahead: laid out afresh, as a play without it`);
  ok(moved.stats1.fresh > moved.stats0.fresh, `L5 ${layer}: ... a fresh layout at the instant`);
  if (layer === "screen") {
    const panned = await seat({ layer, e, board: BOARDS.crowd, targets, change: () => { canvas.stage.toGlobal = (q) => ({ x: q.x - 120, y: q.y + 40 }); canvas.stage.toLocal = (q) => ({ x: q.x + 120, y: q.y - 40 }); } });
    const p0 = await seat({ layer, e, board: { ...BOARDS.crowd, pan: { x: -120, y: 40 } }, targets, ahead: false });
    eq(panned.log.map(strip), p0.log.map(strip), "L5 screen: the view panned after the layout ahead: laid out afresh");
  }
}
/* L6: the kept layout is handed out as a copy */
{
  const s = await seat({ layer: "screen", e: KINDS.critical, board: BOARDS.crowd, targets: [T0.id], twice: true });
  const at = (x) => x.filter((w) => w.word).map((w) => [w.word, w.o.at?.x, w.o.at?.y, w.o.size]);
  eq(at(s.again), at(s.log.slice(0, s.log.length - s.again.length)), "L6: the same moment played again from the kept layout: the same places and sizes");
}
console.log(`  worst lateness ${lateWorst} ms, worst task inside a hit ${longWorst} ms`);
Object.defineProperty(globalThis, "performance", { value: realPerf, configurable: true, writable: true });
done("critlate");
const sm = summary();
console.log(`sweep critlate: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
