// node scripts/sweep-checks/gore.mjs  (GORE: blood and cracks on the screen, pixel art; the owner 2026-11-15: blood when a character is hurt,
// it must arrive "jak chlapanie", like a splash; a second effect, cracks).
// Pure part (scripts/gore/plan.mjs, raster.mjs): the change -> effect rule, the grid (whole device px per art px at every DPR), the splash
// arrives in one tick at full alpha (no fade-in) and moves smear -> squash -> settle, spatter lands by distance, drips run down, it dries,
// it dissolves to nothing; every pixel one palette colour (no gradient); the same seed draws the same picture; the photosensitive palette
// has no saturated red and its splash stays under the safe area; big arrivals keep <= 2 a second; the readable middle; reduced motion =
// stills; cracks race out, glint, retract to nothing; the cost of a frame.
// Runtime on a fake Foundry (scripts/gore/main.mjs): a Health drop plays blood on the token reaction's blow (or after the wait when the
// reactions are off), Resolve plays cracks, a pushed roll's stress none, a hidden token nothing on a player's seat, "owners" only on
// the owner's seat, the table's 0 = none, a heal nothing; the settings are world and hidden from Foundry's list; the window has the tab.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const dir = dirname(fileURLToPath(import.meta.url)), root = join(dir, "..");
const P = await import("../gore/plan.mjs");
const R = await import("../gore/raster.mjs");

/* ---------------- the rule ---------------- */
{
  const e = (c) => P.effectOf({ max: 6, type: "character", ...c });
  ck("a Health drop = blood", e({ stat: "health", from: 5, to: 3 })?.kind === "blood");
  ck("a Resolve drop = cracks", e({ stat: "resolve", from: 5, to: 3 })?.kind === "cracks");
  ck("stress the character chose (a push) = nothing", e({ stat: "resolve", from: 5, to: 4, push: true }) === null);
  ck("a heal, no change = nothing", e({ stat: "health", from: 3, to: 5 }) === null && e({ stat: "health", from: 3, to: 3 }) === null);
  ck("a challenge (its Health is its Challenge Rating) never bleeds or cracks", P.effectOf({ stat: "health", from: 5, to: 2, max: 6, type: "challenge" }) === null);
  ck("a vehicle's Health drop = cracks, never blood", P.effectOf({ stat: "health", from: 5, to: 2, max: 6, type: "vehicle" })?.kind === "cracks");
  ck("a knock-down (0 Health) = the strongest blood", e({ stat: "health", from: 2, to: 0 }).strength === 1 && e({ stat: "health", from: 2, to: 0 }).down);
  let mono = true, prev = 0;
  for (let to = 5; to >= 1; to--) { const s = e({ stat: "health", from: 6, to }).strength; if (s < prev) mono = false; prev = s; }
  ck("a heavier blow is never a smaller splash", mono && e({ stat: "health", from: 6, to: 5 }).strength < e({ stat: "health", from: 6, to: 1 }).strength);
  ck("the table's 0 = none, 2 = as is, 3 = more", P.scaled(0.5, 0) === 0 && P.scaled(0.5, 2) === 0.5 && P.scaled(0.5, 3) > 0.5 && P.scaled(0.5, 1) < 0.5);
  ck("options are cleaned (defaults, range)", JSON.stringify(P.cleanOpts({})) === JSON.stringify({ blood: 2, cracks: 2, seats: "all", hold: 1 }) && P.cleanOpts({ goreBlood: 9, goreSeats: "x", goreHold: 7 }).blood === 3 && P.cleanOpts({ goreSeats: "x" }).seats === "all" && P.cleanOpts({ goreHold: 7 }).hold === 2);
}

/* ---------------- the grid: crisp at every DPR ---------------- */
{
  let ok = true;
  for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.625, 3]) for (const [vw, vh] of [[1920, 1080], [1366, 768], [1600, 900], [2560, 1440], [800, 600]]) {
    const g = P.grid(vw, vh, dpr);
    if (!Number.isInteger(g.px) || g.px < 1 || g.w * g.px < vw * dpr - 1e-6 || (g.w - 1) * g.px >= vw * dpr || g.h * g.px < vh * dpr - 1e-6 || Math.abs(g.px / dpr - P.ART_CSS) > 0.6) ok = false;
  }
  ck("every DPR and window: a whole number of device px per art px, about 3 CSS px, the grid covers the view by less than one art px", ok);
}

/* ---------------- helpers ---------------- */
const g = P.grid(1920, 1080, 1);
const sf = R.surface(g.w, g.h);
const shot = (items, ms) => { R.render(sf, items, ms); return sf.rgba.slice(); };
const count = (rgba, pred = () => true) => { let c = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] && pred(rgba, i)) c++; return c; };
const sha = (a) => { let h = 2166136261; for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619) >>> 0; } return h; };
const colours = new Set();
for (const pal of [R.PAL, R.PAL_SAFE]) for (const st of Object.values(pal)) for (const c of Object.values(st)) colours.add(c.join(","));
for (const c of Object.values(R.CRACK)) colours.add(c.slice(0, 3).join(","));
const alphas = new Set([...[1, P.CENTRE.alpha].flatMap((c) => [1, R.SEE].flatMap((k) => R.ALPHA.map((a) => Math.round(a * c * k)))), ...Object.values(R.CRACK).map((c) => c[3])]);
const paletteOnly = (rgba) => { for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3] && (!colours.has(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`) || !alphas.has(rgba[i + 3]))) return false; return true; };
const T = P.TICK_MS;

/* ---------------- blood ---------------- */
{
  const mk = (o = {}) => ({ plan: P.bloodPlan(g, { strength: 0.8, seed: "chk", dir: 0.3, ...o }), t0: 0 });
  const it = mk();
  const f0 = shot([it], 0), f1 = shot([it], T), f2 = shot([it], 2 * T), f4 = shot([it], 4 * T), f8 = shot([it], 8 * T);
  ck("the splash ARRIVES on its first tick (drawn at once, at full alpha: no fade-in)", count(f0) > 200 && count(f0, (a, i) => a[i + 3] >= R.ALPHA[0] * P.CENTRE.alpha - 1) === count(f0));
  const fs = shot([it], R.SETTLE + 50);
  ck("after the hit the blood lets the table read through it (settled alpha lower than the arrival's)", count(fs) > 0 && count(fs, (a, i) => a[i + 3] > Math.round(R.ALPHA[0] * R.SEE)) === 0);
  ck("smear -> squash -> settle: the first three ticks are three different drawings", sha(f0) !== sha(f1) && sha(f1) !== sha(f2));
  /* the smear is stretched along its way: the second moment along dir beats the one across it */
  const mom = (rgba) => { let sx = 0, sy = 0, c = 0; const pts = []; for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) { const p = i / 4, x = p % g.w, y = (p / g.w) | 0; pts.push([x, y]); sx += x; sy += y; c++; } sx /= c; sy /= c; let a = 0, b = 0; const dx = Math.cos(0.3), dy = Math.sin(0.3); for (const [x, y] of pts) { const u = (x - sx) * dx + (y - sy) * dy, v = -(x - sx) * dy + (y - sy) * dx; a += u * u; b += v * v; } return a / Math.max(1, b); };
  ck(`the first tick is a smear along the blood's way (${mom(f0).toFixed(2)} : 1)`, mom(f0) > 1.8);
  ck("the spatter keeps landing after the hit (ticks 2 -> 8 add blood)", count(f8) > count(f2) && count(f4) > count(f1));
  const low = (rgba) => { let m = 0; for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) m = Math.max(m, (i / 4 / g.w) | 0); return m; };
  const it2 = mk({ seed: "drip", dir: Math.PI * 1.5, at: { fx: 0.2, fy: 0.25 } });
  ck("drips run DOWN the glass (the lowest blood moves down between 0.4 s and 3 s)", low(shot([it2], 3000)) > low(shot([it2], 400)) + 4);
  ck("every pixel is one palette colour at one of a few alphas (pixel art: no gradient, no anti-aliasing)", [f0, f1, f4, shot([it], 3000), shot([it], 7000)].every(paletteOnly));
  const dried = shot([it], it.plan.life.dry + 300);
  const driedSet = new Set(Object.values(R.PAL.dried).map((c) => c.join(",")));
  ck("it dries: after its drying time every blood pixel has the dried colours", count(dried) > 0 && count(dried, (a, i) => !driedSet.has(`${a[i]},${a[i + 1]},${a[i + 2]}`)) === 0);
  const g0 = it.plan.life.gone, d0 = it.plan.life.dissolve;
  const c1 = count(shot([it], g0 + d0 * 0.2)), c2 = count(shot([it], g0 + d0 * 0.6)), c3 = count(shot([it], g0 + d0 + 50));
  ck(`it clears by a pixel dissolve, never a fade (${c1} -> ${c2} -> ${c3} px)`, c1 > c2 && c2 > 0 && c3 === 0 && paletteOnly(shot([it], g0 + d0 * 0.5)));
  ck("the same seed draws the same picture; another seed another one", sha(shot([mk()], 600)) === sha(shot([it], 600)) && sha(shot([mk({ seed: "other" })], 600)) !== sha(shot([it], 600)));
  /* the readable middle: a splash laid out by its way never lands in the middle; a splash put there is see-through */
  let mid = 0;
  for (let i = 0; i < 200; i++) { const p = P.bloodPlan(g, { strength: Math.random(), seed: `m${i}`, dir: Math.random() * 7 }); if (((p.cx / g.w - 0.5) / P.CENTRE.rx) ** 2 + ((p.cy / g.h - 0.5) / P.CENTRE.ry) ** 2 < 1) mid++; }
  ck(`a splash laid out by its way never lands in the readable middle (${mid} of 200)`, mid === 0);
  const cen = shot([mk({ at: { fx: 0.5, fy: 0.5 } })], 600);
  ck("a splash put in the middle is see-through there", count(cen) > 0 && count(cen, (a, i) => a[i + 3] > Math.round(R.ALPHA[0] * P.CENTRE.alpha)) === 0);
  /* coverage: the biggest splash covers a bounded share of the view */
  const big = shot([{ plan: P.bloodPlan(g, { strength: 1, seed: "big", dir: 0 }), t0: 0 }], 1500);
  ck(`a knock-down splash (with its second blow) covers ${(count(big) / (g.w * g.h) * 100).toFixed(1)} % of the view (<= 14 %)`, count(big) / (g.w * g.h) <= 0.14);
  /* reduced motion: stills */
  const st = { plan: P.bloodPlan(g, { strength: 0.8, seed: "chk", dir: 0.3, still: true }), t0: 0 };
  ck("reduced motion: the first tick is already the settled splash with its drips (no smear, no running)", sha(shot([st], 0)) === sha(shot([st], 2000)));
  /* photosensitive seat */
  let red = true;
  for (const stg of Object.values(R.PAL_SAFE)) for (const c of Object.values(stg)) if (c[0] / (c[0] + c[1] + c[2]) >= 0.7) red = false;
  ck("photosensitive palette: no saturated red (R share < 0.7 in every colour)", red);
  const sp = P.bloodPlan(g, { strength: 1.25, seed: "safe", dir: 1, safe: true });
  const safeArea = count(shot([{ plan: sp, t0: 0 }], 1500)) / (g.w * g.h);
  ck(`photosensitive seat: the strongest splash covers ${(safeArea * 100).toFixed(2)} % <= ${P.SAFE_AREA * 100} % of the view, one blow only`, safeArea <= P.SAFE_AREA && !sp.second);
  ck("normal palette: blood is red (it reads as blood)", R.PAL.wet.b[0] / R.PAL.wet.b.reduce((a, b) => a + b) > 0.7);
}

/* ---------------- arrivals ---------------- */
{
  let past = [], ok = true;
  for (let i = 0; i < 10; i++) { const t = P.arrivalAt(1000 + i * 30, 0.9, past); past.push(t); }
  past.sort((a, b) => a - b);
  for (let i = 0; i < past.length; i++) if (past.filter((t) => t >= past[i] && t < past[i] + 1000).length > 2) ok = false;
  ck("ten big blows at once: at most two arrivals in any second", ok);
  ck("a small splash is never held back", P.arrivalAt(1000, 0.2, [990]) === 1000);
  ck("photosensitive seat: one arrival a second, also small ones", P.arrivalAt(1000, 0.2, [900], true) >= 1900);
}

/* ---------------- cracks ---------------- */
{
  const it = { plan: P.crackPlan(g, { strength: 0.9, seed: "cr" }), t0: 0 };
  const c0 = count(shot([it], 0)), c3 = count(shot([it], 3 * T)), c6 = count(shot([it], 8 * T));
  ck(`cracks strike at once and race out (${c0} -> ${c3} -> ${c6} px)`, c0 > 0 && c3 > c0 && c6 > c3);
  const glint = (rgba) => count(rgba, (a, i) => a[i] === 255 && a[i + 1] === 255 && a[i + 2] === 255);
  ck("a glint runs along the fresh cracks, then it is gone", glint(shot([it], 300)) > 0 && glint(shot([it], 2000)) === 0);
  ck("every crack pixel is one palette colour", [0, 3 * T, 300, 2000].every((ms) => paletteOnly(shot([it], ms))));
  const gone = it.plan.life.gone;
  ck("they retract to nothing at the end", count(shot([it], gone - it.plan.life.retract * 0.5)) < count(shot([it], 2000)) && count(shot([it], gone + 1)) === 0);
  const st = { plan: P.crackPlan(g, { strength: 0.9, seed: "cr", still: true }), t0: 0 };
  ck("reduced motion: the whole crack at once, no chips, no glint", sha(shot([st], 0)) === sha(shot([st], 1500)) && st.plan.chips.length === 0);
  ck("a broken Resolve (strength 1) strikes twice", P.crackPlan(g, { strength: 1, seed: "x" }).strikes.length === 2);
}

/* ---------------- cost ---------------- */
{
  const items = [];
  for (let i = 0; i < 6; i++) items.push({ plan: P.bloodPlan(g, { strength: 1, seed: `c${i}`, dir: i }), t0: i * 200 });
  items.push({ plan: P.crackPlan(g, { strength: 1, seed: "cc" }), t0: 0 });
  const run = () => { const ms = []; for (let t = 0; t < 4000; t += T) { const a = performance.now(); R.render(sf, items, t); ms.push(performance.now() - a); } ms.sort((a, b) => a - b); return [ms[ms.length >> 1], ms[Math.floor(ms.length * 0.95)]]; };
  const [c50, c95] = run();      // cold: every tick recorded on first draw
  for (const it of items) { it.plan._ticks = null; R.warm(it.plan); }
  const [p50, p95] = run();      // warmed ahead, as main.mjs does before the contact
  console.log(`  cost of a 24 Hz frame, 1920 x 1080 glass, six knock-down splashes + a shatter: warmed median ${p50.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (cold ${c50.toFixed(2)} / ${c95.toFixed(2)})`);
  ck(`a crowded frame, warmed ahead, costs little (median ${p50.toFixed(2)} ms <= 3, p95 ${p95.toFixed(2)} <= 5)`, p50 <= 3 && p95 <= 5);
}

/* ---------------- runtime on a fake Foundry ---------------- */
{
  const hooks = {};
  const values = {};
  const settings = new Map();
  let clock = 1000;
  globalThis.performance = { now: () => clock };
  const timers = [];
  globalThis.setTimeout = (fn, ms) => { const t = { fn, at: clock + (ms ?? 0), id: timers.length + 1 }; timers.push(t); return t.id; };
  globalThis.clearTimeout = (id) => { const t = timers.find((x) => x.id === id); if (t) t.fn = null; };
  const advance = (ms) => { const end = clock + ms; for (;;) { const t = timers.filter((x) => x.fn && x.at <= end).sort((a, b) => a.at - b.at)[0]; if (!t) break; clock = Math.max(clock, t.at); const fn = t.fn; t.fn = null; fn(); } clock = end; };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.window = { innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1, addEventListener() {} };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.ImageData = class { constructor(d, w, h) { this.data = d; this.width = w; this.height = h; } };
  const el = () => ({ style: {}, setAttribute() {}, appendChild() {}, after() {}, isConnected: true, getContext: () => ({ putImageData() {}, clearRect() {} }) });
  globalThis.document = { getElementById: (id) => (id === "board" ? el() : null), createElement: el };
  globalThis.getComputedStyle = () => ({ zIndex: "0" });
  globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), 1), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
  const user = { isGM: false, id: "P1" };
  globalThis.game = { user, settings: { settings, register: (m, k, o) => { settings.set(`${m}.${k}`, o); if (!(`${m}.${k}` in values)) values[`${m}.${k}`] = o.default; }, get: (m, k) => { if (!settings.has(`${m}.${k}`)) throw new Error("not registered"); return values[`${m}.${k}`]; } },
    modules: new Map([["invincible-plus-ultra", {}]]), socket: { on() {}, emit() {} }, combats: new Map() };
  settings.set("invincible-plus-ultra.tokenReactEnabled", {}); values["invincible-plus-ultra.tokenReactEnabled"] = true;
  const scene = { id: "S" };
  const mkTok = (id, o = {}) => { const actor = { id: `A${id}`, type: o.type ?? "character", system: { derived: { health: { value: 6, max: 6 }, resolve: { value: 6, max: 6 } } }, testUserPermission: () => !!o.owner, getActiveTokens: () => [tok] }; const tok = { id, actor, scene, visible: true, isVisible: true, document: { hidden: !!o.hidden }, center: { x: 0, y: 0 } }; return tok; };
  const toks = [mkTok("T1", { owner: true }), mkTok("T2"), mkTok("T3", { hidden: true }), mkTok("T4", { type: "vehicle" })];
  globalThis.canvas = { ready: true, scene, tokens: { get: (id) => toks.find((t) => t.id === id), get placeables() { return toks; } } };
  const impact = { busy: false };
  globalThis.MoinenLetters = { engine: () => ({ impact }) };
  const M = await import("../gore/main.mjs");
  M.start({ init: true, ready: true });
  await new Promise((r) => r());      // the engine promise
  const api = game.modules.get("invincible-plus-ultra").api?.gore;
  ck("the api is on the module and on globalThis", !!api && globalThis.PlusUltraGore === api && typeof api.blood === "function" && typeof api.net?.blood === "function");
  const reg = (k) => settings.get(`invincible-plus-ultra.${k}`);
  ck("the table's options: world, not in Foundry's list (the Comic effects window shows them)", ["goreBlood", "goreCracks", "goreSeats", "goreHold"].every((k) => reg(k)?.scope === "world" && reg(k)?.config === false));
  const hurt = (tok, stat, to, opt = {}) => { tok.actor.system.derived[stat].value = to; for (const fn of hooks.updateActor ?? []) fn(tok.actor, { system: { derived: { [stat]: { value: to } } } }, { modifiedTime: 12345, ...opt }); };
  const live = () => api.state().live;
  const reset = () => { api.clear({ quick: true }); for (const t of toks) { t.actor.system.derived.health.value = 6; t.actor.system.derived.resolve.value = 6; } for (const fn of hooks.canvasReady ?? []) fn(); };
  reset();
  hurt(toks[0], "health", 3);
  advance(M.QUIET + 10);
  ck("a Health drop waits for its token reaction's blow", live() === 0);
  Hooks.callAll("invincible-plus-ultra.tokenReact", { phase: "hit", at: clock + 100, ids: ["T1"] });
  advance(1);
  ck("... and plays blood on it (its start = the blow's instant)", live() === 1 && api.state().pending === 0);
  reset();
  hurt(toks[0], "health", 3);
  advance(M.QUIET + 10);
  impact.busy = true;
  Hooks.callAll("invincible-plus-ultra.tokenReact", { phase: "hit", at: clock + 100, ids: ["T1"] });
  advance(400);
  const during = live();
  impact.busy = false;
  advance(60);
  ck("an impact frame plays over the blow: the blood lands when it is over (seen hitting the glass)", during === 0 && live() === 1);
  reset();
  hurt(toks[0], "health", 3);
  advance(M.QUIET + M.HIT_WAIT + 20);
  ck("no blow came: it plays after the wait all the same", live() === 1);
  reset();
  values["invincible-plus-ultra.tokenReactEnabled"] = false;
  hurt(toks[0], "health", 3);
  advance(M.QUIET + 10);
  ck("token reactions off: it plays after the short gathering wait", live() === 1);
  reset();
  hurt(toks[0], "resolve", 4);
  advance(M.QUIET + 10);
  ck("a Resolve drop: cracks", live() === 1);
  reset();
  for (const fn of hooks.createChatMessage ?? []) fn({ speakerActor: toks[0].actor, rolls: [{ pushCount: 1 }] });
  hurt(toks[0], "resolve", 4);
  advance(M.QUIET + 10);
  ck("stress chosen for a push: nothing", live() === 0);
  reset();
  hurt(toks[0], "health", 7 - 1); toks[0].actor.system.derived.health.value = 6;
  hurt(toks[0], "health", 6);
  advance(M.QUIET + 10);
  ck("no loss: nothing", live() === 0);
  reset();
  hurt(toks[2], "health", 2);
  advance(M.QUIET + 10);
  ck("a hidden token on a player's seat: nothing (it would tell him something he cannot see was hurt)", live() === 0);
  reset();
  user.isGM = true;
  hurt(toks[2], "health", 2);
  advance(M.QUIET + 10);
  ck("... the GM sees it", live() === 1);
  user.isGM = false;
  reset();
  toks[1].visible = toks[1].isVisible = false;
  hurt(toks[1], "health", 2);
  advance(M.QUIET + 10);
  ck("a token out of this seat's sight: nothing", live() === 0);
  toks[1].visible = toks[1].isVisible = true;
  reset();
  values["invincible-plus-ultra.goreSeats"] = "owners";
  hurt(toks[1], "health", 2);
  advance(M.QUIET + 10);
  const notOwner = live();
  reset();
  hurt(toks[0], "health", 2);
  advance(M.QUIET + 10);
  ck("'owners': only the character's owner (and the GM) sees it", notOwner === 0 && live() === 1);
  values["invincible-plus-ultra.goreSeats"] = "all";
  reset();
  values["invincible-plus-ultra.goreBlood"] = 0;
  hurt(toks[0], "health", 2);
  advance(M.QUIET + 10);
  ck("the table's blood 0: none", live() === 0);
  values["invincible-plus-ultra.goreBlood"] = 2;
  reset();
  hurt(toks[3], "health", 2);
  advance(M.QUIET + 10);
  ck("a vehicle: cracks (live)", live() === 1 && api.state().live === 1);
  reset();
  hurt(toks[1], "health", 2); hurt(toks[1], "resolve", 3);
  advance(M.QUIET + 10);
  ck("Health and Resolve together: blood AND cracks, one moment", live() === 2);
  reset();
  ck("a public call returns a handle with its strength, the table's level applied", api.blood({ strength: 0.5 })?.strength === 0.5 && api.cracks({ strength: 0.4 })?.kind === "cracks");
  api.clear({ quick: true });
  ck("clear empties the glass", live() === 0);
  ck("mayShow: another scene never", !M.mayShow({ gm: true, sameScene: false, visible: true }));
}

/* ---------------- wiring (source pins) ---------------- */
{
  const src = (p) => readFileSync(join(root, p), "utf8");
  ck("module.js starts the area by a guarded import", /import\("\.\/gore\/main\.mjs"\)\s*\.then\(\(gore\) => gore\.start/.test(src("module.js")));
  const D = await import("../table/defs.mjs");
  ck("the Comic effects window has the tab with the four options", JSON.stringify(D.TABS.find((t) => t.id === "gore")?.sections.flatMap((s) => s.rows.map((r) => r.key))) === JSON.stringify(["goreBlood", "goreCracks", "goreSeats", "goreHold"]));
  ck("the window's Preview plays it", /tab === "gore"\) \{ \(game\.modules\.get\(MOD\)\?\.api\?\.gore/.test(src("table/app.mjs")));
  ck("the glass lies over the map and under the interface, crisp (pixelated, right after #board)", /board\.after\(wrap\)/.test(src("gore/main.mjs")) && /imageRendering: "pixelated"/.test(src("gore/main.mjs")) && /pointerEvents: "none"/.test(src("gore/main.mjs")));
}

console.log(`sweep gore: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
