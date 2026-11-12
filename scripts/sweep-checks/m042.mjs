// node scripts/sweep-checks/m042.mjs  (S042: item, effect and chat hooks never log an unlinked token's synthetic actor into the base hero's journal)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../log/scribe.mjs", import.meta.url), "utf8");
const line = src.split("\n").find((l) => l.startsWith("const elig ="));
ck("elig found", !!line);
const S = { states: new Map([["h1", { scope: "hero" }]]) };
const elig = new Function("S", `return ${line.slice(line.indexOf("=") + 1).trim().replace(/;$/, "")}`)(S);
ck("world hero is eligible", !!elig({ id: "h1", isToken: false }));
ck("synthetic token actor with the same id is not", elig({ id: "h1", isToken: true }) === null);
ck("unknown actor is not", elig({ id: "x", isToken: false }) === null);
// every item / effect / chat / combat hook goes through elig (no hook reads S.states for a doc's parent directly)
for (const fn of ["onCreateItem", "onDeleteItem", "onUpdateItem", "onCreateMessage"]) {
  const i = src.indexOf(`const ${fn} =`);
  ck(`${fn} uses elig`, i >= 0 && src.slice(i, src.indexOf("\n});", i)).includes("elig("));
}
console.log(`sweep m042: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
