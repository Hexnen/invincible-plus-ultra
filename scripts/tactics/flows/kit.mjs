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
import { dice, crits, conditions, attack } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";
import { holderBlocks } from "../catalog-pure.mjs";
import { modsFor } from "../kit-pure.mjs";

export const PASS = "pass";
export const draft = (inst) => JSON.parse(JSON.stringify(inst));
export const result = (inst) => ({ inst, effects: [], prompts: [], events: [], push: null, goto: null, wait: false, done: false });
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
/** Legality of an instance: the entry's requirements, then the flow's own rules. */
export const legality = (v, inst, flow) => {
  /* [B2707] out of action: whatever the flow, a broken, unconscious or dead character declares nothing and is no part of anything */
  const out = inst.actor ? M.outOfAction(v.state, inst.actor, v.facts.c(inst.actor)) : null;
  if (out && !(out === "broken" && flow.whenBroken?.(v, inst))) return { ok: false, reason: out, params: {} };      // the one thing a broken character may try is the flow's to name (rallying [B2773])
  const r = requirements(v, inst);
  if (!r.ok) return r;
  /* [B2497] the holder's own actions, whatever the flow (the attack flow and the action tables say it in their own words; a reaction, a part of
     another action and a child are not the holder's own declaration) */
  if (inst.actor && !inst.parent && !inst.part && !["attack", "act"].includes(inst.flow) && holderBlocks(v.entry(inst)) && M.hasStatus(v.state, inst.actor, "grappling")) return { ok: false, reason: "grappling", params: { gmMayAllow: 1 } };
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
  const pen = attr ? crits.critPenalty(c?.crits ?? [], attr) : 0;
  if (pen && !list.some((m) => m.source === "crit")) list.push({ source: "crit", dice: -pen });
  const must = M.tokensFor(v.state, cid, { kind: rollKind, attr }).filter(M.standing).map((t) => t.id);                // P6: dice somebody else put on the roll (bad luck) are not the roller's to leave out; [B1634]: a plan covers ALL rolls of its kind, attack and defence alike
  const tk = M.spendTokens(v.state, cid, { kind: rollKind, attr }, [...new Set([...tokens, ...must])]);
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
    if (kind === "grapple") add("sheet:grapple", b.grapple);
    if (["slugfest", "grappleAttack"].includes(kind)) add("sheet:slugfest", b.slugfest);
    const n = copiesOf(v.state, cid);
    if (n > 0 && ["slugfest", "shooting"].includes(kind)) add("copies", n);                    // [B1908]
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
/** [B2238], [B2167]: the dice of those who help; a Supportive helper gives two */
export const helpDiceOf = (v, d) => dice.helpDice((d?.helpers ?? []).filter((h) => h.consent === "yes").map((h) => ({ supportive: v.facts.c(h.id)?.pass?.supportive === true })));
/** the Barriers standing on a character, as Armor sources of the rules library [B1859] */
export const barriersOf = (state, cid) => (state.effects ?? []).filter((e) => e.kind === "barrier" && e.holder === cid).map((e) => ({ id: e.id, armor: Number(e.data?.armor) || 0, barrier: true }));
/** the copy bonus a character has left (Duplication [B1907]: an effect of the state) */
export const copiesOf = (state, cid) => Math.max(0, Number((state.effects ?? []).find((e) => e.kind === "copies" && e.holder === cid)?.data?.n) || 0);

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
    const list = reactions(v.state, cid, when, v.facts).filter((e) => e.reaction.who === "any" || inst.decl.targets.includes(cid));
    if (!list.length) continue;
    const options = list.map((e) => reactionOption(v, cid, e));
    if (!options.some((o) => !o.disabled)) continue;                 // no legal option: skipped automatically (plan 5.2 step 4)
    out.push({ key: `w:${when}:${cid}`, kind: "reaction", to: addressee(v, cid), about: cid, options: [...options, { id: PASS, label: "ITAC.opt.pass" }], data: { when } });
  }
  return out;
}
export function reactionOption(v, cid, e) {
  const o = { id: `r:${e.id}`, label: e.label, name: e.name || undefined, cost: e.cost, data: { entry: e.id, effect: e.reaction.effect } };
  if (e.stress?.fixed) o.stress = e.stress.fixed;
  const pay = P1.canPay(v.state, cid, e.cost, { interrupt: true });
  if (!pay.ok) o.disabled = pay.reason;
  else if (e.stress?.fixed && !(v.facts.c(cid)?.resolve > 0)) o.disabled = "stressedOut";                   // [B2816]
  return o;
}

/** May `t` answer an attack of this kind with a block or a dodge now? ONE reading for the attack flow and for every hazard that can be
    dodged [B2922]: the conditions of the state [R6], [R20], [R21], [R10], [B2392], out of action [B2707], holding somebody [B2497], and a
    quick action to pay with (the base pair or a grant, spec 4.2). `free`: the same with the action waived (Defensive [B2105]).
    -> { conds, hasQuick, out, paid: { block, dodge }, free: { block, dodge } }, each { ok, reason } (rules/attack.defenceOptions). */
export function defenceOf(v, t, kind, { inChase = false, machine = false } = {}) {
  const conds = M.conditions(v.state, t), hasQuick = !machine && P1.canPay(v.state, t, "quick", { interrupt: true, defense: true }).ok;
  const defender = { ...conds, out: M.outOfAction(v.state, t, v.facts.c(t)), holding: M.hasStatus(v.state, t, "grappling") };
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
  if (pol.push === "never") return false;
  return c.kind === "minions" || isMajor(v, cid) || pol.push === "ask";
}
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
  if (!Z) return out;
  const drop = (who, id) => { const k = `${who}:${id}`; if (!seen.has(k) && M.hasStatus(v.state, who, id)) { seen.add(k); out.push({ t: "status-", who, id }); } };
  for (const cid of new Set(ids)) for (const s of M.statusesOf(v.state, cid)) {
    const link = LINKS[s.id], other = link ? s.data?.[link[0]] : null;
    if (!link || typeof other !== "string") continue;
    const a = Z.place(cid)?.spot, b = Z.place(other)?.spot;
    if (a && b && a === b && M.hasStatus(v.state, other, link[1])) continue;
    drop(cid, s.id); drop(other, link[1]);
    if (s.id === "carrying" || s.id === "carried") { drop(cid, "airborne"); drop(other, "airborne"); }      // the mark of the pair that stayed in the air [B2392]
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
/** How many of a minion group fall to a hit that takes several at once (an area attack, full auto, a blast, a stunt that hits more than one) [OQ-1]:
    the GM's number, the damage taken is the suggestion. One card for the attack flow and for the hazards. -> { wait: true } | { taken } */
export const MINION_LOSS_MAX = 12;
export function minionLoss(v, I, R, t, taken, { by = null } = {}) {
  const tf = v.facts.c(t), key = `ml:${t}`, members = Math.max(0, tf?.members ?? tf?.health ?? 0), top = Math.min(members, MINION_LOSS_MAX);
  if (!I.data.pk?.[key]) { R.prompts.push({ key, kind: "minionLoss", to: "gm", about: t, options: Array.from({ length: top + 1 }, (_, n) => ({ id: `n:${n}`, label: "ITAC.opt.minionsFall", data: { n } })), data: { suggested: Math.min(top, taken), members, by } }); return { wait: true }; }
  if (!isAnswered(v, I, key)) return { wait: true };
  return { taken: Math.max(0, Math.min(members, Number(String(answerId(v, I, key) ?? "").split(":")[1]) || 0)) };
}
/** A minion group that lost members [B2828]: knocked out or killed is the GM's word (NpcPolicy.onBroken answers it without a card). Returns true while waiting. */
export function minionsFate(v, I, R, t, dm, { by = null } = {}) {
  const tf = v.facts.c(t);
  if (!tf || tf.kind !== "minions" || !(dm?.minions?.removed > 0)) return false;
  const key = `mfate:${t}`;
  if (!I.data.pk?.[key]) {
    const pol = v.state.npc?.[t]?.onBroken, p = { key, kind: "minionsFate", to: "gm", about: t, options: [{ id: "ko", label: "ITAC.opt.ko" }, { id: "kill", label: "ITAC.opt.kill" }], data: { removed: dm.minions.removed, left: dm.minions.left } };
    if (["ko", "kill"].includes(pol)) p.auto = { option: pol, reason: "npcDefault" };
    R.prompts.push(p); R.wait = true; return true;
  }
  if (!isAnswered(v, I, key)) { R.wait = true; return true; }
  if (!flag(I, key)) {
    setFlag(I, key);
    const id = answerId(v, I, key);
    dm.npcOutcome = id;
    if (id === "kill" && by && v.facts.c(by) && !v.facts.c(by).npc) R.effects.push({ t: "karma", note: { who: by, kind: "killed", target: t, n: dm.minions.removed } });     // [B815]
    if (dm.minions.left === 0) R.effects.push({ t: "status+", who: t, status: { id: id === "kill" ? "dead" : "unconscious", source: { kind: "gm", name: "minions" } } });
  }
  return false;
}

/** Broken and critical injuries after one damage event (spec 9.5 steps 7-9), shared by attacks and hazards. `dm` is the damage record of the flow
    ({ taken, healthBefore, tags }). Returns true when the step has to wait (an injury die, or the GM's word on an NPC).
    NPCs [B2771]: an ordinary NPC that is broken needs no injury, the GM states knocked out or killed, or has it rolled like a hero's; a major NPC
    always rolls. Minions never do [B2828]. Whoever is broken lets go of a grapple and is let go of. */
export function brokenAndCrit(v, I, R, t, dm, { deadlyHit = false, by = null } = {}) {
  if (!dm || dm.tags?.toStress || !(dm.taken > 0)) return false;
  const tf = v.facts.c(t);
  if (!tf) return false;
  const once = (k) => { if (flag(I, k)) return false; setFlag(I, k); return true; };
  const flags = { ...immunityFlags(tf), kind: isMajor(v, t) ? "majorNpc" : tf.kind };
  let cf = crits.critForHit({ taken: dm.taken, healthBefore: dm.healthBefore, deadlyHit, target: flags });   // [B2707], [B2708], [R9], [B2771], [B2828]
  if (cf.newlyBroken && once(`broken:${t}`)) {
    R.effects.push({ t: "status+", who: t, status: { id: "broken", source: { kind: "crit", owner: by ?? undefined, name: "broken" } } });
    for (const e of [...grappleRelease(v.state, t), ...carryRelease(v.state, t)]) R.effects.push(e);      // [B2707]: a broken character holds nobody and carries nobody
    R.events.push({ type: "broken", target: t });
    const bf = by ? v.facts.c(by) : null;                                                      // P6 [B2154] Merciless: 1 Resolve for breaking an enemy
    if (bf?.pass?.merciless && bf.resolve < bf.maxResolve && !!bf.npc !== !!tf.npc) R.effects.push({ t: "actor", who: by, path: "resolve", to: bf.resolve + 1 });
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
    if (once(key)) {
      const faces = I.data.res[key], kept = two && faces.length > 1 ? (killer ? Math.max(faces[0], faces[1]) : Math.min(faces[0], faces[1])) : faces[0];
      I.data.res[key] = [kept, ...faces.filter((_, i) => i !== faces.indexOf(kept))];
      const rc = crits.resolveCrit({ d6: I.data.res[key][0], bonus: cf.crit.bonus, prior: tf.crits ?? [], cap: v.state.opts?.critCap9 ? crits.FAMILY_CAP : crits.MAX_CRIT });   // [B2707], [B2709], [B2769]
      dm.crit = { d6: I.data.res[key][0], bonus: cf.crit.bonus, cause: cf.crit.cause, n: rc.n, id: rc.entry?.id, shifted: rc.shifted };
      R.effects.push({ t: "crit", who: t, n: rc.n, id: rc.entry?.id });
      const cs = crits.critState([...(tf.crits ?? []), rc.n]);                                 // [B2749-2765]
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
