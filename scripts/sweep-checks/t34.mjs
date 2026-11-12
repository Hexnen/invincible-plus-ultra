// node scripts/sweep-checks/t34.mjs  (T068: per-variant dot alpha must be applied to the dot fill)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../tokenhalo/halo.mjs", import.meta.url)), "utf8");
ck("dot fill uses the variant alpha", src.includes("(d.g ? B : S).beginFill(col, a)"));
ck("dot fill is not hard-coded to 1", !src.includes("(d.g ? B : S).beginFill(col, 1)"));
console.log(`sweep t34: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
