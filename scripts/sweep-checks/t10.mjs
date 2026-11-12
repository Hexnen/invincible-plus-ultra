// node scripts/sweep-checks/t10.mjs  (T023: a drawback note's change event must not repaint the body)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
// the step needs Foundry globals, so assert on the source of the change handler
const src = readFileSync(fileURLToPath(new URL("../chargen/steps/talents.mjs", import.meta.url)), "utf8");
const i = src.indexOf('root.addEventListener("change"');
const j = src.indexOf('delegate(root, "click"', i);
const block = src.slice(i, j);
const k = block.indexOf('startsWith("dbnote-")');
const dbBranch = block.slice(k, block.indexOf("el.type !== \"radio\""));
ck("change handler found", i > 0 && j > i && k > 0);
ck("dbnote branch does not rerender", !dbBranch.includes("rerender"));
ck("dbnote branch patches marker in place", dbBranch.includes('classList.toggle("is-missing"') && dbBranch.includes("aria-invalid") && dbBranch.includes("ipc-need"));
ck("other radios still rerender", block.includes('ctx.rerender(); }') );
console.log(`sweep t10: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
