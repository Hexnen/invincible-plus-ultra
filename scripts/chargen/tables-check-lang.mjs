/* Key parity check for the chargen tables builder: node scripts/chargen/tables-check-lang.mjs */
import { EN, PL } from "./tables-lang.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
for (const k of Object.keys(EN)) if (!(k in PL)) fail(`in EN, missing in PL: ${k}`);
for (const k of Object.keys(PL)) if (!(k in EN)) fail(`in PL, missing in EN: ${k}`);
const used = new Set();
const src = readFileSync(join(dir, "tables.mjs"), "utf8");
for (const m of src.matchAll(/\bt\(\s*"(IPCT\.[\w.]+)"/g)) used.add(m[1]);
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
for (const k of Object.keys(EN)) if (!used.has(k)) fail(`defined but unused: ${k}`);
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used, EN = PL`);
process.exit(bad ? 1 : 0);
