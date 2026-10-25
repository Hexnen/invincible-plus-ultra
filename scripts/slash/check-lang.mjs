/* Key parity check for the comic slash: node scripts/slash/check-lang.mjs
   1) EN and PL define exactly the same keys. 2) Every IPS.* key used in the code exists in both. */
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
const src = readFileSync(join(dir, "main.mjs"), "utf8");
for (const m of src.matchAll(/\bt\(\s*"(IPS\.[\w.]+)"/g)) used.add(m[1]);
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
// keys built by hand: t(`IPS.Settings.Default.${v}`), t(`IPS.Type.${V}`)
for (const k of ["off", "top", "bottom", "right", "random"]) if (!(`IPS.Settings.Default.${k}` in EN) || !(`IPS.Settings.Default.${k}` in PL)) fail(`IPS.Settings.Default.${k}`);
for (const k of ["Top", "Bottom", "Right", "Random"]) if (!(`IPS.Type.${k}` in EN) || !(`IPS.Type.${k}` in PL)) fail(`IPS.Type.${k}`);
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used directly, EN = PL`);
process.exit(bad ? 1 : 0);
