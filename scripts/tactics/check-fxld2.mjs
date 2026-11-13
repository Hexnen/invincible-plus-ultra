/* node scripts/tactics/check-fxld2.mjs -- fixer FXLD2 (2026-11-13): the second blind review of the dice-roll lettering moment (ADVD2).
   Every check here failed on tactics @ 4aaa0b9 (= tactics-fxld bfda943) and passes now:
     N1  ONE moment for the table: on a map layer two seats (other window, zoom, pan, bars, chat card, engine Scale, the token off one
         seat's screen) letter the same words at the same scene place and the same scene size; on the screen layer the content, the
         timing and the size class are the same and only the place follows each seat's view;
     N2  on the map the block stays inside the scene and every exit stays where the word stood (no letters falling across tokens);
     N3  the block keeps off the neighbours' tokens, the map note pins, the resting dice and the panels;
     N4  the Resolve gauge: one pip shape, the pips count what is left like the number, two deliberate lines, a legible face and size;
     N5  a map moment is not ~4 s late: this seat asks Dice So Nice to fade its resting dice and starts as they go;
     N6  the critical never hides its hero (the block keeps off the token; with the Backdrop setting on the wash has a clear spot);
         the owner (2026-11-13): no backdrop by default, the critical keeps one short accent;
     N7  a pushed block keeps off the rolling token (screen and map; regression watch);
     N8  the same start on every seat (beat.mjs: two simulated seats whose dice stop 180 ms apart start at the same server time);
     N9  Polish copy (no calque, no doubled NA);
     N10 the routine miss is readable (size, time, off the token's ring);
     N11 the push grunt is a beat of its own (size, time);
     N12 the caller's part of ADVD2 12: on a lit map layer the numbers and the caption go over the lighting and the weather. */
import fs from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as LP from "../splash/letter-plan.mjs";

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd, rng = seq([0.1, 0.5, 0.9, 0.3])) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng, st: null, dryN: 0 });
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

/* ---------------------------------------------------------------- a fake page (as check-fxld.mjs, plus panels, a recorded animate) */
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
/* the drawn box of a call: in client px (screen) or scene px (world, scene: true) */
function drawn(c, L, view) {
  const lp = L.planFor(c.text, c.o).plan, k = L.prefs.scale || 1, S = c.o.size * k * lp.sizeK;
  const w = Math.min(lp._holdBox.w * S, c.o.maxWidth ?? Infinity), h = lp._holdBox.h * S;
  if (c.o.space === "world" && view) { const g = view.toClient(c.o.at); return { role: c.o.seed?.split(":").pop(), x: g.x, y: g.y, w: w * view.zoom, h: h * view.zoom, S: S * view.zoom }; }
  return { role: c.o.seed?.split(":").pop(), x: c.o.at.x, y: c.o.at.y, w, h, S };
}
let runN = 0;
async function run(W, H, ui, fn) {
  globalThis.document = fakeDom(W, H, ui);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  const Stage = await import(`../splash/stage.mjs?fxld2-${++runN}`);
  const S = await import("../splash/splash.mjs");
  const flush = (upTo = 1e9) => { let t; while ((t = timers.filter((x) => !x.done && x.ms <= upTo).sort((a, b) => a.ms - b.ms)[0])) { t.done = true; t.f(); } };
  return fn({ Stage, S, flush, timers });
}
/* a scene: grid 100, scene rect, a view (zoom, pan), tokens and notes as documents */
const tok = (id, x, y, o = {}) => ({ id, visible: o.visible ?? true, document: { id, x, y, width: o.size ?? 1, height: o.size ?? 1, hidden: !!o.hidden, texture: { scaleX: o.k ?? 1, scaleY: o.k ?? 1 } },
  x, y, w: 100 * (o.size ?? 1), h: 100 * (o.size ?? 1), center: { x: x + 50 * (o.size ?? 1), y: y + 50 * (o.size ?? 1) } });
const note = (id, x, y) => ({ id, visible: true, document: { id, x, y, iconSize: 40 } });
function scene({ zoom = 1, pan = { x: 0, y: 0 }, tokens = [], notes = [], rect = { x: 0, y: 0, width: 3000, height: 2000 } }) {
  const view = { zoom, toClient: (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y }) };
  const c = { ready: true, grid: { size: 100 }, dimensions: { size: 100, sceneRect: rect },
    stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: (q) => view.toClient(q) },
    app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
    tokens: { placeables: tokens }, notes: { placeables: notes } };
  return { c, view };
}
const hitBox = (b, r) => b.x - b.w / 2 < r.r && b.x + b.w / 2 > r.l && b.y - b.h / 2 < r.b && b.y + b.h / 2 > r.t;
const tokRect = (t, z = 1, pan = { x: 0, y: 0 }, pad = 0) => ({ l: t.document.x * z + pan.x - pad, t: t.document.y * z + pan.y - pad, r: (t.document.x + 100 * t.document.width) * z + pan.x + pad, b: (t.document.y + 100 * t.document.height) * z + pan.y + pad });
const ROLLS = () => ({ good: ev({ n: 5, sixes: 2 }), crit: ev({ n: 4, sixes: 4 }), routine: ev({ n: 1, sixes: 0 }), rare: ev({ n: 12, sixes: 0 }),
  pushed: ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, stress: 2 }), pushedMiss: ev({ n: 5, sixes: 0, pushed: true, rerolled: 4, stress: 1 }),
  wreck: ev({ n: 6, sixes: 3, wreck: true }), stressed: ev({ n: 6, sixes: 2, stress: 2 }) });

/* one seat playing one roll; returns its calls (and the stage) */
async function seat({ W, H, ui = {}, layer, zoom, pan, k = 1, e, name, tokens, notes, hero, full = false, backdrop = false, scale = 1, hold = 1 }) {
  return run(W, H, ui, async ({ Stage, flush }) => {
    const { c, view } = scene({ zoom, pan, tokens, notes });
    globalThis.canvas = c;
    const L = fakeEngine({ prefs: { enabled: true, scale: k } }); Stage.setLetters(L); Stage.setLayer(layer);
    const ctl = Stage.play(e, { token: hero, scale, hold, fx: 1, fullFrom: full ? 0.7 : null, seed: "S-" + name, resolve: () => ({ now: 5, max: 8 }), backdrop });
    const extras = [...ctl.extras];
    /* what the layer shows during the moment (the parts leave by themselves at its end) */
    const seen = new Set(), flashes = [];
    const walk = (n) => { if (!n) return; seen.add(n.className); if (n.className === "ins-flash") flashes.push(n); (n.children ?? []).forEach(walk); };
    for (const t of [100, 300, 700, 1500, 2500]) { flush(t); walk(document.body); }
    flush(1e9);
    const lay = document.body.children.find((x) => x.attrs?.["aria-hidden"] === "true");
    const out = { calls: L.calls, L, view, ctl, lay, extras, seen: [...seen].join(" "), flashes: [...new Set(flashes)].map((f) => f.anims.at(-1)?.duration) };
    Stage.clearAll(); Stage.setLayer("screen"); delete globalThis.canvas;
    return out;
  });
}

/* ================================================================== N1 + N2 + N3 (map): two seats, one moment on the board */
{
  const hero = tok("HERO", 1200, 900);
  const others = [tok("N1", 1200, 760), tok("N2", 1340, 900), tok("HID", 1200, 1040, { hidden: true })];
  const pins = [note("P1", 1110, 820)];
  const tokens = [hero, ...others];
  for (const [name, e] of Object.entries(ROLLS())) {
    for (const layer of ["tokens", "overlay"]) {
      /* seat A: GM, 1920x1080, zoom 0.75, the chat card up; seat B: player, 1366x768, zoom 1.25, panned so the hero is OFF its screen */
      const A = await seat({ W: 1920, H: 1080, ui: { card: true }, layer, zoom: 0.75, pan: { x: -300, y: -250 }, k: 1, e, name, tokens, notes: pins, hero, full: name === "crit" });
      const B = await seat({ W: 1366, H: 768, ui: {}, layer, zoom: 1.25, pan: { x: -1900, y: -400 }, k: 1.3, e, name, tokens, notes: pins, hero, full: name === "crit", scale: 1.4 });
      /* the drawn scene size = size x the engine's Scale (rounded to 0.1 scene px: the size is handed over in hundredths) */
      const sig = (s) => s.calls.map((c) => ({ text: c.text, seed: c.o.seed, space: c.o.space, layer: c.o.layer, at: c.o.at, size: Math.round(c.o.size * s.L.prefs.scale * 10) / 10, out: c.o.out, maxWidth: c.o.maxWidth }));
      const tag = `N1 map ${layer} ${name}`;
      ok(A.calls.length > 0 && A.calls.every((c) => c.o.space === "world"), `${tag}: the moment is on the board (world space) on the GM's seat`);
      eq(sig(B), sig(A), `${tag}: the player's seat letters the same words at the same scene place and scene size as the GM's (other window, zoom, pan, chat card, engine Scale 1.3, client Scale 1.4, the hero off the player's screen)`);
      /* N2: inside the scene, exits in place */
      const sc = A.calls.map((c) => drawn(c, A.L, { zoom: 1, toClient: (q) => q }));
      ok(sc.every((b) => b.x - b.w / 2 >= 0 && b.y - b.h / 2 >= 0 && b.x + b.w / 2 <= 3000 && b.y + b.h / 2 <= 2000), `N2 ${tag}: the whole block is inside the scene`);
      ok(A.calls.every((c) => (LP.MAP_EXITS ?? []).includes(c.o.out)), `N2 ${tag}: every exit stays where the word stood (${[...new Set(A.calls.map((c) => c.o.out))]})`);
      /* by the roller (live, the critical sized to a 16:9 share of the board went two tokens away, past both seats' views) */
      {
        const hr = tokRect(hero), near = sc.map((b) => Math.hypot(Math.max(0, hr.l - (b.x + b.w / 2), (b.x - b.w / 2) - hr.r), Math.max(0, hr.t - (b.y + b.h / 2), (b.y - b.h / 2) - hr.b)));
        ok(Math.min(...near) <= 0.6 * 100, `N2 ${tag}: the block stands by the roller (nearest word ${Math.round(Math.min(...near))} scene px off the token)`);
        const word = sc.find((b) => b.role === "word"), big = Math.max(...sc.map((b) => b.h));
        if (name === "crit") ok(word && word.h >= big - 0.5 && word.h <= 2 * 100, `N2 ${tag}: the critical's word is the biggest part and at most two grid squares tall (${Math.round(word?.h)} scene px)`);
      }
      /* N3: off the hero, the neighbours (not the hidden one: it is not on the player's board), the pin */
      const heroR = tokRect(hero), bad = [];
      for (const b of sc) {
        if (hitBox(b, heroR)) bad.push(b.role + " on the hero");
        for (const t of others.filter((t) => !t.document.hidden)) if (hitBox(b, tokRect(t))) bad.push(b.role + " on " + t.id);
        if (hitBox(b, { l: 1110 - 24, t: 820 - 24, r: 1110 + 24, b: 820 + 40 })) bad.push(b.role + " on the pin");
      }
      ok(bad.length === 0, `N3 ${tag}: the block keeps off the rolling token, its neighbours and the map pin (${bad})`);
      const gA = A.ctl.gaugeEl, gB = B.ctl.gaugeEl;
      if (gA || gB) ok(gA && gB && gA.style.getPropertyValue("--u") === "1" && gB.style.getPropertyValue("--u") === "1", `N1 ${tag}: the Resolve gauge of a map moment is measured and drawn at the same reference size on both seats`);
    }
  }
}

/* ================================================================== N2 + N3 (map, crowded board): The Warehouse at grid 100 */
{
  /* the live board (grid 350) scaled to grid 100: the roller at the top edge, a neighbour left, two below-left and below, a map pin
     to the right (drawn 1.3 squares tall). Live, the critical went two tokens away and the pushed block beyond the left neighbour. */
  const hero = tok("HERO", 700, 100);
  const others = [tok("OM", 600, 100), tok("AE", 600, 200), tok("SO", 700, 400), tok("MA", 600, 400), tok("MB", 900, 400), tok("DS", 1100, 600), tok("ZA", 200, 300)];
  const pin = { id: "PIN", visible: true, document: { id: "PIN", x: 1050, y: 200, iconSize: 40, flags: { "moinen-maps": { pin: "quest" } } } };
  for (const name of ["crit", "good", "pushed", "rare"]) {
    const e = ROLLS()[name];
    const A = await seat({ W: 1600, H: 900, layer: "tokens", zoom: 0.6, pan: { x: 300, y: 200 }, e, name, tokens: [hero, ...others], notes: [pin], hero, full: name === "crit" });
    const sc = A.calls.map((c) => drawn(c, A.L, { zoom: 1, toClient: (q) => q }));
    const hr = tokRect(hero), near = Math.min(...sc.map((b) => Math.hypot(Math.max(0, hr.l - (b.x + b.w / 2), (b.x - b.w / 2) - hr.r), Math.max(0, hr.t - (b.y + b.h / 2), (b.y - b.h / 2) - hr.b))));
    const bad = [];
    for (const b of sc) {
      if (hitBox(b, hr)) bad.push(b.role + " on the hero");
      for (const t of others) if (hitBox(b, tokRect(t))) bad.push(b.role + " on " + t.id);
      if (hitBox(b, { l: 1050 - 40, t: 200 - 110, r: 1050 + 40, b: 200 + 8 })) bad.push(b.role + " on the pin");   // its head and stem
    }
    ok(A.calls.length > 0 && near <= 60 && bad.length === 0, `N2/N3 map crowded ${name}: the block stands by the roller and keeps off the neighbours and the pin (nearest ${Math.round(near)} scene px; ${bad})`);
  }
}

/* ================================================================== N1 (screen): what is shared and what follows the seat */
{
  const hero = tok("HERO", 800, 450);
  for (const [name, e] of Object.entries(ROLLS())) {
    const A = await seat({ W: 1920, H: 1080, layer: "screen", zoom: 1, pan: { x: 0, y: 0 }, e, name, tokens: [hero], notes: [], hero, full: name === "crit" });
    const B = await seat({ W: 1366, H: 768, layer: "screen", zoom: 0.7, pan: { x: 30, y: 10 }, e, name, tokens: [hero], notes: [], hero, full: name === "crit" });
    const what = (s) => s.calls.map((c) => ({ text: c.text, seed: c.o.seed, mood: c.o.mood, in: c.o.in, out: c.o.out, holdKind: c.o.holdKind, hold: c.o.hold, colors: c.o.colors }));
    eq(what(B), what(A), `N1 screen ${name}: the content (words, hands by seed, motion, colours) and the timing (holds) are the same on both seats`);
    const cls = (s, H) => s.calls.map((c) => Math.round(drawn(c, s.L).S / H * 100));
    const a = cls(A, 1080), b = cls(B, 768);
    ok(a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= Math.max(1, 0.15 * v)), `N1 screen ${name}: the size class (cap height as a share of the window) is the same (${a} vs ${b} % of the height)`);
  }
  const m = src("../splash/main.mjs");
  ok(/world\('tableHold'/.test(m) && /function holdK\(\)[^\n]*\n?[^\n]*tableHold/.test(m) && (m.match(/hold: holdK\(\)/g) ?? []).length >= 3, "N1: the lettered moment's duration is the table's (world Display time), not each seat's own");
  ok(/function boardToken\(message\)[\s\S]{0,500}document\.hidden/.test(m) && /onMapLayer\(\) && Stage\.lettersOn\(\) \? boardToken\(message\)/.test(m), "N1: on a map layer the token is found by its document for every seat (not by this seat's view); a hidden token gives no board place");
}

/* ================================================================== N3 (screen): neighbours, pins, dice, panels */
{
  const hero = tok("HERO", 640, 360);
  const nb = tok("NB", 640, 220);                     // a neighbour right above the hero's head
  const pin = note("P", 800, 300);
  const diceAt = [{ x: 560, y: 470 }, { x: 760, y: 470 }];   // resting dice beside and below
  for (const [name, e] of Object.entries(ROLLS()).filter(([n]) => n !== "crit")) {
    const out = await run(1366, 768, { party: true, diceZ: 101 }, async ({ Stage, flush }) => {
      const { c } = scene({ tokens: [hero, nb], notes: [pin] });
      globalThis.canvas = c;
      /* Dice So Nice's dice box: each die's position projected by its camera to the canvas (NDC) */
      const proj = (p) => ({ x: p.x / 1366 * 2 - 1, y: 1 - p.y / 768 * 2 });
      globalThis.game = { dice3d: { box: { camera: {}, diceList: diceAt.map((p) => ({ position: { clone: () => { const q = { ...proj(p), project() { return q; } }; return q; } } })) } } };
      const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("screen");
      Stage.play(e, { token: hero, scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "N3-" + name, resolve: () => ({ now: 5, max: 8 }) });
      flush(1e9);
      const rects = Stage.diceRects?.() ?? [];
      const boxes = L.calls.map((x) => drawn(x, L));
      Stage.clearAll(); delete globalThis.canvas; delete globalThis.game;
      return { boxes, rects };
    });
    ok(out.rects.length === 2, `N3 ${name}: the resting dice are read from Dice So Nice's dice box (${out.rects.length} of 2)`);
    const bad = [];
    for (const b of out.boxes) {
      if (hitBox(b, tokRect(nb))) bad.push(b.role + " on the neighbour");
      if (hitBox(b, { l: 776, t: 276, r: 824, b: 344 })) bad.push(b.role + " on the pin");
      for (const r of out.rects) if (hitBox(b, r)) bad.push(b.role + " on a die");
      if (hitBox(b, { l: 60, t: 438, r: 290, b: 583 })) bad.push(b.role + " on the party cards");
      if (hitBox(b, tokRect(hero))) bad.push(b.role + " on the hero");
    }
    ok(bad.length === 0, `N3 screen ${name}: the block keeps off the neighbour, the pin, the resting dice, the party panel and the hero (${bad})`);
  }
}

/* ================================================================== N3 (map, live frame): a crowded spot stays by the hero */
{
  /* the shared frame read live on The Warehouse (grid 350): Kid Omni-Man at the top edge, Omni-Man to his left, Atom Eve below-left,
     a map pin to the right. The first clean place lay beyond Omni-Man (detached from the roller, off the view of a seat looking at
     him); a smaller block right by the hero must win. */
  const box = (x, y, h) => ({ x, y, l: x - h, t: y - h, r: x + h, b: y + h });
  const frame = { vh: 1750, freeW: 3111, scale: 1, safe: { l: 35, t: 35, r: 5067, b: 6615 }, token: box(2625, 525, 175), focus: { x: 2625, y: 525 }, gap: 42,
    avoid: [box(2275, 875, 196), box(2625, 1575, 196), box(2275, 1575, 196), box(2275, 525, 196), box(875, 1225, 196), box(3325, 1575, 196), { l: 3528, t: 297, r: 3822, b: 735 }] };   // the pin as drawn (head and stem, 1.1 grid squares tall)
  /* the engine's real boxes were about 1.5 times wider than the estimate live (the pushed block: 1476 px at full size) */
  const wide = (it, S) => { const q = LP.estimateBox(it, S); return { ...q, w: q.w * 1.5 }; };
  for (const [name, e] of Object.entries(ROLLS()).filter(([n]) => n !== "crit")) for (const [mk, measure] of [["estimate", undefined], ["wide", wide]]) {
    const items = LP.planMoment(e, { token: true }).items;
    const out = LP.composeMoment(items, frame, measure);
    const off = LP.detached ? LP.detached(out.rect, frame.token, frame) : Infinity;
    ok(!out.hit && off === 0, `N3 map crowded ${name} (${mk}): the block is clean and right by the hero (hit ${Math.round(out.hit ?? -1)}, ${Math.round(off)} scene px beyond the gaps, side ${out.side}, size ${out.f?.toFixed?.(2)})`);
  }
  {
    const items = [...LP.planMoment(ROLLS().stressed, { token: true }).items, LP.planStress(2, {})];
    const out = LP.composeMoment(items, { ...frame, avoid: [...frame.avoid, { l: 3444, t: 245, r: 3906, b: 752 }], gauge: { w: 300, h: 90 } });   // a wider pin: the block must shrink
    ok(out.f < 0.99 && out.gauge && Math.abs(out.gauge.w - 300 * out.f) < 1 && Math.abs((out.gauge.k ?? 1) - out.f) < 1e-6, `N4 map crowded: the Resolve gauge shrinks with the block (block ${out.f?.toFixed?.(2)}, gauge ${out.gauge?.w?.toFixed?.(0)} of 300 px, k ${out.gauge?.k})`);
  }
  {
    /* a moinen-maps pin (live: drawn 457 x 497 px over a 40 px icon) is avoided by its drawn size, read from the document */
    const q = await run(1366, 768, {}, async ({ Stage }) => Stage.noteBox?.({ document: { x: 3675, y: 700, iconSize: 40, flags: { "moinen-maps": { pin: "quest" } } } }, 350));
    ok(!!q && q.t <= 700 - 370 && q.l <= 3675 - 140 && q.r >= 3675 + 140 && q.b >= 700 + 30, `N3 map: a map pin is avoided by the size it is drawn at (head and stem about 275 x 375 px), not its 40 px icon (${q && [q.l, q.t, q.r, q.b].map(Math.round)})`);
  }
  ok(/gaugeK \* \(g\?\.k \?\? 1\)/.test(src("../splash/stage.mjs")), "N4: the drawn gauge takes the block's shrink (map and screen)");
  ok(/keepInView: false/.test(src("../splash/stage.mjs")), "N1 map: a shared word is not pulled into this seat's view by the engine (keepInView: false), so every seat draws it at the same scene place");
}

/* ================================================================== N4: the Resolve gauge */
await run(1366, 768, {}, async ({ S }) => {
  SL.setLabels({ resolve: (now, max) => `RESOLVE ${now} / ${max}` });
  const host = document.createElement("div");
  const b = S.stressBadge(host, 2, { now: 7, max: 9 }, null);
  const pips = b.children.find((x) => x.className === "pips")?.children ?? [];
  const left = pips.filter((p) => p.className.includes("left")).length, now = pips.filter((p) => p.className.includes("new")).length, gone = pips.filter((p) => p.className.includes("gone")).length;
  const bc = b.children.find((x) => x.className === "bc");
  const v = bc?.children.find((x) => x.className === "bv"), n = bc?.children.find((x) => x.className === "bn");
  ok(left === 7 && now === 2 && gone === 0 && v?.textContent === "RESOLVE 7 / 9", `N4: the full pips count what is left, like the number (${left} full, ${now} lost now, "${v?.textContent}")`);
  ok(pips.slice(0, left).every((p) => p.className.includes("left")) && pips.slice(left, left + now).every((p) => p.className.includes("new")), "N4: read left to right: what is left, then what this roll took");
  ok(!!v && !!n && n.textContent.length > 0, "N4: the count and the note are two deliberate lines (no wrap of the last word)");
  const css = src("../../styles/splash.css");
  const rule = (sel) => (css.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}")) ?? [])[1] ?? "";
  ok(!/border-radius: 50%/.test(rule(".ins-badge .pip")) && !/rotate/.test(rule(".ins-badge .pip.new")), "N4: one pip shape for every pip (no circles next to diamonds)");
  ok(/white-space: nowrap/.test(rule(".ins-badge .bc")) && /Anton/.test(rule(".ins-badge .bc")), "N4: the gauge's lines never wrap and use the tall narrow information face (Anton)");
  const px = (r) => Number((r.match(/max\((\d+)px/) ?? [])[1] ?? 0);
  ok(px(rule(".ins-badge .bv")) >= 16 && px(rule(".ins-badge .bn")) >= 13, `N4: legible sizes at 1366 (count ${px(rule(".ins-badge .bv"))} px, note ${px(rule(".ins-badge .bn"))} px; live 11-13 px hand lettering)`);
  ok(/\.ins-letters \.ins-badge \{[^}]*max-width: none/.test(css), "N4: the gauge in the block is as wide as its lines (no max-width squeezing it into a wrap)");
  ok(/@font-face \{ font-family: 'InsAnton'; src: url\("\.\.\/scripts\/letters\/fonts\/anton\/Anton-Regular\.ttf"\)/.test(css) && fs.existsSync(new URL("../letters/fonts/anton/Anton-Regular.ttf", import.meta.url)), "N4: the face is the engine's bundled Anton (no download)");
});

/* ================================================================== N5: the map moment is not late */
await run(1366, 768, { diceZ: 101 }, async ({ Stage, timers }) => {
  const { c } = scene({});
  globalThis.canvas = c;
  const calls = [];
  globalThis.game = { dice3d: { box: { clearAll() { calls.push("clear"); } }, _fadeOutCanvas(ms, cb) { calls.push(ms); document.getElementById("dice-box-canvas").style.opacity = "0"; cb?.(); } } };
  Stage.setLetters(fakeEngine()); Stage.setLayer("tokens");
  let waited = null;
  const p = Stage.diceClear(2600).then((w) => (waited = w));
  for (let i = 0; i < 40 && waited === null; i++) { timers.filter((x) => !x.done).forEach((x) => { x.done = true; x.f(); }); await null; await null; }
  await p;
  ok(calls[0] > 0 && calls[0] <= 400 && calls.includes("clear"), `N5: on a map layer this seat asks Dice So Nice to fade its resting dice now, with its own fade (${calls})`);
  ok(waited !== null && waited <= 400, `N5: ... and the moment starts as they go (${waited} ms, was up to 2.6 s on top of Dice So Nice's 2 s + 1 s)`);
  Stage.setLayer("screen"); delete globalThis.canvas; delete globalThis.game;
});

/* ================================================================== N6: the critical and its hero; the owner's backdrop ruling */
for (const [W, H] of [[1366, 768], [1920, 1080]]) {
  const hero = tok("HERO", Math.round((W - 300) / 2) - 50, Math.round(H * 0.45) - 50, { size: 1 });
  /* live 1600x900 (lane 8): a big note pin at the right and the party cards at the left crowd the free area; the hero in the middle */
  const bigPin = { id: "BIG", visible: true, document: { id: "BIG", x: W - 400, y: Math.round(H * 0.45), iconSize: 150 } };
  const s0 = await seat({ W, H, ui: { party: true }, layer: "screen", zoom: 1, pan: { x: 0, y: 0 }, e: ev({ n: 4, sixes: 4 }), name: "crit", tokens: [hero], notes: [bigPin], hero, full: true });
  const heroR = tokRect(hero, 1, { x: 0, y: 0 }, 4), party = { l: 60, t: H - 330, r: 290, b: H - 185 };
  const bad = s0.calls.map((c) => drawn(c, s0.L)).filter((b) => hitBox(b, heroR) || hitBox(b, party)).map((b) => `${b.role} ${Math.round(b.x - b.w / 2)},${Math.round(b.y - b.h / 2)} ${Math.round(b.w)}x${Math.round(b.h)}`);
  ok(s0.calls.length >= 3 && bad.length === 0, `N6 ${W}: the critical's words keep off the hero's token and the party panel (${bad}; live 1366: the odds across Kid Omni-Man, WHAM! on DRUŻYNA)`);
  const word = s0.calls.map((c) => drawn(c, s0.L)).find((b) => b.role === "word");
  ok(word && word.w >= 0.35 * (W - 356), `N6 ${W}: ... and stays the biggest thing on screen (${Math.round(word?.w)} px wide)`);
  const kinds = (s) => s.seen;
  const k0 = kinds(s0);
  ok(!/ins-backdrop|ins-fullrays|ins-rays/.test(k0), `N6 ${W} (the owner): no backdrop by default: no wash, no turning rays (${k0.match(/ins-[a-z]+/g)?.filter((x) => /back|ray/.test(x))})`);
  const flashes = s0.flashes;
  ok(flashes.length <= 1 && flashes.every((d) => d <= 200), `N6 ${W}: the critical keeps one short accent at most (flash ${flashes} ms)`);
  const s1 = await seat({ W, H, ui: { party: true }, layer: "screen", zoom: 1, pan: { x: 0, y: 0 }, e: ev({ n: 4, sixes: 4 }), name: "crit", tokens: [hero], notes: [], hero, full: true, backdrop: true });
  const bd = s1.extras.find((x) => x.className === "ins-backdrop") ?? null;
  ok(/ins-backdrop/.test(kinds(s1)) || bd, `N6 ${W}: with the Backdrop setting on the wash is there (opt-in)`);
  const mask = bd?.style.maskImage ?? "";
  ok(/radial-gradient\(\d+px \d+px at (\d+)px (\d+)px, transparent/.test(mask) && Math.abs(Number(mask.match(/at (\d+)px/)[1]) - (hero.document.x + 50)) <= 2, `N6 ${W}: ... and has a clear spot over the hero (${mask.slice(0, 60)})`);
}
{
  const m = src("../splash/main.mjs");
  ok(/client\('backdrop', \{[^\n]*type: Boolean, default: false/.test(m) && /backdrop: cs\('backdrop'\)/.test(m), "N6 (the owner): the backdrop is a client setting, off by default, handed to every moment");
}

/* ================================================================== N7: the pushed block and the rolling token (regression watch) */
for (const layer of ["screen", "tokens"]) {
  for (const [W, H, z] of [[1366, 768, 1], [1920, 1080, 0.75]]) {
    const hero = tok("HERO", 700, 500);
    const s = await seat({ W, H, layer, zoom: z, pan: { x: 0, y: 0 }, e: ROLLS().pushed, name: "pushed", tokens: [hero], notes: [], hero });
    const view = layer === "screen" ? null : s.view;
    const bad = s.calls.map((c) => drawn(c, s.L, view)).filter((b) => hitBox(b, tokRect(hero, z, { x: 0, y: 0 }, 2))).map((b) => b.role);
    ok(s.calls.length >= 4 && bad.length === 0, `N7 ${layer} ${W}: no part of the pushed block (grunt, word, sixes, caption, stress) lands on the rolling token (${bad})`);
  }
}

/* ================================================================== N8: the same start on every seat */
{
  const A = await import("../splash/beat.mjs?seatA").catch(() => ({ note() {}, start: async () => {}, MARGIN: 0, CAP: 0 })), B = await import("../splash/beat.mjs?seatB").catch(() => ({ note() {}, start: async () => {}, MARGIN: 0, CAP: 0 }));
  /* a shared virtual server clock; each seat's dice stop at its own time; a report takes 40 ms to travel */
  let T = 0; const due = [];
  const env = { now: () => T, sleep: (ms) => new Promise((r) => due.push({ at: T + ms, r })) };
  const deliver = (to, id, u, at) => due.push({ at: T + 40, r: () => to.note(id, u, at) });
  const starts = {};
  const seatRun = async (B_, me, other, own) => {
    while (T < own) await env.sleep(own - T);
    deliver(other, "MSG", me, own);
    await B_.start("MSG", me, own, ["gm", "p1"], env);
    starts[me] = T;
  };
  const pa = seatRun(A, "gm", B, 1000), pb = seatRun(B, "p1", A, 1180);
  for (let i = 0; i < 400 && Object.keys(starts).length < 2; i++) {
    await null; await null; await null;
    due.sort((a, b) => a.at - b.at);
    const d = due.shift(); if (!d) continue;
    T = Math.max(T, d.at); d.r();
  }
  await Promise.race([Promise.all([pa, pb]), new Promise((r) => setTimeout(r, 0))]);
  ok(starts.gm != null && starts.gm === starts.p1, `N8: two seats whose dice stopped 180 ms apart start the moment at the same server time (GM ${starts.gm}, player ${starts.p1})`);
  ok(starts.gm <= 1180 + A.MARGIN + 1, `N8: ... right after the later seat's dice (${starts.gm} ms)`);
  /* a seat that never reports (its tab closed): the others start by themselves within the cap */
  T = 5000; due.length = 0; let solo = null;
  const ps = A.start("MSG2", "gm", 5000, ["gm", "p9"], env).then(() => (solo = T));
  for (let i = 0; i < 400 && solo === null; i++) { await null; await null; due.sort((a, b) => a.at - b.at); const d = due.shift(); if (!d) continue; T = Math.max(T, d.at); d.r(); }
  await ps;
  ok(solo !== null && solo <= 5000 + A.CAP + A.MARGIN, `N8: a missing seat delays the start by at most ${A.CAP} ms (${solo - 5000} ms)`);
  const m = src("../splash/main.mjs");
  ok(/hook\('createChatMessage', \(message\) => \{\s*try \{ if \(game\.system\.id === SYSTEM && readRoll\(message\) && visibleToMe\(message\)\) settled\(message\)/.test(m), "N8: every seat reports its dice, also one with the splash off");
  ok(/await Beat\.start\(id, game\.user\.id, own, seatsFor\(message\)/.test(m) && /game\.socket\?\.on\?\.\(CHANNEL/.test(m), "N8: a real roll waits for the shared start (the module's socket)");
}

/* ================================================================== N9: Polish copy */
{
  const { PL } = await import("../splash/lang.mjs");
  ok(PL["INSPLASH.Say.OddsShattered"] !== "SZANSE ROZBITE!", `N9: "THE ODDS ARE SHATTERED!" is no calque in Polish ("${PL["INSPLASH.Say.OddsShattered"]}")`);
  ok((PL["INSPLASH.Badge.Miss"].match(/\bNA\b/g) ?? []).length === 1 && PL["INSPLASH.Badge.Miss"].includes("{n}"), `N9: the miss odds say NA once ("${PL["INSPLASH.Badge.Miss"]}"; was "1 NA 9 NA PUDŁO")`);
}

/* ================================================================== N10, N11: the routine miss and the push grunt */
{
  const soft = LP.planMoment(ev({ n: 1, sixes: 0 }), { token: true }).items.find((i) => i.role === "word");
  ok(soft && soft.cap >= 0.06 && soft.hold >= 2000, `N10: the routine miss reads (cap ${soft?.cap} of the height, ${soft?.hold} ms; live NEXT! tiny and gone in ~1.5 s)`);
  const hero = tok("HERO", 640, 360, { k: 1.3 });
  const s = await seat({ W: 1366, H: 768, layer: "screen", zoom: 1, pan: { x: 0, y: 0 }, e: ev({ n: 1, sixes: 0 }), name: "soft", tokens: [hero], notes: [], hero });
  const ring = { l: 640 - 15 - 8, t: 360 - 15 - 8, r: 740 + 15 + 8, b: 460 + 15 + 8 };
  ok(s.calls.length >= 1 && s.calls.every((c) => !hitBox(drawn(c, s.L), ring)), "N10: ... and stands clear of the token's ring (a gap that grows with the token)");
  const p = LP.planMoment(ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3 }), {});
  const pre = p.items.find((i) => i.role === "pre"), w = p.items.find((i) => i.role === "word");
  ok(pre && pre.cap >= 0.07 && pre.hold >= 600, `N11: the push grunt is a beat of its own (cap ${pre?.cap}, ${pre?.hold} ms; live HNNNG! ~40 px at 1920)`);
  ok(pre && w && w.delay >= pre.delay + pre.hold + (LP.EXIT_MAX ?? 500), "N11: ... and is gone before the word comes");
}

/* ================================================================== N12: lit map layers keep the numbers readable */
{
  const hero = tok("HERO", 1200, 900);
  for (const layer of ["tokens", "ground", "weather", "overlay"]) {
    const s = await seat({ W: 1920, H: 1080, layer, zoom: 1, pan: { x: -400, y: -300 }, e: ROLLS().stressed, name: "lit", tokens: [hero], notes: [], hero });
    const by = Object.fromEntries(s.calls.map((c) => [c.o.seed.split(":").pop(), c.o.layer]));
    ok(by.word === layer && ["six", "say", "odds", "stress"].every((r) => !by[r] || by[r] === "overlay"), `N12 ${layer}: the word keeps the chosen layer, the numbers and the caption go over the scene's light and weather (${JSON.stringify(by)})`);
  }
}
done("fxld2");
