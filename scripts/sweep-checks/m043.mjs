// node scripts/sweep-checks/m043.mjs  (S043: the scribe's initiative cache is filled on createCombatant and emptied on deleteCombatant / deleteCombat)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../log/scribe.mjs", import.meta.url), "utf8");
const body = (name) => { const i = src.indexOf(`const ${name} = guard(`); return i < 0 ? "" : src.slice(i, src.indexOf("\n", src.indexOf("});", i)) + 1); };
const create = body("onCreateCombatant"), delCm = body("onDeleteCombatant"), delC = body("onDeleteCombat"), upd = body("onUpdateCombatant");
ck("create fills before the eligibility test", /S\.init\.set\(cm\.id, cm\.initiative \?\? null\)/.test(create) && create.indexOf("S.init.set") < create.indexOf("elig("));
ck("delete combatant empties", /S\.init\.delete\(cm\.id\)/.test(delCm) && delCm.indexOf("S.init.delete") < delCm.indexOf("elig("));
ck("delete combat empties all of its combatants", /for \(const cm of combat\.combatants\) S\.init\.delete\(cm\.id\);/.test(delC));
ck("update still reads the cached from", /const from = S\.init\.get\(cm\.id\) \?\? null;/.test(upd));
// model: created with 12, changed to 15
const init = new Map();
const created = (fixed) => { init.clear(); if (fixed) init.set("c1", 12); const from = init.get("c1") ?? null; init.set("c1", 15); return from; };
ck("model: old code logs from=null", created(false) === null);
ck("model: fixed code logs from=12", created(true) === 12);
console.log(`sweep m043: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
