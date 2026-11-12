// node scripts/sweep-checks/m007.mjs  (S007: the GM's "asked for a team card" notice goes through the lang module, EN and PL)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(new URL(`../base/${p}`, import.meta.url), "utf8");
const relay = rd("relay.mjs");
ck("no hard-coded English notice", !relay.includes("`team card for"));
ck("askCreate notice uses t()", /notice\(sender, "", t\("IPB\.Empty\.AskNotice"/.test(relay));
const lang = rd("lang.mjs");
ck("key in both tables", (lang.match(/"IPB\.Empty\.AskNotice":/g) ?? []).length === 2);
console.log(`sweep m007: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
