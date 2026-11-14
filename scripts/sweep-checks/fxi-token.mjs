// node scripts/sweep-checks/fxi-token.mjs  (FXI-TOKEN: the token reactions' fixes after the blind review ADVI: findings 1, 2, 3, 5, 8, 13,
// 15, 16). The harness is wire1-tokenreact's fake Foundry; the engine is a recording stand-in whose words carry a real-shaped entrance
// (a contact drawing) and whose L.impact records its calls and plans. Every check names the finding it guards (I<n> = ADVI finding n) and
// fails on tactics @ eb1dda6 (tactics-integrated-116).
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

/* ---- I1: a series with the system's Damage Taken cards, posted before each loss (the review's order): every loss keeps its own card */
{ const S = await seats(() => mk("MA", "npc", 12, 6, { x: 600, y: 400, hm: 12 }), async (t) => {
    card(t, 2); set(t, "health", 10, {}, 81001); await sleep(1100);
    card(t, 4); set(t, "health", 6, {}, 81002); await sleep(1800);
    card(t, 5, true); set(t, "health", 0, {}, 81003);
  }, 2600);
  const nums = (r) => r.words.filter((w) => isNum(w.text)).map((w) => w.text);
  ck(`I1 the player sees each blow's told number: -2, -4, -5 (${nums(S.player).join(" ")})`, nums(S.player).join(" ") === "-2 -4 -5");
  const sig = (r) => r.im.map((x) => `${x.spec.kind} ${x.spec.magnitude} ${x.spec.seed}`).join(" | ");
  ck(`I1 GM and player: the same three impacts (GM ${sig(S.gm)} / player ${sig(S.player)})`, S.gm.im.length === 3 && sig(S.gm) === sig(S.player));
  ck(`I1 the third card's knock-down is a knock-out frame on both seats (${S.gm.im[2]?.spec.kind} / ${S.player.im[2]?.spec.kind})`, S.gm.im[2]?.spec.kind === "ko" && S.player.im[2]?.spec.kind === "ko");
}
/* ---- I1: the system's own order: Health first, the card after it (a critical injury's roll and table draw first: 300 ms) */
{ const S = await seats(() => mk("MB", "npc", 8, 6, { x: 600, y: 400 }), async (t) => {
    set(t, "health", 5, {}, 81101); await sleep(40); card(t, 3); await sleep(2000);
    set(t, "health", 0, {}, 81102); await sleep(300); card(t, 7, true);
  }, 2600);
  ck(`I1 a fall to 0 whose card (critical injury) comes 300 ms after it: the knock-out frame on both seats (${S.gm.im.map((x) => x.spec.kind)} / ${S.player.im.map((x) => x.spec.kind)})`,
    S.gm.im[1]?.spec.kind === "ko" && S.player.im[1]?.spec.kind === "ko");
  ck("I1 ... and the player gets both told numbers", S.player.words.filter((w) => isNum(w.text)).map((w) => w.text).join(" ") === "-3 -7");
}
/* ---- I1 / I8: a card that arrives while the reaction waits for the roll's story still joins it */
{ const landed = {};
  const S = await seats(() => mk("MC", "npc", 8, 6, { x: 600, y: 400 }), async (t) => {
    const id = `roll-${game.user.isGM}`; Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "start", id });
    set(t, "health", 4, {}, 81201); await sleep(500);
    card(t, 4); await sleep(200);
    landed[game.user.isGM ? "gm" : "player"] = performance.now(); Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "land", id, landAt: performance.now(), impactMs: 300 });
  }, 1800);
  ck(`I1 a card during the wait for the roll's story joins its loss (player's number ${S.player.words.filter((w) => isNum(w.text)).map((w) => w.text)})`, S.player.words.some((w) => w.text === "-4"));
  ck(`I1 ... and its impact on both seats is the told heavy blow (${S.gm.im[0]?.spec.kind} / ${S.player.im[0]?.spec.kind})`, S.gm.im[0]?.spec.kind === "heavy" && S.player.im[0]?.spec.kind === "heavy");
  /* I8: the story order: the target answers after the roll's result has struck and its impact played */
  const landAt = landed.player;
  ck(`I8 the target's blow comes after the roll's landing and its impact (${Math.round(S.player.im[0]?.spec.startAt - landAt)} ms after the landing)`, S.player.im[0]?.spec.startAt >= landAt + 300);
  for (const id of ["roll-true", "roll-false"]) Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "done", id });
}
/* ---- I8: an impact frame still playing (the roll's) is let finish before the blow's own */
{ reset(); const t = mk("BZ", "npc", 8, 6, { x: 600, y: 400 }); Hooks.callAll("canvasReady");
  const t0 = performance.now(); busyUntil = t0 + 400;
  set(t, "health", 5, {}, 81301);
  const { im } = await take(1400);
  ck(`I8 the roll's impact still playing: the blow's waits for it (${Math.round(im[0]?.spec.startAt - busyUntil)} ms after it ended)`, im[0] && im[0].spec.startAt >= busyUntil);
  busyUntil = 0;
}

/* ---- I2 / I13: the impact on the word's strike, and one instant on every seat although the seats letter different words */
{ const S = await seats(() => mk("MD", "npc", 8, 6, { x: 600, y: 400 }), async (t) => { set(t, "health", 4, {}, 81401); }, 1500);
  for (const who of ["gm", "player"]) {
    const w = S[who].words.find((x) => !isNum(x.text)), im = S[who].im[0];
    const c = w && P.contactMs(w.h.plan.timeline);
    /* FIN-CALLERS: the impact's contact drawing = its start + its own build (the gathering lines before it), as the roll splash reads it */
    const lead = im ? P.leadMs(planImpact({ ...im.spec, reduced: false }).frames) : 0;
    ck(`I2 ${who}: the impact's contact drawing falls on the drawing where the word strikes (word start + its contact ${Math.round(c)} ms; impact build ${lead} ms; off by ${Math.round(im?.spec.startAt + lead - w?.o.startAt - c)} ms)`, !!w && !!im && Math.abs(im.spec.startAt + lead - w.o.startAt - c) < 2);
    const num = S[who].words.find((x) => isNum(x.text));
    if (num) ck(`I2 ${who}: its number pops after the strike (${Math.round(num.o.startAt - im.spec.startAt)} ms)`, num.o.startAt >= im.spec.startAt + 100);
  }
  const wg = S.gm.words.find((x) => !isNum(x.text)), wp = S.player.words.find((x) => !isNum(x.text));
  const cg = P.contactMs(wg.h.plan.timeline), cp = P.contactMs(wp.h.plan.timeline);
  const dg = S.gm.im[0].spec.startAt - S.gm.t0, dp = S.player.im[0].spec.startAt - S.player.t0;
  ck(`I13 GM and player letter different words (${wg.text} contact ${Math.round(cg)} / ${wp.text} contact ${Math.round(cp)} ms) and the blow lands at one instant (${Math.round(dg)} / ${Math.round(dp)} ms after the change)`,
    wg.text !== wp.text && Math.abs(dg - dp) < 25);
  ck(`I2 the blow lands soon after the change (${Math.round(dp)} ms: gathering + the lead)`, dp < 500);
}
/* the same blow with a contact longer and shorter than the other seat's (pure): every word strikes on the one instant */
{ const T = 1000, starts = [SLAM, POP].map((ent) => T - P.contactMs({ ent }));
  ck(`I13 two entrances, one strike: slam starts ${T - starts[0]} ms and pop ${T - starts[1]} ms before the instant, both within the lead (${P.HIT_LEAD} ms)`, starts.every((s) => T - s <= P.HIT_LEAD) && starts[0] !== starts[1]);
  ck("I2 the contact is where the word strikes (as the roll splash reads it): the burst or the landing's dust (the squash), else the flash; the engine's plan.contactMs first", P.contactMs({ timeline: { ent: SLAM }, contactMs: 77 }) === 77 && P.contactMs({ ent: [{ ticks: 2 }, { ticks: 1, impact: true }, { ticks: 2 }] }) === 2 * P.TICK_MS && P.contactMs({ ent: SLAM }) === 5 * P.TICK_MS && P.contactMs({ ent: POP }) === 2 * P.TICK_MS && P.contactMs({ ent: [{ ticks: 4 }, { ticks: 2, fx: [{ k: "dust" }] }] }) === 4 * P.TICK_MS && P.contactMs({ ent: SLAM }, true) === 0);
}

/* ---- I3: the blows build: a scratch is not a knock-down, every rung is other drawings, a series climbs */
{ const R = P.RUNGS.map((r) => frames(r));
  ck(`I3 every rung of the ladder is other drawings (${R.join(" / ")})`, new Set(R).size === R.length);
  const scratch = P.impactOf({ kind: "hit", amt: 0.1, known: true }, 0);
  ck(`I3 a -1 scratch: two small local drawings, no whole-view black and white (${frames(scratch)})`, !/ink|slam|shadow|glare|swap|window|tear|shatter/.test(frames(scratch)));
  ck("I3 a -1 scratch is not a -15 (of 22)", frames(scratch) !== frames(P.impactOf({ kind: "heavy", amt: 1, known: true }, 0)));
  const un = P.impactOf({ kind: "hit", amt: 0.3, known: false }, 0);
  ck(`I3 a blow nobody was told the size of (an NPC by hand) is a scratch: it may not say more (${un.kind} ${un.magnitude})`, un.magnitude < 0.35);
  const ser = [0, 1, 2].map((s) => P.impactOf({ kind: "hit", amt: 0.3, known: false }, s));
  ck(`I3 a series of three: three different drawings, each stronger (${ser.map((x) => `${x.kind} ${x.magnitude}`).join(" < ")})`, new Set(ser.map(frames)).size === 3 && ser[0].magnitude < ser[1].magnitude && ser[1].magnitude < ser[2].magnitude);
  const hero = [P.impactOf({ kind: "hit", amt: 0.1, known: true }, 0), P.impactOf({ kind: "hit", amt: 0.1, known: true }, 1), P.impactOf({ kind: "heavy", amt: 0.3, known: true }, 2), P.impactOf({ kind: "down", amt: 1 }, 3)];
  ck(`I3 a hero's -1, -1, -3, down: scratch, blow, crushing, knock-out (${hero.map((x) => `${x.kind} ${x.magnitude}`).join(", ")})`, hero[0].magnitude < 0.35 && hero[1].magnitude >= 0.35 && hero[2].magnitude >= 1.25 && hero[3].kind === "ko" && hero[3].magnitude >= 1.35);
  ck("I3 the strongest moment gets the strongest frame: a knock-out outlasts every blow", planImpact(P.impactOf({ kind: "down", amt: 0 }, 0)).ticks >= Math.max(...P.RUNGS.map((r) => planImpact(r).ticks)));
  /* live path: an NPC's -1 by hand gives the scratch on both seats */
  const S = await seats(() => mk("ME", "npc", 8, 6, { x: 600, y: 400 }), async (t) => { set(t, "health", 7, {}, 81501); }, 1300);
  ck(`I3 an NPC -1 by hand: a scratch on both seats (${S.gm.im[0]?.spec.magnitude} / ${S.player.im[0]?.spec.magnitude})`, S.gm.im[0]?.spec.magnitude < 0.35 && S.player.im[0]?.spec.magnitude < 0.35);
}

/* ---- I5 / I16: the word beside its token, never over it for its hold, smaller rather than on a neighbour or under the interface */
{ const tok = { x: 700, y: 400, w: 100, h: 100 }, box = { w: 520, h: 150 }, safe = { l: 0, t: 0, r: 1600, b: 900 };
  /* neighbours left, right and below, a panel above: every full-size side is taken */
  const blocked = [{ x: 560, y: 400, w: 100, h: 100, k: P.SLOT_K.token }, { x: 840, y: 400, w: 100, h: 100, k: P.SLOT_K.token }, { x: 700, y: 540, w: 100, h: 100, k: P.SLOT_K.token },
    { x: 380, y: 160, w: 840, h: 120, k: P.SLOT_K.panel }];
  const fit = P.fitSlot(tok, box, safe, blocked);
  const r = (() => { const b = { w: box.w * fit.k, h: box.h * fit.k }, c = P.slotPoint(fit.slot, tok, b); return { x: c.x - b.w / 2, y: c.y - b.h / 2, w: b.w, h: b.h }; })();
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  ck(`I5 a big word with every side taken: not on its token (${fit.slot} at ${fit.k})`, fit.slot !== "on" && inter(r, tok) <= 0.2 * tok.w * tok.h);
  ck(`I5 ... it takes a side smaller instead of covering a neighbour or the panel (${Math.round(blocked.reduce((a, b) => a + inter(r, b), 0))} px² covered)`, fit.k < 1 && blocked.reduce((a, b) => a + inter(r, b), 0) <= 0.1 * r.w * r.h);
  ck("I5 the slot over the own token is never chosen", (() => { for (let i = 0; i < 200; i++) { const t = { x: (i * 97) % 1500, y: (i * 53) % 800, w: 100, h: 100 }; if (P.fitSlot(t, { w: 300 + (i % 7) * 80, h: 120 }, safe, blocked).slot === "on") return false; } return true; })());
  ck("I5 the own token costs nearly as much as another token (words must not hide it)", P.SLOT_K.own >= 0.75 * P.SLOT_K.token);
  /* a series: the grown word leaves a side it no longer fits */
  const side = { x: 1010, y: 380, w: 100, h: 100, k: P.SLOT_K.token };
  const grown = P.fitSlot(tok, { w: 420, h: 140 }, safe, [side], { keep: "right" });
  ck(`I5 a series keeps its side only while the grown word still fits there (${grown.slot})`, grown.slot !== "right" && P.fitSlot(tok, { w: 200, h: 90 }, safe, [], { keep: "right" }).slot === "right");
  /* I16: a token in the top-left corner under the controls: the word stands by it, not ~300 px away */
  const corner = { x: 30, y: 30, w: 100, h: 100 }, safe2 = { l: 70, t: 60, r: 1300, b: 840 };
  const fc = P.fitSlot(corner, { w: 480, h: 150 }, safe2, []), bc = { w: 480 * fc.k, h: 150 * fc.k }, pc = P.slotPoint(fc.slot, corner, bc);
  const clamped = P.clampInto(pc, bc, safe2), moved = Math.hypot(clamped.x - pc.x, clamped.y - pc.y);
  ck(`I16 a token in the corner under the controls: its word fits by it (${fc.slot} at ${fc.k}, pushed ${Math.round(moved)} px by the view's edge)`, moved < 60);
}
/* ---- I5: live, the reaction's word is placed beside its token among neighbours (not "on") */
{ reset();
  const t = mk("MF", "npc", 12, 6, { x: 700, y: 400, hm: 12 });
  mk("N1", "npc", 8, 6, { x: 590, y: 400 }); mk("N2", "npc", 8, 6, { x: 810, y: 400 }); mk("N3", "npc", 8, 6, { x: 700, y: 510 });
  Hooks.callAll("canvasReady");
  set(t, "health", 2, {}, 81601);
  const { words } = await take(1400);
  const w = words.find((x) => !isNum(x.text));
  const at = w && (typeof w.o.at === "function" ? w.o.at() : null);
  ck(`I5 a heavy blow among three neighbours: its word's centre is off its token (${at ? `${Math.round(at.x)},${Math.round(at.y)}` : "none"})`, !!at && !(at.x > 700 && at.x < 800 && at.y > 400 && at.y < 500));
}

/* ---- I15: seven at once: three words, and the others strike after the worst one's impact (not under its full-view frames) */
{ reset();
  const ts = [0, 1, 2, 3, 4, 5, 6].map((i) => mk(`X${i}`, "npc", 8, 6, { x: 200 + i * 180, y: 400 }));
  Hooks.callAll("canvasReady");
  combat.combatants.forEach(() => {});
  Hooks.callAll("invincible-plus-ultra.tactics", { type: "broken", target: "cX3", combat: "C1", fight: "F", seq: 9001 });
  ts.forEach((t, i) => set(t, "health", i === 3 ? 0 : 6, i === 3 ? { ipuTactics: true } : {}, 81700 + i));
  const { words, im } = await take(2200);
  const full = words.filter((x) => !isNum(x.text));
  ck(`I15 seven blows at once: three keep a word (${full.length})`, full.length === 3);
  const imp = im[0], ms = imp ? planImpact(imp.spec).ms : 0;
  const rest = words.filter((x) => x.o.token?.id !== imp?.spec.subject?.id);
  ck(`I15 one impact, on the knock-down (${im.length}, ${imp?.spec.kind})`, im.length === 1 && imp.spec.kind === "ko");
  ck(`I15 the other reactions start after its drawings (${Math.round(Math.min(...rest.map((x) => x.o.startAt)) - imp?.spec.startAt)} ms after it, its drawings ${Math.round(ms)} ms)`, rest.length > 0 && rest.every((x) => x.o.startAt >= imp.spec.startAt + Math.min(500, ms) - 260));
}
/* ---- I8: the splash may make room: the blow's instant is announced */
ck(`I8 every moment announces its blow's instant and tokens (${reacted.length} announcements)`, reacted.length > 0 && reacted.filter((d) => d.phase !== "place").every((d) => d.phase === "hit" && Number.isFinite(d.at) && Array.isArray(d.ids)));   // FIN-CALLERS: "place" asks where the splash stands
{ const src = (await import("node:fs")).readFileSync(new URL("../tokenreact/main.mjs", import.meta.url), "utf8");
  ck("I8 the splash's announcements are heard (invincible-plus-ultra.splashMoment)", /splashMoment/.test(src) && /Hooks\.on\(SPLASH_HOOK, onSplash\)/.test(src));
  ck("never a timer or a loop of impacts", !/setInterval\([^)]*impact/i.test(src)); }
console.log(`sweep fxi-token: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
