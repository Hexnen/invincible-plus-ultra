/* Tactical combat, the surfaces: THE CAMERA, the Foundry side (ledger row U94; spec section 25; the moments and their reasons are in
   ui/camera-pure.mjs). Once per redraw of the surfaces this client's own view and this user's own dock are looked at; what changed
   since the last look becomes at most ONE call of the map's `frame` (zones-api.md section 38), on this client, for this client:
     - nothing is sent to anybody and the GM's client frames nothing for a player, so a player's camera can only answer what that
       player's own view holds; a combatant is handed over only as a token this client's canvas draws (visible to this user);
     - whether and how the view moves is the map's: the user's switch (the dock's camera button), the user's hand on the map, a
       camera another module holds, the free part of the screen between our bars, "My view" to take a move back.
   While a tactical fight runs here this module is the fight's camera (`camera({ driver })`): the map's director does not play its own
   turn, move, roll and damage beats of that fight on this client, so there is one camera and one policy. Without the map's `frame`
   (an older map) nothing here runs and main.mjs keeps its own least slide for the dock's unit.
   U98 (spec section 26), THE ACTION CAMERA: what deserves a shot (camera-pure eventShot / cueShot) is asked of the map's `shot`
   first, again on this client, for this client, with the tokens this canvas draws; when this user's switch is turned down the map
   answers "level" and the quiet cue is played instead. An action armed or a question put to this user ends a shot on screen.
   Everything is in try / catch: the camera must never break the dock. */
import * as Zones from "../zones-adapter.mjs";
import * as Store from "../store.mjs";
import * as CP from "./camera-pure.mjs";
import * as Gate from "./dicegate.mjs";
import { isResultEvent } from "./wait-pure.mjs";
import * as Moment from "../../moment.mjs";

const MOD = Store.MOD, LOG = `${MOD} (tactics camera) |`;
let started = false, on = false, was = null, key = null;
const log = [];                     // the last cues of this client (a look from the console: api.tactics.camera.log())

export const ready = () => { try { return Zones.hasFrame(); } catch { return false; } };
/** the token of a combatant as this client's canvas draws it for this user, or null */
function tokenOf(combat, cid) {
  try { const td = cid ? combat.combatants.get(cid)?.token ?? null : null; return td?.object?.visible && !(td.hidden && !Store.isStaff(game.user)) ? td.id : null; } catch { return null; }
}
/** the combatants this user drives: a player's own bars; for staff everybody whose player is not at the table (the NPCs first of all) */
function mineOf(combat, view, model, staff) {
  try {
    if (!staff) return (model?.bars ?? []).map((b) => b.combatant);
    return Object.keys(view?.ledger ?? {}).filter((id) => { const a = combat.combatants.get(id)?.actor ?? null; return !a || !game.users.some((u) => u.active && !Store.isStaff(u) && a.testUserPermission(u, "OWNER")); });
  } catch { return []; }
}
function play(combat, c) {
  const focus = tokenOf(combat, c.focus);
  if (!focus) return null;                                                                    // not on this user's map: the view stays
  const tokens = [focus, ...c.with.map((x) => tokenOf(combat, x)).filter(Boolean)];
  const spec = { tokens, level: c.level, hand: c.hand, why: c.why };
  /* somebody else's walk: where it starts (with the zone it goes to, when both fit), and once it has walked, where it stands */
  if (c.why === "move") { Promise.resolve(Zones.frame({ ...spec, ...(c.zone ? { zones: [String(c.zone).split(":")[0]] } : {}) })).then(() => Zones.frame({ ...spec, after: focus })).catch(() => {}); return spec; }
  const after = c.after ? tokenOf(combat, c.after) : null;
  Promise.resolve(Zones.frame({ ...spec, ...(after ? { after } : {}) })).catch(() => {});
  return spec;
}
/* U98: a beat of the action camera. The map plays it, or says the user's switch is not on the action camera ("level"): then the
   quiet cue of stage 1 (`fallback`) is played. A beat the map did play is remembered, so that the quiet cues of the same blow (the
   damage, a forced step) do not slide the view again right after it came back. */
const shown = new Map();              // "inst|target" -> when a beat about it played here
const SHOWN_MS = 6000;
const shownKey = (inst, target) => `${inst ?? ""}|${target ?? ""}`;
function playShot(combat, s, fallback = null, exp = null) {
  if (!Zones.hasShot()) { exp?.drop(); return fallback ? play(combat, fallback) : null; }
  if (s.beat === "close") { Promise.resolve(Zones.shot({ key: `${combat.id}:${s.key}`, beat: "close" })).catch(() => {}); return { beat: "close" }; }
  const focus = tokenOf(combat, s.focus);
  if (!focus) { exp?.drop(); return null; }                                                    // not on this user's map: nothing plays
  const spec = { key: `${combat.id}:${s.key}`, beat: s.beat, tokens: [focus, ...s.with.map((x) => tokenOf(combat, x)).filter(Boolean)], still: s.still === true, why: s.beat,
    ...(s.zone ? { zones: [String(s.zone).split(":")[0]] } : {}) };
  Promise.resolve(Zones.shot(spec)).then((r) => {
    /* U125 (e): the map says when the blow lands (`lands`, ms); the splash of the same roll pops then (scripts/moment.mjs) */
    if (r?.ok) { exp?.land(Number.isFinite(r.lands) ? r.lands : 0); if (shown.size > 200) shown.clear(); shown.set(shownKey(s.key, s.focus), Date.now()); }
    else { exp?.drop(); if (r?.reason === "level" && fallback) play(combat, fallback); }
  }).catch(() => exp?.drop());
  return spec;
}
/* U125 (e) ONE MOMENT. A result (hit, miss, kill) is known to the engine while the 3D dice of its roll still roll on the screen; the
   comic splash has always waited for the dice, the camera did not, so the hit beat had come and gone home before the "POW!". A
   result beat now waits for the dice of the rolls in flight on this client (Dice So Nice's own wait, the one the splash uses; at most
   DICE_MS), and is then asked of the user's look of THAT moment (an action armed or a card opened meanwhile changes it). The beats of
   one exchange keep their order (the close never overtakes the result it closes). While a result waits, the quiet cues of the same
   blow (its damage) do not move the view first. */
const RESULT = Object.freeze(["hit", "miss", "kill"]);
const DICE_MS = 9000;
const chain = new Map();              // "combat:inst" -> the last beat of that exchange on its way
const waiting = new Map();            // shownKey -> how many result beats about it wait for dice
const tick = () => new Promise((r) => setTimeout(r, 0));
async function diceSettled() {
  await tick();                                                                               // (Dice So Nice marks a roll in its own createChatMessage hook)
  const d = game.dice3d;
  if (typeof d?.waitFor3DAnimationByMessageID !== "function") return;
  const busy = (game.messages?.contents ?? []).slice(-12).filter((m) => m?._dice3danimating);
  if (!busy.length) return;
  await Promise.race([Promise.all(busy.map((m) => Promise.resolve(d.waitFor3DAnimationByMessageID(m.id)).catch(() => {}))), new Promise((r) => setTimeout(r, DICE_MS))]);
}
function queueShot(ev, s, c, combat) {
  const k = `${combat.id}:${s.key}`, result = RESULT.includes(s.beat), wk = shownKey(s.key, s.focus);
  const exp = result ? Moment.expect([s.focus, ...s.with].map((x) => tokenOf(combat, x)).filter(Boolean)) : null;
  if (result) waiting.set(wk, (waiting.get(wk) ?? 0) + 1);
  const run = (chain.get(k) ?? Promise.resolve()).then(async () => {
    try {
      if (result) await diceSettled();
      const look = result ? (on && key === combat.id ? was : null) : was;
      const s2 = result ? (look ? CP.eventShot(ev, look) : null) : s;
      if (!s2) { exp?.drop(); return; }
      const spec = playShot(combat, s2, result ? CP.eventCue(ev, look) : c, exp);
      log.push({ at: Date.now(), why: s2.beat, shot: true, focus: s2.focus, sent: !!spec, ev: ev.type }); if (log.length > 40) log.shift();
    } finally { if (result) { const n = (waiting.get(wk) ?? 1) - 1; waiting.set(wk, Math.max(0, n)); } }
  }).catch((e) => { exp?.drop(); console.warn(LOG, "shot failed", e); });
  chain.set(k, run);
  run.finally(() => { if (chain.get(k) === run) chain.set(k, null); if (chain.size > 200) chain.clear(); if (waiting.size > 200 && ![...waiting.values()].some(Boolean)) waiting.clear(); });
  return k;
}
/* the events of the fight (spec 16): a walk, an action aimed at somebody, a result. A player's client hears the public stream; the
   executor hears the full one too. Each is asked of this client's last look (the user's own view) before anything is framed. */
const heard = new Set();
function onEvent(ev) {
  try {
    /* UXB (U151): what an exchange came to goes to the splash's moment whatever this camera does (on, off, another fight's view) */
    if (ev && ev.type === "outcome" && typeof ev.hit === "boolean" && ev.inst) Moment.told(ev.inst, typeof ev.target === "string" ? ev.target : null, ev.hit);
    if (!started || !on || !was || !ev || typeof ev !== "object" || ev.combat !== key) return;
    const k = `${ev.combat}|${ev.fight ?? ""}|${ev.seq ?? ""}|${ev.type ?? ""}|${typeof ev.target === "string" ? ev.target : ev.target?.combatant ?? ""}`;
    if (heard.has(k)) return;
    if (heard.size > 400) heard.clear();
    heard.add(k);
    const s = CP.eventShot(ev, was), c = CP.eventCue(ev, was), combat = s || c ? Store.combatOf?.(key) ?? game.combats?.get(key) : null;
    if (!combat) return;
    if (s && Zones.hasShot()) { queueShot(ev, s, c, combat); return; }                           // U125 (e): in order, a result after its dice
    /* ANSC (U10-9 + FXJ-3): the quiet cue of a result (no staged shot: the map has none, or the user turned shots down) waits for the 3D
       dice of the roll on this client too, so the view does not swing to the one hit before the dice say it (ui/dicegate.mjs) */
    if (isResultEvent(ev) && Gate.on()) { Gate.after(() => { try { cueNow(ev, s, c, combat); } catch (e) { console.warn(LOG, "event failed", e); } }); return; }
    cueNow(ev, s, c, combat);
  } catch (e) { console.warn(LOG, "event failed", e); }
}
function cueNow(ev, s, c, combat) {
  try {
    if (s) { const spec = playShot(combat, s, c); log.push({ at: Date.now(), why: s.beat, shot: true, focus: s.focus, sent: !!spec, ev: ev.type }); if (log.length > 40) log.shift(); return; }
    if (!c || Date.now() - (shown.get(shownKey(ev.inst, c.focus)) ?? 0) < SHOWN_MS) return;      // the shot of this blow has just shown it
    if ((waiting.get(shownKey(ev.inst, c.focus)) ?? 0) > 0) return;                                         // U125 (e): its shot waits for the dice: the view does not go first
    if (Zones.hasShot() && CP.heldByCard(c, was)) return;                                       // H2-3: a card is open for this user: nothing moves (spec 26)
    const spec = play(combat, c);
    log.push({ at: Date.now(), why: c.why, level: c.level, focus: c.focus, sent: !!spec, ev: ev.type }); if (log.length > 40) log.shift();
  } catch (e) { console.warn(LOG, "event failed", e); }
}
/** Once per redraw. ctx = { combat, view, staff, model, dock (the dock's own state), data (what the dock draws) } | null (no fight here) */
export function sync(ctx) {
  try {
    if (!started || !ready()) return;
    if (!ctx?.combat || !ctx.view) { if (on) { on = false; Moment.active(false); Zones.camera({ driver: null }); } was = null; key = null; return; }
    if (!on) { on = true; Zones.camera({ driver: MOD }); }
    Moment.active(Zones.hasShot());                                                           // U125 (e): the splash waits for a result beat only while shots can play
    const { combat, view, staff, model, dock, data } = ctx;
    const now = CP.look(view, { me: game.user.id, staff, mine: mineOf(combat, view, model, staff), who: data?.show ? data.who?.id ?? null : null, sel: dock?.sel ?? null, armed: dock?.armed ?? null, targets: dock?.targets ?? [] });
    const before = key === combat.id ? was : null;                                            // another fight: a first look
    was = now; key = combat.id;
    if (CP.handTook(before, now) && Zones.hasShot()) Zones.shotEnd();                         // U98: the user's hand or a question: a shot on screen gives the view back
    const all = CP.cues(before, now), c = all[0] ?? null;
    if (!c || (Zones.hasShot() && CP.heldByCard(c, now))) return;                              // H2-3: a card is open for this user: nothing moves (spec 26)
    /* U98: somebody new in this user's view gets its shot even when a more pressing quiet cue came with it (the one revealed is
       on turn): the shot shows where it is; a user who turned the camera down gets the quiet cue instead */
    const s = c.hand ? null : CP.cueShot(all.find((x) => x.why === "reveal") ?? null, now);    // H2-S2: the user's own hand (a unit chosen) wins: its frame takes over (spec 26)
    const spec = s ? playShot(combat, s, c) : play(combat, c);
    log.push({ at: Date.now(), why: c.why, level: c.level, focus: c.focus, sent: !!spec }); if (log.length > 40) log.shift();
  } catch (e) { console.warn(LOG, "sync failed", e); }
}
/** main.mjs: the dock's unit out from under the bars (Move armed, a move made from the dock). -> true when the map's camera took it */
export function show(cid, combat, after = false) {
  try {
    if (!started || !ready()) return false;
    const tok = tokenOf(combat, cid);
    if (tok) Promise.resolve(Zones.frame({ tokens: [tok], level: "turn", hand: true, why: "unit", ...(after ? { after: tok } : {}) })).catch(() => {});
    return true;
  } catch { return false; }
}
export function reset() { was = null; key = null; }
export const state = () => ({ on, was, log: log.slice(), waiting: [...waiting].filter(([, n]) => n > 0).map(([w]) => w), moment: Moment.state() });
export function start() {
  try {
    if (started) return ready();
    started = true;
    Moment.listen();
    Hooks.on(Store.HOOK, onEvent);
    Hooks.on(Store.HOOK_GM, onEvent);
    return ready();
  } catch (e) { console.warn(LOG, "start failed", e); return false; }
}
