// node scripts/sweep-checks/m024.mjs  (S024: an own-occupation field that ends on a book name picks that book occupation, so a partial name saved
// mid-typing ("Docto") cannot stay as the occupation while the field shows "Doctor")
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../chargen/steps/life.mjs", import.meta.url), "utf8");
const blk = src.slice(src.indexOf('key === "occOwn" || key === "occOwnRes"'), src.indexOf("patchBelow();", src.indexOf('key === "occOwn" || key === "occOwnRes"')));
ck("occOwn block found", blk.length > 0 && blk.length < 1500);
ck("a typed book name is picked (not ignored)", /if \(isBook\(d, name\)\) \{ chooseOccupation\(ctx, d\.allMap\.get\(nm\(name\)\)\); return; \}/.test(blk));
ck("no silent early return on a book name", !/if \(isBook\(d, name\)\) return;/.test(blk));
// behaviour model: the sequence of autosaves "Docto" then "Doctor"
const book = new Set(["doctor"]);
const run = (fixed) => { let occ = ""; for (const typed of ["Docto", "Doctor"]) { if (book.has(typed.toLowerCase())) { if (fixed) occ = "Doctor"; continue; } occ = typed; } return occ; };
ck("model: old code keeps the partial name", run(false) === "Docto");
ck("model: fixed code ends on the book occupation", run(true) === "Doctor");
console.log(`sweep m024: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
