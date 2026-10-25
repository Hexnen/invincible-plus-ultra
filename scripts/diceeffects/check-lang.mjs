/* Key parity check for the dice effects: node scripts/diceeffects/check-lang.mjs
   1) EN and PL define exactly the same keys. 2) Every IDF.* key used in the code exists in both. */
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
for (const f of ["main.mjs", "art.mjs"]) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"(IDF\.[\w.]+)"/g)) used.add(m[1]);
}
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
for (const k of ["off", "subtle", "bold"]) if (!(`IDF.Settings.Strength.${k}` in EN) || !(`IDF.Settings.Strength.${k}` in PL)) fail(`strength ${k}`);
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used directly, EN = PL`);
process.exit(bad ? 1 : 0);
