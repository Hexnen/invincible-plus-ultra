import { readFileSync } from "node:fs";
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.error("FAIL", m); } };
const src = readFileSync(new URL("../module.js", import.meta.url), "utf8");
// DOM code: asserted on source text
const i = src.indexOf("function dmgPlay");
const fn = src.slice(i, src.indexOf("function damageCard", i));
const cb = fn.match(/new win\.IntersectionObserver\(\(entries\) => \{([^\n]*?)\}, \{ threshold/)[1];
ok(/!started && !hp\.isConnected\) return finish\(\)/.test(cb), "S050 observer callback finishes a detached, never-started card");
ok(cb.indexOf("finish()") < cb.indexOf("start()"), "S050 detach check runs before start");
ok(/const finish = \(\) => \{[^}]*obs\?\.disconnect\(\);[^}]*DMG_STOP\.delete\(id\)/.test(fn), "S050 finish disconnects and deletes the entry");
console.log(`sweep c15: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
