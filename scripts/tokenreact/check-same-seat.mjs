// node scripts/tokenreact/check-same-seat.mjs '<seat json>'  -- ONE seat of the SAMEPIC two/three-seat check (scripts/sweep-checks/samepic.mjs
// runs it once per seat, each in its own node process, and compares what the seats draw). Not a suite of its own: it prints one JSON line.
// A fake Foundry with a real view (the harness of sweep-checks/fxlt2-flow.mjs): a stage that pans and zooms, the interface around the
// canvas (sidebar open or not, the GM's desk, a chat card), tokens (one hidden from the players, one this seat's vision does not show).
// The engine stand-in sizes every play with the engine's REAL size model (scripts/letters/size.mjs sizeFor) and the context the engine
// gives it on THIS seat: its window height, its usable width (without the open sidebar), the world words alive here, its own Scale
// setting; so what a seat would really draw is measured, not what the caller meant.
const cfg = JSON.parse(process.argv[2] ?? "{}");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = cfg.W ?? 1600, H = cfg.H ?? 900, SIDE = cfg.side ?? 300, K = cfg.k ?? 1;

const hooks = {};
globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
const settings = new Map(), values = { "invincible-plus-ultra.tokenReactEnabled": true, "invincible-plus-ultra.tokenReactSize": "normal", "invincible-plus-ultra.tokenReactLang": "en" };
const user = { isGM: !!cfg.gm, id: cfg.gm ? "GM" : "P1" };
globalThis.game = {
  user, i18n: { lang: cfg.lang ?? "en", has: () => false, localize: (k) => k },
  settings: { settings, register: (m, k, o) => settings.set(`${m}.${k}`, o), get: (m, k) => values[`${m}.${k}`] },
  modules: new Map([["invincible-plus-ultra", { api: {} }]]), combats: new Map(), messages: { contents: [] }
};
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o), expandObject: (o) => o } };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
globalThis.innerWidth = W; globalThis.innerHeight = H;
if (cfg.reduced) globalThis.matchMedia = () => ({ matches: true });
const el = (x, y, w, h) => ({ getBoundingClientRect: () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h }) });
const UI = { "#sidebar": [el(W - SIDE, 0, SIDE, H)], "#hotbar": [el(W * 0.3, H - 66, 560, 58)], "#scene-controls": [el(8, 50, 46, H - 260)] };
if (cfg.nav) UI["#scene-navigation"] = [el(64, 8, 420, cfg.nav)];
if (cfg.desk) UI["#invincible-tactics-desk:not(.igd-collapsed) .igd"] = [el(...cfg.desk)];
if (cfg.card) UI["#chat-notifications .chat-log > li"] = [el(W - SIDE - 310, H * 0.4, 300, 220)];
/* the transparent regions as tall as the window (live lane 5): the chat column (its x follows the sidebar) and the party region (its x
   follows the user's peek state); nothing is drawn in them unless a card pops up */
if (cfg.chatCol) UI["#chat-notifications"] = [el(cfg.chatCol, 16, 300, H - 30)];
if (cfg.partyRoot != null) UI["#invincible-party"] = [el(cfg.partyRoot, H - 412, 240, 280)];
globalThis.document = { querySelector: () => null, querySelectorAll: (sel) => UI[sel] ?? [] };
globalThis.getComputedStyle = () => ({ visibility: "visible" });
/* the view: the scene point at the window's centre and the zoom (two windows of one view show the same point in their middle) */
const z = cfg.zoom ?? 1, C0 = cfg.center ?? { x: 800, y: 450 };
const cam = { x: C0.x - W / 2 / z, y: C0.y - H / 2 / z, z };
const stage = { scale: { get x() { return cam.z; } }, toGlobal: (p) => ({ x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z }), toLocal: (q) => ({ x: q.x / cam.z + cam.x, y: q.y / cam.z + cam.y }) };
const scene = { id: "S" };
const toks = [];
globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, stage, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H }) } },
  tokens: { placeables: toks, get: (id) => toks.find((t) => t.id === id) } };
let stamp = 1000;
function mk(id, type, h, r, o = {}) {
  const actor = { id: `A${id}`, type, hasPlayerOwner: !!o.player, system: { derived: { health: { value: h, max: o.hm ?? 8 }, resolve: { value: r, max: 8 } } },
    testUserPermission: () => !!cfg.gm || !!o.observer, _stats: { modifiedTime: stamp } };
  /* what THIS seat's canvas says: the GM sees everything; a player does not see a token hidden by the GM nor one out of his sight */
  const vis = cfg.gm || (!o.hidden && !o.unseen);
  const tok = { id, scene, isVisible: vis, visible: vis, document: { id, hidden: !!o.hidden }, actor, x: o.x ?? 0, y: o.y ?? 0, w: 100, h: 100, destroyed: false };
  Object.defineProperty(tok, "center", { get: () => ({ x: tok.x + 50, y: tok.y + 50 }) });
  actor.getActiveTokens = () => [tok];
  toks.push(tok);
  return tok;
}
const set = (tok, stat, v, st = ++stamp) => { tok.actor._stats.modifiedTime = st; tok.actor.system.derived[stat].value = v; Hooks.callAll("updateActor", tok.actor, { system: { derived: { [stat]: { value: v } } } }, {}); };

/* the engine stand-in: the engine's own size model on this seat's context */
const { sizeFor } = await import("../letters/size.mjs");
const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);
const alive = new Set();
const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: cam.z, vw: W - SIDE, vh: H, sizeK: sizeK(o), aspect: 3, fit: o.fit ?? "legible", alive: alive.size + (cfg.extraAlive ?? 0) });
const pxOf = (o) => sizeFor(ctxOf(o)).px * K;      // the cap height on screen: the engine multiplies its own Scale setting in after the model (engine.mjs resize)
const plays = [];
const fake = { version: "test", limits: { screen: 16, world: 48 }, prefs: { scale: K }, ready: async () => true, count: () => 0,
  sizeOf: (text, o) => ({ ...sizeFor(ctxOf(o)), sizeK: sizeK(o) }),
  play: (text, o) => {
    const rec = { text, o };
    const h = { id: `h${plays.length}`, hand: "x", alive: true, opts: o, plan: { timeline: { ent: [{ ticks: 6 }, { ticks: 6 }] } }, ready: sleep(30).then(() => true),
      finished: sleep((o.hold ?? 800) + 900).then(() => { h.alive = false; alive.delete(h); return "done"; }), stop() { h.alive = false; alive.delete(h); }, moveTo() {} };
    alive.add(h);
    rec.h = h; plays.push(rec); return h;
  } };
{ const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
const M = await import("./main.mjs");
M.start({ init: true, ready: true });

/* the board: the struck token, a neighbour above it, a token the GM hid right of it, one out of the player's sight left of it */
const T0 = cfg.target ?? { x: 750, y: 400 };
const hero = mk("HIT", "npc", 8, 6, { x: T0.x, y: T0.y });
mk("NB", "npc", 8, 6, { x: T0.x, y: T0.y - 110 });
mk("HID", "npc", 8, 6, { x: T0.x + 110, y: T0.y, hidden: true });
mk("FOG", "npc", 8, 6, { x: T0.x - 110, y: T0.y, unseen: true });
Hooks.callAll("canvasReady");
set(hero, "health", cfg.to ?? 3);
await sleep(700);
/* what this seat draws, relative to the struck token's screen box: centre and cap height of every play, read through its follow function */
const tg = stage.toGlobal({ x: hero.x, y: hero.y });
const out = plays.map((r) => {
  const a = typeof r.o.at === "function" ? r.o.at() : r.o.at;
  const g = a && Number.isFinite(a.x) ? stage.toGlobal(a) : null;
  return { text: r.text, num: /^[+-]\d+$/.test(r.text), dx: g ? Math.round((g.x - tg.x) * 10) / 10 : null, dy: g ? Math.round((g.y - tg.y) * 10) / 10 : null, cap: Math.round(pxOf(r.o) * 10) / 10 };
});
console.log(JSON.stringify({ seat: cfg.name ?? "?", out, tok: { x: tg.x, y: tg.y, w: 100 * z }, W, H }));
process.exit(0);
