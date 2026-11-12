// node scripts/sweep-checks/t3.mjs  (T008: upgrades remove-undo re-checks the current card)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fixUndo } from "../base/tabs/upgrades.mjs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../base/tabs/upgrades.mjs", import.meta.url)), "utf8");
const doUndo = src.slice(src.indexOf("async function doUndo"), src.indexOf("async function doAsk"));
ck("doUndo uses fixUndo before update", doUndo.includes("fixUndo(") && doUndo.indexOf("fixUndo(") < doUndo.indexOf("ctx.update("));
ck("doUndo no longer writes rec.patch raw", !doUndo.includes("update(rec.patch)"));
const def = { key: "k", name: "Thing", max: 1 };
const snap = { key: "k", name: "Thing", count: 1, source: "start", status: "active" };
// (a) duplicate row
const B = { rank: "global", upgrades: { new1: { key: "k", name: "Thing", count: 1, source: "start", sort: 1 } } };
const r = fixUndo(B, { upgrades: { old: snap } }, () => def, false);
ck("(a) duplicate of max-1 refused", r.error === "stackMax");
ck("(a) free slot restores", fixUndo({ rank: "global", upgrades: {} }, { upgrades: { old: snap } }, () => def, false).patch.upgrades.old === snap);
// (b) ghost row
const g = fixUndo({ rank: "global", upgrades: {} }, { upgrades: { gone: { count: 2 } } }, () => def, false);
ck("(b) count-only patch for a missing row dropped", !g.error && Object.keys(g.patch).length === 0);
ck("(b) count patch on existing row kept", fixUndo({ upgrades: { u: { key: "k", count: 1 } } }, { upgrades: { u: { count: 2 } } }).patch.upgrades.u.count === 2);
console.log(`sweep t3: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
