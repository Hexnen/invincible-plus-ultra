/* node scripts/tactics/check-pure.mjs -- the structure of the package keeps its promises:
   - the pure files have no Foundry or browser globals, no clock, no randomness of their own, and import only each other and the rules
     library's index;
   - nothing in scripts/tactics imports the rules library except through its index, and nothing imports Year Zero Engine: Combat;
   - the rules in the pure files carry citation marks of the spec;
   - the Foundry-facing files are thin: each stays under a size cap and none of them contains a rule constant of the ledger;
   - the pure reducer never rolls by itself. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, eq, done } from "./testkit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const read = (f) => fs.readFileSync(path.join(here, f), "utf8");
const all = [...fs.readdirSync(here).filter((f) => f.endsWith(".mjs")), ...fs.readdirSync(path.join(here, "ui")).filter((f) => f.endsWith(".mjs")).map((f) => `ui/${f}`)];
const PURE = ["state-pure.mjs", "ledger-pure.mjs", "initiative-pure.mjs", "scheduler-pure.mjs", "ops-pure.mjs", "source.mjs"];
const FACING = all.filter((f) => !PURE.includes(f) && !f.startsWith("check-") && !["testkit.mjs", "lang.mjs"].includes(f));
const FORBIDDEN = /(?<![.\w])(game|ui|canvas|foundry|Hooks|CONFIG|CONST|ChatMessage|Roll|fromUuid|fromUuidSync|window|document|globalThis|setTimeout|socketlib)\s*[.(\[]/;

for (const f of PURE) {
  const code = strip(read(f));
  ok(!FORBIDDEN.test(code), `${f}: no Foundry or browser globals`);
  ok(!/Math\.random|Date\.now|performance\.now|new Date/.test(code), `${f}: no randomness or clock of its own`);
  const imports = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  ok(imports.every((i) => i === "../rules/index.mjs" || PURE.includes(i.replace(/^\.\//, ""))), `${f}: imports only pure siblings and the rules index (${imports.join(", ")})`);
  if (f !== "source.mjs") ok(/\[(B\d+|R\d+|I\d+|L\d+|A-\d+|OQ-\d+|D|plan [\d.]+)\]/.test(read(f)), `${f}: rules carry the spec's citation marks`);
}
for (const f of all) {
  const code = strip(read(f));
  const imports = [...code.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1]);
  ok(imports.filter((i) => i.includes("/rules/")).every((i) => i.endsWith("/rules/index.mjs")), `${f}: the rules library only through its index`);
  ok(!imports.some((i) => /yze/.test(i)), `${f}: no import of the Year Zero adapter`);
  ok(!/getFlag\(\s*["']yze-combat|flags\??\.\[?["']yze-combat/.test(code), `${f}: reads no yze-combat data`);
}
eq(FACING.sort(), ["api.mjs", "combat-class.mjs", "gm.mjs", "main.mjs", "relay.mjs", "store.mjs", "system-adapter.mjs", "ui/prompts.mjs"], "the Foundry-facing files of P1");
for (const f of FACING) {
  const src = read(f), code = strip(src);
  ok(code.split("\n").filter((l) => l.trim()).length <= 130, `${f}: thin (${code.split("\n").filter((l) => l.trim()).length} lines of code)`);
  ok(!/canPay|turnStart\(|newLedger\(|startDraw\(|continueDraw\(/.test(code), `${f}: no ledger or draw logic outside the pure files`);
  if (f !== "ui/prompts.mjs" && f !== "api.mjs") ok(/try\s*\{/.test(code), `${f}: guarded with try / catch`);
}
ok(/NO_RNG/.test(read("ops-pure.mjs")) && !/Math\.random/.test(strip(read("ops-pure.mjs"))), "the reducer has no default randomness");
ok(/CONFIG\.Dice\.randomUniform/.test(read("gm.mjs")), "the executor shuffles with Foundry's random source");
ok(!/this\b/.test(strip(read("combat-class.mjs")).match(/export function compareCombatants[\s\S]*?\n}\n/)?.[0] ?? "this"), "the sort does not use `this` (core calls it unbound)");
ok(/ipuTactics: true/.test(read("store.mjs")), "document updates of the engine carry the option ipuTactics");
for (const k of ["tcreq", "tcres"]) ok(read("relay.mjs").includes(`"${k}"`), `relay message kind ${k}`);
ok(/TIMEOUT = 8000, STALE_WAIT = 900/.test(read("relay.mjs")), "relay timeouts of spec 12.1");

done("check-pure");
