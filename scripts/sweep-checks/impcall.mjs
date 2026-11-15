import "../tokenreact/impact-node-prime.mjs";      // the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/impcall.mjs  (IMPCALL, 2026-11-15: plus-ultra's impact-frame callers on LETR 1.9.21).
// Engine 1.9.20 / 1.9.21: the tokens take part in an impact as figures (subject, the attacker `from`, `also`), and the strongest impacts are a
// one-second cut (24 ticks; 1.9.20: 12 = 500 ms). Checks (each failed on tactics-integrated-144 with 1.9.21 vendored):
//   A  token reactions: a crowd's one impact names the other struck tokens as `also` (shared data only: the same list on every seat, no
//      GM-hidden token, never the subject or the attacker, at most 6), and the rest of the crowd strikes after the impact's REAL last drawing
//      (a knock-down is longer than 500 ms on 1.9.21; the old caller capped it at 500);
//   B  the roll splash: the roll's other targets join as `also` (pure alsoTargets), the impact's fallback end reads the engine's own limit;
//   C  the splash's critical asks for its impact BEFORE the heavy work of its word (IMPCALL timing; see the T section).
// The harness is fxi-token's fake Foundry (copied) with a recording engine whose L.impact plans with the vendored plan.mjs.
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import("node:fs");

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

const { sizeFor } = await import("../letters/size.mjs");
const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);
const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: 1, vw: VW - 300, vh: VH, sizeK: sizeK(o), aspect: 3 });
const SLAM = [{ ticks: 3 }, { ticks: 1, impact: true }, { ticks: 1 }, { ticks: 2, fx: [{ k: "burst" }] }, { ticks: 2 }, { ticks: 5 }];
const POP = [{ ticks: 2 }, { ticks: 1, fx: [{ k: "burst" }] }, { ticks: 2 }, { ticks: 2 }];
const isNum = (t) => /^[+-]\d/.test(String(t));
const plays = [], impacts = [];
const { planImpact, LIMITS } = await import("../letters/impact/plan.mjs");
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
    limits: { ...LIMITS },
    get busy() { return false; },
    plan: (spec) => planImpact(spec),
    play(spec) {
      impacts.push({ spec, t: performance.now(), user: game.user.isGM ? "gm" : "player" });
      return { id: `i${impacts.length}`, alive: true, plan: planImpact(spec), finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} };
    }
  } };
{ const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
const M = await import("../tokenreact/main.mjs");
M.start({ init: true, ready: true });
const P = await import("../tokenreact/pure.mjs");
const IP = await import("../splash/impact-plan.mjs");
const { impStart } = await import("./align-imp.mjs");
const take = async (ms = 1300) => { await sleep(ms); const w = plays.splice(0); return { words: w, im: impacts.splice(0) }; };
const reset = () => { user.isGM = true; toks.splice(0); combat.combatants.clear(); };
const idsOf = (spec) => (spec?.also ?? []).map((t) => t.id);

/* ================================================================== A: token reactions */
/* seven struck at once, one of them knocked down (fxi-token I15's moment), one of the others hidden by the GM: on the GM's seat and on a
   player's seat */
async function crowd(who, base) {
  reset(); user.isGM = who === "gm";
  const ts = [0, 1, 2, 3, 4, 5, 6].map((i) => mk(`Z${i}`, "npc", 8, 6, { x: 200 + i * 180, y: 400, hidden: i === 5 }));
  Hooks.callAll("canvasReady");
  Hooks.callAll("invincible-plus-ultra.tactics", { type: "broken", target: "cZ3", combat: "C1", fight: "F", seq: base });
  ts.forEach((t, i) => set(t, "health", i === 3 ? 0 : 6, i === 3 ? { ipuTactics: true } : {}, base + 10 + i));
  return take(2600);
}
{ const S = { gm: await crowd("gm", 91000), player: await crowd("player", 91000) };
  for (const who of ["gm", "player"]) {
    const { words, im } = S[who];
    const imp = im[0];
    /* IMPCALL2 (ADVI2 10: a -1 beside a -8 took the -8's full treatment): the six -2 blows (the engine's step 2) are more than ALSO_GAP steps
       under the knock-down (step 4): the knock-down's cut is its own; the -2s strike after it in ONE lower cut of their own (on the first of
       them by id, the others its figures). Was: one impact, the five others as `also` */
    ck(`A ${who}: the knock-down's impact first, then one for the lighter blows (${im.length}, ${imp?.spec.kind} on ${imp?.spec.subject?.id})`, im.length === 2 && imp.spec.kind === "ko" && imp.spec.subject?.id === "Z3");
    ck(`A ${who}: the knock-down's cut is its own (also: ${idsOf(imp?.spec).join(" ")})`, idsOf(imp?.spec).length === 0);
    const im2 = im[1], also = idsOf(im2?.spec);
    ck(`A ${who}: the lighter blows' cut on the first of them, a lower rung (${im2?.spec.subject?.id} ${im2?.spec.kind} ${im2?.spec.magnitude})`, im2?.spec.subject?.id === "Z0" && im2.spec.kind !== "ko" && im2.spec.magnitude < imp.spec.magnitude);
    ck(`A ${who}: the other lighter tokens take part as its figures (also: ${also.join(" ")})`, also.length === 4 && also.join(" ") === "Z1 Z2 Z4 Z6");
    ck(`A ${who}: the second cut after the first one's last drawing`, im2 && impStart(im2.spec) >= impStart(imp.spec) + planImpact(imp.spec).ms - 1);
    ck(`A ${who}: never the subject, never a GM-hidden token`, !also.includes("Z3") && !also.includes("Z5"));
    const plan = imp ? planImpact(imp.spec) : null, ms = plan?.ms ?? 0;
    ck(`A ${who}: the knock-down's impact is longer than the old 500 ms cap on 1.9.21 (${Math.round(ms)} ms)`, ms > 520);
    const rest = words.filter((x) => x.o.token?.id !== imp?.spec.subject?.id && !isNum(x.text));
    const first = rest.length ? Math.min(...rest.map((x) => x.o.startAt ?? Infinity)) : NaN;
    /* the words strike HIT_LEAD-ish after their start: the strike instant (startAt + their contact) must be at or after the impact's end; their
       startAt is placed so that their contact falls on tHit = T0 + after + delay, so their startAt >= impact end - (contact lead, < 260 ms) */
    ck(`A ${who}: the rest of the crowd strikes after the impact's last drawing (${Math.round(first - impStart(imp?.spec))} ms after its start, its drawings ${Math.round(ms)} ms)`,
      rest.length > 0 && rest.every((x) => x.o.startAt >= impStart(imp.spec) + ms - 260));
  }
  ck(`A the same call on both seats (also ${idsOf(S.gm.im[0]?.spec).join(",")} / ${idsOf(S.player.im[0]?.spec).join(",")}, ${S.gm.im[0]?.spec.magnitude} / ${S.player.im[0]?.spec.magnitude})`,
    idsOf(S.gm.im[0]?.spec).join() === idsOf(S.player.im[0]?.spec).join() && S.gm.im[0]?.spec.magnitude === S.player.im[0]?.spec.magnitude && S.gm.im[0]?.spec.kind === S.player.im[0]?.spec.kind
    && idsOf(S.gm.im[1]?.spec).join() === idsOf(S.player.im[1]?.spec).join() && S.gm.im[1]?.spec.subject?.id === S.player.im[1]?.spec.subject?.id && S.gm.im[1]?.spec.magnitude === S.player.im[1]?.spec.magnitude);   // (the seed: one process cannot hand both seats the same tactics event; fxi-token pins it)
}
/* a single blow: no `also` */
{ reset(); const t = mk("Y1", "npc", 8, 6, { x: 600, y: 400 }); Hooks.callAll("canvasReady"); set(t, "health", 2, {}, 93001);
  const { im } = await take(1800);
  ck(`A a lone blow: its impact has no other figures (${im.length} impacts, also ${idsOf(im[0]?.spec).length})`, im.length === 1 && !im[0].spec.also);
}
/* pure parts */
ck("A alsoOf: sorted, unique, without the subject and the attacker, at most 6",
  JSON.stringify(P.alsoOf(["c", "a", "b", "a", "S", "F", "d", "e", "f", "g", "h"], ["S", "F"])) === JSON.stringify(["a", "b", "c", "d", "e", "f"]));
ck("A impactAfter: the plan's length, capped by the engine's longest impact", P.impactAfter({ limits: { maxTicks: 24 } }, { ms: 1500 }) === 1000 && P.impactAfter({ limits: { maxTicks: 24 } }, { ms: 708.4 }) === 709 && P.impactAfter({ limits: { maxTicks: 12 } }, { ms: 708 }) === 500 && P.impactAfter(null, { ms: 900 }) === 900);
{ const src = fs.readFileSync(new URL("../tokenreact/main.mjs", import.meta.url), "utf8");
  ck("A no fixed 500 ms cap on the impact's length in the token reactions", !/Math\.min\(500,/.test(src)); }

/* ================================================================== B: the roll splash */
ck("B alsoTargets: the targets after the first (the subject), Foundry ids only, at most 6",
  JSON.stringify(IP.alsoTargets(["AAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBB", "bad", "CCCCCCCCCCCCCCCC"])) === JSON.stringify(["BBBBBBBBBBBBBBBB", "CCCCCCCCCCCCCCCC"]) && IP.alsoTargets(["AAAAAAAAAAAAAAAA"]).length === 0);
{ const src = fs.readFileSync(new URL("../splash/stage.mjs", import.meta.url), "utf8");
  ck("B the splash's impact passes the other targets as also", /IP\.alsoTargets\(ctl\.targets\)/.test(src) && /s\.also = also/.test(src));
  ck("B the splash's fallback end of an impact reads the engine's own longest impact (not 500 ms)", /impactMaxMs\(LE\?\.impact\)/.test(src) && !/IMPACT_MAX_MS = 500\b/.test(src)); }

/* B: the map critical with a target holds on the struck figures after its peak (the same peak, the word's spot left clear, no new flash) */
{ const { impactApi } = await import("../tokenreact/impact-node.mjs"); const I = impactApi();
  for (const m of [0.5, 0.84, 1.1, 1.6, 2]) {
    const a = planImpact({ kind: "crit", magnitude: m, seed: "s", frames: IP.mapFrames(m, I) }), b = planImpact({ kind: "crit", magnitude: m, seed: "s", frames: IP.mapFrames(m, I, { figs: true }) });
    ck(`B map ${m}: the same peak with the figures' tail (${Math.round(a.peakMs)} / ${Math.round(b.peakMs)} ms)`, a.peakMs === b.peakMs);
    ck(`B map ${m}: nothing added covers the word's spot`, b.frames.every((x) => !IP.COVERS_WORD.includes(x.type)));
    const fl = (p) => p.frames.filter((x) => ["slam", "shadow", "glare", "swap", "window", "tear", "ink", "shatter"].includes(x.type)).length;
    ck(`B map ${m}: no new scene-changing drawing (${fl(a)} / ${fl(b)})`, fl(a) === fl(b));
    if (m >= 1.1) ck(`B map ${m}: a critical with a target is longer and turns the figures' colours (${Math.round(a.ms)} -> ${Math.round(b.ms)} ms, ${b.frames.map((x) => x.fig).join("")})`,
      b.ms > a.ms + 200 && ["n", "h", "d"].every((c) => b.frames.some((x) => x.fig === c)) && b.ms <= LIMITS.maxTicks * 1000 / 24 + 1);
    else ck(`B map ${m}: a strong (not critical) result stays as it was`, JSON.stringify(a.frames.map((x) => x.type)) === JSON.stringify(b.frames.map((x) => x.type)));
  }
  ck("B map: without a target the frames are the old ones", JSON.stringify(IP.mapFrames(1.6, I)) === JSON.stringify(IP.MAP_FRAMES[IP.tierOfImpact(1.6, I)])); }

console.log(`sweep impcall: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
