import "./impact-node-prime.mjs";      // CALLERS2: the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/tokenreact/check-crowd-seat.mjs '<seat json>'  -- ONE seat of the CROWD checks (scripts/sweep-checks/crowd.mjs runs it once
// per seat and scenario, each in its own node process, and compares what the seats draw). Not a suite of its own: it prints one JSON line.
// The harness of check-same-seat.mjs (a fake Foundry with a real view: a stage that pans and zooms, the interface round the canvas), with a
// board of several tokens, note pins, and a stand-in engine that also answers L.planFor (the drawn box of a word, as the engine plans it) and
// records every impact frame asked for. cfg = { name, gm, W, H, side, zoom, center, toks: [{ id, x, y, hidden, unseen, hm }], notes:
// [{ id, x, y, size, pub }], hits: [{ t, id, stat, to }] (t = ms after the start) , wait }
const cfg = JSON.parse(process.argv[2] ?? "{}");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const W = cfg.W ?? 1600, H = cfg.H ?? 900, SIDE = cfg.side ?? 300;

const hooks = {};
globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
const settings = new Map(), values = { "invincible-plus-ultra.tokenReactEnabled": true, "invincible-plus-ultra.tokenReactSize": "normal", "invincible-plus-ultra.tokenReactLang": "en" };
const user = { isGM: !!cfg.gm, id: cfg.gm ? "GM" : "P1" };
globalThis.game = {
  user, i18n: { lang: "en", has: () => false, localize: (k) => k },
  settings: { settings, register: (m, k, o) => settings.set(`${m}.${k}`, o), get: (m, k) => values[`${m}.${k}`] },
  modules: new Map([["invincible-plus-ultra", { api: {} }]]), combats: new Map(), messages: { contents: [] }
};
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o), expandObject: (o) => o } };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
globalThis.innerWidth = W; globalThis.innerHeight = H;
const el = (x, y, w, h) => ({ getBoundingClientRect: () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h }) });
const UI = { "#sidebar": [el(W - SIDE, 0, SIDE, H)], "#hotbar": [el(W * 0.3, H - 66, 560, 58)], "#scene-controls": [el(8, 50, 46, H - 260)] };
for (const p of cfg.panels ?? []) (UI[p.sel] ??= []).push(el(p.x, p.y, p.w, p.h));      // CROWD2: a seat's own floating panels (the GM's desk)
globalThis.document = { querySelector: (sel) => UI[sel]?.[0] ?? null, querySelectorAll: (sel) => UI[sel] ?? [] };
globalThis.getComputedStyle = () => ({ visibility: "visible" });
const z = cfg.zoom ?? 1, C0 = cfg.center ?? { x: 800, y: 450 };
const cam = { x: C0.x - W / 2 / z, y: C0.y - H / 2 / z, z };
const stage = { scale: { get x() { return cam.z; } }, toGlobal: (p) => ({ x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z }), toLocal: (q) => ({ x: q.x / cam.z + cam.x, y: q.y / cam.z + cam.y }) };
const scene = { id: "S" };
const toks = [], notes = [];
globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, stage, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0, right: W, bottom: H, width: W, height: H }) } },
  tokens: { placeables: toks, get: (id) => toks.find((t) => t.id === id) }, notes: { placeables: notes } };
let stamp = 1000;
for (const t of cfg.toks ?? []) {
  /* CROWD2: hero = a player's hero (every seat reads its numbers) */
  const actor = { id: `A${t.id}`, type: t.hero ? "superhero" : "npc", hasPlayerOwner: !!t.hero, system: { derived: { health: { value: t.h ?? 8, max: t.hm ?? 8 }, resolve: { value: 6, max: 8 } } },
    testUserPermission: () => !!cfg.gm, _stats: { modifiedTime: stamp } };
  const vis = cfg.gm || (!t.hidden && !t.unseen);
  const tok = { id: t.id, name: t.id, scene, isVisible: vis, visible: vis, document: { id: t.id, hidden: !!t.hidden }, actor, x: t.x, y: t.y, w: 100, h: 100, destroyed: false };
  actor.getActiveTokens = () => [tok];
  toks.push(tok);
}
for (const n of cfg.notes ?? []) {
  const s = n.size ?? 48;
  notes.push({ visible: !!cfg.gm || n.pub, document: { id: n.id, x: n.x, y: n.y, iconSize: s, entry: { ownership: { default: n.pub ? 2 : 0 } }, _source: { author: "GM" }, author: { isGM: true } }, bounds: { x: n.x - s / 2, y: n.y - s / 2, width: s, height: s } });
}
const set = (tok, stat, v) => { tok.actor._stats.modifiedTime = ++stamp; tok.actor.system.derived[stat].value = v; Hooks.callAll("updateActor", tok.actor, { system: { derived: { [stat]: { value: v } } } }, {}); };

const { sizeFor } = await import("../letters/size.mjs");
const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);
const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: cam.z, vw: W - SIDE, vh: H, sizeK: sizeK(o), aspect: 3, fit: o.fit ?? "legible", alive: 0 });
const pxOf = (o) => sizeFor(ctxOf(o)).px;
/* the drawn box of a word in caps: Bungee-like digits for numbers, the invincible hand's narrow letters for words (a stand-in, the same on
   every seat) */
const boxOf = (text) => { const n = [...String(text)].length; return /^[+-]\d+$/.test(text) ? { w: 0.25 + 0.8 * n, h: 1.2 } : { w: 0.62 * n + 0.2, h: 1.35 }; };
const plays = [], impacts = [];
const t00 = performance.now();
const fake = { version: "test", limits: { screen: 16, world: 48 }, prefs: { scale: 1 }, ready: async () => true, count: () => 0,
  sizeOf: (text, o) => ({ ...sizeFor(ctxOf(o)), sizeK: sizeK(o) }),
  planFor: (text) => ({ plan: { _holdBox: boxOf(text) } }),
  contactAt: (h) => h.opts.startAt,
  impact: { play: (spec) => { impacts.push({ kind: spec.kind, magnitude: spec.magnitude, series: spec.series ?? 0, subject: spec.subject?.id, t: Math.round(performance.now() - t00) }); return { finished: Promise.resolve(), stop() {} }; }, plan: () => ({ ms: 300 }) },
  play: (text, o) => {
    const rec = { text, o, t: Math.round(performance.now() - t00) };
    const h = { id: `h${plays.length}`, hand: "x", alive: true, opts: o, plan: { timeline: { ent: [{ ticks: 6 }, { ticks: 6 }] }, _holdBox: boxOf(text) }, ready: sleep(30).then(() => true),
      finished: sleep((o.hold ?? 800) + 900).then(() => { h.alive = false; return "done"; }), stop() { h.alive = false; h.stopped = true; }, moveTo() {} };
    rec.h = h; plays.push(rec); return h;
  } };
{ const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
if (cfg.debug) globalThis.__samepicFit = [];      // the layout's own record of every placing (CROWDKO debugging)
globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
const M = await import("./main.mjs");
M.start({ init: true, ready: true });
Hooks.callAll("canvasReady");
/* what this seat draws: per play its text, its screen box (centre from its follow function, size from the engine's model x its drawn box) */
const snap = (r) => {
  const a = typeof r.o.at === "function" ? r.o.at() : r.o.at;
  const g = a && Number.isFinite(a.x) ? stage.toGlobal(a) : null, cap = pxOf(r.o), b = boxOf(r.text);
  return { text: r.text, num: /^[+-]\d+$/.test(r.text), tok: r.o.token?.id ?? null, t: r.t, cap: Math.round(cap * 10) / 10,
    box: g ? { x: Math.round(g.x - cap * b.w / 2), y: Math.round(g.y - cap * b.h / 2), w: Math.round(cap * b.w), h: Math.round(cap * b.h) } : null };
};
const frames = [];
for (const h of cfg.hits ?? []) {
  const now = performance.now() - t00;
  if (h.t > now) await sleep(h.t - now);
  const tok = toks.find((t) => t.id === h.id);
  if (tok) set(tok, h.stat ?? "health", h.to);
  if (h.snap) { await sleep(h.snap); frames.push({ at: h.t, plays: plays.map(snap) }); }
}
await sleep(cfg.wait ?? 900);
const tg = (id) => { const t = toks.find((q) => q.id === id); const a = stage.toGlobal({ x: t.x, y: t.y }); return { id, x: a.x, y: a.y, w: 100 * z, h: 100 * z }; };
const pins = notes.map((n) => { const a = stage.toGlobal({ x: n.bounds.x, y: n.bounds.y }); return { id: n.document.id, x: a.x, y: a.y, w: n.bounds.width * z, h: n.bounds.height * z }; });
console.log(JSON.stringify({ seat: cfg.name ?? "?", W, H, side: SIDE, plays: plays.map(snap), impacts, frames, toks: toks.map((t) => tg(t.id)), pins, ...(cfg.debug ? { fit: globalThis.__samepicFit } : {}) }));
process.exit(0);
