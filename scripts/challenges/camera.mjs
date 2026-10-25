/* Challenges HUD, optional cinematic camera. When a challenge ENTERS the scene (created visible, or un-hidden), LEAVES it (deleted, or hidden)
   or its numbers CHANGE (Challenge Rating / Time Limit, including reaching "overcome" or "time up"), the GM's canvas glides to the token,
   holds, and glides back. With the "Hot Pan & Zoom!" module (hot-pan) active, the players' views follow, because HotPan relays every canvasPan
   of the GM's canvas to the players (socketlib) while it is switched on.
   HotPan API used (modules/hot-pan/scripts/main.js, class HotPan on window): isOn(), switchOn(silent), switchBack(silent). Following its README:
     - switchOn(true) is silent (no UI messages); the GM's own preference is never overridden: when HotPan is already ON we do not touch it,
       otherwise we switch it ON for the shot and switchBack(true) afterwards (restores the state before OUR switchOn);
     - "switching off after switching on in the same thread is unreliable": switchBack runs in a setTimeout of 150 ms, after the pan back;
     - switchOn awaits a world setting round trip, so we wait for isOn() before panning (otherwise the first frames would not reach the players).
   LockView: HotPan itself unlocks LockView while it is ON and restores it after. A GM who LOCKED the players' view on purpose must not have
   it overridden: when LockView is active and the viewed scene has lockPan / lockZoom set, the players are left alone (GM-only glide).
   Only the GM client that made the change runs it (userId check), at most once per COOLDOWN, bursts are coalesced into one shot (the strongest
   event wins), everything is try / catch: a failing camera never touches the HUD. ez-glide (smooth wheel zoom) has no API and needs nothing. */

const MOD = "invincible-plus-ultra";
export const CAMERA_KEY = "challengesCamera";   // "off" | "lifecycle" (enter / leave only) | "all" (also progress and time changes)
const COOLDOWN = 8000;     // ms between two shots (from the start of one)
const SETTLE = 250;        // ms: a burst of events becomes one shot
const GLIDE_IN = 1000, HOLD = 1800, GLIDE_OUT = 900;
const MIN_SCALE = 0.8;
const PRIORITY = { progress: 1, state: 2, leave: 3, enter: 3 };

let lastShot = -Infinity, running = false, pending = null, timer = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mode = () => { try { return game.settings.get(MOD, CAMERA_KEY) || "off"; } catch { return "off"; } };
const reduced = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* may this client run a shot for a change it made itself? */
function mine(userId) { return !!game.user?.isGM && userId === game.user.id; }
function usable(td) {
  if (mode() === "off" || reduced()) return false;
  if (!canvas?.ready || !canvas.scene || td?.parent !== canvas.scene) return false;
  return td.actor?.type === "challenge";
}

/* ---------- entry points (called from main.mjs hooks) ---------- */
export function onCreate(td, userId) {
  if (!mine(userId) || !usable(td) || td.hidden) return;                 // a hidden token is not "visible to players": no shot
  request("enter", td);
}
export function onDelete(td, userId) {
  if (!mine(userId) || !usable(td) || td.hidden) return;                 // a hidden one left unseen already
  request("leave", td);
}
export function onUpdateToken(td, changes, userId) {
  if (!mine(userId) || !usable(td)) return;
  if (changes && "hidden" in changes) request(changes.hidden ? "leave" : "enter", td);
  else if (changes?.delta?.system?.derived && !td.hidden) progress(td, changes.delta);   // unlinked token: the synthetic actor's data arrives as a delta
}
export function onUpdateActor(actor, changes, userId) {
  if (!mine(userId) || actor?.type !== "challenge" || !canvas?.scene) return;
  const tokens = actor.isToken ? [actor.token] : actor.getActiveTokens(false, true);   // token DOCUMENTS of this actor on the viewed scene
  for (const td of tokens) if (td && td.parent === canvas.scene && usable(td) && !td.hidden) progress(td, changes);
}

function progress(td, changes) {
  if (mode() !== "all") return;
  const d = foundry.utils.getProperty(changes, "system.derived") ?? changes?.system?.derived;
  if (!d || (!d.health && !d.resolve)) return;
  const dd = td.actor?.system?.derived ?? {};
  const cr = Number(dd.health?.value), crMax = Number(dd.health?.max), tl = Number(dd.resolve?.value), tlMax = Number(dd.resolve?.max);
  const reached = (crMax > 0 && cr <= 0) || (tlMax > 0 && tl <= 0);   // overcome / time up: a stronger beat than a plain change
  request(reached ? "state" : "progress", td);
}

/* ---------- queue: one pending shot, replaced by an equal or stronger event, run after SETTLE and never inside the cooldown ---------- */
let hushUntil = 0;
export function hush(ms) { hushUntil = performance.now() + ms; }   // drag.mjs: copying a token's numbers into the world actor is not a cinematic moment
function request(kind, td, force = false) {
  if (!force && (kind === "progress" || kind === "state") && performance.now() < hushUntil) return;
  const ev = { kind, td, x: td.x, y: td.y, w: td.width, h: td.height, scene: td.parent?.id, force };
  if (!pending || PRIORITY[kind] >= PRIORITY[pending.kind] || force) pending = ev;
  clearTimeout(timer);
  const wait = force ? 0 : Math.max(SETTLE, lastShot + COOLDOWN - performance.now());
  timer = setTimeout(go, wait);
}

async function go() {
  timer = 0;
  const ev = pending;
  pending = null;
  if (!ev) return;
  if (running) { pending = ev; timer = setTimeout(go, 500); return; }   // the previous shot is still on; try again shortly
  if (!ev.force && (mode() === "off" || reduced())) return;
  if (!canvas?.ready || canvas.scene?.id !== ev.scene) return;          // the scene changed while we waited
  running = true;
  lastShot = performance.now();
  try { await shoot(ev); } catch (e) { console.warn(`${MOD} (challenges) | camera`, e); } finally { running = false; }
}

/* ---------- the shot ---------- */
function lockedByGm() {
  try {
    if (!game.modules.get("LockView")?.active) return false;
    return !!(canvas.scene.getFlag("LockView", "lockPan") || canvas.scene.getFlag("LockView", "lockZoom"));
  } catch { return false; }
}
function hotPan() {
  const hp = globalThis.HotPan;
  return game.modules.get("hot-pan")?.active && hp && typeof hp.switchOn === "function" && typeof hp.switchBack === "function" && typeof hp.isOn === "function" ? hp : null;
}
const view = () => ({ x: canvas.stage.pivot.x, y: canvas.stage.pivot.y, scale: canvas.stage.scale.x });
const near = (a, b) => Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.abs(a.scale - b.scale) < 0.005;
async function glide(pos, ms) {
  await Promise.race([canvas.animatePan({ ...pos, duration: ms }), sleep(ms + 600)]);   // an interrupted animation must not hang the shot
}

async function shoot(ev) {
  const size = canvas.grid?.size ?? 100;
  const before = view();
  const scale = ev.kind === "progress" || ev.kind === "state" ? before.scale : Math.max(before.scale, MIN_SCALE);   // changes only pan; entering / leaving also come closer
  // centre the token in the part of the window the sidebar leaves free (HotPan's own auto-focus applies the same correction)
  const sidebar = document.getElementById("sidebar")?.offsetWidth ?? 0;
  const target = { x: ev.x + (ev.w * size) / 2 + sidebar / scale / 2, y: ev.y + (ev.h * size) / 2, scale };

  const hp = lockedByGm() ? null : hotPan();
  let switched = false;
  try {
    if (hp && !hp.isOn()) {
      hp.switchOn(true);
      switched = true;
      for (let i = 0; i < 40 && !hp.isOn(); i++) await sleep(50);   // the switch is a world-setting round trip
    }
    await glide(target, GLIDE_IN);
    const arrived = view();   // where the canvas really ended up (the view may be constrained)
    await sleep(HOLD);
    if (canvas?.ready && canvas.scene?.id === ev.scene && near(view(), arrived)) await glide(before, GLIDE_OUT);   // the GM moved the view meanwhile: leave it
  } finally {
    if (switched) setTimeout(() => { try { hp.switchBack(true); } catch (e) { console.warn(`${MOD} (challenges) | HotPan switchBack`, e); } }, 150);   // README: not in the same thread
  }
}

/* manual shot for tests: api.challenges.focus(tokenId, "enter"|"leave"|"progress"), ignores the setting's "off" check only for the mode, never the GM rule */
export function focus(id, kind = "enter") {
  const td = canvas?.scene?.tokens.get(id);
  if (!game.user?.isGM || !td) return false;
  request(kind, td, true);
  return true;
}
export function cancel() { clearTimeout(timer); timer = 0; pending = null; }
