/* Tactical combat: ATTACK FLOW (spec 9.1, variants 9.2, stunts 9.3, special targets 9.4, damage 9.5). NO Foundry globals.
   Steps (spec 9.1 numbers): check (2) -> gate (3) -> approach (the move of a charge) -> reactBefore (4) -> roll (5, 6) -> outcome -> stunts (7) -> damage (8)
   -> reactAfterDamage (9) -> effects (10) -> close (11). Step 1 (declare) is the engine's `declare` / `amend`. Every number comes from scripts/rules.
   ATTACK KINDS (rules/attack.mjs ATTACKS): slugfest, shooting, grapple, grappleAttack, charge, counterattack, ram.
   OPTIONS OF A DECLARATION (P4):
     decl.wreck      a slugfest attack that wrecks the attacker's zone [B2451-2457]: bonus dice by terrain, reach 1, the zone is marked wrecked when the
                     declaration locks (hit or miss), counter `zone:<key>:wrecked`, a karma note for a hero
     decl.area       an area attack [B2542]: needs an entry or a weapon with `area`; the targets become everyone in the zone of the first target
     decl.fullAuto   full auto [B2543]: needs a weapon or entry with `fullAuto`; the declared targets stand in one zone, -1 die per target beyond the first
   CHARGE [B2490-2494], [R19]: a full and a quick action; the approach is a move child (part of the same transaction) along the route the rules library
   priced; the attack is rolled with STRENGTH, dodged, never blocked; what is left of the move feeds Slam.
   STUNTS: Double Damage, Stun / Suppressed, Trap, Deadly Hit are settled here; Knockback and Slam are forced moves (flows/move.mjs) with the GM's card;
   Bang Heads / Trick Shot name the extra opponent, who then takes damage and may get stunts of its own; Disarm asks the attacker what happens to the item and
   the GM which item it is; Special and Your Own are GM cards.
   MINIONS [B2825-2831]: Health is the number of members; a hit of an area attack, full auto, Bang Heads or Trick Shot asks the GM how many fall [OQ-1]. */
import { attack, stunts, damage, crits, dice, zones } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";
import * as C from "../catalog-pure.mjs";
import * as K from "./kit.mjs";
import * as MP from "../movement-pure.mjs";
import * as ZP from "../zones-pure.mjs";
import { freeMoveChild, forcedChild } from "./move.mjs";
import * as Veh from "./vehicle.mjs";                                                          // P7: the ram, hits on vehicles, the attack that ends a chase

export const STEPS = Object.freeze(["check", "gate", "approach", "reactBefore", "roll", "outcome", "stunts", "damage", "reactAfterDamage", "effects", "close"]);
const SLUG = ["slugfest", "grapple", "grappleAttack", "counterattack", "ram"];
const GM_STUNTS = { special: "stunt", own: "stunt", disarm: "stunt" };                 // the GM's word: [B2441-2442]; Disarm: which item it is
const NO_MAP_STUNTS = { knockback: "direction", slam: "direction" };                    // without zones the forced move is the GM's, by hand
const EXTRA_STUNTS = ["bangHeads", "trickShot"];                                         // [B2437], [B2518]: an extra opponent in the same zone
const NOT_ON_EXTRA = [...EXTRA_STUNTS, "special", "own", "disarm", "slam"];              // an extra opponent starts no chain of its own (reading, combat-rulings)
export const MINION_LOSS_MAX = K.MINION_LOSS_MAX;
const WRECK_REASON = { terrainUnset: "wreckUnset", terrain: "wreckTerrain", strength: "wreckStrength", alreadyWrecked: "wreckDone" };
export const INVISIBLE_GATE_DICE = -3;          // [B2075]
const kindOf = (inst) => inst.data.kind ?? "slugfest";
/** [B2541]: a single use weapon that was used in this scene (per item) */
const usedKey = (cid, w) => M.counterKey.scene(cid, `used:${String(w.item ?? w.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24)}`);
/** [B2545]: the shooter fired a "no movement" weapon in this round (flows/move.mjs refuses the move) */
export const FIRED_NO_MOVE = (cid) => M.counterKey.round(cid, "firedNoMove");
const weaponOf = (v, inst) => v.facts.weapon(inst.actor, inst.decl.weapon ?? "unarmed");
const bad = (reason, params = {}) => ({ ok: false, reason, params });

const multiOf = (d) => (d?.area ? "area" : d?.fullAuto ? "fullAuto" : null);
const allTargets = (I) => [...I.decl.targets, ...(I.data.extras ?? []).map((x) => x.id)];
/** May the attacker wreck the zone it stands in [B2451-2457]? -> { ok, zone, bonus, levelsRooftop } | { ok:false, reason, params } */
export function wreckOf(v, cid) {
  const z = v.facts.zone(cid), a = v.facts.c(cid);
  if (!z || !(z.key ?? z.spot)) return { ok: false, reason: "noScene", params: { gmMayAllow: 1 } };
  const key = String(z.key ?? z.spot).split(":")[0];
  if (z.states?.wrecked || M.counterGet(v.state, M.counterKey.zone(key, "wrecked")) > 0) return { ok: false, reason: "wreckDone", params: {}, zone: key };      // once per scene, also when the mark was cleared by hand
  const wc = zones.wreckCheck({ terrain: z.terrain && z.terrain !== "none" ? z.terrain : undefined, terrainUnset: !z.terrain, wrecked: false, rooftop: !!z.rooftop }, a?.attrs?.strength ?? 0);
  if (!wc.ok) return { ok: false, reason: WRECK_REASON[wc.reason] ?? "wreckTerrain", params: { ...(wc.gmMayAllow ? { gmMayAllow: 1 } : {}), ...(wc.minStrength ? { min: wc.minStrength } : {}) }, zone: key };   // [A17]
  return { ok: true, zone: key, bonus: wc.bonus, levelsRooftop: wc.levelsRooftop };
}
/** The approach of a charge [B2490]: the route to the target's spot, one move's worth, paid with the quick action. */
export function chargeOf(v, inst) {
  const Z = v.facts.zones, t = inst.decl?.targets?.[0], spot = t ? v.facts.zone(t)?.spot : null;
  if (!Z) return { ok: false, reason: "noZones", params: { gmMayAllow: 1 } };
  if (!spot) return { ok: false, reason: "noRange", params: {} };
  const pr = MP.chargePlan(Z, v.state, inst.actor, v.facts.c(inst.actor), inst.decl, spot);
  if (!pr.ok) return { ok: false, reason: pr.reason, params: { ...(pr.params ?? {}), ...(pr.gmMayAllow ? { gmMayAllow: 1 } : {}) } };
  const cc = attack.chargeCheck({ sameZone: false, hasFull: true, hasQuick: true, moveDistance: pr.total, moveAllowance: pr.allowance });     // [B2490]; the actions are the ledger's question (chargeActions)
  if (!cc.ok) return { ok: false, reason: cc.reason === "sameZone" ? "chargeSameZone" : cc.reason, params: { total: pr.total } };
  return { ok: true, to: pr.to, from: pr.from, zones: pr.zones, total: pr.total, left: cc.movementLeft, mode: pr.mode, stress: pr.stress, prev: pr.zones.length > 1 ? pr.zones[pr.zones.length - 2] : pr.from };
}
/* a full AND a quick action [B2490]: asked of the ledger as it will be once the full action is paid */
function chargeActions(v, inst) {
  if (inst.data?.paid?.chargeQuick || inst.data?.prepaid) return true;
  const o = { resolve: v.facts.c(inst.actor)?.resolve };
  if (inst.entry) return P1.canPay(v.state, inst.actor, "quick", o).ok;
  const p = P1.pay(v.state, inst.actor, "full", o, { action: inst.action });
  return !!p.ok && P1.canPay({ ...v.state, ledger: { ...v.state.ledger, [inst.actor]: p.ledger } }, inst.actor, "quick", o).ok;
}

/** Legality of the declaration (spec 9.1 step 2). Returns { ok, reason, params, gates, notes }. Costs are checked by the engine (ledger, P1). */
export function legality(v, inst) {
  const { state, facts } = v, d = inst.decl, kind = kindOf(inst), entry = v.entry(inst), multi = multiOf(d);
  if (!attack.ATTACKS[kind]) return bad("unknownAttack");
  const a = facts.c(inst.actor);
  if (!a || a.present === false) return bad("gone");
  const counter = kind === "counterattack";
  const vx = Veh.attackLegality(v, inst);                                                                    // P7 [B3148], [B3223]
  if (vx) return vx;
  if (!counter) {
    if (a.health <= 0) return bad("broken");                                                                 // [B2707]
    const ac = M.conditions(state, inst.actor);
    if (ac.held) return bad("held");                                                                         // [B2496]
    if (ac.snared) return bad("snared");                                                                     // [R21]
    if (ac.carriedAloft) return bad("carriedAloft");                                                         // [B2392]
    if (ac.trapped && (SLUG.includes(kind) || kind === "charge")) return bad("trapped");                     // [R20], [B2438]: no slugfest, no movement
    if (M.hasStatus(state, inst.actor, "grappling") && kind !== "grappleAttack") return bad("grappling");    // [B2497]
    if (kind === "grappleAttack" && !M.hasStatus(state, inst.actor, "grappling")) return bad("notHolding");  // [B2497]
    if ((d.stressTotal ?? 0) + (weaponOf(v, inst)?.stress ?? 0) > 0 && !damage.canTakeVoluntaryStress(a.resolve)) return bad("stressedOut");    // [B2816], [B2228]; P6: the stress a power's attack costs
  }
  if (!Array.isArray(d.targets) || d.targets.length < 1) return bad("noTarget");
  if (d.targets.length > 1 && !multi) return bad("oneTarget");
  const w = weaponOf(v, inst);
  if (!counter && d.weapon && d.weapon !== "unarmed" && !w) return bad("noWeapon");
  if (entry?.unarmed && d.weapon && d.weapon !== "unarmed") return bad("noWeapon", { gmMayAllow: 1 });       // P6 [B2151]: Martial Arts is unarmed
  if (!counter && a.pass?.windup && SLUG.includes(kind) && (!d.weapon || String(d.weapon).startsWith("unarmed")) && !K.marked(state, inst.actor, "windup")) return bad("noWindup", { gmMayAllow: 1 });      // P6 [B1622]: the quick action first
  if (w?.fam === "shoot" && kind === "slugfest") return bad("noWeapon");                                      // P6: a power thrown from afar is a shooting attack
  if (!counter && !inst.locked) {                                                                            // the features of the book's weapon table (kit-pure.mjs profileOf); once the dice are out the attack stands
    if (w?.singleUse && M.counterGet(state, usedKey(inst.actor, w)) > 0) return bad("weaponUsed", { gmMayAllow: 1 });      // [B2541]: used once, then discarded (the GM allows a second one from the pack)
    if (w?.noMove && (P1.history(state, inst.actor, "round", "moved") || P1.history(state, inst.actor, "round", "movedWithinZone"))) return bad("weaponNoMove", { gmMayAllow: 1 });      // [B2545]
  }
  if (multi) {                                                                                               // [B2542], [B2543]
    if (!(entry?.[multi] || w?.[multi])) return bad(multi === "area" ? "noArea" : "noFullAuto", { gmMayAllow: 1 });
    if (multi === "fullAuto" && attack.ATTACKS[kind].family !== "shooting") return bad("noFullAuto");
    const spots = d.targets.map((t) => facts.zone(t)?.spot).filter((x) => x != null);
    if (new Set(spots).size > 1) return bad("notSameZone");                                                 // the targets stand in one zone
  }
  if (d.wreck && !inst.data?.wreck) {                                                                        // [B2451]: an option of a slugfest attack
    if (kind !== "slugfest") return bad("wreckNotSlugfest");
    const wz = wreckOf(v, inst.actor);
    if (!wz.ok) return bad(wz.reason, wz.params);
  }
  if (kind === "grappleAttack" && !counter) {
    const held = M.statusesOf(state, inst.actor).find((s) => s.id === "grappling")?.data?.held;
    if (held && d.targets[0] !== held) return bad("notHeld");                                                // [B2497]: against the one held
  }
  const gates = [], notes = [];
  const approached = !!inst.data?.charge?.done;
  for (const t of d.targets) {
    const tf = facts.c(t);
    if (!tf || tf.present === false || t === inst.actor) return bad(t === inst.actor ? "self" : "gone");
    if (w?.immuneHuge && tf.huge) return bad("hugeTarget");                                                  // P6 [B1606], [B1625]
    const unseen = state.knowledge?.[inst.actor]?.[t] === "unseen";
    if (unseen && !d.blind && !d.area) return bad("unseen");                                                 // spec 10: needs the stated intent to attack "where it should be"
    const r = facts.range(inst.actor, t);
    if (r === undefined) notes.push("noScene");                                                              // spec 7: positional steps fall back to the GM
    else if (r === null) return bad("noRange");                                                              // [Z4]
    else if (kind === "charge" && !approached) { if (r.total === 0) return bad("chargeSameZone"); }          // [B2490]
    else if (SLUG.includes(kind) || kind === "charge") {                                                     // [Z2], [B2425]; huge and grown attackers reach elevated targets [B2500], [B1975]; wrecking reaches one zone [B2453]
      const reach = zones.slugfestReachAt(r, facts.zone(inst.actor) ?? {}, facts.zone(t) ?? {}, { range: Math.max(d.wreck ? 1 : 0, w?.reach ?? 0, a.pass?.reach ? 1 : 0, K.copiesOf(state, inst.actor) > 0 ? 1 : 0), huge: stunts.reachesElevated(a) });      // P6: Elongation [B1919], copies [B1908]
      if (!reach.ok) return bad("outOfReach", { distance: r.total });
    }
    else {
      if (!w || !Array.isArray(w.range)) return bad("noWeapon");                                             // [B2510]
      const sr = zones.shootingRange(r.total, w.range);                                                      // [B2511]
      if (!sr.ok) return bad(sr.reason, { distance: r.total });
    }
    if (kind === "grapple") { const g = attack.grappleCheck({ target: K.immunityFlags(tf), usesWeapon: !!d.weapon && d.weapon !== "unarmed" }); if (!g.ok) return bad(g.reason); }   // [B2496], [B2502]
    if (!counter && !d.area) {
      if (M.hasStatus(state, t, "invisible")) gates.push({ kind: "invisible", target: t, attr: "intuition", dice: INVISIBLE_GATE_DICE, src: 2075 });   // [B2075]
      else if (unseen) gates.push({ kind: "unseen", target: t, gm: 1 });                                     // concealed by the GM: no cited number, so the GM sets the gate
    }
  }
  if (kind === "charge" && !approached && !counter) {                                                        // [B2490-2492]
    const cp = chargeOf(v, inst);
    if (!cp.ok) return bad(cp.reason, cp.params);
    if (!chargeActions(v, inst)) return bad("chargeActions");
  }
  if (!counter && facts.zone(inst.actor)?.states?.lowgrav) gates.push({ kind: "lowGravity", attr: "agility", dice: 0, src: 1703 });   // [B1703]
  return { ok: true, reason: null, params: {}, gates, notes };
}

/** Does the instance still hold after an interrupt finished on top of it (spec 5.1)? Returns { ok, reasons }. The engine never decides: a failure opens the
    GM card `revalidate` [OQ-3]. */
export function revalidate(v, inst) {
  const reasons = [];
  const blocked = K.actorBlocked(v, inst);
  if (blocked) reasons.push(blocked);
  if (inst.entry && v.state.ledger[inst.actor]?.entries.find((e) => e.id === inst.entry)?.void) reasons.push("costVoid");
  if (!blocked) { const l = legality(v, inst); if (!l.ok) reasons.push(l.reason); }
  return { ok: reasons.length === 0, reasons };
}

/* ------------------------------------------------------------------ helpers */
/* The attacker's pool, built in ONE place: for the roll itself (step 5) and for the numbers of the reaction window before it (D28: the
   GM's card counted the bare attribute while the roll carried the sheet's dice, the weapon, the bonus dice ... on top of it).
   [B2536], [B2430], [R6], [B2511], [B2238], [B2452], [B2543]; P6: a power may be thrown with another attribute; P7 [B3148]: Maneuverability
   on a ram; [B2827], [R24]: a group of minions. Before the declaration locks the wreck bonus is the one the zone would give now. */
function attackPool(v, I, tokens) {
  const kind = kindOf(I), d = I.decl, w = weaponOf(v, I), attr = w?.attr ?? attack.ATTACKS[kind].attr;
  const t0 = d.targets[0], a = v.facts.c(I.actor), r = v.facts.range(I.actor, t0);
  const wz = !I.data.wreck && d.wreck ? wreckOf(v, I.actor) : null, wreckBonus = I.data.wreck ? I.data.wreck.bonus ?? 0 : wz?.ok ? wz.bonus : 0;
  const mods = attack.attackModifiers({ attack: kind, target: I.data.multi ? {} : M.conditions(v.state, t0), weaponBonus: w?.bonus ?? 0, wreckBonus, distance: r?.total ?? null, range: w?.range ?? null,
    targets: I.data.multi === "fullAuto" ? d.targets.length : 1, helpers: K.helpDiceOf(v, d) });
  mods.push(...Veh.attackMods(v, I));
  if (a?.kind === "minions" && a.members > 1) mods.push({ source: "minions", dice: dice.helpDice(a.members - 1, { minions: true }) });
  return { attr, ...K.buildPool(v, I, "attack", I.actor, attr, mods, { rollKind: "attack", tokens }) };
}
/* THE DAMAGE OF ONE HIT, built in ONE place: for the damage step and for what the map shows on a target before the declaration
   (hitPreview). Spec 9.5 steps 1-4: the base, a pulled punch, Double Damage before Armor, the single best Armor. `o` = the outcome
   record of the target (an extra opponent of a stunt takes another base), `forced` = the GM's word on this hit. */
function hitMath(v, I, t, o = {}, forced = null, doubled = false) {
  const kind = kindOf(I), entry = v.entry(I), w = weaponOf(v, I), a = v.facts.c(I.actor), tf = v.facts.c(t) ?? {};
  const tags = M.damageTags({ source: entry?.damage?.source ?? w?.source, sharp: entry?.damage?.sharp ?? w?.sharp, toStress: entry?.damage?.toStress ?? w?.toStress, ignoreArmor: entry?.damage?.ignoreArmor ?? w?.ignoreArmor, cause: kind === "counterattack" ? "counter" : o.extra ? "stunt" : "attack" });
  const base = o.extra === "bangHeads" ? stunts.bangHeadsDamage(a?.attrs?.strength ?? 0) : o.extra === "trickShot" ? stunts.trickShotDamage(baseDamageOf(v, I)) : baseDamageOf(v, I);
  const sources = [...(tf.armor ?? []).filter((x) => !(x.id === "defiance" && tf.pass?.defianceOff && !K.marked(v.state, t, "defiance", true))), ...K.barriersOf(v.state, t)];                                      // P6: Barriers [B1859]; Defiance stops stress only [B1865]
  const ar0 = damage.selectArmor(tags.toStress ? sources.filter((s) => s.stress) : sources, { toStress: tags.toStress, source: tags.source });   // [B2682], [R13]
  const ar = w?.halveArmor && !o.extra ? { ...ar0, armor: damage.halvedArmor(ar0.armor) } : ar0;             // P6 [B1679]
  const hd = damage.hitDamage({ base, pulled: o.extra ? null : I.decl.pulled ?? null, doubled, armor: forced?.armor ?? ar.armor, ignoreArmor: tags.ignoreArmor, source: tags.source, immunities: tf.immunities ?? [], vulnerabilities: tf.vulnerabilities ?? [] });   // [B2427], [B2434], [B2193], [B1879]
  return { tags, base, ar, hd };
}
/** What a plain hit of this declaration would do to `t`, before anything is declared (engine-pure.opPreview, the map's preview on the
    target's bar): the same numbers the damage step will use, TO ITS END (D50: the copies of Duplication take the damage first [B1910],
    so with copies standing the bar loses less, or nothing). `most` = with Double Damage [B2434]; `copies` = how many points the copies
    take of a plain hit. Nothing is spent or written.
    -> { base, taken, most, copies, toStress, now, max } | null (an attack that does no damage) */
export function hitPreview(v, inst, t) {
  const I = K.draft(inst), kind = kindOf(I), entry = v.entry(I), w = weaponOf(v, I), tf = v.facts.c(t);
  if (!tf || kind === "grapple" || entry?.damage?.none || w?.noDamage) return null;
  const one = hitMath(v, I, t), two = hitMath(v, I, t, {}, null, true), toStress = !!one.tags.toStress;
  const through = !toStress && M.hasStatus(v.state, t, "intangible") ? 0 : 1;                               // P6 [B1941]
  const soak = (n) => (toStress ? { taken: n, absorbed: 0 } : damage.absorbByCopies({ taken: n, copies: K.copiesOf(v.state, t) }));      // P6 [B1910], as the damage step (K.copiesAbsorb)
  const a = soak(one.hd.taken * through), b = soak(two.hd.taken * through);
  return { base: one.base, taken: a.taken, most: b.taken, copies: a.absorbed, toStress, now: toStress ? tf.resolve : tf.health, max: toStress ? tf.maxResolve : tf.maxHealth };
}
/** The dice `t` would roll with each way of defending against this declaration, before anything is declared (D60): the defence pool of
    the roll itself (the builder of the reaction card and of the dice thrown), so the chance "if they defend" on the map is the
    engine's, as the attack side is. -> { block?, dodge? } */
export function defPreview(v, inst, t) {
  const I = K.draft(inst), out = {};
  if (!v.facts.c(t) || kindOf(I) === "counterattack") return out;
  I.data.multi = multiOf(I.decl);
  for (const id of ["block", "dodge"]) { try { const n = defencePool(v, I, t, id, []).pool.dice; if (Number.isFinite(n)) out[id] = n; } catch { /* no number rather than a wrong one */ } }
  return out;
}
/** The dice this declaration would roll, before it is declared: the roll's own builder on a copy (engine-pure.opPreview). Nothing is spent. */
export function preview(v, inst) {
  const I = K.draft(inst);
  if (kindOf(I) === "counterattack") return null;      // (no target yet: the pool without what the target would add or take)
  if (weaponOf(v, I)?.always?.includes("area")) I.decl.area = 1;
  I.data.multi = multiOf(I.decl);
  return attackPool(v, I, I.decl.tokens ?? []);
}
/* What the dice of an exchange look like before any is rolled, for the GM only (`data.gm` never reaches a player: view-pure.promptView):
   the attacker's pool as the roll will build it (the bonus dice the declaration names counted in) and the defender's pool for each way of
   defending. Built on a copy: nothing is spent and no note is written. -> { att: { dice, attr } | null, def: { block?, dodge? } } */
function oddsFacts(v, I, t, ways) {
  const J = K.draft(I), out = { att: null, def: {} };
  try { const p = attackPool(v, J, I.decl.tokens ?? []); out.att = { dice: p.pool.dice, attr: p.attr }; } catch { out.att = null; }
  for (const id of ways) { try { out.def[id] = defencePool(v, J, t, id, []).pool.dice; } catch { /* no number rather than a wrong one */ } }
  return out;
}
/* U11: the same facts as the defender may know them: no pool of the opponent, only HOW LIKELY the attack is to land with each answer, in
   the bands the dock names every chance with. -> { open, block?, dodge? } (band levels) | null */
function oddsBands(g) {
  if (!Number.isFinite(g?.att?.dice)) return null;
  const a = Math.max(1, g.att.dice), out = { open: K.bandOf(dice.pSuccess(a)) };
  for (const [id, n] of Object.entries(g.def ?? {})) if (Number.isFinite(n)) out[id] = K.bandOf(dice.pHit(a, Math.max(1, n)));
  return out;
}
const defencePool = (v, I, t, how, tokens) => K.buildPool(v, I, `def:${t}`, t, attack.DEFENCES[how].attr, [], { rollKind: how, tokens });
function defencePrompt(v, I, t) {
  const kind = kindOf(I), tf = v.facts.c(t);
  const dq = Veh.defenceOf(v, I, kind);                                                          // P7 [B3434]: the charge or ram that ends a chase
  const df = K.defenceOf(v, t, dq.attack, { inChase: dq.inChase, machine: Veh.isMachine(v, t) }), conds = df.conds;        // [B2446], [B2524], [R6], [R20], [R21], [R10], [B2707], [B2497]; a grant may pay the defence (spec 4.2)
  const opts = df.paid, options = [];
  /* P6 [B2105] Defensive: 1 stress instead of an action, as often as there is Resolve; asked for when the attack comes, never ahead of it */
  const free = tf?.pass?.defensive === true && !Veh.isMachine(v, t) ? df.free : null;
  const allowed = (set, id) => {
    let op = set[id];
    if (op.reason === "notAllowed" && !dq.inChase && ((id === "block" && tf?.pass?.deflection && dq.attack === "shooting") || (id === "dodge" && tf?.pass?.duckWeave && dq.attack === "slugfest"))) {      // P6 [B2106], [B2109]
      const other = set[id === "block" ? "dodge" : "block"]; op = other.reason === "notAllowed" ? { ok: true, reason: null } : other;
    }
    return op;
  };
  for (const id of ["block", "dodge"]) {
    const op = allowed(opts, id);
    if (op.reason === "notAllowed") continue;                                                    // this attack cannot be answered that way at all
    /* the bonus dice the defender may choose to put on this defence (spec 6.2); the answer names them: { id, tokens } */
    const spare = M.tokensFor(v.state, t, { kind: id, attr: attack.DEFENCES[id].attr }).filter((k) => !M.standing(k)).map((k) => ({ id: k.id, dice: k.dice, source: k.source?.name ?? "", ...(k.needsGm ? { needsGm: 1 } : {}) }));
    const o = { id, label: `ITAC.action.${id}`, cost: "quick", ...(spare.length ? { data: { tokens: spare } } : {}) };
    if (!op.ok) o.disabled = op.reason;
    options.push(o);
    if (free) {
      const f = allowed(free, id), fo = { id: `${id}:free`, label: `ITAC.opt.${id}Free`, cost: "none", stress: 1, ...(spare.length ? { data: { tokens: spare } } : {}) };
      if (!f.ok) fo.disabled = f.reason; else if (!(tf.resolve > 0)) fo.disabled = "stressedOut";                   // [B2105]: not without Resolve
      options.push(fo);
    }
  }
  if (!df.out) for (const e of C.reactionsFor(v.state, t, "beforeRoll", v.facts).filter((e) => e.reaction.effect !== "swapTarget" && K.reactionFit(v, I, t, e).ok)) options.push(K.reactionOption(v, t, e, I));      // [B2707]: out of action, no power answers
  const live = options.filter((o) => !o.disabled);
  const ways = [...new Set(live.map((o) => String(o.id).split(":")[0]).filter((id) => id === "block" || id === "dodge"))];
  const p = { key: `rb:${t}`, kind: "reaction", to: K.addressee(v, t), about: t, options: [...options, { id: K.PASS, label: "ITAC.opt.pass" }], data: { when: "beforeRoll", attacker: I.actor, attack: kind, action: I.action, targets: I.decl.targets.slice(0, 12) } };
  p.data.gm = oddsFacts(v, I, t, ways);
  const bands = oddsBands(p.data.gm);
  if (bands) p.data.odds = bands;
  if (!live.length) p.auto = { option: K.PASS, reason: df.out ?? (conds.unaware ? "unaware" : "noOption") };                 // plan 5.2 step 4
  else if (tf?.npc) {                                                                                             // spec 13.3 NpcPolicy
    const pol = v.state.npc?.[t] ?? {}, def = live.find((o) => o.id === "block" || o.id === "dodge");
    if (def && pol[def.id] === "always") p.auto = { option: def.id, reason: "npcDefault" };
    else if (K.quickGroup(v, t)) p.auto = { option: K.PASS, reason: "quick" };                                    // U61: a group settled quickly takes the hit
    else if (live.every((o) => pol[String(o.id).split(":")[0]] === "never")) p.auto = { option: K.PASS, reason: "npcDefault" };
  }
  return p;
}
/** Apply one answered reaction of a window. Returns true when it pushed an interrupting action (the step must wait for it). */
function applyReaction(v, I, R, cid, key, value, when) {
  const id = typeof value === "string" ? value : value?.id;
  (I.data.done ??= {})[key] = 1;
  if (id === K.PASS_ROUND && !M.counterGet(v.state, K.passKey(cid))) R.effects.push({ t: "state", ...M.counterBump(v.state, K.passKey(cid)) });      // U11: not asked again this round as a bystander
  if (!id || id === K.PASS || id === K.PASS_ROUND) return false;
  if (["block", "dodge", "block:free", "dodge:free"].includes(id)) {
    const [how, free] = id.split(":");
    /* [B2447], [B2525]: no action left, no defence. Asked again when the answer is acted on: the unit may have gone since the window opened
       (another defence, a mark). Only the GM's own answer stands against it (spec 14). */
    if (!K.answeredByStaff(v, I, key)) {
      const dq = Veh.defenceOf(v, I, kindOf(I)), now = K.defenceOf(v, cid, dq.attack, { inChase: dq.inChase, machine: Veh.isMachine(v, cid) })[free ? "free" : "paid"][how];
      if (now && !now.ok && now.reason !== "notAllowed") { (I.data.notes ??= []).push({ note: "defenceRefused", who: cid, reason: now.reason }); return false; }
    }
    if (free) R.effects.push({ t: "stress", who: cid, n: 1 });                                  // P6 [B2105] Defensive: 1 stress, no action
    else R.effects.push({ t: "pay", who: cid, cost: "quick", action: how, interrupt: 1, defense: 1, key: `def:${cid}`, target: [I.actor] });     // [B2447], [B2525]
    const dTokens = Array.isArray(value?.tokens) ? value.tokens.slice(0, 12) : [];
    let dDice = null; try { dDice = defencePool(v, K.draft(I), cid, how, dTokens).pool.dice; } catch { dDice = null; }      // what the defender will roll, as far as it is known now (the desk's chance, D28)
    (I.data.def ??= {})[cid] = { defence: how, tokens: dTokens, ...(free ? { free: "defensive" } : {}), ...(Number.isFinite(dDice) ? { dice: dDice } : {}) };
    R.events.push({ type: "reaction", who: cid, kind: how, cost: free ? "none" : "quick", stress: free ? 1 : 0 });
    return false;
  }
  const e = C.reactionsFor(v.state, cid, when, v.facts).find((x) => `r:${x.id}` === id);
  if (!e) return false;
  /* U91: the place is asked again when the answer is acted on, as the action of a defence is: the guardian may stand elsewhere by now
     [B2115]. Nothing is paid then. Only the GM's own answer stands against it (spec 14). */
  const staff = K.answeredByStaff(v, I, key), fit = K.reactionFit(v, I, cid, e);
  if (!fit.ok && !staff) { (I.data.notes ??= []).push({ note: "reactionRefused", who: cid, entry: e.id, reason: fit.reason }); return false; }
  R.effects.push({ t: "pay", who: cid, cost: e.cost, action: e.id, interrupt: 1, key: `re:${when}:${cid}`, target: [I.actor] });
  if (e.stress?.fixed) R.effects.push({ t: "stress", who: cid, n: e.stress.fixed });
  R.events.push({ type: "reaction", who: cid, kind: e.id, cost: e.cost, stress: e.stress?.fixed ?? 0, for: I.decl.targets[0] });
  if (e.reaction.effect === "action") {            // an interrupt that is itself an action: pushed on top, runs to its end, then this one is revalidated (spec 5.1)
    R.push = { action: e.id, actor: cid, decl: { action: e.id, targets: [I.actor], helpers: [], exploits: [], stressTotal: 0 }, cause: "interrupt", prepaid: 1 };
    return true;
  }
  if (e.reaction.effect === "swapTarget") {        // retargeting (spec 9.1 step 4 "target swap"): the reactor becomes the target; its own window opens next
    const mine = K.reactionFor(v, I, cid, e);                                                    // U91: only somebody attacked in the reactor's own zone [B2115]
    const from = mine.includes(value?.for) ? value.for : mine[0] ?? (I.decl.targets.includes(value?.for) ? value.for : I.decl.targets[0]);      // (the GM's own answer, where nobody fits)
    if (e.reaction.roll === "attack") {            // [B2115]: FIGHTING against a slugfest attack, AGILITY against shooting; the hit is taken only on a success
      const rk = `sw:${cid}`, attr = attack.ATTACKS[kindOf(I)]?.family === "shooting" ? "agility" : "fighting";
      const bp = K.buildPool(v, I, rk, cid, attr, [], { rollKind: "other" });
      for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
      R.effects.push(K.rollEffect(rk, cid, attr, bp.pool, { label: e.label, noPush: !K.mayPush(v, cid) }));
      (I.data.swaps ??= []).push({ key: rk, by: cid, from, entry: e.id });
      return false;
    }
    swapTarget(I, from, cid, e.id);
    return false;
  }
  if (e.reaction.effect === "autoMiss") { ((I.data.forced ??= {}).autoMiss ??= {})[cid] = e.id; return false; }
  (I.data.notes ??= []).push({ who: cid, entry: e.id, when });
  return false;
}
const swapTarget = (I, from, to, by) => {
  I.decl.targets = I.decl.targets.map((t) => (t === from ? to : t));
  (I.data.retargets ??= []).push({ from, to, by });
  if (I.data.def) delete I.data.def[from];
};
/** U91: the rolls of those who dive in [B2115]. Each waits for its dice (the roller may push, as on any roll of its own); with a six the
    reactor is the target now, without one the attack goes on against the intended target and the quick action is spent all the same.
    Somebody who is no target any more (another guardian was faster) is not replaced. -> true while a roll is still out */
function settleSwaps(v, I) {
  let waiting = false;
  for (const s of I.data.swaps ?? []) {
    if (s.done) continue;
    if (!K.rollFinal(I, s.key)) { waiting = true; continue; }
    s.done = 1;
    const won = K.sixesOf(I, s.key) >= 1 && I.decl.targets.includes(s.from) && !I.decl.targets.includes(s.by);
    if (won) swapTarget(I, s.from, s.by, s.entry);
    else (I.data.notes ??= []).push({ note: "swapFailed", who: s.by, entry: s.entry, for: s.from, sixes: K.sixesOf(I, s.key) });
  }
  return waiting;
}
/** Drive a set of window prompts (keys). Returns "wait" or "done". */
function runWindow(v, I, R, keys, when) {
  for (const key of keys) {
    if (I.data.done?.[key]) continue;
    if (!K.isAnswered(v, I, key)) continue;
    const cid = K.promptOf(v, I, key).about;
    if (applyReaction(v, I, R, cid, key, K.answerOf(v, I, key), when)) return "wait";
  }
  return keys.every((k) => I.data.done?.[k]) ? "done" : "wait";
}
const windowKeys = (I, prefix) => Object.keys(I.data.pk ?? {}).filter((k) => k.startsWith(prefix));

/* ------------------------------------------------------------------ steps */
const withOut = (inst) => { const I = K.draft(inst); I.data.out ??= {}; return I; };      // a skipped step (spec 14.1 skipStep) must not break the later ones
const blank = { helpers: [], exploits: [], stressTotal: 0 };
/* Knockback straight up or down (a vertical zone is a zone [B2258]): up unless the target is already as high as the map goes, down only for a
   target off the ground (reading, combat-rulings INT-R3). Asked only where the map says on which level the target is. */
const vertOf = (v, t) => { const z = v.facts.zone(t); return !z || z.area || z.level == null ? [] : [...(z.level === "elevated" ? [] : ["up"]), ...(z.level !== "ground" && z.level !== "underground" ? ["down"] : [])]; };
const baseDamageOf = (v, I) => { const entry = v.entry(I), w = weaponOf(v, I), a = v.facts.c(I.actor); return Veh.attackBase(v, I) ?? entry?.damage?.base ?? (w && w.damage != null ? w.damage : a?.slugfest?.damage ?? 0); };   // [B2426], [B2428], [B2512]; P7 [B3148]: a ram deals the vehicle's damage
export const steps = {
  /* step 2: legality was checked when the declaration came in; here the gates it found are fixed on the instance, an area attack takes everyone in the
     target zone [B2542], a charge pays its quick action and fixes its route [B2490] */
  check(v, inst) {
    const I = K.draft(inst), R = K.result(I), kind = kindOf(I);
    if (weaponOf(v, I)?.always?.includes("area")) I.decl.area = 1;                              // P6: a power that always takes the whole zone [B1671]
    I.data.multi = multiOf(I.decl);
    if (I.decl.area && !K.flag(I, "area")) {                                                    // [A40]: the attacker's own area attack does not include the attacker
      K.setFlag(I, "area");
      const t0 = I.decl.targets[0], all = [t0, ...(v.facts.inZone(t0) ?? [])].filter((c, i, l) => c !== I.actor && l.indexOf(c) === i && v.facts.c(c) && v.facts.c(c).present !== false);
      I.decl.targets = all.slice(0, 24);
    }
    const l = legality(v, I);
    if (!l.ok && !I.data.exception) { R.goto = "close"; I.data.result = "illegal"; I.data.reason = l.reason; return R; }
    I.data.gates = l.gates ?? []; I.data.notes = [...(I.data.notes ?? []), ...(l.notes ?? []).map((n) => ({ note: n }))];
    if (kind === "charge" && !I.data.charge) {
      const cp = chargeOf(v, I);
      if (cp.ok) {
        I.data.charge = { to: cp.to, from: cp.from, zones: cp.zones, total: cp.total, left: cp.left, prev: cp.prev, mode: cp.mode };
        if (!I.data.prepaid) R.effects.push({ t: "pay", who: I.actor, cost: "quick", action: I.action, key: "chargeQuick", own: 1, tags: ["move", "charge"], zoneFrom: cp.from, zoneTo: cp.to, borders: cp.total });   // [B2490]: a full and a quick action
      } else (I.data.notes ??= []).push({ note: "chargeByHand", reason: cp.reason });            // declared through an exception: the GM moves the charger
    }
    R.goto = "gate";
    return R;
  },

  /* step 3: gate rolls forced on the attacker; a failure spends the action [B2075], [B1903], [B1703] */
  gate(v, inst) {
    const I = K.draft(inst), R = K.result(I);
    const gates = I.data.gates ?? [];
    for (let i = 0; i < gates.length; i++) {
      const g = gates[i], key = `gate:${i}`;
      if (g.gm && !g.attr) {                                        // no cited number: the GM waives the gate, sets the roll, or rules the action forfeit
        if (!I.data.pk?.[`gateGm:${i}`]) { R.prompts.push({ key: `gateGm:${i}`, kind: "gate", to: "gm", about: I.actor, gmOnlyData: 1, options: [{ id: "waive", label: "ITAC.opt.waive" }, { id: "roll", label: "ITAC.opt.gateRoll", data: { attr: "intuition" } }, { id: "forfeit", label: "ITAC.opt.forfeit" }], data: { gate: g.kind, target: g.target } }); R.wait = true; return R; }
        if (!K.isAnswered(v, I, `gateGm:${i}`)) { R.wait = true; return R; }
        const a = K.answerOf(v, I, `gateGm:${i}`), id = typeof a === "string" ? a : a?.id;
        if (id === "waive") { g.waived = 1; continue; }
        if (id === "forfeit") { I.data.result = "gateFailed"; R.events.push({ type: "gate", gate: g.kind, passed: false }); R.goto = "close"; return R; }
        g.attr = "intuition"; g.dice = Math.max(-9, Math.min(9, Math.trunc(Number(a?.dice) || 0)));
      }
      if (g.waived) continue;
      if (!K.rollOf(I, key)) {
        const { pool } = K.buildPool(v, I, key, I.actor, g.attr, g.dice ? [{ source: `gate:${g.kind}`, dice: g.dice }] : []);
        R.effects.push(K.rollEffect(key, I.actor, g.attr, pool, { passive: true, label: `ITAC.gate.${g.kind}` }));      // [B2227]: passive, no push
        R.wait = true; return R;
      }
      if (!K.rollFinal(I, key)) { R.wait = true; return R; }
      if (!K.flag(I, key)) { K.setFlag(I, key); R.events.push({ type: "gate", gate: g.kind, roll: key, passed: K.sixesOf(I, key) > 0 }); }
      if (K.sixesOf(I, key) < 1) { I.data.result = "gateFailed"; R.goto = "close"; return R; }
    }
    R.goto = "approach";
    return R;
  },

  /* the move of a charge [B2490]: a child move along the priced route, in the attack's own transaction. The charger stops at the point of attack; a move
     that is stopped on the way (a barrier that holds, a hazard, a GM stop) ends the charge with both actions spent. */
  approach(v, inst) {
    const I = K.draft(inst), R = K.result(I), ch = I.data.charge;
    if (kindOf(I) !== "charge" || !ch || ch.done) { R.goto = "reactBefore"; return R; }
    if (!K.flag(I, "approach")) {
      K.setFlag(I, "approach");
      if (!I.locked) { I.locked = true; R.events.push({ type: "actionLocked" }); }             // spec 5.5: a charge is committed once the charger moves
      R.push = { action: "move", actor: I.actor, decl: { ...blank, action: "move", targets: [], to: ch.to, ...(ch.mode ? { mode: ch.mode } : {}), ...(I.decl.stress ? { stress: 1 } : {}), pay: "quick", ...(I.decl.force ? { force: I.decl.force } : {}) },
        data: { charging: true, prepaid: true }, cause: "turn", part: 1 };
      return R;
    }
    const res = (I.data.results ?? []).find((r) => r.action === "move"), r = v.facts.range(I.actor, I.decl.targets[0]);
    if (!res || res.result !== "done" || !r || r.total !== 0) { ch.stopped = 1; I.data.result = "chargeStopped"; R.goto = "close"; return R; }
    ch.done = 1;
    R.goto = "reactBefore";
    return R;
  },

  /* step 4: reaction window before the roll, open to everyone entitled; a party with no option is passed automatically */
  reactBefore(v, inst) {
    const I = K.draft(inst), R = K.result(I), kind = kindOf(I);
    I.data.window = "beforeRoll";
    if (kind !== "counterattack") {                                                             // [R4]: nothing answers a counterattack
      for (const t of I.decl.targets) if (!I.data.pk?.[`rb:${t}`] && !R.prompts.some((p) => p.key === `rb:${t}`)) R.prompts.push(defencePrompt(v, I, t));
      if (!K.flag(I, "rbOthers")) {
        K.setFlag(I, "rbOthers");
        R.prompts.push(...K.windowPrompts(v, I, "beforeRoll", { skip: I.decl.targets, reactions: C.reactionsFor }));
        R.events.push({ type: "reactionWindow", when: "beforeRoll", waiting: [...I.decl.targets] });
      }
    }
    if (R.prompts.length) { R.wait = true; return R; }
    const keys = [...windowKeys(I, "rb:").filter((k) => I.decl.targets.includes(k.slice(3))), ...windowKeys(I, "w:beforeRoll:")];
    const before = I.decl.targets.join();
    const st = runWindow(v, I, R, keys, "beforeRoll");
    if (R.push) return R;
    const rolling = settleSwaps(v, I);                                                // U91: a guardian's roll decides whether the target changes [B2115]
    if (I.decl.targets.join() !== before) { R.goto = "reactBefore"; return R; }      // retargeted: the new target's own window opens
    if (st === "wait" || rolling) { R.wait = true; return R; }
    I.data.window = null;
    R.goto = "roll";
    return R;
  },

  /* steps 5 and 6: the declaration locks at the first die; attacker, then each defender; push timing by the world switch [R3]; defenders never push [B2241] */
  roll(v, inst) {
    const I = K.draft(inst), R = K.result(I), kind = kindOf(I), A = attack.ATTACKS[kind], d = I.decl;
    const order = dice.OPPOSED_PUSH_ORDERS.includes(v.state.opts?.pushOrder) ? v.state.opts.pushOrder : "afterDefence";      // [R3], [OQ-9]
    if (!K.flag(I, "lock")) {
      K.setFlag(I, "lock");
      if (!I.locked) { I.locked = true; R.events.push({ type: "actionLocked" }); }             // spec 5.5
      const st = (d.stressTotal ?? 0) + (kind === "counterattack" ? 0 : weaponOf(v, I)?.stress ?? 0);
      if (st > 0) R.effects.push({ t: "stress", who: I.actor, n: st, cost: 1 });                 // spec 4.3: charged when the declaration locks; P6: with the stress of the power used
      if (kind !== "counterattack" && M.hasStatus(v.state, I.actor, "invisible")) R.effects.push({ t: "status-", who: I.actor, id: "invisible" });      // P6 [B2075]: attacking ends it
      const w0 = kind === "counterattack" ? null : weaponOf(v, I);
      if (w0?.singleUse) R.effects.push({ t: "state", ...M.counterBump(v.state, usedKey(I.actor, w0)) });      // [B2541]: gone, hit or miss
      if (w0?.noMove) R.effects.push({ t: "state", ...M.counterBump(v.state, FIRED_NO_MOVE(I.actor)) });       // [B2545]: no moving for the rest of the round
      if (d.wreck) {                                                                            // [B2451-2457]: the zone is wrecked whether or not the blow lands
        const wz = wreckOf(v, I.actor), key = wz.zone ?? null;
        I.data.wreck = { zone: key, bonus: wz.ok ? wz.bonus : 0, roof: wz.ok && wz.levelsRooftop ? 1 : 0 };
        if (key) {
          const op = ZP.zoneOp(key, { wrecked: true }), cw = M.counterBump(v.state, M.counterKey.zone(key, "wrecked"));
          if (op) { R.effects.push({ t: "zones", op }); R.events.push({ type: "zoneChange", ...ZP.changeOf(op), cause: "wreck", by: I.actor }); }
          R.effects.push({ t: "state", path: cw.path, to: cw.to });
          if (!v.facts.c(I.actor)?.npc) R.effects.push({ t: "karma", note: { who: I.actor, kind: "wreckedZone", zone: key } });     // spec 9.11
          if (wz.ok && wz.levelsRooftop) (I.data.notes ??= []).push({ note: "rooftopLevelled", zone: key });                       // [B2457]: who stood on it is the GM's word
        }
      }
    }
    if (kind === "counterattack") {                                                             // [B2448], [R4]: hits automatically with the surplus sixes, no dice
      if (!K.rollOf(I, "attack")) I.rolls.attack = { key: "attack", who: I.actor, attr: null, pool: { base: 0, mods: [], total: 0 }, sixes: I.data.counterSixes ?? 1, ones: 0, pushed: 0, pushable: false, auto: 1 };
      R.goto = "outcome"; return R;
    }
    /* U4: the GM said "hit" or "miss" for every target (setOutcome) while the exchange stood on its dice: no die is waited for any more.
       A roll that never came is dropped, one that waited for its push stands as it is, and the outcome is the GM's word. */
    const fo = I.data.forced?.outcome;
    if (fo && d.targets.length && d.targets.every((t) => typeof fo[t] === "boolean")) {
      for (const k of Object.keys(I.rolls)) { if (I.rolls[k].sixes == null && I.rolls[k].forced == null) delete I.rolls[k]; else if (I.rolls[k].pushable) I.rolls[k] = { ...I.rolls[k], pushable: false }; }
      I.data.window = null;
      R.goto = "outcome"; return R;
    }
    if (!K.rollOf(I, "attack")) {
      const AT = weaponOf(v, I)?.attr ?? A.attr;                                                 // P6: a power may be thrown with another attribute
      const tg = K.tokenGate(v, I, R, I.actor, { kind: "attack", attr: AT }, d.tokens ?? [], "attack");
      if (tg.wait) { R.wait = true; return R; }
      const bp = attackPool(v, I, tg.tokens);                                                    // the same builder the reaction window showed its numbers from
      for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
      R.effects.push(K.rollEffect("attack", I.actor, AT, bp.pool, { label: v.entry(I)?.label ?? `ITAC.action.${I.action}`, noPush: !K.mayPush(v, I.actor) }));
      R.wait = true; return R;
    }
    if (!K.rollRolled(I, "attack")) { R.wait = true; return R; }
    if (order === "beforeDefence" && !K.rollFinal(I, "attack")) { R.wait = true; return R; }   // [R3]: the attacker finishes pushing before any defender die
    let waiting = false;
    for (const t of d.targets) {
      const df = I.data.def?.[t];
      if (!df?.defence) continue;
      const key = `def:${t}`;
      if (!K.rollOf(I, key)) {
        const tg = K.tokenGate(v, I, R, t, { kind: df.defence, attr: attack.DEFENCES[df.defence].attr }, df.tokens ?? [], key);      // a die with a purpose waits for the GM's word, as on an attack (spec 6.2)
        if (tg.wait) { waiting = true; continue; }
        const bp = defencePool(v, I, t, df.defence, tg.tokens);
        for (const wr of bp.writes) R.effects.push({ t: "state", path: wr.path, to: wr.to });
        R.effects.push(K.rollEffect(key, t, attack.DEFENCES[df.defence].attr, bp.pool, { defender: true, label: `ITAC.action.${df.defence}` }));
        waiting = true;
      } else if (!K.rollFinal(I, key)) waiting = true;
    }
    if (waiting) { R.wait = true; return R; }
    if (!K.flag(I, "afterRoll")) {                                                              // step 6: window after the roll (catalog data: Indomitable, double pushes ... P6)
      K.setFlag(I, "afterRoll"); I.data.window = "afterRoll";
      R.prompts.push(...K.windowPrompts(v, I, "afterRoll", { reactions: C.reactionsFor }));
      R.events.push({ type: "reactionWindow", when: "afterRoll", waiting: [I.actor] });
      if (R.prompts.length) { R.wait = true; return R; }
    }
    if (runWindow(v, I, R, windowKeys(I, "w:afterRoll:"), "afterRoll") === "wait" || R.push) { R.wait = !R.push; return R; }
    if (!K.rollFinal(I, "attack")) { R.wait = true; return R; }                                 // the push itself: the system's own buttons (spec 11)
    I.data.window = null;
    R.goto = "outcome";
    return R;
  },

  /* hit and defence arithmetic [B2207], [B2446], [B2524], [B2243]; area and full auto [B2542-2543], [R14]: one attack roll against every target's own
     dodge, a failed attack hurts nobody; GM overrides (spec 14.1 setOutcome) win */
  outcome(v, inst) {
    const I = K.draft(inst), R = K.result(I), kind = kindOf(I);
    const atk = K.rollOf(I, "attack"), sixes = K.sixesOf(I, "attack");
    R.events.push({ type: "roll", key: "attack", who: I.actor, attr: atk?.attr, dice: atk?.pool?.total, sixes, ones: atk?.ones ?? 0, pushed: atk?.pushed ?? 0, messageId: atk?.messageId });
    I.data.out = {};
    const dsix = (t) => (I.data.def?.[t]?.defence ? K.sixesOf(I, `def:${t}`) : 0);
    const area = I.data.multi ? attack.resolveAreaAttack({ attackSixes: sixes, targets: I.decl.targets.map((t) => ({ id: t, dodgeSixes: dsix(t) })) }) : null;
    if (area) I.data.budget = area.budget;
    for (const t of I.decl.targets) {
      const df = I.data.def?.[t]?.defence ?? null, forced = I.data.forced?.outcome?.[t], autoMiss = I.data.forced?.autoMiss?.[t];
      const ar = area?.targets.find((x) => x.id === t);
      let o = ar ? { hit: ar.hit, net: ar.net, stunts: ar.stuntsMax, counterattack: null, dodgeMove: df === "dodge" ? ar.dodgeMove : 0 }
        : attack.resolveAttack({ attack: kind, attackSixes: sixes, defence: df, defenceSixes: dsix(t) });
      if (autoMiss) o = { hit: false, net: 0, stunts: 0, counterattack: null, dodgeMove: 0, autoMiss };
      if (forced === true && !o.hit) o = { ...o, hit: true, net: 1, stunts: 0, counterattack: null, dodgeMove: 0, forced: 1 };
      if (forced === false && o.hit) o = { ...o, hit: false, net: 0, stunts: 0, forced: 1 };
      I.data.out[t] = o;
      if (df) { const dr = K.rollOf(I, `def:${t}`); R.events.push({ type: "roll", key: `def:${t}`, who: t, attr: dr?.attr, dice: dr?.pool?.total, sixes: K.sixesOf(I, `def:${t}`), ones: dr?.ones ?? 0, pushed: 0, opposed: "attack", messageId: dr?.messageId }); }
      R.events.push({ type: "outcome", target: t, hit: o.hit, net: o.net, blocked: df === "block" && !o.hit, dodged: df === "dodge" && !o.hit, autoMiss: o.autoMiss });
    }
    R.goto = "stunts";
    return R;
  },

  /* step 7: one stunt per six beyond the first, each once per target [B2433], [B2515]; an area attack shares one pool among those hit [R14];
     the GM has the last word [B2218] */
  stunts(v, inst) {
    const I = withOut(inst), R = K.result(I), kind = kindOf(I);
    const hit = I.decl.targets.filter((t) => I.data.out[t]?.hit), budget = budgetOf(I, hit);
    const ws = weaponOf(v, I)?.stunts, options = (vv, II, hh) => (ws === "none" ? [] : ws === "doubleOnly" ? optionsAll(vv, II, hh).filter((o) => o.data?.stunt === "doubleDamage" && !o.data.onExtra) : optionsAll(vv, II, hh));      // nobody is brought in by a stunt the power does not allow, so no bystander is on the card      // P6: what the power lets a surplus six do
    if (!hit.length || budget < 1 || !options(v, I, hit).some((o) => !o.disabled)) { I.data.stunts = I.data.stunts ?? []; R.goto = "damage"; return R; }
    if (!I.data.pk?.stunts) { R.prompts.push({ key: "stunts", kind: "stunts", to: K.addressee(v, I.actor), about: I.actor, multi: 1, min: 0, max: budget, options: options(v, I, hit), data: { budget, multi: I.data.multi ?? null } }); R.wait = true; return R; }
    if (!K.isAnswered(v, I, "stunts")) { R.wait = true; return R; }
    const picks = picksOf(K.answerOf(v, I, "stunts"));
    let waiting = false;
    const approved = [];
    picks.forEach((p, i) => {
      /* Disarm in slugfest [B2439]: the attacker keeps the item or throws it into an adjacent zone; a shot only makes it drop [B2519] */
      if (p.stunt === "disarm" && attack.ATTACKS[kind]?.family === "slugfest") {
        const dk = `dis:${i}`;
        if (!I.data.pk?.[dk]) {
          const zk = v.facts.zone(p.target)?.key, near = v.facts.zones && zk ? (v.facts.zones.borders(zk) ?? []).map((b) => String(b?.key ?? "").split("|").find((z) => z && z !== zk)).filter(Boolean).slice(0, 12) : [];
          R.prompts.push({ key: dk, kind: "disarm", to: K.addressee(v, I.actor), about: I.actor, options: [{ id: "keep", label: "ITAC.opt.disarmKeep" }, ...near.map((z) => ({ id: `to:${z}`, label: "ITAC.opt.disarmThrow", data: { zone: z } })), ...(near.length ? [] : [{ id: "throw", label: "ITAC.opt.disarmThrowAny" }])], data: { target: p.target } });
          waiting = true; return;
        }
        if (!K.isAnswered(v, I, dk)) { waiting = true; return; }
        p.how = K.answerId(v, I, dk);
      }
      const card = GM_STUNTS[p.stunt] ?? (v.facts.zones ? null : NO_MAP_STUNTS[p.stunt]);
      if (!card) { approved.push(p); return; }
      const key = `gs:${i}`;                                                                    // own and special stunts [B2442], the item of a Disarm; without a map also the direction of a forced move [R7]
      if (!I.data.pk?.[key]) { R.prompts.push({ key, kind: card, to: "gm", about: p.target, options: [{ id: "approve", label: "ITAC.opt.approve" }, { id: "refuse", label: "ITAC.opt.refuse" }], free: 1, data: { stunt: p.stunt, target: p.target, by: I.actor, ...(p.how ? { how: p.how } : {}) } }); waiting = true; }
      else if (!K.isAnswered(v, I, key)) waiting = true;
      else if (K.answerId(v, I, key) === "approve") { const a = K.answerOf(v, I, key); approved.push({ ...p, gm: 1, ...(typeof a?.text === "string" && a.text ? { text: a.text.slice(0, 80) } : {}) }); }
    });
    if (waiting) { R.wait = true; return R; }
    I.data.stunts = approved;
    I.data.extras = [];
    for (const p of approved) {
      R.events.push({ type: "stunt", target: p.target, stunt: p.stunt, ...(p.extra ? { extra: p.extra } : {}) });
      if (p.extra && EXTRA_STUNTS.includes(p.stunt) && !I.data.out[p.extra]) {                  // [B2437], [B2518]: the extra opponent is hit as well
        I.data.extras.push({ id: p.extra, of: p.target, stunt: p.stunt });
        I.data.out[p.extra] = { hit: true, net: 1, stunts: 0, counterattack: null, dodgeMove: 0, extra: p.stunt, of: p.target };
      }
    }
    R.goto = "damage";
    return R;
  },

  /* step 8 and spec 9.5 steps 1-6: pulled punch, Double Damage before Armor, the single best Armor, then Health (or Resolve). An extra opponent of
     Bang Heads takes half the attacker's STRENGTH [B2437], [B2444], of Trick Shot the base Damage [B2518]. A minion group loses one member per point
     [B2828]; for an area attack, full auto, Bang Heads and Trick Shot the GM enters how many fall [OQ-1]. */
  damage(v, inst) {
    const I = withOut(inst), R = K.result(I), kind = kindOf(I), entry = v.entry(I), w = weaponOf(v, I), a = v.facts.c(I.actor);
    I.data.dmg = I.data.dmg ?? {};
    let waiting = false;
    for (const t of allTargets(I)) {
      const o = I.data.out[t];
      if (!o?.hit || I.data.dmg[t] || kind === "grapple" || entry?.damage?.none || (w?.noDamage && !w.pierce && !o.extra)) continue;      // [R5]: the grapple that takes hold does no damage; P6: nor does a Snare
      const tf = v.facts.c(t);
      if (!tf) continue;
      const doubled = (I.data.stunts ?? []).some((p) => p.stunt === "doubleDamage" && p.target === t);          // [B2434]
      const forced = I.data.forced?.damage?.[t];
      const { tags, base, ar, hd } = hitMath(v, I, t, o, forced, doubled);
      let taken = Number.isFinite(forced?.amount) ? Math.max(0, forced.amount) : hd.taken;
      const pierce = w?.noDamage && w.pierce && !o.extra ? { pierced: taken > 0 } : null;                       // P6 [B1574], [B1625]: no damage, but it has to get through the Armor
      if (pierce) taken = 0;
      if (!tags.toStress && M.hasStatus(v.state, t, "intangible") && !Number.isFinite(forced?.amount)) taken = 0;   // P6 [B1941]
      if (tf.kind === "minions" && !tags.toStress && !Number.isFinite(forced?.amount) && (I.data.multi || o.extra || K.quickCard(v, t)) && taken > 0) {     // [OQ-1]; U61: a quickly settled group is always asked on its one card
        const ml = K.minionLoss(v, I, R, t, taken, { by: I.actor });
        if (ml.wait) { waiting = true; continue; }
        taken = ml.taken;
      }
      const rec = { base, raw: hd.raw, doubled, armor: hd.armor, armorSource: ar.source?.id ?? null, taken, tags, forced: forced ? 1 : undefined, ...(o.extra ? { extra: o.extra } : {}), ...(pierce ?? {}) };
      const through = taken;                                                                                    // what got past the Armor (a Barrier is breached by this, whoever takes it then)
      if (!tags.toStress && !pierce) { const ab = K.copiesAbsorb(v, R, t, taken); if (ab.copies) { taken = rec.taken = ab.taken; rec.copies = ab.copies; } }      // P6 [B1910], [B1916]: the copies take it first
      if (tf.pass?.absorb && !tags.toStress && !ar.source?.barrier && Math.min(hd.raw, hd.armor) > 0) {         // P6 [B1887]: a die per point the Protection stopped, for the next turn
        const tk = M.makeToken({ id: `ea${I.id}x${t}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40), holder: t, dice: Math.min(hd.raw, hd.armor), scope: { attrs: ["fighting", "strength", "agility"] }, uses: 1, stacks: true, source: { kind: "power", owner: t, name: "Energy Absorption" }, expires: { at: "turnEndOf", who: t } });
        if (tk) R.effects.push({ t: "state", path: ["tokens", `#${tk.id}`], to: tk });
      }
      if (tags.toStress) {
        const s = damage.applyStress({ resolve: tf.resolve, stress: taken });                                   // [B1591], [B2816]
        rec.resolveBefore = tf.resolve; rec.resolveAfter = s.resolve;
        if (s.lost) R.effects.push({ t: "actor", who: t, path: "resolve", to: s.resolve });
      } else {
        const ad = damage.applyDamage({ health: tf.health, taken });                                            // [B2707], [B2708]
        Object.assign(rec, { healthBefore: tf.health, healthAfter: ad.health, broken: ad.broken, newlyBroken: ad.newlyBroken });
        if (tf.kind === "minions") rec.minions = { removed: tf.health - ad.health, left: ad.health };           // [B2828]: one member per point
        if (taken > 0 && ad.health !== tf.health) R.effects.push({ t: "actor", who: t, path: "health", to: ad.health });
        if (damage.barrierBreached(ar.source, through)) { rec.barrierBreached = ar.source.id; for (const x of M.effectEndWrites(v.state, ar.source.id)) R.effects.push({ t: "state", path: x.path, to: x.to }); }      // [B1859], [R13]: a breached Barrier is gone
      }
      I.data.dmg[t] = rec;
      R.events.push({ type: "damage", target: t, base, doubled, armor: hd.armor, taken, toStress: tags.toStress, dtype: tags.source, source: tags.cause });
    }
    if (waiting) { R.wait = true; return R; }
    R.goto = "reactAfterDamage";
    return R;
  },

  /* step 9: window after damage (Redirecting Blast, injury re-rolls ...: catalog data, P6) */
  reactAfterDamage(v, inst) {
    const I = K.draft(inst), R = K.result(I);
    if (!K.flag(I, "afterDamage")) {
      K.setFlag(I, "afterDamage"); I.data.window = "afterDamage";
      R.prompts.push(...K.windowPrompts(v, I, "afterDamage", { reactions: C.reactionsFor }));
      if (R.prompts.length) { R.events.push({ type: "reactionWindow", when: "afterDamage", waiting: R.prompts.map((p) => p.about) }); R.wait = true; return R; }
    }
    if (runWindow(v, I, R, windowKeys(I, "w:afterDamage:"), "afterDamage") === "wait" || R.push) { R.wait = !R.push; return R; }
    I.data.window = null;
    R.goto = "effects";
    return R;
  },

  /* step 10: immediate rolls, broken and injuries, statuses, counterattack or dodge move on a miss, then the forced moves of Knockback and Slam */
  effects(v, inst) {
    const I = withOut(inst), R = K.result(I), kind = kindOf(I), Z = v.facts.zones;
    const picked = (t, s) => (I.data.stunts ?? []).some((p) => p.target === t && p.stunt === s);
    const once = (k) => { if (K.flag(I, k)) return false; K.setFlag(I, k); return true; };
    for (const t of allTargets(I)) {
      const o = I.data.out[t], dm = I.data.dmg?.[t], tf = v.facts.c(t);
      if (!o || !tf) continue;
      if (o.hit) {
        if (kind === "grapple" && once(`grap:${t}`)) {                                          // [B2496], [R5]
          R.effects.push({ t: "status+", who: t, status: { id: "grappled", source: { kind: "stunt", owner: I.actor, name: "grapple" }, data: { by: I.actor } } });
          R.effects.push({ t: "status+", who: I.actor, status: { id: "grappling", source: { kind: "stunt", owner: I.actor, name: "grapple" }, data: { held: t } } });
          R.events.push({ type: "status", target: t, status: { id: "grappled", on: true } });
        }
        if (picked(t, "trap") && once(`trap:${t}`)) {                                           // [B2438], [R20]
          R.effects.push({ t: "status+", who: t, status: { id: "trapped", source: { kind: "stunt", owner: I.actor, name: "trap" } } });
          R.events.push({ type: "status", target: t, status: { id: "trapped", on: true } });
        }
        const dis = (I.data.stunts ?? []).find((p) => p.target === t && p.stunt === "disarm");
        if (dis && once(`dis:${t}`)) {                                                          // [B2439], [B2519]: the item changes hands or lies on the ground (spec 6.6)
          const how = dis.how ?? "drop", zone = how.startsWith("to:") ? how.slice(3) : how === "keep" ? null : v.facts.zone(t)?.spot ?? null;
          const item = M.makeGroundItem({ id: `d${I.id}x${t}`.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40), name: dis.text ?? "", owner: t, state: how === "keep" ? "taken" : "ground", ...(how === "keep" ? { holder: I.actor } : {}), ...(zone ? { zone } : {}) });
          if (item) R.effects.push({ t: "state", path: ["items", `#${item.id}`], to: item });
          R.effects.push({ t: "status+", who: t, status: { id: "itemLost", source: { kind: "stunt", owner: I.actor, name: "disarm" }, data: { item: dis.text ?? "", how } } });
          R.events.push({ type: "status", target: t, status: { id: "itemLost", on: true } });
        }
        const w = weaponOf(v, I), oh = o.extra || kind === "counterattack" ? null : w?.onHit;       // P6: what a power's hit does beside (or instead of) damage
        if (oh && (!w.pierce || dm?.pierced) && (!oh.ifDamage || dm?.taken > 0)) {
          const src = { kind: "power", owner: I.actor, name: w.of ?? w.name ?? "" };
          const st = oh.status ?? (oh.burn ? "burning" : null);
          if (st && once(`oh:${t}`)) { R.effects.push({ t: "status+", who: t, status: { id: st, source: src, ...(oh.data ? { data: oh.data } : {}) } }); R.events.push({ type: "status", target: t, status: { id: st, on: true } }); }
          if (oh.stun && !M.outOfAction(v.state, t, tf)) {                                         // [B1625-1627], [B1865]: PRESENCE (no action) or the next turn is lost; [B2707] not asked of one who is out of action
            const key = `ohs:${t}`, rs = (oh.resist ?? 0) + (tf.pass?.resist ?? 0);
            if (!K.rollOf(I, key)) { const { pool } = K.buildPool(v, I, key, t, "presence", rs ? [{ source: "resist", dice: rs }] : []); R.effects.push(K.rollEffect(key, t, "presence", pool, { passive: true, label: "ITAC.stunt.stun" })); R.wait = true; return R; }
            if (!K.rollFinal(I, key)) { R.wait = true; return R; }
            if (once(key) && K.sixesOf(I, key) < 1) {
              R.effects.push({ t: "state", path: ["ledger", t], to: P1.loseNextTurn(P1.ledgerOf(v.state, t), src) });
              R.effects.push({ t: "status+", who: t, status: { id: "stunned", source: src } });
              R.events.push({ type: "status", target: t, status: { id: "stunned", on: true } });
            }
          }
          if (oh.throw && once(`oht:${t}`)) (I.data.notes ??= []).push({ note: "throwByHand", target: t, damage: oh.throw });      // [B1826]: the GM moves the one thrown
        }
        const stun = picked(t, "stun") ? "stun" : picked(t, "suppressed") ? "suppressed" : null;
        if (stun && dm && stunts.stunOutcome({ taken: dm.taken }).rollNeeded && !M.outOfAction(v.state, t, tf)) {      // [B2707]: a target the blow broke rolls for nothing; it is out of action anyway                 // [B2436], [B2517]
          const key = `stun:${t}`;
          if (!K.rollOf(I, key)) { const { pool } = K.buildPool(v, I, key, t, "presence"); R.effects.push(K.rollEffect(key, t, "presence", pool, { passive: true, label: `ITAC.stunt.${stun}` })); R.wait = true; return R; }   // [A-2]: "no action" reaction rolls are passive
          if (!K.rollFinal(I, key)) { R.wait = true; return R; }
          if (once(key) && stunts.stunOutcome({ taken: dm.taken, presenceSixes: K.sixesOf(I, key) }).losesTurn) {   // [R10]
            R.effects.push({ t: "state", path: ["ledger", t], to: P1.loseNextTurn(P1.ledgerOf(v.state, t), { kind: "stunt", owner: I.actor, name: stun }) });
            R.effects.push({ t: "status+", who: t, status: { id: "stunned", source: { kind: "stunt", owner: I.actor, name: stun } } });
            R.events.push({ type: "status", target: t, status: { id: "stunned", on: true } });
          }
        }
        if (dm && Veh.afterHit(v, I, R, t, dm)) return R;                                                  // P7 [B3221-3248]: component damage, the wreck, the people aboard
        if (dm && K.minionsFate(v, I, R, t, dm, { by: I.actor })) return R;                     // [B2828]: knocked out or killed, the GM's word
        if (dm && !Veh.isMachine(v, t) && K.brokenAndCrit(v, I, R, t, dm, { deadlyHit: picked(t, "deadlyHit"), by: I.actor })) return R;       // spec 9.5 steps 7-9
      } else if (o.counterattack && I.data.def?.[t]?.defence === "block" && !M.outOfAction(v.state, t, tf)) {      // [B2448], [R4]; [B2707]
        const key = `counter:${t}`;
        if (!I.data.pk?.[key]) {
          const r = v.facts.range(t, I.actor), opt = { id: "counter", label: "ITAC.opt.counter", data: { sixes: o.counterattack.sixes } };
          if (r && r.total !== 0) opt.disabled = "outOfReach";                                  // [OQ-10] provisional: only within the blocker's slugfest reach unless the GM allows
          const p = { key, kind: "counter", to: K.addressee(v, t), about: t, options: [opt, { id: K.PASS, label: "ITAC.opt.pass" }] };
          if (opt.disabled) p.auto = { option: K.PASS, reason: "noOption" };
          R.prompts.push(p); R.wait = true; return R;
        }
        if (!K.isAnswered(v, I, key)) { R.wait = true; return R; }
        if (once(key) && K.answerId(v, I, key) === "counter") {
          R.events.push({ type: "counter", by: t, against: I.actor, sixes: o.counterattack.sixes });
          R.push = { action: "slugfest", actor: t, decl: { action: "slugfest", weapon: "unarmed", targets: [I.actor], helpers: [], exploits: [], stressTotal: 0 }, cause: "counter", data: { kind: "counterattack", counterSixes: o.counterattack.sixes }, prepaid: 1 };
          return R;
        }
      } else if (o.dodgeMove > 0 && I.data.def?.[t]?.defence === "dodge" && !M.outOfAction(v.state, t, tf)) {      // [B2526]; [B2707]
        const key = `dodgeMove:${t}`;
        if (!I.data.pk?.[key]) {                                                               // with a map the options are the zones the dodger reaches, any way of moving it has, no cost and no stress option
          const zs = Z ? MP.moveOptions(Z, v.state, t, v.facts.c(t), undefined, { free: o.dodgeMove }).filter((x) => !x.disabled && !x.area).slice(0, 50) : [];
          R.prompts.push({ key, kind: "dodgeMove", to: K.addressee(v, t), about: t, options: [...zs.map((x) => ({ id: x.id, label: "ITAC.opt.moveTo", data: { to: x.to, zone: x.zone, mode: x.mode, d: x.d, elevated: x.elevated } })),
            { id: "move", label: "ITAC.opt.dodgeMove", data: { zones: o.dodgeMove } }, { id: K.PASS, label: "ITAC.opt.pass" }], data: { zones: o.dodgeMove } }); R.wait = true; return R; }
        if (!K.isAnswered(v, I, key)) { R.wait = true; return R; }
        if (once(key)) {
          const a = K.answerId(v, I, key), pick = K.promptOf(v, I, key)?.options?.find((x) => x.id === a)?.data;
          if (a === "move") (I.data.notes ??= []).push({ note: "dodgeMoveByHand", target: t, zones: o.dodgeMove });       // no map, or a place the options do not name: by hand
          else if (pick?.to) { R.push = freeMoveChild(t, pick.to, pick.mode, o.dodgeMove); return R; }                  // [B2526]: one transaction with the attack
        }
      }
    }
    /* Knockback [B2435], [B2444]: half the attacker's base STRENGTH in zones; that number is also the damage of the first barrier, one less at each further
       one, reduced by the target's Armor [R8]. The attacker names the direction [R7] (straight away, or toward a neighbouring zone), the GM confirms the chain
       on the forced move's own card (spec 9.5 step 6). Slam [B2494], [R7a]: further along the charge's route for what is left of the move, half STRENGTH
       at every barrier, and the charger keeps moving behind the target. */
    if (Z) for (const p of I.data.stunts ?? []) {
      const t = p.target, str = v.facts.c(I.actor)?.attrs?.strength ?? 0;
      if (!I.data.out[t]?.hit || !v.facts.c(t)) continue;
      if (p.stunt === "knockback" && !K.flag(I, `kb:${t}`)) {
        const key = `kbdir:${t}`, zk = v.facts.zone(t)?.key, near = zk ? (Z.borders(zk) ?? []).map((b) => String(b?.key ?? "").split("|").find((z) => z && z !== zk)).filter(Boolean).slice(0, 12) : [];
        if (!I.data.pk?.[key]) {
          const pr = { key, kind: "knockDir", to: K.addressee(v, I.actor), about: I.actor, options: [{ id: "away", label: "ITAC.opt.kbAway" }, ...near.map((z) => ({ id: `to:${z}`, label: "ITAC.opt.kbToward", data: { zone: z } })), ...vertOf(v, t).map((w) => ({ id: w, label: w === "up" ? "ITAC.opt.kbUp" : "ITAC.opt.kbDown" }))], data: { target: t, distance: stunts.knockbackDistance(str) } };
          if (!near.length) pr.auto = { option: "away", reason: "noOption" };
          R.prompts.push(pr); R.wait = true; return R;
        }
        if (!K.isAnswered(v, I, key)) { R.wait = true; return R; }
        K.setFlag(I, `kb:${t}`);
        const dir = K.answerId(v, I, key) ?? "away", n = stunts.knockbackDistance(str);
        R.push = forcedChild(t, { ...(dir === "up" || dir === "down" ? { direction: dir } : dir.startsWith("to:") ? { toward: dir.slice(3) } : { awayFrom: I.actor }), distance: n, damage: n, decay: 1, armor: true, by: I.actor, kind: "knockback" });
        return R;
      }
      if (p.stunt === "slam" && I.data.charge?.left > 0) {
        if (!K.flag(I, `slam:${t}`)) {
          K.setFlag(I, `slam:${t}`);
          R.push = forcedChild(t, { awayFrom: I.data.charge.prev, distance: I.data.charge.left, damage: stunts.slamDamage(str), decay: 0, armor: true, by: I.actor, kind: "slam" });
          return R;
        }
        const spot = v.facts.zone(t)?.spot;
        if (spot && spot !== v.facts.zone(I.actor)?.spot && !I.data.res?.slamFollow) { R.effects.push({ t: "zput", key: "slamFollow", who: I.actor, to: spot, group: [] }); R.wait = true; return R; }
      }
    }
    R.goto = "close";
    return R;
  },

  /* step 11 */
  close(v, inst) {
    const I = withOut(inst), R = K.result(I);
    if (!I.data.result) I.data.result = I.decl.targets.some((t) => I.data.out?.[t]?.hit) ? "hit" : "miss";
    R.effects.push({ t: "fact", who: I.actor, facts: { attacked: 1, acted: 1, tags: v.entry(I)?.tags ?? [] } });     // spec 4.2 history
    R.done = true;
    return R;
  },
};

/* ------------------------------------------------------------------ stunt options and validation */
const stuntKind = (I) => { const k = kindOf(I); return k === "ram" ? "slugfest" : k; };
/** U90 (ruling U17-R1). The "additional opponent in the same zone" of Bang Heads [B2437] and Trick Shot [B2518]: a character who stands in the zone
    of the target that was hit, on that target's side (hero side / NPC side: the `npc` fact, a hero's summoned allies with the heroes [B1808]) and is
    not a target of this attack already. Never the attacker, somebody defeated or gone, a challenge or a vehicle (no opponents: things), and nobody
    the attacker does not know of: one the attacker has as "unseen", or, for an attacker of the heroes' side (whose player reads the card), one the
    GM keeps hidden (spec 10: the list must not give such a figure away). Before, everybody else in the zone was offered: the attacker's allies too. */
const NO_OPPONENT = ["challenge", "vehicle"];
function othersNear(v, I, t) {
  const tf = v.facts.c(t), a = v.facts.c(I.actor), known = v.state.knowledge?.[I.actor] ?? {};
  if (!tf) return [];
  return (v.facts.inZone(t) ?? []).filter((c) => {
    const f = v.facts.c(c);
    return c !== I.actor && !I.decl.targets.includes(c) && !!f && f.present !== false && !NO_OPPONENT.includes(f.kind) && !!f.npc === !!tf.npc && known[c] !== "unseen" && !(f.hidden === true && !a?.npc);
  });
}
function ctxFor(v, I, t) {
  const tf = v.facts.c(t), w = weaponOf(v, I);
  return { attack: stuntKind(I), target: K.immunityFlags(tf), sharp: !!(v.entry(I)?.damage?.sharp ?? w?.sharp), zoneEmpty: !!v.facts.zone(t)?.empty, movementLeft: I.data.charge?.left ?? 0, otherOpponents: othersNear(v, I, t).length };   // [G-L7]: `huge` only for real huge creatures
}
/* the shared pool: an ordinary attack has the sixes of its one target; an area attack or full auto the attack's own sixes beyond the first [R14] */
const budgetOf = (I, hit) => (I.data.multi ? Math.max(0, I.data.budget ?? 0) : Math.max(0, ...hit.map((t) => I.data.out[t].stunts)));
/** Options of the stunt prompt. Ids: "<stunt>@<target>" for a target that was hit; "<stunt>@<target>|<extra>" for Bang Heads / Trick Shot naming the extra
    opponent; "<stunt>@<extra>" for a further stunt on an extra opponent (legal only together with the pick that brings that opponent in). */
function optionsAll(v, I, hit) {
  const out = [], more = [], seen = new Set();
  const add = (o, list = out) => { if (!seen.has(o.id)) { seen.add(o.id); list.push(o); } };
  for (const t of hit) {
    const near = othersNear(v, I, t);
    for (const o of stunts.stuntOptions(ctxFor(v, I, t))) {
      if (EXTRA_STUNTS.includes(o.id) && near.length) { for (const x of near) add({ id: `${o.id}@${t}|${x}`, label: `ITAC.stunt.${o.id}`, data: { stunt: o.id, target: t, extra: x }, ...(o.ok ? {} : { disabled: o.reason }) }); continue; }
      add({ id: `${o.id}@${t}`, label: `ITAC.stunt.${o.id}`, data: { stunt: o.id, target: t, gm: o.gm || !!GM_STUNTS[o.id] }, ...(o.ok ? {} : { disabled: o.reason }) });
    }
    if (stunts.STUNTS_BY_ATTACK[stuntKind(I)]?.some((s) => EXTRA_STUNTS.includes(s))) for (const x of near) for (const o of stunts.stuntOptions(ctxFor(v, I, x))) {
      if (NOT_ON_EXTRA.includes(o.id)) continue;
      add({ id: `${o.id}@${x}`, label: `ITAC.stunt.${o.id}`, data: { stunt: o.id, target: x, onExtra: 1 }, ...(o.ok ? {} : { disabled: o.reason }) }, more);
    }
  }
  return [...out, ...more].slice(0, 60);                                                        // state-pure LIMITS.options: the stunts of the targets hit come first
}
const picksOf = (value) => (Array.isArray(value) ? value : []).map((id) => /^([A-Za-z]+)@([^|]+)(?:\|(.+))?$/.exec(String(id))).filter(Boolean).map((m) => ({ stunt: m[1], target: m[2], ...(m[3] ? { extra: m[3] } : {}) }));
/** Is a multi answer legal as a whole? Budget, once per target, exclusions (stunts.validateStunts); the per-target cap of area attacks [A-3], [G-L9];
    an extra opponent is named once and may take further stunts only when a pick brings it in. */
export function validate(v, inst, prompt, value, staff = false) {
  if (prompt.kind === "reaction" && !staff) {                                                    // what was offered when the window opened is asked again when it is taken: the action may be gone [B2447], [B2525]
    const id = typeof value === "string" ? value : value?.id, cid = prompt.about;
    if (!id || id === K.PASS || !cid) return { ok: true };
    const e = id.startsWith("r:") ? C.reactionsFor(v.state, cid, prompt.data?.when, v.facts).find((x) => `r:${x.id}` === id) : null;
    const now = e ? K.reactionOption(v, cid, e, inst) : inst.decl.targets.includes(cid) ? defencePrompt(v, inst, cid).options.find((o) => o.id === id) : null;
    return now?.disabled ? { ok: false, reason: now.disabled } : { ok: true };
  }
  if (prompt.kind !== "stunts") return { ok: true };
  const picks = picksOf(value), out = inst.data.out ?? {}, multi = inst.data.multi;
  const hit = inst.decl.targets.filter((t) => out[t]?.hit);
  const prim = picks.filter((p) => hit.includes(p.target)), sec = picks.filter((p) => !hit.includes(p.target));
  const extras = prim.filter((p) => p.extra).map((p) => p.extra);
  if (new Set(extras).size !== extras.length) return { ok: false, reason: "chosen" };
  for (const p of prim) if (EXTRA_STUNTS.includes(p.stunt) && !(p.extra && othersNear(v, inst, p.target).includes(p.extra))) return { ok: false, reason: "noOtherTarget" };
  const sixes = multi ? K.sixesOf(inst, "attack") : Math.max(0, ...hit.map((t) => out[t].net));
  const r = stunts.validateStunts({ picks: prim.map((p) => ({ stunt: p.stunt, target: p.target })), sixes, ctxFor: (t) => ctxFor(v, inst, t), targets: multi ? inst.decl.targets.map((t) => ({ id: t, hit: !!out[t]?.hit, stuntsMax: out[t]?.stunts ?? 0 })) : null });
  if (!r.ok) return { ok: false, reason: r.errors[0].reason };
  if (picks.length > budgetOf(inst, hit)) return { ok: false, reason: "budget" };
  if (!multi) for (const t of new Set(prim.map((p) => p.target))) if (prim.filter((p) => p.target === t).length > (out[t]?.stunts ?? 0)) return { ok: false, reason: "budget" };
  const chosen = new Map();
  for (const p of sec) {                                                                         // further stunts on an extra opponent [B2437], [B2518]
    if (!extras.includes(p.target) || NOT_ON_EXTRA.includes(p.stunt)) return { ok: false, reason: "notHit" };
    const prev = chosen.get(p.target) ?? [], opt = stunts.stuntOptions({ ...ctxFor(v, inst, p.target), chosen: prev }).find((o) => o.id === p.stunt);
    if (!opt?.ok) return { ok: false, reason: opt?.reason ?? "notOffered" };
    chosen.set(p.target, [...prev, p.stunt]);
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ letting go of a grapple [B2497]: no action, no roll */
export const release = {
  STEPS: Object.freeze(["do", "close"]),
  legality(v, inst) { return M.hasStatus(v.state, inst.actor, "grappling") ? { ok: true, reason: null, params: {}, gates: [], notes: [] } : bad("notHolding"); },
  revalidate() { return { ok: true, reasons: [] }; },
  steps: {
    do(v, inst) {
      const I = K.draft(inst), R = K.result(I);
      for (const e of K.grappleRelease(v.state, I.actor)) R.effects.push(e);
      const held = M.statusesOf(v.state, I.actor).find((s) => s.id === "grappling")?.data?.held;
      if (held) R.events.push({ type: "status", target: held, status: { id: "grappled", on: false } });
      I.data.result = "released"; R.goto = "close"; return R;
    },
    close(v, inst) { const I = K.draft(inst), R = K.result(I); R.done = true; return R; },
  },
};
