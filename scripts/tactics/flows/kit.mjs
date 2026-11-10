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
import { dice, crits } from "../../rules/index.mjs";
import * as P1 from "../economy-pure.mjs";
import * as M from "../mods-pure.mjs";

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

/** Dice pool of a combatant's roll: attribute + modifiers, the worst critical-injury penalty for that attribute [B2709], chosen modifier tokens (spec 6.2),
    a GM override (spec 14.1 setPool), never below one die [B2235] (dice.buildPool). Returns { pool, writes (token spending), needGm }. */
export function buildPool(v, inst, key, cid, attr, mods = [], { rollKind = "other", tokens = [], base = null } = {}) {
  const c = v.facts.c(cid);
  const list = mods.map((m) => ({ ...m }));
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
export const rollEffect = (key, who, attr, pool, { passive = false, defender = false, secret = false, label = null } = {}) =>
  ({ t: "roll", key, who, attr, pool: { base: pool.base, mods: pool.mods, total: pool.total }, dice: pool.dice, maxPush: passive || defender ? 0 : null, secret: secret ? 1 : 0, label });

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

/** Broken and critical injuries after one damage event (spec 9.5 steps 7-9), shared by attacks and hazards. `dm` is the damage record of the flow
    ({ taken, healthBefore, tags }). Returns true when the step has to wait (an injury die, or the GM's word on an NPC). */
export function brokenAndCrit(v, I, R, t, dm, { deadlyHit = false, by = null } = {}) {
  if (!dm || dm.tags?.toStress || !(dm.taken > 0)) return false;
  const tf = v.facts.c(t);
  if (!tf) return false;
  const once = (k) => { if (flag(I, k)) return false; setFlag(I, k); return true; };
  const cf = crits.critForHit({ taken: dm.taken, healthBefore: dm.healthBefore, deadlyHit, target: { kind: tf.kind, huge: !!tf.huge } });   // [B2707], [B2708], [R9], [B2771], [B2828]
  if (cf.newlyBroken && once(`broken:${t}`)) {
    R.effects.push({ t: "status+", who: t, status: { id: "broken", source: { kind: "crit", owner: by ?? undefined, name: "broken" } } });
    R.events.push({ type: "broken", target: t });
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
    return false;
  }
  if (cf.gmChoice) {                                                                           // [B2771]: an ordinary NPC needs no injury, the GM states the outcome
    const key = `npcBroken:${t}`;
    if (!I.data.pk?.[key]) {
      const pol = v.state.npc?.[t]?.onBroken, p = { key, kind: "npcBroken", to: "gm", about: t, options: [{ id: "ko", label: "ITAC.opt.ko" }, { id: "kill", label: "ITAC.opt.kill" }, { id: "crit", label: "ITAC.opt.rollCrit" }] };
      if (["ko", "kill"].includes(pol)) p.auto = { option: pol, reason: "npcDefault" };       // spec 13.3 NpcPolicy.onBroken
      R.prompts.push(p); R.wait = true; return true;
    }
    if (!isAnswered(v, I, key)) { R.wait = true; return true; }
    if (once(key)) {
      const id = answerId(v, I, key);
      dm.npcOutcome = id;
      if (id === "kill") {
        R.effects.push({ t: "status+", who: t, status: { id: "dead", source: { kind: "gm", name: "npcBroken" } } });
        if (by && v.facts.c(by) && !v.facts.c(by).npc) R.effects.push({ t: "karma", note: { who: by, kind: "killed", target: t } });     // [B815], spec 9.11
      } else if (id === "ko") R.effects.push({ t: "status+", who: t, status: { id: "unconscious", source: { kind: "gm", name: "npcBroken" } } });
      else (I.data.notes ??= []).push({ note: "npcCritByHand", target: t });                   // rolled like a hero: run by the GM from the card until P4
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
