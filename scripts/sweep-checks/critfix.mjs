/* node scripts/sweep-checks/critfix.mjs -- CRITFIX (2026-11-14): the dice splash's opt-in Backdrop (client setting splashBackdrop, the
   owner: the critical plays WITHOUT one by default) against the engine's impact frame. A comparison film showed, with the backdrop on:
   the wash and the rays drawn OVER the impact frame (our layer is above the engine's impact overlay, so that the words stay on top of it):
   the black-and-white slam turned lavender, the clear spot glowed white over it, the struck silhouette was lost; and a dark ring round the
   hero's clear spot in every hold frame (the spot reached well past the token: unwashed map round it, darker than the wash). Checked here:
     B1  with an impact frame on this seat the backdrop (wash, rays) is NOT on the page before the impact's last drawing, and enters then;
     B2  the words and the impact (their calls, times, specs) are the same with the backdrop on and off (the backdrop changes no timing);
     B3  the struck target this seat sees keeps a clear spot too (two spots, intersected); a target this seat cannot see gets none;
     B4  no impact on this seat (the word and the target off its view, or an engine without impact frames): the backdrop as before;
     B5  the clear spot ends at the token's rim (no ring of unwashed map round it);
   With the backdrop OFF nothing changed at all: proved outside this suite by a fingerprint of every page state, engine call and impact
   spec over 60 cases against tactics @ d40fa79 (scratchpad critfix/fp.mjs; equal). The page, the canvas and the engine are fakes (as
   rolltarget.mjs), on a virtual clock; the impact's plan is the real one (scripts/letters/impact/plan.mjs). */
import { ok, eq, done, summary } from "../tactics/testkit.mjs";
import * as SL from "../splash/logic.mjs";
import { planImpact } from "../letters/impact/plan.mjs";

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng: seq([0.1, 0.5, 0.9, 0.3]), st: null, dryN: 0 });
let clock = 1000;
const realPerf = globalThis.performance;
Object.defineProperty(globalThis, "performance", { value: { now: () => clock }, configurable: true, writable: true });

function fakeDom(W, H) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "", anims: [],
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, remove: (...c) => { self.className = self.className.split(" ").filter((x) => !c.includes(x)).join(" "); }, contains: (c) => self.className.split(" ").includes(c), toggle() {} }; },
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
  const el = (r) => ({ getBoundingClientRect: () => r });
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: (id) => (id === "sidebar" ? el(rects["#sidebar"]) : null),
    querySelector: () => null, querySelectorAll: (s) => { const r = rects[s]; return r ? [el(r)] : []; } };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style.zIndex ?? "auto", display: e.style.display ?? "block", visibility: "visible", opacity: e.style.opacity ?? "1" });
  return doc;
}
const SLAM = () => ({ ent: [{ ticks: 2, g: { s: 0.82 }, fx: [] }, { ticks: 1, g: { s: 1.12 }, fx: [], impact: true }, { ticks: 2, g: { s: 0.86 }, fx: [{ k: "burst" }] }, { ticks: 4, g: {}, fx: [] }], hold: [{ ticks: 3 }], exit: [{ ticks: 2 }] });
function fakeEngine(log, impact) {
  let n = 0;
  const box = (text) => { const lines = String(text).split("\n"); return { w: 0.6 * Math.max(...lines.map((l) => l.length)) + 0.3, h: 1.2 * lines.length + 0.1 }; };
  const L = { prefs: { enabled: true, scale: 1 },
    planFor: (text, op) => ({ plan: { _holdBox: box(text), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` }, timeline: SLAM() }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) {
      const h = { id: "h" + ++n, hand: `hand-${op.seed ?? n}`, alive: true, off: false, stop(x) { log.push({ t: clock, stop: h.id, x }); h.alive = false; }, moveTo(a) { log.push({ t: clock, move: h.id, a }); },
        ready: Promise.resolve(true), finished: new Promise(() => {}), plan: { timeline: SLAM() } };
      log.push({ t: clock, word: text, o: { ...op, parent: op.parent ? "P" : undefined, token: op.token?.id } }); return h;
    } };
  if (impact) L.impact = { plan: (spec) => planImpact(spec), play(spec) { log.push({ t: clock, impact: { ...spec, subject: spec.subject?.id ?? spec.subject, from: spec.from?.id, keep: spec.keep?.id } }); return { alive: true, finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} }; } };
  return L;
}
const tok = (id, x, y) => ({ id, visible: true, document: { id, x, y, width: 1, height: 1, hidden: false, texture: { scaleX: 1, scaleY: 1 } }, x, y, w: 100, h: 100, center: { x: x + 50, y: y + 50 } });
function scene({ tokens = [], sees = null, pan = { x: 0, y: 0 } }) {
  const toClient = (q) => ({ x: q.x + pan.x, y: q.y + pan.y });
  const vision = sees ? { tokenVision: true, testVisibility: (pts, o) => sees.includes(o?.object?.id) } : null;
  return { ready: true, grid: { size: 100 }, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 4000, height: 3000 } },
    stage: { scale: { x: 1 }, toLocal: (q) => ({ x: q.x - pan.x, y: q.y - pan.y }), toGlobal: toClient },
    app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
    tokens: { placeables: tokens, get: (id) => tokens.find((t) => t.id === id) }, notes: { placeables: [] }, visibility: vision };
}
const BD_CLASSES = ["ins-backdrop", "ins-fullrays", "ins-raywrap"];
function nodes(n, out = []) { if (!n) return out; if (BD_CLASSES.some((c) => (n.className ?? "").split(" ").includes(c))) out.push(n); (n.children ?? []).forEach((c) => nodes(c, out)); return out; }
let runN = 0;
async function seat({ layer = "screen", e, hero, tokens = [], targets = [], gm = true, sees = null, pan, backdrop, impact = true }) {
  clock = 1000;
  { let r = 777; Math.random = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648); }
  globalThis.document = fakeDom(1600, 900);
  globalThis.window = { innerWidth: 1600, innerHeight: 900, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, at: clock + (ms || 0), i: timers.length }); return timers.length; };
  globalThis.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].done = true; };
  const Stage = await import(`../splash/stage.mjs?critfix-${++runN}`);
  const S = await import("../splash/splash.mjs");
  globalThis.canvas = scene({ tokens: [hero, ...tokens], sees, pan });
  globalThis.game = { user: { isGM: gm, id: gm ? "GM" : "P1" } };
  const log = [], L = fakeEngine(log, impact);
  Stage.setLetters(L); Stage.setLayer(layer); S.setReduced(false);
  const ctl = Stage.play(e, { token: hero, from: hero, targets, scale: 1, hold: 1, fx: 1, fullFrom: 0.7, seed: "CF", resolve: () => ({ now: 5, max: 8 }), backdrop });
  const states = [{ t: clock, bd: nodes(document.body).map((x) => x.className) }];
  let first = null;   // the first backdrop nodes seen (with their styles)
  const look = () => { const b = nodes(document.body); if (b.length && !first) first = { t: clock, b: b.map((x) => ({ c: x.className, mask: x.style.maskImage, comp: x.style.maskComposite, wcomp: x.style.webkitMaskComposite })) }; };
  look();
  let t;
  while ((t = timers.filter((x) => !x.done).sort((a, b) => a.at - b.at || a.i - b.i)[0])) { t.done = true; clock = Math.max(clock, t.at); t.f(); states.push({ t: clock, bd: nodes(document.body).map((x) => x.className) }); look(); }
  const out = { log, ctl, states, first, impactEnd: ctl.impactEnd, impacts: log.filter((x) => x.impact), Stage };
  const spot = Stage.spotMask;
  Stage.clearAll(); Stage.setLayer("screen"); delete globalThis.canvas;
  return { ...out, spot };
}
const crit = ev({ n: 4, sixes: 4 }), strong = ev({ n: 5, sixes: 3 });
const hero = tok("HERO000000000000", 500, 380), T = tok("TGT0000000000000", 900, 420);
const wordAt = (s) => s.log.find((x) => x.word && /:word$/.test(x.o.seed ?? ""))?.t;

/* ================================================================== B1 + B2 + B3: the impact first, the backdrop after it */
for (const layer of ["screen", "overlay", "ui"]) {
  const on = await seat({ layer, e: crit, hero, tokens: [T], targets: [T.id], backdrop: true });
  const off = await seat({ layer, e: crit, hero, tokens: [T], targets: [T.id], backdrop: false });
  ok(on.impacts.length === 1 && on.impacts[0].impact.subject === T.id, `B1 ${layer}: the critical's impact plays, on the target (${on.impacts[0]?.impact.subject})`);
  ok(Number.isFinite(on.impactEnd) && on.impactEnd > on.impacts[0].t, `B1 ${layer}: ... and this seat knows when its last drawing is over (${on.impactEnd})`);
  const early = on.states.filter((s) => s.t < on.impactEnd && s.bd.length);
  ok(early.length === 0, `B1 ${layer}: no wash or rays on the page before the impact is over (${early.map((s) => `${s.t}:${s.bd}`).slice(0, 3)}; the film: the slam turned lavender under the wash)`);
  ok(on.first && Math.abs(on.first.t - on.impactEnd) <= 1 && on.first.b.some((x) => x.c === "ins-backdrop") && on.first.b.some((x) => x.c === "ins-fullrays"), `B1 ${layer}: the wash and the rays enter as the impact ends (${on.first?.t} vs ${on.impactEnd})`);
  eq(JSON.stringify(on.log), JSON.stringify(off.log), `B2 ${layer}: the words and the impact (calls, times, specs) are the same with the backdrop on and off`);
  ok(off.states.every((s) => s.bd.length === 0), `B2 ${layer}: with the backdrop off no wash or rays at any time (the owner: «Bez»)`);
  /* B3: the struck target this seat sees keeps a clear spot */
  const bd = on.first?.b.find((x) => x.c === "ins-backdrop"), wrap = on.first?.b.find((x) => x.c === "ins-raywrap");
  const spots = (bd?.mask ?? "").match(/radial-gradient\(\d+px \d+px at (\d+)px (\d+)px/g) ?? [];
  ok(spots.length === 2 && spots.some((s) => s.includes("at 550px 430px")) && spots.some((s) => s.includes("at 950px 470px")), `B3 ${layer}: clear spots over the hero AND the struck target (${spots})`);
  ok(bd?.comp === "intersect" && bd?.wcomp === "source-in" && wrap?.comp === "intersect" && wrap?.mask === bd?.mask, `B3 ${layer}: ... intersected (both holes stay clear), on the wash and on the rays' wrapper`);
}
/* the strong (not critical) roll: no full screen, no backdrop either way */
{
  const s = await seat({ e: strong, hero, tokens: [T], targets: [T.id], backdrop: true });
  ok(s.states.every((x) => x.bd.length === 0), "B1: a strong (not critical) result has no backdrop at all");
}
/* B3: a player who cannot see the target: the impact marks the word, and the wash has only the hero's spot (no hidden token marked) */
{
  const p = await seat({ e: crit, hero, tokens: [T], targets: [T.id], gm: false, sees: [hero.id], backdrop: true });
  const bd = p.first?.b.find((x) => x.c === "ins-backdrop");
  ok(p.impacts.length === 1 && p.impacts[0].impact.subject !== T.id, "B3: a player who cannot see the target: the impact on the word (ROLLTARGET)");
  ok(bd && (bd.mask.match(/radial-gradient/g) ?? []).length === 1 && bd.mask.includes("at 550px 430px") && !bd.mask.includes("950px") && !bd.comp, `B3: ... the wash keeps only the hero's spot: nothing marks the unseen target (${bd?.mask?.slice(0, 50)})`);
  ok(p.first && Math.abs(p.first.t - p.impactEnd) <= 1, "B3: ... and enters after that seat's impact");
  const g = await seat({ e: crit, hero, tokens: [T], targets: [T.id], gm: true, sees: [hero.id], backdrop: true });
  eq(wordAt(g), wordAt(p), "B2: the GM and that player letter the word on the same instant with the backdrop on");
}
/* B4: no impact on this seat */
{
  /* a map layer, the word and the target off this view: no impact, the backdrop enters on the word's strike */
  const s = await seat({ layer: "overlay", e: crit, hero, tokens: [T], targets: [T.id], pan: { x: -3000, y: -2500 }, backdrop: true });
  ok(s.impacts.length === 0, "B4: a map moment wholly off this view: no impact here");
  ok(s.first && s.first.t === wordAt(s), `B4: ... the backdrop enters with the word (${s.first?.t} / ${wordAt(s)})`);
  /* an engine without impact frames: the backdrop from the start, as before */
  const n = await seat({ e: crit, hero, tokens: [T], targets: [T.id], backdrop: true, impact: false });
  ok(n.states[0].bd.includes("ins-backdrop") && n.states[0].bd.includes("ins-fullrays"), `B4: an engine without impact frames: the backdrop is up from the start, as before (${n.states[0].bd})`);
  ok((n.first?.b.find((x) => x.c === "ins-backdrop")?.mask.match(/radial-gradient/g) ?? []).length === 1, "B4: ... with the hero's spot only (no impact landed on a target)");
}
/* B5: the clear spot ends at the token's rim */
{
  const { spot } = await seat({ e: strong, hero, backdrop: false });
  for (const w of [60, 100, 190, 320]) {
    const m = spot({ l: 100, t: 100, r: 100 + w, b: 100 + w }).match(/radial-gradient\((\d+)px (\d+)px at (\d+)px (\d+)px, transparent 0, transparent (\d+)%, #000 100%\)/);
    const rx = Number(m?.[1]), clear = (rx * Number(m?.[5])) / 100;
    ok(m && Math.abs(Number(m[3]) - (100 + w / 2)) <= 1, `B5 ${w}px: the spot is centred on the token`);
    ok(m && clear >= w / 2 - 1 && clear <= w / 2 + 4, `B5 ${w}px: fully clear up to the token's rim and no further (${clear.toFixed(1)} px for a ${w / 2} px half size; before: ${(0.8 * (0.75 * w + 12)).toFixed(0)} px, a ring of unwashed map)`);
    ok(m && rx - clear <= Math.max(10, 0.2 * (w / 2)) && rx - clear >= 6, `B5 ${w}px: ... then a short feather (${(rx - clear).toFixed(1)} px)`);
  }
}
Object.defineProperty(globalThis, "performance", { value: realPerf, configurable: true, writable: true });
done("critfix");
const sm = summary();
console.log(`sweep critfix: ${sm.checks} checks, ${sm.failed} failed`);
process.exit(sm.failed ? 1 : 0);
