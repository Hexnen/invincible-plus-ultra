/* node scripts/tactics/check-pure.mjs -- the structure of the tactics folder keeps its promises (the rules of both packages it was merged from):
   - the pure files have no Foundry or browser globals, no clock, no randomness of their own, and import only each other and the rules
     library's index;
   - nothing in scripts/tactics imports the rules library except through its index, and nothing imports Year Zero Engine: Combat;
   - only the system adapter names the game system, only the zones adapter calls the map;
   - the rules in the pure files carry citation marks of the spec; no long prose (book text is private) in string literals;
   - the Foundry-facing files are thin: each stays under a size cap and none of them contains a rule constant of the ledger;
   - the pure reducer never rolls by itself;
   - there is ONE of everything: no stand-in is left, one executor, one relay, one store, one system adapter, one string table, one entry. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ok, eq, done } from "./testkit.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f) => fs.readFileSync(path.join(here, f), "utf8").replace(/\r\n/g, "\n");        // a Windows checkout may hold CRLF
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
const sub = (d) => fs.readdirSync(path.join(here, d)).filter((f) => f.endsWith(".mjs")).map((f) => `${d}/${f}`);
const all = [...fs.readdirSync(here).filter((f) => f.endsWith(".mjs")), ...sub("flows"), ...sub("ui")];
const code = all.filter((f) => !f.startsWith("check-"));
const PURE = code.filter((f) => /-pure\.mjs$/.test(f) || f.startsWith("flows/") || f === "source.mjs");
/* the designed surfaces (the action dock and the GM desk): DOM builders and their wiring. Not thin by nature, so they are not under the
   cap of the Foundry-facing files; they hold no rule (checked below) and their logic is ui/model-pure.mjs, which is under the pure rules. */
const SURFACE = ["ui/dom.mjs", "ui/dock.mjs", "ui/desk.mjs", "ui/pick.mjs", "ui/main.mjs"];
const FACING = code.filter((f) => !PURE.includes(f) && !SURFACE.includes(f) && !["testkit.mjs", "lang.mjs", "lang-attacks.mjs", "lang-int.mjs", "lang-kit.mjs"].includes(f));
const FORBIDDEN = /(?<![.\w])(game|ui|canvas|foundry|Hooks|CONFIG|CONST|ChatMessage|Roll|fromUuid|fromUuidSync|window|document|globalThis|setTimeout|socketlib)\s*[.(\[]/;
const GLOBALS = /(^|[^.\w"'`])(game|Hooks|foundry|ui|canvas|CONFIG|ChatMessage|fromUuid|fromUuidSync|document|window|globalThis|setTimeout|Math\.random|Date\.now)\s*[.(\[]|\bnew Roll\b/;
const pureImport = (i) => /-pure\.mjs$|\/flows\/|^\.\/(kit|attack|simple|move|vehicle|challenge|chase)\.mjs$|\/rules\/index\.mjs$|^node:/.test(i);

const P5_PURE = ["actions-pure.mjs", "flows/acts.mjs", "flows/hazards.mjs"];                 // package P5: the other actions and the hazards
const P6_PURE = ["kit-pure.mjs", "kitdata-pure.mjs"];                                          // package P6: what a character brings (the book's entries as data, and their reader)
for (const f of P6_PURE) ok(PURE.includes(f), `${f}: a pure file of package P6`);
eq(PURE.filter((f) => !P5_PURE.includes(f) && !P6_PURE.includes(f)).sort(), ["catalog-pure.mjs", "desk-pure.mjs", "director-pure.mjs", "economy-pure.mjs", "engine-pure.mjs", "flows/attack.mjs", "flows/challenge.mjs", "flows/chase.mjs", "flows/kit.mjs", "flows/move.mjs", "flows/simple.mjs", "flows/vehicle.mjs", "initiative-pure.mjs", "journal-pure.mjs",
  "ledger-pure.mjs", "mods-pure.mjs", "movement-pure.mjs", "ops-pure.mjs", "relay-pure.mjs", "scheduler-pure.mjs", "source.mjs", "state-pure.mjs", "ui/model-pure.mjs", "ui/scene-pure.mjs", "view-pure.mjs", "zones-pure.mjs"], "the pure files of the folder");
for (const f of P5_PURE) ok(PURE.includes(f), `${f}: a pure file of package P5`);
for (const f of PURE) {
  const c = strip(read(f));
  ok(!FORBIDDEN.test(c), `${f}: no Foundry or browser globals`);
  const hit = c.split("\n").find((l) => GLOBALS.test(l) && !/^\s*import\b/.test(l));
  ok(!hit, `${f}: no Foundry global, no clock, no randomness (${String(hit).trim().slice(0, 80)})`);
  ok(!/Math\.random|Date\.now|performance\.now|new Date/.test(c), `${f}: no randomness or clock of its own`);
  const imports = [...c.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  for (const i of imports) ok(pureImport(i), `${f}: imports only pure code (${i})`);
  ok(imports.every(pureImport), `${f}: imports only pure siblings and the rules index (${imports.join(", ")})`);
}
/* rule decisions carry the spec's marks */
for (const f of ["state-pure.mjs", "ledger-pure.mjs", "initiative-pure.mjs", "scheduler-pure.mjs", "ops-pure.mjs"]) ok(/\[(B\d+|R\d+|I\d+|L\d+|A-\d+|OQ-\d+|D|plan [\d.]+)\]/.test(read(f)), `${f}: rules carry the spec's citation marks`);
const MARK = /\[(B\d{3,4}|R\d+|OQ-\d+|U|D|A-\d+|LR-\d+|ZR-\d+|G-[ZL]\d+|L\d+|I\d+|plan [\d.]+)\]|spec \d+(\.\d+)*/g;
for (const [f, min] of [["flows/attack.mjs", 40], ["flows/simple.mjs", 10], ["flows/kit.mjs", 8], ["engine-pure.mjs", 40], ["mods-pure.mjs", 15], ["catalog-pure.mjs", 1], ["view-pure.mjs", 5], ["relay-pure.mjs", 4], ["journal-pure.mjs", 5],
  ["economy-pure.mjs", 4], ["director-pure.mjs", 3], ["zones-pure.mjs", 2], ["flows/move.mjs", 30], ["movement-pure.mjs", 30], ["flows/acts.mjs", 15], ["flows/hazards.mjs", 15], ["actions-pure.mjs", 5]]) {
  const n = (read(f).match(MARK) ?? []).length;
  ok(n >= min, `${f}: citation marks present (${n}, want at least ${min})`);
}
for (const f of all) {
  const c = strip(read(f));
  const imports = [...c.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)].map((m) => m[1]);
  ok(imports.filter((i) => i.includes("/rules/")).every((i) => i.endsWith("/rules/index.mjs")), `${f}: the rules library only through its index`);
  ok(!imports.some((i) => /yze/.test(i)), `${f}: no import of the Year Zero adapter`);
  ok(!/getFlag\(\s*["']yze-combat|flags\??\.\[?["']yze-combat/.test(c), `${f}: reads no yze-combat data`);
}
/* only the adapter may name the system; only the zones adapter calls the map */
for (const f of code.filter((f) => f !== "system-adapter.mjs")) {
  ok(!/systems\/invincible|InvincibleRollDialog|YearZeroRoll|system\.derived|system\.bonuses|system\.attributes|armorProtection|criticalInjury/.test(strip(read(f))), `${f}: does not touch the system (spec 11: one adapter file)`);
}
for (const f of code.filter((f) => f !== "zones-adapter.mjs")) ok(!/["'`]moinen-maps["'`]|moinenMaps|api\??\.zones\b/.test(strip(read(f))), `${f}: does not call the map (spec 7.3: one adapter file)`);
/* the rules library is used, not re-implemented or edited */
for (const f of ["flows/attack.mjs", "flows/simple.mjs", "flows/kit.mjs", "flows/move.mjs", "movement-pure.mjs"]) ok(/rules\/index\.mjs/.test(read(f)), `${f}: rules come from scripts/rules`);
ok(/conditions\.evalConds/.test(read("flows/kit.mjs")) && /conditions\.evalModRules/.test(read("flows/kit.mjs")) && /conditions\.validateCond/.test(read("catalog-pure.mjs")), "catalog predicates are answered by the rules library's conditions module");
/* book text is private: no long quoted prose in strings (a crude guard: no string literal of 14+ words) */
for (const f of code) {
  const long = [...strip(read(f)).matchAll(/"([^"\n]{80,})"/g)].map((m) => m[1]).filter((s) => s.split(/\s+/).length >= 14 && /^[A-Za-z ,.'-]+$/.test(s));
  eq(long.filter(() => f !== "lang.mjs" && f !== "lang-attacks.mjs" && f !== "lang-int.mjs" && f !== "lang-kit.mjs").length, 0, `${f}: no long prose in string literals`);
}
/* the Foundry-facing files: thin, guarded, no rule of the ledger or the draw. The caps: 130 lines of code, except the three files that
   are by design the meeting point of both halves (the executor's host with every document effect, the one system adapter with the
   readers of the round driver and of the action engine, the one API object). */
eq(FACING.slice().sort(), ["api.mjs", "combat-class.mjs", "engine.mjs", "main.mjs", "movement.mjs", "relay.mjs", "store.mjs", "system-adapter.mjs", "ui/prompts.mjs", "zones-adapter.mjs"], "the Foundry-facing files: one executor, one relay, one store, one system adapter, one zones adapter, one API, one entry");
const CAP = { "engine.mjs": 200, "system-adapter.mjs": 300, "api.mjs": 150 };      // P6: the adapter also reads every item of the sheet (automations, effects, bonuses)
for (const f of FACING) {
  const c = strip(read(f)), n = c.split("\n").filter((l) => l.trim()).length;
  ok(n <= (CAP[f] ?? 130), `${f}: thin (${n} lines of code, cap ${CAP[f] ?? 130})`);
  ok(!/canPay|turnStart\(|newLedger\(|startDraw\(|continueDraw\(/.test(c), `${f}: no ledger or draw logic outside the pure files`);
  if (f !== "ui/prompts.mjs" && f !== "api.mjs") ok(/try\s*\{/.test(c), `${f}: guarded with try / catch`);
}
for (const f of SURFACE) {
  const c = strip(read(f));
  ok(code.includes(f), `${f}: the surface file exists`);
  ok(!/canPay|turnStart\(|newLedger\(|startDraw\(|continueDraw\(|\bD\.handle\(|\bO\.reduce\(/.test(c), `${f}: no rule and no reducer in a surface file`);
  ok(!/Store\.write\(|setFlag\(|\.update\(|\.create\(|\.delete\(/.test(c), `${f}: a surface writes nothing itself (requests only)`);
  ok(/try\s*\{/.test(c), `${f}: guarded with try / catch`);
}
for (const f of ["ui/dom.mjs", "ui/dock.mjs", "ui/desk.mjs"]) ok(!/(^|[^.\w"'`])(game|Hooks|foundry|canvas|CONFIG|ChatMessage|fromUuid)\s*[.(\[]/.test(strip(read(f))), `${f}: plain DOM only, no Foundry global`);
ok(/Api\.request\(/.test(read("ui/main.mjs")) && !/Relay\./.test(strip(read("ui/main.mjs"))), "the surfaces send through api.tactics.request alone");
ok(/NO_RNG/.test(read("ops-pure.mjs")) && !/Math\.random/.test(strip(read("ops-pure.mjs"))), "the reducer has no default randomness");
ok(/CONFIG\.Dice\.randomUniform/.test(read("engine.mjs")), "the executor shuffles with Foundry's random source");
ok(!/this\b/.test(strip(read("combat-class.mjs")).match(/export function compareCombatants[\s\S]*?\n}\n/)?.[0] ?? "this"), "the sort does not use `this` (core calls it unbound)");
ok(/ipuTactics: true/.test(read("store.mjs")), "document updates of the engine carry the option ipuTactics");
for (const k of ["tcreq", "tcres", "tcev", "tcroll"]) ok(read("relay-pure.mjs").includes(`"${k}"`), `relay message kind ${k}`);
ok(/timeout: 8000, staleWait: 900/.test(read("relay-pure.mjs")) && /R\.LIMITS\.timeout/.test(read("relay.mjs")) && /R\.LIMITS\.staleWait/.test(read("relay.mjs")), "relay timeouts of spec 12.1");
/* one of everything */
ok(!all.some((f) => /standin/i.test(f)), "no stand-in file is left");
for (const f of all.filter((f) => f !== "check-pure.mjs")) ok(!/p1-standin|STAND-IN/.test(read(f)), `${f}: no reference to a stand-in`);
ok(!fs.existsSync(path.join(here, "gm.mjs")), "the executor is engine.mjs alone (spec 1.2)");
for (const f of code.filter((f) => f !== "engine.mjs" && f !== "testkit.mjs")) ok(!/\bD\.handle\(/.test(strip(read(f))), `${f}: only the executor runs the director`);
for (const f of code.filter((f) => !["store.mjs", "source.mjs"].includes(f))) ok(!/\.tactics\.(state|log|claim)`\]/.test(strip(read(f))), `${f}: only the store writes the state and the journal`);
ok(!/\bE\.handle\(|\bO\.reduce\(/.test(strip(read("engine.mjs"))), "the executor reaches the reducer and the engine only through the director");
const tail = fs.readFileSync(path.join(here, "..", "module.js"), "utf8");
eq((tail.match(/import\(\s*["']\.\/tactics\/[^"']+["']\s*\)/g) ?? []).length, 1, "scripts/module.js loads the tactics folder with one import");
ok(/import\(\s*["']\.\/tactics\/main\.mjs["']\s*\)/.test(tail), "and that import is main.mjs");

done("check-pure");
