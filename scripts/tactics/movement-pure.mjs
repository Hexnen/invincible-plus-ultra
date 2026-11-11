/* Tactical combat, package P3: MOVEMENT, the pure half (spec 7, 9.6; the zones contract: moinen-maps dev/zones-api.md). NO Foundry globals.
   Everything here is a question to the rules library (scripts/rules: movement, zones, crits, maneuvers) asked with the numbers the map
   gave; no rule number lives in this file. Three users:
     flows/move.mjs      the executor's flows (price a declared move, resolve what stops it)
     movement.mjs        the Foundry side (the listener the map asks before every step, the options a client shows)
     desk-pure.mjs       the option lists of the player bar
   ZONE FACTS `Z` (built by movement.mjs over zones-adapter.mjs; scripted in check-move.mjs). All of them are live reads of the map:
     Z.place(cid) -> place | null                     Z.placeOf(where) -> place | null          (zones-api.md section 2)
     Z.plan(cid, where, apiProfile) -> plan | null    Z.along(cid, keys, { profile, end, forced }) -> plan | null
     Z.chain(cid, { awayFrom, toward, distance }) -> plan | null      awayFrom / toward: a combatant id or a spot
     Z.reach(cid, apiProfile, max) -> [{ zone, d, cost }]             Z.within(where, n) -> [{ zone, d }]
     Z.zone(where) -> zone | null      Z.states(spot) -> [state] of that level (and those naming none; Z.statesAll(key): every level)     Z.border(borderKey) -> border | null      Z.at(spot) -> [cid] on that level
     Z.borders(zoneKey) -> [border]                   (every border of a zone, for the doors a mover stands at)
   A MOVE PLAN as the flows keep it (slim: the state is a document flag):
     { kind: "route" | "inZone" | "area" | "return", mode, way, from, to, end: { level, floor, airborne } | { area }, total, zones: [key],
       steps: [{ k, to, b?, x?, o? }], cost: "quick" | "full" | "free" | "none" | "gm", later?: cost paid after the GM's word, stress,
       barriers: [{ border, element, armor }], roll: null | attr, carry: [cid], pulled: [cid], notes: [id], profile: apiProfile } */
import { movement, zones, crits, maneuvers } from "../rules/index.mjs";
import * as M from "./mods-pure.mjs";
import * as P1 from "./economy-pure.mjs";

/* the name the zones API's profile takes for each way of moving (zones-api.md section 14 `way`; spec 7.4 mapping [D]).
   [ZR-3]: leaping and super-speed are the map's "leap" / "superspeed" (over exterior walls, must land). Elongated Stride climbs walls
   [B1922]: the map has no such way, so it is sent as "leap" (over an exterior wall, lands) - a reading, listed in the questions.
   A vehicle has no entry: its way is the rules library's (an aircraft or a spacecraft flies [B3247], [B2385]; a ground or a water
   vehicle takes the ground route), so `apiProfile` reads `profile.way`. */
export const API_WAY = Object.freeze({ walk: "walk", grown: "walk", earthDrift: "walk", iceSlide: "walk", elongatedStride: "leap", adhesion: "leap", burrowing: "burrow", flight: "flight", wings: "flight",
  leaping: "leap", superSpeed: "superspeed", teleportation: "teleport", swimming: "swim", swinging: "swing" });
export const BOOSTS = Object.freeze(["tunneling", "teleportAllies", "portal", "untouchableSpeed", "quickTeleport"]);
export const LIMITS = Object.freeze(["gliding", "brachiation"]);
export const canHover = (profile) => Array.isArray(profile?.ends) && profile.ends.includes("air");
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const no = (reason, params = {}, gmMayAllow = false) => ({ ok: false, reason, params, ...(gmMayAllow ? { gmMayAllow: true } : {}) });

/* ------------------------------------------------------------------ who moves how */
/** The ways of moving a combatant has: on foot always [B2383], grown [B1975], and every movement power the system adapter found
    (c.movement = [{ mode, tier?, boosts?, limits?, speed?, aerial?, name? }]). -> [{ id, mode, tier, boosts, limits, profile }] */
export function modesOf(c) {
  const out = [], add = (m) => {
    try {
      const profile = m.mode === "vehicle" ? movement.moveProfile("vehicle", { speed: m.speed, aerial: m.aerial === true }) : movement.moveProfile(m.mode, { tier: m.tier ?? "basic" });
      if (!out.some((x) => x.id === m.mode)) out.push({ id: m.mode, mode: m.mode, tier: m.tier ?? "basic", boosts: Array.isArray(m.boosts) ? m.boosts : [], limits: Array.isArray(m.limits) ? m.limits : [], name: m.name ?? null, profile });
    } catch { /* a way the rules library does not know is not offered */ }
  };
  if (c?.kind !== "vehicle") add({ mode: "walk" });
  if (c?.grown) add({ mode: "grown" });
  for (const m of Array.isArray(c?.movement) ? c.movement : []) if (isObj(m) && typeof m.mode === "string") add(m);
  return out;
}
export const modeOf = (c, id) => { const list = modesOf(c); return (id ? list.find((m) => m.id === id) : null) ?? null; };
/** the profile the zones API takes (zones-api.md section 14). `zones`: how far ONE action goes (the stress option's reach when taken). */
export function apiProfile(profile, { zones: z = null, stress = false, force = false, hover = undefined } = {}) {
  const speed = Math.max(1, z ?? (stress && profile.stressZones ? profile.stressZones : profile.zones));
  const p = { way: API_WAY[profile.mode] ?? (profile.way === "air" ? "flight" : profile.way), speed, actions: 1, force: !!force };
  p.hover = hover !== undefined ? hover : canHover(profile);                           // [ZR-3]: only a way of moving that may end in the air hovers
  return p;
}

/* ------------------------------------------------------------------ zone states as the rules read them */
const ownerOf = (s) => (typeof s?.owner === "string" ? s.owner : s?.owner?.owner ?? s?.owner?.combatant ?? s?.owner?.id ?? null);
const spared = (s, cid) => Array.isArray(s?.except) && s.except.includes(cid);
/** What the states of one spot mean for `cid`. A maker is never touched by its own darkness [B1654] or storm [B1841]; gravity names no
    such exemption [B1702-1704]; `except` is the registry's list (zones-api.md section 10). -> { fire, dark, storm, highGravity, lowGravity } */
export function stateFlags(states, cid) {
  const f = { fire: 0, dark: false, storm: false, highGravity: false, lowGravity: false };
  for (const s of Array.isArray(states) ? states : []) {
    if (!s || spared(s, cid)) continue;
    const own = ownerOf(s) === cid && cid != null;
    if (s.kind === "fire") f.fire = Math.max(f.fire, Math.trunc(Number(s.level) || 0));                       // [B2925] Intensity
    else if (s.kind === "dark" && !own) f.dark = true;                                                        // [B1654]
    else if (s.kind === "weather" && s.data?.type === "storm" && !own) f.storm = true;                        // [B1841]
    else if (s.kind === "gravity") { if (s.data?.mode === "high") f.highGravity = true; else if (s.data?.mode === "low") f.lowGravity = true; }   // [B1703], [B1704]
  }
  return f;
}
/** The conditions of rules/movement.mjs for a move that STARTS here [LR-18]: the zone left decides (the cost is paid at the declaration). */
export function conditionsOf(state, cid, c, states) {
  const f = stateFlags(states, cid);
  return { crushedLeg: !!crits.critState(c?.crits ?? []).groundMoveFullAction,                                // [B2745]
    afflicted: M.hasStatus(state, cid, "afflicted"), storm: f.storm, highGravity: f.highGravity };            // [B1574], [B1841], [B1704]
}
/** Why a combatant cannot move at all (null: it can). held [B2496], snared and immobilised [R21] [OQ-2], trapped [R20], broken [B2707]. */
export function cannotMove(state, cid, c) {
  if (!c || c.present === false) return "gone";
  if (c.health <= 0) return "broken";
  const k = M.conditions(state, cid);
  return k.held ? "held" : k.snared ? "snared" : k.trapped ? "trapped" : null;
}
const altOf = (p) => p?.area ?? p?.level ?? "ground";
const heightOf = (p) => (p?.level === "floor" ? p.floor : movement.ALTITUDE_HEIGHT[altOf(p)] ?? 0);
const whereOf = (p, airborne) => (p.area ? { area: p.area } : { zone: p.zone, level: p.level, floor: p.floor, airborne: p.level === "elevated" ? !!airborne : false });
const slimSteps = (plan) => (plan?.steps ?? []).map((s) => ({ k: s.kind, to: s.to, ...(s.border?.key ? { b: s.border.key } : {}), ...(s.border?.blocked ? { x: 1 } : {}), ...(s.border?.over ? { o: 1 } : {}) }));
/** the element a crash goes through and its Armor: the door where one stands in the wall, else the wall [B2419]; the mover may name the other */
export function barrierOf(border, want = null) {
  const door = border?.doorway && ["locked", "sealed", "closed"].includes(border.doorway.state) ? border.doorway : null, wall = border?.wall ?? null;
  const element = want === "wall" || !door ? "wall" : "door";
  return { border: border?.key ?? null, element, armor: Number((element === "door" ? door : wall)?.armor ?? border?.armor ?? 0) };
}

/* ------------------------------------------------------------------ pricing one move (spec 9.6 steps 1-2) */
/** Price and check ONE move of `cid`. decl = { to: spot, airborne?, mode?, stress?, pay?: "quick" | "full", force?: true | { [borderKey]: "door" | "wall" },
    carry?: [cid] }. o = { free: n (a move that costs nothing and goes at most n zones: the dodge move [B2526]), prepaid (paid by a reaction),
    mode (the entry fixes the way), onTurn, resolve }.
    -> a move plan (see the header) with ok:true, or { ok:false, reason, params, gmMayAllow? }. */
export function priceMove(Z, state, cid, c, decl, o = {}) {
  const stuck = cannotMove(state, cid, c);
  if (stuck) return no(stuck);
  const from = Z?.place?.(cid);
  if (!from) return no("noPlace", {}, true);                                         // spec 7: no place on the open scene, the GM resolves by hand
  const want = typeof decl?.to === "string" ? Z.placeOf(decl.to) : null;
  if (!want) return no("noZone");
  const to = whereOf(want, decl.airborne === true || (decl.airborne !== false && want.airborne === true));
  const m = modeOf(c, o.mode ?? decl.mode ?? "walk");
  if (!m) return no("noMode");
  const P = m.profile, notes = [], base = { ok: true, mode: m.id, way: P.way, from: from.spot, to: want.spot, end: to, stress: 0, barriers: [], roll: null, carry: [], pulled: [], notes, zones: [], steps: [], total: 0 };
  const free = Number.isFinite(o.free) || o.prepaid === true;
  /* off the map: one full action to or from sky high or orbit [B2387-2388]; the areas of the plan are the GM's word [LR-21]; the return is
     the player's choice of zone with the GM's approval [R16] */
  if (from.area || want.area) {
    if (from.area && from.area === want.area) return { ...base, kind: "inZone", cost: free ? "none" : "free" };
    const cost = zones.altitudeChangeCost(altOf(from), altOf(want));
    for (const a of [from.area, want.area]) if (a === "sky" || a === "orbit") { const acc = movement.altitudeAccess(P, a); if (!acc.ok) return no(acc.reason, { area: a }, true); }   // [LR-29]
    if (m.limits.includes("gliding") && !movement.glidingCheck(heightOf(from), heightOf(want)).ok) return no("glidingUp");                // [B2004]
    if (want.area === "orbit") notes.push("vacuum");                                  // [B2260]: life support is the hazard flow's and the GM's
    const kind = from.area && !want.area ? "return" : "area";
    return { ...base, kind, cost: "none", later: free ? "none" : cost, gm: kind === "return" || cost === "gm" ? 1 : 0, profile: null };
  }
  if (to.airborne && !canHover(P)) { const acc = movement.altitudeAccess(P, "elevated"); return no(acc.ok ? "needsFlight" : acc.reason, {}, true); }   // [B2385], [LR-29]: in the air only who can stay there
  if (from.spot === want.spot) return { ...base, kind: "inZone", cost: free ? "none" : "free", airborne: to.airborne };              // [L6] [B2383]
  /* a route of the map, priced by the rules library */
  const conds = conditionsOf(state, cid, c, Z.states(from.spot));
  const reach = movement.moveReach(P, { conditions: conds, resolve: o.resolve ?? c.resolve });
  const cap = Number.isFinite(o.free) ? Math.max(0, o.free) : Math.max(reach.plain, reach.stressed, 1);
  const force = !!decl.force && P.way !== "through";
  const prof = apiProfile(P, { zones: Math.max(1, cap), force });
  let plan = Z.plan(cid, to, prof);
  if (!plan) {
    const forced = P.way !== "through" && !force ? Z.plan(cid, to, { ...prof, force: true }) : null;
    return forced ? no("barrier", { barriers: (forced.steps ?? []).filter((s) => s.border?.blocked).map((s) => barrierOf(s.border).border) }, true) : no("noRoute", {}, true);
  }
  let cost = "none", stress = 0;
  if (Number.isFinite(o.free)) { if (plan.total > o.free) return no("tooFar", { total: plan.total, max: o.free }); }
  else {
    const pc = movement.moveCost(plan.total, P, { conditions: conds, resolve: o.resolve ?? c.resolve });      // [B2383], [B1999-2037], [R18]
    if (!pc.ok) return no(pc.reason, { total: plan.total, full: pc.full }, !!pc.gmMayAllow);
    const opts = pc.options.filter((x) => (decl.stress ? true : x.stress === 0));
    if (!opts.length) return no("needsStress", { total: plan.total });
    const pick = opts.find((x) => x.action === decl.pay) ?? opts.find((x) => x.action === (o.payable ?? "quick")) ?? opts[0];
    cost = o.prepaid ? "none" : pick.action; stress = pick.stress;
    base.roll = pc.roll;                                                              // [B1841], [B1704]: the STRENGTH roll of a storm or high gravity
    if (pc.unsettled.length) notes.push("unsettledMedium");                           // [LR-17]
    if (pc.full.length) base.full = pc.full;
  }
  if (!base.roll && stateFlags(Z.states(from.spot), cid).lowGravity) base.roll = "agility";                    // [B1703]
  if (m.limits.includes("gliding") && !movement.glidingCheck(heightOf(from), heightOf(want)).ok) return no("glidingUp");               // [B2004]
  const steps = slimSteps(plan), barriers = [];
  for (const s of plan.steps ?? []) {
    if (!s.border?.blocked) continue;
    const b = barrierOf(s.border, isObj(decl.force) ? decl.force[s.border.key] : null);
    if (!zones.canBreach(c.attrs?.strength ?? 0, b.armor)) return no("tooWeak", { border: b.border, armor: b.armor }, true);          // [Z7] [B2418-2419]
    barriers.push(b);
  }
  if (steps.some((s) => s.o)) notes.push("overWall");                                // [OQ-14]
  /* who goes along */
  const beside = (x) => (typeof x === "string" && Z.place(x)?.spot === from.spot ? x : null);       // a link to somebody who is somewhere else is over (flows/kit.separated ends it when this move arrives)
  const held = beside(M.statusesOf(state, cid).find((s) => s.id === "grappling")?.data?.held);
  const pulled = held ? [held] : [];                                                  // [B2497]: the held opponent is pulled along
  const aloft = beside(M.statusesOf(state, cid).find((s) => s.id === "carrying")?.data?.held);      // still carrying from an earlier move: the carried one goes along [B2392]
  const carry = [...new Set([...(Array.isArray(decl.carry) ? decl.carry : []), ...(aloft ? [aloft] : [])].filter((x) => typeof x === "string" && x !== cid))];
  if (carry.length) {
    for (const x of carry) if (Z.place(x)?.spot !== from.spot) return no("carryZone", { who: x });           // [B2392], [B2038]: from the mover's own zone
    if (m.mode === "teleportation" && m.boosts.includes("teleportAllies")) {
      const ta = movement.teleportAllies(carry.length);                              // [B2038]
      if (!ta.ok) return no(ta.reason);
      stress += ta.stress;
    } else {
      const cc = maneuvers.carryCheck({ canFly: P.medium === "air" && (P.ends ?? []).includes("air"), alreadyCarrying: carry.length > 1, sameZone: true, charging: o.charging === true });   // [B2392]
      if (!cc.ok) return no(cc.reason === "cannotFly" ? "cannotCarry" : cc.reason);
    }
  }
  if (stress > 0 && !((o.resolve ?? c.resolve) > 0)) return no("stressedOut");       // [B2816]
  return { ...base, kind: "route", cost, stress, total: plan.total, zones: (plan.zones ?? []).slice(), steps, barriers, carry, pulled, profile: prof, teleport: P.mode === "teleportation" ? 1 : 0 };
}

/** The approach of a charge [B2490]: one move to the target's spot, paid with the quick action; nobody is carried. -> the move plan of priceMove plus
    `allowance` (how far that one move could have gone: what is left of it feeds the Slam stunt [B2494]), or { ok:false, reason, params, gmMayAllow? }. */
export function chargePlan(Z, state, cid, c, decl, to) {
  const one = (mode) => {
    const pr = priceMove(Z, state, cid, c, { to, mode, stress: decl?.stress, pay: "quick", force: decl?.force }, { charging: true });
    if (!pr.ok) return pr;
    if (pr.kind !== "route") return no("chargeSameZone");
    if (pr.cost !== "quick") return no("tooFar", { total: pr.total });               // more than one move's worth
    const m = modeOf(c, pr.mode), from = Z.place(cid);
    const reach = movement.moveReach(m.profile, { conditions: conditionsOf(state, cid, c, Z.states(from.spot)), resolve: c.resolve });
    return { ...pr, allowance: pr.stress > 0 ? reach.stressed : reach.plain };
  };
  if (decl?.mode) return one(decl.mode);
  /* no way of moving named: the one that gets there and leaves the most movement after the point of attack (what Slam uses) */
  const tries = modesOf(c).map((m) => one(m.id)), good = tries.filter((x) => x.ok).sort((a, b) => (b.allowance - b.total) - (a.allowance - a.total));
  return good[0] ?? tries[0] ?? no("noMode");
}

/* ------------------------------------------------------------------ the options a mover is shown (spec 9.6 step 1) */
/** Every zone one action reaches, per way of moving, with its price and what stands in the way.
    canPay(cost) -> { ok, reason } is the action economy's answer for this combatant now. o = { free, mode, max }.
    -> [{ id, to, zone, mode, d, cost, stress, disabled, gmMayAllow?, unpaid?, barriers, elevated?, here?, area? }] nearest first.
       `unpaid`: the move itself is fine and only the action economy refuses it (no action left, not the mover's turn). */
export function moveOptions(Z, state, cid, c, canPay = null, o = {}) {
  canPay ??= (cost) => P1.canPay(state, cid, cost, { resolve: c?.resolve });                                         // [L1]-[L4]: the action economy's answer
  const out = [], from = Z?.place?.(cid);
  if (!from || cannotMove(state, cid, c)) return out;
  const modes = modesOf(c).filter((m) => !o.mode || m.id === o.mode);
  const push = (m, to, d, zone, extra = {}) => {
    const pr = priceMove(Z, state, cid, c, { to, mode: m.id, stress: 1, force: extra.force }, o);
    const cost = pr.ok ? (pr.later ?? pr.cost) : null, pay = pr.ok && (cost === "quick" || cost === "full") ? canPay(cost) : { ok: true };
    out.push({ id: `${m.id}|${to}`, to, zone, mode: m.id, d, cost, stress: pr.ok ? pr.stress : 0, disabled: !pr.ok ? pr.reason : pay.ok ? null : pay.reason ?? "noAction",
      ...(pr.ok ? (pay.ok ? {} : { unpaid: 1 }) : pr.gmMayAllow ? { gmMayAllow: true } : {}), barriers: pr.ok ? pr.barriers : pr.params?.barriers ?? [], ...(pr.ok && pr.gm ? { gm: 1 } : {}), ...(pr.ok && pr.zones?.length ? { route: pr.zones.slice() } : {}), ...(pr.ok && pr.steps?.length ? { enters: [...new Set(pr.steps.map((s) => s.to).filter((x) => typeof x === "string"))] } : {}), ...extra });      // W1 (U32): `route` = the zones this way enters, for the preview on the map
  };
  for (const m of modes) {
    if (from.area) { continue; }
    const conds = conditionsOf(state, cid, c, Z.states(from.spot)), r = movement.moveReach(m.profile, { conditions: conds, resolve: c.resolve });
    const max = Number.isFinite(o.free) ? o.free : Math.max(r.plain, r.stressed);
    const seen = new Set();
    for (const force of m.profile.way === "through" ? [false] : [false, true]) {
      for (const row of Z.reach(cid, apiProfile(m.profile, { zones: Math.max(1, max), force }), o.max ?? max)) {
        if (row.d === 0 || seen.has(row.zone)) continue;
        seen.add(row.zone);
        push(m, row.zone, row.d, row.zone, force ? { force: true } : {});
        const z = m.profile.way === "air" || m.profile.way === "swing" || m.profile.vertical ? Z.zone(row.zone) : null;
        if (z && (z.rooftop || (m.profile.ends ?? []).includes("air"))) push(m, `${row.zone}:elevated`, row.d, row.zone, { elevated: z.rooftop ? "roof" : "air", ...(force ? { force: true } : {}) });   // [B2385-2386], [B2396]
      }
    }
    if (from.zone) {                                                                  // a change of level inside the zone [B2386]
      const z = Z.zone(from.zone), up = `${from.zone}:elevated`;
      if (from.level !== "elevated" && movement.altitudeAccess(m.profile, "elevated").ok && (z?.rooftop || (m.profile.ends ?? []).includes("air"))) push(m, up, 0, from.zone, { here: 1, elevated: z?.rooftop ? "roof" : "air" });
      if (from.level !== "ground" && m.profile.way !== "walk") push(m, from.zone, 0, from.zone, { here: 1 });
    }
    if (!Number.isFinite(o.free)) for (const a of ["sky", "orbit"]) if (movement.altitudeAccess(m.profile, a).ok) push(m, `@${a}`, null, null, { area: a });   // [B2387-2388]
  }
  return out.sort((a, b) => (a.d ?? 99) - (b.d ?? 99));
}
/** The ways of `cid` to ONE named place, each priced like a row of moveOptions [D21]: a level the list above does not offer by itself
    (a floor, underground, a way down for somebody on foot) still has a price when the map's token HUD asks for it. */
export function optionsTo(Z, state, cid, c, to, canPay = null) {
  canPay ??= (cost) => P1.canPay(state, cid, cost, { resolve: c?.resolve });
  const from = Z?.place?.(cid), want = typeof to === "string" ? Z?.placeOf?.(to) : null;
  if (!from || !want) return [];
  return modesOf(c).map((m) => {
    const pr = priceMove(Z, state, cid, c, { to, mode: m.id, stress: 1 });
    const cost = pr.ok ? (pr.later ?? pr.cost) : null, pay = pr.ok && (cost === "quick" || cost === "full") ? canPay(cost) : { ok: true };
    return { id: `${m.id}|${to}`, to, zone: want.zone ?? null, mode: m.id, d: pr.ok ? pr.total ?? 0 : null, cost, stress: pr.ok ? pr.stress : 0, disabled: !pr.ok ? pr.reason : pay.ok ? null : pay.reason ?? "noAction",
      ...(pr.ok ? (pay.ok ? {} : { unpaid: 1 }) : pr.gmMayAllow ? { gmMayAllow: true } : {}), barriers: pr.ok ? pr.barriers : pr.params?.barriers ?? [], ...(pr.ok && pr.gm ? { gm: 1 } : {}),
      ...(want.area ? { area: want.area } : want.zone === from.zone ? { here: 1 } : {}) };
  });
}

/* ------------------------------------------------------------------ what the map's step listener answers (zones-api.md section 14 `beforeStep`)
   The engine moves a token with ONE map call per stretch and the map asks before every step. A roll or a card cannot be answered
   inside that call (the executor runs one request at a time), so the listener only says STOP and names the reason; the flow settles
   it and sends the rest of the route as the next stretch. `md` is what the flow handed to the move (ctx.data.ipu):
     { inst, mover, cleared: { [gateKey]: 1 }, force?, forced?, trig?: [zone key or spot with a zone-enter trigger], cond? } */
const stopWayOf = (way) => (way === "swim" || way === "range" ? "walk" : way === "swing" ? "air" : way ?? "walk");
/** Does entering this spot ask for something? fire [B2925]; a trigger waiting on the zone (a ward [B2876], a challenge effect [B2845]);
    a storm or high gravity met on the way [LR-18]. */
export function enterNeeds(states, md, place) {
  const f = stateFlags(states, md?.mover);
  if (f.fire > 0) return true;
  if ((md?.trig ?? []).some((z) => z === place?.zone || z === place?.spot)) return true;
  return !!md?.cond && (f.storm || f.highGravity);
}
/** -> null (go on) | { stop: true, reason: "ipu.enter" | "ipu.dark" | "ipu.barrier" | "ipu.hit" | "ipu.slab", data } */
export function stepVerdict(ctx) {
  const md = ctx?.data?.ipu;
  if (!isObj(md)) return null;                                                        // not a move of the engine
  const cl = md.cleared ?? {}, from = ctx.from?.spot ?? ctx.step?.from, stop = (reason, data) => ({ stop: true, reason, data });
  if (from && !cl[`enter:${from}`] && enterNeeds(ctx.statesFrom, md, ctx.from)) return stop("ipu.enter", { spot: from });
  if (!md.forced && from && !cl[`dark:${from}`] && stateFlags(ctx.statesFrom, md.mover).dark && !stateFlags(ctx.statesTo, md.mover).dark) return stop("ipu.dark", { spot: from });   // [B1654]
  const slab = ctx.step?.slab;                                                        // thrown up or down through a building: a floor or the roof is in the way (zones-api.md section 14)
  if (md.forced && (slab === "floor" || slab === "roof") && from && !cl[`slab:${from}`]) return stop("ipu.slab", { spot: from, slab });
  const b = ctx.border;
  if (b && b.stops?.[stopWayOf(ctx.profile?.way)]) {
    if (md.forced) return stop("ipu.hit", { border: b.key });                         // [B2435], [B2494]
    if (md.force && !cl[`bar:${b.key}`]) return stop("ipu.barrier", { border: b.key });   // [B2419]
  }
  return null;
}

/* ------------------------------------------------------------------ communication range, as a query for other flows (spec 7.2 Z11) */
/** Can a talk to b? range = the map's range(a, b); border = the border between two neighbouring zones (null otherwise).
    [B2381], [LR-2], [LR-3]: decided by rules/zones.canCommunicateAt; a wall impedes unless its door stands open [A27]. */
export function canTalk(range, placeA, placeB, border = null, link = false) {
  const impeded = !!border && border.kind !== "open" && !(border.doorway && ["open", "breached"].includes(border.doorway.state));
  return zones.canCommunicateAt(range ?? null, placeA ?? {}, placeB ?? {}, { link, impeded });
}
