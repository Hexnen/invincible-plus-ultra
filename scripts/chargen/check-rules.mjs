// node scripts/chargen/check-rules.mjs  -- unit + fuzz tests for rng/rules/state/random (no Foundry needed).
// Fixtures are synthetic names only; real data comes at runtime from the providers of phases 3b/6.
import { createRng, substream } from "./rng.mjs";
import * as R from "./rules.mjs";
import * as S from "./state.mjs";
import { rollHero, rollAll, rollStep } from "./random.mjs";

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.error("FAIL:", msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);

// ---------- fixture provider ----------
const N = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);
const E = (names, extra = {}) => names.map((name) => ({ name, packUuid: `fx.${name}`, ...extra }));
const POWERS = N("Pow", 24).map((name, i) => ({ name, packUuid: `fx.${name}`, type: `T${i % 6}`, maxLevel: i % 5 === 4 ? 0 : 3 }));
const TALENTS = N("Tal", 30);
const OCCS = N("Occ", 10).map((name, i) => ({ name, data: { resources: 2 + (i % 5) } }));
// oracle: archetype -> attrs FIG AGI STR REA INT PRE ; powers as [level, boostCount]
const ORACLE = {
  beacon: [[6, 5, 6, 4, 4, 9], [[0, 0], [0, 0], [0, 0]]],
  bruiser: [[8, 4, 10, 2, 4, 4], [[1, 0], [1, 0]]],
  gadgeteer: [[4, 5, 3, 8, 4, 4], Array(6).fill([0, 0])],
  icon: [[8, 5, 8, 3, 3, 5], [[0, 0], [1, 0], [0, 0]]],
  mastermind: [[3, 3, 3, 9, 5, 7], Array(5).fill([0, 0])],
  metamorph: [[6, 5, 5, 4, 6, 4], [[0, 2], [0, 0], [0, 0]]],
  monster: [[8, 5, 9, 2, 5, 3], Array(4).fill([0, 0])],
  nova: [[6, 9, 3, 3, 3, 4], [[0, 0], [0, 0], [0, 0], [1, 1]]],
  powersuit: [[5, 6, 6, 4, 5, 4], [[0, 0], [0, 0], [0, 0], [1, 0]]],
  psychic: [[3, 4, 2, 4, 8, 9], Array(5).fill([0, 0])],
  shaper: [[4, 7, 3, 4, 5, 7], Array(5).fill([0, 0])],
  sharpshooter: [[7, 9, 4, 3, 6, 3], [[0, 1], [0, 0], [0, 0]]],
  speedster: [[6, 10, 3, 4, 3, 4], [[0, 0], [0, 1], [0, 1]]],
  vigilante: [[8, 6, 5, 4, 5, 4], Array(4).fill([0, 0])],
  warrior: [[10, 5, 6, 3, 4, 4], Array(4).fill([0, 0])],
  wisecracker: [[7, 6, 4, 4, 4, 7], Array(4).fill([0, 0])]
};
const archAttrs = (id) => Object.fromEntries(R.ATTRS.map((k, i) => [k, ORACLE[id][0][i]]));
const ARCHS = Object.keys(ORACLE);
const archIndex = (id) => ARCHS.indexOf(id);
const slice = (arr, id, n) => { const o = archIndex(id) * 3; return Array.from({ length: n }, (_, i) => arr[(o + i) % arr.length]); };

function fixtureProvider({ withRoll = false } = {}) {
  const arch = (id) => ({
    id, role: R.ROLES[archIndex(id) % 8], attrs: archAttrs(id),
    powers: ORACLE[id][1].map(([level, nb], i) => ({ name: `Apw${archIndex(id)}_${i}`, level, boosts: Array.from({ length: nb }, (_, j) => ({ name: `Abst${j}` })) }))
  });
  const P = {
    calls: 0,
    getArchetype: async (id) => (ORACLE[id] ? arch(id) : null),
    list: async (key, ctx = {}) => {
      P.calls++;
      const a = ctx.archetype;
      switch (key) {
        case "archetypes": return ARCHS.map((name) => ({ name }));
        case "powers": return POWERS;
        case "boosts": return ctx.power ? E([`${ctx.power}-B1`, `${ctx.power}-B2`]) : [];
        case "limits": return ctx.power ? E([`${ctx.power}-L1`]) : [];
        case "powerSources": return E(a ? slice(N("Src", 36), a, 3) : N("Src", 36));
        case "heroTalents": return E(a ? slice(TALENTS, a, 6) : TALENTS);
        case "talents": return E(TALENTS);
        case "drawbacks": return E(a ? slice(N("Dwb", 15), a, 6) : N("Dwb", 15));
        case "knowledgeableSubjects": return E(N("Know", 6));
        case "occupations": return OCCS;
        case "occupationTalents": { const i = OCCS.findIndex((o) => o.name === ctx.occupation); return E([0, 1, 2].map((j) => TALENTS[(i * 2 + j) % TALENTS.length])); }
        case "npcRelations": return E(N("Rel", 3));
        case "personality": return E(a ? slice(N("Per", 20), a, 6) : N("Per", 20));
        case "drives": return E(a ? slice(N("Drv", 12), a, 3) : N("Drv", 12)).map((e) => ({ ...e, text: "" }));
        case "flaws": return E(a ? slice(N("Flw", 12), a, 3) : N("Flw", 12)).map((e) => ({ ...e, text: "" }));
        case "heroNames": return E(a ? slice(N("Hero", 20), a, 3) : N("Hero", 20));
        case "civilianNames": return E(N("Civ", 15));
        case "teamNames": return E(N("Team", 10));
        case "teamBases": return E(N("Base", 5));
        case "baseUpgrades": return E(N("Upg", 6));
        case "heroRelations": return [];
        default: return [];
      }
    }
  };
  if (withRoll) P.roll = async (key, rng, ctx) => rng.pick(await P.list(key, ctx));
  return P;
}
const P = fixtureProvider();

// ---------- rng ----------
{
  const a = createRng("x"), b = createRng("x"), c = createRng("y");
  const sa = Array.from({ length: 20 }, () => a.float()), sb = Array.from({ length: 20 }, () => b.float()), sc = Array.from({ length: 20 }, () => c.float());
  eq(sa, sb, "same seed same stream"); ok(JSON.stringify(sa) !== JSON.stringify(sc), "different seed differs");
  const r = createRng("dice"), cnt = { d3: new Set(), d6: new Set(), d66: new Set() };
  let tot2 = new Set();
  for (let i = 0; i < 4000; i++) { cnt.d3.add(r.d3()); cnt.d6.add(r.d6()); cnt.d66.add(r.d66()); tot2.add(r.twoD6().total); }
  eq([...cnt.d3].sort(), [1, 2, 3], "d3 range"); eq([...cnt.d6].sort(), [1, 2, 3, 4, 5, 6], "d6 range");
  ok([...cnt.d66].every((v) => v >= 11 && v <= 66 && v % 10 >= 1 && v % 10 <= 6) && cnt.d66.size === 36, "d66 digits 1-6 and all 36 hit");
  ok(Math.min(...tot2) === 2 && Math.max(...tot2) === 12, "2d6 2..12");
  const nd = r.ndx(5, 8); ok(nd.dice.length === 5 && nd.total === nd.dice.reduce((x, y) => x + y) && nd.dice.every((d) => d >= 1 && d <= 8), "ndx");
  eq(substream("s", "a").float(), substream("s", "a").float(), "substream deterministic");
  ok(substream("s", "a").float() !== substream("s", "b").float(), "substreams independent");
  eq(createRng("q").shuffle([1, 2, 3, 4, 5]).sort(), [1, 2, 3, 4, 5], "shuffle permutation");
}

// ---------- rank table ----------
{
  eq(R.RANK_ORDER.map((k) => [R.RANKS[k].points, R.RANKS[k].cap, R.RANKS[k].powers, R.RANKS[k].reputation]), [[20, 6, 2, 0], [26, 8, 3, 1], [32, 10, 4, 2], [38, 12, 5, 3]], "rank table");
  eq(R.RANK_ORDER.map((k) => R.RANKS[k].upgrades), [0, 1, 2, 3], "base upgrades by rank");
  eq(R.levelCap("global"), 1, "no Massive below cosmic"); eq(R.levelCap("cosmic"), 2, "Massive for cosmic");
}

// ---------- archetype oracle: budget formula ----------
function archState(id, rank = "global") {
  let s = S.createState({ seed: "o", rank });
  const sa = { key: "s1", name: "Src", packUuid: null };
  s = S.patch(s, { sources: [sa] });
  ORACLE[id][1].forEach(([level, nb], i) => {
    s = S.addPower(s, { name: `Pw${i}`, level });
    for (let j = 0; j < nb; j++) s = S.addBoost(s, `p${i + 1}`, { name: `B${j}` });
  });
  return S.patch(s, { attrs: archAttrs(id) });
}
for (const id of ARCHS) {
  const s = archState(id);
  const sum = R.attrSum(s.attrs), sl = R.slots(s);
  eq(sum, 32 + 2 * (4 - sl), `${id}: attribute sum == 32 + 2*(4-slots)`);
  eq(R.budget(s), sum, `${id}: budget == attribute sum`);
  eq(R.validate(s).issues.filter((i) => i.step === "attributes").length, 0, `${id}: attribute step clean`);
  // rank adaptation (7.3): reconcile to the budget of every rank keeps caps and exact sum
  for (const rank of R.RANK_ORDER) {
    const cfg = R.RANKS[rank], nr = sl + (cfg.powers - 4), target = cfg.points + 2 * (4 - sl);
    eq(R.budgetFor(rank, { S: nr }), target, `${id}/${rank}: adapted budget`);
    const rr = R.reconcileAttributes(archAttrs(id), target, cfg.cap);
    ok(rr.ok && R.attrSum(rr.attrs) === target && R.ATTRS.every((k) => rr.attrs[k] >= 1 && rr.attrs[k] <= cfg.cap), `${id}/${rank}: reconcile exact within cap`);
  }
}
{
  // worked example from the spec: Beacon as Teen Upstart
  const rr = R.reconcileAttributes(archAttrs("beacon"), 22, 6);
  ok(rr.ok && R.attrSum(rr.attrs) === 22 && Object.values(rr.attrs).every((v) => v >= 1 && v <= 6), "beacon/teen sums 22");
  ok(rr.attrs.presence >= Math.max(...Object.values(rr.attrs)) - 0 && rr.attrs.reason <= rr.attrs.fighting, "beacon/teen keeps ordering");
  ok(!R.reconcileAttributes(archAttrs("beacon"), 5, 6).ok && !R.reconcileAttributes(archAttrs("beacon"), 37, 6).ok, "reconcile refuses impossible targets");
}

// ---------- budget components ----------
{
  let s = archState("beacon"); // 3 slots, 34
  const base = R.budget(s);
  s = S.patch(s, { sources: [...s.sources, { key: "s2", name: "X" }] }); eq(R.budget(s), base - 1, "extra source -1");
  s = S.addExtraTalent(s, { name: "T" }); eq(R.budget(s), base - 2, "extra talent -1");
  s = S.addDrawback(s, { name: "D1" }); s = S.addDrawback(s, { name: "D2" }); eq(R.budget(s), base, "drawbacks +1 each");
  s = S.addBoost(s, "p1", { name: "Bx" }); eq(R.slots(s), 4, "boost uses a slot"); eq(R.budget(s), base - 2, "slot costs 2 points");
  s = S.addLimit(s, "p1", { name: "L", grants: "boost" }); eq(R.slots(s), 3, "limit paying for a boost is free");
  s = S.setPowerLevel(s, "p2", 1); s = S.addLimit(s, "p2", { name: "L2", grants: "level" }); eq(R.slots(s), 3, "limit paying for a level is free");
  const bad = S.addLimit(archState("beacon"), "p1", { name: "L", grants: "level" });
  ok(R.validate(bad).errors.some((e) => e.code === "limit.grant.invalid"), "limit paying a level that does not exist is an error");
  eq(R.slots(bad), 3, "invalid limit grants nothing");
  const few = S.patch(archState("beacon"), { powers: archState("beacon").powers.slice(0, 1) }); eq(R.slots(few), 1, "one slot ok");
  eq(R.budget(few), 38, "freed slots +2 each");
  const eco = R.derive(S.patch(archState("beacon"), {}), { health: 2 });
  eq(eco.health, Math.ceil((6 + 5 + 6) / 2) + 2, "health = ceil(F+A+S / 2) + bonus"); eq(eco.resolve, Math.ceil((4 + 4 + 9) / 2), "resolve"); eq(eco.slugfest, 3, "slugfest");
  ok(R.derive(S.addDrawback(archState("beacon"), { name: "Hard Times" })).flags.hardTimes, "Hard Times discrepancy flag");
}

// ---------- validation edge cases ----------
function fullHero(rank = "global") {
  let s = archState("warrior", rank);
  s = S.patch(s, { attrs: archAttrs("warrior"), heroTalent: { name: "H" }, occupation: "O", occTalent: { name: "OT" }, resources: 3, npcRel: { type: "t", name: "n" }, personality: ["a", "b"], drive: { name: "d" }, flaw: { name: "f" }, heroName: "H", civilianName: "C", team: { name: "T", base: "B", upgrades: [] } });
  return s;
}
const codes = (s) => R.validate(s).issues.map((i) => i.code);
const has = (s, c, sev) => R.validate(s).issues.some((i) => i.code === c && (!sev || i.severity === sev));
{
  const h = fullHero(); ok(R.validate(h).ok && R.canApply(h), "baseline hero is valid"); eq(R.validate(h).errors.length, 0, "no errors");
  ok(has(S.setAttr(h, "fighting", 9), "attr.unspent", "error"), "unspent points block apply");
  ok(has(S.setAttr(h, "fighting", 11), "attr.over", "error") && has(S.setAttr(h, "fighting", 11), "attr.cap", "error"), "overspend + cap errors");
  ok(has(S.setAttr(S.setAttr(h, "fighting", 11), "agility", 4), "attr.cap"), "cap per attribute by rank");
  const teen = fullHero("teen"); ok(has(teen, "attr.cap", "error"), "warrior attrs break the teen cap (10 > 6)");
  ok(has(S.setAttr(h, "agility", 0), "attr.low"), "attribute below 1");
  ok(has(S.setAttr(h, "agility", 2.5), "attr.invalid"), "non-integer attribute");
  let d = S.addDrawback(S.addDrawback(h, { name: "D1" }), { name: "D2" });
  ok(!has(d, "drawbacks.max"), "two drawbacks allowed"); d = S.addDrawback(d, { name: "D3" }); ok(has(d, "drawbacks.max", "error"), "three drawbacks forbidden");
  ok(has(S.setPowerLevel(h, "p1", 2), "power.level.massive", "error"), "Massive not below cosmic");
  ok(!has(S.setPowerLevel(fullHero("cosmic"), "p1", 2), "power.level.massive"), "Massive ok for cosmic");
  ok(has(S.setPowerLevel(fullHero("cosmic"), "p1", 3), "power.level.monstrous", "error"), "Monstrous never at start");
  ok(has(S.setPowerLevel(h, "p1", 7), "power.level.invalid"), "invalid level");
  ok(has(S.patch(h, { powers: [] }), "powers.none"), "at least one power");
  ok(has(S.patch(h, { sources: [] }), "sources.none"), "source required");
  ok(has(S.setPowerSource(h, "p1", "zz"), "power.source.missing"), "dangling source key");
  ok(has(S.addPower(h, { name: "Pw0" }), "power.duplicate"), "same power twice");
  ok(has(S.addPower(h, { name: "Extra" }), "slots.over", "warn"), "over the rank power count is a warning");
  ok(has(S.patch(h, { heroTalent: null }), "talent.hero.missing"), "hero talent required");
  ok(has(S.patch(h, { occTalent: { name: "H" } }), "talent.duplicate"), "hero talent == occupation talent");
  ok(!has(S.patch(h, { heroTalent: { name: "Windfall" }, extraTalents: [{ name: "windfall" }] }), "talent.duplicate"), "Windfall may repeat");
  ok(!has(S.addDrawback(S.addDrawback(h, { name: "Hard Times" }), { name: "hard times" }), "drawback.duplicate"), "Hard Times may repeat");
  ok(has(S.addDrawback(h, { name: "Hard Times" }), "drawback.hardTimes", "info"), "Hard Times info issue");
  ok(has(S.patch(h, { occupation: null }), "occupation.missing"), "occupation required");
  ok(has(S.patch(h, { personality: ["a", "A"] }), "personality.count"), "two DISTINCT words");
  ok(has(S.patch(h, { heroName: " " }), "heroName.empty", "error") && has(S.patch(h, { civilianName: "" }), "civilianName.empty", "warn"), "names");
  ok(has(S.patch(h, { team: { name: "", base: "", upgrades: ["a", "b", "c"] } }), "upgrades.over", "warn"), "base upgrades vs rank");
  ok(has(S.patch(h, { rank: "bogus" }), "rank.unknown"), "unknown rank");
  ok(R.validateStep(S.setAttr(h, "fighting", 9), "attributes").errors.length === 1 && R.validateStep(h, "powers").ok, "validateStep filters by step");
  ok(R.validate(h).issues.every((i) => i.key === `IPC.Rule.${i.code}` && i.step && i.path), "issues carry key/step/path");
  ok(R.validate(S.patch(h, { civilianName: "" })).ok, "warnings never block");
}

// ---------- state helpers ----------
{
  const s0 = S.createState({ seed: "a" });
  const frozen = JSON.stringify(s0), s1 = S.setAttr(s0, "agility", 5);
  eq(JSON.stringify(s0), frozen, "helpers do not mutate"); ok(s1 !== s0 && s1.attrs.agility === 5 && s0.attrs.agility === 2, "immutable set");
  const s2 = S.deserialize(S.serialize(S.toggleLock(S.markTouched(archState("icon"), "powers"), "powers")));
  ok(s2.locks.powers && s2.touched.powers && s2.powers.length === 3, "serialise round trip");
  let threw = false; try { S.deserialize('{"v":99}'); } catch { threw = true; } ok(threw, "wrong version rejected");
  let h = S.createHistory(s0); h = S.pushHistory(h, s1); h = S.undo(h); ok(h.present === s0, "undo"); h = S.redo(h); ok(h.present === s1, "redo");
  const big = Array.from({ length: 80 }, (_, i) => S.setAttr(s0, "agility", (i % 6) + 1)); let hh = S.createHistory(s0); for (const b of big) hh = S.pushHistory(hh, { ...b }); ok(hh.past.length === 50, "history cap 50");
  const removed = S.removeSource(S.patch(archState("icon"), { sources: [{ key: "s1", name: "A" }, { key: "s2", name: "B" }] }), "s1");
  ok(removed.powers.every((p) => p.sourceKey === "s2"), "removeSource re-homes powers");
}

// ---------- fuzz ----------
const FUZZ = Number(process.env.FUZZ ?? 5000);
const t0 = Date.now();
const heroOpts = (i) => ({ withinArchetype: i % 3 === 0, drawbacks: i % 7 !== 1, extraTalents: i % 5 !== 2, extraSource: i % 4 !== 3, slotVariance: i % 6 !== 5 });
let seen = { drawbacks: 0, extraTalents: 0, extraSource: 0, limits: 0, boosts: 0, levels: 0, massive: 0, arch: 0 };
for (const rank of R.RANK_ORDER) {
  let bad = 0;
  for (let i = 0; i < FUZZ; i++) {
    const seed = `${rank}-${i}`;
    const r = await rollHero(seed, rank, P, heroOpts(i));
    const s = r.state, cfg = R.RANKS[rank];
    if (!r.ok) { bad++; if (bad <= 3) console.error("invalid", seed, JSON.stringify(r.errors.map((e) => e.code))); continue; }
    const b = R.budget(s);
    if (R.attrSum(s.attrs) !== b || !R.ATTRS.every((k) => s.attrs[k] >= 1 && s.attrs[k] <= cfg.cap)) { bad++; console.error("points/caps", seed); continue; }
    if (s.drawbacks.length > 2 || s.powers.some((p) => p.level > R.levelCap(rank))) { bad++; console.error("rule", seed); continue; }
    seen.drawbacks += s.drawbacks.length > 0; seen.extraTalents += s.extraTalents.length > 0; seen.extraSource += s.sources.length > 1;
    seen.limits += s.powers.some((p) => p.limits.length > 0); seen.boosts += s.powers.some((p) => p.boosts.length > 0); seen.levels += s.powers.some((p) => p.level > 0);
    seen.massive += s.powers.some((p) => p.level === 2); seen.arch += !!s.archetype;
    if (i < 300) {
      const again = await rollHero(seed, rank, P, heroOpts(i));
      if (JSON.stringify(again.state) !== JSON.stringify(s)) { bad++; console.error("not deterministic", seed); }
    }
  }
  ok(bad === 0, `fuzz ${rank}: ${FUZZ} heroes valid, all points spent, caps ok (${bad} bad)`);
}
ok(seen.drawbacks > 0 && seen.extraTalents > 0 && seen.extraSource > 0 && seen.limits > 0 && seen.boosts > 0 && seen.levels > 0 && seen.massive > 0 && seen.arch > 0, `fuzz covers all features ${JSON.stringify(seen)}`);
{
  const a = await rollHero("seed-A", "global", P), b = await rollHero("seed-B", "global", P);
  ok(JSON.stringify(a.state) !== JSON.stringify(b.state), "different seeds give different heroes");
  const withRoll = await rollHero("seed-A", "global", fixtureProvider({ withRoll: true }));
  ok(withRoll.ok, "provider.roll path produces valid heroes");
}

// ---------- reroll isolation ----------
const fieldsOf = (s, step) => JSON.stringify(S.STEP_FIELDS[step].map((f) => s[f]));
let isoBad = 0;
for (const rank of R.RANK_ORDER) for (let i = 0; i < 120; i++) {
  const o = heroOpts(i), base = (await rollHero(`iso-${rank}-${i}`, rank, P, o)).state;
  for (const step of ["concept", "powers", "talents", "attributes", "life", "persona", "team"]) {
    const next = await rollStep(base, step, P, o);
    for (const other of Object.keys(S.STEP_FIELDS)) {
      if (other === step || other === "rank") continue;
      if (other === "attributes" && (step === "powers" || step === "talents")) continue; // documented: budget re-balance
      if (fieldsOf(next, other) !== fieldsOf(base, other)) { isoBad++; if (isoBad < 4) console.error("isolation", rank, i, step, "changed", other); }
    }
    if (next.rank !== base.rank || next.seed !== base.seed) isoBad++;
    if ((step === "powers" || step === "talents" || step === "attributes") && !R.canApply(next) && R.canApply(base)) { isoBad++; if (isoBad < 4) console.error("reroll broke validity", rank, i, step, JSON.stringify(R.validate(next).errors.map((e) => e.code))); }
    if (step !== "powers" && step !== "talents" && step !== "concept" && JSON.stringify(next) === JSON.stringify(base) && step !== "team") isoBad++;
    const twice = await rollStep(base, step, P, o); if (JSON.stringify(twice) !== JSON.stringify(next)) isoBad++; // deterministic
  }
}
ok(isoBad === 0, `reroll of one step leaves the other steps unchanged (${isoBad} problems)`);
{
  // a second reroll differs from the first (counter advances)
  const base = (await rollHero("cnt", "global", P)).state, a = await rollStep(base, "persona", P), b = await rollStep(a, "persona", P);
  ok(JSON.stringify(a.personality) !== JSON.stringify(b.personality) || a.heroName !== b.heroName, "successive rerolls differ");
  eq(b.rerolls.persona, 3, "reroll counter (roll + 2 rerolls)");
}

// ---------- locks ----------
let lockBad = 0;
for (const rank of R.RANK_ORDER) for (let i = 0; i < 150; i++) {
  const o = heroOpts(i), base = (await rollHero(`lk-${rank}-${i}`, rank, P, o)).state;
  const lockSets = [["heroTalent", "drawbacks"], ["powers", "sources"], ["attrs"], ["occupation", "occTalent", "resources"], ["personality", "heroName"], ["powers", "attrs"], ["drawbacks", "extraTalents", "attrs"], ["archetype", "role"]];
  const fields = lockSets[i % lockSets.length];
  let s = S.patch(base, { seed: `lk2-${i}`, rerolls: {} });
  for (const f of fields) s = S.toggleLock(s, f);
  const r = await rollAll(s, P, o);
  for (const f of fields) if (JSON.stringify(r.state[f]) !== JSON.stringify(base[f])) { lockBad++; if (lockBad < 4) console.error("lock violated", rank, i, f); }
  if (!r.ok) { lockBad++; if (lockBad < 4) console.error("locked roll invalid", rank, i, fields.join(), JSON.stringify(r.errors.map((e) => e.code))); }
  // touched steps are kept by rollAll
  const t = S.markTouched(S.patch(base, { seed: `tc-${i}`, rerolls: {} }), "persona");
  const rt = await rollAll(t, P, o); if (fieldsOf(rt.state, "persona") !== fieldsOf(base, "persona")) lockBad++;
  // an explicit step reroll also respects locks
  const lp = await rollStep(S.toggleLock(base, "heroName"), "persona", P, o); if (lp.heroName !== base.heroName) lockBad++;
}
ok(lockBad === 0, `locks respected, locked rolls stay valid (${lockBad} problems)`);
{
  // locked attribute sum with no feasible plan: reported, not thrown
  let s = S.toggleLock(S.setAttr(S.createState({ seed: "imp", rank: "global" }), "fighting", 3), "attrs"); // sum 13
  const r = await rollAll(s, P);
  ok(!r.ok && r.errors.some((e) => e.step === "attributes"), "impossible locked sum is reported as an attribute error");
}

console.log(`${checks} checks, ${fails} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(fails ? "FAILED" : "OK");
process.exit(fails ? 1 : 0);
