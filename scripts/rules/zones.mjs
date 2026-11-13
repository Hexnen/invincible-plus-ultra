/* Rules library: zones, borders, both notions of distance, range, reach, communication, barriers, wrecking and forced movement.
   Pure ES module, no Foundry globals and no dependency on moinen-maps: the zone graph is the plain data shape described in CONTRACT.md.
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md.

   ZoneGraph input: { zones: Zone[] | { [id]: Zone }, borders: Border[] }
   Zone:   { id, level?: number, terrain?: string|null, building?: boolean, rooftop?: boolean, floors?: number, empty?: boolean,
             wrecked?: boolean, flammable?: boolean, water?: boolean, terrainUnset?: boolean }
   Border: { id?, a, b, wall: null | { armor, state, outer? }, door: null | { armor, state } }
           wall.state: "intact" | "breached" | "removed"; door.state: "open" | "closed" | "locked" | "sealed" | "breached"

   A POSITION is a place in the model of the map's zones API (moinen-maps dev/zones-api.md), so both sides mean the same thing:
     zone key + level ("underground" | "ground" | "elevated" | "floor" with a floor number), or an area off the map
     ("sky" | "orbit" | "dimension" | "chase"). The floors of a large building are LEVELS of one zone (zone.floors), not zones of their own.
   Every function that takes a position accepts any of these forms (toPlace):
     a spot string        "z3" | "z3:elevated" | "z3:underground" | "z3:f2" | "@sky" | "@orbit" | "@dimension" | "@chase"
     a place              { zone, level, floor?, area?, airborne? }   (what the zones API returns; extra fields are ignored)
     the older form       { zone, alt }   alt: "ground" | "elevated" | "underground" | "sky" | "orbit" | "dimension" | "chase"
   A graph in which every floor is a zone of its own joined by borders (the first version of this library) still works: such floors
   are just zones on the ground level. */

export const ALTITUDES = ["ground", "elevated", "sky", "orbit"];
export const LEVELS = ["underground", "ground", "elevated", "floor"];
/* book 2259-2260: sky high and orbit are off the map. "dimension" and "chase" are areas of the plan (5.7 item 6), not of the book. */
export const AREAS = ["sky", "orbit", "dimension", "chase"];
export const WALL_STATES = ["intact", "breached", "removed"];
export const DOOR_STATES = ["open", "closed", "locked", "sealed", "breached"];
const OFF_MAP = new Set(AREAS);
export const isOffMap = (alt) => OFF_MAP.has(alt);

/* book 2398-2416: Armor of doors and walls. Reinforced is 4 or more. */
export const BARRIER_ARMOR = { interiorDoor: 1, interiorWall: 2, exteriorDoor: 2, exteriorWall: 3, reinforced: 4 };

/* book 2459-2485: terrain -> [minimum STRENGTH, attack bonus dice]. Terrain missing here cannot be wrecked (book 2455). */
export const WRECK_TABLE = { office: [4, 1], warehouse: [5, 2], street: [6, 3], woods: [7, 4], building: [8, 5], cliffs: [9, 6] };

/* ------------------------------------------------------------------ graph ------------------------------------------------------------------ */

/* Normalize and validate the plain data. Returns { zones: Map<id, Zone>, borders: Border[], adj: Map<id, [{ to, border }]> }.
   The returned objects are copies; the input is not modified. */
export function makeGraph(data) {
  const list = Array.isArray(data.zones) ? data.zones : Object.entries(data.zones ?? {}).map(([id, z]) => ({ id, ...z }));
  const zones = new Map();
  for (const z of list) {
    if (z.id == null) throw new Error("makeGraph: a zone has no id");
    if (zones.has(z.id)) throw new Error(`makeGraph: duplicate zone "${z.id}"`);
    zones.set(z.id, { level: 0, terrain: null, building: false, rooftop: false, floors: 0, empty: false, wrecked: false, flammable: false, ...z });
  }
  const adj = new Map([...zones.keys()].map((id) => [id, []]));
  const borders = [];
  (data.borders ?? []).forEach((b, i) => {
    if (!zones.has(b.a) || !zones.has(b.b)) throw new Error(`makeGraph: border ${b.id ?? i} joins an unknown zone`);
    if (b.a === b.b) throw new Error(`makeGraph: border ${b.id ?? i} joins a zone with itself`);
    const wall = b.wall ? { armor: 0, state: "intact", ...b.wall } : null;
    const door = b.door ? { armor: 0, state: "closed", ...b.door } : null;
    if (wall && !WALL_STATES.includes(wall.state)) throw new Error(`makeGraph: border ${b.id ?? i} has unknown wall state "${wall.state}"`);
    if (door && !DOOR_STATES.includes(door.state)) throw new Error(`makeGraph: border ${b.id ?? i} has unknown door state "${door.state}"`);
    const border = { ...b, id: b.id ?? `b${i}`, wall, door };
    borders.push(border);
    adj.get(b.a).push({ to: b.b, border });
    adj.get(b.b).push({ to: b.a, border });
  });
  return { zones, borders, adj };
}

const wallStands = (b) => !!b.wall && b.wall.state === "intact";

/* book 2254, 2418: a border is open, or blocked by a wall; a blocked border may have a door. An unlocked door (open or closed) lets
   movement through; a locked or electronically sealed one does not until breached or opened. A breached or removed wall is an open border. */
export function borderOpen(border) {
  if (!wallStands(border)) return true;
  return !!border.door && (border.door.state === "open" || border.door.state === "closed" || border.door.state === "breached");
}

/* book 2381: a wall is the book's example of something that impedes talking. Reading: an intact wall impedes unless its door stands open
   or has been breached; a closed door counts as part of the wall. The GM may overrule. */
export function borderImpedesTalk(border) {
  if (!wallStands(border)) return false;
  return !(border.door && (border.door.state === "open" || border.door.state === "breached"));
}

/* all borders between two neighbouring zones */
export function bordersBetween(graph, a, b) {
  return (graph.adj.get(a) ?? []).filter((e) => e.to === b).map((e) => e.border);
}
/* the border used between two neighbours: an open one when there is any, else the one with the weakest wall */
export function borderBetween(graph, a, b) {
  let best = null;
  for (const border of bordersBetween(graph, a, b)) {
    if (borderOpen(border)) return border;
    if (!best || (border.wall?.armor ?? 0) < (best.wall?.armor ?? 0)) best = border;
  }
  return best;
}

/* breadth-first search over the borders accepted by `pass(border, from, to)`. Returns Map<zoneId, { dist, prev, border }>. */
function bfs(graph, from, pass, limit = Infinity) {
  if (!graph.zones.has(from)) throw new Error(`unknown zone "${from}"`);
  const seen = new Map([[from, { dist: 0, prev: null, border: null }]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i], d = seen.get(cur).dist;
    if (d >= limit) continue;
    for (const { to, border } of graph.adj.get(cur)) {
      if (seen.has(to) || !pass(border, cur, to)) continue;
      seen.set(to, { dist: d + 1, prev: cur, border });
      queue.push(to);
    }
  }
  return seen;
}
function pathFrom(seen, to) {
  if (!seen.has(to)) return null;
  const zones = [], borders = [];
  for (let c = to; c !== null; c = seen.get(c).prev) { zones.push(c); if (seen.get(c).border) borders.push(seen.get(c).border); }
  return { zones: zones.reverse(), borders: borders.reverse(), length: zones.length - 1 };
}

/* ------------------------------------------------------------------ distance for range (borders counted, walls included) ------------------------------------------------------------------ */

/* book 2255 + ruling 23: distance = number of zone borders on the shortest route; a blocked border is still a border, so range never
   needs a passable route. Returns the border count between two zones (Infinity when they are not connected at all). */
export function borderDistance(graph, zoneA, zoneB) {
  if (!graph.zones.has(zoneB)) throw new Error(`unknown zone "${zoneB}"`);
  const seen = bfs(graph, zoneA, () => true);
  return seen.has(zoneB) ? seen.get(zoneB).dist : Infinity;
}

/* ------------------------------------------------------------------ places (zone + level, or an area off the map) ------------------------------------------------------------------ */

/* book 2262, 2417: the floors above the ground floor of a large building, each a vertical zone; a wrecked building has none (book 2457). */
export const floorsOf = (zone) => (zone && (zone.building || zone.rooftop) && !zone.wrecked ? Math.max(0, Math.floor(zone.floors ?? 0)) : 0);

const spotString = (zone, level, floor) => (level === "ground" ? `${zone}` : level === "floor" ? `${zone}:f${floor}` : `${zone}:${level}`);

/* A spot string as { zone, alt, floor }, or null when it is not one. */
export function parseSpot(s) {
  if (typeof s !== "string" || !s) return null;
  if (s[0] === "@") return AREAS.includes(s.slice(1)) ? { zone: s, alt: s.slice(1), floor: 0 } : null;
  const i = s.indexOf(":");
  if (i < 0) return { zone: s, alt: "ground", floor: 0 };
  const zone = s.slice(0, i), t = s.slice(i + 1), m = /^f(\d+)$/.exec(t);
  if (m) return { zone, alt: "ground", floor: Number(m[1]) };
  return t === "elevated" || t === "underground" || t === "ground" ? { zone, alt: t, floor: 0 } : null;
}

/* Normalize a position (any of the forms in the header) to a place:
     { zone, area, level, floor, airborne, roof, spot }
   zone   the zone id / key (off the map: "@<area>");  area  null on the map;  level null off the map;  floor 1..n on level "floor";
   roof   elevated and standing on the rooftop of a standing building; airborne  elevated and not on a rooftop (book 2258, 2396, 2457);
   spot   the 3-D zone as one string: two characters are in the same zone in the book's sense exactly when their spots are equal (book 2258).
   Same rules as the map's makePlace: a floor the building does not have is the ground; elevated over a standing building is its
   rooftop unless the position says airborne. A string that names a zone of the graph is that zone (so an id may contain ":"). */
export function toPlace(graph, pos) {
  let zone, alt, floor = 0, air = false;
  if (typeof pos === "string") {
    const p = graph.zones.has(pos) ? { zone: pos, alt: "ground", floor: 0 } : parseSpot(pos);
    if (!p) throw new Error(`toPlace: "${pos}" is not a spot`);
    ({ zone, alt, floor } = p);
  } else if (pos && typeof pos === "object") {
    zone = pos.zone ?? null;
    floor = pos.floor ?? 0;
    air = !!(pos.airborne ?? pos.air);
    const zoneArea = typeof zone === "string" && zone[0] === "@" && AREAS.includes(zone.slice(1)) ? zone.slice(1) : null;
    alt = pos.area ?? zoneArea ?? (pos.level != null ? (pos.level === "floor" ? "ground" : pos.level) : pos.alt ?? "ground");
  } else throw new Error("toPlace: no position");
  if (AREAS.includes(alt)) return { zone: `@${alt}`, area: alt, level: null, floor: 0, airborne: false, roof: false, spot: `@${alt}` };
  if (zone == null) return { zone: null, area: null, level: alt === "elevated" || alt === "underground" ? alt : "ground", floor: 0, airborne: alt === "elevated", roof: false, spot: null };
  const z = graph.zones.get(zone);
  if (!z) throw new Error(`unknown zone "${zone}"`);
  const base = { zone, area: null, floor: 0, airborne: false, roof: false };
  if (alt === "underground") return { ...base, level: "underground", spot: spotString(zone, "underground") };
  if (alt === "elevated") {
    const roof = !air && hasRooftop(z);
    return { ...base, level: "elevated", roof, airborne: !roof, spot: spotString(zone, "elevated") };
  }
  const f = Math.round(Number(floor) || 0);
  if (f > 0 && f <= floorsOf(z)) return { ...base, level: "floor", floor: f, spot: spotString(zone, "floor", f) };
  return { ...base, level: "ground", spot: spotString(zone, "ground") };
}
/* book 2258: the same zone in the book's sense (elevated characters over one horizontal zone share a zone; so do all in one off-map area). */
export function sameSpot(graph, a, b) {
  const A = toPlace(graph, a), B = toPlace(graph, b);
  return A.spot != null && A.spot === B.spot;
}

/* How many vertical zones above the ground a place is (null off the map):
   book 2262, 2417 a floor its number; book 2258 an elevated position 1; the rooftop of a building with floors one above its top floor
   (book 2417: inside the building every floor is a vertical zone);
   underground -1: the book gives underground no height (book 1995); this is reading ZR-1 of the zones contract, taken over so that
   both sides agree. */
export function heightOf(graph, place) {
  const p = place?.spot !== undefined && place?.level !== undefined ? place : toPlace(graph, place);
  if (p.area) return null;
  if (p.level === "underground") return -1;
  if (p.level === "floor") return p.floor;
  if (p.level === "elevated") return p.roof ? floorsOf(graph.zones.get(p.zone)) + 1 : 1;
  return 0;
}
/* ruling 2 (book 2258-2262): the vertical part of a range. Two elevated places: 0. Otherwise the difference in height, where an
   elevated place over ANOTHER zone counts 1 (book 2417: from outside, a rooftop is one zone up however many floors lie under it). */
function levelGap(graph, A, B) {
  if (A.level === "elevated" && B.level === "elevated") return 0;
  const h = (p) => (p.level === "elevated" && A.zone !== B.zone ? 1 : heightOf(graph, p));
  return Math.abs(h(A) - h(B));
}

/* Range between two positions, in parts: { borders, levels, total }, or null when no attack is possible at all.
   Same answers as the zones API's range(a, b) on the same data (check-places.mjs holds the cases):
   book 2254-2255 + ruling 23: borders on the shortest route, blocked ones included;
   ruling 2 (book 2258-2262): a level difference adds its vertical zones (levelGap); two elevated characters count the horizontal
   distance only; floors are vertical zones, so the difference can exceed 1;
   book 2259-2260 + ruling 2: everybody in the same off-map area shares one zone (0); nobody attacks into or out of one (null).
   null also for a position outside every zone and for zones that are not connected. */
export function rangeBetween(graph, a, b) {
  const A = toPlace(graph, a), B = toPlace(graph, b);
  if (A.area || B.area) return A.area && A.area === B.area ? { borders: 0, levels: 0, total: 0 } : null;
  if (A.zone == null || B.zone == null) return null;
  const borders = borderDistance(graph, A.zone, B.zone);
  if (borders === Infinity) return null;
  const levels = levelGap(graph, A, B);
  return { borders, levels, total: borders + levels };
}

/* Range distance between two positions as one number: rangeBetween(...).total, Infinity where that is null.
   ruling 2 (book 2258-2262): a ground / elevated difference adds one zone; two elevated characters count the horizontal distance only;
   floors add one zone each (as levels of one zone, or as zones of their own in an older graph).
   book 2259-2260 + ruling 2: sky high and orbit are off the map: everybody at the same of these altitudes shares one zone (0), and nobody
   can attack or be attacked across (Infinity). */
export function rangeDistance(graph, a, b) {
  const r = rangeBetween(graph, a, b);
  return r ? r.total : Infinity;
}

/* zones within n borders of a zone, walls ignored (areas of powers, ranges): Map<zoneId, distance> (book 2255, ruling 23) */
export function zonesInRange(graph, zone, n) {
  const out = new Map();
  for (const [id, v] of bfs(graph, zone, () => true, n)) out.set(id, v.dist);
  return out;
}

/* ------------------------------------------------------------------ distance for movement (passable routes only) ------------------------------------------------------------------ */

/* Which borders a mover may cross. profile: { aerial?: boolean, through?: "open" | "any" }.
   Default (book 2383, 2418, ruling 23): open borders and unlocked doors only.
   aerial (book 2385): flyers pass over the top of buildings without hindrance; the step over a blocked border is marked `over`.
   Which blocked borders that means was question OQ-14; the user's answer A14 (2026-11-12) settles it, and the map's zones API
   (moinen-maps marks.mjs stopped(), way "air") reads it the same way:
     - a building's exterior wall (wall.outer) never stops a flyer;
     - from outside a flyer passes over every standing building by its roof: a blocked border with a rooftop on exactly one of its
       two sides is crossed, whatever the wall is marked as (a reinforced wall or a locked door included);
     - a wall between two standing buildings is a wall inside a building and stops it (unless marked exterior: two buildings side by
       side); a freestanding wall (no rooftop on either side) stops it unless marked exterior;
     - a wrecked building has no rooftop left to fly over (book 2457, hasRooftop).
   The older profile option `over` ("rooftop" | "exterior", the two readings of OQ-14) is ignored: A14 replaced both.
   through "any" is for effects that do not travel through the space in between (book 2034, teleportation; book 1995, burrowing
   ignores all walls and doors). */
export const flyerCrosses = (graph, border, from, to) =>
  borderOpen(border) || !!border.wall?.outer || hasRooftop(graph.zones.get(from)) !== hasRooftop(graph.zones.get(to));
function passFor(graph, profile = {}) {
  if (profile.through === "any") return () => true;
  if (profile.aerial) return (border, from, to) => flyerCrosses(graph, border, from, to);
  return (border) => borderOpen(border);
}

/* book 2258, 2394, 2457: a building zone of a city map has a rooftop (an elevated position) until the building is wrecked. */
export const hasRooftop = (zone) => !!zone && !!zone.rooftop && !zone.wrecked;

/* Shortest movement route. Returns null when there is none, else { zones, borders, steps: [{ from, to, border, over }], length }.
   Moving between the ground and elevated altitude is part of the same move and adds nothing (book 2386, 2420). */
export function moveRoute(graph, from, to, profile = {}) {
  if (!graph.zones.has(to)) throw new Error(`unknown zone "${to}"`);
  const path = pathFrom(bfs(graph, from, passFor(graph, profile)), to);
  if (!path) return null;
  const steps = path.borders.map((border, i) => ({ from: path.zones[i], to: path.zones[i + 1], border, over: !!profile.aerial && profile.through !== "any" && !borderOpen(border) }));
  return { ...path, steps };
}
export function moveDistance(graph, from, to, profile = {}) {
  const r = moveRoute(graph, from, to, profile);
  return r ? r.length : Infinity;
}
/* zones a mover can reach with n zones of movement: Map<zoneId, distance> */
export function zonesReachable(graph, zone, n, profile = {}) {
  const out = new Map();
  for (const [id, v] of bfs(graph, zone, passFor(graph, profile), n)) out.set(id, v.dist);
  return out;
}
/* the route that ignores every barrier (charges through walls, forced movement), same return shape as moveRoute without `over` */
export function straightRoute(graph, from, to) {
  if (!graph.zones.has(to)) throw new Error(`unknown zone "${to}"`);
  const path = pathFrom(bfs(graph, from, () => true), to);
  return path ? { ...path, steps: path.borders.map((border, i) => ({ from: path.zones[i], to: path.zones[i + 1], border, over: false })) } : null;
}

/* The vertical zones a mover crosses inside the building at one end of a route; null = this mover cannot be at / get to that place.
   Walkers (book 2394, 2417): the stairs, one zone per floor, the rooftop one above the top floor (1 for a plain building); the air
   cannot be walked to or from (landing or falling is a level change made first).
   Aerial movers and movers that pass through (book 2386): nothing, ground and elevated change inside the move; leaving a floor by a
   window costs them nothing (reading ZR-2 of the zones contract, taken over).
   Underground is reached and left only by a mover with through "any" (book 1995 burrowing; reading ZR-4 of the zones contract). */
function climb(graph, p, profile) {
  if (p.level === "underground") return profile.through === "any" ? 0 : null;
  if (profile.aerial || profile.through === "any") return 0;
  if (p.level === "elevated") return p.roof ? floorsOf(graph.zones.get(p.zone)) + 1 : null;
  return p.level === "floor" ? p.floor : 0;
}

/* Length of a movement route between two positions, in parts: { borders, levels, total }, or null when there is no way.
   Same construction as the zones API's route(a, b, way): passable borders by profile (moveDistance) plus the vertical zones at both
   ends (climb). Inside one zone a walker counts the floors between, the others count 1 for a change of level (a quick action,
   book 2386). To or from an off-map area: null (that is one full action whatever the distance, book 2387-2388: altitudeChangeCost).
   In live play routes come from the zones API; this is for callers that hold only a graph. */
export function routeBetween(graph, a, b, profile = {}) {
  const A = toPlace(graph, a), B = toPlace(graph, b);
  if (A.area || B.area || A.zone == null || B.zone == null) return null;
  const up = climb(graph, A, profile), down = climb(graph, B, profile);
  if (up == null || down == null) return null;
  if (A.zone === B.zone) {
    if (A.spot === B.spot) return { borders: 0, levels: 0, total: 0 };
    const levels = profile.aerial || profile.through === "any" ? 1 : Math.abs(up - down);
    return { borders: 0, levels, total: levels };
  }
  const borders = moveDistance(graph, A.zone, B.zone, profile);
  if (borders === Infinity) return null;
  return { borders, levels: up + down, total: borders + up + down };
}

/* book 2386-2388, 2377: ground <-> elevated is a quick action and may be part of a horizontal move; to or from sky high or orbit is one
   full action. Takes altitude / level / area names ("ground", "elevated", "underground", "sky", "orbit", "dimension", "chase").
   Returns "none" | "quick" | "full" | "gm".
   "gm": to or from "dimension" or "chase", which are areas of the plan and have no movement cost in the book: the GM says.
   Underground <-> ground is given as "quick" like the map's altCost does; it is only possible for burrowers (book 1995), whose
   burrowing is itself a movement action. A change of FLOOR is not a change of altitude: floors are walked as zones (routeBetween). */
export function altitudeChangeCost(fromAlt, toAlt) {
  if (fromAlt === toAlt) return "none";
  if ([fromAlt, toAlt].some((x) => x === "dimension" || x === "chase")) return "gm";
  return isOffMap(fromAlt) || isOffMap(toAlt) ? "full" : "quick";
}

/* ------------------------------------------------------------------ reach and range ------------------------------------------------------------------ */

/* Can the attacker reach the target in slugfest? opts: { huge (attacker), range (0; 1 when the attack wrecks the attacker's zone, book 2453),
   reachesElevated (a special power or vehicle, book 2429) }.
   book 2425 same zone only; 2258, 2429 no slugfest from the ground at an elevated target, two elevated characters of one horizontal zone
   share a zone; 2429, 2500 a huge creature on the ground reaches elevated targets; 2259-2260 off-map altitudes are one zone each.
   The altitude difference is counted as in ruling 2, so a range-1 attack reaches an elevated target of the attacker's own zone. */
export function slugfestReach(graph, attacker, target, opts = {}) {
  return slugfestReachAt(rangeBetween(graph, attacker, target), toPlace(graph, attacker), toPlace(graph, target), opts);
}
/* The same decision from numbers, for callers that take distances from the zones API (the rule stays in one place):
   range    what the zones API's range(a, b) returned: { borders, levels, total } | null
   attacker, target   their places; only `level` and `area` are read ({ level: "ground" } is enough)
   opts     as slugfestReach.
   Reasons: "altitude" (an off-map area is involved, book 2259-2260) | "noRange" (no line between the two at all) | "distance"
   (another horizontal zone) | "elevated" (same horizontal zone, ground against elevated, book 2258) | "level" (same horizontal zone,
   another floor or underground: floors are vertical zones, book 2262).
   Returns { ok, reason, distance } (distance Infinity when there is no range). */
export function slugfestReachAt(range, attacker = {}, target = {}, opts = {}) {
  if (!range) return { ok: false, reason: attacker.area || target.area ? "altitude" : "noRange", distance: Infinity };
  const max = opts.range ?? 0, d = range.total;
  if (d <= max) return { ok: true, reason: null, distance: d };
  const level = (p) => p.level ?? "ground";
  const sameZone = range.borders === 0;
  if (sameZone && level(target) === "elevated" && level(attacker) === "ground" && (opts.huge || opts.reachesElevated)) return { ok: true, reason: null, distance: d };
  const plain = (p) => level(p) === "ground" || level(p) === "elevated";
  return { ok: false, reason: !sameZone ? "distance" : plain(attacker) && plain(target) ? "elevated" : "level", distance: d };
}

/* book 2511, 2538: a ranged attack has a minimum and maximum range; closer than the minimum = -3 dice, beyond the maximum = impossible.
   Returns { ok, dice (0 or -3), reason }. */
export const MIN_RANGE_PENALTY = -3;
export function shootingRange(distance, range) {
  const [min, max] = range;
  if (!(distance <= max)) return { ok: false, dice: 0, reason: distance === Infinity ? "altitude" : "tooFar" };
  return { ok: true, dice: distance < min ? MIN_RANGE_PENALTY : 0, reason: null };
}
/* convenience: range check between two positions */
export const canShoot = (graph, attacker, target, range) => {
  const distance = rangeDistance(graph, attacker, target);
  return { ...shootingRange(distance, range), distance };
};

/* ------------------------------------------------------------------ communication ------------------------------------------------------------------ */

/* book 2381: characters in the same zone or in adjacent zones talk directly unless something (such as a wall) impedes it; farther away
   they need communicators or a power such as telepathy. opts: { link: true } = a communicator or power link exists.
   Reading: adjacency is horizontal (ground and elevated in the same or neighbouring zones can shout); off-map altitudes are one zone
   each and are not adjacent to anything. Returns { ok, direct, reason }. */
export function canCommunicate(graph, a, b, opts = {}) {
  const A = toPlace(graph, a), B = toPlace(graph, b);
  const range = rangeBetween(graph, A, B);
  const between = range && range.borders === 1 ? bordersBetween(graph, A.zone, B.zone) : [];
  return canCommunicateAt(range, A, B, { link: opts.link, impeded: between.length > 0 && !between.some((x) => !borderImpedesTalk(x)) });
}
/* The same decision from numbers, for callers that take distances from the zones API:
   range   what the zones API's range(a, b) returned: { borders, levels, total } | null
   a, b    their places; only `level` and `area` are read
   opts    { link (a communicator or power link exists), impeded (the border between two neighbouring zones impedes talking:
           borderImpedesTalk on the library's border, or the GM's word) }
   book 2381: same zone or adjacent zones. Reading (3): ground and elevated count as the same height for talking; reading (3a): any
   other level difference counts its vertical zones (floors are zones, book 2262), so the next floor up or down is "adjacent", a
   floor further is not, and the ground floor of a neighbouring building is adjacent only to the street level.
   Everybody in one off-map area shares a zone (book 2259-2260); an off-map area is adjacent to nothing.
   Returns { ok, direct, reason }; reasons "distance" | "wall". */
export function canCommunicateAt(range, a = {}, b = {}, opts = {}) {
  let direct = false, reason = "distance";
  if (a.area || b.area) direct = !!a.area && a.area === b.area;
  else if (range) {
    const plain = (p) => (p.level ?? "ground") === "ground" || p.level === "elevated";
    const d = range.borders + (plain(a) && plain(b) ? 0 : range.levels);
    if (d === 0) direct = true;
    else if (d === 1) {
      direct = !(range.borders === 1 && opts.impeded);
      if (!direct) reason = "wall";
    }
  }
  if (direct) return { ok: true, direct: true, reason: null };
  return opts.link ? { ok: true, direct: false, reason: null } : { ok: false, direct: false, reason };
}

/* ------------------------------------------------------------------ barriers ------------------------------------------------------------------ */

/* book 2418: a barrier yields only to a character whose half STRENGTH (rounded up) exceeds its Armor. */
export const canBreach = (strength, armor) => Math.ceil(strength / 2) > armor;

/* What can be done about a blocked border. Returns [] for an open border, else options
   { element: "door" | "wall", armor, attr, action, crashOnly }:
   book 2418 a locked door or hatch: STRENGTH roll, quick action; an electronically sealed one: REASON roll, full action (and STRENGTH as for a lock is not stated, so not offered);
   book 2419 a door or wall can be crashed through as part of a move (STRENGTH roll inside the same quick action). */
export function breachOptions(border) {
  if (borderOpen(border)) return [];
  const out = [];
  if (border.door?.state === "locked") out.push({ element: "door", armor: border.door.armor, attr: "strength", action: "quick", crashOnly: false });
  if (border.door?.state === "sealed") {
    out.push({ element: "door", armor: border.door.armor, attr: "reason", action: "full", crashOnly: false });
    out.push({ element: "door", armor: border.door.armor, attr: "strength", action: "quick", crashOnly: true });
  }
  out.push({ element: "wall", armor: border.wall.armor, attr: "strength", action: "quick", crashOnly: true });
  return out;
}

/* Outcome of a STRENGTH attempt on a barrier. book 2418: impossible unless canBreach; needs a successful roll.
   book 2419: when crashing through as part of a move, a failed roll stops the mover at the barrier and costs damage equal to the
   barrier's Armor (whether the mover's own Armor reduces it is not stated: the raw number is returned).
   Returns { allowed, breached, stopped, damage }. */
export function breachOutcome({ strength, armor, sixes, crashing = false }) {
  if (!canBreach(strength, armor)) return { allowed: false, breached: false, stopped: crashing, damage: 0 };
  if (sixes > 0) return { allowed: true, breached: true, stopped: false, damage: 0 };
  return { allowed: true, breached: false, stopped: crashing, damage: crashing ? armor : 0 };
}

/* ------------------------------------------------------------------ wrecking a zone ------------------------------------------------------------------ */

/* book 2451-2457: as part of a slugfest attack the attacker may wreck the zone they are in: bonus dice, the attack reaches an adjacent
   zone (range 1), a zone is wrecked only once per scene, the terrain sets a minimum STRENGTH, some terrain cannot be wrecked, and a
   wrecked building of a city map is levelled (its rooftop stops being an elevated position).
   A zone whose terrain was never set on the map (zone.terrainUnset, see graphFromZonesApi) is neither wreckable nor "cannot be wrecked"
   by the book: reason "terrainUnset" with gmMayAllow (question OQ-18 of the handoff); terrain that is set and not in the table gives "terrain".
   Returns { ok, reason, bonus, range, levelsRooftop } (+ gmMayAllow on "terrainUnset", minStrength on "strength"). */
export function wreckCheck(zone, strength) {
  const row = WRECK_TABLE[zone?.terrain];
  if (!row && zone?.terrainUnset) return { ok: false, reason: "terrainUnset", bonus: 0, range: 0, levelsRooftop: false, gmMayAllow: true };
  if (!row) return { ok: false, reason: "terrain", bonus: 0, range: 0, levelsRooftop: false };
  if (zone.wrecked) return { ok: false, reason: "alreadyWrecked", bonus: 0, range: 0, levelsRooftop: false };
  if (strength < row[0]) return { ok: false, reason: "strength", bonus: 0, range: 0, levelsRooftop: false, minStrength: row[0] };
  return { ok: true, reason: null, bonus: row[1], range: 1, levelsRooftop: !!zone.rooftop };
}

/* ------------------------------------------------------------------ forced movement (Knockback, Slam) ------------------------------------------------------------------ */

/* Push a target along a chain of zones and resolve the barriers on the way.
   input: { path: [zoneId...] (start zone first; the direction chain, edited or approved by the GM: ruling 7 for Knockback, ruling 7a for
            Slam = further along the charge route), distance (zones to travel), damage (hit on the first barrier), targetArmor,
            decay (damage lost at each barrier after the first: 1 for Knockback, 0 for Slam), elements?: { [borderId]: "door" | "wall" } }
   book 2435 Knockback: distance and barrier damage = half STRENGTH rounded up; the damage is reduced by the target's Armor; a barrier
   whose Armor is lower than the damage is passed, and the damage drops by 1 at each barrier after the first.
   book 2494 Slam: barrier damage = half STRENGTH rounded up, no decay stated.
   ruling 8 (book example 2504): the barrier's Armor is compared with the damage BEFORE the target's Armor is taken off, and the damage is
   due at every barrier hit, also one that holds.
   A border counts as a barrier when it is not open for movement; the wall's Armor is used unless `elements` names the door.
   Returns { zone, moved, stoppedBy: borderId | null, hits: [{ border, element, armor, raw, taken, through }], breached: [borderId] }. */
export function forcedMove(graph, { path, distance, damage, targetArmor = 0, decay = 1, elements = {} }) {
  let zone = path[0], moved = 0, barriers = 0, stoppedBy = null;
  const hits = [], breached = [];
  for (let i = 1; i < path.length && moved < distance; i++) {
    const next = path[i];
    const border = borderBetween(graph, zone, next);
    if (!border) throw new Error(`forcedMove: "${zone}" and "${next}" are not neighbours`);
    if (!borderOpen(border)) {
      const element = elements[border.id] === "door" && border.door ? "door" : "wall";
      const armor = border[element].armor;
      const raw = Math.max(0, damage - decay * barriers);
      barriers++;
      const through = armor < raw;
      hits.push({ border: border.id, element, armor, raw, taken: Math.max(0, raw - targetArmor), through });
      if (!through) { stoppedBy = border.id; break; }
      breached.push(border.id);
    }
    zone = next; moved++;
  }
  return { zone, moved, stoppedBy, hits, breached };
}

/* ------------------------------------------------------------------ zone graph from the zones API's data ------------------------------------------------------------------ */

/* Armor of the wall and door behind the map's older one-kind border marks. book 2398-2416 gives Armor by interior / exterior
   (BARRIER_ARMOR), not by lock; the older marks have one Armor per border, so the wall around a "door" or "locked" mark is ASSUMED to
   be an interior wall (the same assumption the map's own wall-plus-door model makes when it reads those marks) and flagged
   `armorAssumed`: a forced move into such a border should ask the GM (reading 6). */
export const BORDER_KINDS = {
  open: null,
  door: { wall: { armor: BARRIER_ARMOR.interiorWall, state: "intact", outer: false, armorAssumed: true }, door: { armor: 1, state: "closed" } },
  locked: { wall: { armor: BARRIER_ARMOR.interiorWall, state: "intact", outer: false, armorAssumed: true }, door: { armor: 2, state: "locked" } },
  wall: { wall: { armor: BARRIER_ARMOR.interiorWall, state: "intact", outer: false }, door: null },
  outer: { wall: { armor: BARRIER_ARMOR.exteriorWall, state: "intact", outer: true }, door: null },
  reinforced: { wall: { armor: BARRIER_ARMOR.reinforced, state: "intact", outer: false }, door: null },
};

/* Build the library's ZoneGraphData from what the map's zones API returns (pure data in, pure data out; no map code is imported):
     zones    api.zoneList()            [{ key, building, floors, rooftop, terrain, empty, tags, states: { wrecked, fire, ... }, props? }]
     borders  the borders of the scene  [{ key, zones: [keyA, keyB], kind, armor?, wall?, doorway? }] (api.bordersOf(...) of every zone,
              or api.borderBetween results; duplicates by key are dropped)
   Zones keep their key as id and their floors as LEVELS (zone.floors), so a position of the zones API (a place or a spot string) is a
   position here without conversion.
   Borders: where the map already gives a wall and a door of their own (`wall: { armor, state, outer }`, `doorway: { armor, state }`,
   its wall-plus-door model) they are taken as they are; otherwise the one `kind` is translated with BORDER_KINDS.
   Terrain: "" (never set) becomes terrain null + terrainUnset (wreckCheck then answers "terrainUnset", OQ-18); "none" and anything
   outside WRECK_TABLE become terrain null (cannot be wrecked, book 2455).
   Pass the result to makeGraph. */
export function graphFromZonesApi({ zones = [], borders = [] } = {}) {
  const outZones = zones.map((z) => {
    const tags = Array.isArray(z.tags) ? z.tags : [];
    const building = !!z.building;
    return {
      id: z.key, terrain: WRECK_TABLE[z.terrain] ? z.terrain : null, terrainUnset: z.terrain === "" || z.terrain == null,
      building, rooftop: building, floors: building ? Math.max(0, Math.floor(z.props?.floors ?? z.floors ?? 0)) : 0,
      empty: !!z.empty, wrecked: !!z.states?.wrecked, flammable: tags.includes("flammable"), water: tags.includes("water"),
      fire: z.states?.fire ?? 0, tags: tags.slice(),
    };
  });
  const seen = new Set(), outBorders = [];
  for (const b of borders) {
    if (!b || seen.has(b.key)) continue;
    seen.add(b.key);
    const part = (p, states) => (p && typeof p === "object" && states.includes(p.state) ? p : null);
    let wall = null, door = null;
    const own = "wall" in b && (b.wall === null || part(b.wall, WALL_STATES));
    if (own) {
      const w = part(b.wall, WALL_STATES), d = part(b.doorway ?? (typeof b.door === "object" ? b.door : null), DOOR_STATES);
      wall = w ? { armor: w.armor ?? 0, state: w.state, outer: !!w.outer } : null;
      door = w && d ? { armor: d.armor ?? 0, state: d.state } : null;
    } else {
      const k = BORDER_KINDS[b.kind ?? "open"];
      if (k === undefined) throw new Error(`graphFromZonesApi: unknown border kind "${b.kind}"`);
      if (k) { wall = { ...k.wall }; door = k.door ? { ...k.door } : null; }
    }
    outBorders.push({ id: b.key, a: b.zones[0], b: b.zones[1], wall, door });
  }
  return { zones: outZones, borders: outBorders };
}
