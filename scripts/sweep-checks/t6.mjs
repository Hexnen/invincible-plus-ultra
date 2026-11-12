// node scripts/sweep-checks/t6.mjs  (T011 power "(s)" names, T012 backup flag replaced, T013 teamBase without head)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const imp = rd("../chargen/import.mjs"), app = rd("../chargen/apply.mjs");
// T013: run the real regex literal taken from the source
const m13 = imp.match(/txt\("teamBase"\)\.split\((\/.*?\/i)\)/);
ck("T013 split regex found", !!m13);
const re13 = eval(m13[1]);
const [b1, u1] = "upgrades: A, B".split(re13);
ck("T013 upgrades-only text splits", b1 === "" && u1 === "A, B");
const [b2, u2] = "Fort, Moon; upgrades: A, B".split(re13);
ck("T013 normal text still splits", b2 === "Fort, Moon" && u2 === "A, B");
ck("T013 no upgrades", "Fort, Moon".split(re13).length === 1);
// T011: the real power-name regex
const m11 = imp.match(/ofType\("power"\)[\s\S]*?const pm = it\.name\.match\((\/.*?\/)\);/);
ck("T011 regex found", !!m11);
const re11 = eval(m11[1]);
ck("T011 Extra Limb(s) is not split", !"Extra Limb(s)".match(re11));
const r = "Flight (wings)".match(re11);
ck("T011 note still split", r && r[1] === "Flight" && r[2] === "wings");
const r2 = "Extra Limb(s) (tail)".match(re11);
ck("T011 name with (s) plus note", r2 && r2[1] === "Extra Limb(s)" && r2[2] === "tail");
// T012: model of the merge + source assertion of the drop before the write
const merge = (a, b) => ({ ...a, ...b });
ck("T012 model: plain merge keeps stale base (old bug)", "base" in merge({ base: 1, fields: { x: 1 } }, { runId: 2 }));
const i = app.indexOf("await actor.update(update);");
const before = app.slice(Math.max(0, i - 400), i);
ck("T012 old backup dropped before the write", before.includes('dropKey(`flags.${MODULE_ID}`, "chargenBackup")') && before.includes("getp(actor._source, backupPath)"));
console.log(`sweep t6: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
