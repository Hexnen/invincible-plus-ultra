// node scripts/sweep-checks/m033.mjs  (S033: the talent / drawback dice say so when nothing on the list can be taken, instead of doing nothing)
import { readFileSync } from "node:fs";
let n = 0, f = 0;
const ck = (name, c) => { n++; if (!c) { f++; console.log("FAIL", name); } };
const src = readFileSync(new URL("../chargen/steps/talents.mjs", import.meta.url), "utf8");
const fn = (name) => { const i = src.indexOf(`function ${name}(ctx)`); return i < 0 ? "" : src.slice(i, src.indexOf("\n}\n", i)); };
for (const [name, key] of [["rollHero", "IPC.Talents.AllTaken"], ["rollExtra", "IPC.Talents.AllTaken"], ["rollDrawback", "IPC.Talents.Dr.AllTaken"]]) {
  const body = fn(name);
  ck(`${name} found`, body.length > 0);
  ck(`${name}: no silent exit on an empty list`, !/if \(!e\) return;|if \(!pool\.length\) return;/.test(body));
  ck(`${name}: tells the player`, body.includes(`said(ctx, t("${key}"))`));
}
const lang = readFileSync(new URL("../chargen/lang.mjs", import.meta.url), "utf8");
for (const k of ["IPC.Talents.AllTaken", "IPC.Talents.Dr.AllTaken"]) ck(`${k} in EN and PL`, (lang.match(new RegExp(`"${k.replace(/\./g, "\.")}":`, "g")) ?? []).length === 2);
console.log(`sweep m033: ${n} checks, ${f} failed`);
process.exit(f ? 1 : 0);
