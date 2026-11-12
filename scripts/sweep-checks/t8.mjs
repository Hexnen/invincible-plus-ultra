import { readFileSync } from "node:fs";
const dir = new URL("../chargen/steps/", import.meta.url);
const life = readFileSync(new URL("life.mjs", dir), "utf8"), persona = readFileSync(new URL("persona.mjs", dir), "utf8");
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log("FAIL", m); } };
// T016: life shares the in-flight promise (source assertion; DOM code cannot run in node)
ok(/if \(d\.archFor === name\) return d\.archPending \?\? false;/.test(life), "T016 life returns pending promise");
ok(/d\.archPending = run;/.test(life) && /async function loadArchetype/.test(life), "T016 life stores pending run");
// model of the old vs new behaviour
const mk = (shared) => async (d, name) => {
  if (d.archFor === name) return shared ? (d.p ?? false) : false;
  d.archFor = name;
  const run = (async () => { await new Promise((r) => setTimeout(r, 5)); return true; })();
  if (shared) d.p = run;
  return run;
};
for (const [sh, want] of [[false, false], [true, true]]) {
  const f = mk(sh), d = {}; const a = f(d, "A"), b = f(d, "A");
  ok((await b) === want, `T016 model shared=${sh} second mount told ${want}`);
  await a;
}
// T017: extract trimWords from persona source and exercise rollWord's slot logic
const m = persona.match(/const trimWords = [^\n]+/);
ok(!!m, "T017 trimWords exists");
const trimWords = new Function(`${m[0]}; return trimWords;`)();
const roll = (words, i, name) => { words = [...words]; while (words.length < i) words.push(""); words[i] = name; return trimWords(words); };
ok(JSON.stringify(roll([], 1, "X")) === '["","X"]', "T017 Word 2 roll keeps slot 2");
ok(JSON.stringify(roll([], 0, "X")) === '["X"]', "T017 Word 1 roll");
ok(JSON.stringify(roll(["A"], 1, "B")) === '["A","B"]', "T017 both words");
ok(JSON.stringify(trimWords(["", "X"])) === '["","X"]' && JSON.stringify(trimWords(["", ""])) === "[]", "T017 autosave trim");
ok(!/words\.filter\(Boolean\)\.slice\(0, 2\);\s*\n\s*said/.test(persona) && !/\.map\(clean\)\.filter\(Boolean\)/.test(persona), "T017 source no longer compacts slots");
console.log(`sweep t8: ${n} checks, ${bad} failed`);
process.exit(bad ? 1 : 0);
