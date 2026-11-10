// node scripts/tactics/check-pure.mjs -- structure rules of the tactics folder: pure files stay pure, only the adapter touches the system, rule decisions carry marks.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ok, eq, done } from "./testkit.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(HERE, f), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const files = [...readdirSync(HERE).filter((f) => f.endsWith(".mjs")), ...readdirSync(join(HERE, "flows")).map((f) => `flows/${f}`)];
const PURE = files.filter((f) => (/-pure\.mjs$/.test(f) && !f.startsWith("check-")) || f.startsWith("flows/") || f === "p1-standin.mjs");
const GLOBALS = /(^|[^.\w"'`])(game|Hooks|foundry|ui|canvas|CONFIG|ChatMessage|fromUuid|fromUuidSync|document|window|globalThis|setTimeout|Math\.random|Date\.now)\s*[.(\[]|\bnew Roll\b/;

ok(PURE.length >= 9, `pure files found (${PURE.length})`);
for (const f of PURE) {
  const code = strip(read(f));
  const hit = code.split("\n").find((l) => GLOBALS.test(l) && !/^\s*import\b/.test(l));
  ok(!hit, `${f}: no Foundry global, no clock, no randomness (${String(hit).trim().slice(0, 80)})`);
  for (const m of code.matchAll(/from\s+"([^"]+)"/g)) ok(/-pure\.mjs$|\/flows\/|^\.\/(kit|attack|simple)\.mjs$|\/rules\/index\.mjs$|p1-standin\.mjs$|^node:/.test(m[1]), `${f}: imports only pure code (${m[1]})`);
}
/* only the adapter may name the system */
for (const f of files.filter((f) => f !== "system-adapter.mjs" && !f.startsWith("check-"))) {
  const code = strip(read(f));
  ok(!/systems\/invincible|InvincibleRollDialog|YearZeroRoll|system\.derived|system\.bonuses|armorProtection|criticalInjury/.test(code), `${f}: does not touch the system (spec 11: one adapter file)`);
}
/* the rules library is used, not re-implemented or edited */
for (const f of ["flows/attack.mjs", "flows/simple.mjs", "flows/kit.mjs"]) ok(/rules\/index\.mjs/.test(read(f)), `${f}: rules come from scripts/rules`);
/* rule decisions carry the spec's marks */
const MARK = /\[(B\d{3,4}|R\d+|OQ-\d+|U|D|A-\d+|LR-\d+|ZR-\d+|G-[ZL]\d+|L\d+|I\d+|plan [\d.]+)\]|spec \d+(\.\d+)*/g;
for (const [f, min] of [["flows/attack.mjs", 40], ["flows/simple.mjs", 10], ["flows/kit.mjs", 8], ["engine-pure.mjs", 40], ["mods-pure.mjs", 15], ["catalog-pure.mjs", 1], ["view-pure.mjs", 5], ["relay-pure.mjs", 4], ["journal-pure.mjs", 5], ["p1-standin.mjs", 8]]) {
  const n = (read(f).match(MARK) ?? []).length;
  ok(n >= min, `${f}: citation marks present (${n}, want at least ${min})`);
}
/* book text is private: no long quoted prose in strings (a crude guard: no string literal of 12+ words) */
for (const f of files.filter((f) => !f.startsWith("check-"))) {
  const long = [...strip(read(f)).matchAll(/"([^"\n]{80,})"/g)].map((m) => m[1]).filter((s) => s.split(/\s+/).length >= 14 && /^[A-Za-z ,.'-]+$/.test(s));
  eq(long.filter((s) => f !== "lang.mjs").length, 0, `${f}: no long prose in string literals`);
}
/* the stand-ins are named as such, so the merge can drop them */
ok(/STAND-IN/.test(read("p1-standin.mjs")), "p1-standin.mjs says it is a stand-in");
if (existsSync(join(HERE, "p1-standin-store.mjs"))) ok(/STAND-IN/.test(read("p1-standin-store.mjs")), "p1-standin-store.mjs says it is a stand-in");
done("check-pure");
