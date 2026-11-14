/* TOKANIM: THE TOKEN ITSELF REACTS, the Foundry half. The curves are pure.mjs; here the pose is put on the token's picture.
   - react(tok, spec) is called by the token reactions (scripts/tokenreact/main.mjs play) for every reaction this seat letters, with the
     kind and amount of the reaction, the same on every seat that sees the token (PRIV, owner 2026-11-14: no lighter reaction for a player) and the shared contact instant of
     the word (every seat computes the same instant from the same start: the token moves on the word's blow, with the impact frame);
   - the pose is applied ONLY FOR THE LENGTH OF ONE DRAWING: on the renderer's "prerender" the picture (token.mesh) gets the pose on
     top of whatever Foundry, the map module's token effects or anything else set this frame, and on "postrender" every value is put
     back exactly. Nobody else ever reads our pose: the token's document, its x / y, its movement, Foundry's own animation, the action
     camera and other modules' token effects (moinen-maps tokens/fx.mjs owns the mesh pose its own way) are never touched or fought;
     a frame that dies between the two (a lost context) is healed at the start of the next tick;
   - a token that is deleted, hidden from this user, out of this user's sight, or on another scene stops at once; a scene change drops
     everything; a newer reaction takes over from an older one on the same token (pure TAKEOVER); nothing runs while nothing plays
     (the listeners come off);
   - reduced motion (the OS switch, the lettering's Motion setting, Foundry's low performance mode) keeps only a short tint, the
     lettering's flash / photosensitivity settings soften the tint, "Gentle" halves the moves, each user may switch it off on his screen;
   - while the map module shows a token as dead (its death style, token._mmDead) the body is the map's: ours keeps only the tint.
   - KODOWN (owner 2026-11-14, «Tak»): a token at 0 Health LIES until it gets up or is healed. Lying is a state per token (`lying`, pure
     lyingAt), read from the character on this seat (state.mjs: a yes / no only) when the scene loads, when a token is drawn and when its
     Health changes; drawn under the reactions on every frame while it lasts, the same way as a reaction (on the picture, for one drawing).
     The fall and the rise follow the reaction's blow when one comes (react); with no reaction on this seat in LIE.grace the state change
     itself makes it fall or rise. "Off" for a lying token (provisional KODOWN-1): the GM's table switch off, "None" for going down, or
     the seat's own "Off" = nothing lies (the picture as Foundry draws it); reduced motion = the dim alone, no tipping; the map's death
     look (`_mmDead`) = nothing of ours lies (the map owns the body and the look).
   Settings: world tokenAnimOn (the GM: for the table), world tokenAnimEvents (per event: animation, intensity), client tokenAnimMine. */
import * as P from "./pure.mjs";
import * as S from "./state.mjs";
import { t } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (token animations) |`;
export const KEY = { on: "tokenAnimOn", events: "tokenAnimEvents", mine: "tokenAnimMine" };
export const MINE = ["full", "gentle", "off"];
const LAYERS_MAX = 3;

let started = false, warned = false, engine = null;
const active = new Map();     // token id -> { tok, layers: [layer] } (oldest first)
const lying = new Map();      // KODOWN: token id -> { side, fallAt, upAt } (pure LIE): a token down at 0 Health on this scene
const known = new Map();      // KODOWN: token id -> down (this seat's last read), to tell a change from a first look
const saved = [];             // [{ m, x, y, r, sx, sy, tint, tinted }] what this drawing changed, put back on postrender
let depth = 0, renderer = null, ticking = false, lieWanted = false;
const pose = {}, basePose = {};
const stats = { frames: 0, applied: 0, restored: 0, healed: 0, ms: 0, maxMs: 0 };
const recent = [];             // the last reactions started on this seat (api state: live checks compare seats on the shared clock)

const once = (e) => { if (!warned) { warned = true; console.warn(LOG, "a failure here never affects the canvas:", e); } };
const get = (key, fallback) => { try { return game.settings.get(MOD, key); } catch { return fallback; } };
export const worldOn = () => get(KEY.on, true) !== false;
export const events = () => P.cleanEvents(get(KEY.events, null));
export const mine = () => { const v = get(KEY.mine, "full"); return MINE.includes(v) ? v : "full"; };
const now = () => performance.now();

/* ---------- what this seat may see ---------- */
/** the token is drawn for this user now: on the viewed scene, not hidden from a player, in sight (Foundry's own visibility) */
export function seen(tok) {
  try {
    if (!tok || tok.destroyed || !tok.mesh || tok.mesh.destroyed) return false;
    if (tok.scene?.id !== canvas.scene?.id) return false;
    if (tok.document?.hidden === true && !game.user?.isGM) return false;
    return tok.visible !== false && tok.mesh.visible !== false;
  } catch { return false; }
}
function letrPrefs() { try { return (engine ?? globalThis.MoinenLetters?._engine)?.prefs ?? null; } catch { return null; } }
function osReduced() { try { return !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches; } catch { return false; } }
function low() { try { return canvas?.performance?.mode === CONST.CANVAS_PERFORMANCE_MODES.LOW; } catch { return false; } }
export function mode() { const p = letrPrefs(); return P.modeOf({ mine: mine(), letr: p?.motion ?? "auto", osReduced: osReduced(), low: low() }); }
const tintK = () => { const p = letrPrefs(); return P.tintK({ flashes: p?.flashes !== false, photosafe: p?.photosafe !== false }); };

/** the way away from the blow: from the attacker's centre to the token's, only when this seat sees the attacker (a direction must
    not point at a hidden one: the impact frame's rule); else null (the seed picks a side, the same on every seat) */
function dirFrom(tok, src) {
  try {
    if (!src || src === tok || src.id === tok.id || !seen(src)) return null;
    const a = src.center, b = tok.center, dx = b.x - a.x, dy = b.y - a.y;
    return Math.hypot(dx, dy) > 1 ? { x: dx, y: dy } : null;
  } catch { return null; }
}

/** One reaction of one token on this seat. spec = { kind, amt, step, seed, at (the contact instant, performance.now ms), from (Token) ,
    anim?, strength? (a preview's own choice) } -> the layer or null */
export function react(tok, spec = {}) {
  try {
    if (!started || !tok || !spec.kind) return null;
    const preview = !!spec.preview;
    const at = Number.isFinite(spec.at) ? spec.at : now();
    /* KODOWN: a reaction of the table (never a preview) re-reads the token's state: down -> it lies from this blow on, up -> it rises on it */
    const down = preview ? false : lieLook(tok, "reaction");
    if (!preview && !worldOn()) { lieSync(tok, spec.kind, at, null); return null; }
    const m = mode();
    const row = events()[spec.kind];
    if (m === "off" || !seen(tok) || !row) { if (!preview) lieSync(tok, spec.kind, at, null); return null; }
    let anim = spec.anim;
    /* a challenge does not fall (state.mjs faller): a topple chosen for going down is a heavy blow there, so nothing tips and stands back up */
    if (!preview && spec.kind === "down" && (anim ?? row.anim) === "collapse" && !S.faller(tok)) anim = "stagger";
    const lie = !preview && down && spec.kind === "down" && lieOn();
    const L = P.plan(spec.kind, { row, anim, strength: spec.strength ?? row.str, amt: spec.amt, step: spec.step, seed: spec.seed ?? tok.id, at, dir: dirFrom(tok, spec.from), mode: m, tk: tintK(), lie, lieSide: P.lieSide(tok.id) });
    if (!preview) lieSync(tok, spec.kind, at, L);
    if (!L) return null;
    let a = active.get(tok.id);
    if (!a || a.tok !== tok) { a = { tok, layers: [] }; active.set(tok.id, a); }
    a.layers.push(L);
    a.layers.sort((x, y) => x.at - y.at);
    while (a.layers.length > LAYERS_MAX) a.layers.shift();
    recent.push({ tok: tok.id, kind: L.kind, anim: L.anim, A: L.A, step: L.step, dur: L.dur, side: L.c.side, atEpoch: Math.round((performance.timeOrigin + L.at) * 10) / 10, preview });
    if (recent.length > 40) recent.shift();
    attach();
    return L;
  } catch (err) { once(err); return null; }
}
/** a preview on this screen only (the panel): the chosen animation and intensity, now */
export function preview(tok, kind, o = {}) {
  return react(tok, { kind, preview: true, amt: o.amt ?? 0.4, step: o.step ?? 0, seed: `${tok?.id}|preview|${Math.round(now())}`, at: now() + (o.delay ?? 60), anim: o.anim, strength: o.strength });
}
/** a series on this screen only: hit, hit, heavy, down, each a step further (the lettering's series) */
export const SERIES = [["hit", 0, 0.25], ["hit", 1, 0.25], ["heavy", 2, 0.5], ["down", 3, 0.8]];
export const SERIES_GAP = [0, 900, 1900, 3100];
export function series(tok, o = {}) {
  return SERIES.map(([kind, step, amt], i) => react(tok, { kind, step, amt, preview: true, seed: `${tok?.id}|series|${i}`, at: now() + 60 + SERIES_GAP[i], anim: o.anims?.[kind], strength: o.strengths?.[kind] }));
}
export function stop(id) { active.delete(id); }
export function stopAll() { active.clear(); }

/* ---------- KODOWN: lying while Health is 0 ---------- */
/** lying is drawn at all: the GM's table switch on and going down not set to "None" (the seat's own Off and reduced motion: per frame) */
export const lieOn = () => worldOn() && events().down?.anim !== "none";
/** read the token's state now. how: "instant" (the scene loads, the token is drawn, a seat joins: already lying, no fall), "change" (its
    Health changed: fall / rise after LIE.grace unless a reaction comes first), "reaction" (a reaction: the state is read, lieSync times it).
    -> down */
function lieLook(tok, how) {
  const id = tok?.id;
  if (!id) return false;
  const down = S.downOf(tok), was = known.get(id), t0 = now();
  known.set(id, down);
  const e = lying.get(id);
  if (down) {
    if (e && !Number.isFinite(e.upAt)) return true;                       // lying already, or its fall is coming
    if (e && e.upAt > t0) { e.upAt = Infinity; return true; }             // its rise had not begun: stays down
    const first = how === "instant" || (was === undefined && how !== "reaction");
    if (e) {                                                              // it was rising: falls back from where it is
      const a = P.lieAmount(e, t0);
      e.upAt = Infinity; e.fallAt = first ? -Infinity : t0 - P.LIE.fallMs * Math.sqrt(a);
    } else lying.set(id, { side: P.lieSide(id), fallAt: first ? -Infinity : t0 + P.LIE.grace, upAt: Infinity });
    attach();
  } else if (e) {
    if (how === "instant" || e.fallAt > t0) lying.delete(id);              // never fell (or a fresh look: up already)
    else if (!Number.isFinite(e.upAt)) e.upAt = how === "change" ? t0 + P.LIE.grace : e.upAt;
  }
  return down;
}
/** a reaction's blow times the fall or the rise: the same contact instant on every seat that letters it */
function lieSync(tok, kind, at, L) {
  const e = lying.get(tok?.id);
  if (!e) return;
  const t0 = now();
  if (known.get(tok.id)) {
    if (kind === "down" && e.fallAt > t0) e.fallAt = Math.max(t0, L ? P.lieFallAt(L) : at + P.LIE.fallDelay);
  } else if (!(e.upAt <= t0)) e.upAt = Math.max(t0, at);
}
/** every token of the viewed scene read again (the scene is ready, the GM turned it back on) */
function lieScan(how = "instant") {
  try { for (const tok of canvas?.tokens?.placeables ?? []) lieLook(tok, how); } catch (err) { once(err); }
  if (lying.size) attach();
}
/* a setting changed: draw again (a lying token stands as Foundry draws it while "off", and lies again at once when it comes back on) */
function refresh() { try { if (lying.size || active.size) attach(); } catch (err) { once(err); } }

/* ---------- the drawing: our pose on for one render, everything back after it ---------- */
function onPre() {
  if (depth++ > 0) return;
  if (saved.length) restore();      // a drawing that never finished (should not happen): put it back first
  if (!active.size && !lying.size) return;
  const t0 = now();
  stats.frames++;
  try {
    /* KODOWN: the lying tokens too, when lying is drawn on this seat (the table's switch, "None" for going down, the seat's Off) */
    const md = lying.size ? mode() : "off";
    const lieDraw = lying.size > 0 && md !== "off" && lieOn();
    lieWanted = lieDraw;
    const ids = lieDraw ? new Set([...active.keys(), ...lying.keys()]) : active.keys();
    const tk = lieDraw ? tintK() : 1;
    for (const id of ids) {
      let a = active.get(id);
      let e = lieDraw ? lying.get(id) : null;
      if (e && P.lieDone(e, t0)) { lying.delete(id); e = null; }
      const tok = canvas.tokens?.get(id);
      if (a) {
        if (!seen(a.tok) || tok !== a.tok) { active.delete(id); a = null; }
        else {
          while (a.layers.length && t0 >= a.layers[0].at + a.layers[0].dur && !(a.layers[1] && t0 < a.layers[1].at)) a.layers.shift();
          if (!a.layers.length || a.layers.every((L) => t0 >= L.at + L.dur)) { active.delete(id); a = null; }
        }
      }
      if (!a && !e) continue;
      if (!seen(tok)) continue;                                            // a lying token this seat does not see: nothing drawn, the state kept
      const lieBase = e && tok._mmDead !== true ? P.lyingAt(e, t0, basePose, { still: md === "still", tk }) : null;
      P.mix(a?.layers ?? [], t0, pose, lieBase);
      if (P.isRest(pose)) continue;
      if (tok._mmDead === true) { pose.x = 0; pose.y = 0; pose.rot = 0; pose.sx = 1; pose.sy = 1; }      // the map's death look owns the body
      const m = tok.mesh;
      const tintNum = Number(m.tint);
      const base = { x: m.position.x, y: m.position.y, rotation: m.rotation, sx: m.scale.x, sy: m.scale.y, tint: Number.isFinite(tintNum) ? tintNum : 0xffffff };
      const w = Number(tok.w) || (tok.document?.width ?? 1) * (canvas.grid?.size ?? 100);
      const out = P.apply(base, pose, { w, h: w });
      const tinted = pose.tk > 0.003;
      saved.push({ m, x: base.x, y: base.y, r: base.rotation, sx: base.sx, sy: base.sy, tint: m.tint, tinted });
      m.position.set(out.x, out.y);
      m.rotation = out.rotation;
      m.scale.set(out.sx, out.sy);
      if (tinted) m.tint = out.tint;
      stats.applied++;
    }
  } catch (err) { once(err); }
  const dt = now() - t0;
  stats.ms += dt; stats.maxMs = Math.max(stats.maxMs, dt);
}
function onPost() {
  if (depth > 0) depth--;
  if (depth > 0) return;
  restore();
  if (!active.size && !(lieWanted && lying.size)) detach();
}
function restore() {
  for (let i = saved.length - 1; i >= 0; i--) {
    const s = saved[i];
    try {
      if (!s.m || s.m.destroyed) continue;
      s.m.position.set(s.x, s.y);
      s.m.rotation = s.r;
      s.m.scale.set(s.sx, s.sy);
      if (s.tinted) s.m.tint = s.tint;
      stats.restored++;
    } catch (err) { once(err); }
  }
  saved.length = 0;
}
/* the start of every tick: a drawing whose postrender never came (a lost WebGL context skips it) is put back before Foundry refreshes */
function guard() { if (saved.length || depth) { stats.healed++; depth = 0; restore(); } }
function attach() {
  try {
    const r = canvas?.app?.renderer;
    if (!r) return;
    if (renderer !== r) { detach(); renderer = r; r.on("prerender", onPre); r.on("postrender", onPost); }
    if (!ticking && canvas.app.ticker) { canvas.app.ticker.add(guard, null, (globalThis.PIXI?.UPDATE_PRIORITY?.INTERACTION ?? 50) + 1); ticking = true; }
  } catch (err) { once(err); }
}
function detach() {
  try {
    if (saved.length) restore();
    depth = 0;
    if (renderer) { renderer.off("prerender", onPre); renderer.off("postrender", onPost); }
    renderer = null;
    if (ticking) { canvas?.app?.ticker?.remove(guard); ticking = false; }
  } catch (err) { once(err); }
}

/* ---------- settings, hooks, start ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  if (!has(KEY.on)) game.settings.register(MOD, KEY.on, { scope: "world", config: false, type: Boolean, default: true, onChange: (v) => { if (!v) stopAll(); refresh(); } });
  if (!has(KEY.events)) game.settings.register(MOD, KEY.events, { scope: "world", config: false, type: Object, default: P.cleanEvents(null), onChange: () => refresh() });
  if (!has(KEY.mine)) game.settings.register(MOD, KEY.mine, { name: t("ITA.Settings.Mine.Name"), hint: t("ITA.Settings.Mine.Hint"), scope: "client", config: true, type: String, default: "full",
    choices: Object.fromEntries(MINE.map((k) => [k, t(`ITA.Mine.${k}`)])), onChange: (v) => { if (v === "off") stopAll(); refresh(); } });
}
function registerHooks() {
  Hooks.on("canvasTearDown", () => { stopAll(); detach(); lying.clear(); known.clear(); });
  /* KODOWN: a scene that loads (a reload, a seat that joins, a scene change and back) shows every token at 0 Health lying at once */
  Hooks.on("canvasReady", () => { stopAll(); detach(); lying.clear(); known.clear(); lieScan("instant"); });
  Hooks.on("drawToken", (tok) => { try { if (started && tok?.id && !known.has(tok.id)) lieLook(tok, "instant"); } catch (err) { once(err); } });
  Hooks.on("updateActor", (actor, changes) => { try { if (S.healthTouched(changes)) for (const tok of S.tokensOf(actor)) lieLook(tok, "change"); } catch (err) { once(err); } });
  Hooks.on("updateToken", (doc, ch) => { try { if (ch && (ch.delta || ch.actorData) && doc?.object) lieLook(doc.object, "change"); } catch (err) { once(err); } });
  Hooks.on("deleteToken", (doc) => { try { stop(doc.id); lying.delete(doc.id); known.delete(doc.id); } catch (err) { once(err); } });
  Hooks.on("updateToken", (doc, ch) => { try { if (ch && "hidden" in ch && ch.hidden && !game.user.isGM) stop(doc.id); } catch (err) { once(err); } });
}
export function start(phases = {}) {
  try {
    if (started) return true;
    started = true;
    const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
    run("init", () => { try { registerSettings(); registerHooks(); } catch (err) { once(err); } });
    run("ready", () => {
      try { if (canvas?.ready && !known.size) lieScan("instant"); } catch (err) { once(err); }      // KODOWN: loaded after the scene was
      import("../letters/index.mjs").then(({ letters }) => letters()).then((L) => { engine = L; }).catch(() => { /* no engine: default prefs */ });
      import("./panel.mjs").then((Panel) => Panel.start()).catch((err) => console.warn(LOG, "panel not loaded", err));
    });
    Hooks.once("ready", () => setTimeout(() => {
      try {
        const mod = game.modules.get(MOD);
        if (mod) mod.api = Object.assign(mod.api ?? {}, { tokenAnim: { react, preview, series, stop, stopAll, mode, events, anims: P.ANIM_IDS.slice(), lying: () => [...lying.entries()].map(([id, e]) => ({ id, side: e.side, fallAt: e.fallAt, upAt: e.upAt, amount: Math.round(P.lieAmount(e, now()) * 1000) / 1000 })), state: () => ({ active: active.size, lying: lying.size, layers: [...active.values()].reduce((n, a) => n + a.layers.length, 0), attached: !!renderer, saved: saved.length, depth, stats: { ...stats }, recent: recent.slice() }) } });
      } catch (err) { once(err); }
    }, 0));
    return true;
  } catch (err) { console.warn(LOG, "start failed", err); return false; }
}
/* for the node checks */
export const _test = { onPre, onPost, guard, active, saved, stats, attach, detach, lying, known, lieScan, setEngine: (L) => { engine = L; }, setStarted: (v) => { started = v; } };
