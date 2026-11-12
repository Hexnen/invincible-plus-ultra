// node scripts/sweep-checks/t32.mjs  (T066 Escape handled once, T067 a later separate hit keeps its float)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const main = rd("../tactics/ui/main.mjs"), fb = rd("../tactics/ui/feedback.mjs");
// T066: source-text check (DOM code)
const line = main.split("\n").find((l) => l.includes('ev.key === "Escape" && (st.dock.armed'));
ck("escape handler stops the other listener", !!line && line.includes("stopImmediatePropagation") && line.includes("preventDefault"));
// T067: extract the helpers and run them
const grab = (re) => fb.match(re)?.[0];
const HIT_AFTER = 8000;
const blowOf = eval("(" + grab(/\(list, target, type\) => \{.*\}(?=;)/) + ")");
const sameBlow = eval("(" + grab(/\(prev, blow, at\) => .*(?=;)/) + ")");
const ev = [{ type: "damage", target: "X", inst: "a1" }, { type: "outcome", target: "X", hit: true, inst: "a1" }];
ck("blowOf damage", blowOf(ev, "X", "damage") === "a1");
const prev = { at: 0, blow: "a1" };
ck("same blow within window suppressed", sameBlow(prev, "a1", 5000));
ck("later separate blow not suppressed", !sameBlow(prev, "b2", 5000));
ck("outside window not suppressed", !sameBlow(prev, "a1", 9000));
ck("no previous loss", !sameBlow(undefined, "a1", 100));
ck("unknown blow keeps old behaviour", sameBlow({ at: 0, blow: null }, "b2", 5000));
ck("feedback uses sameBlow", fb.includes("sameBlow(lossAt[f.target], blow, at)"));
console.log(`sweep t32: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
