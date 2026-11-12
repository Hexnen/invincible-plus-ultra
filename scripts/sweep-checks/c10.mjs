// node scripts/sweep-checks/c10.mjs  (S036: disposition / ownership changes must repaint the bar; source-text checks, hooks need Foundry)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../combat/main.mjs", import.meta.url)), "utf8");
const lines = src.split("\n");
const tok = lines.find((l) => l.includes('on("updateToken"') && l.includes("disposition"));
ck("updateToken schedules on disposition change", !!tok && tok.includes("Bar.schedule()"));
const act = lines.find((l) => l.includes('on("updateActor"'));
ck("updateActor lets ownership through", !!act && act.includes('"ownership" in changes') && act.includes("Bar.touchesActor(actor)"));
// behaviour model: the old token gate dropped a disposition change on a tile-less token
const oldGate = (touches, changes) => touches || (changes && "hidden" in changes);
const newGate = (touches, changes) => oldGate(touches, changes) || (changes && "disposition" in changes);
ck("old gate dropped secret->hostile", !oldGate(false, { disposition: -1 }));
ck("new path passes secret->hostile", !!newGate(false, { disposition: -1 }));
ck("unrelated change still ignored", !newGate(false, { name: "x" }));
console.log(`sweep c10: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
