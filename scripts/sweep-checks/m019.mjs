// node scripts/sweep-checks/m019.mjs  (S019: a soft hyphen in the book text - the core book has them, e.g. in "superhero" - is dropped, not turned into a space)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const SHY = "­";
const fnOf = (file, start) => {
  const line = readFileSync(new URL(`../chargen/${file}`, import.meta.url), "utf8").split("\n").find((l) => l.startsWith(start));
  return line ? new Function(`return ${line.slice(line.indexOf("=") + 1).replace(/;\s*(\/\/.*)?$/, "")}`)() : () => "";
};
const cClean = fnOf("catalog.mjs", "const clean =");
const cNorm = fnOf("catalog.mjs", "export const norm =");
const tClean = fnOf("tables.mjs", "const clean =");
ck("catalog clean drops a soft hyphen", cClean(`Super${SHY}strength`) === "Superstrength");
ck("tables clean drops a soft hyphen", tClean(`super${SHY}hero`) === "superhero");
ck("catalog norm drops a soft hyphen (keys agree with clean)", cNorm(`Super${SHY}Strength`) === cNorm(cClean(`Super${SHY}Strength`)) && cNorm(`Super${SHY}Strength`) === "superstrength");
ck("no-break space still a space", cClean(`a b`) === "a b" && tClean(`a b`) === "a b");
ck("whitespace still folds", cClean("  a \n b ") === "a b");
console.log(`sweep m019: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
