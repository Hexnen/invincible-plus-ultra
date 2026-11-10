/* Tactical combat: ZONES ADAPTER (spec section 7.3). The only file of the tactics folder that calls the zones API of moinen-maps
   (`game.modules.get("moinen-maps").api.zones`; the contract: moinen-maps dev/zones-api.md).
   It holds no rule and builds no inverse: the map's write path `apply(op)` returns the op that undoes each write, and that is what the
   journal stores (journal-pure.mjs, op `zones`; the ops themselves are built in zones-pure.mjs). Three groups:
     queries    place / spot of a token, range, who shares a zone, a zone's data and states, borders, routes, the graph for the rules library
     writes     perform({ t:"zones", op, isInverse? })  ->  apply(op)        only the active GM's client (api.canWrite())
     movement   profile, cost, reach, plan, forced chains, free spots, move / moveToZone (each returns a `tokens` inverse), the listener
                asked before every step, cost confirmation on a dragged token. The movement FLOW is a later package; these are its calls.
   Every call is guarded: a missing module or function gives null / [] / undefined / { ok:false, reason:"noZonesApi" }, never a throw. */
import * as ZP from "./zones-pure.mjs";

const ZONES_MODULE = "moinen-maps";
export const EVENT_HOOK = "moinenMapsZoneEvent";
const warn = (what, err) => console.warn(`invincible-plus-ultra | tactics: zones.${what} failed`, err);

export function api() {
  try { const m = game.modules.get(ZONES_MODULE); if (!m?.active) return null; return m.api?.zones ?? null; } catch { return null; }
}
const call = (name, ...args) => { const a = api(); if (typeof a?.[name] !== "function") return undefined; try { return a[name](...args); } catch (err) { warn(name, err); return undefined; } };
const callAsync = async (name, ...args) => {
  const a = api();
  if (typeof a?.[name] !== "function") return { ok: false, reason: "noZonesApi" };
  try { return (await a[name](...args)) ?? { ok: false, reason: "error" }; } catch (err) { warn(name, err); return { ok: false, reason: "error" }; }
};
export const available = () => typeof api()?.zoneOfToken === "function" && typeof api()?.range === "function";
/** May this client write (the active GM)? Without the map's own answer nobody may. */
export const canWrite = () => call("canWrite") === true;
export const version = () => call("version") ?? null;

/* ------------------------------------------------------------------ queries */
/** place | null (zones-api.md section 2: { zone, id, spot, area, level, floor, airborne, roof, below }) */
export const placeOf = (token) => call("zoneOfToken", token) ?? null;
export const place = (where) => call("place", where) ?? null;
/** the 3-D zone of a token as one string ("z3", "z3:f2", "@sky") | null. Two combatants share a zone exactly when their spots are equal. */
export const spotOf = (token) => placeOf(token)?.spot ?? null;
/** { total, borders, levels } | null (no attack possible) | undefined (no zones on this scene: the engine then asks nothing of range). */
export const range = (a, b) => (available() ? call("range", a, b) ?? null : undefined);
export const route = (a, b, way = "walk") => call("route", a, b, way) ?? null;
export const path = (a, b, opts) => call("path", a, b, opts) ?? null;
export const zonesWithin = (where, n, opts) => call("zonesWithin", where, n, opts) ?? [];
export const zoneOf = (where) => call("zone", where) ?? null;
export const zoneStates = (where) => call("zoneStates", where) ?? [];
export const borderBetween = (a, b) => call("borderBetween", a, b) ?? null;
/** every border of a zone (zones-api.md section 5), each with its wall and its door */
export const bordersOf = (where) => call("bordersOf", where) ?? [];
/** the graph in the shape the rules library's zones.makeGraph takes (zones-api.md section 13) | null */
export const graph = () => call("graph") ?? null;
/** TokenDocuments in a zone. A token, a spot or a place: that level only (the book's "same zone"); a bare key: every level. */
export const tokensInZone = (where, opts) => (call("tokensInZone", where, opts) ?? []).map((r) => r?.token ?? null).filter(Boolean);
/** the same with each token's place: [{ token, place }] */
export const rowsInZone = (where, opts) => (call("tokensInZone", where, opts) ?? []).filter((r) => r?.token);
/** Hooks.on for the map's events (tokenLeft, tokenEntered, zoneChanged, borderChanged, edgeChanged, move*). -> off() */
export function onEvent(fn) {
  const id = Hooks.on(EVENT_HOOK, fn);
  return () => Hooks.off(EVENT_HOOK, id);
}

/* ------------------------------------------------------------------ writes (executor only)
   e = { t:"zones", op, isInverse? }   ->   { ok:true, changed, result, op: { t:"zones", op, inverse } | null }  |  { ok:false, reason }
   `op` (the journal op) is null for an inverse: an undo records nothing new. */
export async function perform(e) {
  const a = api();
  if (typeof a?.apply !== "function") return { ok: false, reason: "noZonesApi" };
  const op = e?.op;
  if (e?.isInverse ? !op || typeof op !== "object" : !ZP.validOp(op)) return { ok: false, reason: "badOp" };      // an inverse goes back as the map gave it
  if (!canWrite()) return { ok: false, reason: "notActiveGM" };
  try {
    const r = await a.apply(op);
    if (!r?.ok) return { ok: false, reason: String(r?.reason ?? "error").slice(0, 40) };
    return { ok: true, changed: r.changed !== false, result: r.result ?? null, op: e.isInverse ? null : { t: "zones", op, inverse: r.inverse ?? null } };
  } catch (err) { warn("apply", err); return { ok: false, reason: "error" }; }
}

/* ------------------------------------------------------------------ movement (zones-api.md section 14) */
export const profile = (p) => call("profile", p) ?? null;
/** { reachable, plan, cost: { total, speed, actions, stressSpeed, stressActions, within } } | null */
export const moveCost = (a, b, p) => call("moveCost", a, b, p) ?? null;
export const reach = (where, p, opts) => call("reach", where, p, opts) ?? [];
export const plan = (a, b, p) => call("plan", a, b, p) ?? null;
export const forcedChain = (who, opts) => call("forcedChain", who, opts) ?? null;
export const planAlong = (from, keys, opts) => call("planAlong", from, keys, opts) ?? null;
export const freeSpot = (where, opts) => call("freeSpot", where, opts) ?? null;
/** The journal op of a finished move: the `tokens` inverse the map returned puts every mover back. null when nothing moved. */
export const moveRecord = (res) => (res?.ok !== false && res?.inverse ? { t: "zones", op: { op: "move", id: res.op ?? null, done: res.done ?? null }, inverse: res.inverse } : null);
/** Along a route or a plan, the step listeners asked before every step. -> the map's result plus `journal` (moveRecord) */
export async function move(token, to, opts) { const r = await callAsync("move", token, to, opts); return { ...r, ok: r.ok !== false, journal: moveRecord(r) }; }
/** Into a free spot of a zone, nobody asked (an arrival, a GM's placement). -> the map's result plus `journal` */
export async function moveToZone(token, where, opts) { const r = await callAsync("moveToZone", token, where, opts); return { ...r, ok: r.ok !== false, journal: moveRecord(r) }; }
/** fn(ctx) is asked before every step of every move made through `move` on this client. -> off() */
export function beforeStep(fn) { const off = call("beforeStep", fn); return typeof off === "function" ? off : () => {}; }
/** Cost confirmation on a dragged token, per client: tactical({ profile, confirm, when, gm }) turns it on, tactical(false) off. */
export const tactical = (cfg) => call("tactical", cfg) === true;
export const tacticalOn = () => call("tacticalOn") === true;

/* ------------------------------------------------------------------ interface parts (zones-api.md sections 17-19) */
export const highlight = (spec) => call("highlight", spec) ?? null;
export const clearHighlights = (what) => call("clearHighlights", what) ?? 0;
export const showReach = (token, p, opts) => call("showReach", token, p, opts) ?? null;
/** always resolves: { ok:true, zone, spot, place, x, y } | { ok:false, reason } */
export const pick = (spec) => callAsync("pick", spec);
export const cancelPick = (opts) => call("cancelPick", opts);
/** The map's own rule mechanics (fire round, wrecking numbers) handed to this module, per client; rulesDriver(false, id) steps down. */
export const rulesDriver = (...args) => call("rulesDriver", ...args);
export const drivenBy = () => call("drivenBy") ?? null;
