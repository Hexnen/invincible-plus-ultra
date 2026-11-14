// node scripts/sweep-checks/kodown.mjs  (KODOWN: a knocked-down token stays down while it has 0 Health; owner 2026-11-14, «Tak»).
// Pure part (scripts/tokenanim/pure.mjs LIE, lyingAt, lieAmount, mix's base): the fall ends lying and stays lying, the side is the token's
// own (every seat, every reload), the rise comes only with an end time, reduced motion keeps the dim alone, no jump on the way.
// Runtime on a fake Foundry with a controlled clock (scripts/tokenanim/main.mjs + state.mjs): a scene that loads with a token at 0 shows it
// lying at once; a knock-down falls on the reaction's blow and still lies 10 s and 60 s later; with no reaction it falls after LIE.grace;
// a reload, a scene change, a move, an unlinked token, a hidden token (players) all keep it right; healing / getting up raises it on the
// blow; the GM's switch, "None" for going down, the seat's Off, reduced motion and the map's death look decide what "off" means; a
// challenge never lies; the token's document is never written. Fails on tactics-integrated-124 (176eccf): no LIE, the picture stands up.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const dir = dirname(fileURLToPath(import.meta.url)), root = join(dir, "..");
const P = await import("../tokenanim/pure.mjs");
if (!P.LIE || !existsSync(join(root, "tokenanim", "state.mjs"))) { ck("tokenanim has the lying state (pure LIE, state.mjs)", false); console.log(`sweep kodown: ${n} checks, ${f} failed`); process.exit(1); }

/* ---------------- pure ---------------- */
{
  const S0 = { side: 1, fallAt: -Infinity, upAt: Infinity };
  ck("already lying (a scene that loads with it at 0): fully down at once", P.lieAmount(S0, 0) === 1 && P.lieAmount(S0, 1e9) === 1);
  const S1 = { side: -1, fallAt: 1000, upAt: Infinity };
  ck("before its fall: upright", P.lieAmount(S1, 999) === 0);
  let mono = true, prev = -1;
  for (let t = 1000; t <= 1000 + P.LIE.fallMs; t += 5) { const a = P.lieAmount(S1, t); if (a < prev - 1e-12) mono = false; prev = a; }
  ck("the fall only goes down (no bounce back up in the state)", mono && P.lieAmount(S1, 1000 + P.LIE.fallMs) === 1);
  ck("lying stays: 10 s, 60 s, an hour after the fall", [10e3, 60e3, 3.6e6].every((d) => P.lieAmount(S1, 1000 + d) === 1) && !P.lieDone(S1, 1e9));
  const S2 = { side: 1, fallAt: -Infinity, upAt: 5000 };
  ck("the rise starts only at upAt and ends upright", P.lieAmount(S2, 4999) === 1 && P.lieAmount(S2, 5000 + P.LIE.upMs) === 0 && P.lieDone(S2, 5000 + P.LIE.upMs) && !P.lieDone(S2, 5000 + P.LIE.upMs - 1));
  const p = P.lyingAt(S0, 0);
  ck(`the lying pose tips the picture over (rot ${p.rot.toFixed(2)}) round a point below its centre, a little smaller, dim`, Math.abs(p.rot - P.LIE.rot) < 1e-9 && p.py > 0 && p.sx < 1 && p.tk > 0.1);
  const c = P.centred(p);
  ck(`... and stays mostly on its square (centre moved ${Math.hypot(c.x, c.y).toFixed(2)} token)`, Math.hypot(c.x, c.y) < 0.45);
  const st = P.lyingAt(S0, 0, {}, { still: true });
  ck("reduced motion: lying is the dim alone (no tipping, no size)", st.rot === 0 && st.sx === 1 && st.sy === 1 && st.tk > 0.1);
  ck("the tint factor (photosensitivity guard, flashes off) softens the lying dim", P.lyingAt(S0, 0, {}, { tk: 0.35 }).tk < p.tk);
  const sides = new Set(Array.from({ length: 40 }, (_, i) => P.lieSide(`tok${i}`)));
  ck("the side comes from the token (both sides occur, the same for one token every time)", sides.size === 2 && P.lieSide("abc") === P.lieSide("abc"));
  ck("mix with a lying base and no reaction = the lying pose (nothing takes it over)", (() => { const m = P.mix([], 0, {}, p); return Math.abs(m.rot - p.rot) < 1e-9 && m.tk === p.tk; })());
}
/* the whole knock-down on one token: blow at 1000, the collapse's extras on top of the lying state that falls with it */
{
  const L = P.plan("down", { amt: 0.8, step: 2, seed: "K|health|1", at: 1000, lie: true, lieSide: 1, dir: { x: -1, y: 0 } });
  ck("going down on a token at 0: the collapse is the blow on top of the fall (shorter, ends at rest by itself)", L.lie === true && L.dur < 1200 && P.isRest(P.mix([L], 1000 + L.dur + 1)));
  const S = { side: 1, fallAt: P.lieFallAt(L), upAt: Infinity };
  ck("the fall starts on the collapse's own clock (70 ms after the blow)", S.fallAt === 1070);
  let jump = 0, prev = null, landRot = 0;
  for (let t = 990; t < 1000 + 4000; t += 1000 / 60) {
    const m = P.mix([L], t, {}, P.lyingAt(S, t));
    if (prev !== null) jump = Math.max(jump, Math.abs(m.rot - prev));
    prev = m.rot;
    if (Math.abs(t - 1600) < 9) landRot = m.rot;
  }
  ck(`no jump on the whole way down (largest step between two 60 fps frames ${jump.toFixed(3)} rad)`, jump < 0.16);
  ck(`landed lying (${landRot.toFixed(2)} rad) and still lying 10 s and 60 s after the blow`, Math.abs(landRot - P.LIE.rot) < 0.15 && [11e3, 61e3].every((t) => Math.abs(P.mix([L], t, {}, P.lyingAt(S, t)).rot - P.LIE.rot) < 1e-9));
  const thrown = P.mix([L], 1000, {}, P.lyingAt(S, 1000));
  ck("the blow still throws it on the contact frame", Math.hypot(thrown.x, thrown.y) > 0.08);
  /* gets up: the rally's blow at 20000 */
  const B = P.plan("back", { amt: 0.5, seed: "K|health|2", at: 20000 });
  S.upAt = 20000;
  ck("getting up: rising from the blow, upright when the rally is over", Math.abs(P.mix([B], 20000 + 100, {}, P.lyingAt(S, 20100)).rot) > 0.3 && P.isRest(P.mix([B], 20000 + Math.max(B.dur, P.LIE.upMs) + 1, {}, P.lyingAt(S, 20000 + Math.max(B.dur, P.LIE.upMs) + 1))));
  /* the preview (no lie): the whole fall and the picture back up, as before */
  const pv = P.plan("down", { amt: 0.8, seed: "pv", at: 0 });
  ck("a preview (no lying state) still shows the whole topple and gets back up", !pv.lie && Math.abs(P.mix([pv], 1000).rot) > 0.8 && P.isRest(P.mix([pv], pv.dur + 1)));
}

/* ---------------- runtime on a fake Foundry ---------------- */
let T = 100000;
Object.defineProperty(globalThis, "performance", { value: { now: () => T, timeOrigin: 0 }, configurable: true, writable: true });
const hooks = {};
globalThis.Hooks = { on: (k, fn) => ((hooks[k] ??= []).push(fn), hooks[k].length), once: (k, fn) => ((hooks[k] ??= []).push(fn), 1), off: () => {}, callAll: (k, ...a) => { for (const fn of hooks[k] ?? []) fn(...a); } };
const values = {}, settings = new Map();
globalThis.game = { user: { isGM: false, id: "P1" }, i18n: { lang: "en" }, settings: { settings, register: (m, k, o) => { settings.set(`${m}.${k}`, o); if (!(`${m}.${k}` in values)) values[`${m}.${k}`] = o.default; }, get: (m, k) => values[`${m}.${k}`] }, modules: new Map() };
globalThis.CONST = { CANVAS_PERFORMANCE_MODES: { LOW: 0 } };
let reduce = false;
globalThis.matchMedia = () => ({ matches: reduce });
globalThis.foundry = { utils: { expandObject: (o) => { const out = {}; for (const [k, v] of Object.entries(o)) { const ps = k.split("."); let c = out; ps.slice(0, -1).forEach((q) => { c = c[q] ??= {}; }); c[ps.at(-1)] = v; } return out; }, getProperty: (o, p) => p.split(".").reduce((c, k) => c?.[k], o) } };
class Emitter { constructor() { this.l = {}; } on(k, fn) { (this.l[k] ??= []).push(fn); } off(k, fn) { this.l[k] = (this.l[k] ?? []).filter((x) => x !== fn); } emit(k) { for (const fn of [...(this.l[k] ?? [])]) fn(); } count() { return Object.values(this.l).reduce((a, v) => a + v.length, 0); } }
const renderer = new Emitter(), tickers = new Set();
let scene = { id: "S" };
let toks = [];
globalThis.canvas = { ready: true, get scene() { return scene; }, grid: { size: 100 }, performance: { mode: 2 }, app: { renderer, ticker: { add: (fn) => tickers.add(fn), remove: (fn) => tickers.delete(fn) } }, tokens: { get: (id) => toks.find((t) => t.id === id), get placeables() { return toks; } } };
const docWrites = [];
function point(x, y) { return { x, y, set(a, b) { this.x = a; this.y = b ?? a; } }; }
function mkActor(id, hp, o = {}) { const a = { id, type: o.type ?? "npc", system: { derived: { health: { value: hp, max: o.max ?? 8 }, resolve: { value: 4, max: 8 } } }, getActiveTokens: () => toks.filter((t) => t.actor === a) }; return a; }
function mkTok(id, actor, o = {}) {
  const src = { x: o.x ?? 0, y: o.y ?? 0, hidden: !!o.hidden, width: 1, actorLink: !o.unlinked, object: null };
  const document = new Proxy(src, { set: (t, k, v) => { docWrites.push(k); t[k] = v; return true; }, get: (t, k) => (k === "update" || k === "setFlag" ? (...a) => { docWrites.push([k, a]); } : t[k]) });
  const mesh = { position: point(src.x + 50, src.y + 50), scale: point(0.5, 0.5), rotation: 0, tint: 0xffffff, visible: true, destroyed: false };
  const tok = { id, document, mesh, actor, scene, visible: true, destroyed: false, w: 100, get center() { return { x: mesh.position.x, y: mesh.position.y }; } };
  src.object = tok;
  toks.push(tok);
  return tok;
}
const M = await import("../tokenanim/main.mjs");
M.start({ init: true });
M._test.setStarted(true);
const snap = (m) => JSON.stringify({ x: m.position.x, y: m.position.y, r: m.rotation, sx: m.scale.x, sy: m.scale.y, t: m.tint });
const frame = (fn) => { for (const g of [...tickers]) g(); renderer.emit("prerender"); const r = fn?.(); renderer.emit("postrender"); return r; };
const drawn = (tok) => { let d = null; frame(() => { d = JSON.parse(snap(tok.mesh)); }); return d; };
const lies = (tok, rot0 = 0) => { const d = drawn(tok); return Math.abs(Math.abs(d.r - rot0) - P.LIE.rot) < 0.02; };
const upright = (tok, rot0 = 0) => { const d = drawn(tok); return Math.abs(d.r - rot0) < 1e-9 && d.sx === 0.5 && d.sy === 0.5; };
const setHp = (tok, hp, unlinked = false) => {
  tok.actor.system.derived.health.value = hp;
  if (unlinked) Hooks.callAll("updateToken", tok.document, { delta: { system: { derived: { health: { value: hp } } } } }, {});
  else Hooks.callAll("updateActor", tok.actor, { system: { derived: { health: { value: hp } } } }, {});
};
const load = () => { Hooks.callAll("canvasTearDown"); for (const t of toks) Hooks.callAll("drawToken", t); Hooks.callAll("canvasReady"); };

/* a scene that loads with a token at 0 (a reload, a seat that joins later, a scene change and back) */
const Down0 = mkTok("Down0", mkActor("a0", 0), { x: 0 }), Up = mkTok("Up", mkActor("a1", 5), { x: 200 }), Ch = mkTok("Chal", mkActor("c1", 0, { type: "challenge" }), { x: 400 });
const Unl = mkTok("Unl", mkActor("u1", 0), { x: 600, unlinked: true });
load();
const side0 = P.lieSide("Down0");
{
  const before = snap(Down0.mesh);
  const d = drawn(Down0);
  ck("scene loads with a token at 0 Health: it lies at once (no fall replayed)", Math.abs(d.r - side0 * P.LIE.rot) < 1e-9);
  ck("... only for one drawing: the picture's own values are back exactly after it", snap(Down0.mesh) === before);
  ck("an unlinked token at 0 lies too", lies(Unl));
  ck("a token with Health stands", upright(Up));
  ck("a challenge at 0 never lies (it does not fall)", upright(Ch) && !M._test.lying.has("Chal"));
  ck("lying keeps the listeners on (it is drawn every frame)", renderer.count() === 2);
  T += 60000;
  ck("still lying a minute later", lies(Down0));
  load();
  ck("reload / scene change and back: lying again at once, on the same side", Math.abs(drawn(Down0).r - side0 * P.LIE.rot) < 1e-9);
  const other = { id: "S2" }; scene = other;
  ck("on another scene the token is not drawn by us (not on the viewed scene)", (() => { const s = snap(Down0.mesh); frame(); return snap(Down0.mesh) === s; })());
  scene = Down0.scene;
}
/* moved while down: Foundry moves the picture, the lying pose rides on top, Foundry's place is given back exactly */
{
  Down0.mesh.position.set(380, 250);
  const moved = snap(Down0.mesh);
  const d = drawn(Down0);
  ck("moved / dragged while down: still lying where Foundry draws it now", Math.abs(d.r - side0 * P.LIE.rot) < 1e-9 && Math.abs(d.x - 380) < 60 && Math.abs(d.y - 250) < 60);
  ck("... and Foundry's own place comes back exactly", snap(Down0.mesh) === moved);
  Down0.mesh.rotation = 0.5;
  ck("a token Foundry itself turned lies on top of its own turn", Math.abs(drawn(Down0).r - (0.5 + side0 * P.LIE.rot)) < 1e-9);
  Down0.mesh.rotation = 0;
}
/* the knock-down: Health to 0, the reaction's blow 800 ms later; the fall is on the blow */
{
  setHp(Up, 0);
  ck("Health to 0: nothing tips before the reaction's blow", upright(Up));
  const at = T + 800;
  const L = M.react(Up, { kind: "down", amt: 0.8, step: 0, seed: "Up|health|1", at });
  ck("the down reaction on a token at 0 plans the collapse on top of the fall", L && L.anim === "collapse" && L.lie === true);
  T = at + 50; ck("before the fall (blow + 50 ms): not yet over", Math.abs(drawn(Up).r) < 0.5);
  T = at + 70 + P.LIE.fallMs + 400; ck("landed: lying", lies(Up));
  T = at + 10000; ck("10 s after the blow: still lying (finding 10: it stood up after ~2 s)", lies(Up));
  T = at + 60000; ck("60 s after the blow: still lying", lies(Up));
  ck("the collapse layer has ended; the lying state is what draws it", !M._test.active.has("Up") && M._test.lying.has("Up"));
  /* a blow on a lying token (damage on a broken character): it jolts and stays down */
  const L2 = M.react(Up, { kind: "down", amt: 0.3, step: 1, seed: "Up|health|2", at: T });
  T += 30; const j = drawn(Up);
  ck("hit again while down: it jolts on top of lying", L2 && Math.hypot(j.x - 250, j.y - 50) > 3);
  T += 3000; ck("... and stays down", lies(Up));
  /* healed: the getting-up reaction's blow raises it */
  setHp(Up, 3);
  ck("Health up from 0: it does not rise before the reaction's blow", lies(Up));
  const atB = T + 600;
  M.react(Up, { kind: "back", amt: 0.4, seed: "Up|health|3", at: atB });
  T = atB - 10; ck("... still down just before the blow", lies(Up));
  T = atB + 200; const mid = drawn(Up);
  ck("... rising on the blow", Math.abs(mid.r) > 0.05 && Math.abs(mid.r) < P.LIE.rot - 0.05);
  T = atB + 2000;
  ck("... up and still once the getting-up has played", upright(Up) && !M._test.lying.has("Up"));
}
/* no reaction on this seat (the reactions off, the word dropped): the state alone, after LIE.grace */
{
  setHp(Up, 0);
  T += P.LIE.grace - 100; ck("no reaction: still standing within the grace", upright(Up));
  T += 100 + P.LIE.fallMs + 10; ck("no reaction: falls by itself after the grace and lies", lies(Up));
  setHp(Up, 4);
  T += P.LIE.grace + P.LIE.upMs + 10; ck("no reaction: rises by itself after the grace", upright(Up) && !M._test.lying.has("Up"));
  setHp(Up, 0); T += 500; setHp(Up, 2); T += P.LIE.grace + 1000;
  ck("down and up again within the grace: never fell", upright(Up) && !M._test.lying.has("Up"));
}
/* the other animations the GM may choose for going down: they play, then it topples and lies */
{
  values["invincible-plus-ultra.tokenAnimEvents"] = { ...P.cleanEvents(null), down: { anim: "stagger", str: 1 } };
  setHp(Up, 0);
  const L = M.react(Up, { kind: "down", amt: 0.5, seed: "Up|health|9", at: T + 100 });
  T += 100 + L.dur + P.LIE.fallMs; ck("going down set to Stagger: staggers, then lies", L.anim === "stagger" && lies(Up));
  values["invincible-plus-ultra.tokenAnimEvents"] = { ...P.cleanEvents(null), down: { anim: "none", str: 1 } };
  ck("going down set to None: nothing moves and nothing lies (KODOWN-1)", M.react(Up, { kind: "down", amt: 0.5, at: T }) === null && upright(Up));
  values["invincible-plus-ultra.tokenAnimEvents"] = P.cleanEvents(null); settings.get("invincible-plus-ultra.tokenAnimEvents").onChange(P.cleanEvents(null));
  ck("... back to Topple: it lies again at once", lies(Up));
}
/* the GM's switch, the seat's own Off, reduced motion, the map's death look */
{
  values["invincible-plus-ultra.tokenAnimOn"] = false;
  ck("the GM switched the animations off for the table: a down token stands as Foundry draws it", upright(Down0));
  frame(); ck("... and nothing listens", renderer.count() === 0);
  values["invincible-plus-ultra.tokenAnimOn"] = true; settings.get("invincible-plus-ultra.tokenAnimOn").onChange(true);
  ck("switched back on: lies again at once", lies(Down0));
  values["invincible-plus-ultra.tokenAnimMine"] = "off";
  ck("the seat's own Off: stands", upright(Down0));
  values["invincible-plus-ultra.tokenAnimMine"] = "full"; settings.get("invincible-plus-ultra.tokenAnimMine").onChange("full");
  reduce = true;
  const d = drawn(Down0);
  ck("reduced motion: no tipping, the dim alone", d.r === 0 && d.sx === 0.5 && d.t !== 0xffffff);
  reduce = false;
  Down0._mmDead = true;
  ck("the map's death look owns the token: nothing of ours lies (and no dim)", (() => { const s = drawn(Down0); return s.r === 0 && s.t === 0xffffff; })());
  Down0._mmDead = false;
  ck("... gone: lies again", lies(Down0));
}
/* hidden from a player, out of sight; unlinked changes; deletion */
{
  Down0.document.hidden = true;
  ck("hidden from a player: nothing drawn (nothing reveals it), the state kept", upright(Down0) && M._test.lying.has("Down0"));
  Down0.document.hidden = false;
  ck("shown again: lying", lies(Down0));
  Down0.visible = false; const s = snap(Down0.mesh); frame();
  ck("out of this seat's sight: not drawn", snap(Down0.mesh) === s);
  Down0.visible = true;
  setHp(Unl, 4, true); M.react(Unl, { kind: "back", amt: 0.3, at: T + 100 }); T += 2500;
  ck("an unlinked token healed (its delta): gets up", upright(Unl) && !M._test.lying.has("Unl"));
  setHp(Unl, 0, true); M.react(Unl, { kind: "down", amt: 0.6, at: T + 100 }); T += 2500;
  ck("an unlinked token knocked down: lies", lies(Unl));
  Hooks.callAll("deleteToken", { id: "Unl" }); toks = toks.filter((t) => t !== Unl);
  ck("a deleted token is forgotten", !M._test.lying.has("Unl") && !M._test.known.has("Unl"));
  const LC = M.react(Ch, { kind: "down", amt: 1, at: T });
  ck("a challenge going down: a heavy blow, never a topple that stands back up", LC && LC.anim === "stagger");
  T += 5000; ck("... and it stands", upright(Ch));
}
ck(`the token's document was never written (x / y, flags, updates) ${JSON.stringify(docWrites).slice(0, 120)}`, docWrites.filter((k) => k !== "hidden").length === 0);      // "hidden": this check itself hides it from the player
/* every lying token gone: nothing listens */
{
  for (const t of toks) setHp(t, 5);
  T += P.LIE.grace + P.LIE.upMs + 100; frame(); frame();
  ck("nobody lying, nothing playing: nothing listens", M._test.lying.size === 0 && renderer.count() === 0 && tickers.size === 0);
}
/* the one place that reads the character: state.mjs, a yes / no only */
{
  const src = readFileSync(join(root, "tokenanim", "state.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ck("state.mjs reads Health only (no Resolve, no other numbers) and returns booleans", !/resolve|attributes|\.items\b/i.test(src) && /health/.test(src));
  ck("state.mjs never writes", !/\.update\(|setFlag|updateSource|\.set\(|\bdelete\b/.test(src));
  const main = readFileSync(join(root, "tokenanim", "main.mjs"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  ck("main.mjs reads no character data itself (only state.mjs's yes / no)", !/\.actor\b|system\.|derived/.test(main) && /S\.downOf\(/.test(main));
  ck("no new per-client setting (all options are the GM's for the table; tokenAnimMine predates KODOWN)", (main.match(/scope: "client"/g) ?? []).length === 1);
}
console.log(`sweep kodown: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
