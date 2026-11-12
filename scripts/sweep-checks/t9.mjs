// node scripts/sweep-checks/t9.mjs  (T018-T021 chargen shared/review; source-text checks, DOM/Foundry code)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const sh = rd("../chargen/steps/shared.mjs"), rv = rd("../chargen/steps/review.mjs");
// T018: paras evaluated from source with a stub esc
const line = sh.split("\n").find((l) => l.startsWith("export const paras"));
const esc = (s) => String(s);
const paras = new Function("esc", line.replace("export const", "return ").replace(/^return paras = /, "return ") )(esc);
ck("T018 paras('') is falsy", !paras(""));
ck("T018 paras(undefined) is falsy", !paras(undefined));
ck("T018 paras text", paras("a\nb") === "<p>a</p><p>b</p>");
// T019: unknown only after apply() started
const da = rv.slice(rv.indexOf("async function doApply"), rv.indexOf("async function doUndo"));
ck("T019 writing flag declared", /let writing = false;/.test(da));
ck("T019 flag set before apply.apply", da.indexOf("writing = true") > -1 && da.indexOf("writing = true") < da.indexOf("ctx.apply.apply(") && da.indexOf("writing = true") > da.indexOf("ctx.apply.plan("));
ck("T019 catch uses flag", /unknown: writing/.test(da) && !/unknown: true/.test(da));
// T020: failure branch shows undoError
const rb = rv.slice(rv.indexOf("const errs = r.errors"), rv.indexOf("/* ---------- actions"));
ck("T020 failure branch renders undoError", rb.includes("d.undoError"));
// T021: onState repaint guarded
const os = rv.slice(rv.indexOf("async onState"), rv.indexOf("render(ctx)"));
ck("T021 rerender guarded by step", /if \(ctx\.app\.stepId === "review"\) ctx\.rerender\(\)/.test(os));
console.log(`sweep t9: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
