// node scripts/sweep-checks/m094.mjs  (S094: the "your turn" message is looked at again when initiative ends the waiting state without a turn / round change)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../turn/main.mjs", import.meta.url), "utf8");
const i = src.indexOf('for (const h of ["createCombatant", "updateCombatant", "deleteCombatant"]) on(h,');
const hook = i < 0 ? "" : src.slice(i, src.indexOf("});", i) + 3);
ck("combatant hooks found", !!hook);
ck("an initiative update while waiting re-evaluates the turn", /lastKey\.get\(id\) === null/.test(hook) && /"initiative" in changes/.test(hook) && /scheduleTurn\(\)/.test(hook));
// run the hook body: waiting recorded (null) -> initiative arrives -> scheduleTurn; not when a turn was already announced, not for other fields
const body = (lastKey) => { let calls = 0; const reg = []; new Function("on", "schedule", "scheduleTurn", "lastKey", hook)((name, fn) => reg.push([name, fn]), () => {}, () => { calls++; }, lastKey); return { reg, get calls() { return calls; } }; };
const run = (lastKey, name, changes) => { const b = body(lastKey); const fn = b.reg.find(([nm]) => nm === name)?.[1]; fn?.({ combat: { id: "c" } }, changes); return b.calls; };
ck("waiting -> initiative: evaluated", run(new Map([["c", null]]), "updateCombatant", { initiative: 14 }) === 1);
ck("turn already announced: nothing extra", run(new Map([["c", "1:x"]]), "updateCombatant", { initiative: 14 }) === 0);
ck("other combatant fields: nothing", run(new Map([["c", null]]), "updateCombatant", { hidden: true }) === 0);
ck("unknown combat: nothing", run(new Map(), "updateCombatant", { initiative: 3 }) === 0);
console.log(`sweep m094: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
