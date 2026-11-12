// node scripts/sweep-checks/t11.mjs  (T024 replaceState repaint when go == current step; T025 edits after Apply clear #applied)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../chargen/wizard.mjs", import.meta.url)), "utf8");
// source-text checks (the class needs Foundry globals)
const rs = src.slice(src.indexOf("replaceState(next"), src.indexOf("  #afterChange({ body"));
ck("T024 go skipped when equal to current step", /if \(go && go !== this\.#stepId\) this\.go\(go\);/.test(rs));
ck("T024 else branch repaints body", /else this\.#paintBody\(\{ restoreFocus: false \}\)/.test(rs));
const ac = src.slice(src.indexOf("  #afterChange({ body"), src.indexOf("  #afterChange({ body") + 300);
ck("T025 afterChange clears applied", /#afterChange\([^\n]*\n\s*this\.#applied = false;/.test(ac));
// behaviour model of T024 decision
const decide = (go, step) => (go && go !== step ? "go" : "paint");
ck("model: board->board paints", decide("board", "board") === "paint");
ck("model: start->board navigates", decide("board", "start") === "go");
ck("model: no go paints", decide(null, "start") === "paint");
// model of T025: dirty = ready && !applied && past>0
const dirty = (applied, past) => !applied && past > 0;
ck("model: after edit applied=false => dirty", dirty(false, 3));
console.log(`sweep t11: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
