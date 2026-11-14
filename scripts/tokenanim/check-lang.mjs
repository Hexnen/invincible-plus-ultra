/* Key parity check for token animations: node scripts/tokenanim/check-lang.mjs
   1) EN and PL define exactly the same keys. 2) Every ITA.* key used in the code (or built from the event, animation and screen ids)
   exists in both. */
import { EN, PL } from "./lang.mjs";
import { EVENTS, ANIM_IDS } from "./pure.mjs";
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
for (const f of ["main.mjs", "panel.mjs"]) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"(ITA\.[\w.]+)"/g)) used.add(m[1]);
}
for (const e of EVENTS) { used.add(`ITA.Event.${e}`); used.add(`ITA.EventHint.${e}`); }
for (const a of ANIM_IDS) { used.add(`ITA.Anim.${a}`); used.add(`ITA.AnimHint.${a}`); }
for (const m of ["full", "gentle", "off"]) used.add(`ITA.Mine.${m}`);
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
if (used.size < 20) fail(`too few keys found in use (${used.size})`);
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used, EN = PL`);
process.exit(bad ? 1 : 0);
