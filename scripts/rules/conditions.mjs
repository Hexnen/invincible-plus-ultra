/* Rules library: evaluator of the action catalog's data predicates (`Cond`) and conditional dice modifiers (`ModRule`), spec section 8.
   Pure ES module, no Foundry globals. It holds NO rule of its own: a predicate is data written by the catalog next to the book line it
   stands for; this module only answers it against a read-only snapshot (plain data: actor facts, statuses, history, zone facts) in the
   shape every check of this library answers, { ok, reason, gmMayAllow }.

   The kinds of rule text the grammar has to express (the examples the checks of check-conditions.mjs are written from):
     a fact that must hold           book 1680: electrical energy in the own or an adjacent zone
     a fact about the last turn      book 1903: did not move or attack on the previous turn; book 2545: no movement in the round of firing
     a price paid in the round       book 2116: +2 dice for giving up the quick action
     a fact about the target         book 2098: +2 dice against a huge creature; book 1680: +2 against a conductive opponent
     the kind of roll                book 2099: +2 to STRENGTH rolls for a charge; book 2111: +2 to AGILITY rolls to dodge
     something only the table knows  the GM confirms it (spec 8: any condition without data behind it)

   Cond =
     true | false
     [Cond, ...]                                   all of them
     { all: [Cond, ...] } | { any: [Cond, ...] } | { not: Cond }
     { fact: "path.to.value", op?, value? | ref?: "other.path" }
           op: "truthy" (default without value / ref) | "falsy" | "eq" (default with value / ref) | "ne" | "gt" | "gte" | "lt" | "lte"
               | "in" (the fact is one of the list `value`) | "has" (the fact, a list or a string, contains `value`)
           a missing fact is undefined: "truthy" fails, "falsy" holds, comparisons fail
     { check: "name", args?: { key: value | { ref: "path" } } }
           one of the caller's own checks (opts.checks[name](args, snapshot) -> boolean | { ok, reason, gmMayAllow }); this is how a
           catalog entry names a check of this library (zones.canShoot, stunts.isImmune, ...). An unknown name fails with reason
           "unknownCheck" and gmMayAllow, and is listed in `needsGm`.
     { gm: "id" }                                  holds only when the GM confirmed it: `id` is in opts.confirmed (a Set, a list or
                                                   an object of true values); otherwise it fails with gmMayAllow and is listed in `needsGm`
   every object form may carry `reason` (the code shown when it fails; defaults below) and `gmMayAllow` (default false; true for gm and
   unknown checks).

   Result: { ok, reason, gmMayAllow, needsGm: [ids] }
     reason      null when ok, else the reason of the FIRST failing condition (default: the fact path, the check name, the gm id, "not",
                 "none" for an empty `any`)
     needsGm     ids of the gm-conditions (and "check:name" of unknown checks) that failed only for want of the GM's word; when every
                 failure is of that kind the caller asks the GM and evaluates again with them confirmed */

const OPS = {
  truthy: (a) => !!a, falsy: (a) => !a,
  eq: (a, b) => a === b, ne: (a, b) => a !== b,
  gt: (a, b) => typeof a === "number" && a > b, gte: (a, b) => typeof a === "number" && a >= b,
  lt: (a, b) => typeof a === "number" && a < b, lte: (a, b) => typeof a === "number" && a <= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
  has: (a, b) => (Array.isArray(a) || typeof a === "string") && a.includes(b),
};
export const COND_OPS = Object.keys(OPS);

/* read "a.b.0.c" from plain data; undefined when any step is missing. Only own properties are followed. */
export function factOf(snapshot, path) {
  let v = snapshot;
  for (const key of String(path).split(".")) {
    if (v == null || typeof v !== "object" || !Object.prototype.hasOwnProperty.call(v, key)) return undefined;
    v = v[key];
  }
  return v;
}

const isConfirmed = (confirmed, id) => (!confirmed ? false : confirmed instanceof Set ? confirmed.has(id) : Array.isArray(confirmed) ? confirmed.includes(id) : confirmed[id] === true);
const pass = () => ({ ok: true, reason: null, gmMayAllow: false, needsGm: [] });
const fail = (reason, gmMayAllow = false, needsGm = []) => ({ ok: false, reason, gmMayAllow: !!gmMayAllow, needsGm });

/* Evaluate one Cond. opts: { checks: { name: fn }, confirmed: Set | list | object }. Throws on a malformed condition (see validateCond). */
export function evalCond(cond, snapshot = {}, opts = {}) {
  if (cond === true || cond == null) return pass();
  if (cond === false) return fail("never");
  if (Array.isArray(cond)) return evalAll(cond, snapshot, opts);
  if (typeof cond !== "object") throw new Error(`evalCond: not a condition: ${JSON.stringify(cond)}`);
  if ("all" in cond) return relabel(evalAll(cond.all, snapshot, opts), cond);
  if ("any" in cond) {
    const fails = [];
    for (const c of cond.any) {
      const r = evalCond(c, snapshot, opts);
      if (r.ok) return pass();
      fails.push(r);
    }
    const needsGm = [...new Set(fails.flatMap((r) => r.needsGm))];
    return fail(cond.reason ?? fails[0]?.reason ?? "none", cond.gmMayAllow ?? fails.some((r) => r.gmMayAllow), needsGm);
  }
  if ("not" in cond) return evalCond(cond.not, snapshot, opts).ok ? fail(cond.reason ?? "not", cond.gmMayAllow) : pass();
  if ("fact" in cond) {
    const hasOther = "value" in cond || "ref" in cond;
    const op = cond.op ?? (hasOther ? "eq" : "truthy");
    if (!OPS[op]) throw new Error(`evalCond: unknown op "${op}"`);
    const other = "ref" in cond ? factOf(snapshot, cond.ref) : cond.value;
    return OPS[op](factOf(snapshot, cond.fact), other) ? pass() : fail(cond.reason ?? cond.fact, cond.gmMayAllow);
  }
  if ("check" in cond) {
    const fn = opts.checks?.[cond.check];
    if (typeof fn !== "function") return fail(cond.reason ?? "unknownCheck", true, [`check:${cond.check}`]);
    const args = {};
    for (const [k, v] of Object.entries(cond.args ?? {})) args[k] = v && typeof v === "object" && !Array.isArray(v) && "ref" in v ? factOf(snapshot, v.ref) : v;
    const r = fn(args, snapshot);
    if (r === true || r === false) return r ? pass() : fail(cond.reason ?? cond.check, cond.gmMayAllow);
    if (r && typeof r === "object" && "ok" in r) return r.ok ? pass() : fail(cond.reason ?? r.reason ?? cond.check, cond.gmMayAllow ?? r.gmMayAllow);
    throw new Error(`evalCond: check "${cond.check}" must answer a boolean or { ok, reason, gmMayAllow }`);
  }
  if ("gm" in cond) return isConfirmed(opts.confirmed, cond.gm) ? pass() : fail(cond.reason ?? cond.gm, true, [cond.gm]);
  throw new Error(`evalCond: not a condition: ${JSON.stringify(cond)}`);
}

function evalAll(list, snapshot, opts) {
  let first = null;
  const needsGm = [];
  for (const c of list ?? []) {
    const r = evalCond(c, snapshot, opts);
    if (r.ok) continue;
    first ??= r;
    for (const id of r.needsGm) if (!needsGm.includes(id)) needsGm.push(id);
  }
  return first ? fail(first.reason, first.gmMayAllow, needsGm) : pass();
}
const relabel = (r, cond) => (r.ok ? r : fail(cond.reason ?? r.reason, cond.gmMayAllow ?? r.gmMayAllow, r.needsGm));

/* `requires` / `filter` of a catalog entry: a list of conditions, all must hold. Same result as evalCond, plus `failed`: the result of
   every failing condition in order (for greying an option with all its reasons, spec 8). */
export function evalConds(conds, snapshot = {}, opts = {}) {
  const failed = [];
  for (const c of conds ?? []) {
    const r = evalCond(c, snapshot, opts);
    if (!r.ok) failed.push(r);
  }
  if (!failed.length) return { ...pass(), failed };
  return { ...fail(failed[0].reason, failed[0].gmMayAllow, [...new Set(failed.flatMap((r) => r.needsGm))]), failed };
}

/* true when the only thing between a failed result and success is the GM's word (every failing leaf is a gm-condition or an unknown
   check). Found by evaluating again with those ids confirmed and unknown checks taken as passed. */
export function onlyNeedsGm(conds, snapshot = {}, opts = {}) {
  const r = evalConds(conds, snapshot, opts);
  if (r.ok || !r.needsGm.length) return false;
  const confirmed = new Set(r.needsGm.filter((id) => !id.startsWith("check:")));
  if (opts.confirmed) for (const id of opts.confirmed instanceof Set || Array.isArray(opts.confirmed) ? opts.confirmed : Object.keys(opts.confirmed).filter((k) => opts.confirmed[k] === true)) confirmed.add(id);
  const checks = { ...(opts.checks ?? {}) };
  for (const id of r.needsGm) if (id.startsWith("check:")) checks[id.slice(6)] = () => true;
  return evalConds(conds, snapshot, { ...opts, confirmed, checks }).ok;
}

/* ModRule = { source, dice: n | { ref: "path", times?: n, min?: n, max?: n }, when?: Cond, attrs?: [attr], rolls?: [roll kind] }
     dice    a number (book 2235: modifiers add or remove dice), or a number read from the snapshot (times a factor, clamped)
     when    the condition under which the modifier applies (default: always)
     attrs   the modifier belongs to rolls of these attributes only (book 2099, 2111); matched against opts.attr
     rolls   ... and to these kinds of roll only ("slugfest", "dodge", "charge", ...; the catalog's own words); matched against opts.roll
   Result: { mods: [{ source, dice }], pending: [{ source, dice, needsGm, reason }] }
     mods      the modifiers that apply, ready for dice.buildPool(base, mods)
     pending   modifiers whose condition failed only for want of the GM's word: the caller asks, then evaluates again
   opts: { attr, roll, checks, confirmed } */
export function evalModRules(rules, snapshot = {}, opts = {}) {
  const mods = [], pending = [];
  for (const rule of rules ?? []) {
    if (!rule) continue;
    if (rule.attrs && !rule.attrs.includes(opts.attr)) continue;
    if (rule.rolls && !rule.rolls.includes(opts.roll)) continue;
    let dice = rule.dice;
    if (dice && typeof dice === "object") {
      const v = factOf(snapshot, dice.ref);
      dice = Number.isFinite(v) ? v * (dice.times ?? 1) : 0;
      if (rule.dice.min != null) dice = Math.max(rule.dice.min, dice);
      if (rule.dice.max != null) dice = Math.min(rule.dice.max, dice);
    }
    if (!Number.isFinite(dice) || dice === 0) continue;
    const when = rule.when === undefined ? [] : [rule.when];
    const r = evalConds(when, snapshot, opts);
    if (r.ok) mods.push({ source: rule.source, dice });
    else if (onlyNeedsGm(when, snapshot, opts)) pending.push({ source: rule.source, dice, needsGm: r.needsGm, reason: r.reason });
  }
  return { mods, pending };
}
/* just the list for dice.buildPool */
export const modRules = (rules, snapshot = {}, opts = {}) => evalModRules(rules, snapshot, opts).mods;

/* Check the shape of a condition without evaluating it: [] when well formed, else a list of messages with the place of each fault.
   For the catalog's own load-time check. */
export function validateCond(cond, at = "cond") {
  if (cond === true || cond === false) return [];
  if (Array.isArray(cond)) return cond.flatMap((c, i) => validateCond(c, `${at}[${i}]`));
  if (!cond || typeof cond !== "object") return [`${at}: not a condition`];
  const kinds = ["all", "any", "not", "fact", "check", "gm"].filter((k) => k in cond);
  if (kinds.length !== 1) return [`${at}: needs exactly one of all / any / not / fact / check / gm`];
  const k = kinds[0];
  if (k === "all" || k === "any") return Array.isArray(cond[k]) ? cond[k].flatMap((c, i) => validateCond(c, `${at}.${k}[${i}]`)) : [`${at}.${k}: not a list`];
  if (k === "not") return validateCond(cond.not, `${at}.not`);
  if (k === "fact") {
    const out = [];
    if (typeof cond.fact !== "string" || !cond.fact) out.push(`${at}.fact: not a path`);
    if (cond.op !== undefined && !OPS[cond.op]) out.push(`${at}.op: unknown op "${cond.op}"`);
    if ("value" in cond && "ref" in cond) out.push(`${at}: value and ref together`);
    if ("ref" in cond && typeof cond.ref !== "string") out.push(`${at}.ref: not a path`);
    const op = cond.op ?? ("value" in cond || "ref" in cond ? "eq" : "truthy");
    if (OPS[op] && !["truthy", "falsy"].includes(op) && !("value" in cond || "ref" in cond)) out.push(`${at}: op "${op}" needs value or ref`);
    return out;
  }
  if (k === "check") return typeof cond.check === "string" && cond.check ? [] : [`${at}.check: not a name`];
  return typeof cond.gm === "string" && cond.gm ? [] : [`${at}.gm: not an id`];
}
