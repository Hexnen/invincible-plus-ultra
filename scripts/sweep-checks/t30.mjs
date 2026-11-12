// node scripts/sweep-checks/t30.mjs  (T061-T063: board.mjs; DOM/Foundry globals, so the fixes are asserted on the source text + pure helper)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as BP from "../tactics/ui/board-pure.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../tactics/ui/board.mjs", import.meta.url)), "utf8");
const lines = src.split("\n");
const find = (s) => lines.find((l) => l.includes(s)) ?? "";
// T061: a null envelope (request threw) counts as failed, the toggle goes back
const tog = find("onToggle: async (o)");
ck("T061 stepFailed(null) is true", BP.stepFailed(null) === true);
ck("T061 toggle uses stepFailed", tog.includes("BP.stepFailed(env) ? !o : o") && !tog.includes("env?.ok === false"));
// T062: the pending area pick keeps the latest declaration
ck("T062 pick holds dec and staff", src.includes("areaPick = { key, dec, staff }"));
ck("T062 callback reads mine.dec", src.includes("caught(doc, who, mine.dec, mine.staff)"));
ck("T062 same key refreshes dec", src.includes("else if (areaPick?.key === key) { areaPick.dec = dec; areaPick.staff = staff; }"));
ck("T062 then-handler reads current dec", src.includes("cur.submit?.req") && src.includes("cur.targets.some("));
// T063: reset takes the intention back
const rs = find("export function reset()");
ck("T063 reset says null intent", /if \(intentKey !== "null"\) \{ try \{ Zones\.intent\(null\)/.test(rs));
ck("T063 intent said before key wiped", rs.indexOf("Zones.intent(null)") > 0 && rs.indexOf("Zones.intent(null)") < rs.indexOf('intentKey = "null"; }'));
console.log(`sweep t30: ${n} checks, ${f} failed`); process.exit(f ? 1 : 0);
