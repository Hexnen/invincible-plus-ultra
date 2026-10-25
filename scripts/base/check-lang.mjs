/* Key parity check for the team & base card: node scripts/base/check-lang.mjs
   1) EN and PL define exactly the same keys, with the same {placeholders}. 2) Every IPB.* key written as a literal anywhere in scripts/base is
   defined in both languages. 3) Derived keys (BaseError codes, collection "Full" errors, settings) exist. 4) Every validation key pure.validate()
   can return has a string. */
import { EN, PL } from "./lang.mjs";
import * as P from "./pure.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
for (const k of Object.keys(EN)) if (!(k in PL)) fail(`in EN, missing in PL: ${k}`);
for (const k of Object.keys(PL)) if (!(k in EN)) fail(`in PL, missing in EN: ${k}`);
const ph = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
for (const k of Object.keys(EN)) if (k in PL && ph(EN[k]) !== ph(PL[k])) fail(`placeholders differ: ${k} (${ph(EN[k])} vs ${ph(PL[k])})`);
const used = new Set();
for (const f of readdirSync(dir).filter((x) => x.endsWith(".mjs") && !["lang.mjs", "check-lang.mjs", "check-base.mjs"].includes(x))) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/["'`](IPB\.[A-Za-z][\w.]*)["'`]/g)) used.add(m[1]);
}
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
const need = [];
for (const c of ["noBook", "noPermission", "tooBig", "noGM", "notFound", "invalid", "prerequisite", "stackMax", "full", "badInput", "blocked", "karma", "badType", "relay"]) need.push(`IPB.Err.${c}`);
for (const c of P.COLLECTIONS) need.push(`IPB.Err.${c}Full`);
for (const n of ["ShowInJournal", "HeaderButton", "PlayersCreate"]) for (const p of ["Name", "Hint"]) need.push(`IPB.Settings.${n}.${p}`);
for (const k of need) if (!(k in EN) || !(k in PL)) fail(`required key missing: ${k}`);
// every validation message key pure.mjs can emit
const probes = [null, { v: 99, rank: "x", policy: { edit: "x" }, upgrades: { a: 5, b: { status: "x", count: 0, source: "x" } }, events: { e: { roll: 12, band: "99-99" } }, vehicles: { a: { primary: true }, b: { primary: true } }, trackers: { t: { value: 5, max: 1 } } }];
for (const c of P.COLLECTIONS) probes.push({ rank: "global", [c]: Object.fromEntries(Array.from({ length: P.LIMITS[c] + 1 }, (_x, i) => [`i${i}`, {}])) });
probes.push({ rank: "global", upgrades: Object.fromEntries(Array.from({ length: 5 }, (_x, i) => [`s${i}`, { source: "start", count: 1 }])) });
probes.push({ rank: "global", crate: { a: { name: "x".repeat(P.LIMITS.bytes) } } });
for (const p of probes) for (const i of P.validate(p)) { if (!(i.key in EN) || !(i.key in PL)) fail(`validate key without string: ${i.key}`); }
// evalPrerequisite / planKarma messages
const pre = P.parsePrerequisite("Resources 5 or Technician, Laboratory", ["Laboratory"]);
for (const ctx of [{ members: [{ name: "A", resources: 9, occupation: "Technician" }], owned: [{ key: "laboratory", status: "disabled" }] }, { members: [], owned: [] }, { members: [], owned: [{ key: "laboratory", status: "active" }] }]) for (const r of P.evalPrerequisite(pre, ctx).reasons) if (!(r.key in EN) || !(r.key in PL)) fail(`eval key without string: ${r.key}`);
for (const r of P.evalPrerequisite(P.parsePrerequisite("???;", []), {}).reasons) if (!(r.key in EN)) fail(`eval key without string: ${r.key}`);
for (const r of P.validateSplit([{ actorId: "z", amount: -1 }, { actorId: "a", amount: 99 }], [{ id: "a", karma: 1 }], 5).errors) if (!(r.key in EN) || !(r.key in PL)) fail(`karma key without string: ${r.key}`);
if (P.checkStack({ max: 1 }, [{ count: 1 }]).reason && !(P.checkStack({ max: 1 }, [{ count: 1 }]).reason.key in EN)) fail("stack key");
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used as literals, EN = PL`);
process.exit(bad ? 1 : 0);
