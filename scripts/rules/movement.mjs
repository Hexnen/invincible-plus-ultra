/* Rules library: the cost of a move from a movement profile: zones per action by way of moving, the stress option, the conditions
   that turn movement into a full action. Pure ES module, no Foundry globals. The LENGTH of a move is not computed here: it is the
   `total` of a route (the zones API's route, or zones.mjs routeBetween); this module prices that number.
   Which action slots a character still has this round (and whether a full action may be spent where a quick one is asked) is the
   action economy, not this module. */

/* book 1999-2002, 2007-2010, 2013-2016, 2034-2037: the four levels of the travel powers: [zones per action, zones for 1 stress]. */
export const TRAVEL_TIERS = { basic: [2, 4], major: [4, 8], massive: [8, 16], monstrous: [16, 32] };
const TIERED = { ...TRAVEL_TIERS };
const BOOSTED = { basic: [2, 4], fast: [4, 8] };
const BOTH = ["quick", "full"];

/* Ways of moving. Per entry:
     way      the route kind of the zones contract (spec 7.4 mapping; "air" for leaping and super-speed is the map's reading ZR-3)
     tiers    { tier: [zones, zonesForStress|null] }
     actions  the action kinds the text allows for one move: walking is a quick action (book 2383); the powers say "a single (quick
              or full) action"; Teleportation says "a single quick action" and is a quick action only (ruling 18)
     medium   what the move counts as for the conditions below: "ground" | "air" | "water" | "none"
     assumed  true where the book does not classify the way as ground or aerial movement and the medium is this library's
              provisional reading (leaping, super-speed, swinging: reading 17); moveCost then lists the condition under `unsettled`
     ends     where the text lets the move end, as data for the caller (not checked here)
   book lines: walk 2383; grown 1975; flight 1999-2002; leaping 2007-2010; super-speed 2013-2016; teleportation 2034-2037 + ruling 18;
   burrowing 1995 ("works like ground movement"); swimming 2021-2022; swinging 2027-2030; Earth Drift 1676; Elongated Stride 1922. */
export const MOVE_MODES = {
  walk: { way: "walk", tiers: { basic: [1, null] }, actions: ["quick"], medium: "ground" },
  grown: { way: "walk", tiers: { basic: [2, null] }, actions: BOTH, medium: "ground" },
  earthDrift: { way: "walk", tiers: { basic: [2, 4] }, actions: BOTH, medium: "ground" },
  iceSlide: { way: "walk", tiers: { basic: [2, 4] }, actions: BOTH, medium: "ground" },
  wings: { way: "air", tiers: { basic: [2, null] }, actions: BOTH, medium: "air", ends: ["ground", "rooftop", "air"] },
  elongatedStride: { way: "walk", tiers: { basic: [2, 4] }, actions: BOTH, medium: "ground", vertical: true },
  burrowing: { way: "through", tiers: { basic: [2, 4] }, actions: BOTH, medium: "ground" },
  flight: { way: "air", tiers: TIERED, actions: BOTH, medium: "air", ends: ["ground", "rooftop", "air"] },
  leaping: { way: "air", tiers: TIERED, actions: BOTH, medium: "air", assumed: true, ends: ["ground", "rooftop"] },
  superSpeed: { way: "air", tiers: TIERED, actions: BOTH, medium: "ground", assumed: true, ends: ["ground", "rooftop"] },
  teleportation: { way: "through", tiers: TIERED, actions: ["quick"], medium: "none" },
  swimming: { way: "swim", tiers: BOOSTED, actions: BOTH, medium: "water" },
  swinging: { way: "swing", tiers: BOOSTED, actions: BOTH, medium: "air", assumed: true },
};

/* The profile of one way of moving.
     mode   a key of MOVE_MODES, or "vehicle"
     opts.tier     "basic" (default) | "major" | "massive" | "monstrous" for the tiered powers; "basic" | "fast" for swimming and swinging
                   (Fast Swimmer book 2022, Fast Swinging book 2030)
     opts.speed, opts.aerial   for "vehicle": its Speed in zones per quick action (book 2941, 3146) and whether it flies
   -> MoveProfile { mode, way, zones, stressZones (null = no stress option), stress: 1, actions, medium, assumed, ends? } */
export function moveProfile(mode, opts = {}) {
  if (mode === "vehicle") {
    if (!(opts.speed >= 0)) throw new Error("moveProfile: a vehicle needs its Speed");
    return { mode, way: opts.aerial ? "air" : "walk", zones: opts.speed, stressZones: null, stress: 1, actions: ["quick"], medium: opts.aerial ? "air" : "ground", assumed: false };
  }
  const m = MOVE_MODES[mode];
  if (!m) throw new Error(`moveProfile: unknown way of moving "${mode}"`);
  const tier = opts.tier ?? "basic", t = m.tiers[tier];
  if (!t) throw new Error(`moveProfile: "${mode}" has no tier "${tier}"`);
  const p = { mode, way: m.way, zones: t[0], stressZones: t[1], stress: 1, actions: m.actions.slice(), medium: m.medium, assumed: !!m.assumed };
  if (m.ends) p.ends = m.ends.slice();
  if (m.vertical) p.vertical = true;
  return p;
}

/* Conditions that change the cost of movement. The caller says which hold for THIS move (the book does not say whether a zone's
   condition counts in the zone left, the zone entered or every zone passed: reading 18):
     crushedLeg   crit 8 (book 2745; crits.critState(...).groundMoveFullAction): ground movement is a full action
     afflicted    Affliction (book 1574): movement is a full action
     storm        Weather Control's storm (book 1841): all movement is a full action with a STRENGTH roll (its maker is unaffected:
                  do not pass the flag for the maker)
     highGravity  increased gravity (book 1704): no aerial movement; ground movement is a full action with a STRENGTH roll
   -> { full: [conditions that make this move a full action], roll: null | "strength", blocked: null | "noAerial",
        unsettled: [conditions whose answer rests on an assumed medium] } */
export function moveConditions(profile, cond = {}) {
  const full = [], unsettled = [];
  let roll = null, blocked = null;
  const ground = profile.medium === "ground", air = profile.medium === "air";
  const note = (c) => { if (profile.assumed) unsettled.push(c); };
  if (cond.crushedLeg) { if (ground) full.push("crushedLeg"); note("crushedLeg"); }
  if (cond.afflicted) full.push("afflicted");
  if (cond.storm) { full.push("storm"); roll = "strength"; }
  if (cond.highGravity) {
    if (air) blocked = "noAerial";
    else if (ground) { full.push("highGravity"); roll = "strength"; }
    note("highGravity");
  }
  return { full, roll, blocked, unsettled };
}

/* Price ONE move action.
     distance   zones to cross: the `total` of a route (borders + levels); 0 = inside the zone; null / Infinity = no route
     profile    moveProfile(...)
     opts.conditions   see moveConditions
     opts.resolve      current Resolve; at 0 the stress option is closed (book 2816). Omitted = not checked.
     opts.quickOnly    what a "movement becomes a full action" condition does to a way that is a quick action only by its own text
                       (Teleportation, ruling 18): "full" (default: the condition wins, the move costs a full action) | "blocked"
                       (the move cannot be made). The book has no line for the clash: reading 19.
   -> { ok, reason, gmMayAllow?, options: [{ action: "none"|"quick"|"full", stress: 0|1, zones }], roll, full, unsettled, onTurnOnly }
      reasons: "noRoute", "noAerial" (book 1704), "tooFar" (beyond one action; see movesNeeded), "stressedOut" (only the stress
      option would reach and Resolve is 0, book 2816), "quickOnly" (opts.quickOnly "blocked").
   Moving inside a zone costs no action but only on the mover's own turn (book 2383): options [{ action: "none" }], onTurnOnly true.
   Moving to or from an off-map area is not a route: zones.mjs altitudeChangeCost prices it (book 2387-2388). */
export function moveCost(distance, profile, opts = {}) {
  const c = moveConditions(profile, opts.conditions);
  const base = { roll: c.roll, full: c.full, unsettled: c.unsettled, onTurnOnly: false };
  const no = (reason, extra = {}) => ({ ok: false, reason, options: [], ...base, ...extra });
  if (distance == null || !Number.isFinite(distance) || distance < 0) return no("noRoute");
  if (distance === 0) return { ok: true, reason: null, options: [{ action: "none", stress: 0, zones: 0 }], ...base, roll: null, full: [], onTurnOnly: true };
  if (c.blocked) return no(c.blocked, { gmMayAllow: c.unsettled.length > 0 });
  let actions = profile.actions;
  if (c.full.length) {
    if (!actions.includes("full") && profile.mode === "teleportation" && opts.quickOnly === "blocked") return no("quickOnly", { gmMayAllow: true });
    actions = ["full"];
  }
  const options = [];
  if (distance <= profile.zones) for (const action of actions) options.push({ action, stress: 0, zones: profile.zones });
  // the stress option is listed only where the plain move does not reach
  const stressReach = !options.length && profile.stressZones != null && distance <= profile.stressZones;
  const mayStress = opts.resolve === undefined || opts.resolve > 0;
  if (stressReach && mayStress) for (const action of actions) options.push({ action, stress: profile.stress, zones: profile.stressZones });
  if (!options.length) return no(stressReach ? "stressedOut" : "tooFar");
  return { ok: true, reason: null, options, ...base };
}

/* How many move actions a distance takes: { plain, stressed } (stressed = every move pays the stress; null without a stress option).
   book 2383, 3146: a move can be made twice a round (two quick actions); how many the mover has left is the action economy's. */
export function movesNeeded(distance, profile) {
  if (distance == null || !Number.isFinite(distance)) return { plain: null, stressed: null };
  const n = (z) => (z > 0 ? Math.ceil(distance / z) : distance === 0 ? 0 : null);
  return { plain: n(profile.zones), stressed: profile.stressZones != null ? n(profile.stressZones) : null };
}

/* The farthest one move action reaches: { plain, stressed } in zones (for highlighting reachable zones). */
export function moveReach(profile, opts = {}) {
  const c = moveConditions(profile, opts.conditions);
  if (c.blocked) return { plain: 0, stressed: 0 };
  const mayStress = opts.resolve === undefined || opts.resolve > 0;
  return { plain: profile.zones, stressed: profile.stressZones != null && mayStress ? profile.stressZones : profile.zones };
}

/* May this way of moving change altitude to `to` ("elevated" | "sky" | "orbit")? book 2385-2388 puts every change of altitude under
   aerial movement ("some powers and vehicles allow aerial movement"); 2007, 2013: leaping and super-speed end on the ground or a
   rooftop; 1922: Elongated Stride moves vertically along walls.
   Reading 29: sky high and orbit are open to ways that may END in the air (flight, wings, an aerial vehicle); every other way is
   refused with gmMayAllow (the book names no list). Elevated is open to every aerial way and to a way marked `vertical`; a walker
   reaches a rooftop only by a route through the building (the zones API's route), which is not this function's question.
   -> { ok, reason: null | "needsFlight" | "needsAerial", gmMayAllow? } */
export function altitudeAccess(profile, to) {
  const hovers = profile.medium === "air" && (profile.mode === "vehicle" || (profile.ends ?? []).includes("air"));
  if (to === "sky" || to === "orbit") return hovers ? { ok: true, reason: null } : { ok: false, reason: "needsFlight", gmMayAllow: true };
  if (to === "elevated") return profile.way === "air" || profile.way === "swing" || profile.way === "through" || profile.vertical ? { ok: true, reason: null } : { ok: false, reason: "needsAerial", gmMayAllow: true };
  return { ok: true, reason: null };
}
/* book 2004 Gliding (a limit of Flight): no zone at a higher altitude than where the move started. Heights as numbers
   (ground 0, elevated 1, sky 2, orbit 3; a floor its number). The limit's other half (at least one quick action of movement per
   turn until landing) is a fact of the turn, asked of the action ledger by the caller. -> { ok, reason } */
export const ALTITUDE_HEIGHT = { underground: -1, ground: 0, elevated: 1, sky: 2, orbit: 3 };
export function glidingCheck(fromHeight, toHeight) {
  return toHeight > fromHeight ? { ok: false, reason: "glidingUp" } : { ok: true, reason: null };
}
/* book 2038 Teleport Allies: one willing person in the teleporter's zone comes along; up to three more for one stress each.
   others = how many come along. -> { ok, reason, stress } */
export function teleportAllies(others) {
  const n = Math.max(0, Math.trunc(others));
  if (n > 4) return { ok: false, reason: "tooMany", stress: 0 };
  return { ok: true, reason: null, stress: Math.max(0, n - 1) };
}
