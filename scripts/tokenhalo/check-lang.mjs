/* Key parity check for the token halo: node scripts/tokenhalo/check-lang.mjs
   1) EN and PL define exactly the same keys. 2) Every ITH.* key used in the code exists in both. */
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
for (const f of ["main.mjs", "halo.mjs"]) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"(ITH\.[\w.]+)"/g)) used.add(m[1]);
}
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
for (const k of ["Size.small", "Size.normal", "Size.large", "Motion.off", "Motion.calm", "Motion.lively"]) if (!(`ITH.Settings.${k}` in EN) || !(`ITH.Settings.${k}` in PL)) fail(`settings ${k}`);
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used directly, EN = PL`);
process.exit(bad ? 1 : 0);
