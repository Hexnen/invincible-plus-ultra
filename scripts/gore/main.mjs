/* GORE: blood and cracks on the screen, the Foundry part. Started from scripts/module.js by a guarded dynamic import, like the other areas.
   What is drawn and when is plan.mjs (pure), how it is drawn raster.mjs (pure); here:
     - the GLASS: one <canvas> of the art grid (plan.grid: one art px = round(3 x DPR) device px) laid over the map (right after
       #board: over the scene, under the interface), scaled by a whole number of device px with no smoothing (image-rendering:
       pixelated), so every art pixel is a crisp square at any window size, zoom of the scene or DPR. Drawn on the comic's 24 Hz beat and
       only while something changes; nothing runs when the glass is empty;
     - the TABLE's options (world, GM only, live; shown in the "Comic effects" window, tab Blood and cracks): blood 0..3, cracks 0..3,
       who sees it, how long it stays. A seat's own reduced motion and Foundry's photosensitive mode still apply on that seat;
     - a character's Health / Resolve drop (any way: a roll, the tactical engine, the sheet) seen on every seat by the same hooks,
       landed on the token reaction's blow (hook invincible-plus-ultra.tokenReact, phase "hit") when one plays, else after the same short
       wait on every seat; the seed is the change's server stamp, so every seat draws the same splash;
     - never for a token this seat does not see (hidden, another scene): the effect would tell a player that something he cannot see
       was hurt;
     - the public API (game.modules.get("invincible-plus-ultra").api.gore, also globalThis.PlusUltraGore). Nothing here throws. */
import * as P from "./plan.mjs";
import * as R from "./raster.mjs";
import * as Clock from "../shared-clock.mjs";
import { choseStress } from "../tokenreact/pure.mjs";

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (gore) |`;
const REACT_HOOK = `${MOD}.tokenReact`, TAC_HOOK = `${MOD}.tactics`, TAC_HOOK_GM = `${MOD}.tacticsGm`;
const CHANNEL = `module.${MOD}`;
export const QUIET = 180;          // ms a change waits for its other half (Health and Resolve together, a crowd's updates)
export const HIT_WAIT = 3200;      // ms a change waits for its token reaction's blow; then it plays on its own
const PUSH_MS = 9000, ATTACK_MS = 6000;

let started = false, warned = false;
const once = (e) => { if (!warned) { warned = true; console.warn(LOG, "a failure here never affects the game:", e); } };
const pnow = () => performance.now();

/* ---------------- options ---------------- */
function registerSettings() {
  const has = (k) => game.settings.settings.has(`${MOD}.${k}`);
  const K = P.KEYS;
  if (!has(K.blood)) game.settings.register(MOD, K.blood, { name: "Blood on the screen", scope: "world", config: false, type: Number, default: P.DEFAULTS.goreBlood, range: { min: 0, max: 3, step: 1 } });
  if (!has(K.cracks)) game.settings.register(MOD, K.cracks, { name: "Cracks on the screen", scope: "world", config: false, type: Number, default: P.DEFAULTS.goreCracks, range: { min: 0, max: 3, step: 1 } });
  if (!has(K.seats)) game.settings.register(MOD, K.seats, { name: "Who sees blood and cracks", scope: "world", config: false, type: String, default: P.DEFAULTS.goreSeats, choices: { all: "all", owners: "owners" } });
  if (!has(K.hold)) game.settings.register(MOD, K.hold, { name: "How long blood and cracks stay", scope: "world", config: false, type: Number, default: P.DEFAULTS.goreHold, range: { min: 0.5, max: 2, step: 0.25 } });
}
function opts() {
  const v = {};
  for (const k of Object.values(P.KEYS)) { try { v[k] = game.settings.get(MOD, k); } catch { /* default */ } }
  return P.cleanOpts(v);
}
function photosensitive() { try { return game.settings.settings.has("core.photosensitiveMode") && !!game.settings.get("core", "photosensitiveMode"); } catch { return false; } }
function osReduced() { try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; } catch { return false; } }

/* ---------------- the glass ---------------- */
const G = { wrap: null, cv: null, ctx: null, g: null, sf: null, img: null, items: [], raf: 0, lastTick: -1, dirtyAll: true, arrivals: [], cost: [], frames: 0 };
function ensureGlass() {
  if (G.wrap?.isConnected) return true;
  const board = document.getElementById("board");
  if (!board) return false;
  const wrap = document.createElement("div");
  wrap.id = "ipu-gore";
  wrap.setAttribute("aria-hidden", "true");
  Object.assign(wrap.style, { position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", overflow: "hidden", pointerEvents: "none", zIndex: getComputedStyle(board).zIndex || "auto", contain: "strict" });
  const cv = document.createElement("canvas");
  Object.assign(cv.style, { position: "absolute", left: "0", top: "0", imageRendering: "pixelated" });
  wrap.appendChild(cv);
  board.after(wrap);
  G.wrap = wrap; G.cv = cv; G.ctx = cv.getContext("2d", { alpha: true });
  G.g = null;
  return true;
}
function fit() {
  const vw = window.innerWidth, vh = window.innerHeight, dpr = window.devicePixelRatio || 1;
  const g = P.grid(vw, vh, dpr);
  if (G.g && G.g.w === g.w && G.g.h === g.h && G.g.px === g.px && G.g.dpr === g.dpr) return false;
  G.g = g;
  G.cv.width = g.w; G.cv.height = g.h;
  /* the canvas covers w x px device px: CSS size = that / dpr (a whole number of device px per art px) */
  G.cv.style.width = `${(g.w * g.px) / g.dpr}px`; G.cv.style.height = `${(g.h * g.px) / g.dpr}px`;
  G.sf = R.surface(g.w, g.h);
  G.img = new ImageData(G.sf.rgba, g.w, g.h);
  /* the plans are laid out on the grid: a new grid lays them out again (the same seeds: the same splash, in this view's fractions) */
  for (const it of G.items) { it.plan = it.make(g); warmLater(it); }
  G.dirtyAll = true;
  return true;
}
function frame() {
  G.raf = 0;
  try {
    if (!G.items.length) { hideIfEmpty(); return; }
    if (!ensureGlass()) return;
    const resized = fit();
    const now = pnow(), tick = Math.floor(now / P.TICK_MS);
    if (tick !== G.lastTick || resized) {
      G.lastTick = tick;
      const t0 = pnow();
      const out = R.render(G.sf, G.items, now);
      if (G.dirtyAll) { G.ctx.putImageData(G.img, 0, 0); G.dirtyAll = false; }
      else if (out.box) G.ctx.putImageData(G.img, 0, 0, out.box.x0, out.box.y0, out.box.x1 - out.box.x0 + 1, out.box.y1 - out.box.y0 + 1);
      G.cost.push(pnow() - t0); if (G.cost.length > 240) G.cost.shift();
      G.frames++;
      G.items = G.items.filter((it) => now - it.t0 < P.endOf(it.plan) + 100);
      if (!out.moving && !G.items.length) { hideIfEmpty(); return; }
      if (!out.moving) { G.raf = 0; G.idle = setTimeout(kick, nextChange(now)); return; }
    }
  } catch (err) { once(err); }
  G.raf = requestAnimationFrame(frame);
}
/* nothing moves: sleep until the next stage (drying, dissolve, retract) of any live item */
function nextChange(now) {
  let soon = 1000;
  for (const it of G.items) {
    const ms = now - it.t0, p = it.plan;
    const marks = p.kind === "blood" ? [p.life.wet, p.life.dry, Math.min(p.life.gone, Number.isFinite(it.cutAt) ? it.cutAt - it.t0 : Infinity)] : [p.life.gone - p.life.retract];
    for (const m of marks) if (m > ms) soon = Math.min(soon, m - ms);
  }
  return Math.max(16, soon - 10);
}
/* a splash's drawings are recorded ahead, one tick per task (a whole knock-down splash takes ~25 ms of recording: never one long task) */
function warmLater(it) {
  const plan = it.plan;
  if (plan.kind !== "blood") return;
  let k = 0;
  const step = () => {
    if (it.plan !== plan || k > R.SETTLED || !G.items.includes(it)) return;
    try { R.warm(plan, k, k); } catch (err) { once(err); return; }
    k++;
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
function kick() { clearTimeout(G.idle); if (!G.raf) G.raf = requestAnimationFrame(frame); }
function hideIfEmpty() {
  if (G.items.length || !G.ctx || !G.g) return;
  G.ctx.clearRect(0, 0, G.g.w, G.g.h);
  if (G.sf) { G.sf.rgba.fill(0); G.sf.T.fill(0); G.sf.C.fill(0); G.sf.box = null; }
}

/* ---------------- playing ---------------- */
let uid = 0;
/** play an effect on THIS seat. o = { strength 0..1.25, seed, dir (radians, the way the blood flies), at ({ fx, fy }), startAt (this
    page's performance.now() of the contact), raw (true: the strength as given, the table's level not applied) } -> handle | null */
function play(kind, o = {}) {
  try {
    const op = opts();
    const level = kind === "blood" ? op.blood : op.cracks;
    const s = o.raw ? P.scaled(o.strength ?? 0.5, 2) : P.scaled(o.strength ?? 0.5, level);
    if (!s) return null;
    const safe = photosensitive(), still = osReduced();
    const want = Number.isFinite(o.startAt) ? o.startAt : pnow();
    const t0 = P.arrivalAt(want, s, G.arrivals, safe);
    if (s >= P.BIG || safe) { G.arrivals.push(t0); G.arrivals = G.arrivals.filter((t) => t > pnow() - 3000); }
    const seed = o.seed ?? `${kind}|${++uid}|${Math.random()}`;
    const spec = { strength: s, seed, dir: Number.isFinite(o.dir) ? o.dir : null, at: o.at ?? null, safe, still, hold: op.hold };
    const make = (g) => (kind === "blood" ? P.bloodPlan(g, spec) : P.crackPlan(g, spec));
    if (!ensureGlass()) return null;
    fit();
    const it = { id: ++uid, kind, t0, make, plan: make(G.g) };
    G.items.push(it);
    warmLater(it);
    /* too many alive: the oldest blood dissolves now */
    const blood = G.items.filter((x) => x.kind === "blood" && !Number.isFinite(x.cutAt));
    if (G.items.length > P.MAX_LIVE && blood.length) blood[0].cutAt = pnow();
    kick();
    return { id: it.id, kind, startAt: t0, strength: s, stop: () => { it.cutAt = pnow(); kick(); } };
  } catch (err) { once(err); return null; }
}
function clear({ quick = false } = {}) {
  if (quick) { G.items = []; hideIfEmpty(); return; }
  const now = pnow();
  for (const it of G.items) { if (it.kind === "blood") it.cutAt = Math.min(it.cutAt ?? Infinity, now); else it.t0 = Math.min(it.t0, now - (it.plan.life.gone - it.plan.life.retract)); }
  kick();
}

/* ---------------- the table: a change of a character ---------------- */
const seen = new Map();        // token id -> { h, hm, r, rm }
const pending = new Map();     // token id -> { tok, changes: [], timer, waitHit, seed }
const lastPush = new Map();    // actor id -> Date.now() of a roll whose stress the character chose
const attacks = new Map();     // combat id -> { who, t }
const sources = new Map();     // target token id -> { src token id, t }
const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.round(Number(v)) : null);
function read(actor) {
  const d = actor?.system?.derived;
  return d ? { h: num(d.health?.value), hm: num(d.health?.max), r: num(d.resolve?.value), rm: num(d.resolve?.max) } : null;
}
function remember(tok) { try { const v = read(tok?.actor); if (v && tok?.id) seen.set(tok.id, v); } catch (e) { once(e); } }
function rememberAll() { seen.clear(); try { for (const t of canvas?.tokens?.placeables ?? []) remember(t); } catch (e) { once(e); } }

/** whether THIS seat may be shown an effect of this token (the table's "who sees it"; never a token this seat does not see) */
export function mayShow({ gm, sameScene, visible, hidden, owner }, seats = "all") {
  if (!sameScene || !visible) return false;
  if (hidden && !gm) return false;
  if (seats === "owners") return gm || owner;
  return true;
}
function seatMay(tok) {
  try {
    const gm = !!game.user?.isGM;
    return mayShow({ gm, sameScene: tok.scene?.id === canvas.scene?.id, visible: (tok.isVisible ?? tok.visible) !== false, hidden: tok.document?.hidden === true,
      owner: !!tok.actor?.testUserPermission?.(game.user, "OWNER") }, opts().seats);
  } catch { return false; }
}
function changed(tok, options) {
  try {
    if (!tok?.id || !tok.actor) return;
    const was = seen.get(tok.id), now = read(tok.actor);
    if (!now) return;
    seen.set(tok.id, now);
    if (!was) return;
    for (const [stat, a, b, m] of [["health", was.h, now.h, now.hm], ["resolve", was.r, now.r, now.rm]]) {
      if (a === null || b === null || !(b < a)) continue;
      let e = pending.get(tok.id);
      if (!e) { e = { tok, changes: [], stamp: options?.modifiedTime ?? null }; pending.set(tok.id, e); }
      e.changes.push({ stat, from: a, to: b, max: m, type: tok.actor.type, push: stat === "resolve" && Date.now() - (lastPush.get(tok.actor.id) ?? -1e9) < PUSH_MS && !options?.ipuTactics });
      clearTimeout(e.timer);
      e.timer = setTimeout(() => settle(tok.id), QUIET);
    }
  } catch (err) { once(err); }
}
function reactionsOn() { try { return game.settings.get(MOD, "tokenReactEnabled") !== false; } catch { return false; } }
function settle(id) {
  const e = pending.get(id);
  if (!e) return;
  if (!reactionsOn()) { fire(id, pnow()); return; }
  e.waitHit = true;
  e.timer = setTimeout(() => fire(id, pnow()), HIT_WAIT);
}
function onReact(d) {
  try {
    if (d?.phase !== "hit" || !Array.isArray(d.ids)) return;
    const at = Number.isFinite(d.at) ? d.at : pnow();
    for (const id of d.ids) { const e = pending.get(id); if (e) { clearTimeout(e.timer); fire(id, at); } }
  } catch (err) { once(err); }
}
function fire(id, at) {
  const e = pending.get(id);
  pending.delete(id);
  if (!e) return;
  clearTimeout(e.timer);
  try {
    const tok = canvas.tokens?.get(id) ?? e.tok;
    if (!tok || !seatMay(tok)) return;
    const seedBase = `${tok.id}|${e.stamp ?? e.changes.map((c) => `${c.stat}${c.from}>${c.to}`).join(",")}`;
    const dir = dirOf(tok);
    const done = new Set();
    for (const c of e.changes) {
      const fx = P.effectOf(c);
      if (!fx || done.has(fx.kind)) continue;
      done.add(fx.kind);
      play(fx.kind, { strength: fx.strength, seed: `${seedBase}|${fx.kind}`, dir: fx.kind === "blood" ? dir : null, startAt: at });
    }
  } catch (err) { once(err); }
}
/* the way the blood flies: from the attacker through the struck token (the world's direction: the same on every seat), else the seed's */
function dirOf(tok) {
  try {
    const s = sources.get(tok.id);
    if (!s || Date.now() - s.t > ATTACK_MS) return null;
    const src = canvas.tokens?.get(s.src);
    if (!src || src.id === tok.id || !seatMay(src)) return null;
    const a = src.center, b = tok.center;
    return Math.atan2(b.y - a.y, b.x - a.x);
  } catch { return null; }
}
function onTactics(ev) {
  try {
    if (!ev || typeof ev !== "object" || !ev.combat) return;
    if (ev.type === "roll" && ev.key === "attack" && typeof ev.who === "string") { attacks.set(ev.combat, { who: ev.who, t: Date.now() }); return; }
    if (ev.type !== "damage" || ev.source === "hazard") return;
    const a = attacks.get(ev.combat);
    if (!a || Date.now() - a.t > ATTACK_MS) return;
    const cmb = game.combats?.get(ev.combat);
    const target = typeof ev.target === "string" ? ev.target : ev.target?.combatant;
    const tgt = cmb?.combatants?.get(target)?.token?.id, src = cmb?.combatants?.get(a.who)?.token?.id;
    if (tgt && src) sources.set(tgt, { src, t: Date.now() });
  } catch (err) { once(err); }
}
function onMessage(m) {
  try { if (m?.speakerActor && m.rolls?.some?.((r) => choseStress(r))) lastPush.set(m.speakerActor.id, Date.now()); } catch { /* a courtesy */ }
}

/* ---------------- everyone's call: the same effect on every seat ---------------- */
function send(op, o = {}) {
  try {
    const at = Clock.toServer(Number.isFinite(o.startAt) ? o.startAt : pnow() + 120);
    const seed = o.seed ?? `${op}|${game.user?.id}|${Date.now()}`;
    const msg = { k: "gore", op, o: { ...o, seed, startAt: undefined }, at };
    game.socket?.emit(CHANNEL, msg);
    return receive(msg);
  } catch (err) { once(err); return null; }
}
function receive(msg) {
  if (!msg || msg.k !== "gore") return null;
  if (msg.op === "clear") { clear(msg.o ?? {}); return null; }
  if (msg.op !== "blood" && msg.op !== "cracks") return null;
  const o = msg.o && typeof msg.o === "object" ? msg.o : {};
  return play(msg.op, { strength: Number(o.strength), seed: String(o.seed ?? ""), dir: Number.isFinite(o.dir) ? o.dir : null,
    at: o.at && Number.isFinite(o.at.fx) && Number.isFinite(o.at.fy) ? { fx: o.at.fx, fy: o.at.fy } : null, startAt: Number.isFinite(msg.at) ? Clock.toPage(msg.at) : pnow() });
}

export const api = {
  /** blood on THIS screen: { strength 0..1 (1 = a knock-down), dir, at: { fx, fy }, seed, startAt, raw } -> handle | null */
  blood: (o) => play("blood", o),
  /** cracks on THIS screen: { strength, at, seed, startAt, raw } */
  cracks: (o) => play("cracks", o),
  clear,
  /** the same effect on EVERY seat at one instant (each seat still applies the table's options and its own accessibility) */
  net: { blood: (o) => send("blood", o), cracks: (o) => send("cracks", o), clear: (o) => send("clear", o) },
  /** a sample on this screen (the table window's Preview) */
  preview() {
    const t = pnow();
    play("blood", { strength: 0.35, seed: "preview|1", dir: 0.3, startAt: t, raw: true });
    play("cracks", { strength: 0.6, seed: "preview|2", startAt: t + 700, raw: true });
    play("blood", { strength: 1, seed: "preview|3", dir: 2.6, startAt: t + 1400, raw: true });
  },
  state: () => {
    const c = [...G.cost].sort((a, b) => a - b);
    return { live: G.items.length, grid: G.g ? { w: G.g.w, h: G.g.h, px: G.g.px, dpr: G.g.dpr } : null, frames: G.frames, running: !!G.raf,
      costMs: c.length ? { p50: c[Math.floor(c.length / 2)], p95: c[Math.floor(c.length * 0.95)], max: c[c.length - 1], n: c.length } : null,
      pending: pending.size, opts: opts(), safe: photosensitive(), still: osReduced() };
  },
  resetCost: () => { G.cost = []; G.frames = 0; }
};

function registerHooks() {
  Hooks.on("canvasReady", () => { rememberAll(); pending.clear(); clear({ quick: true }); });
  Hooks.on("drawToken", (tok) => { if (!seen.has(tok.id)) remember(tok); });
  Hooks.on("updateActor", (actor, changes, options) => {
    try {
      const d = changes?.system?.derived;
      if (!d || (!("health" in d) && !("resolve" in d))) return;
      for (const tok of actor.getActiveTokens?.(true) ?? []) changed(tok, options);
    } catch (err) { once(err); }
  });
  Hooks.on("updateToken", (doc, changes, options) => { try { if (changes?.delta || changes?.actorData) changed(doc.object, options); } catch (err) { once(err); } });
  Hooks.on("deleteToken", (doc) => { seen.delete(doc.id); pending.delete(doc.id); });
  Hooks.on(REACT_HOOK, onReact);
  Hooks.on(TAC_HOOK, onTactics);
  Hooks.on(TAC_HOOK_GM, onTactics);
  Hooks.on("createChatMessage", onMessage);
  Hooks.on("updateChatMessage", onMessage);
  window.addEventListener("resize", () => { if (G.items.length) kick(); });
}
export function start(phases = {}) {
  try {
    if (started) return true;
    started = true;
    const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
    run("init", () => { try { registerSettings(); registerHooks(); } catch (err) { once(err); } });
    run("ready", () => {
      try {
        if (canvas?.ready) rememberAll();
        game.socket?.on(CHANNEL, (msg) => { try { receive(msg); } catch (err) { once(err); } });
        const mod = game.modules.get(MOD);
        if (mod) mod.api = Object.assign(mod.api ?? {}, { gore: api });
        globalThis.PlusUltraGore = api;
      } catch (err) { once(err); }
    });
    return true;
  } catch (err) { console.warn(LOG, "start failed", err); return false; }
}
