/* Tactical combat, package P3: the MOVEMENT flows (spec 9.6, 7; zones contract: moinen-maps dev/zones-api.md section 14). NO Foundry globals.
   move      a declared move: priced by the rules library (movement-pure.priceMove), paid at the declaration [OQ-20], then travelled
             in STRETCHES. One stretch is one call of the map's `move`; the map asks the step listener before every step and the
             listener only says "stop here, because ..." (movement-pure.stepVerdict). The flow settles the reason (a roll, a hazard,
             a GM card) and sends the rest of the route as the next stretch. Every stretch journals the map's own inverse in the
             instance's transaction, so one undo puts every mover back and takes every roll, wound and breach with it.
   fastball  the Fastball Special [B2390]: the thrown character travels like a mover, the thrower pays.
   barrier   a door as an action of its own: open, break a locked one, work an electronic lock [B2418].
   forced    Knockback and Slam [B2435], [B2494] as a SERVICE for other flows and for the GM: a straight chain from the map, the GM's
             confirmation card (spec 9.5 step 6), barriers one at a time (rules/zones.forcedMove), an optional fall [A7].
   fall      [B2391]: dice by altitude, the AGILITY roll that costs no action, damage as a hazard child, the landing.
   The stretch machinery (`travel`) is shared by move, fastball and forced; `I.data.mv` is its record:
     { who, kind, mode, zones, left, end, to, profile, group, seg, cleared, force, forced, barriers, stop, put } */
import { zones, hazards, maneuvers, movement } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";
import * as ZP from "../zones-pure.mjs";
import * as MP from "../movement-pure.mjs";
import * as K from "./kit.mjs";

const bad = (reason, params = {}) => ({ ok: false, reason, params });
const fine = { ok: true, reason: null, params: {}, gates: [], notes: [] };
const blank = { helpers: [], exploits: [], stressTotal: 0 };
const alive = (v, cid) => { const c = v.facts.c(cid); return !!c && c.present !== false && c.health > 0; };

/* ------------------------------------------------------------------ children the movement flows push (one transaction with the parent) */
export const hazardChild = (targets, hazard) => ({ action: "hazard", flow: "hazard", actor: null, decl: { ...blank, action: "hazard", targets }, data: { hazard }, initiator: { type: "hazard", id: String(hazard.id ?? hazard.kind) }, cause: "trigger", part: 1 });
/** A forced move of `who` for another flow (Knockback, Slam, a power): push this as a child. f = { awayFrom | toward: cid or spot, direction?, distance, damage, by, kind } */
export const forcedChild = (who, f) => ({ action: "forcedMove", flow: "forced", actor: null, decl: { ...blank, action: "forcedMove", targets: [who] }, data: { forced: { ...f, who } }, initiator: { type: "hazard", id: String(f.kind ?? "forced") }, cause: "trigger", part: 1 });
export const fallChild = (who, f = {}) => ({ action: "fall", flow: "fall", actor: null, decl: { ...blank, action: "fall", targets: [who] }, data: { fall: { ...f, who } }, initiator: { type: "hazard", id: "fall" }, cause: "trigger", part: 1 });
/** The move a dodge earns [B2526]: up to `n` zones, no cost. */
export const freeMoveChild = (who, to, mode, n) => ({ action: "move", actor: who, decl: { ...blank, action: "move", targets: [], to, ...(mode ? { mode } : {}) }, data: { free: n }, cause: "reaction", part: 1 });

/* ------------------------------------------------------------------ entering a spot: fire, a waiting trigger, a condition met on the way */
/** -> "wait" | "go" | "stop". Marks the spot as settled in mv.cleared. */
function enterGate(v, I, R, spot) {
  const mv = I.data.mv, Z = v.facts.zones, f = MP.stateFlags(Z.states(spot), mv.who);
  if (f.fire > 0 && !K.flag(I, `fire:${spot}`)) {                                              // [B2925]: a fire attack on everyone who enters
    K.setFlag(I, `fire:${spot}`);
    const targets = [mv.who, ...(mv.group ?? [])].filter((c) => alive(v, c));
    if (targets.length) { R.push = hazardChild(targets, { kind: "fire", intensity: f.fire, inZone: true, id: "fire", zone: spot, cause: "enter" }); return "wait"; }
  }
  const why = [];
  if (!mv.forced && (f.storm || f.highGravity) && spot !== mv.zones?.[0]) why.push(f.storm ? "storm" : "highGravity");       // [LR-18]: the zone left decides the cost; what a zone entered does is the GM's word
  if ((v.state.triggers ?? []).some((t) => t.at === "zoneEnter" && (t.subject?.zone === spot || t.subject?.zone === String(spot).split(":")[0]))) why.push("trigger");   // [B2876], [B2845]
  if (why.length) {
    const key = `stopAsk:${spot}`;
    if (!I.data.pk?.[key]) { R.prompts.push({ key, kind: "moveStop", to: "gm", about: mv.who, options: [{ id: "continue", label: "ITAC.opt.continue" }, { id: "stop", label: "ITAC.opt.stopHere" }], data: { spot, why } }); return "wait"; }
    if (!K.isAnswered(v, I, key)) return "wait";
    if (K.answerId(v, I, key) === "stop") { mv.stop = why[0]; return "stop"; }
  }
  (mv.cleared ??= {})[`enter:${spot}`] = 1;
  if (!alive(v, mv.who)) { mv.stop = "broken"; return "stop"; }                                  // [B2707]
  return "go";
}
/** One reason the map stopped a stretch for. -> "wait" | "go" | "stop" */
function gate(v, I, R, g) {
  const mv = I.data.mv, Z = v.facts.zones, c = v.facts.c(mv.who), d = g.data ?? {};
  if (g.reason === "ipu.enter") return enterGate(v, I, R, d.spot);
  if (g.reason === "ipu.dark") {                                                                 // [B1654]: an AGILITY roll, no action, to find the way out
    const key = `dark:${d.spot}`;
    /* S073: a driven vehicle is steered out by its driver: the driver's AGILITY with the vehicle's Maneuverability [B2940], as for a spin */
    const roller = mv.driver ?? mv.who, man = mv.driver ? Number(v.facts.c(mv.who)?.vehicle?.maneuver) || 0 : 0, mods = man ? [{ source: "maneuverability", dice: man }] : [];
    if (mv.driver && Z?.states && !MP.stateFlags(Z.states(d.spot), mv.driver).dark) { (mv.cleared ??= {})[key] = 1; return "go"; }      // the driver made it: "never affected by your own darkness"
    if (!K.rollOf(I, key)) { R.effects.push(K.rollEffect(key, roller, "agility", K.buildPool(v, I, key, roller, "agility", mods, {}).pool, { passive: true, label: "ITAC.roll.dark" })); return "wait"; }
    if (!K.rollFinal(I, key)) return "wait";
    if (K.sixesOf(I, key) > 0) { (mv.cleared ??= {})[key] = 1; return "go"; }
    mv.stop = "dark"; return "stop";                                                             // provisional: the move ends in the dark, the action is spent
  }
  if (g.reason === "ipu.barrier") {                                                              // [B2419]: crashing through as part of the move
    const b = (mv.barriers ?? []).find((x) => x.border === d.border) ?? MP.barrierOf(Z.border(d.border)), key = `bar:${d.border}`;
    if (!K.rollOf(I, key)) { I.locked = true; R.effects.push(K.rollEffect(key, mv.who, "strength", K.buildPool(v, I, key, mv.who, "strength", [], {}).pool, { label: "ITAC.roll.bar" })); return "wait"; }
    if (!K.rollFinal(I, key)) return "wait";
    const out = zones.breachOutcome({ strength: c?.attrs?.strength ?? 0, armor: b.armor, sixes: K.sixesOf(I, key), crashing: true });   // [B2418], [B2419]
    if (out.breached) {
      if (!K.flag(I, key)) { K.setFlag(I, key); const op = ZP.borderOp(d.border, b.element === "door" ? { door: { state: "breached" } } : { wall: { state: "breached" } }); R.effects.push({ t: "zones", op }); R.events.push({ type: "zoneChange", ...ZP.changeOf(op), cause: "crash", by: mv.who }); }
      (mv.cleared ??= {})[key] = 1; return "go";
    }
    if (out.damage > 0 && !K.flag(I, `crash:${d.border}`)) {                                     // stopped at the barrier, damage = its Armor; the mover's Armor does not reduce it [OQ-11] (the GM may change the number)
      K.setFlag(I, `crash:${d.border}`);
      R.push = hazardChild([mv.who], { kind: "fixed", amount: out.damage, armor: false, source: "kinetic", cause: "barrier", id: "barrier" }); return "wait";
    }
    mv.stop = "barrier"; return "stop";
  }
  if (g.reason === "ipu.hit") {                                                                  // [B2435]: thrown into a barrier
    const F = I.data.forced ?? {}, key = `hit:${d.border}`, b = MP.barrierOf(Z.border(d.border), "wall");
    const seen = (mv.hitLog ?? []).find((h) => h.border === d.border);                           // on the way back from the barrier's damage the verdict of the first visit stands
    const raw = seen ? seen.raw : Math.max(0, (F.damage ?? 0) - (F.decay ?? 1) * (mv.hits ?? 0)), through = seen ? seen.through : b.armor < raw;          // the same reading as rules/zones.forcedMove: each barrier takes `decay` off (Knockback 1 [B2435], Slam 0 [B2494]), a barrier with Armor below the rest gives way
    if (!K.flag(I, key)) {
      K.setFlag(I, key); mv.hits = (mv.hits ?? 0) + 1; (mv.hitLog ??= []).push({ border: d.border, armor: b.armor, raw, through });
      if (through) { const op = ZP.borderOp(d.border, { wall: { state: "breached" } }); R.effects.push({ t: "zones", op }); R.events.push({ type: "zoneChange", ...ZP.changeOf(op), cause: "forced" }); }
      if (raw > 0 && alive(v, mv.who)) { R.push = hazardChild([mv.who], { kind: "fixed", amount: raw, armor: F.armor === true, source: "kinetic", cause: "barrier", id: "barrier" }); return "wait"; }      // [B2435], [B2494], [R8]: a stunt's barrier damage is reduced by the target's Armor
    }
    if (through) { (mv.cleared ??= {})[`bar:${d.border}`] = 1; return "go"; }
    mv.stop = "barrier"; return "stop";
  }
  if (g.reason === "ipu.slab") {                                                                 // thrown up or down into a floor or the roof [B2435]
    /* The map holds no Armor for a floor or a roof, so the engine cannot say by itself whether it gives way: the thrown character takes
       the barrier's damage as from a wall (the throw's number, less `decay` per barrier already hit, reduced by Armor for a stunt [R8])
       and the GM says whether it goes through (provisional, combat-questions INT-2). */
    const F = I.data.forced ?? {}, key = `slab:${d.spot}`, ask = `slabAsk:${d.spot}`;
    const seen = (mv.hitLog ?? []).find((h) => h.slab && h.spot === d.spot), raw = seen ? seen.raw : Math.max(0, (F.damage ?? 0) - (F.decay ?? 1) * (mv.hits ?? 0));
    if (!K.flag(I, key)) {
      K.setFlag(I, key); mv.hits = (mv.hits ?? 0) + 1; (mv.hitLog ??= []).push({ slab: d.slab, spot: d.spot, raw });
      if (raw > 0 && alive(v, mv.who)) { R.push = hazardChild([mv.who], { kind: "fixed", amount: raw, armor: F.armor === true, source: "kinetic", cause: "barrier", id: "barrier" }); return "wait"; }
    }
    if (!I.data.pk?.[ask]) { R.prompts.push({ key: ask, kind: "moveStop", to: "gm", about: mv.who, options: [{ id: "continue", label: "ITAC.opt.breakThrough" }, { id: "stop", label: "ITAC.opt.stopHere" }], data: { spot: d.spot, slab: d.slab, why: [d.slab] } }); return "wait"; }
    if (!K.isAnswered(v, I, ask)) return "wait";
    if (K.answerId(v, I, ask) === "stop") { mv.stop = "barrier"; return "stop"; }
    (mv.cleared ??= {})[key] = 1; return "go";
  }
  mv.stop = String(g.reason ?? "blocked").slice(0, 24); return "stop";                           // the map's own "blocked", another module's listener
}
/** The stretches of a route. Returns true when the travelling is over (R.goto is the caller's). */
export function travel(v, I, R) {
  const mv = I.data.mv;
  if (mv.kind === "inZone" || mv.stop) return true;
  if (mv.put) {                                                                                  // an arrival nobody is asked about: a teleport [B2034], sky high and orbit [B2387-2388], the return [R16]
    const res = I.data.res?.put;
    if (!res) { R.effects.push({ t: "zput", key: "put", who: mv.who, to: mv.put, group: mv.group ?? [] }); R.wait = true; return false; }
    if (res.ok === false) mv.stop = String(res.reason ?? "blocked").slice(0, 24);
    return true;
  }
  for (let guard = 0; guard < 40; guard++) {
    const key = `seg:${mv.seg ?? 0}`, res = I.data.res?.[key];
    if (!res) {
      R.effects.push({ t: "zmove", key, who: mv.who, zones: mv.left ?? mv.zones, end: mv.end, profile: mv.profile, group: mv.group ?? [], forced: !!mv.forced,
        data: { inst: I.id, mover: mv.who, cleared: mv.cleared ?? {}, force: mv.force ? 1 : 0, forced: mv.forced ? 1 : 0, cond: 1,
          trig: (v.state.triggers ?? []).filter((t) => t.at === "zoneEnter" && t.subject?.zone).map((t) => t.subject.zone).slice(0, 24) } });
      R.wait = true; return false;
    }
    if (res.ok === false) { mv.stop = String(res.reason ?? "blocked").slice(0, 24); return true; }
    mv.at = res.spot ?? mv.at;
    if (!res.stop) return true;
    const g = gate(v, I, R, res.stop);
    if (g === "wait") { R.wait = true; return false; }
    if (g === "stop") return true;
    mv.left = res.left ?? []; mv.seg = (mv.seg ?? 0) + 1;
    if (mv.left.length < 1) return true;
  }
  mv.stop = "tooManyStops"; return true;
}
export const moveEvent = (I, type = "move") => { const mv = I.data.mv; return { type, combatant: mv.who, from: mv.from, to: mv.at ?? mv.to, planned: mv.to, mode: mv.mode ?? null, zones: mv.total ?? 0, stopped: mv.stop ?? null, group: mv.group ?? [] }; };

/* ------------------------------------------------------------------ move */
const optsOf = (v, inst) => ({ free: inst.data?.free, prepaid: inst.cause === "interrupt" || inst.data?.prepaid === true, mode: v.entry(inst)?.move?.mode, charging: inst.data?.charging === true });
const priced = (v, inst) => (v.facts.zones ? MP.priceMove(v.facts.zones, v.state, inst.actor, v.facts.c(inst.actor), inst.decl ?? {}, optsOf(v, inst)) : { ok: false, reason: "noZones", params: {}, gmMayAllow: true });
export const move = {
  STEPS: Object.freeze(["check", "start", "travel", "arrive", "close"]),
  legality(v, inst) {
    if (!inst.data?.free && M.statusesOf(v.state, inst.actor).some((s) => s.id === "inVehicle")) return bad("inVehicle", { gmMayAllow: 1 });   // P7 [B2325-2332]: aboard a vehicle one gets out first; the vehicle moves by being handled
    if (!inst.data?.free && M.counterGet(v.state, M.counterKey.round(inst.actor, "firedNoMove")) > 0) return bad("firedNoMove", { gmMayAllow: 1 });   // [B2545]: a "no movement" weapon was fired this round (flows/attack.mjs FIRED_NO_MOVE)
    const pr = priced(v, inst);
    if (!pr.ok) return bad(pr.reason, { ...pr.params, ...(pr.gmMayAllow ? { gmMayAllow: 1 } : {}) });
    /* [B2392]: one carries a character who goes along; somebody of the other side is not carried but grappled and pulled [B2497]. Whether
       an ally agrees is settled at the table [A34]; anybody else is the GM's word. */
    const me = v.facts.c(inst.actor);
    for (const x of Array.isArray(inst.decl?.carry) ? inst.decl.carry : []) { const o = v.facts.c(x); if (o && o.present !== false && !!o.npc !== !!me?.npc) return bad("carryUnwilling", { who: x, gmMayAllow: 1 }); }
    if (pr.kind === "inZone" && pr.cost === "free" && !P1.isOnTurn(v.state, inst.actor)) return bad("notYourTurn", { gmMayAllow: 1 });   // [L6] [B2383]
    if (pr.later && pr.later !== "none" && pr.later !== "gm" && !P1.canPay(v.state, inst.actor, pr.later, { resolve: me?.resolve }).ok) return bad("noAction");
    return fine;
  },
  /** what the declaration costs (engine-pure opDeclare): the action the rules library named, the facts of the ledger entry */
  price(v, inst) {
    const pr = priced(v, inst);
    if (!pr.ok) return null;
    return pr.kind === "inZone" ? { cost: pr.cost, tags: ["moveInZone", "ownTurnOnly"], zoneFrom: pr.from, zoneTo: pr.to } : { cost: pr.cost, tags: ["move"], zoneFrom: pr.from, zoneTo: pr.to, borders: pr.total };
  },
  revalidate(v, inst) { const b = K.actorBlocked(v, inst) ?? (inst.step === "check" || inst.step === "start" ? MP.cannotMove(v.state, inst.actor, v.facts.c(inst.actor)) : null); return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) {
      const I = K.draft(inst), R = K.result(I);
      if (!I.data.mv) {
        const pr = priced(v, I);
        if (!pr.ok) {                                                                            // declared through a granted exception (spec 9.12): the engine does not guess a route
          if (I.decl.exception?.state === "granted") { I.status = "manual"; (I.data.notes ??= []).push({ note: "moveByHand", reason: pr.reason }); R.wait = true; return R; }
          I.data.result = "illegal"; R.goto = "close"; return R;
        }
        const put = pr.kind === "area" || pr.kind === "return" || pr.teleport ? (pr.end.area ? `@${pr.end.area}` : pr.to) : null;
        I.data.mv = { who: I.actor, kind: pr.kind, mode: pr.mode, from: pr.from, to: pr.to, zones: pr.zones, end: pr.end, profile: pr.profile, total: pr.total, group: [...pr.carry, ...pr.pulled], carry: pr.carry,
          barriers: pr.barriers, force: pr.barriers.length ? 1 : 0, roll: pr.roll, later: pr.later ?? null, gm: pr.gm ?? 0, stress: pr.stress, notes: pr.notes, seg: 0, cleared: { [`enter:${pr.from}`]: 1 }, ...(put ? { put } : {}) };
        if (pr.stress > 0) R.effects.push({ t: "stress", who: I.actor, n: pr.stress, cost: 1 });  // the stress option of a movement power [B1999-2037], Teleport Allies [B2038]
      }
      const mv = I.data.mv;
      if (mv.gm || mv.later === "gm") {                                                          // [R16] the return is the GM's to approve; [LR-21] other areas are the GM's word
        if (!I.data.pk?.approve) { R.prompts.push({ key: "approve", kind: "moveApprove", to: "gm", about: I.actor, options: [{ id: "approve", label: "ITAC.opt.approve" }, { id: "refuse", label: "ITAC.opt.refuse" }], data: { from: mv.from, to: mv.to, cost: mv.later } }); R.wait = true; return R; }
        if (!K.isAnswered(v, I, "approve")) { R.wait = true; return R; }
        if (K.answerId(v, I, "approve") !== "approve") { mv.stop = "refused"; I.data.result = "refused"; R.goto = "close"; return R; }
      }
      if ((mv.later === "full" || mv.later === "quick") && !K.flag(I, "late")) { K.setFlag(I, "late"); R.effects.push({ t: "pay", who: I.actor, cost: mv.later, action: I.action, key: "late", own: 1, tags: ["move"], zoneFrom: mv.from, zoneTo: mv.to }); }   // [B2387-2388]
      R.goto = "start"; return R;
    },
    start(v, inst) {
      const I = K.draft(inst), R = K.result(I), mv = I.data.mv;
      if (mv.roll) {                                                                             // [B1841] storm, [B1704] high gravity: STRENGTH; [B1703] low gravity: AGILITY
        if (!K.rollOf(I, "start")) { I.locked = true; R.events.push({ type: "actionLocked" }); R.effects.push(K.rollEffect("start", I.actor, mv.roll, K.buildPool(v, I, "start", I.actor, mv.roll, [], {}).pool, { label: "ITAC.roll.start" })); R.wait = true; return R; }
        if (!K.rollFinal(I, "start")) { R.wait = true; return R; }
        if (!(K.sixesOf(I, "start") > 0)) mv.stop = "rollFailed";                                // provisional: no move, the action is spent
      }
      I.locked = true; R.goto = "travel"; return R;
    },
    travel(v, inst) { const I = K.draft(inst), R = K.result(I); if (travel(v, I, R)) R.goto = "arrive"; return R; },
    arrive(v, inst) {
      const I = K.draft(inst), R = K.result(I), mv = I.data.mv, Z = v.facts.zones, here = Z.place(mv.who);
      mv.at = here?.spot ?? mv.at ?? mv.from;
      if (!mv.stop && mv.kind !== "inZone" && here && !here.area && !mv.cleared?.[`enter:${here.spot}`]) { const g = enterGate(v, I, R, here.spot); if (g === "wait") { R.wait = true; return R; } }
      if (mv.carry?.length && !K.flag(I, "carry")) {                                             // [B2392]: carried aloft until they land
        K.setFlag(I, "carry");
        const aloft = maneuvers.carryEndsAloft(here?.level) && here?.airborne === true;
        for (const [cid, id] of [[mv.who, "carrying"], ...mv.carry.map((x) => [x, "carried"]), ...[mv.who, ...mv.carry].map((x) => [x, "airborne"])]) {
          if (aloft && !M.hasStatus(v.state, cid, id)) R.effects.push({ t: "status+", who: cid, status: { id, source: { kind: "action", owner: mv.who, name: "carry" }, ...(id === "airborne" ? {} : { data: cid === mv.who ? { held: mv.carry[0] } : { by: mv.who } }) } });
          if (!aloft && M.hasStatus(v.state, cid, id)) R.effects.push({ t: "status-", who: cid, id });
        }
      }
      if (!K.flag(I, "links")) { K.setFlag(I, "links"); for (const e of K.separated(v, [mv.who, ...(mv.group ?? [])])) if (!R.effects.some((x) => x.t === e.t && x.who === e.who && x.id === e.id && String(x.path) === String(e.path))) R.effects.push(e); }   // [B2497], [B2392]: who left its pair behind is no longer of it
      if (I.decl.wreck && mv.mode === "burrowing" && !K.flag(I, "wreck")) { K.setFlag(I, "wreck"); burrowWreck(v, I, R, here); }      // PWE (PW095) [B1995]
      R.events.push(moveEvent(I));
      I.data.result = mv.stop ? "stopped" : "done"; R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};

/* PWE (PW095) [B1995]: a burrower may wreck the zones it passes under (their buildings come down): the declaration's `wreck` on a
   burrowing move wrecks every zone the move went under (not the one it started from), each one once; no STRENGTH is asked (the attack's
   wreck [B2451-2457] is a blow, this is the power). Who stood on a levelled rooftop is the GM's word, as after a wrecking blow. */
function burrowWreck(v, I, R, here) {
  const Z = v.facts.zones, keys = (I.data.mv.zones ?? []).slice(1), upto = here?.zone ? keys.indexOf(here.zone) : -1;
  for (const key of upto >= 0 ? keys.slice(0, upto + 1) : []) {
    if (Z?.zone?.(key)?.states?.wrecked || M.counterGet(v.state, M.counterKey.zone(key, "wrecked")) > 0) continue;
    const op = ZP.zoneOp(key, { wrecked: true }), cw = M.counterBump(v.state, M.counterKey.zone(key, "wrecked"));
    if (op) { R.effects.push({ t: "zones", op }); R.events.push({ type: "zoneChange", ...ZP.changeOf(op), cause: "wreck", by: I.actor }); }
    R.effects.push({ t: "state", path: cw.path, to: cw.to });
    if (!v.facts.c(I.actor)?.npc) R.effects.push({ t: "karma", note: { who: I.actor, kind: "wreckedZone", zone: key } });     // spec 9.11
    if (Z?.zone?.(key)?.rooftop) (I.data.notes ??= []).push({ note: "rooftopLevelled", zone: key });
  }
}
/* ------------------------------------------------------------------ Fastball Special [B2389-2390] */
function fastballPlan(v, inst) {
  const Z = v.facts.zones, a = v.facts.c(inst.actor), t = inst.decl?.targets?.[0], tf = t ? v.facts.c(t) : null;
  if (!Z) return { ok: false, reason: "noZones", gmMayAllow: 1 };
  if (!a || a.health <= 0) return { ok: false, reason: "broken" };
  if (!tf || tf.present === false) return { ok: false, reason: "noTarget" };
  const from = Z.place(inst.actor), tp = Z.place(t), want = typeof inst.decl.to === "string" ? Z.placeOf(inst.decl.to) : null;
  if (!from || !tp || from.spot !== tp.spot) return { ok: false, reason: "carryZone" };
  if (!want || want.area) return { ok: false, reason: "noZone" };
  const fc = maneuvers.fastballCheck({ throwerStrength: a.attrs?.strength ?? 0, thrownStrength: tf.attrs?.strength ?? 0, friendly: true });   // who is friendly is the table's word [D]
  if (!fc.ok) return { ok: false, reason: fc.reason === "strength" ? "tooWeak" : fc.reason };
  const profile = { way: "flight", speed: fc.zones, actions: 1 }, end = { zone: want.zone, level: want.level, floor: want.floor, airborne: want.level === "elevated" && !Z.zone(want.zone)?.rooftop };
  const plan = Z.plan(t, end, profile);
  if (!plan) return { ok: false, reason: "noRoute", gmMayAllow: 1 };
  if (plan.total > fc.zones) return { ok: false, reason: "tooFar", params: { total: plan.total, max: fc.zones } };
  return { ok: true, who: t, from: tp.spot, to: want.spot, zones: plan.zones.slice(), end, profile, total: plan.total };
}
export const fastball = {
  STEPS: Object.freeze(["check", "travel", "arrive", "close"]),
  legality(v, inst) { const p = fastballPlan(v, inst); return p.ok ? fine : bad(p.reason, { ...(p.params ?? {}), ...(p.gmMayAllow ? { gmMayAllow: 1 } : {}) }); },
  revalidate(v, inst) { const b = K.actorBlocked(v, inst); return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) {
      const I = K.draft(inst), R = K.result(I), p = fastballPlan(v, I);
      if (!p.ok) { I.data.result = "illegal"; R.goto = "close"; return R; }
      I.locked = true;
      I.data.mv = { who: p.who, kind: "route", mode: "fastball", from: p.from, to: p.to, zones: p.zones, end: p.end, profile: p.profile, total: p.total, group: [], seg: 0, cleared: { [`enter:${p.from}`]: 1 } };
      R.goto = "travel"; return R;
    },
    travel(v, inst) { const I = K.draft(inst), R = K.result(I); if (travel(v, I, R)) R.goto = "arrive"; return R; },
    arrive(v, inst) {
      const I = K.draft(inst), R = K.result(I), mv = I.data.mv, here = v.facts.zones.place(mv.who);
      mv.at = here?.spot ?? mv.at ?? mv.from;
      if (!mv.stop && here && !mv.cleared?.[`enter:${here.spot}`]) { const g = enterGate(v, I, R, here.spot); if (g === "wait") { R.wait = true; return R; } }
      for (const e of K.separated(v, [mv.who])) R.effects.push(e);                               // thrown out of a grapple or a carry
      (I.data.notes ??= []).push({ note: "thrownMayCharge", who: mv.who });                     // [B2390]: the thrown character's charge is its own declaration
      R.events.push(moveEvent(I, "move")); I.data.result = mv.stop ? "stopped" : "done"; R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ a door as an action [B2418] */
const DOOR = Object.freeze({ openDoor: { from: ["closed"], to: "open", attr: null }, breachDoor: { from: ["locked"], to: "breached", attr: "strength" }, unseal: { from: ["sealed"], to: "open", attr: "reason" } });
function doorCheck(v, inst) {
  const Z = v.facts.zones, spec = DOOR[v.entry(inst)?.door ?? inst.action], a = v.facts.c(inst.actor), key = inst.decl?.to;
  if (!Z) return bad("noZones", { gmMayAllow: 1 });
  if (!a || a.present === false) return bad("gone");
  if (a.health <= 0) return bad("broken");
  const b = spec && ZP.isBorderKey(key) ? Z.border(key) : null, here = Z.place(inst.actor);
  if (!b || !b.doorway) return bad("noDoor");
  if (!here?.zone || !key.split("|").includes(here.zone)) return bad("notAtDoor");
  if (!spec.from.includes(b.doorway.state)) return bad("doorState", { state: b.doorway.state });
  if (spec.attr === "strength" && !zones.canBreach(a.attrs?.strength ?? 0, Number(b.doorway.armor ?? b.armor ?? 0))) return bad("tooWeak", { armor: b.doorway.armor ?? b.armor ?? 0, gmMayAllow: 1 });   // [Z7] [B2418]
  return fine;
}
/** The doors at the zone `cid` stands in, for the surfaces: -> [{ to: borderKey, zone: the zone behind it, state, armor,
    actions: { openDoor | breachDoor | unseal: null (possible) | reason } }]. The same reading as doorCheck. */
export function doorOptions(Z, c, cid) {
  const here = Z?.place?.(cid);
  if (!here?.zone || typeof Z.borders !== "function") return [];
  return (Z.borders(here.zone) ?? []).filter((b) => b?.doorway && typeof b.key === "string").map((b) => {
    const armor = Number(b.doorway.armor ?? b.armor ?? 0), state = String(b.doorway.state ?? "");
    return { to: b.key, zone: b.key.split("|").find((z) => z !== here.zone) ?? null, state, armor,
      actions: Object.fromEntries(Object.entries(DOOR).map(([id, s]) => [id, !s.from.includes(state) ? "doorState" : s.attr === "strength" && !zones.canBreach(c?.attrs?.strength ?? 0, armor) ? "tooWeak" : null])) };
  });
}
export const barrier = {
  STEPS: Object.freeze(["check", "roll", "effect", "close"]),
  legality: doorCheck,
  revalidate(v, inst) { const b = K.actorBlocked(v, inst); return { ok: !b, reasons: b ? [b] : [] }; },
  steps: {
    check(v, inst) { const I = K.draft(inst), R = K.result(I); R.goto = "roll"; return R; },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), spec = DOOR[v.entry(I)?.door ?? I.action];
      if (!spec?.attr) { R.goto = "effect"; return R; }                                         // an unlocked door needs no roll and no action [B2418]
      if (!K.rollOf(I, "roll")) { I.locked = true; R.events.push({ type: "actionLocked" }); R.effects.push(K.rollEffect("roll", I.actor, spec.attr, K.buildPool(v, I, "roll", I.actor, spec.attr, [], {}).pool, { label: v.entry(I)?.label })); R.wait = true; return R; }
      if (!K.rollFinal(I, "roll")) { R.wait = true; return R; }
      R.goto = "effect"; return R;
    },
    effect(v, inst) {
      const I = K.draft(inst), R = K.result(I), spec = DOOR[v.entry(I)?.door ?? I.action], okRoll = !spec?.attr || K.sixesOf(I, "roll") > 0;
      if (okRoll && spec) { const op = ZP.borderOp(I.decl.to, { door: { state: spec.to } }); R.effects.push({ t: "zones", op }); R.events.push({ type: "zoneChange", ...ZP.changeOf(op), cause: I.action, by: I.actor }); }
      I.data.result = okRoll ? "success" : "fail"; R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ forced movement [B2435], [B2494] */
/* FXV (CI4; decision: the attacker picks, the GM confirms OR CORRECTS). The GM's card of a forced move also offers every other zone within
   the distance (not straight up or down): picked on the map, the character is thrown along the map's own way there, as far as the throw
   goes. A corrected route does not fall by itself (see the questions, FXV-1); the GM's card of the drop stays the "and falls" of the chain. */
const OTHER_WAYS_MAX = 30;
function otherWays(v, mv, F) {
  const Z = v.facts.zones;
  if (mv.vertical || !mv.from || typeof Z?.within !== "function") return [];
  const start = String(mv.from).split(":")[0], end = mv.to ? String(mv.to).split(":")[0] : null, n = Math.max(1, Math.trunc(F?.distance) || 1);
  let near = []; try { near = Z.within(mv.from, n) ?? []; } catch { near = []; }
  return near.filter((r) => r?.zone && r.zone !== start && r.zone !== end && r.d >= 1 && r.d <= n).slice(0, OTHER_WAYS_MAX)
    .map((r) => ({ id: `to:${r.zone}`, label: "ITAC.opt.forcedTo", data: { to: r.zone, zone: r.zone, d: r.d } }));
}
/** the route of a forced move to `zone`, the GM's correction: the map's way there (walls crossed only where no other way is), as a throw.
    -> the fields of `mv` it changes | null */
function routeTo(v, mv, zone) {
  const Z = v.facts.zones, from = Z.place(mv.who);
  if (!from || from.area || !zone) return null;
  const way = Z.plan(mv.who, zone, { way: "walk", force: true, hover: false });
  if (!way?.zones?.length || way.zones[0] !== from.zone || way.zones.length < 2) return null;
  const end = { level: from.level === "elevated" ? "elevated" : from.level ?? "ground", floor: from.floor ?? null, airborne: from.level === "elevated" ? !!from.airborne : false };
  const p = (typeof Z.along === "function" ? Z.along(mv.who, way.zones, { forced: true, end }) : null) ?? way;
  const last = p.steps?.length ? p.steps[p.steps.length - 1] : null, at = last?.to ? Z.place(last.to) : p.end ?? null;
  return { zones: p.zones.slice(), to: at?.spot ?? zone, end: at ? { level: at.level, floor: at.floor, airborne: at.airborne } : null, total: p.total ?? p.zones.length - 1,
    walls: (p.steps ?? []).filter((s) => s.border?.blocked).map((s) => MP.barrierOf(s.border, "wall")) };
}
export const forced = {
  STEPS: Object.freeze(["check", "confirm", "travel", "land", "close"]),
  legality(v, inst) { const F = inst.data?.forced; return !F || !v.facts.c(F.who) ? bad("noTarget") : !v.facts.zones ? bad("noZones", { gmMayAllow: 1 }) : fine; },
  revalidate() { return { ok: true, reasons: [] }; },
  steps: {
    check(v, inst) {
      const I = K.draft(inst), R = K.result(I), F = I.data.forced, Z = v.facts.zones, from = Z.place(F.who);
      const vert = F.direction === "up" || F.direction === "down" ? F.direction : null;       // straight up or down: the levels of the zone the character is in (zones-api.md section 14)
      const chain = from && !from.area ? Z.chain(F.who, { ...(vert ? {} : { awayFrom: F.awayFrom, toward: F.toward }), direction: F.direction, distance: Math.max(1, Math.trunc(F.distance) || 1) }) : null;
      I.locked = true;
      I.data.mv = { who: F.who, kind: "route", mode: F.kind ?? "forced", forced: 1, from: from?.spot ?? null, to: chain?.end?.spot ?? null, zones: chain?.zones?.slice() ?? [], end: chain?.end ? { level: chain.end.level, floor: chain.end.floor, airborne: chain.end.airborne } : null,
        total: chain?.total ?? 0, edge: chain?.ray?.end === "edge" ? 1 : 0, walls: (chain?.steps ?? []).filter((s) => s.border?.blocked).map((s) => MP.barrierOf(s.border, "wall")), group: [], seg: 0, cleared: from ? { [`enter:${from.spot}`]: 1 } : {},
        ...(vert ? { vertical: vert, slabs: (chain?.steps ?? []).map((s) => s.slab).filter((s) => s === "floor" || s === "roof") } : {}) };
      R.goto = "confirm"; return R;
    },
    /* spec 9.5 step 6: the GM confirms where a thrown character goes. [A7]: whether it then falls is the GM's word on the same card. */
    confirm(v, inst) {
      const I = K.draft(inst), R = K.result(I), mv = I.data.mv, can = mv.vertical ? mv.total > 0 : mv.zones.length > 1;
      /* FXP (U181): the GM named the direction of an NPC's knockback on its card already; a path with nothing more to decide (the whole
         distance on the map, no wall on it, ending on the ground: no fall to weigh [A7]) then goes without a second card. The edge of the
         map, a wall, a drop, a vertical throw, and a hero's knockback (the GM's confirmation of the player's word, spec 9.5 step 6) still ask. */
      const plain = can && I.data.forced?.gmDir === 1 && !mv.vertical && !mv.edge && !(mv.walls ?? []).length && !!mv.end && !mv.end.airborne && (mv.end.level == null || mv.end.level === "ground");
      if (plain && !I.data.pk?.dir) { mv.fall = 0; R.goto = "travel"; return R; }
      if (!I.data.pk?.dir) {
        R.prompts.push({ key: "dir", kind: "direction", to: "gm", about: mv.who, options: [...otherWays(v, mv, I.data.forced), { id: "go", label: "ITAC.opt.forcedGo", ...(can ? {} : { disabled: "noRoute" }) }, { id: "goFall", label: "ITAC.opt.forcedGoFall", ...(can ? {} : { disabled: "noRoute" }) }, { id: "none", label: "ITAC.opt.forcedNone" }],
          data: { who: mv.who, by: I.data.forced.by ?? null, kind: mv.mode, zones: mv.zones, to: mv.to, walls: mv.walls, edge: mv.edge, distance: I.data.forced.distance, ...(mv.vertical ? { vertical: mv.vertical, levels: mv.total, slabs: mv.slabs ?? [] } : {}) } });
        R.wait = true; return R;
      }
      if (!K.isAnswered(v, I, "dir")) { R.wait = true; return R; }
      const a = K.answerId(v, I, "dir");
      if (typeof a === "string" && a.startsWith("to:")) {                                       // FXV (CI4): the GM put the route right: the way to the zone picked on the map
        const r = routeTo(v, mv, a.slice(3));
        if (r) { Object.assign(mv, r, { fall: 0, edge: 0, corrected: 1 }); R.goto = "travel"; return R; }
        mv.stop = "gm"; R.goto = "close"; I.data.result = "none"; return R;                    // the map has no way there any more: nothing moves (the GM moves it by hand)
      }
      if (a === "none" || !can) { mv.stop = "gm"; R.goto = "close"; I.data.result = "none"; return R; }
      mv.fall = a === "goFall" ? 1 : 0; R.goto = "travel"; return R;
    },
    travel(v, inst) { const I = K.draft(inst), R = K.result(I); if (travel(v, I, R)) R.goto = "land"; return R; },
    land(v, inst) {
      const I = K.draft(inst), R = K.result(I), mv = I.data.mv, here = v.facts.zones.place(mv.who);
      mv.at = here?.spot ?? mv.at ?? mv.from;
      if (here && !here.area && !mv.cleared?.[`enter:${here.spot}`]) { const g = enterGate(v, I, R, here.spot); if (g === "wait") { R.wait = true; return R; } }
      if (!K.flag(I, "links")) {
        K.setFlag(I, "links");
        const vid = M.statusesOf(v.state, mv.who).find((s) => s.id === "inVehicle")?.data?.vehicle ?? null;
        for (const e of K.separated(v, [mv.who])) { R.effects.push(e); if (e.t === "status-" && e.id === "inVehicle" && e.who === mv.who && vid) mv.outOf = vid; }      // FXP (D165, U181): thrown out of a vehicle, told on the news line
      }      // [B2497], [B2392]: knocked or thrown away from the one it held, was held by, carried or was carried by
      if (mv.fall && !K.flag(I, "fall")) { K.setFlag(I, "fall"); R.push = fallChild(mv.who, {}); return R; }
      R.events.push(moveEvent(I, "forcedMove")); I.data.result = mv.stop === "barrier" ? "barrier" : "done"; R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};

/* ------------------------------------------------------------------ falling [B2391] */
export const fall = {
  STEPS: Object.freeze(["check", "roll", "land", "close"]),
  legality(v, inst) { const F = inst.data?.fall; return !F || !v.facts.c(F.who) ? bad("noTarget") : !v.facts.zones ? bad("noZones", { gmMayAllow: 1 }) : fine; },
  revalidate() { return { ok: true, reasons: [] }; },
  steps: {
    check(v, inst) {
      const I = K.draft(inst), R = K.result(I), F = I.data.fall, here = v.facts.zones.place(F.who);
      F.from = here?.area ?? here?.level ?? "ground"; F.spot = here?.spot ?? null; F.zone = here?.zone ?? null;
      F.n = hazards.fallDice(F.from);                                                           // [B2391]
      I.locked = true;
      if (!(F.n > 0)) { I.data.result = "noFall"; R.goto = "close"; return R; }
      R.goto = "roll"; return R;
    },
    roll(v, inst) {
      const I = K.draft(inst), R = K.result(I), F = I.data.fall;
      if (I.data.res?.fall == null) { if (!K.flag(I, "dice")) { K.setFlag(I, "dice"); R.effects.push({ t: "dice", key: "fall", n: F.n }); } R.wait = true; return R; }
      if (!F.immune && alive(v, F.who)) {                                                       // the AGILITY roll costs no action and is not pushed [B2391], [B2227]
        if (!K.rollOf(I, "agi")) { R.effects.push(K.rollEffect("agi", F.who, "agility", K.buildPool(v, I, "agi", F.who, "agility", [], {}).pool, { passive: true, label: "ITAC.roll.fall" })); R.wait = true; return R; }
        if (!K.rollFinal(I, "agi")) { R.wait = true; return R; }
      }
      R.goto = "land"; return R;
    },
    land(v, inst) {
      const I = K.draft(inst), R = K.result(I), F = I.data.fall;
      const out = hazards.fallOutcome({ dice: I.data.res.fall, agilitySixes: K.sixesOf(I, "agi"), canGrab: F.canGrab === true, immune: F.immune === true });   // [B2391]
      F.damage = out.damage; F.rolled = out.rolled;
      if (F.zone && !K.flag(I, "put")) { K.setFlag(I, "put"); R.effects.push({ t: "zput", key: "put", who: F.who, to: F.zone, group: [] }); R.wait = true; return R; }
      if (!F.zone && !K.flag(I, "note")) { K.setFlag(I, "note"); (I.data.notes ??= []).push({ note: "landingByGm", who: F.who }); }      // from the sky: where it comes down is the GM's word [R16]
      if (!K.flag(I, "links")) { K.setFlag(I, "links"); for (const e of K.separated(v, [F.who])) R.effects.push(e); }      // fell out of a grapple or a carry
      if (out.damage > 0 && !K.flag(I, "dmg")) { K.setFlag(I, "dmg"); R.push = hazardChild([F.who], { kind: "fixed", amount: out.damage, armor: false, source: "kinetic", cause: "fall", id: "fall" }); return R; }   // no Armor against a fall [OQ-11] (the GM may change the number)
      R.events.push({ type: "fall", combatant: F.who, from: F.from, damage: out.damage }); I.data.result = "done"; R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};
export const altitudeNames = movement.ALTITUDE_HEIGHT;
