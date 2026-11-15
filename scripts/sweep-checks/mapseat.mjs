// node scripts/sweep-checks/mapseat.mjs  -- MAPSEAT (2026-11-15): the roll's block on the MAP layer is the same block on every seat that shows it
// there: same words, same scene place, same scene size, whatever the seat's window, zoom, pan, sidebar or own panels. After CRITPEAK the GM's
// own panels still moved and shrank HIS board block (live, The Warehouse at 0.45: critical 99-113 px against the player's 120.5, strong 63-68
// against 83), each seat's view re-laid the block inside its own standard view (another zoom = another block), a close view shrank it in
// place, and a seat fell back to the screen layer by a cover comparison nobody could predict.
// The rule now (stage.mjs, same-picture.mjs mapSeat): the board block is laid out once from the documents alone (board window round the
// roller); a seat shows it unchanged, or - only when a part would be a speck at its zoom or outside what its view shows of the board - plays
// the moment on its screen layer. A seat's own floating panels never move it: they step back (class ins-yield) while it is up.
// Also: the crowded board's critical lies on no token (CRITPEAK-9), and the map's sound words carry the paper rim (ADVX 18).
// Fails on tactics-integrated-128 (M1, M2, M3); passes after.
import * as SL from "../splash/logic.mjs";
import * as SP from "../same-picture.mjs";

let n = 0, f = 0;
const ok = (c, msg) => { n++; if (!c) { f++; console.log("FAIL", msg); } };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng: seq([0.1, 0.5, 0.9, 0.3]), st: null, dryN: 0 });
const KINDS = () => ({
  ordinary: ev({ n: 4, sixes: 1 }),
  strong: ev({ n: 5, sixes: 2 }),
  critical: ev({ n: 3, sixes: 3 }),
  missed: ev({ n: 12, sixes: 0 }),
  pushed: ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, stress: 2 })
});

/* ---------------------------------------------------------------- a fake page and engine (critpeak.mjs's), panels as elements */
function fakeDom(W, H, ui = {}) {
  const mk = (tag) => {
    const e = { tag, children: [], parent: null, dataset: {}, attrs: {}, className: "", textContent: "", anims: [],
      style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] ?? ""; } },
      get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, remove: (...c) => { self.className = self.className.split(" ").filter((x) => x && !c.includes(x)).join(" "); }, contains: (c) => self.className.split(" ").includes(c) }; },
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
  /* measured live (lane 5, 1600 x 900): the GM's map meter, his scene list, the challenges' panel, the party cards, his desk, a chat card */
  const rects = {
    "#sidebar": R(W - side, 0, side, H),
    "#hotbar": R(W * 0.3, H - 66, 560, 58),
    "#scene-controls": R(16, 16, 72, H - 260),
    ...(ui.nav ? { "#scene-navigation li": R(104, 16, 170, ui.nav) } : {}),
    ...(ui.vram ? { ".mm-vram": R(96, 92, 264, 52) } : {}),
    ...(ui.dock ? { "#ich-dock": R(W - side - 312, 48, 310, 233) } : {}),
    ...(ui.party ? { "#invincible-party li": [R(96, H - 400, 230, 70), R(96, H - 325, 230, 70)] } : {}),
    ...(ui.card ? { "#chat-notifications .chat-log > li": R(W - side - 310, H * 0.35, 300, 260) } : {}),
    ...(ui.desk ? { "#invincible-tactics-desk:not(.igd-collapsed) .igd": R(...ui.desk) } : {})
  };
  const els = {};
  const el = (sel, r, i) => (els[sel + i] ??= { sel, className: "", getBoundingClientRect: () => r,
    get classList() { const self = this; return { add: (...c) => { const s = new Set(self.className.split(" ").filter(Boolean)); c.forEach((x) => s.add(x)); self.className = [...s].join(" "); }, remove: (...c) => { self.className = self.className.split(" ").filter((x) => x && !c.includes(x)).join(" "); }, contains: (c) => self.className.split(" ").includes(c) }; } });
  const doc = { body: mk("body"), createElement: mk, createTextNode: (t) => ({ textContent: t }), createElementNS: (_, t) => mk(t), els,
    getElementById: (id) => (id === "sidebar" ? { getBoundingClientRect: () => rects["#sidebar"] } : null),
    querySelector: () => null, querySelectorAll: (s) => { const r = rects[s]; return r ? (Array.isArray(r) ? r : [r]).map((q, i) => el(s, q, i)) : []; } };
  globalThis.getComputedStyle = (e) => ({ zIndex: e.style?.zIndex ?? "auto", display: "block", visibility: "visible", opacity: "1" });
  return doc;
}
/* the word boxes are the REAL engine's (scripts/letters/testenv.mjs: the engine with its fonts in node), so a crowded board is judged with the
   widths the table sees (CRITPEAK's lesson: the 0.6 em estimate is about 1.5x too wide for League Gothic) */
const { setup } = await import("../letters/testenv.mjs");
const REAL = (await setup()).engine;
REAL.lookStyle?.("invincible");   // the style the table letters in (game.system.id "invincible")
const boxCache = new Map();
function realBox(text, op) {
  const key = JSON.stringify([text, op.mood, op.sound, op.seed, op.hand, op.look, op.rotation, op.from, op.in, op.holdKind, op.out, op.magnitude, op.colors]);
  if (!boxCache.has(key)) {
    const q = REAL._plan(text, { ...op, reduced: false, space: "screen", at: undefined, token: undefined, parent: undefined, avoid: [] }); REAL._settle?.(q);
    boxCache.set(key, { w: q._holdBox.w, h: q._holdBox.h, sizeK: q.sizeK });
  }
  return boxCache.get(key);
}
function fakeEngine(k = 1) {
  const calls = []; let i = 0;
  const box = (text, op) => realBox(text, op);
  return { calls, prefs: { enabled: true, scale: k },
    planFor: (text, op) => { const b = box(text, op); return { plan: { _holdBox: { w: b.w, h: b.h }, sizeK: b.sizeK, hand: { id: `hand-${op.seed}` } }, opts: op }; },
    design: (text, op) => ({ sizeK: box(text, op).sizeK }),
    play(text, op) { const h = { id: "h" + ++i, hand: `hand-${op.seed ?? i}`, alive: true, stop() { h.alive = false; }, moveTo() {}, ready: Promise.resolve(true), finished: new Promise(() => {}) }; calls.push({ text, o: op, h }); return h; } };
}
const GS = 350;   // The Warehouse's grid
const tok = (id, x, y, o = {}) => ({ id, name: id, visible: true, document: { id, x, y, width: 1, height: 1, hidden: !!o.hidden, texture: { scaleX: 1, scaleY: 1 } },
  x, y, w: GS, h: GS, center: { x: x + GS / 2, y: y + GS / 2 } });
const note = (id, x, y) => ({ id, visible: true, document: { id, x, y, iconSize: 40 } });
/* boards: empty (the roller and his target alone), crowd (critpeak.mjs's: neighbours and a pin pressed round the two), warehouse (the CRITPEAK
   take's spot at 0.45: a neighbour beside the hero, one under him, the target lower right) */
const BOARDS = {
  empty: { nb: [], pin: null },
  crowd: { nb: [[-1.2, -1.1], [0.3, 1.4]], pin: [1.1, -1.2] },
  warehouse: { nb: [[1.05, 0], [0, 1.05]], pin: null, tgt: [1.05, 1.5] }
};
const board = (kind, hx = 2800, hy = 1700) => {
  const B = BOARDS[kind], tg = B.tgt ?? [1.3, 0.2];
  const hero = tok("HEROaaaaaaaaaaaa", hx, hy), target = tok("TARGETaaaaaaaaaa", hx + tg[0] * GS, hy + tg[1] * GS);
  return { hero, target, tokens: [hero, target, ...B.nb.map(([dx, dy], i) => tok("NB" + i, hx + dx * GS, hy + dy * GS))], notes: B.pin ? [note("PIN", hx + B.pin[0] * GS, hy + B.pin[1] * GS)] : [] };
};
let runN = 0;
/* one seat playing one roll on the map layer: what it drew (scene px for the board block, client px on the screen layer), its layer rule,
   the panels that stepped back */
async function seat(o) {
  const { W = 1600, H = 900, ui = {}, zoom, e, full = false, gm = false, k = 1, bd = "empty", off = { x: 0.4, y: 0 } } = o;
  globalThis.document = fakeDom(W, H, ui);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: false }) };
  const timers = [], st = globalThis.setTimeout, ct = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  try {
    const Stage = await import(`../splash/stage.mjs?mapseat-${++runN}`);
    const S = await import("../splash/splash.mjs");
    S.setReduced(false);
    const b = board(bd);
    const center = { x: b.hero.center.x + off.x * GS, y: b.hero.center.y + off.y * GS };
    const pan = { x: W / 2 - center.x * zoom, y: H / 2 - center.y * zoom };
    const toClient = (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y });
    globalThis.canvas = { ready: true, grid: { size: GS }, dimensions: { size: GS, sceneRect: { x: 0, y: 0, width: 7000, height: 4200 } },
      stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: toClient },
      app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
      tokens: { placeables: b.tokens, get: (id) => b.tokens.find((t) => t.id === id) }, notes: { placeables: b.notes } };
    globalThis.game = { user: { isGM: gm } };
    const L = fakeEngine(k); Stage.setLetters(L); Stage.setLayer("overlay");
    const ctl = Stage.play(e, { token: b.hero, scale: 1, hold: 1, fx: 1, fullFrom: full ? 0.7 : null, seed: "MS-" + (o.roll ?? o.name), resolve: () => ({ now: 5, max: 8 }), targets: [b.target.id], from: b.hero });
    const yieldedMid = [];
    let t; while ((t = timers.filter((x) => !x.done).sort((a, b2) => a.ms - b2.ms)[0])) {
      t.done = true; t.fn();
      for (const x of Object.values(document.els)) if (x.className.includes("ins-yield") && !yieldedMid.includes(x.sel)) yieldedMid.push(x.sel);
    }
    const box = (tk) => { const a = toClient({ x: tk.document.x, y: tk.document.y }); return { l: a.x, t: a.y, r: a.x + GS * zoom, b: a.y + GS * zoom }; };
    const drawn = L.calls.filter((c) => c.o.seed?.startsWith("MS-")).map((c) => {
      const lp = L.planFor(c.text, { ...c.o, reduced: false }).plan, Sz = c.o.size * lp.sizeK * k;
      const world = c.o.space === "world", px = world ? zoom : 1, at = world ? toClient(c.o.at) : c.o.at;
      const w = lp._holdBox.w * Sz * px, h = lp._holdBox.h * Sz * px;
      return { role: c.o.seed.split(":").pop(), text: c.text, world, sx: Math.round(c.o.at.x), sy: Math.round(c.o.at.y), sS: Math.round(Sz * 10) / 10, S: Math.round(Sz * px * 10) / 10,
        l: at.x - w / 2, t: at.y - h / 2, r: at.x + w / 2, b: at.y + h / 2, look: c.o.look ?? null };
    });
    const rule = ctl?.seatRule ?? null, log = Stage.sameLog().at(-1);
    if (process.env.MS_DEBUG && o.name === process.env.MS_DEBUG) { const y = ctl.layout; console.log('DBG', JSON.stringify({ safe: y.frame?.safe, token: y.frame?.token, avoid: y.frame?.avoid, side: y.side, hit: y.hit, f: y.f, split: y.split, rect: y.rect, items: y.items.map((i) => [i.role, i.text, Math.round(i.x), Math.round(i.y), Math.round(i.w), Math.round(i.h), i.S]) })); }
    Stage.clearAll(); Stage.setLayer("screen");
    const left = Object.values(document.els).filter((x) => x.className.includes("ins-yield")).map((x) => x.sel);
    const sb = (tk) => ({ l: tk.document.x, t: tk.document.y, r: tk.document.x + GS, b: tk.document.y + GS });
    const brd = ctl?.board ? { items: ctl.board.items.map((i) => ({ role: i.role, S: i.S, l: i.x - i.w / 2, t: i.y - i.h / 2, r: i.x + i.w / 2, b: i.y + i.h / 2 })), hero: sb(b.hero), target: sb(b.target), others: b.tokens.filter((x) => !/^(HERO|TARGET)/.test(x.id)).map(sb) } : null;
    return { drawn, board: brd, rule, moved: log?.moved, W, H, zoom, hero: box(b.hero), target: box(b.target), others: b.tokens.filter((x) => !/^(HERO|TARGET)/.test(x.id)).map(box), yielded: yieldedMid, left };
  } finally { globalThis.setTimeout = st; globalThis.clearTimeout = ct; delete globalThis.canvas; delete globalThis.game; }
}
/* the board block's signature: words, scene place and scene size (what "the same block on the map" means) */
const sig = (s) => s.drawn.map((d) => `${d.role}:${d.text}@${d.sx},${d.sy}/${d.sS}`).join(" | ");
const onBoard = (s) => s.drawn.length > 0 && s.drawn.every((d) => d.world);
const onScreen = (s) => s.drawn.length > 0 && s.drawn.every((d) => !d.world);
const ov = (a, q) => Math.max(0, Math.min(a.r, q.r) - Math.max(a.l, q.l)) * Math.max(0, Math.min(a.b, q.b) - Math.max(a.t, q.t));
const area = (q) => (q.r - q.l) * (q.b - q.t);

/* the seats of the table: the GM with his usual panels open (map meter, long scene list, challenges, party cards, his desk, the roll's chat
   card; sidebar closed; engine Scale 1.3), Test Gracz 1 (sidebar open, smaller window, another zoom and pan), a third seat (1920 x 1080, its
   own zoom). Zooms inside the map band for The Warehouse's 350 px grid (CRITPEAK-7: about 0.15-0.7) */
const GM = { name: "gm", gm: true, k: 1.3, W: 1600, H: 900, zoom: 0.45, off: { x: 0.4, y: 0.1 }, ui: { side: 48, nav: 160, vram: true, dock: true, party: true, card: true } };
const P1 = { name: "p1", W: 1366, H: 768, zoom: 0.5, off: { x: 0.1, y: 0.3 }, ui: { side: 300, nav: 32, party: true } };
const P3 = { name: "p3", W: 1920, H: 1080, zoom: 0.4, off: { x: -0.2, y: 0 }, ui: { side: 300, party: true } };

/* ================================================================ M1 one board block on every seat that shows the map */
for (const bd of ["empty", "warehouse"]) for (const [kind, e] of Object.entries(KINDS())) {
  const full = kind === "critical", tag = `M1 ${bd} ${kind}`;
  const seats = [];
  for (const s of [GM, P1, P3]) seats.push(await seat({ ...s, name: `${bd}-${kind}-${s.name}`, roll: `${bd}-${kind}`, e, full, bd }));
  const map = seats.filter(onBoard);
  ok(map.length >= 2, `${tag}: at least two of the three seats show it on the board (${seats.map((s) => s.rule)})`);
  for (const s of map.slice(1)) ok(sig(s) === sig(map[0]), `${tag}: one block on the board: same words, scene place and size\n   ${map[0] === seats[0] ? "GM" : "P?"} ${sig(map[0])}\n   ${sig(s)}`);
  ok(seats.every((s) => onBoard(s) || onScreen(s)), `${tag}: every seat shows the whole moment on ONE layer (the board block or its screen layer), never a mix`);
  ok(seats.every((s) => (onBoard(s) ? s.rule === "ok" : ["cut", "speck"].includes(s.rule))), `${tag}: the layer follows the one rule (${seats.map((s) => s.rule)})`);
  ok(seats.every((s) => s.moved === "none" || !onBoard(s)), `${tag}: no seat moved or shrank the board block (${seats.map((s) => s.moved)})`);
  /* the GM's panels over the block step back while it is up, and come back after */
  const gm = seats[0];
  ok(gm.left.length === 0, `${tag}: the GM's panels are back after the moment (${gm.left})`);
}

/* ================================================================ M2 the GM's own panels over the shared spot: the block is the player's */
for (const [kind, e] of Object.entries(KINDS())) {
  const full = kind === "critical";
  const p = await seat({ ...GM, ui: { side: 48 }, name: `m2-${kind}-plain`, roll: `m2-${kind}`, e, full, gm: false, k: 1 });
  /* the GM's desk laid right over the left half of the block the plain seat drew, his map meter and chat card as usual */
  const l = Math.min(...p.drawn.map((d) => d.l)), t0 = Math.min(...p.drawn.map((d) => d.t)), r = Math.max(...p.drawn.map((d) => d.r));
  const g = await seat({ ...GM, name: `m2-${kind}-gm`, roll: `m2-${kind}`, e, full, ui: { ...GM.ui, desk: [l - 20, t0 - 20, Math.max(80, (r - l) / 2), 120] } });
  ok(onBoard(p) && onBoard(g) && sig(g) === sig(p), `M2 ${kind}: the GM's desk, meter, scene list and chat card leave his board block as the plain seat's\n   GM ${sig(g)}\n   P  ${sig(p)}`);
  ok(g.yielded.some((s) => s.includes("tactics-desk")), `M2 ${kind}: the GM's desk over the block steps back while it is up (${g.yielded})`);
  ok(g.left.length === 0, `M2 ${kind}: and comes back after it`);
}

/* ================================================================ M3 a seat that cannot show it well: the one rule, not an accident */
for (const [kind, e] of Object.entries(KINDS()).filter(([k]) => ["strong", "critical"].includes(k))) {
  const full = kind === "critical";
  const a = await seat({ ...P1, W: 1600, H: 900, zoom: 0.45, name: `m3-${kind}-a`, e, full });
  /* the same seat panned so the roller stands near its view's right edge: the block is partly outside its view */
  const c = await seat({ ...P1, W: 1600, H: 900, zoom: 0.45, off: { x: -1.9, y: 0 }, name: `m3-${kind}-cut`, e, full });
  /* zoomed far out: the word a speck */
  const z = await seat({ ...P1, W: 1600, H: 900, zoom: 0.12, name: `m3-${kind}-far`, e, full });
  ok(onBoard(a) && a.rule === "ok", `M3 ${kind}: the roller mid-view shows the board block (${a.rule})`);
  ok(onScreen(c) && c.rule === "cut", `M3 ${kind}: a block outside this seat's view plays on its screen layer, by rule 'cut' (${c.rule}, ${c.drawn.map((d) => d.world)})`);
  ok(onScreen(z), `M3 ${kind}: a far view plays it on the screen layer (${z.rule})`);
  for (const s of [c, z]) ok(s.drawn.every((d) => d.l >= -1 && d.t >= -1 && d.r <= s.W + 1 && d.b <= s.H + 1), `M3 ${kind}: the screen fallback is whole on the view`);
}

/* ================================================================ M4 the critical on a crowded board lies on no token (CRITPEAK-9), stays the peak.
   Measured on the BOARD block itself (scene px against the tokens' documents): what every seat that shows the map sees. A seat whose view
   does not hold that place plays the moment on its screen layer by the rule (M3) */
for (const bd of ["crowd", "warehouse"]) {
  const res = {};
  for (const [kind, e] of Object.entries(KINDS())) res[kind] = await seat({ ...P1, W: 1600, H: 900, zoom: 0.45, off: { x: 0.4, y: 0 }, name: `m4-${bd}-${kind}`, e, full: kind === "critical", bd });
  const c = res.critical, B = c.board;
  ok(!!B && (onBoard(c) ? c.rule === "ok" : ["cut", "speck"].includes(c.rule)), `M4 ${bd}: the critical has a board block, and this seat shows it or plays it on its screen by the rule (${c.rule})`);
  for (const [nm, q] of B ? [["roller", B.hero], ["target", B.target], ...B.others.map((x, i) => ["bystander " + i, x])] : []) {
    const cov = B.items.reduce((s, d) => s + ov(d, q), 0) / area(q);
    ok(cov <= 0.02, `M4 ${bd}: the critical's board block lies on no ${nm} (${Math.round(cov * 100)} % of its box)`);
  }
  const W = (k) => res[k].board?.items.find((d) => d.role === "word")?.S ?? 0;
  ok(W("critical") >= 1.15 * W("strong") && W("strong") >= 1.15 * W("ordinary"), `M4 ${bd}: the critical is the peak on the board (${W("critical")} > ${W("strong")} > ${W("ordinary")})`);
}

/* ================================================================ M5 the board's words keep their own look (no forced light outline: it
   would hide the coloured duplicate block, the owner's look ruling; ADVX 18 waits for an engine rim under the duplicate, MAPSEAT-4) */
{
  const e = KINDS().pushed;
  const m = await seat({ ...P1, W: 1600, H: 900, zoom: 0.45, name: "m5-map", e });
  ok(onBoard(m) && m.drawn.length > 0 && m.drawn.every((d) => d.look?.outline === undefined), `M5: the board's words carry no forced outline (${m.drawn.map((d) => d.role + ":" + d.look?.outline)})`);
}

/* pure: the board window and the seat rule */
{
  ok(typeof SP.boardWindow === "function" && typeof SP.mapSeat === "function", "same-picture.mjs offers boardWindow and mapSeat");
  if (typeof SP.boardWindow === "function" && typeof SP.mapSeat === "function") {
  const w = SP.boardWindow({ x: 1000, y: 1000 }, 2);
  ok(w.l === 1000 - (800 - SP.RESERVE.l) * 2 && w.r === 1000 + (800 - SP.RESERVE.r) * 2 && w.t === 1000 - (450 - SP.RESERVE.t) * 2, "boardWindow: the reference view round the roller at the board's scale");
  ok(SP.mapSeat([{ l: 0, t: 0, r: 10, b: 10 }], { l: 0, t: 0, r: 100, b: 100 }, [{ px: 30, word: true }]) === "ok", "mapSeat: inside and readable = ok");
  ok(SP.mapSeat([{ l: 0, t: 0, r: 110, b: 10 }], { l: 0, t: 0, r: 100, b: 100 }, [{ px: 30, word: true }]) === "cut", "mapSeat: past the view = cut");
  ok(SP.mapSeat([{ l: 0, t: 0, r: 10, b: 10 }], { l: 0, t: 0, r: 100, b: 100 }, [{ px: 20, word: true }]) === "speck", "mapSeat: a word under 22 px = speck");
  }
}
console.log(`mapseat: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
