import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL " + m); } };
const src = readFileSync(new URL("../tactics/api.mjs", import.meta.url), "utf8");
// S061: scenePlan needs the staff gate (source assertion; api.mjs needs Foundry globals)
const sp = src.match(/scenePlan: \(combat\) => \{[^\n]*/)[0];
ok(/Store\.isStaff\(game\.user\)/.test(sp), "S061 scenePlan checks Store.isStaff(game.user)");
ok(sp.indexOf("isStaff") < sp.indexOf("sceneEndPlan"), "S061 gate before the plan is computed");
// S062: extract popCombat and run it with a stubbed game
const g = (name) => src.match(new RegExp("^(const " + name + " = [^\n]*)$", "m"))?.[1];
const code = ["isCombat", "isCombatId", "popCombat"].map(g);
ok(code.every(Boolean), "S062 helpers found");
globalThis.game = { combats: new Map([["c2", { id: "c2" }]]) };
const popCombat = new Function(code.join("\n") + "\nreturn popCombat;")();
const doc = { documentName: "Combat" };
let a = ["actor", { x: 1 }, "c2"]; ok(popCombat(a) === "c2" && a.length === 2, "S062 trailing combat id popped (act)");
a = ["free", "c2"]; ok(popCombat(a) === "c2" && a.length === 1, "S062 trailing combat id popped (gm.setMode)");
a = ["actor", "nope"]; ok(popCombat(a) === undefined && a.length === 2, "S062 unknown string stays a payload");
a = ["c2"]; ok(popCombat(a) === undefined && a.length === 1, "S062 lone string stays a payload");
a = ["x", doc]; ok(popCombat(a) === doc && a.length === 1, "S062 Combat document still popped");
a = ["x", undefined]; ok(popCombat(a) === undefined && a.length === 1, "S062 undefined still popped");
console.log(`sweep c21: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
