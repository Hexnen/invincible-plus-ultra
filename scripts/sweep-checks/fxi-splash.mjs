/* node scripts/sweep-checks/fxi-splash.mjs -- FXI-SPLASH (2026-11-14): the blind review ADVI of the dice-roll splash with impact frames.
   Every check here failed on tactics @ eb1dda6 (tag tactics-integrated-116) and passes now:
     P  (ADVI 10, privacy) a roller this seat cannot see (by vision, walls, fog, or hidden) gets no located word or impact on this seat:
        the map moment is not laid out at the roller's place, the impact never names the token or its scene point;
     T  (ADVI 2) the impact frame lands WITH the word: its peak drawing on the tick the word hits (the squash with its burst, read from the
        engine's plan of that word), its build (gathering lines) before it; asked for before the word, so the word's own flash gives way
        (one accent); the same instant on every seat;
     W  (ADVI 7, FXIS-1) the roll's impact marks the result word, not the roller's token;
     M  (ADVI 6) map layer: the impact never draws over the word's spot (only drawings that leave it clear), none for a word out of this
        seat's view; the block is laid out again inside THIS seat's free view when the shared place lies under its bars or past its edge;
     S  (ADVI 11) screen layer: the block's outline holds the word's biggest entrance drawing (the slam's smear), so it never crosses the
        bars, the panels or the edge; panels weigh like bars; stacked, the sixes come right under the word (the order they land), the
        caption is bigger.
   The page, the canvas and the engine are fakes (as wire1-splash.mjs); the engine's plan carries a real slam entrance timeline and its
   impact a real plan (scripts/letters/impact/plan.mjs). */
import fs from "node:fs";
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as IP from "../splash/impact-plan.mjs";
import * as LP from "../splash/letter-plan.mjs";
import { seesToken } from "../splash/seen.mjs";
import { planImpact } from "../letters/impact/plan.mjs";
import { impBlow, impStart } from "./align-imp.mjs";      // ALIGN: blowAt read with the engine's own plan

const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd, rng = seq([0.1, 0.5, 0.9, 0.3])) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng, st: null, dryN: 0 });
const TICK = 1000 / 24;

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
    "#scene-controls": R(0, 40, 80, H - 200),
    "#scene-navigation li": R(104, 16, 170, 32),
    ...(ui.vram ? { ".mm-vram": R(110, 80, 240, 40) } : {}),
    ...(ui.card ? { "#chat-notifications .chat-log > li": R(W - 361, H * 0.45, 295, 260) } : {})
  };
  const el = (r) => ({ getBoundingClientRect: () => r });
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: (id) => (id === "sidebar" ? el(rects["#sidebar"]) : null),
    querySelector: () => null, querySelectorAll: (s) => { const r = rects[s]; return r ? (Array.isArray(r) ? r : [r]).map(el) : []; } };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style.zIndex ?? "auto", display: e.style.display ?? "block", visibility: "visible", opacity: e.style.opacity ?? "1" });
  return doc;
}
/* a slam entrance as the engine plans it (design.mjs buildTimeline "slam" with anticipation, flash and smear): the contact (squash +
   burst) at 2 + 1 + 1 = 4 ticks; the smear 1.6 x 1.08 with its multiples */
const SLAM = () => ({ ent: [
  { ticks: 2, g: { s: 0.82, sx: 1.18, sy: 0.78 }, fx: [] }, { ticks: 1, g: { s: 1.12 }, fx: [], impact: true },
  { ticks: 1, g: { s: 1.6, sx: 1.08 }, fx: [{ k: "speed" }], smear: { zoom: 0.35, n: 3 } }, { ticks: 2, g: { s: 0.86, sx: 1.14, sy: 0.84 }, fx: [{ k: "burst" }] },
  { ticks: 2, g: { s: 1.05, sx: 0.95, sy: 1.07 }, fx: [] }, { ticks: 4, g: {}, fx: [] }], hold: [{ ticks: 3 }], exit: [{ ticks: 2 }] });
const POP = () => ({ ent: [{ ticks: 2, g: { s: 0.38 } }, { ticks: 1, g: { s: 1.2 }, fx: [{ k: "burst" }] }, { ticks: 2, g: { s: 0.95 } }, { ticks: 2, g: { s: 1.02 } }], hold: [{ ticks: 3 }], exit: [] });
function fakeEngine(log) {
  const calls = []; let n = 0;
  const box = (text) => { const lines = String(text).split("\n"); return { w: 0.6 * Math.max(...lines.map((l) => l.length)) + 0.3, h: 1.2 * lines.length + 0.1 }; };
  const tl = (op) => (op.in === "slam" ? SLAM() : POP());
  const L = { calls, prefs: { enabled: true, scale: 1 },
    planFor: (text, op) => ({ plan: { _holdBox: box(text), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` }, timeline: tl(op) }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) {
      const h = { id: "h" + ++n, hand: `hand-${op.seed ?? n}`, alive: true, off: false, stops: [], moves: [], stop(x) { h.alive = false; h.stops.push(x); }, moveTo(a) { h.moves.push(a); },
        ready: Promise.resolve(true), finished: new Promise(() => {}), plan: { timeline: tl(op) } };
      calls.push({ text, o: op, h }); log.push({ what: "word", seed: op.seed, t: performance.now() }); return h;
    } };
  L.impact = {
    plan: (spec) => planImpact(spec),
    play(spec) { log.push({ what: "impact", spec, t: performance.now() }); return { alive: true, plan: planImpact(spec), finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} }; }
  };
  return L;
}
const tok = (id, x, y, o = {}) => ({ id, visible: o.visible ?? true, document: { id, x, y, width: 1, height: 1, hidden: !!o.hidden, texture: { scaleX: 1, scaleY: 1 } },
  x, y, w: 100, h: 100, center: { x: x + 50, y: y + 50 } });
function scene({ zoom = 1, pan = { x: 0, y: 0 }, tokens = [], vision = null }) {
  const toClient = (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y });
  return { ready: true, grid: { size: 100 }, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 4000, height: 3000 } },
    stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: toClient },
    app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
    tokens: { placeables: tokens }, notes: { placeables: [] }, visibility: vision, _toClient: toClient };
}
let runN = 0;
async function seat({ W = 1600, H = 900, layer = "screen", e, name = "x", hero = null, tokens = null, full = true, fx = 1, gm = true, zoom = 1, pan = { x: 0, y: 0 }, ui = {}, vision = null }) {
  globalThis.document = fakeDom(W, H, ui);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  const Stage = await import(`../splash/stage.mjs?fxis-${++runN}`);
  const S = await import("../splash/splash.mjs");
  const flush = (upTo = 1e9) => { let t; while ((t = timers.filter((x) => !x.done && x.ms <= upTo).sort((a, b) => a.ms - b.ms)[0])) { t.done = true; t.f(); } };
  globalThis.canvas = scene({ zoom, pan, tokens: tokens ?? (hero ? [hero] : []), vision });
  globalThis.game = { user: { isGM: gm, id: gm ? "GM" : "P1" } };
  const log = [];
  const L = fakeEngine(log);
  Stage.setLetters(L); Stage.setLayer(layer); S.setReduced(false);
  const ctl = Stage.play(e, { token: hero, scale: 1, hold: 1, fx, fullFrom: full ? 0.7 : null, seed: "S-" + name, resolve: () => ({ now: 5, max: 8 }), backdrop: false });
  flush(1e9);
  const out = { log, calls: L.calls, ctl, L, impacts: log.filter((x) => x.what === "impact").map((x) => x.spec), toClient: globalThis.canvas._toClient, W, H };
  Stage.clearAll(); Stage.setLayer("screen"); delete globalThis.canvas;
  return out;
}
const R = { crit: ev({ n: 4, sixes: 4 }), strong: ev({ n: 5, sixes: 3 }), crit6: ev({ n: 6, sixes: 6 }) };
const wordCall = (s) => s.calls.find((c) => /:word$/.test(c.o.seed ?? ""));
/* ALIGN (engine 1.9.1): the splash hands the impact its blow (`blowAt` = the word's contact) and the engine starts it peakMs earlier; the peak
   is read with the engine's own plan (align-imp.mjs), not the caller's old "leading lines" measure */
const peakOf = (spec) => impBlow(spec);

/* ================================================================== P: privacy */
{
  /* seesToken: the seat's own answer, fails closed */
  const V = (see) => ({ tokenVision: true, testVisibility: () => see });
  const t = tok("T", 500, 500);
  eq([seesToken(t, { user: { isGM: false }, canvas: { visibility: V(false) } }), seesToken(t, { user: { isGM: false }, canvas: { visibility: V(true) } }),
    seesToken(t, { user: { isGM: true }, canvas: { visibility: V(false) } }), seesToken(tok("H", 1, 1, { hidden: true }), { user: { isGM: false }, canvas: { visibility: V(true) } }),
    seesToken(t, { user: { isGM: false }, canvas: { visibility: { tokenVision: true, testVisibility: () => { throw new Error("x"); } } } }),
    seesToken(t, { user: { isGM: false }, canvas: { visibility: { tokenVision: false } } })],
  [false, true, true, false, false, true], "P: seesToken: out of a player's sight no, in sight yes, the GM yes, hidden no, an error no (fails closed), no token vision yes");
  const m = src("../splash/main.mjs");
  ok(/function boardToken\(message\)[\s\S]{0,700}seesToken\(tok\)/.test(m), "P: the map's board token is asked whether THIS seat sees it (ADVI 10: it took any token that was not hidden)");
  ok(/function resolveToken\(message\)[\s\S]{0,900}seesToken\(tok\)/.test(m), "P: ... and so is the screen layer's token");
  /* a roller out of this player's sight handed to a map moment: nothing is laid out at its place, the impact names neither it nor its point */
  const hero = tok("UNS", 1200, 900);
  for (const layer of ["overlay", "tokens"]) {
    const s = await seat({ layer, e: R.crit, name: "p-" + layer, hero, gm: false, vision: V(false), full: false });
    const world = s.calls.filter((c) => c.o.space === "world");
    eq(world.length, 0, `P ${layer}: a roller this player cannot see by vision: no lettering on the board (it would stand by the roller)`);
    ok(s.calls.every((c) => c.o.token !== hero && c.o.at !== hero), `P ${layer}: no lettering is tied to the unseen roller`);
    const im = s.impacts[0];
    ok(!im || (im.space !== "world" && im.subject !== hero && !im.subject?.document && !("from" in im)), `P ${layer}: the impact has no place on the board and names no token (${JSON.stringify(im?.subject)} ${im?.space})`);
    const c = s.toClient(hero.center), w = wordCall(s);
    ok(w && Math.hypot(w.o.at.x - c.x, w.o.at.y - c.y) > 200, `P ${layer}: the word is not by the roller's place on this screen (${JSON.stringify(w?.o.at)} vs ${JSON.stringify(c)})`);
  }
  /* the same roller on a seat that sees it (the GM): the board moment as before */
  const g = await seat({ layer: "overlay", e: R.crit, name: "p-gm", hero, gm: true, vision: V(false), full: false });
  ok(g.calls.some((c) => c.o.space === "world"), "P: the GM (who sees the roller) gets the board moment");
}

/* ================================================================== T + W: the impact lands with the word, on the word */
for (const [name, e, full] of [["crit", R.crit, true], ["crit6", R.crit6, true], ["strong", R.strong, false]]) {
  const hero = tok("HERO", 650, 380);
  const s = await seat({ e, name, hero, full });
  const w = wordCall(s), im = s.impacts[0];
  ok(!!im && !!w, `T ${name}: one impact, one word`);
  if (!im || !w) continue;
  const contact = IP.contactMs({ timeline: w.h.plan.timeline });
  ok(contact > 0 && Number.isFinite(w.o.startAt), `T ${name}: the word starts on a known instant and hits ${Math.round(contact)} ms later (its squash with the burst)`);
  const peak = peakOf(im), hit = w.o.startAt + contact;
  ok(Math.abs(peak - hit) < 1, `T ${name}: the impact's peak drawing falls on the tick the word hits (peak ${Math.round(peak - w.o.startAt)} ms, hit ${Math.round(contact)} ms after the word starts; ADVI 2: it came 0.2-0.4 s after)`);
  ok(impStart(im) <= hit, `T ${name}: its build (the gathering lines) comes before the hit, not after (${Math.round(hit - impStart(im))} ms)`);
  ok(impStart(im) >= w.o.startAt - 1, `T ${name}: ... and not before the word itself starts (${Math.round(impStart(im) - w.o.startAt)} ms after it)`);
  /* ALIGN (engine 1.9.1, owner: one accent): replaced "the impact is asked for before the word (it owns the instant's flash budget: the word's
     own flash gives way)": that relied on the guard dropping the word's flash. Now the word says it: flash: false; the impact comes after it,
     so it lands on the word's contact as the engine reads it (L.contactAt) and can keep a map word readable */
  const iw = s.log.findIndex((x) => x.what === "word" && /:word$/.test(x.seed ?? "")), ii = s.log.findIndex((x) => x.what === "impact");
  ok(w.o.flash === false, "T: the struck result word does not flash on its own (flash: false): the impact is its one accent");
  ok(ii > iw && iw >= 0, "T: the impact is asked for after its word (on the word's contact, L.contactAt)");
  /* W: on the word, not on the roller */
  ok(im.subject !== hero && !im.subject?.document && Number.isFinite(im.subject?.w) && Math.abs(im.subject.x + im.subject.w / 2 - w.o.at.x) < 1 && Math.abs(im.subject.y + im.subject.h / 2 - w.o.at.y) < 1,
    `W ${name}: the impact marks the result word's box, not the roller's token (ADVI 7) (${JSON.stringify(im.subject)} vs word at ${JSON.stringify(w.o.at)})`);
  ok(!("from" in im) && !("dir" in im), `W ${name}: a roll strikes from nowhere: radial`);
}
/* one moment on two seats: the same instant relative to the word */
{
  const hero = tok("HERO", 650, 380);
  const a = await seat({ e: R.crit, name: "two", hero, gm: true, full: true }), b = await seat({ W: 1366, H: 768, e: R.crit, name: "two", hero, gm: false, full: false });
  const da = peakOf(a.impacts[0]) - wordCall(a).o.startAt, db = peakOf(b.impacts[0]) - wordCall(b).o.startAt;
  ok(Math.abs(da - db) < 1 && a.impacts[0].seed === b.impacts[0].seed && a.impacts[0].kind === b.impacts[0].kind, `T: GM and player: the same impact on the same tick of the same word (${Math.round(da)} / ${Math.round(db)} ms)`);
}
/* the pure parts */
{
  eq(IP.contactMs({ timeline: SLAM() }), Math.round(4 * TICK), "T: contact of a slam = its squash with the burst (after crouch, flash and smear), not the end of the entrance");
  eq(IP.contactMs({ timeline: POP() }), Math.round(2 * TICK), "T: contact of a pop = its biggest drawing with the burst");
  eq(IP.contactMs({ timeline: { ent: [{ ticks: 2, g: { s: 0.4 } }, { ticks: 1, g: { s: 1.3 } }, { ticks: 2, g: { s: 1 } }] } }), Math.round(2 * TICK), "T: no burst, no flash: the biggest drawing");
  eq(IP.contactMs({ contactMs: 120 }), 120, "T: an engine that names its contact is believed");
  /* engine 1.9 (MOTION2) plans: pose keys; the accent tick is the contact */
  const M2 = (o) => ({ motion: o, timeline: { ent: [{ ticks: 1, impact: !!o.flash, g: {} }, { ticks: 6, g: {} }] } });
  eq(IP.contactMs(M2({ flash: true, entKeys: [[0, { s: 1.3 }], [42, { s: 1.3 }], [104, { s: 0.94, sx: 1.12, sy: 0.88 }]] })), 0, "T 1.9: a word with its impact accent hits on the accent's tick");
  eq(IP.contactMs(M2({ flash: false, entKeys: [[0, { y: -1.5, sy: 1.12, sx: 0.92 }], [170, { y: 0, sy: 0.76, sx: 1.2 }], [240, {}]] })), 170, "T 1.9: a drop hits on its squash");
  eq(IP.contactMs(M2({ flash: false, entKeys: [[0, { s: 0.62 }], [90, { s: 1.14, sx: 0.95, sy: 1.06 }], [160, { s: 0.97 }], [240, {}]] })), 90, "T 1.9: a pop hits at its biggest");
  ok(IP.growOf(M2({ entKeys: [[0, { s: 1.4, sx: 0.97, sy: 1.03 }], [62, { s: 0.94, sx: 1.12, sy: 0.88 }]] })) >= 1.44, "S 1.9: the slam's arrival pose (1.4x) is room the block keeps");
  eq(IP.leadMs(planImpact({ kind: "crit", magnitude: 1.6 }).frames), Math.round(TICK), "T: the critical's build = its one tick of gathering lines");
  ok(IP.growOf({ timeline: SLAM() }) >= 1.7, `S: the slam's smear grows the word ${IP.growOf({ timeline: SLAM() }).toFixed(2)}x`);
}

/* ================================================================== M: map layer */
{
  const covers = (spec) => planImpact(spec).frames.filter((f) => IP.COVERS_WORD.includes(f.type)).map((f) => f.type);
  for (const m of [0.3, 0.5, 0.84, 1.1, 1.6, 2]) eq(covers({ kind: "crit", magnitude: m, frames: IP.mapFrames(m) }), [], `M: map frames at strength ${m} leave the word's spot clear (ADVI 6: the shadow frame hid it, the slam's star blacked it)`);
  ok(IP.mapFrames(0.5).length < IP.mapFrames(1.6).length && IP.mapFrames(1.6).some((f) => f.type === "window"), "M: the map impact still builds: more for the rarer result, the torn window for a critical");
  const hero = tok("HERO", 1200, 900);
  const s = await seat({ layer: "overlay", e: R.crit, name: "m1", hero, full: false });
  const im = s.impacts[0], w = wordCall(s);
  ok(im && im.space === "world" && Array.isArray(im.frames) && covers(im).length === 0 && Math.abs(im.subject.x + im.subject.w / 2 - w.o.at.x) < 1, `M: on the map the impact is in scene space round the word, with drawings that keep it readable (${JSON.stringify(im?.frames)})`);
  /* ALIGN (engine 1.9.1 keep): on the map the word is IN the scene under the impact: the impact keeps that very word readable; on the screen
     layer the word is above the impact and nothing is kept */
  ok(im && im.keep === w.h, "M: the map impact keeps its result word readable (keep: the word's handle)");
  { const sc = await seat({ layer: "screen", e: R.crit, name: "m0", hero, full: false }); ok(sc.impacts[0] && !("keep" in sc.impacts[0]), "M: ... on the screen layer nothing is kept (the word is above the impact)"); }
  /* the word off this seat's view (the seat looks elsewhere): no impact at the view's edge */
  const off = await seat({ layer: "overlay", e: R.crit, name: "m2", hero, full: false, pan: { x: -3000, y: -2500 } });
  eq(off.impacts.length, 0, "M: a map word out of this seat's view gets no impact frame (it would flash at the edge for nothing)");
  /* the shared place under THIS seat's hotbar: laid out again inside its free view; a seat with room keeps the shared place */
  const low = tok("LOW", 900, 720);
  const sa = await seat({ layer: "overlay", e: R.crit, name: "m3", hero: low, full: false, zoom: 1, pan: { x: 0, y: 0 }, W: 1600, H: 900 });
  const sb = await seat({ layer: "overlay", e: R.crit, name: "m3", hero: low, full: false, zoom: 1, pan: { x: 0, y: -600 }, W: 1600, H: 900 });
  const box = (s) => { const r = s.ctl.layout.rect; const a = s.toClient({ x: r.l, y: r.t }), c = s.toClient({ x: r.r, y: r.b }); return { l: a.x, t: a.y, r: c.x, b: c.y }; };
  const ba = box(sa), bb = box(sb);
  const hot = { l: 1600 * 0.3, t: 900 - 64, r: 1600 * 0.3 + 520, b: 900 - 8 };
  const hits = (r, q) => r.l < q.r && r.r > q.l && r.t < q.b && r.b > q.t;
  ok(!hits(ba, hot) && ba.b <= 900 - 10 && ba.r <= 1600 - 300, `M: the block stays off this seat's hotbar and inside its view (${JSON.stringify(ba)}; ADVI 6: captions under the hotbar and off the bottom)`);
  ok(bb.t >= 0 && !hits(bb, hot), `M: ... also on a seat that sees the token high on its screen (${JSON.stringify(bb)})`);
  eq(wordCall(sa).text, wordCall(sb).text, "M: both seats letter the same words");
}

/* ================================================================== S: screen layer */
{
  for (const [W, H] of [[1366, 768], [1600, 900], [1920, 1080]]) {
    const s = await seat({ W, H, e: R.crit, name: "s" + W, full: true, ui: { vram: true } });
    const w = wordCall(s), lp = s.L.planFor(w.text, w.o).plan, g = IP.growOf(lp);
    const S = w.o.size * lp.sizeK, ww = lp._holdBox.w * S, hh = lp._holdBox.h * S;
    const big = { l: w.o.at.x - ww * g / 2, r: w.o.at.x + ww * g / 2, t: w.o.at.y - hh * g / 2, b: w.o.at.y + hh * g / 2 };
    ok(big.l >= 80 && big.r <= W - 300 && big.t >= 0 && big.b <= H, `S ${W}: the critical's biggest entrance drawing stays inside the free view, off the left bar and the chat (${big.l.toFixed(0)}..${big.r.toFixed(0)} x ${big.t.toFixed(0)}..${big.b.toFixed(0)}; ADVI 11: CRUSH! left the screen)`);
    const vr = { l: 104, t: 74, r: 356, b: 126 };
    const hold = { l: w.o.at.x - ww / 2, r: w.o.at.x + ww / 2, t: w.o.at.y - hh / 2, b: w.o.at.y + hh / 2 };
    ok(!(hold.l < vr.r && hold.r > vr.l && hold.t < vr.b && hold.b > vr.t), `S ${W}: the critical's word does not lie on the VRAM panel (ADVI 11)`);
  }
  /* stacked (a crowded spot: a panel takes the right of the word row): the sixes right under the word, the caption after them */
  const items = LP.planMoment(R.crit, { token: true }).items;
  const out = LP.composeMoment(items, { vh: 768, scale: 1, safe: { l: 0, t: 0, r: 600, b: 760 }, focus: { x: 300, y: 380 }, token: { x: 300, y: 600, l: 260, t: 560, r: 340, b: 640 }, avoid: [{ l: 330, t: 0, r: 600, b: 760 }] });
  const by = Object.fromEntries(out.items.map((it) => [it.role, it]));
  ok(by.six && by.say && by.word && by.six.y > by.word.y && by.six.y < by.say.y && by.say.y < by.odds.y, `S: stacked, the sixes stand right under the word and above the caption, in the order they land (word ${by.word?.y}, six ${by.six?.y}, say ${by.say?.y}, odds ${by.odds?.y}; ADVI 11)`);
  const p = LP.planMoment(R.strong, { token: true }).items, byp = Object.fromEntries(p.map((it) => [it.role, it]));
  const pf = LP.planMoment(R.crit, { full: true }).items, byf = Object.fromEntries(pf.map((it) => [it.role, it]));
  ok(byp.say.cap >= 0.043 && byp.odds.cap >= 0.037 && byf.say.cap >= 0.053 && byf.odds.cap >= 0.045 && LP.FLOOR.say >= 21 && LP.FLOOR.odds >= 19, `S: the caption is bigger (by a token: say ${byp.say.cap}, odds ${byp.odds.cap}; critical: ${byf.say.cap}, ${byf.odds.cap} of the height; ADVI 11: small and thin)`);
}
done("fxi-splash");
const sm = summary();
console.log(`sweep fxi-splash: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
