// node scripts/sweep-checks/t0.mjs  (T001 picker repaint, T002 token hero -> world hero, T003 plain() [[/roll]])
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const entry = rd("../base/entry.mjs"), cat = rd("../base/catalog.mjs");

// T001 (source text: needs Foundry globals): refreshAll repaints the picker through a dynamic import, not the null module variable
ck("T001 no PickerApp?.refresh on the lazy variable", !/^\s*PickerApp\?\.refresh\(\)/m.test(entry));
ck("T001 dynamic import of picker.mjs refresh", /import\("\.\/picker\.mjs"\)\.then\(\(m\) => m\.PickerApp\?\.refresh\(\)\)/.test(entry));

// T002 (source text + extracted logic): openFor maps a synthetic token actor to the world hero before find/create
const of = entry.slice(entry.indexOf("export async function openFor"), entry.indexOf("export async function pick"));
ck("T002 openFor maps isToken", /actor\?\.isToken\) actor = actor\.baseActor \?\? game\.actors\.get\(actor\.id\)/.test(of));
ck("T002 mapping precedes S.find", of.indexOf("isToken") > 0 && of.indexOf("isToken") < of.indexOf("S.find(actor)"));
const world = { id: "w1", type: "superhero" };
globalThis.game = { actors: { get: (id) => (id === "w1" ? world : null) } };
const map = (a) => { if (a?.isToken) a = a.baseActor ?? game.actors.get(a.id) ?? a; return a; };
ck("T002 token -> baseActor", map({ isToken: true, baseActor: world, id: "w1" }) === world);
ck("T002 token w/o baseActor -> world by id", map({ isToken: true, id: "w1" }) === world);
ck("T002 plain actor unchanged", map(world) === world);

// T003: the real regex line from catalog.mjs
const line = cat.split("\n").find((l) => l.includes("(?:roll|r)")); 
const m = /\.replace\((\/.*\/gi), \(_m, a, b\) => b \|\| a\)/.exec(line);
ck("T003 regex found", !!m);
const re = eval(m[1]);
const pl = (s) => s.replace(re, (_m, a, b) => b || a);
ck("T003 [[/roll 2d6]]", pl("[[/roll 2d6]]") === "2d6");
ck("T003 [[/r 2d6]]", pl("[[/r 2d6]]") === "2d6");
ck("T003 [[2d6]]", pl("[[2d6]]") === "2d6");
ck("T003 label wins", pl("[[/roll 2d6]]{damage}") === "damage");
ck("T003 [[roll 1d4]]", pl("[[roll 1d4]]") === "1d4");
console.log(`sweep t0: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
