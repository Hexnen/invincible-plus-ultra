/* Tactical combat: the WRITE OPS OF THE ZONES API as plain data (spec 7.3; the map's contract: moinen-maps dev/zones-api.md, section 12).
   NO Foundry globals (node-tested in check-zones.mjs).
   The zones API has ONE write path for a combat action, `api.apply(op) -> { ok, changed, inverse, result } | { ok:false, reason }`, and every
   write returns the op that undoes it. So the engine builds an op here, the executor hands it to the adapter, and the journal stores the
   op together with the inverse the API returned (journal-pure.mjs, op `zones`); an undo gives that inverse back to `apply`. Nothing here
   invents an inverse or a zone state: unknown ops and unknown fields are refused.
   Places are named the map's way: a zone key ("z3"), a spot string ("z3:elevated", "z3:f2", "@sky"), a border key ("z1|z2"). */

const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const KEY = /^@?[A-Za-z0-9_-]{1,24}(:[A-Za-z0-9_-]{1,24})?$/;            // a zone key or a spot string
const BORDER = /^[A-Za-z0-9_-]{1,24}\|[A-Za-z0-9_-]{1,24}$/;
const ID = /^[A-Za-z0-9_.-]{1,64}$/;
export const isPlaceKey = (s) => typeof s === "string" && KEY.test(s);
export const isBorderKey = (s) => typeof s === "string" && BORDER.test(s);

/** "This level" as the map understands it [D26]. The spot string of the ground level is the bare zone key ("z3"), and the map reads
    a bare key as EVERY level of the zone (zones-api.md section 2). So a spot that is handed on as a question about one level
    ("the states where I stand", "who is in this spot") names the ground outright: "z3" -> "z3:ground". Spots of other levels,
    off-map areas ("@sky") and anything that is no string (a token, a place) already mean one level and pass unchanged. */
export const levelRef = (where) => (typeof where === "string" && where && !where.startsWith("@") && !where.includes(":") ? `${where}:ground` : where);
/** The zone properties a list of state records stands for (the map's states.mjs propsOf: wrecked, fire as its Intensity, dark, ice,
    flooded, lowgrav), so the states of ONE level can be read the way `zone.states` is read for the whole zone. */
export function propsOfStates(records) {
  const p = {};
  for (const r of Array.isArray(records) ? records : []) {
    if (!isObj(r)) continue;
    if (["wrecked", "dark", "ice", "flooded"].includes(r.kind)) p[r.kind] = true;
    else if (r.kind === "fire") { const n = Math.min(12, Math.round(Number(r.level ?? 1) || 0)); if (n >= 1) p.fire = Math.max(p.fire ?? 0, n); }
    else if (r.kind === "gravity" && r.data?.mode === "low") p.lowgrav = true;
  }
  return p;
}

/* the GM's own marks a `{ op:"zone" }` patch may set (zones-api.md section 5 `states`, section 12): the map's six drawn states */
export const ZONE_MARKS = Object.freeze(["wrecked", "fire", "dark", "ice", "flooded", "lowgrav"]);
export const WALL_STATES = Object.freeze(["intact", "breached", "removed"]);
export const DOOR_STATES = Object.freeze(["open", "closed", "locked", "sealed", "breached"]);
export const LEVELS = Object.freeze(["underground", "ground", "elevated", "floor"]);
export const AREAS = Object.freeze(["sky", "orbit", "dimension", "chase"]);
export const APPLY_OPS = Object.freeze(["border", "borderBuild", "zoneState.add", "zoneState.update", "zoneState.remove", "edge.add", "edge.remove", "zone", "tokens", "batch"]);

/** Is the patch one the engine may send as a zone's own marks (known keys, plain values)? The engine never invents zone state. */
export function validZonePatch(patch) {
  if (!isObj(patch) || !Object.keys(patch).length) return false;
  return Object.entries(patch).every(([k, v]) => ZONE_MARKS.includes(k) && (v === null || typeof v === "boolean" || (k === "fire" && Number.isFinite(v) && v >= 0 && v <= 12)));
}
/** GM edit `zoneSet` (spec 14.2): the zone's own marks. -> op | null */
export const zoneOp = (zone, patch) => (isPlaceKey(zone) && validZonePatch(patch) ? { op: "zone", zone, patch: { ...patch } } : null);
/* U72: A FIRE THAT WAS ONLY PAINTED on the map's fire layer (no mark of the GM under it) is put out by `{ op: "zone", patch: { fire: null } }`
   like any other, but the inverse the map returns for it carries the OWN mark as it was, which is "none": giving that back repaints
   nothing, so "undo" of a fire that went out left the zone dark. The level the layer showed before the write (`painted`, the map's own
   state record with source "map") is put into that inverse: the zone burns again at the Intensity it had (the map paints one fire of
   that level and keeps it as the zone's mark; the strokes themselves are the map's to give back: dev/combat-handoff.md U11).
   An inverse that already restores a fire, a write that puts nothing out and a zone that showed no painted fire are left as they came.
   U81: since the map's M5 an inverse may carry `fireLayer` (the very strokes the write put out or painted; zones-api.md 12, 37). Such an
   inverse is the true one and is left EXACTLY as the map gave it: a fire put into its patch as well would be written as a GM mark the
   zone never had. The repair stays only for a map that hands out no `fireLayer` (an older map module). */
export function repaintInverse(op, inverse, painted) {
  const lvl = Number(painted);
  if (isObj(inverse) && isObj(inverse.fireLayer)) return inverse;
  if (!isObj(op) || op.op !== "zone" || !isObj(op.patch) || !("fire" in op.patch) || Number(op.patch.fire) > 0) return inverse ?? null;
  if (!isObj(inverse) || inverse.op !== "zone" || !isObj(inverse.patch) || Number(inverse.patch.fire) > 0 || !(lvl >= 1)) return inverse ?? null;
  return { ...inverse, patch: { ...inverse.patch, fire: Math.min(12, Math.trunc(lvl)) } };
}
/** the Intensity the map's layers show for a zone's fire (0: none): the state records of source "map" */
export const paintedFire = (states) => Math.max(0, ...(Array.isArray(states) ? states : []).filter((s) => s?.kind === "fire" && s.source === "map").map((s) => Number(s.level) || 0));
/** A border's state in play (breach a wall, open / lock / seal / breach a door, or back as built). -> op | null */
export function borderOp(border, { wall, door, restore } = {}) {
  if (!isBorderKey(border)) return null;
  if (restore === true) return { op: "border", border, restore: true };
  const out = { op: "border", border };
  if (isObj(wall) && WALL_STATES.includes(wall.state)) out.wall = { state: wall.state, ...(wall.temp === true ? { temp: true } : {}) };
  if (isObj(door) && DOOR_STATES.includes(door.state)) out.door = { state: door.state };
  return out.wall || out.door ? out : null;
}
/** The level flags of a token as the map stores them (zones-api.md section 2: alt, floor, air; null = not set).
    to = { level, floor?, airborne? } | { area } | a spot string ("z3:elevated", "z3:f2", "@sky"; the zone part is not used). -> flags | null */
export function levelFlags(to) {
  if (typeof to === "string") {
    if (to.startsWith("@")) return AREAS.includes(to.slice(1)) ? { alt: to.slice(1), floor: null, air: null } : null;
    const lv = to.includes(":") ? to.split(":")[1] : "ground", f = /^f(\d{1,2})$/.exec(lv);
    return f ? levelFlags({ level: "floor", floor: Number(f[1]) }) : levelFlags({ level: lv });
  }
  if (!isObj(to)) return null;
  if (to.area != null) return AREAS.includes(to.area) ? { alt: to.area, floor: null, air: null } : null;
  if (!LEVELS.includes(to.level)) return null;
  if (to.level === "floor") { const n = Math.trunc(Number(to.floor)); return n >= 1 && n <= 99 ? { alt: null, floor: n, air: null } : null; }
  if (to.level === "ground") return { alt: null, floor: null, air: null };
  return { alt: to.level, floor: null, air: to.level === "elevated" && to.airborne === true ? true : null };
}
/** GM edit `levelSet`: the level of one token, its position on the map untouched (a `tokens` op without x / y). -> op | null */
export function levelOp(tokenId, to) {
  const f = levelFlags(to);
  return typeof tokenId === "string" && ID.test(tokenId) && f ? { op: "tokens", rows: [{ id: tokenId, ...f }] } : null;
}
/** the token id inside a token uuid ("Scene.x.Token.y" -> "y") */
export const tokenIdOf = (uuid) => (typeof uuid === "string" && uuid.includes(".") ? uuid.split(".").pop() : typeof uuid === "string" ? uuid : null);
/** Shape check of any op before it is sent (the API validates the content). An inverse the API returned is sent back as it came. */
export function validOp(op, depth = 0) {
  if (!isObj(op) || !APPLY_OPS.includes(op.op) || depth > 3) return false;
  if (op.op === "batch") return Array.isArray(op.ops) && op.ops.length <= 40 && op.ops.every((o) => validOp(o, depth + 1));
  if (op.op === "tokens") return Array.isArray(op.rows) && op.rows.length <= 60 && op.rows.every((r) => isObj(r) && typeof r.id === "string");
  return true;
}
/** The event `zoneChange` of spec 16 for an op the engine sent. */
export function changeOf(op) {
  if (!isObj(op)) return {};
  if (op.op === "zone") return { zone: op.zone, change: op.patch };
  if (op.op === "border" || op.op === "borderBuild") return { border: op.border, change: op.restore ? { restore: true } : { wall: op.wall, door: op.door, kind: op.kind } };
  if (op.op.startsWith("zoneState.")) return { zone: op.zone, change: { state: op.state ?? op.patch ?? null, id: op.id } };
  if (op.op.startsWith("edge.")) return { change: { edge: op.edge ?? op.id } };
  if (op.op === "tokens") return { change: { tokens: op.rows.map((r) => r.id) } };
  return { change: { batch: op.ops?.length ?? 0 } };
}
