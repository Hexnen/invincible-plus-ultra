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
   (engine-pure.mjs: chaseStart, chaseSet, chaseEnd): `startPlan` / `endPlan` say what they write. */
import { chase } from "../../rules/index.mjs";
import * as Lg from "../ledger-pure.mjs";
import * as P1 from "../economy-pure.mjs";
import * as MP from "../movement-pure.mjs";
import * as K from "./kit.mjs";
import { hazardChild } from "./move.mjs";
import { rideOf, vehOf, occupants } from "./vehicle.mjs";

const bad = (reason, params = {}) => ({ ok: false, reason, params });
const fine = { ok: true, reason: null, params: {}, gates: [], notes: [] };
const blank = { helpers: [], exploits: [], stressTotal: 0 };
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
export const SIDES = Object.freeze(["prey", "pursuer"]);
export const chaseOf = (state) => (state?.kind === "chase" && isObj(state.chase) ? state.chase : null);
const other = (side) => (side === "prey" ? "pursuer" : "prey");

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
    return d && !rec.wrecked && !rec.off?.engine ? { id, vehicle: 1, roller: rec.driver, speed: Number(c.vehicle?.speed) || 1, agility: d.attrs?.agility ?? 0, maneuver: Number(c.vehicle?.maneuver) || 0 } : null;
  }
  if (c.health <= 0) return null;
  const speed = Math.max(1, ...MP.modesOf(c).map((m) => Number(m.profile?.zones) || 1));
  return { id, roller: id, speed, agility: c.attrs?.agility ?? 0, maneuver: 0 };
}
/** the unit that rolls for a side: the slowest, the lowest AGILITY on a tie [B3479] */
export function rollerOf(v, side) {
  const list = (chaseOf(v.state)?.sides?.[side] ?? []).map((id) => unitFacts(v, id)).filter(Boolean);
  const pick = chase.chaseRoller(list.map((u) => ({ id: u.id, speed: u.speed, agility: u.agility })));
  return pick ? list.find((u) => u.id === pick.id) : null;
}

/* ------------------------------------------------------------------ the facts of a chase: distance instead of the map [B3412] */
/** Wrap the live facts: between the two sides the range is the chase distance, inside a side it is 0. `get` returns the state of now. */
export function facts(f, get) {
  const d = () => Math.max(0, Math.trunc(Number(chaseOf(get())?.distance) || 0));
  return {
    ...f,
    range: (a, b) => { const st = get(), sa = sideOf(st, a), sb = sideOf(st, b); return sa && sb ? (sa === sb ? { total: 0, borders: 0, levels: 0 } : { total: d(), borders: d(), levels: 0 }) : f.range(a, b); },
    inZone: (cid) => { const st = get(), s = sideOf(st, cid); return s ? [...membersOf(st, s), ...(d() === 0 ? membersOf(st, other(s)) : [])].filter((x) => x !== cid) : f.inZone(cid); },
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
/** -> the patch of state.chase a `chaseSet` writes, or null */
export function setPatch(state, a) {
  const ch = chaseOf(state);
  if (!ch) return null;
  const next = { ...ch, sides: { prey: ch.sides.prey.slice(), pursuer: ch.sides.pursuer.slice() } };
  if (a.distance !== undefined) next.distance = num(a.distance, 0, 99, ch.distance);
  if (a.lostAt !== undefined) next.lostAt = num(a.lostAt, 1, 99, ch.lostAt);
  if (a.obstacles !== undefined) next.obstacles = a.obstacles ? 1 : 0;
  if (P1.isId(a.unit) && [...SIDES, null].includes(a.side ?? null)) { for (const s of SIDES) next.sides[s] = next.sides[s].filter((u) => u !== a.unit); if (a.side) next.sides[a.side].push(a.unit); }
  return next;
}
export const OUTCOMES = Object.freeze(["escaped", "caught", "gaveUp", "combat"]);
/** -> { puts: [{ who, to, group }] }: everyone back where the chase began (the GM moves them on from there) [D] */
export function endPlan(state) {
  const ch = chaseOf(state);
  return { puts: ch ? Object.keys(ch.back ?? {}).filter((u) => typeof ch.back[u] === "string").map((u) => ({ who: u, to: ch.back[u], group: occupants(state, u) })) : [] };
}

/* ------------------------------------------------------------------ one chase round */
export const roundSpec = () => ({ action: "chaseRound", flow: "chase", actor: null, decl: { ...blank, action: "chaseRound", targets: [] }, cause: "gm" });
const obstacleOf = (I) => (I.data.ch?.obstacle ? chase.CHASE_OBSTACLES[I.data.ch.obstacle] ?? null : null);
function sideRoll(v, I, R, key, u, attr, { passive = false, mods = [] } = {}) {
  if (!K.rollOf(I, key)) { R.effects.push(K.rollEffect(key, u.roller, attr, K.buildPool(v, I, key, u.roller, attr, mods, {}).pool, { passive, label: `ITAC.roll.${key.split(":")[0]}` })); return "wait"; }
  return K.rollFinal(I, key) ? "done" : "wait";
}
export const round = {
  STEPS: Object.freeze(["check", "obstacle", "movement", "result", "catch", "crew", "close"]),
  legality(v) {
    const ch = chaseOf(v.state);
    if (!ch) return bad("noChase");
    if (ch.rolled === v.state.round) return bad("chaseRolled");
    if (!rollerOf(v, "prey") || !rollerOf(v, "pursuer")) return bad("chaseSides", { gmMayAllow: 1 });
    return fine;
  },
  revalidate(v) { return { ok: !!chaseOf(v.state), reasons: chaseOf(v.state) ? [] : ["noChase"] }; },
  steps: {
    check(v, inst) {
      const I = K.draft(inst), R = K.result(I), ch = chaseOf(v.state);
      if (!ch) { I.data.result = "illegal"; R.goto = "close"; return R; }
      I.locked = true;
      I.data.ch = { prey: rollerOf(v, "prey"), pursuer: rollerOf(v, "pursuer"), distance: ch.distance, lostAt: ch.lostAt, obstacle: null, results: {} };
      R.goto = ch.obstacles ? "obstacle" : "movement"; return R;
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
      if (def?.hiddenPath && c.results.prey > 0) list.push({ who: "pursuer", attr: "intuition" });      // [B3473]: the pursuer looks for the path only when the prey found it
      for (const r of list) {
        const u = c[r.who], key = `obs:${r.who}`;
        if (c.results[r.who] !== undefined) continue;
        if (r.optional) {
          const pk = `opt:${r.who}`;
          if (!I.data.pk?.[pk]) { R.prompts.push({ key: pk, kind: "chaseOption", to: K.addressee(v, u.roller), about: u.roller, options: [{ id: "try", label: "ITAC.opt.try" }, { id: K.PASS, label: "ITAC.opt.pass" }], data: { obstacle: c.obstacle, attr: r.attr } }); R.wait = true; return R; }
          if (!K.isAnswered(v, I, pk)) { R.wait = true; return R; }
          if (K.answerId(v, I, pk) !== "try") { c.results[r.who] = null; continue; }
        }
        const mods = r.attr === "agility" && u.maneuver ? [{ source: "maneuverability", dice: u.maneuver }] : [];     // [B2940]
        if (sideRoll(v, I, R, key, u, r.attr, { passive: true, mods }) === "wait") { R.wait = true; return R; }
        c.results[r.who] = K.sixesOf(I, key);
        R.events.push({ type: "roll", key, who: u.roller, attr: r.attr, dice: K.rollOf(I, key)?.pool?.total, sixes: c.results[r.who], ones: 0, pushed: 0, messageId: K.rollOf(I, key)?.messageId });
      }
      const res = Object.fromEntries(Object.entries(c.results).filter(([, n]) => n != null));
      const out = chase.applyObstacle({ obstacle: c.obstacle, distance: c.distance, results: res });
      if (!K.flag(I, "obsApplied")) { K.setFlag(I, "obsApplied"); c.distance = out.distance; if (out.chaseOver) c.over = "hiddenPath"; c.damage = out.damage; }
      for (const dmg of c.damage ?? []) {                                                           // [B3464], [B3470]: the one who failed, or their vehicle
        const u = c[dmg.who], key = `obsd:${dmg.who}`;
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
      if (!def?.preyAutoFail && sideRoll(v, I, R, "prey", c.prey, "agility", { mods: mods("prey") }) === "wait") { R.wait = true; return R; }      // [B3452]: a dead end, the prey fails without a roll
      if (sideRoll(v, I, R, "pursuer", c.pursuer, "agility", { mods: mods("pursuer") }) === "wait") { R.wait = true; return R; }
      for (const side of SIDES) { const r = K.rollOf(I, side); if (r) R.events.push({ type: "roll", key: side, who: c[side].roller, attr: "agility", dice: r.pool?.total, sixes: K.sixesOf(I, side), ones: r.ones ?? 0, pushed: r.pushed ?? 0, messageId: r.messageId }); }
      R.goto = "result"; return R;
    },
    result(v, inst) {
      const I = K.draft(inst), R = K.result(I), c = I.data.ch, ch = chaseOf(v.state), def = obstacleOf(I);
      if (!ch) { R.goto = "close"; return R; }
      const prey = K.sixesOf(I, "prey"), pursuer = K.sixesOf(I, "pursuer");
      const out = c.over ? { distance: c.distance, winner: "prey", caught: false, escaped: true } : chase.chaseRoll({ distance: c.distance, preySixes: prey, pursuerSixes: pursuer, endDistance: c.lostAt, preyAutoFail: !!def?.preyAutoFail });   // [B3434], [B3436], [I4]
      c.out = out; c.distance = out.distance;
      const last = { prey: c.over ? null : prey, pursuer: c.over ? null : pursuer, winner: out.winner, obstacle: c.obstacle, caught: out.caught ? 1 : 0, escaped: out.escaped ? 1 : 0, from: ch.distance };
      R.effects.push({ t: "state", path: ["chase"], to: { ...ch, distance: out.distance, rolled: v.state.round, round: (ch.round ?? 0) + 1, last, ...(c.over ? { over: c.over } : {}) } });
      R.events.push({ type: "chase", distance: out.distance, roll: { prey: last.prey, pursuer: last.pursuer }, obstacle: c.obstacle, winner: out.winner, caught: out.caught, escaped: out.escaped });
      I.data.result = out.escaped ? "escaped" : out.caught ? "caught" : "run";
      R.goto = out.caught ? "catch" : out.escaped ? "close" : "crew"; return R;
    },
    /* [B3434]: at distance 0 the pursuer may at once charge, or ram with a vehicle; it cannot be blocked */
    catch(v, inst) {
      const I = K.draft(inst), R = K.result(I), c = I.data.ch, u = c.pursuer;
      if (!I.data.pk?.catch) { R.prompts.push({ key: "catch", kind: "chaseCatch", to: K.addressee(v, u.roller), about: u.roller, options: [{ id: "attack", label: u.vehicle ? "ITAC.action.ram" : "ITAC.opt.charge" }, { id: K.PASS, label: "ITAC.opt.pass" }], data: { target: c.prey.id, ram: u.vehicle ? 1 : 0 } }); R.wait = true; return R; }
      if (!K.isAnswered(v, I, "catch")) { R.wait = true; return R; }
      if (K.answerId(v, I, "catch") === "attack" && !K.flag(I, "catch")) {
        K.setFlag(I, "catch");
        /* on foot it is the charge of the attack flow [B2490]: STRENGTH, its own stunts. The chase brought the pursuer there, so the charge has no
           approach of its own and no movement left over (no Slam) */
        const action = u.vehicle ? "ram" : "charge";
        R.push = { action, actor: u.roller, decl: { ...blank, action, targets: [c.prey.id], ...(u.vehicle ? {} : { weapon: "unarmed" }) }, cause: "reaction",
          data: { kind: action, chaseCatch: 1, ...(u.vehicle ? {} : { charge: { done: 1, left: 0, total: 0, zones: [] } }) }, part: 1, prepaid: 1 };
        return R;
      }
      R.goto = "crew"; return R;
    },
    /* [B3438-3442]: after the chase roll everyone aboard who does not drive may make one ranged attack; a mounted weapon lets the driver */
    crew(v, inst) {
      const I = K.draft(inst), R = K.result(I), ch = chaseOf(v.state);
      if (ch && !K.flag(I, "crew")) {
        K.setFlag(I, "crew");
        const got = [];
        for (const side of ["pursuer", "prey"]) for (const u of ch.sides[side] ?? []) {
          const vf = v.facts.c(u), rec = vehOf(v.state, u);
          if (vf?.kind !== "vehicle") continue;
          for (const cid of [...rec.crew, ...(rec.driver && (vf.vehicle?.weapons ?? 0) > 0 && !rec.off?.weapon ? [rec.driver] : [])]) {
            const f = v.facts.c(cid);
            if (!f || f.present === false || f.health <= 0 || !v.state.ledger?.[cid]) continue;
            const g = Lg.addGrant(P1.ledgerOf(v.state, cid), { ...Lg.grantTemplate("gm", { unit: "full", window: "anytime", expires: "roundEnd" }), kind: "chaseCrew" });
            if (g.ok) { R.effects.push({ t: "state", path: ["ledger", cid], to: g.ledger }); got.push(cid); }
          }
        }
        if (got.length) { R.effects.push({ t: "state", path: ["chase", "crew"], to: { round: v.state.round, ids: got } }); R.events.push({ type: "chase", distance: ch.distance, crew: got }); }
      }
      R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};
