/* Key parity check for token reactions: node scripts/tokenreact/check-lang.mjs
   1) EN and PL define exactly the same keys. 2) Every ITR.* key used in the code exists in both. */
import { EN, PL } from "./lang.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
const miss = (a, b) => Object.keys(a).filter((k) => !(k in b));
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
for (const k of miss(EN, PL)) fail(`in EN, missing in PL: ${k}`);
for (const k of miss(PL, EN)) fail(`in PL, missing in EN: ${k}`);
const used = new Set();
for (const f of ["main.mjs"]) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"(ITR\.[\w.]+)"/g)) used.add(m[1]);
}
for (const id of ["overlay", "weather", "tokens", "ground", "top"]) used.add(`ITR.Settings.Layer.${id}`);      // built from the engine's layer ids
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
if (used.size < 5) fail(`too few keys found in use (${used.size})`);
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used directly, EN = PL`);
process.exit(bad ? 1 : 0);
