/* Key parity check for the party cards: node scripts/party/check-lang.mjs
   1) EN and PL define exactly the same keys. 2) Every IPT.* key used in the code exists in both. */
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
for (const f of ["main.mjs", "panel.mjs", "actions.mjs"]) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"(IPT\.[\w.]+)"/g)) used.add(m[1]);
}
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
// keys derived by hand: t(`IPT.State.${s}`), t(`IPT.Pip.${k}`), settings choices
for (const k of ["hidden", "peek", "full"]) for (const p of ["IPT.State.", "IPT.Settings.Display."]) if (!(`${p}${k}` in EN) || !(`${p}${k}` in PL)) fail(`${p}${k}`);
for (const k of ["fast", "slow", "one", "used", "open", "past"]) if (!(`IPT.Pip.${k}` in EN) || !(`IPT.Pip.${k}` in PL)) fail(`IPT.Pip.${k}`);
for (const k of ["classic", "new"]) if (!(`IPT.Settings.Style.${k}` in EN) || !(`IPT.Settings.Style.${k}` in PL)) fail(`IPT.Settings.Style.${k}`);
for (const k of ["small", "normal", "large"]) if (!(`IPT.Settings.Size.${k}` in EN) || !(`IPT.Settings.Size.${k}` in PL)) fail(`IPT.Settings.Size.${k}`);
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used directly, EN = PL`);
process.exit(bad ? 1 : 0);
