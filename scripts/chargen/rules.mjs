/**
 * Character-generator rules engine (pure: Node + browser, no Foundry globals, no UI strings).
 * Numbers and rule structure only (see dev/chargen-spec.md sections 1.3, 6.2, 7.3).
 * Issues carry message KEYS (`IPC.Rule.<code>`); EN/PL strings live in lang.mjs.
 */

export const RANK_ORDER = ["teen", "street", "global", "cosmic"];
export const DEFAULT_RANK = "global";
/** points = attribute points, cap = per-attribute cap, powers = starting power slots, upgrades = starting base upgrades */
export const RANKS = Object.assign(Object.create(null), {   // null prototype: RANKS["constructor"] / ["__proto__"] are undefined (C1)
  teen: { key: "teen", points: 20, cap: 6, powers: 2, reputation: 0, upgrades: 0 },
  street: { key: "street", points: 26, cap: 8, powers: 3, reputation: 1, upgrades: 1 },
  global: { key: "global", points: 32, cap: 10, powers: 4, reputation: 2, upgrades: 2 },
  cosmic: { key: "cosmic", points: 38, cap: 12, powers: 5, reputation: 3, upgrades: 3 }
});
export const ATTRS = ["fighting", "agility", "strength", "reason", "intuition", "presence"];
export const ROLES = ["Blaster", "Brains", "Brawn", "Controller", "Defender", "Leader", "Striker", "Wildcard"];
export const STEP_IDS = ["start", "rank", "concept", "powers", "talents", "attributes", "life", "persona", "team", "review"];

export const MAX_DRAWBACKS = 2;
export const FREE_TALENTS = 2; // hero talent + occupation talent
export const ATTR_MIN = 1;
export const SLOT_VALUE = 2; // one power slot freed/spent = 2 attribute points
export const MAX_LEVEL_INDEX = 3; // 0 basic, 1 Major, 2 Massive, 3 Monstrous
/** talents / drawbacks that may be taken more than once, with how often (read from the live core book, phase 9: Windfall and Hard Times "several times" = no cap
    of their own, Durable and Determined "up to five times"). Everything else once. Knowledgeable counts per TALENT, not per subject (see talentKey). */
export const TALENT_LIMITS = { windfall: Infinity, durable: 5, determined: 5 };
export const DRAWBACK_LIMITS = { "hard times": Infinity };
export const REPEATABLE_TALENTS = Object.keys(TALENT_LIMITS);
export const REPEATABLE_DRAWBACKS = Object.keys(DRAWBACK_LIMITS);

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export const normName = norm;
/** "Knowledgeable (Technology)" -> "knowledgeable": the identity of a talent for the once-only rule (phase 9, C4: one Knowledgeable variant per hero) */
export const talentKey = (name) => norm(String(name ?? "").replace(/\s*\([^)]*\)\s*$/, ""));
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** how many times the talent / drawback may be taken in total (own keys only: a name like "constructor" is a plain once-only talent) */
export const talentLimit = (name) => (own(TALENT_LIMITS, talentKey(name)) ? TALENT_LIMITS[talentKey(name)] : 1);
export const drawbackLimit = (name) => (own(DRAWBACK_LIMITS, norm(name)) ? DRAWBACK_LIMITS[norm(name)] : 1);

/** phase 9 (B2): the highest level index the BOOK defines for a power ("Many powers only have a basic power level"). Filled at runtime from the installed
    book by catalog.mjs (setPowerMaxLevels); unknown powers are unrestricted here (apply re-checks against the catalogue). */
const POWER_MAX = new Map();
export function setPowerMaxLevels(entries) {
  POWER_MAX.clear();
  for (const [name, max] of entries) if (Number.isInteger(max)) POWER_MAX.set(norm(name), max);
}
export const powerMaxLevel = (power) => (Number.isInteger(power?.maxLevel) ? power.maxLevel : POWER_MAX.has(norm(power?.name)) ? POWER_MAX.get(norm(power?.name)) : null);

/** C1 (phase 9): own keys only, so "__proto__", "constructor", "toString" are not ranks */
export const isRank = (k) => typeof k === "string" && own(RANKS, k);
export function rankOf(state) { return isRank(state?.rank) ? RANKS[state.rank] : null; }
/** highest level index a hero may start with: Massive only for Cosmic Champion, Monstrous never */
export function levelCap(rank) { return rank === "cosmic" ? 2 : 1; }

// ---------- slots / budget ----------
export function limitsGranting(power) {
  const lim = power.limits ?? [];
  return {
    level: Math.min(lim.filter((l) => l.grants === "level").length, Math.max(0, power.level ?? 0)),
    boost: Math.min(lim.filter((l) => l.grants === "boost").length, (power.boosts ?? []).length)
  };
}
/** slots used by one power: levels (each counts as a power) + boosts - the free ones paid by valid limits */
export function powerSlots(power) {
  const g = limitsGranting(power);
  return (power.level ?? 0) + 1 + (power.boosts ?? []).length - g.level - g.boost;
}
const objs = (x) => (Array.isArray(x) ? x.filter((p) => p && typeof p === "object") : []);
export function slots(state) { return objs(state?.powers).reduce((a, p) => a + powerSlots(p), 0); }
export function extraSources(state) { return Math.max(0, objs(state?.sources).length - 1); }
export function extraTalentCount(state) { return objs(state?.extraTalents).length; }
export function drawbackCount(state) { return objs(state?.drawbacks).length; }

/** attribute points available: P + 2*(N - S) - extraSources - extraTalents + drawbacks */
export function budget(state) {
  const r = rankOf(state);
  if (!r) return 0;
  return r.points + SLOT_VALUE * (r.powers - slots(state)) - extraSources(state) - extraTalentCount(state) + drawbackCount(state);
}
export function budgetFor(rank, { S, x = 0, e = 0, d = 0 }) {
  const r = isRank(rank) ? RANKS[rank] : null;
  if (!r) return 0;
  return r.points + SLOT_VALUE * (r.powers - S) - x - e + d;
}
export function attrSum(attrs) { return ATTRS.reduce((a, k) => a + (Number(attrs?.[k]) || 0), 0); }

export function attributeBudget(state) {
  const r = rankOf(state);
  const b = budget(state), spent = attrSum(state.attrs);
  return {
    budget: b, spent, left: b - spent, cap: r?.cap ?? 0,
    canRaise: (k) => spent < b && (state.attrs[k] ?? 0) < (r?.cap ?? 0),
    canLower: (k) => (state.attrs[k] ?? 0) > ATTR_MIN
  };
}

/**
 * Deterministic redistribution of attribute points (spec 7.3).
 * Clamp to [1,cap]; then round-robin add (highest first) / remove (lowest above 2 first, else above 1).
 * Returns { ok, attrs } ; ok=false when target < 6 or > 6*cap (attrs then returned clamped, unchanged sum).
 */
export function reconcileAttributes(attrs, target, cap) {
  const out = {};
  for (const k of ATTRS) out[k] = Math.min(cap, Math.max(ATTR_MIN, Math.round(Number(attrs?.[k]) || ATTR_MIN)));
  if (!Number.isInteger(target) || target < ATTRS.length * ATTR_MIN || target > ATTRS.length * cap) return { ok: false, attrs: out };
  let diff = target - attrSum(out);
  // visiting order: descending value when adding, ascending when removing; ties keep attribute order
  const idx = ATTRS.map((k, i) => i);
  if (diff > 0) {
    const order = idx.slice().sort((a, b) => out[ATTRS[b]] - out[ATTRS[a]] || a - b);
    while (diff > 0) {
      let moved = false;
      for (const i of order) { if (diff > 0 && out[ATTRS[i]] < cap) { out[ATTRS[i]]++; diff--; moved = true; } }
      if (!moved) break;
    }
  } else if (diff < 0) {
    const order = idx.slice().sort((a, b) => out[ATTRS[a]] - out[ATTRS[b]] || a - b);
    for (const floor of [2, ATTR_MIN]) {
      let moved = true;
      while (diff < 0 && moved) {
        moved = false;
        for (const i of order) { if (diff < 0 && out[ATTRS[i]] > floor) { out[ATTRS[i]]--; diff++; moved = true; } }
      }
      if (diff === 0) break;
    }
  }
  return { ok: diff === 0, attrs: out };
}

// ---------- derived values ----------
/**
 * Health / Resolve / Slugfest preview. `bonuses` = sums of item-effect changes
 * ({health, resolve, slugfest, resources, reputation}); read from pack effects by the caller.
 */
export function derive(state, bonuses = {}) {
  const a = state.attrs ?? {};
  const half = (x) => Math.ceil(x / 2);
  const r = rankOf(state);
  return {
    health: half((a.fighting || 0) + (a.agility || 0) + (a.strength || 0)) + (bonuses.health ?? 0),
    resolve: half((a.reason || 0) + (a.intuition || 0) + (a.presence || 0)) + (bonuses.resolve ?? 0),
    slugfest: half(a.strength || 0) + (bonuses.slugfest ?? 0),
    reputation: (r?.reputation ?? 0) + (bonuses.reputation ?? 0),
    resources: (state.resources ?? 0) + (bonuses.resources ?? 0),
    flags: {
      // pack discrepancy: Hard Times text says -2 Resources, the pack effect applies -1. The effect wins.
      hardTimes: objs(state.drawbacks).some((d) => norm(d.name) === "hard times")
    }
  };
}

// ---------- validation ----------
const issue = (code, severity, step, path, params = {}) => ({ code, key: `IPC.Rule.${code}`, severity, step, path, params });

/** names taken more often than allowed: keyFn folds a name to its identity, limitFn gives how many times that identity may appear */
function overTaken(list, keyFn, limitFn) {
  const count = new Map(), over = new Set();
  for (const n of list) {
    const k = keyFn(n);
    if (!k) continue;
    const c = (count.get(k) ?? 0) + 1;
    count.set(k, c);
    if (c > limitFn(n)) over.add(k);
  }
  return [...over];
}
const dupNames = (list, limitFn = () => 1) => overTaken(list, norm, limitFn);
const arr = (x) => (Array.isArray(x) ? x : []);

/** All issues of the whole state. */
export function validate(state) {
  const out = [];
  if (!state || typeof state !== "object") return summarize([issue("rank.unknown", "error", "rank", "rank", { rank: "" })]);
  const r = rankOf(state);
  if (!r) { out.push(issue("rank.unknown", "error", "rank", "rank", { rank: String(state.rank) })); return summarize(out); }
  // C2 (phase 9): a state with a collection of the wrong shape is reported, never thrown
  for (const k of ["powers", "sources", "drawbacks", "extraTalents", "personality"]) if (state[k] != null && !Array.isArray(state[k])) { out.push(issue("state.shape", "error", "rank", k, { field: k })); return summarize(out); }

  // concept
  if (state.role && !ROLES.includes(state.role)) out.push(issue("role.unknown", "warn", "concept", "role", { role: state.role }));

  // powers
  const powers = arr(state.powers).filter((p) => p && typeof p === "object");
  const sources = arr(state.sources).filter((p) => p && typeof p === "object");
  const S = slots(state);
  if (!powers.length) out.push(issue("powers.none", "error", "powers", "powers"));
  else if (S < 1) out.push(issue("slots.min", "error", "powers", "powers", { slots: S }));
  if (powers.length && !sources.length) out.push(issue("sources.none", "error", "powers", "sources"));
  const keys = new Set(sources.map((s) => s.key));
  for (const d of dupNames(powers.map((p) => p.name))) out.push(issue("power.duplicate", "error", "powers", "powers", { name: d }));
  for (const d of dupNames(sources.map((s) => s.name))) out.push(issue("source.duplicate", "warn", "powers", "sources", { name: d }));
  powers.forEach((p, i) => {
    const path = `powers.${i}`;
    const lv = p.level ?? 0;
    if (!Number.isInteger(lv) || lv < 0 || lv > MAX_LEVEL_INDEX) out.push(issue("power.level.invalid", "error", "powers", path, { name: p.name, level: lv }));
    else if (lv >= 3) out.push(issue("power.level.monstrous", "error", "powers", path, { name: p.name }));
    else if (lv > levelCap(state.rank)) out.push(issue("power.level.massive", "error", "powers", path, { name: p.name }));
    else if (powerMaxLevel(p) !== null && lv > powerMaxLevel(p)) out.push(issue("power.level.none", "error", "powers", path, { name: p.name, max: powerMaxLevel(p) }));
    if (sources.length && !keys.has(p.sourceKey)) out.push(issue("power.source.missing", "error", "powers", path, { name: p.name }));
    const lim = p.limits ?? [];
    const lg = lim.filter((l) => l.grants === "level").length, bg = lim.filter((l) => l.grants === "boost").length;
    if (lim.some((l) => l.grants !== "level" && l.grants !== "boost")) out.push(issue("limit.grant.missing", "error", "powers", path, { name: p.name }));
    if (lg > Math.max(0, lv) || bg > (p.boosts ?? []).length) out.push(issue("limit.grant.invalid", "error", "powers", path, { name: p.name }));
  });
  for (const s of sources) if (powers.length && !powers.some((p) => p.sourceKey === s.key)) out.push(issue("source.unused", "warn", "powers", "sources", { name: s.name }));
  if (S > r.powers) out.push(issue("slots.over", "warn", "powers", "powers", { slots: S, max: r.powers, cost: SLOT_VALUE * (S - r.powers) }));

  // talents
  const drawbacks = arr(state.drawbacks).filter((p) => p && typeof p === "object");
  if (drawbacks.length > MAX_DRAWBACKS) out.push(issue("drawbacks.max", "error", "talents", "drawbacks", { count: drawbacks.length, max: MAX_DRAWBACKS }));
  if (!state.heroTalent?.name) out.push(issue("talent.hero.missing", "error", "talents", "heroTalent"));
  const talentNames = [state.heroTalent?.name, state.occTalent?.name, ...arr(state.extraTalents).map((t) => t?.name)].filter(Boolean);
  for (const d of overTaken(talentNames, talentKey, talentLimit)) out.push(issue("talent.duplicate", "error", "talents", "extraTalents", { name: d }));
  for (const d of dupNames(drawbacks.map((x) => x.name), drawbackLimit)) out.push(issue("drawback.duplicate", "error", "talents", "drawbacks", { name: d }));
  if (drawbacks.some((x) => norm(x.name) === "hard times")) out.push(issue("drawback.hardTimes", "info", "talents", "drawbacks"));
  // B4: a drawback that needs a choice (a power source, or something defined when you take it) with no note yet: a WARNING, not a block
  drawbacks.forEach((x, i) => { if (x.needs && !String(x.note ?? "").trim()) out.push(issue("drawback.note.missing", "warn", "talents", `drawbacks.${i}`, { name: x.name, kind: x.needs })); });

  // attributes
  const b = budget(state), sum = attrSum(state.attrs);
  for (const k of ATTRS) {
    const v = state.attrs?.[k];
    if (!Number.isInteger(v)) out.push(issue("attr.invalid", "error", "attributes", `attrs.${k}`, { attr: k }));
    else if (v < ATTR_MIN) out.push(issue("attr.low", "error", "attributes", `attrs.${k}`, { attr: k, min: ATTR_MIN }));
    else if (v > r.cap) out.push(issue("attr.cap", "error", "attributes", `attrs.${k}`, { attr: k, cap: r.cap }));
  }
  if (b < ATTRS.length * ATTR_MIN || b > ATTRS.length * r.cap) out.push(issue("budget.range", "error", "attributes", "attrs", { budget: b, cap: r.cap }));
  if (sum > b) out.push(issue("attr.over", "error", "attributes", "attrs", { over: sum - b, budget: b }));
  // decision 1 (user): ALL points must be spent, leftover is an error too
  else if (sum < b) out.push(issue("attr.unspent", "error", "attributes", "attrs", { left: b - sum, budget: b }));

  // life
  if (!state.occupation) out.push(issue("occupation.missing", "error", "life", "occupation"));
  else {
    if (!state.occTalent?.name) out.push(issue("talent.occ.missing", "error", "life", "occTalent"));
    if (!(state.resources >= 1)) out.push(issue("resources.invalid", "error", "life", "resources", { resources: state.resources }));
  }
  if (!String(state.npcRel?.name ?? "").trim()) out.push(issue("npc.name.blank", "warn", "life", "npcRel.name"));

  // persona
  const pers = (state.personality ?? []).map(norm).filter(Boolean);
  if (pers.length !== 2 || new Set(pers).size !== 2) out.push(issue("personality.count", "error", "persona", "personality", { count: pers.length }));
  const has = (v) => !!(String(v?.name ?? "").trim() || String(v?.text ?? "").trim());
  if (!has(state.drive)) out.push(issue("drive.empty", "error", "persona", "drive"));
  if (!has(state.flaw)) out.push(issue("flaw.empty", "error", "persona", "flaw"));
  if (!String(state.heroName ?? "").trim()) out.push(issue("heroName.empty", "error", "persona", "heroName"));
  if (!String(state.civilianName ?? "").trim()) out.push(issue("civilianName.empty", "warn", "persona", "civilianName"));

  // team
  // phase 5f: team.mode = "text" (default) | "join" (a chosen base card) | "create" (a new base card) | "member" (the hero already belongs to a base; the card owns the team texts)
  const tmode = state.team?.mode ?? "text";
  const tName = String(state.team?.name ?? "").trim(), tBase = String(state.team?.base ?? "").trim();
  if (tmode === "join" && !state.team?.baseId) out.push(issue("team.join.missing", "error", "team", "team.baseId"));
  else if (tmode === "create" ? !tName : tmode !== "join" && tmode !== "member" && !tName && !tBase) out.push(issue("team.empty", "warn", "team", "team"));
  if (tmode !== "member" && (state.team?.upgrades ?? []).length > r.upgrades) out.push(issue("upgrades.over", "warn", "team", "team.upgrades", { count: state.team.upgrades.length, max: r.upgrades }));

  return summarize(out);
}

function summarize(issues) {
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warn");
  return { issues, errors, warnings, ok: errors.length === 0 };
}

/** Issues of one step (UI gating of Next). */
export function validateStep(state, stepId) {
  const all = validate(state);
  return summarize(all.issues.filter((i) => i.step === stepId));
}
/** Apply is allowed only when there are no errors at all (every attribute point spent included). */
export function canApply(state) { return validate(state).ok; }
