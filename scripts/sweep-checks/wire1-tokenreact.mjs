// node scripts/sweep-checks/wire1-tokenreact.mjs  (WIRE1: impact frames, the engine's L.impact, wired into the token reactions).
// The harness is fxlt2-flow's fake Foundry; the engine is a recording stand-in that also records L.impact.play. Every check here fails on
// tactics @ 3a7701d (nothing called L.impact there). What is pinned (the owner, 2026-11-13/14): one impact per moment, at the instant the
// word lands; a series of blows builds; going down is the strongest; GM and player get the same impact (kind, strength, seed) unless
// privacy requires otherwise; nothing reveals a hidden or unseen token (no impact for it on the player's seat, no direction from a hidden
// attacker); reduced motion is passed as true only; no caller option reaches the photosensitivity guard; the real guard (plan.mjs) turns
// every spec this caller makes into the gentle / still variant with flashes off / reduced motion.
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
let reducedOS = false;
globalThis.matchMedia = () => ({ matches: reducedOS });
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
  tok.document.object = tok;
  combat.combatants.set(`c${id}`, { token: { object: tok } });
  toks.push(tok);
  return tok;
}
const set = (tok, stat, v, options = {}, st = ++stamp) => { tok.actor._stats.modifiedTime = st; tok.actor.system.derived[stat].value = v; Hooks.callAll("updateActor", tok.actor, { system: { derived: { [stat]: { value: v } } } }, options); };
const TAC = "invincible-plus-ultra.tactics";
let seq = 0;
const attackRoll = (who) => Hooks.callAll(TAC, { type: "roll", key: "attack", who: `c${who}`, combat: "C1", fight: "F", seq: ++seq });
const damage = (target, taken, o = {}) => Hooks.callAll(TAC, { type: "damage", target: `c${target}`, taken, combat: "C1", fight: "F", seq: o.seq ?? ++seq, ...o });

/* the engine stand-in: words (entrance 12 ticks = 500 ms) and L.impact (recorded; "hidden" when its token is not visible to this user, as
   the real player's subjectOf) */
const { sizeFor } = await import("../letters/size.mjs");
const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);
const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: 1, vw: VW - 300, vh: VH, sizeK: sizeK(o), aspect: 3 });
const plays = [], impacts = [];
const fake = { version: "test", limits: { screen: 16, world: 48 }, ready: async () => true, count: () => 0,
  sizeOf: (text, o) => ({ ...sizeFor(ctxOf(o)), sizeK: sizeK(o) }),
  play: (text, o) => {
    const rec = { text, o, t: performance.now() };
    const h = { id: `h${Math.random()}`, hand: "x", alive: true, opts: o, plan: { timeline: { ent: [{ ticks: 6 }, { ticks: 6 }] } }, ready: sleep(30).then(() => true),
      finished: sleep((o.hold ?? 800) + 900).then(() => { h.alive = false; return "done"; }), stop() { h.alive = false; }, moveTo() {} };
    plays.push(rec); return h;
  },
  impact: {
    play(spec) {
      const t = spec.subject?.document ? spec.subject : null;
      const hidden = t && (!t.isVisible || (t.document.hidden && !game.user.isGM));
      const rec = { spec, t: performance.now(), why: hidden ? "hidden" : "played" };
      impacts.push(rec);
      return { id: `i${impacts.length}`, alive: !hidden, plan: { magnitude: spec.magnitude }, finished: Promise.resolve(rec.why), ready: Promise.resolve(!hidden), stop() {} };
    }
  } };
{ const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
const M = await import("../tokenreact/main.mjs");
M.start({ init: true, ready: true });
const P = await import("../tokenreact/pure.mjs");
const take = async (ms = 1300) => { await sleep(ms); plays.splice(0); return impacts.splice(0); };
const reset = () => { user.isGM = true; reducedOS = false; toks.splice(0); };

/* ---- a blow: one impact on the token, when its word lands, seeded by the change, no reduced/photosafe keys */
{ reset();
  const t = mk("A", "npc", 8, 6, { x: 600, y: 400 });
  Hooks.callAll("canvasReady");
  const t0 = performance.now();
  set(t, "health", 6, {}, 70001);
  await sleep(1300);
  const word = plays.find((r) => !/^[+-]\d/.test(r.text));
  const im = impacts.splice(0); plays.splice(0);
  ck(`a blow: one impact frame (${im.length})`, im.length === 1);
  const s = im[0]?.spec ?? {};
  ck(`... on the struck token itself (the engine's visibility and silhouette)`, s.subject === t);
  ck(`... kind of a blow (${s.kind}) under the full-field strengths for a small hit (${s.magnitude})`, ["hit", "heavy"].includes(s.kind) && s.magnitude < 0.85);
  ck(`... at the instant the word lands: its entrance (500 ms) after the word starts (${Math.round((s.startAt ?? 0) - (word?.t ?? 0))} ms)`, word && Math.abs(s.startAt - word.t - 500) < 40);
  ck(`... seeded by the change everybody shares (${s.seed})`, typeof s.seed === "string" && s.seed.startsWith(`A|health|`) && s.seed.endsWith("|impact"));
  ck("... no reduced key when nothing asks for calm (a false would override the OS switch)", !("reduced" in s));
  ck("... and no key that could reach the photosensitivity guard", !("photosafe" in s) && !("flashes" in s) && !("vision" in s) && !("frames" in s));
  ck(`... the impact starts with the reaction, not later (${Math.round(im[0]?.t - t0)} ms after the change)`, im[0] && im[0].t - t0 < 900);
}

/* ---- the same change on a GM seat and a player seat: the same impact (kind, strength, seed): the shared moment */
{ reset();
  const t = mk("B", "npc", 8, 6, { x: 600, y: 400 });
  Hooks.callAll("canvasReady");
  set(t, "health", 4, {}, 70101);
  const gm = (await take())[0]?.spec;
  t.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady");
  user.isGM = false;
  set(t, "health", 4, {}, 70101);
  const pl = (await take())[0]?.spec;
  ck(`GM and player: one moment (${gm?.kind} ${gm?.magnitude} ${gm?.seed} / ${pl?.kind} ${pl?.magnitude} ${pl?.seed})`, !!gm && !!pl && gm.kind === pl.kind && gm.magnitude === pl.magnitude && gm.seed === pl.seed);
  /* the GM may read the NPC's track (-4 of 8 = heavy for him); the impact follows what the table was told, so the GM's is not stronger */
  ck("... chosen from what the table was told, not from the GM's private numbers", gm?.kind === "hit");
  /* the same with the public number told by the fight: both seats get the told amount */
  t.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady"); user.isGM = true;
  damage("B", 4, { seq: 501 }); set(t, "health", 4, { ipuTactics: true }, 70102);
  const gm2 = (await take())[0]?.spec;
  t.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady"); user.isGM = false; M.__forget?.();
  damage("B", 4, { seq: 502 }); set(t, "health", 4, { ipuTactics: true }, 70102);
  const pl2 = (await take())[0]?.spec;
  ck(`a told -4: heavy for both seats (${gm2?.kind} ${gm2?.magnitude} / ${pl2?.kind} ${pl2?.magnitude})`, gm2?.kind === "heavy" && pl2?.kind === "heavy" && gm2.magnitude === pl2.magnitude);
}

/* ---- privacy: a hidden token gives the player nothing; the GM still gets his */
{ reset();
  const t = mk("H", "npc", 8, 6, { x: 600, y: 400, hidden: true });
  Hooks.callAll("canvasReady");
  user.isGM = false;
  set(t, "health", 2, {}, 70201);
  const pl = await take();
  ck(`a hidden token: no impact on the player seat (${pl.length} calls, ${pl.map((x) => x.why)})`, pl.length === 0);
  t.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady"); user.isGM = true;
  set(t, "health", 2, {}, 70201);
  const gm = await take();
  ck(`... the GM (who sees it) gets it (${gm.length})`, gm.length === 1 && gm[0].why === "played");
  /* a token out of this player's sight (not hidden, just unseen) */
  reset();
  const u = mk("V", "npc", 8, 6, { x: 600, y: 400 });
  Hooks.callAll("canvasReady"); user.isGM = false; u.isVisible = false;
  set(u, "health", 5, {}, 70202);
  ck("an unseen token (out of sight): no impact on that seat", (await take()).length === 0);
}

/* ---- privacy: the attacker gives the direction only to a seat that sees him */
{ reset();
  const hero = mk("T", "superhero", 8, 6, { x: 600, y: 400, player: true });
  const foe = mk("F", "npc", 8, 6, { x: 900, y: 400, hidden: true });
  Hooks.callAll("canvasReady");
  user.isGM = false;
  attackRoll("F"); damage("T", 2); set(hero, "health", 6, { ipuTactics: true }, 70301);
  const pl = (await take())[0]?.spec;
  ck(`a hidden attacker: the player's impact has no direction from him (${pl ? Object.keys(pl).join(",") : "none"})`, !!pl && !("from" in pl) && !("dir" in pl));
  hero.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady"); user.isGM = true;
  attackRoll("F"); damage("T", 2); set(hero, "health", 6, { ipuTactics: true }, 70302);
  const gm = (await take())[0]?.spec;
  ck(`... the GM's comes from the attacker (${gm?.from?.id})`, gm?.from === foe);
  foe.document.hidden = false; hero.actor.system.derived.health.value = 8; Hooks.callAll("canvasReady"); user.isGM = false;
  attackRoll("F"); damage("T", 2); set(hero, "health", 6, { ipuTactics: true }, 70303);
  ck("... and a seen attacker gives the player's the same direction", (await take())[0]?.spec?.from === foe);
}

/* ---- a series builds; going down is the strongest; nothing else reaches the whole set */
{ reset();
  const t = mk("S", "superhero", 12, 6, { x: 600, y: 400, hm: 12, player: true });      // a player's hero: its track is public
  Hooks.callAll("canvasReady");
  const mags = [], kinds = [];
  for (const v of [11, 10, 9]) { set(t, "health", v); const im = await take(900); mags.push(im[0]?.spec?.magnitude); kinds.push(im[0]?.spec?.kind); }
  set(t, "health", 0); const down = (await take(1500))[0]?.spec;
  ck(`three blows in a row grow (${mags.join(" < ")})`, mags.every(Number.isFinite) && mags[0] < mags[1] && mags[1] < mags[2]);
  ck(`... and going down after them is the strongest frame (${down?.kind} ${down?.magnitude})`, down?.kind === "ko" && down.magnitude >= 1.35 && down.magnitude > Math.max(...mags));
  let top = 0;
  for (const kind of ["hit", "heavy", "stress", "out"]) for (let s = 0; s <= 4; s++) for (const amt of [0, 0.5, 1]) for (const doubled of [false, true]) top = Math.max(top, P.impactOf({ kind, amt }, s, { doubled })?.magnitude ?? 0);
  ck(`no blow but going down reaches the whole set, whatever the series (${top})`, top < 1.35);
  /* an NPC hand-edited to 0 with nothing announced: the table only saw a blow, so the impact does not say "down" (it would reveal Health) */
  const npc = mk("S2", "npc", 8, 6, { x: 900, y: 400 });
  Hooks.callAll("canvasReady");
  set(npc, "health", 0); const quiet = (await take(1500))[0]?.spec;
  ck(`an NPC's unannounced fall to 0: an ordinary blow's impact, nothing that reveals its Health (${quiet?.kind} ${quiet?.magnitude})`, quiet?.kind === "hit" && quiet.magnitude < 1.35);
  ck("going down always does", [0, 0.3, 1].every((amt) => P.impactOf({ kind: "down", amt }, 0).magnitude >= 1.35));
  ck("healing, getting up, regaining, spent stress: no impact frame", ["heal", "back", "regain", "steady", "spent"].every((k) => P.impactOf({ kind: k, amt: 1 }, 0) === null));
}

/* ---- a crowd (an area attack): one impact, on the worst blow */
{ reset();
  const a = mk("X1", "npc", 8, 6, { x: 300, y: 400 }), b = mk("X2", "npc", 8, 6, { x: 600, y: 400 }), c = mk("X3", "npc", 8, 6, { x: 900, y: 400 });
  Hooks.callAll("canvasReady");
  damage("X2", 8, { seq: 901 }); Hooks.callAll(TAC, { type: "broken", target: "cX2", combat: "C1", fight: "F", seq: 902 });
  set(a, "health", 7); set(b, "health", 0, { ipuTactics: true }); set(c, "health", 6);
  const im = await take(1800);
  ck(`a crowd of three blows: one impact (${im.length})`, im.length === 1);
  ck(`... on the worst (${im[0]?.spec?.subject?.id} ${im[0]?.spec?.kind})`, im[0]?.spec?.subject === b && im[0].spec.kind === "ko");
}

/* ---- calm: reduced motion is handed in as true */
{ reset();
  const t = mk("R", "npc", 8, 6, { x: 600, y: 400 });
  Hooks.callAll("canvasReady"); reducedOS = true;
  set(t, "health", 5);
  const s = (await take())[0]?.spec;
  ck(`reduced motion on this client: the impact is asked for calm (reduced: ${s?.reduced})`, s?.reduced === true);
}

/* ---- the real guard over the specs this caller makes (plan.mjs, the engine's own: nothing here can bypass it) */
{ const { planImpact, safety } = await import("../letters/impact/plan.mjs");
  const specs = [];
  for (const kind of ["hit", "heavy", "stress", "out", "down"]) for (let s = 0; s <= 4; s++) for (const amt of [0, 1]) specs.push(P.impactOf({ kind, amt }, s, {}));
  let fullOff = 0, stillOne = 0, guarded = 0;
  for (const sp of specs) {
    const off = safety(planImpact(sp), { flashes: false }, { flashLog: [], now: 0 });
    if (off.mode === "local" && off.frames.every((x) => !x.full && !x.stop)) fullOff++;
    const red = safety(planImpact({ ...sp, reduced: true }), {}, { callerReduced: true, flashLog: [], now: 0 });
    if (red.mode === "static" && red.frames.length === 1 && red.frames[0].punch === 0) stillOne++;
    const log = [];
    const g = safety(planImpact(sp), {}, { flashLog: log, now: 0, t0: 0 });
    if (g.frames.filter((x) => x.full).length <= 2) guarded++;
  }
  ck(`flashes off: every impact of the token reactions is the gentle variant, no full-field frame, no hold (${fullOff}/${specs.length})`, fullOff === specs.length);
  ck(`reduced motion: one still drawing (${stillOne}/${specs.length})`, stillOne === specs.length);
  ck(`the guard on (default): at most two full-field frames per impact (${guarded}/${specs.length})`, guarded === specs.length);
}

/* ---- the source: L.impact is called (it was not before WIRE1) and never in a loop or on a timer of its own */
{ const src = (await import("node:fs")).readFileSync(new URL("../tokenreact/main.mjs", import.meta.url), "utf8");
  ck("main.mjs calls the engine's impact frames", /I\.play\(spec\)/.test(src) && /L\?\.impact/.test(src));
  ck("... never on an interval", !/setInterval\([^)]*impact/i.test(src));
}
console.log(`sweep wire1-tokenreact: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
