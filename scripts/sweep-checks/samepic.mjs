// node scripts/sweep-checks/samepic.mjs  -- SAMEPIC (2026-11-14): the owner's binding ruling "the GM and the players see the SAME moment",
// checked as a PICTURE. The blind two-seat review ADVX found, with one view at one instant: the roll's word block in another place and at
// another size per seat, on the screen layer and on the map layer (finding 1), one token hit with another word size and side per seat (9),
// a word cut by the view's edge on one seat and whole on the other (13). Here two and three differently equipped seats play ONE event and
// what they draw is compared: place relative to what it describes, and size.
//   Seats differ in: window size, sidebar open or closed, the GM's scene bar, the GM's own panels (desk, party cards), resting dice, a chat
//   card, a token hidden by the GM (the GM sees it), a token out of the player's sight, the engine's own Scale, reduced motion, the number
//   only the GM may read, the token's animated picture (its mesh sways per seat).
//   S1-S4 roll splash (scripts/splash/stage.mjs with a fake page and engine), T1-T3 token reactions (each seat in its own node process:
//   scripts/tokenreact/check-same-seat.mjs). Where a seat REALLY cannot show the shared picture (a smaller window near the edge, its own
//   panel over the spot on a layer under the interface), only that seat moves it, and the check says so.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as SL from "../splash/logic.mjs";
import * as SP from "../same-picture.mjs";

let n = 0, f = 0;
const ok = (c, msg) => { n++; if (!c) { f++; console.log("FAIL", msg); } };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const ev = (rd) => SL.buildEvent({ newSixes: 0, rerolled: 0, pushed: false, stress: 0, action: "slugfest", ...rd }, { rng: seq([0.1, 0.5, 0.9, 0.3]), st: null, dryN: 0 });
const ROLLS = () => ({ good: ev({ n: 5, sixes: 2 }), crit: ev({ n: 4, sixes: 4 }), routine: ev({ n: 1, sixes: 0 }), rare: ev({ n: 12, sixes: 0 }),
  pushed: ev({ n: 5, sixes: 2, pushed: true, newSixes: 1, rerolled: 3, stress: 2 }), wreck: ev({ n: 6, sixes: 3, wreck: true }), stressed: ev({ n: 6, sixes: 2, stress: 2 }) });

/* ---------------------------------------------------------------- a fake page (check-fxld2's, with per-seat interface) */
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
    ...(ui.card ? { "#chat-notifications .chat-log > li": R(W - side - 310, H * 0.4, 300, 220) } : {}),
    ...(ui.party ? { "#invincible-party li": [R(60, H - 330, 230, 70), R(60, H - 255, 230, 70)] } : {}),
    ...(ui.desk ? { "#invincible-tactics-desk:not(.igd-collapsed) .igd": R(...ui.desk) } : {})
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
function fakeEngine(k = 1) {
  const calls = []; let i = 0;
  /* the hold box of a word: a reduced seat's plan is the still word (the layout must not follow it) */
  const box = (text, op) => { const lines = String(text).split("\n"); const tilt = op.reduced ? 1 : 1 + Math.abs(op.rotation ?? 0) * 0.01; return { w: (0.6 * Math.max(...lines.map((l) => l.length)) + 0.3) * tilt, h: (1.2 * lines.length + 0.1) * tilt }; };
  const L = { calls, prefs: { enabled: true, scale: k },
    planFor: (text, op) => ({ plan: { _holdBox: box(text, op), sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5), hand: { id: `hand-${op.seed}` } }, opts: op }),
    design: (text, op) => ({ sizeK: 0.62 + 0.7 * (op.sound?.loud ?? 0.5) }),
    play(text, op) {
      const h = { id: "h" + ++i, hand: `hand-${op.seed ?? i}`, alive: true, stop() { h.alive = false; }, moveTo() {}, ready: Promise.resolve(true), finished: new Promise(() => {}) };
      calls.push({ text, o: op, h }); return h;
    } };
  return L;
}
let runN = 0;
const tok = (id, x, y, o = {}) => ({ id, visible: o.visible ?? true, document: { id, x, y, width: 1, height: 1, hidden: !!o.hidden, texture: { scaleX: 1, scaleY: 1 } },
  x, y, w: 100, h: 100, center: { x: x + 50, y: y + 50 }, ...(o.mesh ? { mesh: { getBounds: () => o.mesh } } : {}) });
const note = (id, x, y) => ({ id, visible: true, document: { id, x, y, iconSize: 40 } });

/* one seat playing one roll. view: the scene point in the window's middle + zoom (two windows of one view). Returns what it drew:
   relative to the hero's document box on its screen (screen layers) or in scene px (map layers), with the drawn cap size */
async function seat(o) {
  const { W, H, ui = {}, layer, zoom = 1, center, e, hero, tokens, notes = [], full = false, k = 1, gm = false, reduced = false, dice = [] } = o;
  globalThis.document = fakeDom(W, H, ui);
  globalThis.window = { innerWidth: W, innerHeight: H, matchMedia: () => ({ matches: reduced }) };
  const timers = [];
  const st = globalThis.setTimeout, ct = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  globalThis.clearTimeout = () => {};
  try {
    const Stage = await import(`../splash/stage.mjs?samepic-${++runN}`);
    const S = await import("../splash/splash.mjs");
    S.setReduced(reduced);
    const pan = { x: W / 2 - center.x * zoom, y: H / 2 - center.y * zoom };
    const toClient = (q) => ({ x: q.x * zoom + pan.x, y: q.y * zoom + pan.y });
    globalThis.canvas = { ready: true, grid: { size: 100 }, dimensions: { size: 100, sceneRect: { x: 0, y: 0, width: 3000, height: 2000 } },
      stage: { scale: { x: zoom }, toLocal: (q) => ({ x: (q.x - pan.x) / zoom, y: (q.y - pan.y) / zoom }), toGlobal: toClient },
      app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0 }) }, screen: { width: 4000, height: 4000 } },
      tokens: { placeables: tokens, get: (id) => tokens.find((t) => t.id === id) }, notes: { placeables: notes } };
    globalThis.game = { user: { isGM: gm }, ...(dice.length ? { dice3d: { box: { camera: {}, diceList: dice.map((p) => ({ position: { clone: () => { const q = { x: p.x / W * 2 - 1, y: 1 - p.y / H * 2, project() { return q; } }; return q; } } })) } } } : {}) };
    const L = fakeEngine(k); Stage.setLetters(L); Stage.setLayer(layer);
    const ctl = Stage.play(e, { token: hero, scale: 1, hold: 1, fx: 1, fullFrom: full ? 0.7 : null, seed: "SAME-" + o.name, resolve: () => ({ now: 5, max: 8 }) });
    let t; while ((t = timers.filter((x) => !x.done).sort((a, b) => a.ms - b.ms)[0])) { t.done = true; t.fn(); }
    const hc = toClient({ x: hero.document.x, y: hero.document.y });
    const drawn = L.calls.map((c) => {
      const lp = L.planFor(c.text, { ...c.o, reduced: false }).plan, S = c.o.size * k * lp.sizeK;
      const world = c.o.space === "world";
      const at = world ? c.o.at : { x: c.o.at.x - hc.x, y: c.o.at.y - hc.y };
      return { role: c.o.seed?.split(":").pop(), text: c.text, x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10, S: Math.round(S * 10) / 10, world,
        abs: world ? toClient(c.o.at) : c.o.at, w: lp._holdBox.w * S * (world ? zoom : 1), h: lp._holdBox.h * S * (world ? zoom : 1) };
    });
    const log = Stage.sameLog().at(-1);
    Stage.clearAll(); Stage.setLayer("screen"); S.setReduced(false);
    return { drawn, moved: log?.moved ?? "?", W, H };
  } finally { globalThis.setTimeout = st; globalThis.clearTimeout = ct; delete globalThis.canvas; delete globalThis.game; }
}
const sig = (s) => s.drawn.map((d) => `${d.role}:${d.text}@${d.x},${d.y}/${d.S}`).join(" | ");
const inWin = (s, m = 0) => s.drawn.every((d) => d.abs.x - d.w / 2 >= -m && d.abs.y - d.h / 2 >= -m && d.abs.x + d.w / 2 <= s.W + m && d.abs.y + d.h / 2 <= s.H + m);
/* a seat whose window is SMALLER than the reference (same-picture.mjs REF_VW x REF_VH), or whose own panel covers the shared spot, may only
   shift the shared picture or shrink it in place (one factor for every item, never under SHRINK_LOCAL's last step), keeping every word,
   their order and the block's side of the hero (rel = the hero in the coordinates of d.x/d.y), and shows it whole */
const smallOk = (c, b, rel = { x: 0, y: 0 }, edge = false) => {
  if (!["none", "shift", "shrink", ...(edge ? ["layout"] : [])].includes(c.moved) || c.drawn.length !== b.drawn.length || !c.drawn.length) return false;
  if (c.drawn.some((d, i) => d.role !== b.drawn[i].role || d.text !== b.drawn[i].text)) return false;
  const ks = c.drawn.map((d, i) => d.S / b.drawn[i].S);
  if (Math.min(...ks) < 0.63 || Math.max(...ks) - Math.min(...ks) > 0.03 || Math.max(...ks) > 1.001) return false;
  const mid = (s) => ({ x: s.drawn.reduce((a, d) => a + d.x, 0) / s.drawn.length - rel.x, y: s.drawn.reduce((a, d) => a + d.y, 0) / s.drawn.length - rel.y });
  const mb = mid(b), mc = mid(c);
  for (const ax of ["x", "y"]) if (!edge && Math.abs(mb[ax]) > 40 && Math.sign(mb[ax]) !== Math.sign(mc[ax])) return false;
  return inWin(c, 1);
};
const kOf = (c, b) => c.drawn.map((d, i) => Math.round(d.S / b.drawn[i].S * 100) / 100).join(",");
const hitR = (d, r) => d.abs.x - d.w / 2 < r.r && d.abs.x + d.w / 2 > r.l && d.abs.y - d.h / 2 < r.b && d.abs.y + d.h / 2 > r.t;

/* the board of the roll: the hero, a neighbour above-left, a token the GM hid right of him (the GM's canvas shows it), one out of the
   player's sight below (his canvas does not show it), a map pin */
const board = (hx, hy, gm) => {
  const hero = tok("HERO", hx, hy, { mesh: gm ? { x: hx - 30, y: hy - 18, width: 170, height: 150 } : null });   // the GM's copy of the token is mid-sway
  return { hero, tokens: [hero, tok("NB", hx - 110, hy - 130), tok("HID", hx + 120, hy, { hidden: true, visible: gm }), tok("FOG", hx + 20, hy + 150, { visible: gm })], notes: [note("PIN", hx + 260, hy - 160)] };
};
/* the seats: the GM (sidebar closed, his scene bar, party cards, a chat card, dice resting by the hero, engine Scale 1.3), a player
   (sidebar open, nothing else), a second player with a smaller window and reduced motion. One view: the same scene point in the middle */
const GM = { name: "gm", W: 1600, H: 900, gm: true, k: 1.3, ui: { side: 40, nav: 38, party: true, card: true, diceZ: 101 } };
const P1 = { name: "p1", W: 1600, H: 900, ui: { side: 300, party: true } };
const P2 = { name: "p2", W: 1366, H: 768, reduced: true, ui: { side: 300, party: true } };
const P3 = { name: "p3", W: 1920, H: 1080, reduced: true, ui: { side: 300, party: true } };      // bigger than the reference, reduced motion

/* ================================================================ S1 screen layer, the hero mid-view: three seats, one picture */
for (const layer of ["screen", "ui"]) for (const [name, e] of Object.entries(ROLLS())) {
  const center = { x: 1250, y: 950 };
  const run = async (s) => { const b = board(1200, 900, !!s.gm); return seat({ ...s, layer, center, e, hero: b.hero, tokens: b.tokens, notes: b.notes, full: name === "crit",
    dice: s.gm ? [{ x: s.W / 2 + 40, y: s.H / 2 - 120 }, { x: s.W / 2 - 90, y: s.H / 2 - 110 }] : [] }); };
  const [a, b, c, d] = [await run(GM), await run(P1), await run(P2), await run(P3)];
  ok(a.drawn.length > 0 && sig(a) === sig(b), `S1 ${layer} ${name}: GM and player draw the block at one place and size relative to the hero\n   GM ${sig(a)}\n   P1 ${sig(b)}`);
  ok(sig(d) === sig(b), `S1 ${layer} ${name}: a bigger window with reduced motion draws it alike too\n   P3 ${sig(d)}\n   P1 ${sig(b)}`);
  ok([a, b, d].every((s) => s.moved === "none" && inWin(s)), `S1 ${layer} ${name}: no seat of the reference size or more had to move it, and it is whole in every window (${[a, b, d].map((s) => s.moved)})`);
  ok(smallOk(c, b), `S1 ${layer} ${name}: the 1366x768 seat only shifts or shrinks it in place, keeps words, order and side, shows it whole (${c.moved}, k ${kOf(c, b)})\n   P2 ${sig(c)}\n   P1 ${sig(b)}`);
}

/* ================================================================ S2 screen layer, the hero near the top-left: the small window really
   cannot show the shared place: only that seat moves it, as little as it can, and keeps the size */
for (const [name, e] of Object.entries(ROLLS()).filter(([k]) => !["crit"].includes(k))) {
  const center = { x: 1700, y: 1200 };      // the hero at (1200,900): 500 px left of and 300 px above the middle
  const run = async (s) => { const b = board(1200, 900, !!s.gm); return seat({ ...s, layer: "screen", center, e, hero: b.hero, tokens: b.tokens, notes: b.notes }); };
  const [a, b, c] = [await run(GM), await run(P1), await run(P2)];
  ok(sig(a) === sig(b), `S2 ${name}: GM and player of one window size draw one picture at the view's edge\n   GM ${sig(a)}\n   P1 ${sig(b)}`);
  ok(inWin(a) && inWin(b) && inWin(c, 1), `S2 ${name}: no seat cuts it at its view's edge`);
  /* SAMEPIC: was "keeps the size"; a window under the reference may shrink in place when no shift clears it (smallOk, SAMEPIC-1) */
  /* at the view's edge the small window's band has no room above the hero (the shared side) and a shift lands on the hero: there it may
     lay the same words out again on another side (SAMEPIC-1, the one real conflict), never smaller than SHRINK_LOCAL allows */
  ok(smallOk(c, b, undefined, true), `S2 ${name}: the small window keeps the words and nearly the size, whole in its band (${c.moved}, k ${kOf(c, b)})
   P2 ${sig(c)}
   P1 ${sig(b)}`);
}

/* ================================================================ S3 map layer: the GM's scene bar and panels do not move his block */
for (const layer of ["tokens", "overlay"]) for (const [name, e] of Object.entries(ROLLS())) {
  const center = { x: 1300, y: 760 };       // the hero near the top of the view: the block is laid out again inside the standard view
  const run = async (s) => { const b = board(1200, 380, !!s.gm); return seat({ ...s, layer, zoom: 0.8, center, e, hero: b.hero, tokens: b.tokens, notes: b.notes, full: name === "crit" }); };
  const [a, b, c, d] = [await run(GM), await run(P1), await run(P2), await run(P3)];
  ok(a.drawn.length > 0 && a.drawn.every((d) => d.world) && sig(a) === sig(b) && sig(b) === sig(d), `S3 map ${layer} ${name}: three seats draw the block at one scene place and size\n   GM ${sig(a)}\n   P1 ${sig(b)}\n   P3 ${sig(d)}`);
  /* the hero near the top: as in S2 the small window may lay the same words out again (SAMEPIC-1) */
  ok(smallOk(c, b, { x: 1250, y: 430 }, true), `S3 map ${layer} ${name}: the 1366x768 seat only shifts or shrinks it in place (${c.moved}, k ${kOf(c, b)})\n   P2 ${sig(c)}`);
  ok(inWin(a) && inWin(b), `S3 map ${layer} ${name}: whole in the view of both 1600x900 seats`);
}

/* ================================================================ S3b map layer, live (lane 5, 2026-11-14): the GM's scene list reaches
   176 px down a 170 px wide column at the left, the player's 96 px; read as a full-width top bar it moved the GM's map block 107 scene px
   lower than the player's. Rows that do not touch the block move nothing */
for (const [name, e] of Object.entries(ROLLS()).filter(([k]) => ["good", "pushed", "rare"].includes(k))) {
  const center = { x: 1300, y: 760 };
  const run = async (s) => { const b = board(1200, 380, !!s.gm); return seat({ ...s, layer: "overlay", zoom: 0.8, center, e, hero: b.hero, tokens: b.tokens, notes: b.notes }); };
  const a = await run({ ...GM, ui: { ...GM.ui, nav: 168 } }), b = await run({ ...P1, ui: { ...P1.ui, nav: 88 } });
  ok(a.drawn.length > 0 && sig(a) === sig(b), `S3b map ${name}: the GM's long scene list and the player's short one leave one picture
   GM ${sig(a)}
   P1 ${sig(b)}`);
}

/* ================================================================ S4 a seat's own panel over the shared spot, on a layer under the
   interface (hud): that seat moves its block off it, the others keep the shared picture */
for (const [name, e] of Object.entries(ROLLS()).filter(([k]) => ["good", "pushed", "stressed"].includes(k))) {
  const center = { x: 1250, y: 950 };
  const run = async (s) => { const b = board(1200, 900, !!s.gm); return seat({ ...s, layer: "hud", center, e, hero: b.hero, tokens: b.tokens, notes: b.notes }); };
  const p1 = await run({ ...P1, ui: { side: 300 } });      // no party cards here: the case is the desk alone
  const top = Math.min(...p1.drawn.map((d) => d.abs.y - d.h / 2)), left = Math.min(...p1.drawn.map((d) => d.abs.x - d.w / 2)), right = Math.max(...p1.drawn.map((d) => d.abs.x + d.w / 2));
  const desk = [left - 10, top - 10, Math.max(60, (right - left) / 2), 60];      // the GM's desk right where the shared block's top-left stands
  const gm = await run({ ...GM, ui: { ...GM.ui, party: false, desk } });
  const D = { l: desk[0], t: desk[1], r: desk[0] + desk[2], b: desk[1] + desk[3] };
  ok(gm.moved !== "none" && p1.moved === "none", `S4 hud ${name}: only the seat whose desk covers the spot moves the block (GM ${gm.moved}, player ${p1.moved})`);
  ok(gm.drawn.every((d) => !hitR(d, D)), `S4 hud ${name}: the GM's block is not hidden under his desk`);
  /* SAMEPIC: a shift that clears the desk lands on the hero here, so the GM's seat shrinks in place instead: words, order, side kept */
  ok(smallOk(gm, p1), `S4 hud ${name}: the GM's seat shifts or shrinks it in place, keeps words, order and side (${gm.moved}, k ${kOf(gm, p1)})`);
}

/* ================================================================ T1-T3 token reactions: each seat in its own process */
const seatFile = fileURLToPath(new URL("../tokenreact/check-same-seat.mjs", import.meta.url));
const tr = (cfg) => { const r = spawnSync(process.execPath, [seatFile, JSON.stringify(cfg)], { encoding: "utf8" }); const line = (r.stdout ?? "").split(/\r?\n/).find((l) => l.startsWith("{")); return line ? JSON.parse(line) : { out: [], err: r.stderr }; };
const wordOf = (s) => s.out.find((x) => !x.num);
const sigT = (s) => { const w = wordOf(s); return w ? `${w.text}@${w.dx},${w.dy}/${w.cap}` : "none"; };
/* T1 the hit mid-view: GM (sidebar closed, his scene bar, a chat card, engine Scale 1.3, three more world words alive on his seat, the
   number he may read), a player (sidebar open), a player with a smaller window and reduced motion: one word, one size, one side */
for (const to of [7, 3, 0]) {
  const base = { center: { x: 800, y: 450 }, target: { x: 750, y: 400 }, to };
  const a = tr({ ...base, name: "gm", gm: true, side: 40, nav: 38, card: true, k: 1.3, extraAlive: 3 }), b = tr({ ...base, name: "p1", side: 300 });
  const c = tr({ ...base, name: "p2", side: 300, W: 1366, H: 768, reduced: true }), d = tr({ ...base, name: "p3", side: 300, W: 1920, H: 1080, reduced: true });
  ok(!!wordOf(a) && sigT(a) === sigT(b) && sigT(b) === sigT(d), `T1 hit to ${to}: one word at one size on one side on three seats\n   GM ${sigT(a)}\n   P1 ${sigT(b)}\n   P3 ${sigT(d)}`);
  /* SAMEPIC-1: a window under the reference may shrink the word when the shared one does not fit it; the same word on the same side */
  { const wb = wordOf(b), wc = wordOf(c);
    ok(!!wc && wc.text === wb?.text && wc.cap <= wb.cap + 0.1 && wc.cap >= wb.cap * 0.63 && Math.sign(wc.dy - 50) === Math.sign(wb.dy - 50) && Math.sign(wc.dx - 50) === Math.sign(wb.dx - 50),
      `T1 hit to ${to}: the 1366x768 seat draws the same word on the same side, at most a little smaller\n   P2 ${sigT(c)}\n   P1 ${sigT(b)}`); }
  const num = a.out.find((x) => x.num);
  if (num) ok(!b.out.some((x) => x.num), `T1 hit to ${to}: the enemy's number stays the GM's (${num.text}); the player's seat keeps its place empty`);
}
/* T4 live (lane 5, 2026-11-14, take L): the GM's sidebar closed, the player's open; the chat column and the party region (transparent,
   window-tall) stand elsewhere on each seat; a hit by the left (party) and one by the right (chat column) drew another size and side */
for (const target of [{ x: 290, y: 430 }, { x: 980, y: 430 }]) {
  const base = { center: { x: 800, y: 450 }, target, to: 0 };
  const a = tr({ ...base, name: "gm", gm: true, side: 48, chatCol: 1236, partyRoot: 96 }), b = tr({ ...base, name: "p1", side: 348, chatCol: 936, partyRoot: 0 });
  ok(!!wordOf(a) && sigT(a) === sigT(b), `T4 hit at ${target.x}: the transparent chat column and party region leave one word
   GM ${sigT(a)}
   P1 ${sigT(b)}`);
}
/* T5 live (lane 5, take L): the challenges' panel stands left of the sidebar, so elsewhere on each seat; a big hit by the top-right drew
   0.7 of the size on the seat whose sidebar was open */
for (const target of [{ x: 1000, y: 300 }, { x: 1100, y: 330 }]) {
  const base = { center: { x: 800, y: 450 }, target, to: 0, dock: true };
  const a = tr({ ...base, name: "gm", gm: true, side: 48 }), b = tr({ ...base, name: "p1", side: 348 });
  ok(!!wordOf(a) && sigT(a) === sigT(b), `T5 hit at ${target.x},${target.y}: the challenges' panel by a closed or an open sidebar leaves one word
   GM ${sigT(a)}
   P1 ${sigT(b)}`);
}
/* T2 near the top of the view: the GM's scene bar does not cut or move his word (ADVX 13: "BAM! -2" cut by the top on the GM's seat) */
{
  const base = { center: { x: 800, y: 690 }, target: { x: 750, y: 290 }, to: 5 };
  const a = tr({ ...base, name: "gm", gm: true, side: 40, nav: 40 }), b = tr({ ...base, name: "p1", side: 300 });
  ok(!!wordOf(a) && sigT(a) === sigT(b), `T2 a token near the view's top: GM and player draw one word alike\n   GM ${sigT(a)}\n   P1 ${sigT(b)}`);
  const w = wordOf(a), top = a.tok.y + w.dy - w.cap * 0.8;
  ok(top >= 48, `T2 the word stays below the GM's scene bar (its top at about ${Math.round(top)} px)`);
}
/* T3 the GM's desk right where the shared word stands: only the GM moves it (his panel would hide it) */
{
  const base = { center: { x: 800, y: 450 }, target: { x: 750, y: 400 }, to: 3 };
  const b = tr({ ...base, name: "p1", side: 300 }), w = wordOf(b);
  const cx = b.tok.x + w.dx, cy = b.tok.y + w.dy;
  const a = tr({ ...base, name: "gm", gm: true, side: 40, desk: [cx - 60, cy - 30, 120, 60] });
  ok(sigT(a) !== sigT(b), `T3 the desk over the shared spot moves the GM's word (GM ${sigT(a)}, P1 ${sigT(b)})`);
  const wa = wordOf(a);
  ok(!!wa && Math.abs(wa.cap - w.cap) <= Math.max(1, 0.2 * w.cap), `T3 and keeps its size about the same (${wa?.cap} vs ${w.cap})`);
}
/* the pure parts */
{
  const r = SP.standardRect(1600, 900), q = SP.standardRect(1366, 768);
  ok(Math.abs((r.l - 800) - (q.l - 683)) < 1e-9 && Math.abs((r.b - 450) - (q.b - 384)) < 1e-9, "P1 the standard view is the same rect round the view's middle on any window");
  ok(SP.cleanHere({ l: 0, t: 0, r: 10, b: 10 }, { l: 0, t: 0, r: 100, b: 100 }, { safe: { l: 0, t: 0, r: 50, b: 50 }, avoid: [] }), "P2 inside both: clean");
  ok(!SP.cleanHere({ l: 40, t: 0, r: 60, b: 10 }, { l: 0, t: 0, r: 100, b: 100 }, { safe: { l: 0, t: 0, r: 50, b: 50 }, avoid: [] }), "P3 cut by this seat's edge only: not clean");
}
console.log(`samepic: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
