/* node scripts/tactics/check-fxld.mjs -- fixer FXLD (2026-11-13): the dice-roll splash as ONE composed comic moment (findings of the
   blind review ADVD, tagged for the caller). Every check here failed on the builder's version (tactics-ldic ff7c4c8) and passes now:
     F3  nothing is clipped by the window, also with the token at any edge of the view (1366x768, 1920x1080);
     F4  the sentence and the odds are a caption row right under the word, off the hotbar and the bars at the bottom;
     F5  the critical is the biggest thing on screen again (about 60 % of the free width), its sentence light enough to read on its rays;
     F7  nothing of one moment overlaps (screen and map layers alike; the map block zooms as one), the push grunt is gone before the word;
     F8  the sixes in the table's language ("2 SZÓSTKI"); the odds keep the decimal point (the user's ruling: "1 NA 2.5");
     F9  the lettering goes over Dice So Nice's dice canvas;
     F12 the shake of a strong hit reaches the words on every layer (through the engine's moveTo);
     F13 on a map layer the HTML parts (gauge, rays) follow the pan;
     F14 the engine's master switch off -> the classic splash (no rays without words); the engine's Scale setting is counted by the layout.
   The user ruled that finding 1 (the splash words are not onomatopoeia) is NOT a defect: those words keep their purpose; pinned below. */
import fs from "node:fs";
import { ok, eq, done } from "./testkit.mjs";
import * as SL from "../splash/logic.mjs";
import * as LP from "../splash/letter-plan.mjs";
import * as SP from "../same-picture.mjs";

const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd, rng = seq([0.1, 0.5, 0.9, 0.3])) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng, st: null, dryN: 0 });
const has = (name) => typeof LP[name] === "function";

/* ---------------------------------------------------------------- a fake page: DOM, bars, Dice So Nice canvas, the canvas */
function fakeDom(W, H, ui = {}) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "",
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, contains: (c) => self.className.split(" ").includes(c) }; },
      setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { c.parent = this; this.children.push(c); return c; }, append(...cs) { cs.forEach((c) => this.appendChild(c)); },
      insertBefore(c) { return this.appendChild(c); }, prepend(c) { return this.appendChild(c); },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; },
      get isConnected() { let p = this; while (p.parent) p = p.parent; return p === doc.body; },
      animate() { return { onfinish: null, cancel() {} }; }, getAnimations: () => [], querySelectorAll() { return []; }, querySelector() { return null; },
      get clientWidth() { return parseFloat(this.style.width) || 0; },
      getBoundingClientRect() {
        if (this.className.includes("ins-badge")) return { left: 0, top: 0, width: 150, height: 60, right: 150, bottom: 60 };
        const w = parseFloat(this.style.width) || 0, h = w * 0.6;
        const cx = parseFloat(this.style.left) || W / 2, cy = parseFloat(this.style.top) || H / 2;
        return { left: cx - w / 2, top: cy - h / 2, width: w, height: h, right: cx + w / 2, bottom: cy + h / 2 };
      } };
    return e;
  };
  const rects = {
    "#sidebar": { left: W - 300, top: 0, width: 300, height: H, right: W, bottom: H },
    "#hotbar": { left: W * 0.3, top: H - 64, width: 520, height: 56, right: W * 0.3 + 520, bottom: H - 8 },
    "#scene-controls": { left: 0, top: 40, width: 48, height: H - 200, right: 48, bottom: H - 160 },
    /* v14 live (lane 20, 1366): the map director pill #mm-dir-bar sits 40 px over the hotbar; #scene-navigation is a column the
       window's height whose scene row is the part on top */
    ...(ui.pill ? { "#mm-dir-bar": { left: W * 0.28, top: H - 184, width: 444, height: 32, right: W * 0.28 + 444, bottom: H - 152 } } : {}),
    "#scene-navigation": { left: 104, top: 16, width: 200, height: H - 32, right: 304, bottom: H - 16 },
    "#scene-navigation li": { left: 104, top: 16, width: 170, height: 32, right: 274, bottom: 48 },
    /* live (lane 5, 1366, sidebar collapsed): the roll's chat card pops up at x 1005-1300, y 350-610, right as the splash starts */
    ...(ui.card ? { "#chat-notifications .chat-log > li": { left: W - 361, top: H * 0.45, width: 295, height: 260, right: W - 66, bottom: H * 0.45 + 260 } } : {})
  };
  const el = (r) => ({ getBoundingClientRect: () => r });
  const dice = mk("canvas"); dice.style.zIndex = String(ui.diceZ ?? 6200);
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t),
    getElementById: (id) => (id === "sidebar" ? el(rects["#sidebar"]) : id === "dice-box-canvas" && ui.diceZ !== null ? dice : null),
    querySelector: () => null, querySelectorAll: (s) => (rects[s] ? [el(rects[s])] : []) };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style.zIndex ?? "auto", display: e.style.display ?? "block", visibility: "visible", opacity: e.style.opacity ?? "1" });
  return doc;
}
/* the fake engine plans like the real one would be measured: a hold box from the letters, the sizeK of the loudness */
function fakeEngine(o = {}) {
  const calls = []; let n = 0;
  const box = (text) => { const lines = String(text).split("\n"); return { w: 0.6 * Math.max(...lines.map((l) => l.length)) + 0.3, h: 1.2 * lines.length + 0.1 }; };
  const L = { calls, prefs: o.prefs ?? { enabled: true, scale: 1 },
    planFor: (text, op) => ({ plan: { _holdBox: box(text), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` } }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) {
      const off = L.prefs.enabled === false;
      const h = { id: "h" + ++n, hand: `hand-${op.seed ?? n}`, alive: !off, off, stops: [], moves: [], stop(x) { h.alive = false; h.stops.push(x); }, moveTo(a) { h.moves.push(a); }, ready: Promise.resolve(!off), finished: new Promise(() => {}) };
      calls.push({ text, o: op, h }); return h;
    } };
  return L;
}
/* the drawn box of a call in client px (the engine draws S = size x engine scale x sizeK px per unit; world: x zoom) */
function drawn(c, L, zoom = 1, toClient = (p) => p) {
  const lp = L.planFor(c.text, c.o).plan, k = L.prefs.scale || 1, S = c.o.size * k * lp.sizeK * (c.o.space === "world" ? zoom : 1);
  const w = Math.min(lp._holdBox.w * S, (c.o.maxWidth ?? Infinity) * (c.o.space === "world" ? zoom : 1)), h = lp._holdBox.h * S;
  const at = c.o.space === "world" ? toClient(c.o.at) : c.o.at;
  return { role: c.o.seed?.split(":").pop(), x: at.x, y: at.y, w, h, S };
}
async function run(W, H, ui, fn) {
  globalThis.document = fakeDom(W, H, ui);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [];
  globalThis.setTimeout = (f, ms) => { timers.push({ f, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  const Stage = await import(`../splash/stage.mjs?fxld-${W}x${H}-${Math.random()}`);
  const S = await import("../splash/splash.mjs");
  let clock = 0;
  globalThis.__fxldTimers = timers;
  const flush = (upTo = 1e9) => { let t; while ((t = timers.filter((x) => !x.done && x.ms + (x.base ?? 0) <= upTo).sort((a, b) => a.ms - b.ms)[0])) { t.done = true; t.f(); } };
  return fn({ Stage, S, flush, timers });
}
/* a token on the canvas at client (cx, cy), 100 px square, zoom 1 */
function canvasWith(cx, cy, zoom = 1, pan = { x: 0, y: 0 }) {
  const c = { ready: true, grid: { size: 100 }, stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y }) },
    app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } } };
  const token = { id: "T1", x: (cx - 50 - pan.x) / zoom, y: (cy - 50 - pan.y) / zoom, w: 100 / zoom, h: 100 / zoom, center: { x: (cx - pan.x) / zoom, y: (cy - pan.y) / zoom }, document: { width: 1, height: 1 } };
  return { c, token };
}
const inside = (b, W, H, chat = 300) => b.x - b.w / 2 >= 0 && b.x + b.w / 2 <= W - chat && b.y - b.h / 2 >= 0 && b.y + b.h / 2 <= H;
const overlap = (a, b) => Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
const ROLLS = () => ({ good: ev({ n: 5, sixes: 2 }), crit: ev({ n: 4, sixes: 4 }), routine: ev({ n: 1, sixes: 0 }), rare: ev({ n: 12, sixes: 0 }),
  pushed: ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, stress: 2 }), pushedMiss: ev({ n: 5, sixes: 0, pushed: true, rerolled: 4, stress: 1 }),
  wreck: ev({ n: 6, sixes: 3, wreck: true }), stressed: ev({ n: 6, sixes: 2, stress: 2 }) });

/* ================================================================== F3, F4, F7 (screen), F14 scale: every roll, every edge */
/* SAMEPIC (owner, binding: the GM and the players see the SAME moment): the GM's map director pill and a chat card popped up on one seat
   are that seat's own; on the screen layer (over everything) the moment no longer moves for them, or the GM's block stood elsewhere than
   the players' (ADVX 1). So the pass with the pill and the card is compared with a pass of the same window without them (identical), in
   place of "stays off the pill / the card"; the scene row on top stays checked (the shared reserve keeps every seat's block off it).
   Provisional, logged as SAMEPIC-3 */
const PLAIN = new Map();
for (const [W, H] of [[1366, 768], [1920, 1080]]) for (const ui of [{}, { pill: true, card: true }]) {
  await run(W, H, ui, async ({ Stage, flush }) => {
    const spots = [["middle", (W - 300) / 2, H / 2], ["top edge", (W - 300) / 2, 30], ["bottom edge", (W - 300) / 2, H - 40], ["left edge", 70, H / 2], ["by the chat", W - 330, H / 2], ["top-left corner", 60, 40], ["bottom-right corner", W - 330, H - 50]];
    for (const scale of [1, 1.6]) {
      for (const [where, cx, cy] of spots) {
        for (const [name, e] of Object.entries(ROLLS())) {
          const { c, token } = canvasWith(cx, cy);
          globalThis.canvas = c;
          const L = fakeEngine({ prefs: { enabled: true, scale } }); Stage.setLetters(L); Stage.setLayer("screen");
          Stage.play(e, { token, scale: 1, hold: 1, fx: 1, fullFrom: name === "crit" ? 0.7 : null, seed: "M-" + name, resolve: () => ({ now: 5, max: 8 }) });
          flush(1e9);
          const boxes = L.calls.map((x) => drawn(x, L));
          const tag = `${W}x${H} ${where} ${name}${scale !== 1 ? " (engine scale " + scale + ")" : ""}`;
          ok(boxes.length > 0 && boxes.every((b) => inside(b, W, H)), `F3 ${tag}: every lettering whole inside the window, left of the chat (${JSON.stringify(boxes.map((b) => [b.role, Math.round(b.x - b.w / 2), Math.round(b.y - b.h / 2), Math.round(b.w), Math.round(b.h)]))})`);
          /* the bars: the director pill over the hotbar (the critical's caption sat on it live, 1366) and the scene row on top
             (the wreck's word sat on it live) */
          const bar = (b, r) => b.x - b.w / 2 < r.right && b.x + b.w / 2 > r.left && b.y - b.h / 2 < r.bottom && b.y + b.h / 2 > r.top;
          const pill = { left: W * 0.28, top: H - 184, right: W * 0.28 + 444, bottom: H - 152 }, row = { left: 104, top: 16, right: 274, bottom: 48 };
          const card = { left: W - 361, top: H * 0.45, right: W - 66, bottom: H * 0.45 + 260 };
          const sigB = JSON.stringify(boxes.map((b) => [b.role, Math.round(b.x), Math.round(b.y), Math.round(b.S * 10)]));
          if (!ui.pill) PLAIN.set(tag, sigB);
          else ok(PLAIN.get(tag) === sigB, `F4 ${tag}: the GM's own director pill and a chat card popped up on his seat do not move his block (SAMEPIC: the same picture as a seat without them; ${pill.top}..${card.left})`);
          for (const b of boxes) ok(!bar(b, row), `F4 ${tag}: the ${b.role} stays off the bars (the scene row on top)`);
          let clash = null;
          for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) clash = [boxes[i].role, boxes[j].role];
          ok(!clash, `F7 ${tag}: no two letterings of the moment overlap (${clash})`);
          const word = boxes.find((b) => b.role === "word"), sayB = boxes.find((b) => b.role === "say"), odds = boxes.find((b) => b.role === "odds");
          /* FXI-SPLASH (ADVI 11): a stacked block reads in the order it lands: word, sixes, caption. A sixes row standing between the word and
             the caption is allowed for (its own height and gap), nothing more */
          const sixB = boxes.find((b) => b.role === "six"), between = sixB && sixB.y > word.y + word.h / 2 && sayB && sixB.y < sayB.y ? sixB.h + 0.3 * word.S : 0;
          for (const cb of [sayB, odds].filter(Boolean)) {
            ok(Math.abs((cb.y - cb.h / 2) - (word.y + word.h / 2)) <= 0.9 * word.S + between + (sayB && cb === odds ? sayB.h + 0.3 * word.S : 0), `F4 ${tag}: the ${cb.role} sits right under the word (gap ${Math.round((cb.y - cb.h / 2) - (word.y + word.h / 2))} px, word cap ${Math.round(word.S)} px)`);
          }
          Stage.clearAll();
        }
      }
    }
    delete globalThis.canvas;
  });
}

/* ================================================================== F4: the block keeps off the token's art (a scaled-up picture) */
for (const [name, e] of Object.entries(ROLLS())) {
  await run(1366, 768, {}, async ({ Stage, flush }) => {
    const { c, token } = canvasWith(500, 430);
    /* SAMEPIC: the art is read from the token's DOCUMENT (texture scale), which every seat shares; the mesh's bounds sway per seat (its
       animation), so a mesh past the square with no texture scale no longer moves the block. "pushed" keeps its mesh AND gets the scale
       the real token would have to draw it so (the case is the same art, now described as Foundry stores it) */
    if (name === "pushed") token.mesh = { getBounds: () => ({ x: 425, y: 355, width: 150, height: 150 }) };   // the drawn art (live: mesh past the square)
    token.document.texture = { scaleX: 1.5, scaleY: 1.5 };
    globalThis.canvas = c;
    const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("screen");
    Stage.play(e, { token, scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "ART-" + name, resolve: () => ({ now: 5, max: 8 }) });
    flush(1e9);
    const art = { left: 500 - 75, right: 500 + 75, top: 430 - 75, bottom: 430 + 75 };
    const hit = L.calls.map((x) => drawn(x, L)).filter((b) => b.x - b.w / 2 < art.right && b.x + b.w / 2 > art.left && b.y - b.h / 2 < art.bottom && b.y + b.h / 2 > art.top);
    ok(hit.length === 0, `F4 ${name}: nothing lands on the token's art scaled 1.5 (live 1920: the caption sat on the ring) (${hit.map((b) => b.role)})`);
    Stage.clearAll(); delete globalThis.canvas;
  });
}

/* the live 1920 case: a big token (263 px square, art 345 px) a little left of the middle: no side has room for the full block, so it
   shrinks beside the token instead of landing on it */
for (const [name, e] of Object.entries(ROLLS()).filter(([n]) => n !== "crit")) {
  await run(1920, 1080, { pill: true }, async ({ Stage, flush }) => {
    const { c, token } = canvasWith(772, 585);
    Object.assign(token, { x: 772 - 131, y: 585 - 131, w: 263, h: 263 });
    /* SAMEPIC: the block reads the token's document (size in squares, texture scale), as every seat has it: the same token described there */
    Object.assign(token.document, { width: 2.63, height: 2.63, texture: { scaleX: 345 / 263, scaleY: 345 / 263 } });
    token.mesh = { getBounds: () => ({ x: 600, y: 413, width: 345, height: 344 }) };
    globalThis.canvas = c;
    const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("screen");
    Stage.play(e, { token, scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "BIG-" + name, resolve: () => ({ now: 5, max: 8 }) });
    flush(1e9);
    const hit = L.calls.map((x) => drawn(x, L)).filter((b) => b.x - b.w / 2 < 945 && b.x + b.w / 2 > 600 && b.y - b.h / 2 < 757 && b.y + b.h / 2 > 413);
    ok(hit.length === 0, `F4 1920 big token ${name}: the block shrinks beside the token rather than landing on its art (${hit.map((b) => b.role)})`);
    Stage.clearAll(); delete globalThis.canvas;
  });
}

/* map layers: the words are drawn inside the scene and cut at its edge (live 1920: BARREL! lost its top above the scene) */
for (const [name, e] of Object.entries(ROLLS()).filter(([n]) => n !== "crit")) {
  await run(1920, 1080, {}, async ({ Stage, flush }) => {
    const { c, token } = canvasWith(780, 250);
    c.dimensions = { sceneRect: { x: 0, y: 160, width: 1500, height: 1100 } };   // zoom 1, no pan: the scene starts 160 px down the window
    globalThis.canvas = c;
    const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("tokens");
    Stage.play(e, { token, scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "SCN-" + name, resolve: () => ({ now: 5, max: 8 }) });
    flush(1e9);
    const out = L.calls.map((x) => drawn(x, L, 1, (p) => c.stage.toGlobal(p))).filter((b) => b.y - b.h / 2 < 160 || b.x + b.w / 2 > 1500);
    ok(L.calls.length > 0 && out.length === 0, `F3 map ${name}: the block stays inside the scene, where the map draws it (${out.map((b) => b.role)})`);
    Stage.setLayer("screen"); Stage.clearAll(); delete globalThis.canvas;
  });
}
{
  const css = fs.readFileSync(new URL("../../styles/splash.css", import.meta.url), "utf8");
  ok(/\.ins-letters \.ins-badge \{[^}]*width: max-content/.test(css), "F4: the Resolve gauge in the block keeps its measured one-line width (max-content; live 1920 it wrapped by the right edge onto the chat card)");
}

/* ================================================================== F5: the critical */
for (const [W, H] of [[1366, 768], [1920, 1080]]) {
  await run(W, H, {}, async ({ Stage, flush }) => {
    const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("screen");
    Stage.play(ev({ n: 4, sixes: 4 }), { scale: 1, hold: 1, fx: 1, fullFrom: 0.7, seed: "CRIT" });
    flush(1e9);
    const b = Object.fromEntries(L.calls.map((x) => { const d = drawn(x, L); return [d.role, d]; }));
    /* SAMEPIC (owner, binding: one picture for the table): the moment is sized for the REFERENCE window (same-picture.mjs) on every seat,
       so a window bigger than it shows the critical at the same size as a 1600 x 900 one: "free" is the standard view's width (the
       reference, or this window when smaller, minus the shared reserve), the height the reference's or this window's */
    const free = Math.min(W, SP.REF_VW) - SP.RESERVE.l - SP.RESERVE.r, HH = Math.min(H, SP.REF_VH);
    ok(b.word && b.word.w >= 0.5 * free, `F5 ${W}: the critical word fills at least half of the free width (${Math.round(b.word?.w)} of ${free} px; the review measured 29 % of the window)`);
    ok(b.word && b.word.h >= 0.17 * HH, `F5 ${W}: ... and is tall (${Math.round(b.word?.h)} px of ${HH})`);
    const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const sc = L.calls.find((x) => x.o.seed === "CRIT:say")?.o.colors ?? [];
    ok(sc.length === 3 && lum(sc[1]) > 0.55, `F5 ${W}: the critical's sentence is light (mid fill luminance ${sc[1] && lum(sc[1]).toFixed(2)}), readable on its violet rays and under a dark cut line`);
    ok(L.calls.find((x) => x.o.seed === "CRIT:say")?.o.hand?.font === "anton" && L.calls.find((x) => x.o.seed === "CRIT:odds")?.o.hand?.font === "anton", `F5 ${W}: the caption keeps one legible hand (the tall narrow face, plain, flat)`);
  });
}

/* ================================================================== F4/F5 live follow-ups (lane 20 stills, 1366): the caption's counters stay open, the stress
   leaves with the moment */
for (const [name, e] of Object.entries(ROLLS())) {
  await run(1366, 768, {}, async ({ Stage, flush }) => {
    const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("screen");
    Stage.play(e, { scale: 1, hold: 1, fx: 1, fullFrom: name === "crit" ? 0.7 : null, resolve: () => ({ now: 5, max: 8 }) });   // no seed: the preview
    flush(1e9);
    for (const c of L.calls.filter((x) => /:(say|odds)$/.test(x.o.seed ?? ""))) {
      const h = c.o.hand ?? {};
      /* the strokes run over the edges both ways: the ink line (inflate + inkW) and the cut line (out2W) must stay well under half of
         Anton's narrow counter (about 0.14 of the cap) */
      const inward = (h.inflate ?? 0.04) + (h.inkW ?? 0.06) + (h.outline === "ink" ? 0 : (h.out2W ?? 0.065));
      ok(h.font === "anton" && h.outline === "ink" && (h.depth ?? 1) === 0 && inward <= 0.05, `F4 ${name} ${c.o.seed}: the caption's counters stay open (thin ink line only, ${inward.toFixed(3)} of the cap inwards; live NOT BAD! read HOT RAD!)`);
    }
    ok(L.calls.length > 0 && L.calls.every((x) => typeof x.o.seed === "string" && x.o.seed.length > 0), `F7 ${name}: every lettering of a moment is seeded, so the hand measured for the layout is the hand played`);
    const w = L.calls.find((x) => /:word$/.test(x.o.seed ?? "")), st = L.calls.find((x) => /:stress$/.test(x.o.seed ?? ""));
    if (w && st) {
      ok(560 + st.o.hold <= w.o.hold + 60, `F7 ${name}: the stress leaves with the moment (stress hold ${st.o.hold} ms, word ${w.o.hold} ms; live it stood alone after the moment)`);
    }
    Stage.clearAll();
  });
}

/* ================================================================== F7 (pushed: grunt and word), F7 (map: the block zooms as one) */
{
  ok(has("planMoment") && (() => {
    const p = LP.planMoment(ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3 }), {});
    const pre = p.items.find((i) => i.role === "pre"), w = p.items.find((i) => i.role === "word");
    return pre && w && w.delay >= pre.delay + pre.hold + 500;
  })(), "F7: the push grunt has played its exit (up to 0.5 s) before the word comes");
  await run(1366, 768, {}, async ({ Stage, flush }) => {
    for (const zoom of [0.5, 1, 2]) {
      const { c, token } = canvasWith(500, 420, zoom, { x: 37, y: -12 });
      globalThis.canvas = c;
      const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("tokens");
      Stage.play(ROLLS().pushed, { token, scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "MAP", resolve: () => ({ now: 5, max: 8 }) });
      flush(1e9);
      const boxes = L.calls.map((x) => drawn(x, L, zoom, (p) => c.stage.toGlobal(p)));
      ok(L.calls.length >= 5 && L.calls.every((x) => x.o.space === "world" && x.o.fit === "exact"), `F7 map zoom ${zoom}: the words are on the map with exact scene sizes`);
      let clash = null;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) clash = [boxes[i].role, boxes[j].role];
      ok(!clash, `F7 map zoom ${zoom}: the odds no longer run into the sentence (no overlap: ${clash})`);
      Stage.setLayer("screen"); Stage.clearAll();
    }
    /* the camera pans while the moment is still lettering (live, 1366: the sentence of a map moment landed on the token): the parts
       lettered later keep their places in the block */
    {
      const pan = { x: 37, y: -12 };
      const { c, token } = canvasWith(500, 420, 1, pan);
      globalThis.canvas = c;
      const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("tokens");
      Stage.play(ROLLS().pushed, { token, scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "PAN", resolve: () => ({ now: 5, max: 8 }) });
      flush(10);
      pan.x -= 260; pan.y += 90;
      flush(1e9);
      const boxes = L.calls.map((x) => drawn(x, L, 1, (p) => c.stage.toGlobal(p)));
      let clash = null;
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) clash = [boxes[i].role, boxes[j].role];
      const w = boxes.find((b) => b.role === "word"), sy = boxes.find((b) => b.role === "say");
      ok(boxes.length >= 5 && !clash && w && sy && sy.y > w.y && Math.abs(sy.y - w.y) < 3 * w.h, `F7 map, a pan during the moment: the block stays one block in the scene (${clash ?? "no overlap"}, sentence under the word)`);
      Stage.setLayer("screen"); Stage.clearAll();
    }
    delete globalThis.canvas;
  });
}

/* ================================================================== F8: the sixes in the table's language; the odds keep the point */
{
  SL.setLabels({ six: (n) => (n === 1 ? "1 SZÓSTKA" : n < 5 ? n + " SZÓSTKI" : n + " SZÓSTEK"), oneIn: (n) => "1 NA " + n });
  const p = LP.planMoment(ev({ n: 5, sixes: 2 }), {});
  eq(p.items.find((i) => i.role === "six")?.text, "2 SZÓSTKI", "F8: the sixes are lettered in the table's language (label six)");
  eq(SL.oddsLabel(1 / 2.5), "1 NA 2.5", "F8 (the user's ruling): the odds keep the decimal point, also in Polish");
  SL.setLabels({ six: (n) => n + (n === 1 ? " SIX" : " SIXES"), oneIn: (n) => "1 IN " + n });
}

/* ================================================================== F9: over the dice; F12: the shake; F13: the pan; F14: the switch */
/* F9, live numbers (lane 20, a real 4d6 roll): Dice So Nice's canvas is z 0 at rest, 101 (ApplicationV2._maxZ + 1) while the dice show,
   1000 with its "over" option, and fades about 2 s after the dice stop */
for (const [layer, dz, want] of [["screen", 101, (z) => z === "" ], ["screen", 1000, (z) => z === ""], ["screen", 6400, (z) => Number(z) > 6400 && Number(z) < 9999],
  ["ui", 101, (z) => Number(z) > 101 && Number(z) < 9999], ["ui", 1000, (z) => Number(z) > 1000], ["ui", 0, (z) => z === ""]]) {
  await run(1366, 768, { diceZ: dz }, async ({ Stage, flush }) => {
    const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer(layer);
    Stage.play(ev({ n: 5, sixes: 2 }), { scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "DSN" });
    flush(100);
    const lay = document.body.children.find((x) => x.attrs?.["aria-hidden"] === "true");
    ok(lay && want(lay.style.zIndex ?? ""), `F9 ${layer}, dice canvas z ${dz}: the words are over the dice (layer z "${lay?.style.zIndex}" over the CSS ${layer === "screen" ? 5000 : 80})`);
    flush(1e9); Stage.clearAll();
  });
}
/* F9 map layers: the board is under any HTML, so a lettered map moment waits for the dice to fade */
await run(1366, 768, { diceZ: 101 }, async ({ Stage, flush }) => {
  const { c } = canvasWith(600, 400); globalThis.canvas = c;
  const L = fakeEngine(); Stage.setLetters(L); Stage.setLayer("tokens");
  let waited = null;
  const p = Stage.diceClear ? Stage.diceClear(2600).then((w) => (waited = w)) : null;
  for (let i = 0; i < 10; i++) { const t = globalThis.__fxldTimers?.filter((x) => !x.done) ?? []; t.forEach((x) => { x.done = true; x.f(); }); }
  await null;
  ok(p && waited === null, `F9 map layer: while the dice show, the lettered moment waits (dice z ${Stage.diceZ?.()}, waited ${waited})`);
  document.getElementById("dice-box-canvas").style.opacity = "0";
  flush(1e9); await p; 
  ok(waited !== null, "F9 map layer: ... and plays once the dice have faded");
  Stage.setLayer("screen");
  let w2 = null; await Stage.diceClear?.(2600).then((w) => (w2 = w));
  ok(w2 === 0, "F9: on the screen layer nothing waits (it is over the dice)");
  delete globalThis.canvas;
});
{
  const main = fs.readFileSync(new URL("../splash/main.mjs", import.meta.url), "utf8");
  ok(/await Stage\.diceClear\(\d+\)[\s\S]{0,900}Stage\.play\(ev,/.test(main), "F9: a real roll waits for Stage.diceClear before it plays (map layers)");
}
await run(1366, 768, { diceZ: 6400 }, async ({ Stage, flush }) => {

  /* F12: a strong hit on a map layer: the words shake through the engine */
  const { c, token } = canvasWith(600, 400, 0.8);
  globalThis.canvas = c;
  const L2 = fakeEngine(); Stage.setLetters(L2); Stage.setLayer("overlay");
  Stage.play(ev({ n: 4, sixes: 4 }), { token, scale: 1, hold: 1, fx: 1, fullFrom: null, seed: "SHK" });
  flush(1e9);
  const w = L2.calls.find((x) => x.o.seed === "SHK:word");
  ok(w && w.o.space === "world" && w.h.moves.length >= 4, `F12: the shake of a strong hit moves the words on the map (${w?.h.moves.length} stepped moves)`);
  ok(w && w.h.moves.length > 0 && w.h.moves.at(-1).x === w.o.at.x && w.h.moves.at(-1).y === w.o.at.y, "F12: ... and leaves them where they were");
  Stage.clearAll();

  /* F13: a critical on a map layer, then the map pans: the rays and the gauge follow */
  const L3 = fakeEngine(); Stage.setLetters(L3); Stage.setLayer("tokens");
  /* FXLD2: a map moment now needs the board's token (without one it has no board place and plays over the screen: nothing to follow),
     and the rays are opt-in (the owner, 2026-11-13: backdrops default off): this critical has its token and the Backdrop setting on */
  const ctl = Stage.play(ev({ n: 4, sixes: 4, stress: 2 }), { token, scale: 1, hold: 1, fx: 1, fullFrom: 0.7, seed: "PAN", resolve: () => ({ now: 5, max: 8 }), backdrop: true });
  flush(2500);
  const before = c.stage.toGlobal;
  c.stage.toGlobal = (q) => { const g = before(q); return { x: g.x + 120, y: g.y - 40 }; };
  c.stage.toLocal = (q) => ({ x: (q.x - 120) / 0.8, y: (q.y + 40) / 0.8 });
  Stage.onCanvasPan();
  const rays = ctl.extras?.find((x) => x.className.includes("ins-fullrays"));
  ok(rays && rays.style.translate === "120px -40px", `F13: on the map the rays follow the pan (${rays?.style.translate})`);
  ok(ctl.gaugeEl && ctl.gaugeEl.style.translate === "120px -40px", `F13: ... and so does the Resolve gauge (${ctl.gaugeEl?.style.translate})`);
  flush(1e9); Stage.clearAll(); Stage.setLayer("screen");
  delete globalThis.canvas;

  /* F14: the engine's master switch off: the classic splash, not rays and a gauge with no word */
  const L4 = fakeEngine({ prefs: { enabled: false, scale: 1 } }); Stage.setLetters(L4);
  ok(!Stage.lettersOn(), "F14: with the engine's master switch off the lettering counts as off");
  const c4 = Stage.play(ev({ n: 4, sixes: 4 }), { scale: 1, hold: 1, fx: 1, fullFrom: 0.7, seed: "OFF" });
  flush(1e9);
  ok(L4.calls.length === 0 && !c4.lw, "F14: ... and the classic splash plays (no dead lettering calls)");
  Stage.clearAll();
});

/* ================================================================== the user's ruling on finding 1: the splash words keep their purpose */
ok(SL.ACTIONS.slugfest.includes("HAYMAKER!") && SL.PUSHPRE.includes("ALL IN!") && SL.PUSHPRE.includes("STRAIN!"), "F1 (not a defect, the user's ruling): the splash's own action words stay (HAYMAKER!, ALL IN!, STRAIN!)");
done("fxld");
