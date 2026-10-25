/* Dice effects, part of Invincible - Plus Ultra: comic effects UNDER the Dice So Nice dice once each die has come to rest. A golden halftone burst under a
   6, a magenta X in a halftone ring under a 1. Started from scripts/module.js by a guarded dynamic import (start() below), the same way as the turn UX,
   the party cards and the splash: a file added to module.json would need a server restart, an import from an already registered script does not.
   art.mjs = the drawings (pure SVG strings), this file = settings, the Dice So Nice watcher, projection and the DOM layer, styles/diceeffects.css = the motion.

   WHAT DICE SO NICE GIVES US (read from dice-so-nice 6.2.6, module/Dice3D.js, rendering/DiceBox.js, engine/ThrowEngine.js):
     - game.dice3d.box is the DiceBox; box.throwEngine holds the meshes: diceList (the current throw), deadDiceList (earlier throws until they are cleared).
     - diceSoNiceRollStart(messageId, context) fires for every 3D roll this client shows (also direct showForRoll calls); context.roll / .user / .blind.
       diceSoNiceRollComplete only fires for rolls that belong to a chat message and only after the whole throw, so it is not used here.
     - The whole throw is simulated first (a physics worker) and then PLAYED BACK: throwEngine.rolling is true during playback, throwEngine.iteration counts
       the played frames of iterationsNeeded, framerate / speed give the wall time of a frame. Each mesh has sim.stepPositions / sim.stepQuaternions (one entry
       per iteration), so the iteration at which a die stops moving is known as soon as playback starts, and the effect can appear exactly when that die lands.
     - mesh.forcedResult is the value the die shows (the number from the roll), mesh.shape the shape ("d6" for the base / skill / gear dice "db"... and a plain
       d6), mesh.options.ghost / .secret mark dice hidden or ghosted for this client, mesh.userData.persistent the tabletop dice (skipped here).
     - Screen position: the mesh's matrixWorld translation projected with box.camera (a PerspectiveCamera looking down at the table) into #dice-box-canvas's
       rectangle (that div covers the dice area, not necessarily the window). The on-screen die size comes from projecting the mesh's bounding-sphere radius.
     - Layering: #dice-box-canvas is a div with a z-index (the "auto" mode raises it with every use; "over" is 1000; the default sits right after #board).
       This feature inserts its own layer as the previous sibling of that div and copies its z-index: equal z-index, earlier in the DOM = painted just under the
       dice and above everything else that was below them. The z-index is re-read at every effect.
   LIMITS: the dice canvas is one WebGL layer, so the effect can never be "between" two dice, only under all of them; with ghost dice (hidden rolls) or a
   different 3D layout (rolling area) the position still follows the canvas rectangle. Dice that are thrown again by the user (persistent dice) are skipped.
   If Dice So Nice is missing or its internals change, nothing is drawn and nothing throws (every body is wrapped and logs once). */
import { t } from "./lang.mjs";
import { svg } from "./art.mjs";

const MOD = "invincible-plus-ultra";
const SYSTEM = "invincible";
const LOG = `${MOD} (dice effects) |`;
const KEY = { enabled: "diceFxEnabled", strength: "diceFxStrength", sixes: "diceFxSixes", ones: "diceFxOnes", oneStyle: "diceFxOneStyle", onesPush: "diceFxOnesPushOnly" };
const LAYER_ID = "isp-dice-fx";

let started = false, warned = false;
const hookIds = [];
const get = (key) => { try { return game.settings.get(MOD, key); } catch { return undefined; } };
const once = (e) => { if (!warned) { warned = true; console.warn(LOG, "a failure here never affects the dice:", e); } };
const strength = () => { const s = get(KEY.strength); return s === "off" || s === "bold" ? s : "subtle"; };
const active = () => get(KEY.enabled) !== false && strength() !== "off";

/* ---------- settings (client scope, registered in init) ---------- */
function registerSettings() {
  const has = (key) => game.settings.settings.has(`${MOD}.${key}`);
  const bool = (key, name, def) => {
    if (!has(key)) game.settings.register(MOD, key, { name: t(`IDF.Settings.${name}.Name`), hint: t(`IDF.Settings.${name}.Hint`), scope: "client", config: true, type: Boolean, default: def, onChange: () => { if (!active()) clearAll(true); } });
  };
  bool(KEY.enabled, "Enabled", true);
  if (!has(KEY.strength)) game.settings.register(MOD, KEY.strength, {
    name: t("IDF.Settings.Strength.Name"), hint: t("IDF.Settings.Strength.Hint"), scope: "client", config: true, type: String, default: "subtle",
    choices: { off: t("IDF.Settings.Strength.off"), subtle: t("IDF.Settings.Strength.subtle"), bold: t("IDF.Settings.Strength.bold") },
    onChange: () => { if (!active()) clearAll(true); }
  });
  if (!has(KEY.oneStyle)) game.settings.register(MOD, KEY.oneStyle, { scope: "client", config: false, type: String, default: "c" });   // hidden: "c" magenta X in a halftone ring (default) | "b" red burst
  bool(KEY.sixes, "Sixes", true);
  bool(KEY.ones, "Ones", true);
  bool(KEY.onesPush, "OnesPush", true);
}

/* ---------- the layer and the effects ---------- */
const live = new Set();          // { el, hold, off }: effects on screen
let layer = null;

function diceCanvas() { return document.getElementById("dice-box-canvas"); }

/* the layer: the previous sibling of the dice div, same z-index, so it paints just under the dice; re-attached on every use (the div can be rebuilt) */
function ensureLayer(canvasEl) {
  if (!layer) {
    layer = document.createElement("div");
    layer.id = LAYER_ID;
    layer.setAttribute("aria-hidden", "true");
  }
  if (layer.nextElementSibling !== canvasEl) canvasEl.before(layer);
  const z = getComputedStyle(canvasEl).zIndex;
  layer.style.zIndex = z === "auto" ? "" : z;
  return layer;
}

function removeFx(fx, fast) {
  if (!live.has(fx)) return;
  live.delete(fx);
  clearTimeout(fx.hold); clearTimeout(fx.off);
  if (fast === true && !fx.el.isConnected) return;
  fx.el.classList.add(fast ? "is-out-fast" : "is-out");
  fx.off = setTimeout(() => fx.el.remove(), fast ? 220 : 520);
}
export function clearAll(instant = false) {
  for (const fx of [...live]) {
    if (instant) { live.delete(fx); clearTimeout(fx.hold); clearTimeout(fx.off); fx.el.remove(); }
    else removeFx(fx, true);
  }
  if (instant && layer) { layer.remove(); }
}

function holdMs() {
  try {
    const c = game.dice3d?.constructor?.CONFIG?.() ?? {};
    if (c.hideAfterRoll === false) return 30000;
    return Math.max(1500, (Number(c.timeBeforeHide) || 2000) + 300);
  } catch { return 2300; }
}

/* world -> screen with the box camera (no THREE import: the matrices are plain column-major arrays) */
function projector(box, rect) {
  const cam = box.camera;
  cam.updateMatrixWorld();
  const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements;
  return (x, y, z) => {
    const vx = V[0] * x + V[4] * y + V[8] * z + V[12], vy = V[1] * x + V[5] * y + V[9] * z + V[13], vz = V[2] * x + V[6] * y + V[10] * z + V[14];
    const w = P[3] * vx + P[7] * vy + P[11] * vz + P[15];
    const nx = (P[0] * vx + P[4] * vy + P[8] * vz + P[12]) / w, ny = (P[1] * vx + P[5] * vy + P[9] * vz + P[13]) / w;
    return [rect.left + ((nx + 1) / 2) * rect.width, rect.top + ((1 - ny) / 2) * rect.height];
  };
}

/* where the die is and how big it is on screen: { x, y, r } in client pixels, or null */
function place(box, mesh) {
  const canvasEl = diceCanvas();
  if (!canvasEl || !mesh?.parent || !mesh.parent.parent) return null;       // cleared (parent removed from the scene)
  const rect = canvasEl.getBoundingClientRect();
  if (!(rect.width > 20 && rect.height > 20)) return null;
  mesh.parent.updateMatrixWorld(true);
  const m = mesh.matrixWorld.elements;
  const project = projector(box, rect);
  const [x, y] = project(m[12], m[13], m[14]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
  const s = Math.hypot(m[0], m[1], m[2]) || 1;
  const wr = (mesh.geometry.boundingSphere?.radius ?? 0.35) * s;
  const [x2] = project(m[12] + wr, m[13], m[14]);
  const r = Math.abs(x2 - x);
  return { x, y, r: Number.isFinite(r) && r > 4 ? r : 40, rect, canvasEl };
}

function spawn(kind, mesh, box) {
  try {
    if (!active()) return;
    const p = place(box, mesh);
    if (!p) return;
    const bold = strength() === "bold";
    const D = Math.round(Math.min(360, Math.max(80, p.r * (bold ? 3.3 : 2.9))));
    const host = ensureLayer(p.canvasEl);
    const el = document.createElement("div");
    el.className = `isp-dfx isp-dfx-${kind}${bold ? " is-bold" : ""}`;
    el.style.cssText = `left:${(p.x - p.rect.left + 0).toFixed(1)}px;top:${(p.y - p.rect.top).toFixed(1)}px;width:${D}px;height:${D}px;margin:${-D / 2}px 0 0 ${-D / 2}px`;
    host.style.left = `${p.rect.left}px`; host.style.top = `${p.rect.top}px`; host.style.width = `${p.rect.width}px`; host.style.height = `${p.rect.height}px`;
    el.innerHTML = svg(kind, `${mesh.uuid}:${kind}`, bold, get(KEY.oneStyle) === "b" ? "b" : "c");
    host.append(el);
    const fx = { el, hold: 0, off: 0 };
    live.add(fx);
    fx.hold = setTimeout(() => removeFx(fx, false), holdMs());
  } catch (e) { once(e); }
}

/* ---------- the Dice So Nice watcher ----------
   Armed by diceSoNiceRollStart. A 50 ms poll (only while a throw is being armed or played, never idle) waits for the playback of the throw, reads every
   eligible die once, works out the iteration at which it stops moving and schedules its effect for that moment. */
let pollTimer = 0, pollUntil = 0;
let armedPushed = false;          // the roll that armed the watcher is a PUSHED Year Zero roll (DSN then throws only the re-rolled dice)
const handled = new WeakSet();
const pending = new Set();        // { mesh, kind, timer, fired }

function eligible(mesh) {
  if (!mesh || handled.has(mesh)) return null;
  if (mesh.userData?.persistent || mesh.options?.ghost || mesh.options?.secret) return null;
  if (mesh.shape !== "d6") return null;
  const v = Number(mesh.forcedResult);
  if (v === 6 && get(KEY.sixes) !== false) return "six";
  if (v === 1 && get(KEY.ones) !== false && (armedPushed || get(KEY.onesPush) === false)) return "one";
  return null;
}

/* the iteration after which the die no longer moves (position and orientation within a small tolerance of the final pose), or null without sim data */
function settleIteration(te, mesh) {
  const sp = mesh.sim?.stepPositions, sq = mesh.sim?.stepQuaternions, n = te.iterationsNeeded;
  if (!sp || !sq || !(n > 0)) return null;
  const fx = sp[n * 3], fy = sp[n * 3 + 1], fz = sp[n * 3 + 2];
  const q = [sq[n * 4], sq[n * 4 + 1], sq[n * 4 + 2], sq[n * 4 + 3]];
  let k = n;
  while (k > 0) {
    const dp = Math.hypot(sp[k * 3] - fx, sp[k * 3 + 1] - fy, sp[k * 3 + 2] - fz);
    const dot = Math.abs(sq[k * 4] * q[0] + sq[k * 4 + 1] * q[1] + sq[k * 4 + 2] * q[2] + sq[k * 4 + 3] * q[3]);
    if (dp > 0.004 || dot < 0.9995) break;
    k--;
  }
  return Math.min(n, k + 2);
}

function arm(fx, te, box) {
  const iter = settleIteration(te, fx.mesh);
  const frame = (te.framerate || 1 / 60) / (te.speed || 1);
  const wait = iter == null ? 0 : Math.max(0, (iter - te.iteration) * frame * 1000);
  fx.timer = setTimeout(() => fire(fx, box), wait);
}
function fire(fx, box) {
  if (fx.fired) return;
  fx.fired = true; clearTimeout(fx.timer); pending.delete(fx);
  spawn(fx.kind, fx.mesh, box);
}

function tick() {
  try {
    const box = game.dice3d?.box, te = box?.throwEngine;
    if (!te || !active()) return stopPoll();
    if (te.rolling) {
      for (const mesh of te.diceList) {
        if (!mesh.sim?.stepPositions) continue;     // simulation data not attached yet: next tick
        const kind = eligible(mesh);
        handled.add(mesh);
        if (!kind) continue;
        const fx = { mesh, kind, timer: 0, fired: false };
        pending.add(fx);
        arm(fx, te, box);
      }
      pollSawRolling = true;
    } else if (pollSawRolling || performance.now() > pollUntil) {
      for (const fx of [...pending]) fire(fx, box);   // playback ended: anything still waiting appears now
      return stopPoll();
    }
  } catch (e) { once(e); stopPoll(); }
}
let pollSawRolling = false;
function stopPoll() { clearInterval(pollTimer); pollTimer = 0; pollSawRolling = false; }
function startPoll() {
  pollUntil = performance.now() + 20000;
  pollSawRolling = false;
  if (!pollTimer) pollTimer = setInterval(tick, 50);
}

/* Year Zero push: yzur marks every pushed die (the old result gets hidden: true so DSN skips it, the new die gets indexPush > 0) and YearZeroRoll#pushed /
   #pushCount say the roll was pushed. DSN's second showForRoll for the same roll therefore throws only the re-rolled dice, and context.roll is that roll. */
function isPushed(roll) {
  try { return !!(roll?.pushed || roll?.pushCount > 0 || roll?.terms?.some((x) => x?.pushed || x?.pushCount > 0)); } catch { return false; }
}

function onRollStart(messageId, context) {
  try {
    if (!active()) return;
    clearAll(false);                                  // a new throw: the previous marks go (DSN clears the old dice itself)
    for (const fx of pending) clearTimeout(fx.timer);
    pending.clear();
    if (context?.blind || context?.roll?.ghost || context?.roll?.secret) return;
    armedPushed = isPushed(context?.roll);
    startPoll();
  } catch (e) { once(e); }
}

/* ---------- lifecycle ---------- */
export function start(phases = {}) {
  if (started) return;
  started = true;
  const run = (name, fn) => { if (phases[name]) fn(); else Hooks.once(name, fn); };
  run("init", () => {
    try {
      if (game.system.id !== SYSTEM) return;
      registerSettings();
      hookIds.push(["diceSoNiceRollStart", Hooks.on("diceSoNiceRollStart", onRollStart)]);
    } catch (e) { console.warn(LOG, "start failed", e); }
  });
}

export function stop() {
  for (const [name, id] of hookIds.splice(0)) { try { Hooks.off(name, id); } catch { /* gone */ } }
  stopPoll();
  for (const fx of pending) clearTimeout(fx.timer);
  pending.clear();
  clearAll(true);
  layer?.remove(); layer = null;
  started = false;
}
