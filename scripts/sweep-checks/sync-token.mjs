import "../tokenreact/impact-node-prime.mjs";      // CALLERS2: the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/sync-token.mjs  (SYNC, 2026-11-14: the owner's ruling "the GM and the players see the same MOMENT"; ADVX
// finding 5: token-hit impact frames ran about two film frames apart, either way). Seats modelled in turn on the fxi-token harness: one change,
// stamped by the server, reaches each seat after its own delay, and each seat's timers fire late by their own amount (a busy page). The
// blow's instant (the impact's blowAt, where the word strikes) must be the SAME instant after the change's server stamp on every seat.
// Fails on tactics @ 361d5ff (tactics-integrated-123): there the blow was "this seat's now + HIT_LEAD" when its gathering timer fired.
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hooks = {};
globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
const settings = new Map(), values = { "invincible-plus-ultra.tokenReactEnabled": true, "invincible-plus-ultra.tokenReactSize": "normal" };
const user = { isGM: true, id: "U" };
const combat = { id: "C1", combatants: new Map() };
globalThis.game = {
  user, i18n: { lang: "en", has: () => false, localize: (k) => k },
  settings: { settings, register: (m, k, o) => settings.set(`${m}.${k}`, o), get: (m, k) => values[`${m}.${k}`] },
  modules: new Map([["invincible-plus-ultra", { api: {} }]]), combats: new Map([["C1", combat]]), messages: { contents: [] }
};
globalThis.foundry = { utils: { getProperty: (o, p) => p.split(".").reduce((a, k) => a?.[k], o), expandObject: (o) => o } };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
const VW = 1600, VH = 900;
globalThis.innerWidth = VW; globalThis.innerHeight = VH;
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.getComputedStyle = () => ({ visibility: "visible" });
globalThis.matchMedia = () => ({ matches: false });
const stage = { scale: { x: 1 }, toGlobal: (p) => ({ x: p.x, y: p.y }), toLocal: (q) => ({ x: q.x, y: q.y }) };
const scene = { id: "S" };
const toks = [];
globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, stage, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0, right: VW, bottom: VH, width: VW, height: VH }) } },
  tokens: { placeables: toks, get: (id) => toks.find((t) => t.id === id) } };
let stamp = 1000;
function mk(id, type, h, r, o = {}) {
  const actor = { id: `A${id}`, type, hasPlayerOwner: !!o.player, system: { derived: { health: { value: h, max: o.hm ?? 8 }, resolve: { value: r, max: 8 } } },
    testUserPermission: () => !!o.observer, _stats: { modifiedTime: stamp } };
  const tok = { id, scene, isVisible: true, document: { id, hidden: !!o.hidden }, actor, x: o.x ?? 0, y: o.y ?? 0, w: 100, h: 100, destroyed: false };
  Object.defineProperty(tok, "center", { get: () => ({ x: tok.x + 50, y: tok.y + 50 }) });
  actor.getActiveTokens = () => [tok];
  actor.name = id;
  tok.document.object = tok;
  combat.combatants.set(`c${id}`, { token: { object: tok } });
  toks.push(tok);
  return tok;
}
const set = (tok, stat, v, options = {}, st = ++stamp) => { tok.actor._stats.modifiedTime = st; tok.actor.system.derived[stat].value = v; Hooks.callAll("updateActor", tok.actor, { system: { derived: { [stat]: { value: v } } } }, options); };
/* the system's Damage Taken card (helpers/rolls.mjs; the public line, a second paragraph = a critical injury: Health went below 0) */
let msgId = 0;
const card = (tok, taken, broken = false) => Hooks.callAll("createChatMessage", { id: `m${++msgId}`, speakerActor: tok.actor, flavor: "Damage Taken",
  content: `<p><strong>${tok.id}</strong> took <strong>${taken}</strong> damage.</p>${broken ? "<p>Critical injury.</p>" : ""}`, rolls: [] });

/* the engine stand-in. A word's entrance as the real one is drawn (design.mjs buildTimeline): a slam (wind-up 3 ticks, flash 1, smear 1,
   squash with the burst, ...) for words with an even letter count, a pop (2 ticks, the overshoot with its burst, ...) for odd ones, so two
   seats that letter different words have different contacts */
const { sizeFor } = await import("../letters/size.mjs");
const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);
const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: 1, vw: VW - 300, vh: VH, sizeK: sizeK(o), aspect: 3 });
const SLAM = [{ ticks: 3 }, { ticks: 1, impact: true }, { ticks: 1 }, { ticks: 2, fx: [{ k: "burst" }] }, { ticks: 2 }, { ticks: 5 }];
const POP = [{ ticks: 2 }, { ticks: 1, fx: [{ k: "burst" }] }, { ticks: 2 }, { ticks: 2 }];
const isNum = (t) => /^[+-]\d/.test(String(t));
const plays = [], impacts = [];
let busyUntil = 0;
const { planImpact } = await import("../letters/impact/plan.mjs");
const fake = { version: "test", limits: { screen: 16, world: 48 }, ready: async () => true, count: () => 0,
  sizeOf: (text, o) => ({ ...sizeFor(ctxOf(o)), sizeK: sizeK(o) }),
  play: (text, o) => {
    const rec = { text, o, t: performance.now() };
    const ent = isNum(text) ? POP : ([...String(text)].filter((c) => /\w/.test(c)).length % 2 ? POP : SLAM);
    const h = { id: `h${Math.random()}`, hand: "x", alive: true, opts: o, plan: { timeline: { ent: ent.map((p) => ({ ...p })) } }, ready: sleep(30).then(() => true),
      finished: sleep((o.hold ?? 800) + 900).then(() => { h.alive = false; return "done"; }), stop() { h.alive = false; }, moveTo() {} };
    rec.h = h; plays.push(rec); return h;
  },
  impact: {
    get busy() { return performance.now() < busyUntil; },
    plan: (spec) => planImpact(spec),
    play(spec) {
      const rec = { spec, t: performance.now(), user: game.user.isGM ? "gm" : "player" };
      impacts.push(rec);
      return { id: `i${impacts.length}`, alive: true, plan: planImpact(spec), finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} };
    }
  } };
{ const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
const M = await import("../tokenreact/main.mjs");
M.start({ init: true, ready: true });
const P = await import("../tokenreact/pure.mjs");
const { impStart, impBlow } = await import("./align-imp.mjs");      // ALIGN (engine 1.9.1): the token side gives the impact its blow (`blowAt`); start and blow read with the engine's own plan
const reacted = [];
Hooks.on("invincible-plus-ultra.tokenReact", (d) => reacted.push(d));
const take = async (ms = 1300) => { await sleep(ms); const w = plays.splice(0); return { words: w, im: impacts.splice(0) }; };
const reset = () => { user.isGM = true; toks.splice(0); combat.combatants.clear(); };
const frames = (spec) => planImpact(spec).frames.map((x) => x.type).join(",");


const realST = globalThis.setTimeout, realNow = Date.now, STAMP = 1.8e12;
/* The server's two clocks, as seen live: the table's clock (Foundry's "time" socket) counts from the server's start (UP), documents carry
   the epoch (STAMP = UP + K). Each seat syncs the table's clock (one ping) and learns K from an earlier document it heard `prior` ms after
   it was stamped (its fastest delivery: the residual error of the mapping, different per seat). */
const Clock = await import("../shared-clock.mjs");
const UP = 5.2e7, K = STAMP - UP;
/* one seat: the change reaches it `lag` ms after the server stamped it; its timers fire `late` ms late. -> the blow after the stamp (ms) */
async function oneSeat(who, lag, late, o = {}) {
  reset(); user.isGM = who === "gm";
  const t = mk("SY", "npc", o.h ?? 8, 6, { x: 600, y: 400 });
  Hooks.callAll("canvasReady");
  /* this seat's table clock: UP + lag now */
  Clock._reset();
  const pOff = UP + lag - performance.now();
  game.socket = { emit: (n, cb) => cb({ serverTime: Math.floor(performance.now() + pOff) }) };
  await Clock.ping();
  delete game.socket;
  Clock.noteEpoch(K + Clock.serverNow() - (o.prior ?? 1));
  globalThis.setTimeout = (f, ms, ...a) => realST(f, (ms || 0) + late, ...a);
  /* the epoch on this seat reads STAMP + lag now (one server stamp for every seat, so one seed and one word) */
  const shift = realNow() - (STAMP + lag); Date.now = () => realNow() - shift;
  const p0 = performance.now(), stamp = STAMP;      // the server's stamp, lag ms before the change reached this seat
  set(t, "health", o.to ?? 5, { modifiedTime: stamp });
  const r = await take(1700);
  globalThis.setTimeout = realST; Date.now = realNow;
  const blow = r.im[0]?.spec?.blowAt;
  const word = r.words.find((w) => !isNum(w.text));
  return { blow: Number.isFinite(blow) ? blow - (p0 - lag) : null, word: word ? word.o.startAt - (p0 - lag) : null, kind: r.im[0]?.spec?.kind };
}
const A = await oneSeat("gm", 3, 0, { prior: 1 }), B = await oneSeat("player", 45, 30, { prior: 2 }), C = await oneSeat("player", 18, 12, { prior: 3 });
console.log("S6 blows (ms after the stamp)", A.blow, B.blow, C.blow);
ck(`S6 the blow lands on one instant after the change's server stamp on every seat (GM ${A.blow?.toFixed(1)}, player ${B.blow?.toFixed(1)}, player 2 ${C.blow?.toFixed(1)} ms)`,
  [A, B, C].every((s) => Number.isFinite(s.blow)) && Math.max(A.blow, B.blow, C.blow) - Math.min(A.blow, B.blow, C.blow) <= 3);
ck(`S6 ... the word is started for that instant too (GM ${A.word?.toFixed(1)}, player ${B.word?.toFixed(1)} ms after the stamp)`, Number.isFinite(A.word) && Math.abs(A.word - B.word) <= 3);
ck(`S6 ... and it is not later than before for the prompt seat (${A.blow?.toFixed(0)} ms after the stamp; before: arrival + ${160} ms gathering + HIT_LEAD ${P.HIT_LEAD} ms)`, A.blow <= 3 + 160 + P.HIT_LEAD + 80);
/* a fall to 0 waits for its card on every seat alike, whether this seat already holds the card or not */
const D = await oneSeat("gm", 3, 0, { h: 4, to: 0, prior: 1 }), E = await oneSeat("player", 40, 20, { h: 4, to: 0, prior: 2 });
/* a seat that has not learnt the epoch yet (no stamp heard) falls back to its arrival: it still plays, prompt as before */
{ const F = await oneSeat("player", 40, 0, { prior: 1e9 }); ck(`S6 a seat without the epoch mapping still plays (${F.blow?.toFixed(0)} ms after the stamp)`, Number.isFinite(F.blow) && F.blow < 40 + 160 + P.HIT_LEAD + 200); }
ck(`S6 a knock-down (card wait) lands on one instant too (GM ${D.blow?.toFixed(1)}, player ${E.blow?.toFixed(1)} ms after the stamp)`, Number.isFinite(D.blow) && Math.abs(D.blow - E.blow) <= 3);
console.log(`sweep sync-token: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
