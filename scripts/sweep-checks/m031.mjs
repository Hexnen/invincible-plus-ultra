// node scripts/sweep-checks/m031.mjs  (S031: a pressed "Recommended" upgrade chip un-picks instead of adding another copy)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../chargen/steps/team.mjs", import.meta.url), "utf8");
const rec = src.slice(src.indexOf("const recHtml"), src.indexOf("const rows = d.cat.length"));
ck("recHtml found", rec.length > 0);
ck("no pressed chip wired to add-up", !/tog\(e\.name, T\.upgrades\.some\([^)]*\)[^,]*, `data-act="add-up"/.test(rec));
ck("pressed chip uses rm-up with the copy's index", /tog\(e\.name, true, `data-act="rm-up" data-i="\$\{at\}"/.test(rec));
ck("unpressed chip still adds", /tog\(e\.name, false, `data-act="add-up"/.test(rec));
ck("pressed chip says Remove", rec.includes('"IPC.Team.Up.RemoveAria"'));
ck("rm-up handler exists", /case "rm-up": \{/.test(src));
console.log(`sweep m031: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
