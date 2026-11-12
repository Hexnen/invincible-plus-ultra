// node scripts/sweep-checks/t1.mjs  (T004: plain-channel request ids must differ between tabs of one user)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(fileURLToPath(new URL("../base/relay.mjs", import.meta.url)), "utf8");
const idLine = src.split("\n").find((l) => l.includes("const id = `"));
ck("id line found", !!idLine);
ck("id contains per-tab nonce", /\$\{TAB\}/.test(idLine));
ck("nonce is random", /const TAB = Math\.random\(\)/.test(src));
// model: evaluate the id template for two tabs with the same user and first request
const mk = (tab) => { let seq = 0; const game = { user: { id: "u" } }; const TAB = tab; return () => eval(idLine.match(/`.*`/)[0]); };
ck("two tabs, same seq -> different ids", mk("aaaaaa")() !== mk("bbbbbb")());
console.log(`sweep t1: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
