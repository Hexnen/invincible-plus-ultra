/* Key parity check for the combat banners: node scripts/combat/check-lang.mjs
   1) EN and PL define exactly the same keys. 2) Every ICB.* key used in the code exists (plural bases need all four categories). */
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
const used = new Set(), bases = new Set();
for (const f of ["main.mjs", "banner.mjs", "bar.mjs"]) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"(ICB\.[\w.]+)"/g)) used.add(m[1]);
  for (const m of src.matchAll(/\btn\(\s*"(ICB\.[\w.]+)"/g)) bases.add(m[1]);
}
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
for (const b of bases) for (const c of ["one", "few", "many", "other"]) if (!(`${b}.${c}` in EN) || !(`${b}.${c}` in PL)) fail(`plural ${b}.${c} missing`);
// every settings key the code derives by hand
for (const k of ["Size.small", "Size.normal", "Size.large", "Rounds.all", "Rounds.edges", "BarRes.both", "BarRes.health", "BarRes.none", "BarPlayers.friendly", "BarPlayers.all", "BarPlayers.none"]) if (!(`ICB.Settings.${k}` in EN) || !(`ICB.Settings.${k}` in PL)) fail(`settings ${k}`);
for (const k of ["fast", "slow", "one"]) for (const p of ["Act", "ActL"]) if (!(`ICB.Bar.${p}.${k}` in EN) || !(`ICB.Bar.${p}.${k}` in PL)) fail(`action label ${p}.${k}`);   // t(`ICB.Bar.Act.${kind}`)
for (const k of ["used", "open", "Line"]) if (!(`ICB.Bar.Act.${k}` in EN) || !(`ICB.Bar.Act.${k}` in PL)) fail(`action state ${k}`);
for (const k of ["friendly", "neutral", "hostile", "secret"]) if (!(`ICB.Bar.Disp.${k}` in EN) || !(`ICB.Bar.Disp.${k}` in PL)) fail(`disposition ${k}`);   // t(`ICB.Bar.Disp.${key}`)
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} direct + ${bases.size} plural bases used, EN = PL`);
process.exit(bad ? 1 : 0);
