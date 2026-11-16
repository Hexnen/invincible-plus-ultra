/* node scripts/sweep-checks/rollstall.mjs -- ROLLSTALL (2026-11-16): the landing of a roll's lettering and its impact does not stall the
   frames that show the impact's first drawings. Live (two seats, lane 5, a crowded board): the placing of the table's block on the seat
   (LP.seatPlace) was worked out again at the moment's instant (0.2-0.8 s in one task: a critical's word and impact called 0.2-1 s late, 5-14
   of its 19 drawings shown), and the impact of every roll was asked for in its word's task, 53-98 ms before its first drawing (the engine's
   preparation then ran inside the impact's first frames: 50-117 ms frames). Now (stage.mjs seatPlaceKept, armEarly; main.mjs prepareAhead):
     R1  the placing on the seat is kept by its exact input: the layout ahead with the instant and the play place nothing again;
     R2  the SAME picture: the block of a kept placing = the block placed afresh = the block of a seat that lays out at the instant only
         (every part's place and size, the outline, how it moved), and the same calls, on five boards (empty .. nowhere clean, a far zoom,
         the roller by the window's corner), two windows, every kind of result;
     R3  a kept placing is handed out as a copy;
     R4  an input that changed after the layout ahead (the roller moved, the view panned, the sidebar folded) is placed afresh;
     R5  the impact is asked for when the instant is known, at least 95 ms earlier than before, and it is the very same call (spec, subject,
         blow instant, also with the engine's 24 Hz contact), its letterings unchanged, called once;
     R6  anything else than the very same call (the clock corrected, the target hidden meanwhile): the one asked ahead is stopped before its
         first drawing and the impact asked with its word, as a seat without the call ahead;
     R7  a moment that never plays drops it;
     R8  a pushed roll, a map layer, a miss, a clock not good yet: nothing asked ahead, the same calls as before.
   The page, the canvas and the engine are fakes (critlate.mjs's), on a virtual clock; the impact's plan is the real one. */
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
const TICK = 1000 / 24;
let runN = 0;
/* one seat: the layout ahead while the dice roll (idle) -> the layout ahead with the instant (`now` ms before it) -> play at the instant ->
   every timer in order. o: { layer, e, board, targets, W, H, idle, now (ms before the instant, null: none), nowAt (the instant handed to that
   prepare, default AT), playAt (the instant handed to play), change (between the two prepares), change2 (between the last prepare and play),
   noPlay (the moment never plays), grid (the engine reads contacts on a 24 Hz grid: L.contactAt), probe (a live probe of the placing is on) } */
async function seat({ layer = "screen", e, board, targets = [], W = 1600, H = 900, idle = true, now = 100, nowAt = AT, playAt = AT, change = null, change2 = null, noPlay = false, grid = false, probe = false, twice = false }) {
  clock = 1000;
  { let r = 777; Math.random = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648); }
  globalThis.document = fakeDom(W, H);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, at: clock + (ms || 0), i: timers.length }); return timers.length; };
  globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].done = true; };
  if (probe) globalThis.__splashFit = []; else delete globalThis.__splashFit;
  const Stage = await import(`../splash/stage.mjs?rollstall-${++runN}`);
  const S = await import("../splash/splash.mjs");
  const tokens = board.tokens.map((t) => tok(t.id, t.x, t.y));
  globalThis.canvas = scene({ tokens, zoom: board.zoom ?? 1, pan: board.pan ?? { x: 0, y: 0 } });
  globalThis.game = { user: { isGM: true, id: "GM" } };
  const log = [], stops = [], L = fakeEngine(log, 0);
  /* the impact's handle tells when it was stopped; (grid) the word's contact as the engine reads it, for a plan + start and for a handle */
  { const play0 = L.impact.play; L.impact.play = (spec) => { const h = play0(spec); h.alive = true; h.stop = () => { if (h.alive) { h.alive = false; stops.push({ t: clock, blowAt: spec.blowAt }); } }; return h; }; }
  if (grid) {
    const planFor0 = L.planFor, play0 = L.play;
    L.planFor = (text, op) => { const r = planFor0(text, op); r.plan.contactMs = 125; r.plan.motion = { mode: "stepped", in: "slam" }; return r; };
    L.play = (text, op) => { const h = play0(text, op); h.opts = op; h.plan.contactMs = 125; h.plan.motion = { mode: "stepped", in: "slam" }; return h; };
    L.contactAt = (x, startAt) => { const plan = x?.plan ?? (x?.timeline ? x : null), t0 = Number.isFinite(startAt) ? startAt : x?.opts?.startAt; return plan && Number.isFinite(t0) ? Math.ceil((t0 + plan.contactMs) / TICK - 1e-9) * TICK : null; };
  }
  Stage.setLetters(L); Stage.setLayer(layer); S.setReduced(false);
  const hero = () => canvas.tokens.get("HERO000000000000");
  const opts = () => ({ token: hero(), from: hero(), targets, scale: 1, hold: 1, fx: 1, fullFrom: 0.7, seed: "RS-" + (e.word ?? "x"), momentId: "RS", resolve: () => ({ now: 5, max: 8 }), backdrop: false });
  const st = () => ({ ...Stage.layoutStats }), stats = {};
  if (idle) Stage.prepare(e, opts(), false);
  stats.idle = st();
  if (change) change();
  if (now != null) { clock = AT - now; Stage.prepare(e, { ...opts(), at: nowAt }, false); }
  stats.now = st();
  if (change2) change2();
  clock = Math.max(clock, AT);
  let ctl = null;
  if (noPlay) Stage.dropEarly("RS-never");   // (another moment's id: nothing of this one is dropped by it)
  else ctl = Stage.play(e, { ...opts(), at: playAt });
  stats.play = st();
  const lay = ctl?.layout ? JSON.parse(JSON.stringify({ items: ctl.layout.items.map((it) => ({ role: it.role, x: it.x, y: it.y, S: it.S, w: it.w, h: it.h })), rect: ctl.layout.rect, parts: ctl.layout.parts ?? null, moved: ctl.layout.moved, moved2: ctl.layout.moved2 ?? null, k: ctl.layout.k, canon: ctl.layout.canon ?? null, table: ctl.layout.table ?? null })) : null;
  if (twice && ctl?.layout) { for (const it of ctl.layout.items) { it.x += 500; it.S *= 3; } if (ctl.layout.rect) ctl.layout.rect.l -= 900; }   // a caller that writes on its layout
  let t;
  while ((t = timers.filter((x) => !x.done).sort((a, b) => a.at - b.at || a.i - b.i)[0])) { t.done = true; clock = Math.max(clock, t.at); t.f(); if (clock > AT + 20000) break; }
  let again = null;
  if (twice) {
    clock += 10;
    const c2 = Stage.play(e, { ...opts(), at: clock });
    again = c2?.layout ? JSON.parse(JSON.stringify({ items: c2.layout.items.map((it) => ({ role: it.role, x: it.x, y: it.y, S: it.S, w: it.w, h: it.h })), rect: c2.layout.rect })) : null;
    while ((t = timers.filter((x) => !x.done).sort((a, b) => a.at - b.at || a.i - b.i)[0])) { t.done = true; clock = Math.max(clock, t.at); t.f(); if (clock > AT + 40000) break; }
  }
  const early = { ...Stage.earlyStats };
  Stage.clearAll(); Stage.setLayer("screen"); delete globalThis.canvas; delete globalThis.__splashFit;
  return { log, stops, stats, lay, again, early, ctl };
}
const KINDS = { critical: ev({ n: 4, sixes: 4 }), strong: ev({ n: 4, sixes: 2 }), ordinary: ev({ n: 4, sixes: 1 }), miss: ev({ n: 6, sixes: 0 }),
  pushed: ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, stress: 2 }) };
const H0 = { id: "HERO000000000000", x: 700, y: 400 }, T0 = { id: "TGT0000000000000", x: 830, y: 420 };
const NB = [[-1.2, -1.1], [0.3, 1.4], [1.05, -1], [0, 1.05], [-1, 0.2], [2, 1], [-1.3, 1], [1.3, 1.2]].map(([dx, dy], i) => ({ id: "NB" + i + "0000000000000", x: 700 + dx * 100, y: 400 + dy * 100 }));
const RING = []; for (let i = 0; i < 28; i++) { const a = i * 2.399, r = 110 + 22 * i; RING.push({ id: "RG" + String(i).padStart(2, "0") + "000000000000", x: Math.round(700 + r * Math.cos(a)), y: Math.round(400 + r * Math.sin(a) * 0.7) }); }
const BOARDS = {
  empty: { tokens: [H0, T0] },
  crowd: { tokens: [H0, T0, ...NB] },
  packed: { tokens: [H0, T0, ...NB, ...RING] },                       // nowhere clean: the least covering search
  far: { tokens: [H0, T0, ...NB, ...RING], zoom: 0.6, pan: { x: 300, y: 200 } },
  edge: { tokens: [H0, T0, ...NB], pan: { x: -560, y: -330 } }        // the roller by the window's corner
};
const strip = (x) => { const { t, ...r } = x; return r; };
const impacts = (s) => s.log.filter((x) => x.impact);
/* every call of a seat, the letterings in their order, then the impact (asked ahead it is logged before its word) */
const calls = (s) => [...s.log.filter((x) => x.word).map(strip), ...impacts(s).map(strip)];
const firstOf = (im) => { const p = planImpact({ ...im.impact, subject: { x: 0, y: 0, w: 100, h: 100 }, from: undefined, keep: undefined, also: undefined }); return im.impact.blowAt - (p?.peakMs ?? 0); };
let heavy = 0, gain = Infinity;

/* R1-R3: the placing on the seat is kept, and it is the same placing */
for (const [bn, board] of Object.entries(BOARDS)) for (const [W, H] of [[1600, 900], [1366, 768]]) for (const [kn, e] of Object.entries(KINDS)) {
  const tag = `${bn} ${W}x${H} ${kn}`, targets = [T0.id];
  const s = await seat({ e, board, targets, W, H });
  const idleN = s.stats.idle.seatFresh;
  heavy = Math.max(heavy, idleN);
  ok(idleN > 0, `R1 ${tag}: the layout ahead places the table's block on the seat (${idleN} placings)`);
  eq(s.stats.now.seatFresh, idleN, `R1 ${tag}: the layout ahead with the instant places nothing again`);
  eq(s.stats.play.seatFresh, idleN, `R1 ${tag}: at the instant nothing is placed again`);
  ok(s.stats.play.seatKept > s.stats.now.seatKept && s.stats.play.seatUnkeyed === 0, `R1 ${tag}: the play takes the kept placings (kept ${s.stats.now.seatKept}->${s.stats.play.seatKept}, unkeyed ${s.stats.play.seatUnkeyed})`);
  eq(s.stats.play.fresh, s.stats.idle.fresh, `R1 ${tag}: ... and the kept layouts`);
  /* the same picture: against a seat that never keeps a placing (a live probe is on: every placing afresh) and one that lays out at the instant only */
  const p = await seat({ e, board, targets, W, H, probe: true });
  ok(p.stats.play.seatKept === 0 && p.stats.play.seatFresh > idleN, `R2 ${tag}: the comparison seat placed everything afresh (${p.stats.play.seatFresh})`);
  eq(s.lay, p.lay, `R2 ${tag}: the block of a kept placing = the block placed afresh (every part's place and size, the outline, how it moved)`);
  const n = await seat({ e, board, targets, W, H, idle: false, now: null });
  eq(s.lay, n.lay, `R2 ${tag}: ... = the block of a seat that laid out at the instant only`);
  eq(calls(s), calls(n), `R2 ${tag}: the same calls: every lettering (text, options, start, size, place) and the impact (spec, blow instant)`);
}
/* R3: a kept placing is handed out as a copy */
for (const bn of ["crowd", "packed"]) {
  const s = await seat({ e: KINDS.critical, board: BOARDS[bn], targets: [T0.id], twice: true });
  eq(s.again, { items: s.lay.items, rect: s.lay.rect }, `R3 ${bn}: a caller that wrote on its layout: the next play of the moment has the kept places and sizes`);
}
/* R4: what changed after the layout ahead is placed afresh, as a play without it */
{
  const e = KINDS.critical, targets = [T0.id];
  const mv = () => { const h = canvas.tokens.get(H0.id); h.document.x += 160; h.x += 160; h.center.x += 160; };
  const moved = await seat({ e, board: BOARDS.crowd, targets, change2: mv, now: null });
  const fresh = await seat({ e, board: { ...BOARDS.crowd, tokens: BOARDS.crowd.tokens.map((t) => (t.id === H0.id ? { ...t, x: t.x + 160 } : t)) }, targets, idle: false, now: null });
  ok(moved.stats.play.seatFresh > moved.stats.now.seatFresh, "R4 the roller moved after the layout ahead: placed afresh at the instant");
  eq(moved.lay, fresh.lay, "R4 ... the block of a seat that never laid out ahead");
  const pan = () => { canvas.stage.toGlobal = (q) => ({ x: q.x - 90, y: q.y + 30 }); canvas.stage.toLocal = (q) => ({ x: q.x + 90, y: q.y - 30 }); };
  const panned = await seat({ e, board: BOARDS.crowd, targets, change2: pan, now: null });
  const p0 = await seat({ e, board: { ...BOARDS.crowd, pan: { x: -90, y: 30 } }, targets, idle: false, now: null });
  eq(panned.lay, p0.lay, "R4 the view panned after the layout ahead: the block of a seat that never laid out ahead");
  const panel = () => { const q0 = document.querySelectorAll; document.querySelectorAll = (sel) => (sel === "#sidebar" ? [] : q0(sel)); document.getElementById = () => null; };
  const folded = await seat({ e, board: BOARDS.packed, targets, change2: panel, now: null });
  const f0 = await seat({ e, board: BOARDS.packed, targets, idle: false, now: null, change2: panel });
  eq(folded.lay, f0.lay, "R4 the sidebar folded after the layout ahead: the block of a seat that never laid out ahead");
}
/* R5: the impact is asked for when the instant is known, and it is the same call */
for (const grid of [false, true]) for (const [bn, board] of [["empty", BOARDS.empty], ["crowd", BOARDS.crowd]]) for (const kn of ["critical", "strong", "ordinary"]) for (const tg of [true, false]) {
  const e = KINDS[kn], targets = tg ? [T0.id] : [], tag = `${bn} ${kn} ${tg ? "target" : "no target"}${grid ? " (24 Hz contact)" : ""}`;
  const s = await seat({ e, board, targets, grid }), n = await seat({ e, board, targets, grid, now: null });
  const a = impacts(s), b = impacts(n);
  ok(b.length === 1 && a.length === 1, `R5 ${tag}: one impact call, with and without the call ahead (${a.length}, ${b.length})`);
  if (a.length !== 1 || b.length !== 1) continue;
  eq(strip(a[0]), strip(b[0]), `R5 ${tag}: the same impact: spec, subject, blow instant`);
  eq(s.log.filter((x) => x.word).map(strip), n.log.filter((x) => x.word).map(strip), `R5 ${tag}: the same letterings (text, options, start)`);
  eq(a[0].t, AT - 100, `R5 ${tag}: asked when the instant is known (100 ms before it)`);
  ok(b[0].t >= AT, `R5 ${tag}: before: asked with its word, ${Math.round(firstOf(b[0]) - b[0].t)} ms before its first drawing`);
  ok(firstOf(a[0]) - a[0].t >= firstOf(b[0]) - b[0].t + 95, `R5 ${tag}: now ${Math.round(firstOf(a[0]) - a[0].t)} ms before its first drawing`);
  gain = Math.min(gain, firstOf(a[0]) - a[0].t);
  ok(s.stops.length === 0 && s.early.armed === 1 && s.early.taken === 1 && s.early.redone === 0 && s.early.dropped === 0, `R5 ${tag}: taken by its word, never stopped (${JSON.stringify(s.early)})`);
  eq(s.ctl.impactEnd, n.ctl.impactEnd, `R5 ${tag}: the moment tells the same end of its impact`);
}
/* R6: anything else than the very same call: the one asked ahead is stopped before its first drawing and the impact is asked with its word */
{
  const e = KINDS.critical, targets = [T0.id], board = BOARDS.crowd;
  const late = await seat({ e, board, targets, playAt: AT + 7 }), ref = await seat({ e, board, targets, playAt: AT + 7, now: null });
  const a = impacts(late);
  ok(a.length === 2 && late.stops.length === 1 && late.early.redone === 1 && late.early.taken === 0, `R6 the clock corrected by 7 ms after the call ahead: stopped and asked again (${a.length} calls, ${late.stops.length} stop)`);
  ok(late.stops[0]?.t < firstOf(a[0]), "R6 ... stopped before its first drawing");
  eq(strip(a.at(-1)), strip(impacts(ref)[0]), "R6 ... the impact that plays = the impact of a seat without the call ahead");
  eq(late.log.filter((x) => x.word).map(strip), ref.log.filter((x) => x.word).map(strip), "R6 ... and the same letterings");
  const gone = () => { const t = canvas.tokens.get(T0.id); t.document.hidden = true; };
  const g = await seat({ e, board, targets, change2: gone }), g0 = await seat({ e, board, targets, change2: gone, now: null });
  ok(g.stops.length === 1 && g.early.taken === 0, "R6 the target hidden after the call ahead: the call ahead is stopped");
  eq(impacts(g).slice(1).map(strip), impacts(g0).map(strip), "R6 ... the impact that plays = the impact of a seat without the call ahead");
}
/* R7: a moment that never plays drops it */
{
  const s = await seat({ e: KINDS.critical, board: BOARDS.crowd, targets: [T0.id], noPlay: true });
  const a = impacts(s);
  ok(a.length === 1 && s.stops.length === 1, `R7 never played: the impact asked ahead is stopped (${s.stops.length})`);
  ok(s.stops[0]?.t <= AT + 400 + 1, `R7 ... ${Math.round((s.stops[0]?.t ?? 0) - AT)} ms after its instant at the latest`);
}
/* R8: where it is not the very call its word would make, nothing is asked ahead (as before) */
for (const [tag, o] of [["a pushed roll (its prefix letters first)", { e: KINDS.pushed }], ["a map layer (the word is the impact's `keep`)", { e: KINDS.strong, layer: "overlay", board: BOARDS.empty }], ["a miss", { e: KINDS.miss }], ["the clock not good yet (no instant handed)", { e: KINDS.critical, nowAt: null }]]) {
  const s = await seat({ board: BOARDS.crowd, targets: [T0.id], ...o }), n = await seat({ board: BOARDS.crowd, targets: [T0.id], ...o, now: null });
  if (o.layer) ok(s.log.some((x) => x.word && x.o.space === "world"), `R8 ${tag}: the word is lettered on the board`);
  ok(s.early.armed === 0 && impacts(s).every((x) => x.t >= AT), `R8 ${tag}: nothing asked ahead`);
  eq(calls(s), calls(n), `R8 ${tag}: the same calls as before`);
}
console.log(`  most placings of one layout ahead: ${heavy}; the impact asked at least ${Math.round(gain)} ms before its first drawing`);
Object.defineProperty(globalThis, "performance", { value: realPerf, configurable: true, writable: true });
done("rollstall");
const sm = summary();
console.log(`sweep rollstall: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
