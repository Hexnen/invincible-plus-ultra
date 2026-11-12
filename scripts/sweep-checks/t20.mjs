import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
const src = readFileSync(new URL("../session/award.mjs", import.meta.url), "utf8");
// award.mjs needs Foundry globals: assert on the source of the undo orphan branch
const i = src.indexOf("if (row.st === 0) {");
const blk = src.slice(i, src.indexOf("if (row.st !== 1) continue;", i));
ok(blk.includes("orphan: true"), "orphan restore kept");
ok(/else if \(mk && OP\.markerConsistent\(mk, row\)\) results\.push\(\{ h: row\.h, status: "drift"/.test(blk), "T037 changed-karma orphan reports drift");
ok(/status: "drift"[^}]*orphan: true/.test(blk), "T037 drift flagged orphan");
console.log(`sweep t20: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
