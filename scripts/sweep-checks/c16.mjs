import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const panel = readFileSync(new URL("../party/panel.mjs", import.meta.url), "utf8");
const main = readFileSync(new URL("../party/main.mjs", import.meta.url), "utf8");
// S051: empty branch of paintPips clears the stale key
const fn = panel.slice(panel.indexOf("function paintPips"));
const empty = fn.match(/if \(!groups\?\.length\) \{[^}]*\}/)[0];
ok(/delete box\.dataset\.key/.test(empty), "S051 empty branch clears dataset.key");
// S053: every observer made in watch()/measure() is tracked and disconnected by stop()
const stop = main.slice(main.indexOf("export function stop"));
ok(/extraMos\.splice\(0\)[\s\S]*disconnect/.test(stop.slice(0, 600)), "S053 stop disconnects tracked observers");
ok(!/new MutationObserver\(scheduleMeasure\)\.observe/.test(main), "S053 no untracked vram observer");
ok(!/new MutationObserver\(\(recs\)[^;]*\)\.observe\(document\.body/.test(main), "S053 no untracked body observer");
ok((main.match(/extraMos\.push/g) || []).length === 2, "S053 both observers pushed");
console.log(`sweep c16: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
