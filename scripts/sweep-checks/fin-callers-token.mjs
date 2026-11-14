// node scripts/sweep-checks/fin-callers-token.mjs  (FIN-CALLERS, the token side of one story, seen failing live on lane 5 before the fix):
//   O1 the roll's dice take seconds: a start said with the card still holds the target's blow until the roll's word has struck (it had
//      run out after 2.5 s from the card and the blow came 0.2-0.4 s BEFORE the word);
//   O2 the blow lands on the SHARED instant the roll's story ends (landAt + the longer of impactMs + the beat and the read time 900 ms),
//      on every seat alike, whenever this
//      seat's land message arrived (live: GM and player 167-361 ms apart);
//   O3 an unlinked token's blows each get their own seed from the update's server time (live: every blow of a Mauler said WHAM!);
//   O4 the roll splash's landed moment, given on the "place" phase, keeps the target's word off it (live: the hit word sat on the roll's).
// The harness is fxi-token.mjs's fake Foundry and recording engine.
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
const reacted = [];
Hooks.on("invincible-plus-ultra.tokenReact", (d) => reacted.push(d));
const take = async (ms = 1300) => { await sleep(ms); const w = plays.splice(0); return { words: w, im: impacts.splice(0) }; };
const reset = () => { user.isGM = true; toks.splice(0); combat.combatants.clear(); };
const frames = (spec) => planImpact(spec).frames.map((x) => x.type).join(",");

/* run one scenario on a GM seat and on a player seat (the same server stamps), return both seats' records */
async function seats(build, run, ms = 1500) {
  const out = {};
  for (const who of ["gm", "player"]) {
    reset(); user.isGM = who === "gm";
    const t = build();
    Hooks.callAll("canvasReady");
    const t0 = performance.now();
    await run(t);
    const r = await take(ms);
    out[who] = { ...r, t0 };
  }
  return out;
}
const landP = (S) => S;
/* ---- O1: start with the card, dice for 3 s, the change, the landing 400 ms later */
{ const S = await seats(() => mk("OA", "npc", 8, 6, { x: 600, y: 400 }), async (t) => {
    const id = `o1-${game.user.isGM}`; Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "start", id });
    await sleep(3000);
    /* (the splash says start again only after the dice and the shared start: after this reaction has begun to wait) */
    set(t, "health", 4, {}, 91001); await sleep(400);
    landP.at = performance.now() + 160; Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "land", id, landAt: landP.at, impactMs: 300 });
    landP[game.user.isGM ? "gm" : "player"] = landP.at;
  }, 2400);
  for (const who of ["gm", "player"]) {
    const im = S[who].im[0], lead = im ? P.leadMs(planImpact({ ...im.spec, reduced: false }).frames) : 0;
    ck(`O1 ${who}: the target's blow strikes after the roll's word and its impact (${Math.round(im?.spec.startAt + lead - landP[who])} ms after the landing; >= 420)`, !!im && im.spec.startAt + lead >= landP[who] + 300 + 120 - 2);
  }
  /* a start that never lands does not hold a blow for long: done or stale lets it go */
  for (const id of ["o1-true", "o1-false"]) Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "done", id });
}
/* ---- O2: the same story on two seats whose land messages arrive 10 ms and 70 ms after it was said */
{ const at = {};
  const S = await seats(() => mk("OB", "npc", 8, 6, { x: 600, y: 400 }), async (t) => {
    const id = `o2-${game.user.isGM}`, t0 = performance.now();
    Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "start", id });
    set(t, "health", 5, {}, 91101);
    await sleep(game.user.isGM ? 10 : 70);
    const landAt = t0 + 500; at[game.user.isGM ? "gm" : "player"] = t0;
    Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "land", id, landAt, impactMs: 375 });
  }, 2200);
  const rel = (who) => { const im = S[who].im[0]; return im ? im.spec.startAt + P.leadMs(planImpact({ ...im.spec, reduced: false }).frames) - at[who] : NaN; };
  const want = 500 + Math.max(375 + 120, 900);      // the landing + the longer of (its impact + the beat) and the read time
  ck(`O2 GM and player: the blow on one instant after the shared landing (${Math.round(rel("gm"))} / ${Math.round(rel("player"))} ms after the story began; landing + max(impact + beat, read) = ${want})`,
    Math.abs(rel("gm") - rel("player")) < 6 && Math.abs(rel("gm") - want) < 25);
  for (const id of ["o2-true", "o2-false"]) Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "done", id });
}
/* ---- O3: two blows on an unlinked token whose actor stamp does not move: the update's own server time seeds each */
{ reset(); const t = mk("OC", "npc", 11, 6, { x: 600, y: 400 }); Hooks.callAll("canvasReady");
  const st = t.actor._stats.modifiedTime;
  t.actor.system.derived.health.value = 9; Hooks.callAll("updateActor", t.actor, { system: { derived: { health: { value: 9 } } } }, { modifiedTime: 1794600000001 });
  const a = await take(1300);
  t.actor.system.derived.health.value = 7; Hooks.callAll("updateActor", t.actor, { system: { derived: { health: { value: 7 } } } }, { modifiedTime: 1794600009999 });
  const b = await take(1300);
  const sa = a.words.find((w) => !isNum(w.text))?.o.seed, sb = b.words.find((w) => !isNum(w.text))?.o.seed;
  ck(`O3 the actor's stamp did not move (${st} = ${t.actor._stats.modifiedTime}) and each blow has its own seed (${sa} / ${sb})`, st === t.actor._stats.modifiedTime && !!sa && !!sb && sa !== sb && sa.includes("1794600000001"));
}
/* ---- O4: the roll splash's landed moment stands where the target's word would go: asked on "place", the word goes elsewhere */
{ const posOf = (w) => { const a = w?.o.at; const p = typeof a === "function" ? a() : a; return p && Number.isFinite(p.x) ? p : null; };
  const once = async (block) => {
    reset(); const t = mk("OD", "npc", 8, 6, { x: 700, y: 400 }); Hooks.callAll("canvasReady");
    const fn = (d) => { if (d.phase === "place" && block) d.blocks.push(block); };
    (hooks["invincible-plus-ultra.tokenReact"] ??= []).unshift(fn);
    set(t, "health", 5, {}, 91301 + (block ? 1 : 0));
    const r = await take(1300);
    hooks["invincible-plus-ultra.tokenReact"].splice(hooks["invincible-plus-ultra.tokenReact"].indexOf(fn), 1);
    return posOf(r.words.find((w) => !isNum(w.text)));
  };
  const free = await once(null);
  const blk = free ? { l: free.x - 260, t: free.y - 90, r: free.x + 260, b: free.y + 90 } : null;
  const moved = blk ? await once(blk) : null;
  const inside = (p, b) => p && p.x > b.l && p.x < b.r && p.y > b.t && p.y < b.b;
  ck(`O4 a splash block where the word would stand (${JSON.stringify(free && { x: Math.round(free.x), y: Math.round(free.y) })}) moves the word out of it (${JSON.stringify(moved && { x: Math.round(moved.x), y: Math.round(moved.y) })})`,
    !!free && !!moved && !inside(moved, blk));
}
console.log(`sweep fin-callers-token: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
