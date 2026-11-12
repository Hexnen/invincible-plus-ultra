import { readFileSync } from "node:fs";
import * as D from "../log/diff.mjs";
import { normalizeEntry } from "../log/model.mjs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const F = "flags.invincible-plus-ultra.base";
const hero = (o = {}) => ({ name: "H", img: "a", ownership: { default: "NONE" }, system: { attributes: {}, derived: {}, ...o } });
const baseCard = (b = {}) => ({ name: "B", img: "a", ownership: { default: "NONE" }, flags: { "invincible-plus-ultra": { base: { events: {}, trackers: {}, upgrades: {}, ...b } } } });
const dd = (x, y, scope) => D.draftsFromDiff(D.diffObjects(x, y), { scope, before: D.flatten(x), after: D.flatten(y) });

// T026: edit past the clamp is still logged
const t1 = "a".repeat(130), t2 = "a".repeat(125) + "bbbbb";
const r = dd(hero({ appearance: t1 }), hero({ appearance: t2 }), "hero");
ok(r.length === 1 && r[0].k === "stat.text", "T026 hero text edit past clamp logged");
const c1 = "c".repeat(170), c2 = "c".repeat(165) + "ddddd";
const rc = dd(baseCard({ description: c1 }), baseCard({ description: c2 }), "base");
ok(rc.length === 0 || rc.every((x) => x.k === "card.edit"), "T026 card edit sane");
const rc2 = dd(baseCard({ base: { description: "c".repeat(170) + "x" } }), baseCard({ base: { description: "c".repeat(170) + "y" } }), "base");
ok(rc2.length === 1 && rc2[0].k === "card.edit", "T026 card description edit past clamp logged");
ok(dd(hero({ appearance: "same" }), hero({ appearance: "same" }), "hero").length === 0, "T026 unchanged still dropped");

// T027: pruned event gives no rows
const ev = { roll: 11, band: "none", note: "hi", effect: { kind: "break", applied: true } };
ok(dd(baseCard({ events: { e1: ev } }), baseCard({ events: {} }), "base").length === 0, "T027 pruned event logs nothing");

// T028: new tracker gives no draft
ok(dd(baseCard(), baseCard({ trackers: { t1: { name: "Heat", value: 0, max: 5, sort: 1 } } }), "base").length === 0, "T028 tracker creation logs nothing");
const te = dd(baseCard({ trackers: { t1: { name: "Heat", value: 1, max: 5 } } }), baseCard({ trackers: { t1: { name: "Heat", value: 2, max: 5 } } }), "base");
ok(te.length === 1 && te[0].k === "tracker.edit" && te[0].d.from === 1 && te[0].d.to === 2, "T028 tracker edit still logged");

// T029: numeric more counts dropped items
const nm = (p) => `Item number ${p} with a rather long descriptive name to bloat the entry size ......`;
const e = normalizeEntry({ t: 1, u: "u", k: "bulk.change", d: { n: 80, more: 30, kids: Array.from({ length: 80 }, (_, i) => ({ k: "x", d: { n: nm(i) + "z".repeat(60) } })) } }, { now: 1 });
ok(e.d.kids && e.d.kids.length + e.d.more === 110, `T029 shown + more = 110 (got ${e.d.kids?.length} + ${e.d.more})`);

// T030: not fixable in maint.mjs alone (needs scribe-side reaction); nothing to check
console.log(`sweep t14: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
