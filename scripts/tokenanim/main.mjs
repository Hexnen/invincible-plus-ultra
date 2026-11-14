/* TOKANIM: THE TOKEN ITSELF REACTS, the Foundry half. The curves are pure.mjs; here the pose is put on the token's picture.
   - react(tok, spec) is called by the token reactions (scripts/tokenreact/main.mjs play) for every reaction this seat letters, with the
     kind and amount THIS SEAT was shown (a player told less sees less, exactly like the lettering) and the shared contact instant of
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
   Settings: world tokenAnimOn (the GM: for the table), world tokenAnimEvents (per event: animation, intensity), client tokenAnimMine. */
import * as P from "./pure.mjs";
import { t } from "./lang.mjs";

const MOD = "invincible-plus-ultra";
const LOG = `${MOD} (token animations) |`;
export const KEY = { on: "tokenAnimOn", events: "tokenAnimEvents", mine: "tokenAnimMine" };
export const MINE = ["full", "gentle", "off"];
const LAYERS_MAX = 3;

let started = false, warned = false, engine = null;
const active = new Map();     // token id -> { tok, layers: [layer] } (oldest first)
const saved = [];             // [{ m, x, y, r, sx, sy, tint, tinted }] what this drawing changed, put back on postrender
let depth = 0, renderer = null, ticking = false;
const pose = {};
const stats = { frames: 0, applied: 0, restored: 0, healed: 0, ms: 0, maxMs: 0 };

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
    if (!preview && !worldOn()) return null;
    const m = mode();
    if (m === "off" || !seen(tok)) return null;
    const row = events()[spec.kind];
    if (!row) return null;
    const L = P.plan(spec.kind, { row, anim: spec.anim, strength: spec.strength ?? row.str, amt: spec.amt, step: spec.step, seed: spec.seed ?? tok.id, at: Number.isFinite(spec.at) ? spec.at : now(), dir: dirFrom(tok, spec.from), mode: m, tk: tintK() });
    if (!L) return null;
    let a = active.get(tok.id);
    if (!a || a.tok !== tok) { a = { tok, layers: [] }; active.set(tok.id, a); }
    a.layers.push(L);
    a.layers.sort((x, y) => x.at - y.at);
    while (a.layers.length > LAYERS_MAX) a.layers.shift();
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

/* ---------- the drawing: our pose on for one render, everything back after it ---------- */
function onPre() {
  if (depth++ > 0) return;
  if (saved.length) restore();      // a drawing that never finished (should not happen): put it back first
  if (!active.size) return;
  const t0 = now();
  stats.frames++;
  try {
    for (const [id, a] of active) {
      const tok = a.tok;
      if (!seen(tok) || canvas.tokens?.get(id) !== tok) { active.delete(id); continue; }
      while (a.layers.length && t0 >= a.layers[0].at + a.layers[0].dur && !(a.layers[1] && t0 < a.layers[1].at)) a.layers.shift();
      if (!a.layers.length || a.layers.every((L) => t0 >= L.at + L.dur)) { active.delete(id); continue; }
      P.mix(a.layers, t0, pose);
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
  if (!active.size) detach();
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
  if (!has(KEY.on)) game.settings.register(MOD, KEY.on, { scope: "world", config: false, type: Boolean, default: true, onChange: (v) => { if (!v) stopAll(); } });
  if (!has(KEY.events)) game.settings.register(MOD, KEY.events, { scope: "world", config: false, type: Object, default: P.cleanEvents(null) });
  if (!has(KEY.mine)) game.settings.register(MOD, KEY.mine, { name: t("ITA.Settings.Mine.Name"), hint: t("ITA.Settings.Mine.Hint"), scope: "client", config: true, type: String, default: "full",
    choices: Object.fromEntries(MINE.map((k) => [k, t(`ITA.Mine.${k}`)])), onChange: (v) => { if (v === "off") stopAll(); } });
}
function registerHooks() {
  Hooks.on("canvasTearDown", () => { stopAll(); detach(); });
  Hooks.on("canvasReady", () => { stopAll(); detach(); });
  Hooks.on("deleteToken", (doc) => { try { stop(doc.id); } catch (err) { once(err); } });
  Hooks.on("updateToken", (doc, ch) => { try { if (ch && "hidden" in ch && ch.hidden && !game.user.isGM) stop(doc.id); } catch (err) { once(err); } });
}
export function start(phases = {}) {
  try {
    if (started) return true;
    started = true;
    const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
    run("init", () => { try { registerSettings(); registerHooks(); } catch (err) { once(err); } });
    run("ready", () => {
      import("../letters/index.mjs").then(({ letters }) => letters()).then((L) => { engine = L; }).catch(() => { /* no engine: default prefs */ });
      import("./panel.mjs").then((Panel) => Panel.start()).catch((err) => console.warn(LOG, "panel not loaded", err));
    });
    Hooks.once("ready", () => setTimeout(() => {
      try {
        const mod = game.modules.get(MOD);
        if (mod) mod.api = Object.assign(mod.api ?? {}, { tokenAnim: { react, preview, series, stop, stopAll, mode, events, anims: P.ANIM_IDS.slice(), state: () => ({ active: active.size, layers: [...active.values()].reduce((n, a) => n + a.layers.length, 0), attached: !!renderer, saved: saved.length, depth, stats: { ...stats } }) } });
      } catch (err) { once(err); }
    }, 0));
    return true;
  } catch (err) { console.warn(LOG, "start failed", err); return false; }
}
/* for the node checks */
export const _test = { onPre, onPost, guard, active, saved, stats, attach, detach, setEngine: (L) => { engine = L; }, setStarted: (v) => { started = v; } };
