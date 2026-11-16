/* Key parity check for the table settings window: node scripts/table/check-lang.mjs
   1) EN and PL define exactly the same keys. 2) Every IPT.* key the code uses, and every row's name, hint and choice label (defs.TABS),
   exists in both. */
import { EN, PL } from "./lang.mjs";
import { ROWS, TABS, engineSpec } from "./defs.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const dir = dirname(fileURLToPath(import.meta.url));
globalThis.window ??= { innerWidth: 1600, innerHeight: 900, addEventListener() {} };   // stage.mjs reads the window size at import
const { SCREEN_LAYERS, WORLD_LAYERS } = await import("../splash/stage.mjs");
const miss = (a, b) => Object.keys(a).filter((k) => !(k in b));
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
for (const k of miss(EN, PL)) fail(`in EN, missing in PL: ${k}`);
for (const k of miss(PL, EN)) fail(`in PL, missing in EN: ${k}`);
const used = new Set();
for (const f of ["main.mjs", "app.mjs"]) {
  const src = readFileSync(join(dir, f), "utf8");
  for (const m of src.matchAll(/\bt\(\s*"(IPT\.[\w.]+)"/g)) used.add(m[1]);
}
/* the choices of this module's own pick settings, as their areas register them */
const MOD_CHOICES = {
  "splash.layer": [...SCREEN_LAYERS, ...WORLD_LAYERS], "splash.placement": ["token", "screen"], "splash.effects": ["full", "reduced", "off"],
  "splash.motion": ["auto", "full", "reduced"], "reactions.size": ["small", "normal", "large"], "reactions.layer": ["overlay", "weather", "tokens", "ground", "top"],
  "lang.splash": ["en", "pl"], "lang.reactions": ["en", "pl"], "gore.seats": ["owner", "owners", "all"]
};
for (const tab of TABS) {
  used.add(`IPT.Tab.${tab.id}`);
  for (const s of tab.sections) used.add(`IPT.Section.${tab.id}.${s.id}`);
}
for (const r of ROWS) {
  if (r.own) continue;      // GMGOVERN: named by its own area's registered strings (both languages checked in sweep-checks/gmgovern.mjs)
  used.add(`IPT.Row.${r.id}.Name`); used.add(`IPT.Row.${r.id}.Hint`);
  if (r.src === "info") { used.add(`IPT.Row.${r.id}.value`); continue; }
  if (r.src === "seat") { for (const c of ["none", "reduced", "photo", "both"]) used.add(`IPT.Row.${r.id}.${c}`); continue; }
  const choices = r.src === "mod" ? MOD_CHOICES[r.id] ?? [] : engineSpec(r.key)?.choices ?? [];
  for (const c of choices) used.add(`IPT.Row.${r.id}.${c}`);
}
for (const k of used) if (!(k in EN) || !(k in PL)) fail(`used but not defined in both languages: ${k}`);
if (used.size < 120) fail(`too few keys found in use (${used.size})`);
console.log(bad ? `${bad} problem(s)` : `OK: ${Object.keys(EN).length} keys, ${used.size} used, EN = PL`);
process.exit(bad ? 1 : 0);
