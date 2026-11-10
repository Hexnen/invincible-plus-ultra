/* Tactical combat, package P2: ZONES ADAPTER (spec section 7.3). The only file of the tactics folder that calls the zones API of moinen-maps.
   P2 needs little of it: the facts the attack flow reads (place, range, who shares a zone, states of a zone) and the three COMMANDS the GM's state
   editing uses, each with the INVERSE the journal stores. No zones command returns an inverse (spec 7.3), so this file builds it: the `...Inverse`
   builders below are pure (no globals) and node-tested in check-zones.mjs. Movement, paths and forced moves are P3 and are added here by P3.
   ASSUMPTION (not verifiable before the zones contract ships): the API object is `game.modules.get("moinen-maps").api.zones`, falling back to `.api`.
   Every call is guarded: a missing API or function gives "noScene"-style nulls / { ok:false, reason:"noZonesApi" }, never a throw. */

const ZONES_MODULE = "moinen-maps";
export const ZONE_STATE_KEYS = Object.freeze(["wrecked", "fire", "dark", "ice", "flooded", "lowgrav"]);       // spec 7.1 `states`
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);

/* ------------------------------------------------------------------ pure: inverses (spec 7.3 "Inverse operations") */
/** Inverse of setZone(key, patch): the patch that restores the previous OWN marks of exactly the keys the patch touches.
    `own` = the GM's own marks of the zone before the call (not the painted layers: setZone writes own marks only). Missing = null (clears the mark). */
export function zoneInverse(key, patch, own) {
  if (typeof key !== "string" || !isObj(patch)) return null;
  const back = {};
  for (const k of Object.keys(patch)) back[k] = own && own[k] !== undefined ? own[k] : null;
  return { call: "setZone", zone: key, patch: back };
}
/** The same from a `zoneChanged` event payload (the contract's recipe), for changes the engine did not initiate itself. */
export function zoneInverseFromEvent(ev) {
  if (!isObj(ev) || typeof ev.zone !== "string" || !Array.isArray(ev.changed)) return null;
  return { call: "setZone", zone: ev.zone, patch: Object.fromEntries(ev.changed.map((k) => [k, ev.before?.[k] ?? null])) };
}
/** Inverse of setLevel(token, to): the previous level / floor / airborne (or off-map area) of the place read BEFORE the call. */
export function levelInverse(tokenUuid, place) {
  if (typeof tokenUuid !== "string" || !isObj(place)) return null;
  const to = place.area ? { area: place.area } : { level: place.level ?? "ground", floor: place.floor ?? 0, airborne: !!place.airborne };
  return { call: "setLevel", token: tokenUuid, to };
}
/** Inverse of a border change: swap the kind back [G-Z1: the contract has no breached / removed state yet]. */
export function borderInverse(borderKey, before) {
  if (typeof borderKey !== "string" || typeof before?.kind !== "string") return null;
  return { call: "setBorder", border: borderKey, kind: before.kind, x: before.x, y: before.y };
}
/** Is the patch one the engine may send (known state keys, plain values)? Unknown keys are refused: the engine never invents zone state. */
export function validZonePatch(patch) {
  if (!isObj(patch) || !Object.keys(patch).length) return false;
  return Object.entries(patch).every(([k, v]) => ZONE_STATE_KEYS.includes(k) && (v === null || typeof v === "boolean" || (k === "fire" && Number.isFinite(v) && v >= 0 && v <= 12)));
}

/* ------------------------------------------------------------------ live */
export function api() {
  try { const m = game.modules.get(ZONES_MODULE); if (!m?.active) return null; return m.api?.zones ?? m.api ?? null; } catch { return null; }
}
const call = (name, ...args) => { const a = api(); if (typeof a?.[name] !== "function") return undefined; try { return a[name](...args); } catch (err) { console.warn(`invincible-plus-ultra | tactics: zones.${name} failed`, err); return undefined; } };
export const available = () => typeof api()?.zoneOfToken === "function" && typeof api()?.range === "function";

/* queries the attack flow needs (engine-pure facts) */
export const placeOf = (token) => call("zoneOfToken", token) ?? null;
/** { total, borders, levels } | null (no attack possible) | undefined (no zones on this scene: the engine then asks nothing of range). */
export const range = (a, b) => (available() ? call("range", a, b) ?? null : undefined);
export const zoneOf = (where) => call("zone", where) ?? null;
export const tokensInZone = (where, opts) => call("tokensInZone", where, opts) ?? [];

/* commands (executor only). Each returns { ok, op? } where op is the journal op `zones` with its inverse. */
export async function perform(e) {
  const a = api();
  if (!a) return { ok: false, reason: "noZonesApi" };
  try {
    if (e.call === "setZone") {
      if (!e.isInverse && !validZonePatch(e.patch)) return { ok: false, reason: "badPatch" };
      const id = typeof a.idOf === "function" ? a.idOf(e.zone) : e.zone;
      if (id == null || typeof a.setZone !== "function") return { ok: false, reason: "zoneGone" };
      const own = (typeof a.ownMarksOf === "function" ? a.ownMarksOf(e.zone) : null) ?? a.zone?.(e.zone)?.states ?? {};       // own marks when the API tells them apart, else the visible states
      const inverse = zoneInverse(e.zone, e.patch, own);
      const done = a.setZone(id, e.patch);                                       // boolean, not a promise; the scene write is debounced (spec 7.3)
      return done === false ? { ok: false, reason: "refused" } : { ok: true, op: e.isInverse ? null : { t: "zones", call: "setZone", zone: e.zone, patch: e.patch, inverse } };
    }
    if (e.call === "setLevel") {
      const token = typeof e.token === "string" ? await fromUuid(e.token) : e.token;
      if (!token || typeof a.setLevel !== "function") return { ok: false, reason: "tokenGone" };
      const inverse = levelInverse(token.uuid, a.zoneOfToken?.(token));
      await a.setLevel(token, e.to);
      return { ok: true, op: e.isInverse ? null : { t: "zones", call: "setLevel", token: token.uuid, to: e.to, inverse } };
    }
    if (e.call === "setBorder") {
      if (typeof a.setBorder !== "function" || typeof a.borderBetween !== "function") return { ok: false, reason: "noBorderApi" };       // [G-Z1]
      const [za, zb] = String(e.border ?? "").split("|");
      const before = a.borderBetween(za, zb);
      if (!before) return { ok: false, reason: "borderGone" };
      const inverse = borderInverse(e.border, before);
      a.setBorder(e.x ?? before.x, e.y ?? before.y, e.kind);
      return { ok: true, op: e.isInverse ? null : { t: "zones", call: "setBorder", border: e.border, kind: e.kind, inverse } };
    }
  } catch (err) { console.warn("invincible-plus-ultra | tactics: zones command failed", err); return { ok: false, reason: "error" }; }
  return { ok: false, reason: "unknownCall" };
}
