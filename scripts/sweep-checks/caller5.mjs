import "../tokenreact/impact-node-prime.mjs";      // the vendored engine's impact table for pure.mjs (on a page: the running engine's L.impact)
// node scripts/sweep-checks/caller5.mjs  (CALLER5, 2026-11-15: plus-ultra's impact-frame callers brought to LETR 1.9.23 IMPACT5, contract v26).
//   R  the rung table on the vendored 1.9.23 engine's own plan (what plays), every rung the callers hand in: no rung is a blink, each longer than
//      the one below, the figures and the cut-in (`cu`) on EVERY drawing to the last one (a show for the whole length), the flashes inside the
//      guard; the same call gives the same drawings on every ordinary seat; a photosensitive seat the same length, rims only, no cut-in, no
//      full frame; a reduced-motion seat one still. CALLER5_TABLE=1 prints the table.
//   S  the roll splash: a roll whose impact has no target token stars the ROLLER (`from`, IMPACT5-4) and keeps the word as its subject; the
//      map cut carries figures when the roller stands on the table (shared data); the landing tells the TABLE's impact length (a seat that drew
//      none or a still told 0 / less); the figures are warmed when the moment is known (I.warm).
//   T  the token reactions: a knock-down the fight tells in parts (damage event, then "broken" a few hundred ms later, in either order) is ONE
//      moment with one word and one seed on every seat (IMPCALL2's real fight: two words 17 ms apart, and GM and player got different words);
//      a second DAMAGE event after the moment was gathered is still the next blow (the series is kept).
// T fails on tactics-integrated-150 (two words per seat, the seats' words differ).
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = await import("node:fs");

/* T runs each seat in its own node process (the module's `heard` keeps a fight's event keys for the process: one seat per process, as at a
   real table): `node caller5.mjs seat <gm|player> <damage-first|broken-first>` prints that seat's JSON */
const CHILD = process.argv[2] === "seat";
/* ================================================================== R: the rungs on 1.9.23 */
import * as P from "../tokenreact/pure.mjs";
import * as RG from "../impact-rungs.mjs";
import * as IP from "../splash/impact-plan.mjs";
import { planImpact, isFlash, safety, stepOf, LIMITS } from "../letters/impact/plan.mjs";
const SEEDS = Array.from({ length: 24 }, (_, i) => `c5-${i}`);
const plan = (spec, seed) => planImpact({ ...spec, seed });
const FULL = { impact: "full", flashes: true, motion: "auto" };
const PHOTO = { ...FULL, flashes: false };      // a seat in Foundry's photosensitive mode (seatPrefs: flashes off) = the gentle variant
const seat = (spec, seed, prefs, env = {}) => safety(plan(spec, seed), prefs, { flashLog: [], now: 0, t0: 0, ...env });
const sig = (p) => p.frames.map((x) => `${x.type}:${x.fig ?? ""}:${x.cu ?? ""}:${x.kb ?? ""}:${x.z ?? ""}:${x.full ? 1 : 0}`).join(" ");
const roll = (pw) => IP.impactFor({ power: pw, action: "slugfest" });
const blow = (kind, amt) => P.impactOf({ kind, amt, known: true }, 0);
const ko = blow("down", 0.5);
const ROWS = [
  ["roll", "ordinary success", roll(0.3)], ["roll", "strong result", roll(0.55)], ["roll", "critical at threshold", roll(0.7)], ["roll", "critical top", roll(0.95)],
  ["blow", "scratch (-1 of 8)", blow("hit", 0.125)], ["blow", "blow (-2 of 8)", blow("hit", 0.25)], ["blow", "hard blow (-3 of 8)", blow("heavy", 0.375)],
  ["blow", "heavy (-5 of 8)", blow("heavy", 0.625)], ["blow", "crushing (-7 of 8)", blow("heavy", 0.875)], ["blow", "knock-down", ko],
  ["beat", "knock-down as the roll's 2nd beat", { ...ko, frames: RG.beatFrames(plan(ko, "b").frames) }],
  ...P.CHALLENGE_KINDS.map((k) => ["challenge", k, P.impactOf({ kind: k, amt: 0.5, known: true }, 0)])
];
const table = [];
for (const [grp, name, spec] of CHILD ? [] : ROWS) {
  ck(`R ${name}: a spec`, !!spec);
  if (!spec) continue;
  const { rung: _r, ...s } = spec;
  let tMin = Infinity, tMax = 0, flMax = 0, allFig = true, allCu = true, lastMoves = true, stillSame = true, photoOk = true, still = true, cuTop = 0;
  for (const seed of SEEDS) {
    const p = plan(s, seed);
    tMin = Math.min(tMin, p.ticks); tMax = Math.max(tMax, p.ticks); flMax = Math.max(flMax, p.frames.filter(isFlash).length);
    const live = p.frames.filter((x) => x.type !== "rest");
    if (!live.every((x) => typeof x.fig === "string" && x.fig)) allFig = false;
    if (!live.every((x) => Number.isFinite(x.cu) && x.cu > 0)) allCu = false;
    if (!(live.at(-1)?.cu > 0)) lastMoves = false;
    cuTop = Math.max(cuTop, ...live.map((x) => x.cu ?? 0));
    /* two ordinary seats (any window, any zoom: the plan does not read them) give the same drawings for the same call */
    if (sig(seat(s, seed, FULL)) !== sig(seat(s, seed, { ...FULL }, { now: 5000, t0: 5000 }))) stillSame = false;
    /* a photosensitive seat: the same length, rims only, no cut-in, no full frame, no hit-stop */
    const g = seat(s, seed, PHOTO);
    if (!(g.mode === "local" && g.ticks === p.ticks && g.frames.every((x) => !x.full && !x.stop && (x.fig == null || x.fig === "r") && x.cu == null))) photoOk = false;
    /* a reduced-motion seat: one still drawing at the peak */
    const r = seat(s, seed, FULL, { osReduced: true });
    if (!(r.mode === "static" && r.frames.filter((x) => x.type !== "rest").length === 1 && r.frames.every((x) => !x.punch && !x.stop))) still = false;
  }
  table.push({ grp, name, kind: s.kind, m: s.magnitude, step: stepOf(s.magnitude), own: !!s.frames, tMin, tMax, flMax, cuTop });
  ck(`R ${name}: no blink (at least 6 ticks = 250 ms; ${tMin})`, tMin >= 6);
  ck(`R ${name}: inside the engine's limit (${tMax} <= ${LIMITS.maxTicks} ticks)`, tMax <= LIMITS.maxTicks);
  ck(`R ${name}: at most the guard's two flashes (${flMax})`, flMax <= LIMITS.fullPerImpact);
  ck(`R ${name}: the figures on every drawing`, allFig);
  ck(`R ${name}: the cut-in on every drawing (1.9.23: the star stays the show for the whole length)`, allCu);
  ck(`R ${name}: still moving on its last drawing`, lastMoves);
  ck(`R ${name}: two ordinary seats, the same drawings`, stillSame);
  ck(`R ${name}: a photosensitive seat: same length, rims only, no cut-in, no full frame`, photoOk);
  ck(`R ${name}: a reduced-motion seat: one still drawing`, still);
}
const row = (name) => table.find((r) => r.name === name);
const up = (a, b) => row(a) && row(b) && row(a).tMax < row(b).tMin;
if (!CHILD) {
ck("R roll: ordinary < strong < critical (ticks, every seed)", up("ordinary success", "strong result") && up("strong result", "critical at threshold") && row("critical at threshold").tMax <= row("critical top").tMin);
/* CALLER6 (engine 1.9.24): the blow and the hard blow are the engine's step 2 (10 ticks), the heavy blow its step 3 (11): from the blow up
   a rung is never shorter than the one below (was strictly longer, with the callers' 8 / 9 tick cuts squeezed under step 3) and is told by
   its drawings (impcall2.mjs "each rung adds to the one below") */
const upEq = (a, b) => row(a) && row(b) && row(a).tMax <= row(b).tMin;
ck("R blow: scratch < blow <= hard blow <= heavy <= crushing < knock-down", up("scratch (-1 of 8)", "blow (-2 of 8)") && upEq("blow (-2 of 8)", "hard blow (-3 of 8)") && upEq("hard blow (-3 of 8)", "heavy (-5 of 8)")
  && row("blow (-2 of 8)").flMax < row("hard blow (-3 of 8)").flMax
  && row("heavy (-5 of 8)").tMax <= row("crushing (-7 of 8)").tMax && up("crushing (-7 of 8)", "knock-down"));
ck("R the two lowest rungs never flash", row("ordinary success").flMax === 0 && row("scratch (-1 of 8)").flMax === 0);
ck("R the second beat: the knock-down's length, no flash", row("knock-down as the roll's 2nd beat").flMax === 0 && row("knock-down as the roll's 2nd beat").tMin === plan(ko, "b").ticks);
ck("R the cut-in grows with the rung (ordinary < critical)", row("ordinary success").cuTop < row("critical top").cuTop && row("scratch (-1 of 8)").cuTop <= row("blow (-2 of 8)").cuTop);
/* IMPACT5-3 (a): a seat whose Effects are reduced (the table's, or this seat's photosensitive mode: main.mjs fxLevel) plays the TABLE's impact
   (same kind, strength, cut, length) as the engine's gentle variant */
for (const pw of [0.3, 0.55, 0.7, 0.95]) {
  const a = IP.impactFor({ power: pw, action: "slugfest" }, { fx: 1 }), b = IP.impactFor({ power: pw, action: "slugfest" }, { fx: 0.5 });
  const pa = plan(a, "x"), pb = safety(plan(b, "x"), FULL, { flashLog: [], now: 0, t0: 0, callerGentle: b.gentle });
  ck(`R IMPACT5-3 roll ${pw}: Effects reduced = the table's impact, its length (${pa.ms} / ${pb.ms} ms), gentle`, b.kind === a.kind && b.magnitude === a.magnitude && pb.ms === pa.ms && pb.mode === "local");
}
if (process.env.CALLER5_TABLE) {
  console.log("group | rung | kind m (step) | own cut | ticks (ms) | flashes | cut-in top");
  for (const r of table) console.log(`${r.grp} | ${r.name} | ${r.kind} ${r.m} (${r.step}) | ${r.own ? "caller" : "engine"} | ${r.tMin === r.tMax ? r.tMin : `${r.tMin}-${r.tMax}`} (${Math.round(r.tMin * 1000 / 24)}${r.tMin === r.tMax ? "" : `-${Math.round(r.tMax * 1000 / 24)}`} ms) | ${r.flMax} | ${r.cuTop}`);
}

}
/* ================================================================== S: the roll splash */
if (!CHILD) {
  /* the table's impact length, whatever this seat draws */
  const I = { limits: LIMITS };
  const cut = RG.framesOf(RG.ROLL.strong), rollW = (pw) => IP.impactFor({ power: pw, action: "dodge" });      // CALLER6: the callers' own cut is the roll's that is no blow
  ck("S tableImpactMs: a full / gentle seat reads its plan", RG.tableImpactMs({ mode: "full", ms: 458 }, null, I) === 458 && RG.tableImpactMs({ mode: "local", ms: 375 }, cut, I) === 375);
  ck("S tableImpactMs: the table's impact off: 0 on every seat", RG.tableImpactMs({ mode: "off", ms: 0 }, cut, I) === 0);
  ck("S tableImpactMs: a reduced seat with the caller's own cut counts the cut as the engine does", RG.tableImpactMs({ mode: "static", ms: 125 }, cut, I) === plan(rollW(0.55), "x").ms);
  ck("S tableImpactMs: no plan: none", RG.tableImpactMs(null, cut, I) === null);
  ck("S hasFigures: a target, or the roller on the table", IP.hasFigures(["a"], false) && IP.hasFigures([], true) && !IP.hasFigures([], false) && !IP.hasFigures(null, false));
  /* the map cut of an ordinary / strong result with the roller only: the figures' cut (as with a target), the same drawings on every seat */
  for (const r of ["ordinary", "strong"]) ck(`S map ${r}: the roller on the table gives the figures' cut`, JSON.stringify(IP.mapFrames(0.5, null, { figs: IP.hasFigures([], true), rung: r })) === JSON.stringify(IP.mapFrames(0.5, null, { figs: true, rung: r })));
  const stage = fs.readFileSync(new URL("../splash/stage.mjs", import.meta.url), "utf8");
  ck("S wiring: the roller is passed as `from` also when no target token is the subject", /if \(ctl\.from && ctl\.from !== tok && seesToken\(ctl\.from\)\) s\.from = ctl\.from;/.test(stage) && !/if \(tok && ctl\.from &&/.test(stage));
  ck("S wiring: the map cut's figures from shared data (targets, the roller's token on the table)", /figs: IP\.hasFigures\(ctl\.targets, rollerShared\(ctl\)\)/.test(stage) && /ctl\.rollerId = typeof o\.rollerId/.test(stage) && /rollerId: typeof mo\.o\.rollerId/.test(stage));
  ck("S wiring: the landing tells the table's impact length", /tableMs = IP\.tableImpactMs\(p, ts\.frames, I\)/.test(stage) && /tellLand\(ctl, at, Number\.isFinite\(ctl\.tableImpactMs\) && shot \? Math\.max\(0, ctl\.tableImpactMs - shot\.lead\)/.test(stage));
  ck("S wiring: the figures warmed when the moment is known", /warmFigures\(ctl\);/.test(stage) && /I\.warm\(list\)/.test(stage));
  const main = fs.readFileSync(new URL("../tokenreact/main.mjs", import.meta.url), "utf8");
  ck("S wiring (token reactions): the crowd's rest after the TABLE's impact length; the figures warmed at the gathering", /RG\.tableImpactMs\(pl, isp\.frames, L\.impact\)/.test(main) && /warmFigures\(ready\);/.test(main));
}

/* ================================================================== T: one knock-down told in parts = one moment */
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
const stageV = { scale: { x: 1 }, toGlobal: (p) => ({ x: p.x, y: p.y }), toLocal: (q) => ({ x: q.x, y: q.y }) };
const scene = { id: "S" };
const toks = [];
globalThis.canvas = { ready: true, scene, grid: { size: 100 }, performance: { mode: 2 }, stage: stageV, app: { view: { getBoundingClientRect: () => ({ left: 0, top: 0, right: VW, bottom: VH, width: VW, height: VH }) } },
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
const tac = (ev) => Hooks.callAll("invincible-plus-ultra.tactics", { combat: "C1", fight: "F5", ...ev });
const { sizeFor } = await import("../letters/size.mjs");
const sizeK = (o) => 0.62 + 0.7 * (o?.sound?.loud ?? 0.6);
const ctxOf = (o) => ({ space: "world", magnitude: o.magnitude, scale: o.scale ?? 1, tokenSpan: 100, grid: 100, zoom: 1, vw: VW - 300, vh: VH, sizeK: sizeK(o), aspect: 3 });
const isNum = (t) => /^[+-]\d/.test(String(t));
const plays = [], impacts = [], warmed = [];
const fake = { version: "test", limits: { screen: 16, world: 48 }, ready: async () => true, count: () => 0,
  sizeOf: (text, o) => ({ ...sizeFor(ctxOf(o)), sizeK: sizeK(o) }),
  play: (text, o) => {
    const h = { id: `h${Math.random()}`, hand: "x", alive: true, opts: o, plan: { timeline: { ent: [{ ticks: 2 }, { ticks: 1, fx: [{ k: "burst" }] }, { ticks: 2 }] } }, ready: sleep(30).then(() => true),
      finished: sleep((o.hold ?? 800) + 900).then(() => { h.alive = false; return "done"; }), stop() { h.alive = false; }, moveTo() {} };
    plays.push({ text, o, h, t: performance.now() }); return h;
  },
  impact: {
    busy: false, limits: LIMITS,
    plan: (spec) => planImpact(spec),
    warm: (list) => { warmed.push(...list.map((t) => t.id)); return 0; },
    play(spec) { impacts.push({ spec, t: performance.now() }); return { id: `i${impacts.length}`, alive: true, plan: planImpact(spec), finished: Promise.resolve("done"), ready: Promise.resolve(true), stop() {} }; }
  } };
{ const { createVocab } = await import("../letters/words.mjs"); fake.vocab = createVocab(); fake.word = fake.vocab.word; }
globalThis.MoinenLetters = { copies: [], _engine: fake, async engine() { return this._engine; } };
const M = await import("../tokenreact/main.mjs");
M.start({ init: true, ready: true });
const reset = () => { user.isGM = true; toks.splice(0); combat.combatants.clear(); };
const take = async (ms) => { await sleep(ms); return { words: plays.splice(0).filter((w) => !isNum(w.text)), im: impacts.splice(0) }; };
/* the fight's knock-down: the actor's update + its damage event (seq 19) and its broken event (seq 21) ~300 ms later, while the roll's story
   is still open (the splash has started and not landed: the moment waits, gathered); `order` = which part reaches this seat first */
async function knockDown(who, order, id) {
  reset(); user.isGM = who === "gm";
  const t = mk("SO", "minions", 3, 6, { x: 600, y: 400 });
  Hooks.callAll("canvasReady");
  Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "start", id });
  const dmg = () => { set(t, "health", 0, { ipuTactics: true }, 91000); tac({ type: "damage", target: "cSO", taken: 3, seq: 19 }); };
  const brk = () => tac({ type: "broken", target: "cSO", seq: 21 });
  if (order === "damage-first") { dmg(); await sleep(320); brk(); } else { brk(); await sleep(320); dmg(); }
  await sleep(250);
  Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "land", id, landAt: performance.now(), impactMs: 300 });
  const r = await take(2600);
  Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "done", id });
  return r;
}
if (CHILD) {
  const r = await knockDown(process.argv[3], process.argv[4], `k-${process.argv[3]}`);
  console.log(JSON.stringify({ words: r.words.map((w) => ({ text: w.text, seed: w.o.seed })), im: r.im.map((x) => ({ kind: x.spec.kind, seed: x.spec.seed })), warmed }));
  process.exit(0);
}
{
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const one = (who, order) => { const q = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "seat", who, order], { encoding: "utf8" });
    const line = (q.stdout ?? "").trim().split(/\r?\n/).reverse().find((l) => l.startsWith("{")); try { return JSON.parse(line); } catch { return { words: [], im: [], warmed: [], err: q.stderr }; } };
  const gm = one("gm", "damage-first"), pl = one("player", "broken-first"), pl2 = one("player", "damage-first");
  ck(`T a knock-down told in parts: ONE word on the GM's seat (${gm.words.map((w) => w.text).join(" + ")})`, gm.words.length === 1);
  ck(`T ... ONE word on the player's seat, the parts in the other order (${pl.words.map((w) => w.text).join(" + ")})`, pl.words.length === 1);
  ck(`T ... the same word and seed on both seats, whichever part came first (${gm.words[0]?.text} / ${pl.words[0]?.text} / ${pl2.words[0]?.text})`, [pl, pl2].every((x) => x.words.length === 1 && gm.words.length === 1
    && x.words[0].text === gm.words[0].text && x.words[0].seed === gm.words[0].seed));
  ck(`T ... it is the knock-down (one impact, a knock-out frame, on both seats: ${gm.im.map((x) => x.kind)} / ${pl.im.map((x) => x.kind)})`, gm.im.length === 1 && pl.im.length === 1 && gm.im[0].kind === "ko" && pl.im[0].kind === "ko" && gm.im[0].seed === pl.im[0].seed);
  ck("T ... the struck token's art warmed while the moment waited", gm.warmed.includes("SO") && pl.warmed.includes("SO"));
}
/* a second BLOW (another damage event) after the moment was gathered is still its own, the next of a series */
{
  reset(); const t = mk("SB", "npc", 8, 6, { x: 600, y: 400 }); Hooks.callAll("canvasReady");
  Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "start", id: "s2" });
  set(t, "health", 6, { ipuTactics: true }, 92000); tac({ type: "damage", target: "cSB", taken: 2, seq: 31 });
  await sleep(320);
  set(t, "health", 4, { ipuTactics: true }, 92001); tac({ type: "damage", target: "cSB", taken: 2, seq: 33 });
  await sleep(250);
  Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "land", id: "s2", landAt: performance.now(), impactMs: 300 });
  const r = await take(2600);
  Hooks.callAll("invincible-plus-ultra.splashMoment", { phase: "done", id: "s2" });
  ck(`T two blows (two damage events) stay two reactions, the series kept (${r.words.map((w) => w.text).join(" + ")})`, r.words.length === 2);
}

console.log(`sweep caller5: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
