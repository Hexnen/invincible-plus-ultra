/* Tactical combat, package P7: CHASES (spec 9.10; rules: scripts/rules/chase.mjs). NO Foundry globals.
   A chase has no map: only the distance in zones between two sides is tracked [B3412]. While it runs, state.kind is "chase", nobody
   holds a card (the round still turns: ledgers are new, the challenge clock runs, round-point triggers are asked) and the tokens stand
   in the map's off-map place `@chase`.
     state.chase = { sides: { prey: [unit], pursuer: [unit] }, mode: "sides", distance, lostAt, round (chase rounds played), rolled (the
                     state round whose chase roll is done), obstacles: 0 | 1, last: { prey, pursuer, winner, obstacle, caught, escaped },
                     over?: reason, back: { [unit]: spot }, crew: { round, ids } }
     a unit is a combatant on foot or a vehicle (the people aboard belong to it)
   chaseRound (flow `round`), one per round [B3432-3442]: the obstacle when used (D66, its rolls prey first, no actions) -> the opposed
   movement roll, both sides active, the prey rolls and pushes first [R25] -> the distance -> at 0 the pursuer's charge or ram that
   cannot be blocked [B3434] -> one ranged attack for everyone aboard who does not drive (a grant in the ledger; the pursuing side is
   named first), the driver too when the vehicle carries a weapon.
   With several on a side the slowest rolls, the lowest AGILITY on a tie [B3479]. Starting, changing and ending a chase are GM edits
   (engine-pure.mjs: chaseStart, chaseSet, chaseEnd): `startPlan` / `endPlan` say what they write.
   CHASE2 GROUPS (OURS, not the book's; rulings CHASE2-G1..G9 in dev/combat-rulings.md): the pursuers may run in several groups, each at
   its own distance from the prey, after the book's "more complex way" [B3480] (each 6 moves a participant 1 zone forward relative to
   everyone) read for groups: the prey's one roll counts against every group, each group's slowest rolls for it [B3479].
     state.chase.groups = [{ id: "g1", units: [unit], distance, lost?: "far" | "hiddenPath" }]   (pursuers only; absent = one group, the
                          plain chase, which plays exactly as before); state.chase.distance = the nearest group's distance */
import { chase } from "../../rules/index.mjs";
import * as Lg from "../ledger-pure.mjs";
import * as P1 from "../economy-pure.mjs";
import * as MP from "../movement-pure.mjs";
import * as K from "./kit.mjs";
import { hazardChild } from "./move.mjs";
import { rideOf, vehOf, occupants, mountAgility } from "./vehicle.mjs";

const bad = (reason, params = {}) => ({ ok: false, reason, params });
const fine = { ok: true, reason: null, params: {}, gates: [], notes: [] };
const blank = { helpers: [], exploits: [], stressTotal: 0 };
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
export const SIDES = Object.freeze(["prey", "pursuer"]);
export const chaseOf = (state) => (state?.kind === "chase" && isObj(state.chase) ? state.chase : null);
const other = (side) => (side === "prey" ? "pursuer" : "prey");

/** CHASE2 groups (ours): the pursuers' groups, or null in the plain chase; a group still in the chase is one that has not lost the prey */
export const groupsOf = (ch) => (Array.isArray(ch?.groups) && ch.groups.length ? ch.groups : null);
export const activeGroups = (ch) => (groupsOf(ch) ?? []).filter((g) => !g.lost);
/** the group of a combatant (its own entry or the vehicle it rides), or null */
export function groupOf(state, cid) {
  const gs = groupsOf(chaseOf(state));
  if (!gs) return null;
  const unit = rideOf(state, cid)?.vehicle ?? cid;
  return gs.find((g) => g.units.includes(unit) || g.units.includes(cid)) ?? null;
}
/** the nearest distance of the groups still in the chase (the plain chase: its distance) */
export const nearestOf = (ch) => { const a = activeGroups(ch); return a.length ? Math.min(...a.map((g) => g.distance)) : Math.max(0, Number(ch?.distance) || 0); };
/** the side a combatant is on: its own entry, or the vehicle it rides */
export function sideOf(state, cid) {
  const ch = chaseOf(state);
  if (!ch) return null;
  const unit = rideOf(state, cid)?.vehicle ?? cid;
  return SIDES.find((s) => (ch.sides?.[s] ?? []).includes(unit) || (ch.sides?.[s] ?? []).includes(cid)) ?? null;
}
/** everyone of a side: the units and the people aboard their vehicles */
export const membersOf = (state, side) => [...new Set((chaseOf(state)?.sides?.[side] ?? []).flatMap((u) => [u, ...occupants(state, u)]))];
/** one unit as the chase roll reads it [B3432], [B3479]: who rolls, how fast it is, what the vehicle adds */
function unitFacts(v, id) {
  const c = v.facts.c(id);
  if (!c || c.present === false) return null;
  if (c.kind === "vehicle") {
    const rec = vehOf(v.state, id), d = rec.driver ? v.facts.c(rec.driver) : null;
    const mount = mountAgility(v, id);                                                           // Z16 [B3144]: a mount runs on the creature's AGILITY
    return d && !rec.wrecked && !rec.off?.engine ? { id, vehicle: 1, roller: rec.driver, speed: Number(c.vehicle?.speed) || 1, agility: mount ?? d.attrs?.agility ?? 0, maneuver: Number(c.vehicle?.maneuver) || 0, ...(mount != null ? { mount } : {}) } : null;
  }
  if (c.health <= 0) return null;
  const speed = Math.max(1, ...MP.modesOf(c).map((m) => Number(m.profile?.zones) || 1));
  return { id, roller: id, speed, agility: c.attrs?.agility ?? 0, maneuver: 0 };
}
/** the unit that rolls for a side: the slowest, the lowest AGILITY on a tie [B3479]. CHASE2: it also says WHY it is the one (the table
    is told who rolls and why, never the numbers): `why` "only" (nobody else on the side can move), "slowest" (the lowest speed),
    "agility" (a tie on speed, the lowest AGILITY), "tie" (both tie: the first of them, as the rules library sorts); `of` = how many of
    the side can move */
export function rollerOf(v, side, gid = null) {
  const ch = chaseOf(v.state), g = side === "pursuer" && gid ? (groupsOf(ch) ?? []).find((x) => x.id === gid) : null;
  const list = (g ? g.units : side === "pursuer" && groupsOf(ch) && !gid ? activeGroups(ch).flatMap((x) => x.units) : ch?.sides?.[side] ?? []).map((id) => unitFacts(v, id)).filter(Boolean);
  const pick = chase.chaseRoller(list.map((u) => ({ id: u.id, speed: u.speed, agility: u.agility })));
  if (!pick) return null;
  const u = list.find((x) => x.id === pick.id), same = list.filter((x) => x.speed === u.speed);
  const why = list.length === 1 ? "only" : same.length === 1 ? "slowest" : same.filter((x) => x.agility === u.agility).length === 1 ? "agility" : "tie";
  return { ...u, why, of: list.length };
}
/** CHASE2: why a unit of the chase cannot move (it then never rolls for its side), or null: "gone" (not on the scene), "down" (out of the
    fight), "wrecked", "engine" (the engine is out), "noDriver" (nobody at the wheel). Read from the full facts (the GM's). */
export function stuckOf(v, id) {
  const c = v.facts.c(id);
  if (!c || c.present === false) return "gone";
  if (c.kind === "vehicle") { const rec = vehOf(v.state, id); return rec.wrecked ? "wrecked" : rec.off?.engine ? "engine" : !rec.driver ? "noDriver" : null; }
  return c.health <= 0 ? "down" : null;
}

/* ------------------------------------------------------------------ the facts of a chase: distance instead of the map [B3412] */
/** Wrap the live facts: between the two sides the range is the chase distance, inside a side it is 0. `get` returns the state of now. */
export function facts(f, get) {
  const d = () => Math.max(0, Math.trunc(Number(chaseOf(get())?.distance) || 0));
  /* CHASE2 groups (ours, G6): everyone stands on one line; the prey at 0, a pursuing group at its distance behind it; the range between
     two is the difference (a group to the prey: its distance; two groups: the gap between them; inside a group or the prey: 0) */
  const at = (st, cid) => { const s = sideOf(st, cid); if (!s) return null; if (s === "prey") return 0; const g = groupOf(st, cid); return g ? g.distance : d(); };
  const r0 = (n) => ({ total: n, borders: n, levels: 0 });
  return {
    ...f,
    range: (a, b) => {
      const st = get(), sa = sideOf(st, a), sb = sideOf(st, b);
      if (!sa || !sb) return f.range(a, b);
      if (!groupsOf(chaseOf(st))) return sa === sb ? r0(0) : r0(d());
      return r0(Math.abs(at(st, a) - at(st, b)));
    },
    inZone: (cid) => {
      const st = get(), s = sideOf(st, cid);
      if (!s) return f.inZone(cid);
      if (!groupsOf(chaseOf(st))) return [...membersOf(st, s), ...(d() === 0 ? membersOf(st, other(s)) : [])].filter((x) => x !== cid);
      const me = at(st, cid);
      return [...membersOf(st, "prey"), ...membersOf(st, "pursuer")].filter((x) => x !== cid && at(st, x) === me);
    },
  };
}

/* ------------------------------------------------------------------ GM edits: start, change, end */
const ids = (v) => (Array.isArray(v) ? [...new Set(v.filter(P1.isId))].slice(0, 60) : []);
const num = (x, lo, hi, dflt) => (Number.isFinite(Number(x)) ? Math.max(lo, Math.min(hi, Math.trunc(Number(x)))) : dflt);
/** -> { ok, chase, puts: [{ who, group }] } | { ok:false, reason }. a = { prey, pursuer, distance, lostAt?, obstacles? } */
export function startPlan(state, f, a, lostAtDefault = chase.CHASE_END_DISTANCE) {
  if (state.kind === "chase") return bad("chaseOn");
  const unit = (id) => { const c = f.c(id); return c && c.kind !== "challenge" ? rideOf(state, id)?.vehicle ?? id : null; };
  const prey = [...new Set(ids(a.prey).map(unit).filter(Boolean))], pursuer = [...new Set(ids(a.pursuer).map(unit).filter(Boolean))].filter((u) => !prey.includes(u));
  if (!prey.length || !pursuer.length) return bad("chaseSides");
  const back = {};
  for (const u of [...prey, ...pursuer]) { const spot = f.zone?.(u)?.spot; if (typeof spot === "string" && !spot.startsWith("@")) back[u] = spot; }
  return { ok: true, chase: { sides: { prey, pursuer }, mode: "sides", distance: num(a.distance, 0, 99, 1), lostAt: num(a.lostAt, 1, 99, lostAtDefault), round: 0, rolled: null, obstacles: a.obstacles ? 1 : 0, back },
    puts: [...prey, ...pursuer].map((u) => ({ who: u, group: occupants(state, u) })) };
}
/** -> the patch of state.chase a `chaseSet` writes, or null.
    CHASE2 groups (ours, G7): `group` names a pursuing group: with `unit` the unit goes into it ("new": a group of its own, at `distance`
    or at the nearest distance), without `unit` the `distance` is that group's. A plain `distance` in a chase of groups is the nearest
    group's. A group left empty goes; one group left is the plain chase again (its distance is the chase's). Setting a lost group's
    distance back within reach puts it back in the chase (the GM's correction). */
export function setPatch(state, a) {
  const ch = chaseOf(state);
  if (!ch) return null;
  const next = { ...ch, sides: { prey: ch.sides.prey.slice(), pursuer: ch.sides.pursuer.slice() } };
  let groups = groupsOf(ch) ? ch.groups.map((g) => ({ ...g, units: g.units.slice() })) : null;
  const gid = typeof a.group === "string" ? a.group.slice(0, 12) : null;
  if (a.lostAt !== undefined) next.lostAt = num(a.lostAt, 1, 99, ch.lostAt);
  if (a.obstacles !== undefined) next.obstacles = a.obstacles ? 1 : 0;
  /* ANSD (CHASE2-9): the GM's exception to the crews' order of this round: the fleeing may shoot before every pursuer has */
  if (a.crewFree !== undefined) { if (!isObj(ch.crew) || ch.crew.round !== state.round) return null; next.crew = { ...ch.crew }; if (a.crewFree) next.crew.free = 1; else delete next.crew.free; }
  const nearest = () => (groups ? [...groups].filter((g) => !g.lost && g.units.length).sort((x, y) => x.distance - y.distance)[0] ?? groups[0] : null);
  if (P1.isId(a.unit) && [...SIDES, null].includes(a.side ?? null)) {
    for (const s of SIDES) next.sides[s] = next.sides[s].filter((u) => u !== a.unit);
    if (groups) for (const g of groups) g.units = g.units.filter((u) => u !== a.unit);
    if (a.side) next.sides[a.side].push(a.unit);
    if (a.side === "pursuer" && gid) {
      if (!groups) groups = [{ id: "g1", units: next.sides.pursuer.filter((u) => u !== a.unit), distance: ch.distance }];
      const known = groups.find((g) => g.id === gid);
      if (known) known.units.push(a.unit);
      else { const n = Math.max(0, ...groups.map((g) => Number(String(g.id).slice(1)) || 0)) + 1; groups.push({ id: `g${n}`, units: [a.unit], distance: num(a.distance, 0, 99, nearest()?.distance ?? ch.distance) }); }
    } else if (a.side === "pursuer" && groups) nearest().units.push(a.unit);
  } else if (gid && a.distance !== undefined) {
    const g = (groups ?? []).find((x) => x.id === gid);
    if (!g) return null;
    g.distance = num(a.distance, 0, 99, g.distance);
    if (g.lost && g.distance < next.lostAt) delete g.lost;
  } else if (a.distance !== undefined) {
    if (groups) { const g = nearest(); g.distance = num(a.distance, 0, 99, g.distance); if (g.lost && g.distance < next.lostAt) delete g.lost; }
    else next.distance = num(a.distance, 0, 99, ch.distance);
  }
  if (groups) {
    groups = groups.filter((g) => g.units.length);
    if (groups.length <= 1) { if (groups[0]) next.distance = groups[0].distance; delete next.groups; }
    else { next.groups = groups; next.distance = nearestOf(next); }
  }
  /* FXU (D191): the record of the round just played (`last`: who rolled for each side and why, what the round came to, the catch) told
     the chase as that round left it. Once the GM changes who is in it or how far apart they are, the record is history only: `edited`
     tells the surfaces not to read it as the chase of now (ui/chase-pure.mjs: the distance's heading, the catch, who rolls and why) */
  const shape = (c) => JSON.stringify([c.distance, c.sides, groupsOf(c)?.map((g) => [g.id, g.units, g.distance, g.lost ?? null]) ?? null]);
  if (isObj(ch.last) && !ch.last.edited && shape(next) !== shape(ch)) next.last = { ...ch.last, edited: 1 };
  return next;
}
export const OUTCOMES = Object.freeze(["escaped", "caught", "gaveUp", "combat"]);
/** ANSD (CHASE-4): the fleeing units that leave the fight when the chase ends with "escaped": each one whose people are all NPCs (somebody
    on foot, or a vehicle and everybody aboard it). -> [{ id, people: [ids aboard] }] */
export function escapedNpcs(state, f) {
  const ch = chaseOf(state);
  return (ch?.sides?.prey ?? []).map((u) => ({ id: u, people: occupants(state, u).filter((x) => x !== u) }))
    .filter((u) => [u.id, ...u.people].every((id) => { const c = f.c(id); return !!c && c.npc === true; }));
}
/** -> { puts: [{ who, to, group }] }: everyone back where the chase began (the GM moves them on from there) [D] */
export function endPlan(state) {
  const ch = chaseOf(state);
  return { puts: ch ? Object.keys(ch.back ?? {}).filter((u) => typeof ch.back[u] === "string").map((u) => ({ who: u, to: ch.back[u], group: occupants(state, u) })) : [] };
}

/* ------------------------------------------------------------------ one chase round */
/* CHASE (U176): the GM may name the obstacle of the round instead of rolling the table [B3441]: the book leaves the pick to the GM. */
export const OBSTACLES = Object.freeze(Object.keys(chase.CHASE_OBSTACLES));
export const roundSpec = (obstacle = null) => ({ action: "chaseRound", flow: "chase", actor: null, decl: { ...blank, action: "chaseRound", targets: [], ...(OBSTACLES.includes(obstacle) ? { obstacle } : {}) }, cause: "gm" });
const obstacleOf = (I) => (I.data.ch?.obstacle ? chase.CHASE_OBSTACLES[I.data.ch.obstacle] ?? null : null);
function sideRoll(v, I, R, key, u, attr, { passive = false, mods = [] } = {}) {
  if (!K.rollOf(I, key)) { const bp = K.buildPool(v, I, key, u.roller, attr, mods, { base: attr === "agility" && Number.isFinite(u.mount) ? u.mount : null }); /* Z16 [B3144] */ for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to }); R.effects.push(K.rollEffect(key, u.roller, attr, bp.pool, { passive, label: `ITAC.roll.${key.split(":")[0]}`, noPush: !K.mayPush(v, u.roller) })); return "wait"; }      // T046: both sides are active [B3433], each roller under its own push rule [B2231], [B2186] (SWEEP-R3)
  return K.rollFinal(I, key) ? "done" : "wait";
}
/* CHASE2 groups (ours, G4, G5): the result of a round of groups. Each group against the prey's one roll, as the opposed roll of the plain
   chase [B3434] (the book's complex way [B3480] moves each forward by its sixes: the same difference); a group that reaches 0 has caught
   the prey, one at the end distance has lost it (ANSG, B3 + I4) [B3436] (it stays listed, dashed, until the GM takes it out or brings it back). The
   chase is escaped when every group lost the prey. state.chase.last.groups = { [gid]: { from, to, sixes, caught, lost } } */
function groupResult(v, I, R, c, ch, def) {
  const preyN = K.sixesOf(I, "prey"), res = {}, by = {};
  for (const g of c.groups) {
    if (g.lost) { res[g.id] = { from: g.distance, to: g.distance, sixes: null, caught: 0, lost: g.lost }; continue; }
    const n = g.roller ? K.sixesOf(I, `pursuer:${g.id}`) : 0;
    const out = c.over ? { distance: g.distance, winner: "prey", caught: false, escaped: false } : chase.chaseRoll({ distance: g.distance, preySixes: preyN, pursuerSixes: n, endDistance: c.lostAt, preyAutoFail: !!def?.preyAutoFail });
    const was = (groupsOf(ch) ?? []).find((x) => x.id === g.id)?.distance ?? g.distance;
    res[g.id] = { from: was, to: out.distance, sixes: g.roller ? n : null, winner: out.winner, caught: out.caught ? 1 : 0, ...(out.escaped ? { lost: "far" } : {}) };
    if (g.roller) by[g.id] = { unit: g.roller.id, roller: g.roller.roller, why: g.roller.why ?? null };
  }
  const groups = (groupsOf(ch) ?? []).map((g) => { const r = res[g.id]; if (!r) return g; const { lost: _l, ...rest } = g; return { ...rest, distance: r.to, ...(r.lost ? { lost: r.lost } : {}) }; });
  const live = groups.filter((g) => !g.lost), escaped = !live.length;
  const distance = live.length ? Math.min(...live.map((g) => g.distance)) : Math.min(...groups.map((g) => g.distance));
  c.catches = c.groups.filter((g) => res[g.id]?.caught).map((g) => g.id);
  const near = c.groups.find((g) => !g.lost && g.roller) ?? null, nr = near ? res[near.id] : null;
  const caught = c.catches.length > 0;
  c.out = { distance, winner: nr?.winner ?? null, caught, escaped }; c.distance = distance;
  const last = { prey: c.over ? null : (def?.preyAutoFail ? 0 : preyN), pursuer: c.over ? null : nr?.sixes ?? null, winner: nr?.winner ?? null, obstacle: c.obstacle, caught: caught ? 1 : 0, escaped: escaped ? 1 : 0, from: ch.distance,
    by: { prey: { unit: c.prey.id, roller: c.prey.roller, why: c.prey.why ?? null }, pursuer: near ? by[near.id] : null, groups: by }, groups: res };
  R.effects.push({ t: "state", path: ["chase"], to: { ...ch, groups, distance, rolled: v.state.round, round: (ch.round ?? 0) + 1, last, ...(c.over ? { over: c.over } : {}) } });
  R.events.push({ type: "chase", distance, roll: { prey: last.prey, pursuer: last.pursuer }, obstacle: c.obstacle, winner: last.winner, caught, escaped, groups: res });
  I.data.result = escaped ? "escaped" : caught ? "caught" : "run";
  R.goto = caught ? "catch" : escaped ? "close" : "crew"; return R;
}
/* ANSD (CHASE2-1): who strikes on a catch [B3434]: every unit that reached the prey and can still move (unitFacts: a vehicle with a driver
   and an engine, somebody on foot not out of the fight), the one who rolled for its group (or side) first. -> [{ key, u }] */
function catchersOf(v, c) {
  const ch = chaseOf(v.state), out = [];
  const add = (units, first) => { for (const id of [...(first ? [first] : []), ...units.filter((x) => x !== first)]) { const u = unitFacts(v, id); if (u && !out.some((o) => o.u.id === id)) out.push({ key: `catch:${id}`, u }); } };
  if (c.groups) for (const gid of c.catches ?? []) { const g = c.groups.find((x) => x.id === gid); add((groupsOf(ch) ?? []).find((x) => x.id === gid)?.units ?? [], g?.roller?.id ?? null); }
  else add(ch?.sides?.pursuer ?? [], c.pursuer?.id ?? null);
  return out;
}
/* ANSD (CHASE2-1): whom a striker may pick: the fleeing units still on the scene (somebody on foot not out of the fight), the one who
   rolled for them first (the default the card offers first) */
function catchTargets(v, c) {
  const list = chaseOf(v.state)?.sides?.prey ?? [], first = c.prey?.id ?? null;
  return [...(first && list.includes(first) ? [first] : []), ...list.filter((x) => x !== first)].filter((id) => { const f = v.facts.c(id); return !!f && f.present !== false && (f.kind === "vehicle" || f.health > 0); });
}
export const round = {
  STEPS: Object.freeze(["check", "obstacle", "movement", "result", "catch", "crew", "close"]),
  legality(v) {
    const ch = chaseOf(v.state);
    if (!ch) return bad("noChase");
    if (ch.rolled === v.state.round) return bad("chaseRolled");
    const gs = groupsOf(ch);       // CHASE2 groups (ours): a round needs the prey and at least one group still in the chase that can move
    if (!rollerOf(v, "prey") || (gs ? !activeGroups(ch).some((g) => rollerOf(v, "pursuer", g.id)) : !rollerOf(v, "pursuer"))) return bad("chaseSides", { gmMayAllow: 1 });
    return fine;
  },
  revalidate(v) { return { ok: !!chaseOf(v.state), reasons: chaseOf(v.state) ? [] : ["noChase"] }; },
  steps: {
    check(v, inst) {
      const I = K.draft(inst), R = K.result(I), ch = chaseOf(v.state);
      if (!ch) { I.data.result = "illegal"; R.goto = "close"; return R; }
      I.locked = true;
      const chosen = OBSTACLES.includes(I.decl?.obstacle) ? I.decl.obstacle : null;      // CHASE (U176) [B3441]: the obstacle the GM named
      I.data.ch = { prey: rollerOf(v, "prey"), pursuer: rollerOf(v, "pursuer"), distance: ch.distance, lostAt: ch.lostAt, obstacle: chosen, ...(chosen ? { chosen: 1 } : {}), results: {} };
      /* CHASE2 groups (ours, G2): each group still in the chase, the nearest first, with the one who rolls for it [B3479] */
      if (groupsOf(ch)) {
        I.data.ch.groups = activeGroups(ch).map((g, k) => ({ g, k })).sort((a, b) => a.g.distance - b.g.distance || a.k - b.k).map(({ g }) => ({ id: g.id, distance: g.distance, roller: rollerOf(v, "pursuer", g.id) }));
        I.data.ch.pursuer = I.data.ch.groups.find((g) => g.roller)?.roller ?? null;
      }
      if (chosen) R.events.push({ type: "chase", distance: ch.distance, obstacle: chosen, chosen: 1 });
      R.goto = ch.obstacles || chosen ? "obstacle" : "movement"; return R;
    },
    /* [B3448-3476]: the obstacle of the round and its rolls, the prey first [B3442]; they are no actions, so nobody pushes them [A-2] */
    obstacle(v, inst) {
      const I = K.draft(inst), R = K.result(I), c = I.data.ch;
      if (!c.obstacle) {
        const f = I.data.res?.d66;
        if (!f) { if (!K.flag(I, "d66")) { K.setFlag(I, "d66"); R.effects.push({ t: "dice", key: "d66", n: 2 }); } R.wait = true; return R; }
        c.obstacle = chase.chaseObstacle(Math.max(1, Math.min(6, f[0] ?? 1)), Math.max(1, Math.min(6, f[1] ?? 1)));
        c.d66 = (f[0] ?? 1) * 10 + (f[1] ?? 1);
        R.events.push({ type: "chase", distance: c.distance, obstacle: c.obstacle, d66: c.d66 });
      }
      const def = obstacleOf(I), list = (def?.rolls ?? []).slice();
      /* [B3473]: the pursuer looks for the path only when the prey found it, so its roll joins the list when the prey's result is known
         (in this pass, right after the prey's roll, or in a later one) */
      const follow = () => { if (def?.hiddenPath && c.results.prey > 0 && !list.some((x) => x.who === "pursuer")) list.push({ who: "pursuer", attr: "intuition" }); };
      follow();
      /* CHASE2 groups (ours, G3): the one obstacle of the round meets every group; what the pursuer rolls, each group rolls (its roller),
         the nearest first, after the prey */
      const slots = (who) => (who === "prey" ? [{ key: "prey", u: c.prey }] : c.groups ? c.groups.filter((g) => g.roller).map((g) => ({ key: `pursuer:${g.id}`, u: g.roller })) : [{ key: "pursuer", u: c.pursuer }]);
      for (const r of list) for (const sl of slots(r.who)) {
        const u = sl.u, key = `obs:${sl.key}`;
        if (c.results[sl.key] !== undefined) continue;
        if (r.optional) {
          const pk = `opt:${sl.key}`;
          if (!I.data.pk?.[pk]) { R.prompts.push({ key: pk, kind: "chaseOption", to: K.addressee(v, u.roller), about: u.roller, options: [{ id: "try", label: "ITAC.opt.try" }, { id: K.PASS, label: "ITAC.opt.pass" }], data: { obstacle: c.obstacle, attr: r.attr } }); R.wait = true; return R; }
          if (!K.isAnswered(v, I, pk)) { R.wait = true; return R; }
          if (K.answerId(v, I, pk) !== "try") { c.results[sl.key] = null; continue; }
        }
        const mods = r.attr === "agility" && u.maneuver ? [{ source: "maneuverability", dice: u.maneuver }] : [];     // [B2940]
        if (sideRoll(v, I, R, key, u, r.attr, { mods }) === "wait") { R.wait = true; return R; }      // ANSF (A11 + P7-1, «Wszystkie 4 zmiany»): an obstacle is active movement, pushed like the chase roll
        c.results[sl.key] = K.sixesOf(I, key);
        follow();
        R.events.push({ type: "roll", key, who: u.roller, attr: r.attr, dice: K.rollOf(I, key)?.pool?.total, sixes: c.results[sl.key], ones: 0, pushed: 0, messageId: K.rollOf(I, key)?.messageId });
      }
      if (!K.flag(I, "obsApplied")) {
        K.setFlag(I, "obsApplied");
        if (c.groups) {
          /* each group meets it at its own distance: the prey's result counts for every group, a group's own result for that group; a group
             that fails the hidden path loses the prey (the chase is over for it); the chase is over when every group lost it */
          c.damage = [];
          for (const g of c.groups) {
            const res = {}, gk = `pursuer:${g.id}`;
            if (c.results.prey != null) res.prey = c.results.prey;
            if (c.results[gk] != null) res.pursuer = c.results[gk];
            const out = chase.applyObstacle({ obstacle: c.obstacle, distance: g.distance, results: res });
            g.distance = out.distance;
            if (out.chaseOver) g.lost = "hiddenPath";
            for (const dm of out.damage) { const who = dm.who === "prey" ? "prey" : gk; if (!c.damage.some((x) => x.who === who)) c.damage.push({ who, amount: dm.amount }); }
          }
          const live = c.groups.filter((g) => !g.lost);
          if (!live.length) c.over = "hiddenPath";
          c.distance = live.length ? Math.min(...live.map((g) => g.distance)) : c.distance;
        } else {
          const res = Object.fromEntries(Object.entries(c.results).filter(([, n]) => n != null));
          const out = chase.applyObstacle({ obstacle: c.obstacle, distance: c.distance, results: res });
          c.distance = out.distance; if (out.chaseOver) c.over = "hiddenPath"; c.damage = out.damage;
        }
      }
      const unitOfKey = (who) => (who === "prey" || who === "pursuer" ? c[who] : c.groups?.find((g) => `pursuer:${g.id}` === who)?.roller ?? null);
      for (const dmg of c.damage ?? []) {                                                           // [B3464], [B3470]: the one who failed, or their vehicle
        const u = unitOfKey(dmg.who), key = `obsd:${dmg.who}`;
        if (!u) continue;
        let amount = dmg.amount;
        if (amount === "d6") { const f = I.data.res?.[key]; if (!f) { if (!K.flag(I, key)) { K.setFlag(I, key); R.effects.push({ t: "dice", key, n: 1 }); } R.wait = true; return R; } amount = f[0] ?? 1; }
        if (!K.flag(I, `hurt:${dmg.who}`)) { K.setFlag(I, `hurt:${dmg.who}`); R.push = hazardChild([u.id], { kind: "fixed", amount, armor: false, source: "kinetic", cause: "hazard", id: "chase" }); return R; }
      }
      R.goto = c.over ? "result" : "movement"; return R;
    },
    /* [B3432-3433], [R25]: AGILITY against AGILITY, Maneuverability and the speed bonus; both may push, the prey first */
    movement(v, inst) {
      const I = K.draft(inst), R = K.result(I), c = I.data.ch, def = obstacleOf(I);
      const mods = (side) => chase.chaseModifiers({ speed: c[side].speed, otherSpeed: c[other(side)].speed, maneuver: c[side].maneuver, obstacle: c.obstacle });
      if (c.groups) {
        /* CHASE2 groups (ours, G4): the prey rolls once, against every group (its speed bonus is reckoned against the nearest group that
           moves); then each group's roller, the nearest first, with its own bonus against the prey; all are active and may push [R25] */
        const pm = chase.chaseModifiers({ speed: c.prey.speed, otherSpeed: c.pursuer?.speed ?? c.prey.speed, maneuver: c.prey.maneuver, obstacle: c.obstacle });
        if (!def?.preyAutoFail && sideRoll(v, I, R, "prey", c.prey, "agility", { mods: pm }) === "wait") { R.wait = true; return R; }
        for (const g of c.groups) {
          if (g.lost || !g.roller) continue;
          const gm = chase.chaseModifiers({ speed: g.roller.speed, otherSpeed: c.prey.speed, maneuver: g.roller.maneuver, obstacle: c.obstacle });
          if (sideRoll(v, I, R, `pursuer:${g.id}`, g.roller, "agility", { mods: gm }) === "wait") { R.wait = true; return R; }
        }
        for (const [key, who] of [["prey", c.prey.roller], ...c.groups.filter((g) => g.roller).map((g) => [`pursuer:${g.id}`, g.roller.roller])]) { const r = K.rollOf(I, key); if (r) R.events.push({ type: "roll", key, who, attr: "agility", dice: r.pool?.total, sixes: K.sixesOf(I, key), ones: r.ones ?? 0, pushed: r.pushed ?? 0, messageId: r.messageId }); }
        R.goto = "result"; return R;
      }
      if (!def?.preyAutoFail && sideRoll(v, I, R, "prey", c.prey, "agility", { mods: mods("prey") }) === "wait") { R.wait = true; return R; }      // [B3452]: a dead end, the prey fails without a roll
      if (sideRoll(v, I, R, "pursuer", c.pursuer, "agility", { mods: mods("pursuer") }) === "wait") { R.wait = true; return R; }
      for (const side of SIDES) { const r = K.rollOf(I, side); if (r) R.events.push({ type: "roll", key: side, who: c[side].roller, attr: "agility", dice: r.pool?.total, sixes: K.sixesOf(I, side), ones: r.ones ?? 0, pushed: r.pushed ?? 0, messageId: r.messageId }); }
      R.goto = "result"; return R;
    },
    result(v, inst) {
      const I = K.draft(inst), R = K.result(I), c = I.data.ch, ch = chaseOf(v.state), def = obstacleOf(I);
      if (!ch) { R.goto = "close"; return R; }
      if (c.groups) return groupResult(v, I, R, c, ch, def);
      const prey = K.sixesOf(I, "prey"), pursuer = K.sixesOf(I, "pursuer");
      const out = c.over ? { distance: c.distance, winner: "prey", caught: false, escaped: true } : chase.chaseRoll({ distance: c.distance, preySixes: prey, pursuerSixes: pursuer, endDistance: c.lostAt, preyAutoFail: !!def?.preyAutoFail });   // [B3434], [B3436], [I4]
      c.out = out; c.distance = out.distance;
      /* CHASE2: `by` = who rolled for each side and why (the table hears it; no numbers), so every seat can say it after the round */
      const by = Object.fromEntries(SIDES.map((s) => [s, isObj(c[s]) ? { unit: c[s].id, roller: c[s].roller, why: c[s].why ?? null } : null]));
      const last = { prey: c.over ? null : prey, pursuer: c.over ? null : pursuer, winner: out.winner, obstacle: c.obstacle, caught: out.caught ? 1 : 0, escaped: out.escaped ? 1 : 0, from: ch.distance, by };
      R.effects.push({ t: "state", path: ["chase"], to: { ...ch, distance: out.distance, rolled: v.state.round, round: (ch.round ?? 0) + 1, last, ...(c.over ? { over: c.over } : {}) } });
      R.events.push({ type: "chase", distance: out.distance, roll: { prey: last.prey, pursuer: last.pursuer }, obstacle: c.obstacle, winner: out.winner, caught: out.caught, escaped: out.escaped });
      I.data.result = out.escaped ? "escaped" : out.caught ? "caught" : "run";
      R.goto = out.caught ? "catch" : out.escaped ? "close" : "crew"; return R;
    },
    /* [B3434]: at distance 0 the pursuer may at once charge, or ram with a vehicle; it cannot be blocked */
    catch(v, inst) {
      const I = K.draft(inst), R = K.result(I), c = I.data.ch;
      /* CHASE2 groups (ours, G5): every group that reached the prey this round may strike, each in turn, the nearest-before-the-roll first.
         ANSD (CHASE2-1, the user 2026-11-12): EVERY unit of a group that reached 0 may strike [B3434], not only the one who rolled for it
         (on foot a charge, in a vehicle its driver rams), each in turn, the group's roller first; the target is the striker's pick among the
         fleeing units still there, the one who rolled for them offered first. The plain chase: every pursuing unit (all of them are at 0). */
      const strikers = catchersOf(v, c), targets = catchTargets(v, c);
      for (const { key, u } of strikers) {
        if (!I.data.pk?.[key]) {
          if (!targets.length) continue;
          const verb = u.vehicle ? "ITAC.action.ram" : "ITAC.opt.charge";
          R.prompts.push({ key, kind: "chaseCatch", to: K.addressee(v, u.roller), about: u.roller,
            options: [...targets.map((tid, k) => ({ id: k ? `attack:${tid}` : "attack", label: verb, data: { target: tid } })), { id: K.PASS, label: "ITAC.opt.pass" }],
            data: { target: targets[0], targets, ram: u.vehicle ? 1 : 0, unit: u.id } });
          R.wait = true; return R;
        }
        if (!K.isAnswered(v, I, key)) { R.wait = true; return R; }
        const ans = K.answerId(v, I, key) ?? "", tid = ans === "attack" ? K.promptOf(v, I, key)?.data?.target : ans.startsWith("attack:") ? ans.slice(7) : null;
        if (tid && !K.flag(I, key)) {
          K.setFlag(I, key);
          /* on foot it is the charge of the attack flow [B2490]: STRENGTH, its own stunts. The chase brought the pursuer there, so the charge has no
             approach of its own and no movement left over (no Slam) */
          const action = u.vehicle ? "ram" : "charge";
          R.push = { action, actor: u.roller, decl: { ...blank, action, targets: [tid], ...(u.vehicle ? {} : { weapon: "unarmed" }) }, cause: "reaction",
            data: { kind: action, chaseCatch: 1, ...(u.vehicle ? {} : { charge: { done: 1, left: 0, total: 0, zones: [] } }) }, part: 1, prepaid: 1 };
          return R;
        }
      }
      R.goto = "crew"; return R;
    },
    /* [B3438-3442]: after the chase roll everyone aboard who does not drive may make one ranged attack; a mounted weapon lets the driver */
    crew(v, inst) {
      const I = K.draft(inst), R = K.result(I), ch = chaseOf(v.state);
      if (ch && !K.flag(I, "crew")) {
        K.setFlag(I, "crew");
        const got = [], first = [];
        const lost = new Set((groupsOf(ch) ?? []).filter((g) => g.lost).flatMap((g) => g.units));       // CHASE2 groups (ours, G6): a group that lost the prey has nobody to shoot at
        for (const side of ["pursuer", "prey"]) for (const u of ch.sides[side] ?? []) {
          if (lost.has(u)) continue;
          const vf = v.facts.c(u), rec = vehOf(v.state, u);
          if (vf?.kind !== "vehicle") continue;
          for (const cid of [...rec.crew, ...(rec.driver && (vf.vehicle?.weapons ?? 0) > 0 && !rec.off?.weapon ? [rec.driver] : [])]) {
            const f = v.facts.c(cid);
            if (!f || f.present === false || f.health <= 0 || !v.state.ledger?.[cid]) continue;
            const g = Lg.addGrant(P1.ledgerOf(v.state, cid), { ...Lg.grantTemplate("gm", { unit: "full", window: "anytime", expires: "roundEnd" }), kind: "chaseCrew" });
            if (g.ok) { R.effects.push({ t: "state", path: ["ledger", cid], to: g.ledger }); got.push(cid); if (side === "pursuer") first.push(cid); }
          }
        }
        /* ANSD (CHASE2-9) [B3438]: `pursuers` = the crew who shoot first; a fleeing crew member's shot waits for them (economy-pure crewOrderHold) */
        if (got.length) { R.effects.push({ t: "state", path: ["chase", "crew"], to: { round: v.state.round, ids: got, pursuers: first } }); R.events.push({ type: "chase", distance: ch.distance, crew: got }); }
      }
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};
