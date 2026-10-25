// node scripts/base/check-base.mjs  -> prints "OK <n> checks" or exits 1.
// Fixtures are SHAPE-only (short identifiers, no book prose).
import * as P from "./pure.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let n = 0; const fails = [];
const ck = (name, cond) => { n++; if (!cond) fails.push(name); };
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));
const eq = (name, a, b) => ck(`${name}: ${canon(a)} !== ${canon(b)}`, canon(a) === canon(b));
// seeded rng (mulberry32)
const seeded = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/* ---- no Foundry globals (grep proof) */
const src = readFileSync(fileURLToPath(new URL("./pure.mjs", import.meta.url)), "utf8");
for (const g of ["game.", "foundry.", "ui.", "canvas.", "Hooks.", "CONFIG.", "document.", "window.", "fromUuid", "Actor", "JournalEntry"])
  ck(`pure.mjs must not reference ${g}`, !new RegExp(`(^|[^\\w.])${g.replace(".", "\\.")}`, "m").test(src.replace(/\/\/.*$/gm, "").replace(/"[^"\n]*"/g, '""').replace(/`[^`]*`/g, "``")));

/* ---- normalize / migrate */
const d = P.defaultBase();
eq("default v", d.v, 1); eq("default rank", d.rank, "global"); eq("default policy", d.policy, { edit: "members", syncHeroes: true, chat: "public" });
for (const c of P.COLLECTIONS) eq(`default ${c} empty`, d[c], {});
eq("default occupied", d.base.occupied, false); eq("default rolls", d.base.rolls, { kind: null, where: null });
eq("normalize({}) == default", P.normalize({}), d);
eq("normalize(null) == default", P.normalize(null), d);
eq("normalize(42) == default", P.normalize(42), d);
eq("normalize(default) idempotent", P.normalize(d), d);
const messy = { name: 5, rank: "bogus", unknownTop: { a: 1 }, base: { kind: "k", extra: 7, rolls: { kind: { table: "t", resultName: "r", at: 3, more: 1 } } },
  policy: { edit: "x", chat: "gm", keep: true },
  upgrades: { a: { key: "concealment", name: "C", count: "2", status: "weird", source: "karma", paid: -5, foo: "bar" }, "-=b": {}, c: "notobject" },
  crate: { x: { name: "Rope", qty: 0, snap: "bad" } }, events: { e: { roll: "45", text: "x".repeat(500), effect: { kind: "disable", upgrades: ["a", 3] } } } };
const nm = P.normalize(messy);
eq("name coerced", nm.name, "5"); eq("bad rank -> global", nm.rank, "global");
eq("unknown top key kept", nm.unknownTop, { a: 1 }); eq("unknown base key kept", nm.base.extra, 7);
eq("unknown roll key kept", nm.base.rolls.kind.more, 1); eq("roll missing -> null", nm.base.rolls.where, null);
eq("policy edit fallback", nm.policy.edit, "members"); eq("policy chat kept", nm.policy.chat, "gm"); eq("unknown policy key kept", nm.policy.keep, true);
eq("upgrade count coerced", nm.upgrades.a.count, 2); eq("upgrade bad status", nm.upgrades.a.status, "active");
eq("upgrade paid min 0", nm.upgrades.a.paid, 0); eq("unknown upgrade key kept", nm.upgrades.a.foo, "bar");
ck("-= keys dropped", !("-=b" in nm.upgrades)); ck("non-object entries dropped", !("c" in nm.upgrades));
eq("crate qty min 1", nm.crate.x.qty, 1); eq("crate snap fallback", nm.crate.x.snap, {});
eq("event roll coerced", nm.events.e.roll, 45); eq("event text clamped", nm.events.e.text.length, 300);
eq("effect upgrades filtered", nm.events.e.effect.upgrades, ["a"]); eq("effect applied default", nm.events.e.effect.applied, false);
eq("normalize idempotent on messy", P.normalize(nm), nm);
const before = JSON.stringify(messy); P.normalize(messy); eq("input not mutated", JSON.stringify(messy), before);
eq("v0 array -> map", Object.keys(P.normalize({ v: 0, upgrades: [{ key: "workshop" }, { key: "x" }] }).upgrades), ["m0", "m1"]);
eq("v missing migrates to 1", P.normalize({ upgrades: [{}] }).v, 1);
eq("future version kept", P.normalize({ v: 7 }).v, 7);
eq("migrate keeps future untouched", P.migrate({ v: 9, upgrades: [1] }).upgrades, [1]);
eq("MIGRATIONS length == version", P.MIGRATIONS.length, P.SCHEMA_VERSION);

/* ---- id-keyed helpers */
const map = { b: { sort: 2, at: 1 }, a: { sort: 1, at: 5 }, c: { sort: 2, at: 0 } };
eq("sortedList order", P.sortedList(map).map((e) => e.id), ["a", "c", "b"]);
eq("nextSort", P.nextSort(map), 3); eq("nextSort empty", P.nextSort({}), 1);
eq("patchSet", P.patchSet("upgrades", "u1", { status: "broken" }), { "flags.invincible-plus-ultra.base.upgrades.u1.status": "broken" });
eq("patchRemove", P.patchRemove("crate", "z"), { "flags.invincible-plus-ultra.base.crate.-=z": null });
eq("patchAdd", Object.keys(P.patchAdd("events", "e1", {}))[0], "flags.invincible-plus-ultra.base.events.e1");
const r1 = seeded(1); const ids = new Set(Array.from({ length: 500 }, () => P.makeId(r1))); eq("makeId unique+len", [ids.size, [...ids][0].length], [500, 16]);
eq("slug", P.slug("Defense System"), "defense-system"); eq("slug punctuation", P.slug("  Power-Effect! "), "power-effect");

/* ---- prerequisites: 17 shapes + malformed */
const NAMES = ["Comm System", "Computer Mainframe", "Concealment", "Defense System", "Holding Cells", "Laboratory", "Medical Facilities", "Power Effect", "Team Vehicle", "Training Facilities", "Training Simulator", "Vehicle Defense", "Vehicle Mobility", "Vehicle Room", "Vehicle Targeting", "Vehicle Weaponry", "Workshop"];
const REAL = [
  ["Prerequisite: Resources 5 or Technician", 5, ["Technician"], []],
  ["Prerequisite: Resources 5 or Technician", 5, ["Technician"], []],
  ["Prerequisite: -", null, [], []],
  ["Prerequisite: Resources 5, Law Enforcer, Secret Agent, Soldier, or Technician", 5, ["Law Enforcer", "Secret Agent", "Soldier", "Technician"], []],
  ["Prerequisite: –", null, [], []],
  ["Prerequisite: Resources 6, Expert, Medic, Scientist, or Technician", 6, ["Expert", "Medic", "Scientist", "Technician"], []],
  ["Prerequisite: Resources 6 or Medic", 6, ["Medic"], []],
  ["Prerequisite: Resource level 7", 7, [], []],
  ["Prerequisite: –", null, [], []],
  ["Prerequisite: -", null, [], []],
  ["Prerequisite: Training Facilities", null, [], ["Training Facilities"]],
  ["Prerequisite: Team Vehicle", null, [], ["Team Vehicle"]],
  ["Prerequisite: Team Vehicle", null, [], ["Team Vehicle"]],
  ["Prerequisite: Team Vehicle", null, [], ["Team Vehicle"]],
  ["Prerequisite: Vehicle Weaponry", null, [], ["Vehicle Weaponry"]],
  ["Prerequisite: Team Vehicle", null, [], ["Team Vehicle"]],
  ["Prerequisite: Resources 4 or Blue Collar", 4, ["Blue Collar"], []]
];
eq("17 fixtures", REAL.length, 17);
REAL.forEach(([raw, res, occ, ups], i) => {
  const p = P.parsePrerequisite(raw, NAMES);
  ck(`fx${i} ok`, p.ok === true); eq(`fx${i} resources`, p.resources, res); eq(`fx${i} occupations`, p.occupations, occ);
  eq(`fx${i} upgrades`, p.upgrades, ups); eq(`fx${i} none`, p.none, res == null && !occ.length && !ups.length);
  eq(`fx${i} unparsed empty`, p.unparsed, []); eq(`fx${i} raw kept`, p.raw, raw);
});
eq("label optional", P.parsePrerequisite("Resources 5 or Technician", NAMES).resources, 5);
eq("case-insens upgrade", P.parsePrerequisite("team vehicle", NAMES).upgrades, ["Team Vehicle"]);
eq("upgrade names optional (occupation)", P.parsePrerequisite("Team Vehicle").occupations, ["Team Vehicle"]);
eq("resources min over alternatives", P.parsePrerequisite("Resources 7 or Resources 5", NAMES).resources, 5);
eq("empty string = none", P.parsePrerequisite("", NAMES).none, true);
eq("Prerequisite: with no value = none", P.parsePrerequisite("Prerequisite:", NAMES).none, true);
const MALFORMED = [null, undefined, 42, {}, [], "Resources", "Resources five", "Resources 5; Technician", "???", "a".repeat(500), "Resources 5 or ((", "<b>Technician</b>", "1234", "or or ,,, and", "Resources 5: or 6"];
MALFORMED.forEach((m, i) => {
  let p; let threw = false;
  try { p = P.parsePrerequisite(m, NAMES); } catch { threw = true; }
  ck(`malformed${i} no throw`, !threw);
  if (!threw) {
    const e = (() => { try { return P.evalPrerequisite(p, { members: [{ id: "a", name: "A", resources: 9, occupation: "Technician" }], owned: [] }); } catch { return null; } })();
    ck(`malformed${i} eval no throw`, e !== null);
  }
});
for (const i of [0, 1, 2, 3, 4, 5, 6, 7, 9, 11, 12, 14]) ck(`malformed${i} ok:null`, P.parsePrerequisite(MALFORMED[i], NAMES).ok === null);
ck("ok:null eval is unknown, not tooPricey", (() => { const e = P.evalPrerequisite(P.parsePrerequisite("Resources", NAMES), {}); return e.ok === null && e.tooPricey === false && e.reasons[0].key === "IPB.Up.preUnknown"; })());
eq("evalPrerequisite(undefined) -> unknown", P.evalPrerequisite(undefined).ok, null);

/* ---- evaluation, Too Pricey */
const mem = (resources, occupation, name = "H") => ({ id: name, name, resources, occupation });
const ev = (raw, members, owned = []) => P.evalPrerequisite(P.parsePrerequisite(raw, NAMES), { members, owned });
let e = ev("Resources 5 or Technician", [mem(5, "")]);
ck("resources met", e.ok === true && !e.tooPricey);
e = ev("Resources 5 or Technician", [mem(2, "Master technician")]);
ck("occupation met (word match)", e.ok === true);
e = ev("Resources 5 or Technician", [mem(2, "Technicians' guild")]);
ck("occupation plural/punct match", e.ok === true);
e = ev("Resources 5 or Technician", [mem(2, "Electrotechnician")]);
ck("occupation substring is NOT a match", e.ok === false && e.tooPricey === true);
e = ev("Resources 5 or Technician", [mem(2, "Student"), mem(4, "Clerk")]);
ck("unmet group -> tooPricey", e.ok === false && e.tooPricey === true);
e = ev("Resources 5 or Technician", []);
ck("no members -> tooPricey", e.ok === false && e.tooPricey === true);
e = ev("Team Vehicle", [mem(8, "Technician")], []);
ck("missing upgrade prerequisite: not ok, NOT tooPricey", e.ok === false && e.tooPricey === false);
e = ev("Team Vehicle", [mem(1, "")], [{ key: "team-vehicle", name: "Team Vehicle", status: "active" }]);
ck("upgrade prerequisite met by key", e.ok === true);
e = ev("Team Vehicle", [], [{ key: "x", name: "team vehicle", status: "installing" }]);
ck("upgrade met by name case-insens, installing counts", e.ok === true);
e = ev("Team Vehicle", [], [{ key: "team-vehicle", name: "Team Vehicle", status: "broken" }]);
ck("broken upgrade does not satisfy", e.ok === false && e.tooPricey === false);
e = ev("Team Vehicle", [], [{ key: "team-vehicle", name: "Team Vehicle", status: "disabled" }]);
ck("disabled counts but flagged", e.ok === true && e.reasons.some((r) => r.key === "IPB.Up.preUpgradeDisabled"));
e = ev("-", []); ck("none prerequisite ok", e.ok === true && !e.tooPricey);
e = ev("Resource level 7", [mem(6, "")]); ck("resource level 7 unmet -> tooPricey", e.ok === false && e.tooPricey === true);
// mixed (hypothetical): group unmet AND upgrade unmet -> not tooPricey
{
  const pre = { raw: "x", ok: true, none: false, resources: 5, occupations: [], upgrades: ["Team Vehicle"], unparsed: [] };
  const r = P.evalPrerequisite(pre, { members: [mem(1, "")], owned: [] });
  ck("group+upgrade both unmet -> not tooPricey", r.ok === false && r.tooPricey === false);
  const r2 = P.evalPrerequisite(pre, { members: [mem(1, "")], owned: [{ key: "team-vehicle", name: "Team Vehicle", status: "active" }] });
  ck("group unmet, upgrade met -> tooPricey", r2.ok === false && r2.tooPricey === true);
}
e = ev("Resources 5 or Technician", [mem(5, "")]);
ck("reasons name the hero", e.reasons.some((r) => r.key === "IPB.Up.preResourcesMet" && r.params.who === "H"));
eq("occupationMatches empty", P.occupationMatches("", "Medic"), false);
eq("occupationMatches nonstring", P.occupationMatches(null, "Medic"), false);
eq("occupationMatches regex chars safe", P.occupationMatches("C++ dev", "C++"), true);

/* ---- cost */
eq("cost normal", P.upgradeCost({ ok: true, tooPricey: false }).cost, 10);
eq("cost tooPricey", P.upgradeCost({ ok: false, tooPricey: true }).cost, 20);
eq("cost tooPricey kind", P.upgradeCost({ ok: false, tooPricey: true }).kind, "tooPricey");
ck("cost blocked (upgrade prerequisite)", (() => { const c = P.upgradeCost({ ok: false, tooPricey: false }); return c.blocked && c.cost === null; })());
eq("cost unknown = 10, flagged", [P.upgradeCost({ ok: null }).cost, P.upgradeCost({ ok: null }).kind], [10, "unknown"]);
eq("cost override wins over blocked", P.upgradeCost({ ok: false, tooPricey: false }, 0).cost, 0);
eq("cost override 15", P.upgradeCost({ ok: true }, 15).kind, "override");
eq("cost bad override ignored", P.upgradeCost({ ok: true }, "x").cost, 10);

/* ---- stacking */
eq("stack twice", P.parseStack("This can be selected twice."), { max: 2, perPower: false, gm: false });
eq("stack default", P.parseStack("An effect.").max, 1);
eq("stack several", P.parseStack("selected several times").max, null);
eq("stack multiple GM", P.parseStack("multiple times if the GM allows").gm, true);
eq("stack per power", P.parseStack("up to four times for the same power"), { max: 4, perPower: true, gm: false });
eq("stack non-string", P.parseStack(undefined).max, 1);
eq("stack three times", P.parseStack("three times").max, 3);
ck("stack ok first", P.checkStack({ max: 2 }, []).ok);
ck("stack ok second", P.checkStack({ max: 2 }, [{ count: 1 }]).ok);
ck("stack blocked third", !P.checkStack({ max: 2 }, [{ count: 1 }, { count: 1 }]).ok);
eq("stack blocked reason", P.checkStack({ max: 1 }, [{ count: 1 }]).reason.key, "IPB.Up.stackMax");
ck("stack single blocks", !P.checkStack({ max: 1 }, [{ count: 1 }]).ok);
ck("stack grant overrides", (() => { const r = P.checkStack({ max: 1 }, [{ count: 1 }], { grant: true }); return r.ok && r.grant; })());
ck("stack unlimited", P.checkStack({ max: null }, Array(30).fill({ count: 1 })).ok);
ck("stack count field respected", !P.checkStack({ max: 2 }, [{ count: 2 }]).ok);
ck("per power: other power allowed", P.checkStack({ max: 4, perPower: true }, Array(4).fill({ count: 1, power: "Flight" }), { power: "Strike" }).ok);
ck("per power: same power at 4 blocked (case-insens)", !P.checkStack({ max: 4, perPower: true }, Array(4).fill({ count: 1, power: "Flight" }), { power: " flight " }).ok);

/* ---- allowance */
for (const [r, t] of [["teen", 0], ["street", 1], ["global", 2], ["cosmic", 3]]) eq(`allowance ${r}`, P.allowance(r, []).total, t);
eq("allowance unknown rank -> global", P.allowance("zz", []).total, 2);
eq("allowance used counts only start", P.allowance("cosmic", [{ source: "start", count: 1 }, { source: "karma", count: 1 }, { source: "start", count: 2 }]), { total: 3, used: 3, left: 0, over: 0 });
eq("allowance over", P.allowance("street", { a: { source: "start", count: 2 } }).over, 1);
eq("allowance teen left 0", P.allowance("teen", []).left, 0);

/* ---- training, stats */
eq("train 10/0.1", P.trainedCost(10, 0.1), 9); eq("train 20/0.1", P.trainedCost(20, 0.1), 18);
eq("train 10/0.2", P.trainedCost(10, 0.2), 8); eq("train 20/0.2", P.trainedCost(20, 0.2), 16);
eq("factor none", P.trainingFactor([]), 0);
eq("factor facilities", P.trainingFactor([{ key: "training-facilities", status: "active" }]), 0.1);
eq("factor simulator wins", P.trainingFactor([{ key: "training-facilities", status: "active" }, { key: "training-simulator", status: "active" }]), 0.2);
eq("factor ignores broken", P.trainingFactor([{ key: "training-simulator", status: "broken" }, { key: "training-facilities", status: "active" }]), 0.1);
const ts = P.teamStats([{ name: "A", reputation: 2, resources: 6, karma: 4, occupation: "Medic" }, { name: "B", reputation: 5, resources: 3, karma: 7, occupation: "Medic" }]);
eq("teamStats rep", ts.maxReputation, { value: 5, who: "B" }); eq("teamStats res", ts.maxResources, { value: 6, who: "A" });
eq("teamStats pool", ts.karmaPool, 11); eq("teamStats occupations dedup", ts.occupations, ["Medic"]);
eq("teamStats empty", P.teamStats([]).karmaPool, 0);
const vb = { passengers: 4, maneuverability: 1, speed: 3, durability: 10, armor: 2 };
let vs = P.vehicleStats(vb, [{ key: "vehicle-defense", count: 2, status: "active" }]);
eq("vehicle defense dur", vs.durability, { base: 10, bonus: 4, total: 14 }); eq("vehicle defense armor", vs.armor.total, 4);
vs = P.vehicleStats(vb, [{ key: "vehicle-mobility", count: 1, status: "active" }]);
eq("vehicle mobility", [vs.maneuverability.total, vs.speed.total], [2, 4]);
vs = P.vehicleStats(vb, [{ key: "vehicle-room", count: 1, status: "active" }]);
eq("vehicle room doubles", vs.passengers.total, 8);
vs = P.vehicleStats(vb, [{ key: "vehicle-room", count: 3, status: "active" }]);
eq("vehicle room once only", vs.passengers.total, 8);
vs = P.vehicleStats(vb, [{ key: "vehicle-defense", count: 2, status: "broken" }, { key: "vehicle-mobility", count: 1, status: "disabled" }]);
eq("inactive upgrades add nothing", [vs.durability.bonus, vs.speed.bonus], [0, 0]);
eq("vehicleStats empty base", P.vehicleStats({}, []).speed, { base: 0, bonus: 0, total: 0 });

/* ---- karma split: examples + properties */
const hs = (...k) => k.map((x, i) => ({ id: `h${i}`, karma: x }));
const sum = (pl) => pl.reduce((s, x) => s + x.amount, 0);
eq("karma even 2", P.planKarma(hs(10, 10), 10), [{ actorId: "h0", amount: 5 }, { actorId: "h1", amount: 5 }]);
eq("karma capped", P.planKarma(hs(2, 20), 10), [{ actorId: "h0", amount: 2 }, { actorId: "h1", amount: 8 }]);
eq("karma remainder to richest", P.planKarma(hs(5, 9, 6), 10).map((x) => x.amount), [3, 4, 3]);
eq("karma short -> null", P.planKarma(hs(3, 3), 10), null);
eq("karma exact total", sum(P.planKarma(hs(4, 6), 10)), 10);
eq("karma single hero", P.planKarma(hs(12), 10), [{ actorId: "h0", amount: 10 }]);
eq("karma zero cost", P.planKarma(hs(3), 0), []);
eq("karma no heroes", P.planKarma([], 10), null);
eq("karma negative karma = 0", P.planKarma(hs(-5, 10), 10), [{ actorId: "h1", amount: 10 }]);
eq("karma dup ids -> null", P.planKarma([{ id: "a", karma: 9 }, { id: "a", karma: 9 }], 10), null);
eq("karma non-int cost -> null", P.planKarma(hs(9, 9), 10.5), null);
eq("karma bad input -> null", P.planKarma(null, 10), null);
eq("karma 20 split", P.planKarma(hs(20, 20, 20), 20).map((x) => x.amount).sort(), [6, 7, 7]);
{
  const rng = seeded(42); let bad = 0, nulls = 0, oks = 0, nonDet = 0;
  for (let t = 0; t < 2000; t++) {
    const k = 1 + Math.floor(rng() * 6);
    const m = Array.from({ length: k }, (_, i) => ({ id: `p${i}`, karma: Math.floor(rng() * 25) }));
    const cost = [0, 10, 20, 10 + Math.floor(rng() * 30)][Math.floor(rng() * 4)];
    const total = m.reduce((s, x) => s + x.karma, 0);
    const pl = P.planKarma(m, cost);
    if (pl === null) { nulls++; if (total >= cost) bad++; continue; }
    oks++;
    if (total < cost) bad++;
    if (sum(pl) !== cost) bad++;
    for (const x of pl) { const h = m.find((y) => y.id === x.actorId); if (!h || x.amount > h.karma || x.amount <= 0 || !Number.isInteger(x.amount)) bad++; }
    if (JSON.stringify(pl) !== JSON.stringify(P.planKarma(m, cost))) nonDet++;
    // fairness: max-min of amounts among heroes with spare capacity is <= 1
    const spare = m.filter((h) => (pl.find((x) => x.actorId === h.id)?.amount ?? 0) < h.karma).map((h) => pl.find((x) => x.actorId === h.id)?.amount ?? 0);
    if (spare.length > 1 && Math.max(...spare) - Math.min(...spare) > 1) bad++;
  }
  eq("karma property: 0 violations in 2000", bad, 0); eq("karma property: deterministic", nonDet, 0);
  ck("karma property: both branches hit", oks > 300 && nulls > 50);
}
eq("validateSplit ok", P.validateSplit([{ actorId: "h0", amount: 4 }, { actorId: "h1", amount: 6 }], hs(5, 9), 10).ok, true);
eq("validateSplit mismatch", P.validateSplit([{ actorId: "h0", amount: 4 }], hs(5, 9), 10).missing, 6);
eq("validateSplit over karma", P.validateSplit([{ actorId: "h0", amount: 6 }, { actorId: "h1", amount: 4 }], hs(5, 9), 10).errors[0].key, "IPB.Karma.overKarma");
eq("validateSplit unknown hero", P.validateSplit([{ actorId: "zz", amount: 10 }], hs(5), 10).errors[0].key, "IPB.Karma.unknownHero");
eq("validateSplit negative", P.validateSplit([{ actorId: "h0", amount: -1 }], hs(5), 0).errors[0].key, "IPB.Karma.badAmount");
eq("validateSplit planKarma output valid", P.validateSplit(P.planKarma(hs(7, 7, 7), 10), hs(7, 7, 7), 10).ok, true);

/* ---- event bands */
const ranges = [[11, 36], [41, 43], [44, 45], [46, 52], [53, 56], [61, 63], [64, 65], [66, 66]];
const rb = P.resolveBands(ranges);
ck("resolveBands ok", rb.ok); eq("resolveBands ids", rb.bands.map((b) => b.id), Object.keys(P.BAND_CONFIG.bands));
ck("resolveBands unordered input ok", P.resolveBands([...ranges].reverse()).ok);
ck("resolveBands reflowed high end still ok", P.resolveBands([[11, 40], [41, 43], [44, 45], [46, 52], [53, 60], [61, 63], [64, 65], [66, 66]]).ok);
for (const bad of [null, [], [[11, 36]], [[1, 2], [3, 4]], "x", [["a", "b"]], [...ranges, [67, 70]]]) ck(`resolveBands mismatch ${JSON.stringify(bad)} -> not ok`, P.resolveBands(bad).ok === false);
eq("resolveBands unknown reason", P.resolveBands([[11, 36]]).reason, "bandsMismatch");
eq("expected lowers", P.EXPECTED_LOWERS, [11, 41, 44, 46, 53, 61, 64, 66]);
// every legal D66 value falls in a band or a gap (37..40 etc are not D66 values)
const legal = []; for (let t = 1; t <= 6; t++) for (let o = 1; o <= 6; o++) legal.push(t * 10 + o);
eq("36 legal D66", legal.length, 36);
ck("all legal D66 map to a band", legal.every((r) => P.bandForRoll(r) !== null));
eq("band 11", P.bandForRoll(11), "11-36"); eq("band 36", P.bandForRoll(36), "11-36"); eq("band 41", P.bandForRoll(41), "41-43");
eq("band 45", P.bandForRoll(45), "44-45"); eq("band 46", P.bandForRoll(46), "46-52"); eq("band 52", P.bandForRoll(52), "46-52");
eq("band 53", P.bandForRoll(53), "53-56"); eq("band 56", P.bandForRoll(56), "53-56"); eq("band 63", P.bandForRoll(63), "61-63");
eq("band 65", P.bandForRoll(65), "64-65"); eq("band 66", P.bandForRoll(66), "66-66");
eq("non-D66 values -> null", [0, 10, 37, 47, 67, 77, 100, -1, 1.5, "46", null].map((x) => P.bandForRoll(x)), Array(11).fill(null));
eq("isD66 count", Array.from({ length: 100 }, (_, i) => i).filter(P.isD66).length, 36);
eq("d66()", [P.d66(4, 6), P.d66(0, 1), P.d66(7, 1), P.d66(1, 7), P.d66("1", 1)], [46, null, null, null, null]);
eq("bandEffect disable", P.bandEffect("46-52").effect, "disable");
eq("bandEffect by lower bound (reflow)", P.bandEffect("46-50").effect, "disable");
eq("bandEffect unknown -> text", P.bandEffect("90-99").effect, "text");
ck("knownBand", P.knownBand("53-60") && !P.knownBand("90-99"));
const ups = [{ id: "a", status: "active" }, { id: "b", status: "active" }, { id: "c", status: "active" }, { id: "d", status: "installing" }, { id: "x", status: "broken" }, { id: "y", status: "disabled" }];
{
  const rng = seeded(7); const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const ef = P.proposeEffect("46-52", ups, { rng });
    ck("disable: never applied", ef.applied === false && ef.kind === "disable");
    ck("disable: only active upgrades", ef.upgrades.every((u) => ["a", "b", "c"].includes(u)));
    ck("disable: distinct", new Set(ef.upgrades).size === ef.upgrades.length);
    ck("disable: count = min(d6, active)", ef.upgrades.length === Math.min(ef.rolled, 3) && ef.rolled >= 1 && ef.rolled <= 6);
    seen.add(ef.rolled);
  }
  ck("disable: all d6 values seen", seen.size === 6);
}
{
  const rng = seeded(9); let ok = true;
  for (let i = 0; i < 200; i++) { const ef = P.proposeEffect("53-56", ups, { rng }); if (ef.upgrades.length !== 1 || !["a", "b", "c", "d"].includes(ef.upgrades[0])) ok = false; }
  ck("break: exactly one active/installing", ok);
  eq("break with nothing to break", P.proposeEffect("53-56", [{ id: "x", status: "broken" }]).upgrades, []);
  eq("disable with nothing active", P.proposeEffect("46-52", [{ id: "x", status: "broken" }], { rng }).upgrades, []);
  let r3 = true; for (let i = 0; i < 200; i++) { const ef = P.proposeEffect("61-63", ups, { rng }); if (ef.raid < 3 || ef.raid > 18 || ef.kind !== "raid") r3 = false; }
  ck("raid is 3d6 in 3..18", r3);
}
eq("occupy proposal", P.proposeEffect("66-66", ups).kind, "occupy");
eq("none proposal", P.proposeEffect("11-36", ups).kind, "none");
eq("note proposal", P.proposeEffect("41-43", ups).kind, "note");
eq("ai proposal", P.proposeEffect("64-65", ups).kind, "aiControl");
eq("unknown band -> null (text only)", P.proposeEffect("90-99", ups), null);
eq("bands mismatch fallback -> null", P.proposeEffect("46-52", ups, { bandsOk: false }), null);
const Bx = P.normalize({ upgrades: { a: { name: "A" }, b: { name: "B" } } });
eq("effectPatch disable", P.effectPatch({ kind: "disable", upgrades: ["a", "b", "ghost"] }, Bx), { "upgrades.a.status": "disabled", "upgrades.b.status": "disabled" });
eq("effectPatch break", P.effectPatch({ kind: "break", upgrades: ["a"] }, Bx), { "upgrades.a.status": "broken" });
eq("effectPatch occupy", P.effectPatch({ kind: "occupy", upgrades: [] }, Bx), { "base.occupied": true });
eq("effectPatch raid is empty", P.effectPatch({ kind: "raid", raid: 9, upgrades: [] }, Bx), {});
eq("effectPatch null", P.effectPatch(null, Bx), {});
{
  const evs = Object.fromEntries(Array.from({ length: 205 }, (_, i) => [`e${i}`, { at: i, sort: i }]));
  const pr = P.pruneEvents(evs); eq("prune count", pr.length, 5); eq("prune oldest first", pr.slice(0, 2), ["e0", "e1"]);
  eq("prune none under cap", P.pruneEvents({ a: { at: 1 } }), []);
}

/* ---- hero text mirror + round trip */
const cat = NAMES.map((name) => ({ name, key: P.slug(name) }));
const B1 = P.normalize({ name: "Team X", base: { kind: "attic hideout", where: "Docks" }, upgrades: {
  a: { key: "team-vehicle", name: "Team Vehicle", sort: 1 }, b: { key: "concealment", name: "Concealment", count: 2, sort: 2 },
  c: { key: "power-effect", name: "Power Effect", power: "Flight, Strike", sort: 3 }, d: { key: "custom", name: "Odd Gadget", sort: 4 } } });
const tb = P.formatTeamBase(B1);
eq("formatTeamBase", tb, "attic hideout, Docks; upgrades: Team Vehicle, Concealment x2, Power Effect (Flight, Strike), Odd Gadget");
const pb = P.parseTeamBase(tb, cat);
eq("parse kind/where", [pb.kind, pb.where], ["attic hideout", "Docks"]);
eq("round trip upgrades (count/power/custom)", pb.upgrades.map((u) => [u.key, u.name, u.count, u.power]), [["team-vehicle", "Team Vehicle", 1, ""], ["concealment", "Concealment", 2, ""], ["power-effect", "Power Effect", 1, "Flight, Strike"], ["custom", "Odd Gadget", 1, ""]]);
eq("format(parse(x)) fixed point", P.formatTeamBase({ base: pb, upgrades: Object.fromEntries(pb.upgrades.map((u, i) => [`k${i}`, { ...u, sort: i }])) }), tb);
eq("no upgrades", P.formatTeamBase(P.normalize({ base: { kind: "k" } })), "k");
eq("only upgrades", P.formatTeamBase(P.normalize({ upgrades: { a: { name: "Workshop" } } })), "upgrades: Workshop");
eq("empty", P.formatTeamBase(P.normalize({})), "");
eq("parse chargen-style text", P.parseTeamBase("planetary capitol building; upgrades: team vehicle", cat).upgrades[0].key, "team-vehicle");
eq("parse case-insens + keeps catalog name", P.parseTeamBase("; Upgrades: WORKSHOP", cat).upgrades[0].name, "Workshop");
eq("parse x with unicode times", P.parseTeamBase("upgrades: Concealment ×3", cat).upgrades[0].count, 3);
eq("parse empty/garbage", P.parseTeamBase(undefined, cat), { kind: "", where: "", upgrades: [] });
eq("parse no catalog -> custom", P.parseTeamBase("k; upgrades: Foo", []).upgrades[0].key, "custom");
eq("parse multiline whitespace", P.parseTeamBase("a\n  b ,  c;\nupgrades:  Workshop ,Laboratory", cat).upgrades.length, 2);
eq("parse trailing commas", P.parseTeamBase("k; upgrades: Workshop,, ,", cat).upgrades.length, 1);
eq("kind with comma limitation documented", P.parseTeamBase("a, b, c", cat).where, "b, c");
eq("formatUpgrade fallback key", P.formatUpgrade({ key: "workshop" }), "workshop");
eq("formatTeam", P.formatTeam({ name: " Team X " }), "Team X");
eq("parseTeam first non-empty line", P.parseTeam("\n  \n Defiance Alliance \nsecond"), "Defiance Alliance");
eq("parseTeam empty", P.parseTeam(undefined), "");
eq("mirror same", P.mirrorAction("a", "x", "a"), "same");
eq("mirror push when equals last pushed", P.mirrorAction("old", "old", "new"), "push");
eq("mirror push when empty", P.mirrorAction("", "", "new"), "push");
eq("mirror conflict", P.mirrorAction("mine", "old", "new"), "conflict");
eq("mirror trims", P.mirrorAction(" a ", "", "a"), "same");
{ // randomized round trip
  const rng = seeded(11); let bad = 0;
  for (let t = 0; t < 300; t++) {
    const ups2 = {}; const k = Math.floor(rng() * 6);
    for (let i = 0; i < k; i++) { const nm2 = NAMES[Math.floor(rng() * NAMES.length)]; ups2[`i${i}`] = { key: P.slug(nm2), name: nm2, count: 1 + Math.floor(rng() * 3), power: nm2 === "Power Effect" && rng() < 0.7 ? ["Flight", "Strike (Major)", "Size, Alteration"][Math.floor(rng() * 3)] : "", sort: i }; }
    const B = P.normalize({ base: { kind: rng() < 0.8 ? "den" : "", where: rng() < 0.5 ? "pier" : "" }, upgrades: ups2 });
    const r = P.parseTeamBase(P.formatTeamBase(B), cat);
    const want = P.sortedList(B.upgrades).map((u) => [u.key, u.count, u.power]);
    const got = r.upgrades.map((u) => [u.key, u.count, u.power]);
    if (JSON.stringify(want) !== JSON.stringify(got) || r.kind !== B.base.kind && !(B.base.kind === "" && B.base.where !== "")) bad++;
    if (B.base.kind && r.where !== B.base.where) bad++;
  }
  eq("round trip property: 0 failures in 300", bad, 0);
}

/* ---- snapshot, size guard, limits, validation */
const snap = P.stripSnapshot({ _id: "x", name: "Rope", ownership: { default: 3 }, _stats: {}, sort: 5, folder: "f", effects: [{ _id: "e", origin: "o", name: "fx" }], system: { cost: 1 } });
eq("strip removes volatile", Object.keys(snap).sort(), ["effects", "name", "system"]);
eq("strip effects", snap.effects, [{ name: "fx" }]);
eq("strip does not mutate", (() => { const o = { _id: "q", effects: [{ _id: "z" }] }; P.stripSnapshot(o); return o.effects[0]._id; })(), "z");
eq("strip bad input", P.stripSnapshot(null), {});
ck("byteSize counts utf8", P.byteSize({ a: "ą" }) > JSON.stringify({ a: "a" }).length);
ck("sizeGuard ok on default", P.sizeGuard(d).ok);
ck("sizeGuard fails when huge", !P.sizeGuard(P.normalize({ crate: { a: { name: "x".repeat(P.LIMITS.bytes + 5) } } })).ok);
ck("sizeGuard extraBytes", !P.sizeGuard(d, P.LIMITS.bytes).ok);
ck("canAdd under cap", P.canAdd(d, "crate").ok);
eq("canAdd at cap", P.canAdd({ crate: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [i, {}])) }, "crate").key, "IPB.Err.crateFull");
eq("canAdd upgrades cap 40", P.canAdd({ upgrades: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, {}])) }, "upgrades").ok, false);
eq("validate default has only nameEmpty", P.validate(d).map((m) => m.key), ["IPB.Val.nameEmpty"]);
eq("validate non-object", P.validate(5)[0].key, "IPB.Val.notObject");
{
  const v = P.validate({ name: "T", rank: "zz", upgrades: { a: { status: "x", count: 0, source: "q" }, b: "bad" }, events: { e: { roll: 47, band: "99-99" } }, policy: { edit: "no" }, v: 5 });
  const keys = v.map((m) => m.key);
  for (const k of ["IPB.Val.rank", "IPB.Val.upgradeStatus", "IPB.Val.upgradeCount", "IPB.Val.upgradeSource", "IPB.Val.entry", "IPB.Val.rollRange", "IPB.Val.bandUnknown", "IPB.Val.policy", "IPB.Val.newerVersion"]) ck(`validate emits ${k}`, keys.includes(k));
  ck("validate messages are keys", v.every((m) => /^IPB\.[A-Za-z]+\.[A-Za-z]+$/.test(m.key) && (m.level === "error" || m.level === "warn")));
}
eq("validate start over allowance (warn)", P.validate({ name: "T", rank: "teen", upgrades: { a: { source: "start" } } }).find((m) => m.key === "IPB.Val.startOverAllowance").level, "warn");
ck("validate cap error", P.validate({ name: "T", crate: Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`c${i}`, { name: "x" }])) }).some((m) => m.key === "IPB.Err.crateFull" && m.level === "error"));
ck("validate too big", P.validate({ name: "T", crate: { a: { name: "x".repeat(P.LIMITS.bytes + 1) } } }).some((m) => m.key === "IPB.Err.tooBig"));
ck("validate two primary vehicles warns", P.validate({ name: "T", vehicles: { a: { primary: true }, b: { primary: true } } }).some((m) => m.key === "IPB.Val.manyPrimaryVehicles"));
ck("validate tracker over max warns", P.validate({ name: "T", trackers: { a: { value: 5, max: 3 } } }).some((m) => m.key === "IPB.Val.trackerOverMax"));
ck("validate never throws on junk", (() => { try { for (const j of [null, undefined, [], "s", { upgrades: null, events: 5, vehicles: [], crate: "x" }]) P.validate(j); return true; } catch { return false; } })());
ck("clampText", P.clampText("abcdef", 3) === "abc" && P.clampText(null) === "");

/* ---- B4b: card -> host actor data */
{
  const cfg = { type: "vehicle", folder: "F1", defaultImg: "icons/x.webp", sheetClass: "invincible-plus-ultra.BaseSheet" };
  const j = { id: "J1", name: " Alpha ", ownership: { default: 2 }, flags: { "invincible-plus-ultra": { base: { v: 1, rank: "street", img: "art/a.webp", upgrades: { u1: { key: "concealment", name: "Concealment", count: 1, status: "active", source: "start" } }, mystery: 7 } } } };
  const a = P.cardActorData(j, cfg);
  eq("cardActorData name trimmed", a.name, "Alpha");
  eq("cardActorData type / folder", [a.type, a.folder], ["vehicle", "F1"]);
  eq("cardActorData img from B.img", a.img, "art/a.webp");
  eq("cardActorData marker", a.flags["invincible-plus-ultra"].base.kind, "teamBase");
  eq("cardActorData B.img emptied", a.flags["invincible-plus-ultra"].base.img, "");
  eq("cardActorData keeps data", [a.flags["invincible-plus-ultra"].base.rank, Object.keys(a.flags["invincible-plus-ultra"].base.upgrades), a.flags["invincible-plus-ultra"].base.mystery], ["street", ["u1"], 7]);
  eq("cardActorData sheet override", a.flags.core.sheetClass, cfg.sheetClass);
  eq("cardActorData remembers old id", a.flags["invincible-plus-ultra"].migratedFrom, "J1");
  eq("cardActorData token", [a.prototypeToken.actorLink, a.prototypeToken.name, a.prototypeToken.texture.src], [true, "Alpha", "art/a.webp"]);
  eq("cardActorData ownership default", a.ownership.default, 2);
  const e = P.cardActorData({ name: "", flags: {} }, cfg);
  eq("cardActorData empty entry", [e.name, e.img, e.flags["invincible-plus-ultra"].base.rank, e.flags["invincible-plus-ultra"].base.kind], ["Team", "icons/x.webp", "global", "teamBase"]);
  eq("cardActorData idempotent normalize", P.normalize(a.flags["invincible-plus-ultra"].base).kind, "teamBase");
  ck("cardActorData never throws on junk", (() => { try { for (const q of [null, undefined, 5, { flags: 7 }]) P.cardActorData(q, cfg); return true; } catch { return false; } })());
  ck("isDefaultArt", P.isDefaultArt("", []) && P.isDefaultArt("systems/invincible/assets/icons/vehicle.svg", ["vehicle.svg"]) && P.isDefaultArt("icons/x.webp", ["icons/x.webp"]) && !P.isDefaultArt("art/a.webp", ["vehicle.svg"]) && !P.isDefaultArt("art/not-vehicle.svgx", ["vehicle.svg"]));
  ck("TEAM_BASE_KIND", P.TEAM_BASE_KIND === "teamBase");
}

if (fails.length) { console.error(`FAILED ${fails.length}/${n}:\n - ${fails.join("\n - ")}`); process.exit(1); }
if (n < 120) { console.error(`only ${n} checks (<120)`); process.exit(1); }
console.log(`OK ${n} checks`);
