/* Tactical combat, package P2: shared helpers of the flows (spec 5.3 step contract). NO Foundry globals.
   A flow exports { STEPS, legality(v, inst), revalidate(v, inst), validate?(v, inst, prompt, value), steps: { [stepId]: (v, inst) => Result } }.
   v = { state, facts, entry(inst) } is read-only. A step is RE-ENTRANT: the engine calls it again after every answer, roll result or popped child, and the step
   reads what it already did from `inst.data` (flags in data.ph, prompt ids in data.pk, results in data.res). It returns
     { inst,            the updated copy (use draft())
       effects: [...],  requests to the executor, performed in order and journaled: see engine-pure.mjs "effects"
       prompts: [...],  prompt specs to open ({ key, kind, to, about?, options, multi?, min?, max?, free?, gmOnlyData?, auto? })
       events:  [...],  section 16 events
       push:    spec of an action instance to put on top of the stack (interrupt, counterattack, part of a composite)
       goto:    next step id | wait: true | done: true } */
import { dice, crits, conditions, attack, chase, damage } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";
import { holderBlocks } from "../catalog-pure.mjs";
import { modsFor } from "../kit-pure.mjs";

export const PASS = "pass";
/** U11: "no reaction until the round ends": the standing answer of somebody who is not the target (an absent player, a bystander who will not step in). */
export const PASS_ROUND = "pass:round";
export const passKey = (cid) => M.counterKey.round(cid, "passWindows");
/* How likely, in words: the bands every surface names a chance with (ui/model-pure draws them; the defender's card gets the band of each
   answer from the engine, never the number: U11). */
export const BANDS = Object.freeze([{ id: "unlikely", below: 0.35 }, { id: "even", below: 0.6 }, { id: "likely", below: 0.8 }, { id: "nearCertain", below: 2 }]);
export const bandOf = (p) => BANDS.findIndex((b) => p < b.below);
export const draft = (inst) => JSON.parse(JSON.stringify(inst));
export const result = (inst) => ({ inst, effects: [], prompts: [], events: [], drop: [], push: null, goto: null, wait: false, done: false });      // drop: keys of cards to withdraw (engine-pure stepOnce)
export const flag = (I, k) => !!I.data.ph?.[k];
export const setFlag = (I, k) => { (I.data.ph ??= {})[k] = 1; };

/** Who answers for a combatant: its player owners; the GM desk for NPCs and for characters nobody else owns (spec 5.4, 13.1). */
export function addressee(v, cid) {
  const c = v.facts.c(cid);
  const users = (c?.owners ?? []).filter((u) => !v.facts.user(u)?.staff);
  return !c || c.npc || !users.length ? "gm" : { users };
}
export const promptOf = (v, inst, key) => v.state.prompts[inst.data.pk?.[key]] ?? null;
export const isAnswered = (v, inst, key) => !!promptOf(v, inst, key)?.answered;
/** The answer's option id (a value may be "id", { id, ... } or, for multi prompts, an array). */
export const answerOf = (v, inst, key) => promptOf(v, inst, key)?.answered?.value;
export const answerId = (v, inst, key) => { const a = answerOf(v, inst, key); return typeof a === "string" ? a : a && !Array.isArray(a) ? a.id : undefined; };

export const rollOf = (inst, key) => inst.rolls?.[key] ?? null;
export const rollRolled = (inst, key) => { const r = rollOf(inst, key); return !!r && (r.forced != null || r.sixes != null); };
/** A roll is final when its result is in and it can no longer be pushed (accepted, pushed out, or never pushable), or when the GM forced it (spec 14.1 setSixes). */
export const rollFinal = (inst, key) => { const r = rollOf(inst, key); return !!r && (r.forced != null || (r.sixes != null && !r.pushable)); };
export const sixesOf = (inst, key) => { const r = rollOf(inst, key); return r ? (r.forced?.sixes ?? r.sixes ?? 0) : 0; };

/** The immunity flags of a target as the rules library reads them (stunts.immunitiesOf): `huge`, `grown`, `impervious` and a free
    list `immune`. Which character carries which flag is the GM's word (actor flags, system-adapter.mjs); nothing is decided here. */
/** P6: something a kit action switched on for the round (a wind-up) or for the scene (an activation): flows/acts.mjs kind "mark" */
export const marked = (state, cid, id, scene = false) => M.counterGet(state, scene ? M.counterKey.scene(cid, id) : M.counterKey.round(cid, id)) > 0;
/** P6 [B1808]: the summoned groups of a combatant that leave by themselves (not a controlled animal, not what the GM marked by hand) */
export const summonsOf = (v, cid) => (v.state.summons ?? []).filter((su) => su.owner === cid).flatMap((su) => su.combatants ?? []).filter((id) => v.facts.c(id)?.summon?.auto);
export const immunityFlags = (tf) => ({ kind: tf?.kind, huge: !!tf?.huge, grown: !!tf?.grown, impervious: !!tf?.impervious, immune: Array.isArray(tf?.immune) ? tf.immune.slice() : [] });

/* ------------------------------------------------------------------ catalog predicates (spec 8: `requires`, `roll.mods`)
   The catalog writes a predicate as data; rules/conditions.mjs answers it against a read-only snapshot. This file only makes the snapshot
   and supplies the checks that are plain questions to the state. A check nobody supplies, and a `{ gm: id }` condition, need the GM's
   word: `gmMayAllow` (the player may ask for an exception, spec 9.12; the GM confirms an id with `decl.confirmed`).
     snapshot = { actor, target, decl, round, mode, onTurn, range: { total, borders, levels } | null, sameZone, zone, targetZone,
                  statuses: [id], targetStatuses: [id], budget } */
const plainC = (c) => (c ? JSON.parse(JSON.stringify(c)) : null);
export function snapshot(v, inst, target = null) {
  const f = v.facts, a = inst.actor, t = target ?? inst.decl?.targets?.[0] ?? null;
  const rg = a && t ? f.range?.(a, t) : undefined;
  return {
    actor: plainC(a ? f.c(a) : null), target: plainC(t ? f.c(t) : null), decl: inst.decl ?? {}, round: v.state.round, mode: v.state.mode,
    onTurn: a ? P1.isOnTurn(v.state, a) : false, range: rg ?? null, sameZone: rg ? rg.total === 0 : false,
    zone: a ? f.zone?.(a) ?? null : null, targetZone: t ? f.zone?.(t) ?? null : null,
    statuses: a ? M.statusesOf(v.state, a).map((s) => s.id) : [], targetStatuses: t ? M.statusesOf(v.state, t).map((s) => s.id) : [],
    budget: a ? P1.budget(v.state, a) : null,
  };
}
/** the checks a predicate may name: questions to the state, no rule of their own */
export const checksFor = (v, inst) => ({
  history: ({ scope = "thisTurn", tag, who } = {}) => P1.history(v.state, who ?? inst.actor, scope, tag),             // "did X already ... this turn / round"
  hasStatus: ({ id, who } = {}) => M.statusesOf(v.state, who ?? inst.actor).some((s) => s.id === id),
  inRange: ({ min = 0, max = 0 } = {}, snap) => (snap.range ? snap.range.total >= min && snap.range.total <= max : { ok: false, reason: "noRange", gmMayAllow: true }),
});
const confirmedOf = (inst) => (Array.isArray(inst.decl?.confirmed) ? inst.decl.confirmed : []);
/** `requires` of the entry, for every target (once when there is none). -> { ok } | { ok:false, reason:"requirement", params:{ why, target?, gmMayAllow } } */
export function requirements(v, inst) {
  const entry = v.entry(inst);
  if (!entry?.requires) return { ok: true };
  const targets = inst.decl?.targets?.length ? inst.decl.targets : [null];
  for (const t of targets) {
    const r = conditions.evalConds(Array.isArray(entry.requires) ? entry.requires : [entry.requires], snapshot(v, inst, t), { checks: checksFor(v, inst), confirmed: confirmedOf(inst) });
    if (!r.ok) return { ok: false, reason: "requirement", params: { why: String(r.reason ?? "").slice(0, 60), ...(t ? { target: t } : {}), ...(r.gmMayAllow ? { gmMayAllow: 1 } : {}) } };
  }
  return { ok: true };
}
/** U9: why a combatant has nothing to do on its own turn, or null. Dead or unconscious: nothing at all [B2707], [B2749]. Broken: the one
    thing left is to try to get up, on the own turn [B2773]; whoever cannot even do that (an injury of 9 or worse, the primary copy of
    Sequestered Original [B1915]) has nothing either. A broken character that may rally keeps its turn. */
export function sitsOut(state, cid, c) {
  const out = M.outOfAction(state, cid, c);
  /* ANSH (P8g-3, the user 2026-11-12: «Przechodzi sama»): marked defeated in Foundry during the round, it keeps its card until the next
     draw [D], but its turn passes by itself like the turn of the dead (U9) */
  if (c?.defeated === true && out !== "dead" && out !== "unconscious") return "defeated";
  if (out !== "broken") return out;
  if (M.hasStatus(state, cid, "unconscious")) return "unconscious";
  return crits.canRally({ broken: true, crits: c.crits ?? [], primaryCopy: c.pass?.noRally === true }).ok ? null : "broken";
}
/** Legality of an instance: the entry's requirements, then the flow's own rules. */
export const legality = (v, inst, flow) => {
  /* [B2707] out of action: whatever the flow, a broken, unconscious or dead character declares nothing and is no part of anything */
  const out = inst.actor ? M.outOfAction(v.state, inst.actor, v.facts.c(inst.actor)) : null;
  if (out && !(out === "broken" && flow.whenBroken?.(v, inst))) return { ok: false, reason: out, params: {} };      // the one thing a broken character may try is the flow's to name (rallying [B2773])
  const r = requirements(v, inst);
  if (!r.ok) return r;
  /* [B2497] the holder's own actions, whatever the flow (the attack flow and the action tables say it in their own words; a reaction, a part of
     another action and a child are not the holder's own declaration) */
  if (inst.actor && !inst.parent && !inst.part && !["attack", "act"].includes(inst.flow) && holderBlocks(v.entry(inst)) && holdsTied(v, inst.actor)) return { ok: false, reason: "grappling", params: { gmMayAllow: 1 } };
  return flow.legality(v, inst);
};
/** Conditional modifiers of the entry's roll (`roll.mods`) for the actor's own roll. -> { mods: [{ source, dice }], pending: [...] } */
export function entryMods(v, inst, cid, attr, rollKind) {
  const rules = cid === inst.actor ? v.entry(inst)?.roll?.mods : null;
  if (!Array.isArray(rules) || !rules.length) return { mods: [], pending: [] };
  return conditions.evalModRules(rules, snapshot(v, inst), { attr, roll: rollKind, checks: checksFor(v, inst), confirmed: confirmedOf(inst) });
}

/** Dice pool of a combatant's roll: attribute + modifiers, the worst critical-injury penalty for that attribute [B2709], chosen modifier tokens (spec 6.2),
    a GM override (spec 14.1 setPool), never below one die [B2235] (dice.buildPool). Returns { pool, writes (token spending), needGm }. */
export function buildPool(v, inst, key, cid, attr, mods = [], { rollKind = "other", tokens = [], base = null } = {}) {
  const c = v.facts.c(cid);
  const list = mods.map((m) => ({ ...m }));
  const em = entryMods(v, inst, cid, attr, rollKind);                                // the entry's conditional modifiers (rules/conditions.mjs)
  list.push(...em.mods.map((m) => ({ source: m.source, dice: m.dice })));
  for (const p of em.pending) if (!(inst.data.notes ??= []).some((n) => n.note === "modNeedsGm" && n.source === p.source)) inst.data.notes.push({ note: "modNeedsGm", source: p.source, dice: p.dice, key });   // only the GM's word decides it: shown on the desk, not guessed
  for (const m of kitDice(v, inst, cid, attr, rollKind)) if (!list.some((x) => x.source === m.source)) list.push(m);      // P6: the sheet's bonuses, the kit's dice, Affliction
  /* P7 [B3455], [B3461]: an obstacle of the chase round that makes it hard to see or to keep steady takes its dice from ALL AGILITY rolls
     of that round: the chase roll, a dodge, a shot of the crew. One entry per roll (the chase roll brings it itself, rules/chase.chaseModifiers). */
  const ob = attr === "agility" && v.state.kind === "chase" ? inst.data?.ch?.obstacle ?? (v.state.chase?.rolled === v.state.round ? v.state.chase?.last?.obstacle : null) : null;
  const obDice = ob ? chase.CHASE_OBSTACLES[ob]?.agilityDice : 0;
  if (obDice && !list.some((m) => m.source === ob)) list.push({ source: ob, dice: obDice });
  const pen = attr ? crits.critPenalty(c?.crits ?? [], attr) : 0;
  if (pen && !list.some((m) => m.source === "crit")) list.push({ source: "crit", dice: -pen });
  const rk = { kind: rollKind, attr, inst: inst.id ?? null, up: inst.part ? inst.parent ?? null : null };      // ANSF (P6-5): a token bound to an action counts there only
  const must = M.tokensFor(v.state, cid, rk).filter(M.standing).map((t) => t.id);                // P6: dice somebody else put on the roll (bad luck) are not the roller's to leave out; [B1634]: a plan covers ALL rolls of its kind, attack and defence alike
  const tk = M.spendTokens(v.state, cid, rk, [...new Set([...tokens, ...must])]);
  list.push(...tk.mods.map((m) => ({ source: m.source, dice: m.dice })));
  const forced = inst.data.forced?.pool?.[key];
  if (forced?.mods) list.push(...forced.mods.map((m) => ({ source: `gm:${String(m.label ?? "").slice(0, 24)}`, dice: Math.trunc(Number(m.dice) || 0) })));
  let pool = dice.buildPool(base ?? (attr ? Number(c?.attrs?.[attr]) || 0 : 0), list);
  if (Number.isFinite(forced?.total)) pool = { base: pool.base, mods: [...pool.mods, { source: "gm:total", dice: forced.total - pool.total }], total: forced.total, dice: dice.poolSize(forced.total) };
  return { pool, writes: tk.writes, needGm: tk.needGm };
}
/** P6: what the character's sheet and kit add to a roll of `cid`: the active effects of the sheet (per attribute; block and dodge; the kind of
    attack for the attacker's own attack roll), the dice of talents and gear (kit-pure.modsFor), Affliction [B1574], copies [B1908], Defiance [B1865]. */
export function kitDice(v, inst, cid, attr, rollKind) {
  const c = v.facts.c(cid), out = [], b = c?.bonus ?? {}, add = (source, dice) => { if (dice) out.push({ source, dice: Math.trunc(dice) }); };
  if (!c) return out;
  if (attr) add("sheet", b[attr]);
  if (rollKind === "block" || rollKind === "dodge") add(`sheet:${rollKind}`, b[rollKind]);
  const own = cid === inst.actor, kind = inst.flow === "attack" ? inst.data?.kind ?? "slugfest" : null;
  if (own && rollKind === "attack" && kind) {
    add("sheet:attack", b.attack);
    if (kind === "charge") add("sheet:charge", b.charge);
    if (kind === "charge" && c.pass?.leapCharge > 0 && (inst.data?.charge?.mode ?? inst.decl?.mode) === "leaping") add("kit:leaping", c.pass.leapCharge);      // PWE (PW096) [B2007]: only a charge made by leaping
    if (kind === "grapple") add("sheet:grapple", b.grapple);
    if (["slugfest", "grappleAttack"].includes(kind)) add("sheet:slugfest", b.slugfest);
    const n = copiesOf(v.state, cid);
    if (n > 0 && COPY_ATTACKS.includes(kind)) add("copies", n);                               // [B1908]: every slugfest and shooting attack
    const small = v.facts.c(inst.decl?.targets?.[0])?.pass?.shrunkDice;
    if (small > 0 && !["reason", "intuition", "presence"].includes(attr)) add("shrunk", -small);  // [B1976]: physical attacks against a shrunk character (an attack of the mind is not one)
  }
  if (own && (rollKind === "attack" || rollKind === "other")) {
    const t0 = inst.decl?.targets?.[0];
    for (const m of modsFor(c.kit, { action: inst.action, attack: rollKind === "attack" ? kind : null, attr, target: t0 ? v.facts.c(t0) : null })) add(m.source, m.dice);
  }
  if (!own && rollKind === "other" && inst.flow === "attack" && String(v.entry(inst)?.id ?? "")) { /* a resisting roll inside an attack: see `resist` in the attack flow */ }
  const aff = M.statusesOf(v.state, cid).find((s) => s.id === "afflicted");
  if (aff && attr) add("afflicted", Number.isFinite(aff.data?.dice) ? aff.data.dice : -3);     // [B1574]: every attribute roll
  return out;
}
/** PWE (PW063, PW064) [B1865-1869]: Defiance's dice to resist a power that would afflict the mind (Stun, an entry marked `mind`); none
    while a Defiance that Requires Activation is not activated (the whole power is off until then [B1869]; the Armor reads the same mark, P6b-R12). */
export function defianceDice(v, cid) {
  const c = v.facts.c(cid), n = Math.trunc(Number(c?.pass?.resist) || 0);
  if (!(n > 0)) return 0;
  return c.pass?.defianceOff && !marked(v.state, cid, "defiance", true) ? 0 : n;
}
/** PWE (PW073) [B1925-1928], [B1921]: the holder's dice to resist the held one breaking free (Extra Limb(s) by level, Stretch Grapple +3) */
export const holdDice = (v, cid) => { const p = v.facts.c(cid)?.pass ?? {}; return Math.max(0, Math.trunc(Number(p.limbHold) || 0)) + Math.max(0, Math.trunc(Number(p.stretchHold) || 0)); };
/** PWE (PW070) [B1879]: immune to the damage of a disease or a poison: the Immunity names it (the GM's types), or Full Immunity (non-kinetic) */
const SICK_TYPES = Object.freeze({ disease: ["disease", "diseases", "contagion", "infection", "sickness"], toxin: ["toxin", "toxins", "poison", "poisons", "venom", "toxic"] });
export const immuneToSickness = (tf, toxic = false) => { const list = (tf?.immunities ?? []).map((x) => String(x).toLowerCase().trim()); return list.includes("nonkinetic") || SICK_TYPES[toxic ? "toxin" : "disease"].some((x) => list.includes(x)); };
/** PWE (PW108) [B2075]: what ends when a character is broken: Invisibility. -> effects (pushed with the broken status) */
export const brokenEnds = (state, cid) => (M.hasStatus(state, cid, "invisible") ? [{ t: "status-", who: cid, id: "invisible" }] : []);
/** P6 [B1887] Energy Absorption: a die per point of damage the Protection stopped, whatever made the damage (an attack, a hazard, a fall);
    PWE (PW067, PW068): one token per die, so the dice are spent one at a time, and they last to the end of the holder's NEXT turn (a hit taken
    on the own turn keeps them through the turn after: expiry "nextTurnEndOf", ops-pure turnMoment). -> effects */
export function absorbTokens(tf, t, base, n) {
  const out = [], k0 = String(base).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 34);
  if (!tf?.pass?.absorb || !(n > 0)) return out;
  for (let k = 0; k < Math.min(12, Math.trunc(n)); k++) {
    const tk = M.makeToken({ id: `${k0}d${k}`, holder: t, dice: 1, scope: { attrs: ["fighting", "strength", "agility"] }, uses: 1, stacks: true, source: { kind: "power", owner: t, name: "Energy Absorption" }, expires: { at: "nextTurnEndOf", who: t } });
    if (tk) out.push({ t: "state", path: ["tokens", `#${tk.id}`], to: tk });
  }
  return out;
}
/** [B2238], [B2167]: the dice of those who help; a Supportive helper gives two */
export const helpDiceOf = (v, d) => dice.helpDice((d?.helpers ?? []).filter((h) => h.consent === "yes").map((h) => ({ supportive: v.facts.c(h.id)?.pass?.supportive === true })));
/** the Barriers standing on a character, as Armor sources of the rules library [B1859] */
export const barriersOf = (state, cid) => (state.effects ?? []).filter((e) => e.kind === "barrier" && e.holder === cid).map((e) => ({ id: e.id, armor: Number(e.data?.armor) || 0, barrier: true }));
/** the copy bonus a character has left (Duplication [B1907]: an effect of the state) */
/** Z2 [B1941]: Prolonged Phasing (the status `intangible`) makes the character immune to physical damage: one reading for the attack flow and
    the hazards (fire, a blast, an area, a fall, a barrier). Damage to stress and what is not damage (a poison, the vacuum) still reach it. */
export const phased = (state, cid) => M.hasStatus(state, cid, "intangible");
/** PWA (PW083, PW109) [B1941]: what an intangible character may still do: a mental attack (one that inflicts stress, or is rolled with a
    mental attribute: Mental Distress, Mental Stun ...); reading of question PWA-5. Everything else needs Controlled Phasing's mark. */
export const mentalAttack = (w, entry = null) => entry?.damage?.toStress === true || (!!w && (w.toStress === true || ["reason", "intuition", "presence"].includes(w.attr)));
/** the write that spends the mark of Controlled Phasing [B1942]: solid for a single action */
export const solidSpent = (cid) => ({ t: "state", path: ["counters", M.counterKey.round(cid, "solid")], to: null });
/** PWA (PW072): a holder who can do nothing else while holding [B2497]; Extra Limb(s) holds and acts [B1926] */
export const holdsTied = (v, cid) => M.hasStatus(v.state, cid, "grappling") && v.facts.c(cid)?.pass?.freeHold !== true;
/* FXK2: what keeps `cid` from making an attack of `kind` (the family of the rules library) because of its own body: the same tests, in the
   same order, as the attacker's part of flows/attack legality (check-fxk2 holds the two together) -> a reason id or null.
   Held [B2496] and snared [B1606]: no attack at all; Immobilize Only [B1611]: no charge; carried aloft [B2392]; trapped [B2438]: no
   slugfest, no charge; one who holds somebody makes only the grapple attack [B2497] (Extra Limb(s) [B1926]: freeHold) */
const SLUG_KINDS = ["slugfest", "grapple", "grappleAttack", "counterattack", "ram"];
export function attackerFault(v, cid, kind) {
  const ac = M.conditions(v.state, cid);
  if (ac.held) return "held";
  if (ac.snared) return "snared";
  if (ac.rooted && kind === "charge") return "snared";
  if (ac.carriedAloft) return "carriedAloft";
  if (ac.trapped && (SLUG_KINDS.includes(kind) || kind === "charge")) return "trapped";
  if (M.hasStatus(v.state, cid, "grappling") && kind !== "grappleAttack" && (kind === "grapple" || holdsTied(v, cid))) return "grappling";
  return null;
}
/** Z12 [B1816]: an ally of Delayed Summoning is not there before the start of its summoner's next turn (state.summons[].wait) */
export const notArrived = (state, cid) => (state?.summons ?? []).some((su) => Array.isArray(su?.wait) && su.wait.includes(cid));
export const copiesOf = (state, cid) => Math.max(0, Number((state.effects ?? []).find((e) => e.kind === "copies" && e.holder === cid)?.data?.n) || 0);
/** [B1908]: the copy bonus goes on the duplicator's own attack roll "whether in slugfest or shooting". The charge, the grapple and the
    grapple attack are slugfest attacks by the book ([B2431], [B2490], [B2496], [B2497]: rules/attack.mjs ATTACKS family). Not the ram: the
    vehicle attacks, not the copies [B3148]. The counterattack rolls no dice at all [B2448]. */
export const COPY_ATTACKS = Object.freeze(["slugfest", "shooting", "charge", "grapple", "grappleAttack"]);
/** [B1910]: "When you suffer damage, the damage is first applied to your copy bonus": EVERY place that takes damage off Health calls this
    with the damage left after Armor (an attack, fire, a blast or an area hazard, a fall, a barrier, a slam, a wreck, the GM's own number),
    right before damage.applyDamage. Not for damage an attack turned into stress [B1591]. Pushes the write of the smaller bonus (the effect
    ends at zero) and the stress of Traumatic Duplication [B1916] on R.effects; a second hit in the same step counts from what the first
    one left. -> { taken (what goes on to Health), copies: { absorbed, left } | null } */
export function copiesAbsorb(v, R, t, taken) {
  const ef = (v.state.effects ?? []).find((x) => x.kind === "copies" && x.holder === t);
  if (!ef || !(taken > 0)) return { taken: Math.max(0, Number(taken) || 0), copies: null };
  const path1 = `#${ef.id}`, pend = R.effects.filter((e) => e.t === "state" && e.path?.[0] === "effects" && e.path?.[1] === path1).pop();
  const have = pend ? Math.max(0, Number(pend.to?.data?.n) || 0) : copiesOf(v.state, t);
  if (!(have > 0)) return { taken, copies: null };
  const ab = damage.absorbByCopies({ taken, copies: have });
  R.effects.push({ t: "state", path: ["effects", path1], to: ab.gone ? null : { ...ef, data: { ...ef.data, n: ab.copies } } });
  if (v.facts.c(t)?.pass?.traumatic && ab.absorbed > 0) R.effects.push({ t: "stress", who: t, n: 1 });
  return { taken: ab.taken, copies: { absorbed: ab.absorbed, left: ab.copies } };
}

/** Roll request effect. passive rolls and defender rolls cannot be pushed [B2227], [B2241]. */
export const rollEffect = (key, who, attr, pool, { passive = false, defender = false, secret = false, label = null, noPush = false } = {}) =>
  ({ t: "roll", key, who, attr, pool: { base: pool.base, mods: pool.mods, total: pool.total }, dice: pool.dice, maxPush: passive || defender || noPush ? 0 : null, secret: secret ? 1 : 0, label });

/** Can the instance's actor still act (spec 5.1 revalidation, first bullet)? Returns a reason id or null. */
export function actorBlocked(v, inst) {
  if (!inst.actor) return null;
  const a = v.facts.c(inst.actor);
  if (!a || a.present === false) return "gone";
  const out = M.outOfAction(v.state, inst.actor, a);                                                        // [B2707]
  if (out) return out;
  if (inst.cause === "interrupt" && !P1.canInterrupt(v.state, inst.actor).ok) return "noInterrupts";       // [L7]
  return null;
}
/** A reaction window (spec 9.1 steps 4, 6, 9): prompts for everyone who holds a reaction entry for it (catalog data), nobody else. Returns prompt specs. */
export function windowPrompts(v, inst, when, { skip = [], reactions }) {
  const out = [];
  for (const cid of Object.keys(v.state.ledger)) {
    if (cid === inst.actor || skip.includes(cid)) continue;
    const c = v.facts.c(cid);
    if (!c || c.present === false || M.outOfAction(v.state, cid, c)) continue;                              // [B2707]
    const list = reactions(v.state, cid, when, v.facts).filter((e) => (e.reaction.who === "any" || inst.decl.targets.includes(cid)) && reactionFit(v, inst, cid, e).ok);      // U91: only what the book lets this one do from where it stands
    if (!list.length) continue;
    const options = list.flatMap((e) => reactionOptions(v, cid, e, inst));
    if (!options.some((o) => !o.disabled)) continue;                 // no legal option: skipped automatically (plan 5.2 step 4)
    const target = inst.decl.targets.includes(cid);
    if (!target && M.counterGet(v.state, passKey(cid))) continue;    // U11: said "no reaction this round" already
    /* U11: the card says who attacks whom with what (the view takes the attacker out again for somebody who cannot see it) */
    out.push({ key: `w:${when}:${cid}`, kind: "reaction", to: addressee(v, cid), about: cid, options: [...options, { id: PASS, label: "ITAC.opt.pass" }, ...(target || c.npc ? [] : [{ id: PASS_ROUND, label: "ITAC.opt.passRound" }])],
      data: { when, attacker: inst.actor ?? undefined, action: inst.action, targets: (target ? inst.decl.targets : [...new Set(list.flatMap((e) => reactionFor(v, inst, cid, e)))]).slice(0, 12), ...(target ? {} : { bystander: 1 }) } });      // U91: a bystander's card names only those its answers are about
  }
  return out;
}
/** U91: WHERE a reaction may be taken, and about whom. The book ties some reactions to a place: Guardian answers an attack on "another
    character in your zone" [B2115]; Discretion needs "an ally in the same zone" [B2108]. The entry says so in `reaction.place`
    ("targetZone" / "allyZone"); before U91 nothing read a place, so a guardian two zones away was asked.
    "The same zone" is the same spot, as everywhere else (facts.inZone). Where nobody can say where one of the two stands (no map of
    zones, a combatant without a token) the place is not refused: the GM settles it, as with a grapple (`separated`).
    Nobody is asked about somebody they do not know of (spec 10): a figure the reactor has as "unseen", or, for a reactor of the heroes'
    side (whose player reads the card), one the GM keeps hidden. */
const knownTo = (v, cid, t) => { const f = v.facts.c(t); return !!f && f.present !== false && v.state.knowledge?.[cid]?.[t] !== "unseen" && !(f.hidden === true && !v.facts.c(cid)?.npc); };
const spotOf = (v, id) => v.facts.zone?.(id)?.spot ?? null;
export const sameSpot = (v, a, b) => { const x = spotOf(v, a), y = spotOf(v, b); return x == null || y == null ? null : x === y; };      // null: nobody can say
const NO_ALLY = ["challenge", "vehicle"];
/** The attacked characters a reaction of somebody else may be about: other than the reactor, known to it, and in its zone where the entry asks for that. */
export function reactionFor(v, inst, cid, e) {
  const moved = e?.reaction?.effect === "swapTarget" ? coveredBy(inst) : [];
  const side = e?.reaction?.effect === "warn" || e?.reaction?.effect === "guide" || e?.reaction?.effect === "swapTarget", me = side ? M.teamOf(v.facts.c(cid)) : null;      // ANSE (U17-1): the side by the token      // PWB: Guidance helps "another hero" [B1709], read as Warning Call
  /* U131: Warning Call [B2170] says "another character"; read as one of the warner's own side (provisional, question FXI-1): nobody shouts
     a warning to the opponent an ally of theirs is shooting at. U149: Guardian [B2115] ("another character in your zone is attacked") is read
     the same way (provisional, question UXC-3): nobody dives in to take an ally's blow for the enemy. The GM's own answer may still name anybody. */
  /* ANSEL (A40, seen live): the attacker inside its own area attack is a target too, but nobody warns it of, guides it against or takes for it
     its own blow: it is never somebody else's reaction's subject */
  const list = (inst.decl?.targets ?? []).filter((t) => t !== cid && t !== inst.actor && knownTo(v, cid, t) && !moved.includes(t) && (!side || M.teamOf(v.facts.c(t)) === me));
  /* FXP (U182, ruling FXP-R2): a warning is shouted about an attack the warner sees coming [B2170]: an attacker it does not know of (one
     the GM hides from the heroes, one it has as unseen) gives it nothing to warn about, as no card is made about somebody unknown (U19-R4) */
  if ((e?.reaction?.effect === "warn" || e?.reaction?.effect === "guide") && inst.actor && !knownTo(v, cid, inst.actor)) return [];
  return e?.reaction?.place === "targetZone" ? list.filter((t) => sameSpot(v, cid, t) !== false) : list;
}
/* D104 (ruling A8-R1): who took the hit for somebody by a reaction (Guardian [B2115]: "you take the hit instead of the INTENDED target").
   Such a one is no intended target, so nobody dives in for them in turn; a target the GM set by hand (retarget) is the GM's intent and is. */
export const coveredBy = (inst) => (inst?.data?.retargets ?? []).filter((r) => r.by !== "gm" && (inst.decl?.targets ?? []).includes(r.to)).map((r) => r.to);
/* D116: a minion group with no member left is nobody (its Health is its members [B2827]); a lone character at 0 stays somebody until
   marked defeated (ruling U17-4). Shared by Bang Heads (attack.mjs othersNear) and Discretion (alliesNear, H3-2). */
export const wiped = (f) => f?.kind === "minions" && (!(Number(f.health) > 0) || f.members === 0);
/** The allies a target could put in its place [B2108]: of its side, in its zone, known to it, not the attacker and not attacked already;
    H3-2: never a wiped minion group (nobody to take the hit). */
export function alliesNear(v, inst, cid) {
  const me = v.facts.c(cid);
  return Object.keys(v.state.ledger ?? {}).filter((id) => { const f = v.facts.c(id);
    return id !== cid && id !== inst.actor && !(inst.decl?.targets ?? []).includes(id) && !!f && !NO_ALLY.includes(f.kind) && !wiped(f) && M.sameTeam(f, me) && knownTo(v, cid, id) && sameSpot(v, cid, id) !== false; });
}
/** May `cid` take this reaction to this action now, from where it stands? Asked when the card is made AND when it is answered (the
    guardian may have been moved away in between) AND when the answer is acted on. -> { ok, reason } */
export function reactionFit(v, inst, cid, e) {
  const r = e?.reaction;
  if (!r || !inst) return { ok: true, reason: null };
  /* PWB: what an answer to an attack is about. Quick Blast answers a shooting attack [B1585], Sudden Strike one in slugfest [B1619]
     (of the attack family of the rules library); Redirecting Blast answers damage the character's Armor stopped [B1889] */
  if (r.vs === "absorbed" && !(Number(inst.data?.dmg?.[cid]?.absorbed) > 0)) return { ok: false, reason: "nothingAbsorbed" };
  if ((r.vs === "shooting" || r.vs === "slugfest") && attack.ATTACKS[inst.data?.kind ?? "slugfest"]?.family !== r.vs) return { ok: false, reason: r.vs === "shooting" ? "notShot" : "notSlugfest" };
  /* U19-4 (the user, 2026-11-12: «Tak, wszystkie»): diving in to take the hit is moving the body: a guardian who is held [B2496], snared
     [B1606] or trapped [B2438] cannot (ruling ANSE-R1). Immobilize Only (snared, move-only [B1611]) only forbids leaving the spot: it may */
  if (r.effect === "swapTarget") { const k = M.conditions(v.state, cid); if (k.held || k.snared || k.trapped) return { ok: false, reason: k.held ? "held" : k.snared ? "snared" : "trapped" }; }
  /* FXC2 (D198), PWB-R4: Untouchable Speed / Quick Teleport ARE a move: who cannot move (held [B2496], snared [B1606] or Immobilize Only
     [B1611], trapped [B2438]) cannot take them, as movement-pure cannotMove refuses every way of moving (teleporting too) */
  if (r.effect === "moveAway") { const k = M.conditions(v.state, cid); if (k.held || k.snared || k.rooted || k.trapped) return { ok: false, reason: k.held ? "held" : k.snared || k.rooted ? "snared" : "trapped" }; }
  /* FXK2 (FF7's note on D198): an answer that is itself an attack (Quick Blast [B1585], Sudden Strike [B1619], Redirecting Blast [B1889])
     is refused, as its own declaration would be (flows/attack legality), to one who may not make that attack now: was offered, charged
     1 stress and the action, then dropped silently. Ruling FXK2-R1 */
  if (r.effect === "action" && e.flow === "attack") { const why = attackerFault(v, cid, e.attack ?? "slugfest"); if (why) return { ok: false, reason: why }; }
  if (r.place === "allyZone") return alliesNear(v, inst, cid).length ? { ok: true, reason: null } : { ok: false, reason: "noAllyNear" };
  if (r.who !== "any") return { ok: true, reason: null };
  if (reactionFor(v, inst, cid, e).length) return { ok: true, reason: null };
  const moved = r.effect === "swapTarget" ? coveredBy(inst) : [];
  if (moved.some((t) => t !== cid && knownTo(v, cid, t))) return { ok: false, reason: "hitTaken" };      // D104: the one it could cover is no target any more; somebody already took the hit
  return { ok: false, reason: r.place === "targetZone" && (inst.decl?.targets ?? []).some((t) => t !== cid && knownTo(v, cid, t)) ? "notInYourZone" : "unseen" };
}
export function reactionOption(v, cid, e, inst = null) {
  const o = { id: `r:${e.id}`, label: e.label, name: e.name || undefined, cost: e.cost, data: { entry: e.id, effect: e.reaction.effect } };
  if (e.stress?.fixed) o.stress = e.stress.fixed;
  const pay = P1.canPay(v.state, cid, e.cost, { interrupt: true, resolve: v.facts.c(cid)?.resolve });
  const fit = inst ? reactionFit(v, inst, cid, e) : { ok: true };
  if (!fit.ok) o.disabled = fit.reason;                                                                     // U91: the place first: it is the reason the player can do something about
  else if (!pay.ok) o.disabled = pay.reason;
  else if (e.stress?.fixed && !(v.facts.c(cid)?.resolve > 0)) o.disabled = "stressedOut";                   // [B2816]
  return o;
}
/* D113: the answers of one reaction entry. Discretion [B2108] names the ally who is put in the way and Warning Call [B2170] the one who is
   warned: with one such character the entry is one answer (that one is meant), with several there is one answer per character, its id
   `r:<entry>@<cid>` and `data.about` the character (the surfaces name it beside the entry's name). A reaction is taken once per attack. */
export const REACT_ABOUT = Object.freeze(["allySwap", "warn", "guide"]);
export function aboutOf(v, inst, cid, e) {
  if (!inst || !REACT_ABOUT.includes(e?.reaction?.effect)) return [];
  return e.reaction.effect === "allySwap" ? alliesNear(v, inst, cid) : reactionFor(v, inst, cid, e).filter((t) => !inst.data?.warned?.[t]);
}
export function reactionOptions(v, cid, e, inst = null) {
  const o = reactionOption(v, cid, e, inst), who = aboutOf(v, inst, cid, e);
  if (inst && inst.data?.reacted?.some((x) => x.who === cid && x.entry === e.id)) o.disabled = "reactionUsed";
  else if (inst && !o.disabled && (e.reaction.effect === "warn" || e.reaction.effect === "guide") && !who.length && reactionFor(v, inst, cid, e).length) o.disabled = "alreadyWarned";
  if (who.length < 2) return [who.length ? { ...o, data: { ...o.data, about: who[0] } } : o];
  return who.slice(0, 8).map((x) => ({ ...o, id: `${o.id}@${x}`, data: { ...o.data, about: x } }));
}
/** `r:<entry>` or `r:<entry>@<cid>` -> { id: "r:<entry>", about } */
export const reactionId = (id) => { const s = String(id ?? ""), at = s.lastIndexOf("@"); return s.startsWith("r:") && at > 2 ? { id: s.slice(0, at), about: s.slice(at + 1) } : { id: s, about: null }; };

/** May `t` answer an attack of this kind with a block or a dodge now? ONE reading for the attack flow and for every hazard that can be
    dodged [B2922]: the conditions of the state [R6], [R20], [R21], [R10], [B2392], out of action [B2707], holding somebody [B2497], and a
    quick action to pay with (the base pair or a grant, spec 4.2). `free`: the same with the action waived (Defensive [B2105]).
    -> { conds, hasQuick, out, paid: { block, dodge }, free: { block, dodge } }, each { ok, reason } (rules/attack.defenceOptions). */
export function defenceOf(v, t, kind, { inChase = false, machine = false } = {}) {
  const conds = M.conditions(v.state, t), hasQuick = !machine && P1.canPay(v.state, t, "quick", { interrupt: true, defense: true, resolve: v.facts.c(t)?.resolve }).ok;
  const defender = { ...conds, out: M.outOfAction(v.state, t, v.facts.c(t)), holding: holdsTied(v, t) };      // PWA (PW072): Extra Limb(s) defends while holding [B1926]
  return { conds, hasQuick, out: defender.out, paid: attack.defenceOptions({ attack: kind, defender: { ...defender, hasQuick }, inChase }), free: attack.defenceOptions({ attack: kind, defender: { ...defender, hasQuick: true }, inChase }) };
}
/** Who answered a prompt of the instance: the GM's own answer may stand where the rules would refuse it (spec 14: the GM picks a greyed option). */
export const answeredByStaff = (v, inst, key) => v.facts.user(promptOf(v, inst, key)?.answered?.by)?.staff === true;

/** Is this combatant an NPC that rolls critical injuries like a hero [B2771]? The actor flag `major` or the GM's standing word (NpcPolicy.major). */
export const isMajor = (v, cid) => { const c = v.facts.c(cid); return !!c && c.npc && c.kind !== "minions" && (c.major === true || [true, "yes"].includes(v.state.npc?.[cid]?.major)); };
/** May a roll of this combatant be pushed at all? Heroes always (the system's own rules decide the rest). The book gives pushing to major NPCs and to
    minion groups [B2231], [B2830]; any other NPC only when the GM said so for it (NpcPolicy.push "ask"), and never with "never" [OQ-12], [A12]. */
export function mayPush(v, cid) {
  const c = v.facts.c(cid);
  if (c?.pass?.overconfident && c.health > Math.ceil((c.maxHealth ?? 0) / 2)) return false;       // P6 [B2186]: no pushing above half Health
  if (!c || !c.npc) return true;
  const pol = v.state.npc?.[cid] ?? {};
  if (pol.push === "never" || quickGroup(v, cid)) return false;                              // U61: a group settled quickly rolls once
  return c.kind === "minions" || isMajor(v, cid) || pol.push === "ask";
}
/** [B1888]: an injury of 12 or more on the table (one that kills outright) still counts for an Impervious character */
export const IMPERVIOUS_FATAL = 12;
/** The effects that end a grapple `cid` is part of, as the holder or as the one held [B2496-2497]. */
export function grappleRelease(state, cid) {
  const out = [], st = M.statusesOf(state, cid);
  const holding = st.find((s) => s.id === "grappling"), held = st.find((s) => s.id === "grappled");
  if (holding) { out.push({ t: "status-", who: cid, id: "grappling" }); if (holding.data?.held && M.hasStatus(state, holding.data.held, "grappled")) out.push({ t: "status-", who: holding.data.held, id: "grappled" }); }
  if (held) { out.push({ t: "status-", who: cid, id: "grappled" }); if (held.data?.by && M.hasStatus(state, held.data.by, "grappling")) out.push({ t: "status-", who: held.data.by, id: "grappling" }); }
  return out;
}
/** A grapple and a carry are links between two characters in ONE place [B2496-2497], [B2392]: the holder pulls the held one along, the
    flyer and the carried one start and end a move together. Whatever takes one of a pair somewhere else (a forced move, a fall, a move
    of its own, a throw) ends the link for both. Called by every flow that moves somebody, after the move, in the same transaction.
    -> effects */
const LINKS = Object.freeze({ grappling: ["held", "grappled"], grappled: ["by", "grappling"], carrying: ["held", "carried"], carried: ["by", "carrying"] });
export function separated(v, ids) {
  const Z = v.facts.zones, out = [], seen = new Set();
  const spot = (id) => (Z ? Z.place?.(id)?.spot : v.facts.zone?.(id)?.spot) ?? null;      // (no map of zones: the place the facts name, if any)
  const drop = (who, id) => { const k = `${who}:${id}`; if (!seen.has(k) && M.hasStatus(v.state, who, id)) { seen.add(k); out.push({ t: "status-", who, id }); } };
  for (const cid of new Set(ids)) for (const s of M.statusesOf(v.state, cid)) {
    const link = LINKS[s.id], other = link ? s.data?.[link[0]] : null;
    if (!link || typeof other !== "string") continue;
    const a = spot(cid), b = spot(other);
    if (!a && !b) continue;                                                                  // nobody can say where they are: the GM's to settle
    if (a && b && a === b && M.hasStatus(v.state, other, link[1])) continue;
    drop(cid, s.id); drop(other, link[1]);
    if (s.id === "carrying" || s.id === "carried") { drop(cid, "airborne"); drop(other, "airborne"); }      // the mark of the pair that stayed in the air [B2392]
  }
  /* FXP (D165): one knocked, thrown or fallen out of a vehicle (it ends in another place than the vehicle) has left its seat: off the crew
     list and without the mark, as getting out does (flows/vehicle.mjs seatEffects). The vehicle moving with everybody aboard parts nobody. */
  for (const cid of new Set(ids)) {
    const vid = M.statusesOf(v.state, cid).find((s) => s.id === "inVehicle")?.data?.vehicle;
    if (typeof vid !== "string" || seen.has(`${cid}:inVehicle`)) continue;
    const a = spot(cid), b = spot(vid);
    if (!a || !b || a === b) continue;
    const r = v.state.vehicles?.[vid] && typeof v.state.vehicles[vid] === "object" ? v.state.vehicles[vid] : {};
    out.push({ t: "state", path: ["vehicles", vid], to: { ...r, driver: r.driver === cid ? null : r.driver ?? null, crew: (Array.isArray(r.crew) ? r.crew : []).filter((x) => x !== cid) } });
    drop(cid, "inVehicle");
  }
  /* PWC (PW013) [B1646]: an ice barrier of Cold Control lasts until its maker or the one it stands on moves out of the zone it was made in */
  const zoneOf = (id) => { const p = Z ? Z.place?.(id) : null; const k = p ? p.zone ?? String(p.spot ?? "").split(":")[0] : String(v.facts.zone?.(id)?.key ?? v.facts.zone?.(id)?.spot ?? "").split(":")[0]; return k || null; };
  for (const e of v.state.effects ?? []) {
    if (e?.kind !== "barrier" || typeof e.data?.zone !== "string") continue;
    const pair = [e.holder, e.data.by].filter((x) => typeof x === "string");
    if (!pair.some((x) => ids.includes(x)) || !pair.some((x) => { const z = zoneOf(x); return !!z && z !== e.data.zone; })) continue;
    for (const w of M.effectEndWrites(v.state, e.id)) out.push({ t: "state", path: w.path, to: w.to });
  }
  return out;
}
/** ANSF (P5-2 + P5-R6, the user 2026-11-12: «Wszystkie 6 zmian»): the rounds of vacuum exposure count from each entering of the vacuum
    [B2929]: who arrives in orbit or in a zone tagged `vacuum` from a place that is not, starts again unmodified (T052 already ends the
    exposure at a turn that starts at pressure; this also covers going out and back in between two turns). -> effects */
const vacuumAt = (Z, spot) => (typeof spot !== "string" ? false : spot.startsWith("@") ? spot === "@orbit" : (Z?.zone?.(spot.split(":")[0])?.tags ?? []).includes("vacuum"));
export function vacuumEntered(v, ids, fromSpot) {
  const Z = v.facts.zones, out = [];
  if (!Z || vacuumAt(Z, fromSpot)) return out;
  for (const cid of new Set(ids)) {
    const key = M.counterKey.scene(cid, "vacuum");
    if (M.counterGet(v.state, key) > 0 && vacuumAt(Z, Z.place?.(cid)?.spot)) out.push({ t: "state", path: ["counters", key], to: null });
  }
  return out;
}
/** The carry marks of a character that is broken: nobody broken carries anybody [B2707]. -> effects */
export function carryRelease(state, cid) {
  const s = M.statusesOf(state, cid).find((x) => x.id === "carrying"), out = [];
  if (!s) return out;
  out.push({ t: "status-", who: cid, id: "carrying" });
  if (M.hasStatus(state, cid, "airborne")) out.push({ t: "status-", who: cid, id: "airborne" });
  const o = s.data?.held;
  if (typeof o === "string") for (const id of ["carried", "airborne"]) if (M.hasStatus(state, o, id)) out.push({ t: "status-", who: o, id });
  return out;
}
/** How many of a minion group fall to a hit that takes several at once (an area attack, full auto, a blast, a hazard, a stunt that hits more than one) [OQ-1];
    decided by the user 2026-11-12 (A1 + P4-4 + INT-4 + INT-R4, «Grupa jako jedna postać»): the group is counted once, the number starts at the damage after Armor:
    the GM's number, the damage taken is the suggestion. One card for the attack flow and for the hazards. -> { wait: true } | { taken } */
export const MINION_LOSS_MAX = 12;
/** U61 QUICK RESOLUTION, the GM's switch for one minion group (NpcPolicy.quick, set by the op npcPolicy; never by itself). Such a group
    gives the GM ONE card per hit instead of up to three: it takes the hit without a block or a dodge (unless the GM's standing answer
    says "always"), its own rolls are not pushed, and how many fall and whether they are knocked out or killed [B2828] is asked together
    (the card "minionsQuick"). The book knows no such mode: it is a convenience the GM turns on (ruling U8-R1). */
export const quickGroup = (v, cid) => v.facts.c(cid)?.kind === "minions" && v.state.npc?.[cid]?.quick === true;
/** Does a hit on `t` go to the one card of a quickly settled group? Not when the GM already gave the fate as a standing answer (then
    nothing needs asking beyond the number the old card asks for). */
export const quickCard = (v, t) => quickGroup(v, t) && !["ko", "kill"].includes(v.state.npc?.[t]?.onBroken);
export function minionLoss(v, I, R, t, taken, { by = null } = {}) {
  const tf = v.facts.c(t), key = `ml:${t}`, members = Math.max(0, tf?.members ?? tf?.health ?? 0), top = Math.min(members, MINION_LOSS_MAX);
  /* U61 / U145: the number and the fate on ONE card (the number starts at what the damage says). Since U145 this is every group's card, not
     only a quickly settled one's: the GM answered two questions in a row for each group hit. The old number-only card is left for a group
     whose fate the GM already gave as a standing answer (NpcPolicy.onBroken), where the fate needs no asking. */
  if (!["ko", "kill"].includes(v.state.npc?.[t]?.onBroken)) {
    const qk = `mq:${t}`;
    if (!I.data.pk?.[qk]) { R.prompts.push({ key: qk, kind: "minionsQuick", to: "gm", about: t, options: [{ id: "none", label: "ITAC.opt.minionsNone", data: { n: 0 } }, ...["ko", "kill"].flatMap((f) => Array.from({ length: top }, (_, i) => ({ id: `${f}:${i + 1}`, label: `ITAC.opt.${f}`, data: { n: i + 1, fate: f } })))], data: { suggested: Math.min(top, taken), members, by } }); return { wait: true }; }
    if (!isAnswered(v, I, qk)) return { wait: true };
    const [fate, n] = String(answerId(v, I, qk) ?? "").split(":");
    if (fate === "ko" || fate === "kill") (I.data.mqf ??= {})[t] = fate;
    return { taken: fate === "ko" || fate === "kill" ? Math.max(0, Math.min(members, Number(n) || 0)) : 0 };
  }
  if (!I.data.pk?.[key]) { R.prompts.push({ key, kind: "minionLoss", to: "gm", about: t, options: Array.from({ length: top + 1 }, (_, n) => ({ id: `n:${n}`, label: "ITAC.opt.minionsFall", data: { n } })), data: { suggested: Math.min(top, taken), members, by } }); return { wait: true }; }
  if (!isAnswered(v, I, key)) return { wait: true };
  return { taken: Math.max(0, Math.min(members, Number(String(answerId(v, I, key) ?? "").split(":")[1]) || 0)) };
}
/** A minion group that lost members [B2828]: knocked out or killed is the GM's word (NpcPolicy.onBroken answers it without a card). Returns true while waiting. */
export function minionsFate(v, I, R, t, dm, { by = null } = {}) {
  const tf = v.facts.c(t);
  if (!tf || tf.kind !== "minions" || !(dm?.minions?.removed > 0)) return false;
  const key = `mfate:${t}`, said = I.data.mqf?.[t];
  if (said && !I.data.pk?.[key]) {                                                           // U61: the one card of a quickly settled group already said it
    if (!flag(I, key)) { setFlag(I, key); fateOf(v, R, t, dm, said, by); }
    return false;
  }
  if (!I.data.pk?.[key]) {
    const pol = v.state.npc?.[t]?.onBroken, p = { key, kind: "minionsFate", to: "gm", about: t, options: [{ id: "ko", label: "ITAC.opt.ko" }, { id: "kill", label: "ITAC.opt.kill" }], data: { removed: dm.minions.removed, left: dm.minions.left } };
    if (["ko", "kill"].includes(pol)) p.auto = { option: pol, reason: "npcDefault" };
    R.prompts.push(p); R.wait = true; return true;
  }
  if (!isAnswered(v, I, key)) { R.wait = true; return true; }
  if (!flag(I, key)) {
    setFlag(I, key);
    fateOf(v, R, t, dm, answerId(v, I, key), by);
  }
  return false;
}
function fateOf(v, R, t, dm, id, by) {
  dm.npcOutcome = id;
  if (id === "kill" && by && v.facts.c(by) && !v.facts.c(by).npc) R.effects.push({ t: "karma", note: { who: by, kind: "killed", target: t, n: dm.minions.removed } });     // [B815]
  if (dm.minions.left === 0) R.effects.push({ t: "status+", who: t, status: { id: id === "kill" ? "dead" : "unconscious", source: { kind: "gm", name: "minions" } } });
}

/** Broken and critical injuries after one damage event (spec 9.5 steps 7-9), shared by attacks and hazards. `dm` is the damage record of the flow
    ({ taken, healthBefore, tags }). Returns true when the step has to wait (an injury die, or the GM's word on an NPC).
    NPCs [B2771]: an ordinary NPC that is broken needs no injury, the GM states knocked out or killed, or has it rolled like a hero's; a major NPC
    always rolls. Minions never do [B2828]. Whoever is broken lets go of a grapple and is let go of. */
/** the lang key of an injury entry id ("crushed-arm" -> "crushedArm"), as the heroDead card names it */
const critKey = (id) => String(id ?? "").replace(/-(\w)/g, (m, c) => c.toUpperCase());
/* P6b-6 (K8) and ANSE (PW030): which of two injury dice is kept. The chooser picks on the card "critPick" (each die names the injury it
   gives); a player's pick goes to the GM's "critConfirm" (approve, or the other die); the GM's own pick needs no second card; two equal dice
   ask nothing. -> 0 | 1, or null while a card is out (R.wait set) */
function critPickOf(v, I, R, t, tf, cf, faces, { chooser, talent, pk, ok }) {
  if (!(faces.length > 1 && faces[0] !== faces[1])) return 0;
  const cap = v.state.opts?.critCap9 ? crits.FAMILY_CAP : crits.MAX_CRIT;
  const opt = (i) => { const rc = crits.resolveCrit({ d6: faces[i], bonus: cf.crit.bonus, prior: tf.crits ?? [], cap }); return { id: `d:${i}`, label: "ITAC.opt.critDie", data: { d6: faces[i], n: rc.n, id: critKey(rc.entry?.id) } }; };
  /* ANSEL (seen live): two dice that give the same injury (the table's top, e.g. 13 on both) leave nothing to choose: no card */
  { const a = opt(0).data, b = opt(1).data; if (a.n === b.n && a.id === b.id) return 0; }
  if (!I.data.pk?.[pk]) { R.prompts.push({ key: pk, kind: "critPick", to: addressee(v, chooser), about: chooser, options: [opt(0), opt(1)], data: { talent, target: t, bonus: cf.crit.bonus } }); R.wait = true; return null; }
  if (!isAnswered(v, I, pk)) { R.wait = true; return null; }
  let pick = answerId(v, I, pk) === "d:1" ? 1 : 0;
  if (!answeredByStaff(v, I, pk)) {
    if (!I.data.pk?.[ok]) { const o = opt(pick), x = opt(1 - pick); R.prompts.push({ key: ok, kind: "critConfirm", to: "gm", about: chooser, options: [{ id: "approve", label: "ITAC.opt.approve", data: o.data }, { id: "other", label: "ITAC.opt.critOther", data: x.data }], data: { talent, target: t, pick: o.data, other: x.data } }); R.wait = true; return null; }
    if (!isAnswered(v, I, ok)) { R.wait = true; return null; }
    if (answerId(v, I, ok) === "other") pick = 1 - pick;
  }
  return pick;
}
/* ANSE (PW030) [B1727]: Luck Control's second use: as a quick interrupt action for 1 stress, force a re-roll of a critical injury on yourself
   or another character in your zone or an adjacent one, and choose the result you prefer. Its limits [B1731], [B1732]: Good Luck Only must
   keep the lower roll, Bad Luck Only the higher (kit-pure leaves the act's `pick` to ["good"] / ["bad"]). Who may: a character of the fight
   with the power, present, not out of action [B2707] (the injured one itself only when this blow left it standing: a broken character has no
   power), able to act out of turn (not stunned, no lost turn) and to pay a quick interrupt action and 1 stress [B2816]. No map: the reach is
   the GM's. Each such character is asked in turn (the order of the fight) until one re-rolls; one re-roll per injury (ruling ANSE-R3). */
const luckEntry = (f) => (f?.kit?.actions ?? []).find((e) => e?.effect?.kind === "luck") ?? null;
function luckHolders(v, t, dm) {
  return Object.keys(v.state.ledger ?? {}).filter((id) => {
    const f = v.facts.c(id), e = luckEntry(f);
    if (!e || f.present === false || M.outOfAction(v.state, id, f) || M.conditions(v.state, id).noInterrupts) return false;
    if (id === t && !(Number(dm.healthBefore) - Number(dm.taken) > 0)) return false;
    const r = id === t ? { total: 0 } : v.facts.range(id, t);
    if (r === null || (r && r.total > 1)) return false;
    return P1.canPay(v.state, id, e.cost ?? "quick", { interrupt: true, resolve: f.resolve }).ok && damage.canTakeVoluntaryStress(f.resolve);
  });
}
function luckStep(v, I, R, t, tf, cf, dm, key) {
  const L = ((I.data.luck ??= {})[t] ??= { asked: [] });
  if (!L.by) {
    for (const id of luckHolders(v, t, dm)) {
      if (L.asked.includes(id)) continue;
      const lk = `luck:${t}:${id}`, cap = v.state.opts?.critCap9 ? crits.FAMILY_CAP : crits.MAX_CRIT, e = luckEntry(v.facts.c(id));
      if (!I.data.pk?.[lk]) {
        const d6 = I.data.res[key][0], rc = crits.resolveCrit({ d6, bonus: cf.crit.bonus, prior: tf.crits ?? [], cap }), only = (e.pick ?? []).length === 1 ? e.pick[0] : null;
        R.prompts.push({ key: lk, kind: "luckReroll", to: addressee(v, id), about: id, options: [{ id: "reroll", label: "ITAC.opt.luckReroll", cost: e.cost ?? "quick", stress: 1 }, { id: PASS, label: "ITAC.opt.luckKeep" }],
          data: { target: t, d6, n: rc.n, id: critKey(rc.entry?.id), ...(only ? { must: only === "good" ? "lower" : "higher" } : {}) } });
        R.wait = true; return true;
      }
      if (!isAnswered(v, I, lk)) { R.wait = true; return true; }
      L.asked.push(id);
      if (answerId(v, I, lk) !== "reroll") continue;
      L.by = id;
      R.effects.push({ t: "pay", who: id, cost: e.cost ?? "quick", action: e.id ?? "luck", interrupt: 1, key: `luck:${t}`, target: [t] });
      R.effects.push({ t: "stress", who: id, n: 1 });
      break;
    }
    if (!L.by) return false;
  }
  const rk = `${key}:luck`;
  if (I.data.res?.[rk] == null) { if (!flag(I, `${rk}:asked`)) { setFlag(I, `${rk}:asked`); R.effects.push({ t: "dice", key: rk, n: 1 }); } R.wait = true; return true; }
  const faces = [I.data.res[key][0], I.data.res[rk][0]], only = (luckEntry(v.facts.c(L.by))?.pick ?? []).length === 1 ? luckEntry(v.facts.c(L.by)).pick[0] : null;
  const pick = only ? (only === "good" ? (faces[1] < faces[0] ? 1 : 0) : (faces[1] > faces[0] ? 1 : 0)) : critPickOf(v, I, R, t, tf, cf, faces, { chooser: L.by, talent: "luck", pk: `critPick:${t}:luck`, ok: `critOk:${t}:luck` });
  if (pick == null) return true;
  L.kept = faces[pick];
  I.data.res[key] = [faces[pick], faces[1 - pick]];
  return false;
}
export function brokenAndCrit(v, I, R, t, dm, { deadlyHit = false, by = null } = {}) {
  if (!dm || dm.tags?.toStress || !(dm.taken > 0)) return false;
  const tf = v.facts.c(t);
  if (!tf) return false;
  const once = (k) => { if (flag(I, k)) return false; setFlag(I, k); return true; };
  const flags = { ...immunityFlags(tf), kind: isMajor(v, t) ? "majorNpc" : tf.kind };
  let cf = crits.critForHit({ taken: dm.taken, healthBefore: dm.healthBefore, deadlyHit, target: flags });   // [B2707], [B2708], [R9], [B2771], [B2828]
  if (cf.newlyBroken && once(`broken:${t}`)) {
    dm.broke = 1;                                                                              // D127: the journal and the news say who was broken
    R.effects.push({ t: "status+", who: t, status: { id: "broken", source: { kind: "crit", owner: by ?? undefined, name: "broken" } } });
    for (const e of [...grappleRelease(v.state, t), ...carryRelease(v.state, t), ...brokenEnds(v.state, t)]) R.effects.push(e);      // [B2707]: a broken character holds nobody and carries nobody; PWE (PW108) [B2075]: nor stays invisible
    R.events.push({ type: "broken", target: t });
    const bf = by ? v.facts.c(by) : null;                                                      // P6 [B2154] Merciless: 1 Resolve for breaking an enemy
    const resNow = bf ? R.effects.filter((e) => e.t === "actor" && e.who === by && e.path === "resolve").at(-1)?.to ?? bf.resolve : 0;      // several enemies broken in one step: count the gains already queued
    if (bf?.pass?.merciless && resNow < bf.maxResolve && !M.sameTeam(bf, tf)) R.effects.push({ t: "actor", who: by, path: "resolve", to: resNow + 1 });
  }
  if (cf.gmChoice) {                                                                           // [B2771]: an ordinary NPC needs no injury, the GM states the outcome
    const key = `npcBroken:${t}`;
    if (!I.data.pk?.[key]) {
      const pol = v.state.npc?.[t]?.onBroken, p = { key, kind: "npcBroken", to: "gm", about: t, options: [{ id: "ko", label: "ITAC.opt.ko" }, { id: "kill", label: "ITAC.opt.kill" }, { id: "crit", label: "ITAC.opt.rollCrit" }] };
      if (["ko", "kill", "crit"].includes(pol)) p.auto = { option: pol, reason: "npcDefault" };       // spec 13.3 NpcPolicy.onBroken
      R.prompts.push(p); R.wait = true; return true;
    }
    if (!isAnswered(v, I, key)) { R.wait = true; return true; }
    const id = answerId(v, I, key);
    if (once(key)) {
      dm.npcOutcome = id;
      if (id === "kill" || id === "ko") dm.fate = id === "kill" ? "dead" : "unconscious";      // FXA2 (U198)
      if (id === "kill") {
        R.effects.push({ t: "status+", who: t, status: { id: "dead", source: { kind: "gm", name: "npcBroken" } } });
        if (by && v.facts.c(by) && !v.facts.c(by).npc) R.effects.push({ t: "karma", note: { who: by, kind: "killed", target: t } });     // [B815], spec 9.11
      } else if (id === "ko") R.effects.push({ t: "status+", who: t, status: { id: "unconscious", source: { kind: "gm", name: "npcBroken" } } });
    }
    if (id !== "crit") return false;
    cf = crits.critForHit({ taken: dm.taken, healthBefore: dm.healthBefore, deadlyHit, target: { ...flags, kind: "majorNpc" } });      // rolled like a hero's [B2771]
  }
  if (cf.crit && tf.pass?.noCrit) cf = { ...cf, crit: null };                                  // P6 [B1915] Sequestered Original: a copy went down, no injury is rolled
  if (cf.crit) {
    const key = `crit:${t}`, killer = !!(by && v.facts.c(by)?.pass?.killer), lucky = tf.pass?.luckyBreak === true, two = killer !== lucky;      // P6 [B2121], [B2149]: two dice, one kept
    if (I.data.res?.[key] == null) { if (once(`${key}:asked`)) R.effects.push({ t: "dice", key, n: two ? 2 : 1 }); R.wait = true; return true; }
    /* P6b-6 (the user, 2026-11-12, K8: «Gracz wybiera kość, MG zatwierdza»): of the two dice of Killer [B2121] or Lucky Break [B2149] the one
       who holds the talent picks on a card (the attacker for Killer, the injured for Lucky Break; each option names the injury it gives),
       and the GM confirms the pick of a player or takes the other die. A pick made by the GM (an NPC's, or for a player) needs no second
       card. Two equal dice ask nothing; Killer against Lucky Break still cancel out to one die (unchanged: the book does not say). */
    if (!flag(I, `${key}:kept`)) {
      const faces = I.data.res[key];
      const pick = two ? critPickOf(v, I, R, t, tf, cf, faces, { chooser: killer ? by : t, talent: killer ? "killer" : "luckyBreak", pk: `critPick:${t}`, ok: `critOk:${t}` }) : 0;
      if (pick == null) return true;
      setFlag(I, `${key}:kept`);
      I.data.res[key] = [faces[pick], ...faces.filter((_, i) => i !== pick)];
    }
    /* ANSE (PW030) [B1727]: Luck Control forces a re-roll of the injury, the holder keeps the die it prefers, on the same card as Killer and
       Lucky Break (the user's P6b-6 / K8: the player picks, the GM confirms); Good Luck Only keeps the lower die, Bad Luck Only the higher
       [B1731], [B1732], no card then */
    if (!flag(I, `${key}:luck`)) {
      if (luckStep(v, I, R, t, tf, cf, dm, key)) return true;
      setFlag(I, `${key}:luck`);
    }
    /* FXP (D163): a HERO's injury that kills (12 and worse, [B2761], [B2765]) is the biggest moment of a fight [B2787]: the GM gets a card
       before it is written. "Dies" writes it as the table rolled it; "Injury 9" takes the book's own softer table for this one injury
       (the family cap, every result of 9 or more is the 9 [B2767-2769]): knocked out, not dead. A fight already played with that cap, a
       non-hero (the GM states an NPC's end [B2771]) and an injury that does not kill ask nothing. */
    const dk = `heroDead:${t}`, capped = v.state.opts?.critCap9 || (I.data.pk?.[dk] && answerId(v, I, dk) === "cap9");
    if (!flag(I, key) && !tf.npc && tf.kind === "hero" && !v.state.opts?.critCap9) {
      const pre = crits.resolveCrit({ d6: I.data.res[key][0], bonus: cf.crit.bonus, prior: tf.crits ?? [], cap: crits.MAX_CRIT });
      if (crits.critState([...(tf.crits ?? []), pre.n]).dead) {
        if (!I.data.pk?.[dk]) { R.prompts.push({ key: dk, kind: "heroDead", to: "gm", about: t, options: [{ id: "dead", label: "ITAC.opt.dead" }, { id: "cap9", label: "ITAC.opt.cap9" }], data: { n: pre.n, id: String(pre.entry?.id ?? "").replace(/-(\w)/g, (m, c) => c.toUpperCase()) } }); R.wait = true; return true; }
        if (!isAnswered(v, I, dk)) { R.wait = true; return true; }
      }
    }
    if (once(key)) {
      const rc0 = crits.resolveCrit({ d6: I.data.res[key][0], bonus: cf.crit.bonus, prior: tf.crits ?? [], cap: capped ? crits.FAMILY_CAP : crits.MAX_CRIT });
      if ((tf.impervious || tf.pass?.impervious) && rc0.n < IMPERVIOUS_FATAL) {          // PWE (PW066) [B1888] Impervious: an injury that does not kill outright has no effect
        dm.crit = { d6: I.data.res[key][0], bonus: cf.crit.bonus, cause: cf.crit.cause, n: rc0.n, id: rc0.entry?.id, shifted: rc0.shifted, ignored: 1 };
        return false;
      }
      const rc = crits.resolveCrit({ d6: I.data.res[key][0], bonus: cf.crit.bonus, prior: tf.crits ?? [], cap: capped ? crits.FAMILY_CAP : crits.MAX_CRIT });   // [B2707], [B2709], [B2769]
      dm.crit = { d6: I.data.res[key][0], bonus: cf.crit.bonus, cause: cf.crit.cause, n: rc.n, id: rc.entry?.id, shifted: rc.shifted };
      R.effects.push({ t: "crit", who: t, n: rc.n, id: rc.entry?.id });
      const cs = crits.critState([...(tf.crits ?? []), rc.n]);                                 // [B2749-2765]
      if (cs.dead || cs.dying || cs.unconscious) dm.fate = cs.dead ? "dead" : cs.dying ? "dying" : "unconscious";      // FXA2 (U198): the news says what the injury did ("nie żyje")
      for (const sid of [cs.dead ? "dead" : null, cs.dying ? "dying" : null, cs.unconscious ? "unconscious" : null].filter(Boolean)) {
        const st = { id: sid, source: { kind: "crit", name: rc.entry?.id ?? "" } };
        if (sid === "dying") st.data = { within: cs.dying };                                   // the deadline is shown, nothing is counted (spec 6.1)
        R.effects.push({ t: "status+", who: t, status: st });
      }
      R.events.push({ type: "crit", target: t, crit: { roll: rc.roll, total: rc.n, id: rc.entry?.id } });
    }
  }
  return false;
}

/** Modifier tokens that need the GM's word before they count (spec 6.2: a token with `purpose` or `needsGm` shows the GM a one-click confirmation).
    Returns { wait, tokens } with the ids that may be spent. */
export function tokenGate(v, I, R, cid, roll, ids, tag) {
  const need = M.tokensFor(v.state, cid, roll).filter((t) => ids.includes(t.id) && t.needsGm);
  if (!need.length) return { wait: false, tokens: ids };
  const key = `tok:${tag}`;
  if (!I.data.pk?.[key]) {
    R.prompts.push({ key, kind: "tokenConfirm", to: "gm", about: cid, options: [{ id: "approve", label: "ITAC.opt.approve" }, { id: "refuse", label: "ITAC.opt.refuse" }], data: { tokens: need.map((t) => ({ id: t.id, dice: t.dice, purpose: t.scope?.purpose ?? "", source: t.source?.name ?? "" })) } });
    return { wait: true, tokens: ids };
  }
  if (!isAnswered(v, I, key)) return { wait: true, tokens: ids };
  return { wait: false, tokens: answerId(v, I, key) === "approve" ? ids : ids.filter((id) => !need.some((t) => t.id === id)) };
}
/* PWD (PW037) [B1703]: in a zone of low gravity every further action needs an AGILITY roll first (no action), or it is forfeit. The attack and the move
   flows have their own; this one is for the other flows (the act and roll rows). -> "wait" | "failed" | null */
export function lowGravityGate(v, I, R) {
  const e = v.entry(I);
  if (!["full", "quick"].includes(e?.cost) || e?.reactionOnly || I.cause === "counter" || !v.facts.zone?.(I.actor)?.states?.lowgrav) return null;
  const key = "gate:lowGravity";
  if (!rollOf(I, key)) {
    const { pool } = buildPool(v, I, key, I.actor, "agility", []);
    if (!I.locked) { I.locked = true; R.events.push({ type: "actionLocked" }); }
    R.effects.push(rollEffect(key, I.actor, "agility", pool, { passive: true, label: "ITAC.gate.lowGravity" }));
    return "wait";
  }
  if (!rollFinal(I, key)) return "wait";
  if (!flag(I, key)) { setFlag(I, key); R.events.push({ type: "gate", gate: "lowGravity", roll: key, passed: sixesOf(I, key) > 0 }); }
  return sixesOf(I, key) > 0 ? null : "failed";
}
