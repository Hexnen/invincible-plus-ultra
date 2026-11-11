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
import { dice, crits, conditions } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";
import { holderBlocks } from "../catalog-pure.mjs";

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
  const pen = attr ? crits.critPenalty(c?.crits ?? [], attr) : 0;
  if (pen && !list.some((m) => m.source === "crit")) list.push({ source: "crit", dice: -pen });
  const tk = M.spendTokens(v.state, cid, { kind: rollKind, attr }, tokens);
  list.push(...tk.mods.map((m) => ({ source: m.source, dice: m.dice })));
  const forced = inst.data.forced?.pool?.[key];
  if (forced?.mods) list.push(...forced.mods.map((m) => ({ source: `gm:${String(m.label ?? "").slice(0, 24)}`, dice: Math.trunc(Number(m.dice) || 0) })));
  let pool = dice.buildPool(base ?? (attr ? Number(c?.attrs?.[attr]) || 0 : 0), list);
  if (Number.isFinite(forced?.total)) pool = { base: pool.base, mods: [...pool.mods, { source: "gm:total", dice: forced.total - pool.total }], total: forced.total, dice: dice.poolSize(forced.total) };
  return { pool, writes: tk.writes, needGm: tk.needGm };
}
/** Roll request effect. passive rolls and defender rolls cannot be pushed [B2227], [B2241]. */
export const rollEffect = (key, who, attr, pool, { passive = false, defender = false, secret = false, label = null, noPush = false } = {}) =>
  ({ t: "roll", key, who, attr, pool: { base: pool.base, mods: pool.mods, total: pool.total }, dice: pool.dice, maxPush: passive || defender || noPush ? 0 : null, secret: secret ? 1 : 0, label });

/** Can the instance's actor still act (spec 5.1 revalidation, first bullet)? Returns a reason id or null. */
export function actorBlocked(v, inst) {
  if (!inst.actor) return null;
  const a = v.facts.c(inst.actor);
  if (!a || a.present === false) return "gone";
  if (a.health <= 0) return "broken";                                                                       // [B2707]
  if (inst.cause === "interrupt" && !P1.canInterrupt(v.state, inst.actor).ok) return "noInterrupts";       // [L7]
  return null;
}
/** A reaction window (spec 9.1 steps 4, 6, 9): prompts for everyone who holds a reaction entry for it (catalog data), nobody else. Returns prompt specs. */
export function windowPrompts(v, inst, when, { skip = [], reactions }) {
  const out = [];
  for (const cid of Object.keys(v.state.ledger)) {
    if (cid === inst.actor || skip.includes(cid)) continue;
    const c = v.facts.c(cid);
    if (!c || c.present === false || c.health <= 0) continue;
    const list = reactions(v.state, cid, when).filter((e) => e.reaction.who === "any" || inst.decl.targets.includes(cid));
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

/** Is this combatant an NPC that rolls critical injuries like a hero [B2771]? The actor flag `major` or the GM's standing word (NpcPolicy.major). */
export const isMajor = (v, cid) => { const c = v.facts.c(cid); return !!c && c.npc && c.kind !== "minions" && (c.major === true || [true, "yes"].includes(v.state.npc?.[cid]?.major)); };
/** May a roll of this combatant be pushed at all? Heroes always (the system's own rules decide the rest). The book gives pushing to major NPCs and to
    minion groups [B2231], [B2830]; any other NPC only when the GM said so for it (NpcPolicy.push "ask"), and never with "never" [OQ-12], [A12]. */
export function mayPush(v, cid) {
  const c = v.facts.c(cid);
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
    for (const e of grappleRelease(v.state, t)) R.effects.push(e);                             // [B2707]: a broken character holds nobody
    R.events.push({ type: "broken", target: t });
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
  if (cf.crit) {
    const key = `crit:${t}`;
    if (I.data.res?.[key] == null) { if (once(`${key}:asked`)) R.effects.push({ t: "dice", key, n: 1 }); R.wait = true; return true; }
    if (once(key)) {
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
