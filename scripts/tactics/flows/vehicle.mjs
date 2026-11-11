/* Tactical combat, package P7: VEHICLES (spec 9.10; rules: scripts/rules/vehicles.mjs). NO Foundry globals.
   A vehicle is a combatant without a card and without a ledger: the people aboard act [B2936]. Its Durability is the engine field
   `health` (system adapter), so damage to it is journaled like any other.
     state.vehicles[vid] = { driver: cid | null, crew: [cid], started?: 1, hits?: n (component damage suffered), off?: { engine?: 1, weapon?: 1 }, wrecked?: 1, destroyed?: 1 }
     status `inVehicle` on every occupant: data { vehicle, role: "driver" | "passenger" }
   seat    start the vehicle, get in, get out: quick actions [B2325-2332]
   drive   handle the vehicle: a quick action that moves it up to its Speed in zones, twice a round at most [B2941], [B3146]; the people
           aboard go along (the stretch machinery of flows/move.mjs with the vehicle as the mover and the occupants as its group)
   ram     is the attack flow with the attack `ram` [B3148]: AGILITY plus Maneuverability, damage = half the Durability rating rounded up
           [I7]; the hooks below are what flows/attack.mjs asks (legality, modifiers, base damage, the defence in a chase [B3434])
   afterHit  a hit on a vehicle [B3221-3223]: component damage on a single hit of half the Durability or more (the table [B3224-3244]),
           the wreck, the people of a rammed wreck, the crash of an aircraft [B3248]. Every die is the executor's; nobody pushes. */
import { vehicles } from "../../rules/index.mjs";
import * as Lg from "../ledger-pure.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";
import * as MP from "../movement-pure.mjs";
import * as K from "./kit.mjs";
import { travel, moveEvent, hazardChild, fallChild } from "./move.mjs";

const bad = (reason, params = {}) => ({ ok: false, reason, params });
const fine = { ok: true, reason: null, params: {}, gates: [], notes: [] };
const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);

/* ------------------------------------------------------------------ who sits where */
export const vehOf = (state, vid) => { const r = isObj(state?.vehicles?.[vid]) ? state.vehicles[vid] : {}; return { ...r, driver: r.driver ?? null, crew: Array.isArray(r.crew) ? r.crew : [] }; };
export const occupants = (state, vid) => { const r = vehOf(state, vid); return [r.driver, ...r.crew].filter(Boolean); };
/** -> { vehicle, role } | null */
export function rideOf(state, cid) {
  const s = M.statusesOf(state, cid).find((x) => x.id === "inVehicle");
  return s?.data?.vehicle ? { vehicle: s.data.vehicle, role: s.data.role === "driver" ? "driver" : "passenger" } : null;
}
const down = (rec) => (rec.wrecked ? "vehicleWrecked" : rec.off?.engine ? "engineDisabled" : null);
const seatStatus = (vid, role, by) => ({ id: "inVehicle", source: { kind: "gm", owner: by ?? undefined, name: "vehicle" }, data: { vehicle: vid, role } });
/** The writes that put `cid` on a seat of `vid` (role null: out of it). Used by the seat flow and by the GM's `vehicleSet`. -> [effect] */
export function seatEffects(state, cid, vid, role) {
  const rec = vehOf(state, vid), out = [];
  const next = { ...rec, driver: rec.driver === cid ? null : rec.driver, crew: rec.crew.filter((x) => x !== cid) };
  if (role === "driver") { if (next.driver && next.driver !== cid) { out.push({ t: "status+", who: next.driver, status: seatStatus(vid, "passenger", cid) }); next.crew = [...next.crew, next.driver]; } next.driver = cid; }
  else if (role === "passenger") next.crew = [...next.crew, cid];
  out.push({ t: "state", path: ["vehicles", vid], to: next });
  out.push(role ? { t: "status+", who: cid, status: seatStatus(vid, role, cid) } : { t: "status-", who: cid, id: "inVehicle" });
  return out;
}

/* ------------------------------------------------------------------ start, get in, get out [B2325-2332] */
const roleFor = (inst, rec) => (inst.decl.mode === "passenger" ? "passenger" : inst.decl.mode === "driver" ? "driver" : rec.driver ? "passenger" : "driver");
export const seat = {
  STEPS: Object.freeze(["check", "apply", "close"]),
  legality(v, inst) {
    const a = v.facts.c(inst.actor), ride = rideOf(v.state, inst.actor);
    if (!a || a.present === false) return bad("gone");
    if (a.health <= 0) return bad("broken");                                                     // [B2707]
    if (inst.action === "vehicleEnter") {
      const t = inst.decl.targets?.[0], tf = t ? v.facts.c(t) : null, rec = vehOf(v.state, t);
      if (!tf || tf.kind !== "vehicle" || tf.present === false) return bad("noVehicle");
      if (ride) return bad("aboard");
      const r = v.facts.range(inst.actor, t);
      if (r === null) return bad("noRange");
      if (r && r.total !== 0) return bad("outOfReach", { distance: r.total });                   // the vehicle stands in the character's zone
      if (rec.wrecked) return bad("vehicleWrecked", { gmMayAllow: 1 });
      const role = roleFor(inst, rec);
      if (role === "driver" && rec.driver) return bad("seatTaken", { gmMayAllow: 1 });
      if (role === "passenger" && Number.isFinite(tf.vehicle?.passengers) && rec.crew.length >= tf.vehicle.passengers) return bad("vehicleFull", { gmMayAllow: 1 });   // [B2939]: the driver is not counted
      return fine;
    }
    if (!ride) return bad("notAboard");
    if (inst.action === "vehicleStart") {
      const rec = vehOf(v.state, ride.vehicle);
      if (ride.role !== "driver") return bad("notDriver");
      if (down(rec)) return bad(down(rec), { gmMayAllow: 1 });
      if (rec.started) return bad("alreadyStarted");
    }
    return fine;
  },
  revalidate(v, inst) { const b = K.actorBlocked(v, inst); return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); I.locked = true; R.goto = "apply"; return R; },
    apply(v, inst) {
      const I = K.draft(inst), R = K.result(I), ride = rideOf(v.state, I.actor);
      /* D91 (spec 9.12): "get in" allowed by the GM as an exception although the declaration names no vehicle of the fight (the van is
         scenery, not a token). There is no seat to write: the action is the GM's to settle by hand, as a move without a route is. */
      if (I.action === "vehicleEnter" && v.facts.c(I.decl.targets?.[0])?.kind !== "vehicle") { I.status = "manual"; if (!K.flag(I, "byHand")) { K.setFlag(I, "byHand"); (I.data.notes ??= []).push({ note: "seatByHand", why: "noVehicle" }); } R.wait = true; return R; }
      if (!K.flag(I, "done")) {
        K.setFlag(I, "done");
        if (I.action === "vehicleEnter") {
          const t = I.decl.targets[0], role = roleFor(I, vehOf(v.state, t));
          R.effects.push(...seatEffects(v.state, I.actor, t, role));
          R.events.push({ type: "vehicle", vehicle: t, who: I.actor, state: "entered", role });
        } else if (I.action === "vehicleExit" && ride) {
          R.effects.push(...seatEffects(v.state, I.actor, ride.vehicle, null));
          R.events.push({ type: "vehicle", vehicle: ride.vehicle, who: I.actor, state: "left" });
        } else if (I.action === "vehicleStart" && ride) {
          R.effects.push({ t: "state", path: ["vehicles", ride.vehicle, "started"], to: 1 });
          R.events.push({ type: "vehicle", vehicle: ride.vehicle, who: I.actor, state: "started" });
        }
      }
      I.data.result = "done"; R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.effects.push({ t: "fact", who: I.actor, facts: { acted: 1, tags: v.entry(I)?.tags ?? [] } }); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ handling the vehicle [B2941], [B3146] */
const HANDLES_PER_ROUND = 2;
function plan(v, inst) {
  const ride = rideOf(v.state, inst.actor), a = v.facts.c(inst.actor);
  if (!a || a.present === false) return bad("gone");
  if (a.health <= 0) return bad("broken");
  if (!ride) return bad("notAboard");
  if (ride.role !== "driver") return bad("notDriver");
  const vid = ride.vehicle, vf = v.facts.c(vid), rec = vehOf(v.state, vid);
  if (!vf || vf.present === false) return bad("noVehicle");
  if (down(rec)) return bad(down(rec), { gmMayAllow: 1 });
  if (!rec.started) return bad("notStarted", { gmMayAllow: 1 });
  if (!v.facts.zones) return bad("noZones", { gmMayAllow: 1 });
  const pr = MP.priceMove(v.facts.zones, v.state, vid, vf, { to: inst.decl.to, mode: "vehicle", airborne: inst.decl.airborne }, { prepaid: true, mode: "vehicle" });
  if (!pr.ok) return bad(pr.reason, { ...pr.params, ...(pr.gmMayAllow ? { gmMayAllow: 1 } : {}) });
  if (pr.kind !== "route") return bad(pr.kind === "inZone" ? "sameZone" : "noRoute", { gmMayAllow: 1 });
  return { ok: true, vid, pr, group: occupants(v.state, vid) };
}
export const drive = {
  STEPS: Object.freeze(["check", "travel", "arrive", "close"]),
  legality(v, inst) {
    const p = plan(v, inst);
    if (!p.ok) return p;
    if (!inst.data?.mv && Lg.countTag(P1.ledgerOf(v.state, inst.actor), "vehicleHandle") >= HANDLES_PER_ROUND) return bad("handledTwice", { gmMayAllow: 1 });   // [B3146]: like walking, twice a round
    return fine;
  },
  revalidate(v, inst) { const b = K.actorBlocked(v, inst); return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) {
      const I = K.draft(inst), R = K.result(I), p = plan(v, I);
      if (!p.ok) {
        if (I.decl.exception?.state === "granted") { I.status = "manual"; (I.data.notes ??= []).push({ note: "moveByHand", reason: p.reason }); R.wait = true; return R; }
        I.data.result = "illegal"; R.goto = "close"; return R;
      }
      const pr = p.pr;
      I.data.mv = { who: p.vid, driver: I.actor, kind: pr.kind, mode: "vehicle", from: pr.from, to: pr.to, zones: pr.zones, end: pr.end, profile: pr.profile, total: pr.total, group: p.group, barriers: [], seg: 0, cleared: { [`enter:${pr.from}`]: 1 } };
      I.locked = true; R.events.push({ type: "actionLocked" });
      R.goto = "travel"; return R;
    },
    travel(v, inst) { const I = K.draft(inst), R = K.result(I); if (travel(v, I, R)) R.goto = "arrive"; return R; },
    arrive(v, inst) {
      const I = K.draft(inst), R = K.result(I), mv = I.data.mv, here = v.facts.zones?.place(mv.who);
      mv.at = here?.spot ?? mv.at ?? mv.from;
      R.events.push(moveEvent(I));
      I.data.result = mv.stop ? "stopped" : "done"; R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ what flows/attack.mjs asks */
const profileOf = (v, cid) => {
  const ride = rideOf(v.state, cid), vf = ride ? v.facts.c(ride.vehicle) : null;
  return vf ? vehicles.ramProfile({ agility: v.facts.c(cid)?.attrs?.agility ?? 0, vehicle: { maneuver: vf.vehicle?.maneuver ?? 0, durability: vf.maxHealth ?? 0 } }) : null;      // [I7]: from the Durability rating, not the points left
};
/** a vehicle has no actions of its own: it does not block or dodge, and it is wrecked, not Broken [B3221-3222] */
export const isMachine = (v, cid) => v.facts.c(cid)?.kind === "vehicle";
/** -> a refusal, or null (nothing to say) */
export function attackLegality(v, inst) {
  if (inst.data?.kind !== "ram") return null;
  const ride = rideOf(v.state, inst.actor);
  if (!ride) return bad("notAboard");
  if (ride.role !== "driver") return bad("notDriver");
  const rec = vehOf(v.state, ride.vehicle), vf = v.facts.c(ride.vehicle);
  if (!vf) return bad("noVehicle");
  if (down(rec)) return bad(down(rec), { gmMayAllow: 1 });
  if (!rec.started) return bad("notStarted", { gmMayAllow: 1 });
  for (const t of inst.decl.targets ?? []) {
    const tf = v.facts.c(t);
    if (t === ride.vehicle || occupants(v.state, ride.vehicle).includes(t)) return bad("self");
    if (tf?.kind === "vehicle" && !vehicles.canRamVehicle(vf.maxHealth ?? 0, tf.maxHealth ?? 0)) return bad("tooSmallToRam", { gmMayAllow: 1 });   // [B3223]
  }
  return null;
}
/** dice of the attacker's roll that the vehicle adds: Maneuverability on a ram [B3148] */
export function attackMods(v, inst) {
  if (inst.data?.kind !== "ram") return [];
  const p = profileOf(v, inst.actor);
  return p?.dice ? [{ source: "maneuverability", dice: p.dice }] : [];
}
/** base damage of a ram [B3148], else undefined */
export const attackBase = (v, inst) => (inst.data?.kind === "ram" ? profileOf(v, inst.actor)?.damage : undefined);
/** how the defence is asked: the charge or ram that ends a chase cannot be blocked [B3434] */
export const defenceOf = (v, inst, kind) => ({ attack: inst.data?.chaseCatch && kind !== "ram" ? "charge" : kind, inChase: v.state.kind === "chase" && (kind === "ram" || !!inst.data?.chaseCatch) });

/** A hit that did damage to a vehicle. `dm` = the attack's damage record ({ taken, healthBefore }). -> true when the step has to wait. */
export function afterHit(v, I, R, t, dm) {
  const tf = v.facts.c(t);
  if (tf?.kind !== "vehicle" || !dm || !(dm.taken > 0)) return false;
  const once = (k) => { if (K.flag(I, k)) return false; K.setFlag(I, k); return true; };
  const rec = vehOf(v.state, t), people = occupants(v.state, t).filter((c) => v.facts.c(c) && v.facts.c(c).present !== false);
  const hurt = (who, tag) => { if (!who.length || !once(tag)) return false; R.push = hazardChild(who, { kind: "fixed", amount: dm.taken, armor: false, source: "kinetic", cause: "hazard", id: "vehicle" }); return true; };   // "the damage inflicted on the vehicle"; the person's own Armor is the GM's tick [OQ-11]
  const st = ((I.data.veh ??= {})[t] ??= (() => { const h = vehicles.vehicleHit({ durability: dm.healthBefore, max: tf.maxHealth ?? dm.healthBefore, armor: 0, amount: dm.taken, componentHits: rec.hits ?? 0 }); return { component: h.component, wrecked: h.wrecked, n: 0 }; })());   // [B3221], [B3222]
  if (st.component && !st.entry) {
    for (let guard = 0; guard < 8 && !st.entry; guard++) {
      const key = `comp:${t}:${st.n}`, face = I.data.res?.[key]?.[0];
      if (face == null) { if (once(key)) R.effects.push({ t: "dice", key, n: 1 }); R.wait = true; return true; }
      const e = vehicles.componentDamage(Math.max(1, Math.min(6, face)), { passengers: rec.crew.length, weapons: tf.vehicle?.weapons ?? 0 });      // [B3224-3244]
      if (e.reroll && st.n < 6) { st.n++; continue; }
      st.entry = e.id; st.d6 = face;
    }
    R.effects.push({ t: "state", path: ["vehicles", t, "hits"], to: (rec.hits ?? 0) + 1 });
    R.events.push({ type: "vehicle", vehicle: t, state: "component", component: st.entry, d6: st.d6 });
  }
  switch (st.entry) {
    case "pilotHit": if (rec.driver && hurt([rec.driver].filter((c) => people.includes(c)), `occ:${t}:pilot`)) return true; break;
    case "passengerHit": {
      const crew = rec.crew.filter((c) => people.includes(c));
      if (!crew.length) break;
      const key = `pass:${t}`, face = I.data.res?.[key]?.[0];
      if (face == null) { if (once(key)) R.effects.push({ t: "dice", key, n: 1 }); R.wait = true; return true; }
      if (hurt([crew[(face - 1) % crew.length]], `occ:${t}:pass`)) return true;
      break;
    }
    case "severeSpin": {                                                                         // the operator's AGILITY roll, no action; a failure wrecks the vehicle
      if (!rec.driver || !people.includes(rec.driver)) { if (once(`spin:${t}:none`)) st.wrecked = true; break; }
      const key = `spin:${t}`;
      if (!K.rollOf(I, key)) { const m = tf.vehicle?.maneuver ? [{ source: "maneuverability", dice: tf.vehicle.maneuver }] : []; R.effects.push(K.rollEffect(key, rec.driver, "agility", K.buildPool(v, I, key, rec.driver, "agility", m, {}).pool, { passive: true, label: "ITAC.roll.spin" })); R.wait = true; return true; }   // [B2940], [A-2]
      if (!K.rollFinal(I, key)) { R.wait = true; return true; }
      if (once(`${key}:read`) && !(K.sixesOf(I, key) > 0)) st.wrecked = true;
      break;
    }
    case "weaponDisabled": if (once(`off:${t}:weapon`)) R.effects.push({ t: "state", path: ["vehicles", t, "off", "weapon"], to: 1 }); break;
    case "engineDisabled": if (once(`off:${t}:engine`)) { R.effects.push({ t: "state", path: ["vehicles", t, "off", "engine"], to: 1 }, { t: "state", path: ["vehicles", t, "started"], to: null }); if (tf.vehicle?.type === "aerial") (I.data.notes ??= []).push({ note: "controlledLanding", target: t }); } break;
    case "fuelExplosion":
      st.wrecked = true; st.destroyed = true;
      if (hurt(people, `occ:${t}:all`)) return true;
      if (people.length && once(`fuel:${t}`)) { R.push = hazardChild(people, { kind: "fire", intensity: 9, inZone: false, id: "fuel", cause: "hazard" }); return true; }
      break;
    default: break;
  }
  if (st.wrecked) {
    if (once(`wreck:${t}`)) {
      R.effects.push({ t: "state", path: ["vehicles", t, "wrecked"], to: 1 }, { t: "state", path: ["vehicles", t, "started"], to: null });
      if (st.destroyed) { R.effects.push({ t: "state", path: ["vehicles", t, "destroyed"], to: 1 }); if (v.facts.c(t)?.health > 0) R.effects.push({ t: "actor", who: t, path: "health", to: 0 }); }
      R.events.push({ type: "vehicle", vehicle: t, state: st.destroyed ? "destroyed" : "wrecked" });
    }
    if (I.data.kind === "ram" && st.entry !== "fuelExplosion" && vehicles.ramOccupantDamage({ wrecked: true, taken: dm.taken }) > 0 && hurt(people, `occ:${t}:ram`)) return true;   // [B3223]
    const place = v.facts.zones?.place?.(t) ?? null;
    if (vehicles.crashFallDice({ type: tf.vehicle?.type, alt: place?.area ?? place?.level ?? "ground", wrecked: true }) > 0) {      // [B3248]
      for (const who of [t, ...people]) if (once(`crash:${who}`)) { R.push = fallChild(who, { immune: false }); return true; }
    } else if (!v.facts.zones && ["aerial", "space"].includes(tf.vehicle?.type) && once(`crashNote:${t}`)) (I.data.notes ??= []).push({ note: "crashByHand", target: t });
  }
  return false;
}
