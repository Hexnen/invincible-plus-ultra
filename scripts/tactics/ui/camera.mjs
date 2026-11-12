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
   Everything is in try / catch: the camera must never break the dock. */
import * as Zones from "../zones-adapter.mjs";
import * as Store from "../store.mjs";
import * as CP from "./camera-pure.mjs";

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
/* the events of the fight (spec 16): a walk, an action aimed at somebody, a result. A player's client hears the public stream; the
   executor hears the full one too. Each is asked of this client's last look (the user's own view) before anything is framed. */
const heard = new Set();
function onEvent(ev) {
  try {
    if (!started || !on || !was || !ev || typeof ev !== "object" || ev.combat !== key) return;
    const k = `${ev.seq ?? ""}|${ev.type ?? ""}|${typeof ev.target === "string" ? ev.target : ev.target?.combatant ?? ""}`;
    if (heard.has(k)) return;
    if (heard.size > 400) heard.clear();
    heard.add(k);
    const c = CP.eventCue(ev, was), combat = c ? Store.combatOf?.(key) ?? game.combats?.get(key) : null;
    if (!c || !combat) return;
    const spec = play(combat, c);
    log.push({ at: Date.now(), why: c.why, level: c.level, focus: c.focus, sent: !!spec, ev: ev.type }); if (log.length > 40) log.shift();
  } catch (e) { console.warn(LOG, "event failed", e); }
}
/** Once per redraw. ctx = { combat, view, staff, model, dock (the dock's own state), data (what the dock draws) } | null (no fight here) */
export function sync(ctx) {
  try {
    if (!started || !ready()) return;
    if (!ctx?.combat || !ctx.view) { if (on) { on = false; Zones.camera({ driver: null }); } was = null; key = null; return; }
    if (!on) { on = true; Zones.camera({ driver: MOD }); }
    const { combat, view, staff, model, dock, data } = ctx;
    const now = CP.look(view, { me: game.user.id, staff, mine: mineOf(combat, view, model, staff), who: data?.show ? data.who?.id ?? null : null, sel: dock?.sel ?? null, armed: dock?.armed ?? null, targets: dock?.targets ?? [] });
    const before = key === combat.id ? was : null;                                            // another fight: a first look
    was = now; key = combat.id;
    const c = CP.cue(before, now);
    if (!c) return;
    const spec = play(combat, c);
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
export const state = () => ({ on, was, log: log.slice() });
export function start() {
  try {
    if (started) return ready();
    started = true;
    Hooks.on(Store.HOOK, onEvent);
    Hooks.on(Store.HOOK_GM, onEvent);
    return ready();
  } catch (e) { console.warn(LOG, "start failed", e); return false; }
}
