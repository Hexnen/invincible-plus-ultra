/* Rules library: zones, borders, both notions of distance, range, reach, communication, barriers, wrecking and forced movement.
   Pure ES module, no Foundry globals and no dependency on moinen-maps: the zone graph is the plain data shape described in CONTRACT.md.
   "book N" = line N of dev/book-dump.txt; "ruling N" = row N of section 4 of dev/combat-plan.md.

   ZoneGraph input: { zones: Zone[] | { [id]: Zone }, borders: Border[] }
   Zone:   { id, level?: number, terrain?: string|null, rooftop?: boolean, empty?: boolean, wrecked?: boolean, flammable?: boolean }
   Border: { id?, a, b, wall: null | { armor, state }, door: null | { armor, state } }
           wall.state: "intact" | "breached" | "removed"; door.state: "open" | "closed" | "locked" | "sealed" | "breached"
   Position: { zone, alt }  alt: "ground" | "elevated" | "sky" | "orbit" */

export const ALTITUDES = ["ground", "elevated", "sky", "orbit"];
export const WALL_STATES = ["intact", "breached", "removed"];
export const DOOR_STATES = ["open", "closed", "locked", "sealed", "breached"];
const OFF_MAP = new Set(["sky", "orbit"]);
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
    zones.set(z.id, { level: 0, terrain: null, rooftop: false, empty: false, wrecked: false, flammable: false, ...z });
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

/* Range distance between two positions.
   ruling 2 (book 2258-2262): a ground / elevated difference adds one zone; two elevated characters count the horizontal distance only;
   floors of large buildings are zones of their own in the graph, so they add their borders by themselves.
   book 2259-2260 + ruling 2: sky high and orbit are off the map: everybody at the same of these altitudes shares one zone (0), and nobody
   can attack or be attacked across (Infinity). */
export function rangeDistance(graph, a, b) {
  if (isOffMap(a.alt) || isOffMap(b.alt)) return a.alt === b.alt ? 0 : Infinity;
  const d = borderDistance(graph, a.zone, b.zone);
  return d + ((a.alt ?? "ground") !== (b.alt ?? "ground") ? 1 : 0);
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
   aerial (book 2385): flyers pass over the top of buildings without hindrance, so a blocked border is crossed when one of its two zones
   has a rooftop (a city-map building that has not been levelled, book 2457); the step is marked `over`.
   through "any" is for effects that do not travel through the space in between (book 2034, teleportation). */
function passFor(graph, profile = {}) {
  if (profile.through === "any") return () => true;
  if (profile.aerial) return (border, from, to) => borderOpen(border) || hasRooftop(graph.zones.get(from)) || hasRooftop(graph.zones.get(to));
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

/* book 2386-2388, 2377: ground <-> elevated is a quick action and may be part of a horizontal move; to or from sky high or orbit is one
   full action. Returns "none" | "quick" | "full". */
export function altitudeChangeCost(fromAlt, toAlt) {
  if (fromAlt === toAlt) return "none";
  return isOffMap(fromAlt) || isOffMap(toAlt) ? "full" : "quick";
}

/* ------------------------------------------------------------------ reach and range ------------------------------------------------------------------ */

/* Can the attacker reach the target in slugfest? opts: { huge (attacker), range (0; 1 when the attack wrecks the attacker's zone, book 2453),
   reachesElevated (a special power or vehicle, book 2429) }.
   book 2425 same zone only; 2258, 2429 no slugfest from the ground at an elevated target, two elevated characters of one horizontal zone
   share a zone; 2429, 2500 a huge creature on the ground reaches elevated targets; 2259-2260 off-map altitudes are one zone each.
   The altitude difference is counted as in ruling 2, so a range-1 attack reaches an elevated target of the attacker's own zone. */
export function slugfestReach(graph, attacker, target, opts = {}) {
  const range = opts.range ?? 0;
  const d = rangeDistance(graph, attacker, target);
  if (d === Infinity) return { ok: false, reason: "altitude", distance: d };
  if (d <= range) return { ok: true, reason: null, distance: d };
  const sameZone = attacker.zone === target.zone && !isOffMap(attacker.alt);
  if (sameZone && target.alt === "elevated" && (attacker.alt ?? "ground") === "ground" && (opts.huge || opts.reachesElevated)) return { ok: true, reason: null, distance: d };
  return { ok: false, reason: sameZone ? "elevated" : "distance", distance: d };
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
  let direct = false, reason = "distance";
  if (isOffMap(a.alt) || isOffMap(b.alt)) direct = a.alt === b.alt;
  else if (a.zone === b.zone) direct = true;
  else {
    const between = bordersBetween(graph, a.zone, b.zone);
    if (between.length) {
      direct = between.some((x) => !borderImpedesTalk(x));
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
   Returns { ok, reason, bonus, range, levelsRooftop }. */
export function wreckCheck(zone, strength) {
  const row = WRECK_TABLE[zone?.terrain];
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
