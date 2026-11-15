// node scripts/sweep-checks/critpeak.mjs  -- CRITPEAK (2026-11-14): the roll's block (word + captions + gauge) BUILDS with the roll.
// The blind two-seat review ADVX found the opposite (findings 2, 3, 4, 15): the critical's word no bigger than a strong roll's (on the map
// layer smaller than an ordinary roll's), the critical's captions smaller than a strong roll's and across the target's face, the whole splash
// a speck at the scene's far view although on the screen layer, the pushed-roll cluster small and its gauge unreadable; and a map-layer word
// that no seat saw (SYNC take, M1/M2: the block was laid out by a roller outside the view).
// Here one fake page and engine (samepic.mjs's) plays every roll kind on both layers at far, normal and close zoom, with a target and
// without, as the GM and as a player, and measures what is drawn ON SCREEN (px): the size order, the readable minimums, and that nothing of
// the block covers the roller, the target, another token or leaves the view. CRITPEAK_TABLE=1 prints the measured sizes.
import * as SL from "../splash/logic.mjs";
import * as LP from "../splash/letter-plan.mjs";

let n = 0, f = 0;
const ok = (c, msg) => { n++; if (!c) { f++; console.log("FAIL", msg); } };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng: seq([0.1, 0.5, 0.9, 0.3]), st: null, dryN: 0 });
/* the roll kinds (P from SL.powerOf): ordinary = a success without a sentence, strong = with one, critical = over the full-screen bar */
const KINDS = () => ({
  ordinary: ev({ n: 4, sixes: 1 }),
  strong: ev({ n: 5, sixes: 2 }),
  strong2: ev({ n: 6, sixes: 3 }),
  critical: ev({ n: 3, sixes: 3 }),
  missed: ev({ n: 12, sixes: 0 }),
  routine: ev({ n: 1, sixes: 0 }),
  pushed: ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, stress: 2 })
});
const FULL_FROM = 0.7;

/* ---------------------------------------------------------------- a fake page and engine (samepic.mjs's) */
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
  const side = ui.side ?? 300;
  const rects = {
    "#sidebar": R(W - side, 0, side, H),
    "#hotbar": R(W * 0.3, H - 66, 560, 58),
    "#scene-controls": R(8, 50, 46, H - 260),
    ...(ui.nav ? { "#scene-navigation li": R(104, 8, 170, ui.nav) } : {}),
    ...(ui.party ? { "#invincible-party li": [R(60, H - 330, 230, 70), R(60, H - 255, 230, 70)] } : {}),
    ...(ui.win ? { ".application.window-app": R(...ui.win) } : {})
  };
  const el = (r) => ({ getBoundingClientRect: () => r });
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: (id) => (id === "sidebar" ? el(rects["#sidebar"]) : null),
    querySelector: () => null, querySelectorAll: (s) => { const r = rects[s] ?? (s.includes(".application") ? rects[".application.window-app"] : null); return r ? (Array.isArray(r) ? r : [r]).map(el) : []; } };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style.zIndex ?? "auto", display: e.style.display ?? "block", visibility: "visible", opacity: e.style.opacity ?? "1" });
  return doc;
}
function fakeEngine(k = 1) {
  const calls = []; let i = 0;
  const box = (text, op) => { const lines = String(text).split("\n"); const tilt = op.reduced ? 1 : 1 + Math.abs(op.rotation ?? 0) * 0.01; return { w: (0.6 * Math.max(...lines.map((l) => l.length)) + 0.3) * tilt, h: (1.2 * lines.length + 0.1) * tilt }; };
  return { calls, prefs: { enabled: true, scale: k },
    planFor: (text, op) => ({ plan: { _holdBox: box(text, op), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` } }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) { const h = { id: "h" + ++i, hand: `hand-${op.seed ?? i}`, alive: true, stop() { h.alive = false; }, moveTo() {}, ready: Promise.resolve(true), finished: new Promise(() => {}) }; calls.push({ text, o: op, h }); return h; } };
}
const GS = 350;   // The Warehouse's grid
const tok = (id, x, y, o = {}) => ({ id, name: id, visible: true, document: { id, x, y, width: 1, height: 1, hidden: !!o.hidden, texture: { scaleX: 1, scaleY: 1 } },
  x, y, w: GS, h: GS, center: { x: x + GS / 2, y: y + GS / 2 } });
const note = (id, x, y) => ({ id, visible: true, document: { id, x, y, iconSize: 40 } });
/* the board: the roller, the target right of him, a neighbour up-left, one below, a pin above-right (The Warehouse's spacing); crowd: the
   neighbours and the pin pressed round the two (every side of them touches something at the normal view) */
const board = (crowd = false, hx = 2800, hy = 1700) => {
  const hero = tok("HEROaaaaaaaaaaaa", hx, hy), target = tok("TARGETaaaaaaaaaa", hx + 1.3 * GS, hy + 0.2 * GS);
  const nb = crowd ? [[-1.2, -1.1], [0.3, 1.4]] : [[-2.4, -1.7], [0.4, 2.5]], pin = crowd ? [1.1, -1.2] : [1.9, -2.1];
  return { hero, target, tokens: [hero, target, ...nb.map(([dx, dy], i) => tok("NB" + i, hx + dx * GS, hy + dy * GS))], notes: [note("PIN", hx + pin[0] * GS, hy + pin[1] * GS)] };
};
let runN = 0;
/* one seat playing one roll: what it drew, on screen (px), with the boxes of the roller, the target and the other tokens */
async function seat(o) {
  const { W = 1600, H = 900, ui = { side: 300, party: true }, layer, zoom, e, full = false, gm = false, target = true, center: c0, crowd = false } = o;
  globalThis.document = fakeDom(W, H, ui);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [], st = globalThis.setTimeout, ct = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  try {
    const Stage = await import(`../splash/stage.mjs?critpeak-${++runN}`);
    const S = await import("../splash/splash.mjs");
    S.setReduced(false);
    const b = board(crowd);
    const center = c0 ?? { x: b.hero.center.x + 0.4 * GS, y: b.hero.center.y };
    const pan = { x: W / 2 - center.x * zoom, y: H / 2 - center.y * zoom };
    const toClient = (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y });
    globalThis.canvas = { ready: true, grid: { size: GS }, dimensions: { size: GS, sceneRect: { x: 0, y: 0, width: 7000, height: 4200 } },
      stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: toClient },
      app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
      tokens: { placeables: b.tokens, get: (id) => b.tokens.find((t) => t.id === id) }, notes: { placeables: b.notes } };
    globalThis.game = { user: { isGM: gm } };
    const L = fakeEngine(1); Stage.setLetters(L); Stage.setLayer(layer);
    const ctl = Stage.play(e, { token: b.hero, scale: 1, hold: 1, fx: 1, fullFrom: full ? FULL_FROM : null, seed: "CP-" + (o.name ?? "x"), resolve: () => ({ now: 5, max: 8 }), targets: target ? [b.target.id] : [], from: b.hero });
    let t; while ((t = timers.filter((x) => !x.done).sort((a, b2) => a.ms - b2.ms)[0])) { t.done = true; t.fn(); }
    const box = (tk) => { const a = toClient({ x: tk.document.x, y: tk.document.y }); return { l: a.x, t: a.y, r: a.x + GS * zoom, b: a.y + GS * zoom }; };
    const drawn = L.calls.filter((c) => c.o.seed?.startsWith("CP-")).map((c) => {
      const lp = L.planFor(c.text, { ...c.o, reduced: false }).plan, Sz = c.o.size * lp.sizeK;
      const world = c.o.space === "world", px = world ? zoom : 1, at = world ? toClient(c.o.at) : c.o.at;
      const w = lp._holdBox.w * Sz * px, h = lp._holdBox.h * Sz * px;
      return { role: c.o.seed.split(":").pop(), text: c.text, S: Math.round(Sz * px * 10) / 10, world, l: at.x - w / 2, t: at.y - h / 2, r: at.x + w / 2, b: at.y + h / 2 };
    });
    let gauge = null;
    const g = ctl?.layout?.gauge;
    if (g) {
      const p = ctl.shared ? toClient({ x: g.x, y: g.y }) : { x: g.x, y: g.y }, k = ctl.shared ? zoom : 1;
      gauge = { l: p.x, t: p.y, r: p.x + g.w * k, b: p.y + g.h * k, label: Math.round(20 * (ctl.shared ? 1 : 900 / 768) * (ctl.shared ? (ctl.gaugeK * (g.k ?? 1) * zoom) : (g.k ?? 1)) * 10) / 10 };
    }
    const log = Stage.sameLog().at(-1);
    if (process.env.CP_DEBUG && o.name === process.env.CP_DEBUG) console.log("DBG", JSON.stringify({ safe: ctl?.layout?.frame?.safe, avoid: ctl?.layout?.frame?.avoid, log, side: ctl?.layout?.side, hit: ctl?.layout?.hit, f: ctl?.layout?.f, rect: ctl?.layout?.rect, hero: box(b.hero), target: box(b.target), drawn }));
    Stage.clearAll(); Stage.setLayer("screen");
    return { drawn, gauge, W, H, hero: box(b.hero), target: box(b.target), others: b.tokens.filter((x) => !["HEROaaaaaaaaaaaa", "TARGETaaaaaaaaaa"].includes(x.id)).map(box), moved: log?.moved };
  } finally { globalThis.setTimeout = st; globalThis.clearTimeout = ct; delete globalThis.canvas; delete globalThis.game; }
}
const ov = (a, q, m = 0) => Math.max(0, Math.min(a.r, q.r + m) - Math.max(a.l, q.l - m)) * Math.max(0, Math.min(a.b, q.b + m) - Math.max(a.t, q.t - m));
const wordS = (s) => s.drawn.find((d) => d.role === "word")?.S ?? 0;
const rows = [];
const ZOOMS = { far: 0.14, board: 0.5, normal: 0.8, close: 1.2 };   // board: The Warehouse (350 px squares) at the zoom the map layer keeps
const LAYERS = ["screen", "overlay"];
/* minimum readable sizes on screen (cap height, px): the word by rank, the info lines, the gauge's figures */
const READ = { word: { ordinary: 56, strong: 80, critical: 130, missed: 44, routine: 44, pushed: 56 }, pre: 56, six: 28, say: 26, odds: 24, stress: 26, gauge: 18 };
/* where the view leaves no clean place at all (a close view: two tokens fill the middle; a crowd pressed round them), the block may lie on
   the other tokens' art, and on the roller's and the target's rim only (TIGHT share of their box), never smaller than its rank */
const TIGHT = 0.25, TIGHT_OTHER = 0.4;   // a crowd: a bystander may lose up to 40 % of its box to the critical for its 2 s (CRITPEAK-2, provisional)
const CASES = [];
for (const layer of LAYERS) for (const [zn, zoom] of Object.entries(ZOOMS)) for (const target of [true, false]) CASES.push({ layer, zn, zoom, target, crowd: false, tight: zn === "close" || zn === "board" });   // board: 175 px tokens, three within 2.5 squares: the middle is full
for (const layer of LAYERS) CASES.push({ layer, zn: "normal", zoom: 0.8, target: true, crowd: true, tight: true });
for (const { layer, zn, zoom, target, crowd, tight } of CASES) {
  const res = {};
  for (const [kind, e] of Object.entries(KINDS())) {
    const s = await seat({ name: `${layer}-${zn}-${kind}${crowd ? "-crowd" : ""}`, layer, zoom, e, full: kind === "critical", target, crowd });
    res[kind] = s;
    rows.push({ layer, zoom: zn + (crowd ? "*" : ""), target, kind, word: wordS(s), parts: s.drawn.filter((d) => d.role !== "word").map((d) => `${d.role} ${d.S}`).join(", "), gauge: s.gauge?.label ?? "" });
    const tag = `${layer} ${zn}${crowd ? " crowd" : ""} ${target ? "target" : "no target"} ${kind}`;
    ok(s.drawn.length > 0, `${tag}: something is drawn`);
    /* minimum readable sizes, on screen, at every zoom */
    for (const d of s.drawn) {
      const min = d.role === "word" ? READ.word[kind] : READ[d.role];
      if (min) ok(d.S >= min - 0.5, `${tag}: ${d.role} "${d.text}" is readable (${d.S} px >= ${min})`);
    }
    if (s.gauge) ok(s.gauge.label >= READ.gauge, `${tag}: the gauge's figures are readable (${s.gauge.label} px >= ${READ.gauge})`);
    /* nothing of the block covers the roller, the target or another token; every part inside the window */
    const parts = [...s.drawn, ...(s.gauge ? [{ role: "gauge", ...s.gauge }] : [])];
    const sum = (q) => parts.reduce((a, d) => a + ov(d, q), 0), area = (q) => (q.r - q.l) * (q.b - q.t);
    if (!tight) {
      for (const d of parts) {
        ok(ov(d, s.hero) < 0.02 * area(s.hero) + 1, `${tag}: ${d.role} clear of the roller (${Math.round(ov(d, s.hero))} px2)`);
        ok(ov(d, s.target) < 0.02 * area(s.target) + 1, `${tag}: ${d.role} clear of the target (${Math.round(ov(d, s.target))} px2)`);
        for (const q of s.others) ok(ov(d, q) < 0.05 * area(q) + 1, `${tag}: ${d.role} clear of the other tokens (${Math.round(ov(d, q))} px2)`);
      }
    } else for (const [nm, q] of [["roller", s.hero], ["target", s.target], ...s.others.map((o) => ["other token", o])]) ok(sum(q) <= (nm === "other token" ? TIGHT_OTHER : TIGHT) * area(q), `${tag}: no room anywhere: the block keeps off the ${nm} but its rim (${Math.round(sum(q) / area(q) * 100)} % of its box)`);
    for (const d of parts) ok(d.l >= -1 && d.t >= -1 && d.r <= s.W + 1 && d.b <= s.H + 1, `${tag}: ${d.role} on the view [${[d.l, d.t, d.r, d.b].map(Math.round)}]`);
  }
  /* the size order the table reads: critical > strong > ordinary (and the pushed result is a result of its rank) */
  const tag = `${layer} ${zn}${crowd ? " crowd" : ""} ${target ? "target" : "no target"}`;
  const W = (k) => wordS(res[k]);
  ok(W("critical") >= 1.15 * Math.max(W("strong"), W("strong2")), `${tag}: the critical's word is the biggest (${W("critical")} vs strong ${W("strong")}/${W("strong2")})`);
  ok(Math.min(W("strong"), W("strong2")) >= 1.15 * W("ordinary"), `${tag}: a strong roll's word is clearly bigger than an ordinary one's (${W("strong")}/${W("strong2")} vs ${W("ordinary")})`);
  const cap = (k, r) => res[k].drawn.find((d) => d.role === r)?.S ?? 0;
  for (const r of ["say", "odds", "six"]) ok(cap("critical", r) >= cap("strong", r) && cap("critical", r) >= cap("strong2", r), `${tag}: the critical's ${r} is no smaller than a strong roll's (${cap("critical", r)} vs ${cap("strong", r)}/${cap("strong2", r)})`);
  ok(W("ordinary") > W("missed") * 0.9, `${tag}: a miss is no louder than a success (${W("missed")} vs ${W("ordinary")})`);
  /* the pushed roll: the grunt is a beat of its own, about as big as an ordinary result */
  const pre = res.pushed.drawn.find((d) => d.role === "pre");
  ok(!!pre && pre.S >= 0.8 * W("ordinary"), `${tag}: the push grunt reads as a beat (${pre?.S} vs ordinary ${W("ordinary")})`);
}

/* the map-layer word is on the view of a seat whose roller is OUTSIDE its view (SYNC take M1/M2: the block stood by the roller, off every
   seat's view, at the scene's top): it plays where this seat sees it */
for (const kind of ["ordinary", "critical"]) {
  const e = KINDS()[kind];
  const b = board();
  const s = await seat({ name: `off-${kind}`, layer: "overlay", zoom: 0.8, e, full: kind === "critical", center: { x: b.hero.center.x + 1700, y: b.hero.center.y + 900 } });
  const w = s.drawn.find((d) => d.role === "word");
  ok(!!w && w.l >= 0 && w.t >= 0 && w.r <= s.W && w.b <= s.H, `map layer, roller off the view, ${kind}: the word is on the view (${w ? [w.l, w.t, w.r, w.b].map(Math.round) : "none"})`);
}

if (process.env.CRITPEAK_TABLE) {
  console.log("layer   zoom    target kind      word   parts | gauge label");
  for (const r of rows) console.log(`${r.layer.padEnd(7)} ${r.zoom.padEnd(7)} ${String(r.target).padEnd(6)} ${r.kind.padEnd(9)} ${String(r.word).padStart(6)}  ${r.parts}${r.gauge ? ` | ${r.gauge}` : ""}`);
}
console.log(`critpeak: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
