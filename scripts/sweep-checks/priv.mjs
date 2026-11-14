// node scripts/sweep-checks/priv.mjs  (PRIV: one reaction for every seat that sees the token. The owner, 2026-11-14, asked whether a player
// may keep getting a lighter or other reaction than the GM for an enemy token, answered no; the earlier ruling: GM and players see the same
// moment. So a player seat that SEES the token letters the GM's word, at the GM's size tier, with the GM's token animation and impact, at the
// same instant; only numbers the player may not read stay off his seat, and a token he cannot see still shows him nothing. Review evidence:
// ADVI findings 1 and 13, ADVT2 finding 12.) The harness is fxi-token's fake Foundry and recording engine; the token animation is read from
// scripts/tokenanim/main.mjs (its active layers). The same-reaction checks fail on tactics-integrated-119 (8de90e8); the hidden-token ones hold there too.
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } else if (process.env.LETR_VERBOSE) console.log("ok  ", name); };
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


const TA = await import("../tokenanim/main.mjs");
TA._test.setStarted(true);
const meshOf = () => ({ visible: true, destroyed: false, position: { x: 0, y: 0, set() {} }, scale: { x: 1, y: 1, set() {} }, rotation: 0, tint: 0xffffff });
const anims = (tok) => (TA._test.active.get(tok.id)?.layers ?? []).map((L) => ({ kind: L.kind, anim: L.anim, A: Math.round(L.A * 1e4) / 1e4, step: L.step, dur: Math.round(L.dur), side: L.c?.side, at: L.at }));
/* one scenario on a GM seat and a player seat (the same server stamps); records: words, impacts, the token animation */
async function two(build, run, ms = 1600) {
  const out = {};
  for (const who of ["gm", "player"]) {
    reset(); TA.stopAll(); user.isGM = who === "gm";
    const t = build(); t.mesh = meshOf(); t.visible = t.visible ?? true;
    Hooks.callAll("canvasReady");
    const t0 = performance.now();
    await run(t);
    const r = await take(ms);
    out[who] = { ...r, t0, anim: anims(t), tok: t };
  }
  return out;
}
const word = (r) => r.words.find((x) => !isNum(x.text));
const nums = (r) => r.words.filter((x) => isNum(x.text)).map((x) => x.text);
const look = (w) => w && JSON.stringify({ text: w.text, mood: w.o.mood, mag: w.o.magnitude, rot: w.o.rotation, hold: w.o.hold, in: w.o.in, hk: w.o.holdKind, out: w.o.out, loud: w.o.sound?.loud, colors: w.o.colors, scale: Math.round((w.o.scale ?? 0) * 1000) });
const imp = (r) => r.im[0] && JSON.stringify({ kind: r.im[0].spec.kind, m: r.im[0].spec.magnitude, s: r.im[0].spec.series ?? 0, tone: r.im[0].spec.tone ?? null, seed: r.im[0].spec.seed });
const anim = (r) => r.anim[0] && JSON.stringify({ ...r.anim[0], at: undefined });
const same = (S, name) => {
  const g = S.gm, p = S.player, wg = word(g), wp = word(p);
  ck(`${name}: the same word on both seats (GM ${wg?.text} / player ${wp?.text})`, !!wg && !!wp && wg.text === wp.text);
  ck(`${name}: the same size tier and motion of the word (${look(wg) === look(wp) ? "equal" : `GM ${look(wg)} / player ${look(wp)}`})`, !!wg && look(wg) === look(wp));
  /* seen live (lane 5): the GM's group held a number the player's did not, so the GM's word took a smaller fit and another place; the room for
     the reader's numbers is planned on every seat now */
  const at = (w) => { try { const q = typeof w?.o.at === "function" ? w.o.at() : null; return q ? `${Math.round(q.x)},${Math.round(q.y)}` : null; } catch { return null; } };
  ck(`${name}: the word stands at the same place on both seats (GM ${at(wg)} / player ${at(wp)})`, !!at(wg) && at(wg) === at(wp));
  ck(`${name}: the same impact frame (GM ${imp(g)} / player ${imp(p)})`, !!imp(g) && imp(g) === imp(p));
  ck(`${name}: the same token animation (GM ${anim(g)} / player ${anim(p)})`, !!anim(g) && anim(g) === anim(p));
  const dg = impBlow(g.im[0]?.spec) - g.t0, dp = impBlow(p.im[0]?.spec) - p.t0, ag = (g.anim[0]?.at ?? NaN) - g.t0, ap = (p.anim[0]?.at ?? NaN) - p.t0;
  ck(`${name}: the same instant: the blow ${Math.round(dg)} / ${Math.round(dp)} ms, the token's move ${Math.round(ag)} / ${Math.round(ap)} ms after the change`, Math.abs(dg - dp) < 25 && Math.abs(ag - ap) < 25 && Math.abs(ag - dg) < 2);
};

/* 1: an enemy hit by hand, -4 of 8 (no card, no fight event): the GM's heavy blow on the player's seat too; the number is the GM's alone */
{ const S = await two(() => mk("E1", "npc", 8, 6, { x: 600, y: 400 }), async (t) => { set(t, "health", 4, {}, 91001); });
  same(S, "P1 enemy hit by hand");
  ck(`P1 ... it is the heavy blow (${S.gm.anim[0]?.kind} / ${S.player.anim[0]?.kind})`, S.player.anim[0]?.kind === "heavy" && S.player.im[0]?.spec.kind === "heavy");
  ck(`P1 ... the GM reads -4, the player no number: nobody told the table (${nums(S.gm)} / ${nums(S.player)})`, nums(S.gm).join() === "-4" && nums(S.player).length === 0);
}
/* 2: an enemy knocked down by hand (to 0, no card): the knock-down on both seats */
{ const S = await two(() => mk("E2", "npc", 8, 6, { x: 600, y: 400 }), async (t) => { set(t, "health", 0, {}, 91002); }, 2000);
  same(S, "P2 enemy knocked down");
  ck(`P2 ... it is the knock-down with its knock-out frame (${S.player.anim[0]?.kind} ${S.player.im[0]?.spec.kind})`, S.player.anim[0]?.kind === "down" && S.player.im[0]?.spec.kind === "ko");
  ck(`P2 ... the number stays the GM's (${nums(S.gm)} / ${nums(S.player)})`, nums(S.gm).join() === "-8" && nums(S.player).length === 0);
}
/* 3: a late Damage Taken card (posted 700 ms after the loss, while the reaction stands): the reaction is not re-lettered, the told number
      joins the player's seat; both seats' word, animation and impact stay one */
{ const S = await two(() => mk("E3", "npc", 8, 6, { x: 600, y: 400 }), async (t) => { set(t, "health", 5, {}, 91003); await sleep(700); card(t, 3); }, 1500);
  same(S, "P3 late damage card");
  ck(`P3 ... one word on each seat, not two (${S.gm.words.filter((x) => !isNum(x.text)).length} / ${S.player.words.filter((x) => !isNum(x.text)).length})`, S.gm.words.filter((x) => !isNum(x.text)).length === 1 && S.player.words.filter((x) => !isNum(x.text)).length === 1);
  ck(`P3 ... the told number reaches the player late, the GM keeps his (${nums(S.gm)} / ${nums(S.player)})`, nums(S.gm).join() === "-3" && nums(S.player).join() === "-3");
  ck(`P3 ... one impact per seat (${S.gm.im.length} / ${S.player.im.length})`, S.gm.im.length === 1 && S.player.im.length === 1);
}
/* 3b: a knock-down whose card comes late with the critical injury (the system's order): one knock-down, the card's number on the player's */
{ const S = await two(() => mk("E3b", "npc", 8, 6, { x: 600, y: 400 }), async (t) => { set(t, "health", 0, {}, 91013); await sleep(600); card(t, 8, true); }, 2000);
  same(S, "P3b late card with a knock-down");
  ck(`P3b ... the player gets the told -8 (${nums(S.player)})`, nums(S.player).join() === "-8");
}
/* 4: an enemy's Resolve changed by hand: the GM's stress on the player's seat (it was nothing), no number */
{ const S = await two(() => mk("E4", "npc", 8, 6, { x: 600, y: 400 }), async (t) => { set(t, "resolve", 3, {}, 91004); });
  same(S, "P4 enemy stress by hand");
  ck(`P4 ... no number on the player's seat (${nums(S.gm)} / ${nums(S.player)})`, nums(S.gm).join() === "-3" && nums(S.player).length === 0);
}
/* 5: a series of three hand blows on one enemy: the same series (word steps, impact rungs) on both seats */
{ const S = await two(() => mk("E5", "npc", 12, 6, { x: 600, y: 400, hm: 12 }), async (t) => { set(t, "health", 11, {}, 91051); await sleep(900); set(t, "health", 9, {}, 91052); await sleep(900); set(t, "health", 4, {}, 91053); }, 1600);
  const ws = (r) => r.words.filter((x) => !isNum(x.text)).map((x) => x.text).join(" ");
  ck(`P5 a series: the same words (${ws(S.gm)} / ${ws(S.player)})`, S.gm.words.length > 0 && ws(S.gm) === ws(S.player) && ws(S.gm).split(" ").length === 3);
  const ims = (r) => r.im.map((x) => `${x.spec.kind} ${x.spec.magnitude} ${x.spec.series ?? 0}`).join(" | ");
  ck(`P5 ... the same impacts (${ims(S.gm)} / ${ims(S.player)})`, S.gm.im.length === 3 && ims(S.gm) === ims(S.player));
}
/* 6: a crowd of five enemies hit by hand: the same words and staging per token on both seats */
{ const S = await two(() => { const ts = [0, 1, 2, 3, 4].map((i) => mk(`K${i}`, "npc", 8, 6, { x: 150 + i * 260, y: 400 })); return ts[0]; },
    async () => { toks.forEach((t, i) => set(t, "health", [6, 3, 7, 0, 5][i], {}, 91060 + i)); }, 2400);
  const per = (r) => r.words.filter((x) => !isNum(x.text)).map((x) => `${x.o.token?.id}:${x.text}:${Math.round((x.o.scale ?? 0) * 100)}`).sort().join(" ");
  ck(`P6 a crowd: the same word per token and the same staging on both seats (${per(S.gm) === per(S.player) ? per(S.gm) : `GM ${per(S.gm)} / player ${per(S.player)}`})`, per(S.gm).length > 0 && per(S.gm) === per(S.player));
  ck(`P6 ... one impact, the same (${imp(S.gm)} / ${imp(S.player)})`, S.gm.im.length === 1 && imp(S.gm) === imp(S.player));
}
/* 7: never what the seat cannot see: a token hidden by the GM, and one out of the player's sight */
{ const S = await two(() => mk("H1", "npc", 8, 6, { x: 600, y: 400, hidden: true }), async (t) => { set(t, "health", 0, {}, 91007); await sleep(500); card(t, 8, true); }, 2000);
  ck(`P7 a hidden token: the GM gets his reaction (${S.gm.words.length} words, ${S.gm.im.length} impact)`, S.gm.words.length > 0 && S.gm.im.length === 1);
  ck(`P7 ... the player nothing: no word, no number, no impact, no token animation (${S.player.words.length} / ${S.player.im.length} / ${S.player.anim.length})`, S.player.words.length === 0 && S.player.im.length === 0 && S.player.anim.length === 0);
  const S2 = await two(() => { const t = mk("H2", "npc", 8, 6, { x: 600, y: 400 }); if (!game.user.isGM) { t.isVisible = false; t.visible = false; } return t; }, async (t) => { set(t, "health", 4, {}, 91008); });
  ck(`P7 a token out of the player's sight: nothing on his seat (${S2.player.words.length} / ${S2.player.im.length} / ${S2.player.anim.length}), the GM's as before (${S2.gm.words.length})`, S2.player.words.length === 0 && S2.player.im.length === 0 && S2.player.anim.length === 0 && S2.gm.words.length > 0);
}
/* 7b: a token the GM hid stands right above the target: it is no obstacle on the GM's seat either, so the word stands alike on both seats */
{ const S = await two(() => { for (const [i, [x, y]] of [[600, 250], [730, 250], [470, 250], [730, 380]].entries()) mk(`HX${i}`, "npc", 8, 6, { x, y, hidden: true }); return mk("E7", "npc", 8, 6, { x: 600, y: 400 }); }, async (t) => { set(t, "health", 0, {}, 91071); }, 2000);
  same(S, "P7b beside a hidden token");
}
/* 8: source pins: the impact follows the shared reaction, the crowd stages on numbers every seat shows */
{ const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../tokenreact/main.mjs", import.meta.url), "utf8");
  ck("P8 the impact follows the shared reaction (main.mjs build: got.pub from the seat's shared kind, known)", /got\.pub = \{ kind: a\.kind, amt: P\.amountOf\(a, c\), known: true/.test(src));
  ck("P8 the crowd stages on numbers every seat shows (hasNum: !!pubNum)", /hasNum: !!pubNum/.test(src));
}
console.log(`sweep priv: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
