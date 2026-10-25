// node scripts/base/check-up.mjs  -> prints "OK <n> checks" or exits 1. Pure helpers of the Upgrades tab (up-pure.mjs). Fixtures are SHAPE-only (no book prose).
import * as P from "./pure.mjs";
import * as U from "./up-pure.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let n = 0; const fails = [];
const ck = (name, cond) => { n++; if (!cond) fails.push(name); };
const eq = (name, a, b) => ck(`${name}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`, JSON.stringify(a) === JSON.stringify(b));

const src = readFileSync(fileURLToPath(new URL("./up-pure.mjs", import.meta.url)), "utf8").replace(/\/\/.*$/gm, "").replace(/"[^"\n]*"/g, '""').replace(/`[^`]*`/g, "``");
for (const g of ["game.", "foundry.", "ui.", "canvas.", "Hooks.", "CONFIG.", "document.", "window.", "fromUuid", "Actor"]) ck(`up-pure.mjs must not reference ${g}`, !new RegExp(`(^|[^\\w.])${g.replace(".", "\\.")}`, "m").test(src));

// a small catalog built the way catalog.mjs builds entries (shape only)
const names = ["Concealment", "Team Vehicle", "Laboratory", "Vehicle Defense", "Power Effect", "Training Facilities", "Training Simulator", "Workshop"];
const mk = (name, pre, stack = { max: 1, perPower: false }) => ({ key: P.slug(name), name, prereqRaw: pre, prereq: P.parsePrerequisite(`Prerequisite: ${pre}`, names), max: stack.max, perPower: stack.perPower, gm: false, effect: `${name} does something.` });
const C = {
  concealment: mk("Concealment", "-", { max: 2, perPower: false }), tv: mk("Team Vehicle", "-"), lab: mk("Laboratory", "Resources 6, Scientist or Technician"),
  vd: mk("Vehicle Defense", "Team Vehicle", { max: 2, perPower: false }), pe: mk("Power Effect", "Resources 7", { max: 4, perPower: true }), tf: mk("Training Facilities", "-"), ts: mk("Training Simulator", "Training Facilities"),
  ws: mk("Workshop", "Resources 4 or Blue Collar")
};
const M = (resources, occupation = "", karma = 0, id, name) => ({ id: id ?? `h${resources}${occupation}`, name: name ?? `H${resources}`, resources, occupation, karma });
const up = (key, o = {}) => ({ id: o.id ?? `u-${key}`, key, name: o.name ?? key, count: o.count ?? 1, power: o.power ?? "", status: o.status ?? "active", source: o.source ?? "start", paid: 0, ...o });

/* ---- shownStatus / ownedCount */
eq("status plain", U.shownStatus({ status: "broken" }), "broken");
eq("status lost when occupied", U.shownStatus({ status: "active" }, true), "lost");
eq("status junk -> active", U.shownStatus({ status: "x" }), "active");
eq("status null row", U.shownStatus(null), "active");
eq("ownedCount sums", U.ownedCount([up("a", { count: 2 }), up("b")]), 3);
eq("ownedCount map", U.ownedCount({ a: { count: 3 }, b: {} }), 4);
eq("ownedCount empty", U.ownedCount([]), 0);
eq("ownedCount junk", U.ownedCount(null), 0);

/* ---- catalogState: prerequisite met / unmet / Too Pricey / blocked */
const base = { members: [M(5, "Technician")], owned: [], power: "", staff: false, left: 2, canEdit: true };
let s = U.catalogState(C.concealment, base);
eq("no prerequisite: met", s.state, "met"); eq("no prerequisite: cost 10", s.cost.cost, 10); ck("no prereq: start ok", s.start.ok); ck("no prereq: buy ok", s.buy.ok);
s = U.catalogState(C.lab, base);
eq("occupation met", s.state, "met"); ck("occupation met: reasons", s.ev.reasons.some((r) => r.key === "IPB.Up.preOccupationMet"));
s = U.catalogState(C.lab, { ...base, members: [M(5, "Baker")] });
eq("group unmet -> tooPricey", s.state, "tooPricey"); eq("tooPricey cost 20", s.cost.cost, 20); eq("tooPricey kind", s.cost.kind, "tooPricey");
ck("tooPricey: a player cannot pick it as starting", !s.start.ok && s.start.why.key === "IPB.Up.startTooPricey");
ck("tooPricey: a player may buy", s.buy.ok);
s = U.catalogState(C.lab, { ...base, members: [M(5, "Baker")], staff: true });
ck("tooPricey: staff may pick it as starting", s.start.ok); ck("tooPricey: staff may grant", s.grant.ok);
s = U.catalogState(C.vd, base);
eq("upgrade prerequisite missing -> blocked", s.state, "blocked"); ck("blocked: cost blocked", s.cost.blocked); ck("blocked: buy refused with reason", !s.buy.ok && s.buy.why.key === "IPB.Up.blocked");
ck("blocked is NOT Too Pricey", !s.ev.tooPricey);
ck("blocked: player start refused", !s.start.ok);
s = U.catalogState(C.vd, { ...base, owned: [up("team-vehicle", { name: "Team Vehicle" })] });
eq("upgrade prerequisite owned -> met", s.state, "met");
s = U.catalogState(C.vd, { ...base, owned: [up("team-vehicle", { name: "Team Vehicle", status: "broken" })] });
eq("broken prerequisite upgrade -> blocked", s.state, "blocked");
s = U.catalogState(C.vd, { ...base, owned: [up("team-vehicle", { name: "Team Vehicle", status: "disabled" })] });
eq("disabled prerequisite upgrade still meets", s.state, "met");
s = U.catalogState(C.ts, { ...base, owned: [up("training-facilities", { name: "Training Facilities" })] });
eq("simulator needs facilities: met", s.state, "met");
s = U.catalogState(C.ts, base);
eq("simulator without facilities: blocked", s.state, "blocked");
s = U.catalogState(C.ws, { ...base, members: [M(3, "Blue Collar worker")] });
eq("Blue Collar occupation matches", s.state, "met");
s = U.catalogState(C.ws, { ...base, members: [] });
eq("no heroes: group unmet -> tooPricey", s.state, "tooPricey");
const unreadable = { key: "odd", name: "Odd", prereqRaw: "???;", prereq: P.parsePrerequisite("???;", []), max: 1, perPower: false, effect: "" };
s = U.catalogState(unreadable, base);
eq("unreadable prerequisite -> unknown", s.state, "unknown"); eq("unknown cost is 10", s.cost.cost, 10); ck("unknown: buy still allowed (GM decides)", s.buy.ok);
s = U.catalogState({ key: "custom", name: "x" }, base);
eq("custom upgrade: met", s.state, "met"); eq("custom cost 10", s.cost.cost, 10);

/* ---- stacking */
s = U.catalogState(C.concealment, { ...base, owned: [up("concealment")] });
eq("second Concealment ok", s.stack.ok, true); eq("count 1", s.stack.count, 1);
s = U.catalogState(C.concealment, { ...base, owned: [up("concealment", { count: 2 })] });
eq("third Concealment -> maxed", s.state, "maxed"); ck("maxed: start refused", !s.start.ok && s.start.why.key === "IPB.Up.stackMax");
ck("maxed: buy refused", !s.buy.ok); ck("maxed: player cannot grant", !s.grant.ok);
s = U.catalogState(C.concealment, { ...base, staff: true, owned: [up("concealment", { count: 2 })] });
ck("maxed: staff grant still possible", s.grant.ok); ck("maxed: staff start refused (limit)", !s.start.ok);
s = U.catalogState(C.tv, { ...base, owned: [up("team-vehicle")] });
eq("once-only upgrade owned -> maxed", s.state, "maxed");
s = U.catalogState(C.pe, { ...base, members: [M(7)], power: "Flight", owned: [up("power-effect", { power: "Flight", count: 4 })] });
eq("Power Effect x4 same power -> maxed", s.state, "maxed");
s = U.catalogState(C.pe, { ...base, members: [M(7)], power: "Flight", owned: [up("power-effect", { power: "Flight", count: 3 })] });
eq("Power Effect x3 same power -> ok", s.state, "met");
s = U.catalogState(C.pe, { ...base, members: [M(7)], power: "Strike", owned: [up("power-effect", { power: "Flight", count: 4 })] });
eq("Power Effect for ANOTHER power starts from zero", [s.state, s.stack.count], ["met", 0]);
s = U.catalogState(C.pe, { ...base, members: [M(7)], power: "  ", owned: [] });
ck("Power Effect without a power: needPower, start refused", s.needPower && !s.start.ok && s.start.why.key === "IPB.Up.needPower");
ck("Power Effect without a power: buy and grant refused", !s.buy.ok && !U.catalogState(C.pe, { ...base, staff: true, members: [M(7)], power: "" }).grant.ok);
s = U.catalogState(C.pe, { ...base, members: [M(7)], power: "flight", owned: [up("power-effect", { power: "Flight", count: 4 })] });
eq("power compare is case-insensitive", s.state, "maxed");

/* ---- starting allowance in the buttons */
s = U.catalogState(C.concealment, { ...base, left: 0 });
ck("no allowance left: start refused with reason", !s.start.ok && s.start.why.key === "IPB.Up.noAllowance"); ck("no allowance left: buy still fine", s.buy.ok);
s = U.catalogState(C.concealment, { ...base, canEdit: false });
ck("read only: nothing allowed", !s.start.ok && !s.buy.ok && !s.grant.ok && s.start.why.key === "IPB.Up.readOnly");
eq("allowance per rank (pure.mjs)", P.RANKS.map((r) => P.allowance(r, []).total), [0, 1, 2, 3]);
eq("allowance counts stack of start rows", P.allowance("global", [up("a", { count: 2 }), up("b", { source: "karma" })]).left, 0);
s = U.catalogState(C.concealment, { ...base, left: undefined });
ck("undefined allowance = none left", !s.start.ok);

/* ---- adoption from hero text */
const parsed = P.parseTeamBase("antique shop, top floor; upgrades: Concealment x2, Team Vehicle, Power Effect (Flight), Secret Lair", names.map((x) => ({ key: P.slug(x), name: x })));
eq("parse names", parsed.upgrades.map((u) => u.name), ["Concealment", "Team Vehicle", "Power Effect", "Secret Lair"]);
eq("missing from empty card", U.missingFromText(parsed.upgrades, []).map((u) => `${u.key}:${u.count}:${u.power}`), ["concealment:2:", "team-vehicle:1:", "power-effect:1:Flight", "custom:1:"]);
eq("missing keeps only the gap", U.missingFromText(parsed.upgrades, [up("concealment"), up("team-vehicle")]).map((u) => `${u.key}:${u.count}`), ["concealment:1", "power-effect:1", "custom:1"]);
eq("nothing missing", U.missingFromText(parsed.upgrades, [up("concealment", { count: 2 }), up("team-vehicle"), up("power-effect", { power: "flight" }), up("custom", { name: "secret lair" })]), []);
eq("power must match", U.missingFromText([{ key: "power-effect", name: "Power Effect", count: 1, power: "Flight" }], [up("power-effect", { power: "Strike" })]).length, 1);
eq("custom matched by name", U.missingFromText([{ key: "custom", name: "Secret Lair", count: 1, power: "" }], [up("custom", { name: "SECRET LAIR" })]), []);
eq("missing junk-safe", U.missingFromText(null, null), []);
const un = U.unionAdoptions([[{ key: "concealment", name: "Concealment", count: 2, power: "" }, { key: "custom", name: "Lair", count: 1 }], [{ key: "concealment", name: "Concealment", count: 1 }, { key: "custom", name: "LAIR", count: 3 }]]);
eq("union: one per upgrade, highest count", un.map((u) => `${u.key}:${u.name}:${u.count}`), ["concealment:Concealment:2", "custom:Lair:3"]);
eq("union empty", U.unionAdoptions([]), []);
eq("union junk", U.unionAdoptions([null, undefined, [null]].map((x) => x ?? [])), []);

/* ---- split text, karma preview */
const nm = { a: "Tess", b: "Rex" };
eq("formatSplit by ids", U.formatSplit([{ actorId: "a", amount: 6 }, { actorId: "b", amount: 4 }], nm), "Tess 6, Rex 4");
eq("formatSplit skips zero", U.formatSplit([{ actorId: "a", amount: 0 }, { actorId: "b", amount: 4 }], new Map(Object.entries(nm))), "Rex 4");
eq("formatSplit name wins", U.formatSplit([{ id: "z", name: "Zed", amount: 2 }]), "Zed 2");
eq("formatSplit empty", U.formatSplit([]), "");
const pm = U.previewKarma([M(1, "", 6, "a", "Tess"), M(1, "", 3, "b", "Rex"), M(1, "", 0, "c", "Zed")], [{ actorId: "a", amount: 6 }, { actorId: "b", amount: 1 }]);
eq("preview after", pm.map((x) => x.after), [0, 2, 0]); eq("preview amount", pm.map((x) => x.amount), [6, 1, 0]);
// the dialog default split always sums to the cost or is null (property: 300 random teams)
{
  let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let bad = 0;
  for (let i = 0; i < 300; i++) {
    const mem = Array.from({ length: 1 + Math.floor(rnd() * 5) }, (_x, k) => M(1, "", Math.floor(rnd() * 12), `m${k}`, `H${k}`));
    const cost = rnd() < 0.5 ? 10 : 20;
    const plan = P.planKarma(mem.map((m) => ({ id: m.id, karma: m.karma })), cost);
    const pool = mem.reduce((s, m) => s + m.karma, 0);
    if (pool < cost) { if (plan !== null) bad++; continue; }
    if (!plan || plan.reduce((s, x) => s + x.amount, 0) !== cost) { bad++; continue; }
    const pv = U.previewKarma(mem, plan);
    if (pv.some((x) => x.after < 0)) bad++;
    if (!P.validateSplit(plan, mem, cost).ok) bad++;
  }
  eq("default split property (300 random teams)", bad, 0);
}

/* ---- purchase log */
const withBuys = [
  up("laboratory", { id: "l", name: "Laboratory", source: "karma", at: 300, paid: 10, buys: [{ at: 300, paid: 10, kind: "normal", split: [{ name: "Tess", amount: 10 }] }] }),
  up("concealment", { id: "c", name: "Concealment", source: "karma", at: 100, paid: 20, count: 2, buys: [{ at: 100, paid: 10, split: [] }, { at: 200, paid: 10, split: [{ name: "Rex", amount: 10 }] }] }),
  up("workshop", { id: "w", name: "Workshop", source: "karma", at: 50, paid: 10 }),
  up("team-vehicle", { id: "t", name: "Team Vehicle", source: "start", at: 400 })
];
const log = U.purchaseLog(withBuys);
eq("log newest first", log.map((x) => x.id), ["l", "c", "c", "w"]);
eq("log skips starting upgrades", log.some((x) => x.id === "t"), false);
eq("log fallback line from paid / at", log.at(-1), { id: "w", name: "Workshop", at: 50, paid: 10, kind: "", split: [] });
eq("log total spent", log.reduce((s, x) => s + x.paid, 0), 40);
eq("log power in the label", U.purchaseLog([up("pe", { id: "p", name: "Power Effect", power: "Flight", source: "karma", at: 1, paid: 20 })])[0].name, "Power Effect (Flight)");
eq("log accepts the id-keyed map", U.purchaseLog({ x: { name: "X", source: "karma", paid: 10, at: 5 } }).length, 1);
eq("log empty", U.purchaseLog([]), []);

/* ---- training hint (book examples: 10 -> 9 / 20 -> 18, and 10 -> 8 / 20 -> 16) */
eq("no facility, no hint", U.trainingHint([]), null);
eq("facilities hint", U.trainingHint([up("training-facilities")]), { key: "training-facilities", factor: 0.1, ten: 9, twenty: 18 });
eq("simulator wins", U.trainingHint([up("training-facilities"), up("training-simulator")]), { key: "training-simulator", factor: 0.2, ten: 8, twenty: 16 });
eq("broken facility gives nothing", U.trainingHint([up("training-facilities", { status: "broken" })]), null);
eq("installing facility gives nothing yet", U.trainingHint([up("training-facilities", { status: "installing" })]), null);
eq("broken simulator falls back to facilities", U.trainingHint([up("training-facilities"), up("training-simulator", { status: "broken" })]).key, "training-facilities");

/* ---- dependency issues of an owned upgrade */
const vdRow = up("vehicle-defense", { id: "vd", name: "Vehicle Defense" });
eq("dependency fine", U.dependencyIssues(C.vd, [up("team-vehicle", { name: "Team Vehicle" }), vdRow], "vd"), []);
eq("dependency broken", U.dependencyIssues(C.vd, [up("team-vehicle", { name: "Team Vehicle", status: "broken" }), vdRow], "vd").map((r) => r.key), ["IPB.Up.preUpgradeUnmet"]);
eq("dependency missing", U.dependencyIssues(C.vd, [vdRow], "vd").map((r) => r.key), ["IPB.Up.preUpgradeUnmet"]);
eq("dependency disabled", U.dependencyIssues(C.vd, [up("team-vehicle", { name: "Team Vehicle", status: "disabled" }), vdRow], "vd").map((r) => r.key), ["IPB.Up.preUpgradeDisabled"]);
eq("no upgrade prerequisite -> no issues", U.dependencyIssues(C.lab, [], "x"), []);
eq("resources prerequisite is not a dependency", U.dependencyIssues(C.lab, [up("laboratory", { id: "x" })], "x"), []);
eq("dependency junk-safe", U.dependencyIssues(null, null), []);

/* ---- recommended list + filter */
const cat = Object.values(C);
eq("recommended resolves book names", U.matchRecommended(["concealment", "Team Vehicle", "Nonexistent", "Team vehicle"], cat), [{ key: "concealment", name: "Concealment" }, { key: "team-vehicle", name: "Team Vehicle" }]);
eq("recommended empty", U.matchRecommended([], cat), []);
eq("filter empty = all", U.filterCatalog(cat, "").length, cat.length);
eq("filter by name", U.filterCatalog(cat, "vehicle").map((c) => c.key), ["team-vehicle", "vehicle-defense"]);
eq("filter by every word (name or prerequisite text)", U.filterCatalog(cat, "team veh").map((c) => c.key), ["team-vehicle", "vehicle-defense"]);
eq("filter words narrow", U.filterCatalog(cat, "team veh defense").map((c) => c.key), ["vehicle-defense"]);
eq("filter finds the prerequisite text", U.filterCatalog(cat, "technician").map((c) => c.key), ["laboratory"]);
eq("filter no match", U.filterCatalog(cat, "zzz"), []);
eq("filter junk", U.filterCatalog(cat, null).length, cat.length);

/* ---- adversarial: nothing throws on junk */
ck("catalogState never throws on junk", (() => { try { for (const e of [null, undefined, {}, { key: "x" }, { key: "x", prereq: {} }]) for (const c of [undefined, null, {}, { members: null, owned: null }]) U.catalogState(e, c); return true; } catch { return false; } })());
ck("every key emitted has the module prefix", (() => { const out = []; for (const e of [C.lab, C.vd, C.pe, C.concealment]) for (const st of [true, false]) { const r = U.catalogState(e, { ...base, staff: st, left: 0, members: [] }); out.push(r.start.why, r.buy.why, r.grant.why); } return out.filter(Boolean).every((w) => w.key.startsWith("IPB" + ".Up.")); })());

if (fails.length) { console.error(`FAILED ${fails.length}/${n}:\n - ${fails.join("\n - ")}`); process.exit(1); }
console.log(`OK ${n} checks`);
