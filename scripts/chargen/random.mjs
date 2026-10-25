/**
 * Random hero generator (pure: Node + browser, no Foundry globals, deterministic for a seed).
 *
 * PUBLIC API
 *   rollHero(seed, rank, provider, opts?)        -> { state, ok, issues, errors, warnings }
 *   rollAll(state, provider, opts?)              -> same; rolls every step that is not locked / touched
 *   rollStep(state, stepId, provider, opts?)     -> new state (same object if nothing could be rolled);
 *                                                   stepId in concept|powers|talents|attributes|life|persona|team
 *   RANDOM_STEPS                                 -> order used by rollAll
 *
 * opts (all optional)
 *   withinArchetype  false  decision 2 default: free roll from the whole pool. true = "stay within an archetype"
 *   archetype        null   force this archetype id (with withinArchetype)
 *   drawbacks        true   may add 1-2 drawbacks          extraTalents true   may buy extra talents
 *   extraSource      true   may take a 2nd power source    slotVariance true   +-1 power slot vs the rank
 *   limitChance      0.3    chance of one limit that pays for a level step / boost
 *   honorTouched     true   (rollAll) steps the user edited by hand count as locked
 *   heroRel          true   roll the second key relationship (another hero of the table)   joinBase false  may JOIN an existing base card (team step)
 *
 * Locks (state.locks[field] = true) are constraints: locked values never change, the rest is drawn around them.
 * If the attributes are locked, powers/talents/drawbacks are planned so the locked sum is exactly the budget.
 * Isolation: each step draws from substream `${seed}:${step}:${state.rerolls[step]}`. Re-rolling one step leaves the
 * other steps unchanged; the ONLY exception is that re-rolling powers or talents changes the budget, so the attribute
 * values are re-balanced (rules.reconcileAttributes) unless locked.
 *
 * PROVIDER INTERFACE (implemented in phase 3b/6 with RollTables/packs; tests use fixtures). Everything may be async.
 *   provider.list(key, ctx) -> Entry[]            required. Entry = { name, packUuid?, text?, data?, type?, maxLevel? }
 *   provider.roll?(key, rng, ctx) -> Entry|null   optional: use a real table roll (RollTable.roll(), never draw());
 *                                                 when absent a uniform pick from list() is made with the seeded rng
 *   provider.getArchetype?(id) -> { id, name?, role, attrs:{six}, powers:[{name,packUuid?,level(0|1),boosts:[{name,packUuid?}]}] }
 * keys / ctx:
 *   archetypes {}                       [{name: id}]            powers {rank}          maxLevel = highest level index available
 *   boosts {power} / limits {power}     candidates of that power (by power name)
 *   powerSources {archetype?}           heroTalents {archetype?}  talents {}   drawbacks {archetype?}
 *   knowledgeableSubjects {}            variants, e.g. "Knowledgeable (X)", picked when the bare talent "Knowledgeable" is drawn
 *   occupations {archetype?}            data: { resources }     occupationTalents {occupation}   npcRelations {occupation}
 *   personality {archetype?} drives {archetype?} flaws {archetype?} heroNames {archetype?}   (drive/flaw: text optional)
 *   civilianNames {purpose: "hero"|"npc"}   teamNames {}   teamBases {rank}   baseUpgrades {}   heroRelations {}
 *   cityLocations {}   (phase 6) the City Locations table; roll() = a seeded D66 on its rows
 *   existingBases {}   (phase 6) base cards the user may join: [{name, data:{baseId}}]
 * DISTRIBUTIONS (phase 6): the real provider's roll(key, rng) is a SEEDED equivalent of RollTable.roll() (same formula, same uneven rows: the D66
 * power-source and City Locations tables use tens + units dice); keys without a table (powers, civilian names ...) are uniform seeded picks.
 * draw() tries roll() up to 3 times when the roll lands on an excluded entry, then falls back to a uniform pick of what is left.
 */
import { substream } from "./rng.mjs";
import {
  RANKS, ATTRS, ROLES, levelCap, slots, powerSlots, budget, budgetFor, attrSum,
  reconcileAttributes, extraSources, validate, normName, talentKey
} from "./rules.mjs";
import { createState, STEP_FIELDS, FIELD_STEP } from "./state.mjs";

export { newSeed } from "./rng.mjs";
export const RANDOM_STEPS = ["concept", "powers", "talents", "attributes", "life", "persona", "team"];
const DEFAULTS = { withinArchetype: false, archetype: null, drawbacks: true, extraTalents: true, extraSource: true, slotVariance: true, limitChance: 0.3, honorTouched: true, heroRel: true, joinBase: false };

// ---------- provider helpers ----------
const listOf = async (P, key, ctx = {}) => { const r = await P.list(key, ctx); return Array.isArray(r) ? r : []; };
async function draw(P, key, rng, ctx, exclude = () => false) {
  const items = (await listOf(P, key, ctx)).filter((e) => e && !exclude(e));
  if (!items.length) return null;
  if (typeof P.roll === "function") {
    for (let i = 0; i < 3; i++) { const r = await P.roll(key, rng, ctx); if (r && !exclude(r)) return r; }
  }
  return rng.pick(items);
}
const getArchetype = async (P, id) => (id && typeof P.getArchetype === "function" ? P.getArchetype(id) : null);
const ref = (e) => ({ name: e.name, packUuid: e.packUuid ?? null });
const activeArchetype = (state, opts) => ((opts.withinArchetype || state.locks.archetype) && state.archetype ? state.archetype : null);
const ctxOf = (state, opts, extra = {}) => ({ rank: state.rank, ...(activeArchetype(state, opts) ? { archetype: activeArchetype(state, opts) } : {}), ...extra });
const usedTalents = (s) => new Set([s.heroTalent?.name, s.occTalent?.name, ...s.extraTalents.map((t) => t.name)].filter(Boolean).map(talentKey));

/** a bare "Knowledgeable" becomes one of the book's six subjects (D6 table); only ONE Knowledgeable variant per hero (C4), so none when one is already taken; null when the subject cannot be placed */
async function expandTalent(P, e, rng, used = new Set()) {
  if (normName(e.name) !== "knowledgeable") return e;
  if (used.has("knowledgeable")) return null;
  return (await draw(P, "knowledgeableSubjects", rng, {}, (z) => used.has(talentKey(z.name)))) ?? null;
}

// ---------- budget plan: how many slots / sources / extra talents / drawbacks ----------
const spread = (lo, hi) => Array.from({ length: Math.max(0, hi - lo + 1) }, (_, i) => lo + i);

/** Choose {S,x,e,d}. `fixed` pins some; `target` (locked attribute sum) forces budget == target. null = impossible. */
function planCounts(rank, opts, rng, fixed, target, baseS) {
  const cfg = RANKS[rank];
  const Ss = fixed.S != null ? [fixed.S] : spread(1, cfg.powers + 3);
  const xs = fixed.x != null ? [fixed.x] : (opts.extraSource ? [0, 1] : [0]);
  const es = fixed.e != null ? [fixed.e] : (opts.extraTalents ? [0, 1, 2] : [0]);
  const ds = fixed.d != null ? [fixed.d] : (opts.drawbacks ? [0, 1, 2] : [0]);
  const wS = (S) => { if (!opts.slotVariance && fixed.S == null) return S === baseS ? 1 : 0; const dist = Math.abs(S - baseS); return dist === 0 ? 6 : dist === 1 ? 2 : dist === 2 ? 0.5 : 0.1; };
  const wx = (x) => (x ? 1 : 3), we = (e) => [4, 2, 1][e] ?? 0.5, wd = (d) => [2, 2, 1][d] ?? 0.5;
  const combos = [];
  for (const S of Ss) for (const x of xs) for (const e of es) for (const d of ds) {
    if (S < 1 || x > S - 1) continue; // a 2nd source needs a 2nd power
    const B = budgetFor(rank, { S, x, e, d });
    combos.push({ S, x, e, d, B, w: wS(S) * wx(x) * we(e) * wd(d) });
  }
  let ok = target != null ? combos.filter((c) => c.B === target) : combos.filter((c) => c.B >= 12 && c.B <= 6 * cfg.cap);
  if (!ok.length && target == null) ok = combos.filter((c) => c.B >= 6 && c.B <= 6 * cfg.cap);
  if (!ok.length) return null;
  const c = rng.weighted(ok, (z) => z.w);
  return { S: c.S, x: c.x, e: c.e, d: c.d };
}

async function makePlan(state, P, opts, rng, fixed, target) {
  const N = RANKS[state.rank].powers;
  let baseS = N;
  const aid = activeArchetype(state, opts);
  const arch = await getArchetype(P, aid);
  if (arch) baseS = Math.max(1, arch.powers.reduce((a, p) => a + (p.level ?? 0) + 1 + (p.boosts?.length ?? 0), 0) + (N - 4));
  return planCounts(state.rank, opts, rng, fixed, target, baseS) ?? (target != null ? null : planCounts(state.rank, { ...opts, slotVariance: true }, rng, {}, null, baseS));
}

function fixedFromFrozen(state, frozen) {
  const f = {};
  if (frozen("powers")) f.S = slots(state);
  if (frozen("sources") || frozen("powers")) f.x = extraSources(state);
  if (frozen("drawbacks")) f.d = state.drawbacks.length;
  if (frozen("extraTalents")) f.e = state.extraTalents.length;
  return f;
}

// ---------- powers ----------
async function buildFree(P, ctx, rank, nominal, minPowers, rng, cache) {
  const pool = await listOf(P, "powers", ctx);
  if (!pool.length) return [];
  const kMax = Math.min(nominal, pool.length);
  const kMin = Math.min(Math.max(1, minPowers), kMax);
  const k = rng.weighted(spread(kMin, kMax), (v) => v);
  const powers = [];
  const types = new Set();
  let rest = pool.slice();
  const addPower = () => {
    const e = rng.weighted(rest, (x) => (x.type && !types.has(x.type) ? 2 : 1));
    types.add(e.type); rest = rest.filter((x) => x !== e);
    powers.push({ key: `p${powers.length + 1}`, name: e.name, packUuid: e.packUuid ?? null, level: 0, sourceKey: null, boosts: [], limits: [], max: Math.min(levelCap(rank), e.maxLevel ?? 9) });
  };
  while (powers.length < k) addPower();
  let extra = nominal - k;
  while (extra > 0) {
    const options = [];
    for (const p of powers) {
      if (p.level < p.max) options.push({ p, kind: "level", w: 3 });
      const used = new Set(p.boosts.map((b) => normName(b.name)));
      const avail = (await cached(cache, P, "boosts", p.name)).filter((b) => !used.has(normName(b.name)));
      if (avail.length) options.push({ p, kind: "boost", w: 1, avail });
    }
    if (!options.length) { if (rest.length) { addPower(); extra--; continue; } break; }
    const o = rng.weighted(options, (z) => z.w);
    if (o.kind === "level") o.p.level++; else o.p.boosts.push(ref(rng.pick(o.avail)));
    extra--;
  }
  return powers;
}
async function cached(cache, P, key, power) {
  const k = `${key}|${power}`;
  if (!cache.has(k)) cache.set(k, await listOf(P, key, { power }));
  return cache.get(k);
}
const strip = (powers) => powers.map(({ max, ...p }) => p);

/** one limit that pays for a level step or a boost of a power; null if none possible */
async function addOneLimit(P, powers, rng, cache) {
  const cands = [];
  for (const p of powers) {
    const lg = p.limits.filter((l) => l.grants === "level").length, bg = p.limits.filter((l) => l.grants === "boost").length;
    const used = new Set(p.limits.map((l) => normName(l.name)));
    const lims = (await cached(cache, P, "limits", p.name)).filter((l) => !used.has(normName(l.name)));
    if (!lims.length) continue;
    if (p.level - lg > 0) cands.push({ p, grants: "level", lims });
    if (p.boosts.length - bg > 0) cands.push({ p, grants: "boost", lims });
  }
  if (!cands.length) return false;
  const c = rng.pick(cands);
  c.p.limits.push({ ...ref(rng.pick(c.lims)), grants: c.grants });
  return true;
}

async function adaptArchetypePowers(P, arch, target, rank, minPowers, rng, ctx) {
  const cap = levelCap(rank);
  const pool = await listOf(P, "powers", ctx);
  const maxOf = (name) => { const e = pool.find((x) => normName(x.name) === normName(name)); return Math.min(cap, e?.maxLevel ?? 9); };   // B2: only the levels the book defines for that power
  const powers = arch.powers.map((p, i) => ({ key: `p${i + 1}`, name: p.name, packUuid: p.packUuid ?? null, level: Math.min(p.level ?? 0, maxOf(p.name)), sourceKey: null, boosts: (p.boosts ?? []).map(ref), limits: [], ...(p.note ? { note: p.note } : {}) }));
  const total = () => powers.reduce((a, p) => a + powerSlots(p), 0);
  const addNew = () => {
    const names = new Set(powers.map((p) => normName(p.name)));
    const rest = pool.filter((e) => !names.has(normName(e.name)));
    if (!rest.length) return false;
    const e = rng.pick(rest);
    powers.push({ key: `p${powers.length + 1}`, name: e.name, packUuid: e.packUuid ?? null, level: 0, sourceKey: null, boosts: [], limits: [] });
    return true;
  };
  while (powers.length < minPowers && addNew());
  for (let guard = 0; guard < 100 && total() > target; guard++) {
    const withBoost = [...powers].reverse().find((p) => p.boosts.length);
    if (withBoost) { withBoost.boosts.pop(); continue; }
    const withLevel = [...powers].reverse().find((p) => p.level > 0);
    if (withLevel) { withLevel.level--; continue; }
    if (powers.length > Math.max(1, minPowers)) { powers.pop(); continue; }
    break;
  }
  for (let guard = 0; guard < 100 && total() < target; guard++) {
    if (addNew()) continue;
    const up = powers.find((p) => p.level < maxOf(p.name));
    if (!up) break;
    up.level++;
  }
  return powers;
}

async function stepPowers({ state, P, opts, rng, frozen, plan, internal }) {
  const ctx = ctxOf(state, opts);
  if (!plan) {
    const fixed = { ...fixedFromFrozen(state, frozen), d: state.drawbacks.length, e: state.extraTalents.length };
    plan = await makePlan(state, P, opts, rng, fixed, frozen("attrs") ? attrSum(state.attrs) : null);
    if (!plan) return null;
  }
  const cache = new Map();
  const nSrc = frozen("sources") || frozen("powers") ? Math.max(1, state.sources.length) : plan.x + 1;
  let powers = state.powers;
  if (!frozen("powers")) {
    const arch = await getArchetype(P, activeArchetype(state, opts));
    if (arch && arch.powers?.length) {
      powers = await adaptArchetypePowers(P, arch, plan.S, state.rank, nSrc, rng, ctx);
    } else {
      const wantLimit = rng.chance(opts.limitChance);
      powers = null;
      if (wantLimit) {
        const cand = await buildFree(P, ctx, state.rank, plan.S + 1, nSrc, rng, cache);
        if (cand.length && (await addOneLimit(P, cand, rng, cache))) powers = cand;
      }
      if (!powers) powers = await buildFree(P, ctx, state.rank, plan.S, nSrc, rng, cache);
    }
    powers = strip(powers);
  }
  let sources = state.sources;
  if (!frozen("sources")) {
    const keys = frozen("powers") ? [...new Set(state.powers.map((p) => p.sourceKey).filter(Boolean))] : [];
    const names = [];
    sources = [];
    for (let i = 0; i < nSrc; i++) {
      const e = await draw(P, "powerSources", rng, ctx, (z) => names.includes(normName(z.name)));
      if (!e) continue;
      names.push(normName(e.name));
      sources.push({ key: keys[i] ?? `s${sources.length + 1}`, ...ref(e) });
    }
  }
  if (!frozen("powers") && sources.length) powers = powers.map((p, i) => ({ ...p, sourceKey: sources[i % sources.length].key }));
  return { powers, sources };
}

// ---------- talents / drawbacks ----------
async function stepTalents({ state, P, opts, rng, frozen, plan }) {
  const ctx = ctxOf(state, opts);
  if (!plan) {
    const fixed = { ...fixedFromFrozen(state, frozen), S: slots(state), x: extraSources(state) };
    plan = await makePlan(state, P, opts, rng, fixed, frozen("attrs") ? attrSum(state.attrs) : null);
    if (!plan) return null;
  }
  const out = {};
  const used = usedTalents(state);
  const mine = { heroTalent: state.heroTalent, extraTalents: state.extraTalents };
  // locked pieces stay; rolled pieces avoid everything already present
  const unlockedHero = !frozen("heroTalent");
  const unlockedExtra = !frozen("extraTalents");
  if (unlockedHero) { used.delete(talentKey(state.heroTalent?.name)); mine.heroTalent = null; }
  if (unlockedExtra) for (const t of state.extraTalents) used.delete(talentKey(t.name));
  const ex = (e) => used.has(talentKey(e.name));
  if (unlockedHero) {
    let e = null;
    for (let i = 0; i < 4 && !e; i++) {                    // a bare Knowledgeable that cannot take a free subject is drawn past
      const c = await draw(P, "heroTalents", rng, ctx, ex);
      if (!c) break;
      e = await expandTalent(P, c, rng, used);
      if (e && ex(e)) e = null;
    }
    if (e) { mine.heroTalent = ref(e); used.add(talentKey(e.name)); }
    out.heroTalent = mine.heroTalent;
  }
  if (unlockedExtra) {
    const list = [];
    for (let i = 0; i < plan.e; i++) {
      let e = await draw(P, "talents", rng, {}, ex);
      if (e) e = await expandTalent(P, e, rng, used);
      if (!e || ex(e)) break;
      list.push(ref(e)); used.add(talentKey(e.name));
    }
    out.extraTalents = list;
  }
  if (!frozen("drawbacks")) {
    const list = [];
    const names = new Set();
    for (let i = 0; i < plan.d; i++) {
      const e = await draw(P, "drawbacks", rng, ctx, (z) => names.has(normName(z.name)));
      if (!e) break;
      names.add(normName(e.name));
      // B4: a drawback that asks for a choice. "source" -> one of the hero's own power sources (random can fill that from the hero), "defined" -> left for the player (a warning asks)
      const needs = e.needs === "source" || e.needs === "defined" ? e.needs : null;
      const srcNames = (state.sources ?? []).map((s) => s.name).filter(Boolean);
      const note = needs === "source" && srcNames.length ? srcNames[rng.int(srcNames.length)] : "";
      list.push({ ...ref(e), note, ...(needs ? { needs } : {}) });
    }
    out.drawbacks = list;
  }
  return out;
}

// ---------- attributes ----------
async function stepAttributes({ state, P, opts, rng, frozen }) {
  if (frozen("attrs")) return null;
  const cap = RANKS[state.rank].cap, B = budget(state);
  const arch = await getArchetype(P, activeArchetype(state, opts));
  if (arch?.attrs) {
    const r = reconcileAttributes(arch.attrs, B, cap);
    if (r.ok) return { attrs: r.attrs };
  }
  if (B < 6 || B > 6 * cap) return null;
  const floor = B >= 12 ? 2 : 1;
  const attrs = Object.fromEntries(ATTRS.map((k) => [k, floor]));
  let left = B - 6 * floor;
  const primary = new Set(rng.sample(ATTRS, 2));
  while (left > 0) {
    const open = ATTRS.filter((k) => attrs[k] < cap);
    if (!open.length) break;
    const k = rng.weighted(open, (a) => (primary.has(a) ? 3 : 1));
    attrs[k]++; left--;
  }
  return { attrs };
}

// ---------- concept / life / persona / team ----------
async function stepConcept({ state, P, opts, rng, frozen }) {
  let { archetype, role } = state;
  if (!frozen("archetype")) {
    archetype = null;
    if (opts.withinArchetype) {
      archetype = opts.archetype ?? (await draw(P, "archetypes", rng, {}))?.name ?? null;
    }
  }
  if (!frozen("role")) {
    const arch = await getArchetype(P, archetype);
    role = arch?.role ?? rng.pick(ROLES);
  }
  return { archetype, role };
}

async function stepLife({ state, P, opts, rng, frozen }) {
  const ctx = ctxOf(state, opts);
  const out = {};
  const used = usedTalents(state);
  if (!frozen("occTalent")) used.delete(talentKey(state.occTalent?.name));
  let occupation = state.occupation, occTalent = state.occTalent, resources = state.resources;
  if (!frozen("occupation") || !frozen("occTalent")) {
    const occs = frozen("occupation") ? (await listOf(P, "occupations", ctx)).filter((o) => o.name === state.occupation) : rng.shuffle(await listOf(P, "occupations", ctx));
    // first occupation whose talent shortlist has a talent not yet owned (cyclic "take the next one")
    for (const o of occs) {
      if (frozen("occTalent")) { occupation = o.name; resources = o.data?.resources ?? 1; break; }
      const free = (await listOf(P, "occupationTalents", { occupation: o.name })).filter((t) => !used.has(talentKey(t.name)));
      if (!free.length) continue;
      occupation = o.name; resources = o.data?.resources ?? 1;
      let pick = (await draw(P, "occupationTalents", rng, { occupation: o.name }, (t) => used.has(talentKey(t.name)))) ?? free[0];
      pick = (await expandTalent(P, pick, rng, used)) ?? free.find((t) => normName(t.name) !== "knowledgeable") ?? null;   // bare Knowledgeable -> a subject (book rule)
      if (!pick) continue;
      occTalent = ref(pick);
      break;
    }
    if (!frozen("occupation") || occs.length) { out.occupation = occupation; out.resources = resources; }
    if (!frozen("occTalent")) out.occTalent = occTalent;
  }
  if (!frozen("npcRel")) {
    const type = await draw(P, "npcRelations", rng, { occupation: out.occupation ?? state.occupation });
    const nm = await draw(P, "civilianNames", rng, { purpose: "npc" });
    out.npcRel = { type: type?.name ?? "", name: nm?.name ?? "" };
  }
  return out;
}

async function stepPersona({ state, P, opts, rng, frozen }) {
  const ctx = ctxOf(state, opts);
  const out = {};
  if (!frozen("personality")) {
    const names = [], seen = new Set();
    for (let i = 0; i < 2; i++) {
      const e = await draw(P, "personality", rng, ctx, (z) => seen.has(normName(z.name)));
      if (e) { names.push(e.name); seen.add(normName(e.name)); }
    }
    out.personality = names;
  }
  if (!frozen("drive")) { const e = await draw(P, "drives", rng, ctx); out.drive = e ? { name: e.name, text: e.text ?? "" } : null; }
  if (!frozen("flaw")) { const e = await draw(P, "flaws", rng, ctx); out.flaw = e ? { name: e.name, text: e.text ?? "" } : null; }
  if (!frozen("heroName")) out.heroName = (await draw(P, "heroNames", rng, ctx))?.name ?? "";
  if (!frozen("civilianName")) out.civilianName = (await draw(P, "civilianNames", rng, { purpose: "hero" }))?.name ?? "";
  return out;
}

/* Team (phase 6): name, kind of base (team-base.<rank>), LOCATION (City Locations, a D66 on the book table when the provider rolls it), starting upgrades,
   optionally JOIN an existing base card (opts.joinBase, default off) and the second key relationship (opts.heroRel).
   Draw order is fixed (upgrades, name, kind, location, join pick) so adding a draw never moves the earlier ones.
   Tie to a base: a MEMBER hero keeps the card's texts (nothing is rolled for the team part); "join" is only produced when opts.joinBase is on and a base
   is visible, otherwise a previous "join" falls back to "text" (the rolled texts need a text / create frame); "create" is kept as chosen. */
async function stepTeam({ state, P, opts, rng, frozen }) {
  const out = {};
  const prev = state.team ?? {};
  if (!frozen("team") && prev.mode !== "member") {
    const n = RANKS[state.rank].upgrades;
    const ups = rng.sample((await listOf(P, "baseUpgrades", {})).map((e) => e.name), n);
    const name = (await draw(P, "teamNames", rng, {}))?.name ?? "";
    const base = (await draw(P, "teamBases", rng, { rank: state.rank }))?.name ?? "";
    const where = (await draw(P, "cityLocations", rng, {}))?.name ?? "";
    let join = null;
    if (opts.joinBase) {
      const bases = await listOf(P, "existingBases", {});
      if (bases.length) join = rng.pick(bases);
    }
    const mode = join ? "join" : prev.mode === "join" ? "text" : (prev.mode ?? "text");
    out.team = join
      ? { ...prev, mode: "join", baseId: join.data?.baseId ?? join.packUuid ?? null, name: "", base: "", where: "", upgrades: [] }
      : { ...prev, mode, baseId: mode === "join" ? prev.baseId ?? null : null, name, base, where, upgrades: ups };
  }
  if (!frozen("heroRel")) {
    const e = opts.heroRel === false ? null : await draw(P, "heroRelations", rng, {});
    out.heroRel = e ? { name: e.name, actorUuid: e.packUuid ?? e.data?.actorUuid ?? null } : { name: "", actorUuid: null };
  }
  return out;
}

const STEPS = { concept: stepConcept, powers: stepPowers, talents: stepTalents, attributes: stepAttributes, life: stepLife, persona: stepPersona, team: stepTeam };

// ---------- public ----------
function rebalance(state) {
  const r = reconcileAttributes(state.attrs, budget(state), RANKS[state.rank].cap);
  return r.ok ? { ...state, attrs: r.attrs } : state;
}

export async function rollStep(state, stepId, provider, opts = {}, internal = {}) {
  const fn = STEPS[stepId];
  if (!fn) throw new Error(`chargen: step "${stepId}" cannot be rolled`);
  opts = { ...DEFAULTS, ...opts };
  const frozen = internal.frozen ?? ((f) => !!state.locks[f]);
  if (STEP_FIELDS[stepId].every(frozen)) return state;
  const n = state.rerolls[stepId] ?? 0;
  const rng = substream(state.seed, `${stepId}:${n}`);
  const out = await fn({ state, P: provider, opts, rng, frozen, plan: internal.plan });
  if (!out) return state;
  let next = { ...state, ...out, rerolls: { ...state.rerolls, [stepId]: n + 1 } };
  if ((stepId === "powers" || stepId === "talents") && !internal.skipReconcile && !frozen("attrs")) next = rebalance(next);
  return next;
}

export async function rollAll(state, provider, opts = {}) {
  opts = { ...DEFAULTS, ...opts };
  const frozen = (f) => !!state.locks[f] || (opts.honorTouched && !!state.touched[FIELD_STEP[f]]);
  let s = await rollStep(state, "concept", provider, opts, { frozen, skipReconcile: true });
  const planRng = substream(s.seed, `plan:${s.rerolls.plan ?? 0}`);
  const target = frozen("attrs") ? attrSum(s.attrs) : null;
  const plan = await makePlan(s, provider, opts, planRng, fixedFromFrozen(s, frozen), target);
  s = { ...s, rerolls: { ...s.rerolls, plan: (s.rerolls.plan ?? 0) + 1 } };
  const internal = { frozen, skipReconcile: true, plan: plan ?? undefined };
  for (const step of ["powers", "talents", "attributes", "life", "persona", "team"]) {
    // with an impossible plan the plan-driven steps keep their value (validation will say why)
    if (!plan && (step === "powers" || step === "talents")) continue;
    s = await rollStep(s, step, provider, opts, internal);
  }
  return { state: s, ...validate(s) };
}

/** Fresh hero from a seed (random mode entry point). */
export async function rollHero(seed, rank, provider, opts = {}) {
  return rollAll(createState({ seed, rank, mode: "random" }), provider, opts);
}
