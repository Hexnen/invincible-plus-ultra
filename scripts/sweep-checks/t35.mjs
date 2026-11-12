import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
const src = readFileSync(new URL("../turn/tray.mjs", import.meta.url), "utf8");
// T069: the compact step must actually drop the name (the stylesheet has no itt-compact rule)
const line = src.split("\n").find(l => l.includes('classList.add("itt-compact")')) || "";
ok(/\.itt-name/.test(line) && /display\s*=\s*"none"/.test(line), "compact step hides the name in the same step as adding the class");
ok(/remove\("itt-compact"\)\s*;\s*\n[^\n]*\.itt-name[^\n]*display\s*=\s*""/.test(src), "name restored at the start of every placement");
// order: the name is hidden before the re-measure
ok(line.indexOf("none") < line.indexOf("offsetWidth"), "hidden before re-measuring width");
console.log(`sweep t35: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
