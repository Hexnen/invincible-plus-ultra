// node scripts/chargen/check-rules.mjs  -- unit + fuzz tests for rng/rules/state/random (no Foundry needed).
// Fixtures are synthetic names only; real data comes at runtime from the providers of phases 3b/6.
import { createRng, substream } from "./rng.mjs";
import * as R from "./rules.mjs";
import * as S from "./state.mjs";
import { rollHero, rollAll, rollStep } from "./random.mjs";
import * as RR from "./reroll.mjs";

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

function fixtureProvider({ withRoll = false, bases = false } = {}) {
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
        case "cityLocations": return E(N("City", 12));
        case "existingBases": return bases ? N("Bse", 3).map((name) => ({ name, data: { baseId: `id.${name}` } })) : [];
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

{
  // phase 5f: team.mode (text | join | create | member), baseId, where; old drafts without them
  const base = S.createState({ seed: "t5f", rank: "global" });
  eq(base.team, { name: "", base: "", where: "", upgrades: [], mode: "text", baseId: null }, "new state team shape (5f)");
  const old = S.deserialize(JSON.stringify({ ...base, team: { name: "Old", base: "Roof", upgrades: ["a"] } }));
  eq([old.team.mode, old.team.baseId, old.team.where, old.team.name], ["text", null, "", "Old"], "an older draft without the 5f team keys is filled with defaults");
  const codes = (st) => R.validateStep(st, "team").issues.map((i) => i.code);
  ok(codes(base).includes("team.empty"), "text mode, nothing written: team.empty (warn)");
  ok(codes(S.patch(base, { team: { ...base.team, mode: "join" } })).includes("team.join.missing"), "join without a base: error team.join.missing");
  const j = R.validateStep(S.patch(base, { team: { ...base.team, mode: "join" } }), "team");
  ok(j.issues.find((i) => i.code === "team.join.missing")?.severity === "error", "team.join.missing is an error");
  ok(!codes(S.patch(base, { team: { ...base.team, mode: "join", baseId: "abc" } })).length, "join with a base: no team issue");
  ok(codes(S.patch(base, { team: { ...base.team, mode: "create", base: "Roof" } })).includes("team.empty"), "create needs a team name");
  ok(!codes(S.patch(base, { team: { ...base.team, mode: "create", name: "Crew" } })).includes("team.empty"), "create with a name is fine");
  ok(!codes(S.patch(base, { team: { ...base.team, mode: "member", upgrades: ["a", "b", "c", "d"] } })).length, "a member hero: the card owns the texts and the upgrades (no empty / over warnings)");
  ok(codes(S.patch(base, { team: { ...base.team, mode: "create", name: "Crew", upgrades: ["a", "b", "c"] } })).includes("upgrades.over"), "create with too many starting upgrades warns");
  // random keeps how the hero is tied to a base
  const r = await rollStep(S.patch(base, { team: { ...base.team, mode: "create", baseId: null } }), "team", P, { withinArchetype: false });
  ok(r.team.mode === "create" && /^City/.test(r.team.where), "rolling the team step keeps the mode and (phase 6) rolls the location");
}

// =====================================================================================================================
// PHASE 6: random mode end to end. A REAL-SHAPED provider (names are synthetic, shapes copy what catalog.mjs / tables.mjs return:
// typed powers with maxLevel, a D66 power-source table with UNEVEN ranges rolled by a seeded roll(), bare "Knowledgeable" in the hero /
// occupation / general talent lists + the six subject variants, occupations with data.resources, drive / flaw sentences, a City
// Locations D66 table, existing base cards) and the board logic of reroll.mjs.
// =====================================================================================================================
const KNOW = ["Knowledgeable (Natural Sciences)", "Knowledgeable (Social Sciences)", "Knowledgeable (Humanities)", "Knowledgeable (Technology)", "Knowledgeable (Current Events)", "Knowledgeable (Esoteric Lore)"];
const TYPES6 = ["Attack", "Control", "Defense", "Modification", "Movement", "Sensory"];
const RPOWERS = Array.from({ length: 69 }, (_, i) => ({ name: `RPow${i + 1}`, packUuid: `Compendium.invincible-core.powers.Item.p${i}`, type: TYPES6[i % 6], maxLevel: 3 }));
// 36 rows over the numbers 11..66 (D66 shape): 20 rows two wide, 16 rows one wide -> uneven odds, some numbers (17-20, 27-30 ...) cannot be rolled
const d66Rows = (names) => { let lo = 11; return names.map((name, i) => { const w = i < 20 ? 2 : 1; const r = { name, lo, hi: lo + w - 1 }; lo += w; return r; }); };
const RSOURCES = d66Rows(Array.from({ length: 36 }, (_, i) => `RSrc${i + 1}`));
const RCITY = d66Rows(Array.from({ length: 36 }, (_, i) => `RCity${i + 1}`));
const d66Roll = (rows, rng) => { const v = rng.d66(); return rows.find((r) => v >= r.lo && v <= r.hi) ?? null; };
const ROCCS = Array.from({ length: 22 }, (_, i) => ({ name: `ROcc${i + 1}`, data: { resources: 2 + (i % 5) } }));
function realProvider({ bases = false, heroes = 2 } = {}) {
  const base = fixtureProvider({ bases });
  const withUuid = (names) => names.map((name) => ({ name, packUuid: `Compendium.invincible-core.talents.Item.${name.replace(/\W+/g, "")}` }));
  const P = {
    ...base,
    list: async (key, ctx = {}) => {
      const a = ctx.archetype;
      switch (key) {
        case "powers": return RPOWERS;
        case "powerSources": return a ? base.list(key, ctx) : RSOURCES.map((r) => ({ name: r.name, packUuid: `Compendium.invincible-core.power-sources.Item.${r.name}` }));
        case "heroTalents": { const l = await base.list(key, ctx); return a && archIndex(a) % 2 === 0 ? [{ name: "Knowledgeable", packUuid: "u.Know" }, ...l.slice(1)] : l; }
        case "talents": return withUuid([...TALENTS, "Knowledgeable", ...KNOW]);
        case "knowledgeableSubjects": return withUuid(KNOW);
        case "occupations": return ROCCS;
        case "occupationTalents": {
          const i = ROCCS.findIndex((o) => o.name === ctx.occupation), l = await base.list(key, { ...ctx, occupation: `Occ${String((i % 10) + 1).padStart(2, "0")}` });
          return i % 2 === 0 ? [{ name: "Knowledgeable" }, ...l.slice(1)] : l;
        }
        case "drives": case "flaws": return (await base.list(key, ctx)).map((e) => ({ ...e, text: `${e.name} sentence.` }));
        case "cityLocations": return RCITY.map((r) => ({ name: r.name, data: { range: [r.lo, r.hi] } }));
        case "heroRelations": return Array.from({ length: heroes }, (_, i) => ({ name: `Ally${i}`, packUuid: `Actor.ally${i}`, data: { actorUuid: `Actor.ally${i}` } }));
        default: return base.list(key, ctx);
      }
    },
    roll: async (key, rng, ctx = {}) => {
      if (key === "powerSources" && !ctx.archetype) { const r = d66Roll(RSOURCES, rng); return r ? { name: r.name, packUuid: `Compendium.invincible-core.power-sources.Item.${r.name}` } : null; }
      if (key === "cityLocations") { const r = d66Roll(RCITY, rng); return r ? { name: r.name } : null; }
      if (["knowledgeableSubjects", "teamNames", "teamBases", "baseUpgrades", "archetypes"].includes(key)) return rng.pick(await P.list(key, ctx));
      return null;
    }
  };
  return P;
}
const RP = realProvider({ bases: true });
const RP0 = realProvider({ heroes: 0 });
const nrm = R.normName;
{
  // distribution: the seeded D66 roll follows the table's own (uneven) rows
  const counts = Object.fromEntries(RSOURCES.map((r) => [r.name, 0]));
  let total = 0;
  const rng = createRng("dist");
  for (let i = 0; i < 40000; i++) { const r = d66Roll(RSOURCES, rng); if (r) { counts[r.name]++; total++; } }
  let worst = 0;
  for (const r of RSOURCES) {
    let valid = 0; for (let v = r.lo; v <= r.hi; v++) if (v % 10 >= 1 && v % 10 <= 6 && v >= 11 && v <= 66) valid++;
    if (!valid) { ok(counts[r.name] === 0, `an unrollable row ${r.name} is never rolled`); continue; }
    worst = Math.max(worst, Math.abs(counts[r.name] / total - valid / 36 / (RSOURCES.reduce((a, x) => a + (() => { let n = 0; for (let v = x.lo; v <= x.hi; v++) if (v % 10 >= 1 && v % 10 <= 6) n++; return n; })(), 0) / 36)) / (valid / 36));
  }
  ok(worst < 0.2, `the seeded D66 roll matches the uneven row odds (worst relative error ${worst.toFixed(3)})`);
}
{
  // hero validity with the real-shaped provider: every rank, many seeds and option mixes
  const N6 = Number(process.env.FUZZ6 ?? 600);
  for (const rank of R.RANK_ORDER) {
    let bad = 0, joins = 0, wheres = 0, know = 0, rels = 0;
    for (let i = 0; i < N6; i++) {
      const seed = `r6-${rank}-${i}`;
      const ro = { within: i % 3 === 0, joinBase: i % 5 === 0, spice: ["simple", "standard", "wild"][i % 3] };
      const base = RR.withToggle(RR.withSpice(S.createState({ seed, rank, mode: "random" }), ro.spice), "joinBase", ro.joinBase);
      const base2 = RR.withToggle(base, "within", ro.within);
      const res = await RR.rollNewHero(i % 7 === 0 ? RP0 : RP, { rank, seed, rollOpts: base2.rollOpts });
      const s = res.state, cfg = R.RANKS[rank];
      const fail = (why) => { bad++; if (bad <= 3) console.error("real-shaped", seed, why, JSON.stringify(res.errors?.map((e) => e.code))); };
      if (!res.ok) { fail("invalid"); continue; }
      if (R.attrSum(s.attrs) !== R.budget(s) || !R.ATTRS.every((k) => s.attrs[k] >= 1 && s.attrs[k] <= cfg.cap)) { fail("points"); continue; }
      const tal = [s.heroTalent?.name, s.occTalent?.name, ...s.extraTalents.map((t) => t.name)];
      if (tal.some((n) => !n || nrm(n) === "knowledgeable")) { fail("talent missing or bare Knowledgeable"); continue; }
      if (new Set(tal.map(nrm)).size !== tal.length && !tal.every((n) => /windfall/i.test(n))) { fail("duplicate talent"); continue; }
      if (s.personality.length !== 2 || nrm(s.personality[0]) === nrm(s.personality[1])) { fail("personality"); continue; }
      if (!s.drive?.name || !s.drive.text || !s.flaw?.name || !s.flaw.text || !s.heroName || !s.civilianName || !s.npcRel.name || !s.npcRel.type) { fail("persona/life text"); continue; }
      const occ = ROCCS.find((o) => o.name === s.occupation);
      if (!occ || s.resources !== occ.data.resources) { fail("occupation / resources"); continue; }
      if (!s.sources.length || s.powers.some((p) => !s.sources.some((x) => x.key === p.sourceKey))) { fail("sources"); continue; }
      if (s.powers.some((p) => p.level > R.levelCap(rank))) { fail("level cap"); continue; }
      const T = s.team;
      if (T.mode === "join") { joins++; if (!T.baseId || T.name || T.upgrades.length) { fail("join shape"); continue; } if (!ro.joinBase) { fail("join without option"); continue; } }
      else { if (!T.name || !T.base || !/^RCity/.test(T.where) || T.upgrades.length !== cfg.upgrades) { fail("team text"); continue; } wheres++; if (ro.joinBase && i % 7 !== 0) { fail("join expected"); continue; } }
      const opts = RR.randomOpts(RR.rollOptsOf(base2));
      if (!opts.heroRel === !!s.heroRel.name && opts.heroRel && i % 7 !== 0) { fail("hero relation flag"); continue; }
      if (s.heroRel.name) rels++;
      if (/^Knowledgeable \(/.test(s.heroTalent.name) || /^Knowledgeable \(/.test(s.occTalent.name)) know++;
      if (ro.spice === "simple" && (s.drawbacks.length || s.extraTalents.length || s.sources.length > 1 || s.heroRel.name || s.powers.some((p) => p.limits.length))) { fail("simple spice added extras"); continue; }
      if (i < 80) { const again = await RR.rollNewHero(i % 7 === 0 ? RP0 : RP, { rank, seed, rollOpts: base2.rollOpts }); if (JSON.stringify(again.state) !== JSON.stringify(s)) fail("not deterministic"); }
    }
    ok(bad === 0, `phase 6 real-shaped ${rank}: ${N6} heroes valid (all points spent, caps, talents, text, team) (${bad} bad; joins ${joins}, locations ${wheres}, subjects ${know}, hero relations ${rels})`);
    ok(wheres > 0 && joins > 0 && know > 0 && rels > 0, `phase 6 ${rank}: where, join, Knowledgeable subjects and hero relations all occur`);
  }
}
{
  // spice presets + hero code
  let s = S.createState({ seed: "sp", rank: "global" });
  eq(RR.rollOptsOf(s).spice, "standard", "default spice is standard");
  for (const k of RR.SPICES) eq(RR.rollOptsOf(RR.withSpice(s, k)).spice, k, `preset ${k} is detected`);
  eq(RR.rollOptsOf(RR.withToggle(RR.withSpice(s, "simple"), "drawbacks", true)).spice, "custom", "a changed toggle is custom");
  eq(RR.rollOptsOf(RR.withToggle(RR.withToggle(RR.withSpice(s, "simple"), "drawbacks", true), "drawbacks", false)).spice, "simple", "back to the preset");
  const o = RR.randomOpts(RR.rollOptsOf(RR.withSpice(s, "simple")));
  ok(!o.drawbacks && !o.extraTalents && !o.extraSource && o.limitChance === 0 && !o.slotVariance && !o.heroRel && !o.joinBase && !o.withinArchetype, "simple = nothing optional");
  ok(RR.randomOpts(RR.rollOptsOf(RR.withSpice(s, "wild"))).slotVariance, "wild varies the power count");
  const code = RR.heroCode(RR.withToggle(RR.withSpice(S.patch(s, { seed: "k3f9a2", rank: "street" }), "wild"), "within", true));
  eq(code, "k3f9a2:street:wild:arch:solo", "hero code format");
  eq(RR.parseHeroCode(code), { seed: "k3f9a2", rank: "street", spice: "wild", within: true, joinBase: false }, "hero code parses");
  eq(RR.parseHeroCode("abc123"), { seed: "abc123" }, "a bare seed is a code");
  ok(RR.parseHeroCode("bad seed!") === null && RR.parseHeroCode("") === null && RR.parseHeroCode(":x") === null, "invalid seeds are refused");
  eq(RR.parseHeroCode("a:nope:huge:x:y"), { seed: "a" }, "unknown parts are ignored");
  const back = RR.withCode(s, RR.parseHeroCode(code));
  eq([back.rank, RR.rollOptsOf(back).spice, RR.rollOptsOf(back).within], ["street", "wild", true], "a code applies its settings");
  // old states without rollOpts load
  ok(S.deserialize(JSON.stringify({ ...S.createState({ seed: "z" }), rollOpts: undefined })).rollOpts == null, "a state without rollOpts loads (defaults)");
  const rt = S.deserialize(S.serialize(RR.withSpice(s, "wild")));
  eq(RR.rollOptsOf(rt).spice, "wild", "rollOpts survive serialisation");
}
{
  // rows, locks, per-row reroll, reroll all, reseed, rank change
  const fields = (st, step) => JSON.stringify(S.STEP_FIELDS[step].map((f) => st[f]));
  const rows = ["concept", "powers", "talents", "attributes", "life", "persona", "team"];
  let bad = 0;
  for (const rank of R.RANK_ORDER) for (let i = 0; i < 60; i++) {
    const ro = RR.withSpice(S.createState({ seed: `b-${rank}-${i}`, rank, mode: "random" }), ["simple", "standard", "wild"][i % 3]);
    const base = (await RR.rollNewHero(RP, { rank, seed: `b-${rank}-${i}`, rollOpts: ro.rollOpts })).state;
    for (const step of rows) {
      const next = await RR.rerollRow(base, step, RP);
      for (const other of rows) {
        if (other === step) continue;
        if (other === "attributes" && (step === "powers" || step === "talents")) continue;
        if (fields(next, other) !== fields(base, other)) { bad++; if (bad < 4) console.error("board isolation", rank, i, step, other); }
      }
      const v = R.validate(next);
      if (!v.ok || R.attrSum(next.attrs) !== R.budget(next)) { bad++; if (bad < 4) console.error("board reroll invalid", rank, i, step, v.errors.map((e) => e.code)); }
      if (step === "powers" && R.attrSum(next.attrs) !== R.budget(next)) bad++;   // rerolling powers re-balances the attributes: 0 points left
      if (next.rank !== base.rank || next.seed !== base.seed || JSON.stringify(next.rollOpts) !== JSON.stringify(base.rollOpts)) bad++;
    }
  }
  ok(bad === 0, `board: rerolling one row leaves the others (attributes only re-balanced by powers / talents), hero stays valid, 0 points left (${bad} bad)`);

  // locks / kept rows / edited rows
  bad = 0;
  for (const rank of R.RANK_ORDER) for (let i = 0; i < 80; i++) {
    const base = (await RR.rollNewHero(RP, { rank, seed: `lk6-${rank}-${i}` })).state;
    const pickRows = rows.filter((_, j) => ((i + 1) >> (j % 3)) % 2 === 1 || j === i % 7).slice(0, 3 + (i % 2));
    let s = base;
    for (const step of pickRows) s = RR.toggleRowLock(s, step);
    for (const step of pickRows) if (RR.lockMode(s, step) !== "locked" || !RR.isKept(s, step)) bad++;
    const res = await RR.rerollUnlocked(s, RP);
    for (const step of pickRows) if (fields(res.state, step) !== fields(base, step)) { bad++; if (bad < 4) console.error("kept row changed", rank, i, step); }
    if (!res.ok) { bad++; if (bad < 4) console.error("locked reroll invalid", rank, i, pickRows.join(), res.errors.map((e) => e.code)); }
    // an explicit row reroll of a locked row is refused; unlocking makes it rollable
    const l0 = await RR.rerollRow(s, pickRows[0], RP); if (l0 !== s) bad++;
    const u = RR.toggleRowLock(s, pickRows[0]); if (RR.isKept(u, pickRows[0])) bad++;
    // edited by hand = kept for "reroll all", refused for a plain row reroll, allowed with force, which clears the flag
    const ed = S.markTouched(base, "persona");
    eq(RR.lockMode(ed, "persona"), "edited", "touched row is 'edited'");
    const all = await RR.rerollUnlocked({ ...ed, seed: `ed-${i}`, rerolls: {} }, RP);
    if (fields(all.state, "persona") !== fields(base, "persona")) bad++;
    if ((await RR.rerollRow(ed, "persona", RP)) !== ed) bad++;
    const forced = await RR.rerollRow(ed, "persona", RP, { force: true });
    if (forced.touched.persona || fields(forced, "persona") === fields(base, "persona")) bad++;
    if (RR.unlockedRows(ed).includes("persona") || !RR.unlockedRows(base).includes("persona")) bad++;
  }
  ok(bad === 0, `board: kept (locked / edited) rows survive 'Reroll all unlocked' and stay valid (${bad} bad)`);

  // same seed -> same hero; copy / paste of the seed on the board
  bad = 0;
  for (const rank of R.RANK_ORDER) for (let i = 0; i < 40; i++) {
    const fresh = await RR.rollNewHero(RP, { rank, seed: `sd-${i}`, rollOpts: RR.withSpice(S.createState({ seed: "x" }), ["simple", "standard", "wild"][i % 3]).rollOpts });
    const other = (await RR.rollNewHero(RP, { rank, seed: "other" })).state;
    const moved = await RR.reseed(S.patch(other, { rollOpts: fresh.state.rollOpts }), `sd-${i}`, RP);
    if (JSON.stringify(moved.state) !== JSON.stringify(fresh.state)) { bad++; if (bad < 3) console.error("reseed differs from a fresh roll", rank, i); }
    const pasted = RR.withCode(other, RR.parseHeroCode(RR.heroCode(fresh.state)));
    const via = await RR.reseed(pasted, RR.parseHeroCode(RR.heroCode(fresh.state)).seed, RP);
    if (JSON.stringify(via.state) !== JSON.stringify(fresh.state)) { bad++; if (bad < 3) console.error("pasted hero code differs", rank, i); }
  }
  ok(bad === 0, `seeds: a fresh roll, a reseed and a pasted hero code give the identical hero (${bad} bad)`);

  // rank change on the board
  bad = 0;
  for (const from of R.RANK_ORDER) for (const to of R.RANK_ORDER) for (let i = 0; i < 10; i++) {
    const base = (await RR.rollNewHero(RP, { rank: from, seed: `rk-${i}` })).state;
    const res = await RR.changeRank(base, to, RP);
    if (from === to) { if (res.state !== base && res.state.rank !== to) bad++; continue; }
    if (!res.ok || res.state.rank !== to || R.attrSum(res.state.attrs) !== R.budget(res.state)) { bad++; if (bad < 3) console.error("rank change", from, to, res.errors?.map((e) => e.code)); }
    const kept = RR.toggleRowLock(base, "persona");
    const r2 = await RR.changeRank(kept, to, RP);
    if (fields(r2.state, "persona") !== fields(base, "persona")) bad++;
  }
  ok(bad === 0, `board: changing the rank re-rolls the unlocked rows into a valid hero of that rank, kept rows stay (${bad} bad)`);

  // concept within an archetype cascades to the dependent rows, never to rank or team
  bad = 0; let changedArch = 0;
  for (const rank of R.RANK_ORDER) for (let i = 0; i < 40; i++) {
    const ro = RR.withToggle(S.createState({ seed: "c" }), "within", true).rollOpts;
    const base = (await RR.rollNewHero(RP, { rank, seed: `cc-${rank}-${i}`, rollOpts: ro })).state;
    if (!base.archetype) { bad++; continue; }
    const next = await RR.rerollRow(base, "concept", RP);
    if (next.archetype !== base.archetype) changedArch++;
    if (fields(next, "team") !== fields(base, "team") || next.rank !== base.rank) bad++;
    if (!R.validate(next).ok || R.attrSum(next.attrs) !== R.budget(next)) { bad++; if (bad < 3) console.error("cascade invalid", rank, i, R.validate(next).errors.map((e) => e.code)); }
    if (JSON.stringify(next.locks) !== JSON.stringify(base.locks)) bad++;
  }
  ok(bad === 0 && changedArch > 100, `board: rerolling the concept within an archetype re-rolls the dependent rows and keeps rank / team (${bad} bad, ${changedArch} changed)`);

  // team: join option, member hero, join -> text fallback
  const T0 = (await RR.rollNewHero(RP, { rank: "global", seed: "tm1" })).state;
  ok(T0.team.mode === "text" && /^RCity/.test(T0.team.where) && T0.team.upgrades.length === 2, "team step rolls name, kind, location and the starting upgrades");
  const joined = await rollStep(T0, "team", RP, { joinBase: true });
  ok(joined.team.mode === "join" && /^id\.Bse/.test(joined.team.baseId) && joined.team.name === "" && joined.team.upgrades.length === 0, "joinBase picks an existing base (mode join, card owns the texts)");
  const text = await rollStep(joined, "team", RP, { joinBase: false });
  ok(text.team.mode === "text" && text.team.baseId === null && text.team.name && text.team.where, "a joined state rerolled without the option falls back to text");
  const none = await rollStep(T0, "team", realProvider({ bases: false }), { joinBase: true });
  ok(none.team.mode === "text", "joinBase without a visible base stays text");
  const member = S.patch(T0, { team: { ...T0.team, mode: "member", name: "Card", base: "", where: "", upgrades: [] } });
  const mr = await rollStep(member, "team", RP, { joinBase: true });
  eq(mr.team, member.team, "a member hero's team part is never rolled");
  ok((await rollStep(T0, "team", RP, { heroRel: false })).heroRel.name === "", "heroRel off rolls no second relationship");
  ok((await rollStep(T0, "team", RP, {})).heroRel.name !== "", "heroRel on rolls one when heroes exist");
}
{
  // random operation sequences (board fuzz): rolls, locks, reroll all, reseed, rank change, in any order; no throw, locked fields never change
  const N = Number(process.env.FUZZ_OPS ?? 150);
  const rows = ["concept", "powers", "talents", "attributes", "life", "persona", "team"];
  const fields = (st, step) => JSON.stringify(S.STEP_FIELDS[step].map((f) => st[f]));
  let bad = 0, ops = 0;
  for (let n = 0; n < N; n++) {
    const rng = createRng(`ops-${n}`);
    const rank = rng.pick(R.RANK_ORDER);
    let s = (await RR.rollNewHero(RP, { rank, seed: `o-${n}`, rollOpts: RR.withToggle(RR.withSpice(S.createState({ seed: "x" }), rng.pick(RR.SPICES)), "within", rng.chance(0.3)).rollOpts })).state;
    for (let k = 0; k < 14; k++) {
      ops++;
      const op = rng.pick(["row", "row", "row", "lock", "all", "seed", "rank", "unlock", "edit"]);
      const kept0 = rows.filter((r) => RR.isKept(s, r)), snap = Object.fromEntries(kept0.map((r) => [r, fields(s, r)]));
      let next = s, mayInvalid = kept0.length > 0;
      if (op === "row") next = await RR.rerollRow(s, rng.pick(rows), RP);
      else if (op === "lock") next = RR.toggleRowLock(s, rng.pick(rows));
      else if (op === "all") next = (await RR.rerollUnlocked(s, RP)).state;
      else if (op === "seed") next = (await RR.reseed(s, `n${n}-${k}`, RP)).state;
      else if (op === "rank") { const r2 = rng.pick(R.RANK_ORDER); next = (await RR.changeRank(s, r2, RP)).state; mayInvalid = true; }
      else if (op === "unlock") next = rows.reduce((a, r) => (RR.isKept(a, r) ? RR.toggleRowLock(a, r) : a), s);
      else if (op === "edit") next = S.markTouched(s, rng.pick(rows));
      if (op !== "lock" && op !== "unlock" && op !== "edit") for (const r of kept0) if (RR.isKept(next, r) && fields(next, r) !== snap[r] && !(op === "rank" && r === "attributes")) { bad++; if (bad < 4) console.error("kept row changed in", op, r); }
      if (!mayInvalid && ((op === "row" && R.validate(s).ok) || op === "all" || op === "seed") && (!R.validate(next).ok || R.attrSum(next.attrs) !== R.budget(next))) { bad++; if (bad < 4) console.error("board op left an invalid hero", op, R.validate(next).errors.map((e) => e.code)); }
      s = next;
    }
  }
  ok(bad === 0, `board fuzz: ${ops} random operations (${N} sequences): no throw, kept rows unchanged, heroes without locks always valid (${bad} bad)`);
}

// ---------- phase 9 regression checks (bughunt #1): B2, B3, B4, C1, C2, C4, C5 (rebase), hero-code fuzz ----------
{
  const base = (over = {}) => S.patch(S.createState({ seed: "p9", rank: "global" }), over);
  const hero = (over = {}) => {
    let s = base({ heroTalent: { name: "Tough", packUuid: null }, occupation: "Cook", occTalent: { name: "Lucky", packUuid: null }, resources: 2, heroName: "H", civilianName: "C", drive: { name: "d", text: "" }, flaw: { name: "f", text: "" }, personality: ["a", "b"], npcRel: { type: "x", name: "y" }, team: { ...S.createState().team, name: "T" } });
    s = S.addSource(s, { name: "Src" }); s = S.addPower(s, { name: "Swimming" });
    s = S.patch(s, { attrs: { fighting: 5, agility: 5, strength: 5, reason: 5, intuition: 5, presence: 5 }, ...over });
    return s;
  };
  const codes = (s) => R.validate(s).issues.map((i) => i.code);
  // B2: levels only where the book defines them (the table is filled from the installed book at runtime; here by hand)
  R.setPowerMaxLevels([["Swimming", 0], ["Flight", 3]]);
  let s = hero();
  ok(!codes(s).includes("power.level.none"), "B2: a basic-only power at basic is fine");
  s = S.setPowerLevel(s, "p1", 1);
  ok(codes(s).includes("power.level.none"), "B2: Major on a basic-only power is an error");
  ok(R.powerMaxLevel({ name: "Flight" }) === 3 && R.powerMaxLevel({ name: "Unknown" }) === null, "B2: unknown powers are unrestricted, known ones carry their max");
  ok(R.powerMaxLevel({ name: "Swimming", maxLevel: 2 }) === 2, "B2: a per-power maxLevel field wins");
  R.setPowerMaxLevels([]);
  {   // random never rolls a level above maxLevel (fixture powers with maxLevel 0 exist: i % 5 === 4)
    let bad = 0;
    const list = (key) => (key === "powers" ? POWERS : key === "talents" || key === "heroTalents" || key === "occupationTalents" ? E(TALENTS) : key === "powerSources" ? E(N("Src", 6)) : key === "drawbacks" ? E(N("Dr", 8)) : key === "occupations" ? OCCS : key === "personality" ? E(N("Pers", 12)) : key === "drives" || key === "flaws" ? E(N("Txt", 8), { text: "t" }) : key === "heroNames" || key === "civilianNames" || key === "teamNames" ? E(N("Nm", 9)) : key === "npcRelations" ? E(N("Rel", 5)) : []);
    const P = { list: async (key) => list(key) };
    for (let i = 0; i < 400; i++) {
      const r = await rollHero(`p9-${i}`, R.RANK_ORDER[i % 4], P, { slotVariance: true, drawbacks: true, extraTalents: true, extraSource: true });
      for (const p of r.state.powers) { const e = POWERS.find((x) => x.name === p.name); if (e && p.level > e.maxLevel) bad++; }
    }
    ok(bad === 0, `B2: 400 random heroes never exceed a power's maxLevel (${bad} bad)`);
  }
  // B3: repeatable talents modelled on the book (Durable / Determined up to 5, Windfall without a cap)
  ok(R.talentLimit("Durable") === 5 && R.talentLimit("determined") === 5 && R.talentLimit("Windfall") === Infinity && R.talentLimit("Tough") === 1 && R.talentLimit("constructor") === 1, "B3: talent limits");
  let t = hero({ heroTalent: { name: "Durable", packUuid: null }, extraTalents: [{ name: "Durable" }, { name: "Durable" }, { name: "Durable" }, { name: "Durable" }] });
  ok(!codes(t).includes("talent.duplicate"), "B3: Durable taken 5 times is legal");
  t = S.patch(t, { extraTalents: [...t.extraTalents, { name: "Durable" }] });
  ok(codes(t).includes("talent.duplicate"), "B3: Durable a 6th time is refused");
  ok(!codes(hero({ extraTalents: [{ name: "Windfall" }, { name: "Windfall" }, { name: "Windfall" }] })).includes("talent.duplicate"), "B3: Windfall has no cap");
  ok(codes(hero({ extraTalents: [{ name: "Tough" }] })).includes("talent.duplicate"), "B3: an ordinary talent twice is refused");
  // C4: one Knowledgeable subject per hero
  ok(R.talentKey("Knowledgeable (Technology)") === "knowledgeable", "C4: the subject is not part of the talent identity");
  ok(codes(hero({ extraTalents: [{ name: "Knowledgeable (Technology)" }, { name: "Knowledgeable (History)" }] })).includes("talent.duplicate"), "C4: two Knowledgeable subjects are refused");
  ok(!codes(hero({ extraTalents: [{ name: "Knowledgeable (Technology)" }] })).includes("talent.duplicate"), "C4: one Knowledgeable subject is fine");
  // B4: a drawback that needs a choice -> a WARNING (not an error) until the note is filled
  let d = hero({ drawbacks: [{ name: "Phobic", packUuid: null, note: "", needs: "defined" }] });
  const v = R.validate(d);
  ok(v.warnings.some((i) => i.code === "drawback.note.missing") && !v.errors.some((i) => i.code === "drawback.note.missing"), "B4: a missing choice is a warning, never an error");
  d = S.patch(d, { drawbacks: [{ name: "Phobic", packUuid: null, note: "spiders", needs: "defined" }] });
  ok(!codes(d).includes("drawback.note.missing"), "B4: a filled note clears the warning");
  ok(!codes(hero({ drawbacks: [{ name: "Frightful", packUuid: null, note: "" }] })).includes("drawback.note.missing"), "B4: drawbacks without a choice never warn");
  // C1: prototype keys are not ranks anywhere
  for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty", "valueOf"]) {
    ok(R.validate({ ...base(), rank: k }).errors.some((e) => e.code === "rank.unknown"), `C1: rank "${k}" is unknown`);
    ok(R.RANKS[k] === undefined && !R.isRank(k), `C1: RANKS["${k}"] is undefined`);
    ok(R.budget({ ...base(), rank: k }) === 0 && R.budgetFor(k, { S: 1 }) === 0, `C1: budget of rank "${k}" is 0, not NaN`);
    let threw = false; try { S.deserialize({ ...base(), rank: k }); } catch { threw = true; }
    ok(threw, `C1: deserialize refuses rank "${k}"`);
  }
  // C2: validate never throws on garbage shapes; deserialize refuses or normalises them
  for (const bad of [{ powers: "x" }, { sources: 5 }, { drawbacks: {} }, { extraTalents: "a" }, { personality: 7 }, { powers: [null] }, { drawbacks: [null, 3] }, { extraTalents: [null] }, { sources: [null] }]) {
    let threw = false; try { R.validate({ ...hero(), ...bad }); R.budget({ ...hero(), ...bad }); } catch { threw = true; }
    ok(!threw, `C2: validate survives ${JSON.stringify(bad)}`);
    let ds = null; try { ds = S.deserialize({ ...hero(), ...bad }); } catch { ds = null; }
    ok(ds === null || (Array.isArray(ds.powers) && Array.isArray(ds.drawbacks) && Array.isArray(ds.extraTalents) && Array.isArray(ds.sources) && Array.isArray(ds.personality)), `C2: deserialize returns clean collections or refuses ${JSON.stringify(bad)}`);
    if (ds) { let thr = false; try { R.validate(ds); } catch { thr = true; } ok(!thr, "C2: a deserialized state validates"); }
  }
  ok(!R.validate({ ...hero(), powers: "x" }).ok, "C2: a wrong-shape state is invalid, not ok");
  const roundTrip = S.deserialize(S.serialize(hero({ drawbacks: [{ name: "Phobic", packUuid: null, note: "a", needs: "source" }] })));
  eq(roundTrip.drawbacks[0], { name: "Phobic", packUuid: null, note: "a", needs: "source" }, "C2: a valid state survives serialize / deserialize (needs kept)");
  eq(Object.keys(S.deserialize({ ...base(), locks: { constructor: true, powers: true, nonsense: true }, touched: { x: true, powers: true } }).locks), ["powers"], "C2: unknown lock keys are dropped");
  {   // C5: rebase = apply what an async roll changed on top of the CURRENT state
    const a = hero(), edited = S.patch(a, { heroName: "Edited", rerolls: { x: 1 } });
    const rolled = S.patch(a, { powers: [], attrs: { ...a.attrs, fighting: 6 }, rerolls: { y: 2 } });
    const m = S.rebase(edited, a, rolled);
    ok(m.heroName === "Edited" && m.powers.length === 0 && m.attrs.fighting === 6, "C5: the roll's fields are applied, the user's edit survives");
    eq(m.rerolls, { x: 1, y: 2 }, "C5: reroll counters merge per key");
    ok(S.rebase(a, a, rolled) === rolled, "C5: unchanged state -> the rolled state as it is");
  }
  {   // hero-code fuzz: parseHeroCode on garbage never throws and never yields unexpected keys
    const rng = createRng("hc9");
    const alpha = "abcXYZ019:_-!? \n_proto_constructor";
    let bad = 0;
    for (let i = 0; i < 3000; i++) {
      const len = rng.int(24);
      let str = ""; for (let j = 0; j < len; j++) str += alpha[rng.int(alpha.length)];
      let r; try { r = RR.parseHeroCode(str); } catch { bad++; continue; }
      if (r !== null && (typeof r.seed !== "string" || !/^[A-Za-z0-9_-]{1,32}$/.test(r.seed) || (r.rank !== undefined && !R.isRank(r.rank)) || Object.keys(r).some((k) => !["seed", "rank", "spice", "within", "joinBase"].includes(k)))) bad++;
    }
    ok(bad === 0, `hero-code fuzz: 3000 garbage codes never throw or leak keys (${bad} bad)`);
  }
}

console.log(`${checks} checks, ${fails} failed, ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(fails ? "FAILED" : "OK");
process.exit(fails ? 1 : 0);
