import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL " + m); } };
const win = readFileSync(new URL("../base/window.mjs", import.meta.url), "utf8");
const up = readFileSync(new URL("../base/tabs/upgrades.mjs", import.meta.url), "utf8");
// S011: paint reads the current pick before rebuilding and restores it afterwards
const pi = win.indexOf("const picked = panel.querySelector('[name=\"ipb-join\"]')?.value");
const ih = win.indexOf("panel.innerHTML = `<div class=\"ipb-empty\">");
const rs = win.indexOf("sel.value = picked");
ok(pi > 0 && ih > pi, "S011 pick read before innerHTML rebuild");
ok(rs > ih, "S011 pick restored after rebuild");
// S013: doAdopt guarded by startOp/busy release
const d = up.slice(up.indexOf("async function doAdopt("), up.indexOf("async function adoptRun("));
ok(/startOp\(op\)/.test(d) && /finally \{ busy\.delete\(op\); \}/.test(d), "S013 doAdopt guarded in-flight");
ok(up.indexOf("DialogV2.wait", up.indexOf("async function adoptRun(")) > 0, "S013 dialog runs inside guarded body");
console.log(`sweep c3: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
